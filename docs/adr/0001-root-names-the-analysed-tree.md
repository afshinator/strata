# `--root` names the analysed tree, not the enclosing repository

Git prints every path from the worktree root, so the obvious implementation of
`--root` is to normalise it through `git rev-parse --show-toplevel`. Rejected:
`--root src/a` would then index the whole repository, and the files would come
from one tree while churn and owners came from another.

The decision is that `--root` *is* the analysed root, and every git command that
prints a path must be rebased onto it. That is why `history` and `changedSince`
pass `--relative` and `dirtyPaths` reads `--show-prefix`. Normalising `--root`
looks like a cleanup; it breaks this decision and a test that enforces it.
