// Port of compiler/rustc_mir_transform/src/lint_and_remove_uninhabited.rs (lane mt-built-lints).
//
// PORT: `let TerminatorKind::Call { ref mut target, .. } = term.kind` writes `target` on the terminator kind object in
// place (`*target = None` is `kind.target = undefined`). `&body.basic_blocks.predecessors()[target][..] == &[bb]` is a
// length-1 check plus an element comparison.
import { UNREACHABLE_CODE } from "../rustc_lint_defs/builtin.ts";
import {
  type BasicBlock,
  type Body,
  ClearCrossCrate,
  RETURN_PLACE,
  type SourceInfo,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { Span } from "../rustc_span/lib.ts";
import { UnreachableDueToUninhabited_diagnostic } from "./diagnostics.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/// Lint unreachable code due to uninhabited values from function calls,
/// and remove return edges from those calls.
// rustc-type: compiler/rustc_mir_transform/src/lint_and_remove_uninhabited.rs:11 LintAndRemoveUninhabited
export class LintAndRemoveUninhabited extends MirPass {
  readonly type_name = "rustc_mir_transform::lint_and_remove_uninhabited::LintAndRemoveUninhabited";

  // impl<'tcx> crate::MirPass<'tcx> for LintAndRemoveUninhabited
  // #[tracing::instrument(level = "debug", skip_all)]
  // rustc: compiler/rustc_mir_transform/src/lint_and_remove_uninhabited.rs:15 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const def_id = body.source.def_id().expect_local();
    // tracing::debug!(?def_id);
    const parent_module = tcx.parent_module_from_def_id(def_id);
    const typing_env = body.typing_env(tcx);

    // check if the function's return type is inhabited
    // this was added here because of this regression
    // https://github.com/rust-lang/rust/issues/149571
    const def_kind = tcx.def_kind(def_id);
    const return_ty_is_inhabited =
      (def_kind.$ === "Fn" || def_kind.$ === "AssocFn") &&
      body.local_decls[RETURN_PLACE]!.ty.is_inhabited_from(tcx, parent_module, typing_env);

    const lints: [BasicBlock, Ty, Span][] = [];
    for (const bbdata of body.basic_blocks.as_mut()) {
      const term = bbdata.terminator_mut();
      const kind = term.kind;
      if (kind.$ !== "Call") {
        continue;
      }
      const destination = kind.destination;
      if (kind.target === undefined) continue;
      const target_bb = kind.target;

      const ty = destination.ty(body.local_decls, tcx).ty;
      const ty_is_inhabited = ty.is_inhabited_from(tcx, parent_module, typing_env);
      if (!ty_is_inhabited) {
        // Unreachable code warnings are already emitted during type checking.
        // However, during type checking, full type information is being
        // calculated but not yet available, so the check for diverging
        // expressions due to uninhabited result types is pretty crude and
        // only checks whether ty.is_never(). Here, we have full type
        // information available and can issue warnings for less obviously
        // uninhabited types (e.g. empty enums). The check above is used so
        // that we do not emit the same warning twice if the uninhabited type
        // is indeed `!`.
        if (!ty.is_never() && return_ty_is_inhabited) {
          lints.push([target_bb, ty, term.source_info.span]);
        }

        // The presence or absence of a return edge affects control-flow sensitive
        // MIR checks and ultimately whether code is accepted or not. We can only
        // omit the return edge if a return type is visibly uninhabited to a module
        // that makes the call.
        kind.target = undefined;
      }
    }

    for (const [target_bb, orig_ty, orig_span] of lints) {
      if (Span.in_external_macro(orig_span, tcx.sess.source_map())) {
        continue;
      }

      const found = find_unreachable_code_from(target_bb, body);
      if (found === undefined) {
        continue;
      }
      const [target_loc, descr] = found;
      const lint_root = ClearCrossCrate.unwrap_crate_local(
        ClearCrossCrate.as_ref(body.source_scopes[target_loc.scope]!.local_data),
      ).lint_root;
      tcx.emit_node_span_lint(
        UNREACHABLE_CODE,
        lint_root,
        target_loc.span,
        UnreachableDueToUninhabited_diagnostic({
          expr: target_loc.span,
          orig: orig_span,
          descr,
          ty: orig_ty,
        }),
      );
    }
  }

  // rustc: compiler/rustc_mir_transform/src/lint_and_remove_uninhabited.rs:86 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Removing visibly uninhabited return edges determines the control flow seen by MIR checks.
    // Cannot remove UB: removing the return edge would *introduce* UB if the call actually returned.
    return PassPolicy.Required;
  }
}

/// Starting at a target unreachable block, find some user code to lint as unreachable
// #[tracing::instrument(level = "debug", skip(body), ret)]
// rustc: compiler/rustc_mir_transform/src/lint_and_remove_uninhabited.rs:95 find_unreachable_code_from
function find_unreachable_code_from(bb: BasicBlock, body: Body): [SourceInfo, string] | undefined {
  const bbdata = body.basic_blocks.deref()[bb]!;
  for (const stmt of bbdata.statements) {
    const kind = stmt.kind;
    // Ignore the implicit `()` return place assignment for unit functions/blocks
    if (
      kind.$ === "Assign" &&
      kind._0[1].$ === "Use" &&
      kind._0[1]._0.$ === "Constant" &&
      kind._0[1]._0._0.ty().is_unit()
    ) {
      continue;
    }
    // Ignore return value plumbing. After a call returning a non-`!`
    // uninhabited type, a tail expression can be unreachable while
    // still being needed to satisfy the surrounding return type.
    if (kind.$ === "Assign" && kind._0[0].as_local() === RETURN_PLACE) {
      continue;
    }
    // Ignore statements inserted by MIR building that do not correspond to user code.
    if (kind.$ === "StorageLive" || kind.$ === "StorageDead" || kind.$ === "BackwardIncompatibleDropHint") {
      continue;
    }
    if (kind.$ === "FakeRead") return [stmt.source_info, "definition"];
    return [stmt.source_info, "expression"];
  }

  const term = bbdata.terminator_();
  switch (term.kind.$) {
    // The user does not care for `goto` and compiler-generated drops. If the target block is
    // only reachable through those terminators, continue searching there.
    case "Goto":
    case "Drop": {
      const target = term.kind.target;
      const preds = body.basic_blocks.predecessors()[target]!;
      if (preds.length === 1 && preds[0] === bb) {
        return find_unreachable_code_from(target, body);
      } else {
        return undefined;
      }
    }
    case "Return":
      return undefined;
    default:
      return [term.source_info, "expression"];
  }
}
