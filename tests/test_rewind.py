import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from rewind.agents import Agents
from rewind.app import create_app
from rewind.contracts import DomainError, MemoryCreate, SourceCreate
from rewind.demo import correction, seed, story
from rewind.graph import GraphStore, edge, record
from rewind.memory import evaluate
from rewind.service import Rewind


def prepare(service):
    seed(service, "a")
    planner = service.start_run("a", "task-invoice-1042", "planner", "scripted", "scripted")
    service.handoff("a", planner["id"])
    executor = service.start_run("a", "task-invoice-1042", "executor", "scripted", "scripted")
    service.read_memory("a", executor["id"], "northstar")
    service.read_memory("a", executor["id"], "INV-DEMO-1042")
    s = service.snapshot("a")
    task = s["nodes"]["task-invoice-1042"]
    payload = service._payload(task, service._requirements(s, task))
    action = service.propose_action("a", executor["id"], payload, "test-payment")
    return executor, action


def revoke(service, key="test-revoke"):
    return service.revoke("a", "src-onboarding-incorrect", "verified incorrect routing", key, "test:operator")


def test_selective_and_or_multi_hop_repair(service):
    seed(service, "a")
    before = service.snapshot("a")
    preview = service.preview("a", "src-onboarding-incorrect")
    assert "mem-supplier-name" in preview["preserved"]
    assert set(preview["invalidated"]) == {"mem-routing-wrong", "mem-payment-plan-old", "mem-routing-procedure-old"}
    assert service.snapshot("a")["nodes"]["src-onboarding-incorrect"]["status"] == "active"
    repaired = revoke(service)
    after = service.snapshot("a")
    valid, _ = evaluate(after)
    assert after["nodes"]["state"]["mode"] == "ready"
    assert valid["mem-supplier-name"] and not valid["mem-payment-plan-old"]
    assert after["nodes"]["mem-delivery-terms"] == before["nodes"]["mem-delivery-terms"]
    assert after["nodes"]["mem-invoice-amount"] == before["nodes"]["mem-invoice-amount"]
    assert repaired["report"]["invalidated"] == preview["invalidated"]


def test_stale_action_blocked_and_logged(service):
    run, action = prepare(service)
    service.approve("a", action["id"], action["payload_hash"], "operator")
    repaired = revoke(service)
    with pytest.raises(DomainError, match="currently approved") as e:
        service.execute("a", action["id"])
    assert e.value.code == "STALE_ACTION"
    s = service.snapshot("a")
    assert s["nodes"][run["id"]]["status"] == "restart_required"
    assert action["id"] in repaired["report"]["stale_actions"]
    assert not any(n["kind_label"] == "Receipt" for n in s["nodes"].values())
    assert any(n.get("type") == "action.blocked" for n in s["nodes"].values())


def test_full_scripted_two_agent_story(service, settings):
    seed(service, "a")
    result = asyncio.run(story(service, settings, "a"))
    assert result["receipt"]["result"]["routing_token"] == "BANK-DEMO-CORRECT"
    s = service.snapshot("a")
    runs = [n for n in s["nodes"].values() if n["kind_label"] == "Run"]
    assert len(runs) == 4 and {n["role"] for n in runs} == {"planner", "executor"}
    assert any(e["type"] == "HANDED_OFF_TO" for e in s["edges"])
    assert any(n["kind_label"] == "Episode" for n in s["nodes"].values())
    assert service.execute("a", result["new_action"])["already_committed"]


def test_cycle_and_copied_support(service):
    seed(service, "a")
    memory = service.add_memory("a", MemoryCreate(subject="test", predicate="copy", value="copy",
                              inputs=["mem-routing-wrong"]).model_dump(), "operator")
    with pytest.raises(DomainError) as e:
        service.add_support("a", "mem-routing-wrong", [memory["id"]], "operator")
    assert e.value.code == "CYCLIC_SUPPORT"
    assert len(service.inspect("a", "mem-routing-wrong")["valid_justifications"]) == 1
    revoke(service)
    assert service.snapshot("a")["nodes"][memory["id"]]["status"] == "unsupported"


def test_missing_and_exact_approval(service):
    run, action = prepare(service)
    with pytest.raises(DomainError) as e:
        service.execute("a", action["id"])
    assert e.value.code == "MISSING_APPROVAL"
    with pytest.raises(DomainError) as e:
        service.approve("a", action["id"], "0" * 64, "operator")
    assert e.value.code == "PAYLOAD_MISMATCH"


