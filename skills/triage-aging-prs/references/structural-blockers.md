# Structural blockers (Step 1)

Answer one question before any review work: can these PRs merge at all? Run all four checks.

## 1a. What does the branch actually require?

```bash
gh api "repos/$REPO/rules/branches/$BASE" --jq '.[]|"\(.type) (ruleset \(.ruleset_id))"'
# ONLY the rulesets this branch actually evaluates. A repo may also hold disabled
# rulesets, or ones targeting tags/other branches, whose rules never apply here —
# printing them identifies requirements that do not exist.
for id in $(gh api "repos/$REPO/rules/branches/$BASE" --jq '[.[].ruleset_id]|unique|.[]'); do
  gh api "repos/$REPO/rulesets/$id" --jq '.rules[]|select(.type=="required_status_checks")|.parameters'
  gh api "repos/$REPO/rulesets/$id" --jq '.rules[]|select(.type=="pull_request")|.parameters'
done
```

Two traps:

- **Rulesets vs classic protection.** A 404 "Branch not protected" from `branches/$BASE/protection` does not mean unprotected: modern repos use Rulesets. `/rules/branches/$BASE` reports what actually applies.
- **Thread resolution lives inside `pull_request`.** `required_review_thread_resolution` is a parameter of the `pull_request` rule, not a rule type. Read the parameters, or you will wrongly conclude threads don't block.

## 1b. Compare a fork PR's checks against a base PR's

```bash
gh pr view <BASE_PR> --repo "$REPO" --json statusCheckRollup --jq '[.statusCheckRollup[]?|(.name//.context)]|sort'
gh pr view <FORK_PR> --repo "$REPO" --json statusCheckRollup --jq '[.statusCheckRollup[]?|(.name//.context)]|sort'
```

**The fork gate.** GitHub withholds repository secrets from fork PR workflows, so a check that needs a credential (a deploy preview, a cloud-provider integration) never runs on a fork. Its check is absent, not failing. If it is required, every fork PR is permanently unmergeable. Detect it by the check missing from the fork's rollup while present on a base PR.

Remedies, in order of preference:

1. Give the contributor write access, so future branches are in-repo and get the token.
2. Migrate existing heads to base-repo branches.
3. Temporarily remove only the offending context from `required_status_checks`. Ask the user first, back the ruleset up, and record how to restore it:

   ```bash
   BLOCKER="Cloudflare Pages"   # the fork-incompatible check, whatever it is called here
   gh api "repos/$REPO/rulesets/$ID" --jq '{name,target,enforcement,conditions,bypass_actors,rules}' > backup.json
   # Drop ONLY that context. Keep the rule, its other contexts, and the strict policy.
   jq --arg b "$BLOCKER" '
     .rules |= map(
       if .type == "required_status_checks"
       then .parameters.required_status_checks |= map(select(.context != $b))
       else . end)' backup.json > relaxed.json
   gh api -X PUT "repos/$REPO/rulesets/$ID" --input relaxed.json   # restore: --input backup.json
   ```

   Keep the `required_status_checks` rule itself. Deleting it disables every other required check and the `strict_required_status_checks_policy` beside them, turning a targeted unblock into a repo-wide gate outage that is easy to forget. The surgical form stays correct even when the blocker is the rule's only context, because someone may add a second check later. Removing one context keeps the strict policy, so merges keep serializing; say in the report which you did.

   Merge through the gate, never with `--admin`: that bypasses it silently, per PR.

## 1c. Is the automated reviewer actually firing?

A PR with zero review signal is unreviewed, not clean.

```bash
gh api "repos/$REPO/pulls/<N>/reviews"  --jq '[.[]|select(.user.login|test("bot|codex|copilot";"i"))]|length'
gh api "repos/$REPO/issues/<N>/comments" --jq '[.[]|select(.user.login|test("bot|codex|copilot";"i"))]|length'
gh api "repos/$REPO/issues/<N>/reactions" -H "Accept: application/vnd.github.squirrel-girl-preview+json" \
  --jq '[.[]|select(.user.login|test("bot|codex|copilot";"i"))|.content]'
```

Reviewer signals are spread across reviews, issue comments and reactions:

- `+1` on the PR description is the no-findings clean pass.
- `eyes` means acknowledged or in progress. It is not a verdict; do not merge on it.
- Review threads with severity badges are findings.

A connector switched to request-only reviews nothing until asked. Request once for a PR that has never been reviewed (`@codex review` or the repo's equivalent), and never after a remediation push (reference rule 10).

## 1d. Is the base branch itself green?

```bash
gh run list --repo "$REPO" --branch "$BASE" --limit 8 --json conclusion,headSha --jq '.[]|"\(.headSha[0:8]) \(.conclusion)"'
```

A red base turns every branch red, and you will blame your own diff. Fix or ticket it first, and record the failing test names so you recognise them later.
