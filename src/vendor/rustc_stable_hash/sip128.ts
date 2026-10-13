// Port of rustc-stable-hash =0.1.2 `src/sip128.rs`.
//
//! This is a copy of `core::hash::sip` adapted to providing 128 bit hashes.
//
// PORT: u64 arithmetic. Every u64 of the hash state is a pair of signed int32 numbers (low, high
// 32 bits) in plain object fields, and the SipHash rounds are written out on those pairs; a
// `bigint` state was measured at 1.3 MB/s of hashed input against 31 MB/s for the int32 pairs
// (bun, 2M 8-byte words, one c_round each: 12.2 s vs 0.44 s), and SipHash over 64-bit words is the
// hot path of every stable hash. u64 values cross the API as `bigint` (`write_u64`, the finished
// `SipHasher128Hash`), `usize`/`isize` as `number` (< 2^53).
// PORT: the buffer (`[MaybeUninit<u64>; 9]`) is a 72-byte `Uint8Array` read and written in
// little-endian order: the host's native order (`to_ne_bytes` = `to_le_bytes`, `to_le()` = identity),
// so the byte stream is exactly upstream's. `MaybeUninit` bytes start zeroed.
// PORT: `short_write<const LEN: usize>(bytes: [u8; LEN])` takes `(LEN, lo, hi)`: the integer whose
// `LEN` native-endian bytes upstream passes, as its low and high 32 bits (no array per write).

import { debug_int, debug_list, debug_struct, debug_tuple, type Debug, type Fmt } from "../../std/fmt.ts";
import { debug_strict_add, debug_strict_sub } from "./int_overflow.ts";
import { type ExtendedHasher, Hasher_provided } from "./stable_hasher.ts";

// The SipHash algorithm operates on 8-byte chunks.
const ELEM_SIZE = 8;

// Size of the buffer in number of elements, not including the spill.
//
// The selection of this size was guided by rustc-perf benchmark comparisons of
// different buffer sizes. It should be periodically reevaluated as the compiler
// implementation and input characteristics change.
//
// Using the same-sized buffer for everything we hash is a performance versus
// complexity tradeoff. The ideal buffer size, and whether buffering should even
// be used, depends on what is being hashed. It may be worth it to size the
// buffer appropriately (perhaps by making SipHasher128 generic over the buffer
// size) or disable buffering depending on what is being hashed. But at this
// time, we use the same buffer size for everything.
const BUFFER_CAPACITY = 8;

// Size of the buffer in bytes, not including the spill.
const BUFFER_SIZE = BUFFER_CAPACITY * ELEM_SIZE;

// Size of the buffer in number of elements, including the spill.
const BUFFER_WITH_SPILL_CAPACITY = BUFFER_CAPACITY + 1;

// Size of the buffer in bytes, including the spill.
const BUFFER_WITH_SPILL_SIZE = BUFFER_WITH_SPILL_CAPACITY * ELEM_SIZE;

// Index of the spill element in the buffer.
const BUFFER_SPILL_INDEX = BUFFER_WITH_SPILL_CAPACITY - 1;

const U32 = 0x1_0000_0000;
const MASK32 = 0xffff_ffffn;

/** The u64 of an int32 pair. */
function u64_of(lo: number, hi: number): bigint {
  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}

/// Hashing result of [`SipHasher128`]
// PORT: `SipHasher128Hash(pub [u64; 2])` -> `{ _0: [u64, u64] }` (u64 = bigint).
export interface SipHasher128Hash {
  readonly _0: readonly [bigint, bigint];
}
/** `#[derive(Debug)]`: `SipHasher128Hash([a, b])` */
export const debug_SipHasher128Hash: Debug<SipHasher128Hash> = (v, f) =>
  debug_tuple(f, "SipHasher128Hash", [debug_list(f, [debug_int(v._0[0], f), debug_int(v._0[1], f)])]);
export function SipHasher128Hash_eq(a: SipHasher128Hash, b: SipHasher128Hash): boolean {
  return a._0[0] === b._0[0] && a._0[1] === b._0[1];
}

