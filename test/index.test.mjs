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
  // Deliberately no --root: the default $PWD path is what most runs take, and
  // forcing --root here is what hid the subdirectory defects from this suite.
  return execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
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
  assert.ok(data.stats.external["not in this repo: third-party dependency or unmodelled alias"] >= 1);

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

test("status with no index refuses and says what to run", () => {
  const root = fixture();
  const r = exitOf(root, ["status"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /Run `strata index`/);
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

test("index from a subdirectory anchors at the repository top level", () => {
  const root = fixture();
  const sub = join(root, "src");
  run(sub, ["index"]);
  assert.ok(existsSync(join(root, ".strata/index.json")), "data dir written at the top level");
  assert.ok(!existsSync(join(sub, ".strata")), "no data dir inside the subdirectory");
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const ledger = data.files.find((f) => f.path === "src/billing/ledger.ts");
  assert.ok(ledger, "file paths stay top-level relative");
  assert.ok(ledger.churn > 0, "churn is computed, not silently zero");
  assert.ok(ledger.owners.length > 0, "owners are computed, not silently empty");
});

test("blast from a subdirectory finds the top-level index and reports the change", () => {
  const root = fixture();
  run(root, ["index"]);
  writeFileSync(join(root, "src/db.ts"), "export const db = 9;\n");
  const out = run(join(root, "src"), ["blast"]);
  assert.match(out, /1 changed file/);
  assert.match(out, /src\/db\.ts/);
});

test("an explicit --root still indexes the tree it names and leaves the cwd alone", () => {
  const root = fixture();
  const other = fixture();
  run(root, ["index", "--root", other]);
  assert.ok(existsSync(join(other, ".strata/index.json")), "the named tree was indexed");
  assert.ok(!existsSync(join(root, ".strata/index.json")), "the cwd was not touched");
});

test("blast names a new untracked file instead of reporting no changes", () => {
  const root = fixture();
  run(root, ["index"]);
  writeFileSync(join(root, "src/brandNew.ts"), "export const n = 1;\n");
  const out = run(root, ["blast"]);
  assert.match(out, /src\/brandNew\.ts/, "the unindexed file is named");
  assert.match(out, /strata index/, "and the report says what to do about it");
  assert.doesNotMatch(out, /no changes/);
});

test("blast --json parses on a clean tree", () => {
  const root = fixture();
  run(root, ["index"]);
  const json = JSON.parse(run(root, ["blast", "--json"]));
  assert.deepEqual(json.changed, []);
  // The data dir shows up here until it is self-ignoring (#3); this asserts the shape, not the pollution.
  assert.ok(Array.isArray(json.untracked));
});

test("blast --json parses for an untracked-only change", () => {
  const root = fixture();
  run(root, ["index"]);
  writeFileSync(join(root, "src/brandNew.ts"), "export const n = 1;\n");
  const json = JSON.parse(run(root, ["blast", "--json"]));
  assert.deepEqual(json.changed, []);
  assert.ok(json.untracked.includes("src/brandNew.ts"), "the unindexed path is carried, not dropped");
});

test("blast --json has one key set whichever path it takes", () => {
  const root = fixture();
  run(root, ["index"]);
  const empty = Object.keys(JSON.parse(run(root, ["blast", "--json"])));
  writeFileSync(join(root, "src/db.ts"), "export const db = 7;\n");
  const populated = Object.keys(JSON.parse(run(root, ["blast", "--json"])));
  assert.deepEqual(empty, populated, "a consumer needs one schema, not two");
  const noIndex = Object.keys(JSON.parse(exitOf(fixture(), ["blast", "--json"]).out));
  assert.deepEqual(empty, noIndex, "the no-index path keeps the same schema");
});

test("a mixed change still reports tracked and untracked sections", () => {
  const root = fixture();
  run(root, ["index"]);
  writeFileSync(join(root, "src/db.ts"), "export const db = 8;\n");
  writeFileSync(join(root, "src/brandNew.ts"), "export const n = 2;\n");
  const out = run(root, ["blast"]);
  assert.match(out, /1 changed file/);
  assert.match(out, /src\/brandNew\.ts/);
});

test("reading order puts dependencies before the files that import them", () => {
  const root = fixture();
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const at = (p) => data.readingOrder.indexOf(p);
  assert.ok(at("src/db.ts") >= 0, "the leaf is ordered");
  assert.ok(at("src/db.ts") < at("src/billing/invoice.ts"), "db before the file importing it");
  assert.ok(at("src/billing/invoice.ts") < at("src/billing/ledger.ts"), "invoice before ledger");
  assert.ok(at("src/billing/ledger.ts") < at("src/cli.ts"), "ledger before its entry-point importer");
});

test("a cycle is listed and no file is dropped", () => {
  const root = fixture();
  writeFileSync(join(root, "src/p.ts"), 'import { q } from "./q";\nexport const p = 1;\n');
  writeFileSync(join(root, "src/q.ts"), 'import { p } from "./p";\nexport const q = 1;\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "cycle"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.ok(data.cycles.includes("src/p.ts"), "p is unorderable");
  assert.ok(data.cycles.includes("src/q.ts"), "q is unorderable");
  assert.equal(data.readingOrder.length + data.cycles.length, data.files.length, "nothing dropped");
});

test("commented-out imports never become edges", () => {
  const root = fixture();
  writeFileSync(join(root, "src/c_line.ts"), '// import { db } from "./db"\nexport const x = 1;\n');
  writeFileSync(join(root, "src/c_block.ts"), '/* import { db } from "./db" */\nexport const x = 1;\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "comments"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  for (const file of ["src/c_line.ts", "src/c_block.ts"]) {
    assert.equal(data.edges.filter((e) => e.from === file).length, 0, `${file} contributes no edge`);
    assert.equal(data.unresolved.filter((u) => u.file === file).length, 0, `${file} contributes no question`);
  }
});

test("a side-effect import is an edge", () => {
  const root = fixture();
  writeFileSync(join(root, "src/side.ts"), 'import "./db";\nexport const x = 1;\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "side effect"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const hits = data.edges.filter((e) => e.from === "src/side.ts");
  assert.equal(hits.length, 1, "one edge");
  assert.equal(hits[0].to, "src/db.ts");
});

test("an import written inside a string literal stays out of the graph", () => {
  const root = fixture();
  writeFileSync(join(root, "src/fixture_str.ts"), 'const s = "import y from \'./db\'";\nexport const x = s;\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "fixture string"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.equal(data.edges.filter((e) => e.from === "src/fixture_str.ts").length, 0);
});

test("a URL in a string does not truncate the rest of its line", () => {
  const root = fixture();
  writeFileSync(join(root, "src/url.ts"), 'const u = "https://example.com/a";\nimport { db } from "./db";\nexport const x = u + db;\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "url"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const hits = data.edges.filter((e) => e.from === "src/url.ts");
  assert.equal(hits.length, 1, "the import after the URL is still seen");
  assert.equal(hits[0].to, "src/db.ts");
});

test("every import form is extracted", () => {
  const root = fixture();
  writeFileSync(
    join(root, "src/forms.ts"),
    'import { db } from "./db";\nconst a = require("./billing/invoice");\nconst b = import("./billing/ledger");\nexport const x = [db, a, b];\n',
  );
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "forms"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const to = data.edges.filter((e) => e.from === "src/forms.ts").map((e) => e.to).sort();
  assert.deepEqual(to, ["src/billing/invoice.ts", "src/billing/ledger.ts", "src/db.ts"], "from, require and import() all seen");
});

function monoFixture() {
  const root = mkdtempSync(join(tmpdir(), "strata-mono-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "t@example.com"]);
  sh(root, ["config", "user.name", "t"]);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "mono", workspaces: ["packages/*"] }));
  for (const d of ["missing/lib", "lib/attr", "lib/src", "build/src", "app/src"]) {
    mkdirSync(join(root, "packages", d), { recursive: true });
  }
  // main names a build output that exists nowhere in the repository.
  writeFileSync(join(root, "packages/missing/package.json"), JSON.stringify({ name: "@m/core", main: "./dist/missing.js" }));
  writeFileSync(join(root, "packages/missing/lib/index.ts"), "export const helper = 1;\n");
  // a package with a subpath file and an entry.
  writeFileSync(join(root, "packages/lib/package.json"), JSON.stringify({ name: "@x/lib", main: "./src/index.ts" }));
  writeFileSync(join(root, "packages/lib/src/index.ts"), "export const lib = 1;\n");
  writeFileSync(join(root, "packages/lib/attr/deep.ts"), "export const deep = 1;\n");
  // main names a build output that maps onto the source tree.
  writeFileSync(join(root, "packages/build/package.json"), JSON.stringify({ name: "@x/build", main: "./dist/index.js" }));
  writeFileSync(join(root, "packages/build/src/index.ts"), "export const built = 1;\n");
  writeFileSync(join(root, "packages/app/package.json"), JSON.stringify({ name: "@x/app" }));
  writeFileSync(
    join(root, "packages/app/src/main.ts"),
    [
      'import { helper } from "@m/core";',
      'import { deep } from "@x/lib/attr/deep";',
      'import { nope } from "@x/lib/attr/nope";',
      'import { lib } from "@x/lib";',
      'import { built } from "@x/build";',
      'import lodash from "lodash";',
      "export const all = [helper, deep, nope, lib, built, lodash];",
    ].join("\n") + "\n",
  );
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "mono"]);
  run(root, ["index"]);
  return JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
}

test("a workspace main that does not exist becomes a question, not a guessed edge", () => {
  const data = monoFixture();
  const app = "packages/app/src/main.ts";
  assert.equal(data.edges.filter((e) => e.from === app && e.spec === "@m/core").length, 0, "no invented edge");
  const q = data.unresolved.filter((u) => u.file === app && u.spec === "@m/core");
  assert.equal(q.length, 1, "reported as unresolved");
  assert.match(q[0].reason, /main/, "the reason names the cause");
});

test("a workspace subpath resolves to its own file, or to a reason - never the entry", () => {
  const data = monoFixture();
  const app = "packages/app/src/main.ts";
  const deep = data.edges.find((e) => e.from === app && e.spec === "@x/lib/attr/deep");
  assert.ok(deep, "the subpath resolves");
  assert.equal(deep.to, "packages/lib/attr/deep.ts", "to the subpath's file");
  assert.equal(
    data.edges.filter((e) => e.from === app && e.spec === "@x/lib/attr/nope").length,
    0,
    "a missing subpath invents nothing",
  );
  const q = data.unresolved.filter((u) => u.file === app && u.spec === "@x/lib/attr/nope");
  assert.equal(q.length, 1, "the miss is reported, not swallowed");
});

test("a resolvable workspace import still reaches the entry, including dist -> src", () => {
  const data = monoFixture();
  const app = "packages/app/src/main.ts";
  assert.equal(data.edges.find((e) => e.from === app && e.spec === "@x/lib")?.to, "packages/lib/src/index.ts");
  assert.equal(data.edges.find((e) => e.from === app && e.spec === "@x/build")?.to, "packages/build/src/index.ts");
});

test("a specifier outside the workspace is labelled as outside the repository", () => {
  const data = monoFixture();
  const labels = Object.keys(data.stats.external);
  assert.equal(labels.length, 1, "one bucket");
  assert.match(labels[0], /not in this repo/, "the label says where it points");
  assert.doesNotMatch(labels[0], /tsconfig/, "not a guess about why");
});

test("the data dir is self-ignoring: the tree is clean after an index", () => {
  const root = fixture();
  run(root, ["index"]);
  assert.equal(sh(root, ["status", "--porcelain"]).trim(), "", "nothing untracked or modified");
  assert.equal(readFileSync(join(root, ".strata/.gitignore"), "utf8").trim(), "*");
});

test("the data dir is not counted as a dirty file", () => {
  const root = fixture();
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.equal(data.dirtyFiles, 0, "the tool's own artifacts are not a change");
});

test("a data dir committed by an earlier run is not indexed as source", () => {
  const root = fixture();
  run(root, ["index"]);
  sh(root, ["add", "-f", ".strata"]); // force: the data dir now ignores itself
  sh(root, ["commit", "-m", "tool output from an older version"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.ok(!data.files.some((f) => f.path.startsWith(".strata/")), "no data-dir paths are sources");
  assert.ok(!data.readingOrder.some((p) => p.startsWith(".strata/")), "nor in the reading order");
});

test("the tool writes nothing outside its data dir", () => {
  const root = fixture();
  const before = sh(root, ["ls-files"]).trim().split("\n").filter(Boolean).sort();
  run(root, ["index"]);
  const after = sh(root, ["ls-files"]).trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(after, before, "no new tracked paths");
  assert.equal(sh(root, ["status", "--porcelain"]).trim(), "", "no tracked file modified");
});

function exitOf(cwd, args) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out: String(out || ""), err: "" };
  } catch (err) {
    return { code: err.status, out: String(err.stdout || ""), err: String(err.stderr || "") };
  }
}

test("blast refuses an unknown revision instead of reporting no changes", () => {
  const root = fixture();
  run(root, ["index"]);
  const r = exitOf(root, ["blast", "--since", "NOPE"]);
  assert.equal(r.code, 2, "a typo is a usage error");
  assert.match(r.err, /NOPE/, "and it names the revision");
  assert.doesNotMatch(r.out, /no changes/, "never disguised as an empty result");
});

test("blast refuses a depth that is not a positive integer", () => {
  const root = fixture();
  run(root, ["index"]);
  for (const d of ["0", "-1", "abc"]) {
    const r = exitOf(root, ["blast", "--depth", d]);
    assert.equal(r.code, 2, `--depth ${d}`);
    assert.match(r.err, /depth/);
  }
});

test("blast still reports no changes on a clean tree", () => {
  const root = fixture();
  run(root, ["index"]);
  const r = exitOf(root, ["blast", "--since", "HEAD"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /no changes/);
});

test("status refuses when there is no index or no repository", () => {
  const root = fixture();
  const noIndex = exitOf(root, ["status"]);
  assert.equal(noIndex.code, 2, "no index");
  const plain = mkdtempSync(join(tmpdir(), "strata-plain-"));
  assert.equal(exitOf(plain, ["status"]).code, 2, "not a repository");
});

test("blast does not fail a build when the index is missing", () => {
  const root = fixture();
  const r = exitOf(root, ["blast"]);
  assert.equal(r.code, 0, "a report, not a gate");
  assert.match(r.out, /strata index/, "and it says what to run");
});

test("an unknown flag is rejected rather than ignored", () => {
  const root = fixture();
  for (const args of [
    ["index", "--data-dir", "/tmp/x"],
    ["blast", "--nope"],
    ["status", "--bogus"],
  ]) {
    const r = exitOf(root, args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, /unknown flag/, args.join(" "));
  }
});

test("re-indexing an unchanged tree produces a byte-identical artifact", () => {
  const root = fixture();
  run(root, ["index"]);
  const first = readFileSync(join(root, ".strata/index.json"), "utf8");
  run(root, ["index"]);
  const second = readFileSync(join(root, ".strata/index.json"), "utf8");
  assert.equal(second, first, "no wall-clock or environment drift between runs");
});

test("the artifact carries no absolute path and no timestamp", () => {
  const root = fixture();
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const absolute = [];
  const stamps = [];
  JSON.stringify(data, (k, v) => {
    if (typeof v === "string" && v.startsWith("/")) absolute.push(k);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) stamps.push(k);
    return v;
  });
  assert.deepEqual(absolute, [], "no absolute paths");
  assert.deepEqual(stamps, [], "no timestamps");
  assert.equal(typeof data.rootName, "string", "the repository is still identified by name");
});

test("the briefing still names the repo and says when it was generated", () => {
  const root = fixture();
  run(root, ["index"]);
  const map = readFileSync(join(root, ".strata/MAP.md"), "utf8");
  assert.match(map, /^# /, "has a title");
  assert.match(map, /Generated by `strata index` at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "and a generation time");
});

test("status reports when the index was built without the artifact storing it", () => {
  const root = fixture();
  run(root, ["index"]);
  const r = exitOf(root, ["status"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /index\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "built-at time is shown");
});

function testDirFixture() {
  const root = mkdtempSync(join(tmpdir(), "strata-tests-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "t@example.com"]);
  sh(root, ["config", "user.name", "t"]);
  mkdirSync(join(root, "src/other"), { recursive: true });
  mkdirSync(join(root, "test/unit"), { recursive: true });
  mkdirSync(join(root, "test/spec"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tm" }));
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/unit/a.test.ts"), 'import { a } from "../../src/a";\n');
  writeFileSync(join(root, "src/colocated.ts"), "export const c = 1;\n");
  writeFileSync(join(root, "src/colocated.test.ts"), 'import { c } from "./colocated";\n');
  writeFileSync(join(root, "test/unit/colocated.test.ts"), 'import { c } from "../../src/colocated";\n');
  writeFileSync(join(root, "src/dup.ts"), "export const d = 1;\n");
  writeFileSync(join(root, "test/unit/dup.test.ts"), 'import { d } from "../../src/dup";\n');
  writeFileSync(join(root, "test/spec/dup.test.ts"), 'import { d } from "../../src/dup";\n');
  writeFileSync(join(root, "src/m.mjs"), "export const m = 1;\n");
  writeFileSync(join(root, "test/unit/m.test.mjs"), 'import { m } from "../../src/m";\n');
  writeFileSync(join(root, "src/none.ts"), "export const n = 1;\n");
  writeFileSync(join(root, "src/other/none.test.ts"), "export const unrelated = 1;\n");
  writeFileSync(join(root, "src/imported.ts"), "export const i = 1;\n");
  writeFileSync(join(root, "test/unit/weirdly-named.test.ts"), 'import { i } from "../../src/imported";\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "tests"]);
  run(root, ["index"]);
  return root;
}

const indexOf = (root) => JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));

test("a test under a repo-level test directory is mapped to its source", () => {
  const data = indexOf(testDirFixture());
  assert.deepEqual(data.files.find((f) => f.path === "src/a.ts").tests, ["test/unit/a.test.ts"]);
});

test("a co-located test wins over a repo-level one with the same name", () => {
  const data = indexOf(testDirFixture());
  assert.deepEqual(data.files.find((f) => f.path === "src/colocated.ts").tests, ["src/colocated.test.ts"]);
});

test("an .mjs test under a test directory is mapped too", () => {
  const data = indexOf(testDirFixture());
  assert.deepEqual(data.files.find((f) => f.path === "src/m.mjs").tests, ["test/unit/m.test.mjs"]);
});

test("every matching test is reported, never a silent pick", () => {
  const data = indexOf(testDirFixture());
  assert.deepEqual(data.files.find((f) => f.path === "src/dup.ts").tests.sort(), [
    "test/spec/dup.test.ts",
    "test/unit/dup.test.ts",
  ]);
});

test("a .test.ts outside a test directory does not claim a source in another directory", () => {
  const data = indexOf(testDirFixture());
  assert.deepEqual(data.files.find((f) => f.path === "src/none.ts").tests, []);
});

test("a test that imports the source is mapped whatever the test is called", () => {
  const data = indexOf(testDirFixture());
  assert.deepEqual(data.files.find((f) => f.path === "src/imported.ts").tests, ["test/unit/weirdly-named.test.ts"]);
});

test("blast lists tests mapped through a repo-level test directory", () => {
  const root = testDirFixture();
  writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
  const out = run(root, ["blast"]);
  const affected = out.split("affected tests")[1] || "";
  assert.match(affected, /test\/unit\/a\.test\.ts/, "listed as an affected test, not merely as an importer");
});

function entryFixture(binPath, mainPath, realFiles = true) {
  const root = mkdtempSync(join(tmpdir(), "strata-entry-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "t@example.com"]);
  sh(root, ["config", "user.name", "t"]);
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "ep", bin: { ep: binPath }, main: mainPath }));
  if (realFiles) {
    writeFileSync(join(root, "bin/tool.mjs"), "export const a = 1;\n");
    writeFileSync(join(root, "lib/start.mjs"), "export const b = 1;\n");
  }
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "entry"]);
  run(root, ["index"]);
  const map = readFileSync(join(root, ".strata/MAP.md"), "utf8");
  return map.split("## Entry points")[1]?.split("\n## ")[0] || "";
}

test("entry points declared with a leading ./ are listed", () => {
  const section = entryFixture("./bin/tool.mjs", "./lib/start.mjs");
  assert.match(section, /bin\/tool\.mjs/, "bin, written the conventional way");
  assert.match(section, /lib\/start\.mjs/, "main, written the conventional way");
});

test("entry points declared without ./ are listed too", () => {
  const section = entryFixture("bin/tool.mjs", "lib/start.mjs");
  assert.match(section, /bin\/tool\.mjs/);
  assert.match(section, /lib\/start\.mjs/);
});

test("a declared entry point that is not in the index is not listed", () => {
  const section = entryFixture("./bin/missing.mjs", "./lib/also-missing.mjs", false);
  assert.equal(section.trim(), "", "no dangling entry points");
});

function aliasRepo({ tsconfig, app }) {
  const root = mkdtempSync(join(tmpdir(), "strata-alias-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "test@example.com"]);
  sh(root, ["config", "user.name", "test"]);
  mkdirSync(join(root, "src/lib"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "alias" }));
  writeFileSync(join(root, "src/db.ts"), "export const db = 1;\n");
  writeFileSync(join(root, "src/lib/deep.ts"), "export const deep = 1;\n");
  writeFileSync(join(root, "data/rows.ts"), "export const rows = 1;\n");
  if (tsconfig !== null) writeFileSync(join(root, "tsconfig.json"), typeof tsconfig === "string" ? tsconfig : JSON.stringify(tsconfig));
  writeFileSync(join(root, "src/app.ts"), app);
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "base"]);
  run(root, ["index"]);
  return JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
}

test("a tsconfig path alias resolves to the file it names", () => {
  const data = aliasRepo({
    tsconfig: { compilerOptions: { paths: { "@/*": ["./src/*"] } } },
    app: 'import { db } from "@/db";\nexport const app = db;\n',
  });
  const e = data.edges.find((x) => x.from === "src/app.ts" && x.spec === "@/db");
  assert.ok(e, "the alias became an edge instead of an external package");
  assert.equal(e.to, "src/db.ts");
  assert.equal(e.line, 1);
});

test("the longest matching path pattern wins", () => {
  const data = aliasRepo({
    tsconfig: { compilerOptions: { paths: { "@/*": ["./src/*"], "@/data/*": ["./data/*"] } } },
    app: 'import { rows } from "@/data/rows";\nexport const app = rows;\n',
  });
  const e = data.edges.find((x) => x.from === "src/app.ts" && x.spec === "@/data/rows");
  assert.ok(e, "the more specific pattern matched");
  assert.equal(e.to, "data/rows.ts", "not src/data/rows.ts");
});

test("baseUrl is honoured when one is declared", () => {
  const data = aliasRepo({
    tsconfig: { compilerOptions: { baseUrl: "./src", paths: { "@/*": ["*"] } } },
    app: 'import { deep } from "@/lib/deep";\nexport const app = deep;\n',
  });
  const e = data.edges.find((x) => x.from === "src/app.ts" && x.spec === "@/lib/deep");
  assert.ok(e, "targets resolve against baseUrl, not the repo root");
  assert.equal(e.to, "src/lib/deep.ts");
});

test("a .js specifier behind an alias still finds its .ts source", () => {
  const data = aliasRepo({
    tsconfig: { compilerOptions: { paths: { "@/*": ["./src/*"] } } },
    app: 'import { db } from "@/db.js";\nexport const app = db;\n',
  });
  const e = data.edges.find((x) => x.from === "src/app.ts" && x.spec === "@/db.js");
  assert.ok(e, "the .js to .ts candidate rule still applies");
  assert.equal(e.to, "src/db.ts");
});

test("a pattern that matches but finds no file is a question, never an external package", () => {
  const data = aliasRepo({
    tsconfig: { compilerOptions: { paths: { "@/*": ["./src/*"] } } },
    app: 'import x from "@/nope";\nexport const app = x;\n',
  });
  const q = data.unresolved.filter((u) => u.file === "src/app.ts" && u.spec === "@/nope");
  assert.equal(q.length, 1, "reported as a question");
  assert.match(q[0].reason, /tsconfig/, "the reason names the cause");
  assert.equal(data.edges.length, 0, "no invented edge");
  const aliasAsExternal = Object.keys(data.stats.external).some((k) => /unmodelled alias/.test(k));
  assert.equal(aliasAsExternal, false, "not swept into external");
});

test("a specifier matching no pattern keeps behaving as an external package", () => {
  const data = aliasRepo({
    tsconfig: { compilerOptions: { paths: { "@/*": ["./src/*"] } } },
    app: 'import x from "lodash/fp";\nexport const app = x;\n',
  });
  assert.equal(data.unresolved.length, 0, "a real package is not a question");
  assert.ok(Object.keys(data.stats.external).length > 0, "still counted as external");
});

test("a tsconfig without paths changes nothing", () => {
  const withTs = aliasRepo({
    tsconfig: { compilerOptions: { strict: true } },
    app: 'import { db } from "./db";\nexport const app = db;\n',
  });
  const withoutTs = aliasRepo({
    tsconfig: null,
    app: 'import { db } from "./db";\nexport const app = db;\n',
  });
  assert.deepEqual(withTs.edges, withoutTs.edges, "identical graph");
});

test("a tsconfig with comments and a trailing comma is still read", () => {
  const data = aliasRepo({
    tsconfig: `{
  // the compiler accepts this form, so the tool must too
  "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },
}`,
    app: 'import { db } from "@/db";\nexport const app = db;\n',
  });
  const e = data.edges.find((x) => x.from === "src/app.ts" && x.spec === "@/db");
  assert.ok(e, "JSONC is not silently ignored");
  assert.equal(e.to, "src/db.ts");
});

function rewriteVersion(root, version) {
  const file = join(root, ".strata/index.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.version = version;
  writeFileSync(file, JSON.stringify(data));
}

test("status refuses an index written in another format", () => {
  const root = fixture();
  run(root, ["index"]);
  rewriteVersion(root, 2);
  const r = exitOf(root, ["status"]);
  assert.equal(r.code, 2, "an unreadable artifact is a refusal, not a report");
  assert.match(r.err, /Run `strata index`/);
});

test("blast refuses an index written in another format without failing the build", () => {
  const root = fixture();
  run(root, ["index"]);
  rewriteVersion(root, 2);
  const r = exitOf(root, ["blast"]);
  assert.equal(r.code, 0, "still a report, not a gate");
  assert.match(r.out, /strata index/, "and it names the remedy");
  assert.doesNotMatch(r.out, /no changes in the working tree/, "rather than reporting from a shape it cannot read");
});

test("an apostrophe in JSX text does not turn the comment after it into code", () => {
  const root = fixture();
  writeFileSync(
    join(root, "src/ghost.tsx"),
    'export function C() {\n  return (\n    <p>Don\'t panic</p>\n  );\n}\n// import { db } from "./db"\nimport { invoice } from "./billing/invoice";\nexport const x = [C, invoice];\n',
  );
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "jsx apostrophe"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.equal(data.edges.filter((e) => e.from === "src/ghost.tsx" && e.to === "src/db.ts").length, 0, "the commented import is not an edge");
  assert.equal(data.edges.filter((e) => e.from === "src/ghost.tsx" && e.to === "src/billing/invoice.ts").length, 1, "the real import after it is still an edge");
});

test("a quote inside a regex literal does not turn the comment after it into code", () => {
  const root = fixture();
  writeFileSync(
    join(root, "src/sep.ts"),
    'export const sep = /[\'"]/;\n// import { db } from "./db"\nimport { invoice } from "./billing/invoice";\nexport const x = sep.source + invoice;\n',
  );
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "regex quote"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.equal(data.edges.filter((e) => e.from === "src/sep.ts" && e.to === "src/db.ts").length, 0, "the commented import is not an edge");
  assert.equal(data.edges.filter((e) => e.from === "src/sep.ts" && e.to === "src/billing/invoice.ts").length, 1, "the real import after it is still an edge");
  assert.equal(data.unresolved.filter((u) => u.file === "src/sep.ts").length, 0, "no question invented");
});

test("a single-quoted URL does not swallow the import after it", () => {
  const root = fixture();
  writeFileSync(join(root, "src/sq_url.ts"), 'const u = \'https://example.com/a\';\nimport { db } from "./db";\nexport const x = u + db;\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "single-quoted url"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const hits = data.edges.filter((e) => e.from === "src/sq_url.ts" && e.to === "src/db.ts");
  assert.equal(hits.length, 1, "the import after the string is still an edge");
});

test("a tsconfig with a byte-order mark still resolves its aliases", () => {
  const data = aliasRepo({
    tsconfig: '\uFEFF{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}',
    app: 'import { db } from "@/db";\nexport const app = db;\n',
  });
  const e = data.edges.find((x) => x.from === "src/app.ts" && x.spec === "@/db");
  assert.ok(e, "the alias resolved despite the BOM");
  assert.equal(e.to, "src/db.ts");
  assert.equal(Object.keys(data.stats.external).some((k) => /unmodelled alias/.test(k)), false, "not counted as a third-party package");
});

test("baseUrl alone resolves a bare specifier, as the compiler does", () => {
  const data = aliasRepo({
    tsconfig: { compilerOptions: { baseUrl: "./src" } },
    app: 'import { deep } from "lib/deep";\nexport const app = deep;\n',
  });
  const e = data.edges.find((x) => x.from === "src/app.ts" && x.spec === "lib/deep");
  assert.ok(e, "resolved against baseUrl with no paths declared");
  assert.equal(e.to, "src/lib/deep.ts");
});

test("a baseUrl that matches no file leaves a package external, not a question", () => {
  const data = aliasRepo({
    tsconfig: { compilerOptions: { baseUrl: "./src" } },
    app: 'import x from "lodash/fp";\nexport const app = x;\n',
  });
  assert.equal(data.unresolved.length, 0, "a third-party package is not a question");
  assert.ok(Object.keys(data.stats.external).length > 0, "still counted as external");
});

test("a tsconfig that cannot be parsed is one question, not silence", () => {
  const data = aliasRepo({
    tsconfig: '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}\n}}}} trailing garbage',
    app: 'import { db } from "@/db";\nexport const app = db;\n',
  });
  assert.equal(data.unresolved.length, 1, "exactly one entry, not one per import");
  assert.equal(data.unresolved[0].file, "tsconfig.json");
  assert.match(data.unresolved[0].reason, /tsconfig/i, "the reason names the file");
});

test("a --root with no value is rejected, not analysed as a missing repository", () => {
  const root = fixture();
  for (const cmd of ["index", "blast", "status"]) {
    const r = exitOf(root, [cmd, "--root"]);
    assert.equal(r.code, 2, `${cmd} --root with no value`);
    assert.match(r.err, /--root/, `${cmd} names the flag it rejects`);
  }
  assert.ok(!existsSync(join(root, "true/.strata")), "no data dir invented from a boolean");
});

test("--root on a subdirectory attributes churn to the files it names", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-subroot-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "test@example.com"]);
  sh(root, ["config", "user.name", "test"]);
  mkdirSync(join(root, "app/src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "outer" }));
  writeFileSync(join(root, "app/package.json"), JSON.stringify({ name: "inner" }));
  writeFileSync(join(root, "app/src/a.ts"), "export const a = 1;\n");
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "one"]);
  writeFileSync(join(root, "app/src/a.ts"), "export const a = 2;\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "outer", v: 2 }));
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "two"]);
  run(root, ["index", "--root", "app"]);
  const data = JSON.parse(readFileSync(join(root, "app/.strata/index.json"), "utf8"));
  const a = data.files.find((f) => f.path === "src/a.ts");
  assert.ok(a, "the subdirectory file is indexed under the subdirectory root");
  assert.equal(a.churn, 2, "both commits that touched it are counted");
  const inner = data.files.find((f) => f.path === "package.json");
  assert.equal(inner.churn, 1, "the outer package.json does not lend its history to the inner one");
});

test("blast --root on a subdirectory analyses the change instead of calling it unindexed", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-subroot-blast-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "test@example.com"]);
  sh(root, ["config", "user.name", "test"]);
  mkdirSync(join(root, "app/src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "outer" }));
  writeFileSync(join(root, "app/package.json"), JSON.stringify({ name: "inner" }));
  writeFileSync(join(root, "app/src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "app/src/uses.ts"), 'import { a } from "./a";\nexport const u = a;\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "one"]);
  run(root, ["index", "--root", "app"]);
  writeFileSync(join(root, "app/src/a.ts"), "export const a = 2;\n");
  const out = run(root, ["blast", "--root", "app"]);
  assert.match(out, /src\/a\.ts/, "the changed file is named relative to the analysed root");
  assert.match(out, /src\/uses\.ts/, "its importer is in the blast radius");
  assert.doesNotMatch(out, /not in the index/, "an indexed file is not reported as unindexed");
});

test("a relative specifier that escapes the analysed root is external, not a question", () => {
  const root = fixture();
  writeFileSync(join(root, "src/escape.ts"), 'import { o } from "../../outside/o";\nexport const x = o;\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "escaping relative"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.equal(data.unresolved.filter((u) => u.file === "src/escape.ts").length, 0, "not a question: the tool cannot see outside");
  const labels = Object.keys(data.stats.external);
  assert.ok(labels.some((k) => /not in this repo/.test(k)), `labelled as outside the repo, got ${JSON.stringify(labels)}`);
});

test("blast --json emits JSON when there is no index", () => {
  const root = fixture();
  const r = exitOf(root, ["blast", "--json"]);
  assert.equal(r.code, 0, "a missing index is a notice, not a failure");
  const j = JSON.parse(r.out);
  assert.match(j.error, /index/, "the payload says what is missing");
  assert.deepEqual(j.changed, []);
  assert.deepEqual(j.seeds, []);
});

test("a tracked file above the size limit is listed, and raises one question", () => {
  const root = fixture();
  writeFileSync(join(root, "src/huge.ts"), "export const big = 1;\n" + "// pad\n".repeat(180000));
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "big"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.ok(data.files.some((f) => f.path === "src/huge.ts"), "it is in the tree, so it is in the index");
  const q = data.unresolved.filter((u) => u.file === "src/huge.ts");
  assert.equal(q.length, 1, "one question, not one per import");
  assert.match(q[0].reason, /MB/, "the reason names the size");
});

test("a go package import reaches every file in the package", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-go-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "test@example.com"]);
  sh(root, ["config", "user.name", "test"]);
  writeFileSync(join(root, "go.mod"), "module example.com/m\n\ngo 1.21\n");
  mkdirSync(join(root, "pkg"), { recursive: true });
  for (let i = 1; i <= 26; i++) writeFileSync(join(root, `pkg/f${i}.go`), `package pkg\n\nfunc F${i}() int { return ${i} }\n`);
  writeFileSync(join(root, "main.go"), 'package main\n\nimport "example.com/m/pkg"\n\nfunc main() { _ = pkg.F1() }\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "go"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  assert.equal(data.edges.filter((e) => e.from === "main.go").length, 26, "every file in the package is a dependency");
});

test("a python import with a trailing comment is still an import", () => {
  const root = mkdtempSync(join(tmpdir(), "strata-py-"));
  sh(root, ["init", "-b", "main"]);
  sh(root, ["config", "user.email", "test@example.com"]);
  sh(root, ["config", "user.name", "test"]);
  mkdirSync(join(root, "pkg"), { recursive: true });
  for (const n of ["alpha", "beta", "gamma", "delta"]) writeFileSync(join(root, `pkg/${n}.py`), "x = 1\n");
  writeFileSync(join(root, "pkg/main.py"), "import pkg.alpha  # note\nimport pkg.beta, pkg.gamma  # two\nimport pkg.delta as d\n");
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "py"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const specs = data.edges.filter((e) => e.from === "pkg/main.py").map((e) => e.spec).sort();
  assert.deepEqual(specs, ["pkg.alpha", "pkg.beta", "pkg.delta", "pkg.gamma"]);
});

test("an emitted extension finds its TypeScript source", () => {
  const root = fixture();
  writeFileSync(join(root, "src/legacy.cts"), "export const y = 1;\n");
  writeFileSync(join(root, "src/view.tsx"), "export const z = 1;\n");
  writeFileSync(join(root, "src/stream.mts"), "export const w = 1;\n");
  writeFileSync(join(root, "src/emitted.ts"), 'import { y } from "./legacy.cjs";\nimport { z } from "./view.jsx";\nimport { w } from "./stream.mjs";\nexport const a = [y, z, w];\n');
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-m", "emitted extensions"]);
  run(root, ["index"]);
  const data = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const got = data.edges.filter((e) => e.from === "src/emitted.ts").map((e) => `${e.spec} -> ${e.to}`).sort();
  assert.deepEqual(got, ["./legacy.cjs -> src/legacy.cts", "./stream.mjs -> src/stream.mts", "./view.jsx -> src/view.tsx"]);
  assert.equal(data.unresolved.filter((u) => u.file === "src/emitted.ts").length, 0, "nothing left unresolved");
});
