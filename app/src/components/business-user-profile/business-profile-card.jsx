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
import { environmentConfig } from "../../util/environment-util";
import { enqueueSnackbar } from "notistack";
import axios from "axios";

/**
 * @param {object} props
 * @param {any} props.userInfo
 * @param {string} props.organizationId
 */
const BusinessProfileCard = ({ userInfo, organizationId }) => {

  const [metadata, setMetadata] = useState(/** @type {any} */ (null));
  const [isEditing, setIsEditing] = useState(false);
  const [businessRegNo, setBusinessRegNo] = useState("");

  const fetchMetadata = async () => {
    if (metadata) return;
    try {
      const response = await axios.get(
        `${environmentConfig.API_SERVICE_URL}/business?organizationId=${organizationId}`
      );
      if (response.status == 200) {
        setMetadata(response.data);
      }
    } catch (err) {
      enqueueSnackbar("Something went wrong while fetching business profile", { variant: "error" });
      console.error(err);
    }
  };

  const updateBusinessRegNo = async () => {
    try {
      const operation = metadata?.businessRegistrationNumber
      ? "REPLACE"
      : "ADD";

      const response = await axios.patch(
        `${environmentConfig.API_SERVICE_URL}/business-update`,
        {
          organizationId,
          businessRegistrationNumber: businessRegNo,
          operation
        }
      );

      if (response.status === 200) {
        enqueueSnackbar("Business registration number updated successfully", { variant: "success" });
        setMetadata((/** @type {any} */ prev) => ({
          ...prev,
          businessRegistrationNumber: businessRegNo,
        }));
        setIsEditing(false);
      }
    } catch (err) {
      enqueueSnackbar("Failed to update business registration number", { variant: "error" });
      console.error(err);
    }
  };

  useEffect(() => {
    fetchMetadata();
  }, []);

  return (
    <div className="box-zone">
      <h5>Business Profile</h5>
      <ul className="details-list">
        <li>
          <strong>Business Name:</strong> {userInfo.businessName}
        </li>
        <li>
          <strong>Business Registration Number:</strong>{" "}
          {/* {metadata?.businessRegistrationNumber || "Not set"} */}
          {!isEditing && (
            <>
              {metadata?.businessRegistrationNumber || "N/A"}
            </>
          )}
        </li>
        {isEditing ? (
            <>
              <input
                type="text"
                value={businessRegNo}
                onChange={(e) => setBusinessRegNo(e.target.value)}
                placeholder={metadata?.businessRegistrationNumber || "Not set yet"}
              />
              <button style={{ marginTop: "30px" }} onClick={updateBusinessRegNo}>Save</button>
              <button style={{ marginBottom: "0" }} className="black-button" onClick={() => setIsEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button style={{ marginTop: "15px", marginBottom: "0" }} onClick={() => setIsEditing(true)}>Edit</button>
            </>
          )}
      </ul>
    </div>
  );
};

BusinessProfileCard.propTypes = {
  userInfo: PropTypes.object.isRequired,
  organizationId: PropTypes.object.isRequired,
  setShowEditForm: PropTypes.func.isRequired,
};

export default BusinessProfileCard;
