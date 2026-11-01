#!/usr/bin/env node
import { index } from "../src/commands/index.mjs";
import { blast } from "../src/commands/blast.mjs";
import { status } from "../src/commands/status.mjs";

const USAGE = `strata — deterministic codebase index

  strata index [--root <dir>] [--quiet]     build .strata/index.json + MAP.md (0 tokens)
  strata blast [--since <rev>] [--depth N] [--json]
                                            what depends on what changed (0 tokens)
  strata status                             staleness, drift, next command

  --root <dir>   analyze another directory
  --data-dir     default <root>/.strata

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
const root = args.root ? args.root : process.cwd();

switch (cmd) {
  case "index":
    process.exitCode = index(root, args);
    break;
  case "blast":
    process.exitCode = blast(root, args);
    break;
  case "status":
    process.exitCode = status(root, args);
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
