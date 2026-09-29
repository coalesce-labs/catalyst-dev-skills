# catalyst-dev-skills

The Catalyst development workflow as agent skills: research → plan → implement → validate → ship, plus the Linear, pull-request and coordination skills around it. Each skill is a directory under [`skills/`](skills) with a `SKILL.md` and everything it runs, so the same files work in Claude Code, Codex and OpenCode.

This repository is the development pack, the supported source for development skills. The `catalyst-dev@catalyst` plugin in the `coalesce-labs/catalyst` repository is a separate, older copy and is deprecated; use this repository for new installs. To set up and operate your cloud account, also install the Cloud pack, [`coalesce-labs/catalyst-cloud-skills`](https://github.com/coalesce-labs/catalyst-cloud-skills).

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

<details><summary><strong>One agent at a time</strong></summary>

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills -a codex -g
npx skills@latest add coalesce-labs/catalyst-dev-skills -a opencode -g
npx skills@latest add coalesce-labs/catalyst-dev-skills -a claude-code -g
```

Without `--all` the installer asks which skills to take and which agents to install them on. `--skill <name>` takes one skill.
</details>

The installed folder takes the skill's frontmatter `name`, which is always its directory name.

The `npx skills` install reads this repository's `skills/` tree; it does not publish an npm package, so a Git commit identifies the exact skills installed. `package.json` records the development pack's release version, and CI checks that `.claude-plugin/plugin.json` has the same number. This version is independent of the Cloud pack's and of the deprecated `catalyst` plugin's.

## What's inside

**Research and planning**
- `research-codebase`: parallel codebase research, written up under `thoughts/shared/research/`.
- `create-plan`: a test-first implementation plan, and its revisions (`iterate-plan` is kept as an alias for revising).
- `gherkin-ticket`: shape a ticket as an outcome title with Given/When/Then acceptance criteria.

**Building and checking**
- `implement-plan`: carry out an approved plan, red-green-refactor.
- `validate-plan`, `remediate-plan`: check the implementation against the plan, then fix what the check found.
- `review-code`, `review-security`: review a branch's diff for real defects and exploitable vulnerabilities.
- `fix-typescript`, `scan-reward-hacking`, `validate-type-safety`: TypeScript errors fixed without shortcuts, and the gate that checks it.
- `agent-browser`: browser automation for checking a UI.
- `unslop`: the writing standard every message, comment, PR and doc goes through; it removes the patterns that mark text as AI-written (adapted from a third-party skill, see below).

**Shipping**
- `commit`, `create-pr`, `describe-pr`, `review-comments`, `merge-pr`, `triage-aging-prs`: commit through merge, including review feedback and an aging PR backlog.
- `create-worktree`: a git worktree for parallel work.
- `prune-worktrees`: reclaim disk from finished worktrees, fail-closed; the installer's housekeeping job runs it.

**Linear and coordination**
- `ask`: raise a decision for a human as a ticket and close it when answered.
- `unsticker`: investigate one open ask, move it when the stall is mechanical, and record the verdict with its reasoning. In a Catalyst Cloud `triage` container it only reads and writes its record. `ask-triage` is its old name, kept as an alias.
- `steward`, `project-orchestrator`: long-running owners of a project and of a project's ready backlog.
- `concierge`, `linearis-cli`: operator-only (see Install): the owner of a human's board, and the Linearis CLI reference with the read-from-replica rule.
- `create-handoff`, `resume-handoff`: hand work to another session and pick it up.
- `morning-briefing`, `briefing-followup`: a daily briefing and its walk-through.
- `compound-estimate`, `ticket-compound`, `ticket-retro`: the post-merge learning loop.

**In a Catalyst Cloud phase container** (`CATALYST_PHASE` set), every skill that uses `linearis` skips those calls, because the runner owns the ticket write-back there. They also skip when the `linearis` CLI is not installed.

## Third-party skills

- `skills/unslop` is adapted from [cursor/plugins](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md), by Lauren Tan, under the MIT License. Its licence is in [`skills/unslop/LICENSE`](skills/unslop/LICENSE); [`skills/unslop/NOTICE.md`](skills/unslop/NOTICE.md) gives the attribution and lists what changed.

- `vendor-src/references/resolving-review-findings.md` (vendored into `remediate-plan`, `review-comments` and `triage-aging-prs`) is adapted from [obra/superpowers](https://github.com/obra/superpowers/blob/main/skills/receiving-code-review/SKILL.md) (commit `3fb75974`), by Jesse Vincent, under the MIT License; the file's header carries the credit and what changed.

## For contributors

**Layout.**
- `skills/<name>/`: one skill. `SKILL.md` is the common path; `references/` holds detail read on demand; `scripts/` and `assets/` hold what the skill runs.
- `agents/`: the research subagents (`codebase-locator` and the rest); [`docs/agents.md`](docs/agents.md) describes them. It is the one source of the subagent prompts skills carry under `assets/agents/`. Every `agents/*.md` must be an agent file, because Claude Code loads each one as a subagent when it loads the repository root as a plugin.
- `vendor-src/`: the single source of every other file two or more skills share (`scripts/…`, `references/…`, `templates/…`).
- `.claude-plugin/`: the Claude Code plugin manifest (`catalyst-dev`), which lets Claude Code load the repository root as a plugin directory, plus a marketplace listing that is not an install rail.
- `scripts/estimate/reference-class-corpus.json`: the estimation corpus, read from the repository root.

**Shared files are vendored, never edited in place.** A skill lists what it needs in `agents/vendor.yaml`. Edit the file under `vendor-src/` (or `agents/` for a subagent prompt), then regenerate the copies:

```sh
node scripts/vendor.mjs --write   # refresh every copy and agents/vendor.lock.json
node scripts/vendor.mjs --check   # CI: fails when a copy differs from its source
```

**Tests.** `bash scripts/run-tests.sh` runs the bun suites in `tests/` and every `tests/*.test.sh`. They check that:
- each skill runs from its own directory (`skill-self-containment`, `skill-dir-isolation`), with no `${CLAUDE_PLUGIN_ROOT}`, sibling-skill or `${CLAUDE_SKILL_DIR}/../` path;
- the skill shape holds: an 80-line `SKILL.md` and 150-line references, each one linked;
- every skill that mentions `linearis` documents the phase-container skip (`linearis-guard`);
- every subagent a skill names is a skill or an agent in `agents/` (`plugin-agents`);
- the workflow-input, handoff, review-skill and Linear-write contracts hold, and the vendored replica reader finds `~/.config/catalyst-cloud/replica.db`.

CI also runs:
- `test:guards` (`scripts/check-skill-scope.mjs` + `tests/skill-scope.test.mjs`), which fails when a skill is unowned by `packs/skills-ownership.json`, when this checkout carries a repository-scoped install, or when a documented install command has lost `-g`;
- `scripts/install-smoke.sh`, which installs the repository with `skills@1.5.26` into a scratch HOME and checks all three harness paths;
- `scripts/install-scope-smoke.sh`, which runs the documented install command for real with `cwd` and `$HOME` as two different directories and proves the repository directory stays empty;
- a skill-name collision check against the Cloud pack and the other Catalyst skill packs;
- gitleaks;
- `scripts/scan-internal.sh`, which refuses internal hosts, paths and tokens in this public repository.

## License

MIT — see [LICENSE](LICENSE). The install commands above are one canonical block kept in [`.agents/install-block.md`](.agents/install-block.md); change them there first.
