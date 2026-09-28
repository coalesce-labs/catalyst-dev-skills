# Moving tickets through workflow, and searching

## Adding comments

Comments go out as the tenant's Catalyst app actor, which the cloud never mistakes for a person deciding something. Never post as the person.

1. Determine which ticket, from the conversation or with `catalyst-skills query issue <ID>`. That one read returns the comments, so you can see what has already been said.
2. Keep comments concise (about 10 lines). Lead with the key insight. Reference files with backticks and GitHub links, for both `thoughts/` and code files.
3. Post it. A one-line body takes `--body`; anything longer goes on stdin:

   ```bash
   catalyst-skills write comment ENG-123 --stdin < /path/to/comment.md
   ```

   Reply inside a thread with `--parent <commentId>`. A machine record (a status note, a log line) takes `--bookkeeping`, which prefixes the tenant's bookkeeping marker. A decision for a human is an ask, not a comment.

   Example body:

   ```markdown
   Implemented retry logic in webhook handler to address rate limit issues.

   Key insight: The 429 responses were clustered during batch operations, so exponential backoff
   alone wasn't sufficient - added request queuing.

   Files updated:
   - `src/webhooks/handler.ts` ([GitHub](link))
   ```

## Moving tickets through workflow

1. Read the ticket's current state with `catalyst-skills query issue <ID>`.
2. Move it by slot, only when the person asks: `catalyst-skills write state <ID> --slot <slot>`. The slots are `dispatch`, `intake`, `research`, `plan`, `implement`, `remediate`, `verify`, `review`, `pr`, `done` and `canceled`; `--state-type backlog` parks a card.
3. The CLI refuses a slot the team has not mapped, and a mapped state that no longer exists in Linear. Report the refusal line as it stands; fixing the map is a tenant settings change, not a retry.
4. On a tenant, Catalyst moves cards itself as its phases run. The phase commands (`/research-codebase`, `/create-plan`, `/implement-plan`, `/create-pr`, `/merge-pr`) do not move a tenant card through this skill.

## Searching for tickets

1. Gather criteria: query text, team, state.
2. `catalyst-skills query search <terms>` matches identifiers, titles and names across tickets, PRs, projects and initiatives. `catalyst-skills query issues --team <KEY> --state <name>` lists a team's tickets; add `--all` to follow the page cursor to the end, because a read without it can stop at the first page and says `truncated at N of M` when it does.
3. Present the ticket ID, title, state and a direct link.
