// Port of compiler/rustc_const_eval/src/interpret/traits.rs (declared by lane interp-contract, filled by lane interp-ops).
import { type Align, Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import {
  type CtfeProvenance,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  type Pointer,
  Pointer_from_AllocId,
  Pointer_Option_from_Pointer,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ordering, type Ty } from "../../rustc_middle/ty/mod.ts";
import { ExistentialPredicate_stable_cmp, type PolyExistentialPredicate, type PolyExistentialTraitRef } from "../../rustc_middle/ty/predicate.ts";
import { fold_BoundExistentialPredicates, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { COMMON_VTABLE_ENTRIES, type VtblEntry } from "../../rustc_middle/ty/vtable.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { fold_tuple2, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { as_interner, type ExistentialPredicate, PolyExistentialTraitRef as PolyExistentialTraitRefC, type TraitRef } from "../../rustc_type_ir/predicate.ts";
import {
  fold_with_ExistentialPredicate,
  fold_with_TraitRef,
  try_fold_with_ExistentialPredicate,
  try_fold_with_TraitRef,
  visit_with_ExistentialPredicate,
  visit_with_TraitRef,
} from "../../rustc_type_ir/predicate.gen.ts";
import { intern_key_eq } from "../../rust_ts/intern_key.ts";
import { assert } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { MPlaceTy } from "./place.gen.ts";
import { MemPlaceMeta } from "./place.ts";
import { OffsetMode } from "./projection.gen.ts";
import { ensure_monomorphic_enough } from "./util.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // traits.rs:19 (lane interp-ops)
    get_vtable_ptr(ty: Ty, dyn_ty: List<PolyExistentialPredicate>): InterpResult<Pointer<CtfeProvenance | undefined>>;
    // traits.rs:38 (lane interp-ops)
    get_vtable_size_and_align(vtable: Pointer<CtfeProvenance | undefined>, expected_trait: List<PolyExistentialPredicate> | undefined): InterpResult<[Size, Align]>;
    // traits.rs:49 (lane interp-ops)
    vtable_entries(trait_: PolyExistentialTraitRef | undefined, dyn_ty: Ty): readonly VtblEntry[];
    // traits.rs:67 (lane interp-ops)
    check_vtable_for_type(vtable_dyn_type: List<PolyExistentialPredicate>, expected_dyn_type: List<PolyExistentialPredicate>): InterpResult;
    // traits.rs:106 (lane interp-ops)
    unpack_dyn_trait(mplace: MPlaceTy, expected_trait: List<PolyExistentialPredicate>): InterpResult<MPlaceTy>;
  }
}

/** PORT: the `TypeFoldable` descriptors this file passes (eval_context.ts header, generic parameters). */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_ExistentialPredicate: TypeFoldable<ExistentialPredicate> = {
  visit_with: visit_with_ExistentialPredicate,
  try_fold_with: try_fold_with_ExistentialPredicate,
  fold_with: fold_with_ExistentialPredicate,
};

/// Creates a dynamic vtable for the given type and vtable origin. This is used only for
/// objects.
///
/// The `dyn_ty` encodes the erased self type. Hence, if we are making an object
/// `Foo<dyn Trait<Assoc = A> + Send>` from a value of type `Foo<T>`, then `dyn_ty`
/// would be `Trait<Assoc = A> + Send`. If this list doesn't have a principal trait ref,
/// we only need the basic vtable prefix (drop, size, align).
// rustc: compiler/rustc_const_eval/src/interpret/traits.rs:19 get_vtable_ptr
InterpCx.prototype.get_vtable_ptr = function (this: InterpCx, ty_: Ty, dyn_ty_: List<PolyExistentialPredicate>): InterpResult<Pointer<CtfeProvenance | undefined>> {
  // trace!("get_vtable(ty={ty:?}, dyn_ty={dyn_ty:?})");

  const [ty, dyn_ty] = this.tcx.deref().erase_and_anonymize_regions<[Ty, List<PolyExistentialPredicate>]>([ty_, dyn_ty_], fold_tuple2(fold_Ty, fold_BoundExistentialPredicates));

  // All vtables must be monomorphic, bail out otherwise.
  const r1 = ensure_monomorphic_enough(ty, fold_Ty);
  if (r1.$ === "Err") return r1;
  const r2 = ensure_monomorphic_enough(dyn_ty, fold_BoundExistentialPredicates);
  if (r2.$ === "Err") return r2;

  const salt = this.machine.get_global_alloc_salt(this, undefined);
  const vtable_symbolic_allocation = this.tcx.deref().reserve_and_set_vtable_alloc(ty, dyn_ty, salt);
  const vtable_ptr = this.global_root_pointer(Pointer_from_AllocId(vtable_symbolic_allocation));
  if (vtable_ptr.$ === "Err") return vtable_ptr;
  return interp_ok(Pointer_Option_from_Pointer(vtable_ptr._0));
};

// rustc: compiler/rustc_const_eval/src/interpret/traits.rs:38 get_vtable_size_and_align
InterpCx.prototype.get_vtable_size_and_align = function (this: InterpCx, vtable: Pointer<CtfeProvenance | undefined>, expected_trait: List<PolyExistentialPredicate> | undefined): InterpResult<[Size, Align]> {
  const ty = this.get_ptr_vtable_ty(vtable, expected_trait);
  if (ty.$ === "Err") return ty;
  const layout = this.layout_of(ty._0);
  if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
  assert(layout._0.is_sized(), "there are no vtables for unsized types");
  return interp_ok<[Size, Align]>([layout._0.size, layout._0.align.abi]);
};

