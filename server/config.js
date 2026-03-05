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

import dotenv from "dotenv";
import https from "https";

dotenv.config();

export const PORT = process.env.PORT || 3002;
export const HOST = process.env.HOST || "localhost";
export const IDP_BASE_URL = process.env.IDP_BASE_URL;
export const CLIENT_ID = process.env.SERVER_APP_CLIENT_ID;
export const CLIENT_SECRET = process.env.SERVER_APP_CLIENT_SECRET;
export const TOKEN_ENDPOINT = process.env.IDP_TOKEN_ENDPOINT;
export const GEO_API_KEY = process.env.GEO_API_KEY;
export const IDP_BASE_URL_SCIM2 = IDP_BASE_URL + "/scim2";
export const VITE_REACT_APP_CLIENT_BASE_URL =
  process.env.VITE_REACT_APP_CLIENT_BASE_URL;
export const USER_STORE_NAME = process.env.USER_STORE_NAME || "PRIMARY";
export const TRANSACTIONS_API_URL = process.env.TRANSACTIONS_API_URL || "http://localhost:8010";

// Added to compress self signed cert validation
export const agent = new https.Agent({
  rejectUnauthorized: false, // Disable SSL certificate validation
});
