import { test } from "node:test";
import { riskOf } from "../src/commands/blast.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "strata.mjs");

function sh(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "strata-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "test@example.com"]);
  sh(root, ["config", "user.name", "test"]);
  mkdirSync(join(root, "src/billing"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", description: "a fixture", bin: { fx: "./src/cli.ts" } }));
  writeFileSync(join(root, "src/db.ts"), "export const db = 1;\n");
  writeFileSync(join(root, "src/billing/invoice.ts"), 'import { db } from "../db";\nexport const invoice = 1;\n');
  writeFileSync(join(root, "src/billing/ledger.ts"), 'import { invoice } from "./invoice";\nexport const ledger = 1;\n');
  writeFileSync(join(root, "src/billing/ledger.test.ts"), 'import { ledger } from "./ledger";\n');
  writeFileSync(join(root, "src/cli.ts"), 'import { ledger } from "./billing/ledger";\nimport x from "some-external";\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "base"]);
  return root;
}

function run(cwd, args) {
  return execFileSync(process.execPath, [BIN, ...args, "--root", cwd], { cwd, encoding: "utf8" });
}

test("index writes a graph with resolved relative edges and records the unresolved one", () => {
  const root = fixture();
  const out = run(root, ["index"]);
  assert.match(out, /strata index/);
  assert.ok(existsSync(join(root, ".strata/index.json")));
  assert.ok(existsSync(join(root, ".strata/MAP.md")));

  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const pairs = data.edges.map((e) => `${e.from}->${e.to}`);
  assert.ok(pairs.includes("src/billing/invoice.ts->src/db.ts"), "relative import resolves");
  assert.ok(pairs.includes("src/billing/ledger.ts->src/billing/invoice.ts"));
  assert.equal(data.unresolved.length, 1, "bare specifier is unresolved, not invented");
  assert.equal(data.unresolved[0].spec, "some-external");

  const map = readFileSync(join(root, ".strata/MAP.md"), "utf8");
  assert.match(map, /Everything depends on these/);
  assert.match(map, /src\/db\.ts/);

  const ledger = data.files.find((f) => f.path === "src/billing/ledger.ts");
  assert.deepEqual(ledger.tests, ["src/billing/ledger.test.ts"], "test file matched by convention");
  const invoice = data.files.find((f) => f.path === "src/billing/invoice.ts");
  assert.deepEqual(invoice.tests, [], "no test next to invoice.ts");
});

test("blast reports the reverse closure of a changed file, deterministic and offline", () => {
  const root = fixture();
  run(root, ["index"]);
  writeFileSync(join(root, "src/db.ts"), "export const db = 2;\n");
  const out = run(root, ["blast", "--since", "HEAD"]);
  assert.match(out, /strata blast/);
  assert.match(out, /1 changed file/);
  assert.match(out, /src\/billing\/invoice\.ts/, "direct importer is listed");
});

test("blast --json is parseable and includes seeds with risk", () => {
  const root = fixture();
  run(root, ["index"]);
  writeFileSync(join(root, "src/db.ts"), "export const db = 3;\n");
  const json = JSON.parse(run(root, ["blast", "--since", "HEAD", "--json"]));
  assert.deepEqual(json.changed, ["src/db.ts"]);
  assert.ok(json.affected.direct.includes("src/billing/invoice.ts"));
  assert.deepEqual(json.seeds.map((s) => s.path), ["src/db.ts"]);
});

test("status with no index tells the user what to run instead of scanning", () => {
  const root = fixture();
  const out = run(root, ["status"]);
  assert.match(out, /Run `strata index`/);
});

test("a second concurrent run refuses rather than interleaving writes", () => {
  const root = fixture();
  mkdirSync(join(root, ".strata"), { recursive: true });
  writeFileSync(join(root, ".strata/lock"), "999999");
  try {
    run(root, ["index"]);
    assert.fail("expected the lock to block the run");
  } catch (err) {
    assert.match(String(err.stderr || err.message), /holding|holds|refusing/);
  }
});

test("risk thresholds escalate on fan-in and churn", () => {
  assert.equal(riskOf({ fanIn: 1, churn: 0 }), "LOW");
  assert.equal(riskOf({ fanIn: 5, churn: 0 }), "MEDIUM");
  assert.equal(riskOf({ fanIn: 0, churn: 10 }), "MEDIUM");
  assert.equal(riskOf({ fanIn: 20, churn: 0 }), "HIGH");
  assert.equal(riskOf({ fanIn: 10, churn: 10 }), "HIGH");
});
