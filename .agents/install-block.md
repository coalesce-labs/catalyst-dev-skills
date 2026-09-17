# The canonical install block

This file is the one copy of the install wording. The README carries the same commands, and any web page or doc that shows a catalyst-dev skills install command copies it from here rather than writing its own. If you change a command, change it here first.

**The two rails are exclusive.** `npx skills` copies the skills into each coding agent's own skills directory. The Claude Code plugin installs the same set as a managed bundle. A reader who runs both ends up with every skill twice, so every rendering of this block keeps the exclusivity sentence.

---

## Install

One command, for every coding agent on the machine:

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills --all -g
```

It installs all 34 skills for each agent it detects (Claude Code, Codex, OpenCode, Cursor and the rest). These skills are yours, not a repository's: `-g` installs into your home directory, and a project-scoped install is not a supported shape (CTC-2558). If you already have one — a `.claude/skills/`, `.agents/skills/`, `agent/skills/` or `skills-lock.json` inside a project — remove it with `npx skills remove --all` from that directory, then install again with `-g`. Skills installed this way do not auto-update; refresh them with:

```sh
npx skills@latest update -g -y
```

**Alternative for Claude Code: the plugin marketplace.** The plugin installs the set as a managed bundle, under the `catalyst-dev:` prefix. Pick one rail; installing both leaves you with every skill twice.

```
/plugin marketplace add coalesce-labs/catalyst-dev-skills
/plugin install catalyst-dev@catalyst-dev-skills
```
