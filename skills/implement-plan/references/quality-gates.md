# Local quality gates

Run these after the last phase, in order, when no automated phase is running. Skip them when the plan or the user passes `--skip-quality-gates`, and say in the completion summary that they were skipped.

```
Quality Gates:
├── 1. validate-type-safety   → tsc + reward hacking scan + tsconfig check + tests + lint
├── 2. review-security skill  → scan for security vulnerabilities (this pack's skill, on every harness)
├── 3. review-code skill      → real defects in the diff (this pack's skill, on every harness)
└── 4. test-coverage subagent → test coverage verification
```

1. **Type safety.** The `validate-type-safety` skill runs the full five-step gate: type check, reward-hacking scan, test inclusion, tests, lint.
2. **Security review.** This pack's `review-security` skill, not Claude Code's built-in `/security-review`, so every harness gets the same reviewer. Fix every vulnerability it finds.
3. **Code review.** This pack's `review-code` skill against the branch's base (for example `origin/main`). It reviews the diff for real defects, including quoted violations of the repository's CLAUDE.md or AGENTS.md. Fix every finding.
4. **Test coverage.** A subagent with these instructions: "Analyze test coverage for the changes on this branch. Identify critical gaps: new behaviour, edge cases and error paths that no test exercises." Write the missing tests for every critical gap.

For gates 1 and 2, fix automatically and re-run the gate. For gates 3 and 4, address the findings and verify. A gate still failing after two fix attempts goes to the user: report what remains and ask how to proceed. When `CATALYST_PHASE` is set, never ask and wait: stop and report what remains as the phase's outcome.
