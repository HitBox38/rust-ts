// Port of compiler/rustc_hir_id/src/lib.rs
//! Library containing Id types from `rustc_hir`, split out so crates can use it without depending
//! on all of `rustc_hir` (which is large and depends on other large things like `rustc_target`).
//
// Types are generated into lib.gen.ts (tools/codegen/types.ts, set `rustc_hir`); methods are
// attached to the generated classes below (`declare module` + prototype), statics/consts on the
// companions.
import type { StableHashCtxt, StableHasher } from "../rustc_data_structures/stable_hash.ts";
import { CRATE_DEF_ID, DefIndex, type DefId, type DefPathHash, DefId_to_stable_hash_key, LocalDefId, LocalModId, debug_LocalDefId } from "../rustc_span/def_id.ts";
import { stable_hash_DefPathHash } from "../rustc_span/stable_hash.gen.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import { assert_eq, panic } from "../std/panic.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import * as gen from "./lib.gen.ts";
import { HirId, OwnerId } from "./lib.gen.ts";

export * from "./lib.gen.ts";

// pub mod def_path_hash_map;
export * as def_path_hash_map from "./def_path_hash_map.ts";
// pub mod definitions;
export * as definitions from "./definitions.ts";

declare module "./lib.gen.ts" {
  interface OwnerId {
    to_def_id(): DefId;
    index(): number;
  }
  interface HirId {
    expect_owner(): OwnerId;
    as_owner(): OwnerId | undefined;
    is_owner(): boolean;
  }
}

// rustc: compiler/rustc_hir_id/src/lib.rs:27 fmt
export const debug_OwnerId: Debug<OwnerId> = (v, f) =>
  // Example: DefId(0:1 ~ aa[7697]::{use#0})
  debug_LocalDefId(v.def_id, f);

/** `#[derive(PartialEq)]` */
export function OwnerId_eq(a: OwnerId, b: OwnerId): boolean {
  return a.def_id === b.def_id;
}

// rustc: compiler/rustc_hir_id/src/lib.rs:34 from
export function HirId_from_OwnerId(owner: OwnerId): HirId {
  return new HirId(owner, ItemLocalId.ZERO);
}

// rustc: compiler/rustc_hir_id/src/lib.rs:40 from
export function DefId_from_OwnerId(value: OwnerId): DefId {
  return value.to_def_id();
}

// rustc: compiler/rustc_hir_id/src/lib.rs:46 from
export function OwnerId_from_LocalModId(value: LocalModId): OwnerId {
  return new OwnerId(LocalModId.to_local_def_id(value));
}

// rustc: compiler/rustc_hir_id/src/lib.rs:53 to_def_id
OwnerId.prototype.to_def_id = function (this: OwnerId): DefId {
  return LocalDefId.to_def_id(this.def_id);
};

// PORT: `impl rustc_index::Idx for OwnerId`: `new` is a static on the class, `index` a method.
// rustc: compiler/rustc_hir_id/src/lib.rs:60 new
export function OwnerId_new(idx: number): OwnerId {
  return new OwnerId(LocalDefId.of(DefIndex.from_usize(idx)));
}

// rustc: compiler/rustc_hir_id/src/lib.rs:65 index
OwnerId.prototype.index = function (this: OwnerId): number {
  return DefIndex.as_usize(LocalDefId.local_def_index(this.def_id));
};

// impl StableHash for OwnerId
// PORT: a free fn (the derive(StableHash) generator imports `stable_hash_OwnerId` from this module).
// rustc: compiler/rustc_hir_id/src/lib.rs:72 stable_hash
export function stable_hash_OwnerId(self: OwnerId, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_DefPathHash(OwnerId_to_stable_hash_key(self, hcx), hcx, hasher);
}

// impl ToStableHashKey for OwnerId
// rustc: compiler/rustc_hir_id/src/lib.rs:81 to_stable_hash_key
export function OwnerId_to_stable_hash_key(self: OwnerId, hcx: StableHashCtxt): DefPathHash {
  return DefId_to_stable_hash_key(self.to_def_id(), hcx);
}

/// Uniquely identifies a node in the HIR of the current crate. It is
/// composed of the `owner`, which is the `LocalDefId` of the directly enclosing
/// `hir::Item`, `hir::TraitItem`, or `hir::ImplItem` (i.e., the closest "item-like"),
/// and the `local_id` which is unique within the given owner.
// (type: lib.gen.ts; to ensure correctness of incremental compilation, `HirId` must not
// implement `Ord` or `PartialOrd`.)

/** `#[derive(PartialEq)]` */
export function HirId_eq(a: HirId, b: HirId): boolean {
  return OwnerId_eq(a.owner, b.owner) && a.local_id === b.local_id;
}

