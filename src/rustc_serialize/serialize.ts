// Port of compiler/rustc_serialize/src/serialize.rs.
//
//! Support code for encoding and decoding types.
//
// PORT: representation (PORTING §5).
// - Integer widths: `u8..u32`/`i8..i32`/`usize`/`isize` are `number`, `u64`/`u128`/`i64`/`i128` are
//   `bigint`; `char` is a `number` (Unicode scalar). `str`/`String` are JS `string`s (the encoded form
//   is their UTF-8 bytes); byte slices are `Uint8Array`s.
// - The `Encodable<S>` / `Decodable<D>` traits are function types: an impl for a type `T` is
//   `encode_<T>(v, s[, encode_<P>...])` / `decode_<T>(d[, decode_<P>...])`, generic impls take the
//   impls of their type parameters (as the StableHash port does). Derived impls come from
//   tools/codegen/types.ts (`derive(Decodable)`/`derive(Encodable)`, `<crate>/serialize.gen.ts`).
// - The provided methods of `Encoder`/`Decoder` live in `Encoder_provided`/`Decoder_provided`
//   (PORTING §8); implementors forward to them.
// - `impl_*` macro expansions are one TS fn each, marked `// rustc:` on the macro's `fn` line.
import { Hash128, Hash64 } from "../rustc_hashes/lib.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { utf8 } from "../std/str.ts";

/// A byte that [cannot occur in UTF8 sequences][utf8]. Used to mark the end of a string.
/// This way we can skip validation and still be relatively sure that deserialization
/// did not desynchronize.
///
/// [utf8]: https://en.wikipedia.org/w/index.php?title=UTF-8&oldid=1058865525#Codepage_layout
const STR_SENTINEL = 0xc1;

/// For byte strings there are no bytes that cannot occur. Just use this value
/// as a best-effort sentinel. There is no validation skipped so the potential
/// for badness is lower than in the `STR_SENTINEL` case.
const BYTE_STR_SENTINEL = 0xc2;

/// A note about error handling.
///
/// Encoders may be fallible, but in practice failure is rare and there are so
/// many nested calls that typical Rust error handling (via `Result` and `?`)
/// is pervasive and has non-trivial cost. Instead, impls of this trait must
/// implement a delayed error handling strategy. If a failure occurs, they
/// should record this internally, and all subsequent encoding operations can
/// be processed or ignored, whichever is appropriate. Then they should provide
/// a `finish` method that finishes up encoding. If the encoder is fallible,
/// `finish` should return a `Result` that indicates success or failure.
///
/// This current does not support `f32` nor `f64`, as they're not needed in any
/// serialized data structures. That could be changed, but consider whether it
/// really makes sense to store floating-point values at all.
/// (If you need it, revert <https://github.com/rust-lang/rust/pull/109984>.)
export interface Encoder {
  // rustc: compiler/rustc_serialize/src/serialize.rs:45 emit_usize
  emit_usize(v: number): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:46 emit_u128
  emit_u128(v: bigint): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:47 emit_u64
  emit_u64(v: bigint): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:48 emit_u32
  emit_u32(v: number): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:49 emit_u16
  emit_u16(v: number): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:50 emit_u8
  emit_u8(v: number): void;

  // rustc: compiler/rustc_serialize/src/serialize.rs:52 emit_isize
  emit_isize(v: number): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:53 emit_i128
  emit_i128(v: bigint): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:54 emit_i64
  emit_i64(v: bigint): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:55 emit_i32
  emit_i32(v: number): void;
  // rustc: compiler/rustc_serialize/src/serialize.rs:56 emit_i16
  emit_i16(v: number): void;

  emit_i8(v: number): void; // (provided)
  emit_bool(v: boolean): void; // (provided)
  emit_char(v: number): void; // (provided)
  emit_str(v: string): void; // (provided)
  emit_byte_str(v: Uint8Array): void; // (provided)

  // rustc: compiler/rustc_serialize/src/serialize.rs:87 emit_raw_bytes
  emit_raw_bytes(s: Uint8Array): void;
}

