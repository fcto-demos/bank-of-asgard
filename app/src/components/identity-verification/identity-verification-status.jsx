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

import {
  IDENTITY_VERIFICATION_STATUS,
  ROUTES,
} from "../../constants/app-constants";
import { useNavigate } from "react-router";
import { useContext } from "react";
import { IdentityVerificationContext } from "../../context/identity-verification-provider";

const IdentityVerificationStatus = () => {
  const navigate = useNavigate();
  const {
    startIdentityVerification,
    isIdVStatusLoading,
    identityVerificationStatus,
  } = useContext(IdentityVerificationContext);

  const handleStartIdentityVerification = (/** @type {React.MouseEvent} */ e) => {
    e.preventDefault();

    const reInitiate = startIdentityVerification();

    navigate(ROUTES.IDENTITY_VERIFICATION, { state: { reInitiate } });
  };

  if (
    isIdVStatusLoading ||
    identityVerificationStatus === IDENTITY_VERIFICATION_STATUS.SUCCESS
  ) {
    return null;
  }

  return (
    <div className="identity-verification-message">
      <div className="container-fluid content-wrapper">
        {identityVerificationStatus ===
          IDENTITY_VERIFICATION_STATUS.IN_PROGRESS && (
          <>
            <i className="fa fa-clock-o" aria-hidden="true"></i>
            <p>
              Your identity verification is currently in progress. Please wait
              for the verification to complete.
            </p>
          </>
        )}

        {identityVerificationStatus !== IDENTITY_VERIFICATION_STATUS.SUCCESS &&
          identityVerificationStatus !==
            IDENTITY_VERIFICATION_STATUS.IN_PROGRESS && (
            <>
              <i className="fa fa-exclamation-triangle" aria-hidden="true"></i>
              <p>
                In order to perform money transfers higher than $10,000, you
                need to verify your identity.
              </p>
              <a onClick={handleStartIdentityVerification}>
                Start Verification
              </a>
            </>
          )}
      </div>
    </div>
  );
};

export default IdentityVerificationStatus;
