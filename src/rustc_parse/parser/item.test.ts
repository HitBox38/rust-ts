// Scenario tests for lane parser-item (parser/item.rs): whole crates through the driver,
// `rust-ts --edition=2021 -Zunpretty=ast-tree <case>.rs` (passes::parse -> `parse_crate_mod` ->
// `{krate:#?}`), compared with the pinned nightly rustc byte for byte: stdout (the AST tree), stderr
// (parse diagnostics) and the exit code.
//
// Expectations: `item_oracle.json`, produced by running the oracle on every case:
//   RUST_TS_WRITE_ORACLE=1 bun test src/rustc_parse/parser/item.test.ts
// (needs `rustc +nightly` at the pin; it rewrites the fixture, then the test compares against it).
//
// PENDING: cases whose path reaches code owned by another parser lane (diagnostics.rs, path.rs, ty.rs,
// generics.rs, function.rs, expr.rs, pat.rs, stmt.rs) must stop with exactly the listed `Unported`
// (exit 70, `rust-ts: unported: <what>`) after printing a prefix of the oracle's stdout/stderr. Once
// that lane lands, the case must match the oracle and root drops it from PENDING (a pending case that
// matches fails the test, so nothing passes silently).
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../rust_ts/test_scratch.ts";

interface Case {
  name: string;
  src: string;
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}

