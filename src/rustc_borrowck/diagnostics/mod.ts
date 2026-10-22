// Port of compiler/rustc_borrowck/src/diagnostics/mod.rs (lane borrowck-contract: declarations; fill lane bck-diag-d, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the `mod` declarations of the sibling diagnostics modules are not imported here (the crate root lib.ts imports
// every module); the `pub(crate) use` re-exports below are type-only re-exports of the generated types (values and
// enum companions come from the defining modules, which may assign prototypes / companion methods).
import type { FieldIdx, VariantIdx } from "../../rustc_abi/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { ClosureKind, CoroutineKind } from "../../rustc_hir/lib.ts";
import type { BorrowKind, ConstraintCategory, Local, Location, Operand, Place, PlaceRef } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { MoveOutIndex } from "../../rustc_mir_dataflow/move_paths/mod.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { BorrowData } from "../borrow_set.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import { type InitializationRequiringAction, MirBorrowckCtxt } from "../lib.gen.ts";
import type { CaptureArgLabel, CaptureVarCause } from "../session_diagnostics.gen.ts";
import * as gen from "./mod.gen.ts";
import {
  BorrowckDiagnosticsBuffer,
  type CapturedMessageOpt,
  type CloneSuggestion,
  type DescribePlaceOpt,
  type IncludingTupleField,
} from "./mod.gen.ts";

export * from "./mod.gen.ts";

export type { ToUniverseInfo } from "./bound_region_errors.ts";
export type { UniverseInfo } from "./bound_region_errors.gen.ts";
export type { IllegalMoveOriginKind, MoveError } from "./move_errors.gen.ts";
export type { AccessKind } from "./mutability_errors.gen.ts";
export type { OutlivesSuggestionBuilder } from "./outlives_suggestion.gen.ts";
export type { ErrorConstraintInfo, RegionErrorKind, RegionErrors } from "./region_errors.gen.ts";
export type { RegionName, RegionNameSource } from "./region_name.gen.ts";
export type { CallKind } from "../../rustc_trait_selection/error_reporting/traits/call_kind.ts";

