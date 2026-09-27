# agents/ Directory: Specialized Research Agents

This directory contains markdown files that define specialized research agents for Claude Code. Agents are invoked by commands using the `Task` tool to perform focused research tasks in parallel.

## How Agents Work

**Agents vs Commands:**

- **Commands** (`/command-name`) - User-facing workflows you invoke directly
- **Agents** (`@catalyst-dev:name`) - Specialized research tools spawned by commands

**Invocation:** Commands spawn agents using the Task tool:

```markdown
Task(subagent_type="catalyst-dev:codebase-locator", prompt="Find authentication files")
```

**Philosophy:** All agents follow a **documentarian, not critic** approach:

- Document what EXISTS, not what should exist
- NO suggestions for improvements unless explicitly asked
- NO root cause analysis unless explicitly asked
- Focus on answering "WHERE is X?" and "HOW does X work?"

## Available Agents

### Codebase Research Agents

#### codebase-locator

**Purpose**: Find WHERE code lives in a codebase

**Use when**: You need to locate files, directories, or components

- Finding all files related to a feature
- Discovering directory structure
- Locating test files, configs, or documentation

**Tools**: Grep, Glob, Bash(ls \*)

**Example invocation:**

```markdown
Task( subagent_type="catalyst-dev:codebase-locator", prompt="Find all authentication-related files" )
```

**Returns**: Organized list of file locations categorized by purpose

---

#### codebase-analyzer

**Purpose**: Understand HOW specific code works

**Use when**: You need to analyze implementation details

- Understanding how a component functions
- Documenting data flow
- Identifying integration points
- Tracing function calls

**Tools**: Read, Grep, Glob, Bash(ls \*)

**Example invocation:**

```markdown
Task( subagent_type="catalyst-dev:codebase-analyzer", prompt="Analyze the authentication middleware
implementation and document how it works" )
```

**Returns**: Detailed analysis of how code works, with file:line references

---

#### codebase-pattern-finder

**Purpose**: Find existing patterns and usage examples

**Use when**: You need concrete examples

- Finding similar implementations
- Discovering usage patterns
- Locating test examples
- Understanding conventions

**Tools**: Grep, Glob, Read, Bash(ls \*)

**Example invocation:**

```markdown
Task( subagent_type="catalyst-dev:codebase-pattern-finder", prompt="Find examples of how other components handle
error logging" )
```

**Returns**: Concrete code examples showing patterns in use

### Thoughts System Agents

#### thoughts-locator

**Purpose**: Discover existing thought documents about a topic

**Use when**: You need to find related research or plans

- Finding previous research on a topic
- Discovering related plans
- Locating historical decisions
- Searching for related discussions

**Tools**: Grep, Glob, LS

**Example invocation:**

```markdown
Task( subagent_type="catalyst-dev:thoughts-locator", prompt="Find all thoughts documents about authentication" )
```

**Returns**: List of relevant thought documents with paths

---

#### thoughts-analyzer

**Purpose**: Extract key insights from thought documents

**Use when**: You need to understand documented decisions

- Analyzing research documents
- Understanding plan rationale
- Extracting historical context
- Identifying previous decisions

**Tools**: Read, Grep, Glob, LS

**Example invocation:**

```markdown
Task( subagent_type="catalyst-dev:thoughts-analyzer", prompt="Analyze the authentication research document and
extract key findings" )
```

**Returns**: Summary of insights and decisions from documents

### External Research Agents

#### external-research

**Purpose**: Research external frameworks and repositories

**Use when**: You need information from outside sources

- Understanding how popular repos implement features
- Learning framework patterns
- Researching best practices from open-source
- Discovering external documentation

**Tools**: mcp**context7**resolve-library-id, mcp**context7**query-docs, WebSearch, WebFetch

**Example invocation:**

```markdown
Task( subagent_type="catalyst-dev:external-research", prompt="Research how Next.js implements middleware
authentication patterns" )
```

**Returns**: Information from external repositories and documentation

## Agent File Structure

Every agent file has this structure:

```markdown
---
name: agent-name
description: What this agent does
tools: Tool1, Tool2, Tool3
model: inherit
---

# Agent Implementation

Instructions for the agent...

## CRITICAL: YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY

- DO NOT suggest improvements...
- DO NOT perform root cause analysis...
- ONLY describe what exists...
```

### Required Frontmatter Fields

- `name` - Agent identifier (matches filename without .md)
- `description` - One-line description for invoking commands
- `tools` - Tools available to the agent
- `model` - AI model to use (usually "inherit")

### Naming Convention

- Filename: `agent-name.md` (hyphen-separated)
- Frontmatter name: `agent-name` (matches filename)
- Unlike commands, agents MUST have a `name` field

## How Commands Use Agents

### Parallel Research Pattern

Commands spawn multiple agents concurrently for efficiency:

```markdown
# Spawn three agents in parallel

Task(subagent_type="catalyst-dev:codebase-locator", ...) Task(subagent_type="catalyst-dev:thoughts-locator", ...)
Task(subagent_type="catalyst-dev:codebase-analyzer", ...)

# Wait for all to complete

# Synthesize findings
```

