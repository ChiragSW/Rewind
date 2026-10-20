import hashlib
import json
import re
from datetime import datetime, timezone
from uuid import uuid4

import redis

from .contracts import DomainError

KINDS = {"TenantState", "Source", "Memory", "Justification", "Run", "Episode", "Task", "Action", "Approval", "Repair", "Event", "Receipt"}
RELATIONS = {"INPUT_TO", "SUPPORTS", "READ_BY", "PRODUCED", "BELONGS_TO", "WORKS_ON", "HANDED_OFF_TO", "PROPOSED", "REQUIRED_BY", "APPROVES", "SUPERSEDES", "REVOKES", "HAS_RECEIPT"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def record(label, **data):
    return {"id": data.pop("id", None) or str(uuid4()), "kind_label": label, "created_at": now(), **data}


def edge(source, relation, target, **data):
    return {"source": source, "type": relation, "target": target, "data": data}


class GraphStore:
    def __init__(self, settings):
        self.settings = settings
        self.client = redis.Redis(host=settings.host, port=settings.port, password=settings.password,
                                  decode_responses=True, socket_connect_timeout=3, socket_timeout=15)

    def name(self, tenant):
        if not re.fullmatch(r"[a-zA-Z0-9_]{1,48}", tenant):
            raise DomainError("INVALID_TENANT", "Invalid tenant", 400)
        return self.settings.graph_prefix + tenant

    def query(self, tenant, query, params=None):
        # Parameter values use JSON literals; query syntax contains only fixed internal labels.
        prefix = " ".join(f"{key}={canonical(value)}" for key, value in (params or {}).items())
        statement = f"CYPHER {prefix} {query}" if prefix else query
        result = self.client.execute_command("GRAPH.QUERY", self.name(tenant), statement, "TIMEOUT", 10000)
        return result[1] if len(result) > 1 and isinstance(result[1], list) else []

    def snapshot(self, tenant):
        rows = self.query(tenant, "MATCH (n:Record) RETURN n.data LIMIT 10001")
        if len(rows) > 10000:
            raise DomainError("GRAPH_LIMIT", "Demo graph exceeds 10,000 records", 503)
        nodes = {n["id"]: n for row in rows for n in [json.loads(row[0])]}
        rows = self.query(tenant, "MATCH (a:Record)-[r]->(b:Record) RETURN a.id,type(r),b.id,r.data LIMIT 20001")
        if len(rows) > 20000:
            raise DomainError("GRAPH_LIMIT", "Demo graph exceeds 20,000 relationships", 503)
        return {"nodes": nodes, "edges": [edge(row[0], row[1], row[2], **json.loads(row[3] or "{}")) for row in rows]}

    def commit(self, tenant, nodes, edges=()):
        """One graph write for this mutation, including its audit event and sequence."""
        nodes = {node["id"]: node for node in nodes}.values()
        clauses, params = [], {}
        for i, node in enumerate(nodes):
            kind = node["kind_label"]
            if kind not in KINDS:
                raise ValueError("Unknown internal node label")
            params.update({f"id{i}": node["id"], f"data{i}": canonical(node)})
            clauses.append(f"MERGE (n{i}:Record {{id:$id{i}}}) SET n{i}:{kind}, n{i}.data=$data{i}")
        for i, item in enumerate(edges):
            relation = item["type"]
            if relation not in RELATIONS:
                raise ValueError("Unknown internal relationship")
            params.update({f"a{i}": item["source"], f"b{i}": item["target"], f"e{i}": canonical(item["data"])})
            clauses.append(f"WITH * MATCH (a{i}:Record {{id:$a{i}}}), (b{i}:Record {{id:$b{i}}}) "
                           f"MERGE (a{i})-[r{i}:{relation}]->(b{i}) SET r{i}.data=$e{i}")
        if clauses:
            self.query(tenant, " ".join(clauses) + " RETURN 1", params)

    def descendants(self, tenant, source):
        return {row[0] for row in self.query(tenant,
            "MATCH (s:Record {id:$source})-[:INPUT_TO|SUPPORTS*1..32]->(n:Memory) RETURN DISTINCT n.id", {"source": source})}

    def reset_demo(self, tenant):
        if not self.settings.enable_demo:
            raise DomainError("DEMO_DISABLED", "Demo reset is disabled", 403)
        self.client.execute_command("GRAPH.DELETE", self.name(tenant))
