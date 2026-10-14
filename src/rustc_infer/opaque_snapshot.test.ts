// Tests of lane infer-opaque-snapshot on a real `InferCtxt` (`tcx.infer_ctxt().build(..)` over fresh interners):
// - snapshot/mod.rs: `start_snapshot` / `rollback_to` / `commit_from` / `probe` / `commit_if_ok` undo every
//   `UndoLog` kind of snapshot/undo_log.rs, nested snapshots, `region_constraints_added_in_snapshot`,
//   `opaque_types_added_in_snapshot`, `variable_lengths`;
// - snapshot/fudge.rs: `fudge_inference_if_ok` replaces the variables created in the snapshot by fresh ones;
// - opaque_types/{mod,table}.rs: registration, duplicates, keyed lookup, rollback (`remove` / `swap_remove`),
//   `insert_hidden_type` per typing mode;
// - traits/{mod,engine,project,util,structural_impls}.rs: `Obligation`, `TraitErrors`, the projection cache,
//   `PredicateSet`, `Elaboratable`, the manual `Debug` impls.
//
// PORT(test): methods of the parallel wave-16 lanes (infer-core: `universe`, `next_*_var`, `typing_mode_raw`, ...;
// infer-regions: `RegionConstraintCollector`) are still `unported` placeholders on this branch. `standin` installs the
// upstream body of each one for the duration of this file, only while it is a placeholder (after the merge the real
// ports run instead). `deeply_resolve_ignoring_regions`'s stand-in is the identity: the tests pass it only values whose
// inference variables are unresolved, for which upstream's resolver returns the value unchanged.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "./lib.ts";
import { unported_stub_path } from "../rust_ts/stubs.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { ParamEnv, ProvisionalHiddenType, Ty } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef } from "../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { DefId, DefIndex, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import type { OpaqueTypeKey, RegionVid, TyVid, UniverseIndex as UniverseIndexT } from "../rustc_type_ir/decls.ts";
import { TypeError } from "../rustc_type_ir/error.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { TypingMode as TypingModeT } from "../rustc_type_ir/infer_ctxt.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { UniverseIndex } from "../rustc_type_ir/lib.ts";
import { as_interner, TraitRef } from "../rustc_type_ir/predicate.ts";
import { Const, Region } from "../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../rustc_type_ir/term_kind.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, Panic, Unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { InferCtxt, InferCtxtInner } from "./decls.ts";
import { RegionConstraintCollector, RegionConstraintStorage } from "./infer/region_constraints/mod.ts";
import type { RegionSnapshot, UndoLog as RegionUndoLog, RegionVariableInfo } from "./infer/region_constraints/mod.ts";
import { OpaqueTypeStorage } from "./infer/opaque_types/table.ts";
import { UndoLog } from "./infer/snapshot/undo_log.ts";
import type { Snapshot } from "./infer/snapshot/undo_log.ts";
import type { RegionVariableOrigin } from "./infer/mod.ts";
import type { FloatVariableOrigin, TypeVariableOrigin } from "./infer/type_variable.ts";
import type { ConstVariableOrigin } from "./infer/unify_key.ts";
import { ConstVidKey_from } from "./infer/unify_key.ts";
import { Obligation, ScrubbedTraitError, TraitEngine_provided, TraitErrors, type TraitEngine, type PredicateObligation } from "./traits/mod.ts";
import { ProjectionCacheKey, Normalized, debug_MismatchedProjectionTypes } from "./traits/project.ts";
import { Elaboratable_PredicateObligation, PredicateSet, anonymize_predicate, transitive_bounds_that_define_assoc_item } from "./traits/util.ts";
import type { Range } from "../vendor/ena/unify/mod.ts";

// ---- stand-ins for the parallel lanes' placeholders ------------------------------------------------------------------

const restore: (() => void)[] = [];
function standin<T extends object>(proto: T, name: string, f: (this: never, ...args: never[]) => unknown): void {
  const rec = proto as Record<string, unknown>;
  const old = rec[name];
  if (unported_stub_path(old) === undefined) return;
  rec[name] = f;
  restore.push(() => {
    rec[name] = old;
  });
}

beforeAll(() => {
  const icx = InferCtxt.prototype;
  // infer/mod.rs (lane infer-core)
  standin(icx, "universe", function (this: InferCtxt) {
    return this.universe_;
  });
  standin(icx, "next_trait_solver", function (this: InferCtxt) {
    return this.next_trait_solver_;
  });
  standin(icx, "typing_mode_raw", function (this: InferCtxt) {
    return this.typing_mode;
  });
  standin(icx, "next_ty_var_with_origin", function (this: InferCtxt, origin: TypeVariableOrigin) {
    return Ty.new_var(this.tcx, this.inner.type_variables().new_var(this.universe(), origin));
  });
  standin(icx, "next_int_var", function (this: InferCtxt) {
    return Ty.new_int_var(this.tcx, this.inner.int_unification_table().new_key({ $: "Unknown" }));
  });
  standin(icx, "next_float_var", function (this: InferCtxt, span: FloatVariableOrigin["span"], lint_id: FloatVariableOrigin["lint_id"]) {
    const inner = this.inner;
    const next_float_var_id = inner.float_unification_table().new_key({ $: "Unknown" });
    inner.float_origin_origin_storage.push({ span, lint_id });
    return Ty.new_float_var(this.tcx, next_float_var_id);
  });
  standin(icx, "next_const_var_with_origin", function (this: InferCtxt, origin: ConstVariableOrigin) {
    const vid = this.inner.const_unification_table().new_key({ $: "Unknown", origin, universe: this.universe() }).vid;
    return Const.new_var(this.tcx, vid);
  });
  standin(icx, "next_region_var", function (this: InferCtxt, origin: RegionVariableOrigin) {
    return this.next_region_var_in_universe(origin, this.universe());
  });
  standin(icx, "next_region_var_in_universe", function (this: InferCtxt, origin: RegionVariableOrigin, universe: UniverseIndexT) {
    return Region.new_var(this.tcx, this.inner.unwrap_region_constraints().new_region_var(universe, origin));
  });
  standin(icx, "deeply_resolve_ignoring_regions", function (this: InferCtxt, value: unknown) {
    return value;
  });
  // region_constraints/mod.rs (lane infer-regions)
  const rcs = RegionConstraintStorage.prototype;
  standin(rcs, "with_log", function (this: RegionConstraintStorage, undo_log: InferCtxtInner["undo_log"]) {
    return new RegionConstraintCollector(this, undo_log);
  });
  standin(rcs, "reverse", function (this: RegionConstraintStorage, undo: RegionUndoLog) {
    switch (undo.$) {
      case "AddVar":
        assert(this.var_infos.pop() !== undefined);
        assert(this.var_infos.length === undo._0);
        break;
      case "AddConstraint":
        assert(this.data.constraints.pop() !== undefined);
        assert(this.data.constraints.length === undo._0);
        break;
      default:
        throw new Error(`stand-in: ${undo.$}`);
    }
  });
  const rcc = RegionConstraintCollector.prototype;
  standin(rcc, "num_region_vars", function (this: RegionConstraintCollector) {
    return this.storage.var_infos.length;
  });
  standin(rcc, "start_snapshot", function (this: RegionConstraintCollector): RegionSnapshot {
    return { any_unifications: this.storage.any_unifications };
  });
  standin(rcc, "rollback_to", function (this: RegionConstraintCollector, snapshot: RegionSnapshot) {
    this.storage.any_unifications = snapshot.any_unifications;
  });
  standin(rcc, "unification_table_mut", function (this: RegionConstraintCollector) {
    return this.storage.unification_table.with_log(this.undo_log.as_(UndoLog.from_RegionUnificationTable));
  });
  standin(rcc, "new_region_var", function (this: RegionConstraintCollector, universe: UniverseIndexT, origin: RegionVariableOrigin) {
    const vid = this.storage.var_infos.length as RegionVid;
    this.storage.var_infos.push({ origin, universe } satisfies RegionVariableInfo);
    const u_vid = this.unification_table_mut().new_key({ $: "Unknown", universe });
    assert(vid === u_vid.vid);
    this.undo_log.push(UndoLog.from_RegionConstraintCollector({ $: "AddVar", _0: vid }));
    return vid;
  });
  standin(rcc, "vars_since_snapshot", function (this: RegionConstraintCollector, value_count: number) {
    const range: Range<RegionVid> = { start: value_count as RegionVid, end: this.storage.unification_table.len() as RegionVid };
    const origins: RegionVariableOrigin[] = [];
    for (let i = value_count; i < range.end; i++) origins.push(this.storage.var_infos[i]!.origin);
    return [range, origins];
  });
  standin(rcc, "region_constraints_added_in_snapshot", function (this: RegionConstraintCollector, mark: Snapshot) {
    return this.undo_log.region_constraints_in_snapshot(mark).some((elt) => elt.$ === "AddConstraint");
  });
});

afterAll(() => {
  for (const r of restore.reverse()) r();
});

// ---- fixtures --------------------------------------------------------------------------------------------------------

/** A `TyCtxt` over fresh `CtxtInterners` (as contract.test.ts). */
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => true;
  return tcx;
}

