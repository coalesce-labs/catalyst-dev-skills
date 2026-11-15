# The ask-triage record

One JSON object per run, printed last. It is the unit of evaluation: the verdict and the reasoning behind it, so a reviewer can grade the call and later rules or a cheaper model can learn the pattern.

```json
{
  "schema": "ask-triage/v1",
  "ask": "ENG-124",
  "ask_title": "Unblock ENG-123 — it is holding 1 ticket",
  "subject": ["ENG-123"],
  "mode": "propose",
  "evidence_checked": [
    { "what": "PR #7293 checks", "link": "https://github.com/<org>/<repo>/pull/7293/checks" }
  ],
  "findings": [
    { "evidence": "PR #7293 checks", "showed": "Check (full) fails: self-application.test.ts:75 expects 35 bun facts, gets 36" }
  ],
  "root_cause": "The subject's PR has one real test failure and one unresolved review thread; the generator fired only because the ticket sits in PR.",
  "classification": "mechanical",
  "classification_reason": "Nothing needs deciding: both blockers have an obvious fix and the work is otherwise done.",
  "options_considered": [
    { "option": "A — Resubmit to Todo (the ask's recommendation)", "rejected_because": "An open PR with finished work exists; resubmitting redoes it." }
  ],
  "chosen_action": "Hand the two fixes to the owning seat, then close the ask with the evidence.",
  "next_steps": ["fix-on-branch"],
  "ask_option": null,
  "reaches_human": false,
  "stale_evidence": [
    { "field": "snapshot.subjects[0].ledger.branchHeadEvidence.hold.headSha", "said": "a1b2c3d4", "newer": "PR head e5f6a7b8", "source": "snapshot.subjects[0].pullRequests[0].headSha" }
  ],
  "round_table": [],
  "action_taken": "none",
  "confidence": 0.85,
  "what_would_change_my_mind": "The owning seat reporting it abandoned the PR, or the hold turning out to be a product decision.",
  "pattern": "no-relay-entry",
  "secondary_patterns": ["ci-failure"],
  "pattern_detail": "unblock generator fired on a human-owned PR-stage ticket; PR #7293 fails a count test",
  "owner_seat": "seat-2",
  "notes": ""
}
```

## Field rules

- `classification` is one of `mechanical`, `decidable`, `human`.
- `classification_reason` names the rule from classify.md that applied, or the limit it hit.
- `options_considered` includes the ask's own recommended or default option whenever the ask has one, each with why it was rejected (or `"chosen"`).
- `next_steps` is the ordered list of steps that move the work, each one of:
  - `merge-main`: merge current main into the ticket's branch, resolve the conflicts, run the check, push;
  - `fix-on-branch`: change code on the ticket's branch: a fix the evidence names, or work the plan still owes;
  - `review-at-head`: get the missing review recorded at the current head;
  - `rerun-validate`: run validate again at the current head with no code change;
  - `grant-round`: grant one more repair round to the fleet;
  - `accept`: accept the work as it is and file what remains as a follow-up ticket;
  - `re-plan`: rewind the ticket to plan;
  - `route-to-capable-agent`: hand the step to an agent that holds the access the fleet session lacks;
  - `release-lever`: release a park or hold whose cause is gone;
  - `close-moot`: close the ask because its premise is gone;
  - `wait`: nothing to do yet: work already in flight decides it;
  - `human-step`: a step only a person can take.
- `ask_option` is the letter of the ask's listed option the steps amount to, or null when none fits (the answer is then a `DECIDED:` line naming the steps). [`repair-cap.md`](repair-cap.md) step 5 maps steps to letters.
- `reaches_human` is true only when a step needs something no agent holds; false when an agent or the platform can carry every step.
- `stale_evidence` lists each input a newer input contradicts, as `{ field, said, newer, source }`, and is `[]` when none is. Every record checks for it ([`repair-cap.md`](repair-cap.md) step 6).
- `round_table` is one `{ round, changed_code, cause, evidence }` per counted repair round, `cause` one of `platform`, `base`, `code`, `unknown`; `[]` for an ask that is not about repair rounds.
- `action_taken` is `"none"` in `propose` mode; in `act` mode it lists what was actually done, with links.
- `confidence` is 0 to 1: how likely a careful human reviewer agrees with the classification and the chosen action.
- `pattern` and every `secondary_patterns` entry come from the closed table in classify.md (`other` when nothing fits, explained in `notes`). Specifics go in `pattern_detail`, never in a new tag.
- Every `findings[].evidence` matches an entry in `evidence_checked`.
- `pattern` is `moot` when the premise check ended the run; the record then carries one finding and no `options_considered` beyond the ask's own default.
- `proposed_answer` is present only on a `decidable` record, and omitted on every other class:

  ```json
  "proposed_answer": { "option_label": "B — Keep the default and ship the safe half", "confidence": 0.86 }
  ```

  `option_label` is one of the ask's listed options, copied verbatim (letter, dash and text), so the platform can match it without interpretation. `confidence` is 0 to 1 for this option alone. The platform applies an answer only at 0.8 or above and escalates the rest, so report the confidence you have.

## Where it goes

On a laptop, print it to stdout as the last output. In a triage container, write it to `$CATALYST_ARTIFACT_DIR/ask-triage.json` and print it too ([`container.md`](container.md)). One run writes one record.

## Telemetry the caller adds

The caller, not the skill, adds what the skill cannot measure about itself: `model`, `input_tokens`, `output_tokens`, `cost_usd`, `wall_ms`, `started_at`. Later outcome fields (`resolved`, `overruled_by_human`, `reopened`) are filled when the ask closes.
