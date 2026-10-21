// compiler/rustc_lint/src/if_let_rescope.rs. The lint static and the `impl_lint_pass!` expansion are generated
// (if_let_rescope.lints.gen.ts, `IfLetRescope_impl_lint_pass`); the `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]`
// types `IfLetRescopeLint` / `DestructorLabel` are generated into if_let_rescope.gen.ts (tools/codegen set
// `rustc_lint`); the pass, its helpers and the other (sub)diagnostic types are here.
import { ControlFlow, VisitorResult } from "../rustc_ast_ir/visit.ts";
import { type Diag, msg, type Subdiagnostic } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { HirId_eq, HirIdSet } from "../rustc_hir_id/lib.ts";
import { Visitor, walk_expr } from "../rustc_hir/intravisit.ts";
import { type LintPass, type LintVec, LintId } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Edition } from "../rustc_span/edition.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { is_whitespace } from "../std/char.ts";
import { unported } from "../std/panic.ts";
import type { LateContext } from "./context.ts";
import { type DestructorLabel, IfLetRescopeLint_diagnostic } from "./if_let_rescope.gen.ts";
import { IF_LET_RESCOPE, IfLetRescope_impl_lint_pass } from "./if_let_rescope.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./if_let_rescope.gen.ts";
export * from "./if_let_rescope.lints.gen.ts";

// rustc: compiler/rustc_lint/src/if_let_rescope.rs:97 expr_parent_is_else
function expr_parent_is_else(tcx: TyCtxt, hir_id: hir.HirId): boolean {
  const next = tcx.hir_parent_iter(hir_id)[Symbol.iterator]().next();
  if (next.done === true || next.value[1].$ !== "Expr") {
    return false;
  }
  const expr = next.value[1]._0;
  if (expr.kind.$ !== "If" || expr.kind._2 === undefined) return false;
  const alt = expr.kind._2;
  return HirId_eq(alt.hir_id, hir_id);
}

// rustc: compiler/rustc_lint/src/if_let_rescope.rs:105 expr_parent_is_stmt
function expr_parent_is_stmt(tcx: TyCtxt, hir_id: hir.HirId): boolean {
  const parents = tcx.hir_parent_iter(hir_id)[Symbol.iterator]();
  const next = parents.next();
  let stmt: hir.Stmt;
  if (next.done !== true && next.value[1].$ === "Stmt") {
    stmt = next.value[1]._0;
  } else if (next.done !== true && (next.value[1].$ === "Block" || next.value[1].$ === "Arm")) {
    return true;
  } else {
    return false;
  }
  if (stmt.kind.$ !== "Semi" && stmt.kind.$ !== "Expr") return false;
  const expr = stmt.kind._0;
  return HirId_eq(expr.hir_id, hir_id);
}

// rustc: compiler/rustc_lint/src/if_let_rescope.rs:116 match_head_needs_bracket
function match_head_needs_bracket(tcx: TyCtxt, expr: hir.Expr): boolean {
  return expr_parent_is_else(tcx, expr.hir_id) && expr.kind.$ === "If";
}

/// Lint for potential change in program semantics of `if let`s
// #[derive(Default)]
export class IfLetRescope implements LintPass, LateLintPass {
  constructor(public skip: HirIdSet) {}

  /** `#[derive(Default)]` */
  static default(): IfLetRescope {
    return new IfLetRescope(new HirIdSet());
  }

  // impl_lint_pass!(IfLetRescope => [IF_LET_RESCOPE]) (if_let_rescope.lints.gen.ts)
  name(): string {
    return IfLetRescope_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return IfLetRescope_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return IfLetRescope_impl_lint_pass.lint_vec();
  }

