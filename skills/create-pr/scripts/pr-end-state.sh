#!/usr/bin/env bash
# pr-end-state.sh — who owns an open pull request after a create-pr run, as a record a command
# can check.
#
# The skill's closing steps (monitor, report, arm the branch waiter) are instructions, and a
# session can stop before it reaches them. This script makes the end state a fact on disk and
# sorts it into one of four answers. `check` prints the answer as the first word of its line.
#
#   FINISHED         the pull request is merged or closed. There is nothing to own.
#   HANDED-OFF       the pull request was sent to a ticket or a session through the message
#                    channel, and the message id and the channel's answer are on record. Only an
#                    answer that says someone will read it counts.
#   OWNED            a branch waiter started in this checkout is running for this pull request, the
#                    agent session on record as its reader is still alive to read its wake at its
#                    next turn, and this checkout is on the pull request's head.
#   NEEDS ATTENTION  anything else: no waiter could start (no ticket key, no catalyst CLI, no
#                    event cursor), the waiter ended, the session that armed it is gone or could
#                    not be named, the waiter is for another pull request or was started in another
#                    checkout, or the checkout is not on the head.
#
# A reason is not an owner. A pull request that NEEDS ATTENTION is never a finished, unattended
# run, whatever the reason says.
#
# Usage:
#   pr-end-state.sh record  REPO BRANCH PR [TICKET]
#   pr-end-state.sh handoff REPO BRANCH PR RECIPIENT MESSAGE ANSWER
#   pr-end-state.sh check   REPO BRANCH PR
#     REPO is owner/name. BRANCH is the local branch that owns the work. PR is its number.
#     TICKET is the ticket the wait listens on. Left out, record uses the ticket saved for this pull
#     request, so a re-run without it still compares the running wait with that ticket.
#     RECIPIENT is ticket:<KEY-123> or session:<id>, the address the message was sent to.
#     MESSAGE is the message id `catalyst inbox send` returned. ANSWER is the answer it gave:
#     next-turn or next-phase. An answer of undeliverable, a missing answer or a sentence about
#     why is refused, and the pull request stays NEEDS ATTENTION. A person who takes the pull
#     request by another route is named in the report; this record has no form for that.
#
# State is machine-local and not meant to be committed. It sits beside the waiter's own state, at
# the root of the checkout, wherever in the checkout a command runs:
# .catalyst/create-pr-end.json maps "owner/name:branch#pr" to one record, so two pull requests of
# one branch (the changes of a stack) keep a record each. One wait runs per branch, so at most one
# of them is OWNED through it. Nothing here makes Git ignore these files, so `git status` shows them
# as untracked until the checkout ignores them. A file of these names that the repository tracks,
# in any case of its letters, is repository content: nothing is read from it or written to it.
#
# One repository has one identity. GitHub reads Acme/Widget and acme/widget as the same repository,
# so records, the waiter's state and its running wait are matched on the repository's name without
# case and on the branch exactly. An entry keeps the spelling it was saved under. Two entries for
# one identity under different spellings are refused until one is removed.
#
# Exit codes:
#   0  record, handoff: the record was written (read the line: it may say NEEDS ATTENTION).
#      check: FINISHED, OWNED or HANDED-OFF.
#   2  usage.
#   9  record, handoff: the pull request could not be read or the record could not be written,
#      so there is no record.   check: NEEDS ATTENTION, or the pull request could not be read.
#
# The arm function is not copied here. It is loaded from the waiter reference shipped beside this
# script, found by this script's own path, so the wait this script starts is the published one.
# An inherited CLAUDE_SKILL_DIR is not used for it: it can name another skill or an older copy.
#
# The owner of a waiter is the nearest ancestor process that is an agent session, by name
# (_PES_SESSION_NAMES). A terminal, a multiplexer, a login shell, an ssh daemon, an init process
# or a CI worker is never an owner: each outlives the session and reads nothing. A name cannot
# tell a session from a server, so a long-lived background process under one of those names is
# counted as a session, and so is a session that never takes another turn.
# PR_END_STATE_SESSION_NAMES replaces that list, and PR_END_STATE_OWNER_PID names the session's
# process outright, for a harness that runs under another name or a general runtime. Both are
# for the operator of the machine to set, never for a session to set for itself.
#
# Limits. The wait `record` starts holds one event connection until it wakes or times out
# (WAITER_TIMEOUT_SECONDS, four hours by default), also after the session that armed it has
# ended. This script does not stop it. `check` then says NEEDS ATTENTION, and the next arm on
# that branch starts nothing while the old wait runs.
# A handoff is the caller's statement. This script checks the form of the receipt (an address, a
# message id, an answer) and does not ask the channel whether that message exists.

END_STATE=".catalyst/create-pr-end.json"
WAITER_STATE=".catalyst/branch-waiter.json"
# WAITER_AFTER, WAITER_PENDING and WAITER_DUE are what a wake handler hands to the arm it calls. One
# left in the environment of this command is nobody's checkpoint: the arm here starts from the saved
# sequence, or from the head of the event stream on a first arm.
unset WAITER_AFTER WAITER_PENDING WAITER_DUE
# The skill this script is shipped in, from the script's own path. Made absolute here, before the
# command changes to the checkout root: a relative value read after that change would name a file
# inside the checkout, and the arm block is loaded from it with eval.
_PES_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd -P)" || _PES_SKILL_DIR=""
_PES_WAITER_REF="${_PES_SKILL_DIR}/assets/references/branch-waiter.md"
# This script by its path, for the commands it prints. Nothing puts it on PATH.
_PES_SELF="bash $(printf '%q' "$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/pr-end-state.sh")"
_PES_RC=9
_PES_SESSION_NAMES="${PR_END_STATE_SESSION_NAMES:-claude codex opencode cursor-agent gemini}"

_pes_say() { printf '%s\n' "$*"; }
_pes_warn() { printf '%s\n' "$*" >&2; }

_pes_usage() {
  _pes_warn "usage: pr-end-state.sh record REPO BRANCH PR [TICKET] | handoff REPO BRANCH PR RECIPIENT MESSAGE ANSWER | check REPO BRANCH PR (REPO is owner/name, PR is a number, RECIPIENT is ticket:<KEY-123> or session:<id>, MESSAGE is the id the send returned, ANSWER is next-turn or next-phase)"
  return 2
}

# _pes_pr REPO PR — prints "<open|merged|closed>|<head sha>|<owner/name as GitHub spells it>".
# Non-zero when the pull request cannot be read, so a failed read is never taken for a finished
# pull request.
_pes_pr() {
  local out
  command -v gh >/dev/null 2>&1 || return 1
  out="$(gh api "repos/${1}/pulls/${2}" --jq '(if .merged then "merged" else .state end) + "|" + (.head.sha // "") + "|" + (.base.repo.full_name // "")' 2>/dev/null)" || return 1
  case "${out%%|*}" in
    open | merged | closed) printf '%s\n' "$out" ;;
    *) return 1 ;;
  esac
}

# The four helpers below say what one waiter is: which state key, which running wait and which log
# belong to a repository and a branch. They mirror _bw_lc, _bw_pick, _bw_pat, _bw_slug and
# _bw_log_name of the waiter reference, which arms and stops by the same rules, so `check` needs
# no code loaded from that page. The controls arm with the page and read with these.
_pes_lc() { printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]'; }

