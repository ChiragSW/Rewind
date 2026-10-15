/**
 * Rewind Repair Engine
 *
 * A deterministic, LLM-free engine that propagates source revocation or
 * correction through dependent memories, runs, and proposed actions.
 *
 * Design rules (exhaustive; must match test expectations):
 *
 * Evidence evaluation
 * -------------------
 * AND (mode === 'all'):
 *   A memory is INVALID if ANY of its evidence items come from a revoked source.
 *   Rationale: all evidence is required; losing one breaks the conjunction.
 *
 * OR (mode === 'any'):
 *   A memory is INVALID only if ALL of its evidence items come from revoked
 *   sources (no independent alternative remains).
 *   Rationale: at least one valid independent source is sufficient.
 *
 * Multi-hop propagation (BFS)
 * ---------------------------
 * After direct evaluation, any memory whose derivedFromMemoryIds contains a
 * newly-invalidated memory is enqueued for re-evaluation.  Re-evaluation uses
 * the same AND / OR rules, treating the upstream memory as a "virtual evidence
 * item" whose source is considered revoked when the upstream is invalidated.
 * BFS continues until the frontier is empty.
 *
 * Cycle detection
 * ---------------
 * A visited set tracks every memory ID processed during BFS.  If a memory is
 * encountered a second time it is skipped (marked 'cyclic_dependency').  This
 * prevents infinite loops in graphs with dependency cycles.
 *
 * Correction vs revocation
 * ------------------------
 * Revocation: revokedSourceId is added to the revoked set; all downstream
 *   memories that depended ONLY on that source are invalidated.
 * Correction: in addition to revoking the old source, a correctionMemoryId is
 *   supplied.  Any memory that listed the old invalidated memory in
 *   derivedFromMemoryIds AND also lists the correction memory is preserved
 *   (the correction provides the replacement support).  The corrected memory
 *   itself is NOT automatically preserved unless its own evidence still holds.
 *
 * Repeated repairs (idempotency)
 * ------------------------------
 * Already-invalidated memories (status !== 'active'/'valid') are still
 * traversed for downstream propagation but are never double-counted in
 * invalidatedIds (they appear in preservedIds only if their evidence is
 * independently sufficient).  Calling the engine twice with the same
 * revokedSourceId produces the same RepairResult.
 *
 * Unrelated memories
 * ------------------
 * Memories with no evidence from the revoked source and no upstream
 * dependency on an invalidated memory are never touched.
 */

export type EvidenceItem = {
  id: string
  sourceId: string
  /** 'active' = source is still valid; 'revoked' = source has been revoked */
  sourceStatus: 'active' | 'revoked'
}

export type MemoryNode = {
  id: string
  /** Current status in the store before this repair pass. */
  status: string
  evidence: EvidenceItem[]
  evidenceMode: 'all' | 'any'
  /** IDs of other MemoryNodes this memory was derived from (for multi-hop). */
  derivedFromMemoryIds?: string[]
}

export type RunNode = {
  id: string
  retrievedMemoryIds: string[]
}

export type ActionNode = {
  id: string
  memoryIds: string[]
  status: string
}

export type AuditEntry = {
  memoryId: string
  decision: 'invalidated' | 'preserved' | 'already_invalid' | 'cyclic_dependency'
  reason: string
}

export type RepairInput = {
  memories: MemoryNode[]
  runs: RunNode[]
  actions: ActionNode[]
  /** The source being revoked. */
  revokedSourceId: string
  /**
   * If this repair is a correction (not just a revocation), supply the new
   * memory ID that supersedes invalidated ones.  Memories that list this ID
   * in derivedFromMemoryIds retain support via the correction.
   */
  correctionMemoryId?: string
}

