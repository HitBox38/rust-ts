// Port of compiler/rustc_infer/src/infer/type_variable.rs (lane infcx-contract: ported in full, the ena-backed
// type-variable table). The types (with their derived Debug / Clone) are generated into type_variable.gen.ts, except
// `UndoLog` (its variants hold ena undo logs) and `TypeVariableStorage` (it holds ena tables): both are below.
//
// PORT (ena, as vendor/ena tests/external_undo_log.test.ts):
// - `ut::UnificationTableStorage<K>` is `UnificationTableStorage<K, K::Value, Error>`; `storage.with_log(undo_log)`
//   takes the `UndoLogs<sv::UndoLog<..>>` view of the shared `InferCtxtUndoLogs` (`undo_log.as_(UndoLog.from_..)`, the
//   `UndoLog: From<T>` bound of `impl<T> UndoLogs<T> for InferCtxtUndoLogs`).
// - `TyVidEqKey` / `TyVidSubKey` keys are `{ vid }` objects; `impl From<TyVid>` is `<K>_from`; the key dictionaries
//   are `UnifyKey_TyVidEqKey` / `UnifyKey_TyVidSubKey` and compare keys by `vid`.
// - `TypeVariableTable<'a, 'tcx>` (generated class) holds the storage and the shared undo log.
// - `IndexVec<TyVid, TypeVariableData>` is an array indexed by `TyVid.as_usize`.
import { panic, unreachable } from "../../std/panic.ts";
import { type Result, Ok } from "../../std/result.ts";
import { clone_UndoLog as clone_SvUndoLog, type UndoLog as SvUndoLog } from "../../vendor/ena/snapshot_vec.ts";
import type { Rollback } from "../../vendor/ena/undo_log.ts";
import {
  InPlace,
  type InPlaceUndoLog,
  type NoError,
  type Range,
  UnificationTable,
  type UnificationTableStorage,
  type UnifyKey,
  UnifyKey_provided,
  type UnifyValue,
  UnifyValue_unit,
  type VarValue,
} from "../../vendor/ena/unify/mod.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { type TyVid, TyVid as TyVidC } from "../../rustc_type_ir/ty_kind.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { InferCtxtUndoLogs } from "./snapshot/undo_log.ts";
import * as undo_log from "./snapshot/undo_log.ts";
import {
  clone_TypeVariableData,
  type TypeVariableData,
  type TypeVariableOrigin,
  TypeVariableTable,
  type TyVidEqKey,
  type TyVidSubKey,
} from "./type_variable.gen.ts";
import type { UnificationTable as InferUnificationTable } from "./mod.ts";
import type * as gen from "./type_variable.gen.ts";

export * from "./type_variable.gen.ts";

/// Represents a single undo-able action that affects a type inference variable.
// rustc-type: compiler/rustc_infer/src/infer/type_variable.rs:18 UndoLog
export type UndoLog =
  | { readonly $: "EqRelation"; readonly _0: InPlaceUndoLog<TyVidEqKey, TypeVariableValue> }
  | { readonly $: "SubRelation"; readonly _0: InPlaceUndoLog<TyVidSubKey, undefined> };

/** `#[derive(Clone)]` of `UndoLog` (codegen skips the type: its variants hold ena undo logs). */
export function clone_UndoLog(v: UndoLog): UndoLog {
  switch (v.$) {
    case "EqRelation":
      return { $: "EqRelation", _0: clone_SvUndoLog(v._0, (x) => x.clone(UnifyValue_TypeVariableValue), (u) => u) };
    case "SubRelation":
      return { $: "SubRelation", _0: clone_SvUndoLog(v._0, (x) => x.clone(UnifyValue_unit), (u) => u) };
  }
}

export const UndoLog = {
  /// Convert from a specific kind of undo to the more general UndoLog
  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:25 from
  from_EqRelation(l: InPlaceUndoLog<TyVidEqKey, TypeVariableValue>): UndoLog {
    return { $: "EqRelation", _0: l };
  },

  /// Convert from a specific kind of undo to the more general UndoLog
  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:32 from
  from_SubRelation(l: InPlaceUndoLog<TyVidSubKey, undefined>): UndoLog {
    return { $: "SubRelation", _0: l };
  },
};

