# Unsticker evals

`evals.json` holds cases built from real stuck asks, anonymized. Each case is what a triage run reads (the ask and subject rows from the replica, and the evidence snapshot), plus an optional `checkout` block with what a run with a writable checkout of the branch would also see. Each case's `expected` block is the right answer, established from what actually unstuck the ticket, and `answer_confidence` says how sure that answer is.

From a source checkout of `catalyst-dev-skills`:

```bash
node skills/unsticker/evals/run.mjs --out /tmp/unsticker-run        # one model call per case, no tools
node skills/unsticker/evals/grade.mjs /tmp/unsticker-run            # exit 0 at 90% or better with every stale field named
bun test tests/unsticker-evals.test.mjs                             # the cases, the grader and the runner, offline
```

`run.mjs` calls `claude -p` with the model `--model` names (default `sonnet`, the triage job's model) and prints the cost it reports. Set `UNSTICKER_EVAL_CMD` to use another model command. `--with-checkout` adds the checkout block, which tests the fixing path in [`../references/fix.md`](../references/fix.md). `--skill-dir` runs an older copy of the skill, for a before-and-after score.

The grader scores two halves per case. The recommendation: the class, the `next_steps`, the ask option, whether it reaches a person, the specifics the evidence names, and the round table for rounds that changed no code. The stale evidence: every stale field the case plants must appear in `stale_evidence`. Add a case each time a real ask was triaged wrong, with its right answer and the evidence that settled it.
