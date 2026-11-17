// catalyst-toml-readers.test.mjs — the JS readers that moved from the retired JSON settings file to
// catalyst.toml (CTC-10759): the per-project secret file, the ask team and the ask human.
//
// Run: bun test tests/catalyst-toml-readers.test.mjs

import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const lib = fileURLToPath(new URL("../vendor-src/scripts/lib/", import.meta.url));
const { resolveLegacyPerTeamConfigPath } = await import(join(lib, "secret-contract.mjs"));
const { resolveAskHuman, resolveAskTeam } = await import(join(lib, "tenant-identity.mjs"));

function toml(dir, text) {
  mkdirSync(join(dir, ".catalyst"), { recursive: true });
  writeFileSync(join(dir, ".catalyst/catalyst.toml"), text);
}
const root = () => mkdtempSync(join(tmpdir(), "toml-readers-"));
const HOME_ENV = (home) => ({ HOME: home, XDG_CONFIG_HOME: join(home, ".config") });

describe("the per-project secret file follows the nearest catalyst.toml", () => {
  test("positive control: a repository that declares its default repository keys the file by name", () => {
    const r = root();
    toml(r, '[project.repositories]\ndefault = "acme/outer"\n');
    expect(resolveLegacyPerTeamConfigPath(HOME_ENV("/h"), r)).toBe("/h/.config/catalyst/config-outer.json");
  });

  test("a nested checkout with its own catalyst.toml and no default does not borrow the outer repository's key", () => {
    const r = root();
    toml(r, '[project.repositories]\ndefault = "acme/outer"\n');
    const inner = join(r, "inner");
    toml(inner, '[project]\nlinear_team = "ENG"\n');
    expect(resolveLegacyPerTeamConfigPath(HOME_ENV("/h"), inner)).toBe("/h/.config/catalyst/config.json");
  });
});

describe("the ask team", () => {
  test("a catalyst.toml named by CATALYST_CONFIG_FILE is read where it is, not searched for from the working directory", () => {
    const r = root();
    toml(r, '[project]\nlinear_team = "ENG"\n');
    const elsewhere = root();
    const env = { ...HOME_ENV("/h"), CATALYST_CONFIG_FILE: join(r, ".catalyst/catalyst.toml") };
    const was = process.cwd();
    process.chdir(elsewhere);
    try {
      expect(resolveAskTeam({ env })).toEqual({ ok: true, team: "ENG", source: "layer1" });
      expect(resolveAskTeam({ env: HOME_ENV("/h"), layer1ConfigPath: join(r, ".catalyst/catalyst.toml") }).team).toBe("ENG");
    } finally {
      process.chdir(was);
    }
  });
});

describe("the ask human", () => {
  const home = root();
  const env = HOME_ENV(home);

  test("the Linear user the account matched is a resolver rung, after the overrides", () => {
    const calls = [];
    const linearIdentityCli = () => (calls.push(1), { linearUserId: "user-matched" });
    expect(resolveAskHuman({ env, linearIdentityCli })).toMatchObject({ ok: true, humanId: "user-matched", source: "matched" });
    expect(resolveAskHuman({ env: { ...env, ASK_HUMAN_ID: "user-env" }, linearIdentityCli })).toMatchObject({ humanId: "user-env", source: "env" });
    expect(calls).toHaveLength(1); // an override means the CLI is never asked
  });

  test("an unmatched or unavailable account is a named failure, never a guess", () => {
    expect(resolveAskHuman({ env, linearIdentityCli: () => undefined })).toMatchObject({ ok: false, reason: "human-not-configured" });
    expect(resolveAskHuman({ env, linearIdentityCli: () => ({ linearUserId: "  " }) })).toMatchObject({ ok: false });
  });

  test("with an injected environment and no stub, the real CLI is never run", () => {
    expect(resolveAskHuman({ env })).toMatchObject({ ok: false, reason: "human-not-configured" });
  });
});
