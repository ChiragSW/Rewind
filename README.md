# Rewind: Full-Stack Agent Memory Repair

Rewind corrects shared agent memory by tracing evidence through FalkorDB. Revoking one source invalidates unsupported downstream facts and plans, preserves independent evidence, and blocks proposals made against stale memory.

This repository is organized into a full-stack monorepo:
- **`frontend/`**: Next.js 16 + React 19 interactive memory provenance UI (`rewind-codebase-analysis`), with graph visualization, node inspection, rewind preview, action gating, and live backend proxy endpoints.
- **`backend/`**: FastAPI + FalkorDB backend providing graph storage, deterministic repair logic, role/tenant enforcement, and agent run execution.

---

## Architecture Overview

```
Rewind/
├── compose.yaml          # Multi-service Docker orchestration (FalkorDB + Backend + Frontend)
├── frontend/             # Next.js interactive UI & API proxy
│   ├── app/              # Next.js App Router (pages & API routes)
│   ├── components/       # UI components (RewindShell, Graph canvas, Inspector)
│   ├── lib/              # Client API, domain logic, contracts & mock fallback
│   ├── package.json
│   └── Dockerfile
├── backend/              # FastAPI + FalkorDB backend
│   ├── rewind/           # Core backend package (app, graph, memory, service, agents)
│   ├── tests/            # Test suite
│   ├── scripts/          # Automation scripts (init_env.py, api_demo.py)
│   ├── docs/             # Technical specs & OpenAPI contracts
│   ├── pyproject.toml
│   └── Dockerfile
```

---

## Quick Start with Docker Compose

Run the entire stack (database, backend, and frontend) with a single command:

```bash
docker compose up --build
```

- **Frontend UI**: http://localhost:3000
- **Backend API**: http://127.0.0.1:8000
- **Backend Swagger Docs**: http://127.0.0.1:8000/docs
- **FalkorDB**: localhost:6379

---

## Local Development Setup

### 1. Backend Setup

```bash
cd backend
python3 scripts/init_env.py
docker compose -f ../compose.yaml up -d falkordb
uv run uvicorn rewind.app:app --host 127.0.0.1 --port 8000 --workers 1
```

Or using standard Python virtual environment:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
uvicorn rewind.app:app --host 127.0.0.1 --port 8000 --workers 1
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The Next.js frontend runs at `http://localhost:3000`. It automatically connects to the backend at `http://127.0.0.1:8000` via its built-in proxy routes (`/api/backend/*`) and gracefully falls back to local synthetic demonstration state if the backend is not running.

---

## API Endpoints

### Frontend Proxy Routes (`/api/backend/*`) & Native Endpoints
- `GET /api/health`: Health status and backend connectivity
- `GET /api/backend/state`: Current tenant state, counters, and mode
- `GET /api/backend/graph`: Graph nodes and edges for renderer
- `GET /api/backend/events`: Audit event log cursor stream
- `GET /api/backend/sources`: Admitted sources
- `GET /api/backend/memory`: Derived semantic & procedural facts
- `GET /api/backend/tasks`: Agent tasks
- `GET /api/backend/runs`: Agent run history & execution status
- `GET /api/backend/actions`: Proposed actions awaiting approval or execution
- `POST /api/backend/demo/seed`: Reset and seed demo data (`{ reset: true, confirm: "reset-this-demo-tenant" }`)
- `POST /api/backend/sources/:id/revocation-preview`: Non-mutating impact analysis of source revocation
- `POST /api/backend/sources/:id/revoke`: Apply source revocation and cascade memory repair
- `POST /api/backend/actions/:id/approve`: Approve action payload hash
- `POST /api/backend/actions/:id/execute`: Execute action through cryptographic gate
- `POST /api/backend/tasks/:id/runs`: Launch planner or executor agent runs

---

## Testing

### Frontend Tests
```bash
cd frontend
npm test
npm run build
```

### Backend Tests
```bash
cd backend
pytest tests/
```
