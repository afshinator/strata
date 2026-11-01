---
name: strata
description: Answer "what depends on what", "what breaks if I change this", and "how is this area shaped" from a deterministic local index instead of reading or grepping the whole codebase. Use before exploring an unfamiliar repo, before committing a change, when scoping a review, or when asked about blast radius, architecture, reading order, or test coverage of a symbol.
---

# strata

A deterministic index of the repo's import graph, churn, owners, and test mapping. No LLM in the index path, no server, no build step.

## Use it before reading code

| Instead of | Run |
|---|---|
| opening files to find who uses something | `strata blast --json` after `--since <rev>` |
| reading a README to learn the repo | read `.strata/MAP.md` (generated, ~150 lines) |
| grepping for "is this tested" | `strata blast` lists affected tests; `MAP.md` lists untested fan-in |
| guessing whether the index is current | `strata status` |

## Commands

```bash
strata index [--root <dir>] [--quiet]    # 0 tokens; writes .strata/{index.json,MAP.md,QUESTIONS.md}
strata blast [--since <rev>] [--depth N] [--json] [--sketch]
strata status
```

- Default `strata index` target is `$PWD`. Never pass `--root` pointing at another worktree: index the tree you are actually editing.
- `blast` with no `--since` uses the working tree (dirty + untracked).
- `blast --depth 2` when a change touches a shared module.
- `blast --json` when feeding another skill (`code-review`, `tdd`).

## Rules

1. **Run `strata index` first, once per session, only if `.strata/index.json` is missing or `strata status` reports pending files.** Do not re-index after every edit.
2. **Read the tier before trusting an edge.** `regex` means relative/computed imports can be missed; bare specifiers are intentionally unresolved (see `QUESTIONS.md`). Say so when reporting, rather than presenting a regex graph as compiler truth.
3. **Cite `file:line`.** `blast` and `QUESTIONS.md` give paths and lines; `MAP.md` gives the shape. Never summarise the index without a citation.
4. **Report what was not analysed.** `QUESTIONS.md` and the untracked/not-indexed note in `blast` are part of the answer, not noise.
5. **Do not add a dashboard.** For a picture, render the answer with `show-me` (importer tree, call tree, `diff`), not with a server.
6. **Do not store prose in the index yet.** `ask`/`describe` are not built. Any semantic claim belongs in the conversation with a citation, not in `.strata/`.
7. **Never auto-run.** No hooks, no commit triggers. If the index is stale, say so and offer to refresh.

## Output shape

`strata index` prints counts and the next command. `MAP.md` sections in order: numbers, entry points, fan-in table, dependency-first reading order, cycles, hotspots, untested-and-depended-on, unresolved summary.

`strata blast` prints changed files, direct importers, tests, owners, and a per-file risk line (`HIGH` at fan-in ≥ 20 or churn ≥ 30, `MEDIUM` at fan-in ≥ 5 or churn ≥ 10).

## Verify

```bash
node --test          # in the strata repo
strata index --root <this repo> && strata status
```
