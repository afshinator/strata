import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isBinaryish, langOf, isTest, testCandidates, IMPORT_LANGS } from "./lang.mjs";

const MAX_READ = 1024 * 1024;

export function scan(root, paths) {
  const files = [];
  const sources = new Map();
  for (const path of paths) {
    if (isBinaryish(path)) continue;
    let st;
    try {
      st = statSync(join(root, path));
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_READ) continue;
    const lang = langOf(path);
    let source = null;
    if (IMPORT_LANGS.has(lang) || lang === "markdown") {
      try {
        source = readFileSync(join(root, path), "utf8");
      } catch {
        source = null;
      }
    }
    const lines = source === null ? null : source.split("\n").length;
    files.push({ path, lang, bytes: st.size, lines, test: isTest(path) });
    if (source !== null) sources.set(path, source);
  }
  return { files, sources };
}

export function mapTests(files) {
  const byPath = new Set(files.map((f) => f.path));
  const testsFor = new Map();
  const mappedTests = new Set();
  for (const f of files) {
    if (f.test) continue;
    const hits = testCandidates(f.path).filter((p) => byPath.has(p));
    if (hits.length) {
      testsFor.set(f.path, hits);
      for (const h of hits) mappedTests.add(h);
    }
  }
  return { testsFor, mappedTests };
}
