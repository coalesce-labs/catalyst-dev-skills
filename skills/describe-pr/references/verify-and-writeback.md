# Verify, Save, and Write Back (Steps 10–13)

## Step 10 — Run verification checks

For each checklist item in "How to Verify It" (e.g. `- [ ] Build passes: \`make build\``), try to run the extracted command and mark the box: `✅` if it passed, `❌` with the error if it failed, or "(manual verification required)" if it can't be automated. Common checks: `make test`/`npm test`/`pytest`, `make lint`/`npm run lint`, `npm run typecheck`/`tsc --noEmit`, `make build`/`npm run build`.

## Step 11 — Save and sync

Always write to `thoughts/shared/prs/` — never to `thoughts/searchable/` (read-only index).

```bash
cat > "thoughts/shared/prs/${pr_number}_description.md" <<EOF
<!-- Auto-generated: $(date -u +%Y-%m-%dT%H:%M:%SZ) -->
<!-- Last updated: $(date -u +%Y-%m-%dT%H:%M:%SZ) -->
<!-- PR: #$pr_number -->
<!-- Previous commits: $commit_list -->

[Full description content]
EOF
humanlayer thoughts sync
```

## Step 12 — Update the PR on GitHub

**CRITICAL: NO CLAUDE ATTRIBUTION.** Before writing, strip any "Generated with Claude Code", "Co-Authored-By: Claude", or other AI-assistance references. Write in first person attributed to the human author ("I added...", "We implemented...").

```bash
gh pr edit $pr_number --title "$new_title"

body_file="thoughts/shared/prs/${pr_number}_description.md"

# shellcheck source=/dev/null
source "${CLAUDE_SKILL_DIR}/scripts/lib/linear-pr-skip.sh"
body="$(cat "$body_file")"
skip_block="$( {
    linear_sibling_skip_block_from_branch "$ticket" "$branch"
    linear_sibling_skip_block_from_body   "$ticket" "$body"
} | awk '/^skip /{if(!seen[$0]++) print; next} {if(!h){print; h=1}}' )"
[[ -n "$skip_block" ]] && printf '\n%s\n' "$skip_block" >>"$body_file"

gh pr edit $pr_number --body-file "thoughts/shared/prs/${pr_number}_description.md"
```

This is a **call site**, not the guard's rationale — see [linear-sibling-guard.md](linear-sibling-guard.md) for why both modes run here and what the dedup does.

## Step 13 — Leave the ticket where it is

Write nothing to the ticket: it stays where it is until the PR merges. On Catalyst Cloud the cloud moves it when the phase outcome is recorded and again when the PR merges. Linear's GitHub integration (and the cloud, when connected) links the PR to the ticket by branch name or title, and the description's `Fixes` line names it.
