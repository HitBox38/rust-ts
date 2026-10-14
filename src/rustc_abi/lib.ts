// compiler/rustc_abi/src/lib.rs (subset). PORT: only what rustc_target's spec and rustc_session's
// `default_configuration` need is ported here: the data layout (`TargetDataLayout` and its parser),
// `Endian`, `Size`, `Align`/`AbiAlign`, `Integer` and `AddressSpace`; lane repr-options added `ReprFlags`,
// `IntegerType`, `ScalableElt`, `ReprOptions` and the `Size` / `Align` / `Integer` / `TargetDataLayout` helpers
// they and their users need. Everything else in the crate (layout, scalars, ...) is not ported yet
// (`bun scripts/coverage.ts --missing`).
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { is_alphabetic } from "../std/char.ts";
import { debug_Hash64, type Hash64 } from "../rustc_hashes/lib.ts";
import { type Debug, debug_bool, debug_int, debug_option, debug_struct, debug_tuple } from "../std/fmt.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { to_writer } from "../vendor/bitflags/parser.ts";
import { flags_companion } from "../vendor/bitflags/traits.ts";

export * from "./canon_abi.ts";

/**
 * `core::num::ParseIntError` (the `kind` only). PORT: `str::parse::<u32>()`/`parse::<u64>()` below are
 * reimplemented over decimal digit strings (an optional leading `+`, as core accepts).
 */
export type ParseIntError = "Empty" | "InvalidDigit" | "PosOverflow";
/** `impl Display for ParseIntError` */
export function display_ParseIntError(e: ParseIntError): string {
  switch (e) {
    case "Empty":
      return "cannot parse integer from empty string";
    case "InvalidDigit":
      return "invalid digit found in string";
    case "PosOverflow":
      return "number too large to fit in target type";
  }
}
/** PORT: `<uN as FromStr>::from_str` (radix 10) for `u32` (`max` = 2^32-1) and `u64` (`max` = 2^64-1). */
function parse_uint(s: string, max: bigint): Result<bigint, ParseIntError> {
  let digits = s;
  if (digits.startsWith("+") && digits.length > 1) digits = digits.slice(1);
  if (digits.length === 0) return Err("Empty");
  let v = 0n;
  for (const c of digits) {
    if (c < "0" || c > "9") return Err("InvalidDigit");
    v = v * 10n + BigInt(c.charCodeAt(0) - 48);
    if (v > max) return Err("PosOverflow");
  }
  return Ok(v);
}
function parse_u32(s: string): Result<number, ParseIntError> {
  const r = parse_uint(s, 0xffff_ffffn);
  return r.$ === "Ok" ? Ok(Number(r._0)) : r;
}
// PORT: the `u64` values parsed here are bit counts; values above 2^53 lose precision as `number`, which
// only matters for data layouts no target uses.
function parse_u64(s: string): Result<number, ParseIntError> {
  const r = parse_uint(s, 0xffff_ffff_ffff_ffffn);
  return r.$ === "Ok" ? Ok(Number(r._0)) : r;
}

// #[derive(Clone, Copy, PartialEq, Eq, Default)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
// PORT: `bitflags!` (`impl ReprFlags: u8`) -> branded number; flags + `Flags` API on the companion (as
// rustc_middle ty/adt.ts's `AdtFlags`). Equality is `===`.
export type ReprFlags = number & { readonly __brand: "ReprFlags" };
export const ReprFlags = flags_companion<
  ReprFlags,
  {
    IS_C: ReprFlags;
    IS_SIMD: ReprFlags;
    IS_TRANSPARENT: ReprFlags;
    IS_LINEAR: ReprFlags;
    RANDOMIZE_LAYOUT: ReprFlags;
    PASS_INDIRECTLY_IN_NON_RUSTIC_ABIS: ReprFlags;
    IS_SCALABLE: ReprFlags;
    FIELD_ORDER_UNOPTIMIZABLE: ReprFlags;
    ABI_UNOPTIMIZABLE: ReprFlags;
  }
>(
  8,
  {
    IS_C: (1 << 0) as ReprFlags,
    IS_SIMD: (1 << 1) as ReprFlags,
    IS_TRANSPARENT: (1 << 2) as ReprFlags,
    /// Internal only for now. If true, don't reorder fields.
    /// On its own it does not prevent ABI optimizations.
    IS_LINEAR: (1 << 3) as ReprFlags,
    /// If true, the type's crate has opted into layout randomization.
    /// Other flags can still inhibit reordering and thus randomization.
    /// The seed stored in `ReprOptions.field_shuffle_seed`.
    ///
    /// `repr(Rust)` structs with only zero-sized fields, single-variant `repr(Rust)` enums with only
    /// zero-sized fields, and zero-variant `repr(Rust)` enums must remain zero-sized as per
    /// T-lang decisions in https://github.com/rust-lang/reference/pull/2262 and https://github.com/rust-lang/reference/pull/2293
    RANDOMIZE_LAYOUT: (1 << 4) as ReprFlags,
    /// If true, the type is always passed indirectly by non-Rustic ABIs.
    /// See [`TyAndLayout::pass_indirectly_in_non_rustic_abis`] for details.
    PASS_INDIRECTLY_IN_NON_RUSTIC_ABIS: (1 << 5) as ReprFlags,
    IS_SCALABLE: (1 << 6) as ReprFlags,
    // Any of these flags being set prevent field reordering optimisation.
    FIELD_ORDER_UNOPTIMIZABLE: ((1 << 0) | (1 << 1) | (1 << 6) | (1 << 3)) as ReprFlags,
    ABI_UNOPTIMIZABLE: ((1 << 0) | (1 << 1)) as ReprFlags,
  },
  [
    ["IS_C", (1 << 0) as ReprFlags],
    ["IS_SIMD", (1 << 1) as ReprFlags],
    ["IS_TRANSPARENT", (1 << 2) as ReprFlags],
    ["IS_LINEAR", (1 << 3) as ReprFlags],
    ["RANDOMIZE_LAYOUT", (1 << 4) as ReprFlags],
    ["PASS_INDIRECTLY_IN_NON_RUSTIC_ABIS", (1 << 5) as ReprFlags],
    ["IS_SCALABLE", (1 << 6) as ReprFlags],
    ["FIELD_ORDER_UNOPTIMIZABLE", ((1 << 0) | (1 << 1) | (1 << 6) | (1 << 3)) as ReprFlags],
    ["ABI_UNOPTIMIZABLE", ((1 << 0) | (1 << 1)) as ReprFlags],
  ],
);

// This is the same as `rustc_data_structures::external_bitflags_debug` but without the
// `rustc_data_structures` to make it build on stable.
// impl std::fmt::Debug for ReprFlags
// rustc: compiler/rustc_abi/src/lib.rs:116 fmt
export const debug_ReprFlags: Debug<ReprFlags> = (v) => to_writer(ReprFlags.FLAGS_DESC, v);

