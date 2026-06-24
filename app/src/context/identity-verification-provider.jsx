import { FEATURE_MAP } from "../constants/feature-constants";
import { createContext, useState } from "react";
import { environmentConfig, isFeatureEnabled } from "../util/environment-util";
import { useAsgardeo } from "@asgardeo/react";
import { useSnackbar } from "notistack";
import { useEffect } from "react";
import { getVerificationStatus } from "../api/identity-verification";
import { useMemo } from "react";
import { IDENTITY_VERIFICATION_STATUS } from "../constants/app-constants";

const IdentityVerificationContext = createContext(/** @type {any} */ (null));

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 */
const IdentityVerificationProvider = ({ children }) => {
  const isIdentityVerificationEnabled = isFeatureEnabled(
    FEATURE_MAP.IDENTITY_VERIFICATION
  );

  const verifiableClaims = environmentConfig.IDENTITY_VERIFICATION_CLAIMS || [];

  const { isSignedIn } = useAsgardeo();
  const { enqueueSnackbar } = useSnackbar();

  const [isIdVStatusLoading, setIsIdVStatusLoading] = useState(true);
  const [idvClaims, setIdvClaims] = useState(/** @type {any[]} */ ([]));

  const fetchIdentityVerificationStatus = async () => {
    setIsIdVStatusLoading(true);
    try {
      const response = await getVerificationStatus();
      setIdvClaims(response);
    } catch (error) {
      console.error(error);
      enqueueSnackbar(
        "Something went wrong while getting identity verification status",
        {
          variant: "error",
        }
      );
    } finally {
      setIsIdVStatusLoading(false);
    }
  };

  useEffect(() => {
    if (!isIdentityVerificationEnabled || !isSignedIn) {
      return;
    }

    fetchIdentityVerificationStatus();
  }, [isSignedIn]);

  const identityVerificationStatus = useMemo(() => {
    if (idvClaims) {
      if (
        verifiableClaims.every((claimUri) => {
          return idvClaims.some(
            (idvClaim) =>
              idvClaim.uri === claimUri && idvClaim.isVerified === true
          );
        })
      ) {
        return IDENTITY_VERIFICATION_STATUS.SUCCESS;
      }

      for (const claim of verifiableClaims) {
        if (
          idvClaims.some(
            (idvClaim) =>
              idvClaim.uri === claim && idvClaim.isVerified === undefined
          )
        ) {
          return IDENTITY_VERIFICATION_STATUS.NOT_STARTED;
        }

        if (
          idvClaims.some(
            (idvClaim) =>
              idvClaim.uri === claim &&
              idvClaim.claimMetadata.onfido_workflow_status === "processing"
          )
        ) {
          return IDENTITY_VERIFICATION_STATUS.IN_PROGRESS;
        }

        if (
          idvClaims.some(
            (idvClaim) =>
              idvClaim.uri === claim &&
              idvClaim.claimMetadata.onfido_workflow_status === "declined"
          )
        ) {
          return IDENTITY_VERIFICATION_STATUS.FAILED;
        }
      }

      return IDENTITY_VERIFICATION_STATUS.NOT_STARTED;
    }
  }, [idvClaims]);

  const handleStartIdentityVerification = () => {
    let reInitiate = false;

    if (idvClaims && idvClaims.length > 0) {
      idvClaims.forEach((claim) => {
        if (claim.claimMetadata.onfido_workflow_status === "awaiting_input") {
          reInitiate = true;
        }
      });
    }

    return reInitiate;
  };

  return (
    <IdentityVerificationContext.Provider
      value={{
        isIdentityVerificationEnabled,
        isIdVStatusLoading,
        identityVerificationStatus,
        startIdentityVerification: handleStartIdentityVerification,
        reloadIdentityVerificationStatus: fetchIdentityVerificationStatus,
      }}
    >
      {children}
    </IdentityVerificationContext.Provider>
  );
};

IdentityVerificationProvider.propTypes = {
  children: "node",
};

export { IdentityVerificationContext, IdentityVerificationProvider };
