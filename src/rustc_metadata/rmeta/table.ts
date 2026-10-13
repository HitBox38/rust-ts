// Port of compiler/rustc_metadata/src/rmeta/table.rs.
//
// PORT (lane rmeta-contract):
// - `trait FixedSizeEncoding: IsDefault` (+ `Default`) is a dictionary `FixedSizeEncoding<T>` (PORTING section 5:
//   generic trait bounds become function tables): `BYTE_LEN` is the `[u8; N]` of `ByteArray`, `default` the
//   `Default` impl, `is_default` the `IsDefault` impl. Every impl of the file is one `fse_<T>` value; the
//   `fixed_size_enum!` / `defaulted_enum!` expansions carry the macro arm's markers.
// - `LazyTable::get` / `size` (table.rs:505) are in the `LazyTable` class body in mod.ts.
// - `ByteArray`s are `Uint8Array`s of length `BYTE_LEN`; u64 values are `bigint` (the table holds full 64-bit
//   hashes and positions).
// - `hir::Defaultness`, `hir::Constness`, `hir::CoroutineKind` (+ `CoroutineDesugaring`, `CoroutineSource`) and
//   `ty::Asyncness` live in hir.rs / rustc_middle ty/mod.rs (M3, not ported): their upstream definitions are
//   transcribed below as stand-ins. Move them to src/rustc_hir/hir.ts / src/rustc_middle/ty when those are ported.
import type { Movability, Mutability } from "../../rustc_ast_ir/lib.ts";
import type { CtorKind, CtorOf, DefKind, Safety } from "../../rustc_hir/def.ts";
import { MacroKinds } from "../../rustc_hir/def.ts";
import type { FileEncoder } from "../../rustc_serialize/opaque.ts";
import type { MacroKind } from "../../rustc_span/hygiene.ts";
import { assert, panic, unreachable } from "../../std/panic.ts";
import { AttrFlags, LazyArray, LazyTable, LazyValue, RawDefId } from "./mod.ts";

// ---- stand-ins for unported hir.rs / ty types (PORT, see the header) ----------------------------------------

// rustc-type: compiler/rustc_hir/src/hir.rs:4012 Defaultness
export type Defaultness = { readonly $: "Default"; readonly has_value: boolean } | { readonly $: "Final" };
export const Defaultness = {
  Final: Object.freeze({ $: "Final" as const }) as Defaultness,
};

// rustc-type: compiler/rustc_hir/src/hir.rs:4433 Constness
export type Constness = { readonly $: "Const"; readonly always: boolean } | { readonly $: "NotConst" };
export const Constness = {
  NotConst: Object.freeze({ $: "NotConst" as const }) as Constness,
};

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:236 Asyncness
export type Asyncness = "Yes" | "No";

// rustc-type: compiler/rustc_hir/src/hir.rs:2028 CoroutineSource
export type CoroutineSource = "Block" | "Closure" | "Fn";
// rustc-type: compiler/rustc_hir/src/hir.rs:2051 CoroutineDesugaring
export type CoroutineDesugaring = "Async" | "Gen" | "AsyncGen";
// rustc-type: compiler/rustc_hir/src/hir.rs:1971 CoroutineKind
export type CoroutineKind =
  /// A coroutine that comes from a desugaring.
  | { readonly $: "Desugared"; readonly _0: CoroutineDesugaring; readonly _1: CoroutineSource }
  /// A coroutine literal created via a `yield` inside a closure.
  | { readonly $: "Coroutine"; readonly _0: Movability };

// ---- traits --------------------------------------------------------------------------------------------------

// pub(super) trait IsDefault: Default { fn is_default(&self) -> bool; }
/// Helper trait, for encoding to, and decoding from, a fixed number of bytes.
/// Used mainly for Lazy positions and lengths.
///
/// Invariant: `Self::default()` should encode as `[0; BYTE_LEN]`,
/// but this has no impact on safety.
/// In debug builds, this invariant is checked in `[TableBuilder::set]`
export interface FixedSizeEncoding<T> {
  /// This should be `[u8; BYTE_LEN]`;
  /// Cannot use an associated `const BYTE_LEN: usize` instead due to const eval limitations.
  readonly BYTE_LEN: number;
  /** `<T as Default>::default()` (`IsDefault: Default`) */
  default(): T;
  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:8 is_default
  is_default(self: T): boolean;

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:58 from_bytes
  from_bytes(b: Uint8Array): T;
  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:59 write_to_bytes
  write_to_bytes(self: T, b: Uint8Array): void;
}

