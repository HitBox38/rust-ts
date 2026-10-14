// The rustc_infer contract (lane infcx-contract, wave 16): `InferCtxt`, whose `impl` blocks are spread over 20 upstream
// files (and rustc_trait_selection's extension traits, ../rustc_trait_selection/decls.ts), the other contract classes
// (`InferCtxtInner`, `InferCtxtBuilder`, `At`), and one declaration of every fn of the crate. Grouped by upstream file in
// upstream order; each declaration carries `// <file>:<line>` (the line of its `fn` keyword at the pin, paths relative to
// compiler/rustc_infer/src/). Method bodies are assigned onto the prototype by the file that ports them (PORTING §5
// "Methods defined in another file").
//
// Contents:
// - `class InferCtxtInner` (infer/mod.rs:98) + its methods (mod.rs, snapshot/undo_log.rs).
// - `class InferCtxt` (infer/mod.rs:250) + every `impl InferCtxt` method of the crate, file by file, and the
//   `impl InferCtxtLike for InferCtxt` (context.rs). `InferCtxt implements InferCtxtLike` is checked by tsc here.
// - `class InferCtxtBuilder` (mod.rs:589) + its methods; `TyCtxtInferExt::infer_ctxt` on `TyCtxt` (mod.rs:609).
// - `class At` (at.rs:50) + its methods.
// - Module augmentations: the methods of the generated classes that more than one wave-16 lane uses (`TypeTrace`,
//   `InferOk`, `RegionConstraintCollector`, `OpaqueTypeStorage`, `ProjectionCache`, `OutlivesEnvironment`, ...).
// - `interface Companions`: methods of generated enums (companion consts, PORTING §8) and statics that more than one
//   lane uses; `interface FreeFns`: the pub free fns. contract.test.ts checks both against the stub modules.
// - Comment-only declarations of the remaining fns (file-local helper types, trait impls of folders/relations,
//   private free fns): informative; the owning lane decides their exact form (`declare module` in its own file).
//
// Contract rules (docs/handoff/infcx-contract.md "How to fill a stub"):
// - Ownership: lane infcx-contract wrote this file; afterwards root owns it. A lane that needs a missing or changed
//   declaration writes it in its handoff (signature + reason); if it cannot type-check without it, it adds a local
//   `declare module "<path>/decls.ts"` augmentation in its own file marked `// PORT(decls): pending root`.
// - Signatures (PORTING §5): `&self`/`&mut self`/`self` -> `this`; `&T`/`&mut T`/`Box` -> `T`; `&[T]` -> `readonly T[]`;
//   `Vec`/`ThinVec`/`SmallVec` -> `T[]`; `Option<T>` -> `T | undefined`; `()` -> `void` as a return, `null` as a type
//   argument (`InferResult<null>`, `RelateResult<null>`, as rustc_type_ir); tuples -> arrays; `impl Iterator<Item = T>`
//   -> `Iterable<T>`; closures `impl FnOnce(A) -> R` -> `(_1: A) => R`; `impl Into<DefId>` -> `DefId` (callers
//   convert). A destructuring parameter (`ty::OutlivesClause(arg, r2): ArgOutlivesClause`) is `_0`.
// - Generics (D4): `T: TypeFoldable<TyCtxt>` adds a descriptor parameter `d_T: TypeFoldable<T>` last; `T: ToTrace`
//   adds `d_T: ToTrace<T>` (at.ts); `T: Relate` adds `d_T: Relate<T>`; `R: PredicateEmittingRelation<InferCtxt>` is the
//   interface `PredicateEmittingRelation`; `dyn TraitEngine<E>` is the interface `TraitEngine<E>` (traits/engine.ts);
//   `impl Upcast<TyCtxt, O>` is a value `P` plus `upcast_from_O: (from: P, tcx: Interner) => O` (rustc_type_ir upcast.ts).
// - Field renames (a method of the same name exists): `InferCtxt.{tainted_by_errors_, universe_, next_trait_solver_,
//   enable_next_solver_overflow_fcw_}`, `InferCtxtInner.{projection_cache_, region_obligations_, region_assumptions_}`,
//   `InferCtxtBuilder.{in_hir_typeck_, skip_leak_check_, enable_next_solver_overflow_fcw_}`.
// - `InferCtxtLike` (rustc_type_ir infer_ctxt.ts): a trait method with the same signature as the inherent method of the
//   same name is served by the inherent method (comment line under its context.rs line). The 8 whose signature differs
//   are `ir_<name>` on both sides (`ir_sub_regions`, `ir_equate_regions`, `ir_fresh_args_for_item`,
//   `ir_universe_of_region`, `ir_get_solver_region_constraint`, `ir_overwrite_solver_region_constraint`,
//   `ir_register_solver_region_constraint`, `ir_register_hidden_type_in_storage`), as `Interner`'s `ir_` methods on
//   `TyCtxt` (ty-contract decision 5).
// - `Drop for InferCtxt` is the method `drop()`: nothing calls it implicitly (PORT; see the handoff).
// - Associated fns without `self` of the contract classes are `declare static` members (`InferCtxtInner.new`), assigned
//   by the owning file.
//
// Init order (a TDZ ReferenceError at load otherwise): this module imports only types. It must never import a
// rustc_infer module at runtime. lib.ts (the crate root) imports this file first, then every module.

