// Port of compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-c, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the fn-local items (`FindLocalAssignmentVisitor` of `find_assignments`, `SuggestIndexOperatorAlternativeVisitor`
// and its nested `count_ty_refs` / `strip_n_refs` of `suggest_map_index_mut_alternatives`, `Finder` of
// `suggest_similar_mut_method_for_for_loop`) are module level until the fill lane moves them inside.
import type { FieldIdx } from "../../rustc_abi/lib.ts";
import type { ControlFlow } from "../../rustc_ast_ir/visit.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { HirId } from "../../rustc_hir/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { Body, Local, LocalDecl, Location, Place, PlaceRef, Statement } from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { type BorrowckInferCtxt, MirBorrowckCtxt } from "../lib.gen.ts";
import type { AccessKind, AmpMutSugg } from "./mutability_errors.gen.ts";

export * from "./mutability_errors.gen.ts";

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // mutability_errors.rs:62 (lane bck-diag-c)
    report_mutability_error(access_place: Place, span: Span, the_place_err: PlaceRef, error_access: AccessKind, location: Location): void;
    // mutability_errors.rs:667 (lane bck-diag-c)
    suggest_map_index_mut_alternatives(ty: Ty, err: Diag, span: Span): void;
    // mutability_errors.rs:909 (lane bck-diag-c)
    is_error_in_trait(local: Local): [boolean, boolean, Span | undefined];
    // mutability_errors.rs:941 (lane bck-diag-c)
    construct_mut_suggestion_for_local_binding_patterns(err: Diag, local: Local): void;
    // mutability_errors.rs:1002 (lane bck-diag-c)
    show_mutating_upvar(tcx: TyCtxt, closure_local_def_id: LocalDefId, the_place_err: PlaceRef, err: Diag): void;
    // mutability_errors.rs:1078 (lane bck-diag-c)
    suggest_similar_mut_method_for_for_loop(err: Diag, span: Span): void;
    // mutability_errors.rs:1171 (lane bck-diag-c)
    point_at_binding_outside_closure(err: Diag, local: Local, access_place: Place): void;
    // mutability_errors.rs:1215 (lane bck-diag-c)
    expected_fn_found_fn_mut_call(err: Diag, sp: Span, act: string): void;
    // mutability_errors.rs:1359 (lane bck-diag-c)
    suggest_using_iter_mut(err: Diag): void;
    // mutability_errors.rs:1400 (lane bck-diag-c)
    suggest_make_local_mut(err: Diag, local: Local, name: Symbol): void;
    // mutability_errors.rs:1746 (lane bck-diag-c)
    is_closure_arg_with_non_locally_decided_type(local: Local): boolean;
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:36 find_assignments (lane bck-diag-c)
function find_assignments(body: Body, local: Local): Location[] {
  return unported("rustc_borrowck::diagnostics::mutability_errors::find_assignments");
}

