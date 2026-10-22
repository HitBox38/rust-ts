// Port of compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs (contract stub: lane selcx-contract; filled
// by lane bck-tc-live, wave 23).
//
// PORT: `FreeRegionsVisitor<OP>` is generated as a data interface (./outlives_for_liveness.gen.ts); its
// `impl TypeVisitor` needs a class, so this module declares the class `FreeRegionsVisitor` (shadowing the generated
// interface of the same name, which it implements; fields in declaration order). `OP: FnMut(ty::Region)` is a closure.
// PORT: `DenseBitSet<u32>` is rustc_index's `DenseBitSet<number>`; `Vec<(usize, DenseBitSet<u32>)>` an array of pairs.
// `FxIndexSet<Ty>` is a `Set<Ty>` (interned `Ty`, insertion-ordered). `#[tracing::instrument]` / `tracing::debug!` are
// comments (filtered by the default logger).
// PORT: the query results (`arena_cache`) are shared: `tcx.live_args_for_alias_from_outlives_bounds(kind).clone()` clones
// before mutating, as upstream does.
// Init order: top-level code here touches only ./outlives_for_liveness.gen.ts and other crates.

import { VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { debug_DefKind } from "../../rustc_hir/def.gen.ts";
import type { OpaqueTyOrigin } from "../../rustc_hir/hir.gen.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { SubregionOrigin } from "../../rustc_infer/infer/mod.ts";
import * as test_type_match from "../../rustc_infer/infer/outlives/test_type_match.ts";
import type { VerifyIfEq } from "../../rustc_infer/infer/region_constraints/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses, Ty as TyT } from "../../rustc_middle/ty/decls.ts";
import { fold_GenericArg, GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { type ImplTraitInTraitData, type ParamEnv, Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { PolyTypeOutlivesClause } from "../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { display_Region } from "../../rustc_type_ir/ir_print.ts";
import type { Variance } from "../../rustc_type_ir/lib.gen.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import { type AliasTyKind, AliasTy, IsRigid } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unwrap } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import { region_known_to_outlive, test_region_obligations } from "../regions.ts";
import type * as gen from "./outlives_for_liveness.gen.ts";

export * from "./outlives_for_liveness.gen.ts";

/// Given a known `param_env` and a set of well formed types, can we prove that
/// `ty` outlives `region`.
///
/// Copied from `ty_known_to_outlive` without normalization for `ty` because we
/// don't want trait solving in liveness queries.
// rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:23 param_known_to_outlive
function param_known_to_outlive(tcx: TyCtxt, id: LocalDefId, param_env: ParamEnv, wf_tys: Set<TyT>, ty: TyT, region: Region): boolean {
  // debug_assert_matches!(ty.kind(), ty::Param(_));

  return test_region_obligations(tcx, id, param_env, wf_tys, (infcx) => {
    const origin: SubregionOrigin = { $: "RelateParamBound", _0: DUMMY_SP, _1: ty, _2: undefined };
    infcx.register_type_outlives_constraint_inner({
      sub_region: region,
      sup_type: ty,
      origin,
    });
    return Ok(null);
  });
}

/// The `def_id` of every `AliasTyKind` variant.
function alias_ty_kind_def_id(kind: AliasTyKind): DefId {
  switch (kind.$) {
    case "Projection":
    case "Inherent":
    case "Opaque":
    case "Free":
      return kind.def_id;
  }
}

/// For a given alias type, this returns the set of indices into the identity generic args that
/// are relevant for liveness, that can be inferred from outlives bounds on the
/// alias itself, and the explicit and implicit outlives clauses of the alias.
/// Callers should use the indices with the concrete args of the alias.
///
/// There are three cases to consider:
/// 1. If there are *no* outlives bounds, then all args are potentially live.
/// 2. If there is a `'static` outlives bound, then we know that all args are
///    irrelevant, so we return an empty set.
/// 3. If there are *any* outlives bounds, then we find any args that are known
///    to outlive those bounds, since those are the args whose regions the
///    underlying type could capture.
// #[tracing::instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:56 live_args_for_alias_from_outlives_bounds
export function live_args_for_alias_from_outlives_bounds(tcx: TyCtxt, kind: AliasTyKind): DenseBitSet<number> {
  const def_id = alias_ty_kind_def_id(kind);
  const self_identity_args = RawList.identity_for_item(tcx, def_id);

  // We first want to collect the outlives bounds of the alias.
  const bounds = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.item_bounds(def_id) as EarlyBinder<Clauses>));
  // tracing::debug!(?bounds);
  const alias_ty = Ty.new_alias(tcx, IsRigid.No, AliasTy.new_from_args(tcx, kind, self_identity_args));
  const outlives_regions: Region[] = [];
  for (const clause of bounds) {
    const r = ((): Region | undefined => {
      const oc = clause.as_type_outlives_clause();
      if (oc === undefined) return undefined;
      const { _0: ty, _1: region } = Binder.skip_binder(oc);
      if (ty !== alias_ty) {
        return undefined;
      }

      // Opaques can't have higher-ranked outlives item bounds. Higher-ranked item bounds
      // for GATs are instantiated with the GAT identity params, so the alias doesn't
      // contain any bound regions. If the region is bound, the alias outlives everything.
      // For example: `for<'a> Self::Assoc<'non_bound>: 'a`.
      if (region.is_bound()) {
        return tcx.lifetimes.re_static;
      } else {
        return region;
      }
    })();
    if (r !== undefined) outlives_regions.push(r);
  }
  // tracing::debug!(?outlives_regions);

  // If there are no outlives bounds, then all (non-bivariant) args are potentially live.
  if (outlives_regions.length === 0) {
    return DenseBitSet.new_filled(self_identity_args.length);
  }

  // If any of the outlives bounds are `'static`, then we know the alias
  // doesn't capture *any* regions, so we can skip visiting any regions at all.
  //
  // I was originally a bit concerned about something like `'a: 'static`, and
  // whether or not we need to mark `'a` as live. I don't think that we do.
  //
  // To dig in a bit: Think about the function using this alias. For the alias
  // to be well-formed, then it must be proven that the arg (`'a` in this case)
  // outlives `'static`. Well, if that is proven *once*, then it must be true
  // across the entire function (because `'static` is free).
  //
  // I think this similarly applies to any other free region, like `'a: 'b`
  // where `'b` is *also* free. Though, we of course can't know *here* which
  // regions are going to be instantiated with free regions.
  if (outlives_regions.includes(tcx.lifetimes.re_static)) {
    // tracing::debug!("alias has a 'static outlives bound, so skipping visiting any regions");
    return DenseBitSet.new_empty(self_identity_args.length);
  }

  // Okay, so we know we have some outlives bounds, and that none of them are `'static`.
  // Now, we need to find all other potentially-live args, those that outlive
  // an outlives-bound region. `args_known_to_outlive_alias_params` does this
  // for us, and in the case of opaques only includes *captured* regions, too.

  const args_known_to_outlive = tcx.args_known_to_outlive_alias_params(def_id) as readonly [number, DenseBitSet<number>][];
  // tracing::debug!(?args_known_to_outlive);
  const live_args = DenseBitSet.new_filled<number>(self_identity_args.length);
  for (const outlives_region of outlives_regions) {
    const outlives_params = args_known_to_outlive.find(([idx, _]) => GenericArg.as_region(self_identity_args[idx]!) === outlives_region);
    if (outlives_params === undefined) {
      continue;
    }
    live_args.intersect(outlives_params[1]);
  }
  return live_args;
}

/// For each region param of this alias compute the indices of the identity args
/// that are known to outlive it, given only the alias's declared where-clauses.
///
/// Note: for opaques (including synthetic associated types from RPITITs),
/// the outlives relationships are identified in the context of the *parent*,
/// since bounds and well-formed types are not lowered.
// #[tracing::instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:144 args_known_to_outlive_alias_params
export function args_known_to_outlive_alias_params(tcx: TyCtxt, def_id: LocalDefId): [number, DenseBitSet<number>][] {
  const kind = tcx.def_kind(def_id);
  let rpitit: ImplTraitInTraitData | undefined;
  if (kind.$ === "OpaqueTy") {
    return args_known_to_outlive_opaque_params(tcx, def_id);
  } else if (kind.$ === "AssocTy" && (rpitit = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id))) !== undefined && rpitit.$ === "Trait") {
    const opaque_def_id = rpitit.opaque_def_id;
    return args_known_to_outlive_opaque_params(tcx, opaque_def_id.expect_local());
  } else if (kind.$ === "AssocTy" || kind.$ === "TyAlias") {
    return args_known_to_outlive_non_opaque_params(tcx, def_id);
  } else {
    return bug(`improper def_kind ${debug_DefKind(kind, PLAIN)} passed to \`live_args_for_alias_from_outlives_bounds\``);
  }
}

