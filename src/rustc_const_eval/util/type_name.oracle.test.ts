// `rustc_const_eval::util::type_name` (lane ctfe-util) against the oracle's `std::any::type_name`.
//
// The intrinsic is not reachable through the port yet (`type_name` is evaluated by interpret/intrinsics.rs, lane
// interp-intrinsics), so the oracle side is the real thing: the pinned rustc builds a host binary from the fixture below,
// whose `main` prints `std::any::type_name::<T>()` / `type_name_of_val(&v)` for every case, and the test runs it. The
// port compiles the same file in-process (target x86_64-unknown-linux-gnu, the oracle sysroot) and calls `type_name` on
// the monomorphic, region-erased type the intrinsic would get: type aliases `T<i>` (`type_of`, then
// `normalize_erasing_regions` in `TypingEnv::fully_monomorphized()`), fn items (`type_of` of the fn, or instantiated with
// `u8`), and closures / async blocks (`type_of` of the closure / coroutine). Same file name, so the same crate name.
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { Unported } from "../../std/panic.ts";
import "../lib.ts";
import { type_name } from "./type_name.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const WORK = join(DATA, "tmp", "ctfe-util-type-name", process.env.RUST_TS_AGENT ?? "default");
const NAME = "type_name_fixture";

/** `type T<i> = ..;` */
const ALIASES = [
  "u8",
  "(bool, char, i128, f64, ())",
  "(u8,)",
  "[u8; 4]",
  "[[u8; 2]; 0]",
  "&'static [u16]",
  "&'static mut str",
  "*const i32",
  "*mut [u8]",
  "str",
  "[u8]",
  "Option<Vec<String>>",
  "Result<(), std::io::Error>",
  "std::collections::HashMap<u8, Plain>",
  "std::rc::Rc<str>",
  "std::marker::PhantomData<fn() -> ()>",
  "core::cell::Cell<&'static mut u8>",
  "Box<dyn Fn(u8) -> u8 + Send>",
  "Box<dyn std::fmt::Debug>",
  "&'static dyn for<'a> Fn(&'a u8) -> &'a u8",
  "dyn Iterator<Item = u8>",
  "fn(u8) -> u16",
  "for<'a> fn(&'a u8, &'static u8) -> &'a u8",
  "unsafe extern \"C\" fn(*const u8, ...)",
  "S<S<u8>>",
  "E<'static>",
  "U",
  "m::Inner<3>",
  "<u8 as m::Tr>::A",
  "Plain",
];

/** `type_name_of_val(&<expr>)` and how the port finds the value's type. */
interface Value {
  expr: string;
  ty: (tcx: TyCtxt, find: (name: string) => DefId, closure_in: (name: string) => DefId) => Ty;
}
const type_of = (tcx: TyCtxt, d: DefId): Ty => Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(d) as EarlyBinder<Ty>));
const VALUES: Value[] = [
  { expr: "f", ty: (tcx, find) => type_of(tcx, find("f")) },
  {
    expr: "g::<u8>",
    ty: (tcx, find) =>
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(find("g")) as EarlyBinder<Ty>, tcx, tcx.mk_args([GenericArg.from_Ty(tcx.types.u8)]), fold_Ty)),
  },
  { expr: "Plain::new", ty: (tcx, find) => type_of(tcx, find("new")) },
  // the trait's `m` with `Self = u8` (a path to a trait item, not the impl's fn)
  {
    expr: "<u8 as m::Tr>::m",
    ty: (tcx, find) =>
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(find("m")) as EarlyBinder<Ty>, tcx, tcx.mk_args([GenericArg.from_Ty(tcx.types.u8)]), fold_Ty)),
  },
  // an inherent impl outside the self type's module: `print_path_with_impl`
  { expr: "Plain::other", ty: (tcx, find) => type_of(tcx, find("other")) },
  // a closure in a trait impl's fn (the impl next to the trait: `print_path_with_qualified`)
  { expr: "m::Tr::mk2(&5u8)", ty: (tcx, _, closure_in) => type_of(tcx, closure_in("mk2")) },
  { expr: "closure()", ty: (tcx, _, closure_in) => type_of(tcx, closure_in("closure")) },
  { expr: "Plain::mk()", ty: (tcx, _, closure_in) => type_of(tcx, closure_in("mk")) },
  { expr: "af()", ty: (tcx, _, closure_in) => type_of(tcx, closure_in("af")) },
];

