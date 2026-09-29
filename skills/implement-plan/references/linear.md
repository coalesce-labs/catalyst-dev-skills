# Linear

This skill writes no ticket state. On Catalyst Cloud the cloud moves the ticket when a phase outcome is recorded and again when the PR merges, so a write from here, even from a later phase resolving PR feedback or fixing CI, pulls the card backwards.

A person who asks for a move uses `catalyst write state <ID> --slot <slot>` (the Cloud pack's `catalyst-linear` skill), or, off the cloud, an operator moves it with the Linearis CLI directly.

Inside a phase container (`CATALYST_PHASE` set) there is no Linear credential, and when `command -v linearis` fails the findings filer skips Linear and files through `gh`.
