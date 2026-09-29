# When the decision is "go back to planning"

## ⛔ Re-plan is a sound answer. It recycles when it is executed with the wrong lever.

**This is the most important page in the skill, because the failure it describes looks exactly like the answer being wrong.**

Setting a ticket to `Plan` in Linear **does not move the relay ledger frontier.** The ledger keeps reading `plan → completed`, frontier `validate`, so the next round re-validates the **same head** and re-holds it — and files a fresh blocking ask. The ticket looks re-planned on the board and has not moved an inch.

A batch of validate-hold asks answered "A — re-plan" and closed with Linear state writes regenerates a fresh hold *and* a fresh blocking ask on byte-identical heads, often within the hour, while the tickets that did not re-raise sit in `Plan` with nothing running.

**Worked example.** An agent moves `ENG-123` with `linearis issues update --status Plan`. The eligibility surface still reads *"excluded — this validate failure already spent its one repair round."* The agent then calls the mechanical route:

> ⚠️ **In a phase container, skip the `linearis` steps here.** The cloud runner sets `CATALYST_PHASE`, holds no Linear credential and usually has no `linearis` binary — the runner owns the ticket write-back there. Skip any `linearis` call when `CATALYST_PHASE` is set or when `command -v linearis` fails, and pull the admin lever only; it needs no Linear credential.

```
POST https://<your-cloud-host>/admin/relay-rewind-to-plan?account=<tenant>&ticket=ENG-123
→ HTTP 200  {"ticket":"ENG-123","reset":["plan","implement"],"clearedHold":true,"clearedAcceptance":false}
```

Eligibility then reads **"offered (position 24) for phase plan."** The state write did nothing; the route did everything.

So: **do not conclude that "A — re-plan" is the wrong answer.** Conclude that a re-plan executed as a Linear state write is a no-op that re-raises itself. Use the route, then verify the ledger.

## The rewind lever

⛔ **The five admin routes are not interchangeable, and the lever table is in ONE place: `references/levers.md`.** Read it before picking a route. The short version for this page:

- **The rewind is `POST /admin/relay-rewind-to-plan?account=&ticket=`.** It returns the `reset` phase list, `clearedHold` and `clearedAcceptance`.
- **It is the one lever that MOVES THE FRONTIER.** The other four release a hold at the phase the ticket is already on. Releasing a hold on a ticket whose plan is wrong sends it straight back into the same failure.
- **Answering a hold ask runs the same executor** — it performs the rewind **before** it resumes the blocked work, so the answer lands on the phase that will consume it.
- **Read-only explains, for deciding without changing anything:** `GET /admin/relay-advance`, `/relay-advance-explain`, `/relay-ledger-explain`.

⚠️ **Admin-gated.** An org-tier `ctc_acct_` token returns `forbidden` / HTTP 403 on `/admin/*`; the admin bearer returns 200. If you hold only a tenant token, hand the exact route and query string to a seat that has admin (`answer-arrives.md`) — do not record the decision as executed.

## Verify the ladder moved — on the ledger, never the Linear stage

A ticket in `Plan` on the board is not evidence of anything. Check one of:

- `catalyst explain <ticket>` — the verdict flips from *excluded — already spent its one repair round* to *offered … for phase plan*;
- `GET /admin/relay-advance` / `/relay-ledger-explain` — the frontier;
- the route's own response body — `reset` names the phases actually rolled back.

**If the frontier did not move, the re-plan did not happen**, whatever the board says and whatever the ask thread records.

## When re-plan is the right call

⚠️ **Route by the ladder verdict before reaching this page: `references/validate-failing.md`.** Plan-conformance is read first, and only two of its branches rewind.

- plan-conformance FAIL with the ACs/phases **never built** — the dominant case, even when other gates are also red;
- plan-conformance FAIL with a partial build;
- the ticket's premise changed under it.

**Wrong when:** plan-conformance **PASSES** (a rewind discards a conformant build — remediate instead), plan-conformance fails but every other gate passes (**plan-doc drift** — amend the plan text or accept), the head has not moved since the last FAIL (release the validate hold or move the head — `levers.md`), the failing gate is type-safety (hand-fix), the ACs **were** attempted and failed (escalate), or the round is **converging** (`GET /admin/review-convergence`, judged by `roundThreshold.counted`, never `attempt=N`).

## After a re-plan

1. **Verify the frontier moved** (above). Skipping this step is how a batch of sound answers turns into a batch of re-raised asks.
2. **Give it an owner and a dispatchable stage.** `Backlog` never dispatches and priority never dispatches, so a rewind nobody picks up is a park with better paperwork. It is the same gap as an answer recorded with nothing executed: one problem, not two.
3. **Say what the new plan must do differently.** A rewind that re-plans to the same plan spends a cycle and returns to the same hold. Name the finding the new plan has to answer.
4. **Check the round budget.** Applying a hold decision grants a cycle for `replan` and **not** for `accept` / `hand-fix` — so a hand-fix answer followed by no push leaves the ticket exactly where it was.
