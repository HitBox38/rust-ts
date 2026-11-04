// Port of compiler/rustc_monomorphize/src/mono_checks/move_check.rs (lane mono-collector).
//
// PORT: `MoveCheckVisitor` `extends Visitor` (rustc_middle/mir/visit.ts), as rustc_mir_transform's visitors do.
import type { Size } from "../../rustc_abi/lib.ts";
import { LARGE_ASSIGNMENTS } from "../../rustc_lint_defs/builtin.ts";
import { type Body, type Location, Operand, SourceScope, type Terminator } from "../../rustc_middle/mir/mod.ts";
import { mono_reachable } from "../../rustc_middle/mir/traversal.ts";
import { Visitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span, Spanned } from "../../rustc_span/lib.ts";
import { Span as SpanC } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import type { Limit } from "../../rustc_structures/lib.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { LargeAssignmentsLint_diagnostic } from "../diagnostics.ts";

// rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:22 check_moves
export function check_moves(tcx: TyCtxt, instance: Instance, body: Body): void {
  const visitor = new MoveCheckVisitor(tcx, instance, body, []);
  for (const [bb, data] of mono_reachable(body, tcx, instance)) {
    visitor.visit_basic_block_data(bb, data);
  }
}

// rustc-type: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:14 MoveCheckVisitor
class MoveCheckVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public instance: Instance,
    public body: Body,
    /// Spans for move size lints already emitted. Helps avoid duplicate lints.
    public move_size_spans: Span[],
  ) {
    super();
  }

  // rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:34 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    const kind = terminator.kind;
    switch (kind.$) {
      case "Call":
      case "TailCall": {
        const callee_ty = Operand.ty(kind.func, this.body, this.tcx);
        const callee_ty_ = this.monomorphize(callee_ty);
        this.check_fn_args_move_size(callee_ty_, kind.args, kind.fn_span, location);
        break;
      }
      default:
        break;
    }

    // We deliberately do *not* visit the nested operands here, to avoid
    // hitting `visit_operand` for function arguments.
  }

  // rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:49 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    this.check_operand_move_size(operand, location);
  }

  // PORT: upstream's generic `monomorphize<T>` is only used on `Ty` in this file.
  // rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:55 monomorphize
  monomorphize(value: Ty): Ty {
    // trace!("monomorphize: self.instance={:?}", self.instance);
    return Instance.instantiate_mir_and_normalize_erasing_regions(
      this.instance,
      this.tcx,
      TypingEnv.fully_monomorphized(),
      EarlyBinder.bind(this.tcx, value, fold_Ty),
      fold_Ty,
    );
  }

  // rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:67 check_operand_move_size
  check_operand_move_size(operand: Operand, location: Location): void {
    const limit = this.tcx.move_size_limit();
    if (limit._0 === 0) {
      return;
    }

    const source_info = this.body.source_info(location);
    // debug!(?source_info);

    const too_large_size = this.operand_size_if_too_large(limit, operand);
    if (too_large_size !== undefined) {
      this.lint_large_assignment(limit._0, too_large_size, location, source_info.span);
    }
  }

  // rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:81 check_fn_args_move_size
  check_fn_args_move_size(callee_ty: Ty, args: readonly Spanned<Operand>[], fn_span: Span, location: Location): void {
    const limit = this.tcx.move_size_limit();
    if (limit._0 === 0) {
      return;
    }

    if (args.length === 0) {
      return;
    }

    // Allow large moves into container types that themselves are cheap to move
    const callee_kind = callee_ty.kind();
    if (callee_kind.$ !== "FnDef") {
      return;
    }
    const def_id = callee_kind._0;
    if (should_skip_fn(this.tcx, def_id)) {
      return;
    }

    // debug!(?def_id, ?fn_span);
    void fn_span;

    for (const arg of args) {
      // Moving args into functions is typically implemented with pointer
      // passing at the llvm-ir level and not by memcpy's. So always allow
      // moving args into functions.
      const operand: Operand = arg.node;
      if (operand.$ === "Move") {
        continue;
      }

      const too_large_size = this.operand_size_if_too_large(limit, operand);
      if (too_large_size !== undefined) {
        this.lint_large_assignment(limit._0, too_large_size, location, arg.span);
      }
    }
  }

  // rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:122 operand_size_if_too_large
  operand_size_if_too_large(limit: Limit, operand: Operand): Size | undefined {
    const ty = Operand.ty(operand, this.body, this.tcx);
    const ty_ = this.monomorphize(ty);
    const layout = this.tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty_));
    if (layout.$ !== "Ok") {
      return undefined;
    }
    if (layout._0.size.bytes_usize() > limit._0) {
      // debug!(?layout);
      return layout._0.size;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:142 lint_large_assignment
  lint_large_assignment(limit: number, too_large_size: Size, location: Location, span: Span): void {
    const source_info = this.body.source_info(location);

    const lint_root = SourceScope.lint_root(source_info.scope, this.body.source_scopes);
    if (lint_root === undefined) {
      // This happens when the issue is in a function from a foreign crate that
      // we monomorphized in the current crate. We can't get a `HirId` for things
      // in other crates.
      // FIXME: Find out where to report the lint on. Maybe simply crate-level lint root
      // but correct span? This would make the lint at least accept crate-level lint attributes.
      return;
    }

    // If the source scope is inlined by the MIR inliner, report the lint on the call site.
    const inlined = this.body.source_scopes[source_info.scope]?.inlined;
    const reported_span = inlined !== undefined ? inlined[1] : span;

    for (const previously_reported_span of this.move_size_spans) {
      if (SpanC.overlaps(previously_reported_span, reported_span)) {
        return;
      }
    }

    this.tcx.emit_node_span_lint(
      LARGE_ASSIGNMENTS,
      lint_root,
      reported_span,
      LargeAssignmentsLint_diagnostic({
        span: reported_span,
        size: too_large_size.bytes(),
        limit,
      }),
    );

    this.move_size_spans.push(reported_span);
  }
}

/// Return `true` if `def_id` is `Box::new`, `Rc::new` or `Arc::new`.
// rustc: compiler/rustc_monomorphize/src/mono_checks/move_check.rs:192 should_skip_fn
function should_skip_fn(tcx: TyCtxt, def_id: DefId): boolean {
  if (tcx.def_kind(def_id).$ === "AssocFn" && tcx.item_name(def_id) === sym.new) {
    const parent = tcx.parent(def_id);
    const parent_kind = tcx.def_kind(parent);
    if (parent_kind.$ === "Impl" && !parent_kind.of_trait) {
      const ty = Unnormalized.skip_normalization(EarlyBinder.instantiate_identity(tcx.type_of(parent)));
      const ty_kind = ty.kind();
      if (ty_kind.$ === "Adt") {
        const did = ty_kind._0.did();
        const same = (other: DefId | undefined): boolean => other !== undefined && other.krate === did.krate && other.index === did.index;
        return same(tcx.lang_items().owned_box()) || same(tcx.get_diagnostic_item(sym.Rc)) || same(tcx.get_diagnostic_item(sym.Arc));
      }
    }
  }
  return false;
}
