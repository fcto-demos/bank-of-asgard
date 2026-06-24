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

import { useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useAsgardeo, useUser } from "@asgardeo/react";
import { Box, Chip, FormControlLabel, Switch, Typography } from "@mui/material";
import ShieldIcon from "@mui/icons-material/Shield";
import EditProfile from "../components/user-profile/edit-profile";
import ViewProfile from "../components/user-profile/view-profile";
import { ACCOUNT_TYPES, ROLES, SITE_SECTIONS } from "../constants/app-constants";
import { environmentConfig } from "../util/environment-util";
import IdentityVerificationStatus from "../components/identity-verification/identity-verification-status";
import { IdentityVerificationContext } from "../context/identity-verification-provider";
import ContextSwitch from "../sdk/ContextSwitch";
import BusinessMemberContent from "../components/business-user-profile/business-member-content";
import IDPList from "../components/business-user-profile/idp-list";
import ManageUsers from "../components/business-user-profile/manage-users";
import BusinessProfileCard from "../components/business-user-profile/business-profile-card";
import ChatComponent from "../components/transactions/ChatComponent";
import { TransactionInfoPanel } from "./transactions";

const GOLD = "#997029";

/**
 * @param {object} props
 * @param {(section: string) => void} props.setSiteSection
 */
const BusinessProfilePage = ({ setSiteSection }) => {
  const { isSignedIn, signIn, http } = useAsgardeo();
  const { isIdentityVerificationEnabled, reloadIdentityVerificationStatus } = useContext(IdentityVerificationContext);

  const [userInfo, setUserInfo] = useState(/** @type {any} */ (null));
  const [showEditForm, setShowEditForm] = useState(false);
  const [secured, setSecured] = useState(false);
  const [sessionId, setSessionId] = useState(
    () => "session_" + Math.random().toString(36).substring(2, 15)
  );

  const handleSecuredToggle = (/** @type {any} */ e) => {
    setSecured(e.target.checked);
    setSessionId("session_" + Math.random().toString(36).substring(2, 15));
  };
  const { flattenedProfile } = useUser();
  const [ organizationId, setOrganizationId ] = useState("");
  const scopes = "openid profile internal_login internal_org_application_mgt_update internal_org_application_mgt_delete internal_org_application_mgt_create internal_org_application_mgt_view internal_org_user_mgt_update internal_org_user_mgt_delete internal_org_user_mgt_list internal_org_user_mgt_create internal_org_user_mgt_view internal_org_idp_view internal_org_idp_delete internal_org_idp_update internal_org_idp_create internal_org_role_mgt_delete internal_org_role_mgt_create internal_org_role_mgt_update internal_org_role_mgt_view";
  const request = (/** @type {object} */ requestConfig) =>
    http.request(requestConfig)
      .then((response) => ({
        ...response,
        data: typeof response.data === "string" ? JSON.parse(response.data) : response.data,
      }))
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
    const businessName = flattenedProfile?.businessName || userInfo?.businessName;
    if (!isSignedIn || !businessName || organizationId) return;
    request({
      method: "GET",
      url: `${environmentConfig.API_SERVICE_URL}/organization-id?businessName=${encodeURIComponent(businessName)}`,
    }).then((response) => {
      if (response.data?.organizationId) {
        setOrganizationId(response.data.organizationId);
      }
    });
  }, [isSignedIn, flattenedProfile, userInfo]);

  const getUserInfo = () => {
    request({
      headers: {
        Accept: "application/json",
        "Content-Type": "application/scim+json",
      },
      method: "GET",
      url: `${environmentConfig.IDP_BASE_URL}/scim2/Me`,
    }).then((response) => {
      if (response.data) {
        const resolvedAccountType =
          response.data["urn:scim:schemas:extension:custom:User"]?.accountType ||
          response.data.accountType ||
          "N/A";
        const resolvedBusinessName =
          response.data["urn:scim:schemas:extension:custom:User"]?.businessName ||
          response.data.businessName ||
          "";
        if (resolvedAccountType === ACCOUNT_TYPES.BUSINESS) {
          setSiteSection(SITE_SECTIONS.BUSINESS);
        } else {
          setSiteSection(SITE_SECTIONS.PERSONAL);
        }
        setUserInfo({
          userId: response.data.id || "",
          username: response.data.userName || "",
          accountType: resolvedAccountType,
          businessName: resolvedBusinessName,
          email: response.data.emails?.[0] || "",
          givenName: response.data.name?.givenName || "",
          familyName: response.data.name?.familyName || "",
          mobile: response.data.phoneNumbers?.[0]?.value || "",
          country: response.data["urn:scim:wso2:schema"]?.country || "",
          birthdate: response.data["urn:scim:wso2:schema"]?.dateOfBirth || "",
          picture: response.data.picture || "",
          role: response.data.roles?.[0]?.display || "N/A"
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
          {userInfo && userInfo.accountType === ACCOUNT_TYPES.BUSINESS && (
            [ ROLES.MEMBER, ROLES.MANAGER, ROLES.AUDITOR ].includes(userInfo.role) ? (
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
              <Box sx={{ mt: 3, mb: 2 }}>
                <Box sx={{ mb: 2, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                  <Box>
                    <Typography variant="h5" sx={{ color: GOLD, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "1.1rem", mb: 0.5 }}>
                      How can we help you today?
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Ask about branches near you, our products, or your own account — all in one place.
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <ShieldIcon sx={{ color: secured ? GOLD : "#bbb", fontSize: 20 }} />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={secured}
                          onChange={handleSecuredToggle}
                          sx={{
                            "& .MuiSwitch-switchBase.Mui-checked": { color: GOLD },
                            "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { bgcolor: GOLD },
                          }}
                        />
                      }
                      label={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>AI Guardrails</Typography>
                          <Chip
                            label={secured ? "ON" : "OFF"}
                            size="small"
                            sx={{ height: 18, fontSize: "0.65rem", fontWeight: 700, bgcolor: secured ? "#e8f5e9" : "#f5f5f5", color: secured ? "#2e7d32" : "#999" }}
                          />
                        </Box>
                      }
                      sx={{ m: 0 }}
                    />
                  </Box>
                </Box>
                <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <Box sx={{ flex: "0 0 420px", minWidth: 300 }}>
                    <ChatComponent sessionId={sessionId} secured={secured} />
                  </Box>
                  <TransactionInfoPanel />
                </Box>
              </Box>
              <ContextSwitch organizationId={organizationId} scopes={scopes}>
                <div className="row" style={{ marginTop: "25px" }}>
                  <div className="col-md-7">
                    <div
                      className="detail-box user-profile"
                      style={{ marginTop: "0", height: "100%" }}
                    >
                      <div className="contact_section">
                        <div className="contact_form-container profile-edit">
                          <IDPList organizationId={organizationId} />
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
                          <ManageUsers organizationId={organizationId}/>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </ContextSwitch>
              </>
            )
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
