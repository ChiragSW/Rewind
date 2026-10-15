"""Root forwarder to backend/scripts/api_demo.py"""
import pathlib
import subprocess
import sys

backend_script = pathlib.Path(__file__).resolve().parents[1] / "backend" / "scripts" / "api_demo.py"
sys.exit(subprocess.call([sys.executable, str(backend_script)] + sys.argv[1:], cwd=backend_script.parents[1]))
