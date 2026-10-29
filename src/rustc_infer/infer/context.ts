// Port of compiler/rustc_infer/src/infer/context.rs (lane infer-relate).
//
//! Definition of `InferCtxtLike` from the librarified type layer.
//
// `impl InferCtxtLike for InferCtxt` (docs/handoff/infcx-contract.md "Representation" 4):
// - the methods declared in ../decls.ts (`// infer/context.rs:<line>`) are assigned onto `InferCtxt.prototype` below,
//   in upstream order; the 8 whose inherent namesake has another signature are `ir_<name>`;
// - the 25 trait methods that only call the inherent method of the same name with the same signature are served by
//   that prototype method: their markers sit on comments and they are never assigned here (that would recurse
//   forever; the rustc_resolve macros.ts precedent). `probe` / `commit_if_ok` belong to them: the inherent methods take
//   a `(snapshot) => T` closure, so the trait's `() => T` closure is accepted as is (it ignores the snapshot).
// PORT: `OpaqueTypeTable: Deref<Target = OpaqueTypeStorage>` is the explicit `.deref()` (decls.ts).
// PORT: `impl TypeFolder for LowerUniverseFolder`: the generated `LowerUniverseFolder` is a field interface (it has no
// inherent methods), so the impl is the class `TypeFolder_LowerUniverseFolder` holding the struct as `self_`.
// Init order: top-level code here touches only ../decls.ts, this file's .gen.ts and other crates; the other rustc_infer
// modules are read inside function bodies only.
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { debug_Ty, ProvisionalHiddenType, Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import type { ConstVid } from "../../rustc_type_ir/const_kind.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import type { FloatVid, IntVid, TyVid, OpaqueTypeKey, RegionVid } from "../../rustc_type_ir/decls.ts";
import type { FloatVarValue, IntVarValue } from "../../rustc_type_ir/ty_kind.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { Assumptions, RegionConstraint } from "../../rustc_type_ir/region_constraint.ts";
import { VisibleForLeakCheck } from "../../rustc_type_ir/solve/mod.ts";
import { Const, debug_Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { type Debug, PLAIN } from "../../std/fmt.ts";
import { panic, unwrap } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { InferCtxt } from "../decls.ts";
import type { OpaqueTypeStorageEntries } from "./opaque_types/table.ts";
import { ConstVidKey_from } from "./unify_key.ts";
import type { LowerUniverseFolder } from "./context.gen.ts";
import { BoundRegionConversionTime, type RegionVariableOrigin, type SubregionOrigin } from "./mod.ts";

export * from "./context.gen.ts";

// `impl<'tcx> rustc_type_ir::InferCtxtLike for InferCtxt<'tcx>` (`type Interner = TyCtxt<'tcx>`)

// rustc: compiler/rustc_infer/src/infer/context.rs:23 cx
InferCtxt.prototype.cx = function (this: InferCtxt): TyCtxt {
  return this.tcx;
};

// rustc: compiler/rustc_infer/src/infer/context.rs:27 next_trait_solver
// (served by the inherent `InferCtxt::next_trait_solver`, mod.rs:734: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:31 enable_next_solver_overflow_fcw
InferCtxt.prototype.enable_next_solver_overflow_fcw = function (this: InferCtxt): boolean {
  return this.enable_next_solver_overflow_fcw_;
};

// rustc: compiler/rustc_infer/src/infer/context.rs:35 disable_trait_solver_fast_paths
// (served by the inherent `InferCtxt::disable_trait_solver_fast_paths`, mod.rs:764: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:39 typing_mode_raw
// (served by the inherent `InferCtxt::typing_mode_raw`, mod.rs:759: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:43 universe
// (served by the inherent `InferCtxt::universe`, mod.rs:1662: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:47 create_next_universe
// (served by the inherent `InferCtxt::create_next_universe`, mod.rs:1668: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:51 insert_placeholder_assumptions
// (served by the inherent `InferCtxt::insert_placeholder_assumptions`, mod.rs:1585: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:59 get_placeholder_assumptions
// (served by the inherent `InferCtxt::get_placeholder_assumptions`, mod.rs:1603: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:66 get_solver_region_constraint
InferCtxt.prototype.ir_get_solver_region_constraint = function (this: InferCtxt): RegionConstraint {
  return RegionConstraint.without_spans(this.get_solver_region_constraint());
};

// rustc: compiler/rustc_infer/src/infer/context.rs:72 has_placeholder_assumptions
// (served by the inherent `InferCtxt::has_placeholder_assumptions`, mod.rs:1610: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:76 overwrite_solver_region_constraint
InferCtxt.prototype.ir_overwrite_solver_region_constraint = function (this: InferCtxt, constraint: RegionConstraint, span: Span): void {
  this.overwrite_solver_region_constraint(RegionConstraint.with_spans(constraint, span));
};

// rustc: compiler/rustc_infer/src/infer/context.rs:84 universe_of_ty
InferCtxt.prototype.universe_of_ty = function (this: InferCtxt, vid: TyVid): UniverseIndex | undefined {
  const r = this.try_resolve_ty_var(vid);
  switch (r.$) {
    case "Err": {
      const universe = r._0;
      return universe;
    }
    case "Ok":
      return undefined;
  }
};

// rustc: compiler/rustc_infer/src/infer/context.rs:91 universe_of_region
InferCtxt.prototype.ir_universe_of_region = function (this: InferCtxt, lt: RegionVid): UniverseIndex | undefined {
  const r = this.inner.unwrap_region_constraints().try_resolve_region_var(lt);
  switch (r.$) {
    case "Err": {
      const universe = r._0;
      return universe;
    }
    case "Ok":
      return undefined;
  }
};

// rustc: compiler/rustc_infer/src/infer/context.rs:98 universe_of_const
InferCtxt.prototype.universe_of_const = function (this: InferCtxt, ct: ConstVid): UniverseIndex | undefined {
  const r = this.try_resolve_const_var(ct);
  switch (r.$) {
    case "Err": {
      const universe = r._0;
      return universe;
    }
    case "Ok":
      return undefined;
  }
};

// rustc: compiler/rustc_infer/src/infer/context.rs:105 root_ty_var
InferCtxt.prototype.root_ty_var = function (this: InferCtxt, var_: TyVid): TyVid {
  return this.root_var(var_);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:109 sub_unification_table_root_var
// (served by the inherent `InferCtxt::sub_unification_table_root_var`, mod.rs:1391: the same prototype method)

// #[inline]
// rustc: compiler/rustc_infer/src/infer/context.rs:114 is_sub_unification_table_root_var
InferCtxt.prototype.is_sub_unification_table_root_var = function (this: InferCtxt, vid: TyVid): boolean {
  // PORT: (perf) `sub_unification_table_ref().try_probe_value(TyVidSubKey::from(vid)).is_some()` via the direct
  // read-only method.
  return this.inner.type_variable_storage.is_sub_unification_table_root(vid);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:123 root_const_var
// (served by the inherent `InferCtxt::root_const_var`, mod.rs:1399: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:127 shallow_resolve_ty_var
// (served by the inherent `InferCtxt::shallow_resolve_ty_var`, mod.rs:1414: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:131 shallow_resolve_int_var
// (served by the inherent `InferCtxt::shallow_resolve_int_var`, mod.rs:1423: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:135 shallow_resolve_float_var
// (served by the inherent `InferCtxt::shallow_resolve_float_var`, mod.rs:1437: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:139 shallow_resolve_const_var
// (served by the inherent `InferCtxt::shallow_resolve_const_var`, mod.rs:1405: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:143 shallow_resolve_region_var
InferCtxt.prototype.shallow_resolve_region_var = function (this: InferCtxt, vid: RegionVid): Region {
  return this.inner.unwrap_region_constraints().shallow_resolve_region_var(this.tcx, vid);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:150 ty_or_const_infer_var_changed
// (served by the inherent `InferCtxt::ty_or_const_infer_var_changed`, mod.rs:1758: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:154 next_region_infer
InferCtxt.prototype.next_region_infer = function (this: InferCtxt): Region {
  return this.next_region_var({ $: "Misc", _0: DUMMY_SP });
};

// rustc: compiler/rustc_infer/src/infer/context.rs:158 next_ty_infer
InferCtxt.prototype.next_ty_infer = function (this: InferCtxt): Ty {
  return this.next_ty_var(DUMMY_SP);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:162 next_const_infer
InferCtxt.prototype.next_const_infer = function (this: InferCtxt): Const {
  return this.next_const_var(DUMMY_SP);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:166 fresh_args_for_item
InferCtxt.prototype.ir_fresh_args_for_item = function (this: InferCtxt, def_id: DefId): GenericArgs {
  return this.fresh_args_for_item(DUMMY_SP, def_id);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:170 instantiate_binder_with_infer
InferCtxt.prototype.instantiate_binder_with_infer = function <T>(this: InferCtxt, value: Binder<T>, d_T: TypeFoldable<T>): T {
  return this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.HigherRankedType, value, d_T);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:181 enter_forall_without_assumptions
InferCtxt.prototype.enter_forall_without_assumptions = function <T, U>(this: InferCtxt, value: Binder<T>, f: (value: T) => U, d_T: TypeFoldable<T>): U {
  return this.enter_forall(value, f, d_T);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:189 enter_forall_with_empty_assumptions
InferCtxt.prototype.enter_forall_with_empty_assumptions = function <T, U>(this: InferCtxt, value: Binder<T>, f: (value: T) => U, d_T: TypeFoldable<T>): U {
  return this.enter_forall(
    value,
    (value) => {
      const u = this.universe();
      this.placeholder_assumptions_for_next_solver.set(u, Assumptions.empty());
      return f(value);
    },
    d_T,
  );
};

// rustc: compiler/rustc_infer/src/infer/context.rs:203 equate_ty_vids_raw
InferCtxt.prototype.equate_ty_vids_raw = function (this: InferCtxt, a: TyVid, b: TyVid): void {
  this.inner.type_variables().equate(a, b);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:207 sub_unify_ty_vids_raw
// (served by the inherent `InferCtxt::sub_unify_ty_vids_raw`, mod.rs:1387: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:211 equate_int_vids_raw
InferCtxt.prototype.equate_int_vids_raw = function (this: InferCtxt, a: IntVid, b: IntVid): void {
  this.inner.int_unification_table().union(a, b);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:215 equate_float_vids_raw
InferCtxt.prototype.equate_float_vids_raw = function (this: InferCtxt, a: FloatVid, b: FloatVid): void {
  this.inner.float_unification_table().union(a, b);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:219 equate_const_vids_raw
InferCtxt.prototype.equate_const_vids_raw = function (this: InferCtxt, a: ConstVid, b: ConstVid): void {
  this.inner.const_unification_table().union(ConstVidKey_from(a), ConstVidKey_from(b));
};

// rustc: compiler/rustc_infer/src/infer/context.rs:223 instantiate_ty_var_raw
InferCtxt.prototype.instantiate_ty_var_raw = function (this: InferCtxt, vid: TyVid, ty: Ty): void {
  ty = lower_universe(this, unwrap_err(this.try_resolve_ty_var(vid), debug_Ty), ty, fold_Ty);

  this.inner.type_variables().instantiate(vid, ty);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:229 instantiate_const_var_raw
InferCtxt.prototype.instantiate_const_var_raw = function (this: InferCtxt, vid: ConstVid, ct: Const): void {
  ct = lower_universe(this, unwrap_err(this.try_resolve_const_var(vid), debug_Const), ct, fold_Const);

  this.inner.const_unification_table().union_value(ConstVidKey_from(vid), { $: "Known", value: ct });
};

// rustc: compiler/rustc_infer/src/infer/context.rs:238 instantiate_ty_var
// (served by the inherent `InferCtxt::instantiate_ty_var`, relate/generalize.rs:47: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:255 instantiate_int_var_raw
InferCtxt.prototype.instantiate_int_var_raw = function (this: InferCtxt, vid: IntVid, value: IntVarValue): void {
  this.inner.int_unification_table().union_value(vid, value);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:259 instantiate_float_var_raw
InferCtxt.prototype.instantiate_float_var_raw = function (this: InferCtxt, vid: FloatVid, value: FloatVarValue): void {
  this.inner.float_unification_table().union_value(vid, value);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:263 instantiate_const_var
// (served by the inherent `InferCtxt::instantiate_const_var`, relate/generalize.rs:101: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:273 set_tainted_by_errors
// (served by the inherent `InferCtxt::set_tainted_by_errors`, mod.rs:1100: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:277 shallow_resolve
// (served by the inherent `InferCtxt::shallow_resolve`, mod.rs:1274: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:280 shallow_resolve_const
// (served by the inherent `InferCtxt::shallow_resolve_const`, mod.rs:1341: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:284 deeply_resolve_ignoring_regions
// (served by the inherent `InferCtxt::deeply_resolve_ignoring_regions`, mod.rs:1454: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:291 probe
// (served by the inherent `InferCtxt::probe`, snapshot/mod.rs:101: the trait's `() => T` closure ignores the snapshot)

// rustc: compiler/rustc_infer/src/infer/context.rs:295 commit_if_ok
// (served by the inherent `InferCtxt::commit_if_ok`, snapshot/mod.rs:81: the trait's closure ignores the snapshot)

// rustc: compiler/rustc_infer/src/infer/context.rs:299 sub_regions
InferCtxt.prototype.ir_sub_regions = function (this: InferCtxt, sub: Region, sup: Region, vis: VisibleForLeakCheck, span: Span): void {
  this.inner.unwrap_region_constraints().make_subregion({ $: "RelateRegionParamBound", _0: span, _1: undefined }, sub, sup, vis);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:314 equate_regions
InferCtxt.prototype.ir_equate_regions = function (this: InferCtxt, a: Region, b: Region, vis: VisibleForLeakCheck, span: Span): void {
  this.inner.unwrap_region_constraints().make_eqregion({ $: "RelateRegionParamBound", _0: span, _1: undefined }, a, b, vis);
};

// rustc: compiler/rustc_infer/src/infer/context.rs:329 register_solver_region_constraint
InferCtxt.prototype.ir_register_solver_region_constraint = function (this: InferCtxt, c: RegionConstraint, span: Span): void {
  this.register_solver_region_constraint(RegionConstraint.with_spans(c, span));
};

// rustc: compiler/rustc_infer/src/infer/context.rs:337 register_ty_outlives
InferCtxt.prototype.register_ty_outlives = function (this: InferCtxt, ty: Ty, r: Region, span: Span): void {
  this.register_type_outlives_constraint(ty, r, ObligationCause.dummy_with_span(span));
};

// `type OpaqueTypeStorageEntries = OpaqueTypeStorageEntries;`
// #[inline]
// rustc: compiler/rustc_infer/src/infer/context.rs:343 opaque_types_storage_num_entries
InferCtxt.prototype.opaque_types_storage_num_entries = function (this: InferCtxt): OpaqueTypeStorageEntries {
  // PORT: (perf) `self.inner.borrow_mut().opaque_types().num_entries()`: `opaque_types()` builds an
  // `OpaqueTypeTable` view whose `Deref` is the storage itself; read the storage directly (hot: every stalled-goal
  // check).
  return this.inner.opaque_type_storage.num_entries();
};

// rustc: compiler/rustc_infer/src/infer/context.rs:346 clone_opaque_types_lookup_table
InferCtxt.prototype.clone_opaque_types_lookup_table = function (this: InferCtxt): [OpaqueTypeKey, Ty][] {
  const out: [OpaqueTypeKey, Ty][] = [];
  for (const [k, h] of this.inner.opaque_types().deref().iter_lookup_table()) out.push([k, h.ty]);
  return out;
};

// rustc: compiler/rustc_infer/src/infer/context.rs:349 clone_duplicate_opaque_types
InferCtxt.prototype.clone_duplicate_opaque_types = function (this: InferCtxt): [OpaqueTypeKey, Ty][] {
  const out: [OpaqueTypeKey, Ty][] = [];
  for (const [k, h] of this.inner.opaque_types().deref().iter_duplicate_entries()) out.push([k, h.ty]);
  return out;
};

// rustc: compiler/rustc_infer/src/infer/context.rs:357 clone_opaque_types_added_since
InferCtxt.prototype.clone_opaque_types_added_since = function (this: InferCtxt, prev_entries: OpaqueTypeStorageEntries): [OpaqueTypeKey, Ty][] {
  const out: [OpaqueTypeKey, Ty][] = [];
  for (const [k, h] of this.inner.opaque_types().deref().opaque_types_added_since(prev_entries)) out.push([k, h.ty]);
  return out;
};

// rustc: compiler/rustc_infer/src/infer/context.rs:368 opaques_with_sub_unified_hidden_type
// (served by the inherent `InferCtxt::opaques_with_sub_unified_hidden_type`, mod.rs:1161: the same prototype method)

// rustc: compiler/rustc_infer/src/infer/context.rs:372 register_hidden_type_in_storage
InferCtxt.prototype.ir_register_hidden_type_in_storage = function (this: InferCtxt, opaque_type_key: OpaqueTypeKey, hidden_ty: Ty, span: Span): Ty | undefined {
  return this.register_hidden_type_in_storage(opaque_type_key, new ProvisionalHiddenType(span, hidden_ty));
};

// rustc: compiler/rustc_infer/src/infer/context.rs:383 add_duplicate_opaque_type
InferCtxt.prototype.add_duplicate_opaque_type = function (this: InferCtxt, opaque_type_key: OpaqueTypeKey, hidden_ty: Ty, span: Span): void {
  this.inner.opaque_types().add_duplicate(opaque_type_key, new ProvisionalHiddenType(span, hidden_ty));
};

// rustc: compiler/rustc_infer/src/infer/context.rs:395 reset_opaque_types
InferCtxt.prototype.reset_opaque_types = function (this: InferCtxt): void {
  void this.take_opaque_types();
};

/** `Result::unwrap_err` (the panic formats the `Ok` value with `{:?}`). */
function unwrap_err<T, E>(r: Result<T, E>, debug_T: Debug<T>): E {
  if (r.$ === "Err") return r._0;
  return panic(`called \`Result::unwrap_err()\` on an \`Ok\` value: ${debug_T(r._0, PLAIN)}`);
}

// rustc: compiler/rustc_infer/src/infer/context.rs:400 lower_universe
function lower_universe<T>(infcx: InferCtxt, for_universe: UniverseIndex, value: T, d_T: TypeFoldable<T>): T {
  value = d_T.fold_with(value, new TypeFolder_LowerUniverseFolder({ infcx, for_universe, cache: new Map() }));

  // This assertion is needed because we don't lower the universes of placeholders
  // in the folder.
  // #[cfg(debug_assertions)]
  // {
  //     let value_universe = ty::max_universe(infcx, value);
  //     assert!(
  //         for_universe.can_name(value_universe),
  //         "variable in universe {:?} can't name value in universe {:?}",
  //         for_universe,
  //         value_universe,
  //     );
  // }

  return value;
}

/** `impl<'a, 'tcx> ty::TypeFolder<TyCtxt<'tcx>> for LowerUniverseFolder<'a, 'tcx>` (see the module comment). */
class TypeFolder_LowerUniverseFolder implements TypeFolder {
  constructor(public self_: LowerUniverseFolder) {}

  // rustc: compiler/rustc_infer/src/infer/context.rs:443 cx
  cx(): TyCtxt {
    return this.self_.infcx.tcx;
  }

  // rustc: compiler/rustc_infer/src/infer/context.rs:447 fold_ty
  fold_ty(t: Ty): Ty {
    const self_ = this.self_;
    if (!(TypeVisitableExt.has_free_regions(t, fold_Ty) || TypeVisitableExt.has_infer(t, fold_Ty))) {
      return t;
    }

    const answer = self_.cache.get(t);
    if (answer !== undefined) {
      return answer;
    }

    let folded: Ty;
    const tk = t.kind();
    if (tk.$ === "Infer" && tk._0.$ === "TyVar") {
      const vid = self_.infcx.root_var(tk._0._0);
      const probe = self_.infcx.inner.type_variables().probe(vid);
      switch (probe.$) {
        case "Known": {
          const u = probe.value;
          folded = fold_Ty.super_fold_with(u, this);
          break;
        }
        case "Unknown": {
          const universe = probe.universe;
          if (UniverseIndex.can_name(self_.for_universe, universe)) {
            folded = t;
          } else {
            const inner = self_.infcx.inner;
            const origin = inner.type_variables().var_origin(vid);
            const new_var_id = inner.type_variables().new_var(self_.for_universe, origin);
            inner.type_variables().equate(vid, new_var_id);
            folded = Ty.new_var(this.cx(), new_var_id);
          }
          break;
        }
      }
    } else {
      folded = fold_Ty.super_fold_with(t, this);
    }

    self_.cache.set(t, folded);
    return folded;
  }

  // rustc: compiler/rustc_infer/src/infer/context.rs:483 fold_const
  fold_const(c: Const): Const {
    const self_ = this.self_;
    if (!(TypeVisitableExt.has_free_regions(c, fold_Const) || TypeVisitableExt.has_infer(c, fold_Const))) {
      return c;
    }

    const ck = c.kind();
    if (ck.$ === "Infer" && ck._0.$ === "Var") {
      const vid = self_.infcx.root_const_var(ck._0._0);
      let universe: UniverseIndex;
      const r = self_.infcx.try_resolve_const_var(vid);
      switch (r.$) {
        case "Ok": {
          const value = r._0;
          return fold_Const.fold_with(value, this);
        }
        case "Err":
          universe = r._0;
          break;
      }
      if (UniverseIndex.can_name(self_.for_universe, universe)) {
        return c;
      } else {
        const origin = unwrap(self_.infcx.const_var_origin(vid));
        const new_var_id = self_.infcx.inner.const_unification_table().new_key({
          $: "Unknown",
          origin,
          universe: self_.for_universe,
        }).vid;

        self_.infcx.inner.const_unification_table().union(ConstVidKey_from(vid), ConstVidKey_from(new_var_id));

        return Const.new_var(this.cx(), new_var_id);
      }
    } else {
      return fold_Const.super_fold_with(c, this);
    }
  }

  // rustc: compiler/rustc_infer/src/infer/context.rs:519 fold_region
  fold_region(r: Region): Region {
    const self_ = this.self_;
    const rk = r.kind();
    switch (rk.$) {
      case "ReBound":
      case "ReErased":
        return r;
      default: {
        const r_universe = self_.infcx.universe_of_region(r);
        if (UniverseIndex.can_name(self_.for_universe, r_universe)) {
          return r;
        } else {
          // FIXME: unfortunately we lose the relating span here unless we take another
          // argument.
          const new_region = self_.infcx.next_region_var_in_universe({ $: "Misc", _0: DUMMY_SP } satisfies RegionVariableOrigin, self_.for_universe);
          self_.infcx.equate_regions({ $: "RelateRegionParamBound", _0: DUMMY_SP, _1: undefined } satisfies SubregionOrigin, r, new_region, VisibleForLeakCheck.Yes);
          return new_region;
        }
      }
    }
  }

  // (provided) `TypeFolder::fold_binder`
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  // (provided) `TypeFolder::fold_predicate`
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  // (provided) `TypeFolder::fold_clauses`
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

