from uuid import uuid4

import pytest

from rewind.config import Settings
from rewind.graph import GraphStore
from rewind.service import Rewind


@pytest.fixture
def settings():
    return Settings(graph_prefix="rewind_test_" + uuid4().hex[:12] + "_", enable_demo=True,
                    identities={"test-operator": {"tenant": "a", "role": "operator"},
                                "test-planner": {"tenant": "a", "role": "planner"},
                                "test-executor": {"tenant": "a", "role": "executor"},
                                "test-viewer": {"tenant": "a", "role": "viewer"},
                                "test-other": {"tenant": "b", "role": "operator"}})


@pytest.fixture
def service(settings):
    store = GraphStore(settings)
    assert store.client.ping(), "Start FalkorDB before running this integration suite"
    svc = Rewind(store)
    yield svc
    # Only uniquely named test graphs created by this fixture are removed.
    for tenant in ("a", "b"):
        name = store.name(tenant)
        if name in store.client.execute_command("GRAPH.LIST"):
            store.client.execute_command("GRAPH.DELETE", name)

