//! A constant propagation optimization pass based on dataflow analysis.
//!
//! Currently, this pass only propagates scalar values.
//
// Port of compiler/rustc_mir_transform/src/dataflow_const_prop.rs (lane mt-opt2-b).
//
// PORT:
// - `ConstAnalysis` extends rustc_mir_dataflow's `AnalysisBase` (D5); its domain `State<FlatSet<Scalar>>` uses
//   value_analysis.ts's impl tables with `SCALAR_LATTICE` (`FlatSet<Scalar>`: `Copy`, immutable values). `impl
//   DebugWithContext<ConstAnalysis> for State<FlatSet<Scalar>>` is `DebugWithContext_State` (its `Debug` supertrait,
//   the derived `Debug` of `State`, prints a hash map and is only reached by graphviz's fallback: unported).
// - The derived `PartialEq` of `Scalar` (`Int`: `ScalarInt`'s; `Ptr`: offset, provenance and size) is `Scalar_eq`.
// - `Collector` extends `ResultsVisitorBase`; `Patch` extends `MutVisitor`; `OperandCollector` extends `Visitor` (D4).
//   `Patch`'s `FxHashMap<(Location, Place), Const>` / `FxHashMap<Location, Const>` are keyed by `before_effect_key` /
//   `location_key` (the derived `Hash`/`Eq` of `Location` and `Place`: the local and the interned projection list's id).
//   `*operand = ..` / `*rvalue = ..` replace the visited operand in place (`replace_in_place`) / the assignment's
//   rvalue slot; each stored `Const` is copied (`clone_Const`) where rustc copies it.
// - The interpreter (`InterpCx<DummyMachine>`, `ImmTy`, `OpTy`, ...) comes from rustc_const_eval (D8), reached through
//   its `lib.ts` at call time (as known_panics_lint.ts). `ImmTy`'s `Deref<Target = Immediate>` is `.imm`.
// - `PlaceElem::ConstantIndex`'s `u64` fields are numbers in the port: `offset` (a `bigint` from `to_target_usize`) and
//   `offset.checked_add(1)` (`None` past `u64::MAX`) become numbers.
// - The `tracing` spans (`debug_span!(..).in_scope(..)`) run their closure.
import { BackendRepr, Size } from "../rustc_abi/lib.ts";
import { FIRST_VARIANT, FieldIdx, type VariantIdx } from "../rustc_abi/layout.ts";
import { const_eval, interpret } from "../rustc_const_eval/lib.ts";
import type { DummyMachine } from "../rustc_const_eval/const_eval/dummy_machine.ts";
import type { ImmTy, Immediate, InterpCx, OpTy, PlaceTy } from "../rustc_const_eval/interpret/mod.ts";
// `impl From<ImmTy / MPlaceTy> for OpTy` (not re-exported by interpret/mod.rs); only called at run time.
import { OpTy_from_ImmTy, OpTy_from_MPlaceTy } from "../rustc_const_eval/interpret/operand.ts";
import { InterpErrorInfo_from_InterpErrorKind, InterpResult, Scalar, interp_ok } from "../rustc_middle/mir/interpret/mod.ts";
import { type CtfeProvenance, debug_CtfeProvenance } from "../rustc_middle/mir/interpret/pointer.ts";
import { debug_Scalar, Scalar_from_ScalarInt } from "../rustc_middle/mir/interpret/value.ts";
import {
  type BasicBlock,
  type BinOp,
  type Body,
  ConstOperand,
  type LocalDecl,
  type Location,
  Operand as OperandC,
  type Operand,
  type Place,
  type PlaceElem,
  PlaceRef_from_Local,
  Place_from_Local,
  type Rvalue,
  type Statement,
  type SwitchTargets,
  type Terminator,
  type TerminatorEdges,
  type CallReturnPlaces,
  CallReturnPlaces as CallReturnPlacesC,
  traversal,
  type PlaceRef,
} from "../rustc_middle/mir/mod.ts";
import { BinOp as BinOpC } from "../rustc_middle/mir/mod.ts";
import { clone_Const, Const } from "../rustc_middle/mir/consts.ts";
import { MutVisitor, type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import { ScalarInt_eq } from "../rustc_middle/ty/consts/int.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { DefKind } from "../rustc_hir/def.ts";
import type { DebugWithContext } from "../rustc_mir_dataflow/framework/fmt.ts";
import { DebugWithContext_impl } from "../rustc_mir_dataflow/framework/fmt.ts";
import { debug_FlatSet, FlatSet, HasBottom_FlatSet, JoinSemiLattice_FlatSet } from "../rustc_mir_dataflow/framework/lattice.ts";
import { AnalysisBase, type Domain, Domain_of } from "../rustc_mir_dataflow/framework/mod.ts";
import type { Results } from "../rustc_mir_dataflow/framework/results.ts";
import { ResultsVisitorBase, visit_results } from "../rustc_mir_dataflow/framework/visitor.ts";
import {
  Clone_State,
  debug_with_context,
  JoinSemiLattice_State,
  Map,
  type PlaceIndex,
  State,
  State_eq,
  type TrackElem,
  TrackElem as TrackElemC,
  ValueOrPlace,
} from "../rustc_mir_dataflow/value_analysis.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { Fmt } from "../std/fmt.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import { Err } from "../std/result.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// These constants are somewhat random guesses and have not been optimized.
// If `tcx.sess.mir_opt_level() >= 4`, we ignore the limits (this can become very expensive).
const BLOCK_LIMIT = 100;
const PLACE_LIMIT = 100;

/** The derived `PartialEq` of `Scalar<CtfeProvenance>` (header). */
function Scalar_eq(a: Scalar, b: Scalar): boolean {
  if (a.$ === "Int" && b.$ === "Int") return ScalarInt_eq(a._0, b._0);
  if (a.$ === "Ptr" && b.$ === "Ptr") {
    return a._0.offset.bytes() === b._0.offset.bytes() && a._0.provenance === b._0.provenance && a._1 === b._1;
  }
  return false;
}

/** `FlatSet<Scalar>`'s impls (`JoinSemiLattice`, `HasBottom`, `HasTop`, `Clone`, `Debug`) as one table (header). */
const SCALAR_LATTICE = {
  ...JoinSemiLattice_FlatSet<Scalar>(Scalar_eq, (s) => s),
  BOTTOM: FlatSet.Bottom as FlatSet<Scalar>,
  is_bottom: (self: FlatSet<Scalar>): boolean => HasBottom_FlatSet.is_bottom(self),
  TOP: FlatSet.Top as FlatSet<Scalar>,
  clone: (v: FlatSet<Scalar>): FlatSet<Scalar> => v,
  fmt: debug_FlatSet<Scalar>((s, f) => debug_Scalar<CtfeProvenance>(s, f, debug_CtfeProvenance)),
};

type ConstState = State<FlatSet<Scalar>>;

// rustc-type: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:35 DataflowConstProp
export class DataflowConstProp extends MirPass {
  readonly type_name = "rustc_mir_transform::dataflow_const_prop::DataflowConstProp";

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:38 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 3);
  }

  // #[instrument(skip_all level = "debug")]
  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:43 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // Avoid query cycles from coroutines.
    if (body.coroutine !== undefined) {
      return;
    }

    // debug!(def_id = ?body.source.def_id());
    if (tcx.sess.mir_opt_level() < 4 && body.basic_blocks.deref().length > BLOCK_LIMIT) {
      // debug!("aborted dataflow const prop due too many basic blocks");
      return;
    }

    // We want to have a somewhat linear runtime w.r.t. the number of statements/terminators.
    // Let's call this number `n`. Dataflow analysis has `O(h*n)` transfer function
    // applications, where `h` is the height of the lattice. Because the height of our lattice
    // is linear w.r.t. the number of tracked places, this is `O(tracked_places * n)`. However,
    // because every transfer function application could traverse the whole map, this becomes
    // `O(num_nodes * tracked_places * n)` in terms of time complexity. Since the number of
    // map nodes is strongly correlated to the number of tracked places, this becomes more or
    // less `O(n)` if we place a constant limit on the number of tracked places.
    const value_limit = tcx.sess.mir_opt_level() < 4 ? PLACE_LIMIT : undefined;

    // Decide which places to track during the analysis.
    const map = Map.new(tcx, body, { $: "Full", value_limit });

    // Perform the actual dataflow analysis.
    const const_ = ConstAnalysis.new(tcx, body, map).iterate_to_fixpoint(tcx, body, undefined);

    // Collect results and patch the body afterwards.
    const visitor = Collector.new(tcx, body, const_.analysis.map);
    visit_results(
      body,
      [...traversal.reachable(body)].map(([bb, _]) => bb),
      const_ as Results<ConstState, ConstAnalysis>,
      visitor,
    );
    const patch = visitor.patch;
    patch.visit_body_preserves_cfg(body);
  }
}

