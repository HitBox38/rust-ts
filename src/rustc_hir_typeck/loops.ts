// Port of compiler/rustc_hir_typeck/src/loops.rs (lane typeck-lib-wb).
//
// `Context`, `BlockInfo` and `BreakContextKind` are generated (loops.gen.ts); `CheckLoopVisitor` is a hand class
// (types.sets.json `hand`) extending rustc_hir intravisit's `Visitor`.
// - `use Context::*` -> the variants are written as object literals / `Context.X` singletons.
// - `BTreeMap<OrdSpan, BlockInfo>` -> `SortedMap<OrdSpan, BlockInfo>` ordered by `OrdSpan::cmp` (iteration in key order).
// - `find_attr!(self.tcx, hir_id, Pat(_))` -> `find_attr(HasAttrs_HirId.get_attrs(hir_id, tcx), ..) !== undefined`.
// Init order: top-level code here touches only this file's .gen.ts and other crates.
export * from "./loops.gen.ts";
import type { Label } from "../rustc_ast/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import * as hir from "../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../rustc_hir/intravisit.ts";
import { type HirId, HirId_eq } from "../rustc_hir_id/lib.ts";
import { TyCtxt_as_HirTyCtxt } from "../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_HirId } from "../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { BytePos, OrdSpan, Span } from "../rustc_span/lib.ts";
import { display_Ident } from "../rustc_span/symbol.ts";
import { utf8_len } from "../std/str.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert } from "../std/panic.ts";
import { span_bug } from "../rustc_span/macros.ts";
import {
  BreakInsideClosure_diagnostic,
  BreakInsideCoroutine_diagnostic,
  ConstContinueBadLabel_diagnostic,
  ContinueLabeledBlock_diagnostic,
  OutsideLoop_diagnostic,
  UnlabeledCfInWhileCondition_diagnostic,
  UnlabeledInLabeledBlock_diagnostic,
} from "./diagnostics.gen.ts";
import { BreakNonLoop_diagnostic } from "./diagnostics.ts";
import { type BlockInfo, BreakContextKind, Context } from "./loops.gen.ts";

// impl fmt::Display for BreakContextKind
// rustc: compiler/rustc_hir_typeck/src/loops.rs:66 fmt
export function display_BreakContextKind(self_: BreakContextKind): string {
  switch (self_) {
    case "Break":
      return "break";
    case "Continue":
      return "continue";
  }
}

