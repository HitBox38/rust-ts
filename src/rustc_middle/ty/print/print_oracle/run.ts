// Subject side of print.oracle.test.ts (lane ty-print-a; not a port): runs the ported driver on its arguments and,
// in `after_expansion`, prints what probe.rs prints (its header documents the sections and line formats) with the
// ported printer (ty/print/{mod,pretty}.ts) through test_printer.ts's `TestPrinter` (a reduced `FmtPrinter`).
// merge-w15a: kept on `TestPrinter` instead of ty-print-b's `FmtPrinter`: `FmtPrinter` names the regions of binders
// (`prepare_region_info` visits them), and the `fn(..)` rows then stop UNPORTED at `impl TypeVisitable for &List<Ty>`
// (rustc_middle generic_args.rs:714, not ported). Switch to `FmtPrinter` and delete test_printer.ts when it lands.
//   bun run.ts <rustc arguments...>
//
// Scaffolding: none left. The stubs this script used to replace (`Region::flags` / `outer_exclusive_binder`,
// `inherent::Tys::inputs` / `output`, `Ty::is_unit`) are ported (tyir-misc, ty-sty).
import "../../../lib.ts";
import { debug_DefKind, type DefKind } from "../../../../rustc_hir/def.ts";
import type { Compiler, Config } from "../../../../rustc_interface/interface.ts";
import { DefId, DefIndex } from "../../../../rustc_span/def_id.ts";
import { ErrorGuaranteed } from "../../../../rustc_span/lib.ts";
import type { BoundVariableKind, FnSigKind as FnSigKindT, TyVid, IntVid, FloatVid } from "../../../../rustc_type_ir/decls.ts";
import type { Region } from "../../../../rustc_type_ir/sty/mod.ts";
import { debug_SplattedArgIndexError, FnSigKind } from "../../../../rustc_type_ir/ty_kind.ts";
import { PLAIN } from "../../../../std/fmt.ts";
import { unwrap_result } from "../../../../std/result.ts";
import type { TyCtxt } from "../../context.ts";
import { Ty } from "../../mod.ts";
import { with_crate_prefix, with_forced_trimmed_paths } from "../pretty.ts";
import { TestPrinter } from "./test_printer.ts";

/** `format!("{ty}")` with the test printer. */
export function display(tcx: TyCtxt, ty: Ty): string {
  return TestPrinter.print_string(tcx, (p) => p.print_type(ty));
}

