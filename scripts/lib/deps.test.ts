// Tests of the oracle cache key's dependency part (scripts/lib/deps.ts, scripts/difftest.ts `cachePath`).
// Every case lives in a fresh temp dir; RUST_TS_DATA points at a temp dir too, so the shared oracle
// cache is never touched. The old RUST_TS_DATA comes back after the file (environment hygiene). Modules
// already loaded keep the temp path (scripts/lib/common.ts reads it once, at import), which is why the gate
// runs the scripts/harness tests in a process of their own (gate.ts `staticChecks`).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const DATA = mkdtempSync(join(tmpdir(), "rust-ts-deps-data-"));
const OLD_DATA = process.env.RUST_TS_DATA;
process.env.RUST_TS_DATA = DATA;
const { caseDeps, scanSource } = await import("./deps.ts");
const { cachePath } = await import("../difftest.ts");
const { PIN, ORACLE_CACHE, hash } = await import("./common.ts");
import type { Case, Suite } from "../../harness/suites.ts";

const dirs: string[] = [DATA];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  if (OLD_DATA === undefined) delete process.env.RUST_TS_DATA;
  else process.env.RUST_TS_DATA = OLD_DATA;
});

/** A fresh tree with `files` (path -> text). */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "rust-ts-deps-"));
  dirs.push(root);
  for (const [p, text] of Object.entries(files)) put(root, p, text);
  return root;
}
function put(root: string, p: string, text: string): void {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), text);
}

/** A suite whose oracle is not rustc and does not exist, so `oracleVersion` is `PIN.commit` (no oracle needed). */
const suiteAt = (cwd: string): Suite => ({
  name: "deps-test",
  milestone: "-",
  description: "",
  mode: "single",
  timeoutMs: 1,
  cwd,
  cases: () => [],
  oracle: () => [join(cwd, "no-such-oracle")],
  subject: () => [],
});
const caseOf = (file: string): Case => ({ id: file, file, args: [file] });
/** The cache key (file name) of `file` in a suite rooted at `cwd`, as `runOracle` computes it. */
function key(cwd: string, file: string): string {
  const c = caseOf(file);
  return cachePath(suiteAt(cwd), c, hash(readFileSync(join(cwd, file))), caseDeps(cwd, file, c.env));
}
const paths = (cwd: string, file: string) => caseDeps(cwd, file).map(([p]) => p);