/// For each *captured* region of this alias, compute the *captured* identity
/// args that are known to outlive it, given the definition of the opaque type
/// in the the *parent* context.
///
/// Some examples:
/// ```ignore (illustrative)
/// // Returns `[('a, ['a]), ('b, ['b])]`
/// fn foo<'a, 'b>() -> impl Sized + use<'a, 'b> {}
///
/// // Returns `[('a, ['a]), ('b, ['b])]`
/// fn foo<'a: 'a, 'b>() -> impl Sized + use<'a, 'b> {}
///
/// // Returns `[('a, ['a])]`
/// fn foo<'a, 'b>() -> impl Sized + use<'a> {}
///
/// // Returns `[('a, ['a, 'b]), ('b, ['b])]`
/// fn foo<'a, 'b: 'a>() -> impl Sized + use<'a, 'b> {}
///
/// // Returns `[('a, ['a, 'b]), ('b, ['b])]`
/// fn foo<'a, 'b>(_: &'a &'b ()) -> impl Sized + use<'a, 'b> {}
/// ```
///
/// Importantly:
///   - *All* captured regions are considered (not just those in outlives bounds)
///   - It doesn't matter if the captured region is early-bound or late-bound
// #[tracing::instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:189 args_known_to_outlive_opaque_params
export function args_known_to_outlive_opaque_params(tcx: TyCtxt, def_id: LocalDefId): [number, DenseBitSet<number>][] {
  const self_identity_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));

  const result: [number, DenseBitSet<number>][] = [];

  // For implied bounds, we need the set of WF types from the parents.
  //  - For functions, this is all the input and output types.
  //  - For type alias, there are no implied bounds, so this is empty.
  const origin = tcx.opaque_ty_origin(def_id) as OpaqueTyOrigin<DefId>;
  let parent_def_id: DefId;
  let wf_tys: Set<TyT>;
  switch (origin.$) {
    case "FnReturn":
    case "AsyncFn":
    case "TyAlias": {
      const parent = origin.parent;
      // PORT: `FxIndexSet::from_iter(..)`.
      wf_tys = new Set(tcx.assumed_wf_types(parent.expect_local()).map(([ty, _]) => ty));
      parent_def_id = parent;
      break;
    }
  }
  const parent_param_env = tcx.param_env(parent_def_id) as ParamEnv;
  // tracing::debug!(?parent_param_env);

  // Map the outlives regions to the parent regions.
  // If we have `fn foo<'a>() -> impl Sized + 'a`, then this gets lowered as
  // ```ignore (illustrative)
  // opaque foo_opaque<'a0>: Sized + 'a0;
  // fn foo<'a>() -> foo::<'a>::foo_opaque<'a> { ... }
  // ```
  // This maps `'a0` to `'a`, because that is what will be used to get the
  // explicit and implied outlives relations.
  //
  // I suppose, an alternative way to do this would be iterate through all the
  // *parent* regions and then find those that are captured. This should be
  // basically equivalent (except with the added frustration of needing to
  // build a `Region` from the opaque region's `LocalDefId`).
  const generics = tcx.generics_of(def_id) as Generics;
  const parent_outlives_regions: [Region, number][] = [];
  for (let opaque_arg_idx = generics.parent_count; opaque_arg_idx < self_identity_args.length; opaque_arg_idx++) {
    const opaque_arg = self_identity_args[opaque_arg_idx]!;
    const opaque_region = GenericArg.as_region(opaque_arg);
    if (opaque_region === undefined) {
      continue;
    }
    const rk = opaque_region.kind();
    let region_def_id: DefId;
    if (rk.$ === "ReEarlyParam") {
      const ebr = rk._0;
      region_def_id = generics.param_at(ebr.index, tcx).def_id;
    } else {
      return panic(`unexpected region \`${display_Region(opaque_region)}\` in opaque bounds`);
    }
    const parent_region = tcx.map_opaque_lifetime_to_parent_lifetime(region_def_id.expect_local());
    // tracing::debug!(?region_def_id, ?parent_region);
    parent_outlives_regions.push([parent_region, opaque_arg_idx]);
  }
  // tracing::debug!(?parent_outlives_regions);

  // For every captured region, we want to consider outlived args from two sources:
  // 1) *Types*: These come from *parent* generics (and are not duplicated to the opaque)
  // 2) *Captured Regions*
  //
  // In both cases, we need to check known outlives for the *parent* region, because that's where the param_env and wf_tys are.
  for (const [parent_outlived_region, opaque_outlived_arg_idx] of parent_outlives_regions) {
    const opaque_outlives_args = DenseBitSet.new_empty<number>(self_identity_args.length);
    for (let parent_outlived_arg_idx = 0; parent_outlived_arg_idx < generics.parent_count; parent_outlived_arg_idx++) {
      const parent_outlives_arg = self_identity_args[parent_outlived_arg_idx]!;
      const k = GenericArg.kind(parent_outlives_arg);
      let type_outlives: boolean;
      switch (k.$) {
        // Consts don't have any non-static regions
        case "Const":
          continue;
        // Lifetimes should be captured
        case "Lifetime":
          continue;
        case "Type":
          type_outlives = param_known_to_outlive(tcx, def_id, parent_param_env, wf_tys, k._0, parent_outlived_region);
          break;
      }
      if (!type_outlives) {
        continue;
      }

      // Types aren't captured, so don't need to map to the opaque
      opaque_outlives_args.insert(parent_outlived_arg_idx);
    }

    for (const [parent_outlives_region, opaque_arg_idx] of parent_outlives_regions) {
      const region_outlives =
        parent_outlives_region === parent_outlived_region ||
        region_known_to_outlive(tcx, def_id, parent_param_env, wf_tys, parent_outlives_region, parent_outlived_region);
      if (!region_outlives) {
        continue;
      }

      opaque_outlives_args.insert(opaque_arg_idx);
    }

    result.push([opaque_outlived_arg_idx, opaque_outlives_args]);
  }

  return result;
}

