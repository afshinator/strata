# T15 — `--data-dir` is documented but inert; `--sketch` is undocumented

**Priority:** P2
**Status:** open
**Reviews:** R1 S-F9, R1 P-F7 · R2 S-F3, R2 P-F9
**Files:** `bin/strata.mjs:8-14`, `src/lib/store.mjs:4-8`

## Symptom

USAGE advertises `--data-dir` and nothing reads it: `parseArgs` stores `args["data-dir"]`, and `store.mjs` hardcodes `DATA_DIR = ".strata"`. A user who passes it silently gets the default path. Meanwhile `--sketch`, which is implemented and documented in `README.md` *Use*, is missing from USAGE, so the only in-terminal help omits a working feature.

## Evidence

```
$ node bin/strata.mjs index --data-dir /tmp/v3/CUSTOM --quiet
$ test -d /tmp/v3/CUSTOM && echo yes || echo NO
NO
$ grep -n "data-dir\|sketch" bin/strata.mjs
14:  --data-dir     default <root>/.strata
$ node bin/strata.mjs blast --sketch      # works, but is not in USAGE
```

## Root cause

`bin/strata.mjs:14` is documentation only; `store.mjs:4` is a constant. `bin/strata.mjs:8-9` lists blast flags without `--sketch`.

## Fix

Smallest complete change: delete the flag that does not exist, document the one that does.

```js
  strata blast [--since <rev>] [--depth N] [--json] [--sketch]
                                            what depends on what changed (0 tokens)
  ...
  --root <dir>   analyze another directory
```

Delete the `--data-dir` line. Do not implement it: `$PWD`-anchored `<root>/.strata` is a design rule (`README.md:26`), and a configurable data dir is exactly the worktree footgun the skill warns about.

If a caller genuinely needs a different location, the supported answer is `--root`, which moves the analysed tree and the data dir together.

## Verify

- `strata --help` lists `--sketch` and does not mention `--data-dir`.
- `strata index --data-dir /tmp/x` is rejected as an unknown flag (or documented as such), not silently ignored.
- README *Use* and USAGE list the same blast flags.
