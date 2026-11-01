// Port of src/tools/miri/src/concurrency/vector_clock.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-race` (wave 36).
// Its types are generated into vector_clock.gen.ts (tools/codegen set `miri`); this module re-exports them and adds the
// methods, the manual impls (`Debug for VTimestamp`, `Clone for VClock`, `PartialOrd for VClock`, `Index for VClock`)
// and the derives codegen does not produce (`Default` / `PartialEq` of `VClock`).
//
// PORT (representation, lane miri-race): `VTimestamp { time_and_read_type: u32, span: Span }` is two `number`s (a `u32`
// and a branded `Span`), so no `bigint` is involved (decision C5 is about `u64`/`i64`; nothing here is wider than `u32`).
// `VClock(SmallVec<[VTimestamp; 4]>)` is the generated `{ _0: VTimestamp[] }`. `VTimestamp` is `Copy`: every array slot
// owns its own `VTimestamp` object, which is mutated in place through `index_mut` / `get_mut_with_min_len` (as the
// `&mut VTimestamp` of upstream), so every copy *into* a slot or a binding that is later mutated is a `clone_VTimestamp`
// (PORTING §8 "a Rust copy of a `Copy` object"). `VTimestamp.ZERO` is frozen: it is what `Index` returns for an absent
// entry, and must never be written through. A packed representation (one `Float64Array` of time/span pairs) would need
// a typemap change of `VClock._0`; see docs/handoff/miri-race.md.
// PORT: `u32` arithmetic: `time` is at most `u32::MAX / 2` (`encode_time_and_read_type` checks the `checked_mul(2)`), so
// `time_and_read_type` is in `0..=u32::MAX`; it is built with `+` (not `|`, which is 32-bit signed in JS) and read with
// `>>> 1` / `& 1`.
import { debug_NaReadType, type NaReadType } from "./data_race.ts";
import { VClock, VTimestamp, VectorIdx, clone_VTimestamp } from "./vector_clock.gen.ts";
import { DUMMY_SP, Span, debug_Span } from "../../rustc_span/lib.ts";
import { type Debug, debug_int, debug_struct } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
export * from "./vector_clock.gen.ts";

/** `core::cmp::Ordering` (`Less` = -1, `Equal` = 0, `Greater` = 1). */
export type Ordering = -1 | 0 | 1;

declare module "./vector_clock.gen.ts" {
  interface VectorIdx {
    // concurrency/vector_clock.rs:20
    to_u32(): number;
    // impl Idx for VectorIdx: concurrency/vector_clock.rs:32
    index(): number;
  }
  namespace VectorIdx {
    // impl Idx for VectorIdx: concurrency/vector_clock.rs:27
    function new_(idx: number): VectorIdx;
    export { new_ as new };
    // impl From<u32> for VectorIdx: concurrency/vector_clock.rs:39
    export let from: (id: number) => VectorIdx;
  }
}
declare module "./vector_clock.gen.ts" {
  interface VTimestamp {
    // concurrency/vector_clock.rs:88
    time(): number;
    // concurrency/vector_clock.rs:93
    set_time(time: number): void;
    // concurrency/vector_clock.rs:98
    read_type(): NaReadType;
    // concurrency/vector_clock.rs:103
    set_read_type(read_type: NaReadType): void;
  }
  namespace VTimestamp {
    // concurrency/vector_clock.rs:70
    export let ZERO: VTimestamp;
    // concurrency/vector_clock.rs:73
    export let encode_time_and_read_type: (time: number, read_type: NaReadType) => number;
    // concurrency/vector_clock.rs:83
    function new_(time: number, read_type: NaReadType, span: Span): VTimestamp;
    export { new_ as new };
  }
}
declare module "./vector_clock.gen.ts" {
  interface VClock {
    // concurrency/vector_clock.rs:159
    as_slice(): readonly VTimestamp[];
    // concurrency/vector_clock.rs:165
    index_mut(index: VectorIdx): VTimestamp;
    // concurrency/vector_clock.rs:173
    get_mut_with_min_len(min_len: number): VTimestamp[];
    // concurrency/vector_clock.rs:184
    increment_index(idx: VectorIdx, current_span: Span): void;
    // concurrency/vector_clock.rs:197
    join(other: VClock): void;
    // concurrency/vector_clock.rs:209
    set_at_index(other: VClock, idx: VectorIdx): void;
    // concurrency/vector_clock.rs:235
    set_zero_vector(): void;
    // impl Clone for VClock: concurrency/vector_clock.rs:249
    clone_from(source: VClock): void;
    // impl PartialOrd for VClock: concurrency/vector_clock.rs:257
    partial_cmp(other: VClock): Ordering | undefined;
    // concurrency/vector_clock.rs:315
    lt(other: VClock): boolean;
    // concurrency/vector_clock.rs:347
    le(other: VClock): boolean;
    // concurrency/vector_clock.rs:369
    gt(other: VClock): boolean;
    // concurrency/vector_clock.rs:401
    ge(other: VClock): boolean;
    // impl Index<VectorIdx> for VClock: concurrency/vector_clock.rs:428
    index(index: VectorIdx): VTimestamp;
  }
  namespace VClock {
    // concurrency/vector_clock.rs:147
    export let new_with_index: (index: VectorIdx, timestamp: VTimestamp) => VClock;
    /** `#[derive(Default)]` (concurrency/vector_clock.rs:141): the empty clock. */
    function default_(): VClock;
    export { default_ as default };
  }
}

