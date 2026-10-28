// Port of compiler/rustc_mir_transform/src/remove_zsts.rs (lane mt-opt1).
//
// PORT: `*operand = ..` replaces the visited operand object in place (`replace_in_place`). The `Copy` place read out of a
// statement (`place_for_ty`) is only used for its type, so it is not cloned.
//! Removes operations on ZST places, and convert ZST operands to constants.
import {
  type BasicBlock,
  type Body,
  ConstOperand,
  type LocalDecls,
  type Location,
  Operand,
  type Place,
  Place_from_Local,
  Rvalue,
  type Statement,
  type VarDebugInfo,
} from "../rustc_middle/mir/mod.ts";
import { MutVisitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/remove_zsts.rs:10 RemoveZsts
export class RemoveZsts extends MirPass {
  readonly type_name = "rustc_mir_transform::remove_zsts::RemoveZsts";

  // rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:13 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1);
  }

  // rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:17 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // Avoid query cycles (coroutines require optimized MIR for layout).
    // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
    if (Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(body.source.def_id()) as EarlyBinder<Ty>)).is_coroutine()) {
      return;
    }

    const typing_env = body.typing_env(tcx);
    const local_decls = body.local_decls;
    const replacer = new Replacer(tcx, typing_env, local_decls);
    for (const var_debug_info of body.var_debug_info) {
      replacer.visit_var_debug_info(var_debug_info);
    }
    const bbs = body.basic_blocks.as_mut_preserves_cfg();
    for (let bb = 0; bb < bbs.length; bb++) {
      replacer.visit_basic_block_data(bb as BasicBlock, bbs[bb]!);
    }
  }
}

/// A cheap, approximate check to avoid unnecessary `layout_of` calls.
///
/// `Some(true)` is definitely ZST; `Some(false)` is definitely *not* ZST.
///
/// `None` may or may not be, and must check `layout_of` to be sure.
// rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:46 trivially_zst
function trivially_zst(ty: Ty, tcx: TyCtxt): boolean | undefined {
  const k = ty.kind();
  switch (k.$) {
    // definitely ZST
    case "FnDef":
    case "Never":
      return true;
    case "Tuple":
      if (k._0.length === 0) return true;
      return undefined;
    case "Array":
      if (k._1.try_to_target_usize(tcx) === 0n) return true;
      return undefined;
    // clearly not ZST
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "RawPtr":
    case "Ref":
    case "FnPtr":
      return false;
    case "Coroutine": {
      // For async_drop_in_place::{closure} this is load bearing, not just a perf fix,
      // because we don't want to compute the layout before mir analysis is done
      if (tcx.is_async_drop_in_place_coroutine(k._0)) {
        return false;
      } else {
        return undefined;
      }
    }
    // check `layout_of` to see (including unreachable things we won't actually see)
    default:
      return undefined;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/remove_zsts.rs:35 Replacer
class Replacer extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public typing_env: TypingEnv,
    public local_decls: LocalDecls,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:72 known_to_be_zst
  known_to_be_zst(ty: Ty): boolean {
    const is_zst = trivially_zst(ty, this.tcx_);
    if (is_zst !== undefined) {
      return is_zst;
    } else {
      const layout = this.tcx_.layout_of(this.typing_env.as_query_input(ty));
      return layout.$ === "Ok" && layout._0.is_zst();
    }
  }

  // rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:82 make_zst
  make_zst(ty: Ty): ConstOperand {
    // debug_assert!(self.known_to_be_zst(ty));
    return new ConstOperand(DUMMY_SP, undefined, { $: "Val", _0: { $: "ZeroSized" }, _1: ty });
  }

  // rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:93 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:97 visit_var_debug_info
  override visit_var_debug_info(var_debug_info: VarDebugInfo): void {
    const value = var_debug_info.value;
    switch (value.$) {
      case "Const":
        break;
      case "Place": {
        const place = value._0;
        const place_ty = place.ty(this.local_decls, this.tcx_).ty;
        if (this.known_to_be_zst(place_ty)) {
          var_debug_info.value = { $: "Const", _0: this.make_zst(place_ty) };
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:109 visit_operand
  override visit_operand(operand: Operand, _: Location): void {
    if (operand.$ === "Constant") {
      return;
    }
    const op_ty = Operand.ty(operand, this.local_decls, this.tcx_);
    if (this.known_to_be_zst(op_ty)) {
      replace_in_place<Operand>(operand, { $: "Constant", _0: this.make_zst(op_ty) });
    }
  }

  // rustc: compiler/rustc_mir_transform/src/remove_zsts.rs:119 visit_statement
  override visit_statement(statement: Statement, loc: Location): void {
    let place_for_ty: Place | undefined;
    const kind = statement.kind;
    switch (kind.$) {
      case "Assign": {
        const [place, rvalue] = kind._0;
        place_for_ty = Rvalue.is_safe_to_remove(rvalue) ? place : undefined;
        break;
      }
      case "SetDiscriminant":
        place_for_ty = kind.place;
        break;
      case "PlaceMention":
        place_for_ty = kind._0;
        break;
      case "AscribeUserType":
        place_for_ty = kind._0[0];
        break;
      case "FakeRead":
        place_for_ty = kind._0[1];
        break;
      case "StorageLive":
      case "StorageDead":
        place_for_ty = Place_from_Local(kind._0);
        break;
      case "Coverage":
      case "Intrinsic":
      case "Nop":
      case "BackwardIncompatibleDropHint":
      case "ConstEvalCounter":
        place_for_ty = undefined;
        break;
    }
    if (place_for_ty !== undefined && this.known_to_be_zst(place_for_ty.ty(this.local_decls, this.tcx_).ty)) {
      statement.make_nop(true);
    } else {
      this.super_statement(statement, loc);
    }
  }
}
