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
import { formatCurrency } from "../../../util/string-util";
import { useNavigate } from "react-router";
import { ROUTES } from "../../../constants/app-constants";
import { useContext } from "react";
import { BankAccountContext } from "../../../context/bank-account-provider";

const BankAccountCard = ({ userInfo }) => {
  const initialCreditCardState = {
    cardNumber: "4574-3434-2984-2365",
    balance: -45600.67,
  };

  const navigate = useNavigate();
  const { bankAccountData } = useContext(BankAccountContext);

  return (
    <div
      className="detail-box user-profile"
      style={{ marginTop: "0", height: "100%" }}
    >
      <div className="contact_section">
        <div className="contact_form-container profile-edit">
          <h5>Account Details</h5>
          <ul className="accounts-list">
            <li>
              <div className="row">
                <div className="col-md-8">
                  <h6>Savings Account</h6>
                  <span>
                    <i className="fa fa-money" aria-hidden="true"></i>
                    {bankAccountData.accountNumber}
                  </span>
                </div>
                <div className="col-md-4">
                  {formatCurrency(bankAccountData.balance)}
                </div>
              </div>
            </li>
            <li>
              <div className="row">
                <div className="col-md-8">
                  <h6>Live+ Credit Card</h6>
                  <span>
                    <i className="fa fa-credit-card" aria-hidden="true"></i>{" "}
                    {initialCreditCardState.cardNumber}
                  </span>
                </div>
                <div className="col-md-4">
                  {formatCurrency(initialCreditCardState.balance)}
                </div>
              </div>
            </li>
          </ul>

          <div className="form-buttons">
            <button className="edit-button" onClick={() => navigate(ROUTES.FUND_TRANSFER)}>Make a transfer</button>
          </div>

          <hr />

          <ul className="account-options-list">
            <li className="disabled">
              <i className="fa fa-file-text" aria-hidden="true"></i>
              <span>Balance Statement</span>
            </li>
            <li className="disabled">
              <i className="fa fa-credit-card" aria-hidden="true"></i>
              <span>Request Credit Card</span>
            </li>
            <li className="disabled">
              <i className="fa fa-exchange" aria-hidden="true"></i>
              <span>Request a Loan</span>
            </li>
            <li className="disabled">
              <i className="fa fa-heart" aria-hidden="true"></i>
              <span>Credit Limit Increase</span>
            </li>
          </ul>

          <hr />
          <h5>Transaction Assistant</h5>
          <p style={{ fontSize: "14px", color: "#666", marginBottom: "10px" }}>
            Review your transaction history and get AI-powered spending insights.
          </p>
          <div className="form-buttons">
            <button className="edit-button" onClick={() => navigate(ROUTES.TRANSACTIONS)}>
              Open Transaction Assistant
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

BankAccountCard.propTypes = {
  userInfo: PropTypes.object.isRequired,
};

export default BankAccountCard;