def test_server_requires_all_fact_reads_and_exact_payload(service):
    seed(service, "a")
    planner = service.start_run("a", "task-invoice-1042", "planner", "scripted", "scripted")
    service.handoff("a", planner["id"])
    executor = service.start_run("a", "task-invoice-1042", "executor", "scripted", "scripted")
    s = service.snapshot("a")
    task = s["nodes"]["task-invoice-1042"]
    payload = service._payload(task, service._requirements(s, task))
    with pytest.raises(DomainError) as e:
        service.propose_action("a", executor["id"], payload, "bad")
    assert e.value.code == "INVALID_PROVENANCE"
    service.read_memory("a", executor["id"], "northstar")
    service.read_memory("a", executor["id"], "INV-DEMO-1042")
    payload["routing_token"] = "BANK-DEMO-ATTACKER"
    with pytest.raises(DomainError) as e:
        service.propose_action("a", executor["id"], payload, "bad")
    assert e.value.code == "PAYLOAD_MISMATCH"


def test_duplicate_execute_and_conflicting_key(service):
    run, action = prepare(service)
    service.approve("a", action["id"], action["payload_hash"], "operator")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: service.execute("a", action["id"]), range(12)))
    assert len({r["receipt"]["id"] for r in results}) == 1
    assert sum(not r["already_committed"] for r in results) == 1


def test_revocation_execution_race_has_safe_ordering(service):
    run, action = prepare(service)
    service.approve("a", action["id"], action["payload_hash"], "operator")
    barrier = Barrier(2)
    def execution():
        barrier.wait()
        try:
            return service.execute("a", action["id"])
        except DomainError as exc:
            return exc.code
    def repair():
        barrier.wait()
        return revoke(service)
    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(execution), pool.submit(repair)
        outcome, report = a.result(), b.result()
    if isinstance(outcome, dict):
        assert action["id"] in report["report"]["review_needed"]
    else:
        assert outcome == "STALE_ACTION"
        assert action["id"] in report["report"]["stale_actions"]


def test_interrupted_repair_recovers_idempotently(service, settings, monkeypatch):
    seed(service, "a")
    original = service._finish_repair
    monkeypatch.setattr(service, "_finish_repair", lambda *args: (_ for _ in ()).throw(RuntimeError("simulated process failure")))
    with pytest.raises(RuntimeError):
        revoke(service)
    assert service.snapshot("a")["nodes"]["state"]["mode"] == "repairing"
    with pytest.raises(DomainError) as e:
        service.create_task("a", {"id": "blocked", "supplier_id": "northstar", "invoice_id": "i", "goal": "g", "constraints": []})
    assert e.value.code == "REPAIR_IN_PROGRESS"
    fresh = Rewind(GraphStore(settings))
    reports = fresh.recover("a")
    assert reports[0]["state"] == "completed"
    revision = fresh.snapshot("a")["nodes"]["mem-routing-wrong"]["revision"]
    repeated = revoke(fresh)
    assert repeated["id"] == reports[0]["id"]
    assert fresh.snapshot("a")["nodes"]["mem-routing-wrong"]["revision"] == revision


def test_restart_persists_history_and_marks_interrupted_run(service, settings):
    seed(service, "a")
    run = service.start_run("a", "task-invoice-1042", "planner", "scripted", "scripted")
    episode = service.episode("a", run["id"], "user", {"content": "persist this"})
    fresh = Rewind(GraphStore(settings))
    fresh.recover("a")
    s = fresh.snapshot("a")
    assert s["nodes"][episode["id"]]["data"]["content"] == "persist this"
    assert s["nodes"][run["id"]]["status"] == "interrupted"


def test_concurrent_episode_writes_no_loss(service):
    seed(service, "a")
    run = service.start_run("a", "task-invoice-1042", "planner", "scripted", "scripted")
    def write(i):
        return [service.episode("a", run["id"], "user", {"index": i, "part": p})["id"] for p in (0, 1)]
    with ThreadPoolExecutor(max_workers=50) as pool:
        ids = [identifier for group in pool.map(write, range(50)) for identifier in group]
    s = service.snapshot("a")
    assert len(set(ids)) == 100 and all(i in s["nodes"] for i in ids)
    events = [n["sequence"] for n in s["nodes"].values() if n["kind_label"] == "Event"]
    assert len(set(events)) == len(events)


def test_conflict_and_expired_procedure(service):
    seed(service, "a")
    service.add_source("a", SourceCreate(id="different", title="Conflict", content="Different routing").model_dump(), "operator")
    service.add_memory("a", MemoryCreate(subject="northstar", predicate="payment_routing", value="BANK-DEMO-OTHER", inputs=["different"]).model_dump(), "operator")
    with pytest.raises(DomainError) as e:
        service._requirements(service.snapshot("a"), service.snapshot("a")["nodes"]["task-invoice-1042"])
    assert e.value.code == "CONFLICTING_FACT"
    with service.locked("a") as s:
        procedure = s["nodes"]["mem-routing-procedure-old"]
        procedure["valid_until"] = 0
        service.commit("a", s, [procedure])
    assert not evaluate(service.snapshot("a"))[0]["mem-routing-procedure-old"]