/** `impl DebugWithContext<ConstAnalysis> for State<FlatSet<Scalar>>` (header). */
const DebugWithContext_State: DebugWithContext<ConstState, ConstAnalysis> = DebugWithContext_impl<ConstState, ConstAnalysis>(
  State_eq(SCALAR_LATTICE.eq),
  (_v, _f) => unported("rustc_mir_dataflow::value_analysis::State: derived Debug (graphviz fallback)"),
  {
    // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:661 fmt_with
    fmt_with(self: ConstState, ctxt: ConstAnalysis, f: Fmt): string {
      switch (self.$) {
        case "Reachable":
          return debug_with_context(self._0, undefined, ctxt.map, f, SCALAR_LATTICE);
        case "Unreachable":
          return "unreachable";
      }
    },

    // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:668 fmt_diff_with
    fmt_diff_with(self: ConstState, old: ConstState, ctxt: ConstAnalysis, f: Fmt): string {
      if (self.$ === "Reachable" && old.$ === "Reachable") {
        return debug_with_context(self._0, old._0, ctxt.map, f, SCALAR_LATTICE);
      }
      return ""; // Consider printing something here.
    },
  },
);

const CONST_DOMAIN: Domain<ConstState> = Domain_of<ConstState>(
  Clone_State(SCALAR_LATTICE),
  JoinSemiLattice_State(SCALAR_LATTICE),
  DebugWithContext_State as DebugWithContext<ConstState, unknown>,
);

// Note: Currently, places that have their reference taken cannot be tracked. Although this would
// be possible, it has to rely on some aliasing model, which we are not ready to commit to yet.
// Because of that, we can assume that the only way to change the value behind a tracked place is
// by direct assignment.
// rustc-type: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:86 ConstAnalysis
class ConstAnalysis extends AnalysisBase<ConstState> {
  readonly Domain: Domain<ConstState> = CONST_DOMAIN;
  readonly NAME = "ConstAnalysis";

  constructor(
    public map: Map,
    public tcx: TyCtxt,
    public local_decls: LocalDecl[],
    public ecx: InterpCx<DummyMachine>,
    public typing_env: TypingEnv,
  ) {
    super();
  }

  // ---- impl<'tcx> Analysis<'tcx> for ConstAnalysis<'_, 'tcx> ----