// rustc: compiler/rustc_const_eval/src/interpret/traits.rs:49 vtable_entries
InterpCx.prototype.vtable_entries = function (this: InterpCx, trait_: PolyExistentialTraitRef | undefined, dyn_ty: Ty): readonly VtblEntry[] {
  if (trait_ !== undefined) {
    const trait_ref = PolyExistentialTraitRefC.with_self_ty(trait_, as_interner(this.tcx.deref()), dyn_ty);
    const trait_ref_ = this.tcx.deref().erase_and_anonymize_regions(this.tcx.deref().instantiate_bound_regions_with_erased(trait_ref, d_TraitRef), d_TraitRef);
    return this.tcx.deref().vtable_entries(trait_ref_);
  } else {
    return COMMON_VTABLE_ENTRIES;
  }
};

/// Check that the given vtable trait is valid for a pointer/reference/place with the given
/// expected trait type.
// rustc: compiler/rustc_const_eval/src/interpret/traits.rs:67 check_vtable_for_type
InterpCx.prototype.check_vtable_for_type = function (this: InterpCx, vtable_dyn_type: List<PolyExistentialPredicate>, expected_dyn_type: List<PolyExistentialPredicate>): InterpResult {
  // We check validity by comparing the lists of predicates for equality. We *could* instead
  // check that the dynamic type to which the vtable belongs satisfies all the expected
  // predicates, but that would likely be a lot slower and seems unnecessarily permissive.

  // FIXME: we are skipping auto traits for now, but might revisit this in the future.
  const sorted_vtable: PolyExistentialPredicate[] = [...vtable_dyn_type.without_auto_traits()];
  const sorted_expected: PolyExistentialPredicate[] = [...expected_dyn_type.without_auto_traits()];
  // `skip_binder` here is okay because `stable_cmp` doesn't look at binders
  const tcx = this.tcx.deref();
  const cmp = (a: PolyExistentialPredicate, b: PolyExistentialPredicate): number =>
    ORDERING[ExistentialPredicate_stable_cmp(Binder.skip_binder(a), tcx, Binder.skip_binder(b))];
  // PORT: `sort_by` is stable, as `Array.prototype.sort`; `dedup` / `!=` compare with the derived `PartialEq`
  // (`intern_key_eq`).
  sorted_vtable.sort(cmp);
  dedup(sorted_vtable);
  sorted_expected.sort(cmp);
  dedup(sorted_expected);

  if (sorted_vtable.length !== sorted_expected.length) {
    // throw_ub!(InvalidVTableTrait { vtable_dyn_type, expected_dyn_type })
    return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidVTableTrait", vtable_dyn_type, expected_dyn_type } }));
  }

  // This checks whether there is a subtyping relation between the predicates in either direction.
  // For example:
  // - casting between `dyn for<'a> Trait<fn(&'a u8)>` and `dyn Trait<fn(&'static u8)>` is OK
  // - casting between `dyn Trait<for<'a> fn(&'a u8)>` and either of the above is UB
  for (let i = 0; i < sorted_vtable.length; i++) {
    const a_pred = tcx.normalize_erasing_late_bound_regions(this.typing_env, sorted_vtable[i]!, d_ExistentialPredicate);
    const b_pred = tcx.normalize_erasing_late_bound_regions(this.typing_env, sorted_expected[i]!, d_ExistentialPredicate);

    if (!intern_key_eq(a_pred, b_pred)) {
      // throw_ub!(InvalidVTableTrait { vtable_dyn_type, expected_dyn_type })
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidVTableTrait", vtable_dyn_type, expected_dyn_type } }));
    }
  }

  return interp_ok(undefined);
};

/** `std::cmp::Ordering` as a sort comparator result. */
const ORDERING: Record<Ordering, number> = { Less: -1, Equal: 0, Greater: 1 };

/** `Vec::dedup` (consecutive `==` elements; the derived `PartialEq` is `intern_key_eq`). */
function dedup<T>(v: T[]): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    if (w === 0 || !intern_key_eq(v[w - 1], v[r])) v[w++] = v[r]!;
  }
  v.length = w;
}

/// Turn a place with a `dyn Trait` type into a place with the actual dynamic type.
// rustc: compiler/rustc_const_eval/src/interpret/traits.rs:106 unpack_dyn_trait
InterpCx.prototype.unpack_dyn_trait = function (this: InterpCx, mplace: MPlaceTy, expected_trait: List<PolyExistentialPredicate>): InterpResult<MPlaceTy> {
  assert(mplace.layout.ty.kind().$ === "Dynamic", "`unpack_dyn_trait` only makes sense on `dyn*` types");
  const vtable = Scalar.to_pointer(MemPlaceMeta.unwrap_meta(mplace.meta()), this);
  const ty = this.get_ptr_vtable_ty(vtable, expected_trait);
  if (ty.$ === "Err") return ty;
  // This is a kind of transmute, from a place with unsized type and metadata to
  // a place with sized type and no metadata.
  const layout = this.layout_of(ty._0);
  if (layout.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout._0));
  const mplace_ = mplace.offset_with_meta(Size.ZERO, OffsetMode.Wrapping, MemPlaceMeta.None, layout._0, this);
  if (mplace_.$ === "Err") return mplace_;
  return interp_ok(mplace_._0);
};
