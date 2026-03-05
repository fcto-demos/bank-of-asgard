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

import { useMemo } from "react";
import { useState } from "react";
import { environmentConfig } from "../util/environment-util";
import { ROUTES } from "../constants/app-constants";
import { useNavigate } from "react-router";
import { useSnackbar } from "notistack";
import { useContext } from "react";
import { BankAccountContext } from "../context/bank-account-provider";

const TransferFundsPage = () => {
  const receivers = [
    { value: "thor", label: "Thor Odinson - Asgard Main Vault" },
    { value: "loki", label: "Loki Laufeyson - Trickster's Reserve" },
    { value: "odin", label: "Odin Allfather - Royal Treasury" },
    { value: "hela", label: "Hela - Realm of the Dead Account" },
    { value: "sif", label: "Sif - Warrior's Fund" },
  ];

  const initialFormData = {
    sender: "083434342982340",
    receiver: "",
    description: "",
    amount: "",
  };

  const transferThreshold = environmentConfig.TRANSFER_THRESHOLD;

  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const { bankAccountData } = useContext(BankAccountContext);

  const [formData, setFormData] = useState(initialFormData);

  const isFormValid = useMemo(() => {
    return (
      formData.sender &&
      formData.receiver &&
      formData.description &&
      formData.amount &&
      parseInt(formData.amount) > 0
    );
  }, [formData]);

  const handleTransfer = async (e) => {
    e.preventDefault();

    if (isFormValid) {
      const transferAmount = parseInt(formData.amount);
      if (transferAmount > bankAccountData.balance) {
        enqueueSnackbar("Insufficient balance", {
          variant: "error",
        });
        return;
      }

      // If transfer amount is more than threshold, require email OTP verification.
      // Threshold is defined in config.js
      if (transferAmount > transferThreshold) {
        try {
          const receiverName = receivers.find(
            (receiver) => receiver.value === formData.receiver
          )?.label;
          const redirectUrl = `${environmentConfig.APP_BASE_URL}${ROUTES.FUND_TRANSFER_VERIFY}`;

          const params = new URLSearchParams();
          params.append("action", "money-transfer");
          params.append("transfer_amount", formData.amount);
          params.append("redirect_uri", redirectUrl);
          params.append("response_type", "code");
          params.append("client_id", environmentConfig.APP_CLIENT_ID);
          params.append(
            "scope",
            [
              "openid",
              "address",
              "email",
              "phone",
              "profile",
              "internal_login",
            ].join(" ")
          );

          const stateObj = {
            amount: formData.amount,
            receiver: receiverName,
            description: formData.description,
          };
          const stateString = JSON.stringify(stateObj);
          params.append("state", stateString);

          const authURL = `${environmentConfig.IDP_BASE_URL}/oauth2/authorize?${params}`;

          for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key.startsWith("session_data-")) {
              sessionStorage.removeItem(key);
            }
          }

          window.location.href = authURL;
        } catch (error) {
          console.error("Error signing in:", error);
        }
      } else {
        const receiverName = receivers.find(
          (receiver) => receiver.value === formData.receiver
        )?.label;

        const stateObj = {
          amount: formData.amount,
          receiver: receiverName,
          description: formData.description,
        };
        const stateString = JSON.stringify(stateObj);

        const params = new URLSearchParams();
        params.append("state", stateString);

        navigate({
          pathname: ROUTES.FUND_TRANSFER_VERIFY,
          search: params.toString(),
        });
      }
    }
  };

  return (
    <div className="transfer-funds-page">
      <div className="form-container">
        <h5>Money Transfer</h5>
        <p>
          Welcome to the divine transfer service. Use this form to send your
          funds to the esteemed characters of Asgard.
        </p>
        <form onSubmit={handleTransfer}>
          <label htmlFor="sender">Sender Account</label>
          <input
            type="text"
            id="sender"
            name="sender"
            placeholder="Enter your account number"
            value={formData.sender}
            disabled
            required
          />

          <label htmlFor="receiver">Receiver (Asgardian Account)</label>
          <select
            id="receiver"
            name="receiver"
            value={formData.receiver}
            onChange={(e) =>
              setFormData({ ...formData, receiver: e.target.value })
            }
            required
          >
            <option value="">Select receiver</option>
            {receivers.map((receiver) => (
              <option key={receiver.value} value={receiver.value}>
                {receiver.label}
              </option>
            ))}
          </select>

          <label htmlFor="description">Transfer Description</label>
          <input
            id="description"
            name="description"
            placeholder="Enter a description for the transfer"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            required
          />

          <label htmlFor="amount">Amount (USD)</label>
          <input
            type="number"
            id="amount"
            name="amount"
            placeholder="Enter amount in USD"
            value={formData.amount}
            onChange={(e) =>
              setFormData({ ...formData, amount: e.target.value })
            }
            min="1"
            required
          />

          <button type="submit" className={`${isFormValid ? "" : "disabled"}`}>
            Transfer Funds
          </button>
          <button className="secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
};

export default TransferFundsPage;
