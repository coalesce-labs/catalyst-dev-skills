# Depth: light or deep

A change is **deep** when it is a one-way door: hard to undo once merged, such as a migration, a deploy or auth path, or the gates themselves. Every other change is **light**. `scripts/review-depth.mjs` decides, and records its reason in `depth_reason`.

## Where the one-way paths come from

1. **The caller's door.** A cloud run already knows the pull request's door and passes it as `--door one-way` or `--door two-way`. That wins.
2. **The repository's declaration.** `[review] one_way_paths` in `.catalyst/catalyst.toml`: a list of JavaScript regular expressions matched against each changed path. A first declaration replaces the default list below, and it applies once an admin approves it.

   ```toml
   [review]
   one_way_paths = [
     '^db/migrations/',
     '^\.github/workflows/deploy\.yml$',
     '^src/(?:auth|billing)/',
   ]
   ```

3. **The default list**, when the repository declares nothing: migrations, a Prisma schema, GitHub workflows, Dockerfiles, Wrangler config, Terraform, `install.sh`, `auth`/`crypto`/`billing`/`payments` directories, and `.mergify.yml`. The script prints each match.

It fails closed. An empty change list is deep, and so is a declaration it cannot read or one the cloud would refuse: no entries, more than 32, a repeated entry, or an entry that is empty, longer than 2048 characters or not a valid regular expression.

## What each depth changes

| | Light (two-way) | Deep (one-way) |
|---|---|---|
| `review-code` | default run | default run |
| `review-security` | only on a sensitive surface (below) | always |
| tests after a fix | the regression test and the tests beside it | those, plus the full suite of each package the diff touches |
| second opinion | none | a different model family re-checks the fixes (`--recheck`) |
| a migration defect | n/a | `needs-human`, unless the fix only adds and the migration's own test covers it |

Deep changes only which skills run and how far; the techniques stay in those skills.

**Sensitive surfaces (light runs `review-security` on these):** request handlers and routes, authentication and permission checks, database queries, shell or process execution, file paths built from input, HTML output, and anything that reads or writes a secret.

## The second opinion

A deep review is not finished until a model from another family has re-checked the fixes. The model that fixed cannot do it. Diversity of models, not personas, is the check.

- **In a cloud run** the cloud starts the second opinion itself: it runs this skill with `--recheck` on another family and posts once both are in the file.
- **Elsewhere,** hand `review-result.json` to an agent on another model family and ask it to run `review-and-verify --recheck review-result.json`.

The second opinion never fixes. A defect it confirms becomes `needs-human`, and the pull request waits.

## Waiting for a person

`CATALYST_REVIEW_AUTO_MERGE` decides whether a clean review lets the pull request merge. Declare it in `.catalyst/catalyst.toml` and set its value on the repository's or the workspace's Environment variables tab:

```toml
[[environment.variables]]
name = "CATALYST_REVIEW_AUTO_MERGE"
required = false
```

- **Absent, or any value but `false`:** `merge.auto` is `true`, and a clean review lets the pull request merge.
- **`false`:** `merge.auto` is `false`, with the reason. The review is still posted, as a comment, and it does not count as a passing review, so the pull request waits until a person approves it.
