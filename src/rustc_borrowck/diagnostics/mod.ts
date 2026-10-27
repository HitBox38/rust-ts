// Port of compiler/rustc_borrowck/src/diagnostics/mod.rs (lane borrowck-contract: declarations; fill lane bck-diag-d, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the `mod` declarations of the sibling diagnostics modules are not imported here (the crate root lib.ts imports
// every module); the `pub(crate) use` re-exports below are type-only re-exports of the generated types (values and
// enum companions come from the defining modules, which may assign prototypes / companion methods).
import { FieldIdx, type VariantIdx } from "../../rustc_abi/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { DiagMessage_arg } from "../../rustc_errors/formatting.ts";
import { index_map_swap_remove } from "../../rustc_errors/decorate_diag.ts";
import { Applicability, type Diag, listify } from "../../rustc_errors/lib.ts";
import { type DiagMessage, IntoDiagArg, into_MultiSpan } from "../../rustc_error_messages/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { type ClosureKind, type CoroutineKind, GenericBound, type HirId, HirId_eq, Node } from "../../rustc_hir/lib.ts";
import { CtorKind, Namespace } from "../../rustc_hir/def.ts";
import { BoundRegionConversionTime } from "../../rustc_infer/infer/mod.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import {
  type BorrowKind,
  CallSource,
  Const as mir_Const,
  ConstraintCategory,
  debug_Local,
  find_self_call,
  type Local,
  LocalKind,
  type Location,
  Operand,
  type Place,
  type PlaceElem,
  Place_from_Local,
  PlaceRef,
  PlaceTy,
} from "../../rustc_middle/mir/mod.ts";
import { place_to_string_for_capture } from "../../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { Ty, type VariantDef } from "../../rustc_middle/ty/mod.ts";
import type { ParamTy } from "../../rustc_middle/ty/sty.ts";
import type { TyKind } from "../../rustc_type_ir/ty_kind.gen.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { print_Region, print_Ty, type PrintResult } from "../../rustc_middle/ty/print/mod.ts";
import { display_ParamTy, display_Predicate, display_Ty, FmtPrinter, with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { MoveOutIndex } from "../../rustc_mir_dataflow/move_paths/mod.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { DefId_eq } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { sym, Symbol } from "../../rustc_span/symbol.ts";
import { call_kind, CallDesugaringKind } from "../../rustc_trait_selection/error_reporting/traits/call_kind.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { type_known_to_meet_bound_modulo_regions } from "../../rustc_trait_selection/traits/mod.ts";
import { Binder, BoundRegionKind, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { fold_FnSig, type FnSig, PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { BorrowData } from "../borrow_set.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import { type InitializationRequiringAction, LocalMutationIsAllowed, MirBorrowckCtxt } from "../lib.gen.ts";
import {
  type CaptureArgLabel,
  CaptureArgLabel_subdiagnostic,
  CaptureReasonLabel_subdiagnostic,
  CaptureReasonNote_subdiagnostic,
  CaptureReasonSuggest_subdiagnostic,
  type CaptureVarCause,
  CaptureVarCause_subdiagnostic,
  type CaptureVarKind,
  CaptureVarKind_subdiagnostic,
  type CaptureVarPathUseCause,
  CaptureVarPathUseCause_subdiagnostic,
  OnClosureNote_subdiagnostic,
} from "../session_diagnostics.gen.ts";
import { ConstraintDescription_ConstraintCategory } from "./region_errors.ts";
import * as gen from "./mod.gen.ts";
import {
  BorrowckDiagnosticsBuffer,
  type CapturedMessageOpt,
  CloneSuggestion,
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
    // mod.rs:103
    buffer_error(diag: Diag): void;
    // mod.rs:108
    buffer_error_with_sort_span(diag: Diag, sort_span: Span): void;
    // mod.rs:112
    emit_errors(): void;
  }
}

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // mod.rs:135
    buffer_error(diag: Diag): void;
    // mod.rs:139
    buffer_error_with_sort_span(diag: Diag, sort_span: Span): void;
    // mod.rs:143
    buffer_move_error(move_out_indices: MoveOutIndex[], place_and_err: [PlaceRef, Diag]): boolean;
    // mod.rs:159
    get_buffered_mut_error(span: Span): [Diag, number] | undefined;
    // mod.rs:164
    buffer_mut_error(span: Span, diag: Diag, count: number): void;
    // mod.rs:168
    has_buffered_diags(): boolean;
    // mod.rs:172
    has_move_error(move_out_indices: readonly MoveOutIndex[]): [PlaceRef, Diag] | undefined;
    // mod.rs:180
    local_name(index: Local): Symbol | undefined;
    // mod.rs:184; `local_names` is also a field
    local_names_(): readonly (Symbol | undefined)[];
    // mod.rs:222
    add_moved_or_invoked_closure_note(location: Location, place: PlaceRef, diag: Diag): boolean;
    // mod.rs:298
    describe_any_place(place_ref: PlaceRef): string;
    // mod.rs:313
    describe_place(place_ref: PlaceRef): string | undefined;
    // mod.rs:324
    describe_place_with_options(place: PlaceRef, opt: DescribePlaceOpt): string | undefined;
    // mod.rs:427
    describe_name(place: PlaceRef): Symbol | undefined;
    // mod.rs:441
    append_local_to_string(local: Local, buf: MutRef<string>): Result<null, null>;
    // mod.rs:453
    describe_field(place: PlaceRef, field: FieldIdx, including_tuple_field: IncludingTupleField): string | undefined;
    // mod.rs:485
    describe_field_from_ty(ty: Ty, field: FieldIdx, variant_index: VariantIdx | undefined, including_tuple_field: IncludingTupleField): string | undefined;
    // mod.rs:536
    borrowed_content_source(deref_base: PlaceRef): BorrowedContentSource;
    // mod.rs:606
    get_name_for_ty(ty: Ty, counter: number): string;
    // mod.rs:629
    get_region_name_for_ty(ty: Ty, counter: number): string;
    // mod.rs:655
    add_placeholder_from_predicate_note(diag: Diag, path: readonly OutlivesConstraint[]): void;
    // mod.rs:717
    add_sized_or_copy_bound_info(err: Diag, blamed_category: ConstraintCategory, path: readonly OutlivesConstraint[]): void;
    // mod.rs:1011
    move_spans(moved_place: PlaceRef, location: Location): UseSpans;
    // mod.rs:1120
    borrow_spans(use_span: Span, location: Location): UseSpans;
    // mod.rs:1182
    closure_span(def_id: LocalDefId, target_place: PlaceRef, places: readonly Operand[]): [Span, ClosureKind, Span, Span] | undefined;
    // mod.rs:1220
    retrieve_borrow_spans(borrow: BorrowData): UseSpans;
    // mod.rs:1225
    explain_captures(err: Diag, span: Span, move_span: Span, move_spans: UseSpans, moved_place: Place, msg_opt: CapturedMessageOpt): CloneSuggestion;
    // mod.rs:1645
    local_excluded_from_unused_mut_lint(index: Local): boolean;
  }
}

export interface UseSpans_methods {
  // mod.rs:772
  args_or_use(self: UseSpans): Span;
  // mod.rs:782
  var_or_use_path_span(self: UseSpans): Span;
  // mod.rs:792
  var_or_use(self: UseSpans): Span;
  // mod.rs:802
  coroutine_kind(self: UseSpans): CoroutineKind | undefined;
  // mod.rs:813
  args_subdiag(self: UseSpans, err: Diag, f: (a0: Span) => CaptureArgLabel): void;
  // mod.rs:821
  var_path_only_subdiag(self: UseSpans, err: Diag, action: InitializationRequiringAction): void;
  // mod.rs:852
  var_subdiag(self: UseSpans, err: Diag, kind: BorrowKind | undefined, f: (a0: ClosureKind, a1: Span) => CaptureVarCause): void;
  // mod.rs:880
  for_closure(self: UseSpans): boolean;
  // mod.rs:890
  for_coroutine(self: UseSpans): boolean;
  // mod.rs:900
  or_else(self: UseSpans, if_other: () => UseSpans): UseSpans;
}
export type UseSpans = gen.UseSpans;
// PORT: the generator emits no `UseSpans` companion (no unit variants): the companion holds only the methods.
export const UseSpans = {} as UseSpans_methods;

export interface BorrowedContentSource_methods {
  // mod.rs:921
  describe_for_unnamed_place(self: BorrowedContentSource, tcx: TyCtxt): string;
  // mod.rs:937
  describe_for_named_place(self: BorrowedContentSource): string | undefined;
  // mod.rs:949
  describe_for_immutable_place(self: BorrowedContentSource, tcx: TyCtxt): string;
  // mod.rs:967
  from_call(func: Ty, tcx: TyCtxt): BorrowedContentSource | undefined;
}
export type BorrowedContentSource = gen.BorrowedContentSource;
export const BorrowedContentSource = gen.BorrowedContentSource as typeof gen.BorrowedContentSource & BorrowedContentSource_methods;