describe("cache key", () => {
  test("uses a temp oracle cache", () => {
    expect(ORACLE_CACHE.startsWith(DATA)).toBe(true);
  });

  test("a case that reads no other file keeps its old key", () => {
    const r = tree({ "t/a.rs": "fn main() { let s = \"include path\"; }\nmod inline { fn f() {} }\n" });
    expect(caseDeps(r, "t/a.rs")).toEqual([]);
    const c = caseOf("t/a.rs");
    const old = hash(JSON.stringify([PIN.commit, PIN.commit, "deps-test", c.id, c.args, hash("fn main() { let s = \"include path\"; }\nmod inline { fn f() {} }\n")]));
    expect(key(r, "t/a.rs")).toBe(join(ORACLE_CACHE, old.slice(0, 2), old));
  });

  test("#[path] to a missing file, then present, then changed: three keys", () => {
    // The tests/ui/simd pattern (review harness-w13 B1).
    const src = '#[path = "../../auxiliary/minisimd.rs"]\nmod minisimd;\nfn main() {}\n';
    const r = tree({ "tests/ui/simd/a.rs": src });
    const missing = key(r, "tests/ui/simd/a.rs");
    expect(caseDeps(r, "tests/ui/simd/a.rs")).toContainEqual(["tests/auxiliary/minisimd.rs", "-"]);
    put(r, "tests/auxiliary/minisimd.rs", "pub struct Simd;\n");
    const present = key(r, "tests/ui/simd/a.rs");
    put(r, "tests/auxiliary/minisimd.rs", "pub struct Simd2;\n");
    const changed = key(r, "tests/ui/simd/a.rs");
    expect(new Set([missing, present, changed]).size).toBe(3);
    // Removing it again gives the first key back (worktrees flipping the sparse set switch between valid keys).
    rmSync(join(r, "tests/auxiliary"), { recursive: true });
    expect(key(r, "tests/ui/simd/a.rs")).toBe(missing);
  });

  test("out-of-line mod: both candidates, and the files they load", () => {
    const r = tree({ "a.rs": "mod foo;\n" });
    expect(paths(r, "a.rs")).toEqual(["foo.rs", "foo/mod.rs"]);
    const k0 = key(r, "a.rs");
    put(r, "foo/mod.rs", "mod bar;\n");
    expect(paths(r, "a.rs")).toEqual(["foo.rs", "foo/bar.rs", "foo/bar/mod.rs", "foo/mod.rs"]);
    const k1 = key(r, "a.rs");
    put(r, "foo/bar.rs", "");
    expect(new Set([k0, k1, key(r, "a.rs")]).size).toBe(3);
  });

  test("a non-mod.rs module's children are under its stem; inline modules nest", () => {
    const r = tree({ "a.rs": "mod x;\n", "x.rs": 'mod outer { const S: &str = "}"; const C: char = \'}\'; mod y; }\n' });
    const p = paths(r, "a.rs");
    expect(p).toContain("x/outer/y.rs");
    expect(p).toContain("x/outer/y/mod.rs");
    // In a block it would be `outer/y.rs` (no `relative`): probed too.
    expect(p).toContain("outer/y.rs");
  });

  test("#[path] on an inline module sets its directory", () => {
    const r = tree({ "a.rs": '#[path = "sub"]\nmod m { mod z; }\n' });
    expect(paths(r, "a.rs")).toContain("sub/z.rs");
  });

  test("include macros: literal paths, include! targets scanned", () => {
    const r = tree({ "d/a.rs": 'const S: &str = include_str!("data.txt");\ninclude!("inc.rs");\n', "d/inc.rs": "mod w;\n" });
    const p = paths(r, "d/a.rs");
    expect(p).toEqual(["d/data.txt", "d/inc.rs", "d/w.rs", "d/w/mod.rs"]);
    const k0 = key(r, "d/a.rs");
    put(r, "d/data.txt", "x");
    expect(key(r, "d/a.rs")).not.toBe(k0);
  });

  test("dynamic include: concat! of literals is a candidate", () => {
    const r = tree({ "a.rs": 'include!(concat!("aux/", "x.rs"));\n' });
    expect(paths(r, "a.rs")).toContain("aux/x.rs");
    const k0 = key(r, "a.rs");
    put(r, "aux/x.rs", "fn f() {}\n");
    expect(key(r, "a.rs")).not.toBe(k0);
  });

  test("mod $name; lists the module directory, so any new module file changes the key", () => {
    const r = tree({ "t/a.rs": "macro_rules! m { ($n:ident) => { mod $n; } }\nm!(q);\n" });
    const k0 = key(r, "t/a.rs");
    expect(paths(r, "t/a.rs")).toContain("t/");
    put(r, "t/q.rs", "");
    expect(key(r, "t/a.rs")).not.toBe(k0);
  });

  test("modules of an include!d file are relative to its directory (issue-69838 pattern)", () => {
    const r = tree({ "a.rs": 'include!("sub/inc.rs");\n', "sub/inc.rs": "pub mod bar;\n" });
    // (`sub/sub/inc.rs`: the literal relative to the included file's directory, also a possible call site.)
    expect(paths(r, "a.rs")).toEqual(["sub/bar.rs", "sub/bar/mod.rs", "sub/inc.rs", "sub/sub/inc.rs"]);
  });

  test("a mod declaration in a macro body is followed where the macro is invoked (macro-expanded-mod pattern)", () => {
    const r = tree({
      "t/a.rs": "macro_rules! d { ($i:ident) => { mod $i; } }\nmod helper { d!(foo); }\n",
      "t/helper/foo/mod.rs": "d!(bar);\n",
      "t/helper/foo/bar.rs": "",
    });
    const p = paths(r, "t/a.rs");
    expect(p).toContain("t/helper/foo/mod.rs");
    expect(p).toContain("t/helper/foo/bar.rs");
  });

  test("words in comments and strings are not items (lexer)", () => {
    const s = scanSource('// include!("a.rs")\n/* mod b { mod c; } */\nfn f() { let x = r#"path = "z""#; let l: &\'static str = "mod d {"; }\n');
    // The lexer adds nothing; the raw-text guard still matches `mod c;`, `path = "z"` and `include!("a.rs")`.
    expect(s.chains).toEqual([[]]);
    expect(s.decls.map((d) => [d.name, d.paths])).toEqual([["c", []], [undefined, ["z"]]]);
    expect(s.includes.map((i) => i.lit)).toEqual(["a.rs"]);
  });
});
