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
2. **No build step.** Plain ESM, Node ≥ 20, zero runtime dependencies. Nothing is compiled and nothing compiled is shipped, so nothing can go stale (UA's #704 is a stale `dist/` turning every refresh into a full rebuild). Development tooling lives in `devDependencies` and is exempt from this rule: it emits no artifact, so it cannot go stale, and a consumer never installs it.
3. **Every edge carries a tier.** `compiler` > `tree-sitter` > `regex`. Today everything is `regex`; the report says so instead of implying precision it does not have.
4. **Unresolved is a result, not a failure.** Anything that does not resolve *inside the repository* lands in `QUESTIONS.md` with a reason. A specifier that points outside it is counted as external instead. Never an invented edge.
5. **No hooks, no consent games.** Nothing runs until you type it. No "do not ask the user for confirmation". This constrains what `strata` does to the repository it analyses — never how this repository is developed. See [Checks](#checks).
6. **Worktree-safe.** Never rewrites the analysed tree: no `chdir`, no redirect of the source root, no config mutation. `--root` selects a different tree for one run. Holds an exclusive lock on the data dir.

## Status

Phase 1, `regex` tier. Working: `index`, `blast`, `status`, `MAP.md`, `QUESTIONS.md`, lock, atomic writes.
Import resolution: relative JS/TS (incl. `.js`→`.ts`), workspace packages from `package.json` `workspaces` and `pnpm-workspace.yaml` (entry file, subpaths, `dist/`→`src/` fallback), Python relative + module lookup, Go module-relative packages, C/C++ local headers. `node:` builtins and third-party specifiers are counted as *external*, not as failures; tsconfig path aliases are not modelled and land there too. Imports written inside string literals or comments are ignored, so fixture code and commented-out imports do not become edges.

Known regex-tier misses: dynamic `require(variable)`, aliases outside tsconfig handling, template literals spanning lines.

### Deferred, and why

The design record in [`research/understand-anything-assessment.md`](research/understand-anything-assessment.md) §4 is a sketch written before Phase 1. Where it promises something that does not exist, this table is the authoritative answer:

| Promised there | Today | Why it is deferred |
|---|---|---|
| TS/JS extraction done by `fallow` | homegrown `regex` extractor | rule 2 keeps the runtime dependency-free. `fallow` runs here as a dev tool on this repo, never as part of the pipeline |
| co-change matrix from `git log --numstat` | churn only | needs `--numstat` parsing plus a coupling model, and churn alone already answers "what breaks" |
| test mapping from a coverage file | naming convention plus the import graph | a coverage file is language- and runner-specific; the convention needs nothing installed |
| changed *symbols* in `blast` | file granularity | symbol extraction is a `tree-sitter`-tier job, and the report says the tier it used |
| `ask` / `describe` | not built | they spend tokens; the index path is defined as the part that does not |
| per-claim `sourceHash` invalidation | not built | only meaningful once prose is stored, which needs `ask`/`describe` first |
| token estimate and per-tier counts in `status` | not built | there is one tier, so a budget has nothing to compare |
| branch-aware staleness in `status` | commit comparison only | the index records a commit, not a branch; HEAD drift is the honest signal |
| a run id in every artifact | not built | the lock serialises writers, so two runs cannot interleave artifacts |
| `tree-sitter` and `compiler` tiers | `regex` only | each is a separate resolver, and the report already names the tier in use |

Not started at all: the docs layer. Its tooling is already chosen and measured in [`research/strata-docs-layer-tooling.md`](research/strata-docs-layer-tooling.md) — lychee, vale, typos, ast-grep, mdast.

## Use

```bash
node bin/strata.mjs index                 # or: npm link && strata index
strata index [--root <dir>] [--quiet]     # the full signature, same as --help
strata blast [--since <rev>] [--depth N] [--json] [--sketch]
strata status

strata blast --since HEAD~1               # what imports what changed
strata blast --depth 2 --json             # transitive, machine-readable
strata blast --sketch                     # importer tree instead of a table
strata index --root ~/code/other-repo
```

Exit codes: `0` ok, `2` usage or refused.

| Command | Exits `2` when |
|---|---|
| `index` | not a git repository, another run holds the lock, an unknown flag |
| `status` | not a git repository, no index, an unknown flag |
| `blast` | an unknown flag, an unknown revision, or a `--depth` that is not a positive integer |

A missing index is a notice and exits `0` for `blast`: it is a report, so it never fails a build. A malformed invocation still fails, because a typo must not be mistaken for an empty result.

## What it writes

| Path | Content |
|---|---|
| `.strata/index.json` | files with language/churn/owners/tests, import edges, unresolved list, reading order, cycles |
| `.strata/MAP.md` | generated briefing: numbers, entry points, fan-in table, dependency-first reading order, hotspots (churn × (fan-in + 1)), untested-and-depended-on, unresolved summary |
| `.strata/QUESTIONS.md` | everything the tool could not determine inside the repository, one line each with `file:line` and a reason |

`.strata/` writes its own `.gitignore`, so the working tree stays clean and no index is needed. Committing the data dir is optional, and now takes an explicit `git add -f .strata`: that is the cost of it not polluting every status and blast you run without it.

## Checks

```bash
npm test           # node:test, real temp git repos, no mocks
npm run check      # tsc --noEmit --checkJs; emits nothing
npm run dead-code  # fallow: unused exports, files, dependencies
npm run health     # fallow: complexity, duplication, maintainability (report only)
```

The type check and the analysers are separate from `npm test` on purpose: the suite runs on bare Node, so it never depends on the toolchain being installed.

A `pre-push` hook and a GitHub Actions workflow run the same gates. The hook is opt-in per clone, so nothing runs until you ask for it:

```bash
git config core.hooksPath .githooks
```

Bypass it with `git push --no-verify`; CI runs the same commands either way. The hook skips itself when no dev toolchain is installed, since this repo ships zero runtime dependencies and `npm install` is optional.

## Landing changes

`main` is protected: it takes a pull request, and all three `check` jobs must pass before the merge. `enforce_admins` is on, so this applies to maintainers too — the branch cannot be pushed to directly.

```bash
git switch -c <topic>
# ... commit ...
git push -u origin <topic>
gh pr create --fill
gh pr merge --squash    # once the checks are green
```
