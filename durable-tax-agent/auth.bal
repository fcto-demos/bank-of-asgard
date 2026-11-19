import ballerina/http;

// Three kinds of caller, all with JWTs signed by the IDP and audienced for this agent's client
// ID (TAX_AGENT_CLIENT_ID on the bank side), told apart by their scope. Signature, audience,
// expiry and scope are checked; the issuer is not pinned. Attached per resource rather than on
// the service, because a resource cannot opt out of service-level auth (`auth: []` still demands
// a token). The scopes are documented per operation in openapi.yaml (`ministryAuth`).

// The bank Coordinator's agent token: starts returns and follows them (status, pending steps).
// Every token issued through this agent's client has the right audience, citizens' and officers'
// included, so the scope is what limits these endpoints to the Coordinator. It is granted only to
// the Coordinator's agent identity, through a role.
final readonly & http:ListenerAuthConfig[] coordinatorAuth = [
    {
        jwtValidatorConfig: {
            audience: expectedAudience,
            signatureConfig: {
                jwksConfig: {url: string `${idpBaseUrl}/oauth2/jwks`}
            }
        },
        scopes: coordinatorScope
    }
];

// A tax officer's own token, from signing in to the Ministry inbox: reviews the evidence for
// provisional reliefs. The scope is what tells an officer from a citizen, so it is required.
final readonly & http:ListenerAuthConfig[] officerAuth = [
    {
        jwtValidatorConfig: {
            audience: expectedAudience,
            signatureConfig: {jwksConfig: {url: string `${idpBaseUrl}/oauth2/jwks`}}
        },
        scopes: officerScope
    }
];

// The citizen's own delegated (OBO) token, which the Coordinator obtains through the
// citizen's consent: the only credential that can confirm receipts or approve a filing. On top
// of this check, ownership.bal requires its `sub` to be the citizen the return was started for,
// so the agent's own token (whose `sub` is the agent) can never answer a task. With
// `citizenScope` set, the token must also carry that scope.
final readonly & http:ListenerAuthConfig[] citizenAuth = [
    citizenScope == ""
        ? {
            jwtValidatorConfig: {
                audience: expectedAudience,
                signatureConfig: {jwksConfig: {url: string `${idpBaseUrl}/oauth2/jwks`}}
            }
        }
        : {
            jwtValidatorConfig: {
                audience: expectedAudience,
                signatureConfig: {jwksConfig: {url: string `${idpBaseUrl}/oauth2/jwks`}}
            },
            scopes: citizenScope
        }
];
