// Port of compiler/rustc_ty_utils/src/ty.rs (lane ty-utils).
//
// PORT: query values typed `unknown` in queries.gen.ts (`adt_def`, `type_of`, `generics_of`, `clauses_of`, `fn_sig`,
// `associated_item`, `const_conditions`, `item_bounds`, `opt_rpitit_info`, `param_env`) are cast to their upstream types
// at the read site; the `adt_sizedness_constraint` key `(DefId, SizedTraitKind)` likewise.
// PORT: tracing (`#[instrument]`) is left out.
import type { VisitorResult } from "../rustc_ast_ir/visit.ts";
import { VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import { debug_Node, Defaultness, Node } from "../rustc_hir/hir.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { ObligationCause as ObligationCauseT } from "../rustc_middle/traits/mod.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef, ImplTraitInTraitData } from "../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { ConstConditions, GenericClauses, type Generics } from "../rustc_middle/ty/generics.ts";
import type { BoundVarKinds, Clauses } from "../rustc_middle/ty/list.ts";
import { type Asyncness, debug_Ty, ParamEnv, type Ty } from "../rustc_middle/ty/mod.ts";
import { type Clause, Clause_upcast_from_PolyProjectionClause } from "../rustc_middle/ty/predicate.ts";
import { debug_AdtDef, fold_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type Binder, Binder as BinderC, EarlyBinder, visit_Binder } from "../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { fold_regions, type PredicateProxy } from "../rustc_type_ir/fold.ts";
import type { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { TypingMode as TypingModeC } from "../rustc_type_ir/infer_ctxt.ts";
import { DebruijnIndex, INNERMOST } from "../rustc_type_ir/lib.ts";
import { as_interner, PolyTraitClause, type TraitRef } from "../rustc_type_ir/predicate.ts";
import { SizedTraitKind } from "../rustc_type_ir/solve/mod.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../rustc_type_ir/term_kind.ts";
import { type ProjectionAliasTy, try_fold_with_Alias, fold_with_Alias, visit_with_Alias } from "../rustc_type_ir/ty/alias.ts";
import { AliasTy, fold_FnSig, type FnSig, ProjectionAliasTy as ProjectionAliasTyC, UnsafeBinderInner } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized, UnnormalizedPolyTraitRef } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import { CRATE_DEF_ID, type DefId, DefId_eq, DefIdSet, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import "../rustc_infer/lib.ts";
import "../rustc_trait_selection/lib.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { normalize_param_env_or_error } from "../rustc_trait_selection/traits/mod.ts";
import { Ok } from "../std/result.ts";


/// If `ty` implements the given `sizedness` trait, returns `None`. Otherwise, returns the type
/// that must implement the given `sizedness` for `ty` to implement it.
// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_ty_utils/src/ty.rs:19 sizedness_constraint_for_ty
function sizedness_constraint_for_ty(tcx: TyCtxt, sizedness: SizedTraitKind, ty: Ty): Ty | undefined {
  const k = ty.kind();
  switch (k.$) {
    // Always `Sized` or `MetaSized`
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "Array":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
      return undefined;

    case "Str":
    case "Slice":
    case "Dynamic":
      switch (sizedness) {
        // Never `Sized`
        case "Sized":
          return ty;
        // Always `MetaSized`
        case "MetaSized":
          return undefined;
      }
      break;

    // Maybe `Sized` or `MetaSized`
    case "Param":
    case "Alias":
    case "Error":
      return ty;

    // We cannot instantiate the binder, so just return the *original* type back,
    // but only if the inner type has a sized constraint. Thus we skip the binder,
    // but don't actually use the result from `sized_constraint_for_ty`.
    case "UnsafeBinder": {
      const inner_ty = k._0;
      return sizedness_constraint_for_ty(tcx, sizedness, BinderC.skip_binder(UnsafeBinderInner.into_Binder(inner_ty))) !== undefined ? ty : undefined;
    }

    // Never `MetaSized` or `Sized`
    case "Foreign":
      return ty;

    // Recursive cases
    case "Pat": {
      const ty = k._0;
      return sizedness_constraint_for_ty(tcx, sizedness, ty);
    }

    case "Tuple": {
      const tys = k._0;
      const last = tys.at(-1);
      return last === undefined ? undefined : sizedness_constraint_for_ty(tcx, sizedness, last);
    }

    case "Adt": {
      const adt = k._0;
      const args = k._1;
      const intermediate = adt.sizedness_constraint(tcx, sizedness);
      if (intermediate === undefined) return undefined;
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(intermediate, tcx, args, fold_Ty));
      return sizedness_constraint_for_ty(tcx, sizedness, ty);
    }

    case "Placeholder":
    case "Bound":
    case "Infer":
      return bug(`unexpected type \`${debug_Ty(ty, PLAIN)}\` in \`sizedness_constraint_for_ty\``);
  }
}