// #[derive(Copy, Clone, Debug, Eq, PartialEq)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
export type IntegerType =
  /// Pointer-sized integer type, i.e. `isize` and `usize`. The field shows signedness, e.g.
  /// `Pointer(true)` means `isize`.
  | { readonly $: "Pointer"; readonly _0: boolean }
  /// Fixed-sized integer type, e.g. `i8`, `u32`, `i128`. The bool field shows signedness, e.g.
  /// `Fixed(I8, false)` means `u8`.
  | { readonly $: "Fixed"; readonly _0: Integer; readonly _1: boolean };
export const IntegerType = {
  // rustc: compiler/rustc_abi/src/lib.rs:133 is_signed
  is_signed(self: IntegerType): boolean {
    switch (self.$) {
      case "Pointer":
        return self._0;
      case "Fixed":
        return self._1;
    }
  },
};
// derive(Debug)
export const debug_IntegerType: Debug<IntegerType> = (v, f) => {
  switch (v.$) {
    case "Pointer":
      return debug_tuple(f, "Pointer", [debug_bool(v._0, f)]);
    case "Fixed":
      return debug_tuple(f, "Fixed", [debug_Integer(v._0, f), debug_bool(v._1, f)]);
  }
};
// derive(PartialEq)
export function IntegerType_eq(a: IntegerType, b: IntegerType): boolean {
  switch (a.$) {
    case "Pointer":
      return b.$ === "Pointer" && a._0 === b._0;
    case "Fixed":
      return b.$ === "Fixed" && a._0 === b._0 && a._1 === b._1;
  }
}

// #[derive(Copy, Clone, Debug, Eq, PartialEq)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
export type ScalableElt =
  /// `N` in `rustc_scalable_vector(N)` - the element count of the scalable vector
  | { readonly $: "ElementCount"; readonly _0: number }
  /// `rustc_scalable_vector` w/out `N`, used for tuple types of scalable vectors that only
  /// contain other scalable vectors
  | { readonly $: "Container" };
/** Unit variants of `ScalableElt`, shared frozen singletons. */
export const ScalableElt = {
  Container: Object.freeze({ $: "Container" }) as ScalableElt,
};
// derive(Debug)
export const debug_ScalableElt: Debug<ScalableElt> = (v, f) => {
  switch (v.$) {
    case "ElementCount":
      return debug_tuple(f, "ElementCount", [debug_int(v._0, f)]);
    case "Container":
      return "Container";
  }
};
// derive(PartialEq)
export function ScalableElt_eq(a: ScalableElt, b: ScalableElt): boolean {
  switch (a.$) {
    case "ElementCount":
      return b.$ === "ElementCount" && a._0 === b._0;
    case "Container":
      return b.$ === "Container";
  }
}

