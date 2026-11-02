# T12 — Commit count is one too high

**Priority:** P2
**Status:** open
**Reviews:** R1 P-F10 · R2 P-F11
**Files:** `src/lib/git.mjs:77-80`, `src/commands/index.mjs:124`, `src/commands/index.mjs:160`

## Symptom

A repo with one commit reports "2 commits". Every `MAP.md` carries "churn window 90d, N commits" and the `index` summary prints `churn N commits / 90d`, both one too high. Churn values themselves are per-file and unaffected.

## Evidence

```
$ git rev-list --count HEAD
1
$ node bin/strata.mjs index --quiet
$ node -e 'console.log(require(".strata/index.json").stats.commitsConsidered)'
2
```

Also observed on the strata repo's own `MAP.md`, generated at `4e85863` (2 commits): it reports 3.

## Root cause

`git.mjs:77` splits the `\u0001`-prefixed log on `\u0001`. The prefix guarantees an empty first chunk, and `commits++` at `:80` runs for it.

## Fix

```js
for (const chunk of raw.split("\u0001")) {
  if (!chunk) continue;
  ...
}
```

## Verify

- One-commit repo → `commitsConsidered` 1, `MAP.md` says 1 commit.
- Multi-commit repo → matches `git rev-list --count HEAD~0` for the same window.
- New test: assert `stats.commitsConsidered === 1` in the single-commit fixture.
