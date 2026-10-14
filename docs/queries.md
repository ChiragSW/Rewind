# Graph model and executable query shapes

The implementation is in `rewind/graph.py`, `rewind/memory.py`, and `rewind/service.py`. Labels and relationship names come from fixed internal allowlists; user text/IDs are serialized as query parameters. No API accepts raw Cypher or a graph name.

## Current query operations

```cypher
MATCH (n:Record) RETURN n.data LIMIT 10001
```

Canonical record data is parsed by the server, which evaluates current grounded support, admission, conflict, applicability, and expiry. The 10,001st row detects a limit breach instead of silently returning a partial support graph.

```cypher
MATCH (a:Record)-[r]->(b:Record)
RETURN a.id, type(r), b.id, r.data LIMIT 20001
```

```cypher
CYPHER source='src-onboarding-incorrect'
MATCH (s:Record {id:$source})-[:INPUT_TO|SUPPORTS*1..32]->(n:Memory)
RETURN DISTINCT n.id
```

The last query is the real multi-hop repair traversal. For the main fixture it reaches the routing fact, supplier name, historical payment plan, routing procedure, and any actual plans derived by agents. Python then evaluates complete AND/OR support; reachability alone is not guilt or unsupportedness.

Provenance follows incoming SUPPORTS and INPUT_TO edges from the memory. `READ_BY` joins affected memory to Run; `REQUIRED_BY` joins memory revisions to Action. These recorded edges power impact and audit views. Episodes are linked with BELONGS_TO and handoffs with HANDED_OFF_TO.

## Commit operation

GraphStore builds one parameterized statement for each mutation. A representative shape is:

```cypher
CYPHER id0='example' data0='{"id":"example","kind_label":"Source"}'
MERGE (n0:Record {id:$id0}) SET n0:Source, n0.data=$data0
RETURN 1
```

Node mutations, relationship upserts, event insertion, and the sequence update are included in the same write statement where applicable. Dynamic labels/types are internal constants, never request values. The application prevents duplicate IDs/types under its tenant lock. No distributed uniqueness guarantee is asserted.

Multiple repair steps use separate statements. Their recovery boundary is the persisted repairing marker and idempotent baseline, not an assumed multi-query transaction. The test suite deliberately attempts an invalid map property after creating a record and checks that the pinned image leaves no partial created record.

## Important distinction

FalkorDB's GRAPH.QUERY `version` argument manages schema caches. Rewind's `Memory.revision` and `Task.generation` are application data contracts, persisted inside record data and rechecked by the server. They are not interchangeable.

