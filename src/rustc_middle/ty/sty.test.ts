// Tests of lane ty-sty: rustc_middle ty/sty.rs (the `Ty::new_*` constructors, the `Ty` helpers, `inherent::Tys`,
// `CoroutineArgsExt`, `InlineConstArgs`, `ParamTy` / `ParamConst`, `Article`) on a `TyCtxt` over fresh interners.
//
// Oracle: sty_oracle/probe.rs is a rustc-dev program that builds the same types with rustc's own constructors and prints,
// per type, its Display, the `is_*` / `has_*` predicates that hold, the `Option`-returning helpers and `Ty::walk`, then
// a few identities and free helpers. The fixture sty_oracle/sty.stdout is its output (`REGEN=1` rebuilds the probe and
// rewrites it); `oracle_dump` below prints the same with the port (Display through ty-print-b's `FmtPrinter`).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../lib.ts";
import { PIN } from "../../../scripts/lib/common.ts";
import { create_default_session_globals_then, ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { kw, Symbol } from "../../rustc_span/symbol.ts";
import { Limit } from "../../rustc_structures/limit.ts";
import { Binder, PlaceholderType } from "../../rustc_type_ir/binder.ts";
import type { BoundVar, ConstVid, DebruijnIndex, FloatVid, IntVid, TyVid, UniverseIndex } from "../../rustc_type_ir/decls.ts";
import { CollectAndApply_Result } from "../../rustc_type_ir/interner.ts";
import { INNERMOST } from "../../rustc_type_ir/lib.ts";
import { Const } from "../../rustc_type_ir/sty/mod.ts";
import { standin_fold_Ty } from "../../rustc_type_ir/fold.ts";
import { FnSigKind, UnsafeBinderInner } from "../../rustc_type_ir/ty_kind.ts";
import { debug_Mutability } from "../../rustc_ast_ir/lib.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import { GenericArg } from "./generic_args.ts";
import { RawList } from "./list.ts";
import { FieldDef, RestrictionKind, Ty, VariantDef, VariantFlags, Visibility } from "./mod.ts";
import { AdtDef, AdtDefData, AdtFlags } from "./adt.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { print_Ty } from "./print/mod.ts";
import { FmtPrinter } from "./print/pretty.ts";
import { TestPrinter } from "./print/print_oracle/test_printer.ts";
import type { ReprOptions, VariantIdx } from "./decls.ts";
import { Article_TyKind, CoroutineArgsExt, InlineConstArgs, ParamConst, ParamTy } from "./sty.ts";

const DIR = join(import.meta.dir, "sty_oracle");
const FIXTURE = join(DIR, "sty.stdout");
const REGEN = process.env.REGEN === "1";

if (REGEN) {
  const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const s = oracleSysroot();
  const out = join(tmpdir(), "rust-ts-ty-sty-probe");
  mkdirSync(out, { recursive: true });
  const exe = join(out, "probe");
  const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: DIR, env: { ...process.env, RUSTC_ICE: "0" }, stdout: "pipe", stderr: "pipe" });
  const b = run(["rustc", `+${PIN.toolchain}`, "--edition", "2024", join(DIR, "probe.rs"), "-o", exe, "-C", `link-arg=-Wl,-rpath,${s}/lib`]);
  if (b.exitCode !== 0) throw new Error(`ERROR: probe build failed: ${b.stderr.toString().split("\n")[0]}`);
  const r = run([exe, "--edition=2021", "--crate-type", "lib", "--sysroot", s, "empty.rs"]);
  if (r.exitCode !== 0) throw new Error(`ERROR: probe exit ${r.exitCode}`);
  writeFileSync(FIXTURE, r.stdout.toString());
}

/** A `TyCtxt` over fresh interners; `sess` is the minimal fake `FmtPrinter` reads (as print.test.ts). */
/** A struct `AdtDef` with one field (merge-w15b: real `AdtDef` / `VariantDef` / `FieldDef`). */
function adt_def(unsafe_field: boolean): AdtDef {
  const did = (i: number): DefId => new DefId(DefIndex.from_u32(i), LOCAL_CRATE);
  const field = new FieldDef(did(101), kw.Underscore, Visibility.Public, RestrictionKind.Unrestricted, unsafe_field ? "Unsafe" : "Safe", undefined);
  const variant = new VariantDef(did(100), undefined, kw.Underscore, { $: "Relative", _0: 0 }, [field], undefined, VariantFlags.NO_VARIANT_FLAGS);
  return new AdtDef(new AdtDefData(did(unsafe_field ? 99 : 98), [variant], AdtFlags.IS_STRUCT, {} as ReprOptions));
}

