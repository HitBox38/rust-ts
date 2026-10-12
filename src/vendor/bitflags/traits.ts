// Port of bitflags-2.10.0/src/traits.rs (the parts used by generated `bitflags!` types).
//
// PORT: a `bitflags!` type is a branded number (`type InlineAsmOptions = number & { __brand }`).
// The `Flags` trait becomes a descriptor (`FLAGS` + the width of `Self::Bits`) passed to free
// functions `Flags_<method>(F, self, ..)`; generated companions bind them (see `flags_companion`).
// Only `Bits` of at most 32 bits are supported (JS bitwise ops); u64/u128 flags need a bigint port.
// Mutating methods (`insert`, `remove`, ...) return the new value instead of writing through `&mut`.
import { assert } from "../../std/panic.ts";
import { IterNames } from "./iter.ts"; // ESM cycle with iter.ts: only used inside function bodies

/**
A defined flags value that may be named or unnamed.
*/
export class Flag<B> {
  // crate: bitflags-2.10.0/src/traits.rs:26 new
  /**
  Define a flag.

  If `name` is non-empty then the flag is named, otherwise it's unnamed.
  */
  constructor(
    public readonly name_: string,
    public readonly value_: B,
  ) {}

  // crate: bitflags-2.10.0/src/traits.rs:35 name
  /**
  Get the name of this flag.

  If the flag is unnamed then the returned string will be empty.
  */
  name(): string {
    return this.name_;
  }

  // crate: bitflags-2.10.0/src/traits.rs:42 value
  /**
  Get the flags value of this flag.
  */
  value(): B {
    return this.value_;
  }

  // crate: bitflags-2.10.0/src/traits.rs:51 is_named
  /**
  Whether the flag is named.

  If [`Flag::name`] returns a non-empty string then this method will return `true`.
  */
  is_named(): boolean {
    return !(this.name_.length === 0);
  }

  // crate: bitflags-2.10.0/src/traits.rs:60 is_unnamed
  /**
  Whether the flag is unnamed.

  If [`Flag::name`] returns a non-empty string then this method will return `false`.
  */
  is_unnamed(): boolean {
    return this.name_.length === 0;
  }
}

/** PORT: `trait Flags` as a descriptor: the defined flags and the width of `Self::Bits`. */
export interface Flags<B extends number> {
  readonly FLAGS: readonly Flag<B>[];
  readonly BITS: 8 | 16 | 32;
}

/** PORT: `Bits` operations on `u8`/`u16`/`u32` (kept unsigned and within the width). */
const or = (a: number, b: number) => (a | b) >>> 0;
const and = (a: number, b: number) => (a & b) >>> 0;
const xor = (a: number, b: number) => (a ^ b) >>> 0;
const not = (a: number, width: number) => (width === 32 ? ~a >>> 0 : ~a & ((1 << width) - 1));
const EMPTY = 0;

// crate: bitflags-2.10.0/src/traits.rs:140 empty
export function Flags_empty<B extends number>(_F: Flags<B>): B {
  return EMPTY as B;
}

// crate: bitflags-2.10.0/src/traits.rs:145 all
export function Flags_all<B extends number>(F: Flags<B>): B {
  let truncated = EMPTY;

  for (const flag of F.FLAGS) {
    truncated = or(truncated, flag.value());
  }

  return truncated as B;
}

// crate: bitflags-2.10.0/src/traits.rs:168 from_bits
export function Flags_from_bits<B extends number>(F: Flags<B>, bits: number): B | undefined {
  const truncated = Flags_from_bits_truncate(F, bits);

  if (truncated === bits) {
    return truncated;
  } else {
    return undefined;
  }
}

// crate: bitflags-2.10.0/src/traits.rs:179 from_bits_truncate
export function Flags_from_bits_truncate<B extends number>(F: Flags<B>, bits: number): B {
  return and(bits, Flags_all(F)) as B;
}

// crate: bitflags-2.10.0/src/traits.rs:190 from_name
export function Flags_from_name<B extends number>(F: Flags<B>, name: string): B | undefined {
  // Don't parse empty names as empty flags
  if (name.length === 0) {
    return undefined;
  }

  for (const flag of F.FLAGS) {
    if (flag.name() === name) {
      return flag.value();
    }
  }

  return undefined;
}

// crate: bitflags-2.10.0/src/traits.rs:217 iter_names
export function Flags_iter_names<B extends number>(F: Flags<B>, self: B): IterNames<B> {
  return IterNames.new(F, self);
}

