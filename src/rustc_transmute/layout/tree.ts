// Port of compiler/rustc_transmute/src/layout/tree.rs (lane transmute, wave 30).
//
// PORT:
// - `Tree` is a PORTING §5 data enum; its methods (both `impl` blocks, the `#[cfg(feature = "rustc")]` one included)
//   live on the companion `Tree`, in upstream order. `mod rustc`'s `Err` (with its `From<&LayoutError>`), `ty_field`
//   and `ty_variant` are the namespace `rustc` after the companion (the companion holds the `impl Tree` methods of
//   that module, so the module's other items follow it).
// - `Tree` values are owned and moved in Rust: `then` / `or` append to the vectors of their arguments in place, as
//   upstream. Every Rust clone of a tree (`vec![tree; n]`, `iter::repeat_n`, `.clone()`) is a fresh tree (`clone_Tree`
//   or a new constructor call), so no two trees share a vector.
// - The derived `PartialEq` (`elt == Tree::uninhabited()`) is `Tree_eq`; `Def` / `Ref` payloads compare by the intern
//   key (lib.ts crate comment).
// - `Result<_, Err>`: the `Result` constructor `Err` of src/std/result.ts is imported as `ResErr` (the module's own
//   `Err` is `rustc.Err`).

import { type Layout, TyAndLayout } from "../../rustc_abi/layout/ty.ts";
import { FieldIdx, type VariantIdx } from "../../rustc_abi/layout.ts";
import { Endian as abi_Endian, Scalar, Size, type TagEncoding } from "../../rustc_abi/lib.ts";
import { FloatTy, IntTy, Mutability, UintTy } from "../../rustc_ast_ir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import type { AdtDef, Region } from "../../rustc_middle/ty/decls.ts";
import { PrimitiveExt, type LayoutCx, type LayoutError } from "../../rustc_middle/ty/layout.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { debug_ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { debug_TyKind } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { intern_key_eq } from "../../rust_ts/intern_key.ts";
import { debug_tuple, debug_vec, PLAIN, type Debug, type Fmt } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../std/panic.ts";
import { Err as ResErr, Ok, type Result } from "../../std/result.ts";
import { Byte, Byte_eq, debug_Byte, debug_Reference, type RangeInclusive_u8, type Reference, rustc as layout_rustc } from "./mod.ts";

// #[cfg(test)]
// mod tests;

/// A tree-based representation of a type layout.
///
/// A `Seq` concatenates layouts, while an `Alt` chooses among them. An empty
/// `Seq` represents an inhabited, zero-sized layout; an empty `Alt` represents
/// an uninhabited layout.
///
/// `Def` nodes are zero-width annotations used by [`Tree::prune`] to decide
/// which branches to retain. Pruning removes these annotations and produces
/// a `Tree<!, R, T>` for conversion with [`super::Dfa::from_tree`].
///
/// Invariants:
/// 1. All paths through the layout have the same length (in bytes).
///
/// Nice-to-haves:
/// 1. An `Alt` is never directly nested beneath another `Alt`.
/// 2. A `Seq` is never directly nested beneath another `Seq`.
/// 3. `Seq`s and `Alt`s with a single member do not exist.
// #[derive(Clone, Debug, Hash, PartialEq, Eq)]
export type Tree<D, R, T> =
  /// A sequence of successive layouts.
  | { readonly $: "Seq"; readonly _0: Tree<D, R, T>[] }
  /// A choice between alternative layouts.
  | { readonly $: "Alt"; readonly _0: Tree<D, R, T>[] }
  /// A zero-width definition annotation used during pruning.
  | { readonly $: "Def"; readonly _0: D }
  /// A reference node.
  | { readonly $: "Ref"; readonly _0: Reference<R, T> }
  /// A byte node.
  | { readonly $: "Byte"; readonly _0: Byte };