// rustc: compiler/rustc_ty_utils/src/ty.rs:80 defaultness
function defaultness(tcx: TyCtxt, def_id: LocalDefId): Defaultness {
  const node = tcx.hir_node_by_def_id(def_id);
  if (node.$ === "Item" && node._0.kind.$ === "Impl" && node._0.kind._0.of_trait !== undefined) {
    return node._0.kind._0.of_trait.defaultness;
  } else if (node.$ === "ImplItem" && node._0.impl_kind.$ === "Trait") {
    return node._0.impl_kind.defaultness;
  } else if (node.$ === "TraitItem") {
    return node._0.defaultness;
  } else {
    return bug(`\`defaultness\` called on ${debug_Node(node, PLAIN)}`);
  }
}

/// Returns the type of the last field of a struct ("the constraint") which must implement the
/// `sizedness` trait for the whole ADT to be considered to implement that `sizedness` trait.
/// `def_id` is assumed to be the `AdtDef` of a struct and will panic otherwise.
///
/// For `Sized`, there are only a few options for the types in the constraint:
///     - an meta-sized type (str, slices, trait objects, etc)
///     - an pointee-sized type (extern types)
///     - a type parameter or projection whose sizedness can't be known
///
/// For `MetaSized`, there are only a few options for the types in the constraint:
///     - an pointee-sized type (extern types)
///     - a type parameter or projection whose sizedness can't be known
// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_ty_utils/src/ty.rs:114 adt_sizedness_constraint
function adt_sizedness_constraint(tcx: TyCtxt, [def_id, sizedness]: readonly [DefId, SizedTraitKind]): EarlyBinder<Ty> | undefined {
  const local = def_id.as_local();
  if (local !== undefined) {
    tcx.ensure_ok().check_representability(local);
  }

  const def = tcx.adt_def(def_id) as AdtDef;

  if (!def.is_struct()) {
    return bug(`\`adt_sizedness_constraint\` called on non-struct type: ${debug_AdtDef(def, PLAIN)}`);
  }

  const tail_def = def.non_enum_variant().tail_opt();
  if (tail_def === undefined) return undefined;
  const tail_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(tail_def.did) as EarlyBinder<Ty>));

  const constraint_ty = sizedness_constraint_for_ty(tcx, sizedness, tail_ty);
  if (constraint_ty === undefined) return undefined;

  // perf hack: if there is a `constraint_ty: {Meta,}Sized` bound, then we know
  // that the type is sized and do not need to check it on the impl.
  const sizedness_trait_def_id = SizedTraitKind.require_lang_item(sizedness, as_interner(tcx));
  const clauses = (tcx.clauses_of(def.did()) as GenericClauses).clauses;
  if (
    clauses.some(([c, _]) => {
      const trait_pred = c.as_trait_clause();
      return (
        trait_pred !== undefined &&
        DefId_eq(PolyTraitClause.def_id(trait_pred), sizedness_trait_def_id) &&
        BinderC.skip_binder(PolyTraitClause.self_ty(trait_pred)) === constraint_ty
      );
    })
  ) {
    return undefined;
  }

  return EarlyBinder.bind(tcx, constraint_ty, fold_Ty);
}

