---
name: validate-plan
description: "Validate that an implementation plan was executed: every phase done and every success criterion met. **ALWAYS use when** the user says 'validate the plan', 'check if the plan was implemented correctly', 'verify the implementation', or after the implement-plan skill completes."
disable-model-invocation: false
allowed-tools: Read, Write, Grep, Glob, Bash, Task
version: 1.0.0
---

# Validate Plan

## 1. Find the plan

```bash
# Thoughts must exist for this skill's documents. That is the only host check here: the skill runs anywhere.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\`; if the prompt names an output path, write there" >&2
if [[ -n "${CATALYST_PHASE:-}" ]]; then echo "unattended: CATALYST_PHASE=$CATALYST_PHASE, so never ask and wait"; fi
# explicit-input discovery: begin
# The plan to validate: a `thoughts/shared/plans/` path in the argument text (Claude Code fills in the
# token below; elsewhere, use the path the prompt names). Under a phase that path is the only input.
# Off a phase, else the ticket's newest document, else the newest; `[!0-9]` keeps PROJ-1 off PROJ-10's.
SKILL_ARGS=$(cat <<'CATALYST_SKILL_ARGS'
$ARGUMENTS
CATALYST_SKILL_ARGS
)
RECENT_PLAN=$(printf '%s' "$SKILL_ARGS" | grep -oE '[^[:space:]"()<>`]*thoughts/shared/plans/[^[:space:]"()<>`]+[.]md' | head -1); [[ -f "$RECENT_PLAN" ]] || RECENT_PLAN=""
TICKET_ID="${TICKET_ID:-${CATALYST_TICKET:-}}"
[[ -n "$TICKET_ID" ]] || TICKET_ID=$(printf '%s' "$SKILL_ARGS" | grep -oE '[A-Z][A-Z0-9]*-[0-9]+' | head -1)
[[ -n "$TICKET_ID" ]] || TICKET_ID=$(printf '%s' "$SKILL_ARGS" | tr '[:lower:]' '[:upper:]' | grep -oE '[A-Z][A-Z0-9]*-[0-9]+' | head -1)
if [[ -z "$RECENT_PLAN" && -z "${CATALYST_PHASE:-}" ]]; then
  if [[ -n "$TICKET_ID" ]]; then
    RECENT_PLAN=$(find -H thoughts/shared/plans -type f -name '*.md' -ipath "*${TICKET_ID}[!0-9]*" -exec ls -t {} + 2>/dev/null | head -1)
  else
    RECENT_PLAN=$(find -H thoughts/shared/plans -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -1)
  fi
fi
# explicit-input discovery: end
if [[ -n "$RECENT_PLAN" ]]; then
  echo "📋 Found plan: $RECENT_PLAN"
else
  echo "⚠️ No plan found on disk for ${TICKET_ID:-this run}"
fi
```

**Inputs: the plan file and the PR.** A plan path argument wins, and the PR is the number or URL the arguments name (else the current branch's PR, `gh pr view --json number`). When `CATALYST_PHASE` is set, never search and never ask: validate the plan file the arguments or the prompt name, and with none, stop and report `no_plan_found`. Otherwise, after `📋 Found plan`, show the path and ask "**Validate this plan?** [Y/n]". Otherwise, or on no, search recent commits for plan references, list the plans in `thoughts/shared/plans/`, and ask which to validate.

## 2. Gather evidence

Read the plan whole, noting every file it expects to change and every success criterion. At validation start, fetch `origin/main` and record the full `HEAD` SHA, branch, fetched main SHA, and `git merge-base <main-sha> HEAD`. The validation report must include these values as `git_commit`, `branch`, `git_main_sha`, and `git_merge_base` so a later repair can identify the exact reviewed source. Then:

- Read `git log --oneline -n 20` and define the review scopes before judging findings. For the whole branch, use `git diff "$(git merge-base "$VALIDATION_MAIN_SHA" HEAD)" HEAD`; this is the ticket branch's change against the main SHA recorded at validation start. Never use live `origin/main` after recording that SHA, and do not report files or hunks brought in from main as this ticket's changes.
- Report main movement since the plan in a separate section with `git log <plan.git_merge_base>..<validation-main-sha>`. Compare the changed paths in that range with plan-referenced files; when main changed one, name the file and the main commit. Keep those changes out of plan-conformance findings.
- For a repair after a failed validation, use the exact prior failed head `H1` with `git diff H1 HEAD` as the repair scope, even when main was merged between H1 and the repair. Never replace H1 with `git merge-base H1 HEAD`. Identify main-only movement separately and do not attribute its lines to the repair.
- Read `thoughts/shared/plans/<TICKET-ID>/deviations.json` when present. It uses the implementer's cloud-compatible shape `{"deviations":[{"plan_ref":"…","planned":"…","actual":"…","reason":"…","evidence":"…"}]}`. Match each declared entry against the diff and its evidence, including the full main commit SHA when main forced the departure. List unmatched code changes as undeclared deviations and cite their file and line; list a declaration as declared only when its actual change and evidence match.
- Run the repo's own check and test commands from its root (its `package.json` scripts or `Makefile` targets), recording each command's real exit code.
- Spawn parallel tasks comparing planned with actual: database changes; code changes, file by file; tests, and whether each phase's tests were committed before or with its code (TDD).
- If you implemented it, check your todo list too and name every shortcut or unfinished item.

## 3. Validate each phase

Confirm that every phase checked off (`- [x]`) has matching code and every "Automated Verification" command ran; find the root cause of each failure. Turn manual criteria into clear steps for the user. Look for unhandled errors, missing validations, regressions and departures from the repo's patterns.

## 4. Write the Validation Report

Write the report to `thoughts/shared/validations/YYYY-MM-DD-<TICKET>-<slug>.md`, where `<TICKET>` is the plan's `source_ticket` and `<slug>` is a few words from the plan's name (`YYYY-MM-DD-<slug>.md` with no ticket). Write only under `thoughts/shared/validations/`; `thoughts/searchable/` is a read-only index. Give it `source_ticket`, `repository`, `plan` and `pr` frontmatter. Then run `humanlayer thoughts sync`, which commits and pushes the thoughts repo, show the report, and end with the file's path on its own last line, so whoever started this run can read the file rather than this conversation.

```markdown
# Validation Report: {Feature Name}

**Plan**: `thoughts/shared/plans/YYYY-MM-DD-PROJ-XXXX-feature.md`
**Validated**: {date}
**Validation Status**: {PASS/FAIL/PARTIAL}

## Validation Source

- `git_commit`: {full SHA}
- `branch`: {branch}
- `git_main_sha`: {full main SHA captured at validation start}
- `git_merge_base`: {full merge-base of git_main_sha and git_commit}

## 📊 Context Status
Current usage: {X}% ({Y}K/{Z}K tokens)
{Above 60%: ⚠️ start a fresh session for `commit` and `describe-pr`. Else: ✅ Ready for PR creation.}

### Implementation Status
✓ Phase 1: [Name] - Fully implemented
⚠️ Phase 3: [Name] - Partially implemented (see issues)

### Automated Verification Results
✓ `{command}` exit 0
✗ `{command}` exit 1

### Code Review Findings
- Matches plan: [what was built as planned]
- Deviations: [deviation] in [file:line] (improvement / problem)
- Potential issues: [risk]

### Manual Testing Required
- [ ] [step for the user]

### Recommendations
- [what to address before merge]
```

End with the ladder block below. On FAIL or PARTIAL the next step is the `remediate-plan` skill; on PASS, `commit` and `describe-pr`.

## The validation ladder block

The report's machine-readable verdict is one fenced `catalyst-validation-ladder` block, the **last** fenced block in the report, written exactly once. The `remediate-plan` skill reads it to decide what to fix, and a Catalyst Cloud run parses it too.

A Catalyst Cloud validate phase may put its own ladder instructions in the prompt. They ask for the same block and win on any detail. What follows is the default, as on a laptop.

#### Shape

```catalyst-validation-ladder
{"version":1,"steps":[
  {"step":"plan-conformance","verdict":"PASS","materiality":"material","detail":"all 3 phases implemented as planned"},
  {"step":"type-safety","verdict":"PASS","detail":"validate-type-safety: typecheck, scan, tests, lint all exit 0"},
  {"step":"code-review","verdict":"FAIL","detail":"review-code: 1 finding","findings":[{"path":"src/x.ts","line":42}]},
  {"step":"security-review","verdict":"PASS","detail":"review-security: no findings"},
  {"step":"security-audit","verdict":"SKIPPED","detail":"no dependency audit configured in this repo"}
]}
```

- **`step`**: each of the five ids appears exactly once: `plan-conformance`, `type-safety`, `code-review`, `security-review`, `security-audit`. A step left out counts as unreported, never as skipped.
- **`verdict`**: one of `PASS`, `FAIL`, `SKIPPED`, `UNAVAILABLE`, `ENVIRONMENT_GAP`. (`UNREPORTED` also exists, but only a reader writes it, for a missing or malformed step.)
- **`detail`**: one line naming the evidence: the command and its outcome, the finding, or why the step did not run.
- **`findings`** (optional): `{"path","line"}` for each finding, with `"preexisting":true` on one the diff did not introduce.
- **`materiality`** (plan-conformance only): `material` when a deviation changes what the plan promised, `plan-only` when only the plan's wording is off.
- **`declared`** (plan-conformance only, optional): `true` when the deviation is one the implementation declared up front.

Keep each `detail` under about 1,200 characters and the whole block small: a cloud run carries it in a size-limited receipt, and a step that overflows is rejected.

#### Filling each step

| step | how | when it cannot run |
| -- | -- | -- |
| `plan-conformance` | this skill's own check of the plan against the code | — |
| `type-safety` | the `validate-type-safety` skill | `SKIPPED`, "not a TypeScript workspace" |
| `code-review` | the `review-code` skill's verdict line | `SKIPPED` with the reason, e.g. no diff against a base |
| `security-review` | the `review-security` skill's verdict line | as above |
| `security-audit` | the repo's own dependency and secret audit, for example `bun audit` or `npm audit`; `FAIL` only on a HIGH or CRITICAL advisory in a direct production dependency the diff adds or changes | `SKIPPED`, "no audit configured" |

`UNAVAILABLE` is only for a step whose own tool could not run. A step you ran out of time for is `FAIL`. `ENVIRONMENT_GAP` names a missing system piece, such as a library or an unreachable registry. None of these is `PASS`. The report's overall status line (PASS, FAIL or PARTIAL) is for the person reading it, while the ladder is what a fix round acts on.
