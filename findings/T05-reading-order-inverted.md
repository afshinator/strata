# T05 — MAP.md "dependency-first" reading order is backwards

**Priority:** P0
**Status:** open
**Reviews:** R1 P-F9 (R2 missed this entirely)
**Files:** `src/lib/graph.mjs:41-64`, `src/commands/index.mjs:105`, `src/commands/index.mjs:182-186`

## Symptom

`MAP.md` is one of the two deliverables and its "Reading order (dependency-first, topological)" section lists entry points first and their deepest dependencies last. Following it means reading a file before the file it imports. The header states the inverse of what is emitted.

## Evidence

Chain `src/a.ts -> src/b.ts -> src/c.ts` plus `package.json`:

```
$ node bin/strata.mjs index --quiet
$ node -e 'const d=require(".strata/index.json");
            console.log("edges:", d.edges.map(e=>e.from+" -> "+e.to));
            console.log("readingOrder:", d.readingOrder)'
edges: [ 'src/a.ts -> src/b.ts', 'src/b.ts -> src/c.ts' ]
readingOrder: [ 'package.json', 'src/a.ts', 'src/b.ts', 'src/c.ts' ]
```

`c.ts` is the deepest dependency and is emitted last. Same defect on the strata repo's own `MAP.md`: `bin/strata.mjs` precedes `src/commands/index.mjs`, which precedes `src/lib/git.mjs`.

## Root cause

`graph.mjs:45-51` builds `indeg` by incrementing the target of every import edge, so `indeg[n]` is n's fan-in, and seeds the Kahn queue with fan-in-0 nodes — files nothing imports, i.e. entry points. Emitting a node when its fan-in reaches zero is the correct order for "who consumes me", not for "what do I need". The comment at `graph.mjs:41` and the MAP header both claim the latter.

## Fix

Invert the dependency that gates emission: a node is ready when everything it imports has already been emitted. Count a node's own imports, and release its importers as it is emitted.

```js
export function topoOrder(graph, paths) {
  const pending = new Map();
  for (const p of paths) pending.set(p, (graph.imports.get(p) || new Set()).size);
  const queue = paths.filter((p) => pending.get(p) === 0).sort();  // leaves: import nothing
  const order = [];
  while (queue.length) {
    const p = queue.shift();
    order.push(p);
    for (const importer of graph.importers.get(p) || []) {
      if (!pending.has(importer)) continue;
      const n = pending.get(importer) - 1;
      pending.set(importer, n);
      if (n === 0) queue.push(importer);
    }
  }
  const inCycle = paths.filter((p) => !order.includes(p));
  return { order, inCycle: [...inCycle].sort() };
}
```

Cycles stay in `inCycle` with the same semantics: a file whose imports are never satisfied cannot be emitted.

While here, replace `paths.filter(p => !order.includes(p))` (O(n²)) with a `Set` — see T23.

## Verify

- `a -> b -> c` → `readingOrder` ends with the file nothing imports and starts with `c.ts`.
- The strata repo's own `MAP.md` puts `src/lib/*` before `src/commands/*`.
- A cycle (`a -> b -> a`) still lists both files under `## Cycles` and omits neither from the map.
- New test: assert the exact order of a three-node chain.
