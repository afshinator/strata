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

/**
 * True when a ' or " at `i` has a matching delimiter later on the same line.
 * A quoted string cannot contain a raw newline, so a quote with no closer on its
 * line is text: JSX prose (`Don't`) or a regex literal (`/['"]/`). Treating it as
 * a string would swallow the rest of the file and un-blank every comment in it.
 */
function closesOnThisLine(source, i, q) {
  let j = i + 1;
  while (j < source.length && source[j] !== q && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
  return source[j] === q;
}

/**
 * Blank out JS/TS comments while keeping byte offsets and newlines, so line numbers
 * and the string-literal guard stay valid. String-aware: `"https://x"` is not a
 * comment, and a commented-out import is not source.
 * shortcut: a `//` inside a template-literal ${} is treated as a comment, a
 * backslash line-continuation inside a string is not followed, and a lone quote
 * on a line that holds real code (`case'x'`) reads as text.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        out += c + (source[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      if (!closesOnThisLine(source, i, c)) {
        out += c;
        i++;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Rust, C and C++ comments, with strings copied through so `insideString` still
// works on the result. Does not track Rust char literals or raw strings: a lone
// `'` on a `use` or `mod` line cannot occur in valid Rust outside a char literal.
function stripSlashComments(source) {
  let out = "";
  let block = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (block > 0) {
      if (c === "/" && n === "*") { block++; out += "  "; i += 2; continue; }
      if (c === "*" && n === "/") { block--; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && n === "*") { block++; out += "  "; i += 2; continue; }
    if (c === '"') {
      out += c;
      i++;
      while (i < source.length) {
        out += source[i];
        if (source[i] === "\\") { out += source[i + 1] || ""; i += 2; continue; }
        if (source[i++] === '"') break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// `use a::{b, c::d};` -> ["a::b", "a::c::d"]; `::{self, x}` -> the parent and x.
function rustUsePaths(text) {
  const out = [];
  const walk = (body, prefix) => {
    let depth = 0;
    let cur = "";
    const items = [];
    for (const ch of body) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === "," && depth === 0) { items.push(cur); cur = ""; continue; }
      cur += ch;
    }
    items.push(cur);
    for (const raw of items) {
      const item = raw.trim().replace(/\s+as\s+[A-Za-z_]\w*$/, "");
      if (!item) continue;
      const brace = item.indexOf("{");
      if (brace >= 0) {
        const head = item.slice(0, brace).replace(/::$/, "").trim();
        const inner = item.slice(brace + 1).replace(/}\s*$/, "");
        walk(inner, head ? (prefix ? `${prefix}::${head}` : head) : prefix);
        continue;
      }
      if (item === "self") { if (prefix) out.push(prefix); continue; }
      const seg = item.replace(/::\*$/, "").replace(/^::/, "");
      if (seg) out.push(prefix ? `${prefix}::${seg}` : seg);
    }
  };
  walk(text.replace(/\s+/g, " "), "");
  return out;
}

/** Raw import specifiers, with line numbers. Regex tier by definition. */
function extractImports(lang, source) {
  const js = lang === "typescript" || lang === "javascript";
  // `push` reads `code` to skip matches inside strings, so a branch that strips
  // comments must assign here; a local `const code` would leave it on raw source
  // while the match indices come from the stripped text.
  let code = js ? stripComments(source) : source;
  const line = lineIndex(source);
  const out = [];
  const push = (spec, idx) => {
    if (spec && !insideString(code, idx)) out.push({ spec: spec.trim(), line: line(idx) });
  };

  if (js) {
    const re = /(?:from|require\s*\(|import\s*\()\s*["']([^"'\n]+)["']/g;
    for (const m of code.matchAll(re)) push(m[1], m.index);
    // Side-effect form: `import "./x"` - no `from`, no call parens.
    const bare = /(?:^|[;}])\s*import\s*["']([^"'\n]+)["']/gm;
    for (const m of code.matchAll(bare)) push(m[1], m.index + m[0].indexOf("import"));
    return out;
  }
  if (lang === "python") {
    for (const m of source.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import\b/gm)) push(m[1], m.index);
    for (const m of source.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)(?:[ \t]*#.*)?$/gm)) {
      for (const part of m[1].split(",")) {
        const spec = part.trim().split(/\s+as\s+/)[0];
        if (spec) push(spec, m.index);
      }
    }
    return out;
  }
  if (lang === "rust") {
    code = stripSlashComments(source);
    // `mod x;` is what makes the compiler read a file. `mod x {` does not.
    const modRe = /^[ \t]*(?:#\s*\[[^\]]*\][ \t]*)*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+([A-Za-z_]\w*)[ \t]*;/gm;
    for (const m of code.matchAll(modRe)) push(`self::${m[1]}`, m.index);
    const useRe = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([^;]+);/gm;
    for (const m of code.matchAll(useRe)) for (const spec of rustUsePaths(m[1])) push(spec, m.index);
    return out;
  }
  return out;
}

/** Resolve a repo-relative base to a real file, trying extensions and index files. */
function resolveFile(base, fileSet) {
  const bases = [base];
  // TS emits .js specifiers that point at .ts sources.
  if (base.endsWith(".js")) bases.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
  if (base.endsWith(".mjs")) bases.push(base.slice(0, -4) + ".mts");
  if (base.endsWith(".cjs")) bases.push(base.slice(0, -4) + ".cts");
  if (base.endsWith(".jsx")) bases.push(base.slice(0, -4) + ".tsx");

  for (const b of bases) {
    if (fileSet.has(b)) return b;
    for (const ext of JS_EXT) if (fileSet.has(b + ext)) return b + ext;
    for (const ext of JS_EXT) if (fileSet.has(posix.join(b, "index" + ext))) return posix.join(b, "index" + ext);
  }
  return null;
}

function tryJsCandidates(fromPath, spec, fileSet) {
  return resolveFile(posix.normalize(posix.join(posix.dirname(fromPath), spec)), fileSet);
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


// The directory a file's child modules live in: `a/b.rs` and `a/b/mod.rs` both
// own `a/b/x.rs`.
function rustModuleDir(fromPath) {
  const dir = posix.dirname(fromPath);
  const base = posix.basename(fromPath);
  if (base === "mod.rs" || base === "lib.rs" || base === "main.rs") return dir;
  return posix.join(dir, base.replace(/\.rs$/, ""));
}

// The `src/` of the nearest enclosing crate root.
function rustCrateSrc(fromPath, fileSet) {
  let dir = posix.dirname(fromPath);
  for (;;) {
    if (fileSet.has(posix.join(dir, "Cargo.toml"))) return posix.join(dir, "src");
    if (dir === "." || dir === "") return "src";
    dir = posix.dirname(dir);
  }
}

// `use crate::a::b::Thing` names an item, so shorten until a module file matches.
function rustFileAt(base, segs, fileSet) {
  for (let k = segs.length; k >= 1; k--) {
    const p = posix.join(base, segs.slice(0, k).join("/"));
    if (fileSet.has(`${p}.rs`)) return `${p}.rs`;
    if (fileSet.has(`${p}/mod.rs`)) return `${p}/mod.rs`;
  }
  return null;
}

function resolveRust(fromPath, spec, fileSet) {
  const segs = spec.split("::").filter(Boolean);
  const first = segs[0];
  if (!first) return { reason: "empty rust path" };
  if (first === "std" || first === "core" || first === "alloc" || first === "proc_macro" || first === "test") {
    return { external: "rust standard library" };
  }
  let base;
  let inRepo = true;
  if (first === "crate") { segs.shift(); base = rustCrateSrc(fromPath, fileSet); }
  else if (first === "super") {
    base = rustModuleDir(fromPath);
    do { base = posix.dirname(base); segs.shift(); } while (segs[0] === "super");
  } else if (first === "self") { segs.shift(); base = rustModuleDir(fromPath); }
  else {
    // An unprefixed first segment is a crate-root module if one exists, otherwise
    // an external crate. The compiler resolves both from the same syntax.
    base = rustCrateSrc(fromPath, fileSet);
    inRepo = false;
  }
  const hit = rustFileAt(base, segs, fileSet);
  if (hit) return { to: [hit] };
  if (inRepo) return { reason: "rust module does not resolve" };
  return { external: "not in this crate" };
}


/**
 * Declared module path mappings from the root tsconfig. TypeScript accepts
 * comments and trailing commas there, so neither can be fed to JSON.parse raw.
 * shortcut: only the root tsconfig is read - `extends` chains, nested configs
 * and `${configDir}` are not followed, so a monorepo that declares paths lower
 * down keeps those imports external. Upgrade when such a repo shows up.
 */
export function buildTsPaths(root) {
  const out = { root, patterns: [], baseUrl: null, error: null };
  let source;
  try {
    source = readFileSync(join(root, "tsconfig.json"), "utf8");
  } catch {
    return out; /* no config at all: nothing was declared, so nothing is lost */
  }
  const stripped = stripComments(source).replace(/^\uFEFF/, "");
  let ts = null;
  try {
    ts = JSON.parse(stripped);
  } catch {
    try {
      ts = JSON.parse(stripped.replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      out.error = "tsconfig.json could not be parsed, so every declared path alias was ignored";
      return out;
    }
  }
  const co = ts.compilerOptions || {};
  const base = co.baseUrl ? join(root, co.baseUrl) : root;
  out.baseUrl = co.baseUrl ? base : null;
  for (const [pattern, targets] of Object.entries(co.paths || {})) {
    const star = pattern.indexOf("*");
    out.patterns.push({
      prefix: star === -1 ? pattern : pattern.slice(0, star),
      suffix: star === -1 ? "" : pattern.slice(star + 1),
      wildcard: star !== -1,
      targets: (Array.isArray(targets) ? targets : [targets]).map((t) => join(base, t)),
    });
  }
  return out;
}

/** Longest matching prefix wins, so `@/data/*` beats `@/*`. */
function resolveTsPath(spec, tsPaths, fileSet) {
  let best = null;
  for (const p of tsPaths.patterns) {
    if (!spec.startsWith(p.prefix) || !spec.endsWith(p.suffix)) continue;
    if (spec.length < p.prefix.length + p.suffix.length) continue;
    if (!best || p.prefix.length > best.prefix.length) best = p;
  }
  if (!best) return null;
  const captured = spec.slice(best.prefix.length, spec.length - best.suffix.length);
  for (const target of best.targets) {
    const abs = best.wildcard ? target.replace("*", captured) : target;
    // A target outside the repo is not ours to resolve.
    if (!abs.startsWith(tsPaths.root + "/")) continue;
    const hit = resolveFile(posix.normalize(abs.slice(tsPaths.root.length + 1)), fileSet);
    if (hit) return { to: [hit] };
  }
  return { reason: `tsconfig path '${spec}' matches a declared pattern but does not resolve` };
}

/**
 * A bare specifier also resolves against `baseUrl`, with or without `paths`.
 * Silent on a miss: a package that is not in the tree is external, not a
 * question, so this can never flood QUESTIONS.md the way a `*` pattern would.
 */
function resolveBaseUrl(spec, tsPaths, fileSet) {
  if (!tsPaths.baseUrl) return null;
  const abs = posix.join(tsPaths.baseUrl, spec);
  if (!abs.startsWith(tsPaths.root + "/")) return null;
  const hit = resolveFile(posix.normalize(abs.slice(tsPaths.root.length + 1)), fileSet);
  return hit ? { to: [hit] } : null;
}

function resolveWorkspace(spec, workspaces, fileSet) {
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const sub = parts.slice(spec.startsWith("@") ? 2 : 1).join("/");
  const hit = workspaces.get(name);
  if (!hit) return { external: "not in this repo: third-party dependency or unmodelled alias" };
  // A subpath names its own file. It never falls back to the package entry.
  if (sub) {
    const cand = resolveFile(posix.join(hit.dir, sub), fileSet);
    return cand ? { to: [cand] } : { reason: `workspace subpath '${spec}' does not resolve` };
  }
  if (!hit.main) return { reason: `workspace package '${name}' declares no entry file` };
  const main = posix.normalize(posix.join(hit.dir, hit.main));
  // Build output paths point at nothing in git; the source tree is the real target.
  const cand =
    resolveFile(main, fileSet) ||
    (main.includes("/dist/") ? resolveFile(main.replace("/dist/", "/src/"), fileSet) : null);
  if (cand) return { to: [cand] };
  return { reason: `workspace '${name}' main '${hit.main}' does not resolve` };
}

export function resolveImports({ files, fileSet, sources, workspaces = new Map(), tsPaths = null }) {
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
          if (hit) res = { to: [hit] };
          else {
            // A relative path that normalises above the root names a file this run
            // cannot see, so it is external rather than a broken in-repo import.
            const target = spec.startsWith("/")
              ? spec
              : posix.normalize(posix.join(posix.dirname(f.path), spec));
            res = target === ".." || target.startsWith("../") || target.startsWith("/")
              ? { external: "not in this repo: outside the analysed root" }
              : { reason: "relative path does not resolve" };
          }
        } else if (isNodeBuiltin(spec)) {
          res = { external: "node builtin" };
        } else {
          res =
            (tsPaths && resolveTsPath(spec, tsPaths, fileSet)) ||
            (tsPaths && resolveBaseUrl(spec, tsPaths, fileSet)) ||
            resolveWorkspace(spec, workspaces, fileSet);
        }
      } else if (f.lang === "python") res = resolvePython(f.path, spec, pyIndex, fileSet);
      else if (f.lang === "rust") res = resolveRust(f.path, spec, fileSet);
      else continue;

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
