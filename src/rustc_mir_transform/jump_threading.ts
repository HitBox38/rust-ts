// Port of compiler/rustc_mir_transform/src/jump_threading.rs (lane mt-opt2-c).
//
// PORT: `Condition` and `EdgeEffect` are `Copy` values held by value in `Vec`s; here they are plain objects that are
// never mutated in place: `ConditionSet::retain_mut` / `for_each_mut` and `EdgeEffect::replace_block` store a modified
// copy into the slot (`for_each_mut`'s `f` gets a fresh copy of the condition to mutate), so the derived `Clone` of
// `ConditionSet` is a copy of its arrays. `FxIndexSet<Condition>` is a `Map` from the condition's derived `Hash` + `Eq`
// (rust_ts/intern_key.ts `intern_key`) to its insertion index; `FxHashMap<(BasicBlock, ConditionIndex), BasicBlock>`
// is keyed `${bb}:${condition}`. `ConditionIndex` is a `newtype_index!` (`_c{}`, only printed by `trace!`). The derived
// `Ord` of `EdgeEffect` (variant order, then the fields) is `EdgeEffect_cmp`. `u8` costs: `saturating_add` is
// `u8_saturating_add`, `usize::try_into::<u8>()` is a range check. `IndexVec<BasicBlock, _>` / `IndexVec<ConditionIndex,
// _>` are arrays; `usize` counters stay `number` (a `predecessors[s] -= 1` below zero is negative here and wraps
// upstream, which both compare unequal to every count and to 0).
// PORT: `value_analysis::Map` (rustc_mir_dataflow value_analysis.ts) is a stub at this base (lane mt-opt2-a), so every
// run stops at `Map::new` until that lands.
//! A jump threading optimization.
//!
//! This optimization seeks to replace join-then-switch control flow patterns by straight jumps
//!    X = 0                                      X = 0
//! ------------\      /--------              ------------
//!    X = 1     X----X SwitchInt(X)     =>       X = 1
//! ------------/      \--------              ------------
//!
//!
//! This implementation is heavily inspired by the work outlined in [libfirm].
//!
//! The general algorithm proceeds in two phases: (1) walk the CFG backwards to construct a
//! graph of threading conditions, and (2) propagate fulfilled conditions forward by duplicating
//! blocks.
//!
//! # 1. Condition graph construction
//!
//! In this file, we denote as `place ?= value` the existence of a replacement condition
//! on `place` with given `value`, irrespective of the polarity and target of that
//! replacement condition.
//!
//! Inside a block, we associate with each condition `c` a set of targets:
//! - `Goto(target)` if fulfilling `c` changes the terminator into a `Goto { target }`;
//! - `Chain(target, c2)` if fulfilling `c` means that `c2` is fulfilled inside `target`.
//!
//! Before walking a block `bb`, we construct the exit set of condition from its successors.
//! For each condition `c` in a successor `s`, we record that fulfilling `c` in `bb` will fulfill
//! `c` in `s`, as a `Chain(s, c)` condition.
//!
//! When encountering a `switchInt(place) -> [value: bb...]` terminator, we also record a
//! `place == value` condition for each `value`, and associate a `Goto(target)` condition.
//!
//! Then, we walk the statements backwards, transforming the set of conditions along the way,
//! resulting in a set of conditions at the block entry.
//!
//! We try to avoid creating irreducible control-flow by not threading through a loop header.
//!
//! Applying the optimisation can create a lot of new MIR, so we bound the instruction
//! cost by `MAX_COST`.
//!
//! # 2. Block duplication
//!
//! We now have the set of fulfilled conditions inside each block and their targets.
//!
//! For each block `bb` in reverse postorder, we apply in turn the target associated with each
//! fulfilled condition:
//! - for `Goto(target)`, change the terminator of `bb` into a `Goto { target }`;
//! - for `Chain(target, cond)`, duplicate `target` into a new block which fulfills the same
//! conditions and also fulfills `cond`. This is made efficient by maintaining a map of duplicates,
//! `duplicate[(target, cond)]` to avoid cloning blocks multiple times.
//!
//! [libfirm]: <https://pp.ipd.kit.edu/uploads/publikationen/priesner17masterarbeit.pdf>
import { FieldIdx } from "../rustc_abi/layout.ts";
import { const_eval, interpret } from "../rustc_const_eval/lib.ts";
import type { DummyMachine } from "../rustc_const_eval/const_eval/dummy_machine.ts";
import { type ImmTy, type InterpCx, type OpTy } from "../rustc_const_eval/interpret/mod.ts";
import { OpTy_from_ImmTy, OpTy_from_MPlaceTy } from "../rustc_const_eval/interpret/operand.ts";
import { DenseBitSet, GrowableBitSet } from "../rustc_index/bit_set.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import { InterpResult } from "../rustc_middle/mir/interpret/mod.ts";
import {
  type BasicBlock,
  type BasicBlockData,
  type Body,
  clone_BasicBlockData,
  Const,
  Operand,
  type Place,
  Place_from_Local,
  RETURN_PLACE,
  type Rvalue,
  START_BLOCK,
  type Statement,
  type SwitchTargets,
  TerminatorKind,
  traversal,
} from "../rustc_middle/mir/mod.ts";
import { ScalarInt, ScalarInt_eq } from "../rustc_middle/ty/consts/int.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { Map as ValueMap, type PlaceIndex, TrackElem, type ValueIndex } from "../rustc_mir_dataflow/value_analysis.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { unwrap_result } from "../std/result.ts";
import { CostChecker } from "./cost_checker.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { debug_TerminatorKind } from "../rustc_middle/mir/pretty.ts";

/** `a.saturating_add(b)` on `u8`. */
function u8_saturating_add(a: number, b: number): number {
  return Math.min(a + b, 0xff);
}

// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:73 JumpThreading
export class JumpThreading extends MirPass {
  readonly type_name = "rustc_mir_transform::jump_threading::JumpThreading";

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:78 policy
  policy(ctx: PassCtx): PassPolicy {
    // Jump threading can duplicate calls in control-flow.
    // This leads to incorrect code when done for so called "convergent" operations on GPU
    // targets, similar to how inline assembly cannot be duplicated on all targets.
    // Conservatively prevent this by disabling the pass.
    // See also issue #137086.
    return PassPolicy.optional(ctx.mir_opt_level() >= 2 && !ctx.deref().target.is_like_gpu);
  }

  // #[instrument(skip_all level = "debug")]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:88 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const def_id = body.source.def_id();
    // debug!(?def_id);

    // Optimizing coroutines creates query cycles.
    if (tcx.is_coroutine(def_id)) {
      // trace!("Skipped for coroutine {:?}", def_id);
      return;
    }

    const typing_env = body.typing_env(tcx);
    const finder = new TOFinder(
      tcx,
      typing_env,
      interpret.InterpCx.new(tcx, DUMMY_SP, typing_env, new const_eval.DummyMachine()),
      body,
      ValueMap.new(tcx, body, { $: "OnDemand" }),
      maybe_loop_headers(body),
      body.basic_blocks.deref().map(() => ConditionSet.default_()),
    );

    for (const [bb, bbdata] of traversal.postorder(body)) {
      if (bbdata.is_cleanup) {
        continue;
      }

      const state = finder.populate_from_outgoing_edges(bb);
      // trace!("output_states[{bb:?}] = {state:?}");

      finder.process_terminator(bb, state);
      // trace!("pre_terminator_states[{bb:?}] = {state:?}");

      for (let i = bbdata.statements.length - 1; i >= 0; i--) {
        const stmt = bbdata.statements[i]!;
        if (state.is_empty()) {
          break;
        }

        finder.process_statement(stmt, state);

        // When a statement mutates a place, assignments to that place that happen
        // above the mutation cannot fulfill a condition.
        //   _1 = 5 // Whatever happens here, it won't change the result of a `SwitchInt`.
        //   _1 = 6
        const m = finder.mutated_statement(stmt);
        if (m !== undefined) {
          const [lhs, tail] = m;
          finder.flood_state(lhs, tail, state);
        }
      }

      // trace!("entry_states[{bb:?}] = {state:?}");
      finder.entry_states[bb] = state;
    }

    const entry_states = finder.entry_states;
    simplify_conditions(body, entry_states);
    remove_costly_conditions(tcx, typing_env, body, entry_states);

    const opportunities = OpportunitySet.new(body, entry_states);
    if (opportunities !== undefined) {
      opportunities.apply();
    }
  }
}

// const MAX_COST: u8 = 100; (jump_threading.rs:75)
const MAX_COST = 100;

// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:150 TOFinder
class TOFinder {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public ecx: InterpCx<DummyMachine>,
    public body: Body,
    public map: ValueMap,
    public maybe_loop_headers: DenseBitSet<BasicBlock>,
    /// This stores the state of each visited block on entry,
    /// and the current state of the block being visited.
    // Invariant: for each `bb`, each condition in `entry_states[bb]` has a `chain` that
    // starts with `bb`.
    public entry_states: ConditionSet[],
  ) {}

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:278 place
  place(place: Place, tail: TrackElem | undefined): PlaceIndex | undefined {
    return this.map.register_place(this.tcx, this.body, place, tail);
  }

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:282 value
  value(place: PlaceIndex): ValueIndex | undefined {
    return this.map.register_value(this.tcx, this.typing_env, place);
  }

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:286 place_value
  place_value(place_: Place, tail: TrackElem | undefined): ValueIndex | undefined {
    const place = this.place(place_, tail);
    if (place === undefined) return undefined;
    return this.value(place);
  }

  /// Construct the condition set for `bb` from the terminator, without executing its effect.
  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:293 populate_from_outgoing_edges
  populate_from_outgoing_edges(bb: BasicBlock): ConditionSet {
    const bbdata = this.body.basic_blocks.deref()[bb]!;

    // This should be the first time we populate `entry_states[bb]`.
    // debug_assert!(self.entry_states[bb].is_empty());

    const state = new ConditionSet([], [], []);

    // Use an index-set to deduplicate conditions coming from different successor blocks.
    const known_conditions = new globalThis.Map<string, ConditionIndex>();
    const insert = (condition: Condition, succ_block: BasicBlock, succ_condition: ConditionIndex): void => {
      const key = intern_key(condition);
      let index = known_conditions.get(key);
      const new_ = index === undefined;
      if (index === undefined) {
        index = ConditionIndex.from_usize(known_conditions.size);
        known_conditions.set(key, index);
      }
      if (new_) {
        state.active.push([index, condition]);
        state.targets.push([]);
        // debug_assert_eq!(_index, index);
      }
      const target: EdgeEffect = { $: "Chain", succ_block, succ_condition };
      // debug_assert!(!state.targets[index].contains(&target), ..);
      state.targets[index]!.push(target);
    };

    // A given block may have several times the same successor.
    const seen = new Set<BasicBlock>();
    for (const succ of bbdata.terminator_().successors()) {
      if (seen.has(succ)) {
        continue;
      }
      seen.add(succ);

      // Do not thread through loop headers.
      if (this.maybe_loop_headers.contains(succ)) {
        continue;
      }

      for (const [succ_index, cond] of this.entry_states[succ]!.active) {
        insert(cond, succ, succ_index);
      }
    }

    // let num_conditions = known_conditions.len();
    // debug_assert_eq!(num_conditions, state.active.len());
    // debug_assert_eq!(num_conditions, state.targets.len());
    // state.fulfilled.reserve(num_conditions);

    return state;
  }

  /// Remove all conditions in the state that alias given place.
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:353 flood_state
  flood_state(place: Place, extra_elem: TrackElem | undefined, state: ConditionSet): void {
    if (state.is_empty()) {
      return;
    }
    const places_to_exclude = new Set<ValueIndex>();
    this.map.for_each_aliasing_place(place.as_ref(), extra_elem, (vi) => {
      places_to_exclude.add(vi);
    });
    // trace!(?places_to_exclude, "flood_state");
    if (places_to_exclude.size === 0) {
      return;
    }
    state.retain((c) => !places_to_exclude.has(c.place));
  }

  /// Extract the mutated place from a statement.
  ///
  /// This method returns the `Place` so we can flood the state in case of a partial assignment.
  ///     (_1 as Ok).0 = _5;
  ///     (_1 as Err).0 = _6;
  /// We want to ensure that a `SwitchInt((_1 as Ok).0)` does not see the first assignment, as
  /// the value may have been mangled by the second assignment.
  ///
  /// In case we assign to a discriminant, we return `Some(TrackElem::Discriminant)`, so we can
  /// stop at flooding the discriminant, and preserve the variant fields.
  ///     (_1 as Some).0 = _6;
  ///     SetDiscriminant(_1, 1);
  ///     switchInt((_1 as Some).0)
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:387 mutated_statement
  mutated_statement(stmt: Statement): [Place, TrackElem | undefined] | undefined {
    const kind = stmt.kind;
    switch (kind.$) {
      case "Assign":
        return [kind._0[0], undefined];
      case "SetDiscriminant":
        return [kind.place, TrackElem.Discriminant];
      case "StorageLive":
      case "StorageDead":
        return [Place_from_Local(kind._0), undefined];
      case "Intrinsic":
      // copy_nonoverlapping takes pointers and mutated the pointed-to value.
      case "AscribeUserType":
      case "Coverage":
      case "FakeRead":
      case "ConstEvalCounter":
      case "PlaceMention":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        return undefined;
    }
  }

  // #[instrument(level = "trace", skip(self, state))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:413 process_immediate
  process_immediate(lhs_: PlaceIndex, rhs: ImmTy, state: ConditionSet): void {
    const lhs = this.value(lhs_);
    if (lhs !== undefined && rhs.imm.$ === "Scalar" && rhs.imm._0.$ === "Int") {
      state.fulfill_matches(lhs, rhs.imm._0._0);
    }
  }

  /// If we expect `lhs ?= A`, we have an opportunity if we assume `constant == A`.
  // #[instrument(level = "trace", skip(self, state))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:423 process_constant
  process_constant(lhs: PlaceIndex, constant: OpTy, state: ConditionSet): void {
    this.map.for_each_projection_value<OpTy>(
      lhs,
      constant,
      (elem, op) => {
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
            const layout = unwrap_result(this.ecx.layout_of(this.tcx.types.usize));
            return OpTy_from_ImmTy(interpret.ImmTy.from_uint(len_usize, layout));
          }
        }
      },
      (place_, op) => {
        const place = this.map.value(place_);
        if (place === undefined) return;
        const imm_ = InterpResult.discard_err(this.ecx.read_immediate_raw(op));
        if (imm_ === undefined) return;
        if (imm_.$ !== "Right") return;
        const imm = imm_._0;
        if (imm.imm.$ === "Scalar" && imm.imm._0.$ === "Int") {
          state.fulfill_matches(place, imm.imm._0._0);
        }
      },
    );
  }

  // #[instrument(level = "trace", skip(self, state))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:461 process_copy
  process_copy(lhs: PlaceIndex, rhs: PlaceIndex, state: ConditionSet): void {
    const renames = new globalThis.Map<ValueIndex, ValueIndex>();
    this.map.register_copy_tree(
      lhs, // tree to copy
      rhs, // tree to build
      (lhs, rhs) => {
        renames.set(lhs, rhs);
      },
    );
    state.for_each_mut((c) => {
      const rhs = renames.get(c.place);
      if (rhs !== undefined) {
        c.place = rhs;
      }
    });
  }

  // #[instrument(level = "trace", skip(self, state))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:478 process_operand
  process_operand(lhs: PlaceIndex, rhs_: Operand, state: ConditionSet): void {
    switch (rhs_.$) {
      // If we expect `lhs ?= A`, we have an opportunity if we assume `constant == A`.
      case "Constant": {
        const constant_ = rhs_._0;
        const constant = InterpResult.discard_err(this.ecx.eval_mir_constant(constant_.const_, constant_.span, undefined));
        if (constant === undefined) {
          return;
        }
        this.process_constant(lhs, constant, state);
        break;
      }
      // Transfer the conditions on the copied rhs.
      case "Move":
      case "Copy": {
        const rhs = this.place(rhs_._0, undefined);
        if (rhs === undefined) return;
        this.process_copy(lhs, rhs, state);
        break;
      }
      case "RuntimeChecks":
        break;
    }
  }

  // #[instrument(level = "trace", skip(self, state))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:499 process_assign
  process_assign(lhs_place: Place, rvalue: Rvalue, state: ConditionSet): void {
    const lhs = this.place(lhs_place, undefined);
    if (lhs === undefined) return;
    switch (rvalue.$) {
      case "Use":
        this.process_operand(lhs, rvalue._0, state);
        return;
      // Transfer the conditions on the copy rhs.
      case "Discriminant": {
        const rhs = this.place(rvalue._0, TrackElem.Discriminant);
        if (rhs === undefined) return;
        this.process_copy(lhs, rhs, state);
        return;
      }
      // If we expect `lhs ?= A`, we have an opportunity if we assume `constant == A`.
      case "Aggregate": {
        const kind = rvalue._0;
        const operands = rvalue._1;
        const agg_ty = lhs_place.ty(this.body, this.tcx).ty;
        let lhs_: PlaceIndex;
        if (kind.$ === "Adt" && kind._4 !== undefined) {
          // Do not support unions.
          return;
        } else if (kind.$ === "Adt" && agg_ty.is_enum()) {
          const variant_index = kind._1;
          const discr_ty = agg_ty.discriminant_ty(this.tcx);
          const discr_target = this.map.register_place_index(discr_ty, lhs, TrackElem.Discriminant);
          const discr_value = InterpResult.discard_err(this.ecx.discriminant_for_variant(agg_ty, variant_index));
          if (discr_value !== undefined) {
            this.process_immediate(discr_target, discr_value, state);
          }
          lhs_ = this.map.register_place_index(agg_ty, lhs, { $: "Variant", _0: variant_index });
        } else {
          lhs_ = lhs;
        }
        operands.forEach((operand, i) => {
          const field_index = FieldIdx.from_usize(i);
          const operand_ty = Operand.ty(operand, this.body, this.tcx);
          const field = this.map.register_place_index(operand_ty, lhs_, { $: "Field", _0: field_index });
          this.process_operand(field, operand, state);
        });
        return;
      }
      // Transfer the conditions on the copy rhs, after inverting the value of the condition.
      case "UnaryOp": {
        if (!(rvalue._0 === "Not" && (rvalue._1.$ === "Move" || rvalue._1.$ === "Copy"))) return;
        const operand_ = rvalue._1._0;
        const layout = unwrap_result(this.ecx.layout_of(operand_.ty(this.body, this.tcx).ty));
        const lhs_ = this.value(lhs);
        if (lhs_ === undefined) return;
        const operand = this.place_value(operand_, undefined);
        if (operand === undefined) return;
        state.retain_mut((c) => {
          if (c.place === lhs_) {
            const v = InterpResult.discard_err(this.ecx.unary_op("Not", interpret.ImmTy.from_scalar_int(c.value, layout)));
            if (v === undefined) return undefined;
            const value = InterpResult.discard_err(v.to_scalar_int());
            if (value === undefined) return undefined;
            c.place = operand;
            c.value = value;
          }
          return c;
        });
        return;
      }
      // We expect `lhs ?= A`. We found `lhs = Eq(rhs, B)`.
      // Create a condition on `rhs ?= B`.
      case "BinaryOp": {
        const op = rvalue._0;
        const [a, b] = rvalue._1;
        let operand_: Place;
        let value_: Operand & { $: "Constant" };
        if ((a.$ === "Move" || a.$ === "Copy") && b.$ === "Constant") {
          operand_ = a._0;
          value_ = b;
        } else if (a.$ === "Constant" && (b.$ === "Move" || b.$ === "Copy")) {
          operand_ = b._0;
          value_ = a;
        } else {
          return;
        }
        const value0 = value_._0;
        let equals: ScalarInt;
        switch (op) {
          case "Eq":
            equals = ScalarInt.TRUE;
            break;
          case "Ne":
            equals = ScalarInt.FALSE;
            break;
          default:
            return;
        }
        if (Const.ty(value0.const_).is_floating_point()) {
          // Floating point equality does not follow bit-patterns.
          // -0.0 and NaN both have special rules for equality,
          // and therefore we cannot use integer comparisons for them.
          // Avoid handling them, though this could be extended in the future.
          return;
        }
        const lhs_ = this.value(lhs);
        if (lhs_ === undefined) return;
        const operand = this.place_value(operand_, undefined);
        if (operand === undefined) return;
        const value = Const.try_eval_scalar_int(value0.const_, this.tcx, this.typing_env);
        if (value === undefined) {
          return;
        }
        state.for_each_mut((c) => {
          if (c.place === lhs_) {
            const polarity: Polarity = Condition.matches(c, lhs_, equals) ? "Eq" : "Ne";
            c.place = operand;
            c.value = value;
            c.polarity = polarity;
          }
        });
        return;
      }

      default:
        return;
    }
  }

  // #[instrument(level = "trace", skip(self, state))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:606 process_statement
  process_statement(stmt: Statement, state: ConditionSet): void {
    // Below, `lhs` is the return value of `mutated_statement`,
    // the place to which `conditions` apply.

    const kind = stmt.kind;
    switch (kind.$) {
      // If we expect `discriminant(place) ?= A`,
      // we have an opportunity if `variant_index ?= A`.
      case "SetDiscriminant": {
        const { place, variant_index } = kind;
        const discr_target = this.place(place, TrackElem.Discriminant);
        if (discr_target === undefined) {
          return;
        }
        const enum_ty = place.ty(this.body, this.tcx).ty;
        // `SetDiscriminant` guarantees that the discriminant is now `variant_index`.
        // Even if the discriminant write does nothing due to niches, it is UB to set the
        // discriminant when the data does not encode the desired discriminant.
        const discr = InterpResult.discard_err(this.ecx.discriminant_for_variant(enum_ty, variant_index));
        if (discr === undefined) {
          return;
        }
        this.process_immediate(discr_target, discr, state);
        return;
      }
      // If we expect `lhs ?= true`, we have an opportunity if we assume `lhs == true`.
      case "Intrinsic": {
        const intr = kind._0;
        if (!(intr.$ === "Assume" && (intr._0.$ === "Copy" || intr._0.$ === "Move"))) return;
        const place = this.place_value(intr._0._0, undefined);
        if (place === undefined) return;
        state.fulfill_matches(place, ScalarInt.TRUE);
        return;
      }
      case "Assign":
        this.process_assign(kind._0[0], kind._0[1], state);
        return;
      default:
        return;
    }
  }

  /// Execute the terminator for block `bb` into state `entry_states[bb]`.
  // #[instrument(level = "trace", skip(self, state))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:642 process_terminator
  process_terminator(bb: BasicBlock, state: ConditionSet): void {
    const term = this.body.basic_blocks.deref()[bb]!.terminator_();
    const kind = term.kind;
    let place_to_flood: Place | undefined;
    switch (kind.$) {
      // Disallowed during optimizations.
      case "FalseEdge":
      case "FalseUnwind":
      case "Yield":
        // PORT: `{term:?}`: the message prints the kind (`Terminator`'s derived Debug is not ported).
        return bug(`${format_debug(kind, debug_TerminatorKind, PLAIN)} invalid`);
      // Cannot reason about inline asm.
      case "InlineAsm":
        state.active.length = 0;
        return;
      // `SwitchInt` is handled specially.
      case "SwitchInt":
        return this.process_switch_int(kind.discr, kind.targets, state);
      // These do not modify memory.
      case "UnwindResume":
      case "UnwindTerminate":
      case "Return":
      case "Unreachable":
      case "CoroutineDrop":
      // Assertions can be no-op at codegen time, so treat them as such.
      case "Assert":
      case "Goto":
        place_to_flood = undefined;
        break;
      // Flood the overwritten place, and progress through.
      case "Drop":
        place_to_flood = kind.place;
        break;
      case "Call":
        place_to_flood = kind.destination;
        break;
      case "TailCall":
        place_to_flood = Place_from_Local(RETURN_PLACE);
        break;
    }

    // This terminator modifies `place_to_flood`, cleanup the associated conditions.
    if (place_to_flood !== undefined) {
      this.flood_state(place_to_flood, undefined, state);
    }
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:680 process_switch_int
  process_switch_int(discr_: Operand, targets: SwitchTargets, state: ConditionSet): void {
    const discr = Operand.place(discr_);
    if (discr === undefined) return;
    const discr_idx = this.place_value(discr, undefined);
    if (discr_idx === undefined) return;

    const discr_ty = discr.ty(this.body, this.tcx).ty;
    const discr_layout_ = this.ecx.layout_of(discr_ty);
    if (discr_layout_.$ !== "Ok") return;
    const discr_layout = discr_layout_._0;

    // Attempt to fulfill a condition using an outgoing branch's condition.
    // Only support the case where there are no duplicated outgoing edges.
    if (targets.is_distinct()) {
      for (const [index, c] of state.active) {
        if (c.place !== discr_idx) {
          continue;
        }

        // Set of blocks `t` such that the edge `bb -> t` fulfills `c`.
        const edges_fulfilling_condition = new Set<BasicBlock>();

        // On edge `bb -> tgt`, we know that `discr_idx == branch`.
        for (const [branch_, tgt] of targets.iter()) {
          const branch = ScalarInt.try_from_uint(branch_, discr_layout.size);
          if (branch !== undefined && Condition.matches(c, discr_idx, branch)) {
            edges_fulfilling_condition.add(tgt);
          }
        }

        // On edge `bb -> otherwise`, we only know that `discr` is different from all the
        // constants in the switch. That's much weaker information than the equality we
        // had in the previous arm. All we can conclude is that the replacement condition
        // `discr != value` can be threaded, and nothing else.
        if (c.polarity === "Ne") {
          const value = c.value.to_bits(discr_layout.size);
          if (targets.all_values().includes(value)) {
            edges_fulfilling_condition.add(targets.otherwise());
          }
        }

        // Register that jumping to a `t` fulfills condition `c`.
        // This does *not* mean that `c` is fulfilled in this block: inserting `index` in
        // `fulfilled` is wrong if we have targets that jump to other blocks.
        const condition_targets = state.targets[index]!;

        const new_edges: EdgeEffect[] = condition_targets.filter((target) => {
          switch (target.$) {
            case "Goto":
              return false;
            case "Chain":
              return edges_fulfilling_condition.has(target.succ_block);
          }
        });

        if (new_edges.length === condition_targets.length) {
          // If `new_edges == condition_targets`, do not bother creating a new
          // `ConditionIndex`, we can use the existing one.
          state.fulfilled.push(index);
        } else {
          // Fulfilling `index` may thread conditions that we do not want,
          // so create a brand new index to immediately mark fulfilled.
          const index = ConditionIndex.from_usize(state.targets.push(new_edges) - 1);
          state.fulfilled.push(index);
        }
      }
    }

    // Introduce additional conditions of the form `discr ?= value` for each value in targets.
    const mk_condition = (value: ScalarInt, polarity: Polarity, target: BasicBlock): void => {
      const c: Condition = { place: discr_idx, value, polarity };
      state.push_condition(c, target);
    };
    const static_if = targets.as_static_if();
    if (static_if !== undefined) {
      const [value_, then_, else_] = static_if;
      // We have an `if`, generate both `discr == value` and `discr != value`.
      const value = ScalarInt.try_from_uint(value_, discr_layout.size);
      if (value === undefined) return;
      mk_condition(value, "Eq", then_);
      mk_condition(value, "Ne", else_);
    } else {
      // We have a general switch and we cannot express `discr != value0 && discr != value1`,
      // so we only generate equality predicates.
      for (const [value_, target] of targets.iter()) {
        const value = ScalarInt.try_from_uint(value_, discr_layout.size);
        if (value !== undefined) {
          mk_condition(value, "Eq", target);
        }
      }
    }
  }
}

