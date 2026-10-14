// Contract + partial port of compiler/rustc_type_ir/src/interner.rs (lane ty-contract, docs/plan-m3.md D3).
//
// PORT (D3): `trait Interner` becomes the TS interface `Interner`, implemented by rustc_middle's `TyCtxt`
// (`impl Interner for TyCtxt`, rustc_middle ty/context/impl_interner.ts). `I: Interner` is erased everywhere:
// code generic over `I` is written against the concrete rustc_middle types and receives `cx: Interner` (or
// `TyCtxt`). So the associated types are fixed:
//   `I::Ty` = `Ty`, `I::Tys` = `List<Ty>`, `I::Region`/`InternedRegionKind` = `Region`, `Const`/
//   `InternedConstKind` = `Const`, `I::GenericArg` = `GenericArg`, `I::GenericArgs` = `GenericArgs`,
//   `I::GenericArgsSlice` = `readonly GenericArg[]`, `I::Term` = `Term`, `I::Predicate` = `Predicate`,
//   `I::Clause` = `Clause`, `I::Clauses` = `Clauses`, `I::BoundVarKinds` = `List<BoundVariableKind>`,
//   `I::DefId` and every `I::*Id` = `DefId` (`LocalOpaqueTyId` = `LocalDefId`), `I::LocalDefId` = `LocalDefId`,
//   `I::Span` = `Span`, `I::Symbol` = `Symbol`, `I::ErrorGuaranteed` = `ErrorGuaranteed`, `I::AdtDef` = `AdtDef`,
//   `I::GenericsOf` = `Generics`, `I::VariancesOf` = `readonly Variance[]`, `I::Features` = `Features`,
//   `I::DepNodeIndex` = `DepNodeIndex`, `I::Tracked<T>` = `Tracked<T>`, `I::LocalDefIds` = `List<LocalDefId>`,
//   `I::CanonicalVarKinds` = `List<CanonicalVarKind>`, `I::PredefinedOpaques` = `List<[OpaqueTypeKey, Ty]>`,
//   `I::Pat` = `Pattern`, `I::PatList` = `List<Pattern>`, `I::Consts` = `List<Const>`, `I::ValTree` = `ValTree`,
//   `I::ParamTy` = `ParamTy`, `I::ParamConst` = `ParamConst`, `I::ValueConst` = `ty::Value`, `I::ExprConst` =
//   `ty::Expr`, `I::ScalarInt` = `ScalarInt`, `I::EarlyParamRegion`, `I::LateParamRegionKind`, `I::ParamEnv`,
//   `I::ExternalConstraints`, `I::CanonicalInput`, `I::Probe` = `&inspect::Probe`, `I::UnsizingParams` =
//   `DenseBitSet`, `I::RegionAssumptions` = `List<ArgOutlivesClause>`, `I::BoundExistentialPredicates` =
//   `List<PolyExistentialPredicate>`, `I::Safety` = hir `Safety`, `I::AllocId` = `AllocId`.
// The `IrPrint<..>` supertraits are rustc_middle ty/print's (lane ty-print).
// PORT: an `Interner` method whose name `TyCtxt` already uses for an *incompatible* inherent method or query is
// `ir_<name>` here and in impl_interner.ts (`is_direct_const`, `const_of_item`, `recursion_limit`, `clauses_of`,
// `const_conditions`, `explicit_implied_const_bounds`, `for_each_relevant_impl`,
// `evaluate_root_goal_for_proof_tree_raw`); for compatible collisions the inherent method / query serves.
// PORT: generic methods over `T: TypeFoldable` take the D4 descriptor last; `R: VisitorResult` takes the
// `VisitorResult` impl object; `T: CollectAndApply<..>` is an overload pair (see `CollectAndApply` below).
// `declare_lift_into!` / `LiftInto` (Lift, PORTING §3) and `impl search_graph::Cx for I` (lane tyir-solve) are
// not here.
import type { VisitorResult } from "../rustc_ast_ir/visit.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { DepNodeIndex } from "../rustc_middle/dep_graph/graph.ts";
import type { AdtDef, CanonicalInput, ExternalConstraints, Tracked } from "../rustc_middle/ty/decls.ts";
import type { Clause, GenericArg, GenericArgs, List, Ty } from "../rustc_middle/ty/decls.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { Movability } from "../rustc_ast_ir/lib.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type {
  AliasConstKind,
  AliasTermKind,
  AnonConstKind,
  Binder,
  BoundRegion,
  BoundVar,
  CanonicalInputData,
  CanonicalParamEnvCache,
  CanonicalVarKind,
  ConstKind,
  CoroutineWitnessTypes,
  DebruijnIndex,
  EarlyBinder,
  ExternalConstraintsData,
  FnSig,
  GlobalCache,
  ImplPolarity,
  OpaqueTypeKey,
  Probe,
  QueryResult,
  RegionKind,
  RegionVid,
  RequiredDepth,
  SolverAdtLangItem,
  SolverProjectionLangItem,
  SolverTraitLangItem,
  TraitRef,
  Variance,
} from "./decls.ts";
import type { TypeFoldable } from "./fold.ts";
import type { Const, Region } from "./sty/mod.ts";

