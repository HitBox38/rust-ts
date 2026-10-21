// Port of compiler/rustc_trait_selection/src/error_reporting/traits/ambiguity.rs (lane errrep-need-type-info).
//
// - `enum CandidateSource` is generated (ambiguity.gen.ts); `struct HasNumericInferVisitor` (a `TypeVisitor`) is the class
//   below.
// - The `impl TypeErrCtxt` methods are declared in ../../decls.ts (`// error_reporting/traits/ambiguity.rs:<line>`) and
//   assigned onto `TypeErrCtxt.prototype` here; `compute_applicable_impls_for_diagnostics` follows
//   `Fns_error_reporting_traits_ambiguity`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other crates;
// other rustc_trait_selection modules are read inside function bodies only (`traits_mod()`, `error_reporting_traits_mod()`,
// `engine()`, `evaluate_obligation()`).
export * from "./ambiguity.gen.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { MultiSpan } from "../../../rustc_error_messages/lib.ts";
import { type Diag, E0283, E0284, E0790, struct_span_code_err } from "../../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../../rustc_infer/infer/mod.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.gen.ts";
import { ToTrace_TraitRef } from "../../../rustc_infer/infer/at.ts";
import { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import { Obligation, type PolyTraitObligation, type PredicateObligation } from "../../../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause, Const, Predicate, Region, Term as TermT } from "../../../rustc_middle/ty/decls.ts";
import { Elaboratable_Clause_Span } from "../../../rustc_middle/ty/elaborate_impl.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { Generics, GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import type { Clauses } from "../../../rustc_middle/ty/list.ts";
import { Term, Ty } from "../../../rustc_middle/ty/mod.ts";
import {
  display_Predicate,
  display_Ty,
  PolyTraitClause_print_modifiers_and_trait_path,
  print_AliasTerm,
  print_Binder,
  print_Predicate,
  print_TraitClausePrintModifiersAndPath,
  type PrettyPrinter,
  type TraitClausePrintModifiersAndPath,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { Predicate_upcast_from_Clause } from "../../../rustc_middle/ty/predicate.ts";
import type { ImplTraitHeader } from "../../../rustc_middle/ty/mod.ts";
import { TraitImpls as TraitImplsC, type TraitImpls } from "../../../rustc_middle/ty/trait_def.ts";
import type { AssocItem } from "../../../rustc_middle/ty/assoc.gen.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { fold_Predicate, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { feature_err_unstable_feature_bound } from "../../../rustc_session/diagnostics.ts";
import { str_cmp } from "../../../rustc_session/options.ts";
import { CRATE_DEF_ID, DefId_eq, type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type PathBuf, Span } from "../../../rustc_span/lib.ts";
import { display_Ident, display_Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import { elaborate } from "../../../rustc_type_ir/elaborate.ts";
import { type FallibleTypeFolder, type PredicateProxy, type TypeFoldable, type TypeFolder } from "../../../rustc_type_ir/fold.ts";
import { as_interner, PolyTraitClause, TraitClause, TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { fold_with_TraitClause, fold_with_TraitRef, try_fold_with_TraitClause, try_fold_with_TraitRef, visit_with_TraitClause, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.gen.ts";
import type { TraitClause as TraitClauseT, TraitRef as TraitRefT } from "../../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { assert, unwrap } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { FulfillmentError } from "../../decls.ts";
import type { CandidateSource } from "./ambiguity.gen.ts";

/** `TypeFoldable for TraitRef` (the generated derive). */
const d_TraitRef: TypeFoldable<TraitRefT> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
/** `TypeFoldable for TraitClause` (the generated derive). */
const d_TraitClause: TypeFoldable<TraitClauseT> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};

/** traits/mod.ts (`ObligationCtxt`), read lazily (init order: same crate). */
function traits_mod(): typeof import("../../traits/mod.ts") {
  return require("../../traits/mod.ts") as typeof import("../../traits/mod.ts");
}
/** error_reporting/traits/mod.ts (`FindExprBySpan`, `to_pretty_impl_header`), read lazily (init order: same crate). */
function error_reporting_traits_mod(): typeof import("./mod.ts") {
  return require("./mod.ts") as typeof import("./mod.ts");
}
/** traits/query/evaluate_obligation.ts (`InferCtxtExt::evaluate_obligation`), loaded lazily (init order: same crate). */
function evaluate_obligation(): void {
  require("../../traits/query/evaluate_obligation.ts");
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/ambiguity.rs:33 compute_applicable_impls_for_diagnostics
export function compute_applicable_impls_for_diagnostics(
  infcx: InferCtxt,
  obligation: PolyTraitObligation,
  ignore_predicates_of_impls: boolean,
): CandidateSource[] {
  const tcx = infcx.tcx;
  const param_env = obligation.param_env;
  const { ObligationCtxt } = traits_mod();
  evaluate_obligation();

  const predicate_polarity = Binder.skip_binder(obligation.predicate).polarity;

  const impl_may_apply = (impl_def_id: DefId): boolean => {
    const ocx = ObligationCtxt.new(infcx);
    return infcx.enter_forall(
      obligation.predicate,
      (placeholder_obligation) => {
        const obligation_trait_ref = ocx.normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(placeholder_obligation.trait_ref), d_TraitRef);

        const impl_args = infcx.fresh_args_for_item(DUMMY_SP, impl_def_id);
        const impl_trait_ref_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.impl_trait_ref(impl_def_id), tcx, impl_args, d_TraitRef));
        const impl_trait_ref = ocx.normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(impl_trait_ref_), d_TraitRef);

        if (ocx.eq(ObligationCause.dummy(), param_env, obligation_trait_ref, impl_trait_ref, ToTrace_TraitRef).$ === "Err") {
          return false;
        }

        const impl_trait_header = tcx.impl_trait_header(impl_def_id) as ImplTraitHeader;
        const impl_polarity = impl_trait_header.polarity;

        if ((impl_polarity === "Positive" && predicate_polarity === "Positive") || (impl_polarity === "Negative" && predicate_polarity === "Negative")) {
          // ok
        } else {
          return false;
        }

        if (!ignore_predicates_of_impls) {
          const obligations = (function* (): Generator<PredicateObligation> {
            const instantiated = clauses_of_instantiate(tcx, impl_def_id, impl_args);
            for (const [clause] of instantiated.into_iter()) {
              const o = Obligation.new(tcx, ObligationCause.dummy(), param_env, Unnormalized.skip_norm_wip(clause), Predicate_upcast_from_Clause as (from: Clause, tcx: Interner) => Predicate);
              // Kinda hacky, but let's just throw away obligations that overflow.
              // This may reduce the accuracy of this check (if the obligation guides
              // inference or it actually resulted in error after others are processed)
              // ... but this is diagnostics code.
              if (infcx.next_trait_solver() || infcx.evaluate_obligation(o).$ === "Ok") {
                yield o;
              }
            }
          })();
          ocx.register_obligations(obligations);
        }

        return TraitErrors.no_errors(ocx.try_evaluate_obligations());
      },
      d_TraitClause,
    );
  };

  const param_env_candidate_may_apply = (poly_trait_predicate: Binder<TraitClauseT>): boolean => {
    const ocx = ObligationCtxt.new(infcx);
    return infcx.enter_forall(
      obligation.predicate,
      (placeholder_obligation) => {
        const obligation_trait_ref = ocx.normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(placeholder_obligation.trait_ref), d_TraitRef);

        const param_env_predicate = infcx.instantiate_binder_with_fresh_vars(
          DUMMY_SP,
          BoundRegionConversionTime.HigherRankedType,
          poly_trait_predicate,
          d_TraitClause,
        );
        const param_env_trait_ref = ocx.normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(param_env_predicate.trait_ref), d_TraitRef);

        if (ocx.eq(ObligationCause.dummy(), param_env, obligation_trait_ref, param_env_trait_ref, ToTrace_TraitRef).$ === "Err") {
          return false;
        }

        return TraitErrors.no_errors(ocx.try_evaluate_obligations());
      },
      d_TraitClause,
    );
  };

  const ambiguities: CandidateSource[] = [];

  tcx.for_each_relevant_impl(
    PolyTraitClause.def_id(obligation.predicate),
    TraitRef.self_ty(Binder.skip_binder(obligation.predicate).trait_ref),
    (impl_def_id) => {
      if (infcx.probe(() => impl_may_apply(impl_def_id))) {
        ambiguities.push({ $: "DefId", _0: impl_def_id });
      }
    },
    VisitorResultC.unit,
  );

  // If our `body_def_id` has been set (and isn't just from a dummy obligation cause),
  // then try to look for a param-env clause that would apply. The way we compute
  // this is somewhat manual, since we need the spans, so we elaborate this directly
  // from `clauses_of` rather than actually looking at the param-env which
  // otherwise would be more appropriate.
  const body_def_id = obligation.cause.body_def_id;
  if (body_def_id !== CRATE_DEF_ID) {
    const clauses = clauses_of_instantiate_identity(tcx, LocalDefId.to_def_id(body_def_id));
    for (const [clause, span] of elaborate(
      tcx,
      [...clauses.into_iter()].map(([c, s]): [Clause, Span] => [Unnormalized.skip_norm_wip(c), s]),
      Elaboratable_Clause_Span,
    )) {
      const kind = clause.kind();
      const sk = Binder.skip_binder(kind);
      if (sk.$ === "Trait" && param_env_candidate_may_apply(Binder.rebind(kind, sk._0))) {
        const trait_pred = sk._0;
        const a = Binder.rebind(kind, trait_pred.trait_ref);
        const b = Binder.dummy(TraitRef.identity(tcx, TraitClause.def_id(trait_pred)), d_TraitRef);
        if (binder_trait_ref_eq(a, b)) {
          ambiguities.push({ $: "ParamEnv", _0: tcx.def_span(TraitClause.def_id(trait_pred)) });
        } else {
          ambiguities.push({ $: "ParamEnv", _0: span });
        }
      }
    }
  }

  return ambiguities;
}

