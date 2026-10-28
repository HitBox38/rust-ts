// Oracle checks of the late lint passes of lane lint-late-c (not a port): nonstandard_style.rs (NonSnakeCase,
// NonUpperCaseGlobals), unused.rs (PathStatements, UnusedAllocation), unused/must_use.rs (UnusedResults),
// impl_trait_overcaptures.rs, lifetime_syntax.rs and if_let_rescope.rs, against the pinned nightly rustc.
//
// The subject is lane lint-late-a's test driver src/rustc_lint/late_oracle/run.ts (see its header): the analysis prefix
// (typeck of every body), the given late passes as one combined pass (listed in lib.rs order) on every module, and
// `check_expectations`. The oracle compiles the same file as a lib with std (`--emit=metadata`), so each case only
// has diagnostics those steps produce (no borrowck, liveness or dead-code diagnostics): stderr and the exit code must
// be identical.
//
// BLOCKED cases make a lint fire, but the port stops at an `unported` outside this lane's files (named in
// `blocked_by`). They check that the oracle really emits the lint and that the port stops exactly there; once the
// blocker is ported, the case fails with a message to move it into CASES.
//
// Skips (visibly) if the driver is not there yet (lint-late-a not merged); skips if rustc is unavailable, and fails
// instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const DRIVER = join(REPO, "src/rustc_lint/late_oracle/run.ts");
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE_DRIVER = existsSync(DRIVER);
const HAVE = rustcAvailable();
const SKIP = !HAVE_DRIVER || (!HAVE && !REQUIRE);
if (!HAVE_DRIVER) console.log("SKIP: src/rustc_lint/late_oracle/run.ts (lane lint-late-a's late lint test driver) is not merged yet");
else if (!HAVE && !REQUIRE) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "lint-late-c-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
let sysroot_: string | undefined;
const sysroot = (): string => (sysroot_ ??= Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim());

/** This lane's passes, in lib.rs `BuiltinCombinedModuleLateLintPass` order. */
const ALL_PASSES = [
  "if_let_rescope.ts:IfLetRescope",
  "impl_trait_overcaptures.ts:ImplTraitOvercaptures",
  "lifetime_syntax.ts:LifetimeSyntax",
  "nonstandard_style.ts:NonSnakeCase",
  "nonstandard_style.ts:NonUpperCaseGlobals",
  "unused.ts:PathStatements",
  "unused.ts:UnusedAllocation",
  "unused/must_use.ts:UnusedResults",
];

interface Case {
  name: string;
  src: string[];
  edition?: string;
  flags?: string[];
  /** Default: ALL_PASSES. */
  passes?: string[];
  /** Text the oracle output must contain (the diagnostics under test are really emitted / the case is meaningful). */
  expect: string[];
}

interface BlockedCase extends Case {
  /** The `unported(..)` path the port stops at. */
  blocked_by: string;
}

