# Trigger — the post-merge deploy-verification signal

What causes `compound-estimate`, `ticket-compound`, and `ticket-retro` to run after a ticket ships.

## One call site

All three share a single call site: the `merge-pr` skill's compound closing ritual (its `references/post-merge.md`, "Compound closing ritual"), which fires only after merge-pr's post-merge deploy verification (`verify_post_merge_deploy`, the `merge-pr` skill's `references/post-merge-deploy-verify.md`) resolves a **terminal** sentinel for the merge:

- `DEPLOYED`, `NOT_APPLICABLE`, `NO_DEPLOY_CONFIG`, `DEPLOY_FAILED`, `SMOKE_FAILED` — all terminal; run the closing ritual regardless of which one it is (a failed deploy is itself a learning — `ticket-compound`'s "what didn't work" is exactly this signal).
- `DEPLOY_PENDING` — the bounded-poll ceiling was hit with no answer yet; **do not** run the ritual on this one. Re-check later (a coordinator re-dispatching the check), the same way bounded-poll itself treats `PENDING` as "not done," never a silent skip.

The ritual invokes, in order, the `compound-estimate`, `ticket-compound` and `ticket-retro` skills. `ticket-compound` runs before `ticket-retro` on purpose — `ticket-retro` reads the learnings store `ticket-compound` writes, so running retro first would mean the retro that fired off this exact merge could not see the learning that merge just produced. None of the three is invoked through an event-log subscription or a background dispatcher.

`ticket-compound` sets `disable-model-invocation: false` so a merge-driving model executing the ritual as a documented step can invoke it, the same as `compound-estimate`. It stays `user-invocable: true` — a human can still run it directly.

## The stores each one writes

`compound-estimate` writes `thoughts/shared/retros/estimate/`, `ticket-retro` writes `thoughts/shared/retros/ticket/<date>.md`, `ticket-compound` writes `thoughts/shared/learnings/`. See each skill's own reference docs for those contracts.
