# T13 — `index.json` is never byte-identical between runs

**Priority:** P2
**Status:** open
**Reviews:** R1 S-F12 (R2 missed)
**Files:** `src/commands/index.mjs:83-84`, `src/commands/index.mjs:147`, `README.md:36`

## Symptom

`README.md` calls the index deterministic and invites users to commit `.strata/` "to skip the (free) index". Two consecutive `index` runs on an unchanged tree produce different bytes, so a committed index conflicts on every refresh and every run shows as a diff. The data is identical; only the envelope differs.

## Evidence

```
$ node bin/strata.mjs index --quiet && cp .strata/index.json /tmp/i1.json
$ node bin/strata.mjs index --quiet
$ node -e 'const a=require("/tmp/i1.json"), b=require("/tmp/w1/.strata/index.json");
            console.log("root:", JSON.stringify(a.root));
            console.log("generatedAt:", a.generatedAt, "vs", b.generatedAt, "differ:", a.generatedAt!==b.generatedAt);
            console.log("body identical:", JSON.stringify({...a,generatedAt:0})===JSON.stringify({...b,generatedAt:0}))'
root: "/private/tmp/w1"
generatedAt: 2026-11-02T19:38:40.312Z vs 2026-11-02T19:38:40.394Z differ: true
body identical: true
```

Note `root` is the absolute path as resolved by the OS, so it also differs between worktrees and between `/tmp` and `/private/tmp` spellings of the same tree.

## Root cause

`index.mjs:83-84` stores the absolute `root` and a wall-clock `generatedAt` in the machine artifact. `:147` embeds `generatedAt` in `MAP.md` as well.

## Fix

Keep timestamps out of the committed artifact and make the root identity portable.

- `index.json`: replace `root` with `rootName: posix.basename(root)` (used only for the MAP title) and drop `generatedAt`.
- `MAP.md`: keep a generated-at line, passed into `renderMap` as a parameter instead of read from `data`. Prose can carry a timestamp; the machine artifact cannot if it is meant to be committed.
- If a timestamp is genuinely wanted in `index.json`, gate it behind `--stamp` and document that it breaks byte-determinism.

## Verify

- Two consecutive `index` runs → `cmp` on `index.json` reports no difference.
- `index.json` contains no absolute path and no timestamp.
- `MAP.md` still names the repo and still carries a generated-at line.
- New test: index twice, assert the serialized index is identical.
