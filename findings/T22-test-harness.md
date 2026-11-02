# T22 — No regression tests for any of the above; one test locks in a bug

**Priority:** P3
**Status:** open
**Reviews:** R1 S-F16
**Files:** `test/index.test.mjs`

## Symptom

`npm test` is 7/7 green while nearly every P0/P1 ticket in this directory is live. The suite covers the happy path (index, blast closure, JSON shape, workspace resolution, risk thresholds) and nothing about the failure modes both reviews reproduced. Worse, one existing test encodes a bug as expected behaviour, which is why T03 looks intentional.

## Evidence

What is not covered, checked against `test/index.test.mjs`:

| Untested behaviour | Ticket |
|---|---|
| exit codes for `index` / `blast` / `status` | T08 |
| running from a subdirectory | T01 |
| untracked-only change | T02 |
| stale lock recovery and lock release on failure | T03 |
| imports inside comments, side-effect imports | T04, T17 |
| reading order on a chain | T05 |
| workspace `main` that does not resolve | T06 |
| bad `--since`, bad `--depth` | T07 |
| writes confined to `.strata/`, and `.strata` not appearing in `git status` | T09 |
| `--json` on the empty path | T10 |
| duplicate imports | T11 |
| commit count | T12 |
| byte-identical re-index | T13 |
| `tier` present in `blast` output | T14 |

Existing test that must change:

```js
test("a second concurrent run refuses rather than interleaving writes", () => {
  ...
  writeFileSync(join(root, ".strata/lock"), "999999");
  try { run(root, ["index"]); assert.fail("expected the lock to block the run"); }
  catch (err) { assert.match(String(err.stderr), /holding|holds|refusing/); }
});
```

`999999` is not a live process. This asserts that a dead pid blocks forever — the T03 defect.

## Root cause

The suite was written to prove the happy path worked, not to pin the contract. Fixtures are built inline per test with no shared helper, so adding a subdirectory case or an exit-code assertion costs more than it looks, and the lock test was written against observed behaviour rather than the documented intent.

## Fix

Add a shared fixture helper and one test per ticket above. Keep the style already in the file: real temp git repos, no mocks, `node:test`.

```js
function index(root) { run(root, ["index"]); return JSON.parse(readFileSync(join(root, ".strata/index.json"), "utf8")); }
function exitOf(cwd, args) {
  try { execFileSync(process.execPath, [BIN, ...args, "--root", cwd], { cwd, encoding: "utf8", stdio: ["ignore","pipe","pipe"] }); return 0; }
  catch (err) { return err.status; }
}
```

Then split the lock test into two: live pid → refuses (keep), dead pid → reclaims (invert). Each ticket above names its own assertion; land the test with the fix, not after.

## Verify

- `npm test` covers every row of the table.
- Deliberately re-introducing any T01–T14 defect fails at least one test.
- The suite stays offline and under a few seconds.
