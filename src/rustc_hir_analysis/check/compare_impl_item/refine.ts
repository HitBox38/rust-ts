// Port of compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs (lane check-compare, wave 17).
//
// Init order: top-level code here touches only other crates; ../compare_impl_item.ts (`super`) is read inside function
// bodies only.
//
// PORT notes (file-wide):
// - `FxIndexSet<GenericArg>` / `FxIndexSet<Clause>` of interned values are `Set`s; `FxIndexSet<ProjectionAliasTy>` is a
//   `KeyedSet` on the derived `Eq` (`intern_key`).
// - `iter().zip_eq(..)` panics on a length mismatch with itertools' message (precedent: variance/mod.ts).
// - (lane small-gaps-18) The former stand-ins for rustc_middle's `LateParamRegionKind::from_bound` and
//   `impl Elaboratable for (Clause, Span)` are replaced by their ports (ty/region.ts, ty/elaborate_impl.ts).
import { ObligationCtxt } from "../../../rustc_trait_selection/traits/engine.ts";
import { normalize_param_env_or_error } from "../../../rustc_trait_selection/traits/mod.ts";
import { type VisitorResult, VisitorResult as VisitorResultC } from "../../../rustc_ast_ir/visit.ts";
import type { ErrorGuaranteed } from "../../../rustc_errors/lib.ts";
import { Node } from "../../../rustc_hir/hir.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import type { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import * as rustc_infer from "../../../rustc_infer/lib.ts";
import { REFINING_IMPL_TRAIT_INTERNAL, REFINING_IMPL_TRAIT_REACHABLE } from "../../../rustc_lint_defs/builtin.gen.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Const } from "../../../rustc_middle/ty/decls.ts";
import { fold_List_Ty, GenericArg, visit_with_GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { type Clauses, RawList } from "../../../rustc_middle/ty/list.ts";
import { Asyncness, ParamEnv, Term, Ty, Visibility } from "../../../rustc_middle/ty/mod.ts";
import { type Clause, visit_with_Clause } from "../../../rustc_middle/ty/predicate.ts";
import { display_GenericArg, display_Ty, with_no_trimmed_paths, with_types_for_signature } from "../../../rustc_middle/ty/print/pretty.ts";
import { Elaboratable_Clause_Span } from "../../../rustc_middle/ty/elaborate_impl.ts";
import { LateParamRegionKind } from "../../../rustc_middle/ty/region.ts";
import { type Debug, debug_tuple, debug_vec } from "../../../std/fmt.ts";
import { debug_Clause, fold_Clause, fold_Span, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, type DefIdMap, type LocalDefId, type ModId } from "../../../rustc_span/def_id.ts";
import { debug_Span, type Span } from "../../../rustc_span/lib.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { elaborate } from "../../../rustc_type_ir/elaborate.ts";
import { fold_tuple2, fold_Vec, type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { BoundVar } from "../../../rustc_type_ir/lib.ts";
import type { TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { visit_with_ClauseKind } from "../../../rustc_type_ir/predicate_kind.gen.ts";
import { fold_Const, type Region } from "../../../rustc_type_ir/sty/mod.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import type { OpaqueAliasTy, ProjectionAliasTy } from "../../../rustc_type_ir/ty/alias.ts";
import { AliasTy, FnSig, fold_FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { fold_Binder } from "../../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import type { Variance } from "../../../rustc_type_ir/lib.gen.ts";
import { KeyedSet } from "../../../rust_ts/keyed.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { panic, unwrap } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import { ReturnPositionImplTraitInTraitRefined_diagnostic, ReturnPositionImplTraitInTraitRefinedLifetimes_diagnostic } from "../../diagnostics.ts";
import * as super_ from "../compare_impl_item.ts";

/// Check that an implementation does not refine an RPITIT from a trait method signature.
// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:19 check_refining_return_position_impl_trait_in_trait
export function check_refining_return_position_impl_trait_in_trait(tcx: TyCtxt, impl_m: AssocItem, trait_m: AssocItem, impl_trait_ref: TraitRef): void {
  if (!tcx.impl_method_has_trait_impl_trait_tys(impl_m.def_id)) {
    return;
  }

  // unreachable traits don't have any library guarantees, there's no need to do this check.
  const is_internal =
    ((): boolean => {
      const trait_def_id = AssocItem.container_id(trait_m, tcx).as_local();
      return trait_def_id !== undefined && !tcx.effective_visibilities(null).is_reachable(trait_def_id);
    })() ||
    // If a type in the trait ref is private, then there's also no reason to do this check.
    impl_trait_ref.args.some((arg) => {
      const ty = GenericArg.as_type(arg);
      if (ty !== undefined) {
        const self_visibility = type_visibility(tcx, ty);
        if (self_visibility !== undefined) {
          return !Visibility.is_public(self_visibility);
        }
      }
      return false;
    });

  const impl_def_id = AssocItem.container_id(impl_m, tcx);
  const impl_m_args = RawList.identity_for_item(tcx, impl_m.def_id);
  const trait_m_to_impl_m_args = impl_m_args.rebase_onto(tcx, impl_def_id, impl_trait_ref.args);
  const bound_trait_m_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(fn_sig_of(tcx, trait_m.def_id), tcx, trait_m_to_impl_m_args, fold_Binder(fold_FnSig)));
  const trait_m_sig = tcx.liberate_late_bound_regions(impl_m.def_id, bound_trait_m_sig, fold_FnSig);
  // replace the self type of the trait ref with `Self` so that diagnostics render better.
  const trait_m_sig_with_self_for_diag = tcx.liberate_late_bound_regions(
    impl_m.def_id,
    Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(
        fn_sig_of(tcx, trait_m.def_id),
        tcx,
        tcx.mk_args_from_iter([tcx.types.self_param, ...trait_m_to_impl_m_args.slice(1)]),
        fold_Binder(fold_FnSig),
      ),
    ),
    fold_FnSig,
  );

  const hidden_tys_ = tcx.collect_return_position_impl_trait_in_trait_tys(impl_m.def_id);
  if (hidden_tys_.$ !== "Ok") {
    // Error already emitted, no need to delay another.
    return;
  }
  const hidden_tys = hidden_tys_._0 as DefIdMap<EarlyBinder<Ty>>;

  if ([...hidden_tys.values()].some((ty) => TypeVisitableExt.references_error(EarlyBinder.skip_binder(ty), fold_Ty))) {
    return;
  }

  const collector = new ImplTraitInTraitCollector(tcx, new KeyedSet<ProjectionAliasTy>(intern_key));
  fold_FnSig.visit_with(trait_m_sig, collector);

  // Bound that we find on RPITITs in the trait signature.
  const trait_bounds: Clause[] = [];
  // Bounds that we find on the RPITITs in the impl signature.
  const impl_bounds: [Clause, Span][] = [];
  // Pairs of trait and impl opaques.
  const pairs: [ProjectionAliasTy, OpaqueAliasTy][] = [];

  for (const trait_projection of [...collector.types].reverse()) {
    const impl_opaque_args = trait_projection.args.rebase_onto(tcx, trait_m.def_id, impl_m_args);
    const hidden_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(index_def_id_map(hidden_tys, trait_projection.kind), tcx, impl_opaque_args, fold_Ty));

    // If the hidden type is not an opaque, then we have "refined" the trait signature.
    const hk = hidden_ty.kind();
    const impl_opaque_ = hk.$ === "Alias" ? AliasTy.try_to_opaque(hk._1) : undefined;
    let impl_opaque: OpaqueAliasTy;
    if (impl_opaque_ !== undefined) {
      impl_opaque = impl_opaque_;
    } else {
      report_mismatched_rpitit_signature(tcx, trait_m_sig_with_self_for_diag, trait_m.def_id, impl_m.def_id, undefined, is_internal);
      return;
    }

    // This opaque also needs to be from the impl method -- otherwise,
    // it's a refinement to a TAIT.
    const node = tcx.hir_get_if_local(impl_opaque.kind);
    const from_impl_m =
      node !== undefined &&
      ((): boolean => {
        const origin = Node.expect_opaque_ty(node).origin;
        return (origin.$ === "AsyncFn" || origin.$ === "FnReturn") && origin.parent === impl_m.def_id.expect_local();
      })();
    if (!from_impl_m) {
      report_mismatched_rpitit_signature(tcx, trait_m_sig_with_self_for_diag, trait_m.def_id, impl_m.def_id, undefined, is_internal);
      return;
    }

    for (const u of EarlyBinder.iter_instantiated(tcx.item_bounds(trait_projection.kind) as EarlyBinder<Clauses>, tcx, trait_projection.args, fold_Clause)) {
      trait_bounds.push(Unnormalized.skip_norm_wip(u));
    }
    impl_bounds.push(
      ...elaborate(
        tcx,
        [
          ...EarlyBinder.iter_instantiated_copied(
            tcx.explicit_item_bounds(impl_opaque.kind) as EarlyBinder<readonly [Clause, Span][]>,
            tcx,
            impl_opaque.args,
            fold_tuple2(fold_Clause, fold_Span),
          ),
        ].map(Unnormalized.skip_norm_wip),
        Elaboratable_Clause_Span,
      ),
    );

    pairs.push([trait_projection, impl_opaque]);
  }

  const hybrid_clauses = [
    ...GenericClauses.instantiate_identity(tcx.clauses_of(impl_def_id) as GenericClauses, tcx),
    ...GenericClauses.instantiate_own(tcx.clauses_of(trait_m.def_id) as GenericClauses, tcx, trait_m_to_impl_m_args),
  ].map(([clause, _]) => Unnormalized.skip_norm_wip(clause));
  let param_env = ParamEnv.new(tcx, hybrid_clauses);
  param_env = normalize_param_env_or_error(tcx, param_env, ObligationCause.dummy());

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt.new(infcx);

  // Normalize the bounds. This has two purposes:
  //
  // 1. Project the RPITIT projections from the trait to the opaques on the impl,
  //    which means that they don't need to be mapped manually.
  //
  // 2. Deeply normalize any other projections that show up in the bound. That makes sure
  //    that we don't consider `tests/ui/async-await/in-trait/async-associated-types.rs`
  //    or `tests/ui/impl-trait/in-trait/refine-normalize.rs` to be refining.
  const normalized = ocx.deeply_normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip([trait_bounds, impl_bounds] as Bounds), d_Bounds);
  if (normalized.$ !== "Ok") {
    tcx.dcx().delayed_bug("encountered errors when checking RPITIT refinement (selection)");
    return;
  }
  const [trait_bounds_n, impl_bounds_n] = normalized._0;

  // Since we've normalized things, we need to resolve regions, since we'll
  // possibly have introduced region vars during projection. We don't expect
  // this resolution to have incurred any region errors -- but if we do, then
  // just delay a bug.
  const implied_wf_types = new Set<Ty>();
  for (const ty of trait_m_sig.inputs_and_output) implied_wf_types.add(ty);
  for (const ty of ocx.normalize(ObligationCause.dummy(), param_env, Unnormalized.new_wip(trait_m_sig.inputs_and_output), fold_List_Ty)) implied_wf_types.add(ty);
  if (!rustc_infer.traits.TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
    tcx.dcx().delayed_bug("encountered errors when checking RPITIT refinement (selection)");
    return;
  }
  const errors = infcx.resolve_regions(impl_m.def_id.expect_local(), param_env, implied_wf_types);
  if (errors.length !== 0) {
    tcx.dcx().delayed_bug("encountered errors when checking RPITIT refinement (regions)");
    return;
  }
  // Resolve any lifetime variables that may have been introduced during normalization.
  const resolved = infcx.deeply_resolve_via_region_graph([trait_bounds_n, impl_bounds_n] as Bounds, d_Bounds, debug_Bounds);
  if (resolved.$ !== "Ok") {
    // If resolution didn't fully complete, we cannot continue checking RPITIT refinement, and
    // delay a bug as the original code contains load-bearing errors.
    tcx.dcx().delayed_bug("encountered errors when checking RPITIT refinement (resolution)");
    return;
  }
  const [trait_bounds_r, impl_bounds_r] = resolved._0;

  if (TypeVisitableExt.references_error(trait_bounds_r, d_Bounds_0) || TypeVisitableExt.references_error(impl_bounds_r, d_Bounds_1)) {
    return;
  }

  // For quicker lookup, use an `IndexSet` (we don't use one earlier because
  // it's not foldable..).
  // Also, We have to anonymize binders in these types because they may contain
  // `BrNamed` bound vars, which contain unique `DefId`s which correspond to syntax
  // locations that we don't care about when checking bound equality.
  const trait_bounds_set = new Set<Clause>(d_Bounds_0.fold_with(trait_bounds_r, new Anonymize(tcx)));
  const impl_bounds_a = d_Bounds_1.fold_with(impl_bounds_r, new Anonymize(tcx));

  // Find any clauses that are present in the impl's RPITITs that are not
  // present in the trait's RPITITs. This will trigger on trivial predicates,
  // too, since we *do not* use the trait solver to prove that the RPITIT's
  // bounds are not stronger -- we're doing a simple, syntactic compatibility
  // check between bounds. This is strictly forwards compatible, though.
  for (const [clause, span] of impl_bounds_a) {
    if (!trait_bounds_set.has(clause)) {
      report_mismatched_rpitit_signature(tcx, trait_m_sig_with_self_for_diag, trait_m.def_id, impl_m.def_id, span, is_internal);
      return;
    }
  }

  // Make sure that the RPITIT doesn't capture fewer regions than
  // the trait definition. We hard-error if it captures *more*, since that
  // is literally unrepresentable in the type system; however, we may be
  // promising stronger outlives guarantees if we capture *fewer* regions.
  for (const [trait_projection, impl_opaque] of pairs) {
    const impl_variances = tcx.variances_of(impl_opaque.kind) as readonly Variance[];
    zip_eq_check(impl_opaque.args.length, impl_variances.length);
    const impl_captures = new Set<GenericArg>();
    for (let i = 0; i < impl_opaque.args.length; i++) {
      if (impl_variances[i] === "Invariant") impl_captures.add(impl_opaque.args[i]!);
    }

    const trait_variances = tcx.variances_of(trait_projection.kind) as readonly Variance[];
    const trait_captures = new Set<GenericArg>();
    zip_eq_check(trait_projection.args.length, trait_variances.length);
    for (let i = 0; i < trait_projection.args.length; i++) {
      const arg = trait_projection.args[i]!;
      const variance = trait_variances[i]!;
      if (variance !== "Invariant") {
        continue;
      }
      visit_with_GenericArg(arg, new CollectParams(trait_captures));
    }

    if (![...trait_captures].every((arg) => impl_captures.has(arg))) {
      report_mismatched_rpitit_captures(tcx, impl_opaque.kind.expect_local(), trait_captures, is_internal);
    }
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:265 ImplTraitInTraitCollector
class ImplTraitInTraitCollector implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public tcx: TyCtxt,
    public types: KeyedSet<ProjectionAliasTy>,
  ) {}

  // ---- impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for ImplTraitInTraitCollector<'tcx> ----

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:271 visit_ty
  visit_ty(ty: Ty): undefined {
    const k = ty.kind();
    const proj = k.$ === "Alias" ? AliasTy.try_to_projection(k._1) : undefined;
    if (proj !== undefined && this.tcx.is_impl_trait_in_trait(proj.kind)) {
      // `self.types.insert(proj)`
      if (!this.types.has(proj)) {
        this.types.add(proj);
        for (const u of EarlyBinder.iter_instantiated_copied(
          this.tcx.explicit_item_bounds(proj.kind) as EarlyBinder<readonly [Clause, Span][]>,
          this.tcx,
          proj.args,
          fold_tuple2(fold_Clause, fold_Span),
        )) {
          const [pred, _] = Unnormalized.skip_norm_wip(u);
          visit_with_Clause(pred, this);
        }
      }
    } else {
      fold_Ty.super_visit_with(ty, this);
    }
    return undefined;
  }

  // PORT: the provided `TypeVisitor` methods (PORTING §8).
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }

  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:292 report_mismatched_rpitit_signature
