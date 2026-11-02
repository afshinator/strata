# T10 — `blast --json` prints prose, not JSON, when there is nothing to report

**Priority:** P1
**Status:** open
**Reviews:** new (found while reproducing R2 P-F5; neither review reported it)
**Files:** `src/commands/blast.mjs:40-43` vs `src/commands/blast.mjs:62-88`

## Symptom

`skill/SKILL.md` says "`blast --json` when feeding another skill". The empty-change path writes a human sentence and returns before the `args.json` branch is ever reached, so a consumer that parses stdout gets a syntax error instead of a document. This is the exact path an agent hits on a clean tree or after a mistyped flag (T07), which is when a machine caller is most likely to be parked.

## Evidence

```
$ node bin/strata.mjs blast --json; echo "exit=$?"
strata blast — no changes in the working tree.
exit=0
```

Pipe it into a parser:

```
$ node bin/strata.mjs blast --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s))'
SyntaxError: Unexpected token 's', "strata bla"... is not valid JSON
```

## Root cause

`blast.mjs:40-43` runs the plain-text write unconditionally and returns before the `if (args.json)` block at `:62`. Every other exit path is JSON-aware.

## Fix

Route the empty case through the same shape as the populated case. Land this together with T02, which rewrites the same block.

```js
if (!changed.length && !untracked.length) {
  if (args.json) {
    process.stdout.write(JSON.stringify({
      basis, head: data.head, currentHead: head(root),
      changed: [], affected: { direct: [], all: [] },
      tests: [], owners: [], seeds: [], untracked: [],
    }, null, 2) + "\n");
  } else {
    process.stdout.write(`strata blast — no changes in the ${basis}.\n`);
  }
  return 0;
}
```

Keep the key set and ordering identical to the populated branch so consumers need one schema, not two.

## Verify

- `blast --json` on a clean tree → `JSON.parse` succeeds, `changed: []`, `untracked: []`.
- `blast --json` with only untracked files → parseable, `untracked` populated (T02).
- `blast --json` with changes → unchanged.
- New test: parse `--json` output on a clean fixture.
