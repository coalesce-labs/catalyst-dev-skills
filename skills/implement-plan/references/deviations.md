# Plan deviations

Follow the plan unless code evidence requires a departure. For each departure, write `thoughts/shared/plans/<TICKET-ID>/deviations.json` in the cloud-compatible shape:

```json
{"deviations":[{"plan_ref":"…","planned":"…","actual":"…","reason":"…","evidence":"…"}]}
```

Use one entry per departure. `plan_ref` names the plan step, `planned` and `actual` describe the expected and delivered changes, `reason` explains why the plan changed, and `evidence` gives a verifiable file, line, test, or command. When a main change forced the departure, include that full main commit SHA in `evidence`. Write no file when the plan was followed. Keep the file available for `validate-plan`.
