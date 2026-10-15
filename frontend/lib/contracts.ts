export type IsoDateTime = string

/**
 * Evidence support can be conjunctive (all evidence required)
 * or alternative (any independent evidence sufficient).
 */
export type EvidenceSupport =
  | { mode: "all"; evidenceIds: string[]; justifications?: Array<{ id?: string; inputIds: string[] }> }
  | { mode: "any"; evidenceIds: string[]; justifications?: Array<{ id?: string; inputIds: string[] }> }

export interface Source {
  id: string
  kind?: "document" | "conversation" | "browser" | "system" | "other"
  title: string
  content?: string
  contentHash?: string
  authority?: "reviewed" | "authoritative"
  status?: "active" | "revoked"
  uri?: string
  capturedAt?: IsoDateTime
  createdAt?: IsoDateTime
  metadata?: Record<string, unknown>
}

export interface Evidence {
  id: string
  sourceId: string
  excerpt: string
  contentHash?: string
  capturedAt?: IsoDateTime
  createdAt?: IsoDateTime
  locator?: { start?: number; end?: number; label?: string }
  metadata?: Record<string, unknown>
}

export interface Fact {
  id: string
  subject: string
  predicate: string
  object?: string
  value?: unknown
  evidence: EvidenceSupport
  status?: "active" | "invalidated" | "valid"
  createdAt: IsoDateTime
}

export interface DerivedMemory {
  id: string
  kind:
    | "semantic"
    | "plan"
    | "procedural"
    | "preference"
    | "goal"
    | "decision"
    | "relationship"
    | "summary"
    | "other"
  subject?: string
  predicate?: string
  value?: unknown
  content?: string
  status?: "active" | "unsupported" | "superseded" | "candidate" | "retracted" | "valid" | "stale" | "rewound"
  revision?: number
  evidence: EvidenceSupport
  derivedFromFactIds?: string[]
  createdAt: IsoDateTime
  updatedAt?: IsoDateTime
}

export interface AgentRun {
  id: string
  taskId?: string
  role?: "planner" | "executor"
  mode?: "live" | "scripted"
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "awaiting_approval"
    | "awaiting_input"
    | "interrupted"
    | "restart_required"
  input?: string
  retrievedMemoryIds: string[]
  /** The persistent memories actually supplied in this run's prompt/context. */
  contextMemoryIds?: string[]
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
  error?: string
  receiptVerified?: boolean
}

export interface PaymentPayloadContract {
  supplier_id: string
  invoice_id: string
  amount_minor: number
  currency: string
  routing_token: string
}

export interface ProposedAction {
  id: string
  runId?: string
  kind?: string
  description?: string
  payload?: PaymentPayloadContract | Record<string, unknown>
  payloadHash?: string
  memoryIds: string[]
  dependencies?: string[]
  status:
    | "proposed"
    | "approved"
    | "rejected"
    | "executed"
    | "pending"
    | "stale"
    | "committed"
    | "blocked"
  createdAt?: IsoDateTime
}

export interface RewindPreview {
  id: string
  sourceId?: string
  targetAt?: IsoDateTime
  affectedMemoryIds: string[]
  invalidatedMemoryIds?: string[]
  preservedMemoryIds?: string[]
  staleRunIds?: string[]
  blockedActionIds?: string[]
  proposedActions?: ProposedAction[]
  createdAt?: IsoDateTime
}

export interface RepairResult {
  previewId: string
  repairId?: string
  sourceId?: string
  status: "planned" | "applied" | "failed" | "completed"
  restoredMemoryIds: string[]
  skippedMemoryIds: string[]
  invalidatedMemoryIds?: string[]
  preservedMemoryIds?: string[]
  affectedRunIds?: string[]
  staleActionIds?: string[]
  errors: string[]
  createdAt?: IsoDateTime
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

export function makeEvidenceSupport(
  mode: EvidenceSupport["mode"],
  evidenceIds: readonly string[],
  justifications?: Array<{ id?: string; inputIds: string[] }>
): EvidenceSupport {
  const uniqueIds = [...new Set(evidenceIds)]
  if (uniqueIds.length === 0) throw new Error("Evidence support requires at least one evidence ID")
  return { mode, evidenceIds: uniqueIds, justifications }
}

export function validateEvidenceSupport(support: EvidenceSupport, knownEvidenceIds: ReadonlySet<string>): void {
  if (!support || !Array.isArray(support.evidenceIds) || support.evidenceIds.length === 0) {
    throw new Error("Facts and derived memories require supporting evidence")
  }
  if (new Set(support.evidenceIds).size !== support.evidenceIds.length) {
    throw new Error("Evidence IDs must be unique")
  }
  for (const id of support.evidenceIds) {
    if (!knownEvidenceIds.has(id)) throw new Error(`Supporting evidence does not exist: ${id}`)
  }
}

export function validateMemoryProvenance(
  memory: DerivedMemory,
  knownEvidenceIds: ReadonlySet<string>,
  knownFactIds?: ReadonlySet<string>
): void {
  if (!memory.id?.trim()) throw new Error("Memory id is required")
  const content = memory.content ?? (memory.value !== undefined ? JSON.stringify(memory.value) : "")
  if (!content.trim()) throw new Error("Derived memories require content or value")
  validateEvidenceSupport(memory.evidence, knownEvidenceIds)
  if (knownFactIds && memory.derivedFromFactIds) {
    for (const factId of memory.derivedFromFactIds) {
      if (!knownFactIds.has(factId)) throw new Error(`Derived memory references an unknown fact: ${factId}`)
    }
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
    if (!fact.subject.trim() || !fact.predicate.trim()) throw new Error("Facts require subject and predicate")
    validateEvidenceSupport(fact.evidence, evidenceIds)
  }
  for (const memory of input.memories) {
    validateMemoryProvenance(memory, evidenceIds, factIds)
  }
}

export function validateAgentRun(run: AgentRun, knownMemoryIds: ReadonlySet<string>): void {
  const hasTaskOrInput = Boolean(run.input?.trim() || run.taskId?.trim())
  if (!hasTaskOrInput) throw new Error("Agent run input or taskId is required")
  for (const memoryId of run.retrievedMemoryIds) {
    if (!knownMemoryIds.has(memoryId)) throw new Error(`Run retrieved an unknown memory: ${memoryId}`)
  }
  if (run.status === "completed" && !run.completedAt) throw new Error("Completed runs require completedAt")
  if (run.status === "failed" && !run.error?.trim()) throw new Error("Failed runs require an error")
}

export function validateProposedAction(action: ProposedAction, knownMemoryIds: ReadonlySet<string>): void {
  const hasDescriptionOrPayload = Boolean(action.description?.trim() || action.payload)
  if (!hasDescriptionOrPayload) throw new Error("Proposed action description or payload is required")
  const memoryDeps = action.memoryIds ?? action.dependencies ?? []
  if (new Set(memoryDeps).size !== memoryDeps.length) throw new Error("Action memory dependencies must be unique")
  for (const memoryId of memoryDeps) {
    if (!knownMemoryIds.has(memoryId)) throw new Error(`Action dependency does not exist: ${memoryId}`)
  }
}

export function validateRewindResponse(response: RewindResponse, knownMemoryIds: ReadonlySet<string>): void {
  for (const memoryId of response.preview.affectedMemoryIds) {
    if (!knownMemoryIds.has(memoryId)) throw new Error(`Preview references an unknown memory: ${memoryId}`)
  }
  for (const action of response.preview.proposedActions ?? []) {
    validateProposedAction(action, knownMemoryIds)
  }
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
