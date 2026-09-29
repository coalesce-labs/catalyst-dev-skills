# Reading Linear — full detail

Deep detail behind `SKILL.md` → "Reading Linear", for the off-cloud operator path: the raw helper's freshness-gate internals, raw SQL syntax and schema discovery. On a cloud account, `catalyst query …` covers ticket reads, lists, search, projects and cycles, and `catalyst replica sql "<select>"` runs ad-hoc SQL with the gate built in.

## Why direct SQL, not bare `linearis`

Bare `linearis` reads always hit the rate-limited Linear API. Where several machines share one workspace's API quota, that burns budget and 429s everyone. The replica (`~/.config/catalyst-cloud/replica.db`, a SQLite mirror kept current by the change-feed writer that `catalyst replica start` runs, if your cloud account runs a local replica) is a sub-ms local copy that already has the answer — reading it is what makes "every client reads the replica" actually true. It holds every issue field plus labels, relations, projects, cycles, users, and PR/review state.

## The freshness gate, copy-paste (portable macOS/Linux)

Prefer the shared helper (`linear_read_ticket`, `SKILL.md`) over re-implementing this — this is what it does internally, and no code outside this function (or the helper itself) should ever run a `sqlite3` query directly against the replica:

```bash
# Resolve the DB the way the helper does: $CATALYST_REPLICA_DB, else $CATALYST_DIR, else $HOME.
DB="${CATALYST_REPLICA_DB:-$HOME/.config/catalyst-cloud/replica.db}"
replica_fresh() {
  local lock="$DB.writer.lock" now age
  [[ -f "$lock" ]] || return 1
  # GNU `stat -c %Y` first, BSD `stat -f %m` fallback (on Linux `-f` is --file-system, not mtime).
  now=$(date +%s); age=$(( now - $(stat -c %Y "$lock" 2>/dev/null || stat -f %m "$lock") ))
  (( age < 300 )) || return 1                                    # writer heartbeat < 5 min
  [[ -n "$(sqlite3 "$DB" "SELECT 1 FROM sync_meta WHERE key='cursor' AND value<>'' LIMIT 1;")" ]]  # seed complete
}
```

If the loud fallback persists, treat it as a replica outage and report it; the Cloud pack's `catalyst-setup` skill checks whether the replica is running.

## Caveat — the gates prove writer-liveness + seed-completeness, NOT per-row apply success

A rare class of rows (~0.7%) can be *present but stale* because their change-feed apply silently failed (an `errno:1` apply-drift) — the writer heartbeats and the cursor advances past them, so the freshness gate reads green while that one row holds an old value. Direct SQL cannot make this loud on its own. So: if a specific field **contradicts something you just directly observed** (e.g. a state you just wrote), treat that one field as an anomaly — re-read it via `linearis`, use the live value, and surface it. This is not license to re-verify reads that don't contradict anything.

## Querying (discover the schema — don't guess columns)

Run `sqlite3 "$DB" .schema` (or `.schema issues`) to see the live columns — **only after `replica_fresh` has already passed**, the same gate `linear_read_ticket` runs internally. The columns that matter:

- `issues.state` is the **state NAME** directly (`Backlog`/`Implement`/`PR`/`Done`…) — no join.
- `issues` also has: `identifier`, `title`, `estimate`, `priority`/`priority_label`, `description`, `url`, `branch_name`, `parent_identifier`, `project_id`, `cycle_id`, `team_id`, `assignee_id`, the timestamp columns, and a **`raw`** column with the full Linear JSON.
- **Labels:** `issue_labels ⋈ labels` — `JOIN labels l ON l.id = il.label_id WHERE il.issue_id = i.id`.
- **Relations (blocks / blocked-by / …):** the `relations` table (`type, issue_identifier, related_identifier`). **Relations lag ≤ 5 min** (reconcile poll, no webhook) — everything else is real-time.
- **Any uncolumned field:** `json_extract(raw,'$.path')` (e.g. `json_extract(raw,'$.state.type')`).

```bash
sqlite3 -json "$DB" "
  SELECT i.identifier, i.title, i.state, i.estimate,
         (SELECT group_concat(l.name, ', ') FROM issue_labels il
            JOIN labels l ON l.id = il.label_id WHERE il.issue_id = i.id) AS labels
  FROM issues i WHERE i.identifier = 'ENG-123' AND i.removed_at IS NULL;"
```

> `AND removed_at IS NULL` is REQUIRED: a tombstoned (removed) issue must read as a MISS → fall back to live Linear, never as a stale hit.

## Gaps the replica does not mirror

A few fields are not mirrored: cross-team-unsynced parent/child, `relation.id`, `cycle.name`, `state.id` and `team.key` are unselected, and `children` is always `[]`. Read those live, and file the gap.
