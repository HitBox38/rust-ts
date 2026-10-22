// Port of compiler/rustc_mir_transform/src/impossible_clauses.rs (merge-w22, moved forward from lane mt-cleanup: needed
// by `trivial_const` (lib.ts) for every const).
//! Check if it's even possible to satisfy the 'where' clauses
//! for this item.
//!
//! It's possible to `#!feature(trivial_bounds)]` to write
//! a function with impossible to satisfy clauses, e.g.:
//! `fn foo() where String: Copy {}`.
//!
//! We don't usually need to worry about this kind of case,
//! since we would get a compilation error if the user tried
//! to call it. However, since we optimize even without any
//! calls to the function, we need to make sure that it even
//! makes sense to try to evaluate the body.
//!
//! If there are unsatisfiable where clauses, then all bets are
//! off, and we just give up.
//!
//! We manually filter the predicates, skipping anything that's not
//! "global". We are in a potentially generic context
//! (e.g. we are evaluating a function without instantiating generic
//! parameters, so this filtering serves two purposes:
//!
//! 1. We skip evaluating any predicates that we would
//!    never be able prove are unsatisfiable (e.g. `<T as Foo>`
//! 2. We avoid trying to normalize predicates involving generic
//!    parameters (e.g. `<T as Foo>::MyItem`). This can confuse
//!    the normalization code (leading to cycle errors), since
//!    it's usually never invoked in this way.
import { type Body, START_BLOCK, TerminatorKind } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericClauses } from "../rustc_middle/ty/generics.ts";
import type { Clause } from "../rustc_middle/ty/decls.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { Elaboratable_Clause, elaborate } from "../rustc_type_ir/elaborate.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { TraitClause } from "../rustc_type_ir/predicate.ts";
import { SizedTraitKind } from "../rustc_type_ir/solve/mod.ts";
import { TypeFlags } from "../rustc_type_ir/flags.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { impossible_clauses } from "../rustc_trait_selection/traits/mod.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc: compiler/rustc_mir_transform/src/impossible_clauses.rs:38 is_structurally_unsized
function is_structurally_unsized(tcx: TyCtxt, ty: Ty): boolean {
  const k = ty.kind();
  switch (k.$) {
    case "Str":
    case "Slice":
    case "Dynamic":
    case "Foreign":
      return true;
    case "Tuple": {
      const tys = k._0;
      const last = tys[tys.length - 1];
      return last !== undefined && is_structurally_unsized(tcx, last);
    }
    case "Adt": {
      const [def, args] = [k._0, k._1];
      const c = def.sizedness_constraint(tcx, SizedTraitKind.Sized);
      return c !== undefined && is_structurally_unsized(tcx, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(c, tcx, args, fold_Ty)));
    }
    default:
      return false;
  }
}

// rustc: compiler/rustc_mir_transform/src/impossible_clauses.rs:51 has_structurally_impossible_sized_clause
function has_structurally_impossible_sized_clause(tcx: TyCtxt, sized_trait: DefId, predicate: Clause): boolean {
  const trait_predicate_ = predicate.as_trait_clause();
  if (trait_predicate_ === undefined) {
    return false;
  }
  const trait_predicate: TraitClause = Binder.skip_binder(trait_predicate_);

  return (
    trait_predicate.polarity === "Positive" &&
    DefId_eq(TraitClause.def_id(trait_predicate), sized_trait) &&
    is_structurally_unsized(tcx, TraitClause.self_ty(trait_predicate))
  );
}

// rustc-type: compiler/rustc_mir_transform/src/impossible_clauses.rs:66 ImpossibleClauses
export class ImpossibleClauses extends MirPass {
  readonly type_name = "rustc_mir_transform::impossible_clauses::ImpossibleClauses";

  // #[tracing::instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/impossible_clauses.rs:101 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // tracing::trace!(def_id = ?body.source.def_id());
    const impossible = body.tainted_by_errors !== undefined || has_impossible_clauses(tcx, body.source.def_id());
    if (impossible) {
      // trace!("found unsatisfiable clauses");
      // Clear the body to only contain a single `unreachable` statement.
      const bbs = body.basic_blocks.as_mut();
      bbs.length = Math.min(bbs.length, 1);
      bbs[START_BLOCK as unknown as number]!.statements.length = 0;
      bbs[START_BLOCK as unknown as number]!.terminator_mut().kind = TerminatorKind.Unreachable;
      body.var_debug_info.length = 0;
      body.local_decls.length = Math.min(body.local_decls.length, body.arg_count + 1);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/impossible_clauses.rs:117 policy
  policy(_ctx: PassCtx): PassPolicy {
    // This can only replace code proven unreachable with immediate UB, so it cannot remove UB.
    return PassPolicy.optional(true);
  }
}

// rustc: compiler/rustc_mir_transform/src/impossible_clauses.rs:68 has_impossible_clauses
export function has_impossible_clauses(tcx: TyCtxt, def_id: DefId): boolean {
  const clauses = GenericClauses.instantiate_identity(tcx.clauses_of(def_id) as GenericClauses, tcx);
  // tracing::trace!(?clauses);

  // Some `Sized` clauses that mention local generics are still impossible
  // for every instantiation, e.g. `dyn Trait<T>: Sized`.
  const sized_trait = tcx.lang_items().sized_trait();
  if (sized_trait !== undefined) {
    if (clauses.clauses.map(Unnormalized.skip_norm_wip).some((clause) => has_structurally_impossible_sized_clause(tcx, sized_trait, clause))) {
      return true;
    }
  }

  const clauses_ = clauses.clauses.map(Unnormalized.skip_norm_wip).filter(
    (c) =>
      !TypeVisitableExt.has_type_flags(
        c,
        // Only consider global clauses to simplify.
        TypeFlags.union(
          TypeFlags.HAS_FREE_LOCAL_NAMES,
          // Clauses that refer to alias constants as they cause cycles.
          TypeFlags.HAS_CONST_ALIAS,
        ),
        fold_Clause,
      ),
  );
  const clauses__: Clause[] = [...elaborate(tcx, clauses_, Elaboratable_Clause)];
  // tracing::trace!(?clauses);
  // PORT: `Vec<Clause>::references_error()` is any element's.
  return clauses__.some((c) => TypeVisitableExt.references_error(c, fold_Clause)) || impossible_clauses(tcx, clauses__);
}
