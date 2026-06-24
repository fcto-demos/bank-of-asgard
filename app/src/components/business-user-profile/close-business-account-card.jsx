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
import { useAsgardeo } from "@asgardeo/react";
import { useSnackbar } from "notistack";
import Modal from "../common/modal";
import { closeBusinessAccount } from "../../api/profile";

/**
 * @param {object} props
 * @param {string} props.businessName
 */
const CloseBusinessAccountCard = ({ businessName }) => {
  const { signOut, getAccessToken } = useAsgardeo();
  const { enqueueSnackbar } = useSnackbar();

  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);

  const handleAccountClose = async () => {
    try {
      setIsConfirmationOpen(false);
      const token = await getAccessToken();
      const response = await closeBusinessAccount(businessName, token);

      if (response.status == 200) {
        setIsSuccessModalOpen(true);
      }
    } catch (err) {
      console.error("Error Closing Account:", err);
      enqueueSnackbar("Something went wrong while closing account", {
        variant: "error",
      });
    }
  };

  const onSuccessModalClose = () => {
    setIsSuccessModalOpen(false);
    signOut();
  };

  return (
    <>
      <div className="danger-zone">
        <h5>Close Business Account</h5>
        <p>
          Once you close the account, you cannot recover it again. All business and
          user information will be lost.
        </p>
        <div>
          <button
            onClick={() => setIsConfirmationOpen(true)}
            className="close-account-button"
          >
            Close
          </button>
        </div>
      </div>
      <Modal
        isOpen={isConfirmationOpen}
        handleClose={() => setIsConfirmationOpen(false)}
        primaryActionText="Close Account"
        primaryActionHandler={() => handleAccountClose()}
        secondaryActionText="Cancel"
        secondaryActionHandler={() => setIsConfirmationOpen(false)}
        title={"Are you sure?"}
        message={
          "Are you sure you want to close your account? This action cannot be undone."
        }
      />
      <Modal
        isOpen={isSuccessModalOpen}
        handleClose={() => onSuccessModalClose()}
        title={"Account Closed"}
        message={
          "Your account has been closed successfully. You will be signed out."
        }
        primaryActionText="OK"
        primaryActionHandler={() => onSuccessModalClose()}
      />
    </>
  );
};

CloseBusinessAccountCard.propTypes = {
  businessName: PropTypes.string.isRequired
};

export default CloseBusinessAccountCard;
