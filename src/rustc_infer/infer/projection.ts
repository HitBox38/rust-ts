// Port of compiler/rustc_infer/src/infer/projection.rs (lane infer-opaque-snapshot): one `impl InferCtxt` method,
// assigned onto `InferCtxt.prototype` (declared in ../decls.ts). Init order: other rustc_infer modules are read inside
// function bodies only.

import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { ParamEnv } from "../../rustc_middle/ty/decls.ts";
import { Term } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ProjectionClause } from "../../rustc_middle/ty/predicate.ts";
import type { ProjectionClause } from "../../rustc_type_ir/predicate.ts";
import { AliasTerm, AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../rustc_type_ir/ty/alias.ts";
import { InferCtxt } from "../decls.ts";
import { Obligation, type PredicateObligations } from "../traits/mod.ts";

/// Instead of normalizing an associated type projection,
/// this function generates an inference variable and registers
/// an obligation that this inference variable must be the result
/// of the given projection. This allows us to proceed with projections
/// while they cannot be resolved yet due to missing information or
/// simply due to the lack of access to the trait resolution machinery.
// rustc: compiler/rustc_infer/src/infer/projection.rs:15 projection_term_to_infer
InferCtxt.prototype.projection_term_to_infer = function (
  this: InferCtxt,
  param_env: ParamEnv,
  alias_term: AliasTermT,
  cause: ObligationCause,
  recursion_depth: number,
  obligations: PredicateObligations,
): Term {
  // debug_assert!(!self.next_trait_solver());

  const span = this.tcx.def_span(AliasTerm.expect_projection_def_id(alias_term));
  const infer_var = AliasTermKind.is_type(alias_term.kind) ? Term.from_Ty(this.next_ty_var(span)) : Term.from_Const(this.next_const_var(span));

  const projection: ProjectionClause = { projection_term: alias_term, term: infer_var };
  const obligation = Obligation.with_depth(this.tcx, cause, recursion_depth, param_env, projection, upcast_ProjectionClause);
  obligations.push(obligation);

  return infer_var;
};

/** `ProjectionClause: Upcast<TyCtxt, ty::Predicate>` (rustc_middle ty/predicate.rs), at decls.ts's `Interner` type. */
const upcast_ProjectionClause = Predicate_upcast_from_ProjectionClause as unknown as (from: ProjectionClause, tcx: unknown) => ReturnType<typeof Predicate_upcast_from_ProjectionClause>;
