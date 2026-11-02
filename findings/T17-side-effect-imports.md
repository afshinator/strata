# T17 — `import "./x"` produces no edge and no question

**Priority:** P2
**Status:** open
**Reviews:** new (neither review found this; surfaced while building the T04 fixture)
**Files:** `src/lib/imports.mjs:115`

## Symptom

Side-effect imports are the standard way to register a module (polyfills, CSS-in-JS, `import "./globals"`, test setup files). The JS/TS extractor only matches `from "…"`, `require(…)` and `import(…)`, so `import "./x";` is invisible: no edge, no unresolved entry, no external bucket. The dependency exists and the graph does not have it, which under-reports blast radius — the exact failure mode the tool exists to prevent.

## Evidence

```
$ printf 'import "./b";\nexport const e=1;\n' > src/sideeffect.ts
$ node bin/strata.mjs index --quiet
$ node -e 'const d=require(".strata/index.json");
            console.log("edges:", JSON.stringify(d.edges.filter(e=>e.from==="src/sideeffect.ts")));
            console.log("unresolved:", JSON.stringify(d.unresolved.filter(u=>u.file==="src/sideeffect.ts")))'
edges: []
unresolved: []
```

`src/b.ts` exists in the same fixture, so this is not a resolution failure — the specifier is never extracted. Confirmed at the extractor level:

```
$ node -e 'import("./src/lib/imports.mjs").then(m=>console.log(m.extractImports("typescript", "import \"./b\";\n")))'
[]
```

## Root cause

`imports.mjs:115`:

```js
const re = /(?:from|require\s*\(|import\s*\()\s*["']([^"'\n]+)["']/g;
```

Every arm requires a preceding `from`, `require(`, or `import(`. The bare `import "…"` form has no `(` and no `from`.

## Fix

Add the arm. Keep it last so `import(...)` is matched by the dynamic-import arm first.

```js
const re = /(?:from|require\s*\(|import\s*\(|(?:^|;|\})\s*import)\s*["']([^"'\n]+)["']/g;
```

A simpler and safer form is a second pattern rather than a longer alternation:

```js
const RE_FROM = /(?:from|require\s*\(|import\s*\()\s*["']([^"'\n]+)["']/g;
const RE_BARE = /(^|[;}])\s*import\s*["']([^"'\n]+)["']/g;
```

with `push` called for `m[1]` and `m[2]` respectively. Land after T04 so the comment stripper runs first.

Keep the existing `insideString` guard so fixture strings do not become edges.

## Verify

- `import "./b";` → one edge with `spec: "./b"`.
- `import "./missing";` → one unresolved entry, reason recorded.
- `import x from "./b"` and `import("./b")` still produce exactly one edge each (no double count).
- A commented `// import "./b"` still produces nothing (depends on T04).
- New test covering all four forms.
