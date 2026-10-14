//! Defines the set of legal keys that can be used in queries.
// Port of compiler/rustc_middle/src/query/keys.rs.
//
// PORT: `trait QueryKey` -> the `QueryKey<K, LocalK>` interface; each `impl QueryKey for T` is a
// `KEY_<T>` object (the generated query declarations, queries.gen.ts, name the impl of their key type;
// tools/codegen/queries.config.json `keys`). `type Cache<V>` is `make_cache`, and the `Eq + Hash` bound
// is `hash_key`: a primitive standing for the key in JS maps (DefaultCache, QueryState). Keys whose
// types are not ported yet use `key_unported(..)`. Provided trait methods live in `QueryKey_provided`.
import { OwnerId, debug_OwnerId } from "../../rustc_hir_id/lib.ts";
import {
  type CrateNum,
  debug_CrateNum,
  debug_DefId,
  debug_LocalDefId,
  debug_LocalModId,
  debug_ModId,
  DefId,
  LOCAL_CRATE,
  LocalDefId,
  LocalModId,
  type ModId,
} from "../../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { debug_Ident, debug_Symbol, type Ident, type Symbol } from "../../rustc_span/symbol.ts";
import { debug_SizedTraitKind, type SizedTraitKind } from "../../rustc_type_ir/solve/mod.ts";
import { debug_AliasTyKind } from "../../rustc_type_ir/ty_kind.ts";
import { debug_ExistentialTraitRef, debug_TraitRef } from "../../rustc_type_ir/ir_print.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { debug_str } from "../../std/fmt.ts";
import { debug_Ty, type Ty } from "../ty/mod.ts";
import type { AdtDef } from "../ty/decls.ts";
import { debug_SimplifiedType, type SimplifiedType, SimplifiedType_key } from "../ty/fast_reject.ts";
import { debug_GenericArg, debug_GenericArgs, type GenericArg, type GenericArgsRef } from "../ty/generic_args.ts";
import { type Clauses, debug_RawList } from "../ty/list.ts";
import { debug_Clause } from "../ty/predicate.ts";
import type { ExistentialTraitRef, TraitRef } from "../ty/predicate.gen.ts";
import type { AliasTyKind } from "../ty/sty.gen.ts";
import { type Debug, debug_option, debug_tuple, type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";
import { DefaultCache, DefId_hash_key, DefIdCache, type QueryCache, SingleCache, VecCache } from "./caches.ts";

/// Placeholder for `CrateNum`'s "local" counterpart
export type LocalCrate = "LocalCrate";
export const LocalCrate: LocalCrate = "LocalCrate";
/** `#[derive(Debug)]` on the unit struct */
export const debug_LocalCrate: Debug<LocalCrate> = () => "LocalCrate";

/// Controls what types can legally be used as the key for a query.
export interface QueryKey<K, LocalK = never> {
  /// The type of in-memory cache to use for queries with this key type.
  ///
  /// In practice the cache type must implement [`QueryCache`], though that
  /// constraint is not enforced here.
  /** PORT: `type Cache<V> = DefaultCache<Self, V>` by default; `track_present` selects `Default::default()`
   * over `QueryCache::without_track_present()` (query_vtables.rs `make_query_vtable`). */
  make_cache<V>(track_present: boolean): QueryCache<K, V>;

  /// In the event that a cycle occurs, if no explicit span has been
  /// given for a query with key `self`, what span should we use?
  // rustc: compiler/rustc_middle/src/query/keys.rs:44 default_span
  default_span(self: K, tcx: TyCtxt): Span;

  /// If the key is a [`DefId`] or `DefId`--equivalent, return that `DefId`.
  /// Otherwise, return `None`.
  key_as_def_id(self: K): DefId | undefined;

  /// Given an instance of this key, what crate is it referring to?
  /// This is used to find the provider.
  as_local_key(self: K): LocalK | undefined;

  /** `QueryKeyBounds: Debug` */
  debug(v: K, f: Fmt): string;
  /** PORT: Debug of `LocalQueryKey` (`default_query` prints the local provider's key). Method syntax: a
   * `QueryKey<K, L>` is usable as a `QueryKey<K, unknown>` (the engine only passes back what `as_local_key` gave). */
  debug_local(v: LocalK, f: Fmt): string;
  /** PORT: `QueryKeyBounds: Eq + Hash`, as a JS map key (see the module comment). */
  hash_key(self: K): string | number | bigint;
}

/** `<K as QueryKey>::LocalQueryKey` of a `KEY_*` impl. */
export type LocalQueryKeyOf<Q> = Q extends QueryKey<infer _K, infer L> ? L : never;

/** Provided methods of `trait QueryKey` (PORTING §8: `<Trait>_provided`). */
export const QueryKey_provided = {
  // rustc: compiler/rustc_middle/src/query/keys.rs:48 key_as_def_id
  key_as_def_id<K>(_self: K): DefId | undefined {
    return undefined;
  },

  // rustc: compiler/rustc_middle/src/query/keys.rs:54 as_local_key
  as_local_key<K>(_self: K): never | undefined {
    return undefined;
  },
};

/** `type LocalQueryKey = !`: no value exists. */
const no_local_key = (v: never): string => v;

const default_cache =
  <K>(hash_key: (k: K) => string | number | bigint) =>
  <V>(_track_present: boolean): QueryCache<K, V> =>
    DefaultCache.default<K, V>(hash_key);

export const KEY_unit: QueryKey<null> = {
  make_cache: <V>(_track_present: boolean) => SingleCache.default<V>(),
  // rustc: compiler/rustc_middle/src/query/keys.rs:62 default_span
  default_span(_self: null, _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: () => "()",
  debug_local: no_local_key,
  hash_key: () => 0,
};

// PORT: `ShimKind`, `InstanceKind`, `Instance` (keys.rs:66-84) and `mir::interpret::GlobalId` (:90) are not ported
// yet (`key_unported`).

export const KEY_Ty_Option_ExistentialTraitRef: QueryKey<[Ty, ExistentialTraitRef | undefined]> = {
  make_cache: default_cache<[Ty, ExistentialTraitRef | undefined]>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:92 default_span
  default_span(_self: [Ty, ExistentialTraitRef | undefined], _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_tuple(f, "", [debug_Ty(v[0], f), debug_option(v[1], f, (x, f) => debug_ExistentialTraitRef(x, f))]),
  debug_local: no_local_key,
  hash_key: intern_key,
};

// PORT: `LitToConstInput` (keys.rs:96) is not ported yet (`key_unported`).

export const KEY_CrateNum: QueryKey<CrateNum, LocalCrate> = {
  make_cache: <V>(track_present: boolean) => (track_present ? VecCache.default<CrateNum, V>() : VecCache.without_track_present<CrateNum, V>()),
  // rustc: compiler/rustc_middle/src/query/keys.rs:108 default_span
  default_span(_self: CrateNum, _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  // rustc: compiler/rustc_middle/src/query/keys.rs:113 as_local_key
  as_local_key(self: CrateNum): LocalCrate | undefined {
    return self === LOCAL_CRATE ? LocalCrate : undefined;
  },
  debug: debug_CrateNum,
  debug_local: debug_LocalCrate,
  hash_key: (k) => k,
};

export const KEY_OwnerId: QueryKey<OwnerId> = {
  // PORT: `VecCache<OwnerId, ..>` indexed by `OwnerId::index()` (the owner's `LocalDefId`); the cache sees
  // the index, and gives the key back as an `OwnerId` in `for_each`.
  make_cache: <V>(_track_present: boolean) => OwnerIdCache<V>(),
  // rustc: compiler/rustc_middle/src/query/keys.rs:121 default_span
  default_span(self: OwnerId, tcx: TyCtxt): Span {
    return KEY_DefId.default_span(self.to_def_id(), tcx);
  },
  // rustc: compiler/rustc_middle/src/query/keys.rs:125 key_as_def_id
  key_as_def_id(self: OwnerId): DefId | undefined {
    return self.to_def_id();
  },
  as_local_key: QueryKey_provided.as_local_key,
  debug: debug_OwnerId,
  debug_local: no_local_key,
  hash_key: (k) => k.def_id,
};

function OwnerIdCache<V>(): QueryCache<OwnerId, V> {
  const inner = VecCache.default<LocalDefId, V>();
  return {
    lookup: (key) => inner.lookup(key.def_id),
    complete: (key, value, index) => inner.complete(key.def_id, value, index),
    for_each: (f) => inner.for_each((k, v, i) => f(new OwnerId(k), v, i)),
    len: () => inner.len(),
  };
}

export const KEY_LocalDefId: QueryKey<LocalDefId> = {
  make_cache: <V>(track_present: boolean) => (track_present ? VecCache.default<LocalDefId, V>() : VecCache.without_track_present<LocalDefId, V>()),
  // rustc: compiler/rustc_middle/src/query/keys.rs:133 default_span
  default_span(self: LocalDefId, tcx: TyCtxt): Span {
    return KEY_DefId.default_span(LocalDefId.to_def_id(self), tcx);
  },
  // rustc: compiler/rustc_middle/src/query/keys.rs:137 key_as_def_id
  key_as_def_id(self: LocalDefId): DefId | undefined {
    return LocalDefId.to_def_id(self);
  },
  as_local_key: QueryKey_provided.as_local_key,
  debug: debug_LocalDefId,
  debug_local: no_local_key,
  hash_key: (k) => k,
};

export const KEY_DefId: QueryKey<DefId, LocalDefId> = {
  make_cache: <V>(track_present: boolean) => (track_present ? DefIdCache.default<V>() : DefIdCache.without_track_present<V>()),
  // rustc: compiler/rustc_middle/src/query/keys.rs:146 default_span
  default_span(self: DefId, tcx: TyCtxt): Span {
    return tcx.def_span(self);
  },
  // rustc: compiler/rustc_middle/src/query/keys.rs:151 key_as_def_id
  key_as_def_id(self: DefId): DefId | undefined {
    return self;
  },
  // rustc: compiler/rustc_middle/src/query/keys.rs:156 as_local_key
  as_local_key(self: DefId): LocalDefId | undefined {
    return self.as_local();
  },
  debug: debug_DefId,
  debug_local: debug_LocalDefId,
  hash_key: DefId_hash_key,
};

export const KEY_ModId: QueryKey<ModId, LocalModId> = {
  make_cache: default_cache<ModId>((k) => DefId_hash_key(k._0)),
  // rustc: compiler/rustc_middle/src/query/keys.rs:164 default_span
  default_span(self: ModId, tcx: TyCtxt): Span {
    return tcx.def_span(self.to_def_id());
  },
  // rustc: compiler/rustc_middle/src/query/keys.rs:169 key_as_def_id
  key_as_def_id(self: ModId): DefId | undefined {
    return self.to_def_id();
  },
  // rustc: compiler/rustc_middle/src/query/keys.rs:174 as_local_key
  as_local_key(self: ModId): LocalModId | undefined {
    return self.as_local();
  },
  debug: debug_ModId,
  debug_local: debug_LocalModId,
  hash_key: (k) => DefId_hash_key(k._0),
};

export const KEY_LocalModId: QueryKey<LocalModId> = {
  make_cache: default_cache<LocalModId>((k) => k),
  // rustc: compiler/rustc_middle/src/query/keys.rs:180 default_span
  default_span(self: LocalModId, tcx: TyCtxt): Span {
    return tcx.def_span(LocalModId.to_def_id(self));
  },
  // rustc: compiler/rustc_middle/src/query/keys.rs:185 key_as_def_id
  key_as_def_id(self: LocalModId): DefId | undefined {
    return LocalModId.to_def_id(self);
  },
  as_local_key: QueryKey_provided.as_local_key,
  debug: debug_LocalModId,
  debug_local: no_local_key,
  hash_key: (k) => k,
};

export const KEY_SimplifiedType: QueryKey<SimplifiedType> = {
  make_cache: default_cache<SimplifiedType>(SimplifiedType_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:191 default_span
  default_span(_self: SimplifiedType, _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_SimplifiedType(v, f),
  debug_local: no_local_key,
  hash_key: SimplifiedType_key,
};

export const KEY_DefId_DefId: QueryKey<[DefId, DefId]> = {
  make_cache: default_cache<[DefId, DefId]>((k) => `${DefId_hash_key(k[0])},${DefId_hash_key(k[1])}`),
  // rustc: compiler/rustc_middle/src/query/keys.rs:197 default_span
  default_span(self: [DefId, DefId], tcx: TyCtxt): Span {
    return KEY_DefId.default_span(self[1], tcx);
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_tuple(f, "", [debug_DefId(v[0], f), debug_DefId(v[1], f)]),
  debug_local: no_local_key,
  hash_key: (k) => `${DefId_hash_key(k[0])},${DefId_hash_key(k[1])}`,
};

/** PORT: `impl Hash for Ident` (symbol.rs:2580) hashes the name and the span's `SyntaxContext`; `PartialEq` compares
 * the same (`eq_ctxt`). */
const Ident_hash_key = (ident: Ident): string => `${ident.name}:${Span.ctxt(ident.span)}`;

export const KEY_DefId_Ident: QueryKey<[DefId, Ident]> = {
  make_cache: default_cache<[DefId, Ident]>((k) => `${DefId_hash_key(k[0])},${Ident_hash_key(k[1])}`),
  // rustc: compiler/rustc_middle/src/query/keys.rs:203 default_span
  default_span(self: [DefId, Ident], tcx: TyCtxt): Span {
    return tcx.def_span(self[0]);
  },
  // rustc: compiler/rustc_middle/src/query/keys.rs:208 key_as_def_id
  key_as_def_id(self: [DefId, Ident]): DefId | undefined {
    return self[0];
  },
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_tuple(f, "", [debug_DefId(v[0], f), debug_Ident(v[1], f)]),
  debug_local: no_local_key,
  hash_key: (k) => `${DefId_hash_key(k[0])},${Ident_hash_key(k[1])}`,
};

export const KEY_LocalDefId_LocalDefId_Ident: QueryKey<[LocalDefId, LocalDefId, Ident]> = {
  make_cache: default_cache<[LocalDefId, LocalDefId, Ident]>((k) => `${k[0]},${k[1]},${Ident_hash_key(k[2])}`),
  // rustc: compiler/rustc_middle/src/query/keys.rs:214 default_span
  default_span(self: [LocalDefId, LocalDefId, Ident], tcx: TyCtxt): Span {
    return KEY_LocalDefId.default_span(self[1], tcx);
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_tuple(f, "", [debug_LocalDefId(v[0], f), debug_LocalDefId(v[1], f), debug_Ident(v[2], f)]),
  debug_local: no_local_key,
  hash_key: (k) => `${k[0]},${k[1]},${Ident_hash_key(k[2])}`,
};

export const KEY_CrateNum_DefId: QueryKey<[CrateNum, DefId], DefId> = {
  make_cache: default_cache<[CrateNum, DefId]>((k) => `${k[0]},${DefId_hash_key(k[1])}`),
  // rustc: compiler/rustc_middle/src/query/keys.rs:222 default_span
  default_span(self: [CrateNum, DefId], tcx: TyCtxt): Span {
    return KEY_DefId.default_span(self[1], tcx);
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  // rustc: compiler/rustc_middle/src/query/keys.rs:227 as_local_key
  as_local_key(self: [CrateNum, DefId]): DefId | undefined {
    return self[0] === LOCAL_CRATE ? self[1] : undefined;
  },
  debug: (v, f) => debug_tuple(f, "", [debug_CrateNum(v[0], f), debug_DefId(v[1], f)]),
  debug_local: debug_DefId,
  hash_key: (k) => `${k[0]},${DefId_hash_key(k[1])}`,
};

export const KEY_CrateNum_SimplifiedType: QueryKey<[CrateNum, SimplifiedType], SimplifiedType> = {
  make_cache: default_cache<[CrateNum, SimplifiedType]>((k) => `${k[0]},${SimplifiedType_key(k[1])}`),
  // rustc: compiler/rustc_middle/src/query/keys.rs:235 default_span
  default_span(_self: [CrateNum, SimplifiedType], _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  // rustc: compiler/rustc_middle/src/query/keys.rs:240 as_local_key
  as_local_key(self: [CrateNum, SimplifiedType]): SimplifiedType | undefined {
    return self[0] === LOCAL_CRATE ? self[1] : undefined;
  },
  debug: (v, f) => debug_tuple(f, "", [debug_CrateNum(v[0], f), debug_SimplifiedType(v[1], f)]),
  debug_local: (v, f) => debug_SimplifiedType(v, f),
  hash_key: (k) => `${k[0]},${SimplifiedType_key(k[1])}`,
};

export const KEY_DefId_SizedTraitKind: QueryKey<[DefId, SizedTraitKind]> = {
  make_cache: default_cache<[DefId, SizedTraitKind]>((k) => `${DefId_hash_key(k[0])},${k[1]}`),
  // rustc: compiler/rustc_middle/src/query/keys.rs:246 default_span
  default_span(self: [DefId, SizedTraitKind], tcx: TyCtxt): Span {
    return KEY_DefId.default_span(self[0], tcx);
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_tuple(f, "", [debug_DefId(v[0], f), debug_SizedTraitKind(v[1], f)]),
  debug_local: no_local_key,
  hash_key: (k) => `${DefId_hash_key(k[0])},${k[1]}`,
};

export const KEY_GenericArgsRef: QueryKey<GenericArgsRef> = {
  make_cache: default_cache<GenericArgsRef>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:252 default_span
  default_span(_self: GenericArgsRef, _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_GenericArgs(v, f),
  debug_local: no_local_key,
  hash_key: intern_key,
};

export const KEY_DefId_GenericArgsRef: QueryKey<[DefId, GenericArgsRef]> = {
  make_cache: default_cache<[DefId, GenericArgsRef]>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:258 default_span
  default_span(self: [DefId, GenericArgsRef], tcx: TyCtxt): Span {
    return KEY_DefId.default_span(self[0], tcx);
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_tuple(f, "", [debug_DefId(v[0], f), debug_GenericArgs(v[1], f)]),
  debug_local: no_local_key,
  hash_key: intern_key,
};

export const KEY_TraitRef: QueryKey<TraitRef> = {
  make_cache: default_cache<TraitRef>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:264 default_span
  default_span(self: TraitRef, tcx: TyCtxt): Span {
    return tcx.def_span(self.def_id);
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_TraitRef(v, f),
  debug_local: no_local_key,
  hash_key: intern_key,
};

export const KEY_GenericArg: QueryKey<GenericArg> = {
  make_cache: default_cache<GenericArg>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:270 default_span
  default_span(_self: GenericArg, _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_GenericArg(v, f),
  debug_local: no_local_key,
  hash_key: intern_key,
};

export const KEY_Ty: QueryKey<Ty> = {
  make_cache: default_cache<Ty>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:276 default_span
  default_span(self: Ty, tcx: TyCtxt): Span {
    const def_id = def_id_of_type(self);
    return def_id !== undefined ? tcx.def_span(def_id) : DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_Ty(v, f),
  debug_local: no_local_key,
  hash_key: intern_key,
};

export const KEY_Ty_Ty: QueryKey<[Ty, Ty]> = {
  make_cache: default_cache<[Ty, Ty]>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:282 default_span
  default_span(_self: [Ty, Ty], _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_tuple(f, "", [debug_Ty(v[0], f), debug_Ty(v[1], f)]),
  debug_local: no_local_key,
  hash_key: intern_key,
};

export const KEY_Clauses: QueryKey<Clauses> = {
  make_cache: default_cache<Clauses>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:288 default_span
  default_span(_self: Clauses, _: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_RawList(v, f, debug_Clause),
  debug_local: no_local_key,
  hash_key: intern_key,
};

export const KEY_AliasTyKind: QueryKey<AliasTyKind> = {
  make_cache: default_cache<AliasTyKind>(intern_key),
  // rustc: compiler/rustc_middle/src/query/keys.rs:294 default_span
  default_span(self: AliasTyKind, tcx: TyCtxt): Span {
    const def_id = ((): DefId => {
      switch (self.$) {
        case "Projection":
        case "Inherent":
        case "Opaque":
        case "Free":
          return self.def_id;
      }
    })();
    return tcx.def_span(def_id);
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_AliasTyKind(v, f),
  debug_local: no_local_key,
  hash_key: intern_key,
};

// PORT: `PseudoCanonicalInput<T>` (keys.rs:304) and `(AdtDef, GenericArgsRef)` (:310) are not ported yet
// (`key_unported`).

export const KEY_Symbol: QueryKey<Symbol> = {
  make_cache: default_cache<Symbol>((k) => k),
  // rustc: compiler/rustc_middle/src/query/keys.rs:318 default_span
  default_span(_self: Symbol, _tcx: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: debug_Symbol,
  debug_local: no_local_key,
  hash_key: (k) => k,
};

export const KEY_Option_Symbol: QueryKey<Symbol | undefined> = {
  make_cache: default_cache<Symbol | undefined>((k) => (k === undefined ? -1 : k)),
  // rustc: compiler/rustc_middle/src/query/keys.rs:324 default_span
  default_span(_self: Symbol | undefined, _tcx: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v, f) => debug_option(v, f, debug_Symbol),
  debug_local: no_local_key,
  hash_key: (k) => (k === undefined ? -1 : k),
};

/** PORT: `&OsStr` is a JS string (rustc_interface `env_var_os`); its `Debug` is the quoted, escaped string. */
export const KEY_OsStr: QueryKey<string> = {
  make_cache: default_cache<string>((k) => k),
  // rustc: compiler/rustc_middle/src/query/keys.rs:330 default_span
  default_span(_self: string, _tcx: TyCtxt): Span {
    return DUMMY_SP;
  },
  key_as_def_id: QueryKey_provided.key_as_def_id,
  as_local_key: QueryKey_provided.as_local_key,
  debug: (v) => debug_str(v),
  debug_local: no_local_key,
  hash_key: (k) => k,
};

// PORT: the canonical inputs (keys.rs:336-376), `(Ty, VariantIdx)`, `(Predicate, WellFormedLoc)`,
// `(PolyFnSig, &List<Ty>)`, `(Instance, &List<Ty>)`, `ty::Value`, `(LocalExpnId, &TokenStream)`,
// `(ValidityRequirement, PseudoCanonicalInput<Ty>)` and `(Instance, CollectionMode)` (:378-422) are not ported yet
// (`key_unported`).

/// Gets a `DefId` associated with a type
///
/// Visited set is needed to avoid full iteration over
/// deeply nested tuples that have no DefId.
// rustc: compiler/rustc_middle/src/query/keys.rs:427 def_id_of_type_cached
function def_id_of_type_cached(ty: Ty, visited: Set<Ty>): DefId | undefined {
  const kind = ty.kind();
  switch (kind.$) {
    case "Adt":
      return AdtDef_did(kind._0);

    case "Dynamic":
      return kind._0.principal_def_id();

    case "Pat":
    case "Array":
    case "Slice":
      return def_id_of_type_cached(kind._0, visited);

    case "RawPtr":
      return def_id_of_type_cached(kind._0, visited);

    case "Ref":
      return def_id_of_type_cached(kind._1, visited);

    case "Tuple":
      for (const ty of kind._0) {
        if (!visited.has(ty)) {
          visited.add(ty);
          const r = def_id_of_type_cached(ty, visited);
          if (r !== undefined) return r;
          continue;
        }
      }
      return undefined;

    case "FnDef":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Foreign":
      return kind._0;

    case "Alias": {
      const alias = kind._1;
      switch (alias.kind.$) {
        case "Projection":
        case "Inherent":
        case "Opaque":
        case "Free":
          return alias.kind.def_id;
      }
      break;
    }

    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Str":
    case "FnPtr":
    case "UnsafeBinder":
    case "Placeholder":
    case "Param":
    case "Infer":
    case "Bound":
    case "Error":
    case "Never":
    case "Float":
      return undefined;
  }
}

// rustc: compiler/rustc_middle/src/query/keys.rs:479 def_id_of_type
function def_id_of_type(ty: Ty): DefId | undefined {
  return def_id_of_type_cached(ty, new Set());
}

/** PORT: stand-in for `AdtDef::did` (ty/adt.rs, lane ty-adt-assoc): `AdtDef` is still `Pending` in ty/decls.ts. */
function AdtDef_did(adt: AdtDef): DefId {
  return (adt as unknown as { did(): DefId }).did();
}

/**
 * PORT: the `QueryKey` impl of a key type that is not ported yet (`rust_type` as written in queries.rs).
 * Declaring the query is fine; using its key (cache, cycle reporting, Debug) is unported.
 */
export function key_unported<K>(rust_type: string): QueryKey<K, unknown> {
  const no = (what: string): never => unported(`rustc_middle::query::keys: QueryKey for \`${rust_type}\` (${what})`);
  return {
    make_cache: <V>(_track_present: boolean): QueryCache<K, V> => ({
      lookup: () => no("cache"),
      complete: () => no("cache"),
      for_each: () => no("cache"),
      len: () => 0,
    }),
    default_span: () => no("default_span"),
    key_as_def_id: () => no("key_as_def_id"),
    as_local_key: () => no("as_local_key"),
    debug: () => no("Debug"),
    debug_local: () => no("Debug"),
    hash_key: () => no("Hash"),
  };
}
