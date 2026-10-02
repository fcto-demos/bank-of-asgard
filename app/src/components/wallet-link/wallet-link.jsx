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

import { useContext, useEffect } from "react";
import { environmentConfig } from "../../util/environment-util";
import { WalletContext } from "../../context/wallet-provider";

const VERIFIER_PORTAL_URL = environmentConfig.VERIFIER_PORTAL_URL || "http://localhost:3001";

// Replaces the old WebAuthn "Register a New Passkey" flow: the customer
// links their Digital ID Wallet instead, using the same verifier-portal
// popup + postMessage handshake as the Balance Statement flow in
// bank-account-card.jsx. Linked-wallet state lives in WalletContext
// (wallet-provider.jsx) so other panels - Balance Statement, Verify My
// Address - can gate themselves on isWalletLinked.
//
// Unlike a single linked/not-linked flag, this account can have more than
// one wallet linked (e.g. a phone replaced, a second device added). The
// "Link to my Wallet" action is always available, and every wallet that's
// been linked is listed below it by its holder id, rather than the button
// disappearing once one link exists.
const WalletLink = () => {
  const { linkAttemptStatus, setLinkAttemptStatus, linkedWallets, isWalletLinked, recordWalletLink } = useContext(WalletContext);

  useEffect(() => {
    const handleMessage = (event) => {
      const data = event.data;
      if (!data || data.source !== "meridian-verifier" || data.reason !== "wallet-link") {
        return;
      }
      if (data.status === "verified") {
        recordWalletLink(data.holderId);
      } else {
        setLinkAttemptStatus("failed");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const linkWallet = () => {
    setLinkAttemptStatus("pending");
    const popup = window.open(
      `${VERIFIER_PORTAL_URL}/verify?reason=wallet-link`,
      "meridianVerifierPopup",
      "width=440,height=780"
    );
    popup?.focus();
  };

  return (
    <div>
      <h6>Wallet</h6>

      {isWalletLinked && linkedWallets.length > 0 && (
        <ul className="linked-wallets-list" style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
          {linkedWallets.map((holderId) => (
            <li key={holderId} style={{ marginBottom: "4px", wordBreak: "break-all" }}>
              <i className="fa fa-check-circle" aria-hidden="true" style={{ color: "#27ae60", marginRight: "8px" }}></i>
              <code style={{ fontSize: "0.85rem" }}>{holderId}</code> is linked
            </li>
          ))}
        </ul>
      )}

      <button onClick={linkWallet} className="secondary" disabled={linkAttemptStatus === "pending"}>
        {linkAttemptStatus === "pending"
          ? "Waiting for wallet..."
          : isWalletLinked
          ? "Link another wallet"
          : "Link to my Wallet"}
      </button>

      {linkAttemptStatus === "pending" && (
        <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem" }}>
          A verification popup has been opened. Scan the QR code with your Digital ID Wallet to link it to this account.
        </p>
      )}
      {linkAttemptStatus === "failed" && (
        <p className="wallet-status-note" style={{ marginTop: "8px", fontSize: "0.85rem", color: "#c0392b" }}>
          Linking failed or was cancelled. Click &quot;Link to my Wallet&quot; to try again.
        </p>
      )}
    </div>
  );
};

export default WalletLink;
