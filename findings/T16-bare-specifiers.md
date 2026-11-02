# T16 — SKILL says bare specifiers appear in QUESTIONS.md; they do not

**Priority:** P2
**Status:** open
**Reviews:** R1 P-F15 (R2 missed)
**Files:** `src/lib/imports.mjs:212-213`, `skill/SKILL.md:23`, `src/commands/index.mjs:155-159`

## Symptom

`skill/SKILL.md` rule 2 tells the agent: "bare specifiers are intentionally unresolved (see `QUESTIONS.md`)". In practice bare specifiers are counted in an external bucket whose label claims "tsconfig paths not modelled in v0.1", `unresolved` stays empty, and `QUESTIONS.md` contains only its two header lines. An agent following the skill reads an empty file and concludes nothing was skipped, when every third-party import was skipped. The label is also wrong for a plain npm dependency, which has nothing to do with tsconfig paths.

## Evidence

```
$ printf 'import lodash from "lodash";\n' > src/a.ts
$ node bin/strata.mjs index --quiet
$ node -e 'const d=require(".strata/index.json");
            console.log("unresolved:", d.unresolved.length, "external:", JSON.stringify(d.stats.external))'
unresolved: 0 external: {"external dependency (tsconfig paths not modelled in v0.1)":1}
$ wc -l .strata/QUESTIONS.md
       3            # title + subtitle + blank
```

## Root cause

`imports.mjs:212-213` routes every unknown bare specifier to the `external` map, which is display-only: `index.mjs:155-159` prints its total under "Numbers", while `QUESTIONS.md` is rendered from `unresolved` alone (`:211-215`, `:222-236`). The bucket label is a single string that conflates two different causes.

## Fix

Do not move third-party imports into `unresolved` — they are legitimately external and would flood the file. Instead, make the docs and the label match reality.

```js
// imports.mjs:213
return { external: "not in this repo (third-party, workspace, or unmodelled alias)" };
```

`skill/SKILL.md:23`:

> `regex` means relative/computed imports can be missed; specifiers that do not resolve inside the repo are counted as *external* and totalled in `MAP.md` under "Numbers", not listed in `QUESTIONS.md`.

Optionally split the bucket while here, so the honest distinction survives:

- `node builtin` (already separate)
- `third-party dependency`
- `workspace package not found`
- `alias not modelled (tsconfig paths)`

## Verify

- `MAP.md` external total matches the count of non-repo specifiers.
- `QUESTIONS.md` still lists only genuine in-repo resolution failures (e.g. a bad relative path).
- SKILL text no longer points at `QUESTIONS.md` for bare specifiers.
- New test: bare specifier increments `stats.external`, leaves `unresolved` empty.
