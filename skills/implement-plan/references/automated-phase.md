# Automated phase runs

Read this when `CATALYST_PHASE` (or `CATALYST_STAGE`) is set: the run was dispatched, and nobody is at the keyboard.

## After every Green step: commit, then push the draft PR

Run both blocks, in this order, after every Green step. The commit comes first so a mid-phase kill loses at most one Red→Green cycle, and the draft PR becomes the durable off-disk record of the work from the first commit. Interactive runs skip both through the `CATALYST_PHASE` gate.

```bash implement-plan-commit-green
# Commit BEFORE the draft-pr-push block below: draft_pr_push (this skill's
# scripts/lib/draft-pr.sh) is a pure `git push` and commits nothing itself. Without a
# commit here, the push re-pushes whatever HEAD already had (the previous step's commit)
# and the just-written Green code sits uncommitted in the worktree, where a mid-phase
# kill loses it. Run after EVERY TDD Green step, same gate as the push below (automated
# runs only; interactive runs skip so there's no surprise commit). Fail-open: never
# blocks the phase — an empty or failed commit only means the push has nothing new to carry.
if [[ -n "${CATALYST_PHASE:-}" ]]; then
  # `git status --porcelain`, not `git diff`/`git diff --cached` alone — a
  # Green step very often ADDS a new file (new test, new implementation
  # module), which is untracked and invisible to both diff forms until
  # staged. Checked BEFORE staging so an all-clean tree (nothing changed
  # this Green step) skips straight through without an empty commit attempt.
  if [[ -n "$(git status --porcelain -- . 2>/dev/null)" ]]; then
    git add -A -- . ':!thoughts' 2>/dev/null || true
    git -c core.hooksPath=/dev/null commit -m "wip(green): ${TICKET_ID:-${CATALYST_TICKET:-implement}} TDD green step" \
      >/dev/null 2>&1 || true
  fi
fi
```

```bash implement-plan-draft-pr-early
# Make the PR the durable off-disk work record from the FIRST commit.
# Run after EVERY TDD Green step: first run opens the draft PR, later runs just
# push (draft_pr_ensure is idempotent). Interactive runs (no CATALYST_PHASE)
# skip — no surprise pushes. Fail-open: never blocks the phase.
# The helper ships inside this skill; a missing copy in an automated run is reported, never silently skipped.
if [[ -n "${CATALYST_PHASE:-}" ]]; then
  if [[ -r "${CLAUDE_SKILL_DIR}/scripts/lib/draft-pr.sh" ]]; then
    # shellcheck source=/dev/null
    source "${CLAUDE_SKILL_DIR}/scripts/lib/draft-pr.sh"
    if [[ "$(draft_pr_enabled)" == "true" ]]; then
      draft_pr_push || true
      draft_pr_ensure "main" "${TICKET_ID:-${CATALYST_TICKET:-}}" >/dev/null 2>&1 || true
    fi
  else
    echo "⚠️ skill_dir_unresolved: draft-pr helper not found under this skill's directory — the draft PR was not pushed" >&2
  fi
fi
```

## Quality gates: one gate, from the dispatch prompt

After the last phase, run the single gate the dispatch prompt's gate block names, instead of the four local gates. That block is the contract: run its command once, fix and retry once if it fails, then print the verdict block it asks for. Type safety, security review and code review belong to the validate stage's ladder, and nothing reads a verdict run here.

Never stop to ask how to proceed. A gate still red after the retry goes into the verdict block, and the platform decides what runs next.
