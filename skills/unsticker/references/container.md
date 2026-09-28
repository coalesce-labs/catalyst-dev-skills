# Container mode (`CATALYST_PHASE=triage`)

In a triage container the unsticker reads two inputs, calls nothing outside, and writes exactly one file: `$CATALYST_ARTIFACT_DIR/ask-triage.json`. The platform, not the session, posts the record and does every Linear write and lever.

## Inputs (read only)

- **The ask id**, from the prompt.
- **The phase replica** at `$CATALYST_REPLICA_DB`: open it read only (`sqlite3 -readonly`, or `bun:sqlite` with `{ readonly: true }`). Read the ask and its subject tickets from `issues`, `comments`, `relations`, `issue_labels` and `labels`, filtering `removed_at IS NULL`.
- **The evidence snapshot**, the JSON file the prompt names (the runner also exports its path as `CATALYST_TRIAGE_SNAPSHOT`). It carries the relay ledger (phase, park, hold, head sha agreement), the eligibility verdict, holds, fences, leases with their heartbeats, and each subject PR's state, checks and review threads.

When a fact is in neither input, do not go and fetch it. Say it was unavailable in `notes`, lower `confidence`, and take the more conservative class. When the ask itself is in neither input, write a record with `classification: "human"`, pattern `other`, confidence 0, and `notes` naming what was missing.

## Never

- No `linearis`, `gh`, `git fetch`, `curl` to a mirror or admin route, or any other network call. The container carries no personal token or admin bearer.
- No write anywhere except the record file: no Linear comment, no label, no lever, no temp file outside `$CATALYST_ARTIFACT_DIR`.
- No acting. `mode` is `"propose"` and `action_taken` is `"none"`. Put the would-be action in `chosen_action`.
- No other skill. The `ask` and `linearis` skills are laptop tools.

## Steps

1. **Read the ask** from the replica: title, description, labels, state, comments oldest first, and relations. The subject is what the ask blocks.
2. **Check the premise first.** If the subject is Done or Canceled in the replica, its PR is merged or closed in the snapshot, or a comment already carries the answer (`DECIDED:` or a relayed answer), the ask is moot. Record `classification: "mechanical"`, pattern `moot`, one finding citing that evidence, and stop there, without the rest of the investigation. The exception is a held category from [`classify.md`](classify.md): a release or spend ask whose subject merged is not moot.
3. **Investigate the subject** from the snapshot only:
   - PR: conflicts, failing checks and whether each looks real, review threads unresolved at head, queue and hold labels.
   - Ledger: phase, park or hold, and head agreement. `disagrees` means the mirror missed a push; say so.
   - Owner: live when a lease holds a recent heartbeat. Never infer it from a seat name or a handoff author.
   - Fences: a `catalyst-local-lane` fence means a local lane owns the ticket.
   - Other open asks with the same subject (duplicates).
4. **Classify** with [`classify.md`](classify.md): check the always-escalate list first, then pick the class and a pattern from the closed table.
5. **Write the record** in the shape in [`record.md`](record.md), then print the same object as the last output. A `decidable` record carries `proposed_answer`: the option label copied verbatim from the ask, and a `confidence`. The platform only applies an answer at 0.8 or above, so report the confidence you have, not the one that clears the bar.

Cite every finding to its source: a replica row (`issues:CTC-3682 state`), or a snapshot path (`snapshot.pull_requests[0].checks`).
