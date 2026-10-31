// Port of library/proc_macro/src/bridge/buffer.rs
//
//! Buffer management for same-process client<->server communication.
//
// PORT: `Buffer` is `#[repr(C)] { data: *mut u8, len, capacity, reserve, drop }`. Here `data` is a `Uint8Array` view
// of at least `capacity` bytes (the allocation `data` points to); `reserve` / `drop` are the owner's functions. A
// buffer whose memory lives in a proc-macro dylib (D7, lane pm-host) is a `Buffer` whose `data` views the native
// allocation and whose `reserve` / `drop` call the dylib's `extern "C"` fn pointers through the FFI edge.
//
// PORT: JS has no destructors. `impl Drop for Buffer` is the method `drop_()` (the field `drop` keeps its `repr(C)`
// name); code that upstream drops a `Buffer` implicitly calls `drop_()` where that drop matters (a buffer owned by
// the other side of the bridge), each with a `// PORT:` note.

import { panic } from "../../std/panic.ts";

// std-type: library/proc_macro/src/bridge/buffer.rs:8 Buffer
export class Buffer {
  constructor(
    public data: Uint8Array,
    public len: number,
    public capacity: number,
    public reserve: (b: Buffer, additional: number) => Buffer,
    public drop: (b: Buffer) => void,
  ) {}

  // impl Default for Buffer
  // std: library/proc_macro/src/bridge/buffer.rs:21 default
  static default_(): Buffer {
    return Buffer.from(vec_new());
  }

  // impl Deref for Buffer { type Target = [u8]; }
  // std: library/proc_macro/src/bridge/buffer.rs:29 deref
  deref(): Uint8Array {
    return this.data.subarray(0, this.len);
  }

  // std: library/proc_macro/src/bridge/buffer.rs:36 new
  static new(): Buffer {
    return Buffer.default_();
  }

  // std: library/proc_macro/src/bridge/buffer.rs:41 clear
  clear(): void {
    this.len = 0;
  }

  // std: library/proc_macro/src/bridge/buffer.rs:46 take
  take(): Buffer {
    // `mem::take(self)`: the old value moves out, `*self` becomes `Buffer::default()`.
    const b = new Buffer(this.data, this.len, this.capacity, this.reserve, this.drop);
    this.assign(Buffer.default_());
    return b;
  }

  /** PORT: `*self = b` (a move into the place `self`): `self` takes `b`'s fields. */
  assign(b: Buffer): void {
    this.data = b.data;
    this.len = b.len;
    this.capacity = b.capacity;
    this.reserve = b.reserve;
    this.drop = b.drop;
  }

  // We have the array method separate from extending from a slice. This is
  // because in the case of small arrays, codegen can be more efficient
  // (avoiding a memmove call). With extend_from_slice, LLVM at least
  // currently is not able to make that optimization.
  // std: library/proc_macro/src/bridge/buffer.rs:55 extend_from_array
  extend_from_array(xs: Uint8Array): void {
    if (xs.length > this.capacity - this.len) {
      const b = this.take();
      this.assign(b.reserve(b, xs.length));
    }
    this.data.set(xs, this.len);
    this.len += xs.length;
  }

  // std: library/proc_macro/src/bridge/buffer.rs:67 extend_from_slice
  extend_from_slice(xs: Uint8Array): void {
    if (xs.length > this.capacity - this.len) {
      const b = this.take();
      this.assign(b.reserve(b, xs.length));
    }
    this.data.set(xs, this.len);
    this.len += xs.length;
  }

  // std: library/proc_macro/src/bridge/buffer.rs:79 push
  push(v: number): void {
    // The code here is taken from Vec::push, and we know that reserve()
    // will panic if we're exceeding isize::MAX bytes and so there's no need
    // to check for overflow.
    if (this.len === this.capacity) {
      const b = this.take();
      this.assign(b.reserve(b, 1));
    }
    this.data[this.len] = v;
    this.len += 1;
  }

  // impl Drop for Buffer
  // std: library/proc_macro/src/bridge/buffer.rs:96 drop
  // PORT: named `drop_` (the `drop` field holds the owner's fn pointer).
  drop_(): void {
    const b = this.take();
    b.drop(b);
  }

  // impl From<Vec<u8>> for Buffer
  // std: library/proc_macro/src/bridge/buffer.rs:103 from
  static from(v: VecU8): Buffer {
    const [data, len, capacity] = vec_into_raw_parts(v);

    // This utility function is nested in here because it can *only*
    // be safely called on `Buffer`s created by *this* `proc_macro`.
    // std: library/proc_macro/src/bridge/buffer.rs:108 to_vec
    function to_vec(b: Buffer): VecU8 {
      return vec_from_raw_parts(b.data, b.len, b.capacity);
    }

    // std: library/proc_macro/src/bridge/buffer.rs:115 reserve
    function reserve(b: Buffer, additional: number): Buffer {
      const v = to_vec(b);
      vec_reserve(v, additional);
      return Buffer.from(v);
    }

    // std: library/proc_macro/src/bridge/buffer.rs:121 drop
    function drop(b: Buffer): void {
      // `mem::drop(to_vec(b))`: the allocation is garbage-collected.
      void to_vec(b);
    }

    return new Buffer(data, len, capacity, reserve, drop);
  }
}

// ---- `Vec<u8>` (library/alloc), only as far as `Buffer` uses it ----

/**
 * PORT: `Vec<u8>` as its raw parts: `data` is the allocation (`data.length === capacity`), `len` the initialised
 * prefix.
 */
export interface VecU8 {
  data: Uint8Array;
  len: number;
  capacity: number;
}

/** `Vec::new()` / `vec![]`: no allocation, capacity 0. */
export function vec_new(): VecU8 {
  return { data: new Uint8Array(0), len: 0, capacity: 0 };
}

/** `Vec::<u8>::from(bytes)`: an exact-capacity copy. */
export function vec_from_slice(xs: Uint8Array): VecU8 {
  return { data: xs.slice(), len: xs.length, capacity: xs.length };
}

/** `Vec::into_raw_parts` */
function vec_into_raw_parts(v: VecU8): [Uint8Array, number, number] {
  return [v.data, v.len, v.capacity];
}

/** `Vec::from_raw_parts` */
function vec_from_raw_parts(data: Uint8Array, len: number, capacity: number): VecU8 {
  return { data, len, capacity };
}

/**
 * `Vec::<u8>::reserve(additional)`.
 * PORT: library/alloc/src/raw_vec/mod.rs `RawVecInner::reserve` → `grow_amortized`: nothing if
 * `capacity - len >= additional`; else `required = len + additional` (overflow: "capacity overflow"), the new
 * capacity is `max(capacity * 2, required, MIN_NON_ZERO_CAP)` with `MIN_NON_ZERO_CAP = 8` for 1-byte elements.
 * Allocations over `isize::MAX` cannot happen here (a JS typed array is far smaller).
 */
function vec_reserve(v: VecU8, additional: number): void {
  if (v.capacity - v.len >= additional) return;
  const required = v.len + additional;
  if (!Number.isSafeInteger(required)) panic("capacity overflow");
  let cap = Math.max(v.capacity * 2, required);
  cap = Math.max(8, cap);
  const data = new Uint8Array(cap);
  data.set(v.data.subarray(0, v.len));
  v.data = data;
  v.capacity = cap;
}
