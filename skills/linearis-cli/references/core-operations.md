# Core operations — full syntax

> ⛔ **Assign the stage name, then check it — never inline `$(state …)` into the query.** A command substitution used as an *argument* does not propagate its exit status, so a refused slot leaves `linearis` running with an empty `--status` and the named refusal becomes an empty result set. `VAR=$(state slot) || exit 1` DOES propagate: the assignment's status is the substitution's. `state() { bash "${CLAUDE_SKILL_DIR}/scripts/linear-transition.sh" --print-state --transition "$1" --team "$TEAM"; }`


Full CRUD and comment-thread commands behind `SKILL.md` → "Core Operations". They serve the operator exceptions (relations, editing a ticket after it exists, cycle and milestone writes, assignment) and a Linear workspace with no cloud account. On a cloud account, search with `catalyst query search <terms>`, create with `catalyst write create`, move a card on request with `catalyst write state --slot`, label with `catalyst write label`, and comment with `catalyst write comment`. Run `linearis usage` / `linearis <domain> usage` for the authoritative, always-current flag list — prefer it to memorizing.

## Search tickets

```bash
linearis issues search "keyword"
linearis issues search "auth bug" --team "$TEAM" --status "$(state todo)"
```

## Create a ticket

```bash
linearis issues create "Title" --team ENG
linearis issues create "Title" --team ENG --description "Details" --priority 2 --project "Project"
```

`create` also accepts `--status`, `--cycle`, `--estimate`, `--parent-ticket`, `--due-date`, and the relation flags (`--blocks`/`--blocked-by`/`--relates-to`/`--duplicate-of`) — set them at creation time instead of a wasteful second `update`.

## Update a ticket

```bash
linearis issues update ENG-123 --status "$(state inProgress)"
linearis issues update ENG-123 --priority 1
linearis issues update ENG-123 --labels "bug" --label-mode add
linearis issues update ENG-123 --project "Project Name"
linearis issues update ENG-123 --project-milestone "Milestone Name"
```

`update` also supports relation flags (`--blocks`/`--blocked-by`/`--relates-to`/`--duplicate-of`/`--remove-relation`) and clearers (`--clear-parent-ticket`/`--clear-cycle`/`--clear-estimate`/`--clear-due-date`/`--clear-project-milestone`/`--clear-labels`).

## Comment on a ticket — full command set

Commenting is a **thread model** under `issues` (the flat `comments` domain is a deprecated compatibility facade). Both `issues discuss` and `issues discussions` accept either a UUID or an `ABC-123` identifier.

```bash
# An AGENT starting a comment/discussion thread — go through linear-reply.mjs, NOT `discuss`
# (SKILL.md's ⛔ callout — `discuss` posts under the human's own identity):
direnv exec . node "${CLAUDE_SKILL_DIR}/scripts/linear-reply.mjs" ENG-123 --as <AGENT> --body-file <path> --top

# `linearis issues discuss` — ONLY when the comment is genuinely meant to be the human's own:
linearis issues discuss ENG-123 --body "Starting work on this"

# List root threads on a ticket (use BEFORE re-posting a mirror comment, to avoid dups)
linearis issues discussions ENG-123

# Reply to a thread — <thread> MUST be a root thread ID (from discuss/discussions), NOT ENG-123.
# An agent's reply still goes through linear-reply.mjs --parent <thread-id>, not `issues reply`
# (same identity risk as `discuss` — `issues reply` also posts under the personal token).
linearis issues reply <thread-id> --body "follow-up"
linearis issues replies <thread-id>                # list replies in a thread

# Edit / delete (split verbs in the modern path)
linearis issues edit <comment-id> --body "..."     # edit a root or reply comment
linearis issues edit-reply <reply-id> --body "..."
linearis issues delete-comment <comment-id>
linearis issues delete-reply <reply-id>
```

`comments create` still works but is deprecated and loses nested-reply support — don't teach it as canonical. See the `ask` skill for the ask/decision-ticket SOP, and its `scripts/ask.mjs` for the `create`/`accept` verbs.

## Common mistakes

```bash
linearis issues get ENG-123             # ❌ no 'get' — use 'read'
linearis issue view ENG-123             # ❌ no 'view' — use 'read'
linearis issues comment ENG-123 "text"  # ❌ no 'comment' subcommand — use 'issues discuss <id> --body'
linearis comments create ENG-123 ...     # ⚠️ deprecated facade — prefer 'issues discuss'
linearis issues update ENG-123 --state  # ❌ use --status, not --state
linearis project-milestones list        # ❌ the domain is 'milestones'
```

## Other domains (not detailed above)

Linearis also exposes these. **Read-only** subcommands (`list`/`read`/`status`/`download`) are safe; `create`/`update`/`delete`/`archive`/`upload` **mutate** — don't run them in audits.

- `linearis users list [--active]` — workspace members (id/name/email); resolve assignee/owner UUIDs. Note service/OAuth accounts have synthetic emails (`*@oauthapp.linear.app`).
- `linearis attachments list <issue> [--source-type github]` — PR/Slack/link attachments.
- `linearis documents list [--project X | --issue ENG-123]` + `documents read <doc>` — project/issue docs (`delete` trashes, not hard-delete).
- `linearis initiatives list [--status active] [--with-projects]` + `initiatives read <init>` — roadmap grouping above projects (defaults to excluding archived; pass `--include-archived`).
- `linearis files download <url> --output <path>` — fetch an asset from Linear storage.
- `linearis auth status` / `auth login` — verify/refresh the API token.
