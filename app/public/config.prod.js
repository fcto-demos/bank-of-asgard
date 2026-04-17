// Production config for https://app.apis.coach
// Copy this to config.js on the VM before running the deploy script.
window.config = {
  API_BASE_URL: "https://boa.apis.coach:451",
  API_SERVICE_URL: "https://boa.apis.coach:451",
  APP_BASE_URL: "https://boa.apis.coach:449",
  IDP_BASE_URL: "https://identity.dev.apis.coach:9445",
  ORGANIZATION_NAME: "carbon.super",
  APP_CLIENT_ID: "6VfEfHraf0U7ZEPj3Ku7kCKlfBoa",
  APP_NAME: "",
  DISABLED_FEATURES: [],
  TRANSFER_THRESHOLD: 10000,
  IDENTITY_VERIFICATION_PROVIDER_ID: "",
  IDENTITY_VERIFICATION_CLAIMS: [
    "http://wso2.org/claims/dob",
  ],
  TRANSACTIONS_AGENT_URL: "wss://boa-agent.apis.coach:450",
  DEMO_USERS: {
    personal: {
      firstName: "Personal",
      lastName: "User",
      username: "perso.user",
      email: "demouser@asgard.demo",
      password: "Demo@12345",
      dateOfBirth: "1985-03-15",
      country: "Spain",
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
}