// PORT: `#[derive(Clone, Copy)] #[repr(C)] struct State { v0, v2, v1, v3: u64 }`: each u64 is a
// (low, high) int32 pair, fields in upstream order.
class State {
  constructor(
    // v0, v2 and v1, v3 show up in pairs in the algorithm,
    // and simd implementations of SipHash will use vectors
    // of v02 and v13. By placing them in this order in the struct,
    // the compiler can pick up on just a few simd optimizations by itself.
    public v0l: number,
    public v0h: number,
    public v2l: number,
    public v2h: number,
    public v1l: number,
    public v1h: number,
    public v3l: number,
    public v3h: number,
  ) {}

  /** derive(Clone, Copy) */
  copy(): State {
    return new State(this.v0l, this.v0h, this.v2l, this.v2h, this.v1l, this.v1h, this.v3l, this.v3h);
  }

  /** `self.v3 ^= m` */
  xor_v3(lo: number, hi: number): void {
    this.v3l ^= lo;
    this.v3h ^= hi;
  }

  /** `self.v0 ^= m` */
  xor_v0(lo: number, hi: number): void {
    this.v0l ^= lo;
    this.v0h ^= hi;
  }
}

const debug_State: Debug<State> = (v, f) =>
  debug_struct(f, "State", [
    ["v0", String(u64_of(v.v0l, v.v0h))],
    ["v2", String(u64_of(v.v2l, v.v2h))],
    ["v1", String(u64_of(v.v1l, v.v1h))],
    ["v3", String(u64_of(v.v3l, v.v3h))],
  ]);

// `macro_rules! compress`: one SipRound on the state.
// PORT: `wrapping_add` on (lo, hi) pairs with an explicit carry; `rotate_left(n)` on pairs
// (`rotate_left(32)` swaps the halves).
function compress(s: State): void {
  let v0l = s.v0l, v0h = s.v0h, v1l = s.v1l, v1h = s.v1h, v2l = s.v2l, v2h = s.v2h, v3l = s.v3l, v3h = s.v3h;
  let l = 0, t = 0;
  // $v0 = $v0.wrapping_add($v1);
  l = (v0l + v1l) | 0;
  v0h = (v0h + v1h + ((l >>> 0) < (v0l >>> 0) ? 1 : 0)) | 0;
  v0l = l;
  // $v2 = $v2.wrapping_add($v3);
  l = (v2l + v3l) | 0;
  v2h = (v2h + v3h + ((l >>> 0) < (v2l >>> 0) ? 1 : 0)) | 0;
  v2l = l;
  // $v1 = $v1.rotate_left(13); $v1 ^= $v0;
  t = (v1h << 13) | (v1l >>> 19);
  v1l = ((v1l << 13) | (v1h >>> 19)) ^ v0l;
  v1h = t ^ v0h;
  // $v3 = $v3.rotate_left(16); $v3 ^= $v2;
  t = (v3h << 16) | (v3l >>> 16);
  v3l = ((v3l << 16) | (v3h >>> 16)) ^ v2l;
  v3h = t ^ v2h;
  // $v0 = $v0.rotate_left(32);
  t = v0l;
  v0l = v0h;
  v0h = t;

  // $v2 = $v2.wrapping_add($v1);
  l = (v2l + v1l) | 0;
  v2h = (v2h + v1h + ((l >>> 0) < (v2l >>> 0) ? 1 : 0)) | 0;
  v2l = l;
  // $v0 = $v0.wrapping_add($v3);
  l = (v0l + v3l) | 0;
  v0h = (v0h + v3h + ((l >>> 0) < (v0l >>> 0) ? 1 : 0)) | 0;
  v0l = l;
  // $v1 = $v1.rotate_left(17); $v1 ^= $v2;
  t = (v1h << 17) | (v1l >>> 15);
  v1l = ((v1l << 17) | (v1h >>> 15)) ^ v2l;
  v1h = t ^ v2h;
  // $v3 = $v3.rotate_left(21); $v3 ^= $v0;
  t = (v3h << 21) | (v3l >>> 11);
  v3l = ((v3l << 21) | (v3h >>> 11)) ^ v0l;
  v3h = t ^ v0h;
  // $v2 = $v2.rotate_left(32);
  t = v2l;
  v2l = v2h;
  v2h = t;
  s.v0l = v0l;
  s.v0h = v0h;
  s.v1l = v1l;
  s.v1h = v1h;
  s.v2l = v2l;
  s.v2h = v2h;
  s.v3l = v3l;
  s.v3h = v3h;
}

