#!/usr/bin/env node
// release-tag.mjs — tag a merged development-pack release, or verify a pushed release tag.
//
// A release is the annotated tag `dev-skills-v<version>` on the exact `main` commit whose
// package.json and .claude-plugin/plugin.json both carry <version>. Tagging refuses a commit that is
// not on the remote's main, a version off the shared release line, a tag the remote already has,
// and a version older than a release the remote already has (nothing goes backwards). It creates
// the tag locally and prints the push; a person pushes it. --verify re-reads a pushed tag.
//
// Run: node scripts/release-tag.mjs <commit> --train <cloud-pack-checkout> [--remote origin]
//      node scripts/release-tag.mjs --verify <tag> [--remote origin]
// Exit 0 done, 1 refused, 2 unread (a git read or the declaration failed).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PACK, compareVersions, devSkillsTag, exactVersion, lineRefusal, readDeclaration } from "./check-release-line.mjs";

const TAG = /^dev-skills-v(.+)$/;

class Unread extends Error {}
class Refused extends Error {}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Unread(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function versionsAt(cwd, commit) {
  const read = (path) => JSON.parse(git(cwd, ["show", `${commit}:${path}`])).version;
  return { pkg: read("package.json"), plugin: read(".claude-plugin/plugin.json") };
}

/** Fetch the remote's main into FETCH_HEAD (this checkout's refspec may not track main). */
const fetchMain = (cwd, remote) => git(cwd, ["fetch", "--quiet", remote, "refs/heads/main"]);

/** Whether `commit` is on the main that fetchMain last fetched. */
const onFetchedMain = (cwd, commit) =>
  spawnSync("git", ["merge-base", "--is-ancestor", commit, "FETCH_HEAD"], { cwd }).status === 0;

/** Every dev-skills-v* tag on the remote, as { tag: commit }, an annotated tag peeled. */
export function remoteTags(cwd, remote) {
  const tags = {};
  for (const line of git(cwd, ["ls-remote", "--tags", remote, "refs/tags/dev-skills-v*"]).split("\n").filter(Boolean)) {
    const [sha, ref] = line.split("\t");
    const name = ref.slice("refs/tags/".length).replace(/\^\{\}$/, "");
    if (ref.endsWith("^{}") || !(name in tags)) tags[name] = sha;
  }
  return tags;
}

/** Check `commit` and create its release tag locally. Returns the lines to print. */
export function tagRelease(cwd, commit, { declaration, remote = "origin" }) {
  fetchMain(cwd, remote); // first, so a merge commit named on GitHub resolves here
  const sha = git(cwd, ["rev-parse", "--verify", `${commit}^{commit}`]);
  if (!onFetchedMain(cwd, sha)) throw new Refused(`${sha} is not on ${remote} main`);
  const { pkg, plugin } = versionsAt(cwd, sha);
  if (pkg !== plugin) throw new Refused(`package.json is ${pkg} but .claude-plugin/plugin.json is ${plugin} at ${sha}`);
  const off = lineRefusal(pkg, declaration);
  if (off) throw new Refused(off);
  const tag = devSkillsTag(pkg);
  const tags = remoteTags(cwd, remote);
  if (tags[tag]) throw new Refused(`${tag} already exists on ${remote} (it names ${tags[tag]})`);
  const newer = Object.keys(tags)
    .map((name) => TAG.exec(name)?.[1])
    .filter((v) => exactVersion(v) && compareVersions(v, pkg) > 0)
    .sort(compareVersions)
    .pop();
  if (newer) throw new Refused(`nothing goes backwards: ${remote} already has ${devSkillsTag(newer)}, newer than ${pkg}`);
  const local = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { cwd, encoding: "utf8" }).stdout.trim();
  if (local && local !== sha) throw new Refused(`a local ${tag} names ${local}; delete it or tag that commit`);
  if (!local) git(cwd, ["tag", "-a", tag, "-m", `${PACK} ${pkg}`, sha]);
  return [
    `${tag} names ${sha} (${PACK} ${pkg}, on ${remote} main)`,
    `${local ? "the annotated tag already exists locally" : "created the annotated tag locally"}; push it with:`,
    `  git push ${remote} refs/tags/${tag}`,
  ];
}

/** Re-read a pushed release tag from the remote. Returns the line to print. */
export function verifyTag(cwd, tag, { remote = "origin" } = {}) {
  const version = TAG.exec(tag)?.[1];
  if (!exactVersion(version)) throw new Refused(`${tag} is not a dev-skills-v<MAJOR.MINOR.PATCH> tag`);
  const sha = remoteTags(cwd, remote)[tag];
  if (!sha) throw new Refused(`${remote} has no tag ${tag}`);
  git(cwd, ["fetch", "--quiet", remote, `refs/tags/${tag}`]);
  const { pkg, plugin } = versionsAt(cwd, sha);
  if (pkg !== version || plugin !== version)
    throw new Refused(`${tag} names ${sha}, where package.json is ${pkg} and .claude-plugin/plugin.json is ${plugin}`);
  fetchMain(cwd, remote);
  if (!onFetchedMain(cwd, sha)) throw new Refused(`${tag} names ${sha}, which is not on ${remote} main`);
  return `${tag} names ${sha} on ${remote} main; package.json and .claude-plugin/plugin.json there read ${version}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const remote = flag("--remote") ?? "origin";
  const verify = flag("--verify");
  const train = flag("--train");
  const usage = "usage: node scripts/release-tag.mjs <commit> --train <cloud-pack-checkout> [--remote origin]\n       node scripts/release-tag.mjs --verify <tag> [--remote origin]";
  try {
    if (verify !== undefined && args.length === 0 && train === undefined) console.log(verifyTag(process.cwd(), verify, { remote }));
    else if (verify === undefined && args.length === 1 && train !== undefined)
      console.log(tagRelease(process.cwd(), args[0], { declaration: readDeclaration(train), remote }).join("\n"));
    else {
      console.error(usage);
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = error instanceof Refused ? 1 : 2;
  }
}
