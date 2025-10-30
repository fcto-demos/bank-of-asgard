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

export const ROUTES = {
  HOME: "/",
  PERSONAL_BANKING: "/personal-banking",
  BUSINESS_BANKING: "/business-banking",
  USER_PROFILE: "/user-profile",
  BUSINESS_PROFILE: "/business-profile",
  REGISTER_ACCOUNT: "/register-account",
  FUND_TRANSFER: "/fund-transfer",
  FUND_TRANSFER_VERIFY: "/fund-transfer/verify",
  NOT_FOUND: "/404",
  IDENTITY_VERIFICATION: "/identity-verification"
};

export const SITE_SECTIONS = {
  PERSONAL: "personal",
  BUSINESS: "business"
}

export const ACCOUNT_TYPES = {
    PERSONAL: "Personal",
    BUSINESS: "Business",
}

export const ROLES = {
    MEMBER: "Member",
    MANAGER: "Manager",
    AUDITOR: "Auditor"
}

export const URL_QUERY_PARAMS = {
    ACCOUNT_TYPE: "accountType"
}

export const IDENTITY_VERIFICATION_STATUS = {
    NOT_STARTED: "NOT_STARTED",
    IN_PROGRESS: "IN_PROGRESS",
    SUCCESS: "SUCCESS",
    FAILED: "FAILED"
}