import type { DiagCtxtHandle } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { CanonicalParamEnvCache, OriginalQueryValues, QueryRegionConstraints, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import type { DerivedCause, EvaluationCache, EvaluationResult, ImplSource, ObligationCauseCode, SelectionCache } from "../rustc_middle/traits/mod.ts";
import type { OutlivesBound } from "../rustc_middle/traits/query.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type {
  Clause,
  Clauses,
  Const,
  GenericArg,
  GenericArgs,
  ObligationCause,
  ParamEnv,
  Predicate,
  PseudoCanonicalInput,
  Region,
  Term,
  TransitiveRelation,
  Ty,
  TypingEnv,
} from "../rustc_middle/ty/decls.ts";
import type { GenericParamDef } from "../rustc_middle/ty/generics.ts";
import type { ParamEnvAnd, ProvisionalHiddenType } from "../rustc_middle/ty/mod.ts";
import type { PolyCoercePredicate, PolySubtypePredicate } from "../rustc_middle/ty/predicate.ts";
import type { LocalDefId, DefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { Ident } from "../rustc_span/symbol.ts";
import type { Canonical, CanonicalQueryInput, CanonicalVarKind, CanonicalVarValues, CanonicalizerState } from "../rustc_type_ir/canonical.ts";
import type {
  ArgOutlivesClause,
  Binder,
  BoundVar,
  ClosureKind,
  ConstVid,
  FloatVid,
  InferConst,
  InferTy,
  IntVid,
  OpaqueTypeKey,
  PolyTraitClause,
  PolyTraitRef,
  PolyTypeOutlivesClause,
  RegionOutlivesClause,
  RegionVid,
  RelateResult,
  TraitRef,
  TyVid,
  TypeOutlivesClause,
  UniverseIndex,
  Variance,
} from "../rustc_type_ir/decls.ts";
import type { TypeError } from "../rustc_type_ir/error.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike, RangeInclusive, TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import type { ClausePolarity, RegionEqPredicate } from "../rustc_type_ir/predicate.ts";
import type { Assumptions, RegionConstraint } from "../rustc_type_ir/region_constraint.ts";
import type { Relate } from "../rustc_type_ir/relate.ts";
import type { PredicateEmittingRelation } from "../rustc_type_ir/relate/combine.ts";
import type { Goal, NoSolution, TyOrConstInferVar, VisibleForLeakCheck } from "../rustc_type_ir/solve/mod.ts";
import type { AliasTerm, OpaqueAliasTy } from "../rustc_type_ir/ty/alias.ts";
import type { FloatVarValue, IntVarValue } from "../rustc_type_ir/ty_kind.ts";
import type { Result } from "../std/result.ts";
import type { Range } from "../vendor/ena/unify/mod.ts";
import type { DefineOpaqueTypes, ToTrace } from "./infer/at.ts";
import type { TypeVariableOrigin, FloatVariableOrigin, TypeVariableStorage, TypeVariableTable, TypeVariableValue } from "./infer/type_variable.ts";
import type { ConstVariableOrigin, ConstVariableValue, ConstVidKey, RegionVariableValue, RegionVidKey } from "./infer/unify_key.ts";
import type { FreeRegionMap, RegionRelations } from "./infer/free_regions.ts";
import type { LexicalRegionResolutions, RegionResolutionError, VarValue as LexicalVarValue } from "./infer/lexical_region_resolve/mod.ts";
import type {
  BoundRegionConversionTime,
  FixupError,
  FixupResult,
  InferOk,
  InferResult,
  NllRegionVariableOrigin,
  RegionVariableOrigin,
  SubregionOrigin,
  TypeOutlivesConstraint,
  TypeTrace,
  UnificationTable,
  ValuePairs,
} from "./infer/mod.ts";
import type { OpaqueTypeStorage, OpaqueTypeStorageEntries, OpaqueTypeTable } from "./infer/opaque_types/table.ts";
import type { OutlivesEnvironment, RegionBoundPairs } from "./infer/outlives/env.ts";
import type { TypeOutlivesDelegate } from "./infer/outlives/obligations.ts";
import type {
  CombineMap,
  CombineMapType,
  Constraint,
  GenericKind,
  RegionConstraintCollector,
  RegionConstraintData,
  RegionConstraintStorage,
  RegionSnapshot,
  VarInfos,
  Verify,
  VerifyBound,
} from "./infer/region_constraints/mod.ts";
import type { Generalization, TermVid } from "./infer/relate/generalize.ts";
import type { LatticeOp, LatticeOpKind } from "./infer/relate/lattice.ts";
import type { TypeRelating } from "./infer/relate/type_relating.ts";
import type { SnapshotVarData } from "./infer/snapshot/fudge.ts";
import type { CombinedSnapshot, VariableLengths } from "./infer/snapshot/mod.ts";
import type { InferCtxtUndoLogs, Snapshot, UndoLog } from "./infer/snapshot/undo_log.ts";
import type { SolverRegionConstraint, SolverRegionConstraintStorage } from "./infer/solver_region_constraints.ts";
import type { TypeFreshener } from "./infer/freshen.ts";
import type { ScrubbedTraitError, TraitEngine, TraitErrors } from "./traits/engine.ts";
import type { Obligation, ObligationInspector, PolyTraitObligation, PredicateObligation, PredicateObligations } from "./traits/mod.ts";
import type {
  NormalizedTerm,
  ProjectionCache,
  ProjectionCacheEntry,
  ProjectionCacheKey,
  ProjectionCacheStorage,
  UndoLog as ProjectionCacheUndoLog,
} from "./traits/project.ts";
import type { MismatchedProjectionTypes, Normalized } from "./traits/project.ts";
import type { SnapshotMap } from "../rustc_data_structures/snapshot_map/mod.ts";

// ======================================================================================================================
// InferCtxtInner (infer/mod.rs:98)
// ======================================================================================================================

/// This type contains all the things within [`InferCtxt`] that sit within a
/// [`RefCell`] and are involved with taking/rolling back snapshots. Snapshot
/// operations are hot enough that we want only one call to
/// [`RefCell::borrow_mut`] per call to [`InferCtxt::start_snapshot`] and
///  [`InferCtxt::rollback_to`].
// rustc-type: compiler/rustc_infer/src/infer/mod.rs:98 InferCtxtInner
// PORT: `InferCtxtInner::new` (mod.rs:175, infer/mod.ts) writes out the initial field values; `#[derive(Clone)]` is
// `clone_InferCtxtInner` (infer/mod.ts).
export class InferCtxtInner {
  constructor(
    public undo_log: InferCtxtUndoLogs,

    /// Cache for projections.
    ///
    /// This cache is snapshotted along with the infcx.
    // PORT: `projection_cache_` (also a method `projection_cache()`).
    public projection_cache_: ProjectionCacheStorage,

    /// Primary map of inference variables to the types that they currently
    /// represent.
    ///
    /// We instantiate [`UnificationTable`] with `bounds<Ty>` because the types
    /// that might instantiate a general type variable have an order,
    /// represented by its upper and lower bounds.
    public type_variable_storage: TypeVariableStorage,

    /// Map from const parameter variable to the kind of const it represents.
    public const_unification_storage: import("../vendor/ena/unify/mod.ts").UnificationTableStorage<ConstVidKey, ConstVariableValue, import("../vendor/ena/unify/mod.ts").NoError>,

    /// Map from integral variable to the kind of integer it represents.
    public int_unification_storage: import("../vendor/ena/unify/mod.ts").UnificationTableStorage<IntVid, IntVarValue, import("../vendor/ena/unify/mod.ts").NoError>,

    /// Map from floating variable to the kind of float it represents.
    public float_unification_storage: import("../vendor/ena/unify/mod.ts").UnificationTableStorage<FloatVid, FloatVarValue, import("../vendor/ena/unify/mod.ts").NoError>,

    /// Map from floating variable to the origin span it came from, and the HirId that should be
    /// used to lint at that location. This is only used for the FCW for the fallback to `f32`,
    /// so can be removed once the `f32` fallback is removed.
    public float_origin_origin_storage: FloatVariableOrigin[],

    /// Tracks the set of region variables and the constraints between them.
    ///
    /// This is initially `Some(_)` but when
    /// `resolve_regions_and_report_errors` is invoked, this gets set to `None`
    /// -- further attempts to perform unification, etc., may fail if new
    /// region constraints would've been added.
    public region_constraint_storage: RegionConstraintStorage | undefined,

    /// Used by the next solver when `-Zassumptions-on-binders` is set.
    public solver_region_constraint_storage: SolverRegionConstraintStorage,

    /// A set of constraints that regionck must validate.
    ///
    /// Each constraint has the form `T:'a`, meaning "some type `T` must
    /// outlive the lifetime 'a". These constraints derive from
    /// instantiated type parameters. So if you had a struct defined
    /// like the following:
    /// ```ignore (illustrative)
    /// struct Foo<T: 'static> { ... }
    /// ```
    /// In some expression `let x = Foo { ... }`, it will
    /// instantiate the type parameter `T` with a fresh type `$0`. At
    /// the same time, it will record a region obligation of
    /// `$0: 'static`. This will get checked later by regionck. (We
    /// can't generally check these things right away because we have
    /// to wait until types are resolved.)
    // PORT: `region_obligations_` (also a method `region_obligations()`).
    public region_obligations_: TypeOutlivesConstraint[],

    /// The outlives bounds that we assume must hold about placeholders that
    /// come from instantiating the binder of coroutine-witnesses. These bounds
    /// are deduced from the well-formedness of the witness's types, and are
    /// necessary because of the way we anonymize the regions in a coroutine,
    /// which may cause types to no longer be considered well-formed.
    // PORT: `region_assumptions_` (also a method `region_assumptions()`).
    public region_assumptions_: ArgOutlivesClause[],

    /// `-Znext-solver`: Successfully proven goals during HIR typeck which
    /// reference inference variables and get reproven in case MIR type check
    /// fails to prove something.
    ///
    /// See the documentation of `InferCtxt::in_hir_typeck` for more details.
    public hir_typeck_potentially_region_dependent_goals: PredicateObligation[],

    /// Caches for opaque type inference.
    public opaque_type_storage: OpaqueTypeStorage,
  ) {}

  // infer/mod.rs:175 (static, assigned in infer/mod.ts)
  declare static new: () => InferCtxtInner;
}

export interface InferCtxtInner {
  // ---- infer/mod.rs (lane infcx-contract / infer-core) ----
  // infer/mod.rs:175 (static: `declare static` in the class above)
  // new(): InferCtxtInner;
  // infer/mod.rs:195
  region_obligations(): readonly TypeOutlivesConstraint[];
  // infer/mod.rs:200
  region_assumptions(): readonly ArgOutlivesClause[];
  // infer/mod.rs:205
  projection_cache(): ProjectionCache;
  // infer/mod.rs:210
  try_type_variables_probe_ref(vid: TyVid): TypeVariableValue | undefined;
  // infer/mod.rs:217
  type_variables(): TypeVariableTable;
  // infer/mod.rs:222
  opaque_types(): OpaqueTypeTable;
  // infer/mod.rs:227
  int_unification_table(): UnificationTable<IntVid, IntVarValue>;
  // infer/mod.rs:232
  float_unification_table(): UnificationTable<FloatVid, FloatVarValue>;
  // infer/mod.rs:237
  const_unification_table(): UnificationTable<ConstVidKey, ConstVariableValue>;
  // infer/mod.rs:242
  unwrap_region_constraints(): RegionConstraintCollector;

  // ---- infer/snapshot/undo_log.rs (lane infcx-contract) ----
  // infer/snapshot/undo_log.rs:66 (`impl Rollback<UndoLog> for InferCtxtInner`)
  reverse(undo: UndoLog): void;
  // infer/snapshot/undo_log.rs:142
  rollback_to(snapshot: Snapshot): void;
  // infer/snapshot/undo_log.rs:162
  commit(snapshot: Snapshot): void;
}

// ======================================================================================================================
// InferCtxt (infer/mod.rs:250)
// ======================================================================================================================

// rustc-type: compiler/rustc_infer/src/infer/mod.rs:250 InferCtxt
// PORT: built only by `InferCtxtBuilder::build` (mod.rs:677) and `fork_with_typing_mode` (at.rs:98).
export class InferCtxt implements InferCtxtLike {
  constructor(
    public tcx: TyCtxt,

    /// The mode of this inference context, see the struct documentation
    /// for more details.
    public typing_mode: TypingMode,

    /// Whether this inference context should care about region obligations in
    /// the root universe. Most notably, this is used during HIR typeck as region
    /// solving is left to borrowck instead.
    ///
    /// This is used in the old solver to enable the generation of regions constraints.
    /// In the new solver its only used inside the InferCtxt's `Drop` implementation:
    /// if we're considering regions, and new opaques are registered, we panic.
    public considering_regions: boolean,
    /// `-Znext-solver`: Whether this inference context is used by HIR typeck. If so, we
    /// need to make sure we don't rely on region identity in the trait solver or when
    /// relating types. This is necessary as borrowck starts by replacing each occurrence of a
    /// free region with a unique inference variable. If HIR typeck ends up depending on two
    /// regions being equal we'd get unexpected mismatches between HIR typeck and MIR typeck,
    /// resulting in an ICE.
    ///
    /// The trait solver sometimes depends on regions being identical. As a concrete example
    /// the trait solver ignores other candidates if one candidate exists without any constraints.
    /// The goal `&'a u32: Equals<&'a u32>` has no constraints right now. If we replace each
    /// occurrence of `'a` with a unique region the goal now equates these regions. See
    /// the tests in trait-system-refactor-initiative#27 for concrete examples.
    ///
    /// We handle this by *uniquifying* region when canonicalizing root goals during HIR typeck.
    /// This is still insufficient as inference variables may *hide* region variables, so e.g.
    /// `dyn TwoSuper<?x, ?x>: Super<?x>` may hold but MIR typeck could end up having to prove
    /// `dyn TwoSuper<&'0 (), &'1 ()>: Super<&'2 ()>` which is now ambiguous. Because of this we
    /// stash all successfully proven goals which reference inference variables and then reprove
    /// them after writeback.
    public in_hir_typeck: boolean,

    /// If set, this flag causes us to skip the 'leak check' during
    /// higher-ranked subtyping operations. This flag is a temporary one used
    /// to manage the removal of the leak-check: for the time being, we still run the
    /// leak-check, but we issue warnings.
    public skip_leak_check: boolean,

    public inner: InferCtxtInner,

    /// Once region inference is done, the values for each variable.
    public lexical_region_resolutions: LexicalRegionResolutions | undefined,

    /// Caches the results of trait selection. This cache is used
    /// for things that depends on inference variables or placeholders.
    public selection_cache: SelectionCache<ParamEnv>,

    /// Caches the results of trait evaluation. This cache is used
    /// for things that depends on inference variables or placeholders.
    public evaluation_cache: EvaluationCache<ParamEnv>,

    /// The set of predicates on which errors have been reported, to
    /// avoid reporting the same error twice.
    // PORT: an `FxIndexMap<Span, ..>`: `Span` is an interned handle, so a JS `Map` (insertion-ordered).
    public reported_trait_errors: Map<Span, [Goal<Predicate>[], ErrorGuaranteed]>,

    /// A set of predicates *on a specific* HIR node (the originating expression and its enclosing
    /// statement), to avoid reporting multiple errors pointing at different sub-expressions in the
    /// same method chain.
    // PORT: `FxIndexMap<HirId, FxHashSet<Predicate>>`: a D5 `HirIdMap` (keyed by value, insertion-ordered).
    public reported_hir_errors: import("../rustc_hir_id/lib.ts").HirIdMap<Set<Predicate>>,

    // PORT: `FxHashSet<(Span, Option<Span>)>`: a `KeyedSet` on the pair (rust_ts/keyed.ts).
    public reported_signature_mismatch: import("../rust_ts/keyed.ts").KeyedSet<[Span, Span | undefined]>,

    /// When an error occurs, we want to avoid reporting "derived"
    /// errors that are due to this original failure. We have this
    /// flag that one can set whenever one creates a type-error that
    /// is due to an error in a prior pass.
    ///
    /// Don't read this flag directly, call `is_tainted_by_errors()`
    /// and `set_tainted_by_errors()`.
    // PORT: `tainted_by_errors_` (also a method `tainted_by_errors()`).
    public tainted_by_errors_: ErrorGuaranteed | undefined,

    /// What is the innermost universe we have created? Starts out as
    /// `UniverseIndex::root()` but grows from there as we enter
    /// universal quantifiers.
    ///
    /// N.B., at present, we exclude the universal quantifiers on the
    /// item we are type-checking, and just consider those names as
    /// part of the root universe. So this would only get incremented
    /// when we enter into a higher-ranked (`for<..>`) type or trait
    /// bound.
    // PORT: `universe_` (also a method `universe()`).
    public universe_: UniverseIndex,

    /// List of assumed wellformed types which we can derive implied
    /// bounds on a `for<...>` from. Only used unstabley and by the
    /// new solver.
    //
    // FIXME(-Zassumptions-on-binders): This and `universe` should probably be
    // in `InferCtxtInner` so they can participate in rollbacks and whatnot
    public placeholder_assumptions_for_next_solver: Map<UniverseIndex, Assumptions>,

    // PORT: `next_trait_solver_` (also a method `next_trait_solver()`).
    public next_trait_solver_: boolean,

    /// We have a `recursion_depth_exceeding_limit` FCW to mitigate breakages
    /// caused by enabling the next solver globally. But the next solver is
    /// already used by default in some places so we know they won't have
    /// additional breakages. We also don't want spurious result in coherence
    /// checking so we disable the FCW there as well.
    // PORT: `enable_next_solver_overflow_fcw_` (also a method `enable_next_solver_overflow_fcw()`).
    public enable_next_solver_overflow_fcw_: boolean,

    public obligation_inspector: ObligationInspector | undefined,

    /// State reused by each new canonicalizer, and then cleared (but not deallocated) once the
    /// canonicalizer is finished. A performance win, because it avoids reallocating new
    /// vecs/hashmaps for every canonicalizer.
    public canonicalizer_state: CanonicalizerState,
  ) {}
}

export interface InferCtxt {
  // ---- infer/mod.rs (lane infer-core) ----
  // infer/mod.rs:365 (`impl Drop for InferCtxt`)
  drop(): void;
  // infer/mod.rs:730
  dcx(): DiagCtxtHandle;
  // infer/mod.rs:734
  next_trait_solver(): boolean;
  // infer/mod.rs:759
  typing_mode_raw(): TypingMode;
  // infer/mod.rs:764
  disable_trait_solver_fast_paths(): boolean;
  // infer/mod.rs:771
  type_var_origin(vid: TyVid): TypeVariableOrigin;
  // infer/mod.rs:778
  float_var_origin(vid: FloatVid): FloatVariableOrigin;
  // infer/mod.rs:785
  const_var_origin(vid: ConstVid): ConstVariableOrigin | undefined;
  // infer/mod.rs:792
  unresolved_root_variables(): [TyVid[], IntVid[], FloatVid[]];
  // infer/mod.rs:811
  sub_regions(origin: SubregionOrigin, a: Region, b: Region, vis: VisibleForLeakCheck): void;
  // infer/mod.rs:822
  equate_regions(origin: SubregionOrigin, a: Region, b: Region, vis: VisibleForLeakCheck): void;
  // infer/mod.rs:847
  coerce_predicate(cause: ObligationCause, param_env: ParamEnv, predicate: PolyCoercePredicate): Result<InferResult<null>, [TyVid, TyVid]>;
  // infer/mod.rs:861
  subtype_predicate(cause: ObligationCause, param_env: ParamEnv, predicate: PolySubtypePredicate): Result<InferResult<null>, [TyVid, TyVid]>;
  // infer/mod.rs:900
  num_ty_vars(): number;
  // infer/mod.rs:904
  next_ty_vid(span: Span): TyVid;
  // infer/mod.rs:908
  next_ty_vid_with_origin(origin: TypeVariableOrigin): TyVid;
  // infer/mod.rs:912
  next_ty_vid_in_universe(span: Span, universe: UniverseIndex): TyVid;
  // infer/mod.rs:917
  next_ty_var(span: Span): Ty;
  // infer/mod.rs:921
  next_ty_var_with_origin(origin: TypeVariableOrigin): Ty;
  // infer/mod.rs:926
  next_ty_var_in_universe(span: Span, universe: UniverseIndex): Ty;
  // infer/mod.rs:931
  next_const_var(span: Span): Const;
  // infer/mod.rs:935
  next_const_var_with_origin(origin: ConstVariableOrigin): Const;
  // infer/mod.rs:945
  next_const_var_in_universe(span: Span, universe: UniverseIndex): Const;
  // infer/mod.rs:960
  next_int_var(): Ty;
  // infer/mod.rs:966
  next_float_var(span: Span, lint_id: HirId | undefined): Ty;
  // infer/mod.rs:978
  next_region_var(origin: RegionVariableOrigin): Region;
  // infer/mod.rs:985
  next_region_var_in_universe(origin: RegionVariableOrigin, universe: UniverseIndex): Region;
  // infer/mod.rs:995
  next_term_var_of_alias_kind(alias_term: AliasTerm, span: Span): Term;
  // infer/mod.rs:1018
  universe_of_region(r: Region): UniverseIndex;
  // infer/mod.rs:1023
  num_region_vars(): number;
  // infer/mod.rs:1029
  next_nll_region_var(origin: NllRegionVariableOrigin): Region;
  // infer/mod.rs:1035
  next_nll_region_var_in_universe(origin: NllRegionVariableOrigin, universe: UniverseIndex): Region;
  // infer/mod.rs:1043
  var_for_def(span: Span, param: GenericParamDef): GenericArg;
  // infer/mod.rs:1084
  fresh_args_for_item(span: Span, def_id: DefId): GenericArgs;
  // infer/mod.rs:1094
  tainted_by_errors(): ErrorGuaranteed | undefined;
  // infer/mod.rs:1100
  set_tainted_by_errors(e: ErrorGuaranteed): void;
  // infer/mod.rs:1105
  region_var_origin(vid: RegionVid): RegionVariableOrigin;
  // infer/mod.rs:1113
  get_region_var_infos(): VarInfos;
  // infer/mod.rs:1124
  has_opaque_types_in_storage(): boolean;
  // infer/mod.rs:1129
  take_opaque_types(): [OpaqueTypeKey, ProvisionalHiddenType][];
  // infer/mod.rs:1134
  clone_opaque_types(): [OpaqueTypeKey, ProvisionalHiddenType][];
  // infer/mod.rs:1138
  has_opaques_with_sub_unified_hidden_type(ty_vid: TyVid): boolean;
  // infer/mod.rs:1161
  opaques_with_sub_unified_hidden_type(ty_vid: TyVid): OpaqueAliasTy[];
  // infer/mod.rs:1196 (`id: impl Into<DefId>`: callers convert)
  can_define_opaque_ty(id: DefId): boolean;
  // infer/mod.rs:1214
  push_hir_typeck_potentially_region_dependent_goal(goal: PredicateObligation): void;
  // infer/mod.rs:1223
  take_hir_typeck_potentially_region_dependent_goals(): PredicateObligation[];
  // infer/mod.rs:1230
  ty_to_string(t: Ty): string;
  // infer/mod.rs:1236
  try_resolve_ty_var(vid: TyVid): Result<Ty, UniverseIndex>;
  // infer/mod.rs:1246
  shallow_resolve_ty_var_or_get_root(vid: TyVid): Result<Ty, TyVid>;
  // infer/mod.rs:1274
  shallow_resolve(ty: Ty): Ty;
  // infer/mod.rs:1341
  shallow_resolve_const(ct: Const): Const;
  // infer/mod.rs:1369
  shallow_resolve_term(term: Term): Term;
  // infer/mod.rs:1376
  root_var(var_: TyVid): TyVid;
  // infer/mod.rs:1381
  root_vid(ty: Ty): TyVid | undefined;
  // infer/mod.rs:1387
  sub_unify_ty_vids_raw(a: TyVid, b: TyVid): void;
  // infer/mod.rs:1391
  sub_unification_table_root_var(var_: TyVid): TyVid;
  // infer/mod.rs:1395
  root_float_var(var_: FloatVid): FloatVid;
  // infer/mod.rs:1399
  root_const_var(var_: ConstVid): ConstVid;
  // infer/mod.rs:1405
  shallow_resolve_const_var(vid: ConstVid): Const;
  // infer/mod.rs:1414
  shallow_resolve_ty_var(vid: TyVid): Ty;
  // infer/mod.rs:1423
  shallow_resolve_int_var(vid: IntVid): Ty;
  // infer/mod.rs:1437
  shallow_resolve_float_var(vid: FloatVid): Ty;
  // infer/mod.rs:1454
  deeply_resolve_ignoring_regions<T>(value: T, d_T: TypeFoldable<T>): T;
  // infer/mod.rs:1473
  deeply_resolve_via_unification_table<T>(value: T, d_T: TypeFoldable<T>): T;
  // infer/mod.rs:1482
  resolve_numeric_literals_with_default<T>(value: T, d_T: TypeFoldable<T>): T;
  // infer/mod.rs:1493
  try_resolve_const_var(vid: ConstVid): Result<Const, UniverseIndex>;
  // infer/mod.rs:1510
  deeply_resolve_via_region_graph<T>(value: T, d_T: TypeFoldable<T>): FixupResult<T>;
  // infer/mod.rs:1539
  instantiate_binder_with_fresh_vars<T>(span: Span, lbrct: BoundRegionConversionTime, value: Binder<T>, d_T: TypeFoldable<T>): T;
  // infer/mod.rs:1585
  insert_placeholder_assumptions(u: UniverseIndex, assumptions: Assumptions): void;
  // infer/mod.rs:1603
  get_placeholder_assumptions(u: UniverseIndex): Assumptions;
  // infer/mod.rs:1610
  has_placeholder_assumptions(range: RangeInclusive<UniverseIndex>): boolean;
  // infer/mod.rs:1618
  get_solver_region_constraint(): SolverRegionConstraint;
  // infer/mod.rs:1622
  overwrite_solver_region_constraint(constraint: SolverRegionConstraint): void;
  // infer/mod.rs:1634
  verify_generic_bound(origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void;
  // infer/mod.rs:1652
  closure_kind(closure_ty: Ty): ClosureKind | undefined;
  // infer/mod.rs:1662
  universe(): UniverseIndex;
  // infer/mod.rs:1668
  create_next_universe(): UniverseIndex;
  // infer/mod.rs:1677
  with_disabled_next_solver_overflow_fcw<R>(f: () => R): R;
  // infer/mod.rs:1690
  typing_env(param_env: ParamEnv): TypingEnv;
  // infer/mod.rs:1713
  pseudo_canonicalize_query<V>(param_env: ParamEnv, value: V, d_V: TypeFoldable<V>): PseudoCanonicalInput<V>;
  // infer/mod.rs:1731
  is_ty_infer_var_definitely_unchanged(): (_1: TyOrConstInferVar) => boolean;
  // infer/mod.rs:1758
  ty_or_const_infer_var_changed(var_: TyOrConstInferVar): boolean;
  // infer/mod.rs:1780
  attach_obligation_inspector(inspector: ObligationInspector): void;
  // infer/mod.rs:1917
  find_block_span(block: hir.Block): Span;
  // infer/mod.rs:1932
  find_block_span_from_hir_id(hir_id: HirId): Span;

  // ---- infer/at.rs (lane infer-core) ----
  // infer/at.rs:58
  at(cause: ObligationCause, param_env: ParamEnv): At;
  // infer/at.rs:69
  fork(): InferCtxt;
  // infer/at.rs:98
  fork_with_typing_mode(typing_mode: TypingMode): InferCtxt;

  // ---- infer/canonical/canonicalizer.rs (lane infer-canonical-outlives) ----
  // infer/canonical/canonicalizer.rs:41
  canonicalize_query<V>(value: ParamEnvAnd<V>, query_state: OriginalQueryValues, d_V: TypeFoldable<V>): CanonicalQueryInput<ParamEnvAnd<V>>;
  // infer/canonical/canonicalizer.rs:104
  canonicalize_response<V>(value: V, d_V: TypeFoldable<V>): Canonical<V>;
  // infer/canonical/canonicalizer.rs:118
  canonicalize_user_type_annotation<V>(value: V, d_V: TypeFoldable<V>): Canonical<V>;

  // ---- infer/canonical/mod.rs (lane infer-canonical-outlives) ----
  // infer/canonical/mod.rs:49
  instantiate_canonical<T>(span: Span, canonical: Canonical<T>, d_T: TypeFoldable<T>): [T, CanonicalVarValues];
  // infer/canonical/mod.rs:86
  instantiate_canonical_var(span: Span, kind: CanonicalVarKind, previous_var_values: readonly GenericArg[], universe_map: (_1: UniverseIndex) => UniverseIndex): GenericArg;

  // ---- infer/canonical/query_response.rs (lane infer-canonical-outlives) ----
  // infer/canonical/query_response.rs:56
  make_canonicalized_query_response<T>(inference_vars: CanonicalVarValues, answer: T, fulfill_cx: TraitEngine<ScrubbedTraitError>, d_T: TypeFoldable<T>): Result<Canonical<QueryResponse<T>>, NoSolution>;
  // infer/canonical/query_response.rs:83
  make_query_response_ignoring_pending_obligations<T>(inference_vars: CanonicalVarValues, answer: T, prev_entries: OpaqueTypeStorageEntries, d_T: TypeFoldable<T>): Canonical<QueryResponse<T>>;
  // infer/canonical/query_response.rs:122
  make_query_response<T>(inference_vars: CanonicalVarValues, answer: T, fulfill_cx: TraitEngine<ScrubbedTraitError>, d_T: TypeFoldable<T>): Result<QueryResponse<T>, NoSolution>;
  // infer/canonical/query_response.rs:185
  instantiate_query_response_and_region_obligations<R>(cause: ObligationCause, param_env: ParamEnv, original_values: OriginalQueryValues, query_response: Canonical<QueryResponse<R>>, d_R: TypeFoldable<R>): InferResult<R>;
  // infer/canonical/query_response.rs:258
  instantiate_nll_query_response_and_region_obligations<R>(cause: ObligationCause, param_env: ParamEnv, original_values: OriginalQueryValues, query_response: Canonical<QueryResponse<R>>, output_query_region_constraints: QueryRegionConstraints, d_R: TypeFoldable<R>): InferResult<R>;
  // infer/canonical/query_response.rs:365
  query_response_instantiation<R>(cause: ObligationCause, param_env: ParamEnv, original_values: OriginalQueryValues, query_response: Canonical<QueryResponse<R>>, d_R: TypeFoldable<R>): InferResult<CanonicalVarValues>;
  // infer/canonical/query_response.rs:411
  query_response_instantiation_guess<R>(cause: ObligationCause, param_env: ParamEnv, original_values: OriginalQueryValues, query_response: Canonical<QueryResponse<R>>, d_R: TypeFoldable<R>): InferResult<CanonicalVarValues>;
  // infer/canonical/query_response.rs:544
  unify_query_response_instantiation_guess<R>(cause: ObligationCause, param_env: ParamEnv, original_values: OriginalQueryValues, result_args: CanonicalVarValues, query_response: Canonical<QueryResponse<R>>, d_R: TypeFoldable<R>): InferResult<null>;
  // infer/canonical/query_response.rs:570
  unify_canonical_vars(cause: ObligationCause, param_env: ParamEnv, variables1: OriginalQueryValues, variables2: (_1: number) => GenericArg): InferResult<null>;

  // ---- infer/context.rs: `impl InferCtxtLike for InferCtxt` (lane infer-relate) ----
  // infer/context.rs:23
  cx(): TyCtxt;
  // infer/context.rs:27
  // next_trait_solver: served by the inherent method (mod.rs:734)
  // infer/context.rs:31
  enable_next_solver_overflow_fcw(): boolean;
  // infer/context.rs:35
  // disable_trait_solver_fast_paths: served by the inherent method (mod.rs:764)
  // infer/context.rs:39
  // typing_mode_raw: served by the inherent method (mod.rs:759)
  // infer/context.rs:43
  // universe: served by the inherent method (mod.rs:1662)
  // infer/context.rs:47
  // create_next_universe: served by the inherent method (mod.rs:1668)
  // infer/context.rs:51
  // insert_placeholder_assumptions: served by the inherent method (mod.rs:1585)
  // infer/context.rs:59
  // get_placeholder_assumptions: served by the inherent method (mod.rs:1603)
  // infer/context.rs:66 (inherent `get_solver_region_constraint` (mod.rs:1618) returns the spanned constraint)
  ir_get_solver_region_constraint(): RegionConstraint;
  // infer/context.rs:72
  // has_placeholder_assumptions: served by the inherent method (mod.rs:1610)
  // infer/context.rs:76 (inherent `overwrite_solver_region_constraint` (mod.rs:1622) takes no span)
  ir_overwrite_solver_region_constraint(constraint: RegionConstraint, span: Span): void;
  // infer/context.rs:84
  universe_of_ty(vid: TyVid): UniverseIndex | undefined;
  // infer/context.rs:91 (inherent `universe_of_region` (mod.rs:1018) takes a `Region`)
  ir_universe_of_region(lt: RegionVid): UniverseIndex | undefined;
  // infer/context.rs:98
  universe_of_const(ct: ConstVid): UniverseIndex | undefined;
  // infer/context.rs:105
  root_ty_var(var_: TyVid): TyVid;
  // infer/context.rs:109
  // sub_unification_table_root_var: served by the inherent method (mod.rs:1391)
  // infer/context.rs:114
  is_sub_unification_table_root_var(vid: TyVid): boolean;
  // infer/context.rs:123
  // root_const_var: served by the inherent method (mod.rs:1399)
  // infer/context.rs:127
  // shallow_resolve_ty_var: served by the inherent method (mod.rs:1414)
  // infer/context.rs:131
  // shallow_resolve_int_var: served by the inherent method (mod.rs:1423)
  // infer/context.rs:135
  // shallow_resolve_float_var: served by the inherent method (mod.rs:1437)
  // infer/context.rs:139
  // shallow_resolve_const_var: served by the inherent method (mod.rs:1405)
  // infer/context.rs:143
  shallow_resolve_region_var(vid: RegionVid): Region;
  // infer/context.rs:150
  // ty_or_const_infer_var_changed: served by the inherent method (mod.rs:1758)
  // infer/context.rs:154
  next_region_infer(): Region;
  // infer/context.rs:158
  next_ty_infer(): Ty;
  // infer/context.rs:162
  next_const_infer(): Const;
  // infer/context.rs:166 (inherent `fresh_args_for_item` (mod.rs:1084) takes a span)
  ir_fresh_args_for_item(def_id: DefId): GenericArgs;
  // infer/context.rs:170
  instantiate_binder_with_infer<T>(value: Binder<T>, d_T: TypeFoldable<T>): T;
  // infer/context.rs:181
  enter_forall_without_assumptions<T, U>(value: Binder<T>, f: (value: T) => U, d_T: TypeFoldable<T>): U;
  // infer/context.rs:189
  enter_forall_with_empty_assumptions<T, U>(value: Binder<T>, f: (value: T) => U, d_T: TypeFoldable<T>): U;
  // infer/context.rs:203
  equate_ty_vids_raw(a: TyVid, b: TyVid): void;
  // infer/context.rs:207
  // sub_unify_ty_vids_raw: served by the inherent method (mod.rs:1387)
  // infer/context.rs:211
  equate_int_vids_raw(a: IntVid, b: IntVid): void;
  // infer/context.rs:215
  equate_float_vids_raw(a: FloatVid, b: FloatVid): void;
  // infer/context.rs:219
  equate_const_vids_raw(a: ConstVid, b: ConstVid): void;
  // infer/context.rs:223
  instantiate_ty_var_raw(vid: TyVid, ty: Ty): void;
  // infer/context.rs:229
  instantiate_const_var_raw(vid: ConstVid, ct: Const): void;
  // infer/context.rs:238
  // instantiate_ty_var: served by the inherent method (relate/generalize.rs:47)
  // infer/context.rs:255
  instantiate_int_var_raw(vid: IntVid, value: IntVarValue): void;
  // infer/context.rs:259
  instantiate_float_var_raw(vid: FloatVid, value: FloatVarValue): void;
  // infer/context.rs:263
  // instantiate_const_var: served by the inherent method (relate/generalize.rs:101)
  // infer/context.rs:273
  // set_tainted_by_errors: served by the inherent method (mod.rs:1100)
  // infer/context.rs:277
  // shallow_resolve: served by the inherent method (mod.rs:1274)
  // infer/context.rs:280
  // shallow_resolve_const: served by the inherent method (mod.rs:1341)
  // infer/context.rs:284
  // deeply_resolve_ignoring_regions: served by the inherent method (mod.rs:1454)
  // infer/context.rs:291
  // probe: served by the inherent method (snapshot/mod.rs:101; a `() => T` closure ignores the snapshot argument)
  // infer/context.rs:295
  // commit_if_ok: served by the inherent method (snapshot/mod.rs:81; as `probe`)
  // infer/context.rs:299 (inherent `sub_regions` (mod.rs:811) takes an origin)
  ir_sub_regions(sub: Region, sup: Region, vis: VisibleForLeakCheck, span: Span): void;
  // infer/context.rs:314 (inherent `equate_regions` (mod.rs:822) takes an origin)
  ir_equate_regions(a: Region, b: Region, vis: VisibleForLeakCheck, span: Span): void;
  // infer/context.rs:329 (inherent `register_solver_region_constraint` (outlives/obligations.rs:143) takes the spanned constraint)
  ir_register_solver_region_constraint(c: RegionConstraint, span: Span): void;
  // infer/context.rs:337
  register_ty_outlives(ty: Ty, r: Region, span: Span): void;
  // infer/context.rs:343
  opaque_types_storage_num_entries(): OpaqueTypeStorageEntries;
  // infer/context.rs:346
  clone_opaque_types_lookup_table(): [OpaqueTypeKey, Ty][];
  // infer/context.rs:349
  clone_duplicate_opaque_types(): [OpaqueTypeKey, Ty][];
  // infer/context.rs:357
  clone_opaque_types_added_since(prev_entries: OpaqueTypeStorageEntries): [OpaqueTypeKey, Ty][];
  // infer/context.rs:368
  // opaques_with_sub_unified_hidden_type: served by the inherent method (mod.rs:1161)
  // infer/context.rs:372 (inherent `register_hidden_type_in_storage` (opaque_types/mod.rs:202) takes a `ProvisionalHiddenType`)
  ir_register_hidden_type_in_storage(opaque_type_key: OpaqueTypeKey, hidden_ty: Ty, span: Span): Ty | undefined;
  // infer/context.rs:383
  add_duplicate_opaque_type(opaque_type_key: OpaqueTypeKey, hidden_ty: Ty, span: Span): void;
  // infer/context.rs:395
  reset_opaque_types(): void;

  // ---- infer/opaque_types/mod.rs (lane infer-opaque-snapshot) ----
  // infer/opaque_types/mod.rs:25
  replace_opaque_types_with_inference_vars<T>(value: T, body_def_id: LocalDefId, span: Span, param_env: ParamEnv, d_T: TypeFoldable<T>): InferOk<T>;
  // infer/opaque_types/mod.rs:78
  handle_opaque_type(a: Ty, b: Ty, span: Span, param_env: ParamEnv): Result<Goal<Predicate>[], TypeError>;
  // infer/opaque_types/mod.rs:176
  register_hidden_type(opaque_type_key: OpaqueTypeKey, span: Span, param_env: ParamEnv, hidden_ty: Ty): Result<Goal<Predicate>[], TypeError>;
  // infer/opaque_types/mod.rs:202
  register_hidden_type_in_storage(opaque_type_key: OpaqueTypeKey, hidden_ty: ProvisionalHiddenType): Ty | undefined;
  // infer/opaque_types/mod.rs:217
  insert_hidden_type(opaque_type_key: OpaqueTypeKey, span: Span, param_env: ParamEnv, hidden_ty: Ty, goals: Goal<Predicate>[]): Result<null, TypeError>;
  // infer/opaque_types/mod.rs:296
  add_item_bounds_for_hidden_type(def_id: DefId, args: GenericArgs, param_env: ParamEnv, hidden_ty: Ty, goals: Goal<Predicate>[]): void;

  // ---- infer/outlives/mod.rs (lane infer-canonical-outlives) ----
  // infer/outlives/mod.rs:43
  resolve_regions_with_outlives_env(outlives_env: OutlivesEnvironment): RegionResolutionError[];
  // infer/outlives/mod.rs:109
  take_and_reset_region_constraints(): RegionConstraintData;
  // infer/outlives/mod.rs:125
  with_region_constraints<R>(op: (_1: RegionConstraintData) => R): R;

  // ---- infer/outlives/obligations.rs (lane infer-canonical-outlives) ----
  // infer/outlives/obligations.rs:86
  register_outlives_constraint(_0: ArgOutlivesClause, vis: VisibleForLeakCheck, cause: ObligationCause): void;
  // infer/outlives/obligations.rs:103
  register_region_eq_constraint(_0: RegionEqPredicate, vis: VisibleForLeakCheck, cause: ObligationCause): void;
  // infer/outlives/obligations.rs:115
  register_region_outlives_constraint(_0: RegionOutlivesClause, vis: VisibleForLeakCheck, cause: ObligationCause): void;
  // infer/outlives/obligations.rs:134
  register_type_outlives_constraint_inner(obligation: TypeOutlivesConstraint): void;
  // infer/outlives/obligations.rs:143
  register_solver_region_constraint(c: SolverRegionConstraint): void;
  // infer/outlives/obligations.rs:159
  register_type_outlives_constraint(sup_type: Ty, sub_region: Region, cause: ObligationCause): void;
  // infer/outlives/obligations.rs:201
  take_registered_region_obligations(): TypeOutlivesConstraint[];
  // infer/outlives/obligations.rs:206
  num_registered_region_obligations(): number;
  // infer/outlives/obligations.rs:210
  registered_region_obligations_since(prev: number): TypeOutlivesConstraint[];
  // infer/outlives/obligations.rs:217
  clone_registered_region_obligations(): TypeOutlivesConstraint[];
  // infer/outlives/obligations.rs:221
  register_region_assumption(assumption: ArgOutlivesClause): void;
  // infer/outlives/obligations.rs:227
  take_registered_region_assumptions(): ArgOutlivesClause[];
  // infer/outlives/obligations.rs:232
  destructure_solver_region_constraints_for_regionck(outlives_env: OutlivesEnvironment): void;
  // infer/outlives/obligations.rs:256
  destructure_solver_region_constraints_for_borrowck(conversion: TypeOutlivesDelegate, known_type_outlives: readonly PolyTypeOutlivesClause[], region_bound_pairs: RegionBoundPairs, region_outlives: TransitiveRelation<RegionVid>): void;
  // infer/outlives/obligations.rs:274
  destructure_solver_region_constraints(assumptions: Assumptions, conversion: TypeOutlivesDelegate): void;
  // infer/outlives/obligations.rs:335
  process_registered_region_obligations(outlives_env: OutlivesEnvironment): void;

  // ---- infer/projection.rs (lane infer-opaque-snapshot) ----
  // infer/projection.rs:15
  projection_term_to_infer(param_env: ParamEnv, alias_term: AliasTerm, cause: ObligationCause, recursion_depth: number, obligations: PredicateObligations): Term;

  // ---- infer/relate/generalize.rs (lane infer-relate) ----
  // infer/relate/generalize.rs:47
  instantiate_ty_var(relation: PredicateEmittingRelation, target_is_expected: boolean, target_vid: TyVid, instantiation_variance: Variance, source_ty: Ty): RelateResult<null>;
  // infer/relate/generalize.rs:101
  instantiate_const_var(relation: PredicateEmittingRelation, target_is_expected: boolean, target_vid: ConstVid, source_ct: Const): RelateResult<null>;
  // infer/relate/generalize.rs:124
  instantiate_var(relation: PredicateEmittingRelation, target_is_expected: boolean, target_vid: TermVid, instantiation_variance: Variance, source_term: Term): RelateResult<null>;
  // infer/relate/generalize.rs:244
  union_var_term(l: TermVid, r: Term): void;
  // infer/relate/generalize.rs:280
  generalize(span: Span, target_vid: TermVid, ambient_variance: Variance, source_term: Term): RelateResult<Generalization<Term>>;

  // ---- infer/relate/higher_ranked.rs (lane infer-relate) ----
  // infer/relate/higher_ranked.rs:24
  enter_forall_and_leak_universe<T>(binder: Binder<T>, d_T: TypeFoldable<T>): T;
  // infer/relate/higher_ranked.rs:66
  enter_forall<T, U>(forall: Binder<T>, f: (_1: T) => U, d_T: TypeFoldable<T>): U;
  // infer/relate/higher_ranked.rs:84
  leak_check(outer_universe: UniverseIndex, only_consider_snapshot: CombinedSnapshot | undefined): RelateResult<null>;

  // ---- infer/snapshot/fudge.rs (lane infer-opaque-snapshot) ----
  // infer/snapshot/fudge.rs:99
  fudge_inference_if_ok<T, E>(f: () => Result<T, E>, d_T: TypeFoldable<T>): Result<T, E>;
  // infer/snapshot/fudge.rs:124
  fudge_inference<T>(snapshot_vars: SnapshotVarData, value: T, d_T: TypeFoldable<T>): T;

  // ---- infer/snapshot/mod.rs (lane infer-opaque-snapshot) ----
  // infer/snapshot/mod.rs:29
  variable_lengths(): VariableLengths;
  // infer/snapshot/mod.rs:40
  in_snapshot(): boolean;
  // infer/snapshot/mod.rs:44
  num_open_snapshots(): number;
  // infer/snapshot/mod.rs:48
  start_snapshot(): CombinedSnapshot;
  // infer/snapshot/mod.rs:61
  rollback_to(snapshot: CombinedSnapshot): void;
  // infer/snapshot/mod.rs:72
  commit_from(snapshot: CombinedSnapshot): void;
  // infer/snapshot/mod.rs:81
  commit_if_ok<T, E>(f: (snapshot: CombinedSnapshot) => Result<T, E>): Result<T, E>;
  // infer/snapshot/mod.rs:101
  probe<R>(f: (snapshot: CombinedSnapshot) => R): R;
  // infer/snapshot/mod.rs:113
  region_constraints_added_in_snapshot(snapshot: CombinedSnapshot): boolean;
  // infer/snapshot/mod.rs:120
  opaque_types_added_in_snapshot(snapshot: CombinedSnapshot): boolean;
}

// ======================================================================================================================
// InferCtxtBuilder (infer/mod.rs:589) and TyCtxtInferExt (mod.rs:607)
// ======================================================================================================================

/// Used to configure inference contexts before their creation.
// rustc-type: compiler/rustc_infer/src/infer/mod.rs:589 InferCtxtBuilder
export class InferCtxtBuilder {
  constructor(
    public tcx: TyCtxt,
    public considering_regions: boolean,
    // PORT: `in_hir_typeck_` (also a builder method `in_hir_typeck()`).
    public in_hir_typeck_: boolean,
    // PORT: `skip_leak_check_` (also a builder method `skip_leak_check()`).
    public skip_leak_check_: boolean,
    /// Whether we should use the new trait solver in the local inference context,
    /// which affects things like which solver is used in `predicate_may_hold`.
    public next_trait_solver: boolean,
    // PORT: `enable_next_solver_overflow_fcw_` (also a builder method `enable_next_solver_overflow_fcw()`).
    public enable_next_solver_overflow_fcw_: boolean,
  ) {}
}

export interface InferCtxtBuilder {
  // ---- infer/mod.rs (lane infcx-contract) ----
  // infer/mod.rs:622
  with_next_trait_solver(next_trait_solver: boolean): InferCtxtBuilder;
  // infer/mod.rs:627
  enable_next_solver_overflow_fcw(enable_next_solver_overflow_fcw: boolean): InferCtxtBuilder;
  // infer/mod.rs:635
  ignoring_regions(): InferCtxtBuilder;
  // infer/mod.rs:640
  in_hir_typeck(): InferCtxtBuilder;
  // infer/mod.rs:645
  skip_leak_check(skip_leak_check: boolean): InferCtxtBuilder;
  // infer/mod.rs:657
  build_with_canonical<T>(span: Span, input: CanonicalQueryInput<T>, d_T: TypeFoldable<T>): [InferCtxt, T, CanonicalVarValues];
  // infer/mod.rs:670
  build_with_typing_env(typing_env: TypingEnv): [InferCtxt, ParamEnv];
  // infer/mod.rs:677
  build(typing_mode: TypingMode): InferCtxt;
}

// `#[extension(pub trait TyCtxtInferExt<'tcx>)] impl<'tcx> TyCtxt<'tcx>` (mod.rs:607): a method on `TyCtxt.prototype`,
// installed by infer/mod.ts (as rustc_middle's `ConstExt` on `Const.prototype`).
declare module "../rustc_middle/ty/context.ts" {
  interface TyCtxt {
    // infer/mod.rs:609
    infer_ctxt(): InferCtxtBuilder;
  }
}

// ======================================================================================================================
// At (infer/at.rs:50)
// ======================================================================================================================

// rustc-type: compiler/rustc_infer/src/infer/at.rs:50 At
// PORT: `#[derive(Clone, Copy)]` is `clone_At` (infer/at.ts); `&'a ObligationCause` is the cause itself.
export class At {
  constructor(
    public infcx: InferCtxt,
    public cause: ObligationCause,
    public param_env: ParamEnv,
  ) {}
}

export interface At {
  // ---- infer/at.rs (lane infer-core) ----
  // infer/at.rs:138
  sup<T>(define_opaque_types: DefineOpaqueTypes, expected: T, actual: T, d_T: ToTrace<T>): InferResult<null>;
  // infer/at.rs:171
  sub<T>(define_opaque_types: DefineOpaqueTypes, expected: T, actual: T, d_T: ToTrace<T>): InferResult<null>;
  // infer/at.rs:204
  eq<T>(define_opaque_types: DefineOpaqueTypes, expected: T, actual: T, d_T: ToTrace<T>): InferResult<null>;
  // infer/at.rs:222
  eq_trace<T>(define_opaque_types: DefineOpaqueTypes, trace: TypeTrace, expected: T, actual: T, d_T: Relate<T>): InferResult<null>;
  // infer/at.rs:255
  relate<T>(define_opaque_types: DefineOpaqueTypes, expected: T, variance: Variance, actual: T, d_T: ToTrace<T>): InferResult<null>;
  // infer/at.rs:284
  lub<T>(expected: T, actual: T, d_T: ToTrace<T>): InferResult<T>;
  // infer/at.rs:298
  goals_to_obligations(goals: Goal<Predicate>[]): InferOk<null>;
}

// ======================================================================================================================
// Methods of generated classes used by more than one lane
// ======================================================================================================================

declare module "./infer/mod.gen.ts" {
  interface TypeTrace {
    // infer/mod.rs:1810
    span(): Span;
  }
  namespace TypeTrace {
    // infer/mod.rs:1814
    export let types: (cause: ObligationCause, a: Ty, b: Ty) => TypeTrace;
    // infer/mod.rs:1821
    export let trait_refs: (cause: ObligationCause, a: TraitRef, b: TraitRef) => TypeTrace;
    // infer/mod.rs:1829
    export let consts: (cause: ObligationCause, a: Const, b: Const) => TypeTrace;
  }
  interface InferOk<T> {
    // infer/mod.rs:712
    into_value_registering_obligations<E>(infcx: InferCtxt, fulfill_cx: TraitEngine<E>): T;
    // infer/mod.rs:724 (`impl InferOk<'tcx, ()>`)
    into_obligations(): PredicateObligations;
  }
}

declare module "./infer/region_constraints/mod.gen.ts" {
  interface RegionConstraintCollector {
    // infer/region_constraints/leak_check.rs:75
    leak_check(tcx: TyCtxt, outer_universe: UniverseIndex, max_universe: UniverseIndex, only_consider_snapshot: CombinedSnapshot | undefined): RelateResult<null>;
    // infer/region_constraints/mod.rs:368
    num_region_vars(): number;
    // infer/region_constraints/mod.rs:384
    take_and_reset_data(): RegionConstraintData;
    // infer/region_constraints/mod.rs:424
    data(): RegionConstraintData;
    // infer/region_constraints/mod.rs:428
    start_snapshot(): RegionSnapshot;
    // infer/region_constraints/mod.rs:433
    rollback_to(snapshot: RegionSnapshot): void;
    // infer/region_constraints/mod.rs:438
    new_region_var(universe: UniverseIndex, origin: RegionVariableOrigin): RegionVid;
    // infer/region_constraints/mod.rs:453
    var_origin(vid: RegionVid): RegionVariableOrigin;
    // infer/region_constraints/mod.rs:457
    add_constraint(constraint: Constraint, origin: SubregionOrigin): void;
    // infer/region_constraints/mod.rs:466
    add_verify(verify: Verify): void;
    // infer/region_constraints/mod.rs:482
    make_eqregion(origin: SubregionOrigin, a: Region, b: Region, visible_for_leak_check: VisibleForLeakCheck): void;
    // infer/region_constraints/mod.rs:571
    make_subregion(origin: SubregionOrigin, sub: Region, sup: Region, visible_for_leak_check: VisibleForLeakCheck): void;
    // infer/region_constraints/mod.rs:625
    verify_generic_bound(origin: SubregionOrigin, kind: GenericKind, sub: Region, bound: VerifyBound): void;
    // infer/region_constraints/mod.rs:635
    lub_regions(tcx: TyCtxt, origin: SubregionOrigin, a: Region, b: Region): Region;
    // infer/region_constraints/mod.rs:653
    glb_regions(tcx: TyCtxt, origin: SubregionOrigin, a: Region, b: Region): Region;
    // infer/region_constraints/mod.rs:675
    shallow_resolve_region_var(tcx: TyCtxt, vid: RegionVid): Region;
    // infer/region_constraints/mod.rs:688
    try_resolve_region_var(vid: RegionVid): Result<Region, UniverseIndex>;
    // infer/region_constraints/mod.rs:698
    combine_map(t: CombineMapType): CombineMap;
    // infer/region_constraints/mod.rs:705
    combine_vars(tcx: TyCtxt, t: CombineMapType, a: Region, b: Region, origin: SubregionOrigin): Region;
    // infer/region_constraints/mod.rs:738
    universe(region: Region): UniverseIndex;
    // infer/region_constraints/mod.rs:754
    vars_since_snapshot(value_count: number): [Range<RegionVid>, RegionVariableOrigin[]];
    // infer/region_constraints/mod.rs:767
    region_constraints_added_in_snapshot(mark: Snapshot): boolean;
    // infer/region_constraints/mod.rs:774
    unification_table_mut(): UnificationTable<RegionVidKey, RegionVariableValue, import("./infer/unify_key.ts").RegionUnificationError>;
  }
  interface RegionConstraintData {
    // infer/region_constraints/mod.rs:850
    is_empty(): boolean;
  }
  interface Constraint {
    // infer/region_constraints/mod.rs:126
    involves_placeholders(): boolean;
    // infer/region_constraints/mod.rs:130
    iter_outlives(): Iterable<Constraint>;
  }
}

declare module "./infer/region_constraints/mod.ts" {
  interface RegionConstraintStorage {
    // infer/region_constraints/mod.rs:359
    with_log(undo_log: InferCtxtUndoLogs): RegionConstraintCollector;
    // infer/region_constraints/mod.rs:857 (`impl Rollback<UndoLog> for RegionConstraintStorage`)
    reverse(undo: import("./infer/region_constraints/mod.gen.ts").UndoLog): void;
  }
}

declare module "./infer/lexical_region_resolve/mod.gen.ts" {
  interface LexicalRegionResolutions {
    // infer/lexical_region_resolve/mod.rs:963
    normalize<T>(tcx: TyCtxt, value: T, d_T: TypeFoldable<T>): T;
    // infer/lexical_region_resolve/mod.rs:970
    value(rid: RegionVid): LexicalVarValue;
    // infer/lexical_region_resolve/mod.rs:974 (`&mut VarValue`: the element; callers assign `values[rid]` to replace it)
    value_mut(rid: RegionVid): LexicalVarValue;
    // infer/lexical_region_resolve/mod.rs:978
    resolve_region(tcx: TyCtxt, r: Region): Region;
  }
}

declare module "./infer/free_regions.gen.ts" {
  interface RegionRelations {
    // infer/free_regions.rs:26
    lub_param_regions(r_a: Region, r_b: Region): Region;
  }
  namespace RegionRelations {
    // infer/free_regions.rs:22
    function new_(tcx: TyCtxt, free_regions: FreeRegionMap): RegionRelations;
    export { new_ as new };
  }
  interface FreeRegionMap {
    // infer/free_regions.rs:41
    elements(): Iterable<Region>;
    // infer/free_regions.rs:45
    is_empty(): boolean;
    // infer/free_regions.rs:57
    sub_free_regions(tcx: TyCtxt, r_a: Region, r_b: Region): boolean;
    // infer/free_regions.rs:76
    check_relation(r_a: Region, r_b: Region): boolean;
    // infer/free_regions.rs:84
    lub_param_regions(tcx: TyCtxt, r_a: Region, r_b: Region): Region;
  }
}

declare module "./infer/outlives/env.ts" {
  interface OutlivesEnvironment {
    // infer/outlives/env.rs:98
    free_region_map(): FreeRegionMap;
    // infer/outlives/env.rs:102
    region_bound_pairs(): RegionBoundPairs;
    // infer/outlives/env.rs:106
    known_type_outlives(): readonly PolyTypeOutlivesClause[];
    // infer/outlives/env.rs:110
    higher_ranked_assumptions(): Set<ArgOutlivesClause>;
  }
  namespace OutlivesEnvironment {
    // infer/outlives/env.rs:55
    export let from_normalized_bounds: (param_env: ParamEnv, known_type_outlives: PolyTypeOutlivesClause[], extra_bounds: Iterable<OutlivesBound>, higher_ranked_assumptions: Set<ArgOutlivesClause>) => OutlivesEnvironment;
  }
}

declare module "./infer/opaque_types/table.gen.ts" {
  interface OpaqueTypeStorage {
    // infer/opaque_types/table.rs:35
    remove(key: OpaqueTypeKey, prev: ProvisionalHiddenType | undefined): void;
    // infer/opaque_types/table.rs:51
    pop_duplicate_entry(): void;
    // infer/opaque_types/table.rs:56
    is_empty(): boolean;
    // infer/opaque_types/table.rs:61
    take_opaque_types(): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]>;
    // infer/opaque_types/table.rs:68
    num_entries(): OpaqueTypeStorageEntries;
    // infer/opaque_types/table.rs:75
    opaque_types_added_since(prev_entries: OpaqueTypeStorageEntries): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]>;
    // infer/opaque_types/table.rs:91
    iter_lookup_table(): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]>;
    // infer/opaque_types/table.rs:102
    iter_duplicate_entries(): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]>;
    // infer/opaque_types/table.rs:108
    iter_opaque_types(): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]>;
    // infer/opaque_types/table.rs:116
    with_log(undo_log: InferCtxtUndoLogs): OpaqueTypeTable;
  }
  interface OpaqueTypeStorageEntries {
    // infer/opaque_types/table.rs:28 (`impl inherent::OpaqueTypeStorageEntries`)
    needs_reevaluation(canonicalized: number): boolean;
  }
  interface OpaqueTypeTable {
    // infer/opaque_types/table.rs:131 (`impl Deref for OpaqueTypeTable`: `Target = OpaqueTypeStorage`)
    deref(): OpaqueTypeStorage;
    // infer/opaque_types/table.rs:138
    register(key: OpaqueTypeKey, hidden_type: ProvisionalHiddenType): Ty | undefined;
    // infer/opaque_types/table.rs:153
    add_duplicate(key: OpaqueTypeKey, hidden_type: ProvisionalHiddenType): void;
  }
}

