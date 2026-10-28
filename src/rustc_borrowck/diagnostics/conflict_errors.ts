// Port of compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs (lane borrowck-contract: declarations; fill lanes
// bck-diag-a (lines < 2469) and bck-diag-b (lines >= 2469), plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the fn-local types of upstream's methods (hir / mir / type visitors) are classes declared inside the method that
// declares them upstream (contract convention "fn-local items"), under their upstream names: the two `ExpressionFinder`s
// (conflict_errors.rs:366 and :2833) and the two `ExprFinder`s (:2481 and :4730) are separate fn-local classes.
// PORT: tuple parameters destructured upstream (`(place, span): (Place<'tcx>, Span)`) are destructured tuple parameters.
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import type { Body, BorrowKind, ConstraintCategory, FakeReadCause, Location, Place, PlaceRef, Statement } from "../../rustc_middle/mir/mod.ts";
import { Visitor as MirVisitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import type { Const, Region } from "../../rustc_middle/ty/decls.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { ParamTy } from "../../rustc_middle/ty/sty.ts";
import type { PolyFnSig } from "../../rustc_middle/ty/sty.gen.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import type { Init, MovePathIndex } from "../../rustc_mir_dataflow/move_paths/mod.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import type { Ident, Symbol } from "../../rustc_span/symbol.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { BorrowData } from "../borrow_set.gen.ts";
import { type InitializationRequiringAction, MirBorrowckCtxt, type WriteKind } from "../lib.gen.ts";
import type { BorrowExplanation } from "./explain_borrow.gen.ts";
import type { UseSpans } from "./mod.gen.ts";
import type { RegionName } from "./region_name.gen.ts";
import * as gen from "./conflict_errors.gen.ts";
import { ConditionError, type MoveSite, type StorageDeadOrDrop } from "./conflict_errors.gen.ts";

export * from "./conflict_errors.gen.ts";

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // conflict_errors.rs:74 (lane bck-diag-a)
    report_use_of_moved_or_uninitialized(location: Location, desired_action: InitializationRequiringAction, _2: [PlaceRef, PlaceRef, Span], mpi: MovePathIndex): void;
    // conflict_errors.rs:353 (lane bck-diag-a)
    suggest_ref_or_clone(mpi: MovePathIndex, err: Diag, move_spans: UseSpans, moved_place: PlaceRef, has_suggest_reborrow: MutRef<boolean>, moved_or_invoked_closure: boolean): void;
    // conflict_errors.rs:588 (lane bck-diag-a)
    suggest_ref_for_dbg_args(body: hir.Expr, place: Place, move_span: Span, err: Diag): void;
    // conflict_errors.rs:635 (lane bck-diag-a)
    suggest_reborrow(err: Diag, span: Span, moved_place: PlaceRef): void;
    // conflict_errors.rs:660 (lane bck-diag-a)
    suggest_borrow_generic_arg(err: Diag, typeck: TypeckResults, call_expr: hir.Expr, callee_did: DefId, param: ParamTy, moved_place: PlaceRef, moved_arg_pos: number, moved_arg_ty: Ty, place_span: Span): Mutability | undefined;
    // conflict_errors.rs:795 (lane bck-diag-a)
    is_init_reachable(init: Init, err_location: Location): boolean;
    // conflict_errors.rs:823 (lane bck-diag-a)
    report_use_of_uninitialized(mpi: MovePathIndex, used_place: PlaceRef, moved_place: PlaceRef, desired_action: InitializationRequiringAction, location: Location, span: Span, use_spans: UseSpans): Diag;
    // conflict_errors.rs:1005 (lane bck-diag-a)
    suggest_assign_value(err: Diag, moved_place: PlaceRef, sugg_span: Span, strip_ref: boolean): void;
    // conflict_errors.rs:1035 (lane bck-diag-a)
    suggest_hoisting_call_outside_loop(err: Diag, expr: hir.Expr): boolean;
    // conflict_errors.rs:1253 (lane bck-diag-a)
    suggest_cloning_on_functional_record_update(err: Diag, ty: Ty, expr: hir.Expr): void;
    // conflict_errors.rs:1345 (lane bck-diag-a)
    suggest_cloning(err: Diag, place: PlaceRef, ty: Ty, expr: hir.Expr, use_spans: UseSpans | undefined): void;
    // conflict_errors.rs:1510 (lane bck-diag-a)
    implements_clone(ty: Ty): boolean;
    // conflict_errors.rs:1519 (lane bck-diag-a)
    clone_on_reference(expr: hir.Expr): Span | undefined;
    // conflict_errors.rs:1534 (lane bck-diag-a)
    in_move_closure(expr: hir.Expr): boolean;
    // conflict_errors.rs:1546 (lane bck-diag-a)
    suggest_cloning_inner(err: Diag, ty: Ty, expr: hir.Expr): boolean;
    // conflict_errors.rs:1637 (lane bck-diag-a)
    suggest_adding_bounds(err: Diag, ty: Ty, def_id: DefId, span: Span): void;
    // conflict_errors.rs:1684 (lane bck-diag-a)
    report_move_out_while_borrowed(location: Location, _1: [Place, Span], borrow: BorrowData): void;
    // conflict_errors.rs:1752 (lane bck-diag-a)
    report_use_while_mutably_borrowed(location: Location, _1: [Place, Span], borrow: BorrowData): Diag;
    // conflict_errors.rs:1796 (lane bck-diag-a)
    report_conflicting_borrow(location: Location, _1: [Place, Span], gen_borrow_kind: BorrowKind, issued_borrow: BorrowData): Diag;
    // conflict_errors.rs:2108 (lane bck-diag-a)
    suggest_copy_for_type_in_cloned_ref(err: Diag, place: Place): void;
    // conflict_errors.rs:2186 (lane bck-diag-a)
    suggest_adding_bounds_or_derive(err: Diag, ty: Ty, trait_def_id: DefId, span: Span): void;
    // conflict_errors.rs:2213 (lane bck-diag-a)
    suggest_using_local_if_applicable(err: Diag, location: Location, issued_borrow: BorrowData, explanation: BorrowExplanation): void;
    // conflict_errors.rs:2322 (lane bck-diag-a)
    find_expr(span: Span): hir.Expr | undefined;
    // conflict_errors.rs:2330 (lane bck-diag-a)
    suggest_slice_method_if_applicable(err: Diag, place: Place, borrowed_place: Place, span: Span, issued_span: Span): void;
    // conflict_errors.rs:2469 (lane bck-diag-b)
    explain_iterator_advancement_in_for_loop_if_applicable(err: Diag, span: Span, issued_spans: UseSpans): void;
    // conflict_errors.rs:2641 (lane bck-diag-b)
    explain_iterator_invalidation_in_for_loop_if_applicable(err: Diag, issued_spans: UseSpans, place: Place, borrowed_place: Place, borrow_kind: BorrowKind, gen_span: Span): void;
    // conflict_errors.rs:2692 (lane bck-diag-b)
    suggest_using_closure_argument_instead_of_capture(err: Diag, borrowed_place: Place, issued_spans: UseSpans): void;
    // conflict_errors.rs:2826 (lane bck-diag-b)
    suggest_binding_for_closure_capture_self(err: Diag, issued_spans: UseSpans): void;
    // conflict_errors.rs:2977 (lane bck-diag-b)
    describe_place_for_conflicting_borrow(first_borrowed_place: Place, second_borrowed_place: Place): [string, string, string, string];
    // conflict_errors.rs:3053 (lane bck-diag-b)
    report_borrowed_value_does_not_live_long_enough(location: Location, borrow: BorrowData, place_span: [Place, Span], kind: WriteKind | undefined): void;
    // conflict_errors.rs:3200 (lane bck-diag-b)
    report_local_value_does_not_live_long_enough(location: Location, name: string, borrow: BorrowData, drop_span: Span, borrow_spans: UseSpans, explanation: BorrowExplanation): Diag;
    // conflict_errors.rs:3325 (lane bck-diag-b)
    report_borrow_conflicts_with_destructor(location: Location, borrow: BorrowData, _2: [Place, Span], kind: WriteKind | undefined, dropped_ty: Ty): void;
    // conflict_errors.rs:3377 (lane bck-diag-b)
    report_thread_local_value_does_not_live_long_enough(drop_span: Span, borrow_span: Span): Diag;
    // conflict_errors.rs:3410 (lane bck-diag-b)
    report_temporary_value_does_not_live_long_enough(location: Location, borrow: BorrowData, drop_span: Span, borrow_spans: UseSpans, proper_span: Span, explanation: BorrowExplanation): Diag;
    // conflict_errors.rs:3566 (lane bck-diag-b)
    try_report_cannot_return_reference_to_local(borrow: BorrowData, borrow_span: Span, return_span: Span, category: ConstraintCategory, opt_place_desc: string | undefined): Result<null, Diag>;
    // conflict_errors.rs:3682 (lane bck-diag-b)
    report_escaping_closure_capture(use_span: UseSpans, var_span: Span, fr_name: RegionName, category: ConstraintCategory, constraint_span: Span, captured_var: string, scope: string): Diag;
    // conflict_errors.rs:3802 (lane bck-diag-b)
    report_escaping_data(borrow_span: Span, name: string | undefined, upvar_span: Span, upvar_name: Symbol, escape_span: Span): Diag;
    // conflict_errors.rs:3836 (lane bck-diag-b)
    get_moved_indexes(location: Location, mpi: MovePathIndex): [MoveSite[], Location[]];
    // conflict_errors.rs:4026 (lane bck-diag-b)
    report_illegal_mutation_of_borrowed(location: Location, _1: [Place, Span], loan: BorrowData): void;
    // conflict_errors.rs:4083 (lane bck-diag-b)
    explain_deref_coercion(loan: BorrowData, err: Diag): void;
    // conflict_errors.rs:4116 (lane bck-diag-b)
    report_illegal_reassignment(_0: [Place, Span], assigned_span: Span, err_place: Place): void;
    // conflict_errors.rs:4252 (lane bck-diag-b)
    classify_drop_access_kind(place: PlaceRef): StorageDeadOrDrop;
    // conflict_errors.rs:4307 (lane bck-diag-b)
    classify_immutable_section(place: Place): string | undefined;
    // conflict_errors.rs:4336 (lane bck-diag-b)
    annotate_argument_and_return_for_borrow(borrow: BorrowData): gen.AnnotatedBorrowFnSignature | undefined;
    // conflict_errors.rs:4555 (lane bck-diag-b)
    annotate_fn_sig(did: LocalDefId, sig: PolyFnSig): gen.AnnotatedBorrowFnSignature | undefined;
  }
}

declare module "./conflict_errors.gen.ts" {
  namespace ConditionError {
    // conflict_errors.rs:4870 (lane bck-diag-b)
    function new_(span: Span, kind: gen.ConditionErrorKind, label: string): ConditionError;
    export { new_ as new };
  }
}