/** The provided methods of `Encoder`. */
export const Encoder_provided = {
  // rustc: compiler/rustc_serialize/src/serialize.rs:59 emit_i8
  emit_i8(self: Encoder, v: number): void {
    self.emit_u8(v & 0xff);
  },

  // rustc: compiler/rustc_serialize/src/serialize.rs:64 emit_bool
  emit_bool(self: Encoder, v: boolean): void {
    self.emit_u8(v ? 1 : 0);
  },

  // rustc: compiler/rustc_serialize/src/serialize.rs:69 emit_char
  emit_char(self: Encoder, v: number): void {
    self.emit_u32(v);
  },

  // rustc: compiler/rustc_serialize/src/serialize.rs:74 emit_str
  emit_str(self: Encoder, v: string): void {
    const bytes = utf8(v);
    self.emit_usize(bytes.length);
    self.emit_raw_bytes(bytes);
    self.emit_u8(STR_SENTINEL);
  },

  // rustc: compiler/rustc_serialize/src/serialize.rs:81 emit_byte_str
  emit_byte_str(self: Encoder, v: Uint8Array): void {
    self.emit_usize(v.length);
    self.emit_raw_bytes(v);
    self.emit_u8(BYTE_STR_SENTINEL);
  },
};

// Note: all the methods in this trait are infallible, which may be surprising.
// They used to be fallible (i.e. return a `Result`) but many of the impls just
// panicked when something went wrong, and for the cases that didn't the
// top-level invocation would also just panic on failure. Switching to
// infallibility made things faster and lots of code a little simpler and more
// concise.
///
/// This current does not support `f32` nor `f64`, as they're not needed in any
/// serialized data structures. That could be changed, but consider whether it
/// really makes sense to store floating-point values at all.
/// (If you need it, revert <https://github.com/rust-lang/rust/pull/109984>.)
export interface Decoder {
  // rustc: compiler/rustc_serialize/src/serialize.rs:102 read_usize
  read_usize(): number;
  // rustc: compiler/rustc_serialize/src/serialize.rs:103 read_u128
  read_u128(): bigint;
  // rustc: compiler/rustc_serialize/src/serialize.rs:104 read_u64
  read_u64(): bigint;
  // rustc: compiler/rustc_serialize/src/serialize.rs:105 read_u32
  read_u32(): number;
  // rustc: compiler/rustc_serialize/src/serialize.rs:106 read_u16
  read_u16(): number;
  // rustc: compiler/rustc_serialize/src/serialize.rs:107 read_u8
  read_u8(): number;

  // rustc: compiler/rustc_serialize/src/serialize.rs:109 read_isize
  read_isize(): number;
  // rustc: compiler/rustc_serialize/src/serialize.rs:110 read_i128
  read_i128(): bigint;
  // rustc: compiler/rustc_serialize/src/serialize.rs:111 read_i64
  read_i64(): bigint;
  // rustc: compiler/rustc_serialize/src/serialize.rs:112 read_i32
  read_i32(): number;
  // rustc: compiler/rustc_serialize/src/serialize.rs:113 read_i16
  read_i16(): number;

  read_i8(): number; // (provided)
  read_bool(): boolean; // (provided)
  read_char(): number; // (provided)
  read_str(): string; // (provided)
  read_byte_str(): Uint8Array; // (provided)

  // rustc: compiler/rustc_serialize/src/serialize.rs:150 read_raw_bytes
  read_raw_bytes(len: number): Uint8Array;

  // rustc: compiler/rustc_serialize/src/serialize.rs:152 peek_byte
  peek_byte(): number;
  // rustc: compiler/rustc_serialize/src/serialize.rs:153 position
  position(): number;
}

const UTF8_DECODER = new TextDecoder("utf-8");

/** `std::str::from_utf8_unchecked(bytes)` as a JS string (ASCII fast path for short strings). */
function from_utf8_unchecked(bytes: Uint8Array): string {
  const n = bytes.length;
  if (n <= 32) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const b = bytes[i]!;
      if (b >= 0x80) return UTF8_DECODER.decode(bytes);
      s += String.fromCharCode(b);
    }
    return s;
  }
  return UTF8_DECODER.decode(bytes);
}

/** `std::char::from_u32(bits)`: a Unicode scalar value, else `None`. */
function char_from_u32(bits: number): number | undefined {
  if (bits > 0x10ffff || (bits >= 0xd800 && bits <= 0xdfff)) return undefined;
  return bits;
}