/// See `ParamEnv` struct definition for details.
// rustc: compiler/rustc_ty_utils/src/ty.rs:150 param_env
function param_env(tcx: TyCtxt, def_id: DefId): ParamEnv {
  if (tcx.is_typeck_child(def_id)) {
    return tcx.param_env(tcx.typeck_root_def_id(def_id)) as ParamEnv;
  }
  // Compute the bounds on Self and the type parameters.
  const { clauses: clauses_ } = GenericClauses.instantiate_identity(tcx.clauses_of(def_id) as GenericClauses, tcx);
  const clauses: Clause[] = clauses_.map(Unnormalized.skip_norm_wip);

  // Finally, we have to normalize the bounds in the environment, in
  // case they contain any associated type projections. This process
  // can yield errors if the put in illegal associated types, like
  // `<i32 as Foo>::Bar` where `i32` does not implement `Foo`. We
  // report these errors right here; this doesn't actually feel
  // right to me, because constructing the environment feels like a
  // kind of an "idempotent" action, but I'm not sure where would be
  // a better place. In practice, we construct environments for
  // every fn once during type checking, and we'll abort if there
  // are any errors at that point, so outside of type inference you can be
  // sure that this will succeed without errors anyway.

  if (tcx.def_kind(def_id).$ === "AssocFn") {
    const assoc_item = tcx.associated_item(def_id) as AssocItem;
    if (assoc_item.container.$ === "Trait" && Defaultness.has_value(AssocItem.defaultness(assoc_item, tcx))) {
      const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
      // We accounted for the binder of the fn sig, so skip the binder.
      fold_FnSig.visit_with(
        BinderC.skip_binder(sig),
        new ImplTraitInTraitFinder(tcx, clauses, def_id, BinderC.bound_vars(sig), new DefIdSet(), { value: INNERMOST }),
      );
    }
  }

  // We extend the param-env of our item with the const conditions of the item,
  // since we're allowed to assume `[const]` bounds hold within the item itself.
  if (tcx.is_conditionally_const(def_id)) {
    clauses.push(
      ...ConstConditions.instantiate_identity(tcx.const_conditions(def_id) as ConstConditions, tcx).map(([trait_ref, _]) =>
        Unnormalized.skip_norm_wip(UnnormalizedPolyTraitRef.to_host_effect_clause(trait_ref, tcx, "Maybe")),
      ),
    );
  }

  const local_did = def_id.as_local() ?? CRATE_DEF_ID;

  const unnormalized_env = ParamEnv.new(tcx, clauses);

  const cause = ObligationCause.misc(tcx.def_span(def_id), local_did);
  return normalize_param_env_or_error(tcx, unnormalized_env, cause);
}

/** PORT (D4): `ProjectionAliasTy` (`Alias<I, DefId>`) as `TypeFoldable` (the derive over `Alias<K>` with `K = DefId`,
 *  which is a trivially-foldable leaf). */
const fold_ProjectionAliasTy: TypeFoldable<ProjectionAliasTy> = {
  visit_with: (self, visitor) => visit_with_Alias(self, visitor, (_k, v) => v.Result.output()),
  try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, (k) => Ok(k)),
  fold_with: (self, folder) => fold_with_Alias(self, folder, (k) => k),
};