/** Writes the `len` (1, 2, 4 or 8) little-endian bytes of the integer `(lo, hi)` at `off`. */
function put_le(view: DataView, off: number, len: number, lo: number, hi: number): void {
  switch (len) {
    case 1:
      view.setUint8(off, lo & 0xff);
      return;
    case 2:
      view.setUint16(off, lo & 0xffff, true);
      return;
    case 4:
      view.setInt32(off, lo, true);
      return;
    default:
      view.setInt32(off, lo, true);
      view.setInt32(off + 4, hi, true);
  }
}

// Copies up to 8 bytes from source to destination. This performs better than
// `ptr::copy_nonoverlapping` on microbenchmarks and may perform better on real
// workloads since all of the copies have fixed sizes and avoid calling memcpy.
//
// This is specifically designed for copies of up to 8 bytes, because that's the
// maximum of number bytes needed to fill an 8-byte-sized element on which
// SipHash operates. Note that for variable-sized copies which are known to be
// less than 8 bytes, this function will perform more work than necessary unless
// the compiler is able to optimize the extra work away.
// PORT: raw pointers -> (array, offset) pairs.
// crate: rustc-stable-hash-0.1.2/src/sip128.rs:108 copy_nonoverlapping_small
function copy_nonoverlapping_small(src: Uint8Array, src_off: number, dst: Uint8Array, dst_off: number, count: number): void {
  // debug_assert!(count <= 8);

  if (count === 8) {
    dst.set(src.subarray(src_off, src_off + 8), dst_off);
    return;
  }

  let i = 0;
  if (debug_strict_add(i, 3) < count) {
    dst[dst_off + i] = src[src_off + i]!;
    dst[dst_off + i + 1] = src[src_off + i + 1]!;
    dst[dst_off + i + 2] = src[src_off + i + 2]!;
    dst[dst_off + i + 3] = src[src_off + i + 3]!;
    i = debug_strict_add(i, 4);
  }

  if (debug_strict_add(i, 1) < count) {
    dst[dst_off + i] = src[src_off + i]!;
    dst[dst_off + i + 1] = src[src_off + i + 1]!;
    i = debug_strict_add(i, 2);
  }

  if (i < count) {
    dst[dst_off + i] = src[src_off + i]!;
    i = debug_strict_add(i, 1);
  }

  // debug_assert_eq!(i, count);
}

