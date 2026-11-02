import { readIndex } from "../lib/store.mjs";
import { buildGraph, reverseClosure } from "../lib/graph.mjs";
import { changedSince, dirtyPaths, head, tryGit } from "../lib/git.mjs";

export function riskOf(entry) {
  const fanIn = entry.fanIn || 0;
  const churn = entry.churn || 0;
  if (fanIn >= 20 || churn >= 30 || (fanIn >= 10 && churn >= 10)) return "HIGH";
  if (fanIn >= 5 || churn >= 10) return "MEDIUM";
  return "LOW";
}

export function blast(root, args = {}) {
  // Bad input is a usage error and is refused before anything is reported on.
  const depthArg = args.depth;
  const depth = depthArg === undefined ? 1 : Number(depthArg);
  if (depthArg === true || !Number.isInteger(depth) || depth < 1) {
    const shown = depthArg === true ? "(no value)" : depthArg;
    process.stderr.write(`strata: --depth must be a positive integer, got '${shown}'\n`);
    return 2;
  }
  if (args.since && tryGit(root, ["rev-parse", "--verify", "--quiet", `${args.since}^{commit}`]) === null) {
    process.stderr.write(`strata: unknown revision '${args.since}'\n`);
    return 2;
  }

  const data = readIndex(root);
  if (!data) {
    // A report, not a gate: missing index is a notice, so it never fails a build.
    process.stdout.write("strata: no index — run `strata index` (it costs nothing).\n");
    return 0;
  }
  const graph = buildGraph(data.edges, data.files);
  const byPath = new Map(data.files.map((f) => [f.path, f]));

  let changed;
  let basis;
  if (args.since) {
    changed = changedSince(root, args.since);
    basis = `since ${args.since}`;
  } else {
    const dirty = dirtyPaths(root);
    changed = dirty.map((d) => d.path);
    basis = "working tree";
  }
  const untracked = [];
  changed = [...new Set(changed)].filter((p) => {
    if (byPath.has(p)) return true;
    untracked.push(p);
    return false;
  });

  const { all: affected, byDepth } = reverseClosure(graph, changed, depth);
  const tests = new Set();
  for (const p of [...changed, ...affected]) {
    const f = byPath.get(p);
    for (const t of f?.tests || []) tests.add(t);
  }
  const owners = new Map();
  for (const p of changed) {
    for (const o of byPath.get(p)?.owners || []) owners.set(o.email, (owners.get(o.email) || 0) + o.n);
  }

  const seeds = changed.map((p) => {
    const f = byPath.get(p) || { path: p };
    return { path: p, fanIn: graph.fanIn.get(p) || 0, fanOut: graph.fanOut.get(p) || 0, churn: f.churn || 0 };
  });
  const worst = seeds.map((s) => ({ ...s, risk: riskOf(s) })).sort((a, b) => a.risk.localeCompare(b.risk));

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          basis,
          head: data.head,
          tier: data.tier,
          currentHead: head(root),
          changed,
          affected: { direct: byDepth[0] || [], all: affected },
          tests: [...tests].sort(),
          owners: [...owners.entries()].map(([email, n]) => ({ email, n })),
          seeds: worst,
          untracked,
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  // JSON is emitted above for every path, so a consumer never gets prose.
  // With nothing indexed there is no closure to report, only work to ask for.
  if (!changed.length) {
    if (!untracked.length) {
      process.stdout.write(`strata blast — no changes in the ${basis}.\n`);
      return 0;
    }
    const L = [
      `strata blast — 0 indexed changes, ${untracked.length} path(s) not in the index (${basis})`,
      "",
    ];
    for (const p of untracked) L.push(`  ${p}`);
    L.push("", "Run `strata index` to include them.");
    process.stdout.write(L.join("\n") + "\n");
    return 0;
  }

  if (args.sketch) {
    const L = [`blast ${basis}${data.tier ? ` · tier ${data.tier}` : ""}`, ""];
    for (const s of seeds) {
      L.push(`${s.path}   fan-in ${s.fanIn} · churn ${s.churn} · ${riskOf(s)}`);
      const direct = [...(graph.importers.get(s.path) || [])].filter((p) => !changed.includes(p)).sort();
      for (const d of direct.slice(0, 8)) L.push(`  ${d}`);
      if (direct.length > 8) L.push(`  … ${direct.length - 8} more importers`);
      L.push("");
    }
    process.stdout.write(L.join("\n"));
    return 0;
  }

  const out = [];
  out.push(`strata blast — ${changed.length} changed file(s), ${basis}${data.tier ? ` · tier ${data.tier}` : ""}`);
  out.push(`direct importers     ${(byDepth[0] || []).length}`);
  if (depth > 1) out.push(`transitive (${depth} hops)  ${affected.length}`);
  out.push(`tests touched        ${tests.size}`);
  out.push(`owners               ${[...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e, n]) => `${e} (${n})`).join(", ") || "unknown"}`);
  out.push("");
  out.push("risk    file                                                 fan-in  churn");
  for (const s of worst.slice(0, 12)) {
    out.push(`${s.risk.padEnd(7)} ${s.path.slice(0, 52).padEnd(52)} ${String(s.fanIn).padStart(6)}  ${String(s.churn).padStart(5)}`);
  }
  if (tests.size) {
    out.push("", "affected tests");
    for (const t of [...tests].sort().slice(0, 12)) out.push(`  ${t}`);
  }
  if ((byDepth[0] || []).length) {
    out.push("", `direct importers (first 12 of ${byDepth[0].length})`);
    for (const p of byDepth[0].slice(0, 12)) out.push(`  ${p}`);
  }
  if (untracked.length) {
    out.push("", `NOTE ${untracked.length} changed path(s) are not in the index (untracked or ignored) — run \`strata index\``);
    for (const p of untracked.slice(0, 5)) out.push(`  ${p}`);
  }
  if (data.head && head(root) && head(root) !== data.head) {
    out.push("", `NOTE index was built at ${data.head.slice(0, 7)}, HEAD is ${head(root).slice(0, 7)} — run \`strata index\` to refresh`);
  }
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