# _pes_pick REPO REST < JSON object — prints the object's own key for REPO:REST. The repository's
# name is compared without case and the rest exactly. No such key prints REPO:REST as given. The
# same identity under two spellings prints nothing and fails.
_pes_pick() {
  local in out
  in="$(cat)"
  [ -n "$in" ] || in='{}'
  out="$(printf '%s\n' "$in" | jq -r --arg repo "$1" --arg rest "$2" 'if type != "object" then "\($repo):\($rest)" else [keys[] | select(split(":") as $p | ($p | length) > 1 and ($p[0] | ascii_downcase) == ($repo | ascii_downcase) and ($p[1:] | join(":")) == $rest)] | if length > 1 then "" elif length == 1 then .[0] else "\($repo):\($rest)" end end' 2>/dev/null)" || {
    printf '%s:%s\n' "$1" "$2"
    return 0
  }
  out="${out%%$'\n'*}"
  [ -n "$out" ] && printf '%s\n' "$out"
}

# _pes_pat — the pattern that finds this branch's wait in the process list, whatever case its
# repository was spelled in when it was armed.
_pes_pat() {
  printf '%s' "$_PES_REPO" | LC_ALL=C awk '{ o = ""; for (i = 1; i <= length($0); i++) { c = substr($0, i, 1); l = tolower(c); u = toupper(c); if (l != u) o = o "[" l u "]"; else if (index("][+.*?{}()|^$\\", c)) o = o "\\" c; else o = o c }; printf "%s", o }'
  printf ':%s' "$(printf '%s' "$_PES_BRANCH" | sed 's/[][+.*?{}()|^$]/\\&/g')"
}

_pes_slug() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'; }

# _pes_log_name — the name, inside .catalyst, of the log an arm writes for this branch: the readable
# slug, cut short, and a digest of the whole ref, so two branches never share a log.
_pes_log_name() {
  local sum
  sum="$(printf '%s:%s' "$(_pes_lc "$_PES_REPO")" "$_PES_BRANCH" | git hash-object --no-filters --stdin 2>/dev/null)" && [[ "$sum" =~ ^[0-9a-f]{40,}$ ]] || return 1
  printf 'waiter.%s.%s.log' "$(_pes_slug "$_PES_BRANCH" | cut -c1-80)" "${sum:0:32}"
}

# _pes_wait_pids — the waiter's own liveness check: the ref rides in the wait's command line.
_pes_wait_pids() {
  pgrep -f "catalyst events wait-for .* $(_pes_pat) " 2>/dev/null | grep -v "^$$\$"
}

_pes_live_waiter() { _pes_wait_pids | grep -q .; }

# _pes_untracked - the repository tracks none of the waiter's or the record's files. A tracked one is
# repository content, not this checkout's state, so nothing is read from or written to it. The names are
# matched without case: a filesystem that ignores case opens a tracked file of another case under them.
# A listing that fails (no checkout here, an unreadable index) proves nothing, so it refuses.
_pes_untracked() {
  local tracked
  tracked="$(git -c core.fsmonitor=false ls-files -- ':(icase).catalyst/branch-waiter.json' ':(icase).catalyst/waiter.*.log' ':(icase).catalyst/create-pr-end.json' 2>/dev/null)" && [ -z "$tracked" ]
}

# _pes_cat NAME - prints .catalyst/NAME as read from inside this checkout's own .catalyst, entered once and
# checked not to be a link elsewhere. A link at NAME reads as nothing, so no file outside the checkout is
# read as state or copied into it.
_pes_cat() {
  local root
  root="$PWD"
  _pes_untracked || return 0
  (cd -P "${root}/.catalyst" >/dev/null 2>&1 && [ "$(pwd -P)" = "${root}/.catalyst" ] && [ -f "$1" ] && [ ! -L "$1" ] && cat -- "$1") 2>/dev/null || true
}
_pes_state() { _pes_cat "${WAITER_STATE##*/}"; }
# _pes_isfile NAME - .catalyst/NAME is a file there, not a link, seen from inside this checkout's .catalyst.
_pes_isfile() {
  local root
  root="$PWD"
  _pes_untracked || return 1
  (cd -P "${root}/.catalyst" >/dev/null 2>&1 && [ "$(pwd -P)" = "${root}/.catalyst" ] && [ -f "$1" ] && [ ! -L "$1" ]) 2>/dev/null
}