/** `tcx.clauses_of(def_id).instantiate(tcx, args)`. */
function clauses_of_instantiate(tcx: TyCtxt, def_id: DefId, args: import("../../../rustc_middle/ty/generic_args.ts").GenericArgs): import("../../../rustc_middle/ty/mod.ts").InstantiatedClauses {
  const { GenericClauses } = require("../../../rustc_middle/ty/generics.ts") as typeof import("../../../rustc_middle/ty/generics.ts");
  return GenericClauses.instantiate(tcx.clauses_of(def_id) as GenericClauses, tcx, args);
}

/** `tcx.clauses_of(def_id).instantiate_identity(tcx)`. */
function clauses_of_instantiate_identity(tcx: TyCtxt, def_id: DefId): import("../../../rustc_middle/ty/mod.ts").InstantiatedClauses {
  const { GenericClauses } = require("../../../rustc_middle/ty/generics.ts") as typeof import("../../../rustc_middle/ty/generics.ts");
  return GenericClauses.instantiate_identity(tcx.clauses_of(def_id) as GenericClauses, tcx);
}

/** The derived `PartialEq` of `Binder<TraitRef>` (`value`, then `bound_vars`; the interned lists compare by identity). */
function binder_trait_ref_eq(a: Binder<TraitRefT>, b: Binder<TraitRefT>): boolean {
  return trait_ref_eq(a.value, b.value) && a.bound_vars === b.bound_vars;
}

