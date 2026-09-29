# Session tracking

Session tracking uses the installed `catalyst-session` CLI when this host has one, and is skipped otherwise.

At the start, after the discovery block has set `TICKET_ID`:

```bash
# Session tracking uses the installed catalyst-session CLI when this host has one; skipped otherwise.
SESSION_SCRIPT="$(command -v catalyst-session 2>/dev/null || true)"
if [[ -n "$SESSION_SCRIPT" ]]; then
  CATALYST_SESSION_ID=$("$SESSION_SCRIPT" start --skill "create-plan" \
    --ticket "${TICKET_ID:-}" \
    --workflow "${CATALYST_SESSION_ID:-}")
  export CATALYST_SESSION_ID
  "$SESSION_SCRIPT" phase "$CATALYST_SESSION_ID" "planning" --phase 1
fi
```

When the person approves the plan:

```bash
if [[ -n "${CATALYST_SESSION_ID:-}" && -x "$SESSION_SCRIPT" ]]; then
  "$SESSION_SCRIPT" end "$CATALYST_SESSION_ID" --status done
fi
```
