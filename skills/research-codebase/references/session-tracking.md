# Session tracking

Session tracking uses the installed `catalyst-session` CLI when this host has one, and is skipped otherwise.

At the start:

```bash
# Session tracking uses the installed catalyst-session CLI when this host has one; skipped otherwise.
SESSION_SCRIPT="$(command -v catalyst-session 2>/dev/null || true)"
if [[ -n "$SESSION_SCRIPT" ]]; then
  CATALYST_SESSION_ID=$("$SESSION_SCRIPT" start --skill "research-codebase" \
    --ticket "${TICKET_ID:-}" \
    --workflow "${CATALYST_SESSION_ID:-}")
  export CATALYST_SESSION_ID
fi
```

After spawning the research agents:

```bash
if [[ -n "${CATALYST_SESSION_ID:-}" && -x "$SESSION_SCRIPT" ]]; then
  "$SESSION_SCRIPT" phase "$CATALYST_SESSION_ID" "researching" --phase 1
fi
```

After presenting the summary:

```bash
if [[ -n "${CATALYST_SESSION_ID:-}" && -x "$SESSION_SCRIPT" ]]; then
  "$SESSION_SCRIPT" end "$CATALYST_SESSION_ID" --status done
fi
```
