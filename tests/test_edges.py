import pytest
from fastapi.testclient import TestClient

from rewind.agents import Agents
from rewind.app import create_app
from rewind.contracts import DomainError, MemoryCreate, SourceCreate
from rewind.demo import seed
from rewind.graph import edge, record


def test_cross_tenant_same_ids_are_independent(service):
    seed(service, "a")
    seed(service, "b")
    before = service.snapshot("b")
    service.revoke("a", "src-onboarding-incorrect", "bad", "k", "op")
    assert service.snapshot("b") == before


def test_procurement_values_are_validated(service):
    seed(service, "a")
    with pytest.raises(DomainError) as exc:
        service.add_memory("a", MemoryCreate(subject="i", predicate="invoice_details", value={"amount_minor": True},
                           inputs=["src-purchase-order-reviewed"]).model_dump(), "op")
    assert exc.value.code == "INVALID_FACT"


def test_repair_after_partial_revision_write(service, settings, monkeypatch):
    seed(service, "a")
    original = service.store.commit
    calls = 0
    def commit(tenant, nodes, edges=()):
        nonlocal calls
        original(tenant, nodes, edges)
        calls += 1
        if calls == 3:
            raise RuntimeError("lost response after graph applied memory revisions")
    monkeypatch.setattr(service.store, "commit", commit)
    with pytest.raises(RuntimeError):
        service.revoke("a", "src-onboarding-incorrect", "bad", "repair", "op")
    monkeypatch.setattr(service.store, "commit", original)
    first_revision = service.snapshot("a")["nodes"]["mem-routing-wrong"]["revision"]
    service.recover("a")
    assert service.snapshot("a")["nodes"]["mem-routing-wrong"]["revision"] == first_revision
    assert service.snapshot("a")["nodes"]["state"]["mode"] == "ready"


def test_agent_cannot_call_operator_tools(service, settings):
    seed(service, "a")
    run = service.start_run("a", "task-invoice-1042", "planner", "scripted", "scripted")
    with pytest.raises(DomainError) as exc:
        Agents(service, settings).dispatch("a", run["id"], "revoke_source", {})
    assert exc.value.code == "FORBIDDEN_TOOL"


def test_database_failure_is_503_not_fallback(service, settings, monkeypatch):
    import redis
    with TestClient(create_app(settings, service)) as client:
        monkeypatch.setattr(service.store.client, "execute_command", lambda *a, **k: (_ for _ in ()).throw(redis.ConnectionError("offline")))
        response = client.get("/api/state", headers={"Authorization": "Bearer test-operator"})
        assert response.status_code == 503 and response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"


def test_single_graph_write_rolls_back_on_runtime_error(service):
    service.snapshot("a")
    # Test the pinned image's undo behavior, not an assumed multi-query transaction.
    with pytest.raises(Exception):
        service.store.query("a", "CREATE (n:Record {id:'should-not-survive',data:'{}'}) WITH n SET n.bad = {x:1} RETURN n.id")
    assert not service.store.query("a", "MATCH (n:Record {id:'should-not-survive'}) RETURN n.id")


def test_failed_correction_does_not_admit_partial_source(service):
    seed(service, "a")
    with pytest.raises(DomainError):
        service.apply_correction("a", {"source": {"id": "never-admitted", "title": "bad", "content": "bad", "authority": "reviewed"},
            "memory": MemoryCreate(subject="northstar", predicate="payment_routing", value="invalid", inputs=["$source"]).model_dump()}, "op")
    assert "never-admitted" not in service.snapshot("a")["nodes"]


def test_agent_fact_proposal_requires_operator_review(service, settings):
    seed(service, "a")
    run = service.start_run("a", "task-invoice-1042", "planner", "scripted", "scripted")
    agents = Agents(service, settings)
    candidate = agents.dispatch("a", run["id"], "propose_memory", {"subject": "new-supplier", "predicate": "legal_name",
        "value": "Proposed Supplier", "inputs": ["src-purchase-order-reviewed"]})
    assert candidate["status"] == "candidate" and not candidate["admitted"]
    read = service.read_memory("a", run["id"], "new-supplier")
    assert read["memories"] == []
    service.review_memory("a", candidate["id"], "op")
    assert service.read_memory("a", run["id"], "new-supplier")["memories"][0]["status"] == "active"


def test_completed_invoice_cannot_be_paid_again_under_new_task(service):
    from rewind.contracts import TaskCreate
    from test_rewind import prepare
    run, action = prepare(service)
    service.approve("a", action["id"], action["payload_hash"], "op")
    service.execute("a", action["id"])
    service.create_task("a", TaskCreate(id="duplicate-invoice-task", supplier_id="northstar", invoice_id="INV-DEMO-1042").model_dump())
    planner = service.start_run("a", "duplicate-invoice-task", "planner", "scripted", "scripted")
    service.handoff("a", planner["id"])
    other = service.start_run("a", "duplicate-invoice-task", "executor", "scripted", "scripted")
    service.read_memory("a", other["id"], "northstar")
    service.read_memory("a", other["id"], "INV-DEMO-1042")
    with pytest.raises(DomainError) as exc:
        service.propose_action("a", other["id"], action["payload"], "new-key")
    assert exc.value.code == "INVOICE_ALREADY_PAID"

