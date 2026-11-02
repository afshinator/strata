import { existsSync, statSync } from "node:fs";
import { readIndex, paths } from "../lib/store.mjs";
import { changedSince, dirtyPaths, head, tryGit, isRepo } from "../lib/git.mjs";

export function status(root) {
  if (!isRepo(root)) {
    process.stderr.write("strata: not a git repository.\n");
    return 2;
  }
  const data = readIndex(root);
  if (!data) {
    process.stderr.write("strata: no index. Run `strata index` (0 tokens).\n");
    return 2;
  }
  const now = head(root);
  const dirty = dirtyPaths(root);
  const behind = data.head && now ? (tryGit(root, ["rev-list", "--count", `${data.head}..HEAD`]) || "0").trim() : "?";
  const changed = data.head && now && data.head !== now ? changedSince(root, `${data.head}..HEAD`) : [];
  const indexed = new Set(data.files.map((f) => f.path));
  const pending = changed.filter((p) => indexed.has(p));

  const out = [];
  // The artifact carries no timestamp, so report when the file was written instead.
  const built = statSync(paths(root).index).mtime.toISOString();
  out.push(`index    ${built} · ${data.files.length} files · ${data.edges.length} edges · tier ${data.tier}`);
  out.push(`head     ${data.head ? data.head.slice(0, 7) : "none"} → ${now ? now.slice(0, 7) : "none"}${behind !== "?" ? ` (${behind} commits behind)` : ""}`);
  out.push(`working  ${dirty.length} dirty path(s)`);
  out.push(`pending  ${pending.length} indexed file(s) changed since the index was built (0 tokens to refresh)`);
  out.push(`docs     ${existsSync(paths(root).map) ? "MAP.md present" : "MAP.md missing — rerun index"}`);
  if (data.tier === "regex") out.push(`tier     import edges are regex-derived; expect misses on dynamic imports and path aliases`);
  if (!pending.length && !dirty.length) out.push(``, `up to date`);
  else out.push(``, `next     strata index${dirty.length ? "   (rebuilds from the working tree as committed state only)" : ""}   ·   strata blast`);
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
