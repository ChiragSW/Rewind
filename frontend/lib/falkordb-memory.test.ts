import { describe, expect, it, vi } from "vitest"
import { FalkorDBMemoryStore } from "./falkordb-memory"

const makeGraph = () => ({ query: vi.fn().mockResolvedValue({}), roQuery: vi.fn().mockResolvedValue({ data: [] }) })

describe("FalkorDBMemoryStore", () => {
  it("writes the complete source-to-memory lineage in FalkorDB", async () => {
    const graph = makeGraph()
    const store = await FalkorDBMemoryStore.connect({ graph: graph as never })
    await store.write({
      source: { id: "s1", kind: "document", title: "Notes", capturedAt: "2026-10-15T00:00:00Z" },
      evidence: { id: "e1", sourceId: "s1", excerpt: "likes tea", capturedAt: "2026-10-15T00:00:00Z" },
      fact: { id: "f1", subject: "user", predicate: "likes", object: "tea", evidence: { mode: "all", evidenceIds: ["e1"] }, createdAt: "2026-10-15T00:00:00Z" },
      memory: { id: "m1", kind: "preference", content: "User likes tea", evidence: { mode: "all", evidenceIds: ["e1"] }, derivedFromFactIds: ["f1"], createdAt: "2026-10-15T00:00:00Z" },
    })
    expect(graph.query).toHaveBeenCalledWith(expect.stringContaining("PROVIDES"))
    expect(graph.query).toHaveBeenCalledWith(expect.stringContaining("DERIVES"))
    expect(graph.query).toHaveBeenCalledWith(expect.stringContaining("SUPPORTS"))
  })

  it("records retrieved and prompt context IDs separately", async () => {
    const graph = makeGraph()
    const store = await FalkorDBMemoryStore.connect({ graph: graph as never })
    await store.recordAgentRun({ id: "r1", status: "running", input: "hello", retrievedMemoryIds: ["m1", "m2"], contextMemoryIds: ["m1"], startedAt: "2026-10-15T00:00:00Z" })
    const query = graph.query.mock.calls[0][0]
    expect(query).toContain("RETRIEVED")
    expect(query).toContain("CONTEXT")
    expect(query).toContain('"contextMemoryIds":["m1"]')
  })

  it("returns only active memories from the real graph read operation", async () => {
    const graph = makeGraph()
    graph.roQuery.mockResolvedValue({ data: [{ m: { id: "m1", content: "User likes tea", kind: "preference" } }] })
    const store = await FalkorDBMemoryStore.connect({ graph: graph as never })
    const result = await store.retrieveRelevant("tea")
    expect(graph.roQuery).toHaveBeenCalledWith(expect.stringContaining("m.status = 'active'"))
    expect(result[0]).toMatchObject({ id: "m1", persistent: true, status: "active" })
  })
})
