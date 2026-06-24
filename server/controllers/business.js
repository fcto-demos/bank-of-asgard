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
import { getAccessToken, getOrganizationToken } from "../middleware/auth.js";
import { agent, IDP_BASE_URL } from "../config.js";

export async function isBusinessNameAvailable(businessName) {

  const token = await getAccessToken();
  const response = await axios.post(
    `${IDP_BASE_URL}/api/server/v1/organizations/check-name`,
    { name: businessName },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      httpsAgent: agent,
    }
  );
  return response.data.available;
}

export async function createOrganization(businessName, creatorId, creatorUsername) {

  const token = await getAccessToken();
  const response = await axios.post(
    `${IDP_BASE_URL}/api/server/v1/organizations`,
    {
      name: businessName,
      attributes: [
        { key: "creator.id", value: creatorId },
        { key: "creator.username", value: creatorUsername },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      httpsAgent: agent,
    }
  );
  return response;
}

export async function getUserIdInOrganization(organizationId, username) {

  const token = await getOrganizationToken(organizationId);
  const response = await axios.get(
    `${IDP_BASE_URL}/o/scim2/Users`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      params: {
        filter: `userName eq ${username}`,
      },
      httpsAgent: agent,
    }
  );

  const resources = response.data.Resources || [];
  if (resources.length === 0) {
    throw new Error("User not found in organization");
  }
  return resources[0].id;
}

export async function getAdminRoleIdInOrganization(organizationId) {

  const token = await getOrganizationToken(organizationId);
  const response = await axios.get(
    `${IDP_BASE_URL}/o/scim2/v2/Roles`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      params: {
        filter: `displayName eq Business Administrator`,
      },
      httpsAgent: agent,
    }
  );
  const resources = response.data.Resources || [];
  if (resources.length === 0) {
    throw new Error("Admin role not found in organization");
  }
  return resources[0].id;
}

export async function addUserToAdminRole(organizationId, roleId, userId) {
  
  const token = await getOrganizationToken(organizationId);
  const response = await axios.patch(
    `${IDP_BASE_URL}/o/scim2/v2/Roles/${roleId}`,
    {
      Operations: [
        {
          op: "add",
          path: "users",
          value: [
            {
              value: userId,
            },
          ],
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: agent, // Attach the custom agents
    }
  );
  return response.data;
}

export async function getRoleIdByName(roleName) {

  const token = await getAccessToken();
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const { sub, act, scope, scp } = payload;
  console.log(`[getRoleIdByName] Token sub: ${sub}, act: ${JSON.stringify(act)}, scope: ${scope || JSON.stringify(scp)}`);
  const response = await axios.get(
    `${IDP_BASE_URL}/scim2/v2/Roles`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      params: {
        filter: `displayName eq ${roleName}`,
      },
      httpsAgent: agent,
    }
  );
  const resources = response.data.Resources || [];
  if (resources.length === 0) {
    throw new Error(`Role '${roleName}' not found`);
  }
  return resources[0].id;
}

export async function assignUserToOrgRole(organizationId, userId, roleName) {

  const token = await getOrganizationToken(organizationId);
  const rolesResponse = await axios.get(
    `${IDP_BASE_URL}/o/scim2/v2/Roles`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      params: { filter: `displayName eq ${roleName}` },
      httpsAgent: agent,
    }
  );
  const resources = rolesResponse.data.Resources || [];
  if (resources.length === 0) throw new Error(`Role '${roleName}' not found in organization`);
  const roleId = resources[0].id;

  await axios.patch(
    `${IDP_BASE_URL}/o/scim2/v2/Roles/${roleId}`,
    { Operations: [{ op: "add", path: "users", value: [{ value: userId }] }] },
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      httpsAgent: agent,
    }
  );
}

export async function changeUserOrgRole(organizationId, userId, oldRoleName, newRoleName) {

  const token = await getOrganizationToken(organizationId);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  const getRoleId = async (roleName) => {
    const res = await axios.get(`${IDP_BASE_URL}/o/scim2/v2/Roles`, {
      headers,
      params: { filter: `displayName eq ${roleName}` },
      httpsAgent: agent,
    });
    return (res.data.Resources || [])[0]?.id || null;
  };

  const [oldRoleId, newRoleId] = await Promise.all([
    oldRoleName ? getRoleId(oldRoleName) : Promise.resolve(null),
    getRoleId(newRoleName),
  ]);

  if (!newRoleId) throw new Error(`Role '${newRoleName}' not found in organization`);

  if (oldRoleId) {
    await axios.patch(
      `${IDP_BASE_URL}/o/scim2/v2/Roles/${oldRoleId}`,
      { Operations: [{ op: "remove", path: `users[value eq "${userId}"]` }] },
      { headers, httpsAgent: agent }
    );
  }

  await axios.patch(
    `${IDP_BASE_URL}/o/scim2/v2/Roles/${newRoleId}`,
    { Operations: [{ op: "add", path: "users", value: [{ value: userId }] }] },
    { headers, httpsAgent: agent }
  );
}

export async function addUserToRole(roleId, userId) {

  const token = await getAccessToken();
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const { sub, act, scope, scp } = payload;
  console.log(`[addUserToRole] Token sub: ${sub}, act: ${JSON.stringify(act)}, scope: ${scope || JSON.stringify(scp)}`);
  const response = await axios.patch(
    `${IDP_BASE_URL}/scim2/v2/Roles/${roleId}`,
    {
      Operations: [
        {
          op: "add",
          path: "users",
          value: [{ value: userId }],
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: agent,
    }
  );
  return response.data;
}

export async function getOrganizationId(organizationName) {
  
  const token = await getAccessToken();
  const response = await axios.get(
    `${IDP_BASE_URL}/api/server/v1/organizations`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      params: {
        filter: `name eq ${organizationName}`,
      },
      httpsAgent: agent, // Attach the custom agents
    }
  );
  const organizations = response.data.organizations || [];
  if (organizations.length === 0) {
    throw new Error("Business not found.");
  }
  return organizations[0].id;
}

export async function deleteOrganization(organizationId) {
  
  const token = await getAccessToken();
  const response = await axios.delete(
    `${IDP_BASE_URL}/api/server/v1/organizations/${organizationId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      httpsAgent: agent, // Attach the custom agents
    }
  );
  return response.status;
}
