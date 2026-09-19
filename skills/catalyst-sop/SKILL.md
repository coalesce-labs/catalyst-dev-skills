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

Two rules govern everything here, both Ryan's, both 2026-09-18. **If we can figure out what to do, we do it** — a human's attention is the scarcest resource in the system and an ask spends it, so an ask is what is left after everything else failed, not the first move. And **"nothing waits on capacity; a stall is an interrupt"** — a procedural ask is an interrupt to the **agent**, not to the human. Something stopped; find out what and clear it. Routing it upward is not handling it.

⛔ **This skill restates nothing.** Read each rule where it lives:

| you need | read |
| -- | -- |
| what an ask IS, how to create / thread / close one | `catalyst-dev:ask` + its `references/` |
| the escalation gates before anything reaches a human | `catalyst-dev:steward` → `references/escalation.md` |
| the coordination roles, and the ask bullet that binds every agent | `.agents/references/working-the-loop.md` **in the Catalyst Cloud repo you are working in** |
| ranking what does reach the human (blast radius, not age) | `catalyst-dev:ask` → `references/triage.md` |
| the phases, their artifacts, and what "done" means for each | `.agents/skills/relay-ticket/SKILL.md`, same repo |
| why a non-converging review holds after four cycles | ADR-20260906T112500 (CTC-1724) |

## ⛔ Answering is not executing

The measurement this skill is built on. On 2026-09-17, 16 validate-hold asks were answered with the printed default ("A — re-plan") in one 29-second batch. Eighteen and a half hours later: **12 of the 16 had re-raised — 24 fresh copies of the same question** — and 6 sat in `Plan` with nothing running. **The answers were sound. The lever was wrong.** They were closed with Linear state writes, and **a state write does not move the relay ledger frontier** — so each ticket re-validated a byte-identical head and re-held itself. The mechanical route returns 200 and flips eligibility to *offered for phase plan*; the state write does nothing. Evidence and the worked example: `references/replan.md`.

⭐ **The general form, and the thesis of this skill:** a clean-looking zero, a green guard on a PR it does not cover, and an ask printing three identical options are **the same defect** — an output confidently shaped like an answer while carrying no information about its own subject. Recording a decision is one more instance: it looks like the work and says nothing about whether anything moved. Three things follow, and they are the spine:

1. **A decision is done when its lever has been pulled and the ledger shows it** — not when it is recorded.
2. **Route by the ladder verdict, never by the option letter.** The template flattens several situations into one.
3. **Each hold kind has exactly ONE correct route.** `references/levers.md` is the single copy of that table.

## The ladder — in order, every time

0. Gates 0 and 2–4 are `catalyst-dev:steward` → `references/escalation.md`'s, unchanged; gate 1 and gate 5's second half are new. **Do I know WHY it is stuck?** A diagnosis job you dispatch yourself, never an ask. ⚠️ Sweep `explain` for `parked` and `externally_claimed` too — a ticket with no ask can be just as stalled, and neither shape ever enters the human's queue (`references/levers.md`).
1. **Is this class already decided or already routed?** — ⭐ NEW. Check `.agents/references/standing-decisions.md` — a decision made once for this class is executed, not re-asked. Then: a repeating generated failure has a standard action that depends on its **ladder verdict** (`references/validate-failing.md`); most of its sub-shapes are not human decisions at all.
2. **Can I decide it myself?** Technical calls are yours: which approach, retry or abandon, flake or real.
3. **Does it need to block at all?** A sane action taken and recorded beats a correct question asked.
4. **Who else can move it?** A peer steward with adjacent context is faster than a human round-trip.
5. **Only now, is it an ask — and is it an INSTANCE or a POLICY question?** — ⭐ NEW second half. If your ask would be the Nth copy of the same question, the decision under it is a **policy**: raise **one** policy ask, attach the instances, proceed meanwhile.

## First occurrence, repeat occurrence

- **First occurrence** — the agent executes **the routed action** (`validate-failing.md`), with its correct lever (`levers.md`), records it, and files no ask. ⚠️ Not "the printed default": the default is a letter, and the letter is wrong for most of this population. (CTC-2688 arms the deadline that makes the product do this; it is Todo/P1.)
- **Repeat occurrence, after a re-plan that VERIFIABLY moved the frontier** — a scope signal (`references/scope.md`). ⚠️ A ticket that returns after a *state-write* "re-plan" was never re-planned; treating that as a scope problem descopes work that was never retried.
- **Fourth non-converging cycle** — the product already holds for a human (CTC-1724). **This skill's repeat reflex sits below that threshold and feeds the same judgement — it is not a second counter.** Do not invent a parallel number.

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

- **Recording a decision is not executing it.** Every decision names its executor **and its lever** before it is recorded. **Answering an ask is two manual acts, not one.** **A Linear state write does not move the relay ladder**, and a board stage is not evidence. Pull the lever, then read the ledger back.
- ⛔ **A lever whose NAME matches the symptom is not thereby the right lever.** Key a route by the **table it clears**, never by the words it shares with the failure text. "Head unchanged since the last validate FAIL" is a reason string on the *validate budget* hold (`validate-unhold`); `relay-clear-no-change-hold` clears a different table entirely. An agent who had just written the warning about non-interchangeable levers still picked the wrong one by name-matching — knowing the rule does not protect you, reading the table does. ⛔ **A `{cleared:false}` / `hold:null` response means WRONG LEVER, not "already clear."** That shape is a documented *success* for the route's own table, so it looks like confirmation while the ticket has not moved.
- **An instrument that can fail for a reason unrelated to its subject must say so in its own output** — and until it does, a zero from it is inconclusive, not clean. Applies to CI guards and to every Actions cost figure: `references/guards.md`. ⛔ **Answer a non-re-plan hold ask BEFORE the 48 h sweep.** Silence fires option A on every hold ask, and A is wrong for three of the five live M6 holds — an unanswered timer is a scheduled mistake, not patience.
- **A system-level failure is never a per-ticket human block.** One fleet alert, not N asks. **"The runner refused to re-run" is not a decision.** 0 of 9 head-unchanged holds ever cleared; 3 of 3 humans who answered added no information.
- **An ask you raise is an ask you own** — you watch it, execute it, and close it. **Say what you could not enforce**, naming the route that refused you.

## Verify yourself

1. Can you name the cause, not just the symptom?
2. Did you read the **ladder verdict** (plan-conformance first) rather than the option letter?
3. Did you pick the lever by **hold kind**, from `levers.md` — and confirm on the ledger that it moved?
4. Is this a repeat after a rewind you **confirmed**, or after a no-op?
5. Would any answer change what you do next? If not, it is not a decision — and if it is, does an open ask already cover it?
