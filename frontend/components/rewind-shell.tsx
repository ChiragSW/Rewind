'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  GitBranch,
  Menu,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
  Radio,
} from 'lucide-react'
import { graphEdges as demoEdges, graphNodes as demoNodes, type DemoGraphEdge, type DemoGraphNode } from '@/lib/rewind-demo-data'
import { applyRewind, previewRewind, recordEvent, seedState, validateAction, type RewindState } from '@/lib/rewind-domain'
import { rewindApi, type BackendGraphResponse, type BackendState } from '@/lib/backend-client'

type View = 'Overview' | 'Sources' | 'Memory graph' | 'Agent runs' | 'Actions' | 'Memory recall' | 'Audit log'
type Point = { x: number; y: number }

const views: View[] = ['Overview', 'Sources', 'Memory graph', 'Agent runs', 'Actions', 'Memory recall', 'Audit log']
const typeTone: Record<string, string> = {
  Source: 'source',
  Evidence: 'evidence',
  Fact: 'fact',
  Memory: 'memory',
  AgentRun: 'run',
  Run: 'run',
  ProposedAction: 'action',
  Action: 'action',
  Task: 'run',
  Receipt: 'evidence',
}

export default function RewindShell() {
  const [view, setView] = useState<View>('Memory graph')
  const [state, setState] = useState<RewindState>(() => seedState())
  const [selected, setSelected] = useState('mem_34c8d0')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<ReturnType<typeof previewRewind> | null>(null)
  const [toast, setToast] = useState('')
  const [sidebar, setSidebar] = useState(false)
  const [isLiveMode, setIsLiveMode] = useState(false)
  const [backendAvailable, setBackendAvailable] = useState(false)
  const [tenant, setTenant] = useState('tenant_a')
  const [activeNodes, setActiveNodes] = useState<DemoGraphNode[]>(demoNodes)
  const [activeEdges, setActiveEdges] = useState<DemoGraphEdge[]>(demoEdges)

  const [positions, setPositions] = useState<Record<string, Point>>(() =>
    Object.fromEntries(demoNodes.map((node) => [node.id, { x: node.x, y: node.y }]))
  )

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3000)
  }

  const inspect = (id: string) => {
    setSelected(id)
    setView('Memory graph')
  }

  // Check and sync with backend if available
  const syncBackend = useCallback(async () => {
    try {
      const health = await rewindApi.getHealth()
      if (health.status === 'ok') {
        setBackendAvailable(true)
        const beState = await rewindApi.getState()
        setTenant(beState.tenant)

        const graphRes = await rewindApi.getGraph(false, 500)
        if (graphRes.nodes && graphRes.nodes.length > 0) {
          // Layout backend nodes
          const mappedNodes: DemoGraphNode[] = graphRes.nodes.map((n, idx) => {
            const angle = (idx / Math.max(1, graphRes.nodes.length)) * Math.PI * 2
            const radius = n.kind_label === 'Source' ? 140 : n.kind_label === 'Memory' ? 220 : 300
            const x = Math.round(480 + Math.cos(angle) * radius)
            const y = Math.round(270 + Math.sin(angle) * radius * 0.7)
            return {
              id: n.id,
              label: (n.title as string) || (n.subject as string) || n.id,
              type: (n.kind_label === 'Run' ? 'AgentRun' : n.kind_label === 'Action' ? 'ProposedAction' : n.kind_label) as any,
              status: n.status === 'revoked' || n.status === 'stale' || n.status === 'unsupported' ? 'invalidated' : 'valid',
              x: Math.max(40, Math.min(920, x)),
              y: Math.max(40, Math.min(480, y)),
              details: JSON.stringify(n.value || n.goal || n.title || n.kind_label),
              supportingEvidence: [],
              dependencies: [],
            }
          })

          const mappedEdges: DemoGraphEdge[] = graphRes.edges.map((e) => ({
            from: e.source,
            to: e.target,
            label: (e.type as any) || 'SUPPORTS',
          }))

          setActiveNodes(mappedNodes)
          setActiveEdges(mappedEdges)
          setPositions(Object.fromEntries(mappedNodes.map((node) => [node.id, { x: node.x, y: node.y }])))
          if (mappedNodes.length > 0) {
            setSelected(mappedNodes[0].id)
          }
        }
        setIsLiveMode(true)
        notify(`Connected to live Rewind backend (${beState.tenant})`)
        return
      }
    } catch {
      // Backend not running; stay in synthetic mode
      setBackendAvailable(false)
      setIsLiveMode(false)
    }
  }, [])

  useEffect(() => {
    syncBackend()
  }, [syncBackend])

  const reset = async () => {
    if (isLiveMode && backendAvailable) {
      try {
        await rewindApi.seedDemo(true, 'reset-this-demo-tenant')
        await syncBackend()
        notify('Backend demo seeded and reset successfully')
        return
      } catch (err: any) {
        notify(`Backend reset failed: ${err.message}`)
      }
    }
    setState(seedState())
    setActiveNodes(demoNodes)
    setActiveEdges(demoEdges)
    setPositions(Object.fromEntries(demoNodes.map((node) => [node.id, { x: node.x, y: node.y }])))
    setPreview(null)
    setSelected('mem_34c8d0')
    notify('Local synthetic state reset')
  }

  const affected = preview ? new Set(preview.invalidated.map((memory) => memory.id)) : new Set<string>()

  const togglePreview = async () => {
    if (preview) {
      setPreview(null)
      notify('Preview canceled')
      return
    }

    if (isLiveMode && backendAvailable) {
      try {
        const res = await rewindApi.previewRevocation('src-onboarding-incorrect')
        notify(`Live preview: ${res.invalidated?.length || 0} invalidated, ${res.preserved?.length || 0} preserved`)
        setPreview({
          source: 'src-onboarding-incorrect',
          affected: res.invalidated || [],
          invalidated: res.invalidated || [],
          preserved: res.preserved || [],
          staleRunIds: res.affected_runs || [],
          blockedActionIds: res.stale_actions || [],
        })
        return
      } catch (err: any) {
        notify(`Preview error: ${err.message}`)
      }
    }

    const next = previewRewind(state, 'github://acme/rewind')
    setPreview(next)
    notify('Preview created — no data changed')
  }

  const confirm = async () => {
    if (!preview) return
    if (isLiveMode && backendAvailable) {
      try {
        await rewindApi.revokeSource(preview.source, 'Confirmed by user from frontend UI')
        await syncBackend()
        setPreview(null)
        notify('Live backend memory repair completed!')
        return
      } catch (err: any) {
        notify(`Live rewind error: ${err.message}`)
      }
    }
    setState((current) => applyRewind(current, preview.source))
    setPreview(null)
    notify('Rewind confirmed and local memory repaired')
  }

  const action = async (id: string) => {
    if (isLiveMode && backendAvailable) {
      try {
        await rewindApi.executeAction(id)
        await syncBackend()
        notify(`Live action ${id} executed successfully`)
        return
      } catch (err: any) {
        notify(`Live action blocked: ${err.message}`)
        return
      }
    }

    const result = validateAction(state, id)
    if (!result.ok) return notify(result.reason)
    setState((current) => {
      const next = {
        ...current,
        actions: current.actions.map((item) => (item.id === id ? { ...item, status: 'completed' as const } : item)),
      }
      return recordEvent(next, 'Action completed', id, 'repair')
    })
    notify('Action completed safely')
  }

  return (
    <div className="rewind-app">
      <aside className={`rewind-rail ${sidebar ? 'open' : ''}`}>
        <div className="rewind-brand">
          <img
            className="rewind-logo"
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/rewind-removebg-preview-FNCwJLtWjg9BCWtuUCK2rnmRdvhewx.png"
            alt="Rewind"
          />
        </div>
        <nav>
          {views.map((item) => (
            <button
              key={item}
              className={view === item ? 'active' : ''}
              onClick={() => {
                setView(item)
                setSidebar(false)
              }}
            >
              <span>
                {item === 'Memory graph' ? (
                  <Network size={15} />
                ) : item === 'Sources' ? (
                  <Database size={15} />
                ) : item === 'Agent runs' ? (
                  <Bot size={15} />
                ) : item === 'Actions' ? (
                  <Wrench size={15} />
                ) : item === 'Audit log' ? (
                  <Activity size={15} />
                ) : (
                  <CircleDot size={15} />
                )}
              </span>
              {item}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <span className={`state-marker ${isLiveMode ? 'valid' : 'valid'}`} />
          {isLiveMode ? `Live backend (${tenant})` : 'Local demo state'}
          <div className="rail-reset">
            <button onClick={reset}>
              <RefreshCw size={13} />
              Reset
            </button>
            <span
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => {
                if (backendAvailable) {
                  setIsLiveMode(!isLiveMode)
                  notify(isLiveMode ? 'Switched to local synthetic mode' : 'Switched to live backend')
                } else {
                  syncBackend()
                }
              }}
              title="Click to toggle or reconnect"
            >
              {isLiveMode ? 'online' : backendAvailable ? 'local (toggle)' : 'offline'}
            </span>
          </div>
        </div>
      </aside>

      <main className="rewind-main">
        <header className="rewind-topbar">
          <button className="rail-menu" aria-label="Open navigation" onClick={() => setSidebar(true)}>
            <Menu size={18} />
          </button>
          <div className="crumb">
            <span>REWIND</span>
            <ChevronRight size={14} />
            <b>{view}</b>
          </div>
          <div className="top-search">
            <Search size={15} />
            <input
              aria-label="Focus graph node"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find source, memory, run, or action"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  const match = activeNodes.find((node) =>
                    `${node.label} ${node.id}`.toLowerCase().includes(query.toLowerCase())
                  )
                  if (match) {
                    inspect(match.id)
                    notify(`Focused ${match.label}`)
                  }
                }
              }}
            />
          </div>
          <button
            className="top-status"
            style={{ cursor: 'pointer', border: 'none', background: 'transparent' }}
            onClick={() => syncBackend()}
            title="Click to refresh backend status"
          >
            <i style={{ backgroundColor: isLiveMode ? '#22c55e' : '#f59e0b' }} />
            {isLiveMode ? `LIVE BACKEND / ${tenant.toUpperCase()}` : 'LOCAL / SYNTHETIC'}
          </button>
          <button className="icon-quiet" onClick={reset} aria-label="Reset demo">
            <RefreshCw size={16} />
          </button>
        </header>

        <section className="rewind-heading">
          <div>
            <div className="eyebrow">
              <CircleDot size={12} />
              MEMORY PROVENANCE / REPAIR WORKSPACE
            </div>
            <h1>{view === 'Memory graph' ? 'Memory provenance graph' : view}</h1>
            <p>Trace evidence into derived memory, inspect downstream agent usage, and repair only what the evidence supports.</p>
          </div>
          <div className="heading-meta">
            <span>{activeNodes.length} records</span>
            <span>{activeEdges.length} relationships</span>
            <span className="valid-text">
              {activeNodes.filter((node) => node.status === 'valid').length} valid records
            </span>
          </div>
        </section>

        {view === 'Memory graph' ? (
          <Graph
            nodesList={activeNodes}
            edgesList={activeEdges}
            state={state}
            selected={selected}
            setSelected={inspect}
            positions={positions}
            setPositions={setPositions}
            affected={affected}
            preview={preview}
            togglePreview={togglePreview}
            confirm={confirm}
          />
        ) : (
          <Workspace
            view={view}
            state={state}
            query={query}
            setQuery={setQuery}
            selected={selected}
            inspect={inspect}
            preview={preview}
            togglePreview={togglePreview}
            confirm={confirm}
            action={action}
            isLiveMode={isLiveMode}
            backendAvailable={backendAvailable}
          />
        )}
      </main>

      {toast && (
        <div className="rewind-toast">
          <Check size={14} />
          {toast}
        </div>
      )}
    </div>
  )
}