/** The derived `PartialEq` of `TraitRef` (`def_id`, `args`). */
function trait_ref_eq(a: TraitRefT, b: TraitRefT): boolean {
  return DefId_eq(a.def_id, b.def_id) && a.args === b.args;
}

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

/// The term of an ambiguous obligation's predicate that gets blamed for the
/// missing type annotation: the first one still containing inference variables.
///
/// Besides `maybe_report_ambiguity` pointing its diagnostics at this term,
/// `report_fulfillment_errors` merges the ambiguity errors whose blamed terms
/// share an inference variable into a single diagnostic.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/ambiguity.rs:184 ambiguity_term
TypeErrCtxt.prototype.ambiguity_term = function (this: TypeErrCtxt, predicate: Predicate): TermT | undefined {
  const pk = Binder.skip_binder(predicate.kind());
  if (pk.$ === "Clause") {
    const ck = pk._0;
    switch (ck.$) {
      case "Trait":
        return find_term(ck._0.trait_ref.args.terms(), (term) => TypeVisitableExt.has_non_region_infer(term, fold_Term()));
      case "Projection": {
        const data = ck._0;
        return find_term(chain_terms(data.projection_term.args.terms(), data.term), (term) =>
          TypeVisitableExt.has_non_region_infer(term, fold_Term()),
        );
      }
      case "WellFormed":
        return ck._0;
      case "ConstEvaluatable": {
        const data = ck._0;
        for (const arg of data.walk()) {
          const term = GenericArg.as_term(arg);
          if (term !== undefined && Term.is_infer(term)) return term;
        }
        return undefined;
      }
      case "ConstArgHasType":
        return Term.from_Const(ck._0);
      default:
        return undefined;
    }
  } else if (pk.$ === "Subtype") {
    return Term.from_Ty(pk._0.a);
  } else if (pk.$ === "NormalizesTo" && Term.is_infer(pk._0.term)) {
    return pk._0.term;
  } else {
    return undefined;
  }
};

