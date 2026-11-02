# Review — from-scratch verification (2026-11-02)

**Diff under review:** `904e84a...HEAD` — base is the initial commit; the whole tool.
**Method:** three axes in parallel isolated agents, aggregated without merging or re-ranking. Unlike the prior review (see `2026-11-01-scaffold.md`), this run included a **Premise** axis: the Understand-Anything critique that motivated strata was fact-checked claim-by-claim against the real v2.9.8 source at `/tmp/ua`. Every Standards and Spec finding was reproduced by running the CLI in throwaway git repos, not by reading docs. `npm test` 7/7 at time of review. None of these findings are fixed yet.

Codes: `S-` Standards, `P-` Spec, `X-` Premise. Numbering follows each axis's original report.

---

## Premise — UA critique verified against source

**Verdict: the critique is substantially accurate.** Clone matches v2.9.8 (`understand-anything-plugin/package.json:3`); all real paths live under `understand-anything-plugin/` with line drift ≤30 but content matching.

- **X-Architecture ✓** — Whole-repo semantic precompute at index time: SKILL.md dispatches file-analyzer subagents per batch (≤5 concurrent, `:341`), assemble-reviewer at `:447`. Zero scripts call claude/API directly — all LLM cost is SKILL.md-orchestrated subagent dispatches, fixed upfront. Question-time (`understand-chat`) just greps the graph (`:54`).
- **X-Cost ✓** — Benchmark refuses measurement verbatim (`docs/benchmarks/large-monorepo.md:26`); `costUsd: null` hardcoded (`scripts/lib/large-repo-benchmark.mjs:1720`); only a prose ">100 files" guard (`SKILL.md:299`). "~157k tokens / ~158s per incremental run" is verbatim (`SKILL.md:855-856`).
- **X-Hooks ✓** — SessionStart injection text verbatim, including "Do not ask the user for confirmation — just do it." (`hooks/hooks.json`); no matcher on SessionStart; `autoUpdate: false` default (`packages/core/src/persistence/index.ts:148`); the SessionStart command has zero tests.
- **X-P-items** — P1✓ P2✓ (`change-classifier.ts:47-48`: >30 files or >50% → FULL) P3✓ P4✓ (Phase-4 prompt pastes all file nodes + edges inline; 24 language + 10 framework files) P5✓ P6✓ P7✓ (callee.text raw, no binding, `typescript-extractor.ts:172-178`) P8✓ (`PROJECT_ROOT="$MAIN_ROOT"`; nuance: an `UNDERSTAND_NO_WORKTREE_REDIRECT=1` escape hatch exists — the critique missed it) P9✓ (fixed filenames, no lock) P10✓ P12✓ P13✓. **P11 unverifiable** (issue-based).
- **X-Guesses, not observations** — All issue-derived claims (#284's 113h/26M tokens, #657, #704, #739) unchecked offline (shallow clone, no issue fetch); "~3.6 KB/file" not in source; "~25% import drops" is UA's own code-comment claim (`merge-batch-graphs.py:1074`), not a measurement; star/commit counts unverifiable offline.
- **X-Deterministic layer** — Real and substantial: exactly 8,192 LOC of non-LLM scripts — tsconfig/go.mod/Package.swift import resolution (`extract-import-map.mjs:325,395,513,1603`), file-set gating, Louvain `randomWalk:false` with ≤35/≤25 batch caps and MAX_NEIGHBORS=50 (`compute-batches.mjs:307,488,345,567`), sha256 fingerprints with 0.5×–1.5× escalation (`fingerprint.ts:81,212`), import-edge recovery (`merge-batch-graphs.py:1129`), one-shot repair (`prepare-incremental.mjs:688`). The critique said "steal its deterministic layer", so strata reimplementing resolution is the design, not an oversight.

---

## Standards

### Hard — documented rule breached

| Code | Finding | Evidence |
|---|---|---|
| S-F1 | Invented edge. Workspace pkg with `"main": "./dist/missing.js"` (nonexistent) still fabricates an edge to any shallow index/main file. Verified: `packages/app/main.ts -> packages/core/lib/index.ts`, unresolved empty — belongs in QUESTIONS.md. | `src/lib/imports.mjs:224-229` |
| S-F2 | README claims exit 2 for "missing index"; `status` returns 0 (verified); blast returns 2. | `src/commands/status.mjs:8-11` |
| S-F3 | Phantom flag: `--data-dir` documented, nothing consumes it. Verified `--data-dir /tmp/x` silently ignored. | `bin/strata.mjs:12` |
| S-F4 | ".strata/ is gitignored by default" is false — tool never touches `.gitignore`; `?? .strata/` after index, verified. Its own output then pollutes status, MAP "dirty files", and blast notes, and reindexing never clears it. | `src/lib/store.mjs` |
| S-F5 | Risk rule mismatch: SKILL says HIGH at fan-in ≥ 20 or churn ≥ 30; code adds `fanIn>=10 && churn>=10` → HIGH, asserted by a test. | `src/commands/blast.mjs:22`, `test/index.test.mjs:117` |
| S-F6 | Subdirectory silently zeroes churn/owners: `git log --name-only` paths are repo-root-relative, `ls-files` paths cwd-relative. File with 1 commit indexed from `sub/` → churn 0. Blast from a subdir exits 2 even when a root index exists. | `src/lib/git.mjs:66` vs `:29` |

### Judgement — baseline smells

- **S-F7** `--depth abc` → NaN → "direct importers 0", silently (verified).
- **S-F8** `--since NOPE-REV` → "no changes", exit 0 — typo indistinguishable from a clean tree.
- **S-F9 Lock stranding**: pid recorded but liveness never checked; killed index → every later `index` refuses until manual `rm` (verified with stale pid).
- **S-F10 Duplicate edges**: two imports of one target → duplicate `from->to` entries; stats counts them twice (verified "edges 3" for 2 unique). Fan-in unaffected (Sets).
- **S-F11 Repeated Switches**: parallel lang dispatch in extract and resolve (`imports.mjs:81-107`, `:237-243`).
- **S-F12 Duplicated Code**: `blast.mjs` calls `head(root)` three times — three git subprocesses for one value.
- **S-F13** `imports.mjs:216` fakes a from-path to reuse `tryJsCandidates` — cryptic coupling.
- **S-F14 Speculative Generality** (minor): lang map covers rust/java/kotlin/scala/ruby/php/csharp/swift with no extractor; `testCandidates` emits `_test.rb` for a language with no edges.

Verified-clean: writes confined to `.strata/`, `tier:"regex"` on every edge, fixture-string suppression, atomic tmp+rename, MAP section order matches SKILL.

---

## Spec

### (a) Missing / partial

| Code | Finding | Evidence |
|---|---|---|
| P-F1 | Spec says "only with `fallow` doing the TS/JS work … do not reimplement any of it" — zero fallow anywhere; TS/JS imports are homegrown regex. README re-scopes to "Phase 1, regex tier", overriding a higher-priority requirement. | `src/lib/imports.mjs:104` |
| P-F2 | D1's "churn + co-change from `git log --numstat --name-only`" — no co-change matrix. | `src/lib/git.mjs:76` |
| P-F3 | D1's "test mapping via coverage file if present, else convention" — convention only. | `src/lib/scan.mjs:40` |
| P-F4 | D4's "changed symbols → reverse-import closure" — file-level only. | `src/commands/blast.mjs` |

### (b) Scope creep

None. Phase-1 boundary held; no hooks, dashboard, or toolchain execution.

### (c) Implemented but wrong / misleading

- **P-F5 Untracked-only change (new `src/new.ts`): `blast` → "no changes in the working tree", exit 0.** Early return at `blast.mjs:63` fires before the untracked NOTE. Contradicts SKILL's "dirty + untracked" contract and rule 4.
- **P-F6** "gitignored by default" false (see S-F4) — `.strata/` pollution feeds back into every report.
- **P-F7** Bad `--since` silently says "no changes" (exit 0) despite README's exit-2 contract.
- **P-F8** `--depth abc`/`-1` unvalidated → NaN → zero closure, exit 0.
- **P-F9** `--data-dir` advertised, ignored.
- **P-F10** `riskOf` HIGH thresholds don't match SKILL.
- **P-F11** One-commit repo reports "2 commits" — `git.mjs:106` counts the empty leading chunk of the `\u0001`-delimited log.
- **P-F12** Subdir run silently indexes a subtree and writes `.strata` clutter into it; root blast then reports "no index".
- **P-F13** `status` exits 0 on missing index though README's list includes it.

Honoured (verified): worktree-safety, held-lock → 2, not-a-repo → 2, 0 tokens/offline/~50ms, MAP ≤200 lines, honest tier tags.

---

## Summary

- **Premise:** confirmed. The critique's architecture, cost, and hook claims all check out against source; P-items are evidenced except P11; unverified claims are all issue-derived or numeric footnotes, plus one missed escape hatch (`UNDERSTAND_NO_WORKTREE_REDIRECT=1`). The deterministic layer (8,192 LOC) is real, and the "steal it, don't reuse it" design stands.
- **Standards:** 6 hard, 8 judgement. Worst: **S-F1** — a fabricated workspace edge breaking the never-invent invariant.
- **Spec:** 4 missing, 9 wrong. Worst: **P-F5** — blast silently answers "no changes" for untracked files, a wrong answer to the tool's one core question.
