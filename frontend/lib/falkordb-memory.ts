import { FalkorDB, type Graph } from "falkordb"
import type { AgentRun, DerivedMemory, Evidence, Fact, ProposedAction, Source } from "./contracts"

export type MemoryStatus = "active" | "superseded" | "unsupported" | "rewound" | "candidate" | "retracted" | "valid" | "stale"
export type RetrievedMemory = DerivedMemory & { status: MemoryStatus; persistent: true }

export interface MemoryGraphRecord {
  source: Source
  evidence: Evidence
  fact: Fact
  memory: DerivedMemory
}

export interface FalkorDBMemoryStoreOptions {
  url?: string
  graphName?: string
  graph?: Graph
}

const graphUrl = () => process.env.FALKORDB_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379"

function serializeProps(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue
    if (val === null || typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      result[key] = val
    } else if (
      Array.isArray(val) &&
      val.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    ) {
      result[key] = val
    } else {
      result[key] = JSON.stringify(val)
    }
  }
  return result
}

function normalizeNode<T>(node: unknown): T {
  if (!node || typeof node !== "object") return node as T
  if ("properties" in (node as any)) {
    return (node as any).properties as T
  }
  return node as T
}

export class FalkorDBMemoryStore {
  constructor(public readonly graph: Graph) {}

  static async connect(options: FalkorDBMemoryStoreOptions = {}): Promise<FalkorDBMemoryStore> {
    if (options.graph) return new FalkorDBMemoryStore(options.graph)
    const url = options.url ?? graphUrl()
    const client = await FalkorDB.connect({ url })
    const graphName = options.graphName ?? process.env.FALKORDB_GRAPH ?? "rewind"
    return new FalkorDBMemoryStore(client.selectGraph(graphName))
  }

  async ensureSchema(): Promise<void> {
    await this.graph.query("CREATE INDEX FOR (n:Source) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:Evidence) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:Fact) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:Memory) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:AgentRun) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:ProposedAction) ON (n.id)")
  }

  /**
   * Complete evidence lineage:
   * Source -> Evidence -> Fact -> Derived Memory
   */
  async write(record: MemoryGraphRecord): Promise<void> {
    const { source, evidence, fact, memory } = record
    await this.graph.query(
      `
      MERGE (s:Source {id: $sourceId})
      SET s += $sourceProps
      MERGE (e:Evidence {id: $evidenceId})
      SET e += $evidenceProps
      MERGE (s)-[:PROVIDES]->(e)
      MERGE (f:Fact {id: $factId})
      SET f += $factProps
      MERGE (e)-[:SUPPORTS]->(f)
      MERGE (m:Memory {id: $memoryId})
      SET m += $memoryProps, m.status = coalesce(m.status, 'active')
      MERGE (f)-[:DERIVES]->(m)
      MERGE (e)-[:SUPPORTS]->(m)
      `,
      {
        params: {
          sourceId: source.id,
          sourceProps: serializeProps(source as any),
          evidenceId: evidence.id,
          evidenceProps: serializeProps(evidence as any),
          factId: fact.id,
          factProps: serializeProps(fact as any),
          memoryId: memory.id,
          memoryProps: serializeProps(memory as any),
        } as any,
      }
    )
  }

  /**
   * Persists an agent run and records:
   * 1. All persistent memories retrieved during execution ([:RETRIEVED])
   * 2. The exact subset included in the prompt/context window ([:CONTEXT])
   */
  async recordAgentRun(
    run: AgentRun,
    contextMemoryIds: string[] = run.contextMemoryIds ?? run.retrievedMemoryIds
  ): Promise<void> {
    const runProps = serializeProps({ ...run, contextMemoryIds } as any)
    await this.graph.query(
      `
      MERGE (r:AgentRun {id: $runId})
      SET r += $runProps
      WITH r
      UNWIND $retrievedIds AS memId
      MATCH (m:Memory {id: memId})
      MERGE (r)-[:RETRIEVED]->(m)
      WITH r
      UNWIND $contextIds AS ctxId
      MATCH (cm:Memory {id: ctxId})
      MERGE (r)-[:CONTEXT]->(cm)
      `,
      {
        params: {
          runId: run.id,
          runProps,
          retrievedIds: run.retrievedMemoryIds,
          contextIds: contextMemoryIds,
        } as any,
      }
    )
  }

