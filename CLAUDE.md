# Bank of Asgard — Claude Instructions

## Documentation

**Always update `README.md` when a change affects the user experience.** This includes:
- New or changed CLI commands, scripts, or startup instructions
- New configuration options (env vars, `llm_config.yaml`, `config.js`)
- New providers, integrations, or services
- Renamed files, directories, or profiles that appear in user-facing commands
- New dependencies or changed installation steps

Do not wait to be asked. If the change is user-facing, update the docs in the same step.

## Code quality

- Run `ruff` and `flake8` (from `transactions-agent/`) after editing any Python service file.
- Both tools must pass with zero errors before considering a change complete.
- Config lives in `transactions-agent/ruff.toml` and `transactions-agent/.flake8`.

## Agent implementations

The three agent implementations live in:
- `transactions-agent/langchain-agent/`
- `transactions-agent/autogen-agent/`
- `transactions-agent/strands-agent/`

Each has its own `venv/`, `requirements.txt`, `service.py`, and `tool.py`.

**The folder names use the `-agent` suffix to avoid Python namespace collisions** with the
`langchain`, `autogen`, and `strands` PyPI packages. Docker Compose profiles keep the
short names (`langchain`, `autogen`, `strands`) — do not add `-agent` to profile names.

The correct native run command (from `transactions-agent/`):
```bash
PYTHONPATH=$(pwd) uvicorn service:app --app-dir <agent-folder> --reload --port 8011
```
Do **not** use `uvicorn langchain.service:app` — that shadows the installed `langchain` library.

## LLM providers

Supported providers in `llm_config.yaml`: `openai`, `gemini`, `anthropic`, `bedrock`, `mistral`.
When adding a new provider, update all three service files **and** `README.md`.

## Git

Never run `git add` or `git commit` — the user handles all staging and commits.
