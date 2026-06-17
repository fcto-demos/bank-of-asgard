# Dependency Audit

Run pip-audit across all Python services and npm audit across all Node packages. Fix all safe (non-breaking) findings automatically. Flag anything that requires a breaking change for the user to decide.

## Steps

1. **Run all pip-audits in parallel.** Each agent has its own `venv/` — activate it before running `pip-audit` so the correct binary and environment are used:
   - `source transactions-agent/langchain-agent/venv/bin/activate && pip-audit -r transactions-agent/langchain-agent/requirements.txt`
   - `source transactions-agent/autogen-agent/venv/bin/activate && pip-audit -r transactions-agent/autogen-agent/requirements.txt`
   - `source transactions-agent/strands-agent/venv/bin/activate && pip-audit -r transactions-agent/strands-agent/requirements.txt`
   - `source transactions-api/venv/bin/activate && pip-audit -r transactions-api/requirements.txt`
   - `source agencies-mcp-server/venv/bin/activate && pip-audit -r agencies-mcp-server/requirements.txt`

2. **Run npm audits in parallel:**
   - `app/` — `npm audit`
   - `server/` — `npm audit`

3. **For any pip-audit findings:** update the pinned version in the relevant `requirements.txt` to the minimum safe fix version. Re-run pip-audit to confirm clean.

4. **For any npm findings that `npm audit fix` can resolve without `--force`:** run `npm audit fix` and confirm clean.

5. **For npm findings that require `--force`** (breaking changes): do NOT apply automatically. Report them clearly with the CVE, current version, fix version, and what would break, then wait for the user to decide.

6. **Report a summary:**
   - Which services were clean
   - What was fixed and what version it was bumped to
   - What remains unfixed and why (breaking change / upstream not patched)
