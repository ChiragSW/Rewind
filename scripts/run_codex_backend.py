"""Run the API on the signed-in Codex host; FalkorDB can stay in Docker."""
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ["AGENT_PROVIDER"] = "codex_cli"

from rewind.codex_cli import executable
from rewind.config import Settings


if __name__ == "__main__":
    if not executable(Settings.from_env()):
        raise SystemExit("Codex CLI is unavailable. Install it or set CODEX_COMMAND, then run codex login.")
    import uvicorn
    uvicorn.run("rewind.app:app", host="127.0.0.1", port=8000, workers=1)
