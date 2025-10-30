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

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useAsgardeo, useOrganization, useUser } from "@asgardeo/react";
import EditProfile from "../components/user-profile/edit-profile";
import ViewProfile from "../components/user-profile/view-profile";
import { ACCOUNT_TYPES, ROLES, SITE_SECTIONS } from "../constants/app-constants";
import { environmentConfig } from "../util/environment-util";
import IdentityVerificationStatus from "../components/identity-verification/identity-verification-status";
import { useContext } from "react";
import { IdentityVerificationContext } from "../context/identity-verification-provider";
import ContextSwitch from "../sdk/ContextSwitch";
import BusinessMemberContent from "../components/business-user-profile/business-member-content";
import IDPList from "../components/business-user-profile/idp-list";
import ManageUsers from "../components/business-user-profile/manage-users";
import BusinessProfileCard from "../components/business-user-profile/business-profile-card";

const BusinessProfilePage = ({ setSiteSection }) => {
  const { isSignedIn, signIn, http } = useAsgardeo();
  const { isIdentityVerificationEnabled, reloadIdentityVerificationStatus } = useContext(IdentityVerificationContext);

  const [userInfo, setUserInfo] = useState(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const { myOrganizations } = useOrganization();
  const { flattenedProfile } = useUser();
  const [ organizationId, setOrganizationId ] = useState("");
  const scopes = "openid profile internal_login internal_org_application_mgt_update internal_org_application_mgt_delete internal_org_application_mgt_create internal_org_application_mgt_view internal_org_user_mgt_update internal_org_user_mgt_delete internal_org_user_mgt_list internal_org_user_mgt_create internal_org_user_mgt_view internal_org_idp_view internal_org_idp_delete internal_org_idp_update internal_org_idp_create internal_org_role_mgt_delete internal_org_role_mgt_create internal_org_role_mgt_update internal_org_role_mgt_view";
  const request = (requestConfig) =>
    http.request(requestConfig)
      .then((response) => response)
      .catch((error) => error);

  useEffect(() => {
    if (!isSignedIn) {
      signIn();
    }
  }, []);

  useEffect(() => {
    getUserInfo();
    //getIdToken();     // Update after the fix with refresh token
  }, []);

  const handleUpdateSuccess = () => {
    getUserInfo(); // Remove after the fix with refresh token
    reloadIdentityVerificationStatus();
    setShowEditForm(false);

    // updateToken().then(() => {    // Use after the fix with refresh token
    //   getUpdatedUser();
    //   setShowEditForm(false);
    // });
  };

  useEffect(() => {
    if (!isSignedIn || !myOrganizations?.length || !flattenedProfile?.businessName) {
        return;
    }
    const businessOrg = myOrganizations.find(
      (org) => org.name === flattenedProfile?.businessName
    );
    if (!businessOrg) {
        return;
    }
    setOrganizationId(businessOrg.id);
  }, [isSignedIn, myOrganizations, flattenedProfile]);

  const getUserInfo = () => {
    request({
      headers: {
        Accept: "application/json",
        "Content-Type": "application/scim+json",
      },
      method: "GET",
      url: `${environmentConfig.ASGARDEO_BASE_URL}/scim2/Me`,
    }).then((response) => {
      if (response.data) {
        if (
          response.data["urn:scim:schemas:extension:custom:User"]
            ?.accountType === ACCOUNT_TYPES.BUSINESS
        ) {
          setSiteSection(SITE_SECTIONS.BUSINESS);
        } else {
          setSiteSection(SITE_SECTIONS.PERSONAL);
        }
        setUserInfo({
          userId: response.data.id || "",
          username: response.data.userName || "",
          accountType:
            response.data["urn:scim:schemas:extension:custom:User"]
              .accountType || "N/A",
          businessName: response.data["urn:scim:schemas:extension:custom:User"]
              .businessName || "N/A",
          email: response.data.emails[0] || "",
          givenName: response.data.name.givenName || "",
          familyName: response.data.name.familyName || "",
          mobile: response.data.phoneNumbers[0].value || "",
          country: response.data["urn:scim:wso2:schema"].country || "",
          birthdate: response.data["urn:scim:wso2:schema"].dateOfBirth || "",
          picture: response.data.picture || "",
          role: response.data.roles[0].display || "N/A"
        });
      }
      return;
    });
  };

  const handleCancelEdit = () => {
    setShowEditForm(false);
  };

  if (!userInfo) {
    return;
  }

  return (
    <>
      {isIdentityVerificationEnabled && <IdentityVerificationStatus />}
      <section className="about_section layout_padding">
        <div className="container-fluid">
          {userInfo && [ ROLES.MEMBER, ROLES.MANAGER, ROLES.AUDITOR ].includes(userInfo.role) ? (
            <BusinessMemberContent setSiteSection={ setSiteSection } role={userInfo.role}/>
          ) : (
            <>
            {showEditForm && userInfo ? (
              <EditProfile
                  userInfo={userInfo}
                  onUpdateSuccess={handleUpdateSuccess}
                  onCancel={handleCancelEdit}
              />
            ) : (
              <ViewProfile
              userInfo={userInfo}
              setShowEditForm={setShowEditForm}
              />
            )}
            <ContextSwitch organizationId={organizationId} scopes={scopes}>
              <div className="row" style={{ marginTop: "25px" }}>
                <div className="col-md-7">
                  <div
                    className="detail-box user-profile"
                    style={{ marginTop: "0", height: "100%" }}
                  >
                    <div className="contact_section">
                      <div className="contact_form-container profile-edit">
                        <IDPList />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-5">
                  <div
                    className="detail-box user-profile"
                    style={{ marginTop: "0", height: "100%" }}
                  >
                    <div className="contact_section">
                      <div className="contact_form-container profile-edit">
                        <BusinessProfileCard organizationId={organizationId} userInfo={userInfo}/>
                        <ManageUsers/>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </ContextSwitch>
            </>
          )}
        </div>
      </section>
    </>
  );
};

BusinessProfilePage.propTypes = {
  setSiteSection: PropTypes.object.isRequired,
};

export default BusinessProfilePage;
