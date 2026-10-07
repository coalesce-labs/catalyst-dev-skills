---
name: remediate-plan
description: "Fixes what the validate-plan skill found, verifying each finding before touching code. Reads the Validation Report from this conversation (a same-session validate-plan run) or from a report file the dispatch prompt names, classifies every finding against the shared resolving-review-findings reference, fixes only valid findings on FAILED steps with the smallest diff, answers invalid ones with evidence, and raises an ask instead of looping. Use right after validate-plan reports FAIL or PARTIAL, when dispatched as a remediate session with a validation report on disk, or as the remediate step after validate in an automated ticket run. Not for a fresh implementation pass."
disable-model-invocation: false
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Task
version: 1.2.0
---

# Remediate Plan

**Paths.** This skill reads a file inside its own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before reading it. If you cannot, stop and report `skill_dir_unresolved`.

## Input

The report's last fenced block, `catalyst-validation-ladder`, is what this skill acts on: five steps, each with a verdict and its findings. Its schema lives only in the `validate-plan` skill, section "The validation ladder block" (in a skills-CLI install, the sibling `validate-plan` skill directory). Read it there.

The report comes from one of two places, and the steps are the same for both. When `CATALYST_PHASE` is set, never ask and wait: act on the report you were given, and escalate instead of stopping on a question:

- **Same session (laptop):** a `validate-plan` run in this conversation reported FAIL or PARTIAL.
- **Fresh session (cloud dispatch):** the dispatch prompt names a report file on disk, usually the failed validate phase's `validation.md` fetched from its artifact store; failing that, a thoughts doc or Linear attachment the prompt points at.

With neither, run the `validate-plan` skill in this session first. [references/single-session-fix.md](references/single-session-fix.md) walks through one same-session round.

## Steps

0. **Read `${CLAUDE_SKILL_DIR}/assets/references/resolving-review-findings.md`** and follow it for every finding. It owns the classification, verification, scope, reply and escalation rules; the steps below apply them to a Validation Report.
1. **Read the report** and parse its `catalyst-validation-ladder` block. Note which steps it marked FAIL and which PASS, and give each finding an id (`F1`, `F2`, …). A report with no such block names no failing step: run the `validate-plan` skill again.
2. **Classify every finding** as `valid`, `invalid`, `already-fixed`, `pre-existing/out-of-scope` or `needs-human` (reference rules 2 and 3). Read the cited code at HEAD, and reproduce a behaviour claim with a failing test or command before calling it `valid`. Then scope:
   - Fix only `valid` findings on steps the report FAILED. Those are what keep its verdict off PASS.
   - Leave every PASS step's notes alone, including plan-only deviations, findings marked `materiality:"plan-only"`, and type-safety entries marked `preexisting`. They are not this round's work.
   - Keep every deviation the report accepted.
   - `invalid`: record the evidence (file:line, test name or command output) and change no code.
   - `already-fixed`: cite the SHA. `pre-existing/out-of-scope`: name the follow-up it belongs in.
3. **Fix** each `valid` finding with the smallest diff that closes it (reference rules 4–6): every hunk maps to a finding id, one regression test per finding fails before the fix, every instance inside this branch's diff is fixed, and nothing is refactored, renamed or cleaned up.
4. **Re-run a targeted gate**: the repo's own check command from its `package.json` scripts or `Makefile`, or the touched workspace's slice of it. Self-review the diff first (reference rule 11), and print the real `exit 0`.
5. **Commit** the fix as its own commit, e.g. `fix(<scope>): <TICKET> remediate validate-plan findings (F1)`. In a cloud round the dispatch prompt's commit rule wins: the runner commits.
6. **Local only: re-run the `validate-plan` skill** against the same plan. Only its verdict shows the fixes worked. A cloud round skips this step, because the pipeline dispatches validate itself.

**No code change is a valid outcome** when no finding is `valid`. Locally, reply with the per-finding evidence. In a cloud round, follow the reference's "Cloud rounds" section: a validate-report finding has no manifest entry, so write `remediation.json` as `[]` and put the per-finding evidence in `adjudication.json`'s `reasoning` with `next_stage: "advance"`. Either way, the evidence is required.

**One repair round per validate report.** The pipeline rechecks the repair once, then moves the ticket to PR and files what remains as follow-ups. Locally, stop after two remediation rounds and report. If the dispatch prompt says this round is past the cap, repair nothing: file each remaining finding as a follow-up, record it in `adjudication.json`, and stop.

**Escalate instead of looping** (reference rule 12): when a finding recurs after a fix aimed at it, needs an architecture, contract or migration change, contradicts the plan or an ADR, or cannot be verified, raise an ask (`$CATALYST_ARTIFACT_DIR/decisions.json` in a cloud round; locally, from your own session through the Cloud pack's `what-needs-me` skill) and end the round there.

## Phase-completion evidence

Report in a shape your coordinator can check: the fix commit in `git log`, the gate's real exit code, the re-run validate-plan verdict (local only), and the classification table itself:

| Finding | Report step (FAIL/PASS) | Class   | Action     | Evidence                                                        |
| ------- | ----------------------- | ------- | ---------- | --------------------------------------------------------------- |
| F1      | code-review (FAIL)      | valid   | fixed      | `abc1234` src/x.ts:42; `x.test.ts` "rejects empty id" red→green |
| F2      | code-review (FAIL)      | invalid | none       | src/y.ts:17 already guards null; `bun test y.test.ts` passes    |
| F3      | plan-conformance (PASS) | —       | not chased | plan-only note on a PASS step                                   |
