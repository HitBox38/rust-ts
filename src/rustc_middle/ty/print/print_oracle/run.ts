// Subject side of print.oracle.test.ts (lane ty-print-a; not a port): runs the ported driver on its arguments and,
// in `after_expansion`, prints what probe.rs prints (its header documents the sections and line formats) with the
// ported printer (ty/print/{mod,pretty}.ts) through test_printer.ts's `TestPrinter` (a reduced `FmtPrinter`).
//   bun run.ts <rustc arguments...>
//
// Scaffolding: four methods the printer reaches are still `unported` stubs of other lanes' files; this script
// installs their upstream bodies before running (they do not affect what is printed beyond what upstream does):
// - `Region::flags` / `Region::outer_exclusive_binder` (rustc_type_ir sty/mod.rs:260 / :264, via `type_flags` :198),
//   needed to intern `&'a T`;
// - `inherent::Tys::inputs` / `output` for `&List<Ty>` (rustc_middle ty/sty.rs:2181 / :2185), needed by `FnSig`;
// - `Ty::is_unit` (ty/sty.rs:1139), needed by `pretty_print_fn_sig`.
import "../../../lib.ts";
import { debug_DefKind, type DefKind } from "../../../../rustc_hir/def.ts";
import type { Compiler, Config } from "../../../../rustc_interface/interface.ts";
import { DefId, DefIndex } from "../../../../rustc_span/def_id.ts";
import { ErrorGuaranteed } from "../../../../rustc_span/lib.ts";
import type { BoundVariableKind, FnSigKind as FnSigKindT, TyKind, TyVid, IntVid, FloatVid } from "../../../../rustc_type_ir/decls.ts";
import { INNERMOST } from "../../../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../../../rustc_type_ir/flags.ts";
import type { DebruijnIndex } from "../../../../rustc_type_ir/lib.ts";
import { Region } from "../../../../rustc_type_ir/sty/mod.ts";
import { debug_SplattedArgIndexError, FnSigKind, PolyFnSig } from "../../../../rustc_type_ir/ty_kind.ts";
import { PLAIN } from "../../../../std/fmt.ts";
import { unwrap_result } from "../../../../std/result.ts";
import type { TyCtxt } from "../../context.ts";
import { RawList } from "../../list.ts";
import { Ty } from "../../mod.ts";
import { with_crate_prefix, with_forced_trimmed_paths } from "../pretty.ts";
import { TestPrinter } from "./test_printer.ts";

/** Upstream bodies of the stubs listed in the header; returns a function that puts the stubs back. */
export function install_scaffolding(): () => void {
  const saved: [object, string, PropertyDescriptor | undefined][] = [];
  for (const [o, k] of [
    [Region.prototype, "type_flags"],
    [Region.prototype, "flags"],
    [Region.prototype, "outer_exclusive_binder"],
    [RawList.prototype, "inputs"],
    [RawList.prototype, "output"],
    [Ty.prototype, "is_unit"],
  ] as const) {
    saved.push([o, k, Object.getOwnPropertyDescriptor(o, k)]);
  }
  const region = Region.prototype as unknown as { type_flags(): TypeFlags; flags(): TypeFlags; outer_exclusive_binder(): DebruijnIndex };
  // sty/mod.rs:198 type_flags
  region.type_flags = function (this: Region): TypeFlags {
    let flags = TypeFlags.empty();
    const k = this.kind();
    const or = (a: TypeFlags, b: TypeFlags) => (a | b) as TypeFlags;
    switch (k.$) {
      case "ReVar":
        flags = or(or(or(flags, TypeFlags.HAS_FREE_REGIONS), TypeFlags.HAS_FREE_LOCAL_REGIONS), TypeFlags.HAS_RE_INFER);
        break;
      case "RePlaceholder":
        flags = or(or(or(flags, TypeFlags.HAS_FREE_REGIONS), TypeFlags.HAS_FREE_LOCAL_REGIONS), TypeFlags.HAS_RE_PLACEHOLDER);
        break;
      case "ReEarlyParam":
        flags = or(or(or(flags, TypeFlags.HAS_FREE_REGIONS), TypeFlags.HAS_FREE_LOCAL_REGIONS), TypeFlags.HAS_RE_PARAM);
        break;
      case "ReLateParam":
        flags = or(or(flags, TypeFlags.HAS_FREE_REGIONS), TypeFlags.HAS_FREE_LOCAL_REGIONS);
        break;
      case "ReStatic":
        flags = or(flags, TypeFlags.HAS_FREE_REGIONS);
        break;
      case "ReBound":
        flags = or(flags, TypeFlags.HAS_RE_BOUND);
        if (k._0.$ === "Canonical") flags = or(flags, TypeFlags.HAS_CANONICAL_BOUND);
        break;
      case "ReErased":
        flags = or(flags, TypeFlags.HAS_RE_ERASED);
        break;
      case "ReError":
        flags = or(or(flags, TypeFlags.HAS_FREE_REGIONS), TypeFlags.HAS_RE_ERROR);
        break;
    }
    return flags;
  };
  // sty/mod.rs:260 flags
  region.flags = function (this: Region): TypeFlags {
    return (this as unknown as { type_flags(): TypeFlags }).type_flags();
  };
  // sty/mod.rs:264 outer_exclusive_binder
  region.outer_exclusive_binder = function (this: Region): DebruijnIndex {
    const k = this.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound") return ((k._0._0 as number) + 1) as DebruijnIndex;
    return INNERMOST;
  };
  const list = RawList.prototype as unknown as { inputs(): readonly Ty[]; output(): Ty };
  // ty/sty.rs:2181 inputs: `self.split_last().unwrap().1`
  list.inputs = function (this: readonly Ty[]): readonly Ty[] {
    return this.slice(0, this.length - 1);
  };
  // ty/sty.rs:2185 output: `*self.split_last().unwrap().0`
  list.output = function (this: readonly Ty[]): Ty {
    return this[this.length - 1]!;
  };
  // ty/sty.rs:1139 is_unit: `matches!(self.kind(), Tuple(tys) if tys.is_empty())`
  (Ty.prototype as unknown as { is_unit(): boolean }).is_unit = function (this: Ty): boolean {
    const k = this.kind();
    return k.$ === "Tuple" && k._0.length === 0;
  };
  return () => {
    for (const [o, k, d] of saved) {
      if (d === undefined) delete (o as Record<string, unknown>)[k];
      else Object.defineProperty(o, k, d);
    }
  };
}

