// Port of compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Print diagnostics to explain why values are borrowed.
// PORT: the fn-local `struct FindLetExpr` + `impl Visitor for FindLetExpr` live inside `add_explanation_to_diagnostic`;
// `result: Option<(Span, &Pat, &Expr)>` is `[Span, Pat, Expr] | undefined`.
import { Applicability, type Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../rustc_middle/hir/nested_filter.ts";
import type { ObjectLifetimeDefault } from "../../rustc_middle/middle/resolve_bound_vars.ts";
import { BasicBlock, type Body, type ConstraintCategory, type Local, type Location, type Operand, type Place } from "../../rustc_middle/mir/mod.ts";
import { PlaceRef_from_Local } from "../../rustc_middle/mir/statement.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
// PORT: rustc_session is entered through its lib.ts (config.ts is not a fresh entry point; lib.ts of this crate).
import "../../rustc_session/lib.ts";
import { Polonius } from "../../rustc_session/config.ts";
import { DesugaringKind } from "../../rustc_span/hygiene.ts";
import { Span, type SpanSnippetError } from "../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, kw, sym } from "../../rustc_span/symbol.ts";
import { FindExprBySpan } from "../../rustc_trait_selection/error_reporting/traits/mod.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { NllRegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import { assert, unwrap } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { Str } from "../../std/str.ts";
import type { BorrowData } from "../borrow_set.gen.ts";
import { MirBorrowckCtxt, type WriteKind } from "../lib.gen.ts";
import * as gen from "./explain_borrow.gen.ts";
import type { LaterUseKind } from "./explain_borrow.gen.ts";
import * as find_use from "./find_use.ts";
import { UseSpans } from "./mod.ts";
import { ConstraintDescription_ConstraintCategory } from "./region_errors.ts";
import { display_RegionName } from "./region_name.ts";
import type { RegionName } from "./region_name.gen.ts";

export * from "./explain_borrow.gen.ts";

/** PORT: `iter.next()` of a fresh iterator (`tcx.hir_parent_iter(..).next()`). */
function first<T>(it: Iterable<T>): T | undefined {
  for (const x of it) return x;
  return undefined;
}

// impl<'tcx> BorrowExplanation<'tcx>
export interface BorrowExplanation_methods {
  // explain_borrow.rs:55
  is_explained(self: BorrowExplanation): boolean;
  // explain_borrow.rs:58
  add_explanation_to_diagnostic(
    self: BorrowExplanation,
    cx: MirBorrowckCtxt,
    err: Diag,
    borrow_desc: string,
    borrow_span: Span | undefined,
    multiple_borrow_span: [Span, Span] | undefined,
  ): void;
  // explain_borrow.rs:440
  add_object_lifetime_default_note(self: BorrowExplanation, tcx: TyCtxt, err: Diag, unsize_ty: Ty): void;
  // explain_borrow.rs:497
  add_lifetime_bound_suggestion_to_diagnostic(self: BorrowExplanation, err: Diag, category: ConstraintCategory, span: Span, region_name: RegionName): void;
}
export type BorrowExplanation = gen.BorrowExplanation;
export const BorrowExplanation = gen.BorrowExplanation as typeof gen.BorrowExplanation & BorrowExplanation_methods;

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // explain_borrow.rs:588
    explain_why_borrow_contains_point(location: Location, borrow: BorrowData, kind_place: [WriteKind, Place] | undefined): BorrowExplanation;
    // explain_borrow.rs:719
    later_use_kind(borrow: BorrowData, use_spans: UseSpans, location: Location): [LaterUseKind, Span, Span | undefined];
    // explain_borrow.rs:821
    was_captured_by_trait_object(borrow: BorrowData): boolean;
  }
}

// rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:55 is_explained
BorrowExplanation.is_explained = function (self: BorrowExplanation): boolean {
  return !(self.$ === "Unexplained");
};

// rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:58 add_explanation_to_diagnostic
BorrowExplanation.add_explanation_to_diagnostic = function (
  self: BorrowExplanation,
  cx: MirBorrowckCtxt,
  err: Diag,
  borrow_desc: string,
  borrow_span: Span | undefined,
  multiple_borrow_span: [Span, Span] | undefined,
): void {
  const tcx = cx.infcx.tcx;
  const body = cx.body;

  if (borrow_span !== undefined) {
    const span = borrow_span;
    const def_id = body.source.def_id();
    let node: hir.Node | undefined;
    let body_id: hir.BodyId | undefined;
    if ((node = tcx.hir_get_if_local(def_id)) !== undefined && (body_id = hir.Node.body_id(node)) !== undefined) {
      const body = tcx.hir_body(body_id);
      const expr_finder = FindExprBySpan.new(span, tcx);
      expr_finder.visit_expr(body.value);
      if (expr_finder.result !== undefined) {
        let expr = expr_finder.result;
        for (;;) {
          const k = expr.kind;
          if (k.$ === "AddrOf") expr = k._2;
          else if (k.$ === "Unary" && k._0 === "Deref") expr = k._1;
          else if (k.$ === "Field") expr = k._0;
          else if (k.$ === "MethodCall") expr = k._1;
          else if (k.$ === "Index") expr = k._0;
          else break;
        }
        const ek = expr.kind;
        let n: hir.Node;
        if (
          ek.$ === "Path" &&
          ek._0.$ === "Resolved" &&
          ek._0._0 === undefined &&
          ek._0._1.segments.length === 1 &&
          ek._0._1.segments[0]!.args === undefined &&
          ek._0._1.res.$ === "Local" &&
          (n = tcx.hir_node(ek._0._1.res._0)).$ === "Pat"
        ) {
          const ident = ek._0._1.segments[0]!.ident;
          const pat = n._0;
          if (!Span.in_external_macro(ident.span, tcx.sess.source_map())) {
            err.span_label(pat.span, `binding \`${display_Ident(ident)}\` declared here`);
          }
        }
      }
    }
  }
  switch (self.$) {
    case "UsedLater": {
      const [dropped_local, later_use_kind, var_or_use_span, path_span] = [self._0, self._1, self._2, self._3];
      let message: string;
      switch (later_use_kind) {
        case "TraitCapture":
          message = "captured here by trait object";
          break;
        case "ClosureCapture":
          message = "captured here by closure";
          break;
        case "Call":
          message = "used by call";
          break;
        case "FakeLetRead":
          message = "stored here";
          break;
        case "Other":
          message = "used here";
          break;
      }
      const local_decl = body.local_decls[dropped_local]!;

      const li = local_decl.local_info_();
      let parent: [HirId, hir.Node] | undefined;
      let if_expr: hir.Expr | undefined;
      let let_expr: hir.LetExpr | undefined;
      let pat_snippet: Result<Str, SpanSnippetError> | undefined;
      if (
        li.$ === "IfThenRescopeTemp" &&
        (parent = first(tcx.hir_parent_iter(li.if_then))) !== undefined &&
        parent[1].$ === "Expr" &&
        (if_expr = parent[1]._0).kind.$ === "If" &&
        if_expr.kind._0.kind.$ === "Let" &&
        (let_expr = if_expr.kind._0.kind._0).ty === undefined &&
        Span.can_be_used_for_suggestions(let_expr.pat.span) &&
        (pat_snippet = tcx.sess.source_map().span_to_snippet(let_expr.pat.span)).$ === "Ok"
      ) {
        const [, conseq, alt] = [if_expr.kind._0, if_expr.kind._1, if_expr.kind._2];
        suggest_rewrite_if_let(tcx, if_expr, pat_snippet._0.toString(), let_expr.init, conseq, alt, err);
      } else if (path_span === undefined || path_span === var_or_use_span) {
        // We can use `var_or_use_span` if either `path_span` is not present, or both
        // spans are the same.
        if (borrow_span === undefined || !Span.overlaps(borrow_span, var_or_use_span)) {
          err.span_label(var_or_use_span, `${borrow_desc}borrow later ${message}`);
        }
      } else {
        // path_span must be `Some` as otherwise the if condition is true
        const path_span_ = unwrap(path_span);
        // path_span is only present in the case of closure capture
        assert(later_use_kind === "ClosureCapture", "assertion `left matches right` failed\n  left: " + later_use_kind + "\n right: LaterUseKind::ClosureCapture");
        if (!(borrow_span !== undefined && Span.overlaps(borrow_span, var_or_use_span))) {
          const path_label = "used here by closure";
          const capture_kind_label = message;
          err.span_label(var_or_use_span, `${borrow_desc}borrow later ${capture_kind_label}`);
          err.span_label(path_span_, path_label);
        }
      }
      break;
    }
    case "UsedLaterInLoop": {
      const [later_use_kind, var_or_use_span, path_span] = [self._0, self._1, self._2];
      let message: string;
      switch (later_use_kind) {
        case "TraitCapture":
          message = "borrow captured here by trait object, in later iteration of loop";
          break;
        case "ClosureCapture":
          message = "borrow captured here by closure, in later iteration of loop";
          break;
        case "Call":
          message = "borrow used by call, in later iteration of loop";
          break;
        case "FakeLetRead":
          message = "borrow later stored here";
          break;
        case "Other":
          message = "borrow used here, in later iteration of loop";
          break;
      }
      // We can use `var_or_use_span` if either `path_span` is not present, or both spans
      // are the same.
      if (path_span !== undefined ? path_span === var_or_use_span : true) {
        err.span_label(var_or_use_span, `${borrow_desc}${message}`);
      } else {
        // path_span must be `Some` as otherwise the if condition is true
        const path_span_ = unwrap(path_span);
        // path_span is only present in the case of closure capture
        assert(later_use_kind === "ClosureCapture", "assertion `left matches right` failed\n  left: " + later_use_kind + "\n right: LaterUseKind::ClosureCapture");
        if (borrow_span !== undefined ? !Span.overlaps(borrow_span, var_or_use_span) : true) {
          const path_label = "used here by closure";
          const capture_kind_label = message;
          err.span_label(var_or_use_span, `${borrow_desc}borrow later ${capture_kind_label}`);
          err.span_label(path_span_, path_label);
        }
      }
      break;
    }
    case "UsedLaterWhenDropped": {
      const { drop_loc, dropped_local, should_note_order } = self;
      const local_decl = body.local_decls[dropped_local]!;
      let ty = local_decl.ty;
      if (Span.desugaring_kind(local_decl.source_info.span)?.$ === "ForLoop") {
        const k = local_decl.ty.kind();
        if (k.$ === "Adt") {
          const [adt, args] = [k._0, k._1];
          if (tcx.is_diagnostic_item(sym.Option, adt.did())) {
            // in for loop desugaring, only look at the `Some(..)` inner type
            ty = args.type_at(0);
          }
        }
      }
      let dtor_desc: string;
      let type_desc: string;
      const tk = ty.kind();
      if (tk.$ === "Adt" && tk._0.has_dtor(tcx) && !tk._0.is_box()) {
        // If type is an ADT that implements Drop, then
        // simplify output by reporting just the ADT name.
        [dtor_desc, type_desc] = ["`Drop` code", `type \`${tcx.def_path_str(tk._0.did())}\``];
      }

      // Otherwise, just report the whole type (and use
      // the intentionally fuzzy phrase "destructor")
      else if (tk.$ === "Closure") {
        [dtor_desc, type_desc] = ["destructor", "closure"];
      } else if (tk.$ === "Coroutine") {
        [dtor_desc, type_desc] = ["destructor", "coroutine"];
      } else {
        [dtor_desc, type_desc] = ["destructor", `type \`${display_Ty(local_decl.ty)}\``];
      }

      const local_name = cx.local_name(dropped_local);
      if (local_name !== undefined && !local_decl.from_compiler_desugaring()) {
        const message = `${borrow_desc}borrow might be used here, when \`${display_Symbol(local_name)}\` is dropped and runs the ${dtor_desc} for ${type_desc}`;
        err.span_label(body.source_info(drop_loc).span, message);

        if (should_note_order) {
          err.note("values in a scope are dropped in the opposite order they are defined");
        }
      } else {
        err.span_label(local_decl.source_info.span, `a temporary with access to the ${borrow_desc}borrow is created here ...`);
        const message = `... and the ${borrow_desc}borrow might be used here, when that temporary is dropped and runs the ${dtor_desc} for ${type_desc}`;
        err.span_label(body.source_info(drop_loc).span, message);

        // struct FindLetExpr<'hir> (fn-local)
        class FindLetExpr extends hir.intravisit.Visitor {
          // impl<'hir> rustc_hir::intravisit::Visitor<'hir> for FindLetExpr<'hir>
          // type NestedFilter = rustc_middle::hir::nested_filter::OnlyBodies;
          override NestedFilter = OnlyBodies;

          constructor(
            public span: Span,
            public result: [Span, hir.Pat, hir.Expr] | undefined,
            public tcx: TyCtxt,
          ) {
            super();
          }

          // rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:254 maybe_tcx
          override maybe_tcx(): HirTyCtxt {
            return TyCtxt_as_HirTyCtxt(this.tcx);
          }

          // rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:257 visit_expr
          override visit_expr(expr: hir.Expr): undefined {
            const k = expr.kind;
            let cond: hir.Expr | undefined;
            if (k.$ === "If") {
              cond = k._0;
            } else if (k.$ === "Loop" && k._0.expr !== undefined && k._0.expr.kind.$ === "If" && k._2 === "While") {
              cond = k._0.expr.kind._0;
            }
            if (cond !== undefined && cond.kind.$ === "Let" && Span.contains(cond.kind._0.init.span, this.span)) {
              const { init: let_expr_init, span: let_expr_span, pat: let_expr_pat } = cond.kind._0;
              this.result = [let_expr_span, let_expr_pat, let_expr_init];
            } else {
              hir.intravisit.walk_expr(this, expr);
            }
            return undefined;
          }
        }

        const li = local_decl.local_info_();
        let n: hir.Node;
        let if_expr: hir.Expr | undefined;
        let let_expr: hir.LetExpr | undefined;
        let pat_snippet: Result<Str, SpanSnippetError> | undefined;
        let node: hir.Node | undefined;
        let body_id: hir.BodyId | undefined;
        let found: [Span, hir.Pat, hir.Expr] | undefined;
        if (
          li.$ === "IfThenRescopeTemp" &&
          (n = tcx.hir_node(li.if_then)).$ === "Expr" &&
          (if_expr = n._0).kind.$ === "If" &&
          if_expr.kind._0.kind.$ === "Let" &&
          // FIXME(#101728): enable rewrite when type ascription is
          // stabilized again.
          (let_expr = if_expr.kind._0.kind._0).ty === undefined &&
          Span.can_be_used_for_suggestions(let_expr.pat.span) &&
          (pat_snippet = tcx.sess.source_map().span_to_snippet(let_expr.pat.span)).$ === "Ok"
        ) {
          suggest_rewrite_if_let(tcx, if_expr, pat_snippet._0.toString(), let_expr.init, if_expr.kind._1, if_expr.kind._2, err);
        } else if (
          multiple_borrow_span !== undefined &&
          (node = tcx.hir_get_if_local(body.source.def_id())) !== undefined &&
          (body_id = hir.Node.body_id(node)) !== undefined &&
          (found = ((body_id: hir.BodyId) => {
            const [old] = multiple_borrow_span;
            const hir_body = tcx.hir_body(body_id);
            const expr_finder = new FindLetExpr(old, undefined, tcx);
            expr_finder.visit_expr(hir_body.value);
            return expr_finder.result;
          })(body_id)) !== undefined &&
          !Span.contains(found[0], multiple_borrow_span[1])
        ) {
          const [let_expr_span, let_expr_pat, let_expr_init] = found;
          // #133941: The `old` expression is at the conditional part of an
          // if/while let expression. Adding a semicolon won't work.
          // Instead, try suggesting the `matches!` macro or a temporary.
          if (let_expr_pat.walk_short((pat) => !(pat.kind.$ === "Binding"))) {
            let pat_snippet: Result<Str, SpanSnippetError>;
            let init_snippet: Result<Str, SpanSnippetError>;
            if (
              (pat_snippet = tcx.sess.source_map().span_to_snippet(let_expr_pat.span)).$ === "Ok" &&
              (init_snippet = tcx.sess.source_map().span_to_snippet(let_expr_init.span)).$ === "Ok"
            ) {
              err.span_suggestion_verbose(
                let_expr_span,
                "consider using the `matches!` macro",
                `matches!(${init_snippet._0.toString()}, ${pat_snippet._0.toString()})`,
                Applicability.MaybeIncorrect,
              );
            } else {
              err.note("consider using the `matches!` macro");
            }
          }
        } else if (li.$ === "BlockTailTemp") {
          const info = li._0;
          const sp = Span.find_ancestor_not_from_macro(info.span) ?? info.span;
          if (info.tail_result_is_ignored) {
            // #85581: If the first mutable borrow's scope contains
            // the second borrow, this suggestion isn't helpful.
            if (!(multiple_borrow_span !== undefined && Span.contains(Span.to(multiple_borrow_span[0], Span.shrink_to_hi(info.span)), multiple_borrow_span[1]))) {
              err.span_suggestion_verbose(
                Span.shrink_to_hi(sp),
                "consider adding semicolon after the expression so its temporaries are dropped sooner, before the local variables declared by the block are dropped",
                ";",
                Applicability.MaybeIncorrect,
              );
            }
          } else {
            err.note(
              "the temporary is part of an expression at the end of a block;\nconsider forcing this temporary to be dropped sooner, before the block's local variables are dropped",
            );
            err.multipart_suggestion(
              "for example, you could save the expression's value in a new local variable `x` and then make `x` be the expression at the end of the block",
              [
                [Span.shrink_to_lo(sp), "let x = "],
                [Span.shrink_to_hi(sp), "; x"],
              ],
              Applicability.MaybeIncorrect,
            );
          }
        }
      }
      break;
    }
    case "MustBeValidFor": {
      const { best_blame, region_name, opt_place_desc } = self;
      const { category, span } = best_blame.constraint();
      const path = best_blame.path_();

      region_name.highlight_region_name(err);

      if (opt_place_desc !== undefined) {
        const desc = opt_place_desc;
        err.span_label(
          span,
          `${ConstraintDescription_ConstraintCategory.description(category)}requires that \`${desc}\` is borrowed for \`${display_RegionName(region_name)}\``,
        );
      } else {
        err.span_label(
          span,
          `${ConstraintDescription_ConstraintCategory.description(category)}requires that ${borrow_desc}borrow lasts for \`${display_RegionName(region_name)}\``,
        );
      }

      cx.add_placeholder_from_predicate_note(err, path);
      cx.add_sized_or_copy_bound_info(err, category, path);

      if (category.$ === "Cast" && category.is_implicit_coercion === true && category.unsize_to !== undefined) {
        const unsize_ty = category.unsize_to;
        BorrowExplanation.add_object_lifetime_default_note(self, tcx, err, unsize_ty);
      }

      const preds: Span[] = [];
      for (const constraint of path) {
        const c = constraint.category;
        if (c.$ === "Predicate" && !Span.is_dummy(c._0)) preds.push(c._0);
      }
      // `sort_by_key(|span| span.lo_hi())` (stable), then `dedup_by_key(|span| span.lo_hi())`
      const lo_hi_cmp = (a: Span, b: Span): number => {
        const [al, ah] = Span.lo_hi(a);
        const [bl, bh] = Span.lo_hi(b);
        return al !== bl ? al - bl : ah - bh;
      };
      preds.sort(lo_hi_cmp);
      const deduped: Span[] = [];
      for (const p of preds) {
        if (deduped.length === 0 || lo_hi_cmp(deduped[deduped.length - 1]!, p) !== 0) deduped.push(p);
      }
      if (deduped.length !== 0) {
        const s = deduped.length === 1 ? "" : "s";
        err.span_note(deduped, `requirement${s} that the value outlives \`${display_RegionName(region_name)}\` introduced here`);
      }

      BorrowExplanation.add_lifetime_bound_suggestion_to_diagnostic(self, err, category, span, region_name);
      break;
    }
    default:
      break;
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:440 add_object_lifetime_default_note
BorrowExplanation.add_object_lifetime_default_note = function (self: BorrowExplanation, tcx: TyCtxt, err: Diag, unsize_ty: Ty): void {
  const k = unsize_ty.kind();
  if (k.$ === "Adt") {
    const [def, args] = [k._0, k._1];
    // We try to elaborate the object lifetime defaults and present those to the user. This
    // should make it clear where the region constraint is coming from.
    const generics = tcx.generics_of(def.did()) as Generics;

    let has_dyn = false;
    let failed = false;

    const elaborated_args: GenericArg[] = [];
    const n = Math.min(args.length, generics.own_params.length);
    for (let i = 0; i < n; i++) {
      const arg = args[i]!;
      const param = generics.own_params[i]!;
      const arg_ty = GenericArg.as_type(arg);
      const ak = arg_ty?.kind();
      if (ak !== undefined && ak.$ === "Dynamic") {
        const obj = ak._0;
        // PORT: the query's value type is not declared in queries.gen.ts (`unknown`); its provider
        // (rustc_hir_analysis resolve_bound_vars.ts) returns `ObjectLifetimeDefault`.
        const default_ = tcx.object_lifetime_default(param.def_id) as ObjectLifetimeDefault;

        const re_static = tcx.lifetimes.re_static;

        let implied_region: Region;
        switch (default_.$) {
          // This is not entirely precise.
          case "Empty":
            implied_region = re_static;
            break;
          case "Ambiguous":
            failed = true;
            implied_region = re_static;
            break;
          case "Param": {
            const index = unwrap(generics.param_def_id_to_index.get(default_._0));
            const a = args[index];
            const r = a !== undefined ? GenericArg.as_region(a) : undefined;
            if (r !== undefined) {
              implied_region = r;
            } else {
              failed = true;
              implied_region = re_static;
            }
            break;
          }
          case "Static":
            implied_region = re_static;
            break;
        }

        has_dyn = true;

        elaborated_args.push(Ty.new_dynamic(tcx, obj, implied_region));
      } else {
        elaborated_args.push(arg);
      }
    }
    const elaborated_ty = Ty.new_adt(tcx, def, tcx.mk_args_from_iter(elaborated_args));

    if (has_dyn && !failed) {
      err.note(`due to object lifetime defaults, \`${display_Ty(unsize_ty)}\` actually means \`${display_Ty(elaborated_ty)}\``);
    }
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:497 add_lifetime_bound_suggestion_to_diagnostic
BorrowExplanation.add_lifetime_bound_suggestion_to_diagnostic = function (
  self: BorrowExplanation,
  err: Diag,
  category: ConstraintCategory,
  span: Span,
  region_name: RegionName,
): void {
  if (!Span.is_desugaring(span, DesugaringKind.OpaqueTy)) {
    return;
  }
  if (category.$ === "OpaqueType") {
    const suggestable_name = region_name.was_named() ? region_name.name : kw.UnderscoreLifetime;

    const msg = `you can add a bound to the ${ConstraintDescription_ConstraintCategory.description(category)}to make it last less than \`'static\` and match \`${display_RegionName(region_name)}\``;

    err.span_suggestion_verbose(Span.shrink_to_hi(span), msg, ` + ${display_Symbol(suggestable_name)}`, Applicability.Unspecified);
  }
};

// rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:526 suggest_rewrite_if_let
export function suggest_rewrite_if_let(
  tcx: TyCtxt,
  expr: hir.Expr,
  pat: string,
  init: hir.Expr,
  conseq: hir.Expr,
  alt: hir.Expr | undefined,
  err: Diag,
): void {
  const source_map = tcx.sess.source_map();
  err.span_note(
    source_map.end_point(conseq.span),
    "lifetimes for temporaries generated in `if let`s have been shortened in Edition 2024 so that they are dropped here instead",
  );
  if (Span.can_be_used_for_suggestions(expr.span) && Span.can_be_used_for_suggestions(conseq.span)) {
    let needs_block: boolean;
    const parent = alt !== undefined ? first(tcx.hir_parent_iter(alt.hir_id)) : undefined;
    const node = parent !== undefined ? parent[1] : undefined;
    if (node !== undefined && node.$ === "Expr") {
      const expr = node._0;
      needs_block = expr.kind.$ === "If";
    } else {
      needs_block = false;
    }
    const sugg: [Span, string][] = [
      [Span.between(Span.shrink_to_lo(expr.span), init.span), needs_block ? "{ match " : "match "],
      [Span.shrink_to_lo(conseq.span), ` { ${pat} => `],
    ];
    const expr_end = Span.shrink_to_hi(expr.span);
    let expr_end_code: string;
    if (alt !== undefined) {
      sugg.push([Span.between(conseq.span, alt.span), " _ => "]);
      expr_end_code = "}";
    } else {
      expr_end_code = " _ => {} }";
    }
    expr_end_code += "}";
    sugg.push([expr_end, expr_end_code]);
    err.multipart_suggestion("consider rewriting the `if` into `match` which preserves the extended lifetime", sugg, Applicability.MaybeIncorrect);
  }
}

/// Returns structured explanation for *why* the borrow contains the
/// point from `location`. This is key for the "3-point errors"
/// [described in the NLL RFC][d].
///
/// # Parameters
///
/// - `borrow`: the borrow in question
/// - `location`: where the borrow occurs
/// - `kind_place`: if Some, this describes the statement that triggered the error.
///   - first half is the kind of write, if any, being performed
///   - second half is the place being accessed
///
/// [d]: https://rust-lang.github.io/rfcs/2094-nll.html#leveraging-intuition-framing-errors-in-terms-of-points
// rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:588 explain_why_borrow_contains_point
MirBorrowckCtxt.prototype.explain_why_borrow_contains_point = function (
  this: MirBorrowckCtxt,
  location: Location,
  borrow: BorrowData,
  kind_place: [WriteKind, Place] | undefined,
): BorrowExplanation {
  const regioncx = this.regioncx;
  const body: Body = this.body;
  const tcx = this.infcx.tcx;

  const borrow_region_vid = borrow.region;
  // debug!(?borrow_region_vid);

  let region_sub = this.regioncx.find_sub_region_live_at(borrow_region_vid, location);
  // debug!(?region_sub);

  let use_location = location;
  let use_in_later_iteration_of_loop = false;

  if (region_sub === borrow_region_vid) {
    // When `region_sub` is the same as `borrow_region_vid` (the location where the borrow
    // is issued is the same location that invalidates the reference), this is likely a
    // loop iteration. In this case, try using the loop terminator location in
    // `find_sub_region_live_at`.
    const loop_terminator_location = regioncx.find_loop_terminator_location(borrow.region, body);
    if (loop_terminator_location !== undefined) {
      region_sub = this.regioncx.find_sub_region_live_at(borrow_region_vid, loop_terminator_location);
      // debug!("explain_why_borrow_contains_point: region_sub in loop={:?}", region_sub);
      use_location = loop_terminator_location;
      use_in_later_iteration_of_loop = true;
    }
  }

  // NLL doesn't consider boring locals for liveness, and wouldn't encounter a
  // `Cause::LiveVar` for such a local. Polonius can't avoid computing liveness for boring
  // locals yet, and will encounter them when trying to explain why a borrow contains a given
  // point.
  //
  // We want to focus on relevant live locals in diagnostics, so when polonius is enabled, we
  // ensure that we don't emit live boring locals as explanations.
  const is_local_boring = (local: Local): boolean => {
    const polonius_context = this.polonius_context;
    if (polonius_context !== undefined) {
      return polonius_context.boring_nll_locals.has(local);
    } else {
      assert(!Polonius.is_next_enabled(tcx.sess.opts.unstable_opts.polonius), "assertion failed: !tcx.sess.opts.unstable_opts.polonius.is_next_enabled()");

      // Boring locals are never the cause of a borrow explanation in NLLs.
      return false;
    }
  };
  const cause = find_use.find(body, regioncx, tcx, region_sub, use_location);
  if (cause !== undefined && cause.$ === "LiveVar" && !is_local_boring(cause._0)) {
    const [local, location] = [cause._0, cause._1];
    const span = body.source_info(location).span;
    const spans = UseSpans.or_else(this.move_spans(PlaceRef_from_Local(local), location), () => this.borrow_spans(span, location));

    if (use_in_later_iteration_of_loop) {
      const [later_use_kind, var_or_use_span, path_span] = this.later_use_kind(borrow, spans, use_location);
      return { $: "UsedLaterInLoop", _0: later_use_kind, _1: var_or_use_span, _2: path_span };
    } else {
      // Check if the location represents a `FakeRead`, and adapt the error
      // message to the `FakeReadCause` it is from: in particular,
      // the ones inserted in optimized `let var = <expr>` patterns.
      const [later_use_kind, var_or_use_span, path_span] = this.later_use_kind(borrow, spans, location);
      return { $: "UsedLater", _0: borrow.borrowed_place.local, _1: later_use_kind, _2: var_or_use_span, _3: path_span };
    }
  } else if (cause !== undefined && cause.$ === "DropVar" && !is_local_boring(cause._0)) {
    const [local, location] = [cause._0, cause._1];
    let should_note_order = false;
    let borrowed_local: Local | undefined;
    if (
      this.local_name(local) !== undefined &&
      kind_place !== undefined &&
      kind_place[0].$ === "StorageDeadOrDrop" &&
      (borrowed_local = kind_place[1].as_local()) !== undefined &&
      this.local_name(borrowed_local) !== undefined &&
      local !== borrowed_local
    ) {
      should_note_order = true;
    }

    return {
      $: "UsedLaterWhenDropped",
      drop_loc: location,
      dropped_local: local,
      should_note_order,
    };
  } else {
    // Here, under NLL: no cause was found. Under polonius: no cause was found, or a
    // boring local was found, which we ignore like NLLs do to match its diagnostics.
    const region = this.regioncx.to_error_region_vid(borrow_region_vid);
    if (region !== undefined) {
      const best_blame = this.regioncx.best_blame_constraint(borrow_region_vid, NllRegionVariableOrigin.FreeRegion, region);

      const region_name = this.give_region_a_name(region);
      if (region_name !== undefined) {
        const opt_place_desc = this.describe_place(borrow.borrowed_place.as_ref());
        return {
          $: "MustBeValidFor",
          best_blame,
          region_name,
          opt_place_desc,
        };
      } else {
        // debug!("Could not generate a region name");
        return BorrowExplanation.Unexplained;
      }
    } else {
      // debug!("Could not generate an error region vid");
      return BorrowExplanation.Unexplained;
    }
  }
};

/// Determine how the borrow was later used.
/// First span returned points to the location of the conflicting use
/// Second span if `Some` is returned in the case of closures and points
/// to the use of the path
// rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:719 later_use_kind
MirBorrowckCtxt.prototype.later_use_kind = function (
  this: MirBorrowckCtxt,
  borrow: BorrowData,
  use_spans: UseSpans,
  location: Location,
): [LaterUseKind, Span, Span | undefined] {
  // PORT: `match func { .. }` of the two `TerminatorKind::Call` arms (identical upstream code, inlined twice there).
  const function_span_of = (func: Operand, span: Span): Span => {
    switch (func.$) {
      case "RuntimeChecks":
        return span;
      case "Constant":
        return func._0.span;
      case "Copy":
      case "Move": {
        const place = func._0;
        const l = place.as_local();
        if (l !== undefined) {
          const local_decl = this.body.local_decls[l]!;
          if (this.local_name(l) === undefined) {
            return local_decl.source_info.span;
          } else {
            return span;
          }
        } else {
          return span;
        }
      }
    }
  };
  if (use_spans.$ === "ClosureUse") {
    const { capture_kind_span, path_span } = use_spans;
    // Used in a closure.
    return ["ClosureCapture", capture_kind_span, path_span];
  }
  // In the case that the borrowed value (probably a temporary)
  // overlaps with the method's receiver, then point at the method.
  if (
    use_spans.$ === "FnSelfUse" &&
    use_spans.kind.$ === "Normal" &&
    use_spans.kind.desugaring === undefined &&
    Span.overlaps(use_spans.var_span, this.body.local_decls[borrow.assigned_place.local]!.source_info.span)
  ) {
    const span = use_spans.var_span;
    const tk = this.body.basic_blocks.deref()[location.block]!.terminator_().kind;
    if (tk.$ === "Call" && tk.call_source === "Normal") {
      // Just point to the function, to reduce the chance of overlapping spans.
      const function_span = function_span_of(tk.func, span);
      return ["Call", function_span, undefined];
    } else {
      return ["Other", span, undefined];
    }
  }
  const span = use_spans.$ === "FnSelfUse" ? use_spans.var_span : use_spans._0;
  const block = this.body.basic_blocks.deref()[location.block]!;

  let kind: LaterUseKind;
  const stmt = block.statements[location.statement_index];
  if (stmt !== undefined && stmt.kind.$ === "FakeRead" && stmt.kind._0[0].$ === "ForLet") {
    const place = stmt.kind._0[1];
    const l = place.as_local();
    if (l !== undefined && this.body.local_decls[l]!.ty.is_closure()) {
      kind = "ClosureCapture";
    } else {
      kind = "FakeLetRead";
    }
  } else if (this.was_captured_by_trait_object(borrow)) {
    kind = "TraitCapture";
  } else if (location.statement_index === block.statements.length) {
    const tk = block.terminator_().kind;
    if (tk.$ === "Call" && tk.call_source === "Normal") {
      // Just point to the function, to reduce the chance of overlapping spans.
      const function_span = function_span_of(tk.func, span);
      return ["Call", function_span, undefined];
    } else {
      kind = "Other";
    }
  } else {
    kind = "Other";
  }

  return [kind, span, undefined];
};

/// Checks if a borrowed value was captured by a trait object. We do this by
/// looking forward in the MIR from the reserve location and checking if we see
/// an unsized cast to a trait object on our data.
// rustc: compiler/rustc_borrowck/src/diagnostics/explain_borrow.rs:821 was_captured_by_trait_object
MirBorrowckCtxt.prototype.was_captured_by_trait_object = function (this: MirBorrowckCtxt, borrow: BorrowData): boolean {
  // Start at the reserve location, find the place that we want to see cast to a trait object.
  const location = borrow.reserve_location;
  const block = this.body.index(location.block);
  const stmt = block.statements[location.statement_index];
  // debug!("was_captured_by_trait_object: location={:?} stmt={:?}", location, stmt);

  // We make a `queue` vector that has the locations we want to visit. As of writing, this
  // will only ever have one item at any given time, but by using a vector, we can pop from
  // it which simplifies the termination logic.
  const queue: Location[] = [location];
  if (!(stmt !== undefined && stmt.kind.$ === "Assign")) {
    return false;
  }
  const place = stmt.kind._0[0];
  const target_ = place.as_local();
  if (target_ === undefined) return false;
  let target = target_;

  // debug!("was_captured_by_trait: target={:?} queue={:?}", target, queue);
  let current_location: Location | undefined;
  while ((current_location = queue.pop()) !== undefined) {
    // debug!("was_captured_by_trait: target={:?}", target);
    const block = this.body.index(current_location.block);
    // We need to check the current location to find out if it is a terminator.
    const is_terminator = current_location.statement_index === block.statements.length;
    if (!is_terminator) {
      const stmt = block.statements[current_location.statement_index]!;
      // debug!("was_captured_by_trait_object: stmt={:?}", stmt);

      // The only kind of statement that we care about is assignments...
      if (stmt.kind.$ === "Assign") {
        const [place, rvalue] = stmt.kind._0;
        const into = place.local_or_deref_local();
        if (into === undefined) {
          // Continue at the next location.
          queue.push(current_location.successor_within_block());
          continue;
        }

        switch (rvalue.$) {
          // If we see a use, we should check whether it is our data, and if so
          // update the place that we're looking for to that new place.
          case "Use": {
            const operand = rvalue._0;
            if (operand.$ === "Copy" || operand.$ === "Move") {
              const from = operand._0.as_local();
              if (from !== undefined) {
                if (from === target) {
                  target = into;
                }
              }
            }
            break;
          }
          // If we see an unsized cast, then if it is our data we should check
          // whether it is being cast to a trait object.
          case "Cast": {
            if (rvalue._0.$ === "PointerCoercion" && rvalue._0._0.$ === "Unsize") {
              const [operand, ty] = [rvalue._1, rvalue._2];
              if (operand.$ === "Copy" || operand.$ === "Move") {
                const from = operand._0.as_local();
                if (from !== undefined) {
                  if (from === target) {
                    // debug!("was_captured_by_trait_object: ty={:?}", ty);
                    // Check the type for a trait object.
                    const k = ty.kind();
                    // `&dyn Trait`
                    if (k.$ === "Ref" && k._1.is_trait()) return true;
                    // `Box<dyn Trait>`
                    const boxed = ty.boxed_ty();
                    if (boxed !== undefined && boxed.is_trait()) return true;
                    // `dyn Trait`
                    if (ty.is_trait()) return true;
                    // Anything else.
                    return false;
                  }
                }
                return false;
              } else {
                return false;
              }
            }
            break;
          }
          default:
            break;
        }
      }

      // Continue at the next location.
      queue.push(current_location.successor_within_block());
    } else {
      // The only thing we need to do for terminators is progress to the next block.
      const terminator = block.terminator_();
      // debug!("was_captured_by_trait_object: terminator={:?}", terminator);

      const tk = terminator.kind;
      let dest: Local | undefined;
      if (tk.$ === "Call" && tk.target !== undefined && (dest = tk.destination.as_local()) !== undefined) {
        const block = tk.target;
        // debug!("was_captured_by_trait_object: target={:?} dest={:?} args={:?}", target, dest, args);
        // Check if one of the arguments to this function is the target place.
        const found_target = tk.args.some((arg) => {
          if (arg.node.$ === "Move") {
            const potential = arg.node._0.as_local();
            if (potential !== undefined) {
              return potential === target;
            } else {
              return false;
            }
          } else {
            return false;
          }
        });

        // If it is, follow this to the next block and update the target.
        if (found_target) {
          target = dest;
          queue.push(BasicBlock.start_location(block));
        }
      }
    }

    // debug!("was_captured_by_trait: queue={:?}", queue);
  }

  // We didn't find anything and ran out of locations to check.
  return false;
};