### Example from research_codebase.md

```markdown
Task 1 - Find WHERE components live: subagent: codebase-locator prompt: "Find all files related to
authentication"

Task 2 - Understand HOW it works: subagent: codebase-analyzer prompt: "Analyze auth middleware and
document how it works"

Task 3 - Find existing patterns: subagent: codebase-pattern-finder prompt: "Find similar
authentication implementations"
```

## Documentarian Philosophy

**What agents do:**

- ✅ Locate files and components
- ✅ Document how code works
- ✅ Provide concrete examples
- ✅ Explain data flow
- ✅ Show integration points

**What agents do NOT do:**

- ❌ Suggest improvements
- ❌ Critique implementation
- ❌ Identify bugs (unless asked)
- ❌ Recommend refactoring
- ❌ Comment on code quality

**Why this matters:**

- Research should be objective
- Understanding comes before judgment
- Prevents bias in documentation
- Maintains focus on current state

## Distribution

Agents travel with the skills. A skill that spawns a research subagent carries that agent's instructions inside its own directory (`assets/agents/<name>.md`, a vendored copy of `agents/<name>.md` kept in step by `node scripts/vendor.mjs --write`), so one install command delivers both:

```sh
npx skills@latest add coalesce-labs/catalyst-dev-skills --all -g
```

Refresh with `npx skills@latest update -g -y`. There is no plugin marketplace rail: `coalesce-labs/catalyst-dev-skills` is the only lineage, and installing the set twice left every skill twice (Ryan, 2026-09-26; CTC-3529).

The cloud runner is the one place this repository is still loaded as a Claude Code plugin. The runner image bakes it and starts `claude --plugin-dir` on it, which is why `agents/*.md` and `.claude-plugin/plugin.json` stay and why a skill may say "spawn them as `catalyst-dev:<name>`" (`tests/plugin-agents.test.mjs`).

### Per-project availability

Agents are available wherever the skills are installed. No per-project setup is needed.

## Creating New Agents

### Step 1: Create Markdown File

```bash
# Create file with hyphen-separated name
touch agents/my-new-agent.md
```

### Step 2: Add Frontmatter

```yaml
---
name: my-new-agent
description: Clear, focused description of what this agent finds or analyzes
tools: Read, Grep, Glob
model: inherit
---
```

### Step 3: Write Agent Logic

```markdown
You are a specialist at [specific research task].

## CRITICAL: YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY

[Standard documentarian guidelines]

## Core Responsibilities

1. **[Primary Task]**
   - [Specific action]
   - [What to look for]

2. **[Secondary Task]**
   - [Specific action]
   - [What to document]

## Output Format

[Specify how results should be structured]
```

### Step 4: Test

```bash
# In this workspace, agents are immediately available via symlinks
# Just restart Claude Code to reload

# Create a command that uses the agent
# Invoke the command to test the agent
```

### Step 5: Validate Frontmatter

```bash
# In Claude Code (workspace only)
/validate-frontmatter
```

## Common Patterns

### Pattern 1: Locator → Analyzer

```markdown
# First, find files

Task(subagent_type="catalyst-dev:codebase-locator", ...)

# Then analyze the most relevant ones

Task(subagent_type="catalyst-dev:codebase-analyzer", ...)
```

### Pattern 2: Parallel Search

```markdown
# Search codebase and thoughts simultaneously

Task(subagent_type="catalyst-dev:codebase-locator", ...) Task(subagent_type="catalyst-dev:thoughts-locator", ...)
```

### Pattern 3: Pattern Discovery

```markdown
# Find patterns after understanding the code

Task(subagent_type="catalyst-dev:codebase-analyzer", ...) Task(subagent_type="catalyst-dev:codebase-pattern-finder", ...)
```

## Tool Access

Agents specify required tools in frontmatter:

**File Operations:**

- `Read` - Read file contents
- `Write` - Create files (rare for agents)

**Search:**

- `Grep` - Content search
- `Glob` - File pattern matching

**Execution:**

- `Bash(ls *)` - List directory contents

**External:**

- `mcp__context7__query-docs` - Library/framework documentation
- `WebSearch` / `WebFetch` - General web search and page retrieval

## Troubleshooting

### Agent not found when spawned

**Check:**

1. Skills installed? `ls ~/.agents/skills/<skill>/assets/agents/` lists the agent prompts a skill carries; in the cloud runner they are `agents/<name>.md` at the plugin root
2. Frontmatter `name` field matches filename?
3. Restarted Claude Code after adding/modifying agent?

**Solution:**

```bash
# Refresh the skills
npx skills@latest update -g -y

# Restart Claude Code
```

### Agents update with the skills

**This is by design** - agents are pure logic with no project-specific config.

**If you need customization:**

- Don't modify plugin agents - they'll be overwritten on update
- Create a custom agent in `.claude/plugins/custom/agents/`
- Use a different name to avoid conflicts

## See Also

- [`../agents/`](../agents/) - The agent files this page describes
- [`../README.md`](../README.md) - Repository overview
