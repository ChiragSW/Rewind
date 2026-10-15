import { FalkorDB, type Graph } from "falkordb"
import type { AgentRun, DerivedMemory, Evidence, Fact, ProposedAction, Source } from "./contracts"

export type MemoryStatus = "active" | "superseded" | "rewound"
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

const quote = (value: unknown) => JSON.stringify(value)
const graphUrl = () => process.env.FALKORDB_URL ?? process.env.REDIS_URL

export class FalkorDBMemoryStore {
  private constructor(private readonly graph: Graph) {}

  static async connect(options: FalkorDBMemoryStoreOptions = {}): Promise<FalkorDBMemoryStore> {
    if (options.graph) return new FalkorDBMemoryStore(options.graph)
    const url = options.url ?? graphUrl()
    if (!url) throw new Error("FALKORDB_URL is required")
    const client = await FalkorDB.connect({ url })
    return new FalkorDBMemoryStore(client.selectGraph(options.graphName ?? process.env.FALKORDB_GRAPH ?? "rewind"))
  }

  async ensureSchema(): Promise<void> {
    await this.graph.query("CREATE INDEX FOR (n:Source) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:Evidence) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:Fact) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:Memory) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:AgentRun) ON (n.id)")
    await this.graph.query("CREATE INDEX FOR (n:ProposedAction) ON (n.id)")
  }

  async write(record: MemoryGraphRecord): Promise<void> {
    const { source, evidence, fact, memory } = record
    await this.graph.query(`MERGE (s:Source {id: ${quote(source.id)}}) SET s += ${quote(source)}
      MERGE (e:Evidence {id: ${quote(evidence.id)}}) SET e += ${quote(evidence)}
      MERGE (s)-[:PROVIDES]->(e)
      MERGE (f:Fact {id: ${quote(fact.id)}}) SET f += ${quote(fact)}
      MERGE (e)-[:SUPPORTS]->(f)
      MERGE (m:Memory {id: ${quote(memory.id)}}) SET m += ${quote(memory)}, m.status = coalesce(m.status, 'active')
      MERGE (f)-[:DERIVES]->(m)
      MERGE (e)-[:SUPPORTS]->(m)`)
  }

  async recordAgentRun(run: AgentRun, contextMemoryIds = run.contextMemoryIds ?? run.retrievedMemoryIds): Promise<void> {
    await this.graph.query(`MERGE (r:AgentRun {id: ${quote(run.id)}}) SET r += ${quote({ ...run, contextMemoryIds })}
      WITH r
      UNWIND ${quote(run.retrievedMemoryIds)} AS memoryId
      MATCH (m:Memory {id: memoryId})
      MERGE (r)-[:RETRIEVED]->(m)
      FOREACH (contextId IN ${quote(contextMemoryIds)} |
        FOREACH (contextMemory IN CASE WHEN contextId = memoryId THEN [m] ELSE [] END |
          MERGE (r)-[:CONTEXT]->(contextMemory)))`)
  }

  async recordProposedAction(action: ProposedAction, runId?: string): Promise<void> {
    await this.graph.query(`MERGE (a:ProposedAction {id: ${quote(action.id)}}) SET a += ${quote(action)}
      WITH a
      UNWIND ${quote(action.memoryIds)} AS memoryId
      MATCH (m:Memory {id: memoryId})
      MERGE (a)-[:DEPENDS_ON]->(m)
      ${runId ? `WITH a MATCH (r:AgentRun {id: ${quote(runId)}}) MERGE (r)-[:PROPOSES]->(a)` : ""}`)
  }

  async retrieveRelevant(query: string, limit = 10): Promise<RetrievedMemory[]> {
    const result = await this.graph.roQuery<Record<string, unknown>>(`MATCH (m:Memory)
      WHERE m.status = 'active' AND (toLower(m.content) CONTAINS toLower(${quote(query)}))
      RETURN m ORDER BY m.updatedAt DESC LIMIT ${Math.max(1, Math.floor(limit))}`)
    return (result.data ?? []).map((row) => {
      const memory = (row.m ?? row) as DerivedMemory & { status?: MemoryStatus }
      return { ...memory, status: memory.status ?? "active", persistent: true }
    })
  }

  async getRunContext(runId: string): Promise<{ run: AgentRun; retrievedMemoryIds: string[]; contextMemoryIds: string[] }> {
    const result = await this.graph.roQuery<Record<string, unknown>>(`MATCH (r:AgentRun {id: ${quote(runId)}})
      OPTIONAL MATCH (r)-[:RETRIEVED]->(m:Memory)
      OPTIONAL MATCH (r)-[:CONTEXT]->(c:Memory)
      RETURN r, collect(DISTINCT m.id) AS retrievedMemoryIds, collect(DISTINCT c.id) AS contextMemoryIds`)
    const row = result.data?.[0]
    if (!row) throw new Error(`Agent run not found: ${runId}`)
    return { run: row.r as AgentRun, retrievedMemoryIds: (row.retrievedMemoryIds ?? []) as string[], contextMemoryIds: (row.contextMemoryIds ?? []) as string[] }
  }
}

export const createFalkorDBMemoryStore = FalkorDBMemoryStore.connect

export type GraphNode = Source | Evidence | Fact | DerivedMemory | AgentRun | ProposedAction
export type GraphEdge = "PROVIDES" | "SUPPORTS" | "DERIVES" | "RETRIEVED" | "CONTEXT" | "DEPENDS_ON" | "PROPOSES"

void ({} as GraphNode)
void ({} as GraphEdge)
