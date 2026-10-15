import copy
import threading
import re
from contextlib import contextmanager

from pydantic import ValidationError

from .contracts import DomainError, InvoiceFacts, MemoryCreate, PaymentPayload
from .graph import canonical, digest, edge, now, record
from .memory import current, evaluate, provenance


class Rewind:
    def __init__(self, store):
        self.store = store
        self._registry_lock = threading.Lock()
        self._locks = {}

    @contextmanager
    def locked(self, tenant, ready=True):
        # ponytail: one process; replace with DB coordination before multiple workers.
        with self._registry_lock:
            lock = self._locks.setdefault(tenant, threading.RLock())
        with lock:
            s = self.store.snapshot(tenant)
            if "state" not in s["nodes"]:
                state = record("TenantState", id="state", mode="ready", event_sequence=0, workflow_version=1)
                self.store.commit(tenant, [state])
                s["nodes"]["state"] = state
            if ready and s["nodes"]["state"]["mode"] != "ready":
                raise DomainError("REPAIR_IN_PROGRESS", "Tenant is paused until repair recovery completes")
            yield s

    @staticmethod
    def get(s, identifier, kind=None):
        n = s["nodes"].get(identifier)
        if not n or (kind and n["kind_label"] != kind):
            raise DomainError("NOT_FOUND", "Record not found in your tenant", 404, record_id=identifier)
        return n

    def commit(self, tenant, s, nodes, edges=(), event_type=None, details=None):
        nodes = list(nodes)
        if event_type:
            state = s["nodes"]["state"]
            state["event_sequence"] += 1
            event_record = record("Event", sequence=state["event_sequence"], type=event_type, details=details or {})
            nodes.extend([state, event_record])
        self.store.commit(tenant, nodes, edges)
        for n in nodes:
            s["nodes"][n["id"]] = n
        for e in edges:
            s["edges"] = [old for old in s["edges"] if (old["source"], old["type"], old["target"]) !=
                          (e["source"], e["type"], e["target"])]
            s["edges"].append(e)

    def snapshot(self, tenant):
        with self.locked(tenant, ready=False) as s:
            return s

    def add_source(self, tenant, data, actor):
        with self.locked(tenant) as s:
            n = record("Source", **data, status="active", content_hash=digest(data["content"]), admitted_by=actor)
            if n["id"] in s["nodes"]:
                raise DomainError("ID_EXISTS", "Source versions are immutable")
            self.commit(tenant, s, [n], event_type="source.admitted", details={"source_id": n["id"], "actor": actor})
            return n

    def _attach(self, s, n, inputs):
        if len(inputs) != len(set(inputs)):
            raise DomainError("DUPLICATE_INPUT", "Justification inputs must be distinct", 422)
        for i in inputs:
            if self.get(s, i)["kind_label"] not in {"Source", "Memory"}:
                raise DomainError("INVALID_SUPPORT", "Only sources and memories support a claim", 422)
        evidence = [{"source_id": i, "content_hash": s["nodes"][i]["content_hash"], "start": 0,
                     "end": len(s["nodes"][i]["content"]), "quote": s["nodes"][i]["content"]}
                    for i in inputs if s["nodes"][i]["kind_label"] == "Source"]
        j = record("Justification", input_ids=inputs, target_id=n["id"], status="active", evidence_spans=evidence)
        edges = [edge(i, "INPUT_TO", j["id"]) for i in inputs] + [edge(j["id"], "SUPPORTS", n["id"])]
        proposed = copy.deepcopy(s)
        proposed["nodes"].update({n["id"]: n, j["id"]: j})
        proposed["edges"].extend(edges)
        valid, js = evaluate(proposed)
        j["status"] = "active" if j["id"] in js.get(n["id"], []) else "invalid"
        if n.get("admitted"):
            n["status"] = "active" if valid.get(n["id"]) else "unsupported"
        return j, edges

    @staticmethod
    def validate_fact(data):
        try:
            if data["predicate"] == "invoice_details":
                data["value"] = InvoiceFacts.model_validate(data["value"]).model_dump()
            if data["predicate"] == "payment_routing" and (not isinstance(data["value"], str) or
                    not re.fullmatch(r"BANK-DEMO-[A-Z0-9_-]{1,80}", data["value"])):
                raise ValueError("Invalid demo routing")
            if data["predicate"] == "legal_name" and (not isinstance(data["value"], str) or not data["value"].strip()):
                raise ValueError("Invalid supplier name")
            if len(canonical(data["value"])) > 50000:
                raise ValueError("Oversized memory")
        except (ValidationError, ValueError):
            raise DomainError("INVALID_FACT", "Known procurement predicates require correctly typed, bounded values", 422)

    def add_memory(self, tenant, data, actor, admitted=True, run_id=None):
        data = dict(data)
        with self.locked(tenant) as s:
            inputs = data.pop("inputs")
            self.validate_fact(data)
            if run_id:
                run = self.check_run(s, run_id, "planner")
                if not admitted and data["kind"] != "semantic":
                    raise DomainError("FORBIDDEN", "Agent fact proposals must be semantic candidates", 403)
            if run_id and admitted:
                if data["kind"] != "plan" or any(self.get(s, i)["kind_label"] != "Memory" for i in inputs):
                    raise DomainError("FORBIDDEN", "Agents derive plans; operators admit root facts", 403)
                read_ids = {e["source"]: e["data"].get("revision") for e in s["edges"] if e["type"] == "READ_BY" and e["target"] == run_id}
                if not set(inputs) <= set(read_ids) or any(read_ids[i] != self.get(s, i)["revision"] for i in inputs):
                    raise DomainError("INVALID_PROVENANCE", "A plan must cite memories returned to this run")
                valid, _ = evaluate(s)
                if not all(valid.get(i) and self.get(s, i)["status"] == "active" for i in inputs):
                    raise DomainError("STALE_MEMORY", "Plan inputs are no longer usable")
                task = self.get(s, run["task_id"], "Task")
                required = self._requirements(s, task)
                if data["subject"] != task["invoice_id"] or data["value"] != self._payload(task, required) or not {n["id"] for n in required} <= set(inputs):
                    raise DomainError("PAYLOAD_MISMATCH", "Derived payment plan must match this task's required facts")
            if data["kind"] == "procedural" and not data.get("verified_receipt_id"):
                raise DomainError("UNVERIFIED_PROCEDURE", "A procedure requires a verified simulated receipt", 422)
            if data.get("verified_receipt_id"):
                self.get(s, data["verified_receipt_id"], "Receipt")
            n = record("Memory", **data, admitted=admitted, admitted_by=actor, revision=1,
                       status="active" if admitted else "candidate", historical_verified=False)
            if n["id"] in s["nodes"]:
                raise DomainError("ID_EXISTS", "Memory values are immutable; use a new ID")
            j, edges = self._attach(s, n, inputs)
            if run_id:
                edges.append(edge(run_id, "PRODUCED", n["id"]))
            self.commit(tenant, s, [n, j], edges, "memory.created", {"memory_id": n["id"], "actor": actor})
            return n

    def add_support(self, tenant, memory_id, inputs, actor):
        with self.locked(tenant) as s:
            n = self.get(s, memory_id, "Memory")
            if n["status"] in {"unsupported", "superseded"}:
                raise DomainError("CORRECTION_REQUIRED", "Use a new reviewed memory version after support has been withdrawn")
            j, edges = self._attach(s, n, inputs)
            n["revision"] += 1
            self.commit(tenant, s, [n, j], edges, "memory.support_added", {"memory_id": memory_id, "actor": actor})
            return n

    def review_memory(self, tenant, memory_id, actor):
        with self.locked(tenant) as s:
            n = self.get(s, memory_id, "Memory")
            if n["status"] == "superseded":
                raise DomainError("SUPERSEDED", "Superseded memory cannot be re-admitted")
            n["admitted"] = True
            valid, _ = evaluate(s)
            n.update(status="active" if valid.get(memory_id) else "unsupported", admitted_by=actor, revision=n["revision"] + 1)
            self.commit(tenant, s, [n], event_type="memory.reviewed", details={"memory_id": memory_id, "actor": actor})
            return n

    def inspect(self, tenant, memory_id):
        with self.locked(tenant, ready=False) as s:
            self.get(s, memory_id, "Memory")
            return provenance(s, memory_id)

    def read_memory(self, tenant, run_id, subject, predicates=None):
        with self.locked(tenant) as s:
            run = self.check_run(s, run_id)
            valid, _ = evaluate(s)
            found = [n for n in s["nodes"].values() if n["kind_label"] == "Memory" and n["subject"] == subject
                     and (not predicates or n["predicate"] in predicates) and n["status"] == "active" and valid.get(n["id"])]
            edges = [edge(n["id"], "READ_BY", run_id, revision=n["revision"], retrieved_at=now()) for n in found]
            episode = record("Episode", run_id=run_id, role="tool", type="memory.read", data={"subject": subject, "memories": found})
            self.commit(tenant, s, [episode], edges + [edge(episode["id"], "BELONGS_TO", run_id)],
                        "memory.read", {"run_id": run_id, "memory_ids": [n["id"] for n in found]})
            return {"memories": found, "run_id": run_id}

    def create_task(self, tenant, data):
        with self.locked(tenant) as s:
            task = record("Task", **data, generation=1, status="pending", owner_role="planner")
            if task["id"] in s["nodes"]:
                raise DomainError("ID_EXISTS", "Task already exists")
            self.commit(tenant, s, [task], event_type="task.created", details={"task_id": task["id"]})
            return task

    def check_run(self, s, run_id, role=None):
        run = self.get(s, run_id, "Run")
        task = self.get(s, run["task_id"], "Task")
        if run["generation"] != task["generation"] or run["status"] in {"restart_required", "interrupted", "failed", "completed", "awaiting_input"}:
            raise DomainError("STALE_RUN", "Run is not eligible for new work; start a fresh run", run_id=run_id)
        if role and run["role"] != role:
            raise DomainError("FORBIDDEN", "Wrong agent role for this operation", 403)
        return run

    def start_run(self, tenant, task_id, role, mode, model, provider="openai"):
        with self.locked(tenant) as s:
            task = self.get(s, task_id, "Task")
            if task["status"] == "completed":
                raise DomainError("TASK_COMPLETED", "This task already has a committed simulated effect")
            if task["owner_role"] != role:
                raise DomainError("HANDOFF_REQUIRED", "Start the role currently owning the task", owner_role=task["owner_role"])
            if any(n["kind_label"] == "Run" and n["task_id"] == task_id and n["generation"] == task["generation"]
                   and n["status"] in {"queued", "running", "awaiting_approval"} for n in s["nodes"].values()):
                raise DomainError("RUN_ACTIVE", "A task already has an active run")
            run = record("Run", task_id=task_id, role=role, mode=mode, model=model, provider=provider if mode == "live" else "scripted",
                         generation=task["generation"], status="queued", steps=0)
            edges = [edge(run["id"], "WORKS_ON", task_id)]
            if role == "executor" and task.get("planner_run_id"):
                edges.append(edge(task["planner_run_id"], "HANDED_OFF_TO", run["id"], task_id=task_id))
            task["status"] = "running"
            self.commit(tenant, s, [run, task], edges, "run.started", {"run_id": run["id"], "mode": mode, "role": role})
            return run

    def update_run(self, tenant, run_id, status, **fields):
        with self.locked(tenant, ready=False) as s:
            run = self.get(s, run_id, "Run")
            if run["status"] == "restart_required" and status != "restart_required":
                return run
            run.update(status=status, **fields)
            changes = [run]
            if status in {"failed", "interrupted", "awaiting_input"}:
                task = self.get(s, run["task_id"], "Task")
                if task["generation"] == run["generation"] and task["status"] != "completed":
                    task["status"] = status
                    changes.append(task)
            self.commit(tenant, s, changes, event_type="run.updated", details={"run_id": run_id, "status": status})
            return run

    def episode(self, tenant, run_id, role, data, episode_type="message"):
        with self.locked(tenant, ready=False) as s:
            self.get(s, run_id, "Run")
            n = record("Episode", run_id=run_id, role=role, type=episode_type, data=data)
            self.commit(tenant, s, [n], [edge(n["id"], "BELONGS_TO", run_id)], "run.episode",
                        {"run_id": run_id, "episode_id": n["id"], "role": role, "episode_type": episode_type})
            return n

    def handoff(self, tenant, run_id):
        with self.locked(tenant) as s:
            run = self.check_run(s, run_id, "planner")
            task = self.get(s, run["task_id"], "Task")
            task.update(owner_role="executor", status="handed_off", planner_run_id=run_id)
            run["status"] = "completed"
            self.commit(tenant, s, [task, run], event_type="task.handoff", details={"task_id": task["id"], "planner_run_id": run_id})
            return task

    def _requirements(self, s, task):
        return [current(s, task["supplier_id"], "legal_name"), current(s, task["supplier_id"], "payment_routing"),
                current(s, task["invoice_id"], "invoice_details")]

    def _payload(self, task, required):
        invoice = required[2]["value"]
        if not isinstance(invoice, dict) or invoice.get("supplier_id") != task["supplier_id"]:
            raise DomainError("INVOICE_MISMATCH", "Invoice must belong to the task's supplier")
        return PaymentPayload(supplier_id=task["supplier_id"], invoice_id=task["invoice_id"],
                              amount_minor=invoice["amount_minor"], currency=invoice["currency"],
                              routing_token=required[1]["value"]).model_dump()

    def propose_action(self, tenant, run_id, payload, idempotency_key):
        payload = PaymentPayload.model_validate(payload).model_dump()
        with self.locked(tenant) as s:
            run = self.check_run(s, run_id, "executor")
            task = self.get(s, run["task_id"], "Task")
            required = self._requirements(s, task)
            if any(n["kind_label"] == "Receipt" and n["result"]["invoice_id"] == task["invoice_id"]
                   and n["result"]["supplier_id"] == task["supplier_id"] for n in s["nodes"].values()):
                raise DomainError("INVOICE_ALREADY_PAID", "An existing simulated receipt requires review, not another payment")
            if payload != self._payload(task, required):
                raise DomainError("PAYLOAD_MISMATCH", "Payload must match current supported memories")
            seen = {e["source"]: e["data"].get("revision") for e in s["edges"] if e["type"] == "READ_BY" and e["target"] == run_id}
            if any(seen.get(n["id"]) != n["revision"] for n in required):
                raise DomainError("INVALID_PROVENANCE", "Executor must retrieve all current required facts")
            existing = next((n for n in s["nodes"].values() if n["kind_label"] == "Action" and n["idempotency_key"] == idempotency_key), None)
            if existing:
                if existing["payload"] == payload and existing["run_id"] == run_id:
                    return existing
                raise DomainError("IDEMPOTENCY_CONFLICT", "Key already belongs to another proposal")
            dependencies = {n["id"]: n["revision"] for n in required}
            proof_hash = digest([provenance(s, n["id"]) for n in required])
            action = record("Action", run_id=run_id, task_id=task["id"], generation=task["generation"], type="simulated_payment",
                            payload=payload, payload_hash=digest(payload), proof_hash=proof_hash, dependencies=dependencies,
                            status="pending", idempotency_key=idempotency_key)
            run["status"] = "awaiting_approval"
            task["status"] = "awaiting_approval"
            self.commit(tenant, s, [action, run, task], [edge(run_id, "PROPOSED", action["id"])] +
                        [edge(n["id"], "REQUIRED_BY", action["id"], revision=n["revision"]) for n in required],
                        "action.proposed", {"action_id": action["id"], "run_id": run_id})
            return action

    def approve(self, tenant, action_id, payload_hash, actor):
        with self.locked(tenant) as s:
            a = self.get(s, action_id, "Action")
            if a["status"] not in {"pending", "approved"}:
                raise DomainError("STALE_ACTION", "Action cannot be approved in its current state")
            if payload_hash != a["payload_hash"]:
                raise DomainError("PAYLOAD_MISMATCH", "Approve the exact inspected payload hash")
            self._validate_action(s, a, approval=False)
            if a["status"] == "approved":
                return a
            approval = record("Approval", action_id=action_id, payload_hash=payload_hash, proof_hash=a["proof_hash"], actor=actor, status="active")
            a.update(status="approved", approval_id=approval["id"])
            self.commit(tenant, s, [a, approval], [edge(approval["id"], "APPROVES", action_id)],
                        "action.approved", {"action_id": action_id, "actor": actor})
            return a

    def _validate_action(self, s, a, approval=True):
        run = self.check_run(s, a["run_id"], "executor")
        task = self.get(s, a["task_id"], "Task")
        if a["generation"] != task["generation"] or a["status"] == "stale":
            raise DomainError("STALE_ACTION", "Proposal belongs to obsolete task state")
        required = self._requirements(s, task)
        if {n["id"]: n["revision"] for n in required} != a["dependencies"]:
            raise DomainError("STALE_MEMORY", "Action memory revisions changed", action_id=a["id"])
        if self._payload(task, required) != a["payload"] or digest(a["payload"]) != a["payload_hash"]:
            raise DomainError("PAYLOAD_MISMATCH", "Frozen payload does not match current supported memory")
        if digest([provenance(s, n["id"]) for n in required]) != a["proof_hash"]:
            raise DomainError("STALE_MEMORY", "Action provenance changed")
        if approval:
            ap = self.get(s, a.get("approval_id"), "Approval")
            if ap["status"] != "active" or ap["payload_hash"] != a["payload_hash"] or ap["proof_hash"] != a["proof_hash"]:
                raise DomainError("MISSING_APPROVAL", "Current exact approval is required")
        return run, task

    def execute(self, tenant, action_id):
        with self.locked(tenant) as s:
            a = self.get(s, action_id, "Action")
            existing = next((n for n in s["nodes"].values() if n["kind_label"] == "Receipt" and n["idempotency_key"] == a["idempotency_key"]), None)
            if existing:
                if existing["payload_hash"] != a["payload_hash"]:
                    raise DomainError("IDEMPOTENCY_CONFLICT", "Existing receipt has different payload")
                return {"receipt": existing, "already_committed": True}
            try:
                if any(n["kind_label"] == "Receipt" and n["result"]["invoice_id"] == a["payload"]["invoice_id"]
                       and n["result"]["supplier_id"] == a["payload"]["supplier_id"] for n in s["nodes"].values()):
                    raise DomainError("INVOICE_ALREADY_PAID", "Invoice already has a simulated receipt")
                if a["status"] != "approved":
                    raise DomainError("STALE_ACTION" if a["status"] == "stale" else "MISSING_APPROVAL", "Action must be currently approved")
                run, task = self._validate_action(s, a)
            except DomainError as exc:
                self.commit(tenant, s, [], event_type="action.blocked", details={"action_id": action_id, "code": exc.code, **exc.details})
                raise
            receipt = record("Receipt", action_id=action_id, idempotency_key=a["idempotency_key"], payload_hash=a["payload_hash"],
                             simulated=True, result={"status": "committed", **a["payload"]})
            a.update(status="committed", receipt_id=receipt["id"])
            task["status"] = "completed"
            self.commit(tenant, s, [receipt, a, task], [edge(action_id, "HAS_RECEIPT", receipt["id"])],
                        "action.committed", {"action_id": action_id, "receipt_id": receipt["id"], "simulated": True})
            return {"receipt": receipt, "already_committed": False}

    def verify_receipt(self, tenant, run_id, action_id):
        with self.locked(tenant) as s:
            run = self.check_run(s, run_id, "executor")
            action = self.get(s, action_id, "Action")
            if action["run_id"] != run_id:
                raise DomainError("FORBIDDEN", "Only this run's action can be verified", 403)
            if not action.get("receipt_id"):
                raise DomainError("NO_RECEIPT", "Action has no committed receipt")
            receipt = self.get(s, action["receipt_id"], "Receipt")
            if receipt["payload_hash"] != action["payload_hash"] or receipt["action_id"] != action_id:
                raise DomainError("INVALID_RECEIPT", "Receipt does not match the committed action")
            run.update(receipt_verified=True, verified_receipt_id=receipt["id"])
            self.commit(tenant, s, [run], event_type="receipt.verified", details={"run_id": run_id, "receipt_id": receipt["id"]})
            return receipt

    def apply_correction(self, tenant, data, actor):
        with self.locked(tenant) as s:
            old_id = data.get("supersedes_id")
            old = self.get(s, old_id, "Memory") if old_id else None
            if old and old["status"] == "active":
                raise DomainError("REPAIR_REQUIRED", "Revoke the old source before replacing usable memory")
            source_data = data["source"]
            source = record("Source", **source_data, status="active", content_hash=digest(source_data["content"]), admitted_by=actor)
            memory_data = dict(data["memory"])
            memory_data.pop("inputs")
            self.validate_fact(memory_data)
            if memory_data["kind"] != "semantic":
                raise DomainError("INVALID_CORRECTION", "Corrections admit semantic facts; derive plans through agents", 422)
            if old and (old["subject"], old["predicate"]) != (memory_data["subject"], memory_data["predicate"]):
                raise DomainError("INVALID_CORRECTION", "Replacement must address the same subject and predicate", 422)
            memory = record("Memory", **memory_data, status="active", revision=1, admitted=True,
                            admitted_by=actor, historical_verified=False)
            if source["id"] == memory["id"] or source["id"] in s["nodes"] or memory["id"] in s["nodes"]:
                raise DomainError("ID_EXISTS", "Correction source and memory need distinct, new version IDs")
            proposed = copy.deepcopy(s)
            proposed["nodes"][source["id"]] = source
            justification, edges = self._attach(proposed, memory, [source["id"]])
            changes = [source, memory, justification]
            if old:
                old.update(status="superseded", revision=old["revision"] + 1)
                changes.append(old)
                edges.append(edge(memory["id"], "SUPERSEDES", old["id"]))
            self.commit(tenant, s, changes, edges, "correction.admitted", {"memory_id": memory["id"], "source_id": source["id"], "actor": actor})
            return {"source": source, "memory": memory}

    def preview(self, tenant, source_id):
        with self.locked(tenant) as s:
            self.get(s, source_id, "Source")
            affected = self.store.descendants(tenant, source_id)
            simulated = copy.deepcopy(s)
            simulated["nodes"][source_id]["status"] = "revoked"
            valid, _ = evaluate(simulated)
            return {"source_id": source_id, "affected": sorted(affected),
                    "invalidated": sorted(i for i in affected if not valid.get(i)),
                    "preserved": sorted(i for i in affected if valid.get(i)), "preview_only": True}

    def revoke(self, tenant, source_id, reason, key, actor):
        with self.locked(tenant, ready=False) as s:
            prior = next((n for n in s["nodes"].values() if n["kind_label"] == "Repair" and n["idempotency_key"] == key), None)
            if prior:
                if prior["source_id"] != source_id or prior["reason"] != reason:
                    raise DomainError("IDEMPOTENCY_CONFLICT", "Repair key belongs to a different request")
                return prior if prior["state"] == "completed" else self._finish_repair(tenant, s, prior)
            if s["nodes"]["state"]["mode"] != "ready":
                raise DomainError("REPAIR_IN_PROGRESS", "Recover current repair first")
            source = self.get(s, source_id, "Source")
            if source["status"] != "active":
                raise DomainError("SOURCE_REVOKED", "This source version is already revoked")
            affected = sorted(self.store.descendants(tenant, source_id))
            repair = record("Repair", source_id=source_id, reason=reason, actor=actor, idempotency_key=key, state="repairing",
                            affected=affected, baseline={i: s["nodes"][i]["revision"] for i in affected})
            state = s["nodes"]["state"]
            state["mode"] = "repairing"
            self.commit(tenant, s, [repair, state], [edge(repair["id"], "REVOKES", source_id)],
                        "repair.started", {"repair_id": repair["id"], "source_id": source_id})
            return self._finish_repair(tenant, s, repair)

    def _finish_repair(self, tenant, s, repair):
        source = self.get(s, repair["source_id"], "Source")
        source.update(status="revoked", revoked_at=source.get("revoked_at") or now(), reason=repair["reason"])
        self.commit(tenant, s, [source])
        valid, justifications = evaluate(s)
        affected = set(repair["affected"])
        changed = []
        for identifier in affected:
            n = self.get(s, identifier, "Memory")
            n.update(status="active" if valid.get(identifier) else "unsupported",
                     revision=repair["baseline"][identifier] + 1, last_repair_id=repair["id"])
            changed.append(n)
        for n in s["nodes"].values():
            if n["kind_label"] == "Justification" and n["target_id"] in affected:
                n["status"] = "active" if n["id"] in justifications.get(n["target_id"], []) else "invalid"
                changed.append(n)
        affected_runs = {e["target"] for e in s["edges"] if e["type"] == "READ_BY" and e["source"] in affected}
        task_ids, stale, review = set(), [], []
        for n in s["nodes"].values():
            if n["kind_label"] == "Action" and affected.intersection(n["dependencies"]):
                if n["status"] == "committed":
                    n["review_needed"] = True
                    review.append(n["id"])
                else:
                    n.update(status="stale", stale_reason="SOURCE_REVOKED", repair_id=repair["id"])
                    stale.append(n["id"])
                    affected_runs.add(n["run_id"])
                    task_ids.add(n["task_id"])
                changed.append(n)
        for run_id in affected_runs:
            n = self.get(s, run_id, "Run")
            n.update(status="restart_required", repair_id=repair["id"])
            changed.append(n)
            task_ids.add(n["task_id"])
        for task_id in task_ids:
            n = self.get(s, task_id, "Task")
            if n.get("last_repair_id") != repair["id"]:
                n.update(generation=n["generation"] + 1, status="needs_replan", owner_role="planner", last_repair_id=repair["id"])
            changed.append(n)
        self.commit(tenant, s, changed)
        # Read back the actual persisted support before reopening this tenant.
        actual = self.store.snapshot(tenant)
        actual_valid, _ = evaluate(actual)
        if any((actual["nodes"][i]["status"] == "active") != bool(actual_valid.get(i)) for i in affected):
            raise DomainError("REPAIR_FAILED", "Repair invariant verification failed", 503)
        repair.update(state="completed", completed_at=now(), report={
            "invalidated": sorted(i for i in affected if not actual_valid.get(i)),
            "preserved": sorted(i for i in affected if actual_valid.get(i)),
            "affected_runs": sorted(affected_runs), "stale_actions": sorted(stale), "review_needed": sorted(review),
            "resumable_tasks": sorted(task_ids)})
        state = s["nodes"]["state"]
        state["mode"] = "ready"
        self.commit(tenant, s, [repair, state], event_type="repair.completed", details={"repair_id": repair["id"], **repair["report"]})
        return repair

    def recover(self, tenant):
        with self.locked(tenant, ready=False) as s:
            reports = []
            for n in list(s["nodes"].values()):
                if n["kind_label"] == "Repair" and n["state"] != "completed":
                    reports.append(self._finish_repair(tenant, s, n))
            if s["nodes"]["state"]["mode"] != "ready":
                raise DomainError("REPAIR_FAILED", "Repair marker has no recoverable operation", 503)
            interrupted = [n for n in s["nodes"].values() if n["kind_label"] == "Run" and n["status"] in {"queued", "running"}]
            tasks = []
            for n in interrupted:
                n["status"] = "interrupted"
                task = self.get(s, n["task_id"], "Task")
                task["status"] = "interrupted"
                tasks.append(task)
            if interrupted:
                self.commit(tenant, s, interrupted + tasks, event_type="runs.interrupted", details={"run_ids": [n["id"] for n in interrupted]})
            return reports
