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

/**
 * Kahn over the import graph, dependency first: a file is emitted once every indexed
 * file it imports has been emitted, so entry points come last. Files whose imports
 * never all resolve - a cycle, or something downstream of one - cannot be ordered.
 */
export function topoOrder(graph, paths) {
  const known = new Set(paths);
  const pending = new Map(); // how many of a file's own imports are still unemitted
  for (const p of paths) {
    let n = 0;
    for (const to of graph.imports.get(p) || []) if (known.has(to)) n++;
    pending.set(p, n);
  }
  const queue = paths.filter((p) => pending.get(p) === 0).sort(); // leaves: import nothing
  const order = [];
  while (queue.length) {
    const p = queue.shift();
    order.push(p);
    for (const importer of graph.importers.get(p) || []) {
      if (!known.has(importer)) continue;
      const n = pending.get(importer) - 1;
      pending.set(importer, n);
      if (n === 0) queue.push(importer);
    }
  }
  const ordered = new Set(order);
  return { order, inCycle: paths.filter((p) => !ordered.has(p)).sort() };
}
