# Rewind backend

Rewind corrects shared agent memory by tracing evidence through FalkorDB. Revoking one source invalidates unsupported downstream facts and plans, preserves independent evidence, and blocks proposals made against stale memory.

This repository implements the backend and agent tooling. Your UI can consume its REST endpoints. All company data and payment receipts are fictional; there is no bank integration.

## Run locally

Requirements: Python 3.11+, uv, and Docker with its Linux engine running. The tested host used Python 3.13.1 and FalkorDB 4.20.7.

```powershell
uv --cache-dir .uv-cache sync --extra test --frozen
uv run python scripts/init_env.py
docker compose up -d falkordb
uv run uvicorn rewind.app:app --host 127.0.0.1 --port 8000 --workers 1
```

`scripts/init_env.py` creates a private `.env` with random backend identity tokens and preserves an existing file. Select the operator token for your tenant from `REWIND_IDENTITIES` when calling the API. Model credentials are separate from backend Bearer tokens.

- API reference: `http://127.0.0.1:8000/docs`
- OpenAPI: `http://127.0.0.1:8000/openapi.json`, also exported in [docs/openapi.json](docs/openapi.json)
- Health/readiness: `/health`, `/ready`
- UI handoff: [docs/api.md](docs/api.md)
- Backend architecture and guarantees: [docs/architecture.md](docs/architecture.md)
- Build/demo plan: [plan.md](plan.md)

One backend process owns writes. Do not run a separate CLI story against the same tenant while the server is running. The HTTP demo below operates through the running backend instead.

## Backend-only demo through HTTP

With the server running, open a second terminal:

```powershell
uv run python scripts/api_demo.py --mode scripted --reset
```

The reset is restricted to a registered tenant marked as a fictional demo. The script seeds Northstar, runs separate planner/executor tool workflows, approves the old proposal, revokes the wrong source, confirms stale execution fails, admits a correction, runs fresh agents, verifies the new receipt, and learns a supported procedure. Its sanitized transcript is saved to `artifacts/api-demo.json`.

## Live agents through your Codex login

The host can use its existing Codex/ChatGPT sign-in through the supported `codex exec` interface. No model API key is needed. Run the API on the host where Codex is installed and signed in; keep FalkorDB in Docker:

```powershell
codex login status
docker compose stop backend
docker compose up -d falkordb
uv run python scripts/run_codex_backend.py
```

In a second terminal:

```powershell
uv run python scripts/api_demo.py --mode live --reset --output artifacts/codex-live-demo.json
```

If login status is unavailable, run `codex login` once. `AGENT_PROVIDER=codex_cli` in `.env` also selects this provider for ordinary Uvicorn startup. Leave `MODEL_NAME` blank for the CLI default, or use a model available to your Codex account. `CODEX_COMMAND` supports an executable path and `CODEX_TIMEOUT_SECONDS` bounds each decision. This uses your account's Codex access and limits. The UI continues using the same REST API and backend Bearer tokens.

