---
name: ticket-retro
description:
  "Cross-ticket retrospective VIEW (compound engineering Loop C). **ALWAYS use when** a ticket's PR
  has merged and merge-pr's post-merge deploy-verification has resolved a terminal sentinel for it
  (the workflow's compound closing step; see the `compound-estimate` skill's
  `references/trigger.md`), or when the user says 'ticket retro', 'run a retro', 'retrospective',
  'what did we learn lately', or 'how are the estimates calibrating'. Synthesizes what the compound
  loops captured since the last retro (friction logs, learnings, compound-log calibration,
  catalyst.db and merged-PR actuals) into thoughts/shared/retros/ticket/<date>.md with a persisted
  watch-items block, and surfaces top patterns in the morning briefing's Plan today."
allowed-tools: Bash, Read, Write, Grep, Glob
---

# Ticket Retro

A human-readable reflection across a set of tickets. It reads what `ticket-compound` (friction logs, learnings) and `compound-estimate` (compound-log) captured and writes one retro document. The `merge-pr` skill's compound closing ritual (its `references/post-merge.md`) runs it last, after those two, so this merge's learning is already in the store. There it is best-effort: a retro failure never blocks a merge.

**Read-only view (hard contract):**
- The ONLY file this skill writes is `thoughts/shared/retros/ticket/<YYYY-MM-DD>.md`. Curating learnings, `thoughts/shared/CONCEPTS.md` and ADRs belongs to `ticket-compound`; it makes no Linear or corpus writes. **Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.
- Every input store degrades to `_none_`; empty stores are the normal early state.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Invocation

```text
ticket-retro skill, no arguments               # since-last-retro (default scope)
ticket-retro skill with: --since 2026-06-01    # explicit window floor
ticket-retro skill with: --tickets ENG-1,ENG-2 # explicit ticket set (all time)
```

The default window starts at the most recent retro in `thoughts/shared/retros/ticket/`, with no time box; the first retro ever covers 14 days.

## Step 1: Gather

All reads go through the gather helper, which returns one JSON document (the script header has the full shape):

```bash
GATHER="${CLAUDE_SKILL_DIR}/scripts/ticket-retro/gather-retro.sh"
RETRO_JSON=$(mktemp)
bash "$GATHER" --thoughts-dir thoughts "$@" > "$RETRO_JSON"
jq '{window, prior_retro: (.prior_retro != null), friction: (.friction|length),
     learnings: (.learnings|length), calibration: (.calibration.entries // 0),
     merged_prs: (.merged_prs|length), db_stats: (.db_stats|length)}' "$RETRO_JSON"
```

Keys: `window`, `prior_retro.watch_items` (the last retro's watch items), `friction[]`, `learnings[]`, `calibration` (from `compound-log.sh aggregate`), `merged_prs[]` and `db_stats[]`. `db_stats` covers only the few orchestrator-run tickets with metrics rows, so use `merged_prs[].additions/deletions` for the aggregate stats and show db cost and hours as a bonus column where present.

## Step 2: Synthesize

1. **What we did:** group `merged_prs` by ticket, one line each. Failed or abandoned tickets that appear in friction but not in `merged_prs` belong here too.
2. **Recurring friction patterns:** cluster `friction[].line` entries describing the same underlying problem (same component and failure shape, whatever the wording). A pattern needs at least 2 records; list a one-off only when severe. Each pattern gets a name, its records (`ticket·phase`) and one sentence of synthesis.
3. **Watch-item recurrence:** for each `prior_retro.watch_items[]`, give a verdict: `recurred` (cite evidence), `quiet`, or `resolved` (cite the learning, ADR or fix).
4. **Estimation calibration:** count, exact, mean signed delta and median absolute delta, plus a per-ticket start → actual table. At `calibration.entries == 0`, render `_none_` and note the log fills once the post-merge deploy-verification signal resolves (see the `compound-estimate` skill's `references/trigger.md`).
5. **Next watch items:** carry forward unresolved prior items with their `first_seen`, add new patterns worth tracking, and cap the list at about 7.

## Step 3: Write the retro document

Write it from the template in `references/retro-document.md`, which also holds the watch-items contract the next retro and the morning briefing parse. If today's file exists, overwrite it: the gather floor skips today's retro, so a same-day re-run covers the whole window plus whatever just merged.

## Step 4: Sync and report

```bash
humanlayer thoughts sync 2>/dev/null || true
echo "ticket-retro: wrote thoughts/shared/retros/ticket/$(date -u +%Y-%m-%d).md"
```

Report the retro path, the top 3 recurring patterns, the calibration one-liner, and any recurred watch items. The next morning briefing surfaces the watch items under `Plan today → Retro signals`.