/// Represents the repr options provided by the user.
// #[derive(Copy, Clone, Debug, Eq, PartialEq, Default)]
// #[cfg_attr(feature = "nightly", derive(Encodable_NoContext, Decodable_NoContext, StableHash))]
export class ReprOptions {
  constructor(
    public int: IntegerType | undefined,
    public align: Align | undefined,
    public pack: Align | undefined,
    public flags: ReprFlags,
    /// `#[rustc_scalable_vector]`
    public scalable: ScalableElt | undefined,
    /// The seed to be used for randomizing a type's layout
    ///
    /// Note: This could technically be a `u128` which would
    /// be the "most accurate" hash as it'd encompass the item and crate
    /// hash without loss, but it does pay the price of being larger.
    /// Everything's a tradeoff, a 64-bit seed should be sufficient for our
    /// purposes (primarily `-Z randomize-layout`)
    public field_shuffle_seed: Hash64,
  ) {}

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:173 simd
  simd(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_SIMD);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:178 scalable
  // PORT: the method is `is_scalable` because the field `scalable` takes the name (a TS class cannot have both).
  is_scalable(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_SCALABLE);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:183 c
  c(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_C);
  }

  /// Returns whether this is (implicitly or explicitly) `repr(Rust)`, i.e., its layout
  /// is defined by Rust and we make no stable commitments.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:190 rust
  rust(): boolean {
    // `linear` is currently just an internal flag we set on Box; that's still `repr(Rust)`.
    return !this.c() && !this.simd() && !this.is_scalable() && !this.transparent();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:196 packed
  packed(): boolean {
    return this.pack !== undefined;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:201 transparent
  transparent(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_TRANSPARENT);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:206 linear
  linear(): boolean {
    return ReprFlags.contains(this.flags, ReprFlags.IS_LINEAR);
  }

  /// Returns the discriminant type, given these `repr` options.
  /// This must only be called on enums!
  ///
  /// This is the "typeck type" of the discriminant, which is effectively the maximum size:
  /// discriminant values will be wrapped to fit (with a lint). Layout can later decide to use a
  /// smaller type for the tag that stores the discriminant at runtime and that will work just
  /// fine, it just induces casts when getting/setting the discriminant.
  // rustc: compiler/rustc_abi/src/lib.rs:217 discr_type
  discr_type(): IntegerType {
    return this.int ?? { $: "Pointer", _0: true };
  }

  /// Returns `true` if this `#[repr()]` should inhabit "smart enum
  /// layout" optimizations, such as representing `Foo<&T>` as a
  /// single pointer.
  // rustc: compiler/rustc_abi/src/lib.rs:224 inhibit_enum_layout_opt
  inhibit_enum_layout_opt(): boolean {
    return this.c() || this.int !== undefined;
  }

  // rustc: compiler/rustc_abi/src/lib.rs:228 inhibit_newtype_abi_optimization
  inhibit_newtype_abi_optimization(): boolean {
    return ReprFlags.intersects(this.flags, ReprFlags.ABI_UNOPTIMIZABLE);
  }

  /// Returns `true` if this `#[repr()]` guarantees a fixed field order,
  /// e.g. `repr(C)` or `repr(<int>)`.
  // rustc: compiler/rustc_abi/src/lib.rs:234 inhibit_struct_field_reordering
  inhibit_struct_field_reordering(): boolean {
    return ReprFlags.intersects(this.flags, ReprFlags.FIELD_ORDER_UNOPTIMIZABLE) || this.int !== undefined;
  }

  /// Returns `true` if this type is valid for reordering and `-Z randomize-layout`
  /// was enabled for its declaration crate.
  // rustc: compiler/rustc_abi/src/lib.rs:240 can_randomize_type_layout
  can_randomize_type_layout(): boolean {
    return !this.inhibit_struct_field_reordering() && ReprFlags.contains(this.flags, ReprFlags.RANDOMIZE_LAYOUT);
  }

  /// Returns `true` if this `#[repr()]` should inhibit union ABI optimisations.
  // rustc: compiler/rustc_abi/src/lib.rs:245 inhibits_union_abi_opt
  inhibits_union_abi_opt(): boolean {
    return this.c();
  }

  /// Ensures two `repr` are equal up to the seed.
  // rustc: compiler/rustc_abi/src/lib.rs:250 equal_up_to_seed
  equal_up_to_seed(other: ReprOptions): boolean {
    const { int, align, pack, flags, scalable } = this;
    return (
      option_eq(int, other.int, IntegerType_eq) &&
      option_eq(align, other.align, Align_eq) &&
      option_eq(pack, other.pack, Align_eq) &&
      flags === other.flags &&
      option_eq(scalable, other.scalable, ScalableElt_eq)
    );
  }
}
// derive(Debug)
export const debug_ReprOptions: Debug<ReprOptions> = (v, f) =>
  debug_struct(f, "ReprOptions", [
    ["int", debug_option(v.int, f, debug_IntegerType)],
    ["align", debug_option(v.align, f, debug_Align)],
    ["pack", debug_option(v.pack, f, debug_Align)],
    ["flags", debug_ReprFlags(v.flags, f)],
    ["scalable", debug_option(v.scalable, f, debug_ScalableElt)],
    ["field_shuffle_seed", debug_Hash64(v.field_shuffle_seed, f)],
  ]);
// derive(PartialEq)
export function ReprOptions_eq(a: ReprOptions, b: ReprOptions): boolean {
  return a.equal_up_to_seed(b) && a.field_shuffle_seed === b.field_shuffle_seed;
}

/** `PartialEq for Option<T>` with the given `T` equality. */
function option_eq<T>(a: T | undefined, b: T | undefined, eq: (a: T, b: T) => boolean): boolean {
  return a === undefined || b === undefined ? a === b : eq(a, b);
}

/// How pointers are represented in a given address space
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
export interface PointerSpec {
  /// The size of the bitwise representation of the pointer.
  pointer_size: Size;
  /// The alignment of pointers for this address space
  pointer_align: Align;
  /// The size of the value a pointer can be offset by in this address space.
  pointer_offset: Size;
  /// Pointers into this address space contain extra metadata
  /// FIXME(workingjubilee): Consider adequately reflecting this in the compiler?
  _is_fat: boolean;
}

/// Parsed [Data layout](https://llvm.org/docs/LangRef.html#data-layout)
/// for a target, which contains everything needed to compute layouts.
// #[derive(Debug, PartialEq, Eq)]
export class TargetDataLayout {
  constructor(
    public endian: Endian,
    public i1_align: Align,
    public i8_align: Align,
    public i16_align: Align,
    public i32_align: Align,
    public i64_align: Align,
    public i128_align: Align,
    public f16_align: Align,
    public f32_align: Align,
    public f64_align: Align,
    public f128_align: Align,
    public aggregate_align: Align,

    /// Alignments for vector types.
    public vector_align: [Size, Align][],

    public default_address_space: AddressSpace,
    public default_address_space_pointer_spec: PointerSpec,

    /// Address space information of all known address spaces.
    ///
    /// # Note
    ///
    /// This vector does not contain the [`PointerSpec`] relative to the default address space,
    /// which instead lives in [`Self::default_address_space_pointer_spec`].
    public address_space_info: [AddressSpace, PointerSpec][],

    public instruction_address_space: AddressSpace,

    /// Minimum size of #[repr(C)] enums (default c_int::BITS, usually 32)
    /// Note: This isn't in LLVM's data layout string, it is `short_enum`
    /// so the only valid spec for LLVM is c_int::BITS or 8
    public c_enum_min_size: Integer,
  ) {}

  /// Creates an instance of `TargetDataLayout`.
  // rustc: compiler/rustc_abi/src/lib.rs:357 default
  static default(): TargetDataLayout {
    const align = (bits: number): Align => {
      const r = Align.from_bits(bits);
      if (r.$ === "Err") panic(`called \`Result::unwrap()\` on an \`Err\` value: ${display_AlignFromBytesError(r._0)}`);
      return r._0;
    };
    return new TargetDataLayout(
      /* endian */ "Big",
      /* i1_align */ align(8),
      /* i8_align */ align(8),
      /* i16_align */ align(16),
      /* i32_align */ align(32),
      /* i64_align */ align(32),
      /* i128_align */ align(32),
      /* f16_align */ align(16),
      /* f32_align */ align(32),
      /* f64_align */ align(64),
      /* f128_align */ align(128),
      /* aggregate_align */ align(8),
      /* vector_align */ [
        [Size.from_bits(64), align(64)],
        [Size.from_bits(128), align(128)],
      ],
      /* default_address_space */ AddressSpace.ZERO,
      /* default_address_space_pointer_spec */ {
        pointer_size: Size.from_bits(64),
        pointer_align: align(64),
        pointer_offset: Size.from_bits(64),
        _is_fat: false,
      },
      /* address_space_info */ [],
      /* instruction_address_space */ AddressSpace.ZERO,
      /* c_enum_min_size */ "I32",
    );
  }

  /// Parse data layout from an
  /// [llvm data layout string](https://llvm.org/docs/LangRef.html#data-layout)
  ///
  /// This function doesn't fill `c_enum_min_size` and it will always be `I32` since it can not be
  /// determined from llvm string.
  // rustc: compiler/rustc_abi/src/lib.rs:452 parse_from_llvm_datalayout_string
  static parse_from_llvm_datalayout_string(
    input: string,
    default_address_space: AddressSpace,
  ): Result<TargetDataLayout, TargetDataLayoutError> {
    // Parse an address space index from a string.
    const parse_address_space = (s: string, cause: string): Result<AddressSpace, TargetDataLayoutError> => {
      const r = parse_u32(s);
      return r.$ === "Ok" ? Ok(r._0 as AddressSpace) : Err({ $: "InvalidAddressSpace", addr_space: s, cause, err: r._0 });
    };

    // Parse a bit count from a string.
    const parse_bits = (s: string, kind: string, cause: string): Result<number, TargetDataLayoutError> => {
      const r = parse_u64(s);
      return r.$ === "Ok" ? r : Err({ $: "InvalidBits", kind, bit: s, cause, err: r._0 });
    };

    // Parse a size string.
    const parse_size = (s: string, cause: string): Result<Size, TargetDataLayoutError> => {
      const r = parse_bits(s, "size", cause);
      return r.$ === "Ok" ? Ok(Size.from_bits(r._0)) : r;
    };

    // Parse an alignment string.
    const parse_align_str = (s: string, cause: string): Result<Align, TargetDataLayoutError> => {
      const align_from_bits = (bits: number): Result<Align, TargetDataLayoutError> => {
        const r = Align.from_bits(bits);
        return r.$ === "Ok" ? r : Err({ $: "InvalidAlignment", cause, err: r._0 });
      };
      const abi = parse_bits(s, "alignment", cause);
      if (abi.$ === "Err") return abi;
      const a = align_from_bits(abi._0);
      if (a.$ === "Err") return a;
      return Ok(a._0);
    };

    // Parse an alignment sequence, possibly in the form `<align>[:<preferred_alignment>]`,
    // ignoring the secondary alignment specifications.
    const parse_align_seq = (s: readonly string[], cause: string): Result<Align, TargetDataLayoutError> => {
      if (s.length === 0) {
        return Err({ $: "MissingAlignment", cause });
      }
      return parse_align_str(s[0]!, cause);
    };

    const dl = TargetDataLayout.default();
    dl.default_address_space = default_address_space;

    let i128_align_src = 64;
    for (const spec of input.split("-")) {
      const spec_parts = spec.split(":");

      // PORT: slice patterns, in arm order.
      const [p0, p1, p2, p3, p4] = spec_parts;
      const n = spec_parts.length;
      if (n === 1 && p0 === "e") {
        dl.endian = "Little";
      } else if (n === 1 && p0 === "E") {
        dl.endian = "Big";
      } else if (n === 1 && p0!.startsWith("P")) {
        const r = parse_address_space(p0!.slice(1), "P");
        if (r.$ === "Err") return r;
        dl.instruction_address_space = r._0;
      } else if (n >= 1 && p0 === "a") {
        const r = parse_align_seq(spec_parts.slice(1), "a");
        if (r.$ === "Err") return r;
        dl.aggregate_align = r._0;
      } else if (n >= 1 && p0 === "f16") {
        const r = parse_align_seq(spec_parts.slice(1), "f16");
        if (r.$ === "Err") return r;
        dl.f16_align = r._0;
      } else if (n >= 1 && p0 === "f32") {
        const r = parse_align_seq(spec_parts.slice(1), "f32");
        if (r.$ === "Err") return r;
        dl.f32_align = r._0;
      } else if (n >= 1 && p0 === "f64") {
        const r = parse_align_seq(spec_parts.slice(1), "f64");
        if (r.$ === "Err") return r;
        dl.f64_align = r._0;
      } else if (n >= 1 && p0 === "f128") {
        const r = parse_align_seq(spec_parts.slice(1), "f128");
        if (r.$ === "Err") return r;
        dl.f128_align = r._0;
      } else if (n >= 2 && p0!.startsWith("p")) {
        // `[p, s, a @ ..] if p.starts_with("p")`
        const s = p1!;
        const a = spec_parts.slice(2);
        let p = p0!.slice(1);
        let _is_fat = false;

        // Some targets, such as CHERI, use the 'f' suffix in the p- spec to signal that
        // they use 'fat' pointers. The resulting prefix may look like `pf<addr_space>`.

        if (p.startsWith("f")) {
          p = p.slice(1);
          _is_fat = true;
        }

        // However, we currently don't take into account further specifications:
        // an error is emitted instead.
        if (starts_with_alphabetic(p)) {
          return Err({ $: "UnknownPointerSpecification", err: p });
        }

        let addr_space: AddressSpace;
        if (p.length !== 0) {
          const r = parse_address_space(p, "p-");
          if (r.$ === "Err") return r;
          addr_space = r._0;
        } else {
          addr_space = AddressSpace.ZERO;
        }

        const pointer_size = parse_size(s, "p-");
        if (pointer_size.$ === "Err") return pointer_size;
        const pointer_align = parse_align_seq(a, "p-");
        if (pointer_align.$ === "Err") return pointer_align;
        const info: PointerSpec = {
          pointer_offset: pointer_size._0,
          pointer_size: pointer_size._0,
          pointer_align: pointer_align._0,
          _is_fat,
        };
        if (addr_space === default_address_space) {
          dl.default_address_space_pointer_spec = info;
        } else {
          const e = dl.address_space_info.find(([a]) => a === addr_space);
          if (e !== undefined) {
            e[1] = info;
          } else {
            dl.address_space_info.push([addr_space, info]);
          }
        }
      } else if (n === 5 && p0!.startsWith("p")) {
        // `[p, s, a, _pr, i] if p.starts_with("p")`
        // PORT: unreachable at the pin (the arm above already matches every `p` spec with >= 2
        // parts); kept for fidelity.
        void p3;
        let p = p0!.slice(1);
        let _is_fat = false;

        // Some targets, such as CHERI, use the 'f' suffix in the p- spec to signal that
        // they use 'fat' pointers. The resulting prefix may look like `pf<addr_space>`.

        if (p.startsWith("f")) {
          p = p.slice(1);
          _is_fat = true;
        }

        // However, we currently don't take into account further specifications:
        // an error is emitted instead.
        if (starts_with_alphabetic(p)) {
          return Err({ $: "UnknownPointerSpecification", err: p });
        }

        let addr_space: AddressSpace;
        if (p.length !== 0) {
          const r = parse_address_space(p, "p");
          if (r.$ === "Err") return r;
          addr_space = r._0;
        } else {
          addr_space = AddressSpace.ZERO;
        }

        const pointer_size = parse_size(p1!, "p-");
        if (pointer_size.$ === "Err") return pointer_size;
        const pointer_align = parse_align_str(p2!, "p-");
        if (pointer_align.$ === "Err") return pointer_align;
        const pointer_offset = parse_size(p4!, "p-");
        if (pointer_offset.$ === "Err") return pointer_offset;
        const info: PointerSpec = {
          pointer_size: pointer_size._0,
          pointer_align: pointer_align._0,
          pointer_offset: pointer_offset._0,
          _is_fat,
        };

        if (addr_space === default_address_space) {
          dl.default_address_space_pointer_spec = info;
        } else {
          const e = dl.address_space_info.find(([a]) => a === addr_space);
          if (e !== undefined) {
            e[1] = info;
          } else {
            dl.address_space_info.push([addr_space, info]);
          }
        }
      } else if (n >= 1 && p0!.startsWith("i")) {
        const s = p0!;
        const bits_r = parse_u64(s.slice(1));
        if (bits_r.$ === "Err") {
          const r = parse_size(s.slice(1), "i"); // For the user error.
          if (r.$ === "Err") return r;
          continue;
        }
        const bits = bits_r._0;
        const a_r = parse_align_seq(spec_parts.slice(1), s);
        if (a_r.$ === "Err") return a_r;
        const a = a_r._0;
        switch (bits) {
          case 1:
            dl.i1_align = a;
            break;
          case 8:
            dl.i8_align = a;
            break;
          case 16:
            dl.i16_align = a;
            break;
          case 32:
            dl.i32_align = a;
            break;
          case 64:
            dl.i64_align = a;
            break;
          default:
            break;
        }
        if (bits >= i128_align_src && bits <= 128) {
          // Default alignment for i128 is decided by taking the alignment of
          // largest-sized i{64..=128}.
          i128_align_src = bits;
          dl.i128_align = a;
        }
      } else if (n >= 1 && p0!.startsWith("v")) {
        const s = p0!;
        const v_size = parse_size(s.slice(1), "v");
        if (v_size.$ === "Err") return v_size;
        const a = parse_align_seq(spec_parts.slice(1), s);
        if (a.$ === "Err") return a;
        const v = dl.vector_align.find((v) => v[0].raw === v_size._0.raw);
        if (v !== undefined) {
          v[1] = a._0;
          continue;
        }
        // No existing entry, add a new one.
        dl.vector_align.push([v_size._0, a._0]);
      } else {
        // Ignore everything else.
      }
    }

    // Inherit, if not given, address space information for specific LLVM elements from the
    // default data address space.
    if (
      dl.instruction_address_space !== dl.default_address_space &&
      dl.address_space_info.find(([a]) => a === dl.instruction_address_space) === undefined
    ) {
      dl.address_space_info.push([dl.instruction_address_space, { ...dl.default_address_space_pointer_spec }]);
    }

    return Ok(dl);
  }

  /// Returns **exclusive** upper bound on object size in bytes, in the default data address
  /// space.
  ///
  /// The theoretical maximum object size is defined as the maximum positive `isize` value.
  /// This ensures that the `offset` semantics remain well-defined by allowing it to correctly
  /// index every address within an object along with one byte past the end, along with allowing
  /// `isize` to store the difference between any two pointers into an object.
  ///
  /// LLVM uses a 64-bit integer to represent object size in *bits*, but we care only for bytes,
  /// so we adopt such a more-constrained size bound due to its technical limitations.
  // #[inline]
  // PORT: `u64` -> `number`: the bounds are powers of two (exact as doubles).
  // rustc: compiler/rustc_abi/src/lib.rs:668 obj_size_bound
  obj_size_bound(): number {
    const bits = this.pointer_size().bits();
    switch (bits) {
      case 16:
        return 2 ** 15;
      case 32:
        return 2 ** 31;
      case 64:
        return 2 ** 61;
      default:
        return panic(`obj_size_bound: unknown pointer bit size ${bits}`);
    }
  }

  /// Returns **exclusive** upper bound on object size in bytes.
  ///
  /// The theoretical maximum object size is defined as the maximum positive `isize` value.
  /// This ensures that the `offset` semantics remain well-defined by allowing it to correctly
  /// index every address within an object along with one byte past the end, along with allowing
  /// `isize` to store the difference between any two pointers into an object.
  ///
  /// LLVM uses a 64-bit integer to represent object size in *bits*, but we care only for bytes,
  /// so we adopt such a more-constrained size bound due to its technical limitations.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:687 obj_size_bound_in
  obj_size_bound_in(address_space: AddressSpace): number {
    const bits = this.pointer_size_in(address_space).bits();
    switch (bits) {
      case 16:
        return 2 ** 15;
      case 32:
        return 2 ** 31;
      case 64:
        return 2 ** 61;
      default:
        return panic(`obj_size_bound: unknown pointer bit size ${bits}`);
    }
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:697 ptr_sized_integer
  ptr_sized_integer(): Integer {
    const bits = this.pointer_offset().bits();
    switch (bits) {
      case 16:
        return "I16";
      case 32:
        return "I32";
      case 64:
        return "I64";
      default:
        return panic(`ptr_sized_integer: unknown pointer bit size ${bits}`);
    }
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:708 ptr_sized_integer_in
  ptr_sized_integer_in(address_space: AddressSpace): Integer {
    const bits = this.pointer_offset_in(address_space).bits();
    switch (bits) {
      case 16:
        return "I16";
      case 32:
        return "I32";
      case 64:
        return "I64";
      default:
        return panic(`ptr_sized_integer: unknown pointer bit size ${bits}`);
    }
  }

  /// psABI-mandated alignment for a vector type, if any
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:720 c_vector_align
  private c_vector_align(vec_size: Size): Align | undefined {
    const e = this.vector_align.find(([size, _align]) => size.bytes() === vec_size.bytes());
    return e === undefined ? undefined : e[1];
  }

  /// Rust-assigned alignment of any vector type
  ///
  /// When the shape of a vector matches that in a C psABI, we *must* agree when performing FFI.
  /// This currently answers correctly for C compatibility purposes as it is a useful default.
  /// Otherwise this choice is arbitrary, as vector types do not necessarily match hardware so
  /// this can conjure "imaginary" answers that just happen to be convenient for us.
  ///
  /// Importantly, Rust vector alignment is not required to be monotonic between vector sizes,
  /// even though it currently is.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:737 rust_vector_align
  rust_vector_align(vec_size: Size): Align {
    // PORT: `unwrap_or` evaluates its argument eagerly; so does this.
    const fallback = Align.from_bytes(next_power_of_two(vec_size.bytes()));
    if (fallback.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
    return this.c_vector_align(vec_size) ?? fallback._0;
  }

  /// Get the pointer size in the default data address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:744 pointer_size
  pointer_size(): Size {
    return this.default_address_space_pointer_spec.pointer_size;
  }

  /// Get the pointer size in a specific address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:750 pointer_size_in
  pointer_size_in(c: AddressSpace): Size {
    if (c === this.default_address_space) {
      return this.default_address_space_pointer_spec.pointer_size;
    }

    const e = this.address_space_info.find(([a]) => a === c);
    if (e !== undefined) {
      return e[1].pointer_size;
    } else {
      return panic(`Use of unknown address space AddressSpace(${c})`);
    }
  }

  /// Get the pointer index in the default data address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:764 pointer_offset
  pointer_offset(): Size {
    return this.default_address_space_pointer_spec.pointer_offset;
  }

  /// Get the pointer index in a specific address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:770 pointer_offset_in
  pointer_offset_in(c: AddressSpace): Size {
    if (c === this.default_address_space) {
      return this.default_address_space_pointer_spec.pointer_offset;
    }

    const e = this.address_space_info.find(([a]) => a === c);
    if (e !== undefined) {
      return e[1].pointer_offset;
    } else {
      return panic(`Use of unknown address space AddressSpace(${c})`);
    }
  }

  /// Get the pointer alignment in the default data address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:784 pointer_align
  pointer_align(): AbiAlign {
    return AbiAlign.new(this.default_address_space_pointer_spec.pointer_align);
  }

  /// Get the pointer alignment in a specific address space.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:790 pointer_align_in
  pointer_align_in(c: AddressSpace): AbiAlign {
    let align: Align;
    if (c === this.default_address_space) {
      align = this.default_address_space_pointer_spec.pointer_align;
    } else {
      const e = this.address_space_info.find(([a]) => a === c);
      if (e !== undefined) {
        align = e[1].pointer_align;
      } else {
        return panic(`Use of unknown address space AddressSpace(${c})`);
      }
    }
    return AbiAlign.new(align);
  }

  // impl HasDataLayout for TargetDataLayout (PORTING §8: a later impl block's method in the class body)
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:807 data_layout
  data_layout(): TargetDataLayout {
    return this;
  }
}

// PORT: the trait is an interface; generic `C: HasDataLayout` parameters take any object with `data_layout()`.
export interface HasDataLayout {
  // rustc: compiler/rustc_abi/src/lib.rs:802 data_layout
  data_layout(): TargetDataLayout;
}

/** `u64::next_power_of_two` (the sizes here stay far below 2^53). */
function next_power_of_two(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** `p.starts_with(char::is_alphabetic)` */
function starts_with_alphabetic(p: string): boolean {
  const c = p.codePointAt(0);
  return c !== undefined && is_alphabetic(c);
}

export type TargetDataLayoutError =
  | { readonly $: "InvalidAddressSpace"; readonly addr_space: string; readonly cause: string; readonly err: ParseIntError }
  | { readonly $: "InvalidBits"; readonly kind: string; readonly bit: string; readonly cause: string; readonly err: ParseIntError }
  | { readonly $: "MissingAlignment"; readonly cause: string }
  | { readonly $: "InvalidAlignment"; readonly cause: string; readonly err: AlignFromBytesError }
  | { readonly $: "InconsistentTargetArchitecture"; readonly dl: string; readonly target: string }
  | { readonly $: "InconsistentTargetPointerWidth"; readonly pointer_size: number; readonly target: number }
  | { readonly $: "InvalidBitsSize"; readonly err: string }
  | { readonly $: "UnknownPointerSpecification"; readonly err: string };

// #[cfg(feature = "nightly")]
// impl Diagnostic<'_> for TargetDataLayoutError<'_>
// PORT: not ported (no marker): every built-in target's data layout parses; a target JSON (unported)
// is the only way to reach these errors.
export function TargetDataLayoutError_into_diag(_e: TargetDataLayoutError): never {
  return unported("rustc_abi::TargetDataLayoutError::into_diag");
}

/// Endianness of the target, which must match cfg(target-endian).
// #[derive(Copy, Clone, PartialEq, Eq)]
export type Endian = "Little" | "Big";
export const Endian = {
  Little: "Little",
  Big: "Big",

  // rustc: compiler/rustc_abi/src/lib.rs:828 as_str
  as_str(self: Endian): string {
    switch (self) {
      case "Little":
        return "little";
      case "Big":
        return "big";
    }
  },

  // #[cfg(feature = "nightly")]
  // rustc: compiler/rustc_abi/src/lib.rs:836 desc_symbol
  desc_symbol(self: Endian): Symbol {
    switch (self) {
      case "Little":
        return sym.little;
      case "Big":
        return sym.big;
    }
  },

  // impl FromStr for Endian
  // rustc: compiler/rustc_abi/src/lib.rs:853 from_str
  from_str(s: string): Result<Endian, string> {
    switch (s) {
      case "little":
        return Ok("Little");
      case "big":
        return Ok("Big");
      default:
        return Err(`unknown endian: "${s}"`);
    }
  },
} as const;
// impl fmt::Debug for Endian
// rustc: compiler/rustc_abi/src/lib.rs:845 fmt
export const debug_Endian: Debug<Endian> = (v) => Endian.as_str(v);

/// Size of a type in bytes.
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
// PORT: `raw: u64` is a `number` (byte sizes stay far below 2^53).
export class Size {
  constructor(readonly raw: number) {}

  static readonly ZERO: Size = new Size(0);

  /// Rounds `bits` up to the next-higher byte boundary, if `bits` is
  /// not a multiple of 8.
  // rustc: compiler/rustc_abi/src/lib.rs:890 from_bits
  static from_bits(bits: number): Size {
    return new Size(Math.ceil(bits / 8));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:896 from_bytes
  static from_bytes(bytes: number): Size {
    return new Size(bytes);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:902 bytes
  bytes(): number {
    return this.raw;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:907 bytes_usize
  bytes_usize(): number {
    return this.bytes();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:912 bits
  bits(): number {
    // PORT: `checked_mul(8)` cannot overflow for the sizes rust-ts handles (< 2^53 / 8), so the nested
    // `#[cold] fn overflow` (lib.rs:914) is never called and not ported.
    return this.bytes() * 8;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:922 bits_usize
  bits_usize(): number {
    return this.bits();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:927 align_to
  align_to(align: Align): Size {
    // PORT: the mask arithmetic in `bigint` (JS bitwise operators are 32-bit).
    const mask = BigInt(align.bytes()) - 1n;
    return Size.from_bytes(Number((BigInt(this.bytes()) + mask) & ~mask));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:933 is_aligned
  is_aligned(align: Align): boolean {
    const mask = BigInt(align.bytes()) - 1n;
    return (BigInt(this.bytes()) & mask) === 0n;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:939 checked_add
  checked_add(offset: Size, cx: HasDataLayout): Size | undefined {
    const dl = cx.data_layout();

    // PORT: `u64::checked_add` cannot overflow for byte counts below 2^53.
    const bytes = this.bytes() + offset.bytes();

    return bytes < dl.obj_size_bound() ? Size.from_bytes(bytes) : undefined;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:948 checked_mul
  checked_mul(count: number, cx: HasDataLayout): Size | undefined {
    const dl = cx.data_layout();

    // PORT: `u64::checked_mul` in `bigint`; a product of 2^64 or more is `None` as upstream.
    const bytes = BigInt(this.bytes()) * BigInt(count);
    if (bytes > U64_MAX) return undefined;
    return bytes < BigInt(dl.obj_size_bound()) ? Size.from_bytes(Number(bytes)) : undefined;
  }

  /// Truncates `value` to `self` bits and then sign-extends it to 128 bits
  /// (i.e., if it is negative, fill with 1's on the left).
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:958 sign_extend
  sign_extend(value: bigint): bigint {
    const size = this.bits();
    if (size === 0) {
      // Truncated until nothing is left.
      return 0n;
    }
    // Sign-extend it.
    const shift = BigInt(128 - size);
    // Shift the unsigned value to the left, then shift back to the right as signed
    // (essentially fills with sign bit on the left).
    return BigInt.asIntN(128, (value << shift) & U128_MAX) >> shift;
  }

  /// Truncates `value` to `self` bits.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:973 truncate
  truncate(value: bigint): bigint {
    const size = this.bits();
    if (size === 0) {
      // Truncated until nothing is left.
      return 0n;
    }
    const shift = BigInt(128 - size);
    // Truncate (shift left to drop out leftover values, shift right to fill with zeroes).
    return ((value << shift) & U128_MAX) >> shift;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:985 signed_int_min
  signed_int_min(): bigint {
    return this.sign_extend(1n << BigInt(this.bits() - 1));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:990 signed_int_max
  signed_int_max(): bigint {
    return I128_MAX >> BigInt(128 - this.bits());
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:995 unsigned_int_max
  unsigned_int_max(): bigint {
    return U128_MAX >> BigInt(128 - this.bits());
  }
}
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const I128_MAX = (1n << 127n) - 1n;
// This is debug-printed a lot in larger structs, don't waste too much space there
// impl fmt::Debug for Size
// rustc: compiler/rustc_abi/src/lib.rs:880 fmt
export const debug_Size: Debug<Size> = (v) => `Size(${v.bytes()} bytes)`;

/// Alignment of a type in bytes (always a power of two).
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
export class Align {
  constructor(readonly pow2: number) {}

  static readonly ONE: Align = new Align(0);
  static readonly EIGHT: Align = new Align(3);
  // LLVM has a maximal supported alignment of 2^29, we inherit that.
  static readonly MAX: Align = new Align(29);

  /// Either `1 << (pointer_bits - 1)` or [`Align::MAX`], whichever is smaller.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1142 max_for_target
  static max_for_target(tdl: TargetDataLayout): Align {
    const pointer_bits = tdl.pointer_size().bits();
    assert(pointer_bits <= 255, "called `Result::unwrap()` on an `Err` value");
    return Align_min(new Align(pointer_bits - 1), Align.MAX);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1148 from_bits
  static from_bits(bits: number): Result<Align, AlignFromBytesError> {
    return Align.from_bytes(Size.from_bits(bits).bytes());
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1153 from_bytes
  static from_bytes(align: number | bigint): Result<Align, AlignFromBytesError> {
    // PORT: `align: u64`; callers pass a `number` or (from `-Z min-function-alignment`) a `bigint`.
    const a = BigInt(align);
    // Treat an alignment of 0 bytes like 1-byte alignment.
    if (a === 0n) {
      return Ok(Align.ONE);
    }

    // #[cold]
    // rustc: compiler/rustc_abi/src/lib.rs:1160 not_power_of_2
    const not_power_of_2 = (align: bigint): AlignFromBytesError => ({ $: "NotPowerOfTwo", _0: align });

    // #[cold]
    // rustc: compiler/rustc_abi/src/lib.rs:1165 too_large
    const too_large = (align: bigint): AlignFromBytesError => ({ $: "TooLarge", _0: align });

    let tz = 0;
    while (((a >> BigInt(tz)) & 1n) === 0n) tz++;
    if (a !== 1n << BigInt(tz)) {
      return Err(not_power_of_2(a));
    }

    const pow2 = tz;
    if (pow2 > Align.MAX.pow2) {
      return Err(too_large(a));
    }

    return Ok(new Align(pow2));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1183 bytes
  bytes(): number {
    return 2 ** this.pow2;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1188 bytes_usize
  bytes_usize(): number {
    return this.bytes();
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1193 bits
  bits(): number {
    return this.bytes() * 8;
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1198 bits_usize
  bits_usize(): number {
    return this.bits();
  }

  /// Obtain the greatest factor of `size` that is an alignment
  /// (the largest power of two the Size is a multiple of).
  ///
  /// Note that all numbers are factors of 0
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1207 max_aligned_factor
  static max_aligned_factor(size: Size): Align {
    // `size.bytes().trailing_zeros() as u8` (`u64::trailing_zeros(0)` is 64)
    let b = BigInt(size.bytes());
    if (b === 0n) return new Align(64);
    let tz = 0;
    while ((b & 1n) === 0n) {
      b >>= 1n;
      tz++;
    }
    return new Align(tz);
  }

  /// Reduces Align to an aligned factor of `size`.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1213 restrict_for_offset
  restrict_for_offset(size: Size): Align {
    return Align_min(this, Align.max_aligned_factor(size));
  }
}
// derive(PartialEq): `Align { pow2 }` (instances are not unique, so compare the field).
export function Align_eq(a: Align, b: Align): boolean {
  return a.pow2 === b.pow2;
}
// derive(Ord): `Ord::min` / `Ord::max` (`max` returns `other` on ties, `min` returns `self`).
export function Align_min(a: Align, b: Align): Align {
  return b.pow2 < a.pow2 ? b : a;
}
export function Align_max(a: Align, b: Align): Align {
  return b.pow2 >= a.pow2 ? b : a;
}
// This is debug-printed a lot in larger structs, don't waste too much space there
// impl fmt::Debug for Align
// rustc: compiler/rustc_abi/src/lib.rs:1108 fmt
export const debug_Align: Debug<Align> = (v) => `Align(${v.bytes()} bytes)`;

// #[derive(Clone, Copy)]
// PORT: the `u64` payload is a `bigint` (it is the user's value, unbounded).
export type AlignFromBytesError = { readonly $: "NotPowerOfTwo"; readonly _0: bigint } | { readonly $: "TooLarge"; readonly _0: bigint };

// impl fmt::Display for AlignFromBytesError
// rustc: compiler/rustc_abi/src/lib.rs:1126 fmt
export function display_AlignFromBytesError(e: AlignFromBytesError): string {
  switch (e.$) {
    case "NotPowerOfTwo":
      return `${e._0} is not a power of 2`;
    case "TooLarge":
      return `${e._0} is too large`;
  }
}
// impl fmt::Debug for AlignFromBytesError
// rustc: compiler/rustc_abi/src/lib.rs:1120 fmt
export const debug_AlignFromBytesError: Debug<AlignFromBytesError> = (e) => display_AlignFromBytesError(e);

/// A pair of alignments, ABI-mandated and preferred.
///
/// The "preferred" alignment is an LLVM concept that is virtually meaningless to Rust code:
/// it is not exposed semantically to programmers nor can they meaningfully affect it.
/// The only concern for us is that preferred alignment must not be less than the mandated alignment
/// and thus in practice the two values are almost always identical.
///
/// An example of a rare thing actually affected by preferred alignment is aligning of statics.
/// It is of effectively no consequence for layout in structs and on the stack.
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
export class AbiAlign {
  constructor(readonly abi: Align) {}

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1235 new
  static new(align: Align): AbiAlign {
    return new AbiAlign(align);
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1240 min
  min(other: AbiAlign): AbiAlign {
    return new AbiAlign(Align_min(this.abi, other.abi));
  }

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1245 max
  max(other: AbiAlign): AbiAlign {
    return new AbiAlign(Align_max(this.abi, other.abi));
  }
}
// derive(Debug)
export const debug_AbiAlign: Debug<AbiAlign> = (v, f) => debug_struct(f, "AbiAlign", [["abi", debug_Align(v.abi, f)]]);

/// Integers, also used for enum discriminants.
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
export type Integer = "I8" | "I16" | "I32" | "I64" | "I128";
export const Integer = {
  I8: "I8",
  I16: "I16",
  I32: "I32",
  I64: "I64",
  I128: "I128",

  // rustc: compiler/rustc_abi/src/lib.rs:1270 int_ty_str
  int_ty_str(self: Integer): string {
    switch (self) {
      case "I8":
        return "i8";
      case "I16":
        return "i16";
      case "I32":
        return "i32";
      case "I64":
        return "i64";
      case "I128":
        return "i128";
    }
  },

  // rustc: compiler/rustc_abi/src/lib.rs:1281 uint_ty_str
  uint_ty_str(self: Integer): string {
    switch (self) {
      case "I8":
        return "u8";
      case "I16":
        return "u16";
      case "I32":
        return "u32";
      case "I64":
        return "u64";
      case "I128":
        return "u128";
    }
  },

  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1293 size
  size(self: Integer): Size {
    switch (self) {
      case "I8":
        return Size.from_bytes(1);
      case "I16":
        return Size.from_bytes(2);
      case "I32":
        return Size.from_bytes(4);
      case "I64":
        return Size.from_bytes(8);
      case "I128":
        return Size.from_bytes(16);
    }
  },

  /// Gets the Integer type from an IntegerType.
  // rustc: compiler/rustc_abi/src/lib.rs:1305 from_attr
  from_attr(cx: HasDataLayout, ity: IntegerType): Integer {
    const dl = cx.data_layout();

    switch (ity.$) {
      case "Pointer":
        return dl.ptr_sized_integer();
      case "Fixed":
        return ity._0;
    }
  },

  // rustc: compiler/rustc_abi/src/lib.rs:1314 align
  align(self: Integer, cx: HasDataLayout): AbiAlign {
    const dl = cx.data_layout();

    switch (self) {
      case "I8":
        return AbiAlign.new(dl.i8_align);
      case "I16":
        return AbiAlign.new(dl.i16_align);
      case "I32":
        return AbiAlign.new(dl.i32_align);
      case "I64":
        return AbiAlign.new(dl.i64_align);
      case "I128":
        return AbiAlign.new(dl.i128_align);
    }
  },

  /// Returns the largest signed value that can be represented by this Integer.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1329 signed_max
  signed_max(self: Integer): bigint {
    switch (self) {
      case "I8":
        return 0x7fn;
      case "I16":
        return 0x7fffn;
      case "I32":
        return 0x7fff_ffffn;
      case "I64":
        return 0x7fff_ffff_ffff_ffffn;
      case "I128":
        return (1n << 127n) - 1n;
    }
  },

  /// Returns the smallest signed value that can be represented by this Integer.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1342 signed_min
  signed_min(self: Integer): bigint {
    switch (self) {
      case "I8":
        return -0x80n;
      case "I16":
        return -0x8000n;
      case "I32":
        return -0x8000_0000n;
      case "I64":
        return -0x8000_0000_0000_0000n;
      case "I128":
        return -(1n << 127n);
    }
  },

  /// Finds the smallest Integer type which can represent the signed value.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1355 fit_signed
  fit_signed(x: bigint): Integer {
    if (x >= -0x80n && x <= 0x7fn) return "I8";
    if (x >= -0x8000n && x <= 0x7fffn) return "I16";
    if (x >= -0x8000_0000n && x <= 0x7fff_ffffn) return "I32";
    if (x >= -0x8000_0000_0000_0000n && x <= 0x7fff_ffff_ffff_ffffn) return "I64";
    return "I128";
  },

  /// Finds the smallest Integer type which can represent the unsigned value.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1368 fit_unsigned
  fit_unsigned(x: bigint): Integer {
    if (x >= 0n && x <= 0xffn) return "I8";
    if (x >= 0n && x <= 0xffffn) return "I16";
    if (x >= 0n && x <= 0xffff_ffffn) return "I32";
    if (x >= 0n && x <= 0xffff_ffff_ffff_ffffn) return "I64";
    return "I128";
  },

  /// Finds the smallest integer with the given alignment.
  // rustc: compiler/rustc_abi/src/lib.rs:1380 for_align
  for_align(cx: HasDataLayout, wanted: Align): Integer | undefined {
    const dl = cx.data_layout();

    return (["I8", "I16", "I32", "I64", "I128"] as const).find(
      (candidate) => Align_eq(wanted, Integer.align(candidate, dl).abi) && wanted.bytes() === Integer.size(candidate).bytes(),
    );
  },

  /// Find the largest integer with the given alignment or less.
  // rustc: compiler/rustc_abi/src/lib.rs:1390 approximate_align
  approximate_align(cx: HasDataLayout, wanted: Align): Integer {
    const dl = cx.data_layout();

    // FIXME(eddyb) maybe include I128 in the future, when it works everywhere.
    for (const candidate of ["I64", "I32", "I16"] as const) {
      if (wanted.pow2 >= Integer.align(candidate, dl).abi.pow2 && wanted.bytes() >= Integer.size(candidate).bytes()) {
        return candidate;
      }
    }
    return "I8";
  },

  // FIXME(eddyb) consolidate this and other methods that find the appropriate
  // `Integer` given some requirements.
  // #[inline]
  // rustc: compiler/rustc_abi/src/lib.rs:1406 from_size
  from_size(size: Size): Result<Integer, string> {
    switch (size.bits()) {
      case 8:
        return Ok("I8");
      case 16:
        return Ok("I16");
      case 32:
        return Ok("I32");
      case 64:
        return Ok("I64");
      case 128:
        return Ok("I128");
      default:
        return Err(`rust does not support integers with ${size.bits()} bits`);
    }
  },
} as const;
// derive(Debug)
export const debug_Integer: Debug<Integer> = (v) => v;

/// An identifier that specifies the address space that some operation
/// should operate on. Special address spaces have an effect on code generation,
/// depending on the target and the address spaces it implements.
// #[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
// PORT: the `u32` newtype is a branded number (equality is `===`).
export type AddressSpace = number & { readonly __brand: "AddressSpace" };
export const AddressSpace = {
  /// LLVM's `0` address space.
  ZERO: 0 as AddressSpace,
  /// The address space for constant memory on nvptx and amdgpu.
  /// This address space is used e.g. for kernel arguments that are constant throughout the
  /// execution.
  GPU_CONSTANT: 4 as AddressSpace,
  /// The address space for workgroup memory on nvptx and amdgpu.
  /// See e.g. the `gpu_launch_sized_workgroup_mem` intrinsic for details.
  GPU_WORKGROUP: 3 as AddressSpace,
} as const;
export const debug_AddressSpace: Debug<AddressSpace> = (v) => `AddressSpace(${v})`;

// compiler/rustc_abi/src/extern_abi.rs (subset)

// #[cfg(feature = "nightly")]
// #[derive(Debug)]
export type CVariadicStatus = { readonly $: "NotSupported" } | { readonly $: "Stable" } | { readonly $: "Unstable"; readonly feature: Symbol };
