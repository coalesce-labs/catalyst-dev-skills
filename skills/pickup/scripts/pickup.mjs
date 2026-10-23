#!/usr/bin/env node
// pickup.mjs — the two decisions the pickup skill makes from data, so every run makes them the same way.
//
// Usage:
//   catalyst lease take <TICKET> --agent <name> --json | node pickup.mjs lease
//   node pickup.mjs facts <TICKET> | node pickup.mjs verdict
//
// `lease` reads the take's JSON. A grant prints `lease: taken …` and exits 0. A refusal or rejection
// prints who or what holds the ticket and until when, and exits 3: the caller loads nothing and
// changes nothing. No JSON at all (the CLI is not connected) exits 2.
//
// `facts` reads the ticket's branch, pull request, review threads and documents from git, gh and
// thoughts/shared, and prints them as JSON. `verdict` reads that JSON and prints `verdict:` (continue,
// restart or done) and one `reason:` line. Exit 2 when the input is unusable.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TICKET_RE = /^[A-Z][A-Z0-9]*-[0-9]+$/;

const iso = (ms) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : "unknown");

// A name or title mentions the ticket when the id stands alone: no letter or digit before it and no
// digit after it, so PROJ-1 never matches PROJ-10 and OPS-12 never matches DEVOPS-12.
export function mentionsTicket(text, ticket) {
  const upper = String(text ?? "").toUpperCase();
  for (let at = upper.indexOf(ticket); at >= 0; at = upper.indexOf(ticket, at + 1)) {
    const before = at === 0 ? "" : upper[at - 1];
    const after = upper[at + ticket.length] ?? "";
    if (!/[A-Z0-9]/.test(before) && !/[0-9]/.test(after)) return true;
  }
  return false;
}

// The take's JSON → { code, lines }. Exit code 0 means this agent now holds the ticket.
export function leaseOutcome(result) {
  if (result?.outcome === "taken" && result.lease) {
    const l = result.lease;
    const lines = [
      `lease: taken, generation ${l.generation}, live until ${iso(l.deadlineMs)} (hard deadline ${iso(l.hardDeadlineMs)})`,
    ];
    if (result.minted === false) lines.push("lease: you already held it; this is the same grant");
    if (l.lastHolder) lines.push(`previous holder: ${l.lastHolder}`);
    if (l.lastProgress) lines.push(`last progress: ${l.lastProgress} at ${iso(l.lastProgressAtMs)}`);
    return { code: 0, lines };
  }
  if (result?.outcome === "refused" && result.refusal) {
    const { reason, current, occupied, retryAtMs } = result.refusal;
    const lines = [];
    if (reason === "ticket_lease_held" && current?.holder) {
      lines.push(`lease: held by ${current.holder} until ${iso(current.deadlineMs)}`);
    } else if (reason === "phase_lease_held" && occupied?.scope === "phase") {
      lines.push(`lease: a running ${occupied.phase} phase (${occupied.kind}) occupies the ticket`);
    } else {
      lines.push(`lease: refused, ${reason}`);
    }
    if (retryAtMs != null) lines.push(`retry at: ${iso(retryAtMs)}`);
    if (reason === "project_deleting") lines.push("retry at: never, the ticket's project is being deleted");
    return { code: 3, lines };
  }
  // Any other answer with an HTTP status (a 403, a 404 from an older cloud, a 429 write budget) is
  // the cloud saying no, not a missing connection.
  if (result?.outcome === "rejected" || typeof result?.status === "number") {
    const why = result.reason ?? result.error ?? result.message ?? "no reason given";
    return { code: 3, lines: [`lease: rejected by the cloud (HTTP ${result.status ?? "?"}), ${why}`] };
  }
  return { code: 2, lines: ["lease: the take printed no JSON this skill knows (not connected?); nothing was loaded"] };
}

// The facts → { verdict, reason }. Pure: every input comes from `facts`.
export function pickupVerdict(f) {
  const pr = f.pr ?? null;
  const branch = f.branch ?? null;
  if (pr?.state === "MERGED") {
    return {
      verdict: "done",
      reason: `pull request #${pr.number} merged; nothing is left to continue, so release the lease`,
    };
  }
  if (pr?.state === "CLOSED") {
    return {
      verdict: "restart",
      reason: `pull request #${pr.number} was closed without merging, so its branch is not a base to build on`,
    };
  }
  if (!branch?.exists) {
    return { verdict: "restart", reason: "no branch or open pull request names the ticket" };
  }
  if (!pr && branch.aheadBy === 0) {
    return {
      verdict: "restart",
      reason: `branch ${branch.name} carries no commits beyond its base and has no pull request`,
    };
  }
  const parts = [`branch ${branch.name} at ${String(branch.head).slice(0, 12)}`];
  parts.push(pr ? `pull request #${pr.number} open${pr.isDraft ? " as a draft" : ""}` : "no pull request yet");
  if (pr?.unresolvedThreads > 0) parts.push(`${pr.unresolvedThreads} unresolved review thread(s) to answer first`);
  if (pr?.mergeable === "CONFLICTING") parts.push("it conflicts with its base, so merge the base first");
  if (f.handoff?.recordedHead && branch.head && f.handoff.recordedHead !== branch.head) {
    parts.push(`the branch moved since the handoff recorded ${f.handoff.recordedHead.slice(0, 12)}`);
  }
  if (!f.handoff) parts.push("no handoff document was found");
  if ((f.otherBranches ?? []).length > 0) parts.push(`also named by ${f.otherBranches.join(", ")}`);
  return { verdict: "continue", reason: parts.join("; ") };
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function newestDocs(dir, ticket) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue; // a dangling link names no document
      }
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".md") && mentionsTicket(p, ticket)) found.push({ p, t: st.mtimeMs });
    }
  };
  walk(dir);
  return found.sort((a, b) => b.t - a.t).map((x) => x.p);
}

