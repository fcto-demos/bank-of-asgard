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
import propTypes from "prop-types";
import PasswordPolicyIndicator from "./password-policy-indicator";

/**
 * @param {object} props
 * @param {string} props.name
 * @param {string} props.placeholder
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {boolean} [props.showPasswordValidation]
 * @param {object} [props.passwordValidationRules]
 * @param {(isValid: boolean) => void} [props.onPasswordValidate]
 * @param {object} [props.inputProps]
 */
const PasswordField = ({
  name,
  placeholder,
  value,
  onChange,
  showPasswordValidation = true,
  passwordValidationRules = {},
  onPasswordValidate = (/** @type {boolean} */ _isValid) => {},
  inputProps = {},
}) => {
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <div className="password-field-wrapper with-icon">
      <i
        className={`icon fa ${passwordVisible ? "fa-eye" : "fa-eye-slash"}`}
        onClick={() => setPasswordVisible(!passwordVisible)}
      ></i>
      <input
        type={passwordVisible ? "text" : "password"}
        className="password-field"
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...inputProps}
      />
      {showPasswordValidation && (
        <PasswordPolicyIndicator
          password={value}
          onPasswordValidate={onPasswordValidate}
          {...passwordValidationRules}
        />
      )}
    </div>
  );
};

PasswordField.propTypes = {
  name: propTypes.string.isRequired,
  placeholder: propTypes.string.isRequired,
  value: propTypes.string.isRequired,
  onChange: propTypes.func.isRequired,
  showPasswordValidation: propTypes.bool,
  passwordValidationRules: propTypes.object,
  inputProps: propTypes.object,
  onPasswordValidate: propTypes.func,
};

export default PasswordField;
