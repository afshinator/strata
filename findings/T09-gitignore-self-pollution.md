# T09 — `.strata/` is not gitignored; tool output pollutes the repo and the index

**Priority:** P1
**Status:** open
**Reviews:** R1 S-F1 · R2 S-F4, R2 P-F6
**Files:** `src/lib/store.mjs:17-20`, `src/commands/index.mjs:63`, `src/lib/git.mjs:29-31`, `README.md:38`

## Symptom

`README.md` *What it writes* says `.strata/` "is gitignored by default". The tool never writes a `.gitignore`. Consequences, all measured:

1. `git status` shows `?? .strata/` after every index.
2. That untracked dir counts as a dirty file in `index.json`'s `dirtyFiles` and in `MAP.md`'s "N dirty files" header, so the tool reports itself as a change.
3. `blast` lists `.strata/` among unindexed changed paths.
4. A routine `git add -A` commits the tool's own output, after which the next index treats `.strata/index.json`, `.strata/MAP.md` and `.strata/QUESTIONS.md` as source files and pulls them into the graph and reading order. There is no path that clears this.

## Evidence

```
$ node bin/strata.mjs index --quiet
$ test -f .strata/.gitignore && echo yes || echo NO
NO
$ git status --porcelain
?? .strata/
$ node -e 'console.log(require(".strata/index.json").dirtyFiles)'
1
```

After a routine `git add -A && git commit`:

```
$ node bin/strata.mjs index --quiet
$ node -e 'console.log(require(".strata/index.json").files.map(f=>f.path))'
[ '.strata/MAP.md', '.strata/QUESTIONS.md', '.strata/index.json', 'a.txt', 'package.json', 'src/a.ts' ]
```

`MAP.md` then lists its own markdown under reading order.

## Root cause

`store.mjs:17-20` (`ensureDir`) creates `<root>/.strata` and nothing else. `listFiles` (`git.mjs:31`) has no exclusion for the data dir, so anything committed there is scanned. `index.mjs:63` counts every porcelain line, including the untracked data dir, as a dirty file.

Note: the strata repo's own `.gitignore` contains `.strata/`, which hides the defect during dogfooding.

## Fix

Make the data dir self-ignoring and defensively exclude it from the walk.

```js
export function ensureDir(root) {
  const dir = paths(root).dir;
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
}
```

```js
// git.mjs listFiles
return git(root, ["ls-files", "-z"]).split("\0").filter((p) => p && !p.startsWith(DATA_DIR + "/"));
```

`*` inside `.strata/.gitignore` covers the directory and its `.gitignore`, so git reports nothing. Do not append to the repo's root `.gitignore`: that modifies a tracked file the user owns.

Also make `dirty` in `index.mjs:63` ignore the data dir, so a first-ever run on a dirty tree reports only real files.

## Verify

- `index` then `git status --porcelain` → empty.
- `dirtyFiles` after a first index of a clean tree → 0.
- Manually commit `.strata/` (already possible for old repos), re-index → `.strata/*` absent from `files`, `readingOrder`, and `edges`.
- `blast` no longer lists `.strata/` as unindexed.
- Remove `.strata/` from this repo's own `.gitignore` once the tool writes its own, so dogfooding tests the real path.