// impl<T> IsDefault for Option<T>
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:12 is_default
function is_default_Option<T>(self: T | undefined): boolean {
  return self === undefined;
}

// impl IsDefault for AttrFlags
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:18 is_default
function is_default_AttrFlags(self: AttrFlags): boolean {
  return AttrFlags.is_empty(self);
}

// impl IsDefault for bool
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:24 is_default
function is_default_bool(self: boolean): boolean {
  return !self;
}

// impl IsDefault for u32
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:30 is_default
export function is_default_u32(self: number): boolean {
  return self === 0;
}

// impl IsDefault for u64
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:36 is_default
function is_default_u64(self: bigint): boolean {
  return self === 0n;
}

// impl<T> IsDefault for LazyArray<T>
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:42 is_default
export function is_default_LazyArray<T>(self: LazyArray<T>): boolean {
  return self.num_elems === 0;
}

/** `u64::from_le_bytes` of 8 bytes. */
function u64_from_le_bytes(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(b[i]!);
  return x;
}
/** `u64::to_le_bytes` */
function u64_to_le_bytes(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
/** `u32::from_le_bytes` of 4 bytes. */
function u32_from_le_bytes(b: Uint8Array): number {
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}
/** `u32::to_le_bytes` */
function u32_to_le_bytes(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}
/** `as usize` of a u64 position / length: exact below 2^53 (metadata blobs are far smaller). */
function u64_as_usize(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) return panic(`rustc_metadata: table value ${v} is not an exact usize`);
  return Number(v);
}

// impl FixedSizeEncoding for u64
export const fse_u64: FixedSizeEncoding<bigint> = {
  BYTE_LEN: 8,
  default: () => 0n,
  is_default: is_default_u64,

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:66 from_bytes
  from_bytes(b: Uint8Array): bigint {
    return u64_from_le_bytes(b);
  },

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:71 write_to_bytes
  write_to_bytes(self: bigint, b: Uint8Array): void {
    b.set(u64_to_le_bytes(self));
  },
};

/**
 * `macro_rules! fixed_size_enum` (table.rs:76): `impl FixedSizeEncoding for Option<$ty>`, one byte: 0 is `None`,
 * `1 + i` the i-th listed pattern. `variants` are the listed patterns in order; `index_of` is the
 * `Some(pat) => 1 + ${index()}` match (`undefined` for the `unreachable { .. }` patterns).
 */
function fixed_size_enum<T>(ty: string, variants: readonly T[], index_of: (v: T) => number | undefined): FixedSizeEncoding<T | undefined> {
  return {
    BYTE_LEN: 1,
    default: () => undefined,
    is_default: is_default_Option,

    // rustc: compiler/rustc_metadata/src/rmeta/table.rs:82 from_bytes
    from_bytes(b: Uint8Array): T | undefined {
      // use $ty::*;
      if (b[0] === 0) {
        return undefined;
      }
      const v = variants[b[0]! - 1];
      if (v === undefined) return panic(`Unexpected ${ty} code: ${b[0]}`);
      return v;
    },

    // rustc: compiler/rustc_metadata/src/rmeta/table.rs:94 write_to_bytes
    write_to_bytes(self: T | undefined, b: Uint8Array): void {
      // use $ty::*;
      if (self === undefined) return unreachable();
      const i = index_of(self);
      if (i === undefined) return unreachable();
      b[0] = 1 + i;
    },
  };
}

/**
 * `macro_rules! defaulted_enum` (table.rs:106): `impl FixedSizeEncoding for $ty` (one byte, `${index()}` of the
 * listed pattern; the first one is the default) and `impl IsDefault for $ty`.
 */
