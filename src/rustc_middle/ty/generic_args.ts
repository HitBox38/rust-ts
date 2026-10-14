// Contract stub + partial port of compiler/rustc_middle/src/ty/generic_args.rs (lane ty-contract, docs/plan-m3.md
// D2/D3; the rest is lane ty-args').
//
// PORT (D3):
// - `GenericArg` (upstream a pointer to a `Ty`/`Region`/`Const` with the kind in its low tag bits) is the union
//   `Ty | Region | Const` of the hash-consed objects: packing is the identity, and `GenericArg.kind(arg)` reads
//   the tag from the object's class. Equality is `===` (upstream: the tagged pointer). Its inherent methods are
//   functions on the `GenericArg` companion (PORTING §8 "enum methods live on the companion").
// - `GenericArgs` is `List<GenericArg>`; its methods (`impl GenericArgs`, `impl inherent::GenericArgs for
//   GenericArgsRef`) are `RawList.prototype` methods typed `this: GenericArgs`, declared in decls.ts; statics
//   (`GenericArgs::identity_for_item`, ...) are on `RawList`. The stubs below are the ones lane ty-args fills.
// - The derived `PartialOrd`/`Ord` of `GenericArg` compare pointer addresses; nothing ported may rely on them.
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { GenericArgKind } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import type { Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { bug } from "../../rustc_span/macros.ts";
import { RawList, type List } from "./list.ts";
import { Term, Ty } from "./mod.ts";

/// An entity in the Rust type system, which can be one of
/// several kinds (types, lifetimes, and consts).
/// To reduce memory usage, a `GenericArg` is an interned pointer,
/// with the lowest 2 bits being reserved for a tag to
/// indicate the type (`Ty`, `Region`, or `Const`) it points to.
///
/// Note: the `PartialEq`, `Eq` and `Hash` derives are only valid because `Ty`,
/// `Region` and `Const` are all interned.
// rustc-type: compiler/rustc_middle/src/ty/generic_args.rs:37 GenericArg
export type GenericArg = Ty | Region | Const;

// rustc-type: compiler/rustc_middle/src/ty/generic_args.rs:378 GenericArgs
export type GenericArgs = List<GenericArg>;
/** `pub type GenericArgsRef<'tcx> = &'tcx GenericArgs<'tcx>` (generic_args.rs:380). */
export type GenericArgsRef = GenericArgs;

export const GenericArg = {
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:196 from
  /** `impl From<Region> for GenericArg` */
  from_Region(r: Region): GenericArg {
    return GenericArg.pack({ $: "Lifetime", _0: r });
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:203 from
  /** `impl From<Ty> for GenericArg` */
  from_Ty(ty: Ty): GenericArg {
    return GenericArg.pack({ $: "Type", _0: ty });
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:210 from
  /** `impl From<Const> for GenericArg` */
  from_Const(c: Const): GenericArg {
    return GenericArg.pack({ $: "Const", _0: c });
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:216 from
  /** `impl From<Term> for GenericArg` */
  from_Term(value: Term): GenericArg {
    const k = Term.kind(value);
    switch (k.$) {
      case "Ty":
        return GenericArg.from_Ty(k._0);
      case "Const":
        return GenericArg.from_Const(k._0);
    }
  },

  // PORT: also `impl IntoKind for GenericArg` (generic_args.rs:135, `self.kind()`): one function. The tag bits
  // are the object's class (module comment).
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:135 kind
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:226 kind
  kind(self: GenericArg): GenericArgKind {
    // SAFETY: use of `Interned::new_unchecked` here is ok because these
    // pointers were originally created from `Interned` types in `pack()`,
    // and this is just going in the other direction.
    if (self instanceof Region) return { $: "Lifetime", _0: self };
    if (self instanceof Ty) return { $: "Type", _0: self };
    if (self instanceof Const) return { $: "Const", _0: self };
    return panic_unreachable();
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:249 as_region
  as_region(self: GenericArg): Region | undefined {
    const k = GenericArg.kind(self);
    return k.$ === "Lifetime" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:257 as_type
  as_type(self: GenericArg): Ty | undefined {
    const k = GenericArg.kind(self);
    return k.$ === "Type" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:265 as_const
  as_const(self: GenericArg): Const | undefined {
    const k = GenericArg.kind(self);
    return k.$ === "Const" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:273 as_term
  as_term(self: GenericArg): Term | undefined {
    const k = GenericArg.kind(self);
    switch (k.$) {
      case "Lifetime":
        return undefined;
      case "Type":
        return Term.from_Ty(k._0);
      case "Const":
        return Term.from_Const(k._0);
    }
  },

  /// Unpack the `GenericArg` as a region when it is known certainly to be a region.
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:282 expect_region
  expect_region(self: GenericArg): Region {
    return GenericArg.as_region(self) ?? bug("expected a region, but found another kind");
  },

  /// Unpack the `GenericArg` as a type when it is known certainly to be a type.
  /// This is true in cases where `GenericArgs` is used in places where the kinds are known
  /// to be limited (e.g. in tuples, where the only parameters are type parameters).
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:289 expect_ty
  expect_ty(self: GenericArg): Ty {
    return GenericArg.as_type(self) ?? bug("expected a type, but found another kind");
  },

  /// Unpack the `GenericArg` as a const when it is known certainly to be a const.
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:294 expect_const
  expect_const(self: GenericArg): Const {
    return GenericArg.as_const(self) ?? bug("expected a const, but found another kind");
  },

  /** Stub: `GenericArg::is_non_region_infer` (generic_args.rs:298). */
  is_non_region_infer(_self: GenericArg): boolean {
    return unported("rustc_middle::ty::generic_args::GenericArg::is_non_region_infer");
  },

  /** Stub: `GenericArg::walk` (generic_args.rs:317). */
  walk(_self: GenericArg): unknown {
    return unported("rustc_middle::ty::generic_args::GenericArg::walk");
  },

  // PORT: `GenericArgPackExt::pack`: the tagged pointer is the object itself (module comment).
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:171 pack
  pack(self: GenericArgKind): GenericArg {
    switch (self.$) {
      case "Lifetime":
        // Ensure we can use the tag bits.
        // PORT: `assert_eq!(align_of_val(..) & TAG_MASK, 0)` has no meaning without pointers.
        return self._0;
      case "Type":
        return self._0;
      case "Const":
        return self._0;
    }
  },
};

/** `intrinsics::unreachable()` in `GenericArg::kind`: a tag that is no kind. */
function panic_unreachable(): never {
  return bug("GenericArg::kind: not a Ty, Region or Const");
}

/** Stub: `impl Debug for GenericArg` (structural_impls.rs:145). */
export function debug_GenericArg(_v: GenericArg, _f: Fmt): string {
  return unported("rustc_middle::ty::GenericArg: Debug");
}

/** Stub D4 descriptor: `impl TypeFoldable for GenericArg` (generic_args.rs:334) + `TypeVisitable` (:355). */
export const fold_GenericArg: TypeFoldable<GenericArg> = {
  try_fold_with(_self, _folder) {
    return unported("rustc_middle::ty::GenericArg: TypeFoldable::try_fold_with");
  },
  fold_with(_self, _folder) {
    return unported("rustc_middle::ty::GenericArg: TypeFoldable::fold_with");
  },
  visit_with(_self, _visitor) {
    return unported("rustc_middle::ty::GenericArg: TypeVisitable::visit_with");
  },
};

/** Stub D4 descriptor: `impl TypeFoldable for GenericArgsRef` (generic_args.rs:611) + `TypeVisitable for &List<T>` (:714). */
export const fold_GenericArgs: TypeFoldable<GenericArgs> = {
  try_fold_with(_self, _folder) {
    return unported("rustc_middle::ty::GenericArgsRef: TypeFoldable::try_fold_with");
  },
  fold_with(_self, _folder) {
    return unported("rustc_middle::ty::GenericArgsRef: TypeFoldable::fold_with");
  },
  visit_with(_self, _visitor) {
    return unported("rustc_middle::ty::GenericArgsRef: TypeVisitable::visit_with");
  },
};

/** Stub D4 descriptor: `impl TypeFoldable for &List<Ty>` (generic_args.rs:663) + `TypeVisitable for &List<T>` (:714). */
export const fold_List_Ty: TypeFoldable<List<Ty>> = {
  try_fold_with(_self, _folder) {
    return unported("rustc_middle::ty::List<Ty>: TypeFoldable::try_fold_with");
  },
  fold_with(_self, _folder) {
    return unported("rustc_middle::ty::List<Ty>: TypeFoldable::fold_with");
  },
  visit_with(_self, _visitor) {
    return unported("rustc_middle::ty::List<Ty>: TypeVisitable::visit_with");
  },
};

unported_methods(RawList.prototype, "rustc_middle::ty::generic_args::GenericArgs", [
  // `impl inherent::GenericArgs for GenericArgsRef` (generic_args.rs:44); `rebase_onto`, `type_at`, `region_at`,
  // `const_at` are the inherent methods below
  "split_closure_args",
  "split_coroutine_closure_args",
  "split_coroutine_args",
  // `impl GenericArgs` (generic_args.rs:382)
  "into_type_list",
  "as_closure",
  "as_coroutine_closure",
  "as_coroutine",
  "as_inline_const",
  "extend_to",
  "types",
  "regions",
  "consts",
  "terms",
  "non_erasable_generics",
  "type_at",
  "region_at",
  "const_at",
  "type_for_def",
  "rebase_onto",
  "truncate_to",
  "print_as_list",
]);
unported_methods(RawList, "rustc_middle::ty::generic_args::GenericArgs", [
  "identity_for_item",
  "for_item",
  "fill_item",
  "fill_single",
  "extend_with_error",
]);
