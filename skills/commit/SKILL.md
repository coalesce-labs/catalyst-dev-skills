---
name: commit
description:
  "Create git commits with conventional commit messages for this session's changes, detecting the
  type, scope and ticket reference from the diff and branch name. Use when the user wants to save or
  commit their work, e.g. 'commit this', 'save my changes', 'let's commit'."
disable-model-invocation: false
allowed-tools: Bash, Read
version: 2.0.0
---

# Commit changes

Commit this session's changes in conventional commit format. Group related changes, and keep each commit focused.

## Process

1. **See what changed.** Recall what the session accomplished, then run `git status`, `git diff --cached`, `git diff`, `git diff --name-only` and `git diff --cached --name-only`.

2. **Detect the parts.** If `.catalyst/config.json` sets `catalyst.commit` or `catalyst.project.ticketPrefix`, read [`references/config.md`](references/config.md) first.
   - **Type.** Only `*.md` in `docs/` gives `docs`; only test files (`*test*`, `*spec*`) give `test`; `package.json` or `*.lock` gives `build`; `.github/workflows/` gives `ci`; a mix gives `feat` or `fix` from context. Otherwise ask the user to pick one of `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `perf`, `test`, `build`, `ci`.
   - **Scope.** `agents/*.md` gives `agents`, `commands/*.md` `commands`, `scripts/*` `scripts`, `docs/*.md` `docs`, `.claude/` `claude`. Several directories or root files give an empty scope.
   - **Ticket.** Match `{PREFIX}-{NUMBER}` (e.g. `ENG-123`) in `git branch --show-current`.

3. **Write the message.**

   ```
   <type>(<scope>): <short summary>

   <body - optional but recommended>

   <footer - ticket reference>
   ```

   - The header stays under 100 characters, with a lowercase type and an imperative, lowercase summary with no period ("add feature", not "added feature").
   - The body explains why, not what; a simple change may skip it.
   - The footer is `Refs: TICKET-123` when the branch names a ticket.

   ```
   feat(commands): add conventional commit support to /commit

   Updates the commit command to automatically detect commit type
   and scope from changed files, following conventional commits spec.
   Extracts ticket references from branch names for traceability.

   Refs: ENG-123
   ```

4. **Present the plan.** Show the detected type and scope with your confidence, the message, and the files to commit: "Detected changes suggest: `<type>(<scope>): <summary>`". Ask "Proceed with this commit? [Y/n/e(dit)]": Y commits as-is, n aborts, e lets the user edit the message. The user may override any suggestion.

5. **Commit.** Stage named files with `git add <specific-files>` (NEVER `-A` or `.`), commit, then show `git log --oneline -n 1` and `git show --stat HEAD`.

## Types

`feat` (new feature), `fix` (bug fix), `perf` (performance) and `revert` appear in the changelog. `docs` (documentation only), `style` (formatting), `refactor` (no behaviour change), `test`, `build` (build system or dependencies), `ci` and `chore` (maintenance) are internal.

## Authorship

Write the message as if the user wrote it, and author the commit as the user alone: add no co-author line, no Claude attribution and no "Generated with Claude" text.
