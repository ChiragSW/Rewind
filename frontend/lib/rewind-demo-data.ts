export type DemoEvidence = {
  id: string
  label: string
  source: string
  status: 'valid' | 'revoked' | 'outdated'
}

export type DemoMemory = {
  id: string
  title: string
  content: string
  status: 'valid' | 'stale' | 'conflicted' | 'retracted' | 'superseded'
  source: string
  updated: string
  evidence: DemoEvidence[]
  evidenceMode: 'all' | 'any'
}

export type DemoAction = { id: string; title: string; status: 'pending' | 'blocked' | 'completed'; memoryIds: string[] }
export type DemoRun = { id: string; agent: string; status: 'active' | 'completed'; retrievedMemoryIds: string[]; started: string }
export type DemoEvent = { id: string; label: string; detail: string; kind: 'memory' | 'rewind' | 'repair' }

export const demoData = {
  sources: ['github://acme/rewind', 'slack://engineering', 'notion://runbooks', 'linear://REW-42'],
  memories: [
    { id: 'mem_7f2a91', title: 'FalkorDB connection uses graph memory', content: 'Persistent memory and evidence lineage are stored in FalkorDB.', status: 'valid', source: 'github://acme/rewind', updated: '12 min ago', evidenceMode: 'any', evidence: [{ id: 'ev_commit_42', label: 'README excerpt · commit 7f2a91', source: 'github://acme/rewind', status: 'valid' }, { id: 'ev_arch_3', label: 'Graph adapter test · commit 6ce118', source: 'github://acme/rewind', status: 'valid' }] },
    { id: 'mem_34c8d0', title: 'Redis cache is the source of truth', content: 'The Redis cache is the canonical source for agent memory.', status: 'valid', source: 'slack://engineering', updated: '18 min ago', evidenceMode: 'any', evidence: [{ id: 'ev_slack_1', label: 'Message 18:04', source: 'slack://engineering', status: 'valid' }, { id: 'ev_commit_42', label: 'Repository architecture note', source: 'github://acme/rewind', status: 'valid' }] },
    { id: 'mem_a81e22', title: 'Deployments require a manual approval', content: 'Production deployments require a maintainer approval step.', status: 'stale', source: 'github://acme/rewind', updated: '3 days ago', evidenceMode: 'all', evidence: [{ id: 'ev_commit_old', label: 'Deployment docs · commit 2a91c0', source: 'github://acme/rewind', status: 'outdated' }] },
    { id: 'mem_09d17b', title: 'Team uses TypeScript strict mode', content: 'The repository compiles with TypeScript strict mode enabled.', status: 'valid', source: 'github://acme/rewind', updated: '5 days ago', evidenceMode: 'all', evidence: [{ id: 'ev_tsconfig', label: 'tsconfig.json · commit 09d17b', source: 'github://acme/rewind', status: 'valid' }] },
    { id: 'mem_2b6e44', title: 'Legacy agent prompt v2 is deprecated', content: 'Prompt version 2 must not be used for new agent runs.', status: 'retracted', source: 'notion://runbooks', updated: '8 days ago', evidenceMode: 'all', evidence: [{ id: 'ev_runbook_2', label: 'Runbook revision', source: 'notion://runbooks', status: 'revoked' }] },
  ] satisfies DemoMemory[],
  runs: [
    { id: 'agent-run_0184', agent: 'Planner', status: 'active', retrievedMemoryIds: ['mem_7f2a91', 'mem_a81e22'], started: '12 min ago' },
    { id: 'agent-run_0181', agent: 'Researcher', status: 'completed', retrievedMemoryIds: ['mem_34c8d0', 'mem_09d17b'], started: '2h ago' },
  ] satisfies DemoRun[],
  actions: [
    { id: 'action_004', title: 'Reconcile Redis source-of-truth conflict', status: 'pending', memoryIds: ['mem_34c8d0'] },
    { id: 'action_003', title: 'Refresh deployment approval fact', status: 'blocked', memoryIds: ['mem_a81e22'] },
    { id: 'action_002', title: 'Retract deprecated prompt memory', status: 'completed', memoryIds: ['mem_2b6e44'] },
  ] satisfies DemoAction[],
  events: [
    { id: 'evt_1', label: 'Memory flagged', detail: 'mem_34c8d0 · conflicting evidence', kind: 'memory' },
    { id: 'evt_2', label: 'Rewind preview created', detail: 'github://acme/rewind · 4 memories', kind: 'rewind' },
    { id: 'evt_3', label: 'Repair completed', detail: 'mem_2b6e44 · retracted', kind: 'repair' },
  ] satisfies DemoEvent[],
} as const

export const demoMetrics = {
  totalMemories: demoData.memories.length,
  totalSources: demoData.sources.length,
  activeRuns: demoData.runs.filter((run) => run.status === 'active').length,
  retrievedMemories: new Set(demoData.runs.flatMap((run) => run.retrievedMemoryIds)).size,
  pendingActions: demoData.actions.filter((action) => action.status === 'pending').length,
  blockedActions: demoData.actions.filter((action) => action.status === 'blocked').length,
  completedActions: demoData.actions.filter((action) => action.status === 'completed').length,
  affectedMemories: demoData.memories.filter((memory) => memory.status !== 'valid').length,
}