/** `iter.find(pred)`. */
function find_term(it: Iterable<TermT>, pred: (t: TermT) => boolean): TermT | undefined {
  for (const t of it) if (pred(t)) return t;
  return undefined;
}
/** `terms().chain([term])`. */
function* chain_terms(it: Iterable<TermT>, last: TermT): Generator<TermT> {
  yield* it;
  yield last;
}
/** `TypeFoldable for Term` (rustc_middle ty/mod.ts), read lazily. */
function fold_Term(): TypeFoldable<TermT> {
  return (require("../../../rustc_middle/ty/mod.ts") as typeof import("../../../rustc_middle/ty/mod.ts")).fold_Term;
}

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/ambiguity.rs:207 maybe_report_ambiguity
TypeErrCtxt.prototype.maybe_report_ambiguity = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  related: readonly FulfillmentError[],
): ErrorGuaranteed {
  // Unable to successfully determine, probably means
  // insufficient type information, but could mean
  // ambiguous impls. The latter *ought* to be a
  // coherence violation, so we don't report it here.

  const predicate = this.deeply_resolve_ignoring_regions(obligation.predicate, fold_Predicate);
  const span = obligation.cause.span;
  const long_ty_path: MutRef<PathBuf | undefined> = { value: undefined };

  // debug!(?predicate, obligation.cause.code = ?obligation.cause.code_());

  // Ambiguity errors are often caused as fallout from earlier errors.
  // We ignore them if this `infcx` is tainted in some cases below.

  const bound_predicate = predicate.kind();
  const bk = Binder.skip_binder(bound_predicate);
  let err: Diag;
  if (bk.$ === "Clause" && bk._0.$ === "Trait") {
    const data = bk._0._0;
    const trait_pred = Binder.rebind(bound_predicate, data);
    // debug!(?trait_pred);

    let e: ReturnType<typeof TypeVisitableExt.error_reported>;
    if ((e = TypeVisitableExt.error_reported(predicate, fold_Predicate)).$ === "Err") {
      return e._0;
    }

    const coherent = this.tcx.ensure_result().coherent_trait(PolyTraitClause.def_id(trait_pred));
    if (coherent.$ === "Err") {
      // Avoid bogus "type annotations needed `Foo: Bar`" errors on `impl Bar for
      // Foo` in case other `Foo` impls are incoherent.
      return coherent._0;
    }

    // This is kind of a hack: it frequently happens that some earlier
    // error prevents types from being fully inferred, and then we get
    // a bunch of uninteresting errors saying something like "<generic
    // #0> doesn't implement Sized". It may even be true that we
    // could just skip over all checks where the self-ty is an
    // inference variable, but I was afraid that there might be an
    // inference variable created, registered as an obligation, and
    // then never forced by writeback, and hence by skipping here we'd
    // be ignoring the fact that we don't KNOW the type works
    // out. Though even that would probably be harmless, given that
    // we're only talking about builtin traits, which are known to be
    // inhabited. We used to check for `self.tainted_by_errors()` to
    // avoid inundating the user with unnecessary errors, but we now
    // check upstream for type errors and don't add the obligations to
    // begin with in those cases.
    const li = this.tcx.as_lang_item(PolyTraitClause.def_id(trait_pred));
    if (li === LangItem.Sized || li === LangItem.MetaSized) {
      const tainted = this.tainted_by_errors();
      if (tainted === undefined) {
        return this.emit_inference_failure_err(
          obligation.cause.body_def_id,
          span,
          Term.from_Ty(Binder.skip_binder(PolyTraitClause.self_ty(trait_pred))),
          "E0282",
          false,
        ).emit_err();
      } else {
        return tainted;
      }
    }

    // Typically, this ambiguity should only happen if
    // there are unresolved type inference variables
    // (otherwise it would suggest a coherence
    // failure). But given #21974 that is not necessarily
    // the case -- we can have multiple where clauses that
    // are only distinguished by a region, which results
    // in an ambiguity even when all types are fully
    // known, since we don't dispatch based on region
    // relationships.

    // Pick the first generic parameter that still contains inference variables as the one
    // we're going to emit an error for. If there are none (see above), fall back to
    // a more general error.
    const term = this.ambiguity_term(predicate);

    let err_: Diag;
    if (term !== undefined) {
      const candidates: Ty[] = [];
      for (const def_id of this.tcx.all_impls(PolyTraitClause.def_id(trait_pred))) {
        const imp_ = this.tcx.impl_trait_header(def_id) as ImplTraitHeader;
        if (imp_.polarity !== "Positive" || !this.tcx.is_user_visible_dep(def_id.krate)) {
          continue;
        }
        const imp = EarlyBinder.skip_binder(imp_.trait_ref);
        if (trait_ref_eq(TraitRef.with_replaced_self_ty(imp, as_interner(this.tcx), TraitClause.self_ty(Binder.skip_binder(trait_pred))), Binder.skip_binder(trait_pred).trait_ref)) {
          candidates.push(TraitRef.self_ty(imp));
        }
      }
      err_ = this.emit_inference_failure_err_with_type_hint(
        obligation.cause.body_def_id,
        span,
        term,
        "E0283",
        true,
        candidates.length === 1 ? candidates[0] : undefined,
      );
    } else {
      err_ = struct_span_code_err(
        this.dcx(),
        span,
        E0283,
        `type annotations needed: cannot satisfy \`${this.tcx.short_string(predicate, long_ty_path, print_Predicate)}\``,
      ).with_long_ty_path(long_ty_path.value);
    }
    err = err_;

    const ambiguities = this.applicable_impls_to_mention(obligation, trait_pred);
    if (ambiguities !== undefined) {
      const e = this.tainted_by_errors();
      if (e !== undefined && term === undefined) {
        // If `arg.is_none()`, then this is probably two param-env
        // candidates or impl candidates that are equal modulo lifetimes.
        // Therefore, if we've already emitted an error, just skip this
        // one, since it's not particularly actionable.
        err.cancel();
        return e;
      }
      this.annotate_source_of_ambiguity(err, ambiguities, predicate);
    } else {
      const e = this.tainted_by_errors();
      if (e !== undefined) {
        err.cancel();
        return e;
      }
      const clause_ = predicate.as_trait_clause();
      if (clause_ !== undefined && Binder.skip_binder(PolyTraitClause.self_ty(clause_)).kind().$ === "Infer") {
        const tr = this.tcx.short_string(PolyTraitClause_print_modifiers_and_trait_path(clause_), err.long_ty_path(), print_PolyTraitClausePrintModifiersAndPath);
        err.note(`the type must implement \`${tr}\``);
      } else {
        const pred = this.tcx.short_string(predicate, err.long_ty_path(), print_Predicate);
        err.note(`cannot satisfy \`${pred}\``);
      }
      const clause = unwrap(predicate.as_trait_clause());
      const impl_candidates = this.find_similar_impl_candidates(PolyTraitClause.def_id(clause), Binder.skip_binder(PolyTraitClause.self_ty(clause)));
      if (impl_candidates.length < 40) {
        this.report_similar_impl_candidates(impl_candidates, obligation, trait_pred, obligation.cause.body_def_id, err, false, obligation.param_env);
      }
    }

    const code = obligation.cause.code_();
    if (code.$ === "WhereClause" || code.$ === "WhereClauseInExpr") {
      const def_id = code._0;
      this.suggest_fully_qualified_path(err, def_id, span, PolyTraitClause.def_id(trait_pred));
    }

    let body: ReturnType<TyCtxt["hir_maybe_body_owned_by"]>;
    if (term !== undefined && Term.as_type(term) !== undefined && (body = this.tcx.hir_maybe_body_owned_by(obligation.cause.body_def_id)) !== undefined) {
      const expr_finder = error_reporting_traits_mod().FindExprBySpan.new(span, this.tcx);
      expr_finder.visit_expr(body.value);

      const m = match_assoc_item_call(expr_finder.result);
      if (m !== undefined) {
        const { path, trait_path_segment, trait_id, assoc_item_ident, item_id } = m;
        let trait_of: DefId | undefined;
        if (
          DefId_eq(data.trait_ref.def_id, trait_id) &&
          (trait_of = this.tcx.trait_of_assoc(item_id)) !== undefined &&
          DefId_eq(trait_of, trait_id) &&
          this.tainted_by_errors() === undefined
        ) {
          const assoc_item = this.tcx.associated_item(item_id) as AssocItem;
          let verb: string;
          let noun: string;
          switch (assoc_item.kind.$) {
            case "Const":
              [verb, noun] = ["refer to the", "constant"];
              break;
            case "Fn":
              [verb, noun] = ["call", "function"];
              break;
            // This is already covered by E0223, but this following single match
            // arm doesn't hurt here.
            case "Type":
              [verb, noun] = ["refer to the", "type"];
              break;
          }

          // Replace the more general E0283 with a more specific error
          err.cancel();
          err = this.dcx().struct_span_err(span, `cannot ${verb} associated ${noun} on trait without specifying the corresponding \`impl\` type`);
          err.code(E0790);

          if (item_id.is_local()) {
            const trait_ident = this.tcx.item_name(trait_id);
            err.span_label(this.tcx.def_span(item_id), `\`${display_Symbol(trait_ident)}::${display_Ident(assoc_item_ident)}\` defined here`);
          }

          err.span_label(span, `cannot ${verb} associated ${noun} of trait`);

          const trait_impls = this.tcx.trait_impls_of(data.trait_ref.def_id) as TraitImpls;

          const non_blanket = (): DefId[] => [...TraitImplsC.non_blanket_impls(trait_impls).values()].flat();
          const impl_def_id = non_blanket()[0];
          if (impl_def_id !== undefined) {
            const non_blanket_impl_count = non_blanket().length;
            // If there is only one implementation of the trait, suggest using it.
            // Otherwise, use a placeholder comment for the implementation.
            let message: string;
            let self_types: string[];
            if (non_blanket_impl_count === 1) {
              message = "use the fully-qualified path to the only available implementation";
              self_types = [display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(impl_def_id) as EarlyBinder<Ty>)))];
            } else if (non_blanket_impl_count < 20) {
              message = "use a fully-qualified path to one of the available implementations";
              self_types = non_blanket().map((id) => display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(id) as EarlyBinder<Ty>))));
            } else {
              message = "use a fully-qualified path to a specific available implementation";
              self_types = ["/* self type */"];
            }
            const suggestions: [Span, string][][] = self_types.map((self_type) => {
              const suggestions: [Span, string][] = [[Span.shrink_to_lo(path.span), `<${self_type} as `]];
              const generic_arg = trait_path_segment.args;
              if (generic_arg !== undefined) {
                const between_span = Span.between(trait_path_segment.ident.span, generic_arg.span_ext);
                // get rid of :: between Trait and <type>
                // must be '::' between them, otherwise the parser won't accept the code
                suggestions.push([between_span, ""]);
                suggestions.push([Span.shrink_to_hi(generic_arg.span_ext), ">"]);
              } else {
                suggestions.push([Span.shrink_to_hi(trait_path_segment.ident.span), ">"]);
              }
              return suggestions;
            });
            err.multipart_suggestions(message, suggestions, "MaybeIncorrect");
          }
        }
      }
    }
  } else if (bk.$ === "Clause" && bk._0.$ === "WellFormed") {
    const term = bk._0._0;
    // Same hacky approach as above to avoid deluging user
    // with error messages.

    let e: ReturnType<typeof TypeVisitableExt.error_reported>;
    if ((e = TypeVisitableExt.error_reported(term, fold_Term())).$ === "Err") {
      return e._0;
    }
    const tainted = this.tainted_by_errors();
    if (tainted !== undefined) {
      return tainted;
    }

    err = this.emit_inference_failure_err(obligation.cause.body_def_id, span, term, "E0282", false);
  } else if (bk.$ === "Subtype") {
    const data = bk._0;
    let e: ReturnType<typeof TypeVisitableExt.error_reported>;
    if ((e = TypeVisitableExt.error_reported(data, d_SubtypePredicate())).$ === "Err") {
      return e._0;
    }
    const tainted = this.tainted_by_errors();
    if (tainted !== undefined) {
      return tainted;
    }
    const { a, b } = data;
    // both must be type variables, or the other would've been instantiated
    assert(a.is_ty_var() && b.is_ty_var(), "assertion failed: a.is_ty_var() && b.is_ty_var()");
    err = this.emit_inference_failure_err(obligation.cause.body_def_id, span, Term.from_Ty(a), "E0282", true);
  } else if (bk.$ === "Clause" && bk._0.$ === "Projection") {
    const data = bk._0._0;
    let e: ReturnType<typeof TypeVisitableExt.error_reported>;
    if ((e = TypeVisitableExt.error_reported(predicate, fold_Predicate)).$ === "Err") {
      return e._0;
    }
    const tainted = this.tainted_by_errors();
    if (tainted !== undefined) {
      return tainted;
    }

    if (projection_kind_is_trait_projection(data.projection_term.kind)) {
      const coherent = this.tcx.ensure_result().coherent_trait(this.tcx.parent(projection_clause_def_id(data)));
      if (coherent.$ === "Err") {
        // Avoid bogus "type annotations needed `Foo: Bar`" errors on `impl Bar for Foo` in case
        // other `Foo` impls are incoherent.
        return coherent._0;
      }
    }
    const term = this.ambiguity_term(predicate);
    const predicate_ = this.tcx.short_string(predicate, long_ty_path, print_Predicate);
    if (term !== undefined) {
      err = this.emit_inference_failure_err(obligation.cause.body_def_id, span, term, "E0284", true)
        .with_note(`cannot satisfy \`${predicate_}\``)
        .with_long_ty_path(long_ty_path.value);
    } else {
      // If we can't find a generic parameter, just print a generic error
      err = struct_span_code_err(this.dcx(), span, E0284, `type annotations needed: cannot satisfy \`${predicate_}\``)
        .with_span_label(span, `cannot satisfy \`${predicate_}\``)
        .with_long_ty_path(long_ty_path.value);
    }
  } else if (bk.$ === "Clause" && bk._0.$ === "ConstEvaluatable") {
    let e: ReturnType<typeof TypeVisitableExt.error_reported>;
    if ((e = TypeVisitableExt.error_reported(predicate, fold_Predicate)).$ === "Err") {
      return e._0;
    }
    const tainted = this.tainted_by_errors();
    if (tainted !== undefined) {
      return tainted;
    }
    const term = this.ambiguity_term(predicate);
    if (term !== undefined) {
      err = this.emit_inference_failure_err(obligation.cause.body_def_id, span, term, "E0284", true);
    } else {
      // If we can't find a generic parameter, just print a generic error
      const predicate_ = this.tcx.short_string(predicate, long_ty_path, print_Predicate);
      err = struct_span_code_err(this.dcx(), span, E0284, `type annotations needed: cannot satisfy \`${predicate_}\``)
        .with_span_label(span, `cannot satisfy \`${predicate_}\``)
        .with_long_ty_path(long_ty_path.value);
    }
  } else if (bk.$ === "Clause" && bk._0.$ === "ConstArgHasType") {
    const ct = bk._0._0;
    err = this.emit_inference_failure_err(obligation.cause.body_def_id, span, Term.from_Const(ct), "E0284", true);
  } else if (bk.$ === "NormalizesTo" && Term.is_infer(bk._0.term)) {
    const { alias } = bk._0;
    const tainted = this.tainted_by_errors();
    if (tainted !== undefined) {
      return tainted;
    }
    const alias_ = this.tcx.short_string(alias, long_ty_path, print_AliasTerm);
    err = struct_span_code_err(this.dcx(), span, E0284, `type annotations needed: cannot normalize \`${alias_}\``)
      .with_span_label(span, `cannot normalize \`${alias_}\``)
      .with_long_ty_path(long_ty_path.value);
  } else if (bk.$ === "Clause" && bk._0.$ === "UnstableFeature") {
    const sym = bk._0._0;
    const tainted = this.tainted_by_errors();
    if (tainted !== undefined) {
      return tainted;
    }

    if (this.tcx.features().staged_api()) {
      err = this.dcx()
        .struct_span_err(span, `unstable feature \`${display_Symbol(sym)}\` is used without being enabled.`)
        .with_help(`The feature can be enabled by marking the current item with \`#[unstable_feature_bound(${display_Symbol(sym)})]\``);
    } else {
      err = feature_err_unstable_feature_bound(this.tcx.sess, sym, span, `use of unstable library feature \`${display_Symbol(sym)}\``);
    }
  } else {
    const tainted = this.tainted_by_errors();
    if (tainted !== undefined) {
      return tainted;
    }
    const predicate_ = this.tcx.short_string(predicate, long_ty_path, print_Predicate);
    err = struct_span_code_err(this.dcx(), span, E0284, `type annotations needed: cannot satisfy \`${predicate_}\``)
      .with_span_label(span, `cannot satisfy \`${predicate_}\``)
      .with_long_ty_path(long_ty_path.value);
  }

  // The related obligations are ambiguous because of the same inference variable,
  // so they belong to this diagnostic: annotating the variable has to satisfy all
  // of them at once. Mention their requirements, except for bookkeeping predicates
  // (`WellFormed`, sizedness, ...) whose mention wouldn't be actionable.
  const mentioned: Predicate[] = [predicate];
  const mentioned_strs: string[] = [];
  for (const error of related) {
    const related_pred = this.deeply_resolve_ignoring_regions(error.obligation.predicate, fold_Predicate);
    if (mentioned.includes(related_pred)) {
      continue;
    }
    let note: string;
    const rk = Binder.skip_binder(related_pred.kind());
    let li: LangItem | undefined;
    if (
      rk.$ === "Clause" &&
      rk._0.$ === "Trait" &&
      !((li = this.tcx.as_lang_item(TraitClause.def_id(rk._0._0))) === LangItem.Sized || li === LangItem.MetaSized || li === LangItem.PointeeSized)
    ) {
      const data = rk._0._0;
      const clause = Binder.rebind(related_pred.kind(), data);
      if (Binder.skip_binder(PolyTraitClause.self_ty(clause)).kind().$ === "Infer") {
        const tr = this.tcx.short_string(PolyTraitClause_print_modifiers_and_trait_path(clause), err.long_ty_path(), print_PolyTraitClausePrintModifiersAndPath);
        note = `the type must also implement \`${tr}\``;
      } else {
        const pred = this.tcx.short_string(related_pred, err.long_ty_path(), print_Predicate);
        const note_ = `cannot satisfy \`${pred}\``;
        // The self type is known, so the `impl`s that could have applied to it are
        // few and worth pointing at, like the blamed bound does. When it is still
        // an inference variable the list is every `impl` of the trait, which is
        // why the branch above only names the trait.
        //
        // `tainted_by_errors` is checked because `annotate_source_of_ambiguity`
        // downgrades the whole diagnostic once an error was already emitted.
        let ambiguities: CandidateSource[] | undefined;
        if (
          !mentioned_strs.includes(note_) &&
          this.tainted_by_errors() === undefined &&
          (ambiguities = this.applicable_impls_to_mention(error.obligation, clause)) !== undefined
        ) {
          this.annotate_source_of_ambiguity(err, ambiguities, related_pred);
          mentioned_strs.push(note_);
          mentioned.push(related_pred);
          continue;
        }
        note = note_;
      }
    } else if (rk.$ === "Clause" && rk._0.$ === "Projection") {
      const pred = this.tcx.short_string(related_pred, err.long_ty_path(), print_Predicate);
      note = `cannot satisfy \`${pred}\``;
    } else {
      mentioned.push(related_pred);
      continue;
    }
    // Two predicates can print identically (e.g. `From<?0>` and `From<?1>` both show as
    // `From<_>`); only emit each unique note string once.
    if (!mentioned_strs.includes(note)) {
      err.note(note);
      mentioned_strs.push(note);
    }
    mentioned.push(related_pred);
  }

  this.note_obligation_cause(err, obligation);
  // The merged errors are not reported on their own anymore, so the bounds they came from
  // have to be explained here too. Causes shared with the blamed obligation are already
  // described by the call above.
  for (const error of related) {
    if (intern_key(error.obligation.cause.code_()) !== intern_key(obligation.cause.code_())) {
      this.note_obligation_cause(err, error.obligation);
    }
  }
  return err.emit_err();
};