function defaulted_enum<T>(ty: string, variants: readonly T[], index_of: (v: T) => number | undefined, default_: () => T, eq: (a: T, b: T) => boolean): FixedSizeEncoding<T> {
  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:136 is_default
  const is_default = (self: T): boolean => eq(default_(), self);
  return {
    BYTE_LEN: 1,
    default: default_,
    is_default,

    // rustc: compiler/rustc_metadata/src/rmeta/table.rs:112 from_bytes
    from_bytes(b: Uint8Array): T {
      // use $ty::*;
      const val = variants[b[0]!];
      if (val === undefined) return panic(`Unexpected ${ty} code: ${b[0]}`);
      // Make sure the first entry is always the default value,
      // and none of the other values are the default value
      // debug_assert_ne!((b[0] != 0), IsDefault::is_default(&val));
      return val;
    },

    // rustc: compiler/rustc_metadata/src/rmeta/table.rs:125 write_to_bytes
    write_to_bytes(self: T, b: Uint8Array): void {
      // debug_assert!(!IsDefault::is_default(&self));
      // use $ty::*;
      const i = index_of(self);
      if (i === undefined) return unreachable();
      b[0] = i;
      // debug_assert_ne!(b[0], 0);
    },
  };
}

// Ensure that we get a compilation error if MacroKinds gets extended without updating metadata.
// const _: () = assert!(MacroKinds::DERIVE_ATTR_BANG.is_all());

const DefKind_Static = (safety: Safety, mutability: Mutability, nested: boolean): DefKind => ({ $: "Static", safety, mutability, nested });
const DefKind_Ctor = (of: CtorOf, kind: CtorKind): DefKind => ({ $: "Ctor", _0: of, _1: kind });
const DefKind_Macro = (kinds: number): DefKind => ({ $: "Macro", _0: kinds as MacroKinds });
const MK_BANG = MacroKinds.BANG;
const MK_ATTR = MacroKinds.ATTR;
const MK_DERIVE = MacroKinds.DERIVE;

/** The `fixed_size_enum! { DefKind { .. } unreachable { ( Macro(_) ) } }` patterns, in order. */
const DEF_KIND_VARIANTS: readonly DefKind[] = [
  { $: "Mod" },
  { $: "Struct" },
  { $: "Union" },
  { $: "Enum" },
  { $: "Variant" },
  { $: "Trait" },
  { $: "TyAlias" },
  { $: "ForeignTy" },
  { $: "TraitAlias" },
  { $: "AssocTy" },
  { $: "TyParam" },
  { $: "Fn" },
  { $: "Const" },
  { $: "ConstParam" },
  { $: "AssocFn" },
  { $: "AssocConst" },
  { $: "ExternCrate" },
  { $: "Use" },
  { $: "ForeignMod" },
  { $: "AnonConst" },
  { $: "OpaqueTy" },
  { $: "Field" },
  { $: "LifetimeParam" },
  { $: "GlobalAsm" },
  { $: "Impl", of_trait: false },
  { $: "Impl", of_trait: true },
  { $: "Closure" },
  DefKind_Static("Unsafe", "Not", false),
  DefKind_Static("Safe", "Not", false),
  DefKind_Static("Unsafe", "Mut", false),
  DefKind_Static("Safe", "Mut", false),
  DefKind_Static("Unsafe", "Not", true),
  DefKind_Static("Safe", "Not", true),
  DefKind_Static("Unsafe", "Mut", true),
  DefKind_Static("Safe", "Mut", true),
  DefKind_Ctor("Struct", "Fn"),
  DefKind_Ctor("Struct", "Const"),
  DefKind_Ctor("Variant", "Fn"),
  DefKind_Ctor("Variant", "Const"),
  DefKind_Macro(MK_BANG),
  DefKind_Macro(MK_ATTR),
  DefKind_Macro(MK_DERIVE),
  DefKind_Macro(MK_ATTR | MK_BANG),
  DefKind_Macro(MK_DERIVE | MK_ATTR),
  DefKind_Macro(MK_DERIVE | MK_BANG),
  DefKind_Macro(MK_DERIVE | MK_ATTR | MK_BANG),
  { $: "SyntheticCoroutineBody" },
  { $: "TestBinderConstraints" },
].map((v) => Object.freeze(v as DefKind));