// derive(Debug)
export function debug_Tree<D, R, T>(v: Tree<D, R, T>, f: Fmt, debug_D: Debug<D>, debug_R: Debug<R>, debug_T: Debug<T>): string {
  const rec = (t: Tree<D, R, T>, f: Fmt): string => debug_Tree(t, f, debug_D, debug_R, debug_T);
  switch (v.$) {
    case "Seq":
      return debug_tuple(f, "Seq", [debug_vec(v._0, f, rec)]);
    case "Alt":
      return debug_tuple(f, "Alt", [debug_vec(v._0, f, rec)]);
    case "Def":
      return debug_tuple(f, "Def", [debug_D(v._0, f)]);
    case "Ref":
      return debug_tuple(f, "Ref", [debug_Reference(v._0, f, debug_R, debug_T)]);
    case "Byte":
      return debug_tuple(f, "Byte", [debug_Byte(v._0, f)]);
  }
}
/** derive(PartialEq) (module comment) */
export function Tree_eq<D, R, T>(a: Tree<D, R, T>, b: Tree<D, R, T>): boolean {
  switch (a.$) {
    case "Seq":
    case "Alt": {
      if (b.$ !== a.$ || a._0.length !== b._0.length) return false;
      const bs = b._0;
      return a._0.every((x, i) => Tree_eq(x, bs[i]!));
    }
    case "Def":
      return b.$ === "Def" && intern_key_eq(a._0, b._0);
    case "Ref":
      return b.$ === "Ref" && intern_key_eq(a._0, b._0);
    case "Byte":
      return b.$ === "Byte" && Byte_eq(a._0, b._0);
  }
}
/** derive(Clone): a fresh tree (module comment). */
export function clone_Tree<D, R, T>(v: Tree<D, R, T>): Tree<D, R, T> {
  switch (v.$) {
    case "Seq":
      return { $: "Seq", _0: v._0.map(clone_Tree) };
    case "Alt":
      return { $: "Alt", _0: v._0.map(clone_Tree) };
    case "Def":
    case "Ref":
      return { ...v };
    case "Byte":
      return { $: "Byte", _0: new Byte(v._0.start, v._0.end) };
  }
}

// #[derive(Debug, Copy, Clone, Eq, PartialEq)]
export type Endian = "Little" | "Big";
export const Endian = {
  Little: "Little",
  Big: "Big",

  // #[cfg(feature = "rustc")] impl From<rustc_abi::Endian> for Endian
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:52 from
  from(order: abi_Endian): Endian {
    switch (order) {
      case "Little":
        return "Little";
      case "Big":
        return "Big";
    }
  },
} as const;
// derive(Debug)
export const debug_Endian: Debug<Endian> = (v) => v;

/** `const BYTE: RangeInclusive<u8> = 0x00..=0xFF;` and friends (`tree.rs` locals). */
const R_0: RangeInclusive_u8 = [0, 0];
const R_BYTE: RangeInclusive_u8 = [0x00, 0xff];
const R_NONZERO: RangeInclusive_u8 = [0x01, 0xff];

