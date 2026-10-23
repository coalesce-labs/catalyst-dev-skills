---
name: pickup
description: "Pick up a ticket another agent stopped working on: take the ticket lease first, then load the branch head, the pull request with its review threads, the latest handoff and the plan and research documents, and say whether to continue on that branch or restart, and why. Stops and reports the holder and deadline, loading and changing nothing, when someone else holds the ticket. Use when the user says 'pick up PROJ-123', 'take over this ticket', 'continue where the last agent stopped', or when a ticket's lease lapsed with work in progress. Not for resuming your own session from a handoff you were handed (resume-handoff)."
disable-model-invocation: false
allowed-tools: Read, Bash, TodoWrite
argument-hint: "[TICKET] [--agent <name>]"
version: 1.0.0
---

# Pick up a ticket

The lease comes first. Nothing about the ticket is read, and nothing changes, until this agent holds it.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

When `CATALYST_PHASE` is set the run is unattended: never ask and wait.

## Step 1: Name the ticket and the agent

- **Ticket:** `$CATALYST_TICKET`, else the id in the arguments. With neither, run `catalyst work available --json` and take a ticket whose row names a `lastHolder`: a lease lapsed there with work behind it. If no row does, report that nothing is waiting and stop.
- **Agent:** `--agent <name>` from the arguments, else the name the person or the dispatcher gave this agent. The name matches `[a-z0-9-]{1,40}` and stays the same across this agent's restarts, so a retry finds its own lease instead of being refused by it. With no name, stop and report `agent_unnamed`.

## Step 2: Take the lease

```bash
catalyst lease take "$TICKET" --agent "$AGENT" --json | node "${CLAUDE_SKILL_DIR}/scripts/pickup.mjs" lease
```

- **Exit 0:** this agent holds the ticket. Keep the printed generation, deadline, previous holder and last progress for the report.
- **Exit 3:** someone else holds the ticket, a running phase occupies it, or the cloud refused. Report the printed lines as they are: the holder and deadline, or the reason. Then stop. Do not read the branch, the pull request or any document, and do not release a lease you never took.
- **Exit 2:** the CLI printed no result, usually because this machine is not connected. Report that and stop.

## Step 3: Load where the work stopped

```bash
node "${CLAUDE_SKILL_DIR}/scripts/pickup.mjs" facts "$TICKET" > "${TMPDIR:-/tmp}/pickup-facts.json"
```

Run it in the ticket's repository. It finds the ticket's pull request (open first, then the most recent) or, with none, the branch on `origin` that names the ticket with the newest commit, and records the head, the commits beyond the base, the unresolved review threads, the latest handoff with the head it recorded, and the plan and research documents. Then:

1. Read the handoff with the `resume-handoff` skill, passing its path. It verifies the handoff against the code and reads the documents it cites.
2. Read every unresolved review thread on the pull request (the review-comments skill lists them), because they are the first work on a branch you continue.
3. Read the ticket: on a cloud account, `catalyst query issue <ID>`.

## Step 4: Decide and report

```bash
node "${CLAUDE_SKILL_DIR}/scripts/pickup.mjs" verdict < "${TMPDIR:-/tmp}/pickup-facts.json"
```

It prints `verdict:` (`continue`, `restart` or `done`) and one `reason:`. Follow [`references/verdict.md`](references/verdict.md) for what each verdict means, when your own reading overrides it, and the report's shape.

## Keeping the lease

The lease lapses after its time to live unless it is renewed with new progress. Renew after each commit you push (`catalyst lease renew "$TICKET" --commit <sha>`), each pull request you open (`--pr <n>`), and each document you write (`--artifact <path>`). A renewal that names nothing new is refused and the deadline does not move. Release the lease when you stop (`catalyst lease release "$TICKET"`), so the next agent can take it at once instead of waiting for it to lapse.