/** The `Some(pat) => 1 + ${index()}` match of `DefKind` (field-wise; `Macro(_)` of another set is unreachable). */
function DefKind_index(v: DefKind): number | undefined {
  for (let i = 0; i < DEF_KIND_VARIANTS.length; i++) {
    const p = DEF_KIND_VARIANTS[i]!;
    if (p.$ !== v.$) continue;
    switch (v.$) {
      case "Impl":
        if (p.$ === "Impl" && p.of_trait === v.of_trait) return i;
        continue;
      case "Static":
        if (p.$ === "Static" && p.safety === v.safety && p.mutability === v.mutability && p.nested === v.nested) return i;
        continue;
      case "Ctor":
        if (p.$ === "Ctor" && p._0 === v._0 && p._1 === v._1) return i;
        continue;
      case "Macro":
        if (p.$ === "Macro" && p._0 === v._0) return i;
        continue;
      default:
        return i;
    }
  }
  return undefined;
}

// fixed_size_enum! { DefKind { .. } unreachable { ( Macro(_) ) } }
export const fse_Option_DefKind: FixedSizeEncoding<DefKind | undefined> = fixed_size_enum("DefKind", DEF_KIND_VARIANTS, DefKind_index);

// defaulted_enum! { hir::Defaultness { ( Final ) ( Default { has_value: false } ) ( Default { has_value: true } ) } }
const DEFAULTNESS_VARIANTS: readonly Defaultness[] = [Defaultness.Final, Object.freeze({ $: "Default", has_value: false }), Object.freeze({ $: "Default", has_value: true })];
const Defaultness_eq = (a: Defaultness, b: Defaultness): boolean => a.$ === b.$ && (a.$ !== "Default" || (b.$ === "Default" && a.has_value === b.has_value));
export const fse_Defaultness: FixedSizeEncoding<Defaultness> = defaulted_enum(
  "hir::Defaultness",
  DEFAULTNESS_VARIANTS,
  (v) => {
    const i = DEFAULTNESS_VARIANTS.findIndex((p) => Defaultness_eq(p, v));
    return i < 0 ? undefined : i;
  },
  // #[derive(Default)] with `#[default] Final`
  () => Defaultness.Final,
  Defaultness_eq,
);

// defaulted_enum! { ty::Asyncness { ( No ) ( Yes ) } }
const ASYNCNESS_VARIANTS: readonly Asyncness[] = ["No", "Yes"];
export const fse_Asyncness: FixedSizeEncoding<Asyncness> = defaulted_enum(
  "ty::Asyncness",
  ASYNCNESS_VARIANTS,
  (v) => ASYNCNESS_VARIANTS.indexOf(v),
  // #[derive(Default)] with `#[default] No`
  () => "No",
  (a, b) => a === b,
);

// defaulted_enum! { hir::Constness { ( Const { always: false } ) ( NotConst ) ( Const { always: true } ) } }
const CONSTNESS_VARIANTS: readonly Constness[] = [Object.freeze({ $: "Const", always: false }), Constness.NotConst, Object.freeze({ $: "Const", always: true })];
const Constness_eq = (a: Constness, b: Constness): boolean => a.$ === b.$ && (a.$ !== "Const" || (b.$ === "Const" && a.always === b.always));
export const fse_Constness: FixedSizeEncoding<Constness> = defaulted_enum(
  "hir::Constness",
  CONSTNESS_VARIANTS,
  (v) => {
    const i = CONSTNESS_VARIANTS.findIndex((p) => Constness_eq(p, v));
    return i < 0 ? undefined : i;
  },
  // impl Default for Constness (hir.rs:4440): `Self::Const { always: false }`
  () => ({ $: "Const", always: false }),
  Constness_eq,
);

// defaulted_enum! { hir::Safety { ( Unsafe ) ( Safe ) } }
const SAFETY_VARIANTS: readonly Safety[] = ["Unsafe", "Safe"];
export const fse_Safety: FixedSizeEncoding<Safety> = defaulted_enum(
  "hir::Safety",
  SAFETY_VARIANTS,
  (v) => SAFETY_VARIANTS.indexOf(v),
  // #[derive(Default)] with `#[default] Unsafe`
  () => "Unsafe",
  (a, b) => a === b,
);

