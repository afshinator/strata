# T20 — Spec doc and README Status overstate what exists

**Priority:** P3
**Status:** open
**Reviews:** R1 P-F1, P-F2, P-F3, P-F4, P-F5 · R2 P-F1, P-F2, P-F3, P-F4, R2 X-Guesses
**Files:** `research/understand-anything-assessment.md:104-149`, `README.md:34-38`

## Symptom

`research/understand-anything-assessment.md` §4 is the design spec and is cited as such by both reviews. It promises features that do not exist, and README does not disclose the gap. Verified by grep, not by reading prose:

| Spec claim | Reality | Evidence |
|---|---|---|
| D7: "only with `fallow` doing the TS/JS work … do not reimplement any of it" | zero dependencies; homegrown regex extractor | `package.json` has `dependencies: {}`, `devDependencies: {}`; `grep -rn fallow src bin` → nothing |
| D1: "churn + co-change from `git log --numstat --name-only`" | churn only, no co-change; `--numstat` never used | `grep -rn "numstat\|co-change" src bin` → one comment in `git.mjs:61` |
| D1: "test mapping via coverage file if present, else convention" | convention only | `scan.mjs:35-48` calls `testCandidates`; `grep -rn "coverage\|lcov" src bin` → nothing |
| D4: "changed symbols → reverse-import closure" | file-level only | `blast.mjs:26-46` operates on file paths |
| D8: "`status` prints token estimate … and file counts per precision tier" | no token estimate, no per-tier counts | `status.mjs:18-31` prints only `tier ${data.tier}` |
| D6: "`status` distinguishes 'graph stale' from 'different branch'" | no branch is stored or read | `index.json` keys: `version, root, generatedAt, head, dirtyFiles, tier, stats, files, edges, unresolved, readingOrder, cycles` |
| P8: worktree redirect has no escape hatch | UA ships `UNDERSTAND_NO_WORKTREE_REDIRECT=1` | R2's premise axis found it in the UA source; the assessment omits it |

The fallow item is a genuine contradiction between `README.md` rule 2 ("zero dependencies") and the spec. One of them must win.

Note R1's P-F8 (C/C++ resolver is scope creep) is **rejected** — see the index. R2 correctly found no scope creep.

## Evidence

```

$ node -e 'const p=require("./package.json"); console.log(p.dependencies, p.devDependencies)'
{} {}
$ grep -rn "numstat\|co-change" src bin
src/lib/git.mjs:61: * Upgrade to --numstat -z parsing if that ever matters.
$ grep -rn "coverage\|lcov\|istanbul" src bin
(nothing)
$ node bin/strata.mjs status
index    2026-11-01T21:02:59.321Z · 17 files · 16 edges · tier regex
head     4e85863 → 6c5e11f (2 commits behind)
working  0 dirty path(s)
pending  4 indexed file(s) changed since the index was built (0 tokens to refresh)
docs     MAP.md present
tier     import edges are regex-derived; expect misses on dynamic imports and path aliases
```

No token estimate, no branch, no per-tier file counts.

## Root cause

README's *Status* section lists what works and what is "Not built yet", but it was written after the spec and nobody reconciled the two. §4 still reads as a description of the shipped tool.

## Fix

Documentation only. Pick the resolution for each row and write it down once:

1. **Fallow (D7).** README rule 2 wins: zero dependencies, regex tier. Rewrite D7 to say the TS/JS extractor starts as regex and fallow integration is a later tier, with the token/quality trade-off named. Otherwise rule 2 must go — decide, do not leave both.
2. **Co-change / coverage / symbol granularity.** Add an explicit "Deferred past Phase 1" table to `README.md` *Status* listing each with the reason. Both reviews filed these as missing spec items; the honest fix is disclosure, since README already scopes Phase 1 to `regex`.
3. **Token estimate / branch detection (D8, D6).** Same table. Optionally implement branch detection cheaply (`git rev-parse --abbrev-ref HEAD`) since it is one line and makes `status` more useful — but that is a different ticket if it is wanted.
4. **`UNDERSTAND_NO_WORKTREE_REDIRECT=1`.** Add the nuance to P8 so the critique is not overstated. This is the one factual error found in the premise document.

Do not mark R2's X-Guesses as defects: §5 of the assessment records the exact `gh` commands used, so the issue-derived numbers are attributed, just not re-verifiable offline.

## Verify

- Every `Dn` claim in §4 either exists in `src/` or appears in README's deferred table.
- `README.md` *Status* and the spec doc make the same claims about fallow.
- P8 mentions the escape hatch.
- No code changes; `npm test` unchanged.
