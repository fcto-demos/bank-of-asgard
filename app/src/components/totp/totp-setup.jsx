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
import { QRCodeCanvas } from "qrcode.react";
import { environmentConfig } from "../../util/environment-util";

const TotpSetup = () => {
    const { isSignedIn, http } = useAsgardeo();
    const [qrCodeUrl, setQrCodeUrl] = useState(null);
    const [decodedQrCodeUrl, setDecodedQrCodeUrl] = useState(null);
    const [error, setError] = useState(null);
    const [otpCode, setOtpCode] = useState("");
    const [isValidating, setIsValidating] = useState(false);
    const [setupComplete, setSetupComplete] = useState(false);
    const [totpEnabled, setTotpEnabled] = useState(false);

    const request = requestConfig =>
        http.request(requestConfig)
            .then(response => response)
            .catch(error => error);

    useEffect(() => {
        checkTotpStatus();
    }, []);

    const checkTotpStatus = async () => {
        try {
            const response = await request({
                method: "GET",
                url: `${environmentConfig.IDP_BASE_URL}/scim2/Me`,
                headers: { "Content-Type": "application/json" },
            });
            console.log(response.data);

            if (response.data["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"]?.totpEnabled
            && response.data["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"]?.totpEnabled == "true"
            ) {
                setTotpEnabled(true);
                fetchQrCode(); // If already enabled, show QR code
            } else if(response.data["urn:scim:wso2:schema"]?.totpEnabled && 
                response.data["urn:scim:wso2:schema"]?.totpEnabled == "true") {
                setTotpEnabled(true);
                fetchQrCode(); // If already enabled, show QR code
                
            } else {
                setTotpEnabled(false);
            }
        } catch (err) {
            setError("Error checking TOTP status: " + (err.response?.data?.detail || err.message));
        }
    };


    const registerTotp = async () => {
        try {
            const response = await request({
                method: "POST",
                url: `${environmentConfig.IDP_BASE_URL}/api/users/v1/me/totp`,
                headers: { "accept": "application/json" },
                data: { "action": "INIT" }
            });

            if (response.data.qrCodeUrl) {
                console.log(response.data.qrCodeUrl);
                setQrCodeUrl(response.data.qrCodeUrl);
                setDecodedQrCodeUrl(decodeBase64(response.data.qrCodeUrl));

            } else {
                setError("Failed to register TOTP.");
            }
        } catch (err) {
            setError("Error setting up TOTP: " + (err.response?.data?.detail || err.message));
        }
    };

    const fetchQrCode = async () => {
        try {
            const response = await request({
                method: "POST",
                url: `${environmentConfig.IDP_BASE_URL}/api/users/v1/me/totp`,
                headers: { "Content-Type": "application/json" },
                data: { action: "VIEW" },
            });
            console.log(response.data);
            if (response.data?.qrCodeUrl) {
                setQrCodeUrl(response.data.qrCodeUrl);
                setDecodedQrCodeUrl(decodeBase64(response.data.qrCodeUrl));
            } else {
                setError("Failed to retrieve QR code.");
            }
        } catch (err) {
            setError("Error fetching QR code: " + (err.response?.data?.detail || err.message));
        }
    };

    const validateOtp = async () => {
        try {
            if (!otpCode) {
                setError("Please enter the OTP code.");
                return;
            }
            setIsValidating(true);

            const response = await request({
                method: "POST",
                url: `${environmentConfig.IDP_BASE_URL}/api/users/v1/me/totp`,
                headers: { "Content-Type": "application/json" },
                data: { action: "VALIDATE", verificationCode: otpCode },
            });

            if (response.data.isValid) {
                setSetupComplete(true);
            } else {
                setError("Invalid OTP. Please try again.");
            }
        } catch (err) {
            setError("Error validating OTP: " + (err.response?.data?.detail || err.message));
        } finally {
            setIsValidating(false);
        }
    };

    const decodeBase64 = (encodedString) => {
        try {
          return atob(encodedString);
        } catch (e) {
          console.error("Failed to decode QR Code URL:", e);
          return null;
        }
    };

    return (
        <div>
            { setupComplete ? (
                <>
                    <p>TOTP setup is complete. You can now use the authenticator app.</p>
                </>
            ) : (
                <>
                    { totpEnabled ? (
                        <>
                            <p>Scan this QR code to reconfigure your authenticator app:</p>
                            { qrCodeUrl && 
                                <div style={{ padding: "10px", display: "inline-block" }}>
                                    <QRCodeCanvas value={decodedQrCodeUrl}/>
                                </div>
                            }
                        </>
                    ) : (
                        <>
                            {!qrCodeUrl ? (
                                <button onClick={registerTotp}>Generate QR Code</button>
                            ) : (
                                <>
                                    <p>Scan this QR code with your authenticator app:</p>
                                    <div style={{ padding: "10px", display: "inline-block" }}>

                                        <QRCodeCanvas value={decodedQrCodeUrl}/>
                                    </div>
                                    <hr />
                                    <p>Enter the 6-digit OTP code generated by your app:</p>
                                    <input
                                        type="text"
                                        placeholder="Enter OTP"
                                        value={otpCode}
                                        onChange={(e) => setOtpCode(e.target.value)}
                                    />
                                    <button onClick={validateOtp} disabled={isValidating} style={ { marginTop: "10px" } }>
                                        { isValidating ? "Validating..." : "Validate OTP" }
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </>
            )}
            {error && <p style={{ color: "red" }}>{error}</p>}
        </div>
    );
}

export default TotpSetup;