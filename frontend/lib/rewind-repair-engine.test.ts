import { describe, it, expect } from 'vitest'
import { runRepairEngine, type MemoryNode, type RunNode, type ActionNode, type RepairInput } from './rewind-repair-engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(
  id: string,
  evidenceSources: Array<{ id: string; sourceId: string; sourceStatus?: 'active' | 'revoked' }>,
  mode: 'all' | 'any' = 'all',
  derivedFromMemoryIds: string[] = [],
  status = 'valid',
): MemoryNode {
  return {
    id,
    status,
    evidenceMode: mode,
    evidence: evidenceSources.map(({ id: evId, sourceId, sourceStatus = 'active' }) => ({
      id: evId,
      sourceId,
      sourceStatus,
    })),
    derivedFromMemoryIds,
  }
}

function makeRun(id: string, retrievedMemoryIds: string[]): RunNode {
  return { id, retrievedMemoryIds }
}

function makeAction(id: string, memoryIds: string[], status = 'pending'): ActionNode {
  return { id, memoryIds, status }
}

function repair(input: Partial<RepairInput> & { revokedSourceId: string }): ReturnType<typeof runRepairEngine> {
  return runRepairEngine({
    memories: [],
    runs: [],
    actions: [],
    ...input,
  })
}

// ---------------------------------------------------------------------------
// AND evidence (mode === 'all')
// ---------------------------------------------------------------------------

describe('AND evidence (mode === all)', () => {
  it('invalidates memory when ANY evidence source is revoked', () => {
    const mem = makeMemory('mem_a', [
      { id: 'ev1', sourceId: 'src_bad' },
      { id: 'ev2', sourceId: 'src_ok' },
    ], 'all')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    expect(result.invalidatedIds).toContain('mem_a')
    expect(result.preservedIds).not.toContain('mem_a')
  })

  it('preserves memory when no evidence source is revoked', () => {
    const mem = makeMemory('mem_b', [
      { id: 'ev1', sourceId: 'src_ok' },
      { id: 'ev2', sourceId: 'src_also_ok' },
    ], 'all')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    expect(result.preservedIds).not.toContain('mem_b')
    expect(result.invalidatedIds).not.toContain('mem_b')
  })

  it('invalidates even when only one of many evidence items is from revoked source', () => {
    const mem = makeMemory('mem_c', [
      { id: 'ev1', sourceId: 'src_ok1' },
      { id: 'ev2', sourceId: 'src_ok2' },
      { id: 'ev3', sourceId: 'src_bad' },
    ], 'all')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    expect(result.invalidatedIds).toContain('mem_c')
  })
})

// ---------------------------------------------------------------------------
// OR evidence (mode === 'any')
// ---------------------------------------------------------------------------

describe('OR evidence (mode === any)', () => {
  it('preserves memory when at least one alternative source remains active', () => {
    const mem = makeMemory('mem_d', [
      { id: 'ev1', sourceId: 'src_bad' },
      { id: 'ev2', sourceId: 'src_ok' },
    ], 'any')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    expect(result.preservedIds).toContain('mem_d')
    expect(result.invalidatedIds).not.toContain('mem_d')
  })

  it('invalidates memory when ALL evidence sources are revoked', () => {
    const mem = makeMemory('mem_e', [
      { id: 'ev1', sourceId: 'src_bad' },
      { id: 'ev2', sourceId: 'src_bad' },
    ], 'any')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    expect(result.invalidatedIds).toContain('mem_e')
    expect(result.preservedIds).not.toContain('mem_e')
  })

  it('preserves memory with multiple sources when only one is revoked', () => {
    const mem = makeMemory('mem_f', [
      { id: 'ev1', sourceId: 'src_bad' },
      { id: 'ev2', sourceId: 'src_ok1' },
      { id: 'ev3', sourceId: 'src_ok2' },
    ], 'any')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    expect(result.preservedIds).toContain('mem_f')
  })

  it('respects pre-revoked evidence status flag', () => {
    // ev2 was already marked revoked in the store before this repair pass
    const mem = makeMemory('mem_g', [
      { id: 'ev1', sourceId: 'src_bad' },
      { id: 'ev2', sourceId: 'src_other', sourceStatus: 'revoked' },
    ], 'any')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    // Both items are considered revoked → memory has no independent support
    expect(result.invalidatedIds).toContain('mem_g')
  })
})

