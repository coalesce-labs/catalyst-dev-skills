# When you need something from a human

`catalyst-dev:ask` owns the mechanics — the body grammar the decision trigger parses, the `--blocks` requirement, threading, closing. `catalyst-dev:steward` → `references/escalation.md` owns the four gates. **Neither is repeated here.** This page covers the two things they do not: how to tell an instance apart from a policy, and how to check whether the decision has already been made.

## Standing decisions — check before you compose the question

✅ **The register EXISTS, in the Catalyst Cloud repo you are working in: `.agents/references/standing-decisions.md`**, created 2026-09-18 by the concierge seat out of this draft. ⚠️ Status as of writing: it lands in **PR #5166** (branch `CTC-2741`), which is **open, not merged** — so check that it is on `main` before relying on it, and read the file itself rather than this page for the current entries.

Its first entry is the worked example of the shape: **staging credential rotation is deferred to go-live.** Ryan answered asks CTC-2727 and CTC-2647 by *cancelling* both — the current exposure is acceptable pre-production and one batch rotation happens at cutover, tracked as **CTC-2741**. The entry tells an agent that finds a staging token in a transcript to append one `[bookkeeping]` line to CTC-2741 and **not** raise an ask. That is the register working as intended: a decision made once, recorded, suppressing every future copy of the question.

A **standing decision** is a decision a human has made for a *class* of situations, with a scope and an expiry, that any agent may execute without asking again. One entry per decision:

```markdown
### A repeating validate failure routes by its failing gate
- **Decided by:** Ryan, <date>, <where>
- **Scope:** any `catalyst-ask` whose options are the hold-ask dialog's three
- **What an agent does:** execute the ROUTED ACTION per `references/validate-failing.md`
  (plan-conformance read first), with the lever its hold kind names in `references/levers.md`. First
  occurrence executes without asking; a repeat after a CONFIRMED rewind is a scope call.
- **Expires:** <date>, or when the raiser arms its own deadline (CTC-2688)
- **Evidence:** the 2026-09-18 census of 56 open asks
```

⛔ **A standing decision is a ROUTE plus a LEVER, never a bare letter.** Two ways an entry fails: naming one option for a whole template (the template covers four different situations — `validate-failing.md`), and naming an option without the mechanical action that performs it. 16 tickets answered "A" on 2026-09-17 produced 24 fresh copies of the same question within 18.5 hours — not because A was wrong, but because it was executed as a Linear state write, which does nothing to the relay ladder. An entry that cannot be executed is a preference, not a decision.

Three more rules make it safe:

- **A standing decision is written by a human or quoted verbatim from one, never inferred.** A batch of identical answers is *evidence for proposing* a standing rule; it is not itself one. The 2026-09-17 batch was worded as point-in-time over that batch and does **not** self-extend.
- **It has an expiry.** An un-expiring standing rule is how a decision outlives the world that justified it.
- **An entry names the executor.** A standing rule an agent may not carry out is a comment, not a rule.

## Instance or policy?

Before filing, search open asks (`catalyst-dev:ask` → `references/triage.md`'s gated replica query). Then ask one question: **would the answer to my ask also answer the others?**

| what you find | what you do |
| -- | -- |
| an open ask with the same options | **attach** — add a `blocks` edge to your work ticket. Never duplicate; duplicates split one decision's urgency across rows and sink it below trivia |
| N open asks that are the same question, generated per-ticket | file **one policy ask** — "should `<situation>` always take `<option>`?" — `blocks` the instances, and proceed on the default on all of them meanwhile |
| a genuinely one-off product / priority / approval call | one instance ask, carrying the diagnosis from gate zero |

**Measured 2026-09-18, which is why this page exists:** 56 open asks; 31 procedural-repeatable, of which **30 were one generated template** (validate keeps failing on `<gate>` — re-plan / accept / hand-fix), 11 moot because the subject had already resolved, 2 malformed. **12 were genuine.** One policy ask, filed once, would have replaced 30 rows.

⚠️ **The queue is a firehose, not a backlog** — 45 of 56 are under 24 h old, median age 0.47 days, only 6 older than a week. That changes the fix: triaging the backlog accomplishes nothing, because tomorrow's queue is raised tomorrow. **Fix the raiser.**

## What only a human can do

Three things survive every gate. Everything else is yours:

- a **product or priority** call — what we build, what we cut, what ships first;
- an **approval** with a cost or a risk the agent cannot carry — spend, a public release, a destructive or irreversible act;
- a **physical** action — tap a device, hold a credential, sign something.

⛔ Two shapes that look like these and are not: *investigate vs. don't investigate* (that is your job, gate zero), and *a machine declined to repeat itself* (a hold on an unchanged head — move the head or release the hold, see `replan.md`).

## Filing it

Follow `catalyst-dev:ask` exactly — the verb, the options, the default, the `blocks`. Two additions this SOP requires on top:

1. **Lead with the cause.** An ask carrying a diagnosis is worth a human's time; an ask carrying a question mark usually is not.
2. **Name the executor of every option, including the default,** in the body. If you cannot name one for an option, that option is not offerable — see `answer-arrives.md`.