function report_mismatched_rpitit_signature(
  tcx: TyCtxt,
  trait_m_sig: FnSig,
  trait_m_def_id: DefId,
  impl_m_def_id: DefId,
  unmatched_bound: Span | undefined,
  is_internal: boolean,
): void {
  const mapping = super_.new_late_param_mapping();
  {
    const a = Binder.bound_vars(EarlyBinder.skip_binder(fn_sig_of(tcx, trait_m_def_id)));
    const b = Binder.bound_vars(EarlyBinder.skip_binder(fn_sig_of(tcx, impl_m_def_id)));
    for (let idx = 0; idx < Math.min(a.length, b.length); idx++) {
      const impl_bv = a[idx]!;
      const trait_bv = b[idx]!;
      if (impl_bv.$ === "Region" && trait_bv.$ === "Region") {
        const var_ = BoundVar.from_usize(idx);
        mapping.set(LateParamRegionKind.from_bound(var_, impl_bv._0), LateParamRegionKind.from_bound(var_, trait_bv._0));
      }
    }
  }

  let return_ty = fold_Ty.fold_with(FnSig.output(trait_m_sig), new super_.RemapLateParam(tcx, mapping));

  if (Asyncness.is_async(tcx.asyncness(impl_m_def_id) as Asyncness) && Asyncness.is_async(tcx.asyncness(trait_m_def_id) as Asyncness)) {
    const k = return_ty.kind();
    if (!(k.$ === "Alias" && k._1.kind.$ === "Projection")) {
      span_bug(tcx.def_span(trait_m_def_id), "expected return type of async fn in trait to be a AFIT projection");
    }
    const future_ty_def_id = k._1.kind.def_id;
    const args = k._1.args;
    let future_output_ty: Ty | undefined = undefined;
    for (const u of EarlyBinder.iter_instantiated_copied(
      tcx.explicit_item_bounds(future_ty_def_id) as EarlyBinder<readonly [Clause, Span][]>,
      tcx,
      args,
      fold_tuple2(fold_Clause, fold_Span),
    )) {
      const [clause, _] = Unnormalized.skip_norm_wip(u);
      const ck = Binder.no_bound_vars(clause.kind(), d_ClauseKind);
      if (ck === undefined) continue;
      if (ck.$ === "Projection") {
        const t = Term.as_type(ck._0.term);
        if (t !== undefined) {
          future_output_ty = t;
          break;
        }
      }
    }
    if (future_output_ty === undefined) {
      span_bug(tcx.def_span(trait_m_def_id), "expected `Future` projection bound in AFIT");
    }
    return_ty = future_output_ty;
  }

  let span: Span;
  let impl_return_span: Span;
  let pre: string;
  let post: string;
  const output = unwrap(Node.fn_decl(tcx.hir_node_by_def_id(impl_m_def_id.expect_local()))).output;
  switch (output.$) {
    case "DefaultReturn":
      [span, impl_return_span, pre, post] = [tcx.def_span(impl_m_def_id), output._0, "-> ", " "];
      break;
    case "Return":
      [span, impl_return_span, pre, post] = [output._0.span, output._0.span, "", ""];
      break;
  }
  const trait_node = tcx.hir_get_if_local(trait_m_def_id);
  const trait_return_span =
    trait_node === undefined
      ? undefined
      : ((): Span => {
          const o = unwrap(Node.fn_decl(trait_node)).output;
          switch (o.$) {
            case "DefaultReturn":
              return tcx.def_span(trait_m_def_id);
            case "Return":
              return o._0.span;
          }
        })();

  // Use ForSignature mode to ensure RPITITs are printed as `impl Trait` rather than
  // `impl Trait { T::method(..) }` when RTN is enabled.
  //
  // We use `with_no_trimmed_paths!` to avoid triggering the `trimmed_def_paths` query,
  // which requires diagnostic context (via `must_produce_diag`). Since we're formatting
  // the type before creating the diagnostic, we need to avoid this query. This is the
  // standard approach used elsewhere in the compiler for formatting types in suggestions
  // (e.g., see `rustc_hir_typeck/src/demand.rs`).
  const return_ty_suggestion = with_no_trimmed_paths(() => with_types_for_signature(() => display_Ty(return_ty)));

  span = unmatched_bound ?? span;
  tcx.emit_node_span_lint(
    is_internal ? REFINING_IMPL_TRAIT_INTERNAL : REFINING_IMPL_TRAIT_REACHABLE,
    tcx.local_def_id_to_hir_id(impl_m_def_id.expect_local()),
    span,
    ReturnPositionImplTraitInTraitRefined_diagnostic({
      impl_return_span,
      trait_return_span,
      pre,
      post,
      return_ty: return_ty_suggestion,
      unmatched_bound,
    }),
  );
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:385 type_visibility
function type_visibility(tcx: TyCtxt, ty: Ty): Visibility<ModId> | undefined {
  const k = ty.kind();
  switch (k.$) {
    case "Ref":
      return type_visibility(tcx, k._1);
    case "Adt": {
      const def = k._0;
      const args = k._1;
      if (def.is_fundamental()) {
        return type_visibility(tcx, args.type_at(0));
      } else {
        return tcx.visibility(def.did());
      }
    }
    default:
      return undefined;
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:399 Anonymize
class Anonymize implements TypeFolder {
  constructor(public tcx: TyCtxt) {}

  // ---- impl<'tcx> TypeFolder<TyCtxt<'tcx>> for Anonymize<'tcx> ----

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:404 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:408 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return this.tcx.anonymize_bound_vars(t, d);
  }

  // PORT: the provided `TypeFolder` methods (PORTING §8).
  fold_ty(t: Ty): Ty {
    return TypeFolder_provided.fold_ty(this, t);
  }

  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }

  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:416 CollectParams
class CollectParams implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(public params: Set<GenericArg>) {}

  // ---- impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for CollectParams<'_, 'tcx> ----

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:420 visit_ty
  visit_ty(ty: Ty): undefined {
    if (ty.kind().$ === "Param") {
      this.params.add(ty);
    } else {
      fold_Ty.super_visit_with(ty, this);
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:427 visit_region
  visit_region(r: Region): undefined {
    switch (r.kind().$) {
      case "ReEarlyParam":
      case "ReLateParam":
        this.params.add(r);
        break;
      default:
        break;
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:435 visit_const
  visit_const(ct: Const): undefined {
    if (ct.kind().$ === "Param") {
      this.params.add(ct);
    } else {
      fold_Const.super_visit_with(ct, this);
    }
    return undefined;
  }

  // PORT: the provided `TypeVisitor` methods (PORTING §8).
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/compare_impl_item/refine.rs:444 report_mismatched_rpitit_captures
function report_mismatched_rpitit_captures(tcx: TyCtxt, impl_opaque_def_id: LocalDefId, trait_captured_args_: Set<GenericArg>, is_internal: boolean): void {
  let use_bound_span: Span | undefined = undefined;
  for (const bound of Node.expect_opaque_ty(tcx.hir_node_by_def_id(impl_opaque_def_id)).bounds) {
    if (bound.$ === "Use") {
      use_bound_span = bound._1;
      break;
    }
  }
  if (use_bound_span === undefined) {
    // I have no idea when you would ever undercapture without a `use<..>`.
    tcx.dcx().delayed_bug("expected use<..> to undercapture in an impl opaque");
    return;
  }

  // `IndexSet::sort_by_cached_key` (stable): lifetimes first.
  const trait_captured_args = [...trait_captured_args_];
  const keys = new Map<GenericArg, boolean>(trait_captured_args.map((arg) => [arg, GenericArg.kind(arg).$ !== "Lifetime"]));
  trait_captured_args.sort((a, b) => Number(keys.get(a)!) - Number(keys.get(b)!));
  const suggestion = `use<${trait_captured_args.map(display_GenericArg).join(", ")}>`;

  tcx.emit_node_span_lint(
    is_internal ? REFINING_IMPL_TRAIT_INTERNAL : REFINING_IMPL_TRAIT_REACHABLE,
    tcx.local_def_id_to_hir_id(impl_opaque_def_id),
    use_bound_span,
    ReturnPositionImplTraitInTraitRefinedLifetimes_diagnostic({
      suggestion_span: use_bound_span,
      suggestion,
    }),
  );
}

// ==== Helpers (PORT; no upstream counterpart) ========================================================================

/** `tcx.fn_sig(def_id)`: the query value is `unknown` in queries.gen.ts (`EarlyBinder<PolyFnSig>`). */
function fn_sig_of(tcx: TyCtxt, def_id: DefId): EarlyBinder<Binder<FnSig>> {
  return tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>;
}

/** `hidden_tys[&def_id]` (`impl Index for UnordMap`: panics on a missing key). */
function index_def_id_map<V>(map: DefIdMap<V>, def_id: DefId): V {
  const v = map.get(def_id);
  if (v === undefined) panic("key not found");
  return v;
}

/** The length check of `Itertools::zip_eq`. */
function zip_eq_check(a: number, b: number): void {
  if (a !== b) panic("itertools: .zip_eq() reached end of one iterator before the other");
}

/** `(Vec<Clause>, Vec<(Clause, Span)>)`, the tuple refine.rs normalizes and resolves. */
type Bounds = [readonly Clause[], readonly [Clause, Span][]];
const d_Bounds_0: TypeFoldable<readonly Clause[]> = fold_Vec(fold_Clause);
const d_Bounds_1 = fold_Vec(fold_tuple2(fold_Clause, fold_Span)) as TypeFoldable<readonly [Clause, Span][]>;
const d_Bounds = fold_tuple2(d_Bounds_0, d_Bounds_1) as TypeFoldable<Bounds>;
/** `<(Vec<Clause>, Vec<(Clause, Span)>) as Debug>` (the derived tuple / `Vec` impls). */
const debug_Bounds: Debug<Bounds> = (v, f) =>
  debug_tuple(f, "", [debug_vec(v[0], f, debug_Clause), debug_vec(v[1], f, (x, f) => debug_tuple(f, "", [debug_Clause(x[0], f), debug_Span(x[1], f)]))]);
/** `TypeVisitable for ClauseKind` (generated) as a D4 descriptor (only `visit_with` is used by `no_bound_vars`). */
const d_ClauseKind: TypeVisitable<import("../../../rustc_type_ir/predicate_kind.gen.ts").ClauseKind> = { visit_with: visit_with_ClauseKind };
