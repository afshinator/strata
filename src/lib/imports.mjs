import { posix } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const JS_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// Node builtins are not repo dependencies and must not pollute QUESTIONS.md.
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2",
  "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "string_decoder", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib", "test",
]);

function isNodeBuiltin(spec) {
  if (spec.startsWith("node:")) return true;
  return NODE_BUILTINS.has(spec.split("/")[0]) && !spec.startsWith(".");
}

/**
 * Workspace package name -> directory, from the root manifests. Without this a
 * monorepo reports every `@scope/pkg` import as unresolved.
 * shortcut: only expands one level of `dir/*` workspace patterns.
 */
export function buildWorkspaces(root) {
  const map = new Map();
  const patterns = [];
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces && pkg.workspaces.packages) || [];
    patterns.push(...ws);
  } catch {
    /* no root manifest; pnpm-workspace.yaml may still exist */
  }
  try {
    const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    for (const line of yaml.split("\n")) {
      const m = line.match(/^\s*-\s*['"]?([^'"\s#]+)['"]?\s*$/);
      if (m) patterns.push(m[1]);
    }
  } catch {
    /* no pnpm workspace */
  }
  if (!patterns.length) return map;
  const dirs = new Set();
  for (const pat of patterns) {
    const clean = String(pat).replace(/\/+\*+$/, "");
    if (clean.includes("*")) continue;
    dirs.add(clean);
    try {
      for (const entry of readdirSync(join(root, clean), { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.add(posix.join(clean, entry.name));
      }
    } catch {
      /* missing workspace dir */
    }
  }
  for (const dir of dirs) {
    try {
      const p = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
      if (p.name) map.set(p.name, { dir, main: p.main || p.module || null });
    } catch {
      /* not a package */
    }
  }
  return map;
}

function lineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * True when the match starts inside a single-line string literal: fixture code
 * written as `"import x from './y'"` must not become an edge.
 * shortcut: only single-line quotes are detected; template literals spanning
 * lines still produce false positives.
 */
function insideString(source, idx) {
  let lineStart = source.lastIndexOf("\n", idx - 1) + 1;
  let dq = 0;
  let sq = 0;
  let bt = 0;
  for (let i = lineStart; i < idx; i++) {
    const c = source[i];
    if (c === "\\") i++;
    else if (c === '"') dq++;
    else if (c === "'") sq++;
    else if (c === "`") bt++;
  }
  return dq % 2 === 1 || sq % 2 === 1 || bt % 2 === 1;
}

/** Raw import specifiers, with line numbers. Regex tier by definition. */
function extractImports(lang, source) {
  const line = lineIndex(source);
  const out = [];
  const push = (spec, idx) => {
    if (spec && !insideString(source, idx)) out.push({ spec: spec.trim(), line: line(idx) });
  };

  if (lang === "typescript" || lang === "javascript") {
    const re = /(?:from|require\s*\(|import\s*\()\s*["']([^"'\n]+)["']/g;
    for (const m of source.matchAll(re)) push(m[1], m.index);
    return out;
  }
  if (lang === "python") {
    for (const m of source.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import\b/gm)) push(m[1], m.index);
    for (const m of source.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)$/gm)) {
      for (const part of m[1].split(",")) {
        const spec = part.trim().split(/\s+as\s+/)[0];
        if (spec) push(spec, m.index);
      }
    }
    return out;
  }
  if (lang === "go") {
    for (const block of source.matchAll(/import\s*\(([\s\S]*?)\)/g)) {
      const base = block.index;
      for (const m of block[1].matchAll(/"([^"\n]+)"/g)) push(m[1], base + m.index);
    }
    for (const m of source.matchAll(/^[ \t]*import[ \t]+(?:\w+[ \t]+)?"([^"\n]+)"/gm)) push(m[1], m.index);
    return out;
  }
  if (lang === "c" || lang === "cpp") {
    for (const m of source.matchAll(/^[ \t]*#[ \t]*include[ \t]+"([^"\n]+)"/gm)) push(m[1], m.index);
    return out;
  }
  return out;
}

function tryJsCandidates(fromPath, spec, fileSet) {
  const dir = posix.dirname(fromPath);
  const target = posix.normalize(posix.join(dir, spec));
  const bases = [target];
  // TS emits .js specifiers that point at .ts sources.
  if (target.endsWith(".js")) bases.push(target.slice(0, -3) + ".ts", target.slice(0, -3) + ".tsx");
  if (target.endsWith(".mjs")) bases.push(target.slice(0, -4) + ".mts");

  for (const base of bases) {
    if (fileSet.has(base)) return base;
    for (const ext of JS_EXT) if (fileSet.has(base + ext)) return base + ext;
    for (const ext of JS_EXT) if (fileSet.has(posix.join(base, "index" + ext))) return posix.join(base, "index" + ext);
  }
  return null;
}

function makePythonIndex(fileSet) {
  const index = new Map();
  for (const p of fileSet) {
    if (!p.endsWith(".py") && !p.endsWith(".pyi")) continue;
    const noExt = p.replace(/\.pyi?$/, "");
    const mod = noExt.endsWith("/__init__") ? noExt.slice(0, -"/__init__".length) : noExt;
    const id = mod.replace(/\//g, ".");
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(p);
  }
  return index;
}

function resolvePython(fromPath, spec, pyIndex, fileSet) {
  const dots = spec.match(/^\.+/)?.[0].length ?? 0;
  if (dots > 0) {
    const rest = spec.slice(dots).replace(/\./g, "/");
    let dir = posix.dirname(fromPath);
    for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
    const base = posix.normalize(posix.join(dir, rest));
    for (const cand of [base + ".py", posix.join(base, "__init__.py")]) if (fileSet.has(cand)) return { to: [cand] };
    return { reason: `relative import '${spec}' resolved to nothing` };
  }
  const hits = pyIndex.get(spec);
  if (hits && hits.length === 1) return { to: [hits[0]] };
  if (hits && hits.length > 1) return { reason: `ambiguous: '${spec}' matches ${hits.length} files` };
  // `from a.b import c` where c is a module.
  for (const [id, files] of pyIndex) {
    if (id.endsWith("." + spec) && files.length === 1) return { to: [files[0]] };
  }
  return { external: "third-party or stdlib module" };
}

function resolveGo(fromPath, spec, goModule, fileSet) {
  if (!goModule || !spec.startsWith(goModule)) return { external: "external package" };
  const rel = spec.slice(goModule.length).replace(/^\//, "");
  const target = rel === "" ? "." : rel;
  const hits = [...fileSet].filter((p) => posix.dirname(p) === target && p.endsWith(".go"));
  if (hits.length === 0) return { reason: `package dir '${target}' has no .go files` };
  return { to: hits.slice(0, 20) };
}

function resolveC(fromPath, spec, fileSet) {
  const target = posix.normalize(posix.join(posix.dirname(fromPath), spec));
  return fileSet.has(target) ? { to: [target] } : { reason: "header not found next to the source (include dirs not modelled)" };
}

function resolveWorkspace(spec, workspaces, fileSet) {
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const sub = parts.slice(spec.startsWith("@") ? 2 : 1).join("/");
  const hit = workspaces.get(name);
  if (!hit) return { external: "external dependency (tsconfig paths not modelled in v0.1)" };
  const base = sub ? posix.join(hit.dir, sub) : hit.dir;
  if (sub) {
    const cand = tryJsCandidates(posix.join(base, "x"), "." + "/" + posix.basename(base), fileSet);
    if (cand) return { to: [cand] };
  }
  const direct = [];
  if (hit.main) {
    const main = posix.normalize(posix.join(hit.dir, hit.main));
    direct.push(main, ...JS_EXT.map((e) => main.replace(/\.[cm]?js$/, "") + e));
    // Build output paths (dist/index.js) point at nothing in git; try the source tree.
    if (main.includes("/dist/")) {
      const src = main.replace("/dist/", "/src/");
      direct.push(src, ...JS_EXT.map((e) => src.replace(/\.[cm]?js$/, "") + e));
    }
  }
  for (const p of direct) if (fileSet.has(p)) return { to: [p] };
  // Any shallow entry file inside the package.
  const inside = [...fileSet]
    .filter((p) => p.startsWith(hit.dir + "/") && /(^|\/)(index|main)\.(t|j)sx?$/.test(p))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  if (inside.length) return { to: [inside[0]] };
  return { reason: `workspace package '${name}' has no resolvable entry file` };
}

export function resolveImports({ files, fileSet, sources, goModule, workspaces = new Map() }) {
  const edges = [];
  const seen = new Set(); // one edge per (from, to); import sites may repeat
  const unresolved = [];
  const external = new Map();
  const pyIndex = makePythonIndex(fileSet);

  for (const f of files) {
    const source = sources.get(f.path);
    if (source === undefined) continue;
    for (const { spec, line } of extractImports(f.lang, source)) {
      let res;
      if (f.lang === "typescript" || f.lang === "javascript") {
        if (spec.startsWith(".") || spec.startsWith("/")) {
          const hit = tryJsCandidates(f.path, spec, fileSet);
          res = hit ? { to: [hit] } : { reason: "relative path does not resolve" };
        } else if (isNodeBuiltin(spec)) {
          res = { external: "node builtin" };
        } else {
          res = resolveWorkspace(spec, workspaces, fileSet);
        }
      } else if (f.lang === "python") res = resolvePython(f.path, spec, pyIndex, fileSet);
      else if (f.lang === "go") res = resolveGo(f.path, spec, goModule, fileSet);
      else res = resolveC(f.path, spec, fileSet);

      if (res.to) {
        for (const to of res.to) {
          if (to === f.path) continue;
          const key = `${f.path}\0${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ from: f.path, to, type: "imports", spec, line, tier: "regex" });
        }
      } else if (res.external) {
        external.set(res.external, (external.get(res.external) || 0) + 1);
      } else {
        unresolved.push({ file: f.path, spec, line, reason: res.reason });
      }
    }
  }
  return { edges, unresolved, external };
}
