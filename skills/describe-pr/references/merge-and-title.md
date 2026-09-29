# Merge Descriptions and Generate the Title (Steps 6–9)

## Step 6 — Merge descriptions intelligently

**Auto-generated sections (always regenerate from ALL changes):** Summary, Changes Made, How to Verify It, Changelog Entry.

**Preserve manual edits in:** Reviewer Notes, Screenshots/Videos, manually checked boxes, Post-Merge Tasks (append new, keep existing).

Merge new content into existing sections rather than overwriting them wholesale — e.g. append a "**New changes** (since last update):" subsection under each area that changed. Add a change-summary block at the top listing what happened in each update (see the metadata format in [metadata-and-errors.md](metadata-and-errors.md)).

## Step 7 — Add the Linear reference

```markdown
## Related Issues/PRs

- Fixes https://linear.app/{workspace}/issue/{ticket}
- Related to #NNN (reference sibling work by its **GitHub PR number**)
```

**Never** reference a sibling ticket by a bare Linear token or issue URL in prose — see [linear-sibling-guard.md](linear-sibling-guard.md) for why, and for the mechanical guard block that neutralizes any sibling tokens the description still ends up carrying. The own ticket's `Fixes` line above is correct and intentional; only sibling references need this treatment.

Get the ticket's title and description with `catalyst_ticket_json <ID>` (`scripts/lib/catalyst-cloud-read.sh`). On a machine connected to a cloud account it runs `catalyst query issue <ID> --json`, or the `npx -p @catalyst-cloud/cli catalyst` form without the binary, and a failed read is reported, never rerouted to direct Linear. The replica helper is only for a machine with no cloud connection, an operator's.

## Step 8 — Generate the updated title

```bash
if [[ "$ticket" ]]; then
    # The cloud route on a connected machine (a failed read is reported, never rerouted); the
    # replica helper off the cloud. Either way a missing title falls back to the branch name below.
    source "${CLAUDE_SKILL_DIR}/scripts/lib/catalyst-cloud-read.sh"
    ticket_json=$(catalyst_ticket_json "$ticket") \
        || echo "describe-pr: no ticket title for $ticket (see the error above); titling from the branch name." >&2
    ticket_title=$(printf '%s' "$ticket_json" | jq -r '.title // empty')
    if [[ -n "$ticket_title" ]]; then
        title="$ticket: ${ticket_title:0:60}"
    else
        title="$ticket: $(echo "$branch" | sed "s/^.*$ticket-//" | tr '-' ' ')"
    fi
else
    title="Brief summary of main change"
fi
```

`catalyst query issue` carries its own freshness gate. Off the cloud, the replica helper is replica-first with a loud `linearis` fallback, never a bare `linearis issues read`. A title from the branch name is a formatting fallback only: it never justifies reading Linear another way. Title is an auto-generated section: update it without prompting.
