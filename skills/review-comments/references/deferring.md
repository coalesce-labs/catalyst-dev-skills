# Deferring a low-priority finding

Deferral applies only to addressable findings authored by an automated reviewer, and only after the disagreement check has ruled out a judgment call. A human reviewer's comment is never deferred: surface it for the person to act on.

- **Round 1:** P0/P1 is always fixed. For P2/P3, fix it now if it is real, cheap and clearly correct; otherwise defer.
- **Round 2+:** P0/P1 is always fixed. P2/P3 is always deferred, even a trivial one-liner.

To defer a finding:

1. File a follow-up ticket capturing it (file, line, what the reviewer flagged), in the same team as the PR's ticket, Backlog status.
2. Reply on the thread linking the follow-up ticket, then resolve the thread (Step 5).

**When filing fails** (Linearis unavailable, no usable Linear credentials), fix the finding inline on the normal Step 3 path instead, so an optional dependency never blocks the PR.

**Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.

Deferral is policy, not a judgment call: it applies identically in interactive and headless mode, never goes through the `[y/N]` prompt, and resolves the thread through its reply.