/** `Print for Binder<TraitClausePrintModifiersAndPath>` (the `IrPrint` of the binder: pretty.rs `forward_display_to_print`). */
function print_PolyTraitClausePrintModifiersAndPath(self: Binder<TraitClausePrintModifiersAndPath>, p: PrettyPrinter): ReturnType<typeof print_Binder> {
  return print_Binder(self, p, print_TraitClausePrintModifiersAndPath, fold_TraitClausePrintModifiersAndPath_);
}

// PORT: pretty.rs:3056 `#[derive(TypeFoldable, TypeVisitable)]` of the newtype `TraitClausePrintModifiersAndPath(TraitClause)`,
// written out as infer/mod.ts's `fold_TraitRefPrintSugared` (the derive forwards to the field; codegen has no descriptor yet).
const fold_TraitClausePrintModifiersAndPath_: TypeFoldable<TraitClausePrintModifiersAndPath> = {
  visit_with: (self, visitor) => visit_with_TraitClause(self._0, visitor),
  try_fold_with: <E>(self: TraitClausePrintModifiersAndPath, folder: FallibleTypeFolder<E>): Result<TraitClausePrintModifiersAndPath, E> => {
    const r = try_fold_with_TraitClause(self._0, folder);
    if (r.$ === "Err") return r;
    return Ok({ _0: r._0 });
  },
  fold_with: (self, folder: TypeFolder) => ({ _0: fold_with_TraitClause(self._0, folder) }),
};

