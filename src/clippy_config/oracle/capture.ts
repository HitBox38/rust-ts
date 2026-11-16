// Writes src/clippy_config/oracle/de.oracle.json from the pinned clippy-preview tarball (plan-m8 D2), for de.test.ts and
// conf.test.ts. Not a test and not ported code: run it by hand after a pin change.
//   bun src/clippy_config/oracle/capture.ts
// It runs the oracle clippy-driver on a one-line crate with a scratch clippy.toml (CLIPPY_CONF_DIR) and records:
// - `value_lists`: the "possible values" notes, raw from `--error-format=pretty-json` (render_pretty = true) at several
//   `--diagnostic-width`s and from `--error-format=json` (render_pretty = false), for clippy.toml's field names
//   (`ConfField::SUGG_NAMES`), `SourceItemOrderingModuleItemKind`'s 17 names and `InherentImplLintScope`'s 3;
// - `suggestions`: the "did you mean" of an unknown field name or a bad enum value (`find_closest_match`), or null;
// - `explain`: `cargo-clippy --explain <lint>` stdout (`sanitize_explanation` and `ConfMetadata`'s `Display`).
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, die } from "../../../scripts/lib/common.ts";

const host = process.env.RUST_TS_HOST_TUPLE ?? "aarch64-apple-darwin";

function clippyBin(name: string): string {
  const root = join(DATA, "tools");
  for (const d of existsSync(root) ? readdirSync(root) : []) {
    const dir = join(root, d, `clippy-nightly-${host}`);
    const bin = join(dir, "clippy-preview", "bin", name);
    if (existsSync(bin) && readFileSync(join(dir, "git-commit-hash"), "utf8").trim() === PIN.commit) return bin;
  }
  die(`no clippy-preview for ${PIN.commit} under ${root}`);
}

const env0 = { ...process.env, RUSTUP_AUTO_INSTALL: "0" };
const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: env0 }).stdout.toString().trim();
const env = { ...env0, DYLD_LIBRARY_PATH: join(sysroot, "lib") };
const work = mkdtempSync(join(DATA, "tmp", "clippy-config-oracle-"));
writeFileSync(join(work, "a.rs"), "fn main() {}\n");

interface JsonDiag {
  message: string;
  children: { message: string; spans: { suggested_replacement: string | null }[] }[];
}

function run(toml: string, args: string[]): JsonDiag[] {
  writeFileSync(join(work, "clippy.toml"), toml);
  const p = Bun.spawnSync([clippyBin("clippy-driver"), "--sysroot", sysroot, join(work, "a.rs"), "--emit=metadata", "--out-dir", work, ...args], {
    env: { ...env, CLIPPY_CONF_DIR: work },
    cwd: work,
    stdout: "pipe",
    stderr: "pipe",
  });
  const err = p.stderr.toString();
  const out: JsonDiag[] = [];
  // pretty-json prints one multi-line object per diagnostic; json prints one per line
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = 0; i < err.length; i++) {
    const c = err[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}" && --depth === 0) out.push(JSON.parse(err.slice(start, i + 1)));
  }
  return out;
}

const LISTS: { key: string; toml: string; first: string }[] = [
  { key: "conf_fields", toml: "foobar = 42\n", first: "unknown field name" },
  { key: "module_item_kinds", toml: 'module-item-order-groupings = [["g", ["bogus"]]]\n', first: "expected one of: `extern_crate`" },
  { key: "inherent_impl_lint_scope", toml: 'inherent-impl-lint-scope = "bogus"\n', first: "expected one of: `crate`" },
];
const value_lists: { list: string; width: number; render_pretty: boolean; message: string }[] = [];
for (const l of LISTS) {
  for (const width of [10, 30, 45, 60, 80, 100, 120, 140, 160, 200, 300, 500]) {
    const d = run(l.toml, ["-Zunstable-options", "--error-format=pretty-json", `--diagnostic-width=${width}`]).find((x) => x.message.startsWith(l.first));
    const note = d?.children.find((c) => c.message.startsWith("possible values"));
    if (note === undefined) die(`no possible-values note for ${l.key} at width ${width}`);
    value_lists.push({ list: l.key, width, render_pretty: true, message: note.message });
  }
  const d = run(l.toml, ["--error-format=json"]).find((x) => x.message.startsWith(l.first));
  const note = d?.children.find((c) => c.message.startsWith("possible values"));
  if (note === undefined) die(`no possible-values note for ${l.key} (json)`);
  value_lists.push({ list: l.key, width: 140, render_pretty: false, message: note.message });
}

