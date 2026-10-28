// Port of compiler/rustc_mir_transform/src/simplify_comparison_integral.rs (lane mt-opt2-a).
//
// PORT: `Place` is `Copy`: `to_switch_on` is copied into the found info (`*to_switch_on`) and into every operand built
// from it, so each use is a `clone_Place` (no MIR node is shared). `*left = Copy(..)` stores the new operand into the
// `BinaryOp` rvalue's operand tuple. The `filter_map` / `find_map` closures are loops; a `None` from a `find_map`
// closure (incl. via `?`) moves on to the previous statement, as upstream.
import {
  type BasicBlock,
  type BinOp,
  type Body,
  clone_Place,
  clone_SwitchTargets,
  debug_BasicBlock,
  Operand,
  type Place,
  SwitchTargets,
  TerminatorKind,
} from "../rustc_middle/mir/mod.ts";
import { Const as mir_Const } from "../rustc_middle/mir/consts.ts";
import type { Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_LayoutError } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { bug } from "../rustc_span/macros.ts";
import { debug_vec, PLAIN } from "../std/fmt.ts";
import { unreachable, unwrap } from "../std/panic.ts";
import { expect_result } from "../std/result.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import type { SsaLocals } from "./ssa.ts";
import { SsaLocals as SsaLocalsC } from "./ssa.ts";

/// Pass to convert `if` conditions on integrals into switches on the integral.
/// For an example, it turns something like
///
/// ```ignore (MIR)
/// _3 = Eq(move _4, const 43i32);
/// switchInt(_3) -> [false: bb2, otherwise: bb3];
/// ```
///
/// into:
///
/// ```ignore (MIR)
/// switchInt(_4) -> [43i32: bb3, otherwise: bb2];
/// ```
// rustc-type: compiler/rustc_mir_transform/src/simplify_comparison_integral.rs:27 SimplifyComparisonIntegral
export class SimplifyComparisonIntegral extends MirPass {
  readonly type_name = "rustc_mir_transform::simplify_comparison_integral::SimplifyComparisonIntegral";

  // rustc: compiler/rustc_mir_transform/src/simplify_comparison_integral.rs:30 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // rustc: compiler/rustc_mir_transform/src/simplify_comparison_integral.rs:34 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // trace!("Running SimplifyComparisonIntegral on {:?}", body.source);

    const typing_env = body.typing_env(tcx);
    const ssa = SsaLocalsC.new(tcx, body, typing_env);
    const helper = new OptimizationFinder(body);
    const opts = helper.find_optimizations(ssa);
    for (const opt of opts) {
      // trace!("SUCCESS: Applying {:?}", opt);
      // replace terminator with a switchInt that switches on the integer directly
      const bbs = body.basic_blocks_mut();
      const bb = bbs[opt.bb_idx]!;
      let new_value: bigint;
      const s = opt.branch_value_scalar;
      if (s.$ === "Int") {
        const layout = expect_result(
          tcx.layout_of(typing_env.as_query_input(opt.branch_value_ty)),
          "if we have an evaluated constant we must know the layout",
          debug_LayoutError,
        );
        new_value = s._0.to_bits(layout.size);
      } else {
        continue;
      }
      const FALSE = 0n;

      const new_targets = opt.targets;
      const first_value = unwrap(new_targets.iter().next().value)[0];
      const first_is_false_target = first_value === FALSE;
      switch (opt.op) {
        case "Eq": {
          // if the assignment was Eq we want the true case to be first
          if (first_is_false_target) {
            swap(new_targets.all_targets_mut(), 0, 1);
          }
          break;
        }
        case "Ne": {
          // if the assignment was Ne we want the false case to be first
          if (!first_is_false_target) {
            swap(new_targets.all_targets_mut(), 0, 1);
          }
          break;
        }
        default:
          unreachable();
      }

      // if the integer being compared to a const integral is being moved into the
      // comparison, e.g `_2 = Eq(move _3, const 'x');`
      // we want to avoid making a double move later on in the switchInt on _3.
      // So to avoid `switchInt(move _3) -> ['x': bb2, otherwise: bb1];`,
      // we convert the move in the comparison statement to a copy.

      // unwrap is safe as we know this statement is an assign
      const skind = bb.statements[opt.bin_op_stmt_idx]!.kind;
      if (skind.$ !== "Assign") return unwrap(undefined);
      const rhs = skind._0[1];

      if (rhs.$ === "BinaryOp" && rhs._1[0].$ === "Move" && rhs._1[1].$ === "Constant") {
        rhs._1[0] = { $: "Copy", _0: clone_Place(opt.to_switch_on) };
      } else if (rhs.$ === "BinaryOp" && rhs._1[0].$ === "Constant" && rhs._1[1].$ === "Move") {
        rhs._1[1] = { $: "Copy", _0: clone_Place(opt.to_switch_on) };
      }

      const all = new_targets.all_targets();
      if (all.length !== 2) {
        return bug(`expected 2 switch targets, got: ${debug_vec(all, PLAIN, debug_BasicBlock)}`);
      }
      const [bb_cond, bb_otherwise] = [all[0]!, all[1]!];

      const targets = SwitchTargets.new([[new_value, bb_cond]], bb_otherwise);

      const terminator = bb.terminator_mut();
      terminator.kind = { $: "SwitchInt", discr: { $: "Copy", _0: clone_Place(opt.to_switch_on) }, targets };
    }
  }
}

