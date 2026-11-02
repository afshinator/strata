import { test } from "node:test";
import { riskOf } from "../src/commands/blast.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "strata.mjs");
const STORE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "store.mjs");

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
  assert.equal(data.unresolved.length, 0, "external dependency is not a repo edge and not a failure");
  assert.ok(data.stats.external["external dependency (tsconfig paths not modelled in v0.1)"] >= 1);

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

test("a stale lock is reclaimed instead of bricking the next run", () => {
  const root = fixture();
  // A pid that has certainly exited: its own child printed it as it died.
  const deadPid = execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).trim();
  mkdirSync(join(root, ".strata"), { recursive: true });
  writeFileSync(join(root, ".strata/lock"), deadPid);
  const out = run(root, ["index"]);
  assert.match(out, /strata index/);
  assert.ok(!existsSync(join(root, ".strata/lock")), "the reclaimed lock is gone");
});

test("a live lock still refuses rather than interleaving writes", () => {
  const root = fixture();
  mkdirSync(join(root, ".strata"), { recursive: true });
  writeFileSync(join(root, ".strata/lock"), String(process.pid));
  try {
    run(root, ["index"]);
    assert.fail("expected the lock to block the run");
  } catch (err) {
    assert.match(String(err.stderr || err.message), /holding|holds|refusing/);
  }
});

test("a failure while recording the holder leaves no lock behind", () => {
  const root = fixture();
  const lockPath = join(root, ".strata/lock");
  // Fault injection: only the lock's own fd write fails, so the leak path is exercised.
  const script = `
    import { createRequire, syncBuiltinESMExports } from "node:module";
    const req = createRequire(import.meta.url + "x");
    const fs = req("node:fs");
    const real = fs.writeFileSync;
    let armed = false;
    fs.writeFileSync = function (t, ...r) {
      if (armed && typeof t === "number") throw new Error("ENOSPC");
      return real.call(fs, t, ...r);
    };
    syncBuiltinESMExports();
    armed = true;
    const store = await import(${JSON.stringify(STORE)});
    const lk = store.lock(${JSON.stringify(root)});
    console.log(lk === null ? "refused" : "held", fs.existsSync(${JSON.stringify(lockPath)}) ? "leaked" : "clean");
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(out.trim(), "refused clean");
});

test("risk thresholds escalate on fan-in and churn", () => {
  assert.equal(riskOf({ fanIn: 1, churn: 0 }), "LOW");
  assert.equal(riskOf({ fanIn: 5, churn: 0 }), "MEDIUM");
  assert.equal(riskOf({ fanIn: 0, churn: 10 }), "MEDIUM");
  assert.equal(riskOf({ fanIn: 20, churn: 0 }), "HIGH");
  assert.equal(riskOf({ fanIn: 10, churn: 10 }), "HIGH");
});

test("workspace packages resolve through the root manifest instead of flooding QUESTIONS.md", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-ws-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "t@example.com"]);
  sh(root, ["config", "user.name", "t"]);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "mono", workspaces: ["packages/*"] }));
  mkdirSync(join(root, "packages/core/src"), { recursive: true });
  mkdirSync(join(root, "packages/app/src"), { recursive: true });
  writeFileSync(join(root, "packages/core/package.json"), JSON.stringify({ name: "@m/core", main: "./src/index.ts" }));
  writeFileSync(join(root, "packages/core/src/index.ts"), "export const core = 1;\n");
  writeFileSync(join(root, "packages/app/package.json"), JSON.stringify({ name: "@m/app" }));
  writeFileSync(join(root, "packages/app/src/main.ts"), 'import { core } from "@m/core";\nimport fs from "node:fs";\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "mono"]);

  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.ok(
    data.edges.some((e) => e.from === "packages/app/src/main.ts" && e.to === "packages/core/src/index.ts"),
    "workspace import resolves to the package entry",
  );
  assert.equal(data.unresolved.length, 0, "node builtin and workspace import are both accounted for");
});

test("edge identity is (from,to): repeated import sites of one target collapse to one edge", () => {
  const root = fixture();
  writeFileSync(
    join(root, "src/dupe.ts"),
    'import { db } from "./db";\nimport { db as again } from "./db";\nimport { db as third } from "./db.ts";\n',
  );
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "dupe"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const hits = data.edges.filter((e) => e.from === "src/dupe.ts" && e.to === "src/db.ts");
  assert.equal(hits.length, 1, "two import sites, one edge");
  assert.equal(
    new Set(data.edges.map((e) => `${e.from}>${e.to}`)).size,
    data.edges.length,
    "every published edge is unique",
  );
});

test("commit count matches git's count for the same window", () => {
  const root = fixture();
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const expected = Number(sh(root, ["rev-list", "--count", "--since=90.days", "--no-merges", "HEAD"]).trim());
  assert.equal(data.stats.commitsConsidered, expected, "no phantom commit from the log prefix");
});

test("blast reports the edge tier in text and JSON", () => {
  const root = fixture();
  run(root, ["index"]);
  writeFileSync(join(root, "src/db.ts"), "export const db = 4;\n");
  const json = JSON.parse(run(root, ["blast", "--since", "HEAD", "--json"]));
  assert.equal(json.tier, "regex");
  assert.match(run(root, ["blast", "--since", "HEAD"]), /tier regex/);
  assert.match(run(root, ["blast", "--since", "HEAD", "--sketch"]), /tier regex/);
});

test("usage documents the flags that exist and omits the ones that do not", () => {
  const root = fixture();
  const help = run(root, []);
  assert.match(help, /--sketch/);
  assert.doesNotMatch(help, /--data-dir/);
});

test("an unreadable lock is not evidence of a live holder", () => {
  const root = fixture();
  mkdirSync(join(root, ".strata"), { recursive: true });
  const lockPath = join(root, ".strata/lock");
  // Fault injection: reading the holder fails, as it does for EACCES or a vanishing file.
  const script = `
    import { createRequire, syncBuiltinESMExports } from "node:module";
    const req = createRequire(import.meta.url + "x");
    const fs = req("node:fs");
    const realRead = fs.readFileSync;
    fs.readFileSync = function (p, ...r) {
      if (String(p).endsWith("lock")) { const e = new Error("EACCES"); e.code = "EACCES"; throw e; }
      return realRead.call(fs, p, ...r);
    };
    syncBuiltinESMExports();
    fs.writeFileSync(${JSON.stringify(lockPath)}, "1");
    const store = await import(${JSON.stringify(STORE)});
    const lk = store.lock(${JSON.stringify(root)});
    console.log(lk === null ? "refused" : "held");
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(out.trim(), "held");
});

test("a lock path that cannot be a lock file refuses instead of crashing", () => {
  const root = fixture();
  mkdirSync(join(root, ".strata/lock"), { recursive: true });
  try {
    run(root, ["index"]);
    assert.fail("expected the run to refuse");
  } catch (err) {
    assert.equal(err.status, 2, "refused, not an uncaught throw");
    assert.match(String(err.stderr), /holds|refusing/);
    assert.doesNotMatch(String(err.stderr), /EISDIR|at readFileSync/, "no crash trace");
  }
});
