export type IsoDateTime = string

/** Evidence can be conjunctive (all) or alternative (any). */
export type EvidenceSupport =
  | { mode: "all"; evidenceIds: string[] }
  | { mode: "any"; evidenceIds: string[] }

export interface Source {
  id: string
  kind: "document" | "conversation" | "browser" | "system" | "other"
  title: string
  uri?: string
  capturedAt: IsoDateTime
  metadata?: Record<string, unknown>
}

export interface Evidence {
  id: string
  sourceId: string
  excerpt: string
  capturedAt: IsoDateTime
  locator?: { start?: number; end?: number; label?: string }
  metadata?: Record<string, unknown>
}

export interface Fact {
  id: string
  subject: string
  predicate: string
  object: string
  evidence: EvidenceSupport
  createdAt: IsoDateTime
}

export interface DerivedMemory {
  id: string
  kind: "preference" | "goal" | "decision" | "relationship" | "summary" | "other"
  content: string
  evidence: EvidenceSupport
  derivedFromFactIds?: string[]
  createdAt: IsoDateTime
  updatedAt?: IsoDateTime
}

export interface AgentRun {
  id: string
  status: "queued" | "running" | "completed" | "failed"
  input: string
  retrievedMemoryIds: string[]
  /** The persistent memories actually supplied in this run's prompt/context. */
  contextMemoryIds?: string[]
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
  error?: string
}

export interface ProposedAction {
  id: string
  kind: string
  description: string
  memoryIds: string[]
  status: "proposed" | "approved" | "rejected" | "executed"
}

export interface RewindPreview {
  id: string
  targetAt: IsoDateTime
  affectedMemoryIds: string[]
  proposedActions: ProposedAction[]
  createdAt: IsoDateTime
}

export interface RepairResult {
  previewId: string
  status: "planned" | "applied" | "failed"
  restoredMemoryIds: string[]
  skippedMemoryIds: string[]
  errors: string[]
}

export interface MemoryResponse {
  sources: Source[]
  evidence: Evidence[]
  facts: Fact[]
  memories: DerivedMemory[]
}

export interface AgentRunResponse {
  run: AgentRun
  memories: DerivedMemory[]
}

export interface RewindResponse {
  preview: RewindPreview
  repair?: RepairResult
}

export const CONTRACT_VERSION = "rewind.contracts.v1"
export type ContractEnvelope<T> = { contractVersion: typeof CONTRACT_VERSION; data: T }

export function makeEvidenceSupport(mode: EvidenceSupport["mode"], evidenceIds: readonly string[]): EvidenceSupport {
  const uniqueIds = [...new Set(evidenceIds)]
  if (uniqueIds.length === 0) throw new Error("Evidence support requires at least one evidence ID")
  return { mode, evidenceIds: uniqueIds }
}

export function validateEvidenceSupport(support: EvidenceSupport, knownEvidenceIds: ReadonlySet<string>): void {
  if (support.evidenceIds.length === 0) throw new Error("Facts and derived memories require supporting evidence")
  if (new Set(support.evidenceIds).size !== support.evidenceIds.length) throw new Error("Evidence IDs must be unique")
  for (const id of support.evidenceIds) {
    if (!knownEvidenceIds.has(id)) throw new Error(`Supporting evidence does not exist: ${id}`)
  }
}

export function validateContractGraph(input: MemoryResponse): void {
  const sourceIds = new Set(input.sources.map((source) => source.id))
  const evidenceIds = new Set(input.evidence.map((item) => item.id))
  const factIds = new Set(input.facts.map((fact) => fact.id))

  for (const source of input.sources) {
    if (!source.id.trim() || !source.title.trim()) throw new Error("Sources require id and title")
  }
  for (const item of input.evidence) {
    if (!item.id.trim() || !item.excerpt.trim()) throw new Error("Evidence requires id and excerpt")
    if (!sourceIds.has(item.sourceId)) throw new Error(`Evidence references an unknown source: ${item.sourceId}`)
  }
  for (const fact of input.facts) {
    if (!fact.subject.trim() || !fact.predicate.trim() || !fact.object.trim()) throw new Error("Facts require subject, predicate, and object")
    validateEvidenceSupport(fact.evidence, evidenceIds)
  }
  for (const memory of input.memories) {
    if (!memory.id.trim() || !memory.content.trim()) throw new Error("Derived memories require id and content")
    validateEvidenceSupport(memory.evidence, evidenceIds)
    for (const factId of memory.derivedFromFactIds ?? []) {
      if (!factIds.has(factId)) throw new Error(`Derived memory references an unknown fact: ${factId}`)
    }
  }
}

export function validateAgentRun(run: AgentRun, knownMemoryIds: ReadonlySet<string>): void {
  if (!run.input.trim()) throw new Error("Agent run input is required")
  for (const memoryId of run.retrievedMemoryIds) {
    if (!knownMemoryIds.has(memoryId)) throw new Error(`Run retrieved an unknown memory: ${memoryId}`)
  }
  if (run.status === "completed" && !run.completedAt) throw new Error("Completed runs require completedAt")
  if (run.status === "failed" && !run.error?.trim()) throw new Error("Failed runs require an error")
}

export function validateProposedAction(action: ProposedAction, knownMemoryIds: ReadonlySet<string>): void {
  if (!action.description.trim()) throw new Error("Proposed action description is required")
  if (new Set(action.memoryIds).size !== action.memoryIds.length) throw new Error("Action memory dependencies must be unique")
  for (const memoryId of action.memoryIds) {
    if (!knownMemoryIds.has(memoryId)) throw new Error(`Action dependency does not exist: ${memoryId}`)
  }
}

export function validateRewindResponse(response: RewindResponse, knownMemoryIds: ReadonlySet<string>): void {
  for (const memoryId of response.preview.affectedMemoryIds) {
    if (!knownMemoryIds.has(memoryId)) throw new Error(`Preview references an unknown memory: ${memoryId}`)
  }
  for (const action of response.preview.proposedActions) validateProposedAction(action, knownMemoryIds)
  if (response.repair) {
    if (response.repair.previewId !== response.preview.id) throw new Error("Repair result must reference its preview")
    const restored = new Set(response.repair.restoredMemoryIds)
    for (const memoryId of response.repair.skippedMemoryIds) {
      if (restored.has(memoryId)) throw new Error("A memory cannot be both restored and skipped")
      if (!knownMemoryIds.has(memoryId)) throw new Error(`Repair references an unknown memory: ${memoryId}`)
    }
  }
}

export function envelope<T>(data: T): ContractEnvelope<T> {
  return { contractVersion: CONTRACT_VERSION, data }
}

export function assertContractVersion(value: { contractVersion: string }): void {
  if (value.contractVersion !== CONTRACT_VERSION) throw new Error(`Unsupported contract version: ${value.contractVersion}`)
}
