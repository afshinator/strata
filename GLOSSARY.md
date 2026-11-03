# strata

A deterministic, offline index of one repository's import graph, used to answer "what depends on what" and "what breaks if I change this" without spending model tokens.

## Language

### The graph

**Edge**:
One import from one indexed file to another indexed file. Identity is the `(from, to)` pair, so a file importing one target twice still contributes one edge.
_Avoid_: dependency, link, import link, edge record

**Import site**:
One written occurrence of a specifier in a file, carrying its line number. A file may hold several import sites for a single edge.
_Avoid_: import, occurrence, reference, hit

**Tier**:
How an edge was established, weakest to strongest: `regex`, `tree-sitter`, `compiler`. The index-level tier is the weakest tier among its edges.
_Avoid_: confidence, precision, quality, accuracy level

**Invented edge**:
An edge whose target was chosen by a heuristic instead of resolved from the specifier. Never permitted: a miss is recorded as unresolved rather than papered over.
_Avoid_: fabricated edge, phantom edge, guessed edge, best guess

**Unresolved**:
A specifier that points inside the repository but did not resolve to an indexed file. Recorded with a reason; a result, not a failure.
_Avoid_: broken import, missing import, dangling edge, question, unverified

**External**:
A specifier that does not point inside the repository at all: third-party package, standard library, runtime builtin. Counted as a total, never graphed.
_Avoid_: skipped, ignored, third-party (one kind, not the category), bare specifier (a syntax form, not a classification)

**Fan-in**:
The number of distinct files that import a given file.
_Avoid_: importer count, in-degree

**Fan-out**:
The number of distinct files a given file imports.
_Avoid_: dependencies, out-degree

### The artifacts

**Data dir**:
`.strata/`, holding the index, the map, the questions file, and the lock. Always at the analysed root: the repository top level, or the directory `--root` names.
_Avoid_: cache, output dir, .strata folder

**Index**:
The machine artifact: every indexed file with its facts, every edge, every unresolved specifier.
_Avoid_: graph file, json, database, cache

**Map**:
The generated briefing: numbers, entry points, fan-in table, reading order, unorderable files, hotspots, untested gaps.
_Avoid_: report, summary, dashboard, docs

**Questions**:
The generated list of everything the tool could not determine, one line each with a location and a reason.
_Avoid_: gaps file, open issues, todo, warnings

**Lock**:
An exclusive marker held for the duration of a write so two runs cannot interleave into one data dir. A lock whose holder is gone is stale and gets reclaimed.
_Avoid_: mutex, semaphore, pidfile

### Change detection

**Basis**:
What a blast is measured against: a revision, or the working tree when none is given.
_Avoid_: baseline, diff target, reference point

**Changed**:
A path that differs from the basis, including paths the index does not know about.
_Avoid_: dirty, modified, touched, affected

**Indexed**:
A path present in the index, because version control tracks it at index time.
_Avoid_: known, scanned, covered

**Unindexed**:
A changed path the index does not know about: new, untracked, or ignored.
_Avoid_: untracked (one cause, not the category), unknown

**Blast**:
The indexed files that import a changed file, transitively up to the requested depth, which defaults to one hop. The changed files themselves are not part of it.
_Avoid_: impact, blast radius, reverse closure, dependents

**Reading order**:
A total order in which every file appears after all indexed files it imports. Entry points come last.
_Avoid_: topological order, dependency order, build order

### Risk signals

**Churn**:
The number of commits that touched a file within the window.
_Avoid_: activity, volatility, change frequency

**Owner**:
A commit author email and how many of the window's commits touched a file. Reported as a list, never as a single owner.
_Avoid_: maintainer, author, code owner

**Hotspot**:
Churn weighted by fan-in, ranked as churn × (fan-in + 1), so a frequently changed file still ranks when nothing imports it.
_Avoid_: hotspot score, risk score

**Risk**:
A coarse label (`HIGH`, `MEDIUM`, `LOW`) derived from fan-in and churn thresholds. A prompt to look, not a measurement.
_Avoid_: severity, criticality, danger, score

### Tests

**Test mapping**:
The tests belonging to a source file: a test beside it, else a test that imports it, else one whose name matches under a test directory. Absence means none was found, not that none exists.
_Avoid_: coverage, test coverage, test association
