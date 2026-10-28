//! A pass that propagates the known ranges of SSA locals.
//! We can know the ranges of SSA locals in certain locations for the following code:
//! ```
//! fn foo(a: u32) {
//!   let b = a < 9; // the integer representation of b is within the full range [0, 2).
//!   if b {
//!     let c = b; // c is true since b is within the range [1, 2).
//!     let d = a < 8; // d is true since a is within the range [0, 9).
//!   }
//! }
//! ```
//
// Port of compiler/rustc_mir_transform/src/ssa_range_prop.rs (lane mt-opt2-b).
//
// PORT: `body.basic_blocks.dominators().clone()` shares the `Dominators` object (it is never mutated after it is built,
// and `as_mut_preserves_cfg` keeps the CFG). `FxHashMap<Place, Vec<..>>` (derived `Hash`/`Eq` of `Place`: the local and
// the interned projection list) is a map per local keyed by the projection list's identity. `*operand =
// Operand::Constant(..)` replaces the visited operand object in place (`replace_in_place`). `WrappingRange`'s `u128`s and
// `SwitchTargets`' values are `bigint`; `distinct_targets`' `u64` counts are numbers.
import { WrappingRange } from "../rustc_abi/lib.ts";
import type { Dominators } from "../rustc_data_structures/graph/dominators/mod.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { type CtfeProvenance, Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import {
  AssertKind,
  type BasicBlock,
  BasicBlock as BasicBlockC,
  type Body,
  ConstOperand,
  type LocalDecl,
  type Location,
  type Operand,
  Operand as OperandC,
  type Place,
  type PlaceElem,
  type Statement,
  type Terminator,
} from "../rustc_middle/mir/mod.ts";
import type { Const } from "../rustc_middle/mir/consts.ts";
import { MutVisitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { assert } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { SsaLocals } from "./ssa.ts";

// rustc-type: compiler/rustc_mir_transform/src/ssa_range_prop.rs:25 SsaRangePropagation
export class SsaRangePropagation extends MirPass {
  readonly type_name = "rustc_mir_transform::ssa_range_prop::SsaRangePropagation";

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:28 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:32 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const typing_env = body.typing_env(tcx);
    const ssa = SsaLocals.new(tcx, body, typing_env);
    // Clone dominators because we need them while mutating the body.
    const dominators = body.basic_blocks.dominators();
    const range_set = RangeSet.new(tcx, typing_env, body, ssa, body.local_decls, dominators);

    const reverse_postorder = [...body.basic_blocks.reverse_postorder()];
    for (const bb of reverse_postorder) {
      const data = body.basic_blocks.as_mut_preserves_cfg()[bb]!;
      range_set.visit_basic_block_data(bb, data);
    }
  }
}

/** `FxHashMap<Place<'tcx>, Vec<(Location, WrappingRange)>>` (header). */
type Ranges = Map<number, Map<readonly PlaceElem[], [Location, WrappingRange][]>>;

