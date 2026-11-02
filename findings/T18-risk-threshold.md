# T18 — Undocumented `fanIn>=10 && churn>=10` → HIGH rule

**Priority:** P2
**Status:** open
**Reviews:** R1 S-F7, R1 P-F16 · R2 S-F5, R2 P-F10
**Files:** `src/commands/blast.mjs:5-11`, `test/index.test.mjs:104`, `skill/SKILL.md` (Output shape)

## Symptom

`skill/SKILL.md` defines risk as "`HIGH` at fan-in ≥ 20 or churn ≥ 30, `MEDIUM` at fan-in ≥ 5 or churn ≥ 10". The code adds a third HIGH clause. A file with fan-in 10 and churn 10 prints HIGH while the skill says MEDIUM, so an agent that trusts the documented table mislabels risk in both directions (here, over-warns). The extra rule is codified by a test, so it is deliberate — it is simply undocumented.

## Evidence

```
$ node -e 'import("./src/commands/blast.mjs").then(({riskOf})=>{
    console.log("fanIn10/churn10 ->", riskOf({fanIn:10,churn:10}));
    console.log("fanIn10/churn9  ->", riskOf({fanIn:10,churn:9}));
    console.log("fanIn11/churn11 ->", riskOf({fanIn:11,churn:11}));
  })'
fanIn10/churn10 -> HIGH
fanIn10/churn9  -> MEDIUM
fanIn11/churn11 -> HIGH
```

`test/index.test.mjs:104` asserts `riskOf({ fanIn: 10, churn: 10 }) === "HIGH"`.

## Root cause

`blast.mjs:8`: `if (fanIn >= 20 || churn >= 30 || (fanIn >= 10 && churn >= 10)) return "HIGH";`. The SKILL table was written before the clause or never updated.

## Fix

Document the rule; it is defensible (10 importers *and* 10 commits in 90 days is a real hotspot, and the product of the two signals is the MAP hotspot score anyway).

`skill/SKILL.md`, Output shape:

> `strata blast` prints changed files, direct importers, tests, owners, and a per-file risk line: `HIGH` at fan-in ≥ 20, churn ≥ 30, or (fan-in ≥ 10 and churn ≥ 10); `MEDIUM` at fan-in ≥ 5 or churn ≥ 10; otherwise `LOW`.

Also name the thresholds in `MAP.md`'s hotspots section so the number has a definition where it is read.

If the extra clause is not wanted, delete it and drop the assertion at `test/index.test.mjs:104` instead. Do not leave code and doc disagreeing.

## Verify

- SKILL text and `riskOf` agree for `{10,10}`, `{10,9}`, `{20,0}`, `{0,30}`, `{5,0}`, `{0,10}`.
- New test asserting the documented table row by row.
