---
name: review-code
description: "Review a branch's diff against its base for real defects only: bugs the diff makes certain, quoted CLAUDE.md/AGENTS.md violations, contradictions of recent git history, unaddressed prior-PR review comments, and in-code guidance the change ignores. Each is scored 0–100 and reported only at ≥80, ending in a PASS | FAIL | SKIPPED | UNAVAILABLE verdict with `path:line` findings the validate ladder records. One session, no fan-out, no PR comments. ALWAYS use when a validate phase reaches its code-review step on any harness, or when the user says 'review this diff', 'review the branch', 'code review against <base>'."
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob
argument-hint: "[base-ref-or-sha] [--files <list-file>]"
---

# Review code (one session, high signal only)

Review the changes a branch made against its base commit, and nothing else. The criteria are the official Claude Code `code-review` plugin's (five lenses, the confidence scale, the ≥80 filter, the false-positive list), run in one session: you run every lens yourself, in order, and confirm every candidate yourself before reporting it. Report only findings you are certain of.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Step 1: Scope (computed from the base, never the whole tree)

```bash
# Base: the argument if one was given (Claude Code substitutes the token below; another harness
# leaves it literal, which the script treats as no argument), else refs/catalyst/validate-base,
# the ref the runner plants at the branch's base commit.
SKILL_ARGS=$(cat <<'CATALYST_SKILL_ARGS'
$ARGUMENTS
CATALYST_SKILL_ARGS
)
# If the caller listed the changed files (the validate prompt's Review scope block does), write
# them one per line to a scratch file first and append: --files <that file>
bash "${CLAUDE_SKILL_DIR}/scripts/review-scope.sh" "$SKILL_ARGS"
```

Act on the `status:` line:

- `unavailable` (exit 4): the base cannot be resolved. Verdict **UNAVAILABLE**, `detail` = the script's `reason:` line. Stop here; a scan of the working tree or a guessed base names different findings on every pass over unchanged code.
- `skipped` (exit 3): the bounded diff is empty or touches only docs, images or lockfiles. Verdict **SKIPPED** with that reason, except when the caller's scope block says an empty change list means the base is wrong (the validate ladder does): then record **UNAVAILABLE** with the caller's reason.
- `review` (exit 0): continue. Note `base:`, `ancestry:` (report `unproven`), `code:` and the `files:` block. Review only files in that block.

## Step 2: Read the diff, then the intent

Run the `diff_command:` line the script printed and read the whole diff. Then read the intent the caller gave you (ticket or PR title and description, the plan) so a deliberate change is not mistaken for a mistake. Review the diff, not the current file contents: every finding cites a line the diff touched.

## Step 3: Five lenses, in order (read `references/lenses.md`)

1. **Guidelines:** CLAUDE.md / AGENTS.md rules that scope to each changed file, quoted.
2. **Diff bugs:** what the diff alone proves: will not compile or parse, wrong results regardless of input.
3. **History:** the change undoes or contradicts what a recent commit did on purpose.
4. **Prior review comments:** a reviewer already asked for the opposite on these lines. Runs only when `gh` is authenticated; otherwise record the lens as not run, and the verdict is unaffected.
5. **In-code guidance:** a comment near the changed code forbids or constrains exactly this.

Each lens yields candidates: `path:line`, category (`correctness` | `security` | `guideline`), a one-sentence claim, and the evidence (a quote, a commit, a comment).

## Step 4: Confirm, score, filter (read `references/scoring.md`)

Open each candidate's file at the cited line and check the claim against the real context, as a second reviewer would. Score confidence 0–100 on the reference's scale. Drop everything below 80, and everything on the false-positive list whatever its score. A confirmed defect that occurs only under a particular input or state (an empty-input crash, a bypassed permission check) is a real MEDIUM finding; a hypothetical you could not confirm on this diff is dropped. `references/scoring.md` is the authority on what is reported.

## Step 5: Report (read `references/report.md`)

Write the report in the reference's shape: scope line, lenses run, findings with `path:line` / severity / category / confidence / reason, dropped candidates one line each, the verdict, and the one-line `catalyst-review-step` JSON entry the validate ladder records. **FAIL** on any surviving finding; **PASS** when none survives. Write it to the output the caller named, or print it if none was named.

**Re-validate bar.** When the caller says this is a re-validation (the scope block says so, or names a repair scope), a finding fails the step only if it is HIGH, or a MEDIUM `correctness` or `security` finding on a line the repair itself wrote. List every other surviving finding under **Follow-ups** and leave it out of `findings`; the pipeline files it as a follow-up ticket. A first review keeps the plain rule: every surviving finding fails, guideline MEDIUMs included.

## Boundaries

- This skill returns a verdict. It edits no code, runs no formatter or linter, and posts nothing to GitHub; the `remediate` phase fixes.
- Findings sit in files inside the `files:` block, on lines the diff touched.
