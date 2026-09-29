# Escalation — the gates before anything reaches a human

**A stuck agent is asking YOU for help, not filing an escalation.** You hold the broader context and have the standing mandate to *unblock*, not to relay. An agent saying "I'm stuck" is an input to your judgement, never a decision that has already been made.

Nothing reaches the human until you have answered all four — **starting with gate zero.**

## 0. Do I even know WHY it is stuck?

⛔ **"Why has this not moved?" is never an escalation. It is a diagnosis job you dispatch yourself, automatically** — the moment you notice a stall, a ticket nothing picks up, a phase that will not advance, or a PR that will not merge. Finding out is your job, not the human's.

**Never file an ask whose options amount to _investigate_ vs _don't investigate_, or _wait_ vs _look_.** That spends a human's attention authorising work you could simply have done. Dispatch an agent to diagnose why it is stuck, by default, every time; escalate only once you know the cause and a decision is actually needed.

An ask offering *"leave it — it will pick up on its own"* versus *"investigate"* can sit at the top of a human's queue for hours while holding up a P1, and no human input improves either option.

When you do escalate afterwards, **lead with the cause.** An ask carrying a diagnosis is worth a human's time; an ask carrying a question mark usually is not.

## 1. Can I decide this myself?

Technical calls are yours, not the human's — which approach to take, retry or abandon, rebase or re-cut, is this a flake or a real failure, is this the right API shape. Decide it, say so in-thread, and move. A technical question a steward could have answered is one of the most common things found clogging a human's queue.

## 2. Does this need to block at all?

If a sane default exists, take it, record it in the thread, and keep moving. A ticket parked awaiting an answer nobody actually needed is the most expensive outcome available: it costs the human's attention *and* the work's momentum. Proceeding on a stated default is the norm, not the exception — see the ask SOP's Options + Default-if-silent contract.

## 3. Who else can move this?

You may pull in another agent, another steward, or the human. **Pulling in a peer is the preferred move** — a second steward with adjacent context is usually faster than a human round-trip and costs nothing scarce. "I couldn't do it" is not the same as "a human must do it."

Only a genuine **product / priority / approval** decision, or an action only a human can physically take (tap a device, hold a credential, approve a spend), survives all four and becomes an ask — and it arrives carrying the diagnosis from gate zero, not a question mark.

## ⛔ A system-level failure is never a per-ticket human block

Provider overloaded, out of capacity, rate-limited, connectivity down, tokens exhausted: that is **one system-wide alert**, and the affected tickets retry and resume by themselves once the condition clears. They are not individually blocked and must not be individually flagged.

Escalating a provider overload one ticket at a time, each with a line about a "priority call the agent cannot make unilaterally", buries the few items that genuinely wait on a human under dozens that do not. Being throttled is not a priority call.

## When you do raise one

Follow the `ask` skill:

- **Search first, attach don't duplicate.** Several agents hitting the same wall must not produce
  several asks — duplicates split one decision's urgency across rows and sink it below trivia.
- **Always record what it `blocks`.** An ask with no blocking relation is structurally unrankable:
  invisible to every urgency query no matter how long it waits.
- Rank what reaches the human by blast radius, not age: the `ask` skill's `scripts/ask-triage.sh`,
  method in its `references/triage.md`.
