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

import { environmentConfig } from "../util/environment-util";
import { axiosClient } from "./axios-client";

export const closeAccount = (token) => {
  return axiosClient.delete(`/close-account`, {
    headers: { Authorization: `Bearer ${token}` }
  })
};

export const closeBusinessAccount = (businessName, token) => {
  return axiosClient.delete(`/close-business-account?businessName=${businessName}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
};

export const resetPassword = (username, currentPassword, newPassword) => {
  // In case the password contains non-ascii characters, converting to valid ascii format.
  const encoder = new TextEncoder();
  const encodedPassword = String.fromCharCode(
    ...encoder.encode(currentPassword)
  );
  const tenantDomain =
    environmentConfig.ORGANIZATION_NAME;
  const usernameWithDomain = [username, "@", tenantDomain].join("");

  const requestConfig = {
    data: {
      Operations: [
        {
          op: "add",
          value: {
            password: newPassword,
          },
        },
      ],
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    },
    headers: {
      Authorization: `Basic ${btoa(
        usernameWithDomain + ":" + encodedPassword
      )}`,
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": environmentConfig.APP_BASE_URL,
    },
    method: "PATCH",
    baseURL: environmentConfig.IDP_BASE_URL,
    url: "scim2/Me",
    withCredentials: true,
  };

  return axiosClient
    .request(requestConfig)
    .then((response) => {
      if (response.status !== 200) {
        throw new Error("Failed to reset password");
      }

      return Promise.resolve(response);
    })
    .catch((error) => {
      throw error;
    });
};
