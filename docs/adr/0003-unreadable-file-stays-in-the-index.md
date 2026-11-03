# A file that cannot be read stays in the Index

A tracked file above the size limit was skipped before its metadata was read, so
it never reached `files`. The Blast command then reported it as Unindexed and
advised running `strata index`, which drops it again — permanent, silent
invisibility.

The decision is that a file version control tracks is part of the graph whether
or not its contents are read: it stays in `files` with `lines: null`, and raises
one Unresolved entry naming its size. The size cap itself stands; a 20 MB blob
is still not parsed.

Anything that assumes `lines` is a number is now wrong. `files` also contains
filenames with no parsed content by design, so a count of "files we understood"
is not `files.length`.