// rustc_index::newtype_index! {
//     #[orderable]
//     #[debug_format = "_c{}"]
//     struct ConditionIndex {}
// }
// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:167 ConditionIndex
type ConditionIndex = number & { readonly __brand: "ConditionIndex" };
const ConditionIndex = newtype_index<ConditionIndex>((n) => `_c${n}`);

/// Represent the following statement. If we can prove that the current local is equal/not-equal
/// to `value`, jump to `target`.
// #[derive(Copy, Clone, Debug, Hash, Eq, PartialEq)]
// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:173 Condition
interface Condition {
  place: ValueIndex;
  value: ScalarInt;
  polarity: Polarity;
}

// #[derive(Copy, Clone, Debug, Hash, Eq, PartialEq)]
// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:180 Polarity
type Polarity = "Ne" | "Eq";

const Condition = {
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:186 matches
  matches(self: Condition, place: ValueIndex, value: ScalarInt): boolean {
    return self.place === place && ScalarInt_eq(self.value, value) === (self.polarity === "Eq");
  },
};

/// Represent the effect of fulfilling a condition.
// #[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:193 EdgeEffect
type EdgeEffect =
  /// If the condition is fulfilled, replace the current block's terminator by a single goto.
  | { readonly $: "Goto"; readonly target: BasicBlock }
  /// If the condition is fulfilled, fulfill the condition `succ_condition` in `succ_block`.
  | { readonly $: "Chain"; readonly succ_block: BasicBlock; readonly succ_condition: ConditionIndex };

