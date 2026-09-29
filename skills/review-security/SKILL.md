---
name: review-security
description: "Security review of a branch's diff against its base for exploitable vulnerabilities the change introduces (injection, auth bypass, crypto and secrets, unsafe deserialization or XSS, data exposure), traced from input to sink against the repository's own security patterns and reported at ≥70 confidence with an exploit scenario and a fix, ending in a PASS | FAIL | SKIPPED | UNAVAILABLE verdict with `path:line` findings the validate ladder records. Derived from anthropics/claude-code-security-review (MIT). One session, no fan-out, no PR comments. ALWAYS use when a validate phase reaches its security-review step on any harness, or when the user says 'security review', 'audit this diff for vulnerabilities', 'is this change exploitable'."
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob
argument-hint: "[base-ref-or-sha] [--files <list-file>]"
---

# Review security (one session, exploitable findings only)

Review the changes a branch made against its base commit as a senior security engineer, looking only for security weaknesses the change newly introduces. The procedure, categories, severity and confidence rules, and exclusions derive from the audit prompt in `anthropics/claude-code-security-review` (`claudecode/prompts.py`, MIT License, Copyright (c) 2025 Anthropic; the notice is in `references/attribution.md`), rewritten so one session runs every phase and records a verdict.

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

- `unavailable` (exit 4): the base cannot be resolved. Verdict **UNAVAILABLE**, `detail` = the script's `reason:` line. Stop here; a verdict from the working tree or a guessed base is not this review's verdict.
- `skipped` (exit 3): the bounded diff is empty or touches only docs, images or lockfiles. Verdict **SKIPPED** with that reason, except when the caller's scope block says an empty change list means the base is wrong (the validate ladder does): then record **UNAVAILABLE** with the caller's reason.
- `review` (exit 0): continue. Note `base:`, `ancestry:` (report `unproven`), `code:` and the `files:` block. Audit only files in that block.

## Step 2: Read the diff, then the intent

Run the `diff_command:` line the script printed and read the whole diff. Then read the intent the caller gave you (ticket or PR title and description, the plan) so you know what the author meant to expose. Every finding cites a line the diff touched.

## Step 3: Three phases (read `references/method.md`; categories in `references/categories.md`)

1. **Repository context:** the security frameworks, sanitizers, validators and auth helpers this codebase already uses, and its threat model.
2. **Comparative analysis:** where the diff deviates from those patterns, implements a control inconsistently, or opens a new attack surface.
3. **Vulnerability assessment:** per changed file, trace data from every input to every sensitive operation, for the categories in the reference. Skip its exclusions (denial of service, secrets on disk, rate limiting, resource exhaustion, unproven input-validation gaps).

Each candidate carries `path:line`, `severity` (HIGH | MEDIUM | LOW), a `category` slug (e.g. `sql_injection`, `auth_bypass`, `xss`, `path_traversal`), a description, an exploit scenario, and a recommendation.

## Step 4: Confirm, score, filter (read `references/method.md`)

Open each candidate's file at the cited line and trace the path from attacker-controlled input to sink yourself. Score confidence 0–100 on the reference's scale. Below 70 is not reported. HIGH or MEDIUM at ≥80 is *confirmed*; 70–79, or any LOW, is *informational* and never fails the step.

## Step 5: Report (read `references/report.md`)

Write the report in the reference's shape: scope line, phases run, confirmed findings with `path:line` / severity / category / confidence / description / exploit scenario / fix, informational notes, the verdict, and the one-line `catalyst-review-step` JSON entry the validate ladder records. **FAIL** on any confirmed finding; **PASS** when none. Write it to the output the caller named, or print it if none was named.

## Boundaries

- This skill returns a verdict. It edits no code and posts nothing to GitHub; the `remediate` phase fixes.
- Findings sit in files inside the `files:` block, on lines the diff touched, and are new relative to the base.
- Report only what you traced to an exploit path; leave excluded categories and theoretical issues out.
