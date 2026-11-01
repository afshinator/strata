# Understand-Anything (v2.9.8) — assessment and a smaller replacement

Repo: <https://github.com/Egonex-AI/Understand-Anything> · MIT · 89.6k stars, 7.6k forks, 605 commits by `Lum1104`
Sources read: source tree at commit `3a71db1c`-era HEAD, `skills/*/SKILL.md`, `agents/*.md`, `packages/core/src`, `packages/{dashboard,viewer}`, `hooks/`, `docs/`, `tests/`, plus 200 GitHub issues and 60 PRs via `gh`.
All `path:line` references are relative to the repo root.

**Verdict: do not install it as designed. Do steal its deterministic layer.** The engineering worth copying is ~1,500 lines of scripts that decide *when not to call an LLM*. The rest is a per-file LLM labelling pass with no verification, no budget, and no way to retract a wrong sentence.

---

## 0. Corrections to my first read of the repo

| My earlier claim | What the code shows |
|---|---|
| "`/understand` feeds every file's source through the LLM" | Wrong. Only tree-sitter extraction JSON is sent (~3.6 KB/file), source re-reads are forbidden except for Swift/Kotlin/PowerShell/Batch/shell. `agents/file-analyzer.md:150`, `:137` |
| "Semantic search exists" | The feature is advertised but dead: both dashboard search modes call the same Fuse.js engine, `SemanticSearchEngine` has no non-test caller. `packages/dashboard/src/store.ts:539-541`, `packages/core/src/embedding-search.ts:61` |
| "`__wawawa__` seeding is being gamed" | Not gamed: 0/60 recent PR bodies contain it, one code hit (the README itself). Risk is latent, not active. `README.md:392-406` |
| "Hooks spend tokens silently" | Real, but opt-in and default-off (`autoUpdate:false`, `packages/core/src/persistence/index.ts:148`). The defect is the *text* it injects, not that it fires by default. `hooks/hooks.json:13-22` |
| "Tours are ordered by dependency" | README claim, not a guarantee. Dependency signals are computed, then an LLM chooses step order; only `order` integers are sorted. `README.md:76`, `agents/tour-builder.md:57-86`, `finalize-incremental.mjs:261` |

---

## 1. What it is genuinely good at, and the mechanism behind it

**F1 — The LLM is confined to narrative.** Twelve bundled deterministic helpers own enumeration, import resolution, batching, merging, and fingerprinting; the model fills `summary`/`tags`/`layer`/`tour` text. `skills/understand/` (8,192 LOC of helpers), `agents/project-scanner.md:29-33` ("**Deterministic** … handled by two bundled scripts").
Why it matters: the structural graph is reproducible run-to-run, so diffs of the graph are meaningful.

**F2 — Import resolution uses real project config, not regex guessing.** `tsconfig` paths (`extract-import-map.mjs:325`), `go.mod` (`:395`), Swift `Package.swift` targets (`:513`), Composer autoload (`:1603`), assembled once (`buildResolutionContext:592`), and every resolved path is gated by file-set membership so externals are dropped rather than invented (`:593,719-731`).
This is the single most reusable idea in the repo: a resolved importMap computed once, reused by every later phase.

**F3 — Batching by import community, not by directory.** Louvain community detection over the resolved import graph with `randomWalk:false` for determinism (`compute-batches.mjs:289-308`), ≤35 files per community (`:488`), small communities pooled at ≤25 (`:342-345`), plus a 1-hop `neighborMap` carrying cross-batch exported symbols capped at 50 by degree (`:567-620`).
Consequence: each LLM call sees a *cohesive* slice of code. That is why the summaries read plausibly at all.

**F4 — Three-level change classification with fail-open escalation.** SHA-256 of content plus per-symbol signatures → `NONE` / `COSMETIC` (content changed, signature identical, no re-analysis) / `STRUCTURAL` (`fingerprint.ts:89-245`). Ambiguity always escalates to STRUCTURAL: unresolved call ownership, missing structural analysis, function line-count swinging outside 0.5×–1.5× (`:155-170,212`).
This is the correct shape for a cache key, and it is what makes incremental runs cost ~157k tokens instead of a full rebuild (`SKILL.md:855`).

