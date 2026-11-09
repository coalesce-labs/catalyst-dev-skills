---
name: review-and-verify
description: "Review a pull request at one exact head, fix what is valid, and prove the fixes, in one pass: acceptance criteria from the plan, defects (review-code), TypeScript safety with the reward-hacking scan (validate-type-safety), and security (review-security). Verifies each finding before fixing it, re-checks only the fix range, and writes one review-result.json. Use when dispatched as the review stage, or asked to review and fix a PR. Not for answering someone else's review comments (review-comments)."
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
argument-hint: "[PR-number] [--recheck <review-result.json>]"
metadata:
  version: "1.0.0"
---

# Review and verify

One review of a pull request at one head, with its valid findings fixed and proven. This skill owns four things: the step order, the one fix-and-re-check loop, the depth, and the result file. Every review rule lives in the skill it runs; improve that skill, never this one, when a review misses something.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

When `CATALYST_PHASE` is set the run is unattended: never ask and wait.

## Step 0: Pin the head, the base and the depth

1. **Head.** Take the pull request number, head sha `H` and base sha from the caller (a cloud run puts them in the prompt), else from `gh pr view <n> --json number,headRefOid,baseRefOid`. `git rev-parse HEAD` must equal `H`; if it does not, stop and report `head_mismatch`. Base `B` is `git merge-base <base sha> H`. Pass `B` to every skill below.
2. **Depth.** Run `node "${CLAUDE_SKILL_DIR}/scripts/review-depth.mjs" --base "$B" --head "$H"`, adding `--door <one-way|two-way>` when the caller gave one. Read `references/depth.md` for what light and deep change.
3. **Merge.** `CATALYST_REVIEW_AUTO_MERGE=false` means the pull request waits for a person after a clean review. Absent or any other value, it merges as usual.

## Steps 1–4: Review (record only, change nothing yet)

When the caller hands you review-step reports (a one-shot run), those are the steps they name: take each verdict and finding from its report, and do not run that skill again. A step with no report and a reason it does not apply gets `SKIPPED`. Otherwise run each skill by name with base `B`. Each one sits beside this skill, at `../<name>/SKILL.md`: read that file and every reference it names before its step and follow it. A step you did not run through its skill gets the verdict `SKIPPED` with the reason, never `PASS`, and a finding's `source` names a skill only when that skill produced it. Turn each verdict into a `gates` entry and each finding into a `findings` entry numbered F1, F2, …, with `source` naming the skill and the lens or pattern.

1. **Acceptance criteria:** when a validate stage already judged them (its `validation.md` sits beside the plan), record the gate `plan-conformance` as `SKIPPED` with the detail "the validate stage ran this" and go on. Otherwise, for each `AC<n>` in the plan you were given, find its proof (the named test or command) and confirm it passes at `H`. Record one `conformance` entry per criterion, under the gate `plan-conformance`. A criterion with no passing proof is a finding. Read `deviations.json` beside the plan first: a recorded deviation with evidence is not a finding. With no plan, the gate is `SKIPPED` with `no_plan_found`.
2. **Defects:** `review-code`.
3. **TypeScript:** `validate-type-safety` when the diff touches `.ts`, `.tsx` or a tsconfig, under its validate-stage rules (record, never fix; reuse the pull request's CI at `H`). It applies the `scan-reward-hacking` skill, a checklist with no script, with base `B`.
4. **Security:** `review-security`, always when deep; when light, only if the diff touches a surface `references/depth.md` lists.

## Step 5: Verify, then fix, once

Read `${CLAUDE_SKILL_DIR}/assets/references/resolving-review-findings.md` and follow it for every finding: classify it, reproduce it before calling it valid, make the smallest fix, add one regression test. Commit each valid finding's fix on its own, naming the finding id in the message. Do not push.

## Step 6: Re-check the fix range only

With `F` as the new head:

- run each regression test: it fails with its fix reverted and passes with the fix in place;
- apply the `scan-reward-hacking` skill with base `H`, so your own fixes face the same rules;
- run `review-code` on `H..F` under its re-validate bar. In a one-shot run the coordinator runs this one in its own session and records the `recheck` gate, so leave it out.

There is no second loop. A new finding from this step is `deferred` with a follow-up ticket, or `needs-human`. A deep review also needs a second opinion from another model family; `references/depth.md` says how.

## Step 7: Write the result

Never write `review-result.json` yourself. Write your draft (the fields of `references/result-schema.md` you decided: `pr`, `reviewed_head`, `base`, `depth`, `gates`, `conformance`, `findings`, `models` and the rest) to a file of your own, then record it:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/record-result.mjs" --draft <draft.json> [--out <path the caller named>]
```

It writes `review-result.json` to `--out`, else to `$CATALYST_ARTIFACT_DIR`, else prints it. It fills in `final_head` from the checkout when the draft has none, the `steps` each review session ran and when, the `summary` counts, and `recorded`, and writes a seal beside the file. A gate refuses a result with no seal, or one edited after it was recorded: to change it, edit the draft and record again. Record in `models` the model you ran as for each role.

- **A cloud run** makes no GitHub call. The cloud pushes the fix commits, posts the review at `H`, replies to and resolves each fixed thread, and refuses a result that breaks a rule in the schema reference.
- **Elsewhere,** print the summary and leave the fix commits unpushed for the person to review.

## `--recheck <review-result.json>`

This is the second opinion on a deep review. Read the file, re-run Step 6 on `reviewed_head..final_head` without fixing anything, add a `second-opinion` entry to `models` and your gates in a copy of the file, and record that copy with `node "${CLAUDE_SKILL_DIR}/scripts/record-result.mjs" --draft <copy> --out <the file>`. A defect you find becomes `needs-human`.

## Boundaries

- Each finding cites a line the diff touched. Leave a cleanup edit with no finding behind it out of the fix commits.
- This skill never resolves a thread, requests a review or merges. A decision only a person can make goes through the rulebook's escalation rule, never a second loop.
