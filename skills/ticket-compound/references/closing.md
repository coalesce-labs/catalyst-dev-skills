# Closing steps: ADR proposals, discoverability, headless report

## ADR proposals (Step 6)

Append each proposal to `thoughts/shared/compound/pending/<TICKET>.md`: the target ADR (new, amend `ADR-NNN` or supersede `ADR-NNN`), the exact proposed text, and a one-line rationale with evidence (ticket and learning path). A human approves it through `briefing-followup`'s `action-compound` handler, the only writer of `docs/adrs.md`.

## The discoverability pointer (Step 7)

The pointer to add to `CLAUDE.md`:

```
thoughts/shared/learnings/ — past problem→solution entries (grep by component/tags/problem_type).
Search before implementing or debugging in a known area. Curated by the ticket-compound skill.
```

## Headless report (Step 8)

End a headless run with this structured block; its last line is the grep-able sentinel:

```
✓ ticket-compound complete (headless)
ticket: ENG-123
entry: thoughts/shared/learnings/runtime-errors/worker-marked-dead-on-first-commit.md (created)
curated: 1 updated, 0 deleted ; concepts: +2 ; adr-proposals: 1 (pending approval)
ticket-compound complete
```
