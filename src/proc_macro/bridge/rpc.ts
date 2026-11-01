// Port of library/proc_macro/src/bridge/rpc.rs
//
//! Serialization for client-server communication.
//
// PORT: the traits `Encode<S>` / `Decode<'a, 's, S>` are function types; an impl is a pair of functions
// `encode_<T>(self, w, s, ...)` / `decode_<T>(r, s, ...)`, and impls generic over `T: Encode<S>` take the codecs
// of their type parameters as trailing arguments (PORTING §5 "pass function tables"). `r: &mut &'a [u8]` is a
// `MutRef<Uint8Array>` whose `value` is re-sliced as bytes are consumed (`*r = &r[N..]`). Decoded `&'a str`s are
// copied into JS strings, so nothing borrows from the buffer.
//
// PORT: the `rpc_encode_decode!` invocations for `struct` / `enum` types are expanded by hand where they are
// invoked (bridge/mod.ts); each expansion's functions carry the markers of the macro's `encode` / `decode`
// (rpc.rs:39/48 for structs, rpc.rs:64/78 for enums). An enum's tag is its variant index as a `u8`.
//
// PORT: the hosts are 64-bit (aarch64-apple-darwin, x86_64): `usize` is encoded as 8 little-endian bytes
// (`rpc_encode_decode!(le usize)`). Values are JS numbers and must stay below 2^53.

import type { MutRef } from "../../std/mut_ref.ts";
import { panic, unreachable } from "../../std/panic.ts";
import { from_utf8, utf8 } from "../../std/str.ts";
import type { Buffer } from "./buffer.ts";

// std-type: library/proc_macro/src/bridge/rpc.rs:7 Encode
// std: library/proc_macro/src/bridge/rpc.rs:8 encode
export type Encode<T, S> = (self: T, w: Buffer, s: S) => void;

// std-type: library/proc_macro/src/bridge/rpc.rs:11 Decode
// std: library/proc_macro/src/bridge/rpc.rs:12 decode
export type Decode<T, S> = (r: MutRef<Uint8Array>, s: S) => T;

// impl<S> Encode<S> for ()
// std: library/proc_macro/src/bridge/rpc.rs:94 encode
export function encode_unit<S>(_self: void, _w: Buffer, _s: S): void {}

// impl<S> Decode<'_, '_, S> for ()
// std: library/proc_macro/src/bridge/rpc.rs:99 decode
export function decode_unit<S>(_r: MutRef<Uint8Array>, _s: S): undefined {
  return undefined;
}

// impl<S> Encode<S> for u8
// std: library/proc_macro/src/bridge/rpc.rs:104 encode
export function encode_u8<S>(self: number, w: Buffer, _s: S): void {
  w.push(self);
}

// impl<S> Decode<'_, '_, S> for u8
// std: library/proc_macro/src/bridge/rpc.rs:111 decode
export function decode_u8<S>(r: MutRef<Uint8Array>, _s: S): number {
  const x = index(r.value, 0);
  r.value = r.value.subarray(1);
  return x;
}

// rpc_encode_decode!(le u32);
// std: library/proc_macro/src/bridge/rpc.rs:19 encode
export function encode_u32<S>(self: number, w: Buffer, _s: S): void {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, self, true);
  w.extend_from_array(bytes);
}

// std: library/proc_macro/src/bridge/rpc.rs:26 decode
export function decode_u32<S>(r: MutRef<Uint8Array>, _s: S): number {
  const N = 4;
  const bytes = slice_to(r.value, N);
  r.value = r.value.subarray(N);
  return new DataView(bytes.buffer, bytes.byteOffset, N).getUint32(0, true);
}

// #[cfg(target_pointer_width = "64")]
// rpc_encode_decode!(le usize);
// std: library/proc_macro/src/bridge/rpc.rs:19 encode
export function encode_usize<S>(self: number, w: Buffer, _s: S): void {
  // PORT: `self.to_le_bytes()` of a 64-bit `usize` held in a JS number (< 2^53).
  const bytes = new Uint8Array(8);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, self % 0x1_0000_0000, true);
  dv.setUint32(4, Math.floor(self / 0x1_0000_0000), true);
  w.extend_from_array(bytes);
}

// std: library/proc_macro/src/bridge/rpc.rs:26 decode
export function decode_usize<S>(r: MutRef<Uint8Array>, _s: S): number {
  const N = 8;
  const bytes = slice_to(r.value, N);
  r.value = r.value.subarray(N);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, N);
  const lo = dv.getUint32(0, true);
  const hi = dv.getUint32(4, true);
  // PORT: a `usize` of 2^53 or more has no exact JS number; none of the bridge's values (lengths, byte offsets,
  // lines, columns, saved-span ids) gets there.
  if (hi >= 0x20_0000) panic("proc_macro bridge: usize value does not fit in a JS number");
  return hi * 0x1_0000_0000 + lo;
}

// std-skip: library/proc_macro/src/bridge/rpc.rs:128 encode cfg(not(target_pointer_width = "64")): the hosts are 64-bit
// std-skip: library/proc_macro/src/bridge/rpc.rs:143 decode cfg(not(target_pointer_width = "64")): the hosts are 64-bit

