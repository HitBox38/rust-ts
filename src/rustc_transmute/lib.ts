// Port of compiler/rustc_transmute/src/lib.rs (lane transmute, wave 30).
//
// PORT (crate-wide):
// - rustc builds the crate with `feature = "rustc"`; the `#[cfg(feature = "rustc")]` modules are ported as plain
//   sections (`// ---- mod rustc ----`).
// - `Map` / `Set` (`FxIndexMap` / `FxIndexSet`) are JS `Map` / `Set` (insertion-ordered); struct-keyed ones are
//   `KeyedMap` / `KeyedSet` (rust_ts/keyed.ts).
// - The marker traits `layout::Region` / `layout::Type` (`Debug + Hash + Eq + Copy`) are erased: equality and hashing
//   of `R` / `T` values are the intern key (rust_ts/intern_key.ts; `Region` / `Ty` are interned, test regions are
//   numbers, the test type `()` is `null`), and `Debug` is passed as a `debug_R` / `debug_T` function where used.
// - The derived `Hash` / `Eq` / `PartialEq` / `Clone` of `Answer` / `Condition` / `Reason` are `Answer_eq` (intern key)
//   and `clone_Answer` / `clone_Condition`; `Reason` is never mutated, so it is shared.
// - `tracing` (`#[instrument]`, `debug!`, `trace!`) produces no output in the oracle: kept as comments.

//! Checks whether one type's representation can be reinterpreted as another.
//!
//! The analysis converts compiler layouts into trees of bytes, references, and
//! definition markers. It prunes destination paths that may carry safety invariants unless
//! safety is assumed, then converts the trees into deterministic finite automata.
//! Comparing the automata produces an [`Answer`]; reference transitions can leave
//! [`Condition`]s for the trait solver to discharge.

import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { ScalarInt, ScalarInt_eq } from "../rustc_middle/ty/consts/int.ts";
import { Value } from "../rustc_middle/ty/consts/valtree.ts";
import type { Const, Region } from "../rustc_middle/ty/decls.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { display_Symbol, sym, type Symbol } from "../rustc_span/symbol.ts";
import { intern_key_eq } from "../rust_ts/intern_key.ts";
import { debug_bool, debug_int, debug_struct, debug_tuple, debug_vec, type Debug, type Fmt } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import { MaybeTransmutableQuery } from "./maybe_transmutable/mod.ts";

// pub(crate) use rustc_data_structures::fx::{FxIndexMap as Map, FxIndexSet as Set};
// PORT: `Map` / `Set` are the JS `Map` / `Set` (crate comment).

export * as layout from "./layout/mod.ts";
// mod maybe_transmutable;

/// Proof obligations supplied by the caller rather than checked by the analysis.
///
/// This mirrors `core::mem::Assume`. A `true` field transfers the corresponding
/// obligation to the caller; the default leaves all four obligations to the compiler.
// #[derive(Copy, Clone, Debug, Default)]
export class Assume {
  constructor(
    readonly alignment: boolean,
    readonly lifetimes: boolean,
    readonly safety: boolean,
    readonly validity: boolean,
  ) {}

  // derive(Default)
  static default_(): Assume {
    return new Assume(false, false, false, false);
  }

  // ---- mod rustc: impl Assume (lib.rs:131) ----

