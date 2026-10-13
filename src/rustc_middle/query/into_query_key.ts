// Port of compiler/rustc_middle/src/query/into_query_key.rs.
//
// PORT: `trait IntoQueryKey<K>` is resolved statically upstream; here each target key type has one
// conversion function taking the union of the types that implement `IntoQueryKey<K>`, dispatching on the
// runtime shape: `DefId`, `OwnerId` and `ModId` are classes, `LocalDefId` and `LocalModId` are numbers
// with the same value (`LocalModId` wraps the module's `LocalDefId`, PORTING §5 handles), so both
// convert alike.
import { OwnerId } from "../../rustc_hir_id/lib.ts";
import { DefId, LocalDefId, type LocalModId, LocalModId as LocalModIdC, ModId } from "../../rustc_span/def_id.ts";

/// Argument-conversion trait used by some queries and other `TyCtxt` methods.
///
/// A function that accepts an `impl IntoQueryKey<DefId>` argument can be thought
/// of as taking a [`DefId`], except that callers can also pass a [`LocalDefId`]
/// or values of other narrower ID types, as long as they have a trivial conversion
/// to `DefId`.
///
/// Using a dedicated trait instead of [`Into`] makes the purpose of the conversion
/// more explicit, and makes occurrences easier to search for.
// rustc: compiler/rustc_middle/src/query/into_query_key.rs:16 into_query_key
export type IntoQueryKey<K> = K extends DefId ? DefId | LocalDefId | OwnerId | ModId | LocalModId : K extends LocalDefId ? LocalDefId | OwnerId | LocalModId : K;

/// Any type can be converted to itself.
///
/// This is useful in generic or macro-generated code where we don't know whether
/// conversion is actually needed, so that we can do a conversion unconditionally.
// rustc: compiler/rustc_middle/src/query/into_query_key.rs:25 into_query_key
export function into_query_key_identity<K>(self: K): K {
  return self;
}

/** `impl IntoQueryKey<DefId>` for `DefId` (identity), `LocalDefId`, `OwnerId`, `ModId`, `LocalModId`. */
export function into_query_key_DefId(self: DefId | LocalDefId | OwnerId | ModId | LocalModId): DefId {
  if (self instanceof DefId) return self;
  if (self instanceof OwnerId) return OwnerId_into_DefId(self);
  if (self instanceof ModId) return ModId_into_DefId(self);
  // `LocalDefId` and `LocalModId` (the same number).
  return LocalDefId_into_DefId(self as LocalDefId);
}

/** `impl IntoQueryKey<LocalDefId>` for `LocalDefId` (identity), `OwnerId`, `LocalModId`. */
export function into_query_key_LocalDefId(self: LocalDefId | OwnerId | LocalModId): LocalDefId {
  if (self instanceof OwnerId) return OwnerId_into_LocalDefId(self);
  // `LocalDefId` (identity) and `LocalModId` (`self.into()`: the same number).
  return self as LocalDefId;
}

// rustc: compiler/rustc_middle/src/query/into_query_key.rs:32 into_query_key
function OwnerId_into_LocalDefId(self: OwnerId): LocalDefId {
  return self.def_id;
}

// rustc: compiler/rustc_middle/src/query/into_query_key.rs:39 into_query_key
function LocalDefId_into_DefId(self: LocalDefId): DefId {
  return LocalDefId.to_def_id(self);
}

// rustc: compiler/rustc_middle/src/query/into_query_key.rs:46 into_query_key
function OwnerId_into_DefId(self: OwnerId): DefId {
  return self.to_def_id();
}

// rustc: compiler/rustc_middle/src/query/into_query_key.rs:53 into_query_key
function ModId_into_DefId(self: ModId): DefId {
  return self.to_def_id();
}

// rustc: compiler/rustc_middle/src/query/into_query_key.rs:60 into_query_key
export function LocalModId_into_DefId(self: LocalModId): DefId {
  return LocalModIdC.to_def_id(self);
}

// rustc: compiler/rustc_middle/src/query/into_query_key.rs:67 into_query_key
export function LocalModId_into_LocalDefId(self: LocalModId): LocalDefId {
  return LocalModIdC.to_local_def_id(self);
}
