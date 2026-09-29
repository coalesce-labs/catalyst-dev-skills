# Creating tickets from thoughts documents

## Steps

1. **Locate and read the thoughts document.** Given a path, read it directly. Given a topic or keyword, search `thoughts/` with Grep; if several match, show the list and ask.

2. **Analyze the content.** Identify the core problem or feature, extract the key technical decisions, note specific files, look for action items, and judge the stage (ideation or ready to implement).

3. **Check related context.** Read any code files or other thoughts documents it references. Look for existing tickets it mentions, with `catalyst query search <terms>`.

4. **Draft the ticket** following the `gherkin-ticket` skill's standard, and present it:

   ```
   ## Draft Linear Ticket

   **Title**: [outcome-first use-case sentence — <actor> should <outcome> [so that <benefit>];
   no mechanism/file/symbol names, no [Component] prefix]

   **Description**:
   [short plain-English use case — who benefits and why]

   [Gherkin acceptance criteria in a ```gherkin fenced block, at the right tier:
    A = features/bugs (full Given/When/Then), B = bugs (Then states correct behavior + # CURRENTLY:),
    C = pure chores (Context/Motivation/Outcome prose)]

   ## Technical notes
   - [implementation detail, constraints — preserved, but BELOW the use case]

   ## References
   - Source: `thoughts/[path]` ([View on GitHub](converted URL))
   - Related code: [any file:line references]
   ```

5. **Interactive refinement.** Confirm accuracy, priority (default Medium, 3), extra context and labels. A new ticket lands in the team's default state.

6. **Create it through the tenant route.** Write the approved description to a file, read it back, and refuse to file when nothing was read. Pass the priority agreed in step 5 (1 Urgent, 2 High, 3 Medium, 4 Low):

   ```bash
   DESCRIPTION="$(cat /path/to/description.md)"
   [ -n "$DESCRIPTION" ] || { echo "no description was read from /path/to/description.md; not filing a ticket without its body" >&2; exit 1; }
   catalyst write create --team "$TEAM_KEY" --title "<title>" --priority "$PRIORITY" --description "$DESCRIPTION" --json
   ```

   Use `--description`, not `--stdin`: a CLI from before ticket bodies existed accepts `--stdin` on `write create` and silently files the ticket without its body, but it refuses the unknown `--description` flag. If the CLI answers that `--description` is unknown, update the Cloud CLI and try again. Never file the ticket without its body.

   `--team` takes the team key (the prefix of its ticket identifiers); the CLI resolves the team from the tenant contract. `--label <name>` is repeatable. The JSON result carries the new identifier. Cite it only after the command prints it.

7. **Name genuine prerequisites.** Catalyst does not infer a dependency from prose, and the tenant write route has no relation write yet. When the new ticket has a true prerequisite (one that must reach Done or Canceled first), tell the person which ticket it is so they can add the `blocked by` link in Linear. Leave out anything that is not a true prerequisite: a missing blocker is recoverable, and a false one stalls real work.

8. **Post-creation.** Show the ticket URL. Offer to add a comment, or to record the ticket in the source thoughts document:

   ```
   ---
   linear_ticket: [TEAM-123]
   created: [date]
   ---
   ```