declare module "./infer/freshen.gen.ts" {
  interface TypeFreshener {
    // infer/freshen.rs:63
    freshen_ty(input: InferTy, mk_fresh: (_1: number) => Ty): Ty;
    // infer/freshen.rs:79
    freshen_const(input: InferConst, freshener: (_1: number) => InferConst): Const;
    // infer/freshen.rs:171
    fold_infer_ty(ty: InferTy): Ty;
  }
  namespace TypeFreshener {
    // infer/freshen.rs:53
    function new_(infcx: InferCtxt): TypeFreshener;
    export { new_ as new };
  }
}

declare module "./infer/snapshot/fudge.gen.ts" {
  interface SnapshotVarData {
    // infer/snapshot/fudge.rs:165
    is_empty(): boolean;
  }
  namespace SnapshotVarData {
    // infer/snapshot/fudge.rs:148
    function new_(infcx: InferCtxt, vars_pre_snapshot: VariableLengths): SnapshotVarData;
    export { new_ as new };
  }
}

declare module "./infer/relate/type_relating.ts" {
  interface TypeRelating {
    // infer/relate/type_relating.rs:71
    into_obligations(): PredicateObligations;
  }
  namespace TypeRelating {
    // infer/relate/type_relating.rs:52
    function new_(infcx: InferCtxt, trace: TypeTrace, param_env: ParamEnv, define_opaque_types: DefineOpaqueTypes, ambient_variance: Variance): TypeRelating;
    export { new_ as new };
  }
}

