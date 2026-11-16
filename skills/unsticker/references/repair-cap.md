# Repair-cap and validate-hold asks

Use this for an ask that says a ticket spent its repair rounds (titled "N repair rounds and still failing", offering re-plan, fix by hand, or accept), a validate hold, or a decision raised by a remediate round. The ask's text and its default are written by a generator at the moment the cap tripped. They are a timer, never evidence. The answer comes from what the rounds actually did and what the branch needs now.

Work the steps in order. Each early step is cheap and often decides the case on its own, so a run that stops early still has the answer.

## 1. Is it already moving or gone?

Read the subject's state, its newest outcome comments, the ledger's `relayPhaseState`, and the PR head.

| you see | next step | option |
| -- | -- | -- |
| the subject is Done, or it has no open PR and a comment records the merge | `close-moot` | none |
| a push landed after the hold (PR head differs from the hold head), and validate is running or queued on it | `wait`, then close the ask when it passes | none, or B when the push was a hand fix |
| validate is `ready` or running after an operator rewind, with nothing left to fix | `rerun-validate` (let it run) | none: answer with `DECIDED:` |

Done when you can say which row applies, or that none does.

## 2. Build the round table

One row per counted round you can see, from the subject's outcome comments ("Remediate attempt N", "Phase FAILED") and the ledger's `relayPhaseFailures`:

- `changed_code`: true only when the round pushed a commit that changed the branch's own code. "No code change", "nothing in this branch can clear", `no_change_advance`, a head that stayed the same, or a round that failed before it started are all false.
- `cause`, one of:
  - `platform`: the platform refused or broke, not the code. Verifier refusals (`stage_*`, `supervised_*`, `plan_conformance_not_run`, `gate_not_run_budget`, `run_time_short`, `review_helper_unavailable`, `transcript_capture_incomplete`), `setup_failed`, `playbook_revision_unavailable`, a model-provider crash, and `wip_reconciliation` (a saved fix that cannot replay is the platform's leftover, not a defect).
  - `base`: the branch is behind main. A conflict (`mergeableState: dirty`, `rebase_conflict`), conflict markers after the round merged main, or a failing test outside the branch's diff that main already fixed.
  - `code`: a finding in the branch's own diff.
  - `unknown`: the inputs do not say.

Done when every counted round has a row. When most rounds changed no code, the cap measured the platform, not the work: say so in `root_cause` and name the platform causes.

## 3. Check where validate stands

Find the newest validate verdict and its head. Validate passed at a head, plus a later stage refusing on a platform cause, means the work is sound and no re-plan is owed. "Still fails its checks" in the ask is a claim to test: CI on a draft PR may never have run, and a budget failure is not a red check.

## 4. Pick the step

Take the first row that fits. A ticket can need two steps (merge main, then a small fix); list both in order.

| the evidence | next steps | option |
| -- | -- | -- |
| the PR conflicts with main, or rounds fail on a test or marker that main's newer code fixes | `merge-main`, then `rerun-validate` when validate has not seen the merged head | B |
| a small defect in the branch's own diff that the evidence names (a lint miss, a test following a symbol main deleted) | `merge-main` first when behind, then `fix-on-branch` | B |
| a saved WIP ref blocks reconciliation and its change is already in the head, or is superseded | delete that ref as part of `merge-main` or `fix-on-branch` | B |
| validate passed at the PR's current head sha, and a later stage refused for a missing validate record or review | `rerun-validate` or `review-at-head` | none: `DECIDED:` |
| validate passed at an earlier sha, and the head moved since only by a main merge or a conflict resolution, with no code owed | `accept` at the current head (the lever that carries the passed verdict to the new sha), then `review-at-head` | C |
| the cap was spent on platform faults since fixed, and real findings remain that a round can take | `grant-round` | none: `DECIDED: continue` |
| one finding is left that no round can close (an external constraint, measured), and the ticket's intent is met | `accept`, with the follow-up ticket named | C |
| validate names plan parts that were never built | `fix-on-branch` (a writer finishes them) | B |
| the plan itself cannot meet its scenarios, and a different plan could | `re-plan` | A |

`re-plan` is the rarest answer. It discards a plan and an implementation, so it needs evidence that the plan is wrong, never only a count of failed rounds. Unbuilt parts mean unfinished work (B). A constraint no plan can beat means accept the rest (C).

## 5. Name the option and who carries it

- `ask_option` is the listed letter the steps amount to. B covers any change made on the branch outside a repair round, by an agent or a person: "a human fixes it by hand" is the generator's wording, not a requirement for a person. When no listed option fits, `ask_option` is null and the answer is a `DECIDED:` line naming the steps.
- The class follows the step, not the option list. When the evidence fixes the step and the step is mechanical (a main merge, a named small fix, a rerun, a wait), the class is `mechanical`, even though the ask offers a choice.
- `reaches_human` is false when an agent can carry every step. It is true only when a step needs something no agent holds: an approval on the always-escalate list, a credential, a product call. Then name that one step.

## 6. Check every input for staleness

Before writing, compare each input with the newest evidence and record every contradiction in `stale_evidence`:

- a ledger `failureClass` or `relayFailureLedger` entry from an early round, when a later round fixed it or validate passed since;
- a hold or `branchHeadEvidence` head older than the PR head;
- a lease whose round already posted its outcome (the lease row outlives the round until its deadline);
- the ask's claim that the ticket "still fails its checks", when CI never ran or the failure was a budget or platform refusal;
- a prior determination that only restated the ask's default.

A conclusion built on a stale field is the most common wrong answer here: a recommendation of a hand fix for a defect fixed days earlier.
