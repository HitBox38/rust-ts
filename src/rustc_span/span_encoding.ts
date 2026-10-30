// PORT: representation of `Span` (design decision of lane span-core, see docs/handoff/span-core.md).
//
// Upstream packs a `Span` into 8 bytes (`lo_or_index: u32`, `len_with_tag_or_marker: u16`,
// `ctxt_or_parent_or_marker: u16`) with four formats (inline-context, inline-parent,
// partially-interned, fully-interned). 64 bits do not fit a JS number, so rust-ts keeps only the
// **fully-interned** format: a `Span` is a branded number indexing `SpanInterner.spans`, the
// session's table of distinct `SpanData` values.
//
// Upstream behaviour that is kept:
// - Equality: upstream encodings are canonical (every `Span` is produced by `Span::new` or an
//   equivalent fast path), so two spans are `==` iff their `SpanData` are equal. The interner
//   deduplicates `SpanData`, so `===` on the index is the same relation.
// - `data()`, `ctxt()`, `parent()`, `with_*`, `map_ctxt`, `is_dummy`, `from_expansion`: same
//   results, read from the interned `SpanData`.
// - `DUMMY_SP` is index 0. `SpanInterner.default()` pre-seeds index 0 with the dummy `SpanData`,
//   and `Span.new`/`Interned.data` handle the dummy span without touching the session globals,
//   because upstream's `DUMMY_SP` is inline and usable outside a session.
// Upstream behaviour that differs (unobservable in compiler output):
// - Any other span needs the session globals (upstream: only spans with large len/ctxt/parent).
// - Interner indices differ from upstream's (they are never printed).
// The inline-format helpers (`InlineCtxt`, `InlineParent`, `PartiallyInterned`) therefore have
// no TS counterpart and are `rustc-skip`ped below; `Interned` is ported.
//
// PORT: methods. `Span` is a number, so `impl Span` methods live on the companion `Span`,
// called as `Span.lo(sp)` for upstream `sp.lo()`. The companion is a *function declaration*
// (hoisted and initialized before any module body runs), so `lib.ts` and `hygiene.ts`, which
// form an import cycle with this file, can attach their `impl Span` methods at their top level
// whatever the evaluation order:
//   declare module "./span_encoding.ts" { namespace Span { let lo: (self: Span) => BytePos; } }
//   Span.lo = function (self: Span): BytePos { ... };
import { debug_tuple, type Fmt } from "../std/fmt.ts";
import { Err, type Result } from "../std/result.ts";
import { unreachable } from "../std/panic.ts";
import type { LocalDefId } from "./def_id.ts";
import { SyntaxContext } from "./hygiene.ts";
import { debug_Span, session_globals_get, SPAN_TRACK, SpanData, with_session_globals, type BytePos } from "./lib.ts";

/// A compressed span.
///
/// [`SpanData`] is 16 bytes, which is too big to stick everywhere. `Span` is
/// only 8 bytes. A large majority of `SpanData` instances can be made to fit
/// within those 8 bytes. Any `SpanData` whose fields don't fit into a `Span`
/// are stored in a separate interner table, and the `Span` will index into
/// that table.
///
/// (rust-ts: always the interned form, see the PORT block at the top of the file.)
export type Span = number & { readonly __brand: "Span" };

/** Companion of the `Span` handle (see the PORT block at the top). Not callable. */
export function Span(): never {
  return unreachable("`Span` is a handle type; use `Span.new`");
}

export declare namespace Span {
  let new_: (lo: BytePos, hi: BytePos, ctxt: SyntaxContext, parent: LocalDefId | undefined) => Span;
  export { new_ as new };
  export let data: (self: Span) => SpanData;
  export let data_untracked: (self: Span) => SpanData;
  export let from_expansion: (self: Span) => boolean;
  export let is_dummy: (self: Span) => boolean;
  export let map_ctxt: (self: Span, map: (ctxt: SyntaxContext) => SyntaxContext) => Span;
  export let ctxt: (self: Span) => SyntaxContext;
  export let eq_ctxt: (self: Span, other: Span) => boolean;
  export let with_parent: (self: Span, parent: LocalDefId | undefined) => Span;
  export let parent: (self: Span) => LocalDefId | undefined;
}

// `SyntaxContext` (`SpanData::ctxt`) and `LocalDefId` (within `SpanData::parent`) aren't orderable.
// If you want to order spans just on `lo`/`hi`, use explicit comparisons involving `Span::lo_hi`.
// Or you can wrap your span within `OrdSpan` which impls `PartialOrd`/`Ord` via `Span::lo_hi`.

