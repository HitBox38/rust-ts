// Port of compiler/rustc_const_eval/src/util/mod.rs (lane mt-validate ported the three operator classifiers ahead of
// ctfe-util, for the MIR `Validator`; lane ctfe-util completed the file with `context_spans`).
import type { BinOp, UnOp } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { type ExpnData } from "../../rustc_span/hygiene.ts";
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

// rustc: compiler/rustc_const_eval/src/util/mod.rs:56 context_spans
export function context_spans(tcx: TyCtxt, span_: Span, def_id: DefId): Span[] {
  // For consts where the enclosing item might be useful context, include their spans in the
  // diagnostic.
  const instance_span = Span.shrink_to_lo(tcx.def_span(def_id));
  const parent = tcx.parent(def_id);
  const parent_span = Span.shrink_to_lo(tcx.def_span(parent));
  let span = span_;
  // PORT: `macro_backtrace().last()` drains the iterator.
  let sp: ExpnData | undefined;
  for (const e of Span.macro_backtrace(span)) sp = e;
  if (sp !== undefined) {
    // We want the outermost span when macros are involved, as we don't care about the
    // macro's internal consts for the purposes of adding context.
    span = sp.call_site;
  }
  const kind = tcx.def_kind(def_id).$;
  const parent_kind = tcx.def_kind(parent).$;
  if (
    (parent_kind === "Struct" ||
      parent_kind === "Union" ||
      parent_kind === "Enum" ||
      parent_kind === "Trait" ||
      parent_kind === "Impl" ||
      parent_kind === "TyAlias" ||
      parent_kind === "Const" ||
      parent_kind === "Fn" ||
      parent_kind === "Static" ||
      kind === "AssocConst" ||
      kind === "AssocFn" ||
      kind === "AssocTy") &&
    Span.eq_ctxt(span, instance_span) &&
    Span.eq_ctxt(span, parent_span)
  ) {
    return [instance_span, parent_span];
  } else if (parent_kind === "Variant" && Span.eq_ctxt(span, instance_span) && Span.eq_ctxt(span, parent_span)) {
    return [instance_span, parent_span, Span.shrink_to_lo(tcx.def_span(tcx.parent(parent)))];
  } else if ((kind === "Const" || kind === "Static") && Span.eq_ctxt(span, instance_span)) {
    return [instance_span];
  } else {
    return [];
  }
}