declare module "./infer/relate/lattice.ts" {
  interface LatticeOp {
    // infer/relate/lattice.rs:68
    into_obligations(): PredicateObligations;
  }
  namespace LatticeOp {
    // infer/relate/lattice.rs:59
    function new_(infcx: InferCtxt, trace: TypeTrace, param_env: ParamEnv, kind: LatticeOpKind): LatticeOp;
    export { new_ as new };
  }
}

declare module "./traits/mod.gen.ts" {
  interface Obligation<T> {
    // traits/mod.rs:63 (`impl<T: Copy> Obligation<T>`)
    as_goal(): Goal<T>;
    // traits/mod.rs:71 (`impl PartialEq for Obligation`)
    eq(other: Obligation<T>): boolean;
    // traits/mod.rs:84 (`impl Hash for Obligation`): hashes into an `FxHasher`-like state
    hash(state: import("../vendor/rustc_hash/lib.ts").FxHasher): void;
    // traits/mod.rs:99 (`impl PredicateObligation`)
    flip_polarity(this: PredicateObligation, tcx: TyCtxt): PredicateObligation | undefined;
    // traits/mod.rs:110 (`impl PolyTraitObligation`)
    derived_cause(this: PolyTraitObligation, variant: (_1: DerivedCause) => ObligationCauseCode): ObligationCause;
    // traits/mod.rs:143
    set_depth_from_parent(parent_depth: number): void;
    // traits/mod.rs:168 (`value: impl Upcast<TyCtxt, P>`)
    with<P, V>(tcx: TyCtxt, value: V, upcast_from_P: (from: V, tcx: Interner) => P): Obligation<P>;
    // traits/mod.rs:178 (`impl PolyTraitObligation`)
    polarity(this: PolyTraitObligation): ClausePolarity;
    // traits/mod.rs:182 (`impl PolyTraitObligation`)
    self_ty(this: PolyTraitObligation): Binder<Ty>;
  }
  namespace Obligation {
    // traits/mod.rs:130 (`predicate: impl Upcast<TyCtxt, O>`)
    function new_<O, P>(tcx: TyCtxt, cause: ObligationCause, param_env: ParamEnv, predicate: P, upcast_from_O: (from: P, tcx: Interner) => O): Obligation<O>;
    export { new_ as new };
    // traits/mod.rs:147
    export let with_depth: <O, P>(tcx: TyCtxt, cause: ObligationCause, recursion_depth: number, param_env: ParamEnv, predicate: P, upcast_from_O: (from: P, tcx: Interner) => O) => Obligation<O>;
    // traits/mod.rs:158
    export let misc: <O, P>(tcx: TyCtxt, span: Span, body_def_id: LocalDefId, param_env: ParamEnv, trait_ref: P, upcast_from_O: (from: P, tcx: Interner) => O) => Obligation<O>;
  }
}