function mk_infcx(mode: TypingModeT = TypingMode.non_body_analysis()): InferCtxt {
  return mk_tcx().infer_ctxt().with_next_trait_solver(false).build(mode);
}

const ty_origin: TypeVariableOrigin = { span: DUMMY_SP, param_def_id: undefined };
const misc: RegionVariableOrigin = { $: "Misc", _0: DUMMY_SP };
const def_id = (n: number): DefId => new DefId(DefIndex.from_u32(n), LOCAL_CRATE);

function opaque_key(tcx: TyCtxt, n: number, args: GenericArg[] = []): OpaqueTypeKey {
  return { def_id: LocalDefId.of(DefIndex.from_u32(n)), args: tcx.mk_args(args) };
}

function trait_pred(tcx: TyCtxt, n: number, self_ty: Ty): PredicateObligation["predicate"] {
  return Predicate_upcast_from_TraitRef(TraitRef.new(as_interner(tcx), def_id(n), [GenericArg.from_Ty(self_ty)]), tcx);
}

function projection_key(tcx: TyCtxt, n: number): ProjectionCacheKey {
  return ProjectionCacheKey.new(AliasTerm.new_from_args(tcx, { $: "ProjectionTy", def_id: def_id(n) }, tcx.mk_args([])), ParamEnv.empty());
}

