**Why:** Starting the watchdog's 72-hour shadow run is the next step toward retiring the GitHub Actions cron that spends hosted minutes on it.

The watchdog now runs inside the mirror Worker (PR #7737, merged 2026-09-28) and ships switched off. In shadow it watches the merge queue beside the GitHub Actions workflow and changes nothing.

There is nothing for you to set up. We checked on 2026-09-28:

- The GitHub App "Catalyst Cloud Connector" already has the repository permission "Commit statuses: Read-only", and the coalesce-labs installation has accepted it. You can see it on the installation page: https://github.com/organizations/coalesce-labs/settings/installations/141366898. An earlier version of this ask told you to add it; that step is already done.
- We create the Flagship flag `watchdog-merge-queue-watchdog` and set it to `shadow` when you say yes. Agents hold the Flagship token, so this is not your step.

What each answer does:

- Yes: we create the flag at `shadow` today. The shadow run needs 10 paired checks over 72 hours with 0 mismatches. Switching to `enforce`, which retires the GitHub Actions workflow, is a separate decision after that.
- Not now: the watchdog stays off and the GitHub Actions workflow stays the only watchdog.

We recommend yes. Shadow mode only observes, and setting the flag back to `off` undoes it.

**Options:**
- **A** — Yes: start the 72-hour shadow run now
- **B** — Not now: keep the GitHub Actions workflow as the only watchdog

**Default if silent:** Nothing changes. The watchdog stays off and the switch-on work waits.

**How to answer:** reply in this thread with the option letter on its own (`A`), `(A)`, `option A`, or the option's own text pasted back. For an answer that is not on the list, reply `DECIDED: <your answer>`.

Blocks: CTC-3919