export type RepairResult = {
  revokedSourceId: string
  correctionMemoryId?: string
  invalidatedIds: string[]
  preservedIds: string[]
  affectedRunIds: string[]
  staleActionIds: string[]
  auditRecords: AuditEntry[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** True when all evidence items come from revoked sources (AND semantics: any revoked → invalid). */
function isInvalidByEvidence(
  evidence: EvidenceItem[],
  mode: 'all' | 'any',
  revokedSourceIds: ReadonlySet<string>,
): boolean {
  if (evidence.length === 0) return false
  if (mode === 'all') {
    // AND: invalid if any evidence source is revoked
    return evidence.some((e) => revokedSourceIds.has(e.sourceId) || e.sourceStatus === 'revoked')
  } else {
    // OR: invalid only if ALL evidence sources are revoked
    return evidence.every((e) => revokedSourceIds.has(e.sourceId) || e.sourceStatus === 'revoked')
  }
}

/**
 * Build a map from memoryId → array of memory IDs that list it as upstream.
 * Used for efficient BFS downstream traversal.
 */
function buildDownstreamIndex(memories: MemoryNode[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const mem of memories) {
    for (const upstreamId of mem.derivedFromMemoryIds ?? []) {
      if (!index.has(upstreamId)) index.set(upstreamId, [])
      index.get(upstreamId)!.push(mem.id)
    }
  }
  return index
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the repair engine over the provided graph snapshot.
 *
 * The function is pure — it does not mutate the input and does not call any
 * external service or LLM.  Results must be applied to the store by the caller.
 */
export function runRepairEngine(input: RepairInput): RepairResult {
  const { memories, runs, actions, revokedSourceId, correctionMemoryId } = input

  // Index memories for O(1) lookup
  const memoryMap = new Map<string, MemoryNode>(memories.map((m) => [m.id, m]))

  // The set of sources considered revoked for this repair pass
  const revokedSourceIds = new Set<string>([revokedSourceId])

  // Track newly-invalidated memory IDs so downstream BFS can use them
  const invalidatedIds = new Set<string>()
  const preservedIds = new Set<string>()
  const auditRecords: AuditEntry[] = []

  // Visited set for tracking processed memories
  const visited = new Set<string>()

  // Ancestor sets for cycle detection: memoryId -> Set of ancestor IDs in dependency chain
  const ancestors = new Map<string, Set<string>>()

  // downstream adjacency: upstreamId → [downstreamId, ...]
  const downstream = buildDownstreamIndex(memories)

  // -------------------------------------------------------------------------
  // Phase 1: Identify directly affected memories (evidence touches revoked src)
  // -------------------------------------------------------------------------
  const directlyAffected = memories.filter((mem) =>
    mem.evidence.some((e) => e.sourceId === revokedSourceId || e.sourceStatus === 'revoked'),
  )

  for (const mem of directlyAffected) {
    ancestors.set(mem.id, new Set([mem.id]))
  }

  // BFS queue: start with directly affected memories
  const queue: MemoryNode[] = [...directlyAffected]

  // -------------------------------------------------------------------------
  // Phase 2: BFS — evaluate each affected memory and propagate downstream
  // -------------------------------------------------------------------------
  while (queue.length > 0) {
    const mem = queue.shift()!

    if (visited.has(mem.id)) {
      continue
    }
    visited.add(mem.id)

    // Determine whether this memory loses support
    // For multi-hop: treat invalidated upstream memories as "revoked source"
    const upstreamIds = mem.derivedFromMemoryIds ?? []
    const hasInvalidatedUpstream = upstreamIds.some((upId) => invalidatedIds.has(upId))

    // Build effective evidence list: augment with a virtual item per invalidated upstream
    const effectiveEvidence: EvidenceItem[] = [
      ...mem.evidence,
      ...upstreamIds
        .filter((upId) => invalidatedIds.has(upId))
        .map((upId): EvidenceItem => ({ id: `virtual:${upId}`, sourceId: upId, sourceStatus: 'revoked' })),
    ]

    // If this is a correction: a correctionMemoryId listed as upstream keeps support
    const hasCorrection =
      correctionMemoryId != null && upstreamIds.includes(correctionMemoryId)

    const shouldInvalidate =
      !hasCorrection &&
      (isInvalidByEvidence(effectiveEvidence, mem.evidenceMode, revokedSourceIds) || hasInvalidatedUpstream && mem.evidenceMode === 'all')

    if (shouldInvalidate) {
      invalidatedIds.add(mem.id)
      const reason =
        mem.evidenceMode === 'all'
          ? `AND-evidence: at least one supporting source (${revokedSourceId}) has been revoked or upstream memory invalidated.`
          : `OR-evidence: all supporting sources have been revoked (no independent alternative remains).`
      auditRecords.push({ memoryId: mem.id, decision: mem.status !== 'active' && mem.status !== 'valid' ? 'already_invalid' : 'invalidated', reason })

      // Enqueue downstream memories for propagation
      const currentAncestors = ancestors.get(mem.id) ?? new Set([mem.id])
      for (const downstreamId of downstream.get(mem.id) ?? []) {
        const downstreamMem = memoryMap.get(downstreamId)
        if (!downstreamMem) continue

        if (currentAncestors.has(downstreamId)) {
          // Cycle detected: downstreamId is already in the ancestral path
          auditRecords.push({
            memoryId: downstreamId,
            decision: 'cyclic_dependency',
            reason: `Dependency cycle detected involving ${downstreamId}; skipping to prevent infinite loop.`,
          })
          continue
        }

        const nextAncestors = new Set(currentAncestors)
        nextAncestors.add(downstreamId)
        ancestors.set(downstreamId, nextAncestors)

        if (!visited.has(downstreamId)) {
          queue.push(downstreamMem)
        }
      }
    } else {
      preservedIds.add(mem.id)
      const reason = hasCorrection
        ? `Correction memory (${correctionMemoryId}) provides replacement support.`
        : mem.evidenceMode === 'any'
          ? `OR-evidence: at least one independent evidence source remains active.`
          : `AND-evidence: all supporting sources remain active.`
      auditRecords.push({ memoryId: mem.id, decision: 'preserved', reason })
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3: Identify affected runs and stale actions
  // -------------------------------------------------------------------------
  const affectedRunIds = runs
    .filter((run) => run.retrievedMemoryIds.some((id) => invalidatedIds.has(id)))
    .map((run) => run.id)

  const staleActionIds = actions
    .filter(
      (action) =>
        action.status !== 'executed' &&
        action.status !== 'completed' &&
        action.memoryIds.some((id) => invalidatedIds.has(id)),
    )
    .map((action) => action.id)

  return {
    revokedSourceId,
    correctionMemoryId,
    invalidatedIds: [...invalidatedIds],
    preservedIds: [...preservedIds],
    affectedRunIds,
    staleActionIds,
    auditRecords,
  }
}
