import { demoData, type DemoAction, type DemoEvent, type DemoMemory, type DemoRun } from './rewind-demo-data'

export type RewindState = { memories: DemoMemory[]; runs: DemoRun[]; actions: DemoAction[]; events: DemoEvent[]; sources: string[] }
export const seedState = (): RewindState => structuredClone(demoData) as unknown as RewindState
export const validEvidence = (memory: RewindState['memories'][number], revoked: string) => memory.evidence.filter((evidence) => evidence.source !== revoked && evidence.status === 'valid')
export const previewRewind = (state: RewindState, source: string) => {
  const affected = state.memories.filter((memory) => memory.evidence.some((evidence) => evidence.source === source))
  const invalidated = affected.filter((memory) => memory.evidenceMode === 'all' ? validEvidence(memory, source).length < memory.evidence.length : validEvidence(memory, source).length === 0)
  const preserved = affected.filter((memory) => !invalidated.includes(memory))
  const staleRunIds = state.runs.filter((run) => run.retrievedMemoryIds.some((id) => invalidated.some((memory) => memory.id === id))).map((run) => run.id)
  const blockedActionIds = state.actions.filter((action) => action.memoryIds.some((id) => invalidated.some((memory) => memory.id === id))).map((action) => action.id)
  return { source, affected, invalidated, preserved, staleRunIds, blockedActionIds }
}
export const applyRewind = (state: RewindState, source: string) => {
  const impact = previewRewind(state, source)
  const invalidIds = new Set(impact.invalidated.map((memory) => memory.id))
  return { ...state, memories: state.memories.map((memory) => invalidIds.has(memory.id) ? { ...memory, status: 'retracted' as const, evidence: memory.evidence.map((evidence) => evidence.source === source ? { ...evidence, status: 'revoked' as const } : evidence) } : memory), runs: state.runs.map((run) => impact.staleRunIds.includes(run.id) ? { ...run, status: 'completed' as const } : run), actions: state.actions.map((action) => impact.blockedActionIds.includes(action.id) ? { ...action, status: 'blocked' as const } : action), events: [...state.events, { id: `evt_rewind_${Date.now()}`, label: 'Rewind confirmed', detail: `${source} · ${impact.invalidated.length} invalidated · ${impact.preserved.length} preserved`, kind: 'repair' as const }] }
}
export const validateAction = (state: RewindState, actionId: string) => { const action = state.actions.find((item) => item.id === actionId); if (!action) return { ok: false, reason: 'Action not found.' }; const invalid = action.memoryIds.map((id) => state.memories.find((memory) => memory.id === id)).find((memory) => memory && memory.status !== 'valid'); return invalid ? { ok: false, reason: `Blocked by ${invalid.id}: ${invalid.title} is not valid.` } : { ok: true, reason: 'All required memories are valid.' } }
export const recordEvent = (state: RewindState, label: string, detail: string, kind: RewindState['events'][number]['kind']): RewindState => ({ ...state, events: [...state.events, { id: `evt_${Date.now()}`, label, detail, kind }] })
