import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isBinaryish, langOf, isTest, testCandidates, IMPORT_LANGS } from "./lang.mjs";

export const MAX_READ = 1024 * 1024;

export function scan(root, paths) {
  const files = [];
  const sources = new Map();
  const oversized = [];
  for (const path of paths) {
    if (isBinaryish(path)) continue;
    let st;
    try {
      st = statSync(join(root, path));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const lang = langOf(path);
    const tooBig = st.size > MAX_READ;
    let source = null;
    if (!tooBig && (IMPORT_LANGS.has(lang) || lang === "markdown")) {
      try {
        source = readFileSync(join(root, path), "utf8");
      } catch {
        source = null;
      }
    }
    const lines = source === null ? null : source.split("\n").length;
    files.push({ path, lang, bytes: st.size, lines, test: isTest(path) });
    if (source !== null) sources.set(path, source);
    // A file in the tree is part of the graph even when its contents are not read.
    if (tooBig) oversized.push({ path, bytes: st.size });
  }
  return { files, sources, oversized };
}

const TEST_DIR = /(^|\/)(tests?|__tests__|specs?)\//i;

/** The name a test and its source share: `a.test.ts`, `test_a.py` and `a_test.go` all yield `a`. */
function stemOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return base;
  const ext = base.slice(dot);
  const stem = base.slice(0, dot);
  if (/\.(?:[cm]?[jt]sx?)$/i.test(ext)) return stem.replace(/\.(test|spec)$/i, "");
  if (ext === ".py") return stem.replace(/^test_/, "");
  if (ext === ".go") return stem.replace(/_test$/, "");
  return stem;
}

export function mapTests(files, graph) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const testsFor = new Map();
  const mappedTests = new Set();

  // Tests kept in a directory of their own are matched by name. Only paths under a
  // test directory are indexed: a `.test.ts` sitting beside unrelated source would
  // otherwise claim a source in another directory.
  // shortcut: matching is by name, so two sources sharing a name both claim the same
  // test. Upgrade to mirrored paths if that bites.
  const testsByStem = new Map();
  for (const f of files) {
    if (!f.test || !TEST_DIR.test(f.path)) continue;
    const stem = stemOf(f.path);
    if (!testsByStem.has(stem)) testsByStem.set(stem, []);
    testsByStem.get(stem).push(f.path);
  }

  for (const f of files) {
    if (f.test) continue;
    // Strongest first: a test beside the source, then a test that imports it, then a name.
    const local = testCandidates(f.path).filter((p) => byPath.has(p));
    const importing = [...(graph?.importers.get(f.path) || [])].filter((p) => byPath.get(p)?.test).sort();
    const named = (testsByStem.get(stemOf(f.path)) || []).slice().sort();
    const hits = local.length ? local : importing.length ? importing : named;
    if (hits.length) {
      testsFor.set(f.path, hits);
      for (const h of hits) mappedTests.add(h);
    }
  }
  return { testsFor, mappedTests };
}
