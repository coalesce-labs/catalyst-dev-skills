# Guards and instruments — an output must say what it knows about its own subject

⭐ **The thesis this whole skill rests on.** A clean-looking zero, a green guard on a PR it does not cover, and an ask printing three identical options are **the same defect**: an output confidently shaped like an answer while carrying no information about its own subject. Everything else here is that rule with a named instrument.

## RULE 1 — authoring a guard

**A guard asserts on what IDENTIFIES the thing** — a marker, a path, an exported constant — **never on a number, a version string, or an output format that can drift underneath it.**

**And any guard that CAN fail on a PR it does not cover must name, in its own failure message: the guard, the cause class, and the observed bytes.** A red check whose message does not say why costs a hosted re-run plus a human diagnosis, every time, on work unrelated to the guard.

Four shapes of guard that redden unrelated PRs:

| what it asserted on | how it drifted |
| -- | -- |
| `script.includes("4860")` — a **timeout number** used to identify an installer delivery | any commit sha containing `4860` matched. A 4-hex-digit substring has ~37 positions in a 40-char sha, so ≈1 in 2,000 commits trips it by coincidence. The fix asserts on an exported marker constant — *what the delivery is* — with the coincidental-sha case added as an explicit false-positive test |
| an image **size floor** | measured in a unit that later changed |
| `JSON.parse(turbo --dry=json)` — an **output format** | broke when `"Shutting down..."` appeared on stdout |
| guards encoding the `actions/cache` **v4 shape** | the shape moved |

**The pattern:** each asserted on something *correlated* with the thing (a timeout, a size, a format, a version) rather than the thing. Correlations drift; identities do not.

## RULE 2 — reporting a measurement

**No Actions cost or minute figure is reported without a positive control on a day known to be expensive.**

⛔ **`GET /actions/runs/{id}/timing` can return billable ZERO for completed runs.** Check it against the jobs API for the same run: when the jobs API shows a job that ran for 11 seconds on `ubuntu-latest` and `billable.UBUNTU.total_ms` reads `0`, the timing figure is wrong, not the job.

⚠️ **What makes the zero convincing is that everything else about the response is right.** The job *count* is correct, and it correctly excludes `self-hosted` jobs as non-billable. Only the durations are zero. A response that got the shape wrong would be caught; this one fails **low and clean**.

**Other Actions instruments fail low and clean too:** repo-wide `/actions/runs` truncates above ~1000 runs/day, and `push_events` is multi-repo. Treat an Actions number as inconclusive until a control says otherwise.

**The working method:** the **jobs API** — `ubuntu-latest` bills, `self-hosted` is free, **ceil per job** (a 10-second job bills a full minute) — reconciled against the billing API.

⚠️ A guard that writes its number only to `$GITHUB_STEP_SUMMARY` leaves **no greppable trace on a pass**, because no REST endpoint can read a step summary. A measurement that only renders on the run page is not a measurement anyone can audit later.

## Rule 3 — prove the passing runs EXECUTED the suite before calling a failure intermittent

⛔ **A skipped or not-run gate is UNKNOWN, never a pass.** Before computing any flake rate, partition the "passing" heads into **ran** vs **skipped**, and read the gate's own run/skip line — never the badge.

**Worked example.** A privileged fixture failure looked intermittent — it failed on some runners and rarely on others, and the ratio suggested a flaky substrate worth an expensive CI routing change. It was a **deterministic regression**: every job that actually ran the fixture after the regressing merge failed. Every "green" run carried `"run": false` in its log, because a relevance gate skipped the suite on PRs that did not touch its inputs. **The substrate ratio was tracking which files each PR touched, not which substrate was flaky.**

⚠️ **How a bad measurement like that survives review:** every number in it is real. The runs exist, the pass/fail labels are accurate, the ratio is computed correctly. The only defect is that half the denominator never executed the code under test.

**Same family as the turbo-replay rule:** a green `Check` can be a replayed cache log, where the hash never moved, turbo replays an old pass and prints ✓. In both cases the instrument reports green **without doing the work** — which is this skill's thesis in its CI form.

⛔ **A merge queue can have this hole too.** A queue rule that matches `or: [check-success=<gate>, check-skipped=<gate>]` for a gate is satisfied by a SKIPPED duplicate: a draft→ready transition leaves two check runs per gate on one sha, so a PR can merge with its real run red. Until the rule requires success, "a green, thread-free PR self-enqueues" means *green or skipped*, and skipped is not green.
