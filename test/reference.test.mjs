import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "reference-index.mjs");

const sh = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

/** A repo with one real edge: a.ts imports b.ts. */
function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "strata-ref-"));
  sh(dir, "git", ["init", "-b", "main"]);
  sh(dir, "git", ["config", "user.email", "test@example.com"]);
  sh(dir, "git", ["config", "user.name", "test"]);
  writeFileSync(join(dir, "b.ts"), "export const b = 1;\n");
  writeFileSync(join(dir, "a.ts"), 'import { b } from "./b";\nexport const a = b;\n');
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-m", "one edge"]);
  return dir;
}

const baselinePath = () => join(mkdtempSync(join(tmpdir(), "strata-baseline-")), "baseline.json");

test("the reference check passes when nothing changed and fails when a language loses edges", () => {
  const repo = fixtureRepo();
  const baseline = baselinePath();

  const wrote = run(["--write", "--baseline", baseline, repo]);
  assert.equal(wrote.status, 0, wrote.stderr);
  assert.match(wrote.stdout, /recorded .* 1 edges/);

  const same = run(["--baseline", baseline]);
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /^ok/m, "an unchanged repo passes");

  // Delete the import: the one TypeScript edge is gone, which must be loud.
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  sh(repo, "git", ["add", "-A"]);
  sh(repo, "git", ["commit", "-m", "drop the edge"]);

  const broke = run(["--baseline", baseline]);
  assert.equal(broke.status, 1, "a lost edge is a failure, not a note");
  assert.match(broke.stdout, /LOST/);
  assert.match(broke.stdout, /typescript: 1 -> 0/);
  assert.match(broke.stdout, /repo moved since baseline/, "the record says the repo moved");
});

test("the reference check skips a repo that is not on this machine", () => {
  const baseline = baselinePath();
  writeFileSync(
    baseline,
    JSON.stringify([
      { name: "gone", root: join(tmpdir(), "strata-does-not-exist-xyz"), head: "abc1234", dirty: 0, edges: 9, unresolved: 0, byLang: { typescript: 9 } },
    ]),
  );
  const res = run(["--baseline", baseline]);
  assert.equal(res.status, 0, "a missing repo is not a regression");
  assert.match(res.stdout, /skip\s+gone/);
});

test("the reference check refuses to guess without a baseline", () => {
  const res = run(["--baseline", join(tmpdir(), "strata-nope", "missing.json")]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--write/);
});
