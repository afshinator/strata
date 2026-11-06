#!/usr/bin/env node
// Session log statistics. Every figure comes from a structured field, never from reading
// output text: a tool call joins its result by `toolCallId`, and a failure is `isError`.
// Positional pairing is wrong: a result can appear before its call in the log.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HEREDOC = /<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/;
const REDIRECT = /(?:^|[^&>])>>?\s*([^\s;&|)>]+)/g;
const SLEEP = /(^|\n)[ \t]*sleep[ \t]+\d/;

// Heredoc file-rewrite rule: one bash command is one rewrite when a single line carries
// both a `<<` opener and a redirect to a plain path, so the heredoc body becomes that
// path's content. `/dev/null`, `/dev/fd/*`, `&N` and `>&N` write nowhere, so they are not
// rewrites, and a redirect on a different line than the opener is a different statement.
function isHeredocRewrite(command) {
  for (const line of command.split("\n")) {
    if (!HEREDOC.test(line)) continue;
    for (const match of line.matchAll(REDIRECT)) {
      const target = match[1];
      if (target === "/dev/null" || target.startsWith("/dev/fd/")) continue;
      return true;
    }
  }
  return false;
}

// A sleep counts only when it comes before the `gh pr checks` it was meant to wait for.
function sleepsBeforeChecks(command) {
  const sleep = SLEEP.exec(command);
  const checks = command.indexOf("gh pr checks");
  return sleep !== null && checks !== -1 && sleep.index < checks;
}

function newestSessionLog() {
  const root = join(homedir(), ".pi", "agent", "sessions");
  let best = null;
  for (const dir of readdirSync(root)) {
    let names;
    try {
      names = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(root, dir, name);
      const mtime = statSync(path).mtimeMs;
      if (!best || mtime > best.mtime) best = { path, mtime };
    }
  }
  if (!best) throw new Error(`no *.jsonl under ${root}`);
  return best.path;
}

function readEntries(path) {
  const calls = new Map();
  const results = new Map();
  const usage = [];
  const stamps = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message ?? {};
    const stamp = message.timestamp ?? entry.timestamp;
    if (stamp) stamps.push(stamp);
    if (message.usage) usage.push(message.usage);
    if (message.role === "toolResult") {
      results.set(message.toolCallId, message);
      continue;
    }
    for (const block of message.content ?? []) {
      if (block?.type === "toolCall") calls.set(block.id, { name: block.name, args: block.arguments ?? {} });
    }
  }
  return { calls, results, usage, stamps };
}

export function statsOf(path) {
  const { calls, results, usage, stamps } = readEntries(path);
  const byTool = new Map();
  const errors = new Map();
  let heredocs = 0;
  let sleeps = 0;
  let failedEdits = 0;
  let joined = 0;
  for (const [id, call] of calls) {
    byTool.set(call.name, (byTool.get(call.name) ?? 0) + 1);
    const result = results.get(id);
    if (result) joined += 1;
    if (result?.isError) {
      errors.set(call.name, (errors.get(call.name) ?? 0) + 1);
      if (call.name === "edit") failedEdits += 1;
    }
    if (call.name !== "bash") continue;
    const command = String(call.args.command ?? "");
    if (isHeredocRewrite(command)) heredocs += 1;
    if (sleepsBeforeChecks(command)) sleeps += 1;
  }
  const ordered = [...byTool.keys()].sort();
  const tokens = usage.reduce((sum, u) => sum + (u.totalTokens ?? 0), 0);
  const cost = usage.reduce((sum, u) => sum + (u.cost?.total ?? 0), 0);
  const sorted = [...stamps].sort();
  return {
    calls: calls.size,
    joined,
    byTool,
    ordered,
    errors,
    failedEdits,
    heredocs,
    sleeps,
    tokens,
    cost,
    first: sorted[0],
    last: sorted[sorted.length - 1],
  };
}

function format(path) {
  const s = statsOf(path);
  const errorLine = s.ordered
    .map((name) => `${name} ${s.errors.get(name) ?? 0}`)
    .join(", ");
  const spanMs = Date.parse(s.last) - Date.parse(s.first);
  const lines = [
    `calls                 ${s.calls}  (${s.joined} joined to a result)`,
    ...s.ordered.map((name) => `tool ${name}`.padEnd(22) + String(s.byTool.get(name))),
    `errors                ${[...s.errors.values()].reduce((a, b) => a + b, 0)}  (${errorLine || "none"})`,
    `failed edit calls     ${s.failedEdits}`,
    `heredoc rewrites      ${s.heredocs}`,
    `sleep before checks   ${s.sleeps}`,
    `totalTokens           ${s.tokens}`,
    `usage.cost.total      ${s.cost.toFixed(6)}  (summed per response, never cumulative)`,
    `span                  ${s.first} .. ${s.last} (${Math.round(spanMs / 1000)}s)`,
  ];
  return lines.join("\n") + "\n";
}

// Reached only as a program, so importing this file from a test runs nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? newestSessionLog();
  process.stderr.write(`session-stats: ${path}\n`);
  process.stdout.write(format(path));
}
