# T04 — Imports inside comments become real edges

**Priority:** P0
**Status:** open
**Reviews:** R1 S-F5 (R2 missed this; R2 marked "fixture-string suppression" as verified-clean)
**Files:** `src/lib/imports.mjs:91-99`, `src/lib/imports.mjs:111`, `src/lib/imports.mjs:115`

## Symptom

`README.md` design rule 4: "Unresolved is a result, not a failure. … Never an invented edge." A commented-out import is not an import, but the extractor matches it and emits a live edge in the graph, the fan-in table, and the blast closure. `insideString` guards only string literals; `Status` in the README advertises literals as the only guarded false positive, which is accurate and also admits this gap.

## Evidence

```
$ printf '// import b from "./b"\n// import b from "./b"\nexport const d=1;\n' > src/comment.ts
$ node bin/strata.mjs index --quiet
$ node -e 'const d=require("/tmp/v2/.strata/index.json");
            console.log(JSON.stringify(d.edges.filter(e=>e.from==="src/comment.ts")))'
[{"from":"src/comment.ts","to":"src/b.ts","type":"imports","spec":"./b","line":1,"tier":"regex"},
 {"from":"src/comment.ts","to":"src/b.ts","type":"imports","spec":"./b","line":2,"tier":"regex"}]
```

Direct extractor check, including a block comment:

```
$ node -e '...extractImports("typescript", "// import b from \"./b\"\n/* import c from \"./c\" */\n")'
[{"spec":"./b","line":1},{"spec":"./c","line":2}]
```

R1's write-up said one comment line "produced two real edges"; that is wrong — it produces one. Two appear only when two matching lines are present.

## Root cause

`imports.mjs:115` matches `(?:from|require\s*\(|import\s*\()\s*["']...["']` against raw source. `push` at `:111` only rejects matches reported inside a string literal by `insideString` (`:91-99`). Comments are never removed or masked.

## Fix

Blank comments before matching, keeping byte offsets and newlines so `lineIndex` and `insideString` stay valid. The scanner must be string-aware, otherwise `const u = "http://x"` would be truncated at `//`.

```js
function stripComments(source) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const c = source[i];
    if (quote) {
      if (c === "\\") { out += c + (source[i + 1] ?? ""); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " "; i++;
      }
      i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}
```

In `extractImports`, match against `const code = stripComments(source)` and pass `code` to `insideString`. `lineIndex(source)` is unchanged because lengths and newlines are preserved. Keep `insideString` — it is the guard for fixture code written inside a string literal, a separate real case.

`shortcut:` a `//` inside a template literal `${}` expression is treated as a comment; upgrade if that ever bites.

## Verify

- Comment-only import → zero edges, zero unresolved.
- `/* import x from "./y" */` → zero edges.
- `const u = "http://example.com"; import a from "./a";` → the real edge survives, `//` inside the string does not truncate.
- `const s = "import y from \'./y\'"` → still zero edges.
- New tests for all four.