// impl<S> Encode<S> for bool
// std: library/proc_macro/src/bridge/rpc.rs:159 encode
export function encode_bool<S>(self: boolean, w: Buffer, s: S): void {
  encode_u8(self ? 1 : 0, w, s);
}

// impl<S> Decode<'_, '_, S> for bool
// std: library/proc_macro/src/bridge/rpc.rs:166 decode
export function decode_bool<S>(r: MutRef<Uint8Array>, s: S): boolean {
  switch (decode_u8(r, s)) {
    case 0:
      return false;
    case 1:
      return true;
    default:
      return unreachable();
  }
}

// impl<S> Encode<S> for NonZero<u32>
// std: library/proc_macro/src/bridge/rpc.rs:177 encode
export function encode_NonZero_u32<S>(self: number, w: Buffer, s: S): void {
  encode_u32(self, w, s);
}

// impl<S> Decode<'_, '_, S> for NonZero<u32>
// std: library/proc_macro/src/bridge/rpc.rs:184 decode
export function decode_NonZero_u32<S>(r: MutRef<Uint8Array>, s: S): number {
  const x = decode_u32(r, s);
  // `Self::new(..).unwrap()`
  if (x === 0) panic("called `Option::unwrap()` on a `None` value");
  return x;
}

// impl<S, A: Encode<S>, B: Encode<S>> Encode<S> for (A, B)
// std: library/proc_macro/src/bridge/rpc.rs:191 encode
export function encode_tuple2<A, B, S>(self: [A, B], w: Buffer, s: S, encode_A: Encode<A, S>, encode_B: Encode<B, S>): void {
  encode_A(self[0], w, s);
  encode_B(self[1], w, s);
}

// impl<'a, S, A: for<'s> Decode<'a, 's, S>, B: for<'s> Decode<'a, 's, S>> Decode<'a, '_, S> for (A, B)
// std: library/proc_macro/src/bridge/rpc.rs:201 decode
export function decode_tuple2<A, B, S>(r: MutRef<Uint8Array>, s: S, decode_A: Decode<A, S>, decode_B: Decode<B, S>): [A, B] {
  // PORT: tuple fields are evaluated left to right.
  const a = decode_A(r, s);
  const b = decode_B(r, s);
  return [a, b];
}

// impl<S> Encode<S> for &str
// std: library/proc_macro/src/bridge/rpc.rs:208 encode
export function encode_str<S>(self: string, w: Buffer, s: S): void {
  const bytes = utf8(self);
  encode_usize(bytes.length, w, s);
  w.extend_from_slice(bytes);
}

// impl<'a, S> Decode<'a, '_, S> for &'a str
// std: library/proc_macro/src/bridge/rpc.rs:217 decode
export function decode_str<S>(r: MutRef<Uint8Array>, s: S): string {
  const len = decode_usize(r, s);
  const xs = slice_to(r.value, len);
  r.value = r.value.subarray(len);
  // `str::from_utf8(xs).unwrap()`
  const res = from_utf8(xs);
  if (res.$ === "Err") panic("called `Result::unwrap()` on an `Err` value: Utf8Error");
  return res._0;
}

// impl<S> Encode<S> for String
// std: library/proc_macro/src/bridge/rpc.rs:227 encode
export function encode_String<S>(self: string, w: Buffer, s: S): void {
  encode_str(self, w, s);
}

// impl<S> Decode<'_, '_, S> for String
// std: library/proc_macro/src/bridge/rpc.rs:234 decode
export function decode_String<S>(r: MutRef<Uint8Array>, s: S): string {
  return decode_str(r, s);
}

// impl<S, T: Encode<S>> Encode<S> for Vec<T>
// std: library/proc_macro/src/bridge/rpc.rs:241 encode
export function encode_Vec<T, S>(self: readonly T[], w: Buffer, s: S, encode_T: Encode<T, S>): void {
  encode_usize(self.length, w, s);
  for (const x of self) {
    encode_T(x, w, s);
  }
}

// impl<'a, S, T: for<'s> Decode<'a, 's, S>> Decode<'a, '_, S> for Vec<T>
// std: library/proc_macro/src/bridge/rpc.rs:251 decode
export function decode_Vec<T, S>(r: MutRef<Uint8Array>, s: S, decode_T: Decode<T, S>): T[] {
  const len = decode_usize(r, s);
  const vec: T[] = [];
  for (let i = 0; i < len; i++) {
    vec.push(decode_T(r, s));
  }
  return vec;
}

/** `r[i]` with Rust's bounds check. */
function index(r: Uint8Array, i: number): number {
  if (i >= r.length) panic(`index out of bounds: the len is ${r.length} but the index is ${i}`);
  return r[i]!;
}

/** `&r[..n]` with Rust's bounds check. */
function slice_to(r: Uint8Array, n: number): Uint8Array {
  if (n > r.length) panic(`range end index ${n} out of range for slice of length ${r.length}`);
  return r.subarray(0, n);
}
