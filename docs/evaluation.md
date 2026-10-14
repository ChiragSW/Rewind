# Verification and evaluation

Development verification uses actual FalkorDB 4.20.7 and Python 3.13.1. The 27-test behavior suite uses isolated, uniquely named graphs, deterministic tools, a local OpenAI-compatible HTTP fixture, and a mocked Codex CLI fixture. The actual OpenAI SDK issues HTTP requests in its fixture; the tests do not consume model account credits. A separate workflow uses real Codex model inference through the existing ChatGPT login.

The tests include selective AND/OR repair, copies retaining dependencies, candidate review, stale proposals/writes, exact approvals, omitted dependencies, invoice identity, role/tenant isolation, concurrent writes, duplicate effect retries, revocation/execute races, partial-write recovery, and a complete API workflow. `artifacts/tests.xml` is the latest machine-readable result.

`scripts/evaluate.py` creates 20 labeled small cases varying dependency depth, AND inputs, and alternative independent support. Each runs against three actual graph-backed memory-service variants: status-only source deletion, full usable-memory wipe, and Rewind repair. This evaluates memory repair/retrieval behavior; the payment execution gate is tested separately and is not intentionally disabled to manufacture unsafe-payment counts.

Recorded results in `artifacts/evaluation.json`:

| Controlled variant | Invalidation recall | Valid-memory retention | Stale memories retained across 20 cases |
| --- | --- | --- | --- |
| Delete-only | 0.0 | 1.0 | 120 |
| Wipe-all | 1.0 | 0.0 | 0 |
| Rewind | 1.0 | 1.0 | 0 |

These are fixture results, not real-world accuracy, a commercial-product benchmark, or a full MemSecBench reproduction. The raw artifact records each case, graph size, operation latency, and explicit baseline scope. It does not claim large-graph throughput or statistically established model superiority.

The concurrency test starts 50 callers writing 100 unique episodes and checks for loss/sequence collisions. Writes are serialized per tenant in one process. Races accept either a committed-first result with a review notice or a revoked-first rejected effect. Ambiguous-response tests simulate failures after writes, then verify idempotent recovery.

The local durability check inspects live configuration and verifies graph/receipt IDs across database container restart. AOF is enabled through the image's actual entrypoint configuration, with `appendfsync always`. Any additional crash-recovery check is recorded separately in the verification artifact.

[docker-verification.json](../artifacts/docker-verification.json) preserves the earlier packaged-backend check: 26 tests, a forced database restart preserving 211 records and one receipt, and a later backend restart preserving the exact HTTP graph hash (213 records, 128 edges, one receipt). These used separate synthetic demo seeds. The [scripted HTTP transcript](../artifacts/api-demo.json) records that deterministic workflow.

The latest [verification.json](../artifacts/verification.json) records 27 passing tests and a separate [real Codex CLI workflow](../artifacts/codex-live-demo.json): four distinct live planner/executor runs, 23 structured model decisions, stale execution rejection, a reviewed correction, one verified corrected receipt, and an exact graph preserved across a host backend process restart. All company data/effects remain fictional. This is one real-model fixture workflow, not a model-quality benchmark. Early live rehearsals exposed ambiguous plan fields; the final tool requires all three fact dependencies and binds invoice scope on the server.