// rustc-type: compiler/rustc_infer/src/infer/type_variable.rs:59 TypeVariableStorage
export class TypeVariableStorage implements Rollback<UndoLog> {
  constructor(
    /// The origins of each type variable.
    public values: TypeVariableData[],
    /// Two variables are unified in `eq_relations` when we have a
    /// constraint `?X == ?Y`. This table also stores, for each key,
    /// the known value.
    public eq_relations: UnificationTableStorage<TyVidEqKey, TypeVariableValue, NoError>,
    /// Only used by `-Znext-solver` and for diagnostics. Tracks whether
    /// type variables are related via subtyping at all, ignoring which of
    /// the two is the subtype.
    ///
    /// When reporting ambiguity errors, we sometimes want to
    /// treat all inference vars which are subtypes of each
    /// others as if they are equal. For this case we compute
    /// the transitive closure of our subtype obligations here.
    ///
    /// E.g. when encountering ambiguity errors, we want to suggest
    /// specifying some method argument or to add a type annotation
    /// to a local variable. Because subtyping cannot change the
    /// shape of a type, it's fine if the cause of the ambiguity error
    /// is only related to the suggested variable via subtyping.
    ///
    /// Even for something like `let x = returns_arg(); x.method();` the
    /// type of `x` is only a supertype of the argument of `returns_arg`. We
    /// still want to suggest specifying the type of the argument.
    public sub_unification_table: UnificationTableStorage<TyVidSubKey, undefined, NoError>,
  ) {}

  /** `#[derive(Default)]` */
  static default_(): TypeVariableStorage {
    return new TypeVariableStorage(
      [],
      UnificationTable.new(() => InPlace.default(UnifyKey_TyVidEqKey, () => undefined)),
      UnificationTable.new(() => InPlace.default(UnifyKey_TyVidSubKey, () => undefined)),
    );
  }

  // ---- impl Rollback<sv::UndoLog<ut::Delegate<TyVidEqKey>>> / <..TyVidSubKey> / <UndoLog> for TypeVariableStorage ----
  // PORT: the three `reverse` impls are `reverse_EqRelation`, `reverse_SubRelation` and the `Rollback<UndoLog>`
  // method `reverse` (one name per impl, as the `UndoLogs<T>` views of InferCtxtUndoLogs).

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:38 reverse
  reverse_EqRelation(undo: InPlaceUndoLog<TyVidEqKey, TypeVariableValue>): void {
    this.eq_relations.reverse(undo);
  }

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:44 reverse
  reverse_SubRelation(undo: InPlaceUndoLog<TyVidSubKey, undefined>): void {
    this.sub_unification_table.reverse(undo);
  }

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:50 reverse
  reverse(undo: UndoLog): void {
    switch (undo.$) {
      case "EqRelation":
        this.eq_relations.reverse(undo._0);
        break;
      case "SubRelation":
        this.sub_unification_table.reverse(undo._0);
        break;
    }
  }

  // ---- impl TypeVariableStorage ----

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:143 with_log
  with_log(undo_log: InferCtxtUndoLogs): TypeVariableTable {
    return new TypeVariableTable(this, undo_log);
  }

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:151 eq_relations_ref
  eq_relations_ref(): UnificationTableStorage<TyVidEqKey, TypeVariableValue, NoError> {
    return this.eq_relations;
  }

