---
name: ask-triage
description: "Old name for the unsticker skill, kept so existing callers still work. Use only when something invokes ask-triage by name; for anything else use the unsticker skill."
---

# Ask triage (renamed)

This skill is now `unsticker`. Invoke the `unsticker` skill with the same input (one ask identifier and a mode) and follow it. Its record is unchanged: one `ask-triage/v1` JSON object.

If the `unsticker` skill is not installed, refresh this pack (`npx skills@latest add coalesce-labs/catalyst-dev-skills --all -g`, after the checks in the pack's README) and try again.
