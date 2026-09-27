---
name: ask-triage
description: "Investigate one open ask ticket like a senior engineer, classify it (mechanical, decidable under standing authority, or genuinely the human's), act within the limits, and emit one structured record with the reasoning. Use when dispatched as the ask-triage phase, when asked to 'triage', 'unstick' or 'unblock' an ask, or when sweeping the open asks so they stop waiting on a human for work an agent can do."
---

# Ask triage

An ask ticket exists to get one human decision. Many asks do not need one: the work is stuck on a merge conflict, a flake, a missing review, a stale label, or a question a recorded decision already answers. This skill finds out which kind this ask is, moves the mechanical ones, and writes down why, so the reasoning can be graded and generalized later.

**Input:** one ask identifier (`CTC-3584`) and a mode. The default mode is `propose`, which investigates and records without acting. In `act` mode the skill also takes the actions its classification allows.

## 1. Read the ask

Read the ask's title, description, labels, state, comments (oldest first) and relations. Read Linear through the `linearis` skill's reading rule (the local replica first, never a bare `issues read`). Note what the ask blocks. That is the subject, the work that is actually stuck.

Skip every `linearis` call when `CATALYST_PHASE` is set (a phase container has no Linear credential and the runner owns the write-back) or when `command -v linearis` fails; say so in one line and continue from the inputs you were given.

## 2. Investigate the subject

Follow [`references/investigate.md`](references/investigate.md) for the ask's shape. At minimum check:

- the subject's state, owner seat, fence labels and newest comments;
- its pull requests: open or merged, conflicts, failing checks and whether each is real, review threads at head, queue and hold labels;
- the relay ledger for the subject (phase, park, hold, head sha agreement);
- whether the ask is already moot: subject merged or canceled, a duplicate ask, an answer already posted, or a decision already recorded in an ADR or a plan.

Every claim in the record cites where it came from: a URL, a PR number, a check name, a sha, a file and line.

## 3. Classify

Use [`references/classify.md`](references/classify.md). Exactly one class:

- `mechanical`: nothing needs deciding; something needs doing (conflict, flake, missing review, stale label or fence, duplicate, moot, dead seat, missing delegate).
- `decidable`: a real choice, but reversible and inside standing authority; a recorded default or the evidence picks the option.
- `human`: spend, public release, deleting data, customer data, messages outside the team, or a product call about what a customer sees.

Also give it a `pattern` from the closed tag table in classify.md (`other` if nothing fits), and put the specifics in `pattern_detail`.

## 4. Act (only in `act` mode, only within the class)

Follow [`references/act.md`](references/act.md). `mechanical`: do the smallest thing that gets the work moving, or hand it to the owning seat with the exact steps, then answer or close the ask with the evidence. `decidable`: in this release, propose only. Post the option, the reasoning and "the human can overrule", and change nothing. `human`: post one short recommendation with its evidence and take no action.

Never merge by hand, publish, delete data, touch another seat's active branch or worktree, or write a human's `DECIDED:` line. Every comment an agent posts starts with `[bookkeeping]`, except a decision answer, which follows the `ask` skill's reply form.

## 5. Emit the record

Print exactly one JSON object, in the shape in [`references/record.md`](references/record.md), as the last thing in the output. In a phase container, also write it to `$CATALYST_ARTIFACT_DIR/ask-triage.json`. The record carries the reasoning (evidence, findings, root cause, rejected options, what would change the verdict), not just the verdict, because the reasoning is what lets someone grade the call and build a better general unsticker.
