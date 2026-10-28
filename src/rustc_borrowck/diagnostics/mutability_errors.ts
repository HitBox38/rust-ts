// Port of compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-c, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT notes (lane bck-diag-c):
// - `debug!` / `trace!` are tracing only and stay as comments; `debug_assert!`s stay as comments (PORTING §3).
// - `format!("{ty}")` of a `Ty` is `display_Ty`; of a `Symbol` `Symbol.as_str`; of an `Ident` `display_Ident`.
// - Slice patterns over `PlaceRef::projection` (`[proj_base @ .., ProjectionElem::Field(..)]`, ...) are length / last-element
//   checks, in upstream arm order (guards included).
// - Lazy iterator chains whose closures are pure are collected eagerly (`.peekable()` + `peek().is_some()` = non-empty).
// - The fn-local items (`FindLocalAssignmentVisitor`, `SuggestIndexOperatorAlternativeVisitor` with its nested
//   `count_ty_refs` / `strip_n_refs`, `Finder`) live inside their fns again, as upstream has them.
// - Query values that queries.gen.ts types `unknown` (`typeck`, `associated_items`, `fn_sig`, `clauses_of`) are cast to
//   their upstream types (`TypeckResults`, `AssocItems`, `EarlyBinder<PolyFnSig>`, `GenericClauses`).
// - ty/closure.ts's `CAPTURE_STRUCT_LOCAL` has its own `Local` brand: compared as numbers (precedent
//   rustc_mir_transform/lint_tail_expr_drop_order.ts).
// - `Option::expect` / `unwrap` / `checked_sub(..).expect(..)` panic with core's / upstream's text.
import type { FieldIdx } from "../../rustc_abi/lib.ts";
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { BindingMode, BindingMode_eq } from "../../rustc_ast/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { Applicability, type Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { type HirId, ImplicitSelfKind } from "../../rustc_hir/lib.ts";
import { HirId_eq } from "../../rustc_hir_id/lib.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import {
  type Body,
  type Local,
  type LocalDecl,
  type Location,
  Place,
  PlaceRef,
  type Statement,
} from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, PlaceContext as PlaceContextC, Visitor } from "../../rustc_middle/mir/visit.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import { CAPTURE_STRUCT_LOCAL, is_ancestor_or_same_capture, place_to_string_for_capture } from "../../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_GenericArgs, GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { type Predicate, Predicate_upcast_from_PolyTraitRef, type PolyTraitRef } from "../../rustc_middle/ty/predicate.ts";
import { display_Predicate, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { is_whitespace as lexer_is_whitespace } from "../../rustc_lexer/lib.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { BytePos, Span } from "../../rustc_span/lib.ts";
import { display_Ident, type Ident, kw, Symbol, sym } from "../../rustc_span/symbol.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { as_interner, fold_with_TraitRef, PolyTraitClause, TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { fold_FnSig, FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized, UnnormalizedClause, UnnormalizedPolyTraitClause } from "../../rustc_type_ir/unnormalized.ts";
import { is_whitespace, len_utf8 } from "../../std/char.ts";
import { assert_eq, panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { str_find_pred, str_trim_start, utf8_len } from "../../std/str.ts";
import { type BorrowckInferCtxt, MirBorrowckCtxt } from "../lib.gen.ts";
import { BorrowedContentSource, UseSpans } from "./mod.ts";
import { type AccessKind, AmpMutSugg } from "./mutability_errors.gen.ts";

export * from "./mutability_errors.gen.ts";

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // mutability_errors.rs:62
    report_mutability_error(access_place: Place, span: Span, the_place_err: PlaceRef, error_access: AccessKind, location: Location): void;
    // mutability_errors.rs:667
    suggest_map_index_mut_alternatives(ty: Ty, err: Diag, span: Span): void;
    // mutability_errors.rs:909
    is_error_in_trait(local: Local): [boolean, boolean, Span | undefined];
    // mutability_errors.rs:941
    construct_mut_suggestion_for_local_binding_patterns(err: Diag, local: Local): void;
    // mutability_errors.rs:1002
    show_mutating_upvar(tcx: TyCtxt, closure_local_def_id: LocalDefId, the_place_err: PlaceRef, err: Diag): void;
    // mutability_errors.rs:1078
    suggest_similar_mut_method_for_for_loop(err: Diag, span: Span): void;
    // mutability_errors.rs:1171
    point_at_binding_outside_closure(err: Diag, local: Local, access_place: Place): void;
    // mutability_errors.rs:1215
    expected_fn_found_fn_mut_call(err: Diag, sp: Span, act: string): void;
    // mutability_errors.rs:1359
    suggest_using_iter_mut(err: Diag): void;
    // mutability_errors.rs:1400
    suggest_make_local_mut(err: Diag, local: Local, name: Symbol): void;
    // mutability_errors.rs:1746
    is_closure_arg_with_non_locally_decided_type(local: Local): boolean;
  }
}

/// Finds all statements that assign directly to local (i.e., X = ...) and returns their
/// locations.
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:36 find_assignments
function find_assignments(body: Body, local: Local): Location[] {
  // rustc-type: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:39 FindLocalAssignmentVisitor
  class FindLocalAssignmentVisitor extends Visitor {
    constructor(
      public needle: Local,
      public locations: Location[],
    ) {
      super();
    }

    // impl<'tcx> Visitor<'tcx> for FindLocalAssignmentVisitor
    // rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:45 visit_local
    override visit_local(local: Local, place_context: PlaceContext, location: Location): void {
      if (this.needle !== local) {
        return;
      }

      if (PlaceContextC.is_place_assignment(place_context)) {
        this.locations.push(location);
      }
    }
  }

  const visitor = new FindLocalAssignmentVisitor(local, []);
  visitor.visit_body(body);
  return visitor.locations;
}

// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:62 report_mutability_error
MirBorrowckCtxt.prototype.report_mutability_error = function (
  this: MirBorrowckCtxt,
  access_place: Place,
  span_: Span,
  the_place_err: PlaceRef,
  error_access: AccessKind,
  location: Location,
): void {
  // debug!("report_mutability_error(access_place={:?}, span={:?}, the_place_err={:?}, error_access={:?}, location={:?},)", ...);

  let err: Diag;
  let item_msg: string;
  let reason: string;
  let opt_source: BorrowedContentSource | undefined = undefined;
  const access_place_desc = this.describe_any_place(access_place.as_ref());
  // debug!("report_mutability_error: access_place_desc={:?}", access_place_desc);

  {
    const local = the_place_err.local;
    const projection = the_place_err.projection;
    const last = projection[projection.length - 1];
    if (projection.length === 0) {
      item_msg = access_place_desc;
      if (access_place.as_local() !== undefined) {
        reason = ", as it is not declared as mutable";
      } else {
        const name = unwrap(this.local_name(local), "immutable unnamed local");
        reason = `, as \`${Symbol.as_str(name)}\` is not declared as mutable`;
      }
    } else if (last!.$ === "Field") {
      const upvar_index = last._0;
      // debug_assert!(is_closure_like(Place::ty_from(local, proj_base, self.body, self.infcx.tcx).ty));

      let imm_borrow_derefed = false;
      for (const ty of this.upvars[upvar_index]!.place.deref_tys()) {
        const k = ty.kind();
        if (k.$ === "Ref" && k._2 === "Not") {
          imm_borrow_derefed = true;
          break;
        }
      }

      // If the place is immutable then:
      //
      // - Either we deref an immutable ref to get to our final place.
      //    - We don't capture derefs of raw ptrs
      // - Or the final place is immut because the root variable of the capture
      //   isn't marked mut and we should suggest that to the user.
      if (imm_borrow_derefed) {
        // If we deref an immutable ref then the suggestion here doesn't help.
        return;
      } else {
        item_msg = access_place_desc;
        if (this.is_upvar_field_projection(access_place.as_ref()) !== undefined) {
          reason = ", as it is not declared as mutable";
        } else {
          const name = this.upvars[upvar_index]!.to_string(this.infcx.tcx);
          reason = `, as \`${name}\` is not declared as mutable`;
        }
      }
    } else if (projection.length === 1 && last!.$ === "Deref" && this.body.local_decls[local]!.is_ref_for_guard()) {
      item_msg = access_place_desc;
      reason = ", as it is immutable for the pattern guard";
    } else if (projection.length === 1 && last!.$ === "Deref" && this.body.local_decls[local]!.is_ref_to_static()) {
      if (access_place.projection.length === 1) {
        item_msg = `immutable static item ${access_place_desc}`;
        reason = "";
      } else {
        item_msg = access_place_desc;
        const local_info = this.body.local_decls[local]!.local_info_();
        if (local_info.$ !== "StaticRef") {
          return bug("is_ref_to_static return true, but not ref to static?");
        }
        const def_id = local_info.def_id;
        const static_name = this.infcx.tcx.item_name(def_id);
        reason = `, as \`${Symbol.as_str(static_name)}\` is an immutable static item`;
      }
    } else if (last!.$ === "Deref") {
      const proj_base = projection.slice(0, projection.length - 1);
      if ((local as number) === (CAPTURE_STRUCT_LOCAL as number) && proj_base.length === 0 && !(this.upvars.length === 0)) {
        item_msg = access_place_desc;
        // debug_assert!(self.body.local_decls[ty::CAPTURE_STRUCT_LOCAL].ty.is_ref());
        // debug_assert!(is_closure_like(the_place_err.ty(self.body, self.infcx.tcx).ty));

        reason =
          this.is_upvar_field_projection(access_place.as_ref()) !== undefined
            ? ", as it is a captured variable in a `Fn` closure"
            : ", as `Fn` closures cannot mutate their captured variables";
      } else {
        const source = this.borrowed_content_source(new PlaceRef(local, proj_base));
        const pointer_type = BorrowedContentSource.describe_for_immutable_place(source, this.infcx.tcx);
        opt_source = source;
        const desc = this.describe_place(access_place.as_ref());
        if (desc !== undefined) {
          item_msg = `\`${desc}\``;
          switch (error_access) {
            case "Mutate":
              reason = `, which is behind ${pointer_type}`;
              break;
            case "MutableBorrow":
              reason = `, as it is behind ${pointer_type}`;
              break;
          }
        } else {
          item_msg = `data in ${pointer_type}`;
          reason = "";
        }
      }
    } else if (projection.length === 1 && last!.$ === "PhantomDeref") {
      item_msg = "";
      reason = "";
    } else if (last!.$ === "PhantomDeref") {
      item_msg = "";
      reason = "";
    } else {
      // [.., Index(_) | ConstantIndex { .. } | OpaqueCast { .. } | Subslice { .. } | Downcast(..) | UnwrapUnsafeBinder(_)]
      return bug("Unexpected immutable place.");
    }
  }

  // debug!("report_mutability_error: item_msg={:?}, reason={:?}", item_msg, reason);

  // `act` and `acted_on` are strings that let us abstract over
  // the verbs used in some diagnostic messages.
  let act: string;
  let acted_on: string;
  let suggest = true;
  let mut_error: Span | undefined = undefined;
  let count = 1;

  let span: Span;
  switch (error_access) {
    case "Mutate": {
      err = this.cannot_assign(span_, item_msg + reason);
      act = "assign";
      acted_on = "written to";
      span = span_;
      break;
    }
    case "MutableBorrow": {
      act = "borrow as mutable";
      acted_on = "borrowed as mutable";

      const borrow_spans = this.borrow_spans(span_, location);
      const borrow_span = UseSpans.args_or_use(borrow_spans);
      const local = the_place_err.local;
      if (the_place_err.projection.length === 0 && this.body.local_decls[local]!.can_be_made_mutable()) {
        const span = this.body.local_decls[local]!.source_info.span;
        mut_error = span;
        const buffered = this.get_buffered_mut_error(span);
        if (buffered !== undefined) {
          const [buffered_err, c] = buffered;
          // We've encountered a second (or more) attempt to mutably borrow an
          // immutable binding, so the likely problem is with the binding
          // declaration, not the use. We collect these in a single diagnostic
          // and make the binding the primary span of the error.
          err = buffered_err;
          count = c + 1;
          if (count === 2) {
            err.replace_span_with(span, false);
            err.span_label(span, "not mutable");
          }
          suggest = false;
        } else {
          err = this.cannot_borrow_path_as_mutable_because(borrow_span, item_msg, reason);
        }
      } else {
        err = this.cannot_borrow_path_as_mutable_because(borrow_span, item_msg, reason);
      }
      if (suggest) {
        UseSpans.var_subdiag(borrow_spans, err, { $: "Mut", kind: "Default" }, (_kind, var_span) => {
          const place = this.describe_any_place(access_place.as_ref());
          return { $: "MutableBorrowUsePlaceClosure", place, var_span };
        });
      }
      span = borrow_span;
      break;
    }
  }

  // debug!("report_mutability_error: act={:?}, acted_on={:?}", act, acted_on);

  {
    const local = the_place_err.local;
    const projection = the_place_err.projection;
    const n = projection.length;
    const last = projection[n - 1];
    // Suggest making an existing shared borrow in a struct definition a mutable borrow.
    //
    // This is applicable when we have a deref of a field access to a deref of a local -
    // something like `*((*_1).0`. The local that we get will be a reference to the
    // struct we've got a field access of (it must be a reference since there's a deref
    // after the field access).
    if (n >= 3 && projection[n - 3]!.$ === "Deref" && projection[n - 2]!.$ === "Field" && last!.$ === "Deref") {
      const field = (projection[n - 2] as { $: "Field"; _0: FieldIdx })._0;
      const proj_base = projection.slice(0, n - 3);
      err.span_label(span, `cannot ${act}`);

      const place = Place.ty_from(local, proj_base, this.body, this.infcx.tcx);
      const span_ = get_mut_span_in_struct_field(this.infcx.tcx, place.ty, field);
      if (span_ !== undefined) {
        err.span_suggestion_verbose(span_, "consider changing this to be mutable", " mut ", Applicability.MaybeIncorrect);
      }
    }
    // Suggest removing a `&mut` from the use of a mutable reference.
    else if (
      n === 0 &&
      ((l) => l !== undefined && mut_borrow_of_mutable_ref(l, this.local_name(local)))(this.body.local_decls[local])
    ) {
      const decl = this.body.local_decls[local]!;
      err.span_label(span, `cannot ${act}`);
      const stmt = this.body.index(location.block).statements[location.statement_index];
      if (
        stmt !== undefined &&
        stmt.kind.$ === "Assign" &&
        stmt.kind._0[1].$ === "Ref" &&
        stmt.kind._0[1]._1.$ === "Mut" &&
        stmt.kind._0[1]._1.kind === "Default"
      ) {
        const source_info = stmt.source_info;
        const li = decl.local_info_();
        if (
          li.$ === "User" &&
          li._0.$ === "Var" &&
          li._0._0.binding_mode._0.$ === "No" &&
          li._0._0.binding_mode._1 === "Not" &&
          li._0._0.opt_ty_info !== undefined
        ) {
          const sp = li._0._0.opt_ty_info;
          const pat_span = li._0._0.pat_span;
          if (suggest) {
            err.span_note(sp, "the binding is already a mutable borrow");
            err.span_suggestion_verbose(
              Span.shrink_to_lo(pat_span),
              "consider making the binding mutable if you need to reborrow multiple times",
              "mut ",
              Applicability.MaybeIncorrect,
            );
          }
        } else {
          err.span_note(decl.source_info.span, "the binding is already a mutable borrow");
        }
        const snippet_r = this.infcx.tcx.sess.source_map().span_to_snippet(source_info.span);
        if (snippet_r.$ === "Ok") {
          const snippet = snippet_r._0;
          if (snippet.starts_with("&mut ")) {
            // In calls, `&mut &mut T` may be deref-coerced to `&mut T`, and
            // removing the extra `&mut` is the most direct suggestion. But for
            // pattern-matching expressions (`match`, `if let`, `while let`), that
            // can easily turn into a move, so prefer suggesting an explicit
            // reborrow via `&mut *x` instead.
            let in_pat_scrutinee = false;
            let is_deref_coerced = false;
            const expr = this.find_expr(source_info.span);
            if (expr !== undefined) {
              const tcx = this.infcx.tcx;
              const span = Span.source_callsite(expr.span);
              for (const [, node] of tcx.hir_parent_iter(expr.hir_id)) {
                if (node.$ === "Expr") {
                  const parent_expr = node._0;
                  const pk = parent_expr.kind;
                  if (pk.$ === "Match" && Span.contains(Span.source_callsite(pk._0.span), span)) {
                    in_pat_scrutinee = true;
                    break;
                  } else if (pk.$ === "Let" && Span.contains(Span.source_callsite(pk._0.init.span), span)) {
                    in_pat_scrutinee = true;
                    break;
                  }
                }
              }

              const typeck = tcx.typeck(expr.hir_id.owner.def_id) as TypeckResults;
              is_deref_coerced = typeck.expr_adjustments(expr).some((adj) => adj.kind.$ === "Deref");
            }

            if (in_pat_scrutinee) {
              // Best-effort structured suggestion: insert `*` after `&mut `.
              err.span_suggestion_verbose(
                Span.shrink_to_lo(Span.with_lo(source_info.span, BytePos(Span.lo(source_info.span) + 5))),
                "to reborrow the mutable reference, add `*`",
                "*",
                Applicability.MaybeIncorrect,
              );
            } else if (is_deref_coerced) {
              // We don't have access to the HIR to get accurate spans, but we
              // can give a best effort structured suggestion.
              err.span_suggestion_verbose(
                Span.with_hi(source_info.span, BytePos(Span.lo(source_info.span) + 5)),
                "if there is only one mutable reborrow, remove the `&mut`",
                "",
                Applicability.MaybeIncorrect,
              );
            }
          } else {
            // This can occur with things like `(&mut self).foo()`.
            err.span_help(source_info.span, "try removing `&mut` here");
          }
        } else {
          err.span_help(source_info.span, "try removing `&mut` here");
        }
      } else if (decl.mutability === "Not") {
        const li = decl.local_info_();
        if (li.$ === "User" && li._0.$ === "ImplicitSelf" && li._0._0 === "RefMut") {
          err.note("as `Self` may be unsized, this call attempts to take `&mut &mut self`");
          err.note("however, `&mut self` expands to `self: &mut Self`, therefore `self` cannot be borrowed mutably");
        } else {
          err.span_suggestion_verbose(
            Span.shrink_to_lo(decl.source_info.span),
            "consider making the binding mutable",
            "mut ",
            Applicability.MachineApplicable,
          );
        }
      }
    }
    // We want to suggest users use `let mut` for local (user
    // variable) mutations...
    else if (n === 0 && this.body.local_decls[local]!.can_be_made_mutable()) {
      // ... but it doesn't make sense to suggest it on
      // variables that are `ref x`, `ref mut x`, `&self`,
      // or `&mut self` (such variables are simply not
      // mutable).
      const local_decl = this.body.local_decls[local]!;
      assert_eq(local_decl.mutability, "Not", (v) => v);

      if (count < 10) {
        err.span_label(span, `cannot ${act}`);
      }
      if (suggest) {
        this.construct_mut_suggestion_for_local_binding_patterns(err, local);
        const tcx = this.infcx.tcx;
        const k = the_place_err.ty(this.body, tcx).ty.kind();
        if (k.$ === "Closure") {
          this.show_mutating_upvar(tcx, k._0.expect_local(), the_place_err, err);
        }
      }
    }
    // Also suggest adding mut for upvars.
    else if (n >= 1 && last!.$ === "Field") {
      const upvar_index = last._0;
      // debug_assert!(is_closure_like(Place::ty_from(local, proj_base, self.body, self.infcx.tcx).ty));

      const captured_place = this.upvars[upvar_index]!;

      err.span_label(span, `cannot ${act}`);

      const upvar_hir_id = captured_place.get_root_variable();

      const node = this.infcx.tcx.hir_node(upvar_hir_id);
      if (node.$ === "Pat" && node._0.kind.$ === "Binding" && BindingMode_eq(node._0.kind._0, BindingMode.NONE)) {
        const upvar_ident = node._0.kind._2;
        if (upvar_ident.name === kw.SelfLower) {
          for (const [, node] of this.infcx.tcx.hir_parent_iter(upvar_hir_id)) {
            const fn_decl = hir.Node.fn_decl(node);
            if (fn_decl !== undefined) {
              const implicit_self = fn_decl.implicit_self();
              if (!(implicit_self === "RefImm" || implicit_self === "RefMut")) {
                err.span_suggestion_verbose(
                  Span.shrink_to_lo(upvar_ident.span),
                  "consider changing this to be mutable",
                  "mut ",
                  Applicability.MachineApplicable,
                );
                break;
              }
            }
          }
        } else {
          err.span_suggestion_verbose(
            Span.shrink_to_lo(upvar_ident.span),
            "consider changing this to be mutable",
            "mut ",
            Applicability.MachineApplicable,
          );
        }
      }

      const tcx = this.infcx.tcx;
      const k = the_place_err.ty(this.body, tcx).ty.kind();
      if (k.$ === "Ref" && k._2 === "Mut") {
        const k2 = k._1.kind();
        if (k2.$ === "Closure") {
          this.show_mutating_upvar(tcx, k2._0.expect_local(), the_place_err, err);
        }
      }
    }
    // Complete hack to approximate old AST-borrowck diagnostic: if the span starts
    // with a mutable borrow of a local variable, then just suggest the user remove it.
    else if (
      n === 0 &&
      ((r) => r.$ === "Ok" && r._0.starts_with("&mut "))(this.infcx.tcx.sess.source_map().span_to_snippet(span))
    ) {
      err.span_label(span, `cannot ${act}`);
      err.span_suggestion_verbose(Span.with_hi(span, BytePos(Span.lo(span) + 5)), "try removing `&mut` here", "", Applicability.MaybeIncorrect);
    } else if (n === 1 && last!.$ === "Deref" && this.body.local_decls[local]!.is_ref_for_guard()) {
      err.span_label(span, `cannot ${act}`);
      err.note("variables bound in patterns are immutable until the end of the pattern guard");
    }
    // We want to point out when a `&` can be readily replaced
    // with an `&mut`.
    //
    // FIXME: can this case be generalized to work for an
    // arbitrary base for the projection?
    else if (n === 1 && last!.$ === "Deref" && this.body.local_decls[local]!.is_user_variable()) {
      const local_decl = this.body.local_decls[local]!;

      const [pointer_sigil, pointer_desc] = local_decl.ty.is_ref() ? ["&", "reference"] : ["*const", "pointer"];

      const name = this.local_name(local);
      if (name !== undefined && !local_decl.from_compiler_desugaring()) {
        err.span_label(span, `\`${Symbol.as_str(name)}\` is a \`${pointer_sigil}\` ${pointer_desc}, so it cannot be ${acted_on}`);

        this.suggest_using_iter_mut(err);
        this.suggest_make_local_mut(err, local, name);
      } else {
        err.span_label(span, `cannot ${act} through \`${pointer_sigil}\` ${pointer_desc}`);
      }
    } else if (n === 1 && last!.$ === "Deref" && (local as number) === (CAPTURE_STRUCT_LOCAL as number) && !(this.upvars.length === 0)) {
      this.point_at_binding_outside_closure(err, local, access_place);
      this.expected_fn_found_fn_mut_call(err, span, act);
    } else if (n >= 1 && last!.$ === "Deref") {
      err.span_label(span, `cannot ${act}`);

      if (opt_source !== undefined && opt_source.$ === "OverloadedDeref") {
        const ty = opt_source._0;
        err.help(`trait \`DerefMut\` is required to modify through a dereference, but it is not implemented for \`${display_Ty(ty)}\``);
      } else if (opt_source !== undefined && opt_source.$ === "OverloadedIndex") {
        const ty = opt_source._0;
        err.help(`trait \`IndexMut\` is required to modify indexed content, but it is not implemented for \`${display_Ty(ty)}\``);
        this.suggest_map_index_mut_alternatives(ty, err, span);
      } else {
        const local_ = this.body.local_decls[local]!;
        const li = local_.local_info_();
        if (li.$ === "StaticRef") {
          const span = this.infcx.tcx.def_span(li.def_id);
          err.span_label(span, `this \`static\` cannot be ${acted_on}`);
        } else if (li.$ === "ConstRef") {
          const span = this.infcx.tcx.def_span(li.def_id);
          err.span_label(span, `this \`const\` cannot be ${acted_on}`);
        } else if ((li.$ === "BlockTailTemp" || li.$ === "Boring") && !Span.overlaps(local_.source_info.span, span)) {
          err.span_label(local_.source_info.span, `this cannot be ${acted_on}`);
        }
      }
    } else {
      const local_ = this.body.local_decls[local]!;
      if (!Span.overlaps(local_.source_info.span, span)) {
        err.span_label(local_.source_info.span, `this cannot be ${acted_on}`);
      }
      err.span_label(span, `cannot ${act}`);
    }
  }

  if (mut_error !== undefined) {
    this.buffer_mut_error(mut_error, err, count);
  } else {
    this.buffer_error(err);
  }
};

