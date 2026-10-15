import { describe, expect, it } from "vitest"
import {
  type DerivedMemory,
  type Evidence,
  type Fact,
  type Source,
  makeEvidenceSupport,
  validateContractGraph,
  validateAgentRun,
  validateProposedAction,
  validateRewindResponse,
  validateMemoryProvenance,
  validateEvidenceSupport,
} from "./contracts"

const evidence: Evidence[] = [
  { id: "e1", sourceId: "s1", excerpt: "User prefers concise updates", capturedAt: "2026-10-15T12:00:00Z" },
  { id: "e2", sourceId: "s1", excerpt: "User confirmed the preference", capturedAt: "2026-10-15T12:01:00Z" },
  { id: "e3", sourceId: "s2", excerpt: "Independent confirmation in invoice", capturedAt: "2026-10-15T12:02:00Z" },
]

const memory: DerivedMemory = {
  id: "m1",
  kind: "preference",
  content: "Keep updates concise",
  evidence: makeEvidenceSupport("all", ["e1", "e2"]),
  createdAt: "2026-10-15T12:02:00Z",
}

describe("shared Rewind contracts", () => {
  describe("sources and evidence", () => {
    it("validates sources require id and title", () => {
      const source: Source = { id: "s1", title: "Chat Transcript", authority: "reviewed" }
      expect(source.id).toBe("s1")
      expect(source.authority).toBe("reviewed")
    })

    it("verifies evidence links to existing sources", () => {
      expect(() =>
        validateContractGraph({
          sources: [{ id: "s1", title: "Notes" }],
          evidence: [{ id: "e1", sourceId: "unknown", excerpt: "quoted text" }],
          facts: [],
          memories: [],
        })
      ).toThrow(/unknown source/)
    })
  })

  describe("facts and derived memories", () => {
    it("requires every derived memory to reference existing evidence", () => {
      expect(() =>
        validateContractGraph({
          sources: [{ id: "s1", title: "Chat" }, { id: "s2", title: "Invoice" }],
          evidence,
          facts: [],
          memories: [memory],
        })
      ).not.toThrow()

      expect(() =>
        validateContractGraph({
          sources: [{ id: "s1", title: "Chat" }, { id: "s2", title: "Invoice" }],
          evidence,
          facts: [],
          memories: [{ ...memory, evidence: makeEvidenceSupport("all", ["missing"]) }],
        })
      ).toThrow(/does not exist/)
    })

    it("preserves conjunctive (all) versus alternative (any) evidence semantics", () => {
      const conjunctive = makeEvidenceSupport("all", ["e1", "e2"])
      expect(conjunctive.mode).toBe("all")
      expect(conjunctive.evidenceIds).toEqual(["e1", "e2"])

      const alternative = makeEvidenceSupport("any", ["e1", "e3"])
      expect(alternative.mode).toBe("any")
      expect(alternative.evidenceIds).toEqual(["e1", "e3"])

      expect(() => makeEvidenceSupport("all", [])).toThrow(/at least one/)
    })

    it("validates memory provenance traceability", () => {
      const knownEvidence = new Set(["e1", "e2", "e3"])
      const validMemory: DerivedMemory = {
        id: "mem-routing",
        kind: "semantic",
        subject: "northstar",
        predicate: "payment_routing",
        value: "BANK-DEMO-CORRECT",
        evidence: makeEvidenceSupport("any", ["e3"]),
        createdAt: "2026-10-15T12:00:00Z",
      }
      expect(() => validateMemoryProvenance(validMemory, knownEvidence)).not.toThrow()

      const ungroundedMemory: DerivedMemory = {
        id: "mem-ungrounded",
        kind: "semantic",
        subject: "northstar",
        predicate: "routing",
        value: "UNKNOWN",
        evidence: { mode: "all", evidenceIds: [] },
        createdAt: "2026-10-15T12:00:00Z",
      }
      expect(() => validateMemoryProvenance(ungroundedMemory, knownEvidence)).toThrow(/require supporting evidence/)
    })
  })

  describe("agent runs and retrieved memory IDs", () => {
    it("validates run dependencies and completion metadata", () => {
      const knownMemories = new Set(["m1", "m2"])
      expect(() =>
        validateAgentRun(
          {
            id: "r1",
            taskId: "task-101",
            role: "planner",
            status: "completed",
            retrievedMemoryIds: ["m1"],
            completedAt: "2026-10-15T12:05:00Z",
            startedAt: "2026-10-15T12:00:00Z",
          },
          knownMemories
        )
      ).not.toThrow()

      expect(() =>
        validateAgentRun(
          { id: "r1", status: "completed", input: "plan", retrievedMemoryIds: [], startedAt: "2026-10-15T12:00:00Z" },
          knownMemories
        )
      ).toThrow(/completedAt/)

      expect(() =>
        validateAgentRun(
          {
            id: "r1",
            status: "failed",
            input: "plan",
            retrievedMemoryIds: ["unknown_mem"],
            startedAt: "2026-10-15T12:00:00Z",
            error: "timeout",
          },
          knownMemories
        )
      ).toThrow(/unknown memory/)
    })
  })

  describe("proposed actions and memory dependencies", () => {
    it("validates action payload and memory dependencies", () => {
      const knownMemories = new Set(["mem-supplier", "mem-invoice", "mem-routing"])
      const action = {
        id: "act-1",
        runId: "run-exec-1",
        description: "Simulated payment",
        payload: {
          supplier_id: "northstar",
          invoice_id: "INV-DEMO-1042",
          amount_minor: 125000,
          currency: "USD",
          routing_token: "BANK-DEMO-CORRECT",
        },
        memoryIds: ["mem-supplier", "mem-invoice", "mem-routing"],
        status: "proposed" as const,
      }
      expect(() => validateProposedAction(action, knownMemories)).not.toThrow()

      expect(() =>
        validateProposedAction(
          { ...action, memoryIds: ["mem-supplier", "unsupported-mem"] },
          knownMemories
        )
      ).toThrow(/does not exist/)
    })
  })

  describe("rewind previews and repair results", () => {
    it("validates preview-repair consistency", () => {
      const knownMemories = new Set(["m1", "m2"])
      expect(() =>
        validateRewindResponse(
          {
            preview: {
              id: "p1",
              targetAt: "2026-10-15T12:00:00Z",
              affectedMemoryIds: ["m1"],
              proposedActions: [],
              createdAt: "2026-10-15T12:03:00Z",
            },
            repair: {
              previewId: "p1",
              status: "applied",
              restoredMemoryIds: ["m1"],
              skippedMemoryIds: [],
              errors: [],
            },
          },
          knownMemories
        )
      ).not.toThrow()

      // Preview ID mismatch
      expect(() =>
        validateRewindResponse(
          {
            preview: {
              id: "p1",
              targetAt: "2026-10-15T12:00:00Z",
              affectedMemoryIds: ["m1"],
              createdAt: "2026-10-15T12:03:00Z",
            },
            repair: {
              previewId: "mismatched-id",
              status: "applied",
              restoredMemoryIds: [],
              skippedMemoryIds: [],
              errors: [],
            },
          },
          knownMemories
        )
      ).toThrow(/reference its preview/)
    })
  })
})
