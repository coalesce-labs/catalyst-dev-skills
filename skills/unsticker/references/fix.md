# Fixing and pushing a stuck ticket

Use this when the run may change the ticket's branch: it holds the ticket's lease, a writable checkout of the branch and origin/main, and a push credential bound to that lease. A triage container (`CATALYST_PHASE=triage`) has none of these today, so it follows [`container.md`](container.md) and records the steps in `next_steps` instead. When any of the three is missing, stop at the record.

The fix is the steps [`repair-cap.md`](repair-cap.md) picked, nothing more. The push grants the ticket its next round, so a small, checked head is worth more than a broad one.

## Steps

1. **Hold the lease.** Confirm the ticket's lease is yours for the whole run and renew it before the push. A lease another worker holds means the ticket is theirs; record the steps for them and stop.
2. **Start clean.** Work in a fresh worktree on the ticket's branch at the PR head the record names. A different head means someone pushed since: re-read the evidence first.
3. **Merge main.** `git fetch origin main` and merge it. Resolve each conflict by what each side meant:
   - both sides append to the same list or table: keep both entries;
   - main deleted or renamed what the branch edits: take main's side, then follow the removal in the branch's own code and tests;
   - anything else: read both changes and keep both behaviours; when they truly contradict, stop and record the conflict as the step a person or the ticket's writer takes.
4. **Apply only the fixes the evidence names.** An unused export the lint names, a test still calling a symbol main deleted, a leftover conflict marker. A saved WIP ref whose change is already in the head is deleted with `git push origin --delete <ref>` once you have confirmed that. Larger work the plan still owes is a writer's job: record it as `fix-on-branch` and stop.
5. **Run the repository's check** on the new head, the same command implement and remediate run. Red means no push: record the failing check and its first error, and stop.
6. **Push a fast-forward** to the ticket's branch with the repository's normal push path, under the lease. Never force a branch someone else pushed to since step 2.
7. **Record what you did.** Write the record with `action_taken` listing the commits and the check result, and a root-cause note: the round table, the causes, and the option taken (A, B, C, or the `DECIDED:` text). Then release the hold the evidence no longer supports, through its own lever.

A person hears about it only for a step no agent can take: a credential, an approval on the always-escalate list, a contradiction in step 3. That goes on one ask naming that exact step, never a choice between re-plan, fix and accept.