**F5 — Fail-closed symbol eviction gate with a one-shot repair budget.** Before publishing an incremental graph, missing function/class/method identities are re-derived from base *and* HEAD with the same strict parser; only source-confirmed deletions pass, everything else blocks publication (`validate-incremental-symbols.mjs:200-240`, `SKILL.md:413`), with exactly one repair attempt per commit pair tracked in `incremental-symbol-retry.json` (`prepare-incremental.mjs:700-712`).
Honest scope is documented: "a conservative deletion gate, not a compiler or runtime equivalence checker" (`docs/incremental/symbol-loss-validation.md:45`).

**F6 — Deterministic recovery of what the LLM drops.** Import edges are 1:1 re-emitted from the importMap by the merge script and tagged `recoveredFromImportMap`, because LLM batches "drop ~25% of them on real projects" (`merge-batch-graphs.py:1066-1145`, `:1074`). Merge also normalises IDs, rewrites edge endpoints, dedupes on `(src,tgt,type,direction)`, and drops dangling edges *with a log* (`:808-1000`).
Design lesson: never trust the model for facts you can recompute.

**F7 — A shareable artifact with a real security model.** Graph is plain JSON; the viewer is `node:http` only, binds `127.0.0.1`, per-process token in the URL, and `/file-content.json` is gated by an allowlist derived from the graph's own `filePath` values plus traversal rejection and a 1 MB cap (`packages/viewer/bin/viewer.mjs:86,117-140,309-317`). Absolute paths are relativised before serving (`:196-215`). Tests assert each of those properties (`tests/skill/viewer/test_viewer.test.mjs:114-195`).

**F8 — Tests drive real CLI entrypoints against real temp git repos.** `git init`/`commit` in fixtures, not mocks (`tests/skill/understand/test_prepare_incremental.test.mjs:48-76`); symbol-evidence matrix is a 6×3×3 cross-product (`test_symbol_evidence_matrix.test.mjs:31-58`); CI runs Ubuntu + Windows + Python unittest (`.github/workflows/ci.yml:22-60`).

**F9 — One skill tree, 14 harnesses.** Shared `SKILL.md`/`agents/*.md`/scripts; per-harness artifacts are only manifests and symlink targets (`install.sh:34-50`). Cheap portability, and the model-specific bits are isolated to invocation prefix and hook support.

---

## 2. The real problems (verified, with mechanism)

**P1 — No budget, no measurement, and a benchmark that refuses to measure.** `docs/benchmarks/large-monorepo.md:26`: the benchmark does "not run an LLM, call an API, count tokens, estimate cost". `costUsd: null` is hardcoded (`scripts/lib/large-repo-benchmark.mjs:1720`). The only guard is prose ("if >100 files, inform the user", `SKILL.md:299`). Issue #657 asks for costing and is open.
Scale: a 1,000-file repo is ≥85 agent dispatches (`SKILL.md:341,447`: 81 batches + scanner + assemble-reviewer + architecture + tour), ≥250 model calls, ~1.7M input tokens by derivation from their own 459-file sample; issue #284 reports 236 batches ≈ 113h wall-clock and ~26M tokens.

**P2 — Cost cliff at 30 changed files.** `structural > 30` **or** `>50% of inventory` → `FULL_UPDATE`, re-entering the full pipeline (`change-classifier.ts:19,47-48`, `SKILL.md:224`). A formatter run or dependency bump on a 5,000-file repo re-pays the entire graph. No middle tier exists.

