import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { statsOf } from "../scripts/session-stats.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "session-stats.mjs");
const FIXTURE = join(ROOT, "test", "fixtures", "session-stats.jsonl");

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

const EXPECTED = `calls                 6  (4 joined to a result)
tool bash             5
tool edit             1
errors                2  (bash 1, edit 1)
failed edit calls     1
heredoc rewrites      1
sleep before checks   2
totalTokens           175
usage.cost.total      0.175000  (summed per response, never cumulative)
span                  2026-01-01T00:00:01.000Z .. 2026-01-01T00:00:09.000Z (8s)
`;

test("reports the fixture's counts from structured fields", () => {
  const out = run([FIXTURE]);
  assert.equal(out.status, 0);
  assert.equal(out.stdout, EXPECTED);
});

test("joins a result to its call by toolCallId, not by position", () => {
  // The fixture holds e2's failing result BEFORE e2's call. Pairing by position would
  // attach it to b1, reporting bash 2 errors and edit 0. The id join reports 1 and 1.
  const out = run([FIXTURE]).stdout;
  assert.match(out, /^errors {16}2 {2}\(bash 1, edit 1\)$/m);
  assert.match(out, /^failed edit calls {5}1$/m);
});

test("identical fixture content at two paths produces byte-identical output", () => {
  const a = mkdtempSync(join(tmpdir(), "strata-stats-a-"));
  const b = mkdtempSync(join(tmpdir(), "strata-stats-b-"));
  try {
    copyFileSync(FIXTURE, join(a, "one.jsonl"));
    copyFileSync(FIXTURE, join(b, "two.jsonl"));
    const first = run([join(a, "one.jsonl")]);
    const second = run([join(b, "two.jsonl")]);
    assert.equal(first.stdout, second.stdout);
    // The path is provenance, so it goes to stderr and cannot break determinism.
    assert.equal(first.stdout.includes(a), false);
    assert.match(first.stderr, /session-stats: /);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("writes nothing: the tree is unchanged after a run", () => {
  const before = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run([FIXTURE]).status, 0);
  const after = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(after, before);
});

test("imports node builtins only, and names no session path", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const specifiers = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) assert.match(specifier, /^node:/);
  assert.equal(source.includes("/Users/"), false);
  assert.equal(/"name": *"strata"/.test(source), false);
});

test("with no argument it reads a session log and still writes nothing", () => {
  const out = run([]);
  const missing = /no \*\.jsonl under/.test(out.stderr);
  if (missing) return; // no pi sessions on this machine; the path rule is the only claim
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^calls {17}\d+ {2}\(\d+ joined to a result\)$/m);
  assert.match(out.stdout, /usage\.cost\.total {6}[\d.]+ {2}\(summed per response, never cumulative\)$/m);
});

test("the same fixture through the exported function agrees with the CLI", () => {
  // Binds the script to a test entry point, so dead-code analysis sees it used, and checks
  // the numbers without going through the text form.
  const s = statsOf(FIXTURE);
  assert.equal(s.calls, 6);
  assert.equal(s.joined, 4);
  assert.equal(s.tokens, 175);
  assert.equal(s.heredocs, 1);
  assert.equal(s.sleeps, 2);
  assert.equal(s.errors.get("bash"), 1);
  assert.equal(s.errors.get("edit"), 1);
  assert.equal(s.errors.size, 2);
});
