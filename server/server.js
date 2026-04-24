/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import express from "express";
import cors from "cors";
import axios from "axios";
import pino from "pino";

import { getAccessToken, requireBearer } from "./middleware/auth.js";
import { addUserToAdminRole, addUserToRole, createOrganization, deleteOrganization, getAdminRoleIdInOrganization, getOrganizationId, getRoleIdByName, getUserIdInOrganization, isBusinessNameAvailable } from "./controllers/business.js"
import { agent, IDP_BASE_URL, IDP_BASE_URL_SCIM2, GEO_API_KEY, HOST, PORT, TRANSACTIONS_API_URL, USER_STORE_NAME, VITE_REACT_APP_CLIENT_BASE_URL, RISK_CHECK_ENABLED } from "./config.js";

const corsOptions = {
  origin: [VITE_REACT_APP_CLIENT_BASE_URL],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Access-Control-Allow-Methods",
    "Access-Control-Request-Headers",
  ],
  credentials: true,
  enablePreflight: true,
};

const app = express();

const logger = pino({
  level: process.env.LOG_LEVEL || "debug",
});

function isPrivateOrBogonIp(ip) {
  return (
    /^127\./.test(ip) ||          // loopback
    /^10\./.test(ip) ||           // RFC 1918
    /^192\.168\./.test(ip) ||     // RFC 1918
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || // RFC 1918
    /^169\.254\./.test(ip) ||     // link-local
    /^::1$/.test(ip) ||           // IPv6 loopback
    /^fc00:/i.test(ip) ||         // IPv6 unique local
    ip === "0.0.0.0"
  );
}

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// logger middleware.
app.use((req, res, next) => {
  logger.debug({
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
  });
  next();
});

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

