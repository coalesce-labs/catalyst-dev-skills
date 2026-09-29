# When you have not heard back

## What silence means — read this before you wait on one

**"Default if silent" is not one mechanism. It is three, and they behave differently:**

| ask kind | does silence do anything? | mechanism |
| -- | -- | -- |
| a **hold ask** (validate-budget / round-threshold) | **YES — 48 h, then option A (re-plan) fires through the same executor an answer uses** | the hold-ask silence sweep. It fires only while the hold is **still live** — a ticket fixed by hand and advanced is skipped, not re-planned by a timer |
| any other ask carrying `**Auto-executes:**` | only when the `ask-default-execution` mode is `on` | its **safe default is `shadow`**, which logs the decision it *would* post and writes nothing |
| every other ask | **NO — it waits forever** | an ask the raiser did not arm with an auto-execute instant is advisory by construction |

⚠️ **Check how many asks actually carry `Auto-executes:` before you rely on one.** Count it against a positive control on the same corpus (for example, how many carry `Default if silent`) so a zero means absence and not a broken search. When raisers never arm a deadline, every printed default is decorative.

⚠️ **The mechanisms that would drain this queue ship in `shadow`**, which observes and writes nothing: `ask-default-execution` (an unanswered ask executes its default), `review-convergence-hold` (a non-converging review holds after four cycles), and `ask-retraction` (the moot-ask sweep). A deploy alone enables none of them. Whether any moves to `on` is the owner's call, not an agent's.

Three consequences you must act on:

- **For a non-hold ask, silence is not consent and never becomes consent.** Do not "wait for the default to fire". Nothing fires. Proceeding on the stated default is something **you** do, deliberately, and record.
- **For a hold ask, silence IS a live actuator.** Do not park a ticket next to one assuming a human will look — in 48 h it re-plans itself. If that is wrong for this ticket, answer the ask.
- ⛔ **The sweep fires option A for every hold ask, and A is wrong for most of this population** (`validate-failing.md`). So once the sweep is armed it is a timer that applies the wrong lever by default. **Agent duty, until the raiser routes by gate: a hold ask whose ladder verdict is anything other than "plan-conformance FAIL with unattempted ACs" must be answered with its routed option BEFORE the 48 h timer fires.** Silence on those is not patience; it is a scheduled mistake.

## The waiting rule

While an ask is open, **you already proceeded on its default** — that is the contract that makes an unanswered ask survivable. So "waiting" is never idle:

1. **Proceed on the default and record it** in the thread before you go quiet.
2. **Bounded check, never a poll loop.** If your cloud account emits an event when an ask is answered, wait on that. For Linear state generally, one bounded check, stating the interval and ceiling.
3. **> 24 h unanswered → the top of the board**, via the concierge (the `concierge` skill → `references/asks.md`). An ask never silently expires.
4. **> 48 h and it is genuinely blocking** → it is not an ask problem any more, it is a routing problem. Re-read gates 1–4: something changed while you waited, and the commonest change is that the subject resolved itself.

## Before you re-surface it: is it still a question?

⛔ **Asks are never auto-closed, so the queue grows with decisions nobody needs any more.** A fair share of open asks are usually moot — the ticket they blocked has already reached a terminal state, or the finding was fixed by another route. A moot ask still holds its `blocks` edge and still occupies a human's queue.

⚠️ **And the queue is the wrong instrument for "what is stuck".** A parked ticket with no ask, or one held by a dead local lane, never appears here at all — `references/levers.md` § *Stalls that never reach any queue*.

Before re-surfacing any ask you own, re-read its subject:

- Is the blocked ticket terminal (Done / Canceled / Duplicate)? → close the ask, `[bookkeeping]`, say what resolved it.
- Did the head move, or the hold clear? → the question is answered by events; close it.
- Is the option you defaulted to already executed? → close it.

Only what survives that re-read gets re-surfaced.

## Escalating a silence

The ladder is unchanged — instrument → steward → concierge → human — and the human is only ever reached as an ask. A silence does **not** earn a second ask. It earns: a nudge in the thread, a row at the top of the board, and, if the silence itself is the pattern rather than the instance, **one policy ask** about the class (`needing-a-human.md`).

⚠️ **Never re-file the same question because the first copy went unanswered.** That is how one decision becomes N rows, each carrying a fraction of the real urgency.
