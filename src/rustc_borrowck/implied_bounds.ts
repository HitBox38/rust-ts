// Port of compiler/rustc_borrowck/src/implied_bounds.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `mir_borrowck_implied_outlives_bounds` is the query provider (lib.ts's `provide` installs it); `&'tcx Canonical<..>`
// is the value (`tcx.arena.alloc(x)` is `x`). `SmallVec<[GenericArg; 8]>` is `GenericArg[]`; `mut is_external_region:
// impl FnMut(ty::Region) -> bool` is a callback.
import type { Canonical, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import type { MirBorrowckImpliedOutlivesBounds } from "../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { GenericArg, Region, Ty } from "../rustc_middle/ty/decls.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/// Computes the implied bounds for `body_def_id`. This is a separate query
/// as it must not reveal the hidden type of opaques defined by `body_def_id`
/// for typeck roots.
///
/// However, nested bodies are checked in the scope of their parent. This means
/// we should actually normalize opaques when computing their implied bounds.
// stub: compiler/rustc_borrowck/src/implied_bounds.rs:27 mir_borrowck_implied_outlives_bounds (lane bck-tc-b)
export function mir_borrowck_implied_outlives_bounds(
  tcx: TyCtxt,
  body_def_id: LocalDefId,
): Result<Canonical<QueryResponse<MirBorrowckImpliedOutlivesBounds>>, NoSolution> {
  return unported("rustc_borrowck::implied_bounds::mir_borrowck_implied_outlives_bounds");
}

/// This computes the `var_values` used by the `mir_borrowck_implied_outlives_bounds` query.
/// The old solver canonicalization does not replace early and late bound parameters,
/// so the only `var_values` we need are external regions from the signature of the nested
/// body as we don't have a shared representation between this query and MIR borrowck.
///
/// These are not all external regions of the nested body, only the external regions
/// which may get accessed by this query. We only need to add things to the `var_values`
/// which can be referenced by both this query and MIR borrowck. MIR borrowck currently
/// creates external regions for late-bound regions of parent items as these can be
/// explicitly mentioned in user types. We do not encounter these in this query, as all
/// free regions in the signature of nested bodies get replaced with `'erased` at the end
/// of HIR typeck, so we don't care about them.
// stub: compiler/rustc_borrowck/src/implied_bounds.rs:152 implied_bounds_query_var_values (lane bck-tc-b)
export function implied_bounds_query_var_values(
  tcx: TyCtxt,
  unnormalized_inputs_and_output: readonly Ty[],
  is_external_region: (a0: Region) => boolean,
): GenericArg[] {
  return unported("rustc_borrowck::implied_bounds::implied_bounds_query_var_values");
}

/// This replaces all external regions in the signature of the current item with
/// a unique placeholder to collect its implied bounds. This mirrors the way MIR
/// borrowck replaces all of them with unique NLL vars.
// stub: compiler/rustc_borrowck/src/implied_bounds.rs:173 replace_erased_regions_with_placeholders (lane bck-tc-b)
function replace_erased_regions_with_placeholders(tcx: TyCtxt, inputs_and_output: readonly Ty[]): Ty[] {
  return unported("rustc_borrowck::implied_bounds::replace_erased_regions_with_placeholders");
}