// ==== lane bck-diag-a ====
// PORT: lane bck-diag-a's value imports sit here (ES imports are hoisted) so the parallel bck-diag-b edits of the import
// block above merge cleanly.
import { BindingMode, BindingMode_eq } from "../../rustc_ast/lib.ts";
import { Mutability as MutabilityC } from "../../rustc_ast_ir/lib.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { FormatArgs } from "../../rustc_attr_ir/diagnostic.gen.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { E0381, MultiSpan, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { HirId_eq } from "../../rustc_hir_id/lib.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../rustc_middle/hir/nested_filter.ts";
import { type BasicBlock, type Local, type Operand, type PlaceElem, StatementKind, type Terminator } from "../../rustc_middle/mir/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import { fold_GenericArgs, GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import { HasAttrs_DefId, Ty as TyC } from "../../rustc_middle/ty/mod.ts";
import { Clause_upcast_from_PolyTraitRef, Predicate_upcast_from_Clause, Predicate_upcast_from_PolyTraitRef } from "../../rustc_middle/ty/predicate.ts";
import { display_GenericArg, display_TraitRefPrintSugared, display_Ty, TraitRef_print_trait_sugared } from "../../rustc_middle/ty/print/pretty.ts";
import { print_Ty } from "../../rustc_middle/ty/print/mod.ts";
import { fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { suggest_constraining_type_params } from "../../rustc_middle/ty/diagnostics.ts";
import { DefId_eq } from "../../rustc_span/def_id.ts";
import { Span as SpanC } from "../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, kw, Symbol as SymbolC, sym } from "../../rustc_span/symbol.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { Binder as BinderC, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { as_interner, fold_with_TraitRef, PolyTraitClause, TraitClause, TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized, UnnormalizedClause, UnnormalizedPolyTraitClause } from "../../rustc_type_ir/unnormalized.ts";
import { supertrait_def_ids } from "../../rustc_type_ir/elaborate.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { FindExprBySpan } from "../../rustc_trait_selection/error_reporting/traits/mod.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import type { Generics, GenericParamDef } from "../../rustc_middle/ty/generics.ts";
import { InitializationRequiringAction as InitializationRequiringActionG } from "../lib.gen.ts";
import type { InitializationRequiringAction_methods } from "../lib.ts";
import { TypeNoCopy_subdiagnostic } from "../session_diagnostics.gen.ts";
import type { CaptureVarCause } from "../session_diagnostics.gen.ts";
import { BorrowExplanation as BorrowExplanationC } from "./explain_borrow.ts";
import { find as find_all_local_uses_find } from "./find_all_local_uses.ts";
import type { CapturedMessageOpt, DescribePlaceOpt } from "./mod.gen.ts";
import { UseSpans as UseSpansC } from "./mod.ts";
import type { CallKind } from "../../rustc_trait_selection/error_reporting/traits/call_kind.gen.ts";
import { Init as InitC, type InitIndex, type MoveOutIndex } from "../../rustc_mir_dataflow/move_paths/mod.ts";

/** PORT: the derived `PartialEq` of `mir::Location`. */
function Location_eq(a: Location, b: Location): boolean {
  return a.block === b.block && a.statement_index === b.statement_index;
}

/** PORT: the derived `PartialEq` of `mir::Place` (the projection list is interned: identity). */
function Place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/** PORT: the derived `PartialEq` of `PlaceElem` (`ProjectionElem<Local, Ty>`), field by field. */
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

/** PORT: the derived `PartialEq` of `mir::PlaceRef` (local + projection slice). */
function PlaceRef_eq(a: PlaceRef, b: PlaceRef): boolean {
  if (a.local !== b.local) return false;
  if (a.projection === b.projection) return true;
  if (a.projection.length !== b.projection.length) return false;
  for (let i = 0; i < a.projection.length; i++) if (!PlaceElem_eq(a.projection[i]!, b.projection[i]!)) return false;
  return true;
}

/** PORT: `Option<DefId> == Option<DefId>`. */
function option_DefId_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return DefId_eq(a, b);
}

/** PORT: `span.lo_hi() < other.lo_hi()` (tuples compare lexicographically). */
function lo_hi_lt(a: Span, b: Span): boolean {
  const [alo, ahi] = SpanC.lo_hi(a);
  const [blo, bhi] = SpanC.lo_hi(b);
  return alo !== blo ? alo < blo : ahi < bhi;
}

/** PORT: the derived `PartialEq` of `Ident` (`name` + `span.eq_ctxt`). */
function Ident_eq(a: Ident, b: Ident): boolean {
  return a.name === b.name && SpanC.eq_ctxt(a.span, b.span);
}

/** PORT: the derived `PartialEq` of `CallKind` (interned `Ty` / `GenericArgs` by identity). */
function CallKind_eq(a: CallKind, b: CallKind): boolean {
  const opt_ident_eq = (x: Ident | undefined, y: Ident | undefined): boolean => (x === undefined || y === undefined ? x === y : Ident_eq(x, y));
  switch (a.$) {
    case "Normal":
      return (
        b.$ === "Normal" &&
        opt_ident_eq(a.self_arg, b.self_arg) &&
        (a.desugaring === undefined || b.desugaring === undefined
          ? a.desugaring === b.desugaring
          : a.desugaring[0] === b.desugaring[0] && a.desugaring[1] === b.desugaring[1]) &&
        DefId_eq(a.method_did, b.method_did) &&
        a.method_args === b.method_args
      );
    case "FnCall":
      return b.$ === "FnCall" && DefId_eq(a.fn_trait_id, b.fn_trait_id) && a.self_ty === b.self_ty;
    case "Operator":
      return b.$ === "Operator" && opt_ident_eq(a.self_arg, b.self_arg) && DefId_eq(a.trait_id, b.trait_id) && a.self_ty === b.self_ty;
    case "DerefCoercion":
      return b.$ === "DerefCoercion" && a.deref_target_span === b.deref_target_span && a.deref_target_ty === b.deref_target_ty && a.self_ty === b.self_ty;
  }
}

/** PORT: the derived `PartialEq` of `UseSpans` (`issued_spans == borrow_spans`). */
function UseSpans_eq(a: UseSpans, b: UseSpans): boolean {
  switch (a.$) {
    case "ClosureUse":
      return (
        b.$ === "ClosureUse" &&
        hir_ClosureKind_eq(a.closure_kind, b.closure_kind) &&
        a.args_span === b.args_span &&
        a.capture_kind_span === b.capture_kind_span &&
        a.path_span === b.path_span
      );
    case "FnSelfUse":
      return b.$ === "FnSelfUse" && a.var_span === b.var_span && a.fn_call_span === b.fn_call_span && a.fn_span === b.fn_span && CallKind_eq(a.kind, b.kind);
    case "PatUse":
      return b.$ === "PatUse" && a._0 === b._0;
    case "OtherUse":
      return b.$ === "OtherUse" && a._0 === b._0;
  }
}

/** PORT: the derived `PartialEq` of `hir::ClosureKind` / `CoroutineKind`. */
function hir_ClosureKind_eq(a: hir.ClosureKind, b: hir.ClosureKind): boolean {
  const coroutine_kind_eq = (x: hir.CoroutineKind, y: hir.CoroutineKind): boolean =>
    x.$ === "Desugared" ? y.$ === "Desugared" && x._0 === y._0 && x._1 === y._1 : y.$ === "Coroutine" && x._0 === y._0;
  switch (a.$) {
    case "Closure":
      return b.$ === "Closure";
    case "Coroutine":
      return b.$ === "Coroutine" && coroutine_kind_eq(a._0, b._0);
    case "CoroutineClosure":
      return b.$ === "CoroutineClosure" && a._0 === b._0;
  }
}

/** `find_attr!(self.infcx.tcx, did, OnMove { directive, .. } => directive)`: `Option<Option<&Directive>>` (PORT: the
 *  outer `Some` is `{ $: "Some" }`: the first `OnMove` attribute wins even when its directive is `None`). */
function find_on_move(tcx: TyCtxt, did: DefId) {
  return find_attr(HasAttrs_DefId.get_attrs(did, tcx), (k) => (k.$ === "OnMove" ? { $: "Some" as const, _0: k.directive } : undefined));
}

// PORT: `InitializationRequiringAction`'s methods are attached to the generated companion by lib.ts (a type-only import
// here keeps lib.ts out of this module's load graph).
const InitializationRequiringActionC = InitializationRequiringActionG as typeof InitializationRequiringActionG & InitializationRequiringAction_methods;

/** `TypeFoldable` for `TraitRef` (the `Binder::dummy` proxy). */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

const DESCRIBE_PLACE_OPT_ALL: DescribePlaceOpt = { including_downcast: true, including_tuple_field: true };

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:74 report_use_of_moved_or_uninitialized
MirBorrowckCtxt.prototype.report_use_of_moved_or_uninitialized = function (
  this: MirBorrowckCtxt,
  location: Location,
  desired_action: InitializationRequiringAction,
  [moved_place, used_place, span_]: [PlaceRef, PlaceRef, Span],
  mpi: MovePathIndex,
): void {
  // debug!(
  //     "report_use_of_moved_or_uninitialized: location={:?} desired_action={:?} \
  //      moved_place={:?} used_place={:?} span={:?} mpi={:?}",
  //     location, desired_action, moved_place, used_place, span, mpi
  // );

  const use_spans = UseSpansC.or_else(this.move_spans(moved_place, location), () => this.borrow_spans(span_, location));
  const span = UseSpansC.args_or_use(use_spans);

  const [move_site_vec, maybe_reinitialized_locations] = this.get_moved_indexes(location, mpi);
  // debug!(
  //     "report_use_of_moved_or_uninitialized: move_site_vec={:?} use_spans={:?}",
  //     move_site_vec, use_spans
  // );
  const move_out_indices: MoveOutIndex[] = move_site_vec.map((move_site) => move_site.moi);

  if (move_out_indices.length === 0) {
    const root_local = used_place.local;

    // `!self.uninitialized_error_reported.insert(root_local)`
    const inserted = !this.uninitialized_error_reported.has(root_local);
    this.uninitialized_error_reported.add(root_local);
    if (!inserted) {
      // debug!(
      //     "report_use_of_moved_or_uninitialized place: error about {:?} suppressed",
      //     root_local
      // );
      return;
    }

    const err = this.report_use_of_uninitialized(mpi, used_place, moved_place, desired_action, location, span, use_spans);
    this.buffer_error(err);
  } else {
    const reported = this.has_move_error(move_out_indices);
    if (reported !== undefined) {
      const reported_place = reported[0];
      if (used_place.is_prefix_of(reported_place)) {
        // debug!(
        //     "report_use_of_moved_or_uninitialized place: error suppressed mois={:?}",
        //     move_out_indices
        // );
        return;
      }
    }

    const is_partial_move = move_site_vec.some((move_site) => {
      const move_out = this.move_data.move_outs[move_site.moi]!;
      const moved_place = this.move_data.move_paths[move_out.path]!.place;
      // `*(_1)` where `_1` is a `Box` is actually a move out.
      const moved_projection = moved_place.as_ref().projection;
      const is_box_move =
        moved_projection.length === 1 && moved_projection[0]!.$ === "Deref" && this.body.local_decls[moved_place.local]!.ty.is_box();

      return !is_box_move && !PlaceRef_eq(used_place, moved_place.as_ref()) && used_place.is_prefix_of(moved_place.as_ref());
    });

    const partial_str = is_partial_move ? "partial " : "";
    const partially_str = is_partial_move ? "partially " : "";

    let on_move_message: string | undefined;
    let on_move_label: string | undefined;
    let on_move_notes: string[];
    const moved_ty_kind = this.body.local_decls[moved_place.local]!.ty.kind();
    let found: ReturnType<typeof find_on_move>;
    if (moved_ty_kind.$ === "Adt" && (found = find_on_move(this.infcx.tcx, moved_ty_kind._0.did())) !== undefined && found._0 !== undefined) {
      const item_def = moved_ty_kind._0;
      const args = moved_ty_kind._1;
      const directive = found._0;
      const this_ = display_Symbol(this.infcx.tcx.item_name(item_def.did()));
      const generic_args: [Symbol, string][] = (this.infcx.tcx.generics_of(item_def.did()) as Generics).own_params.map((param): [Symbol, string] => {
        if (param.index >= args.length) return panic(`index out of bounds: the len is ${args.length} but the index is ${param.index}`);
        return [param.name, display_GenericArg(args[param.index]!)];
      });
      generic_args.push([kw.SelfUpper, this_]);

      // `FormatArgs { this, generic_args, .. }` (default field values)
      const format_args: FormatArgs = {
        this: this_,
        this_resolved: "",
        this_path: "",
        found: "",
        expected: "",
        unresolved: "",
        item_context: "",
        generic_args,
      };
      const { message, label, notes } = directive.eval(undefined, format_args);

      on_move_message = message;
      on_move_label = label;
      on_move_notes = notes;
    } else {
      on_move_message = undefined;
      on_move_label = undefined;
      on_move_notes = [];
    }

    const err = this.cannot_act_on_moved_value(
      span,
      InitializationRequiringActionC.as_noun(desired_action),
      partially_str,
      this.describe_place_with_options(moved_place, DESCRIBE_PLACE_OPT_ALL),
      on_move_message,
    );

    for (const note of on_move_notes) {
      err.note(note);
    }

    const reinit_spans: Span[] = maybe_reinitialized_locations
      .slice(0, 3)
      .map((loc) => UseSpansC.args_or_use(this.move_spans(this.move_data.move_paths[mpi]!.place.as_ref(), loc)));

    const reinits = maybe_reinitialized_locations.length;
    if (reinits === 1) {
      err.span_label(reinit_spans[0]!, "this reinitialization might get skipped");
    } else if (reinits > 1) {
      err.span_note(
        MultiSpan.from_spans(reinit_spans),
        reinits <= 3
          ? `these ${reinits} reinitializations might get skipped`
          : `these 3 reinitializations and ${reinits - 3} other${reinits === 4 ? "" : "s"} might get skipped`,
      );
    }

    const closure = this.add_moved_or_invoked_closure_note(location, used_place, err);

    let is_loop_move = false;
    // PORT: `FxIndexSet<Span>`: spans are interned numbers.
    const seen_spans = new Set<Span>();

    for (const move_site of move_site_vec) {
      const move_out = this.move_data.move_outs[move_site.moi]!;
      const moved_place = this.move_data.move_paths[move_out.path]!.place;

      const move_spans = this.move_spans(moved_place.as_ref(), move_out.source);
      const move_span = UseSpansC.args_or_use(move_spans);

      const is_move_msg = UseSpansC.for_closure(move_spans);

      const is_loop_message = Location_eq(location, move_out.source) || move_site.traversed_back_edge;

      if (Location_eq(location, move_out.source)) {
        is_loop_move = true;
      }

      const has_suggest_reborrow = { value: false };
      if (!seen_spans.has(move_span)) {
        this.suggest_ref_or_clone(mpi, err, move_spans, moved_place.as_ref(), has_suggest_reborrow, closure);

        const msg_opt: CapturedMessageOpt = {
          is_partial_move,
          is_loop_message,
          is_move_msg,
          is_loop_move,
          has_suggest_reborrow: has_suggest_reborrow.value,
          maybe_reinitialized_locations_is_empty: maybe_reinitialized_locations.length === 0,
        };
        this.explain_captures(err, span, move_span, move_spans, moved_place, msg_opt);
      }
      seen_spans.add(move_span);
    }

    UseSpansC.var_path_only_subdiag(use_spans, err, desired_action);

    if (!is_loop_move) {
      err.span_label(span, `value ${InitializationRequiringActionC.as_verb_in_past_tense(desired_action)} here after ${partial_str}move`);
    }

    const used_ty = used_place.ty(this.body, this.infcx.tcx).ty;
    const used_ty_kind = used_ty.kind();
    let needs_note: boolean;
    if (used_ty_kind.$ === "Closure") {
      needs_note = this.infcx.tcx.closure_kind_origin(used_ty_kind._0.expect_local()) === undefined;
    } else {
      needs_note = true;
    }

    const mpi_ = this.move_data.move_outs[move_out_indices[0]!]!.path;
    const place = this.move_data.move_paths[mpi_]!.place;
    const ty = place.ty(this.body, this.infcx.tcx).ty;

    let has_fn_bound = false;
    for (const c of this.infcx.param_env.caller_bounds()) {
      const pred = c.as_trait_clause();
      if (pred !== undefined && TraitClause.self_ty(BinderC.skip_binder(pred)) === ty && this.infcx.tcx.is_fn_trait(PolyTraitClause.def_id(pred))) {
        has_fn_bound = true;
        break;
      }
    }
    if (has_fn_bound) {
      // Suppress the next suggestion since we don't want to put more bounds onto
      // something that already has `Fn`-like bounds (or is a closure), so we can't
      // restrict anyways.
    } else {
      const copy_did = this.infcx.tcx.require_lang_item(LangItem.Copy, span);
      this.suggest_adding_bounds(err, ty, copy_did, span);
    }

    const opt_name = this.describe_place_with_options(place.as_ref(), DESCRIBE_PLACE_OPT_ALL);
    const note_msg = opt_name !== undefined ? `\`${opt_name}\`` : "value";
    if (needs_note) {
      const local = place.as_local();
      if (local !== undefined) {
        const span = this.body.local_decls[local]!.source_info.span;
        if (on_move_label !== undefined) {
          err.span_label(span, on_move_label);
        } else {
          err.subdiagnostic(TypeNoCopy_subdiagnostic({ $: "Label", is_partial_move, ty, place: note_msg, span }));
        }
      } else {
        err.subdiagnostic(TypeNoCopy_subdiagnostic({ $: "Note", is_partial_move, ty, place: note_msg }));
      }
    }

    if (use_spans.$ === "FnSelfUse" && use_spans.kind.$ === "DerefCoercion") {
      const { deref_target_span, deref_target_ty } = use_spans.kind;
      err.note(`${InitializationRequiringActionC.as_noun(desired_action)} occurs due to deref coercion to \`${display_Ty(deref_target_ty)}\``);

      // Check first whether the source is accessible (issue #87060)
      if (deref_target_span !== undefined && this.infcx.tcx.sess.source_map().is_span_accessible(deref_target_span)) {
        err.span_note(deref_target_span, "deref defined here");
      }
    }

    this.buffer_move_error(move_out_indices, [used_place, err]);
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:353 suggest_ref_or_clone
MirBorrowckCtxt.prototype.suggest_ref_or_clone = function (
  this: MirBorrowckCtxt,
  mpi: MovePathIndex,
  err: Diag,
  move_spans: UseSpans,
  moved_place: PlaceRef,
  has_suggest_reborrow: MutRef<boolean>,
  moved_or_invoked_closure: boolean,
): void {
  const move_span = move_spans.$ === "ClosureUse" ? move_spans.capture_kind_span : UseSpansC.args_or_use(move_spans);
  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:366 ExpressionFinder
  class ExpressionFinder extends hir.intravisit.Visitor {
    // type NestedFilter = OnlyBodies;
    override NestedFilter = OnlyBodies;

    constructor(
      public expr_span: Span,
      public expr: hir.Expr | undefined,
      public pat: hir.Pat | undefined,
      public parent_pat: hir.Pat | undefined,
      public tcx: TyCtxt,
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:376 maybe_tcx
    override maybe_tcx(): HirTyCtxt {
      return TyCtxt_as_HirTyCtxt(this.tcx);
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:380 visit_expr
    override visit_expr(e: hir.Expr): undefined {
      if (e.span === this.expr_span) {
        this.expr = e;
      }
      hir.intravisit.walk_expr(this, e);
      return undefined;
    }
    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:386 visit_pat
    override visit_pat(p: hir.Pat): undefined {
      if (p.span === this.expr_span) {
        this.pat = p;
      }
      if (p.kind.$ === "Binding" && BindingMode_eq(p.kind._0, BindingMode.NONE)) {
        const i = p.kind._2;
        const sub = p.kind._3;
        if (i.span === this.expr_span || p.span === this.expr_span) {
          this.pat = p;
        }
        // Check if we are in a situation of `ident @ ident` where we want to suggest
        // `ref ident @ ref ident` or `ref ident @ Struct { ref ident }`.
        if (sub !== undefined && this.pat === undefined) {
          const subpat = sub;
          this.visit_pat(subpat);
          if (this.pat !== undefined) {
            this.parent_pat = p;
          }
          return undefined;
        }
      }
      hir.intravisit.walk_pat(this, p);
      return undefined;
    }
  }
  const tcx = this.infcx.tcx;
  const body = tcx.hir_maybe_body_owned_by(this.mir_def_id());
  if (body !== undefined) {
    const expr = body.value;
    const place = this.move_data.move_paths[mpi]!.place;
    const place_local = place.as_local();
    const span = place_local === undefined ? undefined : this.body.local_decls[place_local]!.source_info.span;
    const finder = new ExpressionFinder(move_span, undefined, undefined, undefined, tcx);
    finder.visit_expr(expr);
    const found_expr = finder.expr;
    if (span !== undefined && found_expr !== undefined) {
      const expr = found_expr;
      for (const [, node] of tcx.hir_parent_iter(expr.hir_id)) {
        if (node.$ === "Expr") {
          const expr = node._0;
          if (SpanC.contains(expr.span, span)) {
            // If the let binding occurs within the same loop, then that
            // loop isn't relevant, like in the following, the outermost `loop`
            // doesn't play into `x` being moved.
            // ```
            // loop {
            //     let x = String::new();
            //     loop {
            //         foo(x);
            //     }
            // }
            // ```
            break;
          }
          if (expr.kind.$ === "Loop") {
            const loop_span = expr.kind._3;
            err.span_label(loop_span, "inside of this loop");
          }
        }
      }
      const typeck = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
      const parent = this.infcx.tcx.parent_hir_node(expr.hir_id);
      let def_id: DefId | undefined;
      let args: readonly hir.Expr[];
      let offset: number;
      let callee_kind: ReturnType<Ty["kind"]> | undefined;
      if (parent.$ === "Expr" && parent._0.kind.$ === "MethodCall") {
        const parent_expr = parent._0;
        def_id = typeck.type_dependent_def_id(parent_expr.hir_id);
        args = parent._0.kind._2;
        offset = 1;
      } else if (
        parent.$ === "Expr" &&
        parent._0.kind.$ === "Call" &&
        (callee_kind = typeck.node_type(parent._0.kind._0.hir_id).kind()).$ === "FnDef"
      ) {
        def_id = callee_kind._0;
        args = parent._0.kind._1;
        offset = 0;
      } else {
        def_id = undefined;
        args = [];
        offset = 0;
      }
      const ty = place.ty(this.body, this.infcx.tcx).ty;

      let can_suggest_clone = true;
      let pos: number;
      if (def_id !== undefined && (pos = args.findIndex((arg) => HirId_eq(arg.hir_id, expr.hir_id))) !== -1) {
        // The move occurred as one of the arguments to a function call. Is that
        // argument generic? `def_id` can't be a closure here, so using `fn_sig` is fine
        let arg_param: ParamTy | undefined;
        let arg_ty: Ty | undefined;
        let arg_ty_kind: ReturnType<Ty["kind"]>;
        if (
          hir.def.DefKind.is_fn_like(this.infcx.tcx.def_kind(def_id)) &&
          (arg_ty = FnSig.inputs(Unnormalized.skip_binder(EarlyBinder.instantiate_identity(this.infcx.tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>)))[pos + offset]) !==
            undefined &&
          (arg_ty_kind = arg_ty.kind()).$ === "Param"
        ) {
          arg_param = arg_ty_kind._0;
        } else {
          arg_param = undefined;
        }

        // If the moved value is a mut reference, it is used in a
        // generic function and it's type is a generic param, it can be
        // reborrowed to avoid moving.
        // for example:
        // struct Y(u32);
        // x's type is '& mut Y' and it is used in `fn generic<T>(x: T) {}`.
        const ty_kind = ty.kind();
        if (ty_kind.$ === "Ref" && ty_kind._2 === "Mut" && arg_param !== undefined) {
          has_suggest_reborrow.value = true;
          this.suggest_reborrow(err, expr.span, moved_place);
          return;
        }

        // If the moved place is used generically by the callee and a reference to it
        // would still satisfy any bounds on its type, suggest borrowing.
        let ref_mutability: Mutability | undefined;
        let local_def_id: LocalDefId | undefined;
        let node: hir.Node;
        let fn_decl: hir.FnDecl | undefined;
        let ident: Ident | undefined;
        let arg: hir.Ty | undefined;
        if (
          arg_param !== undefined &&
          parent.$ === "Expr" &&
          (ref_mutability = this.suggest_borrow_generic_arg(err, typeck, parent._0, def_id, arg_param, moved_place, pos + offset, ty, expr.span)) !==
            undefined
        ) {
          can_suggest_clone = MutabilityC.is_mut(ref_mutability);
        } else if (
          (local_def_id = def_id.as_local()) !== undefined &&
          ((node = this.infcx.tcx.hir_node_by_def_id(local_def_id)), true) &&
          (fn_decl = hir.Node.fn_decl(node)) !== undefined &&
          (ident = hir.Node.ident(node)) !== undefined &&
          (arg = fn_decl.inputs[pos + offset]) !== undefined
        ) {
          // If we can't suggest borrowing in the call, but the function definition
          // is local, instead offer changing the function to borrow that argument.
          const span = MultiSpan.from_Span(arg.span);
          span.push_span_label(arg.span, "this parameter takes ownership of the value");
          const fn_kind = hir.Node.fn_kind(node);
          let descr: string;
          if (fn_kind === undefined || fn_kind.$ === "ItemFn") {
            descr = "function";
          } else if (fn_kind.$ === "Method") {
            descr = "method";
          } else {
            descr = "closure";
          }
          span.push_span_label(ident.span, `in this ${descr}`);
          err.span_note(
            span,
            `consider changing this parameter type in ${descr} \`${display_Ident(ident)}\` to borrow instead if owning the value isn't necessary`,
          );
        }
      }
      if (
        parent.$ === "Expr" &&
        parent._0.kind.$ === "Call" &&
        parent._0.kind._0.kind.$ === "Path" &&
        tcx.qpath_is_lang_item(parent._0.kind._0.kind._0, LangItem.IntoIterIntoIter)
      ) {
        // Do not suggest `.clone()` in a `for` loop, we already suggest borrowing.
      } else if (move_spans.$ === "FnSelfUse" && move_spans.kind.$ === "Normal") {
        // We already suggest cloning for these cases in `explain_captures`.
      } else if (moved_or_invoked_closure) {
        // Do not suggest `closure.clone()()`.
      } else if (
        move_spans.$ === "ClosureUse" &&
        move_spans.closure_kind.$ === "Coroutine" &&
        move_spans.closure_kind._0.$ === "Desugared" &&
        move_spans.closure_kind._0._1 === "Block" &&
        can_suggest_clone
      ) {
        this.suggest_cloning(err, place.as_ref(), ty, expr, move_spans);
      } else if (this.suggest_hoisting_call_outside_loop(err, expr) && can_suggest_clone) {
        // The place where the type moves would be misleading to suggest clone.
        // #121466
        this.suggest_cloning(err, place.as_ref(), ty, expr, move_spans);
      }
    }

    this.suggest_ref_for_dbg_args(expr, place, move_span, err);

    // it's useless to suggest inserting `ref` when the span don't comes from local code
    const pat = finder.pat;
    if (pat !== undefined && !SpanC.is_dummy(move_span) && !this.infcx.tcx.sess.source_map().is_imported(move_span)) {
      const sugg: [Span, string][] = [[SpanC.shrink_to_lo(pat.span), "ref "]];
      const parent_pat = finder.parent_pat;
      if (parent_pat !== undefined) {
        sugg.unshift([SpanC.shrink_to_lo(parent_pat.span), "ref "]);
      }
      err.multipart_suggestion("borrow this binding in the pattern to avoid moving the value", sugg, "MachineApplicable");
    }
  }
};

// for dbg!(x) which may take ownership, suggest dbg!(&x) instead
// but here we actually do not check whether the macro name is `dbg!`
// so that we may extend the scope a bit larger to cover more cases
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:588 suggest_ref_for_dbg_args
MirBorrowckCtxt.prototype.suggest_ref_for_dbg_args = function (this: MirBorrowckCtxt, body: hir.Expr, place: Place, move_span: Span, err: Diag): void {
  const var_info = this.body.var_debug_info.find((info) => info.value.$ === "Place" && Place_eq(info.value._0, place));
  if (var_info === undefined) return;
  const arg_name = var_info.name;
  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:601 MatchArgFinder
  class MatchArgFinder extends hir.intravisit.Visitor {
    constructor(
      public expr_span: Span,
      public match_arg_span: Span | undefined,
      public arg_name: Symbol,
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:607 visit_expr
    override visit_expr(e: hir.Expr): undefined {
      // dbg! is expanded into a match pattern, we need to find the right argument span
      if (e.kind.$ === "Match") {
        const expr = e.kind._0;
        if (
          expr.kind.$ === "Path" &&
          expr.kind._0.$ === "Resolved" &&
          expr.kind._0._1.segments.length === 1 &&
          expr.kind._0._1.segments[0]!.ident.name === this.arg_name &&
          SpanC.contains(SpanC.source_callsite(this.expr_span), expr.span)
        ) {
          const path = expr.kind._0._1;
          this.match_arg_span = path.span;
        }
      }
      hir.intravisit.walk_expr(this, e);
      return undefined;
    }
  }

  const finder = new MatchArgFinder(move_span, undefined, arg_name);
  finder.visit_expr(body);
  const macro_arg_span = finder.match_arg_span;
  if (macro_arg_span !== undefined) {
    err.span_suggestion_verbose(SpanC.shrink_to_lo(macro_arg_span), "consider borrowing instead of transferring ownership", "&", "MachineApplicable");
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:635 suggest_reborrow
MirBorrowckCtxt.prototype.suggest_reborrow = function (this: MirBorrowckCtxt, err: Diag, span: Span, moved_place: PlaceRef): void {
  const n = this.describe_place(moved_place);
  err.span_suggestion_verbose(
    SpanC.shrink_to_lo(span),
    `consider creating a fresh reborrow of ${n !== undefined ? `\`${n}\`` : "the mutable reference"} here`,
    "&mut *",
    "MachineApplicable",
  );
};

/// If a place is used after being moved as an argument to a function, the function is generic
/// in that argument, and a reference to the argument's type would still satisfy the function's
/// bounds, suggest borrowing. This covers, e.g., borrowing an `impl Fn()` argument being passed
/// in an `impl FnOnce()` position.
/// Returns `Some(mutability)` when suggesting to borrow with mutability `mutability`, or `None`
/// if no suggestion is made.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:660 suggest_borrow_generic_arg
MirBorrowckCtxt.prototype.suggest_borrow_generic_arg = function (
  this: MirBorrowckCtxt,
  err: Diag,
  typeck: TypeckResults,
  call_expr: hir.Expr,
  callee_did: DefId,
  param: ParamTy,
  moved_place: PlaceRef,
  moved_arg_pos: number,
  moved_arg_ty: Ty,
  place_span: Span,
): Mutability | undefined {
  const tcx = this.infcx.tcx;
  const sig = Unnormalized.skip_binder(EarlyBinder.instantiate_identity(tcx.fn_sig(callee_did) as EarlyBinder<PolyFnSig>));
  const clauses = tcx.clauses_of(callee_did) as GenericClauses;

  let generic_args: GenericArgs;
  let callee_kind: ReturnType<Ty["kind"]>;
  if (call_expr.kind.$ === "MethodCall") {
    // For method calls, generic arguments are attached to the call node.
    const a = typeck.node_args_opt(call_expr.hir_id);
    if (a === undefined) return undefined;
    generic_args = a;
  } else if (call_expr.kind.$ === "Call" && (callee_kind = typeck.node_type(call_expr.kind._0.hir_id).kind()).$ === "FnDef") {
    // For normal calls, generic arguments are in the callee's type.
    // This diagnostic is only run for `FnDef` callees.
    const args = callee_kind._1;
    generic_args = unwrap(BinderC.no_bound_vars(args, fold_GenericArgs));
  } else {
    return undefined;
  }

  // First, is there at least one method on one of `param`'s trait bounds?
  // This keeps us from suggesting borrowing the argument to `mem::drop`, e.g.
  if (
    !GenericClauses.instantiate_identity(clauses, tcx).clauses.some((clause) => {
      const tc = UnnormalizedClause.as_trait_clause(clause);
      if (tc === undefined) return false;
      if (!(Unnormalized.skip_binder(UnnormalizedPolyTraitClause.self_ty(tc)).is_param(param.index) && UnnormalizedPolyTraitClause.polarity(tc) === "Positive")) {
        return false;
      }
      for (const trait_did of supertrait_def_ids(tcx, UnnormalizedPolyTraitClause.def_id(tc))) {
        for (const item of AssocItems.in_definition_order(tcx.associated_items(trait_did) as AssocItems)) {
          if (AssocItem.is_method(item)) return true;
        }
      }
      return false;
    })
  ) {
    return undefined;
  }

  // Try borrowing a shared reference first, then mutably.
  const mutbl = (["Not", "Mut"] as const).find((mutbl): boolean => {
    const re = this.infcx.tcx.lifetimes.re_erased;
    const ref_ty = TyC.new_ref(this.infcx.tcx, re, moved_arg_ty, mutbl);

    // Ensure that substituting `ref_ty` in the callee's signature doesn't break
    // other inputs or the return type.
    const new_args = tcx.mk_args_from_iter(generic_args.map((arg, i) => (i === param.index ? GenericArg.from_Ty(ref_ty) : arg)));
    const can_subst = (ty: Ty): boolean => {
      // Normalize before comparing to see through type aliases and projections.
      const old_ty = EarlyBinder.instantiate(EarlyBinder.bind(tcx, ty, fold_Ty), tcx, generic_args, fold_Ty);
      const new_ty = EarlyBinder.instantiate(EarlyBinder.bind(tcx, ty, fold_Ty), tcx, new_args, fold_Ty);
      const old_r = tcx.try_normalize_erasing_regions(this.infcx.typing_env(this.infcx.param_env), old_ty, fold_Ty);
      if (old_r.$ === "Ok") {
        const new_r = tcx.try_normalize_erasing_regions(this.infcx.typing_env(this.infcx.param_env), new_ty, fold_Ty);
        if (new_r.$ === "Ok") {
          return old_r._0 === new_r._0;
        }
      }
      return false;
    };
    if (!can_subst(FnSig.output(sig)) || FnSig.inputs(sig).some((input_ty, i) => i !== moved_arg_pos && !can_subst(input_ty))) {
      return false;
    }

    // Test the callee's clauses, substituting in `ref_ty` for the moved argument type.
    return GenericClauses.instantiate(clauses, tcx, new_args).clauses.every((clause) => {
      // Normalize before testing to see through type aliases and projections.
      const r = tcx.try_normalize_erasing_regions(this.infcx.typing_env(this.infcx.param_env), clause, fold_Clause);
      const normalized = r.$ === "Ok" ? r._0 : Unnormalized.skip_norm_wip(clause);
      return this.infcx.predicate_must_hold_modulo_regions(
        new Obligation(ObligationCause.dummy(), this.infcx.param_env, Predicate_upcast_from_Clause(normalized, tcx), 0),
      );
    });
  });
  if (mutbl !== undefined) {
    const desc = this.describe_place(moved_place);
    const place_desc = desc !== undefined ? `\`${desc}\`` : "here";
    err.span_suggestion_verbose(
      SpanC.shrink_to_lo(place_span),
      `consider ${MutabilityC.mutably_str(mutbl)}borrowing ${place_desc}`,
      MutabilityC.ref_prefix_str(mutbl),
      "MaybeIncorrect",
    );
    return mutbl;
  } else {
    return undefined;
  }
};

/// Returns `true` if the given initialization can reach the error location.
///
/// This is used to determine whether an initialization should be considered
/// when reporting diagnostics at `err_location`.
///
/// The check proceeds in two stages:
///
/// 1. If the initialization originates from a function argument, it is
///    considered reachable by definition.
/// 2. If the initialization's basic block dominates the error block, then
///    every path to the error must pass through the initialization, so it is
///    reachable.
/// 3. Otherwise, perform a graph traversal over the MIR control-flow graph to
///    determine whether any path exists from the initialization block to the
///    error block.
///
/// The dominance check acts as a fast path for the common case, while the CFG
/// traversal handles cases where the initialization does not dominate the
/// error location but can still reach it through an alternate control-flow
/// path.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:795 is_init_reachable
MirBorrowckCtxt.prototype.is_init_reachable = function (this: MirBorrowckCtxt, init: Init, err_location: Location): boolean {
  const dominators = this.body.basic_blocks.dominators();
  let init_block: BasicBlock;
  switch (init.location.$) {
    case "Argument":
      return true;
    case "Statement":
      init_block = init.location._0.block;
      break;
  }
  const err_block = err_location.block;
  if (dominators.dominates(init_block, err_block)) {
    return true;
  }
  // If init_block doesn't dominate error_block, check if there is any valid path from the
  // initialization block to the error block in the Control Flow Graph.
  const visited = DenseBitSet.new_empty<BasicBlock>(this.body.basic_blocks.deref().length);
  const stack: BasicBlock[] = [init_block];
  let block: BasicBlock | undefined;
  while ((block = stack.pop()) !== undefined) {
    if (block === err_block) {
      return true;
    }
    if (visited.insert(block)) {
      const data = this.body.basic_blocks.deref()[block]!;
      for (const successor of data.terminator_().successors()) {
        stack.push(successor);
      }
    }
  }
  return false;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:823 report_use_of_uninitialized
MirBorrowckCtxt.prototype.report_use_of_uninitialized = function (
  this: MirBorrowckCtxt,
  mpi: MovePathIndex,
  used_place: PlaceRef,
  moved_place: PlaceRef,
  desired_action: InitializationRequiringAction,
  location: Location,
  span: Span,
  use_spans: UseSpans,
): Diag {
  // We need all statements in the body where the binding was assigned to later find all
  // the branching code paths where the binding *wasn't* assigned to.
  const inits: readonly InitIndex[] = this.move_data.init_path_map[mpi]!;
  const move_path = this.move_data.move_paths[mpi]!;
  const decl_span = this.body.local_decls[move_path.place.local]!.source_info.span;
  // PORT: `FxIndexSet<Span>`: spans are interned numbers (insertion order kept).
  const all_init_spans_set = new Set<Span>();
  const reachable_spans_set = new Set<Span>();
  for (const init_idx of inits) {
    const init = this.move_data.inits[init_idx]!;
    const span = InitC.span(init, this.body);
    if (!SpanC.is_dummy(span)) {
      all_init_spans_set.add(span);
      if (this.is_init_reachable(init, location)) {
        reachable_spans_set.add(span);
      }
    }
  }
  const all_init_spans: Span[] = [...all_init_spans_set];
  const reachable_spans: Span[] = [...reachable_spans_set];

  let name: string;
  let desc: string;
  const moved_name = this.describe_place_with_options(moved_place, DESCRIBE_PLACE_OPT_ALL);
  if (moved_name !== undefined) {
    name = `\`${moved_name}\``;
    desc = `\`${moved_name}\` `;
  } else {
    name = "the variable";
    desc = "";
  }
  const used_name = this.describe_place_with_options(used_place, DESCRIBE_PLACE_OPT_ALL);
  const path = used_name !== undefined ? `\`${used_name}\`` : "value";

  // We use the statements were the binding was initialized, and inspect the HIR to look
  // for the branching codepaths that aren't covered, to point at them.
  const tcx = this.infcx.tcx;
  const body = tcx.hir_body_owned_by(this.mir_def_id());
  const visitor = new ConditionVisitor(tcx, [...all_init_spans], name, []);
  visitor.visit_body(body);

  let show_assign_sugg = false;
  let isnt_initialized: string;
  if (desired_action === "PartialAssignment" || desired_action === "Assignment") {
    // The same error is emitted for bindings that are *sometimes* initialized and the ones
    // that are *partially* initialized by assigning to a field of an uninitialized
    // binding. We differentiate between them for more accurate wording here.
    isnt_initialized = "isn't fully initialized";
  } else if (
    !reachable_spans.some(
      (i) =>
        // We filter these to avoid misleading wording in cases like the following,
        // where `x` has an `init`, but it is in the same place we're looking at:
        // ```
        // let x;
        // x += 1;
        // ```
        !SpanC.contains(i, span) &&
        // We filter these to avoid incorrect main message on `match-cfg-fake-edges.rs`
        !visitor.errors.map((error) => error.span).some((sp) => lo_hi_lt(span, sp) && !SpanC.contains(sp, span)),
    )
  ) {
    show_assign_sugg = true;
    if (all_init_spans.some((init_span) => !SpanC.contains(init_span, span)) && reachable_spans.length === 0) {
      isnt_initialized = "isn't initialized on any path leading to this point";
    } else {
      isnt_initialized = "isn't initialized";
    }
  } else {
    isnt_initialized = "is possibly-uninitialized";
  }

  const used = InitializationRequiringActionC.as_general_verb_in_past_tense(desired_action);
  const err = struct_span_code_err(this.dcx(), span, E0381, `${used} binding ${desc}${isnt_initialized}`);
  UseSpansC.var_path_only_subdiag(use_spans, err, desired_action);

  if (desired_action === "PartialAssignment" || desired_action === "Assignment") {
    err.help(
      "partial initialization isn't supported, fully initialize the binding with a " +
        "default value and mutate it, or use `std::mem::MaybeUninit`",
    );
  }
  err.span_label(span, `${path} ${used} here but it ${isnt_initialized}`);

  let shown = false;
  let shown_condition_value = false;
  for (const error of visitor.errors) {
    if (lo_hi_lt(error.span, span) && !SpanC.overlaps(error.span, span)) {
      // When we have a case like `match-cfg-fake-edges.rs`, we don't want to mention
      // match arms coming after the primary span because they aren't relevant:
      // ```
      // let x;
      // match y {
      //     _ if { x = 2; true } => {}
      //     _ if {
      //         x; //~ ERROR
      //         false
      //     } => {}
      //     _ => {} // We don't want to point to this.
      // };
      // ```
      shown_condition_value ||= ConditionErrorKind.describes_condition_value(error.kind);
      err.span_label(error.span, error.label);
      shown = true;
    }
  }
  if (!shown) {
    for (const sp of reachable_spans) {
      if (lo_hi_lt(sp, span) && !SpanC.overlaps(sp, span)) {
        err.span_label(sp, "binding initialized here in some conditions");
      }
    }
  }

  err.span_label(decl_span, "binding declared here but left uninitialized");
  if (shown_condition_value) {
    err.note(
      "when checking initialization, the compiler describes possible control-flow paths " +
        "without evaluating whether branch conditions can actually have the values shown",
    );
  }
  if (show_assign_sugg) {
    // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:968 LetVisitor
    class LetVisitor extends hir.intravisit.Visitor {
      constructor(
        public decl_span: Span,
        public sugg: [Span, boolean] | undefined,
      ) {
        super();
      }

      // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:974 visit_stmt
      override visit_stmt(ex: hir.Stmt): undefined {
        if (this.sugg !== undefined) {
          return undefined;
        }

        // FIXME: We make sure that this is a normal top-level binding,
        // but we could suggest `todo!()` for all uninitialized bindings in the pattern
        if (ex.kind.$ === "Let" && ex.kind._0.init === undefined && ex.kind._0.pat.kind.$ === "Binding" && SpanC.contains(ex.kind._0.span, this.decl_span)) {
          const { ty, pat } = ex.kind._0;
          const binding_mode = ex.kind._0.pat.kind._0;
          // Insert after the whole binding pattern so suggestions stay valid for
          // bindings with `@` subpatterns like `ref mut x @ v`.
          const strip_ref = binding_mode._0.$ === "Yes";
          this.sugg = ty === undefined ? [pat.span, strip_ref] : [ty.span, strip_ref];
        }
        hir.intravisit.walk_stmt(this, ex);
        return undefined;
      }
    }

    const visitor = new LetVisitor(decl_span, undefined);
    visitor.visit_body(body);
    if (visitor.sugg !== undefined) {
      const [span, strip_ref] = visitor.sugg;
      this.suggest_assign_value(err, moved_place, span, strip_ref);
    }
  }
  return err;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1005 suggest_assign_value
MirBorrowckCtxt.prototype.suggest_assign_value = function (this: MirBorrowckCtxt, err: Diag, moved_place: PlaceRef, sugg_span: Span, strip_ref: boolean): void {
  let ty = moved_place.ty(this.body, this.infcx.tcx).ty;
  const ty_kind = ty.kind();
  if (strip_ref && ty_kind.$ === "Ref") {
    ty = ty_kind._1;
  }
  // debug!("ty: {:?}, kind: {:?}", ty, ty.kind());

  const assign_value = this.infcx.err_ctxt().ty_kind_suggestion(this.infcx.param_env, ty);
  if (assign_value === undefined) {
    return;
  }

  err.span_suggestion_verbose(SpanC.shrink_to_hi(sugg_span), "consider assigning a value", ` = ${assign_value}`, "MaybeIncorrect");
};

/// In a move error that occurs on a call within a loop, we try to identify cases where cloning
/// the value would lead to a logic error. We infer these cases by seeing if the moved value is
/// part of the logic to break the loop, either through an explicit `break` or if the expression
/// is part of a `while let`.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1035 suggest_hoisting_call_outside_loop
MirBorrowckCtxt.prototype.suggest_hoisting_call_outside_loop = function (this: MirBorrowckCtxt, err: Diag, expr: hir.Expr): boolean {
  const tcx = this.infcx.tcx;
  let can_suggest_clone = true;

  // If the moved value is a locally declared binding, we'll look upwards on the expression
  // tree until the scope where it is defined, and no further, as suggesting to move the
  // expression beyond that point would be illogical.
  let local_hir_id: hir.HirId | undefined;
  if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._1.res.$ === "Local") {
    local_hir_id = expr.kind._0._1.res._0;
  } else {
    // This case would be if the moved value comes from an argument binding, we'll just
    // look within the entire item, that's fine.
    local_hir_id = undefined;
  }

  /// This will allow us to look for a specific `HirId`, in our case `local_hir_id` where the
  /// binding was declared, within any other expression. We'll use it to search for the
  /// binding declaration within every scope we inspect.
  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1057 Finder
  class Finder extends hir.intravisit.Visitor<ControlFlow<null>> {
    // type Result = ControlFlow<()>;
    override Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

    constructor(public hir_id: hir.HirId) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1062 visit_pat
    override visit_pat(pat: hir.Pat): ControlFlow<null> {
      if (HirId_eq(pat.hir_id, this.hir_id)) {
        return ControlFlow.Break(null);
      }
      return hir.intravisit.walk_pat(this, pat);
    }
    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1068 visit_expr
    override visit_expr(ex: hir.Expr): ControlFlow<null> {
      if (HirId_eq(ex.hir_id, this.hir_id)) {
        return ControlFlow.Break(null);
      }
      return hir.intravisit.walk_expr(this, ex);
    }
  }
  // The immediate HIR parent of the moved expression. We'll look for it to be a call.
  let parent: hir.Expr | undefined;
  // The top-most loop where the moved expression could be moved to a new binding.
  let outer_most_loop: hir.Expr | undefined;
  for (const [, node] of tcx.hir_parent_iter(expr.hir_id)) {
    let e: hir.Expr;
    if (node.$ === "Expr") {
      e = node._0;
    } else if (node.$ === "LetStmt" && node._0.els !== undefined) {
      const els = node._0.els;
      const finder = new BreakFinder([], []);
      finder.visit_block(els);
      if (finder.found_breaks.length !== 0) {
        // Don't suggest clone as it could be will likely end in an infinite
        // loop.
        // let Some(_) = foo(non_copy.clone()) else { break; }
        // ---                       ^^^^^^^^         -----
        can_suggest_clone = false;
      }
      continue;
    } else {
      continue;
    }
    if (local_hir_id !== undefined) {
      const hir_id = local_hir_id;
      if (new Finder(hir_id).visit_expr(e).$ === "Break") {
        // The current scope includes the declaration of the binding we're accessing, we
        // can't look up any further for loops.
        break;
      }
    }
    if (parent === undefined) {
      parent = e;
    }
    switch (e.kind.$) {
      case "Let": {
        const p = tcx.parent_hir_node(e.hir_id);
        if (p.$ === "Expr" && p._0.kind.$ === "If") {
          const cond = p._0.kind._0;
          if (new Finder(expr.hir_id).visit_expr(cond).$ === "Break") {
            // The expression where the move error happened is in a `while let`
            // condition Don't suggest clone as it will likely end in an
            // infinite loop.
            // while let Some(_) = foo(non_copy.clone()) { }
            // ---------                       ^^^^^^^^
            can_suggest_clone = false;
          }
        }
        break;
      }
      case "Loop":
        outer_most_loop = e;
        break;
      default:
        break;
    }
  }
  let loop_count = 0;
  for (const [, node] of tcx.hir_parent_iter(expr.hir_id)) {
    loop_count += node.$ === "Expr" && node._0.kind.$ === "Loop" ? 1 : 0;
  }

  const sm = tcx.sess.source_map();
  if (outer_most_loop !== undefined) {
    const in_loop = outer_most_loop;
    const finder = new BreakFinder([], []);
    finder.visit_expr(in_loop);
    // All of the spans for `break` and `continue` expressions.
    const spans: Span[] = [...finder.found_breaks, ...finder.found_continues]
      .map(([, span]) => span)
      .filter((span) => {
        const dk = SpanC.desugaring_kind(span);
        return !(dk !== undefined && (dk.$ === "ForLoop" || dk.$ === "WhileLoop"));
      });
    // All of the spans for the loops above the expression with the move error.
    const loop_spans: Span[] = [];
    for (const [, node] of tcx.hir_parent_iter(expr.hir_id)) {
      if (node.$ === "Expr" && node._0.kind.$ === "Loop") {
        loop_spans.push(node._0.span);
      }
    }
    // It is possible that a user written `break` or `continue` is in the wrong place. We
    // point them out at the user for them to make a determination. (#92531)
    if (spans.length !== 0 && loop_count > 1) {
      // Getting fancy: if the spans of the loops *do not* overlap, we only use the line
      // number when referring to them. If there *are* overlaps (multiple loops on the
      // same line) then we use the more verbose span output (`file.rs:col:ll`).
      const lines: number[] = loop_spans.map((sp) => sm.lookup_char_pos(SpanC.lo(sp)).line);
      lines.sort((a, b) => a - b);
      // `lines.dedup()`
      const deduped = lines.filter((l, i) => i === 0 || lines[i - 1] !== l);
      const fmt_span = (span: Span): string => {
        if (deduped.length === loop_spans.length) {
          return `line ${sm.lookup_char_pos(SpanC.lo(span)).line}`;
        } else {
          return sm.span_to_diagnostic_string(span);
        }
      };
      const spans_ = MultiSpan.from_Vec(spans);
      // Point at all the `continue`s and explicit `break`s in the relevant loops.
      for (const [desc, elements] of [
        ["`break` exits", finder.found_breaks],
        ["`continue` advances", finder.found_continues],
      ] as const) {
        for (const [destination, sp] of elements) {
          let target: hir.Node;
          let dk: ReturnType<typeof SpanC.desugaring_kind>;
          if (
            destination.target_id.$ === "Ok" &&
            (target = tcx.hir_node(destination.target_id._0)).$ === "Expr" &&
            !((dk = SpanC.desugaring_kind(sp)) !== undefined && (dk.$ === "ForLoop" || dk.$ === "WhileLoop"))
          ) {
            const expr = target._0;
            spans_.push_span_label(sp, `this ${desc} the loop at ${fmt_span(expr.span)}`);
          }
        }
      }
      // Point at all the loops that are between this move and the parent item.
      for (const span of loop_spans) {
        spans_.push_span_context(sm.guess_head_span(span));
      }

      // note: verify that your loop breaking logic is correct
      //   --> $DIR/nested-loop-moved-value-wrong-continue.rs:41:17
      //    |
      // 28 |     for foo in foos {
      // ...
      // 33 |         for bar in &bars {
      // ...
      // 41 |                 continue;
      //    |                 ^^^^^^^^ this `continue` advances the loop at line 33
      err.span_note(spans_, "verify that your loop breaking logic is correct");
    }
    if (parent !== undefined && (parent.kind.$ === "MethodCall" || parent.kind.$ === "Call")) {
      // FIXME: We could check that the call's *parent* takes `&mut val` to make the
      // suggestion more targeted to the `mk_iter(val).next()` case. Maybe do that only to
      // check for whether to suggest `let value` or `let mut value`.

      const span = in_loop.span;
      let value: ReturnType<typeof sm.span_to_snippet>;
      if (finder.found_breaks.length !== 0 && (value = sm.span_to_snippet(parent.span)).$ === "Ok") {
        // We know with high certainty that this move would affect the early return of a
        // loop, so we suggest moving the expression with the move out of the loop.
        const indent_ = sm.indentation_before(span);
        const indent = indent_ !== undefined ? `\n${indent_}` : " ";
        err.multipart_suggestion(
          "consider moving the expression out of the loop so it is only moved once",
          [
            [SpanC.shrink_to_lo(span), `let mut value = ${value._0};${indent}`],
            [parent.span, "value"],
          ],
          "MaybeIncorrect",
        );
      }
    }
  }
  return can_suggest_clone;
};

/// We have `S { foo: val, ..base }`, and we suggest instead writing
/// `S { foo: val, bar: base.bar.clone(), .. }` when valid.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1253 suggest_cloning_on_functional_record_update
MirBorrowckCtxt.prototype.suggest_cloning_on_functional_record_update = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, expr: hir.Expr): void {
  const typeck_results = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
  if (!(expr.kind.$ === "Struct" && expr.kind._2.$ === "Base")) {
    return;
  }
  const struct_qpath = expr.kind._0;
  const fields = expr.kind._1;
  const base = expr.kind._2._0;
  if (struct_qpath.$ !== "Resolved") return;
  const path = struct_qpath._1;
  if (path.res.$ !== "Def") return;
  const def_id = path.res._1;
  const expr_ty = typeck_results.node_type_opt(expr.hir_id);
  if (expr_ty === undefined) return;
  const expr_ty_kind = expr_ty.kind();
  if (expr_ty_kind.$ !== "Adt") return;
  const def = expr_ty_kind._0;
  const args = expr_ty_kind._1;
  if (!(base.kind.$ === "Path" && base.kind._0.$ === "Resolved" && base.kind._0._0 === undefined)) return;
  const base_path = base.kind._0._1;
  const res = base_path.res;
  if (
    !(
      res.$ === "Local" ||
      (res.$ === "Def" && (res._0.$ === "Const" || res._0.$ === "ConstParam" || res._0.$ === "Static" || res._0.$ === "AssocConst"))
    )
  ) {
    return;
  }
  const base_str_r = this.infcx.tcx.sess.source_map().span_to_snippet(base.span);
  if (base_str_r.$ !== "Ok") {
    return;
  }
  const base_str = base_str_r._0;

  // 1. look for the fields of type `ty`.
  // 2. check if they are clone and add them to suggestion
  // 3. check if there are any values left to `..` and remove it if not
  // 4. emit suggestion to clone the field directly as `bar: base.bar.clone()`

  let final_field_count = fields.length;
  const variant = def.variants().find((variant) => DefId_eq(variant.def_id, def_id));
  if (variant === undefined) {
    // When we have an enum, look for the variant that corresponds to the variant the user
    // wrote.
    return;
  }
  const sugg: string[] = [];
  for (const field of variant.fields) {
    // In practice unless there are more than one field with the same type, we'll be
    // suggesting a single field at a type, because we don't aggregate multiple borrow
    // checker errors involving the functional record update syntax into a single one.
    const field_ty = Unnormalized.skip_norm_wip(field.ty(this.infcx.tcx, args));
    const ident = field.ident(this.infcx.tcx);
    if (field_ty === ty && fields.every((field) => field.ident.name !== ident.name)) {
      // Suggest adding field and cloning it.
      sugg.push(`${display_Ident(ident)}: ${base_str}.${display_Ident(ident)}.clone()`);
      final_field_count += 1;
    }
  }
  let span: Span;
  let sugg_: string;
  if (fields.length > 0) {
    const last = fields[fields.length - 1]!;
    span =
      final_field_count === variant.fields.length
        ? // We'll remove the `..base` as there aren't any fields left.
          SpanC.with_hi(SpanC.shrink_to_hi(last.span), SpanC.hi(base.span))
        : SpanC.shrink_to_hi(last.span);
    sugg_ = `, ${sugg.join(", ")}`;
  } else {
    // Account for no fields in suggestion span.
    span = SpanC.with_lo(expr.span, SpanC.hi(hir.QPath.span(struct_qpath)));
    sugg_ =
      final_field_count === variant.fields.length
        ? // We'll remove the `..base` as there aren't any fields left.
          ` { ${sugg.join(", ")} }`
        : ` { ${sugg.join(", ")}, ..${base_str} }`;
  }
  let prefix: string;
  if (!this.implements_clone(ty)) {
    const msg = `\`${display_Ty(ty)}\` doesn't implement \`Copy\` or \`Clone\``;
    const ty_kind = ty.kind();
    if (ty_kind.$ === "Adt") {
      err.span_note(this.infcx.tcx.def_span(ty_kind._0.did()), msg);
    } else {
      err.note(msg);
    }
    prefix = `if \`${display_Ty(ty)}\` implemented \`Clone\`, you could `;
  } else {
    prefix = "";
  }
  const msg = `${prefix}clone the value from the field instead of using the functional record update syntax`;
  err.span_suggestion_verbose(span, msg, sugg_, "MachineApplicable");
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1345 suggest_cloning
MirBorrowckCtxt.prototype.suggest_cloning = function (this: MirBorrowckCtxt, err: Diag, place: PlaceRef, ty: Ty, expr: hir.Expr, use_spans: UseSpans | undefined): void {
  if (expr.kind.$ === "Struct" && expr.kind._2.$ === "Base") {
    // We have `S { foo: val, ..base }`. In `check_aggregate_rvalue` we have a single
    // `Location` that covers both the `S { ... }` literal, all of its fields and the
    // `base`. If the move happens because of `S { foo: val, bar: base.bar }` the `expr`
    //  will already be correct. Instead, we see if we can suggest writing.
    this.suggest_cloning_on_functional_record_update(err, ty, expr);
    return;
  }

  const tcx = this.infcx.tcx;
  const ty_kind = ty.kind();
  let local_did: LocalDefId | undefined;
  let fn_bound_param_span: Span | undefined;
  let clone_trait: DefId | undefined;
  if (this.implements_clone(ty)) {
    if (this.in_move_closure(expr)) {
      const name = this.describe_place(place);
      if (name !== undefined) {
        this.suggest_clone_of_captured_var_in_move_closure(err, name, use_spans);
      }
    } else {
      this.suggest_cloning_inner(err, ty, expr);
    }
  } else if (
    ty_kind.$ === "Adt" &&
    (local_did = ty_kind._0.did().as_local()) !== undefined &&
    ty_kind._0.variants().every((variant) => variant.fields.every((field) => this.implements_clone(Unnormalized.skip_norm_wip(field.ty(tcx, ty_kind._1)))))
  ) {
    const def = ty_kind._0;
    const ty_span = tcx.def_span(def.did());
    const span = MultiSpan.from_Span(ty_span);
    let derive_clone = false;
    tcx.for_each_relevant_impl(unwrap(tcx.lang_items().clone_trait()), ty, (def_id) => {
      if (tcx.is_automatically_derived(def_id)) {
        derive_clone = true;
        span.push_span_label(tcx.def_span(def_id), "derived `Clone` adds implicit bounds on type parameters");
        const generics = tcx.hir_get_generics(local_did!);
        if (generics !== undefined) {
          for (const param of generics.params) {
            if (param.kind.$ === "Type") {
              span.push_span_label(param.span, `introduces an implicit \`${display_Ident(hir.ParamName.ident(param.name))}: Clone\` bound`);
            }
          }
        }
      }
    }, VisitorResultC.unit);
    let msg: string;
    if (!derive_clone) {
      span.push_span_label(ty_span, `consider ${derive_clone ? "manually " : ""}implementing \`Clone\` for this type`);
      msg = `if \`${display_Ty(ty)}\` implemented \`Clone\`, you could clone the value`;
    } else {
      msg = "if all bounds were met, you could clone the value";
    }
    span.push_span_label(expr.span, "you could clone this value");
    err.span_note(span, msg);
    if (derive_clone) {
      err.help("consider manually implementing `Clone` to avoid undesired bounds");
    }
  } else if (
    ty_kind.$ === "Param" &&
    tcx.lang_items().clone_trait() !== undefined &&
    ((fn_bound_param_span = tcx.def_span((tcx.generics_of(this.mir_def_id()) as Generics).type_param(ty_kind._0, tcx).def_id)), true) &&
    (use_spans !== undefined &&
    use_spans.$ === "FnSelfUse" &&
    use_spans.kind.$ === "FnCall" &&
    use_spans.kind.self_ty.kind().$ === "Param" &&
    ty === use_spans.kind.self_ty &&
    tcx.fn_trait_kind_from_def_id(use_spans.kind.fn_trait_id) !== undefined
      ? // Do not suggest `F: FnOnce() + Clone`.
        false
      : true)
  ) {
    const param_span = fn_bound_param_span;
    const span = MultiSpan.from_Span(param_span);
    span.push_span_label(param_span, "consider constraining this type parameter with `Clone`");
    span.push_span_label(expr.span, "you could clone this value");
    err.span_help(span, `if \`${display_Ty(ty)}\` implemented \`Clone\`, you could clone the value`);
  } else if (ty_kind.$ === "Adt" && (clone_trait = tcx.lang_items().clone_trait()) !== undefined) {
    // For cases like `Option<NonClone>`, where `Option<T>: Clone` if `T: Clone`, we point
    // at the types that should be `Clone`.
    const clone_trait_ = clone_trait;
    const ocx = ObligationCtxt.new_with_diagnostics(this.infcx.infcx);
    const cause = ObligationCause.misc(expr.span, this.mir_def_id());
    ocx.register_bound(cause, this.infcx.param_env, ty, clone_trait_);
    const errors = ocx.evaluate_obligations_error_on_ambiguity();
    if (
      errors.$ === "HasErrors" &&
      errors._0.every((error) => {
        const c = error.obligation.predicate.as_clause();
        const clause = c === undefined ? undefined : c.as_trait_clause();
        if (clause !== undefined) {
          const k = TraitClause.self_ty(BinderC.skip_binder(clause)).kind();
          if (k.$ === "Adt") {
            return k._0.did().is_local() && DefId_eq(PolyTraitClause.def_id(clause), clone_trait_);
          } else {
            return false;
          }
        } else {
          return false;
        }
      })
    ) {
      const type_spans: Span[] = [];
      // PORT: `FxIndexSet<String>` (insertion order kept).
      const types = new Set<string>();
      for (const e of errors._0) {
        const c = e.obligation.predicate.as_clause();
        if (c === undefined) continue;
        const clause = c.as_trait_clause();
        if (clause === undefined) continue;
        const self_ty = TraitClause.self_ty(BinderC.skip_binder(clause));
        const k = self_ty.kind();
        if (k.$ !== "Adt") continue;
        type_spans.push(tcx.def_span(k._0.did()));
        types.add(tcx.short_string(self_ty, err.long_ty_path(), print_Ty));
      }
      const span = MultiSpan.from_Vec([...type_spans]);
      for (const sp of type_spans) {
        span.push_span_label(sp, "consider implementing `Clone` for this type");
      }
      span.push_span_label(expr.span, "you could clone this value");
      const types_: string[] = [...types];
      let msg: string;
      if (types_.length === 1) {
        msg = `\`${types_[0]!}\``;
      } else if (types_.length > 1) {
        const head = types_.slice(0, -1);
        const last = types_[types_.length - 1]!;
        msg = `${head.map((t) => `\`${t}\``).join(", ")} and \`${last}\``;
      } else {
        return unreachable();
      }
      err.span_note(span, `if ${msg} implemented \`Clone\`, you could clone the value`);
    }
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1510 implements_clone
MirBorrowckCtxt.prototype.implements_clone = function (this: MirBorrowckCtxt, ty: Ty): boolean {
  const clone_trait_def = this.infcx.tcx.lang_items().clone_trait();
  if (clone_trait_def === undefined) return false;
  return EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(clone_trait_def, [GenericArg.from_Ty(ty)], this.infcx.param_env));
};

/// Given an expression, check if it is a method call `foo.clone()`, where `foo` and
/// `foo.clone()` both have the same type, returning the span for `.clone()` if so.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1519 clone_on_reference
MirBorrowckCtxt.prototype.clone_on_reference = function (this: MirBorrowckCtxt, expr: hir.Expr): Span | undefined {
  const typeck_results = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
  let expr_ty: Ty | undefined;
  let rcvr_ty: Ty | undefined;
  if (
    expr.kind.$ === "MethodCall" &&
    (expr_ty = typeck_results.node_type_opt(expr.hir_id)) !== undefined &&
    (rcvr_ty = typeck_results.node_type_opt(expr.kind._1.hir_id)) !== undefined &&
    rcvr_ty === expr_ty &&
    expr.kind._0.ident.name === sym.clone &&
    expr.kind._2.length === 0
  ) {
    return expr.kind._3;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1534 in_move_closure
MirBorrowckCtxt.prototype.in_move_closure = function (this: MirBorrowckCtxt, expr: hir.Expr): boolean {
  for (const [, node] of this.infcx.tcx.hir_parent_iter(expr.hir_id)) {
    if (node.$ === "Expr" && node._0.kind.$ === "Closure" && node._0.kind._0.capture_clause.$ === "Value") {
      // `move || x.clone()` will not work. FIXME: suggest `let y = x.clone(); move || y`
      return true;
    }
  }
  return false;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1546 suggest_cloning_inner
MirBorrowckCtxt.prototype.suggest_cloning_inner = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, expr: hir.Expr): boolean {
  const tcx = this.infcx.tcx;

  // Don't suggest `.clone()` in a derive macro expansion.
  const expn_kind = SyntaxContext.outer_expn_data(SpanC.ctxt(this.body.span)).kind;
  if (expn_kind.$ === "Macro" && expn_kind._0 === "Derive") {
    return false;
  }
  if (this.clone_on_reference(expr) !== undefined) {
    // Avoid redundant clone suggestion already suggested in `explain_captures`.
    // See `tests/ui/moves/needs-clone-through-deref.rs`
    return false;
  }
  // We don't want to suggest `.clone()` in a move closure, since the value has already been
  // captured.
  if (this.in_move_closure(expr)) {
    return false;
  }
  // We also don't want to suggest cloning a closure itself, since the value has already been
  // captured.
  if (expr.kind.$ === "Closure") {
    return false;
  }
  // Try to find predicates on *generic params* that would allow copying `ty`
  const symbol = tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
  let suggestion = symbol !== undefined ? `: ${display_Symbol(symbol)}.clone()` : ".clone()";
  const sugg: [Span, string][] = [];
  let inner_expr = expr;
  let is_raw_ptr = false;
  const typeck_result = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
  // Remove uses of `&` and `*` when suggesting `.clone()`.
  for (;;) {
    let inner: hir.Expr;
    if (inner_expr.kind.$ === "AddrOf") {
      inner = inner_expr.kind._2;
    } else if (inner_expr.kind.$ === "Unary" && inner_expr.kind._0 === "Deref") {
      inner = inner_expr.kind._1;
    } else {
      break;
    }
    if (inner_expr.kind.$ === "AddrOf" && inner_expr.kind._1 === "Mut") {
      // We assume that `&mut` refs are desired for their side-effects, so cloning the
      // value wouldn't do what the user wanted.
      return false;
    }
    inner_expr = inner;
    const inner_type = typeck_result.node_type_opt(inner.hir_id);
    if (inner_type !== undefined) {
      if (inner_type.kind().$ === "RawPtr") {
        is_raw_ptr = true;
        break;
      }
    }
  }
  // Cloning the raw pointer doesn't make sense in some cases and would cause a type mismatch
  // error. (see #126863)
  if (SpanC.lo(inner_expr.span) !== SpanC.lo(expr.span) && !is_raw_ptr) {
    // Remove "(*" or "(&"
    sugg.push([SpanC.with_hi(expr.span, SpanC.lo(inner_expr.span)), ""]);
  }
  // Check whether `expr` is surrounded by parentheses or not.
  let span: Span;
  if (SpanC.hi(inner_expr.span) !== SpanC.hi(expr.span)) {
    // Account for `(*x)` to suggest `x.clone()`.
    if (is_raw_ptr) {
      span = SpanC.shrink_to_hi(expr.span);
    } else {
      // Remove the close parenthesis ")"
      span = SpanC.with_lo(expr.span, SpanC.hi(inner_expr.span));
    }
  } else {
    if (is_raw_ptr) {
      sugg.push([SpanC.shrink_to_lo(expr.span), "("]);
      suggestion = ").clone()";
    }
    span = SpanC.shrink_to_hi(expr.span);
  }
  sugg.push([span, suggestion]);
  const ty_kind = ty.kind();
  let msg: string;
  if (ty_kind.$ === "Adt" && [tcx.get_diagnostic_item(sym.Arc), tcx.get_diagnostic_item(sym.Rc)].some((d) => option_DefId_eq(d, ty_kind._0.did()))) {
    msg = "clone the value to increment its reference count";
  } else {
    msg = "consider cloning the value if the performance cost is acceptable";
  }
  err.multipart_suggestion(msg, sugg, "MachineApplicable");
  return true;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1637 suggest_adding_bounds
MirBorrowckCtxt.prototype.suggest_adding_bounds = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, def_id: DefId, span: Span): void {
  const tcx = this.infcx.tcx;
  const generics = tcx.generics_of(this.mir_def_id()) as Generics;

  const hir_generics = tcx.hir_get_generics(tcx.typeck_root_def_id_local(this.mir_def_id()));
  if (hir_generics === undefined) {
    return;
  }
  // Try to find predicates on *generic params* that would allow copying `ty`
  const ocx = ObligationCtxt.new_with_diagnostics(this.infcx.infcx);
  const cause = ObligationCause.misc(span, this.mir_def_id());

  ocx.register_bound(cause, this.infcx.param_env, ty, def_id);
  const errors = ocx.evaluate_obligations_error_on_ambiguity();

  // Only emit suggestion if all required predicates are on generic
  // PORT: `.map(..).collect::<Result<Vec<_>, ()>>()` stops at the first `Err` (`undefined` here).
  let predicates: [GenericParamDef, string, DefId | undefined][] | undefined = [];
  for (const err of TraitErrors.into_iter_ref(errors)) {
    const pk = BinderC.skip_binder(err.obligation.predicate.kind());
    if (pk.$ === "Clause" && pk._0.$ === "Trait") {
      const predicate = pk._0._0;
      const self_kind = TraitClause.self_ty(predicate).kind();
      if (self_kind.$ === "Param") {
        predicates.push([
          generics.type_param(self_kind._0, tcx),
          display_TraitRefPrintSugared(TraitRef_print_trait_sugared(predicate.trait_ref)),
          predicate.trait_ref.def_id,
        ]);
        continue;
      }
    }
    predicates = undefined;
    break;
  }

  if (predicates !== undefined) {
    suggest_constraining_type_params(
      tcx,
      hir_generics,
      err,
      predicates.map(([param, constraint, def_id]) => [SymbolC.as_str(param.name), constraint, def_id] as const),
      undefined,
    );
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1684 report_move_out_while_borrowed
MirBorrowckCtxt.prototype.report_move_out_while_borrowed = function (this: MirBorrowckCtxt, location: Location, [place, span_]: [Place, Span], borrow: BorrowData): void {
  // debug!(
  //     "report_move_out_while_borrowed: location={:?} place={:?} span={:?} borrow={:?}",
  //     location, place, span, borrow
  // );
  const value_msg = this.describe_any_place(place.as_ref());
  const borrow_msg = this.describe_any_place(borrow.borrowed_place.as_ref());

  const borrow_spans = this.retrieve_borrow_spans(borrow);
  const borrow_span = UseSpansC.args_or_use(borrow_spans);

  const move_spans = this.move_spans(place.as_ref(), location);
  const span = UseSpansC.args_or_use(move_spans);

  const err = this.cannot_move_when_borrowed(span, borrow_span, this.describe_any_place(place.as_ref()), borrow_msg, value_msg);
  this.note_due_to_edition_2024_opaque_capture_rules(borrow, err);

  UseSpansC.var_path_only_subdiag(borrow_spans, err, "Borrow");

  UseSpansC.var_subdiag(move_spans, err, undefined, (kind, var_span): CaptureVarCause => {
    // use crate::session_diagnostics::CaptureVarCause::*;
    switch (kind.$) {
      case "Coroutine":
        return { $: "MoveUseInCoroutine", var_span };
      case "Closure":
      case "CoroutineClosure":
        return { $: "MoveUseInClosure", var_span };
    }
  });

  BorrowExplanationC.add_explanation_to_diagnostic(this.explain_why_borrow_contains_point(location, borrow, undefined), this, err, "", borrow_span, undefined);
  this.suggest_copy_for_type_in_cloned_ref(err, place);
  const typeck_results = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
  const expr = this.find_expr(borrow_span);
  if (expr !== undefined) {
    // This is a borrow span, so we want to suggest cloning the referent.
    let ty: Ty | undefined;
    if (expr.kind.$ === "AddrOf" && (ty = typeck_results.expr_ty_opt(expr.kind._2)) !== undefined) {
      const borrowed_expr = expr.kind._2;
      this.suggest_cloning(err, place.as_ref(), ty, borrowed_expr, move_spans);
    } else {
      const first = typeck_results.expr_adjustments(expr)[0];
      if (
        first !== undefined &&
        first.kind.$ === "Borrow" &&
        first.kind._0.$ === "Ref" &&
        (first.kind._0._0.$ === "Not" || (first.kind._0._0.$ === "Mut" && first.kind._0._0.allow_two_phase_borrow === "No")) &&
        (ty = typeck_results.expr_ty_opt(expr)) !== undefined
      ) {
        this.suggest_cloning(err, place.as_ref(), ty, expr, move_spans);
      }
    }
  }
  this.buffer_error(err);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1752 report_use_while_mutably_borrowed
MirBorrowckCtxt.prototype.report_use_while_mutably_borrowed = function (this: MirBorrowckCtxt, location: Location, [place, _span]: [Place, Span], borrow: BorrowData): Diag {
  const borrow_spans = this.retrieve_borrow_spans(borrow);
  const borrow_span = UseSpansC.args_or_use(borrow_spans);

  // Conflicting borrows are reported separately, so only check for move
  // captures.
  const use_spans = this.move_spans(place.as_ref(), location);
  const span = UseSpansC.var_or_use(use_spans);

  // If the attempted use is in a closure then we do not care about the path span of the
  // place we are currently trying to use we call `var_span_label` on `borrow_spans` to
  // annotate if the existing borrow was in a closure.
  const err = this.cannot_use_when_mutably_borrowed(span, this.describe_any_place(place.as_ref()), borrow_span, this.describe_any_place(borrow.borrowed_place.as_ref()));
  this.note_due_to_edition_2024_opaque_capture_rules(borrow, err);

  UseSpansC.var_subdiag(borrow_spans, err, borrow.kind, (kind, var_span): CaptureVarCause => {
    // use crate::session_diagnostics::CaptureVarCause::*;
    const place = borrow.borrowed_place;
    const desc_place = this.describe_any_place(place.as_ref());
    switch (kind.$) {
      case "Coroutine":
        return { $: "BorrowUsePlaceCoroutine", place: desc_place, var_span, is_single_var: true };
      case "Closure":
      case "CoroutineClosure":
        return { $: "BorrowUsePlaceClosure", place: desc_place, var_span, is_single_var: true };
    }
  });

  BorrowExplanationC.add_explanation_to_diagnostic(this.explain_why_borrow_contains_point(location, borrow, undefined), this, err, "", undefined, undefined);
  return err;
};

/** `BorrowKind::Shared | BorrowKind::Fake(FakeBorrowKind::Deep)` */
function bk_is_shared_or_deep(k: BorrowKind): boolean {
  return k.$ === "Shared" || (k.$ === "Fake" && k._0 === "Deep");
}
/** `BorrowKind::Mut { kind: MutBorrowKind::Default | MutBorrowKind::TwoPhaseBorrow }` */
function bk_is_mut_default_or_two_phase(k: BorrowKind): boolean {
  return k.$ === "Mut" && (k.kind === "Default" || k.kind === "TwoPhaseBorrow");
}
/** `BorrowKind::Mut { kind: MutBorrowKind::ClosureCapture }` */
function bk_is_mut_closure_capture(k: BorrowKind): boolean {
  return k.$ === "Mut" && k.kind === "ClosureCapture";
}

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1796 report_conflicting_borrow
MirBorrowckCtxt.prototype.report_conflicting_borrow = function (
  this: MirBorrowckCtxt,
  location: Location,
  [place, span_]: [Place, Span],
  gen_borrow_kind: BorrowKind,
  issued_borrow: BorrowData,
): Diag {
  const issued_spans = this.retrieve_borrow_spans(issued_borrow);
  const issued_span = UseSpansC.args_or_use(issued_spans);

  const borrow_spans = this.borrow_spans(span_, location);
  const span = UseSpansC.args_or_use(borrow_spans);

  const container_name = UseSpansC.for_coroutine(issued_spans) || UseSpansC.for_coroutine(borrow_spans) ? "coroutine" : "closure";

  const [desc_place, msg_place, msg_borrow, union_type_name] = this.describe_place_for_conflicting_borrow(place, issued_borrow.borrowed_place);

  const explanation = this.explain_why_borrow_contains_point(location, issued_borrow, undefined);
  const second_borrow_desc = BorrowExplanationC.is_explained(explanation) ? "second " : "";

  // FIXME: supply non-"" `opt_via` when appropriate
  let first_borrow_desc: string;
  let err: Diag;
  // PORT: the `match (gen_borrow_kind, issued_borrow.kind)` is an if-chain in upstream arm order.
  const g = gen_borrow_kind;
  const i = issued_borrow.kind;
  if (bk_is_shared_or_deep(g) && bk_is_mut_default_or_two_phase(i)) {
    first_borrow_desc = "mutable ";
    const err_ = this.cannot_reborrow_already_borrowed(span, desc_place, msg_place, "immutable", issued_span, "it", "mutable", msg_borrow, undefined);
    this.suggest_slice_method_if_applicable(err_, place, issued_borrow.borrowed_place, span, issued_span);
    err = err_;
  } else if (bk_is_mut_default_or_two_phase(g) && bk_is_shared_or_deep(i)) {
    first_borrow_desc = "immutable ";
    const err_ = this.cannot_reborrow_already_borrowed(span, desc_place, msg_place, "mutable", issued_span, "it", "immutable", msg_borrow, undefined);
    this.suggest_slice_method_if_applicable(err_, place, issued_borrow.borrowed_place, span, issued_span);
    this.suggest_binding_for_closure_capture_self(err_, issued_spans);
    this.suggest_using_closure_argument_instead_of_capture(err_, issued_borrow.borrowed_place, issued_spans);
    this.explain_iterator_invalidation_in_for_loop_if_applicable(err_, issued_spans, place, issued_borrow.borrowed_place, issued_borrow.kind, span);
    err = err_;
  } else if (bk_is_mut_default_or_two_phase(g) && bk_is_mut_default_or_two_phase(i)) {
    first_borrow_desc = "first ";
    const err_ = this.cannot_mutably_borrow_multiply(span, desc_place, msg_place, issued_span, msg_borrow, undefined);
    this.suggest_slice_method_if_applicable(err_, place, issued_borrow.borrowed_place, span, issued_span);
    this.explain_iterator_invalidation_in_for_loop_if_applicable(err_, issued_spans, place, issued_borrow.borrowed_place, issued_borrow.kind, span);
    this.suggest_using_closure_argument_instead_of_capture(err_, issued_borrow.borrowed_place, issued_spans);
    this.explain_iterator_advancement_in_for_loop_if_applicable(err_, span, issued_spans);
    err = err_;
  } else if (bk_is_mut_closure_capture(g) && bk_is_mut_closure_capture(i)) {
    first_borrow_desc = "first ";
    err = this.cannot_uniquely_borrow_by_two_closures(span, desc_place, issued_span, undefined);
  } else if (g.$ === "Mut" && i.$ === "Fake" && i._0 === "Shallow") {
    const immutable_section_description = this.classify_immutable_section(issued_borrow.assigned_place);
    if (immutable_section_description !== undefined) {
      const err_ = this.cannot_mutate_in_immutable_section(span, issued_span, desc_place, immutable_section_description, "mutably borrow");
      UseSpansC.var_subdiag(borrow_spans, err_, { $: "Mut", kind: "ClosureCapture" }, (kind, var_span): CaptureVarCause => {
        // use crate::session_diagnostics::CaptureVarCause::*;
        switch (kind.$) {
          case "Coroutine":
            return { $: "BorrowUsePlaceCoroutine", place: desc_place, var_span, is_single_var: true };
          case "Closure":
          case "CoroutineClosure":
            return { $: "BorrowUsePlaceClosure", place: desc_place, var_span, is_single_var: true };
        }
      });
      return err_;
    } else {
      first_borrow_desc = "immutable ";
      err = this.cannot_reborrow_already_borrowed(span, desc_place, msg_place, "mutable", issued_span, "it", "immutable", msg_borrow, undefined);
    }
  } else if (bk_is_mut_closure_capture(g)) {
    first_borrow_desc = "first ";
    err = this.cannot_uniquely_borrow_by_one_closure(span, container_name, desc_place, "", issued_span, "it", "", undefined);
  } else if (bk_is_shared_or_deep(g) && bk_is_mut_closure_capture(i)) {
    first_borrow_desc = "first ";
    err = this.cannot_reborrow_already_uniquely_borrowed(span, container_name, desc_place, "", "immutable", issued_span, "", undefined, second_borrow_desc);
  } else if (g.$ === "Mut" && bk_is_mut_closure_capture(i)) {
    first_borrow_desc = "first ";
    err = this.cannot_reborrow_already_uniquely_borrowed(span, container_name, desc_place, "", "mutable", issued_span, "", undefined, second_borrow_desc);
  } else {
    // (Shared | Fake(Deep), Shared | Fake(_)) | (Fake(Shallow), Mut { .. } | Shared | Fake(_))
    return unreachable();
  }
  this.note_due_to_edition_2024_opaque_capture_rules(issued_borrow, err);

  if (UseSpans_eq(issued_spans, borrow_spans)) {
    UseSpansC.var_subdiag(borrow_spans, err, gen_borrow_kind, (kind, var_span): CaptureVarCause => {
      // use crate::session_diagnostics::CaptureVarCause::*;
      switch (kind.$) {
        case "Coroutine":
          return { $: "BorrowUsePlaceCoroutine", place: desc_place, var_span, is_single_var: false };
        case "Closure":
        case "CoroutineClosure":
          return { $: "BorrowUsePlaceClosure", place: desc_place, var_span, is_single_var: false };
      }
    });
  } else {
    UseSpansC.var_subdiag(issued_spans, err, issued_borrow.kind, (kind, var_span): CaptureVarCause => {
      // use crate::session_diagnostics::CaptureVarCause::*;
      const borrow_place = issued_borrow.borrowed_place;
      const borrow_place_desc = this.describe_any_place(borrow_place.as_ref());
      switch (kind.$) {
        case "Coroutine":
          return { $: "FirstBorrowUsePlaceCoroutine", place: borrow_place_desc, var_span };
        case "Closure":
        case "CoroutineClosure":
          return { $: "FirstBorrowUsePlaceClosure", place: borrow_place_desc, var_span };
      }
    });

    UseSpansC.var_subdiag(borrow_spans, err, gen_borrow_kind, (kind, var_span): CaptureVarCause => {
      // use crate::session_diagnostics::CaptureVarCause::*;
      switch (kind.$) {
        case "Coroutine":
          return { $: "SecondBorrowUsePlaceCoroutine", place: desc_place, var_span };
        case "Closure":
        case "CoroutineClosure":
          return { $: "SecondBorrowUsePlaceClosure", place: desc_place, var_span };
      }
    });
  }

  if (union_type_name !== "") {
    err.note(`${msg_place} is a field of the union \`${union_type_name}\`, so it overlaps the field ${msg_borrow}`);
  }

  BorrowExplanationC.add_explanation_to_diagnostic(explanation, this, err, first_borrow_desc, undefined, [issued_span, span]);

  this.suggest_using_local_if_applicable(err, location, issued_borrow, explanation);
  this.suggest_copy_for_type_in_cloned_ref(err, place);

  return err;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2108 suggest_copy_for_type_in_cloned_ref
MirBorrowckCtxt.prototype.suggest_copy_for_type_in_cloned_ref = function (this: MirBorrowckCtxt, err: Diag, place: Place): void {
  const tcx = this.infcx.tcx;
  const body_id = hir.Node.body_id(tcx.hir_node(this.mir_hir_id()));
  if (body_id === undefined) return;

  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2112 FindUselessClone
  class FindUselessClone extends hir.intravisit.Visitor {
    constructor(
      public tcx: TyCtxt,
      public typeck_results: TypeckResults,
      public clones: hir.Expr[],
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2118 new
    static new(tcx: TyCtxt, def_id: LocalDefId): FindUselessClone {
      return new FindUselessClone(tcx, tcx.typeck(def_id) as TypeckResults, []);
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2123 visit_expr
    override visit_expr(ex: hir.Expr): undefined {
      let method_def_id: DefId | undefined;
      if (
        ex.kind.$ === "MethodCall" &&
        (method_def_id = this.typeck_results.type_dependent_def_id(ex.hir_id)) !== undefined &&
        this.tcx.is_lang_item(this.tcx.parent(method_def_id), LangItem.Clone)
      ) {
        this.clones.push(ex);
      }
      hir.intravisit.walk_expr(this, ex);
      return undefined;
    }
  }

  const expr_finder = FindUselessClone.new(tcx, this.mir_def_id());

  const body = tcx.hir_body(body_id).value;
  expr_finder.visit_expr(body);

  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2140 Holds
  class Holds implements TypeVisitor<ControlFlow<null>> {
    /** `impl TypeVisitor`: `type Result = std::ops::ControlFlow<()>`. */
    readonly Result: VisitorResult<ControlFlow<null>, null> = VisitorResultC.ControlFlow<null>();

    constructor(public ty: Ty) {}

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2147 visit_ty
    visit_ty(t: Ty): ControlFlow<null> {
      if (t === this.ty) {
        return ControlFlow.Break(null);
      }
      return fold_Ty.super_visit_with(t, this);
    }

    // (provided) the methods `Holds` does not override.
    visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
      return TypeVisitor_provided.visit_binder(this, t, d);
    }
    visit_region(r: Region): ControlFlow<null> {
      return TypeVisitor_provided.visit_region(this, r);
    }
    visit_const(c: Const): ControlFlow<null> {
      return TypeVisitor_provided.visit_const(this, c);
    }
    visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
      return TypeVisitor_provided.visit_predicate(this, p, d);
    }
    visit_clauses(c: Clauses): ControlFlow<null> {
      return TypeVisitor_provided.visit_clauses(this, c);
    }
    visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
      return TypeVisitor_provided.visit_error(this, guar);
    }
  }

  // PORT: `FxIndexSet<Ty>`: interned, insertion order kept.
  const types_to_constrain = new Set<Ty>();

  const local_ty = this.body.local_decls[place.local]!.ty;
  const typeck_results = tcx.typeck(this.mir_def_id()) as TypeckResults;
  const clone = tcx.require_lang_item(LangItem.Clone, body.span);
  for (const expr of expr_finder.clones) {
    let rcvr_ty: Ty | undefined;
    let ty: Ty | undefined;
    let rcvr_kind: ReturnType<Ty["kind"]>;
    let inner: Ty;
    if (
      expr.kind.$ === "MethodCall" &&
      (rcvr_ty = typeck_results.node_type_opt(expr.kind._1.hir_id)) !== undefined &&
      (ty = typeck_results.node_type_opt(expr.hir_id)) !== undefined &&
      rcvr_ty === ty &&
      (rcvr_kind = rcvr_ty.kind()).$ === "Ref" &&
      ((inner = rcvr_kind._1.peel_refs()), true) &&
      new Holds(inner).visit_ty(local_ty).$ === "Break" &&
      this.infcx.type_implements_trait_shallow(clone, inner, this.infcx.param_env) === undefined
    ) {
      const span = expr.kind._3;
      err.span_label(span, `this call doesn't do anything, the result is still \`${display_Ty(rcvr_ty)}\` because \`${display_Ty(inner)}\` doesn't implement \`Clone\``);
      types_to_constrain.add(inner);
    }
  }
  for (const ty of types_to_constrain) {
    this.suggest_adding_bounds_or_derive(err, ty, clone, body.span);
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2186 suggest_adding_bounds_or_derive
MirBorrowckCtxt.prototype.suggest_adding_bounds_or_derive = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, trait_def_id: DefId, span: Span): void {
  this.suggest_adding_bounds(err, ty, trait_def_id, span);
  if (ty.kind().$ === "Adt") {
    // The type doesn't implement the trait.
    const trait_ref = BinderC.dummy(TraitRef.new(as_interner(this.infcx.tcx), trait_def_id, [GenericArg.from_Ty(ty)]), d_TraitRef);
    const obligation = new Obligation(ObligationCause.dummy(), this.infcx.param_env, Predicate_upcast_from_PolyTraitRef(trait_ref, this.infcx.tcx), 0);
    this.infcx.err_ctxt().suggest_derive(obligation, err, PolyTraitClause.upcast_from_PolyTraitRef(trait_ref, as_interner(this.infcx.tcx)));
  }
};

// #[instrument(level = "debug", skip(self, err))]
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2213 suggest_using_local_if_applicable
MirBorrowckCtxt.prototype.suggest_using_local_if_applicable = function (
  this: MirBorrowckCtxt,
  err: Diag,
  location: Location,
  issued_borrow: BorrowData,
  explanation: BorrowExplanation,
): void {
  const used_in_call = explanation.$ === "UsedLater" && (explanation._1 === "Call" || explanation._1 === "Other");
  if (!used_in_call) {
    // debug!("not later used in call");
    return;
  }
  if (this.body.local_decls[issued_borrow.borrowed_place.local]!.local_info_().$ === "IfThenRescopeTemp") {
    // A better suggestion will be issued by the `if_let_rescope` lint
    return;
  }

  const use_span = explanation.$ === "UsedLater" && explanation._1 === "Other" ? explanation._2 : undefined;

  const outer_call_loc = issued_borrow.activation_location.$ === "ActivatedAt" ? issued_borrow.activation_location._0 : issued_borrow.reserve_location;
  const outer_call_stmt = this.body.stmt_at(outer_call_loc);

  const inner_param_location = location;
  const inner_param_stmt_e = this.body.stmt_at(inner_param_location);
  if (inner_param_stmt_e.$ !== "Left") {
    // debug!("`inner_param_location` {:?} is not for a statement", inner_param_location);
    return;
  }
  const inner_param_stmt = inner_param_stmt_e._0;
  const assign = StatementKind.as_assign(inner_param_stmt.kind);
  if (assign === undefined) {
    // debug!(
    //     "`inner_param_location` {:?} is not for an assignment: {:?}",
    //     inner_param_location, inner_param_stmt
    // );
    return;
  }
  const inner_param = assign[0];
  // PORT: `BTreeSet<Location>` iterated in key order.
  const inner_param_uses = [...find_all_local_uses_find(this.body, inner_param.local)].sort((a, b) =>
    a.block !== b.block ? a.block - b.block : a.statement_index - b.statement_index,
  );
  let found: [Location, Terminator] | undefined;
  for (const loc of inner_param_uses) {
    const e = this.body.stmt_at(loc);
    if (e.$ !== "Right") {
      // debug!("{:?} is a statement, so it can't be a call", loc);
      continue;
    }
    const term = e._0;
    if (term.kind.$ !== "Call") {
      // debug!("not a call: {:?}", term);
      continue;
    }
    const args = term.kind.args;
    // debug!("checking call args for uses of inner_param: {:?}", args);
    if (args.map((a) => a.node).some((a: Operand) => a.$ === "Move" && Place_eq(a._0, inner_param))) {
      found = [loc, term];
      break;
    }
  }
  if (found === undefined) {
    // debug!("no uses of inner_param found as a by-move call arg");
    return;
  }
  const [_inner_call_loc, inner_call_term] = found;
  // debug!("===> outer_call_loc = {:?}, inner_call_loc = {:?}", outer_call_loc, inner_call_loc);

  const inner_call_span = inner_call_term.source_info.span;
  const outer_call_span = use_span !== undefined ? use_span : (outer_call_stmt.$ === "Left" ? outer_call_stmt._0.source_info : outer_call_stmt._0.source_info).span;
  if (outer_call_span === inner_call_span || !SpanC.contains(outer_call_span, inner_call_span)) {
    // FIXME: This stops the suggestion in some cases where it should be emitted.
    //        Fix the spans for those cases so it's emitted correctly.
    // debug!(
    //     "outer span {:?} does not strictly contain inner span {:?}",
    //     outer_call_span, inner_call_span
    // );
    return;
  }
  err.span_help(inner_call_span, `try adding a local storing this${use_span !== undefined ? "" : " argument"}...`);
  err.span_help(outer_call_span, `...and then using that local ${use_span !== undefined ? "here" : "as the argument to this call"}`);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2322 find_expr
MirBorrowckCtxt.prototype.find_expr = function (this: MirBorrowckCtxt, span: Span): hir.Expr | undefined {
  const tcx = this.infcx.tcx;
  const body_id = hir.Node.body_id(tcx.hir_node(this.mir_hir_id()));
  if (body_id === undefined) return undefined;
  const expr_finder = FindExprBySpan.new(span, tcx);
  expr_finder.visit_expr(tcx.hir_body(body_id).value);
  return expr_finder.result;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2330 suggest_slice_method_if_applicable
MirBorrowckCtxt.prototype.suggest_slice_method_if_applicable = function (
  this: MirBorrowckCtxt,
  err: Diag,
  place: Place,
  borrowed_place: Place,
  span: Span,
  issued_span: Span,
): void {
  const tcx = this.infcx.tcx;

  const has_split_at_mut = (ty_: Ty): boolean => {
    const ty = ty_.peel_refs();
    const k = ty.kind();
    if (k.$ === "Array" || k.$ === "Slice") {
      return true;
    } else if (k.$ === "Adt" && option_DefId_eq(tcx.get_diagnostic_item(sym.Vec), k._0.did())) {
      return true;
    } else if (ty === tcx.types.str_) {
      return true;
    } else {
      return false;
    }
  };
  const p1 = place.projection;
  const p2 = borrowed_place.projection;
  let index1_: Local | undefined;
  let index2_: Local | undefined;
  if (p1.length === 1 && p1[0]!.$ === "Index" && p2.length === 1 && p2[0]!.$ === "Index") {
    index1_ = p1[0]!._0;
    index2_ = p2[0]!._0;
  } else if (p1.length === 2 && p1[0]!.$ === "Deref" && p1[1]!.$ === "Index" && p2.length === 2 && p2[0]!.$ === "Deref" && p2[1]!.$ === "Index") {
    index1_ = p1[1]!._0;
    index2_ = p2[1]!._0;
  }
  if (index1_ !== undefined && index2_ !== undefined) {
    const decl1 = this.body.local_decls[index1_]!;
    const decl2 = this.body.local_decls[index2_]!;

    const note_default_suggestion = (): void => {
      err
        .help("consider using `.split_at_mut(position)` or similar method to obtain two mutable non-overlapping sub-slices")
        .help("consider using `.swap(index_1, index_2)` to swap elements at the specified indices");
    };

    const index1 = this.find_expr(decl1.source_info.span);
    if (index1 === undefined) {
      note_default_suggestion();
      return;
    }

    const index2 = this.find_expr(decl2.source_info.span);
    if (index2 === undefined) {
      note_default_suggestion();
      return;
    }

    const sm = tcx.sess.source_map();

    const index1_str = sm.span_to_snippet(index1.span);
    if (index1_str.$ !== "Ok") {
      note_default_suggestion();
      return;
    }

    const index2_str = sm.span_to_snippet(index2.span);
    if (index2_str.$ !== "Ok") {
      note_default_suggestion();
      return;
    }

    let object: hir.Expr | undefined;
    for (const id of tcx.hir_parent_id_iter(index1.hir_id)) {
      const node = tcx.hir_node(id);
      if (node.$ === "Expr" && node._0.kind.$ === "Index") {
        object = node._0.kind._0;
        break;
      }
    }
    if (object === undefined) {
      note_default_suggestion();
      return;
    }

    const obj_str = sm.span_to_snippet(object.span);
    if (obj_str.$ !== "Ok") {
      note_default_suggestion();
      return;
    }

    let swap_call: hir.Expr | undefined;
    for (const id of tcx.hir_parent_id_iter(object.hir_id)) {
      const node = tcx.hir_node(id);
      if (
        node.$ === "Expr" &&
        node._0.kind.$ === "Call" &&
        node._0.kind._0.kind.$ === "Path" &&
        node._0.kind._0.kind._0.$ === "Resolved" &&
        node._0.kind._0.kind._0._0 === undefined &&
        node._0.kind._0.kind._0._1.res.$ === "Def" &&
        tcx.is_diagnostic_item(sym.mem_swap, node._0.kind._0.kind._0._1.res._1)
      ) {
        swap_call = node._0;
        break;
      }
    }
    if (swap_call === undefined) {
      const parent1 = tcx.parent_hir_node(index1.hir_id);
      if (parent1.$ !== "Expr") return;
      if (parent1._0.kind.$ !== "Index") return;
      const idx1 = parent1._0.kind._1;
      const parent2 = tcx.parent_hir_node(index2.hir_id);
      if (parent2.$ !== "Expr") return;
      if (parent2._0.kind.$ !== "Index") return;
      const idx2 = parent2._0.kind._1;
      if (!idx1.equivalent_for_indexing(idx2)) {
        err.help("use `.split_at_mut(position)` to obtain two mutable non-overlapping sub-slices");
      }
      return;
    }

    err.span_suggestion(
      swap_call.span,
      "use `.swap()` to swap elements at the specified indices instead",
      `${obj_str._0}.swap(${index1_str._0}, ${index2_str._0})`,
      "MachineApplicable",
    );
    return;
  }
  const place_ty = place.as_ref().ty(this.body, tcx).ty;
  const borrowed_place_ty = borrowed_place.as_ref().ty(this.body, tcx).ty;
  if (!has_split_at_mut(place_ty) && !has_split_at_mut(borrowed_place_ty)) {
    // Only mention `split_at_mut` on `Vec`, array and slices.
    return;
  }
  const index1 = this.find_expr(span);
  if (index1 === undefined) return;
  const parent1 = tcx.parent_hir_node(index1.hir_id);
  if (parent1.$ !== "Expr") return;
  if (parent1._0.kind.$ !== "Index") return;
  const idx1 = parent1._0.kind._1;
  const index2 = this.find_expr(issued_span);
  if (index2 === undefined) return;
  const parent2 = tcx.parent_hir_node(index2.hir_id);
  if (parent2.$ !== "Expr") return;
  if (parent2._0.kind.$ !== "Index") return;
  const idx2 = parent2._0.kind._1;
  if (idx1.equivalent_for_indexing(idx2)) {
    // `let a = &mut foo[0]` and `let b = &mut foo[0]`? Don't mention `split_at_mut`
    return;
  }
  err.help("use `.split_at_mut(position)` to obtain two mutable non-overlapping sub-slices");
};

// ==== lane bck-diag-b ====
// PORT: lane bck-diag-b's value imports sit here (ES imports are hoisted) so the parallel bck-diag-a edits of the import
// block above merge cleanly. Names imported as types above are imported here under an alias when a value is needed
// (`SpanC`, `LocationC`, ...).
// PORT: the fn-local types of this lane's methods (`ExprFinder`, `ClosureFinder`, `VariableUseFinder`,
// `ExpressionFinder`, `NestedStatementVisitor`, `RefPatternFinder`, `FakeReadCauseFinder`) and the fn-local fn
// `predecessor_locations` are back inside their fns, as upstream has them (contract "How to fill a stub" step 2).
import { BytePos } from "../../rustc_span/lib.ts";
import { DesugaringKind } from "../../rustc_span/hygiene.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_DefKind } from "../../rustc_hir/def.gen.ts";
import type { DefKind } from "../../rustc_hir/def.ts";
import { LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import {
  debug_Local,
  find_self_call,
  Location as LocationC,
  Place_from_Local,
  PlaceRef_from_Local,
  PlaceTy,
  RETURN_PLACE,
  type LocalDecl,
} from "../../rustc_middle/mir/mod.ts";
import { CallSource } from "../../rustc_middle/mir/syntax.ts";
import { debug_ConstraintCategory } from "../../rustc_middle/mir/query.gen.ts";
import { CAPTURE_STRUCT_LOCAL } from "../../rustc_middle/ty/closure.ts";
import { PolyFnSig as PolyFnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { call_kind } from "../../rustc_trait_selection/error_reporting/traits/call_kind.ts";
import { str_trim_end, type Str } from "../../std/str.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { Location_key } from "../borrow_set.ts";
import { borrowed_data_escapes_closure } from "../borrowck_errors.ts";
import { RegionName as RegionNameC, RegionNameSource, display_RegionName } from "./region_name.ts";

// (`Place_eq` / `PlaceRef_eq`: bck-diag-a's helpers above.)

/// Suggest using `while let` for call `next` on an iterator in a for loop.
///
/// For example:
/// ```ignore (illustrative)
///
/// for x in iter {
///     ...
///     iter.next()
/// }
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2469 explain_iterator_advancement_in_for_loop_if_applicable
MirBorrowckCtxt.prototype.explain_iterator_advancement_in_for_loop_if_applicable = function (
  this: MirBorrowckCtxt,
  err: Diag,
  span: Span,
  issued_spans: UseSpans,
): void {
  const issue_span = UseSpansC.args_or_use(issued_spans);
  const tcx = this.infcx.tcx;

  const body_id = hir.Node.body_id(tcx.hir_node(this.mir_hir_id()));
  if (body_id === undefined) return;
  const typeck_results = tcx.typeck(this.mir_def_id()) as TypeckResults;

  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2481 ExprFinder
  // PORT: the `= None` default field values are the constructor arguments of its single construction site.
  class ExprFinder extends hir.intravisit.Visitor {
    constructor(
      public tcx: TyCtxt,
      public issue_span: Span,
      public expr_span: Span,
      public body_expr: hir.Expr | undefined,
      public loop_bind: Ident | undefined,
      public loop_span: Span | undefined,
      public head_span: Span | undefined,
      public pat_span: Span | undefined,
      public head: hir.Expr | undefined,
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2493 visit_expr
    override visit_expr(ex: hir.Expr): undefined {
      // Try to find
      // let result = match IntoIterator::into_iter(<head>) {
      //     mut iter => {
      //         [opt_ident]: loop {
      //             match Iterator::next(&mut iter) {
      //                 None => break,
      //                 Some(<pat>) => <body>,
      //             };
      //         }
      //     }
      // };
      // corresponding to the desugaring of a for loop `for <pat> in <head> { <body> }`.
      if (ex.kind.$ === "Call" && ex.kind._1.length === 1) {
        const path = ex.kind._0;
        const arg = ex.kind._1[0]!;
        if (
          path.kind.$ === "Path" &&
          this.tcx.qpath_is_lang_item(path.kind._0, "IntoIterIntoIter") &&
          SpanC.contains(arg.span, this.issue_span) &&
          SpanC.desugaring_kind(ex.span)?.$ === "ForLoop"
        ) {
          // Find `IntoIterator::into_iter(<head>)`
          this.head = arg;
        }
      }
      if (ex.kind.$ === "Loop" && ex.kind._0.stmts.length >= 1 && ex.kind._2 === "ForLoop") {
        const stmt = ex.kind._0.stmts[0]!;
        if (stmt.kind.$ === "Expr" && stmt.kind._0.kind.$ === "Match" && stmt.kind._0.kind._1.length >= 2) {
          const head_span = stmt.kind._0.span;
          const call = stmt.kind._0.kind._0;
          const bind = stmt.kind._0.kind._1[1]!;
          if (
            call.kind.$ === "Call" &&
            call.kind._0.kind.$ === "Path" &&
            this.tcx.qpath_is_lang_item(call.kind._0.kind._0, "IteratorNext") &&
            bind.pat.kind.$ === "Struct" &&
            bind.pat.kind._1.length >= 1 &&
            this.tcx.qpath_is_lang_item(bind.pat.kind._0, "OptionSome") &&
            SpanC.contains(call.span, this.issue_span)
          ) {
            const field = bind.pat.kind._1[0]!;
            // Find `<pat>` and the span for the whole `for` loop.
            if (field.pat.kind.$ === "Binding") {
              this.loop_bind = field.pat.kind._2;
            }
            this.head_span = head_span;
            this.pat_span = bind.pat.span;
            this.loop_span = stmt.span;
          }
        }
      }

      if (ex.kind.$ === "MethodCall") {
        const body_call = ex.kind._0;
        const recv = ex.kind._1;
        const [r_lo, r_hi] = SpanC.lo_hi(recv.span);
        const [e_lo, e_hi] = SpanC.lo_hi(this.expr_span);
        if (body_call.ident.name === sym.next && r_lo === e_lo && r_hi === e_hi) {
          this.body_expr = ex;
        }
      }

      hir.intravisit.walk_expr(this, ex);
      return undefined;
    }
  }
  const finder = new ExprFinder(tcx, issue_span, span, undefined, undefined, undefined, undefined, undefined, undefined);
  finder.visit_expr(tcx.hir_body(body_id).value);

  let body_expr: hir.Expr | undefined;
  let loop_span: Span | undefined;
  let def_id: DefId | undefined;
  let trait_did: DefId | undefined;
  if (
    (body_expr = finder.body_expr) !== undefined &&
    (loop_span = finder.loop_span) !== undefined &&
    (def_id = typeck_results.type_dependent_def_id(body_expr.hir_id)) !== undefined &&
    (trait_did = tcx.trait_of_assoc(def_id)) !== undefined &&
    tcx.is_diagnostic_item(sym.Iterator, trait_did)
  ) {
    const loop_bind = finder.loop_bind;
    if (loop_bind !== undefined) {
      err.note(`a for loop advances the iterator for you, the result is stored in \`${display_Symbol(loop_bind.name)}\``);
    } else {
      err.note("a for loop advances the iterator for you, the result is stored in its pattern");
    }
    const msg = "if you want to call `next` on a iterator within the loop, consider using `while let`";
    let head: hir.Expr | undefined;
    let pat_span: Span | undefined;
    if (
      (head = finder.head) !== undefined &&
      (pat_span = finder.pat_span) !== undefined &&
      SpanC.contains(loop_span, body_expr.span) &&
      SpanC.contains(loop_span, head.span)
    ) {
      const sm = this.infcx.tcx.sess.source_map();

      const sugg: [Span, string][] = [];
      if (head.kind.$ === "Path" && head.kind._0.$ === "Resolved" && head.kind._0._0 === undefined) {
        // A bare path doesn't need a `let` assignment, it's already a simple
        // binding access.
        // As a new binding wasn't added, we don't need to modify the advancing call.
        sugg.push([SpanC.with_hi(loop_span, SpanC.lo(pat_span)), "while let Some("]);
        sugg.push([SpanC.with_hi(SpanC.shrink_to_hi(pat_span), SpanC.lo(head.span)), ") = "]);
        sugg.push([SpanC.shrink_to_hi(head.span), ".next()"]);
      } else {
        // Needs a new a `let` binding.
        const indent_ = sm.indentation_before(loop_span);
        const indent = indent_ !== undefined ? `\n${indent_.toString()}` : " ";
        const head_str_r = sm.span_to_snippet(head.span);
        if (head_str_r.$ !== "Ok") {
          err.help(msg);
          return;
        }
        const head_str = head_str_r._0.toString();
        sugg.push([SpanC.with_hi(loop_span, SpanC.lo(pat_span)), `let iter = ${head_str};${indent}while let Some(`]);
        sugg.push([SpanC.with_hi(SpanC.shrink_to_hi(pat_span), SpanC.hi(head.span)), ") = iter.next()"]);
        // As a new binding was added, we should change how the iterator is advanced to
        // use the newly introduced binding.
        if (body_expr.kind.$ === "MethodCall") {
          const recv = body_expr.kind._1;
          if (recv.kind.$ === "Path" && recv.kind._0.$ === "Resolved" && recv.kind._0._0 === undefined) {
            // As we introduced a `let iter = <head>;`, we need to change where the
            // already borrowed value was accessed from `<recv>.next()` to
            // `iter.next()`.
            sugg.push([recv.span, "iter"]);
          }
        }
      }
      err.multipart_suggestion(msg, sugg, "MaybeIncorrect");
    } else {
      err.help(msg);
    }
  }
};

/// Explain iterator invalidation when mutating a collection in a for loop.
///
/// For example:
/// ```compile_fail
/// let mut values = vec![1, 2, 3];
/// for value in &values {
///     values.push(4);
/// }
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2641 explain_iterator_invalidation_in_for_loop_if_applicable
MirBorrowckCtxt.prototype.explain_iterator_invalidation_in_for_loop_if_applicable = function (
  this: MirBorrowckCtxt,
  err: Diag,
  issued_spans: UseSpans,
  place: Place,
  borrowed_place: Place,
  borrow_kind: BorrowKind,
  gen_span: Span,
): void {
  const issue_span = UseSpansC.args_or_use(issued_spans);
  const tcx = this.infcx.tcx;

  const body_id = hir.Node.body_id(tcx.hir_node(this.mir_hir_id()));
  if (body_id === undefined) return;

  let for_span: Span | undefined;
  if (
    (for_span = find_for_loop_span(tcx, body_id, issue_span)) !== undefined &&
    place.local === borrowed_place.local &&
    SpanC.contains(for_span, gen_span)
  ) {
    const place_desc = this.describe_any_place(place.as_ref());
    const borrow_kind_str = borrow_kind.$ === "Mut" ? "mutably" : "immutably";
    err.span_label(for_span, `this for loop borrows ${place_desc} ${borrow_kind_str}, preventing mutation within its body`);
    err.help("consider using an index-based loop instead, or collecting modifications into a separate collection");
  }
};

/// Suggest using closure argument instead of capture.
///
/// For example:
/// ```ignore (illustrative)
/// struct S;
///
/// impl S {
///     fn call(&mut self, f: impl Fn(&mut Self)) { /* ... */ }
///     fn x(&self) {}
/// }
///
///     let mut v = S;
///     v.call(|this: &mut S| v.x());
/// //  ^\                    ^-- help: try using the closure argument: `this`
/// //    *-- error: cannot borrow `v` as mutable because it is also borrowed as immutable
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2692 suggest_using_closure_argument_instead_of_capture
MirBorrowckCtxt.prototype.suggest_using_closure_argument_instead_of_capture = function (
  this: MirBorrowckCtxt,
  err: Diag,
  borrowed_place: Place,
  issued_spans: UseSpans,
): void {
  if (issued_spans.$ !== "ClosureUse") return;
  const capture_kind_span = issued_spans.capture_kind_span;
  const tcx = this.infcx.tcx;

  // Get the type of the local that we are trying to borrow
  const local = borrowed_place.local;
  const local_ty = this.body.local_decls[local]!.ty;

  // Get the body the error happens in
  const body_id = hir.Node.body_id(tcx.hir_node(this.mir_hir_id()));
  if (body_id === undefined) return;

  const body_expr = tcx.hir_body(body_id).value;

  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2710 ClosureFinder
  class ClosureFinder extends hir.intravisit.Visitor {
    // type NestedFilter = OnlyBodies;
    override NestedFilter = OnlyBodies;

    constructor(
      public tcx: TyCtxt,
      public borrow_span: Span,
      public res: [hir.Expr, hir.Closure] | undefined,
      /// The path expression with the `borrow_span` span
      public error_path: [hir.Expr, hir.QPath] | undefined,
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2720 maybe_tcx
    override maybe_tcx(): HirTyCtxt {
      return TyCtxt_as_HirTyCtxt(this.tcx);
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2724 visit_expr
    override visit_expr(ex: hir.Expr): undefined {
      if (ex.kind.$ === "Path" && ex.span === this.borrow_span) {
        this.error_path = [ex, ex.kind._0];
      }

      if (
        ex.kind.$ === "Closure" &&
        SpanC.contains(ex.span, this.borrow_span) &&
        // To support cases like `|| { v.call(|this| v.get()) }`
        // FIXME: actually support such cases (need to figure out how to move from the
        // capture place to original local).
        (this.res === undefined || SpanC.contains(this.res[0].span, ex.span))
      ) {
        this.res = [ex, ex.kind._0];
      }

      hir.intravisit.walk_expr(this, ex);
      return undefined;
    }
  }

  // Find the closure that most tightly wraps `capture_kind_span`
  const finder = new ClosureFinder(tcx, capture_kind_span, undefined, undefined);
  finder.visit_expr(body_expr);
  if (finder.res === undefined) return;
  const [closure_expr, closure] = finder.res;

  const typeck_results = tcx.typeck(this.mir_def_id()) as TypeckResults;

  // Check that the parent of the closure is a method call,
  // with receiver matching with local's type (modulo refs)
  const parent = tcx.parent_hir_node(closure_expr.hir_id);
  if (parent.$ === "Expr" && parent._0.kind.$ === "MethodCall") {
    const recv = parent._0.kind._1;
    const recv_ty = typeck_results.expr_ty(recv);

    if (recv_ty.peel_refs() !== local_ty) {
      return;
    }
  }

  // Get closure's arguments
  const closure_ty_kind = typeck_results.expr_ty(closure_expr).kind();
  if (closure_ty_kind.$ !== "Closure") {
    /* hir::Closure can be a coroutine too */
    return;
  }
  const args = closure_ty_kind._1;
  const sig = ClosureArgs.sig(args.as_closure());
  const first_input = BinderC.iter(PolyFnSigC.inputs(sig)).next();
  if (first_input.done === true) panic("called `Option::unwrap()` on a `None` value");
  const tupled_params = tcx.instantiate_bound_regions_with_erased(
    BinderC.map_bound(first_input.value, (b) => b),
    fold_Ty,
  );
  const tupled_kind = tupled_params.kind();
  if (tupled_kind.$ !== "Tuple") return;
  const params = tupled_kind._0;

  // Find the first argument with a matching type and get its identifier.
  let this_name: Ident | undefined;
  {
    const idents = tcx.hir_body_param_idents(closure.body);
    const n = Math.min(params.length, idents.length);
    for (let i = 0; i < n; i++) {
      const param_ty = params[i]!;
      const ident = idents[i];
      // FIXME: also support deref for stuff like `Rc` arguments
      const r = param_ty.peel_refs() === local_ty ? ident : undefined;
      if (r !== undefined) {
        this_name = r;
        break;
      }
    }
  }
  if (this_name === undefined) {
    return;
  }

  let spans: Span[];
  let qpath: hir.QPath | undefined;
  if (
    finder.error_path !== undefined &&
    (qpath = finder.error_path[1]).$ === "Resolved" &&
    qpath._1.res.$ === "Local"
  ) {
    const local_id = qpath._1.res._0;
    // Find all references to the problematic variable in this closure body

    // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2793 VariableUseFinder
    class VariableUseFinder extends hir.intravisit.Visitor {
      constructor(
        public local_id: hir.HirId,
        public spans: Span[],
      ) {
        super();
      }

      // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2798 visit_expr
      override visit_expr(ex: hir.Expr): undefined {
        if (
          ex.kind.$ === "Path" &&
          ex.kind._0.$ === "Resolved" &&
          ex.kind._0._1.res.$ === "Local" &&
          HirId_eq(ex.kind._0._1.res._0, this.local_id)
        ) {
          this.spans.push(ex.span);
        }

        hir.intravisit.walk_expr(this, ex);
        return undefined;
      }
    }

    const finder = new VariableUseFinder(local_id, []);
    finder.visit_expr(tcx.hir_body(closure.body).value);

    spans = finder.spans;
  } else {
    spans = [capture_kind_span];
  }

  const this_name_str = display_Ident(this_name);
  err.multipart_suggestion(
    "try using the closure argument",
    spans.map((s): [Span, string] => [s, this_name_str]),
    "MaybeIncorrect",
  );
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2826 suggest_binding_for_closure_capture_self
MirBorrowckCtxt.prototype.suggest_binding_for_closure_capture_self = function (this: MirBorrowckCtxt, err: Diag, issued_spans: UseSpans): void {
  if (issued_spans.$ !== "ClosureUse") return;
  const capture_kind_span = issued_spans.capture_kind_span;

  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2833 ExpressionFinder
  // PORT: the default field values (`= vec![]`, `= None`, `= false`, `= String::new()`) are the constructor arguments
  // of its single construction site.
  class ExpressionFinder extends hir.intravisit.Visitor {
    constructor(
      public capture_span: Span,
      public closure_change_spans: Span[],
      public closure_arg_span: Span | undefined,
      public in_closure: boolean,
      public suggest_arg: string,
      public tcx: TyCtxt,
      public closure_local_id: hir.HirId | undefined,
      public closure_call_changes: [Span, string][],
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2844 visit_expr
    override visit_expr(e: hir.Expr): undefined {
      if (SpanC.contains(e.span, this.capture_span) && e.kind.$ === "Closure" && e.kind._0.kind.$ === "Closure") {
        const { body, fn_arg_span } = e.kind._0;
        const inputs = e.kind._0.fn_decl.inputs;
        const body_node = this.tcx.hir_node(body.hir_id);
        if (body_node.$ === "Expr") {
          const body = body_node._0;
          this.suggest_arg = "this: &Self";
          if (inputs.length > 0) {
            this.suggest_arg += ", ";
          }
          this.in_closure = true;
          this.closure_arg_span = fn_arg_span;
          this.visit_expr(body);
          this.in_closure = false;
        }
      }
      if (
        e.kind.$ === "Path" &&
        e.kind._0.$ === "Resolved" &&
        e.kind._0._1.segments.length === 1 &&
        e.kind._0._1.segments[0]!.ident.name === kw.SelfLower &&
        this.in_closure
      ) {
        this.closure_change_spans.push(e.span);
      }
      hir.intravisit.walk_expr(this, e);
      return undefined;
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2874 visit_local
    override visit_local(local: hir.LetStmt): undefined {
      let init: hir.Expr | undefined;
      if (
        local.pat.kind.$ === "Binding" &&
        (init = local.init) !== undefined &&
        init.kind.$ === "Closure" &&
        init.kind._0.kind.$ === "Closure" &&
        SpanC.contains(init.span, this.capture_span)
      ) {
        this.closure_local_id = local.pat.kind._1;
      }

      hir.intravisit.walk_local(this, local);
      return undefined;
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2894 visit_stmt
    override visit_stmt(s: hir.Stmt): undefined {
      if (s.kind.$ === "Semi") {
        const e = s.kind._0;
        if (e.kind.$ === "Call" && e.kind._0.kind.$ === "Path") {
          const args = e.kind._1;
          const path = e.kind._0.kind._0;
          if (path.$ === "Resolved" && path._1.segments.length === 1) {
            const seg = path._1.segments[0]!;
            if (seg.res.$ === "Local" && this.closure_local_id !== undefined && HirId_eq(seg.res._0, this.closure_local_id)) {
              let span: Span;
              let arg_str: string;
              if (args.length > 0) {
                [span, arg_str] = [SpanC.shrink_to_lo(args[0]!.span), "self, "];
              } else {
                const span_ = SpanC.trim_start(e.span, seg.ident.span) ?? e.span;
                [span, arg_str] = [span_, "(self)"];
              }
              this.closure_call_changes.push([span, arg_str]);
            }
          }
        }
      }
      hir.intravisit.walk_stmt(this, s);
      return undefined;
    }
  }

  const node = this.infcx.tcx.hir_node(this.mir_hir_id());
  if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    const body_id = node._0.kind._1;
    const expr_node = this.infcx.tcx.hir_node(body_id.hir_id);
    if (expr_node.$ === "Expr") {
      const expr = expr_node._0;
      const finder = new ExpressionFinder(capture_kind_span, [], undefined, false, "", this.infcx.tcx, undefined, []);
      finder.visit_expr(expr);

      if (finder.closure_change_spans.length === 0 || finder.closure_call_changes.length === 0) {
        return;
      }

      const sm = this.infcx.tcx.sess.source_map();
      const sugg: [Span, string][] = [];
      if (finder.closure_arg_span !== undefined) {
        sugg.push([SpanC.shrink_to_hi(sm.next_point(SpanC.shrink_to_lo(finder.closure_arg_span))), finder.suggest_arg]);
      }
      for (const span of finder.closure_change_spans) sugg.push([span, "this"]);
      for (const c of finder.closure_call_changes) sugg.push(c);

      err.multipart_suggestion("try explicitly passing `&Self` into the closure as an argument", sugg, "MachineApplicable");
    }
  }
};

/// Returns the description of the root place for a conflicting borrow and the full
/// descriptions of the places that caused the conflict.
///
/// In the simplest case, where there are no unions involved, if a mutable borrow of `x` is
/// attempted while a shared borrow is live, then this function will return:
/// ```
/// ("x", "", "")
/// # ;
/// ```
/// In the simple union case, if a mutable borrow of a union field `x.z` is attempted while
/// a shared borrow of another field `x.y`, then this function will return:
/// ```
/// ("x", "x.z", "x.y")
/// # ;
/// ```
/// In the more complex union case, where the union is a field of a struct, then if a mutable
/// borrow of a union field in a struct `x.u.z` is attempted while a shared borrow of
/// another field `x.u.y`, then this function will return:
/// ```
/// ("x.u", "x.u.z", "x.u.y")
/// # ;
/// ```
/// This is used when creating error messages like below:
///
/// ```text
/// cannot borrow `a.u` (via `a.u.z.c`) as immutable because it is also borrowed as
/// mutable (via `a.u.s.b`) [E0502]
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2977 describe_place_for_conflicting_borrow
MirBorrowckCtxt.prototype.describe_place_for_conflicting_borrow = function (
  this: MirBorrowckCtxt,
  first_borrowed_place: Place,
  second_borrowed_place: Place,
): [string, string, string, string] {
  // Define a small closure that we can use to check if the type of a place
  // is a union.
  const union_ty = (place_base: PlaceRef): Ty | undefined => {
    // Need to use fn call syntax `PlaceRef::ty` to determine the type of `place_base`;
    // using a type annotation in the closure argument instead leads to a lifetime error.
    const ty = place_base.ty(this.body, this.infcx.tcx).ty;
    const adt = ty.ty_adt_def();
    return adt !== undefined && adt.is_union() ? ty : undefined;
  };

  // Start with an empty tuple, so we can use the functions on `Option` to reduce some
  // code duplication (particularly around returning an empty description in the failure
  // case).
  // PORT: the `Option` combinator chain is a sequence of early-exit blocks in the same order.
  const r = ((): [string, string, string, string] | undefined => {
    // If we have a conflicting borrow of the same place, then we don't want to add
    // an extraneous "via x.y" to our diagnostics, so filter out this case.
    if (Place_eq(first_borrowed_place, second_borrowed_place)) return undefined;
    // We're going to want to traverse the first borrowed place to see if we can find
    // field access to a union. If we find that, then we will keep the place of the
    // union being accessed and the field that was being accessed so we can check the
    // second borrowed place for the same union and an access to a different field.
    let target: [PlaceRef, number] | undefined;
    {
      const projs = first_borrowed_place.iter_projections();
      for (let i = projs.length - 1; i >= 0; i--) {
        const [place_base, elem] = projs[i]!;
        if (elem.$ === "Field" && union_ty(place_base) !== undefined) {
          target = [place_base, elem._0];
          break;
        }
      }
    }
    if (target === undefined) return undefined;
    const [target_base, target_field] = target;
    // With the place of a union and a field access into it, we traverse the second
    // borrowed place and look for an access to a different field of the same union.
    const projs = second_borrowed_place.iter_projections();
    for (let i = projs.length - 1; i >= 0; i--) {
      const [place_base, elem] = projs[i]!;
      let union_ty_: Ty | undefined;
      if (elem.$ === "Field" && (union_ty_ = union_ty(place_base)) !== undefined) {
        if (elem._0 !== target_field && PlaceRef_eq(place_base, target_base)) {
          return [
            this.describe_any_place(place_base),
            this.describe_any_place(first_borrowed_place.as_ref()),
            this.describe_any_place(second_borrowed_place.as_ref()),
            display_Ty(union_ty_),
          ];
        }
      }
    }
    return undefined;
  })();
  // If we didn't find a field access into a union, or both places match, then
  // only return the description of the first place.
  return r ?? [this.describe_any_place(first_borrowed_place.as_ref()), "", "", ""];
};

/// This means that some data referenced by `borrow` needs to live
/// past the point where the StorageDeadOrDrop of `place` occurs.
/// This is usually interpreted as meaning that `place` has too
/// short a lifetime. (But sometimes it is more useful to report
/// it as a more direct conflict between the execution of a
/// `Drop::drop` with an aliasing borrow.)
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3053 report_borrowed_value_does_not_live_long_enough
MirBorrowckCtxt.prototype.report_borrowed_value_does_not_live_long_enough = function (
  this: MirBorrowckCtxt,
  location: Location,
  borrow: BorrowData,
  place_span: [Place, Span],
  kind: WriteKind | undefined,
): void {
  const drop_span = place_span[1];
  const borrowed_local = borrow.borrowed_place.local;

  const borrow_spans = this.retrieve_borrow_spans(borrow);
  const borrow_span = UseSpansC.var_or_use_path_span(borrow_spans);

  const proper_span = this.body.local_decls[borrowed_local]!.source_info.span;

  if (this.access_place_error_reported.has([Place_from_Local(borrowed_local), borrow_span])) {
    // debug!("suppressing access_place error when borrow doesn't live long enough for {:?}", borrow_span);
    return;
  }

  this.access_place_error_reported.add([Place_from_Local(borrowed_local), borrow_span]);

  if (this.body.local_decls[borrowed_local]!.is_ref_to_thread_local()) {
    const err = this.report_thread_local_value_does_not_live_long_enough(drop_span, borrow_span);
    this.buffer_error(err);
    return;
  }

  const drop_kind = this.classify_drop_access_kind(borrow.borrowed_place.as_ref());
  if (drop_kind.$ === "Destructor") {
    const dropped_ty = drop_kind._0;
    // If a borrow of path `B` conflicts with drop of `D` (and
    // we're not in the uninteresting case where `B` is a
    // prefix of `D`), then report this as a more interesting
    // destructor conflict.
    if (!borrow.borrowed_place.as_ref().is_prefix_of(place_span[0].as_ref())) {
      this.report_borrow_conflicts_with_destructor(location, borrow, place_span, kind, dropped_ty);
      return;
    }
  }

  const place_desc = this.describe_place(borrow.borrowed_place.as_ref());

  const kind_place: [WriteKind, Place] | undefined = kind !== undefined && place_desc !== undefined ? [kind, place_span[0]] : undefined;
  const explanation = this.explain_why_borrow_contains_point(location, borrow, kind_place);

  // debug!(?place_desc, ?explanation);

  // PORT: the `match (place_desc, explanation)` is an if-chain in upstream arm order (guards evaluated in order).
  let err: Diag;
  let c: OutlivesConstraint;
  if (
    place_desc !== undefined &&
    explanation.$ === "UsedLater" &&
    explanation._1 === "ClosureCapture" &&
    (UseSpansC.for_coroutine(borrow_spans) || UseSpansC.for_closure(borrow_spans))
  ) {
    // If the outlives constraint comes from inside the closure,
    // for example:
    //
    // let x = 0;
    // let y = &x;
    // Box::new(|| y) as Box<Fn() -> &'static i32>
    //
    // then just use the normal error. The closure isn't escaping
    // and `move` will not help here.
    const name = place_desc;
    const var_or_use_span = explanation._2;
    err = this.report_escaping_closure_capture(
      borrow_spans,
      borrow_span,
      new RegionNameC(this.synthesize_region_name(), RegionNameSource.Static),
      { $: "CallArgument", _0: undefined },
      var_or_use_span,
      `\`${name}\``,
      "block",
    );
  } else if (
    place_desc !== undefined &&
    explanation.$ === "MustBeValidFor" &&
    ((c = explanation.best_blame.constraint()),
    (c.category.$ === "Return" || c.category.$ === "CallArgument" || c.category.$ === "OpaqueType") && !c.from_closure) &&
    (UseSpansC.for_coroutine(borrow_spans) || UseSpansC.for_closure(borrow_spans))
  ) {
    const name = place_desc;
    err = this.report_escaping_closure_capture(borrow_spans, borrow_span, explanation.region_name, c.category, c.span, `\`${name}\``, "function");
  } else if (
    explanation.$ === "MustBeValidFor" &&
    explanation.region_name.source.$ === "AnonRegionFromUpvar" &&
    ((c = explanation.best_blame.constraint()), c.category.$ === "Assignment" && !c.from_closure)
  ) {
    const name = place_desc;
    const upvar_span = explanation.region_name.source._0;
    const upvar_name = explanation.region_name.source._1;
    err = this.report_escaping_data(borrow_span, name, upvar_span, upvar_name, c.span);
  } else if (place_desc !== undefined) {
    const name = place_desc;
    err = this.report_local_value_does_not_live_long_enough(location, name, borrow, drop_span, borrow_spans, explanation);
  } else {
    err = this.report_temporary_value_does_not_live_long_enough(location, borrow, drop_span, borrow_spans, proper_span, explanation);
  }
  this.note_due_to_edition_2024_opaque_capture_rules(borrow, err);

  this.buffer_error(err);
};

// #[tracing::instrument(level = "debug", skip(self, explanation))]
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3200 report_local_value_does_not_live_long_enough
MirBorrowckCtxt.prototype.report_local_value_does_not_live_long_enough = function (
  this: MirBorrowckCtxt,
  location: Location,
  name_: string,
  borrow: BorrowData,
  drop_span: Span,
  borrow_spans: UseSpans,
  explanation: BorrowExplanation,
): Diag {
  const borrow_span = UseSpansC.var_or_use_path_span(borrow_spans);
  if (explanation.$ === "MustBeValidFor") {
    const { category, span, from_closure } = explanation.best_blame.constraint();
    if (!from_closure) {
      const r = this.try_report_cannot_return_reference_to_local(borrow, borrow_span, span, category, explanation.opt_place_desc);
      if (r.$ === "Err") {
        return r._0;
      }
    }
  }

  const name = `\`${name_}\``;

  const err = this.path_does_not_live_long_enough(borrow_span, name);

  const annotation = this.annotate_argument_and_return_for_borrow(borrow);
  if (annotation !== undefined) {
    const region_name = AnnotatedBorrowFnSignature.emit(annotation, this, err);

    err.span_label(borrow_span, `${name} would have to be valid for \`${region_name}\`...`);

    const item_name = this.infcx.tcx.opt_item_name(LocalDefIdC.to_def_id(this.mir_def_id()));
    let what: string;
    if (item_name !== undefined) {
      what = `function \`${display_Symbol(item_name)}\``;
    } else {
      const kind = this.infcx.tcx.def_kind(this.mir_def_id()) as DefKind;
      if (kind.$ === "Closure" && this.infcx.tcx.is_coroutine(LocalDefIdC.to_def_id(this.mir_def_id()))) {
        what = "enclosing coroutine";
      } else if (kind.$ === "Closure") {
        what = "enclosing closure";
      } else {
        return bug(`expected closure or coroutine, found ${debug_DefKind(kind, PLAIN)}`);
      }
    }
    err.span_label(drop_span, `...but ${name} will be dropped here, when the ${what} returns`);

    err.note(
      "functions cannot return a borrow to data owned within the function's scope, functions can only return borrows to data passed as arguments",
    );
    err.note("to learn more, visit <https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html#dangling-references>");

    if (explanation.$ === "MustBeValidFor") {
    } else {
      BorrowExplanationC.add_explanation_to_diagnostic(explanation, this, err, "", undefined, undefined);
    }
  } else {
    err.span_label(borrow_span, "borrowed value does not live long enough");
    err.span_label(drop_span, `${name} dropped here while still borrowed`);

    UseSpansC.args_subdiag(borrow_spans, err, (args_span) => ({
      $: "Capture",
      is_within: UseSpansC.for_coroutine(borrow_spans),
      args_span,
    }));

    BorrowExplanationC.add_explanation_to_diagnostic(explanation, this, err, "", borrow_span, undefined);

    // Detect buffer reuse pattern
    if (explanation.$ === "UsedLater") {
      // Check all locals at the borrow location to find Vec<&T> types
      const local_decls = this.body.local_decls;
      for (let local_ = 0; local_ < local_decls.length; local_++) {
        const local = local_ as Local;
        const local_decl = local_decls[local]!;
        const k = local_decl.ty.kind();
        if (k.$ === "Adt" && this.infcx.tcx.is_diagnostic_item(sym.Vec, k._0.did()) && k._1.length > 0) {
          const args = k._1;
          const vec_inner_ty = args.type_at(0);
          // Check if Vec contains references
          if (vec_inner_ty.is_ref()) {
            const local_place = PlaceRef_from_Local(local);
            const local_name = this.describe_place(local_place);
            if (local_name !== undefined) {
              err.span_label(local_decl.source_info.span, `variable \`${local_name}\` declared here`);
              err.note(`\`${local_name}\` is a collection that stores borrowed references, but ${name} does not live long enough to be stored in it`);
              err.help("buffer reuse with borrowed references requires unsafe code or restructuring");
              break;
            }
          }
        }
      }
    }
  }

  return err;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3325 report_borrow_conflicts_with_destructor
MirBorrowckCtxt.prototype.report_borrow_conflicts_with_destructor = function (
  this: MirBorrowckCtxt,
  location: Location,
  borrow: BorrowData,
  [place, drop_span]: [Place, Span],
  kind: WriteKind | undefined,
  dropped_ty: Ty,
): void {
  // debug!("report_borrow_conflicts_with_destructor({:?}, {:?}, ({:?}, {:?}), {:?})", location, borrow, place, drop_span, kind);

  const borrow_spans = this.retrieve_borrow_spans(borrow);
  const borrow_span = UseSpansC.var_or_use(borrow_spans);

  const err = this.cannot_borrow_across_destructor(borrow_span);

  const dropped_name = this.describe_place(place.as_ref());
  const what_was_dropped = dropped_name !== undefined ? `\`${dropped_name}\`` : "temporary value";

  const borrowed = this.describe_place(borrow.borrowed_place.as_ref());
  const label =
    borrowed !== undefined
      ? `here, drop of ${what_was_dropped} needs exclusive access to \`${borrowed}\`, because the type \`${display_Ty(dropped_ty)}\` implements the \`Drop\` trait`
      : `here is drop of ${what_was_dropped}; whose type \`${display_Ty(dropped_ty)}\` implements the \`Drop\` trait`;
  err.span_label(drop_span, label);

  // Only give this note and suggestion if they could be relevant.
  const explanation = this.explain_why_borrow_contains_point(location, borrow, kind !== undefined ? [kind, place] : undefined);
  switch (explanation.$) {
    case "UsedLater":
    case "UsedLaterWhenDropped":
      err.note("consider using a `let` binding to create a longer lived value");
      break;
    default:
      break;
  }

  BorrowExplanationC.add_explanation_to_diagnostic(explanation, this, err, "", undefined, undefined);

  this.buffer_error(err);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3377 report_thread_local_value_does_not_live_long_enough
MirBorrowckCtxt.prototype.report_thread_local_value_does_not_live_long_enough = function (this: MirBorrowckCtxt, drop_span: Span, borrow_span: Span): Diag {
  // debug!("report_thread_local_value_does_not_live_long_enough({:?}, {:?})", drop_span, borrow_span);

  // `TerminatorKind::Return`'s span (the `drop_span` here) `lo` can be subtly wrong and point
  // at a single character after the end of the function. This is somehow relied upon in
  // existing diagnostics, and changing this in `rustc_mir_build` makes diagnostics worse in
  // general. We fix these here.
  const sm = this.infcx.tcx.sess.source_map();
  let adjusted_span: ReturnType<typeof sm.span_extend_prev_while> | undefined;
  const end_of_function =
    SpanC.is_empty(drop_span) && (adjusted_span = sm.span_extend_prev_while(drop_span, (c) => c === 0x7d /* '}' */)).$ === "Ok"
      ? adjusted_span._0
      : drop_span;
  return this.thread_local_value_does_not_live_long_enough(borrow_span)
    .with_span_label(borrow_span, "thread-local variables cannot be borrowed beyond the end of the function")
    .with_span_label(end_of_function, "end of enclosing function is here");
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3410 report_temporary_value_does_not_live_long_enough
MirBorrowckCtxt.prototype.report_temporary_value_does_not_live_long_enough = function (
  this: MirBorrowckCtxt,
  location: Location,
  borrow: BorrowData,
  drop_span: Span,
  borrow_spans: UseSpans,
  proper_span: Span,
  explanation: BorrowExplanation,
): Diag {
  if (explanation.$ === "MustBeValidFor") {
    const { category, span, from_closure } = explanation.best_blame.constraint();
    if (!from_closure) {
      const r = this.try_report_cannot_return_reference_to_local(borrow, proper_span, span, category, undefined);
      if (r.$ === "Err") {
        return r._0;
      }
    }
  }

  const err = this.temporary_value_borrowed_for_too_long(proper_span);
  err.span_label(proper_span, "creates a temporary value which is freed while still in use");
  err.span_label(drop_span, "temporary value is freed at the end of this statement");

  switch (explanation.$) {
    case "UsedLater":
    case "UsedLaterInLoop":
    case "UsedLaterWhenDropped": {
      // Only give this note and suggestion if it could be relevant.
      const sm = this.infcx.tcx.sess.source_map();
      let suggested = false;
      const msg = "consider using a `let` binding to create a longer lived value";

      /// We check that there's a single level of block nesting to ensure always correct
      /// suggestions. If we don't, then we only provide a free-form message to avoid
      /// misleading users in cases like `tests/ui/nll/borrowed-temporary-error.rs`.
      /// We could expand the analysis to suggest hoising all of the relevant parts of
      /// the users' code to make the code compile, but that could be too much.
      /// We found the `prop_expr` by the way to check whether the expression is a
      /// `FormatArguments`, which is a special case since it's generated by the
      /// compiler.
      // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3455 NestedStatementVisitor
      class NestedStatementVisitor extends hir.intravisit.Visitor {
        constructor(
          public span: Span,
          public current: number,
          public found: number,
          public prop_expr: hir.Expr | undefined,
          public call: hir.Expr | undefined,
        ) {
          super();
        }

        // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3464 visit_block
        override visit_block(block: hir.Block): undefined {
          this.current += 1;
          hir.intravisit.walk_block(this, block);
          this.current -= 1;
          return undefined;
        }

        // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3469 visit_expr
        override visit_expr(expr: hir.Expr): undefined {
          if (expr.kind.$ === "MethodCall") {
            const rcvr = expr.kind._1;
            if (this.span === SpanC.source_callsite(rcvr.span)) {
              this.call = expr;
            }
          }
          if (this.span === SpanC.source_callsite(expr.span)) {
            this.found = this.current;
            if (this.prop_expr === undefined) {
              this.prop_expr = expr;
            }
          }
          hir.intravisit.walk_expr(this, expr);
          return undefined;
        }
      }
      const source_info = this.body.source_info(location);
      const proper_span_ = SpanC.source_callsite(proper_span);
      const scope = this.body.source_scopes[source_info.scope];
      let id: hir.BodyId | undefined;
      let body_value: hir.Expr;
      if (
        scope !== undefined &&
        scope.local_data.$ === "Set" &&
        (id = hir.Node.body_id(this.infcx.tcx.hir_node(scope.local_data._0.lint_root))) !== undefined &&
        (body_value = this.infcx.tcx.hir_body(id).value).kind.$ === "Block"
      ) {
        const block = body_value.kind._0;
        for (const stmt of block.stmts) {
          const visitor = new NestedStatementVisitor(proper_span_, 0, 0, undefined, undefined);
          visitor.visit_stmt(stmt);

          const typeck_results = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
          const expr_ty: Ty | undefined = visitor.prop_expr !== undefined ? typeck_results.expr_ty(visitor.prop_expr).peel_refs() : undefined;

          let p: number | undefined;
          let s: ReturnType<typeof sm.span_to_snippet> | undefined;
          if (
            visitor.found === 0 &&
            SpanC.contains(stmt.span, proper_span_) &&
            (p = sm.span_to_margin(stmt.span)) !== undefined &&
            (s = sm.span_to_snippet(proper_span_)).$ === "Ok"
          ) {
            const call = visitor.call;
            if (
              call !== undefined &&
              call.kind.$ === "MethodCall" &&
              call.kind._2.length === 0 &&
              call.kind._0.ident.name === sym.iter &&
              expr_ty !== undefined
            ) {
              const path = call.kind._0;
              const ty = expr_ty;
              err.span_suggestion_verbose(
                path.ident.span,
                `consider consuming the \`${display_Ty(ty)}\` when turning it into an \`Iterator\``,
                "into_iter",
                "MaybeIncorrect",
              );
            }

            const mutability = borrow.kind_().$ === "Mut" ? "mut " : "";

            const addition = `let ${mutability}binding = ${s._0.toString()};\n${" ".repeat(p)}`;
            err.multipart_suggestion(
              msg,
              [
                [SpanC.shrink_to_lo(stmt.span), addition],
                [proper_span_, "binding"],
              ],
              "MaybeIncorrect",
            );

            suggested = true;
            break;
          }
        }
      }
      if (!suggested) {
        err.note(msg);
      }
      break;
    }
    default:
      break;
  }
  BorrowExplanationC.add_explanation_to_diagnostic(explanation, this, err, "", undefined, undefined);

  UseSpansC.args_subdiag(borrow_spans, err, (args_span) => ({
    $: "Capture",
    is_within: UseSpansC.for_coroutine(borrow_spans),
    args_span,
  }));

  return err;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3566 try_report_cannot_return_reference_to_local
MirBorrowckCtxt.prototype.try_report_cannot_return_reference_to_local = function (
  this: MirBorrowckCtxt,
  borrow: BorrowData,
  borrow_span: Span,
  return_span: Span,
  category: ConstraintCategory,
  opt_place_desc: string | undefined,
): Result<null, Diag> {
  let return_kind: string;
  switch (category.$) {
    case "Return":
      return_kind = "return";
      break;
    case "Yield":
      return_kind = "yield";
      break;
    default:
      return Ok(null);
  }

  // FIXME use a better heuristic than Spans
  const reference_desc = return_span === this.body.source_info(borrow.reserve_location).span ? "reference to" : "value referencing";

  let place_desc: string;
  let note: string;
  if (opt_place_desc !== undefined) {
    let local_kind: string;
    const local = borrow.borrowed_place.as_local();
    if (local !== undefined) {
      const lk = this.body.local_kind(local);
      if (lk === "Temp" && this.body.local_decls[local]!.is_user_variable()) {
        local_kind = "local variable ";
      } else if (lk === "Arg" && this.upvars.length !== 0 && (local as number) === (CAPTURE_STRUCT_LOCAL as number)) {
        local_kind = "variable captured by `move` ";
      } else if (lk === "Arg") {
        local_kind = "function parameter ";
      } else {
        // LocalKind::ReturnPointer | LocalKind::Temp
        return bug("temporary or return pointer with a name");
      }
    } else {
      local_kind = "local data ";
    }
    [place_desc, note] = [`${local_kind}\`${opt_place_desc}\``, `\`${opt_place_desc}\` is borrowed here`];
  } else {
    const local = borrow.borrowed_place.local;
    const lk = this.body.local_kind(local);
    if (lk === "Arg") {
      [place_desc, note] = ["function parameter", "function parameter borrowed here"];
    } else if (
      lk === "Temp" &&
      this.body.local_decls[local]!.is_user_variable() &&
      !SpanC.in_external_macro(this.body.local_decls[local]!.source_info.span, this.infcx.tcx.sess.source_map())
    ) {
      [place_desc, note] = ["local binding", "local binding introduced here"];
    } else {
      // LocalKind::ReturnPointer | LocalKind::Temp
      [place_desc, note] = ["temporary value", "temporary value created here"];
    }
  }

  const err = this.cannot_return_reference_to_local(return_span, return_kind, reference_desc, place_desc);

  if (return_span !== borrow_span) {
    err.span_label(borrow_span, note);

    const tcx = this.infcx.tcx;

    const return_ty = this.regioncx.universal_regions().unnormalized_output_ty;

    // to avoid panics
    let iter_trait: DefId | undefined;
    if (
      (iter_trait = tcx.get_diagnostic_item(sym.Iterator)) !== undefined &&
      EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(iter_trait, [return_ty], this.infcx.param_env))
    ) {
      err.span_suggestion_hidden(SpanC.shrink_to_hi(return_span), "use `.collect()` to allocate the iterator", ".collect::<Vec<_>>()", "MaybeIncorrect");
    }

    let cow_did: DefId | undefined;
    let return_ty_kind;
    if (
      (cow_did = tcx.get_diagnostic_item(sym.Cow)) !== undefined &&
      (return_ty_kind = return_ty.kind()).$ === "Adt" &&
      DefId_eq(return_ty_kind._0.did(), cow_did)
    ) {
      const typeck = tcx.typeck(this.mir_def_id()) as TypeckResults;
      let expr: hir.Expr | undefined;
      let def_id: DefId | undefined;
      let to_owned_ident: Ident | undefined;
      if (
        (expr = this.find_expr(return_span)) !== undefined &&
        (def_id = typeck.type_dependent_def_id(expr.hir_id)) !== undefined &&
        tcx.is_diagnostic_item(sym.to_owned_method, def_id) &&
        (to_owned_ident = expr.method_ident()) !== undefined
      ) {
        err.span_suggestion_short(
          SpanC.shrink_to_lo(to_owned_ident.span),
          "try using `.into_owned()` if you meant to convert a `Cow<'_, T>` to an owned `T`",
          "in",
          "MaybeIncorrect",
        );
      }
    }
  }

  return Err(err);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3682 report_escaping_closure_capture
MirBorrowckCtxt.prototype.report_escaping_closure_capture = function (
  this: MirBorrowckCtxt,
  use_span: UseSpans,
  var_span: Span,
  fr_name: RegionName,
  category: ConstraintCategory,
  constraint_span: Span,
  captured_var: string,
  scope: string,
): Diag {
  const tcx = this.infcx.tcx;
  const args_span = UseSpansC.args_or_use(use_span);

  let sugg_span: Span;
  let suggestion: string;
  const snippet = tcx.sess.source_map().span_to_snippet(args_span);
  if (snippet.$ === "Ok") {
    const string: Str = snippet._0;
    let coro_prefix: number | undefined;
    if (string.starts_with("async")) {
      const sub = string.slice(5);
      const trimmed_sub = str_trim_end(sub);
      if (trimmed_sub.toString().endsWith("gen")) {
        // `async` is 5 chars long.
        coro_prefix = trimmed_sub.len() + 5;
      } else {
        // `async` is 5 chars long.
        coro_prefix = 5;
      }
    } else if (string.starts_with("gen")) {
      // `gen` is 3 chars long
      coro_prefix = 3;
    } else if (string.starts_with("static")) {
      // `static` is 6 chars long
      // This is used for `!Unpin` coroutines
      coro_prefix = 6;
    } else {
      coro_prefix = undefined;
    }
    if (coro_prefix !== undefined) {
      const n = coro_prefix;
      const pos = BytePos(SpanC.lo(args_span) + n);
      [sugg_span, suggestion] = [SpanC.with_hi(SpanC.with_lo(args_span, pos), pos), " move"];
    } else {
      [sugg_span, suggestion] = [SpanC.shrink_to_lo(args_span), "move "];
    }
  } else {
    [sugg_span, suggestion] = [args_span, "move |<args>| <body>"];
  }
  let kind: string;
  const coroutine_kind = UseSpansC.coroutine_kind(use_span);
  if (coroutine_kind !== undefined) {
    if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Gen") {
      switch (coroutine_kind._1) {
        case "Block":
          kind = "gen block";
          break;
        case "Closure":
          kind = "gen closure";
          break;
        case "Fn":
          return bug("gen block/closure expected, but gen function found.");
      }
    } else if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "AsyncGen") {
      switch (coroutine_kind._1) {
        case "Block":
          kind = "async gen block";
          break;
        case "Closure":
          kind = "async gen closure";
          break;
        case "Fn":
          return bug("gen block/closure expected, but gen function found.");
      }
    } else if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async") {
      switch (coroutine_kind._1) {
        case "Block":
          kind = "async block";
          break;
        case "Closure":
          kind = "async closure";
          break;
        case "Fn":
          return bug("async block/closure expected, but async function found.");
      }
    } else {
      // CoroutineKind::Coroutine(_)
      kind = "coroutine";
    }
  } else {
    kind = "closure";
  }

  const err = this.cannot_capture_in_long_lived_closure(args_span, kind, captured_var, var_span, scope);
  err.span_suggestion_verbose(
    sugg_span,
    `to force the ${kind} to take ownership of ${captured_var} (and any other referenced variables), use the \`move\` keyword`,
    suggestion,
    "MachineApplicable",
  );

  switch (category.$) {
    case "Return":
    case "OpaqueType": {
      const msg = `${kind} is returned here`;
      err.span_note(constraint_span, msg);
      break;
    }
    case "CallArgument": {
      fr_name.highlight_region_name(err);
      const ck = UseSpansC.coroutine_kind(use_span);
      if (ck !== undefined && ck.$ === "Desugared" && ck._0 === "Async") {
        err.note("async blocks are not executed immediately and must either take a reference or ownership of outside variables they use");
      } else {
        const msg = `${scope} requires argument type to outlive \`${display_RegionName(fr_name)}\``;
        err.span_note(constraint_span, msg);
      }
      break;
    }
    default:
      return bug(`report_escaping_closure_capture called with unexpected constraint category: \`${debug_ConstraintCategory(category, PLAIN)}\``);
  }

  return err;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3802 report_escaping_data
MirBorrowckCtxt.prototype.report_escaping_data = function (
  this: MirBorrowckCtxt,
  borrow_span: Span,
  name: string | undefined,
  upvar_span: Span,
  upvar_name: Symbol,
  escape_span: Span,
): Diag {
  const tcx = this.infcx.tcx;

  const escapes_from = tcx.def_descr(LocalDefIdC.to_def_id(this.mir_def_id()));

  const err = borrowed_data_escapes_closure(this.dcx(), escape_span, escapes_from);

  err.span_label(upvar_span, `\`${display_Symbol(upvar_name)}\` declared here, outside of the ${escapes_from} body`);

  err.span_label(borrow_span, `borrow is only valid in the ${escapes_from} body`);

  if (name !== undefined) {
    err.span_label(escape_span, `reference to \`${name}\` escapes the ${escapes_from} body here`);
  } else {
    err.span_label(escape_span, `reference escapes the ${escapes_from} body here`);
  }

  return err;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3836 get_moved_indexes
MirBorrowckCtxt.prototype.get_moved_indexes = function (this: MirBorrowckCtxt, location: Location, mpi: MovePathIndex): [MoveSite[], Location[]] {
  // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3841 predecessor_locations
  function predecessor_locations(body: Body, location: Location): Iterable<Location> {
    if (location.statement_index === 0) {
      const predecessors = [...body.basic_blocks.predecessors()[location.block]!];
      return predecessors.map((bb: BasicBlock) => body.terminator_loc(bb));
    } else {
      return [new LocationC(location.block, location.statement_index - 1)];
    }
  }

  const mpis: MovePathIndex[] = [mpi];
  const move_paths = this.move_data.move_paths;
  for (const [mpi_] of move_paths[mpi]!.parents(move_paths)) mpis.push(mpi_);

  const stack: Location[] = [];
  const back_edge_stack: Location[] = [];

  for (const predecessor of predecessor_locations(this.body, location)) {
    if (location.dominates(predecessor, this.dominators())) {
      back_edge_stack.push(predecessor);
    } else {
      stack.push(predecessor);
    }
  }

  let reached_start = false;

  /* Check if the mpi is initialized as an argument */
  let is_argument = false;
  for (const arg of this.body.args_iter()) {
    const path = this.move_data.rev_lookup.find_local(arg);
    if (path !== undefined) {
      if (mpis.includes(path)) {
        is_argument = true;
      }
    }
  }

  const visited = new KeyedSet<Location>(Location_key);
  const move_locations = new KeyedSet<Location>(Location_key);
  const reinits: Location[] = [];
  const result: MoveSite[] = [];

  const dfs_iter = (result: MoveSite[], location: Location, is_back_edge: boolean): boolean => {
    // debug!("report_use_of_moved_or_uninitialized: (current_location={:?}, back_edge={})", location, is_back_edge);

    if (visited.has(location)) {
      return true;
    }
    visited.add(location);

    // check for moves
    const stmt_kind = this.body.basic_blocks.deref()[location.block]!.statements[location.statement_index]?.kind;
    if (stmt_kind !== undefined && stmt_kind.$ === "StorageDead") {
      // This analysis only tries to find moves explicitly written by the user, so we
      // ignore the move-outs created by `StorageDead` and at the beginning of a
      // function.
    } else {
      // If we are found a use of a.b.c which was in error, then we want to look for
      // moves not only of a.b.c but also a.b and a.
      //
      // Note that the moves data already includes "parent" paths, so we don't have to
      // worry about the other case: that is, if there is a move of a.b.c, it is already
      // marked as a move of a.b and a as well, so we will generate the correct errors
      // there.
      for (const moi of this.move_data.move_out_loc_map.index(location)) {
        // debug!("report_use_of_moved_or_uninitialized: moi={:?}", moi);
        const path = this.move_data.move_outs[moi]!.path;
        if (mpis.includes(path)) {
          // debug!("report_use_of_moved_or_uninitialized: found {:?}", move_paths[path].place);
          result.push({ moi: moi as MoveOutIndex, traversed_back_edge: is_back_edge });
          move_locations.add(location);

          // Strictly speaking, we could continue our DFS here. There may be
          // other moves that can reach the point of error. But it is kind of
          // confusing to highlight them.
          //
          // Example:
          //
          // ```
          // let a = vec![];
          // let b = a;
          // let c = a;
          // drop(a); // <-- current point of error
          // ```
          //
          // Because we stop the DFS here, we only highlight `let c = a`,
          // and not `let b = a`. We will of course also report an error at
          // `let c = a` which highlights `let b = a` as the move.
          return true;
        }
      }
    }

    // check for inits
    let any_match = false;
    for (const ii of this.move_data.init_loc_map.index(location)) {
      const init = this.move_data.inits[ii]!;
      switch (init.kind) {
        case "Deep":
        case "NonPanicPathOnly":
          if (mpis.includes(init.path)) {
            any_match = true;
          }
          break;
        case "Shallow":
          if (mpi === init.path) {
            any_match = true;
          }
          break;
      }
    }
    if (any_match) {
      reinits.push(location);
      return true;
    }
    return false;
  };

  let location_: Location | undefined;
  while ((location_ = stack.pop()) !== undefined) {
    const location = location_;
    if (dfs_iter(result, location, false)) {
      continue;
    }

    let has_predecessor = false;
    for (const predecessor of predecessor_locations(this.body, location)) {
      if (location.dominates(predecessor, this.dominators())) {
        back_edge_stack.push(predecessor);
      } else {
        stack.push(predecessor);
      }
      has_predecessor = true;
    }

    if (!has_predecessor) {
      reached_start = true;
    }
  }
  if ((is_argument || !reached_start) && result.length === 0) {
    // Process back edges (moves in future loop iterations) only if
    // the move path is definitely initialized upon loop entry,
    // to avoid spurious "in previous iteration" errors.
    // During DFS, if there's a path from the error back to the start
    // of the function with no intervening init or move, then the
    // move path may be uninitialized at loop entry.
    while ((location_ = back_edge_stack.pop()) !== undefined) {
      const location = location_;
      if (dfs_iter(result, location, true)) {
        continue;
      }

      for (const predecessor of predecessor_locations(this.body, location)) back_edge_stack.push(predecessor);
    }
  }

  // Check if we can reach these reinits from a move location.
  const reinits_reachable = reinits.filter((reinit) => {
    const visited = new KeyedSet<Location>(Location_key);
    const stack: Location[] = [reinit];
    let location: Location | undefined;
    while ((location = stack.pop()) !== undefined) {
      if (visited.has(location)) {
        continue;
      }
      visited.add(location);
      if (move_locations.has(location)) {
        return true;
      }
      stack.push(...predecessor_locations(this.body, location));
    }
    return false;
  });
  return [result, reinits_reachable];
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4026 report_illegal_mutation_of_borrowed
MirBorrowckCtxt.prototype.report_illegal_mutation_of_borrowed = function (this: MirBorrowckCtxt, location: Location, [place, span]: [Place, Span], loan: BorrowData): void {
  const loan_spans = this.retrieve_borrow_spans(loan);
  const loan_span = UseSpansC.args_or_use(loan_spans);

  const descr_place = this.describe_any_place(place.as_ref());
  let section: string | undefined;
  if (loan.kind.$ === "Fake" && (section = this.classify_immutable_section(loan.assigned_place)) !== undefined) {
    const err = this.cannot_mutate_in_immutable_section(span, loan_span, descr_place, section, "assign");

    UseSpansC.var_subdiag(loan_spans, err, loan.kind, (kind, var_span): CaptureVarCause => {
      // use crate::session_diagnostics::CaptureVarCause::*;
      switch (kind.$) {
        case "Coroutine":
          return { $: "BorrowUseInCoroutine", var_span };
        case "Closure":
        case "CoroutineClosure":
          return { $: "BorrowUseInClosure", var_span };
      }
    });

    this.buffer_error(err);

    return;
  }

  const err = this.cannot_assign_to_borrowed(span, loan_span, descr_place);
  this.note_due_to_edition_2024_opaque_capture_rules(loan, err);

  UseSpansC.var_subdiag(loan_spans, err, loan.kind, (kind, var_span): CaptureVarCause => {
    // use crate::session_diagnostics::CaptureVarCause::*;
    switch (kind.$) {
      case "Coroutine":
        return { $: "BorrowUseInCoroutine", var_span };
      case "Closure":
      case "CoroutineClosure":
        return { $: "BorrowUseInClosure", var_span };
    }
  });

  BorrowExplanationC.add_explanation_to_diagnostic(this.explain_why_borrow_contains_point(location, loan, undefined), this, err, "", undefined, undefined);

  this.explain_deref_coercion(loan, err);

  this.buffer_error(err);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4083 explain_deref_coercion
MirBorrowckCtxt.prototype.explain_deref_coercion = function (this: MirBorrowckCtxt, loan: BorrowData, err: Diag): void {
  const tcx = this.infcx.tcx;
  const terminator = this.body.basic_blocks.deref()[loan.reserve_location.block]!.terminator;
  let self_call: ReturnType<typeof find_self_call>;
  if (
    terminator !== undefined &&
    terminator.kind.$ === "Call" &&
    (self_call = find_self_call(tcx, this.body, loan.assigned_place.local, loan.reserve_location.block)) !== undefined
  ) {
    const { call_source, fn_span } = terminator.kind;
    const [method_did, method_args] = self_call;
    const arg_idents = this.infcx.tcx.fn_arg_idents(method_did) as readonly (Ident | undefined)[];
    if (arg_idents.length === 0) panic("index out of bounds: the len is 0 but the index is 0");
    const ck = call_kind(
      this.infcx.tcx,
      this.infcx.typing_env(this.infcx.param_env),
      method_did,
      method_args,
      fn_span,
      CallSource.from_hir_call(call_source),
      arg_idents[0],
    );
    if (ck.$ === "DerefCoercion") {
      const { deref_target_span, deref_target_ty } = ck;
      err.note(`borrow occurs due to deref coercion to \`${display_Ty(deref_target_ty)}\``);
      if (deref_target_span !== undefined) {
        err.span_note(deref_target_span, "deref defined here");
      }
    }
  }
};

/// Reports an illegal reassignment; for example, an assignment to
/// (part of) a non-`mut` local that occurs potentially after that
/// local has already been initialized. `place` is the path being
/// assigned; `err_place` is a place providing a reason why
/// `place` is not mutable (e.g., the non-`mut` local `x` in an
/// assignment to `x.f`).
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4116 report_illegal_reassignment
MirBorrowckCtxt.prototype.report_illegal_reassignment = function (this: MirBorrowckCtxt, [place, span]: [Place, Span], assigned_span_: Span, err_place: Place): void {
  let from_arg: boolean;
  let local_decl: LocalDecl | undefined;
  const err_local = err_place.as_local();
  if (err_local !== undefined) {
    [from_arg, local_decl] = [this.body.local_kind(err_local) === "Arg", this.body.local_decls[err_local]!];
  } else {
    [from_arg, local_decl] = [false, undefined];
  }

  // If root local is initialized immediately (everything apart from let
  // PATTERN;) then make the error refer to that local, rather than the
  // place being assigned later.
  let place_description: string;
  let assigned_span: Span;
  if (
    local_decl === undefined ||
    (local_decl.local_info.$ === "Set" &&
      ((local_decl.local_info._0.$ === "User" &&
        local_decl.local_info._0._0.$ === "Var" &&
        local_decl.local_info._0._0._0.opt_match_place === undefined) ||
        local_decl.local_info._0.$ === "StaticRef" ||
        local_decl.local_info._0.$ === "Boring"))
  ) {
    [place_description, assigned_span] = [this.describe_any_place(place.as_ref()), assigned_span_];
  } else {
    const decl = local_decl;
    [place_description, assigned_span] = [this.describe_any_place(err_place.as_ref()), decl.source_info.span];
  }
  const err = this.cannot_reassign_immutable(span, place_description, from_arg);
  const msg = from_arg ? "cannot assign to immutable argument" : "cannot assign twice to immutable variable";
  if (span !== assigned_span && !from_arg) {
    err.span_label(assigned_span, `first assignment to ${place_description}`);
  }
  if (local_decl !== undefined && local_decl.can_be_made_mutable()) {
    const decl = local_decl;
    let is_for_loop = false;
    let is_immut_ref_pattern = false;
    const decl_info = decl.local_info_();
    if (decl_info.$ === "User" && decl_info._0.$ === "Var" && decl_info._0._0.opt_match_place !== undefined) {
      const match_span = decl_info._0._0.opt_match_place[1];
      if (SpanC.desugaring_kind(match_span)?.$ === "ForLoop") {
        is_for_loop = true;
      }

      const body = this.infcx.tcx.hir_maybe_body_owned_by(this.mir_def_id());
      if (body !== undefined) {
        // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4172 RefPatternFinder
        class RefPatternFinder extends hir.intravisit.Visitor {
          // type NestedFilter = OnlyBodies;
          override NestedFilter = OnlyBodies;

          constructor(
            public tcx: TyCtxt,
            public binding_span: Span,
            public is_immut_ref_pattern: boolean,
          ) {
            super();
          }

          // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4181 maybe_tcx
          override maybe_tcx(): HirTyCtxt {
            return TyCtxt_as_HirTyCtxt(this.tcx);
          }

          // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4185 visit_pat
          override visit_pat(pat: hir.Pat): undefined {
            let parent: hir.Node;
            if (
              !this.is_immut_ref_pattern &&
              pat.kind.$ === "Binding" &&
              pat.kind._2.span === this.binding_span &&
              ((parent = this.tcx.parent_hir_node(pat.hir_id)), parent.$ === "Pat" && parent._0.kind.$ === "Ref" && parent._0.kind._2 === "Not")
            ) {
              this.is_immut_ref_pattern = true;
            }
            hir.intravisit.walk_pat(this, pat);
            return undefined;
          }
        }

        const finder = new RefPatternFinder(this.infcx.tcx, decl.source_info.span, false);

        finder.visit_body(body);
        is_immut_ref_pattern = finder.is_immut_ref_pattern;
      }
    }

    let span_: Span;
    let message: string;
    let binding_name: ReturnType<ReturnType<TyCtxt["sess"]["source_map"]>["span_to_snippet"]> | undefined;
    if (is_immut_ref_pattern && (binding_name = this.infcx.tcx.sess.source_map().span_to_snippet(decl.source_info.span)).$ === "Ok") {
      [span_, message] = [decl.source_info.span, `(mut ${binding_name._0.toString()})`];
    } else {
      [span_, message] = [SpanC.shrink_to_lo(decl.source_info.span), "mut "];
    }

    err.span_suggestion_verbose(span_, "consider making this binding mutable", message, "MachineApplicable");

    const info = decl.local_info_();
    if (
      !from_arg &&
      !is_for_loop &&
      info.$ === "User" &&
      info._0.$ === "Var" &&
      info._0._0.opt_match_place !== undefined &&
      info._0._0.opt_match_place[0] !== undefined
    ) {
      err.span_suggestion_verbose(
        SpanC.shrink_to_lo(decl.source_info.span),
        "to modify the original value, take a borrow instead",
        "ref mut ",
        "MaybeIncorrect",
      );
    }
  }
  err.span_label(span, msg);
  this.buffer_error(err);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4252 classify_drop_access_kind
MirBorrowckCtxt.prototype.classify_drop_access_kind = function (this: MirBorrowckCtxt, place: PlaceRef): StorageDeadOrDrop {
  const tcx = this.infcx.tcx;
  let kind: StorageDeadOrDrop = gen.StorageDeadOrDrop.LocalStorageDead;
  let place_ty = PlaceTy.from_ty(this.body.local_decls[place.local]!.ty);
  for (const elem of place.projection) {
    let new_kind!: StorageDeadOrDrop;
    switch (elem.$) {
      case "Deref":
        switch (kind.$) {
          case "LocalStorageDead":
          case "BoxedStorageDead":
            assert(place_ty.ty.is_box(), "Drop of value behind a reference or raw pointer");
            new_kind = gen.StorageDeadOrDrop.BoxedStorageDead;
            break;
          case "Destructor":
            new_kind = kind;
            break;
        }
        break;
      case "PhantomDeref":
        switch (kind.$) {
          case "LocalStorageDead":
          case "BoxedStorageDead":
            new_kind = gen.StorageDeadOrDrop.BoxedStorageDead;
            break;
          case "Destructor":
            new_kind = kind;
            break;
        }
        break;
      case "OpaqueCast":
      case "Field":
      case "Downcast": {
        const k = place_ty.ty.kind();
        if (k.$ === "Adt" && k._0.has_dtor(tcx)) {
          // Report the outermost adt with a destructor
          switch (kind.$) {
            case "Destructor":
              new_kind = kind;
              break;
            case "LocalStorageDead":
            case "BoxedStorageDead":
              new_kind = { $: "Destructor", _0: place_ty.ty };
              break;
          }
        } else {
          new_kind = kind;
        }
        break;
      }
      case "ConstantIndex":
      case "Subslice":
      case "Index":
      case "UnwrapUnsafeBinder":
        new_kind = kind;
        break;
    }
    [kind, place_ty] = [new_kind, place_ty.projection_ty(tcx, elem as PlaceElem, debug_Local)];
  }
  return kind;
};

/// Describe the reason for the fake borrow that was assigned to `place`.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4307 classify_immutable_section
MirBorrowckCtxt.prototype.classify_immutable_section = function (this: MirBorrowckCtxt, place: Place): string | undefined {
  // use rustc_middle::mir::visit::Visitor;
  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4309 FakeReadCauseFinder
  class FakeReadCauseFinder extends MirVisitor {
    constructor(
      public place: Place,
      public cause: FakeReadCause | undefined,
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4314 visit_statement
    override visit_statement(statement: Statement, _1: Location): void {
      if (statement.kind.$ === "FakeRead" && Place_eq(statement.kind._0[1], this.place)) {
        const cause = statement.kind._0[0];
        this.cause = cause;
      }
    }
  }
  const visitor = new FakeReadCauseFinder(place, undefined);
  visitor.visit_body(this.body);
  switch (visitor.cause?.$) {
    case "ForMatchGuard":
      return "match guard";
    case "ForIndex":
      return "indexing expression";
    default:
      return undefined;
  }
};

/// Annotate argument and return type of function and closure with (synthesized) lifetime for
/// borrow of local value that does not live long enough.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4336 annotate_argument_and_return_for_borrow
MirBorrowckCtxt.prototype.annotate_argument_and_return_for_borrow = function (this: MirBorrowckCtxt, borrow: BorrowData): gen.AnnotatedBorrowFnSignature | undefined {
  // Define a fallback for when we can't match a closure.
  const fallback = (): gen.AnnotatedBorrowFnSignature | undefined => {
    const tcx = this.infcx.tcx;
    const is_closure = tcx.is_closure_like(LocalDefIdC.to_def_id(this.mir_def_id()));
    if (is_closure) {
      return undefined;
    } else {
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.infcx.tcx.type_of(this.mir_def_id()) as EarlyBinder<Ty>));
      switch (ty.kind().$) {
        case "FnDef":
          return this.annotate_fn_sig(
            this.mir_def_id(),
            Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.infcx.tcx.fn_sig(this.mir_def_id()) as EarlyBinder<PolyFnSig>)),
          );
        // a const/static can have a fn ptr type, take the sig from the type instead.
        case "FnPtr":
          return this.annotate_fn_sig(this.mir_def_id(), ty.fn_sig(tcx));
        default:
          return undefined;
      }
    }
  };

  // In order to determine whether we need to annotate, we need to check whether the reserve
  // place was an assignment into a temporary.
  //
  // If it was, we check whether or not that temporary is eventually assigned into the return
  // place. If it was, we can add annotations about the function's return type and arguments
  // and it'll make sense.
  const location = borrow.reserve_location;
  // debug!("annotate_argument_and_return_for_borrow: location={:?}", location);
  const block_data = this.body.basic_blocks.deref()[location.block]!;
  const first_stmt = block_data.statements[location.statement_index];
  if (first_stmt !== undefined && first_stmt.kind.$ === "Assign") {
    const reservation = first_stmt.kind._0[0];
    // debug!("annotate_argument_and_return_for_borrow: reservation={:?}", reservation);
    // Check that the initial assignment of the reserve location is into a temporary.
    const reservation_local = reservation.as_local();
    let target: Local;
    if (reservation_local !== undefined && this.body.local_kind(reservation_local) === "Temp") {
      target = reservation_local;
    } else {
      return undefined;
    }

    // Next, look through the rest of the block, checking if we are assigning the
    // `target` (that is, the place that contains our borrow) to anything.
    let annotated_closure: gen.AnnotatedBorrowFnSignature | undefined = undefined;
    for (const stmt of block_data.statements.slice(location.statement_index + 1)) {
      // debug!("annotate_argument_and_return_for_borrow: target={:?} stmt={:?}", target, stmt);
      let assigned_to: Local | undefined;
      if (stmt.kind.$ === "Assign" && (assigned_to = stmt.kind._0[0].as_local()) !== undefined) {
        const rvalue = stmt.kind._0[1];
        // debug!("annotate_argument_and_return_for_borrow: assigned_to={:?} rvalue={:?}", assigned_to, rvalue);
        // Check if our `target` was captured by a closure.
        if (rvalue.$ === "Aggregate" && rvalue._0.$ === "Closure") {
          const operands = rvalue._1;
          const def_id = rvalue._0._0.expect_local();
          const args = rvalue._0._1;
          for (const operand of operands) {
            if (!(operand.$ === "Copy" || operand.$ === "Move")) {
              continue;
            }
            const assigned_from = operand._0;
            // debug!("annotate_argument_and_return_for_borrow: assigned_from={:?}", assigned_from);

            // Find the local from the operand.
            const assigned_from_local = assigned_from.local_or_deref_local();
            if (assigned_from_local === undefined) {
              continue;
            }

            if (assigned_from_local !== target) {
              continue;
            }

            // If a closure captured our `target` and then assigned
            // into a place then we should annotate the closure in
            // case it ends up being assigned into the return place.
            annotated_closure = this.annotate_fn_sig(def_id, ClosureArgs.sig(args.as_closure()));
            // debug!("annotate_argument_and_return_for_borrow: annotated_closure={:?} assigned_from_local={:?} assigned_to={:?}", annotated_closure, assigned_from_local, assigned_to);

            if (assigned_to === RETURN_PLACE) {
              // If it was assigned directly into the return place, then
              // return now.
              return annotated_closure;
            } else {
              // Otherwise, update the target.
              target = assigned_to;
            }
          }

          // If none of our closure's operands matched, then skip to the next
          // statement.
          continue;
        }

        // Otherwise, look at other types of assignment.
        let assigned_from: Place;
        if (rvalue.$ === "Ref") {
          assigned_from = rvalue._2;
        } else if (rvalue.$ === "Use") {
          const operand: Operand = rvalue._0;
          if (operand.$ === "Copy" || operand.$ === "Move") {
            assigned_from = operand._0;
          } else {
            continue;
          }
        } else {
          continue;
        }
        // debug!("annotate_argument_and_return_for_borrow: assigned_from={:?}", assigned_from);

        // Find the local from the rvalue.
        const assigned_from_local = assigned_from.local_or_deref_local();
        if (assigned_from_local === undefined) {
          continue;
        }
        // debug!("annotate_argument_and_return_for_borrow: assigned_from_local={:?}", assigned_from_local);

        // Check if our local matches the target - if so, we've assigned our
        // borrow to a new place.
        if (assigned_from_local !== target) {
          continue;
        }

        // If we assigned our `target` into a new place, then we should
        // check if it was the return place.
        // debug!("annotate_argument_and_return_for_borrow: assigned_from_local={:?} assigned_to={:?}", assigned_from_local, assigned_to);
        if (assigned_to === RETURN_PLACE) {
          // If it was then return the annotated closure if there was one,
          // else, annotate this function.
          return annotated_closure !== undefined ? annotated_closure : fallback();
        }

        // If we didn't assign into the return place, then we just update
        // the target.
        target = assigned_to;
      }
    }

    // Check the terminator if we didn't find anything in the statements.
    const terminator = block_data.terminator_();
    // debug!("annotate_argument_and_return_for_borrow: target={:?} terminator={:?}", target, terminator);
    let assigned_to: Local | undefined;
    if (terminator.kind.$ === "Call" && terminator.kind.target !== undefined && (assigned_to = terminator.kind.destination.as_local()) !== undefined) {
      const args = terminator.kind.args;
      // debug!("annotate_argument_and_return_for_borrow: assigned_to={:?} args={:?}", assigned_to, args);
      for (const operand of args) {
        const node = operand.node;
        if (!(node.$ === "Copy" || node.$ === "Move")) {
          continue;
        }
        const assigned_from = node._0;
        // debug!("annotate_argument_and_return_for_borrow: assigned_from={:?}", assigned_from);

        const assigned_from_local = assigned_from.local_or_deref_local();
        if (assigned_from_local !== undefined) {
          // debug!("annotate_argument_and_return_for_borrow: assigned_from_local={:?}", assigned_from_local);

          if (assigned_to === RETURN_PLACE && assigned_from_local === target) {
            return annotated_closure !== undefined ? annotated_closure : fallback();
          }
        }
      }
    }
  }

  // If we haven't found an assignment into the return place, then we need not add
  // any annotations.
  // debug!("annotate_argument_and_return_for_borrow: none found");
  return undefined;
};

/// Annotate the first argument and return type of a function signature if they are
/// references.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4555 annotate_fn_sig
MirBorrowckCtxt.prototype.annotate_fn_sig = function (this: MirBorrowckCtxt, did: LocalDefId, sig: PolyFnSig): gen.AnnotatedBorrowFnSignature | undefined {
  // debug!("annotate_fn_sig: did={:?} sig={:?}", did, sig);
  const is_closure = this.infcx.tcx.is_closure_like(LocalDefIdC.to_def_id(did));
  const fn_hir_id = this.infcx.tcx.local_def_id_to_hir_id(did);
  const fn_decl = this.infcx.tcx.hir_fn_decl_by_hir_id(fn_hir_id);
  if (fn_decl === undefined) return undefined;

  // We need to work out which arguments to highlight. We do this by looking
  // at the return type, where there are three cases:
  //
  // 1. If there are named arguments, then we should highlight the return type and
  //    highlight any of the arguments that are also references with that lifetime.
  //    If there are no arguments that have the same lifetime as the return type,
  //    then don't highlight anything.
  // 2. The return type is a reference with an anonymous lifetime. If this is
  //    the case, then we can take advantage of (and teach) the lifetime elision
  //    rules.
  //
  //    We know that an error is being reported. So the arguments and return type
  //    must satisfy the elision rules. Therefore, if there is a single argument
  //    then that means the return type and first (and only) argument have the same
  //    lifetime and the borrow isn't meeting that, we can highlight the argument
  //    and return type.
  //
  //    If there are multiple arguments then the first argument must be self (else
  //    it would not satisfy the elision rules), so we can highlight self and the
  //    return type.
  // 3. The return type is not a reference. In this case, we don't highlight
  //    anything.
  const return_ty_ = PolyFnSigC.output(sig);
  const rk = BinderC.skip_binder(return_ty_).kind();
  if (rk.$ === "Ref" && rk._0.is_named(this.infcx.tcx) && !is_closure) {
    const return_region = rk._0;
    // This is case 1 from above, return type is a named reference so we need to
    // search for relevant arguments.
    const arguments_: [Ty, Span][] = [];
    const inputs = BinderC.skip_binder(PolyFnSigC.inputs(sig));
    for (let index = 0; index < inputs.length; index++) {
      const argument = inputs[index]!;
      const ak = argument.kind();
      if (ak.$ === "Ref" && ak._0 === return_region) {
        // Need to use the `rustc_middle::ty` types to compare against the
        // `return_region`. Then use the `rustc_hir` type to get only
        // the lifetime span.
        const input_kind = fn_decl.inputs[index]!.kind;
        if (input_kind.$ === "Ref") {
          // With access to the lifetime, we can get
          // the span of it.
          arguments_.push([argument, input_kind._0.ident.span]);
        } else if (input_kind.$ === "Path" && input_kind._0.$ === "Resolved" && input_kind._0._0 === undefined) {
          // Resolve `self` whose self type is `&T`.
          const path = input_kind._0._1;
          let alias_to: LocalDefId | undefined;
          let self_ty: hir.Ty;
          if (
            path.res.$ === "SelfTyAlias" &&
            (alias_to = path.res.alias_to.as_local()) !== undefined &&
            ((self_ty = hir.Node.expect_item(this.infcx.tcx.hir_node_by_def_id(alias_to)).expect_impl().self_ty), true) &&
            self_ty.kind.$ === "Ref"
          ) {
            arguments_.push([argument, self_ty.kind._0.ident.span]);
          }
        } else {
          // Don't ICE though. It might be a type alias.
        }
      }
    }

    // We need to have arguments. This shouldn't happen, but it's worth checking.
    if (arguments_.length === 0) {
      return undefined;
    }

    // We use a mix of the HIR and the Ty types to get information
    // as the HIR doesn't have full types for closure arguments.
    const return_ty = BinderC.skip_binder(PolyFnSigC.output(sig));
    let return_span = hir.FnRetTy.span(fn_decl.output);
    if (fn_decl.output.$ === "Return" && fn_decl.output._0.kind.$ === "Ref") {
      return_span = fn_decl.output._0.kind._0.ident.span;
    }

    return { $: "NamedFunction", arguments: arguments_, return_ty, return_span };
  } else if (rk.$ === "Ref" && is_closure) {
    // This is case 2 from above but only for closures, return type is anonymous
    // reference so we select
    // the first argument.
    const first_input = fn_decl.inputs[0];
    if (first_input === undefined) return undefined;
    const argument_span = first_input.span;
    const argument_ty = BinderC.skip_binder(PolyFnSigC.inputs(sig))[0];
    if (argument_ty === undefined) return undefined;

    // Closure arguments are wrapped in a tuple, so we need to get the first
    // from that.
    const atk = argument_ty.kind();
    if (atk.$ === "Tuple") {
      const argument_ty = atk._0[0];
      if (argument_ty === undefined) return undefined;
      if (argument_ty.kind().$ === "Ref") {
        return { $: "Closure", argument_ty, argument_span };
      }
    }

    return undefined;
  } else if (rk.$ === "Ref") {
    // This is also case 2 from above but for functions, return type is still an
    // anonymous reference so we select the first argument.
    const first_input = fn_decl.inputs[0];
    if (first_input === undefined) return undefined;
    const argument_span = first_input.span;
    const argument_ty = BinderC.skip_binder(PolyFnSigC.inputs(sig))[0];
    if (argument_ty === undefined) return undefined;

    const return_span = hir.FnRetTy.span(fn_decl.output);
    const return_ty = BinderC.skip_binder(PolyFnSigC.output(sig));

    // We expect the first argument to be a reference.
    if (argument_ty.kind().$ !== "Ref") {
      return undefined;
    }

    return { $: "AnonymousFunction", argument_ty, argument_span, return_ty, return_span };
  } else {
    // This is case 3 from above, return type is not a reference so don't highlight
    // anything.
    return undefined;
  }
};

/// Find the `Match` expression desugared from a for loop, whose
/// `IntoIter::into_iter` argument contains `issue_span`.
/// Returns the for-loop match expression span.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4725 find_for_loop_span
export function find_for_loop_span(tcx: TyCtxt, body_id: hir.BodyId, issue_span: Span): Span | undefined {
  // rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4730 ExprFinder
  class ExprFinder extends hir.intravisit.Visitor {
    constructor(
      public tcx: TyCtxt,
      public issue_span: Span,
      public result: Span | undefined,
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4736 visit_expr
    override visit_expr(ex: hir.Expr): undefined {
      if (ex.kind.$ === "Match" && ex.kind._2.$ === "ForLoopDesugar") {
        const scrutinee = ex.kind._0;
        if (scrutinee.kind.$ === "Call" && scrutinee.kind._1.length === 1) {
          const path = scrutinee.kind._0;
          const arg = scrutinee.kind._1[0]!;
          if (path.kind.$ === "Path" && this.tcx.qpath_is_lang_item(path.kind._0, "IntoIterIntoIter") && SpanC.contains(arg.span, this.issue_span)) {
            this.result = ex.span;
            return undefined;
          }
        }
      }
      hir.intravisit.walk_expr(this, ex);
      return undefined;
    }
  }
  const finder = new ExprFinder(tcx, issue_span, undefined);
  finder.visit_expr(tcx.hir_body(body_id).value);
  return finder.result;
}

// impl<'tcx> AnnotatedBorrowFnSignature<'tcx>
export interface AnnotatedBorrowFnSignature_methods {
  // conflict_errors.rs:4757 (lane bck-diag-b)
  emit(self: gen.AnnotatedBorrowFnSignature, cx: MirBorrowckCtxt, diag: Diag): string;
}
export type AnnotatedBorrowFnSignature = gen.AnnotatedBorrowFnSignature;
// PORT: the generator emits no companion for `AnnotatedBorrowFnSignature` (no unit variants).
export const AnnotatedBorrowFnSignature = {} as AnnotatedBorrowFnSignature_methods;

/// Annotate the provided diagnostic with information about borrow from the fn signature that
/// helps explain.
// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4757 emit
AnnotatedBorrowFnSignature.emit = function (self: gen.AnnotatedBorrowFnSignature, cx: MirBorrowckCtxt, diag: Diag): string {
  switch (self.$) {
    case "Closure": {
      const { argument_ty, argument_span } = self;
      diag.span_label(argument_span, `has type \`${cx.get_name_for_ty(argument_ty, 0)}\``);

      return cx.get_region_name_for_ty(argument_ty, 0);
    }
    case "AnonymousFunction": {
      const { argument_ty, argument_span, return_ty, return_span } = self;
      const argument_ty_name = cx.get_name_for_ty(argument_ty, 0);
      diag.span_label(argument_span, `has type \`${argument_ty_name}\``);

      const return_ty_name = cx.get_name_for_ty(return_ty, 0);
      const types_equal = return_ty_name === argument_ty_name;
      diag.span_label(return_span, `${types_equal ? "also " : ""}has type \`${return_ty_name}\``);

      diag.note("argument and return type have the same lifetime due to lifetime elision rules");
      diag.note("to learn more, visit <https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html#lifetime-elision>");

      return cx.get_region_name_for_ty(return_ty, 0);
    }
    case "NamedFunction": {
      const { arguments: arguments_, return_ty, return_span } = self;
      // Region of return type and arguments checked to be the same earlier.
      const region_name = cx.get_region_name_for_ty(return_ty, 0);
      for (const [, argument_span] of arguments_) {
        diag.span_label(argument_span, `has lifetime \`${region_name}\``);
      }

      diag.span_label(return_span, `also has lifetime \`${region_name}\``);

      diag.help(`use data from the highlighted arguments which match the \`${region_name}\` lifetime of the return type`);

      return region_name;
    }
  }
};

/// Detect whether one of the provided spans is a statement nested within the top-most visited expr
// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4818 ReferencedStatementsVisitor
// PORT: hand class (types.sets.json `hand`); the tuple field `&'a [Span]` is `_0`.
export class ReferencedStatementsVisitor extends hir.intravisit.Visitor<ControlFlow<null>> {
  // type Result = ControlFlow<()>;
  override Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(public _0: readonly Span[]) {
    super();
  }

  // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4822 visit_stmt
  override visit_stmt(s: hir.Stmt): ControlFlow<null> {
    if (s.kind.$ === "Semi" && this._0.includes(s.kind._0.span)) {
      return ControlFlow.Break(null);
    }
    return ControlFlow.CONTINUE;
  }
}

/// Look for `break` expressions within any arbitrary expressions. We'll do this to infer
/// whether this is a case where the moved value would affect the exit of a loop, making it
/// unsuitable for a `.clone()` suggestion.
// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4833 BreakFinder
// PORT: hand class (types.sets.json `hand`).
export class BreakFinder extends hir.intravisit.Visitor {
  constructor(
    public found_breaks: [hir.Destination, Span][],
    public found_continues: [hir.Destination, Span][],
  ) {
    super();
  }

  // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4838 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    if (ex.kind.$ === "Break" && !SpanC.is_desugaring(ex.span, DesugaringKind.ForLoop)) {
      this.found_breaks.push([ex.kind._0, ex.span]);
    } else if (ex.kind.$ === "Continue") {
      this.found_continues.push([ex.kind._0, ex.span]);
    }
    hir.intravisit.walk_expr(this, ex);
    return undefined;
  }
}

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4870 new
(ConditionError as unknown as { new: typeof ConditionError.new }).new = function (span: Span, kind: gen.ConditionErrorKind, label: string): ConditionError {
  return new ConditionError(span, label, kind);
};

// impl ConditionErrorKind
export interface ConditionErrorKind_methods {
  // conflict_errors.rs:4882 (lane bck-diag-b)
  describes_condition_value(self: gen.ConditionErrorKind): boolean;
}
export type ConditionErrorKind = gen.ConditionErrorKind;
export const ConditionErrorKind = gen.ConditionErrorKind as typeof gen.ConditionErrorKind & ConditionErrorKind_methods;

// rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4882 describes_condition_value
ConditionErrorKind.describes_condition_value = function (self: gen.ConditionErrorKind): boolean {
  return self === "ConditionValue";
};

/// Given a set of spans representing statements initializing the relevant binding, visit all the
/// function expressions looking for branching code paths that *do not* initialize the binding.
// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4856 ConditionVisitor
// PORT: hand class (types.sets.json `hand`).
export class ConditionVisitor extends hir.intravisit.Visitor {
  constructor(
    public tcx: TyCtxt,
    public spans: Span[],
    public name: string,
    public errors: ConditionError[],
  ) {
    super();
  }

  // rustc: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4888 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    const k = ex.kind;
    if (k.$ === "If" && k._2 === undefined) {
      const cond = k._0;
      const body = k._1;
      // `if` expressions with no `else` that initialize the binding might be missing an
      // `else` arm.
      if (new ReferencedStatementsVisitor(this.spans).visit_expr(body).$ === "Break") {
        this.errors.push(ConditionError.new(cond.span, "ConditionValue", `if this \`if\` condition is \`false\`, ${this.name} is not initialized`));
        this.errors.push(ConditionError.new(SpanC.shrink_to_hi(ex.span), "Other", `an \`else\` arm might be missing here, initializing ${this.name}`));
      }
    } else if (k.$ === "If") {
      const cond = k._0;
      const body = k._1;
      const other = k._2!;
      // `if` expressions where the binding is only initialized in one of the two arms
      // might be missing a binding initialization.
      const a = new ReferencedStatementsVisitor(this.spans).visit_expr(body).$ === "Break";
      const b = new ReferencedStatementsVisitor(this.spans).visit_expr(other).$ === "Break";
      if ((a && b) || (!a && !b)) {
      } else if (a && !b) {
        if (SpanC.is_desugaring(other.span, DesugaringKind.WhileLoop)) {
          this.errors.push(
            ConditionError.new(
              cond.span,
              "ConditionValue",
              `if this condition isn't met and the \`while\` loop runs 0 times, ${this.name} is not initialized`,
            ),
          );
        } else {
          this.errors.push(
            ConditionError.new(
              SpanC.until(SpanC.shrink_to_hi(body.span), other.span),
              "ConditionValue",
              `if the \`if\` condition is \`false\` and this \`else\` arm is executed, ${this.name} is not initialized`,
            ),
          );
        }
      } else {
        // (false, true)
        this.errors.push(ConditionError.new(cond.span, "ConditionValue", `if this condition is \`true\`, ${this.name} is not initialized`));
      }
    } else if (k.$ === "Match") {
      const e = k._0;
      const arms = k._1;
      const loop_desugar = k._2;
      // If the binding is initialized in one of the match arms, then the other match
      // arms might be missing an initialization.
      const results: boolean[] = arms.map((arm) => new ReferencedStatementsVisitor(this.spans).visit_arm(arm).$ === "Break");
      if (results.some((x) => x) && !results.every((x) => x)) {
        for (let i = 0; i < arms.length; i++) {
          const arm = arms[i]!;
          const seen = results[i]!;
          if (!seen) {
            if (loop_desugar.$ === "ForLoopDesugar") {
              this.errors.push(ConditionError.new(e.span, "Other", `if the \`for\` loop runs 0 times, ${this.name} is not initialized`));
            } else if (arm.guard !== undefined) {
              const guard = arm.guard;
              const n = this.tcx.hir_node(arm.body.hir_id);
              if (n.$ === "Expr" && n._0.kind.$ === "Ret") {
                continue;
              }
              this.errors.push(
                ConditionError.new(
                  SpanC.to(arm.pat.span, guard.span),
                  "ConditionValue",
                  `if this pattern and condition are matched, ${this.name} is not initialized`,
                ),
              );
            } else {
              const n = this.tcx.hir_node(arm.body.hir_id);
              if (n.$ === "Expr" && n._0.kind.$ === "Ret") {
                continue;
              }
              this.errors.push(ConditionError.new(arm.pat.span, "Other", `if this pattern is matched, ${this.name} is not initialized`));
            }
          }
        }
      }
    }
    // FIXME: should we also account for binops, particularly `&&` and `||`? `try` should
    // also be accounted for. For now it is fine, as if we don't find *any* relevant
    // branching code paths, we point at the places where the binding *is* initialized for
    // *some* context.
    hir.intravisit.walk_expr(this, ex);
    return undefined;
  }
}