  /**
   * Records a proposed action and binds it to:
   * 1. The agent run that proposed it ([:PROPOSES])
   * 2. The memory dependencies required for safe execution ([:DEPENDS_ON])
   */
  async recordProposedAction(action: ProposedAction, runId?: string): Promise<void> {
    const memoryDeps = action.memoryIds ?? action.dependencies ?? []
    const actionProps = serializeProps(action as any)
    const cypher = `
      MERGE (a:ProposedAction {id: $actionId})
      SET a += $actionProps
      WITH a
      UNWIND $deps AS memId
      MATCH (m:Memory {id: memId})
      MERGE (a)-[:DEPENDS_ON]->(m)
      ${runId ? `WITH a MATCH (r:AgentRun {id: $runId}) MERGE (r)-[:PROPOSES]->(a)` : ""}
    `
    await this.graph.query(cypher, {
      params: {
        actionId: action.id,
        actionProps,
        deps: memoryDeps,
        ...(runId ? { runId } : {}),
      } as any,
    })
  }

  /**
   * Retrieves relevant active memories, searching content, subject, and predicate,
   * validating that m.status is 'active' before returning.
   */
  async retrieveRelevant(query: string, limit = 10): Promise<RetrievedMemory[]> {
    const qLower = query.toLowerCase()
    const result = await this.graph.roQuery<Record<string, unknown>>(
      `
      MATCH (m:Memory)
      WHERE m.status = 'active'
        AND (
          toLower(coalesce(m.content, '')) CONTAINS $q
          OR toLower(coalesce(m.subject, '')) CONTAINS $q
          OR toLower(coalesce(m.predicate, '')) CONTAINS $q
        )
      RETURN m
      ORDER BY coalesce(m.updatedAt, m.createdAt) DESC
      LIMIT $limit
      `,
      {
        params: {
          q: qLower,
          limit: Math.max(1, Math.floor(limit)),
        },
      }
    )

    return (result.data ?? []).map((row) => {
      const raw = row.m ?? row
      const memory = normalizeNode<DerivedMemory & { status?: MemoryStatus }>(raw)
      return {
        ...memory,
        status: (memory.status ?? "active") as MemoryStatus,
        persistent: true,
      }
    })
  }

  /**
   * Validates the current status of a specific memory and verifies
   * whether its supporting evidence chain is active.
   */
  async validateMemoryStatus(memoryId: string): Promise<{
    valid: boolean
    status: MemoryStatus
    memory?: RetrievedMemory
    supportingEvidenceCount: number
  }> {
    const result = await this.graph.roQuery<Record<string, unknown>>(
      `
      MATCH (m:Memory {id: $memoryId})
      OPTIONAL MATCH (e:Evidence)-[:SUPPORTS]->(m)
      OPTIONAL MATCH (s:Source)-[:PROVIDES]->(e)
      RETURN m, count(DISTINCT e) AS evidenceCount, count(DISTINCT CASE WHEN s.status = 'active' THEN s END) AS activeSources
      `,
      {
        params: { memoryId },
      }
    )

    const row = result.data?.[0]
    if (!row || !row.m) {
      return { valid: false, status: "unsupported", supportingEvidenceCount: 0 }
    }

    const memory = normalizeNode<DerivedMemory & { status?: MemoryStatus }>(row.m)
    const status = (memory.status ?? "active") as MemoryStatus
    const evidenceCount = Number(row.evidenceCount ?? 0)
    const activeSources = Number(row.activeSources ?? 0)

    const isValid = status === "active" && (evidenceCount === 0 || activeSources > 0)
    return {
      valid: isValid,
      status,
      memory: { ...memory, status, persistent: true },
      supportingEvidenceCount: evidenceCount,
    }
  }

