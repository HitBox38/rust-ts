// Port of compiler/rustc_const_eval/src/util/mod.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-util; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type BinOp, type UnOp } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";

// mod alignment;
// pub(crate) mod caller_location;
import * as caller_location from "./caller_location.ts";
export { caller_location };
// mod check_validity_requirement;
// mod compare_types;
// mod type_name;

// pub use self::alignment::{most_packed_projection, place_unalignment};
export { most_packed_projection, place_unalignment } from "./alignment.ts";
// pub use self::check_validity_requirement::check_validity_requirement;
// pub(crate) use self::check_validity_requirement::validate_scalar_in_layout;
export { check_validity_requirement, validate_scalar_in_layout } from "./check_validity_requirement.ts";
// pub use self::compare_types::{relate_types, sub_types};
export { relate_types, sub_types } from "./compare_types.ts";
// pub use self::type_name::type_name;
export { type_name } from "./type_name.ts";

// stub: compiler/rustc_const_eval/src/util/mod.rs:22 binop_left_homogeneous (lane ctfe-util)
export function binop_left_homogeneous(op: BinOp): boolean {
  return unported("rustc_const_eval::util::binop_left_homogeneous");
}

// stub: compiler/rustc_const_eval/src/util/mod.rs:36 binop_right_homogeneous (lane ctfe-util)
export function binop_right_homogeneous(op: BinOp): boolean {
  return unported("rustc_const_eval::util::binop_right_homogeneous");
}

// stub: compiler/rustc_const_eval/src/util/mod.rs:49 unop_homogeneous (lane ctfe-util)
export function unop_homogeneous(op: UnOp): boolean {
  return unported("rustc_const_eval::util::unop_homogeneous");
}

// stub: compiler/rustc_const_eval/src/util/mod.rs:56 context_spans (lane ctfe-util)
export function context_spans(tcx: TyCtxt, span: Span, def_id: DefId): Span[] {
  return unported("rustc_const_eval::util::context_spans");
}
