"""Grounded AND/OR support evaluation. Stored status alone is never proof."""
import time

from .contracts import DomainError
from .graph import canonical


def supports(snapshot):
    nodes = snapshot["nodes"]
    inputs, targets = {}, {}
    for e in snapshot["edges"]:
        if e["type"] == "INPUT_TO":
            inputs.setdefault(e["target"], []).append(e["source"])
        elif e["type"] == "SUPPORTS":
            targets.setdefault(e["target"], []).append(e["source"])
    return inputs, targets


def evaluate(snapshot):
    nodes = snapshot["nodes"]
    inputs, targets = supports(snapshot)
    valid, valid_justifications, visiting = {}, {}, set()
    workflow_version = nodes.get("state", {}).get("workflow_version", 1)

    def check(identifier):
        if identifier in valid:
            return valid[identifier]
        if identifier in visiting:
            raise DomainError("CYCLIC_SUPPORT", "Memory cannot justify itself", 422, memory_id=identifier)
        n = nodes.get(identifier)
        if not n:
            return False
        if n["kind_label"] == "Source":
            valid[identifier] = n["status"] == "active" and n["authority"] in {"reviewed", "authoritative"}
            return valid[identifier]
        if n["kind_label"] != "Memory":
            return False
        visiting.add(identifier)
        good = []
        for jid in targets.get(identifier, []):
            j = nodes.get(jid, {})
            actual_inputs = inputs.get(jid, [])
            if actual_inputs and set(actual_inputs) == set(j.get("input_ids", [])):
                # Evaluate every input so a false branch does not hide a cycle.
                checks = [check(i) for i in actual_inputs]
                if all(checks):
                    good.append(jid)
        visiting.remove(identifier)
        eligible = bool(n.get("admitted")) and n.get("status") != "superseded"
        eligible &= n.get("valid_until") is None or n["valid_until"] > time.time()
        conditions = n.get("applicability", {})
        eligible &= not conditions or conditions == {"workflow_version": workflow_version}
        if n.get("kind") == "procedural":
            receipt = nodes.get(n.get("verified_receipt_id"), {})
            eligible &= bool(n.get("historical_verified")) or receipt.get("kind_label") == "Receipt"
        valid_justifications[identifier] = sorted(good)
        valid[identifier] = bool(eligible and good)
        return valid[identifier]

    for n in nodes.values():
        if n["kind_label"] == "Memory":
            check(n["id"])
    return valid, valid_justifications


def current(snapshot, subject, predicate):
    valid, _ = evaluate(snapshot)
    found = [n for n in snapshot["nodes"].values() if n["kind_label"] == "Memory"
             and n["subject"] == subject and n["predicate"] == predicate
             and n["status"] == "active" and valid.get(n["id"])]
    if not found:
        raise DomainError("MISSING_MEMORY", "No current grounded memory", subject=subject, predicate=predicate)
    if len({canonical(n["value"]) for n in found}) > 1:
        raise DomainError("CONFLICTING_FACT", "Conflicting facts require operator review",
                          memory_ids=[n["id"] for n in found])
    return sorted(found, key=lambda n: n["id"])[0]


def provenance(snapshot, identifier):
    nodes = snapshot["nodes"]
    if identifier not in nodes:
        raise DomainError("NOT_FOUND", "Memory not found", 404)
    inputs, targets = supports(snapshot)
    ancestors, pending = set(), [identifier]
    while pending:
        key = pending.pop()
        if key in ancestors:
            continue
        ancestors.add(key)
        pending.extend(targets.get(key, []))
        pending.extend(inputs.get(key, []))
    valid, justifications = evaluate(snapshot)
    return {"memory_id": identifier, "grounded": valid.get(identifier, False),
            "valid_justifications": justifications.get(identifier, []),
            "nodes": [nodes[i] for i in sorted(ancestors) if i in nodes],
            "edges": [e for e in snapshot["edges"] if e["source"] in ancestors and e["target"] in ancestors]}

