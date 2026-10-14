import json
import os
import re
from dataclasses import dataclass, field

from dotenv import load_dotenv


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 6379
    password: str | None = None
    graph_prefix: str = "rewind_"
    identities: dict = field(default_factory=dict)
    cors_origins: list[str] = field(default_factory=list)
    enable_demo: bool = False
    model_key: str = ""
    model_name: str = ""
    model_base_url: str = "https://api.openai.com/v1"
    max_steps: int = 10
    agent_provider: str = "openai"
    codex_command: str = "codex"
    codex_timeout: int = 120

    @property
    def model_configured(self):
        if self.agent_provider == "codex_cli":
            from .codex_cli import executable
            return bool(executable(self))
        return bool(self.model_key and self.model_name)

    @property
    def agent_model(self):
        return self.model_name or ("codex-cli-default" if self.agent_provider == "codex_cli" else "")

    @classmethod
    def from_env(cls):
        load_dotenv()
        identities = json.loads(os.getenv("REWIND_IDENTITIES", "{}"))
        prefix = os.getenv("REWIND_GRAPH_PREFIX", "rewind_")
        provider = os.getenv("AGENT_PROVIDER", "openai")
        if provider not in {"openai", "codex_cli"}:
            raise ValueError("AGENT_PROVIDER must be openai or codex_cli")
        for identity in identities.values():
            if not re.fullmatch(r"[a-zA-Z0-9_]{1,48}", identity["tenant"]):
                raise ValueError("Invalid configured tenant")
            if identity["role"] not in {"operator", "planner", "executor", "viewer"}:
                raise ValueError("Invalid configured role")
        if not re.fullmatch(r"[a-zA-Z0-9_]{1,40}", prefix):
            raise ValueError("Invalid graph prefix")
        return cls(
            host=os.getenv("FALKORDB_HOST", "127.0.0.1"),
            port=int(os.getenv("FALKORDB_PORT", "6379")),
            password=os.getenv("FALKORDB_PASSWORD") or None,
            graph_prefix=prefix,
            identities=identities,
            cors_origins=[x.strip() for x in os.getenv("REWIND_CORS_ORIGINS", "").split(",") if x.strip()],
            enable_demo=os.getenv("REWIND_ENABLE_DEMO", "false").lower() == "true",
            model_key=os.getenv("MODEL_API_KEY") or os.getenv("OPENAI_API_KEY", ""),
            model_name=os.getenv("MODEL_NAME", ""),
            model_base_url=os.getenv("MODEL_BASE_URL", "https://api.openai.com/v1"),
            max_steps=int(os.getenv("AGENT_MAX_STEPS", "10")),
            agent_provider=provider,
            codex_command=os.getenv("CODEX_COMMAND", "codex"),
            codex_timeout=int(os.getenv("CODEX_TIMEOUT_SECONDS", "120")),
        )