/// Suggest `map[k] = v` => `map.insert(k, v)` and the like.
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:667 suggest_map_index_mut_alternatives
MirBorrowckCtxt.prototype.suggest_map_index_mut_alternatives = function (this: MirBorrowckCtxt, ty: Ty, err: Diag, span: Span): void {
  const adt = ty.ty_adt_def();
  if (adt === undefined) return;
  const did = adt.did();
  if (this.infcx.tcx.is_diagnostic_item(sym.HashMap, did) || this.infcx.tcx.is_diagnostic_item(sym.BTreeMap, did)) {
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
      // rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:685 visit_stmt
      override visit_stmt(stmt: hir.Stmt): undefined {
        hir.intravisit.walk_stmt(this, stmt);
        let expr: hir.Expr;
        const sk = stmt.kind;
        if (sk.$ === "Semi" || sk.$ === "Expr") {
          expr = sk._0;
        } else if (sk.$ === "Let" && sk._0.init !== undefined) {
          expr = sk._0.init;
        } else {
          return;
        }

        // Because of TypeChecking and indexing, we know: index is &Q
        // with K: Eq + Hash + Borrow<Q>,
        // with Q: Eq + Hash + ?Sized,
        //
        // which fulfill the requirements of `get_mut`. If Q=K or Q=&{n}K, the requirements
        // of `entry` and `insert` are fulfilled too after dereferencing. If K is not
        // copy, a subsequent `clone` call may be needed.

        /// Taken straight from https://doc.rust-lang.org/nightly/nightly-rustc/clippy_utils/fn.peel_hir_ty_refs.html
        /// Adapted to mid using https://doc.rust-lang.org/nightly/nightly-rustc/rustc_middle/ty/struct.Ty.html#method.peel_refs
        /// Simplified to counting only
        /// Peels off all references on the type. Returns the number of references
        /// removed.
        // rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:708 count_ty_refs
        function count_ty_refs(ty: Ty): number {
          let count = 0;
          let k;
          while ((k = ty.kind()).$ === "Ref") {
            ty = k._1;
            count += 1;
          }
          return count;
        }

        /// Try to strip `n` `&` reference from an expression.
        /// If the expression does not have enough leading `&`, return an Error
        /// containing a count of the successfully stripped ones and the stripped
        /// expression.
        // rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:721 strip_n_refs
        function strip_n_refs(expr: hir.Expr, n: number): Result<hir.Expr, [number, hir.Expr]> {
          for (let count = 0; count < n; count++) {
            if (expr.kind.$ === "AddrOf" && expr.kind._0 === "Ref") {
              expr = expr.kind._2;
            } else {
              return Err<[number, hir.Expr]>([count, expr]);
            }
          }
          return Ok(expr);
        }

        // we know ty is a map, with a key type at walk distance 2.
        const walk = this.ty.walk()[globalThis.Symbol.iterator]();
        walk.next();
        const key_ty = GenericArg.expect_ty(unwrap(walk.next().value as GenericArg | undefined));

        const ek = expr.kind;
        if (
          ek.$ === "Assign" &&
          ek._0.kind.$ === "Index" &&
          (expr.span === this.assign_span || ek._0.span === this.assign_span)
        ) {
          const place = ek._0;
          const rv = ek._1;
          const val = ek._0.kind._0;
          const index = ek._0.kind._1;
          // val[index] = rv;
          const index_ty = (this.infcx.tcx.typeck(val.hir_id.owner.def_id) as TypeckResults).expr_ty(index);

          let borrowed_prefix: string;
          let borrowed_index: hir.Expr;

          // only suggest `insert` and `entry` if index is of type K or &{n}K or *{n}K (when there is a Borrow impl for this case).
          // We use `peel_refs` because borrow lifetimes may differ in both index and
          // key. I.e, if they are of the same base type:
          if (index_ty.peel_refs() === key_ty.peel_refs()) {
            const [index_refs, key_refs] = [count_ty_refs(index_ty), count_ty_refs(key_ty)];

            let deref_prefix: string;
            let deref_index: hir.Expr;
            if (index_refs >= key_refs) {
              // index is &{n}K
              const r = strip_n_refs(index, index_refs - key_refs);
              if (r.$ === "Ok") {
                [deref_prefix, deref_index] = ["", r._0];
              } else {
                const [depth, val] = r._0;
                let prefix: string;
                if (key_refs === 0) {
                  const d = index_refs - key_refs - depth;
                  if (d < 0) panic("return depth from strip_n_refs should be smaller than the input");
                  prefix = "*".repeat(d);
                } else {
                  prefix = ""; //if key K is a ref, autoderef finish this for us.
                }
                [deref_prefix, deref_index] = [prefix, val];
              }
            } else {
              // in this case the minimal ref addition works for all subcases
              [deref_prefix, deref_index] = ["&".repeat(key_refs - index_refs), index];
            }

            this.err.multipart_suggestion(
              `use \`.insert()\` to insert a value into a \`${display_Ty(this.ty)}\``,
              [
                // val.insert({deref_prefix}{deref_index}, rv);
                [Span.with_hi(Span.shrink_to_hi(val.span), Span.lo(deref_index.span)), `.insert(${deref_prefix}`],
                [Span.with_hi(Span.shrink_to_hi(deref_index.span), Span.lo(rv.span)), ", "],
                [Span.shrink_to_hi(rv.span), ")"],
              ],
              Applicability.MaybeIncorrect,
            );
            this.err.multipart_suggestion(
              `use the entry API to modify a \`${display_Ty(this.ty)}\` for more flexibility`,
              [
                // let x = val.entry({deref_prefix}{deref_index}).insert_entry(rv);
                [Span.shrink_to_lo(val.span), "let val = "],
                [Span.with_hi(Span.shrink_to_hi(val.span), Span.lo(deref_index.span)), `.entry(${deref_prefix}`],
                [Span.with_hi(Span.shrink_to_hi(deref_index.span), Span.lo(rv.span)), ").insert_entry("],
                [Span.shrink_to_hi(rv.span), ")"],
              ],
              Applicability.MaybeIncorrect,
            );

            // we can make the next suggestions nicer by stripping as many leading `&` as
            // we can, autoderef will do the rest
            let bi: hir.Expr;
            if (index_refs > key_refs) {
              const r = strip_n_refs(index, index_refs - key_refs - 1);
              bi = r.$ === "Ok" ? r._0 : r._0[1];
              // even if we tried to strip more, we can stop there thanks to autoderef
            } else {
              // when the diff is negative or zero, we already are in the index=&Q case.
              bi = index;
            }
            [borrowed_prefix, borrowed_index] = ["", bi];
          } else {
            [borrowed_prefix, borrowed_index] = ["", index];
          }
          // in all cases, suggest get_mut because K:Borrow<K> or Q:Borrow<K> as a
          // requirement of indexing.
          this.err.multipart_suggestion(
            `use \`.get_mut()\` to modify an existing key in a \`${display_Ty(this.ty)}\``,
            [
              // if let Some(v) = val.get_mut({borrowed_prefix}{borrowed_index}) { *v = rv; }
              [Span.shrink_to_lo(val.span), "if let Some(val) = "],
              [Span.with_hi(Span.shrink_to_hi(val.span), Span.lo(borrowed_index.span)), `.get_mut(${borrowed_prefix}`],
              [Span.with_hi(Span.shrink_to_hi(borrowed_index.span), Span.hi(place.span)), ") { *val"],
              [Span.shrink_to_hi(rv.span), "; }"],
            ],
            Applicability.MaybeIncorrect,
          );

          this.suggested = true;
        } else if (ek.$ === "MethodCall" && ek._1.kind.$ === "Index" && ek._1.span === this.assign_span) {
          const receiver = ek._1;
          const sp = ek._3;
          const val = ek._1.kind._0;
          const index = ek._1.kind._1;
          // val[index].path(args..);
          this.err.multipart_suggestion(
            `to modify a \`${display_Ty(this.ty)}\` use \`.get_mut()\``,
            [
              [Span.shrink_to_lo(val.span), "if let Some(val) = "],
              [Span.with_hi(Span.shrink_to_hi(val.span), Span.lo(index.span)), ".get_mut("],
              [Span.with_hi(Span.shrink_to_hi(index.span), Span.hi(receiver.span)), ") { val"],
              [Span.shrink_to_hi(sp), "; }"],
            ],
            Applicability.MachineApplicable,
          );
          this.suggested = true;
        }
        return undefined;
      }
    }
    const def_id = this.body.source.def_id();
    const local_def_id = def_id.as_local();
    if (local_def_id === undefined) return;
    const body = this.infcx.tcx.hir_maybe_body_owned_by(local_def_id);
    if (body === undefined) return;

    const v = new SuggestIndexOperatorAlternativeVisitor(span, err, ty, false, this.infcx.infcx);
    v.visit_body(body);
    if (!v.suggested) {
      err.help(`to modify a \`${display_Ty(ty)}\`, use \`.get_mut()\`, \`.insert()\` or the entry API`);
    }
  }
};

