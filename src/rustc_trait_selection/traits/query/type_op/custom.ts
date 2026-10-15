// Port of compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs (lane old-query-typeops, wave 18c).
//
// PORT (lane selcx-contract's contract). `CustomTypeOp<F>` (codegen `hand`) is the class below; `F: FnOnce(&ObligationCtxt)
// -> Result<R, NoSolution>` is the closure type `(ocx) => Result<R, NoSolution>`; `R: TypeFoldable` adds `d_R` to
// `TypeOp_CustomTypeOp` / `scrape_region_constraints`. Its `TypeOp` impl is the descriptor `TypeOp_CustomTypeOp(d_R)`;
// `type ErrorInfo = !` is `never`.
// Init order: top-level code here touches only other crates.

import type { InferCtxt } from "../../../../rustc_infer/decls.ts";
import type { RegionConstraintData } from "../../../../rustc_infer/infer/region_constraints/mod.ts";
import { debug_LocalDefId, type LocalDefId } from "../../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../../../rustc_span/lib.ts";
import type { TypeFoldable } from "../../../../rustc_type_ir/fold.ts";
import type { NoSolution } from "../../../../rustc_type_ir/solve/mod.ts";
import { debug_str, debug_vec, type Fmt, format_debug, PLAIN, PRETTY } from "../../../../std/fmt.ts";
import { assert } from "../../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { debug_TypeOutlivesConstraint } from "../../../../rustc_infer/infer/mod.ts";
import { make_query_region_constraints } from "../../../../rustc_infer/infer/canonical/query_response.ts";
import { debug_ScrubbedTraitError, debug_TraitErrors, TraitErrors } from "../../../../rustc_infer/traits/engine.ts";
import { debug_GenericArg } from "../../../../rustc_middle/ty/generic_args.ts";
import { debug_OutlivesClause } from "../../../../rustc_type_ir/predicate.ts";
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

  // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs:22 new
  static new<R>(closure: (ocx: ObligationCtxt<ScrubbedTraitError>) => Result<R, NoSolution>, description: string): CustomTypeOp<R> {
    return new CustomTypeOp(closure, description);
  }
}

/** `impl<'tcx, F, R> TypeOp<'tcx> for CustomTypeOp<F>` (custom.rs:30). */
export function TypeOp_CustomTypeOp<R>(d_R: TypeFoldable<R>): TypeOp<CustomTypeOp<R>, R, never> {
  return {
    /// Processes the operation and all resulting obligations,
    /// returning the final result along with any region constraints
    /// (they will be given over to the NLL region solver).
    // rustc: compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs:43 fully_perform
    fully_perform(self, infcx, root_def_id, span) {
      // if cfg!(debug_assertions) { info!("fully_perform({:?})", self); }
      // PORT: the oracle is built without debug assertions (and tracing produces no output).

      const r = scrape_region_constraints<R, never>(infcx, root_def_id, self.description, span, self.closure, d_R);
      if (r.$ === "Err") return r;
      return Ok(r._0[0]);
    },
  };
}

/** `impl<F> fmt::Debug for CustomTypeOp<F>` (custom.rs:57): `self.description.fmt(f)` is `<&str as Debug>::fmt`. */
// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs:58 fmt
export function debug_CustomTypeOp<R>(self: CustomTypeOp<R>, _f: Fmt): string {
  return debug_str(self.description);
}

