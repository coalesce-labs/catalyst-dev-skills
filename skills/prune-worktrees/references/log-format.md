# Log format

Every run — whether it removes anything or not — writes one JSONL file at
`${CATALYST_LOGS_DIR}/prune-worktrees/<UTC-ISO8601-basic-timestamp>-<mode>.jsonl`, one JSON object per
line, ending with a summary record. `mode` is `dry-run`, `dry-run-first-run` or `apply`.

The name is claimed with `noclobber`, and a run that finds it taken takes the next `.2`, `.3`, …
suffix instead. Two runs in the same second and mode — a manual run racing the timer, or the
documented `--dry-run` then `--apply` pair — therefore keep **both** audit records; no run ever
truncates another's log.

## Per-candidate record

```json
{"ts":"2026-09-18T21:00:00Z","host":"buildbox-01","actor":"ci@buildbox-01","repo":"catalyst-cloud","path":"${CATALYST_WORKTREES_DIR}/catalyst-cloud/CTC-A","branch":"CTC-A","verdict":"REMOVE","reason":"merged:content-in-origin/main+nothing-unpushed","head":"68a63469505e5daf0915513a845fb4a0a3138913"}
```

- `verdict` is `REMOVE` or `KEEP`. Nothing else.
- `reason` is one of the strings in `fail-closed.md`'s table.
- `head` is the worktree's HEAD commit sha at classification time — a `REMOVE` record's `head` is
  therefore the sha an operator can recover the work from (`git show <head>`), even though nothing
  was ever lost (the branch, tip and commit object all survive removal — only the checkout goes).
- `branch` is `null` for a detached or prunable candidate.

## Administrative records

- `{"kind":"administrative-prune","ts":...,"repo":...,"primary":...}` — `git worktree prune` ran for
  a primary checkout that had a prunable stub. This is bookkeeping cleanup of git's own metadata, not
  a removal of anyone's work, and is never counted in the summary's `removed`.
- A record noting an ignored classifier-hook upgrade (`fail-closed.md`'s `hook-upgrade-ignored`).

## Summary record (always the last line)

```json
{"kind":"summary","ts":"2026-09-18T21:00:03Z","mode":"apply","scanned":11,"removed":2,"wouldRemove":0,"kept":9,"host":"buildbox-01"}
```

`removed` counts trees this run **actually deleted** — it is always `0` in `dry-run` and
`dry-run-first-run`, i.e. for every first run on every machine. What a dry run would have removed is
`wouldRemove`; in `apply` mode that field is `0`. A record's `verdict` is the classification either
way, so a `REMOVE` record in a dry-run log means "would have been removed".

Written even when `removed` is 0 and even when the farm was empty — a scheduled run that changed
nothing still has to prove it ran.

## Reading a run

```sh
LOG=$(ls -t "${CATALYST_LOGS_DIR}/prune-worktrees"/*.jsonl | head -1)
jq -c 'select(.verdict=="KEEP")' "$LOG"                     # every tree kept, and why
jq -c 'select(.verdict=="REMOVE")' "$LOG"                    # every tree removed, or (dry run) that would be
jq -e 'select(.kind=="summary") | .mode=="apply"' "$LOG"     # ...was this an applying run at all?
jq -c 'select(.kind=="summary")' "$LOG"                      # the one-line outcome
jq -r 'select(.reason) | .reason' "$LOG" | sort | uniq -c     # a reason histogram across the farm
```
