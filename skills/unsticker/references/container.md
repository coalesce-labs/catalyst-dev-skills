# Container mode (`CATALYST_PHASE=triage`)

In a triage container the unsticker reads two inputs, calls nothing outside, and writes exactly one file: `$CATALYST_ARTIFACT_DIR/ask-triage.json`. The platform, not the session, posts the record and does every Linear write and lever. The run has a hard deadline: write the record early and refine it, so a run cut off still leaves one.

## Inputs (read only)

- **The ask id**, from the prompt, which also carries the ask's title and description.
- **The phase replica** at `$CATALYST_REPLICA_DB`: open it read only (`sqlite3 -readonly`, or `bun:sqlite` with `{ readonly: true }`). Read the ask and its subject tickets from `issues`, `comments`, `relations`, `issue_labels` and `labels`, filtering `removed_at IS NULL`. The subject's comments carry each phase and repair round's outcome: what failed, what the round changed, which head validate passed.
- **The evidence snapshot**, the JSON file the prompt names (the runner also exports its path as `CATALYST_TRIAGE_SNAPSHOT`). Its top level is `capturedAtMs`, `subjects` and `priorDeterminations` (earlier records for this ask). Each entry of `subjects` carries:
  - `identifier`, `title`, `state`, `labels` and `fenced` (the fence flag);
  - `eligibility`: the verdict, as `eligible`, `reason`, `detail` and `failureClass`;
  - `ledger`: the relay's `relayPhaseState`, `relayPhaseFailures`, `relayFailureLedger`, `relayParkLedger` and `branchHeadEvidence`;
  - `leases`: each live lease's `phase`, `holder` and `deadlineMs` (the time the lease runs out);
  - `pullRequests`: each open PR's `repoId`, `number`, `state`, `draft`, `headSha` and `mergeableState`.

  The snapshot holds no check results or review threads, and no merged PRs: a PR that merged has no row. Compare a lease's `deadlineMs` with `capturedAtMs` to tell a live lease from an expired one.

When a fact is in neither input, do not go and fetch it. Say it was unavailable in `notes` and lower `confidence`. When the replica is missing, work from the ask text in the prompt and the snapshot, and say so; a missing replica alone does not make the ask a person's. When the ask itself is in neither input, write a record with `classification: "human"`, pattern `other`, confidence 0, and `notes` naming what was missing.

## Never

- No `linearis`, `gh`, `git fetch`, `curl` to a mirror or admin route, or any other network call. The container carries no personal token or admin bearer.
- No write anywhere except the record file: no Linear comment, no label, no lever, no temp file outside `$CATALYST_ARTIFACT_DIR`.
- No acting. `mode` is `"propose"` and `action_taken` is `"none"`. Put the would-be action in `chosen_action` and `next_steps`.
- No other skill. The laptop's Linear and decision tools do not run here.

## Steps

1. **Read the ask** from the replica (or the prompt): title, description, labels, state, comments oldest first, and relations. The subject is what the ask blocks or is related to.
2. **Check the premise first.** If the subject is Done or Canceled, or it has no open PR row and a comment records that the PR merged or closed, or a comment already carries the answer (`DECIDED:` or a relayed answer), the ask is moot. Record `classification: "mechanical"`, pattern `moot`, `next_steps: ["close-moot"]`, one finding citing that evidence, and stop there. The exception is a held category from [`classify.md`](classify.md): a release or spend ask whose subject merged is not moot.
3. **Repair-cap, validate-hold and remediate-raised asks:** follow [`repair-cap.md`](repair-cap.md) steps 1 to 4, then write the record at once with what they gave, before reading further.
4. **Investigate the subject** from the inputs:
   - PR: draft or ready, `mergeableState` (`dirty` means a conflict with main), head sha.
   - Ledger: phase, park or hold, and head agreement. A hold head older than the PR head means the hold judges stale code; say so.
   - Owner: live when a lease's `deadlineMs` is after `capturedAtMs` and no outcome comment shows its round already ended. Never infer it from a seat name or a handoff author.
   - Fences: a `catalyst-local-lane` fence means a local lane owns the ticket.
   - Other open asks with the same subject (duplicates).
5. **Classify** with [`classify.md`](classify.md): check the always-escalate list first, then pick the class from the step the evidence fixes, and a pattern from the closed table.
6. **Check for stale inputs** ([`repair-cap.md`](repair-cap.md) step 6) and list each one in `stale_evidence`.
7. **Write the final record** in the shape in [`record.md`](record.md), overwriting the early one, then print the same object as the last output. A `decidable` record carries `proposed_answer`: the option label copied verbatim from the ask, and a `confidence`. The platform only applies an answer at 0.8 or above, so report the confidence you have, not the one that clears the bar.

Cite every finding to its source: a replica row (`issues:ENG-123 state`, `comments:ENG-123 <created_at>`), or a snapshot path (`snapshot.subjects[0].ledger.relayPhaseFailures`).
