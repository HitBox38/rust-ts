// Port of compiler/rustc_infer/src/infer/mod.rs (lane infer-core; the `InferCtxtInner` impl block, `TyCtxtInferExt` and
// `InferCtxtBuilder` are ported by lane infcx-contract so that an empty `InferCtxt` can be built).
//
// The contract classes `InferCtxtInner`, `InferCtxt` and `InferCtxtBuilder` are declared in ../decls.ts (fields and every
// method); this module re-exports them, assigns the methods of this file onto their prototypes and keeps `unported`
// placeholders for the rest (fill them per docs/handoff/infcx-contract.md "How to fill a stub"). The other types of
// mod.rs (with their derived Debug / Clone / TypeFoldable) are generated into mod.gen.ts.
//
// Init order: top-level code here may touch only ../decls.ts, mod.gen.ts and other crates; every other rustc_infer
// export (the submodules) is read inside function bodies only.
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { HirIdMap } from "../../rustc_hir_id/lib.ts";
import { WithDepNodeCache } from "../../rustc_middle/traits/cache.ts";
import { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TypingEnv, ParamEnv } from "../../rustc_middle/ty/decls.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { CanonicalizerState, type CanonicalQueryInput, type CanonicalVarValues } from "../../rustc_type_ir/canonical.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { UnifyKey_FloatVid, UnifyKey_IntVid } from "../../rustc_type_ir/ty_kind.ts";
import { unported, unwrap } from "../../std/panic.ts";
import type { UndoLogs } from "../../vendor/ena/undo_log.ts";
import * as ut from "../../vendor/ena/unify/mod.ts";
import type { Companions, FreeFns } from "../decls.ts";
import { InferCtxt, InferCtxtBuilder, InferCtxtInner } from "../decls.ts";
import { default_ProjectionCacheStorage } from "../traits/project.ts";
import { clone_Obligation } from "../traits/mod.ts";
import { clone_ProjectionCacheStorage } from "../traits/project.ts";
import * as gen from "./mod.gen.ts";
import { clone_TypeOutlivesConstraint, InferOk, TypeTrace } from "./mod.gen.ts";
import { clone_OpaqueTypeStorage, default_OpaqueTypeStorage } from "./opaque_types/table.ts";
import { clone_RegionConstraintStorage, RegionConstraintStorage } from "./region_constraints/mod.ts";
import { InferCtxtUndoLogs, clone_InferCtxtUndoLogs, UndoLog } from "./snapshot/undo_log.ts";
import { clone_SolverRegionConstraintStorage, SolverRegionConstraintStorage } from "./solver_region_constraints.ts";
import { clone_FloatVariableOrigin, clone_TypeVariableStorage, TyVidEqKey_from, TypeVariableStorage } from "./type_variable.ts";
import type { TypeVariableValue } from "./type_variable.ts";
import { UnifyKey_ConstVidKey } from "./unify_key.ts";

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

// ---- impl InferCtxt (mod.rs:729): placeholders until lane infer-core ports them ----------------------------------------

unported_methods(InferCtxt.prototype, "rustc_infer::infer::InferCtxt", ["drop", "dcx", "next_trait_solver", "typing_mode_raw", "disable_trait_solver_fast_paths", "type_var_origin", "float_var_origin", "const_var_origin", "unresolved_root_variables", "sub_regions", "equate_regions", "coerce_predicate", "subtype_predicate", "num_ty_vars", "next_ty_vid", "next_ty_vid_with_origin", "next_ty_vid_in_universe", "next_ty_var", "next_ty_var_with_origin", "next_ty_var_in_universe", "next_const_var", "next_const_var_with_origin", "next_const_var_in_universe", "next_int_var", "next_float_var", "next_region_var", "next_region_var_in_universe", "next_term_var_of_alias_kind", "universe_of_region", "num_region_vars", "next_nll_region_var", "next_nll_region_var_in_universe", "var_for_def", "fresh_args_for_item", "tainted_by_errors", "set_tainted_by_errors", "region_var_origin", "get_region_var_infos", "has_opaque_types_in_storage", "take_opaque_types", "clone_opaque_types", "has_opaques_with_sub_unified_hidden_type", "opaques_with_sub_unified_hidden_type", "can_define_opaque_ty", "push_hir_typeck_potentially_region_dependent_goal", "take_hir_typeck_potentially_region_dependent_goals", "ty_to_string", "try_resolve_ty_var", "shallow_resolve_ty_var_or_get_root", "shallow_resolve", "shallow_resolve_const", "shallow_resolve_term", "root_var", "root_vid", "sub_unify_ty_vids_raw", "sub_unification_table_root_var", "root_float_var", "root_const_var", "shallow_resolve_const_var", "shallow_resolve_ty_var", "shallow_resolve_int_var", "shallow_resolve_float_var", "deeply_resolve_ignoring_regions", "deeply_resolve_via_unification_table", "resolve_numeric_literals_with_default", "try_resolve_const_var", "deeply_resolve_via_region_graph", "instantiate_binder_with_fresh_vars", "insert_placeholder_assumptions", "get_placeholder_assumptions", "has_placeholder_assumptions", "get_solver_region_constraint", "overwrite_solver_region_constraint", "verify_generic_bound", "closure_kind", "universe", "create_next_universe", "with_disabled_next_solver_overflow_fcw", "typing_env", "pseudo_canonicalize_query", "is_ty_infer_var_definitely_unchanged", "ty_or_const_infer_var_changed", "attach_obligation_inspector", "find_block_span", "find_block_span_from_hir_id"]);

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

// ---- impl InferOk / TypeTrace (generated classes) and the enum companions: placeholders ---------------------------------

unported_methods(InferOk.prototype, "rustc_infer::infer::InferOk", ["into_value_registering_obligations", "into_obligations"]);
unported_methods(TypeTrace.prototype, "rustc_infer::infer::TypeTrace", ["span"]);
unported_methods(TypeTrace, "rustc_infer::infer::TypeTrace", ["types", "trait_refs", "consts"]);

export type ValuePairs = gen.ValuePairs;
export const ValuePairs = {} as Companions["ValuePairs"];
unported_methods(ValuePairs, "rustc_infer::infer::ValuePairs", ["ty"]);

export type SubregionOrigin = gen.SubregionOrigin;
export const SubregionOrigin = {} as Companions["SubregionOrigin"];
unported_methods(SubregionOrigin, "rustc_infer::infer::SubregionOrigin", ["to_constraint_category", "span", "from_obligation_cause"]);

export type RegionVariableOrigin = gen.RegionVariableOrigin;
export const RegionVariableOrigin = {} as Companions["RegionVariableOrigin"];
unported_methods(RegionVariableOrigin, "rustc_infer::infer::RegionVariableOrigin", ["span"]);

// stub: infer/mod.rs:569
export const display_FixupError = ((): never => unported("rustc_infer::infer::<FixupError as Display>::fmt")) as FreeFns["display_FixupError"];
