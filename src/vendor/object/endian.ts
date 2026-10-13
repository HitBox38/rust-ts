// Port of object 0.39.1 `src/endian.rs` (the read half: the `Endian` trait, `Endianness`,
// `LittleEndian`, `BigEndian`, and the unaligned `U16`/`U32`/`U64` values).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Types for compile-time and run-time endianness.
//
// PORT: the three `Endian` implementors are string values: `Endianness` (a fieldless enum,
// "Little" | "Big") and the unit structs `LittleEndian` / `BigEndian` ("LittleEndian" /
// "BigEndian"). Trait methods dispatch on the value (`Endian.is_big_endian(e)`); the
// constructor `E::from_big_endian` lives on each type's companion const, and generic code that
// needs it takes an `EndianType<E>` (the companion const).
// PORT: rustc builds object with the `unaligned` feature, so `U16`/`U32`/`U64` are the unaligned
// byte-array forms (alignment 1). Their bytes `[u8; N]` are stored as numbers: `U16`/`U32` as the
// bytes composed little-endian (`b0 | b1 << 8 ...`), `U64` as two such u32 halves `[lo, hi]`
// (bytes 0..4, 4..8). `get(e)` reads them in `e`'s byte order exactly as `e.read_uN(bytes)`.
// PORT: `u64` values are `number`s: exact below 2^53. Every u64 the ported code consumes is a
// file offset, size or count that is compared against a buffer length, so a larger (rounded)
// value fails the same bounds check upstream's exact value fails.
// The write half (`write_*`, `set`, `new`) and the signed types are not ported (unused on rustc's
// read path).

import { type Pod, pod_scalar } from "./pod.ts";

/// A trait for using an endianness specification.
///
/// Provides methods for converting between the specified endianness and
/// the native endianness of the target machine.
///
/// This trait does not require that the endianness is known at compile time.
export type Endian = Endianness | LittleEndian | BigEndian;

/** `E: Endian` as a type: the associated function `from_big_endian`. */
export interface EndianType<E extends Endian> {
  from_big_endian(big_endian: boolean): E | undefined;
}

/** `u16::swap_bytes` on a u16 held in a number. */
function bswap16(n: number): number {
  return ((n & 0xff) << 8) | ((n >>> 8) & 0xff);
}

/** `u32::swap_bytes` on a u32 held in a number. */
function bswap32(n: number): number {
  return (((n & 0xff) << 24) | ((n & 0xff00) << 8) | ((n >>> 8) & 0xff00) | ((n >>> 24) & 0xff)) >>> 0;
}

export const Endian = {
  // (required) from_big_endian: on the implementor's companion const

  // rustc-style dispatch for the required method `is_big_endian`.
  is_big_endian(self: Endian): boolean {
    switch (self) {
      case "Little":
      case "Big":
        return Endianness.is_big_endian(self);
      case "LittleEndian":
        return LittleEndian.is_big_endian(self);
      case "BigEndian":
        return BigEndian.is_big_endian(self);
    }
  },
};

export const Endian_provided = {
  /// Construct a specification for the endianness of some values.
  ///
  /// Returns `None` if the type does not support specifying the given endianness.
  // crate: object-0.39.1/src/endian.rs:22 from_little_endian
  from_little_endian<E extends Endian>(Self: EndianType<E>, little_endian: boolean): E | undefined {
    return Self.from_big_endian(!little_endian);
  },

  /// Return true for little endian byte order.
  // crate: object-0.39.1/src/endian.rs:31 is_little_endian
  is_little_endian(self: Endian): boolean {
    return !Endian.is_big_endian(self);
  },

  /// Converts an unaligned unsigned 16 bit integer to native endian.
  // crate: object-0.39.1/src/endian.rs:37 read_u16
  read_u16(self: Endian, n: number): number {
    // PORT: `n` is the [u8; 2] composed little-endian.
    if (Endian.is_big_endian(self)) {
      return bswap16(n);
    } else {
      return n;
    }
  },

  /// Converts an unaligned unsigned 32 bit integer to native endian.
  // crate: object-0.39.1/src/endian.rs:47 read_u32
  read_u32(self: Endian, n: number): number {
    // PORT: `n` is the [u8; 4] composed little-endian.
    if (Endian.is_big_endian(self)) {
      return bswap32(n);
    } else {
      return n;
    }
  },

  /// Converts an unaligned unsigned 64 bit integer to native endian.
  // crate: object-0.39.1/src/endian.rs:57 read_u64
  read_u64(self: Endian, n: readonly [number, number]): number {
    // PORT: `n` is the [u8; 8] as two little-endian-composed u32 halves (see the header).
    if (Endian.is_big_endian(self)) {
      return bswap32(n[0]) * 0x1_0000_0000 + bswap32(n[1]);
    } else {
      return n[1] * 0x1_0000_0000 + n[0];
    }
  },
};