/// User cannot make signature of a trait mutable without changing the
/// trait. So we find if this error belongs to a trait and if so we move
/// suggestion to the trait or disable it if it is out of scope of this crate
///
/// The returned values are:
///  - is the current item an assoc `fn` of an impl that corresponds to a trait def? if so, we
///    have to suggest changing both the impl `fn` arg and the trait `fn` arg
///  - is the trait from the local crate? If not, we can't suggest changing signatures
///  - `Span` of the argument in the trait definition
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:909 is_error_in_trait
MirBorrowckCtxt.prototype.is_error_in_trait = function (this: MirBorrowckCtxt, local: Local): [boolean, boolean, Span | undefined] {
  const tcx = this.infcx.tcx;
  if (this.body.local_kind(local) !== "Arg") {
    return [false, false, undefined];
  }
  const my_def = this.body.source.def_id();
  const impl_id = tcx.trait_impl_of_assoc(my_def);
  const td = impl_id === undefined ? undefined : this.infcx.tcx.impl_trait_id(impl_id);
  if (td === undefined) {
    return [false, false, undefined];
  }

  const implemented_trait_item = this.infcx.tcx.trait_item_of(my_def);

  return [
    true,
    td.is_local(),
    ((): Span | undefined => {
      if (implemented_trait_item === undefined) return undefined;
      const f_in_trait = implemented_trait_item.as_local();
      if (f_in_trait === undefined) return undefined;
      const node = this.infcx.tcx.hir_node_by_def_id(f_in_trait);
      let ty: hir.Ty | undefined;
      if (
        node.$ === "TraitItem" &&
        node._0.kind.$ === "Fn" &&
        (ty = node._0.kind._0.decl.inputs[local - 1]) !== undefined &&
        ty.kind.$ === "Ref" &&
        ty.kind._2 === "Not" &&
        ImplicitSelfKind.has_implicit_self(node._0.kind._0.decl.implicit_self())
      ) {
        return ty.span;
      } else {
        return undefined;
      }
    })(),
  ];
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:941 construct_mut_suggestion_for_local_binding_patterns
MirBorrowckCtxt.prototype.construct_mut_suggestion_for_local_binding_patterns = function (this: MirBorrowckCtxt, err: Diag, local: Local): void {
  const local_decl = this.body.local_decls[local]!;
  // debug!("local_decl: {:?}", local_decl);
  const li = local_decl.local_info_();
  const pat_span =
    li.$ === "User" && li._0.$ === "Var" && li._0._0.binding_mode._0.$ === "No" && li._0._0.binding_mode._1 === "Not"
      ? li._0._0.pat_span
      : local_decl.source_info.span;

  // With ref-binding patterns, the mutability suggestion has to apply to
  // the binding, not the reference (which would be a type error):
  //
  // `let &b = a;` -> `let &(mut b) = a;`
  // or
  // `fn foo(&x: &i32)` -> `fn foo(&(mut x): &i32)`
  const def_id = this.body.source.def_id();
  const local_def_id = def_id.as_local();
  let body: hir.Body | undefined;
  let found: ControlFlow<HirId>;
  if (
    local_def_id !== undefined &&
    (body = this.infcx.tcx.hir_maybe_body_owned_by(local_def_id)) !== undefined &&
    (found = new BindingFinder(pat_span).visit_body(body)).$ === "Break"
  ) {
    const hir_id = found._0;
    const node = this.infcx.tcx.hir_node(hir_id);
    if ((node.$ === "LetStmt" && node._0.pat.kind.$ === "Ref") || (node.$ === "Param" && node._0.pat.kind.$ === "Ref")) {
      err.multipart_suggestion(
        "consider changing this to be mutable",
        [
          [Span.until(pat_span, local_decl.source_info.span), "&(mut "],
          [Span.with_hi(Span.shrink_to_hi(local_decl.source_info.span), Span.hi(pat_span)), ")"],
        ],
        Applicability.MachineApplicable,
      );
      return;
    }
  }

  err.span_suggestion_verbose(
    Span.shrink_to_lo(local_decl.source_info.span),
    "consider changing this to be mutable",
    "mut ",
    Applicability.MachineApplicable,
  );
};

// Point to span of upvar making closure call that requires a mutable borrow
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1002 show_mutating_upvar
MirBorrowckCtxt.prototype.show_mutating_upvar = function (
  this: MirBorrowckCtxt,
  tcx: TyCtxt,
  closure_local_def_id: LocalDefId,
  the_place_err: PlaceRef,
  err: Diag,
): void {
  const tables = tcx.typeck(closure_local_def_id) as TypeckResults;
  const origin = tcx.closure_kind_origin(closure_local_def_id);
  if (origin !== undefined) {
    const [span, closure_kind_origin] = origin;
    let reason: string;
    if (closure_kind_origin.base.$ === "Upvar") {
      const upvar_id = closure_kind_origin.base._0;
      const upvar = place_to_string_for_capture(tcx, closure_kind_origin);
      const root_hir_id = upvar_id.var_path.hir_id;
      // We have an origin for this closure kind starting at this root variable so it's
      // safe to unwrap here.
      const min_captures = tables.closure_min_captures.get(closure_local_def_id);
      if (min_captures === undefined) return panic("key not found in map");
      const captured_places = unwrap(min_captures.get(root_hir_id));

      const origin_projection = closure_kind_origin.projections.map((proj) => proj.kind);
      let capture_reason = "";
      for (const captured_place of captured_places) {
        const captured_place_kinds = captured_place.place.projections.map((proj) => proj.kind);
        if (is_ancestor_or_same_capture(captured_place_kinds, origin_projection)) {
          const ck = captured_place.info.capture_kind;
          if (ck.$ === "ByRef" && (ck._0 === "Mutable" || ck._0 === "UniqueImmutable")) {
            capture_reason = `mutable borrow of \`${upvar}\``;
          } else if (ck.$ === "ByValue" || ck.$ === "ByUse") {
            capture_reason = `possible mutation of \`${upvar}\``;
          } else {
            return bug(`upvar \`${upvar}\` borrowed, but not mutably`);
          }
          break;
        }
      }
      if (capture_reason === "") {
        return bug(`upvar \`${upvar}\` borrowed, but cannot find reason`);
      }
      reason = capture_reason;
    } else {
      return bug("not an upvar");
    }
    // Sometimes we deliberately don't store the name of a place when coming from a macro in
    // another crate. We generally want to limit those diagnostics a little, to hide
    // implementation details (such as those from pin!() or format!()). In that case show a
    // slightly different error message, or none at all if something else happened. In other
    // cases the message is likely not useful.
    const place_name = this.describe_place(the_place_err);
    if (place_name !== undefined) {
      err.span_label(span, `calling \`${place_name}\` requires mutable binding due to ${reason}`);
    } else if (Span.from_expansion(span)) {
      err.span_label(span, `a call in this macro requires a mutable binding due to ${reason}`);
    }
  }
};

// Attempt to search similar mutable associated items for suggestion.
// In the future, attempt in all path but initially for RHS of for_loop
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1078 suggest_similar_mut_method_for_for_loop
MirBorrowckCtxt.prototype.suggest_similar_mut_method_for_for_loop = function (this: MirBorrowckCtxt, err: Diag, span: Span): void {
  const tcx = this.infcx.tcx;
  // rustc-type: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1083 Finder
  class Finder extends hir.intravisit.Visitor<ControlFlow<hir.Expr>> {
    // impl<'tcx> Visitor<'tcx> for Finder { type Result = ControlFlow<&'tcx Expr<'tcx>>; }
    override Result = VisitorResult.ControlFlow<hir.Expr>();

    constructor(public span: Span) {
      super();
    }

    // impl<'tcx> Visitor<'tcx> for Finder
    // rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1089 visit_expr
    override visit_expr(e: hir.Expr): ControlFlow<hir.Expr> {
      if (e.span === this.span) {
        return ControlFlow.Break(e);
      } else {
        return hir.intravisit.walk_expr(this, e);
      }
    }
  }
  const body = tcx.hir_maybe_body_owned_by(this.mir_def_id());
  if (body === undefined) return;
  if (body.value.kind.$ !== "Block") return;
  const block = body.value.kind._0;
  // `span` corresponds to the expression being iterated, find the `for`-loop desugared
  // expression with that span in order to identify potential fixes when encountering a
  // read-only iterator that should be mutable.
  const found = new Finder(span).visit_block(block);
  let expr: hir.Expr;
  if (found.$ === "Break" && found._0.kind.$ === "Call" && found._0.kind._1.length === 1) {
    expr = found._0.kind._1[0]!;
  } else {
    return;
  }
  for (;;) {
    const ek = expr.kind;
    if (ek.$ === "MethodCall") {
      const path_segment = ek._0;
      const span = ek._3;
      // We have `for _ in iter.read_only_iter()`, try to
      // suggest `for _ in iter.mutable_iter()` instead.
      const type_dependent = (tcx.typeck(path_segment.hir_id.owner.def_id) as TypeckResults).type_dependent_def_id(expr.hir_id);
      const impl_id = type_dependent === undefined ? undefined : tcx.impl_of_assoc(type_dependent);
      const opt_suggestions =
        impl_id === undefined
          ? undefined
          : [...AssocItems.in_definition_order(tcx.associated_items(impl_id) as AssocItems)]
              .map((assoc_item_def) => AssocItem.ident(assoc_item_def, tcx))
              .filter((ident) => {
                const original_method_ident = path_segment.ident;
                return !original_method_ident.eq(ident) && ident.as_str().startsWith(Symbol.as_str(original_method_ident.name));
              })
              .map((ident) => `${display_Ident(ident)}()`);

      if (opt_suggestions !== undefined && opt_suggestions.length > 0) {
        err.span_suggestions(span, "use mutable method", opt_suggestions, Applicability.MaybeIncorrect);
      }
    } else if (ek.$ === "AddrOf" && ek._0 === "Ref" && ek._1 === "Not") {
      const expr = ek._2;
      // We have `for _ in &i`, suggest `for _ in &mut i`.
      err.span_suggestion_verbose(Span.shrink_to_lo(expr.span), "use a mutable iterator instead", "mut ", Applicability.MachineApplicable);
    } else if (ek.$ === "Path" && ek._0.$ === "Resolved" && ek._0._0 === undefined && ek._0._1.res.$ === "Local") {
      const hir_id = ek._0._1.res._0;
      const parent = this.infcx.tcx.parent_hir_node(hir_id);
      if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
        // We're iterating over a binding, try to suggest changing the binding's expr.
        expr = parent._0.init;
        continue;
      }
    }
    break;
  }
};

