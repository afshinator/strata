import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, openSync, closeSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = ".strata";

export function paths(root) {
  const dir = join(root, DATA_DIR);
  return {
    dir,
    index: join(dir, "index.json"),
    map: join(dir, "MAP.md"),
    questions: join(dir, "QUESTIONS.md"),
    lock: join(dir, "lock"),
  };
}

function ensureDir(root) {
  const dir = paths(root).dir;
  mkdirSync(dir, { recursive: true });
  // A data dir that ignores itself keeps the analysed tree clean: the tool's own
  // output never shows up as a change, and never becomes a source.
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
}

// The artifact shape. Written by index, required by every reader: an index
// from a different format is not a partial answer, it is an unusable one.
export const FORMAT = 1;

export function readIndex(root) {
  try {
    const data = JSON.parse(readFileSync(paths(root).index, "utf8"));
    return data?.version === FORMAT ? data : null;
  } catch {
    return null;
  }
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

export function writeIndex(root, data) {
  ensureDir(root);
  writeAtomic(paths(root).index, JSON.stringify(data, null, 1));
}

export function writeText(root, file, content) {
  ensureDir(root);
  writeAtomic(file, content);
}

/**
 * Exclusive lock so two agents cannot interleave writes into one data dir.
 * shortcut: liveness is proved by pid only, so a reused pid keeps a stale lock
 * alive. Store a timestamp beside the pid and expire on age if that ever bites.
 */
export function lock(root) {
  ensureDir(root);
  const file = paths(root).lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      try {
        writeFileSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return {
        release() {
          try {
            unlinkSync(file);
          } catch {
            /* already gone */
          }
        },
      };
    } catch (err) {
      if (err.code !== "EEXIST") {
        try {
          unlinkSync(file);
        } catch {
          /* nothing of ours to clean up */
        }
        return null;
      }
      let holder = NaN;
      try {
        holder = Number(String(readFileSync(file, "utf8")).trim());
      } catch {
        /* vanished or unreadable: not evidence of a live holder */
      }
      if (Number.isInteger(holder) && holder > 0 && isAlive(holder)) return null;
      try {
        unlinkSync(file);
      } catch (e) {
        if (e.code === "ENOENT") continue; // the holder released itself; retry the open
        return null;
      }
    }
  }
  return null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists, owned by another user
  }
}
