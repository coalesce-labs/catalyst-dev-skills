# When validate keeps failing — route by the ladder verdict, never by the letter

⛔ **There is no blanket answer.** The generated ask prints the same three options for every failure, so it *looks* like one decision. It is several different situations wearing one template, and most of them are not human decisions at all.

⛔ **Do not branch on the LETTER.** The option letters differ between the validate-budget ask and the round-threshold ask (`hold-ask-dialog.ts:5-8`): validate-budget is A re-plan / B accept / C hand-fix, round-threshold is A re-plan / B hand-fix / C accept. Branch on the option **string** and the ask's kind, as `holdDecisionFor` does.

⛔ **Do not branch on ONE gate either.** Read the ladder verdict, not the ask.

## Precedence — plan-conformance first, then the rest

**PC = plan-conformance. Read it before anything else, then branch:**

| PC | the rest | what it means | action |
| -- | -- | -- | -- |
| **PASS** | any gate FAIL | the build conforms to the plan; the defects are quality | **remediate** with the findings attached. ⛔ Never rewind — a rewind discards a conformant build |
| **FAIL** | ACs/phases **absent** — never built | the plan was not executed | **rewind to plan** (`replan.md`) |
| **FAIL** | partial build | some of the plan landed | **rewind to plan** |
| **FAIL** | **everything else PASS** | ⭐ **plan-doc drift** — the code is good, the plan document describes it wrongly | **amend the plan doc, or accept and file the follow-up. NOT a re-plan** |
| **FAIL** | deliverables exist + CR FAIL | built, then found defective | **remediate** |

⚠️ **A multi-gate failure does not mean "remediate".** CTC-2391 fails PC *and* type-safety *and* code-review, and **re-plan still dominates** — because its phases 3, 4 and 6 were never built, and remediation cannot repair what was never attempted. Count implemented ACs before you let the number of red gates decide.

## The live worked example — five open M6 hold asks, 2026-09-18

The cleanest available proof of "read the ladder verdict, not the ask": all five print the same three options, and three of the five must **not** take option A.

| ticket | ladder | correct action |
| -- | -- | -- |
| CTC-2391 | PC FAIL (phases 3, 4, 6 absent), TS FAIL, CR FAIL | **rewind to plan** — never-built dominates the other two reds |
| CTC-2499 | PC FAIL + CR FAIL, partial build | **rewind to plan** |
| CTC-2496 | **PC PASS**, TS / CR / SR FAIL | **remediate** — a rewind would discard a conformant build |
| CTC-2490 | PC FAIL + CR FAIL, every deliverable exists | **remediate** |
| CTC-2485 | PC FAIL, **every other gate PASS**, "the code is good" | **plan-doc drift** — amend the plan text or accept. **Not a re-plan** |

**Outcome, 2026-09-18** — four of these five M6 holds were cleared by an agent with no human input: CTC-2496 released with `validate-unhold`, CTC-2391 and CTC-2499 rewound (`reset [plan, implement]`, `clearedHold:true`), and CTC-2490 released with `validate-unhold` after the wrong-lever null. CTC-2502 was cleared in the same sweep but is not in this table — it was parked with no ask at all (`references/levers.md`) and was unparked. Four hold asks closed Done.

⛔ **CTC-2485 was deliberately NOT released, and this is a gap in the product, not a judgement call.** The plan-doc-drift shape has **no agent-executable route at all**: there is no admin accept route, and clearing its budget hold would only re-validate the same head against the same drifted plan — a guaranteed re-hold. So it waits on a human clicking option B. **Every other sub-shape in this table can be executed by an agent; this one cannot.** Until an accept route exists, plan-doc drift is the one validate failure that legitimately reaches a human — and it should reach them as *one* ask, not as a recurring one.

## Per-gate notes

- **type-safety** — the failure names its own lines. Run `bun run typecheck` in the package: **exit 0 proves the failure is the reward-hacking scan, not the compiler** (CTC-2673 ran exactly this and found tsc clean). A fixture cast is mechanical; a production `as unknown as` needs a real type.
- **plan-conformance** — read the unmet-AC list **and** grep the post-remediate diff for the ACs' named symbols. Never attempted → rewind. Attempted and failed → escalate; re-planning a plan that was tried is a wasted cycle.
- **code-review** — route by the severity field. ⛔ **Mandatory pre-check: is it a verdict at all?** A validate PASS whose ladder block exceeds the 8192 B receipt cap is recorded as `phase_failed` and spends a no-op remediate round (CTC-2392 r9 → CTC-2676). Read the artifact; advance a `publish_refused` by hand. ⚠️ Past round ~5, findings are interaction bugs, not isolated defects.

## Head unchanged since the last validate FAIL — never a human decision

- **0 of 9 were ever closed by a commit landing.** Positive control: the same instrument returns **10** against the failed-twice population, so it hits. The zero is real.
- Tautological by construction: `head unchanged` *means* no commit landed, and a commit landing is the only thing that auto-releases it.
- In **3 of 3** cases where a human answered (CTC-2373, CTC-2379, CTC-2517), the human returned the printed default and **contributed no information**. All three then had to be hand-moved afterwards (CTC-2356 → Plan, CTC-2456 → Plan, CTC-2362 → Done). **Answering an ask is two manual acts, not one.**

⛔ **Its lever is `POST /admin/validate-unhold`.** "Head unchanged since the last validate FAIL" is a **reason string on the validate round-budget hold** (`validate-round-budget.ts:322`), not a hold of its own. ⚠️ **`relay-clear-no-change-hold` is NOT this lever** despite the name — it clears `relay_remediate_no_change_hold`, the *remediate round that changed nothing*, and on CTC-2490 it answered `{cleared:false, hold:null}`, a documented **success** for a table the ticket was never in. See `references/levers.md`.

**Recommendation (a raiser change):** for this class the raiser files no ask and clears the validate hold itself, reading `hold.headSha` back afterwards — CTC-2410 showed it still naming the old sha 24 h after a push. If the head genuinely has not moved, **move it or narrow the plan**; do not clear in a loop, since a re-run on an unchanged head re-holds (CTC-1803).

## What the ask does not tell you, and should

**25 open asks say "one repair round already spent this episode"; none names a round number** (control: 34 open asks contain the word "round"). So an agent cannot tell from the ask whether this is cycle 1 or cycle 9 — the number that decides between another round and a scope call. Read it yourself: `GET /admin/review-convergence`, judging by `roundThreshold.counted`, **never** `attempt=N` (CTC-2483 read `attempt: 9` at `counted: 2`).
