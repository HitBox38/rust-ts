//! Experimental types for the trait query interface. The methods
//! defined in this module are all based on **canonicalization**,
//! which makes a canonical query by replacing unbound inference
//! variables and regions, so that results can be reused more broadly.
//! The providers for the queries defined here can be found in
//! `rustc_traits`.
// Port of compiler/rustc_middle/src/traits/query.rs (lane middle-traits-thir). The types are generated (query.gen.ts,
// set rustc_middle_traits_thir; `pub mod type_op` is the `type_op` namespace there).
import type { Span } from "../../rustc_span/lib.ts";
import { DropCheckOverflow_diagnostic } from "../diagnostics.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Ty } from "../ty/mod.ts";
import { DropckConstraint, DropckOutlivesResult } from "./query.gen.ts";

export * from "./query.gen.ts";
// `pub use crate::traits::solve::NoSolution;`
export { debug_NoSolution, type NoSolution } from "../../rustc_type_ir/solve/mod.ts";

declare module "./query.gen.ts" {
  interface DropckOutlivesResult {
    report_overflows(tcx: TyCtxt, span: Span, ty: Ty): void;
  }
  namespace DropckConstraint {
    export function empty(): DropckConstraint;
    export function from_iter(iter: Iterable<DropckConstraint>): DropckConstraint;
  }
}

// rustc: compiler/rustc_middle/src/traits/query.rs:111 report_overflows
DropckOutlivesResult.prototype.report_overflows = function (this: DropckOutlivesResult, tcx: TyCtxt, span: Span, ty: Ty): void {
  const overflow_ty = this.overflows[0];
  if (overflow_ty !== undefined) {
    tcx.dcx().emit_err(DropCheckOverflow_diagnostic({ span, ty, overflow_ty }));
  }
};

Object.assign(DropckConstraint, {
  // rustc: compiler/rustc_middle/src/traits/query.rs:136 empty
  empty(): DropckConstraint {
    return new DropckConstraint([], [], []);
  },

  // `impl FromIterator<DropckConstraint> for DropckConstraint`
  // rustc: compiler/rustc_middle/src/traits/query.rs:142 from_iter
  from_iter(iter: Iterable<DropckConstraint>): DropckConstraint {
    const result = DropckConstraint.empty();

    for (const { outlives, dtorck_types, overflows } of iter) {
      result.outlives.push(...outlives);
      result.dtorck_types.push(...dtorck_types);
      result.overflows.push(...overflows);
    }

    return result;
  },
});
