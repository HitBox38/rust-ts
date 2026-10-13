//! Machinery for hygienic macros.
//!
//! Inspired by Matthew Flatt et al., “Macros That Work Together: Compile-Time Bindings, Partial
//! Expansion, and Definition Contexts,” *Journal of Functional Programming* 22, no. 2
//! (March 1, 2012): 181–216, <https://doi.org/10.1017/S0956796812000093>.

// Hygiene data is stored in a global variable and accessed via TLS, which
// means that accesses are somewhat expensive. (`HygieneData::with`
// encapsulates a single access.) Therefore, on hot code paths it is worth
// ensuring that multiple HygieneData accesses are combined into a single
// `HygieneData::with`.
//
// This explains why `HygieneData`, `SyntaxContext` and `ExpnId` have interfaces
// with a certain amount of redundancy in them. For example,
// `SyntaxContext::outer_expn_data` combines `SyntaxContext::outer` and
// `ExpnId::expn_data` so that two `HygieneData` accesses can be performed within
// a single `HygieneData::with` call.
//
// It also explains why many functions appear in `HygieneData` and again in
// `SyntaxContext` or `ExpnId`. For example, `HygieneData::outer` and
// `SyntaxContext::outer` do the same thing, but the former is for use within a
// `HygieneData::with` call while the latter is for use outside such a call.
// When modifying this file it is important to understand this distinction,
// because getting it wrong can lead to nested `HygieneData::with` calls that
// trigger runtime aborts. (Fortunately these are obvious and easy to fix.)

