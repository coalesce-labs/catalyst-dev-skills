# Setup and layout

## Project setup

If `catalyst.worktree.setup` is defined in config, those commands run in order. Otherwise the script auto-detects: dependency install (`bun`/`npm`) plus thoughts init.

**Which bun installs.** When `package.json` declares `"packageManager": "bun@X.Y.Z"` and the first `bun` on PATH reports an older version, the install runs with a `bun` further along PATH that reports X.Y.Z, else the first one that reports a newer version, and the script prints both. A lifecycle script that calls `bun` during that install gets the same one. When no `bun` on PATH reports X.Y.Z or newer, the script tries the first one. If that install fails, it names the command, both versions and the path, removes the worktree and any branch it created, and exits 1. Commands in `catalyst.worktree.setup` run as written, with the first `bun` on PATH.

**Where thoughts go.** The script looks for a declared thoughts repo: `CATALYST_THOUGHTS_REPO`, then `paths.thoughtsRepo` in `~/.config/catalyst/paths.json`, then `<repoRoot>/<owner>/thoughts` when that is a checkout. When it finds one, thoughts init points there even without the HumanLayer CLI, and `${PROFILE}` is the HumanLayer profile whose repo it is. If no profile points there, `catalyst-<owner>` is added. With nothing declared, the HumanLayer config decides. `${DIRECTORY}` is `catalyst.thoughts.directory`, else the origin's repo name.

Example config for full control:

```json
{
  "catalyst": {
    "worktree": {
      "setup": [
        "humanlayer thoughts init --directory ${DIRECTORY} --profile ${PROFILE}",
        "humanlayer thoughts sync",
        "bun install"
      ]
    }
  }
}
```

## Where worktrees go

The base directory resolves in this order:

1. `--worktree-dir <path>` (explicit override).
2. `catalyst.orchestration.worktreeDir` from config.
3. `<worktrees root>/<owner>/<repo>/`, where the root is `CATALYST_WORKTREES_DIR`, else `paths.worktrees` in `~/.config/catalyst/paths.json`, else `~/catalyst/wt`. The owner comes from the origin URL, so two clones that share a repo name (`acme/app`, `other-org/app`) never share a folder, and the layout matches repos at `<repoRoot>/<owner>/<repo>`. Without a parseable origin, the key is `catalyst.projectKey`, else the repo name.

A worktree that already exists under an old key (`<root>/<projectKey>/` or `<root>/<repo>/`) and belongs to this repository is used where it is, so a revive never starts a second tree. A relative or unreadable root refuses (exit 2) before anything is created.

Add the worktrees root (`~/catalyst` by default) to Claude Code's `additionalDirectories` in `~/.claude/settings.json` so every worktree is trusted.

Example layout (origin `git@github.com:acme/app.git`), with orchestration:

```
~/catalyst/wt/acme/app/
├── ACME-123-feature/
├── ENG-789-oauth/
├── auth-orch/                       # orchestrator
├── auth-orch-ACME-101/              # worker
└── auth-orch-ACME-102/              # worker
```
