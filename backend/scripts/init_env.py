"""Generate private local identities; never overwrite an existing .env."""
import json
import pathlib
import secrets

root = pathlib.Path(__file__).resolve().parents[1]
target = root / ".env"
if target.exists():
    print("Existing .env retained")
else:
    identities = {secrets.token_urlsafe(32): {"tenant": tenant, "role": role}
                  for tenant, role in [("tenant_a", "operator"), ("tenant_a", "planner"), ("tenant_a", "executor"),
                                       ("tenant_b", "operator")]}
    text = (root / ".env.example").read_text(encoding="utf-8").splitlines()
    text = ["REWIND_IDENTITIES=" + json.dumps(identities) if line.startswith("REWIND_IDENTITIES=") else line for line in text]
    target.write_text("\n".join(text) + "\n", encoding="utf-8")
    print("Created private .env. Add MODEL_API_KEY and MODEL_NAME for live agents.")
