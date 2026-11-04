import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "strata.mjs");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
// rustc on PATH, else the cargo default install, which is not on PATH for a plain shell.
const RUSTC = (() => {
  for (const cand of [process.env.STRATA_RUSTC || "rustc", join(homedir(), ".cargo", "bin", "rustc")]) {
    try {
      execFileSync(cand, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return cand;
    } catch {
      // try the next candidate
    }
  }
  return null;
})();

const sh = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });

/**
 * What the compiler thinks every specifier in `root` resolves to, keyed by
 * "importer\0specifier" and limited to targets inside `root`. The compiler is
 * the oracle: a resolution rule strata gets wrong shows up as a disagreement,
 * which no hand-written fixture can promise.
 */
function compilerAnswers(dir) {
  // The compiler reports real paths; on macOS a temp dir is /var/... behind /private/var/...
  const root = realpathSync(dir);
  let trace;
  try {
    trace = sh(root, TSC, ["-p", ".", "--traceResolution"]);
  } catch (err) {
    trace = String(err.stdout || ""); // tsc exits non-zero on type errors; the trace is still valid
  }
  const answers = new Map();
  const asked = new Set();
  let cur = null;
  for (const line of trace.split("\n")) {
    const head = line.match(/^=+ Resolving module '(.+)' from '(.+)'\. =+$/);
    if (head) {
      cur = head[2].startsWith(root + "/") && !head[2].includes("/node_modules/") ? { from: relative(root, head[2]), spec: head[1] } : null;
      if (cur) asked.add(`${cur.from}\0${cur.spec}`);
      continue;
    }
    const hit = line.match(/^=+ Module name '(.+)' was successfully resolved to '(.+)'\. =+$/);
    if (cur && hit && hit[1] === cur.spec && hit[2].startsWith(root + "/") && !hit[2].includes("/node_modules/")) {
      answers.set(`${cur.from}\0${cur.spec}`, relative(root, hit[2]));
    }
  }
  return { answers, asked };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "strata-oracle-"));
  sh(root, "git", ["init", "-b", "main"]);
  sh(root, "git", ["config", "user.email", "test@example.com"]);
  sh(root, "git", ["config", "user.name", "test"]);
  mkdirSync(join(root, "src/lib"), { recursive: true });
  mkdirSync(join(root, "src/view"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "oracle" }));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: "./src", paths: { "@lib/*": ["lib/*"] }, jsx: "react-jsx", moduleResolution: "bundler", module: "esnext", target: "esnext", noEmit: true },
    }),
  );
  writeFileSync(join(root, "src/b.ts"), "export const b = 1;\n");
  writeFileSync(join(root, "src/ghost.ts"), "export const g = 1;\n");
  writeFileSync(join(root, "src/legacy.cts"), "export const c = 1;\n");
  writeFileSync(join(root, "src/lib/x.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "src/view/Comp.tsx"), "export const C = () => null;\n");
  // One file per resolution rule that a hand-written test could otherwise pass by accident.
  writeFileSync(join(root, "src/plain.ts"), 'import { b } from "./b";\nexport const q = b;\n');
  writeFileSync(join(root, "src/emitted.ts"), 'import { c } from "./legacy.cjs";\nexport const q = c;\n');
  writeFileSync(join(root, "src/jsx.tsx"), 'import { C } from "./view/Comp.jsx";\nexport const q = C;\n');
  writeFileSync(join(root, "src/alias.ts"), 'import { x } from "@lib/x";\nexport const q = x;\n');
  writeFileSync(join(root, "src/baseurl.ts"), 'import { x } from "lib/x";\nexport const q = x;\n');
  writeFileSync(join(root, "src/missing.ts"), 'import { n } from "./nope";\nexport const q = n;\n');
  // An apostrophe in JSX prose used to open a phantom string and revive the comment below it.
  writeFileSync(join(root, "src/prose.tsx"), 'import { b } from "./b";\nexport const T = () => <p>Don\'t panic</p>;\n// import { g } from "./ghost";\nexport const u = b;\n');
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-m", "fixture"]);
  return root;
}

test("strata agrees with the compiler on every specifier in the fixture", { skip: !existsSync(TSC) && "typescript is not installed" }, () => {
  const root = fixture();
  sh(root, process.execPath, [BIN, "index", "--quiet"]);
  const index = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const mine = new Map(index.edges.map((e) => [`${e.from}\0${e.spec}`, e.to]));
  const { answers, asked } = compilerAnswers(root);

  assert.ok(answers.size >= 5, `the oracle saw ${answers.size} in-repo resolutions, too few to trust`);
  const wrong = [];
  for (const [key, want] of answers) {
    const [from, spec] = key.split("\0");
    if (!mine.has(key)) wrong.push(`${from} imports '${spec}' but has no edge (compiler: ${want})`);
    else if (mine.get(key) !== want) wrong.push(`${from} imports '${spec}' -> ${mine.get(key)} (compiler: ${want})`);
  }
  assert.deepEqual(wrong, []);

  // The other direction: an edge the compiler never asked for was invented from a comment or a string.
  const invented = [];
  for (const e of index.edges) {
    if (e.spec.startsWith(".") && !asked.has(`${e.from}\0${e.spec}`)) invented.push(`${e.from} -> '${e.spec}'`);
  }
  assert.deepEqual(invented, []);
});

/** The `.rs` files rustc reads for a crate: its module tree, as the compiler sees it. */
function rustcModules(dir) {
  sh(dir, RUSTC, ["--edition", "2021", "--crate-type", "lib", "--emit=dep-info", "-o", "deps.d", "src/lib.rs"]);
  const text = readFileSync(join(dir, "deps.d"), "utf8").replace(/\\\n/g, " ");
  return new Set(
    [...text.matchAll(/[\w./-]+\.rs/g)].map((m) => m[0]).filter((p) => !p.startsWith("/")),
  );
}

function rustFixture() {
  const root = mkdtempSync(join(tmpdir(), "strata-rust-oracle-"));
  sh(root, "git", ["init", "-b", "main"]);
  sh(root, "git", ["config", "user.email", "test@example.com"]);
  sh(root, "git", ["config", "user.name", "test"]);
  mkdirSync(join(root, "src/a/b"), { recursive: true });
  mkdirSync(join(root, "src/m"), { recursive: true });
  mkdirSync(join(root, "src/m/n"), { recursive: true });
  writeFileSync(join(root, "Cargo.toml"), '[package]\nname = "o"\nversion = "0.1.0"\nedition = "2021"\n');
  writeFileSync(join(root, "src/lib.rs"), [
    "pub mod a;",
    "pub mod m;",
    "use crate::a::b::{Thing, deep::d};",
    "use crate::a::c::Other as Alias;",
    "// mod ghost;",
    "mod brace { pub fn inline() {} }",
    "",
  ].join("\n"));
  writeFileSync(join(root, "src/a.rs"), "pub mod b;\npub mod c;\n");
  writeFileSync(join(root, "src/a/b.rs"), "pub struct Thing;\npub mod deep;\nuse super::c::Other;\n");
  writeFileSync(join(root, "src/a/c.rs"), "pub struct Other;\n");
  writeFileSync(join(root, "src/a/b/deep.rs"), "pub fn d() {}\n");
  writeFileSync(join(root, "src/m/mod.rs"), "pub mod n;\n");
  writeFileSync(join(root, "src/m/n.rs"), "pub fn f() {}\n");
  // Present but never declared: a real crate has these, and no Edge may point at one.
  writeFileSync(join(root, "src/brace.rs"), "pub fn stray() {}\n");
  writeFileSync(join(root, "src/ghost.rs"), "pub fn stray2() {}\n");
  writeFileSync(join(root, "src/m/n/n.rs"), "pub fn stray3() {}\n");
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-m", "fixture"]);
  return root;
}

test("strata links exactly the modules rustc reads", { skip: !RUSTC && "rustc is not installed" }, () => {
  const root = rustFixture();
  sh(root, process.execPath, [BIN, "index", "--quiet"]);
  const index = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const mine = new Set(index.edges.map((e) => e.to));
  const real = rustcModules(root);

  assert.ok(real.size >= 6, `the oracle saw ${real.size} modules, too few to trust`);

  // An Edge to a file the compiler never opened was invented: a mod inside a comment,
  // a brace module, or a module guessed from a stray file.
  assert.deepEqual([...mine].filter((to) => !real.has(to)).sort(), []);

  // Everything the compiler read except the crate root has no incoming Edge.
  const roots = new Set(["src/lib.rs", "src/main.rs"]);
  assert.deepEqual([...real].filter((p) => !roots.has(p) && !mine.has(p)).sort(), []);
});

const PYTHON = (() => {
  for (const cand of [process.env.STRATA_PYTHON || "python3", "/usr/bin/python3"]) {
    try {
      execFileSync(cand, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return cand;
    } catch {
      // try the next candidate
    }
  }
  return null;
})();

/**
 * Every import `ast` can see in one file, as the specifier strata should produce.
 * The parser is the oracle: a docstring or a lost `from x import y` shows up as a
 * disagreement, which a regex cannot check against itself.
 */
function astSpecifiers(file) {
  const script = [
    "import ast, json, sys",
    "tree = ast.parse(open(sys.argv[1]).read())",
    "out = []",
    "for n in ast.walk(tree):",
    "    if isinstance(n, ast.Import):",
    "        out += [a.name for a in n.names]",
    "    elif isinstance(n, ast.ImportFrom):",
    '        base = "." * (n.level or 0) + (n.module or "")',
    "        for a in n.names:",
    '            out.append(base if a.name == "*" else (base + a.name if base.endswith(".") else base + "." + a.name))',
    "print(json.dumps(out))",
  ].join("\n");
  return JSON.parse(sh(dirnameOf(file), PYTHON, ["-c", script, file]));
}

const dirnameOf = (f) => f.slice(0, f.lastIndexOf("/")) || ".";

test("strata extracts exactly the imports ast sees", { skip: !PYTHON && "python3 is not installed" }, () => {
  const root = mkdtempSync(join(tmpdir(), "strata-py-oracle-"));
  sh(root, "git", ["init", "-b", "main"]);
  sh(root, "git", ["config", "user.email", "test@example.com"]);
  sh(root, "git", ["config", "user.name", "test"]);
  mkdirSync(join(root, "pkg"), { recursive: true });
  for (const n of ["alpha", "beta", "gamma", "delta", "theta"]) writeFileSync(join(root, `pkg/${n}.py`), "x = 1\n");
  writeFileSync(join(root, "pkg/__init__.py"), "helper = 1\n");
  writeFileSync(join(root, "pkg/models.py"), "class Value:\n    pass\n");
  // Each module is imported once: strata keeps one edge per (from, to), so two
  // specifiers naming the same file would collapse and the set comparison would
  // report a specifier that was correctly extracted but deduped away.
  writeFileSync(join(root, "pkg/main.py"), [
    "import pkg.alpha",
    "import pkg.beta as b",
    "from pkg import theta",
    "from . import helper",
    "from .models import Value",
    "from pkg import (",
    "    gamma,",
    "    delta,",
    ")",
    "# import pkg.delta",
    's = "import pkg.delta"',
    'd = """',
    "import pkg.delta",
    '"""',
    "",
  ].join("\n"));
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-m", "fixture"]);
  sh(root, process.execPath, [BIN, "index", "--quiet"]);

  const index = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  // One edge per (from, to): importing the same module twice is still one edge.
  const mine = [
    ...new Set([
      ...index.edges.filter((e) => e.from === "pkg/main.py").map((e) => e.spec),
      ...index.unresolved.filter((u) => u.file === "pkg/main.py").map((u) => u.spec),
    ]),
  ].sort();
  const seen = astSpecifiers(join(root, "pkg/main.py"));
  const real = [...new Set(seen)].sort();
  assert.ok(seen.length >= 5, `ast saw ${seen.length} imports, too few to trust`);
  assert.deepEqual(mine, real);
});