const FIELD_PROBES = ["foobar", "allow-dbg-in-test", "allow_dbg_in_tests", "ALLOW-DBG-IN-TESTS", "msrvv", "msr", "too-many-line-threshold", "disallowed-method", "blacklisted-name", "third-partyy", "x", "avoid-breaking-exported", "cognitive-complexity"];
const ENUM_PROBES: [string, string][] = [
  ["inherent-impl-lint-scope", "crat"],
  ["inherent-impl-lint-scope", "Crate"],
  ["inherent-impl-lint-scope", "modul"],
  ["inherent-impl-lint-scope", "zzzzzzzz"],
  ["matches-for-let-else", "nver"],
  ["matches-for-let-else", "all_types"],
  ["matches-for-let-else", "welknowntypes"],
  ["trait-impl-item-order", "alphabetic"],
  ["trait-impl-item-order", "trait-item-ordering"],
];
const suggestions: { kind: "field" | "enum"; field: string; value: string; names: string; suggestion: string | null }[] = [];
for (const k of FIELD_PROBES) {
  const d = run(`${k} = 1\n`, ["--error-format=json"]).find((x) => x.message === "unknown field name");
  if (d === undefined) die(`no unknown-field error for ${k}`);
  const s = d.children.find((c) => c.message === "did you mean");
  suggestions.push({ kind: "field", field: k, value: "", names: "conf_fields", suggestion: s?.spans[0]?.suggested_replacement ?? null });
}
for (const [field, value] of ENUM_PROBES) {
  const d = run(`${field} = "${value}"\n`, ["--error-format=json"]).find((x) => x.message.startsWith("expected one of"));
  if (d === undefined) die(`no enum error for ${field} = ${value}`);
  const s = d.children.find((c) => c.message === "did you mean");
  suggestions.push({ kind: "enum", field, value, names: field, suggestion: s?.spans[0]?.suggested_replacement ?? null });
}

const EXPLAIN = [
  "absolute_paths",
  "approx_constant",
  "arbitrary_source_item_ordering",
  "disallowed_methods",
  "doc_markdown",
  "excessive_nesting",
  "explicit_auto_deref",
  "inline_asm_x86_intel_syntax",
  "items_after_statements",
  "large_stack_frames",
  "macro_metavars_in_unsafe",
  "min_ident_chars",
  "missing_enforced_import_renames",
  "module_name_repetitions",
  "non_canonical_partial_ord_impl",
  "nonstandard_macro_braces",
  "option_env_unwrap",
  "renamed_function_params",
  "self_named_module_files",
  "string_slice",
  "too_many_lines",
  "trivially_copy_pass_by_ref",
  "uninhabited_references",
  "unreadable_literal",
  "upper_case_acronyms",
  "wildcard_imports",
];
const explain: { lint: string; stdout: string }[] = [];
for (const lint of EXPLAIN) {
  const p = Bun.spawnSync([clippyBin("cargo-clippy"), "clippy", "--explain", lint], { env, cwd: work, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) die(`cargo-clippy --explain ${lint} exited ${p.exitCode}: ${p.stderr.toString().slice(0, 200)}`);
  explain.push({ lint, stdout: p.stdout.toString() });
}

const out = join(import.meta.dir, "de.oracle.json");
writeFileSync(out, JSON.stringify({ commit: PIN.commit, value_lists, suggestions, explain }, null, 1) + "\n");
console.log(`wrote ${out}: ${value_lists.length} value lists, ${suggestions.length} suggestions, ${explain.length} explanations (scratch: ${work})`);
