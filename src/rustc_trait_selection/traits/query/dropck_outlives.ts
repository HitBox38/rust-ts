// Port of compiler/rustc_trait_selection/src/traits/query/dropck_outlives.rs (lane old-query-typeops, wave 18b).
//
// Contract stub (lane selcx-contract): each pub fn is a signature-typed stub. Replace the body with the port and put
// `// rustc: compiler/rustc_trait_selection/src/traits/query/dropck_outlives.rs:<line> <name>` directly above it (do not
// change the signature; a wrong one goes in your handoff).
//
// PORT: `E: FromSolverError<NextSolverError> + FromSolverError<OldSolverError>` is engine.ts's `FulfillmentErrorKinds<E>`,
// carried by the `ObligationCtxt` (`ocx.d_E`); `constraints: &mut DropckConstraint` is mutated in place.
// Init order: top-level code here touches only other crates.

import type { ParamEnvAnd } from "../../../rustc_middle/ty/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Ty, TypingEnv } from "../../../rustc_middle/ty/decls.ts";
import type { DropckConstraint, DropckOutlivesResult, type_op } from "../../../rustc_middle/traits/query.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import type { NoSolution } from "../../../rustc_type_ir/solve/mod.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { ObligationCtxt } from "../engine.ts";
import type { ScrubbedTraitError } from "../../../rustc_infer/traits/engine.ts";

function stub(name: string): never {
  return unported(`rustc_trait_selection::traits::query::dropck_outlives::${name}`);
}

/// This returns true if the type `ty` is "trivial" for
/// dropck-outlives -- that is, if it doesn't require any types to
/// outlive. This is similar but not *quite* the same as the
/// `needs_drop` test in the compiler already -- that is, for every
/// type T for which this function return true, needs-drop would
/// return `false`. But the reverse does not hold: in particular,
/// `needs_drop` returns false for `PhantomData`, but it is not
/// trivial for dropck-outlives.
///
/// Note also that `needs_drop` requires a "global" type (i.e., one
/// with erased regions), but this function does not.
///
// FIXME(@lcnr): remove this module and move this function somewhere else.
// dropck_outlives.rs:29 (stub)
export function trivial_dropck_outlives(_tcx: TyCtxt, _ty: Ty): boolean {
  return stub("trivial_dropck_outlives");
}

// dropck_outlives.rs:95 (stub)
export function compute_dropck_outlives_inner(
  _ocx: ObligationCtxt<ScrubbedTraitError>,
  _goal: ParamEnvAnd<type_op.DropckOutlives>,
  _span: Span,
): Result<DropckOutlivesResult, NoSolution> {
  return stub("compute_dropck_outlives_inner");
}

// dropck_outlives.rs:106 (stub)
export function compute_dropck_outlives_with_errors<E>(
  _ocx: ObligationCtxt<E>,
  _goal: ParamEnvAnd<type_op.DropckOutlives>,
  _span: Span,
): Result<DropckOutlivesResult, E[]> {
  return stub("compute_dropck_outlives_with_errors");
}

/// Returns a set of constraints that needs to be satisfied in
/// order for `ty` to be valid for destruction.
// dropck_outlives.rs:256 (stub)
export function dtorck_constraint_for_ty_inner(
  _tcx: TyCtxt,
  _typing_env: TypingEnv,
  _span: Span,
  _depth: number,
  _ty: Ty,
  _constraints: DropckConstraint,
): void {
  stub("dtorck_constraint_for_ty_inner");
}
