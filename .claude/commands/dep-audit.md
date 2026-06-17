# Dependency Audit

Run pip-audit across all Python services and npm audit across all Node packages. Fix all safe (non-breaking) findings automatically. Flag anything that requires a breaking change for the user to decide.

## Steps

1. **Run all pip-audits in parallel:**
   - `transactions-agent/langchain-agent/requirements.txt`
   - `transactions-agent/autogen-agent/requirements.txt`
   - `transactions-agent/strands-agent/requirements.txt`
   - `transactions-api/requirements.txt`
   - `agencies-mcp-server/requirements.txt`

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
