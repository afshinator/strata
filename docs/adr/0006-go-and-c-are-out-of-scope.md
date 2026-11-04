# Go and C/C++ are out of scope

ADR-0005 kept every extractor the scaffold shipped and made Rust next. Rust is
now implemented and checked against `rustc` (PR #40, #41). Go and C/C++ were
removed (PR #46), and this record replaces 0005.

Neither language was ever a ticketed feature. Both resolvers arrived in the
scaffold commit `4e85863`, which `git log -S` confirms for `resolveGo` and
`resolveC` independently, and nothing since was written against them except one
clause in `README.md:31`. They also carried no oracle, which is how the C
extractor came to read `#include` lines out of comments and turn a commented-out
include into an Edge (PR #42).

The decision: the supported set is JS/TS, Python and Rust. Go and C/C++ files
stay in the Index as files, counted and unlinked.

Rejected: keeping them behind a plugin boundary. `src/`, `bin/` and
`package.json` contain no plugin mechanism, and building one to preserve two
unowned extractors costs more machinery than the extractors were worth.

The cost is that a Go or C repo now produces no Edges at all. That is not an
exception to ADR-0004's reasoning — it is outside it. ADR-0004 classifies a
*specifier* the tool cannot resolve; here no specifier is extracted, because the
source is never read (`scan.mjs:23` gates reading on the language). So there is
nothing to call broken and nothing to call external. The only signal is the
aggregate `N files have no import extractor` line in the summary, which is the
taxonomy behaviour ADR-0005 described and left in place: the extension map says
what a file *is*, for counting; `IMPORT_LANGS` says what can be *graphed*.

What 0005 got right and 0006 keeps: that split between counting and graphing, and
the note that the per-language cost ranking was an estimate from an earlier
research run rather than a measurement taken in this repository.
