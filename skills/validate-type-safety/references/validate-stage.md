# In a validate stage: record, never fix

When `CATALYST_PHASE` or `CATALYST_STAGE` is `validate`, this skill is one gate of the validate ladder, and that stage produces verdicts, not fixes. These rules replace the fix-and-rerun rules in `SKILL.md`:

1. **Record, never fix.** A failing step is a finding with its `file:line`. Leave the code as it is and do not re-run after a fix: the remediate stage fixes it. Record the step's FAIL and return your verdict.
2. **Reuse the PR's CI before re-running suites.** Run each command under a `timeout` well below the phase budget (for example `timeout 1200`), and run the narrowest suite that covers the diff, never the whole monorepo when a narrower one does.
   - If the branch has a pull request whose head is `HEAD` (`gh pr view --json number,headRefOid`), read its checks (`gh pr checks --json name,state,bucket,link`). All required checks completed and passing means Step 4 is PASS: cite the run link, and run no suite yourself. A required check that failed means Step 4 is FAIL: cite that job's link.
   - If the checks at `HEAD` are still pending, there is no pull request, or `gh` cannot read it: run the type check, then only the test suites of the packages the diff touches, each under its own `timeout`.
   - If a command times out, record that step as not run with the timeout named. Describe only what happened: a tool you did not call was not refused or blocked.
3. **A failure the branch did not introduce is pre-existing, not a FAIL.** Before recording a failing test, type error or lint error, check whether it also fails at the review base (`refs/catalyst/validate-base`, or the merge-base with the default branch): check out that path at the base in a scratch worktree, or read the PR's base-branch CI for the same check. If it fails there too, record the step PASS with `"preexisting":true` on the `type-safety` entry, and name the failing test or check and the base result in `detail`. FAIL only on failures this branch introduces. Info-level linter output (for example shellcheck `info` codes such as SC2015) never fails the step.
4. **Name the failing sub-step.** On a FAIL, the ladder's `type-safety` entry carries `substep`: the first step that failed, as `typecheck` (Step 1), `reward-hacking` (Step 2), `test-inclusion` (Step 3), `tests` (Step 4) or `lint` (Step 5). The remediate stage reads it to pick its fix, so a flaky test never reads the same as a type error. Omit it on any other verdict.

On a FAIL, stop: the FAIL and its findings are the result.
