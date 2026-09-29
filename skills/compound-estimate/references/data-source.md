# Data source — where each field comes from

## `estimate_at_start` — the replica, gated

The helper reads the ticket's starting estimate via `linear_read_ticket`, the same replica-backed, freshness-gated helper `linearis`/`steward` use (the `steward` skill's cloud-detection reference) — never a bare `linearis issues read`. The team's estimation config (T-shirt, Fibonacci, linear) is applied client-side when re-scoring in the process's step 3.

## `cost_usd` — local aggregates, in this order

1. **`--cost-usd <float>`** — an explicit override always wins.
2. **A per-run cost aggregate keyed to an active orchestrator run** — this fires only when a
   session sets the orchestrator-run environment variable. Under per-ticket worker sessions nothing sets it, so in practice this source is **inert**: the helper still probes it first and falls through.
3. **Local session-history aggregate** (`catalyst-session.sh history --ticket <TICKET> --limit
   1`) — the source that actually resolves `cost_usd`, since (2) does not fire.

If none resolve, the helper fails loud and asks for `--cost-usd` explicitly — pass it rather than guess.

## The Prometheus overlay — gated, not yet wired

`CATALYST_PROMETHEUS_URL`, when set, makes the helper log a note to stderr; the HTTP client itself is not wired yet (the intended eventual primary source, once `claude-code-otel` + Prometheus are available). Until then, (3) above is the real default.
