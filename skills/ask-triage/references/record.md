# The ask-triage record

One JSON object per run, printed last. It is the unit of evaluation: the verdict and the reasoning behind it, so a reviewer can grade the call and later rules or a cheaper model can learn the pattern.

```json
{
  "schema": "ask-triage/v1",
  "ask": "CTC-3690",
  "ask_title": "Unblock CTC-3682 — it is holding 1 ticket",
  "subject": ["CTC-3682"],
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
  "action_taken": "none",
  "confidence": 0.85,
  "what_would_change_my_mind": "The owning seat reporting it abandoned the PR, or the hold turning out to be a product decision.",
  "pattern": "no-relay-entry",
  "secondary_patterns": ["ci-failure"],
  "pattern_detail": "unblock generator fired on a human-owned PR-stage ticket; PR #7293 fails a count test",
  "owner_seat": "catalyst-cloud-56",
  "notes": ""
}
```

## Field rules

- `classification` is one of `mechanical`, `decidable`, `human`.
- `classification_reason` names the rule from classify.md that applied, or the limit it hit.
- `options_considered` includes the ask's own recommended or default option whenever the ask has one, each with why it was rejected (or `"chosen"`).
- `action_taken` is `"none"` in `propose` mode; in `act` mode it lists what was actually done, with links.
- `confidence` is 0 to 1: how likely a careful human reviewer agrees with the classification and the chosen action.
- `pattern` and every `secondary_patterns` entry come from the closed table in classify.md (`other` when nothing fits, explained in `notes`). Specifics go in `pattern_detail`, never in a new tag.
- Every `findings[].evidence` matches an entry in `evidence_checked`.

## Telemetry the caller adds

The caller, not the skill, adds what the skill cannot measure about itself: `model`, `input_tokens`, `output_tokens`, `cost_usd`, `wall_ms`, `started_at`. Later outcome fields (`resolved`, `overruled_by_human`, `reopened`) are filled when the ask closes.
