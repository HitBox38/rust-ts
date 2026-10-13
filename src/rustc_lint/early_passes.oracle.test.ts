// Oracle checks of the early lint passes (`BuiltinCombinedEarlyLintPass`, `InternalCombinedEarlyLintPass`; lane
// lint-early-b) against the pinned nightly rustc.
//
// The full driver stops at `rustc_metadata::creader::CStore` (wave 11) before `early_lint_checks`, so each case runs
// src/rust_ts/earlylints.ts: the ported driver up to the crate root, fresh `NodeId`s (as expansion assigns them), then
// the pre-expansion and early `check_ast_node`. The oracle compiles the same file as a `#![no_core]` lib
// (`--emit=metadata`). The sources avoid macro invocations, `cfg`, unloaded modules and anything the passes between
// parsing and the early lints (expansion, resolve, AST validation, feature gating) would report, so rustc's first
// diagnostics are exactly the early lints. Our stderr, minus its final summary (`N warnings emitted` /
// `aborting due to ..`), must be a prefix of rustc's and contain the diagnostics under test.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "early-passes-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
const nocore = (edition: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot(),
  `--edition=${edition}`,
  "-Zcrate-attr=feature(no_core)",
  "-Zcrate-attr=no_core",
  "--crate-type=lib",
  "--emit=metadata",
  "-o",
  "/dev/null",
];

/** Drops the final summary lines (`warning: N warnings emitted`, `error: aborting due to ..`, `For more information ..`). */
function strip_summary(s: string): string {
  const lines = s.split("\n");
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l === "" || /^warning: \d+ warnings? emitted$/.test(l) || /^error: aborting due to/.test(l) || /^(For more information|Some errors have detailed)/.test(l)) end = i;
    else break;
  }
  return lines.slice(0, end).join("\n");
}

interface Case {
  name: string;
  src: string;
  edition?: string;
  flags?: string[];
  /** Extra (empty) files next to the case (modules it loads). */
  files?: string[];
  /** Text our output must contain (the diagnostics under test were really emitted). */
  expect: string[];
}

