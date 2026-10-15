// Lane ty-util: ty/util.rs, checked against upstream's bodies on interned types and a stubbed `TyCtxt`
// (the queries / parent lookups the fns read are replaced on an `Object.create(tcx)` view).
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { DefId, DefIndex, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import { sym } from "../../rustc_span/symbol.ts";
import type { TypeFolder } from "../../rustc_type_ir/fold.ts";
import { TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import type { ParamTy } from "./decls.ts";
import type { GenericArg } from "./generic_args.ts";
import { Ty } from "./mod.ts";
import { AlwaysRequiresDrop, debug_AlwaysRequiresDrop, debug_CheckRegions, fold_list, needs_drop_components, needs_drop_components_with_async } from "./util.ts";

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

/** A view of `tcx` whose listed methods are replaced. */
function with_methods(tcx: TyCtxt, methods: Record<string, unknown>): TyCtxt {
  return Object.assign(Object.create(tcx) as TyCtxt, methods);
}

function did(index: number): DefId {
  return new DefId(DefIndex.from_u32(index), LOCAL_CRATE);
}

function param(tcx: TyCtxt, index: number): Ty {
  const p: ParamTy = { index, name: sym.Abi };
  return tcx.mk_ty_from_kind({ $: "Param", _0: p });
}

describe("Ty fast paths", () => {
  test("is_trivially_freeze / is_trivially_unpin / is_trivially_not_async_drop", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    for (const ty of [t.bool, t.i32, t.u8, t.f64, t.char, t.str_, t.never, t.unit]) {
      expect(ty.is_trivially_freeze()).toBe(true);
      expect(ty.is_trivially_unpin()).toBe(true);
      expect(ty.is_trivially_not_async_drop()).toBe(true);
    }
    const tup = tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list([t.i32, param(tcx, 0)]) });
    expect(tup.is_trivially_freeze()).toBe(false);
    expect(tup.is_trivially_unpin()).toBe(false);
    expect(param(tcx, 0).is_trivially_not_async_drop()).toBe(false);
    const slice = tcx.mk_ty_from_kind({ $: "Slice", _0: t.u8 });
    expect(slice.is_trivially_freeze()).toBe(true);
  });

  test("peel_refs strips every outer reference", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const re = tcx.lifetimes.re_static;
    const r1 = tcx.mk_ty_from_kind({ $: "Ref", _0: re, _1: t.u8, _2: "Mut" });
    const r2 = tcx.mk_ty_from_kind({ $: "Ref", _0: re, _1: r1, _2: "Not" });
    expect(r2.peel_refs()).toBe(t.u8);
    expect(t.u8.peel_refs()).toBe(t.u8);
    const ptr = tcx.mk_ty_from_kind({ $: "RawPtr", _0: r1, _1: "Not" });
    const r3 = tcx.mk_ty_from_kind({ $: "Ref", _0: re, _1: ptr, _2: "Not" });
    expect(r3.peel_refs()).toBe(ptr);
  });

  test("is_structural_eq_shallow on primitives and composites", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(t.bool.is_structural_eq_shallow(tcx)).toBe(true);
    expect(t.f32.is_structural_eq_shallow(tcx)).toBe(false);
    expect(t.unit.is_structural_eq_shallow(tcx)).toBe(true);
    expect(param(tcx, 0).is_structural_eq_shallow(tcx)).toBe(false);
  });
});

describe("needs_drop_components", () => {
  test("primitives and tuples of them need no drop; params are returned as components", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(needs_drop_components(tcx, t.i32)).toEqual({ $: "Ok", _0: [] });
    const tup = tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list([t.i32, t.bool]) });
    expect(needs_drop_components(tcx, tup)).toEqual({ $: "Ok", _0: [] });
    const p0 = param(tcx, 0);
    const p1 = param(tcx, 1);
    const tup2 = tcx.mk_ty_from_kind({ $: "Tuple", _0: tcx.mk_type_list([p0, t.u8, p1]) });
    const r = needs_drop_components(tcx, tup2);
    expect(r.$).toBe("Ok");
    expect(r.$ === "Ok" && r._0.length === 2 && r._0[0] === p0 && r._0[1] === p1).toBe(true);
    const slice = tcx.mk_ty_from_kind({ $: "Slice", _0: p0 });
    const rs = needs_drop_components(tcx, slice);
    expect(rs.$ === "Ok" && rs._0.length === 1 && rs._0[0] === p0).toBe(true);
  });

  test("ty::Error always needs drop, unless async", () => {
    const tcx = mk_tcx();
    const err = tcx.mk_ty_from_kind({ $: "Error", _0: null as never });
    expect(needs_drop_components(tcx, err)).toEqual({ $: "Err", _0: AlwaysRequiresDrop });
    expect(needs_drop_components_with_async(tcx, err, "Yes")).toEqual({ $: "Ok", _0: [] });
  });

  test("needs_drop answers trivially without a query", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(t.u32.needs_drop(tcx, undefined as never)).toBe(false);
    expect(t.u32.has_significant_drop(tcx, undefined as never)).toBe(false);
  });
});