// rustc-type: compiler/rustc_hir_typeck/src/loops.rs:76 CheckLoopVisitor
// PORT: hand class (types.sets.json `hand`); `#[derive(Clone)]` is unused here.
export class CheckLoopVisitor extends hir.intravisit.Visitor {
  // impl<'hir> Visitor<'hir> for CheckLoopVisitor<'hir>
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    // Keep track of a stack of contexts, so that suggestions
    // are not made for contexts where it would be incorrect,
    // such as adding a label for an `if`.
    // e.g. `if 'foo: {}` would be incorrect.
    public cx_stack: Context[],
    public block_breaks: SortedMap<OrdSpan, BlockInfo>,
  ) {
    super();
  }

  // rustc: compiler/rustc_hir_typeck/src/loops.rs:100 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_hir_typeck/src/loops.rs:104 visit_anon_const
  override visit_anon_const(_: hir.AnonConst): undefined {
    // Typecked on its own.
    return undefined;
  }

  // rustc: compiler/rustc_hir_typeck/src/loops.rs:108 visit_inline_const
  override visit_inline_const(c: hir.ConstBlock): undefined {
    this.with_context(Context.ConstBlock, (v) => hir.intravisit.walk_inline_const(v, c));
    return undefined;
  }

  // rustc: compiler/rustc_hir_typeck/src/loops.rs:112 visit_expr
  override visit_expr(e: hir.Expr): undefined {
    const kind = e.kind;
    switch (kind.$) {
      case "If": {
        const cond = kind._0;
        const then = kind._1;
        const else_opt = kind._2;
        this.visit_expr(cond);

        const get_block = (ck_loop: CheckLoopVisitor, expr: hir.Expr): hir.Block | undefined => {
          if (expr.kind.$ === "Block" && expr.kind._1 === undefined) {
            const b = expr.kind._0;
            const last = ck_loop.cx_stack[ck_loop.cx_stack.length - 1];
            if (
              last !== undefined &&
              (last.$ === "Normal" || last.$ === "AnonConst" || last.$ === "UnlabeledBlock" || last.$ === "UnlabeledIfBlock")
            ) {
              return b;
            }
          }
          return undefined;
        };

        const b = get_block(this, then);
        if (b !== undefined) {
          this.with_context({ $: "UnlabeledIfBlock", _0: Span.shrink_to_lo(b.span) }, (v) => {
            v.visit_block(b);
          });
        } else {
          this.visit_expr(then);
        }

        if (else_opt !== undefined) {
          const else_expr = else_opt;
          const b = get_block(this, else_expr);
          if (b !== undefined) {
            this.with_context({ $: "UnlabeledIfBlock", _0: Span.shrink_to_lo(b.span) }, (v) => {
              v.visit_block(b);
            });
          } else {
            this.visit_expr(else_expr);
          }
        }
        break;
      }
      case "Loop": {
        const b = kind._0;
        const source = kind._2;
        const labeled_block = this.is_loop_match(e, b);
        const cx: Context = labeled_block !== undefined ? { $: "LoopMatch", labeled_block } : { $: "Loop", _0: source };

        this.with_context(cx, (v) => {
          v.visit_block(b);
        });
        break;
      }
      case "Closure": {
        const { fn_decl, body, fn_decl_span, kind: closure_kind } = kind._0;
        let cx: Context;
        if (closure_kind.$ === "Coroutine" && closure_kind._0.$ === "Desugared") {
          const ckind = closure_kind._0._0;
          const source = closure_kind._0._1;
          cx = { $: "Coroutine", coroutine_span: fn_decl_span, kind: ckind, source };
        } else {
          cx = { $: "Closure", _0: fn_decl_span };
        }
        this.visit_fn_decl(fn_decl);
        this.with_context(cx, (v) => {
          v.visit_nested_body(body);
        });
        break;
      }
      case "Block": {
        const b = kind._0;
        const last = this.cx_stack[this.cx_stack.length - 1];
        if (kind._1 !== undefined) {
          this.with_context(Context.LabeledBlock, (v) => {
            v.visit_block(b);
          });
        } else if (last !== undefined && (last.$ === "Fn" || last.$ === "ConstBlock")) {
          this.with_context(Context.Normal, (v) => {
            v.visit_block(b);
          });
        } else if (
          b.rules.$ === "DefaultBlock" &&
          last !== undefined &&
          (last.$ === "Normal" || last.$ === "AnonConst" || last.$ === "UnlabeledBlock")
        ) {
          // An unlabeled block targeted by `break` may comes from a `try` block.
          // Since `try 'block: {}` is invalid, nest a labeled block inside its body.
          const wrap_end = b.targeted_by_break ? Span.shrink_to_hi(b.span) : undefined;
          this.with_context({ $: "UnlabeledBlock", label_span: Span.shrink_to_lo(b.span), wrap_end }, (v) => {
            v.visit_block(b);
          });
        } else {
          hir.intravisit.walk_expr(this, e);
        }
        break;
      }
      case "Break": {
        const break_destination = kind._0;
        const opt_expr = kind._1;
        if (opt_expr !== undefined) {
          this.visit_expr(opt_expr);
        }

        if (this.require_label_in_labeled_block(e.span, break_destination, "break")) {
          // If we emitted an error about an unlabeled break in a labeled
          // block, we don't need any further checking for this break any more
          return undefined;
        }

        let loop_id: HirId | undefined;
        const target_id = break_destination.target_id;
        if (target_id.$ === "Ok") {
          loop_id = target_id._0;
        } else if (target_id._0 === "OutsideLoopScope") {
          loop_id = undefined;
        } else if (target_id._0 === "UnlabeledCfInWhileCondition") {
          this.tcx.dcx().emit_err(UnlabeledCfInWhileCondition_diagnostic({ span: e.span, cf_type: "break" }));
          loop_id = undefined;
        } else {
          // Err(hir::LoopIdError::UnresolvedLabel)
          loop_id = undefined;
        }

        // A `#[const_continue]` must break to a block in a `#[loop_match]`.
        if (find_attr(HasAttrs_HirId.get_attrs(e.hir_id, this.tcx), (k) => (k.$ === "ConstContinue" ? null : undefined)) !== undefined) {
          const label = break_destination.label;
          if (label === undefined) {
            const span = e.span;
            return this.tcx.dcx().emit_fatal(ConstContinueBadLabel_diagnostic({ span }));
          }

          const is_target_label = (cx: Context): boolean => {
            switch (cx.$) {
              case "LoopMatch": {
                const labeled_block = cx.labeled_block;
                // NOTE: with macro expansion, the label's span might be different here
                // even though it does still refer to the same HIR node. A block
                // can't have two labels, so the hir_id is a unique identifier.
                assert(labeled_block.target_id.$ === "Ok", "assertion failed: labeled_block.target_id.is_ok()"); // see `is_loop_match`.
                return target_id_eq(break_destination.target_id, labeled_block.target_id);
              }
              default:
                return false;
            }
          };

          if (!this.cx_stack.slice().reverse().some(is_target_label)) {
            const span = label.ident.span;
            this.tcx.dcx().emit_fatal(ConstContinueBadLabel_diagnostic({ span }));
          }
        }

        if (loop_id !== undefined && this.tcx.hir_node(loop_id).$ === "Block") {
          return undefined;
        }

        if (opt_expr !== undefined) {
          const break_expr = opt_expr;
          let head: Span | undefined;
          let loop_label: Label | undefined;
          let loop_kind: hir.LoopSource | undefined;
          if (loop_id !== undefined) {
            const r = this.tcx.hir_expect_expr(loop_id).kind;
            if (r.$ === "Loop") {
              [head, loop_label, loop_kind] = [r._3, r._1, r._2];
            } else {
              span_bug(e.span, `break label resolved to a non-loop: ${hir.debug_ExprKind(r, PLAIN)}`);
            }
          } else {
            [head, loop_label, loop_kind] = [undefined, undefined, undefined];
          }
          if (loop_kind === undefined || loop_kind === "Loop") {
            // ()
          } else {
            const kind = loop_kind;
            const suggestion = `break${break_destination.label === undefined ? "" : ` ${display_Ident(break_destination.label.ident)}`}`;
            this.tcx.dcx().emit_err(
              BreakNonLoop_diagnostic({
                span: e.span,
                head,
                kind: hir.LoopSource.name(kind),
                suggestion,
                loop_label,
                break_label: break_destination.label,
                break_expr_kind: break_expr.kind,
                break_expr_span: break_expr.span,
              }),
            );
          }
        }

        let sp_lo: Span;
        const snippet_r = this.tcx.sess.source_map().span_to_snippet(e.span);
        const break_pos = snippet_r.$ === "Ok" ? snippet_r._0.find("break") : undefined;
        if (break_pos !== undefined) {
          sp_lo = Span.with_lo(e.span, BytePos(Span.lo(e.span) + (break_pos + utf8_len("break"))));
        } else {
          sp_lo = Span.with_lo(e.span, BytePos(Span.lo(e.span) + utf8_len("break")));
        }
        const label_sp =
          break_destination.label !== undefined
            ? Span.with_hi(sp_lo, Span.hi(break_destination.label.ident.span))
            : Span.shrink_to_lo(sp_lo);
        this.require_break_cx(BreakContextKind.Break, e.span, label_sp, this.cx_stack.length - 1);
        break;
      }
      case "Continue": {
        const destination = kind._0;
        this.require_label_in_labeled_block(e.span, destination, "continue");

        const target_id = destination.target_id;
        if (target_id.$ === "Ok") {
          const loop_id = target_id._0;
          const node = this.tcx.hir_node(loop_id);
          if (node.$ === "Block") {
            const block = node._0;
            this.tcx.dcx().emit_err(ContinueLabeledBlock_diagnostic({ span: e.span, block_span: block.span }));
          }
        } else if (target_id._0 === "UnlabeledCfInWhileCondition") {
          this.tcx.dcx().emit_err(UnlabeledCfInWhileCondition_diagnostic({ span: e.span, cf_type: "continue" }));
        } else {
          // Err(_) => {}
        }
        this.require_break_cx(BreakContextKind.Continue, e.span, e.span, this.cx_stack.length - 1);
        break;
      }
      default:
        hir.intravisit.walk_expr(this, e);
    }
    return undefined;
  }

  // ---- impl<'hir> CheckLoopVisitor<'hir> ----

  // rustc: compiler/rustc_hir_typeck/src/loops.rs:334 with_context
  with_context(cx: Context, f: (_1: CheckLoopVisitor) => void): void {
    this.cx_stack.push(cx);
    f(this);
    this.cx_stack.pop();
  }

  // rustc: compiler/rustc_hir_typeck/src/loops.rs:343 require_break_cx
  require_break_cx(br_cx_kind: BreakContextKind, span: Span, break_span: Span, cx_pos: number): void {
    const cx = this.cx_stack[cx_pos]!;
    switch (cx.$) {
      case "LabeledBlock":
      case "Loop":
      case "LoopMatch":
        return;
      case "Closure": {
        const closure_span = cx._0;
        this.tcx.dcx().emit_err(BreakInsideClosure_diagnostic({ span, closure_span, name: display_BreakContextKind(br_cx_kind) }));
        return;
      }
      case "Coroutine": {
        const { coroutine_span } = cx;
        let kind: string;
        switch (cx.kind) {
          case "Async":
            kind = "async";
            break;
          case "Gen":
            kind = "gen";
            break;
          case "AsyncGen":
            kind = "async gen";
            break;
        }
        let source: string;
        switch (cx.source) {
          case "Block":
            source = "block";
            break;
          case "Closure":
            source = "closure";
            break;
          case "Fn":
            source = "function";
            break;
        }
        this.tcx.dcx().emit_err(
          BreakInsideCoroutine_diagnostic({ span, coroutine_span, name: display_BreakContextKind(br_cx_kind), kind, source }),
        );
        return;
      }
      default:
        break;
    }
    if (cx.$ === "UnlabeledBlock" && br_cx_kind === BreakContextKind.Break && Span.eq_ctxt(cx.label_span, break_span)) {
      const { label_span, wrap_end } = cx;
      const key = new OrdSpan(label_span);
      let block = this.block_breaks.get(key);
      if (block === undefined) {
        block = { name: display_BreakContextKind(br_cx_kind), spans: [], suggs: [], wrap_end };
        this.block_breaks.insert(key, block);
      }
      block.spans.push(span);
      block.suggs.push(break_span);
      return;
    }
    if (cx.$ === "UnlabeledIfBlock" && br_cx_kind === BreakContextKind.Break) {
      this.require_break_cx(br_cx_kind, span, break_span, cx_pos - 1);
      return;
    }
    // Normal | AnonConst | Fn | UnlabeledBlock { .. } | UnlabeledIfBlock(_) | ConstBlock
    this.tcx.dcx().emit_err(
      OutsideLoop_diagnostic({
        spans: [span],
        name: display_BreakContextKind(br_cx_kind),
        is_break: br_cx_kind === BreakContextKind.Break,
        suggestion: undefined,
      }),
    );
  }

  // rustc: compiler/rustc_hir_typeck/src/loops.rs:405 require_label_in_labeled_block
  require_label_in_labeled_block(span: Span, label: hir.Destination, cf_type: string): boolean {
    const last = this.cx_stack[this.cx_stack.length - 1];
    if (!Span.is_desugaring(span, DesugaringKind.QuestionMark) && last !== undefined && last.$ === "LabeledBlock" && label.label === undefined) {
      this.tcx.dcx().emit_err(UnlabeledInLabeledBlock_diagnostic({ span, cf_type }));
      return true;
    }
    return false;
  }

  // rustc: compiler/rustc_hir_typeck/src/loops.rs:421 report_outside_loop_error
  report_outside_loop_error(): void {
    for (const [s, block] of this.block_breaks.iter()) {
      this.tcx.dcx().emit_err(
        OutsideLoop_diagnostic({
          spans: block.spans.slice(),
          name: block.name,
          is_break: true,
          suggestion: {
            block_span: s._0,
            break_spans: block.suggs.slice(),
            block_prefix: block.wrap_end !== undefined ? "{ 'block: " : "'block: ",
            wrap_end: block.wrap_end,
          },
        }),
      );
    }
  }

  /// Is this a loop annotated with `#[loop_match]` that looks syntactically sound?
  // rustc: compiler/rustc_hir_typeck/src/loops.rs:438 is_loop_match
  is_loop_match(e: hir.Expr, body: hir.Block): hir.Destination | undefined {
    if (find_attr(HasAttrs_HirId.get_attrs(e.hir_id, this.tcx), (k) => (k.$ === "LoopMatch" ? null : undefined)) === undefined) {
      return undefined;
    }

    // NOTE: Diagnostics are emitted during MIR construction.

    // Accept either `state = expr` or `state = expr;`.
    let loop_body_expr: hir.Expr;
    if (body.stmts.length === 0) {
      if (body.expr === undefined) return undefined;
      loop_body_expr = body.expr;
    } else if (body.stmts.length === 1 && body.expr === undefined) {
      const single = body.stmts[0]!;
      if (single.kind.$ === "Expr" || single.kind.$ === "Semi") {
        loop_body_expr = single.kind._0;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }

    if (loop_body_expr.kind.$ !== "Assign") return undefined;
    const rhs_expr = loop_body_expr.kind._1;

    if (rhs_expr.kind.$ !== "Block") return undefined;
    const block = rhs_expr.kind._0;
    const label = rhs_expr.kind._1;

    return { label, target_id: { $: "Ok", _0: block.hir_id } };
  }
}

/** `Result<HirId, LoopIdError>`'s derived `PartialEq`. */
function target_id_eq(a: hir.Destination["target_id"], b: hir.Destination["target_id"]): boolean {
  if (a.$ === "Ok" && b.$ === "Ok") return HirId_eq(a._0, b._0);
  if (a.$ === "Err" && b.$ === "Err") return a._0 === b._0;
  return false;
}

// rustc: compiler/rustc_hir_typeck/src/loops.rs:86 check
export function check(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void {
  const check = new CheckLoopVisitor(tcx, [Context.Normal], SortedMap.default<OrdSpan, BlockInfo>((a, b) => a.cmp(b)));
  const cx = tcx.def_kind(def_id).$ === "AnonConst" ? Context.AnonConst : Context.Fn;
  check.with_context(cx, (v) => {
    v.visit_body(body);
  });
  check.report_outside_loop_error();
}