declare module "./traits/project.gen.ts" {
  interface Normalized<T> {
    // traits/project.rs:30
    with<U>(value: U): Normalized<U>;
  }
  interface ProjectionCacheStorage {
    // traits/project.rs:127
    with_log(undo_log: InferCtxtUndoLogs): ProjectionCache;
    // traits/project.rs:243 (`impl Rollback<UndoLog> for ProjectionCacheStorage`)
    reverse(undo: ProjectionCacheUndoLog): void;
  }
  namespace ProjectionCacheKey {
    // traits/project.rs:83
    function new_(term: AliasTerm, param_env: ParamEnv): ProjectionCacheKey;
    export { new_ as new };
  }
}

declare module "./traits/project.ts" {
  interface ProjectionCache {
    // traits/project.rs:137
    map(): SnapshotMap<ProjectionCacheKey, ProjectionCacheEntry, import("../vendor/ena/undo_log.ts").UndoLogs<ProjectionCacheUndoLog>>;
    // traits/project.rs:148
    clear(): void;
    // traits/project.rs:155
    try_start(key: ProjectionCacheKey): Result<null, ProjectionCacheEntry>;
    // traits/project.rs:169
    insert_term(key: ProjectionCacheKey, value: NormalizedTerm): void;
    // traits/project.rs:188
    complete(key: ProjectionCacheKey, result: EvaluationResult): void;
    // traits/project.rs:210
    is_complete(key: ProjectionCacheKey): EvaluationResult | undefined;
    // traits/project.rs:221
    ambiguous(key: ProjectionCacheKey): void;
    // traits/project.rs:229
    recur(key: ProjectionCacheKey): void;
    // traits/project.rs:236
    error(key: ProjectionCacheKey): void;
  }
}