// rustc-skip: compiler/rustc_span/src/span_encoding.rs:135 data inline-context format not used (Span is always interned, see PORT at top)
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:146 span inline-context format not used (Span is always interned, see PORT at top)
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:150 from_span inline-context format not used (Span is always interned, see PORT at top)
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:159 data inline-parent format not used (Span is always interned, see PORT at top)
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:170 span inline-parent format not used (Span is always interned, see PORT at top)
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:176 from_span inline-parent format not used (Span is always interned, see PORT at top)
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:185 data partially-interned format not used (Span is always interned, see PORT at top)
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:192 span partially-interned format not used (Span is always interned, see PORT at top)
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:198 from_span partially-interned format not used (Span is always interned, see PORT at top)

let DUMMY_SPAN_DATA: SpanData | undefined;
/** The `SpanData` of `DUMMY_SP` (created lazily: `SpanData` lives in lib.ts, an import cycle). */
function dummy_span_data(): SpanData {
  return (DUMMY_SPAN_DATA ??= new SpanData(0 as BytePos, 0 as BytePos, SyntaxContext.root(), undefined));
}

class Interned {
  constructor(readonly index: number) {}

  // rustc: compiler/rustc_span/src/span_encoding.rs:205 data
  data(): SpanData {
    // PORT: the dummy span (index 0) is answered without the session globals (see `interned_data`).
    return interned_data(this.index);
  }
  // rustc: compiler/rustc_span/src/span_encoding.rs:209 span
  static span(index: number): Span {
    return index as Span;
  }
  // rustc: compiler/rustc_span/src/span_encoding.rs:215 from_span
  static from_span(span: Span): Interned {
    return new Interned(span);
  }
}

/**
 * PORT: (perf) `Interned::from_span(span).data()` / `Interned(index).data()` without the `Interned` view object and the
 * `with_span_interner` closure: the hot `Span` accessors call this directly.
 */
function interned_data(index: number): SpanData {
  // PORT: the dummy span (index 0) is answered without the session globals, like upstream's
  // inline `DUMMY_SP`.
  if (index === 0) return dummy_span_data();
  return session_globals_get().span_interner.spans[index]!;
}

// `MAX_LEN`, `PARENT_TAG`, `LEN_INTERNED_MARKER`, `MAX_CTXT_OR_PARENT` and `CTXT_INTERNED_MARKER`
// only exist for the inline formats; see the PORT block at the top.

/// The dummy span has zero position, length, and context, and no parent.
export const DUMMY_SP = 0 as Span;

// rustc: compiler/rustc_span/src/span_encoding.rs:270 new
(Span as unknown as { new: typeof Span.new }).new = function (
  lo: BytePos,
  hi: BytePos,
  ctxt: SyntaxContext,
  parent: LocalDefId | undefined,
): Span {
  if (lo > hi) {
    [lo, hi] = [hi, lo];
  }

  // PORT: the inline formats are not used (see top); every span is interned, except the dummy
  // span, which (like upstream's inline encoding) needs no session globals.
  if (lo === 0 && hi === 0 && ctxt === SyntaxContext.root() && parent === undefined) {
    return DUMMY_SP;
  }
  // PORT: (perf) `with_span_interner(|interner| ..)` without the closure.
  const index = session_globals_get().span_interner.intern_parts(lo, hi, ctxt, parent);
  return Interned.span(index);
};

// rustc: compiler/rustc_span/src/span_encoding.rs:307 data
Span.data = function (self: Span): SpanData {
  const data = Span.data_untracked(self);
  if (data.parent !== undefined) {
    SPAN_TRACK.f(data.parent);
  }
  return data;
};

/// Internal function to translate between an encoded span and the expanded representation.
/// This function must not be used outside the incremental engine.
// rustc: compiler/rustc_span/src/span_encoding.rs:318 data_untracked
Span.data_untracked = function (self: Span): SpanData {
  return interned_data(self);
};

/// Returns `true` if this span comes from any kind of macro, desugaring or inlining.
// rustc: compiler/rustc_span/src/span_encoding.rs:330 from_expansion
Span.from_expansion = function (self: Span): boolean {
  const ctxt = interned_data(self).ctxt;
  return !SyntaxContext.is_root(ctxt);
};

/// Returns `true` if this is a dummy span with any hygienic context.
// rustc: compiler/rustc_span/src/span_encoding.rs:350 is_dummy
Span.is_dummy = function (self: Span): boolean {
  // Fully-interned or partially-interned format.
  const data = interned_data(self);
  return data.lo === 0 && data.hi === 0;
};

