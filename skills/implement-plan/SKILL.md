---
name: implement-plan
description: "Implement a plan from thoughts/shared/plans/ phase by phase, test first, until the repository's checks are green and every acceptance criterion is proven. Use when asked to implement the plan, start implementing, or build from a plan."
allowed-tools: Read, Write, Edit, Grep, Glob, Task, TodoWrite, Bash
metadata:
  version: "2.0.0"
---

# Implement plan

Done means two things, both true in this session: the repository's checks ran green on your final tree, and every acceptance criterion in the plan has its proof. Handing over red work only moves the failure to a later stage.

**Unattended.** When `CATALYST_PHASE` is set, or a coordinator started you, implement the plan file you were given, never search for another, and never ask and wait. With no plan file, stop and report `no_plan_found`. A plan path in the arguments needs no confirmation. Otherwise confirm the plan with the person first.

## Steps

1. **Read** the plan whole, its ticket, and every file it names. Checked items (`- [x]`) are done; resume at the first unchecked one. If the branch has commits `origin/main` lacks, merge `origin/main` first and resolve any conflict.
2. **Each phase, in order:** write the phase's tests and watch them fail; write the smallest change that passes them; clean up with the tests green. Then run the fastest checks that cover what you touched (the affected tests, the type check, the linter), fix what fails, and check the phase's items off in the plan. When unattended, or when the person asked for commits, commit now, and only after the type check passes: a test runner can pass code the type checker rejects.
3. **The full check.** After the last phase, run the repository's own check command (the one its AGENTS.md, CLAUDE.md, CONTRIBUTING or CI names), or the command your coordinator gave you. It can outlast a foreground command limit: start it with your harness's background option on the command itself, with the longest timeout it allows (two hours, 7200000 ms, in Claude Code; with none it is stopped after ten minutes), and wait for it, because a trailing `&` loses the result when the shell ends. Fix and rerun until it is green. If it cannot run here (a missing service, no permission, the wrong operating system, out of time), stop and report it as an environment failure with the command and its output, rather than handing over.
   - **A failure your change did not cause.** Run the same failing tests on `origin/main` without your change. If they fail there too, they are not yours to fix: stop and report an environment failure that lists each test, its result with your change, and its result on `origin/main`. Do not call the work done while the check is red.
4. **Prove the criteria.** For each `AC<n>` in the plan, name the test or command that proves it and confirm it passed. When a criterion cannot be met as written, say so as a deviation.
5. **Record departures** from the plan in `thoughts/shared/plans/<TICKET>/deviations.json` as [references/deviations.md](references/deviations.md) shows. Write no file when the plan was followed.
6. **Report** the check command and its result, each criterion with its proof, and any deviation. A check that stops at its first failure did not run the steps after it: name only the steps you saw pass. Unless a runner or coordinator started you, say that no review has run and that the `review-and-verify` skill comes next, once a pull request exists.

When the code has drifted so far that the plan cannot be followed, stop and report `Expected:` (the plan), `Found:` (the code), and why it matters. With `--team`, or a plan spanning three or more independent areas, see [references/team-mode.md](references/team-mode.md).