  // rustc: compiler/rustc_lint/src/if_let_rescope.rs:121 probe_if_cascade
  probe_if_cascade(cx: LateContext, expr_: hir.Expr): void {
    let expr = expr_;
    if (this.skip.has(expr.hir_id)) {
      return;
    }
    const tcx = cx.tcx;
    const source_map = tcx.sess.source_map();
    let expr_end: Span;
    if (expr.kind.$ === "If" && expr.kind._2 === undefined) {
      const conseq = expr.kind._1;
      expr_end = Span.shrink_to_hi(conseq.span);
    } else if (expr.kind.$ === "If" && expr.kind._2 !== undefined) {
      const alt = expr.kind._2;
      expr_end = Span.shrink_to_hi(alt.span);
    } else {
      return;
    }
    let seen_dyn = false;
    let add_bracket_to_match_head = match_head_needs_bracket(tcx, expr);
    const significant_droppers: Span[] = [];
    const lifetime_ends: Span[] = [];
    let closing_brackets = 0;
    const alt_heads: AltHead[] = [];
    const match_heads: SingleArmMatchBegin[] = [];
    const consequent_heads: ConsequentRewrite[] = [];
    const destructors: DestructorLabel[] = [];
    let first_if_to_lint: [Span, hir.HirId] | undefined = undefined;
    let first_if_to_rewrite = false;
    let empty_alt = false;
    while (expr.kind.$ === "If") {
      const cond = expr.kind._0;
      const conseq = expr.kind._1;
      const alt = expr.kind._2;
      this.skip.add(expr.hir_id);
      // We are interested in `let` fragment of the condition.
      // Otherwise, we probe into the `else` fragment.
      if (cond.kind.$ === "Let" && cond.kind._0.recovered.$ === "No") {
        const { span, pat, init, ty: ty_ascription } = cond.kind._0;
        // Peel off round braces
        const if_let_pat = Span.between(
          source_map.span_take_while(expr.span, (ch) => ch === 0x28 /* '(' */ || is_whitespace(ch)),
          init.span,
        );
        // The consequent fragment is always a block.
        const before_conseq = Span.shrink_to_lo(conseq.span);
        const lifetime_end = source_map.end_point(conseq.span);

        const r = new FindSignificantDropper(cx).check_if_let_scrutinee(init);
        if (r.$ === "Break") {
          const [drop_span, drop_tys] = r._0;
          for (const ty of drop_tys) {
            let item: DestructorLabel | undefined;
            const span: Span | undefined = ty_dtor_span(tcx, ty);
            if (span !== undefined) {
              item = { span, dtor_kind: "concrete" };
            } else if (ty.kind().$ === "Dynamic") {
              if (seen_dyn) {
                item = undefined;
              } else {
                seen_dyn = true;
                item = { span: DUMMY_SP, dtor_kind: "dyn" };
              }
            } else {
              item = undefined;
            }
            if (item !== undefined) destructors.push(item);
          }
          first_if_to_lint = first_if_to_lint ?? [span, expr.hir_id];
          significant_droppers.push(drop_span);
          lifetime_ends.push(lifetime_end);
          let pat_snippet;
          if (
            ty_ascription !== undefined ||
            !Span.can_be_used_for_suggestions(expr.span) ||
            !Span.can_be_used_for_suggestions(pat.span) ||
            !Span.can_be_used_for_suggestions(if_let_pat) ||
            !Span.can_be_used_for_suggestions(before_conseq)
          ) {
            // Our `match` rewrites does not support type ascription,
            // so we just bail.
            // Alternatively when the span comes from proc macro expansion,
            // we will also bail.
            // FIXME(#101728): change this when type ascription syntax is stabilized again
          } else if ((pat_snippet = source_map.span_to_snippet(pat.span)).$ === "Ok") {
            const pat = pat_snippet._0.toString();
            const emit_suggestion = (alt_span: Span | undefined): void => {
              first_if_to_rewrite = true;
              if (add_bracket_to_match_head) {
                closing_brackets += 2;
                match_heads.push({ $: "WithOpenBracket", _0: if_let_pat });
              } else {
                // Sometimes, wrapping `match` into a block is undesirable,
                // because the scrutinee temporary lifetime is shortened and
                // the proposed fix will not work.
                closing_brackets += 1;
                match_heads.push({ $: "WithoutOpenBracket", _0: if_let_pat });
              }
              consequent_heads.push({ span: before_conseq, pat });
              if (alt_span !== undefined) {
                alt_heads.push(alt_span);
              }
            };
            if (alt !== undefined) {
              const alt_head = Span.between(conseq.span, alt.span);
              if (Span.can_be_used_for_suggestions(alt_head)) {
                // We lint only when the `else` span is user code, too.
                emit_suggestion(alt_head);
              }
            } else {
              // This is the end of the `if .. else ..` cascade.
              // We can stop here.
              emit_suggestion(undefined);
              empty_alt = true;
              break;
            }
          }
        }
      }
      // At this point, any `if let` fragment in the cascade is definitely preceded by `else`,
      // so a opening bracket is mandatory before each `match`.
      add_bracket_to_match_head = true;
      if (alt !== undefined) {
        expr = alt;
      } else {
        break;
      }
    }
    if (first_if_to_lint !== undefined) {
      const [span, hir_id] = first_if_to_lint;
      tcx.emit_node_span_lint(
        IF_LET_RESCOPE,
        hir_id,
        span,
        IfLetRescopeLint_diagnostic({
          destructors,
          significant_droppers,
          lifetime_ends,
          rewrite: first_if_to_rewrite
            ? {
                match_heads,
                consequent_heads,
                closing_brackets: {
                  span: expr_end,
                  count: closing_brackets,
                  empty_alt,
                },
                alt_heads,
              }
            : undefined,
        }),
      );
    }
  }

