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

import { useAsgardeo, SignedIn, SignOutButton, SignedOut, SignInButton, useUser } from "@asgardeo/react";
import { lazy, Suspense, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  NavLink
} from "react-router";
import { SnackbarProvider } from "notistack";
import { ACCOUNT_TYPES, ROUTES, SITE_SECTIONS } from "./constants/app-constants";
import PersonalBankingPage from "./pages/personal-banking";
import RegisterAccountPage from "./pages/register-account";
import UserProfilePage from "./pages/user-profile";
import NotFound from "./pages/not-found";
import "./assets/css/bootstrap.css";
import "./assets/css/responsive.css";
import "./assets/css/style.scss";
import { BankAccountProvider } from "./context/bank-account-provider";
import IdentityVerificationPage from "./pages/identity-verification";
import { IdentityVerificationProvider } from "./context/identity-verification-provider";
import { Dropdown, DropdownButton } from "react-bootstrap";
import BusinessProfilePage from "./pages/business-profile";
import TransactionsPage from "./pages/transactions";
import { CircularProgress } from "@mui/material";

const App = () => {
  const { isSignedIn } = useAsgardeo();
  const [ siteSection, setSiteSection ] = useState("");
  const { profile } = useUser();

  const TransferFundsPage = lazy(() => import("./pages/transfer-funds"));
  const TransferFundsVerifyPage = lazy(() => import("./pages/transfer-funds-verify"));

  return (
    <SnackbarProvider maxSnack={ 3 }>
    <BankAccountProvider>
    <IdentityVerificationProvider>
    <Router>
      <header className="header_section">
        <div className="header_top">
          <div className="container-fluid">
            <div className="contact_link-container">
              <span>
                {/* TODO: Uncomment the below code snippet to enable the personal and business banking links */}
                {/* <NavLink to={ ROUTES.PERSONAL_BANKING } className={({ isActive }) => isActive ? "contact_link1 active" : "contact_link1"}>
                  <span>
                    Personal
                  </span>
                </NavLink>
                <span className="divider">|</span>
                <NavLink to={ ROUTES.BUSINESS_BANKING } className={({ isActive }) => isActive ? "contact_link1 active" : "contact_link1"}>
                  <span>
                    Business
                  </span>
                </NavLink> */}
              </span>
              <span>
                <SignedIn>
                  <SignOutButton className="logout_link">Logout</SignOutButton>
                </SignedIn>

                <SignedOut>
                  <Link to={ ROUTES.REGISTER_ACCOUNT } className="register_link">
                    <span>
                        Open an account
                    </span>
                  </Link>
                  <span className="divider">|</span>
                  <DropdownButton
                      id="dropdown-custom-components"
                      title="Login"
                      autoClose={false}
                  >
                      <Dropdown.Item as="div" className="dropdown-item-custom dropdown-item-custom-top">
                          <SignInButton className="login_link" signInOptions={{ loginType: 'Personal' }}>
                              Personal Login
                          </SignInButton>
                      </Dropdown.Item>
                      <Dropdown.Item as="div" className="dropdown-item-custom">
                          <SignInButton className="login_link" signInOptions={{ loginType: 'Business' }}>
                              Business Login
                          </SignInButton>
                      </Dropdown.Item>
                  </DropdownButton>
                </SignedOut>
              </span>
            </div>
          </div>
        </div>
        <div className="header_bottom">
          <div className="container-fluid">
            <nav className="navbar navbar-expand-lg custom_nav-container">
              <Link to="/" className="navbar-brand">
                <span>
                  <img src="/images/logo.svg" alt="Bank of Asgard" />
                </span>
              </Link>
              <button className="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarSupportedContent" aria-controls="navbarSupportedContent" aria-expanded="false" aria-label="Toggle navigation">
                <span className=""></span>
              </button>

              { (siteSection === SITE_SECTIONS.PERSONAL) &&
                <div className="collapse navbar-collapse ml-auto" id="navbarSupportedContent">
                  <ul className="navbar-nav">
                    <li className="nav-item">
                      <a className="nav-link" href="">
                        Everyday Banking
                        <span>Accounts & Credit Cards</span>
                        </a>
                    </li>
                    <li className="nav-item">
                      <a className="nav-link" href="">
                        Offers & Rewards
                        <span>Exclusive Offers</span>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a className="nav-link" href="">
                        International
                        <span>Global Benefits</span>
                      </a>
                    </li>
                    <li className="nav-item">
                      <a className="nav-link" href="">
                        Digital Banking
                        <span>Banking made easy</span>
                      </a>
                    </li>
                  </ul>
                </div>
              }

              { (siteSection === SITE_SECTIONS.BUSINESS) &&
                <div className="collapse navbar-collapse ml-auto" id="navbarSupportedContent">
                  <ul className="navbar-nav">
                    <li className="nav-item">
                      <NavLink to={ ROUTES.BUSINESS_BANKING } className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
                        Insights
                      </NavLink>
                    </li>
                    <li className="nav-item">
                      <a className="nav-link" href="">
                        Products & Solutions
                      </a>
                    </li>
                    <li className="nav-item">
                      <a className="nav-link" href="">
                        Help Centre
                      </a>
                    </li>
                    <li className="nav-item">
                      <a className="nav-link" href="">
                        Contact us
                      </a>
                    </li>
                  </ul>
                </div>
              }
            </nav>
          </div>
        </div>
      </header>

      {/* TODO: Routing needs to be fixed with proper router guard and paths. Ex: Home and Profile pages */}
      <Routes>
        {/* <Route path={ ROUTES.BUSINESS_BANKING } element={ <BusinessBankingPage setSiteSection={ setSiteSection } /> } /> */}
        <Route path={ ROUTES.REGISTER_ACCOUNT } element={ <RegisterAccountPage setSiteSection={ setSiteSection } /> } />
        { isSignedIn &&
          <Route path={ ROUTES.USER_PROFILE } element={ <UserProfilePage setSiteSection={ setSiteSection } /> } />
        }
        { isSignedIn &&
          <Route path={ ROUTES.BUSINESS_PROFILE } element={ <BusinessProfilePage setSiteSection={ setSiteSection } /> } />
        }
        { isSignedIn &&
          <Route path={ ROUTES.TRANSACTIONS } element={ <TransactionsPage /> } />
        }
        {/* <Route path="/" element={ <Navigate to={ ROUTES.PERSONAL_BANKING } setSiteSection={ setSiteSection } /> } /> */}
        <Route path="/" element={
          isSignedIn ? (
            !profile ? (
              <CircularProgress />
            ) : profile?.["urn:scim:schemas:extension:custom:User"]?.accountType === ACCOUNT_TYPES.BUSINESS ? (
              <BusinessProfilePage setSiteSection={ setSiteSection } />
            ) : (
              <UserProfilePage setSiteSection={ setSiteSection } />
            )
          ) : (
            <PersonalBankingPage setSiteSection={ setSiteSection } />
          )
        } />
        {
          isSignedIn &&
            <Route
              path={ROUTES.FUND_TRANSFER}
              element={
                <Suspense fallback={<>...</>}>
                  <TransferFundsPage />
                </Suspense>
              }
            />
        }
        {
          <Route
            path={ROUTES.FUND_TRANSFER_VERIFY}
            element={
              <Suspense fallback={<>...</>}>
                <TransferFundsVerifyPage />
              </Suspense>
            }
          />
        }
        {
          <Route
            path={ROUTES.IDENTITY_VERIFICATION}
            element={
              <Suspense fallback={<>...</>}>
                <IdentityVerificationPage />
              </Suspense>
            }
          />
        }
        <Route path="*" element={ <NotFound /> } />
      </Routes>

      <section className="info_section ">
        <div className="container">
          <div className="row">
            <div className="col-md-3">
              <div className="info_logo">
                <a className="navbar-brand" href="index.html">
                  <span>
                    Bank of Asgard
                  </span>
                </a>
                <p>
                  Copyright Bank of Asgard. <br />
                  2024 - 2025 All rights reserved.
                </p>
              </div>
            </div>
            <div className="col-md-3">
              <div className="info_links">
                <h5>
                  Useful Link
                </h5>
                <ul>
                  <li>
                    <a href="">
                      Open an everyday account
                    </a>
                  </li>
                  <li>
                    <a href="">
                      Open a savings account
                    </a>
                  </li>
                  <li>
                    <a href="">
                      Apply for a home loan
                    </a>
                  </li>
                  <li>
                    <a href="">
                      Apply for a credit card
                    </a>
                  </li>
                </ul>
              </div>
            </div>
            <div className="col-md-3">
              <div className="info_info">
                <h5>
                  Contact Us
                </h5>
              </div>
              <div className="info_contact">
                <a href="" className="">
                  <i className="fa fa-map-marker" aria-hidden="true"></i>
                  <span>
                    Campelle St, 24-28 Paris
                  </span>
                </a>
                <a href="" className="">
                  <i className="fa fa-phone" aria-hidden="true"></i>
                  <span>
                    Call : +01 1234567890
                  </span>
                </a>
                <a href="" className="">
                  <i className="fa fa-envelope" aria-hidden="true"></i>
                  <span>
                    contact@bankofasgard.com
                  </span>
                </a>
              </div>
            </div>
            <div className="col-md-3">
              <div className="info_form ">
                <h5>
                  Newsletter
                </h5>
                <form action="#">
                  <input type="email" placeholder="Enter your email" />
                  <button>
                    Subscribe
                  </button>
                </form>
                <div className="social_box">
                  <a href="">
                    <i className="fa fa-facebook" aria-hidden="true"></i>
                  </a>
                  <a href="">
                    <i className="fa fa-twitter" aria-hidden="true"></i>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Router>
    </IdentityVerificationProvider>
    </BankAccountProvider>
    </SnackbarProvider>
  );
};

export default App;
