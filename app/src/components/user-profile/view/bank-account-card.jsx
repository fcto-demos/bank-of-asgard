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
import { useContext, useEffect, useState } from "react";
import { BankAccountContext } from "../../../context/bank-account-provider";
import { WalletContext } from "../../../context/wallet-provider";
import { useAsgardeo } from "@asgardeo/react";
import { environmentConfig } from "../../../util/environment-util";

const VERIFIER_PORTAL_URL = environmentConfig.VERIFIER_PORTAL_URL || "http://localhost:3001";
const VERIFIER_PORTAL_ADDRESS_URL = environmentConfig.VERIFIER_PORTAL_ADDRESS_URL || "http://localhost:3003";

const BankAccountCard = ({ userInfo }) => {
  const initialCreditCardState = {
    cardNumber: "4574-3434-2984-2365",
    balance: -45600.67,
  };

  const navigate = useNavigate();
  const { bankAccountData } = useContext(BankAccountContext);
  const { isWalletLinked, recordAddressVerification } = useContext(WalletContext);
  const { getAccessToken } = useAsgardeo();
  const [txnSummary, setTxnSummary] = useState(/** @type {any} */ (null));
  const [provisioning, setProvisioning] = useState(false);

  const [statementStatus, setStatementStatus] = useState("idle"); // idle | pending | verified | failed
  const [issueCredentialsStatus, setIssueCredentialsStatus] = useState("idle"); // idle | pending | issued | failed
  const [verifyAddressStatus, setVerifyAddressStatus] = useState("idle"); // idle | pending | verified | failed

  const loadSummary = () =>
    getAccessToken()
      .then((token) =>
        fetch(`${environmentConfig.API_SERVICE_URL}/transactions-summary`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((res) => res.json())
      .then((data) => setTxnSummary(data))
      .catch(() => setTxnSummary({ total: 0, recent: [], monthly_counts: {} }));

  useEffect(() => { loadSummary(); }, []);

  const handleReprovision = () => {
    setProvisioning(true);
    getAccessToken()
      .then((token) =>
        fetch(`${environmentConfig.API_SERVICE_URL}/reprovision`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then(() => loadSummary())
      .catch(() => {})
      .finally(() => setProvisioning(false));
  };

  // Verifier-portal popups (Balance Statement verification, Bank ID
  // credential issuance, address verification) all postMessage back here
  // once the wallet interaction completes - this listener is the one place
  // that reacts to all three, keyed off data.reason.
  useEffect(() => {
    const handleMessage = (event) => {
      const data = event.data;
      if (!data || data.source !== "meridian-verifier") {
        return;
      }
      const verified = data.status === "verified";
      if (data.reason === "statement") {
        setStatementStatus(verified ? "verified" : "failed");
      } else if (data.reason === "issue-credentials") {
        setIssueCredentialsStatus(verified ? "issued" : "failed");
      } else if (data.reason === "verify-address") {
        setVerifyAddressStatus(verified ? "verified" : "failed");
        if (verified && data.address) {
          recordAddressVerification(data.address);
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const requestStatement = () => {
    setStatementStatus("pending");
    const popup = window.open(
      `${VERIFIER_PORTAL_URL}/verify?reason=statement`,
      "meridianVerifierPopup",
      "width=440,height=780"
    );
    popup?.focus();
  };

  const requestIssueCredentials = () => {
    setIssueCredentialsStatus("pending");
    // Issuance (OID4VCI) is a distinct flow from the OID4VP verification
    // popups above - it hits /issue, which shows a credential-offer QR code
    // rather than asking the wallet to prove anything.
    const popup = window.open(
      `${VERIFIER_PORTAL_URL}/issue?reason=issue-credentials`,
      "meridianVerifierPopup",
      "width=440,height=780"
    );
    popup?.focus();
  };

  const requestVerifyAddress = () => {
    setVerifyAddressStatus("pending");
    const popup = window.open(
      `${VERIFIER_PORTAL_ADDRESS_URL}/verify?reason=verify-address`,
      "meridianVerifierPopup",
      "width=440,height=780"
    );
    popup?.focus();
  };

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
            <li
              className={isWalletLinked && statementStatus === "verified" ? "" : "disabled"}
              title={!isWalletLinked ? "Link your Digital ID Wallet in Account Security first" : ""}
              onClick={
                !isWalletLinked
                  ? undefined
                  : statementStatus === "verified"
                  ? () => window.open(`${VERIFIER_PORTAL_URL}/verify?reason=statement`, "meridianVerifierPopup", "width=440,height=780")
                  : statementStatus === "pending"
                  ? undefined
                  : requestStatement
              }
              style={{ cursor: !isWalletLinked ? "not-allowed" : statementStatus === "pending" ? "wait" : "pointer" }}
            >
              <i className="fa fa-file-text" aria-hidden="true"></i>
              <span>
                {!isWalletLinked && "Balance Statement (Link your wallet first)"}
                {isWalletLinked && statementStatus === "pending" && "Verifying identity..."}
                {isWalletLinked && statementStatus === "verified" && "Balance Statement (Verified)"}
                {isWalletLinked && statementStatus === "failed" && "Balance Statement (Verification failed - retry)"}
                {isWalletLinked && statementStatus === "idle" && "Balance Statement"}
              </span>
            </li>
            <li
              className={issueCredentialsStatus === "issued" ? "" : "disabled"}
              onClick={
                issueCredentialsStatus === "issued"
                  ? () => window.open(`${VERIFIER_PORTAL_URL}/issue?reason=issue-credentials`, "meridianVerifierPopup", "width=440,height=780")
                  : issueCredentialsStatus === "pending"
                  ? undefined
                  : requestIssueCredentials
              }
              style={{ cursor: issueCredentialsStatus === "pending" ? "wait" : "pointer" }}
            >
              <i className="fa fa-id-badge" aria-hidden="true"></i>
              <span>
                {issueCredentialsStatus === "pending" && "Issuing credential..."}
                {issueCredentialsStatus === "issued" && "Issue Credentials (Issued)"}
                {issueCredentialsStatus === "failed" && "Issue Credentials (Failed - retry)"}
                {issueCredentialsStatus === "idle" && "Issue Credentials"}
              </span>
            </li>
            <li
              className={isWalletLinked && verifyAddressStatus === "verified" ? "" : "disabled"}
              title={!isWalletLinked ? "Link your Digital ID Wallet in Account Security first" : ""}
              onClick={
                !isWalletLinked
                  ? undefined
                  : verifyAddressStatus === "verified"
                  ? () => window.open(`${VERIFIER_PORTAL_ADDRESS_URL}/verify?reason=verify-address`, "meridianVerifierPopup", "width=440,height=780")
                  : verifyAddressStatus === "pending"
                  ? undefined
                  : requestVerifyAddress
              }
              style={{ cursor: !isWalletLinked ? "not-allowed" : verifyAddressStatus === "pending" ? "wait" : "pointer" }}
            >
              <i className="fa fa-map-marker" aria-hidden="true"></i>
              <span>
                {!isWalletLinked && "Verify My Address (Link your wallet first)"}
                {isWalletLinked && verifyAddressStatus === "pending" && "Verifying address..."}
                {isWalletLinked && verifyAddressStatus === "verified" && "Address Verified"}
                {isWalletLinked && verifyAddressStatus === "failed" && "Verify My Address (Failed - retry)"}
                {isWalletLinked && verifyAddressStatus === "idle" && "Verify My Address"}
              </span>
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

          {!isWalletLinked && (
            <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "#888" }}>
              Link your Digital ID Wallet under Account Security to unlock Balance Statement and Verify My Address.
            </p>
          )}

          {isWalletLinked && statementStatus === "pending" && (
            <p className="statement-status-note" style={{ marginTop: "8px", fontSize: "0.85rem" }}>
              A verification popup has been opened. Complete identity verification in your Digital ID Wallet to unlock your balance statement.
            </p>
          )}
          {isWalletLinked && statementStatus === "failed" && (
            <p className="statement-status-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "#c0392b" }}>
              Verification failed or was cancelled. Click &quot;Balance Statement&quot; to try again.
            </p>
          )}
          {isWalletLinked && statementStatus === "verified" && (
            <p className="statement-status-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "#27ae60" }}>
              Identity verified. Click &quot;Balance Statement&quot; again to download it.
            </p>
          )}

          {issueCredentialsStatus === "pending" && (
            <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem" }}>
              A verification popup has been opened. Check your Digital ID Wallet to accept the credential being issued.
            </p>
          )}
          {issueCredentialsStatus === "failed" && (
            <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "#c0392b" }}>
              Credential issuance failed or was cancelled. Click &quot;Issue Credentials&quot; to try again.
            </p>
          )}
          {issueCredentialsStatus === "issued" && (
            <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "#27ae60" }}>
              Credential issued. Check your Digital ID Wallet to view it.
            </p>
          )}

          {isWalletLinked && verifyAddressStatus === "pending" && (
            <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem" }}>
              A verification popup has been opened. Approve the address-sharing request in your Digital ID Wallet.
            </p>
          )}
          {isWalletLinked && verifyAddressStatus === "failed" && (
            <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "#c0392b" }}>
              Address verification failed or was cancelled. Click &quot;Verify My Address&quot; to try again.
            </p>
          )}
          {isWalletLinked && verifyAddressStatus === "verified" && (
            <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "#27ae60" }}>
              Your address has been verified via your Digital ID Wallet.
            </p>
          )}

          <hr />
          <h5>Recent Transactions</h5>
          {txnSummary === null ? (
            <p style={{ fontSize: "13px", color: "#999", margin: "6px 0 10px" }}>Loading...</p>
          ) : txnSummary.total === 0 ? (
            <div style={{ margin: "6px 0 10px" }}>
              <p style={{ fontSize: "13px", color: "#c88", marginBottom: "8px" }}>No transactions provisioned yet.</p>
              <button
                onClick={handleReprovision}
                disabled={provisioning}
                style={{
                  background: "none", border: "none", padding: 0,
                  fontSize: "12px", color: provisioning ? "#bbb" : "#aaa",
                  cursor: provisioning ? "default" : "pointer",
                  textDecoration: "underline",
                }}
              >
                {provisioning ? "Provisioning…" : "Provision demo data"}
              </button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: "13px", color: "#666", marginBottom: "8px" }}>
                {txnSummary.total} transactions on file
              </p>
              <ul className="accounts-list" style={{ marginBottom: "10px" }}>
                {txnSummary.recent.map((/** @type {any} */ t) => (
                  <li key={t.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontSize: "12px", color: "#888" }}>{t.date}</span>
                        <span style={{ fontSize: "13px", marginLeft: "8px" }}>{t.merchant}</span>
                      </div>
                      <span style={{ fontSize: "13px", fontWeight: 500, color: t.amount < 0 ? "#c00" : "#2a7" }}>
                        {formatCurrency(t.amount)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <hr />
          <h5>Asgard Assistant</h5>
          <p style={{ fontSize: "14px", color: "#666", marginBottom: "10px" }}>
            Review your transaction history and get AI-powered spending insights.
          </p>
          <div className="form-buttons">
            <button className="edit-button" onClick={() => navigate(ROUTES.TRANSACTIONS)}>
              Open Asgard Assistant
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

BankAccountCard.propTypes = {
  userInfo: PropTypes.object,
};

export default BankAccountCard;
