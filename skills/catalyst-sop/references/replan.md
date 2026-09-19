# When the decision is "go back to planning"

## ⛔ Re-plan is a sound answer. It recycles when it is executed with the wrong lever.

**This is the most important page in the skill, because the failure it describes looks exactly like the answer being wrong.**

Setting a ticket to `Plan` in Linear **does not move the relay ledger frontier.** The ledger keeps reading `plan → completed`, frontier `validate`, so the next round re-validates the **same head** and re-holds it — and files a fresh blocking ask. The ticket looks re-planned on the board and has not moved an inch.

**Measured, both ends of the same population:**

- Sixteen validate-hold asks were answered "A — re-plan" on 2026-09-17 and closed with Linear state writes. **Ten of sixteen regenerated a fresh hold *and* a fresh blocking ask within 90 minutes, on byte-identical heads.** At 18.5 h, 12 of 16 had re-raised — 24 new asks in total — and 6 were still sitting in `Plan` with nothing running.
- **Worked example, 2026-09-18.** An agent moved CTC-2568 with `linearis issues update --status Plan` at 16:06Z. The eligibility surface still read *"excluded — this validate failure already spent its one repair round."* The same agent then called the mechanical route:

  ```
  POST https://staging.catalystcloud.dev/admin/relay-rewind-to-plan?account=tenant-0&ticket=CTC-2568
  → HTTP 200  {"ticket":"CTC-2568","reset":["plan","implement"],"clearedHold":true,"clearedAcceptance":false}
  ```

  Eligibility then read **"offered (position 24) for phase plan."** The state write did nothing; the route did everything.

⚠️ **`linearis` appears on this page only as the name of the lever that did NOT work — this skill
never instructs you to call it.** If you reach for it for anything else, skip that call when
`CATALYST_PHASE` is set (a phase container holds no Linear credential and the runner owns the
ticket write-back) or when `command -v linearis` fails; say so in one line and carry on with the
mechanical route, which is what moves the frontier either way.

So: **do not conclude that "A — re-plan" is the wrong answer.** Conclude that a re-plan executed as a Linear state write is a no-op that re-raises itself. Use the route, then verify the ledger.

## The rewind lever

⛔ **The five admin routes are not interchangeable, and the lever table is in ONE place: `references/levers.md`.** Read it before picking a route. The short version for this page:

- **The rewind is `POST /admin/relay-rewind-to-plan?account=&ticket=`** (`index.ts:4029` → DO `/relay-rewind-to-plan`, `MirrorDO.ts:5145`, `applyRewindToPlan`). It returns the `reset` phase list, `clearedHold` and `clearedAcceptance`.
- **It is the one lever that MOVES THE FRONTIER.** The other four release a hold at the phase the ticket is already on. Releasing a hold on a ticket whose plan is wrong sends it straight back into the same failure.
- **Answering a hold ask runs the same executor** — `applyHoldDecision` performs the rewind **before** `resumeWorkForAnsweredAsk`, so the answer lands on the phase that will consume it.
- **Read-only explains, for deciding without changing anything:** `GET /admin/relay-advance`, `/relay-advance-explain`, `/relay-ledger-explain`.

**Observation status:** every route is present in source at the cited lines. Only `relay-rewind-to-plan` was **called live** today — the 200 above, for CTC-2568. The other four are read from source, not exercised.

⚠️ **Admin-gated.** Verified 2026-09-18: an org-tier `ctc_acct_` token returns `forbidden` / HTTP 403 on `/admin/*`; the admin bearer returns 200. If you hold only a tenant token, hand the exact route and query string to a seat that has admin (`answer-arrives.md`) — do not record the decision as executed.

## Verify the ladder moved — on the ledger, never the Linear stage

A ticket in `Plan` on the board is not evidence of anything. Check one of:

- `catalyst-skills explain` — the verdict flips from *excluded — already spent its one repair round* to *offered … for phase plan*;
- `GET /admin/relay-advance` / `/relay-ledger-explain` — the frontier;
- the route's own response body — `reset` names the phases actually rolled back.

**If the frontier did not move, the re-plan did not happen**, whatever the board says and whatever the ask thread records.

## When re-plan is the right call

⚠️ **Route by the ladder verdict before reaching this page: `references/validate-failing.md`.** Plan-conformance is read first, and only two of its branches rewind.

- plan-conformance FAIL with the ACs/phases **never built** — the dominant case, even when other gates are also red;
- plan-conformance FAIL with a partial build;
- the ticket's premise changed under it.

**Wrong when:** plan-conformance **PASSES** (a rewind discards a conformant build — remediate instead), plan-conformance fails but every other gate passes (**plan-doc drift** — amend the plan text or accept), the head has not moved since the last FAIL (clear the no-change hold or move the head), the failing gate is type-safety (hand-fix), the ACs **were** attempted and failed (escalate), or the round is **converging** (`GET /admin/review-convergence`, judged by `roundThreshold.counted`, never `attempt=N`).

## After a re-plan

1. **Verify the frontier moved** (above). This is the step whose absence produced the whole 2026-09-17 episode.
2. **Give it an owner and a dispatchable stage.** 6 of 16 sat in `Plan` 18.5 h later with nothing running — `Backlog` never dispatches and priority never dispatches, so a rewind nobody picks up is a park with better paperwork. Same gap as CTC-2699 (answer recorded, nothing executed): one problem, not two.
3. **Say what the new plan must do differently.** A rewind that re-plans to the same plan spends a cycle and returns to the same hold. Name the finding the new plan has to answer.
4. **Check the round budget.** `applyHoldDecision` grants a cycle for `replan` and **not** for `accept` / `hand-fix` — so a hand-fix answer followed by no push leaves the ticket exactly where it was.