// impl<D, R, T> Tree<D, R, T>
export const Tree = {
  /// A `Tree` consisting only of a definition node.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:67 def
  def<D, R, T>(def: D): Tree<D, R, T> {
    return { $: "Def", _0: def };
  },

  /// A `Tree` representing an uninhabited type.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:72 uninhabited
  uninhabited<D, R, T>(): Tree<D, R, T> {
    return { $: "Alt", _0: [] };
  },

  /// A `Tree` representing a zero-sized type.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:77 unit
  unit<D, R, T>(): Tree<D, R, T> {
    return { $: "Seq", _0: [] };
  },

  /// A `Tree` containing one byte that may be initialized to any value or uninitialized.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:82 uninit
  uninit<D, R, T>(): Tree<D, R, T> {
    return { $: "Byte", _0: Byte.uninit() };
  },

  /// A `Tree` representing the layout of `bool`.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:87 bool
  bool<D, R, T>(): Tree<D, R, T> {
    return Tree.byte([0x00, 0x01]);
  },

  /// A `Tree` whose layout matches that of a `u8`.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:92 u8
  u8<D, R, T>(): Tree<D, R, T> {
    return Tree.byte([0x00, 0xff]);
  },

  /// A `Tree` whose layout matches that of a `char`.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:97 char
  char<D, R, T>(order: Endian): Tree<D, R, T> {
    // `char`s can be in the following ranges:
    // - [0, 0xD7FF]
    // - [0xE000, 10FFFF]
    //
    // All other `char` values are illegal. We can thus represent a `char`
    // as a union of three possible layouts:
    // - 00 00 [00, D7] XX
    // - 00 00 [E0, FF] XX
    // - 00 [01, 10] XX XX

    const _0 = R_0;
    const BYTE = R_BYTE;
    const x = Tree.from_big_endian<D, R, T>(order, [_0, _0, [0x00, 0xd7], BYTE]);
    const y = Tree.from_big_endian<D, R, T>(order, [_0, _0, [0xe0, 0xff], BYTE]);
    const z = Tree.from_big_endian<D, R, T>(order, [_0, [0x01, 0x10], BYTE, BYTE]);
    return Tree.alt([x, y, z]);
  },

  /// A `Tree` whose layout matches `std::num::NonZeroXxx`.
  // #[allow(dead_code)]
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:118 nonzero
  nonzero<D, R, T>(width_in_bytes: number): Tree<D, R, T> {
    const BYTE = R_BYTE;
    const NONZERO = R_NONZERO;

    let alts = Tree.uninhabited<D, R, T>();
    for (let nz_idx = 0; nz_idx < width_in_bytes; nz_idx++) {
      let seq = Tree.unit<D, R, T>();
      for (let pos = 0; pos < width_in_bytes; pos++) {
        seq = Tree.then(seq, Tree.byte<D, R, T>(pos === nz_idx ? NONZERO : BYTE));
      }
      alts = Tree.or(alts, seq);
    }
    return alts;
  },

  // rustc: compiler/rustc_transmute/src/layout/tree.rs:131 bytes
  bytes<D, R, T>(bytes: readonly (RangeInclusive_u8 | number)[]): Tree<D, R, T> {
    return Tree.seq(bytes.map(Byte.from).map((b): Tree<D, R, T> => ({ $: "Byte", _0: b })));
  },

  // rustc: compiler/rustc_transmute/src/layout/tree.rs:135 byte
  byte<D, R, T>(byte: RangeInclusive_u8 | number): Tree<D, R, T> {
    return { $: "Byte", _0: Byte.from(byte) };
  },

  /// A `Tree` whose layout is a number of the given width.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:140 number
  number<D, R, T>(width_in_bytes: number): Tree<D, R, T> {
    // `vec![Self::u8(); n]`: `n` fresh trees (module comment).
    return { $: "Seq", _0: Array.from({ length: width_in_bytes }, () => Tree.u8<D, R, T>()) };
  },

  /// A `Tree` whose layout is entirely padding of the given width.
  ///
  /// Each padding byte may be initialized to any value or uninitialized.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:147 padding
  padding<D, R, T>(width_in_bytes: number): Tree<D, R, T> {
    return { $: "Seq", _0: Array.from({ length: width_in_bytes }, () => Tree.uninit<D, R, T>()) };
  },

  /// Removes all `Def` nodes and rejects branches whose definitions make `f` return `true`.
  ///
  /// A sequence becomes uninhabited if any of its elements becomes uninhabited;
  /// alternatives retain their surviving branches. Retained definitions become
  /// empty sequences, so the result contains no definition nodes, as expressed
  /// by its `Tree<!, R, T>` type.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:157 prune
  prune<D, R, T>(self: Tree<D, R, T>, f: (d: D) => boolean): Tree<never, R, T> {
    switch (self.$) {
      case "Seq": {
        // `elts.into_iter().map(|elt| elt.prune(f)).try_fold(Tree::unit(), ..)`
        let node = Tree.unit<never, R, T>();
        for (const elt_ of self._0) {
          const elt = Tree.prune(elt_, f);
          if (Tree_eq(elt, Tree.uninhabited<never, R, T>())) {
            // ControlFlow::Break(Tree::uninhabited())
            node = Tree.uninhabited();
            break;
          } else {
            node = Tree.then(node, elt);
          }
        }
        return node;
      }
      case "Alt": {
        let alts = Tree.uninhabited<never, R, T>();
        for (const alt of self._0) {
          alts = Tree.or(alts, Tree.prune(alt, f));
        }
        return alts;
      }
      case "Byte":
        return { $: "Byte", _0: self._0 };
      case "Ref":
        return { $: "Ref", _0: self._0 };
      case "Def": {
        const d = self._0;
        if (f(d)) {
          return Tree.uninhabited();
        } else {
          return Tree.unit();
        }
      }
    }
  },

  /// Produces `true` if `Tree` is an inhabited type; otherwise false.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:191 is_inhabited
  is_inhabited<D, R, T>(self: Tree<D, R, T>): boolean {
    switch (self.$) {
      case "Seq":
        return self._0.every((elt) => Tree.is_inhabited(elt));
      case "Alt":
        return self._0.some((alt) => Tree.is_inhabited(alt));
      case "Byte":
      case "Ref":
      case "Def":
        return true;
    }
  },

  /// Produces a `Tree` which represents a sequence of bytes stored in
  /// `order`.
  ///
  /// `bytes` is taken to be in big-endian byte order, and its order will be
  /// swapped if `order == Endian::Little`.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:204 from_big_endian
  from_big_endian<D, R, T>(order: Endian, bytes_: readonly (RangeInclusive_u8 | number)[]): Tree<D, R, T> {
    // `mut bytes: [B; N]` is the caller's copy.
    const bytes = [...bytes_];
    if (order === "Little") {
      bytes.reverse();
    }

    return Tree.bytes(bytes);
  },

  /// Produces a `Tree` where each of the trees in `trees` are sequenced one
  /// after another.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:217 seq
  seq<D, R, T>(trees: Tree<D, R, T>[]): Tree<D, R, T> {
    return trees.reduce((acc, t) => Tree.then(acc, t), Tree.unit<D, R, T>());
  },

  /// Produces a `Tree` where each of the trees in `trees` are accepted as
  /// alternative layouts.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:223 alt
  alt<D, R, T>(trees: Tree<D, R, T>[]): Tree<D, R, T> {
    return trees.reduce((acc, t) => Tree.or(acc, t), Tree.uninhabited<D, R, T>());
  },

  /// Produces a new `Tree` where `other` is sequenced after `self`.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:228 then
  then<D, R, T>(self: Tree<D, R, T>, other: Tree<D, R, T>): Tree<D, R, T> {
    // (Self::Seq(elts), other) | (other, Self::Seq(elts)) if elts.len() == 0 => other,
    if (self.$ === "Seq" && self._0.length === 0) return other;
    if (other.$ === "Seq" && other._0.length === 0) return self;
    if (self.$ === "Seq" && other.$ === "Seq") {
      const lhs = self._0;
      for (const t of other._0) lhs.push(t);
      return { $: "Seq", _0: lhs };
    }
    if (self.$ === "Seq") {
      const lhs = self._0;
      lhs.push(other);
      return { $: "Seq", _0: lhs };
    }
    if (other.$ === "Seq") {
      const rhs = other._0;
      rhs.unshift(self);
      return { $: "Seq", _0: rhs };
    }
    return { $: "Seq", _0: [self, other] };
  },

  /// Produces a new `Tree` accepting either `self` or `other` as alternative layouts.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:248 or
  or<D, R, T>(self: Tree<D, R, T>, other: Tree<D, R, T>): Tree<D, R, T> {
    // (Self::Alt(alts), other) | (other, Self::Alt(alts)) if alts.len() == 0 => other,
    if (self.$ === "Alt" && self._0.length === 0) return other;
    if (other.$ === "Alt" && other._0.length === 0) return self;
    if (self.$ === "Alt" && other.$ === "Alt") {
      const lhs = self._0;
      for (const t of other._0) lhs.push(t);
      return { $: "Alt", _0: lhs };
    }
    // (Self::Alt(mut alts), alt) | (alt, Self::Alt(mut alts)) => { alts.push(alt); Self::Alt(alts) }
    if (self.$ === "Alt") {
      const alts = self._0;
      alts.push(other);
      return { $: "Alt", _0: alts };
    }
    if (other.$ === "Alt") {
      const alts = other._0;
      alts.push(self);
      return { $: "Alt", _0: alts };
    }
    return { $: "Alt", _0: [self, other] };
  },

  // ---- #[cfg(feature = "rustc")] impl<'tcx> Tree<Def<'tcx>, Region<'tcx>, Ty<'tcx>> (tree.rs:303) ----

  // rustc: compiler/rustc_transmute/src/layout/tree.rs:304 from_ty
  from_ty(ty: Ty, cx: LayoutCx): Result<RTree, rustc.Err> {
    // use rustc_abi::HasDataLayout;
    const layout_r = layout_of(cx, ty);
    if (layout_r.$ === "Err") return ResErr(rustc.Err.from(layout_r._0));
    const layout = layout_r._0;

    const er = TypeVisitableExt.error_reported(ty, fold_Ty);
    if (er.$ === "Err") {
      const e = er._0;
      return ResErr({ $: "TypeError", _0: e });
    }

    const target = cx.data_layout();
    const pointer_size = target.pointer_size();

    const k = ty.kind();
    if (k.$ === "Bool") {
      return Ok(Tree.bool());
    } else if (k.$ === "Float") {
      const nty = k._0;
      const width = FloatTy.bit_width(nty) / 8;
      return Ok(Tree.number(width));
    } else if (k.$ === "Int") {
      const nty = k._0;
      const width = unwrap(IntTy.bit_width(IntTy.normalize(nty, pointer_size.bits()))) / 8;
      return Ok(Tree.number(width));
    } else if (k.$ === "Uint") {
      const nty = k._0;
      const width = unwrap(UintTy.bit_width(UintTy.normalize(nty, pointer_size.bits()))) / 8;
      return Ok(Tree.number(width));
    } else if (k.$ === "Tuple") {
      const members = k._0;
      return Tree.from_tuple([ty, layout], members, cx);
    } else if (k.$ === "Array") {
      const inner_ty = k._0;
      const fields = layout.fields();
      if (fields.$ !== "Array") {
        return ResErr(rustc.Err.NotYetSupported);
      }
      const { stride, count } = fields;
      const inner_layout_r = layout_of(cx, inner_ty);
      if (inner_layout_r.$ === "Err") return ResErr(rustc.Err.from(inner_layout_r._0));
      const inner_layout = inner_layout_r._0;
      assert_eq(stride, inner_layout.size(), (s) => `Size { raw: ${s.bytes()} }`, (a, b) => a.bytes() === b.bytes());
      const elt_r = Tree.from_ty(inner_ty, cx);
      if (elt_r.$ === "Err") return elt_r;
      const elt = elt_r._0;
      // `std::iter::repeat_n(elt, *count as usize).fold(Tree::unit(), |tree, elt| tree.then(elt))`: each repetition
      // is a fresh tree (module comment).
      let tree = Tree.unit<layout_rustc.Def, Region, Ty>();
      const n = Number(count);
      for (let i = 0; i < n; i++) {
        tree = Tree.then(tree, clone_Tree(elt));
      }
      return Ok(tree);
    } else if (k.$ === "Adt" && !ty.is_box()) {
      const adt_def = k._0;
      switch (adt_def.adt_kind()) {
        case "Struct":
          return Tree.from_struct([ty, layout], adt_def, cx);
        case "Enum":
          return Tree.from_enum([ty, layout], adt_def, cx);
        case "Union":
          return Tree.from_union([ty, layout], adt_def, cx);
      }
    } else if (k.$ === "Ref") {
      const [region, ty_, mutability] = [k._0, k._1, k._2];
      const layout_r = layout_of(cx, ty_);
      if (layout_r.$ === "Err") return ResErr(rustc.Err.from(layout_r._0));
      const layout = layout_r._0;
      const referent_align = layout.align().abi.bytes_usize();
      const referent_size = layout.size().bytes_usize();

      return Ok({
        $: "Ref",
        _0: {
          region: region,
          is_mut: Mutability.is_mut(mutability),
          referent: ty_,
          referent_align,
          referent_size,
        },
      });
    } else if (k.$ === "Char") {
      return Ok(Tree.char(Endian.from(cx.tcx_().data_layout().endian)));
    } else {
      return ResErr(rustc.Err.NotYetSupported);
    }
  },

  /// Constructs a `Tree` from a tuple.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:373 from_tuple
  from_tuple([ty, layout]: [Ty, Layout], members: readonly Ty[], cx: LayoutCx): Result<RTree, rustc.Err> {
    const fields = layout.fields();
    switch (fields.$) {
      case "Primitive": {
        assert_eq(members.length, 1, String);
        const inner_ty = members[0]!;
        return Tree.from_ty(inner_ty, cx);
      }
      case "Arbitrary": {
        const offsets = fields.offsets;
        assert_eq(offsets.length, members.length, String);
        return Tree.from_variant(layout_rustc.Def.Primitive, undefined, [ty, layout], layout.size(), cx);
      }
      case "Array":
      case "Union":
        return ResErr(rustc.Err.NotYetSupported);
    }
  },

  /// Constructs a `Tree` from a struct.
  ///
  /// # Panics
  ///
  /// Panics if `def` is not a struct definition.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:397 from_struct
  from_struct([ty, layout]: [Ty, Layout], def_: AdtDef, cx: LayoutCx): Result<RTree, rustc.Err> {
    assert(def_.is_struct(), "assertion failed: def.is_struct()");
    const def: layout_rustc.Def = { $: "Adt", _0: def_ };
    return Tree.from_variant(def, undefined, [ty, layout], layout.size(), cx);
  },

  /// Constructs a `Tree` from an enum.
  ///
  /// # Panics
  ///
  /// Panics if `def` is not an enum definition.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:412 from_enum
  from_enum([ty, layout]: [Ty, Layout], def: AdtDef, cx: LayoutCx): Result<RTree, rustc.Err> {
    assert(def.is_enum(), "assertion failed: def.is_enum()");

    // Computes the layout of a variant.
    const layout_of_variant = (index: VariantIdx, encoding: TagEncoding | undefined): Result<RTree, rustc.Err> => {
      const variant_layout = ty_variant(cx, [ty, layout], index);
      if (variant_layout.deref_().is_uninhabited()) {
        return Ok(Tree.uninhabited());
      }
      const tcx = cx.tcx_();
      // PORT: the `tag_for_variant` query value is `unknown` in queries.gen.ts (`Option<ty::ScalarInt>`).
      const tag = tcx.tag_for_variant(cx.typing_env.as_query_input([tcx.erase_and_anonymize_regions(ty, fold_Ty), index])) as ScalarInt | undefined;
      const variant_def: layout_rustc.Def = { $: "Variant", _0: def.variant(index) };
      return Tree.from_variant(variant_def, tag === undefined ? undefined : [tag, index, unwrap(encoding)], [ty, variant_layout], layout.size(), cx);
    };

    const variants_ = layout.variants();
    switch (variants_.$) {
      case "Empty":
        return Ok(Tree.uninhabited());
      case "Single": {
        const index = variants_.index;
        // `Variants::Single` on enums with variants denotes that
        // the enum delegates its layout to the variant at `index`.
        return layout_of_variant(index, undefined);
      }
      case "Multiple": {
        const { tag_encoding, tag_field } = variants_;
        // `Variants::Multiple` denotes an enum with multiple
        // variants. The layout of such an enum is the disjunction
        // of the layouts of its tagged variants.

        // For enums (but not coroutines), the tag field is
        // currently always the first field of the layout.
        assert_eq(tag_field, FieldIdx.ZERO, String);

        let variants = Tree.uninhabited<layout_rustc.Def, Region, Ty>();
        for (const [idx, _discriminant] of def.discriminants(cx.tcx_())) {
          const variant_r = layout_of_variant(idx, tag_encoding);
          if (variant_r.$ === "Err") return variant_r;
          variants = Tree.or(variants, variant_r._0);
        }

        return Ok(Tree.then(Tree.def({ $: "Adt", _0: def }), variants));
      }
    }
  },

  /// Constructs a `Tree` from a 'variant-like' layout.
  ///
  /// A 'variant-like' layout includes those of structs and, of course,
  /// enum variants. Pragmatically speaking, this method supports anything
  /// with `FieldsShape::Arbitrary`.
  ///
  /// Note: This routine assumes that the optional `tag` is the first
  /// field, and enum callers should check that `tag_field` is, in fact,
  /// `0`.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:476 from_variant
  from_variant(
    def: layout_rustc.Def,
    tag: [ScalarInt, VariantIdx, TagEncoding] | undefined,
    [ty, layout]: [Ty, Layout],
    total_size: Size,
    cx: LayoutCx,
  ): Result<RTree, rustc.Err> {
    // This constructor does not support non-`FieldsShape::Arbitrary`
    // layouts.
    const fields = layout.fields();
    if (fields.$ !== "Arbitrary") {
      return ResErr(rustc.Err.NotYetSupported);
    }
    const { offsets, in_memory_order } = fields;

    // When this function is invoked with enum variants,
    // `layout.size` does not encompass the entire size of the
    // enum. We rely on `total_size` for this.
    assert(layout.size().bytes() <= total_size.bytes(), "assertion failed: layout.size <= total_size");

    let size = Size.ZERO;
    let struct_tree = Tree.def<layout_rustc.Def, Region, Ty>(def);

    // If a `tag` is provided, place it at the start of the layout.
    if (tag !== undefined) {
      const [tag_, index, encoding] = tag;
      switch (encoding.$) {
        case "Direct": {
          size = size.add(tag_.size());
          break;
        }
        case "Niche": {
          const niche_variants = encoding.niche_variants;
          if (!(niche_variants.start <= index && index <= niche_variants.last)) {
            size = size.add(tag_.size());
          }
          break;
        }
      }
      struct_tree = Tree.then(struct_tree, Tree.from_tag(tag_, cx.tcx_()));
    }

    // Append the fields, in memory order, to the layout.
    for (const field_idx of in_memory_order) {
      // Add interfield padding.
      const padding_needed = offsets[field_idx]!.sub(size);
      const padding = Tree.padding<layout_rustc.Def, Region, Ty>(padding_needed.bytes_usize());

      const field_ty = ty_field(cx, [ty, layout], field_idx);
      const field_layout_r = layout_of(cx, field_ty);
      if (field_layout_r.$ === "Err") return ResErr(rustc.Err.from(field_layout_r._0));
      const field_layout = field_layout_r._0;
      const field_tree_r = Tree.from_ty(field_ty, cx);
      if (field_tree_r.$ === "Err") return field_tree_r;
      const field_tree = field_tree_r._0;

      struct_tree = Tree.then(Tree.then(struct_tree, padding), field_tree);

      size = size.add(padding_needed.add(field_layout.size()));
    }

    // Add trailing padding.
    const padding_needed = total_size.sub(size);
    const trailing_padding = Tree.padding<layout_rustc.Def, Region, Ty>(padding_needed.bytes_usize());

    return Ok(Tree.then(struct_tree, trailing_padding));
  },

  /// Constructs a `Tree` representing the value of a enum tag.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:535 from_tag
  from_tag(tag: ScalarInt, tcx: TyCtxt): RTree {
    // use rustc_abi::Endian;
    const size = tag.size();
    const bits = tag.to_bits(size);
    // `bits.to_le_bytes()` (u128)
    const le_bytes: number[] = [];
    for (let i = 0n; i < 16n; i++) le_bytes.push(Number((bits >> (8n * i)) & 0xffn));
    let bytes: number[];
    switch (tcx.data_layout().endian) {
      case "Little": {
        bytes = le_bytes.slice(0, size.bytes_usize());
        break;
      }
      case "Big": {
        // `bits.to_be_bytes()[16 - size..]`
        const be_bytes = [...le_bytes].reverse();
        bytes = be_bytes.slice(be_bytes.length - size.bytes_usize());
        break;
      }
    }
    return { $: "Seq", _0: bytes.map((b) => Tree.byte<layout_rustc.Def, Region, Ty>(b)) };
  },

  /// Constructs a `Tree` from a union.
  ///
  /// # Panics
  ///
  /// Panics if `def` is not a union definition.
  // rustc: compiler/rustc_transmute/src/layout/tree.rs:558 from_union
  from_union([ty, layout]: [Ty, Layout], def: AdtDef, cx: LayoutCx): Result<RTree, rustc.Err> {
    assert(def.is_union(), "assertion failed: def.is_union()");

    // This constructor does not support non-`FieldsShape::Union`
    // layouts. Fields of this shape are all placed at offset 0.
    const shape = layout.fields();
    if (shape.$ !== "Union") {
      return ResErr(rustc.Err.NotYetSupported);
    }

    const fields_ = def.non_enum_variant().fields;
    let fields = Tree.uninhabited<layout_rustc.Def, Region, Ty>();
    for (let idx = 0; idx < fields_.length; idx++) {
      const field_ty = ty_field(cx, [ty, layout], idx as FieldIdx);
      const field_layout_r = layout_of(cx, field_ty);
      if (field_layout_r.$ === "Err") return ResErr(rustc.Err.from(field_layout_r._0));
      const field_layout = field_layout_r._0;
      const field_r = Tree.from_ty(field_ty, cx);
      if (field_r.$ === "Err") return field_r;
      const field = field_r._0;
      const trailing_padding_needed = layout.size().sub(field_layout.size());
      const trailing_padding = Tree.padding<layout_rustc.Def, Region, Ty>(trailing_padding_needed.bytes_usize());
      const field_and_padding = Tree.then(field, trailing_padding);
      fields = Tree.or(fields, field_and_padding);
    }

    return Ok(Tree.then(Tree.def({ $: "Adt", _0: def }), fields));
  },
};

