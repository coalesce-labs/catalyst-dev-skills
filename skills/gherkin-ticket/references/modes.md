# Modes: draft, from a thoughts doc, rewrite, link prerequisites

**Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue. Off the cloud, an operator uses the Linearis CLI directly (`linearis <domain> usage` prints its syntax).

## DRAFT (new ticket)

1. Extract the real use case from what the user said; ask "who benefits and why?" when it is unclear.
2. Write the outcome title.
3. Pick the tier (A, B or C) and write the body.
4. Check the title and body against every rule in `SKILL.md`.
5. File it once the person approves. On a cloud account, write the body to a file and file it
   with `catalyst write create` (if `catalyst` is missing, prefix `npx -p @catalyst-cloud/cli`);
   `--label <name>` is repeatable and priority is 1 Urgent to 4 Low. Skip this step when
   `CATALYST_PHASE` is set: the runner owns ticket writes there.
   ```bash
   DESCRIPTION="$(cat /path/to/description.md)"
   [ -n "$DESCRIPTION" ] || { echo "no description read; not filing a ticket without its body" >&2; exit 1; }
   catalyst write create --team "$TEAM_KEY" --title "<title>" --priority "$PRIORITY" --description "$DESCRIPTION" --json
   ```
   Pass the body with `--description`, never `--stdin`: an older CLI files a `--stdin` ticket
   without its body. Cite the new identifier only after the command prints it.
6. Link any prerequisites (below).

## FROM A THOUGHTS DOC

1. Read the document (given a topic, search `thoughts/` and ask if several match), the code and
   docs it references, and any existing ticket for it (`catalyst query search <terms>`).
2. Draft as in DRAFT: technical decisions and file refs go under `## Technical notes`, and a
   `## References` section links the source document.
3. Confirm accuracy, priority (default 3, Medium) and labels, then file as in DRAFT step 5.
4. Offer to record the new identifier in the document's frontmatter (`linear_ticket: TEAM-123`).

## REWRITE (existing ticket)

1. Read the full existing ticket in ONE command (the function is only defined in the shell that
   sourced it):
   `source "${CLAUDE_SKILL_DIR}/scripts/lib/catalyst-cloud-read.sh" && catalyst_ticket_json "$TICKET"`.
   On a machine connected to a cloud account that is `catalyst query issue "$TICKET" --json` (the
   Cloud pack's `catalyst-linear` route), which returns the title, description, comments, relations
   and labels; a failed read is reported, so fix it (`catalyst ready`) rather than read Linear
   another way. Off the cloud, an operator's read goes through the replica helper, which does not
   mirror comments: fetch them with `linearis comments list "$TICKET"` and each thread's replies
   with `linearis issues replies <thread>`, so technical detail in replies isn't dropped.
2. Keep all technical content (file refs, repro steps, root-cause notes, SHAs). Move it under a
   `## Technical notes` section below the Gherkin, so it stays without leading.
3. Rewrite the title outcome-first and the body into the right tier.
4. Show a before → after so the user can check it before you push the update.
5. Apply it. The cloud route has no title or description write, so on a cloud account
   hand the approved title and body to the person to paste into Linear, and say so. Only an
   operator machine with `linearis` updates the ticket directly (`linearis issues update`).

## Linking prerequisites

The cloud write route has no relation write. On a cloud account, name each genuine prerequisite
to the person so they add the `blocked by` link in Linear. An operator machine links it directly
once the ticket exists:

```bash
# Operator only, after the ticket exists (`linearis issues usage` prints the syntax):
linearis issues update <NEW-TICKET> --blocked-by <PREREQ-TICKET>
```
