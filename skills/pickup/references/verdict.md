# The verdict and the report

`pickup.mjs verdict` applies these rules to the facts, in this order. The first that matches decides.

| facts | verdict | why |
| -- | -- | -- |
| the pull request merged | `done` | the work landed. Report it, release the lease, and stop |
| the pull request was closed without merging | `restart` | someone decided against that branch; building on it repeats the decision |
| no branch on `origin` names the ticket | `restart` | there is nothing to continue from |
| a branch with no pull request and no commits beyond its base | `restart` | the branch holds no work |
| anything else | `continue` | the branch holds work; the reason lists what to do first |

A `continue` reason names, when they apply:

- the unresolved review threads, which you answer before new work;
- a conflict with the base, which you resolve by merging the base first;
- a branch that moved after the handoff recorded its head, so the handoff describes an older state and `resume-handoff`'s verification decides what still holds;
- no handoff, so the commits, the pull request and the documents are all there is;
- other branches that also name the ticket, which you mention and leave alone.

## When your reading overrides the script

The script reads git and the pull request; you have also read the handoff and the ticket. Override it only for a reason one of those states in words, and give that reason in the report:

- The handoff or the ticket says the branch was abandoned or the approach rejected: `restart`, even with a live branch.
- The ticket was re-scoped so the branch no longer matches it: `restart`.
- `resume-handoff` found the branch broken in a way the handoff does not explain: still `continue`, with the breakage as the first item. A broken branch is work to fix, not a reason to throw the work away.

Never `restart` because the branch is old, or because its commits are not yours.

## Restarting

A restart leaves the old branch and pull request as they are: you did not create them, and a person may want them. Start a new branch from the base, name the old branch and pull request in your first commit message or pull request body, and renew the lease with that first commit.

## The report

Print it, and when the run is attended, wait for the person's go before you start the work:

```text
ticket:   <ID>, lease generation <G>, live until <ISO time>
before:   <previous holder>, last progress <lastProgress> at <time>
branch:   <name> at <short sha>, <N> commits beyond <base>   (or: none)
pull:     #<n> <open|draft|merged|closed>, <N> unresolved threads   (or: none)
handoff:  <path>   (or: none)
verdict:  <continue|restart|done>, because <reason>
next:     <the first concrete step>
```

When the take was refused, the report is the take's own lines and nothing else:

```text
ticket:   <ID>
lease:    held by <holder> until <ISO time>
loaded:   nothing; changed: nothing
```