/** `<[T]>::swap`. */
function swap<T>(xs: T[], a: number, b: number): void {
  const t = xs[a]!;
  xs[a] = xs[b]!;
  xs[b] = t;
}

// rustc-type: compiler/rustc_mir_transform/src/simplify_comparison_integral.rs:110 OptimizationFinder
class OptimizationFinder {
  constructor(public body: Body) {}

  // rustc: compiler/rustc_mir_transform/src/simplify_comparison_integral.rs:115 find_optimizations
  find_optimizations(ssa: SsaLocals): OptimizationInfo[] {
    const out: OptimizationInfo[] = [];
    const blocks = this.body.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const bb_idx = i as BasicBlock;
      const bb = blocks[i]!;
      // find switch
      const sw = TerminatorKind.as_switch(bb.terminator_().kind);
      if (sw === undefined) continue;
      const [discr, targets] = sw;
      const place_switched_on = Operand.place(discr);
      if (place_switched_on === undefined) continue;
      // Make sure that the place is not modified.
      if (!ssa.is_ssa(place_switched_on.local) || !place_switched_on.is_stable_offset()) {
        continue;
      }

      // find the statement that assigns the place being switched on
      const found = ((): OptimizationInfo | undefined => {
        for (let stmt_idx = bb.statements.length - 1; stmt_idx >= 0; stmt_idx--) {
          const stmt = bb.statements[stmt_idx]!;
          const kind = stmt.kind;
          if (kind.$ === "Assign" && place_eq(kind._0[0], place_switched_on)) {
            const rhs = kind._0[1];
            if (rhs.$ === "BinaryOp" && (rhs._0 === "Eq" || rhs._0 === "Ne")) {
              const op = rhs._0;
              const [left, right] = rhs._1;
              const info = find_branch_value_info(left, right, ssa);
              if (info === undefined) continue;
              const [branch_value_scalar, branch_value_ty, to_switch_on] = info;

              // The transformation adds a use of `to_switch_on` at the
              // terminator. Both storage markers make the local uninitialized,
              // so either invalidates the value used by the comparison.
              if (
                bb.statements
                  .slice(stmt_idx + 1)
                  .some(
                    (stmt) =>
                      (stmt.kind.$ === "StorageLive" || stmt.kind.$ === "StorageDead") && stmt.kind._0 === to_switch_on.local,
                  )
              ) {
                continue;
              }

              return new OptimizationInfo(bb_idx, stmt_idx, to_switch_on, branch_value_scalar, branch_value_ty, op, clone_SwitchTargets(targets));
            } else {
              continue;
            }
          } else {
            continue;
          }
        }
        return undefined;
      })();
      if (found !== undefined) out.push(found);
    }
    return out;
  }
}

/** PORT: derived `PartialEq` of `mir::Place` (`local` and the interned `projection` list). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

// rustc: compiler/rustc_mir_transform/src/simplify_comparison_integral.rs:174 find_branch_value_info
function find_branch_value_info(left: Operand, right: Operand, ssa: SsaLocals): [Scalar, Ty, Place] | undefined {
  // check that either left or right is a constant.
  // if any are, we can use the other to switch on, and the constant as a value in a switch
  let branch_value;
  let to_switch_on: Place;
  if (left.$ === "Constant" && (right.$ === "Copy" || right.$ === "Move")) {
    branch_value = left._0;
    to_switch_on = right._0;
  } else if ((left.$ === "Copy" || left.$ === "Move") && right.$ === "Constant") {
    to_switch_on = left._0;
    branch_value = right._0;
  } else {
    return undefined;
  }
  // Make sure that the place is not modified.
  if (!ssa.is_ssa(to_switch_on.local) || !to_switch_on.is_stable_offset()) {
    return undefined;
  }
  const branch_value_ty = mir_Const.ty(branch_value.const_);
  // we only want to apply this optimization if we are matching on integrals (and chars),
  // as it is not possible to switch on floats
  if (!branch_value_ty.is_integral() && !branch_value_ty.is_char()) {
    return undefined;
  }
  const branch_value_scalar = mir_Const.try_to_scalar(branch_value.const_);
  if (branch_value_scalar === undefined) return undefined;
  return [branch_value_scalar, branch_value_ty, clone_Place(to_switch_on)];
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_transform/src/simplify_comparison_integral.rs:203 OptimizationInfo
class OptimizationInfo {
  constructor(
    /// Basic block to apply the optimization
    public bb_idx: BasicBlock,
    /// Statement index of Eq/Ne assignment
    public bin_op_stmt_idx: number,
    /// Place that needs to be switched on. This place is of type integral
    public to_switch_on: Place,
    /// Constant to use in switch target value
    public branch_value_scalar: Scalar,
    /// Type of the constant value
    public branch_value_ty: Ty,
    /// Either Eq or Ne
    public op: BinOp,
    /// Current targets used in the switch
    public targets: SwitchTargets,
  ) {}
}