import { debug_bool, debug_int, debug_option, debug_struct, debug_tuple, debug_vec, type Debug, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert, panic, unported, unwrap } from "../std/panic.ts";
import { debug_Fingerprint, Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import {
  CRATE_DEF_ID,
  CrateNum,
  DefId_to_stable_hash_key,
  DefPathHash,
  type DefId,
  debug_CrateNum,
  debug_DefId,
  debug_ModId,
  LOCAL_CRATE,
  LocalDefId,
  type ModId,
  StableCrateId,
} from "./def_id.ts";
import { debug_Edition, type Edition } from "./edition.ts";
import { debug_Span, with_session_globals } from "./lib.ts";
import type { SourceMap } from "./source_map.ts";
import { DUMMY_SP, Span } from "./span_encoding.ts";
import { debug_Symbol, display_Symbol, kw, sym, type Symbol } from "./symbol.ts";

import {
  type StableHashCtxt,
  StableHasher,
  stable_hash_Fingerprint,
  stable_hash_u8,
} from "../rustc_data_structures/stable_hash.ts";
import { stable_hash_ExpnData, stable_hash_Transparency } from "./stable_hash.gen.ts";
export type { StableHashCtxt };

// PORT: `MutRef` (`&mut T` of a primitive/handle) lives in src/std/mut_ref.ts; re-exported here.
import type { MutRef } from "../std/mut_ref.ts";
export type { MutRef };

/// PORT: an `FxHashMap` whose key is not a primitive. JS `Map` compares object keys by identity,
/// so entries are stored under a canonical string key; the original key is kept for iteration.
class KeyedMap<K, V> {
  private readonly map = new Map<string, [K, V]>();
  constructor(private readonly key_of: (k: K) => string) {}
  get(k: K): V | undefined {
    return this.map.get(this.key_of(k))?.[1];
  }
  contains_key(k: K): boolean {
    return this.map.has(this.key_of(k));
  }
  /// `HashMap::insert`: returns the old value.
  insert(k: K, v: V): V | undefined {
    const key = this.key_of(k);
    const old = this.map.get(key)?.[1];
    this.map.set(key, [k, v]);
    return old;
  }
  /// `map[&k]`
  index(k: K): V {
    const e = this.map.get(this.key_of(k));
    if (e === undefined) panic("key not found in map");
    return e[1];
  }
  iter(): IterableIterator<[K, V]> {
    return this.map.values();
  }
}

function expn_id_key(e: ExpnId): string {
  return `${e.krate}:${e.local_id}`;
}

function syntax_context_key_key([parent, expn_id, transparency]: SyntaxContextKey): string {
  return `${parent}:${expn_id.krate}:${expn_id.local_id}:${transparency}`;
}

// ---------------------------------------------------------------------------------------------

/// A `SyntaxContext` represents a chain of pairs `(ExpnId, Transparency)` named "marks".
///
/// See <https://rustc-dev-guide.rust-lang.org/macro-expansion.html> for more explanation.
// PORT: interned handle (PORTING §5): branded number; `self.0` is the number itself. Methods
// (`impl SyntaxContext` below) live on the companion const and take `self` first.
export type SyntaxContext = number & { readonly __brand: "SyntaxContext" };

// To ensure correctness of incremental compilation,
// `SyntaxContext` must not implement `Ord` or `PartialOrd`.
// See https://github.com/rust-lang/rust/issues/90317.

/// If this part of two syntax contexts is equal, then the whole syntax contexts should be equal.
/// The other fields are only for caching.
export type SyntaxContextKey = readonly [SyntaxContext, ExpnId, Transparency];

class SyntaxContextData {
  constructor(
    /// The last macro expansion in the chain.
    /// (Here we say the most deeply nested macro expansion is the "outermost" expansion.)
    readonly outer_expn: ExpnId,
    /// Transparency of the last macro expansion
    readonly outer_transparency: Transparency,
    readonly parent: SyntaxContext,
    /// This context, but with all transparent and semi-opaque expansions filtered away.
    readonly opaque: SyntaxContext,
    /// This context, but with all transparent expansions filtered away.
    readonly opaque_and_semiopaque: SyntaxContext,
    /// Name of the crate to which `$crate` with this context would resolve.
    public dollar_crate_name: Symbol,
  ) {}

  // rustc: compiler/rustc_span/src/hygiene.rs:84 root
  static root(): SyntaxContextData {
    return new SyntaxContextData(
      ExpnId.root(),
      Transparency.Opaque,
      SyntaxContext.root(),
      SyntaxContext.root(),
      SyntaxContext.root(),
      kw.DollarCrate,
    );
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:95 key
  key(): SyntaxContextKey {
    return [this.parent, this.outer_expn, this.outer_transparency];
  }
}

/// `#[derive(Debug)]`
const debug_SyntaxContextData: Debug<SyntaxContextData> = (v, f) =>
  debug_struct(f, "SyntaxContextData", [
    ["outer_expn", debug_ExpnId(v.outer_expn, f)],
    ["outer_transparency", debug_Transparency(v.outer_transparency, f)],
    ["parent", debug_SyntaxContext(v.parent, f)],
    ["opaque", debug_SyntaxContext(v.opaque, f)],
    ["opaque_and_semiopaque", debug_SyntaxContext(v.opaque_and_semiopaque, f)],
    ["dollar_crate_name", debug_Symbol(v.dollar_crate_name, f)],
  ]);
void debug_SyntaxContextData; // PORT: used by the derived `HygieneData` Debug (verbose dump, unported).

/// A unique ID associated with a macro invocation and expansion.
export type ExpnIndex = number & { readonly __brand: "ExpnIndex" };
export const ExpnIndex = newtype_index<ExpnIndex>((n) => `${n}`);
export const debug_ExpnIndex: Debug<ExpnIndex> = ExpnIndex.debug;

/// A unique ID associated with a macro invocation and expansion.
// PORT: `struct ExpnId { krate, local_id }`: the class (fields + `impl ExpnId`) is defined below,
// at the position of `impl ExpnId`, to keep upstream function order. Equality: `ExpnId_eq`.

// rustc: compiler/rustc_span/src/hygiene.rs:114 fmt
export const debug_ExpnId: Debug<ExpnId> = (v) =>
  // Generate crate_::{{expn_}}.
  `${debug_CrateNum(v.krate, PLAIN)}::{{expn${ExpnIndex.as_u32(v.local_id)}}}`;

/// A unique ID associated with a macro invocation and expansion.
export type LocalExpnId = number & { readonly __brand: "LocalExpnId" };
/// `#[debug_format = "expn{}"]`
export const debug_LocalExpnId: Debug<LocalExpnId> = (v) => `expn${v}`;

// To ensure correctness of incremental compilation,
// `LocalExpnId` must not implement `Ord` or `PartialOrd`.
// See https://github.com/rust-lang/rust/issues/90317.

/// A unique hash value associated to an expansion.
// PORT: tuple newtype over a primitive → branded bigint; `ExpnHash(x)` → `ExpnHash.of(x)`,
// `self.0` → `ExpnHash._0(self)`.
export type ExpnHash = bigint & { readonly __brand: "ExpnHash" };
export const ExpnHash = {
  of(_0: Fingerprint): ExpnHash {
    return _0 as bigint as ExpnHash;
  },
  _0(self: ExpnHash): Fingerprint {
    return self as bigint as Fingerprint;
  },

  /// Returns the [StableCrateId] identifying the crate this [ExpnHash]
  /// originates from.
  // rustc: compiler/rustc_span/src/hygiene.rs:140 stable_crate_id
  stable_crate_id(self: ExpnHash): StableCrateId {
    return StableCrateId.of(Fingerprint.split(ExpnHash._0(self))[0]);
  },

  /// Returns the crate-local part of the [ExpnHash].
  ///
  /// Used for assertions.
  // rustc: compiler/rustc_span/src/hygiene.rs:148 local_hash
  local_hash(self: ExpnHash): Hash64 {
    return Fingerprint.split(ExpnHash._0(self))[1];
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:153 is_root
  is_root(self: ExpnHash): boolean {
    return ExpnHash._0(self) === Fingerprint.ZERO;
  },

  /// Builds a new [ExpnHash] with the given [StableCrateId] and
  /// `local_hash`, where `local_hash` must be unique within its crate.
  // rustc: compiler/rustc_span/src/hygiene.rs:159 new
  new(stable_crate_id: StableCrateId, local_hash: Hash64): ExpnHash {
    return ExpnHash.of(Fingerprint.new(StableCrateId._0(stable_crate_id), local_hash));
  },
};
/// `#[derive(Debug)]`
export const debug_ExpnHash: Debug<ExpnHash> = (v, f) => debug_tuple(f, "ExpnHash", [debug_Fingerprint(ExpnHash._0(v), f)]);

/// A property of a macro expansion that determines how identifiers
/// produced by that expansion are resolved.
export type Transparency =
  /// Identifier produced by a transparent expansion is always resolved at call-site.
  /// Call-site spans in procedural macros, hygiene opt-out in `macro` should use this.
  | "Transparent"
  /// Identifier produced by a semi-opaque expansion may be resolved
  /// either at call-site or at definition-site.
  /// If it's a local variable, label or `$crate` then it's resolved at def-site.
  /// Otherwise it's resolved at call-site.
  /// `macro_rules` macros behave like this, built-in macros currently behave like this too,
  /// but that's an implementation detail.
  | "SemiOpaque"
  /// Identifier produced by an opaque expansion is always resolved at definition-site.
  /// Def-site spans in procedural macros, identifiers from `macro` by default use this.
  | "Opaque";
export const Transparency = {
  Transparent: "Transparent",
  SemiOpaque: "SemiOpaque",
  Opaque: "Opaque",

  // rustc: compiler/rustc_span/src/hygiene.rs:185 fallback
  fallback(macro_rules: boolean): Transparency {
    return macro_rules ? Transparency.SemiOpaque : Transparency.Opaque;
  },
} as const;
/// `#[derive(PartialOrd)]` discriminants.
export const Transparency_discriminant: Record<Transparency, number> = { Transparent: 0, SemiOpaque: 1, Opaque: 2 };
/// `#[derive(Debug)]`
export const debug_Transparency: Debug<Transparency> = (v) => v;

export const LocalExpnId = {
  ...newtype_index<LocalExpnId>((n) => `expn${n}`),

  /// The ID of the theoretical expansion that generates freshly parsed, unexpanded AST.
  ROOT: 0 as LocalExpnId,

  // rustc: compiler/rustc_span/src/hygiene.rs:195 from_raw
  from_raw(idx: ExpnIndex): LocalExpnId {
    return LocalExpnId.from_u32(ExpnIndex.as_u32(idx));
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:200 as_raw
  as_raw(self: LocalExpnId): ExpnIndex {
    return ExpnIndex.from_u32(LocalExpnId.as_u32(self));
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:204 fresh_empty
  fresh_empty(): LocalExpnId {
    return HygieneData.with((data) => {
      const expn_id = LocalExpnId.from_usize(data.local_expn_data.length);
      data.local_expn_data.push(undefined);
      const _eid = LocalExpnId.from_usize(data.local_expn_hashes.length);
      data.local_expn_hashes.push(ExpnHash.of(Fingerprint.ZERO));
      // debug_assert_eq!(expn_id, _eid);
      void _eid;
      return expn_id;
    });
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:213 fresh
  fresh(expn_data: ExpnData, hcx: StableHashCtxt): LocalExpnId {
    // PORT: `mut expn_data: ExpnData` is by value; copy so the caller's (possibly shared) instance
    // is not mutated by `update_disambiguator`.
    expn_data = expn_data.clone();
    // debug_assert_eq!(expn_data.parent.krate, LOCAL_CRATE);
    const expn_hash = update_disambiguator(expn_data, hcx);
    return HygieneData.with((data) => {
      const expn_id = LocalExpnId.from_usize(data.local_expn_data.length);
      data.local_expn_data.push(expn_data);
      const _eid = LocalExpnId.from_usize(data.local_expn_hashes.length);
      data.local_expn_hashes.push(expn_hash);
      // debug_assert_eq!(expn_id, _eid);
      void _eid;
      const _old_id = data.expn_hash_to_expn_id.get(expn_hash);
      data.expn_hash_to_expn_id.set(expn_hash, LocalExpnId.to_expn_id(expn_id));
      // debug_assert!(_old_id.is_none());
      void _old_id;
      return expn_id;
    });
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:227 expn_data
  expn_data(self: LocalExpnId): ExpnData {
    // PORT: `.clone()`: ExpnData's public fields are readonly, so the shared instance is returned.
    return HygieneData.with((data) => data.local_expn_data_(self));
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:232 to_expn_id
  to_expn_id(self: LocalExpnId): ExpnId {
    return new ExpnId(LOCAL_CRATE, LocalExpnId.as_raw(self));
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:237 set_expn_data
  set_expn_data(self: LocalExpnId, expn_data: ExpnData, hcx: StableHashCtxt): void {
    // PORT: by-value `mut expn_data`; copy before `update_disambiguator` mutates it (see `fresh`).
    expn_data = expn_data.clone();
    // debug_assert_eq!(expn_data.parent.krate, LOCAL_CRATE);
    const expn_hash = update_disambiguator(expn_data, hcx);
    HygieneData.with((data) => {
      const old_expn_data = data.local_expn_data[self];
      assert(old_expn_data === undefined, "expansion data is reset for an expansion ID");
      data.local_expn_data[self] = expn_data;
      // debug_assert_eq!(data.local_expn_hashes[self].0, Fingerprint::ZERO);
      data.local_expn_hashes[self] = expn_hash;
      const _old_id = data.expn_hash_to_expn_id.get(expn_hash);
      data.expn_hash_to_expn_id.set(expn_hash, LocalExpnId.to_expn_id(self));
      // debug_assert!(_old_id.is_none());
      void _old_id;
    });
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:252 is_descendant_of
  is_descendant_of(self: LocalExpnId, ancestor: LocalExpnId): boolean {
    return LocalExpnId.to_expn_id(self).is_descendant_of(LocalExpnId.to_expn_id(ancestor));
  },

  /// Returns span for the macro which originally caused this expansion to happen.
  ///
  /// Stops backtracing at include! boundary.
  // rustc: compiler/rustc_span/src/hygiene.rs:260 expansion_cause
  expansion_cause(self: LocalExpnId): Span | undefined {
    return LocalExpnId.to_expn_id(self).expansion_cause();
  },
};

/// A unique ID associated with a macro invocation and expansion.
export class ExpnId {
  constructor(
    readonly krate: CrateNum,
    readonly local_id: ExpnIndex,
  ) {}

  /// The ID of the theoretical expansion that generates freshly parsed, unexpanded AST.
  /// Invariant: we do not create any ExpnId with local_id == 0 and krate != 0.
  // rustc: compiler/rustc_span/src/hygiene.rs:268 root
  static root(): ExpnId {
    return new ExpnId(LOCAL_CRATE, ExpnIndex.ZERO);
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:273 expn_hash
  expn_hash(): ExpnHash {
    return HygieneData.with((data) => data.expn_hash(this));
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:278 from_hash
  static from_hash(hash: ExpnHash): ExpnId | undefined {
    return HygieneData.with((data) => data.expn_hash_to_expn_id.get(hash));
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:283 as_local
  as_local(): LocalExpnId | undefined {
    return this.krate === LOCAL_CRATE ? LocalExpnId.from_raw(this.local_id) : undefined;
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:289 expect_local
  expect_local(): LocalExpnId {
    return unwrap(this.as_local());
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:294 expn_data
  expn_data(): ExpnData {
    // PORT: `.clone()`: see LocalExpnId.expn_data.
    return HygieneData.with((data) => data.expn_data(this));
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:299 is_descendant_of
  is_descendant_of(ancestor: ExpnId): boolean {
    // a few "fast path" cases to avoid locking HygieneData
    if (ExpnId_eq(ancestor, ExpnId.root()) || ExpnId_eq(ancestor, this)) {
      return true;
    }
    if (ancestor.krate !== this.krate) {
      return false;
    }
    return HygieneData.with((data) => data.is_descendant_of(this, ancestor));
  }

  /// `expn_id.outer_expn_is_descendant_of(ctxt)` is equivalent to but faster than
  /// `expn_id.is_descendant_of(ctxt.outer_expn())`.
  // rustc: compiler/rustc_span/src/hygiene.rs:313 outer_expn_is_descendant_of
  outer_expn_is_descendant_of(ctxt: SyntaxContext): boolean {
    // fast path to avoid locking: everything is a descendant of the root context's
    // outer expansion
    if (SyntaxContext.is_root(ctxt)) {
      return true;
    }
    return HygieneData.with((data) => data.is_descendant_of(this, data.outer_expn(ctxt)));
  }

  /// Returns span for the macro which originally caused this expansion to happen.
  ///
  /// Stops backtracing at include! boundary.
  // rustc: compiler/rustc_span/src/hygiene.rs:325 expansion_cause
  expansion_cause(): Span | undefined {
    let self_: ExpnId = this;
    let last_macro: Span | undefined = undefined;
    for (;;) {
      // Fast path to avoid locking.
      if (ExpnId_eq(self_, ExpnId.root())) {
        break;
      }
      const expn_data = self_.expn_data();
      // Stop going up the backtrace once include! is encountered
      if (ExpnKind_eq(expn_data.kind, { $: "Macro", _0: MacroKind.Bang, _1: sym.include })) {
        break;
      }
      self_ = SyntaxContext.outer_expn(Span.ctxt(expn_data.call_site));
      last_macro = expn_data.call_site;
    }
    return last_macro;
  }
}

/// `#[derive(PartialEq)]`
export function ExpnId_eq(a: ExpnId, b: ExpnId): boolean {
  return a.krate === b.krate && a.local_id === b.local_id;
}

export class HygieneData {
  constructor(
    /// Each expansion should have an associated expansion data, but sometimes there's a delay
    /// between creation of an expansion ID and obtaining its data (e.g. macros are collected
    /// first and then resolved later), so we use an `Option` here.
    public local_expn_data: (ExpnData | undefined)[],
    public local_expn_hashes: ExpnHash[],
    /// Data and hash information from external crates. We may eventually want to remove these
    /// maps, and fetch the information directly from the other crate's metadata like DefIds do.
    public foreign_expn_data: KeyedMap<ExpnId, ExpnData>,
    public foreign_expn_hashes: KeyedMap<ExpnId, ExpnHash>,
    public expn_hash_to_expn_id: Map<ExpnHash, ExpnId>,
    public syntax_context_data: SyntaxContextData[],
    public syntax_context_map: KeyedMap<SyntaxContextKey, SyntaxContext>,
    /// Maps the `local_hash` of an `ExpnData` to the next disambiguator value.
    /// This is used by `update_disambiguator` to keep track of which `ExpnData`s
    /// would have collisions without a disambiguator.
    /// The keys of this map are always computed with `ExpnData.disambiguator`
    /// set to 0.
    public expn_data_disambiguators: Map<Hash64, number>,
  ) {}

  // rustc: compiler/rustc_span/src/hygiene.rs:367 new
  static new(edition: Edition): HygieneData {
    const root_data = ExpnData.default(ExpnKind.Root, DUMMY_SP, edition, LocalDefId.to_def_id(CRATE_DEF_ID), undefined);

    // Index 0 is the root context, and nothing but its `dollar_crate_name` is ever
    // mutated afterwards. The lock-free root paths on `SyntaxContext` rely on that.
    const root_ctxt_data = SyntaxContextData.root();
    const syntax_context_map = new KeyedMap<SyntaxContextKey, SyntaxContext>(syntax_context_key_key);
    syntax_context_map.insert(root_ctxt_data.key(), 0 as SyntaxContext);
    return new HygieneData(
      [root_data],
      [ExpnHash.of(Fingerprint.ZERO)],
      new KeyedMap(expn_id_key),
      new KeyedMap(expn_id_key),
      new Map([[ExpnHash.of(Fingerprint.ZERO), ExpnId.root()]]),
      [root_ctxt_data],
      syntax_context_map,
      new Map(),
    );
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:393 with
  static with<R>(f: (data: HygieneData) => R): R {
    return with_session_globals((session_globals) => f(session_globals.hygiene_data));
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:398 expn_hash
  expn_hash(expn_id: ExpnId): ExpnHash {
    const local = expn_id.as_local();
    if (local !== undefined) return this.local_expn_hashes[local]!;
    return this.foreign_expn_hashes.index(expn_id);
  }

  // PORT: renamed from `local_expn_data`: the field of the same name occupies that property.
  // rustc: compiler/rustc_span/src/hygiene.rs:406 local_expn_data
  local_expn_data_(expn_id: LocalExpnId): ExpnData {
    return unwrap(this.local_expn_data[expn_id], "no expansion data for an expansion ID");
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:410 expn_data
  expn_data(expn_id: ExpnId): ExpnData {
    const local = expn_id.as_local();
    if (local !== undefined) {
      return unwrap(this.local_expn_data[local], "no expansion data for an expansion ID");
    } else {
      return this.foreign_expn_data.index(expn_id);
    }
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:418 is_descendant_of
  is_descendant_of(expn_id: ExpnId, ancestor: ExpnId): boolean {
    // a couple "fast path" cases to avoid traversing parents in the loop below
    if (ExpnId_eq(ancestor, ExpnId.root())) {
      return true;
    }
    if (expn_id.krate !== ancestor.krate) {
      return false;
    }
    for (;;) {
      if (ExpnId_eq(expn_id, ancestor)) {
        return true;
      }
      if (ExpnId_eq(expn_id, ExpnId.root())) {
        return false;
      }
      expn_id = this.expn_data(expn_id).parent;
    }
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:438 normalize_to_macros_2_0
  normalize_to_macros_2_0(ctxt: SyntaxContext): SyntaxContext {
    return this.syntax_context_data[ctxt]!.opaque;
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:443 normalize_to_macro_rules
  normalize_to_macro_rules(ctxt: SyntaxContext): SyntaxContext {
    return this.syntax_context_data[ctxt]!.opaque_and_semiopaque;
  }

  /// See [`SyntaxContextData::outer_expn`]
  // rustc: compiler/rustc_span/src/hygiene.rs:449 outer_expn
  outer_expn(ctxt: SyntaxContext): ExpnId {
    return this.syntax_context_data[ctxt]!.outer_expn;
  }

  /// The last macro expansion and its Transparency
  // rustc: compiler/rustc_span/src/hygiene.rs:455 outer_mark
  outer_mark(ctxt: SyntaxContext): [ExpnId, Transparency] {
    const data = this.syntax_context_data[ctxt]!;
    return [data.outer_expn, data.outer_transparency];
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:461 parent_ctxt
  parent_ctxt(ctxt: SyntaxContext): SyntaxContext {
    return this.syntax_context_data[ctxt]!.parent;
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:465 remove_mark
  remove_mark(ctxt: MutRef<SyntaxContext>): [ExpnId, Transparency] {
    const outer_mark = this.outer_mark(ctxt.value);
    ctxt.value = this.parent_ctxt(ctxt.value);
    return outer_mark;
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:471 marks
  marks(ctxt: SyntaxContext): [ExpnId, Transparency][] {
    const marks: [ExpnId, Transparency][] = [];
    while (!SyntaxContext.is_root(ctxt)) {
      // debug!("marks: getting parent of {:?}", ctxt);
      marks.push(this.outer_mark(ctxt));
      ctxt = this.parent_ctxt(ctxt);
    }
    marks.reverse();
    return marks;
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:482 walk_chain
  walk_chain(span: Span, to: SyntaxContext): Span {
    // debug!("walk_chain({:?}, {:?})", span, to);
    // debug!("walk_chain: span ctxt = {:?}", span.ctxt());
    while (Span.ctxt(span) !== to && Span.from_expansion(span)) {
      const outer_expn = this.outer_expn(Span.ctxt(span));
      // debug!("walk_chain({:?}): outer_expn={:?}", span, outer_expn);
      const expn_data = this.expn_data(outer_expn);
      // debug!("walk_chain({:?}): expn_data={:?}", span, expn_data);
      span = expn_data.call_site;
    }
    // debug!("walk_chain: for span {:?} >>> return span = {:?}", orig_span, span);
    return span;
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:497 walk_chain_collapsed
  walk_chain_collapsed(span: Span, to: Span): Span {
    let ret_span = span;
    // debug!("walk_chain_collapsed({:?}, {:?})", span, to);
    // debug!("walk_chain_collapsed: span ctxt = {:?}", span.ctxt());
    for (;;) {
      const ctxt = Span.ctxt(span);
      if (!(!SyntaxContext.is_root(ctxt) && ctxt !== Span.ctxt(to))) break;
      const outer_expn = this.outer_expn(ctxt);
      // debug!("walk_chain_collapsed({:?}): outer_expn={:?}", span, outer_expn);
      const expn_data = this.expn_data(outer_expn);
      // debug!("walk_chain_collapsed({:?}): expn_data={:?}", span, expn_data);
      span = expn_data.call_site;
      if (expn_data.collapse_debuginfo) {
        ret_span = span;
      }
    }
    // debug!("walk_chain_collapsed: for span {:?} >>> return span = {:?}", orig_span, ret_span);
    return ret_span;
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:519 adjust
  adjust(ctxt: MutRef<SyntaxContext>, expn_id: ExpnId): ExpnId | undefined {
    let scope: ExpnId | undefined = undefined;
    while (!this.is_descendant_of(expn_id, this.outer_expn(ctxt.value))) {
      scope = this.remove_mark(ctxt)[0];
    }
    return scope;
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:527 apply_mark
  apply_mark(ctxt: SyntaxContext, expn_id: ExpnId, transparency: Transparency): SyntaxContext {
    assert(!ExpnId_eq(expn_id, ExpnId.root()), "assertion `left != right` failed");
    if (transparency === Transparency.Opaque) {
      return this.alloc_ctxt(ctxt, expn_id, transparency);
    }

    const call_site_ctxt0 = Span.ctxt(this.expn_data(expn_id).call_site);
    let call_site_ctxt =
      transparency === Transparency.SemiOpaque
        ? this.normalize_to_macros_2_0(call_site_ctxt0)
        : this.normalize_to_macro_rules(call_site_ctxt0);

    if (SyntaxContext.is_root(call_site_ctxt)) {
      return this.alloc_ctxt(ctxt, expn_id, transparency);
    }

    // Otherwise, `expn_id` is a macros 1.0 definition and the call site is in a
    // macros 2.0 expansion, i.e., a macros 1.0 invocation is in a macros 2.0 definition.
    //
    // In this case, the tokens from the macros 1.0 definition inherit the hygiene
    // at their invocation. That is, we pretend that the macros 1.0 definition
    // was defined at its invocation (i.e., inside the macros 2.0 definition)
    // so that the macros 2.0 definition remains hygienic.
    //
    // See the example at `test/ui/hygiene/legacy_interaction.rs`.
    for (const [expn_id, transparency] of this.marks(ctxt)) {
      call_site_ctxt = this.alloc_ctxt(call_site_ctxt, expn_id, transparency);
    }
    return this.alloc_ctxt(call_site_ctxt, expn_id, transparency);
  }

  /// Allocate a new context with the given key, or retrieve it from cache if the given key
  /// already exists. The auxiliary fields are calculated from the key.
  // rustc: compiler/rustc_span/src/hygiene.rs:566 alloc_ctxt
  alloc_ctxt(parent: SyntaxContext, expn_id: ExpnId, transparency: Transparency): SyntaxContext {
    // Look into the cache first.
    const key: SyntaxContextKey = [parent, expn_id, transparency];
    const cached = this.syntax_context_map.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Reserve a new syntax context.
    // The inserted dummy data can only be potentially accessed by nested `alloc_ctxt` calls,
    // the assert below ensures that it doesn't happen.
    const ctxt = SyntaxContext.from_usize(this.syntax_context_data.length);
    const root = SyntaxContextData.root();
    this.syntax_context_data.push(
      new SyntaxContextData(root.outer_expn, root.outer_transparency, root.parent, root.opaque, root.opaque_and_semiopaque, sym.dummy),
    );
    this.syntax_context_map.insert(key, ctxt);

    // Opaque and semi-opaque versions of the parent. Note that they may be equal to the
    // parent itself. E.g. `parent_opaque` == `parent` if the expn chain contains only opaques,
    // and `parent_opaque_and_semiopaque` == `parent` if the expn contains only (semi-)opaques.
    const parent_data = this.syntax_context_data[parent]!;
    assert(parent_data.dollar_crate_name !== sym.dummy, "assertion `left != right` failed");
    const parent_opaque = parent_data.opaque;
    const parent_opaque_and_semiopaque = parent_data.opaque_and_semiopaque;

    // Evaluate opaque and semi-opaque versions of the new syntax context.
    let opaque: SyntaxContext;
    let opaque_and_semiopaque: SyntaxContext;
    switch (transparency) {
      case "Transparent":
        [opaque, opaque_and_semiopaque] = [parent_opaque, parent_opaque_and_semiopaque];
        break;
      case "SemiOpaque":
        [opaque, opaque_and_semiopaque] = [
          parent_opaque,
          // Will be the same as `ctxt` if the expn chain contains only (semi-)opaques.
          this.alloc_ctxt(parent_opaque_and_semiopaque, expn_id, transparency),
        ];
        break;
      case "Opaque":
        [opaque, opaque_and_semiopaque] = [
          // Will be the same as `ctxt` if the expn chain contains only opaques.
          this.alloc_ctxt(parent_opaque, expn_id, transparency),
          // Will be the same as `ctxt` if the expn chain contains only (semi-)opaques.
          this.alloc_ctxt(parent_opaque_and_semiopaque, expn_id, transparency),
        ];
        break;
    }

    // Fill the full data, now that we have it.
    this.syntax_context_data[SyntaxContext.as_u32(ctxt)] = new SyntaxContextData(
      expn_id,
      transparency,
      parent,
      opaque,
      opaque_and_semiopaque,
      kw.DollarCrate,
    );
    return ctxt;
  }
}

// rustc: compiler/rustc_span/src/hygiene.rs:623 walk_chain
export function walk_chain(span: Span, to: SyntaxContext): Span {
  return HygieneData.with((data) => data.walk_chain(span, to));
}

/// In order to have good line stepping behavior in debugger, for the given span we return its
/// outermost macro call site that still has a `#[collapse_debuginfo(yes)]` property on it.
/// We also stop walking call sites at the function body level because no line stepping can occur
/// at the level above that.
/// The returned span can then be used in emitted debuginfo.
// rustc: compiler/rustc_span/src/hygiene.rs:632 walk_chain_collapsed
export function walk_chain_collapsed(span: Span, to: Span): Span {
  return HygieneData.with((data) => data.walk_chain_collapsed(span, to));
}

// rustc: compiler/rustc_span/src/hygiene.rs:636 update_dollar_crate_names
export function update_dollar_crate_names(get_name: (ctxt: SyntaxContext) => Symbol): void {
  // The new contexts that need updating are at the end of the list and have `$crate` as a name.
  const to_update: [number, Symbol][] = [];
  HygieneData.with((data) => {
    for (let idx = data.syntax_context_data.length - 1; idx >= 0; idx--) {
      const scdata = data.syntax_context_data[idx]!;
      if (scdata.dollar_crate_name === kw.DollarCrate) {
        to_update.push([idx, kw.DollarCrate]);
      } else {
        break;
      }
    }
  });
  // The callback must be called from outside of the `HygieneData` lock,
  // since it will try to acquire it too.
  for (const entry of to_update) {
    entry[1] = get_name(SyntaxContext.from_usize(entry[0]));
  }
  HygieneData.with((data) => {
    for (const [idx, name] of to_update) {
      data.syntax_context_data[idx]!.dollar_crate_name = name;
    }
  });
}

// rustc: compiler/rustc_span/src/hygiene.rs:660 debug_hygiene_data
export function debug_hygiene_data(verbose: boolean): string {
  return HygieneData.with((data) => {
    if (verbose) {
      // PORT: `format!("{data:#?}")` prints the FxHashMaps in hashbrown iteration order, which
      // depends on FxHash; not reproducible until rustc_hash/hashbrown order is modelled.
      unported("rustc_span::hygiene::debug_hygiene_data(verbose = true)");
    } else {
      let s = "Expansions:";
      const debug_expn_data = ([id, expn_data]: readonly [ExpnId, ExpnData]): void => {
        s +=
          `\n${debug_ExpnId(id, PLAIN)}: parent: ${debug_ExpnId(expn_data.parent, PLAIN)}` +
          `, call_site_ctxt: ${debug_SyntaxContext(Span.ctxt(expn_data.call_site), PLAIN)}` +
          `, def_site_ctxt: ${debug_SyntaxContext(Span.ctxt(expn_data.def_site), PLAIN)}` +
          `, kind: ${debug_ExpnKind(expn_data.kind, PLAIN)}`;
      };
      data.local_expn_data.forEach((expn_data, id) => {
        const ed = unwrap(expn_data, "no expansion data for an expansion ID");
        debug_expn_data([LocalExpnId.to_expn_id(LocalExpnId.from_usize(id)), ed]);
      });

      // Sort the hash map for more reproducible output.
      // Because of this, it is fine to rely on the unstable iteration order of the map.
      const foreign_expn_data = [...data.foreign_expn_data.iter()];
      foreign_expn_data.sort(([a], [b]) => a.krate - b.krate || a.local_id - b.local_id);
      foreign_expn_data.forEach(debug_expn_data);
      s += "\n\nSyntaxContexts:";
      data.syntax_context_data.forEach((ctxt, id) => {
        s +=
          `\n#${id}: parent: ${debug_SyntaxContext(ctxt.parent, PLAIN)}` +
          `, outer_mark: (${debug_ExpnId(ctxt.outer_expn, PLAIN)}, ${debug_Transparency(ctxt.outer_transparency, PLAIN)})`;
      });
      return s;
    }
  });
}

export const SyntaxContext = {
  // rustc: compiler/rustc_span/src/hygiene.rs:701 root
  root(): SyntaxContext {
    return 0 as SyntaxContext;
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:706 is_root
  is_root(self: SyntaxContext): boolean {
    return self === SyntaxContext.as_u32(SyntaxContext.root());
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:711 as_u32
  as_u32(self: SyntaxContext): number {
    return self;
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:716 from_u32
  from_u32(raw: number): SyntaxContext {
    return raw as SyntaxContext;
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:721 from_u16
  from_u16(raw: number): SyntaxContext {
    return raw as SyntaxContext;
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:726 from_usize
  from_usize(raw: number): SyntaxContext {
    // `u32::try_from(raw).unwrap()`
    if (raw > 0xffff_ffff) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
    return raw as SyntaxContext;
  },

  /// Extend a syntax context with a given expansion and transparency.
  // rustc: compiler/rustc_span/src/hygiene.rs:732 apply_mark
  apply_mark(self: SyntaxContext, expn_id: ExpnId, transparency: Transparency): SyntaxContext {
    return HygieneData.with((data) => data.apply_mark(self, expn_id, transparency));
  },

  /// Pulls a single mark off of the syntax context. This effectively moves the
  /// context up one macro definition level. That is, if we have a nested macro
  /// definition as follows:
  ///
  /// ```ignore (illustrative)
  /// macro_rules! f {
  ///    macro_rules! g {
  ///        ...
  ///    }
  /// }
  /// ```
  ///
  /// and we have a SyntaxContext that is referring to something declared by an invocation
  /// of g (call it g1), calling remove_mark will result in the SyntaxContext for the
  /// invocation of f that created g1.
  /// Returns the mark that was removed.
  // rustc: compiler/rustc_span/src/hygiene.rs:753 remove_mark
  remove_mark(self: MutRef<SyntaxContext>): ExpnId {
    return HygieneData.with((data) => data.remove_mark(self)[0]);
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:758 marks
  marks(self: SyntaxContext): [ExpnId, Transparency][] {
    return HygieneData.with((data) => data.marks(self));
  },

  /// Adjust this context for resolution in a scope created by the given expansion.
  /// (See upstream for the worked `macro m` example.)
  /// This returns the expansion whose definition scope we use to privacy check the resolution,
  /// or `None` if we privacy check as usual (i.e., not w.r.t. a macro definition scope).
  // rustc: compiler/rustc_span/src/hygiene.rs:790 adjust
  adjust(self: MutRef<SyntaxContext>, expn_id: ExpnId): ExpnId | undefined {
    return HygieneData.with((data) => data.adjust(self, expn_id));
  },

  /// Like `SyntaxContext::adjust`, but also normalizes `self` to macros 2.0.
  // rustc: compiler/rustc_span/src/hygiene.rs:796 normalize_to_macros_2_0_and_adjust
  normalize_to_macros_2_0_and_adjust(self: MutRef<SyntaxContext>, expn_id: ExpnId): ExpnId | undefined {
    return HygieneData.with((data) => {
      self.value = data.normalize_to_macros_2_0(self.value);
      return data.adjust(self, expn_id);
    });
  },

  /// Adjust this context for resolution in a scope created by the given expansion
  /// via a glob import with the given `SyntaxContext`.
  /// (See upstream for the worked `macro m` / `macro n` example.)
  /// This returns `None` if the context cannot be glob-adjusted.
  /// Otherwise, it returns the scope to use when privacy checking (see `adjust` for details).
  // PORT: `Option<Option<ExpnId>>` → `{ $: "Some", _0 } | undefined` (PORTING §5).
  // rustc: compiler/rustc_span/src/hygiene.rs:829 glob_adjust
  glob_adjust(self: MutRef<SyntaxContext>, expn_id: ExpnId, glob_span: Span): { $: "Some"; _0: ExpnId | undefined } | undefined {
    return HygieneData.with((data) => {
      let scope: ExpnId | undefined = undefined;
      const glob_ctxt = { value: data.normalize_to_macros_2_0(Span.ctxt(glob_span)) };
      while (!data.is_descendant_of(expn_id, data.outer_expn(glob_ctxt.value))) {
        scope = data.remove_mark(glob_ctxt)[0];
        if (!ExpnId_eq(data.remove_mark(self)[0], unwrap(scope))) {
          return undefined;
        }
      }
      if (data.adjust(self, expn_id) !== undefined) {
        return undefined;
      }
      return { $: "Some", _0: scope };
    });
  },

  /// Undo `glob_adjust` if possible:
  ///
  /// ```ignore (illustrative)
  /// if let Some(privacy_checking_scope) = self.reverse_glob_adjust(expansion, glob_ctxt) {
  ///     assert!(self.glob_adjust(expansion, glob_ctxt) == Some(privacy_checking_scope));
  /// }
  /// ```
  // rustc: compiler/rustc_span/src/hygiene.rs:853 reverse_glob_adjust
  reverse_glob_adjust(self: MutRef<SyntaxContext>, expn_id: ExpnId, glob_span: Span): { $: "Some"; _0: ExpnId | undefined } | undefined {
    return HygieneData.with((data) => {
      if (data.adjust(self, expn_id) !== undefined) {
        return undefined;
      }

      const glob_ctxt = { value: data.normalize_to_macros_2_0(Span.ctxt(glob_span)) };
      const marks: [ExpnId, Transparency][] = [];
      while (!data.is_descendant_of(expn_id, data.outer_expn(glob_ctxt.value))) {
        marks.push(data.remove_mark(glob_ctxt));
      }

      const last = marks[marks.length - 1];
      const scope = last === undefined ? undefined : last[0];
      for (let mark = marks.pop(); mark !== undefined; mark = marks.pop()) {
        const [expn_id, transparency] = mark;
        self.value = data.apply_mark(self.value, expn_id, transparency);
      }
      return { $: "Some", _0: scope };
    });
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:877 hygienic_eq
  hygienic_eq(self: SyntaxContext, other: SyntaxContext, expn_id: ExpnId): boolean {
    return HygieneData.with((data) => {
      const self_normalized = { value: data.normalize_to_macros_2_0(self) };
      data.adjust(self_normalized, expn_id);
      return self_normalized.value === data.normalize_to_macros_2_0(other);
    });
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:886 normalize_to_macros_2_0
  normalize_to_macros_2_0(self: SyntaxContext): SyntaxContext {
    // fast path to avoid locking: the root context normalizes to itself
    if (SyntaxContext.is_root(self)) {
      return self;
    }
    return HygieneData.with((data) => data.normalize_to_macros_2_0(self));
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:895 normalize_to_macro_rules
  normalize_to_macro_rules(self: SyntaxContext): SyntaxContext {
    // fast path to avoid locking: the root context normalizes to itself
    if (SyntaxContext.is_root(self)) {
      return self;
    }
    return HygieneData.with((data) => data.normalize_to_macro_rules(self));
  },

  /// See [`SyntaxContextData::outer_expn`]
  // rustc: compiler/rustc_span/src/hygiene.rs:905 outer_expn
  outer_expn(self: SyntaxContext): ExpnId {
    return HygieneData.with((data) => data.outer_expn(self));
  },

  /// `ctxt.outer_expn_data()` is equivalent to but faster than
  /// `ctxt.outer_expn().expn_data()`.
  // rustc: compiler/rustc_span/src/hygiene.rs:912 outer_expn_data
  outer_expn_data(self: SyntaxContext): ExpnData {
    // PORT: `.clone()`: see LocalExpnId.expn_data.
    return HygieneData.with((data) => data.expn_data(data.outer_expn(self)));
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:917 dollar_crate_name
  dollar_crate_name(self: SyntaxContext): Symbol {
    return HygieneData.with((data) => data.syntax_context_data[self]!.dollar_crate_name);
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:922 edition
  edition(self: SyntaxContext): Edition {
    return HygieneData.with((data) => data.expn_data(data.outer_expn(self)).edition);
  },

  /// Returns whether this context originates in a foreign crate's external macro.
  ///
  /// This is used to test whether a lint should not even begin to figure out whether it should
  /// be reported on the current node.
  // rustc: compiler/rustc_span/src/hygiene.rs:930 in_external_macro
  in_external_macro(self: SyntaxContext, sm: SourceMap): boolean {
    // fast path to avoid locking/expn-data read: the root context is not in a macro
    if (SyntaxContext.is_root(self)) {
      return false;
    }
    const expn_data = SyntaxContext.outer_expn_data(self);
    const kind = expn_data.kind;
    if (
      kind.$ === "Root" ||
      (kind.$ === "Desugaring" &&
        (kind._0.$ === "ForLoop" ||
          kind._0.$ === "WhileLoop" ||
          kind._0.$ === "OpaqueTy" ||
          kind._0.$ === "Async" ||
          kind._0.$ === "Await"))
    ) {
      return false;
    } else if (kind.$ === "AstPass" || kind.$ === "Desugaring") {
      return true; // well, it's "external"
    } else if (kind.$ === "Macro" && kind._0 === MacroKind.Bang) {
      // Dummy span for the `def_site` means it's an external macro.
      return Span.is_dummy(expn_data.def_site) || sm.is_imported(expn_data.def_site);
    } else {
      return true; // definitely a plugin
    }
  },
};

// rustc: compiler/rustc_span/src/hygiene.rs:956 fmt
export const debug_SyntaxContext: Debug<SyntaxContext> = (v) => `#${v}`;

/// Reuses the span but adds information like the kind of the desugaring and features that are
/// allowed inside this span.
// PORT: `impl Span` in this file: attached to the hoisted `Span` companion (span_encoding.ts PORT
// block), like lib.rs's `impl Span`.
declare module "./span_encoding.ts" {
  namespace Span {
    export let mark_with_reason: (
      self: Span,
      allow_internal_unstable: readonly Symbol[] | undefined,
      reason: DesugaringKind,
      edition: Edition,
      hcx: StableHashCtxt,
    ) => Span;
  }
}
// rustc: compiler/rustc_span/src/hygiene.rs:964 mark_with_reason
Span.mark_with_reason = function (
  self: Span,
  allow_internal_unstable: readonly Symbol[] | undefined,
  reason: DesugaringKind,
  edition: Edition,
  hcx: StableHashCtxt,
): Span {
  const d = ExpnData.default({ $: "Desugaring", _0: reason }, self, edition, undefined, undefined);
  const expn_data = new ExpnData(
    d.kind,
    d.parent,
    d.call_site,
    d.disambiguator,
    d.def_site,
    allow_internal_unstable,
    d.edition,
    d.macro_def_id,
    d.parent_module,
    d.allow_internal_unsafe,
    d.local_inner_macros,
    d.collapse_debuginfo,
    d.diagnostic_opaque,
  );
  const expn_id = LocalExpnId.fresh(expn_data, hcx);
  return Span.apply_mark(self, LocalExpnId.to_expn_id(expn_id), Transparency.Transparent);
};

/// A subset of properties from both macro definition and macro call available through global data.
/// Avoid using this if you have access to the original definition or call structures.
// PORT: fields readonly except `disambiguator` (private upstream, set by `update_disambiguator`);
// `expn_data()` returns the stored instance instead of a clone; the by-value takers that mutate
// (`LocalExpnId::fresh`/`set_expn_data`, via `update_disambiguator`) `clone()` first.
export class ExpnData {
  constructor(
    // --- The part unique to each expansion.
    readonly kind: ExpnKind,
    /// The expansion that contains the definition of the macro for this expansion.
    readonly parent: ExpnId,
    /// The span of the macro call which produced this expansion.
    ///
    /// This span will typically have a different `ExpnData` and `call_site`.
    /// This recursively traces back through any macro calls which expanded into further
    /// macro calls, until the "source call-site" is reached at the root SyntaxContext.
    /// For example, if `food!()` expands to `fruit!()` which then expands to `grape`,
    /// then the call-site of `grape` is `fruit!()` and the call-site of `fruit!()`
    /// is `food!()`.
    ///
    /// For a desugaring expansion, this is the span of the expression or node that was
    /// desugared.
    readonly call_site: Span,
    /// Used to force two `ExpnData`s to have different `Fingerprint`s.
    /// Due to macro expansion, it's possible to end up with two `ExpnId`s
    /// that have identical `ExpnData`s. This violates the contract of `StableHash`
    /// - the two `ExpnId`s are not equal, but their `Fingerprint`s are equal
    /// (since the numerical `ExpnId` value is not considered by the `StableHash`
    /// implementation).
    ///
    /// The `disambiguator` field is set by `update_disambiguator` when two distinct
    /// `ExpnId`s would end up with the same `Fingerprint`. Since `ExpnData` includes
    /// a `krate` field, this value only needs to be unique within a single crate.
    public disambiguator: number,

    // --- The part specific to the macro/desugaring definition.
    // --- It may be reasonable to share this part between expansions with the same definition,
    // --- but such sharing is known to bring some minor inconveniences without also bringing
    // --- noticeable perf improvements (PR #62898).
    /// The span of the macro definition (possibly dummy).
    /// This span serves only informational purpose and is not used for resolution.
    readonly def_site: Span,
    /// List of `#[unstable]`/feature-gated features that the macro is allowed to use
    /// internally without forcing the whole crate to opt-in
    /// to them.
    readonly allow_internal_unstable: readonly Symbol[] | undefined,
    /// Edition of the crate in which the macro is defined.
    readonly edition: Edition,
    /// The `DefId` of the macro being invoked,
    /// if this `ExpnData` corresponds to a macro invocation
    readonly macro_def_id: DefId | undefined,
    /// The normal module (`mod`) in which the expanded macro was defined.
    readonly parent_module: ModId | undefined,
    /// Suppresses the `unsafe_code` lint for code produced by this macro.
    readonly allow_internal_unsafe: boolean,
    /// Enables the macro helper hack (`ident!(...)` -> `$crate::ident!(...)`) for this macro.
    readonly local_inner_macros: boolean,
    /// Should debuginfo for the macro be collapsed to the outermost expansion site (in other
    /// words, was the macro definition annotated with `#[collapse_debuginfo]`)?
    readonly collapse_debuginfo: boolean,
    /// When true, we prevent diagnostics pointing into this macro, if it is one, and we do not
    /// display the note telling people to use the `-Zmacro-backtrace` flag.
    readonly diagnostic_opaque: boolean,
  ) {}

  /** `#[derive(Clone)]` (shallow: every field but `disambiguator` is immutable). */
  clone(): ExpnData {
    return new ExpnData(
      this.kind,
      this.parent,
      this.call_site,
      this.disambiguator,
      this.def_site,
      this.allow_internal_unstable,
      this.edition,
      this.macro_def_id,
      this.parent_module,
      this.allow_internal_unsafe,
      this.local_inner_macros,
      this.collapse_debuginfo,
      this.diagnostic_opaque,
    );
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:1046 new
  static new(
    kind: ExpnKind,
    parent: ExpnId,
    call_site: Span,
    def_site: Span,
    allow_internal_unstable: readonly Symbol[] | undefined,
    edition: Edition,
    macro_def_id: DefId | undefined,
    parent_module: ModId | undefined,
    allow_internal_unsafe: boolean,
    local_inner_macros: boolean,
    collapse_debuginfo: boolean,
    diagnostic_opaque: boolean,
  ): ExpnData {
    return new ExpnData(
      kind,
      parent,
      call_site,
      0,
      def_site,
      allow_internal_unstable,
      edition,
      macro_def_id,
      parent_module,
      allow_internal_unsafe,
      local_inner_macros,
      collapse_debuginfo,
      diagnostic_opaque,
    );
  }

  /// Constructs expansion data with default properties.
  // rustc: compiler/rustc_span/src/hygiene.rs:1078 default
  static default(
    kind: ExpnKind,
    call_site: Span,
    edition: Edition,
    macro_def_id: DefId | undefined,
    parent_module: ModId | undefined,
  ): ExpnData {
    return new ExpnData(
      kind,
      ExpnId.root(),
      call_site,
      0,
      DUMMY_SP,
      undefined,
      edition,
      macro_def_id,
      parent_module,
      false,
      false,
      false,
      false,
    );
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:1102 allow_unstable
  static allow_unstable(
    kind: ExpnKind,
    call_site: Span,
    edition: Edition,
    allow_internal_unstable: readonly Symbol[],
    macro_def_id: DefId | undefined,
    parent_module: ModId | undefined,
  ): ExpnData {
    const d = ExpnData.default(kind, call_site, edition, macro_def_id, parent_module);
    return new ExpnData(
      d.kind,
      d.parent,
      d.call_site,
      d.disambiguator,
      d.def_site,
      allow_internal_unstable,
      d.edition,
      d.macro_def_id,
      d.parent_module,
      d.allow_internal_unsafe,
      d.local_inner_macros,
      d.collapse_debuginfo,
      d.diagnostic_opaque,
    );
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:1117 is_root
  is_root(): boolean {
    return this.kind.$ === "Root";
  }

  // rustc: compiler/rustc_span/src/hygiene.rs:1122 hash_expn
  hash_expn(hcx: StableHashCtxt): Hash64 {
    const hasher = StableHasher.new();
    stable_hash_ExpnData(this, hcx, hasher);
    return hasher.finish(Hash64);
  }
}

/// `#[derive(Debug)]`
export const debug_ExpnData: Debug<ExpnData> = (v, f) =>
  debug_struct(f, "ExpnData", [
    ["kind", debug_ExpnKind(v.kind, f)],
    ["parent", debug_ExpnId(v.parent, f)],
    ["call_site", debug_Span(v.call_site, f)],
    ["disambiguator", debug_int(v.disambiguator, f)],
    ["def_site", debug_Span(v.def_site, f)],
    ["allow_internal_unstable", debug_option(v.allow_internal_unstable, f, (x, f) => debug_vec(x, f, debug_Symbol))],
    ["edition", debug_Edition(v.edition, f)],
    ["macro_def_id", debug_option(v.macro_def_id, f, debug_DefId)],
    ["parent_module", debug_option(v.parent_module, f, debug_ModId)],
    ["allow_internal_unsafe", debug_bool(v.allow_internal_unsafe, f)],
    ["local_inner_macros", debug_bool(v.local_inner_macros, f)],
    ["collapse_debuginfo", debug_bool(v.collapse_debuginfo, f)],
    ["diagnostic_opaque", debug_bool(v.diagnostic_opaque, f)],
  ]);

/// Expansion kind.
export type ExpnKind =
  /// No expansion, aka root expansion. Only `ExpnId::root()` has this kind.
  | { readonly $: "Root" }
  /// Expansion produced by a macro.
  | { readonly $: "Macro"; readonly _0: MacroKind; readonly _1: Symbol }
  /// Transform done by the compiler on the AST.
  | { readonly $: "AstPass"; readonly _0: AstPass }
  /// Desugaring done by the compiler during AST lowering.
  | { readonly $: "Desugaring"; readonly _0: DesugaringKind };
export const ExpnKind = {
  Root: Object.freeze({ $: "Root" }) as ExpnKind,

  // rustc: compiler/rustc_span/src/hygiene.rs:1143 descr
  descr(self: ExpnKind): string {
    switch (self.$) {
      case "Root":
        return display_Symbol(kw.PathRoot);
      case "Macro": {
        const macro_kind = self._0;
        const name = self._1;
        if (macro_kind === "Bang") return `${display_Symbol(name)}!`;
        if (macro_kind === "Attr") return `#[${display_Symbol(name)}]`;
        return `#[derive(${display_Symbol(name)})]`;
      }
      case "AstPass":
        return AstPass.descr(self._0);
      case "Desugaring":
        return `desugaring of ${DesugaringKind.descr(self._0)}`;
    }
  },
};

/// `#[derive(PartialEq)]`
export function ExpnKind_eq(a: ExpnKind, b: ExpnKind): boolean {
  switch (a.$) {
    case "Root":
      return b.$ === "Root";
    case "Macro":
      return b.$ === "Macro" && a._0 === b._0 && a._1 === b._1;
    case "AstPass":
      return b.$ === "AstPass" && a._0 === b._0;
    case "Desugaring":
      return b.$ === "Desugaring" && DesugaringKind_eq(a._0, b._0);
  }
}

/// `#[derive(Debug)]`
export const debug_ExpnKind: Debug<ExpnKind> = (v, f) => {
  switch (v.$) {
    case "Root":
      return "Root";
    case "Macro":
      return debug_tuple(f, "Macro", [debug_MacroKind(v._0, f), debug_Symbol(v._1, f)]);
    case "AstPass":
      return debug_tuple(f, "AstPass", [debug_AstPass(v._0, f)]);
    case "Desugaring":
      return debug_tuple(f, "Desugaring", [debug_DesugaringKind(v._0, f)]);
  }
};

/// The kind of macro invocation or definition.
export type MacroKind =
  /// A bang macro `foo!()`.
  | "Bang"
  /// An attribute macro `#[foo]`.
  | "Attr"
  /// A derive macro `#[derive(Foo)]`
  | "Derive";
export const MacroKind = {
  Bang: "Bang",
  Attr: "Attr",
  Derive: "Derive",

  // rustc: compiler/rustc_span/src/hygiene.rs:1170 descr
  descr(self: MacroKind): string {
    switch (self) {
      case "Bang":
        return "macro";
      case "Attr":
        return "attribute macro";
      case "Derive":
        return "derive macro";
    }
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:1178 descr_expected
  descr_expected(self: MacroKind): string {
    switch (self) {
      case "Attr":
        return "attribute";
      default:
        return MacroKind.descr(self);
    }
  },

  // rustc: compiler/rustc_span/src/hygiene.rs:1185 article
  article(self: MacroKind): string {
    switch (self) {
      case "Attr":
        return "an";
      default:
        return "a";
    }
  },
} as const;
/// `#[derive(PartialOrd, Ord)]` discriminants.
export const MacroKind_discriminant: Record<MacroKind, number> = { Bang: 0, Attr: 1, Derive: 2 };
/// `#[derive(Debug)]`
export const debug_MacroKind: Debug<MacroKind> = (v) => v;

/// The kind of AST transform.
export type AstPass = "StdImports" | "TestHarness" | "ProcMacroHarness";
export const AstPass = {
  StdImports: "StdImports",
  TestHarness: "TestHarness",
  ProcMacroHarness: "ProcMacroHarness",

  // rustc: compiler/rustc_span/src/hygiene.rs:1202 descr
  descr(self: AstPass): string {
    switch (self) {
      case "StdImports":
        return "standard library imports";
      case "TestHarness":
        return "test harness";
      case "ProcMacroHarness":
        return "proc macro harness";
    }
  },
} as const;
/// `#[derive(Debug)]`
export const debug_AstPass: Debug<AstPass> = (v) => v;

/// The kind of compiler desugaring.
export type DesugaringKind =
  | { readonly $: "QuestionMark" }
  | { readonly $: "TryBlock" }
  | { readonly $: "YeetExpr" }
  /// Desugaring of an `impl Trait` in return type position
  /// to an `type Foo = impl Trait;` and replacing the
  /// `impl Trait` with `Foo`.
  | { readonly $: "OpaqueTy" }
  | { readonly $: "Async" }
  | { readonly $: "Await" }
  | { readonly $: "ForLoop" }
  | { readonly $: "WhileLoop" }
  /// `async Fn()` bound modifier
  | { readonly $: "BoundModifier" }
  /// Calls to contract checks (`#[requires]` to precond, `#[ensures]` to postcond)
  | { readonly $: "Contract" }
  /// A pattern type range start/end
  | { readonly $: "PatTyRange" }
  /// A format literal.
  | {
      readonly $: "FormatLiteral";
      /// Was this format literal written in the source?
      /// - `format!("boo")` => Yes,
      /// - `format!(concat!("b", "o", "o"))` => No,
      /// - `format!(include_str!("boo.txt"))` => No,
      ///
      /// If it wasn't written in the source then we have to be careful with suggestions about
      /// rewriting it.
      readonly source: boolean;
    }
  | { readonly $: "RangeExpr" };

const unit = <T extends string>($: T) => Object.freeze({ $ }) as { readonly $: T };

export const DesugaringKind = {
  QuestionMark: unit("QuestionMark"),
  TryBlock: unit("TryBlock"),
  YeetExpr: unit("YeetExpr"),
  OpaqueTy: unit("OpaqueTy"),
  Async: unit("Async"),
  Await: unit("Await"),
  ForLoop: unit("ForLoop"),
  WhileLoop: unit("WhileLoop"),
  BoundModifier: unit("BoundModifier"),
  Contract: unit("Contract"),
  PatTyRange: unit("PatTyRange"),
  RangeExpr: unit("RangeExpr"),

  /// The description wording should combine well with "desugaring of {}".
  // rustc: compiler/rustc_span/src/hygiene.rs:1247 descr
  descr(self: DesugaringKind): string {
    switch (self.$) {
      case "Async":
        return "`async` block or function";
      case "Await":
        return "`await` expression";
      case "QuestionMark":
        return "operator `?`";
      case "TryBlock":
        return "`try` block";
      case "YeetExpr":
        return "`do yeet` expression";
      case "OpaqueTy":
        return "`impl Trait`";
      case "ForLoop":
        return "`for` loop";
      case "WhileLoop":
        return "`while` loop";
      case "BoundModifier":
        return "trait bound modifier";
      case "Contract":
        return "contract check";
      case "PatTyRange":
        return "pattern type";
      case "FormatLiteral":
        if (self.source === true) return "format string literal";
        return "expression that expanded into a format string literal";
      case "RangeExpr":
        return "range expression";
    }
  },

  /// For use with `rustc_unimplemented` to support conditions
  /// like `from_desugaring = "QuestionMark"`
  // rustc: compiler/rustc_span/src/hygiene.rs:1270 matches
  matches(self: DesugaringKind, value: string): boolean {
    switch (self.$) {
      case "Async":
        return value === "Async";
      case "Await":
        return value === "Await";
      case "QuestionMark":
        return value === "QuestionMark";
      case "TryBlock":
        return value === "TryBlock";
      case "YeetExpr":
        return value === "YeetExpr";
      case "OpaqueTy":
        return value === "OpaqueTy";
      case "ForLoop":
        return value === "ForLoop";
      case "WhileLoop":
        return value === "WhileLoop";
      case "BoundModifier":
        return value === "BoundModifier";
      case "Contract":
        return value === "Contract";
      case "PatTyRange":
        return value === "PatTyRange";
      case "FormatLiteral":
        return value === "FormatLiteral";
      case "RangeExpr":
        return value === "RangeExpr";
    }
  },
};

/// `#[derive(PartialEq)]`
export function DesugaringKind_eq(a: DesugaringKind, b: DesugaringKind): boolean {
  if (a.$ === "FormatLiteral") return b.$ === "FormatLiteral" && a.source === b.source;
  return a.$ === b.$;
}

/// `#[derive(Debug)]`
export const debug_DesugaringKind: Debug<DesugaringKind> = (v, f) =>
  v.$ === "FormatLiteral" ? debug_struct(f, "FormatLiteral", [["source", debug_bool(v.source, f)]]) : v.$;

// PORT: `HygieneEncodeContext` / `HygieneDecodeContext` (crate metadata and the incremental
// on-disk cache) are out of scope until M5; their functions are skipped below.
// rustc-skip: compiler/rustc_span/src/hygiene.rs:1332 default HygieneEncodeContext (metadata, M5)
// rustc-skip: compiler/rustc_span/src/hygiene.rs:1346 get_encoding_index HygieneEncodeContext (metadata, M5)
// rustc-skip: compiler/rustc_span/src/hygiene.rs:1354 schedule_expn_data_for_encoding HygieneEncodeContext (metadata, M5)
// rustc-skip: compiler/rustc_span/src/hygiene.rs:1360 encode HygieneEncodeContext (metadata, M5)
// rustc-skip: compiler/rustc_span/src/hygiene.rs:1410 get_syntax_ctxt_encoding_index HygieneEncodeContext (metadata, M5)

/// Register an expansion which has been decoded from the on-disk-cache for the local crate.
// rustc: compiler/rustc_span/src/hygiene.rs:1434 register_local_expn_id
export function register_local_expn_id(data: ExpnData, hash: ExpnHash): ExpnId {
  return HygieneData.with((hygiene_data) => {
    const expn_id0 = LocalExpnId.from_usize(hygiene_data.local_expn_data.length);
    hygiene_data.local_expn_data.push(data);
    const _eid = LocalExpnId.from_usize(hygiene_data.local_expn_hashes.length);
    hygiene_data.local_expn_hashes.push(hash);
    // debug_assert_eq!(expn_id, _eid);
    void _eid;

    const expn_id = LocalExpnId.to_expn_id(expn_id0);

    const _old_id = hygiene_data.expn_hash_to_expn_id.get(hash);
    hygiene_data.expn_hash_to_expn_id.set(hash, expn_id);
    // debug_assert!(_old_id.is_none());
    void _old_id;
    return expn_id;
  });
}

/// Register an expansion which has been decoded from the metadata of a foreign crate.
// rustc: compiler/rustc_span/src/hygiene.rs:1450 register_expn_id
export function register_expn_id(krate: CrateNum, local_id: ExpnIndex, data: ExpnData, hash: ExpnHash): ExpnId {
  // debug_assert!(data.parent == ExpnId::root() || krate == data.parent.krate);
  const expn_id = new ExpnId(krate, local_id);
  HygieneData.with((hygiene_data) => {
    hygiene_data.foreign_expn_data.insert(expn_id, data);
    hygiene_data.foreign_expn_hashes.insert(expn_id, hash);
    // debug_assert!(_old_hash.is_none() || _old_hash == Some(hash));
    hygiene_data.expn_hash_to_expn_id.set(hash, expn_id);
    // debug_assert!(_old_id.is_none() || _old_id == Some(expn_id));
  });
  return expn_id;
}

// rustc-skip: compiler/rustc_span/src/hygiene.rs:1469 decode_expn_id metadata decoding (M5)
// rustc-skip: compiler/rustc_span/src/hygiene.rs:1501 decode_syntax_context metadata decoding (M5)
// rustc-skip: compiler/rustc_span/src/hygiene.rs:1532 encode Encodable impl (metadata, M5)
// rustc-skip: compiler/rustc_span/src/hygiene.rs:1538 decode Decodable impl (metadata, M5)

/// Updates the `disambiguator` field of the corresponding `ExpnData`
/// such that the `Fingerprint` of the `ExpnData` does not collide with
/// any other `ExpnIds`.
///
/// This method is called only when an `ExpnData` is first associated
/// with an `ExpnId` (when the `ExpnId` is initially constructed, or via
/// `set_expn_data`). It is *not* called for foreign `ExpnId`s deserialized
/// from another crate's metadata - since `ExpnHash` includes the stable crate id,
/// collisions are only possible between `ExpnId`s within the same crate.
// rustc: compiler/rustc_span/src/hygiene.rs:1552 update_disambiguator
function update_disambiguator(expn_data: ExpnData, hcx: StableHashCtxt): ExpnHash {
  // This disambiguator should not have been set yet.
  if (expn_data.disambiguator !== 0) {
    panic(
      `assertion \`left == right\` failed: Already set disambiguator for ExpnData: ${debug_ExpnData(expn_data, PLAIN)}\n  left: ${expn_data.disambiguator}\n right: 0`,
    );
  }
  hcx.assert_default_stable_hash_controls("ExpnData (disambiguator)");
  let expn_hash = expn_data.hash_expn(hcx);

  const disambiguator = HygieneData.with((data) => {
    // If this is the first ExpnData with a given hash, then keep our
    // disambiguator at 0 (the default u32 value)
    const disambig = data.expn_data_disambiguators.get(expn_hash) ?? 0;
    data.expn_data_disambiguators.set(expn_hash, disambig + 1);
    return disambig;
  });

  if (disambiguator !== 0) {
    // debug!("Set disambiguator for expn_data={:?} expn_hash={:?}", expn_data, expn_hash);

    expn_data.disambiguator = disambiguator;
    expn_hash = expn_data.hash_expn(hcx);

    // Verify that the new disambiguator makes the hash unique
    // (#[cfg(debug_assertions)] check omitted: rustc ships without debug assertions)
  }

  return ExpnHash.new(DefPathHash.stable_crate_id(DefId_to_stable_hash_key(CrateNum.as_def_id(LOCAL_CRATE), hcx)), expn_hash);
}

// rustc: compiler/rustc_span/src/hygiene.rs:1588 stable_hash
/** `impl StableHash for SyntaxContext` */
export function stable_hash_SyntaxContext(self: SyntaxContext, hcx: StableHashCtxt, hasher: StableHasher): void {
  const TAG_EXPANSION = 0;
  const TAG_NO_EXPANSION = 1;

  if (SyntaxContext.is_root(self)) {
    stable_hash_u8(TAG_NO_EXPANSION, hcx, hasher);
  } else {
    stable_hash_u8(TAG_EXPANSION, hcx, hasher);
    // This duplicates `ExpnId::stable_hash`, but reads the outer mark and
    // expansion hash in a single `HygieneData::with` call to avoid extra locking.
    hcx.assert_default_stable_hash_controls("ExpnId");
    const [hash, transparency] = HygieneData.with((data): [Fingerprint, Transparency] => {
      const [expn_id, transparency] = data.outer_mark(self);
      return [ExpnHash._0(data.expn_hash(expn_id)), transparency];
    });
    stable_hash_Fingerprint(hash, hcx, hasher);
    stable_hash_Transparency(transparency, hcx, hasher);
  }
}

// rustc: compiler/rustc_span/src/hygiene.rs:1610 stable_hash
/** `impl StableHash for ExpnId` */
export function stable_hash_ExpnId(self: ExpnId, hcx: StableHashCtxt, hasher: StableHasher): void {
  hcx.assert_default_stable_hash_controls("ExpnId");
  const hash = ExpnId_eq(self, ExpnId.root())
    ? // Avoid fetching TLS storage for a trivial often-used value.
      Fingerprint.ZERO
    : ExpnHash._0(self.expn_hash());

  stable_hash_Fingerprint(hash, hcx, hasher);
}

// rustc: compiler/rustc_span/src/hygiene.rs:1624 stable_hash
/** `impl StableHash for LocalExpnId` */
export function stable_hash_LocalExpnId(self: LocalExpnId, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_ExpnId(LocalExpnId.to_expn_id(self), hcx, hasher);
}
