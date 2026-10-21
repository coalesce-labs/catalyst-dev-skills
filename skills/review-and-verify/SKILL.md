---
name: review-and-verify
description: "Review a pull request at one exact head, fix what is valid, and prove the fixes, in one pass. Runs the existing review skills by name (validate-plan for plan conformance, review-code, validate-type-safety with its reward-hacking scan, review-security), verifies every finding before fixing it, commits one fix per valid finding, re-checks only the fix range, and writes one review-result.json that the cloud posts as a GitHub review. Chooses light or deep from the paths the change touches, and honours CATALYST_REVIEW_AUTO_MERGE=false by making the pull request wait for a person. Use when dispatched as a review phase, or when the user says 'review and fix this PR', 'review-and-verify', 'review it and fix what you find'. Not for answering someone else's review comments (review-comments) or fixing a failed validate (remediate-plan)."
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
argument-hint: "[PR-number] [--recheck <review-result.json>]"
version: 1.0.0
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

Run each skill by name with base `B`. Turn each verdict into a `gates` entry and each finding into a `findings` entry numbered F1, F2, …, with `source` naming the skill and the lens or pattern.

1. **Plan conformance:** `validate-plan`, its plan-conformance step only, when a plan exists for the ticket. Without one, the gate is `SKIPPED` with `no_plan_found`.
2. **Defects:** `review-code`.
3. **TypeScript:** `validate-type-safety` when the diff touches `.ts`, `.tsx` or a tsconfig, under its validate-stage rules (record, never fix; reuse the pull request's CI at `H`). It runs `scan-reward-hacking --base "$B"`.
4. **Security:** `review-security`, always when deep; when light, only if the diff touches a surface `references/depth.md` lists.

## Step 5: Verify, then fix, once

Read `${CLAUDE_SKILL_DIR}/assets/references/resolving-review-findings.md` and follow it for every finding: classify it, reproduce it before calling it valid, make the smallest fix, add one regression test. Commit each valid finding's fix on its own, naming the finding id in the message. Do not push.

## Step 6: Re-check the fix range only

With `F` as the new head:

- run each regression test: it fails with its fix reverted and passes with the fix in place;
- run `scan-reward-hacking --base "$H"`, so your own fixes face the same rules;
- run `review-code` on `H..F` under its re-validate bar.

There is no second loop. A new finding from this step is `deferred` with a follow-up ticket, or `needs-human`. A deep review also needs a second opinion from another model family; `references/depth.md` says how.

## Step 7: Write the result

Write `review-result.json` in the shape `references/result-schema.md` gives: to `$CATALYST_ARTIFACT_DIR` when it is set, else to the path the caller named, else print it. Record in `models` the model you ran as for each role.

- **A cloud run** makes no GitHub call. The cloud pushes the fix commits, posts the review at `H`, replies to and resolves each fixed thread, and refuses a result that breaks a rule in the schema reference.
- **Elsewhere,** print the summary and leave the fix commits unpushed for the person to review.

## `--recheck <review-result.json>`

This is the second opinion on a deep review. Read the file, re-run Step 6 on `reviewed_head..final_head` without fixing anything, add a `second-opinion` entry to `models` and your gates, and write the file back. A defect you find becomes `needs-human`.

## Boundaries

- Each finding cites a line the diff touched. Leave a cleanup edit with no finding behind it out of the fix commits.
- This skill never resolves a thread, requests a review or merges. A decision only a person can make goes through the rulebook's escalation rule, never a second loop.
