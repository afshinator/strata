const LANG_BY_EXT = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".pyi": "python",
  ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".scala": "scala",
  ".rb": "ruby", ".php": "php", ".cs": "csharp", ".swift": "swift",
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".sql": "sql", ".md": "markdown", ".mdx": "markdown",
  ".yaml": "yaml", ".yml": "yaml", ".json": "json", ".toml": "toml", ".ini": "config",
};

// Languages with an import extractor in src/lib/imports.mjs.
export const IMPORT_LANGS = new Set(["typescript", "javascript", "python", "go", "c", "cpp"]);

const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svgz", ".pdf", ".zip", ".gz", ".tgz",
  ".br", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mov", ".mp3", ".wasm", ".so", ".dylib",
  ".dll", ".exe", ".o", ".a", ".jar", ".class", ".pyc", ".lockb", ".sqlite", ".db",
]);

export function langOf(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "other";
  return LANG_BY_EXT[path.slice(dot).toLowerCase()] || "other";
}

export function isBinaryish(path) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && SKIP_EXT.has(path.slice(dot).toLowerCase());
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\//i;
const TEST_NAME = /(\.|-|_)(test|spec)\.[a-z]+$/i;

export function isTest(path) {
  return TEST_PATH.test(path) || TEST_NAME.test(path);
}

/** Language-native test file names for a source file, by convention only. */
export function testCandidates(path) {
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash + 1);
  const base = slash < 0 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot < 0 ? base : base.slice(0, dot);
  const ext = dot < 0 ? "" : base.slice(dot);
  return [
    `${dir}${stem}.test${ext}`,
    `${dir}${stem}.spec${ext}`,
    `${dir}__tests__/${stem}.test${ext}`,
    `${dir}tests/${stem}.test${ext}`,
    `${dir}tests/test_${stem}.py`,
    `${dir}test_${stem}.py`,
    `${dir}${stem}_test.go`,
    `${dir}${stem}_test.rb`,
  ];
}