# _pes_ids REPO BRANCH PR NAME — fixes the names this command works under. NAME is GitHub's own
# spelling of the repository, taken when it is REPO in another case. The waiter's state key and the
# record's key are the ones already saved for this identity, or the new spelling when none is.
# _PES_TWICE names the file that holds this identity under two spellings, which nothing here resolves.
_pes_ids() {
  _PES_REPO="$1"
  _PES_BRANCH="$2"
  _PES_PR="$3"
  _PES_TWICE=""
  [ -z "$4" ] || [ "$(_pes_lc "$4")" != "$(_pes_lc "$1")" ] || _PES_REPO="$4"
  _PES_REF="${_PES_REPO}:${2}"
  _PES_WKEY="$(_pes_state | _pes_pick "$_PES_REPO" "$2")" || { _PES_TWICE="$WAITER_STATE"; _PES_WKEY="$_PES_REF"; }
  _PES_EKEY="$(_pes_cat "${END_STATE##*/}" | _pes_pick "$_PES_REPO" "${2}#${3}")" || { _PES_TWICE="$END_STATE"; _PES_EKEY="${_PES_REF}#${3}"; }
}

# _pes_waiter_pr — the pull request number the waiter state holds for this branch, or nothing.
_pes_waiter_pr() {
  _pes_state | jq -r --arg ref "$_PES_WKEY" '.[$ref].pr // empty' 2>/dev/null || true
}

# _pes_waiter_entry — "PR|TICKET" for this branch from one read of the waiter state, so the pull
# request and the ticket its wait listens on belong to the same wait. Either may be empty.
_pes_waiter_entry() {
  _pes_state | jq -r --arg ref "$_PES_WKEY" '"\(.[$ref].pr // "")|\(.[$ref].ticket // "")"' 2>/dev/null || true
}

# _pes_cur_log — the name, inside .catalyst, of this branch's log, or nothing. An arm writes
# waiter.<slug>.<digest>.log and starts it with a "waiter-arm" line that names the repository and
# the branch; a file of that name whose first line names another is not this branch's. An older copy
# of the waiter wrote waiter.<slug>.log with no such line. That one is read as before, unless another
# entry of the waiter state maps to the same older name: then it cannot be told whose it is.
_pes_cur_log() {
  local new old k slug head
  new="$(_pes_log_name)" || new=""
  if [ -n "$new" ] && _pes_isfile "$new"; then
    head="$(_pes_cat "$new" | sed -n '1s/^waiter-arm //p')"
    if [ -n "$head" ]; then
      printf '%s' "$head" | jq -e --arg repo "$(_pes_lc "$_PES_REPO")" --arg branch "$_PES_BRANCH" '.repo == $repo and .branch == $branch' >/dev/null 2>&1 || return 0
    fi
    printf '%s\n' "$new"
    return 0
  fi
  slug="$(_pes_slug "$_PES_BRANCH")"
  old="waiter.${slug}.log"
  _pes_isfile "$old" || return 0
  case "$(_pes_cat "$old" | sed -n '1p')" in "waiter-arm "*) return 0 ;; esac
  while IFS= read -r k; do
    [ "$k" = "$_PES_WKEY" ] || [ "$(_pes_slug "${k#*:}")" != "$slug" ] || return 0
  done < <(_pes_state | jq -r 'keys[]' 2>/dev/null)
  printf '%s\n' "$old"
}

# _pes_log — the path of this branch's log for a line a person reads: the log there is, or the one
# the next arm writes.
_pes_log() {
  local name
  name="$(_pes_cur_log)"
  [ -n "$name" ] || name="$(_pes_log_name)" || name="waiter.$(_pes_slug "$_PES_BRANCH").log"
  printf '.catalyst/%s' "$name"
}

# _pes_log_text — the log's text when it is evidence about the wait the state names, read from inside
# this checkout's .catalyst; a link reads as nothing. A log an arm wrote says which pull request it was
# armed for, and the arm saves that pull request in the state before the wait starts. A log whose first
# line names another pull request than the state does was left by an earlier arm, when the arm after it
# saved its state and could not start its log: its exit and its wake say nothing about the pull request
# the state names now. With no entry in the state, the pull request asked about is the one compared.
# A log with no such line (an older copy's) names no pull request. An arm for another pull request
# records in the state which one left it, in the write that names the new one, so that log is not read
# as the new one's either. With no such record, or one that is not a whole positive number, it is
# read as before.
_pes_log_text() {
  local name text head want
  name="$(_pes_cur_log)"
  [ -n "$name" ] || return 0
  text="$(_pes_cat "$name")"
  head="$(printf '%s\n' "$text" | sed -n '1s/^waiter-arm //p')"
  if [ -n "$head" ]; then
    want="$(_pes_waiter_pr)"
    [ -n "$want" ] || want="$_PES_PR"
    printf '%s' "$head" | jq -e --arg pr "$want" '(.pr | tostring) == $pr' >/dev/null 2>&1 || return 0
  elif [ "$name" = "waiter.$(_pes_slug "$_PES_BRANCH").log" ]; then
    want="$(_pes_waiter_pr)"
    if [ -n "$want" ] && _pes_state | jq -e --arg ref "$_PES_WKEY" --arg pr "$want" '.[$ref].oldlog | type == "number" and . > 0 and . == floor and . != ($pr | tonumber)' >/dev/null 2>&1; then return 0; fi
  fi
  printf '%s\n' "$text"
}

# _pes_rc_line — the last exit line in that log, or nothing while its wait runs.
_pes_rc_line() { _pes_log_text | grep '^waiter-rc ' | tail -n 1; }

# _pes_failed_wait — the last wait on the log ended in an error (1, 2) or was refused by the
# cloud (3). A wait that ended without an event (124) or with a wake (0) is not one.
_pes_failed_wait() { case "$(_pes_rc_line)" in "waiter-rc 1" | "waiter-rc 2" | "waiter-rc 3") return 0 ;; esac; return 1; }

# _pes_unhandled_wake — the last wait on the log woke on an event (0) that nothing has handled. The
# wait writes the sequence it reached beside its exit, and the wake handler hands that sequence to the
# arm, which saves it before it starts the next wait. So a state that is still behind the log means
# the wake is unread. The log is then its only copy here, and an arm would replace it.
_pes_unhandled_wake() {
  local logged saved
  [ "$(_pes_rc_line)" = "waiter-rc 0" ] || return 1
  logged="$(_pes_log_text | sed -n 's/^cursor //p' | tail -n 1)"
  [[ "$logged" =~ ^[0-9]+$ ]] || return 1
  saved="$(_pes_state | jq -r --arg ref "$_PES_WKEY" '.[$ref].cursor // empty' 2>/dev/null || true)"
  [[ "$saved" =~ ^[0-9]+$ ]] || return 0
  [ "$logged" -gt "$saved" ]
}

# _pes_pending_retry — the waiter state holds a conflict retry that the wake handler left for later.
# The handler tries it once its due time has come, and until then waits only that long, so a plain arm
# would leave it waiting for the full timeout.
_pes_pending_retry() {
  local n
  n="$(_pes_state | jq -r --arg ref "$_PES_WKEY" '.[$ref].pending // 0' 2>/dev/null || true)"
  [[ "$n" =~ ^[1-9][0-9]*$ ]]
}

# _pes_retry_left - with a conflict retry pending, prints how long the wake handler would wait before
# trying it: the saved due time less now, at least 1 and at most WAITER_RETRY_SECONDS, as the handler arms.
_pes_retry_left() {
  local due now left retry="${WAITER_RETRY_SECONDS:-300}"
  _pes_pending_retry || return 1
  [[ "$retry" =~ ^[1-9][0-9]{0,8}$ ]] || retry=300
  due="$(_pes_state | jq -r --arg ref "$_PES_WKEY" '.[$ref].due // 0' 2>/dev/null || true)"
  now="$(date +%s)"
  [[ "$due" =~ ^[1-9][0-9]*$ ]] || due=$((now + retry))
  left=$((due - now))
  [ "$left" -ge 1 ] || left=1
  [ "$left" -le "$retry" ] || left="$retry"
  printf '%s\n' "$left"
}

# Compare directory identities. lsof escapes control characters in printed pathnames, even with -F0.
_pes_process_here() {
  local target fields device="" inode="" field here
  if target="$(readlink "/proc/$1/cwd" 2>/dev/null && printf .)"; then
    [ "${target%$'\n.'}" -ef . ]
    return
  fi
  fields="$("$(command -v lsof || echo /usr/sbin/lsof)" -a -p "$1" -d cwd -FDi 2>/dev/null)" || return 1
  while IFS= read -r field; do
    case "$field" in D*) device="${field#D}" ;; i*) inode="${field#i}" ;; esac
  done <<<"$fields"
  [[ "$device" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ && "$inode" =~ ^[0-9]+$ ]] || return 1
  here="$(stat -c '%d:%i' . 2>/dev/null || stat -f '%d:%i' . 2>/dev/null)" || return 1
  [ "$(printf '%d:%s' "$device" "$inode")" = "$here" ]
}

# _pes_armed_here — a wait that runs on this branch was armed in this checkout. The liveness check
# sees every checkout of the machine, and a wake is written to the log of the checkout that armed the
# wait, because the wait runs in the directory the arm ran in. So a running wait that runs in another
# directory, or whose directory cannot be read, was armed in another checkout, and no reader of this
# one gets its wake. A wait armed again in this checkout keeps its reader: it runs here too. A wait
# with no log here, or beside one that shows an exit, has no wake left to read here.
_pes_armed_here() {
  local pid
  [ -n "$(_pes_cur_log)" ] && [ -z "$(_pes_rc_line)" ] || return 1
  for pid in $(_pes_wait_pids); do
    _pes_process_here "$pid" && return 0
  done
  return 1
}

# The start time is read in one time zone and locale, so a record made in one shell matches a check
# run in another. _pes_started_here is the reading an older copy of this script recorded.
_pes_started() { TZ=UTC LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ //; s/ $//'; }
_pes_started_here() { ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ //; s/ $//'; }

_pes_comm() { ps -o comm= -p "$1" 2>/dev/null | sed 's/^-//; s#.*/##' | tr -d '[:space:]'; }

# _pes_owner — prints "PID<TAB>START<TAB>NAME" for the agent session that will read a wake:
# PR_END_STATE_OWNER_PID when set, else the nearest ancestor whose name is an agent session's.
# Any other ancestor is passed over, so a run with no session above it has no owner.
_pes_owner() {
  local pid="${PR_END_STATE_OWNER_PID:-}" comm started found="" hops=0
  if [ -z "$pid" ]; then
    pid="$PPID"
    while [[ "$pid" =~ ^[1-9][0-9]*$ ]] && [ "$pid" -gt 1 ] && [ "$hops" -lt 64 ]; do
      comm="$(_pes_comm "$pid")"
      [ -n "$comm" ] || break
      case " ${_PES_SESSION_NAMES} " in *" ${comm} "*) found="$pid"; break ;; esac
      pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
      hops=$((hops + 1))
    done
    pid="$found"
  fi
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && [ "$pid" -gt 1 ] || return 1
  started="$(_pes_started "$pid")"
  _pes_owner_alive "$pid" "$started" || return 1
  comm="$(_pes_comm "$pid")"
  printf '%s\t%s\t%s\n' "$pid" "$started" "${comm:-unknown}"
}

# _pes_owner_alive PID START — the same process, not another one that got its number, and not a
# zombie. A process that has exited keeps its number and start time until its parent reaps it.
_pes_owner_alive() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]] || return 1
  case "$(ps -o stat= -p "$1" 2>/dev/null | tr -d '[:space:]')" in "" | Z*) return 1 ;; esac
  [ -n "$2" ] && { [ "$(_pes_started "$1")" = "$2" ] || [ "$(_pes_started_here "$1")" = "$2" ]; }
}

