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
import { useAsgardeo } from "@asgardeo/react";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { useContext } from "react";
import { BankAccountContext } from "../context/bank-account-provider";
import { useNavigate } from "react-router";
import { ROUTES } from "../constants/app-constants";
import { formatCurrency } from "../util/string-util";

const TransferFundsVerifyPage = () => {
  const { search } = useLocation();
  const navigate = useNavigate();

  const { isSignedIn, signIn, reInitialize } = useAsgardeo();
  const { bankAccountData, updateBalance } = useContext(BankAccountContext);

  const [isTransferInprogress, setIsTransferInprogress] = useState(true);

  const query = new URLSearchParams(search);
  const stateParam = JSON.parse(query.get("state") || "null");
  const failureParam = JSON.parse(query.get("failure") || "null");
  const { amount, receiver, description } = stateParam || {};

  useEffect(() => {
    if (!isSignedIn) {
      reInitialize({
        afterSignInUrl: window.location.origin + window.location.pathname,
      }).then(() => {
        signIn({
          callOnlyOnRedirect: true,
        });
      });
    } else {
      setTimeout(() => {
        const newBalance = bankAccountData.balance - amount;
        updateBalance(newBalance);
        setIsTransferInprogress(false);
      }, 5000);
    }
  }, [isSignedIn]);

  const generateTransactionId = (length = 10) => {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let transactionId = "";

    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      transactionId += characters[randomIndex];
    }

    return transactionId;
  };

  if (failureParam) {
    return (
      <div className="transfer-funds-verify-page">
        <div className="content transfer-error-content">
          <i className="fa fa-times-circle-o" aria-hidden="true"></i>
          <h5>Verification failed</h5>
          <p>Something went wrong while verifying the transaction</p>
          <button onClick={() => navigate(ROUTES.HOME)}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!isSignedIn || isTransferInprogress) {
    return (
      <div className="transfer-funds-verify-page">
        <div className="content transfer-pending-content">
          <div className="spinner-border text-dark" role="status">
            <span>Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="transfer-funds-verify-page">
      <div className="content transfer-success-content">
        <i className="fa fa-check-circle-o" aria-hidden="true"></i>
        <h5>Transfer successful</h5>
        <div className="transaction-details">
          <div className="detail-row">
            <span className="label">Amount</span>
            <span className="value">{formatCurrency(amount)}</span>
          </div>

          <div className="detail-row">
            <span className="label">Receiver</span>
            <span className="value">{receiver}</span>
          </div>

          <div className="detail-row">
            <span className="label">Transaction ID</span>
            <span className="value">{generateTransactionId()}</span>
          </div>

          <div className="detail-row note-row">
            <span className="label">Note</span>
            <span className="value">{description}</span>
          </div>
        </div>
        <button onClick={() => navigate(ROUTES.HOME)}>Go Back</button>
      </div>
    </div>
  );
};

export default TransferFundsVerifyPage;
