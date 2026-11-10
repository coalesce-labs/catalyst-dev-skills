---
name: ticket-oneshot
description: Carry one ticket from research to a reviewed draft PR in one session, as the coordinator that starts each stage and checks its result, or resume after a handoff. Use when asked to run a ticket end to end, one-shot a ticket, or resume a one-shot run.
---

# Ticket one-shot

You are the coordinator. You start each stage, read what it produced, and decide what happens next. The stage work belongs to the stage skills; keep your own context for the decisions.

## Inputs

These are environment variables. The runner or launcher sets them before the session starts. Check them first with `printenv` and stop if one is missing. When you start a run by hand, set them in the environment that launches the agent: an `export` inside one shell command does not carry over to the next.

- `CATALYST_TICKET`: the ticket id.
- `CATALYST_ARTIFACT_DIR`: a durable directory for this ticket, outside the checkout.
- `CATALYST_REPOSITORY`: the repository name, when `package.json` does not declare one.
- `SKILL_DIR`: this skill's directory, where every script below lives. It is the one value you may fill in yourself: when it is unset, use the full path of the directory holding this file in each command.

Work in the ticket's own worktree, on the ticket's branch. Read the ticket and `stages.json`.

## Stages

| Stage | Skill | Input | Writes to thoughts | Artifact in `$CATALYST_ARTIFACT_DIR` |
|--|--|--|--|--|
| research | `research-codebase` | the ticket | `thoughts/shared/research/` | `research.md` |
| plan | `create-plan` | research.md | `thoughts/shared/plans/` | `plan.md` |
| implement | `implement-plan` | plan.md | nothing | `implement.md` (the runner writes it when there is one) |
| validate | `validate-plan` | the ticket, plan.md | `thoughts/shared/validations/` | `validation.md` |
| pr | `describe-pr` | the branch | `thoughts/shared/prs/` | `pr.md` |
| review | `review-and-verify` | the PR at its head, plan.md | nothing | `review-result.json` |

## The loop

1. Run `node "$SKILL_DIR/scripts/stage" next`. On a resume, pass `--resume`, and `--handoff <path>` when the handoff lives outside the artifact directory. It prints the first unfinished stage, or `complete`.
2. Run `stage start <stage>`. This records the `phase.<stage>.started` event.
3. Hand the stage to its skill with its input named by path, never found by search. Use a subagent with a fresh context when the harness has them, and wait for it in the foreground (a headless session can stop background work it is still running), else read the skill's `SKILL.md` and follow it here. Run the review stage on a different model family when one is available (for example `codex exec` with the review-and-verify skill), else in a fresh subagent; record which in `review-result.json`.
4. Copy the stage's thoughts document to its artifact name and run `humanlayer thoughts sync`.
5. Read the artifact yourself and judge it against the ticket:
   - Good: run `stage done <stage>`. This checks the artifact, records `phase.<stage>.complete` and refreshes `handoff.md`.
   - Fixable: run `stage fail <stage> --reason <what to change> --class code`, then `stage start <stage>` again and hand the stage that one specific note. Each stage gets two attempts; the script refuses a third. An `environment` failure does not use one up. Under a phase runner (`CATALYST_PHASE` set) the runner decides retries and the script sets no limit.
   - Not fixable here: run `stage fail <stage> --reason <text> --class environment|scope|question`, which records `phase.<stage>.failed`, and stop.
6. Repeat until `stage next` prints `complete`. Report the PR, its head and the review result. Under a phase runner (`CATALYST_PHASE` set) the stage list ends at `pr`, so `stage next` prints `complete` after it, because the runner runs its own review jobs and there is no review stage to start.

## Rules

- implement is done only when `stage done implement` accepts it. That command reads the record `stage check` wrote for this exact tree, and refuses unless the check is green or every failing test also fails on the base. Run `node "$SKILL_DIR/scripts/stage" check` yourself, after the implement subagent returns, using the harness's background option on the command itself with the longest timeout it allows (two hours, 7200000 ms, in Claude Code), and waiting for it, because the check can run for an hour. A background command with no timeout is stopped after ten minutes. Tell the subagent to run the fast checks that cover its change and leave the full check to you: a headless session ends when its own turn ends, and kills any background command a subagent started. If the check is red and the change caused it, hand the failing tests to the implement subagent and run the check again; this is the same attempt. If it is red and the change did not cause it, run `stage check --base`, which proves it or says what is left. With nothing left to try, `stage fail implement --class environment` and stop. The check command is `CATALYST_CHECK_COMMAND`, else the repository's `check` script. The runner, when there is one (`CATALYST_PHASE` is set), holds this gate itself, commits and pushes after `stage done implement`; with no runner, commit and push the branch yourself.
- validate asks whether we built what was asked and carried out the plan. Tell it this workflow has its own review stage, so it leaves code and security review to that stage. `stage done validate` refuses unless the report accounts for every plan criterion under `## Requirements`, `plan-conformance` is PASS, and the full check is green for this tree. When it finds something unmet: run `stage fail validate --reason <what is unmet> --class code`, run `remediate-plan` on the report, run `stage check` yourself again, then start validate once more. A second unmet report stops the run.
- Before the pr stage, with no runner, push the branch and open a draft PR if none exists (`gh pr create --draft --fill`). Then update its title and body from `pr.md` (first line the title, then the body).
- `stage done pr` writes the pull request's check section from that record, so pr.md describes the change and leaves the check result to the script. `stage done review` scans the lines the change added for type and test shortcuts, and refuses until the review records each hit as a finding.
- The review steps each run in a session of their own, with the skill's whole text in its prompt, and you start them. After `stage start review` and before handing the stage to its skill, take base `B` from `node "$SKILL_DIR/scripts/stage" base` and run `node "$SKILL_DIR/scripts/stage" review-step <skill> --base <B>` the same way as `stage check`, waiting for each: `review-code` always; `validate-type-safety` when the diff touches `.ts`, `.tsx` or a tsconfig; `review-security` when the `review-and-verify` skill's `review-depth.mjs` script prints deep or the diff touches a sensitive surface its depth reference lists. Each prints a verdict and its report's path. Hand those paths to the review stage. On a harness other than Claude Code, or when your login is in an environment variable, which does not reach the commands you run, the launcher sets `CATALYST_REVIEW_SESSION_CMD`, a command that reads the prompt on stdin and prints the report. With no way to start a session, `stage fail review --class environment` and stop. With no runner, `stage done review` refuses a verdict with no such session behind it.
- review fixes what it finds once. When it committed fixes, run `stage check` yourself again, the same way, then `stage review-step review-code --base <reviewed_head>`, and add that report's verdict as the `recheck` gate. Do not edit `review-result.json`: put the gate in a copy of it and record that copy through the review-and-verify skill's record step (`record-result.mjs --draft <copy>`), before `stage done review`. Then push the fix commits. A finding it defers stays in `review-result.json`; you do not start a second review.
- Never change a file under the skills folder, and never run a copy of these scripts from elsewhere: a stage's evidence counts only from the scripts it started with, and `stage done` refuses otherwise. A bug in a stage script is an environment failure: stop with `stage fail <stage> --class environment --reason "<the bug>"`.
- A question only a person can answer becomes an ask on the ticket. Record `stage wait answer --key <ask-id> --deadline <ISO time>` and end with the handoff instead of waiting.
- The PR stays a draft. Ready, merge and the cloud's `relay.phase.completed` receipt belong to the platform.
