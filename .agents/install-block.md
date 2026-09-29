# The canonical install block

This file is the one copy of the install wording. The README carries the same commands, and any web page or doc that shows a catalyst-dev skills install command copies it from here rather than writing its own. If you change a command, change it here first.

**One rail.** `npx skills` copies the skills into each coding agent's own skills directory. There is no plugin marketplace rail: installing the same set a second way leaves every skill installed twice, so every rendering of this block carries the one command below.

**The source is this repository.** The `catalyst-dev@catalyst` plugin in `coalesce-labs/catalyst` is retired, and the installer removes it. Development-skills installs use `coalesce-labs/catalyst-dev-skills`. Operating a cloud account uses the separate `coalesce-labs/catalyst-cloud-skills` pack.

---

## Install

One command, for every coding agent on the machine:

On an existing machine, check same-named skill paths before running it. The command replaces them;
the inspection rule is below.

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills --all -g
```

It installs all 34 skills for each agent it detects (Claude Code, Codex, OpenCode, Cursor and the rest). These skills are yours, not a repository's: `-g` installs into your home directory, and a project-scoped install is not a supported shape. If a project has an older skill install, inspect its lock file and each agent's skill path before removing anything. Remove only copies proven to come from the deprecated `coalesce-labs/catalyst` repository or project-scoped copies of this pack that you intend to replace. Keep unrelated and uncertain copies.

The add command replaces existing same-named skill directories and links. Before either first install or refresh on an existing machine, read `$XDG_STATE_HOME/skills/.skill-lock.json` when `XDG_STATE_HOME` is set, or `~/.agents/.skill-lock.json` otherwise. Check every same-named agent path. Proceed only when each destination is absent or a verified, unmodified copy of this pack or its link. A lock entry alone does not prove every path is safe. Leave independent, changed, or uncertain copies in place and resolve the conflict before running the command. Do not schedule the raw command as an unattended refresh. Once destinations are verified, refresh the pack, including newly added skills, with:

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills --all -g
```

**Operator skills.** `concierge` and `linearis-cli` are for the pack's operators: they coordinate the operator's own board across sessions and use a personal Linearis credential, so they are marked internal and a default install leaves them out. The installer shows and installs internal skills only when `INSTALL_INTERNAL_SKILLS=1` is set, so an operator installs them by name with it: `INSTALL_INTERNAL_SKILLS=1 npx skills@latest add coalesce-labs/catalyst-dev-skills --skill concierge --skill linearis-cli -g`. `npx skills update -g` keeps an installed copy current. Ticket work on your cloud account (reading, commenting, moving, labelling and creating tickets) belongs to [`coalesce-labs/catalyst-cloud-skills`](https://github.com/coalesce-labs/catalyst-cloud-skills), whose writes go through the cloud route as the Catalyst app actor. A machine that installed an earlier default roster keeps both. On a machine that is not an operator's, remove them with `npx skills@latest remove concierge linearis-cli -g`, after checking each path by the same rule as a refresh: only a verified copy of this pack goes.