describe("TyCtxt helpers", () => {
  test("uses_unique_generic_params", () => {
    const tcx = mk_tcx();
    const p0 = param(tcx, 0);
    const p1 = param(tcx, 1);
    expect(tcx.uses_unique_generic_params([p0, p1], "No" as never)).toEqual({ $: "Ok", _0: null });
    expect(tcx.uses_unique_generic_params([p0, p0], "No" as never)).toEqual({ $: "Err", _0: { $: "DuplicateParam", _0: p0 } } as never);
    expect(tcx.uses_unique_generic_params([tcx.types.i32], "No" as never)).toEqual({ $: "Err", _0: { $: "NotParam", _0: tcx.types.i32 } } as never);
    const re = tcx.lifetimes.re_static;
    const args: GenericArg[] = [re, p0];
    expect(tcx.uses_unique_generic_params(args, "No" as never)).toEqual({ $: "Ok", _0: null });
    expect(tcx.uses_unique_generic_params(args, "OnlyParam" as never)).toEqual({ $: "Err", _0: { $: "NotParam", _0: re } } as never);
  });

  test("is_typeck_child / typeck_root_def_id walk closures and inline consts up to their owner", () => {
    const tcx = mk_tcx();
    const kinds = new Map<number, unknown>([
      [1, { $: "Fn" }],
      [2, { $: "Closure" }],
      [3, { $: "AnonConst" }],
      [4, { $: "AnonConst" }],
    ]);
    const parents = new Map<number, number>([
      [2, 1],
      [3, 2],
      [4, 1],
    ]);
    const t = with_methods(tcx, {
      def_kind: (d: DefId) => kinds.get(d.index as number),
      parent: (d: DefId) => did(parents.get(d.index as number)!),
      local_parent: (d: LocalDefId) => parents.get(d as number) as LocalDefId,
      anon_const_kind: (d: DefId) => ((d.index as number) === 3 ? "NonTypeSystemInline" : "MCG"),
    });
    expect(t.is_closure_like(did(2))).toBe(true);
    expect(t.is_typeck_child(did(1))).toBe(false);
    expect(t.is_typeck_child(did(3))).toBe(true);
    expect(t.is_typeck_child(did(4))).toBe(false);
    expect(t.typeck_root_def_id(did(3)).index).toBe(did(1).index);
    expect(t.typeck_root_def_id(did(4)).index).toBe(did(4).index);
    expect(t.typeck_root_def_id_local(3 as LocalDefId)).toBe(1 as LocalDefId);
  });

  test("res_generics_def_id", () => {
    const tcx = mk_tcx();
    const parents = new Map<number, number>([
      [3, 2],
      [2, 1],
    ]);
    const t = with_methods(tcx, { parent: (d: DefId) => did(parents.get(d.index as number)!) });
    const ctor_variant = t.res_generics_def_id({ $: "Def", _0: { $: "Ctor", _0: "Variant", _1: "Fn" }, _1: did(3) });
    expect(ctor_variant?.index).toBe(did(1).index);
    expect(t.res_generics_def_id({ $: "Def", _0: { $: "Variant" }, _1: did(2) })?.index).toBe(did(1).index);
    expect(t.res_generics_def_id({ $: "Def", _0: { $: "Struct" }, _1: did(2) })?.index).toBe(did(2).index);
    expect(t.res_generics_def_id({ $: "Def", _0: { $: "Mod" }, _1: did(2) })).toBeUndefined();
    expect(t.res_generics_def_id({ $: "Err" } as never)).toBeUndefined();
  });

  test("def_kind_descr / def_kind_descr_article for coroutines, methods and the DefKind fallback", () => {
    const tcx = mk_tcx();
    const coroutine = new Map<number, unknown>([
      [1, { $: "Desugared", _0: "Async", _1: "Fn" }],
      [2, { $: "Desugared", _0: "Gen", _1: "Block" }],
      [3, { $: "Coroutine", _0: "Static" }],
      [4, undefined],
    ]);
    const t = with_methods(tcx, {
      coroutine_kind: (d: DefId) => coroutine.get(d.index as number),
      associated_item: (d: DefId) => ({ def_id: d, kind: { $: "Fn", name: sym.Abi, has_self: (d.index as number) === 5 } }),
    });
    const closure = { $: "Closure" } as const;
    expect(t.def_kind_descr(closure, did(1))).toBe("async fn");
    expect(t.def_kind_descr_article(closure, did(1))).toBe("an");
    expect(t.def_kind_descr(closure, did(2))).toBe("gen block");
    expect(t.def_kind_descr_article(closure, did(2))).toBe("a");
    expect(t.def_kind_descr(closure, did(3))).toBe("coroutine");
    expect(t.def_kind_descr(closure, did(4))).toBe("closure");
    expect(t.def_kind_descr({ $: "AssocFn" }, did(5))).toBe("method");
    expect(t.def_kind_descr_article({ $: "AssocFn" }, did(5))).toBe("a");
    expect(t.def_kind_descr({ $: "AssocFn" }, did(6))).toBe("associated function");
    expect(t.def_kind_descr_article({ $: "AssocFn" }, did(6))).toBe("an");
  });

  test("closure_env_ty FnOnce is the closure type itself", () => {
    const tcx = mk_tcx();
    const ty = param(tcx, 0);
    expect(tcx.closure_env_ty(ty, "FnOnce", tcx.lifetimes.re_erased)).toBe(ty);
  });

  test("static_mutability / is_static / is_mutable_static read DefKind::Static", () => {
    const tcx = mk_tcx();
    const t = with_methods(tcx, {
      def_kind: (d: DefId) => ((d.index as number) === 1 ? { $: "Static", safety: "Safe", mutability: "Mut", nested: false } : { $: "Fn" }),
    });
    expect(t.is_static(did(1))).toBe(true);
    expect(t.static_mutability(did(1))).toBe("Mut");
    expect(t.is_mutable_static(did(1))).toBe(true);
    expect(t.is_static(did(2))).toBe(false);
    expect(t.static_mutability(did(2))).toBeUndefined();
  });

  test("unported dependencies stop as UNPORTED, not TypeError", () => {
    const tcx = mk_tcx();
    // `IntegerExt::from_int_ty` + `Integer::size` (ported since lane typeck-gaps): i32 is 4 bytes, signed.
    const [size, signed] = tcx.types.i32.int_size_and_signed(tcx);
    expect([size.bytes(), signed]).toEqual([4, true]);
    expect(() => tcx.types.char.numeric_min_and_max_as_bits(tcx)).not.toThrow();
    expect(tcx.types.char.numeric_min_and_max_as_bits(tcx)).toEqual([0n, 0x10ffffn]);
    expect(tcx.types.bool.numeric_min_and_max_as_bits(tcx)).toBeUndefined();
  });
});

