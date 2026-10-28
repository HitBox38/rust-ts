// Port of compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs (lane borrowck-contract: declarations; fill lanes
// bck-diag-a (lines < 2469) and bck-diag-b (lines >= 2469), plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the fn-local types of upstream's methods (hir / mir / type visitors) are module-level classes until their fill lane
// moves them inside (contract convention "fn-local items"); a name used by two fn-local types gets the upstream line of
// its `struct` as suffix (`ExpressionFinder_366` / `ExpressionFinder_2833`, `ExprFinder_2481` / `ExprFinder_4730`).
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

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2469 explain_iterator_advancement_in_for_loop_if_applicable (lane bck-diag-b)
MirBorrowckCtxt.prototype.explain_iterator_advancement_in_for_loop_if_applicable = function (
  this: MirBorrowckCtxt,
  err: Diag,
  span: Span,
  issued_spans: UseSpans,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::explain_iterator_advancement_in_for_loop_if_applicable");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2481 ExprFinder
// (fn-local to `explain_iterator_advancement_in_for_loop_if_applicable`; the `= None` default field values are the
// constructor arguments of its single construction site)
export class ExprFinder_2481 extends hir.intravisit.Visitor {
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

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2493 visit_expr (lane bck-diag-b)
  override visit_expr(ex: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::explain_iterator_advancement_in_for_loop_if_applicable::ExprFinder::visit_expr");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2641 explain_iterator_invalidation_in_for_loop_if_applicable (lane bck-diag-b)
MirBorrowckCtxt.prototype.explain_iterator_invalidation_in_for_loop_if_applicable = function (
  this: MirBorrowckCtxt,
  err: Diag,
  issued_spans: UseSpans,
  place: Place,
  borrowed_place: Place,
  borrow_kind: BorrowKind,
  gen_span: Span,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::explain_iterator_invalidation_in_for_loop_if_applicable");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2692 suggest_using_closure_argument_instead_of_capture (lane bck-diag-b)
MirBorrowckCtxt.prototype.suggest_using_closure_argument_instead_of_capture = function (
  this: MirBorrowckCtxt,
  err: Diag,
  borrowed_place: Place,
  issued_spans: UseSpans,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_using_closure_argument_instead_of_capture");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2710 ClosureFinder
// (fn-local to `suggest_using_closure_argument_instead_of_capture`)
export class ClosureFinder extends hir.intravisit.Visitor {
  constructor(
    public tcx: TyCtxt,
    public borrow_span: Span,
    public res: [hir.Expr, hir.Closure] | undefined,
    /// The path expression with the `borrow_span` span
    public error_path: [hir.Expr, hir.QPath] | undefined,
  ) {
    super();
  }

  // type NestedFilter = OnlyBodies; (set by the fill lane)

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2720 maybe_tcx (lane bck-diag-b)
  override maybe_tcx(): HirTyCtxt {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_using_closure_argument_instead_of_capture::ClosureFinder::maybe_tcx");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2724 visit_expr (lane bck-diag-b)
  override visit_expr(ex: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_using_closure_argument_instead_of_capture::ClosureFinder::visit_expr");
  }
}

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2793 VariableUseFinder
// (fn-local to `suggest_using_closure_argument_instead_of_capture`)
export class VariableUseFinder extends hir.intravisit.Visitor {
  constructor(
    public local_id: hir.HirId,
    public spans: Span[],
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2798 visit_expr (lane bck-diag-b)
  override visit_expr(ex: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_using_closure_argument_instead_of_capture::VariableUseFinder::visit_expr");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2826 suggest_binding_for_closure_capture_self (lane bck-diag-b)
MirBorrowckCtxt.prototype.suggest_binding_for_closure_capture_self = function (this: MirBorrowckCtxt, err: Diag, issued_spans: UseSpans): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_binding_for_closure_capture_self");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2833 ExpressionFinder
// (fn-local to `suggest_binding_for_closure_capture_self`; the default field values (`= vec![]`, `= None`, `= false`,
// `= String::new()`) are the constructor arguments of its single construction site)
export class ExpressionFinder_2833 extends hir.intravisit.Visitor {
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

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2844 visit_expr (lane bck-diag-b)
  override visit_expr(e: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_binding_for_closure_capture_self::ExpressionFinder::visit_expr");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2874 visit_local (lane bck-diag-b)
  override visit_local(local: hir.LetStmt): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_binding_for_closure_capture_self::ExpressionFinder::visit_local");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2894 visit_stmt (lane bck-diag-b)
  override visit_stmt(s: hir.Stmt): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_binding_for_closure_capture_self::ExpressionFinder::visit_stmt");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2977 describe_place_for_conflicting_borrow (lane bck-diag-b)
MirBorrowckCtxt.prototype.describe_place_for_conflicting_borrow = function (
  this: MirBorrowckCtxt,
  first_borrowed_place: Place,
  second_borrowed_place: Place,
): [string, string, string, string] {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::describe_place_for_conflicting_borrow");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3053 report_borrowed_value_does_not_live_long_enough (lane bck-diag-b)
MirBorrowckCtxt.prototype.report_borrowed_value_does_not_live_long_enough = function (
  this: MirBorrowckCtxt,
  location: Location,
  borrow: BorrowData,
  place_span: [Place, Span],
  kind: WriteKind | undefined,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_borrowed_value_does_not_live_long_enough");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3200 report_local_value_does_not_live_long_enough (lane bck-diag-b)
MirBorrowckCtxt.prototype.report_local_value_does_not_live_long_enough = function (
  this: MirBorrowckCtxt,
  location: Location,
  name: string,
  borrow: BorrowData,
  drop_span: Span,
  borrow_spans: UseSpans,
  explanation: BorrowExplanation,
): Diag {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_local_value_does_not_live_long_enough");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3325 report_borrow_conflicts_with_destructor (lane bck-diag-b)
MirBorrowckCtxt.prototype.report_borrow_conflicts_with_destructor = function (
  this: MirBorrowckCtxt,
  location: Location,
  borrow: BorrowData,
  [place, drop_span]: [Place, Span],
  kind: WriteKind | undefined,
  dropped_ty: Ty,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_borrow_conflicts_with_destructor");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3377 report_thread_local_value_does_not_live_long_enough (lane bck-diag-b)
MirBorrowckCtxt.prototype.report_thread_local_value_does_not_live_long_enough = function (this: MirBorrowckCtxt, drop_span: Span, borrow_span: Span): Diag {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_thread_local_value_does_not_live_long_enough");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3410 report_temporary_value_does_not_live_long_enough (lane bck-diag-b)
MirBorrowckCtxt.prototype.report_temporary_value_does_not_live_long_enough = function (
  this: MirBorrowckCtxt,
  location: Location,
  borrow: BorrowData,
  drop_span: Span,
  borrow_spans: UseSpans,
  proper_span: Span,
  explanation: BorrowExplanation,
): Diag {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_temporary_value_does_not_live_long_enough");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3455 NestedStatementVisitor
// (fn-local to `report_temporary_value_does_not_live_long_enough`)
export class NestedStatementVisitor extends hir.intravisit.Visitor {
  constructor(
    public span: Span,
    public current: number,
    public found: number,
    public prop_expr: hir.Expr | undefined,
    public call: hir.Expr | undefined,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3464 visit_block (lane bck-diag-b)
  override visit_block(block: hir.Block): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_temporary_value_does_not_live_long_enough::NestedStatementVisitor::visit_block");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3469 visit_expr (lane bck-diag-b)
  override visit_expr(expr: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_temporary_value_does_not_live_long_enough::NestedStatementVisitor::visit_expr");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3566 try_report_cannot_return_reference_to_local (lane bck-diag-b)
MirBorrowckCtxt.prototype.try_report_cannot_return_reference_to_local = function (
  this: MirBorrowckCtxt,
  borrow: BorrowData,
  borrow_span: Span,
  return_span: Span,
  category: ConstraintCategory,
  opt_place_desc: string | undefined,
): Result<null, Diag> {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::try_report_cannot_return_reference_to_local");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3682 report_escaping_closure_capture (lane bck-diag-b)
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
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_escaping_closure_capture");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3802 report_escaping_data (lane bck-diag-b)
MirBorrowckCtxt.prototype.report_escaping_data = function (
  this: MirBorrowckCtxt,
  borrow_span: Span,
  name: string | undefined,
  upvar_span: Span,
  upvar_name: Symbol,
  escape_span: Span,
): Diag {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_escaping_data");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3836 get_moved_indexes (lane bck-diag-b)
MirBorrowckCtxt.prototype.get_moved_indexes = function (this: MirBorrowckCtxt, location: Location, mpi: MovePathIndex): [MoveSite[], Location[]] {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::get_moved_indexes");
};

// (fn-local to `get_moved_indexes`)
// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:3841 predecessor_locations (lane bck-diag-b)
export function predecessor_locations(body: Body, location: Location): Iterable<Location> {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::get_moved_indexes::predecessor_locations");
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4026 report_illegal_mutation_of_borrowed (lane bck-diag-b)
MirBorrowckCtxt.prototype.report_illegal_mutation_of_borrowed = function (this: MirBorrowckCtxt, location: Location, [place, span]: [Place, Span], loan: BorrowData): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_illegal_mutation_of_borrowed");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4083 explain_deref_coercion (lane bck-diag-b)
MirBorrowckCtxt.prototype.explain_deref_coercion = function (this: MirBorrowckCtxt, loan: BorrowData, err: Diag): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::explain_deref_coercion");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4116 report_illegal_reassignment (lane bck-diag-b)
MirBorrowckCtxt.prototype.report_illegal_reassignment = function (this: MirBorrowckCtxt, [place, span]: [Place, Span], assigned_span: Span, err_place: Place): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_illegal_reassignment");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4172 RefPatternFinder
// (fn-local to `report_illegal_reassignment`)
export class RefPatternFinder extends hir.intravisit.Visitor {
  constructor(
    public tcx: TyCtxt,
    public binding_span: Span,
    public is_immut_ref_pattern: boolean,
  ) {
    super();
  }

  // type NestedFilter = OnlyBodies; (set by the fill lane)

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4181 maybe_tcx (lane bck-diag-b)
  override maybe_tcx(): HirTyCtxt {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_illegal_reassignment::RefPatternFinder::maybe_tcx");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4185 visit_pat (lane bck-diag-b)
  override visit_pat(pat: hir.Pat): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_illegal_reassignment::RefPatternFinder::visit_pat");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4252 classify_drop_access_kind (lane bck-diag-b)
MirBorrowckCtxt.prototype.classify_drop_access_kind = function (this: MirBorrowckCtxt, place: PlaceRef): StorageDeadOrDrop {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::classify_drop_access_kind");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4307 classify_immutable_section (lane bck-diag-b)
MirBorrowckCtxt.prototype.classify_immutable_section = function (this: MirBorrowckCtxt, place: Place): string | undefined {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::classify_immutable_section");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4309 FakeReadCauseFinder
// (fn-local to `classify_immutable_section`; a mir `Visitor`)
export class FakeReadCauseFinder extends MirVisitor {
  constructor(
    public place: Place,
    public cause: FakeReadCause | undefined,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4314 visit_statement (lane bck-diag-b)
  override visit_statement(statement: Statement, _1: Location): void {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::classify_immutable_section::FakeReadCauseFinder::visit_statement");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4336 annotate_argument_and_return_for_borrow (lane bck-diag-b)
MirBorrowckCtxt.prototype.annotate_argument_and_return_for_borrow = function (this: MirBorrowckCtxt, borrow: BorrowData): gen.AnnotatedBorrowFnSignature | undefined {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::annotate_argument_and_return_for_borrow");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4555 annotate_fn_sig (lane bck-diag-b)
MirBorrowckCtxt.prototype.annotate_fn_sig = function (this: MirBorrowckCtxt, did: LocalDefId, sig: PolyFnSig): gen.AnnotatedBorrowFnSignature | undefined {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::annotate_fn_sig");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4725 find_for_loop_span (lane bck-diag-b)
export function find_for_loop_span(tcx: TyCtxt, body_id: hir.BodyId, issue_span: Span): Span | undefined {
  return unported("rustc_borrowck::diagnostics::conflict_errors::find_for_loop_span");
}

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4730 ExprFinder
// (fn-local to `find_for_loop_span`)
export class ExprFinder_4730 extends hir.intravisit.Visitor {
  constructor(
    public tcx: TyCtxt,
    public issue_span: Span,
    public result: Span | undefined,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4736 visit_expr (lane bck-diag-b)
  override visit_expr(ex: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::find_for_loop_span::ExprFinder::visit_expr");
  }
}

// impl<'tcx> AnnotatedBorrowFnSignature<'tcx>
export interface AnnotatedBorrowFnSignature_methods {
  // conflict_errors.rs:4757 (lane bck-diag-b)
  emit(self: gen.AnnotatedBorrowFnSignature, cx: MirBorrowckCtxt, diag: Diag): string;
}
export type AnnotatedBorrowFnSignature = gen.AnnotatedBorrowFnSignature;
// PORT: the generator emits no companion for `AnnotatedBorrowFnSignature` (no unit variants).
export const AnnotatedBorrowFnSignature = {} as AnnotatedBorrowFnSignature_methods;

/// Annotate the first argument and return type of a function signature if they are
/// references.
// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4757 emit (lane bck-diag-b)
AnnotatedBorrowFnSignature.emit = function (self: gen.AnnotatedBorrowFnSignature, cx: MirBorrowckCtxt, diag: Diag): string {
  return unported("rustc_borrowck::diagnostics::conflict_errors::AnnotatedBorrowFnSignature::emit");
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

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4822 visit_stmt (lane bck-diag-b)
  override visit_stmt(s: hir.Stmt): ControlFlow<null> {
    return unported("rustc_borrowck::diagnostics::conflict_errors::ReferencedStatementsVisitor::visit_stmt");
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

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4838 visit_expr (lane bck-diag-b)
  override visit_expr(ex: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::BreakFinder::visit_expr");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4870 new (lane bck-diag-b)
(ConditionError as unknown as { new: typeof ConditionError.new }).new = function (span: Span, kind: gen.ConditionErrorKind, label: string): ConditionError {
  return unported("rustc_borrowck::diagnostics::conflict_errors::ConditionError::new");
};

// impl ConditionErrorKind
export interface ConditionErrorKind_methods {
  // conflict_errors.rs:4882 (lane bck-diag-b)
  describes_condition_value(self: gen.ConditionErrorKind): boolean;
}
export type ConditionErrorKind = gen.ConditionErrorKind;
export const ConditionErrorKind = gen.ConditionErrorKind as typeof gen.ConditionErrorKind & ConditionErrorKind_methods;

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4882 describes_condition_value (lane bck-diag-b)
ConditionErrorKind.describes_condition_value = function (self: gen.ConditionErrorKind): boolean {
  return unported("rustc_borrowck::diagnostics::conflict_errors::ConditionErrorKind::describes_condition_value");
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

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:4888 visit_expr (lane bck-diag-b)
  override visit_expr(ex: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::ConditionVisitor::visit_expr");
  }
}