const EdgeEffect = {
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:201 block
  block(self: EdgeEffect): BasicBlock {
    switch (self.$) {
      case "Goto":
        return self.target;
      case "Chain":
        return self.succ_block;
    }
  },

  /** PORT: `&mut self` -> returns the updated value, which the caller stores back into the slot (header). */
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:207 replace_block
  replace_block(self: EdgeEffect, target: BasicBlock, new_target: BasicBlock): EdgeEffect {
    switch (self.$) {
      case "Goto":
        if (self.target === target) {
          return { $: "Goto", target: new_target };
        }
        return self;
      case "Chain":
        if (self.succ_block === target) {
          return { $: "Chain", succ_block: new_target, succ_condition: self.succ_condition };
        }
        return self;
    }
  },
};

/** Derived `Ord` of `EdgeEffect`: variant order (`Goto` < `Chain`), then the fields in order. */
function EdgeEffect_cmp(a: EdgeEffect, b: EdgeEffect): number {
  if (a.$ !== b.$) return a.$ === "Goto" ? -1 : 1;
  if (a.$ === "Goto" && b.$ === "Goto") return a.target - b.target;
  if (a.$ === "Chain" && b.$ === "Chain") return a.succ_block !== b.succ_block ? a.succ_block - b.succ_block : a.succ_condition - b.succ_condition;
  return 0;
}