// fixed_size_enum! { hir::CoroutineKind { .. } }
const COROUTINE_KIND_VARIANTS: readonly CoroutineKind[] = (
  [
    { $: "Coroutine", _0: "Movable" },
    { $: "Coroutine", _0: "Static" },
    { $: "Desugared", _0: "Gen", _1: "Block" },
    { $: "Desugared", _0: "Gen", _1: "Fn" },
    { $: "Desugared", _0: "Gen", _1: "Closure" },
    { $: "Desugared", _0: "Async", _1: "Block" },
    { $: "Desugared", _0: "Async", _1: "Fn" },
    { $: "Desugared", _0: "Async", _1: "Closure" },
    { $: "Desugared", _0: "AsyncGen", _1: "Block" },
    { $: "Desugared", _0: "AsyncGen", _1: "Fn" },
    { $: "Desugared", _0: "AsyncGen", _1: "Closure" },
  ] as CoroutineKind[]
).map((v) => Object.freeze(v));
export const fse_Option_CoroutineKind: FixedSizeEncoding<CoroutineKind | undefined> = fixed_size_enum("hir::CoroutineKind", COROUTINE_KIND_VARIANTS, (v) => {
  const i = COROUTINE_KIND_VARIANTS.findIndex((p) => p.$ === v.$ && p._0 === v._0 && (p.$ !== "Desugared" || (v.$ === "Desugared" && p._1 === v._1)));
  return i < 0 ? undefined : i;
});

// fixed_size_enum! { MacroKind { ( Attr ) ( Bang ) ( Derive ) } }
const MACRO_KIND_VARIANTS: readonly MacroKind[] = ["Attr", "Bang", "Derive"];
export const fse_Option_MacroKind: FixedSizeEncoding<MacroKind | undefined> = fixed_size_enum("MacroKind", MACRO_KIND_VARIANTS, (v) => MACRO_KIND_VARIANTS.indexOf(v));

// We directly encode RawDefId because using a `LazyValue` would incur a 50% overhead in the worst case.
// impl FixedSizeEncoding for Option<RawDefId>
export const fse_Option_RawDefId: FixedSizeEncoding<RawDefId | undefined> = {
  BYTE_LEN: 8,
  default: () => undefined,
  is_default: is_default_Option,

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:260 from_bytes
  from_bytes(encoded: Uint8Array): RawDefId | undefined {
    const [index_bytes, krate_bytes] = decode_interleaved(encoded, 4);
    const krate = u32_from_le_bytes(krate_bytes);
    if (krate === 0) {
      return undefined;
    }
    const index = u32_from_le_bytes(index_bytes);

    return new RawDefId(krate - 1, index);
  },

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:272 write_to_bytes
  write_to_bytes(self: RawDefId | undefined, dest: Uint8Array): void {
    if (self === undefined) return unreachable();
    const { krate, index } = self;
    // debug_assert!(krate < u32::MAX);
    // CrateNum is less than `CrateNum::MAX_AS_U32`.
    const krate_bytes = u32_to_le_bytes(krate + 1);
    const index_bytes = u32_to_le_bytes(index);

    // CrateNum is usually much smaller than the index within the crate, so put it in
    // the second slot.
    encode_interleaved(index_bytes, krate_bytes, dest);
  },
};

// impl FixedSizeEncoding for AttrFlags
export const fse_AttrFlags: FixedSizeEncoding<AttrFlags> = {
  BYTE_LEN: 1,
  // #[derive(Default)] (bitflags): empty
  default: () => AttrFlags.empty(),
  is_default: is_default_AttrFlags,

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:293 from_bytes
  from_bytes(b: Uint8Array): AttrFlags {
    return AttrFlags.from_bits_truncate(b[0]!);
  },

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:298 write_to_bytes
  write_to_bytes(self: AttrFlags, b: Uint8Array): void {
    // debug_assert!(!self.is_default());
    b[0] = AttrFlags.bits(self);
  },
};

// impl FixedSizeEncoding for bool
export const fse_bool: FixedSizeEncoding<boolean> = {
  BYTE_LEN: 1,
  default: () => false,
  is_default: is_default_bool,

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:308 from_bytes
  from_bytes(b: Uint8Array): boolean {
    return b[0] !== 0;
  },

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:313 write_to_bytes
  write_to_bytes(self: boolean, b: Uint8Array): void {
    // debug_assert!(!self.is_default());
    b[0] = self ? 1 : 0;
  },
};