/** `TypeVisitable for SubtypePredicate` (generated), read lazily. */
function d_SubtypePredicate(): TypeVisitable<import("../../../rustc_type_ir/predicate.gen.ts").SubtypePredicate> {
  const g = require("../../../rustc_type_ir/predicate.gen.ts") as typeof import("../../../rustc_type_ir/predicate.gen.ts");
  return { visit_with: g.visit_with_SubtypePredicate };
}

/** `data.projection_term.kind.is_trait_projection()`. */
function projection_kind_is_trait_projection(kind: import("../../../rustc_type_ir/ty/alias.ts").AliasTerm["kind"]): boolean {
  const { AliasTermKind } = require("../../../rustc_type_ir/term_kind.ts") as typeof import("../../../rustc_type_ir/term_kind.ts");
  return AliasTermKind.is_trait_projection(kind);
}

/** `ProjectionClause::def_id`. */
function projection_clause_def_id(data: import("../../../rustc_type_ir/predicate_kind.gen.ts").ClauseKind & { $: "Projection" } extends { _0: infer P } ? P : never): DefId {
  const { ProjectionClause } = require("../../../rustc_type_ir/predicate.ts") as typeof import("../../../rustc_type_ir/predicate.ts");
  return ProjectionClause.def_id(data);
}

