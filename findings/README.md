# Findings

Evidence appendix for the tickets. These are the 23 defect write-ups produced from `reviews/2026-11-01-scaffold.md` and `reviews/2026-11-02-verification.md`, each re-verified by running the CLI in throwaway git repos.

They are **not** the tickets. The tickets are GitHub issues; see the mapping below. Keep this directory for the reproductions, the observed output, and the `file:line` detail that would go stale inside an issue body.

## Status

Every defect below is now either fixed inline or tracked in issue 1–10. Codes `T01…T23` are historical identifiers, kept so the review codes (`R1 S-F5`, `R2 P-F5`, …) remain traceable.

## Mapping

| Finding | Disposition |
|---|---|
| T01 root normalization | issue #1 |
| T02 blast ignores untracked | issue #4 |
| T03 lock stranding | issue #2 |
| T04 comment false-positive edges | issue #7 |
| T05 reading order inverted | issue #6 |
| T06 invented workspace edge | issue #8 |
| T07 bad `--since` / `--depth` | issue #5 |
| T08 exit-code contract | issue #5 |
| T09 gitignore self-pollution | issue #3 |
| T10 `--json` on the empty path | issue #4 |
| T11 edge dedupe | **fixed inline** |
| T12 commit count off by one | **fixed inline** |
| T13 non-deterministic index | issue #9 |
| T14 tier missing from blast | **fixed inline** |
| T15 phantom `--data-dir`, USAGE drift | **fixed inline** |
| T16 bare-specifier bucket label | issue #8 (labels) + issue #10 (skill text) |
| T17 side-effect imports | issue #7 |
| T18 undocumented HIGH risk rule | **fixed inline** (documented, not removed) |
| T19 `--root` doc contradiction | **fixed inline** |
| T20 spec/README overstatement | issue #10 |
| T21 code smells | C1–C3 folded into the issue that touches the same code; C4 resolved by #8; C5–C7 dropped as style |
| T22 test harness gaps | dissolved: each fix carries its own test; the `--root`-forcing helper is #1's first acceptance criterion |
| T23 quadratic paths | dropped: unmeasured, and the 20-edge cap bounds `resolveGo`. Re-open only with a measurement on a repo over ~2k Go files |

## Rejected, do not action

| Review finding | Why |
|---|---|
| R1 `P-F8` — C/C++ resolver exceeds risk R2 | R2's own sentence permits the rest as `regex` tier. R2 independently concluded "no scope creep". |
| R1 `P-F6` — `--root` is scope creep | The flag reads a tree, it never rewrites one. The real defect was a three-way doc contradiction; fixed inline. |
| R2 `X-Guesses` — critique claims not re-verifiable offline | The assessment records the exact `gh` commands used. Unverifiable offline is not false. |
