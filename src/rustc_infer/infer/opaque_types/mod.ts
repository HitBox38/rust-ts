// Port of compiler/rustc_infer/src/infer/opaque_types/mod.rs (lane infer-opaque-snapshot): the `impl InferCtxt` methods
// that register hidden types of opaque types, assigned onto `InferCtxt.prototype` (declared in ../../decls.ts). Init
// order: other rustc_infer modules are read inside function bodies only.
//
// PORT: query values that queries.gen.ts still types `unknown` are cast at the read site (`explicit_item_bounds`,
// `explicit_implied_const_bounds`: `EarlyBinder<&[(_, Span)]>`; `type_of_opaque_hir_typeck`: `EarlyBinder<Ty>`;
// `opaque_ty_origin`: `hir::OpaqueTyOrigin<DefId>`). `impl Upcast<TyCtxt, P>` arguments are the value plus the
// `upcast_from_*` impl of rustc_middle ty/predicate.ts (typed over `TyCtxt`, cast for `Goal::new`, as the next solver's
// `upcast_tcx`). `#[instrument]` / `debug!` (tracing) are left out.

import type { OpaqueTyOrigin } from "../../../rustc_hir/lib.ts";
import { ObligationCause, type ObligationCauseCode } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, GenericArgs, ParamEnv, Predicate, Region, Ty } from "../../../rustc_middle/ty/decls.ts";
import { Term } from "../../../rustc_middle/ty/mod.ts";
import {
  Predicate_upcast_from_Clause,
  Predicate_upcast_from_ClauseKind,
  Predicate_upcast_from_PredicateKind,
  Predicate_upcast_from_ProjectionClause,
} from "../../../rustc_middle/ty/predicate.ts";
import { BottomUpFolder } from "../../../rustc_middle/ty/fold.ts";
import { fold_Clause, fold_Span, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { fold_with_AliasTy, try_fold_with_AliasTy, visit_with_AliasTy } from "../../../rustc_middle/traits/mod.ts";
import type { ProvisionalHiddenType as ProvisionalHiddenTypeT } from "../../../rustc_middle/ty/mod.ts";
import { ProvisionalHiddenType } from "../../../rustc_middle/ty/mod.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../../rustc_span/def_id.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { OpaqueTypeKey } from "../../../rustc_type_ir/decls.ts";
import { debug_TypeError, ExpectedFound, type TypeError } from "../../../rustc_type_ir/error.ts";
import { fold_regions, fold_tuple2, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { debug_CantBeErased, debug_TypingMode, TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import {
  as_interner,
  fold_with_TraitRef,
  PolyTraitRef as PolyTraitRefC,
  type ProjectionClause,
  type TraitRef,
  try_fold_with_TraitRef,
  visit_with_TraitRef,
} from "../../../rustc_type_ir/predicate.ts";
import type { ClauseKind, PredicateKind } from "../../../rustc_type_ir/predicate_kind.ts";
import { Goal } from "../../../rustc_type_ir/solve/mod.ts";
import { AliasTerm } from "../../../rustc_type_ir/term_kind.ts";
import type { AliasTy } from "../../../rustc_type_ir/ty/alias.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { unwrap_result } from "../../../std/result.ts";
import { InferCtxt } from "../../decls.ts";
import { OpaqueHiddenTypeDiag_diagnostic } from "../../diagnostics.ts";
import { Obligation, type PredicateObligations } from "../../traits/mod.ts";
import { DefineOpaqueTypes, ToTrace_Ty } from "../at.ts";
import { InferOk } from "../mod.ts";

export { OpaqueTypeStorage, OpaqueTypeStorageEntries, OpaqueTypeTable } from "./table.ts";

// ---- impl InferCtxt --------------------------------------------------------------------------------------------------

/// This is a backwards compatibility hack to prevent breaking changes from
/// lazy TAIT around RPIT handling.
// rustc: compiler/rustc_infer/src/infer/opaque_types/mod.rs:25 replace_opaque_types_with_inference_vars
InferCtxt.prototype.replace_opaque_types_with_inference_vars = function <T>(
  this: InferCtxt,
  value: T,
  body_def_id: LocalDefId,
  span: Span,
  param_env: ParamEnv,
  d_T: TypeFoldable<T>,
): InferOk<T> {
  // We handle opaque types differently in the new solver.
  if (this.next_trait_solver()) {
    return new InferOk(value, []);
  }

  if (!TypeVisitableExt.has_opaque_types(value, d_T)) {
    return new InferOk(value, []);
  }

  const obligations: PredicateObligations = [];
  const value_ = d_T.fold_with(
    value,
    new BottomUpFolder(
      this.tcx,
      (ty) => {
        const kind = ty.kind();
        if (kind.$ === "Alias" && kind._1.kind.$ === "Opaque") {
          const def_id = kind._1.kind.def_id;
          if (this.can_define_opaque_ty(def_id) && !TypeVisitableExt.has_escaping_bound_vars(ty, fold_Ty)) {
            const def_span = this.tcx.def_span(def_id);
            const span_ = Span.contains(span, def_span) ? def_span : span;
            const ty_var = this.next_ty_var(span_);
            for (const goal of unwrap_result(this.handle_opaque_type(ty, ty_var, span_, param_env), debug_TypeError)) {
              obligations.push(
                Obligation.new(
                  this.tcx,
                  ObligationCause.new(span_, body_def_id, { $: "OpaqueReturnType", _0: undefined } as ObligationCauseCode),
                  goal.param_env,
                  goal.predicate,
                  upcast_from_self,
                ),
              );
            }
            return ty_var;
          }
        }
        return ty;
      },
      (lt) => lt,
      (ct) => ct,
    ),
  );
  return new InferOk(value_, obligations);
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/mod.rs:78 handle_opaque_type
InferCtxt.prototype.handle_opaque_type = function (this: InferCtxt, a: Ty, b: Ty, span: Span, param_env: ParamEnv): Result<Goal<Predicate>[], TypeError> {
  // debug_assert!(!self.next_trait_solver());
  const process = (a: Ty, b: Ty): Result<Goal<Predicate>[], TypeError> | undefined => {
    const a_kind = a.kind();
    if (a_kind.$ === "Alias" && a_kind._1.kind.$ === "Opaque" && a_kind._1.kind.def_id.is_local()) {
      const args = a_kind._1.args;
      const def_id = a_kind._1.kind.def_id.expect_local();
      if (TypingMode.is_coherence(this.typing_mode_raw())) {
        // See comment on `insert_hidden_type` for why this is sufficient in coherence
        return this.register_hidden_type({ def_id, args }, span, param_env, b);
      }
      // Check that this is `impl Trait` type is
      // declared by `parent_def_id` -- i.e., one whose
      // value we are inferring. At present, this is
      // always true during the first phase of
      // type-check, but not always true later on during
      // NLL. Once we support named opaque types more fully,
      // this same scenario will be able to arise during all phases.
      //
      // Here is an example using type alias `impl Trait`
      // that indicates the distinction we are checking for:
      //
      // ```rust
      // mod a {
      //   pub type Foo = impl Iterator;
      //   pub fn make_foo() -> Foo { .. }
      // }
      //
      // mod b {
      //   fn foo() -> a::Foo { a::make_foo() }
      // }
      // ```
      //
      // Here, the return type of `foo` references an
      // `Opaque` indeed, but not one whose value is
      // presently being inferred. You can get into a
      // similar situation with closure return types
      // today:
      //
      // ```rust
      // fn foo() -> impl Iterator { .. }
      // fn bar() {
      //     let x = || foo(); // returns the Opaque assoc with `foo`
      // }
      // ```
      if (!this.can_define_opaque_ty(LocalDefId.to_def_id(def_id))) {
        return undefined;
      }

      const b_kind = b.kind();
      if (b_kind.$ === "Alias" && b_kind._1.kind.$ === "Opaque") {
        const b_def_id = b_kind._1.kind.def_id;
        // We could accept this, but there are various ways to handle this situation,
        // and we don't want to make a decision on it right now. Likely this case is so
        // super rare anyway, that no one encounters it in practice. It does occur
        // however in `fn fut() -> impl Future<Output = i32> { async { 42 } }`, where
        // it is of no concern, so we only check for TAITs.
        if (this.can_define_opaque_ty(b_def_id) && (this.tcx.opaque_ty_origin(b_def_id) as OpaqueTyOrigin<DefId>).$ === "TyAlias") {
          this.dcx().emit_err(
            OpaqueHiddenTypeDiag_diagnostic({
              span,
              hidden_type: this.tcx.def_span(b_def_id),
              opaque_type: this.tcx.def_span(LocalDefId.to_def_id(def_id)),
            }),
          );
        }
      }
      return this.register_hidden_type({ def_id, args }, span, param_env, b);
    } else {
      return undefined;
    }
  };
  const res_ab = process(a, b);
  if (res_ab !== undefined) {
    return res_ab;
  }
  const res_ba = process(b, a);
  if (res_ba !== undefined) {
    return res_ba;
  } else {
    const [a_, b_] = this.deeply_resolve_ignoring_regions<[Ty, Ty]>([a, b], d_Ty_Ty);
    return Err({ $: "Sorts", _0: ExpectedFound.new(a_, b_) } as TypeError);
  }
};

// ---- impl InferCtxt --------------------------------------------------------------------------------------------------

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_infer/src/infer/opaque_types/mod.rs:176 register_hidden_type
InferCtxt.prototype.register_hidden_type = function (
  this: InferCtxt,
  opaque_type_key: OpaqueTypeKey,
  span: Span,
  param_env: ParamEnv,
  hidden_ty: Ty,
): Result<Goal<Predicate>[], TypeError> {
  const goals: Goal<Predicate>[] = [];

  const r = this.insert_hidden_type(opaque_type_key, span, param_env, hidden_ty, goals);
  if (r.$ === "Err") return r;

  this.add_item_bounds_for_hidden_type(LocalDefId.to_def_id(opaque_type_key.def_id), opaque_type_key.args, param_env, hidden_ty, goals);

  return Ok(goals);
};

/// Insert a hidden type into the opaque type storage, making sure
/// it hasn't previously been defined. This does not emit any
/// constraints and it's the responsibility of the caller to make
/// sure that the item bounds of the opaque are checked.
// rustc: compiler/rustc_infer/src/infer/opaque_types/mod.rs:202 register_hidden_type_in_storage
InferCtxt.prototype.register_hidden_type_in_storage = function (
  this: InferCtxt,
  opaque_type_key: OpaqueTypeKey,
  hidden_ty: ProvisionalHiddenTypeT,
): Ty | undefined {
  return this.inner.opaque_types().register(opaque_type_key, hidden_ty);
};

/// Insert a hidden type into the opaque type storage, equating it
/// with any previous entries if necessary.
///
/// This **does not** add the item bounds of the opaque as nested
/// obligations. That is only necessary when normalizing the opaque
/// itself, not when getting the opaque type constraints from
/// somewhere else.
// rustc: compiler/rustc_infer/src/infer/opaque_types/mod.rs:217 insert_hidden_type
InferCtxt.prototype.insert_hidden_type = function (
  this: InferCtxt,
  opaque_type_key: OpaqueTypeKey,
  span: Span,
  param_env: ParamEnv,
  hidden_ty: Ty,
  goals: Goal<Predicate>[],
): Result<null, TypeError> {
  const tcx = this.tcx;
  // Ideally, we'd get the span where *this specific `ty` came
  // from*, but right now we just use the span from the overall
  // value being folded. In simple cases like `-> impl Foo`,
  // these are the same span, but not in cases like `-> (impl
  // Foo, impl Bar)`.
  //
  // Note: we don't use this function in the next solver so we can safely call `assert_not_erased`
  const mode = TypingMode.assert_not_erased(this.typing_mode_raw());
  switch (mode.$) {
    case "Coherence":
      // During intercrate we do not define opaque types but instead always
      // force ambiguity unless the hidden type is known to not implement
      // our trait.
      goals.push(Goal.new(as_interner(tcx), param_env, { $: "Ambiguous" } as PredicateKind, upcast_tcx(Predicate_upcast_from_PredicateKind)));
      break;
    case "Typeck": {
      const prev = this.inner.opaque_types().register(opaque_type_key, new ProvisionalHiddenType(span, hidden_ty));
      if (prev !== undefined) {
        const r = this.at(ObligationCause.dummy_with_span(span), param_env).eq(DefineOpaqueTypes.Yes, prev, hidden_ty, ToTrace_Ty);
        if (r.$ === "Err") return r;
        for (const obligation of r._0.obligations) goals.push(obligation.as_goal());
      }
      break;
    }
    case "PostTypeckUntilBorrowck": {
      const prev = this.inner.opaque_types().register(opaque_type_key, new ProvisionalHiddenType(span, hidden_ty));

      // We either equate the new hidden type with the previous entry or with the type
      // inferred by HIR typeck.
      const actual =
        prev ??
        ((): Ty => {
          const actual = Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(tcx.type_of_opaque_hir_typeck(opaque_type_key.def_id) as EarlyBinder<Ty>, this.tcx, opaque_type_key.args, fold_Ty),
          );
          const actual_ = fold_regions(
            tcx,
            actual,
            (re: Region, _dbi) => {
              switch (re.kind().$) {
                case "ReErased":
                  return this.next_region_var({ $: "Misc", _0: span });
                default:
                  return re;
              }
            },
            fold_Ty,
          );
          return actual_;
        })();

      const r = this.at(ObligationCause.dummy_with_span(span), param_env).eq(DefineOpaqueTypes.Yes, hidden_ty, actual, ToTrace_Ty);
      if (r.$ === "Err") return r;
      for (const obligation of r._0.obligations) goals.push(obligation.as_goal());
      break;
    }
    case "PostBorrowck":
    case "PostAnalysis":
    case "Codegen":
    case "Reflection":
      bug(`insert hidden type in ${debug_TypingMode(mode, PLAIN, debug_CantBeErased)}`);
  }

  return Ok(null);
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/mod.rs:296 add_item_bounds_for_hidden_type
InferCtxt.prototype.add_item_bounds_for_hidden_type = function (
  this: InferCtxt,
  def_id: DefId,
  args: GenericArgs,
  param_env: ParamEnv,
  hidden_ty: Ty,
  goals: Goal<Predicate>[],
): void {
  const tcx = this.tcx;
  // Require that the hidden type is well-formed. We have to
  // make sure we wf-check the hidden type to fix #114728.
  //
  // However, we don't check that all types are well-formed.
  // We only do so for types provided by the user or if they are
  // "used", e.g. for method selection.
  //
  // This means we never check the wf requirements of the hidden
  // type during MIR borrowck, causing us to infer the wrong
  // lifetime for its member constraints which then results in
  // unexpected region errors.
  goals.push(Goal.new(as_interner(tcx), param_env, { $: "WellFormed", _0: Term.from_Ty(hidden_ty) } as ClauseKind, upcast_tcx(Predicate_upcast_from_ClauseKind)));

  const replace_opaques_in = (clause: Clause, goals: Goal<Predicate>[]): Clause =>
    fold_Clause.fold_with(
      clause,
      new BottomUpFolder(
        tcx,
        (ty) => {
          const kind = ty.kind();
          // We can't normalize associated types from `rustc_infer`,
          // but we can eagerly register inference variables for them.
          // FIXME(RPITIT): Don't replace RPITITs with inference vars.
          // FIXME(inherent_associated_types): Extend this to support `ty::Inherent`, too.
          if (kind.$ === "Alias" && kind._1.kind.$ === "Projection") {
            const projection_ty = kind._1;
            const def_id_ = kind._1.kind.def_id;
            if (!TypeVisitableExt.has_escaping_bound_vars(projection_ty, d_AliasTy) && !tcx.is_impl_trait_in_trait(def_id_) && !this.next_trait_solver()) {
              const ty_var = this.next_ty_var(this.tcx.def_span(def_id_));
              const projection: ProjectionClause = { projection_term: AliasTerm.from_AliasTy(projection_ty), term: Term.from_Ty(ty_var) };
              goals.push(Goal.new(as_interner(this.tcx), param_env, projection, upcast_tcx(Predicate_upcast_from_ProjectionClause)));
              return ty_var;
            }
          }
          // Replace all other mentions of the same opaque type with the hidden type,
          // as the bounds must hold on the hidden type after all.
          if (kind.$ === "Alias" && kind._1.kind.$ === "Opaque") {
            const def_id2 = kind._1.kind.def_id;
            const args2 = kind._1.args;
            if (DefId_eq(def_id, def_id2) && args === args2) {
              return hidden_ty;
            }
          }
          return ty;
        },
        (lt) => lt,
        (ct) => ct,
      ),
    );

  // PORT: the query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<&[(Clause, Span)]>`.
  const item_bounds = tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>;
  for (const u of EarlyBinder.iter_instantiated_copied(item_bounds, tcx, args, d_Clause_Span)) {
    const [predicate_] = Unnormalized.skip_norm_wip(u);
    const predicate = replace_opaques_in(predicate_, goals);

    // Require that the predicate holds for the concrete type.
    // debug!(?predicate);
    goals.push(Goal.new(as_interner(this.tcx), param_env, predicate, upcast_tcx(Predicate_upcast_from_Clause)));
  }

  // If this opaque is being defined and it's conditionally const,
  if (this.tcx.is_conditionally_const(def_id)) {
    // PORT: the query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<&[(PolyTraitRef, Span)]>`.
    const item_bounds = tcx.explicit_implied_const_bounds(def_id) as EarlyBinder<readonly [Binder<TraitRef>, Span][]>;
    for (const u of EarlyBinder.iter_instantiated_copied(item_bounds, tcx, args, d_PolyTraitRef_Span)) {
      const [predicate_] = Unnormalized.skip_norm_wip(u);
      const predicate = replace_opaques_in(PolyTraitRefC.to_host_effect_clause(predicate_, this.tcx, "Maybe"), goals);

      // Require that the predicate holds for the concrete type.
      // debug!(?predicate);
      goals.push(Goal.new(as_interner(this.tcx), param_env, predicate, upcast_tcx(Predicate_upcast_from_Clause)));
    }
  }
};

// ---- helpers ---------------------------------------------------------------------------------------------------------

/** The reflexive `impl<T> UpcastFrom<I, T> for T` (rustc_type_ir upcast.rs): `goal.predicate` is already a `Predicate`. */
function upcast_from_self<T>(from: T, _tcx: Interner): T {
  return from;
}

/** An `UpcastFrom` impl of rustc_middle ty/predicate.ts (over `TyCtxt`) at `Goal::new`'s `Interner` type. */
function upcast_tcx<T, P>(f: (from: T, tcx: TyCtxt) => P): (from: T, tcx: Interner) => P {
  return f as unknown as (from: T, tcx: Interner) => P;
}

/** `(Ty, Ty): TypeFoldable` (fold.rs's tuple impl). */
const d_Ty_Ty: TypeFoldable<[Ty, Ty]> = fold_tuple2(fold_Ty, fold_Ty);
/** `AliasTy: TypeVisitable` (generated). */
const d_AliasTy: TypeFoldable<AliasTy> = { visit_with: visit_with_AliasTy, try_fold_with: try_fold_with_AliasTy, fold_with: fold_with_AliasTy };
/** `(Clause, Span): TypeFoldable` (`Span` is trivially traversable). */
const d_Clause_Span: TypeFoldable<[Clause, Span]> = fold_tuple2(fold_Clause, fold_Span);
/** `(PolyTraitRef, Span): TypeFoldable`. */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_PolyTraitRef_Span: TypeFoldable<[Binder<TraitRef>, Span]> = fold_tuple2(fold_Binder(d_TraitRef), fold_Span);

