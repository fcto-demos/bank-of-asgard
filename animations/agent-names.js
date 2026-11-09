// Display names of the demo's three agents, shared by the presentation pages
// (architecture-flow.html and inside-our-agents.html). Edit them here, then reload.
//
//   coordinator  the Transactions Agent (transactions-agent/)
//   savings      the Savings Goals Agent (savings-goals-agent/)
//   tax          the Ministry of Finance's Tax Agent (tax-agent/)
//
// A plain script rather than JSON so that the pages also work when opened directly
// as files (browsers block fetch() of local files). An empty name ('') makes
// inside-our-agents.html show the agent's display name from Agent Manager instead.
window.AGENT_NAMES = {
  coordinator: 'Saga',
  savings: 'Savvy',
  tax: 'Ouch'
};
