# T02 — `blast` reports "no changes" when the only change is a new file

**Priority:** P0
**Status:** open
**Reviews:** R2 P-F5
**Files:** `src/commands/blast.mjs:33-43`

## Symptom

A brand-new untracked source file is the most common change there is. When it is the only change, `blast` prints "no changes in the working tree" and exits 0. The untracked NOTE that exists for mixed changes never prints, because the early return fires first. `skill/SKILL.md` promises "`blast` with no `--since` uses the working tree (dirty + untracked)" and rule 4 says to report what was not analysed.

## Evidence

```
$ git init /tmp/v2; ...; node bin/strata.mjs index --quiet
$ printf 'export const brandNew=1;\n' > src/brandNew.ts
$ git status --porcelain
?? .strata/
?? src/brandNew.ts
$ node bin/strata.mjs blast; echo "exit=$?"
strata blast — no changes in the working tree.
exit=0
```

The path is collected and then discarded:

```
$ node bin/strata.mjs blast --json
strata blast — no changes in the working tree.     # prose, not JSON (see T10)
```

## Root cause

`blast.mjs:34-39` partitions changed paths into "known to the index" and `untracked`, keeping only the first group in `changed`. `blast.mjs:40-43` then returns as soon as `changed` is empty, without inspecting `untracked`. The NOTE block at `blast.mjs:115-117` is unreachable for an untracked-only change.

## Fix

Gate the early return on both lists, and emit a short report for the untracked-only case instead of a table over zero seeds.

```js
if (!changed.length && !untracked.length) {
  if (args.json) process.stdout.write(JSON.stringify({ basis, head: data.head, currentHead: head(root), changed: [], affected: { direct: [], all: [] }, tests: [], owners: [], seeds: [], untracked: [] }, null, 2) + "\n");
  else process.stdout.write(`strata blast — no changes in the ${basis}.\n`);
  return 0;
}
if (!changed.length) {
  // untracked-only: real changes, none of them in the index
  ...print "N path(s) changed but not indexed — run `strata index`" + list, or JSON...
  return 0;
}
```

Keep the existing filter into `untracked`. With `--since`, untracked paths are not promised by SKILL, so no change is needed on that path.

## Verify

- Untracked-only change → non-zero report naming the file and telling the user to index, exit 0.
- Untracked-only change with `--json` → parseable, `untracked` populated, `changed: []`.
- Mixed tracked + untracked → unchanged behaviour, both sections present.
- New test: create a file, never `git add`, run `blast`, assert the filename appears in stdout.
