// Tests of lane hir-ty-lowering-b: hir_ty_lowering/mod.rs 2186..3915 (`lower_ty`, `lower_resolved_ty_path`, ...) through
// the `&dyn HirTyLowerer` trait object, on small `#![no_core]` crates.
//
// The port runs the real driver up to `tcx.resolver_for_lowering()` (as rmeta_ty.oracle.test.ts), takes each free
// `type` alias of the crate from the HIR and lowers its type with `lowerer.lower_ty(..)`, which is what the `type_of`
// provider does for a type alias (collect/type_of.rs, `icx.lower_ty(ty)`). The trait object is `ItemCtxt`'s (collect.rs,
// lane collect-a; since merge-w16a, which also dropped the lane's `prohibit_generic_args` mock).
//
// Oracle: the tydump probe (tools/probes/tydump) prints `type_of EarlyBinder { value: <Ty>, .. }` for each alias; the
// port's line is `debug_EarlyBinder` of the lowered type. Cases that stop at another lane's stub are pinned with the
// exact `unported(..)` text (PENDING in the handoff).
//
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { debug_EarlyBinder } from "../../rustc_type_ir/binder.gen.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { ItemCtxt } from "../decls.ts";
import "../lib.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "tydump");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: tydump probe not built (bun scripts/probes.ts build tydump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = join(DATA, "tmp", "hir-ty-lowering-b", process.env.RUST_TS_AGENT ?? "default");

const PRELUDE = `#![feature(no_core, lang_items, never_type)]
#![no_core]
#![allow(dead_code, internal_features, unused_braces)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
`;

/** Cases the port lowers today: each must print the oracle's `type_of` line. */
const SUPPORTED = `${PRELUDE}
pub type T0 = !;
pub type T1 = (!, (), [!]);
pub type T2 = *const !;
pub type T3 = *mut [!];
pub type T4 = (bool, char, u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize, f32, f64);
pub type T5 = *const str;
pub type T6 = ((), ((),), [(*mut (), !)]);
`;

/** An unresolved path (`Res::Err`): resolve reports E0412, lowering gives `{type error}` after a delayed bug. */
const ERRONEOUS = `${PRELUDE}
pub type E0 = Missing;
pub type E1 = (!, *const Missing);
`;

/** Cases that stop at a stub: alias name -> the exact `unported(..)` text. The other aliases of PENDING_SRC (P0, P1, P2
 * (`fn()`: check_abi, lane check-check), P3, P5, P6: lane-a's path / lifetime lowering, collect-rbv's `named_variable_map`, collect-a's `generics_of`, all merged by
 * merge-w16a) must equal the oracle's `type_of` line. */
const PENDING: Record<string, string> = {
  // `lower_const_arg` (array length `3`, an anon const) -> feeds its `type_of`, `lower_const_arg_anon` ->
  // `try_lower_anon_const_lit` -> `tcx.at(..).lit_to_const(..)`: the `lit_to_const` provider is rustc_mir_build's
  // (thir/constant.rs, lane thir-cx-print; re-pinned by small-gaps-18 when the `LitToConstInput` QueryKey landed).
  // Re-pinned by merge-w18: `lit_to_const` is ported; `3usize` is truncated to `usize`'s size, which reads
  // `tcx.data_layout` (rustc_target's `parse_data_layout`, not ported).
  P4: "rustc_target::spec::Target::parse_data_layout (GlobalCtxt::data_layout; pending target-cfg / rustc_abi)",
  // `{ 4 }`: `try_lower_anon_const_lit` unwraps the block, then as P4. PORT: a literal other than P4's, because a
  // query whose provider stopped stays started (the same key would then report a cycle, not the stop)
  P7: "rustc_target::spec::Target::parse_data_layout (GlobalCtxt::data_layout; pending target-cfg / rustc_abi)",
};
const PENDING_SRC = `${PRELUDE}
pub struct S;
pub type P0 = S;
pub type P1 = &'static !;
pub type P2 = fn();
pub type P3<X> = X;
pub type P4 = [!; 3];
const N: usize = 3;
pub type P5 = [!; N];
pub type P6<const M: usize> = [!; M];
pub type P7 = [!; { 4 }];
`;

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
function rustc_args(file: string): string[] {
  return ["--crate-type", "lib", "--edition", "2024", file];
}

