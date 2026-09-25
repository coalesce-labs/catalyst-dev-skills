# Setup, configuration, and worked examples

## Prerequisites

This skill runs on the Catalyst Cloud CLI that the Cloud pack installs and connects:

```bash
if command -v catalyst-skills >/dev/null 2>&1; then CS=catalyst-skills; else CS="npx @catalyst-cloud/catalyst-skills"; fi
$CS status || echo "not connected to a Catalyst Cloud tenant: set it up with the Cloud pack (catalyst-setup)"
```

Install the Cloud pack with `npx skills@latest add coalesce-labs/catalyst-cloud-skills --all -g`, then follow its `catalyst-setup` skill to connect this machine. No Linear token is involved: the CLI writes through the tenant's route as the app actor.

## Configuration

Read the team key from `.catalyst/config.json` (fallback `.claude/config.json`):

```bash
CONFIG_FILE=".catalyst/config.json"
[[ ! -f "$CONFIG_FILE" ]] && CONFIG_FILE=".claude/config.json"

TEAM_KEY=$(jq -r '.catalyst.linear.teamKey // empty' "$CONFIG_FILE")
THOUGHTS_URL=$(jq -r '.catalyst.linear.thoughtsRepoUrl // "https://github.com/org/thoughts/blob/main"' "$CONFIG_FILE")
```

```json
{ "catalyst": { "linear": { "teamKey": "ENG" } } }
```

The team key is all the CLI needs; it resolves the team id, its states and its labels from the tenant contract. When no key is configured, ask the person which team, or read it from an existing ticket's identifier prefix.

## URL mapping for thoughts documents

- `thoughts/shared/...` → `{thoughtsRepoUrl}/repos/{project}/shared/...`
- `thoughts/{user}/...` → `{thoughtsRepoUrl}/repos/{project}/{user}/...`
- `thoughts/global/...` → `{thoughtsRepoUrl}/global/...`

## Default values

- **State**: a new ticket lands in the team's default state.
- **Priority**: default Medium (3). Urgent (1), High (2), Medium (3), Low (4).

## Worked example: Thought → Ticket → Plan → Implement

```bash
/catalyst-dev:research-codebase "authentication patterns"
# Saves to thoughts/shared/research/auth-patterns.md

/catalyst-dev:linear create thoughts/shared/research/auth-patterns.md
# Drafts the ticket, then: catalyst-skills write create --team ENG --title "..." --stdin

/catalyst-dev:create-plan
/catalyst-dev:implement-plan thoughts/shared/plans/2025-01-08-auth-feature.md
/catalyst-dev:create-pr
/catalyst-dev:merge-pr
```

On a tenant, Catalyst moves the card as its phases run. When the person asks for a move by hand, it is one slot move: `catalyst-skills write state ENG-123 --slot pr`.
