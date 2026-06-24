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

import { useAsgardeo } from "@asgardeo/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import PropTypes from "prop-types";
import { Box, Chip, Container, FormControlLabel, IconButton, Paper, Switch, Typography } from "@mui/material";
import ShieldIcon from "@mui/icons-material/Shield";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { environmentConfig } from "../util/environment-util";
import CardBanking from "../assets/images/image9.jpg";
import MobileBanking from "../assets/images/mobile-banking.jpg";
import DigitalBanking from "../assets/images/digital-banking.jpg";
import BusinessBanking from "../assets/images/image8.jpg";
import EverydayBanking from "../assets/images/A_women_laying_on_a_soft_with_a_headset_and_holdin_028d291b-58ee-4de5-8c57-2a84033209ac-D3JAkeLQ.jpg";
import GoGlobal from "../assets/images/A_business_women_in_a_city_walking_portrait_lookin_5e59fd5e-a8dd-43e0-b4ea-5a926d089913-C9naFSuO.jpg";
import { ACCOUNT_TYPES, SITE_SECTIONS, ROUTES, URL_QUERY_PARAMS } from "../constants/app-constants";
import ChatComponent from "../components/transactions/ChatComponent";

const GOLD = "#997029";

/**
 * @param {object} props
 * @param {(section: string) => void} props.setSiteSection
 */