/** The `== types` section: probe.rs's list, built with the same `Ty::new_*` constructors (ty/sty.ts). */
export function types(tcx: TyCtxt): [string, Ty][] {
  const t = tcx.types;
  const tup = (ts: Ty[]): Ty => Ty.new_tup(tcx, ts);
  const re_static = tcx.lifetimes.re_static;
  const re_erased = tcx.lifetimes.re_erased;
  const no_vars = tcx.mk_bound_variable_kinds([] as BoundVariableKind[]);
  // `Ty::new_fn_ptr(tcx, Binder::dummy(tcx.mk_fn_sig(inputs, output, kind)))`.
  const fn_ptr = (inputs: Ty[], output: Ty, kind: FnSigKindT): Ty =>
    Ty.new_fn_ptr(tcx, { value: { inputs_and_output: tcx.mk_type_list([...inputs, output]), fn_sig_kind: kind }, bound_vars: no_vars });
  const rust = FnSigKind.dummy();
  const unsafe_c = unwrap_result(FnSigKind.new({ $: "C", unwind: false }, "Unsafe", true, undefined, 1), debug_SplattedArgIndexError);
  const system = unwrap_result(FnSigKind.new({ $: "System", unwind: true }, "Safe", false, undefined, 0), debug_SplattedArgIndexError);
  const ref = (r: Region, ty: Ty, m: "Not" | "Mut"): Ty => (m === "Not" ? Ty.new_imm_ref(tcx, r, ty) : Ty.new_mut_ref(tcx, r, ty));
  return [
    ["bool", t.bool],
    ["char", t.char],
    ["i8", t.i8],
    ["isize", t.isize],
    ["u128", t.u128],
    ["usize", t.usize],
    ["f16", t.f16],
    ["f32", t.f32],
    ["f64", t.f64],
    ["f128", t.f128],
    ["str", t.str_],
    ["never", t.never],
    ["unit", t.unit],
    ["tuple1", tup([t.u8])],
    ["tuple2", tup([t.i32, t.bool])],
    ["tuple_nested", tup([t.unit, tup([t.char]), t.never])],
    ["ref_erased", ref(re_erased, t.i32, "Not")],
    ["ref_static", ref(re_static, t.str_, "Not")],
    ["mut_ref_static", ref(re_static, t.u8, "Mut")],
    ["mut_ref_erased", ref(re_erased, tup([t.u8, t.u16]), "Mut")],
    ["ptr_const", Ty.new_imm_ptr(tcx, t.u8)],
    ["ptr_mut", Ty.new_mut_ptr(tcx, t.unit)],
    ["slice", Ty.new_slice(tcx, t.u8)],
    ["slice_of_refs", Ty.new_slice(tcx, ref(re_static, t.str_, "Not"))],
    ["fn_unit", fn_ptr([], t.unit, rust)],
    ["fn_i32_bool", fn_ptr([t.i32], t.bool, rust)],
    ["fn_two", fn_ptr([t.i32, ref(re_static, t.str_, "Not")], tup([t.u8]), rust)],
    ["fn_unsafe_c_variadic", fn_ptr([t.u8], t.never, unsafe_c)],
    ["fn_system_unwind", fn_ptr([], t.unit, system)],
    ["fn_returning_fn", fn_ptr([t.char], fn_ptr([], t.i64, rust), rust)],
    ["ty_var", Ty.new_var(tcx, 3 as TyVid)],
    ["int_var", Ty.new_int_var(tcx, 0 as IntVid)],
    ["float_var", Ty.new_float_var(tcx, 0 as FloatVid)],
    ["fresh", Ty.new_fresh(tcx, 1)],
    ["fresh_int", Ty.new_fresh_int(tcx, 2)],
    ["fresh_float", Ty.new_fresh_float(tcx, 0)],
    ["error", Ty.new_error(tcx, ErrorGuaranteed.unchecked_error_guaranteed())],
  ];
}

/** probe.rs `paths`: `<label> <DefKind:?> | <def_path_str> | <with_crate_prefix!> | <with_forced_trimmed_paths!>`. */
function paths(tcx: TyCtxt, label: string, def_id: DefId): string {
  const kind: DefKind = tcx.def_kind(def_id);
  const plain = TestPrinter.def_path_str(tcx, def_id);
  const prefix = with_crate_prefix(() => TestPrinter.def_path_str(tcx, def_id));
  // `with_forced_trimmed_paths` prints variants through the `trimmed_def_paths` query (lane ty-print-b).
  let through_variant = false;
  let cur: DefId | undefined = def_id;
  while (cur !== undefined) {
    through_variant ||= tcx.def_kind(cur).$ === "Variant";
    cur = tcx.opt_parent(cur);
  }
  const forced = through_variant ? "-" : with_forced_trimmed_paths(() => TestPrinter.def_path_str(tcx, def_id));
  return `${label} ${debug_DefKind(kind, PLAIN)} | ${plain} | ${prefix} | ${forced}\n`;
}

export function dump(tcx: TyCtxt): string {
  let out = "== types\n";
  for (const [label, ty] of types(tcx)) out += `${label}: ${display(tcx, ty)}\n`;
  out += "== local\n";
  const n = tcx.definitions_untracked().num_definitions();
  for (let i = 1; i < n; i++) out += paths(tcx, String(i), DefId.local(DefIndex.from_u32(i)));
  out += "== lang\n";
  const items = ["OwnedBox", "Option", "OptionSome", "String", "Sized", "Iterator", "FnOnce", "FnOnceOutput"] as const;
  for (const item of items) {
    const def_id = tcx.lang_items().get(item);
    if (def_id !== undefined) out += paths(tcx, item, def_id);
  }
  return out;
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../../rustc_session/config.ts");
  const callbacks = {
    config(_c: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      std_print(dump(tcx));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
