// Port of compiler/rustc_mir_transform/src/cost_checker.rs (lane mt-inline).
//
// PORT: `CostChecker` `extends Visitor` (mir/visit.ts, D4); its `tcx` field is `tcx_`, as the cleanup passes' visitors.
// PORT: `#[derive(Clone)]` is not ported (nothing clones a `CostChecker` here).
import {
  AssertKind,
  type Body,
  debug_TerminatorKind,
  type Location,
  Operand,
  type Statement,
  type Terminator,
} from "../rustc_middle/mir/mod.ts";
import { Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { bug } from "../rustc_span/macros.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { unreachable } from "../std/panic.ts";

const INSTR_COST = 5;
const CALL_PENALTY = 25;
const LANDINGPAD_PENALTY = 50;
const RESUME_PENALTY = 45;
const LARGE_SWITCH_PENALTY = 20;
const CONST_SWITCH_BONUS = 10;

/// Verify that the callee body is compatible with the caller.
// #[derive(Clone)]
// rustc-type: compiler/rustc_mir_transform/src/cost_checker.rs:15 CostChecker
export class CostChecker extends Visitor {
  constructor(
    public tcx_: TyCtxt,
    public typing_env: TypingEnv,
    public penalty: number,
    public bonus: number,
    public callee_body: Body,
    public instance: Instance | undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/cost_checker.rs:25 new
  static new(tcx: TyCtxt, typing_env: TypingEnv, instance: Instance | undefined, callee_body: Body): CostChecker {
    return new CostChecker(tcx, typing_env, 0, 0, callee_body, instance);
  }

  /// Add function-level costs not well-represented by the block-level costs.
  ///
  /// Needed because the `CostChecker` is used sometimes for just blocks,
  /// and even the full `Inline` doesn't call `visit_body`, so there's nowhere
  /// to put this logic in the visitor.
  // rustc: compiler/rustc_mir_transform/src/cost_checker.rs:39 add_function_level_costs
  add_function_level_costs(): void {
    // If the only has one Call (or similar), inlining isn't increasing the total
    // number of calls, so give extra encouragement to inlining that.
    if (this.callee_body.basic_blocks.basic_blocks.filter((bbd) => is_call_like(bbd.terminator_())).length === 1) {
      this.bonus += CALL_PENALTY;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/cost_checker.rs:49 cost
  cost(): number {
    // usize::saturating_sub
    return Math.max(0, this.penalty - this.bonus);
  }

  // rustc: compiler/rustc_mir_transform/src/cost_checker.rs:53 instantiate_ty
  instantiate_ty(v: Ty): Ty {
    const instance = this.instance;
    if (instance !== undefined) {
      return Instance.instantiate_mir(instance, this.tcx_, EarlyBinder.bind(this.tcx_, v, fold_Ty), fold_Ty);
    } else {
      return v;
    }
  }

  // impl<'tcx> Visitor<'tcx> for CostChecker<'_, 'tcx>

  // rustc: compiler/rustc_mir_transform/src/cost_checker.rs:63 visit_operand
  override visit_operand(operand: Operand, _: Location): void {
    switch (operand.$) {
      case "RuntimeChecks": {
        if (operand._0 === "UbChecks") {
          if (!(this.tcx_.sess.opts.unstable_opts.inline_mir_preserve_debug ?? this.tcx_.sess.ub_checks())) {
            // If this is in optimized MIR it's because it's used later, so if we don't need UB
            // checks this session, give a bonus here to offset the cost of the call later.
            this.bonus += CALL_PENALTY;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/cost_checker.rs:83 visit_statement
  override visit_statement(statement: Statement, loc: Location): void {
    // Most costs are in rvalues and terminators, not in statements.
    const kind = statement.kind;
    switch (kind.$) {
      case "Intrinsic": {
        const ndi = kind._0;
        switch (ndi.$) {
          case "Assume":
            this.penalty += INSTR_COST;
            break;
          case "CopyNonOverlapping":
            this.penalty += CALL_PENALTY;
            break;
        }
        break;
      }
      case "Assign":
        this.penalty += INSTR_COST;
        break;
      default:
        break;
    }
    this.super_statement(statement, loc);
  }

  // rustc: compiler/rustc_mir_transform/src/cost_checker.rs:98 visit_terminator
  override visit_terminator(terminator: Terminator, loc: Location): void {
    const kind = terminator.kind;
    switch (kind.$) {
      case "Drop": {
        const { place, unwind } = kind;
        // If the place doesn't actually need dropping, treat it like a regular goto.
        const ty = this.instantiate_ty(place.ty(this.callee_body, this.tcx_).ty);
        if (ty.needs_drop(this.tcx_, this.typing_env)) {
          this.penalty += CALL_PENALTY;
          if (unwind.$ === "Cleanup") {
            this.penalty += LANDINGPAD_PENALTY;
          }
        }
        break;
      }
      case "Call": {
        const { func, unwind } = kind;
        let def: ReturnType<typeof Operand.const_fn_def>;
        this.penalty +=
          (def = Operand.const_fn_def(func)) !== undefined && this.tcx_.intrinsic(def[0]) !== undefined
            ? // Don't give intrinsics the extra penalty for calls
              INSTR_COST
            : CALL_PENALTY;
        if (unwind.$ === "Cleanup") {
          this.penalty += LANDINGPAD_PENALTY;
        }
        break;
      }
      case "TailCall": {
        this.penalty += CALL_PENALTY;
        break;
      }
      case "SwitchInt": {
        const { discr, targets } = kind;
        if (discr.$ === "Constant" || discr.$ === "RuntimeChecks") {
          // Not only will this become a `Goto`, but likely other
          // things will be removable as unreachable.
          this.bonus += CONST_SWITCH_BONUS;
        } else if (targets.all_targets().length > 3) {
          // More than false/true/unreachable gets extra cost.
          this.penalty += LARGE_SWITCH_PENALTY;
        } else {
          this.penalty += INSTR_COST;
        }
        break;
      }
      case "Assert": {
        const { unwind, msg } = kind;
        this.penalty +=
          AssertKind.is_optional_overflow_check(msg) &&
          !(this.tcx_.sess.opts.unstable_opts.inline_mir_preserve_debug ?? this.tcx_.sess.overflow_checks())
            ? INSTR_COST
            : CALL_PENALTY;
        if (unwind.$ === "Cleanup") {
          this.penalty += LANDINGPAD_PENALTY;
        }
        break;
      }
      case "UnwindResume":
        this.penalty += RESUME_PENALTY;
        break;
      case "InlineAsm": {
        const { unwind } = kind;
        this.penalty += INSTR_COST;
        if (unwind.$ === "Cleanup") {
          this.penalty += LANDINGPAD_PENALTY;
        }
        break;
      }
      case "Unreachable": {
        this.bonus += INSTR_COST;
        break;
      }
      case "Goto":
      case "Return":
        break;
      case "UnwindTerminate":
        break;
      case "FalseUnwind":
      case "FalseEdge":
      case "Yield":
      case "CoroutineDrop": {
        bug(`${format_debug(kind, debug_TerminatorKind, PLAIN)} should not be in runtime MIR`);
      }
    }
    this.super_terminator(terminator, loc);
  }
}

/// A terminator that's more call-like (might do a bunch of work, might panic, etc)
/// than it is goto-/return-like (no side effects, etc).
///
/// Used to treat multi-call functions (which could inline exponentially)
/// different from those that only do one or none of these "complex" things.
// rustc: compiler/rustc_mir_transform/src/cost_checker.rs:184 is_call_like
export function is_call_like(terminator: Terminator): boolean {
  switch (terminator.kind.$) {
    case "Call":
    case "TailCall":
    case "Drop":
    case "Assert":
    case "InlineAsm":
      return true;

    case "Goto":
    case "SwitchInt":
    case "UnwindResume":
    case "UnwindTerminate":
    case "Return":
    case "Unreachable":
      return false;

    case "Yield":
    case "CoroutineDrop":
    case "FalseEdge":
    case "FalseUnwind":
      return unreachable();
  }
}
