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
import { useAsgardeo } from "@asgardeo/react";
import { useSnackbar } from "notistack";
import CountrySelect from "../country-select";
import { environmentConfig } from "../../util/environment-util";

const EditProfile = ({ userInfo, onUpdateSuccess, onCancel }) => {
  const { enqueueSnackbar } = useSnackbar();

  const { isSignedIn, http } = useAsgardeo();

  const [ formData, setFormData ] = useState({
    givenName: "",
    familyName: "",
    dob: "",
    email: "",
    mobile: "",
    country: ""
  });

  const request = requestConfig =>
    http.request(requestConfig)
      .then(response => response)
      .catch(error => error);

  useEffect(() => {
    if (userInfo) {
      setFormData({
        givenName: userInfo.givenName || "",
        familyName: userInfo.familyName || "",
        dob: userInfo.birthdate || "",
        email: userInfo.email || "",
        mobile: userInfo.mobile || "",
        country: userInfo.country || ""
      });
    }
  }, [ userInfo ]);

  const handleSubmit = async (e) => {

    e.preventDefault();

    try {
      const operations = [];
      // Add updated values to the PATCH request only if they are modified
      const valuePayload = {};

      if (formData.givenName.trim() !== "" || formData.familyName.trim() !== "") {
          valuePayload.name = {};
          if (formData.givenName.trim() !== "") valuePayload.name.givenName = formData.givenName;
          if (formData.familyName.trim() !== "") valuePayload.name.familyName = formData.familyName;
      }

      if (formData.email.trim() !== "") {
        valuePayload.emails = [formData.email];
      }

      if (formData.mobile.trim() !== "") {
        valuePayload.phoneNumbers = [{ type: "mobile", value: formData.mobile }];
      }

      const scimWso2Schema = {};
      if (formData.dob.trim() !== "") {
        scimWso2Schema.dateOfBirth = formData.dob;
      }
      if (formData.country.trim() !== "") {
        scimWso2Schema.country = formData.country;
      }
      if (Object.keys(scimWso2Schema).length > 0) {
        valuePayload["urn:scim:wso2:schema"] = scimWso2Schema;
      }

      if (Object.keys(valuePayload).length > 0) {
        operations.push({ op: "replace", value: valuePayload });
      }

      // If no fields were updated, return early
      if (operations.length === 0) {
        enqueueSnackbar("No fields were updated", { variant: "info" });
        return;
      }

      const payload = {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: operations,
      };

      const response = await request({
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/scim+json"
        },
        method: "PATCH",
        data: payload,
        url: `${environmentConfig.ASGARDEO_BASE_URL}/scim2/Me`
      });

      if (response.status == 200) {
        enqueueSnackbar("Profile updated successfully", { variant: "success" });
        onUpdateSuccess();
      }
    } catch (error) {
      enqueueSnackbar("Something went wrong while updating profile", { variant: "error" });
      console.error(error);
    }
  };

  return (
    <>
      <div className="heading_container ">
        <h2>User Profile - Edit</h2>
      </div>
      <div className="detail-box user-profile">
        <div className="row">
          <div className="col-md-6 px-0">
            <div className="img_container">
              <div className="img-box">
                <div className="contact_section">
                  <form onSubmit={handleSubmit} className="contact_form-container profile-edit">
                    <ul className="details-list">
                      <li>
                        <div className="row">
                          <div className="col-md-6">
                            <label>First Name:</label>
                            <input type="text" name="givenName" placeholder="First Name" value={formData.givenName} onChange={(e) => setFormData({ ...formData, givenName: e.target.value })} />
                          </div>
                          <div className="col-md-6">
                            <label>Last Name:</label>
                            <input type="text" name="familyName" placeholder="Last Name" value={formData.familyName} onChange={(e) => setFormData({ ...formData, familyName: e.target.value })} />
                          </div>
                        </div>
                      </li>
                      <li>
                        <label>Date of Birth:</label>
                        <input type="date" name="dob" placeholder="Date of Birth" value={formData.dob} onChange={(e) => setFormData({ ...formData, dob: e.target.value })} />
                      </li>
                      <li>
                        <label>Email:</label>
                        <input type="email" name="email" placeholder="Email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                      </li>
                      <li>
                        <label>Mobile:</label>
                        <input type="tel" name="mobile" placeholder="Phone Number" value={formData.mobile} onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} />
                      </li>
                      <li>
                        <label>Country</label>
                        <CountrySelect
                          value={formData.country}
                          onChange={(value) => setFormData({ ...formData, country: value.label })} />
                      </li>
                    </ul>

                    <div className="form-buttons">
                      <button type="submit">Update Profile</button>
                      <button type="button" className="cancel-button secondary" onClick={onCancel} style={{ marginLeft: "10px" }}>Cancel</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

EditProfile.propTypes = {
  userInfo: PropTypes.object.isRequired,
  onUpdateSuccess: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired
};

export default EditProfile;
