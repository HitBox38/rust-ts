// Port of compiler/rustc_const_eval/src/util/mod.rs, partial (lane mt-validate, ahead of ctfe-util: the MIR
// `Validator` calls `binop_right_homogeneous`). The three operator classifiers are ported; `context_spans` and the
// modules `caller_location`, `check_validity_requirement` and `type_name` (with their re-exports) are left to
// ctfe-util, which completes this file.
import type { BinOp, UnOp } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";
import * as caller_location from "./caller_location.ts";
export { caller_location };
export { check_validity_requirement, validate_scalar_in_layout } from "./check_validity_requirement.ts";
export { type_name } from "./type_name.ts";

// mod alignment;
// mod compare_types;
export { most_packed_projection, place_unalignment } from "./alignment.ts";
export { relate_types, sub_types } from "./compare_types.ts";

/// Classify whether an operator is "left-homogeneous", i.e., the LHS has the
/// same type as the result.
// #[inline]
// rustc: compiler/rustc_const_eval/src/util/mod.rs:22 binop_left_homogeneous
export function binop_left_homogeneous(op: BinOp): boolean {
  switch (op) {
    case "Add":
    case "AddUnchecked":
    case "Sub":
    case "SubUnchecked":
    case "Mul":
    case "MulUnchecked":
    case "Div":
    case "Rem":
    case "BitXor":
    case "BitAnd":
    case "BitOr":
    case "Offset":
    case "Shl":
    case "ShlUnchecked":
    case "Shr":
    case "ShrUnchecked":
      return true;
    case "AddWithOverflow":
    case "SubWithOverflow":
    case "MulWithOverflow":
    case "Eq":
    case "Ne":
    case "Lt":
    case "Le":
    case "Gt":
    case "Ge":
    case "Cmp":
      return false;
  }
}

/// Classify whether an operator is "right-homogeneous", i.e., the RHS has the
/// same type as the LHS.
// #[inline]
// rustc: compiler/rustc_const_eval/src/util/mod.rs:36 binop_right_homogeneous
export function binop_right_homogeneous(op: BinOp): boolean {
  switch (op) {
    case "Add":
    case "AddUnchecked":
    case "AddWithOverflow":
    case "Sub":
    case "SubUnchecked":
    case "SubWithOverflow":
    case "Mul":
    case "MulUnchecked":
    case "MulWithOverflow":
    case "Div":
    case "Rem":
    case "BitXor":
    case "BitAnd":
    case "BitOr":
    case "Eq":
    case "Ne":
    case "Lt":
    case "Le":
    case "Gt":
    case "Ge":
    case "Cmp":
      return true;
    case "Offset":
    case "Shl":
    case "ShlUnchecked":
    case "Shr":
    case "ShrUnchecked":
      return false;
  }
}

/// Classify whether an operator is "homogeneous", i.e., the operand has the
/// same type as the result.
// #[inline]
// rustc: compiler/rustc_const_eval/src/util/mod.rs:49 unop_homogeneous
export function unop_homogeneous(op: UnOp): boolean {
  switch (op) {
    case "Not":
    case "Neg":
      return true;
    case "PtrMetadata":
      return false;
  }
}

// stub: compiler/rustc_const_eval/src/util/mod.rs:56 context_spans (lane ctfe-util)
export function context_spans(tcx: TyCtxt, span: Span, def_id: DefId): Span[] {
  return unported("rustc_const_eval::util::context_spans");
}