**P3 — Symbol-level work is repeated needlessly.** File-granularity caching is real, but one changed line in a 1,400-line file re-emits every symbol summary; `previousSymbols` carries IDs, not prose (`SKILL.md:430`, issue #680).

**P4 — Three unbounded single prompts.** Phase 4 pastes *all* file nodes and *all* edges into one subagent prompt, plus 24 language and 10 framework `.md` files (`SKILL.md:481-486,500-514`); tour-builder and assemble-reviewer get the full importMap inline (`:463-465`). No chunking.

**P5 — Nothing verifies a summary against the code.** `graph-reviewer.md:31-118` checks schema, referential integrity, layer coverage, uniqueness, and "summary not empty or equal to filename". It instructs the model: "Do NOT re-read the original graph file — trust the script's results entirely" (`:186`, `:230`). Its enum lists are stale anyway (16 node/29 edge types vs 27/38 in `types.ts`/`schema.ts`, `graph-reviewer.md:44,60`).

**P6 — Wrong prose is permanent and load-bearing.** A bad summary feeds layer assignment (`SKILL.md:500-510`), tour prose, and `/understand-chat` answers (`skills/understand-chat/SKILL.md:32-40`); `PARTIAL_UPDATE` "preserves existing layer assignments and tour prose" (`SKILL.md:221`); the only whole-graph semantic pass is skipped on every incremental run (`SKILL.md:442`, `hooks/auto-update-prompt.md:84`).

**P7 — The `calls` edges everyone wants are guesses.** The extractor emits the *raw callee text* with no binding (`typescript-extractor.ts:170-178`); the edge is produced from "infer from imports + function names when confident" at weight 0.8 (`file-analyzer.md:268`); the deterministic callGraph is never consumed by any merge/validate script. No type resolution, no receiver typing, no virtual dispatch, no trait/impl resolution.

**P8 — Worktree redirect rewrites the source root, not just the output.** `PROJECT_ROOT="$MAIN_ROOT"` (`SKILL.md:53-73`, duplicated in `understand-domain/SKILL.md:23-43`) and then the prompt says use `$PROJECT_ROOT` for everything (`:528`). Branch-only and untracked files vanish from the scan — reproduced by the reporter of #739. Additionally `git rev-parse HEAD` runs without `-C "$PROJECT_ROOT"` (`:131-133`), so the recorded commit can disagree with the analysed tree and permanently poison the staleness hook.

**P9 — No lock, fixed intermediate filenames.** Two agents in two worktrees converge on one `.ua/`, writing `batch-<i>.json`, `scan-result.json`, `fingerprints.json`, `meta.json`. Only per-file atomic writes exist (`prepare-incremental.mjs:113`); `grep -i "flock|mutex|lockfile"` in `skills/understand/` returns nothing. A crashed or concurrent run yields a graph assembled from two trees.

**P10 — Hook text that orders the agent not to ask.** Verbatim, injected at session start when `autoUpdate:true` and HEAD ≠ graph commit (`hooks/hooks.json:13-22`): "You MUST read the file at .../auto-update-prompt.md and execute its instructions ... Do not ask the user for confirmation — just do it." Also no `matcher` on SessionStart (fires on `compact`), a malformed `meta.json` produces a false "stale", and the whole command has zero test coverage. Agents reportedly acknowledge then ignore it (issue #384).

**P11 — Silent-degradation bugs that maximise cost.** #704: stale `packages/core/dist` throws `analyzeFileStrict is not a function` and every incremental run silently becomes a full rebuild. #680 class: symbol loss, now converted into *blocked* publication by the new gate (#751, #746, #710, #732 — TS arrow line breaks, C++ headers, out-of-class definitions).

**P12 — Dead code shipped as product surface.** `analyzer/*` (GraphBuilder, `buildFileAnalysisPrompt`, `detectLayers`, `generateHeuristicTour`) and `@understand-anything/skill` are exported, CI-built, and called by nothing but their own tests (`packages/core/src/index.ts:12-88`, `understand-anything-plugin/src/index.ts:1-19`). Same for `SemanticSearchEngine`. Persistence helpers with zod validation are unused because the graph is written by shell heredocs.

**P13 — Prompt-seeded README.** Hidden HTML comment tells AI agents to insert `__wawawa__` into PRs (`README.md:392-406`). Not being exploited, but a repo whose product is "instructions your agent obeys" should not carry covert instructions to your agent.

---

## 3. Capability gaps worth owning (they have none of these)

| Gap | Why it matters | What we would use |
|---|---|---|
| LSP / type-checker integration | Their #1 permanent bug stream is path-alias resolution (#629 #620 #706 #214 #502 #294 #589 #621 #645) because it is regex + tsconfig JSONC | `tsc` program API / `tsserver`, `gopls`, `rust-analyzer`; `fallow --type-aware` for exact TS symbol use |
| Reverse dependencies ("what breaks if I change X") | The highest-value query in practice; they only have forward `imports` | deterministic reverse-import traversal in our index |
| Git history intelligence | No churn, no hotspots, no `blame`, no co-change coupling; only `rev-list` for counting (`staleness.ts:292`) | `git log --numstat` churn + co-change matrix; `fallow health --hotspots --ownership` |
| Dead code / unused exports / duplication / boundaries | `exports` edges exist but nothing computes "never imported"; orphans are a warning (`graph-reviewer.md:102`) | `fallow dead-code`, `fallow duplicates`, `fallow boundaries` |
| Real complexity metrics | File-size buckets only (`file-analyzer.md:196-200`); issue #273 open | `fallow health` cyclomatic + cognitive |
| Test-to-code mapping that holds | `tested_by` is convention + LLM, five defects (#302 #586 #595 #646 #664) | coverage ingestion (`fallow health --coverage-gaps`) + test-name convention |
| Query API for other agents | No MCP server; the only surface is a static file server, so agents `grep` a multi-MB JSON in context and re-pay it per question (`understand-chat/SKILL.md:54`) | a small `codemap query` CLI + MCP tool over the index; answers cost O(1) context |
| Runtime truth | 100% static; no traces, no coverage, no profiling | optional coverage merge; `diagnosing-bugs` skill for dynamic work |
| Per-question cost | Every "how does X work" reloads the whole picture | on-demand explain path that reads only the blast radius |
| Honest precision tiers | The tool presents LLM guesses and parser facts with equal confidence | every node/edge tagged `compiler` / `tree-sitter` / `regex` / `llm` |
| Ownership / CODEOWNERS | Zero references | `git log --format` owner aggregation |

---

## 4. The replacement: one skill, three modes, deterministic core

Name: `codemap`. Not a port — a different split of the same problem. Their mistake is architectural, not engineering: they analyse the whole repo semantically *before anyone asks a question*. We index deterministically, then answer on demand.

### D1 — Build is 0 tokens
`codemap index` runs scripts only:
- per-language structure via `fallow` where TS/JS (graph, exports, boundaries, hotspots, coverage), tree-sitter/ctags elsewhere, `rg` for the long tail;
- importMap resolved with real project config, file-set gated (their F2 is worth copying verbatim);
- reverse-import index (their missing capability);
- churn + co-change from `git log --numstat --name-only`;
- test mapping via coverage file if present, else naming convention;
- precision tag on every node/edge.

Output: `.codemap/index.json` (machine), `.codemap/MAP.md` (≤200 lines, human/agent briefing), `.codemap/QUESTIONS.md` (open gaps it could not resolve deterministically, one line each).

The deliverable is `MAP.md`, not a dashboard. A graph you have to open a browser to read is a graph your agent cannot use.

### D2 — Semantics are asked for, not precomputed
`codemap ask "<question>"` takes the question, uses the index to select the minimal file set (import closure around the named symbols, ≤N files), reads only those, and answers with `file:line` citations. One question = one bounded call. No whole-repo pass, so no 85-agent minimum and no 30-file cliff.

If a semantic write is genuinely wanted (`codemap describe <paths>`), it is scoped to explicit paths, and each written claim stores `{claim, evidence: [file:line], sourceHash}`.

### D3 — Evidence invariant, the fix for their P6
A stored claim is served only while `sourceHash` matches the current file. A changed file invalidates its own prose; a *dependency* change invalidates claims whose evidence pointed at the changed symbol. This is their fingerprint idea applied to prose instead of graph nodes, and it makes wrong summaries correctable rather than permanent.

### D4 — Blast radius is the flagship command
`codemap blast [--since <rev>]` → changed symbols → reverse-import closure → affected tests → owners → churn risk, all deterministic, no LLM. This is what `/understand-diff` should have been (`skills/understand-diff/SKILL.md:74-84` currently asks the model to grep the graph and hand-write JSON).

### D5 — No hooks, no consent problem
Explicit invocation only. No SessionStart injection, no "do not ask the user for confirmation". Staleness is reported by `codemap status` (cheap `git` check), never auto-executed.

### D6 — Worktree- and concurrency-safe
Read from `$PWD` always; never rewrite the source root. Single lock file (`.codemap/lock`) around writes; every artifact written atomically with a run id. Index keyed on the analysed tree, and `status` distinguishes "graph stale" from "different branch".

### D7 — Reuse what we already have instead of rebuilding it
| Existing skill | Role in `codemap` |
|---|---|
| `fallow` / `fallow-review` | the TS/JS deterministic engine: dead code, duplicates, boundaries, complexity, coverage gaps, changed-code risk, type-aware symbol use. Do not reimplement any of it |
| `codebase-design` | the deep-module vocabulary for the "why this is shaped this way" layer, only where the index flags a seam |
| `show-me` | renders the answer as a tree/diff/sequence sketch on request instead of shipping a dashboard |
| `excalidraw-diagram` / `fireworks-tech-graph` | optional architecture render when a static picture is actually wanted |
| `domain-modeling` | promotes stable domain terms into `GLOSSARY.md` / ADRs, which is the honest version of their `--domain` LLM guesswork |
| `teach` | consumes `MAP.md` as the reading order for onboarding, instead of a generated tour of unverified prose |
| `code-review` | calls `blast` to scope the review before reading the diff |
| `diagnosing-bugs` | when the question is dynamic, hand off rather than pretend the static graph answers it |

### D8 — Budget is a first-class output
`status` prints token estimate for the pending work and file counts per precision tier. `ask` refuses to run above a hard file ceiling without an explicit flag. Their absence of this is issue #657.

### Effort and risk

- **Effort:** ~600–900 LOC of scripts for `index` + `blast` (importMap resolver reused from their approach, reverse index, churn, lock, atomic writes) plus three short SKILL.md-mode docs. Days, not weeks, because `fallow` already does the JS/TS heavy lifting.
- **R1** Multi-language precision: fallow covers TS/JS only. Other languages fall back to tree-sitter/regex tiers and must be labelled as such, or the tool repeats their overclaiming.
- **R2** Import resolution across ecosystems is the part that eats time (their 13 resolvers + config loaders exist for a reason). Start with TS/JS + Python + Go; ship the rest as `regex` tier.
- **R3** `MAP.md` drifts like any doc — mitigated by generating it, never hand-editing it, and by `status` reporting drift.
- **R4** If `ask` is under-scoped it answers confidently from too little context, which is the same failure class as theirs, just cheaper. Mitigation: every `ask` answer must cite, and must say what it did not read.

### Recommendation

Yes — build `codemap`, but only modes `index` and `blast`, and only with `fallow` doing the TS/JS work. Do not build a dashboard, do not build a per-file LLM labelling pass, do not ship hooks.

Their graph costs 85 agent dispatches to produce a picture nobody can query cheaply; our index costs zero tokens, answers blast-radius questions in one grep-shaped lookup, and only spends model tokens on the specific question a human or agent actually asked.

---

## 5. Verification used for this document

- `gh repo view Egonex-AI/Understand-Anything --json stargazerCount,forkCount,createdAt,pushedAt,issues`
- `gh issue list -L 120 --state all` and `gh issue view` on #284, #657, #680, #704, #739, #384, #433, #751, #746, #710, #732
- `gh pr list -L 60 --state all --json body` → 0 occurrences of `__wawawa__`
- direct reads of every `path:line` cited above; nothing here is taken from the README without checking the code
