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

import axios from "axios";
import { agent, CLIENT_ID, CLIENT_SECRET, TOKEN_ENDPOINT } from "../config.js";

// In-memory storage for token data
let tokenData = {
  access_token: null,
  scope: null,
  token_type: null,
  expires_in: null,
  expires_at: null, // expiration time to request new token
};

// In-memory storage for organization token data
let orgTokenCache = {};

export const getAuthHeader = () => {
  const authString = `${CLIENT_ID}:${CLIENT_SECRET}`;
  return "Basic " + Buffer.from(authString).toString("base64");
};

// Get a new token if expired or not available
export const getAccessToken = async () => {
  const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds

  if (
    tokenData.access_token &&
    tokenData.expires_at &&
    currentTime < tokenData.expires_at
  ) {
    console.log(
      `Using cached access token. Expires in ${
        tokenData.expires_at - currentTime
      } seconds.`
    );
    return tokenData.access_token;
  }

  console.log("Fetching new access token... ");

  try {
    const response = await axios.post(
      TOKEN_ENDPOINT,
      "grant_type=client_credentials&scope=internal_user_mgt_create internal_user_mgt_delete internal_user_mgt_update internal_user_mgt_view internal_organization_create internal_organization_view internal_organization_update internal_organization_delete internal_org_role_mgt_view internal_org_role_mgt_update",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: getAuthHeader(),
        },
        httpsAgent: agent, // Attach the custom agent
      }
    );

    const issuedAt = Math.floor(Date.now() / 1000); // Current timestamp in seconds
    const expiresIn = response.data.expires_in; // Token validity duration in seconds

    // Store the new token data with exact expiration time
    tokenData = {
      access_token: response.data.access_token,
      scope: response.data.scope,
      token_type: response.data.token_type,
      expires_in: expiresIn,
      expires_at: issuedAt + expiresIn, // Exact expiration timestamp
    };

    console.log(
      `New access token received. Expires at ${new Date(
        tokenData.expires_at * 1000
      ).toISOString()}`
    );
    return tokenData.access_token;
  } catch (error) {
    console.log("Error fetching token:", error);
    throw new Error("Failed to get access token");
  }
};

export const getOrganizationToken = async (switchingOrganizationId) => {

  // TODO: Consider periodic expired token cleanup: clean token after the sign up
  const currentTime = Math.floor(Date.now() / 1000);
  if (
    orgTokenCache[switchingOrganizationId] &&
    orgTokenCache[switchingOrganizationId].access_token &&
    orgTokenCache[switchingOrganizationId].expires_at &&
    currentTime < orgTokenCache[switchingOrganizationId].expires_at
  ) {
    console.log(
      `Using cached token for org ${switchingOrganizationId}. Expires in ${
        orgTokenCache[switchingOrganizationId].expires_at - currentTime
      } seconds.`
    );
    return orgTokenCache[switchingOrganizationId].access_token;
  }

  try {
    const rootToken = await getAccessToken();

    console.log(`Fetching new switch token for organization ${switchingOrganizationId}... `);

    const params = new URLSearchParams();
    params.append("grant_type", "organization_switch");
    params.append("token", rootToken);
    params.append("switching_organization", switchingOrganizationId);
    params.append(
      "scope",
      "internal_org_role_mgt_view internal_org_role_mgt_update internal_org_user_mgt_create internal_org_user_mgt_list internal_org_user_mgt_view"
    );

    const response = await axios.post(
      TOKEN_ENDPOINT,
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: getAuthHeader(),
        },
        httpsAgent: agent,
      }
    );

    const expiresIn = response.data.expires_in; // in seconds
    const issuedAt = Math.floor(Date.now() / 1000);

    orgTokenCache[switchingOrganizationId] = {
      access_token: response.data.access_token,
      expires_at: issuedAt + expiresIn,
    };

    console.log(
      `New token cached for org ${switchingOrganizationId}. Expires at ${new Date(
        orgTokenCache[switchingOrganizationId].expires_at * 1000
      ).toISOString()}`
    );

      return response.data.access_token;
  } catch (error) {
    console.log("Error fetching organization token:", error);
    throw new Error("Failed to get organization token");
  }
};

function unauthorized(res, code, desc) {
  res.set(
    'WWW-Authenticate',
    `Bearer realm="api", error="${code}", error_description="${desc}"`
  );
  return res.status(401).json({ error: desc });
}

export function requireBearer(req, res, next) {
  const auth = req.get('authorization'); // case-insensitive
  if (!auth) {
    return unauthorized(res, 'invalid_request', 'Missing Authorization header');
  }

  const parts = auth.trim().split(/\s+/);
  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
    return unauthorized(res, 'invalid_request', 'Malformed Authorization header');
  }

  req.token = parts[1];
  next();
}

