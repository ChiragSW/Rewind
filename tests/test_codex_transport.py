"""CLI protocol fixture; the separate live demo verifies the signed-in Codex account."""
import asyncio
import json
import pathlib
import subprocess
import sys

import pytest

from rewind.contracts import DomainError
from rewind.demo import seed, story


def test_codex_decisions_use_existing_gates_and_private_environment(service, settings, monkeypatch):
    seen = []
    settings.agent_provider = "codex_cli"
    settings.codex_command = sys.executable  # Only executable resolution is real in this fixture.
    monkeypatch.setenv("REWIND_IDENTITIES", "must-not-be-inherited")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-inherited")
    monkeypatch.setenv("CODEX_API_KEY", "must-not-be-inherited")

    def invoke(args, **options):
        assert not options.get("shell")
        assert {"REWIND_IDENTITIES", "OPENAI_API_KEY", "CODEX_API_KEY"}.isdisjoint(options["env"])
        assert "--ignore-user-config" in args and "--ephemeral" in args and "--disable" in args
        assert args[args.index("--sandbox") + 1] == "read-only"
        assert args[args.index("--cd") + 1] != str(pathlib.Path.cwd())
        request = json.loads(options["input"].split("\n", 1)[1])
        seen.append(request)
        messages = request["conversation"]
        user = json.loads(next(m["content"] for m in messages if m["role"] == "user"))
        task, run_id = user["task"], user["run_id"]
        planner = "handoff" in {t["function"]["name"] for t in request["tools"]}
        responses = [json.loads(m["content"])["result"] for m in messages if m["role"] == "tool"]
        step = len(responses)
        if step == 0:
            name, values = "read_task", {}
        elif step == 1:
            name, values = "read_memory", {"subject": task["supplier_id"]}
        elif step == 2:
            name, values = "read_memory", {"subject": task["invoice_id"]}
        elif step == 3:
            supplier = {n["predicate"]: n for n in responses[1]["memories"]}
            name, values = "inspect_provenance", {"memory_id": supplier["payment_routing"]["id"]}
        elif step == 4:
            supplier = {n["predicate"]: n for n in responses[1]["memories"]}
            invoice = next(n for n in responses[2]["memories"] if n["predicate"] == "invoice_details")
            payload = {"supplier_id": task["supplier_id"], "invoice_id": task["invoice_id"],
                       "amount_minor": invoice["value"]["amount_minor"], "currency": invoice["value"]["currency"],
                       "routing_token": supplier["payment_routing"]["value"]}
            name, values = ("propose_plan", {"value": payload,
                "input_memory_ids": [supplier["legal_name"]["id"], supplier["payment_routing"]["id"], invoice["id"]]}) if planner else (
                    "propose_action", {"payload": payload, "idempotency_key": run_id})
        elif step == 5:
            name, values = ("handoff", {}) if planner else ("execute_action", {"action_id": responses[4]["id"]})
            if not planner:
                assert any("Operator approval is persisted" in m.get("content", "") for m in messages)
        elif step == 6:
            name, values = "read_receipt", {"action_id": responses[4]["id"]}
        else:
            name, values = "finish", {}
        output = {"tool_name": name, "arguments_json": json.dumps(values), "summary": "CLI protocol fixture"}
        pathlib.Path(args[args.index("--output-last-message") + 1]).write_text(json.dumps(output), encoding="utf-8")
        return subprocess.CompletedProcess(args, 0, json.dumps({"type": "turn.completed", "usage": {
            "input_tokens": 3, "output_tokens": 1, "cached_input_tokens": 1}}), "")

    monkeypatch.setattr("rewind.codex_cli.subprocess.run", invoke)
    seed(service, "a")
    result = asyncio.run(story(service, settings, "a", mode="live"))
    assert result["receipt"]["result"]["routing_token"] == "BANK-DEMO-CORRECT"
    starts = [r for r in seen if len(r["conversation"]) == 2]
    assert len(starts) == 4 and len(seen) >= 20
    runs = [n for n in service.snapshot("a")["nodes"].values() if n["kind_label"] == "Run"]
    assert all(n["provider"] == "codex_cli" and n["usage_totals"]["total_tokens"] > 0 for n in runs)

    from rewind.codex_cli import _choose
    monkeypatch.setattr("rewind.codex_cli.subprocess.run", lambda *a, **k: subprocess.CompletedProcess(a, 1, "", "private diagnostic"))
    with pytest.raises(DomainError) as error:
        _choose(settings, [], [])
    assert error.value.code == "CODEX_EXEC_FAILED" and "private diagnostic" not in error.value.message