export type DemoGraphNode = {
  id: string
  label: string
  type: 'Source' | 'Evidence' | 'Fact' | 'Memory' | 'AgentRun' | 'ProposedAction'
  status: 'valid' | 'affected' | 'invalidated'
  x: number
  y: number
  details: string
  supportingEvidence: string[]
  dependencies: string[]
}

export type DemoGraphEdge = { from: string; to: string; label: 'PROVIDES' | 'SUPPORTS' | 'DERIVES' | 'RETRIEVED' | 'CONTEXT' | 'DEPENDS_ON' | 'PROPOSES' }

export const graphNodes: DemoGraphNode[] = [
  { id: 'src_github', label: 'acme/rewind', type: 'Source', status: 'valid', x: 90, y: 150, details: 'Git repository capture', supportingEvidence: ['ev_commit_42'], dependencies: [] },
  { id: 'ev_commit_42', label: 'commit 7f2a91', type: 'Evidence', status: 'valid', x: 270, y: 80, details: 'README and graph adapter excerpt', supportingEvidence: [], dependencies: ['src_github'] },
  { id: 'fact_graph', label: 'Graph-backed memory', type: 'Fact', status: 'valid', x: 460, y: 80, details: 'FalkorDB stores persistent memory', supportingEvidence: ['ev_commit_42'], dependencies: ['ev_commit_42'] },
  { id: 'mem_7f2a91', label: 'FalkorDB connection uses graph memory', type: 'Memory', status: 'valid', x: 660, y: 80, details: 'Derived memory supplied to Planner', supportingEvidence: ['ev_commit_42'], dependencies: ['fact_graph'] },
  { id: 'run_0184', label: 'Planner / 0184', type: 'AgentRun', status: 'valid', x: 850, y: 80, details: 'Active agent run', supportingEvidence: [], dependencies: ['mem_7f2a91'] },
  { id: 'src_slack', label: 'engineering Slack', type: 'Source', status: 'affected', x: 90, y: 330, details: 'Conversation capture with conflicting claims', supportingEvidence: ['ev_slack_1'], dependencies: [] },
  { id: 'ev_slack_1', label: 'message 18:04', type: 'Evidence', status: 'affected', x: 270, y: 260, details: 'Redis source-of-truth claim', supportingEvidence: [], dependencies: ['src_slack'] },
  { id: 'fact_redis', label: 'Redis is canonical', type: 'Fact', status: 'affected', x: 460, y: 260, details: 'Conflicts with repository evidence', supportingEvidence: ['ev_slack_1'], dependencies: ['ev_slack_1'] },
  { id: 'mem_34c8d0', label: 'Redis cache is source of truth', type: 'Memory', status: 'invalidated', x: 660, y: 260, details: 'Conflicted memory requiring review', supportingEvidence: ['ev_slack_1'], dependencies: ['fact_redis'] },
  { id: 'action_004', label: 'Reconcile conflict', type: 'ProposedAction', status: 'affected', x: 850, y: 260, details: 'Pending repair action', supportingEvidence: [], dependencies: ['mem_34c8d0'] },
  { id: 'action_003', label: 'Refresh approval fact', type: 'ProposedAction', status: 'invalidated', x: 850, y: 430, details: 'Blocked until source is refreshed', supportingEvidence: [], dependencies: ['mem_a81e22'] },
  { id: 'mem_a81e22', label: 'Manual deploy approval', type: 'Memory', status: 'invalidated', x: 660, y: 430, details: 'Stale memory from repository history', supportingEvidence: ['ev_commit_old'], dependencies: ['fact_approval'] },
  { id: 'fact_approval', label: 'Approval required', type: 'Fact', status: 'invalidated', x: 460, y: 430, details: 'Needs current repository evidence', supportingEvidence: ['ev_commit_old'], dependencies: ['ev_commit_old'] },
  { id: 'ev_commit_old', label: 'commit 2a91c0', type: 'Evidence', status: 'invalidated', x: 270, y: 430, details: 'Outdated deployment documentation', supportingEvidence: [], dependencies: ['src_github'] },
]

export const graphEdges: DemoGraphEdge[] = [
  { from: 'src_github', to: 'ev_commit_42', label: 'PROVIDES' }, { from: 'ev_commit_42', to: 'fact_graph', label: 'SUPPORTS' }, { from: 'fact_graph', to: 'mem_7f2a91', label: 'DERIVES' }, { from: 'mem_7f2a91', to: 'run_0184', label: 'RETRIEVED' },
  { from: 'src_slack', to: 'ev_slack_1', label: 'PROVIDES' }, { from: 'ev_slack_1', to: 'fact_redis', label: 'SUPPORTS' }, { from: 'fact_redis', to: 'mem_34c8d0', label: 'DERIVES' }, { from: 'mem_34c8d0', to: 'action_004', label: 'DEPENDS_ON' },
  { from: 'src_github', to: 'ev_commit_old', label: 'PROVIDES' }, { from: 'ev_commit_old', to: 'fact_approval', label: 'SUPPORTS' }, { from: 'fact_approval', to: 'mem_a81e22', label: 'DERIVES' }, { from: 'mem_a81e22', to: 'action_003', label: 'DEPENDS_ON' },
]

export const sourceNeedingAttention = demoData.sources[0]
