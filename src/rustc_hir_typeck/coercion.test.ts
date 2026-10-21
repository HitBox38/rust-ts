// Tests of lane typeck-coerce: coercion.rs through `can_coerce` (coercion.rs:1489, the clippy entry point), which builds a
// real `TypeckRootCtxt` + `FnCtxt` for a body and runs `FnCtxt::may_coerce` -> `Coerce::coerce` in a probe.
//
// Each case is a small `#![no_core]` crate (compiled in its own session: an UNPORTED stop poisons the queries it was
// inside of). The port lowers the crate's `type A` / `type B` aliases with `ItemCtxt` (or takes `type_of` of a fn item
// for `fn:<name>`) and asks `can_coerce(tcx, param_env(body), body, A, B)`.
//
// Oracle: the pinned rustc on `pub fn body(a: A) -> B { a }` (exit 0 iff the coercion holds; `--emit=metadata`), run
// when the pinned toolchain is installed (`RUST_TS_REQUIRE_PROBES=1` makes its absence a failure). Cases that stop at
// another lane's stub are pinned with the exact `unported(..)` text.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { ItemCtxt } from "../rustc_hir_analysis/decls.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import type { ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { Unported } from "../std/panic.ts";
import "./lib.ts";
import { can_coerce } from "./coercion.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const WORK = join(DATA, "tmp", "typeck-coerce", process.env.RUST_TS_AGENT ?? "default");

const PRELUDE = `#![feature(no_core, lang_items, never_type)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
`;
/** `Unsize` / `CoerceUnsized` lang items and the `&T -> &U` impl, plus a trait and an implementor. */
const UNSIZE = `#[lang = "unsize"] pub trait Unsize<T: ?Sized> {}
#[lang = "coerce_unsized"] pub trait CoerceUnsized<T: ?Sized> {}
impl<'a, 'b: 'a, T: ?Sized + Unsize<U>, U: ?Sized> CoerceUnsized<&'a U> for &'b T {}
pub trait Tr {}
pub struct S;
impl Tr for S {}
`;

interface Case {
  name: string;
  /** Items besides the prelude (`type A`, `type B`, ...). */
  items: string;
  /** `A` is `type_of(fn <name>)` when `fn:<name>`, else the alias `A`. */
  a?: string;
  /** `true` / `false` (the oracle agrees), or `UNPORTED(<what>)`. */
  expect: string;
  /** For UNPORTED cases: whether the oracle accepts the coercion (checked against rustc). */
  oracle?: boolean;
}

const CASES: Case[] = [
  // Reborrow `&mut T -> &T` (coerce_to_ref; no `Unsize` lang items, so coerce_unsized bails out).
  { name: "mut_ref_to_ref", items: "pub type A = &'static mut u8; pub type B = &'static u8;", expect: "true" },
  { name: "ref_to_mut_ref", items: "pub type A = &'static u8; pub type B = &'static mut u8;", expect: "false" },
  { name: "mut_ref_reborrow", items: "pub type A = &'static mut u8; pub type B = &'static mut u8;", expect: "true" },
  // Builtin deref coercion `&&T -> &T` (autoderef, second step).
  { name: "ref_ref_to_ref", items: "pub type A = &'static &'static u8; pub type B = &'static u8;", expect: "true" },
  // `!` coerces to anything (NeverToAny).
  { name: "never_to_u8", items: "pub type A = !; pub type B = u8;", expect: "true" },
  // Raw pointers.
  { name: "mut_ptr_to_const_ptr", items: "pub type A = *mut u8; pub type B = *const u8;", expect: "true" },
  { name: "const_ptr_to_mut_ptr", items: "pub type A = *const u8; pub type B = *mut u8;", expect: "false" },
  { name: "mut_ref_to_const_ptr", items: "pub type A = &'static mut u8; pub type B = *const u8;", expect: "true" },
  { name: "ref_to_mut_ptr", items: "pub type A = &'static u8; pub type B = *mut u8;", expect: "false" },
  // Plain unification.
  { name: "u8_to_u16", items: "pub type A = u8; pub type B = u16;", expect: "false" },
  { name: "u8_to_u8", items: "pub type A = u8; pub type B = u8;", expect: "true" },
  // Fn pointers (`UnsafeFnPointer`, leak check).
  { name: "fn_ptr_to_unsafe_fn_ptr", items: "pub type A = fn(); pub type B = unsafe fn();", expect: "true" },
  { name: "unsafe_fn_ptr_to_fn_ptr", items: "pub type A = unsafe fn(); pub type B = fn();", expect: "false" },
  { name: "fn_ptr_arg_mismatch", items: "pub type A = fn(u8); pub type B = fn(u16);", expect: "false" },
  // Fn items (`ReifyFnPointer`, sig_for_fn_def_coercion).
  { name: "fn_item_to_fn_ptr", items: "pub fn g(_: u8) {} pub type B = fn(u8);", a: "fn:g", expect: "true" },
  { name: "fn_item_to_unsafe_fn_ptr", items: "pub fn g(_: u8) {} pub type B = unsafe fn(u8);", a: "fn:g", expect: "true" },
  { name: "unsafe_fn_item_to_fn_ptr", items: "pub unsafe fn g() {} pub type B = fn();", a: "fn:g", expect: "false" },
  { name: "fn_item_wrong_arg", items: "pub fn g(_: u8) {} pub type B = fn(u16);", a: "fn:g", expect: "false" },
  // Unsizing through the next solver's proof tree (`CoerceVisitor`).
  {
    name: "ref_to_dyn",
    items: `${UNSIZE}pub type A = &'static S; pub type B = &'static dyn Tr;`,
    expect: "true",
  },
  {
    name: "mut_ref_to_ref_with_unsize",
    items: `${UNSIZE}pub type A = &'static mut u8; pub type B = &'static u8;`,
    expect: "true",
  },
];

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

