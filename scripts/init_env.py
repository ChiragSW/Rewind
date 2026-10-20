"""Root forwarder to backend/scripts/init_env.py"""
import pathlib
import subprocess
import sys

backend_script = pathlib.Path(__file__).resolve().parents[1] / "backend" / "scripts" / "init_env.py"
sys.exit(subprocess.call([sys.executable, str(backend_script)] + sys.argv[1:]))