/**
 * PORT: the `let`-chain of `maybe_report_ambiguity`'s E0790 branch:
 * `Some(hir::Expr { kind: Call(Expr { kind: Path(Resolved(None, path)) }, _) | Path(Resolved(None, path)), .. })` and
 * `let [.., trait_path_segment @ PathSegment { res: Res::Def(DefKind::Trait, trait_id), .. }, PathSegment { ident:
 * assoc_item_ident, res: Res::Def(_, item_id), .. }] = path.segments`.
 */
function match_assoc_item_call(result: import("../../../rustc_hir/lib.ts").Expr | undefined):
  | {
      path: import("../../../rustc_hir/lib.ts").Path;
      trait_path_segment: import("../../../rustc_hir/lib.ts").PathSegment;
      trait_id: DefId;
      assoc_item_ident: import("../../../rustc_span/symbol.ts").Ident;
      item_id: DefId;
    }
  | undefined {
  if (result === undefined) return undefined;
  let path: import("../../../rustc_hir/lib.ts").Path;
  const k = result.kind;
  if (k.$ === "Call" && k._0.kind.$ === "Path" && k._0.kind._0.$ === "Resolved" && k._0.kind._0._0 === undefined) {
    path = k._0.kind._0._1;
  } else if (k.$ === "Path" && k._0.$ === "Resolved" && k._0._0 === undefined) {
    path = k._0._1;
  } else {
    return undefined;
  }
  const segs = path.segments;
  if (segs.length < 2) return undefined;
  const trait_path_segment = segs[segs.length - 2]!;
  const last = segs[segs.length - 1]!;
  if (trait_path_segment.res.$ !== "Def" || trait_path_segment.res._0.$ !== "Trait") return undefined;
  if (last.res.$ !== "Def") return undefined;
  return { path, trait_path_segment, trait_id: trait_path_segment.res._1, assoc_item_ident: last.ident, item_id: last.res._1 };
}

