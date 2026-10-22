// Port of compiler/rustc_const_eval/src/interpret/validity.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-validity-intern; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type Size, type VariantIdx, type WrappingRange } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { MemPlaceMeta } from "./place.ts";
import { ExpectedKind, Path, PathElem, PtrKind, type RangeSet } from "./validity.gen.ts";
import { type CtfeProvenance, type InterpResult, type Pointer, type Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type LayoutCx, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { ImmTy } from "./operand.gen.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";
import { PlaceTy_from_MPlaceTy } from "./place.ts";
import { ValueVisitor_provided } from "./visitor.ts";
import type { KeyedSet } from "../../rust_ts/keyed.ts";
import * as gen from "./validity.gen.ts";
import type { Scalar as ScalarAbi } from "../../rustc_abi/lib.ts";

export * from "./validity.gen.ts";

declare module "./validity.gen.ts" {
  namespace Path {
    // validity.rs:256 (lane interp-validity-intern)
    function new_(ty: Ty): Path;
    export { new_ as new };
  }
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // validity.rs:1597 (lane interp-validity-intern)
    validate_place_internal(val: PlaceTy, path: Path, ref_tracking: RefTracking<MPlaceTy, Path> | undefined, ctfe_mode: CtfeValidationMode | undefined, reset_provenance_and_padding: boolean, start_in_may_dangle: boolean): InterpResult;
    // validity.rs:1654 (lane interp-validity-intern)
    const_validate_place(val: PlaceTy, path: Path, ref_tracking: RefTracking<MPlaceTy, Path>, ctfe_mode: CtfeValidationMode): InterpResult;
    // validity.rs:1675 (lane interp-validity-intern)
    validate_place(val: PlaceTy, recursive: boolean, reset_provenance_and_padding: boolean): InterpResult;
  }
}

export interface ValidationErrorKind_methods {
  // validity.rs:187 (lane interp-validity-intern)
  to_string(self: ValidationErrorKind): string;
  // validity.rs:200 (lane interp-validity-intern)
  ptr_bytes_warning(self: ValidationErrorKind): boolean;
}
export type ValidationErrorKind = gen.ValidationErrorKind;
export const ValidationErrorKind = gen.ValidationErrorKind as typeof gen.ValidationErrorKind & ValidationErrorKind_methods;

export interface CtfeValidationMode_methods {
  // validity.rs:276 (lane interp-validity-intern)
  allow_immutable_unsafe_cell(self: CtfeValidationMode): boolean;
}
export type CtfeValidationMode = gen.CtfeValidationMode;
export const CtfeValidationMode = gen.CtfeValidationMode as typeof gen.CtfeValidationMode & CtfeValidationMode_methods;

