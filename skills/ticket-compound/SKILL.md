---
name: ticket-compound
description:
  Compound-engineering capture for a finished ticket. Turns the phase agents' Friction sections and
  the git diff into one entry in the shared learnings store (thoughts/shared/learnings/), curates
  stale notes there, adds new vocabulary to thoughts/shared/CONCEPTS.md, and proposes ADR changes
  for human approval. **Trigger:** invoke once merge-pr's post-merge deploy-verification resolves a
  terminal sentinel for the ticket's merge, the signal `compound-estimate` and `ticket-retro` share
  (see the `compound-estimate` skill's `references/trigger.md`). Also use when the user says
  "compound this ticket", "capture learnings", "what did we learn", or names a ticket to compound
  (<TICKET> [mode:headless]).
disable-model-invocation: false
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, AskUserQuestion
---

# ticket-compound

Capture what a ticket taught into the shared store (`thoughts/` and ADRs), so future agents on any machine decide better. Read `reference.md` (this dir) for the learnings-store schema before writing anything. Failed and abandoned tickets count too: what didn't work is high-signal. Estimation numbers belong to `compound-estimate`, and the cross-ticket view to `ticket-retro`; the automatic call site is the `merge-pr` skill's compound closing ritual (its `references/post-merge.md`).

**Two authority levels (hard rule):**
- **Autonomous:** write, update or delete in `thoughts/shared/learnings/` and `thoughts/shared/CONCEPTS.md`, and prune stale notes in `thoughts/shared/{research,plans}/`.
- **Propose only (APPROVE-gated):** any change to `docs/adrs.md`, queued for the morning ritual.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Invocation: `ticket-compound skill with: <TICKET> [mode:headless]`

- `<TICKET>`: the Linear key (e.g. `ENG-123`); when omitted, detect it from the branch or `CATALYST_TICKET`.
- `mode:headless`: apply every unambiguous autonomous action silently, mark ambiguous learnings `status: stale`, never wait on a prompt, and end with the sentinel line. The morning ritual and the post-merge closing ritual use it; the default is interactive.

## Step 1: Gather raw signal (you read; nobody else writes)

1. **Friction:** `thoughts/shared/friction/<TICKET>.md` (the per-phase friction log, primary source), every `## Friction` / `friction:` block in `thoughts/shared/{research,plans}/*<TICKET>*.md`, and any worker signal files at `~/catalyst/workers/<TICKET>/*.json`.
2. **The diff:** `git log --oneline origin/main..HEAD` and `git diff --stat origin/main..HEAD` (or the merged SHA once the PR has merged).
3. **The ticket** (title, description, final state, estimate): on a cloud account, `catalyst query issue <ID>` (the Cloud pack's `catalyst-linear` skill); an operator off the cloud reads the replica by direct SQL, per the `linearis-cli` skill's "Reading Linear" section. **Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.
4. **Event trail** (optional): the ticket's lines in `<events dir>/YYYY-MM.jsonl`, where the events dir is `CATALYST_EVENTS_DIR`, else `paths.events` in `~/.config/catalyst/paths.json`, else `~/.local/state/catalyst/events`. Older history may still sit in `~/catalyst/events` until housekeeping migrates it.

## Step 2: Three text-only subagents, in parallel

Each returns text, and you make the single write in Step 3, so no two writers race:

- **Context Analyzer:** from the diff, ticket and friction, pick the track (bug or knowledge), `problem_type`, `category` (subdir), `component`, `severity` and a filename slug. Returns the frontmatter skeleton, valid per `reference.md`.
- **Solution Extractor:** writes the entry body in the track's section order from `reference.md`, grounding every claim in the diff or friction.
- **Related-Learnings Finder:** `rg -li "<keywords>" thoughts/shared/learnings/**/*.md`, reads the hits' frontmatter, and scores overlap on problem, root cause, component, files and prevention. Returns HIGH (4–5), MODERATE (2–3) or LOW (0–1) with the matched paths.

## Step 3: Write one learnings entry

On HIGH overlap, merge the new detail into the existing entry and set `last_updated:`. On MODERATE or LOW, create `thoughts/shared/learnings/<category>/<slug>.md`. Then validate the frontmatter, which fails loud on the YAML traps in `reference.md`:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/compound/validate-learnings.sh" "<written-path>"
```

## Step 4: Curate the store

Classify each related entry the Finder surfaced, and each stale note in `thoughts/shared/{research,plans}/` this ticket contradicted, then act:

| Outcome | When | Action |
|---|---|---|
| Keep | accurate, refs valid | none |
| Update | core correct, refs/paths drifted | targeted in-place edit |
| Consolidate | 2+ heavily overlap, both correct | merge into the canonical, delete the subsumed |
| Replace | core guidance now misleading | write successor, delete old |
| Delete | implementation gone AND domain gone AND no inbound links | remove (git history preserves) |

In `mode:headless`, act only on unambiguous cases; mark the rest `status: stale` with a `stale_reason`.

## Step 5: Vocabulary

Append a concise definition for each Catalyst domain term in the diff or friction that `thoughts/shared/CONCEPTS.md` lacks (e.g. "reclaim", "revive-budget", "orphan"). Create the file if absent.

## Steps 6–7: ADR proposals and discoverability

6. When a learning rises to a standing rule every agent must follow, leave `docs/adrs.md` alone and queue a proposal in the format `references/closing.md` gives.
7. Confirm `CLAUDE.md` tells agents the learnings store exists, its shape, and when to grep it. If not, propose (interactive) or apply (headless) the pointer in `references/closing.md`, never the learnings themselves.

## Step 8: Report

Interactive: report the entry written or updated, the curation actions, CONCEPTS additions, and any queued ADR proposals with the approval command. Headless: print the structured block in `references/closing.md`, ending with the sentinel line.