// ---------------------------------------------------------------------------
// Multi-hop propagation
// ---------------------------------------------------------------------------

describe('Multi-hop propagation', () => {
  it('invalidates a downstream memory when its upstream is invalidated (2-hop)', () => {
    // mem_A (AND) ← src_bad  →  mem_B (AND) ← mem_A
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const memB = makeMemory('mem_B', [{ id: 'ev2', sourceId: 'src_ok' }], 'all', ['mem_A'])

    const result = repair({ memories: [memA, memB], revokedSourceId: 'src_bad' })

    expect(result.invalidatedIds).toContain('mem_A')
    // mem_B has valid evidence itself BUT its upstream (mem_A) is invalidated
    // AND mode: upstream invalidation counts as a revoked input
    expect(result.invalidatedIds).toContain('mem_B')
  })

  it('does not invalidate downstream when upstream is preserved (OR with alternative)', () => {
    // mem_A (OR, has alternative) → preserved  →  mem_B should not be invalidated
    const memA = makeMemory('mem_A', [
      { id: 'ev1', sourceId: 'src_bad' },
      { id: 'ev2', sourceId: 'src_ok' },
    ], 'any')
    const memB = makeMemory('mem_B', [{ id: 'ev3', sourceId: 'src_ok' }], 'all', ['mem_A'])

    const result = repair({ memories: [memA, memB], revokedSourceId: 'src_bad' })

    expect(result.preservedIds).toContain('mem_A')
    expect(result.invalidatedIds).not.toContain('mem_B')
  })

  it('propagates 3 hops deep', () => {
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const memB = makeMemory('mem_B', [{ id: 'ev2', sourceId: 'src_ok' }], 'all', ['mem_A'])
    const memC = makeMemory('mem_C', [{ id: 'ev3', sourceId: 'src_ok' }], 'all', ['mem_B'])

    const result = repair({ memories: [memA, memB, memC], revokedSourceId: 'src_bad' })

    expect(result.invalidatedIds).toContain('mem_A')
    expect(result.invalidatedIds).toContain('mem_B')
    expect(result.invalidatedIds).toContain('mem_C')
  })

  it('preserves downstream when upstream is invalidated but downstream uses OR with independent source', () => {
    // mem_A invalidated → mem_B (OR) has another evidence source → preserved
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const memB = makeMemory('mem_B', [
      { id: 'ev2', sourceId: 'src_ok' },  // independent active source
    ], 'any', ['mem_A'])

    const result = repair({ memories: [memA, memB], revokedSourceId: 'src_bad' })

    expect(result.invalidatedIds).toContain('mem_A')
    // mem_B is enqueued but has independent evidence via OR mode
    // Virtual "revoked" upstream is added, but ev2 is still active → preserved
    expect(result.preservedIds).toContain('mem_B')
  })
})

// ---------------------------------------------------------------------------
// Unrelated memories
// ---------------------------------------------------------------------------