describe("fold_list", () => {
  test("an identity fold returns the same list; a changing fold interns a new one", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const list = tcx.mk_type_list([t.i32, t.bool, t.i32]);
    const mk = (i32_to: Ty): TypeFolder => {
      const folder: TypeFolder = {
        cx: () => tcx,
        fold_ty: (ty) => (ty === t.i32 ? i32_to : ty),
        fold_binder: (b, d) => TypeFolder_provided.fold_binder(folder, b, d),
        fold_region: (r) => r,
        fold_const: (c) => TypeFolder_provided.fold_const(folder, c),
        fold_predicate: (p, d) => TypeFolder_provided.fold_predicate(folder, p, d),
        fold_clauses: (c) => TypeFolder_provided.fold_clauses(folder, c),
      };
      return folder;
    };
    const d = { fold_with: (ty: Ty, f: TypeFolder) => f.fold_ty(ty), try_fold_with: () => undefined as never, visit_with: () => undefined as never };
    expect(fold_list(list, mk(t.i32), (tcx_, v) => tcx_.mk_type_list(v), d)).toBe(list);
    expect(fold_list(list, mk(t.u8), (tcx_, v) => tcx_.mk_type_list(v), d)).toBe(tcx.mk_type_list([t.u8, t.bool, t.u8]));
  });
});

test("Debug of the util types", () => {
  expect(debug_CheckRegions("FromFunction", PLAIN)).toBe("FromFunction");
  expect(debug_AlwaysRequiresDrop(AlwaysRequiresDrop, PLAIN)).toBe("AlwaysRequiresDrop");
});
