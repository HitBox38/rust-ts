// compiler/rustc_abi/src/lib.rs (subset). PORT: only what rustc_target's spec and rustc_session's
// `default_configuration` need is ported here: the data layout (`TargetDataLayout` and its parser),
// `Endian`, `Size`, `Align`/`AbiAlign`, `Integer::from_size` and `AddressSpace`. Everything else in the
// crate (layout, reprs, scalars, ...) is not ported yet (`bun scripts/coverage.ts --missing`).
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import type { Debug } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

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
}

/** `p.starts_with(char::is_alphabetic)` (PORT: ASCII letters; data layout strings are ASCII). */
function starts_with_alphabetic(p: string): boolean {
  const c = p.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x80 && /^\p{Alphabetic}/u.test(p));
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
  // rustc: compiler/rustc_abi/src/lib.rs:912 bits
  bits(): number {
    // PORT: `checked_mul(8)` cannot overflow for the sizes rust-ts handles (< 2^53 / 8).
    return this.bytes() * 8;
  }
}
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
  // rustc: compiler/rustc_abi/src/lib.rs:1193 bits
  bits(): number {
    return this.bytes() * 8;
  }
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
}

/// Integers, also used for enum discriminants.
// #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
export type Integer = "I8" | "I16" | "I32" | "I64" | "I128";
export const Integer = {
  I8: "I8",
  I16: "I16",
  I32: "I32",
  I64: "I64",
  I128: "I128",

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