/** A snapshot of every table the undo log covers (to compare before / after a rollback). */
function tables(infcx: InferCtxt): unknown {
  const inner = infcx.inner;
  return {
    ty_vars: inner.type_variables().num_vars(),
    int_vars: inner.int_unification_storage.len(),
    float_vars: inner.float_unification_storage.len(),
    const_vars: inner.const_unification_storage.len(),
    region_vars: inner.region_constraint_storage!.var_infos.length,
    region_unify: inner.region_constraint_storage!.unification_table.len(),
    constraints: inner.region_constraint_storage!.data.constraints.length,
    projection_cache: [...inner.projection_cache_.map.map.keys()].length,
    opaque_types: [...inner.opaque_type_storage.iter_lookup_table()].map(([k, v]) => [k.def_id, v.ty]),
    duplicates: inner.opaque_type_storage.duplicate_entries.length,
    region_obligations: inner.region_obligations_.length,
    region_assumptions: inner.region_assumptions_.length,
    solver_region_constraint: inner.solver_region_constraint_storage.get_constraint(),
    hir_goals: inner.hir_typeck_potentially_region_dependent_goals.length,
    universe: infcx.universe_,
  };
}

// ---- snapshot/mod.rs -------------------------------------------------------------------------------------------------

describe("snapshot/mod.rs", () => {
  test("rollback_to undoes every UndoLog kind and restores the universe", () => {
    const infcx = mk_infcx();
    const tcx = infcx.tcx;
    const inner = infcx.inner;
    // Some state from before the snapshot, which must survive the rollback.
    const a = inner.type_variables().new_var(UniverseIndex.ROOT, ty_origin);
    const key1 = opaque_key(tcx, 1);
    expect(infcx.register_hidden_type_in_storage(key1, new ProvisionalHiddenType(DUMMY_SP, tcx.types.i32))).toBeUndefined();
    expect(infcx.in_snapshot()).toBe(false);
    const before = tables(infcx);

    const snapshot = infcx.start_snapshot();
    expect(infcx.in_snapshot()).toBe(true);
    expect(infcx.num_open_snapshots()).toBe(1);
    expect(snapshot.universe).toBe(UniverseIndex.ROOT);
    infcx.universe_ = UniverseIndex.from_u32(3);

    // TypeVariables (eq + sub relations), Int/Float/ConstUnificationTable
    const b = inner.type_variables().new_var(UniverseIndex.ROOT, ty_origin);
    inner.type_variables().equate(a, b);
    infcx.next_int_var();
    infcx.next_float_var(DUMMY_SP, undefined);
    infcx.next_const_var_with_origin({ span: DUMMY_SP, param_def_id: undefined });
    // RegionConstraintCollector (AddVar) + RegionUnificationTable
    infcx.next_region_var(misc);
    // RegionConstraintCollector (AddConstraint), as `add_constraint` (region_constraints/mod.rs:457) logs it
    const rstore = inner.region_constraint_storage!;
    const index = rstore.data.constraints.length;
    rstore.data.constraints.push([{ kind: "VarSubVar", sub: tcx.lifetimes.re_static, sup: tcx.lifetimes.re_static, visible_for_leak_check: "Yes" } as never, { $: "RelateParamBound", _0: DUMMY_SP, _1: tcx.types.i32, _2: undefined } as never]);
    inner.undo_log.push(UndoLog.from_RegionConstraintCollector({ $: "AddConstraint", _0: index }));
    expect(infcx.region_constraints_added_in_snapshot(snapshot)).toBe(true);
    // ProjectionCache
    expect(inner.projection_cache().try_start(projection_key(tcx, 7))).toEqual(Ok(null));
    // OpaqueTypes (overwrite of an old entry and a fresh one) + DuplicateOpaqueType
    expect(infcx.register_hidden_type_in_storage(opaque_key(tcx, 1), new ProvisionalHiddenType(DUMMY_SP, tcx.types.u8))).toBe(tcx.types.i32);
    expect(infcx.register_hidden_type_in_storage(opaque_key(tcx, 2), new ProvisionalHiddenType(DUMMY_SP, tcx.types.bool))).toBeUndefined();
    inner.opaque_types().add_duplicate(opaque_key(tcx, 1), new ProvisionalHiddenType(DUMMY_SP, tcx.types.char));
    expect(infcx.opaque_types_added_in_snapshot(snapshot)).toBe(true);
    // PushTypeOutlivesConstraint / PushRegionAssumption / PushHirTypeckPotentiallyRegionDependentGoal /
    // OverwriteSolverRegionConstraint, as their (other lanes') registering fns log them
    inner.region_obligations_.push({} as never);
    inner.undo_log.push({ $: "PushTypeOutlivesConstraint" });
    inner.region_assumptions_.push({} as never);
    inner.undo_log.push({ $: "PushRegionAssumption" });
    inner.hir_typeck_potentially_region_dependent_goals.push({} as never);
    inner.undo_log.push({ $: "PushHirTypeckPotentiallyRegionDependentGoal" });
    const old_constraint = inner.solver_region_constraint_storage.get_constraint();
    inner.undo_log.push({ $: "OverwriteSolverRegionConstraint", old_constraint });
    inner.solver_region_constraint_storage.overwrite({ $: "Ambiguity" } as never);

    const kinds = new Set(inner.undo_log.logs.map((l) => l.$));
    expect([...kinds].sort() as string[]).toEqual(
      [
        "ConstUnificationTable",
        "DuplicateOpaqueType",
        "FloatUnificationTable",
        "IntUnificationTable",
        "OpaqueTypes",
        "OverwriteSolverRegionConstraint",
        "ProjectionCache",
        "PushHirTypeckPotentiallyRegionDependentGoal",
        "PushRegionAssumption",
        "PushTypeOutlivesConstraint",
        "RegionConstraintCollector",
        "RegionUnificationTable",
        "TypeVariables",
      ].sort(),
    );
    expect(tables(infcx)).not.toEqual(before);

    infcx.rollback_to(snapshot);
    expect(tables(infcx)).toEqual(before);
    // `float_origin_origin_storage` is not undo-logged upstream (an `IndexVec` outside the ena tables): it keeps the origin.
    expect(inner.float_origin_origin_storage.length).toBe(1);
    expect(infcx.in_snapshot()).toBe(false);
    expect(inner.undo_log.logs).toEqual([]);
    expect(inner.type_variables().root_var(a)).toBe(a);
    // the overwritten entry is back to its old hidden type
    expect([...inner.opaque_type_storage.iter_lookup_table()].map(([, v]) => v.ty)).toEqual([tcx.types.i32]);
  });

  test("commit_from keeps the changes; nested snapshots roll back to the inner mark", () => {
    const infcx = mk_infcx();
    const outer = infcx.start_snapshot();
    infcx.next_int_var();
    const inner_s = infcx.start_snapshot();
    expect(infcx.num_open_snapshots()).toBe(2);
    infcx.next_int_var();
    infcx.next_ty_var_with_origin(ty_origin);
    infcx.rollback_to(inner_s);
    expect(infcx.inner.int_unification_storage.len()).toBe(1);
    expect(infcx.inner.type_variables().num_vars()).toBe(0);
    expect(infcx.inner.undo_log.logs.length).toBe(1);
    infcx.commit_from(outer);
    expect(infcx.num_open_snapshots()).toBe(0);
    expect(infcx.inner.int_unification_storage.len()).toBe(1);
    // committing the root snapshot clears the log
    expect(infcx.inner.undo_log.logs).toEqual([]);
  });

  test("probe always rolls back; commit_if_ok rolls back on Err only", () => {
    const infcx = mk_infcx();
    const r = infcx.probe((s) => {
      expect(s.undo_snapshot.undo_len).toBe(0);
      infcx.next_ty_var_with_origin(ty_origin);
      return 42;
    });
    expect(r).toBe(42);
    expect(infcx.inner.type_variables().num_vars()).toBe(0);

    const err = infcx.commit_if_ok((): Result<number, string> => {
      infcx.next_ty_var_with_origin(ty_origin);
      return Err("no");
    });
    expect(err).toEqual(Err("no"));
    expect(infcx.inner.type_variables().num_vars()).toBe(0);

    const ok = infcx.commit_if_ok((): Result<number, string> => {
      infcx.next_ty_var_with_origin(ty_origin);
      return Ok(1);
    });
    expect(ok).toEqual(Ok(1));
    expect(infcx.inner.type_variables().num_vars()).toBe(1);
    expect(infcx.num_open_snapshots()).toBe(0);
  });

  test("variable_lengths; nothing added means no region constraints / opaque types in the snapshot", () => {
    const infcx = mk_infcx();
    infcx.next_ty_var_with_origin(ty_origin);
    infcx.next_ty_var_with_origin(ty_origin);
    infcx.next_float_var(DUMMY_SP, undefined);
    infcx.next_region_var(misc);
    expect(infcx.variable_lengths()).toEqual({ region_constraints_len: 1, type_var_len: 2, int_var_len: 0, float_var_len: 1, const_var_len: 0 });
    const s = infcx.start_snapshot();
    infcx.next_region_var(misc);
    expect(infcx.region_constraints_added_in_snapshot(s)).toBe(false);
    expect(infcx.opaque_types_added_in_snapshot(s)).toBe(false);
    infcx.rollback_to(s);
    expect(infcx.variable_lengths().region_constraints_len).toBe(1);
  });
});

