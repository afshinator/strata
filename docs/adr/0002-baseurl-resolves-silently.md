# `baseUrl` resolves silently and never raises an Unresolved entry

`baseUrl` in `tsconfig.json` maps a bare specifier to a directory, which looks
like a `paths` mapping with `*` as the pattern, so the obvious implementation
reuses the alias machinery. Rejected: a catch-all pattern matches *every* bare
specifier, so every third-party package would report "matches a declared pattern
but does not resolve". That is the flood of false Unresolved entries #18 was
opened to remove.

So `baseUrl` is tried as a silent candidate: after `paths`, before workspaces,
returning a hit or nothing. A miss falls through to External.

The consequence is a deliberate asymmetry: a `paths` pattern that matches but
finds no file is Unresolved, while a `baseUrl` miss is External. Only the first
is evidence that the config named something that is missing.
