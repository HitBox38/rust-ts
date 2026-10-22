// Oracle tests for rustc_passes dead.rs (`live_symbols_and_ignored_derived_traits`, `check_mod_deathness`: the
// `dead_code` / `dead_code_pub_in_binary` lints and the self-assignment lint), layout_test.rs (`#[rustc_dump_layout]`),
// abi_test.rs (`#[rustc_abi]`) and canonical_symbols.rs (`all_canonical_symbols`) (lane passes-dead).
//
// The oracle is the pinned rustc itself (`--emit=metadata`, so nothing is linked): its stderr holds every diagnostic of
// the compilation. The subject is src/rustc_passes/oracle/dead_run.ts (see its header): the ported driver, then the
// steps of `run_required_analyses` / `analysis` that are ported, in upstream order. The cases are borrowck-, liveness-
// and late-lint-clean (those passes are not run by the subject), so stderr and the exit code must be identical.
// `PENDING` cases stop at a pinned UNPORTED point instead (exit 70).
//
// The oracle rustc (`scripts/lib/oracle.ts`) is required, as for the difftest suites.
import { beforeAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../scripts/lib/common.ts";
import { oracleRustcCmd, oracleSysroot } from "../../scripts/lib/oracle.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const WORK = test_scratch_dir("passes-dead-oracle");
const RUNNER = join(REPO, "src/rustc_passes/oracle/dead_run.ts");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stderr: string;
  code: number;
}
async function run(cmd: string[]): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  return { stderr, code };
}

interface Case {
  name: string;
  src: string[];
  args?: string[];
  /** Text the oracle's stderr must contain (the diagnostics under test were really emitted). */
  expect: string[];
  /** The subject stops at this UNPORTED point instead of matching (exit 70). */
  pending?: string;
}