/// When modifying a binding from inside of an `Fn` closure, point at the binding definition.
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1171 point_at_binding_outside_closure
MirBorrowckCtxt.prototype.point_at_binding_outside_closure = function (this: MirBorrowckCtxt, err: Diag, local: Local, access_place: Place): void {
  const place = access_place.as_ref();
  for (let index = 0; index < place.projection.length; index++) {
    const elem = place.projection[index]!;
    if (elem.$ === "Deref") {
      if (index === 0) {
        if (this.body.local_decls[local]!.is_ref_for_guard()) {
          continue;
        }
        if (this.body.local_decls[local]!.local_info_().$ === "StaticRef") {
          continue;
        }
      }
      const field = this.is_upvar_field_projection(new PlaceRef(local, place.projection.slice(0, index + 1)));
      if (field !== undefined) {
        const var_index = field;
        const upvar = this.upvars[var_index]!;
        const hir_id = upvar.info.capture_kind_expr_id;
        if (hir_id !== undefined) {
          const node = this.infcx.tcx.hir_node(hir_id);
          if (
            node.$ === "Expr" &&
            node._0.kind.$ === "Path" &&
            node._0.kind._0.$ === "Resolved" &&
            node._0.kind._0._0 === undefined &&
            node._0.kind._0._1.res.$ === "Local"
          ) {
            const pat_node = this.infcx.tcx.hir_node(node._0.kind._0._1.res._0);
            if (pat_node.$ === "Pat") {
              const pat = pat_node._0;
              const name = upvar.to_string(this.infcx.tcx);
              err.span_label(pat.span, `\`${name}\` declared here, outside the closure`);
              break;
            }
          }
        }
      }
    }
  }
};

/// Targeted error when encountering an `FnMut` closure where an `Fn` closure was expected.
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1215 expected_fn_found_fn_mut_call
MirBorrowckCtxt.prototype.expected_fn_found_fn_mut_call = function (this: MirBorrowckCtxt, err: Diag, sp: Span, act: string): void {
  err.span_label(sp, `cannot ${act}`);

  const tcx = this.infcx.tcx;
  const closure_id = this.mir_hir_id();
  const closure_span = tcx.def_span(this.mir_def_id());
  const fn_call_id = tcx.parent_hir_id(closure_id);
  const node = tcx.hir_node(fn_call_id);
  const def_id = tcx.hir_enclosing_body_owner(fn_call_id);
  let look_at_return = true;

  err.span_label(closure_span, "in this closure");
  const closure_arg_has_fn_trait_bound = (callee_def_id: DefId, input_index: number, generic_args: GenericArgs): boolean => {
    // PORT: queries.gen.ts types the `fn_sig` / `clauses_of` query values `unknown`; they are `EarlyBinder<PolyFnSig>` /
    // `GenericClauses`.
    const sig = Unnormalized.skip_binder(
      EarlyBinder.instantiate(tcx.fn_sig(callee_def_id) as EarlyBinder<Binder<FnSig>>, tcx, generic_args, fold_Binder(fold_FnSig)),
    );
    const input_ty: Ty | undefined = FnSig.inputs(sig)[input_index];
    if (input_ty === undefined) {
      return false;
    }

    return GenericClauses.instantiate(tcx.clauses_of(callee_def_id) as GenericClauses, tcx, generic_args).clauses.some((clause) => {
      const trait_pred = UnnormalizedClause.as_trait_clause(clause);
      return (
        trait_pred !== undefined &&
        UnnormalizedPolyTraitClause.polarity(trait_pred) === "Positive" &&
        tcx.fn_trait_kind_from_def_id(UnnormalizedPolyTraitClause.def_id(trait_pred)) === "Fn" &&
        Unnormalized.skip_binder(UnnormalizedPolyTraitClause.self_ty(trait_pred)).peel_refs() === input_ty.peel_refs()
      );
    });
  };

  // If the HIR node is a function or method call, get the DefId
  // of the callee function or method, the span, and argument info for the call expr.
  const get_call_details = (): [DefId, Span, number, number, GenericArgs] | undefined => {
    if (node.$ !== "Expr") {
      return undefined;
    }
    const { hir_id, kind } = node._0;

    const typeck_results = tcx.typeck(def_id) as TypeckResults;

    if (kind.$ === "Call") {
      const expr = kind._0;
      const args = kind._1;
      const ty = typeck_results.node_type_opt(expr.hir_id);
      const k = ty === undefined ? undefined : ty.kind();
      if (k !== undefined && k.$ === "FnDef") {
        const def_id = k._0;
        const generic_args = k._1;
        const arg_pos = args.findIndex((arg) => HirId_eq(arg.hir_id, closure_id));
        if (arg_pos === -1) return undefined;
        return [def_id, expr.span, arg_pos, arg_pos, unwrap(Binder.no_bound_vars(generic_args, fold_GenericArgs))];
      } else {
        return undefined;
      }
    } else if (kind.$ === "MethodCall") {
      const args = kind._2;
      const span = kind._3;
      const arg_pos = args.findIndex((arg) => HirId_eq(arg.hir_id, closure_id));
      if (arg_pos === -1) return undefined;
      const def_id = typeck_results.type_dependent_def_id(hir_id);
      if (def_id === undefined) return undefined;
      const generic_args = typeck_results.node_args_opt(hir_id);
      if (generic_args === undefined) return undefined;
      return [def_id, span, arg_pos, arg_pos + 1, generic_args];
    } else {
      return undefined;
    }
  };

  // If we can detect the expression to be a function or method call where the closure was
  // an argument, we point at the function or method definition argument...
  const call_details = get_call_details();
  if (call_details !== undefined) {
    const [callee_def_id, call_span, arg_pos, input_index, generic_args] = call_details;
    const fn_node = tcx.hir_get_if_local(callee_def_id);
    const ident_sig = fn_node === undefined ? undefined : fn_ident_and_sig(fn_node);
    let arg: Span | undefined;
    if (ident_sig !== undefined) {
      const [ident, sig] = ident_sig;
      const input = sig.decl.inputs[arg_pos + (ImplicitSelfKind.has_implicit_self(sig.decl.implicit_self()) ? 1 : 0)];
      arg = input !== undefined ? input.span : ident.span;
    } else {
      arg = undefined;
    }
    if (arg !== undefined) {
      const span = arg;
      err.span_label(span, "change this to accept `FnMut` instead of `Fn`");
      err.span_label(call_span, "expects `Fn` instead of `FnMut`");
      look_at_return = false;
    } else if (closure_arg_has_fn_trait_bound(callee_def_id, input_index, generic_args)) {
      // The callee is not local, so we cannot point at its argument declaration, but we
      // can still explain that this call site expects an `Fn` closure. Avoid falling
      // through to the enclosing function's return type, which is misleading in cases
      // like `flat_map(|_| external::map(|_| ...))`.
      err.span_label(call_span, "expects `Fn` instead of `FnMut`");
      look_at_return = false;
    }
  }

  if (look_at_return && tcx.hir_get_fn_id_for_return_block(closure_id) !== undefined) {
    // ...otherwise we are probably in the tail expression of the function, point at the
    // return type.
    const ident_sig = fn_ident_and_sig(tcx.hir_node_by_def_id(tcx.hir_get_parent_item(fn_call_id).def_id));
    if (ident_sig !== undefined) {
      const [ident, sig] = ident_sig;
      err.span_context(ident.span);
      err.span_label(hir.FnRetTy.span(sig.decl.output), "change this to return `FnMut` instead of `Fn`");
    }
  }
};

