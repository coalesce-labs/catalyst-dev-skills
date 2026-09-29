---
name: morning-briefing
description:
  Generate a daily briefing markdown at thoughts/briefings/YYYY-MM-DD.md with six sections —
  Review yesterday, Surface decisions, Plan today, dispatch candidates, Friction since last
  briefing, and Learnings since last briefing — synthesized from Linear, GitHub,
  Granola, Google Drive, Google Calendar, and the compound-engineering stores in parallel. Then
  fans the briefing out to four destinations (Slack DM, Slack channel, Notion page, Loom script
  file). Use when the user says "morning briefing" / "run my briefing", or on a weekday-morning
  schedule via a scheduled routine that wraps this same skill.
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, mcp__linear__*, mcp__notion__*
---

# Morning Briefing — canonical markdown + fan-out

Use this skill to produce today's briefing locally and fan it out to Slack DM, Slack channel, Notion page, and a Loom recording script.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Flags

| Flag | Meaning |
|---|---|
| `--date YYYY-MM-DD` | Target date. Default: today (UTC). |
| `--dry-run` | Write to `/tmp/morning-briefing-<date>.md` instead of `thoughts/briefings/`. |

## Load on demand

| when | read |
| -- | -- |
| gathering yesterday/today from Linear, GitHub, Granola, Drive, Calendar | `references/gather.md` |
| surfacing decisions — ADR drift, blocked PRs, judgment calls, compound proposals | `references/decisions.md` |
| the ADR-drift detector's frontmatter contract, output shape, and config resolution | `references/adr-drift.md` |
| the friction / learnings "since last briefing" digests | `references/digests.md` |
| suggesting which tickets look ready for dispatch | `references/suggest-dispatch.md` |
| rendering the markdown, or fanning it out to Slack/Notion/Loom | `references/render-fanout.md` |
| this host might have no cloud mirror, or a Linear read looks stale | the `steward` skill's cloud-detection reference (canonical) |

## Loop

1. **Prelude** — start a session, resolve the output path for `$DATE`.
2. **Gather** — five sources in parallel, each degrading silently to `{}` if its credentials are absent (`references/gather.md`).
3. **Decisions + digests** — ADR drift, blocked PRs, judgment calls, compound proposals, friction/learnings windows (`references/decisions.md`, `references/digests.md`).
4. **Suggest dispatch candidates** — tickets that look ready for a ticket-worker session (`references/suggest-dispatch.md`).
5. **Render + fan out** — merge fragments, render the markdown, append the digests, fan out, and end the session (`references/render-fanout.md` — this is the last step; do not end the session again after it).

## Invariants

- **Linear reads go through `catalyst query` when the machine is connected to a cloud account**: `catalyst query issue <ID>` for one ticket, `catalyst query issues --team K --state S` and `catalyst query search <terms>` for this skill's usual list and search shape. Off the cloud, `linearis` is the path for lists and searches, per the `linearis-cli` skill. **Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.
- **"Suggest dispatch candidates" names candidates for a ticket-worker session** (the dispatch verb the `steward` skill's `references/dispatch.md` describes), never a background-dispatch daemon.
- Every gather/fan-out helper degrades to an empty or skipped result rather than failing the whole run — the briefing always lands locally.

## Output contract

YAML frontmatter validated against the briefing frontmatter schema this skill carries (`assets/templates/briefing-frontmatter.schema.json`) (required: `date`, `generated_by`, `decisions`; optional `output_status`). Six `## ...` body sections: the four `render.sh` owns (Review yesterday, Surface decisions, Plan today, and the dispatch-candidates section, whose heading `render.sh` writes as `## Suggest orchestrator runs` — `references/suggest-dispatch.md`) plus the two compound digests. `Plan today` carries a `### Retro signals` sub-section. Empty render sources render `_no data_`; empty compound stores render `_none_`. A companion `<date>-loom-script.md` lands beside the briefing whenever the loom fan-out runs (always — it has no credential prerequisite).

Pending compound-engineering ADR proposals (`thoughts/shared/compound/pending/*.md`) surface as `decisions:` entries so `briefing-followup`'s `action-compound.sh` can apply/edit/defer/reject them — the human-gated ADR approval surface.

## Pointers

`briefing-followup` (consumes this skill's output) · `linearis-cli` · `steward` (the dispatch model "suggest dispatch candidates" points at) · `ticket-retro`.