describe('Unrelated memories', () => {
  it('does not touch memories with no connection to the revoked source', () => {
    const related = makeMemory('mem_related', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const unrelated = makeMemory('mem_unrelated', [{ id: 'ev2', sourceId: 'src_ok' }], 'all')

    const result = repair({ memories: [related, unrelated], revokedSourceId: 'src_bad' })

    expect(result.invalidatedIds).toContain('mem_related')
    expect(result.invalidatedIds).not.toContain('mem_unrelated')
    expect(result.preservedIds).not.toContain('mem_unrelated')
  })

  it('does not flag unrelated runs', () => {
    const mem = makeMemory('mem_bad', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const affectedRun = makeRun('run_1', ['mem_bad'])
    const unrelatedRun = makeRun('run_2', ['mem_unrelated'])

    const result = repair({
      memories: [mem],
      runs: [affectedRun, unrelatedRun],
      revokedSourceId: 'src_bad',
    })

    expect(result.affectedRunIds).toContain('run_1')
    expect(result.affectedRunIds).not.toContain('run_2')
  })

  it('does not flag already-executed actions', () => {
    const mem = makeMemory('mem_bad', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const executed = makeAction('action_exec', ['mem_bad'], 'executed')
    const pending = makeAction('action_pending', ['mem_bad'], 'pending')

    const result = repair({
      memories: [mem],
      actions: [executed, pending],
      revokedSourceId: 'src_bad',
    })

    expect(result.staleActionIds).toContain('action_pending')
    expect(result.staleActionIds).not.toContain('action_exec')
  })
})

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

describe('Cycle detection', () => {
  it('handles A → B → A dependency cycle without infinite loop', () => {
    // A derives from B, B derives from A — mutual dependency
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all', ['mem_B'])
    const memB = makeMemory('mem_B', [{ id: 'ev2', sourceId: 'src_ok' }], 'all', ['mem_A'])

    // Should complete without hanging; result shape is what matters
    expect(() => repair({ memories: [memA, memB], revokedSourceId: 'src_bad' })).not.toThrow()

    const result = repair({ memories: [memA, memB], revokedSourceId: 'src_bad' })
    // mem_A is directly affected (src_bad evidence) → invalidated
    expect(result.invalidatedIds).toContain('mem_A')
    // Audit records should mention a cyclic_dependency for the revisited node
    const cyclicEntry = result.auditRecords.find((r) => r.decision === 'cyclic_dependency')
    expect(cyclicEntry).toBeDefined()
  })

  it('handles self-referential dependency (A → A) without infinite loop', () => {
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all', ['mem_A'])

    expect(() => repair({ memories: [memA], revokedSourceId: 'src_bad' })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Repeated repairs (idempotency)
// ---------------------------------------------------------------------------

describe('Idempotency — repeated repairs', () => {
  it('produces the same result when run twice with the same revokedSourceId', () => {
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const memB = makeMemory('mem_B', [{ id: 'ev2', sourceId: 'src_ok' }], 'any', ['mem_A'])

    const input: RepairInput = { memories: [memA, memB], runs: [], actions: [], revokedSourceId: 'src_bad' }
    const first = runRepairEngine(input)
    const second = runRepairEngine(input)

    expect(first.invalidatedIds.sort()).toEqual(second.invalidatedIds.sort())
    expect(first.preservedIds.sort()).toEqual(second.preservedIds.sort())
    expect(first.affectedRunIds.sort()).toEqual(second.affectedRunIds.sort())
    expect(first.staleActionIds.sort()).toEqual(second.staleActionIds.sort())
  })

  it('does not add a memory to invalidatedIds twice when it appears in multiple evidence chains', () => {
    // mem_A has two evidence items both from src_bad
    const memA = makeMemory('mem_A', [
      { id: 'ev1', sourceId: 'src_bad' },
      { id: 'ev2', sourceId: 'src_bad' },
    ], 'all')

    const result = repair({ memories: [memA], revokedSourceId: 'src_bad' })

    const occurrences = result.invalidatedIds.filter((id) => id === 'mem_A').length
    expect(occurrences).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Correction vs revocation
// ---------------------------------------------------------------------------

describe('Correction vs revocation', () => {
  it('revocation: no correctionMemoryId → downstream memory loses support', () => {
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const memB = makeMemory('mem_B', [{ id: 'ev2', sourceId: 'src_ok' }], 'all', ['mem_A'])

    const result = repair({ memories: [memA, memB], revokedSourceId: 'src_bad' })

    expect(result.invalidatedIds).toContain('mem_A')
    expect(result.invalidatedIds).toContain('mem_B')
  })

  it('correction: downstream that references correctionMemoryId is preserved', () => {
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    // mem_C is the new memory introduced by the correction
    const memC = makeMemory('mem_C', [{ id: 'ev3', sourceId: 'src_new' }], 'all')
    // mem_B was derived from mem_A but is now also derived from the correction (mem_C)
    const memB = makeMemory('mem_B', [{ id: 'ev2', sourceId: 'src_ok' }], 'all', ['mem_A', 'mem_C'])

    const result = runRepairEngine({
      memories: [memA, memC, memB],
      runs: [],
      actions: [],
      revokedSourceId: 'src_bad',
      correctionMemoryId: 'mem_C',
    })

    expect(result.invalidatedIds).toContain('mem_A')
    // mem_B lists mem_C (correctionMemoryId) as upstream → preserved
    expect(result.preservedIds).toContain('mem_B')
    expect(result.invalidatedIds).not.toContain('mem_B')
  })

  it('correction: memory without correctionMemoryId in upstream is still invalidated', () => {
    const memA = makeMemory('mem_A', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const memC = makeMemory('mem_C', [{ id: 'ev3', sourceId: 'src_new' }], 'all')
    // mem_D does NOT reference mem_C → cannot benefit from correction
    const memD = makeMemory('mem_D', [{ id: 'ev4', sourceId: 'src_ok' }], 'all', ['mem_A'])

    const result = runRepairEngine({
      memories: [memA, memC, memD],
      runs: [],
      actions: [],
      revokedSourceId: 'src_bad',
      correctionMemoryId: 'mem_C',
    })

    expect(result.invalidatedIds).toContain('mem_A')
    expect(result.invalidatedIds).toContain('mem_D')
  })
})

// ---------------------------------------------------------------------------
// Runs and actions
// ---------------------------------------------------------------------------

describe('Affected runs and stale actions', () => {
  it('flags runs that retrieved an invalidated memory', () => {
    const mem = makeMemory('mem_bad', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const run = makeRun('run_1', ['mem_bad', 'mem_ok'])

    const result = repair({ memories: [mem], runs: [run], revokedSourceId: 'src_bad' })

    expect(result.affectedRunIds).toContain('run_1')
  })

  it('flags pending actions whose memory dependencies are invalidated', () => {
    const mem = makeMemory('mem_bad', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const action = makeAction('action_1', ['mem_bad'])

    const result = repair({ memories: [mem], actions: [action], revokedSourceId: 'src_bad' })

    expect(result.staleActionIds).toContain('action_1')
  })

  it('does not flag completed actions', () => {
    const mem = makeMemory('mem_bad', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const action = makeAction('action_completed', ['mem_bad'], 'completed')

    const result = repair({ memories: [mem], actions: [action], revokedSourceId: 'src_bad' })

    expect(result.staleActionIds).not.toContain('action_completed')
  })

  it('handles empty runs and actions without error', () => {
    const mem = makeMemory('mem_bad', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    expect(result.affectedRunIds).toEqual([])
    expect(result.staleActionIds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

describe('Audit records', () => {
  it('produces an audit entry for every evaluated memory', () => {
    const mem1 = makeMemory('mem_1', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')
    const mem2 = makeMemory('mem_2', [{ id: 'ev2', sourceId: 'src_ok' }], 'any')

    const result = repair({ memories: [mem1, mem2], revokedSourceId: 'src_bad' })

    // mem_2 has no evidence from src_bad and no upstream → never added to queue → no audit entry
    const ids = result.auditRecords.map((r) => r.memoryId)
    expect(ids).toContain('mem_1')
    // mem_2 was unrelated, so no audit entry for it
    expect(ids).not.toContain('mem_2')
  })

  it('audit entry for invalidated memory has decision "invalidated"', () => {
    const mem = makeMemory('mem_1', [{ id: 'ev1', sourceId: 'src_bad' }], 'all')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    const entry = result.auditRecords.find((r) => r.memoryId === 'mem_1')
    expect(entry?.decision).toBe('invalidated')
    expect(entry?.reason).toBeTruthy()
  })

  it('audit entry for preserved OR-memory has decision "preserved"', () => {
    const mem = makeMemory('mem_1', [
      { id: 'ev1', sourceId: 'src_bad' },
      { id: 'ev2', sourceId: 'src_ok' },
    ], 'any')

    const result = repair({ memories: [mem], revokedSourceId: 'src_bad' })

    const entry = result.auditRecords.find((r) => r.memoryId === 'mem_1')
    expect(entry?.decision).toBe('preserved')
  })
})
