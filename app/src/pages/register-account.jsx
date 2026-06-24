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

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import PropTypes from "prop-types";
import SignUpForm from "../components/sign-up/sign-up-form";
import BusinessSignUpForm from "../components/sign-up/business-sign-up-form";
import EverydayBanking from "../assets/images/A_women_laying_on_a_soft_with_a_headset_and_holdin_028d291b-58ee-4de5-8c57-2a84033209ac-D3JAkeLQ.jpg";
import GoGlobal from "../assets/images/A_business_women_in_a_city_walking_portrait_lookin_5e59fd5e-a8dd-43e0-b4ea-5a926d089913-C9naFSuO.jpg";
import GatacaImage from "../assets/images/asgard_wallet_custom_qr.png";
import { ACCOUNT_TYPES, ROUTES, SITE_SECTIONS, URL_QUERY_PARAMS } from "../constants/app-constants";
import { isFeatureEnabled } from "../util/environment-util";
import { FEATURE_MAP } from "../constants/feature-constants";

/**
 * @param {object} props
 * @param {(section: string | null) => void} props.setSiteSection
 */
const RegisterAccountPage = ({ setSiteSection }) => {

  const [ searchParams ] = useSearchParams();
  const [ showModal, setShowModal ] = useState(false);

  const accountType = searchParams.get(URL_QUERY_PARAMS.ACCOUNT_TYPE) || "";
  const isOdinWalletEnabled = isFeatureEnabled(FEATURE_MAP.ODIN_WALLET);

  useEffect(() => {
    if (accountType === ACCOUNT_TYPES.BUSINESS) {
      setSiteSection(SITE_SECTIONS.BUSINESS);
    }
    else if (accountType === ACCOUNT_TYPES.PERSONAL) {
      setSiteSection(SITE_SECTIONS.PERSONAL);
    }
    else {
      setSiteSection(null);
    }
  }, [ accountType ]);

  useEffect(() => {
    if (showModal) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }

    // Cleanup when component unmounts
    return () => {
      document.body.classList.remove("modal-open");
    };
  }, [ showModal ]);

  return (
    <>
      <section className="about_section layout_padding">
        <div className="container">

          { (accountType !== "") ?
            (
              <>
                { (accountType === ACCOUNT_TYPES.BUSINESS) ?
                  (
                    <>
                      <div className="heading_container">
                        <h2>Open your business account</h2>
                      </div>
                      <div className="register-page-banner">
                        <img src={ GoGlobal } alt="" style={ { width: "100%", marginTop: "-120px" } } />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="heading_container">
                        <h2>Open your account</h2>
                      </div>
                      <div className="register-page-banner">
                        <img src={ EverydayBanking } alt="" style={ { width: "100%", marginTop: "-95px" } } />
                      </div>
                    </>
                  )
                }
                <div className="row">
                  <div className="col-md-8 px-0">
                    <div className="contact_section">
                      <div className="container">
                        <div className="row">
                          <div className="col-md-7">
                            { (accountType === ACCOUNT_TYPES.PERSONAL) ?
                              (<SignUpForm accountType={ accountType } />)
                              :(
                              <BusinessSignUpForm accountType={ accountType }/>
                              )
                            }
                          </div>
                          { (isOdinWalletEnabled && accountType === ACCOUNT_TYPES.PERSONAL) &&
                            <div className="col-md-2 mx-auto" style={ { textAlign: "center" } }>
                              <h4>OR</h4>
                            </div>
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                  { (isOdinWalletEnabled && accountType === ACCOUNT_TYPES.PERSONAL) && (
                    <div className="col-md-4 px-0">
                      <div className="detail-box" style={ { marginTop: "200px" } }>
                        <div className="heading_container ">
                          <h2>Open instantly</h2>
                        </div>

                        <button type="button" className="btn btn-primary verify-button" onClick={ () => setShowModal(true) }>
                          <span className="icon">
                            <i className="fa fa-id-badge"></i>
                          </span>
                          <span className="text">
                            <h4>Verify your Self</h4>
                            with Odin
                          </span>
                        </button>

                        <p>
                          You can use your Odin Wallet to open an account instantly.
                        </p>
                      </div>
                    </div>
                  ) }
                </div>
              </>
            ) : (
              <div className="row">
                <div className="col-md-6">
                  <div className="box ">
                    <div className="img-box">
                      <img src={ EverydayBanking } alt="" style={ { width: "100%" } } />
                    </div>
                    <div className="detail-box">
                      <h5>
                        Personal Banking
                      </h5>
                      <p>
                        Step into a world of endless opportunity when shopping and banking online.
                        We&apos;re here to help you with smart and safe banking.
                      </p>
                      <Link to={ `${ROUTES.REGISTER_ACCOUNT}?${URL_QUERY_PARAMS.ACCOUNT_TYPE}=${ACCOUNT_TYPES.PERSONAL}` }>
                        Personal Account
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="box ">
                    <div className="img-box">
                      <img src={ GoGlobal } alt="" style={ { width: "100%" } } />
                    </div>
                    <div className="detail-box">
                      <h5>
                        Business Banking
                      </h5>
                      <p>
                        We&apos;re supporting smarter business by building future focused insights,
                        and easier to use products and services that facilitate new ways to grow
                      </p>
                      <Link to={ `${ROUTES.REGISTER_ACCOUNT}?${URL_QUERY_PARAMS.ACCOUNT_TYPE}=${ACCOUNT_TYPES.BUSINESS}` }>
                        Business Account
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )
          }
        </div>
      </section>

      <div id="exampleModalLive" className="modal fade show" tabIndex={-1} role="dialog" aria-labelledby="exampleModalLiveLabel" style={{ display: showModal ? "block" : "none", zIndex: showModal ? "100000" : "-1" }}>
        <div className="modal" tabIndex={-1} role="dialog" style={{ display: showModal ? "block" : "none" }}>
          <div className="modal-dialog" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <button type="button" className="close" data-dismiss="modal" aria-label="Close" onClick={ () => setShowModal(false) }>
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <p><img src={ GatacaImage } style={ { maxWidth: "100%" }} /></p>
                <p style={ { padding: "0 25px" } }>
                  Please scan the QR code with your Odin Wallet for us to verify your identity.
                </p>
              </div>
              {/* <div className="modal-footer">
                <button type="button" className="btn btn-secondary" data-dismiss="modal" onClick={ () => setShowModal(false) }>Close</button>
              </div> */}
            </div>
          </div>
        </div>
      </div>

      <div className={ `modal-backdrop fade ${showModal ? "show" : ""} `}  style={{ zIndex: showModal ? "1" : "-1" }}></div>
    </>
  );
}

RegisterAccountPage.propTypes = {
  setSiteSection: PropTypes.object.isRequired,
};

export default RegisterAccountPage;
