---
name: ticket-oneshot
description: Carry one CTC ticket from research through a draft PR in one session, or resume after a stage-boundary handoff. Use for an off-platform one-session ticket run; the skill writes stage artifacts and markers for a separate consumer.
---

# Ticket one-shot

Run in the ticket's isolated code worktree. Resolve this skill's directory as `SKILL_DIR`; all commands below name files inside it. Set `CATALYST_TICKET` to the ticket id and `CATALYST_ARTIFACT_DIR` to a durable per-ticket directory. Set `CATALYST_REPOSITORY` to the repository name when `package.json` does not declare one, so handoffs appear in repository-scoped searches. Refuse a missing input. Read the ticket and `stages.json` before starting.

## Start or resume

1. On a new run, use `node "$SKILL_DIR/scripts/stage" next`. On `--resume`, find the newest ticket handoff with `node "$SKILL_DIR/scripts/thoughts" latest "$CATALYST_TICKET" handoff`. If the artifact directory has no handoff, pass its path to `stage next --resume --handoff <path>`. Read the handoff and the latest finished docs. Keep completed docs and commits intact.
2. The returned stage is the first unfinished one. If it says `complete`, report the existing draft PR. Never restart a completed stage to fill time.
3. For each stage, call `stage start <stage>`. On a resumed run, use `stage start <stage> --resume` to keep an open attempt and its original start marker; after a failed attempt this starts the next attempt. Read that row's sub-skill `SKILL.md` by path from the installed skills bundle, then follow its work procedure for this ticket. Resolve a sibling skill from the directory containing this skill; if it is absent, locate the installed skill by name and verify its `SKILL.md` exists. The ticket and this invocation authorize the stage, so skip a sub-skill's routine proceed prompt. Its terminal stop instruction ends that stage, then this loop continues. File a real decision as an ask instead of waiting for an answer. Do not rely on a Claude-only slash invocation.

## Stage loop

| Stage | Required artifact in `$CATALYST_ARTIFACT_DIR` | Before `stage done` |
| --- | --- | --- |
| research | `research.md` | Run `scripts/verify-research "$CATALYST_ARTIFACT_DIR/research.md"`. |
| plan | `plan.md` | Copy the `create-plan` output into the artifact directory, add `## Files in scope` with the real changed paths, then run `scripts/verify-plan "$CATALYST_ARTIFACT_DIR/plan.md"`. The template's `## Phase 1` and `## Testing Strategy (TDD)` headings are accepted. |
| implement | `implement.md` (written by the runner) | Make the change and run the repository's full gate. The runner commits, pushes and writes `implement.md` after the done marker, so do not write it yourself. |
| validate | `validation.md` | Run `validate-plan`, type-safety and independent code/security review. Copy the report into the artifact directory, add `source_ticket` and `repository` frontmatter, keep its `catalyst-validation-ladder` verdict, add a resolved file:line reference, and run `scripts/verify-validation "$CATALYST_ARTIFACT_DIR/validation.md"`. Repair real findings, at most two rounds. |
| pr | `pr.md` | Push the branch and open or update a draft PR with the real description and ticket link. Record its URL and head SHA. |

After the artifact and gate exist, call `node "$SKILL_DIR/scripts/stage" done <stage>`. The helper checks document stages, writes the `phase.<stage>.complete` marker, then refreshes `handoff.md`. Persist the handoff and finished docs through the available thoughts publisher before starting the next stage. A runner writes `implement.md` after the done marker, so `stage done implement` does not require that file to exist. The helper writes only into the artifact directory; the runner or seat bridge owns publication, receipts, card moves and comments.

If a stage fails, call `stage fail <stage> --reason <text> --class code|environment|scope|question`. File a real question through the ticket system, write `stage wait answer --key <ask-id> --deadline <ISO time>`, and end with the handoff. Do not hold a session waiting for CI, review or an answer.

The PR is a draft at the end of this skill. CI, independent review, ready state and merge are owned by the outer ticket workflow. The first useful push may open the draft earlier; update that same PR at the PR stage. Never publish `relay.phase.completed` yourself: it is the cloud's receipt acceptance after verification.
