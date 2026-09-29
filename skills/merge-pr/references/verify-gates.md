# Pre-merge adversarial review — the 8-gate table

Use this checklist when a PR needs a deeper adversarial pass than this skill's own Step 3 (local tests) before you merge it — e.g. a large or risky diff, or one a reviewer flagged as needing a second look.

**This pass is read-only.** The only files it is ever correct to create or edit while running these gates are test files (`**/__tests__/`, `*.test.*`, `*.spec.*`, `test/**`, `tests/**`). A finding that needs an application-code fix gets recorded and handed to whoever owns that fix — never patched in place from inside a "verify" pass.

## The 8 gates

Run every gate; do not stop at the first failure — the pass is exhaustive, not short-circuiting.

| Gate | Tool | Skill / agent |
|---|---|---|
| Type check | `tsc --noEmit` (or project's `typecheckCommand`) | the `validate-type-safety` skill |
| Reward-hacking scan | grep-based pattern check | the `scan-reward-hacking` skill |
| Unit tests | project test command | the `validate-type-safety` skill |
| Lint | project lint command | the `validate-type-safety` skill |
| Security review | exploitable vulnerabilities the diff introduces (injection, auth bypass, secrets, unsafe deserialization) | the `review-security` skill |
| Code review | real defects in the diff (bugs, quoted CLAUDE.md/AGENTS.md violations) | the `review-code` skill |
| Test coverage | per-file coverage on diff | a test-coverage review subagent |
| Silent failures | unchecked try/catch + fallback hunting | a silent-failure review subagent |

Run the CLI gates in the shell; run each agent gate as a subagent, or inline where your harness has none. Capture exit code + a one-line summary per gate.

## Scoring `regression_risk` (0–10)

A rough aggregate signal for how much this diff needs a human's eyes before it merges — not a hard gate, but a way to decide whether to loop back for remediation first:

| Signal | Risk delta |
|---|---|
| Any required CLI gate failed (tsc/test/lint/security) | +3 each |
| Reward-hacking scan flagged a HIGH-severity pattern | +3 |
| Code review reported a defect | +2 |
| Test-analyzer reports < 50% diff coverage | +2 |
| Silent-failure hunter flagged an unchecked catch / fallback | +2 |
| Any agent surfaced a must-fix finding | +3 |

Clamp to `[0, 10]`. A score ≥ 5 means fix the findings before merging, not after.

## Findings shape

Record each finding with enough detail that someone acting on it later doesn't have to re-derive it:

```json
{
  "severity": "high|medium|low",
  "kind": "type|test|lint|security|review|coverage|silent-failure|reward-hacking",
  "file": "path/to/file.ts",
  "line": 42,
  "message": "Short human-readable description",
  "recommendation": "What should happen about it"
}
```
