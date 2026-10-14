// Lane tyir-kind: FlagComputation (flags.rs), interning every simple `TyKind`, `tcx.types`, and the manual Debug /
// Display impls of ty_kind.rs, region_kind.rs and const_kind.rs.
//
// The oracle strings below were printed by the pinned nightly (rustc 1.101.0-nightly 6f5da406b 2026-10-10) through a
// throwaway rustc-dev program (source in docs/handoff/tyir-kind.md, "Oracle probe") that builds the same values with
// rustc's own `TyCtxt` and prints them with `{:?}` / `{:#?}` / `{}`; the flag expectations are `Ty::flags()` /
// `outer_exclusive_binder()` of the same types there.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../rustc_middle/lib.ts";
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { CRATE_DEF_ID, LocalDefId } from "../rustc_span/def_id.ts";
import { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { kw } from "../rustc_span/symbol.ts";
import { format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import { Ok } from "../std/result.ts";
import type { BoundVar, ConstVid, DebruijnIndex, RegionVid, UniverseIndex } from "./decls.ts";
import { debug_ConstKind, debug_InferConst, type ConstKind } from "./const_kind.ts";
import { debug_TypeFlags, FlagComputation, TypeFlags } from "./flags.ts";
import { debug_DebruijnIndex, INNERMOST } from "./lib.ts";
import { debug_RegionKind, type RegionKind } from "./region_kind.ts";
import { AliasTermKind } from "./term_kind.ts";
import {
  AliasTyKind,
  debug_FnSig,
  debug_FnSigKind,
  debug_InferTy,
  debug_SplattedArgIndexError,
  debug_TyKind,
  display_InferTy,
  FnSig,
  FnSigKind,
  FnHeader,
  FloatVarValue,
  type FloatVid,
  type InferTy,
  IntVarValue,
  type IntVid,
  TyKind,
  type TyVid,
  UnifyKey_IntVid,
  UnifyValue_FloatVarValue,
  UnifyValue_IntVarValue,
} from "./ty_kind.ts";

// `impl inherent::Tys for &List<Ty>` (rustc_middle ty/sty.rs:2180, lane ty-sty) is not ported yet; `debug_FnSig` needs
// it, so these tests provide upstream's two one-liners (`split_last().unwrap()`).
const spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  spies.push(spyOn(RawList.prototype as unknown as { inputs(): readonly Ty[] }, "inputs").mockImplementation(function (this: readonly Ty[]) {
    return this.slice(0, this.length - 1);
  }));
  spies.push(spyOn(RawList.prototype as unknown as { output(): Ty }, "output").mockImplementation(function (this: readonly Ty[]) {
    return this[this.length - 1]!;
  }));
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

/** A `TyCtxt` over a fresh `CtxtInterners` (as in rustc_middle/ty/interning.test.ts). */
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
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const flags = (t: { flags(): TypeFlags }): string => debug_TypeFlags(t.flags(), PLAIN);
const oeb = (t: { outer_exclusive_binder(): DebruijnIndex }): string => debug_DebruijnIndex(t.outer_exclusive_binder(), PLAIN);
const guar = ErrorGuaranteed.unchecked_error_guaranteed();
const TyVid_ = (n: number) => n as TyVid;
const IntVid_ = (n: number) => n as IntVid;
const FloatVid_ = (n: number) => n as FloatVid;

describe("interning simple TyKinds", () => {
  test("every simple kind interns once and gets its flags", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const ct = tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: 0 as ConstVid } });
    const empty_vars = RawList.empty<never>();
    const def_id = LocalDefId.to_def_id(CRATE_DEF_ID);
    const cases: [TyKind, string][] = [
      [TyKind.Bool, "TypeFlags(0x0)"],
      [TyKind.Char, "TypeFlags(0x0)"],
      [{ $: "Int", _0: "I32" }, "TypeFlags(0x0)"],
      [{ $: "Uint", _0: "U8" }, "TypeFlags(0x0)"],
      [{ $: "Float", _0: "F64" }, "TypeFlags(0x0)"],
      [TyKind.Str, "TypeFlags(0x0)"],
      [TyKind.Never, "TypeFlags(0x0)"],
      [{ $: "Foreign", _0: def_id }, "TypeFlags(0x0)"],
      [{ $: "Tuple", _0: tcx.mk_type_list([]) }, "TypeFlags(0x0)"],
      [{ $: "Tuple", _0: tcx.mk_type_list([t.ty_vars[0]!, t.fresh_int_tys[1]!, t.anon_bound_tys[2]![0]!]) }, "TypeFlags(HAS_TY_INFER | HAS_TY_BOUND | HAS_TY_FRESH)"],
      [{ $: "Slice", _0: t.self_param }, "TypeFlags(HAS_TY_PARAM)"],
      [{ $: "Array", _0: t.u8, _1: ct }, "TypeFlags(HAS_CT_INFER)"],
      [{ $: "RawPtr", _0: t.fresh_float_tys[0]!, _1: "Mut" }, "TypeFlags(HAS_TY_FRESH)"],
      [{ $: "Param", _0: { index: 3, name: kw.SelfUpper } }, "TypeFlags(HAS_TY_PARAM)"],
      [{ $: "Infer", _0: { $: "TyVar", _0: TyVid_(7) } }, "TypeFlags(HAS_TY_INFER)"],
      [{ $: "Infer", _0: { $: "IntVar", _0: IntVid_(7) } }, "TypeFlags(HAS_TY_INFER)"],
      [{ $: "Infer", _0: { $: "FloatVar", _0: FloatVid_(7) } }, "TypeFlags(HAS_TY_INFER)"],
      [{ $: "Infer", _0: { $: "FreshTy", _0: 9 } }, "TypeFlags(HAS_TY_FRESH)"],
      [{ $: "Bound", _0: { $: "Canonical" }, _1: { var: 30 as BoundVar, kind: { $: "Anon" } } }, "TypeFlags(HAS_TY_BOUND | HAS_CANONICAL_BOUND)"],
      [{ $: "Placeholder", _0: { universe: 1 as UniverseIndex, bound: { var: 0 as BoundVar, kind: { $: "Anon" } }, _tcx: undefined } }, "TypeFlags(HAS_TY_PLACEHOLDER)"],
      [{ $: "Error", _0: guar }, "TypeFlags(HAS_NON_REGION_ERROR)"],
      [{ $: "Closure", _0: def_id, _1: tcx.mk_args([GenericArg.from_Ty(t.self_param)]) }, "TypeFlags(HAS_TY_PARAM)"],
      [{ $: "Coroutine", _0: def_id, _1: tcx.mk_args([GenericArg.from_Ty(t.self_param)]) }, "TypeFlags(HAS_TY_PARAM | HAS_TY_CORO)"],
      [{ $: "FnDef", _0: def_id, _1: { value: tcx.mk_args([]), bound_vars: empty_vars } }, "TypeFlags(0x0)"],
      [{ $: "Alias", _0: "No", _1: { kind: { $: "Projection", def_id }, args: tcx.mk_args([]), _use_alias_new_instead: null } }, "TypeFlags(HAS_TY_PROJECTION | HAS_NON_RIGID_ALIAS)"],
      [{ $: "Alias", _0: "Yes", _1: { kind: { $: "Opaque", def_id }, args: tcx.mk_args([]), _use_alias_new_instead: null } }, "TypeFlags(HAS_TY_OPAQUE | HAS_RIGID_ALIAS)"],
      [{ $: "UnsafeBinder", _0: { _0: { value: t.ty_vars[1]!, bound_vars: empty_vars } } }, "TypeFlags(HAS_TY_INFER)"],
    ];
    for (const [kind, expected] of cases) {
      const ty = tcx.mk_ty_from_kind(kind);
      expect(ty).toBeInstanceOf(Ty);
      expect(tcx.mk_ty_from_kind(kind)).toBe(ty);
      expect([kind.$, flags(ty)]).toEqual([kind.$, expected]);
    }
    // the common types are the interned objects
    expect(tcx.mk_ty_from_kind(TyKind.Bool)).toBe(t.bool);
    expect(tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list([]) })).toBe(t.unit);
  });

  test("bound vars and binders (FnPtr) match the oracle's flags and outer_exclusive_binder", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const vars = tcx.mk_bound_variable_kinds([{ $: "Ty", _0: { $: "Anon" } }]);
    const no_vars = RawList.empty<never>();
    const cases: [string, Ty[], typeof vars, string, string][] = [
      ["fnptr_b1_vars", [t.anon_bound_tys[1]![0]!, t.unit], vars, "TypeFlags(HAS_TY_BOUND | HAS_BINDER_VARS)", "DebruijnIndex(1)"],
      ["fnptr_b0_vars", [t.anon_bound_tys[0]![0]!, t.unit], vars, "TypeFlags(HAS_TY_BOUND | HAS_BINDER_VARS)", "DebruijnIndex(0)"],
      ["fnptr_b2_novars", [t.anon_bound_tys[2]![1]!, t.ty_vars[0]!], no_vars, "TypeFlags(HAS_TY_INFER | HAS_TY_BOUND)", "DebruijnIndex(2)"],
      ["fnptr_unit_novars", [t.unit], no_vars, "TypeFlags(0x0)", "DebruijnIndex(0)"],
    ];
    for (const [name, io, bound_vars, f, o] of cases) {
      const ty = tcx.mk_ty_from_kind({ $: "FnPtr", _0: { value: { inputs_and_output: tcx.mk_type_list(io) }, bound_vars }, _1: FnHeader.dummy() });
      expect([name, flags(ty), oeb(ty)]).toEqual([name, f, o]);
    }
  });

  test("Ref interns with the region's flags (Region::flags, ported by tyir-misc), as the oracle", () => {
    const tcx = mk_tcx();
    // Oracle (/tmp/tyir-misc-lib-sty probe): `Ty::new_ref(tcx, 'static, u8, Not)` and `'?5`.
    const r = tcx.mk_ty_from_kind({ $: "Ref", _0: tcx.lifetimes.re_static, _1: tcx.types.u8, _2: "Not" });
    expect(tcx.mk_ty_from_kind({ $: "Ref", _0: tcx.lifetimes.re_static, _1: tcx.types.u8, _2: "Not" })).toBe(r);
    expect([flags(r), oeb(r)]).toEqual(["TypeFlags(HAS_FREE_REGIONS)", "DebruijnIndex(0)"]);
    const v = tcx.mk_ty_from_kind({ $: "Ref", _0: tcx.intern_re_var(5 as RegionVid), _1: tcx.types.u8, _2: "Not" });
    expect([flags(v), oeb(v)]).toEqual(["TypeFlags(HAS_RE_INFER | HAS_FREE_LOCAL_REGIONS | HAS_FREE_REGIONS)", "DebruijnIndex(0)"]);
  });

  test("Const interning: flags of const kinds", () => {
    const tcx = mk_tcx();
    const cases: [ConstKind, string][] = [
      [{ $: "Infer", _0: { $: "Var", _0: 0 as ConstVid } }, "TypeFlags(HAS_CT_INFER)"],
      [{ $: "Infer", _0: { $: "Fresh", _0: 1 } }, "TypeFlags(HAS_CT_FRESH)"],
      [{ $: "Bound", _0: { $: "Bound", _0: 1 as DebruijnIndex }, _1: { var: 0 as BoundVar, _tcx: undefined } }, "TypeFlags(HAS_CT_BOUND)"],
      [{ $: "Bound", _0: { $: "Canonical" }, _1: { var: 0 as BoundVar, _tcx: undefined } }, "TypeFlags(HAS_CT_BOUND | HAS_CANONICAL_BOUND)"],
      [{ $: "Param", _0: { index: 0, name: kw.Underscore } }, "TypeFlags(HAS_CT_PARAM)"],
      [{ $: "Error", _0: guar }, "TypeFlags(HAS_NON_REGION_ERROR)"],
    ];
    for (const [kind, expected] of cases) {
      const c = tcx.mk_ct_from_kind(kind);
      expect(tcx.mk_ct_from_kind(kind)).toBe(c);
      expect([kind.$, flags(c)]).toEqual([kind.$, expected]);
    }
    const bound = tcx.mk_ct_from_kind({ $: "Bound", _0: { $: "Bound", _0: 1 as DebruijnIndex }, _1: { var: 0 as BoundVar, _tcx: undefined } });
    expect(oeb(bound)).toBe("DebruijnIndex(2)");
  });

  test("predicate flags go through the binder", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const p = tcx.mk_predicate({
      value: { $: "Subtype", _0: { a_is_expected: true, a: t.ty_vars[0]!, b: t.anon_bound_tys[0]![0]! } },
      bound_vars: tcx.mk_bound_variable_kinds([{ $: "Ty", _0: { $: "Anon" } }]),
    });
    expect(flags(p)).toBe("TypeFlags(HAS_TY_INFER | HAS_TY_BOUND | HAS_BINDER_VARS)");
    expect(oeb(p)).toBe("DebruijnIndex(0)");
  });
});