// NOTE(eddyb) there could be an impl for `usize`, which would enable a more
// generic `LazyValue<T>` impl, but in the general case we might not need / want
// to fit every `usize` in `u32`.
// impl<T> FixedSizeEncoding for Option<LazyValue<T>>
// PORT: one dictionary for every `T` (phantom): `LazyValue<never>` is assignable to any `LazyValue<X>`, so
// `LazyTable<_, _, LazyValue<X> | undefined>.get` accepts it for every X (likewise the LazyArray ones).
export const fse_Option_LazyValue: FixedSizeEncoding<LazyValue<never> | undefined> = {
  BYTE_LEN: 8,
  default: () => undefined,
  is_default: is_default_Option,

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:326 from_bytes
  from_bytes(b: Uint8Array): LazyValue<never> | undefined {
    const position = u64_as_usize(fse_u64.from_bytes(b));
    // `NonZero::new(..)?`
    if (position === 0) return undefined;
    return LazyValue.from_position(position);
  },

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:332 write_to_bytes
  write_to_bytes(self: LazyValue<never> | undefined, b: Uint8Array): void {
    if (self === undefined) return unreachable();
    const position = self.position;
    // let position: u64 = position.try_into().unwrap();
    fse_u64.write_to_bytes(BigInt(position), b);
  },
};

// impl<T> LazyArray<T>
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:346 write_to_bytes_impl
function LazyArray_write_to_bytes_impl<T>(self: LazyArray<T>, dest: Uint8Array): void {
  const position = u64_to_le_bytes(BigInt(self.position));
  const len = u64_to_le_bytes(BigInt(self.num_elems));

  encode_interleaved(position, len, dest);
}

// rustc: compiler/rustc_metadata/src/rmeta/table.rs:353 from_bytes_impl
function LazyArray_from_bytes_impl<T>(position_bytes: Uint8Array, meta: Uint8Array): LazyArray<T> | undefined {
  const position = u64_as_usize(fse_u64.from_bytes(position_bytes));
  // `NonZero::new(..)?`
  if (position === 0) return undefined;
  const len = u64_as_usize(fse_u64.from_bytes(meta));
  return LazyArray.from_position_and_num_elems<T>(position, len);
}

// Interleaving the bytes of the two integers exposes trailing bytes in the first integer
// to the varint scheme that we use for tables.
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:363 decode_interleaved
export function decode_interleaved(encoded: Uint8Array, M: number): [Uint8Array, Uint8Array] {
  assert(M * 2 === encoded.length, `assertion \`left == right\` failed\n  left: ${M * 2}\n right: ${encoded.length}`);
  const first = new Uint8Array(M);
  const second = new Uint8Array(M);
  for (let i = 0; i < M; i++) {
    first[i] = encoded[2 * i]!;
    second[i] = encoded[2 * i + 1]!;
  }
  return [first, second];
}

// Element width is selected at runtime on a per-table basis by omitting trailing
// zero bytes in table elements. This works very naturally when table elements are
// simple numbers but sometimes we have a pair of integers. If naively encoded, the second element
// would shield the trailing zeroes in the first. Interleaving the bytes exposes trailing zeroes in
// both to the optimization.
//
// Prefer passing a and b such that `b` is usually smaller.
// rustc: compiler/rustc_metadata/src/rmeta/table.rs:382 encode_interleaved
export function encode_interleaved(a: Uint8Array, b: Uint8Array, dest: Uint8Array): void {
  const M = a.length;
  assert(M * 2 === dest.length, `assertion \`left == right\` failed\n  left: ${M * 2}\n right: ${dest.length}`);
  for (let i = 0; i < M; i++) {
    dest[2 * i] = a[i]!;
    dest[2 * i + 1] = b[i]!;
  }
}

/** `[0; 8]` comparison of `decode_interleaved`'s second half. */
function all_zero(b: Uint8Array): boolean {
  for (const x of b) if (x !== 0) return false;
  return true;
}

// impl<T> FixedSizeEncoding for LazyArray<T>
export const fse_LazyArray: FixedSizeEncoding<LazyArray<never>> = {
  BYTE_LEN: 16,
  default: () => LazyArray.default(),
  is_default: is_default_LazyArray,

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:394 from_bytes
  from_bytes(b: Uint8Array): LazyArray<never> {
    const [position, meta] = decode_interleaved(b, 8);

    if (all_zero(meta)) {
      return LazyArray.default();
    }
    const r = LazyArray_from_bytes_impl<never>(position, meta);
    if (r === undefined) return panic("called `Option::unwrap()` on a `None` value");
    return r;
  },

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:404 write_to_bytes
  write_to_bytes(self: LazyArray<never>, b: Uint8Array): void {
    assert(!is_default_LazyArray(self), "assertion failed: !self.is_default()");
    LazyArray_write_to_bytes_impl(self, b);
  },
};

