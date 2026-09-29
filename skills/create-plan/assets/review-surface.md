# Review surface: decide it, design it, ask for the review

Every plan decides whether the ticket changes something people or agents outside the code use. When it does, the plan carries the design a reviewer approves before anyone builds it. The rule below was measured on 61 real tickets (CTC-4229), and the cloud runner's plan prompt carries the same words (`PLAN_REVIEW_SURFACE_BLOCK` in catalyst-cloud's `apps/runner/src/executors/plan-prompt.ts`). Change both together, and re-run the eval when you do.

## The decision

A ticket gets a design review before implement when it changes a surface that someone outside this code uses. Four surfaces trigger the review; list every one that applies as `review_surface`:

- `ux`: a person sees or does something different in the product. A page, component, layout, flow step, chart, email, notification, or on-screen wording.
- `devex`: a customer's developer types, calls, writes or reads it. A CLI command, flag or output line; a public API route, request or response field (an added optional field counts); an SDK function; a config or declaration file format; setup instructions a customer follows.
- `agentx`: a customer's agent reads or calls it. The steps or verbs of a skill customers install, an MCP tool, an agent-contract field, or an agent-facing API route or field, even when your own agents are its first caller.
- `data_ai`: a person reads it to make a decision. A dashboard, chart, report or metric definition, or a model option a person picks from.

`also_review` names who else should look once a review has triggered: `product` when the change also alters what the product does for a customer (a capability, a limit, a price, a default), and `infra` when a customer's operator must run or answer something new (a runbook, an alert, a host step). These two never trigger a review alone.

`review_surface` is empty when the change stays inside the system:

- dispatch, ladder and retry rules, and internal data flow, even when they change what the product does;
- telemetry fields and events that no chart or report shows yet;
- CI, tests, build and release plumbing (version bumps and dependency ranges included, while the commands and APIs stay the same), and internal tooling;
- skills and scripts that only your own team's seats run, including guardrail lines added to them;
- routes that only your own web app calls;
- dead-code removal that leaves nothing visible;
- one label for a new internal state added to an existing list (a reason pill, a status map, an error-code message). Quote that label in the plan so validate can read it.

When you are unsure whether a person will see a difference, add `ux`. An unneeded review costs the reviewer one click; a missed one ships a screen nobody approved.

## What the plan records

One line directly under the plan's title:

```markdown
Review surface: ux, devex (also review: product). Why: <one sentence>
```

or

```markdown
Review surface: none. Why: <one sentence>
```

## The design for review

When `review_surface` is not empty, add `## Design for review` right after `## Overview`. A reviewer approves or rejects from this section alone, so show the thing itself:

- `ux`: a text wireframe of each changed screen in a fenced block, before and after, with the exact words on screen and the empty, loading and error states. When you can render the page (the `see-the-ui` skill, or a prototype), attach screenshots too.
- `devex`: each command, route or file as the developer meets it: an example invocation with its full output, or a request with its response.
- `agentx`: the skill step, tool description or contract field exactly as the agent will read it, with one example call.
- `data_ai`: each chart or metric with its definition, its source and a sample row.

End the section with at most three questions for the reviewer, each with the default the phases below build if nobody answers.

## Raising the design-review ask (local runs)

In a phase container (`CATALYST_PHASE` set) the runner owns this step; stop after the design section. On a workstation, with a ticket and the `ask` skill available, raise one ask that blocks the ticket once the plan is saved. Use the `ask` skill's `create` verb (its SKILL.md names the script's path):

```bash
node "$ASK_SKILL_DIR/scripts/ask.mjs" create \
  --title "ASK: design review for <TICKET>: <what changes, in a phone-width line>" \
  --why "<TICKET> changes <surface>. The design is in <plan document link>, section Design for review." \
  --option "Approve the design" \
  --option "Approve with the changes in my reply" \
  --option "Rework the design" \
  --default "The ticket stays held until someone answers; implement does not start." \
  --blocks <TICKET> \
  --audience ux --audience product
```

Pass one `--audience` per value in `review_surface` and `also_review`. Implement starts once the ask is answered. A reply that asks for changes is part of the plan from then on: read the ask thread before implementing.