// crate: bitflags-2.10.0/src/traits.rs:227 is_empty
export function Flags_is_empty<B extends number>(_F: Flags<B>, self: B): boolean {
  return self === EMPTY;
}

// crate: bitflags-2.10.0/src/traits.rs:232 is_all
export function Flags_is_all<B extends number>(F: Flags<B>, self: B): boolean {
  // NOTE: We check against `Self::all` here, not `Self::Bits::ALL`
  // because the set of all flags may not use all bits
  return or(Flags_all(F), self) === self;
}

// crate: bitflags-2.10.0/src/traits.rs:239 intersects
export function Flags_intersects<B extends number>(_F: Flags<B>, self: B, other: B): boolean {
  return and(self, other) !== EMPTY;
}

// crate: bitflags-2.10.0/src/traits.rs:247 contains
export function Flags_contains<B extends number>(_F: Flags<B>, self: B, other: B): boolean {
  return and(self, other) === other;
}

// crate: bitflags-2.10.0/src/traits.rs:263 insert
/** PORT: returns the new value (`*self = ...`). */
export function Flags_insert<B extends number>(F: Flags<B>, self: B, other: B): B {
  return Flags_union(F, self, other);
}

// crate: bitflags-2.10.0/src/traits.rs:274 remove
/** PORT: returns the new value (`*self = ...`). */
export function Flags_remove<B extends number>(F: Flags<B>, self: B, other: B): B {
  return Flags_difference(F, self, other);
}

// crate: bitflags-2.10.0/src/traits.rs:311 intersection
export function Flags_intersection<B extends number>(_F: Flags<B>, self: B, other: B): B {
  return and(self, other) as B;
}

// crate: bitflags-2.10.0/src/traits.rs:317 union
export function Flags_union<B extends number>(_F: Flags<B>, self: B, other: B): B {
  return or(self, other) as B;
}

// crate: bitflags-2.10.0/src/traits.rs:326 difference
export function Flags_difference<B extends number>(F: Flags<B>, self: B, other: B): B {
  return and(self, not(other, F.BITS)) as B;
}

// crate: bitflags-2.10.0/src/traits.rs:332 symmetric_difference
export function Flags_symmetric_difference<B extends number>(_F: Flags<B>, self: B, other: B): B {
  return xor(self, other) as B;
}

// crate: bitflags-2.10.0/src/traits.rs:338 complement
export function Flags_complement<B extends number>(F: Flags<B>, self: B): B {
  return Flags_from_bits_truncate(F, not(self, F.BITS));
}

// crate: bitflags-2.10.0/src/traits.rs:394 write_hex
/** `write!(writer, "{:x}", self)` for the integer `Bits` types. */
export function write_hex(bits: number): string {
  return bits.toString(16);
}

/**
PORT: the companion of a generated `bitflags!` type: the named constants plus the public API the
macro expands to (bitflags-2.10.0/src/public.rs), bound to the type's `Flags` descriptor.
*/
export function flags_companion<B extends number, C extends Record<string, B>>(
  bits: 8 | 16 | 32,
  consts: C,
  flags: readonly [string, B][],
) {
  for (const [, v] of flags) assert(v >= 0 && v < 2 ** bits, "bitflags value out of range");
  const F: Flags<B> = { FLAGS: flags.map(([n, v]) => new Flag(n, v)), BITS: bits };
  return {
    ...consts,
    FLAGS: F.FLAGS,
    FLAGS_DESC: F,
    bits: (self: B): number => self,
    from_bits_retain: (bits: number): B => bits as B,
    from_bits: (bits: number) => Flags_from_bits(F, bits),
    from_bits_truncate: (bits: number) => Flags_from_bits_truncate(F, bits),
    from_name: (name: string) => Flags_from_name(F, name),
    empty: () => Flags_empty(F),
    all: () => Flags_all(F),
    is_empty: (self: B) => Flags_is_empty(F, self),
    is_all: (self: B) => Flags_is_all(F, self),
    intersects: (self: B, other: B) => Flags_intersects(F, self, other),
    contains: (self: B, other: B) => Flags_contains(F, self, other),
    insert: (self: B, other: B) => Flags_insert(F, self, other),
    remove: (self: B, other: B) => Flags_remove(F, self, other),
    intersection: (self: B, other: B) => Flags_intersection(F, self, other),
    union: (self: B, other: B) => Flags_union(F, self, other),
    difference: (self: B, other: B) => Flags_difference(F, self, other),
    symmetric_difference: (self: B, other: B) => Flags_symmetric_difference(F, self, other),
    complement: (self: B) => Flags_complement(F, self),
    iter_names: (self: B) => Flags_iter_names(F, self),
  };
}