/// Walk through a function type, gathering all RPITITs and installing a
/// `NormalizesTo(Projection(RPITIT) -> Opaque(RPITIT))` predicate into the
/// predicates list. This allows us to observe that an RPITIT projects to
/// its corresponding opaque within the body of a default-body trait method.
// rustc-type: compiler/rustc_ty_utils/src/ty.rs:209 ImplTraitInTraitFinder
class ImplTraitInTraitFinder implements TypeVisitor<undefined> {
  /** `type Result = ();` */
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    readonly tcx: TyCtxt,
    readonly clauses: Clause[],
    readonly fn_def_id: DefId,
    readonly bound_vars: BoundVarKinds,
    readonly seen: DefIdSet,
    /** PORT: `DebruijnIndex::shift_in` / `shift_out` take `&mut self`: a `MutRef`. */
    readonly depth: MutRef<DebruijnIndex>,
  ) {}

  // ---- impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for ImplTraitInTraitFinder<'_, 'tcx> ----

  // rustc: compiler/rustc_ty_utils/src/ty.rs:219 visit_binder
  visit_binder<T>(binder: Binder<T>, d: TypeVisitable<T>): undefined {
    DebruijnIndex.shift_in(this.depth, 1);
    visit_Binder(d).super_visit_with(binder, this);
    DebruijnIndex.shift_out(this.depth, 1);
    return undefined;
  }

  // rustc: compiler/rustc_ty_utils/src/ty.rs:225 visit_ty
  visit_ty(ty: Ty): undefined {
    const k = ty.kind();
    if (k.$ === "Alias") {
      const unshifted_alias_ty = AliasTy.try_to_projection(k._1);
      if (unshifted_alias_ty !== undefined) {
        const info = this.tcx.opt_rpitit_info(unshifted_alias_ty.kind) as ImplTraitInTraitData | undefined;
        if (info !== undefined && DefId_eq(info.fn_def_id, this.fn_def_id) && insert(this.seen, unshifted_alias_ty.kind)) {
          // We have entered some binders as we've walked into the
          // bounds of the RPITIT. Shift these binders back out when
          // constructing the top-level projection predicate.
          const shifted_alias_ty = fold_regions(
            this.tcx,
            unshifted_alias_ty,
            (re, depth) => {
              const rk = re.kind();
              if (rk.$ === "ReBound" && rk._0.$ === "Bound") {
                const index = rk._0._0;
                const bv = rk._1;
                if (depth !== INNERMOST) {
                  return Region.new_error_with_message(this.tcx, DUMMY_SP, "we shouldn't walk non-predicate binders with `impl Trait`...");
                }
                return Region.new_bound(this.tcx, DebruijnIndex.shifted_out_to_binder(index, this.depth.value), bv);
              } else {
                return re;
              }
            },
            fold_ProjectionAliasTy,
          );

          // If we're lowering to associated item, install the opaque type which is just
          // the `type_of` of the trait's associated item. If we're using the old lowering
          // strategy, then just reinterpret the associated type like an opaque :^)
          const default_ty = Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(this.tcx.type_of(shifted_alias_ty.kind) as EarlyBinder<Ty>, this.tcx, shifted_alias_ty.args, fold_Ty),
          );

          this.clauses.push(
            Clause_upcast_from_PolyProjectionClause(
              BinderC.bind_with_vars(
                {
                  projection_term: AliasTerm.from_AliasTy(ProjectionAliasTyC.projection_to_alias_ty(shifted_alias_ty)),
                  term: default_ty,
                },
                this.bound_vars,
              ),
              this.tcx,
            ),
          );

          // We walk the *un-shifted* alias ty, because we're tracking the de bruijn
          // binder depth, and if we were to walk `shifted_alias_ty` instead, we'd
          // have to reset `self.depth` back to `ty::INNERMOST` or something. It's
          // easier to just do this.
          for (const bound of [
            ...EarlyBinder.iter_instantiated(this.tcx.item_bounds(unshifted_alias_ty.kind) as EarlyBinder<Clauses>, this.tcx, unshifted_alias_ty.args, fold_Clause),
          ].map(Unnormalized.skip_norm_wip)) {
            fold_Clause.visit_with(bound, this);
          }
        }
      }
    }

    return fold_Ty.super_visit_with(ty, this);
  }

  // ---- provided `TypeVisitor` methods (PORTING §8) ----
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

/** `FxHashSet::insert`: `true` if the value was not present. */
function insert(set: DefIdSet, v: DefId): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

// rustc: compiler/rustc_ty_utils/src/ty.rs:291 param_env_normalized_for_post_analysis
function param_env_normalized_for_post_analysis(tcx: TyCtxt, def_id: DefId): ParamEnv {
  return (tcx.param_env(def_id) as ParamEnv).with_normalized(tcx);
}

