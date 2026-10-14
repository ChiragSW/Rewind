"""Authorized, fictional demo data and a runnable backend-only story."""
import argparse
import asyncio

from .config import Settings
from .contracts import DomainError, MemoryCreate, SourceCreate, TaskCreate
from .graph import GraphStore, edge, record
from .service import Rewind


def seed(service, tenant, reset=False):
    if not service.store.settings.enable_demo:
        raise DomainError("DEMO_DISABLED", "Set REWIND_ENABLE_DEMO=true for fictional demo fixtures", 403)
    with service.locked(tenant, ready=False) as s:
        if len(s["nodes"]) > 1:
            if not reset:
                raise DomainError("DEMO_EXISTS", "Tenant already has data; reset requires explicit confirmation")
            if not s["nodes"]["state"].get("demo_dataset"):
                raise DomainError("NOT_DEMO", "Refusing to reset a tenant not marked as demo", 403)
            service.store.reset_demo(tenant)
        service.add_source(tenant, SourceCreate(id="src-onboarding-incorrect", title="Accepted historical onboarding note",
                           content="Fictional supplier Northstar Components. Routing: BANK-DEMO-WRONG.").model_dump(), "demo:historical")
        service.add_source(tenant, SourceCreate(id="src-purchase-order-reviewed", title="Independent purchase order",
                           content="Northstar Components, INV-DEMO-1042: 125000 minor units USD.").model_dump(), "demo:historical")
        service.add_source(tenant, SourceCreate(id="src-delivery-terms", title="Independent delivery terms",
                           content="Delivery within 10 business days.").model_dump(), "demo:historical")
        fixtures = [
            MemoryCreate(id="mem-supplier-name", subject="northstar", predicate="legal_name", value="Northstar Components", inputs=["src-onboarding-incorrect"]),
            MemoryCreate(id="mem-routing-wrong", subject="northstar", predicate="payment_routing", value="BANK-DEMO-WRONG", inputs=["src-onboarding-incorrect"]),
            MemoryCreate(id="mem-invoice-amount", subject="INV-DEMO-1042", predicate="invoice_details",
                         value={"amount_minor": 125000, "currency": "USD", "supplier_id": "northstar"}, inputs=["src-purchase-order-reviewed"]),
            MemoryCreate(id="mem-delivery-terms", subject="northstar", predicate="delivery_terms", value="10 business days", inputs=["src-delivery-terms"]),
            MemoryCreate(id="mem-payment-plan-old", kind="plan", subject="INV-DEMO-1042", predicate="historical_payment_plan",
                         value={"routing_token": "BANK-DEMO-WRONG"}, inputs=["mem-routing-wrong", "mem-invoice-amount"]),
        ]
        for memory in fixtures:
            service.add_memory(tenant, memory.model_dump(), "demo:historical")
        service.add_support(tenant, "mem-supplier-name", ["src-purchase-order-reviewed"], "demo:historical")
        # Explicitly labeled historical procedure, not a fabricated live model success.
        with service.locked(tenant) as current:
            procedure = record("Memory", id="mem-routing-procedure-old", kind="procedural", subject="northstar",
                               predicate="historical_routing_procedure", value={"steps": ["Read invoice", "Use historical routing"]},
                               applicability={"workflow_version": 1}, valid_until=None, status="active", admitted=True,
                               revision=1, historical_verified=True, historical_fixture=True, admitted_by="demo:historical")
            justification, edges = service._attach(current, procedure, ["mem-payment-plan-old"])
            state = current["nodes"]["state"]
            state["demo_dataset"] = "northstar-v1"
            service.commit(tenant, current, [procedure, justification, state], edges, "demo.seeded", {"synthetic": True})
        service.create_task(tenant, TaskCreate(id="task-invoice-1042", supplier_id="northstar", invoice_id="INV-DEMO-1042").model_dump())
    return {"tenant": tenant, "dataset": "northstar-v1", "synthetic": True, "task_id": "task-invoice-1042"}