/** `Tree<Def<'tcx>, Region<'tcx>, Ty<'tcx>>` */
export type RTree = Tree<layout_rustc.Def, Region, Ty>;

/** `use crate::layout::rustc::layout_of;` (read at call time: init order, layout/mod.ts re-exports this module) */
function layout_of(cx: LayoutCx, ty: Ty): Result<Layout, LayoutError> {
  return layout_rustc.layout_of(cx, ty);
}

// ---- #[cfg(feature = "rustc")] pub(crate) mod rustc (tree.rs:265) ----
export namespace rustc {
  // #[derive(Debug, Copy, Clone)]
  export type Err =
    /// The layout of the type is not yet supported.
    | { readonly $: "NotYetSupported" }
    /// This error will be surfaced elsewhere by rustc, so don't surface it.
    | { readonly $: "UnknownLayout" }
    /// Overflow size
    | { readonly $: "SizeOverflow" }
    | { readonly $: "TypeError"; readonly _0: ErrorGuaranteed };
  export const Err = {
    NotYetSupported: Object.freeze({ $: "NotYetSupported" }) as Err,
    UnknownLayout: Object.freeze({ $: "UnknownLayout" }) as Err,
    SizeOverflow: Object.freeze({ $: "SizeOverflow" }) as Err,

    // impl<'tcx> From<&LayoutError<'tcx>> for Err
    // rustc: compiler/rustc_transmute/src/layout/tree.rs:291 from
    from(err: LayoutError): Err {
      switch (err.$) {
        case "Unknown":
        case "ReferencesError":
        case "TooGeneric":
        case "InvalidSimd":
        case "NormalizationFailure":
          return Err.UnknownLayout;
        case "SizeOverflow":
          return Err.SizeOverflow;
      }
    },
  };
  // derive(Debug)
  export const debug_Err: Debug<Err> = (v, f) => (v.$ === "TypeError" ? debug_tuple(f, "TypeError", [debug_ErrorGuaranteed(v._0, f)]) : v.$);
}