/** Derived `PartialEq` of `EdgeEffect`. */
function EdgeEffect_eq(a: EdgeEffect, b: EdgeEffect): boolean {
  return EdgeEffect_cmp(a, b) === 0;
}

/** `targets.sort(); targets.dedup();` */
function sort_dedup(targets: EdgeEffect[]): EdgeEffect[] {
  targets.sort(EdgeEffect_cmp);
  const out: EdgeEffect[] = [];
  for (const t of targets) {
    if (out.length === 0 || !EdgeEffect_eq(out[out.length - 1]!, t)) out.push(t);
  }
  return out;
}

// #[derive(Clone, Debug, Default)]
// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:219 ConditionSet
class ConditionSet {
  constructor(
    public active: [ConditionIndex, Condition][],
    public fulfilled: ConditionIndex[],
    public targets: EdgeEffect[][],
  ) {}

  /** `ConditionSet::default()`. */
  static default_(): ConditionSet {
    return new ConditionSet([], [], []);
  }

  /** `#[derive(Clone)]` (the `Condition`s / `EdgeEffect`s are never mutated in place, see the header). */
  clone(): ConditionSet {
    return new ConditionSet(this.active.slice(), this.fulfilled.slice(), this.targets.map((t) => t.slice()));
  }

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:226 is_empty
  is_empty(): boolean {
    return this.active.length === 0;
  }

  // #[tracing::instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:231 push_condition
  push_condition(c: Condition, target: BasicBlock): void {
    const index = ConditionIndex.from_usize(this.targets.push([{ $: "Goto", target }]) - 1);
    this.active.push([index, c]);
  }

  /// Register fulfilled condition and remove it from the set.
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:237 fulfill_if
  fulfill_if(f: (c: Condition, targets: EdgeEffect[]) => boolean): void {
    this.active = this.active.filter(([index, condition]) => {
      const targets = this.targets[index]!;
      if (f(condition, targets)) {
        // trace!(?index, ?condition, "fulfill");
        this.fulfilled.push(index);
        return false;
      } else {
        return true;
      }
    });
  }

  /// Register fulfilled condition and remove them from the set.
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:251 fulfill_matches
  fulfill_matches(place: ValueIndex, value: ScalarInt): void {
    this.fulfill_if((c, _) => Condition.matches(c, place, value));
  }

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:255 retain
  retain(f: (c: Condition) => boolean): void {
    this.active = this.active.filter(([, c]) => f(c));
  }

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:259 retain_mut
  retain_mut(f: (c: Condition) => Condition | undefined): void {
    const out: [ConditionIndex, Condition][] = [];
    for (const [index, c] of this.active) {
      const new_ = f({ ...c });
      if (new_ !== undefined) {
        out.push([index, new_]);
      }
    }
    this.active = out;
  }

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:270 for_each_mut
  for_each_mut(f: (c: Condition) => void): void {
    for (let i = 0; i < this.active.length; i++) {
      const [index, c0] = this.active[i]!;
      const c = { ...c0 };
      f(c);
      this.active[i] = [index, c];
    }
  }
}

/// Propagate fulfilled conditions forward in the CFG to reduce the amount of duplication.
// #[instrument(level = "debug", skip(body, entry_states))]
// rustc: compiler/rustc_mir_transform/src/jump_threading.rs:776 simplify_conditions
function simplify_conditions(body: Body, entry_states: ConditionSet[]): void {
  const basic_blocks = body.basic_blocks;
  const reverse_postorder = basic_blocks.reverse_postorder();

  // Start by computing the number of *incoming edges* for each block.
  // We do not use the cached `basic_blocks.predecessors` as we only want reachable predecessors.
  const predecessors: number[] = new Array<number>(entry_states.length).fill(0);
  predecessors[START_BLOCK] = 1; // Account for the implicit entry edge.
  for (const bb of reverse_postorder) {
    const term = basic_blocks.deref()[bb]!.terminator_();
    for (const s of term.successors()) {
      predecessors[s]! += 1;
    }
  }

  // Compute the number of edges into each block that carry each condition.
  const fulfill_in_pred_count: number[][] = entry_states.map((state) => new Array<number>(state.targets.length).fill(0));

  // By traversing in RPO, we increase the likelihood to visit predecessors before successors.
  for (const bb of reverse_postorder) {
    const preds = predecessors[bb]!;
    // trace!(?bb, ?preds);

    // We have removed all the input edges towards this block. Just skip visiting it.
    if (preds === 0) {
      continue;
    }

    const state = entry_states[bb]!;
    // trace!(?state);

    // Conditions that are fulfilled in all the predecessors, are fulfilled in `bb`.
    // trace!(fulfilled_count = ?fulfill_in_pred_count[bb]);
    fulfill_in_pred_count[bb]!.forEach((cond_preds, condition) => {
      if (cond_preds === preds) {
        // trace!(?condition);
        state.fulfilled.push(condition as ConditionIndex);
      }
    });

    // We want to count how many times each condition is fulfilled,
    // so ensure we are not counting the same edge twice.
    let targets: EdgeEffect[] = state.fulfilled.flatMap((index) => state.targets[index]!.slice());
    targets = sort_dedup(targets);
    // trace!(?targets);

    // We may modify the set of successors by applying edges, so track them here.
    let successors: BasicBlock[] = [...basic_blocks.deref()[bb]!.terminator_().successors()];

    targets.reverse();
    let target: EdgeEffect | undefined;
    while ((target = targets.pop()) !== undefined) {
      switch (target.$) {
        case "Goto": {
          const target_ = target.target;
          // We update the count of predecessors. If target or any successor has not been
          // processed yet, this increases the likelihood we find something relevant.
          predecessors[target_]! += 1;
          for (const s of successors) {
            predecessors[s]! -= 1;
          }
          // Only process edges that still exist.
          targets = targets.filter((t) => EdgeEffect.block(t) === target_);
          successors = [];
          successors.push(target_);
          break;
        }
        case "Chain": {
          const { succ_block, succ_condition } = target;
          // `predecessors` is the number of incoming *edges* in each block.
          // Count the number of edges that apply `succ_condition` into `succ_block`.
          const count = successors.filter((s) => s === succ_block).length;
          fulfill_in_pred_count[succ_block]![succ_condition]! += count;
          break;
        }
      }
    }
  }
}

