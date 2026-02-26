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

import PropTypes from "prop-types";
import AccountSecurityCard from "./account-security-card";
import UserProfileCard from "./view/user-profile-card";
import BankAccountCard from "./view/bank-account-card";
import CloseAccountCard from "./close-account-card";
import CloseBusinessAccountCard from "../business-user-profile/close-business-account-card";
import { ACCOUNT_TYPES } from "../../constants/app-constants";

const ViewProfile = ({ userInfo, setShowEditForm }) => {
  return (
    <>
      <div className="heading_container">
        <h2>
          Welcome, {userInfo.givenName} {userInfo.familyName}!
        </h2>
      </div>

      <div className="row" style={{ marginTop: "25px" }}>
        <div className="col-md-7">
          <BankAccountCard userInfo={userInfo} />
        </div>
        <div
          className="col-md-5"
          style={{ display: "flex", flexDirection: "column" }}
        >
          <UserProfileCard
            userInfo={userInfo}
            setShowEditForm={setShowEditForm}
          />

          <AccountSecurityCard
            username={userInfo.username}
            accountType={userInfo.accountType}
          />

          <div style={{ marginTop: "auto", paddingTop: "15px" }}>
            {userInfo.accountType === ACCOUNT_TYPES.BUSINESS ? (
              <CloseBusinessAccountCard businessName={userInfo.businessName} />
            ) : (
              <CloseAccountCard />
            )}
          </div>
        </div>
      </div>
    </>
  );
};

ViewProfile.propTypes = {
  userInfo: PropTypes.object.isRequired,
  setShowEditForm: PropTypes.func.isRequired,
};

export default ViewProfile;
