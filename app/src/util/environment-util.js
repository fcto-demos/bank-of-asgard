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

/**
 * A global object to store environment configuration variables.
 */
export const environmentConfig = {
  API_BASE_URL: window.config && window.config.API_BASE_URL,
  API_SERVICE_URL: window.config && window.config.API_SERVICE_URL,
  APP_BASE_URL: window.config && window.config.APP_BASE_URL,
  IDP_BASE_URL: window.config && window.config.IDP_BASE_URL,
  ORGANIZATION_NAME: window.config && window.config.ORGANIZATION_NAME,
  APP_CLIENT_ID: window.config && window.config.APP_CLIENT_ID,
  APP_NAME: window.config && window.config.APP_NAME,
  DISABLED_FEATURES: window.config && window.config.DISABLED_FEATURES,
  TRANSFER_THRESHOLD: window.config && window.config.TRANSFER_THRESHOLD || 10000,
  IDENTITY_VERIFICATION_PROVIDER_ID: window.config && window.config.IDENTITY_VERIFICATION_PROVIDER_ID,
  IDENTITY_VERIFICATION_CLAIMS: window.config && window.config.IDENTITY_VERIFICATION_CLAIMS,
  TRANSACTIONS_AGENT_URL: window.config && window.config.TRANSACTIONS_AGENT_URL,
  DEMO_USERS: window.config && window.config.DEMO_USERS
};

/**
 * Checks if a feature is enabled or not based on the DISABLED_FEATURES array.
 *
 * @param {string} feature
 * @returns A boolean indicating whether the feature is enabled or not.
 */
export const isFeatureEnabled = (feature) => {
  return !(environmentConfig.DISABLED_FEATURES || []).includes(feature);
};
