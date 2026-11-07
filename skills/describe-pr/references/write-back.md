# Write back

Find the PR's saved file by its number, so an update rewrites that PR's file and never another PR's (`pr-123` must not match `pr-1123`). An older description may use `<number>_description.md`. A first description gets a dated name:

```bash
pr_file=$(find thoughts/shared/prs -maxdepth 1 -type f -name "*-pr-${pr_number}.md" -exec ls -t {} + 2>/dev/null | head -1)
[[ -n "$pr_file" ]] || { [[ -f "thoughts/shared/prs/${pr_number}_description.md" ]] && pr_file="thoughts/shared/prs/${pr_number}_description.md"; }
[[ -n "$pr_file" ]] || pr_file="thoughts/shared/prs/$(date -u +%Y-%m-%d)-${ticket:+${ticket}-}pr-${pr_number}.md"
```

Before the body leaves this machine, append the sibling-skip guard so a related ticket's token cannot drag that ticket's state. Run both modes and keep one line per token:

```bash
source "${CLAUDE_SKILL_DIR}/scripts/lib/linear-pr-skip.sh"
body="$(cat "$pr_file")"
skip_block="$( {
    linear_sibling_skip_block_from_branch "$ticket" "$branch"
    linear_sibling_skip_block_from_body   "$ticket" "$body"
} | awk '/^skip /{if(!seen[$0]++) print; next} {if(!h){print; h=1}}' )"
[[ -n "$skip_block" ]] && printf '\n%s\n' "$skip_block" >>"$pr_file"
```

Under a runner or a coordinator, write the artifact and stop:

```bash
{ printf '%s\n\n' "$title"; cat "$pr_file"; } > "$CATALYST_ARTIFACT_DIR/pr.md"
```

Otherwise, update GitHub:

```bash
gh pr edit "$pr_number" --title "$title" --body-file "$pr_file"
```
