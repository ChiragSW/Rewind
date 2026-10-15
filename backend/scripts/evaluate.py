"""Controlled memory-service baselines on real, isolated FalkorDB fixture graphs."""
import json
import pathlib
import sys
import time
from uuid import uuid4

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from rewind.config import Settings
from rewind.contracts import MemoryCreate
from rewind.demo import seed
from rewind.graph import GraphStore, now
from rewind.service import Rewind


def main():
    original = Settings.from_env()
    settings = Settings(host=original.host, port=original.port, password=original.password,
                        graph_prefix="rewind_eval_" + uuid4().hex[:10] + "_", enable_demo=True)
    service = Rewind(GraphStore(settings))
    results = []
    for index in range(20):
        for mode in ("delete_only", "wipe_all", "rewind"):
            tenant = f"case_{index}_{mode}"
            seed(service, tenant)
            expected_invalid = {"mem-routing-wrong", "mem-payment-plan-old", "mem-routing-procedure-old"}
            expected_preserved = {"mem-supplier-name", "mem-invoice-amount", "mem-delivery-terms"}
            parent = "mem-routing-wrong"
            for depth in range(index % 5 + 1):
                identifier = f"derived-{depth}"
                service.add_memory(tenant, MemoryCreate(id=identifier, kind="plan", subject="eval", predicate="derived",
                    value={"copy": depth}, inputs=[parent, "mem-invoice-amount"] if index % 2 else [parent]).model_dump(), "eval")
                expected_invalid.add(identifier)
                parent = identifier
            if index >= 10:
                service.add_memory(tenant, MemoryCreate(id="independent", subject="eval", predicate="independent", value="supported",
                    inputs=["src-delivery-terms"]).model_dump(), "eval")
                service.add_support(tenant, "independent", ["src-onboarding-incorrect"], "eval")
                expected_preserved.add("independent")
            before = service.snapshot(tenant)
            started = time.perf_counter()
            if mode == "rewind":
                service.revoke(tenant, "src-onboarding-incorrect", "fixture correction", "eval", "eval")
            else:
                with service.locked(tenant) as s:
                    source = s["nodes"]["src-onboarding-incorrect"]
                    source["status"] = "revoked"
                    changes = [source]
                    if mode == "wipe_all":
                        for n in s["nodes"].values():
                            if n["kind_label"] == "Memory":
                                n["status"] = "unsupported"
                                changes.append(n)
                    service.commit(tenant, s, changes)
            elapsed = (time.perf_counter() - started) * 1000
            after = service.snapshot(tenant)
            # Baselines deliberately evaluate their status-only memory retrieval surface.
            usable = {n["id"] for n in after["nodes"].values() if n["kind_label"] == "Memory" and n["status"] == "active"}
            all_ids = expected_invalid | expected_preserved
            withdrawn = all_ids - usable
            true = withdrawn & expected_invalid
            results.append({"case": index, "mode": mode, "depth": index % 5 + 1,
                            "invalidation_precision": len(true) / len(withdrawn) if withdrawn else None,
                            "invalidation_recall": len(true) / len(expected_invalid),
                            "valid_memory_retention": len(usable & expected_preserved) / len(expected_preserved),
                            "stale_memories_remaining": len(usable & expected_invalid),
                            "repair_latency_ms": round(elapsed, 3), "starting_records": len(before["nodes"]),
                            "starting_edges": len(before["edges"])})
            service.store.client.execute_command("GRAPH.DELETE", service.store.name(tenant))
    report = {"generated_at": now(), "database_image": "falkordb/falkordb-server:v4.20.7", "cases": 20,
              "persistence": {"appendonly": service.store.client.config_get("appendonly").get("appendonly"),
                              "appendfsync": service.store.client.config_get("appendfsync").get("appendfsync")},
              "measurements": 60, "model_inference": False, "effects": "memory retrieval only; execution safety is tested separately",
              "baseline_scope": "controlled status-only delete and wipe variants, not commercial product claims", "results": results}
    target = pathlib.Path("artifacts/evaluation.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    for mode in ("delete_only", "wipe_all", "rewind"):
        rows = [r for r in results if r["mode"] == mode]
        print(mode, {"recall": round(sum(r["invalidation_recall"] for r in rows) / 20, 3),
                     "retention": round(sum(r["valid_memory_retention"] for r in rows) / 20, 3),
                     "stale_remaining": sum(r["stale_memories_remaining"] for r in rows)})
    print("Saved", target)


if __name__ == "__main__":
    main()
