import { demoData } from './rewind-demo-data'

type DemoData = { memories: Array<any>; runs: Array<any>; actions: Array<any>; events: Array<any> }

export type RewindPreview = {
  source: string
  invalidatedMemoryIds: string[]
  preservedMemoryIds: string[]
  affectedRunIds: string[]
  affectedActionIds: string[]
}

export function buildRewindPreview(data: DemoData, source: string): RewindPreview {
  const sourceMemories = data.memories.filter((memory) => memory.source === source)
  const invalidatedMemoryIds = sourceMemories.filter((memory) => memory.evidenceMode === 'all' || memory.evidence.every((evidence: any) => evidence.source === source)).map((memory) => memory.id)
  const preservedMemoryIds = sourceMemories.filter((memory) => !invalidatedMemoryIds.includes(memory.id)).map((memory) => memory.id)
  return { source, invalidatedMemoryIds, preservedMemoryIds, affectedRunIds: data.runs.filter((run) => run.retrievedMemoryIds.some((id: string) => invalidatedMemoryIds.includes(id))).map((run) => run.id), affectedActionIds: data.actions.filter((action) => action.memoryIds.some((id: string) => invalidatedMemoryIds.includes(id))).map((action) => action.id) }
}

export function applyRewindSimulation(data: DemoData, preview: RewindPreview): DemoData {
  const invalidated = new Set(preview.invalidatedMemoryIds)
  return { ...data, memories: data.memories.map((memory) => invalidated.has(memory.id) ? { ...memory, status: 'retracted', updated: 'just now' } : memory), actions: data.actions.map((action) => preview.affectedActionIds.includes(action.id) ? { ...action, status: 'blocked' } : action), events: [{ id: `evt_rewind_${Date.now()}`, label: 'Local rewind applied', detail: `${preview.source} · ${preview.invalidatedMemoryIds.length} memories invalidated`, kind: 'rewind' }, ...data.events] }
}
