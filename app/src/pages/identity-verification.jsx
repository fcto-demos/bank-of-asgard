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

import { useLocation } from "react-router";
import {
  completeVerification,
  initiateVerification,
  reinitiateVerification,
} from "../api/identity-verification";
import { Onfido } from "onfido-sdk-ui";
import { useNavigate } from "react-router";
import { useState } from "react";
import { useEffect } from "react";
import { useSnackbar } from "notistack";
import { ROUTES } from "../constants/app-constants";
import { useContext } from "react";
import { IdentityVerificationContext } from "../context/identity-verification-provider";

const IdentityVerificationPage = () => {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const location = useLocation();
  const reInitiate = location.state?.reInitiate === true;

  const { reloadIdentityVerificationStatus } = useContext(IdentityVerificationContext);

  const [onfidoInstance, setOnfidoInstance] = useState(/** @type {any} */ (null));
  const [isLoading, setIsLoading] = useState(true);

  const initIdentityVerification = async () => {
    setIsLoading(true);
    try {
      let response;

      if (reInitiate) {
        response = await reinitiateVerification();
      } else {
        response = await initiateVerification();
      }

      const token = response?.claims?.[0]?.claimMetadata?.sdk_token;
      const workflowRunId =
        response?.claims?.[0]?.claimMetadata?.onfido_workflow_run_id;

      if (!token || !workflowRunId) {
        const missingItem = !token ? "SDK token" : "Workflow run ID";
        throw new Error(
          `${missingItem} not found in the identity verification initiation response from the Identity server`
        );
      }

      const instance = Onfido.init({
        // @ts-ignore
        useModal: false,
        token,
        onComplete: () => {
          completeVerification()
            .then(() => {
              enqueueSnackbar(
                "Identity verification request is successfully submitted",
                {
                  variant: "success",
                }
              );
              reloadIdentityVerificationStatus();
            })
            .catch((error) => {
              console.error(error);
              enqueueSnackbar(
                "Something went wrong while completing identity verification. Please try again.",
                {
                  variant: "error",
                }
              );
            })
            .finally(() => {
              navigate(ROUTES.HOME, {
                state: { idVerificationInitiated: true },
              });
            });
        },
        workflowRunId,
      });
      setOnfidoInstance(instance);
    } catch (/** @type {any} */ error) {
      console.error(error);
      if (
        error.response?.status === 400 &&
        error.response?.data?.code === "OIDV-10002"
      ) {
        enqueueSnackbar(
          "Please verify whether all the required attributes are provided",
          {
            variant: "error",
          }
        );
      } else {
        enqueueSnackbar(
          "Something went wrong while starting identity verification",
          {
            variant: "error",
          }
        );
      }
      navigate(ROUTES.HOME);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initIdentityVerification();

    // Clean up the onfido instance.
    return () => {
      onfidoInstance && onfidoInstance.tearDown();
    };
  }, []);

  return (
    <div className="identity-verification-page">
      {isLoading && (
        <div className="loading-container">
          <div className="spinner-border text-dark" role="status">
            <span>Loading...</span>
          </div>
        </div>
      )}
      {!isLoading && onfidoInstance && (
        <div className="onfido-samples">
          <p>
            Testing with sample documents? Download the sample documents from
            the links below.
          </p>
          <ul>
            <li>
              <a
                href="https://documentation.onfido.com/images/sample_driving_licence.png"
                target="_blank"
                rel="noreferrer"
              >
                Sample driving license
              </a>{" "}
              - You can use this for the front and back of your driving license.
            </li>
            <li>
              <a
                href="https://documentation.onfido.com/images/sample_photo.png"
                target="_blank"
                rel="noreferrer"
              >
                Sample photo
              </a>{" "}
              - Take a photo of this using your mobile phone. And use it as the
              selfie photo.
            </li>
          </ul>
        </div>
      )}
      <div id="onfido-mount"></div>
    </div>
  );
};

export default IdentityVerificationPage;
