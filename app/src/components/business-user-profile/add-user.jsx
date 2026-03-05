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

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useSnackbar } from "notistack";
import CountrySelect from "../country-select";
import { environmentConfig } from "../../util/environment-util";
import { getPasswordPolicy } from "../../api/server-configurations";
import PasswordField from "../common/password-field";
import { useHttpSwitch } from "../../sdk/httpSwitch";
import { useUser } from "@asgardeo/react";

const AddUser = ({ onCancel }) => {
  const { enqueueSnackbar } = useSnackbar();
  const httpSwitch = useHttpSwitch();
  const [ passwordValidationRules, setPasswordValidationRules ] = useState({});
  const [ isNewPasswordValid, setIsNewPasswordValid ] = useState(false);
  const [ passwordOption, setPasswordOption ] = useState("invite");
  const { profile } = useUser();
  const businessName = profile["urn:scim:schemas:extension:custom:User"].businessName;

  const [ formData, setFormData ] = useState({
    username: "",
    givenName: "",
    familyName: "",
    dob: "",
    email: "",
    mobile: "",
    country: "",
    password: ""
  });

  const request = requestConfig =>
    httpSwitch.request(requestConfig)
      .then(response => response)
      .catch(error => error);

  useEffect(() => {
    getPasswordPolicy()
      .then((response) => {
        setPasswordValidationRules(response);
      })
      .catch((error) => {
        console.error("Error fetching password policy:", error);
      });
  }, []);

  const getRoleIdByName = async (roleName) => {
    const requestConfig = {
      method: "GET",
      url: `${environmentConfig.IDP_BASE_URL}/o/scim2/v2/Roles?filter=displayName eq ${encodeURIComponent(roleName)}`,
      headers: {
        Accept: "application/scim+json",
      },
    };

    try {
      const response = await httpSwitch.request(requestConfig);
      const resources = response.data?.Resources || [];
      return resources.length > 0 ? resources[0].id : null;
    } catch (error) {
      console.error("Error fetching role ID:", error);
      return null;
    }
  };

  const handleSubmit = async (e) => {

    e.preventDefault();
    try {
      const valuePayload = {
        schemas: [],
        name: {},
        userName: "",
        emails: [],
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {},
        "urn:scim:wso2:schema": {},
        "urn:scim:schemas:extension:custom:User": {
          accountType: "Business"
        },
      };

      if (formData.givenName.trim() !== "") valuePayload.name.givenName = formData.givenName;
      if (formData.familyName.trim() !== "") valuePayload.name.familyName = formData.familyName;

      if (formData.username.trim() !== "") {
        valuePayload.userName = `DEFAULT/${formData.username}@${businessName}.com`;
      }

      if (formData.email.trim() !== "") {
        valuePayload.emails = [{ value: formData.email, primary: true }];
      }

      if (passwordOption === "set" && formData.password.trim() !== "") {
        valuePayload.password = formData.password;
      } else if (passwordOption === "invite") {
        valuePayload["urn:scim:wso2:schema"].askPassword = true;
      }

      if (formData.mobile.trim() !== "") {
        valuePayload.phoneNumbers = [{ type: "mobile", value: formData.mobile }];
      }

      if (formData.dob.trim() !== "") {
        valuePayload["urn:scim:wso2:schema"].dateOfBirth = formData.dob;
      }

      if (formData.country.trim() !== "") {
        valuePayload["urn:scim:wso2:schema"].country = formData.country;
      }

      const response = await request({
        headers: {
          "Accept": "application/scim+json",
          "Content-Type": "application/scim+json"
        },
        method: "POST",
        data: valuePayload,
        url: `${environmentConfig.IDP_BASE_URL}/o/scim2/Users`
      });

      if (response.status === 201) {
        const newRoleId = await getRoleIdByName("Member");
        await httpSwitch.request({
            method: "PATCH",
            url: `${environmentConfig.IDP_BASE_URL}/o/scim2/v2/Roles/${newRoleId}`,
            headers: {
              Accept: "application/scim+json",
              "Content-Type": "application/scim+json",
            },
            data: {
              schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
              Operations: [
                {
                  op: "add",
                  path: "users",
                  value: [{ value: response.data.id }]
                }
              ]
            }
          });
        enqueueSnackbar("User created successfully", { variant: "success" });
      }
      onCancel();
    } catch (error) {
      enqueueSnackbar("Something went wrong while creating user", { variant: "error" });
      console.error(error);
    }
  };

  return (
    <>
      <div className="contact_section p-2">
        <form onSubmit={handleSubmit} className="contact_form-container profile-edit">
          <ul className="details-list">
            <li>
              <label>Username:</label>
              <div className="row user-data-suffix">
                <div className="col-md-6">
                  <input type="text" name="username" placeholder="Username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required />
                </div>
                <div className="col-md-6 business-suffix d-flex align-items-center" >
                  <span className="business-suffix">@{businessName}.com</span>
                </div>
              </div>
            </li>
            <li>
              <div className="row">
                <div className="col-md-6">
                  <label>First Name:</label>
                  <input type="text" name="givenName" placeholder="First Name" value={formData.givenName} onChange={(e) => setFormData({ ...formData, givenName: e.target.value })} required />
                </div>
                <div className="col-md-6">
                  <label>Last Name:</label>
                  <input type="text" name="familyName" placeholder="Last Name" value={formData.familyName} onChange={(e) => setFormData({ ...formData, familyName: e.target.value })} required />
                </div>
              </div>
            </li>
            <li>
              <label>Date of Birth:</label>
              <input type="date" name="dob" placeholder="Date of Birth" value={formData.dob} onChange={(e) => setFormData({ ...formData, dob: e.target.value })} required />
            </li>
            <li>
              <label>Email:</label>
              <input type="email" name="email" placeholder="Email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
            </li>
            <li>
              <label>Country</label>
              <CountrySelect
                value={formData.country}
                onChange={(value) => setFormData({ ...formData, country: value.label })} />
            </li>
            <li>
              <label>Mobile Number:</label>
              <input type="tel" name="mobile" placeholder="Phone Number" value={formData.mobile} onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} required />
            </li>
            <li>
              <span className="password-label">Select the method to set the user password</span>
            </li>
            <li>
              <label className="radio-label">
                <input type="radio" name="passwordOption" value="invite" checked={passwordOption === "invite"} onChange={() => {setPasswordOption("invite");}}/>
                Invite the user to set their own password
              </label>
            </li>
            <li>
              <label className="radio-label">
                <input type="radio" name="passwordOption" value="set" checked={passwordOption === "set"} onChange={() => setPasswordOption("set")}/>
                Set a password for the user
              </label>
            </li>
            {passwordOption === "set" && (
              <li>
                <label>Password:</label>
                <PasswordField
                  name="password"
                  placeholder="Password"
                  value={formData.password}
                  onChange={(value) =>
                    setFormData({ ...formData, password: value })
                  }
                  showPasswordValidation={true}
                  passwordValidationRules={passwordValidationRules}
                  onPasswordValidate={(isValid) => {
                    setIsNewPasswordValid(isValid);
                  }}
                  inputProps={{
                    autoComplete: "new-password",
                  }}
                />
              </li>
            )}
          </ul>
          <div className="form-buttons">
            <button type="submit" className={`btn ${isNewPasswordValid || passwordOption === "invite" ? "" : "disabled" }`}>Create User</button>
            <button type="button" className="cancel-button secondary" style={{ marginLeft: "10px" }} onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}

AddUser.propTypes = {
  onCancel: PropTypes.func.isRequired
};

export default AddUser;
