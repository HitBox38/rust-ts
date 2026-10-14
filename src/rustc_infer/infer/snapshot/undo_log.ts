// Port of compiler/rustc_infer/src/infer/snapshot/undo_log.rs (lane infcx-contract: ported in full, the shared undo
// log of the ena tables). `Snapshot` is generated into undo_log.gen.ts; `UndoLog` (its variants hold ena undo logs) and
// `InferCtxtUndoLogs` (field rename) are written here.
//
// PORT (ena, as vendor/ena tests/external_undo_log.test.ts):
// - `impl<T> UndoLogs<T> for InferCtxtUndoLogs where UndoLog: From<T>` is `InferCtxtUndoLogs.as_(from)`: a view of the
//   log at one `T`, `from` being one of the `From` impls below (`UndoLog.from_<..>`). `InferCtxtUndoLogs` itself is
//   the `UndoLogs<UndoLog>` (`impl<T> From<T> for T`).
// - The field `num_open_snapshots` is `num_open_snapshots_` (the `UndoLogs` method of the same name).
// - `impl Index<usize>` / `IndexMut<usize>` are the methods `index` / `index_mut`.
// - `impl Rollback<UndoLog> for InferCtxtInner` and `InferCtxtInner::{rollback_to, commit}` are assigned onto
//   `InferCtxtInner.prototype` (the class is declared in ../../decls.ts).
import type { OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.ts";
import type { ProvisionalHiddenType } from "../../../rustc_middle/ty/mod.ts";
import { type FloatVarValue, type FloatVid, type IntVarValue, type IntVid, UnifyValue_FloatVarValue, UnifyValue_IntVarValue } from "../../../rustc_type_ir/ty_kind.ts";
import { assert } from "../../../std/panic.ts";
import { clone_UndoLog as clone_SvUndoLog } from "../../../vendor/ena/snapshot_vec.ts";
import { type UndoLogs, UndoLogs_provided } from "../../../vendor/ena/undo_log.ts";
import type { InPlaceUndoLog } from "../../../vendor/ena/unify/mod.ts";
import { InferCtxtInner } from "../../decls.ts";
import type { UndoLog as ProjectionCacheUndoLog } from "../../traits/project.ts";
import type { UndoLog as RegionConstraintsUndoLog } from "../region_constraints/mod.ts";
import { clone_UndoLog as clone_RegionConstraintsUndoLog } from "../region_constraints/mod.ts";
import type { SolverRegionConstraint } from "../solver_region_constraints.ts";
import * as type_variable from "../type_variable.ts";
import type { ConstVariableValue, ConstVidKey, RegionVariableValue, RegionVidKey } from "../unify_key.gen.ts";
import { UnifyValue_ConstVariableValue, UnifyValue_RegionVariableValue } from "../unify_key.ts";
import type { Snapshot } from "./undo_log.gen.ts";

export * from "./undo_log.gen.ts";

/// Records the "undo" data for a single operation that affects some form of inference variable.
// rustc-type: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:19 UndoLog
export type UndoLog =
  | { readonly $: "DuplicateOpaqueType" }
  | { readonly $: "OpaqueTypes"; readonly _0: OpaqueTypeKey; readonly _1: ProvisionalHiddenType | undefined }
  | { readonly $: "TypeVariables"; readonly _0: type_variable.UndoLog }
  | { readonly $: "ConstUnificationTable"; readonly _0: InPlaceUndoLog<ConstVidKey, ConstVariableValue> }
  | { readonly $: "IntUnificationTable"; readonly _0: InPlaceUndoLog<IntVid, IntVarValue> }
  | { readonly $: "FloatUnificationTable"; readonly _0: InPlaceUndoLog<FloatVid, FloatVarValue> }
  | { readonly $: "RegionConstraintCollector"; readonly _0: RegionConstraintsUndoLog }
  | { readonly $: "RegionUnificationTable"; readonly _0: InPlaceUndoLog<RegionVidKey, RegionVariableValue> }
  | { readonly $: "ProjectionCache"; readonly _0: ProjectionCacheUndoLog }
  | { readonly $: "PushTypeOutlivesConstraint" }
  | { readonly $: "OverwriteSolverRegionConstraint"; readonly old_constraint: SolverRegionConstraint }
  | { readonly $: "PushRegionAssumption" }
  | { readonly $: "PushHirTypeckPotentiallyRegionDependentGoal" };

/** `#[derive(Clone)]` of `UndoLog` (codegen skips the type). The values in the logs are immutable. */
export function clone_UndoLog(v: UndoLog): UndoLog {
  switch (v.$) {
    case "TypeVariables":
      return { $: "TypeVariables", _0: type_variable.clone_UndoLog(v._0) };
    case "ConstUnificationTable":
      return { $: "ConstUnificationTable", _0: clone_SvUndoLog(v._0, (x) => x.clone(UnifyValue_ConstVariableValue), (u) => u) };
    case "IntUnificationTable":
      return { $: "IntUnificationTable", _0: clone_SvUndoLog(v._0, (x) => x.clone(UnifyValue_IntVarValue), (u) => u) };
    case "FloatUnificationTable":
      return { $: "FloatUnificationTable", _0: clone_SvUndoLog(v._0, (x) => x.clone(UnifyValue_FloatVarValue), (u) => u) };
    case "RegionConstraintCollector":
      return { $: "RegionConstraintCollector", _0: clone_RegionConstraintsUndoLog(v._0) };
    case "RegionUnificationTable":
      return { $: "RegionUnificationTable", _0: clone_SvUndoLog(v._0, (x) => x.clone(UnifyValue_RegionVariableValue), (u) => u) };
    case "ProjectionCache":
      // PORT: `snapshot_map::UndoLog<K, V>` holds immutable keys and values.
      return v;
    case "DuplicateOpaqueType":
    case "OpaqueTypes":
    case "PushTypeOutlivesConstraint":
    case "OverwriteSolverRegionConstraint":
    case "PushRegionAssumption":
    case "PushHirTypeckPotentiallyRegionDependentGoal":
      return v;
  }
}

export const UndoLog = {
  // PORT: `impl_from!` (undo_log.rs:36) expands to one `impl From<$ty> for UndoLog` per line of its invocation
  // (undo_log.rs:49); each expansion of the macro's `fn from` (`UndoLog::$ctor(x.into())`) is one function here.
  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:40 from
  from_RegionConstraintCollector(x: RegionConstraintsUndoLog): UndoLog {
    return { $: "RegionConstraintCollector", _0: x };
  },
  from_TyVidEqKey(x: InPlaceUndoLog<type_variable.TyVidEqKey, type_variable.TypeVariableValue>): UndoLog {
    return { $: "TypeVariables", _0: type_variable.UndoLog.from_EqRelation(x) };
  },
  from_TyVidSubKey(x: InPlaceUndoLog<type_variable.TyVidSubKey, undefined>): UndoLog {
    return { $: "TypeVariables", _0: type_variable.UndoLog.from_SubRelation(x) };
  },
  from_TypeVariables(x: type_variable.UndoLog): UndoLog {
    return { $: "TypeVariables", _0: x };
  },
  from_IntUnificationTable(x: InPlaceUndoLog<IntVid, IntVarValue>): UndoLog {
    return { $: "IntUnificationTable", _0: x };
  },
  from_FloatUnificationTable(x: InPlaceUndoLog<FloatVid, FloatVarValue>): UndoLog {
    return { $: "FloatUnificationTable", _0: x };
  },
  from_ConstUnificationTable(x: InPlaceUndoLog<ConstVidKey, ConstVariableValue>): UndoLog {
    return { $: "ConstUnificationTable", _0: x };
  },
  from_RegionUnificationTable(x: InPlaceUndoLog<RegionVidKey, RegionVariableValue>): UndoLog {
    return { $: "RegionUnificationTable", _0: x };
  },
  from_ProjectionCache(x: ProjectionCacheUndoLog): UndoLog {
    return { $: "ProjectionCache", _0: x };
  },
};

// ---- impl Rollback<UndoLog> for InferCtxtInner -----------------------------------------------------------------------

declare module "../../decls.ts" {
  interface InferCtxtInner {
    /** `impl Rollback<UndoLog> for InferCtxtInner` (undo_log.rs:66). */
    reverse(undo: UndoLog): void;
  }
}

/// The Rollback trait defines how to rollback a particular action.
// rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:66 reverse
InferCtxtInner.prototype.reverse = function (this: InferCtxtInner, undo: UndoLog): void {
  switch (undo.$) {
    case "DuplicateOpaqueType":
      this.opaque_type_storage.pop_duplicate_entry();
      break;
    case "OpaqueTypes":
      this.opaque_type_storage.remove(undo._0, undo._1);
      break;
    case "TypeVariables":
      this.type_variable_storage.reverse(undo._0);
      break;
    case "ConstUnificationTable":
      this.const_unification_storage.reverse(undo._0);
      break;
    case "IntUnificationTable":
      this.int_unification_storage.reverse(undo._0);
      break;
    case "FloatUnificationTable":
      this.float_unification_storage.reverse(undo._0);
      break;
    case "RegionConstraintCollector":
      unwrap_storage(this).reverse(undo._0);
      break;
    case "RegionUnificationTable":
      unwrap_storage(this).unification_table.reverse(undo._0);
      break;
    case "ProjectionCache":
      this.projection_cache_.reverse(undo._0);
      break;
    case "OverwriteSolverRegionConstraint":
      this.solver_region_constraint_storage.overwrite(undo.old_constraint);
      break;
    case "PushTypeOutlivesConstraint": {
      const popped = this.region_obligations_.pop();
      assert(popped !== undefined, "pushed region constraint but could not pop it");
      break;
    }
    case "PushRegionAssumption": {
      const popped = this.region_assumptions_.pop();
      assert(popped !== undefined, "pushed region assumption but could not pop it");
      break;
    }
    case "PushHirTypeckPotentiallyRegionDependentGoal": {
      const popped = this.hir_typeck_potentially_region_dependent_goals.pop();
      assert(popped !== undefined, "pushed goal but could not pop it");
      break;
    }
  }
};

/** `self.region_constraint_storage.as_mut().unwrap()` */
function unwrap_storage(self: InferCtxtInner): NonNullable<InferCtxtInner["region_constraint_storage"]> {
  const storage = self.region_constraint_storage;
  assert(storage !== undefined, "called `Option::unwrap()` on a `None` value");
  return storage!;
}

// ---- InferCtxtUndoLogs -----------------------------------------------------------------------------------------------

/// The combined undo log for all the various unification tables. For each change to the storage
/// for any kind of inference variable, we record an UndoLog entry in the vector here.
// rustc-type: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:103 InferCtxtUndoLogs
export class InferCtxtUndoLogs implements UndoLogs<UndoLog> {
  constructor(
    public logs: UndoLog[],
    // PORT: `num_open_snapshots_` (the `UndoLogs::num_open_snapshots` method has the field's name).
    public num_open_snapshots_: number,
  ) {}

  /** `#[derive(Default)]` */
  static default_(): InferCtxtUndoLogs {
    return new InferCtxtUndoLogs([], 0);
  }

  /** The `UndoLogs<T>` impl at one `T` (`UndoLog: From<T>` is `from`). */
  as_<T>(from: (t: T) => UndoLog): UndoLogs<T> {
    return new InferCtxtUndoLogsAt(this, from);
  }

  // `UndoLogs<UndoLog>` (`impl<T> From<T> for T`): the methods below delegate to the view at `UndoLog`.
  in_snapshot(): boolean {
    return UndoLogs_provided.in_snapshot(this);
  }
  num_open_snapshots(): number {
    return this.as_<UndoLog>((u) => u).num_open_snapshots();
  }
  push(undo: UndoLog): void {
    this.as_<UndoLog>((u) => u).push(undo);
  }
  clear(): void {
    this.as_<UndoLog>((u) => u).clear();
  }
  extend(undos: Iterable<UndoLog>): void {
    this.as_<UndoLog>((u) => u).extend(undos);
  }

  // ---- impl InferCtxtUndoLogs ----

  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:178 start_snapshot
  start_snapshot(): Snapshot {
    this.num_open_snapshots_ += 1;
    return { undo_len: this.logs.length, _marker: undefined };
  }

  // PORT: `impl Iterator<Item = &UndoLog> + Clone` is an array.
  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:183 region_constraints_in_snapshot
  region_constraints_in_snapshot(s: Snapshot): RegionConstraintsUndoLog[] {
    const out: RegionConstraintsUndoLog[] = [];
    for (const log of this.logs.slice(s.undo_len)) {
      if (log.$ === "RegionConstraintCollector") {
        out.push(log._0);
      }
    }
    return out;
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:193 opaque_types_in_snapshot
  opaque_types_in_snapshot(s: Snapshot): boolean {
    return this.logs.slice(s.undo_len).some((log) => log.$ === "OpaqueTypes");
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:197 assert_open_snapshot
  assert_open_snapshot(snapshot: Snapshot): void {
    // Failures here may indicate a failure to follow a stack discipline.
    assert(this.logs.length >= snapshot.undo_len, "assertion failed: self.logs.len() >= snapshot.undo_len");
    assert(this.num_open_snapshots_ > 0, "assertion failed: self.num_open_snapshots > 0");
  }

  // ---- impl std::ops::Index<usize> / IndexMut<usize> for InferCtxtUndoLogs ----

  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:207 index
  index(key: number): UndoLog {
    return index_vec(this.logs, key);
  }

  // PORT: `&mut UndoLog` is the element (the caller assigns `logs[key]` to replace it).
  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:213 index_mut
  index_mut(key: number): UndoLog {
    return index_vec(this.logs, key);
  }
}

/** `self.logs[key]` (panics out of bounds, as slice indexing). */
function index_vec(logs: UndoLog[], key: number): UndoLog {
  assert(key < logs.length, `index out of bounds: the len is ${logs.length} but the index is ${key}`);
  return logs[key]!;
}

/** `#[derive(Clone)]` of `InferCtxtUndoLogs` (a hand type: codegen does not derive its Clone). */
export function clone_InferCtxtUndoLogs(v: InferCtxtUndoLogs): InferCtxtUndoLogs {
  return new InferCtxtUndoLogs(v.logs.map(clone_UndoLog), v.num_open_snapshots_);
}

/// The UndoLogs trait defines how we undo a particular kind of action (of type T). We can undo any
/// action that is convertible into an UndoLog (per the From impls above).
/** `impl<'tcx, T> UndoLogs<T> for InferCtxtUndoLogs<'tcx> where UndoLog<'tcx>: From<T>` */
class InferCtxtUndoLogsAt<T> implements UndoLogs<T> {
  constructor(
    readonly self_: InferCtxtUndoLogs,
    readonly from: (t: T) => UndoLog,
  ) {}

  in_snapshot(): boolean {
    return UndoLogs_provided.in_snapshot(this);
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:115 num_open_snapshots
  num_open_snapshots(): number {
    return this.self_.num_open_snapshots_;
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:120 push
  push(undo: T): void {
    if (this.in_snapshot()) {
      this.self_.logs.push(this.from(undo));
    }
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:126 clear
  clear(): void {
    this.self_.logs.length = 0;
    this.self_.num_open_snapshots_ = 0;
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:131 extend
  extend(undos: Iterable<T>): void {
    if (this.in_snapshot()) {
      for (const undo of undos) this.self_.logs.push(this.from(undo));
    }
  }
}

// ---- impl InferCtxtInner (rollback_to / commit) ------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:142 rollback_to
InferCtxtInner.prototype.rollback_to = function (this: InferCtxtInner, snapshot: Snapshot): void {
  // debug!("rollback_to({})", snapshot.undo_len);
  this.undo_log.assert_open_snapshot(snapshot);

  while (this.undo_log.logs.length > snapshot.undo_len) {
    const undo = this.undo_log.logs.pop()!;
    this.reverse(undo);
  }

  this.type_variable_storage.finalize_rollback();

  if (this.undo_log.num_open_snapshots_ === 1) {
    // After the root snapshot the undo log should be empty.
    assert(snapshot.undo_len === 0, "assertion failed: snapshot.undo_len == 0");
    assert(this.undo_log.logs.length === 0, "assertion failed: self.undo_log.logs.is_empty()");
  }

  this.undo_log.num_open_snapshots_ -= 1;
};

// rustc: compiler/rustc_infer/src/infer/snapshot/undo_log.rs:162 commit
InferCtxtInner.prototype.commit = function (this: InferCtxtInner, snapshot: Snapshot): void {
  // debug!("commit({})", snapshot.undo_len);

  if (this.undo_log.num_open_snapshots_ === 1) {
    // The root snapshot. It's safe to clear the undo log because
    // there's no snapshot further out that we might need to roll back
    // to.
    assert(snapshot.undo_len === 0, "assertion failed: snapshot.undo_len == 0");
    this.undo_log.logs.length = 0;
  }

  this.undo_log.num_open_snapshots_ -= 1;
};
