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

import { useState, useEffect } from "react";
import { useAsgardeo } from "@asgardeo/react";
import { environmentConfig } from "../../util/environment-util";

const PasskeySetup = () => {
    const { isSignedIn, http } = useAsgardeo();
    const [passkeys, setPasskeys] = useState([]);
    const [error, setError] = useState(null);

    const request = requestConfig =>
        http.request(requestConfig)
            .then(response => ({
                ...response,
                data: typeof response.data === "string" ? JSON.parse(response.data) : response.data
            }));

    useEffect(() => {
        fetchPasskeys();
    }, []);

    // Fetch existing passkeys from Asgardeo
    const fetchPasskeys = () => {
        request({
            method: "GET",
            url: `${environmentConfig.IDP_BASE_URL}/api/users/v2/me/webauthn`,
            headers: { "Content-Type": "application/json" },
        })
            .then((response) => {
                setPasskeys(response.data || []);
            })
            .catch((err) => {
                setError("Error fetching passkeys: " + (err.response?.data?.detail || err.message));
            });
    };


    const formatFormURLEncoded = (data) => {
        return Object.keys(data)
            .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(data[key]))
            .join("&");
    };

    // convert to buffer
    const getDecodedBuffer = (value) => {
        try {
            if (value != null) {
                const padding = "=".repeat((4 - (value.length % 4)) % 4);
                const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
                const rawData = atob(base64);
                return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0))).buffer;
            }
        } catch (e) {
            console.error("Failed to decode Base64:", e);
            return null;
        }
        return value;
    };

    const arrayBufferToBase64Url = (buffer) => {
        const binary = String.fromCharCode.apply(null, new Uint8Array(buffer));
        const base64 = btoa(binary);
        return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); // Convert to Base64URL format
      };


    const publicKeyCredentialToJSON = (pubKeyCred) => {
        if (pubKeyCred instanceof Array) {
            let arr = [];
            for (let i of pubKeyCred)
                arr.push(publicKeyCredentialToJSON(i));
            return arr
        }

        if (pubKeyCred instanceof ArrayBuffer) {
            return arrayBufferToBase64Url(pubKeyCred)
        }

        if (pubKeyCred instanceof Object) {
            let obj = {};

            for (let key in pubKeyCred) {
                obj[key] = publicKeyCredentialToJSON(pubKeyCred[key])
            }

            return obj
        }
        return pubKeyCred
    }

    // Original passkey registration flow — preserved for future restoration.
    // To re-enable, make startPasskeyRegistration call _registerPasskey().
    const _registerPasskey = () => {

        const formData = formatFormURLEncoded({ appId: environmentConfig.APP_BASE_URL }); // Format correctly

        request({
            method: "POST",
            url: `${environmentConfig.IDP_BASE_URL}/api/users/v2/me/webauthn/start-usernameless-registration`,
            headers: {
                "accept": "application/json",
                'Content-type': 'application/x-www-form-urlencoded;charset=utf-8'
            },
            data: formData
        })
            .then((response) => {
                if (!response.data || !response.data.publicKeyCredentialCreationOptions) {
                    throw new Error("Failed to retrieve WebAuthn challenge.");
                }

                let options = response.data.publicKeyCredentialCreationOptions;
                options.challenge = getDecodedBuffer(options.challenge);
                options.user.id = getDecodedBuffer(options.user.id);

                // Decode `excludeCredentials.id` if exists
                if (options.excludeCredentials) {
                    options.excludeCredentials = options.excludeCredentials.map((cred) => ({
                        ...cred,
                        id: getDecodedBuffer(cred.id),
                    }));
                }

                return navigator.credentials.create({ publicKey: options }).then((credential) => ({
                    credential,
                    requestId: response.data.requestId, // Store requestId for finish-registration
                }));
            })
            .then(({ credential, requestId }) => {
                if (!credential) {
                    throw new Error("Passkey registration failed.");
                }

                const payload = {
                    requestId: requestId,
                    credential: credential
                }
                let assertionresponse;
                try {
                    assertionresponse = publicKeyCredentialToJSON(payload.credential);
                } catch (error) {
                    console.error(error);
                }

                payload.credential = assertionresponse;
                let finalPay = JSON.stringify(payload);
                return request({
                    method: "POST",
                    url: `${environmentConfig.IDP_BASE_URL}/api/users/v2/me/webauthn/finish-registration`,
                    headers: { "Content-Type": "application/json" },
                    data: finalPay,
                }).then(() => credential.id);
            })
            .then((credentialId) => {
                // Prompt user for display name
                const displayName = prompt("Enter a name for this device (e.g., 'MacBook Pro', 'iPhone')");

                if (!displayName) {
                    throw new Error("Display name cannot be empty.");
                }

                // Update passkey display name with PATCH request
                return request({
                    method: "PATCH",
                    url: `${environmentConfig.IDP_BASE_URL}/api/users/v2/me/webauthn/${credentialId}`,
                    headers: { "Content-Type": "application/json" },
                    data: [
                        {
                            operation: "REPLACE",
                            path: "/displayName",
                            value: displayName,
                        },
                    ],
                });
            })
            .then(() => {
                fetchPasskeys(); // Refresh the list
            })
            .catch((err) => {
                setError("Error during passkey registration: " + (err.message || "Unknown error"));
            });
    };

    const startPasskeyRegistration = () => {
        window.open(`${environmentConfig.IDP_BASE_URL}/t/${environmentConfig.ORGANIZATION_NAME}/myaccount/`, "_blank");
    };

    return (
        <div>
            <h6>Passkeys</h6>
            <button onClick={startPasskeyRegistration} className="secondary">Register a New Passkey</button>

            {passkeys.length === 0 ? (
                <></>
            ) : (
                <div>
                    <h6>Registered Passkeys</h6>
                    <ul className="accounts-list">
                        {passkeys.map((pk) => (
                            <li key={pk.credential.credentialId}>
                                <i className="fa fa-address-card" aria-hidden="true" style={ { marginRight: "10px" }}></i> { pk.displayName || "Unnamed Device" }
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {error && <p style={{ color: "red" }}>{error}</p>}
        </div>
    );
}

export default PasskeySetup;