const CASES: Case[] = [
  {
    name: "non_snake_case: fn, method, trait method, module, lifetime, variable, field, fn-ptr param, reserved name",
    src: [
      "pub fn MyFn() {}",
      "pub mod FooMod {}",
      "pub struct S { pub FieldName: u8 }",
      "impl S { pub fn DoIt(&self) {} }",
      "pub trait T { fn TraitM(&self, ArgX: u8); fn ok(&self) {} }",
      "impl T for S { fn TraitM(&self, _: u8) {} }",
      "pub fn lt<'FooBar>(x: &'FooBar u8) -> &'FooBar u8 { x }",
      "pub fn var() { let MyVar = 1u8; let S { FieldName } = S { FieldName: MyVar }; let S { FieldName: Other } = S { FieldName }; let _ = Other; }",
      "pub type F = fn(ParamX: u8);",
      "pub fn Mod() {}",
      "pub fn Async() {}",
      "pub fn __x__Y() {}",
      "#[allow(non_snake_case)] pub fn Allowed() {}",
      "#[no_mangle] pub extern \"C\" fn ExternNoMangle() {}",
    ],
    expect: ["function `MyFn` should have a snake case name", "module `FooMod`", "lifetime `'FooBar`", "trait method `TraitM`", "variable `ParamX`", "rename the identifier or convert it to a snake case raw identifier"],
  },
  {
    name: "non_snake_case: crate name from --crate-name",
    src: ["pub fn f() {}"],
    flags: ["--crate-name", "FooCrate"],
    expect: ["crate `FooCrate` should have a snake case name"],
  },
  {
    name: "non_snake_case: crate name from #![crate_name]",
    src: ['#![crate_name = "BarCrate"]', "pub fn f() {}"],
    expect: ["crate `BarCrate` should have a snake case name"],
  },
  {
    name: "non_upper_case_globals: static, const (with usages), assoc consts, const param, const in pattern",
    src: [
      "pub static max_points: i32 = 5;",
      "const foo: u8 = 1;",
      "pub fn use_foo() -> u8 { foo + foo }",
      "pub struct S;",
      "impl S { pub const assoc: u8 = 2; }",
      "pub trait T { const trait_c: u8; }",
      "impl T for S { const trait_c: u8 = 3; }",
      "pub fn cp<const n: usize>() {}",
      "pub fn pat(x: u8) { match x { foo => {} _ => {} } }",
      "#[no_mangle] pub static no_mangled: u8 = 0;",
    ],
    expect: ["static variable `max_points` should have an upper case name", "constant `foo`", "associated constant `assoc`", "const parameter `n`", "constant in pattern `foo`"],
  },
  {
    name: "path_statements: no effect, drops value",
    src: ["pub fn f(s: String) {", "    let x = 1u8;", "    x;", "    s;", "}"],
    // (UnusedResults would stop at `Ty::is_inhabited_from` on these statements, see BLOCKED.)
    passes: ["unused.ts:PathStatements"],
    expect: ["path statement with no effect", "path statement drops value"],
  },
  {
    name: "unused_allocation: autoref of Box::new",
    src: ["#![deny(unused_allocation)]", "pub fn f() {", "    _ = Box::new([1]).len();", "    _ = Box::new(1).clone();", "}"],
    expect: ["unnecessary allocation, use `&` instead"],
  },
  {
    name: "unused_must_use: unit-returning #[must_use] fn and method, with reason, in a block tail",
    src: [
      '#[must_use = "it matters"]',
      "pub fn h() {}",
      "pub struct S;",
      "impl S { #[must_use] pub fn m(&self) {} }",
      "pub fn f() {",
      "    h();",
      "    { h() };",
      "    S.m();",
      "    let _ = h();",
      "}",
    ],
    expect: ["unused return value of `h` that must be used", "unused return value of `S::m` that must be used", "it matters"],
  },
  {
    name: "impl_trait_overcaptures / impl_trait_redundant_captures enabled, no RPIT bodies: nothing to report",
    src: [
      "#![warn(impl_trait_overcaptures, impl_trait_redundant_captures)]",
      "pub trait Tr {",
      "    fn m<'a>(&'a self, x: &'a u8) -> impl Sized;",
      "    fn n(&self) -> impl Sized + use<Self>;",
      "}",
      "pub fn f<'a, T: Copy>(x: &'a T) -> &'a T { x }",
      "pub struct S<'a>(&'a u8);",
      "impl<'a> S<'a> { pub fn get(&self) -> &'a u8 { self.0 } }",
    ],
    expect: [],
  },
  {
    name: "mismatched_lifetime_syntaxes: consistent signatures do not lint",
    src: [
      "pub struct W<'a>(pub &'a u8);",
      "pub fn a(x: &u8) -> &u8 { x }",
      "pub fn b<'a>(x: &'a u8) -> &'a u8 { x }",
      "pub fn c(x: &u8) -> W<'_> { W(x) }",
      "pub fn d<'a>(x: W<'a>) -> W<'a> { x }",
      "pub fn e(x: &'static u8) -> &'static u8 { x }",
    ],
    expect: [],
  },
  {
    name: "if_let_rescope enabled, place scrutinees only: nothing to report",
    src: [
      "#![warn(if_let_rescope)]",
      "pub fn f(x: Option<i32>, y: Option<&str>) -> i32 {",
      "    if let Some(v) = x { v } else if let Some(s) = y { s.len() as i32 } else { 0 }",
      "}",
      "pub fn g(x: &Option<String>) -> usize {",
      "    if let Some(s) = x { s.len() } else { 0 }",
      "}",
    ],
    expect: [],
  },
  {
    name: "mismatched_lifetime_syntaxes fires",
    src: ["pub struct W<'a>(pub &'a u8);", "pub fn a<'a>(x: &'a u8) -> &u8 { x }", "pub fn b(x: &u8) -> W { W(x) }"],
    expect: ["eliding a lifetime that's named elsewhere is confusing", "hiding a lifetime that's elided elsewhere is confusing"],
  },
  {
    name: "unused_must_use on a non-unit type",
    src: ["#[must_use]", "pub fn g() -> i32 { 1 }", "pub fn f() {", "    g();", "    1 + 2;", "}"],
    expect: ["unused return value of `g` that must be used", "unused arithmetic operation that must be used"],
  },
  {
    name: "unused_must_use: uninhabited and Result<_, !>-like types",
    src: [
      "pub enum Void {}",
      "#[must_use]",
      "pub fn r() -> Result<u8, Void> { Ok(1) }",
      "#[must_use]",
      "pub fn v() -> Result<(), Void> { Ok(()) }",
      "pub fn f() {",
      "    r();",
      "    v();",
      "}",
    ],
    expect: ["unused return value of `r` that must be used"],
  },
  {
    // was BLOCKED at borrowck (`UniverseInfo::relate`) until fix-w24-bck: the RPIT's hidden type comes from mir_borrowck.
    // `pub` (as every case): the driver does not run dead-code analysis, so a private `f` would miss the oracle's dead_code
    name: "impl_trait_overcaptures fires (RPIT with a body)",
    src: ["#![warn(impl_trait_overcaptures)]", "pub fn f<'a>(x: &'a ()) -> impl Sized { *x }"],
    expect: ["`impl Sized` will capture more lifetimes than possibly intended in edition 2024"],
  },
];

