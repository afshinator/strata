# T08 — Exit codes disagree with the README contract

**Priority:** P1
**Status:** open
**Reviews:** R1 S-F3, R1 P-F11, R1 P-F12 · R2 S-F2, R2 P-F13
**Files:** `src/commands/status.mjs:5-10`, `src/commands/blast.mjs:13-17`, `README.md:58`

## Symptom

`README.md` states: *"Exit codes: `0` ok, `2` usage/refused (not a git repo, missing index, held lock). `blast` never fails a build — it is a report."*

Three violations:

- `status` with no index exits 0.
- `status` outside a git repository exits 0.
- `blast` with no index exits 2, contradicting "never fails a build".

The result is a contract that cannot be relied on in CI: `status` cannot be used as a gate, and `blast` cannot be used as a non-failing reporter.

## Evidence

```

$ cd /tmp/v4              # git repo, never indexed
$ node bin/strata.mjs status >/dev/null; echo "status, git repo, no index -> $?"
status, git repo, no index -> 0
$ node bin/strata.mjs blast >/dev/null 2>&1; echo "blast, git repo, no index -> $?"
blast, git repo, no index -> 2

$ cd /tmp/v5              # not a git repo, no index
$ node bin/strata.mjs status >/dev/null; echo "status, not a repo -> $?"
status, not a repo -> 0
$ node bin/strata.mjs index >/dev/null 2>&1; echo "index, not a repo -> $?"
index, not a repo -> 2
```

`status.mjs:6-9` returns 0 in the `!data` branch and never calls `isRepo`.

## Root cause

`status.mjs` has no `isRepo` guard and treats "no index" as success. `blast.mjs:13-17` returns 2 on a missing index, which the README explicitly forbids for `blast`.

## Fix

Decide the contract once and apply it to all three commands. Recommended, matching the README's existing wording:

- `index`: exit 2 for not-a-repo, missing index is n/a, held lock 2. (Already correct.)
- `status`: exit 2 when not a git repo; exit 2 when the index is missing; 0 otherwise.
- `blast`: exit 0 with a one-line "no index — run `strata index`" notice, because it is a report and must not fail a build. Keep 2 only for usage errors (bad `--since`, bad `--depth`, T07).

```js
// status.mjs
export function status(root) {
  if (!isRepo(root)) {
    process.stderr.write("strata: not a git repository.\n");
    return 2;
  }
  const data = readIndex(root);
  if (!data) {
    process.stderr.write("strata: no index. Run `strata index` (0 tokens).\n");
    return 2;
  }
  ...
}
```

```js
// blast.mjs
if (!data) {
  process.stdout.write("strata: no index — run `strata index` (it costs nothing).\n");
  return 0;
}
```

Then update `README.md` so the exit-code table names which command each row applies to, and keep the `--json` empty-path behaviour consistent with T10.

## Verify

- `status` in a repo with no index → 2, message on stderr.
- `status` outside a repo → 2.
- `blast` with no index → 0, notice on stdout.
- `index` outside a repo → 2 (unchanged), held lock → 2 (unchanged).
- New tests asserting all five exit codes, since none exist today (T22).
