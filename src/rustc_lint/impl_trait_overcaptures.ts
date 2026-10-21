// Port of compiler/rustc_lint/src/impl_trait_overcaptures.rs (lane lint-late-c). The lint statics and the
// `declare_lint_pass!` expansion are generated (impl_trait_overcaptures.lints.gen.ts); the `LateLintPass` methods are
// assigned onto the generated `ImplTraitOvercaptures` class.
//
// PORT: `FxIndexMap<DefId, ParamKind>` / `FxHashMap<DefId, Variance>` are `DefIdMap`s (insertion-ordered; `delete` is
// `shift_remove`), `FxIndexSet<DefId>` / `UnordSet<DefId>` are `DefIdSet`s, `FxIndexSet<Region>` a `Set<Region>`
// (interned), `FxIndexSet<LocalDefId>` a `Set<LocalDefId>`. `LazyCell<T, F>` is a `Lazy<T>` (below): the closure runs
// on first access, as upstream.
import { IntoDiagArg } from "../rustc_error_messages/lib.ts";
import { number_into_diag_arg, String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, type Level, msg } from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { OutlivesEnvironment } from "../rustc_infer/infer/outlives/env.ts";
import type { ResolvedArg } from "../rustc_middle/middle/resolve_bound_vars.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { type ParamEnv, Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefIdMap, DefIdSet, LocalDefId } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import "../rustc_trait_selection/lib.ts";
import { type AddPreciseCapturingForOvercapture, AddPreciseCapturingForOvercapture_add_to_diag, impl_trait_overcapture_suggestion } from "../rustc_trait_selection/diagnostics.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { type VisitorResult, VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import { Binder, type BoundVariableKind, debug_BoundVariableKind, EarlyBinder, visit_Binder } from "../rustc_type_ir/binder.ts";
import type { PredicateProxy } from "../rustc_type_ir/fold.ts";
import { Variance } from "../rustc_type_ir/lib.ts";
import { debug_TypeError } from "../rustc_type_ir/error.gen.ts";
import {
  type Relate,
  relate_args_with_variances,
  relate_FnSig,
  type RelateResult,
  structurally_relate_consts,
  structurally_relate_tys,
  type TypeRelation,
  TypeRelation_provided,
  type VarianceDiagInfo,
} from "../rustc_type_ir/relate.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import { type FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import { PLAIN } from "../std/fmt.ts";
import { unported, unreachable, unwrap } from "../std/panic.ts";
import { Ok, unwrap_result } from "../std/result.ts";
import type { LateContext } from "./context.ts";
import { IMPL_TRAIT_OVERCAPTURES, IMPL_TRAIT_REDUNDANT_CAPTURES, ImplTraitOvercaptures } from "./impl_trait_overcaptures.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./impl_trait_overcaptures.lints.gen.ts";

declare module "./impl_trait_overcaptures.lints.gen.ts" {
  interface ImplTraitOvercaptures extends LateLintPass {}
}

// ---- impl<'tcx> LateLintPass<'tcx> for ImplTraitOvercaptures ----

// rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:110 check_item
ImplTraitOvercaptures.prototype.check_item = function (this: ImplTraitOvercaptures, cx: LateContext, it: hir.Item): void {
  switch (it.kind.$) {
    case "Fn":
      check_fn(cx.tcx, it.owner_id.def_id);
      break;
    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:117 check_impl_item
ImplTraitOvercaptures.prototype.check_impl_item = function (this: ImplTraitOvercaptures, cx: LateContext, it: hir.ImplItem): void {
  switch (it.kind.$) {
    case "Fn":
      check_fn(cx.tcx, it.owner_id.def_id);
      break;
    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:124 check_trait_item
ImplTraitOvercaptures.prototype.check_trait_item = function (this: ImplTraitOvercaptures, cx: LateContext, it: hir.TraitItem): void {
  switch (it.kind.$) {
    case "Fn":
      check_fn(cx.tcx, it.owner_id.def_id);
      break;
    default:
      break;
  }
};

// #[derive(PartialEq, Eq, Hash, Debug, Copy, Clone)]
type ParamKind =
  // Early-bound var.
  | { readonly $: "Early"; _0: Symbol; _1: number }
  // Late-bound var on function, not within a binder. We can capture these.
  | { readonly $: "Free"; _0: DefId }
  // Late-bound var in a binder. We can't capture these yet.
  | { readonly $: "Late" };
const ParamKind_Late: ParamKind = Object.freeze({ $: "Late" as const });

/** PORT: `std::cell::LazyCell<T, F>`: `f` runs on the first `force`. */
class Lazy<T> {
  #value: { v: T } | undefined = undefined;
  constructor(readonly f: () => T) {}
  force(): T {
    if (this.#value === undefined) this.#value = { v: this.f() };
    return this.#value.v;
  }
}

// rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:142 check_fn
function check_fn(tcx: TyCtxt, parent_def_id: LocalDefId): void {
  const sig_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(LocalDefId.to_def_id(parent_def_id)) as EarlyBinder<PolyFnSig>));

  const in_scope_parameters = new DefIdMap<ParamKind>();
  // Populate the in_scope_parameters list first with all of the generics in scope
  let current_def_id: DefId | undefined = LocalDefId.to_def_id(parent_def_id);
  while (current_def_id !== undefined) {
    const def_id: DefId = current_def_id;
    const generics = tcx.generics_of(def_id) as Generics;
    for (const param of generics.own_params) {
      in_scope_parameters.set(param.def_id, { $: "Early", _0: param.name, _1: param.index });
    }
    current_def_id = generics.parent;
  }

  for (const bound_var of Binder.bound_vars(sig_) as readonly BoundVariableKind[]) {
    if (!(bound_var.$ === "Region" && bound_var._0.$ === "Named")) {
      span_bug(tcx.def_span(LocalDefId.to_def_id(parent_def_id)), "unexpected non-lifetime binder on fn sig");
    }
    const def_id = bound_var._0._0;

    in_scope_parameters.set(def_id, { $: "Free", _0: def_id });
  }

  const sig: FnSig = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(parent_def_id), sig_, fold_FnSig);

  // Then visit the signature to walk through all the binders (incl. the late-bound
  // vars on the function itself, which we need to count too).
  fold_FnSig.visit_with(
    sig,
    new VisitOpaqueTypes(
      tcx,
      parent_def_id,
      in_scope_parameters,
      // Lazily compute these two, since they're likely a bit expensive.
      new Lazy(() => {
        const functional_variances = new FunctionalVariances(tcx, new DefIdMap<Variance>(), "Covariant", tcx.generics_of(LocalDefId.to_def_id(parent_def_id)) as Generics);
        unwrap_result(functional_variances.relate(sig, sig, relate_FnSig), debug_TypeError);
        return functional_variances.variances;
      }),
      new Lazy(() => {
        const typing_env = TypingEnv.non_body_analysis(tcx, parent_def_id);
        const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(typing_env);
        const ocx = ObligationCtxt.new(infcx);
        const r = ocx.assumed_wf_types(param_env as ParamEnv, parent_def_id);
        const assumed_wf_tys = r.$ === "Ok" ? r._0 : new Set<Ty>();
        return OutlivesEnvironment.new(infcx, parent_def_id, param_env as ParamEnv, assumed_wf_tys);
      }),
      new Set<LocalDefId>(),
    ),
  );
}

class VisitOpaqueTypes implements TypeVisitor<undefined> {
  /** `impl TypeVisitor`: `type Result = ()`. */
  readonly Result: VisitorResult<undefined, never> = VisitorResultC.unit;

  constructor(
    public tcx: TyCtxt,
    public parent_def_id: LocalDefId,
    public in_scope_parameters: DefIdMap<ParamKind>,
    public variances: Lazy<DefIdMap<Variance>>,
    public outlives_env: Lazy<OutlivesEnvironment>,
    public seen: Set<LocalDefId>,
  ) {}

  // ---- impl TypeVisitor<TyCtxt<'tcx>> for VisitOpaqueTypes ----

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:209 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    // When we get into a binder, we need to add its own bound vars to the scope.
    const added: [DefId, ParamKind | undefined][] = [];
    for (const arg_ of Binder.bound_vars(t) as readonly BoundVariableKind[]) {
      const arg: BoundVariableKind = arg_;
      if ((arg.$ === "Region" && arg._0.$ === "Named") || (arg.$ === "Ty" && arg._0.$ === "Param")) {
        const def_id = arg._0._0;
        // Return type notation introduces a binder containing the referenced
        // function's own bound parameters. For self-referential RTN, these may
        // already be present as `Free` entries from the enclosing signature.
        // Temporarily shadow them as `Late` and restore them when leaving.
        const previous = this.in_scope_parameters.get(def_id);
        this.in_scope_parameters.set(def_id, ParamKind_Late);
        added.push([def_id, previous]);
      } else {
        this.tcx
          .dcx()
          .span_delayed_bug(this.tcx.def_span(LocalDefId.to_def_id(this.parent_def_id)), `unsupported bound variable kind: ${debug_BoundVariableKind(arg, PLAIN)}`);
      }
    }

    visit_Binder(d).super_visit_with(t, this);

    // Restore the previous scope entries, removing newly added parameters.
    for (const [arg, previous] of added.reverse()) {
      if (previous !== undefined) {
        this.in_scope_parameters.set(arg, previous);
      } else {
        this.in_scope_parameters.delete(arg);
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:245 visit_ty
  visit_ty(t: Ty): undefined {
    if (!TypeVisitableExt.has_aliases(t, fold_Ty)) {
      return undefined;
    }

    const k = t.kind();
    let opaque: hir.OpaqueTy | undefined;
    if (k.$ === "Alias" && k._1.kind.$ === "Projection" && this.tcx.is_impl_trait_in_trait(k._1.kind.def_id)) {
      const def_id = k._1.kind.def_id;
      const args = k._1.args;
      // visit the opaque of the RPITIT
      fold_Ty.visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(def_id) as EarlyBinder<Ty>, this.tcx, args, fold_Ty)), this);
    } else if (k.$ === "Alias" && k._1.kind.$ === "Opaque" && (opaque = this.owned_opaque(k._1.kind.def_id)) !== undefined) {
      const def_id = k._1.kind.def_id;
      const opaque_ty_args: GenericArgs = k._1.args;
      const opaque_def_id = unwrap(def_id.as_local());
      const opaque_span = this.tcx.def_span(LocalDefId.to_def_id(opaque_def_id));
      const new_capture_rules = Span.at_least_rust_2024(opaque_span);
      if (!new_capture_rules && !opaque.bounds.some((bound) => bound.$ === "Use")) {
        // Compute the set of args that are captured by the opaque...
        const captured = new DefIdSet();
        const captured_regions = new Set<Region>();
        const variances = this.tcx.variances_of(LocalDefId.to_def_id(opaque_def_id)) as readonly Variance[];
        let current_def_id: DefId | undefined = LocalDefId.to_def_id(opaque_def_id);
        while (current_def_id !== undefined) {
          const generics = this.tcx.generics_of(current_def_id) as Generics;
          for (const param of generics.own_params) {
            // A param is captured if it's invariant.
            if (variances[param.index] !== "Invariant") {
              continue;
            }

            const arg = opaque_ty_args[param.index];
            // We need to turn all `ty::Param`/`ConstKind::Param` and
            // `ReEarlyParam`/`ReBound` into def ids.
            captured.add(extract_def_id_from_arg(this.tcx, generics, arg));

            const r = GenericArg.as_region(arg);
            if (r !== undefined) captured_regions.add(r);
          }
          current_def_id = generics.parent;
        }

        // Compute the set of in scope params that are not captured.
        let uncaptured_args: [DefId, ParamKind][] = [...this.in_scope_parameters.entries()].filter(([def_id, _]) => !captured.has(def_id));
        // Remove the set of lifetimes that are in-scope that outlive some other captured
        // lifetime and are contravariant (i.e. covariant in argument position).
        uncaptured_args = uncaptured_args.filter(([def_id, kind]) => {
          const v = this.variances.force().get(def_id);
          if (!(v === "Bivariant" || v === "Contravariant")) {
            // Keep all covariant/invariant args. Also if variance is `None`,
            // then that means it's either not a lifetime, or it didn't show up
            // anywhere in the signature.
            return true;
          }
          // We only computed variance of lifetimes...
          // debug_assert_matches!(self.tcx.def_kind(*def_id), DefKind::LifetimeParam);
          let uncaptured: Region;
          switch (kind.$) {
            case "Early": {
              const name = kind._0;
              const index = kind._1;
              uncaptured = Region.new_early_param(this.tcx, { name, index });
              break;
            }
            case "Free": {
              const def_id = kind._0;
              uncaptured = Region.new_late_param(this.tcx, LocalDefId.to_def_id(this.parent_def_id), { $: "Named", _0: def_id });
              break;
            }
            // Totally ignore late bound args from binders.
            case "Late":
              return true;
          }
          // Does this region outlive any captured region?
          return ![...captured_regions].some((r) => this.outlives_env.force().free_region_map().sub_free_regions(this.tcx, r, uncaptured));
        });

        // If we have uncaptured args, and if the opaque doesn't already have
        // `use<>` syntax on it, and we're < edition 2024, then warn the user.
        if (uncaptured_args.length !== 0) {
          const suggestion = impl_trait_overcapture_suggestion(this.tcx, opaque_def_id, this.parent_def_id, captured);

          const uncaptured_spans: Span[] = uncaptured_args.map(([def_id, _]) => this.tcx.def_span(def_id));

          this.tcx.emit_node_span_lint(
            IMPL_TRAIT_OVERCAPTURES,
            this.tcx.local_def_id_to_hir_id(opaque_def_id),
            opaque_span,
            ImplTraitOvercapturesLint_diagnostic({
              self_ty: t,
              num_captured: uncaptured_spans.length,
              uncaptured_spans,
              suggestion,
            }),
          );
        }
      }

      // Otherwise, if we are edition 2024, have `use<>` syntax, and
      // have no uncaptured args, then we should warn to the user that
      // it's redundant to capture all args explicitly.
      let found: [number, readonly hir.PreciseCapturingArg[], Span] | undefined;
      if (new_capture_rules) {
        for (let i = 0; i < opaque.bounds.length; i++) {
          const bound = opaque.bounds[i];
          if (bound.$ === "Use") {
            found = [i, bound._0, bound._1];
            break;
          }
        }
      }
      if (new_capture_rules && found !== undefined) {
        const [use_idx, captured_args, capturing_span] = found;
        const explicitly_captured = new DefIdSet();
        for (const arg of captured_args) {
          const resolved: ResolvedArg | undefined = this.tcx.named_bound_var(hir.PreciseCapturingArg.hir_id(arg));
          if (resolved !== undefined && (resolved.$ === "EarlyBound" || resolved.$ === "LateBound")) {
            const def_id = resolved.$ === "EarlyBound" ? resolved._0 : resolved._2;
            if (this.tcx.def_kind(this.tcx.local_parent(def_id)).$ === "OpaqueTy") {
              const def_id2 = unwrap(
                this.tcx.map_opaque_lifetime_to_parent_lifetime(def_id).opt_param_def_id(this.tcx, LocalDefId.to_def_id(this.parent_def_id)),
                "variable should have been duplicated from parent",
              );

              explicitly_captured.add(def_id2);
            } else {
              explicitly_captured.add(LocalDefId.to_def_id(def_id));
            }
          } else {
            this.tcx.dcx().span_delayed_bug(this.tcx.hir_span(hir.PreciseCapturingArg.hir_id(arg)), "no valid for captured arg");
          }
        }

        if ([...this.in_scope_parameters.keys()].every((def_id) => explicitly_captured.has(def_id))) {
          // Extend the removal span to include the `+` joiner adjacent
          // to `use<...>`, so applying the suggestion does not leave
          // behind a stray `+` that fails to parse.
          let suggestion_span: Span;
          const next = opaque.bounds[use_idx + 1];
          if (next !== undefined) {
            suggestion_span = Span.with_hi(capturing_span, Span.lo(hir.GenericBound.span(next)));
          } else if (use_idx >= 1) {
            const prev_idx = use_idx - 1;
            const prev = opaque.bounds[prev_idx];
            suggestion_span = Span.with_lo(capturing_span, Span.hi(hir.GenericBound.span(prev)));
          } else {
            // `impl use<...>` with no other bound is not valid
            // syntax, so this branch is unreachable in practice.
            suggestion_span = capturing_span;
          }

          this.tcx.emit_node_span_lint(
            IMPL_TRAIT_REDUNDANT_CAPTURES,
            this.tcx.local_def_id_to_hir_id(opaque_def_id),
            opaque_span,
            ImplTraitRedundantCapturesLint_diagnostic({ capturing_span: suggestion_span }),
          );
        }
      }

      // Walk into the bounds of the opaque, too, since we want to get nested opaques
      // in this lint as well. Interestingly, one place that I expect this lint to fire
      // is for `impl for<'a> Bound<Out = impl Other>`, since `impl Other` will begin
      // to capture `'a` in e2024 (even though late-bound vars in opaques are not allowed).
      for (const clause_ of EarlyBinder.iter_instantiated(this.tcx.item_bounds(def_id) as EarlyBinder<readonly import("../rustc_middle/ty/decls.ts").Clause[]>, this.tcx, opaque_ty_args, fold_Clause)) {
        const clause = Unnormalized.skip_norm_wip(clause_);
        fold_Clause.visit_with(clause, this);
      }
    }

    fold_Ty.super_visit_with(t, this);
    return undefined;
  }

  /** The `let`-chain of the opaque arm of `visit_ty` (impl_trait_overcaptures.rs:257-266), in its order. */
  private owned_opaque(def_id: DefId): hir.OpaqueTy | undefined {
    const opaque_def_id = def_id.as_local();
    if (opaque_def_id === undefined) return undefined;
    // Don't recurse infinitely on an opaque
    if (!set_insert(this.seen, opaque_def_id)) return undefined;
    // If it's owned by this function
    const opaque = hir.Node.expect_opaque_ty(this.tcx.hir_node_by_def_id(opaque_def_id));
    // We want to recurse into RPITs and async fns, even though the latter
    // doesn't overcapture on its own, it may mention additional RPITs
    // in its bounds.
    if (!((opaque.origin.$ === "FnReturn" || opaque.origin.$ === "AsyncFn") && opaque.origin.parent === this.parent_def_id)) return undefined;
    return opaque;
  }

  /** (provided) `TypeVisitor::visit_region` */
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }

  /** (provided) `TypeVisitor::visit_const` */
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** `IndexSet::insert`: whether the value was newly inserted. */
function set_insert<T>(set: Set<T>, v: T): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

interface ImplTraitOvercapturesLint {
  uncaptured_spans: Span[];
  self_ty: Ty;
  num_captured: number;
  suggestion: AddPreciseCapturingForOvercapture | undefined;
}

/** `impl<'a> Diagnostic<'a> for ImplTraitOvercapturesLint<'_>` */
// rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:456 into_diag
function ImplTraitOvercapturesLint_into_diag(self: ImplTraitOvercapturesLint, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, msg("`{$self_ty}` will capture more lifetimes than possibly intended in edition 2024"));
  diag.arg("self_ty", IntoDiagArg.of(display_Ty(self.self_ty), String_into_diag_arg));
  diag.arg("num_captured", IntoDiagArg.of(self.num_captured, number_into_diag_arg));
  diag
    .span_note(
      self.uncaptured_spans,
      msg(
        "specifically, {$num_captured ->\n                        [one] this lifetime is\n                        *[other] these lifetimes are\n                    } in scope but not mentioned in the type's bounds",
      ),
    )
    .note(msg("all lifetimes in scope will be captured by `impl Trait`s in edition 2024"));
  if (self.suggestion !== undefined) {
    const suggestion = self.suggestion;
    AddPreciseCapturingForOvercapture_add_to_diag(suggestion, diag);
  }
  return diag;
}