const CASES: Case[] = [
  {
    name: "items",
    src: [
      "struct Unused;",
      "struct Used { a: u32, b: u32 }",
      "enum E { A, B(u8), C }",
      "fn dead() { dead2() }",
      "fn dead2() {}",
      "fn _ignored() {}",
      "const C: u8 = 1;",
      "static S: u8 = 1;",
      "type Alias = u8;",
      "union U { a: u8, b: u16 }",
      "trait T { fn m(&self); }",
      "mod m { pub fn inner() {} fn private() {} pub(crate) struct P; }",
      "fn helper() -> Used { Used { a: 1, b: 2 } }",
      "fn main() {",
      "    let u = helper();",
      "    let _ = u.a;",
      "    let _e = E::A;",
      "}",
    ],
    expect: ["struct `Unused` is never constructed", "variants `B` and `C` are never constructed", "function `dead` is never used"],
  },
  {
    name: "assoc_items",
    src: [
      "struct S;",
      "impl S {",
      "    fn used(&self) {}",
      "    fn unused_a(&self) {}",
      "    const UNUSED_C: u8 = 0;",
      "    fn unused_b() {}",
      "    fn _skip(&self) {}",
      "}",
      "trait Tr { fn req(&self); fn provided(&self) {} fn never(&self) {} type A; const K: u8; }",
      "impl Tr for S { fn req(&self) { self.provided() } type A = u8; const K: u8 = 1; }",
      "enum Kind { Alpha, Beta }",
      "impl Kind { #[allow(non_snake_case)] fn Alpha() {} #[allow(non_upper_case_globals)] const Beta: u8 = 0; }",
      "fn main() {",
      "    let s = S;",
      "    s.used();",
      "    s.req();",
      "    let _ = Kind::Alpha;",
      "    let _ = Kind::Beta;",
      "}",
    ],
    expect: ["associated items `unused_a`, `UNUSED_C`, and `unused_b` are never used", "never used"],
  },
  {
    name: "fields",
    src: [
      "#[derive(Debug, Clone)]",
      "struct D { a: u8, b: u8 }",
      "struct Tup(u8, u16, ());",
      "struct Tup2(u8, u16);",
      "struct Mid(u32, u8, u32);",
      "#[repr(C)] struct ReprC { x: u8, y: u8 }",
      "struct Ph { a: u8, p: std::marker::PhantomData<u8> }",
      "struct Many { f1: u8, f2: u8, f3: u8, f4: u8, f5: u8, f6: u8, f7: u8, used: u8 }",
      "enum En { V { x: u8, y: u8 }, W(u8, u8) }",
      "fn main() {",
      "    let d = D { a: 1, b: 2 };",
      "    let _ = d.clone();",
      "    let t = Tup(1, 2, ());",
      "    let _ = t.0;",
      "    let t2 = Tup2(1, 2);",
      "    let _ = t2;",
      "    let m = Mid(1, 2, 3);",
      "    let _ = m.1;",
      "    let _ = ReprC { x: 1, y: 2 };",
      "    let p = Ph { a: 1, p: std::marker::PhantomData };",
      "    let _ = p.p;",
      "    let many = Many { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, used: 0 };",
      "    let _ = many.used;",
      "    let _ = En::V { x: 1, y: 2 };",
      "    let _ = En::W(1, 2);",
      "}",
    ],
    expect: ["intentionally ignored during dead code analysis", "multiple fields are never read", "never read"],
  },
  {
    name: "allow_expect_pub",
    src: [
      "#![warn(dead_code_pub_in_binary)]",
      "#[allow(dead_code)]",
      "fn root() { mid() }",
      "fn mid() {}",
      "#[expect(dead_code)]",
      "fn expected() {}",
      "#[expect(dead_code)]",
      "fn unfulfilled() {}",
      "#[allow(dead_code)]",
      "enum Quiet { A, B }",
      "pub fn pub_unused() {}",
      "pub struct PubS { pub f: u8 }",
      "#[no_mangle] fn kept() {}",
      "const _: () = { foo(); };",
      "const fn foo() {}",
      "fn main() { unfulfilled() }",
    ],
    expect: ["this lint expectation is unfulfilled", "in binaries"],
  },
  {
    name: "lib_crate",
    args: ["--crate-type", "lib"],
    src: [
      "pub fn api() { helper() }",
      "fn helper() {}",
      "fn dead() {}",
      "pub struct S { pub a: u8, b: u8 }",
      "impl S { pub fn new() -> S { S { a: 0, b: 0 } } fn priv_unused(&self) {} }",
      "pub trait PubT { fn m(&self) {} }",
      "trait PrivT { fn m(&self); }",
      "impl PrivT for S { fn m(&self) {} }",
      "extern \"C\" { fn ext_unused(); pub fn ext_pub(); }",
      "mod private { pub fn reach() {} }",
      "pub use private::reach;",
    ],
    expect: ["function `dead` is never used", "field `b` is never read"],
  },
  {
    name: "self_assign_and_patterns",
    src: [
      "struct P { x: u8, y: u8 }",
      "enum Sh { Circle(u8), Square { side: u8 }, Never }",
      "fn take(s: Sh) -> u8 { match s { Sh::Circle(r) => r, Sh::Square { side } => side, Sh::Never => 0 } }",
      "struct W(u8, u8, u8);",
      "fn main() {",
      "    let mut p = P { x: 1, y: 2 };",
      "    p.x = p.x;",
      "    let _ = p.y;",
      "    let _ = take(Sh::Circle(1));",
      "    let _ = take(Sh::Square { side: 1 });",
      "    let W(a, .., c) = W(1, 2, 3);",
      "    let _ = (a, c);",
      "    let f = |q: P| q.y;",
      "    let _ = f(P { x: 0, y: 0 });",
      "}",
    ],
    expect: ["useless assignment of field of type `u8` to itself", "variant `Never` is never constructed"],
  },
  {
    name: "layout_dump",
    args: ["--crate-type", "lib"],
    src: [
      "#![feature(rustc_attrs)]",
      "#![allow(internal_features, dead_code)]",
      "#[rustc_dump_layout(size, align, backend_repr, largest_niche, homogeneous_aggregate)]",
      "struct S { a: u8, b: u32 }",
      "#[rustc_dump_layout(debug)]",
      "enum E { A(u8), B }",
      "#[rustc_dump_layout(size, homogeneous_aggregate)]",
      "#[repr(C)] struct F { a: f32, b: f32 }",
      "#[rustc_dump_layout(debug)]",
      "type Opt = Option<&'static u8>;",
      "#[rustc_dump_layout(size)]",
      "type Big = [u8; 18446744073709551615];",
      "#[rustc_dump_layout(debug)]",
      "struct G<T>(T);",
      "#[rustc_dump_layout(align)]",
      "union U { a: u8, b: u64 }",
    ],
    expect: ["size: Size(8 bytes)", "homogeneous_aggregate: Ok(Homogeneous(Reg { kind: Float, size: Size(4 bytes) }))", "layout_of(E) ="],
  },
  {
    name: "layout_not_wf",
    args: ["--crate-type", "lib"],
    src: ["#![feature(rustc_attrs)]", "#![allow(internal_features, dead_code)]", "#[rustc_dump_layout(debug)]", "type Bad = Vec<str>;"],
    expect: ["the size for values of type `str` cannot be known at compilation time"],
  },
  {
    name: "abi_invalid_target",
    args: ["--crate-type", "lib"],
    src: ["#![feature(rustc_attrs)]", "#![allow(internal_features, dead_code)]", "#[rustc_abi(debug)]", "struct S;", "#[rustc_abi(assert_eq)]", "const C: u8 = 0;"],
    expect: ["the `rustc_abi` attribute can only be applied to function items, type aliases, and associated functions"],
  },
  {
    name: "abi_fn_ptr_alias",
    args: ["--crate-type", "lib"],
    src: ["#![feature(rustc_attrs)]", "#![allow(internal_features, dead_code)]", "#[rustc_abi(debug)]", "type F = fn(u8);"],
    expect: ["fn_abi_of(F) ="],
    pending: "rustc_middle::query::keys: QueryKey for `ty::PseudoCanonicalInput<'tcx, (ty::PolyFnSig<'tcx>, &'tcx ty::List<Ty<'tcx>>)>` (cache)",
  },
  {
    name: "abi_fn_item",
    args: ["--crate-type", "lib"],
    src: ["#![feature(rustc_attrs)]", "#![allow(internal_features, dead_code)]", "#[rustc_abi(debug)]", "fn f(_x: u8) {}"],
    expect: ["fn_abi_of(f) ="],
    pending: "rustc_middle::query::keys: QueryKey for `ty::PseudoCanonicalInput<'tcx, (ty::Instance<'tcx>, &'tcx ty::List<Ty<'tcx>>)>` (cache)",
  },
];

let sysroot = "";

beforeAll(() => {
  sysroot = oracleSysroot();
  for (const c of CASES) writeFileSync(join(WORK, `${c.name}.rs`), c.src.join("\n") + "\n");
});

for (const c of CASES) {
  test(`dead/layout: ${c.name}`, async () => {
    const common = [`${c.name}.rs`, "--edition", "2021", "--emit=metadata", ...(c.args ?? [])];
    const [ora, ours] = await Promise.all([
      run(oracleRustcCmd([...common, "-o", `oracle_${c.name}.rmeta`])),
      run([process.execPath, RUNNER, ...common, "--sysroot", sysroot, "-o", `ours_${c.name}.rmeta`]),
    ]);
    for (const e of c.expect) expect(ora.stderr).toContain(e);
    if (c.pending !== undefined) {
      expect(ours.stderr).toContain(`rust-ts: unported: ${c.pending}`);
      expect(ours.code).toBe(70);
      return;
    }
    expect(ours.stderr).toBe(ora.stderr);
    expect(ours.code).toBe(ora.code);
  }, 120_000);
}
