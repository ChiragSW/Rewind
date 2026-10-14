import asyncio
import secrets
from contextlib import asynccontextmanager
from typing import Annotated

import redis
from fastapi import BackgroundTasks, Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import Field

from .agents import Agents
from .config import Settings
from .contracts import (ActionCreate, Contract, Correction, DemoSeed, DomainError, MemoryCreate,
                        Revoke, RunStart, SourceCreate, SupportCreate, TaskCreate, ToolCall)
from .demo import seed
from .graph import GraphStore, digest
from .memory import evaluate
from .service import Rewind


class ApprovalRequest(Contract):
    payload_hash: str = Field(min_length=64, max_length=64)


def create_app(settings=None, service=None):
    settings = settings or Settings.from_env()
    service = service or Rewind(GraphStore(settings))
    agents = Agents(service, settings)

    @asynccontextmanager
    async def lifespan(app):
        app.state.recovery_errors = []
        for tenant in sorted({i["tenant"] for i in settings.identities.values()}):
            try:
                await asyncio.to_thread(service.recover, tenant)
            except (redis.RedisError, DomainError) as exc:
                app.state.recovery_errors.append({"tenant": tenant, "code": getattr(exc, "code", "DATABASE_UNAVAILABLE")})
        yield

    app = FastAPI(title="Rewind Backend", version="0.1.0", lifespan=lifespan,
                  description="Graph-backed memory repair. All payment effects are simulated. No frontend is included.")
    app.state.service, app.state.agents = service, agents
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"],
                           allow_headers=["Authorization", "Content-Type"], allow_credentials=False)
    bearer = HTTPBearer(auto_error=False)

    def auth(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        token = credentials.credentials if credentials and credentials.scheme.lower() == "bearer" else ""
        for configured, identity in settings.identities.items():
            if token and secrets.compare_digest(token.encode(), configured.encode()):
                return {**identity, "actor": digest(token)[:16]}
        raise DomainError("UNAUTHENTICATED", "A configured Bearer token is required", 401)

    def operator(identity=Depends(auth)):
        if identity["role"] != "operator":
            raise DomainError("FORBIDDEN", "Operator role required", 403)
        return identity

    def own_run(identity, run_id):
        run = service.get(service.snapshot(identity["tenant"]), run_id, "Run")
        if identity["role"] not in {"operator", run["role"]}:
            raise DomainError("FORBIDDEN", "This role cannot control this run", 403)
        return run

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}})

    @app.exception_handler(redis.RedisError)
    async def database_error(request, exc):
        return JSONResponse(status_code=503, content={"error": {"code": "DATABASE_UNAVAILABLE", "message": "Graph operation failed; no fallback execution"}})

    @app.get("/health")
    def health():
        try:
            service.store.client.ping()
            service.store.client.execute_command("GRAPH.LIST")
            return {"status": "ok", "database": "falkordb", "payments": "simulated", "model_configured": settings.model_configured,
                    "agent_provider": settings.agent_provider}
        except redis.RedisError:
            return JSONResponse(status_code=503, content={"status": "unavailable", "database": "falkordb"})

    @app.get("/ready")
    def readiness():
        try:
            tenants = {i["tenant"] for i in settings.identities.values()}
            if not tenants:
                return JSONResponse(status_code=503, content={"status": "unconfigured", "reason": "No configured identities"})
            paused = sum(service.snapshot(t)["nodes"]["state"]["mode"] != "ready" for t in tenants)
            return JSONResponse(status_code=503 if paused else 200, content={"status": "repairing" if paused else "ready", "paused_tenants": paused})
        except (redis.RedisError, DomainError):
            return JSONResponse(status_code=503, content={"status": "unavailable"})

    @app.get("/api/me")
    def me(identity=Depends(auth)):
        return identity

    @app.get("/api/state")
    def state(identity=Depends(auth)):
        s = service.snapshot(identity["tenant"])
        counts = {}
        for n in s["nodes"].values():
            key = n["kind_label"]
            counts[key] = counts.get(key, 0) + 1
        return {"tenant": identity["tenant"], "state": s["nodes"]["state"], "counts": counts,
                "model_configured": settings.model_configured, "agent_provider": settings.agent_provider, "simulated_payments": True}

    @app.get("/api/graph")
    def graph(identity=Depends(auth), include_episodes: bool = False, limit: int = Query(1000, ge=1, le=5000)):
        s = service.snapshot(identity["tenant"])
        all_nodes = [n for n in s["nodes"].values() if include_episodes or n["kind_label"] not in {"Episode", "Event"}]
        nodes = all_nodes[:limit]
        ids = {n["id"] for n in nodes}
        edges = [e for e in s["edges"] if e["source"] in ids and e["target"] in ids]
        return {"tenant": identity["tenant"], "mode": s["nodes"]["state"]["mode"], "nodes": nodes, "edges": edges,
                "truncated": len(all_nodes) > limit}

    @app.get("/api/tools")
    def tool_schemas(role: str = Query("planner", pattern="^(planner|executor)$"), identity=Depends(auth)):
        if identity["role"] not in {"operator", role}:
            raise DomainError("FORBIDDEN", "Tool schemas are scoped to the caller's role", 403)
        return {"role": role, "tools": agents.tools(role)}

    def listing(kind, identity, after=0, limit=200):
        nodes = service.snapshot(identity["tenant"])["nodes"].values()
        values = sorted((n for n in nodes if n["kind_label"] == kind), key=lambda n: (n["created_at"], n["id"]))
        return {"items": values[after:after + limit], "total": len(values), "next_offset": after + limit if after + limit < len(values) else None}

    for path, kind in [("sources", "Source"), ("tasks", "Task"), ("runs", "Run"), ("actions", "Action"), ("repairs", "Repair"), ("receipts", "Receipt")]:
        def make_list(record_kind):
            def endpoint(identity=Depends(auth), offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000)):
                return listing(record_kind, identity, offset, limit)
            return endpoint
        app.add_api_route(f"/api/{path}", make_list(kind), methods=["GET"], name=f"list_{path}")

    @app.get("/api/events")
    def events(identity=Depends(auth), after: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=1000)):
        s = service.snapshot(identity["tenant"])
        values = sorted((n for n in s["nodes"].values() if n["kind_label"] == "Event" and n["sequence"] > after), key=lambda n: n["sequence"])
        items = values[:limit]
        return {"items": items, "next_cursor": items[-1]["sequence"] if items else after,
                "latest_sequence": s["nodes"]["state"]["event_sequence"], "has_more": len(values) > limit}

    @app.get("/api/memory")
    def memories(identity=Depends(auth), subject: str | None = None, usable_only: bool = False):
        s = service.snapshot(identity["tenant"])
        if usable_only and s["nodes"]["state"]["mode"] != "ready":
            raise DomainError("REPAIR_IN_PROGRESS", "Tenant is paused until repair recovery completes", 503)
        valid, _ = evaluate(s)
        values = [dict(n, grounded=bool(valid.get(n["id"]))) for n in s["nodes"].values()
                  if n["kind_label"] == "Memory" and (subject is None or n["subject"] == subject)
                  and (not usable_only or n["status"] == "active" and valid.get(n["id"]))]
        return {"items": values, "mode": s["nodes"]["state"]["mode"]}

    @app.get("/api/memory/{memory_id}/provenance")
    def memory_provenance(memory_id: str, identity=Depends(auth)):
        return service.inspect(identity["tenant"], memory_id)

    @app.get("/api/records/{record_id}")
    def get_record(record_id: str, identity=Depends(auth)):
        return service.get(service.snapshot(identity["tenant"]), record_id)

    @app.get("/api/runs/{run_id}/episodes")
    def episodes(run_id: str, identity=Depends(auth)):
        s = service.snapshot(identity["tenant"])
        service.get(s, run_id, "Run")
        return {"items": sorted((n for n in s["nodes"].values() if n["kind_label"] == "Episode" and n["run_id"] == run_id),
                                key=lambda n: (n["created_at"], n["id"]))}

    @app.post("/api/sources", status_code=201)
    def sources_create(body: SourceCreate, identity=Depends(operator)):
        return service.add_source(identity["tenant"], body.model_dump(), identity["actor"])

    @app.post("/api/memory", status_code=201)
    def memory_create(body: MemoryCreate, identity=Depends(operator)):
        return service.add_memory(identity["tenant"], body.model_dump(), identity["actor"])

    @app.post("/api/memory/{memory_id}/supports", status_code=201)
    def support_add(memory_id: str, body: SupportCreate, identity=Depends(operator)):
        return service.add_support(identity["tenant"], memory_id, body.inputs, identity["actor"])

    @app.post("/api/memory/{memory_id}/review")
    def memory_review(memory_id: str, identity=Depends(operator)):
        return service.review_memory(identity["tenant"], memory_id, identity["actor"])

    @app.post("/api/sources/{source_id}/revocation-preview")
    def revocation_preview(source_id: str, identity=Depends(operator)):
        return service.preview(identity["tenant"], source_id)

    @app.post("/api/sources/{source_id}/revoke")
    def source_revoke(source_id: str, body: Revoke, identity=Depends(operator)):
        return service.revoke(identity["tenant"], source_id, body.reason, body.idempotency_key, identity["actor"])

    @app.post("/api/repairs/recover")
    def repair_recover(identity=Depends(operator)):
        if any(key[0] == identity["tenant"] for key in agents.active):
            raise DomainError("RUN_ACTIVE", "Wait for active runs before manual recovery")
        return {"repairs": service.recover(identity["tenant"])}

    @app.post("/api/corrections", status_code=201)
    def apply_correction(body: Correction, identity=Depends(operator)):
        return service.apply_correction(identity["tenant"], body.model_dump(), identity["actor"])

    @app.post("/api/tasks", status_code=201)
    def task_create(body: TaskCreate, identity=Depends(operator)):
        return service.create_task(identity["tenant"], body.model_dump())

    @app.post("/api/tasks/{task_id}/runs", status_code=202)
    def start_run(task_id: str, body: RunStart, background: BackgroundTasks, identity=Depends(auth)):
        if identity["role"] not in {"operator", body.role}:
            raise DomainError("FORBIDDEN", "Wrong role for requested agent", 403)
        if body.mode == "scripted" and not settings.enable_demo:
            raise DomainError("DEMO_DISABLED", "Scripted mode is disabled", 403)
        if body.mode == "live" and not settings.model_configured:
            raise DomainError("MODEL_NOT_CONFIGURED", "Configure the model provider or install and sign in to Codex CLI", 503)
        run = service.start_run(identity["tenant"], task_id, body.role, body.mode,
                                settings.agent_model if body.mode == "live" else "scripted", provider=settings.agent_provider)
        background.add_task(agents.drive, identity["tenant"], run["id"])
        return run

    @app.post("/api/runs/{run_id}/continue", status_code=202)
    def continue_run(run_id: str, background: BackgroundTasks, identity=Depends(auth)):
        run = own_run(identity, run_id)
        if run["status"] != "awaiting_approval":
            raise DomainError("RUN_NOT_PAUSED", "Only approval-paused runs can continue; repaired/interrupted runs need fresh contexts")
        s = service.snapshot(identity["tenant"])
        if not any(n["kind_label"] == "Action" and n["run_id"] == run_id and n["status"] in {"approved", "committed"} for n in s["nodes"].values()):
            raise DomainError("MISSING_APPROVAL", "Approve the proposal before continuing")
        background.add_task(agents.drive, identity["tenant"], run_id)
        return {"run_id": run_id, "status": "scheduled"}

    @app.post("/api/runs/{run_id}/tools")
    def tools(run_id: str, body: ToolCall, identity=Depends(auth)):
        own_run(identity, run_id)
        return agents.dispatch(identity["tenant"], run_id, body.name, body.arguments)

    @app.post("/api/actions", status_code=201)
    def action_create(body: ActionCreate, identity=Depends(auth)):
        own_run(identity, body.run_id)
        return service.propose_action(identity["tenant"], body.run_id, body.payload.model_dump(), body.idempotency_key)

    @app.post("/api/actions/{action_id}/approve")
    def action_approve(action_id: str, body: ApprovalRequest, identity=Depends(operator)):
        return service.approve(identity["tenant"], action_id, body.payload_hash, identity["actor"])

    @app.post("/api/actions/{action_id}/execute")
    def action_execute(action_id: str, identity=Depends(auth)):
        a = service.get(service.snapshot(identity["tenant"]), action_id, "Action")
        own_run(identity, a["run_id"])
        return service.execute(identity["tenant"], action_id)

    @app.post("/api/actions/{action_id}/learn-procedure", status_code=201)
    def learn_procedure(action_id: str, identity=Depends(operator)):
        s = service.snapshot(identity["tenant"])
        a = service.get(s, action_id, "Action")
        if a["status"] != "committed" or a.get("review_needed"):
            raise DomainError("UNVERIFIED_PROCEDURE", "Only an unrecalled committed action can ground a procedure")
        data = MemoryCreate(kind="procedural", subject=a["payload"]["supplier_id"], predicate="verified_payment_workflow",
            value={"steps": ["read_task", "read_memory", "inspect_provenance", "propose_action", "await_approval", "execute_action", "read_receipt"]},
            inputs=list(a["dependencies"]), verified_receipt_id=a["receipt_id"], applicability={"workflow_version": 1}).model_dump()
        return service.add_memory(identity["tenant"], data, identity["actor"])

    @app.post("/api/demo/seed")
    def seed_demo(body: DemoSeed, identity=Depends(operator)):
        if body.reset and body.confirm != "reset-this-demo-tenant":
            raise DomainError("RESET_CONFIRMATION_REQUIRED", "Explicit demo reset confirmation required", 422)
        if any(key[0] == identity["tenant"] for key in agents.active):
            raise DomainError("RUN_ACTIVE", "Cannot reset while agents are running")
        return seed(service, identity["tenant"], body.reset)

    return app


app = create_app()
