window.config = {
  API_BASE_URL: "http://localhost:3002",
  API_SERVICE_URL: "https://boa.apis.coach:447",
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
      firstName: "Biz",
      lastName: "Developer",
      username: "bizadmin",
      email: "bizdev@asgard.demo",
      password: "Demo@12345",
      dateOfBirth: "1987-06-01",
      country: "Spain",
      mobile: "0422222222",
      businessName: "Major Enterprises"
    }
  }
}