const CASES: Case[] = [
  // ---- modules and use trees ----
  { name: "mod_items", src: "mod a;\nmod b {\n    mod c {}\n}\nunsafe mod d {}\n" },
  {
    name: "use_trees",
    src:
      "use std::collections::HashMap;\n" +
      "use std::io::{self, Read as R, Write};\n" +
      "use std::fmt::*;\n" +
      "use ::std::{};\n" +
      "use {a, b::{c, d}};\n" +
      "use a as _;\n" +
      "use ::*;\n" +
      "pub use self::x::y;\n",
  },
  { name: "use_glob_not_last", src: "use a::*::b;\n" },
  { name: "use_single_colon", src: "use a::b:c;\n" },
  { name: "use_attr_in_tree", src: "use a::{#[cfg(x)] b, c};\n" },
  { name: "import_as_use", src: "import std::io;\n" },
  // ---- extern crate ----
  { name: "extern_crate", src: "extern crate std;\nextern crate core as c;\nextern crate self as me;\nextern crate alloc as _;\n" },
  { name: "extern_crate_dashes", src: "extern crate foo-bar-baz;\n" },
  // ---- structs, enums, unions ----
  {
    name: "structs",
    src:
      "struct U;\n" +
      "struct T(pub u8, i32);\n" +
      "struct N {\n    a: u8,\n    pub(crate) b: String,\n}\n" +
      "struct G<T: Clone>(T) where T: Copy;\n" +
      "struct W<T> where T: Copy { t: T }\n" +
      "struct E {}\n",
  },
  { name: "struct_default_fields", src: "struct D {\n    x: u8 = 1,\n    y: i32,\n    z: bool = false,\n}\nstruct P(u8 = 2, i32);\n" },
  { name: "struct_unsafe_field", src: "struct S {\n    unsafe x: u8,\n}\n" },
  { name: "enums", src: "enum E {\n    A,\n    B = 2,\n    C(u8),\n    D { x: i32 },\n    #[attr] F = 1 << 3,\n}\nenum Empty {}\n" },
  { name: "union", src: "union U {\n    a: u32,\n    b: f32,\n}\nunion V<T> where T: Copy { t: T }\n" },
  // ---- traits and impls ----
  {
    name: "traits",
    src:
      "trait T: Clone {\n" +
      "    type A;\n" +
      "    type B: Copy = u8;\n" +
      "    const C: u8;\n" +
      "    const D: u8 = 1;\n" +
      "    fn f(&self);\n" +
      "    fn g() {}\n" +
      "}\n" +
      "auto trait Au {}\n" +
      "unsafe trait Un {}\n" +
      "trait Alias = Clone + Copy;\n" +
      "const trait Ct {}\n",
  },
  {
    name: "impls",
    src:
      "impl S {\n    fn new() -> Self { S }\n    pub fn f(&self) {}\n}\n" +
      "impl Clone for S {\n    fn clone(&self) -> Self { *self }\n}\n" +
      "impl !Send for S {}\n" +
      "default impl<T> X for T {}\n" +
      "const impl Tr for S {}\n" +
      "unsafe impl Send for S {}\n" +
      "impl<T> Tr for Vec<T> where T: Copy {\n    type A = T;\n    const C: u8 = 0;\n    default fn d() {}\n}\n",
  },
  { name: "impl_semi", src: "impl S;\n" },
  { name: "impl_inherent_modifiers", src: "unsafe impl S {}\nimpl !S {}\ndefault impl S {}\n" },
  { name: "impl_missing_trait", src: "impl for S {}\n" },
  { name: "impl_items_pub", src: "impl Tr for S {\n    pub fn f() {}\n    pub const C: u8 = 0;\n}\n" },
  // ---- extern blocks ----
  {
    name: "extern_blocks",
    src:
      'extern "C" {\n    fn f();\n    static X: u8;\n    static mut Y: u8;\n}\n' +
      'unsafe extern "C" {\n    safe fn g();\n    unsafe static Y: u8;\n    pub safe static Z: i32;\n    type T;\n}\n' +
      "extern {}\n",
  },
  // ---- macros ----
  { name: "macro_rules", src: "macro_rules! m {\n    () => {};\n    ($x:expr) => { $x };\n}\nmacro_rules! n (() => ());\n" },
  { name: "macro_calls", src: "m!();\nm! {}\nm![];\nfoo::bar!(a b c);\n" },
  { name: "macro_2_0", src: "macro m($x:ident) { $x }\nmacro n {\n    () => {}\n}\n" },
  { name: "macro_rules_missing_bang", src: "macro_rules m {}\n" },
  { name: "macro_call_no_semi", src: "m!()\nfn f() {}\n" },
  { name: "macro_pub", src: "pub m!();\npub(crate) macro_rules! n {}\n" },
  // ---- visibility, attributes, doc comments ----
  {
    name: "visibility",
    src:
      "pub fn a() {}\npub(crate) fn b() {}\npub(self) fn c() {}\npub(super) fn d() {}\npub(in crate::x) fn e() {}\n",
  },
  { name: "visibility_crate", src: "crate fn f() {}\n" },
  { name: "unsafe_attrs", src: "#[unsafe(no_mangle)]\nfn f() {}\n#[unsafe(export_name = \"x\")]\nstatic S: u8 = 0;\n" },
  { name: "doc_comments", src: "/// doc\nfn f() {}\n/** block */\nstruct S;\n" },
  { name: "inner_attrs", src: "#![allow(dead_code)]\n//! inner doc\n\nfn f() {}\n" },
  { name: "doc_comment_eof", src: "fn f() {}\n/// dangling\n" },
  { name: "attr_eof", src: "#[a]\n#[b]\n#[c]\n" },
  // ---- statics, consts, type aliases ----
  {
    name: "statics_consts",
    src:
      "static S: u8 = 1;\nstatic mut M: u8 = 0;\nconst C: u8 = 2;\nconst _: () = ();\ntype A = u8;\ntype B<T> where T: Copy = Vec<T>;\n",
  },
  { name: "const_block_item", src: "const { assert!(true) }\n" },
  { name: "const_missing_type", src: "const C = 1;\nstatic S = 2;\n" },
  { name: "const_mut", src: "const mut C: u8 = 1;\n" },
  { name: "reuse", src: "reuse a::b;\nreuse foo::{a, b as c};\nreuse Tr::*;\n" },
  // ---- recovery diagnostics ----
  { name: "missing_fn_kw", src: "pub foo() {}\n" },
  { name: "missing_struct_kw", src: "pub S { x: u8 }\n" },
  { name: "struct_double_semi", src: "struct S;;\n" },
  { name: "enum_disr_missing", src: "enum E { A = }\n" },
  { name: "let_at_item_level", src: "let x = 1;\n" },
  { name: "struct_semi_fields", src: "struct S {\n    a: u8;\n    b: u8\n}\n" },
  { name: "struct_fn_field", src: "struct S {\n    fn f() {}\n}\n" },
  { name: "default_struct", src: "default struct S;\n" },
  { name: "pub_eof", src: "pub\n" },
  { name: "nested_adt", src: "enum E {\n    struct S { x: u8 },\n}\n" },
  { name: "field_in_trait", src: "trait T {\n    x: u8,\n}\n" },
  { name: "enum_struct_field", src: "enum E {\n    a: u8,\n}\n" },
  { name: "enum_struct_kw", src: "enum struct E { A }\n" },
  { name: "assoc_static", src: "trait T {\n    static S: u8;\n}\n" },
  { name: "extern_const_and_mod", src: "extern \"C\" {\n    const C: u8;\n    mod m {}\n}\n" },
  { name: "union_no_body", src: "union U;\n" },
  { name: "struct_bad_after_name", src: "struct S @\n" },
];

