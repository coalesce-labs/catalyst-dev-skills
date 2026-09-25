# The canonical install block

This file is the one copy of the install wording. The README carries the same commands, and any web page or doc that shows a catalyst-dev skills install command copies it from here rather than writing its own. If you change a command, change it here first.

**The two rails are exclusive.** `npx skills` copies the skills into each coding agent's own skills directory. The Claude Code plugin installs the same set as a managed bundle. A reader who runs both ends up with every skill twice, so every rendering of this block keeps the exclusivity sentence.

**The source is this repository.** The `catalyst-dev@catalyst` plugin in `coalesce-labs/catalyst` is a separate, deprecated copy. New development-skills installs use `coalesce-labs/catalyst-dev-skills`. Tenant operation uses the separate `coalesce-labs/catalyst-cloud-skills` pack.

---

## Install

One command, for every coding agent on the machine:

On an existing machine, check same-named skill paths before running it. The command replaces them;
the inspection rule is below.

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills --all -g
```

It installs all 35 skills for each agent it detects (Claude Code, Codex, OpenCode, Cursor and the rest). These skills are yours, not a repository's: `-g` installs into your home directory, and a project-scoped install is not a supported shape (CTC-2558). If a project has an older skill install, inspect its lock file and each agent's skill path before removing anything. Remove only copies proven to come from the deprecated `coalesce-labs/catalyst` repository or project-scoped copies of this pack that you intend to replace. Keep unrelated and uncertain copies.

The add command replaces existing same-named skill directories and links. Before either first install or refresh on an existing machine, read `$XDG_STATE_HOME/skills/.skill-lock.json` when `XDG_STATE_HOME` is set, or `~/.agents/.skill-lock.json` otherwise. Check every same-named agent path. Proceed only when each destination is absent or a verified, unmodified copy of this pack or its link. A lock entry alone does not prove every path is safe. Leave independent, changed, or uncertain copies in place and resolve the conflict before running the command. Do not schedule the raw command as an unattended refresh. Once destinations are verified, refresh the pack, including newly added skills, with:

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills --all -g
```

**Alternative for Claude Code: the plugin marketplace.** The plugin installs the set as a managed bundle, under the `catalyst-dev:` prefix. Pick one rail; installing both leaves you with every skill twice.

```
/plugin marketplace add coalesce-labs/catalyst-dev-skills
/plugin install catalyst-dev@catalyst-dev-skills
```
