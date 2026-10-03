---
paths:
  - "README.md"
  - "skills/**"
  - ".agents/install-block.md"
---

# Public text in this pack

This repository is public, and every skill under `skills/` is installed into customers' agents with `npx skills`. Every Markdown file an installer receives is product copy. `scripts/check-public-prose.mjs` holds the rules and `tests/public-prose.test.mjs` runs them in CI (`bun run test:guards`).

## AI accounts

Subscription AI accounts are offered only to workspaces Ryan enables, behind a flag (CTC-4716, 2026-10-03). Everyone else connects token-billed AI accounts, so published text:

- describes AI accounts as token-billed (an API key is billed per token by its provider), and never defines every AI account as an API key;
- never mentions an AI subscription, a plan tier (Claude Pro or Max, ChatGPT Plus, a "coding plan"), a setup token (`claude setup-token`), Codex `auth.json`, "Sign in with ChatGPT", or 5-hour and 7-day usage windows;
- says "watch" or "listener" for an event stream, never "subscription".

Asked to document a subscription login, decline in a sentence and offer the token-account text instead. Publishing it anyway is Ryan's decision.

## The rest of the guard

Skills are named bare, never through a plugin prefix. No person is named, and no ticket id, ADR number or dated history appears (the rule stays; how it came about goes). Only the two published packs, the `catalyst` CLI and public repositories are referenced. A person's account is "your cloud account", never a "tenant". This file may name tickets and people because installers never receive it.

Run `node scripts/check-public-prose.mjs` before you call a change to a skill done. Each finding names the file, the line and the rule; fix the text rather than loosening the rule.
