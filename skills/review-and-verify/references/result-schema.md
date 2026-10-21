# review-result.json, version 1

The one document this skill writes. In a cloud run, the cloud reads it to post one GitHub review at `reviewed_head`, an inline comment per finding, a "Fixed in <sha>" reply and resolve per fixed thread, and a closing summary. Write every sha as the full 40 lowercase hex characters.

## Example

```json
{
  "version": 1,
  "pr": 1234,
  "reviewed_head": "1111111111111111111111111111111111111111",
  "final_head": "3333333333333333333333333333333333333333",
  "base": "0000000000000000000000000000000000000000",
  "depth": "deep",
  "depth_reason": ["match: db/migrations/0042_add_retry.sql  ^db/migrations/"],
  "merge": { "auto": true },
  "gates": [
    { "step": "plan-conformance", "verdict": "PASS", "detail": "3 of 3 plan phases implemented" },
    { "step": "code-review", "verdict": "FAIL", "detail": "1 finding (F1)" },
    { "step": "type-safety", "verdict": "PASS", "substep": "reward-hacking", "detail": "0 added-line matches" },
    { "step": "tests", "verdict": "PASS", "detail": "src/loop.test.ts: 14 pass" },
    { "step": "security-review", "verdict": "PASS", "detail": "no exploitable path" },
    { "step": "recheck", "verdict": "PASS", "detail": "fix range 1111111..3333333 re-reviewed, nothing new" }
  ],
  "conformance": [
    { "criterion": "Scenario: a failed job is retried at most four times", "source": "ticket scenario 2", "status": "met", "evidence": "src/loop.test.ts:88" }
  ],
  "findings": [
    {
      "id": "F1",
      "path": "src/loop.ts",
      "line": 142,
      "side": "RIGHT",
      "severity": "high",
      "category": "correctness",
      "source": "review-code:diff-bugs",
      "confidence": 92,
      "vote": "CONFIRMED",
      "claim": "The retry counter is never incremented, so a failing job retries forever.",
      "evidence": "src/loop.ts:142 `if (attempts < 4) retry(job)` with no `attempts++` on any path",
      "failure_scenario": "a job that always fails -> retried without limit",
      "verdict": "valid",
      "fix": {
        "sha": "2222222222222222222222222222222222222222",
        "files": ["src/loop.ts", "src/loop.test.ts"],
        "regression_test": "loop.test.ts > stops after four retries",
        "red_before": true,
        "green_after": true,
        "revert_check": true
      },
      "reply": "Fixed in 2222222 at src/loop.ts:142.",
      "resolve_thread": true
    },
    {
      "id": "F2",
      "path": "src/queue.ts",
      "line": 30,
      "side": "RIGHT",
      "severity": "medium",
      "category": "silent-failure",
      "source": "review-code:in-code-guidance",
      "confidence": 81,
      "vote": "REFUTED",
      "claim": "The catch drops the enqueue error.",
      "evidence": "src/queue.ts:31 rethrows after logging",
      "failure_scenario": "an enqueue that fails -> the caller is never told",
      "verdict": "invalid",
      "reason": "src/queue.ts:31 rethrows the error after logging it, so the caller sees it.",
      "reply": "Not changed: src/queue.ts:31 rethrows after logging, so the caller sees the error.",
      "resolve_thread": true
    }
  ],
  "dropped": [{ "path": "src/old.ts", "line": 12, "why": "pre-existing on base" }],
  "summary": { "found": 2, "fixed": 1, "invalid": 1, "deferred": 0, "needs_human": 0 },
  "models": [
    { "role": "review", "model": "provider-a/large-model" },
    { "role": "fix", "model": "provider-a/large-model" },
    { "role": "verify", "model": "provider-a/large-model" },
    { "role": "second-opinion", "model": "provider-b/large-model" }
  ],
  "decisions": []
}
```

## Fields

- **`depth`**, **`depth_reason`:** `light` or `deep`, and the script's `source:` or `match:` lines. A deep result names at least one reason.
- **`merge`:** `{ "auto": true }`, or `{ "auto": false, "reason": "CATALYST_REVIEW_AUTO_MERGE is false for this repository" }`. With `auto` false the review is posted as a comment and counts as no passing review.
- **`gates`:** one entry per step that ran or was skipped: `step`, a `verdict` of `PASS`, `FAIL`, `PARTIAL` or `SKIPPED`, a `detail`, and optional `substep` and `ci_link`.
- **`conformance`:** one entry per plan success criterion or ticket scenario, with `status` `met`, `partial`, `missing` or `scope-creep` and the `evidence` (a test or `path:line`).
- **`findings`:** every finding from Steps 1 to 6.
  - `severity` is `high`, `medium` or `low`.
  - `category` is `correctness`, `security`, `guideline`, `spec`, `type-safety`, `reward-hacking`, `test-quality` or `silent-failure`.
  - `vote` is `CONFIRMED`, `PLAUSIBLE` or `REFUTED`.
  - `verdict` is `valid`, `invalid`, `already-fixed`, `deferred` or `needs-human`.
  - `follow_up` names the ticket for a `deferred` finding.
- **`dropped`:** candidates set aside before they became findings, each with why.
- **`summary`:** counts that match the findings. `fixed` counts `valid`; `invalid` counts `invalid` and `already-fixed`.
- **`models`:** the model behind each role: `review`, `fix`, `verify` and, on a deep review, `second-opinion`.
- **`decisions`:** what the escalation rule raised for a person.

## Rules the cloud enforces before it posts

The cloud posts nothing when any of these fails:

1. A `valid` finding names a `fix` whose sha is an ancestor of `final_head` and changes the finding's `path`.
2. A finding that is not `valid` gives a `reason`.
3. `resolve_thread` is false for a `PLAUSIBLE` vote and for `needs-human`.
4. `summary` matches the findings, and finding ids do not repeat.
5. `reviewed_head` is an ancestor of `final_head`, and the pull request's head is still `final_head`.
6. A deep result has a `second-opinion` model from a different family than the `fix` model.
