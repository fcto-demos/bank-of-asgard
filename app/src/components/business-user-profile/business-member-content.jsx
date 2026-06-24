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

import { useEffect } from "react";
import PropTypes from "prop-types";
import { SITE_SECTIONS } from "../../constants/app-constants";

/**
 * @param {object} props
 * @param {(section: string) => void} props.setSiteSection
 * @param {string} props.role
 */
const BusinessMemberContent = ({ setSiteSection, role }) => {

  useEffect(() => {
    setSiteSection(SITE_SECTIONS.BUSINESS);
  }, []);

  return (
    <>
      <section className="about_section layout_padding">
        <div className="container">
          <div className="row">
            <div className="col-md-12 px-0">
              <div className="detail-box">
                <div className="heading_container ">
                  <h2>Business {role} Account</h2>
                </div>
                <p>
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
                  eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut
                  enim ad minim veniam, quis nostrud exercitation ullamco laboris
                  nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor
                  in reprehenderit in voluptate velit
                </p>
                <div className="btn-box">
                  <a href="">
                    Read More
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

BusinessMemberContent.propTypes = {
  setSiteSection: PropTypes.object.isRequired,
  role: PropTypes.string.isRequired
};

export default BusinessMemberContent;
