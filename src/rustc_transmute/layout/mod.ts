// Port of compiler/rustc_transmute/src/layout/mod.rs (lane transmute, wave 30).
//
// PORT:
// - `RangeInclusive<u8>` (`a..=b`, the `Into<Byte>` argument of `Byte::new` / `Tree::byte` / `Tree::bytes`) is the
//   tuple `[a, b]`; `From<RangeInclusive<u8>>` / `From<u8>` for `Byte` are `Byte.from(src)`.
// - `Byte` is `Copy` and its fields are written by `dfa::UnionIter` / `EdgeSet::union` on copies: every Rust copy that
//   is later written is a `clone_Byte` (dfa.ts).
// - The traits `Def` / `Region` / `Type`: `Def` is the method table `Def<D>` (PORTING §5, generic dispatch); `Region` /
//   `Type` are erased (lib.ts crate comment). `#[cfg(feature = "rustc")] pub mod rustc` is the namespace `rustc`.
// - The `!` type is `never`.

import type { Layout } from "../../rustc_abi/layout/ty.ts";
import type { LayoutCx, LayoutError } from "../../rustc_middle/ty/layout.ts";
import type { AdtDef, Region as ty_Region } from "../../rustc_middle/ty/decls.ts";
import { debug_FieldDef, debug_VariantDef, type FieldDef, type Ty, type VariantDef } from "../../rustc_middle/ty/mod.ts";
import { debug_AdtDef, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { debug_bool, debug_int, debug_struct, debug_tuple, type Debug, type Fmt } from "../../std/fmt.ts";
import { unreachable } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";

// pub(crate) mod tree;
// pub(crate) use tree::Tree;
export { Tree } from "./tree.ts";
export type { Tree as TreeT } from "./tree.ts";

// pub(crate) mod dfa;
// pub(crate) use dfa::{Dfa, union};
export { Dfa, union } from "./dfa.ts";

// #[derive(Debug)]
export class Uninhabited {
  static readonly INSTANCE: Uninhabited = new Uninhabited();
}
// derive(Debug)
export const debug_Uninhabited: Debug<Uninhabited> = () => "Uninhabited";

/** `RangeInclusive<u8>`: `a..=b` is `[a, b]` (module comment). */
export type RangeInclusive_u8 = readonly [start: number, end: number];

/// A half-open range of byte values, which may include an uninitialized byte.
///
/// The range is `[start, end)`. Values `0..=255` represent initialized bytes,
/// and `256` represents an uninitialized byte. A range containing that value
/// therefore has an exclusive upper bound of `257`.
// #[derive(Hash, Eq, PartialEq, Ord, PartialOrd, Clone, Copy)]
export class Byte {
  constructor(
    // Store the endpoints separately because `Range` is not `Copy`.
    public start: number,
    public end: number,
  ) {}

  static readonly UNINIT: number = 256;

  // #[inline]
  // rustc: compiler/rustc_transmute/src/layout/mod.rs:30 new
  static new(range: RangeInclusive_u8): Byte {
    const start: number = range[0];
    const end: number = range[1];
    return new Byte(start, end + 1);
  }

  // #[inline]
  // rustc: compiler/rustc_transmute/src/layout/mod.rs:37 from_val
  static from_val(val: number): Byte {
    return new Byte(val, val + 1);
  }

  /// A byte that may be initialized to any value or uninitialized.
  // #[inline]
  // rustc: compiler/rustc_transmute/src/layout/mod.rs:44 uninit
  static uninit(): Byte {
    return new Byte(0, Byte.UNINIT + 1);
  }

  // #[inline]
  // rustc: compiler/rustc_transmute/src/layout/mod.rs:49 is_empty
  is_empty(): boolean {
    return this.start === this.end;
  }

  // #[inline]
  // rustc: compiler/rustc_transmute/src/layout/mod.rs:54 contains_uninit
  contains_uninit(): boolean {
    return this.start <= Byte.UNINIT && Byte.UNINIT < this.end;
  }

  // impl From<RangeInclusive<u8>> for Byte (mod.rs:71) / impl From<u8> for Byte (mod.rs:77)
  static from(src: RangeInclusive_u8 | number): Byte {
    return typeof src === "number" ? Byte.from_u8(src) : Byte.from_RangeInclusive(src);
  }

  // rustc: compiler/rustc_transmute/src/layout/mod.rs:72 from
  static from_RangeInclusive(src: RangeInclusive_u8): Byte {
    return Byte.new(src);
  }

  // #[inline]
  // rustc: compiler/rustc_transmute/src/layout/mod.rs:79 from
  static from_u8(src: number): Byte {
    return Byte.from_val(src);
  }
}

// impl fmt::Debug for Byte
// rustc: compiler/rustc_transmute/src/layout/mod.rs:60 fmt
export const debug_Byte: Debug<Byte> = (self) => {
  if (self.start === Byte.UNINIT && self.end === Byte.UNINIT + 1) {
    return "uninit";
  } else if (self.start <= Byte.UNINIT && self.end === Byte.UNINIT + 1) {
    return `${self.start}..${self.end - 1}|uninit`;
  } else {
    return `${self.start}..${self.end}`;
  }
};
/** derive(Clone, Copy): a copy that may be written (module comment). */
export function clone_Byte(v: Byte): Byte {
  return new Byte(v.start, v.end);
}
/** derive(PartialEq) */
export function Byte_eq(a: Byte, b: Byte): boolean {
  return a.start === b.start && a.end === b.end;
}
/** derive(Ord): `(start, end)` lexicographically. */
export function Byte_cmp(a: Byte, b: Byte): number {
  return a.start !== b.start ? a.start - b.start : a.end - b.end;
}

/// A reference, i.e., `&'region T` or `&'region mut T`.
// #[derive(Debug, Hash, Eq, PartialEq, Ord, PartialOrd, Clone, Copy)]
export interface Reference<R, T> {
  readonly region: R;
  readonly is_mut: boolean;
  readonly referent: T;
  readonly referent_size: number;
  readonly referent_align: number;
}
// derive(Debug)
export function debug_Reference<R, T>(v: Reference<R, T>, f: Fmt, debug_R: Debug<R>, debug_T: Debug<T>): string {
  return debug_struct(f, "Reference", [
    ["region", debug_R(v.region, f)],
    ["is_mut", debug_bool(v.is_mut, f)],
    ["referent", debug_T(v.referent, f)],
    ["referent_size", debug_int(v.referent_size, f)],
    ["referent_align", debug_int(v.referent_align, f)],
  ]);
}

// impl<R, T> fmt::Display for Reference<R, T>
// PORT: `self.referent.fmt(f)` resolves to `Debug::fmt` (the only formatting bound of `T: Type`).
// rustc: compiler/rustc_transmute/src/layout/mod.rs:103 fmt
export function display_Reference<R, T>(self: Reference<R, T>, f: Fmt, debug_T: Debug<T>): string {
  let out = "&";
  if (self.is_mut) {
    out += "mut ";
  }
  return out + debug_T(self.referent, f);
}

/** `pub(crate) trait Def: Debug + Hash + Eq + PartialEq + Copy + Clone` (module comment). */
export interface Def<D> {
  // rustc: compiler/rustc_transmute/src/layout/mod.rs:113 has_safety_invariants
  has_safety_invariants(self: D): boolean;
}

// pub(crate) trait Region: Debug + Hash + Eq + PartialEq + Copy + Clone {}
// pub(crate) trait Type: Debug + Hash + Eq + PartialEq + Copy + Clone {}
// PORT: erased (module comment).

// impl Def for !
export const Def_never: Def<never> = {
  // rustc: compiler/rustc_transmute/src/layout/mod.rs:121 has_safety_invariants
  has_safety_invariants(_self: never): boolean {
    return unreachable();
  },
};

// impl Region for ! {}
// impl Type for ! {}
// #[cfg(test)] impl Region for usize {}
// #[cfg(test)] impl Type for () {}

// ---- #[cfg(feature = "rustc")] pub mod rustc ----
export namespace rustc {
  // use rustc_abi::Layout;
  // use rustc_middle::ty::layout::{HasTyCtxt, LayoutCx, LayoutError};
  // use rustc_middle::ty::{self, Region, Ty};

  /// A layout annotation used to check for safety invariants during pruning.
  // #[derive(Debug, Hash, Eq, PartialEq, Clone, Copy)]
  export type Def =
    | { readonly $: "Adt"; readonly _0: AdtDef }
    | { readonly $: "Variant"; readonly _0: VariantDef }
    | { readonly $: "Field"; readonly _0: FieldDef }
    | { readonly $: "Primitive" };
  export const Def = {
    Primitive: Object.freeze({ $: "Primitive" }) as Def,
  };
  // derive(Debug)
  export const debug_Def: Debug<Def> = (v, f) => {
    switch (v.$) {
      case "Adt":
        return debug_tuple(f, "Adt", [debug_AdtDef(v._0, f)]);
      case "Variant":
        return debug_tuple(f, "Variant", [debug_VariantDef(v._0, f)]);
      case "Field":
        return debug_tuple(f, "Field", [debug_FieldDef(v._0, f)]);
      case "Primitive":
        return "Primitive";
    }
  };

  // impl<'tcx> super::Def for Def<'tcx>
  export const Def_Def: import("./mod.ts").Def<Def> = {
    // rustc: compiler/rustc_transmute/src/layout/mod.rs:152 has_safety_invariants
    has_safety_invariants(self: Def): boolean {
      // Conservatively treat every ADT, variant, and field definition as
      // potentially carrying safety invariants. This check does not
      // inspect `unsafe` field annotations.
      // PORT: `self != &Self::Primitive` (derived `PartialEq`: `Primitive` has no fields).
      return self.$ !== "Primitive";
    },
  };

  // impl<'tcx> super::Region for Region<'tcx> {}
  // impl<'tcx> super::Type for Ty<'tcx> {}
  export type Region = ty_Region;

  // rustc: compiler/rustc_transmute/src/layout/mod.rs:164 layout_of
  export function layout_of(cx: LayoutCx, ty: Ty): Result<Layout, LayoutError> {
    // use rustc_middle::ty::layout::LayoutOf;
    const ty_ = cx.tcx_().erase_and_anonymize_regions(ty, fold_Ty);
    const r = cx.layout_of(ty_);
    return r.$ === "Ok" ? Ok(r._0.layout) : r;
  }
}