/** `ImplTraitOvercapturesLint` as a `Diagnostic` trait object. */
function ImplTraitOvercapturesLint_diagnostic(self: ImplTraitOvercapturesLint): Diagnostic {
  return { into_diag: (dcx, level) => ImplTraitOvercapturesLint_into_diag(self, dcx, level) };
}

// #[derive(Diagnostic)]
// #[diag("all possible in-scope parameters are already captured, so `use<...>` syntax is redundant")]
interface ImplTraitRedundantCapturesLint {
  // #[suggestion("remove the `use<...>` syntax", code = "", applicability = "machine-applicable")]
  capturing_span: Span;
}

/** `ImplTraitRedundantCapturesLint` as a `Diagnostic` trait object. */
// PORT: the `#[derive(Diagnostic)]` impl is generated by tools/codegen/types.ts (PORTING §5), which has no set for
// this file yet: `into_diag` stops with `unported` (the lint is allow-by-default, so it is only reached when enabled).
function ImplTraitRedundantCapturesLint_diagnostic(_self: ImplTraitRedundantCapturesLint): Diagnostic {
  return {
    into_diag: (_dcx, _level) => unported("rustc_lint::impl_trait_overcaptures::ImplTraitRedundantCapturesLint::into_diag (#[derive(Diagnostic)], codegen)"),
  };
}

// rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:492 extract_def_id_from_arg
function extract_def_id_from_arg(tcx: TyCtxt, generics: Generics, arg: GenericArg): DefId {
  const k = GenericArg.kind(arg);
  switch (k.$) {
    case "Lifetime": {
      const re = k._0;
      const rk = re.kind();
      if (rk.$ === "ReEarlyParam") {
        const ebr = rk._0;
        return generics.region_param(ebr, tcx).def_id;
      } else if (rk.$ === "ReBound" && rk._1.kind.$ === "Named") {
        return rk._1.kind._0;
      } else if (rk.$ === "ReLateParam" && rk._0.kind.$ === "Named") {
        return rk._0.kind._0;
      } else {
        return unreachable();
      }
    }
    case "Type": {
      const ty = k._0;
      const tk = ty.kind();
      if (tk.$ !== "Param") {
        return bug();
      }
      const param_ty = tk._0;
      return generics.type_param(param_ty, tcx).def_id;
    }
    case "Const": {
      const ct = k._0;
      const ck = ct.kind();
      if (ck.$ !== "Param") {
        return bug();
      }
      const param_ct = ck._0;
      return generics.const_param(param_ct, tcx).def_id;
    }
  }
}

/// Computes the variances of regions that appear in the type, but considering
/// late-bound regions too, which don't have their variance computed usually.
///
/// Like generalization, this is a unary operation implemented on top of the binary
/// relation infrastructure, mostly because it's much easier to have the relation
/// track the variance for you, rather than having to do it yourself.
class FunctionalVariances implements TypeRelation {
  constructor(
    public tcx: TyCtxt,
    public variances: DefIdMap<Variance>,
    public ambient_variance: Variance,
    public generics: Generics,
  ) {}

