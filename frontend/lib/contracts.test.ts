import { describe, expect, it } from "vitest"
import {
  type DerivedMemory,
  type Evidence,
  makeEvidenceSupport,
  validateContractGraph,
  validateAgentRun,
  validateRewindResponse,
} from "./contracts"

const evidence: Evidence[] = [
  { id: "e1", sourceId: "s1", excerpt: "User prefers concise updates", capturedAt: "2026-10-15T12:00:00Z" },
  { id: "e2", sourceId: "s1", excerpt: "User confirmed the preference", capturedAt: "2026-10-15T12:01:00Z" },
]

const memory: DerivedMemory = {
  id: "m1",
  kind: "preference",
  content: "Keep updates concise",
  evidence: makeEvidenceSupport("all", ["e1", "e2"]),
  createdAt: "2026-10-15T12:02:00Z",
}

describe("shared Rewind contracts", () => {
  it("requires every derived memory to reference existing evidence", () => {
    expect(() => validateContractGraph({
      sources: [{ id: "s1", kind: "conversation", title: "Chat", capturedAt: "2026-10-15T12:00:00Z" }],
      evidence,
      facts: [],
      memories: [memory],
    })).not.toThrow()

    expect(() => validateContractGraph({
      sources: [{ id: "s1", kind: "conversation", title: "Chat", capturedAt: "2026-10-15T12:00:00Z" }],
      evidence,
      facts: [],
      memories: [{ ...memory, evidence: makeEvidenceSupport("all", ["missing"]) }],
    })).toThrow(/does not exist/)
  })

  it("preserves all versus alternative evidence semantics", () => {
    expect(makeEvidenceSupport("all", ["e1", "e2"]).mode).toBe("all")
    expect(makeEvidenceSupport("any", ["e1", "e2"]).mode).toBe("any")
    expect(() => makeEvidenceSupport("all", [])).toThrow(/at least one/)
  })

  it("requires terminal agent runs to carry completion metadata", () => {
    expect(() => validateAgentRun({ id: "r1", status: "completed", input: "rewind", retrievedMemoryIds: [], startedAt: "2026-10-15T12:00:00Z" }, new Set())).toThrow(/completedAt/)
    expect(() => validateAgentRun({ id: "r1", status: "failed", input: "rewind", retrievedMemoryIds: [], startedAt: "2026-10-15T12:00:00Z", completedAt: "2026-10-15T12:01:00Z", error: "timeout" }, new Set())).not.toThrow()
  })

  it("requires a repair result to reference its preview", () => {
    expect(() => validateRewindResponse({
      preview: { id: "p1", targetAt: "2026-10-15T12:00:00Z", affectedMemoryIds: ["m1"], proposedActions: [], createdAt: "2026-10-15T12:03:00Z" },
      repair: { previewId: "p2", status: "planned", restoredMemoryIds: [], skippedMemoryIds: [], errors: [] },
    }, new Set(["m1"]))).toThrow(/preview/)
  })
})
