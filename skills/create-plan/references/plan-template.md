# Plan template

Frontmatter comes before the heading. Write every sha in full.

````markdown
---
date: <ISO date-time>
git_commit: <full HEAD sha>
branch: <branch>
git_main_sha: <full origin/main sha>
git_merge_base: <full merge-base sha>
repository: <repo name>
topic: "<plan title>"
type: implementation_plan
status: ready_for_implementation
source_ticket: <TICKET-ID or null>
source_research: "[[<research document name>]]"
---

# <Title>

## Overview

What changes and why, in two or three sentences.

## Acceptance criteria

- **AC1** <one observable behaviour>. Proof: `<test file>` <test name>.
- **AC2** …

## Current state

What exists now, with `path:line` for each fact the plan relies on.

## Out of scope

What this plan deliberately leaves alone.

## Phase 1: <name>

- Tests first: the failing tests to write, and which criteria they prove.
- Change: the files and what changes in each.
- Done when: the tests above pass and the repository's checks are green.

## Phase 2: <name>

…

## Files in scope

- `path/to/file`

## Verification

The repository's check command, and any manual check a criterion needs.
````
