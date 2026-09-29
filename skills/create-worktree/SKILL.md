---
name: create-worktree
description:
  "Create a git worktree for parallel work, and optionally launch an implementation session in it.
  Use when the user says 'create a worktree', 'work in parallel' or 'start a worktree for', or needs
  to work on several features at once without switching branches."
disable-model-invocation: false
allowed-tools: Bash, Read
version: 1.0.0
---

# Create worktree

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

Ticket ids look like `PROJ-123`: take the prefix from `.catalyst/config.json`, else write `TICKET-XXX`.

## Process

1. **Gather** the worktree name (e.g. `PROJ-123`, `feature-name`), the base branch (default: the current branch), and an optional implementation plan path.

2. **Confirm** the details with the user before creating anything.

3. **Create the worktree:**

   ```bash
   "${CLAUDE_SKILL_DIR}/scripts/create-worktree.sh" <worktree_name> [base_branch] [--no-from-remote] [--skip-fetch]
   ```

   The script copies `.claude/` and `.catalyst/`, then runs `catalyst.worktree.setup` from config, or falls back to a dependency install plus thoughts init. It chooses where the worktree and its thoughts go; to explain or change either, read [`references/setup-and-layout.md`](references/setup-and-layout.md).

   **Resume from remote (on by default).** When a new branch is created and `origin/<worktree_name>` exists (e.g. a pushed draft PR), the worktree starts from that remote tip, so a re-dispatch or cross-host reclaim builds on the pushed work. The script prints `🌱 Resuming from origin/<name>` when it does this. An existing local branch always wins over the remote, with no auto-merge.

   `--no-from-remote` forces a fresh branch off the base. `--skip-fetch` suppresses every origin fetch (offline), which also disables the resume. When a matching origin branch may carry stale or already-merged history, ask the user which they want before overriding the default.

4. **Optionally launch an implementation session.** If a plan path was given, ask whether to launch Claude in the worktree. `claude -w` takes a name and creates a new worktree, so `cd` into the one you created instead. Capture stderr to a file for post-mortem, and pass `--dangerously-skip-permissions` because there is no TTY:

   ```bash
   (
     cd "<worktree_path>" || exit 1
     exec nohup claude \
       --output-format stream-json --verbose \
       --dangerously-skip-permissions \
       -p "Use the implement-plan skill with <plan_path>, and when done: create commit, create PR, update Linear ticket"
   ) > "<worktree_path>/worker-stream.jsonl" 2> "<worktree_path>/worker-stderr.log" &
   ```

Invoke it as `/create-worktree PROJ-123` in Claude Code, or `$create-worktree PROJ-123` in Codex.
