import { execFileSync } from "node:child_process";

const MAX = 64 * 1024 * 1024;

export function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: MAX,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function tryGit(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

export function isRepo(root) {
  return tryGit(root, ["rev-parse", "--git-dir"]) !== null;
}

/** Git resolves every path it prints from the worktree root, so we must too. */
export function toplevel(root) {
  const out = tryGit(root, ["rev-parse", "--show-toplevel"]);
  return out ? out.trim() : null;
}

export function head(root) {
  return (tryGit(root, ["rev-parse", "HEAD"]) || "").trim() || null;
}

export function listFiles(root) {
  // git ls-files is the .gitignore-aware walk; no reimplementation.
  return git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
}

export function dirtyPaths(root) {
  const out = tryGit(root, ["status", "--porcelain", "-z"]) || "";
  const out2 = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec || rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    let p = rec.slice(3);
    if (xy[0] === "R" || xy[0] === "C") {
      // rename: next record is the source path
      i++;
      p = parts[i] || p;
    }
    out2.push({ status: xy.trim() || "?", path: p });
  }
  return out2;
}

export function changedSince(root, rev) {
  const out = tryGit(root, ["diff", "--name-only", "-z", rev]) || "";
  return out.split("\0").filter(Boolean);
}

/**
 * One pass of git log gives churn (commits touching a file) and owners.
 * shortcut: paths are split on newlines, so a filename containing a newline is misread.
 * Upgrade to --numstat -z parsing if that ever matters.
 */
export function history(root, { days = 90, limit = 4000 } = {}) {
  const raw = tryGit(root, [
    "log",
    `--since=${days}.days`,
    "--no-merges",
    `-n${limit}`,
    "--pretty=format:\u0001%ae",
    "--name-only",
  ]);
  const churn = new Map();
  const owners = new Map();
  if (!raw) return { churn, owners, commits: 0 };

  let commits = 0;
  for (const chunk of raw.split("\u0001")) {
    if (!chunk) continue; // the pretty format prefixes every commit, so chunk 0 is empty
    const lines = chunk.split("\n");
    const email = (lines.shift() || "").trim();
    commits++;
    for (const p of lines) {
      const path = p.trim();
      if (!path) continue;
      churn.set(path, (churn.get(path) || 0) + 1);
      if (email) {
        let m = owners.get(path);
        if (!m) owners.set(path, (m = new Map()));
        m.set(email, (m.get(email) || 0) + 1);
      }
    }
  }
  return { churn, owners, commits };
}

export function topOwners(owners, path, n = 2) {
  const m = owners.get(path);
  if (!m) return [];
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
