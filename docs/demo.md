# Backend demo and video handoff

Use `scripts/api_demo.py` to drive a running backend. It reads the local operator identity from `.env` and never prints the token. `--mode scripted` is reproducible without provider credentials; `--mode live` uses either the host's signed-in Codex CLI or a configured compatible model API. Its transcript records real REST responses and tool effects.

## Backend-only steps

1. Start database/backend using the README.
2. `uv run python scripts/api_demo.py --mode scripted --reset`
3. Inspect `artifacts/api-demo.json`, graph/events, and `receipt_verified`.
4. For real inference without a model API key, run `scripts/run_codex_backend.py` on the signed-in Codex host, then use `scripts/api_demo.py --mode live --reset --output artifacts/codex-live-demo.json`. An API-key provider is an alternative.
5. The UI team renders these same endpoints; it should not fabricate state transitions.

The fixture is an already-accepted historical mistake. Seeding it is not a demonstrated jailbreak. The wrong proposal remains pending until after revocation, so the demo never commits the wrong fictional payment. A reviewed new source supplies the correction. The server, not the UI, approves, repairs, blocks, and commits.

## Proposed three-minute story

| Time | Show through your UI or API client |
| --- | --- |
| 0:00–0:20 | Wrong accepted source and the product's concrete correction problem |
| 0:20–0:50 | Planner memory reads, supported plan, durable handoff |
| 0:50–1:10 | Fresh executor, separate run ID, old frozen proposal and approval |
| 1:10–1:35 | Revocation preview, actual repair report, multi-hop unsupported plan/procedure |
| 1:35–1:55 | Old execution returns STALE_ACTION; no old receipt exists |
| 1:55–2:15 | Independently supported name and unrelated terms preserved |
| 2:15–2:45 | Reviewed correction, fresh runs, new approval, verified mock receipt |
| 2:45–3:00 | Persistent history, tenant isolation evidence, repo/setup link |

Three minutes is our target, not a verified event limit. Check the submission form.

Codex CLI starts a model process for each decision, so the complete live workflow can take longer than the edited video. Trim idle waits if needed and retain the actual endpoint/tool results and timestamps; do not substitute scripted results for a live recording.

Suggested narration: "One agent learned incorrect routing. A second remembered it in a new session. We revoked the source. Rewind withdrew unsupported memory, kept independent evidence, blocked the stale proposal, and rebuilt the task with reviewed facts. The agents in this recording are [live/scripted]; all company data and payments are simulated."

Do not call scripted tool selection live inference. A separate technical clip can show database restart, recovery tests, actual Cypher, and the evaluation artifact. The final video is the user's deliverable; no video/UI has been generated here.