  /**
   * PORT: (perf) `self.eq_relations_ref().try_probe_value(TyVidEqKey::from(vid))` for the read-only hot path
   * (`InferCtxtInner::try_type_variables_probe_ref`, ~10^9 calls from `goal_remains_stalled` on deep `?` chains).
   * The same reads as ena's `UnificationTable::value` + `try_probe_value` (index the `VarValue`s, root iff `parent ==
   * key`), without the `TyVidEqKey` newtype, the `Some` wrapper and the generic `UnifyKey` dictionary calls that Rust
   * monomorphises away. `TypeVariableValue` is never `undefined`, so `undefined` is `None`.
   */
  try_probe_eq_relations_value(vid: TyVid): TypeVariableValue | undefined {
    const values = this.eq_relations.values.values.values;
    const index = vid as number;
    // `values[index]`: slice indexing's bounds check (ena snapshot_vec `get`).
    if (!(index < values.length)) {
      return panic(`index out of bounds: the len is ${values.length} but the index is ${index}`);
    }
    const v = values[index]!;
    return v.parent.vid === vid ? v.value : undefined;
  }

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:155 finalize_rollback
  finalize_rollback(): void {
    // debug_assert!(self.values.len() >= self.eq_relations.len());
    this.values.length = Math.min(this.values.length, this.eq_relations.len());
  }

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:160 sub_unification_table_ref
  sub_unification_table_ref(): UnificationTableStorage<TyVidSubKey, undefined, NoError> {
    return this.sub_unification_table;
  }

  /**
   * PORT: (perf) `self.sub_unification_table_ref().try_probe_value(TyVidSubKey::from(vid)).is_some()` for the
   * read-only hot path (`is_sub_unification_table_root_var`); see `try_probe_eq_relations_value`.
   */
  is_sub_unification_table_root(vid: TyVid): boolean {
    const values = this.sub_unification_table.values.values.values;
    const index = vid as number;
    // `values[index]`: slice indexing's bounds check (ena snapshot_vec `get`).
    if (!(index < values.length)) {
      return panic(`index out of bounds: the len is ${values.length} but the index is ${index}`);
    }
    return values[index]!.parent.vid === vid;
  }
}

/** `#[derive(Clone)]` of `TypeVariableStorage` (a hand type: codegen does not derive its Clone). */
export function clone_TypeVariableStorage(v: TypeVariableStorage): TypeVariableStorage {
  return new TypeVariableStorage(
    v.values.map(clone_TypeVariableData),
    v.eq_relations.clone((s) => s.clone((l) => l)),
    v.sub_unification_table.clone((s) => s.clone((l) => l)),
  );
}

// ---- TypeVariableValue -------------------------------------------------------------------------------------------------

export type TypeVariableValue = gen.TypeVariableValue;
export const TypeVariableValue = {
  /// If this value is known, returns the type it is known to be.
  /// Otherwise, `None`.
  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:126 known
  known(self: TypeVariableValue): Ty | undefined {
    switch (self.$) {
      case "Unknown":
        return undefined;
      case "Known":
        return self.value;
    }
  },

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:133 is_unknown
  is_unknown(self: TypeVariableValue): boolean {
    switch (self.$) {
      case "Unknown":
        return true;
      case "Known":
        return false;
    }
  },
};

// ---- TypeVariableTable -----------------------------------------------------------------------------------------------

declare module "./type_variable.gen.ts" {
  interface TypeVariableTable {
    var_origin(vid: TyVid): TypeVariableOrigin;
    equate(a: TyVid, b: TyVid): void;
    sub_unify(a: TyVid, b: TyVid): void;
    instantiate(vid: TyVid, ty: Ty): void;
    new_var(universe: UniverseIndex, origin: TypeVariableOrigin): TyVid;
    num_vars(): number;
    root_var(vid: TyVid): TyVid;
    sub_unification_table_root_var(vid: TyVid): TyVid;
    probe(vid: TyVid): TypeVariableValue;
    inlined_probe(vid: TyVid): TypeVariableValue;
    probe_with_root_vid(vid: TyVid): [TyVid, TypeVariableValue];
    inlined_probe_with_vid(vid: TyVid): [TyVid, TypeVariableValue];
    eq_relations(): InferUnificationTable<TyVidEqKey, TypeVariableValue, NoError>;
    sub_unification_table(): InferUnificationTable<TyVidSubKey, undefined, NoError>;
    vars_since_snapshot(value_count: number): [Range<TyVid>, TypeVariableOrigin[]];
    unresolved_root_variables(): TyVid[];
  }
}

