# T03 — Stale lock bricks indexing; lock leaks when the pid write fails

**Priority:** P0
**Status:** open
**Reviews:** R1 S-F4, R1 P-F17 · R2 S-F9
**Files:** `src/lib/store.mjs:46-65`, `src/commands/index.mjs:53-58`, `test/index.test.mjs:87-99`

## Symptom

The lock file records a pid that is never checked. Any lock left behind — a `SIGKILL`ed run, a crashed container, a full disk mid-write — makes every later `strata index` exit 2 until a human deletes the file by hand. The only recovery path is undocumented. Separately, if `writeFileSync(fd)` throws after `openSync(file,"wx")` succeeded, the catch returns `null` and the newly created lock file is never removed, so the very first failure strands the lock.

## Evidence

Stale pid, process long gone:

```
$ printf '999999' > .strata/lock
$ node bin/strata.mjs index; echo "exit=$?"
strata: another run holds /tmp/w1/.strata/lock; refusing to interleave writes.
exit=2
$ test -f .strata/lock && echo "lock survives"
lock survives
```

Leak on write failure, fault-injected with `syncBuiltinESMExports()` so only the fd write throws:

```
lock() returned: null (failure)
lock file left on disk: true
second lock() attempt: refused (bricked)
```

The pid is written (`cat .strata/lock` → e.g. `8618`) but nothing ever reads it.

## Root cause

`store.mjs:47-55`: one `try` covers both `openSync` and `writeFileSync`. Any throw returns `null` without unlinking the file it just created. The `catch` also treats `EEXIST` and every other error identically, so a stale lock is indistinguishable from a live one.

## Fix

Separate the two failure modes, close the fd in `finally`, and add a liveness check on `EEXIST`.

```js
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

export function lock(root) {
  ensureDir(root);
  const file = paths(root).lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      try { writeFileSync(fd, String(process.pid)); } finally { closeSync(fd); }
      return { release() { try { unlinkSync(file); } catch { /* already gone */ } } };
    } catch (err) {
      if (err.code !== "EEXIST") { try { unlinkSync(file); } catch {} return null; }
      const holder = Number(readFileSync(file, "utf8").trim());
      if (Number.isInteger(holder) && holder > 0 && isAlive(holder)) return null;
      try { unlinkSync(file); } catch { return null; }  // stale: reclaim and retry
    }
  }
  return null;
}
```

`EPERM` means the process exists but belongs to another user, so it counts as alive. The unlink-then-retry has a small race window; acceptable for a single-machine developer tool, record it as a `shortcut:` comment.

## Verify

- `printf 999999 > .strata/lock; strata index` → succeeds, lock released, exit 0.
- Concurrent live run → still exit 2 with the "another run holds" message.
- Fault-injected fd write failure → no lock file left behind.
- `test/index.test.mjs:87` currently asserts the brick is correct behaviour (`.strata/lock` with `999999` must block). **Invert that test** — it is the reason this bug looks intentional.
- New test: write a stale pid, assert `index` succeeds; hold the lock with the current pid, assert it refuses.