function source_file(name: string, src: string): string {
  mkdirSync(WORK, { recursive: true });
  const f = join(WORK, name);
  writeFileSync(f, src);
  return f;
}

/** The port's answer for one case: `true` / `false`, or `UNPORTED(<what>)`. */
function port_can_coerce(c: Case): string {
  const file = source_file(`${c.name}.rs`, `${PRELUDE}${c.items}\npub fn body() {}\n`);
  let out: string | undefined;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const tys = new Map<string, Ty>();
      const fns = new Map<string, LocalDefId>();
      for (const id of tcx.hir_free_items()) {
        const item = tcx.hir_item(id);
        if (item.kind.$ === "Fn") fns.set(Symbol.as_str(item.kind.ident.name), item.owner_id.def_id);
        if (item.kind.$ !== "TyAlias") continue;
        tys.set(Symbol.as_str(item.kind._0.name), ItemCtxt.new(tcx, item.owner_id.def_id).lowerer().lower_ty(item.kind._2));
      }
      const body = fns.get("body")!;
      try {
        const a =
          c.a !== undefined
            ? Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(fns.get(c.a.slice(3))!)) as EarlyBinder<Ty>))
            : tys.get("A")!;
        const pe = tcx.param_env(LocalDefId.to_def_id(body)) as ParamEnv;
        out = String(can_coerce(tcx, pe, body, a, tys.get("B")!));
      } catch (e) {
        if (!(e instanceof Unported)) throw e;
        out = `UNPORTED(${e.what})`;
      }
    });
  });
  if (out === undefined) throw new Error(`ERROR: ${c.name}: no result`);
  return out;
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

/** The oracle's answer: does `pub fn body(a: A) -> B { a }` type-check? */
function oracle_coerces(c: Case): boolean {
  const a = c.a !== undefined ? c.a.slice(3) : "A";
  // A fn item's type has no name: coerce it from the item path instead of a parameter.
  const body = c.a !== undefined ? `pub fn body() -> B { ${a} }` : "pub fn body(a: A) -> B { a }";
  const file = source_file(`${c.name}_oracle.rs`, `${PRELUDE}${c.items}\n${body}\n`);
  const r = Bun.spawnSync(
    ["rustc", `+${PIN.toolchain}`, "--crate-type", "lib", "--edition", "2024", "--emit=metadata", "-o", join(WORK, `${c.name}.rmeta`), file],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTC_ICE: "0" } },
  );
  const err = r.stderr.toString();
  if (r.exitCode !== 0 && !/error\[E0308\]/.test(err)) throw new Error(`ERROR: ${c.name}: oracle failed: ${err.slice(0, 2000)}`);
  return r.exitCode === 0;
}

test("the oracle agrees with every case's expectation", () => {
  if (!rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    console.log("SKIP: pinned toolchain not installed");
    return;
  }
  for (const c of CASES) {
    const want = c.expect.startsWith("UNPORTED(") ? c.oracle! : c.expect === "true";
    expect(`${c.name} ${oracle_coerces(c)}`).toBe(`${c.name} ${want}`);
  }
}, 120_000);

for (const c of CASES) {
  test(`can_coerce ${c.name}`, () => {
    expect(`${c.name} ${port_can_coerce(c)}`).toBe(`${c.name} ${c.expect}`);
  }, 60_000);
}