  /// Constructs an `Assume` from a given const-`Assume`.
  // rustc: compiler/rustc_transmute/src/lib.rs:133 from_const
  static from_const(tcx: TyCtxt, ct: Const): Assume | undefined {
    // use rustc_middle::ty::ScalarInt;
    // use rustc_span::sym;

    const cv = ct.try_to_value();
    if (cv === undefined) return undefined;
    const adt_def = cv.ty.ty_adt_def();
    if (adt_def === undefined) return undefined;

    if (!tcx.is_lang_item(adt_def.did(), LangItem.TransmuteOpts)) {
      tcx.dcx().delayed_bug(`The given \`const\` was not marked with the \`${display_Symbol(LangItem.name(LangItem.TransmuteOpts))}\` lang item.`);
      return new Assume(true, true, true, true);
    }

    const variant = adt_def.non_enum_variant();
    const fields = Value.to_branch(cv);

    const get_field = (name: Symbol): boolean | undefined => {
      const found = variant.fields.map((field_def, i) => [i, field_def] as const).find(([_, field_def]) => name === field_def.name);
      if (found === undefined) return panic(`There were no fields named \`${display_Symbol(name)}\`.`);
      const [field_idx] = found;
      const leaf = fields[field_idx]!.try_to_leaf();
      return leaf === undefined ? undefined : ScalarInt_eq(leaf, ScalarInt.TRUE);
    };

    // `Some(Self { alignment: get_field(sym::alignment)?, .. })`: the fields are evaluated in order, the first `None`
    // returns.
    const alignment = get_field(sym.alignment);
    if (alignment === undefined) return undefined;
    const lifetimes = get_field(sym.lifetimes);
    if (lifetimes === undefined) return undefined;
    const safety = get_field(sym.safety);
    if (safety === undefined) return undefined;
    const validity = get_field(sym.validity);
    if (validity === undefined) return undefined;
    return new Assume(alignment, lifetimes, safety, validity);
  }
}
// derive(Debug)
export const debug_Assume: Debug<Assume> = (v, f) =>
  debug_struct(f, "Assume", [
    ["alignment", debug_bool(v.alignment, f)],
    ["lifetimes", debug_bool(v.lifetimes, f)],
    ["safety", debug_bool(v.safety, f)],
    ["validity", debug_bool(v.validity, f)],
  ]);

/// The result of a transmutability query under the supplied [`Assume`] options.
// #[derive(Debug, Hash, Eq, PartialEq, Clone)]
export type Answer<R, T> =
  /// The analysis requires no further conditions.
  | { readonly $: "Yes" }
  /// The analysis could not establish transmutability.
  | { readonly $: "No"; readonly _0: Reason<T> }
  /// Transmutability depends on conditions that the trait solver must discharge.
  | { readonly $: "If"; readonly _0: Condition<R, T> };
export const Answer = {
  Yes: Object.freeze({ $: "Yes" }) as { readonly $: "Yes" },
};
// derive(Debug)
export function debug_Answer<R, T>(v: Answer<R, T>, f: Fmt, debug_R: Debug<R>, debug_T: Debug<T>): string {
  switch (v.$) {
    case "Yes":
      return "Yes";
    case "No":
      return debug_tuple(f, "No", [debug_Reason(v._0, f, debug_T)]);
    case "If":
      return debug_tuple(f, "If", [debug_Condition(v._0, f, debug_R, debug_T)]);
  }
}
/** derive(PartialEq) (PORT: the intern key; crate comment) */
export function Answer_eq<R, T>(a: Answer<R, T>, b: Answer<R, T>): boolean {
  return intern_key_eq(a, b);
}
/** derive(Clone) */
export function clone_Answer<R, T>(v: Answer<R, T>): Answer<R, T> {
  switch (v.$) {
    case "Yes":
    case "No":
      return v;
    case "If":
      return { $: "If", _0: clone_Condition(v._0) };
  }
}

/// A condition which must hold for safe transmutation to be possible.
// #[derive(Debug, Hash, Eq, PartialEq, Clone)]
export type Condition<R, T> =
  /// `Src` is transmutable into `Dst`, if `src` is transmutable into `dst`.
  | { readonly $: "Transmutable"; readonly src: T; readonly dst: T }

  /// The region `long` must outlive `short`.
  | { readonly $: "Outlives"; readonly long: R; readonly short: R }

  /// The type `ty` must satisfy `Freeze`.
  | { readonly $: "Immutable"; readonly ty: T }

  /// `Src` is transmutable into `Dst`, if all of the enclosed requirements are met.
  | { readonly $: "IfAll"; readonly _0: Condition<R, T>[] }

  /// `Src` is transmutable into `Dst` if any of the enclosed requirements are met.
  | { readonly $: "IfAny"; readonly _0: Condition<R, T>[] };
