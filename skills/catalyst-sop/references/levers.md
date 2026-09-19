# The levers — what actually moves a stuck ticket

⛔ **This table is the single copy. Every other page in this skill points here rather than restating it** — two copies of a lever table is how the wrong route gets recommended for the right hold.

## Five admin POSTs, and they are NOT interchangeable

Verified in `apps/mirror/src/index.ts` on `origin/main`, 2026-09-18. Each hold **kind** has exactly one release; picking the wrong one is a no-op that returns success.

| hold kind — **the TABLE it lives in**, not the symptom it resembles | route | category |
| -- | -- | -- |
| `phase_parked` — N consecutive failures (a transient 429 or clone timeout parks identically to a real defect) | `POST /admin/relay-unpark?account=&ticket=&phase=` (`index.ts:3972`) | **release** |
| `validate_class_spent` — the one-repair-round-per-gate-class budget, `relay_validate_hold`. ⭐ **This is where "head unchanged since the last validate FAIL" lives** — it is a REASON STRING on this hold (`validate-round-budget.ts:322`; metrics `validate_budget.head_unchanged_*` in `phase-failure-trigger.ts`), CTC-2365 / CTC-1803 | `POST /admin/validate-unhold?account=&ticket=` (`index.ts:4041`) | **release** |
| a **remediate round that produced no changes** — `relay_remediate_no_change_hold` (table CTC-1631, route CTC-1664). A rarer, different thing; excluded as `no_change_hold` | `POST /admin/relay-clear-no-change-hold` (`index.ts:4010`) | **release** |
| non-converging review, CTC-1724 / ADR-20260906T112500 | `POST /admin/relay-clear-review-convergence-hold` (`index.ts:4020`) | **release** |
| the ladder is at the wrong phase — you want it back at `plan` | `POST /admin/relay-rewind-to-plan?account=&ticket=` (`index.ts:4029`) | ⭐ **NOT a release — it MOVES THE FRONTIER** |

⛔ **The fifth row is a different kind of thing.** The first four *unblock a ticket at the phase it is already on*; the rewind *changes which phase it is on*. Releasing a hold on a ticket whose plan is wrong sends it straight back into the same failure, and rewinding a ticket whose only problem is a spent budget discards a good build. **Ask which one you need before you pick a route, not after.**

## ⛔ A lever whose NAME matches the symptom is not thereby the right lever

**Key a route by the TABLE it clears, never by which symptom its name resembles.** The two names that collide here:

- the symptom text **"head unchanged since the last validate FAIL"** — a reason string on the *validate budget* hold, released by `validate-unhold`;
- the route **`relay-clear-no-change-hold`** — which clears a completely different table, for a *remediate round that changed nothing*.

They share the words and share nothing else.

⛔ **A `{cleared:false}` / `hold:null` response means WRONG LEVER, not "already clear."** The route's own docstring declares that shape a **success** — *"`{cleared: false}` for a ticket holding nothing is a SUCCESS, not an error: the operator's intent (this ticket is not held) is satisfied"* (`MirrorDO.ts` ~21232). That is correct for its own table and actively misleading when you aimed at the wrong one: you get a success-shaped answer, the ticket does not move, and nothing tells you why.

**Worked example, 2026-09-18.** An agent read "head unchanged" on CTC-2490 and reached for `relay-clear-no-change-hold` — name-matching the symptom. It answered `{cleared:false, hold:null}`. The ticket had never been in that table. `validate-unhold` then moved it.

⚠️ **This is the most instructive error in the packet because of who made it and when**: the same agent had *just written* the warning about conflating "release a hold" with "move the frontier", and then picked the wrong release route anyway. Knowing that levers are non-interchangeable does not protect you; only reading which table a route touches does.

⚠️ **All five are admin-gated.** Verified 2026-09-18 by the concierge seat: an org-tier `ctc_acct_` token returns `forbidden` / HTTP 403 on `/admin/*` (`GET /admin/repos/concurrency-limit?account=tenant-0`, 15:0xZ), while the admin bearer returns 200. A tenant-scoped seat can diagnose a hold completely and be unable to clear it — see `answer-arrives.md` for who executes then.

**Observation status.** All five are present in source at the lines above, and four were exercised live on 2026-09-18: `relay-rewind-to-plan` (200, `{"reset":["plan","implement"],"clearedHold":true}` — CTC-2568, then CTC-2391 and CTC-2499), `validate-unhold` (CTC-2496, and CTC-2490 after the wrong-lever null), `relay-unpark` (CTC-2502), and `relay-clear-no-change-hold` (CTC-2490 — the null that proved it was the wrong table). `relay-clear-review-convergence-hold` is read from source, not exercised.

## Read the hold kind before you pick a lever

`catalyst-skills explain`, or `GET /admin/work-eligibility?account=<tenant>&team=<KEY>` — the team **key** (`CTC`), never the UUID, which answers `team_unknown` with zero rows and reads as a clean empty. Rows are at `.eligibility.rows`; each carries `status`, `reason`, and a `release` string naming its own route.

**Then verify the lever worked**, on the ledger and never the board: the verdict flips from *excluded — …* to *offered … for phase `<phase>`*.

## Stalls that never reach any queue

⛔ **A ticket with no ask can be just as stuck.** Gate 0 sweeps `explain` for these, not only the ask queue — neither shape appears in "Waiting on me", and neither generates one:

- **Parked with no ask and no `blocks` edge** — CTC-2502 sat parked at validate on an `ENVIRONMENT_GAP` from 2026-09-17 14:14Z with no ask filed and nothing blocking it, while the fix was already known from CTC-2503. Invisible to every ask query by construction.
- **Claimed by a worker outside the cloud** — CTC-2501's blockers were all Done, but a `catalyst-local-lane` label plus a human assignee reads as `externally_claimed`, which means "some seat owns this". When that seat is dead, the answer is *nobody*. The label has **no expiry** by design (ADR-0053), so it parks the ticket until a person clears it.

Sweep for `parked` and `externally_claimed` whenever you are asking "what is not moving?" — the ask queue answers a different question.
