# Cloud PR wait evals

From a source checkout of `catalyst-dev-skills`, run:

```bash
bun test tests/pr-cloud-events.test.mjs
```

The shared runner also runs these cases through `bun run test`. `evals.json` holds the prompts, input events and expected outcomes. The tests execute the published Bash example with command doubles for the cloud CLI, GitHub and sleep. They record commands, count authoritative PR reads, and verify that an available cloud connection never sleeps. A separate merge-only example verifies the ticket filter.

These are offline acceptance evals. They verify the agent's documented commands and decisions, including merge/close, CI/review wakes and unavailable-cloud fallback. They do not measure live cloud delivery latency or create credentials. When evaluating an agent response manually, check its commands against the same prompt and expected outcomes.
