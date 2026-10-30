// Port of compiler/rustc_hir_id/src/definitions.rs
//! For each definition, we track the following data. A definition
//! here is defined somewhat circularly as "something with a `DefId`",
//! but it generally corresponds to things like structs, enums, etc.
//! There are also some rather random cases (like const initializer
//! expressions) that are mostly just leftovers.
//
// Types are generated into definitions.gen.ts (tools/codegen/types.ts, set `rustc_hir`);
// `PerParentDisambiguatorState` is hand-written here (`hand` in the set). Methods are attached to
// the generated classes (`declare module` + prototype), associated fns are statics on the
// re-exported class consts, enum methods live on the companion (PORTING §8).
import { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import { StableHasher } from "../rustc_data_structures/stable_hash.ts";
import { utf8 } from "../std/str.ts";
import type { Encodable } from "../rustc_serialize/serialize.ts";
import type { SpanEncoder } from "../rustc_span/lib.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { CRATE_DEF_INDEX, type CrateNum, type DefIndex, debug_DefIndex, DefPathHash, LOCAL_CRATE, LocalDefId, StableCrateId } from "../rustc_span/def_id.ts";
import { display_Symbol, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_struct, debug_tuple, debug_vec, type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../std/panic.ts";
import { Config, HashTableOwned } from "./def_path_hash_map.ts";
import * as gen from "./definitions.gen.ts";
import { debug_DefPath, type DefKey, DefPathToIndexMap, DisambiguatedDefPathData } from "./definitions.gen.ts";

export * from "./definitions.gen.ts";

// pub use rustc_span::def_id::DefPathHash;
export { DefPathHash } from "../rustc_span/def_id.ts";

// ---- stand-ins (PORT) ------------------------------------------------------------------------

// PORT: `SortedMap` is rustc_data_structures/sorted_map.ts (re-exported for the existing importers of this module).
export { debug_SortedMap, SortedMap } from "../rustc_data_structures/sorted_map.ts";

/** `Ord for Hash64` (the `u64`), the comparator of `after_parallel_alloc`'s `SortedMap`. */
function Hash64_cmp(a: Hash64, b: Hash64): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * PORT: `FxHashMap<DefPathData, u32>`: a JS `Map` keys objects by identity, so lookups go through a
 * canonical key (`$` + symbol). The first-inserted key object is the one stored and iterated, so
 * `Map` iteration/`size` (and `debug_HashMap`) see the same entries as upstream.
 */
export class DefPathDataMap<V> extends Map<DefPathData, V> {
  private readonly canon = new Map<string, DefPathData>();

  private static key(d: DefPathData): string {
    return "_0" in d ? `${d.$}:${d._0}` : d.$;
  }

  override get(k: DefPathData): V | undefined {
    const c = this.canon?.get(DefPathDataMap.key(k));
    return c === undefined ? undefined : super.get(c);
  }

  override has(k: DefPathData): boolean {
    return this.canon?.has(DefPathDataMap.key(k)) ?? false;
  }

  override set(k: DefPathData, v: V): this {
    // `canon` is undefined while `super()` runs (Map's constructor never calls `set` without entries).
    const key = DefPathDataMap.key(k);
    let c = this.canon.get(key);
    if (c === undefined) {
      c = k;
      this.canon.set(key, k);
    }
    return super.set(c, v);
  }

  override delete(k: DefPathData): boolean {
    const key = DefPathDataMap.key(k);
    const c = this.canon.get(key);
    if (c === undefined) return false;
    this.canon.delete(key);
    return super.delete(c);
  }

  override clear(): void {
    this.canon.clear();
    super.clear();
  }
}

// ---- upstream ---------------------------------------------------------------------------------

export class PerParentDisambiguatorState {
  // #[cfg(debug_assertions)] parent: Option<LocalDefId>,  (rustc ships without debug assertions)
  constructor(public next: DefPathDataMap<number>) {}

  // rustc: compiler/rustc_hir_id/src/definitions.rs:35 new
  static new(_parent: LocalDefId): PerParentDisambiguatorState {
    return new PerParentDisambiguatorState(
      // #[cfg(debug_assertions)] parent: Some(_parent),
      new DefPathDataMap<number>(),
    );
  }

  /** `#[derive(Default)]` */
  static default(): PerParentDisambiguatorState {
    return new PerParentDisambiguatorState(new DefPathDataMap<number>());
  }
}

/** `#[derive(Clone)]` */
export function clone_PerParentDisambiguatorState(v: PerParentDisambiguatorState): PerParentDisambiguatorState {
  const next = new DefPathDataMap<number>();
  for (const [k, x] of v.next) next.set(k, x);
  return new PerParentDisambiguatorState(next);
}

// #[extension(pub trait PerParentDisambiguatorsMap)] impl LocalDefIdMap<PerParentDisambiguatorState>
// PORT: extension trait on `LocalDefIdMap<_>` (= `Map<LocalDefId, _>`) -> functions on a companion.
export const PerParentDisambiguatorsMap = {
  // rustc: compiler/rustc_hir_id/src/definitions.rs:46 get_or_create
  get_or_create(self: Map<LocalDefId, PerParentDisambiguatorState>, parent: LocalDefId): PerParentDisambiguatorState {
    let v = self.get(parent);
    if (v === undefined) {
      v = PerParentDisambiguatorState.new(parent);
      self.set(parent, v);
    }
    return v;
  },
};

declare module "./definitions.gen.ts" {
  interface DefPathToIndexMap {
    get(hash: Hash64): DefIndex | undefined;
    insert(hash: Hash64, index: DefIndex): DefIndex | undefined;
  }
  interface DefKey {
    compute_stable_hash(parent: DefPathHash): DefPathHash;
    get_opt_name(): Symbol | undefined;
  }
  interface DisambiguatedDefPathData {
    as_sym(verbose: boolean): Symbol;
  }
  interface DefPath {
    to_string_no_crate_verbose(): string;
    to_filename_friendly_no_crate(): string;
  }
  interface Definitions {
    commit_end_of_determinism(): void;
    def_key(id: LocalDefId): DefKey;
    def_path_hash(id: LocalDefId): DefPathHash;
    def_path(id: LocalDefId): DefPath;
    allocate(key: DefKey, def_path_hash: DefPathHash): LocalDefId;
    enumerated_keys_and_path_hashes(): [DefIndex, DefKey, DefPathHash][];
    create_def(parent: LocalDefId, data: DefPathData, disambiguator: PerParentDisambiguatorState): LocalDefId;
    local_def_path_hash_to_def_id(hash: DefPathHash): LocalDefId | undefined;
    def_path_hash_to_def_index_map(): DefPathToIndexMap;
    num_definitions(): number;
  }
}

/** `#[derive(Default)]` */
export function default_DefPathToIndexMap(): DefPathToIndexMap {
  return new DefPathToIndexMap(HashTableOwned.default(Config), undefined);
}

// rustc: compiler/rustc_hir_id/src/definitions.rs:68 get
DefPathToIndexMap.prototype.get = function (this: DefPathToIndexMap, hash: Hash64): DefIndex | undefined {
  const v = this.before_parallel_alloc.get(hash);
  if (v !== undefined) return v;
  const map = this.after_parallel_alloc;
  if (map === undefined) return undefined;
  const id = map.get(hash);
  return id === undefined ? undefined : LocalDefId.local_def_index(id);
};

/// This insert function does not behave like regular `insert` of a `HashMap`,
/// as the return value is used only for printing information about existing
/// def index for local hash before panicking. So we can do not actually insert
/// def index into `det_part` when we are in non-deterministic mode.
// rustc: compiler/rustc_hir_id/src/definitions.rs:81 insert
DefPathToIndexMap.prototype.insert = function (this: DefPathToIndexMap, hash: Hash64, index: DefIndex): DefIndex | undefined {
  const map = this.after_parallel_alloc;
  if (map === undefined) {
    return this.before_parallel_alloc.insert(hash, index);
  } else {
    const existing = this.before_parallel_alloc.get(hash);
    if (existing !== undefined) {
      return existing;
    }

    const id = map.insert(hash, LocalDefId.of(index));
    return id === undefined ? undefined : LocalDefId.local_def_index(id);
  }
};

// impl<E: SpanEncoder> Encodable<E> for DefKey
// #[inline]
// PORT: `impl Encodable<Self>` of `encode_def_key` is the generated `encode_DisambiguatedDefPathData` (PORTING §5).
// rustc_span's `SpanEncoder.encode_def_key` types it as `Encodable<T>` (over `Encoder`), but every implementation
// calls it with `self`, a `SpanEncoder`, so the cast is sound.
// rustc: compiler/rustc_hir_id/src/definitions.rs:118 encode
export function encode_DefKey(self: DefKey, e: SpanEncoder): void {
  e.encode_def_key(self.parent, self.disambiguated_data, gen.encode_DisambiguatedDefPathData as Encodable<DisambiguatedDefPathData>);
}

// rustc: compiler/rustc_hir_id/src/definitions.rs:124 compute_stable_hash
gen.DefKey.prototype.compute_stable_hash = function (this: DefKey, parent: DefPathHash): DefPathHash {
  const hasher = StableHasher.new();

  // The new path is in the same crate as `parent`, and will contain the stable_crate_id.
  // Therefore, we only need to include information of the parent's local hash.
  // `Hash64::hash` (derived: `inner: u64`) -> `write_u64`
  hasher.write_u64(Hash64.as_u64(DefPathHash.local_hash(parent)));

  const { data, disambiguator } = this.disambiguated_data;

  // `Discriminant::hash` -> `isize::hash` -> `write_isize` (implicit discriminants: declaration order)
  hasher.write_isize(DefPathData_discriminant[data.$]);
  const name = DefPathData.hashed_symbol(data);
  if (name !== undefined) {
    // Get a stable hash by considering the symbol chars rather than
    // the symbol index.
    // `str::hash` -> `write_str`
    hasher.write_str(utf8(Symbol.as_str(name)));
  }

  // `u32::hash` -> `write_u32`
  hasher.write_u32(disambiguator);

  const local_hash = hasher.finish(Hash64);

  // Construct the new DefPathHash, making sure that the `crate_id`
  // portion of the hash is properly copied from the parent. This way the
  // `crate_id` part will be recursively propagated from the root to all
  // DefPathHashes in this Definitions.
  return DefPathHash.new(DefPathHash.stable_crate_id(parent), local_hash);
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:152 get_opt_name
gen.DefKey.prototype.get_opt_name = function (this: DefKey): Symbol | undefined {
  return DefPathData.get_opt_name(this.disambiguated_data.data);
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:170 as_sym
DisambiguatedDefPathData.prototype.as_sym = function (this: DisambiguatedDefPathData, verbose: boolean): Symbol {
  const n = DefPathData.name(this.data);
  switch (n.$) {
    case "Named": {
      const name = n._0;
      if (verbose && this.disambiguator !== 0) {
        return Symbol.intern(`${display_Symbol(name)}#${this.disambiguator}`);
      } else {
        return name;
      }
    }
    case "Anon": {
      const namespace = n.namespace;
      if (this.data.$ === "AnonAssocTy") {
        const method = this.data._0;
        return Symbol.intern(`${display_Symbol(method)}::{${display_Symbol(namespace)}#${this.disambiguator}}`);
      } else {
        return Symbol.intern(`{${display_Symbol(namespace)}#${this.disambiguator}}`);
      }
    }
  }
};

export type DefPath = gen.DefPath;
export const DefPath = gen.DefPath as typeof gen.DefPath & {
  make: (krate: CrateNum, start_index: DefIndex, get_key: (index: DefIndex) => DefKey) => DefPath;
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:200 make
DefPath.make = function (krate: CrateNum, start_index: DefIndex, get_key: (index: DefIndex) => DefKey): DefPath {
  const data: DisambiguatedDefPathData[] = [];
  let index: DefIndex | undefined = start_index;
  for (;;) {
    // debug!("DefPath::make: krate={:?} index={:?}", krate, index);
    const p = unwrap(index);
    const key = get_key(p);
    // debug!("DefPath::make: key={:?}", key);
    if (key.disambiguated_data.data.$ === "CrateRoot") {
      assert(key.parent === undefined, "assertion failed: key.parent.is_none()");
      break;
    } else {
      data.push(key.disambiguated_data);
      index = key.parent;
    }
  }
  data.reverse();
  return new gen.DefPath(data, krate);
};

/// Returns a string representation of the `DefPath` without
/// the crate-prefix. This method is useful if you don't have
/// a `TyCtxt` available.
// rustc: compiler/rustc_hir_id/src/definitions.rs:229 to_string_no_crate_verbose
gen.DefPath.prototype.to_string_no_crate_verbose = function (this: DefPath): string {
  let s = "";

  for (const component of this.data) {
    s += `::${display_Symbol(component.as_sym(true))}`;
  }

  return s;
};

/// Returns a filename-friendly string of the `DefPath`, without
/// the crate-prefix. This method is useful if you don't have
/// a `TyCtxt` available.
// rustc: compiler/rustc_hir_id/src/definitions.rs:242 to_filename_friendly_no_crate
gen.DefPath.prototype.to_filename_friendly_no_crate = function (this: DefPath): string {
  let s = "";

  let opt_delimiter: string | undefined = undefined;
  for (const component of this.data) {
    if (opt_delimiter !== undefined) s += opt_delimiter;
    opt_delimiter = "-";
    s += display_Symbol(component.as_sym(true));
  }

  return s;
};

/// New variants should only be added in synchronization with `enum DefKind`.
export type DefPathData = gen.DefPathData;

/** `#[derive(PartialEq)]` */
export function DefPathData_eq(a: DefPathData, b: DefPathData): boolean {
  return a.$ === b.$ && ("_0" in a ? a._0 === (b as typeof a)._0 : true);
}

/** `std::mem::discriminant(&DefPathData)`: no `#[repr]` and no explicit discriminants, so the
 * variants are numbered in declaration order (definitions.rs:258). */
const DefPathData_discriminant: Record<DefPathData["$"], number> = {
  CrateRoot: 0,
  Impl: 1,
  ForeignMod: 2,
  Use: 3,
  GlobalAsm: 4,
  TypeNs: 5,
  ValueNs: 6,
  MacroNs: 7,
  LifetimeNs: 8,
  Closure: 9,
  TestBinderConstraints: 10,
  Ctor: 11,
  AnonConst: 12,
  OpaqueTy: 13,
  OpaqueLifetime: 14,
  AnonAssocTy: 15,
  SyntheticCoroutineBody: 16,
  NestedStatic: 17,
};

export type Definitions = gen.Definitions;
export const Definitions = gen.Definitions as typeof gen.Definitions & {
  "new": (stable_crate_id: StableCrateId) => Definitions;
};

/// This function indicates that the order of def id allocations
/// may be non-deterministic after it was called.
// rustc: compiler/rustc_hir_id/src/definitions.rs:307 commit_end_of_determinism
gen.Definitions.prototype.commit_end_of_determinism = function (this: Definitions): void {
  const old = this.def_path_hash_to_index.after_parallel_alloc;
  this.def_path_hash_to_index.after_parallel_alloc = SortedMap.default(Hash64_cmp);
  assert(old === undefined, "this function should be called only once");
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:315 def_key
gen.Definitions.prototype.def_key = function (this: Definitions, id: LocalDefId): DefKey {
  // PORT: `DefKey` is `Copy`; the stored key is returned (keys are never mutated in place).
  return index_vec_get(this.def_id_to_key, id);
};

// Log debug version of `local_def_index` (just a number), as tracing of this function
// is called too early and cause errors if `LocalDefId` is logged (#157238).
// rustc: compiler/rustc_hir_id/src/definitions.rs:323 def_path_hash
gen.Definitions.prototype.def_path_hash = function (this: Definitions, id: LocalDefId): DefPathHash {
  return DefPathHash.new(this.stable_crate_id, index_vec_get(this.def_path_hashes, id));
};

/// Returns the path from the crate root to `index`. The root
/// nodes are not included in the path (i.e., this will be an
/// empty vector for the crate root). For an inlined item, this
/// will be the path of the item in the external crate (but the
/// path will begin with the path to the external crate).
// rustc: compiler/rustc_hir_id/src/definitions.rs:333 def_path
gen.Definitions.prototype.def_path = function (this: Definitions, id: LocalDefId): DefPath {
  return DefPath.make(LOCAL_CRATE, LocalDefId.local_def_index(id), (index) => this.def_key(LocalDefId.of(index)));
};

/// Adds a root definition (no parent) and a few other reserved definitions.
// rustc: compiler/rustc_hir_id/src/definitions.rs:340 new
Definitions.new = function (stable_crate_id: StableCrateId): Definitions {
  const key = new gen.DefKey(undefined, new DisambiguatedDefPathData(DefPathData.CrateRoot, 0));

  // We want *both* halves of a DefPathHash to depend on the crate-id of the defining crate.
  // The crate-id can be more easily changed than the DefPath of an item, so, in the case of
  // a crate-local DefPathHash collision, the user can simply "roll the dice again" for all
  // DefPathHashes in the crate by changing the crate disambiguator (e.g. via bumping the
  // crate's version number).
  //
  // Children paths will only hash the local portion, and still inherit the change to the
  // root hash.
  const def_path_hash = DefPathHash.new(stable_crate_id, Hash64.new(StableCrateId.as_u64(stable_crate_id)));

  const defs = new gen.Definitions(stable_crate_id, [], [], default_DefPathToIndexMap());

  // Create the root definition.
  const root = defs.allocate(key, def_path_hash);
  assert_eq(LocalDefId.local_def_index(root), CRATE_DEF_INDEX, (v) => debug_DefIndex(v, PLAIN));

  return defs;
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:374 allocate
gen.Definitions.prototype.allocate = function (this: Definitions, key: DefKey, def_path_hash: DefPathHash): LocalDefId {
  // Assert that all DefPathHashes correctly contain the local crate's StableCrateId.
  // debug_assert_eq!(self.stable_crate_id, def_path_hash.stable_crate_id());
  const local_hash = DefPathHash.local_hash(def_path_hash);

  const def_id = index_vec_push(this.def_id_to_key, key);
  // debug!("def_id_to_key.push() - {key:?} <-> {:?}", def_id.local_def_index);

  this.def_path_hashes.push(local_hash);
  // debug_assert!(self.def_path_hashes.len() == self.def_id_to_key.len());

  // Check for hash collisions of DefPathHashes. These should be
  // exceedingly rare.
  const existing = this.def_path_hash_to_index.insert(local_hash, LocalDefId.local_def_index(def_id));
  if (existing !== undefined) {
    const def_path1 = this.def_path(LocalDefId.of(existing));
    const def_path2 = this.def_path(def_id);

    // Continuing with colliding DefPathHashes can lead to correctness
    // issues. We must abort compilation.
    //
    // The likelihood of such a collision is very small, so actually
    // running into one could be indicative of a poor hash function
    // being used.
    //
    // See the documentation for DefPathHash for more information.
    panic(
      `found DefPathHash collision between ${debug_DefPath(def_path1, PRETTY)} and ${debug_DefPath(def_path2, PRETTY)}. \
Compilation cannot continue.`,
    );
  }

  return def_id;
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:410 enumerated_keys_and_path_hashes
gen.Definitions.prototype.enumerated_keys_and_path_hashes = function (this: Definitions): [DefIndex, DefKey, DefPathHash][] {
  return this.def_id_to_key.map((key, i) => {
    const def_id = LocalDefId.new(i);
    return [LocalDefId.local_def_index(def_id), key, this.def_path_hash(def_id)];
  });
};

/// Creates a definition with a parent definition.
/// If there are multiple definitions with the same DefPathData and the same parent, use
/// `disambiguator` to differentiate them. Distinct `DisambiguatorState` instances are not
/// guaranteed to generate unique disambiguators and should instead ensure that the `parent`
/// and `data` pair is distinct from other instances.
// rustc: compiler/rustc_hir_id/src/definitions.rs:423 create_def
gen.Definitions.prototype.create_def = function (
  this: Definitions,
  parent: LocalDefId,
  data: DefPathData,
  disambiguator: PerParentDisambiguatorState,
): LocalDefId {
  // We can't use `Debug` implementation for `LocalDefId` here, since it tries to acquire a
  // reference to `Definitions` and we're already holding a mutable reference.
  // debug!(
  //     "create_def(parent={}, data={data:?})",
  //     self.def_path(parent).to_string_no_crate_verbose(),
  // );

  // The root node must be created in `new()`.
  assert(!DefPathData_eq(data, DefPathData.CrateRoot), "assertion failed: data != DefPathData::CrateRoot");

  // Find the next free disambiguator for this key.
  let disambiguator_: number;
  {
    // #[cfg(debug_assertions)]
    // debug_assert_eq!(
    //     parent,
    //     disambiguator.parent.expect("must be set"),
    //     "provided parent and parent in disambiguator must be the same"
    // );

    let next_disamb = disambiguator.next.get(data);
    if (next_disamb === undefined) {
      next_disamb = 0;
      disambiguator.next.set(data, next_disamb);
    }
    const d = next_disamb;
    // `u32::checked_add(1).expect(..)`
    if (next_disamb + 1 > 0xffff_ffff) panic("disambiguator overflow");
    disambiguator.next.set(data, next_disamb + 1);
    disambiguator_ = d;
  }
  const key = new gen.DefKey(LocalDefId.local_def_index(parent), new DisambiguatedDefPathData(data, disambiguator_));

  const parent_hash = this.def_path_hash(parent);
  const def_path_hash = key.compute_stable_hash(parent_hash);

  // debug!("create_def: after disambiguation, key = {:?}", key);

  // Create the definition.
  return this.allocate(key, def_path_hash);
};

/// Returns `None` if the `DefPathHash` does not correspond to a `LocalDefId`
/// in the current compilation session. This can legitimately happen if the
/// `DefPathHash` is from a `DefId` in an upstream crate or, during incr. comp.,
/// if the `DefPathHash` is from a previous compilation session and
/// the def-path does not exist anymore.
// rustc: compiler/rustc_hir_id/src/definitions.rs:473 local_def_path_hash_to_def_id
gen.Definitions.prototype.local_def_path_hash_to_def_id = function (this: Definitions, hash: DefPathHash): LocalDefId | undefined {
  // debug_assert!(hash.stable_crate_id() == self.stable_crate_id);
  const local_def_index = this.def_path_hash_to_index.get(DefPathHash.local_hash(hash));
  return local_def_index === undefined ? undefined : LocalDefId.of(local_def_index);
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:480 def_path_hash_to_def_index_map
gen.Definitions.prototype.def_path_hash_to_def_index_map = function (this: Definitions): DefPathToIndexMap {
  return this.def_path_hash_to_index;
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:484 num_definitions
gen.Definitions.prototype.num_definitions = function (this: Definitions): number {
  return this.def_path_hashes.length;
};

export const DefPathData = {
  ...gen.DefPathData,

  // rustc: compiler/rustc_hir_id/src/definitions.rs:496 get_opt_name
  get_opt_name(self: DefPathData): Symbol | undefined {
    switch (self.$) {
      case "TypeNs":
      case "ValueNs":
      case "MacroNs":
      case "LifetimeNs":
      case "OpaqueLifetime":
        return self._0;

      case "Impl":
      case "ForeignMod":
      case "CrateRoot":
      case "Use":
      case "GlobalAsm":
      case "Closure":
      case "Ctor":
      case "AnonConst":
      case "OpaqueTy":
      case "AnonAssocTy":
      case "SyntheticCoroutineBody":
      case "NestedStatic":
      case "TestBinderConstraints":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir_id/src/definitions.rs:518 hashed_symbol
  hashed_symbol(self: DefPathData): Symbol | undefined {
    switch (self.$) {
      case "TypeNs":
      case "ValueNs":
      case "MacroNs":
      case "LifetimeNs":
      case "AnonAssocTy":
      case "OpaqueLifetime":
        return self._0;

      case "Impl":
      case "ForeignMod":
      case "CrateRoot":
      case "Use":
      case "GlobalAsm":
      case "Closure":
      case "Ctor":
      case "AnonConst":
      case "OpaqueTy":
      case "SyntheticCoroutineBody":
      case "NestedStatic":
      case "TestBinderConstraints":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir_id/src/definitions.rs:539 name
  name(self: DefPathData): gen.DefPathDataName {
    switch (self.$) {
      case "TypeNs":
      case "ValueNs":
      case "MacroNs":
      case "LifetimeNs":
      case "OpaqueLifetime":
        return { $: "Named", _0: self._0 };
      // Note that this does not show up in user print-outs.
      case "CrateRoot":
        return { $: "Anon", namespace: kw.Crate };
      case "Impl":
        return { $: "Anon", namespace: kw.Impl };
      case "ForeignMod":
        return { $: "Anon", namespace: kw.Extern };
      case "Use":
        return { $: "Anon", namespace: kw.Use };
      case "GlobalAsm":
        return { $: "Anon", namespace: sym.global_asm };
      case "Closure":
        return { $: "Anon", namespace: sym.closure };
      case "Ctor":
        return { $: "Anon", namespace: sym.constructor };
      case "AnonConst":
        return { $: "Anon", namespace: sym.constant };
      case "OpaqueTy":
        return { $: "Anon", namespace: sym.opaque };
      case "AnonAssocTy":
        return { $: "Anon", namespace: sym.anon_assoc };
      case "SyntheticCoroutineBody":
        return { $: "Anon", namespace: sym.synthetic };
      case "NestedStatic":
        return { $: "Anon", namespace: sym.nested };
      case "TestBinderConstraints":
        return { $: "Anon", namespace: sym.test_binder_constraints };
    }
  },
};

// rustc: compiler/rustc_hir_id/src/definitions.rs:565 fmt
export function display_DefPathData(v: DefPathData): string {
  const n = DefPathData.name(v);
  switch (n.$) {
    case "Named":
      return Symbol.as_str(n._0);
    // FIXME(#70334): this will generate legacy {{closure}}, {{impl}}, etc
    case "Anon":
      return `{{${display_Symbol(n.namespace)}}}`;
  }
}

// ---- IndexVec helpers (PORTING §5: `IndexVec<I, T>` = `T[]` indexed by the handle number) ----

function index_vec_get<T>(v: T[], i: LocalDefId): T {
  const x = v[i];
  if (x === undefined) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return x;
}

/** `IndexVec::push`: returns the index of the pushed element. */
function index_vec_push(v: DefKey[], x: DefKey): LocalDefId {
  const idx = LocalDefId.new(v.length);
  v.push(x);
  return idx;
}
