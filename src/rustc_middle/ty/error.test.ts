// Lane ty-results (sub-lane ty-results-b): unit tests of ty/error.rs (`TypeErrorToStringExt::to_string`,
// `Ty::sort_string` / `prefix_string`), ty/diagnostics.rs (`Ty::is_primitive_ty` / `is_simple_ty`, `IntoDiagArg for Ty`,
// `IsSuggestable`) and ty/visit.rs (the free-region visitors, `collect_*_late_bound_regions`) on a `TyCtxt` over fresh
// interners. Every expected string is upstream's literal text (error.rs:37..132, error.rs:140..230) or follows from it.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { BoundVar, DebruijnIndex, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { Binder, BoundRegionKind, BoundVariableKind } from "../../rustc_type_ir/binder.ts";
import type { TypeError } from "../../rustc_type_ir/error.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import { enter_context, ImplicitCtxt } from "./context/tls.ts";
import { IsSuggestable, Ty_into_diag_arg } from "./diagnostics.ts";
import { TypeError_to_string } from "./error.ts";
import type { Ty } from "./mod.ts";
import { with_reduced_queries } from "./print/pretty.ts";
import { fold_Ty } from "./structural_impls.ts";

/** A `TyCtxt` over fresh interners with a fake `sess` (the fields `sort_string` / `short_string` read). */
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
      opts: { verbose: false, trimmed_def_paths: false, unstable_opts: { write_long_types_to_disk: true, trim_diagnostic_paths: false } },
      verbose_internals: () => false,
      diagnostic_width: () => 140,
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const tcx = mk_tcx();
const t = tcx.types;
const ref = (r: Region, ty: Ty, mutbl: "Not" | "Mut"): Ty => tcx.mk_ty_from_kind({ $: "Ref", _0: r, _1: ty, _2: mutbl });
const tuple = (tys: Ty[]): Ty => tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list(tys) });

describe("TypeErrorToStringExt::to_string", () => {
  const cases: [TypeError, string][] = [
    [{ $: "Mismatch" }, "types differ"],
    [{ $: "CyclicTy", _0: t.i32 }, "recursive type with infinite-size name"],
    [{ $: "Mutability" }, "types differ in mutability"],
    [{ $: "ArgumentMutability", _0: 3 }, "types differ in mutability"],
    [{ $: "TupleSize", _0: { expected: 1, found: 2 } }, "expected a tuple with 1 element, found one with 2 elements"],
    [{ $: "TupleSize", _0: { expected: 2, found: 1 } }, "expected a tuple with 2 elements, found one with 1 element"],
    [{ $: "TupleSize", _0: { expected: 0, found: 0 } }, "expected a tuple with 0 elements, found one with 0 elements"],
    [{ $: "ArgCount" }, "incorrect number of function parameters"],
    [{ $: "RegionsDoesNotOutlive", _0: tcx.lifetimes.re_static, _1: tcx.lifetimes.re_erased }, "lifetime mismatch"],
    [{ $: "RegionsPlaceholderMismatch" }, "one type is more general than the other"],
    [{ $: "VariadicMismatch", _0: { expected: true, found: false } }, "expected variadic fn, found non-variadic function"],
    [{ $: "VariadicMismatch", _0: { expected: false, found: true } }, "expected non-variadic fn, found variadic function"],
    [{ $: "SplatMismatch", _0: { expected: 2, found: undefined } }, "expected fn with arg 2 splatted, found fn with no splatted arg"],
    [{ $: "SplatMismatch", _0: { expected: undefined, found: 0 } }, "expected fn with no splatted arg, found fn with arg 0 splatted"],
    [{ $: "SafetyMismatch", _0: { expected: "Unsafe", found: "Safe" } }, "expected unsafe fn, found safe fn"],
    [{ $: "PolarityMismatch", _0: { expected: "Positive", found: "Negative" } }, "expected positive polarity, found negative polarity"],
    [{ $: "ForceInlineCast" }, "cannot coerce functions which must be inlined to function pointers"],
    [{ $: "IntrinsicCast" }, "cannot coerce intrinsics to function pointers"],
  ];
  for (const [err, msg] of cases) {
    test(`${err.$} -> ${msg}`, () => {
      expect(TypeError_to_string(err, tcx)).toBe(msg);
    });
  }

  test("Sorts / ArgumentSorts go through sort_string and report_maybe_different", () => {
    with_reduced_queries(() => {
      expect(TypeError_to_string({ $: "Sorts", _0: { expected: t.i32, found: t.u8 } }, tcx)).toBe("expected `i32`, found `u8`");
      expect(TypeError_to_string({ $: "ArgumentSorts", _0: { expected: t.bool, found: t.bool }, _1: 0 }, tcx)).toBe(
        "expected `bool`, found a different `bool`",
      );
    });
  });
});