/// The `impl`s and `where` clauses that could have satisfied `trait_pred`, when listing them
/// is likely to help. `None` means the caller should describe the bound some other way.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/ambiguity.rs:791 applicable_impls_to_mention
TypeErrCtxt.prototype.applicable_impls_to_mention = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_pred: Binder<TraitClauseT>,
): CandidateSource[] | undefined {
  let ambiguities = compute_applicable_impls_for_diagnostics(
    this.infcx,
    obligation.with(this.tcx, trait_pred, (p: Binder<TraitClauseT>) => p),
    false,
  );
  const has_non_region_infer = [...Binder.skip_binder(trait_pred).trait_ref.args.types()].some((t) => !t.is_ty_or_numeric_infer());
  // It doesn't make sense to talk about applicable impls if there are more than a
  // handful of them. If there are a lot of them, but only a few of them have no type
  // params, we only show those, as they are more likely to be useful/intended.
  if (ambiguities.length > 5) {
    const infcx = this.infcx;
    const keep = (option: CandidateSource): boolean => {
      switch (option.$) {
        case "DefId":
          return (infcx.tcx.generics_of(option._0) as Generics).count() === 0;
        case "ParamEnv":
          return true;
      }
    };
    if (!ambiguities.every(keep)) {
      // If not all are blanket impls, we filter blanked impls out.
      ambiguities = ambiguities.filter(keep);
    }
  }
  return ambiguities.length > 1 && ambiguities.length < 10 && has_non_region_infer ? ambiguities : undefined;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/ambiguity.rs:823 annotate_source_of_ambiguity
TypeErrCtxt.prototype.annotate_source_of_ambiguity = function (
  this: TypeErrCtxt,
  err: Diag,
  ambiguities: readonly CandidateSource[],
  predicate: Predicate,
): void {
  const spans: Span[] = [];
  const crates: string[] = [];
  const post_: string[] = [];
  let has_param_env = false;
  for (const ambiguity of ambiguities) {
    switch (ambiguity.$) {
      case "DefId": {
        const impl_def_id = ambiguity._0;
        const r = this.tcx.span_of_impl(impl_def_id);
        if (r.$ === "Ok") {
          spans.push(r._0);
        } else {
          crates.push(display_Symbol(r._0));
          const header = error_reporting_traits_mod().to_pretty_impl_header(this.tcx, impl_def_id);
          if (header !== undefined) {
            post_.push(header);
          }
        }
        break;
      }
      case "ParamEnv":
        has_param_env = true;
        spans.push(ambiguity._0);
        break;
    }
  }
  const crate_names = dedup(crates.map((n) => `\`${n}\``).sort(str_cmp));
  const post = dedup(post_.sort(str_cmp));

  if (
    this.tainted_by_errors() !== undefined &&
    ((crate_names.length === 1 && spans.length === 0 && ["`core`", "`alloc`", "`std`"].includes(crate_names[0]!)) ||
      fold_Predicate.visit_with(predicate, new HasNumericInferVisitor()).$ === "Break")
  ) {
    // Avoid complaining about other inference issues for expressions like
    // `42 >> 1`, where the types are still `{integer}`, but we want to
    // Do we need `trait_ref.skip_binder().self_ty().is_numeric() &&` too?
    // NOTE(eddyb) this was `.cancel()`, but `err`
    // is borrowed, so we can't fully defuse it.
    err.downgrade_to_delayed_bug();
    return;
  }

  const msg = `multiple \`impl\`s${has_param_env ? " or `where` clauses" : ""} satisfying \`${display_Predicate(predicate)}\` found`;
  let post_str: string;
  if (post.length > 1 || (post.length === 1 && post[0]!.includes("\n"))) {
    post_str = `:\n${post.map((p) => `- ${p}`).join("\n")}`;
  } else if (post.length === 1) {
    post_str = `: \`${post[0]!}\``;
  } else {
    post_str = "";
  }

  if (spans.length === 0 && crates.length === 0 && crate_names.length === 0) {
    err.note(`cannot satisfy \`${display_Predicate(predicate)}\``);
  } else if (spans.length === 0 && crate_names.length === 1) {
    err.note(`${msg} in the \`${crates[0]!}\` crate${post_str}`);
  } else if (spans.length === 0) {
    err.note(`${msg} in the following crates: ${crate_names.join(", ")}${post_str}`);
  } else if (crates.length === 0 && crate_names.length === 0) {
    const span = MultiSpan.from_spans(spans);
    err.span_note(span, msg);
  } else if (crates.length === 1 && crate_names.length === 1) {
    const span = MultiSpan.from_spans(spans);
    err.span_note(span, msg);
    err.note(`and another \`impl\` found in the \`${crates[0]!}\` crate${post_str}`);
  } else {
    const span = MultiSpan.from_spans(spans);
    err.span_note(span, msg);
    err.note(`and more \`impl\`s found in the following crates: ${crate_names.join(", ")}${post_str}`);
  }
};

/** `Vec::dedup` (consecutive duplicates). */
function dedup(v: string[]): string[] {
  return v.filter((s, i) => i === 0 || v[i - 1] !== s);
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/ambiguity.rs:921 HasNumericInferVisitor
export class HasNumericInferVisitor implements TypeVisitor<ControlFlow<null>> {
  /** `impl TypeVisitor`: `type Result = ControlFlow<()>`. */
  readonly Result: VisitorResult<ControlFlow<null>, null> = VisitorResultC.ControlFlow<null>();

  // ---- impl<'tcx> ty::TypeVisitor<TyCtxt<'tcx>> for HasNumericInferVisitor ----

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/ambiguity.rs:926 visit_ty
  visit_ty(ty: Ty): ControlFlow<null> {
    const k = ty.kind();
    if (k.$ === "Infer" && (k._0.$ === "FloatVar" || k._0.$ === "IntVar")) {
      return ControlFlow.Break(null);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // (provided) the methods `HasNumericInferVisitor` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): ControlFlow<null> {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): ControlFlow<null> {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}
