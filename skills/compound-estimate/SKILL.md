---
name: compound-estimate
description:
  "Closing ritual for the estimation feedback loop: logs a shipped ticket's actuals (starting and
  re-scored estimate, cost, wall time, what worked, what surprised) to
  thoughts/shared/retros/estimate/YYYY-WW-compound-log.md, one file per ISO week. **ALWAYS use
  when** a ticket's PR has merged and merge-pr's post-merge deploy-verification has resolved a
  terminal sentinel for it (the trigger shared with `ticket-retro` and `ticket-compound`, see
  references/trigger.md), or when the user says 'compound-estimate', 'close the estimation loop',
  'record actuals' or 'compound-log'."
disable-model-invocation: false
allowed-tools: Bash(gh *), Bash(catalyst *), Bash(linearis *), Bash(jq *), Bash(git *), Bash(${CLAUDE_SKILL_DIR}/scripts/compound-log.sh *), Read, Write
version: 1.1.0
---

# Compound Estimate — Closing Ritual at PR Merge

Write a compound-log entry for a just-shipped ticket, so its cost and wall time feed future estimates. This skill's `scripts/compound-log.sh` does the mechanical work; you collect the three human-authored inputs and invoke it.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Invocation

```
/compound-estimate <TICKET-ID>
```

`<TICKET-ID>` is required unless it can be detected from the current branch name (`gh pr view --json headRefName` → parse the ticket prefix).

## Load on demand

| when | read |
| -- | -- |
| resolving the ticket, collecting the three inputs, invoking the helper, reporting back | `references/process.md` |
| where `estimate_at_start` and `cost_usd` come from | `references/data-source.md` |
| the opportunistic corpus refresh, flags, entry schema, testing, troubleshooting | `references/corpus-refresh.md` |
| what fires this skill after a merge | `references/trigger.md` |

## Invariants

- **Always ask for the re-score.** `estimate_actual` is the calibration signal, even when the ticket felt routine.
- **It never writes to Linear.** The helper reads the starting estimate with `catalyst query issue <ID>` on a machine connected to a cloud account, else through the replica helper `linear_read_ticket` (an operator off the cloud). See `references/data-source.md`. **Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.
- **A refresh failure never fails the ritual:** the corpus refresh in `references/corpus-refresh.md` is best-effort.

## Output

Appends an entry to `thoughts/shared/retros/estimate/YYYY-WW-compound-log.md` (creating the weekly file if needed). Weeks are ISO-8601, derived from the PR's `mergedAt`, not today's date.

## Related

- Consumers: `compound-log.sh read`/`aggregate` → `refresh-corpus.sh` feeds `estimate_actual` into
  `reference-class-corpus.json`; the `ticket-retro` skill reads the weekly files for the estimation-calibration summary.
