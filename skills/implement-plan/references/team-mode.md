# Team mode

Use it when the skill gets `--team`, or when the plan spans three or more independent domains: phases that can run in parallel, touching distinct areas (frontend, backend, tests, infra) whose files do not overlap.

## Structure

```
Lead (Opus) — Coordinates implementation
├── Teammate 1 (Sonnet) — Frontend changes
│   └── Can spawn subagents for research
├── Teammate 2 (Sonnet) — Backend changes
│   └── Can spawn subagents for research
└── Teammate 3 (Sonnet) — Test changes
    └── Can spawn subagents for research
```

## Process

1. **Analyze plan phases**: pick the phases that can run in parallel.
2. **Assign file ownership**: each teammate gets distinct files, and no two teammates edit the same file.
3. **Create the task list** with TaskCreate, with dependencies between phases. Sequential phases stay sequential.
4. **Launch the team**: spawn teammates with focused instructions.
5. **Review gates**: the lead reviews every teammate's work through approvePlan/rejectPlan before proceeding.
6. **Integrate**: the lead verifies all changes work together.
7. **Commit**: one atomic commit, or one per phase.

When agent teams are unavailable, run the phases sequentially.
