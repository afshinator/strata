# T19 — Three-way contradiction over `--root`

**Priority:** P2
**Status:** open
**Reviews:** R1 S-F10, R1 P-F6
**Files:** `README.md:26`, `README.md:43`, `skill/SKILL.md:27`, `bin/strata.mjs:34`

## Symptom

Three documents disagree about a flag that exists and works:

- `README.md:26` rule 6: "**Worktree-safe.** Reads `$PWD`, never redirects the source root".
- `README.md:43` *Use*: `strata index --root ~/code/other-repo`.
- `skill/SKILL.md:27`: "Never pass `--root` pointing at another worktree: index the tree you are actually editing."

An agent reading SKILL is told the flag is forbidden; a human reading README is told to use it. R1 filed this as scope creep against design rule D6; that framing is wrong — `--root` reads a tree, it never rewrites one, so worktree safety is intact. The defect is the documentation.

## Evidence

```
$ grep -n "root" README.md | head -3
26:6. **Worktree-safe.** Reads `$PWD`, never redirects the source root, takes an exclusive lock on the data dir.
43:strata index --root ~/code/other-repo
$ grep -n "Never pass" skill/SKILL.md
27:- Default `strata index` target is `$PWD`. Never pass `--root` pointing at another worktree: index the tree you are actually editing.
```

## Root cause

Rule 6 was written against UA's `PROJECT_ROOT="$MAIN_ROOT"` behaviour, which rewrites where the tool looks for *source files mid-run*. `--root` is a one-shot explicit target and does not mutate anything. The rule and the flag are compatible; the wording is not.

## Fix

Keep the flag. Make rule 6 describe the actual invariant: nothing the tool does changes what the repo considers its source root.

`README.md:26` →

> 6. **Worktree-safe.** Never rewrites the analysed tree: no `chdir`, no redirect of the source root, no config mutation. `--root` selects a tree explicitly for one run and is the only way to index a tree other than `$PWD`. Takes an exclusive lock on the data dir.

`skill/SKILL.md:27` →

> - Default `strata index` target is `$PWD`. `--root` exists for indexing another checkout deliberately (CI, pre-review); it is not a workaround for editing the wrong worktree. If you are editing a tree, index that tree.

## Verify

- All three statements agree that `--root` is supported and that no command rewrites the analysed tree.
- `strata index --root <other>` still works and writes `<other>/.strata`.
- No doc claims `--root` is forbidden.