const BLOCKED: BlockedCase[] = [
  {
    name: "if_let_rescope fires",
    src: [
      "#![warn(if_let_rescope)]",
      "pub struct D;",
      "impl Drop for D { fn drop(&mut self) {} }",
      "impl D { pub fn get(&self) -> Option<u8> { None } }",
      "pub fn f() -> u8 { if let Some(x) = D.get() { x } else { 0 } }",
    ],
    expect: ["`if let` assigns a shorter lifetime since Edition 2024"],
    blocked_by: "rustc_middle::ty::significant_drop_order::extract_component_with_significant_dtor",
  },
];

function compile(i: string, c: Case): { oracle: Out; ours: Out } {
  const file = `case${i}.rs`;
  writeFileSync(join(WORK, file), c.src.join("\n") + "\n");
  const args = [
    "--target",
    "x86_64-unknown-linux-gnu",
    "--sysroot",
    sysroot(),
    `--edition=${c.edition ?? "2021"}`,
    "--crate-type=lib",
    "--emit=metadata",
    "-o",
    `case${i}.rmeta`,
    ...(c.flags ?? []),
    file,
  ];
  const passes = (c.passes ?? ALL_PASSES).map((p) => `--late-pass=${p}`);
  const oracle = run([...RUSTC, ...args]);
  const ours = run([process.execPath, DRIVER, ...passes, ...args]);
  return { oracle, ours };
}

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(`late lints (lint-late-c): ${c.name}`, () => {
    const { oracle, ours } = compile(String(i), c);
    for (const e of c.expect) expect(oracle.stderr).toContain(e);
    expect(ours.stderr).toBe(oracle.stderr);
    expect(ours.code).toBe(oracle.code);
  });
}

for (const [i, c] of BLOCKED.entries()) {
  test.skipIf(SKIP)(`late lints (lint-late-c), blocked: ${c.name}`, () => {
    const { oracle, ours } = compile(`_blocked${i}`, c);
    for (const e of c.expect) expect(oracle.stderr).toContain(e);
    const stopped = ours.code === 70 && ours.stderr.includes(`unported: ${c.blocked_by}`);
    if (!stopped) {
      throw new Error(`blocker \`${c.blocked_by}\` is no longer reached (exit ${ours.code}): move this case into CASES`);
    }
  });
}