// # Implementation
//
// This implementation uses buffering to reduce the hashing cost for inputs
// consisting of many small integers. Buffering simplifies the integration of
// integer input--the integer write function typically just appends to the
// buffer with a statically sized write, updates metadata, and returns.
//
// Buffering also prevents alternating between writes that do and do not trigger
// the hashing process. Only when the entire buffer is full do we transition
// into hashing. This allows us to keep the hash state in registers for longer,
// instead of loading and storing it before and after processing each element.
//
// When a write fills the buffer, a buffer processing function is invoked to
// hash all of the buffered input. The buffer processing functions are marked
// `#[inline(never)]` so that they aren't inlined into the append functions,
// which ensures the more frequently called append functions remain inlineable
// and don't include register pushing/popping that would only be made necessary
// by inclusion of the complex buffer processing path which uses those
// registers.
//
// The buffer includes a "spill"--an extra element at the end--which simplifies
// the integer write buffer processing path. The value that fills the buffer can
// be written with a statically sized write that may spill over into the spill.
// After the buffer is processed, the part of the value that spilled over can be
// written from the spill to the beginning of the buffer with another statically
// sized write. This write may copy more bytes than actually spilled over, but
// we maintain the metadata such that any extra copied bytes will be ignored by
// subsequent processing. Due to the static sizes, this scheme performs better
// than copying the exact number of bytes needed into the end and beginning of
// the buffer.
//
// The buffer is uninitialized, which improves performance, but may preclude
// efficient implementation of alternative approaches. The improvement is not so
// large that an alternative approach should be disregarded because it cannot be
// efficiently implemented with an uninitialized buffer. On the other hand, an
// uninitialized buffer may become more important should a larger one be used.
//
// # Platform Dependence
//
// The SipHash algorithm operates on byte sequences. It parses the input stream
// as 8-byte little-endian integers. Therefore, given the same byte sequence, it
// produces the same result on big- and little-endian hardware.
//
// However, the Hasher trait has methods which operate on multi-byte integers.
// How they are converted into byte sequences can be endian-dependent (by using
// native byte order) or independent (by consistently using either LE or BE byte
// order). It can also be `isize` and `usize` size dependent (by using the
// native size), or independent (by converting to a common size), supposing the
// values can be represented in 32 bits.
//
// In order to make `SipHasher128` consistent with `SipHasher` in libstd, we
// choose to do the integer to byte sequence conversion in the platform-
// dependent way. Clients can achieve platform-independent hashing by widening
// `isize` and `usize` integers to 64 bits on 32-bit systems and byte-swapping
// integers on big-endian systems before passing them to the writing functions.
// This causes the input byte sequence to look identical on big- and little-
// endian systems (supposing `isize` and `usize` values can be represented in 32
// bits), which ensures platform-independent results.
// PORT: `#[derive(Debug, Clone)] #[repr(C)] struct SipHasher128`: `buf` with its `DataView`.
export class SipHasher128 implements ExtendedHasher<SipHasher128Hash> {
  // The access pattern during hashing consists of accesses to `nbuf` and
  // `buf` until the buffer is full, followed by accesses to `state` and
  // `processed`, and then repetition of that pattern until hashing is done.
  // This is the basis for the ordering of fields below. However, in practice
  // the cache miss-rate for data access is extremely low regardless of order.
  private readonly view: DataView;
  constructor(
    public nbuf: number, // how many bytes in buf are valid
    public buf: Uint8Array, // unprocessed bytes le
    public state: State, // hash State
    public processed: number, // how many bytes we've processed
  ) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:197 new_with_keys
  /** PORT: the keys are u64 `bigint`s. */
  static new_with_keys(key0: bigint, key1: bigint): SipHasher128 {
    const k0l = Number(key0 & MASK32) | 0;
    const k0h = Number((key0 >> 32n) & MASK32) | 0;
    const k1l = Number(key1 & MASK32) | 0;
    const k1h = Number((key1 >> 32n) & MASK32) | 0;
    const hasher = new SipHasher128(
      0,
      // HACK: Manual MaybeUninit::uninit_array, use inline const with Rust 1.79
      new Uint8Array(BUFFER_WITH_SPILL_SIZE),
      new State(
        // v0: key0 ^ 0x736f6d6570736575,
        k0l ^ 0x70736575,
        k0h ^ 0x736f6d65,
        // v2: key0 ^ 0x6c7967656e657261,
        k0l ^ 0x6e657261,
        k0h ^ 0x6c796765,
        // The XOR with 0xee is only done on 128-bit algorithm version.
        // v1: key1 ^ (0x646f72616e646f6d ^ 0xee),
        k1l ^ (0x6e646f6d ^ 0xee),
        k1h ^ 0x646f7261,
        // v3: key1 ^ 0x7465646279746573,
        k1l ^ 0x79746573,
        k1h ^ 0x74656462,
      ),
      0,
    );

    // Initialize spill because we read from it in `short_write_process_buffer`.
    hasher.buf.fill(0, BUFFER_SPILL_INDEX * ELEM_SIZE, BUFFER_WITH_SPILL_SIZE);

    return hasher;
  }

