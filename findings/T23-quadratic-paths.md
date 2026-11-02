# T23 — `resolveGo` and `topoOrder` are quadratic

**Priority:** P3
**Status:** open
**Reviews:** new (neither review reported it)
**Files:** `src/lib/graph.mjs:53-63`, `src/lib/imports.mjs:197`

## Symptom

Both hotspots are O(n²) in files. Irrelevant at 17 files, which is why nothing caught it; a 5,000-file repo with a few thousand imports turns a "0 tokens, ~50ms" claim into seconds.

## Evidence

Code, not a profile — the shapes are unambiguous:

```
$ sed -n '197p' src/lib/imports.mjs
  const hits = [...fileSet].filter((p) => posix.dirname(p) === target && p.endsWith(".go"));
```
Called once per Go import. `[...fileSet]` copies the whole file set on every call, then filters all of it.

```
$ sed -n '53,63p' src/lib/graph.mjs
  while (queue.length) {
    const p = queue.shift();          // O(n) per pop on an array
    ...
  for (const p of paths) if (!order.includes(p)) inCycle.add(p);   // O(n) per path
```

`queue.shift()` is O(n) on a JS array, so the drain is O(n²); `order.includes` makes the cycle scan O(n²) as well.

## Root cause

No index over the file set for Go package lookup; array primitives used as queue and membership test.

## Fix

```js
// graph.mjs — index-based queue + Set membership
let head = 0;
while (head < queue.length) {
  const p = queue[head++];
  ...
}
const ordered = new Set(order);
const inCycle = paths.filter((p) => !ordered.has(p));
```

```js
// imports.mjs — build the Go package index once, alongside pyIndex
function makeGoIndex(fileSet) {
  const index = new Map();                      // package dir -> .go files
  for (const p of fileSet) {
    if (!p.endsWith(".go")) continue;
    const dir = posix.dirname(p);
    if (!index.has(dir)) index.set(dir, []);
    index.get(dir).push(p);
  }
  return index;
}
```

Then `resolveGo` reads `goIndex.get(target)` instead of scanning `fileSet`. Build it once in `resolveImports` next to `makePythonIndex`.

Keep the `slice(0, 20)` cap; that is a deliberate ambiguity guard, not a scaling issue. If it should become an `ambiguous` reason like the Python resolver, see the divergence noted in T06.

## Verify

- Index a synthetic 5,000-file tree; wall time grows roughly linearly. Record before/after numbers in the ticket.
- Go fixture still resolves module-relative packages identically.
- `topoOrder` output unchanged for the chain and cycle fixtures (T05, T22).
- `npm test` unchanged.