/// Executes `op` and then scrapes out all the "old style" region
/// constraints that result, creating query-region-constraints.
// PORT: `Op: TypeOp<Output = R>` only fixes the output type: the result is `TypeOpOutput<R, ErrorInfo>`.
// rustc: compiler/rustc_trait_selection/src/traits/query/type_op/custom.rs:65 scrape_region_constraints
export function scrape_region_constraints<R, ErrorInfo>(
  infcx: InferCtxt,
  root_def_id: LocalDefId,
  name: string,
  span: Span,
  op: (ocx: ObligationCtxt<ScrubbedTraitError>) => Result<R, NoSolution>,
  d_R: TypeFoldable<R>,
): Result<[TypeOpOutput<R, ErrorInfo>, RegionConstraintData], ErrorGuaranteed> {
  // During NLL, we expect that nobody will register region
  // obligations **except** as part of a custom type op (and, at the
  // end of each custom type op, we scrape out the region
  // obligations that resulted). So this vector should be empty on
  // entry.
  const pre_obligations = infcx.take_registered_region_obligations();
  assert(
    pre_obligations.length === 0,
    `scrape_region_constraints: incoming region obligations = ${format_debug(pre_obligations, (v, f) => debug_vec(v, f, debug_TypeOutlivesConstraint), PRETTY)}`,
  );
  const pre_assumptions = infcx.take_registered_region_assumptions();
  assert(
    pre_assumptions.length === 0,
    `scrape_region_constraints: incoming region assumptions = ${format_debug(pre_assumptions, (v, f) => debug_vec(v, f, (x, f) => debug_OutlivesClause(x, f, debug_GenericArg)), PRETTY)}`,
  );

  const value_r = infcx.commit_if_ok<R, ErrorGuaranteed>((_) => {
    const ocx = engine().ObligationCtxt.new(infcx);
    const op_r = op(ocx);
    if (op_r.$ === "Err") {
      const c = infcx.tcx.check_potentially_region_dependent_goals(root_def_id);
      // FIXME: In this region-dependent context, `type_op` should only fail due to
      // region-dependent goals. Any other kind of failure indicates a bug and we
      // should ICE.
      //
      // In principle, all non-region errors are expected to be emitted before
      // borrowck. Such errors should taint the body and prevent borrowck from
      // running at all. However, this invariant does not currently hold.
      //
      // Consider:
      //
      // ```ignore (illustrative)
      // struct Foo<T>(T)
      // where
      //     T: Iterator,
      //     <T as Iterator>::Item: Default;
      //
      // fn foo<T>() -> Foo<T> {
      //     loop {}
      // }
      // ```
      //
      // Here, `fn foo` ought to error and taint the body before MIR build, since
      // `Foo<T>` is not well-formed. However, we currently avoid checking this
      // during HIR typeck to prevent duplicate diagnostics.
      //
      // If we ICE here on any non-region-dependent failure, we would trigger ICEs
      // too often for such cases. For now, we emit a delayed bug instead.
      const guar = c.$ === "Err" ? c._0 : infcx.dcx().span_delayed_bug(span, `error performing operation: ${name}`);
      return Err(guar);
    }
    const value = op_r._0;
    const errors = ocx.evaluate_obligations_error_on_ambiguity();
    if (TraitErrors.no_errors(errors)) {
      return Ok(value);
    } else {
      const c = infcx.tcx.check_potentially_region_dependent_goals(root_def_id);
      if (c.$ === "Err") {
        const guar = c._0;
        return Err(guar);
      } else {
        return Err(
          infcx
            .dcx()
            .delayed_bug(`errors selecting obligation during MIR typeck: ${name} ${debug_LocalDefId(root_def_id, PLAIN)} ${debug_TraitErrors(errors, PLAIN, debug_ScrubbedTraitError)}`),
        );
      }
    }
  });
  if (value_r.$ === "Err") return value_r;

  // Next trait solver performs operations locally, and normalize goals should resolve vars.
  const value = infcx.deeply_resolve_ignoring_regions(value_r._0, d_R);

  const region_obligations = infcx.take_registered_region_obligations();
  const region_assumptions = infcx.take_registered_region_assumptions();
  const region_constraint_data = infcx.take_and_reset_region_constraints();
  const region_constraints = make_query_region_constraints(region_obligations, region_constraint_data, region_assumptions);

  if (region_constraints.is_empty()) {
    return Ok([{ output: value, constraints: undefined, error_info: undefined }, region_constraint_data]);
  } else {
    // PORT: `infcx.tcx.arena.alloc(x)` is `x`.
    return Ok([{ output: value, constraints: region_constraints, error_info: undefined }, region_constraint_data]);
  }
}

/** `crate::traits::engine` (this crate), read lazily (init order). */
function engine(): typeof import("../../engine.ts") {
  return require("../../engine.ts") as typeof import("../../engine.ts");
}
