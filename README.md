# catalyst-dev-skills

The Catalyst development workflow as agent skills: research → plan → implement → validate → ship, plus the Linear, pull-request and coordination skills around it. Each skill is a directory under [`skills/`](skills) with a `SKILL.md` and everything it runs, so the same files work in Claude Code, Codex and OpenCode.

## Install

One command, for every coding agent on the machine:

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills --all
```

It installs all 34 skills for each agent it detects (Claude Code, Codex, OpenCode, Cursor and the rest). Add `-g` to install into your home directory instead of the project. Skills installed this way do not auto-update; run `npx skills update -y` to refresh them.

<details><summary><strong>Alternative for Claude Code: the plugin marketplace</strong></summary>

The plugin installs the set as a managed bundle, under the `catalyst-dev:` prefix (`/catalyst-dev:create-plan`). It does not load into the session you are already in; run `/reload-plugins` or restart afterwards. Pick one rail; installing both leaves you with every skill twice.

```
/plugin marketplace add coalesce-labs/catalyst-dev-skills
/plugin install catalyst-dev@catalyst-dev-skills
```
</details>

<details><summary><strong>One agent at a time</strong></summary>

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills -a codex
npx skills@latest add coalesce-labs/catalyst-dev-skills -a opencode
npx skills@latest add coalesce-labs/catalyst-dev-skills -a claude-code
```

Without `--all` the installer asks which skills to take and which agents to install them on. `--skill <name>` takes one skill.
</details>

The installed folder takes the skill's frontmatter `name`, which is the directory name for every skill except `skills/linearis`, which installs as `linearis-cli`.

## What's inside

**Research and planning**
- `research-codebase`: parallel codebase research, written up under `thoughts/shared/research/`.
- `create-plan`, `iterate-plan`: a test-first implementation plan, and its revisions.
- `gherkin-ticket`: shape a ticket as an outcome title with Given/When/Then acceptance criteria.

**Building and checking**
- `implement-plan`: carry out an approved plan, red-green-refactor.
- `validate-plan`, `remediate-plan`: check the implementation against the plan, then fix what the check found.
- `review-code`, `review-security`: review a branch's diff for real defects and exploitable vulnerabilities.
- `fix-typescript`, `scan-reward-hacking`, `validate-type-safety`: TypeScript errors fixed without shortcuts, and the gate that checks it.
- `agent-browser`: browser automation for checking a UI.
- `unslop`: edit text to remove the patterns that mark it as AI-written (third-party, see below).

**Shipping**
- `commit`, `create-pr`, `describe-pr`, `review-comments`, `merge-pr`, `triage-aging-prs`: commit through merge, including review feedback and an aging PR backlog.
- `create-worktree`: a git worktree for parallel work.

**Linear and coordination**
- `linear`, `linearis`: ticket workflow, and the Linearis CLI reference with the read-from-replica rule.
- `ask`: raise a decision for a human as a ticket and close it when answered.
- `steward`, `concierge`, `project-orchestrator`: long-running owners of a project, of a human's board, and of a project's ready backlog.
- `create-handoff`, `resume-handoff`: hand work to another session and pick it up.
- `morning-briefing`, `briefing-followup`: a daily briefing and its walk-through.
- `compound-estimate`, `ticket-compound`, `ticket-retro`: the post-merge learning loop.

**In a Catalyst Cloud phase container** (`CATALYST_PHASE` set), every skill that uses `linearis` skips those calls, because the runner owns the ticket write-back there. They also skip when the `linearis` CLI is not installed.

## Third-party skills

- `skills/unslop` is copied unchanged from [cursor/plugins](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md), by Lauren Tan, under the MIT License. Its licence is in [`skills/unslop/LICENSE`](skills/unslop/LICENSE) and its attribution in [`skills/unslop/NOTICE.md`](skills/unslop/NOTICE.md).

- `vendor-src/references/resolving-review-findings.md` (vendored into `remediate-plan`, `review-comments` and `triage-aging-prs`) is adapted from [obra/superpowers](https://github.com/obra/superpowers/blob/main/skills/receiving-code-review/SKILL.md) (commit `3fb75974`), by Jesse Vincent, under the MIT License; the file's header carries the credit and what changed.

## For contributors

**Layout.**
- `skills/<name>/`: one skill. `SKILL.md` is the common path; `references/` holds detail read on demand; `scripts/` and `assets/` hold what the skill runs.
- `agents/`: the plugin's research subagents (`catalyst-dev:codebase-locator` and the rest), which Claude Code loads from the plugin root. It is also the one source of the subagent prompts skills carry under `assets/agents/`.
- `vendor-src/`: the single source of every other file two or more skills share (`scripts/…`, `references/…`, `templates/…`).
- `.claude-plugin/`: the Claude Code plugin (`catalyst-dev`) and its marketplace (`catalyst-dev-skills`). The repository root is the plugin root, which the Catalyst Cloud runner image bakes as its catalyst-dev bundle.
- `scripts/estimate/reference-class-corpus.json`: the estimation corpus the runner reads from the plugin root.

**Shared files are vendored, never edited in place.** A skill lists what it needs in `agents/vendor.yaml`. Edit the file under `vendor-src/` (or `agents/` for a subagent prompt), then regenerate the copies:

```sh
node scripts/vendor.mjs --write   # refresh every copy and agents/vendor.lock.json
node scripts/vendor.mjs --check   # CI: fails when a copy differs from its source
```

**Tests.** `bash scripts/run-tests.sh` runs the bun suites in `tests/` and every `tests/*.test.sh`. They check that:
- each skill runs from its own directory (`skill-self-containment`, `skill-dir-isolation`), with no `${CLAUDE_PLUGIN_ROOT}`, sibling-skill or `${CLAUDE_SKILL_DIR}/../` path;
- the skill shape holds: an 80-line `SKILL.md` and 150-line references, each one linked;
- every skill that mentions `linearis` documents the phase-container skip (`linearis-guard`);
- every `catalyst-dev:<name>` a skill uses is a skill or a plugin subagent in `agents/` (`plugin-agents`);
- the workflow-input, handoff, review-skill and Linear-write contracts hold, and the vendored replica reader finds `~/.config/catalyst-cloud/replica.db`.

CI also runs:
- `scripts/install-smoke.sh`, which installs the repository with `skills@1.5.26` into a scratch HOME and checks all three harness paths;
- a skill-name collision check against `catalyst-cloud-skills` and `catalyst-pm-skills`;
- gitleaks;
- `scripts/scan-internal.sh`, which refuses internal hosts, paths and tokens in this public repository.

These skills moved here from `coalesce-labs/catalyst` (`plugins/dev`); history before the move lives there.

## License

MIT — see [LICENSE](LICENSE). The install commands above are one canonical block kept in [`.agents/install-block.md`](.agents/install-block.md); change them there first.
