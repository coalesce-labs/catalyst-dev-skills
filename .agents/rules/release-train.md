---
paths:
  - "package.json"
  - ".claude-plugin/plugin.json"
  - "scripts/check-release-line.mjs"
  - "scripts/release-tag.mjs"
  - ".github/workflows/release-tag.yml"
---

# Release train

The development pack is on Catalyst's shared release train: its version's MAJOR.MINOR is the line `release-train.json` declares. catalyst-cloud owns that declaration; the public Cloud pack (`coalesce-labs/catalyst-cloud-skills`) carries an identical copy, and CI reads it from the clone it already makes. Before you change the version or push a `dev-skills-v*` tag, load the `release-train` skill, which the Cloud pack carries at `.agents/skills/release-train/SKILL.md`, and run its `scripts/train-status.mjs` from a clone of that repository.

The short form: a change is a patch on the line. The MINOR moves for every member at once or not at all. Nothing goes backwards. A release is the annotated `dev-skills-v<version>` tag on the merged `main` commit: `node scripts/release-tag.mjs` checks and creates it, and a person pushes it once. Never move or re-push a pushed tag.

The pack stepped down once, from 15.0.1 to 0.16.0, to join the train (CTC-6793, a recorded exception to "nothing goes backwards" under the decision that every installed component follows the approved release). It never steps down again.
