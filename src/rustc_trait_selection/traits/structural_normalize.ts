// Port of compiler/rustc_trait_selection/src/traits/structural_normalize.rs (lane trait-sel-traits-a; the contract
// stub was lane infcx-contract's). `#[extension(pub trait StructurallyNormalizeExt)] impl At` puts the three methods on
// `At.prototype` (rustc_trait_selection decls.ts).
//
// Init order: top-level code here touches only rustc_infer (loaded first by ../lib.ts) and other crates.

import { At } from "../../rustc_infer/decls.ts";
import type { TraitEngine } from "../../rustc_infer/traits/engine.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import type { Const, Predicate, Term, Ty } from "../../rustc_middle/ty/decls.ts";
import { fold_Term, Term as TermC } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ProjectionClause } from "../../rustc_middle/ty/predicate.ts";
import { clone_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import type { ProjectionClause } from "../../rustc_type_ir/predicate.ts";
import { Term_provided } from "../../rustc_type_ir/inherent.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { assert } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { evaluate_const } from "./mod.ts";

// ---- #[extension(pub trait StructurallyNormalizeExt<'tcx>)] impl<'tcx> At<'_, 'tcx> ---------------------------------

// rustc: compiler/rustc_trait_selection/src/traits/structural_normalize.rs:11 structurally_normalize_ty
At.prototype.structurally_normalize_ty = function <E>(this: At, ty: Unnormalized<Ty>, fulfill_cx: TraitEngine<E>): Result<Ty, E[]> {
  const r = this.structurally_normalize_term(
    Unnormalized.map(ty, (t) => TermC.from_Ty(t)),
    fulfill_cx,
  );
  return r.$ === "Ok" ? Ok(TermC.expect_type(r._0)) : r;
};

// rustc: compiler/rustc_trait_selection/src/traits/structural_normalize.rs:20 structurally_normalize_const
At.prototype.structurally_normalize_const = function <E>(this: At, ct: Unnormalized<Const>, fulfill_cx: TraitEngine<E>): Result<Const, E[]> {
  if (this.infcx.tcx.features().generic_const_exprs()) {
    return Ok(evaluate_const(this.infcx, Unnormalized.skip_normalization(ct), this.param_env));
  }

  const r = this.structurally_normalize_term(
    Unnormalized.map(ct, (c) => TermC.from_Const(c)),
    fulfill_cx,
  );
  return r.$ === "Ok" ? Ok(TermC.expect_const(r._0)) : r;
};

// rustc: compiler/rustc_trait_selection/src/traits/structural_normalize.rs:33 structurally_normalize_term
At.prototype.structurally_normalize_term = function <E>(this: At, term_: Unnormalized<Term>, fulfill_cx: TraitEngine<E>): Result<Term, E[]> {
  assert(!Term_provided.is_infer(Unnormalized.skip_normalization(Unnormalized.as_ref(term_))), "should have resolved vars before calling");

  if (this.infcx.next_trait_solver()) {
    const term = Unnormalized.skip_normalization(term_);

    if (!this.infcx.tcx.renormalize_rigid_aliases() && !TermC.is_non_rigid_alias(term)) {
      return Ok(term);
    }

    const alias = TermC.to_alias_term(term);
    if (alias === undefined) {
      return Ok(term);
    }

    const new_infer = this.infcx.next_term_var_of_alias_kind(alias, this.cause.span);

    // We simply emit an `Projection` goal here, since that will take care of
    // normalizing the LHS of the projection until it is a rigid projection
    // (or a not-yet-defined opaque in scope).
    const obligation = Obligation.new(
      this.infcx.tcx,
      clone_ObligationCause(this.cause),
      this.param_env,
      { projection_term: alias, term: new_infer } satisfies ProjectionClause,
      Predicate_upcast_from_ProjectionClause as (from: ProjectionClause, tcx: Interner) => Predicate,
    );

    fulfill_cx.register_predicate_obligation(this.infcx, obligation);
    const errors = fulfill_cx.try_evaluate_obligations(this.infcx);
    if (errors.$ === "HasErrors") {
      return Err(errors._0);
    }

    return Ok(this.infcx.deeply_resolve_ignoring_regions(new_infer, fold_Term));
  } else {
    return Ok(this.normalize(term_, fold_Term).into_value_registering_obligations(this.infcx, fulfill_cx));
  }
};
