# Research template

Write the research document in this shape. Frontmatter comes before the heading.

```markdown
---
date: YYYY-MM-DDTHH:MM:SS+TZ
researcher: { your-name }
git_commit: { full commit SHA }
branch: { branch-name }
git_main_sha: { fetched origin/main SHA }
git_merge_base: { merge-base of git_main_sha and git_commit }
repository: { repo-name }
topic: "{User's Research Question}"
tags: [research, codebase, { component-names }]
status: complete
last_updated: YYYY-MM-DD
last_updated_by: { your-name }
type: research
source_ticket: { TICKET-ID or null }
---

# Research: {User's Research Question}

**Date**: {date/time with timezone} **Researcher**: {your-name} **Git Commit**: {commit-hash} **Branch**: {branch-name} **Repository**: {repo-name}

## Research Question

{Original user query, verbatim}

## Summary

{High-level documentation of what you found. 2-3 paragraphs explaining the current state of the system in this area. Focus on WHAT EXISTS, not what should exist.}

## Detailed Findings

### {Component/Area 1}

**What exists**: {Describe the current implementation}

- File location: `path/to/file.ext:123`
- Current behavior: {what it does}
- Key functions/classes: {list with file:line references}

**Connections**: {How this component integrates with others}

### {Component/Area N}

{Continue for all major findings}

## Code References

- `path/to/file1.ext:123-145` - {What this code does}
- `path/to/file2.ext:67` - {What this code does}

## Architecture Documentation

{Document current architectural patterns and data flow. Descriptive, not prescriptive.}

## Historical Context (from thoughts/)

{Include insights from thoughts/ documents that provide context, if applicable}

## Open Questions

{Areas that would benefit from further investigation}

## Related Documents

{List related thoughts documents using wiki-links, e.g.:}

- [[YYYY-MM-DD-source-ticket|Source Ticket]]
- [[YYYY-MM-DD-related-research|Related Research]]
```

## Summary to the person

After the sync and the ticket comment, present this:

```
Research complete!

**Research document**: {exact file path you wrote}

**Summary**: {2-3 sentence summary}

**Key files**: {Top 3-5 file references}

Would you like me to:
1. Dive deeper into any specific area?
2. Explore related topics?
```
