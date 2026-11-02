# T01 — No repo-root normalization

**Priority:** P0
**Status:** open
**Reviews:** R1 S-F2, R1 P-F12 (part) · R2 S-F6, R2 P-F12
**Files:** `bin/strata.mjs:34`, `src/lib/git.mjs:29-31`, `src/lib/git.mjs:63-77`, `src/commands/index.mjs:63`, `src/commands/blast.mjs:26-38`, `src/lib/store.mjs:4-8`

## Symptom

Every path the tool gets from git is interpreted relative to `$PWD`. `git ls-files` returns paths relative to `$PWD` when `-C <subdir>` is used, while `git log --name-only` and `git status --porcelain` return paths relative to the repo root. The mixed basis produces four distinct wrong answers when run from a subdirectory:

1. churn and owners are silently zero for every file;
2. `.strata/` is written inside the subdirectory instead of at the root;
3. `blast` from the subdirectory says "no changes" even when indexed files changed;
4. `blast` from the root after a subdirectory index says "no index", and vice versa.

## Evidence

```
$ git init /tmp/v1; cd /tmp/v1; git commit -am one     # 1 commit
$ node bin/strata.mjs index --quiet
$ (cd src && node bin/strata.mjs index --quiet)
$ node -e 'const d=require("/tmp/v1/src/.strata/index.json");
            for (const f of d.files) console.log(f.path, "churn="+f.churn, "owners="+f.owners.length)'
db.ts churn=0 owners=0
sub/a.ts churn=0 owners=0
top.ts churn=0 owners=0          # every file has 1 real commit
```

```
# 2. output location
$ ls -d /tmp/v1/.strata /tmp/v1/src/.strata
/tmp/v1/.strata
/tmp/v1/src/.strata              # clutter inside the subtree
```

```
# 3. subdirectory blast
$ printf 'export const db=2;\n' > src/db.ts
$ (cd src && node bin/strata.mjs blast; echo "exit=$?")
strata blast — no changes in the working tree.
exit=0
```

```
# 4. root blast when only a subdirectory index exists
$ (cd src && node bin/strata.mjs index --quiet)
$ node bin/strata.mjs blast; echo "exit=$?"
strata: no index. Run `strata index` first (it costs nothing).
exit=2
# and the reverse: root index exists, blast from src/
$ (cd src && node bin/strata.mjs blast; echo "exit=$?")
strata: no index. Run `strata index` first (it costs nothing).
exit=2
```

## Root cause

`bin/strata.mjs:34` sets `root = args.root ? args.root : process.cwd()`. No call to `git rev-parse --show-toplevel`. Consequently `listFiles` (`git.mjs:31`) yields cwd-relative paths, `history` (`git.mjs:63-77`) yields root-relative paths and never matches them, and `paths(root)` (`store.mjs:4-8`) anchors the data dir at the cwd.

## Fix

Resolve the repository top level once, in the CLI, and use it as the default root.

```js
// src/lib/git.mjs
export function toplevel(root) {
  const out = tryGit(root, ["rev-parse", "--show-toplevel"]);
  return out ? out.trim() : null;
}
```

```js
// bin/strata.mjs
const cwd = process.cwd();
const root = args.root ? args.root : (toplevel(cwd) || cwd);
```

An explicit `--root` still wins: indexing another checkout stays possible. When `cwd` is not a repo, `toplevel` returns null and the existing `isRepo` guard in `index` produces the exit-2 message.

This one change fixes all four symptoms because every git call now shares the toplevel basis. Do not attempt to rewrite paths after collection; the basis mismatch also affects `.strata` placement and cannot be patched downstream.

## Verify

- `cd src && strata index` → `.strata/index.json` appears at the toplevel, not in `src/`.
- Same index run → at least one file has `churn > 0` and non-empty `owners`.
- `printf x >> src/db.ts; cd src && strata blast` → reports 1 changed file, exit 0.
- `strata index` at root, `cd src && strata blast` → finds the index.
- New test: fixture indexed from a subdirectory asserts root `.strata`, non-zero churn, and a non-empty blast.
