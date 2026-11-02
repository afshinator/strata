# T07 — Bad `--since` and `--depth` silently produce "no changes"

**Priority:** P1
**Status:** open
**Reviews:** R1 S-F15, R1 P-F13 · R2 S-F7, R2 S-F8, R2 P-F7, R2 P-F8
**Files:** `src/commands/blast.mjs:21`, `src/commands/blast.mjs:30-33`, `src/lib/git.mjs:13-19`, `src/lib/git.mjs:53-56`

## Symptom

A mistyped revision and a mistyped depth both degrade to "nothing to report" with exit 0. A typo is indistinguishable from a clean tree, so a CI job or an agent reading the output concludes there is no blast radius. `README.md` says exit 2 covers usage errors; neither case produces one.

## Evidence

```
$ node bin/strata.mjs blast --since NOPE-REV; echo "exit=$?"
strata blast — no changes in the since NOPE-REV.
exit=0
```

```
$ printf 'export const db=3;\n' > src/db.ts    # 3 changed files in the tree
$ node bin/strata.mjs blast --depth 1 --json | jq .affected
{ "direct": ["src/mid.ts"], "all": ["src/mid.ts"] }
$ node bin/strata.mjs blast --depth abc --json | jq .affected
{ "direct": [], "all": [] }                    # exit 0, silently zero
$ node bin/strata.mjs blast --depth -1 --json  | jq .affected
{ "direct": [], "all": [] }
$ node bin/strata.mjs blast --depth abc | head -2
strata blast — 3 changed file(s), working tree
direct importers     0                         # contradicts the 3 changed files
```

## Root cause

- `git.mjs:17-19`: `tryGit` swallows every failure and `changedSince` (`:54`) turns `null` into `""`, so a bad rev is indistinguishable from no diff.
- `blast.mjs:21`: `const depth = Number(args.depth || 1)`. `Number("abc")` is `NaN`; the loop `for (let d = 0; d < NaN; d++)` never runs, so `reverseClosure` returns empty. `-1` and `0` behave the same way.

## Fix

Validate both inputs at the boundary in `blast` and fail loudly.

```js
const depth = args.depth === undefined ? 1 : Number(args.depth);
if (!Number.isInteger(depth) || depth < 1) {
  process.stderr.write(`strata: --depth must be a positive integer, got '${args.depth}'\n`);
  return 2;
}
```

```js
if (args.since) {
  if (tryGit(root, ["rev-parse", "--verify", "--quiet", `${args.since}^{commit}`]) === null) {
    process.stderr.write(`strata: unknown revision '${args.since}'\n`);
    return 2;
  }
  changed = changedSince(root, args.since);
}
```

Leave `changedSince` returning `""` for the legitimately-empty case; the rev is now verified before the call.

## Verify

- `--since NOPE-REV` → stderr message, exit 2, no "no changes" line.
- `--since HEAD~1` on a clean tree → still "no changes", exit 0.
- `--depth 0`, `--depth -1`, `--depth abc` → stderr, exit 2.
- `--depth 2` on a three-hop chain → transitive closure populated.
- New tests for both validators.
