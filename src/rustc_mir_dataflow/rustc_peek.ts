// Port of compiler/rustc_mir_dataflow/src/rustc_peek.rs (declared by lane dataflow-contract, filled by lane
// dataflow-impls). Notes:
// - `trait RustcPeekAt<'tcx>: Analysis<'tcx>` is the impl table `RustcPeekAt<D, A>` (PORTING §5 trait tables): the
//   blanket `impl<A: Analysis<Domain = D> + HasMoveData, D: BitSetExt<MovePathIndex>>` is `RustcPeekAt_HasMoveData(D_)`
//   and `impl RustcPeekAt for MaybeLiveLocals` is `RustcPeekAt_MaybeLiveLocals`. `sanity_check_via_rustc_peek` takes
//   the table last (`A: RustcPeekAt`).
// - The diagnostics (`PeekBitNotSet`, ...) are diagnostics.rs' `#[derive(Diagnostic)]` structs (diagnostics.gen.ts).
// - `MaybeLiveLocals.iterate_to_fixpoint(..)` (unit value) is `new MaybeLiveLocals().iterate_to_fixpoint(..)`.
// - `find_attr!(tcx, def_id, RustcMir(kind) => kind)` is `find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), ..)`;
//   `kind.contains(&RustcMirKind::X)` compares the (unit) variant tags.
// - `debug!` / `info!` are comments (tracing is not compiled in).

import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { RustcMirKind } from "../rustc_attr_ir/data_structures.gen.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import { Const } from "../rustc_middle/mir/consts.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { HasAttrs_DefId, type Ty } from "../rustc_middle/ty/mod.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { assert_eq, unwrap } from "../std/panic.ts";
import {
  PeekArgumentNotALocal_diagnostic,
  PeekArgumentUntracked_diagnostic,
  PeekBitNotSet_diagnostic,
  PeekMustBeNotTemporary_diagnostic,
  PeekMustBePlaceOrRefPlace_diagnostic,
  StopAfterDataFlowEndedCompilation_diagnostic,
} from "./diagnostics.gen.ts";
import type { ResultsCursor } from "./framework/cursor.ts";
import { type Analysis, type BitSetExt, BitSetExt_MixedBitSet } from "./framework/mod.ts";
import { MaybeReachable } from "./framework/lattice.ts";
import { MaybeInitializedPlaces, MaybeUninitializedPlaces } from "./impls/initialized.ts";
import { MaybeLiveLocals } from "./impls/liveness.ts";
import { type HasMoveData, MoveData, type MovePathIndex } from "./move_paths/mod.ts";
import { type BasicBlock, type Body, type Local, Location, type Place, type Rvalue, type Statement, type Terminator } from "../rustc_middle/mir/mod.ts";
import type { MixedBitSet } from "../rustc_index/bit_set.ts";

function contains_kind(kinds: readonly RustcMirKind[], k: RustcMirKind["$"]): boolean {
  return kinds.some((x) => x.$ === k);
}

// rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:16 sanity_check
export function sanity_check(tcx: TyCtxt, body: Body): void {
  const def_id = body.source.def_id();
  const kind = find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcMir" ? k._0 : undefined));
  if (kind !== undefined) {
    const move_data = MoveData.gather_moves(body, tcx, (_) => true);
    // debug!("running rustc_peek::SanityCheck on {}", tcx.def_path_str(def_id));
    if (contains_kind(kind, "PeekMaybeInit")) {
      const flow_inits = MaybeInitializedPlaces.new(tcx, body, move_data).iterate_to_fixpoint(tcx, body, undefined).into_results_cursor(body);
      sanity_check_via_rustc_peek(tcx, flow_inits, RustcPeekAt_HasMoveData(BitSetExt_MaybeReachable_MixedBitSet));
    }

    if (contains_kind(kind, "PeekMaybeUninit")) {
      const flow_uninits = MaybeUninitializedPlaces.new(tcx, body, move_data).iterate_to_fixpoint(tcx, body, undefined).into_results_cursor(body);
      sanity_check_via_rustc_peek(
        tcx,
        flow_uninits,
        RustcPeekAt_HasMoveData(BitSetExt_MixedBitSet as BitSetExt<MixedBitSet<MovePathIndex>, MovePathIndex>),
      );
    }

    if (contains_kind(kind, "PeekLiveness")) {
      const flow_liveness = new MaybeLiveLocals().iterate_to_fixpoint(tcx, body, undefined).into_results_cursor(body);
      sanity_check_via_rustc_peek(tcx, flow_liveness, RustcPeekAt_MaybeLiveLocals);
    }

    if (contains_kind(kind, "StopAfterDataflow")) {
      tcx.dcx().emit_fatal(StopAfterDataFlowEndedCompilation_diagnostic({}));
    }
  } else {
    // debug!("skipping rustc_peek::SanityCheck on {}", tcx.def_path_str(def_id));
  }
}