  // A specialized write function for values with size <= 8 that should only
  // be called when the write would cause the buffer to fill.
  //
  // SAFETY: the write of `x` into `self.buf` starting at byte offset
  // `self.nbuf` must cause `self.buf` to become fully initialized (and not
  // overflow) if it wasn't already.
  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:229 short_write_process_buffer
  private short_write_process_buffer(LEN: number, lo: number, hi: number): void {
    const nbuf = this.nbuf;
    // debug_assert!(LEN <= 8);
    // debug_assert!(nbuf < BUFFER_SIZE);
    // debug_assert!(nbuf + LEN >= BUFFER_SIZE);
    // debug_assert!(nbuf + LEN < BUFFER_WITH_SPILL_SIZE);

    // Copy first part of input into end of buffer, possibly into spill
    // element. The memcpy call is optimized away because the size is known.
    put_le(this.view, nbuf, LEN, lo, hi);

    // Process buffer.
    const view = this.view;
    const state = this.state;
    for (let i = 0; i < BUFFER_CAPACITY; i++) {
      const el = view.getInt32(i * ELEM_SIZE, true);
      const eh = view.getInt32(i * ELEM_SIZE + 4, true);
      state.xor_v3(el, eh);
      Sip13Rounds.c_rounds(state);
      state.xor_v0(el, eh);
    }

    // Copy remaining input into start of buffer by copying LEN - 1
    // elements from spill (at most LEN - 1 bytes could have overflowed
    // into the spill). The memcpy call is optimized away because the size
    // is known. And the whole copy is optimized away for LEN == 1.
    const src = BUFFER_SPILL_INDEX * ELEM_SIZE;
    this.buf.copyWithin(0, src, src + LEN - 1);

    // This function should only be called when the write fills the buffer.
    // Therefore, when LEN == 1, the new `self.nbuf` must be zero.
    // LEN is statically known, so the branch is optimized away.
    this.nbuf = LEN === 1 ? 0 : debug_strict_sub(debug_strict_add(nbuf, LEN), BUFFER_SIZE);
    this.processed = debug_strict_add(this.processed, BUFFER_SIZE);
  }

  // A write function for byte slices.
  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:272 slice_write
  private slice_write(msg: Uint8Array): void {
    const length = msg.length;
    const nbuf = this.nbuf;
    // debug_assert!(nbuf < BUFFER_SIZE);

    if (debug_strict_add(nbuf, length) < BUFFER_SIZE) {
      if (length <= 8) {
        copy_nonoverlapping_small(msg, 0, this.buf, nbuf, length);
      } else {
        // This memcpy is *not* optimized away.
        this.buf.set(msg, nbuf);
      }

      this.nbuf = debug_strict_add(nbuf, length);

      return;
    }

    this.slice_write_process_buffer(msg);
  }

  // A write function for byte slices that should only be called when the
  // write would cause the buffer to fill.
  //
  // SAFETY: `self.buf` must be initialized up to the byte offset `self.nbuf`,
  // and `msg` must contain enough bytes to initialize the rest of the element
  // containing the byte offset `self.nbuf`.
  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:304 slice_write_process_buffer
  private slice_write_process_buffer(msg: Uint8Array): void {
    const length = msg.length;
    const nbuf = this.nbuf;
    // debug_assert!(nbuf < BUFFER_SIZE);
    // debug_assert!(nbuf + length >= BUFFER_SIZE);

    // Always copy first part of input into current element of buffer.
    // This function should only be called when the write fills the buffer,
    // so we know that there is enough input to fill the current element.
    const valid_in_elem = nbuf % ELEM_SIZE;
    const needed_in_elem = debug_strict_sub(ELEM_SIZE, valid_in_elem);

    copy_nonoverlapping_small(msg, 0, this.buf, nbuf, needed_in_elem);

    // Process buffer.

    // Using `nbuf / ELEM_SIZE + 1` rather than `(nbuf + needed_in_elem) /
    // ELEM_SIZE` to show the compiler that this loop's upper bound is > 0.
    // We know that is true, because last step ensured we have a full
    // element in the buffer.
    const last = debug_strict_add(Math.floor(nbuf / ELEM_SIZE), 1);

    const view = this.view;
    const state = this.state;
    for (let i = 0; i < last; i++) {
      const el = view.getInt32(i * ELEM_SIZE, true);
      const eh = view.getInt32(i * ELEM_SIZE + 4, true);
      state.xor_v3(el, eh);
      Sip13Rounds.c_rounds(state);
      state.xor_v0(el, eh);
    }

    // Process the remaining element-sized chunks of input.
    let processed = needed_in_elem;
    const input_left = debug_strict_sub(length, processed);
    const elems_left = Math.floor(input_left / ELEM_SIZE);
    const extra_bytes_left = input_left % ELEM_SIZE;

    for (let n = 0; n < elems_left; n++) {
      // `(msg.as_ptr().add(processed) as *const u64).read_unaligned().to_le()`
      const p = processed;
      const el = msg[p]! | (msg[p + 1]! << 8) | (msg[p + 2]! << 16) | (msg[p + 3]! << 24);
      const eh = msg[p + 4]! | (msg[p + 5]! << 8) | (msg[p + 6]! << 16) | (msg[p + 7]! << 24);
      state.xor_v3(el, eh);
      Sip13Rounds.c_rounds(state);
      state.xor_v0(el, eh);
      processed = debug_strict_add(processed, ELEM_SIZE);
    }

    // Copy remaining input into start of buffer.
    copy_nonoverlapping_small(msg, processed, this.buf, 0, extra_bytes_left);

    this.nbuf = extra_bytes_left;
    this.processed = debug_strict_add(this.processed, debug_strict_add(nbuf, processed));
  }

