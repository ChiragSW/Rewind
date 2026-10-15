"""Actual OpenAI SDK against a local protocol fixture, NOT live model inference."""
import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from rewind.demo import seed, story


def test_openai_compatible_transport_and_tool_continuation(service, settings):
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(body)
            messages = body["messages"]
            user = json.loads(next(m["content"] for m in messages if m["role"] == "user"))
            task, run_id = user["task"], user["run_id"]
            tool_names = {t["function"]["name"] for t in body["tools"]}
            planner = "handoff" in tool_names
            responses = [json.loads(m["content"])["result"] for m in messages if m["role"] == "tool"]
            step = len(responses)
            if step == 0:
                name, args = "read_task", {}
            elif step == 1:
                name, args = "read_memory", {"subject": task["supplier_id"]}
            elif step == 2:
                name, args = "read_memory", {"subject": task["invoice_id"]}
            else:
                supplier = {m["predicate"]: m for m in responses[1]["memories"]}
                invoice = next(m for m in responses[2]["memories"] if m["predicate"] == "invoice_details")
                if step == 3:
                    name, args = "inspect_provenance", {"memory_id": supplier["payment_routing"]["id"]}
                elif step == 4:
                    payload = {"supplier_id": task["supplier_id"], "invoice_id": task["invoice_id"],
                               "amount_minor": invoice["value"]["amount_minor"], "currency": invoice["value"]["currency"],
                               "routing_token": supplier["payment_routing"]["value"]}
                    if planner:
                        name, args = "propose_plan", {"value": payload,
                            "input_memory_ids": [supplier["legal_name"]["id"], supplier["payment_routing"]["id"], invoice["id"]]}
                    else:
                        name, args = "propose_action", {"payload": payload, "idempotency_key": run_id}
                elif step == 5:
                    name, args = ("handoff", {}) if planner else ("execute_action", {"action_id": responses[4]["id"]})
                elif step == 6:
                    name, args = "read_receipt", {"action_id": responses[4]["id"]}
                else:
                    name, args = None, None
            message = {"role": "assistant", "content": None}
            if name:
                message["tool_calls"] = [{"id": f"fixture-{run_id}-{step}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]
            else:
                message["content"] = "Verified simulated receipt."
            response = {"id": "chatcmpl-protocol-fixture", "object": "chat.completion", "created": int(time.time()),
                        "model": "protocol-fixture", "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if name else "stop"}],
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}
            encoded = json.dumps(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    settings.model_key = "protocol-fixture-not-a-real-api-key"
    settings.model_name = "protocol-fixture"
    settings.model_base_url = f"http://127.0.0.1:{server.server_port}/v1"
    try:
        seed(service, "a")
        result = asyncio.run(story(service, settings, "a", mode="live"))
        assert result["receipt"]["result"]["routing_token"] == "BANK-DEMO-CORRECT"
        assert len(seen) >= 20
        # The executor's initial prompt never contains the planner's transcript.
        starts = [b for b in seen if len(b["messages"]) == 2]
        assert len(starts) == 4
        assert len({json.loads(b["messages"][1]["content"])["run_id"] for b in starts}) == 4
        assert all("api_key" not in json.dumps(b) for b in seen)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)

