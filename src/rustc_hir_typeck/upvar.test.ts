// Unit tests of compiler/rustc_hir_typeck/src/upvar.rs's free fns (lane typeck-upvar).
//
// The places are rustc_middle hir/place.ts `Place`s (merge-w18); the types are stubs answering only `kind()` /
// `is_raw_ptr()` / `is_union()` / `is_ref()`.
import { expect, test } from "bun:test";
import "./lib.ts";
import { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import type { CaptureInfo, CapturedPlace as CapturedPlaceT, UpvarCapture } from "../rustc_middle/ty/closure.ts";
import { fold_with_Place, Place, Place_eq, type PlaceBase, type Projection, try_fold_with_Place, visit_with_Place } from "../rustc_middle/hir/place.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { CapturedPlace, UpvarId } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { FieldIdx, VariantIdx } from "../rustc_middle/ty/decls.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../rustc_span/lib.ts";
import { Ident, Symbol } from "../rustc_span/symbol.ts";
import { Unported } from "../std/panic.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { PlaceWithHirId } from "./decls.ts";
import {
  adjust_for_move_closure,
  adjust_for_non_move_closure,
  adjust_for_use_closure,
  apply_capture_kind_on_capture_ty,
  construct_capture_info_string,
  construct_capture_kind_reason_string,
  construct_path_string,
  construct_place_string,
  determine_capture_info,
  determine_place_ancestry_relation,
  InferBorrowKind,
  MigrationWarningReason,
  MigrationWarningReason_migration_message,
  migration_suggestion_for_2229,
  restrict_capture_precision,
  restrict_repr_packed_field_ref_capture,
  should_reborrow_from_env_of_parent_coroutine_closure,
  truncate_capture_for_optimization,
  truncate_place_to_len_and_update_capture_kind,
} from "./upvar.ts";

// ---- fakes ----------------------------------------------------------------------------------------------------------

type K = { readonly $: string; readonly [f: string]: unknown };
const ty = (k: K): Ty =>
  ({
    kind: () => k,
    is_raw_ptr: () => k.$ === "RawPtr",
    is_ref: () => k.$ === "Ref",
    is_union: () => k.$ === "Adt" && (k._0 as { is_union(): boolean }).is_union(),
  }) as unknown as Ty;
const adt = (opts: { packed?: boolean; union?: boolean }): K => ({
  $: "Adt",
  _0: { repr: () => ({ packed: () => opts.packed === true }), is_union: () => opts.union === true, is_box: () => false },
  _1: [],
});
const INT = ty({ $: "Int", _0: "I32" });
const STRUCT = ty(adt({}));
const PACKED = ty(adt({ packed: true }));
const UNION = ty(adt({ union: true }));
const REF_MUT = ty({ $: "Ref", _0: undefined, _1: STRUCT, _2: "Mut" });
const REF_NOT = ty({ $: "Ref", _0: undefined, _1: STRUCT, _2: "Not" });
const RAW = ty({ $: "RawPtr", _0: STRUCT, _1: "Not" });
const ARRAY = ty({ $: "Array", _0: INT, _1: undefined });

type Proj = Projection;

const CLOSURE = 7 as LocalDefId;
const hir = (owner: number, local: number): HirId => new HirId(new OwnerId(owner as LocalDefId), ItemLocalId.from_u32(local));
const X = hir(1, 2);
const Y = hir(1, 3);
const upvar = (v: HirId): PlaceBase => ({ $: "Upvar", _0: UpvarId.new(v, CLOSURE) });
const place = (base_ty: Ty, projs: Proj[], root: HirId = X): Place => new Place(base_ty, upvar(root), projs);
const fp = (p: Place): Place => p;
const field = (i: number, t: Ty = INT): Proj => ({ ty: t, kind: { $: "Field", _0: i as FieldIdx, _1: 0 as VariantIdx } });
const deref = (t: Ty): Proj => ({ ty: t, kind: { $: "Deref" } });
const index = (t: Ty): Proj => ({ ty: t, kind: { $: "Index" } });
const kinds = (p: Place): string[] => fp(p).projections.map((x) => (x.kind.$ === "Field" ? `F${x.kind._0}` : x.kind.$));

const BY_VALUE: UpvarCapture = { $: "ByValue" };
const BY_USE: UpvarCapture = { $: "ByUse" };
const IMM: UpvarCapture = { $: "ByRef", _0: "Immutable" };
const UNIQ: UpvarCapture = { $: "ByRef", _0: "UniqueImmutable" };
const MUT: UpvarCapture = { $: "ByRef", _0: "Mutable" };
const info = (capture_kind: UpvarCapture, expr?: HirId): CaptureInfo => ({ capture_kind_expr_id: expr, path_expr_id: expr, capture_kind });

// ---- tests ----------------------------------------------------------------------------------------------------------

test("determine_capture_info: (ByUse | ByValue) > MutBorrow > UniqueImmBorrow > ImmBorrow; ties prefer an expr id, then A", () => {
  const e1 = hir(1, 10);
  const e2 = hir(1, 11);
  expect(determine_capture_info(info(MUT, e1), info(IMM, e2)).capture_kind).toEqual(MUT);
  expect(determine_capture_info(info(IMM, e1), info(UNIQ, e2)).capture_kind).toEqual(UNIQ);
  expect(determine_capture_info(info(MUT), info(BY_VALUE)).capture_kind).toEqual(BY_VALUE);
  expect(determine_capture_info(info(BY_USE), info(MUT)).capture_kind).toEqual(BY_USE);
  // Equal: (Some(_), _) | (None, None) => A, (None, Some(_)) => B
  expect(determine_capture_info(info(MUT, e1), info(MUT, e2)).capture_kind_expr_id).toBe(e1);
  expect(determine_capture_info(info(MUT), info(MUT, e2)).capture_kind_expr_id).toBe(e2);
  const a = info(IMM);
  const r = determine_capture_info(a, info(IMM));
  expect(r).toEqual(a);
  // `CaptureInfo` is `Copy`: mutating the result leaves the argument alone
  r.path_expr_id = e1;
  expect(a.path_expr_id).toBeUndefined();
  expect(() => determine_capture_info(info(BY_USE), info(BY_VALUE))).toThrow("Same capture can't be ByUse and ByValue at the same time");
});

test("determine_place_ancestry_relation", () => {
  const p = place(STRUCT, [field(0, STRUCT)]);
  expect(determine_place_ancestry_relation(p, place(STRUCT, [field(0, STRUCT), field(1)]))).toBe("Ancestor");
  expect(determine_place_ancestry_relation(place(STRUCT, [field(0, STRUCT), field(1)]), p)).toBe("Descendant");
  expect(determine_place_ancestry_relation(p, place(STRUCT, [field(0, STRUCT)]))).toBe("SamePlace");
  expect(determine_place_ancestry_relation(p, place(STRUCT, [field(1)]))).toBe("Divergent");
  expect(determine_place_ancestry_relation(p, place(STRUCT, [field(0, STRUCT)], Y))).toBe("Divergent");
  // the root alone is an ancestor of every path from it
  expect(determine_place_ancestry_relation(place(STRUCT, []), p)).toBe("Ancestor");
});

test("truncate_place_to_len_and_update_capture_kind: MutBorrow -> UniqueImmBorrow only when a truncated Deref is of a &mut", () => {
  // x: &mut S, place `(*x).0`
  const p1 = place(REF_MUT, [deref(STRUCT), field(0)]);
  const m1: MutRef<UpvarCapture> = { value: MUT };
  truncate_place_to_len_and_update_capture_kind(p1, m1, 0);
  expect(kinds(p1)).toEqual([]);
  expect(m1.value).toEqual(UNIQ);

  // the Deref is kept: no change
  const p2 = place(REF_MUT, [deref(STRUCT), field(0)]);
  const m2: MutRef<UpvarCapture> = { value: MUT };
  truncate_place_to_len_and_update_capture_kind(p2, m2, 1);
  expect(kinds(p2)).toEqual(["Deref"]);
  expect(m2.value).toEqual(MUT);

  // Deref of a & reference: no change
  const p3 = place(REF_NOT, [deref(STRUCT), field(0)]);
  const m3: MutRef<UpvarCapture> = { value: MUT };
  truncate_place_to_len_and_update_capture_kind(p3, m3, 0);
  expect(m3.value).toEqual(MUT);

  // `Vec::truncate` with a larger `len` is a no-op
  const p4 = place(STRUCT, [field(0)]);
  truncate_place_to_len_and_update_capture_kind(p4, { value: BY_VALUE }, 5);
  expect(kinds(p4)).toEqual(["F0"]);
  expect(fp(p4).projections.length).toBe(1);
});

test("adjust_for_{move,use,non_move}_closure", () => {
  const mk = () => place(REF_NOT, [deref(STRUCT), field(1)]);
  let [p, k] = adjust_for_move_closure(mk(), IMM);
  expect([kinds(p), k]).toEqual([[], BY_VALUE]);
  [p, k] = adjust_for_use_closure(mk(), MUT);
  expect([kinds(p), k]).toEqual([[], BY_USE]);
  // non-move: ByValue truncates at the first Deref, ByRef is untouched, ByUse becomes an immutable borrow
  [p, k] = adjust_for_non_move_closure(mk(), BY_VALUE);
  expect([kinds(p), k]).toEqual([[], BY_VALUE]);
  [p, k] = adjust_for_non_move_closure(mk(), MUT);
  expect([kinds(p), k]).toEqual([["Deref", "F1"], MUT]);
  [p, k] = adjust_for_non_move_closure(place(STRUCT, [field(0)]), BY_USE);
  expect([kinds(p), k]).toEqual([["F0"], IMM]);
});

test("restrict_capture_precision: arrays are captured whole, nothing through a raw pointer or a union", () => {
  // x.0[i].1 -> x.0
  let [p, k] = restrict_capture_precision(place(STRUCT, [field(0, ARRAY), index(STRUCT), field(1)]), MUT);
  expect([kinds(p), k]).toEqual([["F0"], MUT]);
  // a raw-pointer base: captured whole
  [p, k] = restrict_capture_precision(place(RAW, [deref(STRUCT), field(0)]), IMM);
  expect([kinds(p), k]).toEqual([[], IMM]);
  // x.0 is a raw pointer: (*x.0).1 -> x.0
  [p] = restrict_capture_precision(place(STRUCT, [field(0, RAW), deref(STRUCT), field(1)]), IMM);
  expect(kinds(p)).toEqual(["F0"]);
  // x.u is a union: x.u.f -> x.u
  [p] = restrict_capture_precision(place(STRUCT, [field(0, UNION), field(1)]), IMM);
  expect(kinds(p)).toEqual(["F0"]);
  // a union base: captured whole
  [p] = restrict_capture_precision(place(UNION, [field(1)]), IMM);
  expect(kinds(p)).toEqual([]);
});

test("restrict_repr_packed_field_ref_capture stops at the first field of a packed struct", () => {
  // x.0.1 where x.0 is packed -> x.0
  let [p, k] = restrict_repr_packed_field_ref_capture(place(STRUCT, [field(0, PACKED), field(1)]), MUT);
  expect([kinds(p), k]).toEqual([["F0"], MUT]);
  // (*x).0 with x: &mut Packed -> *x (the Deref is kept, so the borrow stays mutable)
  [p, k] = restrict_repr_packed_field_ref_capture(place(ty({ $: "Ref", _0: undefined, _1: PACKED, _2: "Mut" }), [deref(PACKED), field(0)]), MUT);
  expect([kinds(p), k]).toEqual([["Deref"], MUT]);
  [p, k] = restrict_repr_packed_field_ref_capture(place(STRUCT, [field(0), field(1)]), MUT);
  expect([kinds(p), k]).toEqual([["F0", "F1"], MUT]);
});

test("truncate_capture_for_optimization drops what follows the rightmost Deref of a shared reference", () => {
  // (*x).0 with x: &S -> *x
  let [p] = truncate_capture_for_optimization(place(REF_NOT, [deref(STRUCT), field(0)]), IMM);
  expect(kinds(p)).toEqual(["Deref"]);
  // (*x).0 with x: &mut S: unchanged
  [p] = truncate_capture_for_optimization(place(REF_MUT, [deref(STRUCT), field(0)]), MUT);
  expect(kinds(p)).toEqual(["Deref", "F0"]);
  // only the rightmost Deref counts: (*(*x).0).1 with (*x).0: &mut T
  const inner_mut = ty({ $: "Ref", _0: undefined, _1: STRUCT, _2: "Mut" });
  [p] = truncate_capture_for_optimization(place(REF_NOT, [deref(STRUCT), field(0, inner_mut), deref(STRUCT), field(1)]), IMM);
  expect(kinds(p)).toEqual(["Deref", "F0", "Deref", "F1"]);
});

test("apply_capture_kind_on_capture_ty: by-value captures keep the type", () => {
  const tcx = {} as TyCtxt;
  expect(apply_capture_kind_on_capture_ty(tcx, INT, BY_VALUE, undefined as never)).toBe(INT);
  expect(apply_capture_kind_on_capture_ty(tcx, INT, BY_USE, undefined as never)).toBe(INT);
});

test("should_reborrow_from_env_of_parent_coroutine_closure", () => {
  const cap = (p: Place, k: UpvarCapture): CapturedPlaceT => new CapturedPlace(Ident.new(Symbol.intern("x"), DUMMY_SP), p, info(k), "Not");
  create_default_session_globals_then(() => {
    // (1.) parent by move, child borrows through no `&T` deref
    expect(should_reborrow_from_env_of_parent_coroutine_closure(cap(place(STRUCT, []), BY_VALUE), cap(place(STRUCT, [field(0)]), IMM))).toBe(true);
    // (1.) fails: the child derefs a `&T` past the parent's projections
    expect(should_reborrow_from_env_of_parent_coroutine_closure(cap(place(REF_NOT, []), BY_VALUE), cap(place(REF_NOT, [deref(STRUCT), field(0)]), IMM))).toBe(false);
    // parent by ref, child not a mutable borrow
    expect(should_reborrow_from_env_of_parent_coroutine_closure(cap(place(STRUCT, []), IMM), cap(place(STRUCT, [field(0)]), IMM))).toBe(false);
    // (2.) the child borrows mutably
    expect(should_reborrow_from_env_of_parent_coroutine_closure(cap(place(STRUCT, []), IMM), cap(place(STRUCT, [field(0)]), MUT))).toBe(true);
  });
});

test("construct_*_string / migration_suggestion_for_2229 / migration_message", () => {
  create_default_session_globals_then(() => {
    const names = new Map([
      [X.local_id, "x"],
      [Y.local_id, "y"],
    ]);
    const tcx = { hir_name: (id: HirId) => Symbol.intern(names.get(id.local_id)!) } as unknown as TyCtxt;
    const p = place(REF_MUT, [deref(STRUCT), field(1), { ty: INT, kind: { $: "Field", _0: 0 as FieldIdx, _1: 2 as VariantIdx } }]);
    expect(construct_place_string(tcx, p)).toBe("x[Deref,(1, 0),(0, 2)]");
    expect(construct_place_string(tcx, place(STRUCT, []))).toBe("x[]");
    expect(construct_capture_info_string(tcx, p, info(UNIQ))).toBe("x[Deref,(1, 0),(0, 2)] -> UniqueImmutable");
    expect(construct_capture_info_string(tcx, p, info(BY_VALUE))).toBe("x[Deref,(1, 0),(0, 2)] -> ByValue");
    expect(construct_capture_kind_reason_string(tcx, p, info(MUT))).toBe("x[Deref,(1, 0),(0, 2)] captured as Mutable here");
    expect(construct_capture_kind_reason_string(tcx, p, info(BY_USE))).toBe("x[Deref,(1, 0),(0, 2)] captured as ByUse here");
    expect(construct_path_string(tcx, p)).toBe("x[Deref,(1, 0),(0, 2)] used here");

    expect(migration_suggestion_for_2229(tcx, [{ var_hir_id: X, diagnostics_info: [] }])).toEqual(["let _ = &x", "`x`"]);
    expect(
      migration_suggestion_for_2229(tcx, [
        { var_hir_id: X, diagnostics_info: [] },
        { var_hir_id: Y, diagnostics_info: [] },
      ]),
    ).toEqual(["let _ = (&x, &y)", "`x`, `y`"]);

    const base = "changes to closure capture in Rust 2021 will affect";
    expect(MigrationWarningReason_migration_message(new MigrationWarningReason(["`Send`"], true))).toBe(`${base} drop order and which traits the closure implements`);
    expect(MigrationWarningReason_migration_message(new MigrationWarningReason([], true))).toBe(`${base} drop order`);
    expect(MigrationWarningReason_migration_message(new MigrationWarningReason(["`Send`"], false))).toBe(`${base} which traits the closure implements`);
  });
});

test("InferBorrowKind ignores non-upvar places and records upvar captures through the generated hir::place::Place folds", () => {
  create_default_session_globals_then(() => {
    // `normalize` stub: returns the value as given and records the `TypeFoldable` descriptor it was handed (since
    // small-gaps-19 the generated `hir::place::Place` derives of hir/place.gen.ts, no longer an `unported` stand-in).
    const seen: { visit_with: unknown; try_fold_with: unknown; fold_with: unknown }[] = [];
    const fcx = {
      tcx: { hir_span: () => DUMMY_SP },
      normalize: (_s: unknown, v: Unnormalized<Place>, d: { visit_with: unknown; try_fold_with: unknown; fold_with: unknown }) => {
        seen.push(d);
        return Unnormalized.skip_norm_wip(v);
      },
    } as never;
    const d = new InferBorrowKind(fcx, CLOSURE, [], []);
    const local = { hir_id: X, place: new Place(STRUCT, { $: "Local", _0: X }, []) } as unknown as PlaceWithHirId;
    d.consume(local, X);
    d.use_cloned(local, X);
    d.borrow(local, X, "Mutable");
    d.mutate(local, X);
    d.fake_read(local, { $: "ForLet", _0: undefined } as never, X);
    expect(d.capture_information).toEqual([]);
    expect(d.fake_reads).toEqual([]);

    const up = { hir_id: X, place: place(STRUCT, []) } as unknown as PlaceWithHirId;
    d.consume(up, X);
    expect(seen.length).toBe(1);
    expect(seen[0]!.visit_with).toBe(visit_with_Place);
    expect(seen[0]!.try_fold_with).toBe(try_fold_with_Place);
    expect(seen[0]!.fold_with).toBe(fold_with_Place);
    expect(d.capture_information.length).toBe(1);
    const [captured, capture_info] = d.capture_information[0]!;
    expect(Place_eq(captured, up.place)).toBe(true);
    expect(capture_info).toEqual({ capture_kind_expr_id: X, path_expr_id: X, capture_kind: { $: "ByValue" } });
  });
});
