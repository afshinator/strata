/** Reverse adjacency, fan-in/out, dependency-first ordering. All deterministic. */
export function buildGraph(edges, files) {
  const importers = new Map(); // to -> Set<from>
  const imports = new Map(); // from -> Set<to>
  const fanIn = new Map();
  const fanOut = new Map();

  for (const { from, to } of edges) {
    if (!importers.has(to)) importers.set(to, new Set());
    importers.get(to).add(from);
    if (!imports.has(from)) imports.set(from, new Set());
    imports.get(from).add(to);
  }
  for (const f of files) {
    fanIn.set(f.path, (importers.get(f.path) || new Set()).size);
    fanOut.set(f.path, (imports.get(f.path) || new Set()).size);
  }
  return { importers, imports, fanIn, fanOut };
}

/** Files that (transitively) import any seed, up to depth. Seeds excluded. */
export function reverseClosure(graph, seeds, depth = 1) {
  const seen = new Set();
  let frontier = seeds.filter(Boolean);
  const byDepth = [];
  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const node of frontier) {
      for (const importer of graph.importers.get(node) || []) {
        if (seeds.includes(importer) || seen.has(importer)) continue;
        seen.add(importer);
        next.add(importer);
      }
    }
    byDepth.push([...next]);
    frontier = [...next];
    if (!frontier.length) break;
  }
  return { all: [...seen], byDepth };
}

/** Kahn topological order over the import graph: dependencies first, cycles last. */
export function topoOrder(graph, paths) {
  const inCycle = new Set();
  const indeg = new Map();
  for (const p of paths) indeg.set(p, 0);
  for (const [from, outs] of graph.imports) {
    if (!indeg.has(from)) continue;
    for (const to of outs) if (indeg.has(to)) indeg.set(to, indeg.get(to) + 1);
  }
  const queue = paths.filter((p) => indeg.get(p) === 0).sort();
  const order = [];
  while (queue.length) {
    const p = queue.shift();
    order.push(p);
    for (const to of graph.imports.get(p) || []) {
      if (!indeg.has(to)) continue;
      const n = indeg.get(to) - 1;
      indeg.set(to, n);
      if (n === 0) queue.push(to);
    }
  }
  for (const p of paths) if (!order.includes(p)) inCycle.add(p);
  return { order, inCycle: [...inCycle].sort() };
}
