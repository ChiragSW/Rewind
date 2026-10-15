/**
 * Backend API Client for Rewind
 * Connects to the FastAPI backend directly or via Next.js proxy route.
 */

export interface BackendHealth {
  status: string
  database?: string
  payments?: string
  model_configured?: boolean
  agent_provider?: string
}

export interface BackendState {
  tenant: string
  state: {
    id: string
    mode: 'ready' | 'repairing' | 'paused'
    event_sequence: number
    repair_sequence: number
  }
  counts: Record<string, number>
  model_configured: boolean
  agent_provider: string
  simulated_payments: boolean
}

export interface GraphNodeBackend {
  id: string
  kind_label: string
  status?: string
  created_at?: string
  title?: string
  subject?: string
  predicate?: string
  value?: unknown
  role?: string
  goal?: string
  [key: string]: unknown
}

export interface GraphEdgeBackend {
  source: string
  type: string
  target: string
  data?: Record<string, unknown>
}

export interface BackendGraphResponse {
  tenant: string
  mode: string
  nodes: GraphNodeBackend[]
  edges: GraphEdgeBackend[]
  truncated: boolean
}

export interface BackendEvent {
  id: string
  sequence: number
  kind_label: 'Event'
  label?: string
  event_type?: string
  details?: Record<string, unknown>
  created_at: string
}

export interface BackendEventsResponse {
  items: BackendEvent[]
  next_cursor: number
  latest_sequence: number
  has_more: boolean
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  next_offset: number | null
}

const BACKEND_BASE = '/api/backend'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BACKEND_BASE}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    let errPayload: any = null
    try {
      errPayload = await response.json()
    } catch {
      // not JSON
    }
    const message = errPayload?.error?.message || errPayload?.detail || response.statusText || 'API error'
    const error = new Error(message) as Error & { status: number; code?: string; details?: unknown }
    error.status = response.status
    error.code = errPayload?.error?.code
    error.details = errPayload?.error?.details
    throw error
  }

  return response.json() as Promise<T>
}

export const rewindApi = {
  getHealth: () => request<BackendHealth>('/health'),
  getState: () => request<BackendState>('/state'),
  getGraph: (includeEpisodes = false, limit = 1000) =>
    request<BackendGraphResponse>(`/graph?include_episodes=${includeEpisodes}&limit=${limit}`),
  getEvents: (after = 0, limit = 200) =>
    request<BackendEventsResponse>(`/events?after=${after}&limit=${limit}`),
  getSources: (offset = 0, limit = 200) =>
    request<PaginatedResponse<any>>(`/sources?offset=${offset}&limit=${limit}`),
  getMemories: (subject?: string, usableOnly = false) => {
    const q = new URLSearchParams()
    if (subject) q.set('subject', subject)
    if (usableOnly) q.set('usable_only', 'true')
    return request<{ items: any[]; mode: string }>(`/memory?${q.toString()}`)
  },
  getTasks: (offset = 0, limit = 200) =>
    request<PaginatedResponse<any>>(`/tasks?offset=${offset}&limit=${limit}`),
  getRuns: (offset = 0, limit = 200) =>
    request<PaginatedResponse<any>>(`/runs?offset=${offset}&limit=${limit}`),
  getActions: (offset = 0, limit = 200) =>
    request<PaginatedResponse<any>>(`/actions?offset=${offset}&limit=${limit}`),
  getReceipts: (offset = 0, limit = 200) =>
    request<PaginatedResponse<any>>(`/receipts?offset=${offset}&limit=${limit}`),
  getRecord: (id: string) => request<any>(`/records/${encodeURIComponent(id)}`),
  getProvenance: (memoryId: string) =>
    request<any>(`/memory/${encodeURIComponent(memoryId)}/provenance`),

  // Mutations
  seedDemo: (reset = true, confirm = 'reset-this-demo-tenant') =>
    request<any>('/demo/seed', {
      method: 'POST',
      body: JSON.stringify({ reset, confirm }),
    }),
  previewRevocation: (sourceId: string) =>
    request<any>(`/sources/${encodeURIComponent(sourceId)}/revocation-preview`, {
      method: 'POST',
    }),
  revokeSource: (sourceId: string, reason: string, idempotencyKey = `idemp_${Date.now()}`) =>
    request<any>(`/sources/${encodeURIComponent(sourceId)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason, idempotency_key: idempotencyKey }),
    }),
  approveAction: (actionId: string, payloadHash: string) =>
    request<any>(`/actions/${encodeURIComponent(actionId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ payload_hash: payloadHash }),
    }),
  executeAction: (actionId: string) =>
    request<any>(`/actions/${encodeURIComponent(actionId)}/execute`, {
      method: 'POST',
    }),
  startRun: (taskId: string, role: 'planner' | 'executor', mode: 'live' | 'scripted' = 'scripted') =>
    request<any>(`/tasks/${encodeURIComponent(taskId)}/runs`, {
      method: 'POST',
      body: JSON.stringify({ role, mode }),
    }),
  continueRun: (runId: string) =>
    request<any>(`/runs/${encodeURIComponent(runId)}/continue`, {
      method: 'POST',
    }),
  applyCorrection: (correction: {
    source: { id: string; title: string; content: string; authority: string }
    memory: { id: string; kind: string; subject: string; predicate: string; value: unknown; inputs: string[] }
    supersedes_id?: string
  }) =>
    request<any>('/corrections', {
      method: 'POST',
      body: JSON.stringify(correction),
    }),
}
