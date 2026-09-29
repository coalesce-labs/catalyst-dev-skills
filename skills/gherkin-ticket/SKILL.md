---
name: gherkin-ticket
description:
  "Shape every ticket around a scannable use-case before it's filed: an outcome title
  (`<actor> should <outcome> so that <benefit>`) plus tiered Gherkin (Given/When/Then) acceptance
  criteria, even for backend bugs and chores. **ALWAYS use when** the user says 'file a ticket',
  'create a ticket', 'file tickets for', 'open an issue', 'add a ticket', 'log a bug', or whenever
  drafting, titling, rewriting or auditing a ticket."
disable-model-invocation: false
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(catalyst *), Bash(npx -p @catalyst-cloud/cli catalyst *), Bash(linearis *), Bash(jq *), Bash(source *), Bash(linear_read_ticket *)
version: 1.0.0
---

# Gherkin Ticket

Every ticket opens with a use case a stranger can understand: who gets what outcome, under what condition, and why. This skill owns the ticket's format. Reading and filing go through the `catalyst` CLI on a cloud account (the Cloud pack's `catalyst-linear` skill) and, off the cloud, an operator uses the Linearis CLI directly. When another skill is mid-creation, apply these rules to its title and body before the issue is written.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

Before drafting, check for a project override. When it exists, read it; its actor list, required sections and stricter rules win over the defaults here.

```bash
# Optional project-specific ticket style — actor vocabulary, extra sections, stricter tiers
OVERRIDE=".catalyst/ticket-style.md"
[[ -f "$OVERRIDE" ]] && echo "Applying project ticket-style overrides from $OVERRIDE"
```

## Modes

| Mode | When | Read |
|---|---|---|
| DRAFT | a new ticket, or a PRD or plan broken into tickets | `references/modes.md` |
| FROM A THOUGHTS DOC | a ticket drawn from a research or plan document | `references/modes.md` |
| REWRITE | an existing ticket; read it in full with `catalyst_ticket_json` first | `references/modes.md` |
| VALIDATE | an audit: score the ticket against every rule below and report the gaps, changing nothing | this file |

Worked titles and one full example per ticket type are in `references/examples.md`.

## The title is the use case

A starting shape, not a formula: `<Actor> should <outcome> [when <condition>] [so that <benefit>].` The actor is whoever gets value, often a system: Operators, Developers, The scheduler, The daemon, The dashboard.

- Write the shortest title that carries the context and the expected outcome. Keep `so that` only when the benefit adds information and `when` only when the trigger is the point. Vary the phrasing across tickets. Soft cap about 120 characters, exceeded only to remove ambiguity.
- Name the outcome, never the mechanism: no symbol, function, event, file or flag names (`bootReplay`, `--label-mode`) and no unexplained acronyms. If the outcome needs a mechanism to state, work out what the change is *for* and write that. Deep-internals work still makes something better for someone; name them.
- Put the component in a Linear label. The title carries no `[API]`-style prefix.

## The body: tiered Gherkin

Fence every scenario in a ` ```gherkin ` block; Tier C prose stays plain text.

- **Tier A, features and API or behavior changes:** one or more scenarios.
  ```gherkin
  Scenario: <one specific behavior, stated as a complete sentence>
    Given <minimum starting state>
    And <additional precondition>
    When <the single action or event>
    Then <observable outcome>
    And <additional observable outcome>
  ```
- **Tier B, bugs:** a Tier A scenario whose `Then` states the correct behavior, so it goes green when fixed, plus a `# CURRENTLY:` comment for what is broken today.
- **Tier C, chores and refactors with no behavior change:** `Context:`, `Motivation:` and `Outcome:` lines. Add an invariant scenario only for behavior that must survive the change as a testable postcondition.

Scenario rules:
- Exactly one `When`. A second behavior, or a happy path and an edge, each get their own scenario.
- Each scenario title is a complete, specific sentence, unique in the ticket.
- `Then` asserts what a user or caller observes. A backend state change counts only in a scenario labelled technical, and user features leak no DB or queue internals.
- Steps are declarative, with no UI clicks, endpoints or field IDs.
- Values are concrete ("the `ops` team", "HTTP 503"), never "some user" or "valid input".
- `Given` holds the minimum context that triggers the behavior.

## Dependencies

Record each true prerequisite (work that must reach Done or Canceled first) as a Linear `blocked by` link at authoring time; Catalyst reads links, never prose, so a "depends on TEAM-123" sentence does nothing. Leave related tickets, prior art and other teams' work unlinked: a cross-team blocker deadlocks, and a false blocker stalls real work, while triage later adds genuine ones you missed. `references/modes.md` says how to set the link.

## Related skills

- triage — it classifies and estimates each new ticket; a ticket written to this standard makes that step far more reliable.
