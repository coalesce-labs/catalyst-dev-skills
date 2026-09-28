# Acting on an ask

Act only in `act` mode, and only as far as the class allows. Otherwise record `action_taken: "none"` and put the would-be action in `chosen_action`.

## Hard limits (every mode, every class)

- Never merge by hand. Queue-merge through the repository's normal gates only.
- Never publish, tag or release anything public.
- Never delete data or credentials.
- Never touch another seat's active branch, worktree or lease. If a seat owns it, hand it over with the steps.
- Never write a human's `DECIDED:` line or answer in a human's voice.
- Never move a ticket to Todo to "resubmit" work that has an open PR; that redoes finished work.
- Never add a gate, hold or fence unless it prevents a failure you observed.
- Never auto-delegate or dispatch a fenced ticket (one carrying `catalyst-local-lane`). The fence means a local lane owns it, so hand the steps to that lane instead. (Ryan, 2026-09-27.)
- If a human has to do something (click, grant, run, sign in, decide), carry it on an ask ticket through the `ask` skill. Never leave it only in a comment, a TODO line or a chat message, where nobody is waiting on it. (Ryan, 2026-09-27.)
- Never recommend a route that bypasses a release or provenance path (for example a hand publish with a personal token) as the default answer. Name it as an option with its cost.
- In `propose` mode, write nothing at all: no temp files in a checkout (run a formatter on a copy under a scratch directory), no mutating API call. A query endpoint that only reads (a `SELECT` through a POST) is allowed; say in the record that you used it.

## `mechanical`

Pick the smallest action that gets the subject moving:

1. The owning seat is alive: send it the exact steps (what fails, where, the fix) and the evidence, and let it do the work.
2. No owner, or the owner is gone: do the fix yourself in a fresh worktree off the PR's branch, through the normal gates (tests for what you touched, the repository's check command, review at head), then push through the repository's push path.
3. A duplicate: comment with the evidence, then mark it a duplicate of the canonical ask. Check first that the duplicate carries no `blocks` edges, because marking a duplicate moves them.
4. A moot ask: comment with the evidence (the merged PR, the canceled subject) and close it through the `ask` skill's closing form.
5. A validate hold: pull the relay lever first (continue, accept or retry), then close the ask. Closing the ask alone does not clear the hold.

Then answer or close the ask with a `[bookkeeping]` comment that names what was wrong, what was done, and the evidence links. If the ask stays open until the fix lands, say what will close it.

## `decidable`

This release proposes only. Post one comment:

```
[bookkeeping] unsticker proposal: <option>. Why: <one or two sentences with evidence>. Source: <default | ADR-… | plan | evidence>. Nothing was changed; the human can overrule or accept.
```

When a decidable answer is later applied (after a human accepts it, or once the eval grants the class autonomy): an agent or app-actor comment does not fire the automatic decision path, which listens only to the assignee. Post the answer as the app actor, move the ask to Done so its `blocks` edge goes terminal, and post the decision on the subject too, because the resumed phase learns the answer only from comments.

## `human`

Post one short recommendation and nothing else:

```
[bookkeeping] unsticker recommendation: <option>, because <evidence>. This needs a human because <the limit it hits>. No action taken.
```

Post nothing when the newest comment already says the same thing; a second copy is noise.

## Posting

Post as the app actor through the `ask` skill's reply form, never through a personal credential's `issues discuss`, which reads as the human deciding.
