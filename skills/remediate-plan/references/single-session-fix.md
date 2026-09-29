# Single-session fix — reading validate-plan's actual output

## Where the report comes from

`validate-plan` writes no file. Read the `validate-plan` skill's own SKILL.md for its `allowed-tools` and its "Step 3: Generate Validation Report" section, which ends in a markdown block the skill renders as its own response. In a laptop session that block, sitting in the conversation, is the artifact — which is why the same-session mode reads it from context. A cloud runner makes the fresh-session mode possible: when a cloud validate phase fails, the runner persists the session's `validation.md`, and a later remediate dispatch materializes it back to a local file whose path the dispatch prompt names. Either way, do not re-derive validate-plan's report schema here; read it from the owning skill so this file never goes stale against it.

## Worked example (same-session mode)

A validate-plan run reports a failing test suite in `packages/schema` and a missing index on a new foreign key, with a `file:line` pointer. `remediate-plan`'s pass:

1. Classify: both findings sit on FAILED steps. The failing tests reproduce locally (`valid`, F1). The missing index is confirmed by reading the migration at the named file:line (`valid`, F2). A plan-only note under a PASS step is not chased.
2. Edit the migration file to add the index; fix whatever the failing tests actually assert.
3. Re-run the targeted gate for the touched workspace only (not the full monorepo suite — that is the re-run validate-plan's job, SKILL.md step 6). Print its `exit 0`.
4. Commit: `fix(schema): PROJ-123 remediate validate-plan findings (missing index, failing tests)`.
5. Re-run the `validate-plan` skill against the same plan (local only; a cloud round leaves re-validation to the pipeline). A clean report — no more failing gates, the bullets gone — is the only evidence the fix worked; this skill's own transcript claiming so is not.

The fresh-session (cloud) mode runs the same pass; the only difference is step 0 — the report is read from the materialized prior-artifact file the dispatch prompt names instead of from the conversation.

## Inside an automated run

A workflow that runs research → plan → implement → validate may add a remediate step after validate. In a local session, invoke this skill (`remediate-plan`) in the same session as the validate-plan run whose report you are fixing: a local worker has no persisted report to hand to a background job and cannot wait for one, so its read → fix → re-verify cycle completes in this one invocation. A cloud remediate session is the dispatched fresh-session mode instead: it starts with the persisted report already on disk and runs the same cycle from that file.
