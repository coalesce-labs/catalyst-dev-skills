---
name: agent-browser
description: Browser automation CLI for AI agents; use it instead of Playwright MCP tools. Use when the user says "open in browser", "check the site", "take a screenshot", "fill the form" or "test the UI", or for any browser interaction. Also use when a task needs a visual browser that CLIs and APIs cannot handle, such as an OAuth flow, a complex dashboard or visual verification.
---

# agent-browser CLI Reference

## When to use it

Reach first for a CLI, an API or an MCP server. Use `agent-browser` when the task needs a visual browser (OAuth login, dashboards, visual verification), when nothing programmatic can do it, or when the user asks to open, browse, check the site or take a screenshot. For browser work, use the `agent-browser` CLI rather than Playwright MCP tools.

## The one rule: every session is named and closed

`agent-browser` runs a persistent per-session daemon that owns a real "Chrome for Testing" browser. The daemon outlives the CLI: the browser keeps running, and on an auto-refreshing page keeps a CPU core busy, until something closes it. On a shared worker host a leaked browser starves the box.

- **Every command carries `--headed --session <name>`**, with a short, task-specific name such as `eng-123-verify` or `gh-review`. Avoid the implicit `default` session: it collides across concurrent workers and is the hardest leak to attribute.
- **Close in the same turn you finish:** `agent-browser --session <name> close`. After a wrong turn, close before starting over.
- **Every loop has a guaranteed close.** An open-loop such as `until agent-browser --session s open <url>; do sleep …; done` strands browsers, because each failed `open` can spawn or adopt one. To poll, `open` once, then `wait` or `reload`, and `close` in a trap or `finally`.
- **On a worker or CI host, close immediately.** A host reaper, if one runs, is only a backstop.

```bash
agent-browser --headed --session my-task open https://example.com
agent-browser --headed --session my-task snapshot -i -c   # interactive elements, compact
agent-browser --headed --session my-task click @e2
agent-browser --headed --session my-task fill @e3 "text"
agent-browser --headed --session my-task screenshot -f
agent-browser --headed --session my-task close
```

Use the `@refs` from a snapshot directly, with no CSS selectors, and chain commands with `&&`. A session keeps its state across commands, so one login serves the whole task.

**Login flow:** open the login page `--headed`, tell the user "A browser window opened — please log in, then let me know", wait for their confirmation, then continue with the same `--headed --session <name>`. To keep the login, run `agent-browser --headed --session my-task state save ./auth-state.json`.

## Reference

| topic | file |
| -- | -- |
| every global flag and env var | [`references/flags.md`](references/flags.md) |
| navigation, interaction, snapshot, screenshots, info, wait, semantic locators | [`references/commands.md`](references/commands.md) |
| state/auth, cookies/storage, tabs, frames, JS, console, dialogs, settings, network, debug | [`references/commands-advanced.md`](references/commands-advanced.md) |