// ======================================================================================================================
// Companions (enum methods, PORTING §8) and free fns used by more than one lane
// ======================================================================================================================

/**
 * The enum companions and their methods (stubs in the owning modules until ported); contract.test.ts checks that the
 * modules export these signatures. `self` comes first.
 */
export interface Companions {
  ValuePairs: {
    // infer/mod.rs:408
    ty(self: ValuePairs): [Ty, Ty] | undefined;
  };
  SubregionOrigin: {
    // infer/mod.rs:483
    to_constraint_category(self: SubregionOrigin): unknown;
    // infer/mod.rs:1842
    span(self: SubregionOrigin): Span;
    // infer/mod.rs:1857
    from_obligation_cause(cause: ObligationCause, default_: () => SubregionOrigin): SubregionOrigin;
  };
  RegionVariableOrigin: {
    // infer/mod.rs:1899
    span(self: RegionVariableOrigin): Span;
  };
  FixupError: {
    // infer/mod.rs:569 (`impl Display for FixupError`)
    to_string(self: FixupError): string;
  };
  GenericKind: {
    // infer/region_constraints/mod.rs:806
    to_ty(self: GenericKind, tcx: TyCtxt): Ty;
  };
  VerifyBound: {
    // infer/region_constraints/mod.rs:816
    must_hold(self: VerifyBound): boolean;
    // infer/region_constraints/mod.rs:826
    cannot_hold(self: VerifyBound): boolean;
    // infer/region_constraints/mod.rs:836
    or(self: VerifyBound, vb: VerifyBound): VerifyBound;
  };
  RegionResolutionError: {
    // infer/lexical_region_resolve/mod.rs:116
    origin(self: RegionResolutionError): SubregionOrigin;
  };
  ScrubbedTraitError: {
    // traits/engine.rs:29
    is_true_error(self: ScrubbedTraitError): boolean;
  };
  TraitErrors: {
    // traits/engine.rs:46 (`impl ExactSizeIterator<Item = E>`: an array)
    from_iter<E>(iter: readonly E[]): TraitErrors<E>;
    // traits/engine.rs:51
    has_errors<E>(self: TraitErrors<E>): boolean;
    // traits/engine.rs:56
    no_errors<E>(self: TraitErrors<E>): boolean;
    // traits/engine.rs:61
    as_slice<E>(self: TraitErrors<E>): readonly E[];
    // traits/engine.rs:69
    as_mut_slice<E>(self: TraitErrors<E>): E[];
    // traits/engine.rs:77
    into_thin_vec<E>(self: TraitErrors<E>): E[];
    // traits/engine.rs:85 (`&mut self`: returns the new value, the caller stores it)
    push<E>(self: TraitErrors<E>, err: E): TraitErrors<E>;
    // traits/engine.rs:93
    len<E>(self: TraitErrors<E>): number;
    // traits/engine.rs:106 / :116 (`IntoIterator for TraitErrors` / `&TraitErrors`)
    into_iter<E>(self: TraitErrors<E>): Iterable<E>;
  };
}

