# Classifying an ask

Pick exactly one class and say which rule put it there. When two classes fit, take the more conservative one (`human` over `decidable`, `decidable` over `mechanical`).

## `mechanical`

Nothing needs deciding; something needs doing. Signs:

- the subject's PR has a conflict, a real but small failing check, a check that is a known flake or already fixed on main, an unanswered automated review at head, or unresolved threads with an obvious fix;
- a stale label, fence or hold whose reason is gone (confirm with whoever placed it);
- no delegate or a dead seat on work that is otherwise done;
- a duplicate ask, a moot ask (subject merged or canceled), or an answer already given that was never written back;
- a validate hold whose findings are real, small and in the branch's own diff (continue), or whose hold head is stale because the mirror missed a push.

## `decidable` (standing authority)

A real choice where every option is reversible and none involves spend, public release, deleting data, customer data, or messages outside the team. Something picks the answer:

- the ask's stated default, when the default is safe and reversible;
- an accepted ADR, the subject's approved plan, or an earlier recorded decision;
- evidence that makes one option clearly right (an existing precedent in the same code, a measured cost).

In this release the skill proposes the decidable answer and does not apply it. Say which of the three sources above picked it.

## `human`

Any one of these makes it the human's:

- spend: a paid plan, a larger budget, a higher token cap, a new vendor;
- public release: an npm publish, a tag, a public repository or post;
- deleting data or credentials, even soft deletes, in a tenant store;
- customer data or anything a customer sees that is a product call (what a card says, which feature to build);
- messages outside the team;
- an irreversible architecture change with no recorded direction.

For these, write one recommendation with evidence. The recommendation is still useful; it is just not applied.

## Pattern tags

Tag every record so patterns can be counted across asks. Reuse a tag when it fits; coin a new kebab-case tag when none does and describe it in the record.

| tag | meaning |
| -- | -- |
| `no-relay-entry-from-pr-state` | unblock generator fired because a PR-stage ticket owned by a human seat cannot enter the relay |
| `stale-review-at-head` | an automated review was requested but never answered at the current head |
| `conflict-behind-main` | the PR needs main merged in |
| `real-ci-failure-small-fix` | a genuine but small check failure (format, a count, a lint) |
| `flake-fixed-on-main` | the failing check passes on main's latest run |
| `deliberate-merge-window-hold` | a `hold` placed by another seat for a merge window |
| `duplicate-ask` | the same question is open twice |
| `moot-subject-closed` | the subject merged, closed or was canceled |
| `answered-not-written-back` | the answer exists in chat or a comment but the ask is still open |
| `auto-closed-by-pr-title` | a merged PR naming the ask closed it without a decision |
| `validate-hold-real-small-defect` | validate findings are real, small and in the branch's diff |
| `validate-hold-stale-head` | the hold judges a head the mirror recorded before a later push |
| `plan-pinned-behaviour-amendment` | the question reverses something the approved plan pinned |
| `architecture-boundary-conflict` | the plan's approach breaks a machine-enforced boundary |
| `default-already-safe` | the ask's own default is reversible and costs nothing |
| `instrument-lost-its-signal` | a measurement's producer was removed |
| `product-copy-call` | what a customer-visible surface should say |
| `public-release-approval` | publish or tag approval |
| `credential-store-delete` | deleting a secret or a credential row |
| `spend-increase` | raising a cap, budget or plan |
| `premise-possibly-stale` | a later event may already have answered the question |
| `no-deadline-default` | the ask has no `Auto-executes:` line, so its default never fires and it waits forever |
| `mirror-missed-push` | the ledger's head evidence disagrees with the PR head, so holds and waivers judge stale code |
| `finding-carried-over-unrepaired` | an earlier "continue" granted no repair round, so old findings resurface looking new |
| `default-contradicts-recorded-direction` | the ask's default undoes a direction the human already recorded |
| `ask-options-miss-a-pinned-scenario` | every listed option breaks a pinned acceptance scenario; the answer is off the list |
| `product-feature-approval` | whether to build a customer-visible feature, and how much of it |
| `external-console-verification` | the question needs a human to read a setting in a third-party console behind their login |