/** `impl<T, S: BitSetExt<T>> BitSetExt<T> for MaybeReachable<S>` with `S = MixedBitSet<MovePathIndex>`. */
const BitSetExt_MaybeReachable_MixedBitSet: BitSetExt<MaybeReachable<MixedBitSet<MovePathIndex>>, MovePathIndex> = {
  contains(self, elem) {
    return MaybeReachable.contains(self, elem, BitSetExt_MixedBitSet as BitSetExt<MixedBitSet<MovePathIndex>, MovePathIndex>);
  },
};

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
// rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:65 sanity_check_via_rustc_peek
function sanity_check_via_rustc_peek<D, A extends Analysis<D, unknown>>(tcx: TyCtxt, cursor: ResultsCursor<D, A>, A_: RustcPeekAt<D, A>): void {
  // let def_id = cursor.body().source.def_id();
  // debug!("sanity_check_via_rustc_peek def_id: {:?}", def_id);

  const blocks = cursor.body().basic_blocks.deref();
  // PORT: the lazy `filter_map` over the blocks, as a generator (`PeekCall::from_terminator` may emit errors: the
  // interleaving with the loop body's diagnostics is upstream's).
  const peek_calls = function* (): Generator<[BasicBlock, (typeof blocks)[number], PeekCall]> {
    for (let bb = 0; bb < blocks.length; bb++) {
      const block_data = blocks[bb]!;
      const call = PeekCall.from_terminator(tcx, block_data.terminator_());
      if (call !== undefined) yield [bb as BasicBlock, block_data, call];
    }
  };

  for (const [bb, block_data, call] of peek_calls()) {
    // Look for a sequence like the following to indicate that we should be peeking at `_1`:
    //    _2 = &_1;
    //    rustc_peek(_2);
    //
    //    /* or */
    //
    //    _2 = _1;
    //    rustc_peek(_2);
    let found: [number, Rvalue] | undefined;
    for (let i = 0; i < block_data.statements.length; i++) {
      const rval = value_assigned_to_local(block_data.statements[i]!, call.arg);
      if (rval !== undefined) {
        found = [i, rval];
        break;
      }
    }
    const [statement_index, peek_rval] = unwrap(found, "call to rustc_peek should be preceded by assignment to temporary holding its argument");

    let place: Place | undefined;
    if (call.kind === "ByRef" && peek_rval.$ === "Ref") {
      place = peek_rval._2;
    } else if (call.kind === "ByVal" && peek_rval.$ === "Use" && (peek_rval._0.$ === "Move" || peek_rval._0.$ === "Copy")) {
      place = peek_rval._0._0;
    }
    if (place !== undefined) {
      const loc = new Location(bb, statement_index);
      cursor.seek_before_primary_effect(loc);
      const state = cursor.get();
      const analysis = cursor.analysis();
      A_.peek_at(analysis, tcx, place, state, call);
    } else {
      tcx.dcx().emit_err(PeekMustBePlaceOrRefPlace_diagnostic({ span: call.span }));
    }
  }
}

/// If `stmt` is an assignment where the LHS is the given local (with no projections), returns the
/// RHS of the assignment.
// rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:117 value_assigned_to_local
function value_assigned_to_local(stmt: Statement, local: Local): Rvalue | undefined {
  if (stmt.kind.$ === "Assign") {
    const [place, rvalue] = stmt.kind._0;
    const l = place.as_local();
    if (l !== undefined && local === l) {
      return rvalue;
    }
  }

  return undefined;
}