/// State for tracking recursive validation of references
// rustc-type: compiler/rustc_const_eval/src/interpret/validity.rs:288 RefTracking
// PORT: `seen: FxHashSet<T>` hashes `T` by value: a `KeyedSet` over the key fn of `T` (`key_MPlaceTy` for the only
// instantiation, `MPlaceTy`), passed to the constructors (`T: Hash + Eq`).
export class RefTracking<T, PATH = null> {
  constructor(
    public seen: KeyedSet<T>,
    public todo: [T, PATH][],
  ) {}

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:294 empty (lane interp-validity-intern)
  static empty<T, PATH>(key_T: (t: T) => string | number): RefTracking<T, PATH> {
    return unported("rustc_const_eval::interpret::validity::RefTracking::empty");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:297 next (lane interp-validity-intern)
  next(): [T, PATH] | undefined {
    return unported("rustc_const_eval::interpret::validity::RefTracking::next");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:301 track (lane interp-validity-intern)
  track(val: T, path: () => PATH): void {
    return unported("rustc_const_eval::interpret::validity::RefTracking::track");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:312 new (lane interp-validity-intern)
  static new<T>(val: T, ty: Ty, key_T: (t: T) => string | number): RefTracking<T, Path> {
    return unported("rustc_const_eval::interpret::validity::RefTracking::new");
  }

}

// rustc-type: compiler/rustc_const_eval/src/interpret/validity.rs:348 ValidityVisitor
// PORT: `impl ValueVisitor for ValidityVisitor` (`type V = PlaceTy`) is in the class body (base class
// `ValueVisitor_provided`); `ref_tracking: Option<&'rt mut RefTracking<..>>` is the shared object.
export class ValidityVisitor<M extends Machine = Machine> extends ValueVisitor_provided<PlaceTy> {
  constructor(
    /// The `path` may be pushed to, but the part that is present when a function
    /// starts must not be changed!  `with_elem` relies on this stack discipline.
    public path: Path,
    public ref_tracking: RefTracking<MPlaceTy, Path> | undefined,
    /// `None` indicates this is not validating for CTFE (but for runtime).
    public ctfe_mode: CtfeValidationMode | undefined,
    public ecx: InterpCx<M>,
    /// Whether provenance should be reset outside of pointers (emulating the effect of a typed
    /// copy).
    public reset_provenance_and_padding: boolean,
    /// This tracks which byte ranges in this value contain data; the remaining bytes are padding.
    /// The ideal representation here would be pointer-length pairs, but to keep things more compact
    /// we only store a (range) set of offsets -- the base pointer is the same throughout the entire
    /// visit, after all.
    /// If this is `Some`, then `reset_provenance_and_padding` must be true (but not vice versa:
    /// we might not track data vs padding bytes if the place isn't stored in memory anyway).
    public data_bytes: RangeSet | undefined,
    /// True if we are inside of `MaybeDangling`. This disables pointer access checks.
    public may_dangle: boolean,
  ) {
    super();
  }

  /** `<PlaceTy as From<MPlaceTy>>::from` (`type V = PlaceTy`). */
  V_from_MPlaceTy(mplace: MPlaceTy): PlaceTy {
    return PlaceTy_from_MPlaceTy(mplace);
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:371 aggregate_field_path_elem (lane interp-validity-intern)
  aggregate_field_path_elem(layout: TyAndLayout, field: number, field_ty: Ty): PathElem {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::aggregate_field_path_elem");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:454 with_elem (lane interp-validity-intern)
  with_elem<R>(elem: PathElem, f: (a0: ValidityVisitor<M>) => InterpResult<R>): InterpResult<R> {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::with_elem");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:471 read_immediate (lane interp-validity-intern)
  read_immediate(val: PlaceTy, expected: ExpectedKind): InterpResult<ImmTy> {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::read_immediate");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:489 read_scalar (lane interp-validity-intern)
  read_scalar(val: PlaceTy, expected: ExpectedKind): InterpResult<Scalar> {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::read_scalar");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:500 reset_pointer_provenance (lane interp-validity-intern)
  reset_pointer_provenance(place: PlaceTy, ptr: ImmTy): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::reset_pointer_provenance");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:523 check_wide_ptr_meta (lane interp-validity-intern)
  check_wide_ptr_meta(meta: MemPlaceMeta, pointee: TyAndLayout): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::check_wide_ptr_meta");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:560 check_safe_pointer (lane interp-validity-intern)
  check_safe_pointer(value: PlaceTy, ty: Ty, ptr_kind: PtrKind): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::check_safe_pointer");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:851 try_visit_primitive (lane interp-validity-intern)
  try_visit_primitive(value: PlaceTy): InterpResult<boolean> {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::try_visit_primitive");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:999 visit_scalar (lane interp-validity-intern)
  visit_scalar(scalar: Scalar, scalar_layout: ScalarAbi): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::visit_scalar");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1056 in_mutable_memory (lane interp-validity-intern)
  in_mutable_memory(val: PlaceTy): boolean {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::in_mutable_memory");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1078 add_data_range (lane interp-validity-intern)
  add_data_range(ptr: Pointer<CtfeProvenance | undefined>, size: Size): void {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::add_data_range");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1090 add_data_range_place (lane interp-validity-intern)
  add_data_range_place(place: PlaceTy): void {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::add_data_range_place");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1101 data_range_offset (lane interp-validity-intern)
  static data_range_offset(ecx: InterpCx, place: PlaceTy): Size {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::data_range_offset");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1113 reset_padding (lane interp-validity-intern)
  reset_padding(place: PlaceTy): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::reset_padding");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1165 union_data_range (lane interp-validity-intern)
  static union_data_range(ecx: InterpCx, layout: TyAndLayout): RangeSet {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::union_data_range");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1244 ecx (lane interp-validity-intern)
  ecx_(): InterpCx {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::ecx");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1248 read_discriminant (lane interp-validity-intern)
  override read_discriminant(val: PlaceTy): InterpResult<VariantIdx> {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::read_discriminant");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1267 visit_field (lane interp-validity-intern)
  override visit_field(old_val: PlaceTy, field: number, new_val: PlaceTy): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::visit_field");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1278 visit_variant (lane interp-validity-intern)
  override visit_variant(old_val: PlaceTy, variant_id: VariantIdx, new_val: PlaceTy): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::visit_variant");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1294 visit_union (lane interp-validity-intern)
  override visit_union(val: PlaceTy, _fields: number): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::visit_union");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1327 visit_box (lane interp-validity-intern)
  override visit_box(box_ty: Ty, val: PlaceTy): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::visit_box");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1337 visit_variantless (lane interp-validity-intern)
  override visit_variantless(val: PlaceTy): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::visit_variantless");
  }

  // stub: compiler/rustc_const_eval/src/interpret/validity.rs:1347 visit_value (lane interp-validity-intern)
  override visit_value(val: PlaceTy): InterpResult {
    return unported("rustc_const_eval::interpret::validity::ValidityVisitor::visit_value");
  }

}

// impl Display for PtrKind
// stub: compiler/rustc_const_eval/src/interpret/validity.rs:115 fmt (lane interp-validity-intern)
export function display_PtrKind(self: PtrKind, f: Fmt): string {
  return unported("rustc_const_eval::interpret::validity::PtrKind::fmt");
}

// impl Display for ExpectedKind
// stub: compiler/rustc_const_eval/src/interpret/validity.rs:138 fmt (lane interp-validity-intern)
export function display_ExpectedKind(self: ExpectedKind, f: Fmt): string {
  return unported("rustc_const_eval::interpret::validity::ExpectedKind::fmt");
}

// impl From<PtrKind> for ExpectedKind
// stub: compiler/rustc_const_eval/src/interpret/validity.rs:155 from (lane interp-validity-intern)
export function ExpectedKind_from_PtrKind(x: PtrKind): ExpectedKind {
  return unported("rustc_const_eval::interpret::validity::ExpectedKind::from");
}

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:187 to_string (lane interp-validity-intern)
ValidationErrorKind.to_string = function (self: ValidationErrorKind): string {
  return unported("rustc_const_eval::interpret::validity::ValidationErrorKind::to_string");
};

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:200 ptr_bytes_warning (lane interp-validity-intern)
ValidationErrorKind.ptr_bytes_warning = function (self: ValidationErrorKind): boolean {
  return unported("rustc_const_eval::interpret::validity::ValidationErrorKind::ptr_bytes_warning");
};

// impl From<String> for ValidationErrorKind
// stub: compiler/rustc_const_eval/src/interpret/validity.rs:207 from (lane interp-validity-intern)
export function ValidationErrorKind_from_String(msg: string): ValidationErrorKind {
  return unported("rustc_const_eval::interpret::validity::ValidationErrorKind::from");
}

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:212 fmt_range (lane interp-validity-intern)
export function fmt_range(r: WrappingRange, max_hi: bigint): string {
  return unported("rustc_const_eval::interpret::validity::fmt_range");
}

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:256 new (lane interp-validity-intern)
(Path as unknown as { new_: typeof Path.new }).new_ = function (ty: Ty): Path {
  return unported("rustc_const_eval::interpret::validity::Path::new");
};

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:276 allow_immutable_unsafe_cell (lane interp-validity-intern)
CtfeValidationMode.allow_immutable_unsafe_cell = function (self: CtfeValidationMode): boolean {
  return unported("rustc_const_eval::interpret::validity::CtfeValidationMode::allow_immutable_unsafe_cell");
};

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:321 write_path (lane interp-validity-intern)
export function write_path(out: string, path: readonly PathElem[]): void {
  return unported("rustc_const_eval::interpret::validity::write_path");
}

// PORT: nested in `union_data_range` upstream; moves inside its parent when ported.
// stub: compiler/rustc_const_eval/src/interpret/validity.rs:1179 union_data_range_uncached (lane interp-validity-intern)
function union_data_range_uncached(cx: LayoutCx, layout: TyAndLayout, base_offset: Size, out: RangeSet): void {
  return unported("rustc_const_eval::interpret::validity::union_data_range::union_data_range_uncached");
}

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:1597 validate_place_internal (lane interp-validity-intern)
InterpCx.prototype.validate_place_internal = function (this: InterpCx, val: PlaceTy, path: Path, ref_tracking: RefTracking<MPlaceTy, Path> | undefined, ctfe_mode: CtfeValidationMode | undefined, reset_provenance_and_padding: boolean, start_in_may_dangle: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::validity::InterpCx::validate_place_internal");
};

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:1654 const_validate_place (lane interp-validity-intern)
InterpCx.prototype.const_validate_place = function (this: InterpCx, val: PlaceTy, path: Path, ref_tracking: RefTracking<MPlaceTy, Path>, ctfe_mode: CtfeValidationMode): InterpResult {
  return unported("rustc_const_eval::interpret::validity::InterpCx::const_validate_place");
};

// stub: compiler/rustc_const_eval/src/interpret/validity.rs:1675 validate_place (lane interp-validity-intern)
InterpCx.prototype.validate_place = function (this: InterpCx, val: PlaceTy, recursive: boolean, reset_provenance_and_padding: boolean): InterpResult {
  return unported("rustc_const_eval::interpret::validity::InterpCx::validate_place");
};
