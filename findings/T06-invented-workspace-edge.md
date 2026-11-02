# T06 — Workspace resolver invents edges instead of reporting unresolved

**Priority:** P1
**Status:** open
**Reviews:** R1 P-F14 · R2 S-F1 (R2 called this the worst defect)
**Files:** `src/lib/imports.mjs:207-236`

## Symptom

Two distinct fabrications, both violating README rule 4 ("Never an invented edge") and the promise that unresolved work lands in `QUESTIONS.md`:

1. A package whose `main` points at a build output that does not exist in git still gets an edge — to a shallow `index`/`main` file found by guesswork.
2. A subpath specifier (`@scope/pkg/attr/deep`) resolves to the package entry file, so a deep import creates a bogus dependency on `index.ts`.

Both return `{ to: [...] }` with no `QUESTIONS.md` entry, so the guess is invisible.

## Evidence

Case 1 — `main` names a nonexistent file:

```
$ cat packages/core/package.json
{"name":"@m/core","main":"./dist/missing.js"}
$ ls packages/core
lib/index.ts                      # no dist/, no src/
$ node bin/strata.mjs index --quiet
$ node -e 'const d=require(".strata/index.json");
            console.log(d.edges.map(e=>e.from+" -> "+e.to+"  [spec "+e.spec+"]"))'
[ 'packages/app/src/main.ts -> packages/core/lib/index.ts  [spec @m/core]' ]
$ node -e 'console.log(require(".strata/index.json").unresolved.length)'
0
$ grep -c '^- ' .strata/QUESTIONS.md
0
```

Case 2 — subpath specifier:

```
$ printf 'import { deep } from "@x/lib/attr/deep";\n' > packages/app/src/main.ts
$ ls packages/lib/src/attr
deep.ts
$ node -e 'console.log(require(".strata/index.json").edges)'
[ { from: 'packages/app/src/main.ts', to: 'packages/lib/src/index.ts', spec: '@x/lib/attr/deep' } ]
```

The edge points at `index.ts`, not `attr/deep.ts`.

## Root cause

`imports.mjs:214-218`: when a subpath is present, it calls `tryJsCandidates(posix.join(base, "x"), "." + "/" + posix.basename(base), fileSet)` — passing a fabricated from-path `…/attr/x` with spec `./deep` only to reuse `tryJsCandidates`. If that misses, control falls through to the `main` resolution as if the subpath did not exist.

`imports.mjs:229-233`: when `main` and its `dist/`→`src/` fallback both miss, it scans the package for `(index|main).(t|j)sx?` and returns `inside[0]` — the shallowest guess. `:234` would have produced an honest `reason`.

## Fix

Extract the file-candidate probe from `tryJsCandidates` so callers can resolve an absolute base without a fake from-path, then make every miss return a reason.

```js
function resolveFile(base, fileSet) {
  const bases = [base];
  if (base.endsWith(".js")) bases.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
  if (base.endsWith(".mjs")) bases.push(base.slice(0, -4) + ".mts");
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

function resolveWorkspace(spec, workspaces, fileSet) {
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const sub = parts.slice(spec.startsWith("@") ? 2 : 1).join("/");
  const hit = workspaces.get(name);
  if (!hit) return { external: "external dependency (not in this repo)" };
  if (sub) {
    const cand = resolveFile(posix.join(hit.dir, sub), fileSet);
    return cand ? { to: [cand] } : { reason: `workspace subpath '${spec}' does not resolve` };
  }
  if (hit.main) {
    const main = posix.normalize(posix.join(hit.dir, hit.main));
    const cand = resolveFile(main, fileSet)
      || (main.includes("/dist/") ? resolveFile(main.replace("/dist/", "/src/"), fileSet) : null);
    if (cand) return { to: [cand] };
    return { reason: `workspace '${name}' main '${hit.main}' does not resolve` };
  }
  return { reason: `workspace package '${name}' has no entry file` };
}
```

`resolveFile(main, …)` also covers the `.js`→`.ts` case that the hand-built `direct` array was doing. Delete the `inside[0]` guess entirely.

This also removes the sentinel from-path listed in T21.

## Verify

- `main: "./dist/missing.js"` with no matching source → `unresolved` has one entry, `QUESTIONS.md` lists it, no edge.
- `@x/lib/attr/deep` with `attr/deep.ts` present → edge to `attr/deep.ts`, not `index.ts`.
- `@x/lib/attr/nope` → unresolved with reason, no edge.
- Monorepo fixture from `test/index.test.mjs:106` still resolves `@m/core` → `packages/core/src/index.ts`.
