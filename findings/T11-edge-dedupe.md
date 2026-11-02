# T11 — No `(from,to)` dedupe; edge counts inflated

**Priority:** P2
**Status:** open
**Reviews:** R1 S-F6 · R2 S-F10
**Files:** `src/lib/imports.mjs:262-265`

## Symptom

The same file importing the same target twice produces two identical edge records. `stats.edges` and the `edges` line in `index` output and `MAP.md` count both. Fan-in is unaffected because `buildGraph` uses sets, so the graph is right while every published number is wrong. Combined with T04 this is how a phantom edge gets counted twice.

## Evidence

```
$ printf '// import b from "./b"\n// import b from "./b"\nexport const d=1;\n' > src/comment.ts
$ node bin/strata.mjs index --quiet
$ node -e 'const d=require(".strata/index.json");
            console.log("raw edges:", d.edges.length, "stats.edges:", d.stats.edges);
            const c={}; for (const e of d.edges) { const k=e.from+"->"+e.to; c[k]=(c[k]||0)+1 }
            console.log("dupes:", Object.entries(c).filter(([,n])=>n>1))'
raw edges: 2 stats.edges: 2
dupes: [ [ 'src/comment.ts->src/b.ts', 2 ] ]
```

R1's phrasing ("the two comment hits produced two identical edges") is only true when both hits name the same target; the dedupe defect itself is independent of comments.

## Root cause

`imports.mjs:264` pushes one record per resolved target per match, with no uniqueness constraint on `(from, to)`.

## Fix

Dedupe while collecting, keeping the first occurrence (lowest line, since `matchAll` is ordered). An edge is a graph fact, not a per-line fact.

```js
const seen = new Set();
...
for (const to of res.to) {
  if (to === f.path) continue;
  const key = `${f.path}\0${to}`;
  if (seen.has(key)) continue;
  seen.add(key);
  edges.push({ from: f.path, to, type: "imports", spec, line, tier: "regex" });
}
```

`stats.edges` then reports unique edges. If the per-line detail is ever wanted, add `lines: [n, ...]` to the record rather than duplicating the edge.

## Verify

- Two identical imports → 1 edge, `stats.edges` 1.
- Two different specifiers resolving to the same target → 1 edge.
- `MAP.md` edge count matches `edges.length`.
- Fan-in unchanged in both cases.
- New test: duplicate import in the fixture.
