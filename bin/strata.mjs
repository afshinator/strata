#!/usr/bin/env node
import { index } from "../src/commands/index.mjs";
import { blast } from "../src/commands/blast.mjs";
import { status } from "../src/commands/status.mjs";
import { toplevel } from "../src/lib/git.mjs";

const USAGE = `strata — deterministic codebase index

  strata index [--root <dir>] [--quiet]     build .strata/index.json + MAP.md (0 tokens)
  strata blast [--since <rev>] [--depth N] [--json] [--sketch]
                                            what depends on what changed (0 tokens)
  strata status                             staleness, drift, next command

  --root <dir>   analyze another directory (default: $PWD)
  --sketch       importer tree instead of a risk table

Tiers: compiler > tree-sitter > regex. Every edge carries its tier.
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
// Accept only the flags a command implements, so a typo fails instead of being ignored.
const FLAGS = {
  index: ["root", "quiet"],
  blast: ["root", "since", "depth", "json", "sketch"],
  status: ["root"],
};
const unknown = FLAGS[cmd] ? Object.keys(args).find((k) => k !== "_" && !FLAGS[cmd].includes(k)) : undefined;
if (unknown) {
  process.stderr.write(`strata: unknown flag --${unknown}\n\n${USAGE}`);
  process.exitCode = 2;
} else {
  // git prints paths relative to the worktree root, so the tool must resolve from there too.
  const cwd = process.cwd();
  const root = args.root ? args.root : toplevel(cwd) || cwd;

  switch (cmd) {
    case "index":
      process.exitCode = index(root, args);
      break;
    case "blast":
      process.exitCode = blast(root, args);
      break;
    case "status":
      process.exitCode = status(root);
      break;
    case undefined:
    case "help":
    case "--help":
      process.stdout.write(USAGE);
      break;
    default:
      process.stderr.write(`strata: unknown command '${cmd}'\n\n${USAGE}`);
      process.exitCode = 2;
  }
}