/** PORT: `TypeFoldable` table of `TraitRef` (for `Binder::dummy`). */
const fold_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

/** PORT: the or-pattern `Node::Item(Item { kind: ItemKind::Fn { ident, sig, .. }, .. }) | Node::TraitItem(TraitItem { ident,
 *  kind: TraitItemKind::Fn(sig, _), .. }) | Node::ImplItem(ImplItem { ident, kind: ImplItemKind::Fn(sig, _), .. })` shared by
 *  two matches of `expected_fn_found_fn_mut_call`. */
function fn_ident_and_sig(node: hir.Node): [Ident, hir.FnSig] | undefined {
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    return [node._0.kind.ident, node._0.kind.sig];
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
    return [node._0.ident, node._0.kind._0];
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    return [node._0.ident, node._0.kind._0];
  }
  return undefined;
}

// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1359 suggest_using_iter_mut
MirBorrowckCtxt.prototype.suggest_using_iter_mut = function (this: MirBorrowckCtxt, err: Diag): void {
  const source = this.body.source;
  if (source.instance.$ !== "Item") return;
  const def_id = source.instance._0;
  const n = this.infcx.tcx.hir_get_if_local(def_id);
  if (n === undefined || n.$ !== "Expr") return;
  const { hir_id, kind } = n._0;
  if (!(kind.$ === "Closure" && kind._0.kind.$ === "Closure")) return;
  const parent = this.infcx.tcx.parent_hir_node(hir_id);
  if (parent.$ !== "Expr") return;
  const expr = parent._0;
  let cur_expr = expr;
  let ck;
  while ((ck = cur_expr.kind).$ === "MethodCall") {
    const path_segment = ck._0;
    const recv = ck._1;
    if (path_segment.ident.name === sym.iter) {
      // Check that the type has an `iter_mut` method.
      const type_dependent = (this.infcx.tcx.typeck(path_segment.hir_id.owner.def_id) as TypeckResults).type_dependent_def_id(cur_expr.hir_id);
      const impl_id = type_dependent === undefined ? undefined : this.infcx.tcx.impl_of_assoc(type_dependent);
      const res =
        impl_id === undefined ? undefined : [...AssocItems.filter_by_name_unhygienic(this.infcx.tcx.associated_items(impl_id) as AssocItems, sym.iter_mut)];

      if (res !== undefined && res.length > 0) {
        err.span_suggestion_verbose(path_segment.ident.span, "you may want to use `iter_mut` here", "iter_mut", Applicability.MaybeIncorrect);
      }
      break;
    } else {
      cur_expr = recv;
    }
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1400 suggest_make_local_mut
MirBorrowckCtxt.prototype.suggest_make_local_mut = function (this: MirBorrowckCtxt, err: Diag, local: Local, name: Symbol): void {
  const local_decl = this.body.local_decls[local]!;

  const [pointer_sigil, pointer_desc] = local_decl.ty.is_ref() ? ["&", "reference"] : ["*const", "pointer"];

  const [is_trait_sig, is_local, local_trait] = this.is_error_in_trait(local);

  if (is_trait_sig && !is_local) {
    // Do not suggest changing the signature when the trait comes from another crate.
    err.span_label(local_decl.source_info.span, `this is an immutable ${pointer_desc}`);
    return;
  }

  // Do not suggest changing type if that is not under user control.
  if (this.is_closure_arg_with_non_locally_decided_type(local)) {
    return;
  }

  const decl_span = local_decl.source_info.span;

  let amp_mut_sugg: AmpMutSugg;
  let local_var_ty_info: Span | undefined;
  const li = local_decl.local_info_();
  if (li.$ === "User" && li._0.$ === "ImplicitSelf") {
    const [span, suggestion] = suggest_ampmut_self(this.infcx.tcx, decl_span);
    const additional = local_trait === undefined ? undefined : suggest_ampmut_self(this.infcx.tcx, local_trait);
    [amp_mut_sugg, local_var_ty_info] = [{ $: "Type", span, suggestion, additional }, undefined];
  } else if (li.$ === "User" && li._0.$ === "Var" && li._0._0.binding_mode._0.$ === "No") {
    const opt_ty_info = li._0._0.opt_ty_info;
    // Check if the RHS is from desugaring.
    const first_assignment = find_assignments(this.body, local)[0];
    const first_assignment_stmt =
      first_assignment === undefined ? undefined : this.body.index(first_assignment.block).statements[first_assignment.statement_index];
    // trace!(?first_assignment_stmt);
    const opt_assignment_rhs_span = first_assignment === undefined ? undefined : this.body.source_info(first_assignment).span;
    let source_span = opt_assignment_rhs_span;
    if (
      first_assignment_stmt !== undefined &&
      first_assignment_stmt.kind.$ === "Assign" &&
      first_assignment_stmt.kind._0[1].$ === "Use" &&
      first_assignment_stmt.kind._0[1]._0.$ === "Copy"
    ) {
      const place = first_assignment_stmt.kind._0[1]._0._0;
      const local_span = this.body.local_decls[place.local]!.source_info.span;
      // `&self` in async functions have a `desugaring_kind`, but the local we assign
      // it with does not, so use the local_span for our checks later.
      source_span = local_span;
      const dk = Span.desugaring_kind(local_span);
      if (dk !== undefined && dk.$ === "ForLoop") {
        // On for loops, RHS points to the iterator part.
        this.suggest_similar_mut_method_for_for_loop(err, local_span);
        err.span_label(local_span, `this iterator yields \`${pointer_sigil}\` ${pointer_desc}s`);
        return;
      }
    }

    // Don't create labels for compiler-generated spans or spans not from users' code.
    if (
      source_span !== undefined &&
      (Span.desugaring_kind(source_span) !== undefined || this.infcx.tcx.sess.source_map().is_imported(source_span))
    ) {
      return;
    }

    // This could be because we're in an `async fn`.
    if (name === kw.SelfLower && opt_ty_info === undefined) {
      const [span, suggestion] = suggest_ampmut_self(this.infcx.tcx, decl_span);
      [amp_mut_sugg, local_var_ty_info] = [{ $: "Type", span, suggestion, additional: undefined }, undefined];
    } else {
      const sugg = suggest_ampmut(this.infcx, this.body_(), first_assignment_stmt);
      if (sugg !== undefined) {
        [amp_mut_sugg, local_var_ty_info] = [sugg, opt_ty_info];
      } else {
        return;
      }
    }
  } else if (li.$ === "User" && li._0.$ === "Var" && li._0._0.binding_mode._0.$ === "Yes") {
    const pattern_span: Span = local_decl.source_info.span;
    const span = suggest_ref_mut(this.infcx.tcx, pattern_span);
    if (span === undefined) {
      return;
    }
    [amp_mut_sugg, local_var_ty_info] = [{ $: "Type", span, suggestion: "mut ", additional: undefined }, undefined];
  } else {
    return unreachable();
  }

  const suggest = (suggs: [Span, string][], applicability: Applicability, extra: string): void => {
    if (suggs.some(([span]) => this.infcx.tcx.sess.source_map().is_imported(span))) {
      return;
    }

    err.multipart_suggestion(
      `consider changing this to be a mutable ${pointer_desc}${is_trait_sig ? " in the `impl` method and the `trait` definition" : ""}${extra}`,
      suggs,
      applicability,
    );
  };

  let sugg: [Span, string][];
  let add_type_annotation_if_not_exists: boolean;
  switch (amp_mut_sugg.$) {
    case "Type": {
      const { span, suggestion, additional } = amp_mut_sugg;
      const sugg: [Span, string][] = [[span, suggestion]];
      if (additional !== undefined) sugg.push(additional);
      suggest(sugg, Applicability.MachineApplicable, "");
      return;
    }
    case "MapGetMut": {
      const { span, suggestion } = amp_mut_sugg;
      if (this.infcx.tcx.sess.source_map().is_imported(span)) {
        return;
      }
      err.multipart_suggestion("consider using `get_mut`", [[span, suggestion]], Applicability.MaybeIncorrect);
      return;
    }
    case "Expr": {
      const { span, suggestion } = amp_mut_sugg;
      // `Expr` suggestions should change type annotations if they already exist (probably immut),
      // but do not add new type annotations.
      [sugg, add_type_annotation_if_not_exists] = [[[span, suggestion]], false];
      break;
    }
    case "ChangeBinding":
      [sugg, add_type_annotation_if_not_exists] = [[], true];
      break;
  }

  // Find a binding's type to make mutable.
  let binding_exists: boolean;
  let span: Span;
  if (local_var_ty_info !== undefined) {
    // If this is a variable binding with an explicit type,
    // then we will suggest changing it to be mutable.
    // This is `Applicability::MachineApplicable`.
    [binding_exists, span] = [true, local_var_ty_info];
  } else {
    // Otherwise, we'll suggest *adding* an annotated type, we'll suggest
    // the RHS's type for that.
    // This is `Applicability::HasPlaceholders`.
    [binding_exists, span] = [false, decl_span];
  }

  if (!binding_exists && !add_type_annotation_if_not_exists) {
    suggest(sugg, Applicability.MachineApplicable, "");
    return;
  }

  // If the binding already exists and is a reference with an explicit
  // lifetime, then we can suggest adding ` mut`. This is special-cased from
  // the path without an explicit lifetime.
  let sugg_span: Span;
  let sugg_str: string;
  let suggest_now: boolean;
  const src_r = this.infcx.tcx.sess.source_map().span_to_snippet(span);
  let ws_pos: number | undefined;
  if (
    src_r.$ === "Ok" &&
    src_r._0.starts_with("&'") &&
    // Note that `&' a T` is invalid so this is correct.
    (ws_pos = str_find_pred(src_r._0, is_whitespace)) !== undefined
  ) {
    const span_ = Span.shrink_to_lo(Span.with_lo(span, BytePos(Span.lo(span) + ws_pos)));
    [sugg_span, sugg_str, suggest_now] = [span_, " mut", true];
    // If there is already a binding, we modify it to be `mut`.
  } else if (binding_exists) {
    // Replace the sigil with the mutable version. We may be dealing
    // with parser recovery here and cannot assume the user actually
    // typed `&` or `*const`, so we compute the prefix from the snippet.
    const src_r = this.infcx.tcx.sess.source_map().span_to_snippet(span);
    if (src_r.$ !== "Ok") {
      return;
    }
    const src = src_r._0;
    let prefix_len: number;
    let replacement: string;
    if (local_decl.ty.is_ref()) {
      const c = src.chars().next();
      [prefix_len, replacement] = [c === undefined ? 0 : len_utf8(c), "&mut "];
    } else {
      const i = src.find("const");
      [prefix_len, replacement] = [i === undefined ? 1 : i + utf8_len("const"), "*mut "];
    }
    const rest = src.slice(prefix_len);
    const ws_len = rest.len() - str_trim_start(rest).len();
    const span_ = Span.with_hi(span, BytePos(Span.lo(span) + (prefix_len + ws_len)));
    [sugg_span, sugg_str, suggest_now] = [span_, replacement, true];
  } else {
    // Otherwise, suggest that the user annotates the binding; We provide the
    // type of the local.
    const ty = unwrap(local_decl.ty.builtin_deref(true));

    [sugg_span, sugg_str, suggest_now] = [span, `${local_decl.ty.is_ref() ? "&" : "*"}mut ${display_Ty(ty)}`, false];
  }

  if (suggest_now) {
    // Suggest changing `&x` to `&mut x` and changing `&T` to `&mut T` at the same time.
    const has_change = !(sugg.length === 0);
    sugg.push([sugg_span, sugg_str]);
    suggest(
      sugg,
      Applicability.MachineApplicable,
      // FIXME(fee1-dead) this somehow doesn't fire
      has_change ? " and changing the binding's type" : "",
    );
    return;
  } else if (!(sugg.length === 0)) {
    suggest(sugg, Applicability.MachineApplicable, "");
    return;
  }

  const def_id = this.body.source.def_id();
  let hir_id: HirId | undefined;
  const local_def_id = def_id.as_local();
  let body: hir.Body | undefined;
  if (local_def_id !== undefined && (body = this.infcx.tcx.hir_maybe_body_owned_by(local_def_id)) !== undefined) {
    const r = new BindingFinder(sugg_span).visit_body(body);
    hir_id = r.$ === "Break" ? r._0 : undefined;
  } else {
    hir_id = undefined;
  }
  const node = hir_id === undefined ? undefined : this.infcx.tcx.hir_node(hir_id);

  if (node === undefined || node.$ !== "LetStmt") {
    err.span_label(sugg_span, `consider changing this binding's type to be: \`${sugg_str}\``);
    return;
  }
  const local_ = node._0;

  const tables = this.infcx.tcx.typeck(unwrap(def_id.as_local())) as TypeckResults;
  const clone_trait = this.infcx.tcx.lang_items().clone_trait();
  const expr = local_.init;
  let ty: Ty | undefined;
  if (
    clone_trait !== undefined &&
    expr !== undefined &&
    (ty = tables.node_type_opt(expr.hir_id)) !== undefined &&
    ty.kind().$ === "Ref"
  ) {
    const errors_ = this.infcx.type_implements_trait_shallow(clone_trait, ty.peel_refs(), this.infcx.param_env);
    const errors = errors_ === undefined ? undefined : TraitErrors.as_slice(errors_);
    if (errors !== undefined && errors.length === 0) {
      // FIXME: This error message isn't useful, since we're just
      // vaguely suggesting to clone a value that already
      // implements `Clone`.
      //
      // A correct suggestion here would take into account the fact
      // that inference may be affected by missing types on bindings,
      // etc., to improve "tests/ui/borrowck/issue-91206.stderr", for
      // example.
    } else if (errors === undefined) {
      if (expr.kind.$ === "MethodCall" && expr.kind._2.length === 0 && expr.kind._0.ident.name === sym.clone) {
        const span = expr.kind._3;
        err.span_help(
          span,
          `\`${display_Ty(ty.peel_refs())}\` doesn't implement \`Clone\`, so this call clones the reference \`${display_Ty(ty)}\``,
        );
      }
      // The type doesn't implement Clone.
      const trait_ref = Binder.dummy(TraitRef.new(as_interner(this.infcx.tcx), clone_trait, [GenericArg.from_Ty(ty.peel_refs())]), fold_TraitRef);
      const obligation = Obligation.new(
        this.infcx.tcx,
        ObligationCause.dummy(),
        this.infcx.param_env,
        trait_ref,
        Predicate_upcast_from_PolyTraitRef as (from: PolyTraitRef, tcx: Interner) => Predicate,
      );
      this.infcx.err_ctxt().suggest_derive(obligation, err, PolyTraitClause.upcast_from_PolyTraitRef(trait_ref, as_interner(this.infcx.tcx)));
    } else {
      if (expr.kind.$ === "MethodCall" && expr.kind._2.length === 0 && expr.kind._0.ident.name === sym.clone) {
        const span = expr.kind._3;
        err.span_help(
          span,
          `\`${display_Ty(ty.peel_refs())}\` doesn't implement \`Clone\` because its implementations trait bounds could not be met, so this call clones the reference \`${display_Ty(ty)}\``,
        );
        err.note(`the following trait bounds weren't met: ${errors.map((e) => display_Predicate(e.obligation.predicate)).join("\n")}`);
      }
      // The type doesn't implement Clone because of unmet obligations.
      for (const error of errors) {
        let pk;
        if (
          error.code.$ === "Select" &&
          error.code._0.$ === "Unimplemented" &&
          (pk = Binder.skip_binder(error.obligation.predicate.kind())).$ === "Clause" &&
          pk._0.$ === "Trait"
        ) {
          const pred = pk._0._0;
          this.infcx.err_ctxt().suggest_derive(error.obligation, err, Binder.rebind(error.obligation.predicate.kind(), pred));
        }
      }
    }
  }
  let changing: string;
  let span__: Span;
  let sugg_: string;
  if (local_.ty !== undefined) {
    [changing, span__, sugg_] = ["changing", local_.ty.span, sugg_str];
  } else {
    [changing, span__, sugg_] = ["specifying", Span.shrink_to_hi(local_.pat.span), `: ${sugg_str}`];
  }
  err.span_suggestion_verbose(span__, `consider ${changing} this binding's type`, sugg_, Applicability.HasPlaceholders);
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
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1746 is_closure_arg_with_non_locally_decided_type
MirBorrowckCtxt.prototype.is_closure_arg_with_non_locally_decided_type = function (this: MirBorrowckCtxt, local: Local): boolean {
  // We don't care about regular local variables, only args.
  if (this.body.local_kind(local) !== "Arg") {
    return false;
  }

  // Make sure we are inside a closure.
  if (this.body.source.instance.$ !== "Item") {
    return false;
  }
  const body_def_id = this.body.source.instance._0;
  const n = this.infcx.tcx.hir_get_if_local(body_def_id);
  if (n === undefined || n.$ !== "Expr") {
    return false;
  }
  const { hir_id: body_hir_id, kind } = n._0;
  if (!(kind.$ === "Closure" && kind._0.kind.$ === "Closure")) {
    return false;
  }

  // Check if the method/function that our closure is passed to is defined
  // in another crate.
  const p = this.infcx.tcx.parent_hir_node(body_hir_id);
  if (p.$ !== "Expr") {
    return false;
  }
  const closure_parent = p._0;
  const ck = closure_parent.kind;
  if (ck.$ === "MethodCall") {
    const method = ck._0;
    const def_id = (this.infcx.tcx.typeck(method.hir_id.owner.def_id) as TypeckResults).type_dependent_def_id(closure_parent.hir_id);
    return def_id !== undefined && !def_id.is_local();
  } else if (ck.$ === "Call") {
    const func = ck._0;
    const ty = (this.infcx.tcx.typeck(func.hir_id.owner.def_id) as TypeckResults).node_type_opt(func.hir_id);
    let def_id: DefId | undefined;
    if (ty !== undefined) {
      const k = ty.kind();
      def_id = k.$ === "FnDef" ? k._0 : undefined;
    }
    return def_id !== undefined && !def_id.is_local();
  } else {
    return false;
  }
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1792 BindingFinder
export class BindingFinder extends hir.intravisit.Visitor<ControlFlow<HirId>> {
  // impl<'tcx> Visitor<'tcx> for BindingFinder { type Result = ControlFlow<hir::HirId>; }
  override Result = VisitorResult.ControlFlow<HirId>();

  constructor(public span: Span) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for BindingFinder
  // rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1798 visit_stmt
  override visit_stmt(s: hir.Stmt): ControlFlow<HirId> {
    if (s.kind.$ === "Let" && s.kind._0.pat.span === this.span) {
      return ControlFlow.Break(s.kind._0.hir_id);
    } else {
      return hir.intravisit.walk_stmt(this, s);
    }
  }

  // rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1808 visit_param
  override visit_param(param: hir.Param): ControlFlow<HirId> {
    if (param.pat.kind.$ === "Ref" && param.pat.span === this.span) {
      return ControlFlow.Break(param.hir_id);
    } else {
      return ControlFlow.CONTINUE;
    }
  }
}

// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1819 mut_borrow_of_mutable_ref
function mut_borrow_of_mutable_ref(local_decl: LocalDecl, local_name: Symbol | undefined): boolean {
  // debug!("local_info: {:?}, ty.kind(): {:?}", local_decl.local_info, local_decl.ty.kind());

  const li = local_decl.local_info_();
  // Check if mutably borrowing a mutable reference.
  if (li.$ === "User" && li._0.$ === "Var" && li._0._0.binding_mode._0.$ === "No" && li._0._0.binding_mode._1 === "Not") {
    const k = local_decl.ty.kind();
    return k.$ === "Ref" && k._2 === "Mut";
  } else if (li.$ === "User" && li._0.$ === "ImplicitSelf") {
    const kind = li._0._0;
    // Check if the user variable is a `&mut self` and we can therefore
    // suggest removing the `&mut`.
    //
    // Deliberately fall into this case for all implicit self types,
    // so that we don't fall into the next case with them.
    return kind === "RefMut";
  } else if (kw.SelfLower === local_name) {
    // Otherwise, check if the name is the `self` keyword - in which case
    // we have an explicit self. Do the same thing in this case and check
    // for a `self: &mut Self` to suggest removing the `&mut`.
    const k = local_decl.ty.kind();
    return k.$ === "Ref" && k._2 === "Mut";
  } else {
    return false;
  }
}

// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1846 suggest_ampmut_self
function suggest_ampmut_self(tcx: TyCtxt, span: Span): [Span, string] {
  const r = tcx.sess.source_map().span_to_snippet(span);
  if (r.$ === "Ok" && r._0.toString().endsWith("self")) {
    return [Span.shrink_to_hi(Span.with_hi(span, BytePos(Span.hi(span) - 4))), "mut "];
  } else {
    return [span, "&mut self"];
  }
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
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1891 suggest_ampmut
function suggest_ampmut(infcx: BorrowckInferCtxt, body: Body, opt_assignment_rhs_stmt: Statement | undefined): AmpMutSugg | undefined {
  const tcx = infcx.tcx;
  // If there is a RHS and it starts with a `&` from it, then check if it is
  // mutable, and if not, put suggest putting `mut ` to make it mutable.
  // We don't have to worry about lifetime annotations here because they are
  // not valid when taking a reference. For example, the following is not valid Rust:
  //
  // let x: &i32 = &'a 5;
  //                ^^ lifetime annotation not allowed
  //
  let rhs_str_r;
  if (
    opt_assignment_rhs_stmt !== undefined &&
    opt_assignment_rhs_stmt.kind.$ === "Assign" &&
    (rhs_str_r = tcx.sess.source_map().span_to_snippet(opt_assignment_rhs_stmt.source_info.span)).$ === "Ok"
  ) {
    const rhs_stmt = opt_assignment_rhs_stmt;
    const [lhs, rvalue_] = opt_assignment_rhs_stmt.kind._0;
    let rhs_span = rhs_stmt.source_info.span;
    let rhs_str = rhs_str_r._0;
    let rvalue = rvalue_;

    // Take some special care when handling `let _x = &*_y`:
    // We want to know if this is part of an overloaded index, so `let x = &a[0]`,
    // or whether this is a usertype ascription (`let _x: &T = y`).
    let assign: Location | undefined;
    if (
      rvalue.$ === "Ref" &&
      rvalue._1.$ === "Shared" &&
      rvalue._2.projection.length === 1 &&
      rvalue._2.projection[0]!.$ === "Deref" &&
      (assign = find_assignments(body, rvalue._2.local)[0]) !== undefined
    ) {
      // If this is a usertype ascription (`let _x: &T = _y`) then pierce through it as either we want
      // to suggest `&mut` on the expression (handled here) or we return `None` and let the caller
      // suggest `&mut` on the type if the expression seems fine (e.g. `let _x: &T = &mut _y`).
      const user_ty_projs = body.local_decls[lhs.local]!.user_ty;
      let rhs_stmt_new;
      let rhs_str_new_r;
      if (
        user_ty_projs !== undefined &&
        user_ty_projs.contents.length === 1 &&
        user_ty_projs.contents[0]!.projs.length === 0 &&
        (rhs_stmt_new = body.stmt_at(assign)).$ === "Left" &&
        rhs_stmt_new._0.kind.$ === "Assign" &&
        (rhs_str_new_r = tcx.sess.source_map().span_to_snippet(rhs_stmt_new._0.source_info.span)).$ === "Ok"
      ) {
        const rvalue_new = rhs_stmt_new._0.kind._0[1];
        const rhs_span_new = rhs_stmt_new._0.source_info.span;
        [rvalue, rhs_span, rhs_str] = [rvalue_new, rhs_span_new, rhs_str_new_r._0];
      }

      const call = body.stmt_at(assign);
      let fk;
      let trait_: DefId | undefined;
      if (
        call.$ === "Right" &&
        call._0.kind.$ === "Call" &&
        call._0.kind.func.$ === "Constant" &&
        (fk = call._0.kind.func._0.ty().kind()).$ === "FnDef" &&
        (trait_ = tcx.trait_of_assoc(fk._0)) !== undefined &&
        tcx.is_lang_item(trait_, LangItem.Index)
      ) {
        const args = call._0.kind.args;
        const method_args = fk._1;
        const trait_ref = TraitRef.from_assoc(
          as_interner(tcx),
          tcx.require_lang_item(LangItem.IndexMut, rhs_span),
          unwrap(Binder.no_bound_vars(method_args, fold_GenericArgs)),
        );
        // The type only implements `Index` but not `IndexMut`, we must not suggest `&mut`.
        if (!EvaluationResult.must_apply_considering_regions(infcx.type_implements_trait(trait_ref.def_id, trait_ref.args, infcx.param_env))) {
          // Suggest `get_mut` if type is a `BTreeMap` or `HashMap`.
          const sk = TraitRef.self_ty(trait_ref).kind();
          let map_r;
          let key_r;
          if (
            sk.$ === "Adt" &&
            [sym.BTreeMap, sym.HashMap].some((s) => tcx.is_diagnostic_item(s, sk._0.did())) &&
            args.length === 2 &&
            (map_r = tcx.sess.source_map().span_to_snippet(args[0]!.span)).$ === "Ok" &&
            (key_r = tcx.sess.source_map().span_to_snippet(args[1]!.span)).$ === "Ok"
          ) {
            const span = rhs_span;
            const suggestion = `${map_r._0.toString()}.get_mut(${key_r._0.toString()}).unwrap()`;
            return { $: "MapGetMut", span, suggestion };
          }
          return undefined;
        }
      }
    }

    let sugg: [Span, string] | undefined;
    let ref_idx: number | undefined;
    let const_idx: number | undefined;
    if (rvalue.$ === "Ref" && rvalue._1.$ === "Shared" && (ref_idx = rhs_str.find("&")) !== undefined) {
      // Shrink the span to just after the `&` in `&variable`.
      sugg = [Span.shrink_to_lo(Span.with_lo(rhs_span, BytePos(Span.lo(rhs_span) + ref_idx + 1))), "mut "];
    } else if (rvalue.$ === "RawPtr" && rvalue._0 === "Const" && (const_idx = rhs_str.find("const")) !== undefined) {
      // Suggest changing `&raw const` to `&raw mut` if applicable.
      sugg = [
        Span.with_hi(Span.with_lo(rhs_span, BytePos(Span.lo(rhs_span) + const_idx)), BytePos(Span.lo(rhs_span) + const_idx + utf8_len("const"))),
        "mut",
      ];
    } else {
      sugg = undefined;
    }

    if (sugg !== undefined) {
      const [span, suggestion] = sugg;
      return { $: "Expr", span, suggestion };
    }
  }

  return AmpMutSugg.ChangeBinding;
}

/// If the type is a `Coroutine`, `Closure`, or `CoroutineClosure`
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:1999 is_closure_like
function is_closure_like(ty: Ty): boolean {
  return ty.is_closure() || ty.is_coroutine() || ty.is_coroutine_closure();
}

/// Given a field that needs to be mutable, returns a span where the " mut " could go.
/// This function expects the local to be a reference to a struct in order to produce a span.
///
/// ```text
/// LL |     s: &'a   String
///    |           ^^^ returns a span taking up the space here
/// ```
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:2010 get_mut_span_in_struct_field
function get_mut_span_in_struct_field(tcx: TyCtxt, ty: Ty, field: FieldIdx): Span | undefined {
  // Expect our local to be a reference to a struct of some kind.
  const k = ty.kind();
  if (k.$ === "Ref") {
    const k2 = k._1.kind();
    if (k2.$ === "Adt") {
      const def = k2._0;
      const field_ = [...def.all_fields()][field];
      if (field_ === undefined) return undefined;
      // Now we're dealing with the actual struct that we're going to suggest a change to,
      // we can expect a field that is an immutable reference to a type.
      const local_did = field_.did.as_local();
      if (local_did === undefined) return undefined;
      const node = tcx.hir_node_by_def_id(local_did);
      if (node.$ === "Field" && node._0.ty.kind.$ === "Ref" && node._0.ty.kind._2 === "Not") {
        const lt = node._0.ty.kind._0;
        const ty_ = node._0.ty.kind._1;
        return Span.between(lt.ident.span, ty_.span);
      }
    }
  }

  return undefined;
}

/// If possible, suggest replacing `ref` with `ref mut`.
// rustc: compiler/rustc_borrowck/src/diagnostics/mutability_errors.rs:2031 suggest_ref_mut
function suggest_ref_mut(tcx: TyCtxt, span: Span): Span | undefined {
  const r = tcx.sess.source_map().span_to_snippet(span);
  if (r.$ !== "Ok") return undefined;
  const pattern_str = r._0;
  let c;
  if (pattern_str.starts_with("ref") && (c = pattern_str.slice(3).chars().next()) !== undefined && lexer_is_whitespace(c)) {
    const span_ = Span.shrink_to_lo(Span.with_lo(span, BytePos(Span.lo(span) + 4)));
    return span_;
  } else {
    return undefined;
  }
}