async function createUser(userData) {
  const {
    username,
    password,
    email,
    firstName,
    lastName,
    country,
    accountType,
    businessName,
    dateOfBirth,
    mobile,
  } = userData;
  logger.info({ username, accountType, email }, "createUser: starting");

  const token = await getAccessToken();
  logger.debug("createUser: access token acquired");

  const scimUrl = `${IDP_BASE_URL_SCIM2}/Users`;
  logger.debug({ url: scimUrl, username, accountType }, "createUser: calling SCIM2 Users API");

  const response = await axios.post(
    scimUrl,
    {
      schemas: [],
      userName: `${USER_STORE_NAME}/${username}`,
      password: password,
      emails: [
        {
          value: email,
          primary: true,
        },
      ],
      name: {
        givenName: firstName,
        familyName: lastName,
      },
      "urn:scim:wso2:schema": {
        country: country,
        dateOfBirth: dateOfBirth,
      },
      phoneNumbers: [
        {
          type: "mobile",
          value: mobile,
        },
      ],
      "urn:scim:schemas:extension:custom:User": {
        accountType: accountType,
        ...(businessName ? { businessName } : {}),
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: agent,
    }
  );
  logger.info({ userId: response.data?.id, username, status: response.status }, "createUser: user created successfully");
  return response;
};

app.post("/signup", async (req, res) => {
  try {
    const response = await createUser(req.body);
    res.json({ message: "User registered successfully", data: response.data });

    // Asynchronously assign the Read_Transactions role and seed transaction data
    const userId = response.data?.id;
    if (userId) {
      try {
        const roleId = await getRoleIdByName("Read_Transactions");
        await addUserToRole(roleId, userId);
        logger.info({ userId }, "POST /signup: user assigned to Read_Transactions role");
      } catch (roleError) {
        logger.error({
          userId,
          message: roleError.message,
          status: roleError.response?.status,
          detail: roleError.response?.data,
        }, "POST /signup: failed to assign Read_Transactions role");
      }

      try {
        const token = await getAccessToken();
        await axios.post(
          `${TRANSACTIONS_API_URL}/admin/provision`,
          { user_sub: userId },
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
        logger.info({ userId }, "POST /signup: transactions provisioned");
      } catch (provisionError) {
        logger.warn({ userId, message: provisionError.message }, "POST /signup: failed to provision transactions");
      }
    }
  } catch (error) {
    const asgardeoError = error.response?.data;
    logger.error({
      status: error.response?.status,
      asgardeoError,
      message: error.message,
    }, "POST /signup failed");
    res.status(error.response?.status || 400).json({ error: asgardeoError || error.message || "Signup failed" });
  }
});

app.post("/business-signup", async (req, res) => {
  try {
    const { businessName, username } = req.body;
    logger.info({ businessName, username }, "POST /business-signup: started");

    const available = await isBusinessNameAvailable(businessName);
    if (!available) {
      logger.warn({ businessName }, "POST /business-signup: business name already taken");
      return res.status(400).json({ error: "Business name is already taken" });
    }

    const userResponse = await createUser(req.body);
    // Return a response and asynchronously continue with the remaining operations
    res.json({
      message: "Business user registered successfully",
      user: userResponse.data
    });

    const creatorId = userResponse.data.id;
    logger.debug({ creatorId, businessName }, "POST /business-signup: creating organization");
    const orgResponse = await createOrganization(businessName, creatorId, username);
    const organizationId = orgResponse.data.id;
    logger.debug({ organizationId }, "POST /business-signup: organization created");

    const orgUserId = await getUserIdInOrganization(organizationId, username);
    logger.debug({ orgUserId }, "POST /business-signup: resolved org user ID");
    const adminRoleId = await getAdminRoleIdInOrganization(organizationId);
    logger.debug({ adminRoleId }, "POST /business-signup: resolved admin role ID");
    addUserToAdminRole(organizationId, adminRoleId, orgUserId);
    logger.info({ organizationId, orgUserId }, "POST /business-signup: user assigned to admin role");
  } catch (error) {
    const asgardeoError = error.response?.data;
    logger.error({
      status: error.response?.status,
      asgardeoError,
      message: error.message,
      stack: error.stack,
    }, "POST /business-signup failed");
    res.status(error.response?.status || 400).json({ error: asgardeoError || error.message || "Business signup failed" });
  }
});

// IP geolocation request
app.post("/risk", async (req, res) => {
  if (!RISK_CHECK_ENABLED) {
    logger.debug("POST /risk: check disabled via environment variable, returning no risk");
    return res.json({ hasRisk: false });
  }

  try {
    let { ip, country } = req.body;

    logger.debug({ ip, country }, "POST /risk: evaluating...");

    if (!ip || !country) {
      logger.warn({ ip, country }, "POST /risk: missing required fields (ip or country)");
      return res
        .status(400)
        .json({ error: "IP address and country name are required" });
    }

    // For private/bogon IPs, omit the ip param so the API resolves the caller's real public IP
    const resolvedIp = isPrivateOrBogonIp(ip) ? null : ip;
    if (resolvedIp !== ip) {
      logger.debug({ ip }, "POST /risk: private/bogon IP detected, falling back to caller's public IP");
    }
    const geoUrl = resolvedIp
      ? `https://api.ipgeolocation.io/ipgeo?apiKey=${GEO_API_KEY}&ip=${resolvedIp}&fields=country_name`
      : `https://api.ipgeolocation.io/ipgeo?apiKey=${GEO_API_KEY}&fields=country_name`;

    // Call the IP Geolocation API
    const response = await axios.get(geoUrl);

    const country_name = response.data.country_name;
    // Determine risk based on country code
    const hasRisk = country_name !== country;
    logger.info({ ip, country, resolved: country_name, hasRisk }, "POST /risk: result");
    res.json({ hasRisk });
  } catch (error) {
    logger.error({ message: error.message }, "POST /risk: geolocation failed (If problem persists, option is to disable risk check via environment variable RISK_CHECK_ENABLED");
    // TODO (To be discussed with owner): We should consider returning a Risk detected (true) with 2xx instead of a 500, to avoid blocking login due to transient issues with the geolocation API.
    res.status(500).json({ error: "Failed to process request" });
  }
});

async function deleteUser(req) {

  const token = await getAccessToken();
  const userAccessToken = req.token;

  const me = await axios.get(`${IDP_BASE_URL_SCIM2}/Me`, {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      Accept: "application/scim+json"
    },
    httpsAgent: agent
  });

  const scimId = me.data?.id;
  if (!scimId) {
    return res.status(500).json({ error: "Could not resolve SCIM user id" });
  }

  const response = await axios.delete(
    `${IDP_BASE_URL_SCIM2}/Users/${scimId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "*/*",
      },
      httpsAgent: agent, // Attach the custom agent
    }
  );
  return response;
}

app.delete("/close-account", requireBearer, async (req, res) => {
  try {
    const response = deleteUser(req);
    if (response.status == 204) {
      res.json({
        message: "Account removed successfully",
        data: response.data,
      });
    }
  } catch (error) {
    console.log("SCIM2 API Error:", error.detail || error.message);
    res
      .status(400)
      .json({ error: error.detail || "An error occurred while deleting user" });
  }
});

app.delete("/close-business-account", requireBearer, async (req, res) => {
  
  try {
    const organizationName = req.query.businessName;
    const orgId = await getOrganizationId(organizationName);
    const businessDeletionStatus = await deleteOrganization(orgId);
    const deletionResponse = await deleteUser(req);
    if (businessDeletionStatus == 204 && deletionResponse.status == 204) {
      res.json({
        message: "Business account removed successfully"
      });
    }
  } catch (error) {
    console.log("Error:", error.detail || error.message);
    res
      .status(400)
      .json({ error: error.detail || "An error occurred while deleting business user" });
  }
});

app.get("/business", async (req, res) => {
  
  try {
    const organizationId = req.query.organizationId;
    const token = await getAccessToken();
    const response = await axios.get(
    `${IDP_BASE_URL}/api/server/v1/organizations/${organizationId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      httpsAgent: agent,
    }
  );

  const businessRegistrationAttribute = response.data.attributes.find(attr => attr.key === "business-registration-number");
  const businessRegNumber = businessRegistrationAttribute ? businessRegistrationAttribute.value : null;

  if (response.status === 200) {
    res.json({
      "businessRegistrationNumber": businessRegNumber
    });
  }
  } catch (error) {
    console.log("Business API Error:", error.detail || error.message);
    res
      .status(400)
      .json({ error: error.detail || "An error occurred while fetching business details" });
  }
});

