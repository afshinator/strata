# strata — non-code artifacts: deterministic tooling research

Scope: what `strata` should depend on to index and check **documentation and prose** without an LLM, fast, offline.
Method: every number below was **measured**, not quoted — 1,001 markdown files / 3.9 MB generated corpus (`/tmp/corpus`), plus a second `/tmp/tooldrift` fixture for doc-vs-code checks, macOS arm64. Versions from installed binaries or `gh api`. Anything not executed is marked UNVERIFIED.

**Bottom line:** prose is tractable deterministically, and cheaply — the six tools below cover structure, links, terminology, spelling, structural queries, and near-duplicates, all offline, ~1 s per 1k files combined (excluding near-dup). Doc-vs-code drift needs 2 npm devDeps + stdlib, and belongs in the *target repo's* CI, not inside `strata`.

---

## 1. Prose linting and terminology

| Tool | Ver | Custom term list | JSON | Licence | Offline | 1k files |
|---|---|---|---|---|---|---|
| **vale** | 3.26.0 | **yes** — `Vocab` dirs with `accept.txt`/`reject.txt` | `--output=JSON` (`{Check,Message,Severity,Line,Span,Match}`) | MIT | yes | **0.42 s** |
| textlint + `textlint-rule-prh` | 15.8.0 / 6.1.1 | yes — `prh.yml` → `expected` + `patterns[]`, autofix ranges | `-f json` | MIT | yes | 1.14 s |
| proselint | 0.16.0 | no | `-o json` | BSD-3 | yes | 2.08 s |
| typos | 1.51.1 | extend-words / extend-identifiers | `--format json` (NDJSON) | MIT/Apache-2.0 | yes | **0.05 s** |
| codespell | 2.x | `-L` ignore list, `-D` dict | **no JSON** | GPL-2.0 | yes | 0.38 s |
| cspell | 10.4.0 | `words`/`flagWords`/`ignoreWords` | only via `@cspell/cspell-json-reporter` | MIT | yes | startup ~0.5 s, **file selection broken in every invocation tried: "Files checked: 0"** |
| LanguageTool | 15.2k★ | wordlists (UNVERIFIED detail) | HTTP JSON | LGPL-2.1 | local JVM server | minute class |
| redpen | 1.10.4, **2020-01-05** | — | — | Apache-2.0 | yes | dead |
| retext + plugins | plugin family | no | no CLI JSON | MIT | yes | programmatic only |

Verified behaviour that matters: vale `reject.txt` containing `config-schema` flags **both** `config-schema` and `ConfigSchema` with `Line`+`Span`; `accept.txt` suppresses known-good forms. That is exactly the "same concept, three spellings" case, with positions.

**Pick: vale** (rule YAML + vocabularies + JSON + 0.42 s). **`typos`** as a second pass because it is 8× faster and catches typos vale's style rules miss.

## 2. Markdown structure extraction (positions are the deciding factor)

| Tool | Machine-readable AST | Positions | Licence |
|---|---|---|---|
| **unified/remark mdast** | JS object | **native `position.{start,end}.{line,column,offset}` on every node** | MIT |
| comrak 0.59.0 | `-t xml` only (no JSON AST flag) | `--sourcepos`, in attrs | BSD-2 |
| markdown-it 14 | token stream | `token.map = [startLine,endLine]`, 0-based, **no columns** | MIT |
| pandoc 3.8.2 | `-t json` | **none by default**; `+sourcepos` works only on `commonmark_x`/`gfm` and emits `data-pos` strings plus `wrapper` spans | GPL-2.0 |
| goldmark | Go AST | yes (README:28), library only | MIT |
| pulldown-cmark | event stream | **byte offsets only**, no lines | MIT |
| tree-sitter-markdown | CST | byte + point ranges | MIT |

**Pick: mdast.** It is the only option with real line/column/offset on every node and no reader-extension trap. `pandoc` is the wrong base — no positions by default, and positions are strings, not numbers.

## 3. Link and anchor integrity, offline

