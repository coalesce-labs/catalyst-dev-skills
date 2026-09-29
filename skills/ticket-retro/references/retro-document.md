# The retro document

Write it to `thoughts/shared/retros/ticket/<YYYY-MM-DD>.md` (today, UTC). Render every empty section as `_none_`.

```markdown
---
date: <YYYY-MM-DD>
type: retro
generated_by: ticket-retro
window_since: <window.since>
window_source: <window.source>
tickets_shipped: <N>
---

# Ticket Retro — <YYYY-MM-DD>

Window: <window.since> → today (<window.source>)

## What we did

- `ENG-x` title — #PR (+adds/−dels)
- …                                      (_none_ when empty)

## Aggregate stats

| Metric | Value |
|---|---|
| Tickets shipped | N |
| Diff churn (LOC) | +A / −D |
| Sessions / cost / hours (catalyst.db, sparse) | N / $C / H |

## Recurring friction patterns

- **<pattern name>** (N records: ENG-a·research, ENG-b·implement) — one-sentence synthesis.
- …                                      (_none_ when empty)

## What we learned

- [component] title — `path`             (_none_ when empty)

## Estimation calibration

entries: N · exact: N · mean signed delta: +X.X · median |delta|: X

| Ticket | start | actual | Δ |
|---|---|---|---|
…                                        (_none_ when empty)

## Watch items from last retro

- ✅ resolved / 🔁 recurred / 💤 quiet — <pattern> (evidence)
…                                        (_no prior retro_ on the first run)

## Watch items

```yaml watch-items
- pattern: "<short greppable description>"
  component: <orchestrator|phase-agent|broker|monitor|cli|ci|worktree|linear|runner|estimation|website|plugins>
  first_seen: <YYYY-MM-DD of when it first appeared — preserve across retros>
  source: <TICKET the clearest record came from>
```
```

## The watch-items block

The watch-items block is the only stateful contract. The next retro and the morning briefing both
machine-parse it: keep the exact fence info string `yaml watch-items`, the exact four keys, and
`pattern` values double-quoted. `component` uses the learnings-store enum
(`ticket-compound/reference.md`).