/** The pub free fns of the crate (stubs in the owning modules until ported). */
export interface FreeFns {
  // infer/canonical/instantiate.rs:55
  instantiate_value<T>(tcx: TyCtxt, var_values: CanonicalVarValues, value: T, d_T: TypeFoldable<T>): T;
  // infer/canonical/instantiate.rs:24 (`CanonicalExt::instantiate`, extension trait on `Canonical`: a free fn)
  Canonical_instantiate<V>(self: Canonical<V>, tcx: TyCtxt, var_values: CanonicalVarValues, d_V: TypeFoldable<V>): V;
  // infer/canonical/instantiate.rs:37
  Canonical_instantiate_projected<V, T>(self: Canonical<V>, tcx: TyCtxt, var_values: CanonicalVarValues, projection_fn: (_1: V) => T, d_T: TypeFoldable<T>): T;
  // infer/canonical/query_response.rs:617
  make_query_region_constraints(outlives_obligations: TypeOutlivesConstraint[], region_constraints: RegionConstraintData, assumptions: ArgOutlivesClause[]): QueryRegionConstraints;
  // infer/lexical_region_resolve/mod.rs:31
  resolve(region_rels: RegionRelations, var_infos: VarInfos, data: RegionConstraintData): [LexicalRegionResolutions, RegionResolutionError[]];
  // infer/outlives/mod.rs:23
  explicit_outlives_bounds(param_env: ParamEnv): Iterable<OutlivesBound>;
  // infer/outlives/obligations.rs:400
  assumed_type_outlives(tcx: TyCtxt, known_type_outlives: readonly PolyTypeOutlivesClause[], region_bound_pairs: RegionBoundPairs): Clause[];
  // infer/resolve.rs:76
  deeply_resolve_via_region_graph<T>(infcx: InferCtxt, value: T, d_T: TypeFoldable<T>): FixupResult<T>;
  // traits/util.rs:8
  anonymize_predicate(tcx: TyCtxt, pred: Predicate): Predicate;
  // traits/util.rs:111
  transitive_bounds_that_define_assoc_item(tcx: TyCtxt, trait_refs: Iterable<PolyTraitRef>, assoc_name: Ident): Iterable<PolyTraitRef>;
}

/** PORT: types the declarations above name only through these aliases (kept for the import list). */
export type InferDeclsUnused =
  | CanonicalParamEnvCache
  | ImplSource<PredicateObligation>
  | Obligation<PolyTraitClause>
  | Normalized<Ty>
  | MismatchedProjectionTypes
  | ConstVariableValue
  | TypeOutlivesClause
  | Clauses
  | BoundVar
  | Range<number>;
