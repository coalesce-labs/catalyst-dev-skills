# Improvement queue

## Record a finding when you see it

When a phase surfaces friction worth fixing (a bug in adjacent code, a step that should not need manual help, a gap in tooling), record it at once:

```bash
"${CLAUDE_SKILL_DIR}/scripts/add-finding.sh" \
  --title "Short imperative title" \
  --body "Reproduction + expected + observed + any links" \
  --skill implement-plan
```

Findings go to a shared queue: the parent workflow's queue when one runs this skill, otherwise a per-session queue.

## File the queue at the end of the run

Run this block once, after the quality gates. It is a safety net: when a parent workflow runs `implement-plan`, the parent's filing step drains the same queue first and this block finds an empty file.

```bash
FEEDBACK="${CLAUDE_SKILL_DIR}/scripts/file-feedback.sh"
CONSENT="${CLAUDE_SKILL_DIR}/scripts/feedback-consent.sh"
FINDINGS_FILE="${CATALYST_FINDINGS_FILE:-.catalyst/findings/${CATALYST_SESSION_ID:-current}.jsonl}"

if [ -x "$FEEDBACK" ] && [ -f "$FINDINGS_FILE" ] && [ -s "$FINDINGS_FILE" ]; then
  COUNT=$(wc -l < "$FINDINGS_FILE" | tr -d ' ')
  if [ "$("$CONSENT" check)" != "granted" ] && [ -z "${CATALYST_AUTONOMOUS:-}" ] && [ -t 0 ]; then
    read -r -p "File $COUNT improvement tickets now? [Y/n] " yn
    case "$yn" in [Nn]*) : ;; *) "$CONSENT" grant >/dev/null ;; esac
  fi
  if [ "$("$CONSENT" check)" = "granted" ]; then
    FILED=0
    while IFS= read -r line; do
      TITLE=$(jq -r '.title' <<<"$line")
      BODY=$(jq -r '.body' <<<"$line")
      SKILL=$(jq -r '.skill // "implement-plan"' <<<"$line")
      RESULT=$("$FEEDBACK" --title "$TITLE" --body "$BODY" --skill "$SKILL" --json 2>/dev/null || true)
      STATUS=$(jq -r '.status // "failed"' <<<"$RESULT")
      if [ "$STATUS" = "filed" ]; then
        ID=$(jq -r '.identifier // .url // ""' <<<"$RESULT")
        echo "  filed: $ID  ($TITLE)"
        FILED=$((FILED + 1))
      fi
    done < "$FINDINGS_FILE"
    [ "$FILED" -eq "$COUNT" ] && rm -f "$FINDINGS_FILE"
  fi
fi
```

Inside a phase container (`CATALYST_PHASE` set) there is no Linear credential, and when `command -v linearis` fails the filer skips Linear and files through `gh`.