function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
    sess: {
      opts: { trimmed_def_paths: false, unstable_opts: { trim_diagnostic_paths: true } },
      verbose_internals: () => false,
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

/** `format!("{ty}")` through `FmtPrinter` (ty-print-b; `new_with_limit` as print.test.ts). `FmtPrinter` names the regions
 *  of binders first (`prepare_region_info`), which stops UNPORTED at `impl TypeVisitable for &List<Ty>` (generic_args.rs,
 *  lane ty-args; merge-w15a note): `fn(..)` types print through ty-print-a's `TestPrinter`
 *  (the reduced `FmtPrinter` the print oracle uses) until then. */
function display(tcx: TyCtxt, ty: Ty): string {
  let has_binder = false;
  for (const a of ty.walk()) if (a instanceof Ty && a.kind().$ === "FnPtr") has_binder = true;
  if (has_binder) return TestPrinter.print_string(tcx, (p) => p.print_type(ty));
  const p = FmtPrinter.new_with_limit(tcx, "TypeNS", Limit.new(2 ** 24));
  if (print_Ty(ty, p).$ === "Err") throw new Error("ERROR: fmt::Error");
  return p.into_buffer();
}

const sg = (f: () => void) => () => create_default_session_globals_then(f);
const Sized = "Sized" as never;
const MetaSized = "MetaSized" as never;

/** probe.rs's `types` list, built with the ported constructors. */
function types(tcx: TyCtxt): [string, Ty][] {
  const t = tcx.types;
  const re_static = tcx.lifetimes.re_static;
  const re_erased = tcx.lifetimes.re_erased;
  const sym_t = Symbol.intern("T");
  const sym_n = Symbol.intern("N");
  const guar = ErrorGuaranteed.unchecked_error_guaranteed();
  const no_vars = tcx.mk_bound_variable_kinds([]);
  const fn_ptr = (inputs: Ty[], output: Ty): Ty =>
    Ty.new_fn_ptr(tcx, { value: { inputs_and_output: tcx.mk_type_list([...inputs, output]), fn_sig_kind: FnSigKind.dummy() }, bound_vars: no_vars });
  const n_param = Const.new_param(tcx, ParamConst.new(1, sym_n));
  const ct_var = Const.new_var(tcx, 0 as ConstVid);
  return [
    ["new_bool", Ty.new_bool(tcx)],
    ["new_u8", Ty.new_u8(tcx)],
    ["new_unit", Ty.new_unit(tcx)],
    ["new_usize", Ty.new_usize(tcx)],
    ["char", t.char],
    ["str", t.str_],
    ["never", t.never],
    ["new_int_i8", Ty.new_int(tcx, "I8")],
    ["new_int_i16", Ty.new_int(tcx, "I16")],
    ["new_int_i32", Ty.new_int(tcx, "I32")],
    ["new_int_i64", Ty.new_int(tcx, "I64")],
    ["new_int_i128", Ty.new_int(tcx, "I128")],
    ["new_int_isize", Ty.new_int(tcx, "Isize")],
    ["new_uint_u32", Ty.new_uint(tcx, "U32")],
    ["new_uint_usize", Ty.new_uint(tcx, "Usize")],
    ["new_float_f16", Ty.new_float(tcx, "F16")],
    ["new_float_f64", Ty.new_float(tcx, "F64")],
    ["new_tup_empty", Ty.new_tup(tcx, [])],
    ["new_tup", Ty.new_tup(tcx, [t.i32, t.bool])],
    ["new_tup_unsized_tail", Ty.new_tup(tcx, [t.u8, t.str_])],
    ["new_tup_from_iter", Ty.new_tup_from_iter(tcx, [t.u8, t.char, t.unit])],
    ["new_tup_four", Ty.new_tup(tcx, [t.u8, t.u8, t.u8, t.u8])],
    ["new_static_str", Ty.new_static_str(tcx)],
    ["new_imm_ref", Ty.new_imm_ref(tcx, re_erased, t.i32)],
    ["new_mut_ref", Ty.new_mut_ref(tcx, re_static, Ty.new_slice(tcx, t.u8))],
    ["new_ref_param", Ty.new_ref(tcx, re_static, Ty.new_param(tcx, 1, sym_t), "Not")],
    ["new_imm_ptr", Ty.new_imm_ptr(tcx, t.u8)],
    ["new_mut_ptr", Ty.new_mut_ptr(tcx, Ty.new_slice(tcx, t.u8))],
    ["new_ptr_str", Ty.new_ptr(tcx, t.str_, "Mut")],
    ["new_slice", Ty.new_slice(tcx, t.u16)],
    ["new_slice_str", Ty.new_slice(tcx, t.str_)],
    ["new_array_with_const_len", Ty.new_array_with_const_len(tcx, t.u8, n_param)],
    ["new_array_var", Ty.new_array_with_const_len(tcx, t.never, ct_var)],
    ["new_fn_ptr", fn_ptr([t.i32], t.bool)],
    ["new_fn_ptr_unit", fn_ptr([], t.unit)],
    ["new_param_self", Ty.new_param(tcx, 0, kw.SelfUpper)],
    ["new_param_t", Ty.new_param(tcx, 1, sym_t)],
    ["param_ty_to_ty", ParamTy.to_ty(ParamTy.new(2, sym_t), tcx)],
    ["ir_new_param", Ty.ir_new_param(tcx, ParamTy.new(0, sym_t))],
    ["new_var", Ty.new_var(tcx, 3 as TyVid)],
    ["new_var_big", Ty.new_var(tcx, 500 as TyVid)],
    ["new_int_var", Ty.new_int_var(tcx, 0 as IntVid)],
    ["new_float_var", Ty.new_float_var(tcx, 4 as FloatVid)],
    ["new_infer", Ty.new_infer(tcx, { $: "TyVar", _0: 7 as TyVid })],
    ["new_fresh", Ty.new_fresh(tcx, 1)],
    ["new_fresh_big", Ty.new_fresh(tcx, 50)],
    ["new_fresh_int", Ty.new_fresh_int(tcx, 2)],
    ["new_fresh_float", Ty.new_fresh_float(tcx, 0)],
    ["new_canonical_bound", Ty.new_canonical_bound(tcx, 0 as BoundVar)],
    ["new_anon_bound", Ty.new_anon_bound(tcx, INNERMOST, 1 as BoundVar)],
    ["new_bound_shifted", Ty.new_bound(tcx, 1 as DebruijnIndex, { var: 0 as BoundVar, kind: { $: "Anon" } })],
    ["new_placeholder", Ty.new_placeholder(tcx, PlaceholderType.new_anon(1 as UniverseIndex, 2 as BoundVar))],
    ["new_error", Ty.new_error(tcx, guar)],
    ["from_closure_kind_fn", Ty.from_closure_kind(tcx, "Fn")],
    ["from_closure_kind_fn_mut", Ty.from_closure_kind(tcx, "FnMut")],
    ["from_closure_kind_fn_once", Ty.from_closure_kind(tcx, "FnOnce")],
    ["from_coroutine_closure_kind_fn", Ty.from_coroutine_closure_kind(tcx, "Fn")],
    ["from_coroutine_closure_kind_fn_once", Ty.from_coroutine_closure_kind(tcx, "FnOnce")],
  ];
}

/** probe.rs `line`. */
function line(tcx: TyCtxt, label: string, ty: Ty): string {
  const d = (t: Ty) => display(tcx, t);
  const opt = <T>(o: T | undefined, f: (v: T) => string): string => (o === undefined ? "-" : f(o));
  let out = `${label}: ${d(ty)}\n`;
  const preds: [string, boolean][] = [
    ["unit", ty.is_unit()],
    ["usize", ty.is_usize()],
    ["usize_like", ty.is_usize_like()],
    ["never", ty.is_never()],
    ["primitive", ty.is_primitive()],
    ["adt", ty.is_adt()],
    ["self_param", ty.is_self_param()],
    ["ref", ty.is_ref()],
    ["ty_var", ty.is_ty_var()],
    ["ty_or_numeric_infer", ty.is_ty_or_numeric_infer()],
    ["phantom_data", ty.is_phantom_data()],
    ["bool", ty.is_bool()],
    ["str", ty.is_str()],
    ["imm_ref_str", ty.is_imm_ref_str()],
    ["param0", ty.is_param(0)],
    ["slice", ty.is_slice()],
    ["array_slice", ty.is_array_slice()],
    ["array", ty.is_array()],
    ["simd", ty.is_simd()],
    ["mutable_ptr", ty.is_mutable_ptr()],
    ["raw_ptr", ty.is_raw_ptr()],
    ["any_ptr", ty.is_any_ptr()],
    ["box", ty.is_box()],
    ["scalar", ty.is_scalar()],
    ["floating_point", ty.is_floating_point()],
    ["trait", ty.is_trait()],
    ["enum", ty.is_enum()],
    ["closure", ty.is_closure()],
    ["coroutine", ty.is_coroutine()],
    ["integral", ty.is_integral()],
    ["fresh_ty", ty.is_fresh_ty()],
    ["fresh", ty.is_fresh()],
    ["char", ty.is_char()],
    ["numeric", ty.is_numeric()],
    ["signed", ty.is_signed()],
    ["ptr_sized_integral", ty.is_ptr_sized_integral()],
    ["concrete_skeleton", ty.has_concrete_skeleton()],
    ["fn", ty.is_fn()],
    ["fn_ptr", ty.is_fn_ptr()],
    ["opaque", ty.is_opaque()],
    ["known_rigid", ty.is_known_rigid()],
    ["pure_clone_copy", ty.is_trivially_pure_clone_copy()],
    ["trivially_wf", ty.is_trivially_wf(tcx)],
    ["like_maybe_dangling", ty.is_like_maybe_dangling()],
  ];
  const k = ty.kind();
  const fresh = k.$ === "Infer" && (k._0.$ === "FreshTy" || k._0.$ === "FreshIntTy" || k._0.$ === "FreshFloatTy");
  const is = preds.filter(([, b]) => b).map(([n]) => n);
  if (!fresh) {
    if (ty.has_trivial_sizedness(tcx, Sized)) is.push("sized");
    if (ty.has_trivial_sizedness(tcx, MetaSized)) is.push("meta_sized");
  }
  out += `  is: ${is.join(" ")}\n`;
  let closure_kind = "n/a";
  if ((k.$ === "Int" && (k._0 === "I8" || k._0 === "I16" || k._0 === "I32")) || k.$ === "Bound" || k.$ === "Placeholder" || k.$ === "Param" || k.$ === "Infer" || k.$ === "Error") {
    closure_kind = ty.to_opt_closure_kind() ?? "-";
  }
  const seq = k.$ === "Array" || k.$ === "Slice" || k.$ === "Str" ? d(ty.sequence_element_type(tcx)) : "n/a";
  const no_discr =
    k.$ === "Param" ||
    k.$ === "Alias" ||
    (k.$ === "Infer" && k._0.$ !== "IntVar" && k._0.$ !== "FloatVar") ||
    k.$ === "Adt" ||
    k.$ === "Bound" ||
    k.$ === "Placeholder" ||
    k.$ === "Coroutine" ||
    k.$ === "Pat";
  const discr = no_discr ? "n/a" : d(ty.discriminant_ty(tcx));
  out +=
    `  opt: ty_vid=${opt(ty.ty_vid(), String)} float_vid=${opt(ty.float_vid(), String)} ` +
    `ref_mutability=${opt(ty.ref_mutability(), (m) => debug_Mutability(m, { alternate: false } as never))} ` +
    `deref_explicit=${opt(ty.builtin_deref(true), d)} deref=${opt(ty.builtin_deref(false), d)} index=${opt(ty.builtin_index(), d)} ` +
    `primitive_symbol=${opt(ty.primitive_symbol(), Symbol.as_str)} tuple_len=${opt(ty.opt_tuple_fields(), (l) => String(l.length))} ` +
    `closure_kind=${closure_kind} seq=${seq} discr=${discr}\n`;
  const walk: string[] = [];
  for (const a of ty.walk()) {
    if (a instanceof Ty) walk.push(d(a));
  }
  out += `  walk: ${walk.join(", ")}\n`;
  return out;
}

/** probe.rs's `after_expansion` output. */
function oracle_dump(tcx: TyCtxt): string {
  const t = tcx.types;
  const d = (ty: Ty) => display(tcx, ty);
  // PORT (test): `{:?}` of a `&[Ty]` / `&List<Ty>` is a Debug list of `Ty`'s Debug, which is its Display with no trimmed
  // paths (structural_impls.rs; `debug_Ty` is still a stub there).
  const dlist = (ts: readonly Ty[]) => `[${ts.map(d).join(", ")}]`;
  const tys = types(tcx);
  let out = "== types\n";
  for (const [label, ty] of tys) out += line(tcx, label, ty);
  out += "== identities\n";
  out += `new_var_preinterned: ${Ty.new_var(tcx, 3 as TyVid) === t.ty_vars[3]}\n`;
  out += `new_tup_empty_is_unit: ${Ty.new_tup(tcx, []) === t.unit}\n`;
  out += `new_static_str_is_imm_ref: ${Ty.new_static_str(tcx) === Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, t.str_)}\n`;
  out += `tuple_fields: ${dlist(Ty.new_tup(tcx, [t.i32, t.bool]).tuple_fields())}\n`;
  const sig_tys = tcx.mk_type_list([t.i32, t.u8, t.bool]);
  out += `inputs: ${dlist(sig_tys.inputs())}\n`;
  out += `output: ${d(sig_tys.output())}\n`;
  out += `contains_self: ${t.i32.contains(t.i32)}\n`;
  out += "== variant_name\n";
  for (let i = 0; i < 6; i++) out += `${i}: ${CoroutineArgsExt.variant_name(i as VariantIdx)}\n`;
  out += "== article\n";
  for (const [label, ty] of tys.slice(0, 20)) out += `${label}: ${Article_TyKind.article(ty.kind())}\n`;
  out += `new_array_var: ${Article_TyKind.article(Ty.new_array_with_const_len(tcx, t.never, Const.new_var(tcx, 0 as ConstVid)).kind())}\n`;
  out += `new_error: ${Article_TyKind.article(Ty.new_error(tcx, ErrorGuaranteed.unchecked_error_guaranteed()).kind())}\n`;
  return out;
}

test(
  "sty_oracle: constructors, predicates, helpers and Display agree with the oracle probe",
  sg(() => {
    expect(oracle_dump(mk_tcx())).toBe(readFileSync(FIXTURE, "utf8"));
  }),
);

describe("constructors", () => {
  test(
    "the pre-interned types are reused, and the rest interns once",
    sg(() => {
      const tcx = mk_tcx();
      const t = tcx.types;
      expect(Ty.new_var(tcx, 0 as TyVid)).toBe(t.ty_vars[0]!);
      expect(Ty.new_fresh(tcx, 1)).toBe(t.fresh_tys[1]!);
      expect(Ty.new_fresh_int(tcx, 1)).toBe(t.fresh_int_tys[1]!);
      expect(Ty.new_fresh_float(tcx, 1)).toBe(t.fresh_float_tys[1]!);
      expect(Ty.new_anon_bound(tcx, 1 as DebruijnIndex, 2 as BoundVar)).toBe(t.anon_bound_tys[1]![2]!);
      expect(Ty.new_canonical_bound(tcx, 3 as BoundVar)).toBe(t.anon_canonical_bound_tys[3]!);
      // Outside the pre-interned ranges (and for a named bound type) the kind is interned.
      const big = Ty.new_var(tcx, 100_000 as TyVid);
      expect(big.kind() as unknown).toEqual({ $: "Infer", _0: { $: "TyVar", _0: 100_000 } });
      expect(Ty.new_var(tcx, 100_000 as TyVid)).toBe(big);
      expect(Ty.new_canonical_bound(tcx, 100_000 as BoundVar).kind() as unknown).toEqual({ $: "Bound", _0: { $: "Canonical" }, _1: { var: 100_000, kind: { $: "Anon" } } });
      expect(Ty.new_bound(tcx, 100 as DebruijnIndex, { var: 0 as BoundVar, kind: { $: "Anon" } }).kind() as unknown).toEqual({
        $: "Bound",
        _0: { $: "Bound", _0: 100 },
        _1: { var: 0, kind: { $: "Anon" } },
      });
      // The `inherent::Ty` impl forwards to the inherent fns.
      expect(Ty.new_bool(tcx)).toBe(t.bool);
      expect(Ty.new_u8(tcx)).toBe(t.u8);
      expect(Ty.new_unit(tcx)).toBe(t.unit);
      expect(Ty.new_usize(tcx)).toBe(t.usize);
      expect(Ty.ir_new_param(tcx, ParamTy.new(0, kw.SelfUpper))).toBe(t.self_param);
    }),
  );

  test(
    "new_tup_from_iter: plain items, and Result items stopping at the first Err",
    sg(() => {
      const tcx = mk_tcx();
      const t = tcx.types;
      expect(Ty.new_tup_from_iter(tcx, [])).toBe(t.unit);
      expect(Ty.new_tup_from_iter(tcx, [t.u8, t.u16])).toBe(Ty.new_tup(tcx, [t.u8, t.u16]));
      expect(Ty.new_tup_from_iter(tcx, [Ok(t.u8), Ok(t.u16)], CollectAndApply_Result)).toEqual(Ok(Ty.new_tup(tcx, [t.u8, t.u16])));
      let pulled = 0;
      function* items() {
        pulled++;
        yield Ok(t.u8);
        pulled++;
        yield Err("e1");
        pulled++;
        yield Err("e2");
      }
      expect(Ty.new_tup_from_iter(tcx, items(), CollectAndApply_Result)).toEqual(Err("e1"));
      expect(pulled).toBe(2);
    }),
  );

  test(
    "kinds of the simple constructors",
    sg(() => {
      const tcx = mk_tcx();
      const t = tcx.types;
      const guar = ErrorGuaranteed.unchecked_error_guaranteed();
      expect(Ty.new_ptr(tcx, t.u8, "Mut").kind()).toEqual({ $: "RawPtr", _0: t.u8, _1: "Mut" });
      expect(Ty.new_ref(tcx, tcx.lifetimes.re_erased, t.u8, "Not")).toBe(Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, t.u8));
      expect(Ty.new_error(tcx, guar).kind()).toEqual({ $: "Error", _0: guar });
      const fn = Ty.new_fn_ptr(tcx, { value: { inputs_and_output: tcx.mk_type_list([t.i32, t.bool]), fn_sig_kind: FnSigKind.dummy() }, bound_vars: tcx.mk_bound_variable_kinds([]) });
      expect(fn.kind().$).toBe("FnPtr");
      // `fn_sig` / `unnormalized_fn_sig` go through `TyKind::fn_sig`.
      const sig = fn.fn_sig(tcx);
      expect([...Binder.skip_binder(sig).inputs_and_output]).toEqual([t.i32, t.bool]);
      expect(() => t.bool.fn_sig(tcx)).toThrow(new Panic("Ty::fn_sig() called on non-fn type: bool"));
      // `unsafe<> i32` (not in the oracle fixture: neither printer prints `unsafe<..>` binders yet).
      const ub = Ty.new_unsafe_binder(tcx, Binder.dummy(t.i32, standin_fold_Ty));
      expect(ub.kind() as unknown).toEqual({ $: "UnsafeBinder", _0: UnsafeBinderInner.from_Binder(Binder.dummy(t.i32, standin_fold_Ty)) });
      expect(ub.discriminant_ty(tcx)).toBe(t.u8);
      expect(ub.has_trivial_sizedness(tcx, Sized)).toBe(true);
      expect(ub.is_trivially_pure_clone_copy()).toBe(false);
      expect(ub.is_trivially_wf(tcx)).toBe(false);
      expect(ub.variant_range(tcx)).toBeUndefined();
    }),
  );

  test(
    "new_adt interns an ADT type; value-const constructors stop UNPORTED at their pending dependencies",
    sg(() => {
      const tcx = mk_tcx();
      const t = tcx.types;
      // merge-w15b: `AdtDef` is ported (lane ty-adt-assoc): `new_adt` interns `Adt(def, args)`.
      const def = adt_def(false);
      const adt = Ty.new_adt(tcx, def, tcx.mk_args([]));
      expect(adt.kind()).toEqual({ $: "Adt", _0: def, _1: tcx.mk_args([]) });
      expect(Ty.new_adt(tcx, def, tcx.mk_args([]))).toBe(adt);
      expect(adt.ty_adt_def()).toBe(def);
      expect(adt.is_enum()).toBe(false);
      // `Const::from_target_usize` (ty/consts.rs, lane ty-results).
      expect(() => Ty.new_array(tcx, t.u8, 3)).toThrow(Unported);
    }),
  );
});

