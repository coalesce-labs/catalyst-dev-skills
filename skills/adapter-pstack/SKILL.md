---
name: adapter-pstack
description: Run one CTC ticket through pstack poteto-mode while writing Catalyst one-shot artifacts, stage markers and handoffs. Use for a pstack-oneshot trial or a selected pstack one-session playbook.
---

# Pstack one-shot adapter

Run in the ticket's isolated code worktree. Set `CATALYST_TICKET`, `CATALYST_ARTIFACT_DIR` and `CATALYST_REPOSITORY`, then read the ticket and this skill's `stages.json`. Resolve this skill's directory as `ADAPTER_DIR`. If its path is unknown, stop with `skill_dir_unresolved`.

Resolve the installed `ticket-oneshot` skill by name as `ONESHOT_SKILL_DIR` and confirm its `SKILL.md`, `stages.json` and `scripts/stage` exist. Resolve the pinned pstack Codex port as `PSTACK_ROOT`, defaulting to `~/plugins/pstack`. Check `UPSTREAM.json` for version `0.15.2` and commit `c1c0a32802223f4be824112dd83d33ad29a8b26c`, then read `references/codex-compatibility.md` and `skills/poteto-mode/SKILL.md` there. Stop if the installed version or paths differ; record the drift before continuing.

## Start or resume

1. Run `node "$ONESHOT_SKILL_DIR/scripts/stage" next`. On a cold resume, follow `ticket-oneshot`'s handoff lookup and `stage next --resume` procedure. Read the latest finished documents and preserve their contents and commits. The returned stage is the first unfinished row in `stages.json`.
2. Give `poteto-mode` the ticket and this adapter as its governing task. Use the named pstack playbook in the current row. Read pstack skills by file path, including skills marked `disable-model-invocation`. Keep its model roles on the active session model unless the ticket explicitly tests model choice. Do not use Cursor transcript `recall` or `reflect`; search the ticket's thoughts and handoff instead. Name any unavailable pstack skill and why it was skipped.
3. At each row, run `node "$ONESHOT_SKILL_DIR/scripts/stage" start <stage>` before work. On a resumed open attempt, add `--resume`. Write the row's artifact directly under `$CATALYST_ARTIFACT_DIR` with `source_ticket` and `repository` frontmatter where the document verifier requires it. The runner or seat bridge publishes thoughts; the session does not write to the thoughts repository.
4. Run the row's verifier or repository gate, then `node "$ONESHOT_SKILL_DIR/scripts/stage" done <stage>`. The helper writes `phase.<stage>.complete` in an ordered marker and refreshes `handoff.md`. Publish the handoff and finished document through the available thoughts publisher before the next row. Never publish `relay.phase.completed` yourself.

## Stage boundaries

| Catalyst stage | Pstack work | Required output |
| --- | --- | --- |
| research | Investigate and `how` | `research.md`; run `verify-research`. |
| plan | Feature planning or `multi-phase-plan` | `plan.md` with files in scope; run `verify-plan`. |
| implement | Build under the chosen pstack feature or bug playbook | `implement.md` with committed head, full repository gate command, exit code and result. Open the first useful draft PR early. |
| validate | `show-me-your-work` and Catalyst `validate-plan` | `validation.md` with the five-step verdict ladder; run `verify-validation`. Repair real findings at most twice. |
| pr | Pstack Opening a PR, then Catalyst `describe-pr` | `pr.md` with draft PR URL and current head SHA. The outer ticket workflow owns CI, independent review, ready state and merge. |

The adapter's stage map records the exact output file and thoughts kind for each row. Catalyst's marker and verifier contract wins when a pstack playbook names a different output path or tries to stop for a routine proceed prompt. Use `ask` for a real human decision, call `stage fail <stage> --reason <text> --class question`, write `stage wait answer --key <ask-id> --deadline <ISO time>`, and end with the handoff. Do not wait in the session for CI, review or an answer. On any other failure, call `stage fail` with `code`, `environment` or `scope` and preserve the handoff.
