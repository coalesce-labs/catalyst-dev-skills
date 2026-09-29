# Classifying an ask

Pick exactly one class and say which rule put it there. When two classes fit, take the more conservative one (`human` over `decidable`, `decidable` over `mechanical`).

## `mechanical`

Nothing needs deciding; something needs doing. Signs:

- the subject's PR has a conflict, a real but small failing check, a check that is a known flake or already fixed on main, an unanswered automated review at head, or unresolved threads with an obvious fix;
- a stale label, fence or hold whose reason is gone (confirm with whoever placed it);
- no delegate or a dead seat on work that is otherwise done;
- a duplicate ask, a moot ask (subject merged, Done or canceled, found by the premise check), or an answer already given that was never written back;
- a validate hold whose findings are real, small and in the branch's own diff (continue), or whose hold head is stale because the mirror missed a push.

## `decidable` (standing authority)

A real choice where every option is reversible and none hits the always-escalate list below. Something picks the answer:

- the ask's stated default, when the default is safe and reversible;
- an accepted ADR, the subject's approved plan, or an earlier recorded decision;
- evidence that makes one option clearly right (an existing precedent in the same code, a measured cost).

The skill proposes the decidable answer and does not apply it. Say which of the three sources above picked it, and name the option in `proposed_answer` with its label copied verbatim from the ask.

## `human`: always escalate (held)

Any one of these makes it the human's, whatever the evidence says:

- spend of any size: a paid plan, a larger budget, a higher token cap, a new vendor;
- deleting data or credentials, even soft deletes, including credential-store rows;
- customer data moving to new places, or a product call about what a customer sees (what a card says, which feature to build);
- messages outside the team;
- public releases (an npm publish, a tag, a public repository or post), and merging a public-repository PR;
- security: a vulnerability, an access or auth boundary, an exposed secret;
- rollout flag flips;
- anything a human must physically do: a console setting, an app permission, an OAuth or install step;
- changing what runs unattended: a schedule, an auto-dispatch or auto-merge rule, a new background job;
- a default that reverses a recorded human direction;
- every listed option breaking a pinned acceptance scenario;
- an irreversible architecture change with no recorded direction.

Check this list before anything else, because it decides the class on its own. The list fixes only the class; the pattern still comes from the table below. For these, write one recommendation with evidence and no `proposed_answer`. The recommendation is still useful; it is just not applied.

## Pattern tags (closed vocabulary)

`pattern` and every entry of `secondary_patterns` MUST come from this table, so patterns can be counted across runs. Put the specifics (which fence, which dependency, which PR) in `pattern_detail`, which is free text. If nothing fits, use `other` and explain in `notes`. A reviewer promotes a recurring `other` into the table. Never invent a new tag in `pattern`.

| tag | use when | also covers |
| -- | -- | -- |
| `fence-outlived-cause` | a fence, hold, park or label placed with a stated reason, and that reason is gone (the fix merged, the condition was met) | fence-condition-now-met, park-cause-fixed-on-main, file-overlap-hold-cleared, deliberate-merge-window-hold (when over) |
| `dependency-landed` | work held on an external dependency (a package publish, a sibling merge) that has since landed | hold-dependency-now-published, held-dependency-now-published |
| `moot` | the premise check found the ask's subject already merged, Done or canceled, or the answer already posted; recorded without a full investigation | moot-subject-closed |
| `shipped-elsewhere` | the scope already shipped under another ticket's PR | delivered-under-sibling-ticket, superseded-by-shipped-sibling-tickets, auto-closed-by-pr-title |
| `dead-claim` | a seat or local-lane claim with no live worktree, comment or push for more than 24 h | abandoned-local-lane-claim |
| `repo-paused` | excluded by a repository pause, or routed to a paused repository by mistake | repo-misassigned-to-paused-sibling |
| `review-threads-open` | an otherwise green PR blocked by unresolved review threads, or an automated review never answered at head | stale-review-at-head, review-findings-unaddressed-at-head |
| `conflict-behind-main` | the PR conflicts with main or is far behind it | — |
| `ci-failure` | a real, small failing check, or a flake already fixed on main | real-ci-failure-small-fix, flake-fixed-on-main |
| `validate-hold` | a validate budget, convergence or round-cap hold, including findings carried over unrepaired | validate-hold-real-small-defect, validate-hold-stale-head, finding-carried-over-unrepaired |
| `mirror-missed-push` | the ledger's head evidence disagrees with the PR head | — |
| `waiting-on-open-dependency` | correctly waiting on an open blocker (add the missing relation if there is none) | parked-behind-unlinked-dependency, blocked-by-unmerged-sibling |
| `no-relay-entry` | work the relay cannot enter from its current stage (human-owned PR stage, never entered the ladder) | no-relay-entry-from-pr-state, zombie-never-entered-ladder |
| `capacity-starvation` | eligible and queued, but new starts lose to in-flight work | new-start-starvation |
| `decision-already-recorded` | the answer exists already: in chat, on a sibling ticket, in an ADR or plan | answered-not-written-back, default-contradicts-recorded-direction |
| `premise-stale` | a later event changed the facts the ask or ticket rests on | premise-possibly-stale |
| `options-incomplete` | every listed option is wrong or breaks a pinned scenario; the answer is off the list | ask-options-miss-a-pinned-scenario |
| `design-choice` | a genuine, reversible plan or architecture choice (amend the plan, pick a package boundary) | plan-pinned-behaviour-amendment, architecture-boundary-conflict |
| `default-already-safe` | the ask's own default is reversible and costs nothing | — |
| `duplicate` | the same question or ticket exists twice | duplicate-ask |
| `human-release` | public release, publish or tag approval | public-release-approval |
| `human-spend` | raising a cap, a budget or a plan | spend-increase |
| `human-delete` | deleting data or credentials | credential-store-delete |
| `human-product` | what to build, or what a customer sees | product-feature-approval, product-copy-call |
| `human-external` | needs a human to read or change a third-party console behind their login | external-console-verification |
| `no-deadline` | secondary only: the ask has no `Auto-executes:` line, so it waits forever | no-deadline-default |
| `other` | nothing above fits; explain in `notes` | — |

Two checks every run makes:
- **Confirm the owner live.** Check the session list, a live worktree, or a push or comment in the last 24 h. In a container, use the snapshot's lease heartbeats. Don't infer the owner from a handoff document's author.
- **Check where a "fixed" fix lives before calling a fence releasable.** Repository scripts reach a ticket when its branch contains the fix. Runner-image code reaches it when the active runner pin contains it (`git merge-base --is-ancestor <fix> <pin>`). In a container with no checkout, say the fix's reach is unverified unless the snapshot states it.