// #[tracing::instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:301 args_known_to_outlive_non_opaque_params
export function args_known_to_outlive_non_opaque_params(tcx: TyCtxt, def_id: LocalDefId): [number, DenseBitSet<number>][] {
  const self_identity_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
  const param_env = tcx.param_env(LocalDefId.to_def_id(def_id)) as ParamEnv;
  // tracing::debug!(?param_env);
  const wf_tys = new Set<TyT>(tcx.assumed_wf_types(def_id).map(([ty, _]) => ty));
  const result: [number, DenseBitSet<number>][] = [];
  for (let outlived_arg_idx = 0; outlived_arg_idx < self_identity_args.length; outlived_arg_idx++) {
    const outlived_arg = self_identity_args[outlived_arg_idx]!;
    const outlived_region = GenericArg.as_region(outlived_arg);
    if (outlived_region === undefined) {
      continue;
    }
    const outliving_args = DenseBitSet.new_empty<number>(self_identity_args.length);
    for (let arg_idx = 0; arg_idx < self_identity_args.length; arg_idx++) {
      const arg = self_identity_args[arg_idx]!;
      const k = GenericArg.kind(arg);
      let outlives: boolean;
      switch (k.$) {
        case "Lifetime":
          outlives = region_known_to_outlive(tcx, def_id, param_env, wf_tys, k._0, outlived_region);
          break;
        case "Type":
          outlives = param_known_to_outlive(tcx, def_id, param_env, wf_tys, k._0, outlived_region);
          break;
        case "Const":
          outlives = false;
          break;
      }
      if (outlives) {
        outliving_args.insert(arg_idx);
      }
    }
    result.push([outlived_arg_idx, outliving_args]);
  }
  return result;
}