/** case -> the `Unported` it must reach until the owning lane lands. */
const PENDING: Record<string, string> = {
};

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const WRITE = process.env.RUST_TS_WRITE_ORACLE === "1";
const FIXTURE = new URL("./item_oracle.json", import.meta.url);
const WORK = test_scratch_dir("parser-item-test");
mkdirSync(WORK, { recursive: true });

// Same environment for both sides; no inherited jobserver or logging.
const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const ARGS = (c: Case): string[] => ["--edition=2021", "-Zunpretty=ast-tree", `${c.name}.rs`];
const oracle_run = (c: Case): Out => run(["rustc", `+${PIN.toolchain}`, ...ARGS(c)]);
const ours = (c: Case): Out => run([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...ARGS(c)]);

interface Fixture {
  _how: string;
  cases: Record<string, Case & Out>;
}

for (const c of CASES) writeFileSync(join(WORK, `${c.name}.rs`), c.src);

if (WRITE) {
  const v = run(["rustc", `+${PIN.toolchain}`, "-vV"]).stdout;
  if (!v.includes(`commit-hash: ${PIN.commit}`)) throw new Error(`ERROR: pinned rustc unavailable (got ${v.split("\n")[0]})`);
  const fixture: Fixture = {
    _how: `rustc +${PIN.toolchain} --edition=2021 -Zunpretty=ast-tree <name>.rs, cwd = a scratch dir holding <name>.rs = src (commit ${PIN.commit})`,
    cases: {},
  };
  for (const c of CASES) fixture.cases[c.name] = { ...c, ...oracle_run(c) };
  writeFileSync(FIXTURE, JSON.stringify(fixture, null, 1) + "\n");
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;

test("parser-item fixture covers exactly the cases", () => {
  expect(Object.keys(fixture.cases).sort()).toEqual(CASES.map((c) => c.name).sort());
  for (const name of Object.keys(PENDING)) expect(CASES.some((c) => c.name === name)).toBe(true);
  void REQUIRE;
});

const UNPORTED = "rust-ts: unported: ";

for (const c of CASES) {
  test(`parser-item oracle: ${c.name}`, () => {
    const exp_ = fixture.cases[c.name]!;
    expect(exp_.src).toBe(c.src);
    const got = ours(c);
    const pending = PENDING[c.name];
    const lines = got.stderr.trimEnd().split("\n");
    const last = lines[lines.length - 1] ?? "";
    if (got.code === 70 && last.startsWith(UNPORTED)) {
      // Not (yet) reachable end to end: must be the listed pending path, after a prefix of the oracle.
      expect(last.slice(UNPORTED.length)).toBe(pending ?? "(not pending)");
      const stderr_before = lines.slice(0, -1).join("\n");
      expect(exp_.stderr.startsWith(stderr_before)).toBe(true);
      expect(exp_.stdout.startsWith(got.stdout)).toBe(true);
      return;
    }
    expect(got.stderr).toBe(exp_.stderr);
    expect(got.stdout).toBe(exp_.stdout);
    expect(got.code).toBe(exp_.code);
    // A pending case that now matches must be dropped from PENDING.
    expect(pending).toBeUndefined();
  });
}
