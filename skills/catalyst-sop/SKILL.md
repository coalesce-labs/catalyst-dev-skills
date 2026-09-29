---
name: catalyst-sop
description:
  How to decide what to do next when Catalyst work stalls on a decision — the ladder from "decide it myself"
  to "raise an ask", how to route a repeating validate failure by its ladder verdict, which lever actually
  moves a held ticket, what to do when nobody answers, and what to do when a human answers you directly.
  Use whenever work is held on a decision, a ticket is parked or stale, an ask is unanswered, a human answers
  in chat, or a validate/remediate cycle will not converge.
---

# Catalyst SOP — deciding what to do next

Two rules govern everything here. **If we can figure out what to do, we do it** — a human's attention is the scarcest resource in the system and an ask spends it, so an ask is what is left after everything else failed, not the first move. And **"nothing waits on capacity; a stall is an interrupt"** — a procedural ask is an interrupt to the **agent**, not to the human. Routing it upward is not handling it.

⛔ **This skill restates nothing.** Read each rule where it lives:

| you need | read |
| -- | -- |
| what an ask IS, how to create / thread / close one, and how to rank what reaches a human | the `ask` skill + its `references/` |
| the escalation gates before anything reaches a human | the `steward` skill → `references/escalation.md` |
| how Catalyst Cloud runs a ticket through its phases, and what holds or parks it | the Cloud pack (`coalesce-labs/catalyst-cloud-skills`), `how-catalyst-works` skill |

## ⛔ Answering is not executing

An ask can be answered correctly and still move nothing. Answering a validate-hold ask "A — re-plan" and then closing it with a Linear state write leaves the ticket exactly where it was: **a state write does not move the relay ledger frontier**, so the ticket re-validates a byte-identical head, re-holds itself, and raises a fresh copy of the same ask. The mechanical route flips eligibility to *offered*; the state write does nothing. Worked example: `references/replan.md`.

⭐ **The thesis:** a clean-looking zero, a green guard on a PR it does not cover, and an ask printing three identical options are **the same defect** — an output confidently shaped like an answer while carrying no information about its own subject. Recording a decision is one more instance: it looks like the work and says nothing about whether anything moved.

Three things follow, and they are the spine:

1. **A decision is done when its lever has been pulled and the ledger shows it** — not when it is recorded.
2. **Route by the ladder verdict, never by the option letter.** The template flattens several situations into one.
3. **Each hold kind has exactly ONE correct route.** `references/levers.md` is the single copy of that table.

## The ladder — in order, every time

0. **Do I know WHY it is stuck?** A diagnosis job you dispatch yourself, never an ask. ⚠️ Sweep `explain` for `parked` and `externally_claimed` too — a ticket with no ask can be just as stalled, and neither shape ever enters the human's queue (`references/levers.md`).
1. **Is this class already decided or already routed?** If your project keeps a register of standing decisions, check it: a decision made once for this class is executed, not re-asked (`references/needing-a-human.md`). Then a repeating generated failure has a standard action that depends on its **ladder verdict** (`references/validate-failing.md`); most of its sub-shapes are not human decisions at all.
2. **Can I decide it myself?** Technical calls are yours: which approach, retry or abandon, flake or real.
3. **Does it need to block at all?** A sane action taken and recorded beats a correct question asked.
4. **Who else can move it?** A peer steward with adjacent context is faster than a human round-trip.
5. **Only now, is it an ask — and is it an INSTANCE or a POLICY question?** If your ask would be the Nth copy of the same question, the decision under it is a **policy**: raise **one** policy ask, attach the instances, proceed meanwhile.

## First occurrence, repeat occurrence

- **First occurrence** — execute **the routed action** (`validate-failing.md`) with its correct lever (`levers.md`), record it, file no ask. ⚠️ Not "the printed default": the default is a letter, and the letter is wrong for most of this population.
- **Repeat occurrence, after a re-plan that VERIFIABLY moved the frontier** — a scope signal (`references/scope.md`). ⚠️ A ticket that returns after a *state-write* "re-plan" was never re-planned; treating that as a scope problem descopes work that was never retried.
- **Fourth non-converging cycle** — the product already holds a non-converging review for a human. **This skill's repeat reflex sits below that threshold and feeds the same judgement — it is not a second counter.** Do not invent a parallel number.

## Load on demand

| when | read |
| -- | -- |
| a ticket is held or parked and you need the route that moves it | `references/levers.md` |
| validate keeps failing and an ask wants you to choose | `references/validate-failing.md` |
| the action is "go back to planning" | `references/replan.md` |
| you need a decision or an action from a human | `references/needing-a-human.md` |
| an ask has gone unanswered, or a 48 h timer is about to fire | `references/no-answer.md` |
| a human answered you — in chat, in a thread, in a batch | `references/answer-arrives.md` |
| work was never attempted, or is bigger than the ticket | `references/scope.md` |
| you are writing a CI guard, or reporting an Actions cost or minute figure | `references/guards.md` |

## Invariants

- **Recording a decision is not executing it.** Every decision names its executor **and its lever** before it is recorded. **Answering an ask is two manual acts, not one.**
- **A Linear state write does not move the relay ladder**, and a board stage is not evidence. Pull the lever, then read the ledger back.
- ⛔ **A lever whose NAME matches the symptom is not thereby the right lever** — key a route by the **table it clears**, never by the words it shares with the failure text, and treat a `{cleared:false}` / `hold:null` reply as WRONG LEVER rather than "already clear" (it is a documented *success* for that route's own table, so it reads like confirmation while nothing moved). Both cases and their routes: `references/levers.md`.
- **An instrument that can fail for a reason unrelated to its subject must say so in its own output** — until it does, a zero from it is inconclusive, not clean. CI guards and every Actions cost figure: `references/guards.md`.
- ⛔ **Answer a non-re-plan hold ask BEFORE the 48 h sweep.** Silence fires option A on every hold ask, and A is the wrong action for most of them — an unanswered timer is a scheduled mistake, not patience.
- **A system-level failure is never a per-ticket human block** (one system alert, not N asks), and **"the runner refused to re-run" is not a decision** — a hold on an unchanged head never clears on its own, and a human answering it adds no information.
- **An ask you raise is an ask you own** — you watch it, execute it, and close it. **Say what you could not enforce**, naming the route that refused you.

## Verify yourself

1. Can you name the cause rather than the symptom, and did you read the **ladder verdict** (plan-conformance first) rather than the option letter?
2. Did you pick the lever by **hold kind** from `levers.md`, confirm on the ledger that it moved, and is this a repeat after a rewind you **confirmed** rather than a no-op?
3. Would any answer change what you do next? If not it is not a decision — and if it is, does an open ask already cover it?
