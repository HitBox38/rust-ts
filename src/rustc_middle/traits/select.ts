//! Candidate selection. See the [rustc dev guide] for more information on how this works.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/traits/resolution.html#selection
// Port of compiler/rustc_middle/src/traits/select.rs (lane middle-traits-thir). The types are generated (select.gen.ts,
// set rustc_middle_traits_thir); the impls are companion functions (PORTING §8).
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import * as gen from "./select.gen.ts";
import { EvaluationResult_discriminant } from "./select.gen.ts";
import type { SelectionError } from "./mod.gen.ts";

export * from "./select.gen.ts";

export type EvaluationResult = gen.EvaluationResult;
export const EvaluationResult = {
  ...gen.EvaluationResult,

  /// Returns `true` if this evaluation result is known to apply, even
  /// considering outlives constraints.
  // rustc: compiler/rustc_middle/src/traits/select.rs:227 must_apply_considering_regions
  must_apply_considering_regions(self: EvaluationResult): boolean {
    return self === "EvaluatedToOk";
  },

  /// Returns `true` if this evaluation result is known to apply, ignoring
  /// outlives constraints.
  // rustc: compiler/rustc_middle/src/traits/select.rs:233 must_apply_modulo_regions
  must_apply_modulo_regions(self: EvaluationResult): boolean {
    // PORT: derived `PartialOrd` compares the discriminants.
    return EvaluationResult_discriminant[self] <= EvaluationResult_discriminant.EvaluatedToOkModuloRegions;
  },

  // rustc: compiler/rustc_middle/src/traits/select.rs:237 may_apply
  may_apply(self: EvaluationResult): boolean {
    switch (self) {
      case "EvaluatedToOkModuloOpaqueTypes":
      case "EvaluatedToOk":
      case "EvaluatedToOkModuloRegions":
      case "EvaluatedToAmbig":
      case "EvaluatedToAmbigStackDependent":
        return true;

      case "EvaluatedToErr":
        return false;
    }
  },

  // rustc: compiler/rustc_middle/src/traits/select.rs:249 is_stack_dependent
  is_stack_dependent(self: EvaluationResult): boolean {
    switch (self) {
      case "EvaluatedToAmbigStackDependent":
        return true;

      case "EvaluatedToOkModuloOpaqueTypes":
      case "EvaluatedToOk":
      case "EvaluatedToOkModuloRegions":
      case "EvaluatedToAmbig":
      case "EvaluatedToErr":
        return false;
    }
  },
};

export type OverflowError = gen.OverflowError;
export const OverflowError = {
  ...gen.OverflowError,

  // `impl From<ErrorGuaranteed> for OverflowError`
  // rustc: compiler/rustc_middle/src/traits/select.rs:270 from
  from(e: ErrorGuaranteed): OverflowError {
    return { $: "Error", _0: e };
  },
};

/** `impl<'tcx> From<OverflowError> for SelectionError<'tcx>` (select.rs:275). */
// rustc: compiler/rustc_middle/src/traits/select.rs:276 from
export function SelectionError_from_OverflowError(overflow_error: OverflowError): SelectionError {
  switch (overflow_error.$) {
    case "Error":
      return { $: "Overflow", _0: { $: "Error", _0: overflow_error._0 } };
    case "Canonical":
      return { $: "Overflow", _0: gen.OverflowError.Canonical };
  }
}
