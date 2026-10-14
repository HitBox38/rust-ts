// Port of compiler/rustc_passes/src/delegation.rs (lane tydump-subject: the tydump/thirdump prefix calls it from
// `run_required_analyses`; see docs/handoff/tydump-subject.md).
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalExpnId } from "../rustc_span/hygiene.ts";
import type { Span } from "../rustc_span/lib.ts";
import { GlobOrListDelegationUnusedTargetExpr_diagnostic } from "./diagnostics.ts";

// rustc: compiler/rustc_passes/src/delegation.rs:6 check_glob_and_list_delegations_target_expr
export function check_glob_and_list_delegations_target_expr(tcx: TyCtxt): void {
  // PORT: `FxIndexMap<LocalExpnId, (bool, Span)>` (a JS `Map` keeps insertion order).
  const delegations_by_group_id = new Map<LocalExpnId, [boolean, Span]>();

  for (const id of tcx.resolutions(null).delegation_infos.keys()) {
    const info = tcx.hir_opt_delegation_info(id);
    if (info !== undefined && info.group_id !== undefined) {
      const [group_id, unused_target_expr] = info.group_id;
      let entry = delegations_by_group_id.get(group_id);
      if (entry === undefined) {
        entry = [true, tcx.def_span(id)];
        delegations_by_group_id.set(group_id, entry);
      }
      entry[0] &&= unused_target_expr;
    }
  }

  for (const [, [unused_target_expr, span]] of delegations_by_group_id) {
    if (unused_target_expr) {
      tcx.dcx().emit_err(GlobOrListDelegationUnusedTargetExpr_diagnostic({ span }));
    }
  }
}