/// An endianness that is selectable at run-time.
export type Endianness = "Little" | "Big";
export const Endianness = {
  /// Little endian byte order.
  Little: "Little",
  /// Big endian byte order.
  Big: "Big",

  // crate: object-0.39.1/src/endian.rs:174 default
  default(): Endianness {
    // PORT: the oracle host is little-endian (`cfg(target_endian = "little")`).
    return "Little";
  },

  // crate: object-0.39.1/src/endian.rs:187 from_big_endian
  from_big_endian(big_endian: boolean): Endianness | undefined {
    return big_endian ? "Big" : "Little";
  },

  // crate: object-0.39.1/src/endian.rs:196 is_big_endian
  is_big_endian(self: Endianness): boolean {
    return self !== "Little";
  },
} as const;

/// Compile-time little endian byte order.
export type LittleEndian = "LittleEndian";
export const LittleEndian = {
  value: "LittleEndian",

  // crate: object-0.39.1/src/endian.rs:207 default
  default(): LittleEndian {
    return "LittleEndian";
  },

  // crate: object-0.39.1/src/endian.rs:214 from_big_endian
  from_big_endian(big_endian: boolean): LittleEndian | undefined {
    if (big_endian) {
      return undefined;
    } else {
      return "LittleEndian";
    }
  },

  // crate: object-0.39.1/src/endian.rs:223 is_big_endian
  is_big_endian(_self: LittleEndian): boolean {
    return false;
  },
} as const;

/// Compile-time big endian byte order.
export type BigEndian = "BigEndian";
export const BigEndian = {
  value: "BigEndian",

  // crate: object-0.39.1/src/endian.rs:238 default
  default(): BigEndian {
    return "BigEndian";
  },

  // crate: object-0.39.1/src/endian.rs:245 from_big_endian
  from_big_endian(big_endian: boolean): BigEndian | undefined {
    if (big_endian) {
      return "BigEndian";
    } else {
      return undefined;
    }
  },

  // crate: object-0.39.1/src/endian.rs:254 is_big_endian
  is_big_endian(_self: BigEndian): boolean {
    return true;
  },
} as const;

/** `LittleEndian` / `BigEndian` values (`LE` / `BE` in upstream's `use ... as`). */
export const LE: LittleEndian = "LittleEndian";
export const BE: BigEndian = "BigEndian";

/// An unaligned `u16` value with an externally specified endianness of type `E`.
export type U16 = number & { readonly __bytes: "U16" };
export const U16 = {
  /// Construct a new value given bytes that already have the required endianness.
  // crate: object-0.39.1/src/endian.rs:320 from_bytes
  from_bytes(n: Uint8Array): U16 {
    return (n[0]! | (n[1]! << 8)) as U16;
  },

  /// Return the value as a native endian value.
  // crate: object-0.39.1/src/endian.rs:330 get
  get(self: U16, e: Endian): number {
    return Endian_provided.read_u16(e, self);
  },

  POD: pod_scalar<U16>(2, (d, o) => (d[o]! | (d[o + 1]! << 8)) as U16),
};

/// An unaligned `u32` value with an externally specified endianness of type `E`.
export type U32 = number & { readonly __bytes: "U32" };
export const U32 = {
  /// Construct a new value given bytes that already have the required endianness.
  // crate: object-0.39.1/src/endian.rs:347 from_bytes
  from_bytes(n: Uint8Array): U32 {
    return ((n[0]! | (n[1]! << 8) | (n[2]! << 16) | (n[3]! << 24)) >>> 0) as U32;
  },

  /// Return the value as a native endian value.
  // crate: object-0.39.1/src/endian.rs:357 get
  get(self: U32, e: Endian): number {
    return Endian_provided.read_u32(e, self);
  },

  POD: pod_scalar<U32>(4, (d, o) => ((d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0) as U32),
};

/// An unaligned `u64` value with an externally specified endianness of type `E`.
export type U64 = readonly [number, number] & { readonly __bytes: "U64" };
export const U64 = {
  /// Construct a new value given bytes that already have the required endianness.
  // crate: object-0.39.1/src/endian.rs:374 from_bytes
  from_bytes(n: Uint8Array): U64 {
    return [U32.from_bytes(n.subarray(0, 4)), U32.from_bytes(n.subarray(4, 8))] as unknown as U64;
  },

  /// Return the value as a native endian value.
  // crate: object-0.39.1/src/endian.rs:384 get
  get(self: U64, e: Endian): number {
    return Endian_provided.read_u64(e, self);
  },

  POD: pod_scalar<U64>(8, (d, o) => [U32.POD.read(d, o), U32.POD.read(d, o + 4)] as unknown as U64),
};

export type { Pod };