def test_stale_run_cannot_republish_memory(service):
    run, action = prepare(service)
    revoke(service)
    with pytest.raises(DomainError) as e:
        service.read_memory("a", run["id"], "northstar")
    assert e.value.code == "STALE_RUN"


def test_actual_graph_paths_and_provenance(service):
    seed(service, "a")
    proof = service.inspect("a", "mem-routing-procedure-old")
    assert {"src-onboarding-incorrect", "mem-payment-plan-old", "mem-routing-wrong"} <= {n["id"] for n in proof["nodes"]}
    assert proof["grounded"]
    assert "mem-routing-procedure-old" in service.store.descendants("a", "src-onboarding-incorrect")


def test_api_auth_role_tenant_and_polling(service, settings):
    app = create_app(settings, service)
    with TestClient(app) as client:
        a = {"Authorization": "Bearer test-operator"}
        b = {"Authorization": "Bearer test-other"}
        planner = {"Authorization": "Bearer test-planner"}
        assert client.get("/api/state").status_code == 401
        assert client.post("/api/demo/seed", headers=a, json={}).status_code == 200
        assert client.get("/api/memory", headers=b).json()["items"] == []
        assert client.get("/api/memory/mem-routing-wrong/provenance", headers=b).status_code == 404
        assert client.post("/api/sources/src-onboarding-incorrect/revoke", headers=b,
                           json={"reason": "bad", "idempotency_key": "wrong-tenant"}).status_code == 404
        assert client.post("/api/sources", headers=planner, json={"title": "fake", "content": "fake"}).status_code == 403
        result = client.get("/api/events?limit=2", headers=a).json()
        assert result["has_more"] and result["next_cursor"] > 0
        next_events = client.get(f"/api/events?after={result['next_cursor']}", headers=a).json()["items"]
        assert all(n["sequence"] > result["next_cursor"] for n in next_events)
        assert client.get("/openapi.json").status_code == 200
        assert client.post("/api/actions", headers=a, json={"approved": True}).status_code == 422
        with service.locked("a") as snapshot:
            state = snapshot["nodes"]["state"]
            state["mode"] = "repairing"
            service.commit("a", snapshot, [state])
        assert client.get("/api/memory?usable_only=true", headers=a).status_code == 503
        assert client.get("/api/memory", headers=a).status_code == 200


def test_api_full_agent_workflow_and_correction(service, settings):
    with TestClient(create_app(settings, service)) as client:
        headers = {"Authorization": "Bearer test-operator"}
        def post(path, data=None, code=200):
            response = client.post(path, headers=headers, json=data or {})
            assert response.status_code == code, response.text
            return response.json()
        post("/api/demo/seed")
        post("/api/tasks/task-invoice-1042/runs", {"role": "planner", "mode": "scripted"}, 202)
        old_run = post("/api/tasks/task-invoice-1042/runs", {"role": "executor", "mode": "scripted"}, 202)
        old = client.get("/api/actions", headers=headers).json()["items"][0]
        post(f"/api/actions/{old['id']}/approve", {"payload_hash": old["payload_hash"]})
        post("/api/sources/src-onboarding-incorrect/revoke", {"reason": "bad routing", "idempotency_key": "ui-demo"})
        post(f"/api/actions/{old['id']}/execute", code=409)
        post("/api/corrections", {"source": {"id": "correct-source", "title": "Reviewed correction", "content": "BANK-DEMO-CORRECT", "authority": "authoritative"},
             "memory": {"id": "correct-routing", "subject": "northstar", "predicate": "payment_routing", "value": "BANK-DEMO-CORRECT", "inputs": ["$source"]},
             "supersedes_id": "mem-routing-wrong"}, 201)
        post("/api/tasks/task-invoice-1042/runs", {"role": "planner", "mode": "scripted"}, 202)
        new_run = post("/api/tasks/task-invoice-1042/runs", {"role": "executor", "mode": "scripted"}, 202)
        actions = client.get("/api/actions", headers=headers).json()["items"]
        new = next(a for a in actions if a["run_id"] == new_run["id"])
        post(f"/api/actions/{new['id']}/approve", {"payload_hash": new["payload_hash"]})
        post(f"/api/runs/{new_run['id']}/continue", code=202)
        receipts = client.get("/api/receipts", headers=headers).json()["items"]
        assert len(receipts) == 1 and receipts[0]["result"]["routing_token"] == "BANK-DEMO-CORRECT"
        learned = post(f"/api/actions/{new['id']}/learn-procedure", code=201)
        assert learned["kind"] == "procedural" and learned["verified_receipt_id"] == receipts[0]["id"]
        assert client.get(f"/api/runs/{new_run['id']}/episodes", headers=headers).json()["items"]