function gatherFacts(ticket) {
  const prs = JSON.parse(
    run("gh", ["pr", "list", "--state", "all", "--search", ticket, "--limit", "20", "--json",
      "number,title,state,isDraft,headRefName,headRefOid,baseRefName,mergeable,updatedAt"]) ?? "[]",
  ).filter((p) => mentionsTicket(p.title, ticket) || mentionsTicket(p.headRefName, ticket));
  prs.sort((a, b) => (a.state === "OPEN") - (b.state === "OPEN") || a.updatedAt.localeCompare(b.updatedAt));
  const pr = prs.at(-1) ?? null;

  const remote = (run("git", ["ls-remote", "--heads", "origin"]) ?? "")
    .split("\n").map((l) => l.split(/\s+/)[1]?.replace("refs/heads/", ""))
    .filter((n) => n && mentionsTicket(n, ticket));
  let name = pr?.headRefName ?? null;
  if (!name && remote.length > 0) {
    run("git", ["fetch", "--quiet", "origin", ...remote]);
    const dated = remote.map((n) => ({ n, t: Number(run("git", ["log", "-1", "--format=%ct", `origin/${n}`]) ?? 0) }));
    name = dated.sort((a, b) => b.t - a.t)[0].n;
  }
  let branch = null;
  if (name) {
    run("git", ["fetch", "--quiet", "origin", name]);
    const head = run("git", ["rev-parse", "--verify", "--quiet", `origin/${name}`]);
    const base = pr?.baseRefName ?? run("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"])?.replace("origin/", "") ?? "main";
    const ahead = head ? Number(run("git", ["rev-list", "--count", `origin/${base}..origin/${name}`]) ?? NaN) : 0;
    branch = { name, exists: Boolean(head), head, base, aheadBy: Number.isNaN(ahead) ? null : ahead };
  }

  let prFacts = null;
  if (pr) {
    const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]) ?? "";
    const [owner, repoName] = repo.split("/");
    const threads = run("gh", ["api", "graphql", "-F", `owner=${owner}`, "-F", `name=${repoName}`, "-F", `n=${pr.number}`,
      "-f", "query=query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}",
      "-q", "[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved|not)]|length"]);
    prFacts = { number: pr.number, state: pr.state, isDraft: pr.isDraft, headSha: pr.headRefOid,
      mergeable: pr.mergeable, unresolvedThreads: threads == null ? null : Number(threads) };
  }

  const handoffs = newestDocs("thoughts/shared/handoffs", ticket);
  const recorded = handoffs[0] ? readFileSync(handoffs[0], "utf8").match(/^git_commit:\s*([0-9a-f]{40})\s*$/m)?.[1] : null;
  return {
    ticket,
    branch,
    otherBranches: remote.filter((n) => n !== name),
    pr: prFacts,
    handoff: handoffs[0] ? { path: handoffs[0], recordedHead: recorded ?? null } : null,
    documents: [...newestDocs("thoughts/shared/plans", ticket), ...newestDocs("thoughts/shared/research", ticket)],
  };
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function main(argv) {
  const [cmd, arg] = argv;
  if (cmd === "lease") {
    const { code, lines } = leaseOutcome(readStdin());
    for (const l of lines) console.log(l);
    return code;
  }
  if (cmd === "facts" && TICKET_RE.test(arg ?? "")) {
    console.log(JSON.stringify(gatherFacts(arg), null, 2));
    return 0;
  }
  if (cmd === "verdict") {
    const facts = readStdin();
    if (!facts) {
      console.error("verdict: no facts JSON on stdin");
      return 2;
    }
    const { verdict, reason } = pickupVerdict(facts);
    console.log(`verdict: ${verdict}`);
    console.log(`reason: ${reason}`);
    return 0;
  }
  console.error("usage: pickup.mjs lease | facts <TICKET> | verdict");
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