declare module "./mod.gen.ts" {
  interface BorrowckDiagnosticsBuffer {
    // mod.rs:103 (lane bck-diag-d)
    buffer_error(diag: Diag): void;
    // mod.rs:108 (lane bck-diag-d)
    buffer_error_with_sort_span(diag: Diag, sort_span: Span): void;
    // mod.rs:112 (lane bck-diag-d)
    emit_errors(): void;
  }
}

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // mod.rs:135 (lane bck-diag-d)
    buffer_error(diag: Diag): void;
    // mod.rs:139 (lane bck-diag-d)
    buffer_error_with_sort_span(diag: Diag, sort_span: Span): void;
    // mod.rs:143 (lane bck-diag-d)
    buffer_move_error(move_out_indices: MoveOutIndex[], place_and_err: [PlaceRef, Diag]): boolean;
    // mod.rs:159 (lane bck-diag-d)
    get_buffered_mut_error(span: Span): [Diag, number] | undefined;
    // mod.rs:164 (lane bck-diag-d)
    buffer_mut_error(span: Span, diag: Diag, count: number): void;
    // mod.rs:168 (lane bck-diag-d)
    has_buffered_diags(): boolean;
    // mod.rs:172 (lane bck-diag-d)
    has_move_error(move_out_indices: readonly MoveOutIndex[]): [PlaceRef, Diag] | undefined;
    // mod.rs:180 (lane bck-diag-d)
    local_name(index: Local): Symbol | undefined;
    // mod.rs:184 (lane bck-diag-d); `local_names` is also a field
    local_names_(): readonly (Symbol | undefined)[];
    // mod.rs:222 (lane bck-diag-d)
    add_moved_or_invoked_closure_note(location: Location, place: PlaceRef, diag: Diag): boolean;
    // mod.rs:298 (lane bck-diag-d)
    describe_any_place(place_ref: PlaceRef): string;
    // mod.rs:313 (lane bck-diag-d)
    describe_place(place_ref: PlaceRef): string | undefined;
    // mod.rs:324 (lane bck-diag-d)
    describe_place_with_options(place: PlaceRef, opt: DescribePlaceOpt): string | undefined;
    // mod.rs:427 (lane bck-diag-d)
    describe_name(place: PlaceRef): Symbol | undefined;
    // mod.rs:441 (lane bck-diag-d)
    append_local_to_string(local: Local, buf: MutRef<string>): Result<null, null>;
    // mod.rs:453 (lane bck-diag-d)
    describe_field(place: PlaceRef, field: FieldIdx, including_tuple_field: IncludingTupleField): string | undefined;
    // mod.rs:485 (lane bck-diag-d)
    describe_field_from_ty(ty: Ty, field: FieldIdx, variant_index: VariantIdx | undefined, including_tuple_field: IncludingTupleField): string | undefined;
    // mod.rs:536 (lane bck-diag-d)
    borrowed_content_source(deref_base: PlaceRef): BorrowedContentSource;
    // mod.rs:606 (lane bck-diag-d)
    get_name_for_ty(ty: Ty, counter: number): string;
    // mod.rs:629 (lane bck-diag-d)
    get_region_name_for_ty(ty: Ty, counter: number): string;
    // mod.rs:655 (lane bck-diag-d)
    add_placeholder_from_predicate_note(diag: Diag, path: readonly OutlivesConstraint[]): void;
    // mod.rs:717 (lane bck-diag-d)
    add_sized_or_copy_bound_info(err: Diag, blamed_category: ConstraintCategory, path: readonly OutlivesConstraint[]): void;
    // mod.rs:1011 (lane bck-diag-d)
    move_spans(moved_place: PlaceRef, location: Location): UseSpans;
    // mod.rs:1120 (lane bck-diag-d)
    borrow_spans(use_span: Span, location: Location): UseSpans;
    // mod.rs:1182 (lane bck-diag-d)
    closure_span(def_id: LocalDefId, target_place: PlaceRef, places: readonly Operand[]): [Span, ClosureKind, Span, Span] | undefined;
    // mod.rs:1220 (lane bck-diag-d)
    retrieve_borrow_spans(borrow: BorrowData): UseSpans;
    // mod.rs:1225 (lane bck-diag-d)
    explain_captures(err: Diag, span: Span, move_span: Span, move_spans: UseSpans, moved_place: Place, msg_opt: CapturedMessageOpt): CloneSuggestion;
    // mod.rs:1645 (lane bck-diag-d)
    local_excluded_from_unused_mut_lint(index: Local): boolean;
  }
}

export interface UseSpans_methods {
  // mod.rs:772 (lane bck-diag-d)
  args_or_use(self: UseSpans): Span;
  // mod.rs:782 (lane bck-diag-d)
  var_or_use_path_span(self: UseSpans): Span;
  // mod.rs:792 (lane bck-diag-d)
  var_or_use(self: UseSpans): Span;
  // mod.rs:802 (lane bck-diag-d)
  coroutine_kind(self: UseSpans): CoroutineKind | undefined;
  // mod.rs:813 (lane bck-diag-d)
  args_subdiag(self: UseSpans, err: Diag, f: (a0: Span) => CaptureArgLabel): void;
  // mod.rs:821 (lane bck-diag-d)
  var_path_only_subdiag(self: UseSpans, err: Diag, action: InitializationRequiringAction): void;
  // mod.rs:852 (lane bck-diag-d)
  var_subdiag(self: UseSpans, err: Diag, kind: BorrowKind | undefined, f: (a0: ClosureKind, a1: Span) => CaptureVarCause): void;
  // mod.rs:880 (lane bck-diag-d)
  for_closure(self: UseSpans): boolean;
  // mod.rs:890 (lane bck-diag-d)
  for_coroutine(self: UseSpans): boolean;
  // mod.rs:900 (lane bck-diag-d)
  or_else(self: UseSpans, if_other: () => UseSpans): UseSpans;
}
export type UseSpans = gen.UseSpans;
// PORT: the generator emits no `UseSpans` companion (no unit variants): the companion holds only the methods.
export const UseSpans = {} as UseSpans_methods;

