# A relative specifier that escapes the analysed root is External

A relative import that normalises above the root fails to resolve, so the
obvious classification is Unresolved. Three documents say otherwise: README rule
4 ("a specifier that points outside it is counted as external"), the
`GLOSSARY.md` entry for **External** ("does not point inside the repository at
all"), and the rule that `QUESTIONS.md` holds in-repo misses only. The glossary
also forbids defining External by syntax — its `_Avoid_` line rejects "bare
specifier (a syntax form, not a classification)" — so there is no narrow reading
that keeps the old behaviour.

The decision: normalise the relative path, and when it lands above the root,
count it as External under `not in this repo: outside the analysed root`.

The cost is real and intended: an escaping relative import is often a genuine
bug, and it will no longer be flagged as a broken in-repo import. The tool trades
that signal for a truthful statement — it cannot see the file, so it cannot claim
the import is broken.
