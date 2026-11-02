import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { dirtyPaths, head, isRepo, listFiles, history, topOwners } from "../lib/git.mjs";
import { scan, mapTests } from "../lib/scan.mjs";
import { resolveImports, buildWorkspaces } from "../lib/imports.mjs";
import { buildGraph, topoOrder } from "../lib/graph.mjs";
import { writeIndex, writeText, lock, paths, DATA_DIR } from "../lib/store.mjs";
import { IMPORT_LANGS } from "../lib/lang.mjs";

function goModuleOf(root) {
  try {
    const m = readFileSync(join(root, "go.mod"), "utf8").match(/^module\s+(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function repoIdentity(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return { name: pkg.name || null, description: pkg.description || null, pkg };
  } catch {
    return { name: null, description: null, pkg: null };
  }
}

function entryPoints(files, pkg) {
  const out = new Set();
  if (pkg) {
    const bins = typeof pkg.bin === "string" ? [pkg.bin] : pkg.bin ? Object.values(pkg.bin) : [];
    for (const b of bins) out.add(b);
    if (pkg.main) out.add(pkg.main);
  }
  for (const f of files) {
    const p = f.path;
    if (/(^|\/)main\.go$/.test(p)) out.add(p);
    if (/(^|\/)(src\/)?(index|main|cli|app)\.(t|j)sx?$/.test(p)) out.add(p);
    if (/(^|\/)__main__\.py$/.test(p)) out.add(p);
    if (/(^|\/)(server|app)\.py$/.test(p)) out.add(p);
  }
  return [...out].filter((p) => files.some((f) => f.path === p)).sort();
}

function pct(n, d) {
  return d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`;
}

export function index(root, args = {}) {
  if (!isRepo(root)) {
    process.stderr.write("strata: not a git repository. v0.1 requires git (it uses `git ls-files` and `git log`).\n");
    return 2;
  }
  const lk = lock(root);
  if (!lk) {
    process.stderr.write(`strata: another run holds ${paths(root).lock}; refusing to interleave writes.\n`);
    return 2;
  }

  try {
    const started = Date.now();
    const headSha = head(root);
    const inDataDir = (p) => p === DATA_DIR || p.startsWith(`${DATA_DIR}/`);
    const dirty = dirtyPaths(root).filter((d) => !inDataDir(d.path)).length;

    const allPaths = listFiles(root).filter((p) => !inDataDir(p));
    const { files, sources } = scan(root, allPaths);
    const fileSet = new Set(files.map((f) => f.path));
    const goModule = goModuleOf(root);

    const workspaces = buildWorkspaces(root);
    const { edges, unresolved, external } = resolveImports({ files, fileSet, sources, goModule, workspaces });
    const graph = buildGraph(edges, files);
    const { testsFor, mappedTests } = mapTests(files, graph);
    const hist = history(root);
    const { order, inCycle } = topoOrder(graph, files.map((f) => f.path));

    const byLang = {};
    for (const f of files) byLang[f.lang] = (byLang[f.lang] || 0) + 1;
    const noExtractor = files.filter((f) => !IMPORT_LANGS.has(f.lang)).length;

    const data = {
      version: 1,
      // Reproducible on purpose: no absolute path, no wall-clock timestamp. The briefing
      // carries the generation time instead, so a committed artifact does not churn.
      rootName: basename(root),
      head: headSha,
      dirtyFiles: dirty,
      tier: "regex",
      stats: {
        files: files.length,
        edges: edges.length,
        unresolved: unresolved.length,
        external: Object.fromEntries(external),
        noExtractor,
        langs: byLang,
        commitsConsidered: hist.commits,
      },
      files: files.map((f) => ({
        ...f,
        churn: hist.churn.get(f.path) || 0,
        owners: topOwners(hist.owners, f.path).map(([email, n]) => ({ email, n })),
        tests: testsFor.get(f.path) || [],
      })),
      edges,
      unresolved,
      readingOrder: order,
      cycles: inCycle,
    };
    writeIndex(root, data);

    const ident = repoIdentity(root);
    const map = renderMap({ data, ident, graph, files, testsFor, mappedTests, hist, generatedAt: new Date().toISOString() });
    writeText(root, paths(root).map, map);
    writeText(root, paths(root).questions, renderQuestions(unresolved));

    if (!args.quiet) {
      const top = files
        .map((f) => ({ p: f.path, n: graph.fanIn.get(f.path) || 0 }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 1)[0];
      const ms = Date.now() - started;
      process.stdout.write(
        [
          `strata index (0 tokens · ${ms}ms)   ${files.length} files · ${Object.keys(byLang).length} languages`,
          `edges    ${edges.length} at tier=regex · ${unresolved.length} unresolved · ${[...external.values()].reduce((a, b) => a + b, 0)} external skipped`,
          `tests    ${mappedTests.size} test files matched to sources by convention`,
          `churn    ${hist.commits} commits / 90d${top ? ` · top fan-in ${top.p} (${top.n})` : ""}`,
          `exports  ${noExtractor} files have no import extractor at this tier`,
          `wrote    .strata/index.json · MAP.md · QUESTIONS.md`,
          ``,
          `next     strata blast --since HEAD~1   ·   read .strata/MAP.md`,
        ].join("\n") + "\n",
      );
    }
    return 0;
  } finally {
    lk.release();
  }
}

function renderMap({ data, ident, graph, files, testsFor, mappedTests, hist, generatedAt }) {
  const { stats } = data;
  const langs = Object.entries(stats.langs).sort((a, b) => b[1] - a[1]);
  const name = ident.name || data.rootName;
  const L = [];
  L.push(`# ${name} — codebase map`, "");
  L.push(
    `_Generated by \`strata index\` at ${generatedAt} from ${
      data.head ? data.head.slice(0, 7) : "no commits"
    } (${data.dirtyFiles} dirty files). Do not edit; regenerate._`,
    "",
  );
  if (ident.description) L.push(`${ident.description}`, "");

  L.push("## Numbers", "");
  L.push(
    `${stats.files} files · ${langs.map(([l, n]) => `${l} ${n}`).join(" · ")}`,
    `${stats.edges} import edges (tier: **regex**) · ${stats.unresolved} unresolved · ${
      Object.values(stats.external || {}).reduce((a, b) => a + b, 0)
    } external (not repo edges) · ${stats.noExtractor} files have no extractor`,
    `${mappedTests.size} test files matched by convention · churn window 90d, ${stats.commitsConsidered} commits`,
    "",
  );

  const entries = entryPoints(files, ident.pkg);
  if (entries.length) {
    L.push("## Entry points", "");
    for (const e of entries.slice(0, 12)) L.push(`- \`${e}\``);
    L.push("");
  }

  const byFanIn = files
    .map((f) => ({ path: f.path, fanIn: graph.fanIn.get(f.path) || 0, fanOut: graph.fanOut.get(f.path) || 0 }))
    .sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path));

  L.push("## Everything depends on these", "");
  L.push("| file | fan-in | fan-out | churn |", "|---|---|---|---|");
  for (const f of byFanIn.slice(0, 10)) {
    L.push(`| \`${f.path}\` | ${f.fanIn} | ${f.fanOut} | ${hist.churn.get(f.path) || 0} |`);
  }
  L.push("");

  L.push("## Reading order (dependency-first, topological)", "");
  for (const p of data.readingOrder.slice(0, 25)) L.push(`- \`${p}\``);
  if (data.readingOrder.length > 25) L.push(`- … ${data.readingOrder.length - 25} more`);
  L.push("");

  if (data.cycles.length) {
    L.push("## Unorderable files", "", `${data.cycles.length} files are unreachable from a topological order:`, "");
    for (const p of data.cycles.slice(0, 15)) L.push(`- \`${p}\``);
    L.push("");
  }

  const hotspots = byFanIn
    .map((f) => ({ ...f, score: (hist.churn.get(f.path) || 0) * (f.fanIn + 1) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  if (hotspots.length) {
    L.push("## Hotspots (churn × (fan-in + 1))", "");
    L.push("Ranked by churn × (fan-in + 1), so a frequently changed file still ranks with no importers.", "");
    for (const h of hotspots) L.push(`- \`${h.path}\` — ${hist.churn.get(h.path)} commits, fan-in ${h.fanIn}`);
    L.push(
      "",
      "Risk legend: HIGH at fan-in ≥ 20, churn ≥ 30, or fan-in ≥ 10 with churn ≥ 10; MEDIUM at fan-in ≥ 5 or churn ≥ 10.",
    );
    L.push("");
  }

  const gaps = byFanIn.filter((f) => f.fanIn > 0 && !(testsFor.get(f.path) || []).length).slice(0, 10);
  if (gaps.length) {
    L.push("## Untested and depended on", "");
    for (const g of gaps) L.push(`- \`${g.path}\` — fan-in ${g.fanIn}, no test file by convention`);
    L.push("");
  }

  const byReason = new Map();
  for (const u of data.unresolved) byReason.set(u.reason, (byReason.get(u.reason) || 0) + 1);
  if (byReason.size) {
    L.push("## Unresolved imports", "");
    for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) L.push(`- ${n} × ${reason}`);
    L.push("", "Full list: `.strata/QUESTIONS.md`", "");
  }
  return L.join("\n");
}

function renderQuestions(unresolved) {
  const L = ["# Open questions", "", "Everything `strata` could not determine deterministically. One line each.", ""];
  const byReason = new Map();
  for (const u of unresolved) {
    if (!byReason.has(u.reason)) byReason.set(u.reason, []);
    byReason.get(u.reason).push(u);
  }
  for (const [reason, items] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`## ${reason} (${items.length})`, "");
    for (const u of items.slice(0, 200)) L.push(`- \`${u.file}:${u.line}\` ${u.spec}`);
    if (items.length > 200) L.push(`- … ${items.length - 200} more`);
    L.push("");
  }
  return L.join("\n");
}