/// For a param-env clause `for<'v..> <T as Trait>::Assoc<..>: 'bound` that
/// applies to `ty` (an alias with `alias_def_id`), returns the set of indices into the
/// identity args that the underlying type could possibly capture, as restricted by this clause.
///
/// As an example, let's imagine we had the following associated type definition:
/// ```ignore (illustrative)
/// type Assoc<'a, 'b, 'c: 'a> = (&'a &'c (), &'b ());
/// ```
///
/// the following clause:
/// ```ignore (illustrative)
/// for<'x, 'y> T::Assoc<'x, 'x, 'y>: 'x
/// ```
///
/// We know from the clause alone that *given some substitution of `T:Assoc`*,
/// we know that it can capture either the first or the second region. However,
/// the bounds on the associated type itself additionally imply that the
/// third region can *also* be captured, because it outlives the first.
///
/// Now, let's assume we had this clause:
/// ```ignore (illustrative)
/// for<'x, 'y> T::Assoc<'x, 'y, 'x>: 'x
/// ```
///
/// Here, we know that `'a` and `'c` could be captured, but there is no outlives
/// relationship to `'b` for either of those, so the underlying type can't
/// capture any arg containing `'b`.
///
/// Note: because higher-ranked bounds don't have implications, there will be
/// some cases (like `for<'x, 'y, 'z> T::Assoc<'x, 'y, 'z>: 'x`) that won't
/// be satisfiable today, but the logic here should hold whenever there *is*.
///
/// Returns a filled set if the clause doesn't apply to `ty` or gives us no
/// information.
// #[tracing::instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:369 live_args_for_outlives_clause
function live_args_for_outlives_clause(tcx: TyCtxt, alias_def_id: DefId, ty: TyT, outlives: PolyTypeOutlivesClause): DenseBitSet<number> {
  const clause_identity_args = RawList.identity_for_item(tcx, alias_def_id);
  const no_restriction = () => DenseBitSet.new_filled<number>(clause_identity_args.length);

  // N.B. it's okay to skip the binder here (and in the rest of the function),
  // because all variables under binders do not escape
  const ok = Binder.skip_binder(outlives)._0.kind();
  if (ok.$ !== "Alias") {
    return no_restriction();
  }
  const { kind: clause_alias_kind, args: clause_args } = ok._1;
  const clause_def_id = alias_ty_kind_def_id(clause_alias_kind);
  if (!DefId_eq(clause_def_id, alias_def_id)) {
    return no_restriction();
  }

  // Here, we're just using this to check if the clause *could apply* to `ty`,
  // but importantly we don't want to use the returned region, because that is
  // the "last visited" region in `ty` that matches the outlves bound. Actually,
  // we want *all* the identity regions in `ty` that match the outlives bound.
  if (
    test_type_match.extract_verify_if_eq(
      tcx,
      Binder.map_bound(outlives, ({ _0: ty, _1: bound }): VerifyIfEq => ({ ty, bound })),
      ty,
    ) === undefined
  ) {
    return no_restriction();
  }

  const outlived_region = Binder.skip_binder(outlives)._1;
  const rk = outlived_region.kind();
  switch (rk.$) {
    // The underlying type must outlive `'static`, so it can't capture any of the args at all.
    //
    // Of course, you may ask: "what if the function has a `'a: 'static` bound?" See the corresponding
    // comment in `live_args_for_alias_from_outlives_bounds` for why we don't need to worry about that.
    case "ReStatic":
      return DenseBitSet.new_empty(clause_identity_args.length);
    case "ReBound": {
      const br = rk._1;
      // The bound is one of the clause's higher-ranked vars. Find the arg
      // positions it occupies, then (at the alias's identity level) find
      // all args that are known to outlive one of those positions given
      // the alias's declared bounds -- only those can be captured by the
      // underlying type.
      const outlived_regions: number[] = [];
      // PORT: `clause_args.iter().zip(clause_identity_args.iter().enumerate())`.
      const n = Math.min(clause_args.length, clause_identity_args.length);
      for (let identity_arg_idx = 0; identity_arg_idx < n; identity_arg_idx++) {
        const clause_arg = clause_args[identity_arg_idx]!;
        const k = GenericArg.kind(clause_arg);
        switch (k.$) {
          case "Lifetime": {
            const r = k._0;
            const ak = r.kind();
            if (ak.$ === "ReBound" && ak._1.var === br.var) {
              outlived_regions.push(identity_arg_idx);
            }
            break;
          }
          case "Type":
          case "Const": {
            // A bound var inside a type or const arg (e.g.
            // `for<'a> <F as FnOnce<(&'a mut i32,)>>::Output: 'a`)
            // can't be reasoned about at the identity-param level,
            // so conservatively treat the clause as giving no
            // restriction at all.
            if (TypeVisitableExt.has_escaping_bound_vars(clause_arg, fold_GenericArg)) {
              return no_restriction();
            }
            break;
          }
        }
      }
      if (outlived_regions.length === 0) {
        // The bound var doesn't appear in the args at all, so the clause
        // requires the underlying type to outlive *every* region, which
        // is equivalent to a `'static` bound.
        return DenseBitSet.new_empty(clause_identity_args.length);
      }

      // The underlying type can capture any arg that's known to outlive one
      // of the bound var's positions (they're all instantiated to the same
      // region at any use site this clause applies to).
      const args_known_to_outlive = tcx.args_known_to_outlive_alias_params(alias_def_id) as readonly [number, DenseBitSet<number>][];
      // tracing::debug!(?outlived_regions, ?args_known_to_outlive);
      const capturable_args = DenseBitSet.new_empty<number>(clause_identity_args.length);
      for (const outlived_arg_idx of outlived_regions) {
        const [_, outliving_args] = unwrap(args_known_to_outlive.find(([arg_idx, _]) => arg_idx === outlived_arg_idx));
        capturable_args.union(outliving_args);
      }
      return capturable_args;
    }
    // A free region (e.g. `for<a> T::Assoc<'a, 'x>: 'x`, where `'x` is free).
    // This is effectively the same as `for<'a, 'b> T::Assoc<'a, 'b>: 'b`,
    // but that only is sound if we either know that the second substituted
    // lifetime equals `'x` or if we *constrain* that lifetime to be `'x`.
    //
    // In either case, something like this doesn't work today:
    // ```ignore (illustrative)
    //  fn bar<'a, 'b>(a: &'a mut (), b: &'b ()) -> <Foo as MyTrait>::Assoc<'a, 'b> { b }
    //  fn foo<'x>()
    //  where
    //      for<'h> <Foo as MyTrait>::Assoc<'h, 'x>: 'x,
    //  {
    //      let a = &mut ();
    //      let b: &'x () = &();
    //      let val1 = rpit(a, b);
    //      let val2 = rpit(a, b);
    //      drop(val1);
    //      drop(val32);
    //  }
    // ```
    // So, we conservatively treat this as giving no restriction on which args can be captured.
    case "ReEarlyParam":
      return no_restriction();
    // Don't know that we actually hit this (maybe `ReError`), go ahead and be conservative.
    default:
      return no_restriction();
  }
}

