# Plan template

Gather the metadata, then write the plan in this shape. Fetch `origin/main` before capturing its SHA and merge-base. Frontmatter comes before the heading. Order each phase's steps test-first. For database changes: schema or migration, tests for the store methods, store methods, tests for the business logic, business logic, tests for the API, API, clients. For a new feature: research patterns, data model, then tests before each of backend logic, API endpoints and UI. For a refactor: capture the existing behaviour as tests first, change in small steps with the tests green, keep backwards compatibility, and plan the migration.

```bash
CURRENT_ISO_DATETIME=$(date -Iseconds); CURRENT_DATE=$(date +%Y-%m-%d); GIT_COMMIT=$(git rev-parse HEAD)
GIT_BRANCH=$(git branch --show-current); GIT_MAIN_SHA=$(git rev-parse origin/main)
GIT_MERGE_BASE=$(git merge-base "$GIT_MAIN_SHA" "$GIT_COMMIT")
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
```
````markdown
---
date: { CURRENT_ISO_DATETIME }
researcher: claude
git_commit: { GIT_COMMIT }
branch: { GIT_BRANCH }
git_main_sha: { GIT_MAIN_SHA }
git_merge_base: { GIT_MERGE_BASE }
repository: { REPO_NAME }
topic: "{PLAN_TITLE}"
tags: [plan, implementation, { RELEVANT_COMPONENT_TAGS }]
status: ready_for_implementation
last_updated: { CURRENT_DATE }
last_updated_by: claude
type: implementation_plan
source_ticket: { TICKET-ID or null }
source_research: "[[research-doc-filename]]" # or null
---

# [Feature/Task Name] Implementation Plan

## Overview

[Brief description of what we're implementing and why]

## Current State Analysis

[What exists now, what's missing, key constraints discovered]

## Desired End State

[Specification of the desired end state and how to verify it]

### Key Discoveries:

- [Important finding with file:line reference]
- [Pattern to follow]
- [Constraint to work within]

## What We're NOT Doing

[Explicitly list out-of-scope items to prevent scope creep]

## Implementation Approach

[High-level strategy and reasoning]

## Phase 1: [Descriptive Name]

### Overview

[What this phase accomplishes]

### Tests First (Red):

Define the expected behavior before writing implementation code.

#### 1. [Test File/Group]

**File**: `tests/path/to/feature.test.ext` **Tests to write**:

```[language]
// Test describing expected behavior — should FAIL before implementation
```

### Implementation (Green):

Write the minimum code to make the tests pass.

#### 1. [Component/File Group]

**File**: `path/to/file.ext` **Changes**: [Summary of changes]

```[language]
// Specific code to add/modify
```

### Refactor (if needed):

[Any cleanup, extraction, or simplification to do while tests stay green]

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `make test`
- [ ] Type checking passes: `make check`
- [ ] Linting passes: `make lint`

#### Manual Verification:

- [ ] Feature works as expected when tested
- [ ] No regressions in related features

---

## Phase 2: [Descriptive Name]

[Similar structure — always Tests First → Implementation → Refactor]

---

## Testing Strategy (TDD)

**Approach: Test-Driven Development (Red → Green → Refactor)**

Each phase writes tests BEFORE implementation code. This ensures:

- Requirements are encoded as executable specifications
- Implementation stays focused on passing defined behavior
- Refactoring is safe because tests catch regressions

**Test tiers:**

- **Unit tests** — written first for each function with business logic
- **Integration tests** — written first for API endpoints and data flows
- **Edge case tests** — written first for error states, invalid inputs, auth failures

**Per-phase rhythm:**

1. Write failing tests that describe the phase's expected behavior
2. Implement the minimum code to make tests pass
3. Refactor while keeping tests green

[Additional manual testing steps if needed]

## Performance Considerations

[Any performance implications]

## Migration Notes

[If applicable]

## References

- Original ticket: [[PROJ-XXX]]
- Related research: [[YYYY-MM-DD-relevant-research]]
- Similar implementation: `[file:line]`
````
