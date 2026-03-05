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
import {
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  Tooltip,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { environmentConfig } from "../../util/environment-util";
import { useAsgardeo, useOrganization, useUser } from "@asgardeo/react";
import IDPForm from "./idp-form";
import PropTypes from "prop-types";
import { enqueueSnackbar } from "notistack";
import { useHttpSwitch } from "../../sdk/httpSwitch";

const IDPList = () => {

  const [ idps, setIdps ] = useState([]);
  const [ loading, setLoading ] = useState(true);
  const [ openForm, setOpenForm ] = useState(false);
  const { isSignedIn } = useAsgardeo();
  const { myOrganizations } = useOrganization();
  const { flattenedProfile } = useUser();
  const [ organizationId, setOrganizationId ] = useState("");
  const [ deletingIdpId, setDeletingIdpId ] = useState(null);
  const [ mfaOptions, setMfaOptions ] = useState({
    totp: false,
    emailOTP: false,
  });
  const [loadingMFA, setLoadingMFA] = useState(false);
  const httpSwitch = useHttpSwitch();
  const cache = { applicationId: null };

  const request = (requestConfig) =>
    httpSwitch.request(requestConfig)
      .then((response) => response)
      .catch((error) => error);

  const fetchIdps = async () => {
    try {
      setLoading(true);
      const response = await request({
        url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/identity-providers`,
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      setIdps(response.data?.identityProviders || []);
    } catch (err) {
      enqueueSnackbar("Something went wrong while fetching IdPs", { variant: "error" });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getAppId = async () => {
    if (cache.applicationId) {
      return cache.applicationId;
    }

    const response = await request({
      method: "GET",
      url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/applications?filter=name%20eq%20${encodeURIComponent(environmentConfig.APP_NAME)}`,
      headers: {
        Accept: "application/json",
      },
    });

    if (response?.data?.applications?.length > 0) {
      cache.applicationId = response.data.applications[0].id;
      return cache.applicationId;
    } else {
      enqueueSnackbar("Something went wrong while fetching app details", { variant: "error" });
    }
  };

  const fetchAppConfig = async () => {
    const applicationId = await getAppId();
    const response = await request({
      method: "GET",
      url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/applications/${applicationId}`,
      headers: { Accept: "application/json" },
    });
    return response.data;
  };

  const removeAuthenticatorFromStep1 = (sequence, idpName) => {
    const updatedSteps = sequence.steps.map((step) => {
      if (step.id === 1) {
        return {
          ...step,
          options: (step.options || []).filter((opt) => opt.idp !== idpName),
        };
      }
      return step;
    });
    return { ...sequence, steps: updatedSteps };
  };

  const deleteIdp = async (id, name) => {
    setDeletingIdpId(id);
    try {
    const appData = await fetchAppConfig();
    const applicationId = await getAppId();
    const updatedSequence = removeAuthenticatorFromStep1(appData.authenticationSequence, name);

    await request({
      method: "PATCH",
      url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/applications/${applicationId}`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      data: { authenticationSequence: updatedSequence },
    });
      await request(
        {
          url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/identity-providers/${id}?force=false`,
          method: "DELETE",
          headers: {
            Accept: "*/*",
          },
        }
      );
      setIdps(idps.filter((idp) => idp.id !== id));
    } catch (err) {
      enqueueSnackbar("Something went wrong while deleting IdP", { variant: "error" });
      console.error(err);
    } finally {
      setDeletingIdpId(null);
    }
  };

  const handleOptionChange = (e) => {
    const { name, checked } = e.target;
    setMfaOptions({ ...mfaOptions, [name]: checked });
  };

  const fetchMFA = async () => {
    try {
      setLoadingMFA(true);
      const applicationId = await getAppId();
      const response = await request({
        method: "GET",
        url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/applications/${applicationId}/authenticators`,
        headers: {
          Accept: "application/json",
        },
      });
      const steps = response.data || [];
      const step2 = steps.find((step) => step.stepId === 2);
      const options = { totp: false, emailOTP: false };
      if (step2) {
        const localAuths = step2.localAuthenticators || [];
        if (localAuths.some((auth) => auth.type === "totp")) {
          options.totp = true;
        }
        if (localAuths.some((auth) => auth.type === "email-otp-authenticator")) {
          options.emailOTP = true;
        }
      }

      setMfaOptions(options);
    } catch (err) {
      console.error("Error fetching MFA config:", err);
      enqueueSnackbar("Failed to load MFA settings.", { variant: "error" });
    } finally {
      setLoadingMFA(false);
    }
  };

  const handleSave = async () => {
    setLoadingMFA(true);

    try {
      const appData = await fetchAppConfig();
      const applicationId = await getAppId();
      const existingSteps = appData.authenticationSequence.steps || [];

      const step1 = existingSteps.find(step => step.id === 1) || {
        id: 1,
        options: []
      };

      const step2Options = [];
      if (mfaOptions.totp) step2Options.push({ authenticator: "totp", idp: "LOCAL" });
      if (mfaOptions.emailOTP) step2Options.push({ authenticator: "email-otp-authenticator", idp: "LOCAL" });

      const steps = [step1];
      if (step2Options.length > 0) {
        steps.push({
          id: 2,
          options: step2Options
        });
      }

      const payload = {
        authenticationSequence: {
          attributeStepId: 1,
          requestPathAuthenticators: [],
          steps: steps,
          subjectStepId: 1,
          type: "USER_DEFINED",
          script: ""
        }
      };


    const response = await request({
      method: "PATCH",
      url: `${environmentConfig.IDP_BASE_URL}/o/api/server/v1/applications/${applicationId}`,
      data: payload,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });

    if (response.status != 200) throw new Error(`Failed to update MFA: ${response.statusText}`);
      enqueueSnackbar("MFA settings updated successfully!", { variant: "success" });
    } catch (err) {
      console.error(err);
      enqueueSnackbar("Something went wrong while saving MFA settings.", { variant: "error" });
    } finally {
      setLoadingMFA(false);
    }
  };

  useEffect(() => {
    fetchIdps();
    fetchMFA();
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
        return;
    }
    const businessOrg = myOrganizations.find(
      (org) => org.name === flattenedProfile?.businessName
    );
    if (!businessOrg) {
        return;
    }
    setOrganizationId(businessOrg.id);
  }, []);

  return (
    <>
    <div className="mfa-settings box-zone">
      <h5>Configure Authentication</h5>
      <label className="mfa-label">Identity Provider</label>
      {loading ? (
        <CircularProgress />
      ) : idps.length === 0 ? (
        <Typography align="center" sx={{ mt: 2, mb: 2 }} >
            No IdP configured
        </Typography>
      ) : (
        <List>
          {idps.map((idp) => (
            <ListItem
              key={idp.id}
              secondaryAction={
                deletingIdpId === idp.id ? (
                  <CircularProgress size={24} />
                ) : (
                  <IconButton edge="end" onClick={() => deleteIdp(idp.id, idp.name)}>
                    <DeleteIcon color="error" />
                  </IconButton>
                )
              }
              >
                <ListItemText
                  primary={idp.name}
                  secondary={idp.description}
                />
              </ListItem>
          ))}
        </List>
      )}

      <Tooltip title={idps.length >= 1 ? "Only 1 Identity Provider is allowed per business account." : ""} arrow>
        <span>
          <button
            onClick={() => setOpenForm(true)}
            className="gold-button"
            disabled={idps.length >= 1}
          >
            Add Identity Provider
          </button>
        </span>
      </Tooltip>

      <label className="mfa-label">Enable MFA</label>
      <div className="mfa-options">
        <label>
          <input
            type="checkbox"
            name="totp"
            checked={mfaOptions.totp}
            onChange={handleOptionChange}
          />
            TOTP
        </label>
        <label>
          <input
            type="checkbox"
            name="emailOTP"
            checked={mfaOptions.emailOTP}
            onChange={handleOptionChange}
          />
          Email OTP
        </label>
      </div>
      <button onClick={handleSave} disabled={loadingMFA} className="edit-button secondary">
        {loadingMFA ? "Saving..." : "Save"}
      </button>

      <Dialog open={openForm} onClose={() => setOpenForm(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Identity Provider</DialogTitle>
        <DialogContent>
          <IDPForm organizationId={organizationId} onIdpAdded={() => {
            fetchIdps();
            setOpenForm(false);
          }} getAppId={getAppId} fetchAppConfig={fetchAppConfig} onCancel={() => setOpenForm(false)}/>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}

IDPList.propTypes = {
  organizationId: PropTypes.string.isRequired,
};

export default IDPList;