// impl<T> FixedSizeEncoding for Option<LazyArray<T>>
export const fse_Option_LazyArray: FixedSizeEncoding<LazyArray<never> | undefined> = {
  BYTE_LEN: 16,
  default: () => undefined,
  is_default: is_default_Option,

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:414 from_bytes
  from_bytes(b: Uint8Array): LazyArray<never> | undefined {
    const [position, meta] = decode_interleaved(b, 8);

    return LazyArray_from_bytes_impl<never>(position, meta);
  },

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:421 write_to_bytes
  write_to_bytes(self: LazyArray<never> | undefined, b: Uint8Array): void {
    if (self === undefined) return unreachable();
    LazyArray_write_to_bytes_impl(self, b);
  },
};

/// Helper for constructing a table's serialization (also see `Table`).
// PORT: `T: FixedSizeEncoding` is the `fse` dictionary, passed to `default`; `blocks` is
// `IndexVec<IdxEncode, [u8; N]>` (index = the `Ie` handle number).
export class TableBuilder<IdxEncode, IdxDecode, T> {
  declare readonly __T?: [IdxEncode, IdxDecode, T];
  constructor(
    public width: number,
    public blocks: Uint8Array[],
    readonly fse: FixedSizeEncoding<T>,
  ) {}

  // impl<Ie: Idx, Id: Idx, T: FixedSizeEncoding> Default for TableBuilder<Ie, Id, T>
  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:437 default
  static default<Ie, Id, T>(fse: FixedSizeEncoding<T>): TableBuilder<Ie, Id, T> {
    return new TableBuilder<Ie, Id, T>(0, [], fse);
  }

  // impl TableBuilder<Ie, Id, Option<T>>
  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:446 set_some
  set_some<V>(this: TableBuilder<IdxEncode, IdxDecode, V | undefined>, i: IdxEncode & number, value: V): void {
    this.set(i, value);
  }

  /// Sets the table value if it is not default.
  /// ATTENTION: For optimization default values are simply ignored by this function, because
  /// right now metadata tables never need to reset non-default values to default. If such need
  /// arises in the future then a new method (e.g. `clear` or `reset`) will need to be introduced
  /// for doing that explicitly.
  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:459 set
  set(i: IdxEncode & number, value: T): void {
    // #[cfg(debug_assertions)] { debug_assert!(T::from_bytes(&[0; N]).is_default(), ..) }
    const N = this.fse.BYTE_LEN;
    if (!this.fse.is_default(value)) {
      // FIXME(eddyb) investigate more compact encodings for sparse tables.
      // On the PR @michaelwoerister mentioned:
      // > Space requirements could perhaps be optimized by using the HAMT `popcnt`
      // > trick (i.e. divide things into buckets of 32 or 64 items and then
      // > store bit-masks of which item in each bucket is actually serialized).
      // `self.blocks.ensure_contains_elem(i, || [0; N])`
      while (this.blocks.length <= i) this.blocks.push(new Uint8Array(N));
      const block = this.blocks[i]!;
      this.fse.write_to_bytes(value, block);
      if (this.width !== N) {
        const width = N - trailing_zeros(block);
        this.width = Math.max(this.width, width);
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/rmeta/table.rs:482 encode
  encode(buf: FileEncoder): LazyTable<IdxEncode, IdxDecode, T> {
    const pos = buf.position();

    const width = this.width;
    for (const block of this.blocks) {
      buf.write_with(this.fse.BYTE_LEN, (dest) => {
        dest.set(block);
        return width;
      });
    }

    assert(pos !== 0, "called `Option::unwrap()` on a `None` value");
    return LazyTable.from_position_and_encoded_size(pos, width, this.blocks.length);
  }
}

// rustc: compiler/rustc_metadata/src/rmeta/table.rs:501 trailing_zeros
function trailing_zeros(x: Uint8Array): number {
  let n = 0;
  for (let i = x.length - 1; i >= 0 && x[i] === 0; i--) n++;
  return n;
}