// rustc: compiler/rustc_span/src/span_encoding.rs:366 map_ctxt
Span.map_ctxt = function (self: Span, map: (ctxt: SyntaxContext) => SyntaxContext): Span {
  const data = interned_data(self);

  return data.with_ctxt(map(data.ctxt));
};

// Returns either syntactic context, if it can be retrieved without taking the interner lock,
// or an index into the interner if it cannot.
// rustc: compiler/rustc_span/src/span_encoding.rs:392 inline_ctxt
function inline_ctxt(self: Span): Result<SyntaxContext, number> {
  // PORT: every span is interned, so the context is never inline (but see `Span.ctxt` for the
  // dummy span).
  return Err(Interned.from_span(self).index);
}

/// This function is used as a fast path when decoding the full `SpanData` is not necessary.
/// It's a cut-down version of `data_untracked`.
// rustc: compiler/rustc_span/src/span_encoding.rs:406 ctxt
Span.ctxt = function (self: Span): SyntaxContext {
  // PORT: (perf) `inline_ctxt` always answers `Err(index)` (every span is interned), so its `Result` is not
  // allocated: this is the `Err(index) => Interned(index).data().ctxt` arm.
  return interned_data(self).ctxt;
};

// rustc: compiler/rustc_span/src/span_encoding.rs:412 eq_ctxt
Span.eq_ctxt = function (self: Span, other: Span): boolean {
  // PORT: (perf) `inline_ctxt` always answers `Err(index)` (every span is interned), so its `Result`s are not
  // allocated: this is the `(Err(a), Err(b))` arm.
  // If `inline_ctxt` returns `Ok` the context is <= MAX_CTXT_OR_PARENT.
  // If it returns `Err` the span is fully interned and the context
  // is > MAX_CTXT_OR_PARENT. As these do not overlap an `Ok` and `Err` result cannot
  // have an equal context.
  return interned_data(self).ctxt === interned_data(other).ctxt;
};

// rustc: compiler/rustc_span/src/span_encoding.rs:427 with_parent
Span.with_parent = function (self: Span, parent: LocalDefId | undefined): Span {
  const data = interned_data(self);

  if (data.parent !== undefined) {
    SPAN_TRACK.f(data.parent);
  }
  return data.with_parent(parent);
};

// rustc: compiler/rustc_span/src/span_encoding.rs:457 parent
Span.parent = function (self: Span): LocalDefId | undefined {
  return interned_data(self).parent;
};

// rustc-skip: compiler/rustc_span/src/span_encoding.rs:470 to_raw_span RawSpan only feeds StableHash (HashStable), out of scope until M5
// rustc-skip: compiler/rustc_span/src/span_encoding.rs:476 from_raw_span RawSpan only feeds StableHash (HashStable), out of scope until M5

/// Span wrapper that provides equality and ordering based only on the `lo`/`hi` fields. Exists
/// because `Span` doesn't impl `PartialOrd`/`Ord` due to the `ctxt` and `parent` fields being
/// unorderable. Useful when storing things in source code order, e.g. in a `BTreeMap<OrdSpan, T>`.
export class OrdSpan {
  constructor(readonly _0: Span) {}

  // rustc: compiler/rustc_span/src/span_encoding.rs:489 eq
  eq(rhs: OrdSpan): boolean {
    // Ignores `ctxt` and `parent` because they are unorderable.
    const [a_lo, a_hi] = Span.lo_hi(this._0);
    const [b_lo, b_hi] = Span.lo_hi(rhs._0);
    return a_lo === b_lo && a_hi === b_hi;
  }

  // rustc: compiler/rustc_span/src/span_encoding.rs:498 partial_cmp
  /** PORT: `Ordering` is `-1 | 0 | 1`; `Option<Ordering>` is `Ordering | undefined`. */
  partial_cmp(rhs: OrdSpan): -1 | 0 | 1 | undefined {
    return this.cmp(rhs);
  }

  // rustc: compiler/rustc_span/src/span_encoding.rs:504 cmp
  cmp(rhs: OrdSpan): -1 | 0 | 1 {
    // Ignores `ctxt` and `parent` because they are unorderable.
    const [a_lo, a_hi] = Span.lo_hi(this._0);
    const [b_lo, b_hi] = Span.lo_hi(rhs._0);
    // Tuple ordering: `lo` first, then `hi`.
    if (a_lo !== b_lo) return a_lo < b_lo ? -1 : 1;
    if (a_hi !== b_hi) return a_hi < b_hi ? -1 : 1;
    return 0;
  }

}

export const debug_OrdSpan = (v: OrdSpan, f: Fmt): string => debug_tuple(f, "OrdSpan", [debug_Span(v._0, f)]);

