// Port of compiler/rustc_infer/src/infer/mod.rs (lane infcx-contract ported the `InferCtxtInner` impl block,
// `TyCtxtInferExt` and `InferCtxtBuilder` so that an empty `InferCtxt` can be built; lane infer-core ported the rest).
//
// The contract classes `InferCtxtInner`, `InferCtxt` and `InferCtxtBuilder` are declared in ../decls.ts (fields and every
// method); this module re-exports them and assigns the methods of this file onto their prototypes. The other types of
// mod.rs (with their derived Debug / Clone / TypeFoldable) are generated into mod.gen.ts.
//
// Init order: top-level code here may touch only ../decls.ts, mod.gen.ts and other crates; every other rustc_infer
// export (the submodules) is read inside function bodies only.
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { type HirId, HirIdMap } from "../../rustc_hir_id/lib.ts";
import { WithDepNodeCache } from "../../rustc_middle/traits/cache.ts";
import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { clone_ObligationCause } from "../../rustc_middle/traits/mod.ts";
import * as tls from "../../rustc_middle/ty/context/tls.ts";
import { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses, GenericArgs, ParamEnv, PseudoCanonicalInput } from "../../rustc_middle/ty/decls.ts";
import type { BoundVarReplacerDelegate } from "../../rustc_middle/ty/fold.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericParamDef } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { debug_Ty, type ProvisionalHiddenType, Term, Ty, TypingEnv, visit_with_Ty } from "../../rustc_middle/ty/mod.ts";
import type { PolyCoercePredicate, PolySubtypePredicate } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, debug_Span, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder, type BoundConst, type BoundRegion, type BoundTy, debug_Binder, visit_with_Binder } from "../../rustc_type_ir/binder.ts";
import { CanonicalizerState, type CanonicalQueryInput, type CanonicalVarValues } from "../../rustc_type_ir/canonical.ts";
import { ExpectedFound } from "../../rustc_type_ir/error.ts";
import { fold_regions, type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided, visit_with_trivial } from "../../rustc_type_ir/fold.ts";
import { InferCtxtLike_provided, type RangeInclusive, type TypingMode, TypingMode as TypingModeC } from "../../rustc_type_ir/infer_ctxt.ts";
import { BoundVar, type ClosureKind, UniverseIndex } from "../../rustc_type_ir/lib.ts";
import {
  as_interner,
  debug_OutlivesClause,
  fold_with_SubtypePredicate,
  type OutlivesClause,
  type SubtypePredicate,
  type TraitRef,
  try_fold_with_SubtypePredicate,
  visit_with_OutlivesClause,
  visit_with_SubtypePredicate,
} from "../../rustc_type_ir/predicate.ts";
import { type Assumptions, debug_RegionConstraint, visit_with_RegionConstraint } from "../../rustc_type_ir/region_constraint.ts";
import type { TyOrConstInferVar, VisibleForLeakCheck } from "../../rustc_type_ir/solve/mod.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import type { AliasTerm, OpaqueAliasTy as OpaqueAliasTyT } from "../../rustc_type_ir/ty/alias.ts";
import type { ConstVid, OpaqueTypeKey, RegionVid } from "../../rustc_type_ir/decls.ts";
import {
  FloatVarValue,
  type FloatVid,
  FloatVid as FloatVidC,
  IntVarValue,
  type IntVid,
  OpaqueAliasTy,
  type TyVid,
  UnifyKey_FloatVid,
  UnifyKey_IntVid,
} from "../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { type TypeVisitable, TypeVisitableExt, visit_with_Vec } from "../../rustc_type_ir/visit.ts";
import { type Debug, debug_vec, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { UndoLogs } from "../../vendor/ena/undo_log.ts";
import * as ut from "../../vendor/ena/unify/mod.ts";
import type { Companions } from "../decls.ts";
import { InferCtxt, InferCtxtBuilder, InferCtxtInner } from "../decls.ts";
import type { TraitEngine } from "../traits/engine.ts";
import { clone_Obligation, type ObligationInspector, type PredicateObligation, type PredicateObligations } from "../traits/mod.ts";
import { clone_ProjectionCacheStorage, default_ProjectionCacheStorage } from "../traits/project.ts";
import { DefineOpaqueTypes, ToTrace_Ty } from "./at.ts";
import * as gen from "./mod.gen.ts";
import {
  type BoundRegionConversionTime,
  clone_TypeOutlivesConstraint,
  type FixupError,
  type FixupResult,
  type InferenceLiteralEraser,
  InferOk,
  type InferResult,
  type NllRegionVariableOrigin,
  TypeTrace,
} from "./mod.gen.ts";
import { clone_OpaqueTypeStorage, debug_OpaqueTypeStorage, default_OpaqueTypeStorage } from "./opaque_types/table.ts";
import {
  clone_RegionConstraintStorage,
  clone_RegionVariableInfo,
  debug_RegionConstraintData,
  type GenericKind,
  RegionConstraintStorage,
  type VarInfos,
  type VerifyBound,
} from "./region_constraints/mod.ts";
import { DeepResolverIgnoringRegions, deeply_resolve_via_region_graph as resolve_deeply_resolve_via_region_graph } from "./resolve.ts";
import { clone_InferCtxtUndoLogs, InferCtxtUndoLogs, UndoLog } from "./snapshot/undo_log.ts";
import { clone_SolverRegionConstraintStorage, type SolverRegionConstraint, SolverRegionConstraintStorage } from "./solver_region_constraints.ts";
import {
  clone_FloatVariableOrigin,
  clone_TypeVariableStorage,
  type FloatVariableOrigin,
  type TypeVariableOrigin,
  TypeVariableStorage,
  TypeVariableValue,
  TyVidEqKey_from,
} from "./type_variable.ts";
import { type ConstVariableOrigin, ConstVariableValue, ConstVidKey_from, UnifyKey_ConstVidKey } from "./unify_key.ts";

export * from "./mod.gen.ts";

// `pub use` re-exports and `pub mod`s of mod.rs (mod.rs:5..68). The private modules are loaded by ../lib.ts.
export { DefineOpaqueTypes } from "./at.ts";
export { TypeFreshener } from "./freshen.ts";
export { RegionResolutionError } from "./lexical_region_resolve/mod.ts";
export { OpaqueTypeStorage, OpaqueTypeStorageEntries, OpaqueTypeTable } from "./opaque_types/table.ts";
export type { PredicateEmittingRelation } from "../../rustc_type_ir/relate/combine.ts";
export type { SolverRegionConstraint } from "./solver_region_constraints.ts";
export * as at from "./at.ts";
export * as canonical from "./canonical/mod.ts";
export * as outlives from "./outlives/mod.ts";
export * as region_constraints from "./region_constraints/mod.ts";
export * as relate from "./relate/mod.ts";
export * as resolve from "./resolve.ts";

// The contract classes (../decls.ts): mod.gen.ts and the other generated modules import them from here.
export { InferCtxt, InferCtxtBuilder, InferCtxtInner } from "../decls.ts";

// rustc-type: compiler/rustc_infer/src/infer/mod.rs:88 UnificationTable
// PORT: `ut::UnificationTable<ut::InPlace<T, &mut ut::UnificationStorage<T>, &mut InferCtxtUndoLogs>>`: the ena table
// over the shared undo log (its `UndoLogs` view at the table's undo type, `InferCtxtUndoLogs.as_`); `V` / `E` are
// `T::Value` and its error type.
export type UnificationTable<K, V, E = ut.NoError> = ut.UnificationTable<K, V, E, ut.InPlace<K, V, E, UndoLogs<ut.InPlaceUndoLog<K, V>>>>;

/** `#[derive(Clone)]` of `InferCtxtInner` (a hand type: codegen does not derive its Clone). */
export function clone_InferCtxtInner(v: InferCtxtInner): InferCtxtInner {
  return new InferCtxtInner(
    clone_InferCtxtUndoLogs(v.undo_log),
    clone_ProjectionCacheStorage(v.projection_cache_),
    clone_TypeVariableStorage(v.type_variable_storage),
    v.const_unification_storage.clone((s) => s.clone((l) => l)),
    v.int_unification_storage.clone((s) => s.clone((l) => l)),
    v.float_unification_storage.clone((s) => s.clone((l) => l)),
    v.float_origin_origin_storage.map(clone_FloatVariableOrigin),
    v.region_constraint_storage === undefined ? undefined : clone_RegionConstraintStorage(v.region_constraint_storage),
    clone_SolverRegionConstraintStorage(v.solver_region_constraint_storage),
    v.region_obligations_.map(clone_TypeOutlivesConstraint),
    v.region_assumptions_.slice(),
    v.hir_typeck_potentially_region_dependent_goals.map((o) => clone_Obligation(o, (p) => p)),
    clone_OpaqueTypeStorage(v.opaque_type_storage),
  );
}

// ---- impl InferCtxtInner (mod.rs:174) ----------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/mod.rs:175 new
InferCtxtInner.new = function (): InferCtxtInner {
  return new InferCtxtInner(
    InferCtxtUndoLogs.default_(),

    default_ProjectionCacheStorage(),
    TypeVariableStorage.default_(),
    ut.UnificationTable.new(() => ut.InPlace.default(UnifyKey_ConstVidKey, () => undefined)),
    ut.UnificationTable.new(() => ut.InPlace.default(UnifyKey_IntVid, () => undefined)),
    ut.UnificationTable.new(() => ut.InPlace.default(UnifyKey_FloatVid, () => undefined)),
    [],
    RegionConstraintStorage.default_(),
    SolverRegionConstraintStorage.new(),
    [],
    [],
    [],
    default_OpaqueTypeStorage(),
  );
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:195 region_obligations
InferCtxtInner.prototype.region_obligations = function (this: InferCtxtInner) {
  return this.region_obligations_;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:200 region_assumptions
InferCtxtInner.prototype.region_assumptions = function (this: InferCtxtInner) {
  return this.region_assumptions_;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:205 projection_cache
InferCtxtInner.prototype.projection_cache = function (this: InferCtxtInner) {
  return this.projection_cache_.with_log(this.undo_log);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:210 try_type_variables_probe_ref
InferCtxtInner.prototype.try_type_variables_probe_ref = function (this: InferCtxtInner, vid): TypeVariableValue | undefined {
  // Uses a read-only view of the unification table, this way we don't
  // need an undo log.
  const value = this.type_variable_storage.eq_relations_ref().try_probe_value(TyVidEqKey_from(vid));
  return value === undefined ? undefined : value._0;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:217 type_variables
InferCtxtInner.prototype.type_variables = function (this: InferCtxtInner) {
  return this.type_variable_storage.with_log(this.undo_log);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:222 opaque_types
InferCtxtInner.prototype.opaque_types = function (this: InferCtxtInner) {
  return this.opaque_type_storage.with_log(this.undo_log);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:227 int_unification_table
InferCtxtInner.prototype.int_unification_table = function (this: InferCtxtInner) {
  return this.int_unification_storage.with_log(this.undo_log.as_(UndoLog.from_IntUnificationTable));
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:232 float_unification_table
InferCtxtInner.prototype.float_unification_table = function (this: InferCtxtInner) {
  return this.float_unification_storage.with_log(this.undo_log.as_(UndoLog.from_FloatUnificationTable));
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:237 const_unification_table
InferCtxtInner.prototype.const_unification_table = function (this: InferCtxtInner) {
  return this.const_unification_storage.with_log(this.undo_log.as_(UndoLog.from_ConstUnificationTable));
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:242 unwrap_region_constraints
InferCtxtInner.prototype.unwrap_region_constraints = function (this: InferCtxtInner) {
  return unwrap(this.region_constraint_storage, "region constraints already solved").with_log(this.undo_log);
};

// ---- impl Drop for InferCtxt (mod.rs:364) -----------------------------------------------------------------------------

// PORT: `Drop for InferCtxt` is the uncalled method `drop()` (infcx-contract decision 5): JS has no destructors; a caller
// that wants the check calls `infcx.drop()` where the `InferCtxt` goes out of scope.
// rustc: compiler/rustc_infer/src/infer/mod.rs:365 drop
InferCtxt.prototype.drop = function (this: InferCtxt): void {
  const inner = this.inner;
  const opaque_type_storage = inner.opaque_type_storage;

  // No need for the drop bomb when we're in `TypingMode::PostTypeckUntilBorrowck`, and the `InferCtxt`
  // doesn't consider regions. This is okay since after typeck, the only reason we care about opaques is
  // in relation to regions. In some places *after* typeck that aren't borrowck, we use
  // `TypingMode::PostTypeckUntilBorrowck` to prevent defining opaque types and we simply don't care about regions.
  const mode = this.typing_mode_raw();
  switch (mode.$) {
    case "Coherence":
    case "Typeck":
    case "PostBorrowck":
    case "Reflection":
    case "PostAnalysis":
    case "Codegen":
      break;
    // In erased mode, the opaque type storage is always empty
    case "ErasedNotCoherence":
      break;
    case "PostTypeckUntilBorrowck":
      if (!this.considering_regions) {
        return;
      }
      break;
  }

  if (!opaque_type_storage.is_empty()) {
    tls.with_((tcx) => tcx.dcx().delayed_bug(debug_OpaqueTypeStorage(opaque_type_storage, PLAIN)));
  }
};

// ---- impl ValuePairs (mod.rs:407) -------------------------------------------------------------------------------------

export type ValuePairs = gen.ValuePairs;
export const ValuePairs: Companions["ValuePairs"] = {
  // rustc: compiler/rustc_infer/src/infer/mod.rs:408 ty
  ty(self: ValuePairs): [Ty, Ty] | undefined {
    if (self.$ === "Terms") {
      const { expected, found } = self._0;
      const expected_ = Term.as_type(expected);
      if (expected_ !== undefined) {
        const found_ = Term.as_type(found);
        if (found_ !== undefined) {
          return [expected_, found_];
        }
      }
    }
    return undefined;
  },
};

// ---- impl SubregionOrigin (mod.rs:482; `span` and `from_obligation_cause` are assigned at mod.rs:1841) ----------------

export type SubregionOrigin = gen.SubregionOrigin;
export const SubregionOrigin = {
  // PORT: `ConstraintCategory` (rustc_middle::mir, M4) is not ported: its arms stop as UNPORTED, as
  // rustc_middle traits/mod.ts `ObligationCause::to_constraint_category` (the contract types the result `unknown`).
  // rustc: compiler/rustc_infer/src/infer/mod.rs:483 to_constraint_category
  to_constraint_category(self: SubregionOrigin): unknown {
    switch (self.$) {
      case "Subtype":
        return self._0.cause.to_constraint_category();
      case "AscribeUserTypeProvePredicate":
        // ConstraintCategory::Predicate(*span, *def_id)
        return unported("rustc_middle::mir::ConstraintCategory (mir, M4): Predicate");
      case "SolverRegionConstraint":
        // ConstraintCategory::SolverRegionConstraint(*span)
        return unported("rustc_middle::mir::ConstraintCategory (mir, M4): SolverRegionConstraint");
      default:
        // ConstraintCategory::BoringNoLocation
        return unported("rustc_middle::mir::ConstraintCategory (mir, M4): BoringNoLocation");
    }
  },
} as Companions["SubregionOrigin"];

// ---- impl fmt::Display for FixupError (mod.rs:568) --------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/mod.rs:569 fmt
export function display_FixupError(self: FixupError): string {
  switch (self.unresolved.$) {
    case "TyInt":
      return "cannot determine the type of this integer; add a suffix to specify the type explicitly";
    case "TyFloat":
      return "cannot determine the type of this number; add a suffix to specify the type explicitly";
    case "Ty":
      return "unconstrained type";
    case "Const":
      return "unconstrained const value";
  }
}

// ---- TyCtxtInferExt (mod.rs:607) ---------------------------------------------------------------------------------------

// PORT: `#[extension(pub trait TyCtxtInferExt<'tcx>)] impl<'tcx> TyCtxt<'tcx>`: a method on `TyCtxt.prototype` (declared
// in ../decls.ts), as rustc_middle's `ConstExt` on `Const.prototype`.
// rustc: compiler/rustc_infer/src/infer/mod.rs:609 infer_ctxt
TyCtxt.prototype.infer_ctxt = function (this: TyCtxt): InferCtxtBuilder {
  return new InferCtxtBuilder(this, true, false, false, this.next_trait_solver_globally(), true);
};

// ---- impl InferCtxtBuilder (mod.rs:621) --------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/mod.rs:622 with_next_trait_solver
InferCtxtBuilder.prototype.with_next_trait_solver = function (this: InferCtxtBuilder, next_trait_solver: boolean): InferCtxtBuilder {
  this.next_trait_solver = next_trait_solver;
  return this;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:627 enable_next_solver_overflow_fcw
InferCtxtBuilder.prototype.enable_next_solver_overflow_fcw = function (this: InferCtxtBuilder, enable_next_solver_overflow_fcw: boolean): InferCtxtBuilder {
  this.enable_next_solver_overflow_fcw_ = enable_next_solver_overflow_fcw;
  return this;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:635 ignoring_regions
InferCtxtBuilder.prototype.ignoring_regions = function (this: InferCtxtBuilder): InferCtxtBuilder {
  this.considering_regions = false;
  return this;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:640 in_hir_typeck
InferCtxtBuilder.prototype.in_hir_typeck = function (this: InferCtxtBuilder): InferCtxtBuilder {
  this.in_hir_typeck_ = true;
  return this;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:645 skip_leak_check
InferCtxtBuilder.prototype.skip_leak_check = function (this: InferCtxtBuilder, skip_leak_check: boolean): InferCtxtBuilder {
  this.skip_leak_check_ = skip_leak_check;
  return this;
};

/// Given a canonical value `C` as a starting point, create an
/// inference context that contains each of the bound values
/// within instantiated as a fresh variable. The `f` closure is
/// invoked with the new infcx, along with the instantiated value
/// `V` and a instantiation `S`. This instantiation `S` maps from
/// the bound values in `C` to their instantiated values in `V`
/// (in other words, `S(C) = V`).
// rustc: compiler/rustc_infer/src/infer/mod.rs:657 build_with_canonical
InferCtxtBuilder.prototype.build_with_canonical = function <T>(
  this: InferCtxtBuilder,
  span: Span,
  input: CanonicalQueryInput<T>,
  d_T: TypeFoldable<T>,
): [InferCtxt, T, CanonicalVarValues] {
  const infcx = this.build(input.typing_mode._0);
  const [value, args] = infcx.instantiate_canonical(span, input.canonical, d_T);
  return [infcx, value, args];
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:670 build_with_typing_env
InferCtxtBuilder.prototype.build_with_typing_env = function (this: InferCtxtBuilder, typing_env: TypingEnv): [InferCtxt, ParamEnv] {
  return [this.build(typing_env.typing_mode()), typing_env.param_env];
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:677 build
InferCtxtBuilder.prototype.build = function (this: InferCtxtBuilder, typing_mode: TypingMode): InferCtxt {
  const {
    tcx,
    considering_regions,
    in_hir_typeck_: in_hir_typeck,
    skip_leak_check_: skip_leak_check,
    next_trait_solver,
    enable_next_solver_overflow_fcw_: enable_next_solver_overflow_fcw,
  } = this;
  return new InferCtxt(
    tcx,
    typing_mode,
    considering_regions,
    in_hir_typeck,
    skip_leak_check,
    InferCtxtInner.new(),
    undefined,
    WithDepNodeCache.default_(),
    WithDepNodeCache.default_(),
    new Map(),
    new HirIdMap(),
    new KeyedSet<[Span, Span | undefined]>(intern_key),
    undefined,
    UniverseIndex.ROOT,
    new Map(),
    next_trait_solver,
    enable_next_solver_overflow_fcw,
    undefined,
    CanonicalizerState.default_(),
  );
};

// ---- impl InferOk (mod.rs:710, 723) -----------------------------------------------------------------------------------

/// Extracts `value`, registering any obligations into `fulfill_cx`.
// rustc: compiler/rustc_infer/src/infer/mod.rs:712 into_value_registering_obligations
InferOk.prototype.into_value_registering_obligations = function <T, E>(this: InferOk<T>, infcx: InferCtxt, fulfill_cx: TraitEngine<E>): T {
  const { value, obligations } = this;
  fulfill_cx.register_predicate_obligations(infcx, obligations);
  return value;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:724 into_obligations
InferOk.prototype.into_obligations = function (this: InferOk<unknown>): PredicateObligations {
  return this.obligations;
};

// ---- impl InferCtxt (mod.rs:729) --------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/mod.rs:730 dcx
InferCtxt.prototype.dcx = function (this: InferCtxt): DiagCtxtHandle {
  // PORT: `&self.tainted_by_errors` (a `Cell`) is a `MutRef` view of the field `tainted_by_errors_`.
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;
  const tainted_by_errors: MutRef<ErrorGuaranteed | undefined> = {
    get value() {
      return self.tainted_by_errors_;
    },
    set value(v) {
      self.tainted_by_errors_ = v;
    },
  };
  return this.tcx.dcx().into_taintable(tainted_by_errors);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:734 next_trait_solver
InferCtxt.prototype.next_trait_solver = function (this: InferCtxt): boolean {
  return this.next_trait_solver_;
};

/// This method is deliberately called `..._raw`,
/// since the output may possibly include [`TypingMode::ErasedNotCoherence`](TypingMode::ErasedNotCoherence).
/// `ErasedNotCoherence` is an implementation detail of the next trait solver, see its docs for
/// more information.
///
/// `InferCtxt` has two uses: the trait solver calls some methods on it, because the `InferCtxt`
/// works as a kind of store for for example type unification information.
/// `InferCtxt` is also often used outside the trait solver during typeck.
/// There, we don't care about the `ErasedNotCoherence` case and should never encounter it.
/// To make sure these two uses are never confused, we want to statically encode this information.
///
/// The `FnCtxt`, for example, is only used in the outside-trait-solver case. It has a non-raw
/// version of the `typing_mode` method available that asserts `ErasedNotCoherence` is
/// impossible, and returns a `TypingMode` where `ErasedNotCoherence` is made uninhabited using
/// the [`CantBeErased`](rustc_type_ir::CantBeErased) enum. That way you don't even have to
/// match on the variant and can safely ignore it.
///
/// Prefer non-raw apis if available. e.g.,
/// - On the `FnCtxt`
/// - on the `SelectionCtxt`
// rustc: compiler/rustc_infer/src/infer/mod.rs:759 typing_mode_raw
InferCtxt.prototype.typing_mode_raw = function (this: InferCtxt): TypingMode {
  return this.typing_mode;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:764 disable_trait_solver_fast_paths
InferCtxt.prototype.disable_trait_solver_fast_paths = function (this: InferCtxt): boolean {
  return this.tcx.disable_trait_solver_fast_paths();
};

/// Returns the origin of the type variable identified by `vid`.
///
/// No attempt is made to resolve `vid` to its root variable.
// rustc: compiler/rustc_infer/src/infer/mod.rs:771 type_var_origin
InferCtxt.prototype.type_var_origin = function (this: InferCtxt, vid: TyVid): TypeVariableOrigin {
  return this.inner.type_variables().var_origin(vid);
};

/// Returns the origin of the float type variable identified by `vid`.
///
/// No attempt is made to resolve `vid` to its root variable.
// rustc: compiler/rustc_infer/src/infer/mod.rs:778 float_var_origin
InferCtxt.prototype.float_var_origin = function (this: InferCtxt, vid: FloatVid): FloatVariableOrigin {
  return index_vec(this.inner.float_origin_origin_storage, FloatVidC.as_usize(vid));
};

/// Returns the origin of the const variable identified by `vid`
// FIXME: We should store origins separately from the unification table
// so this doesn't need to be optional.
// rustc: compiler/rustc_infer/src/infer/mod.rs:785 const_var_origin
InferCtxt.prototype.const_var_origin = function (this: InferCtxt, vid: ConstVid): ConstVariableOrigin | undefined {
  const value = this.inner.const_unification_table().probe_value(ConstVidKey_from(vid));
  switch (value.$) {
    case "Known":
      return undefined;
    case "Unknown":
      return value.origin;
  }
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:792 unresolved_root_variables
InferCtxt.prototype.unresolved_root_variables = function (this: InferCtxt): [TyVid[], IntVid[], FloatVid[]] {
  const inner = this.inner;

  const ty = inner.type_variables().unresolved_root_variables();

  const int = unresolved_root_variables_of(inner.int_unification_table(), IntVarValue.is_unknown);

  const float = unresolved_root_variables_of(inner.float_unification_table(), FloatVarValue.is_unknown);

  return [ty, int, float];
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:811 sub_regions
InferCtxt.prototype.sub_regions = function (this: InferCtxt, origin: SubregionOrigin, a: Region, b: Region, vis: VisibleForLeakCheck): void {
  this.inner.unwrap_region_constraints().make_subregion(origin, a, b, vis);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:822 equate_regions
InferCtxt.prototype.equate_regions = function (this: InferCtxt, origin: SubregionOrigin, a: Region, b: Region, vis: VisibleForLeakCheck): void {
  this.inner.unwrap_region_constraints().make_eqregion(origin, a, b, vis);
};

/// Processes a `Coerce` predicate from the fulfillment context.
/// This is NOT the preferred way to handle coercion, which is to
/// invoke `FnCtxt::coerce` or a similar method (see `coercion.rs`).
///
/// This method here is actually a fallback that winds up being
/// invoked when `FnCtxt::coerce` encounters unresolved type variables
/// and records a coercion predicate. Presently, this method is equivalent
/// to `subtype_predicate` -- that is, "coercing" `a` to `b` winds up
/// actually requiring `a <: b`. This is of course a valid coercion,
/// but it's not as flexible as `FnCtxt::coerce` would be.
///
/// (We may refactor this in the future, but there are a number of
/// practical obstacles. Among other things, `FnCtxt::coerce` presently
/// records adjustments that are required on the HIR in order to perform
/// the coercion, and we don't currently have a way to manage that.)
// rustc: compiler/rustc_infer/src/infer/mod.rs:847 coerce_predicate
InferCtxt.prototype.coerce_predicate = function (
  this: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  predicate: PolyCoercePredicate,
): Result<InferResult<null>, [TyVid, TyVid]> {
  const subtype_predicate = Binder.map_bound(predicate, (p): SubtypePredicate => ({
    a_is_expected: false, // when coercing from `a` to `b`, `b` is expected
    a: p.a,
    b: p.b,
  }));
  return this.subtype_predicate(cause, param_env, subtype_predicate);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:861 subtype_predicate
InferCtxt.prototype.subtype_predicate = function (
  this: InferCtxt,
  cause: ObligationCause,
  param_env: ParamEnv,
  predicate: PolySubtypePredicate,
): Result<InferResult<null>, [TyVid, TyVid]> {
  // Check for two unresolved inference variables, in which case we can
  // make no progress. This is partly a micro-optimization, but it's
  // also an opportunity to "sub-unify" the variables. This isn't
  // *necessary* to prevent cycles, because they would eventually be sub-unified
  // anyhow during generalization, but it helps with diagnostics (we can detect
  // earlier that they are sub-unified).
  //
  // Note that we can just skip the binders here because
  // type variables can't (at present, at
  // least) capture any of the things bound by this binder.
  //
  // Note that this sub here is not just for diagnostics - it has semantic
  // effects as well.
  const r_a = this.shallow_resolve(Binder.skip_binder(predicate).a);
  const r_b = this.shallow_resolve(Binder.skip_binder(predicate).b);
  const ka = r_a.kind();
  const kb = r_b.kind();
  if (ka.$ === "Infer" && ka._0.$ === "TyVar" && kb.$ === "Infer" && kb._0.$ === "TyVar") {
    const a_vid = ka._0._0;
    const b_vid = kb._0._0;
    this.sub_unify_ty_vids_raw(a_vid, b_vid);
    return Err<[TyVid, TyVid]>([a_vid, b_vid]);
  }

  return this.enter_forall(
    predicate,
    ({ a_is_expected, a, b }) => {
      if (a_is_expected) {
        return Ok(this.at(cause, param_env).sub(DefineOpaqueTypes.Yes, a, b, ToTrace_Ty));
      } else {
        return Ok(this.at(cause, param_env).sup(DefineOpaqueTypes.Yes, b, a, ToTrace_Ty));
      }
    },
    fold_SubtypePredicate,
  );
};

/// Number of type variables created so far.
// rustc: compiler/rustc_infer/src/infer/mod.rs:900 num_ty_vars
InferCtxt.prototype.num_ty_vars = function (this: InferCtxt): number {
  return this.inner.type_variables().num_vars();
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:904 next_ty_vid
InferCtxt.prototype.next_ty_vid = function (this: InferCtxt, span: Span): TyVid {
  return this.next_ty_vid_with_origin({ span, param_def_id: undefined });
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:908 next_ty_vid_with_origin
InferCtxt.prototype.next_ty_vid_with_origin = function (this: InferCtxt, origin: TypeVariableOrigin): TyVid {
  return this.inner.type_variables().new_var(this.universe(), origin);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:912 next_ty_vid_in_universe
InferCtxt.prototype.next_ty_vid_in_universe = function (this: InferCtxt, span: Span, universe: UniverseIndex): TyVid {
  const origin: TypeVariableOrigin = { span, param_def_id: undefined };
  return this.inner.type_variables().new_var(universe, origin);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:917 next_ty_var
InferCtxt.prototype.next_ty_var = function (this: InferCtxt, span: Span): Ty {
  return this.next_ty_var_with_origin({ span, param_def_id: undefined });
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:921 next_ty_var_with_origin
InferCtxt.prototype.next_ty_var_with_origin = function (this: InferCtxt, origin: TypeVariableOrigin): Ty {
  const vid = this.next_ty_vid_with_origin(origin);
  return Ty.new_var(this.tcx, vid);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:926 next_ty_var_in_universe
InferCtxt.prototype.next_ty_var_in_universe = function (this: InferCtxt, span: Span, universe: UniverseIndex): Ty {
  const vid = this.next_ty_vid_in_universe(span, universe);
  return Ty.new_var(this.tcx, vid);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:931 next_const_var
InferCtxt.prototype.next_const_var = function (this: InferCtxt, span: Span): Const {
  return this.next_const_var_with_origin({ span, param_def_id: undefined });
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:935 next_const_var_with_origin
InferCtxt.prototype.next_const_var_with_origin = function (this: InferCtxt, origin: ConstVariableOrigin): Const {
  const vid = this.inner.const_unification_table().new_key({ $: "Unknown", origin, universe: this.universe() }).vid;
  return Const.new_var(this.tcx, vid);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:945 next_const_var_in_universe
InferCtxt.prototype.next_const_var_in_universe = function (this: InferCtxt, span: Span, universe: UniverseIndex): Const {
  const origin: ConstVariableOrigin = { span, param_def_id: undefined };
  const vid = this.inner.const_unification_table().new_key({ $: "Unknown", origin, universe }).vid;
  return Const.new_var(this.tcx, vid);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:960 next_int_var
InferCtxt.prototype.next_int_var = function (this: InferCtxt): Ty {
  const next_int_var_id = this.inner.int_unification_table().new_key(IntVarValue.Unknown);
  return Ty.new_int_var(this.tcx, next_int_var_id);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:966 next_float_var
InferCtxt.prototype.next_float_var = function (this: InferCtxt, span: Span, lint_id: HirId | undefined): Ty {
  const inner = this.inner;
  const next_float_var_id = inner.float_unification_table().new_key(FloatVarValue.Unknown);
  const origin: FloatVariableOrigin = { span, lint_id };
  // `IndexVec::push` returns the new element's index.
  const span_index = inner.float_origin_origin_storage.length;
  inner.float_origin_origin_storage.push(origin);
  // debug_assert_eq!(next_float_var_id, span_index);
  void span_index;
  return Ty.new_float_var(this.tcx, next_float_var_id);
};

/// Creates a fresh region variable with the next available index.
/// The variable will be created in the maximum universe created
/// thus far, allowing it to name any region created thus far.
// rustc: compiler/rustc_infer/src/infer/mod.rs:978 next_region_var
InferCtxt.prototype.next_region_var = function (this: InferCtxt, origin: RegionVariableOrigin): Region {
  return this.next_region_var_in_universe(origin, this.universe());
};

/// Creates a fresh region variable with the next available index
/// in the given universe; typically, you can use
/// `next_region_var` and just use the maximal universe.
// rustc: compiler/rustc_infer/src/infer/mod.rs:985 next_region_var_in_universe
InferCtxt.prototype.next_region_var_in_universe = function (this: InferCtxt, origin: RegionVariableOrigin, universe: UniverseIndex): Region {
  const region_var = this.inner.unwrap_region_constraints().new_region_var(universe, origin);
  return Region.new_var(this.tcx, region_var);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:995 next_term_var_of_alias_kind
InferCtxt.prototype.next_term_var_of_alias_kind = function (this: InferCtxt, alias_term: AliasTerm, span: Span): Term {
  switch (alias_term.kind.$) {
    case "ProjectionTy":
    case "InherentTy":
    case "OpaqueTy":
    case "FreeTy":
      return Term.from_Ty(this.next_ty_var(span));
    case "FreeConst":
    case "InherentConstSelf":
    case "InherentConstImpl":
    case "AnonConst":
    case "ProjectionConst":
      return Term.from_Const(this.next_const_var(span));
  }
};

/// Return the universe that the region `r` was created in. For
/// most regions (e.g., `'static`, named regions from the user,
/// etc) this is the root universe U0. For inference variables or
/// placeholders, however, it will return the universe which they
/// are associated.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1018 universe_of_region
InferCtxt.prototype.universe_of_region = function (this: InferCtxt, r: Region): UniverseIndex {
  return this.inner.unwrap_region_constraints().universe(r);
};

/// Number of region variables created so far.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1023 num_region_vars
InferCtxt.prototype.num_region_vars = function (this: InferCtxt): number {
  return this.inner.unwrap_region_constraints().num_region_vars();
};

/// Just a convenient wrapper of `next_region_var` for using during NLL.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1029 next_nll_region_var
InferCtxt.prototype.next_nll_region_var = function (this: InferCtxt, origin: NllRegionVariableOrigin): Region {
  return this.next_region_var({ $: "Nll", _0: origin });
};

/// Just a convenient wrapper of `next_region_var` for using during NLL.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1035 next_nll_region_var_in_universe
InferCtxt.prototype.next_nll_region_var_in_universe = function (this: InferCtxt, origin: NllRegionVariableOrigin, universe: UniverseIndex): Region {
  return this.next_region_var_in_universe({ $: "Nll", _0: origin }, universe);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1043 var_for_def
InferCtxt.prototype.var_for_def = function (this: InferCtxt, span: Span, param: GenericParamDef): GenericArg {
  switch (param.kind.$) {
    case "Lifetime": {
      // Create a region inference variable for the given
      // region parameter definition.
      return GenericArg.from_Region(this.next_region_var({ $: "RegionParameterDefinition", _0: span, _1: param.name }));
    }
    case "Type": {
      // Create a type inference variable for the given
      // type parameter definition. The generic parameters are
      // for actual parameters that may be referred to by
      // the default of this type parameter, if it exists.
      // e.g., `struct Foo<A, B, C = (A, B)>(...);` when
      // used in a path such as `Foo::<T, U>::new()` will
      // use an inference variable for `C` with `[T, U]`
      // as the generic parameters for the default, `(T, U)`.
      const ty_var_id = this.inner.type_variables().new_var(this.universe(), { param_def_id: param.def_id, span });

      return GenericArg.from_Ty(Ty.new_var(this.tcx, ty_var_id));
    }
    case "Const": {
      const origin: ConstVariableOrigin = { param_def_id: param.def_id, span };
      const const_var_id = this.inner.const_unification_table().new_key({ $: "Unknown", origin, universe: this.universe() }).vid;
      return GenericArg.from_Const(Const.new_var(this.tcx, const_var_id));
    }
  }
};

/// Given a set of generics defined on a type or impl, returns the generic parameters mapping
/// each type/region parameter to a fresh inference variable.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1084 fresh_args_for_item
InferCtxt.prototype.fresh_args_for_item = function (this: InferCtxt, span: Span, def_id: DefId): GenericArgs {
  return RawList.for_item(this.tcx, def_id, (param, _) => this.var_for_def(span, param));
};

/// Returns `true` if errors have been reported since this infcx was
/// created. This is sometimes used as a heuristic to skip
/// reporting errors that often occur as a result of earlier
/// errors, but where it's hard to be 100% sure (e.g., unresolved
/// inference variables, regionck errors).
// rustc: compiler/rustc_infer/src/infer/mod.rs:1094 tainted_by_errors
InferCtxt.prototype.tainted_by_errors = function (this: InferCtxt): ErrorGuaranteed | undefined {
  return this.tainted_by_errors_;
};

/// Set the "tainted by errors" flag to true. We call this when we
/// observe an error from a prior pass.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1100 set_tainted_by_errors
InferCtxt.prototype.set_tainted_by_errors = function (this: InferCtxt, e: ErrorGuaranteed): void {
  // debug!("set_tainted_by_errors(ErrorGuaranteed)");
  this.tainted_by_errors_ = e;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1105 region_var_origin
InferCtxt.prototype.region_var_origin = function (this: InferCtxt, vid: RegionVid): RegionVariableOrigin {
  const inner = this.inner;
  return inner.unwrap_region_constraints().var_origin(vid);
};

/// Clone the list of variable regions. This is used only during NLL processing
/// to put the set of region variables into the NLL region context.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1113 get_region_var_infos
InferCtxt.prototype.get_region_var_infos = function (this: InferCtxt): VarInfos {
  const inner = this.inner;
  assert(!inner.undo_log.in_snapshot(), "assertion failed: !UndoLogs::<UndoLog<'_>>::in_snapshot(&inner.undo_log)");
  const storage = unwrap(inner.region_constraint_storage, "regions already resolved");
  if (!storage.data.is_empty()) {
    panic(format_debug(storage.data, debug_RegionConstraintData, PRETTY));
  }
  // We clone instead of taking because borrowck still wants to use the
  // inference context after calling this for diagnostics and the new
  // trait solver.
  return storage.var_infos.map(clone_RegionVariableInfo);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1124 has_opaque_types_in_storage
InferCtxt.prototype.has_opaque_types_in_storage = function (this: InferCtxt): boolean {
  return !this.inner.opaque_type_storage.is_empty();
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1129 take_opaque_types
InferCtxt.prototype.take_opaque_types = function (this: InferCtxt): [OpaqueTypeKey, ProvisionalHiddenType][] {
  return [...this.inner.opaque_type_storage.take_opaque_types()];
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1134 clone_opaque_types
InferCtxt.prototype.clone_opaque_types = function (this: InferCtxt): [OpaqueTypeKey, ProvisionalHiddenType][] {
  return [...this.inner.opaque_type_storage.iter_opaque_types()];
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1138 has_opaques_with_sub_unified_hidden_type
InferCtxt.prototype.has_opaques_with_sub_unified_hidden_type = function (this: InferCtxt, ty_vid: TyVid): boolean {
  if (!this.next_trait_solver()) {
    return false;
  }

  const ty_sub_vid = this.sub_unification_table_root_var(ty_vid);
  const inner = this.inner;
  const type_variables = inner.type_variable_storage.with_log(inner.undo_log);
  for (const [_, hidden_ty] of inner.opaque_type_storage.iter_opaque_types()) {
    const k = hidden_ty.ty.kind();
    if (k.$ === "Infer" && k._0.$ === "TyVar") {
      const hidden_vid = k._0._0;
      const opaque_sub_vid = type_variables.sub_unification_table_root_var(hidden_vid);
      if (opaque_sub_vid === ty_sub_vid) {
        return true;
      }
    }
  }
  return false;
};

/// Searches for an opaque type key whose hidden type is related to `ty_vid`.
///
/// This only checks for a subtype relation, it does not require equality.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1161 opaques_with_sub_unified_hidden_type
InferCtxt.prototype.opaques_with_sub_unified_hidden_type = function (this: InferCtxt, ty_vid: TyVid): OpaqueAliasTyT[] {
  // Avoid accidentally allowing more code to compile with the old solver.
  if (!this.next_trait_solver()) {
    return [];
  }

  const ty_sub_vid = this.sub_unification_table_root_var(ty_vid);
  const inner = this.inner;
  // This is iffy, can't call `type_variables()` as we're already
  // borrowing the `opaque_type_storage` here.
  const type_variables = inner.type_variable_storage.with_log(inner.undo_log);
  const out: OpaqueAliasTyT[] = [];
  for (const [key, hidden_ty] of inner.opaque_type_storage.iter_opaque_types()) {
    const k = hidden_ty.ty.kind();
    if (k.$ === "Infer" && k._0.$ === "TyVar") {
      const hidden_vid = k._0._0;
      const opaque_sub_vid = type_variables.sub_unification_table_root_var(hidden_vid);
      if (opaque_sub_vid === ty_sub_vid) {
        out.push(OpaqueAliasTy.new_opaque_from_args(as_interner(this.tcx), LocalDefId.to_def_id(key.def_id), key.args));
      }
    }
  }
  return out;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1196 can_define_opaque_ty
InferCtxt.prototype.can_define_opaque_ty = function (this: InferCtxt, id: DefId): boolean {
  // debug_assert!(!self.next_trait_solver());
  const mode = TypingModeC.assert_not_erased(this.typing_mode_raw());
  switch (mode.$) {
    case "Typeck":
    case "PostTypeckUntilBorrowck": {
      const defining_opaque_types = mode.$ === "Typeck" ? mode.defining_opaque_types_and_generators : mode.defining_opaque_types;
      const def_id = id.as_local();
      return def_id !== undefined && defining_opaque_types.includes(def_id);
    }
    // FIXME(#132279): This function is quite weird in post-analysis
    // and post-borrowck analysis mode. We may need to modify its uses
    // to support PostBorrowck in the old solver as well.
    case "Coherence":
    case "Reflection":
    case "PostBorrowck":
    case "PostAnalysis":
    case "Codegen":
      return false;
    case "ErasedNotCoherence":
      // PORT: `TypingMode<I, CantBeErased>` has no such value (uninhabited `S`).
      return mode._0;
  }
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1214 push_hir_typeck_potentially_region_dependent_goal
InferCtxt.prototype.push_hir_typeck_potentially_region_dependent_goal = function (this: InferCtxt, goal: PredicateObligation): void {
  const inner = this.inner;
  inner.undo_log.push({ $: "PushHirTypeckPotentiallyRegionDependentGoal" });
  inner.hir_typeck_potentially_region_dependent_goals.push(goal);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1223 take_hir_typeck_potentially_region_dependent_goals
InferCtxt.prototype.take_hir_typeck_potentially_region_dependent_goals = function (this: InferCtxt): PredicateObligation[] {
  assert(!this.in_snapshot(), "cannot take goals in a snapshot");
  // `std::mem::take`
  const goals = this.inner.hir_typeck_potentially_region_dependent_goals;
  this.inner.hir_typeck_potentially_region_dependent_goals = [];
  return goals;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1230 ty_to_string
InferCtxt.prototype.ty_to_string = function (this: InferCtxt, t: Ty): string {
  return display_Ty(this.deeply_resolve_ignoring_regions(t, fold_Ty));
};

/// If `TyVar(vid)` resolves to a type, return that type. Else, return the
/// universe index of `TyVar(vid)`.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1236 try_resolve_ty_var
InferCtxt.prototype.try_resolve_ty_var = function (this: InferCtxt, vid: TyVid): Result<Ty, UniverseIndex> {
  const value = this.inner.type_variables().probe(vid);
  switch (value.$) {
    case "Known":
      return Ok(value.value);
    case "Unknown":
      return Err(value.universe);
  }
};

/// If `vid` resolves to a type, return that type. Otherwise return the root variable id for `vid`.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1246 shallow_resolve_ty_var_or_get_root
InferCtxt.prototype.shallow_resolve_ty_var_or_get_root = function (this: InferCtxt, vid: TyVid): Result<Ty, TyVid> {
  const [root, value] = this.inner.type_variables().probe_with_root_vid(vid);

  switch (value.$) {
    case "Known":
      return Ok(value.value);
    case "Unknown":
      return Err(root);
  }
};

/// Resolve a type variable. Resolving means the following:
///
/// - If a `Ty` is a rigid type (like, an integer, or some ADT), do nothing.
/// - If a `Ty` is a type infer variable, but has been equated with an actual type,
///   return that type.
/// - If a `Ty` is an int or float infer variable, and has been equated with an integer
///   or floating point type, return that type.
/// - If a `Ty` is any kind of infer variable that has been equated, but not yet with a rigid
///   type, then this set of equated variables forms an equivalence class. One of the variables
///   in that equivalent class is said to be the root variable, and resolving makes sure to
///   consistently return this root variable. This is beneficial for caching.
///   This behavior, of returning roots, changed in <https://github.com/rust-lang/rust/pull/158447>.
///
/// Otherwise, resolving simply does nothing.
///
/// The "shallow" part of the name refers to the fact that types may themselves contain more
/// type variables. e.g. The field types of a struct. `shallow_resolve` does not recurse into
/// these nested variables. If that's what you want, use [`deeply_resolve_ignoring_regions`](Self::deeply_resolve_ignoring_regions),
/// or better [`deeply_resolve_via_unification_table`](rustc_type_ir::InferCtxtLike::deeply_resolve_via_unification_table), if you can, which *does* resolve regions.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1274 shallow_resolve
InferCtxt.prototype.shallow_resolve = function (this: InferCtxt, ty: Ty): Ty {
  const kind = ty.kind();
  if (kind.$ === "Infer") {
    const v = kind._0;
    switch (v.$) {
      case "TyVar": {
        // Not entirely obvious: if `typ` is a type variable,
        // it can be resolved to an int/float variable, which
        // can then be recursively resolved, hence the
        // recursion. Note though that we prevent type
        // variables from unifying to other type variables
        // directly (though they may be embedded
        // structurally), and we prevent cycles in any case,
        // so this recursion should always be of very limited
        // depth.
        //
        // Note: if these two lines are combined into one we get
        // dynamic borrow errors on `self.inner`.
        const [root_vid, value] = this.inner.type_variables().probe_with_root_vid(v._0);
        const t = TypeVariableValue.known(value);
        if (t === undefined) {
          return root_vid === v._0 ? ty : Ty.new_var(this.tcx, root_vid);
        } else {
          return this.shallow_resolve(t);
        }
      }

      case "IntVar": {
        const [root, value] = this.inner.int_unification_table().inlined_probe_key_value(v._0);
        switch (value.$) {
          case "IntType":
            return Ty.new_int(this.tcx, value._0);
          case "UintType":
            return Ty.new_uint(this.tcx, value._0);
          case "Unknown": {
            if (root === v._0) {
              return ty;
            } else {
              return Ty.new_int_var(this.tcx, root);
            }
          }
        }
        break;
      }

      case "FloatVar": {
        const [root, value] = this.inner.float_unification_table().inlined_probe_key_value(v._0);
        switch (value.$) {
          case "Known":
            return Ty.new_float(this.tcx, value._0);
          case "Unknown": {
            if (root === v._0) {
              return ty;
            } else {
              return Ty.new_float_var(this.tcx, root);
            }
          }
        }
        break;
      }

      case "FreshTy":
      case "FreshIntTy":
      case "FreshFloatTy":
        return ty;
    }
    return unreachable();
  } else {
    return ty;
  }
};

/// See docs on [`shallow_resolve`](Self::shallow_resolve) for more explanation.
/// It's the same, but for consts.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1341 shallow_resolve_const
InferCtxt.prototype.shallow_resolve_const = function (this: InferCtxt, ct: Const): Const {
  const kind = ct.kind();
  switch (kind.$) {
    case "Infer": {
      const infer_ct = kind._0;
      switch (infer_ct.$) {
        case "Var": {
          const vid = infer_ct._0;
          const [root, value] = this.inner.const_unification_table().inlined_probe_key_value(ConstVidKey_from(vid));
          const known = ConstVariableValue.known(value);
          if (known !== undefined) return known;
          return root.vid === vid ? ct : Const.new_var(this.tcx, root.vid);
        }
        case "Fresh":
          return ct;
      }
      break;
    }

    case "Param":
    case "Bound":
    case "Placeholder":
    case "Alias":
    case "Value":
    case "Error":
    case "Expr":
      return ct;
  }
  return unreachable();
};

/// See docs on [`shallow_resolve`](Self::shallow_resolve) for more explanation.
/// It's the same, but for terms (types or consts).
// rustc: compiler/rustc_infer/src/infer/mod.rs:1369 shallow_resolve_term
InferCtxt.prototype.shallow_resolve_term = function (this: InferCtxt, term: Term): Term {
  const k = Term.kind(term);
  switch (k.$) {
    case "Ty":
      return Term.from_Ty(this.shallow_resolve(k._0));
    case "Const":
      return Term.from_Const(this.shallow_resolve_const(k._0));
  }
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1376 root_var
InferCtxt.prototype.root_var = function (this: InferCtxt, var_: TyVid): TyVid {
  return this.inner.type_variables().root_var(var_);
};

/// If `ty` is an unresolved type variable, returns its root vid.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1381 root_vid
InferCtxt.prototype.root_vid = function (this: InferCtxt, ty: Ty): TyVid | undefined {
  const vid = ty.ty_vid();
  if (vid === undefined) return undefined;
  const [root, value] = this.inner.type_variables().inlined_probe_with_vid(vid);
  return TypeVariableValue.is_unknown(value) ? root : undefined;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1387 sub_unify_ty_vids_raw
InferCtxt.prototype.sub_unify_ty_vids_raw = function (this: InferCtxt, a: TyVid, b: TyVid): void {
  this.inner.type_variables().sub_unify(a, b);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1391 sub_unification_table_root_var
InferCtxt.prototype.sub_unification_table_root_var = function (this: InferCtxt, var_: TyVid): TyVid {
  return this.inner.type_variables().sub_unification_table_root_var(var_);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1395 root_float_var
InferCtxt.prototype.root_float_var = function (this: InferCtxt, var_: FloatVid): FloatVid {
  return this.inner.float_unification_table().find(var_);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1399 root_const_var
InferCtxt.prototype.root_const_var = function (this: InferCtxt, var_: ConstVid): ConstVid {
  return this.inner.const_unification_table().find(ConstVidKey_from(var_)).vid;
};

/// Resolves a const var to a rigid const, if it was constrained to one,
/// or else the root const var in the unification table.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1405 shallow_resolve_const_var
InferCtxt.prototype.shallow_resolve_const_var = function (this: InferCtxt, vid: ConstVid): Const {
  const r = this.try_resolve_const_var(vid);
  switch (r.$) {
    case "Ok":
      return r._0;
    case "Err":
      return Const.new_var(this.tcx, this.root_const_var(vid));
  }
};

/// Resolves a type var to a rigid type, if it was constrained to one,
/// or else the root type var in the unification table.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1414 shallow_resolve_ty_var
InferCtxt.prototype.shallow_resolve_ty_var = function (this: InferCtxt, vid: TyVid): Ty {
  const r = this.try_resolve_ty_var(vid);
  switch (r.$) {
    case "Ok":
      return r._0;
    case "Err":
      return Ty.new_var(this.tcx, this.root_var(vid));
  }
};

/// Resolves an int var to a rigid int type, if it was constrained to one,
/// or else the root int var in the unification table.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1423 shallow_resolve_int_var
InferCtxt.prototype.shallow_resolve_int_var = function (this: InferCtxt, vid: IntVid): Ty {
  const inner = this.inner;
  const value = inner.int_unification_table().probe_value(vid);
  switch (value.$) {
    case "IntType":
      return Ty.new_int(this.tcx, value._0);
    case "UintType":
      return Ty.new_uint(this.tcx, value._0);
    case "Unknown":
      return Ty.new_int_var(this.tcx, inner.int_unification_table().find(vid));
  }
};

/// Resolves a float var to a rigid type, if it was constrained to one,
/// or else the root float var in the unification table.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1437 shallow_resolve_float_var
InferCtxt.prototype.shallow_resolve_float_var = function (this: InferCtxt, vid: FloatVid): Ty {
  const inner = this.inner;
  const value = inner.float_unification_table().probe_value(vid);
  switch (value.$) {
    case "Known":
      return Ty.new_float(this.tcx, value._0);
    case "Unknown":
      return Ty.new_float_var(this.tcx, inner.float_unification_table().find(vid));
  }
};

/// If a type/const variable has not (yet) been unified, it is left as is.
///
/// This is an idempotent operation that does not affect inference state in any way,
/// which means it's safe to call this function at will.
///
/// Region variables are unaffected.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1454 deeply_resolve_ignoring_regions
InferCtxt.prototype.deeply_resolve_ignoring_regions = function <T>(this: InferCtxt, value: T, d_T: TypeFoldable<T>): T {
  const reported = TypeVisitableExt.error_reported(value, d_T);
  if (reported.$ === "Err") {
    this.set_tainted_by_errors(reported._0);
  }
  if (!TypeVisitableExt.has_non_region_infer(value, d_T)) {
    return value;
  }
  const r = DeepResolverIgnoringRegions.new(this);
  return d_T.fold_with(value, r);
};

/// Where possible, replaces type/const/region variables in `value` with their final value.
/// If a type/const/region variable has not (yet) been unified, it is left as is.
///
/// This is an idempotent operation that does not affect inference state in any way,
/// which means it's safe to call this function at will.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1473 deeply_resolve_via_unification_table
InferCtxt.prototype.deeply_resolve_via_unification_table = function <T>(this: InferCtxt, value: T, d_T: TypeFoldable<T>): T {
  return InferCtxtLike_provided.deeply_resolve_via_unification_table(this, value, d_T);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1482 resolve_numeric_literals_with_default
InferCtxt.prototype.resolve_numeric_literals_with_default = function <T>(this: InferCtxt, value: T, d_T: TypeFoldable<T>): T {
  if (!TypeVisitableExt.has_infer(value, d_T)) {
    return value; // Avoid duplicated type-folding.
  }
  const r = InferenceLiteralEraser_folder({ tcx: this.tcx });
  return d_T.fold_with(value, r);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1493 try_resolve_const_var
InferCtxt.prototype.try_resolve_const_var = function (this: InferCtxt, vid: ConstVid): Result<Const, UniverseIndex> {
  const value = this.inner.const_unification_table().probe_value(ConstVidKey_from(vid));
  switch (value.$) {
    case "Known":
      return Ok(value.value);
    case "Unknown":
      return Err(value.universe);
  }
};

/// Attempts to resolve all type/region/const variables in
/// `value`. Region inference must have been run already (e.g.,
/// by calling `resolve_regions_and_report_errors`). If some
/// variable was never unified, an `Err` results.
///
/// This method is idempotent, but it not typically not invoked
/// except during the writeback phase.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1510 deeply_resolve_via_region_graph
InferCtxt.prototype.deeply_resolve_via_region_graph = function <T>(this: InferCtxt, value: T, d_T: TypeFoldable<T>): FixupResult<T> {
  const r = resolve_deeply_resolve_via_region_graph(this, value, d_T);
  switch (r.$) {
    case "Ok": {
      const value = r._0;
      if (TypeVisitableExt.has_non_region_infer(value, d_T)) {
        // bug!("`{value:?}` is not fully resolved")
        // PORT: the D4 descriptor `d_T` has no `Debug` of `T`, so the message cannot be formatted.
        return unported("rustc_infer::infer::InferCtxt::deeply_resolve_via_region_graph: bug! message needs `Debug` of `T`");
      }
      if (TypeVisitableExt.has_infer_regions(value, d_T)) {
        // let guar = self.dcx().delayed_bug(format!("`{value:?}` is not fully resolved"));
        // PORT: as above, the delayed bug's message needs `Debug` of `T`.
        const guar: ErrorGuaranteed = unported("rustc_infer::infer::InferCtxt::deeply_resolve_via_region_graph: delayed_bug message needs `Debug` of `T`");
        return Ok(fold_regions(this.tcx, value, (re, _) => (re.is_var() ? Region.new_error(this.tcx, guar) : re), d_T));
      } else {
        return Ok(value);
      }
    }
    case "Err":
      return Err(r._0);
  }
};

// Instantiates the bound variables in a given binder with fresh inference
// variables in the current universe.
//
// Use this method if you'd like to find some generic parameters of the binder's
// variables (e.g. during a method call). If there isn't a [`BoundRegionConversionTime`]
// that corresponds to your use case, consider whether or not you should
// use [`InferCtxt::enter_forall`] instead.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1539 instantiate_binder_with_fresh_vars
InferCtxt.prototype.instantiate_binder_with_fresh_vars = function <T>(
  this: InferCtxt,
  span: Span,
  lbrct: BoundRegionConversionTime,
  value: Binder<T>,
  d_T: TypeFoldable<T>,
): T {
  if (Binder.no_bound_vars(Binder.as_ref(value), d_T) !== undefined) {
    return Binder.skip_binder(value);
  }

  const bound_vars = Binder.bound_vars(value);
  const args: GenericArg[] = [];

  for (const bound_var_kind of bound_vars) {
    let arg: GenericArg;
    switch (bound_var_kind.$) {
      case "Ty":
        arg = GenericArg.from_Ty(this.next_ty_var(span));
        break;
      case "Region":
        arg = GenericArg.from_Region(this.next_region_var({ $: "BoundRegion", _0: span, _1: bound_var_kind._0, _2: lbrct }));
        break;
      case "Const":
        arg = GenericArg.from_Const(this.next_const_var(span));
        break;
    }
    args.push(arg);
  }

  class ToFreshVars implements BoundVarReplacerDelegate {
    constructor(public args: GenericArg[]) {}

    // rustc: compiler/rustc_infer/src/infer/mod.rs:1571 replace_region
    replace_region(br: BoundRegion): Region {
      return GenericArg.expect_region(index_vec(this.args, BoundVar.as_usize(br.var)));
    }
    // rustc: compiler/rustc_infer/src/infer/mod.rs:1574 replace_ty
    replace_ty(bt: BoundTy): Ty {
      return GenericArg.expect_ty(index_vec(this.args, BoundVar.as_usize(bt.var)));
    }
    // rustc: compiler/rustc_infer/src/infer/mod.rs:1577 replace_const
    replace_const(bc: BoundConst): Const {
      return GenericArg.expect_const(index_vec(this.args, BoundVar.as_usize(bc.var)));
    }
  }
  const delegate = new ToFreshVars(args);
  return this.tcx.replace_bound_vars_uncached(value, delegate, d_T);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1585 insert_placeholder_assumptions
InferCtxt.prototype.insert_placeholder_assumptions = function (this: InferCtxt, u: UniverseIndex, assumptions: Assumptions): void {
  if (TypeVisitableExt.has_escaping_bound_vars(assumptions.type_outlives, visit_Vec_PolyTypeOutlivesClause)) {
    panic(
      `assumptions has escaping bound vars, which is indicative of a bug in how assumptions are handled: ${format_debug(assumptions.type_outlives, debug_Vec_PolyTypeOutlivesClause, PLAIN)}`,
    );
  }
  // assert!(assumptions.region_outlives.base_edges().all(|r| !r.has_escaping_bound_vars()), ..)
  // PORT: `rustc_data_structures::transitive_relation::TransitiveRelation` is not ported (rustc_type_ir
  // region_constraint.ts holds only stand-ins), so `base_edges` stops here.
  unported("rustc_data_structures::transitive_relation::TransitiveRelation::base_edges");
  this.placeholder_assumptions_for_next_solver.set(u, assumptions);
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1603 get_placeholder_assumptions
InferCtxt.prototype.get_placeholder_assumptions = function (this: InferCtxt, u: UniverseIndex): Assumptions {
  return clone_Assumptions(unwrap(this.placeholder_assumptions_for_next_solver.get(u)));
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1610 has_placeholder_assumptions
InferCtxt.prototype.has_placeholder_assumptions = function (this: InferCtxt, range: RangeInclusive<UniverseIndex>): boolean {
  const assumptions = this.placeholder_assumptions_for_next_solver;
  // Walk around that `Step` trait is nightly only.
  for (let i = UniverseIndex.as_usize(range.start); i <= UniverseIndex.as_usize(range.last); i++) {
    const u = UniverseIndex.from_usize(i);
    if (assumptions.get(u) === undefined) return false;
  }
  return true;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1618 get_solver_region_constraint
InferCtxt.prototype.get_solver_region_constraint = function (this: InferCtxt): SolverRegionConstraint {
  return this.inner.solver_region_constraint_storage.get_constraint();
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1622 overwrite_solver_region_constraint
InferCtxt.prototype.overwrite_solver_region_constraint = function (this: InferCtxt, constraint: SolverRegionConstraint): void {
  if (TypeVisitableExt.has_escaping_bound_vars(constraint, visit_SolverRegionConstraint)) {
    panic(
      `solver region constraint has escaping bound vars, which is indicative of a bug in how constraints are handled: ${format_debug(constraint, (v, f) => debug_RegionConstraint(v, f, debug_Span), PLAIN)}`,
    );
  }
  const inner = this.inner;
  const old_constraint = inner.solver_region_constraint_storage.get_constraint();
  inner.undo_log.push({ $: "OverwriteSolverRegionConstraint", old_constraint });
  inner.solver_region_constraint_storage.overwrite(constraint);
};

/// See the [`region_constraints::RegionConstraintCollector::verify_generic_bound`] method.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1634 verify_generic_bound
InferCtxt.prototype.verify_generic_bound = function (this: InferCtxt, origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void {
  // debug!("verify_generic_bound({:?}, {:?} <: {:?})", kind, a, bound);

  this.inner.unwrap_region_constraints().verify_generic_bound(origin, kind, a, bound);
};

/// Obtains the latest type of the given closure; this may be a
/// closure in the current function, in which case its
/// `ClosureKind` may not yet be known.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1652 closure_kind
InferCtxt.prototype.closure_kind = function (this: InferCtxt, closure_ty: Ty): ClosureKind | undefined {
  const k = closure_ty.kind();
  let unresolved_kind_ty: Ty;
  switch (k.$) {
    case "Closure":
      unresolved_kind_ty = ClosureArgs.kind_ty(k._1.as_closure());
      break;
    case "CoroutineClosure":
      unresolved_kind_ty = CoroutineClosureArgs.kind_ty(k._1.as_coroutine_closure());
      break;
    default:
      return bug(`unexpected type ${display_Ty(closure_ty)}`);
  }
  const closure_kind_ty = this.shallow_resolve(unresolved_kind_ty);
  return closure_kind_ty.to_opt_closure_kind();
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1662 universe
InferCtxt.prototype.universe = function (this: InferCtxt): UniverseIndex {
  return this.universe_;
};

/// Creates and return a fresh universe that extends all previous
/// universes. Updates `self.universe` to that new universe.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1668 create_next_universe
InferCtxt.prototype.create_next_universe = function (this: InferCtxt): UniverseIndex {
  const u = UniverseIndex.next_universe(this.universe_);
  // debug!("create_next_universe {u:?}");
  this.universe_ = u;
  return u;
};

/// We need to disable the fcw if we're already in a fcw emitting to avoid
/// indefinite triggering.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1677 with_disabled_next_solver_overflow_fcw
InferCtxt.prototype.with_disabled_next_solver_overflow_fcw = function <R>(this: InferCtxt, f: () => R): R {
  // `Cell::replace`
  const prev = this.enable_next_solver_overflow_fcw_;
  this.enable_next_solver_overflow_fcw_ = false;
  const ret = f();
  this.enable_next_solver_overflow_fcw_ = prev;
  return ret;
};

/// Extract [`ty::TypingMode`] of this inference context to get a `TypingEnv`
/// which contains the necessary information to use the trait system without
/// using canonicalization or carrying this inference context around.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1690 typing_env
InferCtxt.prototype.typing_env = function (this: InferCtxt, param_env: ParamEnv): TypingEnv {
  const mode = this.typing_mode_raw();
  let typing_mode: TypingMode;
  switch (mode.$) {
    // FIXME(#132279): This erases the `defining_opaque_types` as it isn't possible
    // to handle them without proper canonicalization. This means we may cause cycle
    // errors and fail to reveal opaques while inside of bodies. We should rename this
    // function and require explicit comments on all use-sites in the future.
    case "Typeck":
    case "PostTypeckUntilBorrowck":
      typing_mode = TypingModeC.non_body_analysis();
      break;
    case "Coherence":
    case "PostBorrowck":
    case "PostAnalysis":
    case "Reflection":
    case "Codegen":
      typing_mode = mode;
      break;
    case "ErasedNotCoherence":
      return unreachable();
  }
  return TypingEnv.new(param_env, typing_mode);
};

/// Similar to [`Self::canonicalize_query`], except that it returns
/// a [`PseudoCanonicalInput`] and requires both the `value` and the
/// `param_env` to not contain any inference variables or placeholders.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1713 pseudo_canonicalize_query
InferCtxt.prototype.pseudo_canonicalize_query = function <V>(this: InferCtxt, param_env: ParamEnv, value: V, _d_V: TypeFoldable<V>): PseudoCanonicalInput<V> {
  // debug_assert!(!value.has_infer());
  // debug_assert!(!value.has_placeholders());
  // debug_assert!(!param_env.has_infer());
  // debug_assert!(!param_env.has_placeholders());
  return this.typing_env(param_env).as_query_input(value);
};

/// The returned function is used in a fast path. If it returns `true` the variable is
/// unchanged, `false` indicates that the status is unknown.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1731 is_ty_infer_var_definitely_unchanged
InferCtxt.prototype.is_ty_infer_var_definitely_unchanged = function (this: InferCtxt): (_1: TyOrConstInferVar) => boolean {
  // This hoists the borrow/release out of the loop body.
  // PORT: `self.inner.try_borrow()` is always `Ok(inner)`: the port has no `RefCell` borrow flags.
  const inner = this.inner;

  return (infer_var: TyOrConstInferVar): boolean => {
    if (infer_var.$ === "Ty") {
      const ty_var = infer_var._0;
      const v = inner.try_type_variables_probe_ref(ty_var);
      return v !== undefined && v.$ === "Unknown";
    }
    return false;
  };
};

/// `ty_or_const_infer_var_changed` is equivalent to one of these two:
///   * `shallow_resolve(ty) != ty` (where `ty.kind = ty::Infer(_)`)
///   * `shallow_resolve(ct) != ct` (where `ct.kind = ty::ConstKind::Infer(_)`)
///
/// However, `ty_or_const_infer_var_changed` is more efficient. It's always
/// inlined, despite being large, because it has only two call sites that
/// are extremely hot (both in `traits::fulfill`'s checking of `stalled_on`
/// inference variables), and it handles both `Ty` and `ty::Const` without
/// having to resort to storing full `GenericArg`s in `stalled_on`.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1758 ty_or_const_infer_var_changed
InferCtxt.prototype.ty_or_const_infer_var_changed = function (this: InferCtxt, var_: TyOrConstInferVar): boolean {
  switch (var_.$) {
    case "Ty": {
      const v = this.inner.try_type_variables_probe_ref(var_._0);
      return !(v !== undefined && v.$ === "Unknown");
    }
    case "TyInt": {
      const v = this.inner.int_unification_storage.try_probe_value(var_._0);
      return !(v !== undefined && v._0.$ === "Unknown");
    }
    case "TyFloat": {
      const v = this.inner.float_unification_storage.try_probe_value(var_._0);
      return !(v !== undefined && v._0.$ === "Unknown");
    }
    case "Const": {
      const v = this.inner.const_unification_storage.try_probe_value(ConstVidKey_from(var_._0));
      return !(v !== undefined && v._0.$ === "Unknown");
    }
  }
};

/// Attach a callback to be invoked on each root obligation evaluated in the new trait solver.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1780 attach_obligation_inspector
InferCtxt.prototype.attach_obligation_inspector = function (this: InferCtxt, inspector: ObligationInspector): void {
  // debug_assert!(self.obligation_inspector.get().is_none(), "shouldn't override a set obligation inspector");
  this.obligation_inspector = inspector;
};

// ---- InferenceLiteralEraser (mod.rs:1791) -----------------------------------------------------------------------------

/// `impl TypeFolder<TyCtxt> for InferenceLiteralEraser`.
// PORT: the struct is the generated interface `InferenceLiteralEraser`; its `TypeFolder` impl is a folder object over it
// (the provided methods come from `TypeFolder_provided`).
function InferenceLiteralEraser_folder(self: InferenceLiteralEraser): TypeFolder {
  const folder: TypeFolder = {
    // rustc: compiler/rustc_infer/src/infer/mod.rs:1796 cx
    cx(): TyCtxt {
      return self.tcx;
    },

    // rustc: compiler/rustc_infer/src/infer/mod.rs:1800 fold_ty
    fold_ty(ty: Ty): Ty {
      const k = ty.kind();
      if (k.$ === "Infer" && (k._0.$ === "IntVar" || k._0.$ === "FreshIntTy")) {
        return self.tcx.types.i32;
      } else if (k.$ === "Infer" && (k._0.$ === "FloatVar" || k._0.$ === "FreshFloatTy")) {
        return self.tcx.types.f64;
      } else {
        return fold_Ty.super_fold_with(ty, folder);
      }
    },

    fold_binder: <T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> => TypeFolder_provided.fold_binder(folder, t, d),
    fold_region: (r: Region): Region => TypeFolder_provided.fold_region(folder, r),
    fold_const: (c: Const): Const => TypeFolder_provided.fold_const(folder, c),
    fold_predicate: <P>(p: P, d: PredicateProxy<P>): P => TypeFolder_provided.fold_predicate(folder, p, d),
    fold_clauses: (c: Clauses): Clauses => TypeFolder_provided.fold_clauses(folder, c),
  };
  return folder;
}

// ---- impl TypeTrace (mod.rs:1809) -------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/mod.rs:1810 span
TypeTrace.prototype.span = function (this: TypeTrace): Span {
  return this.cause.span;
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1814 types
TypeTrace.types = function (cause: ObligationCause, a: Ty, b: Ty): TypeTrace {
  return new TypeTrace(clone_ObligationCause(cause), { $: "Terms", _0: ExpectedFound.new(Term.from_Ty(a), Term.from_Ty(b)) });
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1821 trait_refs
TypeTrace.trait_refs = function (cause: ObligationCause, a: TraitRef, b: TraitRef): TypeTrace {
  return new TypeTrace(clone_ObligationCause(cause), { $: "TraitRefs", _0: ExpectedFound.new(a, b) });
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1829 consts
TypeTrace.consts = function (cause: ObligationCause, a: Const, b: Const): TypeTrace {
  return new TypeTrace(clone_ObligationCause(cause), { $: "Terms", _0: ExpectedFound.new(Term.from_Const(a), Term.from_Const(b)) });
};

// ---- impl SubregionOrigin (mod.rs:1841) -------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/mod.rs:1842 span
SubregionOrigin.span = function (self: SubregionOrigin): Span {
  switch (self.$) {
    case "Subtype":
      return self._0.span();
    case "RelateObjectBound":
      return self._0;
    case "RelateParamBound":
      return self._0;
    case "RelateRegionParamBound":
      return self._0;
    case "Reborrow":
      return self._0;
    case "ReferenceOutlivesReferent":
      return self._1;
    case "CompareImplItemObligation":
      return self.span;
    case "AscribeUserTypeProvePredicate":
      return self._0;
    case "CheckAssociatedTypeBounds":
      return SubregionOrigin.span(self.parent);
    case "SolverRegionConstraint":
      return self._0;
  }
};

// rustc: compiler/rustc_infer/src/infer/mod.rs:1857 from_obligation_cause
SubregionOrigin.from_obligation_cause = function (cause: ObligationCause, default_: () => SubregionOrigin): SubregionOrigin {
  const code = cause.code_();
  switch (code.$) {
    case "ReferenceOutlivesReferent": {
      const ref_type = code._0;
      return { $: "ReferenceOutlivesReferent", _0: ref_type, _1: cause.span };
    }

    case "CompareImplItem": {
      const { impl_item_def_id, trait_item_def_id } = code;
      return { $: "CompareImplItemObligation", span: cause.span, impl_item_def_id, trait_item_def_id };
    }

    case "CheckAssociatedTypeBounds": {
      const { impl_item_def_id, trait_item_def_id } = code;
      return { $: "CheckAssociatedTypeBounds", impl_item_def_id, trait_item_def_id, parent: default_() };
    }

    case "AscribeUserTypeProvePredicate": {
      return { $: "AscribeUserTypeProvePredicate", _0: code._0, _1: code._1 };
    }

    case "ObjectTypeBound": {
      const ty = code._0;
      return { $: "RelateRegionParamBound", _0: cause.span, _1: ty };
    }

    default:
      return default_();
  }
};

// ---- impl RegionVariableOrigin (mod.rs:1898) --------------------------------------------------------------------------

export type RegionVariableOrigin = gen.RegionVariableOrigin;
export const RegionVariableOrigin: Companions["RegionVariableOrigin"] = {
  // rustc: compiler/rustc_infer/src/infer/mod.rs:1899 span
  span(self: RegionVariableOrigin): Span {
    switch (self.$) {
      case "Misc":
      case "PatternRegion":
      case "BorrowRegion":
      case "Autoref":
      case "Coercion":
      case "RegionParameterDefinition":
      case "BoundRegion":
        return self._0;
      case "UpvarRegion":
        return self._1;
      case "Nll":
        return bug("NLL variable used with `span`");
    }
  },
};

// ---- impl InferCtxt (mod.rs:1914) -------------------------------------------------------------------------------------

/// Given a [`hir::Block`], get the span of its last expression or
/// statement, peeling off any inner blocks.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1917 find_block_span
InferCtxt.prototype.find_block_span = function (this: InferCtxt, block_: hir.Block): Span {
  const block = block_.innermost_block();
  if (block.expr !== undefined) {
    return block.expr.span;
  } else if (block.stmts.length > 0) {
    const stmt = block.stmts[block.stmts.length - 1]!;
    // possibly incorrect trailing `;` in the else arm
    return stmt.span;
  } else {
    // empty block; point at its entirety
    return block.span;
  }
};

/// Given a [`hir::HirId`] for a block (or an expr of a block), get the span
/// of its last expression or statement, peeling off any inner blocks.
// rustc: compiler/rustc_infer/src/infer/mod.rs:1932 find_block_span_from_hir_id
InferCtxt.prototype.find_block_span_from_hir_id = function (this: InferCtxt, hir_id: HirId): Span {
  const node = this.tcx.hir_node(hir_id);
  if (node.$ === "Block") {
    return this.find_block_span(node._0);
  } else if (node.$ === "Expr" && node._0.kind.$ === "Block") {
    return this.find_block_span(node._0.kind._0);
  } else if (node.$ === "Expr") {
    return node._0.span;
  } else {
    return DUMMY_SP;
  }
};

/// Returns unresolved root variables from `table`, according to `is_unresolved`.
// PORT: `V: UnifyKey` is the table's key dictionary (`table.values.Key`): `V::from_index` and `==` (`Key.eq`).
// rustc: compiler/rustc_infer/src/infer/mod.rs:1945 unresolved_root_variables_of
function unresolved_root_variables_of<V, Value>(table: UnificationTable<V, Value>, is_unresolved: (value: Value) => boolean): V[] {
  const Key = table.values.Key;
  const out: V[] = [];
  const len = table.len();
  for (let i = 0; i < len; i++) {
    const vid = Key.from_index(i);
    // NB: as of writing this `ena` doesn't provide a non-inlined `probe_key_value`...
    const [root, value] = table.inlined_probe_key_value(vid);
    if (Key.eq(root, vid) && is_unresolved(value)) {
      out.push(vid);
    }
  }
  return out;
}

// ---- helpers ----------------------------------------------------------------------------------------------------------

/** `IndexVec` / `Vec` indexing (`v[i]`, panics out of bounds). */
function index_vec<T>(v: readonly T[], i: number): T {
  if (i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

/** `impl Clone for Assumptions` (derived). */
// PORT: the `TransitiveRelation`s are frozen (never mutated after `freeze`), so the clone shares them; `type_outlives`
// holds interned values.
function clone_Assumptions(v: Assumptions): Assumptions {
  return { type_outlives: v.type_outlives.slice(), region_outlives: v.region_outlives, inverse_region_outlives: v.inverse_region_outlives };
}

/** D4 descriptor of `ty::SubtypePredicate` (derived `TypeFoldable`, rustc_type_ir predicate.gen.ts). */
const fold_SubtypePredicate: TypeFoldable<SubtypePredicate> = {
  visit_with: visit_with_SubtypePredicate,
  try_fold_with: try_fold_with_SubtypePredicate,
  fold_with: fold_with_SubtypePredicate,
};

/** `TypeVisitable` of `Vec<ty::Binder<OutlivesClause<Ty>>>` (`Assumptions::type_outlives`). */
const visit_Vec_PolyTypeOutlivesClause: TypeVisitable<Binder<OutlivesClause<Ty>>[]> = {
  visit_with: (s, v) => visit_with_Vec(s, v, (b, v) => visit_with_Binder(b, v, (c, v) => visit_with_OutlivesClause(c, v, visit_with_Ty))),
};
const debug_Vec_PolyTypeOutlivesClause: Debug<Binder<OutlivesClause<Ty>>[]> = (v, f) =>
  debug_vec(v, f, (b, f) => debug_Binder(b, f, (c, f) => debug_OutlivesClause(c, f, debug_Ty)));

/** `TypeVisitable` of `SolverRegionConstraint` (`RegionConstraint<TyCtxt, Span>`; the `Span` is visited trivially). */
const visit_SolverRegionConstraint: TypeVisitable<SolverRegionConstraint> = {
  visit_with: (s, v) => visit_with_RegionConstraint(s, v, visit_with_trivial),
};
