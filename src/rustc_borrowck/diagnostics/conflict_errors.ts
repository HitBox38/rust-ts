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

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:74 report_use_of_moved_or_uninitialized (lane bck-diag-a)
MirBorrowckCtxt.prototype.report_use_of_moved_or_uninitialized = function (
  this: MirBorrowckCtxt,
  location: Location,
  desired_action: InitializationRequiringAction,
  [moved_place, used_place, span]: [PlaceRef, PlaceRef, Span],
  mpi: MovePathIndex,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_use_of_moved_or_uninitialized");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:353 suggest_ref_or_clone (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_ref_or_clone = function (
  this: MirBorrowckCtxt,
  mpi: MovePathIndex,
  err: Diag,
  move_spans: UseSpans,
  moved_place: PlaceRef,
  has_suggest_reborrow: MutRef<boolean>,
  moved_or_invoked_closure: boolean,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_ref_or_clone");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:366 ExpressionFinder
// (fn-local to `suggest_ref_or_clone`)
export class ExpressionFinder_366 extends hir.intravisit.Visitor {
  constructor(
    public expr_span: Span,
    public expr: hir.Expr | undefined,
    public pat: hir.Pat | undefined,
    public parent_pat: hir.Pat | undefined,
    public tcx: TyCtxt,
  ) {
    super();
  }

  // type NestedFilter = OnlyBodies; (set by the fill lane)

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:376 maybe_tcx (lane bck-diag-a)
  override maybe_tcx(): HirTyCtxt {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_ref_or_clone::ExpressionFinder::maybe_tcx");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:380 visit_expr (lane bck-diag-a)
  override visit_expr(e: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_ref_or_clone::ExpressionFinder::visit_expr");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:386 visit_pat (lane bck-diag-a)
  override visit_pat(p: hir.Pat): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_ref_or_clone::ExpressionFinder::visit_pat");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:588 suggest_ref_for_dbg_args (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_ref_for_dbg_args = function (this: MirBorrowckCtxt, body: hir.Expr, place: Place, move_span: Span, err: Diag): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_ref_for_dbg_args");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:601 MatchArgFinder
// (fn-local to `suggest_ref_for_dbg_args`)
export class MatchArgFinder extends hir.intravisit.Visitor {
  constructor(
    public expr_span: Span,
    public match_arg_span: Span | undefined,
    public arg_name: Symbol,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:607 visit_expr (lane bck-diag-a)
  override visit_expr(e: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_ref_for_dbg_args::MatchArgFinder::visit_expr");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:635 suggest_reborrow (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_reborrow = function (this: MirBorrowckCtxt, err: Diag, span: Span, moved_place: PlaceRef): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_reborrow");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:660 suggest_borrow_generic_arg (lane bck-diag-a)
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
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_borrow_generic_arg");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:795 is_init_reachable (lane bck-diag-a)
MirBorrowckCtxt.prototype.is_init_reachable = function (this: MirBorrowckCtxt, init: Init, err_location: Location): boolean {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::is_init_reachable");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:823 report_use_of_uninitialized (lane bck-diag-a)
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
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_use_of_uninitialized");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:968 LetVisitor
// (fn-local to `report_use_of_uninitialized`)
export class LetVisitor extends hir.intravisit.Visitor {
  constructor(
    public decl_span: Span,
    public sugg: [Span, boolean] | undefined,
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:974 visit_stmt (lane bck-diag-a)
  override visit_stmt(ex: hir.Stmt): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_use_of_uninitialized::LetVisitor::visit_stmt");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1005 suggest_assign_value (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_assign_value = function (this: MirBorrowckCtxt, err: Diag, moved_place: PlaceRef, sugg_span: Span, strip_ref: boolean): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_assign_value");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1035 suggest_hoisting_call_outside_loop (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_hoisting_call_outside_loop = function (this: MirBorrowckCtxt, err: Diag, expr: hir.Expr): boolean {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_hoisting_call_outside_loop");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1057 Finder
// (fn-local to `suggest_hoisting_call_outside_loop`)
export class Finder extends hir.intravisit.Visitor<ControlFlow<null>> {
  // type Result = ControlFlow<()>;
  override Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(public hir_id: hir.HirId) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1062 visit_pat (lane bck-diag-a)
  override visit_pat(pat: hir.Pat): ControlFlow<null> {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_hoisting_call_outside_loop::Finder::visit_pat");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1068 visit_expr (lane bck-diag-a)
  override visit_expr(ex: hir.Expr): ControlFlow<null> {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_hoisting_call_outside_loop::Finder::visit_expr");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1253 suggest_cloning_on_functional_record_update (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_cloning_on_functional_record_update = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, expr: hir.Expr): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_cloning_on_functional_record_update");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1345 suggest_cloning (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_cloning = function (this: MirBorrowckCtxt, err: Diag, place: PlaceRef, ty: Ty, expr: hir.Expr, use_spans: UseSpans | undefined): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_cloning");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1510 implements_clone (lane bck-diag-a)
MirBorrowckCtxt.prototype.implements_clone = function (this: MirBorrowckCtxt, ty: Ty): boolean {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::implements_clone");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1519 clone_on_reference (lane bck-diag-a)
MirBorrowckCtxt.prototype.clone_on_reference = function (this: MirBorrowckCtxt, expr: hir.Expr): Span | undefined {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::clone_on_reference");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1534 in_move_closure (lane bck-diag-a)
MirBorrowckCtxt.prototype.in_move_closure = function (this: MirBorrowckCtxt, expr: hir.Expr): boolean {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::in_move_closure");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1546 suggest_cloning_inner (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_cloning_inner = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, expr: hir.Expr): boolean {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_cloning_inner");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1637 suggest_adding_bounds (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_adding_bounds = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, def_id: DefId, span: Span): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_adding_bounds");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1684 report_move_out_while_borrowed (lane bck-diag-a)
MirBorrowckCtxt.prototype.report_move_out_while_borrowed = function (this: MirBorrowckCtxt, location: Location, [place, span]: [Place, Span], borrow: BorrowData): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_move_out_while_borrowed");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1752 report_use_while_mutably_borrowed (lane bck-diag-a)
MirBorrowckCtxt.prototype.report_use_while_mutably_borrowed = function (this: MirBorrowckCtxt, location: Location, [place, _span]: [Place, Span], borrow: BorrowData): Diag {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_use_while_mutably_borrowed");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:1796 report_conflicting_borrow (lane bck-diag-a)
MirBorrowckCtxt.prototype.report_conflicting_borrow = function (
  this: MirBorrowckCtxt,
  location: Location,
  [place, span]: [Place, Span],
  gen_borrow_kind: BorrowKind,
  issued_borrow: BorrowData,
): Diag {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::report_conflicting_borrow");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2108 suggest_copy_for_type_in_cloned_ref (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_copy_for_type_in_cloned_ref = function (this: MirBorrowckCtxt, err: Diag, place: Place): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_copy_for_type_in_cloned_ref");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2112 FindUselessClone
// (fn-local to `suggest_copy_for_type_in_cloned_ref`)
export class FindUselessClone extends hir.intravisit.Visitor {
  constructor(
    public tcx: TyCtxt,
    public typeck_results: TypeckResults,
    public clones: hir.Expr[],
  ) {
    super();
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2118 new (lane bck-diag-a)
  static new(tcx: TyCtxt, def_id: LocalDefId): FindUselessClone {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_copy_for_type_in_cloned_ref::FindUselessClone::new");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2123 visit_expr (lane bck-diag-a)
  override visit_expr(ex: hir.Expr): undefined {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_copy_for_type_in_cloned_ref::FindUselessClone::visit_expr");
  }
}

// rustc-type: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2140 Holds
// (fn-local to `suggest_copy_for_type_in_cloned_ref`)
export class Holds implements TypeVisitor<ControlFlow<null>> {
  /** `impl TypeVisitor`: `type Result = std::ops::ControlFlow<()>`. */
  readonly Result: VisitorResult<ControlFlow<null>, null> = VisitorResultC.ControlFlow<null>();

  constructor(public ty: Ty) {}

  // stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2147 visit_ty (lane bck-diag-a)
  visit_ty(t: Ty): ControlFlow<null> {
    return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_copy_for_type_in_cloned_ref::Holds::visit_ty");
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

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2186 suggest_adding_bounds_or_derive (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_adding_bounds_or_derive = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, trait_def_id: DefId, span: Span): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_adding_bounds_or_derive");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2213 suggest_using_local_if_applicable (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_using_local_if_applicable = function (
  this: MirBorrowckCtxt,
  err: Diag,
  location: Location,
  issued_borrow: BorrowData,
  explanation: BorrowExplanation,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_using_local_if_applicable");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2322 find_expr (lane bck-diag-a)
MirBorrowckCtxt.prototype.find_expr = function (this: MirBorrowckCtxt, span: Span): hir.Expr | undefined {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::find_expr");
};

// stub: compiler/rustc_borrowck/src/diagnostics/conflict_errors.rs:2330 suggest_slice_method_if_applicable (lane bck-diag-a)
MirBorrowckCtxt.prototype.suggest_slice_method_if_applicable = function (
  this: MirBorrowckCtxt,
  err: Diag,
  place: Place,
  borrowed_place: Place,
  span: Span,
  issued_span: Span,
): void {
  return unported("rustc_borrowck::diagnostics::conflict_errors::MirBorrowckCtxt::suggest_slice_method_if_applicable");
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