/** `FxIndexSet<SpanData>`: insertion-ordered set of `SpanData`, hashed on all four fields. */
export class SpanInterner {
  /**
   * PORT: open-addressing index over `spans`: slot `s` is `table[2 * s]` (index + 1, 0 = empty) and
   * `table[2 * s + 1]` (the entry's hash, `| 0`). (perf) The stored hash filters probes and rehashing without
   * reading the `SpanData` objects.
   */
  private table: Int32Array = new Int32Array(2 * 1024);

  constructor(readonly spans: SpanData[]) {}

  /** `#[derive(Default)]`. PORT: index 0 is pre-seeded with the dummy span's data (see top). */
  static default(): SpanInterner {
    const interner = new SpanInterner([]);
    interner.intern(dummy_span_data());
    return interner;
  }

  // rustc: compiler/rustc_span/src/span_encoding.rs:520 intern
  intern(span_data: SpanData): number {
    // `let (index, _) = self.spans.insert_full(*span_data);`
    const table = this.table;
    const mask = (table.length >> 1) - 1;
    const h = hash_span_data(span_data) | 0;
    let slot = h & mask;
    for (;;) {
      const entry = table[2 * slot]!;
      if (entry === 0) break;
      if (table[2 * slot + 1] === h && SpanData_eq(this.spans[entry - 1]!, span_data)) return entry - 1;
      slot = (slot + 1) & mask;
    }
    const index = this.spans.length;
    this.spans.push(span_data);
    table[2 * slot] = index + 1;
    table[2 * slot + 1] = h;
    if (this.spans.length * 4 > table.length) this.grow();
    return index;
  }

  /**
   * PORT: (perf) `intern(&SpanData { lo, hi, ctxt, parent })` that looks the fields up first and allocates the
   * `SpanData` only when it is new (most `Span::new` calls find an existing entry).
   */
  intern_parts(lo: BytePos, hi: BytePos, ctxt: SyntaxContext, parent: LocalDefId | undefined): number {
    const table = this.table;
    const mask = (table.length >> 1) - 1;
    const p = parent_index(parent);
    const h = hash_span_parts(lo, hi, ctxt, p) | 0;
    let slot = h & mask;
    for (;;) {
      const entry = table[2 * slot]!;
      if (entry === 0) break;
      if (table[2 * slot + 1] === h) {
        const d = this.spans[entry - 1]!;
        if (d.lo === lo && d.hi === hi && d.ctxt === ctxt && parent_index(d.parent) === p) return entry - 1;
      }
      slot = (slot + 1) & mask;
    }
    const index = this.spans.length;
    this.spans.push(new SpanData(lo, hi, ctxt, parent));
    table[2 * slot] = index + 1;
    table[2 * slot + 1] = h;
    if (this.spans.length * 4 > table.length) this.grow();
    return index;
  }

  private grow(): void {
    const old = this.table;
    const table = new Int32Array(old.length * 2);
    const mask = (table.length >> 1) - 1;
    for (let s = 0; s < old.length; s += 2) {
      const entry = old[s]!;
      if (entry === 0) continue;
      const h = old[s + 1]!;
      let slot = h & mask;
      while (table[2 * slot] !== 0) slot = (slot + 1) & mask;
      table[2 * slot] = entry;
      table[2 * slot + 1] = h;
    }
    this.table = table;
  }
}

function parent_index(parent: LocalDefId | undefined): number {
  // `DefIndex` values stay below 0xFFFF_FF00, so -1 cannot collide.
  return parent === undefined ? -1 : (parent as number);
}

function hash_span_data(d: SpanData): number {
  return hash_span_parts(d.lo, d.hi, d.ctxt, parent_index(d.parent));
}

function hash_span_parts(lo: number, hi: number, ctxt: number, parent: number): number {
  let h = Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ hi, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ ctxt, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15) ^ parent, 0x165667b1);
  return (h ^ (h >>> 16)) >>> 0;
}

/** `#[derive(PartialEq)] for SpanData`. */
export function SpanData_eq(a: SpanData, b: SpanData): boolean {
  return a.lo === b.lo && a.hi === b.hi && a.ctxt === b.ctxt && parent_index(a.parent) === parent_index(b.parent);
}

// If an interner exists, return it. Otherwise, prepare a fresh one.
// rustc: compiler/rustc_span/src/span_encoding.rs:528 with_span_interner
function with_span_interner<T>(f: (interner: SpanInterner) => T): T {
  return with_session_globals((session_globals) => f(session_globals.span_interner));
}

