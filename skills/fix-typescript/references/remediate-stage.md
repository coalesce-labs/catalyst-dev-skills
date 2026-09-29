# In a remediate stage: work from the ladder

When `CATALYST_PHASE` or `CATALYST_STAGE` is `remediate`, a validate run already found the errors. Start from its list, not a fresh whole-repo run: that re-finds defects this branch did not introduce and burns the phase budget.

1. **Read the list.** Open `$CATALYST_ARTIFACT_DIR/prior/validation.md` and take the last `catalyst-validation-ladder` block. The `type-safety` entry's `substep`, `findings` and `detail` are the work; the prose above the block has the full error text.
2. **Skip what the branch did not introduce.** An entry or finding marked `"preexisting":true` reproduces on the merge-base. Leave it alone and do not count it.
3. **Fix by sub-step.**
   - `typecheck`: fix each cited error at its source, per the rules in `SKILL.md`.
   - `reward-hacking`: remove the hack by fixing the type it was hiding.
   - `test-inclusion`: remove the `tsconfig` `exclude` and fix whatever errors it was hiding.
   - `tests`: reproduce the failing test before editing. If it passes on a rerun without a change, it is flaky: say so, and leave the code alone.
   - `lint`: fix what the rule flags. Keep the rule enabled.
   - No `substep`: read `detail` and the prose to find which of the five failed.
4. **Prove it narrowly, then with the repository's gate.** Re-run only the failing check, scoped to the packages you touched. The final gate is the repository's own gate command, as the dispatch prompt names it, never a package manager's default.
5. **Scan your own change before you end.** Run the `scan-reward-hacking` skill over the files you changed: `git diff --name-only HEAD` plus `git ls-files --others --exclude-standard`. Fix every CRITICAL or HIGH finding on a line you wrote.