describe("tcx.types", () => {
  test("CommonTypes construct, with the oracle's flags", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(t.bool.kind()).toEqual(TyKind.Bool);
    expect(t.unit.kind().$).toBe("Tuple");
    expect(flags(t.bool)).toBe("TypeFlags(0x0)");
    expect(flags(t.self_param)).toBe("TypeFlags(HAS_TY_PARAM)");
    expect(flags(t.trait_object_dummy_self)).toBe("TypeFlags(HAS_TY_FRESH)");
    expect(flags(t.ty_vars[0]!)).toBe("TypeFlags(HAS_TY_INFER)");
    expect(flags(t.anon_bound_tys[1]![0]!)).toBe("TypeFlags(HAS_TY_BOUND)");
    expect(oeb(t.anon_bound_tys[1]![0]!)).toBe("DebruijnIndex(2)");
    expect(flags(t.anon_canonical_bound_tys[0]!)).toBe("TypeFlags(HAS_TY_BOUND | HAS_CANONICAL_BOUND)");
    expect(oeb(t.anon_canonical_bound_tys[0]!)).toBe("DebruijnIndex(0)");
    expect(flags(t.unit)).toBe("TypeFlags(0x0)");
    expect(flags(tcx.mk_ty_from_kind({ $: "Error", _0: guar }))).toBe("TypeFlags(HAS_NON_REGION_ERROR)");
  });

  test("FlagComputation::new is empty at INNERMOST", () => {
    const c = FlagComputation.new();
    expect(c.flags).toBe(TypeFlags.empty());
    expect(c.outer_exclusive_binder).toBe(INNERMOST);
  });
});

