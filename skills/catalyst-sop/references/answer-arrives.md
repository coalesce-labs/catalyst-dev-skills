# When a human answers you directly

An answer arrives in chat, in a Linear thread, in a batch of many at once, or in a hallway. **Four things must happen, in order, and the last two are the ones that get skipped.**

## 1. Record it where the question lives

Post the answer to the ask as the app actor with your own role tag, quoting the human and never in their voice, then **move the ask to Done so its `blocks` relation goes terminal and the blocked work becomes dispatchable.**

Two traps that make a recorded answer inert:

- **Only a HUMAN's comment fans out along `blocks`** to wake parked work (the `ask` skill → `references/creating.md` § *What an answer DOES*). Your relay of their answer does not. **Closing the ask is what releases the edge** — not the comment.
- **A comment is not a mutation.** A steward saying "this is resolved" leaves the ask open and the work held. Issue the state change.

## 2. Execute it — the owner table

⛔ **Recording is not executing.** An ask answered "A — re-plan" and closed rewinds nothing by itself; if nobody pulls the lever, a person ends up moving the ticket by hand.

⛔ **Answering an ask is two manual acts, not one.** A head-unchanged hold ask that a human answers still has to be moved afterwards — to Plan or to Done. Budget for the second act, or do not claim the first one finished anything.

| the answer | who executes | what executing actually is |
| -- | -- | -- |
| a **hold ask** option (A re-plan / B accept / C hand-fix) | **the product**, at the answer route — answering a hold ask applies the hold decision, then resumes the work the ask was blocking | verify it landed: re-read the ledger frontier, not the Linear stage (`replan.md`) |
| a **re-plan** answer | ⛔ **`POST /admin/relay-rewind-to-plan` — NEVER a Linear state write**, then a named steward to pick it up | A state write leaves the ledger frontier at `validate` and the ticket re-holds on an unchanged head. The route returns `{"reset":["plan","implement"],"clearedHold":true}` and eligibility flips to *offered for phase plan*. A rewind with no owner is still a park — `replan.md` |
| a **scope** answer (cut it, split it, ship it) | **the agent that raised the ask** | edit the acceptance criteria, file the follow-up ticket, re-state the scope in the plan — `scope.md` |
| a **priority** answer | the **steward** of that scope | state move + the dispatch that follows from it |
| an **approval** (spend, release, credential) | the agent that needed it | do the thing, then prove it worked — an approval consumed without the action is the worst outcome |
| an answer that needs an **admin route** | ⚠️ **the concierge seat** — the one seat holding the admin bearer | All five levers are admin-gated: an org-tier `ctc_acct_` token gets 403 on `/admin/*`. A steward hands the concierge **the exact route and query string** from `references/levers.md`, never "please unblock". Do not close the ask until it has run |

**The rule: an option nobody can execute is not offerable.** If you cannot name the executor for an option at filing time, do not put it in the list.

⛔ **And name the LEVER, not just the option.** "A — re-plan" executed with a Linear state write is a no-op; executed with `relay-rewind-to-plan` it works. Each hold kind has exactly one correct route — `references/levers.md` is the single copy of that table. Reaching for `validate-unhold` on a no-change hold leaves the ticket unmoved.

## 3. Verify the execution, on a different instrument than the one that recorded it

A closed ask is evidence that a comment was posted. It is not evidence that anything moved. Check the thing the option promised:

- re-plan → the relay **ledger** frontier (`/admin/relay-ledger-explain`, `/admin/relay-advance` as a read-only explain), never the Linear stage;
- accept → the PR actually merged or the follow-up ticket actually exists, with its id read back from `create`;
- hand-fix → the branch head moved.

## 4. Close the loop for everything the answer covers

An answer given once for a class answers the whole class. When a human answers N identical questions in one sweep:

- execute all N, not just the one you asked;
- record the batch as `[bookkeeping]` on each, naming the one human comment it derives from;
- **propose a standing decision** (`needing-a-human.md`) so the N+1st copy never gets raised. ⚠️ The batch is *evidence for proposing* the rule, not the rule — the authorization was worded over that batch and does not self-extend, and the rule it justifies is a **route per failing gate**, never a blanket letter.

A batch of sound answers closed with Linear state writes executes none of them: the subjects re-raise, each with fresh asks, because a state write is a no-op on the relay ladder (`replan.md`).

**So step 4 is not "answer them all faster", and it is not "stop choosing A".** It is: execute each answer with its real lever, verify it on the ledger, and change what the raiser does next (`validate-failing.md`). A batch of correct answers executed with a no-op buys nothing at all.
