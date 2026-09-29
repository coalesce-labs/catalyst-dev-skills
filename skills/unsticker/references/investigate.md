# Investigating an ask

Investigate the subject, not the ask's wording. The ask was written by a generator or an agent at one moment. The subject has usually moved since, and the ask's own recommended option can be wrong.

## Tools and budgets

- Linear: the local replica by SQL through the `linearis` skill's reading rule. Tables that matter: `issues` (state name in `state`, full JSON in `raw`), `comments`, `relations` (lags up to 5 minutes; re-read one live if a decision depends on it), `issue_labels`/`labels`. Always filter `removed_at IS NULL`.
- GitHub: `gh pr view <n> --json state,isDraft,mergeable,mergeStateStatus,headRefOid,labels,statusCheckRollup,comments,reviews`, and the review threads through `gh api graphql` (`reviewThreads { isResolved isOutdated path line comments { body author } }`). The GitHub quota is shared; make single reads, never a polling loop.
- Catalyst mirror (when an admin bearer is available): `GET /admin/relay-ledger?account=<tenant>&ticket=<id>` for phase, park, hold and head agreement; `GET /admin/board-health?account=<tenant>` for alive or stuck; `GET /admin/work-eligibility?account=<tenant>&team=<key>` only for why a ticket is excluded. A validate report is the `validation.md` artifact for the attempt the ledger names; its closing JSON block holds the verdicts.
- Code: read the files the finding names, at the PR head, before trusting a summary of them.

## By shape

### Unblock asks ("Unblock ENG-123 — holding N tickets", label `ask/unblock`)

Filed when a human-owned ticket sits in a stage the relay cannot enter from (usually PR) while it blocks others. The generator recommends "resubmit to Todo", which throws away finished work whenever a PR exists.

1. Find the subject's PRs by ticket id in title and branch (`gh pr list --search "ENG-123" --state all`).
2. For each open PR: conflicts (merge main to see them), failing checks and whether each is real, a flake, or already fixed on main (compare against main's latest run of the same check), review state at head (an automated review requested but not answered at the current head is a common stall), unresolved threads, `hold` labels and who placed them (a hold may be a deliberate merge window owned by another seat).
3. Who is working it: the newest PR and ticket comments, seat names in them, and whether that seat is alive.
4. Whether the tickets it holds are really blocked (stacked branches mean the edge is real).

### Validate-hold asks ("ENG-123: validate keeps failing — re-plan, accept, or fix by hand?")

1. Read the validate report for the held attempt. Name each failing finding with file and line.
2. Decide per finding: real and new in the branch's own diff, main drift (the branch is far behind and the finding is in main's files), a flake, or grader noise.
3. Compare the hold's head sha with the PR's head, and read the ledger's `branchHeadEvidence.agreement`. `disagrees` means the mirror missed a push: the hold, the waiver and the next validate are judging stale code. Say so in the record for every shape, not only validate holds.
4. Is the run converging? Count findings per round across earlier attempts.
5. Check how far behind main the branch is. Re-planning an old-base branch re-pins it to a main it lacks.

Usual answers: continue when the findings are real and small. Prefer `POST /admin/validate-unhold`: it queues one repair round at the same head carrying the held finding. If it refuses (`remediate_parked_or_capped`, `no_branch_to_remediate`), rewind to implement instead, which keeps the plan but carries no finding. Accept with a follow-up ticket when the finding is out of scope. Retry unchanged at validate when the cause was outside the branch. Re-plan only when the plan itself is wrong. Check whether an earlier "continue" was applied as a rewind to validate: that grants no repair round, so its findings come back later looking new.

### Decision asks raised by a remediate round ("--- raised by --- ENG-123/remediate round N")

1. Is the subject still open, and does its PR still need this answer? A later round, a merge, or a cancel can make it moot.
2. Search `docs/adr/`, the subject's plan, and newer comments for a recorded decision that already settles it. A code and docs contradiction is often an unfinished rollout, not an open question.
3. Check the default. A default of "nothing ships" costs something every hour; a default that ships the safe half does not.

### Release, credential and configuration asks

Establish the facts the human needs (what exactly would be published, deleted or changed; is the premise still true, for example has a later successful run proved the configuration the ask asks about). Do not act.

### Every shape

- Duplicates: another open ask with the same title or subject.
- Moot: subject Done or Canceled, or the answer already sits in a comment (look for `DECIDED:` and for answers relayed from chat).
- Auto-closed: an ask moved to Done by a merged PR whose title named it, with no decision. Reopen only if the question is still live.
- No deadline: an ask without an `Auto-executes:` line never fires its default, so "default if silent" means it waits forever. The exception is a validate-hold ask, whose default (re-plan) fires after 48 hours of silence. Say which applies.
- Options: check each listed option against the acceptance scenarios pinned on the subject and its siblings. When every listed option breaks one, the right answer can be an option the ask did not list.