/// The central trait in the shared abstraction layer, specifying all implementation-specific
/// details for rustc and rust-analyzer.
///
/// Among its essential responsibilities:
/// - it specifies the concrete types used by each implementation via its associated types; these
///   form the backbone of how each compiler frontend instantiates the shared IR.
/// - it provides the context required by the solver (e.g., querying lang items, enumerating all
///   blanket impls for a trait)
/// - it implements [IrPrint] for formatting and tracing.
///
/// In rustc, it is [implemented by TyCtxt][interner-impl-doc]. In rust-analyzer, the implementing
/// type is named [DbInterner][dbinterner-code] (as it performs most interning through the salsa
/// database).
///
/// More information can also be found in the dedicated chapter in the dev-guide, in [this
/// section][dev-guide].
// rustc-trait: compiler/rustc_type_ir/src/interner.rs:49 Interner
export interface Interner {
  // (provided) interner.rs:66 next_trait_solver_globally -> Interner_provided.next_trait_solver_globally
  next_trait_solver_globally(): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:127 mk_predefined_opaques_in_body
  mk_predefined_opaques_in_body(data: readonly ([OpaqueTypeKey, Ty])[]): List<[OpaqueTypeKey, Ty]>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:146 mk_canonical_var_kinds
  mk_canonical_var_kinds(kinds: readonly CanonicalVarKind[]): List<CanonicalVarKind>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:157 mk_external_constraints
  mk_external_constraints(data: ExternalConstraintsData): ExternalConstraints;
  // rustc: compiler/rustc_type_ir/src/interner.rs:164 mk_tracked
  mk_tracked<T>(data: T, dep_node: DepNodeIndex): Tracked<T>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:169 get_tracked
  get_tracked<T>(tracked: Tracked<T>): T;
  // rustc: compiler/rustc_type_ir/src/interner.rs:170 with_cached_task
  with_cached_task<T>(task: () => T): [T, DepNodeIndex];
  // rustc: compiler/rustc_type_ir/src/interner.rs:259 with_global_cache
  with_global_cache<R>(f: (cache: GlobalCache) => R): R;
  // rustc: compiler/rustc_type_ir/src/interner.rs:261 with_canonical_param_env_cache
  with_canonical_param_env_cache<R>(f: (cache: CanonicalParamEnvCache) => R): R;
  // rustc: compiler/rustc_type_ir/src/interner.rs:268 assert_evaluation_is_concurrent
  assert_evaluation_is_concurrent(): void;
  // rustc: compiler/rustc_type_ir/src/interner.rs:270 expand_abstract_consts
  expand_abstract_consts<T>(t: T, d_T: TypeFoldable<T>): T;
  // rustc: compiler/rustc_type_ir/src/interner.rs:273 generics_of
  generics_of(def_id: DefId): Generics;
  // rustc: compiler/rustc_type_ir/src/interner.rs:276 variances_of
  variances_of(def_id: DefId): readonly Variance[];
  // rustc: compiler/rustc_type_ir/src/interner.rs:278 opt_alias_variances
  opt_alias_variances(kind: AliasTermKind): readonly Variance[] | undefined;
  // rustc: compiler/rustc_type_ir/src/interner.rs:283 type_of
  type_of(def_id: DefId): EarlyBinder<Ty>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:284 type_of_opaque_hir_typeck
  type_of_opaque_hir_typeck(def_id: LocalDefId): EarlyBinder<Ty>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:288 is_direct_const
  // PORT: renamed `ir_is_direct_const`: TyCtxt has an incompatible inherent method / query of this name
  ir_is_direct_const(alias: AliasConstKind): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:289 const_of_item
  // PORT: renamed `ir_const_of_item`: TyCtxt has an incompatible inherent method / query of this name
  ir_const_of_item(alias: AliasConstKind): EarlyBinder<Const> | undefined;
  // rustc: compiler/rustc_type_ir/src/interner.rs:293 anon_const_kind
  anon_const_kind(def_id: DefId): AnonConstKind;
  // rustc: compiler/rustc_type_ir/src/interner.rs:295 def_span
  def_span(def_id: DefId): Span;
  // rustc: compiler/rustc_type_ir/src/interner.rs:298 adt_def
  adt_def(adt_def_id: DefId): AdtDef;
  // rustc: compiler/rustc_type_ir/src/interner.rs:300 trait_ref_and_own_args_for_alias
  trait_ref_and_own_args_for_alias(def_id: DefId, args: GenericArgs): [TraitRef, readonly GenericArg[]];
  // rustc: compiler/rustc_type_ir/src/interner.rs:306 mk_args
  mk_args(args: readonly GenericArg[]): GenericArgs;
  // rustc: compiler/rustc_type_ir/src/interner.rs:308 mk_args_from_iter
  mk_args_from_iter(args: Iterable<GenericArg>): GenericArgs;
  mk_args_from_iter<E>(args: Iterable<Result<GenericArg, E>>, c: CollectAndApply_Result): Result<GenericArgs, E>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:313 check_alias_term_args_compatible
  check_alias_term_args_compatible(term_kind: AliasTermKind, args: GenericArgs): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:319 debug_assert_args_compatible
  debug_assert_args_compatible(def_id: DefId, args: GenericArgs): void;
  // rustc: compiler/rustc_type_ir/src/interner.rs:320 debug_assert_alias_term_args_compatible
  debug_assert_alias_term_args_compatible(term_kind: AliasTermKind, args: GenericArgs): void;
  // rustc: compiler/rustc_type_ir/src/interner.rs:328 debug_assert_existential_args_compatible
  debug_assert_existential_args_compatible(def_id: DefId, args: GenericArgs): void;
  // rustc: compiler/rustc_type_ir/src/interner.rs:330 mk_type_list_from_iter
  mk_type_list_from_iter(args: Iterable<Ty>): List<Ty>;
  mk_type_list_from_iter<E>(args: Iterable<Result<Ty, E>>, c: CollectAndApply_Result): Result<List<Ty>, E>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:335 mk_ct_from_kind
  mk_ct_from_kind(kind: ConstKind): Const;
  // rustc: compiler/rustc_type_ir/src/interner.rs:337 projection_parent
  projection_parent(def_id: DefId): DefId;
  // rustc: compiler/rustc_type_ir/src/interner.rs:340 impl_or_trait_assoc_term_parent
  impl_or_trait_assoc_term_parent(def_id: DefId): DefId;
  // rustc: compiler/rustc_type_ir/src/interner.rs:342 inherent_alias_term_parent
  inherent_alias_term_parent(def_id: DefId): DefId;
  // rustc: compiler/rustc_type_ir/src/interner.rs:344 recursion_limit
  // PORT: renamed `ir_recursion_limit`: TyCtxt has an incompatible inherent method / query of this name
  ir_recursion_limit(): number;
  // rustc: compiler/rustc_type_ir/src/interner.rs:347 features
  features(): Features;
  // rustc: compiler/rustc_type_ir/src/interner.rs:349 assumptions_on_binders
  assumptions_on_binders(): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:351 renormalize_rigid_aliases
  renormalize_rigid_aliases(): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:353 coroutine_hidden_types
  coroutine_hidden_types(def_id: DefId): EarlyBinder<Binder<CoroutineWitnessTypes>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:358 fn_sig
  fn_sig(def_id: DefId): EarlyBinder<Binder<FnSig>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:363 coroutine_movability
  coroutine_movability(def_id: DefId): Movability;
  // rustc: compiler/rustc_type_ir/src/interner.rs:365 coroutine_for_closure
  coroutine_for_closure(def_id: DefId): DefId;
  // rustc: compiler/rustc_type_ir/src/interner.rs:367 generics_require_sized_self
  generics_require_sized_self(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:369 item_bounds
  item_bounds(def_id: DefId): EarlyBinder<Iterable<Clause>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:374 item_self_bounds
  item_self_bounds(def_id: DefId): EarlyBinder<Iterable<Clause>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:379 item_non_self_bounds
  item_non_self_bounds(def_id: DefId): EarlyBinder<Iterable<Clause>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:384 clauses_of
  // PORT: renamed `ir_clauses_of`: TyCtxt has an incompatible inherent method / query of this name
  ir_clauses_of(def_id: DefId): EarlyBinder<Iterable<Clause>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:389 own_clauses_of
  own_clauses_of(def_id: DefId): EarlyBinder<Iterable<Clause>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:394 explicit_super_clauses_of
  explicit_super_clauses_of(def_id: DefId): EarlyBinder<Iterable<[Clause, Span]>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:399 explicit_implied_clauses_of
  explicit_implied_clauses_of(def_id: DefId): EarlyBinder<Iterable<[Clause, Span]>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:406 impl_super_outlives
  impl_super_outlives(impl_def_id: DefId): EarlyBinder<Iterable<Clause>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:411 supertrait_def_ids
  supertrait_def_ids(trait_def_id: DefId): Iterable<DefId>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:414 impl_is_const
  impl_is_const(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:415 fn_is_const
  fn_is_const(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:416 closure_is_const
  closure_is_const(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:417 alias_has_const_conditions
  alias_has_const_conditions(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:418 const_conditions
  // PORT: renamed `ir_const_conditions`: TyCtxt has an incompatible inherent method / query of this name
  ir_const_conditions(def_id: DefId): EarlyBinder<Iterable<Binder<TraitRef>>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:422 explicit_implied_const_bounds
  // PORT: renamed `ir_explicit_implied_const_bounds`: TyCtxt has an incompatible inherent method / query of this name
  ir_explicit_implied_const_bounds(def_id: DefId): EarlyBinder<Iterable<Binder<TraitRef>>>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:427 impl_self_is_guaranteed_unsized
  impl_self_is_guaranteed_unsized(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:429 has_target_features
  has_target_features(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:431 require_projection_lang_item
  require_projection_lang_item(lang_item: SolverProjectionLangItem): DefId;
  // rustc: compiler/rustc_type_ir/src/interner.rs:436 require_trait_lang_item
  require_trait_lang_item(lang_item: SolverTraitLangItem): DefId;
  // rustc: compiler/rustc_type_ir/src/interner.rs:438 require_adt_lang_item
  require_adt_lang_item(lang_item: SolverAdtLangItem): DefId;
  // rustc: compiler/rustc_type_ir/src/interner.rs:440 is_projection_lang_item
  is_projection_lang_item(def_id: DefId, lang_item: SolverProjectionLangItem): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:446 is_trait_lang_item
  is_trait_lang_item(def_id: DefId, lang_item: SolverTraitLangItem): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:448 is_adt_lang_item
  is_adt_lang_item(def_id: DefId, lang_item: SolverAdtLangItem): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:450 is_default_trait
  is_default_trait(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:452 is_sizedness_trait
  is_sizedness_trait(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:454 as_projection_lang_item
  as_projection_lang_item(def_id: DefId): SolverProjectionLangItem | undefined;
  // rustc: compiler/rustc_type_ir/src/interner.rs:459 as_trait_lang_item
  as_trait_lang_item(def_id: DefId): SolverTraitLangItem | undefined;
  // rustc: compiler/rustc_type_ir/src/interner.rs:461 as_adt_lang_item
  as_adt_lang_item(def_id: DefId): SolverAdtLangItem | undefined;
  // rustc: compiler/rustc_type_ir/src/interner.rs:463 associated_type_def_ids
  associated_type_def_ids(def_id: DefId): Iterable<DefId>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:468 for_each_relevant_impl
  // PORT: renamed `ir_for_each_relevant_impl`: TyCtxt has an incompatible inherent method / query of this name
  ir_for_each_relevant_impl<R>(trait_ref: TraitRef, f: (impl_def_id: DefId) => R, r: VisitorResult<R, unknown>): R;
  // rustc: compiler/rustc_type_ir/src/interner.rs:473 for_each_blanket_impl
  for_each_blanket_impl<R>(trait_def_id: DefId, f: (impl_def_id: DefId) => R, r: VisitorResult<R, unknown>): R;
  // rustc: compiler/rustc_type_ir/src/interner.rs:479 has_item_definition
  has_item_definition(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:481 impl_specializes
  impl_specializes(impl_def_id: DefId, victim_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:483 impl_is_default
  impl_is_default(impl_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:485 impl_trait_ref
  impl_trait_ref(impl_def_id: DefId): EarlyBinder<TraitRef>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:488 impl_polarity
  impl_polarity(impl_def_id: DefId): ImplPolarity;
  // rustc: compiler/rustc_type_ir/src/interner.rs:490 is_fully_generic_for_reflection
  is_fully_generic_for_reflection(impl_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:492 trait_is_auto
  trait_is_auto(trait_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:494 trait_is_marker
  trait_is_marker(trait_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:496 trait_is_coinductive
  trait_is_coinductive(trait_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:498 trait_is_alias
  trait_is_alias(trait_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:500 trait_is_dyn_compatible
  trait_is_dyn_compatible(trait_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:502 trait_is_fundamental
  trait_is_fundamental(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:505 trait_is_unsafe
  trait_is_unsafe(trait_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:507 is_impl_trait_in_trait
  is_impl_trait_in_trait(def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:509 delay_bug
  delay_bug(msg: string): ErrorGuaranteed;
  // rustc: compiler/rustc_type_ir/src/interner.rs:510 span_delayed_bug
  span_delayed_bug(span: Span, msg: string): ErrorGuaranteed;
  // rustc: compiler/rustc_type_ir/src/interner.rs:512 is_general_coroutine
  is_general_coroutine(coroutine_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:513 coroutine_is_async
  coroutine_is_async(coroutine_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:514 coroutine_is_gen
  coroutine_is_gen(coroutine_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:515 coroutine_is_async_gen
  coroutine_is_async_gen(coroutine_def_id: DefId): boolean;
  // rustc: compiler/rustc_type_ir/src/interner.rs:518 unsizing_params_for_adt
  unsizing_params_for_adt(adt_def_id: DefId): DenseBitSet<number>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:520 anonymize_bound_vars
  anonymize_bound_vars<T>(binder: Binder<T>, d_T: TypeFoldable<T>): Binder<T>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:525 opaque_types_defined_by
  opaque_types_defined_by(defining_anchor: LocalDefId): List<LocalDefId>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:527 opaque_types_and_coroutines_defined_by
  opaque_types_and_coroutines_defined_by(defining_anchor: LocalDefId): List<LocalDefId>;
  // rustc: compiler/rustc_type_ir/src/interner.rs:533 mk_probe
  mk_probe(probe: Probe): Probe;
  // rustc: compiler/rustc_type_ir/src/interner.rs:534 evaluate_root_goal_for_proof_tree_raw
  // PORT: renamed `ir_evaluate_root_goal_for_proof_tree_raw`: TyCtxt has an incompatible inherent method / query of this name
  ir_evaluate_root_goal_for_proof_tree_raw(canonical_goal: CanonicalInput, root_depth: number): [QueryResult, Probe, RequiredDepth];
  // rustc: compiler/rustc_type_ir/src/interner.rs:540 item_name
  item_name(item_index: DefId): Symbol;
  // rustc: compiler/rustc_type_ir/src/interner.rs:542 get_anon_re_bounds_lifetime
  get_anon_re_bounds_lifetime(idx: number, var_idx: number): Region | undefined;
  // rustc: compiler/rustc_type_ir/src/interner.rs:544 get_anon_re_canonical_bounds_lifetime
  get_anon_re_canonical_bounds_lifetime(idx: number): Region | undefined;
  // rustc: compiler/rustc_type_ir/src/interner.rs:546 get_re_static_lifetime
  get_re_static_lifetime(): Region;
  // rustc: compiler/rustc_type_ir/src/interner.rs:548 intern_re_var
  intern_re_var(rv: RegionVid): Region;
  // rustc: compiler/rustc_type_ir/src/interner.rs:550 intern_region
  intern_region(region_kind: RegionKind): Region;
  // rustc: compiler/rustc_type_ir/src/interner.rs:552 intern_bound_region
  intern_bound_region(debruijn: DebruijnIndex, bound_region: BoundRegion): Region;
  // rustc: compiler/rustc_type_ir/src/interner.rs:558 intern_canonical_bound
  intern_canonical_bound(var_: BoundVar): Region;
  // rustc: compiler/rustc_type_ir/src/interner.rs:561 mk_canonical_input
  mk_canonical_input(data: CanonicalInputData): CanonicalInput;
}

/** PORT: the provided methods of `Interner` (PORTING §8). */
export const Interner_provided = {
  // rustc: compiler/rustc_type_ir/src/interner.rs:66 next_trait_solver_globally
  next_trait_solver_globally(_self: Interner): boolean {
    return true;
  },
};

/// Imagine you have a function `F: FnOnce(&[T]) -> R`, plus an iterator `iter`
/// that produces `T` items. You could combine them with
/// `f(&iter.collect::<Vec<_>>())`, but this requires allocating memory for the
/// `Vec`.
///
/// This trait allows for faster implementations, intended for cases where the
/// number of items produced by the iterator is small. There is a blanket impl
/// for `T` items, but there is also a fallible impl for `Result<T, E>` items.
// PORT: the trait is dispatched on the *item* type, which TS cannot see; the two impls are two descriptor
// objects. A `mk_*_from_iter` method takes the blanket impl by default and the fallible impl when its caller
// passes `CollectAndApply_Result` as the extra argument (an overload pair in the declarations).
// rustc-trait: compiler/rustc_type_ir/src/interner.rs:620 CollectAndApply
export interface CollectAndApply<Item, T, R, Output> {
  /// Produce a result of type `Self::Output` from `iter`. The result will
  /// typically be produced by applying `f` on the elements produced by
  /// `iter`, though this may not happen in some impls, e.g. if an error
  /// occurred during iteration.
  // rustc: compiler/rustc_type_ir/src/interner.rs:627 collect_and_apply
  collect_and_apply(iter: Iterable<Item>, f: (xs: readonly T[]) => R): Output;
}

/// The blanket impl that always collects all elements and applies `f`.
export const CollectAndApply_T = {
  /// Equivalent to `f(&iter.collect::<Vec<_>>())`.
  // PORT: upstream specialises lengths 0..=8 on the stack to avoid a `Vec`; the result is the same slice.
  // rustc: compiler/rustc_type_ir/src/interner.rs:638 collect_and_apply
  collect_and_apply<T, R>(iter: Iterable<T>, f: (xs: readonly T[]) => R): R {
    // This code is hot enough that it's worth specializing for the most
    // common length lists, to avoid the overhead of `Vec` creation.
    return f(Array.from(iter));
  },
};

/// A fallible impl that will fail, without calling `f`, if there are any
/// errors during collection.
export const CollectAndApply_Result = {
  /// Equivalent to `Ok(f(&iter.collect::<Result<Vec<_>>>()?))`.
  // PORT: upstream specialises lengths 0..=8 on the stack; the iteration order and the stop at the first `Err`
  // are the same.
  // rustc: compiler/rustc_type_ir/src/interner.rs:692 collect_and_apply
  collect_and_apply<T, R, E>(iter: Iterable<Result<T, E>>, f: (xs: readonly T[]) => R): Result<R, E> {
    // This code is hot enough that it's worth specializing for the most
    // common length lists, to avoid the overhead of `Vec` creation.
    const xs: T[] = [];
    for (const x of iter) {
      if (x.$ === "Err") return Err(x._0);
      xs.push(x._0);
    }
    return Ok(f(xs));
  },
};
export type CollectAndApply_Result = typeof CollectAndApply_Result;
