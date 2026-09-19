# When you have not heard back

## What silence means today — read this before you wait on one

**"Default if silent" is not one mechanism. It is three, and only one of them is live.** Verified against `origin/main` on 2026-09-18:

| ask kind | does silence do anything? | mechanism |
| -- | -- | -- |
| a **hold ask** (validate-budget / round-threshold) | **YES — 48 h, then option A (re-plan) fires through the same executor an answer uses** | `apps/mirror/src/do/hold-ask-silence-sweep.ts`; `HOLD_ASK_SILENCE_MS = 48h` and `HOLD_ASK_DEFAULT_OPTION` in `apps/mirror/src/coordination/hold-ask-dialog.ts:29-36`. Fires only while the hold is **still live** — a ticket fixed by hand and advanced is skipped, not re-planned by a timer |
| any other ask carrying `**Auto-executes:**` | only in flag state `on` | `apps/mirror/src/do/ask-default-execute.ts`; the `ask-default-execution` Flagship flag's **safe default is `shadow`**, which logs the decision it *would* post and writes nothing (`ask-default-execution-mode.ts:29`) |
| every other ask | **NO — it waits forever** | the raisers never arm a deadline. `apps/mirror/src/coordination/decision-ask.ts:213` passes `defaultIfSilent` and no auto-execute instant, and an ask without one is advisory by construction (`write-proxy/human-ask.ts`, `AskDefaultPolicy`) |

⚠️ **`Auto-executes:` has appeared on 0 of 307 CTC asks (0 of 341 across all teams), measured 2026-09-18.** The corpus grows daily, so cite the date with the number. Positive control on the same corpus: `Default if silent` present on **322 of 341**, and the string `Auto-execut` hits 3 non-ask issues including **CTC-2688 — the ticket filed about this exact defect, now Todo/P1.** The instrument works; the absence is real.

⚠️ **The mechanisms that would drain this queue are built and parked.** Three Flagship flags safe-default to `shadow`, which observes and writes nothing: `ask-default-execution` (an unanswered ask executes its default), `review-convergence-hold` (a non-converging review holds after four cycles — CTC-1724), and `ask-retraction` (the moot-ask sweep — CTC-2532, merged, retracting nothing). A deploy alone enables none of them. Whether any moves to `on` is Ryan's call, not an agent's.

Three consequences you must act on:

- **For a non-hold ask, silence is not consent and never becomes consent.** Do not "wait for the default to fire". Nothing fires. Proceeding on the stated default is something **you** do, deliberately, and record.
- **For a hold ask, silence IS a live actuator.** Do not park a ticket next to one assuming a human will look — in 48 h it re-plans itself. If that is wrong for this ticket, answer the ask.
- ⛔ **The sweep fires option A for every hold ask, and A is wrong for most of this population.** Of the five live M6 hold asks, **three must not re-plan** (`validate-failing.md`). So once the sweep is armed it is a timer that applies the wrong lever by default. **Agent duty, until the raiser routes by gate: a hold ask whose ladder verdict is anything other than "plan-conformance FAIL with unattempted ACs" must be answered with its routed option BEFORE the 48 h timer fires.** Silence on those is not patience; it is a scheduled mistake.

## The waiting rule

While an ask is open, **you already proceeded on its default** — that is `working-the-loop.md`'s contract, and it is what makes an unanswered ask survivable. So "waiting" is never idle:

1. **Proceed on the default and record it** in the thread before you go quiet.
2. **Bounded check, never a poll loop.** For a customer's ask there is an event: the operator ask stream (`docs/event-backbone/operator-ask-stream.md`). For Linear state generally, one bounded check, stating the interval and ceiling.
3. **> 24 h unanswered → the top of the board**, via the concierge (`catalyst-dev:concierge` → `references/asks.md`). An ask never silently expires.
4. **> 48 h and it is genuinely blocking** → it is not an ask problem any more, it is a routing problem. Re-read gates 1–4: something changed while you waited, and the commonest change is that the subject resolved itself.

## Before you re-surface it: is it still a question?

⛔ **Asks are never auto-closed, so the queue grows with decisions nobody needs any more.** Measured 2026-09-18: **11 of 56** open asks were moot — the ticket they blocked had already reached a terminal state, or the finding had been fixed by another route. A moot ask still holds its `blocks` edge and still occupies a human's queue.

⚠️ **And the queue is the wrong instrument for "what is stuck".** A parked ticket with no ask, or one held by a dead local lane, never appears here at all — `references/levers.md` § *Stalls that never reach any queue*.

Before re-surfacing any ask you own, re-read its subject:

- Is the blocked ticket terminal (Done / Canceled / Duplicate)? → close the ask, `[bookkeeping]`, say what resolved it.
- Did the head move, or the hold clear? → the question is answered by events; close it.
- Is the option you defaulted to already executed? → close it.

Only what survives that re-read gets re-surfaced.

## Escalating a silence

The ladder is unchanged — instrument → steward → concierge → human — and the human is only ever reached as an ask. A silence does **not** earn a second ask. It earns: a nudge in the thread, a row at the top of the board, and, if the silence itself is the pattern rather than the instance, **one policy ask** about the class (`needing-a-human.md`).

⚠️ **Never re-file the same question because the first copy went unanswered.** That is how one decision becomes N rows, each carrying a fraction of the real urgency.
