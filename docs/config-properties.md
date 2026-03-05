# 🔧 `config.js` - Configuration Guide

This file contains runtime environment-specific settings used by the frontend application.

## Configuration Fields

| Key                               | Description                                                                 |
|-----------------------------------|-----------------------------------------------------------------------------|
| `API_BASE_URL`                    | Base URL for initiating API requests (e.g., via an API Gateway or proxy). Example: `https://api.example.io`. For the local setup, this is the URL where the backend server is hosted. |
| `API_SERVICE_URL`                 | Full endpoint to reach backend services directly. Typically includes path/versioning. Example: `https://api.example.io/default/server/v1.0`. For the local setup, use the server URL without path/versioning. |
| `APP_BASE_URL`                    | Base URL where the frontend app is hosted. Example: `http://localhost:5173`. |
| `IDP_BASE_URL`               | Identity provider tenant URL. Example: `https://api.asgardeo.io/t/<ORG_NAME>`. |
| `ORGANIZATION_NAME`               | The organization (tenant) name — used to construct MyAccount and other IS URLs. Example: `carbon.super`. |
| `APP_CLIENT_ID`                   | OAuth/OpenID client ID for the SPA application registered in the identity provider. |
| `APP_NAME`                        | Display name for the application shown in the UI. |
| `DISABLED_FEATURES`               | Array of feature flags to disable specific frontend features. See supported flags below. |
| `TRANSFER_THRESHOLD`              | Maximum allowed transfer amount without additional verification. |
| `IDENTITY_VERIFICATION_PROVIDER_ID` | ID of the configured Identity Verification Provider (IdVP). Obtained from the Quick Start section of the Identity Verification Provider. |
| `IDENTITY_VERIFICATION_CLAIMS`   | List of user claims that require identity verification. Example: `["http://wso2.org/claims/dob"]`. Once any of these claims is updated, the user must re-verify. |
| `TRANSACTIONS_AGENT_URL`          | WebSocket URL for the Transactions AI Agent. Example: `ws://localhost:8011`. Use `wss://` for TLS connections (e.g. when behind a load balancer). |
| `DEMO_USERS`                      | Optional. Pre-fills the registration forms with demo data for quick setup. Set to `null` or remove the key to disable. See example below. |

## 🔒 Supported Feature Flags

The following feature flags can be used inside `DISABLED_FEATURES`:

| Flag                 | Description                                       |
|----------------------|---------------------------------------------------|
| `"identity-verification"` | Disables identity verification-related features. |
| `"odin-wallet"`           | Disables Odin Wallet integration.                |

## `DEMO_USERS` Example

```js
DEMO_USERS: {
  personal: {
    firstName: "Thor",
    lastName: "Odinson",
    username: "thor.odinson",
    email: "thor@asgard.demo",
    password: "Demo@12345",
    dateOfBirth: "1985-03-15",
    country: "Norway",
    mobile: "0411111111"
  },
  business: {
    firstName: "Loki",
    lastName: "Laufeyson",
    username: "loki.laufeyson",
    email: "loki@asgard.demo",
    password: "Demo@12345",
    dateOfBirth: "1987-06-01",
    country: "Norway",
    mobile: "0422222222",
    businessName: "Asgard Enterprises"
  }
}
```

> ℹ️ This file is meant to be environment-specific. Make sure to replace values when deploying to dev, staging, or production.
