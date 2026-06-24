import { useState, useEffect, useRef, useMemo } from "react";
import { useAsgardeo } from "@asgardeo/react";
import PropTypes from "prop-types";
import { useSnackbar } from "notistack";
import { getPasswordPolicy } from "../../api/server-configurations";
import PasswordField from "../common/password-field";
import { resetPassword } from "../../api/profile";

/**
 * @param {object} props
 * @param {string} props.username
 * @param {() => void} props.onFormClosed
 */
const ResetPasswordForm = ({ username, onFormClosed }) => {
  const { enqueueSnackbar } = useSnackbar();
  const { signOut } = useAsgardeo();

  const initialFormData = {
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  };
  const [formData, setFormData] = useState(initialFormData);
  const [passwordValidationRules, setPasswordValidationRules] = useState({});
  const [isNewPasswordValid, setIsNewPasswordValid] = useState(false);

  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  const isFormValid = useMemo(() => {
    if (
      formData.currentPassword &&
      formData.newPassword &&
      formData.confirmNewPassword
    ) {
      if (
        isNewPasswordValid &&
        formData.newPassword === formData.confirmNewPassword
      ) {
        return true;
      }
    }
    return false;
  }, [
    formData.currentPassword,
    formData.newPassword,
    formData.confirmNewPassword,
    isNewPasswordValid,
  ]);

  useEffect(() => {
    getPasswordPolicy()
      .then((response) => {
        setPasswordValidationRules(response);
      })
      .catch((error) => {
        console.error("Error fetching password policy:", error);
      });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCancel = () => {
    setFormData(initialFormData);
    onFormClosed();
  };

  const handleSubmit = (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();

    if (isFormValid) {
      resetPassword(username, formData.currentPassword, formData.newPassword)
        .then(() => {
          enqueueSnackbar("Password reset successfully", {
            variant: "success",
          });
          handleCancel();
          signOut();
        })
        .catch((error) => {
          if (!error.response || error.response.status === 401) {
            enqueueSnackbar("The current password you entered appears to be invalid. Please try again", {
              variant: "error",
            });
            return;
          }

          if (error?.response?.status === 400) {
            enqueueSnackbar("This password has been used in recent history. Please choose a different password.", {
              variant: "error",
            });
            return;
          }

          enqueueSnackbar("Something went wrong while resetting password", {
            variant: "error",
          });
        });
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="contact_form-container profile-edit"
    >
      <ul className="details-list">
        <li>
          <label>Current Password:</label>
          <PasswordField
            name="currentPassword"
            placeholder="Current Password"
            value={formData.currentPassword}
            onChange={(value) =>
              setFormData({ ...formData, currentPassword: value })
            }
            showPasswordValidation={false}
            inputProps={{ ref: inputRef }}
          />
        </li>
        <li>
          <label>New Password:</label>
          <PasswordField
            name="newPassword"
            placeholder="New Password"
            value={formData.newPassword}
            onChange={(value) =>
              setFormData({ ...formData, newPassword: value })
            }
            showPasswordValidation={true}
            passwordValidationRules={passwordValidationRules}
            onPasswordValidate={(isValid) => {
              setIsNewPasswordValid(isValid);
            }}
          />
        </li>
        <li>
          <label>Confirm New Password:</label>
          <PasswordField
            name="confirmNewPassword"
            placeholder="Confirm New Password"
            value={formData.confirmNewPassword}
            onChange={(value) =>
              setFormData({ ...formData, confirmNewPassword: value })
            }
            showPasswordValidation={false}
          />
        </li>
        <li>
          <div>
            <button className="secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className={`btn ${isFormValid ? "" : "disabled"}`}
              autoFocus
            >
              Update Password
            </button>
          </div>
        </li>
      </ul>
    </form>
  );
};

ResetPasswordForm.propTypes = {
  onFormClosed: PropTypes.func.isRequired,
  username: PropTypes.string.isRequired,
};

export default ResetPasswordForm;
