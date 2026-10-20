"""Drive the complete story over UI-facing HTTP endpoints; no frontend required."""
import argparse
import json
import pathlib
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from rewind.config import Settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--tenant", default="tenant_a")
    parser.add_argument("--mode", choices=["scripted", "live"], default="scripted")
    parser.add_argument("--reset", action="store_true", help="Reset only the selected, registered fictional demo tenant")
    parser.add_argument("--output", default="artifacts/api-demo.json")
    args = parser.parse_args()
    settings = Settings.from_env()
    token = next((token for token, who in settings.identities.items() if who == {"tenant": args.tenant, "role": "operator"}), None)
    if not token:
        parser.error("No configured operator identity for that tenant")
    timeline = []

    def request(path, body=None, expected=200):
        req = Request(args.url.rstrip("/") + path, data=json.dumps(body).encode() if body is not None else None,
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            response = urlopen(req, timeout=45)
        except HTTPError as exc:
            response = exc
        with response:
            data = json.loads(response.read())
            code = response.status
        if code != expected:
            raise RuntimeError(f"{path}: HTTP {code}: {data}")
        timeline.append({"endpoint": path, "status": code, "response": data})
        return data

    def wait(run_id, desired):
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            run = request("/api/records/" + run_id)
            if run["status"] == desired:
                return run
            if run["status"] in {"failed", "interrupted", "restart_required", "awaiting_input"}:
                raise RuntimeError(f"Run stopped: {run}")
            time.sleep(0.2)
        raise TimeoutError("Agent run did not reach expected state")

    def proposal():
        planner = request("/api/tasks/task-invoice-1042/runs", {"role": "planner", "mode": args.mode}, 202)
        wait(planner["id"], "completed")
        executor = request("/api/tasks/task-invoice-1042/runs", {"role": "executor", "mode": args.mode}, 202)
        wait(executor["id"], "awaiting_approval")
        actions = request("/api/actions")["items"]
        action = next(a for a in actions if a["run_id"] == executor["id"])
        request(f"/api/actions/{action['id']}/approve", {"payload_hash": action["payload_hash"]})
        return executor, action

    request("/ready")
    request("/api/demo/seed", {"reset": args.reset, "confirm": "reset-this-demo-tenant" if args.reset else None})
    old_run, old = proposal()
    preview = request("/api/sources/src-onboarding-incorrect/revocation-preview", {})
    repair = request("/api/sources/src-onboarding-incorrect/revoke", {"reason": "Reviewed source had incorrect routing", "idempotency_key": "api-demo-repair"})
    blocked = request(f"/api/actions/{old['id']}/execute", {}, 409)
    assert blocked["error"]["code"] == "STALE_ACTION"
    request("/api/corrections", {
        "source": {"id": "src-routing-correction-reviewed", "title": "Reviewed correction", "content": "BANK-DEMO-CORRECT", "authority": "authoritative"},
        "memory": {"id": "mem-routing-correct", "subject": "northstar", "predicate": "payment_routing", "value": "BANK-DEMO-CORRECT", "inputs": ["$source"]},
        "supersedes_id": "mem-routing-wrong"}, 201)
    new_run, new = proposal()
    request(f"/api/runs/{new_run['id']}/continue", {}, 202)
    completed = wait(new_run["id"], "completed")
    receipts = request("/api/receipts")["items"]
    assert len(receipts) == 1 and receipts[0]["result"]["routing_token"] == "BANK-DEMO-CORRECT"
    procedure = request(f"/api/actions/{new['id']}/learn-procedure", {}, 201)
    assert completed["receipt_verified"]
    output = {"mode": args.mode, "synthetic": True, "simulated_payments": True, "repair": repair, "preview": preview,
              "blocked": blocked, "receipt": receipts[0], "procedure": procedure, "timeline": timeline}
    target = pathlib.Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps({"mode": args.mode, "stale_action": "blocked", "receipt_verified": True,
                      "receipt_id": receipts[0]["id"], "artifact": str(target)}))


if __name__ == "__main__":
    main()
