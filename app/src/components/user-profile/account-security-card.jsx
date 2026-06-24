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

import { useState } from "react";
import PropTypes from "prop-types";
import PasskeySetup from "../passkey-setup/passkey-setup";
import TotpSetup from "../totp/totp-setup";
import { ACCOUNT_TYPES } from "../../constants/app-constants";
import ResetPasswordForm from "./reset-password-form";

/**
 * @param {object} props
 * @param {string} props.username
 * @param {string} props.accountType
 */
const AccountSecurityCard = ({ username, accountType }) => {
  const [isPasswordFormOpen, setIsPasswordFormOpen] = useState(false);

  return (
    <div className="detail-box user-profile" style={{ flex: "1" }}>
      <div className="contact_section">
        <div className="contact_form-container profile-edit">
          <div className="row">
            <div className="col-md-12">
              <h5>Account Security</h5>
              <hr />

              <div>
                <h6>Change Password</h6>
                {isPasswordFormOpen ? (
                  <ResetPasswordForm
                    username={username}
                    onFormClosed={() => setIsPasswordFormOpen(false)}
                  />
                ) : (
                  <button onClick={() => setIsPasswordFormOpen(true)}>
                    Change Password
                  </button>
                )}
              </div>
              <hr />

              {accountType === ACCOUNT_TYPES.BUSINESS ? (
                <TotpSetup />
              ) : (
                <PasskeySetup />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

AccountSecurityCard.propTypes = {
  accountType: PropTypes.object.isRequired,
  username: PropTypes.string.isRequired
};

export default AccountSecurityCard;