/// Check if a function is async.
// rustc: compiler/rustc_ty_utils/src/ty.rs:296 asyncness
function asyncness(tcx: TyCtxt, def_id: LocalDefId): Asyncness {
  const node = tcx.hir_node_by_def_id(def_id);
  const sig = Node.fn_sig(node);
  if (sig === undefined) return "No";
  switch (sig.header.asyncness.$) {
    case "Async":
      return "Yes";
    case "NotAsync":
      return "No";
  }
}

// rustc: compiler/rustc_ty_utils/src/ty.rs:304 unsizing_params_for_adt
function unsizing_params_for_adt(tcx: TyCtxt, def_id: DefId): DenseBitSet<number> {
  const def = tcx.adt_def(def_id) as AdtDef;
  const num_params = (tcx.generics_of(def_id) as Generics).count();

  const maybe_unsizing_param_idx = (arg: GenericArg): number | undefined => {
    const ak = GenericArg.kind(arg);
    switch (ak.$) {
      case "Type": {
        const tk = ak._0.kind();
        return tk.$ === "Param" ? tk._0.index : undefined;
      }

      // We can't unsize a lifetime
      case "Lifetime":
        return undefined;

      case "Const": {
        const ck = ak._0.kind();
        return ck.$ === "Param" ? ck._0.index : undefined;
      }
    }
  };

  // The last field of the structure has to exist and contain type/const parameters.
  const fields = def.non_enum_variant().fields;
  if (fields.length === 0) {
    return DenseBitSet.new_empty(num_params);
  }
  const tail_field = fields[fields.length - 1]!;
  const prefix_fields = fields.slice(0, -1);

  const unsizing_params = DenseBitSet.new_empty<number>(num_params);
  for (const arg of Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(tail_field.did) as EarlyBinder<Ty>)).walk()) {
    const i = maybe_unsizing_param_idx(arg);
    if (i !== undefined) {
      unsizing_params.insert(i);
    }
  }

  // Ensure none of the other fields mention the parameters used
  // in unsizing.
  for (const field of prefix_fields) {
    for (const arg of Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>)).walk()) {
      const i = maybe_unsizing_param_idx(arg);
      if (i !== undefined) {
        unsizing_params.remove(i);
      }
    }
  }

  return unsizing_params;
}

// rustc: compiler/rustc_ty_utils/src/ty.rs:348 impl_self_is_guaranteed_unsized
function impl_self_is_guaranteed_unsized(tcx: TyCtxt, impl_def_id: DefId): boolean {
  // debug_assert_eq!(tcx.def_kind(impl_def_id), DefKind::Impl { of_trait: true });

  const infcx = tcx.infer_ctxt().ignoring_regions().build(TypingModeC.non_body_analysis());

  const ocx = ObligationCtxt.new(infcx);
  const cause = ObligationCause.dummy();
  const param_env = tcx.param_env(impl_def_id) as ParamEnv;

  const self_ty = ocx.normalize(cause, param_env, EarlyBinder.instantiate_identity(tcx.type_of(impl_def_id) as EarlyBinder<Ty>), fold_Ty);
  const tail = tcx.struct_tail_raw(
    self_ty,
    cause,
    (ty) => {
      // FIXME: ambiguity is just ignored.
      return ocx.normalize(cause, param_env, ty, fold_Ty);
    },
    () => {},
  );

  switch (tail.kind().$) {
    case "Dynamic":
    case "Slice":
    case "Str":
      return true;
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Foreign":
    case "Array":
    case "Pat":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "UnsafeBinder":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Tuple":
    case "Alias":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Infer":
    case "Error":
      return false;
  }
}

// rustc: compiler/rustc_ty_utils/src/ty.rs:399 provide
export function provide(providers: Providers): void {
  providers.asyncness = asyncness;
  providers.adt_sizedness_constraint = (tcx, key) => adt_sizedness_constraint(tcx, key as [DefId, SizedTraitKind]);
  providers.param_env = param_env;
  providers.param_env_normalized_for_post_analysis = param_env_normalized_for_post_analysis;
  providers.defaultness = defaultness;
  providers.unsizing_params_for_adt = unsizing_params_for_adt;
  providers.impl_self_is_guaranteed_unsized = impl_self_is_guaranteed_unsized;
}
