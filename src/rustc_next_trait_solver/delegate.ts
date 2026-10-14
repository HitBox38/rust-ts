// Port of compiler/rustc_next_trait_solver/src/delegate.rs (lane evalctxt-contract): the `SolverDelegate` trait.
//
// PORT (D3): `I: Interner` is erased (rustc_type_ir/interner.ts header): `Self::Interner` is rustc_middle's `TyCtxt`
// and `<Self::Interner as Interner>::X` is the concrete rustc_middle type.
// PORT: `trait SolverDelegate: Deref<Target = Self::Infcx>` is the interface `SolverDelegate`. Required methods carry
// their markers in the interface; provided methods live in `SolverDelegate_provided` (PORTING §8) and the interface
// keeps `(provided)` placeholders. The `Deref` supertrait is the explicit method `deref()` (rustc_errors `Diag`
// precedent): an auto-deref call `self.delegate.shallow_resolve(ty)` is `this.delegate.deref().shallow_resolve(ty)`.
// The one upstream impl (rustc_trait_selection solve/delegate.rs, `struct SolverDelegate<'tcx>(InferCtxt<'tcx>)`)
// returns its `.0`.
// PORT: the associated fn `build_with_canonical` (no `self`) is the separate interface `SolverDelegate_static`
// (inherent.ts's `<Trait>_static` convention). Code generic over `D` that has no `D` value takes the static table
// first (`EvalCtxt.enter_canonical(D, ..)`, tyir-solve's `SearchGraph.new(D, ..)`); code that holds a `&D` reaches it
// through the delegate's `Self` member. `SolverDelegate_static` also carries the `Default` impl of the associated type
// `<D::Infcx as InferCtxtLike>::OpaqueTypeStorageEntries` (`EvalCtxt::enter_root` builds one with
// `Default::default()`).
// PORT (D4): generic methods over `V: TypeFoldable<I>` take the descriptor `d_V` last. The `E: Debug` bound of
// `evaluate_const` is erased: only tracing (not ported) formats `E`.
import type { DefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ParamEnv } from "../rustc_middle/ty/decls.ts";
import type { GenericArg, GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { Term, Ty } from "../rustc_middle/ty/mod.ts";
import type { Predicate } from "../rustc_middle/ty/predicate.ts";
import { type Canonical, type CanonicalQueryInput, type CanonicalVarValues, CanonicalizerState } from "../rustc_type_ir/canonical.ts";
import type { AliasConst, CanonicalVarKind, TraitRef, UniverseIndex } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike, InferCtxtLike_OpaqueTypeStorageEntries } from "../rustc_type_ir/infer_ctxt.ts";
import type { RegionConstraint } from "../rustc_type_ir/predicate.ts";
import type {
  Certainty,
  ComputeGoalFastPathOutcome,
  FetchEligibleAssocItemResponse,
  Goal,
  NoSolution,
  VisibleForLeakCheck,
} from "../rustc_type_ir/solve/mod.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import type { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { Result } from "../std/result.ts";

/// `SolverDelegate` is one of the two traits in the `rustc_type_ir` shared abstraction layer
/// between rustc and rust-analyzer abstracting over the [InferCtxt][inferctxt-doc], which had to be
/// split due to coherence reasons:
/// - `SolverDelegate` contains the parts depending on trait-solving logic, to provide functionality
///   in `rustc_trait_selection`, and is implemented by a [simple wrapper over
///   `InferCtxt`][inferctxt-wrapper-doc] there,
/// - [InferCtxtLike] contains the other parts, and is implemented [directly on
///   `InferCtxt`][inferctxtlike-impl-doc].
///
/// More information can also be found in the dedicated chapter in the dev-guide, in [this
/// section][dev-guide].
///
/// [inferctxt-doc]: https://doc.rust-lang.org/nightly/nightly-rustc/rustc_infer/infer/struct.InferCtxt.html
/// [inferctxt-wrapper-doc]: https://doc.rust-lang.org/nightly/nightly-rustc/rustc_trait_selection/solve/delegate/struct.SolverDelegate.html
/// [inferctxtlike-impl-doc]: https://doc.rust-lang.org/nightly/nightly-rustc/rustc_infer/infer/struct.InferCtxt.html#impl-InferCtxtLike-for-InferCtxt%3C'tcx%3E
/// [dev-guide]: https://rustc-dev-guide.rust-lang.org/solve/sharing-crates-with-rust-analyzer.html#trait-inferctxtlike-and-trait-solverdelegate
// rustc-trait: compiler/rustc_next_trait_solver/src/delegate.rs:26 SolverDelegate
export interface SolverDelegate {
  /** PORT: the `Deref<Target = Self::Infcx>` supertrait (header). `type Infcx: InferCtxtLike<Interner = Self::Interner>`. */
  deref(): InferCtxtLike;
  /** PORT: the impl's associated fns (`D::build_with_canonical`) for code that holds a `&D` (header). */
  readonly Self: SolverDelegate_static;