describe("helpers", () => {
  test(
    "to_opt_closure_kind round-trips from_closure_kind, and ICEs on other types",
    sg(() => {
      const tcx = mk_tcx();
      for (const k of ["Fn", "FnMut", "FnOnce"] as const) expect(Ty.from_closure_kind(tcx, k).to_opt_closure_kind()).toBe(k);
      expect(Ty.from_coroutine_closure_kind(tcx, "Fn").to_opt_closure_kind()).toBe("FnMut");
      expect(() => tcx.types.i64.to_opt_closure_kind()).toThrow(Unported); // the ICE message needs `{:?}` of `Ty`
      expect(() => tcx.types.bool.to_opt_closure_kind()).toThrow(Unported);
    }),
  );

  test(
    "sequence_element_type ICEs with Display on a non-sequence",
    sg(() => {
      const tcx = mk_tcx();
      expect(() => tcx.types.bool.sequence_element_type(tcx)).toThrow(Panic);
    }),
  );

  test(
    "contains / contains_closure stop UNPORTED below the top level (structural_impls.rs, lane ty-results)",
    sg(() => {
      const tcx = mk_tcx();
      const t = tcx.types;
      const tup = Ty.new_tup(tcx, [t.u8]);
      expect(tup.contains(tup)).toBe(true);
      expect(() => tup.contains(t.u8)).toThrow(Unported);
      expect(() => t.i32.contains_closure()).toThrow(Unported);
    }),
  );

  test(
    "inputs / output split the last element off, and unwrap on the empty list",
    sg(() => {
      const tcx = mk_tcx();
      const t = tcx.types;
      const l = tcx.mk_type_list([t.bool]);
      expect(l.inputs()).toEqual([]);
      expect(l.output()).toBe(t.bool);
      const empty = RawList.empty() as never as typeof l;
      expect(() => empty.output()).toThrow(new Panic("called `Option::unwrap()` on a `None` value"));
    }),
  );

  test(
    "has_unsafe_fields is ty/util.rs's (one method for util.rs:1275 and sty.rs:1122)",
    sg(() => {
      const tcx = mk_tcx();
      expect(tcx.types.u8.has_unsafe_fields()).toBe(false);
      expect(Ty.new_adt(tcx, adt_def(false), tcx.mk_args([])).has_unsafe_fields()).toBe(false);
      expect(Ty.new_adt(tcx, adt_def(true), tcx.mk_args([])).has_unsafe_fields()).toBe(true);
    }),
  );
});