// ---- impl BorrowckDiagnosticsBuffer --------------------------------------------------------------------------------

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:103 buffer_error
BorrowckDiagnosticsBuffer.prototype.buffer_error = function (this: BorrowckDiagnosticsBuffer, diag: Diag): void {
  const sort_span = diag.deref().span.primary_span() ?? DUMMY_SP;
  this.buffered_diags.push([sort_span, diag]);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:108 buffer_error_with_sort_span
BorrowckDiagnosticsBuffer.prototype.buffer_error_with_sort_span = function (this: BorrowckDiagnosticsBuffer, diag: Diag, sort_span: Span): void {
  this.buffered_diags.push([sort_span, diag]);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:112 emit_errors
BorrowckDiagnosticsBuffer.prototype.emit_errors = function (this: BorrowckDiagnosticsBuffer): void {
  // Buffer any move errors that we collected and de-duplicated.
  // PORT: `std::mem::take` of the `BTreeMap`: its entries in key order (`Vec<MoveOutIndex>` compares lexicographically),
  // the map left empty.
  const buffered_move_errors = [...this.buffered_move_errors].sort(([a], [b]) => cmp_move_out_indices(a, b));
  this.buffered_move_errors.clear();
  for (const [_, [__, diag]] of buffered_move_errors) {
    // We have already set tainted for this error, so just buffer it.
    this.buffer_error(diag);
  }
  // PORT: `std::mem::take` of the `FxIndexMap`: its entries in insertion order, the map left empty.
  const buffered_mut_errors = [...this.buffered_mut_errors];
  this.buffered_mut_errors.clear();
  for (const [_, [diag, count]] of buffered_mut_errors) {
    if (count > 10) {
      diag.note(`...and ${count - 10} other attempted mutable borrows`);
    }
    this.buffer_error(diag);
  }

  if (!(this.buffered_diags.length === 0)) {
    // PORT: `sort_by_key(|(sort_span, _)| sort_span.lo_hi())` is a stable sort on the `(lo, hi)` tuple; so is
    // `Array.prototype.sort`.
    const keyed = this.buffered_diags.map(([sort_span, diag]) => [Span.lo_hi(sort_span), diag] as const);
    keyed.sort(([[alo, ahi]], [[blo, bhi]]) => (alo !== blo ? alo - blo : ahi - bhi));
    // `drain(..)`
    this.buffered_diags.length = 0;
    for (const [_, diag] of keyed) {
      diag.emit();
    }
  }
};

/** PORT: no upstream counterpart: `Ord for Vec<MoveOutIndex>` (lexicographic), the key order of `buffered_move_errors`. */
function cmp_move_out_indices(a: readonly MoveOutIndex[], b: readonly MoveOutIndex[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  }
  return a.length - b.length;
}

// ---- impl MirBorrowckCtxt (buffering) ------------------------------------------------------------------------------

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:135 buffer_error
MirBorrowckCtxt.prototype.buffer_error = function (this: MirBorrowckCtxt, diag: Diag): void {
  this.diags_buffer.buffer_error(diag.with_dcx(this.dcx()));
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:139 buffer_error_with_sort_span
MirBorrowckCtxt.prototype.buffer_error_with_sort_span = function (this: MirBorrowckCtxt, diag: Diag, sort_span: Span): void {
  this.diags_buffer.buffer_error_with_sort_span(diag.with_dcx(this.dcx()), sort_span);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:143 buffer_move_error
MirBorrowckCtxt.prototype.buffer_move_error = function (this: MirBorrowckCtxt, move_out_indices: MoveOutIndex[], place_and_err: [PlaceRef, Diag]): boolean {
  // PORT: `BTreeMap::insert` returns the old value (the stored key is kept); the map is a `KeyedMap` on the indices.
  const old = this.diags_buffer.buffered_move_errors.get(move_out_indices);
  this.diags_buffer.buffered_move_errors.set(move_out_indices, place_and_err);
  if (old !== undefined) {
    const [_, diag] = old;
    // Cancel the old diagnostic so we don't ICE
    diag.cancel();
    return false;
  } else {
    return true;
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:159 get_buffered_mut_error
MirBorrowckCtxt.prototype.get_buffered_mut_error = function (this: MirBorrowckCtxt, span: Span): [Diag, number] | undefined {
  // FIXME(#120456) - is `swap_remove` correct?
  return index_map_swap_remove(this.diags_buffer.buffered_mut_errors, span);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:164 buffer_mut_error
MirBorrowckCtxt.prototype.buffer_mut_error = function (this: MirBorrowckCtxt, span: Span, diag: Diag, count: number): void {
  this.diags_buffer.buffered_mut_errors.set(span, [diag, count]);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:168 has_buffered_diags
MirBorrowckCtxt.prototype.has_buffered_diags = function (this: MirBorrowckCtxt): boolean {
  return this.diags_buffer.buffered_diags.length === 0;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:172 has_move_error
MirBorrowckCtxt.prototype.has_move_error = function (this: MirBorrowckCtxt, move_out_indices: readonly MoveOutIndex[]): [PlaceRef, Diag] | undefined {
  return this.diags_buffer.buffered_move_errors.get(move_out_indices as MoveOutIndex[]);
};

/// Uses `body.var_debug_info` to find the symbol
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:180 local_name
MirBorrowckCtxt.prototype.local_name = function (this: MirBorrowckCtxt, index: Local): Symbol | undefined {
  return this.local_names_()[index];
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:184 local_names
MirBorrowckCtxt.prototype.local_names_ = function (this: MirBorrowckCtxt): readonly (Symbol | undefined)[] {
  // `OnceCell::get_or_init`
  if (this.local_names === undefined) {
    const local_names: (Symbol | undefined)[] = this.body.local_decls.map(() => undefined);
    for (const var_debug_info of this.body.var_debug_info) {
      if (var_debug_info.value.$ === "Place") {
        const place = var_debug_info.value._0;
        const local = place.as_local();
        if (local !== undefined) {
          const prev_name = local_names[local];
          if (prev_name !== undefined && var_debug_info.name !== prev_name) {
            span_bug(
              var_debug_info.source_info.span,
              `local ${format_debug(local, debug_Local, PLAIN)} has many names (\`${Symbol.as_str(prev_name)}\` vs \`${Symbol.as_str(var_debug_info.name)}\`)`,
            );
          }
          local_names[local] = var_debug_info.name;
        }
      }
    }
    this.local_names = local_names;
  }
  return this.local_names;
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
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:222 add_moved_or_invoked_closure_note
MirBorrowckCtxt.prototype.add_moved_or_invoked_closure_note = function (this: MirBorrowckCtxt, location: Location, place: PlaceRef, diag: Diag): boolean {
  // debug!("add_moved_or_invoked_closure_note: location={:?} place={:?}", location, place);
  let target = place.local_or_deref_local();
  for (const stmt of this.body.index(location.block).statements.slice(location.statement_index)) {
    // debug!("add_moved_or_invoked_closure_note: stmt={:?} target={:?}", stmt, target);
    if (stmt.kind.$ === "Assign" && stmt.kind._0[1].$ === "Use") {
      const into = stmt.kind._0[0];
      const from = stmt.kind._0[1]._0;
      // debug!("add_fnonce_closure_note: into={:?} from={:?}", into, from);
      if ((from.$ === "Copy" || from.$ === "Move") && target === from._0.local_or_deref_local()) {
        target = into.local_or_deref_local();
      }
    }
  }

  // Check if we are attempting to call a closure after it has been invoked.
  const terminator = this.body.index(location.block).terminator_();
  // debug!("add_moved_or_invoked_closure_note: terminator={:?}", terminator);
  let fn_def: Extract<TyKind, { $: "FnDef" }> | undefined;
  if (terminator.kind.$ === "Call" && terminator.kind.func.$ === "Constant" && (fn_def = as_fn_def(mir_Const.ty(terminator.kind.func._0.const_))) !== undefined) {
    const args = terminator.kind.args;
    const id = fn_def._0;
    // debug!("add_moved_or_invoked_closure_note: id={:?}", id);
    if (this.infcx.tcx.is_lang_item(this.infcx.tcx.parent(id), LangItem.FnOnce)) {
      const first = args[0];
      let closure: Local;
      if (first !== undefined && (first.node.$ === "Copy" || first.node.$ === "Move") && target === first.node._0.local_or_deref_local()) {
        closure = unwrap(first.node._0.local_or_deref_local());
      } else {
        return false;
      }

      // debug!("add_moved_or_invoked_closure_note: closure={:?}", closure);
      const closure_ty = this.body.local_decls[closure]!.ty.kind();
      if (closure_ty.$ === "Closure") {
        const did = closure_ty._0.expect_local();
        const origin = this.infcx.tcx.closure_kind_origin(did);
        if (origin !== undefined) {
          const [span, hir_place] = origin;
          diag.subdiagnostic(
            OnClosureNote_subdiagnostic({ $: "InvokedTwice", place_name: place_to_string_for_capture(this.infcx.tcx, hir_place), span }),
          );
          return true;
        }
      }
    }
  }

  // Check if we are just moving a closure after it has been invoked.
  let target_ty: TyKind | undefined;
  if (target !== undefined && (target_ty = this.body.local_decls[target]!.ty.kind()).$ === "Closure") {
    const did = target_ty._0.expect_local();
    const origin = this.infcx.tcx.closure_kind_origin(did);
    if (origin !== undefined) {
      const [span, hir_place] = origin;
      diag.subdiagnostic(OnClosureNote_subdiagnostic({ $: "MovedTwice", place_name: place_to_string_for_capture(this.infcx.tcx, hir_place), span }));
      return true;
    }
  }
  return false;
};

/** PORT: no upstream counterpart: `if let ty::FnDef(..) = *ty.kind()`. */
function as_fn_def(ty: Ty): Extract<TyKind, { $: "FnDef" }> | undefined {
  const kind = ty.kind();
  return kind.$ === "FnDef" ? kind : undefined;
}

/// End-user visible description of `place` if one can be found.
/// If the place is a temporary for instance, `"value"` will be returned.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:298 describe_any_place
MirBorrowckCtxt.prototype.describe_any_place = function (this: MirBorrowckCtxt, place_ref: PlaceRef): string {
  const descr = this.describe_place(place_ref);
  if (descr !== undefined) {
    // Surround descr with `backticks`.
    return "`" + descr + "`";
  } else {
    return "value";
  }
};

/// End-user visible description of `place` if one can be found.
/// If the place is a temporary for instance, `None` will be returned.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:313 describe_place
MirBorrowckCtxt.prototype.describe_place = function (this: MirBorrowckCtxt, place_ref: PlaceRef): string | undefined {
  return this.describe_place_with_options(place_ref, { including_downcast: false, including_tuple_field: true });
};

/// End-user visible description of `place` if one can be found. If the place is a temporary
/// for instance, `None` will be returned.
/// `IncludingDowncast` parameter makes the function return `None` if `ProjectionElem` is
/// `Downcast` and `IncludingDowncast` is true
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:324 describe_place_with_options
MirBorrowckCtxt.prototype.describe_place_with_options = function (this: MirBorrowckCtxt, place: PlaceRef, opt: DescribePlaceOpt): string | undefined {
  const local = place.local;
  if (Span.in_external_macro(this.body.local_decls[local]!.source_info.span, this.infcx.tcx.sess.source_map())) {
    return undefined;
  }

  let autoderef_index: number | undefined = undefined;
  const buf: MutRef<string> = { value: "" };
  let ok = this.append_local_to_string(local, buf);

  for (let index = 0; index < place.projection.length; index++) {
    const elem = place.projection[index]!;
    switch (elem.$) {
      case "Deref": {
        if (index === 0) {
          if (this.body.local_decls[local]!.is_ref_for_guard()) {
            continue;
          }
          const local_info = this.body.local_decls[local]!.local_info_();
          if (local_info.$ === "StaticRef") {
            const def_id = local_info.def_id;
            buf.value += Symbol.as_str(this.infcx.tcx.item_name(def_id));
            ok = Ok(null);
            continue;
          }
        }
        const field = this.is_upvar_field_projection(new PlaceRef(local, place.projection.slice(0, index + 1)));
        if (field !== undefined) {
          const var_index = FieldIdx.index(field);
          buf.value = this.upvars[var_index]!.to_string(this.infcx.tcx);
          ok = Ok(null);
          if (!this.upvars[var_index]!.is_by_ref()) {
            buf.value = "*" + buf.value;
          }
        } else {
          if (autoderef_index === undefined) {
            // `rposition`
            let pos: number | undefined = undefined;
            for (let i = place.projection.length - 1; i >= 0; i--) {
              const e = place.projection[i]!;
              if (!(e.$ === "Deref" || e.$ === "Downcast")) {
                pos = i;
                break;
              }
            }
            autoderef_index = pos !== undefined ? pos + 1 : 0;
          }
          if (index >= unwrap(autoderef_index)) {
            buf.value = "*" + buf.value;
          }
        }
        break;
      }
      case "PhantomDeref":
        break;
      case "Downcast":
        if (opt.including_downcast) return undefined;
        break;
      case "OpaqueCast":
        break;
      case "UnwrapUnsafeBinder":
        break;
      case "Field": {
        const field = elem._0;
        // FIXME(project-rfc_2229#36): print capture precisely here.
        const upvar_field = this.is_upvar_field_projection(new PlaceRef(local, place.projection.slice(0, index + 1)));
        if (upvar_field !== undefined) {
          buf.value = this.upvars[FieldIdx.index(upvar_field)]!.to_string(this.infcx.tcx);
          ok = Ok(null);
        } else {
          const field_name = this.describe_field(new PlaceRef(local, place.projection.slice(0, index)), field, { _0: opt.including_tuple_field });
          if (field_name !== undefined) {
            const field_name_str = field_name;
            buf.value += ".";
            buf.value += field_name_str;
          }
        }
        break;
      }
      case "Index": {
        const index_local = elem._0;
        buf.value += "[";
        if (this.append_local_to_string(index_local, buf).$ === "Err") {
          buf.value += "_";
        }
        buf.value += "]";
        break;
      }
      case "ConstantIndex":
      case "Subslice":
        // Since it isn't possible to borrow an element on a particular index and
        // then use another while the borrow is held, don't output indices details
        // to avoid confusing the end-user
        buf.value += "[..]";
        break;
    }
  }
  return ok.$ === "Ok" ? buf.value : undefined;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:427 describe_name
MirBorrowckCtxt.prototype.describe_name = function (this: MirBorrowckCtxt, place: PlaceRef): Symbol | undefined {
  for (const elem of place.projection) {
    if (elem.$ === "Downcast" && elem._0 !== undefined) {
      const name = elem._0;
      return name;
    }
  }
  return undefined;
};

/// Appends end-user visible description of the `local` place to `buf`. If `local` doesn't have
/// a name, or its name was generated by the compiler, then `Err` is returned
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:441 append_local_to_string
MirBorrowckCtxt.prototype.append_local_to_string = function (this: MirBorrowckCtxt, local: Local, buf: MutRef<string>): Result<null, null> {
  const decl = this.body.local_decls[local]!;
  const name = this.local_name(local);
  if (name !== undefined && !decl.from_compiler_desugaring()) {
    buf.value += Symbol.as_str(name);
    return Ok(null);
  } else {
    return Err(null);
  }
};

/// End-user visible description of the `field`nth field of `base`
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:453 describe_field
MirBorrowckCtxt.prototype.describe_field = function (this: MirBorrowckCtxt, place: PlaceRef, field: FieldIdx, including_tuple_field: IncludingTupleField): string | undefined {
  let place_ty: PlaceTy;
  if (place.projection.length === 0) {
    place_ty = PlaceTy.from_ty(this.body.local_decls[place.local]!.ty);
  } else {
    const local = place.local;
    const proj_base = place.projection.slice(0, place.projection.length - 1);
    const elem = place.projection[place.projection.length - 1]!;
    switch (elem.$) {
      case "Deref":
      case "Index":
      case "ConstantIndex":
      case "Subslice":
        place_ty = new PlaceRef(local, proj_base).ty(this.body, this.infcx.tcx);
        break;
      case "Downcast":
        place_ty = place.ty(this.body, this.infcx.tcx);
        break;
      case "OpaqueCast":
      case "UnwrapUnsafeBinder":
        place_ty = PlaceTy.from_ty(elem._0);
        break;
      case "Field":
        place_ty = PlaceTy.from_ty(elem._1);
        break;
      case "PhantomDeref":
        return unreachable("not a field");
    }
  }
  return this.describe_field_from_ty(place_ty.ty, field, place_ty.variant_index, including_tuple_field);
};

/// End-user visible description of the `field_index`nth field of `ty`
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:485 describe_field_from_ty
MirBorrowckCtxt.prototype.describe_field_from_ty = function (
  this: MirBorrowckCtxt,
  ty: Ty,
  field: FieldIdx,
  variant_index: VariantIdx | undefined,
  including_tuple_field: IncludingTupleField,
): string | undefined {
  const boxed_ty = ty.boxed_ty();
  if (boxed_ty !== undefined) {
    // If the type is a box, the field is described from the boxed type
    return this.describe_field_from_ty(boxed_ty, field, variant_index, including_tuple_field);
  } else {
    const kind = ty.kind();
    switch (kind.$) {
      case "Adt": {
        const def = kind._0;
        let variant: VariantDef;
        if (variant_index !== undefined) {
          const idx = variant_index;
          assert(def.is_enum(), "assertion failed: def.is_enum()");
          variant = def.variant(idx);
        } else {
          variant = def.non_enum_variant();
        }
        if (!including_tuple_field._0 && variant.ctor_kind() === CtorKind.Fn) {
          return undefined;
        }
        return Symbol.as_str(variant.fields[field]!.name);
      }
      case "Tuple":
        return `${FieldIdx.index(field)}`;
      case "Ref":
        return this.describe_field_from_ty(kind._1, field, variant_index, including_tuple_field);
      case "RawPtr":
        return this.describe_field_from_ty(kind._0, field, variant_index, including_tuple_field);
      case "Array":
      case "Slice":
        return this.describe_field_from_ty(kind._0, field, variant_index, including_tuple_field);
      case "Closure":
      case "Coroutine": {
        // We won't be borrowck'ing here if the closure came from another crate,
        // so it's safe to call `expect_local`.
        //
        // We know the field exists so it's safe to call operator[] and `unwrap` here.
        const def_id = kind._0.expect_local();
        const var_id = this.infcx.tcx.closure_captures(def_id)[FieldIdx.index(field)]!.get_root_variable();

        return Symbol.as_str(this.infcx.tcx.hir_name(var_id));
      }
      default:
        // This can happen for field accesses on `Box<T>`: the field is
        // described from the boxed type, which may have no named fields
        return `${FieldIdx.index(field)}`;
    }
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:536 borrowed_content_source
MirBorrowckCtxt.prototype.borrowed_content_source = function (this: MirBorrowckCtxt, deref_base: PlaceRef): BorrowedContentSource {
  const tcx = this.infcx.tcx;

  // Look up the provided place and work out the move path index for it,
  // we'll use this to check whether it was originally from an overloaded
  // operator.
  const lookup = this.move_data.rev_lookup.find(deref_base);
  if (lookup.$ === "Exact" || (lookup.$ === "Parent" && lookup._0 !== undefined)) {
    const mpi = unwrap(lookup._0);
    // debug!("borrowed_content_source: mpi={:?}", mpi);

    for (const i of this.move_data.init_path_map[mpi]!) {
      const init = this.move_data.inits[i]!;
      // debug!("borrowed_content_source: init={:?}", init);
      // We're only interested in statements that initialized a value, not the
      // initializations from arguments.
      if (init.location.$ !== "Statement") continue;
      const loc = init.location._0;

      const bbd = this.body.index(loc.block);
      const is_terminator = bbd.statements.length === loc.statement_index;
      // debug!("borrowed_content_source: loc={:?} is_terminator={:?}", loc, is_terminator);
      if (!is_terminator) {
        continue;
      } else if (bbd.terminator !== undefined && bbd.terminator.kind.$ === "Call" && bbd.terminator.kind.call_source === CallSource.OverloadedOperator) {
        const func = bbd.terminator.kind.func;
        const source = BorrowedContentSource.from_call(Operand.ty(func, this.body, tcx), tcx);
        if (source !== undefined) {
          return source;
        }
      }
    }
  } else {
    // Base is a `static` so won't be from an overloaded operator
  }

  // If we didn't find an overloaded deref or index, then assume it's a
  // built in deref and check the type of the base.
  const base_ty = deref_base.ty(this.body, tcx).ty;
  if (base_ty.is_raw_ptr()) {
    return BorrowedContentSource.DerefRawPointer;
  } else if (base_ty.is_mutable_ptr()) {
    return BorrowedContentSource.DerefMutableRef;
  } else if (base_ty.is_ref()) {
    return BorrowedContentSource.DerefSharedRef;
  } else {
    // Custom type implementing `Deref` (e.g. `MyBox<T>`, `Rc<T>`, `Arc<T>`)
    // that wasn't detected via the MIR init trace above. This can happen
    // when the deref base is initialized by a regular statement rather than
    // a `TerminatorKind::Call` with `CallSource::OverloadedOperator`.
    return { $: "OverloadedDeref", _0: base_ty };
  }
};

/// Return the name of the provided `Ty` (that must be a reference) with a synthesized lifetime
/// name where required.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:606 get_name_for_ty
MirBorrowckCtxt.prototype.get_name_for_ty = function (this: MirBorrowckCtxt, ty: Ty, counter: number): string {
  const p = FmtPrinter.new(this.infcx.tcx, Namespace.TypeNS);

  // We need to add synthesized lifetimes where appropriate. We do
  // this by hooking into the pretty printer and telling it to label the
  // lifetimes without names with the value `'0`.
  const kind = ty.kind();
  if (kind.$ === "Ref") {
    const region = kind._0.kind();
    if (region.$ === "ReBound") {
      p._0.region_highlight_mode.highlighting_bound_region(region._1.kind, counter);
    } else if (region.$ === "RePlaceholder") {
      p._0.region_highlight_mode.highlighting_bound_region(region._0.bound.kind, counter);
    }
  }

  unwrap_print(print_Ty(ty, p));
  return p.into_buffer();
};

/// Returns the name of the provided `Ty` (that must be a reference)'s region with a
/// synthesized lifetime name where required.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:629 get_region_name_for_ty
MirBorrowckCtxt.prototype.get_region_name_for_ty = function (this: MirBorrowckCtxt, ty: Ty, counter: number): string {
  const p = FmtPrinter.new(this.infcx.tcx, Namespace.TypeNS);

  const kind = ty.kind();
  let region: Region;
  if (kind.$ === "Ref") {
    region = kind._0;
    const region_kind = region.kind();
    if (region_kind.$ === "ReBound") {
      p._0.region_highlight_mode.highlighting_bound_region(region_kind._1.kind, counter);
    } else if (region_kind.$ === "RePlaceholder") {
      p._0.region_highlight_mode.highlighting_bound_region(region_kind._0.bound.kind, counter);
    }
  } else {
    return bug("ty for annotation of borrow region is not a reference");
  }

  unwrap_print(print_Region(region, p));
  return p.into_buffer();
};

/** PORT: no upstream counterpart: `.unwrap()` of a `fmt::Result` (`PrintResult`). */
function unwrap_print(r: PrintResult): void {
  if (r.$ === "Err") panic("called `Result::unwrap()` on an `Err` value: Error");
}

/// Add a note to region errors and borrow explanations when higher-ranked regions in predicates
/// implicitly introduce an "outlives `'static`" constraint.
///
/// This is very similar to `fn suggest_static_lifetime_for_gat_from_hrtb` which handles this
/// note for failed type tests instead of outlives errors.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:655 add_placeholder_from_predicate_note
MirBorrowckCtxt.prototype.add_placeholder_from_predicate_note = function (this: MirBorrowckCtxt, diag: Diag, path: readonly OutlivesConstraint[]): void {
  const tcx = this.infcx.tcx;
  let found: [HirId, hir.Generics] | undefined = undefined;
  for (const constraint of path) {
    const outlived = constraint.sub;
    const origin = this.regioncx.definitions[outlived];
    if (origin === undefined || origin.origin.$ !== "Placeholder") continue;
    const placeholder = origin.origin._0;
    const id = BoundRegionKind.get_id(placeholder.bound.kind);
    if (id === undefined) continue;
    const placeholder_id = id.as_local();
    if (placeholder_id === undefined) continue;
    const gat_hir_id = tcx.local_def_id_to_hir_id(placeholder_id);
    const generics_impl = Node.generics(tcx.parent_hir_node(tcx.parent_hir_id(gat_hir_id)));
    if (generics_impl === undefined) continue;
    found = [gat_hir_id, generics_impl];
    break;
  }
  if (found === undefined) {
    return;
  }
  const [gat_hir_id, generics] = found;

  // Look for the where-bound which introduces the placeholder.
  // As we're using the HIR, we need to handle both `for<'a> T: Trait<'a>`
  // and `T: for<'a> Trait`<'a>.
  for (const pred of generics.predicates) {
    if (pred.kind.$ !== "BoundPredicate") {
      continue;
    }
    const { bound_generic_params, bounds } = pred.kind._0;
    if (bound_generic_params.findLast((bgp) => HirId_eq(tcx.local_def_id_to_hir_id(bgp.def_id), gat_hir_id)) !== undefined) {
      diag.span_note(pred.span, LIMITATION_NOTE);
      return;
    }
    for (const bound of bounds) {
      if (bound.$ === "Trait") {
        const trait_bound = bound._0;
        if (trait_bound.bound_generic_params.findLast((bgp) => HirId_eq(tcx.local_def_id_to_hir_id(bgp.def_id), gat_hir_id)) !== undefined) {
          diag.span_note(trait_bound.span, LIMITATION_NOTE);
          return;
        }
      }
    }
  }
};

/// Add a label to region errors and borrow explanations when outlives constraints arise from
/// proving a type implements `Sized` or `Copy`.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:717 add_sized_or_copy_bound_info
MirBorrowckCtxt.prototype.add_sized_or_copy_bound_info = function (
  this: MirBorrowckCtxt,
  err: Diag,
  blamed_category: ConstraintCategory,
  path: readonly OutlivesConstraint[],
): void {
  for (const sought_category of [ConstraintCategory.SizedBound, ConstraintCategory.CopyBound] as const) {
    let sought_constraint: OutlivesConstraint | undefined;
    if (
      // PORT: `ConstraintCategory`'s derived `PartialEq` against a unit variant is a tag comparison.
      sought_category.$ !== blamed_category.$ &&
      (sought_constraint = path.find((c) => c.category.$ === sought_category.$)) !== undefined
    ) {
      const label = `requirement occurs due to ${ConstraintDescription_ConstraintCategory.description(sought_category).trimEnd()}`;
      err.span_label(sought_constraint.span, label);
    }
  }
};

// ---- impl UseSpans -------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:772 args_or_use
UseSpans.args_or_use = function (self: UseSpans): Span {
  switch (self.$) {
    case "ClosureUse":
      return self.args_span;
    case "PatUse":
    case "OtherUse":
      return self._0;
    case "FnSelfUse":
      return self.var_span;
  }
};

/// Returns the span of `self`, in the case of a `ClosureUse` returns the `path_span`
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:782 var_or_use_path_span
UseSpans.var_or_use_path_span = function (self: UseSpans): Span {
  switch (self.$) {
    case "ClosureUse":
      return self.path_span;
    case "PatUse":
    case "OtherUse":
      return self._0;
    case "FnSelfUse":
      return self.var_span;
  }
};

/// Returns the span of `self`, in the case of a `ClosureUse` returns the `capture_kind_span`
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:792 var_or_use
UseSpans.var_or_use = function (self: UseSpans): Span {
  switch (self.$) {
    case "ClosureUse":
      return self.capture_kind_span;
    case "PatUse":
    case "OtherUse":
      return self._0;
    case "FnSelfUse":
      return self.var_span;
  }
};

// FIXME(coroutines): Make this just return the `ClosureKind` directly?
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:802 coroutine_kind
UseSpans.coroutine_kind = function (self: UseSpans): CoroutineKind | undefined {
  if (self.$ === "ClosureUse" && self.closure_kind.$ === "Coroutine") {
    const coroutine_kind = self.closure_kind._0;
    return coroutine_kind;
  }
  return undefined;
};

/// Add a span label to the arguments of the closure, if it exists.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:813 args_subdiag
UseSpans.args_subdiag = function (self: UseSpans, err: Diag, f: (a0: Span) => CaptureArgLabel): void {
  if (self.$ === "ClosureUse") {
    const args_span = self.args_span;
    err.subdiagnostic(CaptureArgLabel_subdiagnostic(f(args_span)));
  }
};

/// Add a span label to the use of the captured variable, if it exists.
/// only adds label to the `path_span`
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:821 var_path_only_subdiag
UseSpans.var_path_only_subdiag = function (self: UseSpans, err: Diag, action: InitializationRequiringAction): void {
  if (self.$ === "ClosureUse") {
    const { closure_kind, path_span } = self;
    switch (closure_kind.$) {
      case "Coroutine": {
        let sub: CaptureVarPathUseCause;
        switch (action) {
          case "Borrow":
            sub = { $: "BorrowInCoroutine", path_span };
            break;
          case "MatchOn":
          case "Use":
            sub = { $: "UseInCoroutine", path_span };
            break;
          case "Assignment":
            sub = { $: "AssignInCoroutine", path_span };
            break;
          case "PartialAssignment":
            sub = { $: "AssignPartInCoroutine", path_span };
            break;
        }
        err.subdiagnostic(CaptureVarPathUseCause_subdiagnostic(sub));
        break;
      }
      case "Closure":
      case "CoroutineClosure": {
        let sub: CaptureVarPathUseCause;
        switch (action) {
          case "Borrow":
            sub = { $: "BorrowInClosure", path_span };
            break;
          case "MatchOn":
          case "Use":
            sub = { $: "UseInClosure", path_span };
            break;
          case "Assignment":
            sub = { $: "AssignInClosure", path_span };
            break;
          case "PartialAssignment":
            sub = { $: "AssignPartInClosure", path_span };
            break;
        }
        err.subdiagnostic(CaptureVarPathUseCause_subdiagnostic(sub));
        break;
      }
    }
  }
};

/// Add a subdiagnostic to the use of the captured variable, if it exists.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:852 var_subdiag
UseSpans.var_subdiag = function (self: UseSpans, err: Diag, kind: BorrowKind | undefined, f: (a0: ClosureKind, a1: Span) => CaptureVarCause): void {
  if (self.$ === "ClosureUse") {
    const { closure_kind, capture_kind_span, path_span } = self;
    if (capture_kind_span !== path_span) {
      let sub: CaptureVarKind;
      if (kind !== undefined) {
        const kd = kind;
        switch (kd.$) {
          case "Shared":
          case "Fake":
            sub = { $: "Immut", kind_span: capture_kind_span };
            break;
          case "Mut":
            sub = { $: "Mut", kind_span: capture_kind_span };
            break;
        }
      } else {
        sub = { $: "Move", kind_span: capture_kind_span };
      }
      err.subdiagnostic(CaptureVarKind_subdiagnostic(sub));
    }
    const diag = f(closure_kind, path_span);
    err.subdiagnostic(CaptureVarCause_subdiagnostic(diag));
  }
};

/// Returns `false` if this place is not used in a closure.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:880 for_closure
UseSpans.for_closure = function (self: UseSpans): boolean {
  switch (self.$) {
    case "ClosureUse":
      return self.closure_kind.$ === "Closure";
    default:
      return false;
  }
};

/// Returns `false` if this place is not used in a coroutine.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:890 for_coroutine
UseSpans.for_coroutine = function (self: UseSpans): boolean {
  switch (self.$) {
    // FIXME(coroutines): Do we want this to apply to synthetic coroutines?
    case "ClosureUse":
      return self.closure_kind.$ === "Coroutine";
    default:
      return false;
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:900 or_else
UseSpans.or_else = function (self: UseSpans, if_other: () => UseSpans): UseSpans {
  switch (self.$) {
    case "ClosureUse":
      return self;
    case "PatUse":
    case "OtherUse":
      return if_other();
    case "FnSelfUse":
      return self;
  }
};

// ---- impl BorrowedContentSource ------------------------------------------------------------------------------------

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:921 describe_for_unnamed_place
BorrowedContentSource.describe_for_unnamed_place = function (self: BorrowedContentSource, tcx: TyCtxt): string {
  switch (self.$) {
    case "DerefRawPointer":
      return "a raw pointer";
    case "DerefSharedRef":
      return "a shared reference";
    case "DerefMutableRef":
      return "a mutable reference";
    case "OverloadedDeref":
      return describe_rc_or_arc(self._0, tcx) ?? `dereference of \`${display_Ty(self._0)}\``;
    case "OverloadedIndex":
      return `index of \`${display_Ty(self._0)}\``;
  }
};

/** PORT: no upstream counterpart: the shared closure of `describe_for_unnamed_place` / `describe_for_immutable_place`
 * (`ty.ty_adt_def().and_then(|adt| match tcx.get_diagnostic_name(adt.did())? { name @ (sym::Rc | sym::Arc) => .. })`). */
function describe_rc_or_arc(ty: Ty, tcx: TyCtxt): string | undefined {
  const adt = ty.ty_adt_def();
  if (adt === undefined) return undefined;
  const name = tcx.get_diagnostic_name(adt.did());
  if (name === undefined) return undefined;
  if (name === sym.Rc || name === sym.Arc) return `an \`${Symbol.as_str(name)}\``;
  return undefined;
}

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:937 describe_for_named_place
BorrowedContentSource.describe_for_named_place = function (self: BorrowedContentSource): string | undefined {
  switch (self.$) {
    case "DerefRawPointer":
      return "raw pointer";
    case "DerefSharedRef":
      return "shared reference";
    case "DerefMutableRef":
      return "mutable reference";
    // Overloaded deref and index operators should be evaluated into a
    // temporary. So we don't need a description here.
    case "OverloadedDeref":
    case "OverloadedIndex":
      return undefined;
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:949 describe_for_immutable_place
BorrowedContentSource.describe_for_immutable_place = function (self: BorrowedContentSource, tcx: TyCtxt): string {
  switch (self.$) {
    case "DerefRawPointer":
      return "a `*const` pointer";
    case "DerefSharedRef":
      return "a `&` reference";
    case "DerefMutableRef":
      return bug("describe_for_immutable_place: DerefMutableRef isn't immutable");
    case "OverloadedDeref":
      return describe_rc_or_arc(self._0, tcx) ?? `dereference of \`${display_Ty(self._0)}\``;
    case "OverloadedIndex":
      return `an index of \`${display_Ty(self._0)}\``;
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:967 from_call
BorrowedContentSource.from_call = function (func: Ty, tcx: TyCtxt): BorrowedContentSource | undefined {
  const kind = func.kind();
  switch (kind.$) {
    case "FnDef": {
      const def_id = kind._0;
      const trait_id = tcx.trait_of_assoc(def_id);
      if (trait_id === undefined) return undefined;

      const args = unwrap(Binder.no_bound_vars(kind._1, fold_GenericArgs));

      if (tcx.is_lang_item(trait_id, LangItem.Deref) || tcx.is_lang_item(trait_id, LangItem.DerefMut)) {
        return { $: "OverloadedDeref", _0: args.type_at(0) };
      } else if (tcx.is_lang_item(trait_id, LangItem.Index) || tcx.is_lang_item(trait_id, LangItem.IndexMut)) {
        return { $: "OverloadedIndex", _0: args.type_at(0) };
      } else {
        return undefined;
      }
    }
    default:
      return undefined;
  }
};

// ---- impl MirBorrowckCtxt (spans and captures) ---------------------------------------------------------------------

/// Finds the spans associated to a move or copy of move_place at location.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:1011 move_spans
MirBorrowckCtxt.prototype.move_spans = function (
  this: MirBorrowckCtxt,
  moved_place: PlaceRef, // Could also be an upvar.
  location: Location,
): UseSpans {
  const stmt = this.body.index(location.block).statements[location.statement_index];
  if (stmt === undefined) {
    return { $: "OtherUse", _0: this.body.source_info(location).span };
  }

  // debug!("move_spans: moved_place={:?} location={:?} stmt={:?}", moved_place, location, stmt);
  if (stmt.kind.$ === "Assign" && stmt.kind._0[1].$ === "Aggregate") {
    const kind = stmt.kind._0[1]._0;
    const places = stmt.kind._0[1]._1;
    if (kind.$ === "Closure" || kind.$ === "Coroutine") {
      // debug!("move_spans: def_id={:?} places={:?}", def_id, places);
      const def_id = kind._0.expect_local();
      const spans = this.closure_span(def_id, moved_place, places);
      if (spans !== undefined) {
        const [args_span, closure_kind, capture_kind_span, path_span] = spans;
        return { $: "ClosureUse", closure_kind, args_span, capture_kind_span, path_span };
      }
    }
  }

  // StatementKind::FakeRead only contains a def_id if they are introduced as a result
  // of pattern matching within a closure.
  if (stmt.kind.$ === "FakeRead") {
    const [cause, place] = stmt.kind._0;
    if ((cause.$ === "ForMatchedPlace" || cause.$ === "ForLet") && cause._0 !== undefined) {
      const closure_def_id = cause._0;
      // debug!("move_spans: def_id={:?} place={:?}", closure_def_id, place);
      const places: Operand[] = [{ $: "Move", _0: place }];
      const spans = this.closure_span(closure_def_id, moved_place, places);
      if (spans !== undefined) {
        const [args_span, closure_kind, capture_kind_span, path_span] = spans;
        return {
          $: "ClosureUse",
          closure_kind,
          args_span,
          capture_kind_span,
          path_span,
        };
      }
    }
  }

  const normal_ret: UseSpans = moved_place.projection.some((p) => p.$ === "Downcast")
    ? { $: "PatUse", _0: stmt.source_info.span }
    : { $: "OtherUse", _0: stmt.source_info.span };

  // We are trying to find MIR of the form:
  // ```
  // _temp = _moved_val;
  // ...
  // FnSelfCall(_temp, ...)
  // ```
  //
  // where `_moved_val` is the place we generated the move error for,
  // `_temp` is some other local, and `FnSelfCall` is a function
  // that has a `self` parameter.

  let target_temp: Local;
  if (stmt.kind.$ === "Assign" && stmt.kind._0[0].as_local() !== undefined) {
    target_temp = unwrap(stmt.kind._0[0].as_local());
  } else {
    return normal_ret;
  }

  // debug!("move_spans: target_temp = {:?}", target_temp);

  const terminator = this.body.index(location.block).terminator;
  if (terminator !== undefined && terminator.kind.$ === "Call") {
    const { fn_span, call_source } = terminator.kind;
    const self_call = find_self_call(this.infcx.tcx, this.body, target_temp, location.block);
    if (self_call === undefined) {
      return normal_ret;
    }
    const [method_did, method_args] = self_call;

    const kind = call_kind(
      this.infcx.tcx,
      this.infcx.typing_env(this.infcx.param_env),
      method_did,
      method_args,
      fn_span,
      CallSource.from_hir_call(call_source),
      this.infcx.tcx.fn_arg_idents(method_did)[0],
    );

    return {
      $: "FnSelfUse",
      var_span: stmt.source_info.span,
      fn_call_span: fn_span,
      fn_span: this.infcx.tcx.def_span(method_did),
      kind,
    };
  }

  return normal_ret;
};

/// Finds the span of arguments of a closure (within `maybe_closure_span`)
/// and its usage of the local assigned at `location`.
/// This is done by searching in statements succeeding `location`
/// and originating from `maybe_closure_span`.
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:1120 borrow_spans
MirBorrowckCtxt.prototype.borrow_spans = function (this: MirBorrowckCtxt, use_span: Span, location: Location): UseSpans {
  // debug!("borrow_spans: use_span={:?} location={:?}", use_span, location);

  const assign = this.body.index(location.block).statements[location.statement_index];
  if (assign === undefined || assign.kind.$ !== "Assign") {
    return { $: "OtherUse", _0: use_span };
  }
  const place = assign.kind._0[0];
  const target = place.as_local();
  if (target === undefined) return { $: "OtherUse", _0: use_span };

  if (this.body.local_kind(target) !== LocalKind.Temp) {
    // operands are always temporaries.
    return { $: "OtherUse", _0: use_span };
  }

  // drop and replace might have moved the assignment to the next block
  const block_terminator = this.body.index(location.block).terminator_().kind;
  const maybe_additional_statement =
    block_terminator.$ === "Drop" ? this.body.index(block_terminator.target).statements[0] : undefined;

  const statements = this.body.index(location.block).statements.slice(location.statement_index + 1);

  for (const stmt of maybe_additional_statement !== undefined ? [...statements, maybe_additional_statement] : statements) {
    if (stmt.kind.$ === "Assign" && stmt.kind._0[1].$ === "Aggregate") {
      const kind = stmt.kind._0[1]._0;
      const places = stmt.kind._0[1]._1;
      let def_id_: DefId;
      let is_coroutine: boolean;
      switch (kind.$) {
        case "Closure":
          [def_id_, is_coroutine] = [kind._0, false];
          break;
        case "Coroutine":
          [def_id_, is_coroutine] = [kind._0, true];
          break;
        default:
          continue;
      }
      void is_coroutine;
      const def_id = def_id_.expect_local();

      // debug!("borrow_spans: def_id={:?} is_coroutine={:?} places={:?}", def_id, is_coroutine, places);
      const spans = this.closure_span(def_id, Place_from_Local(target).as_ref(), places);
      if (spans !== undefined) {
        const [args_span, closure_kind, capture_kind_span, path_span] = spans;
        return { $: "ClosureUse", closure_kind, args_span, capture_kind_span, path_span };
      } else {
        return { $: "OtherUse", _0: use_span };
      }
    }

    if (use_span !== stmt.source_info.span) {
      break;
    }
  }

  return { $: "OtherUse", _0: use_span };
};

/// Finds the spans of a captured place within a closure or coroutine.
/// The first span is the location of the use resulting in the capture kind of the capture
/// The second span is the location the use resulting in the captured path of the capture
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:1182 closure_span
MirBorrowckCtxt.prototype.closure_span = function (
  this: MirBorrowckCtxt,
  def_id: LocalDefId,
  target_place: PlaceRef,
  places: readonly Operand[],
): [Span, ClosureKind, Span, Span] | undefined {
  // debug!("closure_span: def_id={:?} target_place={:?} places={:?}", def_id, target_place, places);
  const hir_id = this.infcx.tcx.local_def_id_to_hir_id(def_id);
  const expr = this.infcx.tcx.hir_expect_expr(hir_id).kind;
  // debug!("closure_span: hir_id={:?} expr={:?}", hir_id, expr);
  if (expr.$ === "Closure") {
    const { kind, fn_decl_span } = expr._0;
    const captures = this.infcx.tcx.closure_captures(def_id);
    // `zip`
    const n = Math.min(captures.length, places.length);
    for (let i = 0; i < n; i++) {
      const captured_place = captures[i]!;
      const place = places[i]!;
      if ((place.$ === "Copy" || place.$ === "Move") && PlaceRef_eq(target_place, place._0.as_ref())) {
        // debug!("closure_span: found captured local {:?}", place);
        return [fn_decl_span, kind, captured_place.get_capture_kind_span(this.infcx.tcx), captured_place.get_path_span(this.infcx.tcx)];
      }
    }
  }
  return undefined;
};

/** PORT: no upstream counterpart: the derived `PartialEq` of `PlaceRef` (`local` and the projection slice). */
function PlaceRef_eq(a: PlaceRef, b: PlaceRef): boolean {
  if (a.local !== b.local) return false;
  if (a.projection === b.projection) return true;
  if (a.projection.length !== b.projection.length) return false;
  for (let i = 0; i < a.projection.length; i++) if (!PlaceElem_eq(a.projection[i]!, b.projection[i]!)) return false;
  return true;
}

/** PORT: no upstream counterpart: the derived `PartialEq` of `PlaceElem` (`ProjectionElem<Local, Ty>`). */
function PlaceElem_eq(a: PlaceElem, b: PlaceElem): boolean {
  if (a === b) return true;
  switch (a.$) {
    case "Deref":
    case "PhantomDeref":
      return b.$ === a.$;
    case "Field":
      return b.$ === "Field" && a._0 === b._0 && a._1 === b._1;
    case "Index":
      return b.$ === "Index" && a._0 === b._0;
    case "ConstantIndex":
      return b.$ === "ConstantIndex" && a.offset === b.offset && a.min_length === b.min_length && a.from_end === b.from_end;
    case "Subslice":
      return b.$ === "Subslice" && a.from === b.from && a.to === b.to && a.from_end === b.from_end;
    case "Downcast":
      return b.$ === "Downcast" && a._0 === b._0 && a._1 === b._1;
    case "OpaqueCast":
      return b.$ === "OpaqueCast" && a._0 === b._0;
    case "UnwrapUnsafeBinder":
      return b.$ === "UnwrapUnsafeBinder" && a._0 === b._0;
  }
}

/// Helper to retrieve span(s) of given borrow from the current MIR
/// representation
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:1220 retrieve_borrow_spans
MirBorrowckCtxt.prototype.retrieve_borrow_spans = function (this: MirBorrowckCtxt, borrow: BorrowData): UseSpans {
  const span = this.body.source_info(borrow.reserve_location).span;
  return this.borrow_spans(span, borrow.reserve_location);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:1225 explain_captures
MirBorrowckCtxt.prototype.explain_captures = function (
  this: MirBorrowckCtxt,
  err: Diag,
  span: Span,
  move_span: Span,
  move_spans: UseSpans,
  moved_place: Place,
  msg_opt: CapturedMessageOpt,
): CloneSuggestion {
  const {
    is_partial_move: is_partial,
    is_loop_message,
    is_move_msg,
    is_loop_move,
    has_suggest_reborrow,
    maybe_reinitialized_locations_is_empty,
  } = msg_opt;
  let suggested_cloning = false;
  if (move_spans.$ === "FnSelfUse") {
    const { var_span, fn_call_span, fn_span, kind } = move_spans;
    const described = this.describe_place(moved_place.as_ref());
    const place_name = described !== undefined ? `\`${described}\`` : "value";
    if (kind.$ === "FnCall" && this.infcx.tcx.is_lang_item(kind.fn_trait_id, LangItem.FnOnce)) {
      const { fn_trait_id, self_ty } = kind;
      err.subdiagnostic(
        CaptureReasonLabel_subdiagnostic({
          $: "Call",
          fn_call_span,
          place_name,
          is_partial,
          is_loop_message,
        }),
      );
      // Check if the move occurs on a value because of a call on a closure that comes
      // from a type parameter `F: FnOnce()`. If so, we provide a targeted `note`:
      // ```
      // error[E0382]: use of moved value: `blk`
      //   --> $DIR/once-cant-call-twice-on-heap.rs:8:5
      //    |
      // LL | fn foo<F:FnOnce()>(blk: F) {
      //    |                    --- move occurs because `blk` has type `F`, which does not implement the `Copy` trait
      // LL | blk();
      //    | ----- `blk` moved due to this call
      // LL | blk();
      //    | ^^^ value used here after move
      //    |
      // note: `FnOnce` closures can only be called once
      //   --> $DIR/once-cant-call-twice-on-heap.rs:6:10
      //    |
      // LL | fn foo<F:FnOnce()>(blk: F) {
      //    |        ^^^^^^^^ `F` is made to be an `FnOnce` closure here
      // LL | blk();
      //    | ----- this value implements `FnOnce`, which causes it to be moved when called
      // ```
      const self_ty_kind = self_ty.kind();
      let param_ty: ParamTy | undefined;
      let spans: Span[] | undefined;
      if (self_ty_kind.$ === "Param") {
        param_ty = self_ty_kind._0;
        const generics = this.infcx.tcx.generics_of(this.mir_def_id()) as Generics;
        const param = generics.type_param(param_ty, this.infcx.tcx);
        const hir_generics = this.infcx.tcx.hir_get_generics(this.infcx.tcx.typeck_root_def_id_local(this.mir_def_id()));
        if (hir_generics !== undefined) {
          spans = hir_generics.predicates
            .flatMap((pred) => (pred.kind.$ === "BoundPredicate" ? [pred.kind._0] : []))
            .filter((pred) => {
              const generic_param = pred.bounded_ty.as_generic_param();
              if (generic_param !== undefined) {
                const [id, _] = generic_param;
                return DefId_eq(id, param.def_id);
              } else {
                return false;
              }
            })
            .flatMap((pred) => pred.bounds)
            .flatMap((bound) => {
              const trait_ref = GenericBound.trait_ref(bound);
              let trait_def_id: DefId | undefined;
              if (trait_ref !== undefined && (trait_def_id = trait_ref.trait_def_id()) !== undefined && DefId_eq(trait_def_id, fn_trait_id)) {
                return [GenericBound.span(bound)];
              } else {
                return [];
              }
            });
        }
      }
      if (param_ty !== undefined && spans !== undefined && !(spans.length === 0)) {
        const span = into_MultiSpan([...spans]);
        const msg = DiagMessage_arg({ $: "Inline", _0: "`{$ty}` is made to be an `FnOnce` closure here" }, "ty", IntoDiagArg.String(display_ParamTy(param_ty))).format();
        for (const sp of spans) {
          span.push_span_label(sp, msg);
        }
        span.push_span_label(fn_call_span, { $: "Inline", _0: "this value implements `FnOnce`, which causes it to be moved when called" });
        err.span_note(span, { $: "Inline", _0: "`FnOnce` closures can only be called once" });
      } else {
        err.subdiagnostic(CaptureReasonNote_subdiagnostic({ $: "FnOnceMoveInCall", var_span }));
      }
    } else if (kind.$ === "Operator") {
      const { trait_id } = kind;
      const self_arg = unwrap(kind.self_arg);
      err.subdiagnostic(
        CaptureReasonLabel_subdiagnostic({
          $: "OperatorUse",
          fn_call_span,
          place_name,
          is_partial,
          is_loop_message,
        }),
      );
      if (set_insert(this.fn_self_span_reported, fn_span)) {
        const lang = this.infcx.tcx.lang_items();
        err.subdiagnostic(
          CaptureReasonNote_subdiagnostic(
            [lang.not_trait(), lang.deref_trait(), lang.neg_trait()].some((d) => d !== undefined && DefId_eq(d, trait_id))
              ? { $: "UnOpMoveByOperator", span: self_arg.span }
              : { $: "LhsMoveByOperator", span: self_arg.span },
          ),
        );
      }
    } else if (kind.$ === "Normal") {
      const { desugaring, method_did, method_args } = kind;
      const self_arg = unwrap(kind.self_arg);
      let has_sugg = false;
      const tcx = this.infcx.tcx;
      // Avoid pointing to the same function in multiple different
      // error messages.
      if (span !== DUMMY_SP && set_insert(this.fn_self_span_reported, self_arg.span)) {
        this.explain_iterator_advancement_in_for_loop_if_applicable(err, span, move_spans);

        const func = with_no_trimmed_paths(() => tcx.def_path_str(method_did));
        if (desugaring !== undefined) {
          const [kind, _] = desugaring;
          err.subdiagnostic(
            CaptureReasonNote_subdiagnostic({
              $: "DesugaringFuncTakeSelf",
              func,
              desugar_name: CallDesugaringKind.name(kind),
              place_name: place_name,
              span: self_arg.span,
            }),
          );
        } else {
          err.subdiagnostic(
            CaptureReasonNote_subdiagnostic({
              $: "FuncTakeSelf",
              func,
              place_name: place_name,
              span: self_arg.span,
            }),
          );
        }
      }
      const parent_did = tcx.parent(method_did);
      let parent_self_ty: DefId | undefined = undefined;
      if (tcx.def_kind(parent_did).$ === "Impl") {
        const did = parent_did;
        const self_kind = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(did) as EarlyBinder<Ty>)).kind();
        parent_self_ty = self_kind.$ === "Adt" ? self_kind._0.did() : undefined;
      }
      const is_option_or_result =
        parent_self_ty !== undefined &&
        ((name) => name === sym.Option || name === sym.Result)(tcx.get_diagnostic_name(parent_self_ty));
      if (is_option_or_result && maybe_reinitialized_locations_is_empty) {
        err.subdiagnostic(
          CaptureReasonLabel_subdiagnostic({
            $: "BorrowContent",
            var_span: Span.shrink_to_hi(var_span),
          }),
        );
      }
      if (desugaring !== undefined && (desugaring[0] === "ForLoopIntoIter" || desugaring[0] === "ForLoopIntoAsyncIter")) {
        const kind = desugaring[0];
        const ty = moved_place.ty(this.body, tcx).ty;
        const def_id = CallDesugaringKind.trait_def_id(kind, tcx);
        const suggest = type_known_to_meet_bound_modulo_regions(
          this.infcx.infcx,
          this.infcx.param_env,
          Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, ty),
          def_id,
        );
        if (suggest) {
          err.subdiagnostic(
            CaptureReasonSuggest_subdiagnostic({
              $: "IterateSlice",
              ty,
              span: Span.shrink_to_lo(move_span),
            }),
          );
        }

        switch (kind) {
          case "ForLoopIntoIter":
            err.subdiagnostic(
              CaptureReasonLabel_subdiagnostic({
                $: "ImplicitCall",
                fn_call_span,
                place_name,
                is_partial,
                is_loop_message,
              }),
            );
            break;
          case "ForLoopIntoAsyncIter":
            err.subdiagnostic(
              CaptureReasonLabel_subdiagnostic({
                $: "ImplicitAsyncCall",
                fn_call_span,
                place_name,
                is_partial,
                is_loop_message,
              }),
            );
            break;
        }
        // If the moved place was a `&mut` ref, then we can
        // suggest to reborrow it where it was moved, so it
        // will still be valid by the time we get to the usage.
        const moved_ty = moved_place.ty(this.body, this.infcx.tcx).ty.kind();
        if (moved_ty.$ === "Ref" && moved_ty._2 === Mutability.Mut) {
          // The `&mut *place` reborrow suggestion is `MachineApplicable`, so
          // only offer it where `*place` can be borrowed mutably: a value
          // captured by an `Fn` closure (held via `&self`) cannot, and the
          // suggestion would otherwise fail to compile with E0596.
          const reborrow_place = this.infcx.tcx.mk_place_deref(moved_place);
          const reborrow_is_valid = this.is_mutable(reborrow_place.as_ref(), LocalMutationIsAllowed.No).$ === "Ok";
          // Suggest `reborrow` in other place for following situations:
          // 1. If we are in a loop this will be suggested later.
          // 2. If the moved value is a mut reference, it is used in a
          // generic function and the corresponding arg's type is generic param.
          if (!is_loop_move && !has_suggest_reborrow && reborrow_is_valid) {
            this.suggest_reborrow(err, Span.shrink_to_lo(move_span), moved_place.as_ref());
          }
        }
      } else {
        if (desugaring !== undefined && desugaring[0] === "Await") {
          err.subdiagnostic(
            CaptureReasonLabel_subdiagnostic({
              $: "Await",
              fn_call_span,
              place_name,
              is_partial,
              is_loop_message,
            }),
          );
        } else if (desugaring !== undefined && desugaring[0] === "QuestionBranch") {
          err.subdiagnostic(
            CaptureReasonLabel_subdiagnostic({
              $: "QuestionMark",
              fn_call_span,
              place_name,
              is_partial,
              is_loop_message,
            }),
          );
        } else {
          err.subdiagnostic(
            CaptureReasonLabel_subdiagnostic({
              $: "MethodCall",
              fn_call_span,
              place_name,
              is_partial,
              is_loop_message,
            }),
          );
        }
        // Erase and shadow everything that could be passed to the new infcx.
        const ty = moved_place.ty(this.body, tcx).ty;

        const peeled = ty.peel_refs().kind();
        let pin_arg: TyKind | undefined;
        if (
          peeled.$ === "Adt" &&
          tcx.is_lang_item(peeled._0.did(), LangItem.Pin) &&
          (pin_arg = peeled._1.type_at(0).kind()).$ === "Ref" &&
          pin_arg._2 === Mutability.Mut
        ) {
          const self_ty = this.infcx.instantiate_binder_with_fresh_vars(
            fn_call_span,
            BoundRegionConversionTime.FnCall,
            PolyFnSig.input(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(method_did) as EarlyBinder<Binder<FnSig>>, tcx, method_args, fold_Binder(fold_FnSig))), 0),
            fold_Ty,
          );
          if (this.infcx.can_eq(this.infcx.param_env, ty, self_ty, ToTrace_Ty)) {
            err.subdiagnostic(
              CaptureReasonSuggest_subdiagnostic({
                $: "FreshReborrow",
                span: Span.shrink_to_hi(move_span),
              }),
            );
            has_sugg = true;
          }
        }
        const clone_trait = tcx.lang_items().clone_trait();
        if (clone_trait !== undefined) {
          // Check whether the deref is from a custom Deref impl
          // (e.g. Rc, Box) or a built-in reference deref.
          // For built-in derefs with Clone fully satisfied, we skip
          // the UFCS suggestion here and let `suggest_cloning`
          // downstream emit a simpler `.clone()` suggestion instead.
          const has_overloaded_deref = moved_place.iter_projections().some(([place, elem]) => {
            if (elem.$ !== "Deref") return false;
            const source = this.borrowed_content_source(place);
            return source.$ === "OverloadedDeref" || source.$ === "OverloadedIndex";
          });

          const has_deref = moved_place.iter_projections().some(([_, elem]) => elem.$ === "Deref");

          let sugg: [Span, string][];
          if (has_deref) {
            let start: Span;
            let end: Span;
            const expr = this.find_expr(move_span);
            if (expr !== undefined && this.clone_on_reference(expr) !== undefined && expr.kind.$ === "MethodCall") {
              const rcvr = expr.kind._1;
              [start, end] = [Span.shrink_to_lo(move_span), Span.with_lo(move_span, Span.hi(rcvr.span))];
            } else {
              [start, end] = [Span.shrink_to_lo(move_span), Span.shrink_to_hi(move_span)];
            }
            sugg = [
              // We use the fully-qualified path because `.clone()` can
              // sometimes choose `<&T as Clone>` instead of `<T as Clone>`
              // when going through auto-deref, so this ensures that doesn't
              // happen, causing suggestions for `.clone().clone()`.
              [start, `<${display_Ty(ty)} as Clone>::clone(&`],
              [end, ")"],
            ];
          } else {
            sugg = [[Span.shrink_to_hi(move_span), ".clone()"]];
          }
          const errors = this.infcx.type_implements_trait_shallow(clone_trait, ty, this.infcx.param_env);
          if (errors !== undefined && !has_sugg) {
            const skip_for_simple_clone = has_deref && !has_overloaded_deref && TraitErrors.no_errors(errors);
            if (!skip_for_simple_clone) {
              const slice = TraitErrors.as_slice(errors);
              let msg: string;
              if (slice.length === 0) {
                msg = "you can `clone` the value and consume it, but this might not be your desired behavior";
              } else if (slice.length === 1) {
                const error = slice[0]!;
                msg = `you could \`clone\` the value and consume it, if the \`${display_Predicate(error.obligation.predicate)}\` trait bound could be satisfied`;
              } else {
                msg = `you could \`clone\` the value and consume it, if the following trait bounds could be satisfied: ${unwrap(
                  listify(slice, (e: FulfillmentError) => `\`${display_Predicate(e.obligation.predicate)}\``),
                )}`;
              }
              err.multipart_suggestion(msg, sugg, Applicability.MaybeIncorrect);

              suggested_cloning = TraitErrors.no_errors(errors);

              for (const error of TraitErrors.into_iter(errors)) {
                const pred_kind = Binder.skip_binder(error.obligation.predicate.kind());
                if (
                  error.code.$ === "Select" &&
                  error.code._0.$ === "Unimplemented" &&
                  pred_kind.$ === "Clause" &&
                  pred_kind._0.$ === "Trait"
                ) {
                  const pred = pred_kind._0._0;
                  this.infcx.err_ctxt().suggest_derive(error.obligation, err, Binder.rebind(error.obligation.predicate.kind(), pred));
                }
              }
            }
          }
        }
      }
    } else {
      // Other desugarings takes &self, which cannot cause a move
    }
  } else {
    if (move_span !== span || is_loop_message) {
      err.subdiagnostic(
        CaptureReasonLabel_subdiagnostic({
          $: "MovedHere",
          move_span,
          is_partial,
          is_move_msg,
          is_loop_message,
        }),
      );
    }
    // If the move error occurs due to a loop, don't show
    // another message for the same span
    if (!is_loop_message) {
      UseSpans.var_subdiag(move_spans, err, undefined, (kind, var_span): CaptureVarCause => {
        switch (kind.$) {
          case "Coroutine":
            return { $: "PartialMoveUseInCoroutine", var_span, is_partial };
          case "Closure":
          case "CoroutineClosure":
            return { $: "PartialMoveUseInClosure", var_span, is_partial };
        }
      });
    }
  }
  return suggested_cloning ? CloneSuggestion.Emitted : CloneSuggestion.NotEmitted;
};

/** PORT: no upstream counterpart: `HashSet::insert` (returns whether the value was newly inserted). */
function set_insert<T>(set: Set<T>, v: T): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

/// Skip over locals that begin with an underscore or have no name
// rustc: compiler/rustc_borrowck/src/diagnostics/mod.rs:1645 local_excluded_from_unused_mut_lint
MirBorrowckCtxt.prototype.local_excluded_from_unused_mut_lint = function (this: MirBorrowckCtxt, index: Local): boolean {
  const name = this.local_name(index);
  return name === undefined || Symbol.as_str(name).startsWith("_");
};

const LIMITATION_NOTE: DiagMessage = { $: "Inline", _0: "due to a current limitation of the type system, this implies a `'static` lifetime" };
