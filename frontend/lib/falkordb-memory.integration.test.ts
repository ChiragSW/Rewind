import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { FalkorDB } from "falkordb"
import { FalkorDBMemoryStore } from "./falkordb-memory"

const TEST_GRAPH_NAME = `test_rewind_lineage_${Date.now()}`
const FALKORDB_URL = process.env.FALKORDB_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379"

describe("FalkorDB Integration (Live Database)", () => {
  let db: FalkorDB
  let store: FalkorDBMemoryStore
  let liveAvailable = false

  beforeAll(async () => {
    try {
      db = await FalkorDB.connect({ url: FALKORDB_URL })
      const graph = db.selectGraph(TEST_GRAPH_NAME)
      await graph.query("RETURN 1")
      store = new FalkorDBMemoryStore(graph)
      await store.ensureSchema()
      liveAvailable = true
    } catch (err) {
      console.warn("FalkorDB is not reachable on redis://127.0.0.1:6379, skipping live integration tests:", err)
      liveAvailable = false
    }
  })

  afterAll(async () => {
    if (liveAvailable && db) {
      try {
        const graph = db.selectGraph(TEST_GRAPH_NAME)
        await graph.delete()
      } catch {
        // ignore
      }
      try {
        db.close()
      } catch {
        // ignore
      }
    }
  })

  it("persists the complete Source -> Fact -> Derived Memory -> Agent Run -> Proposed Action flow in real FalkorDB", async () => {
    if (!liveAvailable) return

    // 1. Write Source -> Evidence -> Fact -> Derived Memory
    await store.write({
      source: {
        id: "src-order-1",
        title: "Vendor Invoice Document",
        content: "Northstar supplier invoice for $1,250 with routing BANK-DEMO-CORRECT",
        authority: "authoritative",
        status: "active",
      },
      evidence: {
        id: "ev-order-1",
        sourceId: "src-order-1",
        excerpt: "routing BANK-DEMO-CORRECT",
      },
      fact: {
        id: "fact-routing-1",
        subject: "northstar",
        predicate: "payment_routing",
        value: "BANK-DEMO-CORRECT",
        evidence: { mode: "all", evidenceIds: ["ev-order-1"] },
        createdAt: "2026-10-15T12:00:00Z",
      },
      memory: {
        id: "mem-routing-live",
        kind: "semantic",
        subject: "northstar",
        predicate: "payment_routing",
        value: "BANK-DEMO-CORRECT",
        content: "Northstar verified routing: BANK-DEMO-CORRECT",
        evidence: { mode: "all", evidenceIds: ["ev-order-1"] },
        derivedFromFactIds: ["fact-routing-1"],
        createdAt: "2026-10-15T12:00:00Z",
        status: "active",
      },
    })

    // Also write a second memory to test retrieved vs context distinction
    await store.write({
      source: {
        id: "src-order-2",
        title: "Secondary Notes",
        content: "Supplier tax ID note",
        status: "active",
      },
      evidence: {
        id: "ev-order-2",
        sourceId: "src-order-2",
        excerpt: "Tax ID note",
      },
      fact: {
        id: "fact-tax-1",
        subject: "northstar",
        predicate: "tax_id",
        value: "TAX-123",
        evidence: { mode: "all", evidenceIds: ["ev-order-2"] },
        createdAt: "2026-10-15T12:00:00Z",
      },
      memory: {
        id: "mem-tax-live",
        kind: "semantic",
        subject: "northstar",
        predicate: "tax_id",
        value: "TAX-123",
        content: "Tax identification TAX-123",
        evidence: { mode: "all", evidenceIds: ["ev-order-2"] },
        createdAt: "2026-10-15T12:00:00Z",
        status: "active",
      },
    })

    // 2. Query relevant memories and validate status
    const retrieved = await store.retrieveRelevant("Northstar")
    expect(retrieved.length).toBeGreaterThan(0)
    expect(retrieved.every((m) => m.status === "active")).toBe(true)

    // 3. Record Agent Run: retrieved both memories, but context only included mem-routing-live
    await store.recordAgentRun(
      {
        id: "run-planner-live-001",
        taskId: "task-live-1",
        role: "planner",
        status: "completed",
        retrievedMemoryIds: ["mem-routing-live", "mem-tax-live"],
        contextMemoryIds: ["mem-routing-live"],
        startedAt: "2026-10-15T12:01:00Z",
        completedAt: "2026-10-15T12:02:00Z",
      },
      ["mem-routing-live"]
    )

    // Verify context separation
    const runContext = await store.getRunContext("run-planner-live-001")
    expect(runContext.retrievedMemoryIds).toContain("mem-routing-live")
    expect(runContext.retrievedMemoryIds).toContain("mem-tax-live")
    expect(runContext.contextMemoryIds).toEqual(["mem-routing-live"])
    expect(runContext.contextMemories.map((m) => m.id)).toEqual(["mem-routing-live"])

    // 4. Record Proposed Action dependent on mem-routing-live
    await store.recordProposedAction(
      {
        id: "act-live-payment",
        description: "Submit simulated invoice payment",
        memoryIds: ["mem-routing-live"],
        payload: {
          supplier_id: "northstar",
          invoice_id: "INV-DEMO-1042",
          amount_minor: 125000,
          currency: "USD",
          routing_token: "BANK-DEMO-CORRECT",
        },
        status: "proposed",
      },
      "run-planner-live-001"
    )

    // 5. Query and validate action dependencies
    const actionDeps = await store.getActionDependencies("act-live-payment")
    expect(actionDeps.proposingRunId).toBe("run-planner-live-001")
    expect(actionDeps.dependencies).toHaveLength(1)
    expect(actionDeps.dependencies[0].memoryId).toBe("mem-routing-live")
    expect(actionDeps.allDependenciesValid).toBe(true)

    // 6. Validate memory status
    const statusCheck = await store.validateMemoryStatus("mem-routing-live")
    expect(statusCheck.valid).toBe(true)
    expect(statusCheck.status).toBe("active")
    expect(statusCheck.supportingEvidenceCount).toBe(1)
  })
})
