// Lane ty-results: rustc_middle ty/structural_impls.rs — `Ty`'s `TypeSuperFoldable` / `TypeSuperVisitable` through real
// folders / visitors (the default `fold_ty` / `visit_ty` recurse into them), `Predicate`'s super fold, `ValTree`'s fold,
// `ErrorGuaranteed`'s visit, `fold_list`, and the manual Debug impls. The kinds used avoid the stubs of other lanes
// (`GenericArgs` / `&List<Ty>` folds, `Region` flags): `RawPtr`, `Slice`, `Array` (its length a `ty::Value` const),
// `Error`, leaves.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { type ControlFlow, ControlFlow as ControlFlowC, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { DefId, DefIndex, CrateNum } from "../../rustc_span/def_id.ts";
import { create_default_session_globals_then, ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { Binder, PredicateKind } from "../../rustc_type_ir/decls.ts";
import { type FallibleTypeFolder, FallibleTypeFolder_provided, type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import { ScalarInt } from "./consts/int.ts";
import { ValTree } from "./consts/valtree.ts";
import { RawList, type Clauses } from "./list.ts";
import type { Ty } from "./mod.ts";
import {
  debug_LateParamRegionKind,
  debug_ParamConst,
  debug_ParamTy,
  fold_ErrorGuaranteed,
  fold_list,
  fold_Predicate,
  fold_Ty,
  fold_ValTree,
  try_fold_list,
} from "./structural_impls.ts";

/** A `TyCtxt` over fresh interners (interning reads only `interners` / `types`). */
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}
const tcx = mk_tcx();
const { u8, i32, bool, char, usize } = tcx.types;
const ptr = (t: Ty): Ty => tcx.mk_ty_from_kind({ $: "RawPtr", _0: t, _1: "Not" });
const slice = (t: Ty): Ty => tcx.mk_ty_from_kind({ $: "Slice", _0: t });
const len = (n: bigint): Const => tcx.mk_ct_from_kind({ $: "Value", _0: { ty: usize, valtree: ValTree.from_scalar_int(tcx, ScalarInt.from_u64(n)) } } as never);
const array = (t: Ty, n: bigint): Ty => tcx.mk_ty_from_kind({ $: "Array", _0: t, _1: len(n) });

/** `u8 → i32` everywhere (all other methods default). */
class U8ToI32 implements TypeFolder {
  folded: Ty[] = [];
  cx(): TyCtxt {
    return tcx;
  }
  fold_ty(t: Ty): Ty {
    this.folded.push(t);
    if (t === u8) return i32;
    return TypeFolder_provided.fold_ty(this, t);
  }
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/** A fallible folder failing on `char`. */
class NoChar implements FallibleTypeFolder<string> {
  folded: Ty[] = [];
  cx(): TyCtxt {
    return tcx;
  }
  try_fold_ty(t: Ty): Result<Ty, string> {
    this.folded.push(t);
    if (t === char) return Err("char");
    if (t === u8) return Ok(i32);
    return FallibleTypeFolder_provided.try_fold_ty(this, t);
  }
  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, string> {
    return FallibleTypeFolder_provided.try_fold_binder(this, t, d);
  }
  try_fold_region(r: Region): Result<Region, string> {
    return FallibleTypeFolder_provided.try_fold_region(this, r);
  }
  try_fold_const(c: Const): Result<Const, string> {
    return FallibleTypeFolder_provided.try_fold_const(this, c);
  }
  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, string> {
    return FallibleTypeFolder_provided.try_fold_predicate(this, p, d);
  }
  try_fold_clauses(c: Clauses): Result<Clauses, string> {
    return FallibleTypeFolder_provided.try_fold_clauses(this, c);
  }
}

/** Records every type visited; breaks on `stop`. */
class Collect implements TypeVisitor<ControlFlow<Ty>> {
  readonly Result = VisitorResult.ControlFlow<Ty>();
  seen: Ty[] = [];
  errors = 0;
  constructor(readonly stop?: Ty) {}
  visit_ty(t: Ty): ControlFlow<Ty> {
    this.seen.push(t);
    if (t === this.stop) return ControlFlowC.Break(t);
    return TypeVisitor_provided.visit_ty(this, t);
  }
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(g: ErrorGuaranteed): ControlFlow<Ty> {
    this.errors++;
    return TypeVisitor_provided.visit_error(this, g);
  }
}

describe("Ty: TypeFoldable / TypeSuperFoldable (structural_impls.rs:311-:417)", () => {
  test("fold_with goes through the folder; super_fold_with rebuilds changed kinds and reuses unchanged ones", () => {
    const f = new U8ToI32();
    expect(fold_Ty.fold_with(ptr(slice(u8)), f)).toBe(ptr(slice(i32)));
    // pre-order through the default `fold_ty` → `super_fold_with`
    expect(f.folded).toEqual([ptr(slice(u8)), slice(u8), u8]);
    const same = ptr(slice(bool));
    expect(fold_Ty.fold_with(same, new U8ToI32())).toBe(same);
    // leaves are returned as is
    expect(fold_Ty.super_fold_with(bool, new U8ToI32())).toBe(bool);
  });

  test("Array folds its element type and its length const (a `ty::Value`: its `ty`, then its valtree)", () => {
    const f = new U8ToI32();
    expect(fold_Ty.fold_with(array(u8, 3n), f)).toBe(array(i32, 3n));
    expect(f.folded).toEqual([array(u8, 3n), u8, usize]);
    const a = array(bool, 2n);
    expect(fold_Ty.fold_with(a, new U8ToI32())).toBe(a);
  });

  test("try_super_fold_with stops at the first Err, in field order", () => {
    const f = new NoChar();
    expect(fold_Ty.try_fold_with(ptr(array(char, 1n)), f)).toEqual(Err("char"));
    expect(f.folded).toEqual([ptr(array(char, 1n)), array(char, 1n), char]);
    expect(fold_Ty.try_fold_with(slice(array(u8, 4n)), new NoChar())).toEqual(Ok(slice(array(i32, 4n))));
    expect(fold_Ty.try_super_fold_with(bool, new NoChar())).toEqual(Ok(bool));
  });
});

describe("Ty: TypeVisitable / TypeSuperVisitable (structural_impls.rs:324, :419)", () => {
  test("visits pre-order and short-circuits on Break", () => {
    const v = new Collect(u8);
    expect(fold_Ty.visit_with(ptr(array(slice(u8), 2n)), v)).toEqual(ControlFlowC.Break(u8));
    expect(v.seen).toEqual([ptr(array(slice(u8), 2n)), array(slice(u8), 2n), slice(u8), u8]);
    const w = new Collect();
    expect(fold_Ty.visit_with(array(bool, 2n), w)).toBe(ControlFlowC.CONTINUE);
    // the length const's value type is visited after the element type
    expect(w.seen).toEqual([array(bool, 2n), bool, usize]);
  });

  test("Error visits its ErrorGuaranteed through visit_error", () => {
    const err = tcx.mk_ty_from_kind({ $: "Error", _0: ErrorGuaranteed.unchecked_error_guaranteed() } as never);
    const v = new Collect();
    expect(fold_Ty.visit_with(slice(err), v)).toBe(ControlFlowC.CONTINUE);
    expect(v.errors).toBe(1);
    expect(fold_ErrorGuaranteed.fold_with(ErrorGuaranteed.unchecked_error_guaranteed(), new U8ToI32())).toEqual(ErrorGuaranteed.unchecked_error_guaranteed());
  });

  test("flags come from the cached type info", () => {
    const t = ptr(u8);
    expect(fold_Ty.flags(t)).toBe(t.flags());
    expect(fold_Ty.outer_exclusive_binder(t)).toBe(t.outer_exclusive_binder());
  });
});

describe("Predicate (structural_impls.rs:470-:616)", () => {
  // (Its `super_fold_with` folds the generated `PredicateKind` impls, which reach ty/mod.ts's gen-shaped `Ty` stubs until
  // root repoints them at `fold_Ty`.)
  test("fold_with / visit_with hand the predicate and its PredicateProxy descriptor to the folder / visitor", () => {
    const p = tcx.mk_predicate({ value: { $: "Clause", _0: { $: "ConstArgHasType", _0: len(1n), _1: u8 } }, bound_vars: RawList.empty() } as Binder<PredicateKind>);
    const calls: unknown[] = [];
    const f = new (class extends U8ToI32 {
      override fold_predicate<P>(q: P, d: PredicateProxy<P>): P {
        calls.push([q, d]);
        return q;
      }
    })();
    expect(fold_Predicate.fold_with(p, f)).toBe(p);
    expect(calls).toEqual([[p, fold_Predicate]]);
    expect(fold_Predicate.flags.flags(p)).toBe(p.flags());
  });
});

describe("ValTree (structural_impls.rs:643-:672) and fold_list (util.rs stand-in)", () => {
  test("a valtree is re-interned only when a branch changed", () => {
    const c = (t: Ty, n: number): Const => tcx.mk_ct_from_kind({ $: "Value", _0: { ty: t, valtree: ValTree.from_scalar_int(tcx, ScalarInt.from_u8(n)) } } as never);
    const vt = ValTree.from_branches(tcx, [c(u8, 1), c(bool, 0)]);
    const folded = fold_ValTree.fold_with(vt, new U8ToI32());
    expect(folded).not.toBe(vt);
    expect(folded).toBe(ValTree.from_branches(tcx, [c(i32, 1), c(bool, 0)]));
    const leaf = ValTree.from_scalar_int(tcx, ScalarInt.from_u8(7));
    expect(fold_ValTree.fold_with(leaf, new U8ToI32())).toBe(leaf);
    expect(fold_ValTree.try_fold_with(ValTree.from_branches(tcx, [c(char, 0)]), new NoChar())).toEqual(Err("char"));
  });

  test("fold_list returns the list itself when no element changes, else interns a new one", () => {
    const l = tcx.mk_type_list([bool, u8, char]);
    const mk = (cx: TyCtxt, v: readonly Ty[]) => cx.mk_type_list(v);
    expect(fold_list(l, new U8ToI32(), mk, fold_Ty)).toBe(tcx.mk_type_list([bool, i32, char]));
    const m = tcx.mk_type_list([bool, char]);
    expect(fold_list(m, new U8ToI32(), mk, fold_Ty)).toBe(m);
    const f = new NoChar();
    expect(try_fold_list(l, f, mk, fold_Ty)).toEqual(Err("char"));
    expect(f.folded).toEqual([bool, u8, char]);
    expect(try_fold_list(tcx.mk_type_list([u8, bool]), new NoChar(), mk, fold_Ty)).toEqual(Ok(tcx.mk_type_list([i32, bool])));
  });
});

describe("Debug impls (structural_impls.rs:22-:152)", () => {
  test("ParamTy / ParamConst / LateParamRegionKind", () =>
    create_default_session_globals_then(() => {
      expect(debug_ParamTy({ index: 0, name: Symbol.intern("T") }, PLAIN)).toBe("T/#0");
      expect(debug_ParamConst({ index: 3, name: Symbol.intern("N") }, PLAIN)).toBe("N/#3");
      expect(debug_LateParamRegionKind({ $: "Anon", _0: 2 }, PLAIN)).toBe("LateAnon(2)");
      expect(debug_LateParamRegionKind({ $: "NamedAnon", _0: 1, _1: Symbol.intern("'a") }, PLAIN)).toBe("LateNamedAnon(1, 'a)");
      expect(debug_LateParamRegionKind({ $: "ClosureEnv" }, PLAIN)).toBe("LateEnv");
      expect(debug_LateParamRegionKind({ $: "Named", _0: new DefId(DefIndex.from_u32(5), 0 as CrateNum) }, PLAIN)).toBe(
        // `DefId`'s Debug without a `TyCtxt` (rustc_span's default hook)
        "LateNamed(DefId { krate: crate0, index: DefIndex(5) })",
      );
    }));
});