# _pes_delivered RECIPIENT MESSAGE ANSWER — a handoff that a channel accepted for a reader: an
# address, the id the send returned, and an answer that says someone will read it.
_pes_delivered() {
  local LC_ALL=C
  [[ "$1" =~ ^ticket:[A-Z][A-Z0-9]*-[1-9][0-9]*$ || "$1" =~ ^session:[A-Za-z0-9][A-Za-z0-9._:-]*$ ]] || return 1
  [[ "$2" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]*$ ]] || return 1
  [ "$3" = next-turn ] || [ "$3" = next-phase ]
}

# _pes_handoff_of REC — prints "RECIPIENT<TAB>MESSAGE<TAB>ANSWER" when the record is a handoff
# in that form. A record edited into another shape is no handoff.
_pes_handoff_of() {
  local to message answer
  to="$(printf '%s' "$1" | jq -r 'select(.end == "handoff") | .to // empty' 2>/dev/null)" || return 1
  message="$(printf '%s' "$1" | jq -r 'select(.end == "handoff") | .message // empty' 2>/dev/null)" || return 1
  answer="$(printf '%s' "$1" | jq -r 'select(.end == "handoff") | .answer // empty' 2>/dev/null)" || return 1
  _pes_delivered "$to" "$message" "$answer" || return 1
  printf '%s\t%s\t%s\n' "$to" "$message" "$answer"
}

# _pes_rec PR — this pull request's record as one JSON line.
_pes_rec() {
  _pes_cat "${END_STATE##*/}" | jq -c --arg key "$_PES_EKEY" --argjson pr "$1" '.[$key] | select(type == "object" and .pr == $pr)' 2>/dev/null || true
}

# _pes_record_cmd PR [TICKET] — the record command for this pull request as a line that runs. With no
# ticket known it carries the word TICKET, and the line that prints it says to put the key there.
_pes_record_cmd() {
  printf '%s record %s %s %s' "$_PES_SELF" "$(printf '%q %q' "$_PES_REPO" "$_PES_BRANCH")" "$1" "${2:-TICKET}"
}

# _pes_known_ticket PR REC — the ticket to put in a record command that check prints: the record's,
# or else the one in the waiter's state when that state names this pull request, so a branch with no
# ticket key in its name gets a command that arms. Another pull request's ticket is never used.
_pes_known_ticket() {
  local t armed listens
  t="$(printf '%s' "$2" | jq -r '.ticket // empty' 2>/dev/null)" || t=""
  if [ -z "$t" ]; then
    IFS='|' read -r armed listens <<<"$(_pes_waiter_entry)"
    [ "$armed" != "$1" ] || t="$listens"
  fi
  [[ "$t" =~ ^[A-Z][A-Z0-9]*-[0-9]+$ ]] && printf '%s\n' "$t"
}

# _pes_load_arm — define arm_branch_waiter from the fenced block of the shipped waiter reference.
_pes_load_arm() {
  local block
  [ -r "$_PES_WAITER_REF" ] || return 1
  block="$(awk '
    /^```bash$/ { on = 1; buf = ""; next }
    /^```$/ {
      if (on && index(buf, "arm_branch_waiter() {")) { printf "%s", buf; found = 1; exit }
      on = 0; next
    }
    on { buf = buf $0 "\n" }
    END { if (!found) exit 1 }
  ' "$_PES_WAITER_REF")" || return 1
  [ -n "$block" ] || return 1
  eval "$block"
  declare -F arm_branch_waiter >/dev/null 2>&1
}

# _pes_write JSON — set this pull request's record to the JSON object given. Another pull
# request's record on the same branch is left as it is. A record file that is not a JSON object is
# replaced, never merged into.
_pes_write() {
  local key="$_PES_EKEY" rec="$1" out root old
  command -v jq >/dev/null 2>&1 || return 1
  old="$(_pes_cat "${END_STATE##*/}")"
  if [ -n "$old" ] && printf '%s\n' "$old" | jq -e 'type == "object"' >/dev/null 2>&1; then
    out="$(printf '%s\n' "$old" | jq --arg key "$key" --argjson rec "$rec" '.[$key] = $rec')" || return 1
  else
    out="$(jq -n --arg key "$key" --argjson rec "$rec" '{($key): $rec}')" || return 1
  fi
  # The write is made from inside .catalyst, entered once and checked to be this checkout's own directory,
  # into a file created new and then renamed over the record's name, as the published waiter writes its
  # state: a link the checkout carries is replaced, never followed.
  root="$PWD"
  _pes_untracked || return 1
  [ -L .catalyst ] || mkdir -p .catalyst 2>/dev/null
  printf '%s\n' "$out" | (
    cd -P "${root}/.catalyst" >/dev/null 2>&1 && [ "$(pwd -P)" = "${root}/.catalyst" ] || exit 1
    name="${END_STATE##*/}"
    tmp="${name}.tmp.$$.${RANDOM}${RANDOM}"
    # A move onto a directory puts the file inside it and reports success.
    if [ -d "$name" ] && [ ! -L "$name" ]; then exit 1; fi
    (set -C; cat >"$tmp") 2>/dev/null || { rm -f -- "$tmp"; exit 1; }
    if mv --version >/dev/null 2>&1; then mv -fT -- "$tmp" "$name"; else mv -fh -- "$tmp" "$name"; fi || { rm -f -- "$tmp"; exit 1; }
  )
}

_pes_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

_pes_no_record() { _pes_warn "could not write ${END_STATE}; nothing was recorded."; return "$_PES_RC"; }

# _pes_wt_z - this Git's `worktree list` takes -z (Git 2.36 and newer). A version that cannot be read is
# taken to have it: a Git that refuses -z then reads nothing, and nothing is never taken for the head.
_pes_wt_z() {
  local v
  v="$(git --version 2>/dev/null)" || return 0
  [[ "$v" =~ ^git\ version\ ([0-9]+)\.([0-9]+) ]] || return 0
  [ "${BASH_REMATCH[1]}" -gt 2 ] || { [ "${BASH_REMATCH[1]}" -eq 2 ] && [ "${BASH_REMATCH[2]}" -ge 36 ]; }
}

# _pes_main_worktree - this checkout is the repository's main worktree, not a linked one: its git directory
# is the common one.
_pes_main_worktree() {
  local own common
  own="$(git rev-parse --absolute-git-dir 2>/dev/null && printf .)" || return 1
  common="$(git rev-parse --git-common-dir 2>/dev/null && printf .)" || return 1
  [ "${own%$'\n.'}" -ef "${common%$'\n.'}" ]
}

# Git before 2.36 has no NUL mode. Its first path is the physical common directory without /.git;
# each linked path comes from its registered gitdir file. Keep the complete path, including newlines.
_pes_registry_paths() {
  local common worktree_path pointer
  common="$(git rev-parse --git-common-dir 2>/dev/null && printf .)" || return 1
  common="${common%$'\n.'}"
  common="$(CDPATH= cd -P -- "$common" && printf '%s.' "$PWD")" || return 1
  common="${common%.}"
  paths=("${common%/.git}")
  for pointer in "$common"/worktrees/*/gitdir; do
    [ -e "$pointer" ] || continue
    worktree_path="$(cat -- "$pointer")" || return 1
    [[ "$worktree_path" = /*/.git ]] || return 1
    paths+=("${worktree_path%/.git}")
  done
}

