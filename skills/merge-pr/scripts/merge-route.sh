#!/usr/bin/env bash
# merge-route.sh — who merges this pull request: its repository's merge queue, a person, or merge-pr.
#
#   merge-route.sh <pr-number> [repo-root]
#
# Prints one word on stdout, with the reason on stderr:
#   merged      already merged; resume post-merge
#   held        a hold label keeps it out; its owner releases it
#   hand-merge  the queue excludes it (a hold:hand-steps label, or a file or branch the queue config
#               excludes); a person merges it by the repository's hand-merge procedure
#   queue <how> the repository's merge queue merges it; never merge it yourself. <how> is how a PR
#               enters that queue, read from its config:
#                 auto          a queue action or `autoqueue` enqueues it; wait, and never enqueue by hand
#                 label <name>  the queue action is conditioned on that label; apply exactly it
#                 comment       no rule enqueues it; post the `@mergifyio queue` command
#                 unclear       the entry rule's label is one alternative among others; a person reads it
#                 github        the base branch uses GitHub's native merge queue; `gh pr merge --auto`
#   direct      the repository has no merge queue; merge-pr merges it
#   unknown     the PR or its base branch's rules could not be read (exit 2); nothing merges on a guess
#
# A repository has a merge queue when its Mergify config (.mergify.yml, .mergify/config.yml or
# .github/mergify.yml) declares queue_rules. Its exclusions are read from that same config, the
# negated `-files~=` and `-head~=` conditions, because an excluded PR often carries no label at all.
# The queue decides eligibility itself; a label applied by hand grants nothing.
set -uo pipefail

pr="${1:?usage: merge-route.sh <pr-number> [repo-root]}"
root="${2:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

unknown() { echo "merge-route: $1 — not routing #$pr to any merge" >&2; echo unknown; exit 2; }

pr_json="$(gh api "repos/{owner}/{repo}/pulls/${pr}" 2>/dev/null)" || unknown "could not read the PR"
merged="$(jq -r '.merged' <<<"$pr_json" 2>/dev/null)" || unknown "could not parse the PR"
if [[ "$merged" == "true" ]]; then
  echo "merge-route: #$pr is already merged" >&2
  echo merged
  exit 0
fi

labels="$(jq -r '[.labels[].name] | join(",")' <<<"$pr_json")"
hold="$(tr ',' '\n' <<<"$labels" | grep -E '^hold(:.*)?$' | grep -vx 'hold:hand-steps' | head -1 || true)"
if [[ -n "$hold" ]]; then
  echo "merge-route: #$pr carries $hold; its owner releases it" >&2
  echo held
  exit 0
fi

# entry <config> → how a PR enters the Mergify queue: "auto", "label <name>", "comment" or "unclear".
# Only pull_request_rules count (a priority rule's label sets priority, not entry). A rule whose
# actions include `queue` enqueues every PR its conditions match; a positive `label=` among its
# top-level conditions makes that label the way in. A positive label nested in `or:`/`and:` is one
# alternative, not a way in by itself: "unclear", for a person to read. `autoqueue: true` on a queue
# rule enqueues on its own. With none of these, a PR enters by the `@mergifyio queue` command.
entry() {
  awk '
    function indent(s) { return match(s, /[^ ]/) }
    function flush() {
      if (queue_action) {
        if (nested) { print "unclear"; found = 1; exit }
        if (label != "") { print "label " label; found = 1; exit }
        auto = 1
      }
      queue_action = 0; label = ""; nested = 0; in_actions = 0; in_conds = 0; item_indent = 0
    }
    /^[[:space:]]*autoqueue:[[:space:]]*true/ { auto = 1 }
    /^pull_request_rules:/ { in_rules = 1; next }
    /^[^[:space:]#]/ { if (in_rules) flush(); in_rules = 0 }
    !in_rules { next }
    /^[[:space:]]*-[[:space:]]*name:/ { flush(); next }
    /^[[:space:]]*actions:/ { in_actions = 1; in_conds = 0; act_indent = indent($0); next }
    /^[[:space:]]*conditions:/ { in_conds = 1; in_actions = 0; cond_indent = indent($0); item_indent = 0; next }
    in_actions {
      if (indent($0) <= act_indent) in_actions = 0
      else if ($0 ~ /^[[:space:]]*queue:/) queue_action = 1
    }
    in_conds && /^[[:space:]]*-/ {
      i = indent($0)
      if (i <= cond_indent) { in_conds = 0; next }
      if (item_indent == 0) item_indent = i
      if ($0 ~ /^[[:space:]]*-[[:space:]]*["\047]?label[[:space:]]*=[^=]/) {
        if (i > item_indent) { nested = 1; next }
        l = $0; sub(/^[[:space:]]*-[[:space:]]*["\047]?label[[:space:]]*=[[:space:]]*/, "", l); sub(/["\047]?[[:space:]]*$/, "", l)
        label = l
      }
    }
    END { if (!found) { if (in_rules) flush(); if (!found) print (auto ? "auto" : "comment") } }
  ' "$1"
}

mergify=""
for f in .mergify.yml .mergify/config.yml .github/mergify.yml; do
  [[ -f "$root/$f" ]] && grep -qE '^queue_rules:' "$root/$f" && { mergify="$root/$f"; break; }
done

if [[ ",$labels," == *",hold:hand-steps,"* ]]; then
  echo "merge-route: #$pr carries hold:hand-steps" >&2
  echo hand-merge
  exit 0
fi

if [[ -n "$mergify" ]]; then
  # The queue's own exclusions: `- -files~=<regex>` and `- -head~=<regex>`, quoted or not.
  terms() { sed -nE "s/^[[:space:]]*-[[:space:]]*[\"']?-$1~=(.*[^\"'[:space:]])[\"']?[[:space:]]*$/\1/p" "$mergify"; }
  file_terms="$(terms files)"
  head_terms="$(terms head)"
  if [[ -n "$file_terms" ]]; then
    files="$(gh api --paginate "repos/{owner}/{repo}/pulls/${pr}/files" 2>/dev/null | jq -r '.[].filename' 2>/dev/null)" \
      || unknown "could not read the changed files"
    while IFS= read -r re; do
      [[ -n "$re" ]] && grep -qE -- "$re" <<<"$files" && {
        echo "merge-route: #$pr changes a file the queue excludes ($re)" >&2
        echo hand-merge
        exit 0
      }
    done <<<"$file_terms"
  fi
  head_ref="$(jq -r '.head.ref // empty' <<<"$pr_json")"
  while IFS= read -r re; do
    [[ -n "$re" && -n "$head_ref" ]] && grep -qE -- "$re" <<<"$head_ref" && {
      echo "merge-route: #$pr's branch is one the queue excludes ($re)" >&2
      echo hand-merge
      exit 0
    }
  done <<<"$head_terms"
  echo "merge-route: the repository's merge queue merges #$pr" >&2
  echo "queue $(entry "$mergify")"
  exit 0
fi

base="$(jq -r '.base.ref // empty' <<<"$pr_json")"
[[ -n "$base" ]] || unknown "the PR names no base branch"
rules="$(gh api "repos/{owner}/{repo}/rules/branches/${base}" 2>/dev/null)" \
  || unknown "could not read the rules on $base"
if jq -e 'any(.[]?; .type == "merge_queue")' <<<"$rules" >/dev/null 2>&1; then
  echo "merge-route: $base uses GitHub's merge queue" >&2
  echo "queue github"
  exit 0
fi

echo "merge-route: no merge queue configured; merge-pr merges #$pr" >&2
echo direct
