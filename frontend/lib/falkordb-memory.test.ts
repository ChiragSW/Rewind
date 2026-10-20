import { describe, expect, it, vi } from "vitest"
import { FalkorDBMemoryStore } from "./falkordb-memory"

const makeGraph = () => ({
  query: vi.fn().mockResolvedValue({}),
  roQuery: vi.fn().mockResolvedValue({ data: [] }),
})

describe("FalkorDBMemoryStore (Unit with Mocks)", () => {
  it("writes the complete source -> evidence -> fact -> memory lineage", async () => {
    const graph = makeGraph()
    const store = new FalkorDBMemoryStore(graph as never)
    await store.write({
      source: { id: "s1", kind: "document", title: "Notes", capturedAt: "2026-10-15T00:00:00Z" },
      evidence: { id: "e1", sourceId: "s1", excerpt: "likes tea", capturedAt: "2026-10-15T00:00:00Z" },
      fact: {
        id: "f1",
        subject: "user",
        predicate: "likes",
        object: "tea",
        evidence: { mode: "all", evidenceIds: ["e1"] },
        createdAt: "2026-10-15T00:00:00Z",
      },
      memory: {
        id: "m1",
        kind: "preference",
        content: "User likes tea",
        evidence: { mode: "all", evidenceIds: ["e1"] },
        derivedFromFactIds: ["f1"],
        createdAt: "2026-10-15T00:00:00Z",
      },
    })
    expect(graph.query).toHaveBeenCalledWith(expect.stringContaining("PROVIDES"), expect.anything())
    expect(graph.query).toHaveBeenCalledWith(expect.stringContaining("DERIVES"), expect.anything())
    expect(graph.query).toHaveBeenCalledWith(expect.stringContaining("SUPPORTS"), expect.anything())
  })

  it("records persistent retrieved memories and prompt context subset separately", async () => {
    const graph = makeGraph()
    const store = new FalkorDBMemoryStore(graph as never)
    await store.recordAgentRun({
      id: "r1",
      status: "running",
      input: "hello",
      retrievedMemoryIds: ["m1", "m2", "m3"],
      contextMemoryIds: ["m1"],
      startedAt: "2026-10-15T00:00:00Z",
    })
    const [query, options] = graph.query.mock.calls[0]
    expect(query).toContain("RETRIEVED")
    expect(query).toContain("CONTEXT")
    expect(options.params.contextIds).toEqual(["m1"])
    expect(options.params.retrievedIds).toEqual(["m1", "m2", "m3"])
  })

  it("records proposed action with depends_on and proposes relationships", async () => {
    const graph = makeGraph()
    const store = new FalkorDBMemoryStore(graph as never)
    await store.recordProposedAction(
      {
        id: "a1",
        description: "Payment action",
        memoryIds: ["m1", "m2"],
        status: "proposed",
      },
      "run-001"
    )
    const [query, options] = graph.query.mock.calls[0]
    expect(query).toContain("DEPENDS_ON")
    expect(query).toContain("PROPOSES")
    expect(options.params.runId).toBe("run-001")
    expect(options.params.deps).toEqual(["m1", "m2"])
  })

  it("returns only active memories from the graph read operation", async () => {
    const graph = makeGraph()
    graph.roQuery.mockResolvedValue({
      data: [{ m: { id: "m1", content: "User likes tea", kind: "preference", status: "active" } }],
    })
    const store = new FalkorDBMemoryStore(graph as never)
    const result = await store.retrieveRelevant("tea")
    expect(graph.roQuery).toHaveBeenCalledWith(expect.stringContaining("m.status = 'active'"), expect.anything())
    expect(result[0]).toMatchObject({ id: "m1", persistent: true, status: "active" })
  })

  it("validates memory status and counts supporting evidence", async () => {
    const graph = makeGraph()
    graph.roQuery.mockResolvedValue({
      data: [{ m: { id: "m1", status: "active" }, evidenceCount: 1, activeSources: 1 }],
    })
    const store = new FalkorDBMemoryStore(graph as never)
    const check = await store.validateMemoryStatus("m1")
    expect(check.valid).toBe(true)
    expect(check.status).toBe("active")
    expect(check.supportingEvidenceCount).toBe(1)
  })
})