// rustc-type: compiler/rustc_mir_transform/src/ssa_range_prop.rs:48 RangeSet
class RangeSet extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public typing_env: TypingEnv,
    public ssa: SsaLocals,
    public local_decls: LocalDecl[],
    public dominators: Dominators<BasicBlock>,
    /// Known ranges at each locations.
    public ranges: Ranges,
    /// Determines if the basic block has a single unique predecessor.
    public unique_predecessors: DenseBitSet<BasicBlock>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:61 new
  static new(
    tcx: TyCtxt,
    typing_env: TypingEnv,
    body: Body,
    ssa: SsaLocals,
    local_decls: LocalDecl[],
    dominators: Dominators<BasicBlock>,
  ): RangeSet {
    const predecessors = body.basic_blocks.predecessors();
    const unique_predecessors = DenseBitSet.new_empty<BasicBlock>(body.basic_blocks.deref().length);
    for (let i = 0; i < body.basic_blocks.deref().length; i++) {
      const bb = i as BasicBlock;
      if (predecessors[bb]!.length === 1) {
        unique_predecessors.insert(bb);
      }
    }
    return new RangeSet(tcx, typing_env, ssa, local_decls, dominators, new Map(), unique_predecessors);
  }

  /// Create a new known range at the location.
  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:88 insert_range
  insert_range(place: Place, location: Location, range: WrappingRange): void {
    assert(this.is_ssa(place), "assertion failed: self.is_ssa(place)");
    let by_proj = this.ranges.get(place.local);
    if (by_proj === undefined) {
      by_proj = new Map();
      this.ranges.set(place.local, by_proj);
    }
    let entry = by_proj.get(place.projection);
    if (entry === undefined) {
      entry = [];
      by_proj.set(place.projection, entry);
    }
    entry.push([location, range]);
  }

  /// Get the known range at the location.
  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:94 get_range
  get_range(place: Place, location: Location): WrappingRange | undefined {
    const ranges = this.ranges.get(place.local)?.get(place.projection);
    if (ranges === undefined) {
      return undefined;
    }
    // FIXME: This should use the intersection of all valid ranges.
    const found = ranges.find(([range_loc, _]) => range_loc.dominates(location, this.dominators));
    if (found === undefined) return undefined;
    const [_, range] = found;
    return range;
  }

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:104 try_as_constant
  try_as_constant(place: Place, location: Location): ConstOperand | undefined {
    const range = this.get_range(place, location);
    if (range !== undefined && range.start === range.end) {
      const ty = place.ty(this.local_decls, this.tcx_).ty;
      const layout = this.tcx_.layout_of(this.typing_env.as_query_input(ty));
      if (layout.$ !== "Ok") return undefined;
      const value = { $: "Scalar" as const, _0: Scalar.from_uint<CtfeProvenance>(range.start, layout._0.size) };
      const const_: Const = { $: "Val", _0: value, _1: ty };
      return new ConstOperand(DUMMY_SP, undefined, const_);
    }
    return undefined;
  }

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:121 is_ssa
  is_ssa(place: Place): boolean {
    return this.ssa.is_ssa(place.local) && place.is_stable_offset();
  }

  // ---- impl<'tcx> MutVisitor<'tcx> for RangeSet<'tcx, '_, '_> ----

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:127 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:131 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    // Attempts to simplify an operand to a constant value.
    const place = OperandC.place(operand);
    if (place !== undefined) {
      const const_ = this.try_as_constant(place, location);
      if (const_ !== undefined) {
        replace_in_place<Operand>(operand, { $: "Constant", _0: const_ });
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:140 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    this.super_statement(statement, location);
    const kind = statement.kind;
    if (kind.$ === "Intrinsic" && kind._0.$ === "Assume") {
      const operand = kind._0._0;
      const place = OperandC.place(operand);
      if (place !== undefined && this.is_ssa(place)) {
        const successor = location.successor_within_block();
        const range = new WrappingRange(1n, 1n);
        this.insert_range(place, successor, range);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ssa_range_prop.rs:155 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    this.super_terminator(terminator, location);
    const kind = terminator.kind;
    switch (kind.$) {
      case "Assert": {
        const { cond, expected, target, msg } = kind;
        const place = OperandC.place(cond);
        if (!(place !== undefined && this.is_ssa(place))) break;
        const successor = BasicBlockC.start_location(target);
        if (
          location.strictly_dominates(successor, this.dominators) &&
          // Don't propagate range information from built-in overflow checks,
          // this MIR might be lowered without them!
          !AssertKind.is_optional_overflow_check(msg)
        ) {
          const val = expected ? 1n : 0n;
          const range = new WrappingRange(val, val);
          this.insert_range(place, successor, range);
        }
        break;
      }
      case "SwitchInt": {
        const { discr, targets } = kind;
        const place = OperandC.place(discr);
        if (
          !(
            place !== undefined &&
            this.is_ssa(place) &&
            // Reduce the potential compile-time overhead.
            targets.all_targets().length < 16
          )
        ) {
          break;
        }
        const distinct_targets = new Map<BasicBlock, number>();
        for (const [_, target] of targets.iter()) {
          distinct_targets.set(target, (distinct_targets.get(target) ?? 0) + 1);
        }
        for (const [val, target] of targets.iter()) {
          if (distinct_targets.get(target)! !== 1) {
            // FIXME: For multiple targets, the range can be the union of their values.
            continue;
          }
          const successor = BasicBlockC.start_location(target);
          if (this.unique_predecessors.contains(successor.block)) {
            assert(location.block !== successor.block, () => `assertion \`left != right\` failed\n  left: bb${location.block}\n right: bb${successor.block}`);
            const range = new WrappingRange(val, val);
            this.insert_range(place, successor, range);
          }
        }

        // FIXME: The range for the otherwise target be extend to more types.
        // For instance, `val` is within the range [4, 1) at the otherwise target of `matches!(val, 1 | 2 | 3)`.
        const otherwise = BasicBlockC.start_location(targets.otherwise());
        const values = targets.all_values();
        if (place.ty(this.local_decls, this.tcx_).ty.is_bool() && values.length === 1 && this.unique_predecessors.contains(otherwise.block)) {
          const val = values[0]!;
          assert(location.block !== otherwise.block, () => `assertion \`left != right\` failed\n  left: bb${location.block}\n right: bb${otherwise.block}`);
          const range = val === 0n ? new WrappingRange(1n, 1n) : new WrappingRange(0n, 0n);
          this.insert_range(place, otherwise, range);
        }
        break;
      }
      default:
        break;
    }
  }
}