const CASES: Case[] = [
  {
    name: "while_true (labels, parens), double_negations, redundant_semicolons",
    src: [
      "fn f() {",
      "    while true {}",
      "    'a: while (true) { break 'a; }",
      "    let x = 1;",
      "    let _ = --x;",
      "    let _ = - - -x;",
      "    let _ = -(-x);",
      "    let _ = 1;;",
      "    ;;;",
      "}",
      "fn g() { ; }",
      "",
    ].join("\n"),
    expect: ["denote infinite loops with `loop { ... }`", "help: use `loop`", "use of a double negation", "unnecessary trailing semicolons", "unnecessary trailing semicolon"],
  },
  {
    name: "unsafe_code on blocks, traits, impls, extern blocks and fns",
    src: [
      "#![deny(unsafe_code)]",
      "unsafe trait T { unsafe fn m(); unsafe fn n() {} }",
      "struct S;",
      "unsafe impl T for S { unsafe fn m() {} }",
      "unsafe extern \"C\" { unsafe fn e(); }",
      "unsafe fn f() { unsafe {} }",
      "impl S { unsafe fn i(&self) {} }",
      "fn g() { let _ = unsafe { 1 }; }",
      "",
    ].join("\n"),
    edition: "2024",
    expect: ["declaration of an `unsafe` trait", "implementation of an `unsafe` trait", "usage of an `unsafe` block", "declaration of an `unsafe` function", "declaration of an `unsafe` method", "implementation of an `unsafe` method", "usage of an `unsafe extern` block"],
  },
  {
    name: "anonymous_parameters (2015) with snippets",
    src: "trait T {\n    fn f(u8);\n    fn g(&self, [(u8, i32); 2], &'static str) -> u8;\n    fn h(_: u8);\n}\n",
    edition: "2015",
    expect: ["anonymous parameters are deprecated and will be removed in the next edition", "_: [(u8, i32); 2]"],
  },
  {
    name: "unused_doc_comments on statements, arms, expressions, fields, generic params and extern blocks",
    src: [
      "#![feature(stmt_expr_attributes)]",
      "struct P { a: u8 }",
      "/// extern",
      "extern \"C\" {}",
      "fn f</** generic */ T>(p: P) {",
      "    /// let",
      "    let x = 1;",
      "    match x {",
      "        /// arm",
      "        1 => {}",
      "        /** block */",
      "        _ => {}",
      "    }",
      "    let P { /// field",
      "        a } = p;",
      "    let _ = P { /// expr field",
      "        a: 1 };",
      "    let _ = (",
      "        /// expr",
      "        3",
      "    );",
      "}",
      "",
    ].join("\n"),
    expect: ["unused doc comment", "rustdoc does not generate documentation for extern blocks", "statements", "match arms", "use `//` for a plain comment", "use `/* */` for a plain comment", "pattern fields", "expression fields", "expressions", "generic parameters"],
  },
  {
    name: "ellipsis_inclusive_range_patterns in 2018 (lint) incl. `&0...9` and `...=` suggestions",
    src: "fn f(x: u8, y: &u8) {\n    match x { 0...9 => {} _ => {} }\n    match y { &0...9 => {} &10... => {} _ => {} }\n}\n",
    edition: "2018",
    expect: ["`...` range patterns are deprecated", "use `..=` for an inclusive range", "&(0..=9)"],
  },
  {
    name: "ellipsis_inclusive_range_patterns in 2021 (hard error E0783)",
    src: "fn f(x: u8, y: &u8) {\n    match x { 0...9 => {} _ => {} }\n    match y { &0...9 => {} _ => {} }\n}\n",
    edition: "2021",
    expect: ["E0783", "`...` range patterns are deprecated"],
  },
  {
    name: "incomplete_features (note, help) and internal_features",
    src: "#![feature(specialization, rustc_attrs, core_intrinsics, unboxed_closures)]\n",
    expect: ["the feature `specialization` is incomplete", "consider using `min_specialization` instead", "see issue #", "the feature `rustc_attrs` is internal", "the feature `core_intrinsics` is internal"],
  },
  {
    name: "special_module_name (`mod lib;`, `mod main;`, `#[path]` exempt)",
    src: "mod lib;\nmod main;\n#[path = \"lib.rs\"]\nmod lib2;\npub mod a { mod lib {} }\n",
    files: ["lib.rs", "main.rs"],
    expect: ["found module declaration for lib.rs", "found module declaration for main.rs"],
  },
  {
    name: "edition_2024_expr_fragment_specifier (2021)",
    src: "#![warn(edition_2024_expr_fragment_specifier)]\n#![allow(unused_macros)]\nmacro_rules! m { ($e:expr, $f:ident, $($g:expr),*) => { ($e, [$($g),*]) } }\n",
    edition: "2021",
    expect: ["the `expr` fragment specifier will accept more expressions in the 2024 edition", "expr_2021"],
  },
  {
    name: "non_ascii_idents, uncommon_codepoints, confusable_idents, mixed_script_confusables",
    src: [
      "#![deny(non_ascii_idents, uncommon_codepoints, confusable_idents)]",
      "#![warn(mixed_script_confusables)]",
      "#![allow(non_upper_case_globals)]",
      "const µ: f64 = 0.000001;",
      "fn dĳkstra() {}",
      "const s: usize = 1;",
      "const ｓ: usize = 2;",
      "struct ΑctuallyNotLatin;",
      "mod роре { const エ: &'static str = \"アイウ\"; }",
      "fn f() { let ㇻㇲㇳ = 1; }",
      "",
    ].join("\n"),
    expect: ["identifier contains non-ASCII characters", "non normalized (NFKC)", "uncommon character", "found both `s` and `ｓ` as identifiers", "Script Group `Greek`", "Script Group `Cyrillic`"],
  },
  {
    name: "non_camel_case_types on types, traits, variants, generic params, inherent assoc types; repr(C) exempt",
    src: [
      "#![feature(trait_alias, inherent_associated_types)]",
      "#![allow(incomplete_features)]",
      "struct foo_bar;",
      "enum my_enum { var_one, VarTwo, __X }",
      "union u_x { a: u8 }",
      "trait my_trait { type assoc_ty; }",
      "trait t_alias = my_trait;",
      "type ty_alias = u8;",
      "fn f<'a, t_param, const N: usize>() {}",
      "#[repr(C)]",
      "struct c_struct;",
      "struct ΣΣ_σ;",
      "struct DŽx_y;",
      "struct X__Y;",
      "struct _Under_score_;",
      "impl foo_bar { type inh_ty = u8; }",
      "struct 中_文;",
      "",
    ].join("\n"),
    expect: ["type `foo_bar` should have an upper camel case name", "variant `var_one`", "trait `my_trait`", "associated type `assoc_ty`", "trait alias `t_alias`", "type parameter `t_param`", "associated type `inh_ty`"],
  },
  {
    name: "ambiguous_negative_literals",
    src: "#![warn(ambiguous_negative_literals)]\nfn f() {\n    let _ = -1i32.abs();\n    let _ = -1.0f64.abs().abs();\n    let _ = -(1i32).abs();\n}\n",
    expect: ["`-` has lower precedence than method calls", "add parentheses around the `-` and the literal"],
  },
  {
    name: "unused_parens in conditions, values, arguments, closures, patterns and types",
    src: [
      "#![allow(dead_code)]",
      "trait Fn<A> {}",
      "trait Copy {}",
      "enum O { Some(u8) }",
      "use O::Some;",
      "struct S { x: u8 }",
      "fn g(_: u8) {}",
      "fn f(mut v: u8, (a): u8) -> u8 {",
      "    if (true) {}",
      "    while (false) {}",
      "    for _ in (0..1) {}",
      "    match (v) { (0) => {} (ref x) | (ref x) if (true) => { let _ = x; } _ => {} }",
      "    let (y) = (v);",
      "    let _ = [(1); 3];",
      "    let _: [u8; (2)] = [0; 2];",
      "    let _ = |x: u8| (x + 1);",
      "    g((v));",
      "    v = (1);",
      "    v += (1);",
      "    let _ = &(v);",
      "    if let Some((z)) = Some(1) { let _ = z; }",
      "    if let 1 = (1) {}",
      "    while let 1 = (1) {}",
      "    let _: (u8) = 1;",
      "    let _: &(dyn Fn() -> u8) = &|| 0;",
      "    let _ = 1 as (u8) < 2;",
      "    let _ = 1 as ((u8)) < 2;",
      "    let _ = (S { x: 1 });",
      "    if (S { x: 1 }).x == 1 {}",
      "    let _ = a + y;",
      "    return (v);",
      "}",
      "fn h() -> (u8) { (1) }",
      "const C: u8 = (1);",
      "static ST: u8 = (1);",
      "fn w<T>() where (T): Copy {}",
      "fn p((a, b): (u8, u8), &(c): &u8, &(mut d): &u8) { let _ = (a, b, c, d); }",
      "",
    ].join("\n"),
    expect: ["unnecessary parentheses around `if` condition", "`while` condition", "`for` iterator expression", "`match` scrutinee expression", "pattern", "assigned value", "function argument", "closure body", "type", "`return` value", "block return value", "const expression", "`let` scrutinee expression"],
  },
  {
    name: "unused_parens with trait objects, impl Trait and fn pointer bounds",
    src: [
      "trait A {} trait B {} trait Send {} trait Fn<A> {}",
      "struct Box<T>(T);",
      "fn f(_: &(dyn A + Send), _: Box<(dyn A)>, _: &dyn (A), _: Box<dyn (A) + (B)>) {}",
      "fn g(_: impl (A) + B, _: &(impl A)) {}",
      "type T1 = Box<dyn Fn() -> &'static (dyn A) + Send>;",
      "type T2 = Box<dyn Fn() -> (dyn A)>;",
      "type T3 = (fn(u8));",
      "type T4 = Box<(dyn for<'a> Fn(&'a u8))>;",
      "",
    ].join("\n"),
    edition: "2021",
    expect: ["unnecessary parentheses around type"],
  },
  {
    name: "unused_parens: `dyn (::Path)` exception in 2015",
    src: "trait A {}\ntrait Send {}\nstruct Box<T>(T);\nfn f(_: Box<dyn (::A)>, _: Box<dyn (A) + Send>) {}\n",
    edition: "2015",
    expect: [],
  },
  {
    name: "unused_braces (2021) in values, arguments, const generic args, array lengths and discriminants",
    src: [
      "#![allow(dead_code)]",
      "struct C<const N: usize>;",
      "enum E { A = { 1 }, B = { 1 + 1 } }",
      "fn g(_: u8) {}",
      "fn f() {",
      "    let _ = { 7 };",
      "    let _: C<{ 1 }> = C;",
      "    let _ = [0u8; { 3 }];",
      "    let _: [u8; { 2 }] = [0; 2];",
      "    g({ 1 });",
      "    g({ 1 + 1 });",
      "    for _ in { 0..1 } {}",
      "    if { true } {}",
      "    let _ = {",
      "        5",
      "    };",
      "    let _ = unsafe { 1 };",
      "    let _ = |x: u8| { x };",
      "    while { false } {}",
      "    match { 1 } { _ => {} }",
      "}",
      "",
    ].join("\n"),
    edition: "2021",
    expect: ["unnecessary braces around const expression", "unnecessary braces around function argument", "unnecessary braces around `for` iterator expression"],
  },
  {
    name: "unused_braces (2024): temporaries in arguments and `for` iterators keep their braces",
    src: "fn g(_: u8) {}\nfn h() -> u8 { 1 }\nfn f() {\n    g({ 1 });\n    g({ h() });\n    for _ in { 0..1 } {}\n    let _ = { 7 };\n}\n",
    edition: "2024",
    expect: ["unnecessary braces around function argument"],
  },
  {
    name: "unused_import_braces",
    src: "#![deny(unused_import_braces)]\n#![allow(unused_imports)]\nmod a { pub mod b { pub struct C; } pub struct D; }\nuse a::{D};\nuse a::{b::{C}};\nuse a::{D as E};\nuse a::b::{*};\n",
    edition: "2021",
    expect: ["braces around D is unnecessary", "braces around C is unnecessary", "braces around E is unnecessary", "braces around * is unnecessary"],
  },
  {
    name: "internal early lints with -Zunstable-options (lint_pass_impl_without_macro, implicit_sysroot_crate_import)",
    src: "trait LintPass {}\nstruct P;\nimpl LintPass for P {}\nextern crate core;\nextern crate alloc as rustc_alloc;\n",
    flags: ["-Zunstable-options", "-D", "rustc::lint_pass_impl_without_macro", "-D", "rustc::implicit_sysroot_crate_import"],
    expect: ["implementing `LintPass` by hand"],
  },
];

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(`early passes: ${c.name}`, () => {
    const file = `case${i}.rs`;
    writeFileSync(join(WORK, file), c.src);
    for (const f of c.files ?? []) writeFileSync(join(WORK, f), "");
    const args = [...nocore(c.edition ?? "2021"), ...(c.flags ?? []), file];
    const oracle = run([...RUSTC, ...args]);
    const ours = run([process.execPath, join(REPO, "src/rust_ts/earlylints.ts"), ...args]);
    expect(ours.stderr).not.toContain("rust-ts: ");
    const prefix = strip_summary(ours.stderr);
    if (!oracle.stderr.startsWith(prefix)) {
      // Show the first differing line.
      const ol = oracle.stderr.split("\n");
      const pl = prefix.split("\n");
      let k = 0;
      while (k < pl.length && ol[k] === pl[k]) k++;
      expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
    }
    for (const e of c.expect) expect(prefix).toContain(e);
  });
}
