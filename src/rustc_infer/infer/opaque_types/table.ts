// Port of compiler/rustc_infer/src/infer/opaque_types/table.rs (lane infer-opaque-snapshot). `OpaqueTypeStorageEntries`
// and `OpaqueTypeTable` are generated (table.gen.ts, with `OpaqueTypeStorage`'s derived Debug); `OpaqueTypeStorage` is
// a hand class here (keyed map). Init order: other rustc_infer modules are read inside function bodies only.
//
// PORT: `impl Iterator` results are arrays, taken when the method is called (upstream they borrow the storage, so it
// cannot change while they are iterated). `#[instrument]` (tracing) is left out.

import { OpaqueTypeStorageEntries, OpaqueTypeTable } from "./table.gen.ts";

export * from "./table.gen.ts";

import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { index_map_swap_remove } from "../../../rustc_errors/decorate_diag.ts";
import type { ProvisionalHiddenType, Ty } from "../../../rustc_middle/ty/mod.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { debug_OpaqueTypeKey, type OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, panic } from "../../../std/panic.ts";
import type { InferCtxtUndoLogs } from "../snapshot/undo_log.ts";

// rustc-type: compiler/rustc_infer/src/infer/opaque_types/table.rs:12 OpaqueTypeStorage
// PORT: hand class (codegen `hand`): `FxIndexMap<OpaqueTypeKey, _>` is keyed by a plain struct (`OpaqueTypeKey` is
// `#[derive(Hash, Eq)]`), so `opaque_types` is a `KeyedMap` on `intern_key` (rust_ts/keyed.ts), insertion-ordered as
// the `IndexMap`. The derived `Default` / `Clone` are `default_OpaqueTypeStorage` / `clone_OpaqueTypeStorage` below; the
// derived `Debug` is generated (`debug_OpaqueTypeStorage`).
export class OpaqueTypeStorage {
  constructor(
    public opaque_types: Map<OpaqueTypeKey, ProvisionalHiddenType>,
    public duplicate_entries: [OpaqueTypeKey, ProvisionalHiddenType][],
  ) {}
}

/** `#[derive(Default)]` */
export function default_OpaqueTypeStorage(): OpaqueTypeStorage {
  return new OpaqueTypeStorage(new KeyedMap<OpaqueTypeKey, ProvisionalHiddenType>(intern_key), []);
}

/** `#[derive(Clone)]` (keys and hidden types are `Copy`). */
export function clone_OpaqueTypeStorage(v: OpaqueTypeStorage): OpaqueTypeStorage {
  return new OpaqueTypeStorage(
    new KeyedMap<OpaqueTypeKey, ProvisionalHiddenType>(intern_key, v.opaque_types),
    v.duplicate_entries.map((x) => [x[0], x[1]] as [OpaqueTypeKey, ProvisionalHiddenType]),
  );
}

// ---- impl rustc_type_ir::inherent::OpaqueTypeStorageEntries for OpaqueTypeStorageEntries -----------------------------

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:28 needs_reevaluation
OpaqueTypeStorageEntries.prototype.needs_reevaluation = function (this: OpaqueTypeStorageEntries, canonicalized: number): boolean {
  return this.opaque_types !== canonicalized;
};

// ---- impl OpaqueTypeStorage ------------------------------------------------------------------------------------------