// #[derive(Clone, Copy, Debug)]
// rustc-type: compiler/rustc_mir_dataflow/src/rustc_peek.rs:132 PeekCallKind
type PeekCallKind = "ByVal" | "ByRef";
const PeekCallKind = {
  ByVal: "ByVal",
  ByRef: "ByRef",

  // rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:138 from_arg_ty
  from_arg_ty(arg: Ty): PeekCallKind {
    switch (arg.kind().$) {
      case "Ref":
        return "ByRef";
      default:
        return "ByVal";
    }
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
  // rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:154 from_terminator
  from_terminator(tcx: TyCtxt, terminator: Terminator): PeekCall | undefined {
    // use mir::Operand;

    const span = terminator.source_info.span;
    const tk = terminator.kind;
    if (tk.$ === "Call" && tk.func.$ === "Constant") {
      const func = tk.func._0;
      const args = tk.args;
      const k = Const.ty(func.const_).kind();
      if (k.$ === "FnDef") {
        const def_id = k._0;
        const fn_args = unwrap(Binder.no_bound_vars(k._1, fold_GenericArgs));

        const intrinsic = tcx.intrinsic(def_id);
        if (intrinsic === undefined) return undefined;
        if (intrinsic.name !== sym.rustc_peek) {
          return undefined;
        }

        assert_eq(fn_args.length, 1, String);
        const kind = PeekCallKind.from_arg_ty(fn_args.type_at(0));
        let arg: Local;
        const op = args[0]!.node;
        switch (op.$) {
          case "Copy":
          case "Move": {
            const local = op._0.as_local();
            if (local !== undefined) {
              arg = local;
            } else {
              tcx.dcx().emit_err(PeekMustBeNotTemporary_diagnostic({ span }));
              return undefined;
            }
            break;
          }
          default:
            tcx.dcx().emit_err(PeekMustBeNotTemporary_diagnostic({ span }));
            return undefined;
        }

        return { arg, kind, span };
      }
    }

    return undefined;
  },
};

// rustc-trait: compiler/rustc_mir_dataflow/src/rustc_peek.rs:195 RustcPeekAt
interface RustcPeekAt<D, A extends Analysis<D, unknown>> {
  // rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:196 peek_at
  peek_at(self: A, tcx: TyCtxt, place: Place, state: D, call: PeekCall): void;
}

/** `impl<'tcx, A, D> RustcPeekAt<'tcx> for A where A: Analysis<Domain = D> + HasMoveData, D: BitSetExt<MovePathIndex>`. */
function RustcPeekAt_HasMoveData<D, A extends Analysis<D, unknown> & HasMoveData>(D_: BitSetExt<D, MovePathIndex>): RustcPeekAt<D, A> {
  return {
    // rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:210 peek_at
    peek_at(self: A, tcx: TyCtxt, place: Place, state: D, call: PeekCall): void {
      const r = self.move_data().rev_lookup.find(place.as_ref());
      switch (r.$) {
        case "Exact": {
          const peek_mpi = r._0;
          const bit_state = D_.contains(state, peek_mpi);
          // debug!("rustc_peek({:?} = &{:?}) bit_state: {}", call.arg, place, bit_state);
          if (!bit_state) {
            tcx.dcx().emit_err(PeekBitNotSet_diagnostic({ span: call.span }));
          }
          break;
        }

        case "Parent":
          tcx.dcx().emit_err(PeekArgumentUntracked_diagnostic({ span: call.span }));
          break;
      }
    },
  };
}

/** `impl<'tcx> RustcPeekAt<'tcx> for MaybeLiveLocals`. */
const RustcPeekAt_MaybeLiveLocals: RustcPeekAt<DenseBitSet<Local>, MaybeLiveLocals> = {
  // rustc: compiler/rustc_mir_dataflow/src/rustc_peek.rs:234 peek_at
  peek_at(_self: MaybeLiveLocals, tcx: TyCtxt, place: Place, state: DenseBitSet<Local>, call: PeekCall): void {
    // info!(?place, "peek_at");
    const local = place.as_local();
    if (local === undefined) {
      tcx.dcx().emit_err(PeekArgumentNotALocal_diagnostic({ span: call.span }));
      return;
    }

    if (!state.contains(local)) {
      tcx.dcx().emit_err(PeekBitNotSet_diagnostic({ span: call.span }));
    }
  },
};