# Decode the old Git listing with actual registered path lengths. Require each path exactly once and
# the same registry before and after the observation. Nothing here reads a branch or a commit again.
_pes_legacy_worktrees() {
  local -a paths used
  local before listing i match worktree_path line count=0
  shopt -s dotglob nullglob # the listing runs in its own process, and .hidden worktrees are registered too
  _pes_registry_paths || return 1
  before="$(printf '%q\n' "${paths[@]}")"
  listing="$(git worktree list --porcelain && printf .)" || return 1
  _pes_registry_paths && [ "$before" = "$(printf '%q\n' "${paths[@]}")" ] || return 1
  while [ "$listing" != . ]; do
    match=""
    for i in "${!paths[@]}"; do
      [ -z "${used[$i]:-}" ] || continue
      [[ "$listing" = "worktree ${paths[$i]}"$'\n'* ]] || continue
      [ -z "$match" ] || return 1
      match="$i"
    done
    [ -n "$match" ] || return 1
    used[$match]=1; count=$((count + 1)); worktree_path="${paths[$match]}"
    listing="${listing#"worktree $worktree_path"$'\n'}"
    printf 'worktree %s\0' "$worktree_path"
    while [[ "$listing" = *$'\n'* ]]; do
      line="${listing%%$'\n'*}"; listing="${listing#*$'\n'}"
      case "$line" in HEAD\ * | branch\ * | detached | bare | locked | locked\ * | prunable | prunable\ * | "") ;; *) return 1 ;; esac
      printf '%s\0' "$line"
      [ -n "$line" ] || break
    done
    [ -z "$line" ] || return 1
  done
  [ "$count" -eq "${#paths[@]}" ]
}

# Git resolves each worktree's HEAD once and reports its branch and commit in the same record.
# Select only the current directory (or the first record for a main checkout with a separate gitdir).
# An unfinished listing or more than one candidate cannot identify this checkout.
_pes_head_here() {
  local f worktree_path="" ref="" sha="" kind="" n=0 hits=0 hit="" end="" main=""
  _pes_main_worktree && main=1
  while IFS= read -r -d '' f; do
    case "$f" in
      worktree\ *) worktree_path="${f#worktree }"; ref=""; sha=""; kind=unreadable; n=$((n + 1)) ;;
      HEAD\ *) sha="${f#HEAD }" ;;
      branch\ *) kind=branch; ref="${f#branch }" ;;
      detached) kind=detached ;;
      bare) kind=bare ;;
      locked | locked\ * | prunable | prunable\ *) ;;
      pes-read-complete) end=1 ;;
      "")
        # The end of a record.
        if [ -n "$worktree_path" ] && { { [ -n "$main" ] && [ "$n" -eq 1 ]; } || [ "$worktree_path" -ef . ]; }; then
          hits=$((hits + 1))
          hit="${kind}"$'\t'"${ref}"$'\t'"${sha}"
        fi
        worktree_path=""
        ;;
      *) return 1 ;;
    esac
  done < <(
    if _pes_wt_z; then git worktree list --porcelain -z; else _pes_legacy_worktrees; fi 2>/dev/null &&
      printf 'pes-read-complete\0'
  )
  [ -n "$end" ] && [ "$hits" -eq 1 ] || return 1
  printf '%s\n' "$hit"
}

# _pes_head_problem BRANCH SHA — prints why this checkout is not on the pull request's head, or
# nothing when it is. The waiter's handler leaves a checkout on another branch untouched, and a
# head this seat does not have is work it cannot bring current. The branch and the commit come
# from one reading of the checkout (_pes_head_here) and are both compared with the ones asked for.
# Nothing is ever read again to settle a doubt: a reading that cannot say is a problem too.
_pes_head_problem() {
  local seen kind ref head want="refs/heads/$1"
  if ! seen="$(_pes_head_here)"; then
    printf 'this checkout is not in the list of worktrees Git gave, so its branch and commit could not be read (use git worktree repair for a moved worktree or Git 2.36+ for ambiguous older listings)\n'
    return 0
  fi
  IFS=$'\t' read -r kind ref head <<<"$seen"
  case "$kind" in
    branch) ;;
    detached) printf 'this checkout is on no branch, not on %s\n' "$1"; return 0 ;;
    bare) printf 'this is a bare repository with no checkout of %s\n' "$1"; return 0 ;;
    *) printf 'this checkout is not on %s: its HEAD does not resolve to a branch at a commit\n' "$1"; return 0 ;;
  esac
  if [ "$ref" != "$want" ]; then
    printf 'this checkout is on %s, not on %s\n' "${ref#refs/heads/}" "$1"
    return 0
  fi
  [[ "$head" =~ ^0+$ ]] && head=""
  if [ -z "$2" ] || [ "$head" != "$2" ]; then
    printf 'the pull request is at %s and this branch is at %s\n' "${2:-an unknown commit}" "${head:-an unknown commit}"
  fi
  return 0
}

# _pes_twice — one identity is saved under two spellings of the repository's name. Which entry is this
# pull request's cannot be told, so nothing is read from either and nothing is written.
_pes_twice() {
  _pes_warn "NEEDS ATTENTION: ${_PES_TWICE} holds ${_PES_REF} under two spellings of the repository's name, so the entry of this pull request cannot be told from the other. Keep one of the two entries, then run this command again. Nothing was recorded."
  return "$_PES_RC"
}

# _pes_finish PR STATE — a merged or closed pull request has nothing to own: record that and say it.
_pes_finish() {
  local rec
  rec="$(jq -n --argjson pr "$1" --arg end "$2" --arg at "$(_pes_now)" '{pr: $pr, end: $end, at: $at}')" || return "$_PES_RC"
  _pes_write "$rec" || { _pes_no_record; return $?; }
  _pes_say "FINISHED: pull request #${1} is ${2}; there is nothing to own."
  return 0
}

# _pes_not_here ARMED — a wait runs on this branch, this checkout's waiter state names no pull request
# for it, and the wait was not started here: another checkout of the repository armed it.
_pes_not_here() { [ -z "$1" ] && ! _pes_armed_here; }
_pes_not_here_text() { printf 'a wait is running on %s, but it was not started in this checkout, whose waiter state names no pull request for the branch, so no session that works here reads its wake' "$_PES_REF"; }