/** `format!("{ty}")` with the test printer. */
export function display(tcx: TyCtxt, ty: Ty): string {
  return TestPrinter.print_string(tcx, (p) => p.print_type(ty));
}

/** The `== types` section: probe.rs's list, built through the interners (the `Ty::new_*` constructors are stubs). */
export function types(tcx: TyCtxt): [string, Ty][] {
  const t = tcx.types;
  const mk = (k: TyKind): Ty => tcx.mk_ty_from_kind(k);
  const tup = (ts: Ty[]): Ty => mk({ $: "Tuple", _0: tcx.mk_type_list(ts) });
  const re_static = tcx.lifetimes.re_static;
  const re_erased = tcx.lifetimes.re_erased;
  const no_vars = tcx.mk_bound_variable_kinds([] as BoundVariableKind[]);
  // `Ty::new_fn_ptr(tcx, Binder::dummy(tcx.mk_fn_sig(inputs, output, kind)))` (sty.rs:723: `fty.split()`).
  const fn_ptr = (inputs: Ty[], output: Ty, kind: FnSigKindT): Ty => {
    const [sig_tys, hdr] = PolyFnSig.split({ value: { inputs_and_output: tcx.mk_type_list([...inputs, output]), fn_sig_kind: kind }, bound_vars: no_vars });
    return mk({ $: "FnPtr", _0: sig_tys, _1: hdr });
  };
  const rust = FnSigKind.dummy();
  const unsafe_c = unwrap_result(FnSigKind.new({ $: "C", unwind: false }, "Unsafe", true, undefined, 1), debug_SplattedArgIndexError);
  const system = unwrap_result(FnSigKind.new({ $: "System", unwind: true }, "Safe", false, undefined, 0), debug_SplattedArgIndexError);
  const ref = (r: Region, ty: Ty, m: "Not" | "Mut"): Ty => mk({ $: "Ref", _0: r, _1: ty, _2: m });
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
    ["ptr_const", mk({ $: "RawPtr", _0: t.u8, _1: "Not" })],
    ["ptr_mut", mk({ $: "RawPtr", _0: t.unit, _1: "Mut" })],
    ["slice", mk({ $: "Slice", _0: t.u8 })],
    ["slice_of_refs", mk({ $: "Slice", _0: ref(re_static, t.str_, "Not") })],
    ["fn_unit", fn_ptr([], t.unit, rust)],
    ["fn_i32_bool", fn_ptr([t.i32], t.bool, rust)],
    ["fn_two", fn_ptr([t.i32, ref(re_static, t.str_, "Not")], tup([t.u8]), rust)],
    ["fn_unsafe_c_variadic", fn_ptr([t.u8], t.never, unsafe_c)],
    ["fn_system_unwind", fn_ptr([], t.unit, system)],
    ["fn_returning_fn", fn_ptr([t.char], fn_ptr([], t.i64, rust), rust)],
    ["ty_var", mk({ $: "Infer", _0: { $: "TyVar", _0: 3 as TyVid } })],
    ["int_var", mk({ $: "Infer", _0: { $: "IntVar", _0: 0 as IntVid } })],
    ["float_var", mk({ $: "Infer", _0: { $: "FloatVar", _0: 0 as FloatVid } })],
    ["fresh", mk({ $: "Infer", _0: { $: "FreshTy", _0: 1 } })],
    ["fresh_int", mk({ $: "Infer", _0: { $: "FreshIntTy", _0: 2 } })],
    ["fresh_float", mk({ $: "Infer", _0: { $: "FreshFloatTy", _0: 0 } })],
    ["error", mk({ $: "Error", _0: ErrorGuaranteed.unchecked_error_guaranteed() })],
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
  install_scaffolding();
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