describe("Debug / Display (oracle)", () => {
  test("TyKind leaves, {:?} and {:#?}", () => {
    const kinds: [TyKind, string][] = [
      [TyKind.Bool, "bool"],
      [TyKind.Char, "char"],
      [{ $: "Int", _0: "I32" }, "i32"],
      [{ $: "Int", _0: "Isize" }, "isize"],
      [{ $: "Uint", _0: "U8" }, "u8"],
      [{ $: "Uint", _0: "U128" }, "u128"],
      [{ $: "Float", _0: "F64" }, "f64"],
      [{ $: "Float", _0: "F16" }, "f16"],
      [TyKind.Str, "str"],
      [TyKind.Never, "!"],
      [{ $: "Infer", _0: { $: "TyVar", _0: TyVid_(3) } }, "?3t"],
      [{ $: "Infer", _0: { $: "IntVar", _0: IntVid_(1) } }, "?1i"],
      [{ $: "Infer", _0: { $: "FloatVar", _0: FloatVid_(2) } }, "?2f"],
      [{ $: "Infer", _0: { $: "FreshTy", _0: 0 } }, "FreshTy(0)"],
      [{ $: "Infer", _0: { $: "FreshIntTy", _0: 4 } }, "FreshIntTy(4)"],
      [{ $: "Infer", _0: { $: "FreshFloatTy", _0: 5 } }, "FreshFloatTy(5)"],
      [{ $: "Error", _0: guar }, "{type error}"],
    ];
    for (const [k, s] of kinds) {
      expect(format_debug(k, debug_TyKind, PLAIN)).toBe(s);
      expect(format_debug(k, debug_TyKind, PRETTY)).toBe(s);
    }
  });

  test("InferTy Debug and Display", () => {
    const cases: [InferTy, string, string][] = [
      [{ $: "TyVar", _0: TyVid_(3) }, "?3t", "_"],
      [{ $: "IntVar", _0: IntVid_(1) }, "?1i", "{integer}"],
      [{ $: "FloatVar", _0: FloatVid_(2) }, "?2f", "{float}"],
      [{ $: "FreshTy", _0: 0 }, "FreshTy(0)", "FreshTy(0)"],
      [{ $: "FreshIntTy", _0: 4 }, "FreshIntTy(4)", "FreshIntTy(4)"],
      [{ $: "FreshFloatTy", _0: 5 }, "FreshFloatTy(5)", "FreshFloatTy(5)"],
    ];
    for (const [i, d, s] of cases) {
      expect(debug_InferTy(i, PLAIN)).toBe(d);
      expect(display_InferTy(i)).toBe(s);
    }
  });

  test("FnSigKind / FnSig", () => {
    const tcx = mk_tcx();
    const unit_list = tcx.mk_type_list([tcx.types.unit]);
    const ok = <T>(r: { $: "Ok"; _0: T } | { $: "Err"; _0: unknown }): T => {
      if (r.$ !== "Ok") throw new Error("expected Ok");
      return r._0;
    };
    const kinds: [FnSigKind, string, string, string, boolean][] = [
      [FnSigKind.dummy(), 'FnSigKind("Safe", Rust)', 'FnSigKind(\n    "Safe",\n    Rust,\n)', "fn()", true],
      [FnSigKind.default_(), 'FnSigKind("Unsafe", Rust)', 'FnSigKind(\n    "Unsafe",\n    Rust,\n)', "unsafe fn()", false],
      [
        ok(FnSigKind.new(ExternAbi.C(false), "Unsafe", true, undefined, 0)),
        'FnSigKind("Unsafe", C { unwind: false }, "CVariadic")',
        'FnSigKind(\n    "Unsafe",\n    C {\n        unwind: false,\n    },\n    "CVariadic",\n)',
        'unsafe extern "C { unwind: false }" fn(...)',
        false,
      ],
      [
        ok(FnSigKind.new(ExternAbi.C(true), "Safe", false, 1, 2)),
        'FnSigKind("Safe", C { unwind: true }, "Splatted(1)")',
        'FnSigKind(\n    "Safe",\n    C {\n        unwind: true,\n    },\n    "Splatted(1)",\n)',
        'extern "C { unwind: true }" fn()',
        false,
      ],
      [ok(FnSigKind.new(ExternAbi.RustCall, "Safe", false, undefined, 0)), 'FnSigKind("Safe", RustCall)', 'FnSigKind(\n    "Safe",\n    RustCall,\n)', 'extern "RustCall" fn()', false],
      [
        ok(FnSigKind.new(ExternAbi.System(false), "Unsafe", false, undefined, 0)),
        'FnSigKind("Unsafe", System { unwind: false })',
        'FnSigKind(\n    "Unsafe",\n    System {\n        unwind: false,\n    },\n)',
        'unsafe extern "System { unwind: false }" fn()',
        false,
      ],
    ];
    for (const [k, d, pretty, sig_s, compat] of kinds) {
      expect(format_debug(k, debug_FnSigKind, PLAIN)).toBe(d);
      expect(format_debug(k, debug_FnSigKind, PRETTY)).toBe(pretty);
      const sig: FnSig = { inputs_and_output: unit_list, fn_sig_kind: k };
      expect(format_debug(sig, debug_FnSig, PLAIN)).toBe(sig_s);
      expect(format_debug(sig, debug_FnSig, PRETTY)).toBe(sig_s);
      expect(FnSig.is_fn_trait_compatible(sig)).toBe(compat);
    }
    const err = (r: ReturnType<typeof FnSigKind.new>): string => (r.$ === "Err" ? `Some(${debug_SplattedArgIndexError(r._0, PLAIN)})` : "None");
    expect(err(FnSigKind.new(ExternAbi.Rust, "Safe", false, 255, 2))).toBe("Some(InvalidIndex { splatted_arg_index: 255 })");
    expect(err(FnSigKind.new(ExternAbi.Rust, "Safe", false, 3, 300))).toBe("None");
    expect(err(FnSigKind.new(ExternAbi.Rust, "Safe", false, 70, 65601))).toBe("None");
    expect(err(FnSigKind.new(ExternAbi.Rust, "Safe", false, 3, 2))).toBe("Some(OutOfBounds { splatted_arg_index: 3, args_len: 2 })");
  });

  test("RegionKind and ConstKind leaves", () => {
    const regions: [RegionKind, string][] = [
      [{ $: "ReStatic" }, "'static"],
      [{ $: "ReVar", _0: 5 as RegionVid }, "'?5"],
      [{ $: "ReErased" }, "'{erased}"],
      [{ $: "ReError", _0: guar }, "'{region error}"],
    ];
    for (const [r, s] of regions) {
      expect(format_debug(r, debug_RegionKind, PLAIN)).toBe(s);
      expect(format_debug(r, debug_RegionKind, PRETTY)).toBe(s);
    }
    const consts: [ConstKind, string][] = [
      [{ $: "Infer", _0: { $: "Var", _0: 3 as ConstVid } }, "?3c"],
      [{ $: "Infer", _0: { $: "Fresh", _0: 2 } }, "Fresh(2)"],
      [{ $: "Error", _0: guar }, "{const error}"],
    ];
    for (const [c, s] of consts) {
      expect(format_debug(c, debug_ConstKind, PLAIN)).toBe(s);
    }
    expect(debug_InferConst({ $: "Var", _0: 3 as ConstVid }, PLAIN)).toBe("?3c");
  });
});