// derive(Debug)
export function debug_Condition<R, T>(v: Condition<R, T>, f: Fmt, debug_R: Debug<R>, debug_T: Debug<T>): string {
  switch (v.$) {
    case "Transmutable":
      return debug_struct(f, "Transmutable", [
        ["src", debug_T(v.src, f)],
        ["dst", debug_T(v.dst, f)],
      ]);
    case "Outlives":
      return debug_struct(f, "Outlives", [
        ["long", debug_R(v.long, f)],
        ["short", debug_R(v.short, f)],
      ]);
    case "Immutable":
      return debug_struct(f, "Immutable", [["ty", debug_T(v.ty, f)]]);
    case "IfAll":
      return debug_tuple(f, "IfAll", [debug_vec(v._0, f, (c, f) => debug_Condition(c, f, debug_R, debug_T))]);
    case "IfAny":
      return debug_tuple(f, "IfAny", [debug_vec(v._0, f, (c, f) => debug_Condition(c, f, debug_R, debug_T))]);
  }
}
/** derive(Clone) (the `Vec`s are copied: `Answer::and` / `or` append to them) */
export function clone_Condition<R, T>(v: Condition<R, T>): Condition<R, T> {
  switch (v.$) {
    case "Transmutable":
    case "Outlives":
    case "Immutable":
      return { ...v };
    case "IfAll":
      return { $: "IfAll", _0: v._0.map(clone_Condition) };
    case "IfAny":
      return { $: "IfAny", _0: v._0.map(clone_Condition) };
  }
}

/// Answers "why wasn't the source type transmutable into the destination type?"
// #[derive(Debug, Hash, Eq, PartialEq, PartialOrd, Ord, Clone)]
export type Reason<T> =
  /// The layout of the source type is not yet supported.
  | { readonly $: "SrcIsNotYetSupported" }
  /// The layout of the destination type is not yet supported.
  | { readonly $: "DstIsNotYetSupported" }
  /// The layout of the destination type is bit-incompatible with the source type.
  | { readonly $: "DstIsBitIncompatible" }
  /// The destination type is uninhabited.
  | { readonly $: "DstUninhabited" }
  /// The destination type may carry safety invariants.
  | { readonly $: "DstMayHaveSafetyInvariants" }
  /// `Dst` is larger than `Src`, and the excess bytes were not exclusively uninitialized.
  | { readonly $: "DstIsTooBig" }
  /// The destination referent is larger than the source referent.
  | {
      readonly $: "DstRefIsTooBig";
      /// The referent of the source type.
      readonly src: T;
      /// The size of the source type's referent.
      readonly src_size: number;
      /// The too-large referent of the destination type.
      readonly dst: T;
      /// The size of the destination type's referent.
      readonly dst_size: number;
    }
  /// The destination referent requires stricter alignment than the source referent.
  | { readonly $: "DstHasStricterAlignment"; readonly src_min_align: number; readonly dst_min_align: number }
  /// Can't go from shared pointer to unique pointer
  | { readonly $: "DstIsMoreUnique" }
  /// Encountered a type error
  | { readonly $: "TypeError" }
  /// The layout of src is unknown
  | { readonly $: "SrcLayoutUnknown" }
  /// The layout of dst is unknown
  | { readonly $: "DstLayoutUnknown" }
  /// The size of src is overflow
  | { readonly $: "SrcSizeOverflow" }
  /// The size of dst is overflow
  | { readonly $: "DstSizeOverflow" };
// derive(Debug)
export function debug_Reason<T>(v: Reason<T>, f: Fmt, debug_T: Debug<T>): string {
  switch (v.$) {
    case "DstRefIsTooBig":
      return debug_struct(f, "DstRefIsTooBig", [
        ["src", debug_T(v.src, f)],
        ["src_size", debug_int(v.src_size, f)],
        ["dst", debug_T(v.dst, f)],
        ["dst_size", debug_int(v.dst_size, f)],
      ]);
    case "DstHasStricterAlignment":
      return debug_struct(f, "DstHasStricterAlignment", [
        ["src_min_align", debug_int(v.src_min_align, f)],
        ["dst_min_align", debug_int(v.dst_min_align, f)],
      ]);
    default:
      return v.$;
  }
}

// ---- #[cfg(feature = "rustc")] mod rustc ----
// use rustc_attr_ir::lang_items::LangItem;
// use rustc_middle::ty::consts::ConstExt;
// use rustc_middle::ty::{Const, Region, Ty, TyCtxt};

export class TransmuteTypeEnv {
  constructor(private tcx: TyCtxt) {}

  // rustc: compiler/rustc_transmute/src/lib.rs:116 new
  static new(tcx: TyCtxt): TransmuteTypeEnv {
    return new TransmuteTypeEnv(tcx);
  }

  // rustc: compiler/rustc_transmute/src/lib.rs:120 is_transmutable
  is_transmutable(src: Ty, dst: Ty, assume: Assume): Answer<Region, Ty> {
    return MaybeTransmutableQuery.new(src, dst, assume, this.tcx).answer_ty();
  }
}