  // impl<'tcx> LateLintPass<'tcx> for IfLetRescope
  // rustc: compiler/rustc_lint/src/if_let_rescope.rs:269 check_expr
  check_expr(cx: LateContext, expr: hir.Expr): void {
    if (
      Edition.at_least_rust_2024(Span.edition(expr.span)) ||
      cx.tcx.skippable_lints(null).has(LintId.of(IF_LET_RESCOPE))
    ) {
      return;
    }

    if (expr.kind.$ === "Loop" && expr.kind._2 === "While") {
      const block = expr.kind._0;
      const value = block.expr;
      if (value !== undefined && value.kind.$ === "If") {
        const cond = value.kind._0;
        if (cond.kind.$ === "Let") {
          // Recall that `while let` is lowered into this:
          // ```
          // loop {
          //     if let .. { body } else { break; }
          // }
          // ```
          // There is no observable change in drop order on the overall `if let` expression
          // given that the `{ break; }` block is trivial so the edition change
          // means nothing substantial to this `while` statement.
          this.skip.add(value.hir_id);
          return;
        }
      }
    }
    if (expr_parent_is_stmt(cx.tcx, expr.hir_id) && expr.kind.$ === "If" && expr.kind._2 === undefined) {
      // `if let` statement without an `else` branch has no observable change
      // so we can skip linting it
      return;
    }
    this.probe_if_cascade(cx, expr);
  }
}

export interface IfLetRescopeRewrite {
  match_heads: SingleArmMatchBegin[];
  consequent_heads: ConsequentRewrite[];
  closing_brackets: ClosingBrackets;
  alt_heads: AltHead[];
}

/** `impl Subdiagnostic for IfLetRescopeRewrite` */
// rustc: compiler/rustc_lint/src/if_let_rescope.rs:327 add_to_diag
export function IfLetRescopeRewrite_add_to_diag(self: IfLetRescopeRewrite, diag: Diag): void {
  const suggestions: [Span, string][] = [];
  for (const match_head of self.match_heads) {
    switch (match_head.$) {
      case "WithOpenBracket": {
        const span = match_head._0;
        suggestions.push([span, "{ match "]);
        break;
      }
      case "WithoutOpenBracket": {
        const span = match_head._0;
        suggestions.push([span, "match "]);
        break;
      }
    }
  }
  for (const { span, pat } of self.consequent_heads) {
    suggestions.push([span, `{ ${pat} => `]);
  }
  for (const span of self.alt_heads) {
    suggestions.push([span, " _ => "]);
  }
  const closing_brackets = self.closing_brackets;
  suggestions.push([
    closing_brackets.span,
    (closing_brackets.empty_alt ? " _ => {}" : "") + "}".repeat(closing_brackets.count),
  ]);
  const msg_ = msg("a `match` with a single arm can preserve the drop order up to Edition 2021");
  diag.multipart_suggestion_with_style(msg_, suggestions, "MachineApplicable", "ShowCode");
}

/** `IfLetRescopeRewrite` as a `Subdiagnostic` trait object. */
export function IfLetRescopeRewrite_subdiagnostic(self: IfLetRescopeRewrite): Subdiagnostic {
  return { add_to_diag: (diag) => IfLetRescopeRewrite_add_to_diag(self, diag) };
}

// PORT: `struct AltHead(Span);` is its span.
export type AltHead = Span;

export interface ConsequentRewrite {
  span: Span;
  pat: string;
}

export interface ClosingBrackets {
  span: Span;
  count: number;
  empty_alt: boolean;
}
export type SingleArmMatchBegin = { readonly $: "WithOpenBracket"; _0: Span } | { readonly $: "WithoutOpenBracket"; _0: Span };

/** `rustc_middle::ty::significant_drop_order::ty_dtor_span` (not ported). */
function ty_dtor_span(_tcx: TyCtxt, _ty: Ty): Span | undefined {
  return unported("rustc_middle::ty::significant_drop_order::ty_dtor_span");
}

/** The `Break` value of `FindSignificantDropper`'s visitor: `(Span, SmallVec<[Ty<'tcx>; 4]>)`. */
type DropperBreak = [Span, Ty[]];

export class FindSignificantDropper extends Visitor<ControlFlow<DropperBreak>> {
  // type Result = ControlFlow<(Span, SmallVec<[Ty<'tcx>; 4]>)>;
  override Result = VisitorResult.ControlFlow<DropperBreak>();

  constructor(public cx: LateContext) {
    super();
  }

