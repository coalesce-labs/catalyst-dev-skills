# Context status and handoffs

Implementation piles up file reads, diffs, test output and errors. Each finished phase is a natural handoff point: the plan's checkboxes carry progress into a fresh session.

## After each phase, print

```
✅ Phase {N} complete!

## 📊 Context Status
Current usage: {X}% ({Y}K/{Z}K tokens)

{If >60%}:
⚠️ **Context Alert**: We're at {X}% usage.

**Recommendation**: Create a handoff before continuing to Phase {N+1}.

**Options**:
1. ✅ Create handoff and clear context (recommended)
   - Use the `create-handoff` skill to generate a properly formatted handoff
   - Format: `thoughts/shared/handoffs/{ticket}/YYYY-MM-DD_HH-MM-SS_description.md`
2. Continue to next phase (if close to completion)

**To resume**: Start a fresh session and use the `implement-plan` skill with `{plan-path}`
(The plan file tracks progress with checkboxes - you'll resume automatically)

{If <60%}:
✅ Context healthy. Ready for Phase {N+1}.
```

## Thresholds

- Above 60%: recommend a handoff.
- Above 70%: recommend it strongly.
- Above 80%: stop and require a handoff.
- After three failed attempts at the same error: suggest clearing context.

## Writing the handoff

Offer the `create-handoff` skill. Written by hand, the handoff goes to `thoughts/shared/handoffs/{ticket}/YYYY-MM-DD_HH-MM-SS_description.md` (the timestamp sorts by recency) and holds the completed phases, next steps, key learnings and file references. Check off the finished work in the plan file first.
