# strata

Deterministic codebase index. What depends on what, what breaks when you change it, and — later — what the docs get wrong.

No dashboard. No hooks. No build step. No LLM in the index path.

```
strata index      # 0 tokens, writes .strata/index.json + MAP.md
strata blast      # 0 tokens, reverse dependency closure of your changes
strata status     # 0 tokens, staleness
```

## Why this exists

[Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) produces an impressive graph by sending every file through an LLM before you have asked a question: ≥85 agent dispatches for a 1,000-file repo, no token budget, no verification of the generated prose, and a 30-changed-file threshold that silently turns an incremental refresh into a full rebuild. The full teardown, with `file:line` evidence, is in [`research/understand-anything-assessment.md`](research/understand-anything-assessment.md).

`strata` inverts that: index deterministically for free, spend tokens only on the specific question someone actually asked.

## Design rules

1. **Index costs nothing.** Every command in the index path is deterministic and offline.
2. **No build step.** Plain ESM, Node ≥ 20, zero dependencies. Nothing to compile, nothing to go stale (UA's #704 is a stale `dist/` turning every refresh into a full rebuild).
3. **Every edge carries a tier.** `compiler` > `tree-sitter` > `regex`. Today everything is `regex`; the report says so instead of implying precision it does not have.
4. **Unresolved is a result, not a failure.** Anything that does not resolve lands in `QUESTIONS.md` with a reason. Never an invented edge.
5. **No hooks, no consent games.** Nothing runs until you type it. No "do not ask the user for confirmation".
6. **Worktree-safe.** Reads `$PWD`, never redirects the source root, takes an exclusive lock on the data dir.

## Status

Phase 1, `regex` tier. Working: `index`, `blast`, `status`, `MAP.md`, `QUESTIONS.md`, lock, atomic writes.
Import resolution: relative JS/TS (incl. `.js`→`.ts`), workspace packages from `package.json` `workspaces` and `pnpm-workspace.yaml` (entry file, `dist/`→`src/` fallback), Python relative + module lookup, Go module-relative packages, C/C++ local headers. `node:` builtins and third-party specifiers are counted as *external*, not as failures; tsconfig path aliases are not modelled and land there too. Imports written inside string literals are ignored so fixture code does not become an edge.

Known regex-tier misses: dynamic `require(variable)`, aliases outside tsconfig handling, template literals spanning lines.
Not built yet: tree-sitter tier, `compiler` tier via LSP/`tsc`, `ask`, docs layer. The docs-layer tooling is already chosen and measured in [`research/strata-docs-layer-tooling.md`](research/strata-docs-layer-tooling.md): lychee, vale, typos, ast-grep, mdast.

## Use

```bash
node bin/strata.mjs index                 # or: npm link && strata index
strata blast --since HEAD~1               # what imports what changed
strata blast --depth 2 --json             # transitive, machine-readable
strata blast --sketch                     # importer tree instead of a table
strata index --root ~/code/other-repo
```

Exit codes: `0` ok, `2` usage/refused (not a git repo, missing index, held lock). `blast` never fails a build — it is a report.

## What it writes

| Path | Content |
|---|---|
| `.strata/index.json` | files with language/churn/owners/tests, import edges, unresolved list, reading order, cycles |
| `.strata/MAP.md` | generated briefing: numbers, entry points, fan-in table, dependency-first reading order, hotspots (churn × fan-in), untested-and-depended-on, unresolved summary |
| `.strata/QUESTIONS.md` | everything the tool could not determine, one line each with `file:line` and a reason |

`.strata/` is gitignored by default. Commit it only if you want teammates to skip the (free) index.

## Test

```bash
npm test    # node:test, real temp git repos, no mocks
```