  // (provided) delegate.rs:29 cx -> SolverDelegate_provided.cx
  cx(): TyCtxt;

  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:40 compute_goal_fast_path
  compute_goal_fast_path(goal: Goal<Predicate>, span: Span): ComputeGoalFastPathOutcome;

  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:46 fresh_var_for_kind
  fresh_var_for_kind(arg: GenericArg, span: Span, universe: UniverseIndex): GenericArg;

  // FIXME: Uplift the leak check into this crate.
  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:54 leak_check
  leak_check(max_input_universe: UniverseIndex): Result<undefined, NoSolution>;

  /// Evaluate a const, normalizing the type of the resulting value with `normalize_ty`.
  /// Returns `Ok(None)` if the const is too generic, and `Err(_)` only if `normalize_ty`
  /// failed.
  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:59 evaluate_const
  evaluate_const<E>(
    param_env: ParamEnv,
    alias_const: AliasConst,
    normalize_ty: (ty: Unnormalized<Ty>) => Result<Ty, E>,
  ): Result<Const | undefined, E>;

  // FIXME: This only is here because `wf::obligations` is in `rustc_trait_selection`!
  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:69 well_formed_goals
  well_formed_goals(param_env: ParamEnv, term: Term): Goal<Predicate>[] | undefined;

  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:75 make_deduplicated_region_constraints
  make_deduplicated_region_constraints(): [RegionConstraint, VisibleForLeakCheck][];

  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:79 instantiate_canonical
  instantiate_canonical<V>(canonical: Canonical<V>, values: CanonicalVarValues, d_V: TypeFoldable<V>): V;

  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:87 instantiate_canonical_var
  instantiate_canonical_var(
    kind: CanonicalVarKind,
    span: Span,
    var_values: readonly GenericArg[],
    universe_map: (u: UniverseIndex) => UniverseIndex,
  ): GenericArg;

  // PORT: `goals: &mut Vec<..>` is pushed to in place.
  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:95 add_item_bounds_for_hidden_type
  add_item_bounds_for_hidden_type(
    def_id: DefId,
    args: GenericArgs,
    param_env: ParamEnv,
    hidden_ty: Ty,
    goals: Goal<Predicate>[],
  ): void;

  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:104 fetch_eligible_assoc_item
  fetch_eligible_assoc_item(
    goal_trait_ref: TraitRef,
    trait_assoc_def_id: DefId,
    impl_def_id: DefId,
  ): FetchEligibleAssocItemResponse;

  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:111 is_transmutable
  is_transmutable(src: Ty, dst: Ty, assume: Const): Result<Certainty, NoSolution>;

  /// Obtain canonicalizer state, either by allocating it afresh (the default) or by reusing
  /// previously allocated state.
  // (provided) delegate.rs:120 obtain_canonicalizer_state -> SolverDelegate_provided.obtain_canonicalizer_state
  obtain_canonicalizer_state(): CanonicalizerState;

  /// Release canonicalizer state, either by deallocating it (the default) or by clearing it and
  /// stashing it for later reuse.
  // (provided) delegate.rs:126 release_canonicalizer_state -> SolverDelegate_provided.release_canonicalizer_state
  release_canonicalizer_state(state: CanonicalizerState): void;

  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:128 emit_next_solver_overflow_fcw
  emit_next_solver_overflow_fcw(goal: Goal<Predicate>, span: Span): void;
}

/** The associated fns of a `SolverDelegate` impl (header). */
export interface SolverDelegate_static {
  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:33 build_with_canonical
  build_with_canonical<V>(
    cx: TyCtxt,
    canonical: CanonicalQueryInput<V>,
    d_V: TypeFoldable<V>,
  ): [SolverDelegate, V, CanonicalVarValues];

  /** PORT: `Default::default()` of `<D::Infcx as InferCtxtLike>::OpaqueTypeStorageEntries` (header). */
  OpaqueTypeStorageEntries_default(): InferCtxtLike_OpaqueTypeStorageEntries;
}

/** PORT: the provided methods of `SolverDelegate` (PORTING §8). An impl forwards the ones it does not override. */
export const SolverDelegate_provided = {
  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:29 cx
  cx(self: SolverDelegate): TyCtxt {
    return self.deref().cx();
  },

  /// Obtain canonicalizer state, either by allocating it afresh (the default) or by reusing
  /// previously allocated state.
  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:120 obtain_canonicalizer_state
  obtain_canonicalizer_state(_self: SolverDelegate): CanonicalizerState {
    return CanonicalizerState.default_();
  },

  /// Release canonicalizer state, either by deallocating it (the default) or by clearing it and
  /// stashing it for later reuse.
  // rustc: compiler/rustc_next_trait_solver/src/delegate.rs:126 release_canonicalizer_state
  release_canonicalizer_state(_self: SolverDelegate, _: CanonicalizerState): void {},
};
