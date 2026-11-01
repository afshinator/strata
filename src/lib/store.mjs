import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, openSync, closeSync } from "node:fs";
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

export function ensureDir(root) {
  mkdirSync(paths(root).dir, { recursive: true });
}

export function readIndex(root) {
  try {
    return JSON.parse(readFileSync(paths(root).index, "utf8"));
  } catch {
    return null;
  }
}

export function writeAtomic(file, content) {
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

/** Exclusive lock so two agents cannot interleave writes into one data dir. */
export function lock(root) {
  ensureDir(root);
  const file = paths(root).lock;
  try {
    const fd = openSync(file, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    return null;
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
}
