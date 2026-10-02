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

import { useEffect, useState, useContext } from "react";
import PropTypes from "prop-types";
import { useAsgardeo } from "@asgardeo/react";
import EditProfile from "../components/user-profile/edit-profile";
import ViewProfile from "../components/user-profile/view-profile";
import { ACCOUNT_TYPES, SITE_SECTIONS } from "../constants/app-constants";
import { environmentConfig } from "../util/environment-util";
import IdentityVerificationStatus from "../components/identity-verification/identity-verification-status";
import { IdentityVerificationContext } from "../context/identity-verification-provider";
import { getExtendedProfile } from "../api/profile";
/**
 * @param {object} props
 * @param {(section: string) => void} props.setSiteSection
 */
const UserProfilePage = ({ setSiteSection }) => {
  const { isSignedIn, signIn, http, getDecodedIdToken, getAccessToken } = useAsgardeo();
  const { isIdentityVerificationEnabled, reloadIdentityVerificationStatus } = useContext(IdentityVerificationContext);

  const [userInfo, setUserInfo] = useState(/** @type {any} */ (null));
  const [showEditForm, setShowEditForm] = useState(false);

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
        const customSchema =
          response.data["urn:scim:schemas:extension:custom:User"];

        if (customSchema?.accountType === ACCOUNT_TYPES.BUSINESS) {
          setSiteSection(SITE_SECTIONS.BUSINESS);
        } else {
          setSiteSection(SITE_SECTIONS.PERSONAL);
        }
        setUserInfo({
          userId: response.data.id || "",
          username: response.data.userName || "",
          accountType: customSchema?.accountType || "N/A",
          // SCIM2's "emails" is a multi-valued attribute - each entry is
          // {value, primary}, not a plain string. Rendering the entry
          // itself (instead of .value) crashes React with "Objects are
          // not valid as a React child".
          email: response.data.emails?.[0]?.value || "",
          givenName: response.data.name?.givenName || "",
          familyName: response.data.name?.familyName || "",
          mobile: response.data.phoneNumbers?.[0]?.value || "",
          country: response.data["urn:scim:wso2:schema"]?.country || "",
          birthdate: response.data["urn:scim:wso2:schema"]?.dateOfBirth || "",
          picture: response.data.picture || "",
          iban: customSchema?.iban || "",
        });
        return;
      }
      // Self-service /scim2/Me has no backing local SCIM user to resolve
      // for a wallet-based (passwordless) sign-in and 404s instead of
      // returning data here - fall back to the ID token's own claims so
      // the profile page doesn't just stay blank after a wallet login.
      getUserInfoFromIdToken();
    }).catch(() => {
      getUserInfoFromIdToken();
    });
  };

  // Populate the profile straight from the ID token's claims instead of
  // /scim2/Me. Every sign-in method (password or wallet) resolves to the
  // same ID token, and for wallet logins there's no backing local SCIM
  // user to fetch - this is that path's fallback. Business-account
  // detection isn't available from token claims alone, so this always
  // treats the session as personal - wallet login isn't wired up for
  // business accounts in this demo. IBAN isn't a token claim either, so
  // it's fetched separately below once this resolves.
  const getUserInfoFromIdToken = () => {
    getDecodedIdToken().then((claims) => {
      if (!claims) {
        return;
      }
      setSiteSection(SITE_SECTIONS.PERSONAL);
      setUserInfo({
        userId: claims.sub || "",
        username: claims.given_name || claims.email || claims.sub || "",
        accountType: "N/A",
        email: claims.email || "",
        givenName: claims.given_name || "",
        familyName: claims.family_name || "",
        mobile: "",
        country: "",
        birthdate: "",
        picture: claims.picture || "",
        iban: "",
      });
      getIban();
    });
  };

  // IBAN lives on the SCIM2 user profile under a custom schema extension,
  // so it still needs its own fetch here even for a wallet login - routed
  // through the BOA server's /me-extended route, which resolves the real
  // account via the caller's verified email (see server/server.js),
  // since self-service /scim2/Me already failed above. Retried a couple
  // of times with a short backoff: right after a fresh wallet-login
  // redirect, getAccessToken() can occasionally be called before the SDK
  // has finished its token exchange.
  const getIban = (/** @type {number} */ attemptsLeft = 3) => {
    getAccessToken()
      .then((token) => getExtendedProfile(token))
      .then((response) => {
        if (response?.data?.iban) {
          setUserInfo((prev) => (prev ? { ...prev, iban: response.data.iban } : prev));
        }
      })
      .catch((err) => {
        console.log(
          `[UserProfile] /me-extended IBAN fallback failed (attempts left after this: ${attemptsLeft - 1}):`,
          err?.response?.data || err?.message || err
        );
        if (attemptsLeft > 1) {
          setTimeout(() => getIban(attemptsLeft - 1), 600);
        }
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
          {showEditForm && userInfo ? (
            <>
              <EditProfile
                userInfo={userInfo}
                onUpdateSuccess={handleUpdateSuccess}
                onCancel={handleCancelEdit}
              />
            </>
          ) : (
            <ViewProfile
              userInfo={userInfo}
              setShowEditForm={setShowEditForm}
            />
         )}
        </div>
      </section>

    </>
  );
};

UserProfilePage.propTypes = {
  setSiteSection: PropTypes.object.isRequired,
};

export default UserProfilePage;
