// release-tag.test.mjs — a release tag names the exact main commit that carries its version.
//
// Each case builds a scratch remote (a bare repository standing in for origin) and a clone of it
// holding only the two version files, then runs the command from inside the clone.
//
// Run: bun test tests/release-tag.test.mjs
import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts/release-tag.mjs");
const scratch = mkdtempSync(join(tmpdir(), "release-tag-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
};
function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

const train = join(scratch, "cloud-pack");
mkdirSync(train);
writeFileSync(join(train, "release-train.json"), JSON.stringify({ releaseLine: "0.16", state: "aligned" }));

let n = 0;
/** A bare remote and a clone of it whose main carries `version` in both files. */
function repo(version = "0.16.0") {
  const root = join(scratch, `r${++n}`);
  mkdirSync(root);
  git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(root, "clone", "-q", join(root, "origin.git"), "work");
  const work = join(root, "work");
  git(work, "checkout", "-q", "-B", "main");
  return { work, commit: (pkg, plugin = pkg, push = true) => commit(work, pkg, plugin, push), sha: commit(work, version, version, true) };
}
function commit(work, pkg, plugin, push) {
  mkdirSync(join(work, ".claude-plugin"), { recursive: true });
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "catalyst-dev-skills", version: pkg }));
  writeFileSync(join(work, ".claude-plugin/plugin.json"), JSON.stringify({ name: "catalyst-dev", version: plugin }));
  git(work, "add", "-A");
  git(work, "commit", "-q", "--allow-empty", "-m", `${pkg}/${plugin}`);
  if (push) git(work, "push", "-q", "origin", "HEAD:refs/heads/main");
  return git(work, "rev-parse", "HEAD");
}
const run = (cwd, ...args) => spawnSync("node", [script, ...args], { cwd, env, encoding: "utf8" });
const remoteTags = (work) => git(work, "ls-remote", "--tags", "origin");

describe("tagging a merged release", () => {
  test("a main commit on the line gets an annotated tag naming it, created locally and never pushed", () => {
    const { work, sha } = repo();
    const r = run(work, sha, "--train", train);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")).toEqual([
      `dev-skills-v0.16.0 names ${sha} (catalyst-dev-skills 0.16.0, on origin main)`,
      "created the annotated tag locally; push it with:",
      "  git push origin refs/tags/dev-skills-v0.16.0",
      "",
    ]);
    expect(git(work, "cat-file", "-t", "dev-skills-v0.16.0")).toBe("tag");
    expect(git(work, "rev-parse", "dev-skills-v0.16.0^{commit}")).toBe(sha);
    expect(remoteTags(work)).toBe("");
  });

  test("running it again before the push is harmless", () => {
    const { work, sha } = repo();
    expect(run(work, sha, "--train", train).status).toBe(0);
    const again = run(work, sha, "--train", train);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("the annotated tag already exists locally");
  });

  test("a commit that is not on the remote's main is refused", () => {
    const { work, commit } = repo();
    const side = commit("0.16.1", "0.16.1", false);
    const r = run(work, side, "--train", train);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(`${side} is not on origin main`);
  });

  test("version files that disagree are refused", () => {
    const { work, commit } = repo();
    const sha = commit("0.16.1", "0.16.0");
    const r = run(work, sha, "--train", train);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(`package.json is 0.16.1 but .claude-plugin/plugin.json is 0.16.0 at ${sha}`);
  });

  test("a version off the release line is refused", () => {
    const { work, commit } = repo();
    const r = run(work, commit("15.0.2"), "--train", train);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("catalyst-dev-skills@15.0.2 is off release line 0.16");
  });

  test("a tag the remote already has is never made again", () => {
    const { work, sha } = repo();
    run(work, sha, "--train", train);
    git(work, "push", "-q", "origin", "refs/tags/dev-skills-v0.16.0");
    const r = run(work, sha, "--train", train);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(`dev-skills-v0.16.0 already exists on origin (it names ${sha})`);
  });

  test("nothing goes backwards: a version older than a pushed release is refused", () => {
    const { work, commit } = repo();
    git(work, "tag", "-a", "dev-skills-v0.16.2", "-m", "x", commit("0.16.2"));
    git(work, "push", "-q", "origin", "refs/tags/dev-skills-v0.16.2");
    const r = run(work, commit("0.16.1"), "--train", train);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("nothing goes backwards: origin already has dev-skills-v0.16.2, newer than 0.16.1");
  });

  test("an unread declaration or a missing --train is exit 2", () => {
    const { work, sha } = repo();
    expect(run(work, sha, "--train", join(scratch, "nowhere")).status).toBe(2);
    expect(run(work, sha).status).toBe(2);
    expect(remoteTags(work)).toBe("");
  });
});

describe("verifying a pushed tag", () => {
  test("a pushed release tag is read back from the remote", () => {
    const { work, sha } = repo();
    run(work, sha, "--train", train);
    git(work, "push", "-q", "origin", "refs/tags/dev-skills-v0.16.0");
    const r = run(work, "--verify", "dev-skills-v0.16.0");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      `dev-skills-v0.16.0 names ${sha} on origin main; package.json and .claude-plugin/plugin.json there read 0.16.0`,
    );
  });

  test("a tag on a commit that carries another version is refused", () => {
    const { work, sha } = repo("0.16.1");
    git(work, "tag", "dev-skills-v0.16.5", sha);
    git(work, "push", "-q", "origin", "refs/tags/dev-skills-v0.16.5");
    const r = run(work, "--verify", "dev-skills-v0.16.5");
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(`dev-skills-v0.16.5 names ${sha}, where package.json is 0.16.1 and .claude-plugin/plugin.json is 0.16.1`);
  });

  test("a tag off main is refused", () => {
    const { work, commit } = repo();
    const side = commit("0.16.1", "0.16.1", false);
    git(work, "tag", "dev-skills-v0.16.1", side);
    git(work, "push", "-q", "origin", "refs/tags/dev-skills-v0.16.1");
    const r = run(work, "--verify", "dev-skills-v0.16.1");
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(`dev-skills-v0.16.1 names ${side}, which is not on origin main`);
  });

  test("a missing tag, or a name that is not a release tag, is refused", () => {
    const { work } = repo();
    expect(run(work, "--verify", "dev-skills-v0.16.9").stderr.trim()).toBe("origin has no tag dev-skills-v0.16.9");
    expect(run(work, "--verify", "skills-bundle-v0.16.0").stderr.trim()).toBe(
      "skills-bundle-v0.16.0 is not a dev-skills-v<MAJOR.MINOR.PATCH> tag",
    );
  });
});

test("a pushed dev-skills-v* tag runs the verify in GitHub Actions", () => {
  const wf = readFileSync(join(repoRoot, ".github/workflows/release-tag.yml"), "utf8");
  expect(wf).toContain('- "dev-skills-v*"');
  expect(wf).toContain("fetch-depth: 0");
  expect(wf).toContain("contents: read");
  expect(wf).toContain('node scripts/release-tag.mjs --verify "$GITHUB_REF_NAME"');
});