app.patch("/business-update", async (req, res) => {
  try {
    const organizationId = req.body.organizationId;
    const newBusinessRegistrationNumber = req.body.businessRegistrationNumber;
    const operation = req.body.operation

    if (!organizationId || !newBusinessRegistrationNumber) {
      return res.status(400).json({ error: "Missing organizationId or business details in request" });
    }

    const token = await getAccessToken();

    const response = await axios.patch(
      `${IDP_BASE_URL}/api/server/v1/organizations/${organizationId}`,
      [
        {
          operation,
          path: "/attributes/business-registration-numberr",
          value: newBusinessRegistrationNumber
        }
      ],
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        },
        httpsAgent: agent
      }
    );

    if (response.status === 200) {
      res.json({
        message: "Business details updated successfully",
        data: response.data
      });
    } else {
      res.status(response.status).json({ error: "Failed to update business details" });
    }
  } catch (error) {
    console.error("Organization PATCH API Error:", error.response?.data || error.message);
    res.status(400).json({
      error: error.response?.data || "An error occurred while updating the business"
    });
  }
});

app.post("/reprovision", requireBearer, async (req, res) => {
  try {
    const userInfo = await axios.get(`${IDP_BASE_URL}/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${req.token}` },
      httpsAgent: agent,
    });
    const sub = userInfo.data.sub;
    if (!sub) {
      return res.status(400).json({ error: "Could not resolve user identity" });
    }
    const adminToken = await getAccessToken();
    await axios.post(
      `${TRANSACTIONS_API_URL}/admin/provision`,
      { user_sub: sub, num_transactions: 60 },
      { headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" } }
    );
    logger.info({ sub }, "POST /reprovision: transactions provisioned");
    res.json({ status: "ok", user_sub: sub });
  } catch (error) {
    logger.error({ message: error.message }, "POST /reprovision: failed");
    res.status(500).json({ error: "Failed to reprovision transactions" });
  }
});

app.get("/transactions-summary", requireBearer, async (req, res) => {
  try {
    const userInfo = await axios.get(`${IDP_BASE_URL}/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${req.token}` },
      httpsAgent: agent,
    });
    const sub = userInfo.data.sub;
    if (!sub) {
      return res.json({ total: 0, recent: [], monthly_counts: {} });
    }
    const adminToken = await getAccessToken();
    const response = await axios.get(`${TRANSACTIONS_API_URL}/admin/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { user_sub: sub, limit: 5 },
      httpsAgent: agent,
    });
    res.json(response.data);
  } catch (error) {
    logger.warn({ error: error.message }, "GET /transactions-summary: failed");
    res.json({ total: 0, recent: [], monthly_counts: {} });
  }
});

app.listen(PORT, () =>
  console.log(`🌐 Server running at: http://${HOST}:${PORT}`)
);