/// Returns the origin that was given when `vid` was created.
///
/// Note that this function does not return care whether
/// `vid` has been unified with something else or not.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:170 var_origin
TypeVariableTable.prototype.var_origin = function (this: TypeVariableTable, vid: TyVid): TypeVariableOrigin {
  return this.storage.values[TyVidC.as_usize(vid)]!.origin;
};

/// Records that `a == b`.
///
/// Precondition: neither `a` nor `b` are known.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:177 equate
TypeVariableTable.prototype.equate = function (this: TypeVariableTable, a: TyVid, b: TyVid): void {
  // debug_assert!(self.probe(a).is_unknown());
  // debug_assert!(self.probe(b).is_unknown());
  this.eq_relations().union(TyVidEqKey_from(a), TyVidEqKey_from(b));
  this.sub_unification_table().union(TyVidSubKey_from(a), TyVidSubKey_from(b));
};

/// Records that `a` and `b` are related via subtyping. We don't track
/// which of the two is the subtype.
///
/// Precondition: neither `a` nor `b` are known.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:188 sub_unify
TypeVariableTable.prototype.sub_unify = function (this: TypeVariableTable, a: TyVid, b: TyVid): void {
  // debug_assert!(self.probe(a).is_unknown());
  // debug_assert!(self.probe(b).is_unknown());
  this.sub_unification_table().union(TyVidSubKey_from(a), TyVidSubKey_from(b));
};

/// Instantiates `vid` with the type `ty`.
///
/// Precondition: `vid` must not have been previously instantiated.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:197 instantiate
TypeVariableTable.prototype.instantiate = function (this: TypeVariableTable, vid_: TyVid, ty: Ty): void {
  const vid = this.root_var(vid_);
  // debug_assert!(!ty.is_ty_var(), "instantiating ty var with var: {vid:?} {ty:?}");
  // debug_assert!(self.probe(vid).is_unknown());
  // debug_assert!(
  //     self.eq_relations().probe_value(vid).is_unknown(),
  //     "instantiating type variable `{vid:?}` twice: new-value = {ty:?}, old-value={:?}",
  //     self.eq_relations().probe_value(vid)
  // );
  this.eq_relations().union_value(TyVidEqKey_from(vid), { $: "Known", value: ty });
};

/// Creates a new type variable.
///
/// - `diverging`: indicates if this is a "diverging" type
///   variable, e.g.,  one created as the type of a `return`
///   expression. The code in this module doesn't care if a
///   variable is diverging, but the main Rust type-checker will
///   sometimes "unify" such variables with the `!` or `()` types.
/// - `origin`: indicates *why* the type variable was created.
///   The code in this module doesn't care, but it can be useful
///   for improving error messages.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:219 new_var
TypeVariableTable.prototype.new_var = function (this: TypeVariableTable, universe: UniverseIndex, origin: TypeVariableOrigin): TyVid {
  const eq_key = this.eq_relations().new_key({ $: "Unknown", universe });

  const sub_key = this.sub_unification_table().new_key(undefined);
  // debug_assert_eq!(eq_key.vid, sub_key.vid);

  // `IndexVec::push` returns the new index.
  const index = TyVidC.from_usize(this.storage.values.length);
  this.storage.values.push({ origin });
  // debug_assert_eq!(eq_key.vid, index);

  // debug!("new_var(index={:?}, universe={:?}, origin={:?})", eq_key.vid, universe, origin);

  return index;
};

/// Returns the number of type variables created thus far.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:238 num_vars
TypeVariableTable.prototype.num_vars = function (this: TypeVariableTable): number {
  return this.storage.values.length;
};

/// Returns the "root" variable of `vid` in the `eq_relations`
/// equivalence table. All type variables that have been equated
/// will yield the same root variable (per the union-find
/// algorithm), so `root_var(a) == root_var(b)` implies that `a ==
/// b` (transitively).
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:247 root_var
TypeVariableTable.prototype.root_var = function (this: TypeVariableTable, vid: TyVid): TyVid {
  return this.eq_relations().find(TyVidEqKey_from(vid)).vid;
};

