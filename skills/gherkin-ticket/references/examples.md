# Worked examples

## Titles: implementation-first → outcome-first

| Implementation-first | Outcome-first |
|---|---|
| `Wire HRW ownership + claim into monitor dispatchTriage` | `The orchestrator should claim a ticket before triaging it so that two workers never grab the same job` |
| `Fix ENG-874 preflight label scope` | `catalyst-monitor preflight should pass in workspaces that have no team-level labels` |
| `Add stale-worker detection to dispatcher` | `The dispatcher should skip workers that have gone silent when assigning new work` |
| `Dashboard needs-attention banner` | `Humans should see an indication on the dashboard when something needs their attention so that they can react to it` |
| `Refactor: extract dispatchAndVerify` | `Developers should change dispatch-and-verify logic in one place so that the three sweeps can't silently diverge` |
| `Reap echo on already-gone bg session` | `The reaper should record an already-gone session as reaped so the daemon stops re-checking it every boot` |

The actor varies, and `so that` appears only where it adds information.

## Feature (Tier A)

> **Title:** Humans should be able to see which workers need assistance so that they can respond in time

```gherkin
Scenario: A blocked worker surfaces in the assistance list
  Given a phase worker has been waiting on an ask for 5 minutes
  When an operator opens the dashboard
  Then that worker appears in the "needs assistance" list
  And the list shows the ticket, the phase, and how long it has been waiting

Scenario: A worker drops off the list once unblocked
  Given a worker is shown in the "needs assistance" list
  When the operator answers its ask
  Then the worker disappears from the list without a page reload
```

## Backend API behavior (Tier A)

> **Title:** Integrating systems should have failed webhook deliveries retried so that a transient downstream error doesn't lose data

```gherkin
Scenario: A transient 503 triggers a backoff retry
  Given a webhook event is queued for delivery
  And the endpoint returns HTTP 503 on the first attempt
  When the retry scheduler evaluates the event
  Then a second attempt is scheduled with a 30-second backoff
  And the event is NOT yet marked as delivered

Scenario: An event is abandoned after five consecutive failures
  Given a webhook event has failed delivery four consecutive times
  When the fifth attempt also fails
  Then the event is marked "abandoned"
  And it is moved to the dead-letter queue
```

## Bugs (Tier B)

> **Title:** catalyst-monitor preflight should pass in workspaces that have no team-level labels

```gherkin
Scenario: Preflight passes when the workspace has no team-level labels
  Given the workspace defines labels only at the workspace scope
  And no labels are defined at the team scope
  When catalyst-monitor preflight runs
  Then the preflight check exits 0
  And no "label not found" error is emitted
  # CURRENTLY: preflight queries --team labels, returns "label not found", and the team starves
```

> **Title:** The daemon should not declare a live phase worker dead on its first commit

```gherkin
Scenario: A committing worker is left alone
  Given a --bg phase-implement worker has just made its first commit
  And its signal mtime is older than the stale-bg threshold
  When the reclaim sweep evaluates the worker
  Then the worker is left running
  And no implement-complete event is emitted on its behalf
  # CURRENTLY: reclaim fires implement-complete on the first commit, so verify runs on a partial branch
```

## Chore with an invariant (Tier C)

> **Title:** Developers should change dispatch-and-verify logic in one place so that the three sweeps can't silently diverge

```
Context: dispatchAndVerify() is copy-pasted across three scheduler sweeps.
Motivation: a timeout tweak in one copy leaves the other two wrong with no error.
Outcome: extract a shared dispatchAndVerify(); all three sweeps import it; behavior unchanged.

Scenario: Dispatch still waits for completion before returning  # invariant
  Given a task is eligible for dispatch
  When dispatchAndVerify is called
  Then the task is dispatched to a worker
  And the call does not return until a completion signal arrives or the timeout elapses
```
