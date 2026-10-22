// Port of compiler/rustc_mir_transform/src/required_consts.rs (lane mt-skeleton).
import { type Body, clone_ConstOperand, Const, type ConstOperand, type Location } from "../rustc_middle/mir/mod.ts";
import * as traversal from "../rustc_middle/mir/traversal.ts";
import { Visitor } from "../rustc_middle/mir/visit.ts";

// rustc-type: compiler/rustc_mir_transform/src/required_consts.rs:4 RequiredConstsVisitor
export class RequiredConstsVisitor extends Visitor {
  constructor(public required_consts: ConstOperand[]) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/required_consts.rs:9 compute_required_consts
  static compute_required_consts(body: Body): void {
    const visitor = new RequiredConstsVisitor([]);
    for (const [bb, bb_data] of traversal.reverse_postorder(body)) {
      visitor.visit_basic_block_data(bb, bb_data);
    }
    body.set_required_consts(visitor.required_consts);
  }

  // impl<'tcx> Visitor<'tcx> for RequiredConstsVisitor<'tcx>
  // rustc: compiler/rustc_mir_transform/src/required_consts.rs:19 visit_const_operand
  override visit_const_operand(constant: ConstOperand, _: Location): void {
    if (Const.is_required_const(constant.const_)) {
      // `*constant` (`ConstOperand: Copy`)
      this.required_consts.push(clone_ConstOperand(constant));
    }
  }
}
