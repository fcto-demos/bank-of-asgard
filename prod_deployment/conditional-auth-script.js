var moneyTransferThres = 10000;
var riskEndpoint = "<NODE_SERVER_BASE_PATH>/risk"
var enrolUserInAuthenticationFlow = "false";
var loginType = "";

var onLoginRequest = function(context) {

    var isMoneyTransfer = context.request.params.action && context.request.params.action[0] === "money-transfer";
    if (isMoneyTransfer) {
        Log.info("Custom param:" + context.request.params.action[0]);
        Log.info("Custom param:" + context.request.params.transfer_amount[0]);
        var amount = parseInt(context.request.params.transfer_amount[0] || -1);

        executeStep(1);
        if (amount > moneyTransferThres) {
            executeStep(4, {
                stepOptions: {
                    forceAuth: 'true'
                }
            }, {});
        }

    } else {

        var loginTypeParam = context.request.params.loginType;

        if (loginTypeParam != null) {
            loginType = String(loginTypeParam[0] || "");
        }
        executeStep(1, {
            onSuccess: function(context) {
                var user = context.steps[1].subject;
                var accountType = user.localClaims["http://wso2.org/claims/accountType"];
                var country = user.localClaims["http://wso2.org/claims/country"];
                Log.info("Account Type: " + accountType);
                Log.info("Country: " + country);
                var ipAddress = context.request.ip;
                Log.info("IP Address: " + ipAddress);
                var requestPayload = {
                    ip: ipAddress,
                    country: country,
                };
                if (accountType === "Personal") {
                    if (loginType != "" && loginType != accountType) {
                        fail({
                            'errorCode': 'login_failed',
                            'errorMessage': 'User not found.',
                        });
                    }
                    httpPost(riskEndpoint, requestPayload, {
                        "Accept": "application/json"
                    }, {
                        onSuccess: function(context, data) {
                            Log.info("Successfully invoked the external API.");
                            Log.info("Logging data for country risk: " + data.hasRisk);

                            if (data.hasRisk === false) {
                                executeStep(2, {
                                    authenticationOptions: [{
                                        authenticator: 'FIDOAuthenticator'
                                    }, {
                                        authenticator: 'BasicAuthenticator'
                                    }]
                                }, {
                                    onSuccess: function(context) {
                                        var user = context.currentKnownSubject;
                                        var sessions = getUserSessions(user);
                                        Log.info(sessions);
                                        if (sessions.length > 0) {
                                            executeStep(3, {
                                                authenticationOptions: [{
                                                    authenticator: 'email-otp-authenticator'
                                                }]
                                            }, {});
                                        }
                                    }
                                });
                            } else {
                                executeStep(2, {
                                    authenticationOptions: [{
                                        authenticator: 'FIDOAuthenticator'
                                    }, {
                                        authenticator: 'BasicAuthenticator'
                                    }],
                                }, {});
                                Log.info("In 2nd step for Personal Accounts");

                                executeStep(3, {
                                    authenticationOptions: [{
                                        authenticator: 'email-otp-authenticator'
                                    }]
                                }, {});
                            }
                        },
                        onFail: function(context, data) {
                            Log.error("Failed to invoke risk API");
                            fail();
                        }
                    });
                } else if (accountType === "Business") {
                    Log.info("In second step for Business");

                    executeStep(2, {
                        authenticationOptions: [{
                            authenticator: 'BasicAuthenticator'
                        }]
                    }, {});
                    var preferredClaimURI = "http://wso2.org/claims/identity/preferredMFAOption";
                    var preferredClaim = user.localClaims[preferredClaimURI];

                    if (preferredClaim != null) {
                        Log.info("Preferred Claim Available");

                        var jsonObj = JSON.parse(preferredClaim);
                        var authenticationOption = jsonObj.authenticationOption;
                        Log.info("preferredClaim authenticationOption " + authenticationOption);
                        executeStep(3, {
                            authenticationOptions: [{
                                authenticator: authenticationOption
                            }],
                        }, {});
                    } else {
                        Log.info("Preferred claim not available and in 3rd step");
                        executeStep(3, {
                            authenticatorParams: {
                                common: {
                                    'enrolUserInAuthenticationFlow': enrolUserInAuthenticationFlow
                                }
                            },
                            authenticationOptions: [{
                                authenticator: 'totp'
                            }, {
                                authenticator: 'email-otp-authenticator'
                            }]
                        }, {
                            onSuccess: function(context) {
                                var preferredClaimURI = "http://wso2.org/claims/identity/preferredMFAOption";
                                Log.info("3rd step successful");
                                var user = context.steps[3].subject;
                                var isFirstLogin = user.localClaims["http://wso2.org/claims/isFirstLogin"];
                                Log.info("User isFirstLogin claim:" + isFirstLogin);
                                if (isFirstLogin === "false") {
                                    var authenticatorName = context.steps[3].authenticator;
                                    var preferredMFA = {
                                        authenticationOption: authenticatorName
                                    };
                                    user.localClaims[preferredClaimURI] = JSON.stringify(preferredMFA);
                                    Log.info("Preferred MFA set from second login for user" + user.username + " as " + user.localClaims[preferredClaimURI]);
                                } else {
                                    user.localClaims["http://wso2.org/claims/isFirstLogin"] = false;
                                    Log.info("User logged in for the first time. Setting isFirstLogin to false");
                                }
                            }
                        });
                    }
                } else {

                    var username = user.username;
                    var organizationName = null;

                    if (loginType != "" && loginType === 'Business' && username && username.indexOf("@") > -1) {
                        var domain = username.split("@")[1];
                        organizationName = domain.split(".")[0];

                        executeStep(2, {
                            authenticatorParams: {
                                local: {
                                    OrganizationAuthenticator: {
                                        org: organizationName
                                    }

                                }
                            },
                            authenticationOptions: [{
                                idp: "SSO"
                            }]
                        }, {
                            onSuccess: function(context) {
                                isDefault = false;
                            }
                        });
                    } else {
                        executeStep(2, {
                            authenticationOptions: [{
                                authenticator: 'BasicAuthenticator'
                            }]
                        }, {});
                    }
                }
            },
            onFail: function(context) {
                Log.info('User not found');
                var parameterMap = {
                    'errorCode': 'login_failed',
                    'errorMessage': 'login could not be completed',
                    "errorURI": 'https://localhost:9443/authenticationendpoint/login.jsp'
                };
                fail(parameterMap);

            }
        });
    }
};