describe("helpers", () => {
  test("int / float var unification", () => {
    const u = IntVarValue.Unknown;
    const i32: IntVarValue = { $: "IntType", _0: "I32" };
    const u8: IntVarValue = { $: "UintType", _0: "U8" };
    expect(UnifyValue_IntVarValue.unify_values(u, u)).toEqual(Ok(u));
    expect(UnifyValue_IntVarValue.unify_values(u, i32)).toEqual(Ok(i32));
    expect(UnifyValue_IntVarValue.unify_values(u8, u)).toEqual(Ok(u8));
    expect(() => UnifyValue_IntVarValue.unify_values(i32, u8)).toThrow("differing ints should have been resolved first");
    expect(IntVarValue.is_known(i32)).toBe(true);
    expect(IntVarValue.is_unknown(u)).toBe(true);
    const f64: FloatVarValue = { $: "Known", _0: "F64" };
    expect(UnifyValue_FloatVarValue.unify_values(FloatVarValue.Unknown, f64)).toEqual(Ok(f64));
    expect(() => UnifyValue_FloatVarValue.unify_values(f64, f64)).toThrow("differing floats should have been resolved first");
    expect(UnifyKey_IntVid.tag()).toBe("IntVid");
    expect(UnifyKey_IntVid.from_index(4)).toBe(IntVid_(4));
  });

  test("AliasTyKind / AliasTermKind", () => {
    const def_id = LocalDefId.to_def_id(CRATE_DEF_ID);
    expect(AliasTyKind.descr({ $: "Free", def_id })).toBe("type alias");
    expect(AliasTyKind.try_to_opaque({ $: "Opaque", def_id })).toBe(def_id);
    expect(AliasTyKind.try_to_opaque({ $: "Free", def_id })).toBeUndefined();
    expect(AliasTermKind.from_AliasTyKind({ $: "Projection", def_id })).toEqual({ $: "ProjectionTy", def_id });
    expect(AliasTermKind.from_AliasConstKind({ $: "InherentSelf", def_id })).toEqual({ $: "InherentConstSelf", def_id });
    expect(AliasTermKind.descr({ $: "InherentConstImpl", def_id })).toBe("inherent associated const");
    expect(AliasTermKind.is_type({ $: "AnonConst", def_id })).toBe(false);
    expect(AliasTermKind.is_trait_projection({ $: "ProjectionConst", def_id })).toBe(true);
  });
});