// ---- snapshot/fudge.rs -----------------------------------------------------------------------------------------------

describe("snapshot/fudge.rs", () => {
  const d_Ty: TypeFoldable<Ty> = fold_Ty;

  test("fudge_inference_if_ok replaces the variables created in the snapshot by fresh ones", () => {
    const infcx = mk_infcx();
    const tcx = infcx.tcx;
    const old_ty = infcx.next_ty_var_with_origin(ty_origin);
    const origin2: TypeVariableOrigin = { span: DUMMY_SP, param_def_id: def_id(5) };
    let inside: Ty[] = [];
    const r = infcx.fudge_inference_if_ok((): Result<Ty, null> => {
      const t = infcx.next_ty_var_with_origin(origin2);
      const i = infcx.next_int_var();
      const f = infcx.next_float_var(DUMMY_SP, undefined);
      const re = infcx.next_region_var(misc);
      const c = infcx.next_const_var_with_origin({ span: DUMMY_SP, param_def_id: undefined });
      inside = [t, i, f];
      return Ok(Ty.new_tup(tcx, [old_ty, Ty.new_imm_ref(tcx, re, t), i, f, Ty.new_array_with_const_len(tcx, tcx.types.u8, c)]));
    }, d_Ty);
    expect(r.$).toBe("Ok");
    const value = (r as { _0: Ty })._0;
    // The probe popped the inner variables; the fudger created new ones (same indices: the tables were rolled back).
    const tys = value.kind().$ === "Tuple" ? (value.kind() as { _0: readonly Ty[] })._0 : [];
    expect(tys.length).toBe(5);
    expect(tys[0]).toBe(old_ty);
    expect(infcx.inner.type_variables().num_vars()).toBe(2);
    expect(infcx.inner.type_variables().var_origin(1 as TyVid)).toBe(origin2);
    expect(infcx.inner.int_unification_storage.len()).toBe(1);
    expect(infcx.inner.float_unification_storage.len()).toBe(1);
    // the probe's origin stays (not undo-logged upstream), the fudger pushed the fresh variable's
    expect(infcx.inner.float_origin_origin_storage.length).toBe(2);
    expect(infcx.inner.const_unification_storage.len()).toBe(1);
    expect(infcx.inner.region_constraint_storage!.var_infos.length).toBe(1);
    expect(infcx.inner.const_unification_table().probe_value(ConstVidKey_from(0 as never)).$).toBe("Unknown");
    // the fresh variables are interned like the popped ones (same vids)
    expect(tys[2]).toBe(inside[1]!);
    expect(tys[3]).toBe(inside[2]!);
    expect(infcx.num_open_snapshots()).toBe(0);
  });

  test("fudge_inference_if_ok: Err passes through and nothing is fudged without new variables", () => {
    const infcx = mk_infcx();
    const err = infcx.fudge_inference_if_ok((): Result<Ty, string> => {
      infcx.next_ty_var_with_origin(ty_origin);
      return Err("e");
    }, d_Ty);
    expect(err).toEqual(Err("e"));
    expect(infcx.inner.type_variables().num_vars()).toBe(0);
    const t = infcx.next_ty_var_with_origin(ty_origin);
    const ok = infcx.fudge_inference_if_ok((): Result<Ty, string> => Ok(t), d_Ty);
    expect(ok).toEqual(Ok(t));
    expect(infcx.inner.type_variables().num_vars()).toBe(1);
  });
});

