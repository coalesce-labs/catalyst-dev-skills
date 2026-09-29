# When validate keeps failing — route by the ladder verdict, never by the letter

⛔ **There is no blanket answer.** The generated ask prints the same three options for every failure, so it *looks* like one decision. It is several different situations wearing one template, and most of them are not human decisions at all.

⛔ **Do not branch on the LETTER.** The option letters differ between the validate-budget ask and the round-threshold ask: validate-budget is A re-plan / B accept / C hand-fix, round-threshold is A re-plan / B hand-fix / C accept. Branch on the option **string** and the ask's kind.

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

⚠️ **A multi-gate failure does not mean "remediate".** A ticket that fails PC *and* type-safety *and* code-review still rewinds when some of its plan phases were never built, because remediation cannot repair what was never attempted. Count implemented ACs before you let the number of red gates decide.

## Worked example — five hold asks with the same three options

The cleanest proof of "read the ladder verdict, not the ask": all five print the same three options, and three of the five must **not** take option A.

| ticket | ladder | correct action |
| -- | -- | -- |
| `ENG-101` | PC FAIL (phases 3, 4, 6 absent), TS FAIL, CR FAIL | **rewind to plan** — never-built dominates the other two reds |
| `ENG-102` | PC FAIL + CR FAIL, partial build | **rewind to plan** |
| `ENG-103` | **PC PASS**, TS / CR / SR FAIL | **remediate** — a rewind would discard a conformant build |
| `ENG-104` | PC FAIL + CR FAIL, every deliverable exists | **remediate** |
| `ENG-105` | PC FAIL, **every other gate PASS**, "the code is good" | **plan-doc drift** — amend the plan text or accept. **Not a re-plan** |

An agent can clear the first four with no human input: rewind `ENG-101` and `ENG-102` (`reset [plan, implement]`, `clearedHold:true`), release `ENG-103` and `ENG-104` with `validate-unhold` so remediation runs, and close their hold asks Done.

⛔ **Plan-doc drift (`ENG-105`) is deliberately NOT released, and this is a gap in the product, not a judgement call.** The plan-doc-drift shape has **no agent-executable route at all**: there is no admin accept route, and clearing its budget hold would only re-validate the same head against the same drifted plan — a guaranteed re-hold. So it waits on a human clicking option B. **Every other sub-shape in this table can be executed by an agent; this one cannot.** Until an accept route exists, plan-doc drift is the one validate failure that legitimately reaches a human — and it should reach them as *one* ask, not as a recurring one.

## Per-gate notes

- **type-safety** — the failure names its own lines. Run `bun run typecheck` in the package: **exit 0 proves the failure is the reward-hacking scan, not the compiler.** A fixture cast is mechanical; a production `as unknown as` needs a real type.
- **plan-conformance** — read the unmet-AC list **and** grep the post-remediate diff for the ACs' named symbols. Never attempted → rewind. Attempted and failed → escalate; re-planning a plan that was tried is a wasted cycle.
- **code-review** — route by the severity field. ⛔ **Mandatory pre-check: is it a verdict at all?** A validate PASS whose ladder block exceeds the 8192 B receipt cap is recorded as `phase_failed` and spends a no-op remediate round. Read the artifact; advance a `publish_refused` by hand. ⚠️ Past round ~5, findings are interaction bugs, not isolated defects.

## Head unchanged since the last validate FAIL — never a human decision

- A hold on an unchanged head does not clear by itself. It is tautological by construction: `head unchanged` *means* no commit landed, and a commit landing is the only thing that auto-releases it.
- When a human answers one, they return the printed default and **contribute no information**, and the ticket still has to be hand-moved afterwards. **Answering an ask is two manual acts, not one.**

⛔ **Its lever is `POST /admin/validate-unhold`.** "Head unchanged since the last validate FAIL" is a **reason string on the validate round-budget hold**, not a hold of its own. ⚠️ **`relay-clear-no-change-hold` is NOT this lever** despite the name — it clears `relay_remediate_no_change_hold`, the *remediate round that changed nothing*, and on a ticket that was never in that table it answers `{cleared:false, hold:null}`, a documented **success** for the wrong table. See `references/levers.md`.

**Recommendation (a raiser change):** for this class the raiser files no ask and clears the validate hold itself, reading `hold.headSha` back afterwards — it can still name the old sha long after a push. If the head genuinely has not moved, **move it or narrow the plan**; do not clear in a loop, since a re-run on an unchanged head re-holds.

## What the ask does not tell you, and should

**The hold ask says "one repair round already spent this episode" and names no round number.** So an agent cannot tell from the ask whether this is cycle 1 or cycle 9 — the number that decides between another round and a scope call. Read it yourself: `GET /admin/review-convergence`, judging by `roundThreshold.counted`, **never** `attempt=N` (a ticket can read `attempt: 9` at `counted: 2`).