  // The bottom state denotes uninitialized memory. Because we are only doing a sound
  // approximation of the actual execution, we can also use this state for places where access
  // would be UB.
  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:102 bottom_value
  bottom_value(_body: Body): ConstState {
    return State.Unreachable();
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:106 initialize_start_block
  initialize_start_block(body: Body, state: ConstState): void {
    // The initial state maps all tracked places of argument projections to ⊤ and the rest to ⊥.
    // assert_matches!(state, State::Unreachable);
    if (state.$ !== "Unreachable") unported("rustc_mir_dataflow::value_analysis::State: derived Debug (assert_matches! message)");
    State.assign_(state, State.new_reachable(SCALAR_LATTICE));
    for (const arg of body.args_iter()) {
      State.flood(state, PlaceRef_from_Local(arg), this.map, SCALAR_LATTICE);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:115 apply_primary_statement_effect
  apply_primary_statement_effect(state: ConstState, statement: Statement, _location: Location): void {
    if (State.is_reachable(state)) {
      const kind = statement.kind;
      switch (kind.$) {
        case "Assign": {
          const [place, rvalue] = kind._0;
          this.handle_assign(place, rvalue, state);
          break;
        }
        case "SetDiscriminant": {
          const place = kind.place.as_ref();
          State.flood_discr(state, place, this.map, SCALAR_LATTICE);
          const target = this.map.find_discr(place);
          if (target !== undefined) {
            const enum_ty = place.ty(this.local_decls, this.tcx).ty;
            const discr = this.eval_discriminant(enum_ty, kind.variant_index);
            if (discr !== undefined) {
              State.insert_value_idx(state, target, FlatSet.Elem(discr), this.map, SCALAR_LATTICE);
            }
          }
          break;
        }
        case "Intrinsic": {
          const intrinsic = kind._0;
          switch (intrinsic.$) {
            case "Assume":
              // Could use this, but ignoring it is sound.
              break;
            case "CopyNonOverlapping":
              // This statement represents `*dst = *src`, `count` times.
              break;
          }
          break;
        }
        case "StorageLive":
        case "StorageDead": {
          const local = kind._0;
          // StorageLive leaves the local in an uninitialized state.
          // StorageDead makes it UB to access the local afterwards.
          State.flood_with(state, Place_from_Local(local).as_ref(), this.map, SCALAR_LATTICE.BOTTOM, SCALAR_LATTICE);
          break;
        }
        // StatementKind::ConstEvalCounter | Nop | FakeRead(..) | PlaceMention(..) | Coverage(..)
        // | BackwardIncompatibleDropHint { .. } | AscribeUserType(..)
        default:
          break;
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:170 get_terminator_edges
  override get_terminator_edges(state: ConstState, terminator: Terminator, _location: Location): TerminatorEdges {
    if (State.is_reachable(state)) {
      const kind = terminator.kind;
      if (kind.$ === "SwitchInt") {
        return this.get_switch_int_edges(kind.discr, kind.targets, state);
      } else {
        return terminator.edges();
      }
    } else {
      return { $: "None" };
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:187 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: ConstState, terminator: Terminator, _location: Location): void {
    if (State.is_reachable(state)) {
      const kind = terminator.kind;
      switch (kind.$) {
        case "Call":
        case "InlineAsm":
          // Effect is applied by `apply_call_return_effect`.
          break;
        case "Drop":
          State.flood_with(state, kind.place.as_ref(), this.map, SCALAR_LATTICE.BOTTOM, SCALAR_LATTICE);
          break;
        case "Yield":
          // They would have an effect, but are not allowed in this phase.
          bug("encountered disallowed terminator");
          break;
        case "TailCall":
          // FIXME(explicit_tail_calls): determine if we need to do something here
          // (probably not)
          break;
        // SwitchInt | Goto | UnwindResume | UnwindTerminate | Return | Unreachable | Assert | CoroutineDrop
        // | FalseEdge | FalseUnwind
        default:
          // These terminators have no effect on the analysis.
          break;
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:225 apply_call_return_effect
  override apply_call_return_effect(state: ConstState, _block: BasicBlock, return_places: CallReturnPlaces): void {
    if (State.is_reachable(state)) {
      CallReturnPlacesC.for_each(return_places, (place) => {
        State.flood(state, place.as_ref(), this.map, SCALAR_LATTICE);
      });
    }
  }

  // ---- impl<'a, 'tcx> ConstAnalysis<'a, 'tcx> ----

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:240 new
  static new(tcx: TyCtxt, body: Body, map: Map): ConstAnalysis {
    const typing_env = body.typing_env(tcx);
    return new ConstAnalysis(
      map,
      tcx,
      body.local_decls,
      interpret.InterpCx.new(tcx, DUMMY_SP, typing_env, new const_eval.DummyMachine()),
      typing_env,
    );
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:251 handle_operand
  handle_operand(operand: Operand): ValueOrPlace<FlatSet<Scalar>> {
    switch (operand.$) {
      case "RuntimeChecks":
        return ValueOrPlace.TOP(SCALAR_LATTICE);
      case "Constant": {
        const constant = operand._0;
        const s = Const.try_eval_scalar(constant.const_, this.tcx, this.typing_env);
        return { $: "Value", _0: s === undefined ? FlatSet.Top : FlatSet.Elem(s) };
      }
      case "Copy":
      case "Move": {
        const place = operand._0;
        // On move, we would ideally flood the place with bottom. But with the current
        // framework this is not possible (similar to `InterpCx::eval_operand`).
        const p = this.map.find(place.as_ref());
        return p !== undefined ? { $: "Place", _0: p } : ValueOrPlace.TOP(SCALAR_LATTICE);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:268 handle_assign
  handle_assign(target: Place, rvalue: Rvalue, state: ConstState): void {
    let result: ValueOrPlace<FlatSet<Scalar>>;
    switch (rvalue.$) {
      case "Use": {
        const operand = rvalue._0;
        State.flood(state, target.as_ref(), this.map, SCALAR_LATTICE);
        const target_ = this.map.find(target.as_ref());
        if (target_ !== undefined) {
          this.assign_operand(state, target_, operand);
        }
        return;
      }
      case "CopyForDeref":
        return bug("`CopyForDeref` in runtime MIR");
      case "Aggregate": {
        const [kind, operands] = [rvalue._0, rvalue._1];
        // If we assign `target = Enum::Variant#0(operand)`,
        // we must make sure that all `target as Variant#i` are `Top`.
        State.flood(state, target.as_ref(), this.map, SCALAR_LATTICE);

        const target_idx = this.map.find(target.as_ref());
        if (target_idx === undefined) return;

        let variant_target: PlaceIndex | undefined;
        let variant_index: VariantIdx | undefined;
        switch (kind.$) {
          case "Tuple":
          case "Closure":
            [variant_target, variant_index] = [target_idx, undefined];
            break;
          case "Adt": {
            const [def_id, vi] = [kind._0, kind._1];
            const dk = this.tcx.def_kind(def_id) as DefKind;
            if (dk.$ === "Struct") {
              [variant_target, variant_index] = [target_idx, undefined];
            } else if (dk.$ === "Enum") {
              [variant_target, variant_index] = [this.map.apply(target_idx, { $: "Variant", _0: vi }), vi];
            } else {
              return;
            }
            break;
          }
          default:
            return;
        }
        if (variant_target !== undefined) {
          const variant_target_idx = variant_target;
          operands.forEach((operand, field_index) => {
            const field = this.map.apply(variant_target_idx, { $: "Field", _0: FieldIdx.from_usize(field_index) });
            if (field !== undefined) {
              this.assign_operand(state, field, operand);
            }
          });
        }
        if (variant_index !== undefined) {
          const discr_idx = this.map.apply(target_idx, TrackElemC.Discriminant);
          if (discr_idx !== undefined) {
            // We are assigning the discriminant as part of an aggregate.
            // This discriminant can only alias a variant field's value if the operand
            // had an invalid value for that type.
            // Using invalid values is UB, so we are allowed to perform the assignment
            // without extra flooding.
            const enum_ty = target.ty(this.local_decls, this.tcx).ty;
            const discr_val = this.eval_discriminant(enum_ty, variant_index);
            if (discr_val !== undefined) {
              State.insert_value_idx(state, discr_idx, FlatSet.Elem(discr_val), this.map, SCALAR_LATTICE);
            }
          }
        }
        return;
      }
      case "BinaryOp": {
        const [op, [left, right]] = [rvalue._0, rvalue._1];
        if (BinOpC.is_overflowing(op)) {
          // Flood everything now, so we can use `insert_value_idx` directly later.
          State.flood(state, target.as_ref(), this.map, SCALAR_LATTICE);

          const target_ = this.map.find(target.as_ref());
          if (target_ === undefined) return;

          const value_target = this.map.apply(target_, { $: "Field", _0: FieldIdx.from_u32(0) });
          const overflow_target = this.map.apply(target_, { $: "Field", _0: FieldIdx.from_u32(1) });

          if (value_target !== undefined || overflow_target !== undefined) {
            const [val, overflow] = this.binary_op(state, op, left, right);

            if (value_target !== undefined) {
              // We have flooded `target` earlier.
              State.insert_value_idx(state, value_target, val, this.map, SCALAR_LATTICE);
            }
            if (overflow_target !== undefined) {
              // We have flooded `target` earlier.
              State.insert_value_idx(state, overflow_target, overflow, this.map, SCALAR_LATTICE);
            }
          }
          return;
        } else {
          // Overflows must be ignored here.
          const [val, _overflow] = this.binary_op(state, op, left, right);
          result = { $: "Value", _0: val };
        }
        break;
      }
      case "Cast": {
        const [ck, operand, ty] = [rvalue._0, rvalue._1, rvalue._2];
        if (ck.$ === "PointerCoercion" && ck._0.$ === "Unsize") {
          const pointer = this.handle_operand(operand);
          State.assign(state, target.as_ref(), pointer, this.map, SCALAR_LATTICE);

          const target_len = this.map.find_len(target.as_ref());
          if (target_len !== undefined) {
            const operand_ty = OperandC.ty(operand, this.local_decls, this.tcx);
            const operand_ty_ = operand_ty.builtin_deref(true);
            if (operand_ty_ !== undefined) {
              const k = operand_ty_.kind();
              if (k.$ === "Array") {
                const len = Const.try_eval_scalar_int({ $: "Ty", _0: this.tcx.types.usize, _1: k._1 }, this.tcx, this.typing_env);
                if (len !== undefined) {
                  State.insert_value_idx(state, target_len, FlatSet.Elem(Scalar_from_ScalarInt<CtfeProvenance>(len)), this.map, SCALAR_LATTICE);
                }
              }
            }
          }
          return;
        } else if (ck.$ === "IntToInt" || ck.$ === "IntToFloat") {
          const layout = this.tcx.layout_of(this.typing_env.as_query_input(ty));
          result = {
            $: "Value",
            _0:
              layout.$ === "Ok"
                ? FlatSet.and_then(this.eval_operand(operand, state), (op) => {
                    const r = InterpResult.discard_err(this.ecx.int_to_int_or_float(op, layout._0));
                    return r === undefined ? FlatSet.Top : this.wrap_immediate(r.imm);
                  })
                : FlatSet.Top,
          };
        } else if (ck.$ === "FloatToInt" || ck.$ === "FloatToFloat") {
          const layout = this.tcx.layout_of(this.typing_env.as_query_input(ty));
          result = {
            $: "Value",
            _0:
              layout.$ === "Ok"
                ? FlatSet.and_then(this.eval_operand(operand, state), (op) => {
                    const r = InterpResult.discard_err(this.ecx.float_to_float_or_int(op, layout._0));
                    return r === undefined ? FlatSet.Top : this.wrap_immediate(r.imm);
                  })
                : FlatSet.Top,
          };
        } else if (ck.$ === "Transmute" || ck.$ === "Subtype") {
          result = { $: "Value", _0: FlatSet.and_then(this.eval_operand(operand, state), (op) => this.wrap_immediate(op.imm)) };
        } else {
          // Rvalue::Cast(..): no modification is possible through these r-values.
          result = ValueOrPlace.TOP(SCALAR_LATTICE);
        }
        break;
      }
      case "UnaryOp": {
        const [op, operand] = [rvalue._0, rvalue._1];
        const place = op === "PtrMetadata" ? OperandC.place(operand) : undefined;
        const len = place !== undefined ? this.map.find_len(place.as_ref()) : undefined;
        if (len !== undefined) {
          result = { $: "Place", _0: len };
        } else {
          result = {
            $: "Value",
            _0: FlatSet.and_then(this.eval_operand(operand, state), (value) => {
              const r = InterpResult.discard_err(this.ecx.unary_op(op, value));
              return r === undefined ? FlatSet.Top : this.wrap_immediate(r.imm);
            }),
          };
        }
        break;
      }
      case "Discriminant": {
        const place = rvalue._0;
        result = { $: "Value", _0: State.get_discr(state, place.as_ref(), this.map, SCALAR_LATTICE) };
        break;
      }
      case "Ref":
      case "Reborrow":
      case "RawPtr":
        // We don't track such places.
        result = ValueOrPlace.TOP(SCALAR_LATTICE);
        break;
      case "Repeat":
      case "ThreadLocalRef":
      case "WrapUnsafeBinder":
        // No modification is possible through these r-values.
        result = ValueOrPlace.TOP(SCALAR_LATTICE);
        break;
    }
    // For the arms that didn't return early.
    State.assign(state, target.as_ref(), result, this.map, SCALAR_LATTICE);
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:443 get_switch_int_edges
  get_switch_int_edges(discr: Operand, targets: SwitchTargets, state: ConstState): TerminatorEdges {
    const h = this.handle_operand(discr);
    const value = h.$ === "Value" ? h._0 : State.get_idx(state, h._0, this.map, SCALAR_LATTICE);
    switch (value.$) {
      // We are branching on uninitialized data, this is UB, treat it as unreachable.
      // This allows the set of visited edges to grow monotonically with the lattice.
      case "Bottom":
        return { $: "None" };
      case "Elem": {
        const scalar_int = Scalar.try_to_scalar_int(value._0);
        if (scalar_int.$ === "Ok") {
          return { $: "Single", _0: targets.target_for_value(scalar_int._0.to_bits_unchecked()) };
        } else {
          return { $: "SwitchInt", discr, targets };
        }
      }
      case "Top":
        return { $: "SwitchInt", discr, targets };
    }
  }

  /// The caller must have flooded `place`.
  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:471 assign_operand
  assign_operand(state: ConstState, place: PlaceIndex, operand: Operand): void {
    switch (operand.$) {
      case "RuntimeChecks":
        break;
      case "Copy":
      case "Move": {
        const rhs = operand._0;
        const rhs_ = this.map.find(rhs.as_ref());
        if (rhs_ !== undefined) {
          State.insert_place_idx(state, place, rhs_, this.map, SCALAR_LATTICE);
        } else if (rhs.projection[0]?.$ === "Deref") {
          const pointer = State.get(state, PlaceRef_from_Local(rhs.local), this.map, SCALAR_LATTICE);
          if (pointer.$ === "Elem") {
            const rhs_ty = this.local_decls[rhs.local]!.ty;
            const rhs_layout = this.tcx.layout_of(this.typing_env.as_query_input(rhs_ty));
            if (rhs_layout.$ === "Ok") {
              const op = OpTy_from_ImmTy(interpret.ImmTy.from_scalar(pointer._0, rhs_layout._0));
              this.assign_constant(state, place, op, rhs.projection);
            }
          }
        }
        break;
      }
      case "Constant": {
        const constant = operand._0;
        const c = InterpResult.discard_err(this.ecx.eval_mir_constant(constant.const_, constant.span, undefined));
        if (c !== undefined) {
          this.assign_constant(state, place, c, []);
        }
        break;
      }
    }
  }

  /// The caller must have flooded `place`.
  ///
  /// Perform: `place = operand.projection`.
  // #[instrument(level = "trace", skip(self, state))]
  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:506 assign_constant
  assign_constant(state: ConstState, place: PlaceIndex, operand_: OpTy, projection: readonly PlaceElem[]): void {
    let operand = operand_;
    for (const proj_elem_ of projection) {
      let proj_elem = proj_elem_;
      if (proj_elem.$ === "Index") {
        const index = proj_elem._0;
        const idx = State.get(state, PlaceRef_from_Local(index), this.map, SCALAR_LATTICE);
        const offset = idx.$ === "Elem" ? InterpResult.discard_err(Scalar.to_target_usize(idx._0, this.tcx)) : undefined;
        const min_length = offset !== undefined && offset < 0xffff_ffff_ffff_ffffn ? offset + 1n : undefined;
        if (offset !== undefined && min_length !== undefined) {
          proj_elem = { $: "ConstantIndex", offset: Number(offset), min_length: Number(min_length), from_end: false };
        } else {
          return;
        }
      }
      const projected = InterpResult.discard_err(this.ecx.project(operand, proj_elem));
      if (projected !== undefined) {
        operand = projected;
      } else {
        return;
      }
    }

    this.map.for_each_projection_value<OpTy>(
      place,
      operand,
      (elem: TrackElem, op: OpTy): OpTy | undefined => {
        switch (elem.$) {
          case "Field":
            return InterpResult.discard_err(this.ecx.project_field(op, elem._0));
          case "Variant":
            return InterpResult.discard_err(this.ecx.project_downcast(op, elem._0));
          case "Discriminant": {
            const variant = InterpResult.discard_err(this.ecx.read_discriminant(op));
            if (variant === undefined) return undefined;
            const discr_value = InterpResult.discard_err(this.ecx.discriminant_for_variant(op.layout.ty, variant));
            if (discr_value === undefined) return undefined;
            return OpTy_from_ImmTy(discr_value);
          }
          case "DerefLen": {
            const mplace = InterpResult.discard_err(this.ecx.deref_pointer(op));
            if (mplace === undefined) return undefined;
            const op_: OpTy = OpTy_from_MPlaceTy(mplace);
            const len_usize = InterpResult.discard_err(op_.len(this.ecx));
            if (len_usize === undefined) return undefined;
            const layout = this.tcx.layout_of(this.typing_env.as_query_input(this.tcx.types.usize));
            if (layout.$ !== "Ok") return panic_unwrap_layout();
            return OpTy_from_ImmTy(interpret.ImmTy.from_uint(len_usize, layout._0));
          }
        }
      },
      (place: PlaceIndex, op: OpTy) => {
        const imm_ = InterpResult.discard_err(this.ecx.read_immediate_raw(op));
        if (imm_ !== undefined && imm_.$ === "Right") {
          const imm = imm_._0;
          const elem = this.wrap_immediate(imm.imm);
          State.insert_value_idx(state, place, elem, this.map, SCALAR_LATTICE);
        }
      },
    );
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:564 binary_op
  binary_op(state: ConstState, op: BinOp, left_: Operand, right_: Operand): [FlatSet<Scalar>, FlatSet<Scalar>] {
    const left = this.eval_operand(left_, state);
    const right = this.eval_operand(right_, state);

    if (left.$ === "Bottom" || right.$ === "Bottom") {
      return [FlatSet.Bottom, FlatSet.Bottom];
    } else if (left.$ === "Elem" && right.$ === "Elem") {
      // Both sides are known, do the actual computation.
      const val = InterpResult.discard_err(this.ecx.binary_op(op, left._0, right._0));
      if (val !== undefined) {
        // Ideally this would return an Immediate, since it's sometimes
        // a pair and sometimes not. But as a hack we always return a pair
        // and just make the 2nd component `Bottom` when it does not exist.
        if (val.layout.backend_repr.$ === "ScalarPair") {
          const [v, overflow] = interpret.Immediate.to_scalar_pair(val.imm);
          return [FlatSet.Elem(v), FlatSet.Elem(overflow)];
        } else {
          return [FlatSet.Elem(interpret.Immediate.to_scalar(val.imm)), FlatSet.Bottom];
        }
      } else {
        return [FlatSet.Top, FlatSet.Top];
      }
    } else if (left.$ === "Elem" || right.$ === "Elem") {
      // Exactly one side is known, attempt some algebraic simplifications.
      const const_arg = left.$ === "Elem" ? left._0 : (right as { _0: ImmTy })._0;
      const layout = const_arg.layout;
      if (!BackendRepr.is_scalar(layout.backend_repr)) {
        return [FlatSet.Top, FlatSet.Top];
      }

      const arg_scalar = interpret.Immediate.to_scalar(const_arg.imm);
      const arg_value = InterpResult.discard_err(Scalar.to_bits(arg_scalar, layout.size));
      if (arg_value === undefined) {
        return [FlatSet.Top, FlatSet.Top];
      }

      if (op === "BitAnd" && arg_value === 0n) {
        return [FlatSet.Elem(arg_scalar), FlatSet.Bottom];
      } else if (op === "BitOr" && (arg_value === layout.size.truncate((1n << 128n) - 1n) || (layout.ty.is_bool() && arg_value === 1n))) {
        return [FlatSet.Elem(arg_scalar), FlatSet.Bottom];
      } else if (op === "Mul" && layout.ty.is_integral() && arg_value === 0n) {
        return [FlatSet.Elem(arg_scalar), FlatSet.Elem(Scalar.from_bool<CtfeProvenance>(false))];
      } else {
        return [FlatSet.Top, FlatSet.Top];
      }
    } else {
      // (FlatSet::Top, FlatSet::Top)
      return [FlatSet.Top, FlatSet.Top];
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:623 eval_operand
  eval_operand(op: Operand, state: ConstState): FlatSet<ImmTy> {
    const h = this.handle_operand(op);
    const value = h.$ === "Value" ? h._0 : State.get_idx(state, h._0, this.map, SCALAR_LATTICE);
    return FlatSet.and_then(value, (scalar) => {
      const ty = OperandC.ty(op, this.local_decls, this.tcx);
      const layout = this.tcx.layout_of(this.typing_env.as_query_input(ty));
      return layout.$ === "Ok" ? FlatSet.Elem(interpret.ImmTy.from_scalar(scalar, layout._0)) : FlatSet.Top;
    });
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:640 eval_discriminant
  eval_discriminant(enum_ty: Ty, variant_index: VariantIdx): Scalar | undefined {
    if (!enum_ty.is_enum()) {
      return undefined;
    }
    const enum_ty_layout = this.tcx.layout_of(this.typing_env.as_query_input(enum_ty));
    if (enum_ty_layout.$ !== "Ok") return undefined;
    const discr_value = InterpResult.discard_err(this.ecx.discriminant_for_variant(enum_ty_layout._0.ty, variant_index));
    if (discr_value === undefined) return undefined;
    return interpret.Immediate.to_scalar(discr_value.imm);
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:650 wrap_immediate
  wrap_immediate(imm: Immediate): FlatSet<Scalar> {
    switch (imm.$) {
      case "Scalar":
        return FlatSet.Elem(imm._0);
      case "Uninit":
        return FlatSet.Bottom;
      default:
        return FlatSet.Top;
    }
  }
}

/** `self.tcx.layout_of(..usize..).unwrap()` failing (`Result::unwrap` on `Err`). */
function panic_unwrap_layout(): never {
  return bug("called `Result::unwrap()` on an `Err` value: layout of `usize`");
}

/** `(Location, Place)` key of `Patch::before_effect` (header). */
function before_effect_key(location: Location, place: Place): string {
  return `${location.block}:${location.statement_index}:${place.local}:${place.projection.id}`;
}

/** `Location` key of `Patch::assignments` (header). */
function location_key(location: Location): string {
  return `${location.block}:${location.statement_index}`;
}

// rustc-type: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:683 Patch
class Patch extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,

    /// For a given MIR location, this stores the values of the operands used by that location. In
    /// particular, this is before the effect, such that the operands of `_1 = _1 + _2` are
    /// properly captured. (This may become UB soon, but it is currently emitted even by safe code.)
    public before_effect: globalThis.Map<string, Const>,

    /// Stores the assigned values for assignments where the Rvalue is constant.
    public assignments: globalThis.Map<string, Const>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:696 new
  static new(tcx: TyCtxt): Patch {
    return new Patch(tcx, new globalThis.Map(), new globalThis.Map());
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:700 make_operand
  make_operand(const_: Const): Operand {
    return { $: "Constant", _0: new ConstOperand(DUMMY_SP, undefined, clone_Const(const_)) };
  }

  // ---- impl<'tcx> MutVisitor<'tcx> for Patch<'tcx> ----

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:929 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:933 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const value = this.assignments.get(location_key(location));
    if (value !== undefined) {
      const kind = statement.kind;
      if (kind.$ === "Assign") {
        const rvalue = kind._0[1];
        const old_retag = rvalue.$ === "Use" ? rvalue._1 : "Yes";
        kind._0[1] = { $: "Use", _0: this.make_operand(value), _1: old_retag };
      } else {
        bug("found assignment info for non-assign statement");
      }
    } else {
      this.super_statement(statement, location);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:950 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    switch (operand.$) {
      case "Copy":
      case "Move": {
        const place = operand._0;
        const value = this.before_effect.get(before_effect_key(location, place));
        if (value !== undefined) {
          replace_in_place<Operand>(operand, this.make_operand(value));
        } else if (!(place.projection.length === 0)) {
          this.super_operand(operand, location);
        }
        break;
      }
      case "Constant":
      case "RuntimeChecks":
        break;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:963 process_projection_elem
  override process_projection_elem(elem: PlaceElem, _location: Location): PlaceElem | undefined {
    if (elem.$ === "Index") {
      const local = elem._0;
      const offset_ = this.before_effect.get(before_effect_key(_location, Place_from_Local(local)));
      if (offset_ === undefined) return undefined;
      const offset_s = Const.try_to_scalar(offset_);
      if (offset_s === undefined) return undefined;
      const offset = InterpResult.discard_err(Scalar.to_target_usize(offset_s, this.tcx_));
      if (offset === undefined) return undefined;
      if (!(offset < 0xffff_ffff_ffff_ffffn)) return undefined;
      const min_length = offset + 1n;
      return { $: "ConstantIndex", offset: Number(offset), min_length: Number(min_length), from_end: false };
    } else {
      return undefined;
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:705 Collector
class Collector extends ResultsVisitorBase<ConstState, ConstAnalysis> {
  constructor(
    public patch: Patch,
    public local_decls: LocalDecl[],
    public ecx: InterpCx<DummyMachine>,
    public map: Map,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:713 new
  static new(tcx: TyCtxt, body: Body, map: Map): Collector {
    return new Collector(
      Patch.new(tcx),
      body.local_decls,
      interpret.InterpCx.new(tcx, DUMMY_SP, body.typing_env(tcx), new const_eval.DummyMachine()),
      map,
    );
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:723 try_make_constant
  try_make_constant(place_: Place, state: ConstState): Const | undefined {
    const ty = place_.ty(this.local_decls, this.patch.tcx_).ty;
    const layout_ = this.ecx.layout_of(ty);
    if (layout_.$ !== "Ok") return undefined;
    const layout = layout_._0;

    if (layout.is_zst()) {
      return Const.zero_sized(ty);
    }

    if (layout.is_unsized()) {
      return undefined;
    }

    const place = this.map.find(place_.as_ref());
    if (place === undefined) return undefined;
    if (BackendRepr.is_scalar(layout.backend_repr)) {
      const value = propagatable_scalar(place, state, this.map);
      if (value !== undefined) {
        return { $: "Val", _0: { $: "Scalar", _0: value }, _1: ty };
      }
    }

    if (layout.backend_repr.$ === "Scalar" || layout.backend_repr.$ === "ScalarPair") {
      const alloc_id = InterpResult.discard_err(
        this.ecx.intern_with_temp_alloc(layout, (ecx, dest) => try_write_constant(ecx as InterpCx<DummyMachine>, dest, place, ty, state, this.map)),
      );
      if (alloc_id === undefined) return undefined;
      return { $: "Val", _0: { $: "Indirect", alloc_id, offset: Size.ZERO }, _1: ty };
    }

    return undefined;
  }

  // ---- impl<'tcx> ResultsVisitor<'tcx, ConstAnalysis<'_, 'tcx>> for Collector<'_, 'tcx> ----

  // #[instrument(level = "trace", skip(self, statement))]
  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:884 visit_after_early_statement_effect
  override visit_after_early_statement_effect(state: ConstState, statement: Statement, location: Location): void {
    const kind = statement.kind;
    if (kind.$ === "Assign") {
      const rvalue = kind._0[1];
      new OperandCollector(state, this).visit_rvalue(rvalue, location);
    }
  }

  // #[instrument(level = "trace", skip(self, statement))]
  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:899 visit_after_primary_statement_effect
  override visit_after_primary_statement_effect(state: ConstState, statement: Statement, location: Location): void {
    const kind = statement.kind;
    if (kind.$ === "Assign" && kind._0[1].$ === "Use" && kind._0[1]._0.$ === "Constant") {
      // Don't overwrite the assignment if it already uses a constant (to keep the span).
    } else if (kind.$ === "Assign") {
      const place = kind._0[0];
      const value = this.try_make_constant(place, state);
      if (value !== undefined) {
        this.patch.assignments.set(location_key(location), value);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:918 visit_after_early_terminator_effect
  override visit_after_early_terminator_effect(state: ConstState, terminator: Terminator, location: Location): void {
    new OperandCollector(state, this).visit_terminator(terminator, location);
  }
}

// #[instrument(level = "trace", skip(map), ret)]
// rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:761 propagatable_scalar
function propagatable_scalar(place: PlaceIndex, state: ConstState, map: Map): Scalar | undefined {
  const value = State.get_idx(state, place, map, SCALAR_LATTICE);
  if (value.$ === "Elem" && Scalar.try_to_scalar_int(value._0).$ === "Ok") {
    // Do not attempt to propagate pointers, as we may fail to preserve their identity.
    return value._0;
  } else {
    return undefined;
  }
}

/** `throw_machine_stop_str!(msg)` (dummy_machine.rs; expanded inline, see that module). */
function throw_machine_stop_str(msg: string): InterpResult<undefined> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: new const_eval.Zst(msg) }));
}

// #[instrument(level = "trace", skip(ecx, state, map), ret)]
// rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:777 try_write_constant
function try_write_constant(ecx: InterpCx<DummyMachine>, dest: PlaceTy, place: PlaceIndex, ty: Ty, state: ConstState, map: Map): InterpResult<undefined> {
  const layout_r = ecx.layout_of(ty);
  if (layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout_r._0));
  const layout: TyAndLayout = layout_r._0;

  // Fast path for ZSTs.
  if (layout.is_zst()) {
    return interp_ok(undefined);
  }

  // Fast path for scalars.
  if (BackendRepr.is_scalar(layout.backend_repr)) {
    const value = propagatable_scalar(place, state, map);
    if (value !== undefined) {
      return ecx.write_immediate({ $: "Scalar", _0: value }, dest);
    }
  }

  const k = ty.kind();
  switch (k.$) {
    // ZSTs. Nothing to do.
    case "FnDef":
      break;

    // Those are scalars, must be handled above.
    case "Bool":
    case "Int":
    case "Uint":
    case "Float":
    case "Char":
      return throw_machine_stop_str("primitive type with provenance");

    case "Tuple": {
      const elem_tys = k._0;
      for (let i_ = 0; i_ < elem_tys.length; i_++) {
        const elem = elem_tys[i_]!;
        const i = FieldIdx.from_usize(i_);
        const field = map.apply(place, { $: "Field", _0: i });
        if (field === undefined) {
          return throw_machine_stop_str("missing field in tuple");
        }
        const field_dest = ecx.project_field(dest, i);
        if (field_dest.$ === "Err") return field_dest;
        const r = try_write_constant(ecx, field_dest._0, field, elem, state, map);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Adt": {
      const [def, args] = [k._0, k._1];
      if (def.is_union()) {
        return throw_machine_stop_str("cannot propagate unions");
      }

      let variant_idx: VariantIdx;
      let variant_def;
      let variant_place: PlaceIndex;
      let variant_dest: PlaceTy;
      if (def.is_enum()) {
        const discr = map.apply(place, TrackElemC.Discriminant);
        if (discr === undefined) {
          return throw_machine_stop_str("missing discriminant for enum");
        }
        const dv = State.get_idx(state, discr, map, SCALAR_LATTICE);
        if (!(dv.$ === "Elem" && dv._0.$ === "Int")) {
          return throw_machine_stop_str("discriminant with provenance");
        }
        const discr_ = dv._0._0;
        const discr_bits = discr_.to_bits(discr_.size());
        let found: VariantIdx | undefined;
        for (const [v, var_] of def.discriminants(ecx.tcx.deref())) {
          if (discr_bits === var_.val) {
            found = v;
            break;
          }
        }
        if (found === undefined) {
          return throw_machine_stop_str("illegal discriminant for enum");
        }
        const variant = found;
        const vp = map.apply(place, { $: "Variant", _0: variant });
        if (vp === undefined) {
          return throw_machine_stop_str("missing variant for enum");
        }
        const vd = ecx.project_downcast(dest, variant);
        if (vd.$ === "Err") return vd;
        [variant_idx, variant_def, variant_place, variant_dest] = [variant, def.variant(variant), vp, vd._0];
      } else {
        [variant_idx, variant_def, variant_place, variant_dest] = [FIRST_VARIANT, def.non_enum_variant(), place, dest];
      }

      for (let i_ = 0; i_ < variant_def.fields.length; i_++) {
        const i = FieldIdx.from_usize(i_);
        const field_def = variant_def.fields[i_]!;
        const ty_ = Unnormalized.skip_norm_wip(field_def.ty(ecx.tcx.deref(), args));
        const field = map.apply(variant_place, { $: "Field", _0: i });
        if (field === undefined) {
          return throw_machine_stop_str("missing field in ADT");
        }
        const field_dest = ecx.project_field(variant_dest, i);
        if (field_dest.$ === "Err") return field_dest;
        const r = try_write_constant(ecx, field_dest._0, field, ty_, state, map);
        if (r.$ === "Err") return r;
      }
      const w = ecx.write_discriminant(variant_idx, dest);
      if (w.$ === "Err") return w;
      break;
    }

    // Unsupported for now.
    case "Array":
    case "Pat":

    // Do not attempt to support indirection in constants.
    case "Ref":
    case "RawPtr":
    case "FnPtr":
    case "Str":
    case "Slice":

    case "Never":
    case "Foreign":
    case "Alias":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "Dynamic":
    case "UnsafeBinder":
      return throw_machine_stop_str("unsupported type");

    case "Error":
    case "Infer":
    case "CoroutineWitness":
      return bug();
  }

  return interp_ok(undefined);
}

// rustc-type: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:980 OperandCollector
class OperandCollector extends Visitor {
  constructor(
    public state: ConstState,
    public visitor: Collector,
  ) {
    super();
  }

  // ---- impl<'tcx> Visitor<'tcx> for OperandCollector<'_, '_, 'tcx> ----

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:986 visit_projection_elem
  override visit_projection_elem(_: PlaceRef, elem: PlaceElem, _1: PlaceContext, location: Location): void {
    if (elem.$ === "Index") {
      const local = elem._0;
      const value = this.visitor.try_make_constant(Place_from_Local(local), this.state);
      if (value !== undefined) {
        this.visitor.patch.before_effect.set(before_effect_key(location, Place_from_Local(local)), value);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/dataflow_const_prop.rs:1000 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    const place = OperandC.place(operand);
    if (place !== undefined) {
      const value = this.visitor.try_make_constant(place, this.state);
      if (value !== undefined) {
        this.visitor.patch.before_effect.set(before_effect_key(location, place), value);
      } else if (!(place.projection.length === 0)) {
        // Try to propagate into `Index` projections.
        this.super_operand(operand, location);
      }
    }
  }
}
