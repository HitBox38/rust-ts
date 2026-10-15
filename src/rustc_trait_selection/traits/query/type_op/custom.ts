// Port of compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs (lane old-query-typeops, wave 18b).
//
// Contract stub (lane selcx-contract). `CustomTypeOp<F>` (codegen `hand`) is the class below; `F: FnOnce(&ObligationCtxt)
// -> Result<R, NoSolution>` is the closure type `(ocx) => Result<R, NoSolution>`; `R: TypeFoldable` adds `d_R` to
// `TypeOp_CustomTypeOp` / `scrape_region_constraints`. Its `TypeOp` impl is the descriptor `TypeOp_CustomTypeOp(d_R)`;
// `type ErrorInfo = !` is `never`. Fill: replace the stub bodies, markers
// `// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs:<line> <name>` directly above.
// Init order: top-level code here touches only other crates.

import type { InferCtxt } from "../../../../rustc_infer/decls.ts";
import type { RegionConstraintData } from "../../../../rustc_infer/infer/region_constraints/mod.ts";
import type { LocalDefId } from "../../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
import type { TypeFoldable } from "../../../../rustc_type_ir/fold.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import type { Fmt } from "../../../../std/fmt.ts";
import { unported } from "../../../../std/panic.ts";
import type { Result } from "../../../../std/result.ts";
import type { ObligationCtxt } from "../../engine.ts";
import type { ScrubbedTraitError } from "../../../../rustc_infer/traits/engine.ts";
import type { TypeOp, TypeOpOutput } from "./mod.ts";

export * from "./custom.gen.ts";

// rustc-type: compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs:16 CustomTypeOp
export class CustomTypeOp<R> {
  constructor(
    public closure: (ocx: ObligationCtxt<ScrubbedTraitError>) => Result<R, NoSolution>,
    public description: string,
  ) {}

  // custom.rs:22 (stub)
  static new<R>(_closure: (ocx: ObligationCtxt<ScrubbedTraitError>) => Result<R, NoSolution>, _description: string): CustomTypeOp<R> {
    return unported("rustc_trait_selection::traits::query::type_op::custom::CustomTypeOp::new");
  }
}

/** `impl<'tcx, F, R> TypeOp<'tcx> for CustomTypeOp<F>` (custom.rs:30). */
export function TypeOp_CustomTypeOp<R>(_d_R: TypeFoldable<R>): TypeOp<CustomTypeOp<R>, R, never> {
  return {
    // custom.rs:43 (stub)
    fully_perform(_self, _infcx, _root_def_id, _span) {
      return unported("rustc_trait_selection::traits::query::type_op::custom::<CustomTypeOp as TypeOp>::fully_perform");
    },
  };
}

/** `impl<F> fmt::Debug for CustomTypeOp<F>` (custom.rs:57). */
// custom.rs:58 (stub)
export function debug_CustomTypeOp<R>(_self: CustomTypeOp<R>, _f: Fmt): string {
  return unported("rustc_trait_selection::traits::query::type_op::custom::<CustomTypeOp as Debug>::fmt");
}

/// Executes `op` and then scrapes out all the "old style" region
/// constraints that result, creating query-region-constraints.
// custom.rs:65 (stub; `Op: TypeOp<Output = R>` only fixes the output type: `TypeOpOutput<R, ErrorInfo>`)
export function scrape_region_constraints<R, ErrorInfo>(
  _infcx: InferCtxt,
  _root_def_id: LocalDefId,
  _name: string,
  _span: Span,
  _op: (ocx: ObligationCtxt<ScrubbedTraitError>) => Result<R, NoSolution>,
  _d_R: TypeFoldable<R>,
): Result<[TypeOpOutput<R, ErrorInfo>, RegionConstraintData], ErrorGuaranteed> {
  return unported("rustc_trait_selection::traits::query::type_op::custom::scrape_region_constraints");
}
