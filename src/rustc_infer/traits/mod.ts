// Port of compiler/rustc_infer/src/traits/mod.rs (lane infer-opaque-snapshot). `Obligation` and the aliases are
// generated (mod.gen.ts); the methods are assigned onto `Obligation` / `Obligation.prototype` below (declared in
// ../decls.ts). Init order: other rustc_infer modules are read inside function bodies only.
//
// PORT (D4): `T: PartialEq` / `T: Hash` of the `PartialEq` / `Hash` impls are optional trailing descriptors `eq_T` /
// `hash_T` (the decls.ts signatures do not carry them); without one, `T` must be an interned value (`Predicate`,
// `Clause`, ...), compared by identity and hashed by its intern id, as rustc compares and hashes the interned pointer.
// `impl Upcast<TyCtxt, O>` arguments are the value plus `upcast_from_O` (decls.ts).

import { Obligation } from "./mod.gen.ts";

export * from "./mod.gen.ts";

import type { Certainty } from "../../rustc_type_ir/solve/mod.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import type { Result } from "../../std/result.ts";
import type { InferCtxt } from "../decls.ts";
import type { PolyTraitObligation, PredicateObligation } from "./mod.gen.ts";
import { INTERNED, type Interned, hash_Interned } from "../../rustc_data_structures/intern.ts";
import { clone_ObligationCause, type DerivedCause, ObligationCause, type ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { hash_RawList } from "../../rustc_middle/ty/list.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import { type ParamEnv, ParamEnv_eq } from "../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { as_interner, type ClausePolarity, TraitClause } from "../../rustc_type_ir/predicate.ts";
import type { Goal } from "../../rustc_type_ir/solve/mod.ts";
import { unported } from "../../std/panic.ts";
import type { FxHasher } from "../../vendor/rustc_hash/lib.ts";

// `pub use rustc_middle::traits::*;`
export * from "../../rustc_middle/traits/mod.ts";
// `pub use self::engine::{FromSolverError, ScrubbedTraitError, TraitEngine, TraitErrors};`
export { type FromSolverError, ScrubbedTraitError, type TraitEngine, TraitEngine_provided, TraitErrors } from "./engine.ts";
// `pub use self::project::{..}` and `pub(crate) use self::project::UndoLog;`
export {
  type MismatchedProjectionTypes,
  Normalized,
  type NormalizedTerm,
  ProjectionCache,
  ProjectionCacheEntry,
  ProjectionCacheKey,
  ProjectionCacheStorage,
  type UndoLog,
} from "./project.ts";
// `pub mod util;`
export * as util from "./util.ts";
// Manual Debug of `Obligation` (traits/structural_impls.rs).
export { debug_Obligation } from "./structural_impls.ts";

/// A callback that can be provided to `inspect_typeck`. Invoked on evaluation
/// of root obligations.
// rustc-type: compiler/rustc_infer/src/traits/mod.rs:126 ObligationInspector
export type ObligationInspector = (infcx: InferCtxt, obligation: PredicateObligation, result: Result<Certainty, NoSolution>) => void;

// ---- impl<T: Copy> Obligation<T> -------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/mod.rs:63 as_goal
Obligation.prototype.as_goal = function <T>(this: Obligation<T>): Goal<T> {
  return { param_env: this.param_env, predicate: this.predicate };
};

// ---- impl<T: PartialEq> PartialEq for Obligation<T> -----------------------------------------------------------------

// #[inline]
// rustc: compiler/rustc_infer/src/traits/mod.rs:70 eq
Obligation.prototype.eq = function <T>(this: Obligation<T>, other: Obligation<T>, eq_T?: (a: T, b: T) => boolean): boolean {
  // Ignore `cause` and `recursion_depth`. This is a small performance
  // win for a few crates, and a huge performance win for the crate in
  // https://github.com/rust-lang/rustc-perf/pull/1680, which greatly
  // stresses the trait system.
  return ParamEnv_eq(this.param_env, other.param_env) && (eq_T === undefined ? this.predicate === other.predicate : eq_T(this.predicate, other.predicate));
};

// impl<T: Eq> Eq for Obligation<'_, T> {}

// ---- impl<T: Hash> Hash for Obligation<T> ---------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/mod.rs:82 hash
Obligation.prototype.hash = function <T>(this: Obligation<T>, state: FxHasher, hash_T?: (v: T, state: FxHasher) => void): void {
  // See the comment on `Obligation::eq`.
  // `ParamEnv`'s derived `Hash` hashes its interned `caller_bounds` list.
  hash_RawList(this.param_env.caller_bounds_, state);
  if (hash_T !== undefined) {
    hash_T(this.predicate, state);
  } else {
    const p = this.predicate as { readonly [INTERNED]?: true };
    if (p[INTERNED] !== true) unported("rustc_infer::traits::<Obligation as Hash>::hash of a non-interned `T` without `hash_T`");
    hash_Interned(this.predicate as Interned, state);
  }
};

// ---- impl PredicateObligation ----------------------------------------------------------------------------------------

/// Flips the polarity of the inner predicate.
///
/// Given `T: Trait` predicate it returns `T: !Trait` and given `T: !Trait` returns `T: Trait`.
// rustc: compiler/rustc_infer/src/traits/mod.rs:99 flip_polarity
Obligation.prototype.flip_polarity = function (this: PredicateObligation, tcx: TyCtxt): PredicateObligation | undefined {
  const predicate = this.predicate.flip_polarity(tcx);
  if (predicate === undefined) return undefined;
  return new Obligation(clone_ObligationCause(this.cause), this.param_env, predicate, this.recursion_depth);
};

// ---- impl PolyTraitObligation ----------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/mod.rs:110 derived_cause
Obligation.prototype.derived_cause = function (this: PolyTraitObligation, variant: (_1: DerivedCause) => ObligationCauseCode): ObligationCause {
  return clone_ObligationCause(this.cause).derived_cause(this.predicate, variant);
};

// `PredicateObligation` is used a lot. Make sure it doesn't unintentionally get bigger.
// #[cfg(target_pointer_width = "64")]
// rustc_data_structures::static_assert_size!(PredicateObligation<'_>, 48);

// ---- impl<O> Obligation<O> -------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/mod.rs:130 new
(Obligation as unknown as { new: typeof Obligation.new }).new = function <O, P>(
  tcx: TyCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  predicate: P,
  upcast_from_O: (from: P, tcx: Interner) => O,
): Obligation<O> {
  return Obligation.with_depth(tcx, cause, 0, param_env, predicate, upcast_from_O);
};

/// We often create nested obligations without setting the correct depth.
///
/// To deal with this evaluate and fulfill explicitly update the depth
/// of nested obligations using this function.
// rustc: compiler/rustc_infer/src/traits/mod.rs:143 set_depth_from_parent
Obligation.prototype.set_depth_from_parent = function <T>(this: Obligation<T>, parent_depth: number): void {
  this.recursion_depth = Math.max(parent_depth + 1, this.recursion_depth);
};

// rustc: compiler/rustc_infer/src/traits/mod.rs:147 with_depth
Obligation.with_depth = function <O, P>(
  tcx: TyCtxt,
  cause: ObligationCause,
  recursion_depth: number,
  param_env: ParamEnv,
  predicate: P,
  upcast_from_O: (from: P, tcx: Interner) => O,
): Obligation<O> {
  const predicate_ = upcast_from_O(predicate, as_interner(tcx));
  return new Obligation(cause, param_env, predicate_, recursion_depth);
};

// rustc: compiler/rustc_infer/src/traits/mod.rs:158 misc
Obligation.misc = function <O, P>(
  tcx: TyCtxt,
  span: Span,
  body_def_id: LocalDefId,
  param_env: ParamEnv,
  trait_ref: P,
  upcast_from_O: (from: P, tcx: Interner) => O,
): Obligation<O> {
  return Obligation.new(tcx, ObligationCause.misc(span, body_def_id), param_env, trait_ref, upcast_from_O);
};

// rustc: compiler/rustc_infer/src/traits/mod.rs:168 with
Obligation.prototype.with = function <T, P, V>(this: Obligation<T>, tcx: TyCtxt, value: V, upcast_from_P: (from: V, tcx: Interner) => P): Obligation<P> {
  return Obligation.with_depth(tcx, clone_ObligationCause(this.cause), this.recursion_depth, this.param_env, value, upcast_from_P);
};

// ---- impl PolyTraitObligation ----------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/traits/mod.rs:178 polarity
Obligation.prototype.polarity = function (this: PolyTraitObligation): ClausePolarity {
  return Binder.skip_binder(this.predicate).polarity;
};

// rustc: compiler/rustc_infer/src/traits/mod.rs:182 self_ty
Obligation.prototype.self_ty = function (this: PolyTraitObligation): Binder<Ty> {
  return Binder.map_bound(this.predicate, (p) => TraitClause.self_ty(p));
};
