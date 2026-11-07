---
name: describe-pr
description: "Write or update a pull request's title and description from its diff, plan and checks, keeping a person's manual edits, and save it to thoughts/shared/prs/. Use when asked to describe the PR, update the PR description, or after new commits land on a PR."
allowed-tools: Bash, Read, Write
metadata:
  version: "3.0.0"
---

# Describe PR

The description tells a reviewer what changed, why, and how it was verified. Write it from evidence: the diff, the plan, and the check results the implement stage reported. Do not rerun the checks here. Name a check as passed only when you saw it pass in its own output. When a coordinator's stage script records the check, it adds that section itself, so say nothing about the full check.

**Unattended.** When `CATALYST_PHASE` is set, or a coordinator started you, never ask and wait.

**Paths.** `${CLAUDE_SKILL_DIR}` is this skill's directory. On a harness that does not fill it in, set it to the directory holding this file.

## Steps

1. **Gather.** Read `thoughts/shared/pr_description.md` (the template) if it exists. Find the PR: the number you were given, else the current branch's (`gh pr view`). With no pull request, stop and report `no_pr_found`. Take the ticket from the branch name or PR title. Read the diff against the base, the commits, the plan and its acceptance criteria, and the existing description if there is one.
2. **Write.** Fill the template's sections from the evidence. On an update, regenerate the summary, changes and verification sections, and keep what a person wrote in the others. Name the ticket with a `Fixes <ticket URL>` line, using the URL from the ticket read in step 3, or `Fixes <TICKET>` when that read fails. Refer to any related work by its GitHub PR number only ([references/linear-sibling-guard.md](references/linear-sibling-guard.md) explains why).
3. **Title.** `<TICKET>: <ticket title>`, up to about 70 characters. Read the ticket title with `catalyst_ticket_json <TICKET>` from `${CLAUDE_SKILL_DIR}/scripts/lib/catalyst-cloud-read.sh`; when that fails, title from the branch name.
4. **Save and sync.** If `thoughts/shared/` does not exist, skip this step and say so in the report, so no untracked folder lands in the repository. Otherwise write the PR's file in `thoughts/shared/prs/`, using the lookup at the top of [references/write-back.md](references/write-back.md) (it rewrites the PR's existing file on an update), then `humanlayer thoughts sync`. If the sync fails, the file is still saved: say so in the report.
5. **Write back,** as [references/write-back.md](references/write-back.md) shows:
   - Under a runner (`CATALYST_PHASE` set) or a coordinator: write `$CATALYST_ARTIFACT_DIR/pr.md`, first line the title, a blank line, then the body. The runner or coordinator opens or updates the PR from it.
   - Otherwise: update the PR's title and body on GitHub.
6. **Report** whether this was a first description or an update, and end with the saved file's path on its own last line when you saved one.

The description is the author's own: no AI attribution line. Leave the ticket's state alone.
