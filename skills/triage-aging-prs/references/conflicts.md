# Resolving conflicts (Step 4)

Resolve each conflict by reading it; a blanket `--ours` or `--theirs` loses work.

| Situation                                                                      | Resolution                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Both sides added different items (imports, CI test lists, doc sections, tests) | Union. Dropping either side silently removes coverage.  |
| One side duplicates what the other has (a second `push:` key)                  | Drop the duplicate; keeping both can be invalid syntax. |
| Genuine semantic conflict                                                      | Read both, decide, and explain in the commit message.   |

Re-validate after resolving: `bash -n`, `node --check`, a YAML parse, and the file's own test suite. A union that produces a duplicate YAML key breaks CI for everyone.