describe("the other types of sty.rs", () => {
  test(
    "ParamTy / ParamConst",
    sg(() => {
      const tcx = mk_tcx();
      const def = { name: kw.SelfUpper, index: 0 } as never;
      expect(ParamTy.for_def(def)).toEqual({ index: 0, name: kw.SelfUpper });
      expect(ParamTy.index(ParamTy.new(4, kw.SelfUpper))).toBe(4);
      expect(ParamTy.to_ty(ParamTy.for_def(def), tcx)).toBe(tcx.types.self_param);
      expect(ParamConst.for_def(def)).toEqual({ index: 0, name: kw.SelfUpper });
      expect(ParamConst.index(ParamConst.new(2, kw.SelfUpper))).toBe(2);
    }),
  );

  test(
    "InlineConstArgs: new / split / parent_args / ty",
    sg(() => {
      const tcx = mk_tcx();
      const t = tcx.types;
      const parent = [GenericArg.from_Ty(t.u8), GenericArg.from_Region(tcx.lifetimes.re_static)];
      const ica = InlineConstArgs.new(tcx, { parent_args: parent, ty: t.char });
      expect([...ica.args]).toEqual([...parent, t.char]);
      expect(InlineConstArgs.parent_args(ica)).toEqual(parent);
      expect(InlineConstArgs.ty(ica)).toBe(t.char);
      expect(() => InlineConstArgs.split({ args: tcx.mk_args([]) })).toThrow(new Panic("inline const args missing synthetics"));
    }),
  );

  test("CoroutineArgsExt consts", () => {
    expect([CoroutineArgsExt.UNRESUMED, CoroutineArgsExt.RETURNED, CoroutineArgsExt.POISONED, CoroutineArgsExt.RESERVED_VARIANTS]).toEqual([0, 1, 2, 3]);
  });
});
