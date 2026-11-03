import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "strata.mjs");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

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
