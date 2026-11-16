# Configuration and Safety Features

## Configuration

The skill reads `.catalyst/catalyst.toml` and needs no other file; a checkout without one gets the defaults below.

```bash
TEAM_KEY=$(awk -F'"' '/^\[project\]/{p=1;next} /^\[/{p=0} p && /^linear_team/{print $2; exit}' .catalyst/catalyst.toml 2>/dev/null)
TEAM_KEY=${TEAM_KEY:-PROJ}
```

| What | Where it lives | Default |
| -- | -- | -- |
| Ticket prefix and Linear team | `[project] linear_team` | `PROJ` |
| Merge policy, hold labels, required checks | `[merge]` (read by the cloud, not by this skill) | the cloud's |
| Test command | no settings key; `CATALYST_TEST_COMMAND` for one run | `make test` |
| Merge strategy | squash, always | squash |
| Delete remote and local branch | always, local only outside a linked worktree | on |

Approval and CI requirements are the repository's branch protection and `[merge] required_checks`, never a local flag.

## Safety features

**Never bypass branch protection:**
- No `--admin`, `--force`, or any flag that circumvents protection rules
- No disabling or modifying branch protection rules
- No suggesting the user disable protections
- Always satisfy requirements legitimately or escalate with specifics

**Fail fast on:**
- Merge conflicts (can't auto-resolve)
- Test failures (unless `--skip-tests`)
- Merge conflicts
- PR not in mergeable state

**Diagnose and fix automatically:**
- CI failures → analyze errors, fix code, push, resume the cloud lifecycle wait
- Unresolved review threads → run the `review-comments` skill, resolve via GraphQL
- Branch behind → merge the base in and push fast-forward
- Draft PR → mark as ready with `gh pr ready`

**Escalate with actionable specifics:**
- Review required → who to request, how many needed
- Changes requested → what was asked, whether commits address it
- Unknown blockers → full branch protection rule breakdown

**Always automated:**
- Merge the base in if behind (no conflicts)
- Squash merge
- Delete remote branch (checkout-free)
- Delete local branch (when not in a linked worktree)
- Pull latest base branch