| Tool | Offline paths | Offline anchors | Needs network | JSON | 1k files |
|---|---|---|---|---|---|
| **lychee** 0.24.2 | yes | **yes** (`--offline --include-fragments=anchor-only`) | no | `--format json` (`error_map`, `duration`) | **0.09 s / 0.19 s with anchors** (1,970 unique links) |
| remark-validate-links 13.1.0 | yes | same-file only on CLI; cross-file needs engine `fileSet` (`lib/index.js:339`) | no, but **requires a git repo with a remote** (crashes otherwise) | vfile messages | **23.0 s** |
| markdown-link-check 3.15.0 | no | no | **yes** | reporters | network-bound |
| muffet | no (URL input) | `--ignore-fragments` opt-out | **yes** | `--format=json` | network-bound |
| mdbook-linkcheck | yes (rendered HTML) | yes | no | via mdbook | needs `mdbook build` first |

Verified messages: lychee → `Cannot find fragment` for `#sub-99`, `File not found` for `./nope.md`. remark-validate-links → `README.md 25:5-25:43 Cannot find file`, and needs `--frail` for a non-zero exit.

**Pick: lychee.** 100× faster than remark-validate-links, not git-coupled, and the only one that does both anchors and paths offline.

## 4. Structural queries over prose

| Tool | Markdown grammar | Positions | JSON | Verdict |
|---|---|---|---|---|
| **ast-grep** 0.51.0 | **yes** — `Markdown` and `Html` are built-in languages | `range.start.{line,column}`, `byteOffset`, `metaVariables` | `--json` | verified `ast-grep run -l md -p '## $X'` returns the H2 node |
| comby 1.8.1 | **no** markdown grammar, last release 2022-06-28 | — | yes | reject: degrades to `-generic` text matching |
| semgrep 17.4k★ | markdown as first-class target UNVERIFIED | — | `--json` | skip |
| ripgrep 14 | line-based only | `--json` | — | keep for the fast long tail, not structure |

**Pick: ast-grep.** It answers "every H2 must be followed by a paragraph" structurally instead of regex-on-lines.

## 5. Near-duplicate prose (optional)

| Tool | Determinism | Measured |
|---|---|---|
| **simhash** (pypi) | fixed md5 hashfunc, no RNG | build 0.83 s for 5k docs |
| **datasketch** `MinHash(seed=1)` + `MinHashLSH` | deterministic default seed | build 7.5 s pure-Python; LSH insert+query **0.04 s** |
| rapidfuzz `process.cdist(workers=-1)` | deterministic | 250k pairs / **1.42 s** → 5,000 docs pairwise (12.5M pairs) ≈ 45–70 s |
| difflib | deterministic | O(n·m) per pair → hours. Not viable |

Complexity: pairwise is n(n−1)/2; LSH/simhash bucket first, then exact-verify. **Defer to phase 3** — doc duplication is real but nobody's first question.

## 6. Doc-vs-code drift: what actually proves it

Verified by execution in `/tmp/tooldrift`:

| Code | Mechanism | Verified signal | Cost |
|---|---|---|---|
| D1 | **api-extractor** `run` (never `--local`) with committed `etc/*.api.md` | `Warning: You have changed the API signature... copy temp/x.api.md to etc/x.api.md`, **exit 1** | 1 devDep |
| D2 | **typedoc** `--treatValidationWarningsAsErrors` | `Failed to resolve link to "./missing-file.ts" in comment for greet`, **exit 4** | 1 devDep |
| D3 | `python -m doctest $(git ls-files '*.md')` | `File "README.md", line 14`, exit 1 — **real line numbers** | stdlib |
| D4 | 40-line script: render `--help` → diff fenced block; markdown paths exist; `process.env` reads vs `.env.example` | `DRIFT: CLI.md usage block does not match 'widget --help'`, exit 1 | stdlib |
| D5 | **ast-grep** resolves every backticked `Foo.bar()` / `--flag` to a definition | `src/widget.ts:1:`, exit 1 on no match | 1 devDep, optional |

Rejected/limited: `pyright --verifytypes` needs an installed package + activated venv (else 0%, exit 1) and produces a score, not a diff; rustdoc JSON is nightly-only; `pydoc-markdown` is a generator with no check mode; `helm-docs` last released 2024-07; `sqlfluff` cannot detect doc drift; **`npm i oasdiff` installs a `0.0.1-security` placeholder from an unrelated maintainer** (use the Go release).

Cheap 80%, no build step: `git diff --exit-code` on an existing `.api.md`/committed `.d.ts`, stdlib doctest, two `rg` one-liners for paths and env keys.

---

## 7. What this means for `strata`

