# T21 — Duplicated git work, sentinel from-path, dead language surface

**Priority:** P3
**Status:** open
**Reviews:** R1 S-F11, R1 S-F13, R1 S-F14 · R2 S-F11, R2 S-F12, R2 S-F13, R2 S-F14
**Files:** listed per item

## Symptom

Judgement-level smells. None change output; all make the next bug harder to see. Grouped into one ticket because each item is a few lines.

## Evidence

**C1 — `head(root)` called three times per `blast` run.** `blast.mjs:68`, `:119`, `:120`. Three `git rev-parse` subprocesses for one immutable value. Compute once at the top of `blast` and reuse.

```
$ grep -n "head(root)" src/commands/blast.mjs
68:          currentHead: head(root),
119:  if (data.head && head(root) && head(root) !== data.head) {
120:    out.push(... `HEAD is ${head(root).slice(0, 7)}` ...
```

**C2 — porcelain parsed twice.** `index.mjs:63` runs `git status --porcelain` and counts lines; `git.mjs:34-51` (`dirtyPaths`) runs the same command and parses it properly. Index should call `dirtyPaths(root).length`.

**C3 — group-by-reason built twice in one file.** `index.mjs:211-216` (renderMap) and `index.mjs:223-233` (renderQuestions) both build a `Map<reason, items[]>` from `data.unresolved`. Extract one helper.

**C4 — sentinel from-path.** `imports.mjs:215` calls `tryJsCandidates(posix.join(base, "x"), "." + "/" + posix.basename(base), fileSet)` — a fake file path invented only to satisfy a signature. Resolved by T06's `resolveFile` extraction; pointer kept here so the item is not lost if T06 is deferred.

**C5 — parallel switch statements.** `imports.mjs:112-135` (`extractImports`) and `:248-259` (`resolveImports`) each dispatch on `f.lang` independently, so adding a language means editing two switches that must stay in sync. Fold into one table: `{ extract, resolve }` per language.

**C6 — misleading names.** `index.mjs:127` labels extractor coverage `exports` in the summary (`exports  N files have no import extractor`); the name means something else entirely in a graph tool. `graph.mjs:63` puts non-orderable files in a set named `inCycle` and stores it as `cycles`, though the set also includes files merely blocked by a cycle. Rename to `noExtractor` and `unorderable`.

**C7 — speculative language surface.** `lang.mjs:1-13` maps `rust, java, kotlin, scala, ruby, php, csharp, swift` but `IMPORT_LANGS` (`lang.mjs:14`) has no extractor for any of them, so those files are counted and never graphed. `lang.mjs:41-53` (`testCandidates`) emits `${stem}_test.rb`, a convention for a language with no edges. Keep the file-type map (it drives `noExtractor` counts) but drop the ruby candidate, and add a comment naming that map as taxonomy-only.

## Root cause

Each item is a local shortcut taken while scaffolding: a value re-fetched instead of held (C1), the same git command parsed twice (C2), a helper not extracted on first use (C3, C4), two dispatch tables that must stay in sync (C5), names inherited from the wrong layer (C6), and a taxonomy expanded ahead of its extractors (C7).

## Fix

Apply C1–C3, C5–C7 directly. C4 falls out of T06. No behaviour change is intended in any item; if output changes, it is a bug in the change.

## Verify

- `blast` spawns one `rev-parse` for HEAD (assert via a wrapped `git` or by inspection).
- `index` calls `git status --porcelain` once.
- One group-by-reason helper, used twice.
- Renames appear in operator output and in `MAP.md`.
- `npm test` unchanged.