// ---- opaque_types/{mod,table}.rs -------------------------------------------------------------------------------------

describe("opaque_types", () => {
  test("the storage is keyed by value; num_entries / added_since / take", () => {
    const infcx = mk_infcx();
    const tcx = infcx.tcx;
    const st = infcx.inner.opaque_type_storage;
    expect(st).toBeInstanceOf(OpaqueTypeStorage);
    expect(st.is_empty()).toBe(true);
    const args = [GenericArg.from_Ty(tcx.types.i32)];
    infcx.register_hidden_type_in_storage(opaque_key(tcx, 1, args), new ProvisionalHiddenType(DUMMY_SP, tcx.types.u8));
    const e1 = st.num_entries();
    // a structurally equal key (a fresh object) finds the entry
    expect(infcx.register_hidden_type_in_storage(opaque_key(tcx, 1, args), new ProvisionalHiddenType(DUMMY_SP, tcx.types.u16))).toBe(tcx.types.u8);
    infcx.register_hidden_type_in_storage(opaque_key(tcx, 2), new ProvisionalHiddenType(DUMMY_SP, tcx.types.u32));
    infcx.inner.opaque_types().add_duplicate(opaque_key(tcx, 2), new ProvisionalHiddenType(DUMMY_SP, tcx.types.u64));
    expect(st.num_entries()).toEqual({ opaque_types: 2, duplicate_entries: 1 } as never);
    expect(e1.needs_reevaluation(1)).toBe(false);
    expect(st.num_entries().needs_reevaluation(1)).toBe(true);
    expect([...st.opaque_types_added_since(e1)].map(([k, v]) => [k.def_id, v.ty])).toEqual([
      [2, tcx.types.u32],
      [2, tcx.types.u64],
    ] as never);
    expect([...st.iter_duplicate_entries()].length).toBe(1);
    expect([...st.iter_opaque_types()].map(([, v]) => v.ty)).toEqual([tcx.types.u16, tcx.types.u32, tcx.types.u64]);
    expect(infcx.inner.opaque_types().deref()).toBe(st);
    expect([...st.take_opaque_types()].length).toBe(3);
    expect(st.is_empty()).toBe(true);
  });

  test("rollback removes with swap_remove semantics; an unregistered key is a bug", () => {
    const infcx = mk_infcx();
    const tcx = infcx.tcx;
    const st = infcx.inner.opaque_type_storage;
    for (const n of [1, 2, 3]) infcx.register_hidden_type_in_storage(opaque_key(tcx, n), new ProvisionalHiddenType(DUMMY_SP, tcx.types.i8));
    // `swap_remove` of the first entry moves the last one into its slot
    st.remove(opaque_key(tcx, 1), undefined);
    expect([...st.iter_lookup_table()].map(([k]) => k.def_id)).toEqual([3, 2] as never);
    st.remove(opaque_key(tcx, 3), new ProvisionalHiddenType(DUMMY_SP, tcx.types.u8));
    expect([...st.iter_lookup_table()].map(([, v]) => v.ty)).toEqual([tcx.types.u8, tcx.types.i8]);
    expect(() => st.remove(opaque_key(tcx, 9), undefined)).toThrow(Panic);
    expect(() => st.remove(opaque_key(tcx, 9), undefined)).toThrow(/reverted opaque type inference that was never registered: OpaqueTypeKey \{ def_id: DefId \{ krate: crate0, index: DefIndex\(9\) \}, args: \[\] \}/);
    expect(() => st.pop_duplicate_entry()).toThrow(/assertion failed: entry.is_some\(\)/);
  });

  test("insert_hidden_type per typing mode", () => {
    // Coherence: never defines, forces ambiguity
    {
      const infcx = mk_infcx({ $: "Coherence" } as TypingModeT);
      const goals: Parameters<InferCtxt["insert_hidden_type"]>[4] = [];
      expect(infcx.insert_hidden_type(opaque_key(infcx.tcx, 1), DUMMY_SP, ParamEnv.empty(), infcx.tcx.types.i32, goals)).toEqual(Ok(null));
      expect(goals.length).toBe(1);
      expect(goals[0]!.predicate.kind().value).toEqual({ $: "Ambiguous" } as never);
      expect(infcx.inner.opaque_type_storage.is_empty()).toBe(true);
    }
    // Typeck: the first definition is stored, no goals
    {
      const tcx = mk_tcx();
      const mode = { $: "Typeck", defining_opaque_types_and_generators: tcx.mk_local_def_ids([LocalDefId.of(DefIndex.from_u32(1))]) } as TypingModeT;
      const infcx = tcx.infer_ctxt().with_next_trait_solver(false).build(mode);
      const s = infcx.start_snapshot();
      const goals: Parameters<InferCtxt["insert_hidden_type"]>[4] = [];
      expect(infcx.insert_hidden_type(opaque_key(tcx, 1), DUMMY_SP, ParamEnv.empty(), tcx.types.i32, goals)).toEqual(Ok(null));
      expect(goals).toEqual([]);
      expect([...infcx.inner.opaque_type_storage.iter_lookup_table()].map(([, v]) => v.ty)).toEqual([tcx.types.i32]);
      expect(infcx.opaque_types_added_in_snapshot(s)).toBe(true);
      infcx.rollback_to(s);
      expect(infcx.inner.opaque_type_storage.is_empty()).toBe(true);
    }
    // post-analysis modes are a bug
    {
      const infcx = mk_infcx({ $: "PostAnalysis" } as TypingModeT);
      expect(() => infcx.insert_hidden_type(opaque_key(infcx.tcx, 1), DUMMY_SP, ParamEnv.empty(), infcx.tcx.types.i32, [])).toThrow(/insert hidden type in PostAnalysis/);
    }
  });

  test("replace_opaque_types_with_inference_vars is the identity without opaque types / with the next solver", () => {
    const infcx = mk_infcx();
    const ok = infcx.replace_opaque_types_with_inference_vars(infcx.tcx.types.i32, LocalDefId.of(DefIndex.from_u32(0)), DUMMY_SP, ParamEnv.empty(), fold_Ty);
    expect(ok.value).toBe(infcx.tcx.types.i32);
    expect(ok.obligations).toEqual([]);
    const next = mk_tcx().infer_ctxt().build(TypingMode.non_body_analysis());
    expect(next.replace_opaque_types_with_inference_vars(next.tcx.types.u8, LocalDefId.of(DefIndex.from_u32(0)), DUMMY_SP, ParamEnv.empty(), fold_Ty).value).toBe(next.tcx.types.u8);
  });
});