Each CLI invocation returns one structured tool decision. Rewind validates and executes it through the existing role/tenant/approval gates. The controller persists separate planner/executor conversations, restores their visible history between decisions, records CLI usage, and starts fresh contexts after repair. The CLI runs in an isolated temporary working directory with shell/app/plugin/browser/agent delegation tools disabled and a read-only sandbox. Application identity/model credentials are removed from its environment. Rewind never reads or copies the Codex authentication store. See the [official non-interactive interface](https://learn.chatgpt.com/docs/non-interactive-mode) and [authentication documentation](https://learn.chatgpt.com/docs/auth).

The default Docker backend image does not contain the Windows Codex executable or your host login. Use the host launcher for this provider. API-key inference remains available with `AGENT_PROVIDER=openai`.

The complete live Codex demo passed: four separate runs, 23 model decisions, stale-action rejection, one verified corrected receipt, and persistence across a host backend restart. The latest evidence is [artifacts/verification.json](artifacts/verification.json) and [artifacts/codex-live-demo.json](artifacts/codex-live-demo.json). Payments remain simulated.

## API-key alternative

`scripted` is a deterministic tool workflow, explicitly labeled in runs/episodes. To use an API-key model instead of Codex CLI, set these values in `.env`, restart the backend, and use `--mode live`:

```dotenv
MODEL_API_KEY=your-provider-key
MODEL_NAME=your-tool-capable-model
MODEL_BASE_URL=https://api.openai.com/v1
AGENT_PROVIDER=openai
```

An OpenAI-compatible Chat Completions endpoint must support function tools and `parallel_tool_calls=false`. Use your provider's base URL and available model identifier. The SDK records separate conversations, tool messages, provider usage totals, pauses for approval, and verifies persisted receipts. This API-key transport is tested through a local protocol fixture; no provider API key was supplied. Codex CLI is a separate live inference transport using the existing account login.

If the backend is stopped, the direct CLI story is also available:

```powershell
uv run python -m rewind.demo story --tenant tenant_a --reset --confirm reset-this-demo-tenant --output artifacts/demo-story.json
uv run python -m rewind.demo verify --tenant tenant_a
```

## Docker backend

After generating `.env`:

```powershell
docker compose up --build -d
```

Compose binds database/app ports to localhost, uses the pinned server-only FalkorDB image, and persists `/var/lib/falkordb/data`. The database image's entrypoint takes `REDIS_ARGS`; the configuration enables AOF and `appendfsync always`. `requirements.lock` pins backend runtime dependencies, and `uv.lock` pins the local development environment. Keep model/backend tokens out of source control and frontend bundles. Additional UI origins go in `REWIND_CORS_ORIGINS`.

`FALKORDB_PASSWORD` is for a database that has authentication configured. The local Compose database currently relies on private container networking and loopback port binding; configure server authentication before moving it to a shared/public environment.

## Test and evaluate

Tests run against actual FalkorDB, using uniquely named disposable graphs. They do not call paid model APIs.

```powershell
uv run python -m pytest --junitxml=artifacts/tests.xml
uv run python scripts/evaluate.py
```

The suite exercises AND/OR support, multi-hop repair, historical procedure invalidation, stale writes, role/tenant isolation, action/repair races, duplicate receipts, recovery, concurrent episode writes, SDK transport, and the API story. The pinned database's failed-write rollback behavior is checked directly. The evaluation uses 20 small fixture cases and three explicitly defined memory-service variants. It is not a comparison with commercial products or a full reproduction of the cited papers.

Measured results and conditions: [docs/evaluation.md](docs/evaluation.md). Raw artifacts: [artifacts/evaluation.json](artifacts/evaluation.json), [artifacts/tests.xml](artifacts/tests.xml).

The earlier containerized HTTP story and backend restart passed. A forced database restart preserved its graph and receipt; a separate backend restart preserved the complete HTTP-visible graph exactly. See [artifacts/docker-verification.json](artifacts/docker-verification.json) and [artifacts/api-demo.json](artifacts/api-demo.json). That image reused an already verified local Python runtime after Docker dependency downloads encountered TLS interruptions; the Dockerfile defaults to the official Python image and accepts `PYTHON_IMAGE` as a build override. The current signed-in Codex workflow runs on the host.

## Core semantics

- Inputs within a justification are AND; separate justifications for a fact are OR.
- A copied memory retains transitive source dependencies.
- Candidate agent facts require operator review. Agents cannot admit sources or approve actions.
- Agent-created payment plans must agree with the current server-resolved invoice and supplier facts.
- Source revocation records a durable repair marker before changes. Interrupted repairs block execution until recovery finishes.
- Affected memory revisions and task generations change. Stale runs cannot republish withdrawn knowledge.
- Approvals bind the exact payload and provenance. The execution gate independently resolves all required facts.
- Receipts are simulated, immutable, retry-safe under the one-process writer model, and unique per supplier/invoice within a tenant.
- Already committed effects are marked for review after revocation, never silently deleted or automatically reversed.
- Repair intentionally restarts any run that read affected evidence; it does not reconstruct hidden reasoning.

## Documentation and limitations

[Graph model/queries](docs/queries.md), [API contract](docs/api.md), [demo/recording runbook](docs/demo.md), [architecture/limits](docs/architecture.md), and [AI use](docs/ai-use.md).

The current implementation uses bounded whole-graph snapshots for support evaluation (10,000 records / 20,000 edges), plus a real Cypher descendant traversal during repair. Writes are serialized per tenant in one process. This is an inspectable hackathon backend, not distributed transaction infrastructure, universal poison detection, financial software, or proof of factual truth. An operator supplies the authoritative correction.

Research: [MemoryGraft](https://arxiv.org/abs/2512.16962), [MemSecBench](https://arxiv.org/abs/2607.27080), and [Forcepoint](https://www.forcepoint.com/blog/x-labs/persistent-memory-poisoning-ai-agents). Implementation uses the [OpenAI function-calling contract](https://developers.openai.com/api/docs/guides/function-calling) and [FalkorDB persistence guidance](https://docs.falkordb.com/operations/durability/persistence).