const PersonalBankingPage = ({ setSiteSection }) => {

  const { isSignedIn } = useAsgardeo();
  const [secured, setSecured] = useState(false);
  const [sessionId, setSessionId] = useState(
    () => "session_" + Math.random().toString(36).substring(2, 15)
  );

  const handleSecuredToggle = (/** @type {React.ChangeEvent<HTMLInputElement>} */ e) => {
    setSecured(e.target.checked);
    setSessionId("session_" + Math.random().toString(36).substring(2, 15));
  };

  useEffect(() => {
    setSiteSection(SITE_SECTIONS.PERSONAL);
  }, []);

  return (
    <>
      <section className=" slider_section ">
        <div id="carouselExampleIndicators" className="carousel slide" data-ride="carousel">
          <div className="carousel-inner">
            <div className="carousel-item active">
              <div className="container-fluid">
                <div className="row banner">
                  <div className="col-md-9 image-box">
                    <div className="detail-box">
                      <h1>
                        Get more out of life with
                        an Asgard Live+  <br />
                        <span>Credit Card</span>
                      </h1>
                      <p>
                        Live it up with 10% cashback on dining, <br />
                        shopping and entertainment. <br /><br /><br />
                      </p>
                      <div className="btn-box">
                        <a href="" className="btn-1"> Read more </a>
                        <a href="" className="btn-2">Inquire</a>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3 side-box">
                    <div>
                      <h2>Mobile banking</h2>
                      Mobile banking find out more about ways to bank
                      The bank in your pocket.
                    </div>
                    <hr />
                    <div>
                      <h2>Protect yourself from scams</h2>
                      Protect yourself from scams This link will open in a new window
                      Learn more about scams and frauds along with tips on how to protect your money.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="layout_padding">
        <Container maxWidth="xl">
          <Box sx={{ mb: 3, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
            <Box>
              <Typography
                variant="h5"
                sx={{ color: GOLD, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "1.1rem", mb: 0.5 }}
              >
                How can we help you today?
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Ask about branches near you, our products, or your own account — all in one place.
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <ShieldIcon sx={{ color: secured ? GOLD : "#bbb", fontSize: 20 }} />
              <FormControlLabel
                control={
                  <Switch
                    checked={secured}
                    onChange={handleSecuredToggle}
                    sx={{
                      "& .MuiSwitch-switchBase.Mui-checked": { color: GOLD },
                      "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { bgcolor: GOLD },
                    }}
                  />
                }
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>AI Guardrails</Typography>
                    <Chip
                      label={secured ? "ON" : "OFF"}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        bgcolor: secured ? "#e8f5e9" : "#f5f5f5",
                        color: secured ? "#2e7d32" : "#999",
                      }}
                    />
                  </Box>
                }
                sx={{ m: 0 }}
              />
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start", flexWrap: "wrap" }}>
            <Box sx={{ flex: "0 0 420px", minWidth: 300 }}>
              <ChatComponent sessionId={sessionId} secured={secured} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 260 }}>
              <Paper
                elevation={0}
                sx={{
                  p: 3,
                  borderRadius: 0,
                  border: "1px solid rgba(0,0,0,.07)",
                  borderLeft: `3px solid ${GOLD}`,
                  boxShadow: "0 1px 3px rgba(0,0,0,.05), 0 4px 20px rgba(0,0,0,.06)",
                }}
              >
                <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                  What you can ask
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  The Asgard Assistant can help with general questions and your personal account:
                </Typography>
                <Box component="ul" sx={{ pl: 2, m: 0 }}>
                  {[
                    "Find branches near London",
                    "What agencies are close to Paris?",
                    "Show me my last 5 transactions",
                    "How much did I spend last month?",
                    "Were there any transfers in the past 30 days?",
                    "Can you do a financial check-up for me?",
                    "Suggest a savings goal based on my spending",
                    "How could I save $10000 in the coming year?"
                  ].map((example) => (
                    <Box
                      key={example}
                      component="li"
                      sx={{ mb: 0.5, display: "flex", alignItems: "center", gap: 0.5 }}
                    >
                      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                        &ldquo;{example}&rdquo;
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => navigator.clipboard.writeText(example)}
                        sx={{ p: 0.25 }}
                        aria-label="Copy prompt"
                      >
                        <ContentCopyIcon sx={{ fontSize: "0.9rem" }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
                  Branch and agency queries need no login. Account queries will prompt you to authorise access.
                </Typography>
              </Paper>
            </Box>
          </Box>
        </Container>
      </section>

      <section className="service_section layout_padding">
        <div className="container">
          <div className="heading_container heading_center">
            <h2>
              Do more with Bank of Asgard
            </h2>
          </div>
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
                  { isSignedIn ?
                    (
                      <Link to={ ROUTES.PERSONAL_BANKING }>
                        View your account
                      </Link>
                    ) : (
                      <Link to={ `${ROUTES.REGISTER_ACCOUNT}?${URL_QUERY_PARAMS.ACCOUNT_TYPE}=${ACCOUNT_TYPES.PERSONAL}` }>
                        Open a personal account
                      </Link>
                    )
                  }
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
                  { isSignedIn ?
                    (
                      <Link to={ ROUTES.PERSONAL_BANKING }>
                        View your business account
                      </Link>
                    ) : (
                      <Link to={ `${ROUTES.REGISTER_ACCOUNT}?${URL_QUERY_PARAMS.ACCOUNT_TYPE}=${ACCOUNT_TYPES.BUSINESS}` }>
                        Open a business account
                      </Link>
                    )
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="team_section layout_padding">
        <div className="container">
          <div className="heading_container heading_center">
            <h2>
              Go beyond regular banking!
            </h2>
            <p>
              Lorem ipsum dolor sit amet, non odio tincidunt ut ante, lorem a euismod suspendisse vel, sed quam nulla mauris
              iaculis. Erat eget vitae malesuada, tortor tincidunt porta lorem lectus.
            </p>
          </div>
          <div className="row">
          <div className="col-md-4 col-sm-6 mx-auto ">
              <div className="box">
                <div className="img-box">
                  <img src={ BusinessBanking } alt="" />
                </div>
                <div className="detail-box">
                  <h5>
                    Business Banking
                  </h5>
                  <h6 className="">
                    Read More
                  </h6>
                </div>
              </div>
            </div>
            <div className="col-md-4 col-sm-6 mx-auto ">
              <div className="box">
                <div className="img-box">
                  <img src={ MobileBanking } alt="" />
                </div>
                <div className="detail-box">
                  <h5>
                    Mobile Banking
                  </h5>
                  <h6 className="">
                    Read More
                  </h6>
                </div>
              </div>
            </div>
            <div className="col-md-4 col-sm-6 mx-auto ">
              <div className="box">
                <div className="img-box">
                  <img src={ CardBanking } alt="" />
                </div>
                <div className="detail-box">
                  <h5>
                    Cashless Payments
                  </h5>
                  <h6 className="">
                    Read More
                  </h6>
                </div>
              </div>
            </div>
          </div>
          <div className="btn-box">
            <a href="">
              View All
            </a>
          </div>
        </div>
      </section>

      <section className="contact_section layout_padding">
        <div className="contact_bg_box">
          <div className="img-box">
            <img src={ DigitalBanking } alt="" />
          </div>
        </div>
      </section>

      { environmentConfig.AWS_BRANDING && (
        <section className="layout_padding-bottom">
          <div className="container">
            <div style={{ textAlign: "center" }}>
              <p style={{ marginBottom: "8px", color: "#666", fontSize: "14px" }}>
                Secured identity powered by
              </p>
              <img
                src="/images/powered-by-aws.png"
                alt="Powered by AWS"
                style={{ height: "60px" }}
              />
            </div>
          </div>
        </section>
      )}

      <section className="client_section layout_padding">
        <div className="container ">
          <div className="heading_container heading_center">
            <h2>
              We vow to a secure banking experience to our customers!
            </h2>
          </div>
          <div id="carouselExampleControls" className="carousel slide" data-ride="carousel">
            <div className="carousel-inner">
              <div className="carousel-item active">
                <div className="box">
                  <div className="img-box">
                    <img src="images/client.png" alt="" />
                  </div>
                  <div className="detail-box">
                    <h4>
                      Minim Veniam
                    </h4>
                    <p>
                      Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed
                      do eiusmod tempor incididunt ut labore et dolore magna
                      aliqua. Ut enim ad minim veniam, quis nostrud exercitation
                      ullamco laboris nisi ut aliquip
                    </p>
                  </div>
                </div>
              </div>
              <div className="carousel-item ">
                <div className="box">
                  <div className="img-box">
                    <img src="images/client.png" alt="" />
                  </div>
                  <div className="detail-box">
                    <h4>
                      Minim Veniam
                    </h4>
                    <p>
                      Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed
                      do eiusmod tempor incididunt ut labore et dolore magna
                      aliqua. Ut enim ad minim veniam, quis nostrud exercitation
                      ullamco laboris nisi ut aliquip
                    </p>
                  </div>
                </div>
              </div>
              <div className="carousel-item ">
                <div className="box">
                  <div className="img-box">
                    <img src="images/client.png" alt="" />
                  </div>
                  <div className="detail-box">
                    <h4>
                      Minim Veniam
                    </h4>
                    <p>
                      Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed
                      do eiusmod tempor incididunt ut labore et dolore magna
                      aliqua. Ut enim ad minim veniam, quis nostrud exercitation
                      ullamco laboris nisi ut aliquip
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="carousel_btn-box">
              <a className="carousel-control-prev" href="#carouselExampleControls" role="button" data-slide="prev">
                <i className="fa fa-angle-left" aria-hidden="true"></i>
                <span className="sr-only">Previous</span>
              </a>
              <a className="carousel-control-next" href="#carouselExampleControls" role="button" data-slide="next">
                <i className="fa fa-angle-right" aria-hidden="true"></i>
                <span className="sr-only">Next</span>
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

PersonalBankingPage.propTypes = {
  setSiteSection: PropTypes.func.isRequired,
};

export default PersonalBankingPage;
