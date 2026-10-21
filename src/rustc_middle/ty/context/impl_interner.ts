//! Implementation of [`rustc_type_ir::Interner`] for [`TyCtxt`].
// Port of compiler/rustc_middle/src/ty/context/impl_interner.rs.
//
// PORT (D3, rustc_type_ir/interner.ts header): `impl Interner for TyCtxt` is a set of `TyCtxt.prototype` methods,
// declared in ty/decls.ts (`// ty/context/impl_interner.rs:<line>`). The associated types are erased (fixed in the
// interner.ts header table). An `Interner` method whose body only forwards to the same-named inherent method or
// query of `TyCtxt` (`fn generics_of(self, d) { self.generics_of(d) }`) is served by that method: its marker below
// is followed by a `served by` line, no code. `Interner` methods whose name `TyCtxt` already uses for an incompatible
// inherent method or query are `ir_<name>`.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
// PORT: `RegionVid::as_usize` / `DebruijnIndex::as_usize` / `BoundVar::as_usize` are the identity on the branded
// numbers; `slice.get(i)` is `arr[i]` (`undefined` = `None`).
import type { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { try_visit } from "../../../rustc_ast_ir/visit.ts";
import type { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { Interned } from "../../../rustc_data_structures/intern.ts";
import { Constness, Defaultness, Safety } from "../../../rustc_hir/lib.ts";
import type { DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../../rustc_span/lib.ts";
import { unported } from "../../../std/panic.ts";
import { as_interner, TraitRef as TraitRef_ir } from "../../../rustc_type_ir/predicate.ts";
import type {
  AliasConstKind,
  BoundRegion,
  BoundVar,
  CanonicalParamEnvCache,
  DebruijnIndex,
  EarlyBinder,
  GlobalCache,
  PolyTraitRef,
  RegionVid,
  SolverAdtLangItem,
  SolverProjectionLangItem,
  SolverTraitLangItem,
  TraitRef,
} from "../../../rustc_type_ir/decls.ts";
import type { Const, Region } from "../../../rustc_type_ir/sty/mod.ts";
import type { DepNodeIndex } from "../../dep_graph/graph.ts";
import { WithDepNode } from "../../traits/cache.ts";
import { TyCtxt } from "../context.ts";
import type { CanonicalInput, Tracked } from "../decls.ts";
import type { GenericArg, GenericArgs } from "../generic_args.ts";
import type { List } from "../list.ts";
import type { Clause } from "../predicate.ts";
import type { ConstConditions, GenericClauses } from "../generics.ts";
import type { AssocItems as AssocItemsT } from "../assoc.ts";
import type { TraitDef } from "../trait_def.ts";

// `impl Interner for TyCtxt` (impl_interner.rs:31)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:32 next_trait_solver_globally
// served by the inherent `next_trait_solver_globally` (ty/context.rs:2819)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:72 mk_predefined_opaques_in_body
// served by the inherent `mk_predefined_opaques_in_body` (ty/context.rs `slice_interners!`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:80 mk_canonical_var_kinds
// served by the inherent `mk_canonical_var_kinds` (ty/context.rs `slice_interners!`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:88 mk_external_constraints
// served by the inherent `mk_external_constraints` (ty/context.rs `direct_interners!`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:95 with_cached_task
TyCtxt.prototype.with_cached_task = function <T>(this: TyCtxt, task: () => T): [T, DepNodeIndex] {
  return this.dep_graph.with_anon_task(this, "TraitSelect", task);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:133 mk_tracked
TyCtxt.prototype.mk_tracked = function <T>(this: TyCtxt, data: T, dep_node: DepNodeIndex): Tracked<T> {
  return WithDepNode.new(dep_node, data);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:140 get_tracked
TyCtxt.prototype.get_tracked = function <T>(this: TyCtxt, tracked: Tracked<T>): T {
  return tracked.get(this);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:144 with_global_cache
TyCtxt.prototype.with_global_cache = function <R>(this: TyCtxt, f: (cache: GlobalCache) => R): R {
  // PORT: `Lock::lock` is the inner value (PORTING §5).
  return f(this.caches.new_solver_evaluation_cache);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:148 with_canonical_param_env_cache
TyCtxt.prototype.with_canonical_param_env_cache = function <R>(this: TyCtxt, f: (cache: CanonicalParamEnvCache) => R): R {
  // PORT: `Lock::lock` is the inner value (PORTING §5).
  return f(this.caches.new_solver_canonical_param_env_cache);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:155 assert_evaluation_is_concurrent
TyCtxt.prototype.assert_evaluation_is_concurrent = function (this: TyCtxt): void {
  // Turns out, the assumption for this function isn't perfect.
  // See trait-system-refactor-initiative#234.
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:160 expand_abstract_consts
// served by the inherent `expand_abstract_consts` (ty/abstract_const.rs:37)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:166 generics_of
// served by the query `generics_of`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:172 variances_of
// served by the query `variances_of`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:176 opt_alias_variances
// served by the inherent `opt_alias_variances` (ty/util.rs:954)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:183 type_of
// served by the query `type_of`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:186 type_of_opaque_hir_typeck
// served by the query `type_of_opaque_hir_typeck`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:189 is_direct_const
TyCtxt.prototype.ir_is_direct_const = function (this: TyCtxt, alias: AliasConstKind): boolean {
  switch (alias.$) {
    case "Projection":
    case "InherentSelf":
    case "InherentImpl":
    case "Free":
      return this.is_direct_const(alias.def_id);
    case "Anon":
      return false;
  }
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:198 const_of_item
TyCtxt.prototype.ir_const_of_item = function (this: TyCtxt, alias: AliasConstKind): EarlyBinder<Const> | undefined {
  switch (alias.$) {
    case "Projection":
    case "InherentSelf":
    case "InherentImpl":
    case "Free":
      return this.const_of_item(alias.def_id) as EarlyBinder<Const> | undefined;
    case "Anon":
      return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:210 anon_const_kind
// served by the query `anon_const_kind`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:214 def_span
// served by the query `def_span`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:219 adt_def
// served by the query `adt_def`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:223 trait_ref_and_own_args_for_alias
TyCtxt.prototype.trait_ref_and_own_args_for_alias = function (this: TyCtxt, def_id: DefId, args: GenericArgs): [TraitRef, readonly GenericArg[]] {
  // debug_assert_matches!(self.def_kind(def_id), DefKind::AssocTy | DefKind::AssocConst);
  const trait_def_id = this.parent(def_id);
  // debug_assert_matches!(self.def_kind(trait_def_id), DefKind::Trait);
  const trait_ref = TraitRef_ir.from_assoc(as_interner(this), trait_def_id, args);
  return [trait_ref, args.slice(trait_ref.args.length)];
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:235 mk_args
// served by the inherent `mk_args` (ty/context.rs `slice_interners!`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:239 mk_args_from_iter
// served by the inherent `mk_args_from_iter` (ty/context.rs:2571)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:247 check_alias_term_args_compatible
// served by the inherent `check_alias_term_args_compatible` (ty/context.rs:2162)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:255 debug_assert_args_compatible
// served by the inherent `debug_assert_args_compatible` (ty/context.rs:2235)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:259 debug_assert_alias_term_args_compatible
// served by the inherent `debug_assert_alias_term_args_compatible` (ty/context.rs:2243)

/// Assert that the args from an `ExistentialTraitRef` or `ExistentialProjection`
/// are compatible with the `DefId`. Since we're missing a `Self` type, stick on
/// a dummy self type and forward to `debug_assert_args_compatible`.
// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:270 debug_assert_existential_args_compatible
TyCtxt.prototype.debug_assert_existential_args_compatible = function (this: TyCtxt, def_id: DefId, args: GenericArgs): void {
  // FIXME: We could perhaps add a `skip: usize` to `debug_assert_args_compatible`
  // to avoid needing to reintern the set of args...
  // PORT: `cfg!(debug_assertions)` is false (the oracle is a release build), so the body is skipped:
  // if cfg!(debug_assertions) {
  //     self.debug_assert_args_compatible(def_id, self.mk_args_from_iter(
  //         [self.types.trait_object_dummy_self.into()].into_iter().chain(args.iter())));
  // }
  void [def_id, args];
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:287 mk_type_list_from_iter
// served by the inherent `mk_type_list_from_iter` (ty/context.rs:2563)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:295 mk_ct_from_kind
// served by the inherent `mk_ct_from_kind` (ty/context.rs:2356)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:299 projection_parent
TyCtxt.prototype.projection_parent = function (this: TyCtxt, def_id: DefId): DefId {
  return this.parent(def_id);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:303 impl_or_trait_assoc_term_parent
TyCtxt.prototype.impl_or_trait_assoc_term_parent = function (this: TyCtxt, def_id: DefId): DefId {
  return this.parent(def_id);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:307 inherent_alias_term_parent
TyCtxt.prototype.inherent_alias_term_parent = function (this: TyCtxt, def_id: DefId): DefId {
  return this.parent(def_id);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:311 recursion_limit
TyCtxt.prototype.ir_recursion_limit = function (this: TyCtxt): number {
  return this.recursion_limit()._0;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:317 features
// served by the inherent `features` (ty/context.rs:1089)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:321 assumptions_on_binders
// served by the inherent `assumptions_on_binders` (ty/context.rs:2843)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:325 renormalize_rigid_aliases
// served by the inherent `renormalize_rigid_aliases` (ty/context.rs:2833)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:329 coroutine_hidden_types
// served by the query `coroutine_hidden_types`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:336 fn_sig
// served by the query `fn_sig`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:340 coroutine_movability
// served by the inherent `coroutine_movability` (ty/context.rs:1049)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:344 coroutine_for_closure
// served by the query `coroutine_for_closure`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:348 generics_require_sized_self
// served by the query `generics_require_sized_self`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:352 item_bounds
// served by the query `item_bounds` (`.map_bound(IntoIterator::into_iter)`: a list is its own iterable)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:359 item_self_bounds
// served by the query `item_self_bounds` (`.map_bound(IntoIterator::into_iter)`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:366 item_non_self_bounds
// served by the query `item_non_self_bounds` (`.map_bound(IntoIterator::into_iter)`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:373 clauses_of
TyCtxt.prototype.ir_clauses_of = function (this: TyCtxt, def_id: DefId): EarlyBinder<Iterable<Clause>> {
  const { EarlyBinder } = tyir_binder();
  const { Unnormalized } = tyir_unnormalized();
  // PORT: the `clauses_of` query value is `unknown` in queries.gen.ts: it is a `GenericClauses`.
  const clauses = middle_generics().GenericClauses.instantiate_identity(this.clauses_of(def_id) as GenericClauses, this).clauses;
  return EarlyBinder.bind_iter(map_iter(clauses, (c) => Unnormalized.skip_normalization(c)));
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:386 own_clauses_of
TyCtxt.prototype.own_clauses_of = function (this: TyCtxt, def_id: DefId): EarlyBinder<Iterable<Clause>> {
  const { EarlyBinder } = tyir_binder();
  const { Unnormalized } = tyir_unnormalized();
  // PORT: the `clauses_of` query value is `unknown` in queries.gen.ts: it is a `GenericClauses`.
  const own = middle_generics().GenericClauses.instantiate_own_identity(this.clauses_of(def_id) as GenericClauses);
  return EarlyBinder.bind_iter(map_iter(own, ([clause, _]) => Unnormalized.skip_normalization(clause)));
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:397 explicit_super_clauses_of
// served by the query `explicit_super_clauses_of` (`.map_bound(|preds| preds.into_iter().copied())`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:404 explicit_implied_clauses_of
// served by the query `explicit_implied_clauses_of` (`.map_bound(|preds| preds.into_iter().copied())`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:411 impl_super_outlives
// served by the query `impl_super_outlives`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:418 supertrait_def_ids
TyCtxt.prototype.supertrait_def_ids = function (this: TyCtxt, trait_def_id: DefId): Iterable<DefId> {
  // rustc_type_ir::elaborate::supertrait_def_ids(self, trait_def_id)
  void trait_def_id;
  return unported("rustc_type_ir::elaborate::supertrait_def_ids (elaborate.rs)");
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:422 impl_is_const
TyCtxt.prototype.impl_is_const = function (this: TyCtxt, def_id: DefId): boolean {
  // debug_assert_matches!(self.def_kind(def_id), DefKind::Impl { of_trait: true });
  return this.is_conditionally_const(def_id);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:427 fn_is_const
TyCtxt.prototype.fn_is_const = function (this: TyCtxt, def_id: DefId): boolean {
  // debug_assert_matches!(self.def_kind(def_id), DefKind::Fn | DefKind::AssocFn | DefKind::Ctor(_, CtorKind::Fn));
  return this.is_conditionally_const(def_id);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:435 closure_is_const
TyCtxt.prototype.closure_is_const = function (this: TyCtxt, def_id: DefId): boolean {
  // debug_assert_matches!(self.def_kind(def_id), DefKind::Closure);
  const c = this.constness(def_id) as Constness;
  return c.$ === "Const" && c.always === false;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:440 alias_has_const_conditions
TyCtxt.prototype.alias_has_const_conditions = function (this: TyCtxt, def_id: DefId): boolean {
  // debug_assert_matches!(self.def_kind(def_id), DefKind::AssocTy | DefKind::OpaqueTy);
  return this.is_conditionally_const(def_id);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:445 const_conditions
TyCtxt.prototype.ir_const_conditions = function (this: TyCtxt, def_id: DefId): EarlyBinder<Iterable<PolyTraitRef>> {
  const { EarlyBinder } = tyir_binder();
  const { Unnormalized } = tyir_unnormalized();
  // PORT: the `const_conditions` query value is `unknown` in queries.gen.ts: it is a `ConstConditions`.
  const conds = middle_generics().ConstConditions.instantiate_identity(this.const_conditions(def_id) as ConstConditions, this);
  return EarlyBinder.bind_iter(map_iter(conds, ([c, _]) => Unnormalized.skip_normalization(c)));
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:457 explicit_implied_const_bounds
TyCtxt.prototype.ir_explicit_implied_const_bounds = function (this: TyCtxt, def_id: DefId): EarlyBinder<Iterable<PolyTraitRef>> {
  const { EarlyBinder } = tyir_binder();
  const { Unnormalized } = tyir_unnormalized();
  // PORT: the `explicit_implied_const_bounds` query value is `unknown` in queries.gen.ts: it is an
  // `EarlyBinder<&[(PolyTraitRef, Span)]>`.
  const bounds = this.explicit_implied_const_bounds(def_id) as EarlyBinder<readonly (readonly [PolyTraitRef, Span])[]>;
  return EarlyBinder.bind_iter(
    map_iter(
      map_iter(EarlyBinder.iter_identity_copied(bounds), (u) => Unnormalized.skip_normalization(u)),
      ([c, _]) => c,
    ),
  );
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:469 impl_self_is_guaranteed_unsized
// served by the query `impl_self_is_guaranteed_unsized`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:473 has_target_features
TyCtxt.prototype.has_target_features = function (this: TyCtxt, def_id: DefId): boolean {
  return !((this.codegen_fn_attrs(def_id) as { target_features: readonly unknown[] }).target_features.length === 0);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:477 require_projection_lang_item
TyCtxt.prototype.require_projection_lang_item = function (this: TyCtxt, lang_item: SolverProjectionLangItem): DefId {
  return this.require_lang_item(solver_lang_item_to_lang_item(lang_item), DUMMY_SP);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:481 require_trait_lang_item
TyCtxt.prototype.require_trait_lang_item = function (this: TyCtxt, lang_item: SolverTraitLangItem): DefId {
  return this.require_lang_item(solver_trait_lang_item_to_lang_item(lang_item), DUMMY_SP);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:485 require_adt_lang_item
TyCtxt.prototype.require_adt_lang_item = function (this: TyCtxt, lang_item: SolverAdtLangItem): DefId {
  return this.require_lang_item(solver_adt_lang_item_to_lang_item(lang_item), DUMMY_SP);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:489 is_projection_lang_item
TyCtxt.prototype.is_projection_lang_item = function (this: TyCtxt, def_id: DefId, lang_item: SolverProjectionLangItem): boolean {
  return this.is_lang_item(def_id, solver_lang_item_to_lang_item(lang_item));
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:493 is_trait_lang_item
TyCtxt.prototype.is_trait_lang_item = function (this: TyCtxt, def_id: DefId, lang_item: SolverTraitLangItem): boolean {
  return this.is_lang_item(def_id, solver_trait_lang_item_to_lang_item(lang_item));
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:497 is_adt_lang_item
TyCtxt.prototype.is_adt_lang_item = function (this: TyCtxt, def_id: DefId, lang_item: SolverAdtLangItem): boolean {
  return this.is_lang_item(def_id, solver_adt_lang_item_to_lang_item(lang_item));
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:501 is_default_trait
// served by the inherent `is_default_trait` (ty/context.rs:927)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:505 is_sizedness_trait
// served by the inherent `is_sizedness_trait` (ty/context.rs:931)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:509 as_projection_lang_item
TyCtxt.prototype.as_projection_lang_item = function (this: TyCtxt, def_id: DefId): SolverProjectionLangItem | undefined {
  const l = this.lang_items().from_def_id(def_id);
  if (l === undefined) return undefined;
  return lang_item_to_solver_lang_item(l);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:513 as_trait_lang_item
TyCtxt.prototype.as_trait_lang_item = function (this: TyCtxt, def_id: DefId): SolverTraitLangItem | undefined {
  const l = this.lang_items().from_def_id(def_id);
  if (l === undefined) return undefined;
  return lang_item_to_solver_trait_lang_item(l);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:517 as_adt_lang_item
TyCtxt.prototype.as_adt_lang_item = function (this: TyCtxt, def_id: DefId): SolverAdtLangItem | undefined {
  const l = this.lang_items().from_def_id(def_id);
  if (l === undefined) return undefined;
  return lang_item_to_solver_adt_lang_item(l);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:521 associated_type_def_ids
TyCtxt.prototype.associated_type_def_ids = function (this: TyCtxt, def_id: DefId): Iterable<DefId> {
  const { AssocItem, AssocItems } = middle_assoc();
  // PORT: the `associated_items` query value is `unknown` in queries.gen.ts: it is an `AssocItems`.
  const items = AssocItems.in_definition_order(this.associated_items(def_id) as AssocItemsT);
  return (function* () {
    for (const assoc_item of items) if (AssocItem.is_type(assoc_item)) yield assoc_item.def_id;
  })();
};

// This signature is a bit different from `TyCtxt::for_each_relevant_impl`.
// While rustc only needs self_ty, rust-analyzer's impl needs to use all the args.
// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:530 for_each_relevant_impl
TyCtxt.prototype.ir_for_each_relevant_impl = function <R>(this: TyCtxt, trait_ref: TraitRef, f: (impl_def_id: DefId) => R, r: VisitorResult<R, unknown>): R {
  const self_ty = trait_ref.args.type_at(0);
  // debug_assert!(!matches!(self_ty.kind(), ty::Infer(ty::TyVar(_)) | ty::Param(_) | ty::Bound(_, _)),
  //     "we should not have them as self ty in the next solver");
  return this.for_each_relevant_impl(trait_ref.def_id, self_ty, f, r);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:542 for_each_blanket_impl
TyCtxt.prototype.for_each_blanket_impl = function <R>(this: TyCtxt, trait_def_id: DefId, f: (impl_def_id: DefId) => R, r: VisitorResult<R, unknown>): R {
  // PORT: `TraitImpls::blanket_impls` (ty/trait_def.rs, lane ty-adt-assoc) is `&self.blanket_impls`.
  const trait_impls = this.trait_impls_of(trait_def_id) as { blanket_impls: readonly DefId[] };
  for (const impl_def_id of trait_impls.blanket_impls) {
    let res: R | undefined;
    if ((res = try_visit(r, f(impl_def_id))) !== undefined) return res;
  }

  return r.output();
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:555 has_item_definition
TyCtxt.prototype.has_item_definition = function (this: TyCtxt, def_id: DefId): boolean {
  return Defaultness.has_value(this.defaultness(def_id) as Defaultness);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:559 impl_specializes
TyCtxt.prototype.impl_specializes = function (this: TyCtxt, impl_def_id: DefId, victim_def_id: DefId): boolean {
  return this.specializes([impl_def_id, victim_def_id]);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:563 impl_is_default
TyCtxt.prototype.impl_is_default = function (this: TyCtxt, impl_def_id: DefId): boolean {
  return Defaultness.is_default(this.defaultness(impl_def_id) as Defaultness);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:567 impl_trait_ref
// served by the inherent `impl_trait_ref` (ty/mod.rs:2099)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:571 impl_polarity
// served by the inherent `impl_polarity` (ty/mod.rs:2093)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:575 is_fully_generic_for_reflection
TyCtxt.prototype.is_fully_generic_for_reflection = function (this: TyCtxt, impl_def_id: DefId): boolean {
  return this.impl_is_fully_generic_for_reflection(impl_def_id) as boolean;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:579 trait_is_auto
// served by the inherent `trait_is_auto` (ty/mod.rs:1916)

// PORT: the `trait_def` query value is `unknown` in queries.gen.ts: these cast it to `TraitDef` (ty/trait_def.rs).

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:583 trait_is_marker
TyCtxt.prototype.trait_is_marker = function (this: TyCtxt, trait_def_id: DefId): boolean {
  return (this.trait_def(trait_def_id) as TraitDef).is_marker;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:587 trait_is_coinductive
// served by the inherent `trait_is_coinductive` (ty/mod.rs:1922)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:591 trait_is_alias
// served by the inherent `trait_is_alias` (ty/mod.rs:1927)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:595 trait_is_dyn_compatible
TyCtxt.prototype.trait_is_dyn_compatible = function (this: TyCtxt, trait_def_id: DefId): boolean {
  return this.is_dyn_compatible(trait_def_id) as boolean;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:599 trait_is_fundamental
TyCtxt.prototype.trait_is_fundamental = function (this: TyCtxt, def_id: DefId): boolean {
  return (this.trait_def(def_id) as TraitDef).is_fundamental;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:603 trait_is_unsafe
TyCtxt.prototype.trait_is_unsafe = function (this: TyCtxt, trait_def_id: DefId): boolean {
  return Safety.is_unsafe((this.trait_def(trait_def_id) as TraitDef).safety);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:607 is_impl_trait_in_trait
// served by the inherent `is_impl_trait_in_trait` (ty/context.rs:2847)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:611 delay_bug
TyCtxt.prototype.delay_bug = function (this: TyCtxt, msg: string): ErrorGuaranteed {
  return this.dcx().span_delayed_bug(DUMMY_SP, msg);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:615 span_delayed_bug
TyCtxt.prototype.span_delayed_bug = function (this: TyCtxt, span: Span, msg: string): ErrorGuaranteed {
  return this.dcx().span_delayed_bug(span, msg);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:619 is_general_coroutine
// served by the inherent `is_general_coroutine` (ty/context.rs:1069)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:623 coroutine_is_async
// served by the inherent `coroutine_is_async` (ty/context.rs:1054)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:627 coroutine_is_gen
// served by the inherent `coroutine_is_gen` (ty/context.rs:1074)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:631 coroutine_is_async_gen
// served by the inherent `coroutine_is_async_gen` (ty/context.rs:1082)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:636 unsizing_params_for_adt
// served by the query `unsizing_params_for_adt`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:640 anonymize_bound_vars
// served by the inherent `anonymize_bound_vars` (ty/fold.rs:329)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:647 opaque_types_defined_by
// served by the query `opaque_types_defined_by`

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:651 opaque_types_and_coroutines_defined_by
TyCtxt.prototype.opaque_types_and_coroutines_defined_by = function (this: TyCtxt, defining_anchor: LocalDefId): List<LocalDefId> {
  // PORT: the `filter` is lazy: it runs as `mk_local_def_ids_from_iter` collects, after the opaques.
  const nested = this.nested_bodies_within(defining_anchor) as readonly LocalDefId[];
  const tcx = this;
  const coroutines_defined_by = (function* () {
    for (const def_id of nested) if (tcx.is_coroutine(LocalDefIdC.to_def_id(def_id))) yield def_id;
  })();
  const opaques = this.opaque_types_defined_by(defining_anchor) as List<LocalDefId>;
  return this.mk_local_def_ids_from_iter(
    (function* () {
      yield* opaques;
      yield* coroutines_defined_by;
    })(),
  );
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:665 mk_probe
TyCtxt.prototype.mk_probe = function (this: TyCtxt, probe: Parameters<TyCtxt["mk_probe"]>[0]): ReturnType<TyCtxt["mk_probe"]> {
  // PORT: `self.arena.alloc(probe)`: the arena is erased (PORTING §5).
  return probe;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:669 mk_canonical_input
TyCtxt.prototype.mk_canonical_input = function (this: TyCtxt, data: Parameters<TyCtxt["mk_canonical_input"]>[0]): CanonicalInput {
  return this.intern_canonical_input(data);
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:672 evaluate_root_goal_for_proof_tree_raw
TyCtxt.prototype.ir_evaluate_root_goal_for_proof_tree_raw = function (this: TyCtxt, canonical_goal: CanonicalInput, root_depth: number): ReturnType<TyCtxt["ir_evaluate_root_goal_for_proof_tree_raw"]> {
  return this.evaluate_root_goal_for_proof_tree_raw([canonical_goal, root_depth]) as ReturnType<TyCtxt["ir_evaluate_root_goal_for_proof_tree_raw"]>;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:680 item_name
// served by the inherent `item_name` (ty/mod.rs:1710; same body: `opt_item_name(id)` or `bug!`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:686 get_anon_re_bounds_lifetime
TyCtxt.prototype.get_anon_re_bounds_lifetime = function (this: TyCtxt, idx: number, var_idx: number): Region | undefined {
  const inner = this.lifetimes.anon_re_bounds[idx];
  if (inner !== undefined) {
    return inner[var_idx];
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:694 get_anon_re_canonical_bounds_lifetime
TyCtxt.prototype.get_anon_re_canonical_bounds_lifetime = function (this: TyCtxt, idx: number): Region | undefined {
  return this.lifetimes.anon_re_canonical_bounds[idx];
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:698 get_re_static_lifetime
TyCtxt.prototype.get_re_static_lifetime = function (this: TyCtxt): Region {
  return this.lifetimes.re_static;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:702 intern_re_var
TyCtxt.prototype.intern_re_var = function (this: TyCtxt, rv: RegionVid): Region {
  // Use a pre-interned one when possible.
  return this.lifetimes.re_vars[rv] ?? this.intern_region({ $: "ReVar", _0: rv });
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:711 intern_region
// served by the inherent `intern_region` (ty/context.rs `direct_interners!`)

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:715 intern_bound_region
TyCtxt.prototype.intern_bound_region = function (this: TyCtxt, debruijn: DebruijnIndex, bound_region: BoundRegion): Region {
  // Use a pre-interned one when possible.
  if (bound_region.kind.$ === "Anon") {
    const inner = this.lifetimes.anon_re_bounds[debruijn];
    const re = inner === undefined ? undefined : inner[bound_region.var];
    if (re !== undefined) return re;
  }
  return this.intern_region({ $: "ReBound", _0: { $: "Bound", _0: debruijn }, _1: bound_region });
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:731 intern_canonical_bound
TyCtxt.prototype.intern_canonical_bound = function (this: TyCtxt, var_: BoundVar): Region {
  // Use a pre-interned one when possible.
  const re = this.lifetimes.anon_re_canonical_bounds[var_];
  if (re !== undefined) {
    return re;
  } else {
    return this.intern_region({ $: "ReBound", _0: { $: "Canonical" }, _1: { var: var_, kind: { $: "Anon" } } });
  }
};

// `impl rustc_type_ir::intern::Interned<TyCtxt> for Interned<'tcx, T>` (impl_interner.rs:744)
// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:746 get
/** PORT (D2): an `Interned<T>` is the hash-consed object itself, so `*self.0` is the object. */
export function Interned_get<T extends Interned>(self: T): T {
  return self;
}

/// Defines trivial conversion functions between the main [`LangItem`] enum,
/// and some other lang-item enum that is a subset of it.
// PORT: `bidirectional_lang_item_map!` expands to the two fns below per invocation; the variant names are the same in
// both enums (string unions), so `$from_solver` maps a name to itself and `$to_solver` keeps the listed names.

const SOLVER_PROJECTION_LANG_ITEMS: ReadonlySet<LangItem & SolverProjectionLangItem> = new Set<LangItem & SolverProjectionLangItem>([
  // tidy-alphabetical-start
  "AsyncFnKindUpvars",
  "AsyncFnOnceOutput",
  "CallOnceFuture",
  "CallRefFuture",
  "CoroutineReturn",
  "CoroutineYield",
  "FieldBase",
  "FieldType",
  "FutureOutput",
  "Metadata",
  // tidy-alphabetical-end
]);

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:774 solver_lang_item_to_lang_item
function solver_lang_item_to_lang_item(lang_item: SolverProjectionLangItem): LangItem {
  return lang_item as LangItem;
}

// impl_interner.rs:774 lang_item_to_solver_lang_item (PORT: same macro line as the fn above; scripts/coverage.ts keys markers by line, so the line's one marker covers both)
function lang_item_to_solver_lang_item(lang_item: LangItem): SolverProjectionLangItem | undefined {
  return SOLVER_PROJECTION_LANG_ITEMS.has(lang_item as LangItem & SolverProjectionLangItem) ? (lang_item as SolverProjectionLangItem) : undefined;
}

const SOLVER_ADT_LANG_ITEMS: ReadonlySet<LangItem & SolverAdtLangItem> = new Set<LangItem & SolverAdtLangItem>([
  // tidy-alphabetical-start
  "DynMetadata",
  "Option",
  "OwnedBox",
  "Poll",
  // tidy-alphabetical-end
]);

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:791 solver_adt_lang_item_to_lang_item
function solver_adt_lang_item_to_lang_item(lang_item: SolverAdtLangItem): LangItem {
  return lang_item as LangItem;
}

// impl_interner.rs:791 lang_item_to_solver_adt_lang_item (PORT: same macro line as the fn above; scripts/coverage.ts keys markers by line, so the line's one marker covers both)
function lang_item_to_solver_adt_lang_item(lang_item: LangItem): SolverAdtLangItem | undefined {
  return SOLVER_ADT_LANG_ITEMS.has(lang_item as LangItem & SolverAdtLangItem) ? (lang_item as SolverAdtLangItem) : undefined;
}

const SOLVER_TRAIT_LANG_ITEMS: ReadonlySet<LangItem & SolverTraitLangItem> = new Set<LangItem & SolverTraitLangItem>([
  // tidy-alphabetical-start
  "AsyncFn",
  "AsyncFnKindHelper",
  "AsyncFnMut",
  "AsyncFnOnce",
  "AsyncIterator",
  "BikeshedGuaranteedNoDrop",
  "Clone",
  "Copy",
  "Coroutine",
  "Destruct",
  "DiscriminantKind",
  "Drop",
  "Field",
  "Fn",
  "FnMut",
  "FnOnce",
  "FnPtrTrait",
  "FusedIterator",
  "Future",
  "Iterator",
  "MetaSized",
  "PointeeSized",
  "PointeeTrait",
  "Sized",
  "TransmuteTrait",
  "TrivialClone",
  "TryAsDyn",
  "Tuple",
  "Unpin",
  "Unsize",
  // tidy-alphabetical-end
]);

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:802 solver_trait_lang_item_to_lang_item
function solver_trait_lang_item_to_lang_item(lang_item: SolverTraitLangItem): LangItem {
  return lang_item as LangItem;
}

// impl_interner.rs:802 lang_item_to_solver_trait_lang_item (PORT: same macro line as the fn above; scripts/coverage.ts keys markers by line, so the line's one marker covers both)
function lang_item_to_solver_trait_lang_item(lang_item: LangItem): SolverTraitLangItem | undefined {
  return SOLVER_TRAIT_LANG_ITEMS.has(lang_item as LangItem & SolverTraitLangItem) ? (lang_item as SolverTraitLangItem) : undefined;
}

/** For tests: the three `bidirectional_lang_item_map!` lists. */
export const SOLVER_LANG_ITEM_MAPS = {
  projection: SOLVER_PROJECTION_LANG_ITEMS,
  adt: SOLVER_ADT_LANG_ITEMS,
  trait_: SOLVER_TRAIT_LANG_ITEMS,
  lang_item_to_solver_lang_item,
  solver_lang_item_to_lang_item,
  lang_item_to_solver_adt_lang_item,
  solver_adt_lang_item_to_lang_item,
  lang_item_to_solver_trait_lang_item,
  solver_trait_lang_item_to_lang_item,
};

// ---- merge-w15b: lazy loads (this is an extension module: its top-level code must not touch other modules) ----
function tyir_binder(): typeof import("../../../rustc_type_ir/binder.ts") {
  return require("../../../rustc_type_ir/binder.ts") as typeof import("../../../rustc_type_ir/binder.ts");
}
function tyir_unnormalized(): typeof import("../../../rustc_type_ir/unnormalized.ts") {
  return require("../../../rustc_type_ir/unnormalized.ts") as typeof import("../../../rustc_type_ir/unnormalized.ts");
}
function middle_assoc(): typeof import("../assoc.ts") {
  return require("../assoc.ts") as typeof import("../assoc.ts");
}
function middle_generics(): typeof import("../generics.ts") {
  return require("../generics.ts") as typeof import("../generics.ts");
}
/** PORT: `Iterator::map` over an `IntoIterator` (lazy, like upstream's adapter). */
function* map_iter<T, U>(it: Iterable<T>, f: (t: T) => U): Generator<U> {
  for (const t of it) yield f(t);
}
