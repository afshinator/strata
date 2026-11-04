#!/usr/bin/env node
// Reference-repo regression check. The test suite only sees fixtures, so a change
// that breaks a real repository passes it: two did, and both were found by hand.
//
//   node scripts/reference-index.mjs --write ../finance-hub ../vidz   record
//   node scripts/reference-index.mjs                                  compare
//
// The baseline is local and gitignored: it holds absolute paths and the state of
// repos edited outside this one. `head` and `dirty` are printed every run so an
// aged baseline is visible rather than assumed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "strata.mjs");

const argv = process.argv.slice(2);
const takeFlag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const takeOption = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};

const write = takeFlag("--write");
const baselinePath = resolve(takeOption("--baseline") || join(ROOT, ".reference-baseline.json"));
const targets = argv.filter((a) => !a.startsWith("--")).map((p) => resolve(p));

const sh = (cwd, cmd, args) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }).trim();

function measure(root) {
  sh(root, process.execPath, [BIN, "index", "--root", root, "--quiet"]);
  const index = JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8"));
  const langOf = new Map(index.files.map((f) => [f.path, f.lang]));
  const byLang = {};
  for (const e of index.edges) {
    const lang = langOf.get(e.from) || "unknown";
    byLang[lang] = (byLang[lang] || 0) + 1;
  }
  const dirty = sh(root, "git", ["status", "--porcelain"])
    .split("\n")
    .filter((line) => line && !line.includes(".strata")).length;
  const head = sh(root, "git", ["rev-parse", "--short", "HEAD"]);
  return { head, dirty, edges: index.edges.length, unresolved: index.unresolved.length, byLang };
}

if (write) {
  if (!targets.length) {
    console.error("reference-index: --write needs at least one repo path");
    process.exit(2);
  }
  const baseline = targets.map((root) => ({ name: basename(root), root, ...measure(root) }));
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  for (const b of baseline) console.log(`recorded ${b.name} @ ${b.head} (${b.dirty} dirty) ${b.edges} edges`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`reference-index: no baseline at ${baselinePath}\n  run: node scripts/reference-index.mjs --write <repo>…`);
  process.exit(2);
}

let lost = 0;
let skipped = 0;
for (const before of JSON.parse(readFileSync(baselinePath, "utf8"))) {
  if (!existsSync(before.root)) {
    console.log(`skip      ${before.name}: not on this machine`);
    skipped++;
    continue;
  }
  const now = measure(before.root);
  const moved = now.head !== before.head || now.dirty !== before.dirty;
  const languages = new Set([...Object.keys(before.byLang), ...Object.keys(now.byLang)]);
  const losses = [...languages]
    .map((lang) => [lang, before.byLang[lang] || 0, now.byLang[lang] || 0])
    .filter(([, was, is]) => is < was);
  const label = `${before.name} @ ${now.head} (baseline ${before.head}, ${now.dirty} dirty)`;
  console.log(
    `${losses.length ? "LOST     " : "ok       "}${label} ${before.edges} -> ${now.edges} edges` +
      `${moved ? " · repo moved since baseline" : ""}`,
  );
  for (const [lang, was, is] of losses) {
    lost++;
    console.log(`           ${lang}: ${was} -> ${is}`);
  }
}

if (lost) {
  console.error(`reference-index: ${lost} language${lost === 1 ? "" : "s"} lost edges; re-measure before trusting it`);
  process.exit(1);
}
if (skipped) console.log(`${skipped} repo${skipped === 1 ? "" : "s"} skipped`);