/// A vector clock index, this is associated with a thread id
/// but in some cases one vector index may be shared with
/// multiple thread ids if it's safe to do so.
// PORT (lane miri-race): `VectorIdx(u32)` is the generated class; `Idx::new` / `From<u32>` return one interned instance per
// value, so `===` is the derived `Eq` for every `VectorIdx` they make (the `FxHashSet<VectorIdx>` of `GlobalState` relies on
// it, data_race.ts `canon`). The generated `clone_VectorIdx` makes a fresh object: compare those with `index()`.
const VECTOR_IDX: VectorIdx[] = [];
function interned_VectorIdx(id: number): VectorIdx {
  let v = VECTOR_IDX[id];
  if (v === undefined) {
    v = new VectorIdx(id);
    VECTOR_IDX[id] = v;
  }
  return v;
}

// #[inline(always)]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:20 to_u32
VectorIdx.prototype.to_u32 = function (this: VectorIdx): number {
  return this._0;
};

// impl Idx for VectorIdx
// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:27 new
(VectorIdx as unknown as { new: (idx: number) => VectorIdx }).new = function (idx: number): VectorIdx {
  // `u32::try_from(idx).unwrap()`
  if (!(idx >= 0 && idx <= 0xffffffff)) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return interned_VectorIdx(idx);
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:32 index
VectorIdx.prototype.index = function (this: VectorIdx): number {
  // `usize::try_from(self.0).unwrap()` (a `u32` always fits)
  return this._0;
};

// impl From<u32> for VectorIdx
// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:39 from
VectorIdx.from = function (id: number): VectorIdx {
  return interned_VectorIdx(id);
};

/// The size of the vector clock to store inline.
/// Clock vectors larger than this will be stored on the heap.
// PORT: `SmallVec`'s inline capacity has no TS analogue (an array either way); kept for reference.
export const SMALL_VECTOR = 4;

// impl Debug for VTimestamp
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:60 fmt
export const debug_VTimestamp: Debug<VTimestamp> = (v, f) =>
  debug_struct(f, "VTimestamp", [
    ["time", debug_int(v.time(), f)],
    ["read_type", debug_NaReadType(v.read_type(), f)],
    ["span", debug_Span(v.span, f)],
  ]);

// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:73 encode_time_and_read_type
VTimestamp.encode_time_and_read_type = function (time: number, read_type: NaReadType): number {
  let read_type_bit: number;
  switch (read_type) {
    case "Read":
      read_type_bit = 0;
      break;
    case "Retag":
      read_type_bit = 1;
      break;
  }
  // Put the `read_type` in the lowest bit and `time` in the rest
  // `read_type_bit | time.checked_mul(2).expect("Vector clock overflow")`
  const time2 = time * 2;
  if (time2 > 0xffffffff) panic("Vector clock overflow");
  return read_type_bit + time2;
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:83 new
(VTimestamp as unknown as { new: (time: number, read_type: NaReadType, span: Span) => VTimestamp }).new = function (
  time: number,
  read_type: NaReadType,
  span: Span,
): VTimestamp {
  return new VTimestamp(VTimestamp.encode_time_and_read_type(time, read_type), span);
};

// `pub const ZERO: VTimestamp` (concurrency/vector_clock.rs:70)
// PORT: frozen (module header): `Index` hands it out for absent entries; copies of it are `clone_VTimestamp`.
VTimestamp.ZERO = Object.freeze(VTimestamp.new(0, "Read", DUMMY_SP)) as VTimestamp;

// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:88 time
VTimestamp.prototype.time = function (this: VTimestamp): number {
  // `self.time_and_read_type.shr(1)`
  return this.time_and_read_type >>> 1;
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:93 set_time
VTimestamp.prototype.set_time = function (this: VTimestamp, time: number): void {
  this.time_and_read_type = VTimestamp.encode_time_and_read_type(time, this.read_type());
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:98 read_type
VTimestamp.prototype.read_type = function (this: VTimestamp): NaReadType {
  return (this.time_and_read_type & 1) === 0 ? "Read" : "Retag";
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:103 set_read_type
VTimestamp.prototype.set_read_type = function (this: VTimestamp, read_type: NaReadType): void {
  this.time_and_read_type = VTimestamp.encode_time_and_read_type(this.time(), read_type);
};

// impl PartialEq for VTimestamp
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:109 eq
export function VTimestamp_eq(self: VTimestamp, other: VTimestamp): boolean {
  return self.time() === other.time();
}

// impl Eq for VTimestamp {}

// impl PartialOrd for VTimestamp
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:117 partial_cmp
export function VTimestamp_partial_cmp(self: VTimestamp, other: VTimestamp): Ordering | undefined {
  return VTimestamp_cmp(self, other);
}

// impl Ord for VTimestamp
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:123 cmp
export function VTimestamp_cmp(self: VTimestamp, other: VTimestamp): Ordering {
  // `self.time().cmp(&other.time())`
  const l = self.time();
  const r = other.time();
  return l < r ? -1 : l > r ? 1 : 0;
}

/// A vector clock for detecting data-races, this is conceptually
/// a map from a vector index (and thus a thread id) to a timestamp.
/// The compare operations require that the invariant that the last
/// element in the internal timestamp slice must not be a 0, hence
/// all zero vector clocks are always represented by the empty slice;
/// and allows for the implementation of compare operations to short
/// circuit the calculation and return the correct result faster,
/// also this means that there is only one unique valid length
/// for each set of vector clock values and hence the PartialEq
/// and Eq derivations are correct.
///
/// This means we cannot represent a clock where the last entry is a timestamp-0 read that occurs
/// because of a retag. That's fine, all it does is risk wrong diagnostics in a extreme corner case.
// `#[derive(PartialEq, Eq, Default, Debug)]`: Debug is generated (vector_clock.gen.ts); Default and PartialEq follow.

/** `#[derive(Default)]` of `VClock`: `VClock(SmallVec::new())`. */
(VClock as unknown as { default: () => VClock }).default = function (): VClock {
  return new VClock([]);
};

/** `#[derive(PartialEq)]` of `VClock`: the `SmallVec`s are equal (same length, elementwise `VTimestamp::eq`). */
export function VClock_eq(a: VClock, b: VClock): boolean {
  const l = a._0;
  const r = b._0;
  if (l.length !== r.length) return false;
  for (let i = 0; i < l.length; i++) {
    if (!VTimestamp_eq(l[i]!, r[i]!)) return false;
  }
  return true;
}

/// Create a new vector clock containing all zeros except
/// for a value at the given index
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:147 new_with_index
VClock.new_with_index = function (index: VectorIdx, timestamp: VTimestamp): VClock {
  if (timestamp.time() === 0) {
    return VClock.default();
  }
  const len = index.index() + 1;
  // `smallvec::smallvec![VTimestamp::ZERO; len]`
  const vec: VTimestamp[] = new Array<VTimestamp>(len);
  for (let i = 0; i < len; i++) vec[i] = clone_VTimestamp(VTimestamp.ZERO);
  vec[index.index()] = clone_VTimestamp(timestamp);
  return new VClock(vec);
};

/// Load the internal timestamp slice in the vector clock
// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:159 as_slice
VClock.prototype.as_slice = function (this: VClock): readonly VTimestamp[] {
  // debug_assert!(self.0.last().is_none_or(|t| t.time() != 0));
  return this._0;
};

// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:165 index_mut
VClock.prototype.index_mut = function (this: VClock, index: VectorIdx): VTimestamp {
  return unwrap(this._0[index.to_u32()]);
};

/// Get a mutable slice to the internal vector with minimum `min_len`
/// elements. To preserve invariants, the caller must modify
/// the `min_len`-1 nth element to a non-zero value
// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:173 get_mut_with_min_len
VClock.prototype.get_mut_with_min_len = function (this: VClock, min_len: number): VTimestamp[] {
  const v = this._0;
  if (v.length < min_len) {
    // `self.0.resize(min_len, VTimestamp::ZERO)`
    while (v.length < min_len) v.push(clone_VTimestamp(VTimestamp.ZERO));
  }
  assert(v.length >= min_len, "assertion failed: self.0.len() >= min_len");
  return v;
};

/// Increment the vector clock at a known index
/// this will panic if the vector index overflows
// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:184 increment_index
VClock.prototype.increment_index = function (this: VClock, idx_: VectorIdx, current_span: Span): void {
  const idx = idx_.index();
  const mut_slice = this.get_mut_with_min_len(idx + 1);
  const idx_ref = mut_slice[idx]!;
  // `idx_ref.time().checked_add(1).expect("Vector clock overflow")`: `time() <= u32::MAX / 2`, so the add never
  // overflows a `u32`; `set_time`'s `checked_mul(2)` reports the overflow.
  idx_ref.set_time(idx_ref.time() + 1);
  if (!Span.is_dummy(current_span)) {
    idx_ref.span = current_span;
  }
};

// Join the two vector clocks together, this
// sets each vector element to the maximum value
// of that element in either of the two source elements.
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:197 join
VClock.prototype.join = function (this: VClock, other: VClock): void {
  const rhs_slice = other.as_slice();
  const lhs_slice = this.get_mut_with_min_len(rhs_slice.length);
  // `lhs_slice.iter_mut().zip(rhs_slice.iter())`
  const n = Math.min(lhs_slice.length, rhs_slice.length);
  for (let i = 0; i < n; i++) {
    const l = lhs_slice[i]!;
    const r = rhs_slice[i]!;
    const l_span = l.span;
    const r_span = r.span;
    // `*l = r.max(*l)`: `Ord::max` returns its argument (`*l`) unless `r` is greater.
    if (VTimestamp_cmp(r, l) === 1) {
      l.time_and_read_type = r.time_and_read_type;
      l.span = r.span;
    }
    l.span = Span.substitute_dummy(Span.substitute_dummy(l.span, r_span), l_span);
  }
};

/// Set the element at the current index of the vector. May only increase elements.
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:209 set_at_index
VClock.prototype.set_at_index = function (this: VClock, other: VClock, idx: VectorIdx): void {
  const new_timestamp = other.index(idx);
  // Setting to 0 is different, since the last element cannot be 0.
  if (new_timestamp.time() === 0) {
    if (idx.index() >= this._0.length) {
      // This index does not even exist yet in our clock. Just do nothing.
      return;
    }
    // This changes an existing element. Since it can only increase, that
    // can never make the last element 0.
  }

  const mut_slice = this.get_mut_with_min_len(idx.index() + 1);
  const mut_timestamp = mut_slice[idx.index()]!;

  const prev_span = mut_timestamp.span;

  assert(VTimestamp_cmp(mut_timestamp, new_timestamp) !== 1, "set_at_index: may only increase the timestamp");
  // `*mut_timestamp = new_timestamp`
  mut_timestamp.time_and_read_type = new_timestamp.time_and_read_type;
  mut_timestamp.span = new_timestamp.span;

  mut_timestamp.span = Span.substitute_dummy(mut_timestamp.span, prev_span);
};

/// Set the vector to the all-zero vector
// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:235 set_zero_vector
VClock.prototype.set_zero_vector = function (this: VClock): void {
  this._0.length = 0;
};

// impl Clone for VClock
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:241 clone
export function clone_VClock(v: VClock): VClock {
  // `VClock(self.0.clone())`
  return new VClock(v._0.map(clone_VTimestamp));
}

// Optimized clone-from, can be removed
// and replaced with a derive once a similar
// optimization is inserted into SmallVec's
// clone implementation.
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:249 clone_from
VClock.prototype.clone_from = function (this: VClock, source: VClock): void {
  const source_slice = source.as_slice();
  // `self.0.clear(); self.0.extend_from_slice(source_slice)`
  // PORT: the slots already allocated are reused (their values overwritten), as the `SmallVec`'s buffer is upstream.
  const v = this._0;
  const n = source_slice.length;
  const reuse = Math.min(v.length, n);
  for (let i = 0; i < reuse; i++) {
    const d = v[i]!;
    const s = source_slice[i]!;
    d.time_and_read_type = s.time_and_read_type;
    d.span = s.span;
  }
  v.length = reuse;
  for (let i = reuse; i < n; i++) v.push(clone_VTimestamp(source_slice[i]!));
};

// impl PartialOrd for VClock
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:257 partial_cmp
VClock.prototype.partial_cmp = function (this: VClock, other: VClock): Ordering | undefined {
  // Load the values as slices
  const lhs_slice = this.as_slice();
  const rhs_slice = other.as_slice();

  // Iterate through the combined vector slice continuously updating
  // the value of `order` to the current comparison of the vector from
  // index 0 to the currently checked index.
  // An Equal ordering can be converted into Less or Greater ordering
  // on finding an element that is less than or greater than the other
  // but if one Greater and one Less element-wise comparison is found
  // then no ordering is possible and so directly return an ordering
  // of None.
  const n = Math.min(lhs_slice.length, rhs_slice.length);
  let order: Ordering = n > 0 ? VTimestamp_cmp(lhs_slice[0]!, rhs_slice[0]!) : 0;
  for (let i = 1; i < n; i++) {
    const l = lhs_slice[i]!;
    const r = rhs_slice[i]!;
    switch (order) {
      case 0:
        order = VTimestamp_cmp(l, r);
        break;
      case -1:
        if (VTimestamp_cmp(l, r) === 1) {
          return undefined;
        }
        break;
      case 1:
        if (VTimestamp_cmp(l, r) === -1) {
          return undefined;
        }
        break;
    }
  }

  // Now test if either left or right have trailing elements,
  // by the invariant the trailing elements have at least 1
  // non zero value, so no additional calculation is required
  // to determine the result of the PartialOrder.
  const l_len = lhs_slice.length;
  const r_len = rhs_slice.length;
  if (l_len === r_len) {
    // Equal means no additional elements: return current order
    return order;
  } else if (l_len < r_len) {
    // Right has at least 1 element > than the implicit 0,
    // so the only valid values are Ordering::Less or None.
    switch (order) {
      case -1:
      case 0:
        return -1;
      case 1:
        return undefined;
    }
  } else {
    // Left has at least 1 element > than the implicit 0,
    // so the only valid values are Ordering::Greater or None.
    switch (order) {
      case 1:
      case 0:
        return 1;
      case -1:
        return undefined;
    }
  }
};

// rustc: src/tools/miri/src/concurrency/vector_clock.rs:315 lt
VClock.prototype.lt = function (this: VClock, other: VClock): boolean {
  // Load the values as slices
  const lhs_slice = this.as_slice();
  const rhs_slice = other.as_slice();

  // If l_len > r_len then at least one element
  // in l_len is > than r_len, therefore the result
  // is either Some(Greater) or None, so return false
  // early.
  const l_len = lhs_slice.length;
  const r_len = rhs_slice.length;
  if (l_len <= r_len) {
    // If any elements on the left are greater than the right
    // then the result is None or Some(Greater), both of which
    // return false, the earlier test asserts that no elements in the
    // extended tail violate this assumption. Otherwise l <= r, finally
    // the case where the values are potentially equal needs to be considered
    // and false returned as well
    let equal = l_len === r_len;
    for (let i = 0; i < l_len; i++) {
      const l = lhs_slice[i]!.time();
      const r = rhs_slice[i]!.time();
      if (l > r) {
        return false;
      } else if (l < r) {
        equal = false;
      }
    }
    return !equal;
  } else {
    return false;
  }
};

// rustc: src/tools/miri/src/concurrency/vector_clock.rs:347 le
VClock.prototype.le = function (this: VClock, other: VClock): boolean {
  // Load the values as slices
  const lhs_slice = this.as_slice();
  const rhs_slice = other.as_slice();

  // If l_len > r_len then at least one element
  // in l_len is > than r_len, therefore the result
  // is either Some(Greater) or None, so return false
  // early.
  const l_len = lhs_slice.length;
  const r_len = rhs_slice.length;
  if (l_len <= r_len) {
    // If any elements on the left are greater than the right
    // then the result is None or Some(Greater), both of which
    // return false, the earlier test asserts that no elements in the
    // extended tail violate this assumption. Otherwise l <= r
    // `!lhs_slice.iter().zip(rhs_slice.iter()).any(|(&l, &r)| l > r)`
    for (let i = 0; i < l_len; i++) {
      if (lhs_slice[i]!.time() > rhs_slice[i]!.time()) return false;
    }
    return true;
  } else {
    return false;
  }
};

// rustc: src/tools/miri/src/concurrency/vector_clock.rs:369 gt
VClock.prototype.gt = function (this: VClock, other: VClock): boolean {
  // Load the values as slices
  const lhs_slice = this.as_slice();
  const rhs_slice = other.as_slice();

  // If r_len > l_len then at least one element
  // in r_len is > than l_len, therefore the result
  // is either Some(Less) or None, so return false
  // early.
  const l_len = lhs_slice.length;
  const r_len = rhs_slice.length;
  if (l_len >= r_len) {
    // If any elements on the left are less than the right
    // then the result is None or Some(Less), both of which
    // return false, the earlier test asserts that no elements in the
    // extended tail violate this assumption. Otherwise l >=, finally
    // the case where the values are potentially equal needs to be considered
    // and false returned as well
    let equal = l_len === r_len;
    for (let i = 0; i < r_len; i++) {
      const l = lhs_slice[i]!.time();
      const r = rhs_slice[i]!.time();
      if (l < r) {
        return false;
      } else if (l > r) {
        equal = false;
      }
    }
    return !equal;
  } else {
    return false;
  }
};

// rustc: src/tools/miri/src/concurrency/vector_clock.rs:401 ge
VClock.prototype.ge = function (this: VClock, other: VClock): boolean {
  // Load the values as slices
  const lhs_slice = this.as_slice();
  const rhs_slice = other.as_slice();

  // If r_len > l_len then at least one element
  // in r_len is > than l_len, therefore the result
  // is either Some(Less) or None, so return false
  // early.
  const l_len = lhs_slice.length;
  const r_len = rhs_slice.length;
  if (l_len >= r_len) {
    // If any elements on the left are less than the right
    // then the result is None or Some(Less), both of which
    // return false, the earlier test asserts that no elements in the
    // extended tail violate this assumption. Otherwise l >= r
    // `!lhs_slice.iter().zip(rhs_slice.iter()).any(|(&l, &r)| l < r)`
    for (let i = 0; i < r_len; i++) {
      if (lhs_slice[i]!.time() < rhs_slice[i]!.time()) return false;
    }
    return true;
  } else {
    return false;
  }
};

// impl Index<VectorIdx> for VClock
// #[inline]
// rustc: src/tools/miri/src/concurrency/vector_clock.rs:428 index
VClock.prototype.index = function (this: VClock, index: VectorIdx): VTimestamp {
  return this.as_slice()[index.to_u32()] ?? VTimestamp.ZERO;
};

// #[cfg(test)] mod tests (concurrency/vector_clock.rs:437): ported in vector_clock.test.ts.