// ---- traits ----------------------------------------------------------------------------------------------------------

describe("traits", () => {
  test("Obligation: new / with / with_depth / set_depth_from_parent / eq / as_goal / flip_polarity", () => {
    const tcx = mk_tcx();
    const p = trait_pred(tcx, 3, tcx.types.i32);
    const upcast_self = <T>(x: T): T => x;
    const o = Obligation.new(tcx, ObligationCause.dummy(), ParamEnv.empty(), p, upcast_self);
    expect(o.recursion_depth).toBe(0);
    expect(o.predicate).toBe(p);
    o.set_depth_from_parent(4);
    expect(o.recursion_depth).toBe(5);
    o.set_depth_from_parent(1);
    expect(o.recursion_depth).toBe(5);
    const o2 = o.with(tcx, trait_pred(tcx, 3, tcx.types.i32), upcast_self);
    expect(o2.recursion_depth).toBe(5);
    expect(o2.cause).not.toBe(o.cause);
    // `eq` ignores the cause and the depth
    expect(o.eq(Obligation.with_depth(tcx, ObligationCause.dummy_with_span(DUMMY_SP), 9, ParamEnv.empty(), p, upcast_self))).toBe(true);
    expect(o.eq(Obligation.new(tcx, ObligationCause.dummy(), ParamEnv.empty(), trait_pred(tcx, 4, tcx.types.i32), upcast_self))).toBe(false);
    expect(o.as_goal()).toEqual({ param_env: o.param_env, predicate: p });
    const flipped = o.flip_polarity(tcx)!;
    expect(flipped.predicate).not.toBe(p);
    expect(flipped.flip_polarity(tcx)!.predicate).toBe(p);
    expect(flipped.recursion_depth).toBe(5);
  });

  test("TraitErrors / ScrubbedTraitError", () => {
    expect(TraitErrors.from_iter([])).toBe(TraitErrors.NoErrors);
    let e = TraitErrors.from_iter([1, 2]);
    expect(TraitErrors.has_errors(e)).toBe(true);
    expect(TraitErrors.no_errors(TraitErrors.NoErrors)).toBe(true);
    e = TraitErrors.push(e, 3);
    expect(TraitErrors.len(e)).toBe(3);
    expect(TraitErrors.as_slice(TraitErrors.NoErrors)).toEqual([]);
    let n: TraitErrors<number> = TraitErrors.NoErrors;
    n = TraitErrors.push(n, 7);
    expect(n).toEqual({ $: "HasErrors", _0: [7] });
    expect([...TraitErrors.into_iter(e)]).toEqual([1, 2, 3]);
    expect([...TraitErrors.into_iter_ref(e)]).toEqual([1, 2, 3]);
    expect(TraitErrors.into_thin_vec(TraitErrors.NoErrors)).toEqual([]);
    expect(ScrubbedTraitError.is_true_error(ScrubbedTraitError.TrueError)).toBe(true);
    expect(ScrubbedTraitError.is_true_error(ScrubbedTraitError.Ambiguity)).toBe(false);
    expect(ScrubbedTraitError.is_true_error({ $: "Cycle", _0: [] })).toBe(false);
  });

  test("TraitEngine's provided methods", () => {
    const infcx = mk_infcx();
    const tcx = infcx.tcx;
    const registered: PredicateObligation[] = [];
    let collected = 0;
    const engine: TraitEngine<string> = {
      register_bound: (...a) => TraitEngine_provided.register_bound(engine, ...a),
      register_predicate_obligation: (_infcx, o) => void registered.push(o),
      register_predicate_obligations: (...a) => TraitEngine_provided.register_predicate_obligations(engine, ...a),
      try_evaluate_obligations: () => (registered.length > 2 ? TraitErrors.from_iter(["err"]) : TraitErrors.NoErrors),
      collect_remaining_errors: () => (collected++, TraitErrors.from_iter(["ambig"])),
      evaluate_obligations_error_on_ambiguity: (...a) => TraitEngine_provided.evaluate_obligations_error_on_ambiguity(engine, ...a),
      has_pending_obligations: () => registered.length > 0,
      pending_obligations: () => registered.slice(),
      pending_obligations_potentially_referencing_sub_root: (...a) => TraitEngine_provided.pending_obligations_potentially_referencing_sub_root(engine, ...a),
      pending_obligations_potentially_referencing_float_infer: (...a) => TraitEngine_provided.pending_obligations_potentially_referencing_float_infer(engine, ...a),
      drain_stalled_obligations_for_coroutines: () => [],
    };
    engine.register_bound(infcx, ParamEnv.empty(), tcx.types.i32, def_id(3), ObligationCause.dummy());
    expect(registered.length).toBe(1);
    expect(registered[0]!.predicate).toBe(trait_pred(tcx, 3, tcx.types.i32));
    expect(registered[0]!.recursion_depth).toBe(0);
    expect(engine.evaluate_obligations_error_on_ambiguity(infcx)).toEqual({ $: "HasErrors", _0: ["ambig"] });
    expect(collected).toBe(1);
    engine.register_predicate_obligations(infcx, [registered[0]!, registered[0]!]);
    expect(engine.evaluate_obligations_error_on_ambiguity(infcx)).toEqual({ $: "HasErrors", _0: ["err"] });
    expect(collected).toBe(1);
    expect(engine.pending_obligations_potentially_referencing_sub_root(infcx, 0 as TyVid).length).toBe(3);
    expect(engine.pending_obligations_potentially_referencing_float_infer(infcx).length).toBe(3);
  });

  test("the projection cache: try_start / insert_term / complete / recur / rollback", () => {
    const infcx = mk_infcx();
    const tcx = infcx.tcx;
    const key = projection_key(tcx, 1);
    const cache = (): ReturnType<InferCtxtInner["projection_cache"]> => infcx.inner.projection_cache();
    expect(cache().try_start(key)).toEqual(Ok(null));
    // a structurally equal key (fresh object) hits the cache
    expect(cache().try_start(projection_key(tcx, 1))).toEqual(Err({ $: "InProgress" }));
    const p = trait_pred(tcx, 3, tcx.types.i32);
    const ob = Obligation.new(tcx, ObligationCause.dummy(), ParamEnv.empty(), p, <T>(x: T) => x);
    cache().insert_term(key, new Normalized(tcx.types.u8 as never, [ob]));
    expect(cache().is_complete(key)).toBeUndefined();
    cache().complete(key, "EvaluatedToOk");
    expect(cache().is_complete(key)).toBe("EvaluatedToOk");
    const entry = cache().try_start(key);
    expect(entry.$ === "Err" && entry._0.$ === "NormalizedTerm" ? entry._0.ty.obligations : undefined).toEqual([]);
    // `recur` is never overwritten by `insert_term`
    const key2 = projection_key(tcx, 2);
    cache().try_start(key2);
    cache().recur(key2);
    cache().insert_term(key2, new Normalized(tcx.types.u8 as never, []));
    expect(cache().try_start(key2)).toEqual(Err({ $: "Recur" }));
    // ambiguous / error / recur of a key that was never started panic (the message needs `ProjectionCacheKey`'s derived
    // Debug, whose `AliasTerm` / `ParamEnv` fields are still `unported_debug` in the generated code: see the handoff)
    expect(() => cache().ambiguous(projection_key(tcx, 3))).toThrow();
    // rollback restores the map
    const s = infcx.start_snapshot();
    cache().try_start(projection_key(tcx, 4));
    cache().error(projection_key(tcx, 4));
    cache().complete(key, "EvaluatedToAmbig");
    infcx.rollback_to(s);
    expect(cache().is_complete(key)).toBe("EvaluatedToOk");
    expect(infcx.inner.projection_cache_.map.map.has(projection_key(tcx, 4))).toBe(false);
    cache().clear();
    expect(infcx.inner.projection_cache_.map.map.size).toBe(0);
    expect(new Normalized(1, [ob]).with("x")).toEqual(new Normalized("x", [ob]));
  });

  test("util: anonymize_predicate, PredicateSet, Elaboratable, transitive bounds without input", () => {
    const tcx = mk_tcx();
    const p = trait_pred(tcx, 3, tcx.types.i32);
    expect(anonymize_predicate(tcx, p)).toBe(p);
    const set = PredicateSet.new(tcx);
    expect(set.insert(p)).toBe(true);
    expect(set.insert(trait_pred(tcx, 3, tcx.types.i32))).toBe(false);
    set.extend([trait_pred(tcx, 4, tcx.types.i32), p]);
    set.extend_one(trait_pred(tcx, 5, tcx.types.i32));
    set.extend_reserve(10);
    expect(set.set.size).toBe(3);
    const o = Obligation.with_depth(tcx, ObligationCause.dummy(), 6, ParamEnv.empty(), p, <T>(x: T) => x);
    expect(Elaboratable_PredicateObligation.predicate(o)).toBe(p);
    const clause = p.expect_clause();
    const child = Elaboratable_PredicateObligation.child(o, clause);
    expect(child.recursion_depth).toBe(0);
    expect(child.predicate).toBe(clause.as_predicate());
    const derived = Elaboratable_PredicateObligation.child_with_derived_cause(o, clause, DUMMY_SP, clause.as_trait_clause()!, 2);
    expect(derived.cause.code_().$).toBe("ImplDerived");
    expect(o.cause.code_().$).toBe("Misc");
    expect([...transitive_bounds_that_define_assoc_item(tcx, [], undefined as never)]).toEqual([]);
  });

  test("manual Debug impls (structural_impls.rs)", () => {
    expect(debug_MismatchedProjectionTypes({ err: TypeError.Mismatch }, PLAIN)).toBe("MismatchedProjectionTypes(Mismatch)");
  });

  test("placeholders of the other lanes still stop as UNPORTED", () => {
    const infcx = mk_infcx();
    if (unported_stub_path(InferCtxt.prototype.at) !== undefined) {
      expect(() => infcx.at(ObligationCause.dummy(), ParamEnv.empty())).toThrow(Unported);
    }
  });
});
