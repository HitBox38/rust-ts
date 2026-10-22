// Port of compiler/rustc_mir_dataflow/src/rustc_peek.rs: DECLARED (lane dataflow-contract). Every fn is a stub for lane
// `dataflow-impls` (plan-m4 §5 wave 22), except the trait declaration `RustcPeekAt::peek_at`.
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. Notes:
// - `trait RustcPeekAt<'tcx>: Analysis<'tcx>` is the impl table `RustcPeekAt<D, A>` (PORTING §5 trait tables): the
//   blanket `impl<A: Analysis<Domain = D> + HasMoveData, D: BitSetExt<MovePathIndex>>` is `RustcPeekAt_HasMoveData(D_)`
//   and `impl RustcPeekAt for MaybeLiveLocals` is `RustcPeekAt_MaybeLiveLocals`. `sanity_check_via_rustc_peek` takes
//   the table last (`A: RustcPeekAt`).
// - The diagnostics (`PeekBitNotSet`, ...) are crate::diagnostics' `#[derive(Diagnostic)]` structs (generated, not in
//   this file).
// - `MaybeLiveLocals.iterate_to_fixpoint(..)` (unit value) is `new MaybeLiveLocals().iterate_to_fixpoint(..)`.

import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { Span } from "../rustc_span/span_encoding.ts";
import { unported } from "../std/panic.ts";
import type { ResultsCursor } from "./framework/cursor.ts";
import type { Analysis, BitSetExt } from "./framework/mod.ts";
import type { MaybeLiveLocals } from "./impls/liveness.ts";
import type { HasMoveData, MovePathIndex } from "./move_paths/mod.ts";
import type { Body, Local, Place, Rvalue, Statement, Terminator } from "../rustc_middle/mir/mod.ts";

// stub: compiler/rustc_mir_dataflow/src/rustc_peek.rs:16 sanity_check (lane dataflow-impls)
export function sanity_check(_tcx: TyCtxt, _body: Body): void {
  return unported("rustc_mir_dataflow::rustc_peek::sanity_check");
}

/// This function scans `mir` for all calls to the intrinsic
/// `rustc_peek` that have the expression form `rustc_peek(&expr)`.
///
/// For each such call, determines what the dataflow bit-state is for
/// the L-value corresponding to `expr`; if the bit-state is a 1, then
/// that call to `rustc_peek` is ignored by the sanity check. If the
/// bit-state is a 0, then this pass emits an error message saying
/// "rustc_peek: bit not set".
///
/// The intention is that one can write unit tests for dataflow by
/// putting code into a UI test and using `rustc_peek` to
/// make observations about the results of dataflow static analyses.
///
/// (If there are any calls to `rustc_peek` that do not match the
/// expression form above, then that emits an error as well, but those
/// errors are not intended to be used for unit tests.)
// stub: compiler/rustc_mir_dataflow/src/rustc_peek.rs:65 sanity_check_via_rustc_peek (lane dataflow-impls)
function sanity_check_via_rustc_peek<D, A extends Analysis<D, unknown>>(
  _tcx: TyCtxt,
  _cursor: ResultsCursor<D, A>,
  _A_: RustcPeekAt<D, A>,
): void {
  return unported("rustc_mir_dataflow::rustc_peek::sanity_check_via_rustc_peek");
}

/// If `stmt` is an assignment where the LHS is the given local (with no projections), returns the
/// RHS of the assignment.
// stub: compiler/rustc_mir_dataflow/src/rustc_peek.rs:117 value_assigned_to_local (lane dataflow-impls)
function value_assigned_to_local(_stmt: Statement, _local: Local): Rvalue | undefined {
  return unported("rustc_mir_dataflow::rustc_peek::value_assigned_to_local");
}

// #[derive(Clone, Copy, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/rustc_peek.rs:132 PeekCallKind
type PeekCallKind = "ByVal" | "ByRef";
const PeekCallKind = {
  ByVal: "ByVal",
  ByRef: "ByRef",

  // stub: compiler/rustc_mir_dataflow/src/rustc_peek.rs:138 from_arg_ty (lane dataflow-impls)
  from_arg_ty(_arg: Ty): PeekCallKind {
    return unported("rustc_mir_dataflow::rustc_peek::PeekCallKind::from_arg_ty");
  },
} as const;

// #[derive(Clone, Copy, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/rustc_peek.rs:147 PeekCall
interface PeekCall {
  readonly arg: Local;
  readonly kind: PeekCallKind;
  readonly span: Span;
}

const PeekCall = {
  // stub: compiler/rustc_mir_dataflow/src/rustc_peek.rs:154 from_terminator (lane dataflow-impls)
  from_terminator(_tcx: TyCtxt, _terminator: Terminator): PeekCall | undefined {
    return unported("rustc_mir_dataflow::rustc_peek::PeekCall::from_terminator");
  },
};

// rustc-trait: compiler/rustc_mir_dataflow/src/rustc_peek.rs:195 RustcPeekAt
interface RustcPeekAt<D, A extends Analysis<D, unknown>> {
  // rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:196 peek_at
  peek_at(self: A, tcx: TyCtxt, place: Place, state: D, call: PeekCall): void;
}

/** `impl<'tcx, A, D> RustcPeekAt<'tcx> for A where A: Analysis<Domain = D> + HasMoveData, D: BitSetExt<MovePathIndex>`. */
function RustcPeekAt_HasMoveData<D, A extends Analysis<D, unknown> & HasMoveData>(_D_: BitSetExt<D, MovePathIndex>): RustcPeekAt<D, A> {
  return {
    // stub: compiler/rustc_mir_dataflow/src/rustc_peek.rs:210 peek_at (lane dataflow-impls)
    peek_at(_self: A, _tcx: TyCtxt, _place: Place, _state: D, _call: PeekCall): void {
      return unported("rustc_mir_dataflow::rustc_peek::RustcPeekAt::peek_at (HasMoveData)");
    },
  };
}

/** `impl<'tcx> RustcPeekAt<'tcx> for MaybeLiveLocals`. */
const RustcPeekAt_MaybeLiveLocals: RustcPeekAt<DenseBitSet<Local>, MaybeLiveLocals> = {
  // stub: compiler/rustc_mir_dataflow/src/rustc_peek.rs:234 peek_at (lane dataflow-impls)
  peek_at(_self: MaybeLiveLocals, _tcx: TyCtxt, _place: Place, _state: DenseBitSet<Local>, _call: PeekCall): void {
    return unported("rustc_mir_dataflow::rustc_peek::RustcPeekAt::peek_at (MaybeLiveLocals)");
  },
};

/** Keeps the module-private declarations referenced for the fill lane. */
export const _rustc_peek_decls = {
  sanity_check_via_rustc_peek,
  value_assigned_to_local,
  PeekCallKind,
  PeekCall,
  RustcPeekAt_HasMoveData,
  RustcPeekAt_MaybeLiveLocals,
};
