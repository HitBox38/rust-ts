// Tests of lane hir-ty-lowering-b: hir_ty_lowering/mod.rs 2186..3915 (`lower_ty`, `lower_resolved_ty_path`, ...) through
// the `&dyn HirTyLowerer` trait object, on small `#![no_core]` crates.
//
// The port runs the real driver up to `tcx.resolver_for_lowering()` (as rmeta_ty.oracle.test.ts), takes each free
// `type` alias of the crate from the HIR and lowers its type with `lowerer.lower_ty(..)`, which is what the `type_of`
// provider does for a type alias (collect/type_of.rs, `icx.lower_ty(ty)`). The trait object's vtable is a test-local
// `HirTyLowererImpl` (`TestCtxt` below): `ItemCtxt`'s impl (collect.rs, lane collect-a) is still a stub. Its methods are
// those of `impl HirTyLowerer for ItemCtxt` that these cases reach (`tcx`, `dcx`, `item_def_id`, `record_ty`); the rest
// stop as UNPORTED.
//
// Oracle: the tydump probe (tools/probes/tydump) prints `type_of EarlyBinder { value: <Ty>, .. }` for each alias; the
// port's line is `debug_EarlyBinder` of the lowered type. Cases that stop at another lane's stub are pinned with the
// exact `unported(..)` text (PENDING in the handoff).
//
// `prohibit_generic_args` (mod.rs:1995, lane hir-ty-lowering-a) is mocked with its upstream body for segments without
// generic args or constraints (`Ok(())`); a segment with either makes the mock throw. The mock is installed only around
// the lowering calls of the oracle test.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { debug_EarlyBinder } from "../../rustc_type_ir/binder.gen.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unported, Unported } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import { HirTyLowerer, type HirTyLowererImpl } from "../decls.ts";
import "../lib.ts";
import { HirTyLowerer_provided } from "./mod.ts";

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

