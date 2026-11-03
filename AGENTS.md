# strata

Deterministic codebase index. See `README.md`.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `afshinator/strata`, managed with the `gh` CLI. Read `docs/agents/issue-tracker.md` before any `gh` write — create, edit, close, label — because the flag names are not guessable and a wrong one can empty a body.

### Triage labels

Five canonical triage roles, label string equal to role name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the repo root, `docs/adr/` for decisions. `GLOSSARY.md` exists and is the source of truth for domain vocabulary; read the ADRs that touch the area you are about to work in before changing it. See `docs/agents/domain.md`.