  // A function for finishing the hashing.
  //
  // SAFETY: `buf` must be initialized up to the byte offset `nbuf`.
  // PORT: `mut state: State` is passed by value: the caller passes a copy.
  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:368 finish128_inner
  private static finish128_inner(nbuf: number, buf: Uint8Array, state: State, processed: number): [bigint, bigint] {
    // debug_assert!(nbuf < BUFFER_SIZE);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Process full elements in buffer.
    const last = Math.floor(nbuf / ELEM_SIZE);

    for (let i = 0; i < last; i++) {
      const el = view.getInt32(i * ELEM_SIZE, true);
      const eh = view.getInt32(i * ELEM_SIZE + 4, true);
      state.xor_v3(el, eh);
      Sip13Rounds.c_rounds(state);
      state.xor_v0(el, eh);
    }

    // Get remaining partial element.
    let el = 0;
    let eh = 0;
    if (nbuf % ELEM_SIZE !== 0) {
      // Ensure element is initialized by writing zero bytes. At most
      // `ELEM_SIZE - 1` are required given the above check. It's safe
      // to write this many because we have the spill and we maintain
      // `self.nbuf` such that this write will start before the spill.
      buf.fill(0, nbuf, nbuf + ELEM_SIZE - 1);
      el = view.getInt32(last * ELEM_SIZE, true);
      eh = view.getInt32(last * ELEM_SIZE + 4, true);
    }

    // Finalize the hash.
    const length = debug_strict_add(processed, nbuf);
    // let b: u64 = ((length as u64 & 0xff) << 56) | elem;
    const bl = el;
    const bh = ((length % U32 & 0xff) << 24) | eh;

    state.xor_v3(bl, bh);
    Sip13Rounds.c_rounds(state);
    state.xor_v0(bl, bh);

    state.v2l ^= 0xee;
    Sip13Rounds.d_rounds(state);
    const l = u64_of(state.v0l ^ state.v1l ^ state.v2l ^ state.v3l, state.v0h ^ state.v1h ^ state.v2h ^ state.v3h);

    state.v1l ^= 0xdd;
    Sip13Rounds.d_rounds(state);
    const h = u64_of(state.v0l ^ state.v1l ^ state.v2l ^ state.v3l, state.v0h ^ state.v1h ^ state.v2h ^ state.v3h);

    return [l, h];
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:422 default
  static default(): SipHasher128 {
    return SipHasher128.new_with_keys(0n, 0n);
  }

  /** derive(Clone) */
  clone(): SipHasher128 {
    return new SipHasher128(this.nbuf, this.buf.slice(), this.state.copy(), this.processed);
  }

  // ---- impl ExtendedHasher for SipHasher128 ----

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:431 short_write
  short_write(LEN: number, lo: number, hi: number): void {
    const nbuf = this.nbuf;
    // debug_assert!(LEN <= 8);
    // debug_assert!(nbuf < BUFFER_SIZE);
    // debug_assert!(nbuf + LEN < BUFFER_WITH_SPILL_SIZE);

    if (debug_strict_add(nbuf, LEN) < BUFFER_SIZE) {
      // The memcpy call is optimized away because the size is known.
      put_le(this.view, nbuf, LEN, lo, hi);

      this.nbuf = debug_strict_add(nbuf, LEN);

      return;
    }

    this.short_write_process_buffer(LEN, lo, hi);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:453 finish
  /** `ExtendedHasher::finish(self)`: consumes the hasher (its buffer is clobbered). */
  finish(): SipHasher128Hash {
    return { _0: SipHasher128.finish128_inner(this.nbuf, this.buf, this.state.copy(), this.processed) };
  }

  // ---- impl Hasher for SipHasher128 ----

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:462 write_u8
  write_u8(i: number): void {
    this.short_write(1, i, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:467 write_u16
  write_u16(i: number): void {
    this.short_write(2, i, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:472 write_u32
  write_u32(i: number): void {
    this.short_write(4, i | 0, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:477 write_u64
  write_u64(i: bigint): void {
    this.short_write(8, Number(i & MASK32) | 0, Number((i >> 32n) & MASK32) | 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:482 write_usize
  write_usize(i: number): void {
    // PORT: the host's `usize` is 64 bits.
    this.short_write(8, i % U32 | 0, Math.floor(i / U32) | 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:487 write_i8
  write_i8(i: number): void {
    this.short_write(1, i & 0xff, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:492 write_i16
  write_i16(i: number): void {
    this.short_write(2, i & 0xffff, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:497 write_i32
  write_i32(i: number): void {
    this.short_write(4, i | 0, 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:502 write_i64
  write_i64(i: bigint): void {
    this.short_write(8, Number(i & MASK32) | 0, Number((i >> 32n) & MASK32) | 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:507 write_isize
  write_isize(i: number): void {
    // `(i as usize).to_ne_bytes()`: two's complement low / high words.
    this.short_write(8, i % U32 | 0, Math.floor(i / U32) | 0);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:512 write
  write(msg: Uint8Array): void {
    this.slice_write(msg);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:518 write_str
  /** `#[cfg(feature = "nightly")]` (rustc enables it). PORT: `s` is the UTF-8 bytes of the `str`. */
  write_str(s: Uint8Array): void {
    // This hasher works byte-wise, and `0xFF` cannot show up in a `str`,
    // so just hashing the one extra byte is enough to be prefix-free.
    this.write(s);
    this.write_u8(0xff);
  }

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:525 finish
  /** `Hasher::finish(&self) -> u64`. PORT: named `finish_u64` (the inherent `finish` is `ExtendedHasher::finish`). */
  finish_u64(): bigint {
    const buf = this.buf.slice();
    const [a, b] = SipHasher128.finish128_inner(this.nbuf, buf, this.state.copy(), this.processed);

    // Combining the two halves makes sure we get a good quality hash.
    return (a * 3n + b) & 0xffff_ffff_ffff_ffffn;
  }

  // Provided `std::hash::Hasher` methods SipHasher128 does not override.
  write_u128(i: bigint): void {
    Hasher_provided.write_u128(this, i);
  }
  write_i128(i: bigint): void {
    Hasher_provided.write_i128(this, i);
  }
  write_length_prefix(len: number): void {
    Hasher_provided.write_length_prefix(this, len);
  }
}

/** `#[derive(Debug)]` of `SipHasher128` (`buf` elements are `MaybeUninit<u64>`, whose Debug is its type name). */
export const debug_SipHasher128: Debug<SipHasher128> = (v, f: Fmt) =>
  debug_struct(f, "SipHasher128", [
    ["nbuf", debug_int(v.nbuf, f)],
    ["buf", debug_list(f, Array.from({ length: BUFFER_WITH_SPILL_CAPACITY }, () => "MaybeUninit<u64>"))],
    ["state", debug_State(v.state, f)],
    ["processed", debug_int(v.processed, f)],
  ]);

// `#[derive(Debug, Clone, Default)] struct Sip13Rounds;`
const Sip13Rounds = {
  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:541 c_rounds
  c_rounds(state: State): void {
    compress(state);
  },

  // crate: rustc-stable-hash-0.1.2/src/sip128.rs:546 d_rounds
  d_rounds(state: State): void {
    compress(state);
    compress(state);
    compress(state);
  },
};