// #[instrument(level = "debug")]
// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:35 remove
OpaqueTypeStorage.prototype.remove = function (this: OpaqueTypeStorage, key: OpaqueTypeKey, prev: ProvisionalHiddenType | undefined): void {
  if (prev !== undefined) {
    // `*self.opaque_types.get_mut(&key).unwrap() = prev`
    if (!this.opaque_types.has(key)) panic("called `Option::unwrap()` on a `None` value");
    this.opaque_types.set(key, prev);
  } else {
    // FIXME(#120456) - is `swap_remove` correct?
    switch (keyed_swap_remove(this.opaque_types, key)) {
      case undefined:
        bug(`reverted opaque type inference that was never registered: ${debug_OpaqueTypeKey(key, PLAIN)}`);
        break;
      default:
        break;
    }
  }
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:51 pop_duplicate_entry
OpaqueTypeStorage.prototype.pop_duplicate_entry = function (this: OpaqueTypeStorage): void {
  const entry = this.duplicate_entries.pop();
  assert(entry !== undefined, "assertion failed: entry.is_some()");
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:56 is_empty
OpaqueTypeStorage.prototype.is_empty = function (this: OpaqueTypeStorage): boolean {
  const { opaque_types, duplicate_entries } = this;
  return opaque_types.size === 0 && duplicate_entries.length === 0;
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:61 take_opaque_types
OpaqueTypeStorage.prototype.take_opaque_types = function (this: OpaqueTypeStorage): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]> {
  const { opaque_types, duplicate_entries } = this;
  // `std::mem::take(opaque_types)` / `std::mem::take(duplicate_entries)`
  this.opaque_types = new KeyedMap<OpaqueTypeKey, ProvisionalHiddenType>(intern_key);
  this.duplicate_entries = [];
  return [...opaque_types, ...duplicate_entries];
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:68 num_entries
OpaqueTypeStorage.prototype.num_entries = function (this: OpaqueTypeStorage): OpaqueTypeStorageEntries {
  return new OpaqueTypeStorageEntries(this.opaque_types.size, this.duplicate_entries.length);
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:75 opaque_types_added_since
OpaqueTypeStorage.prototype.opaque_types_added_since = function (this: OpaqueTypeStorage, prev_entries: OpaqueTypeStorageEntries): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]> {
  return [...[...this.opaque_types].slice(prev_entries.opaque_types), ...this.duplicate_entries.slice(prev_entries.duplicate_entries)];
};

/// Only returns the opaque types from the lookup table. These are used
/// when normalizing opaque types and have a unique key.
///
/// Outside of canonicalization one should generally use `iter_opaque_types`
/// to also consider duplicate entries.
// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:91 iter_lookup_table
OpaqueTypeStorage.prototype.iter_lookup_table = function (this: OpaqueTypeStorage): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]> {
  return [...this.opaque_types];
};

/// Only returns the opaque types which are stored in `duplicate_entries`.
///
/// These have to considered when checking all opaque type uses but are e.g.
/// irrelevant for canonical inputs as nested queries never meaningfully
/// accesses them.
// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:102 iter_duplicate_entries
OpaqueTypeStorage.prototype.iter_duplicate_entries = function (this: OpaqueTypeStorage): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]> {
  return this.duplicate_entries.slice();
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:108 iter_opaque_types
OpaqueTypeStorage.prototype.iter_opaque_types = function (this: OpaqueTypeStorage): Iterable<[OpaqueTypeKey, ProvisionalHiddenType]> {
  const { opaque_types, duplicate_entries } = this;
  return [...opaque_types, ...duplicate_entries];
};

// #[inline]
// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:116 with_log
OpaqueTypeStorage.prototype.with_log = function (this: OpaqueTypeStorage, undo_log: InferCtxtUndoLogs): OpaqueTypeTable {
  return new OpaqueTypeTable(this, undo_log);
};

// ---- impl Deref for OpaqueTypeTable ----------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:131 deref
OpaqueTypeTable.prototype.deref = function (this: OpaqueTypeTable): OpaqueTypeStorage {
  return this.storage;
};

// ---- impl OpaqueTypeTable --------------------------------------------------------------------------------------------

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:138 register
OpaqueTypeTable.prototype.register = function (this: OpaqueTypeTable, key: OpaqueTypeKey, hidden_type: ProvisionalHiddenType): Ty | undefined {
  const entry = this.storage.opaque_types.get(key);
  if (entry !== undefined) {
    // `std::mem::replace(entry, hidden_type)`
    const prev = entry;
    this.storage.opaque_types.set(key, hidden_type);
    this.undo_log.push({ $: "OpaqueTypes", _0: key, _1: prev });
    return prev.ty;
  }
  this.storage.opaque_types.set(key, hidden_type);
  this.undo_log.push({ $: "OpaqueTypes", _0: key, _1: undefined });
  return undefined;
};

// rustc: compiler/rustc_infer/src/infer/opaque_types/table.rs:153 add_duplicate
OpaqueTypeTable.prototype.add_duplicate = function (this: OpaqueTypeTable, key: OpaqueTypeKey, hidden_type: ProvisionalHiddenType): void {
  this.storage.duplicate_entries.push([key, hidden_type]);
  this.undo_log.push({ $: "DuplicateOpaqueType" });
};

/**
 * `IndexMap::swap_remove` on the keyed map: the last entry takes the removed entry's position (rustc_errors'
 * `index_map_swap_remove` compares keys by identity, so the stored key object is looked up first).
 */
function keyed_swap_remove(map: Map<OpaqueTypeKey, ProvisionalHiddenType>, key: OpaqueTypeKey): ProvisionalHiddenType | undefined {
  const stored = map instanceof KeyedMap ? (map as KeyedMap<OpaqueTypeKey, ProvisionalHiddenType>).stored_key(key) : map.has(key) ? key : undefined;
  if (stored === undefined) return undefined;
  return index_map_swap_remove(map, stored);
}