/// Returns the "root" variable of `vid` in the `sub_unification_table`
/// equivalence table. All type variables that have been related via
/// equality or subtyping will yield the same root variable (per the
/// union-find algorithm), so `sub_unification_table_root_var(a)
/// == sub_unification_table_root_var(b)` implies that `a` and `b` are
/// transitively related via subtyping.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:257 sub_unification_table_root_var
TypeVariableTable.prototype.sub_unification_table_root_var = function (this: TypeVariableTable, vid: TyVid): TyVid {
  return this.sub_unification_table().find(TyVidSubKey_from(vid)).vid;
};

/// Retrieves the type to which `vid` has been instantiated, if
/// any.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:263 probe
TypeVariableTable.prototype.probe = function (this: TypeVariableTable, vid: TyVid): TypeVariableValue {
  return this.inlined_probe(vid);
};

/// An always-inlined variant of `probe`, for very hot call sites.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:269 inlined_probe
TypeVariableTable.prototype.inlined_probe = function (this: TypeVariableTable, vid: TyVid): TypeVariableValue {
  return this.eq_relations().inlined_probe_value(TyVidEqKey_from(vid));
};

/// Retrieves the type to which `vid` has been instantiated, if
/// any, along with the root `vid`.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:275 probe_with_root_vid
TypeVariableTable.prototype.probe_with_root_vid = function (this: TypeVariableTable, vid: TyVid): [TyVid, TypeVariableValue] {
  return this.inlined_probe_with_vid(vid);
};

/// An always-inlined variant of `probe_with_root_vid`, for very hot call sites.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:284 inlined_probe_with_vid
TypeVariableTable.prototype.inlined_probe_with_vid = function (this: TypeVariableTable, vid: TyVid): [TyVid, TypeVariableValue] {
  const [id, value] = this.eq_relations().inlined_probe_key_value(TyVidEqKey_from(vid));
  return [id.vid, value];
};

// rustc: compiler/rustc_infer/src/infer/type_variable.rs:293 eq_relations
TypeVariableTable.prototype.eq_relations = function (this: TypeVariableTable): InferUnificationTable<TyVidEqKey, TypeVariableValue, NoError> {
  return this.storage.eq_relations.with_log(this.undo_log.as_(undo_log.UndoLog.from_TyVidEqKey));
};

// rustc: compiler/rustc_infer/src/infer/type_variable.rs:298 sub_unification_table
TypeVariableTable.prototype.sub_unification_table = function (this: TypeVariableTable): InferUnificationTable<TyVidSubKey, undefined, NoError> {
  return this.storage.sub_unification_table.with_log(this.undo_log.as_(undo_log.UndoLog.from_TyVidSubKey));
};

/// Returns a range of the type variables created during the snapshot.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:303 vars_since_snapshot
TypeVariableTable.prototype.vars_since_snapshot = function (this: TypeVariableTable, value_count: number): [Range<TyVid>, TypeVariableOrigin[]] {
  const range: Range<TyVid> = { start: TyVidC.from_usize(value_count), end: TyVidC.from_usize(this.num_vars()) };
  const origins: TypeVariableOrigin[] = [];
  for (let index = TyVidC.as_usize(range.start); index < TyVidC.as_usize(range.end); index++) {
    origins.push(this.var_origin(TyVidC.from_usize(index)));
  }
  return [range, origins];
};

/// Returns indices of all root variables that are not yet instantiated.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:312 unresolved_root_variables
TypeVariableTable.prototype.unresolved_root_variables = function (this: TypeVariableTable): TyVid[] {
  const out: TyVid[] = [];
  const n = this.num_vars();
  for (let i = 0; i < n; i++) {
    const vid = TyVidC.from_usize(i);
    const [root, value] = this.probe_with_root_vid(vid);
    if (root === vid && TypeVariableValue.is_unknown(value)) {
      out.push(vid);
    }
  }
  return out;
};

///////////////////////////////////////////////////////////////////////////

// ---- TyVidEqKey ------------------------------------------------------------------------------------------------------

/** `impl From<ty::TyVid> for TyVidEqKey` */
// make this function eligible for inlining - it is quite hot.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:338 from
export function TyVidEqKey_from(vid: TyVid): TyVidEqKey {
  return { vid, phantom: undefined };
}

