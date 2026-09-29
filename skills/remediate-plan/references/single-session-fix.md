# Single-session fix: reading validate-plan's output

## Where the report comes from

`validate-plan` writes no file: its "Write the Validation Report" step renders the report as its response. In a laptop session, that report in the conversation is the artifact, so the same-session mode reads it from context. In the cloud, a failed validate phase's `validation.md` is persisted, and a later remediate dispatch materializes it to a local file whose path the dispatch prompt names. Either way, take the report's schema from the `validate-plan` skill itself.

## Worked example (same-session mode)

A validate-plan run reports a failing test suite in `packages/schema` and a missing index on a new foreign key, with a `file:line` pointer. `remediate-plan`'s pass:

1. Classify: both findings sit on FAILED steps. The failing tests reproduce locally (`valid`, F1). Reading the migration at the named file:line confirms the missing index (`valid`, F2). A plan-only note under a PASS step is left alone.
2. Edit the migration to add the index; fix whatever the failing tests actually assert.
3. Re-run the targeted gate for the touched workspace only; the full suite is the re-run validate-plan's job (SKILL.md step 6). Print its `exit 0`.
4. Commit: `fix(schema): PROJ-123 remediate validate-plan findings (missing index, failing tests)`.
5. Re-run the `validate-plan` skill against the same plan (local only). A clean report, with no failing gates and the findings gone, is the evidence the fix worked; this skill's own claim is not.

The fresh-session (cloud) mode runs the same pass, reading the report from the file the dispatch prompt names.

## Inside an automated run

A workflow that runs research → plan → implement → validate may add a remediate step after validate. A local worker runs this skill in the same session as the validate-plan run whose report it fixes: it has no persisted report to hand to a background job, so read → fix → re-verify completes in one invocation. A cloud remediate session starts with the persisted report on disk and runs the same cycle from that file.