// rustc-type: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:39 FindLocalAssignmentVisitor
class FindLocalAssignmentVisitor extends Visitor {
  constructor(
    public needle: Local,
    public locations: Location[],
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for FindLocalAssignmentVisitor
  // stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:45 visit_local (lane bck-diag-c)
  override visit_local(local: Local, place_context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::diagnostics::mutability_errors::find_assignments::FindLocalAssignmentVisitor::visit_local");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:62 report_mutability_error (lane bck-diag-c)
MirBorrowckCtxt.prototype.report_mutability_error = function (
  this: MirBorrowckCtxt,
  access_place: Place,
  span: Span,
  the_place_err: PlaceRef,
  error_access: AccessKind,
  location: Location,
): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::report_mutability_error");
};

/// Suggest `map[k] = v` => `map.insert(k, v)` and the like.
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:667 suggest_map_index_mut_alternatives (lane bck-diag-c)
MirBorrowckCtxt.prototype.suggest_map_index_mut_alternatives = function (this: MirBorrowckCtxt, ty: Ty, err: Diag, span: Span): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::suggest_map_index_mut_alternatives");
};

/// Walks through the HIR, looking for the corresponding span for this error.
/// When it finds it, see if it corresponds to assignment operator whose LHS
/// is an index expr.
// rustc-type: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:676 SuggestIndexOperatorAlternativeVisitor
class SuggestIndexOperatorAlternativeVisitor extends hir.intravisit.Visitor {
  constructor(
    public assign_span: Span,
    public err: Diag,
    public ty: Ty,
    public suggested: boolean,
    public infcx: InferCtxt,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for SuggestIndexOperatorAlternativeVisitor<'_, '_, 'tcx>
  // stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:685 visit_stmt (lane bck-diag-c)
  override visit_stmt(stmt: hir.Stmt): undefined {
    return unported("rustc_borrowck::diagnostics::mutability_errors::SuggestIndexOperatorAlternativeVisitor::visit_stmt");
  }
}

/// Taken straight from https://doc.rust-lang.org/nightly/nightly-rustc/clippy_utils/fn.peel_hir_ty_refs.html
/// Adapted to mid using https://doc.rust-lang.org/nightly/nightly-rustc/rustc_middle/ty/struct.Ty.html#method.peel_refs
/// Simplified to counting only
/// Peels off all references on the type. Returns the number of references
/// removed.
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:708 count_ty_refs (lane bck-diag-c)
function count_ty_refs(ty: Ty): number {
  return unported("rustc_borrowck::diagnostics::mutability_errors::SuggestIndexOperatorAlternativeVisitor::visit_stmt::count_ty_refs");
}

/// Try to strip `n` `&` reference from an expression.
/// If the expression does not have enough leading `&`, return an Error
/// containing a count of the successfully stripped ones and the stripped
/// expression.
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:721 strip_n_refs (lane bck-diag-c)
function strip_n_refs(expr: hir.Expr, n: number): Result<hir.Expr, [number, hir.Expr]> {
  return unported("rustc_borrowck::diagnostics::mutability_errors::SuggestIndexOperatorAlternativeVisitor::visit_stmt::strip_n_refs");
}

/// User cannot make signature of a trait mutable without changing the
/// trait. So we find if this error belongs to a trait and if so we move
/// suggestion to the trait or disable it if it is out of scope of this crate
///
/// The returned values are:
///  - is the current item an assoc `fn` of an impl that corresponds to a trait def? if so, we
///    have to suggest changing both the impl `fn` arg and the trait `fn` arg
///  - is the trait from the local crate? If not, we can't suggest changing signatures
///  - `Span` of the argument in the trait definition
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:909 is_error_in_trait (lane bck-diag-c)
MirBorrowckCtxt.prototype.is_error_in_trait = function (this: MirBorrowckCtxt, local: Local): [boolean, boolean, Span | undefined] {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::is_error_in_trait");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:941 construct_mut_suggestion_for_local_binding_patterns (lane bck-diag-c)
MirBorrowckCtxt.prototype.construct_mut_suggestion_for_local_binding_patterns = function (this: MirBorrowckCtxt, err: Diag, local: Local): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::construct_mut_suggestion_for_local_binding_patterns");
};

// Point to span of upvar making closure call that requires a mutable borrow
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1002 show_mutating_upvar (lane bck-diag-c)
MirBorrowckCtxt.prototype.show_mutating_upvar = function (
  this: MirBorrowckCtxt,
  tcx: TyCtxt,
  closure_local_def_id: LocalDefId,
  the_place_err: PlaceRef,
  err: Diag,
): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::show_mutating_upvar");
};

// Attempt to search similar mutable associated items for suggestion.
// In the future, attempt in all path but initially for RHS of for_loop
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1078 suggest_similar_mut_method_for_for_loop (lane bck-diag-c)
MirBorrowckCtxt.prototype.suggest_similar_mut_method_for_for_loop = function (this: MirBorrowckCtxt, err: Diag, span: Span): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::suggest_similar_mut_method_for_for_loop");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1083 Finder
class Finder extends hir.intravisit.Visitor<ControlFlow<hir.Expr>> {
  constructor(public span: Span) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for Finder
  // stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1089 visit_expr (lane bck-diag-c)
  override visit_expr(e: hir.Expr): ControlFlow<hir.Expr> {
    return unported("rustc_borrowck::diagnostics::mutability_errors::suggest_similar_mut_method_for_for_loop::Finder::visit_expr");
  }
}

/// When modifying a binding from inside of an `Fn` closure, point at the binding definition.
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1171 point_at_binding_outside_closure (lane bck-diag-c)
MirBorrowckCtxt.prototype.point_at_binding_outside_closure = function (this: MirBorrowckCtxt, err: Diag, local: Local, access_place: Place): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::point_at_binding_outside_closure");
};

/// Targeted error when encountering an `FnMut` closure where an `Fn` closure was expected.
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1215 expected_fn_found_fn_mut_call (lane bck-diag-c)
MirBorrowckCtxt.prototype.expected_fn_found_fn_mut_call = function (this: MirBorrowckCtxt, err: Diag, sp: Span, act: string): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::expected_fn_found_fn_mut_call");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1359 suggest_using_iter_mut (lane bck-diag-c)
MirBorrowckCtxt.prototype.suggest_using_iter_mut = function (this: MirBorrowckCtxt, err: Diag): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::suggest_using_iter_mut");
};

// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1400 suggest_make_local_mut (lane bck-diag-c)
MirBorrowckCtxt.prototype.suggest_make_local_mut = function (this: MirBorrowckCtxt, err: Diag, local: Local, name: Symbol): void {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::suggest_make_local_mut");
};

/// Returns `true` if `local` is an argument in a closure passed to a
/// function defined in another crate.
///
/// For example, in the following code this function returns `true` for `x`
/// since `Option::inspect()` is not defined in the current crate:
///
/// ```text
/// some_option.as_mut().inspect(|x| {
/// ```
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1746 is_closure_arg_with_non_locally_decided_type (lane bck-diag-c)
MirBorrowckCtxt.prototype.is_closure_arg_with_non_locally_decided_type = function (this: MirBorrowckCtxt, local: Local): boolean {
  return unported("rustc_borrowck::diagnostics::mutability_errors::MirBorrowckCtxt::is_closure_arg_with_non_locally_decided_type");
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1792 BindingFinder
export class BindingFinder extends hir.intravisit.Visitor<ControlFlow<HirId>> {
  constructor(public span: Span) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for BindingFinder
  // stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1798 visit_stmt (lane bck-diag-c)
  override visit_stmt(s: hir.Stmt): ControlFlow<HirId> {
    return unported("rustc_borrowck::diagnostics::mutability_errors::BindingFinder::visit_stmt");
  }

  // stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1808 visit_param (lane bck-diag-c)
  override visit_param(param: hir.Param): ControlFlow<HirId> {
    return unported("rustc_borrowck::diagnostics::mutability_errors::BindingFinder::visit_param");
  }
}

// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1819 mut_borrow_of_mutable_ref (lane bck-diag-c)
function mut_borrow_of_mutable_ref(local_decl: LocalDecl, local_name: Symbol | undefined): boolean {
  return unported("rustc_borrowck::diagnostics::mutability_errors::mut_borrow_of_mutable_ref");
}

// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1846 suggest_ampmut_self (lane bck-diag-c)
function suggest_ampmut_self(tcx: TyCtxt, span: Span): [Span, string] {
  return unported("rustc_borrowck::diagnostics::mutability_errors::suggest_ampmut_self");
}

// When we want to suggest a user change a local variable to be a `&mut`, there
// are three potential "obvious" things to highlight:
//
// let ident [: Type] [= RightHandSideExpression];
//     ^^^^^    ^^^^     ^^^^^^^^^^^^^^^^^^^^^^^
//     (1.)     (2.)              (3.)
//
// We can always fallback on highlighting the first. But chances are good that
// the user experience will be better if we highlight one of the others if possible;
// for example, if the RHS is present and the Type is not, then the type is going to
// be inferred *from* the RHS, which means we should highlight that (and suggest
// that they borrow the RHS mutably).
//
// This implementation attempts to emulate AST-borrowck prioritization
// by trying (3.), then (2.) and finally falling back on (1.).
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1891 suggest_ampmut (lane bck-diag-c)
function suggest_ampmut(infcx: BorrowckInferCtxt, body: Body, opt_assignment_rhs_stmt: Statement | undefined): AmpMutSugg | undefined {
  return unported("rustc_borrowck::diagnostics::mutability_errors::suggest_ampmut");
}

/// If the type is a `Coroutine`, `Closure`, or `CoroutineClosure`
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1999 is_closure_like (lane bck-diag-c)
function is_closure_like(ty: Ty): boolean {
  return unported("rustc_borrowck::diagnostics::mutability_errors::is_closure_like");
}

/// Given a field that needs to be mutable, returns a span where the " mut " could go.
/// This function expects the local to be a reference to a struct in order to produce a span.
///
/// ```text
/// LL |     s: &'a   String
///    |           ^^^ returns a span taking up the space here
/// ```
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:2010 get_mut_span_in_struct_field (lane bck-diag-c)
function get_mut_span_in_struct_field(tcx: TyCtxt, ty: Ty, field: FieldIdx): Span | undefined {
  return unported("rustc_borrowck::diagnostics::mutability_errors::get_mut_span_in_struct_field");
}

/// If possible, suggest replacing `ref` with `ref mut`.
// stub: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:2031 suggest_ref_mut (lane bck-diag-c)
function suggest_ref_mut(tcx: TyCtxt, span: Span): Span | undefined {
  return unported("rustc_borrowck::diagnostics::mutability_errors::suggest_ref_mut");
}
