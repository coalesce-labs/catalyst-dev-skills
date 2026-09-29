---
name: unsticker
description: "Investigate one open ask ticket like a senior engineer, classify it (mechanical, decidable under standing authority, or genuinely the human's), act within the limits, and emit one structured ask-triage/v1 record with the reasoning. Invoked by name only: Catalyst Cloud's triage job names it (CATALYST_PHASE=triage), and an operator runs it to triage, unstick or unblock an ask, or to sweep the open asks. A person's own 'unstick' request belongs to the Cloud pack's `unstick` skill, which is why the agent never picks this one on its own."
disable-model-invocation: true
---

# Unsticker

**In a Catalyst Cloud container (`CATALYST_PHASE=triage`), follow [`references/container.md`](references/container.md) and nothing below.** It reads only the phase replica and the evidence snapshot, never acts, and writes one record to `$CATALYST_ARTIFACT_DIR/ask-triage.json`.

An ask ticket exists to get one human decision. Many asks do not need one: the work is stuck on a merge conflict, a flake, a missing review, a stale label, or a question a recorded decision already answers. This skill finds out which kind this ask is, moves the mechanical ones, and writes down why, so the reasoning can be graded and generalized later.

**Input:** one ask identifier (`ENG-123`) and a mode. The default mode is `propose`, which investigates and records without acting. In `act` mode the skill also takes the actions its classification allows.

## 1. Read the ask

Read the ask's title, description, labels, state, comments (oldest first) and relations. Read Linear through the `linearis-cli` skill's reading rule (the local replica first, never a bare `issues read`). Note what the ask blocks. That is the subject, the work that is actually stuck.

Skip every `linearis` call when `CATALYST_PHASE` is set (a phase container has no Linear credential and the runner owns the write-back) or when `command -v linearis` fails; say so in one line and continue from the inputs you were given.

## 2. Check the premise first

Before any deeper investigation, check whether the ask still needs an answer. It is moot when its subject already merged, is Done or Canceled, or the answer already sits in a comment or an ADR. Record a moot ask as `mechanical` with pattern `moot`, cite the evidence, and stop investigating. A held category is never moot: a release or spend ask whose subject merged still waits on its release or spend (see [`references/classify.md`](references/classify.md)).

## 3. Investigate the subject

Follow [`references/investigate.md`](references/investigate.md) for the ask's shape. At minimum check:

- the subject's state, owner seat, fence labels and newest comments;
- its pull requests: open or merged, conflicts, failing checks and whether each is real, review threads at head, queue and hold labels;
- the relay ledger for the subject (phase, park, hold, head sha agreement);
- a duplicate ask, or a decision already recorded in an ADR or a plan.

Every claim in the record cites where it came from: a URL, a PR number, a check name, a sha, a file and line.

## 4. Classify

Use [`references/classify.md`](references/classify.md). Exactly one class:

- `mechanical`: nothing needs deciding; something needs doing (conflict, flake, missing review, stale label or fence, duplicate, moot, dead seat, missing delegate).
- `decidable`: a real choice, but reversible and inside standing authority; a recorded default or the evidence picks the option.
- `human`: any category on the always-escalate list in classify.md (spend, deleting data or credentials, public release, security, rollout flags, a physical human step, and the rest).

Also give it a `pattern` from the closed tag table in classify.md (`other` if nothing fits), and put the specifics in `pattern_detail`. A `decidable` record names the option it would take in `proposed_answer`.

## 5. Act (only in `act` mode, only within the class)

Follow [`references/act.md`](references/act.md). `mechanical`: do the smallest thing that gets the work moving, or hand it to the owning seat with the exact steps, then answer or close the ask with the evidence. `decidable`: propose only. Post the option, the reasoning and "the human can overrule", and change nothing. `human`: post one short recommendation with its evidence and take no action.

Never merge by hand, publish, delete data, touch another seat's active branch or worktree, or write a human's `DECIDED:` line. Every comment an agent posts starts with `[bookkeeping]`, except a decision answer, which follows the `ask` skill's reply form.

## 6. Emit the record

Print exactly one JSON object, in the shape in [`references/record.md`](references/record.md), as the last thing in the output. The record carries the reasoning (evidence, findings, root cause, rejected options, what would change the verdict), not just the verdict, because the reasoning is what lets someone grade the call and build a better general unsticker.