// #[instrument(level = "debug", skip(tcx, typing_env, body, entry_states))]
// rustc: compiler/rustc_mir_transform/src/jump_threading.rs:860 remove_costly_conditions
function remove_costly_conditions(tcx: TyCtxt, typing_env: TypingEnv, body: Body, entry_states: ConditionSet[]): void {
  const basic_blocks = body.basic_blocks;

  const costs: (number | undefined)[] = new Array<number | undefined>(basic_blocks.deref().length).fill(undefined);
  const cost = (bb: BasicBlock): number => {
    let c = costs[bb];
    if (c === undefined) {
      const bbdata = basic_blocks.deref()[bb]!;
      const cost = CostChecker.new(tcx, typing_env, undefined, body);
      cost.visit_basic_block_data(bb, bbdata);
      const v = cost.cost();
      // `try_into::<u8>().unwrap_or(MAX_COST)`
      c = v <= 0xff ? v : MAX_COST;
      costs[bb] = c;
    }
    // trace!("cost[{bb:?}] = {c}");
    return c;
  };

  // Initialize costs with `MAX_COST`: if we have a cycle, the cyclic `bb` has infinite costs.
  const condition_cost: number[][] = entry_states.map((state) => new Array<number>(state.targets.length).fill(MAX_COST));

  const reverse_postorder = basic_blocks.reverse_postorder();

  for (let i = reverse_postorder.length - 1; i >= 0; i--) {
    const bb = reverse_postorder[i]!;
    const state = entry_states[bb]!;
    // trace!(?bb, ?state);

    const current_costs: number[] = new Array<number>(state.targets.length).fill(0);

    state.targets.forEach((targets, condition) => {
      for (const target of targets) {
        switch (target.$) {
          // A `Goto` has cost 0.
          case "Goto":
            break;
          case "Chain": {
            const { succ_block, succ_condition } = target;
            // Chaining into an already-fulfilled condition is nop.
            if (entry_states[succ_block]!.fulfilled.includes(succ_condition)) {
              break;
            }
            // When chaining, use `cost[succ_block][succ_condition] + cost(succ_block)`.
            // Cost associated with duplicating `succ_block`.
            const duplication_cost = cost(succ_block);
            // Cost associated with the rest of the chain.
            const target_cost = condition_cost[succ_block]![succ_condition] ?? MAX_COST;
            const cost_ = u8_saturating_add(u8_saturating_add(current_costs[condition]!, duplication_cost), target_cost);
            // trace!(?condition, ?succ_block, ?duplication_cost, ?target_cost);
            current_costs[condition] = cost_;
            break;
          }
        }
      }
    });

    // trace!("condition_cost[{bb:?}] = {:?}", current_costs);
    condition_cost[bb] = current_costs;
  }

  // trace!(?condition_cost);

  for (const bb of reverse_postorder) {
    const targets_ = entry_states[bb]!.targets;
    targets_.forEach((targets, index) => {
      if (condition_cost[bb]![index]! >= MAX_COST) {
        // trace!(?bb, ?index, ?targets, c = ?condition_cost[bb][index], "remove");
        targets.length = 0;
      }
    });
  }
}

