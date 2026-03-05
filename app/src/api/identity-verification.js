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
import { http } from '@asgardeo/react';

export const getVerificationStatus = async () => {
  const requestConfig = {
      url: `${environmentConfig.IDP_BASE_URL}/api/users/v1/me/idv/claims`,
      method: "GET",
      params: {
          "idVProviderId": environmentConfig.IDENTITY_VERIFICATION_PROVIDER_ID
      }
  }

  return http.request(requestConfig)
      .then((response) => {
          return response.data;
      })
      .catch((error) => {
          throw error;
      });
}

export const initiateVerification = async () => {
  return updateVerificationStatus("INITIATED");
}

export const completeVerification = async () => {
  return updateVerificationStatus("COMPLETED");
}

export const reinitiateVerification = async () => {
  return updateVerificationStatus("REINITIATED");
}

const updateVerificationStatus = async (status) => {
  const requestConfig = {
      url: `${environmentConfig.IDP_BASE_URL}/api/users/v1/me/idv/verify`,
      method: "POST",
      data: {
          "idVProviderId": environmentConfig.IDENTITY_VERIFICATION_PROVIDER_ID,
          "claims": [
              "http://wso2.org/claims/dob",
              "http://wso2.org/claims/givenname",
              "http://wso2.org/claims/lastname"
          ],
          "properties": [
              {
                  "key": "status",
                  "value": status
              }
          ]
      }
  }

  return http.request(requestConfig)
      .then((response) => {
          return response.data;
      })
      .catch((error) => {
          throw error;
      });
}

