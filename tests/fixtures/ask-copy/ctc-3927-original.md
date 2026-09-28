**Why:** The merge-queue watchdog (CTC-2798) now runs inside the mirror Worker. It was merged-ready in PR #7737: 0 open threads, and the watchdog and mirror suites are green. It ships off, and it can't start without two things only you can do:

1. **Add** `statuses: read` **to the Catalyst GitHub App's permissions.** The job's preflight refuses to run without it, in every mode, shadow included. `bun run github:app-permissions` should then list all four scopes: `pull_requests: write`, `contents: read`, `checks: read`, `statuses: read`.
2. **Create the Flagship flag** `watchdog-merge-queue-watchdog` with the default `off`, then set it to `shadow`. Rollout flags live in Flagship, never in wrangler.toml. The flag-debt sweep will list it as UNCONFIGURED until it exists.

After that, CTC-3919 (the switch-on ticket, due 2026-10-01) runs the shadow period: 10 paired observations over 72 h with 0 mismatches and 0 permission or read failures. Then a later PR flips the flag to `enforce` and deletes the GitHub Actions workflow, which stays the only writer until then. Rollback is setting the flag back to `off`.

Why it matters: the Worker-hosted watchdog replaces a GitHub Actions cron that spends hosted minutes, and nudges the queue from the App installation.

**Options:**

* **A** — Yes: I add statuses:read to the App and create watchdog-merge-queue-watchdog at shadow
* **B** — Only the App permission now; the flag later
* **C** — Not now: keep the GitHub Actions workflow as the only watchdog

**Default if silent:** Nothing changes. The GitHub Actions workflow stays the only watchdog, and CTC-3919 waits.

**How to answer:** reply in this thread with the option letter on its own (`A`), `(A)`, `option A`, or the option's own text pasted back. For an answer that is not on the list, reply `DECIDED: <your answer>`.

Blocks: CTC-3919