/** Cases that stop at another lane's stub: alias name -> the exact `unported(..)` text. */
const PENDING: Record<string, string> = {
  // `lower_resolved_ty_path` -> `lower_path_segment` (mod.rs:1217, lane hir-ty-lowering-a)
  P0: "rustc_hir_analysis::hir_ty_lowering::HirTyLowerer::lower_path_segment",
  // `lower_ty` (Ref) -> `lower_lifetime` (mod.rs:580, lane hir-ty-lowering-a)
  P1: "rustc_hir_analysis::hir_ty_lowering::HirTyLowerer::lower_lifetime",
  // `lower_ty` (FnPtr) -> lib.rs `check_c_variadic_abi` (lane collect-a)
  P2: "rustc_hir_analysis::check_c_variadic_abi",
  // `lower_ty_param` -> `tcx.named_bound_var` -> the `named_variable_map` query (collect/resolve_bound_vars.rs, lane
  // collect-rbv; its `provide` is a no-op stub, so the query keeps rustc_interface's placeholder provider)
  P3: "named_variable_map provider (not ported)",
  // `lower_const_arg` (array length `3`, an anon const) -> feeds its `type_of`, `lower_const_arg_anon` ->
  // `try_lower_anon_const_lit` -> `tcx.at(..).lit_to_const(..)`: the query key `LitToConstInput` has no TS `QueryKey`
  // (rustc_middle query/keys.rs)
  P4: "rustc_middle::query::keys: QueryKey for `LitToConstInput<'tcx>` (cache)",
  // `lower_const_arg_anon` (not a literal) -> `GenericArgs::identity_for_item` -> `generics_of` (lane collect-a)
  P5: "rustc_hir_analysis::collect::generics_of::generics_of",
  // `lower_resolved_const_path` (a bare const param) -> `lower_const_param` -> `tcx.named_bound_var` (as P3)
  P6: "named_variable_map provider (not ported)",
  // `{ 3 }`: `try_lower_anon_const_lit` unwraps the block, then as P4
  P7: "rustc_middle::query::keys: QueryKey for `LitToConstInput<'tcx>` (cache)",
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
pub type P7 = [!; { 3 }];
`;

/** The test's `impl HirTyLowerer for TestCtxt`: `ItemCtxt`'s methods that the cases reach (collect.rs:481..). */
class TestCtxt {
  constructor(
    readonly tcx: TyCtxt,
    readonly item_def_id: LocalDefId,
  ) {}
}
function todo(what: string): never {
  return unported(`test TestCtxt::${what}`);
}
const TestCtxt_impl: HirTyLowererImpl<TestCtxt> = {
  tcx(this: TestCtxt) {
    return this.tcx;
  },
  dcx(this: TestCtxt) {
    return this.tcx.dcx();
  },
  item_def_id(this: TestCtxt) {
    return this.item_def_id;
  },
  mod_id: () => todo("mod_id"),
  re_infer: () => todo("re_infer"),
  ty_infer: () => todo("ty_infer"),
  ct_infer: () => todo("ct_infer"),
  register_trait_ascription_bounds: () => todo("register_trait_ascription_bounds"),
  probe_ty_param_bounds: () => todo("probe_ty_param_bounds"),
  select_inherent_assoc_candidates: () => todo("select_inherent_assoc_candidates"),
  lower_assoc_item_path: () => todo("lower_assoc_item_path"),
  lower_fn_sig: () => todo("lower_fn_sig"),
  probe_adt: () => todo("probe_adt"),
  // ItemCtxt::record_ty (collect.rs:703) does nothing.
  record_ty() {},
  infcx: () => todo("infcx"),
  dyn_compatibility_violations: () => todo("dyn_compatibility_violations"),
};

/** `prohibit_generic_args` (mod.rs:1995) for segments with neither generic args nor constraints: `Ok(())`. */
function with_prohibit_generic_args_mock<R>(f: () => R): R {
  const proto = HirTyLowerer.prototype as unknown as Record<string, unknown>;
  const original = proto.prohibit_generic_args;
  proto.prohibit_generic_args = function (segments: Iterable<hir.PathSegment>) {
    for (const segment of segments) {
      const args = segment.args_();
      if (args.args.length !== 0 || args.constraints.length !== 0) throw new Error("test mock: prohibit_generic_args with generic args");
    }
    return Ok(undefined);
  };
  try {
    return f();
  } finally {
    proto.prohibit_generic_args = original;
  }
}

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
function port_type_ofs(file: string, mock: boolean): Map<string, string> {
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
          const lowerer = HirTyLowerer_provided.lowerer(new TestCtxt(tcx, item.owner_id.def_id), TestCtxt_impl);
          let line: string;
          try {
            const lower = () => lowerer.lower_ty(hir_ty);
            const ty: Ty = mock ? with_prohibit_generic_args_mock(lower) : lower();
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
  const ours = port_type_ofs(file, true);
  expect([...ours.keys()].sort()).toEqual([...oracle.keys()].sort());
  expect(oracle.size).toBe(7);
  for (const [name, line] of oracle) expect(`${name} ${ours.get(name)}`).toBe(`${name} ${line}`);
});

test.skipIf(SKIP)("lower_ty of an unresolved path is a type error, as the tydump probe's type_of", () => {
  if (!existsSync(PROBE)) throw new Error("ERROR: tydump probe not built (bun scripts/probes.ts build tydump)");
  const file = source_file("erroneous.rs", ERRONEOUS);
  const oracle = oracle_type_ofs(file, 1);
  const ours = port_type_ofs(file, true);
  expect(oracle.size).toBe(2);
  for (const [name, line] of oracle) expect(`${name} ${ours.get(name)}`).toBe(`${name} ${line}`);
});

test("lower_ty stops at other lanes' stubs with their exact unported text", () => {
  const ours = port_type_ofs(source_file("pending.rs", PENDING_SRC), true);
  for (const [name, what] of Object.entries(PENDING)) expect(`${name} ${ours.get(name)}`).toBe(`${name} UNPORTED(${what})`);
});

test("without the mock, a resolved path stops at prohibit_generic_args (lane hir-ty-lowering-a)", () => {
  const ours = port_type_ofs(source_file("supported.rs", SUPPORTED), false);
  // `!`, tuples, slices and raw pointers of them never reach a resolved path.
  for (const name of ["T0", "T1", "T2", "T3", "T6"]) expect(ours.get(name)!.startsWith("type_of EarlyBinder { value: ")).toBe(true);
  for (const name of ["T4", "T5"]) {
    expect(ours.get(name)).toBe("UNPORTED(rustc_hir_analysis::hir_ty_lowering::HirTyLowerer::prohibit_generic_args)");
  }
});