_pes_record() {
  local repo branch="$2" pr="$3" ticket="${4:-}" ref got state sha gname out reason armed rc_line owner opid ostart oname rec kept to message answer note problem listens rticket rsecs
  got="$(_pes_pr "$1" "$pr")" || {
    _pes_warn "could not read pull request #${pr} in ${1}. Nothing was recorded; run this command again."
    return "$_PES_RC"
  }
  IFS='|' read -r state sha gname <<<"$got"
  _pes_ids "$1" "$branch" "$pr" "$gname"
  [ -z "$_PES_TWICE" ] || { _pes_twice; return $?; }
  repo="$_PES_REPO"
  ref="$_PES_REF"
  if [ "$state" != open ]; then
    _pes_finish "$pr" "$state"
    return $?
  fi

  # A handoff already on record for this pull request stands: its recipient owns it, and a
  # second create step must not replace the receipt.
  if kept="$(_pes_handoff_of "$(_pes_rec "$pr")")"; then
    IFS=$'\t' read -r to message answer <<<"$kept"
    _pes_say "HANDED-OFF: pull request #${pr} was sent to ${to} (message ${message}, ${answer}). The record was kept and no wait was started."
    return 0
  fi

  # A record run without a ticket keeps the one saved for this pull request, so the running wait is
  # still compared with the ticket it should listen on, and the record does not lose it.
  if [ -z "$ticket" ]; then
    ticket="$(_pes_rec "$pr" | jq -r '.ticket // empty' 2>/dev/null)" || ticket=""
  fi

  # The checkout is read before a wait is started. A session whose checkout is not on the pull
  # request's head cannot bring that head current, so it is not recorded as the owner, and a wait
  # started for it would stop the arm that follows once the checkout is right.
  reason=""
  problem="$(_pes_head_problem "$branch" "$sha")"
  if [ -n "$problem" ]; then
    reason="$problem"
    if _pes_live_waiter; then
      armed="$(_pes_waiter_pr)"
      reason="the waiter running on ${ref} was armed for pull request #${armed:-unknown}, not #${pr}"
      [ "$armed" != "$pr" ] || reason="a wait is running on ${ref}, but ${problem}"
      ! _pes_not_here "$armed" || reason="$(_pes_not_here_text)"
    fi
  elif ! _pes_load_arm; then
    reason="the branch waiter reference is missing from this skill"
  elif [ "$(_pes_waiter_pr)" = "$pr" ] && ! _pes_live_waiter && _pes_unhandled_wake; then
    # A wake for this pull request that nothing has handled. The waiter reference hands it to the wake
    # handler, which arms the wait again itself; an arm here would empty the log that holds the event.
    reason="the last wait on ${ref} woke ($(_pes_rc_line)) and nothing has handled its wake. It is not armed again by this command, and $(_pes_log) keeps the event. Handle it with handle_waiter_wake from ${_PES_WAITER_REF}, which arms the wait again, then run record again"
  elif [ "$(_pes_waiter_pr)" = "$pr" ] && ! _pes_live_waiter && _pes_failed_wait; then
    # The waiter reference says such a wait is reported and not armed again. An arm would empty the log
    # that says why, and send the same wait again.
    reason="the last wait on ${ref} failed ($(_pes_rc_line)): $(_pes_log_text | grep -Ev '^(cursor|waiter-rc|waiter-arm) ' | head -n 1 | cut -c1-200). It is not armed again by this command, and $(_pes_log) keeps it. Once the cause is fixed, arm it with arm_branch_waiter from ${_PES_WAITER_REF}, then run record again"
  else
    # A conflict retry pending for this pull request keeps its due time: the wait is armed to end then, as
    # the wake handler arms it, and the handler tries the retry on that wake. The arm keeps the retry for
    # the same pull request.
    rsecs=""
    if [ "$(_pes_waiter_pr)" = "$pr" ]; then rsecs="$(_pes_retry_left)" || rsecs=""; fi
    if [ -n "$rsecs" ]; then
      out="$(WAITER_TIMEOUT_SECONDS="$rsecs" arm_branch_waiter "$repo" "$branch" "$pr" "$ticket" 2>&1)" || true
    else
      out="$(arm_branch_waiter "$repo" "$branch" "$pr" "$ticket" 2>&1)" || true
    fi
    # The arm returns before its wait is sure to show in the process table. It is looked for until it
    # shows, its log shows an exit, or two seconds pass.
    case "$out" in
      *"branch-waiter: armed "*)
        for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
          if _pes_live_waiter || [ -n "$(_pes_rc_line)" ]; then break; fi
          sleep 0.1
        done
        ;;
    esac
    if _pes_live_waiter; then
      armed="$(_pes_waiter_pr)"
      if _pes_not_here "$armed"; then
        reason="$(_pes_not_here_text)"
      elif [ "$armed" != "$pr" ]; then
        reason="the waiter running on ${ref} was armed for pull request #${armed:-unknown}, not #${pr}"
      elif ! _pes_armed_here; then
        reason="the wait running on ${ref} was not started in this checkout, so no session that works here reads its wake"
      elif IFS='|' read -r armed listens <<<"$(_pes_waiter_entry)" && [ "$armed" != "$pr" ]; then
        reason="the waiter running on ${ref} was armed for pull request #${armed:-unknown}, not #${pr}"
      elif ! got="$(_pes_pr "$repo" "$pr")"; then
        # The pull request is read again after the arm: GitHub can move its head or close it meanwhile.
        # A read that fails says nothing about the pull request, so the record there is stays as it is:
        # a live reader on record is not replaced by a failed read.
        _pes_warn "could not read pull request #${pr} in ${repo} again after the arm, so its state and head are unknown. The record was left as it was; run this command again."
        return "$_PES_RC"
      elif IFS='|' read -r state sha gname <<<"$got" && [ "$state" != open ]; then
        # Merged or closed while the wait was armed: the same end as when the first read finds it so.
        _pes_finish "$pr" "$state"
        return $?
      elif problem="$(_pes_head_problem "$branch" "$sha")" && [ -n "$problem" ]; then
        # The checkout is read again too: it can move while the arm reads the event stream.
        reason="a wait is running on ${ref}, but ${problem}"
      elif [ -n "$ticket" ] && [ "$listens" != "$ticket" ]; then
        # The wait filters on the ticket it was armed with, so a message to this ticket does not wake it.
        reason="the waiter running on ${ref} for pull request #${pr} listens on ticket ${listens:-unknown}, not ${ticket}, so a message to ${ticket} does not wake it"
      elif ! owner="$(_pes_owner)"; then
        # The caller is no agent session. A reader that is on record and still alive keeps the wait.
        rec="$(_pes_rec "$pr")"
        opid="$(printf '%s' "$rec" | jq -r 'select(.end == "waiter") | .owner.pid // empty' 2>/dev/null)" || opid=""
        ostart="$(printf '%s' "$rec" | jq -r 'select(.end == "waiter") | .owner.started // empty' 2>/dev/null)" || ostart=""
        oname="$(printf '%s' "$rec" | jq -r 'select(.end == "waiter") | .owner.name // empty' 2>/dev/null)" || oname=""
        rticket="$(printf '%s' "$rec" | jq -r 'select(.end == "waiter") | .ticket // empty' 2>/dev/null)" || rticket=""
        if [ -n "$opid" ] && _pes_owner_alive "$opid" "$ostart" && [ -n "$rticket" ] && [ "$rticket" != "$listens" ]; then
          # The reader was recorded for another ticket than the one the running wait listens on, as
          # check reads it. Only the session that will read this wait's wake can put itself on record.
          reason="a wait is running on ${ref} for pull request #${pr} and listens on ticket ${listens:-unknown}, but the reader on record, ${oname:-a session} (pid ${opid}), was recorded for ticket ${rticket}. The session that will read its wake runs record with ticket ${listens:-TICKET}"
        elif [ -n "$opid" ] && _pes_owner_alive "$opid" "$ostart"; then
          # A ticket given here was checked above against the one the running wait listens on. A reader on record
          # with no ticket gets it, so check compares the next arm with it too.
          if [ -z "$rticket" ] && [ -n "$ticket" ]; then
            rec="$(printf '%s' "$rec" | jq -c --arg ticket "$ticket" '.ticket = $ticket' 2>/dev/null)" && [ -n "$rec" ] || { _pes_no_record; return $?; }
            _pes_write "$rec" || { _pes_no_record; return $?; }
          fi
          _pes_say "OWNED: a waiter is running on ${ref} for pull request #${pr}; ${oname:-its reader} (pid ${opid}) is alive and reads its wake at its next turn. No agent session is above this command, so the reader on record was kept. When that process ends, this pull request needs attention."
          return 0
        else
          reason="a wait is running on ${ref}, but no agent session that will read its wake could be named"
        fi
      else
        IFS=$'\t' read -r opid ostart oname <<<"$owner"
        rec="$(jq -n --argjson pr "$pr" --arg at "$(_pes_now)" --arg head "$sha" --arg ticket "$ticket" --argjson opid "$opid" --arg ostart "$ostart" --arg oname "$oname" \
          '{pr: $pr, end: "waiter", at: $at, head: $head, ticket: $ticket, owner: {pid: $opid, started: $ostart, name: $oname}}')" || return "$_PES_RC"
        _pes_write "$rec" || { _pes_no_record; return $?; }
        note=""
        case "$out" in *"already running"*) note=" The wait was already running; this session is now on record as its reader." ;; esac
        _pes_say "OWNED: a waiter is running on ${ref} for pull request #${pr}; ${oname} (pid ${opid}) is alive and reads its wake at its next turn.${note} When that process ends, this pull request needs attention."
        return 0
      fi
    else
      rc_line="$(_pes_rc_line)"
      case "$out" in
        *"branch-waiter: armed "*)
          reason="the wait was armed, but no process of it shows yet; its log is $(_pes_log). Run record again"
          [ -z "$rc_line" ] || reason="the wait ended at once (${rc_line}); its log is $(_pes_log)"
          ;;
        *) reason="$(printf '%s\n' "$out" | sed -n 's/^branch-waiter: //p' | tail -n 1)" ;;
      esac
      [ -n "$reason" ] || reason="the waiter did not start and gave no reason"
    fi
  fi
  rec="$(jq -n --argjson pr "$pr" --arg at "$(_pes_now)" --arg head "$sha" --arg ticket "$ticket" --arg reason "$reason" '{pr: $pr, end: "needs-attention", at: $at, head: $head, ticket: $ticket, reason: $reason}')" || return "$_PES_RC"
  _pes_write "$rec" || { _pes_no_record; return $?; }
  _pes_say "NEEDS ATTENTION: pull request #${pr} is open and nothing owns it. ${reason}"
  _pes_say "Send it to an owner and record the message id and answer with the handoff command, or say in the report that it is unowned. Do not report this run as finished unattended."
  return 0
}

