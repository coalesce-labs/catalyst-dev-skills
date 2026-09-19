# Guards and instruments — an output must say what it knows about its own subject

⭐ **The thesis this whole skill rests on.** A clean-looking zero, a green guard on a PR it does not cover, and an ask printing three identical options are **the same defect**: an output confidently shaped like an answer while carrying no information about its own subject. Everything else here is that rule with a named instrument.

## RULE 1 — authoring a guard

**A guard asserts on what IDENTIFIES the thing** — a marker, a path, an exported constant — **never on a number, a version string, or an output format that can drift underneath it.**

**And any guard that CAN fail on a PR it does not cover must name, in its own failure message: the guard, the cause class, and the observed bytes.** A red check whose message does not say why costs a hosted re-run (~11 min) plus a human diagnosis, every time, on work unrelated to the guard.

**Measured 2026-09-18 — four guards reddened unrelated PRs in one day, and not one of the four messages named the cause:**

| guard | what it asserted on | how it drifted |
| -- | -- | -- |
| CTC-2628 (`apps/host-provision`) | `script.includes("4860")` — a **timeout number** used to identify the installer delivery | any sha containing `4860` matched. A 4-hex-digit substring has ~37 positions in a 40-char sha, so ≈1 in 2,000 commits trips it by coincidence. Fixed in #5145 (`754fccc10`) by asserting on `INSTALLER_DELIVERY_MARKERS` — *what the delivery is* — with the coincidental-sha case added as an explicit false-positive test |
| CTC-1169 | an image **size floor** | measured in a unit CTC-2554 changed. Fixed by CTC-2556 |
| CTC-2756 | `JSON.parse(turbo --dry=json)` — an **output format** | broke when `"Shutting down..."` appeared on stdout. PR #5183 |
| #5128 | four guards encoding the `actions/cache` **v4 shape** | the shape moved |

**The pattern:** each asserted on something *correlated* with the thing (a timeout, a size, a format, a version) rather than the thing. Correlations drift; identities do not.

## RULE 2 — reporting a measurement

**No Actions cost or minute figure is reported without a positive control on a day known to be expensive.**

⛔ **`GET /actions/runs/{id}/timing` returns billable ZERO for every run in this repo.** Independently reproduced 2026-09-18 across **three completed** Deploy runs — not merely an in-progress artifact, which was ruled out explicitly:

| run | `billable.UBUNTU.total_ms` | positive control — jobs API, same run |
| -- | -- | -- |
| 35376161861 | `0` (1 job) | "Plan deploys" 17:45:04 → 17:45:15Z = **11 s** |
| 35370292135 | `0` (5 jobs) | "Plan deploys" 16:45:01 → 16:45:18Z = **17 s** |
| 35368105014 | `0` (5 jobs) | "Plan deploys" 16:22:43 → 16:22:56Z = **13 s** |

⚠️ **What makes the zero convincing is that everything else about the response is right.** The job *count* is correct, and it correctly excludes the `self-hosted` / `fleet-x64` job as non-billable. Only the durations are zero. A response that got the shape wrong would be caught; this one fails **low and clean**.

**This is the THIRD Actions instrument that fails low and clean**, alongside repo-wide `/actions/runs` truncating above ~1000 runs/day and `push_events` being multi-repo. Treat an Actions number as inconclusive until a control says otherwise.

**The working method:** the **jobs API** — `ubuntu-latest` bills, `self-hosted` is free, **ceil per job** (a 10-second job bills a full minute) — reconciled against the billing API.

⚠️ A corollary already recorded elsewhere: a guard that writes its number only to `$GITHUB_STEP_SUMMARY` leaves **no greppable trace on a pass**, because no REST endpoint can read a step summary. A measurement that only renders on the run page is not a measurement anyone can audit later.

## Rule 3 — prove the passing runs EXECUTED the suite before calling a failure intermittent

⛔ **A skipped or not-run gate is UNKNOWN, never a pass.** Before computing any flake rate, partition the "passing" heads into **ran** vs **skipped**, and read the gate's own run/skip line — never the badge.

**Worked example, 2026-09-18, and it is the best one here.** A "Privileged fixture race" was classified as intermittent by **three** sessions, measured at *"5 of 9 on guests vs 1 of 13 hosted"*, and nearly triggered a $283/day CI routing flip. It was not intermittent. It was a **deterministic regression** from CTC-2625 (#5104): every job that actually ran the host-agent fixture after 16:44Z failed **14 of 14**. Every "green" run after it carried `"run": false` in its log, because the privileged relevance gate skipped the suite on PRs that did not touch its inputs. **The substrate ratio was tracking which files each PR touched, not which substrate was flaky.** Fixed by CTC-2762 (#5206, `80bc3c82b`).

⚠️ **How the bad measurement survived three reviewers:** every number in it was real. The runs existed, the pass/fail labels were accurate, the ratio was computed correctly. The only defect was that half the denominator had not executed the code under test.

**Same family as the turbo-replay rule:** a green `Check` can be a replayed cache log, where the hash never moved, turbo replays an old pass and prints ✓. In both cases the instrument reports green **without doing the work** — which is this skill's thesis in its CI form.

⛔ **The merge queue has this hole too.** `.mergify.yml` matches `or: [check-success=<gate>, check-skipped=<gate>]` for `Check`, `Check (full)` and `Privileged integration` (lines 135–163). A draft→ready transition leaves two check runs per gate on one sha, and the SKIPPED duplicate satisfies the condition — so **#5104 merged with its real Privileged run red**. `CTC-2773` (P1) is the gate fix. Until it lands, "a green, thread-free PR self-enqueues" means *green or skipped*, and skipped is not green.

## Attribution

Rules 1 and 2: concierge + github-actions-on-mini, 2026-09-18. Rule 3: concierge, 2026-09-18, from the Privileged-fixture investigation; also recorded as memory `a-green-privileged-job-can-be-a-relevance-skip-that-hid-a-deterministic-regression`. The `.mergify.yml` line numbers and the CTC-2762/CTC-2773 states were re-verified against `origin/main` before this was written down. Rule 2 is also recorded as memory `actions-runs-timing-returns-billable-zero-for-every-run-here`. The three-run reproduction and the in-progress control above are this drafter's own, run before the rule was written down.
