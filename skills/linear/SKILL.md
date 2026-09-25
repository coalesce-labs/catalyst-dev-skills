---
name: linear
description:
  "Manage Linear tickets on a Catalyst Cloud tenant. **ALWAYS use when** the user says 'create a
  ticket', 'update the ticket', 'move ticket to', 'search Linear', or wants to create tickets from
  thoughts documents, comment on a ticket, or move it through the workflow. Reads and writes go
  through the Catalyst Cloud CLI as the tenant's app actor."
disable-model-invocation: false
allowed-tools: Bash(catalyst-skills *), Bash(npx @catalyst-cloud/catalyst-skills *), Read, Write, Edit, Grep
version: 2.0.0
---

# Linear - Ticket Management

Create tickets from thoughts documents, comment on them, move them and search them, on the Catalyst Cloud tenant this machine is connected to.

Tenant ticket work belongs to the Cloud pack (`coalesce-labs/catalyst-cloud-skills`). Its `catalyst-linear` skill is the full reference for reading and writing a tenant's tickets. This skill is the coding-workflow entry point to the same path: every read and write below is one `catalyst-skills` verb, which reads the tenant contract, posts to the tenant's write route as the Catalyst app actor, and needs no Linear credential of its own.

## Setup check (first, every session)

Run `catalyst-skills status`. If the command is missing, use `npx @catalyst-cloud/catalyst-skills status`. It names the tenant this machine is connected to. If it says the machine is not connected, stop and tell the person: connecting is the Cloud pack's setup (`npx skills@latest add coalesce-labs/catalyst-cloud-skills --all -g`, then its `catalyst-setup` skill). Never ask for a personal Linear token and never call Linear directly; a write that does not go through the tenant route is the path this skill replaces.

**Phase-container guard:** when `CATALYST_PHASE` is set you are inside a Catalyst Cloud phase container, where the runner owns every ticket write. Skip every write here, say so in one line, and continue.

## REQUIRED: ticket format gate

**Before creating ANY ticket, apply the `/catalyst-dev:gherkin-ticket` standard**: an outcome-first title (`<actor> should <outcome> [so that <benefit>]`, no `[Component]` prefix) and a body leading with a plain-English use case, then tiered Gherkin acceptance criteria. Hard gate: do not draft a title or description without it. A component goes in a label, not the title.

## The verbs

| want | run |
| -- | -- |
| one ticket, with its comments, relations, labels and PRs | `catalyst-skills query issue <ID>` |
| a search across tickets, PRs and projects | `catalyst-skills query search <terms>` |
| a team's tickets, filtered | `catalyst-skills query issues --team <KEY> [--state <name>] [--all]` |
| a comment | `catalyst-skills write comment <ID> --body <text>` or `--stdin` |
| a card move | `catalyst-skills write state <ID> --slot <slot>` |
| a label on or off | `catalyst-skills write label <ID> --add <name> --remove <name>` |
| a new ticket | `catalyst-skills write create --team <KEY> --title <text> --stdin` (the description on stdin) |

Every read prints a `source:` line on stderr (the local replica when it is fresh, else the tenant API). Quote it when freshness matters. Every write spends one unit of the tenant's daily write budget; batch what you can and report a refusal instead of retrying it. `--description` and `--stdin` on `write create` need `catalyst-skills` 0.8.0 or newer.

## Workflow status

A card moves by slot, never by a stage name: `dispatch`, `intake`, `research`, `plan`, `implement`, `remediate`, `verify`, `review`, `pr`, `done`, `canceled`. The CLI resolves the slot to the team's live state from the tenant contract and refuses a slot the team has not mapped. `--state-type backlog` parks a card. Moving a card to `dispatch` hands it to Catalyst to run, so do that only when the person asks for it.

On a tenant, Catalyst moves a card itself as its phases run. Move one by hand only when the person asks.

## Action-specific instructions

| action | steps |
| --- | --- |
| Create a ticket from a thoughts doc | [`references/creating-tickets.md`](references/creating-tickets.md) |
| Comment, move through workflow, or search | [`references/moving-and-searching.md`](references/moving-and-searching.md) |
| Configuration and a worked example (thought → ticket → plan → implement → PR) | [`references/setup-and-examples.md`](references/setup-and-examples.md) |

## Notes

- **A decision for a human is not a ticket.** Raise it as an ask (the `ask` skill, or the Cloud pack's `what-needs-me`), so it carries options, a default and what it blocks.
- **Cite a new ticket's identifier only after `write create` prints it.** A guessed number is usually a real, unrelated ticket.
- **Labels are resolved through the tenant contract.** A Catalyst label name resolves to its id; any other label needs its id, which `query issue` shows under `labels[]`.