// rustc-type: compiler/rustc_mir_transform/src/jump_threading.rs:935 OpportunitySet
class OpportunitySet {
  constructor(
    public basic_blocks: BasicBlockData[],
    public entry_states: ConditionSet[],
    /// Cache duplicated block. When cloning a basic block `bb` to fulfill a condition `c`,
    /// record the target of this `bb with c` edge.
    // PORT: keyed `${bb}:${c}`.
    public duplicates: globalThis.Map<string, BasicBlock>,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:944 new
  static new(body: Body, entry_states: ConditionSet[]): OpportunitySet | undefined {
    // trace!(def_id = ?body.source.def_id(), "apply");

    if (entry_states.every((state) => state.fulfilled.length === 0)) {
      return undefined;
    }

    // Free some memory, because we will need to clone condition sets.
    for (const state of entry_states) {
      state.active = [];
    }
    const duplicates = new globalThis.Map<string, BasicBlock>();
    const basic_blocks = body.basic_blocks.as_mut();
    return new OpportunitySet(basic_blocks, entry_states, duplicates);
  }

  /// Apply the opportunities on the graph.
  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:965 apply
  apply(): void {
    const worklist: BasicBlock[] = [];
    worklist.push(START_BLOCK);

    // Use a `GrowableBitSet` and not a `DenseBitSet` as we are adding blocks.
    const visited = GrowableBitSet.with_capacity<BasicBlock>(this.basic_blocks.length);

    let bb: BasicBlock | undefined;
    while ((bb = worklist.pop()) !== undefined) {
      if (!visited.insert(bb)) {
        continue;
      }

      this.apply_once(bb);

      // `apply_once` may have modified the terminator of `bb`.
      // Only visit actual successors.
      worklist.push(...this.basic_blocks[bb]!.terminator_().successors());
    }
  }

  /// Apply the opportunities on `bb`.
  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:987 apply_once
  apply_once(bb: BasicBlock): void {
    const state = this.entry_states[bb]!;
    // trace!(?state);

    // We are modifying the `bb` in-place. Once a `EdgeEffect` has been applied,
    // it does not need to be applied again.
    let targets: EdgeEffect[] = state.fulfilled.flatMap((index) => {
      const t = state.targets[index]!;
      state.targets[index] = [];
      return t;
    });
    targets = sort_dedup(targets);
    // trace!(?targets);

    // Use a while-pop to allow modifying `targets` from inside the loop.
    targets.reverse();
    let target: EdgeEffect | undefined;
    while ((target = targets.pop()) !== undefined) {
      // debug!(?target);
      // trace!(term = ?self.basic_blocks[bb].terminator().kind);

      // By construction, `target.block()` is a successor of `bb`.
      // When applying targets, we may change the set of successors.
      // The match below updates the set of targets for consistency.
      // debug_assert!(self.basic_blocks[bb].terminator().successors().contains(&target.block()), ..);

      switch (target.$) {
        case "Goto": {
          const target_ = target.target;
          this.apply_goto(bb, target_);

          // We now have `target` as single successor. Drop all other target blocks.
          targets = targets.filter((t) => EdgeEffect.block(t) === target_);
          // Also do this on targets that may be applied by a duplicate of `bb`.
          const ets = this.entry_states[bb]!.targets;
          for (let i = 0; i < ets.length; i++) {
            ets[i] = ets[i]!.filter((t) => EdgeEffect.block(t) === target_);
          }
          break;
        }
        case "Chain": {
          const { succ_block, succ_condition } = target;
          const new_succ_block = this.apply_chain(bb, succ_block, succ_condition);

          // We have a new name for `target`, ensure it is correctly applied.
          if (new_succ_block !== undefined) {
            for (let i = 0; i < targets.length; i++) {
              targets[i] = EdgeEffect.replace_block(targets[i]!, succ_block, new_succ_block);
            }
            // Also do this on targets that may be applied by a duplicate of `bb`.
            for (const ts of this.entry_states[bb]!.targets) {
              for (let i = 0; i < ts.length; i++) {
                ts[i] = EdgeEffect.replace_block(ts[i]!, succ_block, new_succ_block);
              }
            }
          }
          break;
        }
      }

      // trace!(post_term = ?self.basic_blocks[bb].terminator().kind);
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:1051 apply_goto
  apply_goto(bb: BasicBlock, target: BasicBlock): void {
    this.basic_blocks[bb]!.terminator_mut().kind = TerminatorKind.goto(target);
  }

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/jump_threading.rs:1056 apply_chain
  apply_chain(bb: BasicBlock, target: BasicBlock, condition: ConditionIndex): BasicBlock | undefined {
    if (this.entry_states[target]!.fulfilled.includes(condition)) {
      // `target` already fulfills `condition`, so we do not need to thread anything.
      // trace!("fulfilled");
      return undefined;
    }

    // We may be tempted to modify `target` in-place to avoid a clone. This is wrong.
    // We may still have edges from other blocks to `target` that have not been created yet.
    // For instance because we may be threading an edge coming from `bb`,
    // or `target` may be a block duplicate for which we may still create predecessors.

    const key = `${target}:${condition}`;
    let new_target = this.duplicates.get(key);
    if (new_target === undefined) {
      // If we already have a duplicate of `target` which fulfills `condition`, reuse it.
      // Otherwise, we clone a new bb to such ends.
      new_target = (this.basic_blocks.push(clone_BasicBlockData(this.basic_blocks[target]!)) - 1) as BasicBlock;
      // trace!(?target, ?new_target, ?condition, "clone");

      // By definition, `new_target` fulfills the same condition as `target`, with
      // `condition` added.
      const condition_set = this.entry_states[target]!.clone();
      condition_set.fulfilled.push(condition);
      this.entry_states.push(condition_set);
      // debug_assert_eq!(new_target, _new_target);

      this.duplicates.set(key, new_target);
    }
    // trace!(?target, ?new_target, ?condition, "reuse");

    // Replace `target` by `new_target` where it appears.
    // This changes exactly `direct_count` edges.
    const nt = new_target;
    this.basic_blocks[bb]!.terminator_mut().successors_mut((s) => {
      if (s.value === target) {
        s.value = nt;
      }
    });

    return new_target;
  }
}

/// Compute the set of loop headers in the given body. A loop header is usually defined as a block
/// which dominates one of its predecessors. This definition is only correct for reducible CFGs.
/// However, computing dominators is expensive, so we approximate according to the post-order
/// traversal order. A loop header for us is a block which is visited after its predecessor in
/// post-order. This is ok as we mostly need a heuristic.
// rustc: compiler/rustc_mir_transform/src/jump_threading.rs:1107 maybe_loop_headers
function maybe_loop_headers(body: Body): DenseBitSet<BasicBlock> {
  const maybe_loop_headers = DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length);
  const visited = DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length);
  for (const [bb, bbdata] of traversal.postorder(body)) {
    // Post-order means we visit successors before the block for acyclic CFGs.
    // If the successor is not visited yet, consider it a loop header.
    for (const succ of bbdata.terminator_().successors()) {
      if (!visited.contains(succ)) {
        maybe_loop_headers.insert(succ);
      }
    }

    // Only mark `bb` as visited after we checked the successors, in case we have a self-loop.
    // bb1: goto -> bb1;
    const _new = visited.insert(bb);
    // debug_assert!(_new);
    void _new;
  }

  return maybe_loop_headers;
}
