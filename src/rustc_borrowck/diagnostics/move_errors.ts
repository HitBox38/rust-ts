// Port of compiler/rustc_borrowck/src/diagnostics/move_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-d, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `append_to_grouped_errors`'s destructuring parameter `MoveError { place: original_path, location, kind }` is the
// parameter `move_error` (the fill lane destructures it in the body).
import { Mutability, Pinnedness } from "../../rustc_ast_ir/lib.ts";
import { FieldIdx } from "../../rustc_abi/lib.ts";
import { Applicability, type Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import { HirIdSet } from "../../rustc_hir_id/lib.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../rustc_middle/hir/nested_filter.ts";
import { type Local, type Location, type Place, PlaceRef, PlaceRef_from_Local, ProjectionElem } from "../../rustc_middle/mir/mod.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg, fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { Asyncness, type InstantiatedClauses, type Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import { type ExpnKind, SyntaxContext } from "../../rustc_span/hygiene.ts";
import { BytePos, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { sym, Symbol } from "../../rustc_span/symbol.ts";
import { FindExprBySpan } from "../../rustc_trait_selection/error_reporting/traits/mod.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { type ClosureKind as ty_ClosureKind, display_ClosureKind } from "../../rustc_type_ir/lib.ts";
import { PolyTraitClause } from "../../rustc_type_ir/predicate.ts";
import { ClosureArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import { type SortLayout, slice_sort_unstable_by } from "../../std/slice_sort.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import { Iterator_Prefixes, PrefixSet } from "../prefixes.ts";
import { type CaptureArgLabel, CaptureArgLabel_subdiagnostic, TypeNoCopy_subdiagnostic } from "../session_diagnostics.gen.ts";
import { BorrowedContentSource, type CapturedMessageOpt, CloneSuggestion, UseSpans } from "./mod.ts";
import { type GroupedMoveError, type IllegalMoveOriginKind, MoveError, type PatternBindingInfo } from "./move_errors.gen.ts";

export * from "./move_errors.gen.ts";

declare module "./move_errors.gen.ts" {
  namespace MoveError {
    // move_errors.rs:48
    function new_(place: Place, location: Location, kind: IllegalMoveOriginKind): MoveError;
    export { new_ as new };
  }
}

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // move_errors.rs:105
    report_move_errors(): void;
    // move_errors.rs:112
    group_move_errors(): GroupedMoveError[];
    // move_errors.rs:121
    append_to_grouped_errors(grouped_errors: GroupedMoveError[], move_error: MoveError): void;
    // move_errors.rs:173
    append_binding_error(
      grouped_errors: GroupedMoveError[],
      kind: IllegalMoveOriginKind,
      original_path: Place,
      move_from: Place,
      bind_to: Local,
      match_place: Place | undefined,
      match_span: Span,
      statement_span: Span,
    ): void;
    // move_errors.rs:254
    report(error: GroupedMoveError): void;
    // move_errors.rs:304
    has_ambiguous_copy(ty: Ty): boolean;
    // move_errors.rs:312
    report_cannot_move_from_static(place: Place, span: Span): Diag;
    // move_errors.rs:328
    suggest_clone_of_captured_var_in_move_closure(err: Diag, upvar_name: string, use_spans: UseSpans | undefined): void;
    // move_errors.rs:435
    report_cannot_move_from_borrowed_content(move_place: Place, deref_target_place: Place, span: Span, use_spans: UseSpans | undefined): [Diag, CloneSuggestion];
    // move_errors.rs:567
    report_closure_move_error(span: Span, move_place: Place, def_id: DefId, closure_kind_ty: Ty, upvar_field: FieldIdx, asyncness: Asyncness): Diag;
    // move_errors.rs:633
    get_closure_bound_clause_span(def_id: DefId, asyncness: Asyncness): Span | undefined;
    // move_errors.rs:680
    closure_clause_kind(pred: Clause, def_id: DefId, asyncness: Asyncness): ty_ClosureKind | undefined;
    // move_errors.rs:702
    suggest_cloning_through_overloaded_deref(err: Diag, ty: Ty, span: Span): CloneSuggestion;
    // move_errors.rs:734
    add_move_hints(error: GroupedMoveError, err: Diag, span: Span, has_clone_suggestion: CloneSuggestion): void;
    // move_errors.rs:898
    add_borrow_suggestions(err: Diag, span: Span, is_destructuring_pattern_move: boolean): void;
    // move_errors.rs:972
    should_suggest_pattern_binding_instead(span: Span, binding_info: PatternBindingInfo): boolean;
    // move_errors.rs:1009
    should_suggest_borrow_instead(span: Span, binding_info: PatternBindingInfo | undefined): boolean;
    // move_errors.rs:1037
    pattern_binding_info(binds_to: readonly Local[]): PatternBindingInfo | undefined;
    // move_errors.rs:1063
    add_move_error_suggestions(err: Diag, binds_to: readonly Local[]): Span[] | undefined;
    // move_errors.rs:1218
    add_move_error_details(err: Diag, binds_to: readonly Local[], desugar_spans: readonly Span[]): void;
    // move_errors.rs:1265
    add_note_for_packed_struct_derive(err: Diag, local: Local): void;
  }
}

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:48 new
(MoveError as unknown as { new: typeof MoveError.new }).new = function (place: Place, location: Location, kind: IllegalMoveOriginKind): MoveError {
  return new MoveError(place, location, kind);
};

// Often when desugaring a pattern match we may have many individual moves in
// MIR that are all part of one operation from the user's point-of-view. For
// example:
//
// let (x, y) = foo()
//
// would move x from the 0 field of some temporary, and y from the 1 field. We
// group such errors together for cleaner error reporting.
//
// Errors are kept separate if they are from places with different parent move
// paths. For example, this generates two errors:
//
// let (&x, &y) = (&String::new(), &String::new());

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:105 report_move_errors
MirBorrowckCtxt.prototype.report_move_errors = function (this: MirBorrowckCtxt): void {
  const grouped_errors = this.group_move_errors();
  for (const error of grouped_errors) {
    this.report(error);
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:112 group_move_errors
MirBorrowckCtxt.prototype.group_move_errors = function (this: MirBorrowckCtxt): GroupedMoveError[] {
  const grouped_errors: GroupedMoveError[] = [];
  // `std::mem::take`
  const errors = this.move_errors;
  this.move_errors = [];
  for (const error of errors) {
    this.append_to_grouped_errors(grouped_errors, error);
  }
  return grouped_errors;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:121 append_to_grouped_errors
MirBorrowckCtxt.prototype.append_to_grouped_errors = function (this: MirBorrowckCtxt, grouped_errors: GroupedMoveError[], move_error: MoveError): void {
  const { place: original_path, location, kind } = move_error;
  // Note: that the only time we assign a place isn't a temporary
  // to a user variable is when initializing it.
  // If that ever stops being the case, then the ever initialized
  // flow could be used.
  const stmt_kind = this.body.basic_blocks.deref()[location.block]!.statements[location.statement_index]?.kind;
  let local: Local | undefined;
  if (
    stmt_kind !== undefined &&
    stmt_kind.$ === "Assign" &&
    stmt_kind._0[1].$ === "Use" &&
    stmt_kind._0[1]._0.$ === "Move" &&
    (local = stmt_kind._0[0].as_local()) !== undefined
  ) {
    const move_from = stmt_kind._0[1]._0._0;
    const local_decl = this.body.local_decls[local]!;
    // opt_match_place is the
    // match_span is the span of the expression being matched on
    // match *x.y { ... }        match_place is Some(*x.y)
    //       ^^^^                match_span is the span of *x.y
    //
    // opt_match_place is None for let [mut] x = ... statements,
    // whether or not the right-hand side is a place expression
    const local_info = local_decl.local_info_();
    if (local_info.$ === "User" && local_info._0.$ === "Var" && local_info._0._0.opt_match_place !== undefined) {
      const [opt_match_place, match_span] = local_info._0._0.opt_match_place;
      const stmt_source_info = this.body.source_info(location);
      this.append_binding_error(grouped_errors, kind, original_path, move_from, local, opt_match_place, match_span, stmt_source_info.span);
      return;
    }
  }

  const move_spans = this.move_spans(original_path.as_ref(), location);
  grouped_errors.push({
    $: "OtherIllegalMove",
    use_spans: move_spans,
    original_path,
    kind,
  });
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:173 append_binding_error
MirBorrowckCtxt.prototype.append_binding_error = function (
  this: MirBorrowckCtxt,
  grouped_errors: GroupedMoveError[],
  kind: IllegalMoveOriginKind,
  original_path: Place,
  move_from: Place,
  bind_to: Local,
  match_place_: Place | undefined,
  match_span: Span,
  statement_span: Span,
): void {
  // debug!(?match_place, ?match_span, "append_binding_error");

  const from_simple_let = match_place_ === undefined;
  const match_place = match_place_ ?? move_from;

  const lookup = this.move_data.rev_lookup.find(match_place.as_ref());
  switch (lookup.$) {
    // Error with the match place
    case "Parent": {
      for (const ge of grouped_errors) {
        if (ge.$ === "MovesFromPlace" && match_span === ge.span) {
          const binds_to = ge.binds_to;
          // debug!("appending local({bind_to:?}) to list");
          if (!(binds_to.length === 0)) {
            binds_to.push(bind_to);
          }
          return;
        }
      }
      // debug!("found a new move error location");

      // Don't need to point to x in let x = ... .
      const [binds_to, span] = from_simple_let ? [[] as Local[], statement_span] : [[bind_to], match_span];
      grouped_errors.push({
        $: "MovesFromPlace",
        span,
        move_from,
        original_path,
        kind,
        binds_to,
      });
      break;
    }
    // Error with the pattern
    case "Exact": {
      const from_lookup = this.move_data.rev_lookup.find(move_from.as_ref());
      if (!(from_lookup.$ === "Parent" && from_lookup._0 !== undefined)) {
        // move_from should be a projection from match_place.
        return unreachable("Probably not unreachable...");
      }
      const mpi = from_lookup._0;
      for (const ge of grouped_errors) {
        if (ge.$ === "MovesFromValue") {
          const { span, move_from: other_mpi, binds_to } = ge;
          if (match_span === span && mpi === other_mpi) {
            // debug!("appending local({bind_to:?}) to list");
            binds_to.push(bind_to);
            return;
          }
        }
      }
      // debug!("found a new move error location");
      grouped_errors.push({
        $: "MovesFromValue",
        span: match_span,
        move_from: mpi,
        original_path,
        kind,
        binds_to: [bind_to],
      });
      break;
    }
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:254 report
MirBorrowckCtxt.prototype.report = function (this: MirBorrowckCtxt, error: GroupedMoveError): void {
  let span: Span;
  let use_spans: UseSpans | undefined;
  let original_path: Place;
  let kind: IllegalMoveOriginKind;
  switch (error.$) {
    case "MovesFromPlace":
    case "MovesFromValue":
      [span, use_spans, original_path, kind] = [error.span, undefined, error.original_path, error.kind];
      break;
    case "OtherIllegalMove":
      [span, use_spans, original_path, kind] = [UseSpans.args_or_use(error.use_spans), error.use_spans, error.original_path, error.kind];
      break;
  }
  // debug!(
  //     "report: original_path={:?} span={:?}, kind={:?} \
  //      original_path.is_upvar_field_projection={:?}",
  //     original_path,
  //     span,
  //     kind,
  //     self.is_upvar_field_projection(original_path.as_ref())
  // );
  if (this.has_ambiguous_copy(original_path.ty(this.body, this.infcx.tcx).ty)) {
    // If the type may implement Copy, skip the error.
    // It's an error with the Copy implementation (e.g. duplicate Copy) rather than borrow check
    this.dcx().span_delayed_bug(span, "Type may implement copy, but there is no other error.");
    return;
  }

  let has_clone_suggestion: CloneSuggestion = CloneSuggestion.NotEmitted;
  let err: Diag;
  switch (kind.$) {
    case "BorrowedContent": {
      const target_place = kind.target_place;
      const [diag, clone_sugg] = this.report_cannot_move_from_borrowed_content(original_path, target_place, span, use_spans);
      has_clone_suggestion = clone_sugg;
      err = diag;
      break;
    }
    case "InteriorOfTypeWithDestructor": {
      const ty = kind.container_ty;
      err = this.cannot_move_out_of_interior_of_drop(span, ty);
      break;
    }
    case "InteriorOfSliceOrArray": {
      const { ty, is_index } = kind;
      err = this.cannot_move_out_of_interior_noncopy(span, ty, is_index);
      break;
    }
  }

  this.add_move_hints(error, err, span, has_clone_suggestion);
  this.buffer_error(err);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:304 has_ambiguous_copy
MirBorrowckCtxt.prototype.has_ambiguous_copy = function (this: MirBorrowckCtxt, ty: Ty): boolean {
  const copy_def_id = this.infcx.tcx.lang_items().copy_trait();
  if (copy_def_id === undefined) return false;

  // Avoid bogus move errors because of an incoherent `Copy` impl.
  return (
    EvaluationResult.may_apply(this.infcx.type_implements_trait(copy_def_id, [GenericArg.from_Ty(ty)], this.infcx.param_env)) &&
    this.infcx.tcx.ensure_result().coherent_trait(copy_def_id).$ === "Err"
  );
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:312 report_cannot_move_from_static
MirBorrowckCtxt.prototype.report_cannot_move_from_static = function (this: MirBorrowckCtxt, place: Place, span: Span): Diag {
  let description: string;
  if (place.projection.length === 1) {
    description = `static item ${this.describe_any_place(place.as_ref())}`;
  } else {
    const base_static = new PlaceRef(place.local, [ProjectionElem.Deref]);

    description = `${this.describe_any_place(place.as_ref())} as ${this.describe_any_place(base_static)} is a static item`;
  }

  return this.cannot_move_out_of(span, description);
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:328 suggest_clone_of_captured_var_in_move_closure
MirBorrowckCtxt.prototype.suggest_clone_of_captured_var_in_move_closure = function (
  this: MirBorrowckCtxt,
  err: Diag,
  upvar_name: string,
  use_spans_: UseSpans | undefined,
): void {
  const tcx = this.infcx.tcx;
  if (use_spans_ === undefined) return;
  const use_spans = use_spans_;
  // We only care about the case where a closure captured a binding.
  if (use_spans.$ !== "ClosureUse") return;
  const args_span = use_spans.args_span;
  const body_id = hir.Node.body_id(tcx.hir_node(this.mir_hir_id()));
  if (body_id === undefined) return;
  // Find the closure that captured the binding.
  let expr_finder = FindExprBySpan.new(args_span, tcx);
  expr_finder.include_closures = true;
  expr_finder.visit_expr(tcx.hir_body(body_id).value);
  const closure_expr = expr_finder.result;
  if (closure_expr === undefined) return;
  if (closure_expr.kind.$ !== "Closure") return;
  const closure = closure_expr.kind._0;
  // We'll only suggest cloning the binding if it's a `move` closure.
  if (closure.capture_clause.$ !== "Value") return;
  // Find the expression within the closure where the binding is consumed.
  let suggested = false;
  const use_span = UseSpans.var_or_use(use_spans);
  expr_finder = FindExprBySpan.new(use_span, tcx);
  expr_finder.include_closures = true;
  expr_finder.visit_expr(tcx.hir_body(body_id).value);
  const use_expr = expr_finder.result;
  if (use_expr === undefined) return;
  const parent = tcx.parent_hir_node(use_expr.hir_id);
  if (parent.$ === "Expr" && parent._0.kind.$ === "Assign" && HirId_eq(parent._0.kind._0.hir_id, use_expr.hir_id)) {
    // Cloning the value being assigned makes no sense:
    //
    // error[E0507]: cannot move out of `var`, a captured variable in an `FnMut` closure
    //   --> $DIR/option-content-move2.rs:11:9
    //    |
    // LL |     let mut var = None;
    //    |         ------- captured outer variable
    // LL |     func(|| {
    //    |          -- captured by this `FnMut` closure
    // LL |         // Shouldn't suggest `move ||.as_ref()` here
    // LL |         move || {
    //    |         ^^^^^^^ `var` is moved here
    // LL |
    // LL |             var = Some(NotCopyable);
    //    |             ---
    //    |             |
    //    |             variable moved due to use in closure
    //    |             move occurs because `var` has type `Option<NotCopyable>`, which does not implement the `Copy` trait
    //    |
    return;
  }

  // Search for an appropriate place for the structured `.clone()` suggestion to be applied.
  // If we encounter a statement before the borrow error, we insert a statement there.
  for (const [_, node] of tcx.hir_parent_iter(closure_expr.hir_id)) {
    if (node.$ === "Stmt") {
      const stmt = node._0;
      const padding = tcx.sess.source_map().indentation_before(stmt.span)?.toString() ?? "    ";
      err.multipart_suggestion(
        "consider cloning the value before moving it into the closure",
        [
          [Span.shrink_to_lo(stmt.span), `let value = ${upvar_name}.clone();\n${padding}`],
          [use_span, "value"],
        ],
        Applicability.MachineApplicable,
      );
      suggested = true;
      break;
    } else if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
      // We want to suggest cloning only on the first closure, not
      // subsequent ones (like `ui/suggestions/option-content-move2.rs`).
      break;
    }
  }
  if (!suggested) {
    // If we couldn't find a statement for us to insert a new `.clone()` statement before,
    // we have a bare expression, so we suggest the creation of a new block inline to go
    // from `move || val` to `{ let value = val.clone(); move || value }`.
    const padding = tcx.sess.source_map().indentation_before(closure_expr.span)?.toString() ?? "    ";
    err.multipart_suggestion(
      "consider cloning the value before moving it into the closure",
      [
        [Span.shrink_to_lo(closure_expr.span), `{\n${padding}let value = ${upvar_name}.clone();\n${padding}`],
        [UseSpans.var_or_use(use_spans), "value"],
        [Span.shrink_to_hi(closure_expr.span), `\n${padding}}`],
      ],
      Applicability.MachineApplicable,
    );
  }
};

/** PORT: no upstream counterpart: `self.prefixes(place, PrefixSet::All).find_map(|p| self.is_upvar_field_projection(p))`. */
function find_upvar_field(cx: MirBorrowckCtxt, place: PlaceRef): FieldIdx | undefined {
  const it = cx.prefixes(place, PrefixSet.All);
  let p: PlaceRef | undefined;
  while ((p = Iterator_Prefixes.next(it)) !== undefined) {
    const field = cx.is_upvar_field_projection(p);
    if (field !== undefined) return field;
  }
  return undefined;
}

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:435 report_cannot_move_from_borrowed_content
MirBorrowckCtxt.prototype.report_cannot_move_from_borrowed_content = function (
  this: MirBorrowckCtxt,
  move_place: Place,
  deref_target_place: Place,
  span: Span,
  use_spans: UseSpans | undefined,
): [Diag, CloneSuggestion] {
  const tcx = this.infcx.tcx;
  // Inspect the type of the content behind the
  // borrow to provide feedback about why this
  // was a move rather than a copy.
  const ty = deref_target_place.ty(this.body, tcx).ty;
  const upvar_field = find_upvar_field(this, move_place.as_ref());

  let deref_base: PlaceRef;
  const proj = deref_target_place.projection;
  if (proj.length > 0 && proj[proj.length - 1]!.$ === "Deref") {
    const proj_base = proj.slice(0, proj.length - 1);
    deref_base = new PlaceRef(deref_target_place.local, proj_base);
  } else {
    return bug("deref_target_place is not a deref projection");
  }

  if (deref_base.projection.length === 0) {
    const local = deref_base.local;
    const decl = this.body.local_decls[local]!;
    const sym_ = this.local_name(local);
    const local_name = sym_ !== undefined ? `\`${Symbol.as_str(sym_)}\`` : undefined;
    if (decl.is_ref_for_guard()) {
      return [
        this.cannot_move_out_of(span, `${local_name ?? "the place"} in pattern guard`).with_note(
          "variables bound in patterns cannot be moved from until after the end of the pattern guard",
        ),
        CloneSuggestion.NotEmitted,
      ];
    } else if (decl.is_ref_to_static()) {
      return [this.report_cannot_move_from_static(move_place, span), CloneSuggestion.NotEmitted];
    }
  }

  // debug!("report: ty={:?}", ty);
  let err: Diag;
  const ty_kind = ty.kind();
  if (ty_kind.$ === "Array" || ty_kind.$ === "Slice") {
    err = this.cannot_move_out_of_interior_noncopy(span, ty, undefined);
  } else if (ty_kind.$ === "Closure" && ty_kind._0.as_local() === this.mir_def_id() && upvar_field !== undefined) {
    const [def_id, closure_args] = [ty_kind._0, ty_kind._1];
    err = this.report_closure_move_error(span, move_place, def_id, ClosureArgs.kind_ty(closure_args.as_closure()), upvar_field, Asyncness.No);
  } else if (
    ty_kind.$ === "CoroutineClosure" &&
    ty_kind._0.as_local() === this.mir_def_id() &&
    upvar_field !== undefined &&
    this.get_closure_bound_clause_span(ty_kind._0, Asyncness.Yes) !== undefined
  ) {
    const [def_id, closure_args] = [ty_kind._0, ty_kind._1];
    err = this.report_closure_move_error(
      span,
      move_place,
      def_id,
      CoroutineClosureArgs.kind_ty(closure_args.as_coroutine_closure()),
      upvar_field,
      Asyncness.Yes,
    );
  } else {
    const source = this.borrowed_content_source(deref_base);
    const move_place_ref = move_place.as_ref();
    const place_desc = this.describe_place_with_options(move_place_ref, {
      including_downcast: false,
      including_tuple_field: false,
    });
    const name = this.describe_name(move_place_ref);
    const source_desc = BorrowedContentSource.describe_for_named_place(source);
    if (place_desc !== undefined && name !== undefined && source_desc !== undefined) {
      err = this.cannot_move_out_of(span, `\`${place_desc}\` as enum variant \`${Symbol.as_str(name)}\` which is behind a ${source_desc}`);
    } else if (place_desc !== undefined && name !== undefined && source_desc === undefined) {
      err = this.cannot_move_out_of(span, `\`${place_desc}\` as enum variant \`${Symbol.as_str(name)}\``);
    } else if (place_desc !== undefined && source_desc !== undefined) {
      err = this.cannot_move_out_of(span, `\`${place_desc}\` which is behind a ${source_desc}`);
    } else {
      err = this.cannot_move_out_of(span, BorrowedContentSource.describe_for_unnamed_place(source, tcx));
    }
  }
  const msg_opt: CapturedMessageOpt = {
    is_partial_move: false,
    is_loop_message: false,
    is_move_msg: false,
    is_loop_move: false,
    has_suggest_reborrow: false,
    maybe_reinitialized_locations_is_empty: true,
  };
  const suggested_cloning = use_spans !== undefined ? this.explain_captures(err, span, span, use_spans, move_place, msg_opt) : CloneSuggestion.NotEmitted;
  return [err, suggested_cloning];
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:567 report_closure_move_error
MirBorrowckCtxt.prototype.report_closure_move_error = function (
  this: MirBorrowckCtxt,
  span: Span,
  move_place: Place,
  def_id: DefId,
  closure_kind_ty: Ty,
  upvar_field: FieldIdx,
  asyncness: Asyncness,
): Diag {
  const tcx = this.infcx.tcx;

  const opt_kind = closure_kind_ty.to_opt_closure_kind();
  let closure_kind: ty_ClosureKind;
  if (opt_kind === "Fn" || opt_kind === "FnMut") {
    closure_kind = opt_kind;
  } else if (opt_kind === "FnOnce") {
    return bug("closure kind does not match first argument type");
  } else {
    return bug("closure kind not inferred by borrowck");
  }

  const async_prefix = Asyncness.is_async(asyncness) ? "Async" : "";
  const capture_description = `captured variable in an \`${async_prefix}${display_ClosureKind(closure_kind)}\` closure`;

  const upvar = this.upvars[FieldIdx.index(upvar_field)]!;
  const upvar_hir_id = upvar.get_root_variable();
  const upvar_name = upvar.to_string(tcx);
  const upvar_span = tcx.hir_span(upvar_hir_id);

  const place_name = this.describe_any_place(move_place.as_ref());

  const place_description =
    this.is_upvar_field_projection(move_place.as_ref()) !== undefined
      ? `${place_name}, a ${capture_description}`
      : `${place_name}, as \`${upvar_name}\` is a ${capture_description}`;

  // debug!(?closure_kind_ty, ?closure_kind, ?place_description);

  const closure_span = tcx.def_span(def_id);

  const help_msg = `\`${async_prefix}Fn\` and \`${async_prefix}FnMut\` closures require captured values to be able to be consumed multiple times, but \`${async_prefix}FnOnce\` closures may consume them only once`;

  const err = this.cannot_move_out_of(span, place_description)
    .with_span_label(upvar_span, "captured outer variable")
    .with_span_label(closure_span, `captured by this \`${async_prefix}${display_ClosureKind(closure_kind)}\` closure`);

  const bound_span = this.get_closure_bound_clause_span(def_id, asyncness);
  if (bound_span !== undefined) {
    err.span_help(bound_span, help_msg);
  } else if (!Asyncness.is_async(asyncness)) {
    // For sync closures, always emit the help message even without a span.
    // For async closures, we only enter this branch if we found a valid span
    // (due to the match guard), so no fallback is needed.
    err.help(help_msg);
  }

  return err;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:633 get_closure_bound_clause_span
MirBorrowckCtxt.prototype.get_closure_bound_clause_span = function (this: MirBorrowckCtxt, def_id: DefId, asyncness: Asyncness): Span | undefined {
  const tcx = this.infcx.tcx;
  const typeck_result = tcx.typeck(this.mir_def_id()) as TypeckResults;
  // Check whether the closure is an argument to a call, if so,
  // get the instantiated where-bounds of that call.
  const closure_hir_id = tcx.local_def_id_to_hir_id(def_id.expect_local());
  const parent_node = tcx.parent_hir_node(closure_hir_id);
  if (parent_node.$ !== "Expr") return undefined;
  const parent = parent_node._0;

  let gen_clauses: InstantiatedClauses;
  switch (parent.kind.$) {
    case "Call": {
      const callee = parent.kind._0;
      const ty = typeck_result.node_type_opt(callee.hir_id);
      if (ty === undefined) return undefined;
      const ty_kind = ty.kind();
      if (ty_kind.$ !== "FnDef") return undefined;
      const [fn_def_id, args] = [ty_kind._0, ty_kind._1];
      gen_clauses = GenericClauses.instantiate(tcx.clauses_of(fn_def_id) as GenericClauses, tcx, unwrap(Binder.no_bound_vars(args, fold_GenericArgs)));
      break;
    }
    case "MethodCall": {
      const dependent = typeck_result.type_dependent_def(parent.hir_id);
      if (dependent === undefined) return undefined;
      const [_, method] = dependent;
      const args = typeck_result.node_args(parent.hir_id);
      gen_clauses = GenericClauses.instantiate(tcx.clauses_of(method) as GenericClauses, tcx, args);
      break;
    }
    default:
      return undefined;
  }

  // Check whether one of the where-bounds requires the closure to impl `Fn[Mut]`
  // or `AsyncFn[Mut]`.
  const n = Math.min(gen_clauses.clauses.length, gen_clauses.spans.length);
  for (let i = 0; i < n; i++) {
    const clause = Unnormalized.skip_norm_wip(gen_clauses.clauses[i]!);
    const span = gen_clauses.spans[i]!;
    const kind = this.closure_clause_kind(clause, def_id, asyncness);
    const dominated_by_fn_trait = kind !== undefined && (kind === "Fn" || kind === "FnMut");
    if (dominated_by_fn_trait) {
      // Found `<TyOfCapturingClosure as FnMut>` or
      // `<TyOfCapturingClosure as AsyncFnMut>`.
      // We point at the bound that coerced the closure, which could be changed
      // to `FnOnce()` or `AsyncFnOnce()` to avoid the move error.
      return span;
    }
  }
  return undefined;
};

/// If `pred` is a trait clause binding the closure `def_id` to `Fn`/`FnMut`/`FnOnce`
/// (or their async equivalents based on `asyncness`), returns the corresponding
/// `ClosureKind`. Otherwise returns `None`.
// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:680 closure_clause_kind
MirBorrowckCtxt.prototype.closure_clause_kind = function (this: MirBorrowckCtxt, pred: Clause, def_id: DefId, asyncness: Asyncness): ty_ClosureKind | undefined {
  const tcx = this.infcx.tcx;
  const clause = pred.as_trait_clause();
  if (clause === undefined) return undefined;
  let kind: ty_ClosureKind | undefined;
  switch (asyncness) {
    case "Yes":
      kind = tcx.async_fn_trait_kind_from_def_id(PolyTraitClause.def_id(clause));
      break;
    case "No":
      kind = tcx.fn_trait_kind_from_def_id(PolyTraitClause.def_id(clause));
      break;
  }
  if (kind === undefined) return undefined;
  const self_kind = Binder.skip_binder(PolyTraitClause.self_ty(clause)).kind();
  if ((self_kind.$ === "Closure" || self_kind.$ === "CoroutineClosure") && DefId_eq(self_kind._0, def_id)) {
    return kind;
  }
  return undefined;
};

/// Suggest cloning via UFCS when a move occurs through a custom `Deref` impl.
///
/// A simple `.clone()` on a type like `MyBox<Vec<i32>>` would clone the wrapper,
/// not the inner `Vec<i32>`. Instead, we suggest `<Vec<i32> as Clone>::clone(&val)`.
// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:702 suggest_cloning_through_overloaded_deref
MirBorrowckCtxt.prototype.suggest_cloning_through_overloaded_deref = function (this: MirBorrowckCtxt, err: Diag, ty: Ty, span: Span): CloneSuggestion {
  const tcx = this.infcx.tcx;
  const clone_trait = tcx.lang_items().clone_trait();
  if (clone_trait === undefined) {
    return CloneSuggestion.NotEmitted;
  }
  const errors = this.infcx.type_implements_trait_shallow(clone_trait, ty, this.infcx.param_env);
  if (errors === undefined) {
    return CloneSuggestion.NotEmitted;
  }

  if (TraitErrors.has_errors(errors)) {
    return CloneSuggestion.NotEmitted;
  }
  const sugg: [Span, string][] = [
    [Span.shrink_to_lo(span), `<${display_Ty(ty)} as Clone>::clone(&`],
    [Span.shrink_to_hi(span), ")"],
  ];
  err.multipart_suggestion("you can `clone` the value and consume it, but this might not be your desired behavior", sugg, Applicability.MaybeIncorrect);
  return CloneSuggestion.Emitted;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:734 add_move_hints
MirBorrowckCtxt.prototype.add_move_hints = function (
  this: MirBorrowckCtxt,
  error: GroupedMoveError,
  err: Diag,
  span: Span,
  has_clone_suggestion: CloneSuggestion,
): void {
  switch (error.$) {
    case "MovesFromPlace": {
      const { binds_to: binds_to_, move_from } = error;
      const binds_to = sort_dedup_locals(binds_to_);

      if (binds_to.length === 0) {
        this.add_borrow_suggestions(err, span, false);
        const place_ty = move_from.ty(this.body, this.infcx.tcx).ty;
        const desc = this.describe_place(move_from.as_ref());
        const place_desc = desc !== undefined ? `\`${desc}\`` : "value";

        const expr = this.find_expr(span);
        if (expr !== undefined) {
          this.suggest_cloning(err, move_from.as_ref(), place_ty, expr, undefined);
        }

        err.subdiagnostic(
          TypeNoCopy_subdiagnostic({
            $: "Label",
            is_partial_move: false,
            ty: place_ty,
            place: place_desc,
            span,
          }),
        );
      } else {
        const binding_info = this.pattern_binding_info(binds_to);
        const suggest_pattern_binding = binding_info !== undefined && this.should_suggest_pattern_binding_instead(span, binding_info);
        let desugar_spans: Span[] | undefined;
        if (suggest_pattern_binding) {
          desugar_spans = this.add_move_error_suggestions(err, binds_to);
        } else {
          if (this.should_suggest_borrow_instead(span, binding_info)) {
            this.add_borrow_suggestions(err, span, true);
          }
          desugar_spans = undefined;
        }
        this.add_move_error_details(err, binds_to, desugar_spans ?? []);
      }
      break;
    }
    case "MovesFromValue": {
      const binds_to = sort_dedup_locals(error.binds_to);
      const desugar_spans = this.add_move_error_suggestions(err, binds_to) ?? [];
      this.add_move_error_details(err, binds_to, desugar_spans);
      break;
    }
    // No binding. Nothing to suggest.
    case "OtherIllegalMove": {
      const { original_path, use_spans } = error;
      let use_span = UseSpans.var_or_use(use_spans);
      const place_ty = original_path.ty(this.body, this.infcx.tcx).ty;
      const desc = this.describe_place(original_path.as_ref());
      const place_desc = desc !== undefined ? `\`${desc}\`` : "value";

      if (has_clone_suggestion === CloneSuggestion.NotEmitted) {
        // Check if the move is directly through a custom Deref impl
        // (e.g. `*my_box` where MyBox implements Deref).
        // A simple `.clone()` would clone the wrapper type rather than
        // the inner value, so we need a UFCS suggestion instead.
        //
        // However, if there are further projections after the deref
        // (e.g. `(*rc).field`), the value accessed is already the inner
        // type and a simple `.clone()` works correctly.
        const last = original_path.projection[original_path.projection.length - 1];
        const needs_ufcs =
          last !== undefined &&
          last.$ === "Deref" &&
          original_path.iter_projections().some(([place, elem]) => {
            if (elem.$ !== "Deref") return false;
            const source = this.borrowed_content_source(place);
            return source.$ === "OverloadedDeref" || source.$ === "OverloadedIndex";
          });

        const emitted_ufcs = needs_ufcs ? this.suggest_cloning_through_overloaded_deref(err, place_ty, use_span) : CloneSuggestion.NotEmitted;

        if (emitted_ufcs === CloneSuggestion.NotEmitted) {
          const expr = this.find_expr(use_span);
          if (expr !== undefined) {
            this.suggest_cloning(err, original_path.as_ref(), place_ty, expr, use_spans);
          }
        }
      }

      const upvar_field = find_upvar_field(this, original_path.as_ref());
      if (upvar_field !== undefined) {
        // Look for the introduction of the original binding being moved.
        const upvar = this.upvars[FieldIdx.index(upvar_field)]!;
        const upvar_hir_id = upvar.get_root_variable();
        const node = this.infcx.tcx.parent_hir_node(upvar_hir_id);
        switch (node.$) {
          case "Param": {
            const param = node._0;
            // Instead of pointing at the path where we access the value within a
            // closure, we point at the type of the outer `fn` argument.
            use_span = param.ty_span;
            break;
          }
          case "LetStmt": {
            const stmt = node._0;
            if (stmt.ty !== undefined) {
              // We point at the type of the outer let-binding.
              use_span = stmt.ty.span;
            } else if (stmt.init !== undefined && !this.infcx.tcx.sess.source_map().is_multiline(stmt.init.span)) {
              // We point at the initializer of the outer let-binding, but only if it
              // isn't something that spans multiple lines, like a closure, as the
              // ASCII art gets messy.
              use_span = stmt.init.span;
            }
            break;
          }
          default:
            break;
        }
      }

      err.subdiagnostic(
        TypeNoCopy_subdiagnostic({
          $: "Label",
          is_partial_move: false,
          ty: place_ty,
          place: place_desc,
          span: use_span,
        }),
      );

      let pointed_at_span = false;
      UseSpans.args_subdiag(use_spans, err, (args_span): CaptureArgLabel => {
        if (args_span === span || args_span === use_span) {
          pointed_at_span = true;
        }
        return {
          $: "MoveOutPlace",
          place: place_desc,
          args_span,
        };
      });
      if (!pointed_at_span && use_span !== span) {
        err.subdiagnostic(
          CaptureArgLabel_subdiagnostic({
            $: "MoveOutPlace",
            place: place_desc,
            args_span: span,
          }),
        );
      }

      this.add_note_for_packed_struct_derive(err, original_path.local);
      break;
    }
  }
};

/** PORT: no upstream counterpart: `binds_to.sort(); binds_to.dedup();` on the moved `Vec<Local>`. */
function sort_dedup_locals(binds_to: Local[]): Local[] {
  binds_to.sort((a, b) => a - b);
  let w = 0;
  for (let r = 0; r < binds_to.length; r++) {
    if (w === 0 || binds_to[r] !== binds_to[w - 1]) binds_to[w++] = binds_to[r]!;
  }
  binds_to.length = w;
  return binds_to;
}

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:898 add_borrow_suggestions
MirBorrowckCtxt.prototype.add_borrow_suggestions = function (this: MirBorrowckCtxt, err: Diag, span: Span, is_destructuring_pattern_move: boolean): void {
  const snippet = this.infcx.tcx.sess.source_map().span_to_snippet(span);
  if (snippet.$ === "Ok" && snippet._0.starts_with("*")) {
    const sp = Span.with_lo(span, BytePos(Span.lo(span) + 1));
    const inner = this.find_expr(sp);
    let is_raw_ptr = false;
    let is_ref = false;
    let is_destructuring_assignment = false;
    let is_nested_deref = false;
    if (inner !== undefined) {
      is_nested_deref = inner.kind.$ === "Unary" && inner.kind._0 === "Deref";
      const typck_result = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
      const inner_type = typck_result.node_type_opt(inner.hir_id);
      if (inner_type !== undefined) {
        if (inner_type.kind().$ === "RawPtr") {
          is_raw_ptr = true;
        } else if (inner_type.kind().$ === "Ref") {
          is_ref = true;
        }
      }
      is_destructuring_assignment = any_parent_is_assign_desugar_let(this.infcx.tcx, inner.hir_id);
    }
    // If the `inner` is a raw pointer, do not suggest removing the "*", see #126863
    // FIXME: need to check whether the assigned object can be a raw pointer, see `tests/ui/borrowck/issue-20801.rs`.
    if (is_raw_ptr) {
      return;
    }

    if (!is_destructuring_pattern_move || is_ref) {
      err.span_suggestion_verbose(Span.with_hi(span, BytePos(Span.lo(span) + 1)), "consider removing the dereference here", "", Applicability.MaybeIncorrect);
    } else if (!is_destructuring_assignment && !is_nested_deref) {
      err.span_suggestion_verbose(Span.shrink_to_lo(span), "consider borrowing here", "&", Applicability.MaybeIncorrect);
    } else {
      err.span_help(span, "destructuring assignment cannot borrow from this expression; consider using a `let` binding instead");
    }
  } else {
    err.span_suggestion_verbose(Span.shrink_to_lo(span), "consider borrowing here", "&", Applicability.MaybeIncorrect);
  }
};

/** PORT: no upstream counterpart: the lazy `tcx.hir_parent_iter(id).any(|(_, node)| matches!(node,
 * hir::Node::LetStmt(&hir::LetStmt { source: hir::LocalSource::AssignDesugar, .. })))` (stops at the first match). */
function any_parent_is_assign_desugar_let(tcx: TyCtxt, id: HirId): boolean {
  for (const [_, node] of tcx.hir_parent_iter(id)) {
    if (node.$ === "LetStmt" && node._0.source === "AssignDesugar") return true;
  }
  return false;
}

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:972 should_suggest_pattern_binding_instead
MirBorrowckCtxt.prototype.should_suggest_pattern_binding_instead = function (this: MirBorrowckCtxt, span: Span, binding_info: PatternBindingInfo): boolean {
  const expr = this.find_expr(span);
  if (expr === undefined) {
    return false;
  }

  const typeck_results = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
  let projection_qualifies: boolean;
  switch (expr.kind.$) {
    case "Field": {
      const base = expr.kind._0;
      const base_ty = typeck_results.node_type_opt(base.hir_id);
      projection_qualifies = !(
        base_ty !== undefined &&
        binding_info.has_mutable_by_value_binding &&
        ((k) => k.$ === "Ref" && k._2 === Mutability.Not)(base_ty.kind())
      );
      break;
    }
    case "Index": {
      const base = expr.kind._0;
      const base_ty = typeck_results.node_type_opt(base.hir_id);
      projection_qualifies =
        base_ty !== undefined &&
        ((k) => {
          if ((k.$ === "Ref" && k._2 === Mutability.Not) || k.$ === "RawPtr") return false;
          if (k.$ === "Ref" && k._2 === Mutability.Mut) return binding_info.has_mutable_by_value_binding;
          return true;
        })(base_ty.kind());
      break;
    }
    default:
      projection_qualifies = false;
  }
  if (!projection_qualifies) {
    return false;
  }

  const is_single_binding = binding_info.binding_spans.length === 1 && binding_info.binding_spans[0] === binding_info.pat_span;
  return !is_single_binding;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1009 should_suggest_borrow_instead
MirBorrowckCtxt.prototype.should_suggest_borrow_instead = function (this: MirBorrowckCtxt, span: Span, binding_info: PatternBindingInfo | undefined): boolean {
  if (!(binding_info !== undefined && binding_info.has_mutable_by_value_binding)) {
    return true;
  }

  const expr = this.find_expr(span);
  if (expr === undefined) {
    return true;
  }

  let base: hir.Expr | undefined;
  switch (expr.kind.$) {
    case "Field":
    case "Index":
      base = expr.kind._0;
      break;
    default:
      base = undefined;
  }
  if (base === undefined) {
    return true;
  }

  const base_ty = (this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults).node_type_opt(base.hir_id);
  return !(base_ty !== undefined && ((k) => k.$ === "Ref" && k._2 === Mutability.Not)(base_ty.kind()));
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1037 pattern_binding_info
MirBorrowckCtxt.prototype.pattern_binding_info = function (this: MirBorrowckCtxt, binds_to: readonly Local[]): PatternBindingInfo | undefined {
  let pat_span: Span | undefined = undefined;
  const binding_spans: Span[] = [];
  let has_mutable_by_value_binding = false;
  for (const local of binds_to) {
    const bind_to = this.body.local_decls[local]!;
    const local_info = bind_to.local_info_();
    if (local_info.$ === "User" && local_info._0.$ === "Var") {
      const { pat_span: pat_sp, binding_mode } = local_info._0._0;
      pat_span = pat_sp;
      binding_spans.push(bind_to.source_info.span);
      has_mutable_by_value_binding ||= binding_mode._0.$ === "No" && binding_mode._1 === Mutability.Mut;
    }
  }

  if (pat_span === undefined) return undefined;
  return {
    pat_span,
    binding_spans,
    has_mutable_by_value_binding,
  };
};

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1063 add_move_error_suggestions
MirBorrowckCtxt.prototype.add_move_error_suggestions = function (this: MirBorrowckCtxt, err: Diag, binds_to: readonly Local[]): Span[] | undefined {
  /// A HIR visitor to associate each binding with a `&` or `&mut` that could be removed to
  /// make it bind by reference instead (if possible)
  // rustc-type: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1070 BindingFinder
  class BindingFinder extends hir.intravisit.Visitor {
    // impl<'tcx> Visitor<'tcx> for BindingFinder<'tcx>
    // type NestedFilter = rustc_middle::hir::nested_filter::OnlyBodies;
    override NestedFilter = OnlyBodies;

    constructor(
      public typeck_results: TypeckResults,
      public tcx: TyCtxt,
      /// Input: the span of the pattern we're finding bindings in
      public pat_span: Span,
      /// Input: the spans of the bindings we're providing suggestions for
      public binding_spans: Span[],
      /// Internal state: have we reached the pattern we're finding bindings in?
      public found_pat: boolean,
      /// Internal state: the innermost `&` or `&mut` "above" the visitor
      public ref_pat: hir.Pat | undefined,
      /// Internal state: could removing a `&` give bindings unexpected types?
      public has_adjustments: boolean,
      /// Output: for each input binding, the `&` or `&mut` to remove to make it by-ref
      public ref_pat_for_binding: [Span, hir.Pat | undefined][],
      /// Output: ref patterns that can't be removed straightforwardly
      public cannot_remove: HirIdSet,
      /// Output: binding spans from destructuring assignment desugaring
      public desugar_binding_spans: Span[],
    ) {
      super();
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1093 maybe_tcx
    override maybe_tcx(): HirTyCtxt {
      return TyCtxt_as_HirTyCtxt(this.tcx);
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1097 visit_expr
    override visit_expr(ex: hir.Expr): undefined {
      // Don't walk into const patterns or anything else that might confuse this
      if (!this.found_pat) {
        hir.intravisit.walk_expr(this, ex);
      }
      return undefined;
    }

    // rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1104 visit_pat
    override visit_pat(p: hir.Pat): undefined {
      if (p.span === this.pat_span) {
        this.found_pat = true;
      }

      const parent_has_adjustments = this.has_adjustments;
      // `|=` (not short-circuiting)
      const has_pat_adjustments = this.typeck_results.pat_adjustments().contains_key(p.hir_id);
      this.has_adjustments = this.has_adjustments || has_pat_adjustments;

      // Track the innermost `&` or `&mut` enclosing bindings, to suggest removing it.
      const parent_ref_pat = this.ref_pat;
      if (p.kind.$ === "Ref") {
        this.ref_pat = p;
        // To avoid edition-dependent logic to figure out how many refs this `&` can
        // peel off, simply don't remove the "parent" `&`.
        if (parent_ref_pat !== undefined) this.cannot_remove.add(parent_ref_pat.hir_id);
        if (this.has_adjustments) {
          // Removing this `&` could give child bindings unexpected types, so don't.
          this.cannot_remove.add(p.hir_id);
          // As long the `&` stays, child patterns' types should be as expected.
          this.has_adjustments = false;
        }
      }

      if (p.kind.$ === "Binding") {
        const ident = p.kind._2;
        // Skip synthetic bindings from destructuring assignment desugaring
        // These have name `lhs` and their parent is a `LetStmt` with
        // `LocalSource::AssignDesugar`
        const dominated_by_desugar_assign =
          ident.name === sym.lhs && any_parent_is_assign_desugar_let(this.tcx, p.hir_id);

        if (dominated_by_desugar_assign) {
          const bind_sp = this.binding_spans.find((bind_sp) => Span.contains(bind_sp, ident.span));
          if (bind_sp !== undefined) {
            this.desugar_binding_spans.push(bind_sp);
          }
        } else {
          // the spans in `binding_spans` encompass both the ident and binding mode
          const bind_sp = this.binding_spans.find((bind_sp) => Span.contains(bind_sp, ident.span));
          if (bind_sp !== undefined) {
            this.ref_pat_for_binding.push([bind_sp, this.ref_pat]);
          } else {
            // we've encountered a binding that we're not reporting a move error for.
            // we don't want to change its type, so don't remove the surrounding `&`.
            if (this.ref_pat !== undefined) {
              this.cannot_remove.add(this.ref_pat.hir_id);
            }
          }
        }
      }

      hir.intravisit.walk_pat(this, p);
      this.ref_pat = parent_ref_pat;
      this.has_adjustments = parent_has_adjustments;
      return undefined;
    }
  }
  const binding_info = this.pattern_binding_info(binds_to);
  if (binding_info === undefined) {
    return undefined;
  }

  const tcx = this.infcx.tcx;
  const body = tcx.hir_maybe_body_owned_by(this.mir_def_id());
  if (body === undefined) {
    return undefined;
  }
  const typeck_results = this.infcx.tcx.typeck(this.mir_def_id()) as TypeckResults;
  const finder = new BindingFinder(
    typeck_results,
    tcx,
    binding_info.pat_span,
    binding_info.binding_spans,
    false,
    undefined,
    false,
    [],
    new HirIdSet(),
    [],
  );
  finder.visit_body(body);

  const suggestions: [Span, string, string][] = [];
  for (const [binding_span, opt_ref_pat] of finder.ref_pat_for_binding) {
    let ref_span: Span | undefined;
    if (
      opt_ref_pat !== undefined &&
      !finder.cannot_remove.has(opt_ref_pat.hir_id) &&
      opt_ref_pat.kind.$ === "Ref" &&
      (ref_span = Span.trim_end(opt_ref_pat.span, opt_ref_pat.kind._0.span)) !== undefined
    ) {
      const pinned = opt_ref_pat.kind._1;
      const mutbl = opt_ref_pat.kind._2;
      const pinned_str = Pinnedness.is_pinned(pinned) ? "pinned " : "";
      const mutable_str = Mutability.is_mut(mutbl) ? "mutable " : "";
      const msg = `consider removing the ${pinned_str}${mutable_str}borrow`;
      suggestions.push([ref_span, msg, ""]);
    } else {
      const msg = "consider borrowing the pattern binding";
      suggestions.push([Span.shrink_to_lo(binding_span), msg, "ref "]);
    }
  }
  slice_sort_unstable_by(suggestions, ([a], [b]) => cmp_lo_hi(Span.lo_hi(a), Span.lo_hi(b)), LAYOUT_Span_String_String);
  // `dedup_by_key(|&mut (span, _, _)| span.lo_hi())`
  let w = 0;
  for (let r = 0; r < suggestions.length; r++) {
    if (w === 0 || cmp_lo_hi(Span.lo_hi(suggestions[r]![0]), Span.lo_hi(suggestions[w - 1]![0])) !== 0) suggestions[w++] = suggestions[r]!;
  }
  suggestions.length = w;
  for (const [span, msg, suggestion] of suggestions) {
    err.span_suggestion_verbose(span, msg, suggestion, Applicability.MachineApplicable);
  }

  return finder.desugar_binding_spans;
};

/** PORT: no upstream counterpart: `Ord for (BytePos, BytePos)`. */
function cmp_lo_hi([alo, ahi]: [BytePos, BytePos], [blo, bhi]: [BytePos, BytePos]): number {
  return alo !== blo ? alo - blo : ahi - bhi;
}

/** PORT: the layout of `(Span, String, String)` for `sort_unstable_by_key` (`slice_sort_unstable_by`). */
const LAYOUT_Span_String_String: SortLayout = { size_of: 56, freeze: true };

// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1218 add_move_error_details
MirBorrowckCtxt.prototype.add_move_error_details = function (this: MirBorrowckCtxt, err: Diag, binds_to: readonly Local[], desugar_spans: readonly Span[]): void {
  for (let j = 0; j < binds_to.length; j++) {
    const local = binds_to[j]!;
    const bind_to = this.body.local_decls[local]!;
    const binding_span = bind_to.source_info.span;

    if (binds_to.length === 1) {
      const sym_ = this.local_name(local);
      const place_desc = sym_ !== undefined ? `\`${Symbol.as_str(sym_)}\`` : undefined;

      err.subdiagnostic(
        TypeNoCopy_subdiagnostic({
          $: "LabelMovedHere",
          ty: bind_to.ty,
          place: place_desc ?? "the place",
          span: binding_span,
        }),
      );

      let expr: hir.Expr | undefined;
      if (!desugar_spans.includes(binding_span) && (expr = this.find_expr(binding_span)) !== undefined) {
        const local_place: PlaceRef = PlaceRef_from_Local(local);
        this.suggest_cloning(err, local_place, bind_to.ty, expr, undefined);
      }
    } else if (j === 0) {
      err.span_label(binding_span, "data moved here");
    } else if (j === 5 && binds_to.length > 6 && !this.infcx.tcx.sess.opts.verbose) {
      err.note(`...and ${binds_to.length - 5} other places`);
      break;
    } else {
      err.span_label(binding_span, "...and here");
    }
  }

  if (binds_to.length > 1) {
    err.note("move occurs because these variables have types that don't implement the `Copy` trait");
  }
};

/// Adds an explanatory note if the move error occurs in a derive macro
/// expansion of a packed struct.
/// Such errors happen because derive macro expansions shy away from taking
/// references to the struct's fields since doing so would be undefined behaviour
// rustc: compiler/rustc_borrowck/src/diagnostics/move_errors.rs:1265 add_note_for_packed_struct_derive
MirBorrowckCtxt.prototype.add_note_for_packed_struct_derive = function (this: MirBorrowckCtxt, err: Diag, local: Local): void {
  const local_place: PlaceRef = PlaceRef_from_Local(local);
  const local_ty = local_place.ty(this.body.local_decls_(), this.infcx.tcx).ty.peel_refs();

  const adt = local_ty.ty_adt_def();
  let expn_kind: ExpnKind;
  if (
    adt !== undefined &&
    adt.repr().packed() &&
    (expn_kind = SyntaxContext.outer_expn_data(Span.ctxt(this.body.span)).kind).$ === "Macro" &&
    expn_kind._0 === "Derive"
  ) {
    const name = expn_kind._1;
    err.note(`\`#[derive(${Symbol.as_str(name)})]\` triggers a move because taking references to the fields of a packed struct is undefined behaviour`);
  }
};