def correction(service, tenant):
    source = service.add_source(tenant, SourceCreate(id="src-routing-correction-reviewed", title="Reviewed correction",
        content="Fictional authoritative supplier confirmation: BANK-DEMO-CORRECT.", authority="authoritative").model_dump(), "demo:operator")
    return service.add_memory(tenant, MemoryCreate(id="mem-routing-correct", subject="northstar", predicate="payment_routing",
        value="BANK-DEMO-CORRECT", inputs=[source["id"]]).model_dump(), "demo:operator")


async def story(service, settings, tenant, mode="scripted"):
    from .agents import Agents
    agents = Agents(service, settings)
    async def propose():
        planner = service.start_run(tenant, "task-invoice-1042", "planner", mode, settings.agent_model if mode == "live" else "scripted", provider=settings.agent_provider)
        await agents.drive(tenant, planner["id"])
        executor = service.start_run(tenant, "task-invoice-1042", "executor", mode, settings.agent_model if mode == "live" else "scripted", provider=settings.agent_provider)
        await agents.drive(tenant, executor["id"])
        s = service.snapshot(tenant)
        action = next(n for n in s["nodes"].values() if n["kind_label"] == "Action" and n["run_id"] == executor["id"])
        service.approve(tenant, action["id"], action["payload_hash"], "demo:operator")
        return executor, action
    executor, old = await propose()
    repair = service.revoke(tenant, "src-onboarding-incorrect", "Operator confirmed onboarding routing was incorrect", "demo-repair-1", "demo:operator")
    try:
        service.execute(tenant, old["id"])
        raise AssertionError("Stale action executed")
    except DomainError as exc:
        assert exc.code == "STALE_ACTION"
    correction(service, tenant)
    executor, new = await propose()
    await agents.drive(tenant, executor["id"])
    s = service.snapshot(tenant)
    receipts = [n for n in s["nodes"].values() if n["kind_label"] == "Receipt"]
    assert len(receipts) == 1 and receipts[0]["result"]["routing_token"] == "BANK-DEMO-CORRECT"
    return {"mode": mode, "repair": repair, "old_action": old["id"], "new_action": new["id"], "receipt": receipts[0]}


def main():
    parser = argparse.ArgumentParser(description="Rewind fictional backend demo")
    parser.add_argument("command", choices=["seed", "story", "verify"])
    parser.add_argument("--tenant", default="tenant_a")
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--confirm", choices=["reset-this-demo-tenant"])
    parser.add_argument("--mode", choices=["live", "scripted"], default="scripted")
    parser.add_argument("--output", help="Save the sanitized result as UTF-8 JSON")
    args = parser.parse_args()
    settings = Settings.from_env()
    if args.tenant not in {i["tenant"] for i in settings.identities.values()}:
        parser.error("Tenant is not registered in REWIND_IDENTITIES")
    if args.reset and args.confirm != "reset-this-demo-tenant":
        parser.error("--reset requires --confirm reset-this-demo-tenant")
    service = Rewind(GraphStore(settings))
    from .graph import canonical
    if args.command in {"seed", "story"}:
        result = seed(service, args.tenant, args.reset)
        if args.command == "story":
            result = asyncio.run(story(service, settings, args.tenant, args.mode))
    else:
        s = service.snapshot(args.tenant)
        from .memory import evaluate
        valid, _ = evaluate(s)
        result = {"mode": s["nodes"]["state"]["mode"], "records": len(s["nodes"]),
                  "grounded_memories": [i for i, yes in valid.items() if yes and s["nodes"][i]["kind_label"] == "Memory"],
                  "database": service.store.client.ping()}
    if args.output:
        import pathlib
        target = pathlib.Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(canonical(result), encoding="utf-8")
        print("Saved", target)
    else:
        print(canonical(result))


if __name__ == "__main__":
    main()