export interface BorrowedContentSource_methods {
  // mod.rs:921 (lane bck-diag-d)
  describe_for_unnamed_place(self: BorrowedContentSource, tcx: TyCtxt): string;
  // mod.rs:937 (lane bck-diag-d)
  describe_for_named_place(self: BorrowedContentSource): string | undefined;
  // mod.rs:949 (lane bck-diag-d)
  describe_for_immutable_place(self: BorrowedContentSource, tcx: TyCtxt): string;
  // mod.rs:967 (lane bck-diag-d)
  from_call(func: Ty, tcx: TyCtxt): BorrowedContentSource | undefined;
}
export type BorrowedContentSource = gen.BorrowedContentSource;
export const BorrowedContentSource = gen.BorrowedContentSource as typeof gen.BorrowedContentSource & BorrowedContentSource_methods;

// ---- impl BorrowckDiagnosticsBuffer --------------------------------------------------------------------------------

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:103 buffer_error (lane bck-diag-d)
BorrowckDiagnosticsBuffer.prototype.buffer_error = function (this: BorrowckDiagnosticsBuffer, diag: Diag): void {
  return unported("rustc_borrowck::diagnostics::BorrowckDiagnosticsBuffer::buffer_error");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:108 buffer_error_with_sort_span (lane bck-diag-d)
BorrowckDiagnosticsBuffer.prototype.buffer_error_with_sort_span = function (this: BorrowckDiagnosticsBuffer, diag: Diag, sort_span: Span): void {
  return unported("rustc_borrowck::diagnostics::BorrowckDiagnosticsBuffer::buffer_error_with_sort_span");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:112 emit_errors (lane bck-diag-d)
BorrowckDiagnosticsBuffer.prototype.emit_errors = function (this: BorrowckDiagnosticsBuffer): void {
  return unported("rustc_borrowck::diagnostics::BorrowckDiagnosticsBuffer::emit_errors");
};

// ---- impl MirBorrowckCtxt (buffering) ------------------------------------------------------------------------------

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:135 buffer_error (lane bck-diag-d)
MirBorrowckCtxt.prototype.buffer_error = function (this: MirBorrowckCtxt, diag: Diag): void {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::buffer_error");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:139 buffer_error_with_sort_span (lane bck-diag-d)
MirBorrowckCtxt.prototype.buffer_error_with_sort_span = function (this: MirBorrowckCtxt, diag: Diag, sort_span: Span): void {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::buffer_error_with_sort_span");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:143 buffer_move_error (lane bck-diag-d)
MirBorrowckCtxt.prototype.buffer_move_error = function (this: MirBorrowckCtxt, move_out_indices: MoveOutIndex[], place_and_err: [PlaceRef, Diag]): boolean {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::buffer_move_error");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:159 get_buffered_mut_error (lane bck-diag-d)
MirBorrowckCtxt.prototype.get_buffered_mut_error = function (this: MirBorrowckCtxt, span: Span): [Diag, number] | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::get_buffered_mut_error");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:164 buffer_mut_error (lane bck-diag-d)
MirBorrowckCtxt.prototype.buffer_mut_error = function (this: MirBorrowckCtxt, span: Span, diag: Diag, count: number): void {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::buffer_mut_error");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:168 has_buffered_diags (lane bck-diag-d)
MirBorrowckCtxt.prototype.has_buffered_diags = function (this: MirBorrowckCtxt): boolean {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::has_buffered_diags");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:172 has_move_error (lane bck-diag-d)
MirBorrowckCtxt.prototype.has_move_error = function (this: MirBorrowckCtxt, move_out_indices: readonly MoveOutIndex[]): [PlaceRef, Diag] | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::has_move_error");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:180 local_name (lane bck-diag-d)
MirBorrowckCtxt.prototype.local_name = function (this: MirBorrowckCtxt, index: Local): Symbol | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::local_name");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:184 local_names (lane bck-diag-d)
MirBorrowckCtxt.prototype.local_names_ = function (this: MirBorrowckCtxt): readonly (Symbol | undefined)[] {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::local_names");
};

// ---- impl MirBorrowckCtxt (describing places) ----------------------------------------------------------------------

/// Adds a suggestion when a closure is invoked twice with a moved variable or when a closure
/// is moved after being invoked.
///
/// ```text
/// note: closure cannot be invoked more than once because it moves the variable `dict` out of
///       its environment
///   --> $DIR/issue-42065.rs:16:29
///    |
/// LL |         for (key, value) in dict {
///    |                             ^^^^
/// ```
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:222 add_moved_or_invoked_closure_note (lane bck-diag-d)
MirBorrowckCtxt.prototype.add_moved_or_invoked_closure_note = function (this: MirBorrowckCtxt, location: Location, place: PlaceRef, diag: Diag): boolean {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::add_moved_or_invoked_closure_note");
};

/// End-user visible description of `place` if one can be found.
/// If the place is a temporary for instance, `"value"` will be returned.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:298 describe_any_place (lane bck-diag-d)
MirBorrowckCtxt.prototype.describe_any_place = function (this: MirBorrowckCtxt, place_ref: PlaceRef): string {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::describe_any_place");
};

/// End-user visible description of `place` if one can be found.
/// If the place is a temporary for instance, `None` will be returned.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:313 describe_place (lane bck-diag-d)
MirBorrowckCtxt.prototype.describe_place = function (this: MirBorrowckCtxt, place_ref: PlaceRef): string | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::describe_place");
};

/// End-user visible description of `place` if one can be found. If the place is a temporary
/// for instance, `None` will be returned.
/// `IncludingDowncast` parameter makes the function return `None` if `ProjectionElem` is
/// `Downcast` and `IncludingDowncast` is true
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:324 describe_place_with_options (lane bck-diag-d)
MirBorrowckCtxt.prototype.describe_place_with_options = function (this: MirBorrowckCtxt, place: PlaceRef, opt: DescribePlaceOpt): string | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::describe_place_with_options");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:427 describe_name (lane bck-diag-d)
MirBorrowckCtxt.prototype.describe_name = function (this: MirBorrowckCtxt, place: PlaceRef): Symbol | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::describe_name");
};

/// Appends end-user visible description of the `local` place to `buf`. If `local` doesn't have
/// a name, or its name was generated by the compiler, then `Err` is returned
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:441 append_local_to_string (lane bck-diag-d)
MirBorrowckCtxt.prototype.append_local_to_string = function (this: MirBorrowckCtxt, local: Local, buf: MutRef<string>): Result<null, null> {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::append_local_to_string");
};

/// End-user visible description of the `field`nth field of `base`
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:453 describe_field (lane bck-diag-d)
MirBorrowckCtxt.prototype.describe_field = function (this: MirBorrowckCtxt, place: PlaceRef, field: FieldIdx, including_tuple_field: IncludingTupleField): string | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::describe_field");
};

/// End-user visible description of the `field_index`nth field of `ty`
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:485 describe_field_from_ty (lane bck-diag-d)
MirBorrowckCtxt.prototype.describe_field_from_ty = function (
  this: MirBorrowckCtxt,
  ty: Ty,
  field: FieldIdx,
  variant_index: VariantIdx | undefined,
  including_tuple_field: IncludingTupleField,
): string | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::describe_field_from_ty");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:536 borrowed_content_source (lane bck-diag-d)
MirBorrowckCtxt.prototype.borrowed_content_source = function (this: MirBorrowckCtxt, deref_base: PlaceRef): BorrowedContentSource {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::borrowed_content_source");
};

/// Return the name of the provided `Ty` (that must be a reference) with a synthesized lifetime
/// name where required.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:606 get_name_for_ty (lane bck-diag-d)
MirBorrowckCtxt.prototype.get_name_for_ty = function (this: MirBorrowckCtxt, ty: Ty, counter: number): string {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::get_name_for_ty");
};

/// Returns the name of the provided `Ty` (that must be a reference)'s region with a
/// synthesized lifetime name where required.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:629 get_region_name_for_ty (lane bck-diag-d)
MirBorrowckCtxt.prototype.get_region_name_for_ty = function (this: MirBorrowckCtxt, ty: Ty, counter: number): string {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::get_region_name_for_ty");
};

/// Add a note to region errors and borrow explanations when higher-ranked regions in predicates
/// implicitly introduce an "outlives `'static`" constraint.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:655 add_placeholder_from_predicate_note (lane bck-diag-d)
MirBorrowckCtxt.prototype.add_placeholder_from_predicate_note = function (this: MirBorrowckCtxt, diag: Diag, path: readonly OutlivesConstraint[]): void {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::add_placeholder_from_predicate_note");
};

/// Add a label to region errors and borrow explanations when outlives constraints arise from
/// proving a type implements `Sized` or `Copy`.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:717 add_sized_or_copy_bound_info (lane bck-diag-d)
MirBorrowckCtxt.prototype.add_sized_or_copy_bound_info = function (
  this: MirBorrowckCtxt,
  err: Diag,
  blamed_category: ConstraintCategory,
  path: readonly OutlivesConstraint[],
): void {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::add_sized_or_copy_bound_info");
};

// ---- impl UseSpans -------------------------------------------------------------------------------------------------

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:772 args_or_use (lane bck-diag-d)
UseSpans.args_or_use = function (self: UseSpans): Span {
  return unported("rustc_borrowck::diagnostics::UseSpans::args_or_use");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:782 var_or_use_path_span (lane bck-diag-d)
UseSpans.var_or_use_path_span = function (self: UseSpans): Span {
  return unported("rustc_borrowck::diagnostics::UseSpans::var_or_use_path_span");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:792 var_or_use (lane bck-diag-d)
UseSpans.var_or_use = function (self: UseSpans): Span {
  return unported("rustc_borrowck::diagnostics::UseSpans::var_or_use");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:802 coroutine_kind (lane bck-diag-d)
UseSpans.coroutine_kind = function (self: UseSpans): CoroutineKind | undefined {
  return unported("rustc_borrowck::diagnostics::UseSpans::coroutine_kind");
};

/// Add a span label to the arguments of the closure, if it exists.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:813 args_subdiag (lane bck-diag-d)
UseSpans.args_subdiag = function (self: UseSpans, err: Diag, f: (a0: Span) => CaptureArgLabel): void {
  return unported("rustc_borrowck::diagnostics::UseSpans::args_subdiag");
};

/// Add a span label to the use of the captured variable, if it exists.
/// only adds label to the `path_span`
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:821 var_path_only_subdiag (lane bck-diag-d)
UseSpans.var_path_only_subdiag = function (self: UseSpans, err: Diag, action: InitializationRequiringAction): void {
  return unported("rustc_borrowck::diagnostics::UseSpans::var_path_only_subdiag");
};

/// Add a subdiagnostic to the use of the captured variable, if it exists.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:852 var_subdiag (lane bck-diag-d)
UseSpans.var_subdiag = function (self: UseSpans, err: Diag, kind: BorrowKind | undefined, f: (a0: ClosureKind, a1: Span) => CaptureVarCause): void {
  return unported("rustc_borrowck::diagnostics::UseSpans::var_subdiag");
};

/// Returns `false` if this place is not used in a closure.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:880 for_closure (lane bck-diag-d)
UseSpans.for_closure = function (self: UseSpans): boolean {
  return unported("rustc_borrowck::diagnostics::UseSpans::for_closure");
};

/// Returns `false` if this place is not used in a coroutine.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:890 for_coroutine (lane bck-diag-d)
UseSpans.for_coroutine = function (self: UseSpans): boolean {
  return unported("rustc_borrowck::diagnostics::UseSpans::for_coroutine");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:900 or_else (lane bck-diag-d)
UseSpans.or_else = function (self: UseSpans, if_other: () => UseSpans): UseSpans {
  return unported("rustc_borrowck::diagnostics::UseSpans::or_else");
};

// ---- impl BorrowedContentSource ------------------------------------------------------------------------------------

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:921 describe_for_unnamed_place (lane bck-diag-d)
BorrowedContentSource.describe_for_unnamed_place = function (self: BorrowedContentSource, tcx: TyCtxt): string {
  return unported("rustc_borrowck::diagnostics::BorrowedContentSource::describe_for_unnamed_place");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:937 describe_for_named_place (lane bck-diag-d)
BorrowedContentSource.describe_for_named_place = function (self: BorrowedContentSource): string | undefined {
  return unported("rustc_borrowck::diagnostics::BorrowedContentSource::describe_for_named_place");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:949 describe_for_immutable_place (lane bck-diag-d)
BorrowedContentSource.describe_for_immutable_place = function (self: BorrowedContentSource, tcx: TyCtxt): string {
  return unported("rustc_borrowck::diagnostics::BorrowedContentSource::describe_for_immutable_place");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:967 from_call (lane bck-diag-d)
BorrowedContentSource.from_call = function (func: Ty, tcx: TyCtxt): BorrowedContentSource | undefined {
  return unported("rustc_borrowck::diagnostics::BorrowedContentSource::from_call");
};

// ---- impl MirBorrowckCtxt (spans and captures) ---------------------------------------------------------------------

/// Finds the spans associated to a move or copy of move_place at location.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:1011 move_spans (lane bck-diag-d)
MirBorrowckCtxt.prototype.move_spans = function (this: MirBorrowckCtxt, moved_place: PlaceRef, location: Location): UseSpans {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::move_spans");
};

/// Finds the span of arguments of a closure (within `maybe_closure_span`)
/// and its usage of the local assigned at `location`.
/// This is done by searching in statements succeeding `location`
/// and originating from `maybe_closure_span`.
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:1120 borrow_spans (lane bck-diag-d)
MirBorrowckCtxt.prototype.borrow_spans = function (this: MirBorrowckCtxt, use_span: Span, location: Location): UseSpans {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::borrow_spans");
};

/// Finds the spans of a captured place within a closure or coroutine.
/// The first span is the location of the use resulting in the capture kind of the capture
/// The second span is the location the use resulting in the captured path of the capture
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:1182 closure_span (lane bck-diag-d)
MirBorrowckCtxt.prototype.closure_span = function (
  this: MirBorrowckCtxt,
  def_id: LocalDefId,
  target_place: PlaceRef,
  places: readonly Operand[],
): [Span, ClosureKind, Span, Span] | undefined {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::closure_span");
};

/// Helper to retrieve span(s) of given borrow from the current MIR
/// representation
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:1220 retrieve_borrow_spans (lane bck-diag-d)
MirBorrowckCtxt.prototype.retrieve_borrow_spans = function (this: MirBorrowckCtxt, borrow: BorrowData): UseSpans {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::retrieve_borrow_spans");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:1225 explain_captures (lane bck-diag-d)
MirBorrowckCtxt.prototype.explain_captures = function (
  this: MirBorrowckCtxt,
  err: Diag,
  span: Span,
  move_span: Span,
  move_spans: UseSpans,
  moved_place: Place,
  msg_opt: CapturedMessageOpt,
): CloneSuggestion {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::explain_captures");
};

/// Skip over locals that begin with an underscore or have no name
// stub: compiler/rustc_borrowck/src/diagnostics/mod.rs:1645 local_excluded_from_unused_mut_lint (lane bck-diag-d)
MirBorrowckCtxt.prototype.local_excluded_from_unused_mut_lint = function (this: MirBorrowckCtxt, index: Local): boolean {
  return unported("rustc_borrowck::diagnostics::MirBorrowckCtxt::local_excluded_from_unused_mut_lint");
};
