# Unsticker evals

`evals.json` holds cases built from real stuck asks, anonymized. Each case is what a triage run reads (the ask and subject rows from the replica, and the evidence snapshot), plus an optional `checkout` block with what a run with a writable checkout of the branch would also see. Each case's `expected` block is the right answer, established from what actually unstuck the ticket, and `answer_confidence` says how sure that answer is.

From a source checkout of `catalyst-dev-skills`:

```bash
node skills/unsticker/evals/run.mjs --out /tmp/unsticker-run        # one model call per case, no tools
node skills/unsticker/evals/grade.mjs /tmp/unsticker-run            # exit 0 at 90% or better with every stale field named
bun test tests/unsticker-evals.test.mjs                             # the cases, the grader and the runner, offline
```

`run.mjs` calls `claude -p` with the model `--model` names (default `sonnet`, the triage job's model) and prints the cost it reports. Set `UNSTICKER_EVAL_CMD` to use another model command. `--with-checkout` adds the checkout block, which tests the fixing path in [`../references/fix.md`](../references/fix.md). `--skill-dir` runs an older copy of the skill, for a before-and-after score.

A call whose model command fails (it reports an error, exits non-zero or cannot start) writes no record and prints `error <case-id>: <message>`. The run exits 1 when some calls failed and 3 when all did, so a model that never answered is not read as a score of zero. Each run also writes `run.json` next to the records: the model, the skill directory, a sha256 of the skill's files, the number of calls and failures, and the reported cost. Quote a score with its `run.json`.

The grader scores two halves per case. The recommendation: the class, the `next_steps`, the ask option, whether it reaches a person, the specifics the evidence names, and the round table for rounds that changed no code. For those rounds the record must name each platform cause the case lists (in a round's cause or evidence, or in `root_cause`) and lead with a mechanical step: `merge-main`, `review-at-head`, `rerun-validate`, `release-lever` or `wait`. The stale evidence: every stale field the case plants must appear in `stale_evidence[].field`; naming it only in `said` does not count. The report lists each stale case with the field that named it, and any stale entries the case did not plant, which are shown and never penalized (`--json` carries the same data as `staleReport`). Add a case each time a real ask was triaged wrong, with its right answer and the evidence that settled it.