### D1 — strata runs the fast tier itself, and only reads the slow tier
Three-second budget for `strata index`, so strata *invokes* only sub-second offline tools: `lychee` (0.2 s), `vale` (0.4–5 s depending on style set), `typos` (0.05 s), `ast-grep` (ms), and its own mdast walk.
Anything needing a build or a toolchain (`api-extractor`, `typedoc`, doctest, `tsc`) is **never executed by strata**. Strata reads the committed artifacts (`.api.md`, `.d.ts`, `coverage/lcov.info`, vale/lychee JSON if present) and reports them as evidence with a timestamp. This is the difference between an indexer and a CI system, and it is why UA's build-step-in-a-skill design is so fragile (`pnpm --filter core build` on a fresh install, then issue #704 when `dist` goes stale).

### D2 — Prose edges get their own provenance tiers
Same tier vocabulary as code, but honestly named for what prose allows:

| Tier | Meaning | Produced by |
|---|---|---|
| `declared` | the document says so (links, wikilinks, frontmatter `owner`, ADR status) | mdast walk |
| `checked` | a deterministic tool passed/failed on it | lychee, vale, typos, doctest, api-extractor |
| `extracted` | a parser derived it (headings, code fences, tables, terms) | mdast, ast-grep |

No `llm` tier exists for docs in phase 1. If it ever does, it must never mix into a `checked` answer.

### D3 — The four doc facts worth surfacing
1. **Broken references** — file paths and in-repo anchors that do not resolve (`lychee --offline --include-fragments`). Cheapest high-value check in the whole tool.
2. **Doc drift vs code** — public API changed, `etc/*.api.md` not regenerated; `--help` output not matching the README block; a doc referencing a symbol/flag that no longer exists (`ast-grep`). This is the capability UA has none of.
3. **Terminology inconsistency** — one concept, three spellings, across `docs/` *and* code identifiers (`vale` vocab + `typos extend-identifiers`). Deterministic, positional, and genuinely annoying to catch by hand.
4. **Structure/coverage** — headings, orphan docs (no inbound link), docs with no owner in frontmatter/CODEOWNERS, exported symbols with zero mention in docs (`api.md` as the allowlist, `rg` for the doc mentions).

### D4 — Deliberately out of scope
Wiki entity/claim extraction, community clustering, Figma/design graphs, "business domain flows", LLM prose summaries, prose embeddings, near-dup scanning (phase 3). Each is either unverifiable or a different product.

### D5 — Artifact
Docs join the same `index.json` with edge kinds `links_to`, `anchors`, `documents` (doc → code symbol/path), `terminology`, `owner`. `MAP.md` gains a "Docs" section: broken refs, drift findings, undocumented exports, terminology hits — each with `file:line` and a tier tag. `strata blast` gains doc impact: "changing `invoice.ts:210` invalidates 3 doc claims in `docs/billing.md:41,58,77`".

---

## Risks

- **R1** vale's 0.42 s is with the built-in `Vale` style only; Microsoft/Google/Readability rule sets scale linearly with rule count — budget 2–5 s/1k files. Make the style set a config choice, not a default.
- **R2** Doctest's markdown fence trap (the closing ```` ``` ```` parsed as expected output) produces false failures and gets the check switched off. Needs a blank line before the closing fence, or a runner that strips fences.
- **R3** Non-reproducible generators make CI red daily: cobra's dated footer (needs `DisableAutoGenTag`), help2man's `.TH` date (needs `SOURCE_DATE_EPOCH`).
- **R4** api-extractor `--local` silently rewrites the report and exits 0 — masks drift completely.
- **R5** `cspell`'s file selection returned "0 files checked" in every invocation tried; do not adopt it for path selection without re-verifying.
- **R6** Line-number quality is uneven across tools: ast-grep, doctest, diff, mdast and remark give real lines; typedoc, tsc and api-extractor give paths only; oasdiff gives the spec file only. Any report that claims `file:line` uniformly is lying.

## UNVERIFIED

LanguageTool rule/wordlist mechanics and runtime; redpen JSON output; sphinx doctest builder; muffet version; `entangled` project identity (no repo found); semgrep markdown support; rustdoc JSON and `cargo public-api` (no Rust toolchain); `clap_mangen` and `openapi-diff`/`buf`/`graphql-inspector` flags (docs-read only).
