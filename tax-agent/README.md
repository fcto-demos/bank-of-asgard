# Tax Agent (deprecated)

> [!WARNING]
> This Python tax agent is deprecated. Use the durable tax agent in [`durable-tax-agent/`](../durable-tax-agent/README.md) instead.

This was the first, single-call version of the Ministry of Finance's tax agent: one request assessed and filed a return, with no officer review. It has been replaced by the durable tax agent, a Ballerina agent running on Temporal. The durable agent files a return only once the citizen has signed it, has a tax officer review provisional reliefs within a deadline, and amends the return on its own when they are rejected or the deadline passes.

- The Coordinator (`transactions-agent/langchain-agent`) calls only the durable agent, at `TAX_AGENT_URL` (`http://localhost:8014/tax-agent`).
- `demo_scripts/start-demo.sh` and `demo_scripts/restart.sh tax` start the durable agent and no longer start this one. `demo_scripts/validate.sh` no longer checks it.
- Both use port `8014`, so don't run them together.

To show the tax flow in a demo, set up the durable agent as described in [`durable-tax-agent/README.md`](../durable-tax-agent/README.md) and the repository README's "Tax Agent" section.

The code stays here for reference only and is no longer maintained or kept in step with the Coordinator.