  /**
   * Retrieves an agent run along with:
   * - all persistent memories retrieved
   * - the specific context subset included in the prompt
   */
  async getRunContext(runId: string): Promise<{
    run: AgentRun
    retrievedMemoryIds: string[]
    contextMemoryIds: string[]
    retrievedMemories: RetrievedMemory[]
    contextMemories: RetrievedMemory[]
  }> {
    const result = await this.graph.roQuery<Record<string, unknown>>(
      `
      MATCH (r:AgentRun {id: $runId})
      OPTIONAL MATCH (r)-[:RETRIEVED]->(rm:Memory)
      OPTIONAL MATCH (r)-[:CONTEXT]->(cm:Memory)
      RETURN r,
             collect(DISTINCT rm) AS retrievedMemories,
             collect(DISTINCT cm) AS contextMemories,
             collect(DISTINCT rm.id) AS retrievedMemoryIds,
             collect(DISTINCT cm.id) AS contextMemoryIds
      `,
      {
        params: { runId },
      }
    )

    const row = result.data?.[0]
    if (!row || !row.r) throw new Error(`Agent run not found: ${runId}`)

    const run = normalizeNode<AgentRun>(row.r)
    const retrievedMemories = ((row.retrievedMemories ?? []) as any[])
      .map(normalizeNode<DerivedMemory & { status?: MemoryStatus }>)
      .filter((m) => m && m.id)
      .map((m) => ({ ...m, status: (m.status ?? "active") as MemoryStatus, persistent: true as const }))

    const contextMemories = ((row.contextMemories ?? []) as any[])
      .map(normalizeNode<DerivedMemory & { status?: MemoryStatus }>)
      .filter((m) => m && m.id)
      .map((m) => ({ ...m, status: (m.status ?? "active") as MemoryStatus, persistent: true as const }))

    return {
      run,
      retrievedMemoryIds: ((row.retrievedMemoryIds ?? []) as string[]).filter(Boolean),
      contextMemoryIds: ((row.contextMemoryIds ?? []) as string[]).filter(Boolean),
      retrievedMemories,
      contextMemories,
    }
  }

  /**
   * Retrieves an action and validates all its memory dependencies in FalkorDB.
   */
  async getActionDependencies(actionId: string): Promise<{
    action: ProposedAction
    proposingRunId?: string
    dependencies: Array<{ memoryId: string; status: MemoryStatus; valid: boolean }>
    allDependenciesValid: boolean
  }> {
    const result = await this.graph.roQuery<Record<string, unknown>>(
      `
      MATCH (a:ProposedAction {id: $actionId})
      OPTIONAL MATCH (r:AgentRun)-[:PROPOSES]->(a)
      OPTIONAL MATCH (a)-[:DEPENDS_ON]->(m:Memory)
      RETURN a, r.id AS proposingRunId, collect(DISTINCT m) AS memories
      `,
      {
        params: { actionId },
      }
    )

    const row = result.data?.[0]
    if (!row || !row.a) throw new Error(`Proposed action not found: ${actionId}`)

    const action = normalizeNode<ProposedAction>(row.a)
    const rawMemories = (row.memories ?? []) as any[]
    const memories = rawMemories.map(normalizeNode<DerivedMemory & { status?: MemoryStatus }>)

    const dependencies = memories
      .filter((m) => m && m.id)
      .map((m) => ({
        memoryId: m.id,
        status: (m.status ?? "active") as MemoryStatus,
        valid: m.status === "active",
      }))

    const allValid = dependencies.length > 0 && dependencies.every((d) => d.valid)

    return {
      action,
      proposingRunId: row.proposingRunId as string | undefined,
      dependencies,
      allDependenciesValid: allValid,
    }
  }
}

export const createFalkorDBMemoryStore = FalkorDBMemoryStore.connect

export type GraphNode = Source | Evidence | Fact | DerivedMemory | AgentRun | ProposedAction
export type GraphEdge = "PROVIDES" | "SUPPORTS" | "DERIVES" | "RETRIEVED" | "CONTEXT" | "DEPENDS_ON" | "PROPOSES"