  /// Check the scrutinee of an `if let` to see if it promotes any temporary values
  /// that would change drop order in edition 2024. Specifically, it checks the value
  /// of the scrutinee itself, and also recurses into the expression to find any ref
  /// exprs (or autoref) which would promote temporaries that would be scoped to the
  /// end of this `if`.
  // rustc: compiler/rustc_lint/src/if_let_rescope.rs:406 check_if_let_scrutinee
  check_if_let_scrutinee(init: hir.Expr): ControlFlow<DropperBreak> {
    const r = this.check_promoted_temp_with_drop(init);
    if (r.$ === "Break") return r;
    return this.visit_expr(init);
  }

  /// Check that an expression is not a promoted temporary with a significant
  /// drop impl.
  ///
  /// An expression is a promoted temporary if it has an addr taken (i.e. `&expr` or autoref)
  /// or is the scrutinee of the `if let`, *and* the expression is not a place
  /// expr, and it has a significant drop.
  // rustc: compiler/rustc_lint/src/if_let_rescope.rs:420 check_promoted_temp_with_drop
  check_promoted_temp_with_drop(expr: hir.Expr): ControlFlow<DropperBreak> {
    if (
      expr.is_place_expr((base) => {
        const x = (this.cx.typeck_results_() as TypeckResults).adjustments().get(base.hir_id);
        return x !== undefined && x.some((adj) => adj.kind.$ === "Deref");
      })
    ) {
      return ControlFlow.CONTINUE;
    }

    const drop_tys = extract_component_with_significant_dtor(
      this.cx.tcx,
      this.cx.typing_env(),
      (this.cx.typeck_results_() as TypeckResults).expr_ty(expr),
    );
    if (drop_tys.length === 0) {
      return ControlFlow.CONTINUE;
    }

    return ControlFlow.Break<DropperBreak>([expr.span, drop_tys]);
  }

  // impl<'tcx> Visitor<'tcx> for FindSignificantDropper<'_, 'tcx>
  // rustc: compiler/rustc_lint/src/if_let_rescope.rs:450 visit_block
  override visit_block(b: hir.Block): ControlFlow<DropperBreak> {
    // Blocks introduce temporary terminating scope for all of its
    // statements, so just visit the tail expr, skipping over any
    // statements. This prevents false positives like `{ let x = &Drop; }`.
    if (b.expr !== undefined) {
      return this.visit_expr(b.expr);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_lint/src/if_let_rescope.rs:457 visit_expr
  override visit_expr(expr: hir.Expr): ControlFlow<DropperBreak> {
    // Check for promoted temporaries from autoref, e.g.
    // `if let None = TypeWithDrop.as_ref() {} else {}`
    // where `fn as_ref(&self) -> Option<...>`.
    for (const adj of (this.cx.typeck_results_() as TypeckResults).expr_adjustments(expr)) {
      // Skip when we hit the first deref expr.
      if (adj.kind.$ === "Deref") break;
      if (adj.kind.$ === "Borrow") {
        const r = this.check_promoted_temp_with_drop(expr);
        if (r.$ === "Break") return r;
      }
    }

    switch (expr.kind.$) {
      // Account for cases like `if let None = Some(&Drop) {} else {}`.
      case "AddrOf": {
        const inner = expr.kind._2;
        const r = this.check_promoted_temp_with_drop(inner);
        if (r.$ === "Break") return r;
        return walk_expr(this, inner);
      }
      // `(Drop, ()).1` introduces a temporary and then moves out of
      // part of it, therefore we should check it for temporaries.
      // FIXME: This may have false positives if we move the part
      // that actually has drop, but oh well.
      case "Index":
      case "Field": {
        const inner = expr.kind._0;
        const r = this.check_promoted_temp_with_drop(inner);
        if (r.$ === "Break") return r;
        return walk_expr(this, inner);
      }
      // If always introduces a temporary terminating scope for its cond and arms,
      // so don't visit them.
      case "If":
        return ControlFlow.CONTINUE;
      // Match introduces temporary terminating scopes for arms, so don't visit
      // them, and only visit the scrutinee to account for cases like:
      // `if let None = match &Drop { _ => Some(1) } {} else {}`.
      case "Match":
        return this.visit_expr(expr.kind._0);
      // Self explanatory.
      case "DropTemps":
        return ControlFlow.CONTINUE;
      // Otherwise, walk into the expr's parts.
      default:
        return walk_expr(this, expr);
    }
  }
}

/** `rustc_middle::ty::significant_drop_order::extract_component_with_significant_dtor` (not ported). */
function extract_component_with_significant_dtor(_tcx: TyCtxt, _typing_env: unknown, _ty: Ty): Ty[] {
  return unported("rustc_middle::ty::significant_drop_order::extract_component_with_significant_dtor");
}
