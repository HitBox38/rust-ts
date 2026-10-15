// Port of compiler/rustc_middle/src/hir/place.rs (lane typeck-euv).
//
// PORT: the types of this file are hand-written (they are not in a tools/codegen set; precedent: ty/closure.ts):
// `PlaceBase` / `ProjectionKind` as `$`-tagged unions with frozen unit singletons on the companion const,
// `Projection` (data only) as an interface, `Place` / `PlaceWithHirId` (inherent methods) as classes. Their
// `#[derive(Debug)]` impls are `debug_<T>`, `#[derive(PartialEq)]` is `<T>_eq`, `#[derive(Clone)]` is `clone_<T>`
// (the `projections` vector is copied; `Ty` / `HirId` / `UpvarId` / `ProjectionKind` values are immutable and shared).
// `Hash`, `TyEncodable`, `TyDecodable`, `StableHash`, `TypeFoldable` and `TypeVisitable` derives are not written
// (tools/codegen; PORTING §5).
// hir/mod.ts re-exports this module as `place` (`pub mod place;`, merge-w18).
import { debug_HirId, type HirId, HirId_eq } from "../../rustc_hir_id/lib.ts";
import { type Debug, debug_int, debug_struct, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import type { UpvarId } from "../ty/closure.ts";
import type { FieldIdx, VariantIdx } from "../ty/decls.ts";
import type { Ty } from "../ty/mod.ts";
import { debug_Ty, debug_UpvarId } from "../ty/structural_impls.ts";

// rustc-type: compiler/rustc_middle/src/hir/place.rs:10 PlaceBase
export type PlaceBase =
  /// A temporary variable.
  | { readonly $: "Rvalue" }
  /// A named `static` item.
  | { readonly $: "StaticItem" }
  /// A named local variable.
  | { readonly $: "Local"; readonly _0: HirId }
  /// An upvar referenced by closure env.
  | { readonly $: "Upvar"; readonly _0: UpvarId };
/** Unit variants of `PlaceBase`, shared frozen singletons. */
export const PlaceBase = {
  Rvalue: Object.freeze({ $: "Rvalue" as const }),
  StaticItem: Object.freeze({ $: "StaticItem" as const }),
};
/** `#[derive(Debug)]` */
export const debug_PlaceBase: Debug<PlaceBase> = (v, f) => {
  switch (v.$) {
    case "Rvalue":
      return "Rvalue";
    case "StaticItem":
      return "StaticItem";
    case "Local":
      return debug_tuple(f, "Local", [debug_HirId(v._0, f)]);
    case "Upvar":
      return debug_tuple(f, "Upvar", [debug_UpvarId(v._0, f)]);
  }
};
/** `#[derive(PartialEq)]` (`ty::UpvarId`'s derived `PartialEq` compares `var_path.hir_id` and `closure_expr_id`). */
export function PlaceBase_eq(a: PlaceBase, b: PlaceBase): boolean {
  if (a.$ === "Local" && b.$ === "Local") return HirId_eq(a._0, b._0);
  if (a.$ === "Upvar" && b.$ === "Upvar") {
    return HirId_eq(a._0.var_path.hir_id, b._0.var_path.hir_id) && a._0.closure_expr_id === b._0.closure_expr_id;
  }
  return a.$ === b.$;
}

// rustc-type: compiler/rustc_middle/src/hir/place.rs:23 ProjectionKind
export type ProjectionKind =
  /// A dereference of a pointer, reference or `Box<T>` of the given type.
  | { readonly $: "Deref" }
  /// `B.F` where `B` is the base expression and `F` is
  /// the field. The field is identified by which variant
  /// it appears in along with a field index. The variant
  /// is used for enums.
  | { readonly $: "Field"; readonly _0: FieldIdx; readonly _1: VariantIdx }
  /// Some index like `B[x]`, where `B` is the base
  /// expression. We don't preserve the index `x` because
  /// we won't need it.
  | { readonly $: "Index" }
  /// A subslice covering a range of values like `B[x..y]`.
  | { readonly $: "Subslice" }
  /// A conversion from an opaque type to its hidden type so we can
  /// do further projections on it.
  ///
  /// This is unused if `-Znext-solver` is enabled.
  | { readonly $: "OpaqueCast" }
  /// `unwrap_binder!(expr)`
  | { readonly $: "UnwrapUnsafeBinder" };
/** Unit variants of `ProjectionKind`, shared frozen singletons. */
export const ProjectionKind = {
  Deref: Object.freeze({ $: "Deref" as const }),
  Index: Object.freeze({ $: "Index" as const }),
  Subslice: Object.freeze({ $: "Subslice" as const }),
  OpaqueCast: Object.freeze({ $: "OpaqueCast" as const }),
  UnwrapUnsafeBinder: Object.freeze({ $: "UnwrapUnsafeBinder" as const }),
};
/** `#[derive(Debug)]` (`FieldIdx` / `VariantIdx` are `newtype_index!`s: their `Debug` prints the number). */
export const debug_ProjectionKind: Debug<ProjectionKind> = (v, f) => {
  switch (v.$) {
    case "Field":
      return debug_tuple(f, "Field", [debug_int(v._0, f), debug_int(v._1, f)]);
    default:
      return v.$;
  }
};
/** `#[derive(PartialEq)]` */
export function ProjectionKind_eq(a: ProjectionKind, b: ProjectionKind): boolean {
  if (a.$ === "Field" && b.$ === "Field") return a._0 === b._0 && a._1 === b._1;
  return a.$ === b.$;
}

// rustc-type: compiler/rustc_middle/src/hir/place.rs:53 Projection
export interface Projection {
  /// Type after the projection is applied.
  readonly ty: Ty;

  /// Defines the kind of access made by the projection.
  readonly kind: ProjectionKind;
}
/** `#[derive(Debug)]` */
export const debug_Projection: Debug<Projection> = (v, f) =>
  debug_struct(f, "Projection", [
    ["ty", debug_Ty(v.ty, f)],
    ["kind", debug_ProjectionKind(v.kind, f)],
  ]);
/** `#[derive(PartialEq)]` */
export function Projection_eq(a: Projection, b: Projection): boolean {
  return a.ty === b.ty && ProjectionKind_eq(a.kind, b.kind);
}

/// A `Place` represents how a value is located in memory. This does not
/// always correspond to a syntactic place expression. For example, when
/// processing a pattern, a `Place` can be used to refer to the sub-value
/// currently being inspected.
///
/// This is an HIR version of [`rustc_middle::mir::Place`].
// rustc-type: compiler/rustc_middle/src/hir/place.rs:69 Place
export class Place {
  constructor(
    /// The type of the `PlaceBase`
    public base_ty: Ty,
    /// The "outermost" place that holds this value.
    public base: PlaceBase,
    /// How this place is derived from the base place.
    public projections: Projection[],
  ) {}

  // ---- impl<'tcx> Place<'tcx> (place.rs:104) ----

  /// Returns an iterator of the types that have to be dereferenced to access
  /// the `Place`.
  ///
  /// The types are in the reverse order that they are applied. So if
  /// `x: &*const u32` and the `Place` is `**x`, then the types returned are
  ///`*const u32` then `&*const u32`.
  // rustc: compiler/rustc_middle/src/hir/place.rs:111 deref_tys
  *deref_tys(): Generator<Ty, void, undefined> {
    for (let index = this.projections.length - 1; index >= 0; index--) {
      const proj = this.projections[index]!;
      if (ProjectionKind_eq(ProjectionKind.Deref, proj.kind)) {
        yield this.ty_before_projection(index);
      }
    }
  }

  /// Returns the type of this `Place` after all projections have been applied.
  // rustc: compiler/rustc_middle/src/hir/place.rs:122 ty
  ty(): Ty {
    const proj = this.projections[this.projections.length - 1];
    return proj === undefined ? this.base_ty : proj.ty;
  }

  /// Returns the type of this `Place` immediately before `projection_index`th projection
  /// is applied.
  // rustc: compiler/rustc_middle/src/hir/place.rs:128 ty_before_projection
  ty_before_projection(projection_index: number): Ty {
    assert(projection_index < this.projections.length, "assertion failed: projection_index < self.projections.len()");
    if (projection_index === 0) {
      return this.base_ty;
    } else {
      return this.projections[projection_index - 1]!.ty;
    }
  }
}
/** `#[derive(Debug)]` */
export const debug_Place: Debug<Place> = (v, f) =>
  debug_struct(f, "Place", [
    ["base_ty", debug_Ty(v.base_ty, f)],
    ["base", debug_PlaceBase(v.base, f)],
    ["projections", debug_vec(v.projections, f, debug_Projection)],
  ]);
/** `#[derive(PartialEq)]` */
export function Place_eq(a: Place, b: Place): boolean {
  return (
    a.base_ty === b.base_ty &&
    PlaceBase_eq(a.base, b.base) &&
    a.projections.length === b.projections.length &&
    a.projections.every((p, i) => Projection_eq(p, b.projections[i]!))
  );
}
/** `#[derive(Clone)]` */
export function clone_Place(v: Place): Place {
  return new Place(v.base_ty, v.base, [...v.projections]);
}

/// A `PlaceWithHirId` represents how a value is located in memory. This does not
/// always correspond to a syntactic place expression. For example, when
/// processing a pattern, a `Place` can be used to refer to the sub-value
/// currently being inspected.
///
/// This is an HIR version of [`rustc_middle::mir::Place`].
// rustc-type: compiler/rustc_middle/src/hir/place.rs:85 PlaceWithHirId
export class PlaceWithHirId {
  constructor(
    /// `HirId` of the expression or pattern producing this value.
    public hir_id: HirId,

    /// Information about the `Place`.
    public place: Place,
  ) {}

  // ---- impl<'tcx> PlaceWithHirId<'tcx> (place.rs:93) ----

  // rustc: compiler/rustc_middle/src/hir/place.rs:94 new
  static new(hir_id: HirId, base_ty: Ty, base: PlaceBase, projections: Projection[]): PlaceWithHirId {
    return new PlaceWithHirId(hir_id, new Place(base_ty, base, projections));
  }
}
/** `#[derive(Debug)]` */
export const debug_PlaceWithHirId: Debug<PlaceWithHirId> = (v, f) =>
  debug_struct(f, "PlaceWithHirId", [
    ["hir_id", debug_HirId(v.hir_id, f)],
    ["place", debug_Place(v.place, f)],
  ]);
/** `#[derive(PartialEq)]` */
export function PlaceWithHirId_eq(a: PlaceWithHirId, b: PlaceWithHirId): boolean {
  return HirId_eq(a.hir_id, b.hir_id) && Place_eq(a.place, b.place);
}
/** `#[derive(Clone)]` */
export function clone_PlaceWithHirId(v: PlaceWithHirId): PlaceWithHirId {
  return new PlaceWithHirId(v.hir_id, clone_Place(v.place));
}
