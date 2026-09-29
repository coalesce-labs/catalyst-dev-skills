# Dispatch — launching a ticket-worker session

⚠️ **This is the OFF-CLOUD shape.** On a Catalyst Cloud account the phases run in the cloud account's runner containers and you dispatch by moving the card, not by launching anything — read [`cloud-dispatch.md`](cloud-dispatch.md) instead. `cloud-detection.md` is what tells you which you are on; launching a local session on a cloud account puts two workers on one branch.

## Launching a ticket-worker session IS the dispatch

There is no daemon and no pull-based scheduler to hand a ticket to off-cloud. You dispatch by launching a **ticket-worker session** yourself (a background agent, or whatever your environment's session primitive is).

A ticket worker carries one ticket through the phase ladder — research → plan → implement → validate (→ remediate) → PR → merge — one artifact-gated phase per invocation, and ends each invocation with a report to you. If your environment has a dedicated worker skill, launch that. If it does not, a session that runs this pack's phase skills for the next missing phase (`research-codebase`, `create-plan`, `implement-plan`, `validate-plan`, `create-pr`, `merge-pr`) and then reports back does the same job. Three shapes:

```
<worker> PROJ-123                  # do the next missing phase, produce its artifact, report, STOP
<worker> PROJ-123 through merge    # keep going, phase after phase, until merged or genuinely blocked
<worker> PROJ-123 phase plan       # force a specific phase (re-run after a rejected report)
```

⛔ **Never do the phase work yourself.** No hand-edited product code, no worktree you commit into directly, no phase agent you drive by hand. If you find yourself wanting to touch code, the thing you actually want is a launched worker session.

## Cap at free slots

Dispatch in **priority order**, capped at how many concurrent sessions you can actually track. Launching twenty worker sessions when you can only watch nine does not make them go faster; it makes the queue unreadable and the holds invisible.

## ⛔ A cap is never silent

**Every ticket that was ready and was not dispatched is named, with the reason.** The reader of your plan comment cannot tell *held deliberately* from *never looked at* — only you can, and only in the moment.

| held | why |
| -- | -- |
| PROJ-438 | largest new surface on the provisioning path the rehearsal walks today; ready in substance, wrong day |
| PROJ-55 | ⛔ its ACs target a retired app — needs re-scoping; I did not rewrite someone else's ticket unasked |
| PROJ-439 | first scenario stalls on a copy decision that is the human's; the deliverability half could split out |

## Announce the dispatch on the ticket

A top-level comment on each ticket you launch a session for: that it was dispatched, by whom, why it was judged ready, the trap in its ACs if there is one, and an explicit **"ask me in this thread, do not stall silently."**

⚠️ **Say "launched by `steward/<scope>` via a ticket-worker session."** State moves a phase makes may still write with the host's personal token, so an unattributed comment can read as the human's. See the threading reference.

## Phase-completion evidence

This is what you check **between** worker invocations to confirm a phase actually happened, before you dispatch the next one — the worker's report is one session's *claim*; the artifact it names is the *proof*, and when the two disagree the artifact wins (artifacts on disk and in GitHub/Linear ARE the pipeline state).

Re-read the specific artifact the report cites. For the implement phase, use the repository's own check command (for example `bun run check`) and `git log origin/main..origin/<TICKET>`:

| phase | phase-completion evidence |
| -- | -- |
| research / plan | the cited `thoughts/shared/research\|plans/*<TICKET>*.md` file exists and reads as a real document, not a stub |
| implement | `git log origin/main..origin/<TICKET>` shows commits, AND the report's gate tail is a real pass of the repository's check command, not summarized as one |
| validate | a recorded verdict, not just a claim of "looks fine" |
| pr | an actual open PR for the branch (`gh pr view`), with the real number the report cites |
| merge | `gh pr view <n> --json state,mergedAt` read back yourself — never the report's word alone, and never a merge command's exit code alone |

A report that says `DONE` with no matching artifact, or a `gate:` line you cannot verify, is not phase-completion evidence — it is BLOCKED until you can confirm it, whatever the report's own verdict says. This is the same discipline `merge-pr` already applies to a single PR; here it applies to every phase of every ticket you are coordinating.

## State what you cannot enforce

If your dispatch note asks a worker session to hold something — a merge, a surface, an ordering — and you have no gate that enforces it, **say that in the same breath**. "I have no merge gate and cannot enforce this" turns a false guarantee into an honest request, and lets whoever depends on it plan for the miss.