// rustc: compiler/rustc_transmute/src/layout/tree.rs:589 ty_field
function ty_field(cx: LayoutCx, [ty, layout]: [Ty, Layout], i: FieldIdx): Ty {
  // We cannot use `ty_and_layout_field` to retrieve the field type, since
  // `ty_and_layout_field` erases regions in the returned type. We must
  // not erase regions here, since we may need to ultimately emit outlives
  // obligations as a consequence of the transmutability analysis.
  const k = ty.kind();
  switch (k.$) {
    case "Adt": {
      const [def, args] = [k._0, k._1];
      const variants = layout.variants();
      switch (variants.$) {
        case "Single": {
          const index = variants.index;
          const field = def.variant(index).fields[i]!;
          return Unnormalized.skip_norm_wip(field.ty(cx.tcx_(), args));
        }
        case "Empty":
          return panic("there is no field in Variants::Empty types");
        // Discriminant field for enums (where applicable).
        case "Multiple": {
          const tag = variants.tag;
          assert_eq(FieldIdx.as_usize(i), 0, String);
          return PrimitiveExt.to_ty(Scalar.primitive(tag), cx.tcx_());
        }
      }
    }
    case "Tuple": {
      const fields = k._0;
      return fields[FieldIdx.as_usize(i)]!;
    }
    default: {
      const kind = k;
      return panic(
        `not implemented: only a subset of \`Ty::ty_and_layout_field\`'s functionality is implemented. implementation needed for ${debug_TyKind(kind, PLAIN)}`,
      );
    }
  }
}

// rustc: compiler/rustc_transmute/src/layout/tree.rs:621 ty_variant
function ty_variant(cx: LayoutCx, [ty, layout]: [Ty, Layout], i: VariantIdx): Layout {
  const ty_ = cx.tcx_().erase_and_anonymize_regions(ty, fold_Ty);
  return new TyAndLayout(ty_, layout).for_variant(cx, i).layout;
}
