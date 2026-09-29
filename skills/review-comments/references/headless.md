# Non-interactive / headless mode

Headless mode is on when `CATALYST_PHASE` is set or `--headless` is passed. It is safe for `claude --bg` workers, which have no stdin.

- **Addressable findings** (code change requested, clear fix): address in code and resolve the thread via the `resolveReviewThread` mutation, as in interactive mode.
- **Deferred findings** (bot-authored, non-judgment-call P2/P3): same in both modes. File the follow-up ticket, reply, resolve the thread (`references/deferring.md`).
- **Disagreement / judgment-call findings:** skip the `Post this reply? [y/N]` prompt. Leave the thread unresolved and append a structured record to the ticket's worker directory under the orchestrator dir:
  `${CATALYST_ORCHESTRATOR_DIR:-${ORCH_DIR:-.}}/workers/${CATALYST_TICKET:-unknown}/.review-escalations.jsonl`:
  ```json
  { "prNumber": 42, "threadId": "T1", "path": "a.ts", "line": 5, "finding": "…", "why": "…" }
  ```
  Resolve `CATALYST_ORCHESTRATOR_DIR` first: a `claude --bg` worker receives that variable, not `ORCH_DIR`, and keying off `ORCH_DIR` alone writes the record into the worktree instead of the shared orchestrator dir. The file is a durable record for manual triage; nothing reads it automatically.

With neither `CATALYST_PHASE` nor `--headless`, the interactive `[y/N]` prompt applies.