/** Lowers every free `type` alias of the crate: alias name -> the `type_of` line, or the UNPORTED stop. */
function port_type_ofs(file: string): Map<string, string> {
  const out = new Map<string, string>();
  let lowered = false;
  try {
    run_compiler(config_from_args(rustc_args(file)), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        void tcx.resolver_for_lowering();
        for (const id of tcx.hir_free_items()) {
          const item = tcx.hir_item(id);
          if (item.kind.$ !== "TyAlias") continue;
          const [ident, , hir_ty] = [item.kind._0, item.kind._1, item.kind._2];
          const lowerer = ItemCtxt.new(tcx, item.owner_id.def_id).lowerer();
          let line: string;
          try {
            const ty: Ty = lowerer.lower_ty(hir_ty);
            line = `type_of ${debug_EarlyBinder(EarlyBinder.bind_unchecked(ty), PLAIN, debug_Ty)}`;
          } catch (e) {
            if (!(e instanceof Unported)) throw e;
            line = `UNPORTED(${e.what})`;
          }
          out.set(Symbol.as_str(ident.name), line);
        }
        lowered = true;
      });
    });
  } catch (e) {
    // A crate with errors: the session aborts (`FatalError`) when the compilation ends, after the lowering above.
    if (!lowered || !(e instanceof FatalErrorMarker)) throw e;
  }
  return out;
}

/** The probe's `type_of` line of every `TyAlias` item: alias name -> line. */
function oracle_type_ofs(file: string, expected_exit = 0): Map<string, string> {
  const r = Bun.spawnSync([PROBE, ...rustc_args(file)], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== expected_exit) throw new Error(`ERROR: tydump failed: ${r.stderr.toString().slice(0, 2000)}`);
  const out = new Map<string, string>();
  let current: string | undefined;
  for (const l of r.stdout.toString().split("\n")) {
    const header = /^DefId\(.*::(\w+)\) TyAlias$/.exec(l);
    if (header) {
      current = header[1]!;
      continue;
    }
    if (!l.startsWith("  ")) current = undefined;
    else if (current !== undefined && l.startsWith("  type_of ")) out.set(current, l.slice(2));
  }
  return out;
}

test.skipIf(SKIP)("lower_ty of type aliases matches the tydump probe's type_of", () => {
  if (!existsSync(PROBE)) throw new Error("ERROR: tydump probe not built (bun scripts/probes.ts build tydump)");
  const file = source_file("supported.rs", SUPPORTED);
  const oracle = oracle_type_ofs(file);
  const ours = port_type_ofs(file);
  expect([...ours.keys()].sort()).toEqual([...oracle.keys()].sort());
  expect(oracle.size).toBe(7);
  for (const [name, line] of oracle) expect(`${name} ${ours.get(name)}`).toBe(`${name} ${line}`);
});

test.skipIf(SKIP)("lower_ty of an unresolved path is a type error, as the tydump probe's type_of", () => {
  if (!existsSync(PROBE)) throw new Error("ERROR: tydump probe not built (bun scripts/probes.ts build tydump)");
  const file = source_file("erroneous.rs", ERRONEOUS);
  const oracle = oracle_type_ofs(file, 1);
  const ours = port_type_ofs(file);
  expect(oracle.size).toBe(2);
  for (const [name, line] of oracle) expect(`${name} ${ours.get(name)}`).toBe(`${name} ${line}`);
});

test("lower_ty stops at the remaining stubs with their exact unported text", () => {
  const ours = port_type_ofs(source_file("pending.rs", PENDING_SRC));
  for (const [name, what] of Object.entries(PENDING)) expect(`${name} ${ours.get(name)}`).toBe(`${name} UNPORTED(${what})`);
});

test.skipIf(SKIP)("lower_ty through ItemCtxt of the once-PENDING paths matches the tydump probe's type_of", () => {
  if (!existsSync(PROBE)) throw new Error("ERROR: tydump probe not built (bun scripts/probes.ts build tydump)");
  const file = source_file("pending.rs", PENDING_SRC);
  const oracle = oracle_type_ofs(file);
  const ours = port_type_ofs(file);
  const names = [...oracle.keys()].filter((n) => !(n in PENDING)).sort();
  expect(names).toEqual(["P0", "P1", "P2", "P3", "P5", "P6"]);
  for (const name of names) expect(`${name} ${ours.get(name)}`).toBe(`${name} ${oracle.get(name)}`);
});
