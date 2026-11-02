# T14 — `blast` never reports the edge tier

**Priority:** P2
**Status:** open
**Reviews:** R1 S-F8 (R2 missed)
**Files:** `src/commands/blast.mjs:62-88` (JSON), `src/commands/blast.mjs:96-121` (text)

## Symptom

`README.md` design rule 3: "Every edge carries a tier. … the report says so instead of implying precision it does not have." `MAP.md` and `index` both name `tier: regex`. `blast` — the command an agent runs before reading a diff — says nothing, while `skill/SKILL.md` rule 2 instructs the reader to "read the tier before trusting an edge". The one consumer that needs the caveat cannot get it from the output.

## Evidence

```
$ node bin/strata.mjs blast | grep -ci "regex\|tier"; echo "(0 = no mention)"
0
$ node bin/strata.mjs blast --json | node -e '...Object.keys(j)'
[ 'basis', 'head', 'currentHead', 'changed', 'affected', 'tests', 'owners', 'seeds', 'untracked' ]
```

`index.json` does carry `tier: "regex"`, so the data exists; only the report omits it.

## Root cause

`blast.mjs` reads `data` but never prints `data.tier` or `data.edges[].tier` in either branch.

## Fix

Add the index tier to both outputs, next to the basis line.

```js
// JSON
tier: data.tier,
```
```js
// text, first line
out.push(`strata blast — ${changed.length} changed file(s), ${basis} · tier ${data.tier}`);
```

Do not claim per-edge tiers in `blast` output; the closure is file-level and the index is uniform today. One `tier` field is honest and sufficient until the tree-sitter tier lands.

## Verify

- `blast` text output contains `tier regex`.
- `blast --json` has `tier: "regex"`.
- `--sketch` output carries the same label.
- New test asserting the field exists in JSON.