  // ---- impl<'tcx> TypeRelation<TyCtxt<'tcx>> for FunctionalVariances<'tcx> ----

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:536 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  /** (provided) `TypeRelation::relate` */
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T> {
    return TypeRelation_provided.relate(this, a, b, d);
  }

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:540 relate_ty_args
  relate_ty_args(a_ty: Ty, _b_ty: Ty, def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, _mk: (args: GenericArgs) => Ty): RelateResult<Ty> {
    const variances = this.cx().variances_of(def_id) as readonly Variance[];
    const r = relate_args_with_variances(this, variances, a_args, b_args);
    if (r.$ === "Err") return r;
    return Ok(a_ty);
  }

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:554 relate_with_variance
  relate_with_variance<T>(variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
    const old_variance = this.ambient_variance;
    this.ambient_variance = Variance.xform(this.ambient_variance, variance);
    unwrap_result(this.relate(a, b, d), debug_TypeError);
    this.ambient_variance = old_variance;
    return Ok(a);
  }

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:568 tys
  tys(a: Ty, b: Ty): RelateResult<Ty> {
    unwrap_result(structurally_relate_tys(this, a, b), debug_TypeError);
    return Ok(a);
  }

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:573 regions
  regions(a: Region, _b: Region): RelateResult<Region> {
    let def_id: DefId;
    const k = a.kind();
    if (k.$ === "ReEarlyParam") {
      const ebr = k._0;
      def_id = this.generics.region_param(ebr, this.tcx).def_id;
    } else if (k.$ === "ReBound" && k._1.kind.$ === "Named") {
      def_id = k._1.kind._0;
    } else if (k.$ === "ReLateParam" && k._0.kind.$ === "Named") {
      def_id = k._0.kind._0;
    } else {
      return Ok(a);
    }

    const variance = this.variances.get(def_id);
    if (variance !== undefined) {
      this.variances.set(def_id, unify(variance, this.ambient_variance));
    } else {
      this.variances.set(def_id, this.ambient_variance);
    }

    return Ok(a);
  }

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:599 consts
  consts(a: Const, b: Const): RelateResult<Const> {
    unwrap_result(structurally_relate_consts(this, a, b), debug_TypeError);
    return Ok(a);
  }

  // rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:608 binders
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
    unwrap_result(this.relate(Binder.skip_binder(a), Binder.skip_binder(b), d), debug_TypeError);
    return Ok(a);
  }
}

/// What is the variance that satisfies the two variances?
// rustc: compiler/rustc_lint/src/impl_trait_overcaptures.rs:622 unify
function unify(a: Variance, b: Variance): Variance {
  // Bivariance is lattice bottom.
  if (a === "Bivariant") return b;
  if (b === "Bivariant") return a;
  // Invariant is lattice top.
  if (a === "Invariant" || b === "Invariant") return "Invariant";
  // If type is required to be covariant and contravariant, then it's invariant.
  if ((a === "Contravariant" && b === "Covariant") || (a === "Covariant" && b === "Contravariant")) return "Invariant";
  // Otherwise, co + co = co, contra + contra = contra.
  if (a === "Contravariant" && b === "Contravariant") return "Contravariant";
  // (ty::Covariant, ty::Covariant)
  return "Covariant";
}
