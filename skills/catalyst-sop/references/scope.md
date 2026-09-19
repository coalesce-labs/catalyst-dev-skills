# The scope decision

## Two triggers reach this page

1. **Never-attempted acceptance criteria** — the classic signal, below.
2. **A repeat occurrence on the same subject, after a re-plan that verifiably moved the ledger frontier.** A ticket that genuinely went back to `plan`, was re-planned, and returned to the same hold is a scope problem, not a planning problem.

⛔ **First, rule out the lever.** A "re-plan" performed as a Linear state write is a **no-op on the ladder** — the ticket re-validates a byte-identical head and re-holds itself, which looks identical to a scope failure from the board. The 2026-09-17 batch is exactly this: 16 asks closed by state write, ten regenerating a fresh hold within 90 minutes on unchanged heads. **That population is evidence for `replan.md`, not for this page.** Descoping a ticket that was never actually retried deletes acceptance criteria to work around a broken lever.

The check is one read: did the frontier move (`catalyst-skills explain`, `/admin/relay-ledger-explain`, or the rewind route's own `reset` body)? If not, go to `replan.md` and pull the lever. Only a repeat **after** a confirmed rewind belongs here.

⚠️ **This reflex is not a new counter.** The product already holds a non-converging review for a human at **four** cycles (CTC-1724, `docs/adr/20260906T112500-a-non-converging-review-holds-for-a-human.md`), with `grace_base` release semantics so a human's release buys a fresh budget without erasing `total_holds`. This page's second-occurrence reflex sits **below** that threshold and feeds the same judgement earlier and by hand — it must never be described as a competing threshold, and you must never invent a different number. (Its mode flag `review-convergence-hold` safe-defaults to `shadow`, so on a shadow tenant the hold observes and the reflex below is the only thing operating.)

## The signal: never-attempted is not broken

⛔ **A never-attempted acceptance criterion is a SCOPE signal, not a repair signal.**

**Measured — CTC-2568:** validate failed plan-conformance with **6 of 9 approved acceptance criteria unmet — never built, not broken**. Two remediate rounds ran with that finding in hand and resolved **0/0/0**, because remediation repairs what is broken and cannot implement what was never attempted. Those rounds were spent, not wasted-by-accident: the loop was doing exactly what it is built to do, against the wrong class of finding.

So classify before you route:

| what validate found | class | what it needs |
| -- | -- | -- |
| the code does the wrong thing | **broken** | remediate |
| the approach cannot satisfy the ACs | **wrong plan** | re-plan (`replan.md`) |
| the ACs were never attempted | **scope** | this page — a scope decision, not another round |
| the ACs are right but larger than one ticket | **scope** | split |

**The tell:** run the finding against the ticket's own acceptance criteria and count. If the unmet ACs have *no implementing code at all* — no partial, no stub, no test — the ticket was scoped past what the implement phase could carry. More rounds buy nothing.

## What an agent may decide on its own

⚠️ **PROPOSED, PENDING RYAN.** This is question 4 in the review packet. Until he answers, the conservative reading applies: **split freely, descope never.**

Proposed division:

| move | who | why |
| -- | -- | -- |
| **split** — carve the unattempted ACs into a new ticket, `blocks`-linked, and finish the ticket at hand on what it did build | **the agent / steward, no ask** | nothing is lost; the work stays on the board with its ACs intact, and one ticket stops holding a lane |
| **sequence** — reorder which ticket goes first | **the steward** | a priority *ordering* call inside a scope it owns |
| **descope** — decide the unattempted ACs will not be built at all | ⚠️ **a human decision — an ask** | it changes what the product does. That is gate 5's genuine product call |
| **accept + follow-up** — merge what exists and file the remainder | **the agent, when the remainder is filed and linked before the merge** | this is the hold ask's option B; the follow-up ticket is what makes it not a descope |

**The line:** a split or a follow-up **preserves** the acceptance criteria somewhere the board can see. A descope **deletes** them. Preserving is yours; deleting is Ryan's.

## Doing it

1. **State the count, not the vibe** — "6 of 9 ACs have no implementing code" beats "this ticket is too big".
2. **File the carve-out ticket first, read the identifier back, then cite it.** A split whose second half does not exist is a descope with better manners.
3. **Link it** — `blocks` or a plain relation, so the remainder is reachable from the ticket that shed it.
4. **Re-state the surviving scope** in the ticket and in the plan document's `## Files in scope`, so the next validate round measures against what the ticket now claims rather than what it used to.
5. **Then route the original**: if what survives is built and green, it goes forward; if the plan itself was wrong for what survives, `replan.md`.

⚠️ **Do not split a ticket out from under a live lease or a running round.** Check `/admin/work-eligibility` for `lease_held` first — a split landing mid-round makes the round's findings describe a ticket that no longer exists.
