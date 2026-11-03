# Multiple languages are in scope; Rust is next

The project is a JS/TS tool, but the scaffold commit (`4e85863`) shipped
extractors for Python, Go and C/C++ in the same breath, and `README.md:31`
advertises them. They work: a four-file Python package produces four edges, a
twenty-six-file Go package produces twenty-six. They were never ticketed, and
one earlier review called them "speculative language surface" and proposed
trimming them.

The decision is to keep them and extend the set, rather than delete working and
documented behaviour. Rejected: JS/TS only, which would have meant removing
three extractors, their tests and a README claim to make the code match a
narrower scope nothing had written down.

Rust comes next because its module system is a path-to-file mapping — `use
crate::a::b::Thing` names `a/b.rs` — which is the cheapest of the remaining
languages to resolve. That ranking comes from an earlier research run and is an
estimate, not a measurement; it was never re-verified, and no per-language cost
has been timed in this repository.

The consequence worth recording: `lang.mjs` now serves two jobs. The extension
map says what a file *is*, for counting. `IMPORT_LANGS` says what can be
*graphed*. A language in the first and not the second is counted, never linked,
and the run says so under "no import extractor".