/** The provided methods of `Decoder`. */
export const Decoder_provided = {
  // rustc: compiler/rustc_serialize/src/serialize.rs:116 read_i8
  read_i8(self: Decoder): number {
    return (self.read_u8() << 24) >> 24;
  },

  // rustc: compiler/rustc_serialize/src/serialize.rs:121 read_bool
  read_bool(self: Decoder): boolean {
    const value = self.read_u8();
    return value !== 0;
  },

  // rustc: compiler/rustc_serialize/src/serialize.rs:127 read_char
  read_char(self: Decoder): number {
    const bits = self.read_u32();
    return unwrap(char_from_u32(bits));
  },

  // rustc: compiler/rustc_serialize/src/serialize.rs:133 read_str
  read_str(self: Decoder): string {
    const len = self.read_usize();
    const bytes = self.read_raw_bytes(len + 1);
    assert(bytes[len] === STR_SENTINEL, "assertion failed: bytes[len] == STR_SENTINEL");
    // SAFETY: the presence of `STR_SENTINEL` gives us high (but not
    // perfect) confidence that the bytes we just read truly are UTF-8.
    return from_utf8_unchecked(bytes.subarray(0, len));
  },

  // rustc: compiler/rustc_serialize/src/serialize.rs:143 read_byte_str
  read_byte_str(self: Decoder): Uint8Array {
    const len = self.read_usize();
    const bytes = self.read_raw_bytes(len + 1);
    assert(bytes[len] === BYTE_STR_SENTINEL, "assertion failed: bytes[len] == BYTE_STR_SENTINEL");
    return bytes.subarray(0, len);
  },
};

/// Trait for types that can be serialized
///
/// This can be implemented using the `Encodable`, `TyEncodable` and
/// `MetadataEncodable` macros.
///
/// * `Encodable` should be used in crates that don't depend on
///   `rustc_middle`.
/// * `MetadataEncodable` is used in `rustc_metadata` for types that contain
///   `rustc_metadata::rmeta::Lazy`.
/// * `TyEncodable` should be used for types that are only serialized in crate
///   metadata or the incremental cache. This is most types in `rustc_middle`.
// PORT: the trait's single method as a function type: `<T as Encodable<S>>::encode(&v, s)`.
// rustc: compiler/rustc_serialize/src/serialize.rs:168 encode
export type Encodable<T, S extends Encoder = Encoder> = (v: T, s: S) => void;

/// Trait for types that can be deserialized
///
/// This can be implemented using the `Decodable`, `TyDecodable` and
/// `MetadataDecodable` macros.
///
/// * `Decodable` should be used in crates that don't depend on
///   `rustc_middle`.
/// * `MetadataDecodable` is used in `rustc_metadata` for types that contain
///   `rustc_metadata::rmeta::Lazy`.
/// * `TyDecodable` should be used for types that are only serialized in crate
///   metadata or the incremental cache. This is most types in `rustc_middle`.
// PORT: the trait's single method as a function type: `<T as Decodable<D>>::decode(d)`.
// rustc: compiler/rustc_serialize/src/serialize.rs:183 decode
export type Decodable<T, D extends Decoder = Decoder> = (d: D) => T;

// ---- direct_serialize_impls! { usize emit_usize read_usize, ... } ----

// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_usize(v: number, s: Encoder): void {
  s.emit_usize(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_usize(d: Decoder): number {
  return d.read_usize();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_u8(v: number, s: Encoder): void {
  s.emit_u8(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_u8(d: Decoder): number {
  return d.read_u8();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_u16(v: number, s: Encoder): void {
  s.emit_u16(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_u16(d: Decoder): number {
  return d.read_u16();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_u32(v: number, s: Encoder): void {
  s.emit_u32(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_u32(d: Decoder): number {
  return d.read_u32();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_u64(v: bigint, s: Encoder): void {
  s.emit_u64(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_u64(d: Decoder): bigint {
  return d.read_u64();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_u128(v: bigint, s: Encoder): void {
  s.emit_u128(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_u128(d: Decoder): bigint {
  return d.read_u128();
}

// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_isize(v: number, s: Encoder): void {
  s.emit_isize(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_isize(d: Decoder): number {
  return d.read_isize();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_i8(v: number, s: Encoder): void {
  s.emit_i8(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_i8(d: Decoder): number {
  return d.read_i8();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_i16(v: number, s: Encoder): void {
  s.emit_i16(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_i16(d: Decoder): number {
  return d.read_i16();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_i32(v: number, s: Encoder): void {
  s.emit_i32(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_i32(d: Decoder): number {
  return d.read_i32();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_i64(v: bigint, s: Encoder): void {
  s.emit_i64(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_i64(d: Decoder): bigint {
  return d.read_i64();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_i128(v: bigint, s: Encoder): void {
  s.emit_i128(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_i128(d: Decoder): bigint {
  return d.read_i128();
}

// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_bool(v: boolean, s: Encoder): void {
  s.emit_bool(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_bool(d: Decoder): boolean {
  return d.read_bool();
}
// rustc: compiler/rustc_serialize/src/serialize.rs:190 encode
export function encode_char(v: number, s: Encoder): void {
  s.emit_char(v);
}
// rustc: compiler/rustc_serialize/src/serialize.rs:196 decode
export function decode_char(d: Decoder): number {
  return d.read_char();
}

/** `impl<S: Encoder, T: ?Sized + PointeeSized> Encodable<S> for &T` */
// rustc: compiler/rustc_serialize/src/serialize.rs:227 encode
export function encode_ref<T>(v: T, s: Encoder, encode_T: Encodable<T>): void {
  encode_T(v, s);
}

/** `impl<S: Encoder> Encodable<S> for !` */
// rustc: compiler/rustc_serialize/src/serialize.rs:233 encode
export function encode_never(_v: never, _s: Encoder): void {
  unreachable();
}

/** `impl<D: Decoder> Decodable<D> for !` */
// rustc: compiler/rustc_serialize/src/serialize.rs:239 decode
export function decode_never(_d: Decoder): never {
  unreachable();
}

/** `impl<T: ZeroablePrimitive + Encodable<S>, S: Encoder> Encodable<S> for NonZero<T>` (the TS value is the integer) */
// rustc: compiler/rustc_serialize/src/serialize.rs:245 encode
export function encode_NonZero<T extends number | bigint>(v: T, s: Encoder, encode_T: Encodable<T>): void {
  encode_T(v, s);
}

/** `impl<T: ZeroablePrimitive + Decodable<D>, D: Decoder> Decodable<D> for NonZero<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:251 decode
export function decode_NonZero<T extends number | bigint, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T {
  const v = decode_T(d);
  // `NonZero::new(v).unwrap()`
  return unwrap(v === 0 || v === 0n ? undefined : v);
}

/** `impl<S: Encoder> Encodable<S> for str` */
// rustc: compiler/rustc_serialize/src/serialize.rs:257 encode
export function encode_str(v: string, s: Encoder): void {
  s.emit_str(v);
}

/** `impl<S: Encoder> Encodable<S> for String` */
// rustc: compiler/rustc_serialize/src/serialize.rs:263 encode
export function encode_String(v: string, s: Encoder): void {
  s.emit_str(v);
}

/** `impl<D: Decoder> Decodable<D> for String` */
// rustc: compiler/rustc_serialize/src/serialize.rs:269 decode
export function decode_String(d: Decoder): string {
  return d.read_str();
}

/** `impl<S: Encoder> Encodable<S> for ()` (the TS unit is `null`) */
// rustc: compiler/rustc_serialize/src/serialize.rs:275 encode
export function encode_unit(_v: null, _s: Encoder): void {}

/** `impl<D: Decoder> Decodable<D> for ()` */
// rustc: compiler/rustc_serialize/src/serialize.rs:279 decode
export function decode_unit(_d: Decoder): null {
  return null;
}

/** `impl<S: Encoder, T> Encodable<S> for PhantomData<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:283 encode
export function encode_PhantomData(_v: undefined, _s: Encoder): void {}

/** `impl<D: Decoder, T> Decodable<D> for PhantomData<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:287 decode
export function decode_PhantomData(_d: Decoder): undefined {
  return undefined;
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for Box<[T]>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:293 decode
export function decode_Box_slice<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
  const v: T[] = decode_Vec(d, decode_T);
  return v;
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for Rc<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:300 encode
export function encode_Rc<T>(v: T, s: Encoder, encode_T: Encodable<T>): void {
  encode_T(v, s);
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for Rc<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:306 decode
export function decode_Rc<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T {
  return decode_T(d);
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for [T]` (the `default fn`; see opaque.ts for `[u8]`) */
// rustc: compiler/rustc_serialize/src/serialize.rs:312 encode
export function encode_slice<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  s.emit_usize(v.length);
  for (let i = 0; i < v.length; i++) {
    encode_T(v[i]!, s);
  }
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for Vec<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:321 encode
export function encode_Vec<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  encode_slice(v, s, encode_T);
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for Vec<T>` (the `default fn`; see opaque.ts for `Vec<u8>`) */
// rustc: compiler/rustc_serialize/src/serialize.rs:327 decode
export function decode_Vec<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
  const len = d.read_usize();
  const v: T[] = [];
  for (let i = 0; i < len; i++) v.push(decode_T(d));
  return v;
}

/** `impl<S: Encoder, T: Encodable<S>, const N: usize> Encodable<S> for [T; N]` */
// rustc: compiler/rustc_serialize/src/serialize.rs:334 encode
export function encode_array<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  encode_slice(v, s, encode_T);
}

/** `impl<D: Decoder, T: Decodable<D>, const N: usize> Decodable<D> for [T; N]` */
// rustc: compiler/rustc_serialize/src/serialize.rs:340 decode
export function decode_array<T, D extends Decoder>(d: D, N: number, decode_T: Decodable<T, D>): T[] {
  const len = d.read_usize();
  assert(len === N, "assertion failed: len == N");
  // `std::array::from_fn(move |_| Decodable::decode(d))`
  const v: T[] = [];
  for (let i = 0; i < N; i++) v.push(decode_T(d));
  return v;
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for Cow<'_, [T]>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:351 encode
export function encode_Cow_slice<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  const slice: ArrayLike<T> = v;
  encode_slice(slice, s, encode_T);
}

/** `impl<D: Decoder, T: Decodable<D> + ToOwned> Decodable<D> for Cow<'static, [T]>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:361 decode
export function decode_Cow_slice<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
  const v: T[] = decode_Vec(d, decode_T);
  // `Cow::Owned(v)`
  return v;
}

/** `impl<S: Encoder> Encodable<S> for Cow<'_, str>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:368 encode
export function encode_Cow_str(v: string, s: Encoder): void {
  const val: string = v;
  encode_str(val, s);
}

/** `impl<D: Decoder> Decodable<D> for Cow<'_, str>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:375 decode
export function decode_Cow_str(d: Decoder): string {
  const v: string = decode_String(d);
  // `Cow::Owned(v)`
  return v;
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for Option<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:382 encode
export function encode_Option<T>(v: T | undefined, s: Encoder, encode_T: Encodable<T>): void {
  if (v === undefined) s.emit_u8(0);
  else {
    s.emit_u8(1);
    encode_T(v, s);
  }
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for Option<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:394 decode
export function decode_Option<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T | undefined {
  switch (d.read_u8()) {
    case 0:
      return undefined;
    case 1:
      return decode_T(d);
    default:
      panic("Encountered invalid discriminant while decoding `Option`.");
  }
}

/** PORT: `Option<T>` whose `T` can itself be `undefined` (PORTING §5: `{ $: "Some", _0 } | undefined`); as `encode_Option`. */
export function encode_Option_some<T>(v: { $: "Some"; _0: T } | undefined, s: Encoder, encode_T: Encodable<T>): void {
  if (v === undefined) s.emit_u8(0);
  else {
    s.emit_u8(1);
    encode_T(v._0, s);
  }
}

/** PORT: `Option<T>` whose `T` can itself be `undefined` (PORTING §5: `{ $: "Some", _0 } | undefined`); as `decode_Option`. */
export function decode_Option_some<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): { $: "Some"; _0: T } | undefined {
  switch (d.read_u8()) {
    case 0:
      return undefined;
    case 1:
      return { $: "Some", _0: decode_T(d) };
    default:
      panic("Encountered invalid discriminant while decoding `Option`.");
  }
}

/** `impl<S: Encoder, T1: Encodable<S>, T2: Encodable<S>> Encodable<S> for Result<T1, T2>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:404 encode
export function encode_Result<T1, T2>(v: Result<T1, T2>, s: Encoder, encode_T1: Encodable<T1>, encode_T2: Encodable<T2>): void {
  switch (v.$) {
    case "Ok":
      s.emit_u8(0);
      encode_T1(v._0, s);
      break;
    case "Err":
      s.emit_u8(1);
      encode_T2(v._0, s);
      break;
  }
}

/** `impl<D: Decoder, T1: Decodable<D>, T2: Decodable<D>> Decodable<D> for Result<T1, T2>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:419 decode
export function decode_Result<T1, T2, D extends Decoder>(d: D, decode_T1: Decodable<T1, D>, decode_T2: Decodable<T2, D>): Result<T1, T2> {
  switch (d.read_u8()) {
    case 0:
      return Ok(decode_T1(d));
    case 1:
      return Err(decode_T2(d));
    default:
      panic("Encountered invalid discriminant while decoding `Result`.");
  }
}

// ---- tuple! { T0, T1, ..., T11, } (one impl per arity 1..=12) ----

type Decodables<T extends unknown[], D extends Decoder> = { [K in keyof T]: Decodable<T[K], D> };
type Encodables<T extends unknown[]> = { [K in keyof T]: Encodable<T[K]> };

/** `impl<D: Decoder, T0: Decodable<D>, ..> Decodable<D> for (T0, ..)`: the elements in order. */
// rustc: compiler/rustc_serialize/src/serialize.rs:436 decode
export function decode_tuple<T extends unknown[], D extends Decoder>(d: D, ...decode_Ts: Decodables<T, D>): T {
  const out: unknown[] = [];
  for (const decode_T of decode_Ts as Decodable<unknown, D>[]) {
    const element = decode_T(d);
    out.push(element);
  }
  return out as T;
}

/** `impl<S: Encoder, T0: Encodable<S>, ..> Encodable<S> for (T0, ..)`: the elements in order. */
// rustc: compiler/rustc_serialize/src/serialize.rs:442 encode
export function encode_tuple<T extends unknown[]>(v: T, s: Encoder, ...encode_Ts: Encodables<T>): void {
  const fs = encode_Ts as Encodable<unknown>[];
  for (let i = 0; i < fs.length; i++) fs[i]!(v[i], s);
}

/** `impl<S: Encoder> Encodable<S> for path::Path` */
// rustc: compiler/rustc_serialize/src/serialize.rs:454 encode
export function encode_Path(v: string, e: Encoder): void {
  // `self.to_str().unwrap()`: a TS path string is always valid UTF-8.
  encode_str(v, e);
}

/** `impl<S: Encoder> Encodable<S> for path::PathBuf` */
// rustc: compiler/rustc_serialize/src/serialize.rs:460 encode
export function encode_PathBuf(v: string, e: Encoder): void {
  encode_Path(v, e);
}

/** `impl<D: Decoder> Decodable<D> for path::PathBuf` */
// rustc: compiler/rustc_serialize/src/serialize.rs:466 decode
export function decode_PathBuf(d: Decoder): string {
  const bytes: string = decode_String(d);
  // `path::PathBuf::from(bytes)`
  return bytes;
}

/** `impl<S: Encoder, T: Encodable<S> + Copy> Encodable<S> for Cell<T>` (the TS value is the cell's content) */
// rustc: compiler/rustc_serialize/src/serialize.rs:473 encode
export function encode_Cell<T>(v: T, s: Encoder, encode_T: Encodable<T>): void {
  encode_T(v, s);
}

/** `impl<D: Decoder, T: Decodable<D> + Copy> Decodable<D> for Cell<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:479 decode
export function decode_Cell<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T {
  return decode_T(d);
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for RefCell<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:485 encode
export function encode_RefCell<T>(v: T, s: Encoder, encode_T: Encodable<T>): void {
  encode_T(v, s);
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for RefCell<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:491 decode
export function decode_RefCell<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T {
  return decode_T(d);
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for Arc<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:497 encode
export function encode_Arc<T>(v: T, s: Encoder, encode_T: Encodable<T>): void {
  encode_T(v, s);
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for Arc<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:503 decode
export function decode_Arc<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T {
  return decode_T(d);
}

/** `impl<S: Encoder, T: ?Sized + Encodable<S>> Encodable<S> for Box<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:509 encode
export function encode_Box<T>(v: T, s: Encoder, encode_T: Encodable<T>): void {
  encode_T(v, s);
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for Box<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:515 decode
export function decode_Box<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T {
  return decode_T(d);
}

/** `impl<S: Encoder, A: Array<Item: Encodable<S>>> Encodable<S> for SmallVec<A>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:521 encode
export function encode_SmallVec<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  encode_slice(v, s, encode_T);
}

/** `impl<D: Decoder, A: Array<Item: Decodable<D>>> Decodable<D> for SmallVec<A>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:527 decode
export function decode_SmallVec<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
  const len = d.read_usize();
  const v: T[] = [];
  for (let i = 0; i < len; i++) v.push(decode_T(d));
  return v;
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for ThinVec<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:534 encode
export function encode_ThinVec<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  encode_slice(v, s, encode_T);
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for ThinVec<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:540 decode
export function decode_ThinVec<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
  const len = d.read_usize();
  const v: T[] = [];
  for (let i = 0; i < len; i++) v.push(decode_T(d));
  return v;
}

/** `impl<S: Encoder, T: Encodable<S>> Encodable<S> for VecDeque<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:547 encode
export function encode_VecDeque<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  s.emit_usize(v.length);
  for (let i = 0; i < v.length; i++) {
    encode_T(v[i]!, s);
  }
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for VecDeque<T>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:556 decode
export function decode_VecDeque<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
  const len = d.read_usize();
  const v: T[] = [];
  for (let i = 0; i < len; i++) v.push(decode_T(d));
  return v;
}

/**
 * `impl<S: Encoder, K, V> Encodable<S> for BTreeMap<K, V>`
 * PORT: a `BTreeMap` is a `Map` kept in key order by its builders; iteration is insertion order.
 */
// rustc: compiler/rustc_serialize/src/serialize.rs:567 encode
export function encode_BTreeMap<K, V>(v: ReadonlyMap<K, V>, e: Encoder, encode_K: Encodable<K>, encode_V: Encodable<V>): void {
  e.emit_usize(v.size);
  for (const [key, val] of v) {
    encode_K(key, e);
    encode_V(val, e);
  }
}

/**
 * `impl<D: Decoder, K, V> Decodable<D> for BTreeMap<K, V>`
 * PORT: `collect()` into a `BTreeMap` orders by key; the encoder wrote a `BTreeMap` in key order, so
 * insertion order is key order (a later equal key replaces the value, as in `collect`).
 */
// rustc: compiler/rustc_serialize/src/serialize.rs:581 decode
export function decode_BTreeMap<K, V, D extends Decoder>(d: D, decode_K: Decodable<K, D>, decode_V: Decodable<V, D>): Map<K, V> {
  const len = d.read_usize();
  const m = new Map<K, V>();
  for (let i = 0; i < len; i++) {
    const k = decode_K(d);
    const v = decode_V(d);
    m.set(k, v);
  }
  return m;
}

/** `impl<S: Encoder, T> Encodable<S> for BTreeSet<T>` (see `encode_BTreeMap`) */
// rustc: compiler/rustc_serialize/src/serialize.rs:591 encode
export function encode_BTreeSet<T>(v: ReadonlySet<T>, s: Encoder, encode_T: Encodable<T>): void {
  s.emit_usize(v.size);
  for (const e of v) {
    encode_T(e, s);
  }
}

/** `impl<D: Decoder, T> Decodable<D> for BTreeSet<T>` (see `decode_BTreeMap`) */
// rustc: compiler/rustc_serialize/src/serialize.rs:603 decode
export function decode_BTreeSet<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): Set<T> {
  const len = d.read_usize();
  const s = new Set<T>();
  for (let i = 0; i < len; i++) s.add(decode_T(d));
  return s;
}

/** `impl<E: Encoder, K, V, S> Encodable<E> for HashMap<K, V, S>` (iteration order: the `Map`'s) */
// rustc: compiler/rustc_serialize/src/serialize.rs:615 encode
export function encode_HashMap<K, V>(v: ReadonlyMap<K, V>, e: Encoder, encode_K: Encodable<K>, encode_V: Encodable<V>): void {
  e.emit_usize(v.size);
  for (const [key, val] of v) {
    encode_K(key, e);
    encode_V(val, e);
  }
}

/** `impl<D: Decoder, K, V, S> Decodable<D> for HashMap<K, V, S>` (keys: primitives or interned handles, PORTING §5) */
// rustc: compiler/rustc_serialize/src/serialize.rs:630 decode
export function decode_HashMap<K, V, D extends Decoder>(d: D, decode_K: Decodable<K, D>, decode_V: Decodable<V, D>): Map<K, V> {
  const len = d.read_usize();
  const m = new Map<K, V>();
  for (let i = 0; i < len; i++) {
    const k = decode_K(d);
    const v = decode_V(d);
    m.set(k, v);
  }
  return m;
}

/** `impl<E: Encoder, T, S> Encodable<E> for HashSet<T, S>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:641 encode
export function encode_HashSet<T>(v: ReadonlySet<T>, s: Encoder, encode_T: Encodable<T>): void {
  s.emit_usize(v.size);
  for (const e of v) {
    encode_T(e, s);
  }
}

/** `impl<D: Decoder, T, S> Decodable<D> for HashSet<T, S>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:654 decode
export function decode_HashSet<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): Set<T> {
  const len = d.read_usize();
  const s = new Set<T>();
  for (let i = 0; i < len; i++) s.add(decode_T(d));
  return s;
}

/** `impl<E: Encoder, K, V, S> Encodable<E> for indexmap::IndexMap<K, V, S>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:666 encode
export function encode_IndexMap<K, V>(v: ReadonlyMap<K, V>, e: Encoder, encode_K: Encodable<K>, encode_V: Encodable<V>): void {
  e.emit_usize(v.size);
  for (const [key, val] of v) {
    encode_K(key, e);
    encode_V(val, e);
  }
}

/** `impl<D: Decoder, K, V, S> Decodable<D> for indexmap::IndexMap<K, V, S>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:681 decode
export function decode_IndexMap<K, V, D extends Decoder>(d: D, decode_K: Decodable<K, D>, decode_V: Decodable<V, D>): Map<K, V> {
  const len = d.read_usize();
  const m = new Map<K, V>();
  for (let i = 0; i < len; i++) {
    const k = decode_K(d);
    const v = decode_V(d);
    m.set(k, v);
  }
  return m;
}

/** `impl<E: Encoder, T, S> Encodable<E> for indexmap::IndexSet<T, S>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:692 encode
export function encode_IndexSet<T>(v: ReadonlySet<T>, s: Encoder, encode_T: Encodable<T>): void {
  s.emit_usize(v.size);
  for (const e of v) {
    encode_T(e, s);
  }
}

/** `impl<D: Decoder, T, S> Decodable<D> for indexmap::IndexSet<T, S>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:705 decode
export function decode_IndexSet<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): Set<T> {
  const len = d.read_usize();
  const s = new Set<T>();
  for (let i = 0; i < len; i++) s.add(decode_T(d));
  return s;
}

/** `impl<E: Encoder, T: Encodable<E>> Encodable<E> for Rc<[T]>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:712 encode
export function encode_Rc_slice<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  const slice: ArrayLike<T> = v;
  encode_slice(slice, s, encode_T);
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for Rc<[T]>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:719 decode
export function decode_Rc_slice<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
  const vec: T[] = decode_Vec(d, decode_T);
  return vec;
}

/** `impl<E: Encoder, T: Encodable<E>> Encodable<E> for Arc<[T]>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:726 encode
export function encode_Arc_slice<T>(v: ArrayLike<T>, s: Encoder, encode_T: Encodable<T>): void {
  const slice: ArrayLike<T> = v;
  encode_slice(slice, s, encode_T);
}

/** `impl<D: Decoder, T: Decodable<D>> Decodable<D> for Arc<[T]>` */
// rustc: compiler/rustc_serialize/src/serialize.rs:733 decode
export function decode_Arc_slice<T, D extends Decoder>(d: D, decode_T: Decodable<T, D>): T[] {
  const vec: T[] = decode_Vec(d, decode_T);
  return vec;
}

/** `x.to_le_bytes()` of an `n`-byte unsigned integer. */
function to_le_bytes(x: bigint, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** `uN::from_le_bytes(bytes)` */
function from_le_bytes(bytes: Uint8Array): bigint {
  let x = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(bytes[i]!);
  return x;
}

/** `impl<S: Encoder> Encodable<S> for Hash64` */
// rustc: compiler/rustc_serialize/src/serialize.rs:741 encode
export function encode_Hash64(v: Hash64, s: Encoder): void {
  s.emit_raw_bytes(to_le_bytes(Hash64.as_u64(v), 8));
}

/** `impl<S: Encoder> Encodable<S> for Hash128` */
// rustc: compiler/rustc_serialize/src/serialize.rs:748 encode
export function encode_Hash128(v: Hash128, s: Encoder): void {
  s.emit_raw_bytes(to_le_bytes(Hash128.as_u128(v), 16));
}

/** `impl<D: Decoder> Decodable<D> for Hash64` */
// rustc: compiler/rustc_serialize/src/serialize.rs:755 decode
export function decode_Hash64(d: Decoder): Hash64 {
  // `u64::from_le_bytes(d.read_raw_bytes(8).try_into().unwrap())`
  return Hash64.new(from_le_bytes(d.read_raw_bytes(8)));
}

/** `impl<D: Decoder> Decodable<D> for Hash128` */
// rustc: compiler/rustc_serialize/src/serialize.rs:762 decode
export function decode_Hash128(d: Decoder): Hash128 {
  // `u128::from_le_bytes(d.read_raw_bytes(16).try_into().unwrap())`
  return Hash128.new(from_le_bytes(d.read_raw_bytes(16)));
}