function Graph({
  nodesList,
  edgesList,
  state,
  selected,
  setSelected,
  positions,
  setPositions,
  affected,
  preview,
  togglePreview,
  confirm,
}: any) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const drag = useRef<{ kind: 'node' | 'pan' | null; id?: string; x: number; y: number; startX: number; startY: number }>({
    kind: null,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
  })

  const nodes = (nodesList || demoNodes).map((node: any) => {
    const memory = state.memories?.find((item: any) => item.id === node.id)
    return {
      ...node,
      status: memory ? (memory.status === 'valid' ? 'valid' : 'invalidated') : node.status,
    }
  })

  const chosen = nodes.find((node: any) => node.id === selected) ?? nodes[0] ?? demoNodes[0]
  const auditEntry = preview?.auditRecords?.find((entry: any) => entry.memoryId === chosen.id)
  const edges = edgesList || demoEdges
  const upstream = edges
    .filter((edge: any) => edge.to === chosen.id)
    .map((edge: any) => nodes.find((node: any) => node.id === edge.from))
    .filter(Boolean)
  const downstream = edges
    .filter((edge: any) => edge.from === chosen.id)
    .map((edge: any) => nodes.find((node: any) => node.id === edge.to))
    .filter(Boolean)

  const reset = () => {
    setPositions(Object.fromEntries(nodes.map((node: any) => [node.id, { x: node.x, y: node.y }])))
    setPan({ x: 0, y: 0 })
    setZoom(1)
  }

  const arrangeOrbit = () => {
    const center = { x: 480, y: 270 }
    const next: Record<string, Point> = { [chosen.id]: center }
    const others = nodes.filter((node: any) => node.id !== chosen.id)
    others.forEach((node: any, index: number) => {
      const ring = node.type === 'Source' || node.type === 'Evidence' ? 175 : node.type === 'ProposedAction' || node.type === 'AgentRun' ? 190 : 115
      const angle = (index / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2
      next[node.id] = { x: center.x + Math.cos(angle) * ring, y: center.y + Math.sin(angle) * ring }
    })
    setPositions(next)
    setPan({ x: 0, y: 0 })
  }

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current.kind) return
    if (current.kind === 'node' && current.id) {
      const rect = event.currentTarget.getBoundingClientRect()
      setPositions((items: Record<string, Point>) => ({
        ...items,
        [current.id!]: {
          x: Math.max(30, Math.min(930, (event.clientX - rect.left - pan.x) / zoom + current.x)),
          y: Math.max(30, Math.min(480, (event.clientY - rect.top - pan.y) / zoom + current.y)),
        },
      }))
    } else {
      setPan({ x: current.startX + event.clientX - current.x, y: current.startY + event.clientY - current.y })
    }
  }

  const endDrag = () => {
    drag.current = { kind: null, x: 0, y: 0, startX: 0, startY: 0 }
  }

  const startNode = (event: React.PointerEvent, id: string) => {
    event.stopPropagation()
    const point = positions[id] || { x: 480, y: 270 }
    drag.current = { kind: 'node', id, x: point.x, y: point.y, startX: event.clientX, startY: event.clientY }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    drag.current = { kind: 'pan', x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y }
  }

  return (
    <div className="graph-shell">
      <div className="graph-toolbar">
        <div>
          <span className="eyebrow">PROVENANCE GRAPH / ACTIVE REPOSITORIES</span>
          <strong>Source <i>&rarr;</i> evidence <i>&rarr;</i> fact <i>&rarr;</i> memory <i>&rarr;</i> run <i>&rarr;</i> action</strong>
        </div>
        <div className="graph-tools">
          <button onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))} aria-label="Zoom out">
            <ZoomOut size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))} aria-label="Zoom in">
            <ZoomIn size={15} />
          </button>
          <button onClick={arrangeOrbit}>Arrange orbit</button>
          <button onClick={reset}>Reset layout</button>
          <button
            className={preview ? 'filter-active' : ''}
            onClick={togglePreview}
            style={{ fontWeight: 600, color: preview ? '#ff7875' : undefined }}
          >
            {preview ? 'Exit preview' : 'Preview rewind'}
          </button>
        </div>
      </div>
      {preview && (
        <div className="preview-strip" style={{ margin: '0 0 14px 0' }}>
          <AlertTriangle size={15} />
          <span>
            {preview.invalidated.length} memories invalidated; {preview.preserved.length} preserved by independent evidence.
          </span>
          <button onClick={confirm}>Confirm rewind</button>
          <button onClick={togglePreview} aria-label="Cancel preview">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="graph-layout">
        <section className="graph-stage">
          <div
            className="graph-canvas"
            onPointerDown={startPan}
            onPointerMove={pointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={(event) => {
              event.preventDefault()
              setZoom((value) => Math.max(0.6, Math.min(1.8, value + (event.deltaY > 0 ? -0.05 : 0.05))))
            }}
          >
            <div
              className="graph-viewport"
              style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom * 0.62})` }}
            >
              <svg className="graph-lines" viewBox="0 0 960 520" aria-hidden="true">
                <defs>
                  <marker id="rewind-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L7,3 z" fill="#777d88" />
                  </marker>
                </defs>
                {edges.map((edge: any) => {
                  const from = positions[edge.from] || { x: 480, y: 270 }
                  const to = positions[edge.to] || { x: 480, y: 270 }
                  const bend = Math.max(28, Math.abs(to.y - from.y) * 0.35)
                  return (
                    <path
                      key={`${edge.from}-${edge.to}`}
                      d={`M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`}
                      className={affected.has(edge.from) || affected.has(edge.to) ? 'graph-edge affected' : 'graph-edge'}
                      markerEnd="url(#rewind-arrow)"
                    />
                  )
                })}
              </svg>
              {nodes.map((node: any) => {
                const point = positions[node.id] || { x: 480, y: 270 }
                const isAffected = affected.has(node.id)
                return (
                  <button
                    key={node.id}
                    className={`graph-dot ${typeTone[node.type] || 'memory'} ${node.status} ${
                      selected === node.id ? 'selected' : ''
                    } ${isAffected ? 'preview-affected' : ''}`}
                    style={{ left: point.x, top: point.y }}
                    onPointerDown={(event) => startNode(event, node.id)}
                    onClick={() => setSelected(node.id)}
                    title={`${node.type}: ${node.details}`}
                    aria-label={`Select ${node.type} ${node.label}`}
                  >
                    <span />
                    <label>{node.label}</label>
                  </button>
                )
              })}
            </div>
            <div className="graph-canvas-hint">Drag empty space to pan &middot; drag nodes to reposition &middot; scroll to zoom</div>
            <div className="graph-minimap">
              <div className="minimap-frame">
                {nodes.map((node: any) => (
                  <i key={node.id} className={node.status} style={{ left: `${node.x / 10}%`, top: `${node.y / 5.2}%` }} />
                ))}
              </div>
              <span>MINIMAP</span>
            </div>
          </div>
          <div className="graph-status">
            <span><i className="valid-dot" />valid</span>
            <span><i className="affected-dot" />affected</span>
            <span><i className="invalid-dot" />invalidated</span>
            <span className="graph-count">{nodes.length} records &middot; {edges.length} edges</span>
          </div>
        </section>
        <aside className="graph-inspector">
          <div className="inspector-head">
            <span className="eyebrow">NODE INSPECTOR</span>
            <span className={`node-type ${typeTone[chosen.type] || 'memory'}`}>{chosen.type}</span>
          </div>
          <h2>{chosen.label}</h2>
          <code>{chosen.id}</code>
          <p>{chosen.details}</p>
          <div className="inspector-state">
            <span className={`state-marker ${chosen.status}`} />
            {chosen.status} record
          </div>
          <InspectorList title="UPSTREAM EVIDENCE" items={upstream} setSelected={setSelected} />
          <InspectorList title="DOWNSTREAM DEPENDENTS" items={downstream} setSelected={setSelected} />
          {auditEntry ? (
            <div
              className="inspector-block"
              style={{
                borderLeft: auditEntry.decision === 'invalidated' ? '3px solid #ff4d4f' : '3px solid #52c41a',
                background: auditEntry.decision === 'invalidated' ? 'rgba(255, 77, 79, 0.08)' : 'rgba(82, 196, 26, 0.08)',
                padding: '10px 12px',
                borderRadius: '0 4px 4px 0',
                margin: '12px 0',
              }}
            >
              <span className="eyebrow" style={{ color: auditEntry.decision === 'invalidated' ? '#ff7875' : '#73d13d' }}>
                REPAIR ENGINE AUDIT DECISION
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }}>
                <span className={`state-marker ${auditEntry.decision === 'invalidated' ? 'invalidated' : 'valid'}`} />
                <strong style={{ fontSize: '0.85rem', color: auditEntry.decision === 'invalidated' ? '#ff7875' : '#73d13d', letterSpacing: '0.04em' }}>
                  {auditEntry.decision.toUpperCase().replace('_', ' ')}
                </strong>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#ccc', margin: 0, lineHeight: 1.5 }}>
                {auditEntry.reason}
              </p>
            </div>
          ) : (
            <div className="inspector-block">
              <span className="eyebrow">RELATIONSHIP</span>
              <strong>Selected node is part of the repair graph.</strong>
              <small>Preview state highlights paths returned by the deterministic rewind evaluator.</small>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function InspectorList({ title, items, setSelected }: any) {
  return (
    <div className="inspector-list">
      <span className="eyebrow">{title}</span>
      {items.length ? (
        items.map((item: any) => (
          <button key={item.id} onClick={() => setSelected(item.id)}>
            <i className={`mini-dot ${typeTone[item.type] || 'memory'}`} />
            <span>{item.label}</span>
            <ChevronRight size={13} />
          </button>
        ))
      ) : (
        <small>None in current graph.</small>
      )}
    </div>
  )
}

function Workspace({
  view,
  state,
  query,
  setQuery,
  inspect,
  selected,
  preview,
  togglePreview,
  confirm,
  action,
  isLiveMode,
  backendAvailable,
}: any) {
  const rows =
    view === 'Sources'
      ? state.sources.map((source: string) => ({
          id: source,
          title: source,
          detail: 'Source capture record',
        }))
      : view === 'Memory recall'
      ? state.memories
          .filter((memory: any) =>
            `${memory.id} ${memory.title} ${memory.content}`.toLowerCase().includes(query.toLowerCase())
          )
          .map((memory: any) => ({
            id: memory.id,
            title: memory.title,
            detail: `${memory.status} &middot; ${memory.source}`,
          }))
      : view === 'Agent runs'
      ? state.runs.map((run: any) => ({
          id: run.id,
          title: run.agent,
          detail: `${run.status} &middot; ${run.retrievedMemoryIds?.length || 0} memories retrieved`,
        }))
      : view === 'Actions'
      ? state.actions.map((item: any) => ({
          id: item.id,
          title: item.title,
          detail: `${item.status} &middot; ${item.memoryIds?.join(', ')}`,
        }))
      : [
          ...(preview?.auditRecords?.map((entry: any) => ({
            id: `audit_${entry.memoryId}`,
            title: `Repair Engine: ${entry.memoryId} → ${entry.decision.toUpperCase().replace('_', ' ')}`,
            detail: entry.reason,
          })) || []),
          ...state.events.map((event: any) => ({
            id: event.id,
            title: event.label,
            detail: event.detail,
          })),
        ]

  return (
    <div className="list-workspace">
      <div className="list-panel">
        <div className="list-toolbar">
          <span className="eyebrow">{view.toUpperCase()} / {isLiveMode ? 'LIVE BACKEND' : 'LOCAL DATA'}</span>
          {view === 'Memory recall' && (
            <div className="inline-search">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter memories" />
            </div>
          )}
          {view === 'Sources' && (
            <button className="quiet-action" onClick={togglePreview}>
              {preview ? 'Cancel preview' : 'Preview rewind'}
            </button>
          )}
        </div>

        {preview && view === 'Sources' && (
          <>
            <div className="preview-strip">
              <AlertTriangle size={15} />
              <span>
                {preview.invalidated.length} memories would be invalidated; {preview.preserved.length} preserved. No mutation has occurred.
              </span>
              <button onClick={confirm}>Confirm rewind</button>
              <button onClick={togglePreview} aria-label="Cancel preview">
                <X size={14} />
              </button>
            </div>

            {preview.auditRecords && preview.auditRecords.length > 0 && (
              <div style={{ margin: '14px 0', padding: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid #302c34', borderRadius: '3px' }}>
                <span className="eyebrow" style={{ display: 'block', marginBottom: '8px' }}>
                  DETERMINISTIC AUDIT TRAIL ({preview.auditRecords.length} EVALUATED)
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {preview.auditRecords.map((entry: any) => (
                    <div
                      key={entry.memoryId}
                      onClick={() => inspect(entry.memoryId)}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 12px',
                        background: 'rgba(0,0,0,0.3)',
                        borderLeft: entry.decision === 'invalidated' ? '3px solid #ff4d4f' : '3px solid #52c41a',
                        borderRadius: '0 3px 3px 0',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <code style={{ fontSize: '0.8rem', color: '#d3ccd5' }}>{entry.memoryId}</code>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: entry.decision === 'invalidated' ? '#ff7875' : '#73d13d' }}>
                          {entry.decision.toUpperCase().replace('_', ' ')}
                        </span>
                      </div>
                      <small style={{ color: '#aaa', fontSize: '0.75rem', display: 'block', lineHeight: 1.4 }}>
                        {entry.reason}
                      </small>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="record-list">
          {rows.map((row: any) => (
            <button
              className={selected === row.id ? 'record-row selected' : 'record-row'}
              key={row.id}
              onClick={() => inspect(row.id)}
            >
              <span className="record-marker" />
              <span>
                <strong>{row.title}</strong>
                <small dangerouslySetInnerHTML={{ __html: row.detail }} />
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
      </div>

      <aside className="workspace-note">
        <span className="eyebrow">REWIND PRINCIPLE</span>
        <h2>Evidence before mutation.</h2>
        <p>Every action is gated by its supporting records. Preview is pure; confirmation updates shared memory.</p>
        <div className="inline-stats">
          <span>{state.memories?.length || 0}<small>memories</small></span>
          <span>{state.runs?.length || 0}<small>runs</small></span>
          <span>{state.actions?.length || 0}<small>actions</small></span>
        </div>
        {view === 'Sources' && preview && (
          <div style={{ marginTop: '1.25rem' }}>
            <span className="eyebrow">REPAIR SIMULATION STATS</span>
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                <span style={{ color: '#aaa' }}>Source evaluated:</span>
                <code style={{ fontSize: '0.75rem' }}>{preview.source}</code>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                <span style={{ color: '#aaa' }}>Invalidated:</span>
                <strong style={{ color: '#ff7875' }}>{preview.invalidated.length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                <span style={{ color: '#aaa' }}>Preserved:</span>
                <strong style={{ color: '#73d13d' }}>{preview.preserved.length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                <span style={{ color: '#aaa' }}>Stale runs:</span>
                <span>{preview.staleRunIds.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                <span style={{ color: '#aaa' }}>Blocked actions:</span>
                <span style={{ color: '#ff7875' }}>{preview.blockedActionIds.length}</span>
              </div>
            </div>
          </div>
        )}
        {view === 'Actions' && (
          <div style={{ marginTop: '1.25rem' }}>
            <span className="eyebrow">ACTION EXECUTION</span>
            <p style={{ fontSize: '0.825rem', marginTop: '0.5rem', color: '#888' }}>
              Select an action and trigger validation and execution against supported evidence.
            </p>
            {state.actions?.map((act: any) => (
              <div key={act.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }}>
                <span style={{ fontSize: '0.8rem' }}>{act.id}</span>
                <button
                  className="quiet-action"
                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={() => action(act.id)}
                >
                  Execute
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  )
}
