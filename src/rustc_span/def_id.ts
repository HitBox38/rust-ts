// Port of compiler/rustc_span/src/def_id.rs
import { AtomicRef } from "../rustc_data_structures/atomic_ref.ts";
import { debug_Fingerprint, Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { debug_Hash64, Hash64 } from "../rustc_hashes/lib.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import { debug_struct, debug_tuple, type Debug, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert, panic } from "../std/panic.ts";
import { utf8 } from "../std/str.ts";
import { type RawDefId, type StableHashCtxt, StableHasher, StableOrd_String, stable_hash_Hash64 } from "../rustc_data_structures/stable_hash.ts";
import type { Hasher } from "../vendor/rustc_stable_hash/lib.ts";
import { stable_hash_DefPathHash, stable_hash_StableCrateId } from "./stable_hash.gen.ts";
import { Symbol } from "./symbol.ts";

export type { RawDefId };

export type StableCrateIdMap = Map<StableCrateId, CrateNum>;

export type CrateNum = number & { readonly __brand: "CrateNum" };

/// Item definitions in the currently-compiled crate would have the `CrateNum`
/// `LOCAL_CRATE` in their `DefId`.
// PORT: `CrateNum::ZERO` inlined: the companion const below is not initialized yet.
export const LOCAL_CRATE: CrateNum = 0 as CrateNum;

export const CrateNum = {
  ...newtype_index<CrateNum>((n) => `crate${n}`),

  // rustc: compiler/rustc_span/src/def_id.rs:32 new
  new(x: number): CrateNum {
    return CrateNum.from_usize(x);
  },

  // FIXME(typed_def_id): Replace this with `as_mod_def_id`.
  // rustc: compiler/rustc_span/src/def_id.rs:38 as_def_id
  as_def_id(self: CrateNum): DefId {
    return new DefId(CRATE_DEF_INDEX, self);
  },

  // rustc: compiler/rustc_span/src/def_id.rs:43 as_mod_id
  as_mod_id(self: CrateNum): ModId {
    return ModId.new_unchecked(new DefId(CRATE_DEF_INDEX, self));
  },
};
/// `#[debug_format = "crate{}"]`
export const debug_CrateNum: Debug<CrateNum> = CrateNum.debug;

// rustc: compiler/rustc_span/src/def_id.rs:49 fmt
export const display_CrateNum = (v: CrateNum): string => String(CrateNum.as_u32(v));

/// A `DefPathHash` is a fixed-size representation of a `DefPath` that is
/// stable across crate and compilation session boundaries. It consists of two
/// separate 64-bit hashes. The first uniquely identifies the crate this
/// `DefPathHash` originates from (see [StableCrateId]), and the second
/// uniquely identifies the corresponding `DefPath` within that crate. Together
/// they form a unique identifier within an entire crate graph.
///
/// (See upstream for the full discussion of collision probabilities.)
// PORT: tuple newtype over a primitive → branded bigint; `DefPathHash(x)` → `DefPathHash.of(x)`,
// `self.0` → `DefPathHash._0(self)`.
export type DefPathHash = bigint & { readonly __brand: "DefPathHash" };
export const DefPathHash = {
  of(_0: Fingerprint): DefPathHash {
    return _0 as bigint as DefPathHash;
  },
  _0(self: DefPathHash): Fingerprint {
    return self as bigint as Fingerprint;
  },

  /// Returns the [StableCrateId] identifying the crate this [DefPathHash]
  /// originates from.
  // rustc: compiler/rustc_span/src/def_id.rs:103 stable_crate_id
  stable_crate_id(self: DefPathHash): StableCrateId {
    return StableCrateId.of(Fingerprint.split(DefPathHash._0(self))[0]);
  },

  /// Returns the crate-local part of the [DefPathHash].
  // rustc: compiler/rustc_span/src/def_id.rs:109 local_hash
  local_hash(self: DefPathHash): Hash64 {
    return Fingerprint.split(DefPathHash._0(self))[1];
  },

  /// Builds a new [DefPathHash] with the given [StableCrateId] and
  /// `local_hash`, where `local_hash` must be unique within its crate.
  // rustc: compiler/rustc_span/src/def_id.rs:116 new
  new(stable_crate_id: StableCrateId, local_hash: Hash64): DefPathHash {
    return DefPathHash.of(Fingerprint.new(StableCrateId._0(stable_crate_id), local_hash));
  },

  // rustc: compiler/rustc_span/src/def_id.rs:122 default
  default(): DefPathHash {
    return DefPathHash.of(Fingerprint.ZERO);
  },
};
/// `#[derive(Debug)]`
export const debug_DefPathHash: Debug<DefPathHash> = (v, f) =>
  debug_tuple(f, "DefPathHash", [debug_Fingerprint(DefPathHash._0(v), f)]);

/// A [`StableCrateId`] is a 64-bit hash of a crate name, together with all
/// `-Cmetadata` arguments, and some other data. It is to [`CrateNum`] what [`DefPathHash`] is to
/// [`DefId`]. It is stable across compilation sessions.
///
/// Since the ID is a hash value, there is a small chance that two crates
/// end up with the same [`StableCrateId`]. The compiler will check for such
/// collisions when loading crates and abort compilation in order to avoid
/// further trouble.
///
/// For more information on the possibility of hash collisions in rustc,
/// see the discussion in [`DefId`].
// PORT: tuple newtype over a primitive → branded bigint (see DefPathHash).
export type StableCrateId = bigint & { readonly __brand: "StableCrateId" };
export const StableCrateId = {
  of(_0: Hash64): StableCrateId {
    return _0 as bigint as StableCrateId;
  },
  _0(self: StableCrateId): Hash64 {
    return self as bigint as Hash64;
  },

  /// Computes the stable ID for a crate with the given name and
  /// `-Cmetadata` arguments.
  // rustc: compiler/rustc_span/src/def_id.rs:152 new
  new(crate_name: Symbol, is_exe: boolean, metadata_: readonly string[], cfg_version: string): StableCrateId {
    const hasher = StableHasher.new();
    // We must hash the string text of the crate name, not the id, as the id is not stable
    // across builds.
    // `str::hash` -> `Hasher::write_str`
    hasher.write_str(utf8(Symbol.as_str(crate_name)));

    // PORT: `mut metadata: Vec<String>` is taken by value: sort a copy.
    let metadata = metadata_.slice();
    // We don't want the stable crate ID to depend on the order of
    // -C metadata arguments, so sort them:
    // (`String`'s `Ord` is byte-wise: `StableOrd_String.cmp`)
    metadata.sort(StableOrd_String.cmp);
    // Every distinct -C metadata value is only incorporated once:
    metadata = metadata.filter((s, i) => i === 0 || s !== metadata[i - 1]);

    hasher.write(utf8("metadata"));
    for (const s of metadata) {
      // Also incorporate the length of a metadata string, so that we generate
      // different values for `-Cmetadata=ab -Cmetadata=c` and
      // `-Cmetadata=a -Cmetadata=bc`
      const bytes = utf8(s);
      hasher.write_usize(bytes.length);
      hasher.write(bytes);
    }

    // Also incorporate crate type, so that we don't get symbol conflicts when
    // linking against a library of the same name, if this is an executable.
    hasher.write(utf8(is_exe ? "exe" : "lib"));

    // Also incorporate the rustc version. Otherwise, with -Zsymbol-mangling-version=v0
    // and no -Cmetadata, symbols from the same crate compiled with different versions of
    // rustc are named the same.
    //
    // RUSTC_FORCE_RUSTC_VERSION is used to inject rustc version information
    // during testing.
    const val = process.env.RUSTC_FORCE_RUSTC_VERSION;
    if (val !== undefined) {
      // `val.to_string_lossy()`: JS environment strings are already (lossily) decoded.
      hasher.write(utf8(val));
    } else {
      hasher.write(utf8(cfg_version));
    }

    return StableCrateId.of(hasher.finish(Hash64));
  },

  // rustc: compiler/rustc_span/src/def_id.rs:198 as_u64
  as_u64(self: StableCrateId): bigint {
    return Hash64.as_u64(StableCrateId._0(self));
  },
};
/// `#[derive(Debug)]`
export const debug_StableCrateId: Debug<StableCrateId> = (v, f) =>
  debug_tuple(f, "StableCrateId", [debug_Hash64(StableCrateId._0(v), f)]);

// PORT: `fmt::LowerHex`; `Fmt` models only `#` (alternate → `0x` prefix), not width/fill.
// rustc: compiler/rustc_span/src/def_id.rs:204 fmt
export const lower_hex_StableCrateId = (v: StableCrateId, f: Fmt): string =>
  (f.alternate ? "0x" : "") + StableCrateId._0(v).toString(16);

/// A DefIndex is an index into the hir-map for a crate, identifying a
/// particular definition. It should really be considered an interned
/// shorthand for a particular DefPath.
export type DefIndex = number & { readonly __brand: "DefIndex" };
export const DefIndex = newtype_index<DefIndex>((n) => `DefIndex(${n})`);
/// `#[debug_format = "DefIndex({})"]`
export const debug_DefIndex: Debug<DefIndex> = DefIndex.debug;
/// The crate root is always assigned index 0 by the AST Map code,
/// thanks to `NodeCollector::new`.
export const CRATE_DEF_INDEX: DefIndex = DefIndex.from_u32(0);

/// A `DefId` identifies a particular *definition*, by combining a crate
/// index and a def index.
///
/// You can create a `DefId` from a `LocalDefId` using `local_def_id.to_def_id()`.
// PORT: fields in upstream declaration order for little-endian 64-bit targets (`index`, `krate`);
// the constructor follows it. Equality: `DefId_eq`. Not usable as a JS `Map` key as-is.
export class DefId {
  constructor(
    readonly index: DefIndex,
    readonly krate: CrateNum,
  ) {}

  // On 64-bit systems, we can hash the whole `DefId` as one `u64` instead of two `u32`s.
  // rustc: compiler/rustc_span/src/def_id.rs:269 hash
  hash(h: Hasher): void {
    // `u64::hash` → `Hasher::write_u64`
    h.write_u64((BigInt(CrateNum.as_u32(this.krate)) << 32n) | BigInt(DefIndex.as_u32(this.index)));
  }

  /// Makes a local `DefId` from the given `DefIndex`.
  // rustc: compiler/rustc_span/src/def_id.rs:277 local
  static local(index: DefIndex): DefId {
    return new DefId(index, LOCAL_CRATE);
  }

  /// Returns whether the item is defined in the crate currently being compiled.
  // rustc: compiler/rustc_span/src/def_id.rs:283 is_local
  is_local(): boolean {
    return this.krate === LOCAL_CRATE;
  }

  // rustc: compiler/rustc_span/src/def_id.rs:288 as_local
  as_local(): LocalDefId | undefined {
    return this.is_local() ? LocalDefId.of(this.index) : undefined;
  }

  // rustc: compiler/rustc_span/src/def_id.rs:294 expect_local
  expect_local(): LocalDefId {
    // NOTE: `match` below is required to apply `#[track_caller]`,
    // i.e. don't use closures.
    const local_def_id = this.as_local();
    if (local_def_id !== undefined) return local_def_id;
    panic(`DefId::expect_local: \`${debug_DefId(this, PLAIN)}\` isn't local`);
  }

  // rustc: compiler/rustc_span/src/def_id.rs:304 is_crate_root
  is_crate_root(): boolean {
    return this.index === CRATE_DEF_INDEX;
  }

  // rustc: compiler/rustc_span/src/def_id.rs:309 as_crate_root
  as_crate_root(): CrateNum | undefined {
    return this.is_crate_root() ? this.krate : undefined;
  }

  // rustc: compiler/rustc_span/src/def_id.rs:314 is_top_level_module
  is_top_level_module(): boolean {
    return this.is_local() && this.is_crate_root();
  }

  // rustc: compiler/rustc_span/src/def_id.rs:319 to_raw_def_id
  to_raw_def_id(): RawDefId {
    // Field order must match `from_raw_def_id`.
    return [CrateNum.as_u32(this.krate), DefIndex.as_u32(this.index)];
  }

  // rustc: compiler/rustc_span/src/def_id.rs:325 from_raw_def_id
  static from_raw_def_id([a, b]: RawDefId): DefId {
    // Field order must match `to_raw_def_id`.
    return new DefId(DefIndex.from_u32(b), CrateNum.from_u32(a));
  }
}

/// `#[derive(PartialEq)]`
export function DefId_eq(a: DefId, b: DefId): boolean {
  return a.index === b.index && a.krate === b.krate;
}

// rustc: compiler/rustc_span/src/def_id.rs:332 from
export function DefId_from_LocalDefId(local: LocalDefId): DefId {
  return LocalDefId.to_def_id(local);
}

// rustc: compiler/rustc_span/src/def_id.rs:337 default_def_id_debug
export function default_def_id_debug(def_id: DefId, f: Fmt): string {
  return debug_struct(f, "DefId", [
    ["krate", debug_CrateNum(def_id.krate, f)],
    ["index", debug_DefIndex(def_id.index, f)],
  ]);
}

export type DefIdDebugFn = (def_id: DefId, f: Fmt) => string;

export const DEF_ID_DEBUG: AtomicRef<DefIdDebugFn> = AtomicRef.new<DefIdDebugFn>(default_def_id_debug);

// rustc: compiler/rustc_span/src/def_id.rs:345 fmt
export const debug_DefId: Debug<DefId> = (v, f) => DEF_ID_DEBUG.deref()(v, f);

// PORT: `define_id_collections!(DefIdMap, DefIdSet, DefIdMapEntry, DefId)` not ported: `DefId` is
// not a primitive, so a JS Map keyed on it needs a key strategy (root decision).

/// A `LocalDefId` is equivalent to a `DefId` with `krate == LOCAL_CRATE`. Since
/// we encode this information in the type, we can ensure at compile time that
/// no `DefId`s from upstream crates get thrown into the mix. There are quite a
/// few cases where we know that only `DefId`s from the local crate are expected;
/// a `DefId` from a different crate would signify a bug somewhere. This
/// is when `LocalDefId` comes in handy.
// PORT: interned handle (PORTING §5): branded number equal to `local_def_index`.
// The struct literal `LocalDefId { local_def_index }` → `LocalDefId.of(local_def_index)`.
export type LocalDefId = number & { readonly __brand: "LocalDefId" };

function mk_local_def_id(local_def_index: DefIndex): LocalDefId {
  return local_def_index as number as LocalDefId;
}

export const CRATE_DEF_ID: LocalDefId = mk_local_def_id(CRATE_DEF_INDEX);
// PORT: `CRATE_MOD_ID` is defined after `LocalModId` below (module init order).

export const LocalDefId = {
  of(local_def_index: DefIndex): LocalDefId {
    return mk_local_def_id(local_def_index);
  },
  local_def_index(self: LocalDefId): DefIndex {
    return self as number as DefIndex;
  },

  // rustc: compiler/rustc_span/src/def_id.rs:374 new
  new(idx: number): LocalDefId {
    return LocalDefId.of(DefIndex.new(idx));
  },
  // rustc: compiler/rustc_span/src/def_id.rs:378 index
  index(self: LocalDefId): number {
    return DefIndex.index(LocalDefId.local_def_index(self));
  },

  // rustc: compiler/rustc_span/src/def_id.rs:385 to_def_id
  to_def_id(self: LocalDefId): DefId {
    return new DefId(LocalDefId.local_def_index(self), LOCAL_CRATE);
  },

  // rustc: compiler/rustc_span/src/def_id.rs:390 is_top_level_module
  is_top_level_module(self: LocalDefId): boolean {
    return self === CRATE_DEF_ID;
  },
};

// rustc: compiler/rustc_span/src/def_id.rs:396 fmt
export const debug_LocalDefId: Debug<LocalDefId> = (v, f) => debug_DefId(LocalDefId.to_def_id(v), f);

// rustc-skip: compiler/rustc_span/src/def_id.rs:402 encode Encodable impl (metadata, M5)
// rustc-skip: compiler/rustc_span/src/def_id.rs:408 decode Decodable impl (metadata, M5)

// PORT: `define_id_collections!(LocalDefIdMap, LocalDefIdSet, ..)` → use `Map<LocalDefId, _>` /
// `Set<LocalDefId>` directly (LocalDefId is a primitive).

// rustc: compiler/rustc_span/src/def_id.rs:422 stable_hash
/** `impl StableHash for DefId`: its `DefPathHash`. */
export function stable_hash_DefId(self: DefId, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_DefPathHash(DefId_to_stable_hash_key(self, hcx), hcx, hasher);
}

// rustc: compiler/rustc_span/src/def_id.rs:429 stable_hash
/** `impl StableHash for LocalDefId`: the local half of its `DefPathHash`. */
export function stable_hash_LocalDefId(self: LocalDefId, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Hash64(DefPathHash.local_hash(LocalDefId_to_stable_hash_key(self, hcx)), hcx, hasher);
}

// rustc: compiler/rustc_span/src/def_id.rs:436 stable_hash
/** `impl StableHash for CrateNum`: its `StableCrateId`. */
export function stable_hash_CrateNum(self: CrateNum, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_StableCrateId(DefPathHash.stable_crate_id(DefId_to_stable_hash_key(CrateNum.as_def_id(self), hcx)), hcx, hasher);
}

// PORT: `ToStableHashKey` impls of `DefId` / `LocalDefId` are ported (not skipped): `DefId`'s
// `StableHash` and `hygiene::update_disambiguator` (the `ExpnHash`'s crate half) go through them.
// rustc: compiler/rustc_span/src/def_id.rs:445 to_stable_hash_key
/** `impl ToStableHashKey for DefId { type KeyType = DefPathHash; }` */
export function DefId_to_stable_hash_key(self: DefId, hcx: StableHashCtxt): DefPathHash {
  return DefPathHash.of(hcx.def_path_hash(self.to_raw_def_id()));
}

// rustc: compiler/rustc_span/src/def_id.rs:454 to_stable_hash_key
/** `impl ToStableHashKey for LocalDefId { type KeyType = DefPathHash; }` */
export function LocalDefId_to_stable_hash_key(self: LocalDefId, hcx: StableHashCtxt): DefPathHash {
  return DefId_to_stable_hash_key(LocalDefId.to_def_id(self), hcx);
}

// PORT: single-field tuple struct over a class → small immutable class; equality `ModId_eq`.
export class ModId {
  constructor(readonly _0: DefId) {}

  // rustc: compiler/rustc_span/src/def_id.rs:464 new_unchecked
  static new_unchecked(def_id: DefId): ModId {
    return new ModId(def_id);
  }

  // rustc: compiler/rustc_span/src/def_id.rs:469 to_def_id
  to_def_id(): DefId {
    return DefId_from_ModId(this);
  }

  // rustc: compiler/rustc_span/src/def_id.rs:474 is_local
  is_local(): boolean {
    return this._0.is_local();
  }

  // rustc: compiler/rustc_span/src/def_id.rs:479 as_local
  as_local(): LocalModId | undefined {
    const l = this._0.as_local();
    return l === undefined ? undefined : LocalModId.new_unchecked(l);
  }

  // rustc: compiler/rustc_span/src/def_id.rs:483 expect_local
  expect_local(): LocalModId {
    return LocalModId.new_unchecked(this._0.expect_local());
  }

  // rustc: compiler/rustc_span/src/def_id.rs:487 is_crate_root
  is_crate_root(): boolean {
    return this._0.is_crate_root();
  }

  // rustc: compiler/rustc_span/src/def_id.rs:491 is_top_level_module
  is_top_level_module(): boolean {
    return this._0.is_top_level_module();
  }
}

/// `#[derive(PartialEq)]`
export function ModId_eq(a: ModId, b: ModId): boolean {
  return DefId_eq(a._0, b._0);
}

/// `#[derive(Debug)]`
export const debug_ModId: Debug<ModId> = (v, f) => debug_tuple(f, "ModId", [debug_DefId(v._0, f)]);

// rustc: compiler/rustc_span/src/def_id.rs:498 from
export function ModId_from_LocalModId(local: LocalModId): ModId {
  return new ModId(LocalDefId.to_def_id(LocalModId._0(local)));
}

// rustc: compiler/rustc_span/src/def_id.rs:505 from
export function DefId_from_ModId(typed: ModId): DefId {
  return typed._0;
}

// PORT: single-field tuple struct over an interned handle → branded number (same value).
export type LocalModId = number & { readonly __brand: "LocalModId" };
export const LocalModId = {
  _0(self: LocalModId): LocalDefId {
    return self as number as LocalDefId;
  },

  // rustc: compiler/rustc_span/src/def_id.rs:518 new_unchecked
  new_unchecked(def_id: LocalDefId): LocalModId {
    return def_id as number as LocalModId;
  },

  // rustc: compiler/rustc_span/src/def_id.rs:522 is_top_level_module
  is_top_level_module(self: LocalModId): boolean {
    return LocalDefId.is_top_level_module(LocalModId._0(self));
  },

  // rustc: compiler/rustc_span/src/def_id.rs:527 to_def_id
  to_def_id(self: LocalModId): DefId {
    return DefId_from_LocalDefId(LocalModId._0(self));
  },

  // rustc: compiler/rustc_span/src/def_id.rs:531 to_mod_id
  to_mod_id(self: LocalModId): ModId {
    return ModId.new_unchecked(LocalDefId.to_def_id(LocalModId._0(self)));
  },

  // rustc: compiler/rustc_span/src/def_id.rs:536 to_local_def_id
  to_local_def_id(self: LocalModId): LocalDefId {
    return LocalModId._0(self);
  },
};

/// `#[derive(Debug)]`
export const debug_LocalModId: Debug<LocalModId> = (v, f) =>
  debug_tuple(f, "LocalModId", [debug_LocalDefId(LocalModId._0(v), f)]);

export const CRATE_MOD_ID: LocalModId = LocalModId.new_unchecked(CRATE_DEF_ID);

// rustc: compiler/rustc_span/src/def_id.rs:543 from
export function LocalDefId_from_LocalModId(typed: LocalModId): LocalDefId {
  return LocalModId._0(typed);
}

// rustc: compiler/rustc_span/src/def_id.rs:550 from
export function DefId_from_LocalModId(typed: LocalModId): DefId {
  return DefId_from_LocalDefId(LocalModId._0(typed));
}