_pes_handoff() {
  local pr="$3" to="$4" message="$5" answer="$6" got state sha gname rec
  got="$(_pes_pr "$1" "$pr")" || {
    _pes_warn "could not read pull request #${pr} in ${1}. Nothing was recorded; run this command again."
    return "$_PES_RC"
  }
  IFS='|' read -r state sha gname <<<"$got"
  _pes_ids "$1" "$2" "$pr" "$gname"
  [ -z "$_PES_TWICE" ] || { _pes_twice; return $?; }
  rec="$(jq -n --argjson pr "$pr" --arg at "$(_pes_now)" --arg head "$sha" --arg to "$to" --arg message "$message" --arg answer "$answer" \
    '{pr: $pr, end: "handoff", at: $at, head: $head, to: $to, message: $message, answer: $answer}')" || return "$_PES_RC"
  _pes_write "$rec" || { _pes_no_record; return $?; }
  _pes_say "HANDED-OFF: pull request #${pr} (${state}) was sent to ${to} (message ${message}, ${answer})."
  return 0
}

_pes_check() {
  local branch="$2" pr="$3" ref got state sha gname armed rec end opid ostart oname problem rc_line kept to message answer note rticket listens why known
  got="$(_pes_pr "$1" "$pr")" || {
    _pes_warn "NEEDS ATTENTION: could not read pull request #${pr} in ${1}, so its owner is unknown."
    return "$_PES_RC"
  }
  IFS='|' read -r state sha gname <<<"$got"
  if [ "$state" != open ]; then
    _pes_say "FINISHED: pull request #${pr} is ${state}; there is nothing to own."
    return 0
  fi
  _pes_ids "$1" "$branch" "$pr" "$gname"
  [ -z "$_PES_TWICE" ] || { _pes_twice; return $?; }
  ref="$_PES_REF"
  rec="$(_pes_rec "$pr")"
  end="$(printf '%s' "$rec" | jq -r '.end // empty' 2>/dev/null)" || end=""

  # A delivered handoff is read first: a wait still running on the branch does not hide it.
  if kept="$(_pes_handoff_of "$rec")"; then
    IFS=$'\t' read -r to message answer <<<"$kept"
    _pes_say "HANDED-OFF: pull request #${pr} was sent to ${to} (message ${message}, ${answer})."
    return 0
  fi

  if _pes_live_waiter; then
    armed="$(_pes_waiter_pr)"
    if _pes_not_here "$armed"; then
      _pes_warn "NEEDS ATTENTION: pull request #${pr} is open, and $(_pes_not_here_text)."
      return "$_PES_RC"
    fi
    if [ "$armed" != "$pr" ]; then
      _pes_warn "NEEDS ATTENTION: pull request #${pr} is open, and the waiter running on ${ref} was armed for pull request #${armed:-unknown}."
      return "$_PES_RC"
    fi
    # The checkout is read before the owner, so `record` and `check` give the same cause when
    # this checkout is not on the pull request's head.
    problem="$(_pes_head_problem "$branch" "$sha")"
    if [ -n "$problem" ]; then
      _pes_warn "NEEDS ATTENTION: a waiter is running on ${ref} for pull request #${pr}, but ${problem}."
      return "$_PES_RC"
    fi
    if ! _pes_armed_here; then
      _pes_warn "NEEDS ATTENTION: a wait is running on ${ref} for pull request #${pr}, but it was not started in this checkout, so no session that works here reads its wake."
      return "$_PES_RC"
    fi
    # The first read of the armed pull request is older than the probes. An arm for another one writes
    # its number before it starts its wait, so a second read shows whose wait was seen.
    # The pull request and the ticket come from one read, so they are the same wait's.
    IFS='|' read -r armed listens <<<"$(_pes_waiter_entry)"
    if [ "$armed" != "$pr" ]; then
      _pes_warn "NEEDS ATTENTION: pull request #${pr} is open, and the waiter running on ${ref} was armed for pull request #${armed:-unknown}."
      return "$_PES_RC"
    fi
    # The wait filters on the ticket it was armed with. A record made for another ticket is not read by it.
    rticket="$(printf '%s' "$rec" | jq -r '.ticket // empty' 2>/dev/null)" || rticket=""
    if [ -n "$rticket" ] && [ "$listens" != "$rticket" ]; then
      _pes_warn "NEEDS ATTENTION: the waiter running on ${ref} for pull request #${pr} listens on ticket ${listens:-unknown}, not ${rticket}, so a message to ${rticket} does not wake it."
      return "$_PES_RC"
    fi
    opid="$(printf '%s' "$rec" | jq -r 'select(.end == "waiter") | .owner.pid // empty' 2>/dev/null)" || opid=""
    ostart="$(printf '%s' "$rec" | jq -r 'select(.end == "waiter") | .owner.started // empty' 2>/dev/null)" || ostart=""
    oname="$(printf '%s' "$rec" | jq -r 'select(.end == "waiter") | .owner.name // empty' 2>/dev/null)" || oname=""
    if [ -z "$opid" ]; then
      _pes_warn "NEEDS ATTENTION: a wait is running on ${ref} for pull request #${pr}, but no agent session is on record as its reader. The session that will read its wake runs this, with the ticket key in place of TICKET: $(_pes_record_cmd "$pr")"
      return "$_PES_RC"
    fi
    if ! _pes_owner_alive "$opid" "$ostart"; then
      _pes_warn "NEEDS ATTENTION: a wait is running on ${ref} for pull request #${pr}, but the session that armed it (${oname:-not recorded}${opid:+, pid ${opid}}) has ended, so nothing will read its wake."
      return "$_PES_RC"
    fi
    _pes_say "OWNED: a waiter is running on ${ref} for pull request #${pr}; ${oname} (pid ${opid}) is alive and reads its wake at its next turn."
    return 0
  fi

  # The log is the branch's, and its exit belongs to the pull request the waiter state names. An exit of
  # another pull request's wait says nothing about this one.
  rc_line="$(_pes_rc_line)"
  armed="$(_pes_waiter_pr)"
  [ -z "$armed" ] || [ "$armed" = "$pr" ] || rc_line=""
  if [ "$end" = waiter ] || [ -n "$rc_line" ]; then
    note="Handle its wake and arm it again, as the waiter reference says."
    if [ -z "$rc_line" ]; then
      note="Arm it again with record."
    elif _pes_failed_wait; then
      note="Stop and report it, as the waiter reference says; it is not armed again."
    elif _pes_unhandled_wake; then
      note="Handle its wake with handle_waiter_wake first, as the waiter reference says; record does not arm over it."
    elif [ "$rc_line" = "waiter-rc 0" ]; then
      note="Its wake was handled; arm it again with record."
    elif [ "$rc_line" != "waiter-rc 124" ]; then
      # The wake handler arms again only after a wake or a timeout. record arms this one with the saved
      # sequence and ticket.
      note="The wait was stopped before it ended; arm it again with record."
    fi
    if [ "$armed" = "$pr" ] && ! _pes_failed_wait && ! _pes_unhandled_wake && _pes_pending_retry; then
      note="A conflict retry is pending on ${ref}. record arms a wait that ends when it is due, and the wake handler tries it on that wake."
      # The ticket the wait listened on is in the record or in the waiter's state for this pull request.
      # A branch with no ticket key in its name has it nowhere else, and record does not arm without it.
      known="$(_pes_known_ticket "$pr" "$rec")" || known=""
      [ -z "$known" ] || note="${note} Run this: $(_pes_record_cmd "$pr" "$known")"
    fi
    _pes_warn "NEEDS ATTENTION: pull request #${pr} is open and the waiter on ${ref} is not running${rc_line:+ (${rc_line})}. ${note}"
  elif [ "$end" = handoff ]; then
    _pes_warn "NEEDS ATTENTION: pull request #${pr} is open, and the handoff on record for ${ref} is not a delivered one (an address, a message id and an answer of next-turn or next-phase)."
  elif [ "$end" = needs-attention ]; then
    # The reason on record, and the command that records an owner once it is dealt with: the one line a
    # reader of this check needs next. The ticket is the saved one when there is one.
    why="$(printf '%s' "$rec" | jq -r '.reason // "no reason was recorded"' 2>/dev/null)" || why="no reason was recorded"
    known="$(_pes_known_ticket "$pr" "$rec")" || known=""
    if [ -n "$known" ]; then
      _pes_warn "NEEDS ATTENTION: pull request #${pr} is open and nothing owns it. ${why%.}. Once that is dealt with, run this: $(_pes_record_cmd "$pr" "$known")"
    else
      _pes_warn "NEEDS ATTENTION: pull request #${pr} is open and nothing owns it. ${why%.}. Once that is dealt with, run this, with the ticket key in place of TICKET: $(_pes_record_cmd "$pr")"
    fi
  else
    # The waiter's state can still name this pull request and its ticket when no record does: a wait armed
    # by hand, or one whose record was lost. The command then carries that ticket, so it arms as printed.
    known="$(_pes_known_ticket "$pr" "$rec")" || known=""
    if [ -n "$known" ]; then
      _pes_warn "NEEDS ATTENTION: pull request #${pr} is open, and ${ref} has no waiter and no handoff on record. The waiter's state has ticket ${known} for this pull request. Run this: $(_pes_record_cmd "$pr" "$known")"
    else
      _pes_warn "NEEDS ATTENTION: pull request #${pr} is open, and ${ref} has no waiter and no handoff on record. Run this, with the ticket key in place of TICKET: $(_pes_record_cmd "$pr")"
    fi
  fi
  return "$_PES_RC"
}