/** `impl ut::UnifyKey for TyVidEqKey` (`type Value = TypeVariableValue`). */
export const UnifyKey_TyVidEqKey: UnifyKey<TyVidEqKey, TypeVariableValue, NoError> = {
  get Value(): UnifyValue<TypeVariableValue, NoError> {
    return UnifyValue_TypeVariableValue;
  },
  eq: (a, b) => a.vid === b.vid,

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:346 index
  index(self: TyVidEqKey): number {
    return TyVidC.as_u32(self.vid);
  },

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:350 from_index
  from_index(i: number): TyVidEqKey {
    return TyVidEqKey_from(TyVidC.from_u32(i));
  },

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:353 tag
  tag(): string {
    return "TyVidEqKey";
  },

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:356 order_roots
  order_roots(a: TyVidEqKey, _a_value: TypeVariableValue, b: TyVidEqKey, _b_value: TypeVariableValue): [TyVidEqKey, TyVidEqKey] | undefined {
    if (TyVidC.as_u32(a.vid) < TyVidC.as_u32(b.vid)) {
      return [a, b];
    } else {
      return [b, a];
    }
  },
};

// ---- TyVidSubKey -----------------------------------------------------------------------------------------------------

/** `impl From<ty::TyVid> for TyVidSubKey` */
// make this function eligible for inlining - it is quite hot.
// rustc: compiler/rustc_infer/src/infer/type_variable.rs:368 from
export function TyVidSubKey_from(vid: TyVid): TyVidSubKey {
  return { vid };
}

/** `impl ut::UnifyKey for TyVidSubKey` (`type Value = ()`). */
export const UnifyKey_TyVidSubKey: UnifyKey<TyVidSubKey, undefined, NoError> = {
  Value: UnifyValue_unit,
  eq: (a, b) => a.vid === b.vid,

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:376 index
  index(self: TyVidSubKey): number {
    return TyVidC.as_u32(self.vid);
  },

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:380 from_index
  from_index(i: number): TyVidSubKey {
    return { vid: TyVidC.from_u32(i) };
  },

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:383 tag
  tag(): string {
    return "TyVidSubKey";
  },

  order_roots: UnifyKey_provided.order_roots,
};

// ---- impl ut::UnifyValue for TypeVariableValue -----------------------------------------------------------------------

/** `impl ut::UnifyValue for TypeVariableValue` (`type Error = ut::NoError`). */
export const UnifyValue_TypeVariableValue: UnifyValue<TypeVariableValue, NoError> = {
  clone: (v) => v,

  // rustc: compiler/rustc_infer/src/infer/type_variable.rs:391 unify_values
  unify_values(value1: TypeVariableValue, value2: TypeVariableValue): Result<TypeVariableValue, NoError> {
    if (value1.$ === "Known" && value2.$ === "Known") {
      // We never equate two type variables, both of which
      // have known types. Instead, we recursively equate
      // those types.
      return bug("equating two type variables, both of which have known types");
    } else if (value1.$ === "Known" && value2.$ === "Unknown") {
      // If one side is known, prefer that one.
      return Ok(value1);
    } else if (value1.$ === "Unknown" && value2.$ === "Known") {
      return Ok(value2);
    } else if (value1.$ === "Unknown" && value2.$ === "Unknown") {
      // If both sides are *unknown*, it hardly matters, does it?
      const universe1 = value1.universe;
      const universe2 = value2.universe;
      // If we unify two unbound variables, ?T and ?U, then whatever
      // value they wind up taking (which must be the same value) must
      // be nameable by both universes. Therefore, the resulting
      // universe is the minimum of the two universes, because that is
      // the one which contains the fewest names in scope.
      const universe = universe1 < universe2 ? universe1 : universe2;
      return Ok({ $: "Unknown", universe });
    } else {
      return unreachable();
    }
  },
};

/** PORT: ena `VarValue` re-exported for the unification-table types of this crate. */
export type { VarValue, SvUndoLog };
