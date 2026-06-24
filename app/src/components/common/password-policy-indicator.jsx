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

import PropTypes from "prop-types";
import { useEffect, useState } from "react";

const PasswordPolicyIndicator = (/** @type {any} */ props) => {
  const {
    minLength = 8,
    maxLength = 64,
    minUpperCase = 1,
    minLowerCase = 1,
    minNumbers = 1,
    minSpecialChr = 0,
    minUniqueChr = 0,
    maxConsecutiveChr,
    password,
    onPasswordValidate,
  } = props;

  const [validationStatus] = useState(/** @type {any} */ ({}));
  const lowerCaseLetters = /[a-z]/g;
  const upperCaseLetters = /[A-Z]/g;
  const numbers = /[0-9]/g;
  const chars = /[!#$%&'()*+,\-./:;<=>?@[\]^_{|}~]/g;
  const consecutive = /([^])\1+/g;
  const EMPTY_STRING = "";

  const translations = {
    case: `At least ${minUpperCase} uppercase and ${minLowerCase} lowercase characters`,
    consecutiveChr: `No more than ${maxConsecutiveChr} repeating characters`,
    length: `Must be between ${minLength} and ${maxLength} characters`,
    numbers: `At least ${minNumbers} of the numbers 0-9`,
    specialChr: `At least ${minSpecialChr} of the symbols !@#$%^&*`,
    uniqueChr: `At least ${minUniqueChr} unique characters`,
  };

  useEffect(() => {
    validate(password);
  }, [password]);

  const validate = (/** @type {string} */ password) => {
    let _validationStatus = /** @type {any} */ ({ ...validationStatus });

    if (password === EMPTY_STRING) {
      _validationStatus = { ..._validationStatus, empty: true };
      onPasswordValidate(false, _validationStatus);
      return;
    }

    if (password.length >= minLength && password.length <= maxLength) {
      _validationStatus.length = true;
    }
    const upperCaseMatches = password.match(upperCaseLetters);
    const lowerCaseMatches = password.match(lowerCaseLetters);
    if (
      (minUpperCase <= 0 ||
        (upperCaseMatches && upperCaseMatches.length >= minUpperCase)) &&
      (minLowerCase <= 0 ||
        (lowerCaseMatches && lowerCaseMatches.length >= minLowerCase))
    ) {
      _validationStatus.case = true;
    }
    const numberMatches = password.match(numbers);
    if (
      minNumbers <= 0 ||
      (numberMatches && numberMatches.length >= minNumbers)
    ) {
      _validationStatus.numbers = true;
    }
    const charsMatches = password.match(chars);
    if (
      minSpecialChr <= 0 ||
      (charsMatches && charsMatches.length >= minSpecialChr)
    ) {
      _validationStatus.specialChr = true;
    }

    const unique = password.split("");
    const set = new Set(unique);

    if (minUniqueChr <= 0 || set.size >= minUniqueChr) {
      _validationStatus.uniqueChr = true;
    }

    let _consValid = true;
    const consecutiveMatches = password.match(consecutive);
    if (consecutiveMatches && consecutiveMatches.length > 0) {
      const largest = consecutiveMatches
        .sort((/** @type {string} */ a, /** @type {string} */ b) => b.length - a.length)[0];
      if (maxConsecutiveChr >= 1 && largest.length > maxConsecutiveChr) {
        _consValid = false;
      }
    }
    if (_consValid) {
      _validationStatus.consecutiveChr = true;
    }

    const isValid =
      !_validationStatus.empty &&
      _validationStatus.length &&
      _validationStatus.numbers &&
      _validationStatus.case &&
      _validationStatus.specialChr &&
      _validationStatus.uniqueChr &&
      _validationStatus.consecutiveChr;

    onPasswordValidate(isValid, _validationStatus);
  };

  const getIconProps = (/** @type {string} */ id) => {
    const DEFAULT = { iconCssClassName: "fa-times", textCssClassName: "" };
    const POSITIVE = {
      iconCssClassName: "fa-check",
      textCssClassName: "success",
    };
    const NEGATIVE = {
      iconCssClassName: "fa-times",
      textCssClassName: "error",
    };

    if (id === "password-validation-length") {
      if (password === EMPTY_STRING) return DEFAULT;
      return password.length >= minLength && password.length <= maxLength
        ? POSITIVE
        : NEGATIVE;
    }
    if (id === "password-validation-case") {
      if (password === EMPTY_STRING) return DEFAULT;
      return (minUpperCase <= 0 ||
        (password.match(upperCaseLetters) &&
          password.match(upperCaseLetters).length >= minUpperCase)) &&
        (minLowerCase <= 0 ||
          (password.match(lowerCaseLetters) &&
            password.match(lowerCaseLetters).length >= minLowerCase))
        ? POSITIVE
        : NEGATIVE;
    }
    if (id === "password-validation-number") {
      if (password === EMPTY_STRING) return DEFAULT;
      return password.match(numbers) &&
        password.match(numbers).length >= minNumbers
        ? POSITIVE
        : NEGATIVE;
    }
    if (id === "password-validation-chars") {
      if (password === EMPTY_STRING) return DEFAULT;
      return password.match(chars) &&
        password.match(chars).length >= minSpecialChr
        ? POSITIVE
        : NEGATIVE;
    }
    return DEFAULT;
  };

  return (
    <ul className="password-policy-indicator">
      {(minLength > 0 || maxLength > 0) && (
        <li
          className={`"password-policy-description ${
            getIconProps("password-validation-length").textCssClassName
          }`}
        >
          <i
            className={`fa ${
              getIconProps("password-validation-length").iconCssClassName
            }`}
          ></i>
          {translations.length}
        </li>
      )}
      {(minUpperCase > 0 || minLowerCase > 0) && (
        <li
          className={`"password-policy-description ${
            getIconProps("password-validation-case").textCssClassName
          }`}
        >
          <i
            className={`fa ${
              getIconProps("password-validation-case").iconCssClassName
            }`}
          ></i>
          {translations.case}
        </li>
      )}
      {minNumbers > 0 && (
        <div className="password-policy-description">
          <li
            className={`"password-policy-description ${
              getIconProps("password-validation-number").textCssClassName
            }`}
          >
            <i
              className={`fa ${
                getIconProps("password-validation-number").iconCssClassName
              }`}
            ></i>
            {translations.numbers}
          </li>
        </div>
      )}
      {minSpecialChr > 0 && (
        <div className="password-policy-description">
          <li
            className={`"password-policy-description ${
              getIconProps("password-validation-chars").textCssClassName
            }`}
          >
            <i
              className={`fa ${
                getIconProps("password-validation-chars").iconCssClassName
              }`}
            ></i>
            {translations.specialChr}
          </li>
        </div>
      )}
      {minUniqueChr > 0 && (
        <div className="password-policy-description">
          <li
            className={`"password-policy-description ${
              getIconProps("password-validation-unique-chars").textCssClassName
            }`}
          >
            <i
              className={`fa ${
                getIconProps("password-validation-unique-chars")
                  .iconCssClassName
              }`}
            ></i>
            {translations.uniqueChr}
          </li>
        </div>
      )}
      {maxConsecutiveChr > 0 && (
        <div className="password-policy-description">
          <li
            className={`"password-policy-description ${
              getIconProps("password-validation-cons-chars").textCssClassName
            }`}
          >
            <i
              className={`fa ${
                getIconProps("password-validation-cons-chars").iconCssClassName
              }`}
            ></i>
            {translations.consecutiveChr}
          </li>
        </div>
      )}
    </ul>
  );
};

PasswordPolicyIndicator.propTypes = {
  maxConsecutiveChr: PropTypes.number,
  maxLength: PropTypes.number,
  minLength: PropTypes.number,
  minLowerCase: PropTypes.number,
  minNumbers: PropTypes.number,
  minSpecialChr: PropTypes.number,
  minUniqueChr: PropTypes.number,
  minUpperCase: PropTypes.number,
  onPasswordValidate: PropTypes.func.isRequired,
  password: PropTypes.string,
};

export default PasswordPolicyIndicator;