const SOURCE = [
  "#![allow(dead_code, unused_variables)]",
  "use std::any::{type_name, type_name_of_val};",
  "pub struct S<T>(T);",
  "pub struct Plain;",
  "pub enum E<'a> { A(&'a u8) }",
  "pub union U { a: u8 }",
  "pub mod m {",
  "    pub struct Inner<const N: usize>;",
  "    pub trait Tr { type A; fn m(&self); fn mk2(&self) -> impl Fn(); }",
  "    impl Tr for u8 { type A = u16; fn m(&self) {} fn mk2(&self) -> impl Fn() { || () } }",
  "}",
  "mod n { impl super::Plain { pub fn other() {} } }",
  "impl Plain {",
  "    pub fn new() -> Plain { Plain }",
  "    pub fn mk() -> impl Fn() { || () }",
  "}",
  "pub fn f() {}",
  "pub fn g<T>(t: T) {}",
  "pub fn closure() -> impl Fn(u8) -> u8 { |x| x }",
  "pub async fn af() {}",
  ...ALIASES.map((t, i) => `pub type T${i} = ${t};`),
  "fn main() {",
  ...ALIASES.map((_, i) => `    println!("T${i} {}", type_name::<T${i}>());`),
  ...VALUES.map((v, i) => `    println!("V${i} {}", type_name_of_val(&${v.expr}));`),
  "}",
  "",
].join("\n");

let oracle_lines: string[] | undefined;

beforeAll(() => {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, `${NAME}.rs`), SOURCE);
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const probe = Bun.spawnSync(oracle.oracleRustcCmd(["-vV"]));
  if (probe.exitCode !== 0) {
    if (REQUIRE) throw new Error("ERROR: the pinned rustc is not runnable and RUST_TS_REQUIRE_PROBES=1");
    console.log("SKIP: pinned rustc not runnable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
    return;
  }
  const exe = join(WORK, NAME);
  const b = Bun.spawnSync(oracle.oracleRustcCmd(["--edition", "2024", "-o", exe, `${NAME}.rs`]), { cwd: WORK, stdout: "pipe", stderr: "pipe" });
  if (b.exitCode !== 0) throw new Error(`ERROR: oracle build failed: ${b.stderr.toString().slice(0, 2000)}`);
  const r = Bun.spawnSync([exe], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error("ERROR: oracle binary failed");
  oracle_lines = r.stdout.toString().split("\n").filter((l) => l !== "");
}, 120_000);

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

function port_lines(): string[] {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const dir = join(WORK, "inproc");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${NAME}.rs`);
  writeFileSync(file, SOURCE);
  const out: string[] = [];
  const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", oracle.oracleSysroot(), "--crate-type", "lib", "--edition", "2024", file];
  run_compiler(config_from_args(args), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      const items = tcx.hir_crate_items(null) as ModuleItems;
      // closures and async blocks are nested bodies, not `definitions`
      const defs = [...items.definitions(), ...items.nested_bodies()].map((id) => LocalDefId.to_def_id(id));
      const name_of = (d: DefId): string | undefined => {
        const n = tcx.opt_item_name(d);
        return n === undefined ? undefined : Symbol.as_str(n);
      };
      const find = (name: string): DefId => {
        // `m`: the trait's (not the impl's)
        const d = defs.find((d) => {
          const k = tcx.def_kind(d).$;
          return (k === "Fn" || k === "AssocFn" || k === "TyAlias") && name_of(d) === name && (name !== "m" || tcx.def_kind(tcx.parent(d)).$ === "Trait");
        });
        if (d === undefined) throw new Error(`ERROR: no item ${name}`);
        return d;
      };
      const closure_in = (name: string): DefId => {
        const d = defs.find((d) => tcx.def_kind(d).$ === "Closure" && name_of(tcx.parent(d)) === name);
        if (d === undefined) throw new Error(`ERROR: no closure in ${name}`);
        return d;
      };
      const name_or_stop = (f: () => Ty): string => {
        try {
          return type_name(tcx, f());
        } catch (e) {
          if (!(e instanceof Unported)) throw e;
          return `ERROR: unported: ${e.what}`;
        }
      };
      ALIASES.forEach((_, i) => {
        out.push(
          `T${i} ${name_or_stop(() => tcx.normalize_erasing_regions(TypingEnv.fully_monomorphized(), Unnormalized.new_wip(type_of(tcx, find(`T${i}`))), fold_Ty))}`,
        );
      });
      VALUES.forEach((v, i) => {
        out.push(`V${i} ${name_or_stop(() => v.ty(tcx, find, closure_in))}`);
      });
    });
  });
  return out;
}

test("type_name equals std::any::type_name on every fixture case", () => {
  if (oracle_lines === undefined) return;
  expect(oracle_lines.length).toBe(ALIASES.length + VALUES.length);
  expect(port_lines()).toEqual(oracle_lines);
}, 120_000);