/// Visits free regions in the type that are relevant for liveness computation.
/// These regions are passed to `OP`.
///
/// Specifically, we visit all of the regions of types recursively, except if
/// the type is an alias, we look at the outlives bounds in the param-env and
/// the alias's item bounds. Each such bound restricts which of the alias's
/// args the underlying type could have captured, so only those (capturable)
/// args are visited. If there are no applicable bounds, we walk through the
/// alias's (non-bivariant) args structurally.
// rustc-type: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:502 FreeRegionsVisitor
export class FreeRegionsVisitor<OP extends (r: Region) => void = (r: Region) => void>
  implements gen.FreeRegionsVisitor<OP>, TypeVisitor<undefined>
{
  /** `type Result = ();` */
  readonly Result = VisitorResult.unit;

  constructor(
    public tcx: TyCtxt,
    public param_env: ParamEnv,
    public op: OP,
  ) {}

  // ---- impl<'tcx, OP> TypeVisitor<TyCtxt<'tcx>> for FreeRegionsVisitor<'tcx, OP> ----

  // rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:512 visit_region
  visit_region(r: Region): undefined {
    switch (r.kind().$) {
      // ignore bound regions, keep visiting
      case "ReBound":
        break;
      default:
        this.op(r);
    }
    return undefined;
  }

  // #[tracing::instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:521 visit_ty
  visit_ty(ty: TyT): undefined {
    // We're only interested in types involving regions
    if (!TypeFlags.intersects(ty.flags(), TypeFlags.HAS_FREE_REGIONS)) {
      return undefined;
    }

    const k = ty.kind();
    switch (k.$) {
      // We can prove that an alias is live two ways:
      // 1. All the components are live.
      // 2. There is a known outlives bound or where-clause, and that
      //    region is live.
      //
      // We search through the item bounds and where clauses for
      // either `'static` or a unique outlives region, and if one is
      // found, we just need to prove that that region is still live.
      // If one is not found, then we continue to walk through the alias.
      case "Alias": {
        const { kind, args } = k._1;
        const tcx = this.tcx;
        const param_env = this.param_env;

        // For aliases other than opaques, we have to consider two
        // sources of information to identity potentially-live args:
        // - Bounds on alias item itself
        // - Outlives clauses on the current function that apply to the alias
        //
        // Each source of information *restricts* the set of potentially-live
        // args independently: only the args that can be live for *every*
        // source of information can be actually live, so we take the intersection.
        const def_id = alias_ty_kind_def_id(kind);
        const capturable = (tcx.live_args_for_alias_from_outlives_bounds(kind) as DenseBitSet<number>).clone();

        for (const clause of param_env.caller_bounds()) {
          const outlives = clause.as_type_outlives_clause();
          if (outlives === undefined) {
            continue;
          }
          capturable.intersect(live_args_for_outlives_clause(tcx, def_id, ty, outlives));
        }
        // tracing::debug!(?capturable);

        // Skip lifetime parameters that are not captured, since they do
        // not need to be live.
        const variances = tcx.opt_alias_variances(AliasTermKind.from_AliasTyKind(kind)) as readonly Variance[] | undefined;
        for (const idx of capturable.iter()) {
          if (variances === undefined || variances[idx] !== "Bivariant") {
            fold_GenericArg.visit_with(args[idx]!, this);
          }
        }
        break;
      }

      default:
        fold_Ty.super_visit_with(ty, this);
    }
    return undefined;
  }

  // (provided) the methods `FreeRegionsVisitor` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
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
