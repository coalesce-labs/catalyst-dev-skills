---
name: iterate-plan
description: "Old name for revising an implementation plan, now the create-plan skill's revise mode; kept so existing callers still work. Use when the user says 'update the plan', 'change the plan', 'the requirements changed' or 'revise the approach' for a plan in thoughts/shared/plans/."
---

# Iterate plan (now part of create-plan)

Revising a plan is now the `create-plan` skill's revise mode. Invoke the `create-plan` skill with the same input (the plan's path or ticket, and the changes wanted) and follow its "Revising an existing plan" section.

If the `create-plan` skill is not installed, refresh this pack (`npx skills@latest add coalesce-labs/catalyst-dev-skills --all -g`, after the checks in the pack's README) and try again.