// rustc: compiler/rustc_hir_id/src/lib.rs:110 fmt
export const debug_HirId: Debug<HirId> = (v, _f) =>
  // Example: HirId(DefId(0:1 ~ aa[7697]::{use#0}).10)
  // Don't use debug_tuple to always keep this on one line.
  // PORT: `write!(f, "..{:?}..")` formats the fields with fresh (plain) formatters.
  `HirId(${debug_OwnerId(v.owner, PLAIN)}.${gen.debug_ItemLocalId(v.local_id, PLAIN)})`;

// rustc: compiler/rustc_hir_id/src/lib.rs:123 expect_owner
HirId.prototype.expect_owner = function (this: HirId): OwnerId {
  assert_eq(ItemLocalId.index(this.local_id), 0, String);
  return this.owner;
};

// rustc: compiler/rustc_hir_id/src/lib.rs:129 as_owner
HirId.prototype.as_owner = function (this: HirId): OwnerId | undefined {
  if (ItemLocalId.index(this.local_id) === 0) {
    return this.owner;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_hir_id/src/lib.rs:134 is_owner
HirId.prototype.is_owner = function (this: HirId): boolean {
  return ItemLocalId.index(this.local_id) === 0;
};

// rustc: compiler/rustc_hir_id/src/lib.rs:139 make_owner
export function HirId_make_owner(owner: LocalDefId): HirId {
  return new HirId(new OwnerId(owner), ItemLocalId.ZERO);
}

// rustc: compiler/rustc_hir_id/src/lib.rs:145 fmt
export function display_HirId(v: HirId): string {
  return debug_HirId(v, PLAIN);
}

// rustc: compiler/rustc_hir_id/src/lib.rs:151 from
export function HirId_from_LocalModId(id: LocalModId): HirId {
  return HirId_make_owner(LocalModId.to_local_def_id(id));
}

// rustc_data_structures::define_stable_id_collections!(HirIdMap, HirIdSet, HirIdMapEntry, HirId);
// rustc_data_structures::define_id_collections!(ItemLocalMap, ItemLocalSet, ItemLocalMapEntry, ItemLocalId);
// PORT (docs/plan-m3.md D5): `HirIdMap<T>` = `FxIndexMap<HirId, T>` and `HirIdSet` = `FxIndexSet<HirId>` are
// `Map`/`Set` subclasses keyed by `HirId_key` (rust_ts/keyed.ts): value comparison, insertion order (the
// `FxIndexMap` order). `HirIdMapEntry` (the entry API) is `Map` get/set. `ItemLocalMap<T>` / `ItemLocalSet`
// are plain `Map<ItemLocalId, T>` / `Set<ItemLocalId>` (branded numbers) at use sites.

/**
 * PORT (D5): the JS map key of a `HirId`, `owner * 2^32 + local_id`; equal exactly when the `HirId`s are, exact
 * while the owner's `DefIndex` is below 2^21 (checked).
 */
export function HirId_key(id: HirId): number {
  const k = id.owner.def_id * 0x1_0000_0000 + id.local_id;
  if (!Number.isSafeInteger(k)) panic(`HirId_key: owner index ${id.owner.def_id} too large for an exact key`);
  return k;
}

export class HirIdMap<T> extends KeyedMap<HirId, T> {
  constructor(entries?: Iterable<readonly [HirId, T]>) {
    super(HirId_key, entries);
  }
}

export class HirIdSet extends KeyedSet<HirId> {
  constructor(values?: Iterable<HirId>) {
    super(HirId_key, values);
  }
}

/// An `ItemLocalId` uniquely identifies something within a given "item-like";
/// that is, within a `hir::Item`, `hir::TraitItem`, or `hir::ImplItem`.
// (newtype_index! expansion: lib.gen.ts)
export type ItemLocalId = gen.ItemLocalId;
export const ItemLocalId = {
  ...gen.ItemLocalId,
  /// Signal local id which should never be used.
  INVALID: gen.ItemLocalId.MAX,
};

// impl StableOrd for ItemLocalId: consts only (`CAN_USE_UNSTABLE_SORT = true`), skipped with
// the other stable-hash traits (incremental, M5).

/// Signal local id which should never be used.
// (`impl HirId { pub const INVALID }`)
export const HirId_INVALID: HirId = new HirId(new OwnerId(CRATE_DEF_ID), ItemLocalId.INVALID);

/// The `HirId` corresponding to `CRATE_NODE_ID` and `CRATE_DEF_ID`.
export const CRATE_HIR_ID: HirId = new HirId(new OwnerId(CRATE_DEF_ID), ItemLocalId.ZERO);

export const CRATE_OWNER_ID: OwnerId = new OwnerId(CRATE_DEF_ID);
