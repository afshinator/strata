# Worked examples in AGENTS.md: do they earn their lines?

Research note for issue #59. Question: does the `# Behavioral Examples` block at
`~/.pi/agent/AGENTS.md:46-56` add behaviour that the rules at `:10-12` and `:15-17` do not,
in this harness, at the position of an always-loaded *global* file?

## Answer

Compress to one line. The block restates rules written eight lines above it, and both
`Not To Do:` halves re-print the exact banned register. The one thing the block adds that
the rules state only abstractly is the *shape of a citation*: name the file, the line, the
consequence, then answer. Fold that into `:11` and delete `:46-56`.

## What the harness does

Package root: `/Users/afshin/.nvm/versions/node/v24.19.0/lib/node_modules/@earendil-works/pi-coding-agent`.

- The agent-directory context file loads first, unconditionally, for every session in every
  project: `dist/core/resource-loader.js:170` (`loadContextFileFromDir(resolvedAgentDir)`),
  `:172` (`contextFiles.push(globalContext)`). Documented at `docs/configuration.md:18`
  ("User instructions applied across working directories") and `:45` ("It does not suppress
  context files from the agent directory or other directories").
- A first-match list per directory: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`,
  `CLAUDE.md`, `CLAUDE.MD` (`dist/core/resource-loader.js:115-116`).
- The content is the raw file, byte for byte: `:126`
  (`content: stripBom(readFileSync(filePath, "utf-8"))`). No summarising, no line cap, no
  pointer substitution: `grep -cE 'truncat|maxChars|MAX_CONTEXT'` over `resource-loader.js`
  and `system-prompt.js` returns **0** in both. (Codex differs: it caps at
  `project_doc_max_bytes`, 32 KiB by default.)
- It is injected verbatim into the system prompt as a path-tagged block
  (`dist/core/system-prompt.js:25-28`), section `project_context` at `:100`. Documented at
  `docs/how-pi-works.md:19`.
- Section diffing (`system-prompt.js:140-152`) stops a *resend* of an unchanged section, but
  the block never leaves the transcript. Verified in the live session log: the first system
  message carries `project_context`, and no later system message carries
  `project_context: null`.
- Measured on the live transcript: `project_context` is 4579 chars of a 22592-char system
  prompt. `skills` is larger at 13420. The examples are about 17% of `project_context`,
  which is 20% of the whole prompt.

## What the harness already instructs

- Two hardcoded rules end the harness's own rules block (`system-prompt.js:63-64`):
  `Be concise in your responses`, `Show file paths clearly when working with files`. So
  `~/.pi/agent/AGENTS.md:16` (Conciseness) partly duplicates a line the harness always sends.
- The harness instructs **no** anti-sycophancy and **no** tone rule:
  `grep -rIoiE 'sycophan[a-z]*|flatter[a-z]*|apolog[a-z]*'` over `dist/` and `docs/` returns
  **0** matches, and the preamble is one sentence. Section 1 at `:10-12` is therefore the only
  anti-sycophancy instruction in context, not a duplicate.

## What the local writing standard says

Source: `/Users/afshin/.agents/skills/writing-for-agents/SKILL.md`. A skill installed on this
machine: primary for local practice, secondary for harness behaviour.

- Negation, `:74`: "steering by prohibition drags the forbidden behaviour into context and
  makes it _more_ available, not less… Prompt the **positive**".
- Duplication, `:78`: "Keep each meaning in a **single source of truth**… **Duplication**
  costs maintenance and tokens, and inflates a meaning's prominence".
- No-ops, `:81`: "an instruction the model already obeys by default pays load to say
  nothing… When a sentence fails, delete the whole sentence".
- Context load, `:24`; sprawl, `:43`.
- The skill has **no** rule for or against worked examples. It forbids the duplication and
  the negative phrasing this block contains, nothing more.

## What vendor sources say

All fetched live with `curl -sL --max-time 20`.

- Anthropic, CLAUDE.md memory doc (https://code.claude.com/docs/en/memory): "target under 200
  lines per CLAUDE.md file. Longer files consume more context and reduce adherence." Phrasing
  guidance is "concrete enough to verify" one-liners, not dialogues.
- Anthropic, best practices (https://www.anthropic.com/engineering/claude-code-best-practices):
  "every line in it takes a little of Claude's attention on every task, whether it's relevant
  or not. That's why the file works best when it only holds what Claude couldn't work out from
  the code itself." Admissible content includes "anything you've had to correct twice already".
- agents.md (https://agents.md): content guidance is one line, "Cover what matters". Precedence
  is directory proximity. No length guidance, no examples-over-rules guidance.
- OpenAI Codex (https://developers.openai.com/codex/guides/agents-md): `project_doc_max_bytes`,
  32 KiB default; closer files override. No guidance on examples.
- GitHub Copilot custom instructions: precedence only; its examples are phrasings of a rule.

Net: **no vendor document recommends worked examples over rules.** Three of four advise
shortening, and all four put a global file *below* project files in precedence.

## Evidence from the sessions

Command and output are reproducible; run in
`~/.pi/agent/sessions/--Users-afshin-Documents-dev-strata--/` over the assistant text blocks,
regex `you.?re right|good catch|great question|my apologies|fair point`.

```
2026-11-01T21-17-49-988Z  textBlocks=375  hits=1
2026-11-02T20-25-09-007Z  textBlocks=2    hits=0
2026-11-02T20-25-09-016Z  textBlocks=2    hits=0
TOTAL                     textBlocks=379  hits=1
```

- The single hit is a false positive: the assistant printing `AGENTS.md:46-56` back to the
  user. Genuine sycophancy: **0 of 379**.
- Template echo check: the model never produced a `**To Do:** / **Not To Do:**` styled reply.
- Three sampled pushbacks already carry evidence in the form the example demonstrates. The
  corpus cannot separate the example from rule `:11` as the cause. That is the honest limit.

## Argument for keeping the examples

`Challenge Incorrect Assumptions` says "factual proof" abstractly; the `To Do:` line shows the
form: file, line, call-site count. Anthropic's "concrete enough to verify" supports showing
over telling.

## Argument against

- Four of the block's six content lines restate `:10`, `:11`, `:15`, `:16` verbatim.
- Both `Not To Do:` halves put the banned sentences into always-on context a second time.
- The examples are the only invented content in the file (`config.go`, `legacy/v1`, Redis) in
  a file otherwise made of machine-specific rules (BSD tools, `gh pr checks --watch`, `/tmp`).
- Empirically unearned in this corpus: 0 of 379, never echoed.
- Weakest possible placement: the global file, lowest precedence, loaded for every project.

## Recommendation for issue #59

Delete `~/.pi/agent/AGENTS.md:46-56` and add one bullet after `:11`:

```diff
 - **Challenge Incorrect Assumptions:** If a prompt contains a technical flaw, false premise, or contradiction, challenge it directly with factual proof before proceeding.
+- **Proof is a citation, not a stance:** name the file, the line, and the consequence, then answer.
 - **No Affirmative Fillers:** Dont answer questions with edits and code changes, answer the question.
```

Net −11 lines, +1 line, −791 +~120 chars. If #59 wants zero new lines, delete `:46-56` with no
replacement; `:11` still says "factual proof".

## Verification of this note

Re-run by hand before it was committed, not taken from the researcher's report:

| claim | result |
|---|---|
| harness hardcodes "Be concise" at `system-prompt.js:63` | confirmed |
| `project_context` injected verbatim, `<project_instructions>` tag | confirmed |
| no truncation or size cap in either file | 0 matches, both files |
| harness says nothing about sycophancy | 0 matches, `dist/` + `docs/` |
| session counts 375 / 2 / 2, one false-positive hit | confirmed |
| Anthropic 200-line and "attention on every task" quotes | confirmed live |
| file size | **4379 chars**, block **791** (the researcher wrote 4365 / 790) |
| OpenAI `/codex/agents-md` returns 404 | **308 redirect**, not 404 |
| earlier count of 373 assistant messages | **wrong**; 375 in the parent session, 379 across three |

## Limit

One model, one user, one repository, six days. No A/B against the block removed exists, so the
causal claim ("the examples prevent sycophancy") is neither supported nor refuted; what is
supported is that the failure they warn about did not occur in 379 samples.