_pes_main() {
  local cmd="${1:-}"
  case "$cmd" in record | handoff | check) ;; *) _pes_usage; return 2 ;; esac
  [ "$#" -ge 4 ] || { _pes_usage; return 2; }
  [[ "$2" =~ ^[^/[:space:]]+/[^/[:space:]]+$ && -n "$3" && "$4" =~ ^[1-9][0-9]*$ ]] || { _pes_usage; return 2; }
  # The records, the waiter's state and log, and the directory its wait runs in are the checkout's,
  # so every command works from the checkout's root, wherever in it the command was run.
  local top said
  command -v jq >/dev/null 2>&1 || {
    _pes_warn "jq is not on PATH. This command reads the pull request, the waiter's state and its own records with jq, so nothing was read or recorded. Install jq, then run this again."
    return "$_PES_RC"
  }
  top="$(git rev-parse --show-toplevel 2>/dev/null && printf .)" || top=""
  top="${top%$'\n.'}"
  if [ -z "$top" ]; then
    # Git's own first line says which: no repository here, or one it refuses to read (an owner other
    # than the user running this, which Git reports as dubious ownership).
    said="$(git rev-parse --show-toplevel 2>&1 >/dev/null | head -n 1 | cut -c1-300)" || said=""
    case "$said" in
      *"dubious ownership"*) _pes_warn "Git refuses to read this checkout: ${said}. Its files belong to another user than the one running this command. Run this as the checkout's owner, or tell Git the directory is safe as its message says, then run this again. Nothing was read or recorded." ;;
      *) _pes_warn "not in a git checkout: run this from the pull request's checkout. Nothing was read or recorded." ;;
    esac
    return "$_PES_RC"
  fi
  cd -P -- "$top" || return "$_PES_RC"
  case "$cmd" in
    record) _pes_record "$2" "$3" "$4" "${5:-}" ;;
    handoff)
      [ "$#" -eq 7 ] || { _pes_usage; return 2; }
      if ! _pes_delivered "$5" "$6" "$7"; then
        _pes_warn "not a delivered handoff: RECIPIENT is ticket:<KEY-123> or session:<id>, MESSAGE is the id the send returned, and ANSWER is next-turn or next-phase. An undeliverable message has no reader, so nothing was recorded."
        return 2
      fi
      _pes_handoff "$2" "$3" "$4" "$5" "$6" "$7"
      ;;
    check) _pes_check "$2" "$3" "$4" ;;
  esac
}

_pes_main "$@"
exit $?