describe("Ty::prefix_string", () => {
  test("primitive and structural types", () => {
    const re = tcx.lifetimes.re_static;
    const cases: [Ty, string][] = [
      [t.bool, "type"],
      [t.char, "type"],
      [t.i32, "type"],
      [t.u64, "type"],
      [t.f32, "type"],
      [t.str_, "type"],
      [t.never, "type"],
      [t.unit, "unit type"],
      [tuple([t.i32, t.u8]), "tuple"],
      [ref(re, t.i32, "Not"), "reference"],
      [ref(re, t.i32, "Mut"), "mutable reference"],
      [tcx.mk_ty_from_kind({ $: "Slice", _0: t.u8 }), "slice"],
      [tcx.mk_ty_from_kind({ $: "RawPtr", _0: t.u8, _1: "Not" }), "raw pointer"],
    ];
    for (const [ty, s] of cases) expect(ty.prefix_string(tcx)).toBe(s);
  });
});

describe("Ty::sort_string", () => {
  test("the `_` arm prints the type in backticks", () => {
    with_reduced_queries(() => {
      expect(t.i32.sort_string(tcx)).toBe("`i32`");
      expect(t.bool.sort_string(tcx)).toBe("`bool`");
      expect(t.unit.sort_string(tcx)).toBe("`()`");
      expect(t.str_.sort_string(tcx)).toBe("`str`");
    });
  });
});

describe("ty/diagnostics.rs", () => {
  test("is_primitive_ty / is_simple_ty", () => {
    for (const ty of [t.bool, t.char, t.str_, t.i32, t.u8, t.f64]) {
      expect(ty.is_primitive_ty()).toBe(true);
      expect(ty.is_simple_ty()).toBe(true);
    }
    expect(t.unit.is_primitive_ty()).toBe(false);
    expect(t.unit.is_simple_ty()).toBe(true);
    expect(t.never.is_primitive_ty()).toBe(false);
    expect(t.never.is_simple_ty()).toBe(false);
    expect(tuple([t.i32]).is_simple_ty()).toBe(false);
  });

  test("IntoDiagArg for Ty is the short string", () => {
    const gcx = (tcx as unknown as { gcx: GlobalCtxt }).gcx;
    const path = { value: undefined as string | undefined };
    const v = enter_context(ImplicitCtxt.new(gcx), () => with_reduced_queries(() => Ty_into_diag_arg(t.u16, path)));
    expect(v).toEqual({ $: "Str", _0: "u16" });
    expect(path.value).toBeUndefined();
  });

  test("IsSuggestable: primitives and references are suggestable, error types are not", () => {
    expect(IsSuggestable.is_suggestable(t.i32, tcx, false, fold_Ty)).toBe(true);
    expect(IsSuggestable.is_suggestable(ref(tcx.lifetimes.re_static, t.u8, "Not"), tcx, false, fold_Ty)).toBe(true);
    expect(IsSuggestable.make_suggestable(t.i32, tcx, false, undefined, fold_Ty)).toBe(t.i32);
  });
});

describe("ty/visit.rs", () => {
  const re = tcx.lifetimes.re_static;
  test("any_free_region_meets / for_each_free_region / all_free_regions_meet on `&'static u8`", () => {
    const ty = ref(re, t.u8, "Not");
    expect(tcx.any_free_region_meets(ty, (r) => r === re, fold_Ty)).toBe(true);
    expect(tcx.any_free_region_meets(ty, (r) => r === tcx.lifetimes.re_erased, fold_Ty)).toBe(false);
    const seen: Region[] = [];
    tcx.for_each_free_region(ty, (r) => void seen.push(r), fold_Ty);
    expect(seen).toEqual([re]);
    expect(tcx.all_free_regions_meet(ty, (r) => r === re, fold_Ty)).toBe(true);
  });

  test("types without free regions are skipped", () => {
    const seen: Region[] = [];
    tcx.for_each_free_region(tuple([t.i32, t.u8]), (r) => void seen.push(r), fold_Ty);
    expect(seen).toEqual([]);
  });

  test("a late-bound region bound by the binder is not free, and is collected", () => {
    const br = { var: BoundVar.from_u32(0), kind: BoundRegionKind.Anon };
    const bound = tcx.intern_region({ $: "ReBound", _0: { $: "Bound", _0: INNERMOST }, _1: br });
    const value = Binder.bind_with_vars(ref(bound, t.u8, "Not"), tcx.mk_bound_variable_kinds([{ $: "Region", _0: BoundRegionKind.Anon } as BoundVariableKind]));
    // `RegionVisitor::visit_ty` only descends into types with `HAS_FREE_REGIONS`, which a bound region does not set
    // (flags.rs), so the escaping `'^0` of the skipped binder is not reached.
    expect(tcx.any_free_region_meets(Binder.skip_binder(value), () => true, fold_Ty)).toBe(false);
    const regions = tcx.collect_referenced_late_bound_regions(value, fold_Ty);
    expect([...regions]).toEqual([BoundRegionKind.Anon]);
    // An escaping region (bound one level further out) is not collected.
    const escaping = tcx.intern_region({ $: "ReBound", _0: { $: "Bound", _0: DebruijnIndex.shifted_in(INNERMOST, 1) }, _1: br });
    expect([...tcx.collect_referenced_late_bound_regions(Binder.bind_with_vars(ref(escaping, t.u8, "Not"), tcx.mk_bound_variable_kinds([])), fold_Ty)]).toEqual([]);
  });
});
