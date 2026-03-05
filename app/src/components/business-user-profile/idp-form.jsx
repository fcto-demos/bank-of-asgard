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
import { TextField, MenuItem } from "@mui/material";
import PropTypes from "prop-types";
import { environmentConfig } from "../../util/environment-util";
import { enqueueSnackbar } from "notistack";
import { useHttpSwitch } from "../../sdk/httpSwitch";

const IDPForm = ({ organizationId, onIdpAdded, fetchAppConfig, getAppId, onCancel }) => {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [provider, setProvider] = useState("microsoft");
  const [loading, setLoading] = useState(false);
  const httpSwitch = useHttpSwitch();
  const request = (requestConfig) =>
    httpSwitch.request(requestConfig)
      .then((response) => response)
      .catch((error) => error);

  const addAuthenticatorToStep1 = (sequence, providerName) => {
    const authenticatorMap = {
      microsoft: { authenticator: "OpenIDConnectAuthenticator", idp: "Microsoft" },
      google: { authenticator: "GoogleOIDCAuthenticator", idp: "Google" },
      oidc: { authenticator: "OpenIDConnectAuthenticator", idp: "MyOIDCConnection" },
    };

    const newOption = authenticatorMap[providerName];
    const updatedSteps = sequence.steps.map((step) => {
      if (step.id === 1) {
        const options = step.options || [];
        const alreadyExists = options.some(
          (opt) => opt.idp === newOption.idp && opt.authenticator === newOption.authenticator
        );
        if (!alreadyExists) {
          options.push(newOption);
        }
        return { ...step, options };
      }
      return step;
    });
    return { ...sequence, steps: updatedSteps };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    let body;

    if (provider === "microsoft") {
      body = {
        image: "assets/images/logos/microsoft.svg",
        isPrimary: false,
        roles: { mappings: [], outboundProvisioningRoles: [] },
        name: "Microsoft",
        certificate: { certificates: [] },
        claims: {
          userIdClaim: { uri: "http://wso2.org/claims/username" },
          roleClaim: { uri: "http://wso2.org/claims/role" },
          provisioningClaims: [],
        },
        description: "Enable login for users with existing Microsoft accounts.",
        alias: "https://localhost:9444/oauth2/token",
        homeRealmIdentifier: "",
        provisioning: {
          jit: { userstore: "DEFAULT", scheme: "PROVISION_SILENTLY", isEnabled: true },
        },
        federatedAuthenticators: {
          defaultAuthenticatorId: "T3BlbklEQ29ubmVjdEF1dGhlbnRpY2F0b3I",
          authenticators: [
            {
              isEnabled: true,
              authenticatorId: "T3BlbklEQ29ubmVjdEF1dGhlbnRpY2F0b3I",
              properties: [
                { value: clientId, key: "ClientId" },
                { value: clientSecret, key: "ClientSecret" },
                { value: `https://api.asgardeo.io/o/${organizationId}/commonauth`, key: "callbackUrl" },
                { value: "email openid profile", key: "Scopes" },
                { value: "", key: "commonAuthQueryParams" },
                { value: "true", key: "UsePrimaryEmail" },
                { value: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", key: "OAuth2AuthzEPUrl" },
                { value: "https://login.microsoftonline.com/common/oauth2/v2.0/token", key: "OAuth2TokenEPUrl" },
              ],
            },
          ],
        },
        isFederationHub: false,
        templateId: "microsoft-idp",
      };
    } else if (provider === "google") {
      body = {
        image: "assets/images/logos/google.svg",
        isPrimary: false,
        roles: { mappings: [], outboundProvisioningRoles: [] },
        name: "Google",
        certificate: { certificates: [] },
        claims: {
          userIdClaim: { uri: "http://wso2.org/claims/username" },
          roleClaim: { uri: "http://wso2.org/claims/role" },
          provisioningClaims: [],
        },
        description: "Login users with existing Google accounts.",
        alias: "https://localhost:9444/oauth2/token",
        homeRealmIdentifier: "",
        provisioning: {
          jit: { userstore: "DEFAULT", scheme: "PROVISION_SILENTLY", isEnabled: true },
        },
        federatedAuthenticators: {
          defaultAuthenticatorId: "R29vZ2xlT0lEQ0F1dGhlbnRpY2F0b3I",
          authenticators: [
            {
              isEnabled: true,
              authenticatorId: "R29vZ2xlT0lEQ0F1dGhlbnRpY2F0b3I",
              properties: [
                { value: clientId, key: "ClientId" },
                { value: clientSecret, key: "ClientSecret" },
                { value: `https://api.asgardeo.io/o/${organizationId}/commonauth`, key: "callbackUrl" },
                { value: "scope=email openid profile", key: "AdditionalQueryParameters" },
              ],
            },
          ],
        },
        isFederationHub: false,
        templateId: "google-idp",
      };
    } else if (provider === "oidc") {
      body = {
        image: "assets/images/logos/enterprise.svg",
        isPrimary: false,
        roles: { mappings: [], outboundProvisioningRoles: [] },
        certificate: { jwksUri: "", certificates: [""] },
        claims: {
          userIdClaim: { uri: "" },
          provisioningClaims: [],
          roleClaim: { uri: "" },
        },
        name: "MyOIDCConnection",
        description: "Authenticate users with Enterprise OIDC connections.",
        federatedAuthenticators: {
          defaultAuthenticatorId: "T3BlbklEQ29ubmVjdEF1dGhlbnRpY2F0b3I",
          authenticators: [
            {
              isEnabled: true,
              authenticatorId: "T3BlbklEQ29ubmVjdEF1dGhlbnRpY2F0b3I",
              properties: [
                { key: "ClientId", value: clientId },
                { key: "ClientSecret", value: clientSecret },
                { key: "OAuth2AuthzEPUrl", value: authorizeUrl },
                { key: "OAuth2TokenEPUrl", value: tokenUrl },
                { key: "callbackUrl", value: `https://api.asgardeo.io/o/${organizationId}/commonauth` },
              ],
            },
          ],
        },
        homeRealmIdentifier: "",
        provisioning: {
        jit: { userstore: "DEFAULT", scheme: "PROVISION_SILENTLY", isEnabled: true },
        },
        isFederationHub: false,
        templateId: "enterprise-oidc-idp",
      };
    }

    try {
      await request({
        method: "POST",
        url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/identity-providers`,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        data: body,
      }).then((response) => {
          // eslint-disable-next-line no-console
          console.log(response);
      })

      const appData = await fetchAppConfig();
      const updatedSequence = addAuthenticatorToStep1(appData.authenticationSequence, provider);
      const applicationId = await getAppId();
        await request({
        method: "PATCH",
        url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/applications/${applicationId}`,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        data: { authenticationSequence: updatedSequence },
      });
      if (onIdpAdded) onIdpAdded();
    } catch (error) {
      enqueueSnackbar("Something went wrong while creating idp", { variant: "error" });
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <TextField
          select
          label="Provider"
          fullWidth
          margin="normal"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <MenuItem value="microsoft">Microsoft</MenuItem>
          <MenuItem value="google">Google</MenuItem>
          <MenuItem value="oidc">OIDC</MenuItem>
        </TextField>

        <TextField
          label="Client ID"
          fullWidth
          margin="normal"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          required
          className="mui-text-field"
        />

        <TextField
          label="Client Secret"
          type="password"
          fullWidth
          margin="normal"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          required
        />

        {provider === "oidc" && (
          <>
          <TextField
          label="Authorize URL"
          fullWidth
          margin="normal"
          value={authorizeUrl}
          onChange={(e) => setAuthorizeUrl(e.target.value)}
          required
          />

          <TextField
          label="Token URL"
          fullWidth
          margin="normal"
          value={tokenUrl}
          onChange={(e) => setTokenUrl(e.target.value)}
          required
          />
          </>
          )}

          <div className="form-buttons">
            <button type="submit" style={{ marginTop: "15px", marginBottom: "10px" }} className="gold-button" disabled={loading}>
              {loading ? "Creating..." : `Create ${provider} IDP`}
            </button>
            <button type="button" className="black-button" onClick={onCancel}>Cancel</button>
          </div>
        </form>
        </>
  );
}

IDPForm.propTypes = {
  organizationId: PropTypes.string.isRequired,
  onIdpAdded: PropTypes.func.isRequired,
  fetchAppConfig: PropTypes.func.isRequired,
  getAppId: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired
};

export default IDPForm;