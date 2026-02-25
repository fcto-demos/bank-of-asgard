window.config = {
  API_BASE_URL: "http://localhost:6000",
  API_SERVICE_URL: "http://localhost:6000",
  APP_BASE_URL: "http://localhost:5173",
  ASGARDEO_BASE_URL: "",
  ORGANIZATION_NAME: "",
  APP_CLIENT_ID: "",
  APP_NAME: "",
  DISABLED_FEATURES: [],
  TRANSFER_THRESHOLD: 10000,
  IDENTITY_VERIFICATION_PROVIDER_ID: "",
  IDENTITY_VERIFICATION_CLAIMS: [
    "http://wso2.org/claims/dob",
  ],
  TRANSACTIONS_AGENT_URL: "ws://localhost:8011",
  // Optional: pre-fill registration forms with demo data.
  // Remove or set to null to disable pre-filling.
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
}