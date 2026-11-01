import { posix } from "node:path";

const JS_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

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

/** Raw import specifiers, with line numbers. Regex tier by definition. */
export function extractImports(lang, source) {
  const line = lineIndex(source);
  const out = [];
  const push = (spec, idx) => {
    if (spec) out.push({ spec: spec.trim(), line: line(idx) });
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
  return { reason: `no module '${spec}' in this repo` };
}

function resolveGo(fromPath, spec, goModule, fileSet) {
  if (!goModule || !spec.startsWith(goModule)) return { reason: "external package" };
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

export function resolveImports({ files, fileSet, sources, goModule }) {
  const edges = [];
  const unresolved = [];
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
        } else {
          res = { reason: "bare specifier (tsconfig paths not modelled in v0.1)" };
        }
      } else if (f.lang === "python") res = resolvePython(f.path, spec, pyIndex, fileSet);
      else if (f.lang === "go") res = resolveGo(f.path, spec, goModule, fileSet);
      else res = resolveC(f.path, spec, fileSet);

      if (res.to) {
        for (const to of res.to) {
          if (to === f.path) continue;
          edges.push({ from: f.path, to, type: "imports", spec, line, tier: "regex" });
        }
      } else {
        unresolved.push({ file: f.path, spec, line, reason: res.reason });
      }
    }
  }
  return { edges, unresolved };
}
