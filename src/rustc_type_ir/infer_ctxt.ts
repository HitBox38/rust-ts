// Port of compiler/rustc_type_ir/src/infer_ctxt.rs (lane tyir-misc, sub-lane infer). The types with their derived
// Debug / TypeVisitable / TypeFoldable impls are generated into infer_ctxt.gen.ts (set rustc_ty of tools/codegen/types.ts).
//
// PORT: the 8 trait methods whose name rustc_infer's `InferCtxt` also uses for an inherent method with another signature are
// `ir_<name>` (lane infcx-contract; as `Interner`'s `ir_` methods on `TyCtxt`): `ir_get_solver_region_constraint`,
// `ir_overwrite_solver_region_constraint`, `ir_universe_of_region`, `ir_fresh_args_for_item`, `ir_sub_regions`,
// `ir_equate_regions`, `ir_register_solver_region_constraint`, `ir_register_hidden_type_in_storage`.
// PORT (D3): `I: Interner` is erased; `Self::Interner` is `TyCtxt` (as in fold.ts's `TypeFolder::cx`), the associated
// types are fixed as in the interner.ts header. `trait InferCtxtLike` is the TS interface `InferCtxtLike`, implemented by
// rustc_infer's `InferCtxt` (lane infcx-contract); its provided methods live in `InferCtxtLike_provided` (PORTING §8).
// PORT: the methods of the generated `TypingMode` / `TypingModeEqWrapper` live on same-named companion consts that
// spread the generated ones and take `self` first (tyir-kind decision 1).
// PORT: fns of other files that are not ported yet are module-local stand-ins at the end of this file (each with a
// `// PORT: stand-in` comment); they call `unported`.
import { inherent_Features, type TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefIds, ParamEnv } from "../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { type Clauses, RawList } from "../rustc_middle/ty/list.ts";
import { fold_with_Ty, type Ty } from "../rustc_middle/ty/mod.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { assert, panic, unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { FxHasher } from "../vendor/rustc_hash/lib.ts";
import { Binder } from "./binder.ts";
import { DelayedMap } from "./data_structures/mod.ts";
import type { OpaqueTypeStorageEntries } from "./inherent.ts";
import type { Interner } from "./interner.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "./fold.ts";
import type { PredicateEmittingRelation } from "./relate/combine.ts";
import { TypeVisitableExt } from "./visit.ts";
import * as gen from "./infer_ctxt.gen.ts";
import type { UniverseIndex, Variance } from "./lib.ts";
import type { OpaqueTypeKey } from "./opaque_ty.ts";
import type { Assumptions, RegionConstraint } from "./region_constraint.ts";
import type { RelateResult } from "./relate.ts";
import type { RegionVid } from "./region_kind.ts";
import type { ConstVid } from "./const_kind.ts";
import type { TyOrConstInferVar, VisibleForLeakCheck } from "./solve/mod.ts";
import { fold_Const, type Const } from "./sty/consts.ts";
import type { Region } from "./sty/mod.ts";
import type { OpaqueAliasTy } from "./ty/alias.ts";
import { type FloatVarValue, type FloatVid, type IntVarValue, type IntVid, type TyVid } from "./ty_kind.ts";
import { fold_Clauses, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";

export * from "./infer_ctxt.gen.ts";

// PORT: `mod private { pub trait Sealed }` and `pub trait TypingModeErasedStatus` (infer_ctxt.rs:19-37) are marker
// traits (erased, PORTING §5); `S: TypingModeErasedStatus` is the type parameter `S` of `TypingMode<S>`.

export type CantBeErased = gen.CantBeErased;
export type MayBeErased = gen.MayBeErased;
/** PORT: the value of the unit struct `MayBeErased`. */
export const MayBeErased: MayBeErased = Object.freeze({});

// ---- TypingMode / TypingModeEqWrapper ------------------------------------------------------------------------------

export type TypingModeEqWrapper = gen.TypingModeEqWrapper;
export const TypingModeEqWrapper = {
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:179 hash
  hash(self: TypingModeEqWrapper, state: Pick<FxHasher, "write_isize" | "write_usize">): void {
    hash_TypingMode(self._0, state);
  },
};

/**
 * PORT: `#[derive_where(Hash)]` of `TypingMode` (infer_ctxt.rs:65), spelled out for `TypingModeEqWrapper::hash` (as
 * `hash_FileName` in rustc_span): `mem::discriminant(self)` hashes the variant index as an `isize`, then the fields;
 * `I::LocalDefIds` (`&List`) hashes its address upstream, here its intern `id` (as `hash_Interned`); the unit struct
 * `MayBeErased` hashes nothing.
 */
export function hash_TypingMode<S>(self: gen.TypingMode<S>, state: Pick<FxHasher, "write_isize" | "write_usize">): void {
  switch (self.$) {
    case "Coherence":
      state.write_isize(0);
      return;
    case "Typeck":
      state.write_isize(1);
      state.write_usize(self.defining_opaque_types_and_generators.id);
      return;
    case "PostTypeckUntilBorrowck":
      state.write_isize(2);
      state.write_usize(self.defining_opaque_types.id);
      return;
    case "PostBorrowck":
      state.write_isize(3);
      state.write_usize(self.defined_opaque_types.id);
      return;
    case "Reflection":
      state.write_isize(4);
      return;
    case "PostAnalysis":
      state.write_isize(5);
      return;
    case "Codegen":
      state.write_isize(6);
      return;
    case "ErasedNotCoherence":
      state.write_isize(7);
      return;
  }
}

/** `impl PartialEq for TypingModeEqWrapper` (`Eq` too). */
// rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:185 eq
export function TypingModeEqWrapper_eq(self: TypingModeEqWrapper, other: TypingModeEqWrapper): boolean {
  const a = self._0;
  const b = other._0;
  if (a.$ === "Coherence" && b.$ === "Coherence") {
    return true;
  } else if (a.$ === "Reflection" && b.$ === "Reflection") {
    return true;
  } else if (a.$ === "Typeck" && b.$ === "Typeck") {
    return a.defining_opaque_types_and_generators === b.defining_opaque_types_and_generators;
  } else if (a.$ === "PostTypeckUntilBorrowck" && b.$ === "PostTypeckUntilBorrowck") {
    return a.defining_opaque_types === b.defining_opaque_types;
  } else if (a.$ === "PostBorrowck" && b.$ === "PostBorrowck") {
    return a.defined_opaque_types === b.defined_opaque_types;
  } else if (a.$ === "PostAnalysis" && b.$ === "PostAnalysis") {
    return true;
  } else if (a.$ === "Codegen" && b.$ === "Codegen") {
    return true;
  } else if (a.$ === "ErasedNotCoherence" && b.$ === "ErasedNotCoherence") {
    return true;
  } else {
    return false;
  }
}

export type TypingMode<S = MayBeErased> = gen.TypingMode<S>;
export const TypingMode = {
  ...gen.TypingMode,

  // ---- impl<I, S: TypingModeErasedStatus> TypingMode<I, S> ----

  /// There are a bunch of places in the compiler where we single out `Coherence`,
  /// and alter behavior. We'd like to *always* match on `TypingMode` exhaustively,
  /// but not having this method leads to a bunch of noisy code.
  ///
  /// See also the documentation on [`TypingMode`] about exhaustive matching.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:230 is_coherence
  is_coherence<S>(self: TypingMode<S>): boolean {
    switch (self.$) {
      case "Coherence":
        return true;
      case "Typeck":
      case "PostTypeckUntilBorrowck":
      case "Reflection":
      case "PostBorrowck":
      case "PostAnalysis":
      case "Codegen":
      case "ErasedNotCoherence":
        return false;
    }
  },

  /// There are a bunch of places in the compiler where we single out `Reflection`,
  /// and alter behavior. We'd like to *always* match on `TypingMode` exhaustively,
  /// but not having this method leads to a bunch of noisy code.
  ///
  /// See also the documentation on [`TypingMode`] about exhaustive matching.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:248 is_reflection
  is_reflection<S>(self: TypingMode<S>): boolean {
    switch (self.$) {
      case "Reflection":
        return true;
      case "Typeck":
      case "PostTypeckUntilBorrowck":
      case "Coherence":
      case "PostBorrowck":
      case "PostAnalysis":
      case "Codegen":
      case "ErasedNotCoherence":
        return false;
    }
  },

  /// There are a bunch of places in the trait solver where we single out `Coherence`,
  /// and alter behavior. We'd like to *always* match on `TypingMode` exhaustively,
  /// but not having this method leads to a bunch of noisy code.
  ///
  /// See also the documentation on [`TypingMode`] about exhaustive matching.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:266 is_erased_not_coherence
  is_erased_not_coherence<S>(self: TypingMode<S>): boolean {
    switch (self.$) {
      case "ErasedNotCoherence":
        return true;
      case "Coherence":
      case "Typeck":
      case "PostTypeckUntilBorrowck":
      case "Reflection":
      case "PostBorrowck":
      case "PostAnalysis":
      case "Codegen":
        return false;
    }
  },

  // ---- impl<I> TypingMode<I, MayBeErased> ----

  /// Only call this when you're sure you're outside the next trait solver!
  /// That means either not in the trait solver, or in code that is old-solver only.
  ///
  /// See the comment on `InferCtxt::typing_mode_raw`
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:285 assert_not_erased
  assert_not_erased(self: TypingMode<MayBeErased>): TypingMode<CantBeErased> {
    switch (self.$) {
      case "Coherence":
        return TypingMode.Coherence;
      case "Typeck": {
        const defining_opaque_types_and_generators = self.defining_opaque_types_and_generators;
        return { $: "Typeck", defining_opaque_types_and_generators };
      }
      case "PostTypeckUntilBorrowck": {
        const defining_opaque_types = self.defining_opaque_types;
        return { $: "PostTypeckUntilBorrowck", defining_opaque_types };
      }
      case "PostBorrowck": {
        const defined_opaque_types = self.defined_opaque_types;
        return { $: "PostBorrowck", defined_opaque_types };
      }
      case "PostAnalysis":
        return TypingMode.PostAnalysis;
      case "Codegen":
        return TypingMode.Codegen;
      case "Reflection":
        return TypingMode.Reflection;
      case "ErasedNotCoherence":
        return panic(
          "Called `assert_not_erased` from a place that can be called by the trait solver in `TypingMode::ErasedNotCoherence`. `TypingMode` is `ErasedNotCoherence` in a place where that should be impossible",
        );
    }
  },

  // ---- impl<I> TypingMode<I, CantBeErased> ----
  // PORT: these associated fns return `TypingMode<I>` (= `TypingMode<I, MayBeErased>`); they are called as
  // `TypingMode.non_body_analysis()` (the `S` of the impl only selects the impl block).

  /// Analysis outside of a body does not define any opaque types.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:309 non_body_analysis
  non_body_analysis(): TypingMode {
    // PORT: `Default::default()` of `I::LocalDefIds` (`&List<LocalDefId>`) is `List::empty()`.
    return { $: "Typeck", defining_opaque_types_and_generators: RawList.empty<LocalDefId>() };
  },

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:313 typeck_for_body
  typeck_for_body(cx: Interner, body_def_id: LocalDefId): TypingMode {
    return {
      $: "Typeck",
      defining_opaque_types_and_generators: cx.opaque_types_and_coroutines_defined_by(body_def_id),
    };
  },

  /// While typechecking a body, we need to be able to define the opaque
  /// types defined by that body.
  ///
  /// FIXME: This will be removed because it's generally not correct to define
  /// opaques outside of HIR typeck.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:325 analysis_in_body
  analysis_in_body(cx: Interner, body_def_id: LocalDefId): TypingMode {
    return {
      $: "Typeck",
      defining_opaque_types_and_generators: cx.opaque_types_defined_by(body_def_id),
    };
  },

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:331 borrowck
  borrowck(cx: Interner, body_def_id: LocalDefId): TypingMode {
    const defining_opaque_types = cx.opaque_types_defined_by(body_def_id);
    if (defining_opaque_types.length === 0) {
      return TypingMode.non_body_analysis();
    } else {
      return { $: "PostTypeckUntilBorrowck", defining_opaque_types };
    }
  },

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:340 post_borrowck_analysis
  post_borrowck_analysis(cx: Interner, body_def_id: LocalDefId): TypingMode {
    const defined_opaque_types = cx.opaque_types_defined_by(body_def_id);
    if (defined_opaque_types.length === 0) {
      return TypingMode.non_body_analysis();
    } else {
      return { $: "PostBorrowck", defined_opaque_types };
    }
  },

  /** `impl From<TypingMode<I, CantBeErased>> for TypingMode<I, MayBeErased>`. */
  // PORT: named after the source type `TypingMode<I, CantBeErased>`.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:351 from
  from_TypingMode(value: TypingMode<CantBeErased>): TypingMode<MayBeErased> {
    switch (value.$) {
      case "Coherence":
        return TypingMode.Coherence;
      case "Typeck": {
        const defining_opaque_types_and_generators = value.defining_opaque_types_and_generators;
        return { $: "Typeck", defining_opaque_types_and_generators };
      }
      case "PostTypeckUntilBorrowck": {
        const defining_opaque_types = value.defining_opaque_types;
        return { $: "PostTypeckUntilBorrowck", defining_opaque_types };
      }
      case "PostBorrowck": {
        const defined_opaque_types = value.defined_opaque_types;
        return { $: "PostBorrowck", defined_opaque_types };
      }
      case "PostAnalysis":
        return TypingMode.PostAnalysis;
      case "Codegen":
        return TypingMode.Codegen;
      case "Reflection":
        return TypingMode.Reflection;
      case "ErasedNotCoherence":
        // PORT: `CantBeErased` is uninhabited: upstream's match has no such arm.
        return value._0;
    }
  },
};

// ---- InferCtxtLike -------------------------------------------------------------------------------------------------

/**
 * PORT: `type OpaqueTypeStorageEntries: inherent::OpaqueTypeStorageEntries` of `InferCtxtLike`: typed by its trait
 * (inherent.ts); its one impl is rustc_infer's `OpaqueTypeStorageEntries` (lane infcx-contract).
 */
export type InferCtxtLike_OpaqueTypeStorageEntries = OpaqueTypeStorageEntries;

/**
 * PORT: `std::range::RangeInclusive<T>` (the new range type: fields `start` and `last`, both inclusive).
 */
export interface RangeInclusive<T> {
  start: T;
  last: T;
}

/// `InferCtxtLike` is one of the two traits abstracting over the [InferCtxt][inferctxt-doc], which
/// had to be split due to coherence reasons:
/// - `InferCtxtLike`] contains the parts that have to live in `rustc_infer`, and thus aren't only
///   about trait-solving. It is implemented [directly on `InferCtxt`][inferctxtlike-impl-doc],
/// - [SolverDelegate][solverdelegate-doc] contains the parts depending on trait-solving logic, to
///   provide functionality in `rustc_trait_selection`, and is implemented by a [simple wrapper over
///   `InferCtxt`][inferctxt-wrapper-doc] there.
///
/// More information can also be found in the dedicated chapter in the dev-guide, in [this
/// section][dev-guide].
///
/// [inferctxt-doc]: https://doc.rust-lang.org/nightly/nightly-rustc/rustc_infer/infer/struct.InferCtxt.html
/// [inferctxtlike-impl-doc]: https://doc.rust-lang.org/nightly/nightly-rustc/rustc_infer/infer/struct.InferCtxt.html#impl-InferCtxtLike-for-InferCtxt%3C'tcx%3E
/// [solverdelegate-doc]: https://doc.rust-lang.org/nightly/nightly-rustc/rustc_next_trait_solver/delegate/trait.SolverDelegate.html
/// [inferctxt-wrapper-doc]: https://doc.rust-lang.org/nightly/nightly-rustc/rustc_trait_selection/solve/delegate/struct.SolverDelegate.html
/// [dev-guide]: https://rustc-dev-guide.rust-lang.org/solve/sharing-crates-with-rust-analyzer.html#trait-inferctxtlike-and-trait-solverdelegate
// PORT: generic methods over `T: TypeFoldable<I>` take the D4 descriptor last; `R: PredicateEmittingRelation<Self>`
// takes the relation object (`PredicateEmittingRelation`, relate/combine.rs, lane tyir-relate).
// rustc-trait: compiler/rustc_type_ir/src/infer_ctxt.rs:387 InferCtxtLike
export interface InferCtxtLike {
  // PORT: `type Interner: Interner` is `TyCtxt` (D3).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:389 cx
  cx(): TyCtxt;

  /// Whether the new trait solver is enabled. This only exists because rustc
  /// shares code between the new and old trait solvers; for all other users,
  /// this should always be true. If this is unknowingly false and you try to
  /// use the new trait solver, things will break badly.
  // (provided) infer_ctxt.rs:395 next_trait_solver -> InferCtxtLike_provided.next_trait_solver
  next_trait_solver(): boolean;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:399 enable_next_solver_overflow_fcw
  enable_next_solver_overflow_fcw(): boolean;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:401 disable_trait_solver_fast_paths
  disable_trait_solver_fast_paths(): boolean;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:403 typing_mode_raw
  typing_mode_raw(): TypingMode;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:405 universe
  universe(): UniverseIndex;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:406 create_next_universe
  create_next_universe(): UniverseIndex;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:408 insert_placeholder_assumptions
  insert_placeholder_assumptions(u: UniverseIndex, assumptions: Assumptions): void;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:413 get_placeholder_assumptions
  get_placeholder_assumptions(u: UniverseIndex): Assumptions;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:417 has_placeholder_assumptions
  has_placeholder_assumptions(range: RangeInclusive<UniverseIndex>): boolean;
  // PORT: `ir_get_solver_region_constraint`: rustc_infer's `InferCtxt` has an inherent `get_solver_region_constraint` with another signature (infcx-contract).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:418 get_solver_region_constraint
  ir_get_solver_region_constraint(): RegionConstraint;
  // PORT: `ir_overwrite_solver_region_constraint`: rustc_infer's `InferCtxt` has an inherent `overwrite_solver_region_constraint` with another signature (infcx-contract).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:421 overwrite_solver_region_constraint
  ir_overwrite_solver_region_constraint(constraint: RegionConstraint, span: Span): void;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:427 universe_of_ty
  universe_of_ty(ty: TyVid): UniverseIndex | undefined;
  // PORT: `ir_universe_of_region`: rustc_infer's `InferCtxt` has an inherent `universe_of_region` with another signature (infcx-contract).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:428 universe_of_region
  ir_universe_of_region(lt: RegionVid): UniverseIndex | undefined;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:429 universe_of_const
  universe_of_const(ct: ConstVid): UniverseIndex | undefined;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:431 root_ty_var
  root_ty_var(var_: TyVid): TyVid;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:432 sub_unification_table_root_var
  sub_unification_table_root_var(var_: TyVid): TyVid;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:433 is_sub_unification_table_root_var
  is_sub_unification_table_root_var(var_: TyVid): boolean;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:434 root_const_var
  root_const_var(var_: ConstVid): ConstVid;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:436 shallow_resolve_ty_var
  shallow_resolve_ty_var(vid: TyVid): Ty;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:437 shallow_resolve_int_var
  shallow_resolve_int_var(vid: IntVid): Ty;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:438 shallow_resolve_float_var
  shallow_resolve_float_var(vid: FloatVid): Ty;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:439 shallow_resolve_const_var
  shallow_resolve_const_var(vid: ConstVid): Const;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:440 shallow_resolve_region_var
  shallow_resolve_region_var(vid: RegionVid): Region;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:442 ty_or_const_infer_var_changed
  ty_or_const_infer_var_changed(var_: TyOrConstInferVar): boolean;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:444 next_region_infer
  next_region_infer(): Region;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:445 next_ty_infer
  next_ty_infer(): Ty;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:446 next_const_infer
  next_const_infer(): Const;
  // PORT: `ir_fresh_args_for_item`: rustc_infer's `InferCtxt` has an inherent `fresh_args_for_item` with another signature (infcx-contract).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:447 fresh_args_for_item
  ir_fresh_args_for_item(def_id: DefId): GenericArgs;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:452 instantiate_binder_with_infer
  instantiate_binder_with_infer<T>(value: Binder<T>, d_T: TypeFoldable<T>): T;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:457 enter_forall_without_assumptions
  enter_forall_without_assumptions<T, U>(value: Binder<T>, f: (value: T) => U, d_T: TypeFoldable<T>): U;

  /// FIXME(-Zassumptions-on-binders): Any usage of this method is likely wrong
  /// and should be replaced in the long term by actually taking assumptions into
  /// account.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:466 enter_forall_with_empty_assumptions
  enter_forall_with_empty_assumptions<T, U>(value: Binder<T>, f: (value: T) => U, d_T: TypeFoldable<T>): U;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:472 equate_ty_vids_raw
  equate_ty_vids_raw(a: TyVid, b: TyVid): void;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:473 sub_unify_ty_vids_raw
  sub_unify_ty_vids_raw(a: TyVid, b: TyVid): void;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:474 equate_int_vids_raw
  equate_int_vids_raw(a: IntVid, b: IntVid): void;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:475 equate_float_vids_raw
  equate_float_vids_raw(a: FloatVid, b: FloatVid): void;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:476 equate_const_vids_raw
  equate_const_vids_raw(a: ConstVid, b: ConstVid): void;

  /// Use `instantiate_ty_var` instead unless you have reasons to skip
  /// generalization.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:480 instantiate_ty_var_raw
  instantiate_ty_var_raw(vid: TyVid, ty: Ty): void;
  /// Use `instantiate_const_var` instead unless you have reasons to skip
  /// generalization.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:483 instantiate_const_var_raw
  instantiate_const_var_raw(vid: ConstVid, ct: Const): void;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:484 instantiate_ty_var
  instantiate_ty_var(
    relation: PredicateEmittingRelation,
    target_is_expected: boolean,
    target_vid: TyVid,
    instantiation_variance: Variance,
    source_ty: Ty,
  ): RelateResult<null>;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:492 instantiate_int_var_raw
  instantiate_int_var_raw(vid: IntVid, value: IntVarValue): void;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:493 instantiate_float_var_raw
  instantiate_float_var_raw(vid: FloatVid, value: FloatVarValue): void;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:494 instantiate_const_var
  instantiate_const_var(
    relation: PredicateEmittingRelation,
    target_is_expected: boolean,
    target_vid: ConstVid,
    source_ct: Const,
  ): RelateResult<null>;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:502 set_tainted_by_errors
  set_tainted_by_errors(e: ErrorGuaranteed): void;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:504 shallow_resolve
  shallow_resolve(ty: Ty): Ty;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:508 shallow_resolve_const
  shallow_resolve_const(ty: Const): Const;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:510 deeply_resolve_ignoring_regions
  deeply_resolve_ignoring_regions<T>(value: T, d_T: TypeFoldable<T>): T;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:514 probe
  probe<T>(probe: () => T): T;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:516 commit_if_ok
  commit_if_ok<T, E>(f: () => Result<T, E>): Result<T, E>;

  // PORT: `ir_sub_regions`: rustc_infer's `InferCtxt` has an inherent `sub_regions` with another signature (infcx-contract).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:518 sub_regions
  ir_sub_regions(sub: Region, sup: Region, vis: VisibleForLeakCheck, span: Span): void;

  // PORT: `ir_equate_regions`: rustc_infer's `InferCtxt` has an inherent `equate_regions` with another signature (infcx-contract).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:526 equate_regions
  ir_equate_regions(a: Region, b: Region, vis: VisibleForLeakCheck, span: Span): void;

  // PORT: `ir_register_solver_region_constraint`: rustc_infer's `InferCtxt` has an inherent `register_solver_region_constraint` with another signature (infcx-contract).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:534 register_solver_region_constraint
  ir_register_solver_region_constraint(c: RegionConstraint, span: Span): void;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:540 register_ty_outlives
  register_ty_outlives(ty: Ty, r: Region, span: Span): void;

  // PORT: `type OpaqueTypeStorageEntries` is `InferCtxtLike_OpaqueTypeStorageEntries` (above).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:548 opaque_types_storage_num_entries
  opaque_types_storage_num_entries(): InferCtxtLike_OpaqueTypeStorageEntries;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:549 clone_opaque_types_lookup_table
  clone_opaque_types_lookup_table(): [OpaqueTypeKey, Ty][];
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:552 clone_duplicate_opaque_types
  clone_duplicate_opaque_types(): [OpaqueTypeKey, Ty][];
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:555 clone_opaque_types_added_since
  clone_opaque_types_added_since(prev_entries: InferCtxtLike_OpaqueTypeStorageEntries): [OpaqueTypeKey, Ty][];
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:559 opaques_with_sub_unified_hidden_type
  opaques_with_sub_unified_hidden_type(ty: TyVid): OpaqueAliasTy[];

  // PORT: `ir_register_hidden_type_in_storage`: rustc_infer's `InferCtxt` has an inherent `register_hidden_type_in_storage` with another signature (infcx-contract).
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:564 register_hidden_type_in_storage
  ir_register_hidden_type_in_storage(opaque_type_key: OpaqueTypeKey, hidden_ty: Ty, span: Span): Ty | undefined;
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:570 add_duplicate_opaque_type
  add_duplicate_opaque_type(opaque_type_key: OpaqueTypeKey, hidden_ty: Ty, span: Span): void;

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:577 reset_opaque_types
  reset_opaque_types(): void;

  /// Where possible, replaces type/const/region variables in `value` with their final value.
  /// If a type/const/region variable has not (yet) been unified, it is left as is.
  ///
  /// This is an idempotent operation that does not affect inference state in any way,
  /// which means it's safe to call this function at will.
  // (provided) infer_ctxt.rs:584 deeply_resolve_via_unification_table -> InferCtxtLike_provided.deeply_resolve_via_unification_table
  deeply_resolve_via_unification_table<T>(value: T, d_T: TypeFoldable<T>): T;
}

/** PORT: the provided methods of `InferCtxtLike` (PORTING §8); an implementor assigns them. */
export const InferCtxtLike_provided = {
  /// Whether the new trait solver is enabled. This only exists because rustc
  /// shares code between the new and old trait solvers; for all other users,
  /// this should always be true. If this is unknowingly false and you try to
  /// use the new trait solver, things will break badly.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:395 next_trait_solver
  next_trait_solver(_self: InferCtxtLike): boolean {
    return true;
  },

  /// Where possible, replaces type/const/region variables in `value` with their final value.
  /// If a type/const/region variable has not (yet) been unified, it is left as is.
  ///
  /// This is an idempotent operation that does not affect inference state in any way,
  /// which means it's safe to call this function at will.
  // PORT: D4 descriptor `d_T`.
  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:584 deeply_resolve_via_unification_table
  deeply_resolve_via_unification_table<T>(self: InferCtxtLike, value: T, d_T: TypeFoldable<T>): T {
    if (TypeVisitableExt.has_infer(value, d_T)) {
      const folder = DeepVariableResolver.new(self);
      return d_T.fold_with(value, folder);
    } else {
      return value;
    }
  },
};

// rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:594 may_use_unstable_feature
export function may_use_unstable_feature(infcx: InferCtxtLike, param_env: ParamEnv, symbol: Symbol): boolean {
  // Iterate through all goals in param_env to find the one that has the same symbol.
  for (const clause of param_env.caller_bounds()) {
    const sym = Binder.skip_binder(clause.kind());
    if (sym.$ === "UnstableFeature") {
      if (sym._0 === symbol) {
        return true;
      }
    }
  }

  // During codegen we must assume that all feature bounds hold as we may be
  // monomorphizing a body from an upstream crate which had an unstable feature
  // enabled that we do not.
  //
  // Coherence should already report overlap errors involving unstable impls
  // as the affected code would otherwise break when stabilizing this feature.
  // It is also easily possible to accidentally cause unsoundness this way as
  // we have to always enable unstable impls during codegen.
  //
  // Return ambiguity can also prevent people from writing code which depends on inference guidance
  // that might no longer work after the impl is stabilised,
  // tests/ui/unstable-feature-bound/unstable_impl_method_selection.rs is one of the example.
  //
  // Note: `feature_bound_holds_in_crate` does not consider a feature to be enabled
  // if we are in std/core even if there is a corresponding `feature` attribute on the crate.

  const mode = TypingMode.assert_not_erased(infcx.typing_mode_raw());
  switch (mode.$) {
    case "Coherence":
    case "Typeck":
    case "PostTypeckUntilBorrowck":
    case "Reflection":
    case "PostBorrowck":
    case "PostAnalysis":
      return inherent_Features.feature_bound_holds_in_crate(infcx.cx().features(), symbol);
    case "Codegen":
      return true;
    case "ErasedNotCoherence":
      // PORT: `TypingMode<I, CantBeErased>` has no such value (uninhabited `S`).
      return mode._0;
  }
}

// ---- DeepVariableResolver ------------------------------------------------------------------------------------------

// rustc-type: compiler/rustc_type_ir/src/infer_ctxt.rs:638 DeepVariableResolver
class DeepVariableResolver implements TypeFolder {
  constructor(
    public delegate: InferCtxtLike,
    /// We're able to use a cache here as the folder does not have any
    /// mutable state.
    public cache: DelayedMap<Ty, Ty>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:650 new
  static new(delegate: InferCtxtLike): DeepVariableResolver {
    return new DeepVariableResolver(delegate, DelayedMap.default_<Ty, Ty>());
  }

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:658 cx
  cx(): TyCtxt {
    return this.delegate.cx();
  }

  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:662 fold_ty
  fold_ty(t: Ty): Ty {
    const kind = t.kind();
    if (kind.$ === "Infer" && kind._0.$ === "TyVar") {
      const vid = kind._0._0;
      const resolved = this.delegate.shallow_resolve_ty_var(vid);
      if (t !== resolved && TypeVisitableExt.has_infer(resolved, fold_Ty)) {
        return fold_with_Ty(resolved, this);
      } else {
        return resolved;
      }
    } else if (kind.$ === "Infer" && kind._0.$ === "IntVar") {
      return this.delegate.shallow_resolve_int_var(kind._0._0);
    } else if (kind.$ === "Infer" && kind._0.$ === "FloatVar") {
      return this.delegate.shallow_resolve_float_var(kind._0._0);
    } else {
      if (TypeVisitableExt.has_infer(t, fold_Ty)) {
        const ty = this.cache.get(t);
        if (ty !== undefined) {
          return ty;
        }
        const res = fold_Ty.super_fold_with(t, this);
        assert(this.cache.insert(t, res), "assertion failed: self.cache.insert(t, res)");
        return res;
      } else {
        return t;
      }
    }
  }

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:689 fold_region
  fold_region(r: Region): Region {
    const kind = r.kind();
    switch (kind.$) {
      case "ReVar":
        return this.delegate.shallow_resolve_region_var(kind._0);
      default:
        return r;
    }
  }

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:696 fold_const
  fold_const(c: Const): Const {
    const kind = c.kind();
    if (kind.$ === "Infer" && kind._0.$ === "Var") {
      const resolved = this.delegate.shallow_resolve_const_var(kind._0._0);
      if (c !== resolved && TypeVisitableExt.has_infer(resolved, fold_Const)) {
        return fold_Const.fold_with(resolved, this);
      } else {
        return resolved;
      }
    } else {
      if (TypeVisitableExt.has_infer(c, fold_Const)) {
        return fold_Const.super_fold_with(c, this);
      } else {
        return c;
      }
    }
  }

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:716 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (TypeVisitableExt.has_infer(p, d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // rustc: compiler/rustc_type_ir/src/infer_ctxt.rs:720 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    if (TypeVisitableExt.has_infer(c, fold_Clauses)) {
      return fold_Clauses.super_fold_with(c, this);
    } else {
      return c;
    }
  }
}
