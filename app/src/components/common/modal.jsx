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

import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import PropTypes from "prop-types";

/**
 * @param {object} props
 * @param {boolean} [props.isOpen]
 * @param {() => void} props.handleClose
 * @param {string} props.primaryActionText
 * @param {() => void} props.primaryActionHandler
 * @param {string} [props.secondaryActionText]
 * @param {() => void} [props.secondaryActionHandler]
 * @param {string} props.title
 * @param {string} props.message
 * @param {boolean} [props.disableEscapeKeyDown]
 */
const Modal = ({
  isOpen = false,
  handleClose,
  primaryActionText,
  primaryActionHandler,
  secondaryActionText,
  secondaryActionHandler,
  title,
  message,
  disableEscapeKeyDown = true,
}) => {
  return (
    <Dialog
      className="dialog-box"
      open={isOpen}
      onClose={handleClose}
      disableEscapeKeyDown={disableEscapeKeyDown}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <p>{message}</p>
      </DialogContent>
      <DialogActions className="dialog-actions">
        {secondaryActionText && (
          <button className="secondary" onClick={secondaryActionHandler}>
            {secondaryActionText}
          </button>
        )}
        <button onClick={primaryActionHandler} autoFocus>
          {primaryActionText}
        </button>
      </DialogActions>
    </Dialog>
  );
};

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  handleClose: PropTypes.func.isRequired,
  primaryActionText: PropTypes.string.isRequired,
  primaryActionHandler: PropTypes.func.isRequired,
  secondaryActionText: PropTypes.string,
  secondaryActionHandler: PropTypes.func,
  title: PropTypes.string.isRequired,
  message: PropTypes.string.isRequired,
  disableEscapeKeyDown: PropTypes.bool,
};

export default Modal;
