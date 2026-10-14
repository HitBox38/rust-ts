// Port of compiler/rustc_middle/src/ty/consts/valtree.rs (lane ty-results; was merge-w13's contract stub).
//
// PORT (D2): `ValTree(Interned<ValTreeKind>)` is a hash-consed class (`extends Interned`), made only by
// `tcx.intern_valtree` / `CommonConsts::new` (context.ts); its kind is the frozen `internee`. `Deref` (`*valtree` is
// the `&ValTreeKind`) and `IntoKind::kind` are `kind()`.
// PORT: `ty::Value` is a plain struct (`{ ty, valtree }`, PORTING §5 data-only struct) with a same-named companion holding
// its methods (taking `self` first, tyir-binder decision 5). decls.ts re-exports it (merge-w15b).
// PORT (init order): this is part of the defining-module graph (rustc_type_ir sty/consts.ts imports it): it must not
// import an extension module at load time; ty/print/pretty.ts (Display) and context/tls.ts are reached lazily.
import { Interned } from "../../../rustc_data_structures/intern.ts";
import type { Namespace } from "../../../rustc_hir/def.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { type Debug, debug_list, debug_struct, debug_tuple, type Fmt, PLAIN } from "../../../std/fmt.ts";
import { panic, unported } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import { try_visit } from "../../../rustc_ast_ir/visit.ts";
import type { FallibleTypeFolder, TypeFolder } from "../../../rustc_type_ir/fold.ts";
import type { TypeVisitor } from "../../../rustc_type_ir/visit.ts";
import type { ValTreeKind } from "../../../rustc_type_ir/const_kind.gen.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { TyCtxt } from "../context.ts";
import type { AdtDef, Scalar, TypingEnv, VariantIdx } from "../decls.ts";
import type { Ty } from "../mod.ts";
import { debug_ScalarInt, ScalarInt } from "./int.ts";
import type { Size } from "../../../rustc_abi/lib.ts";
import type { DestructuredAdtConst } from "../mod.ts";
export type { DestructuredAdtConst };

// ---- lazy modules (init order, module comment) ----
function structural_impls(): typeof import("../structural_impls.ts") {
  return require("../structural_impls.ts") as typeof import("../structural_impls.ts");
}
function pretty(): typeof import("../print/pretty.ts") {
  return require("../print/pretty.ts") as typeof import("../print/pretty.ts");
}
function tls(): typeof import("../context/tls.ts") {
  return require("../context/tls.ts") as typeof import("../context/tls.ts");
}


// ---- PORT stand-ins for items of other lanes' files that are not ported yet --------------------------------------

/** PORT: `rustc_abi::FIRST_VARIANT` (`VariantIdx::ZERO`). */
const FIRST_VARIANT = 0 as VariantIdx;
/** PORT: stand-in for `TypingEnv::with_post_analysis_normalized(tcx).as_query_input(ty)` + `tcx.layout_of(..)` (ty/mod.rs,
 *  ty/layout.rs): layouts are M4. Returns the layout's `size` or `undefined` for `Err`. */
function layout_size_of(_tcx: TyCtxt, _typing_env: TypingEnv, _ty: Ty): Size | undefined {
  return unported("rustc_middle::ty::layout::LayoutOf::layout_of (TypingEnv::as_query_input; layouts are M4)");
}
/** PORT: `Scalar::Int(int)` (mir/interpret/value.rs:25, M4): the variant's PORTING §5 shape. */
function Scalar_Int(int: ScalarInt): Scalar {
  return { $: "Int", _0: int } as unknown as Scalar;
}

/** `impl ValTreeKindExt for ty::ValTreeKind<TyCtxt>` (extension trait: free fn). */
// rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:20 try_to_scalar
export function ValTreeKind_try_to_scalar(self: ValTreeKind): Scalar | undefined {
  // `ValTreeKind::try_to_leaf` (rustc_type_ir const_kind.rs)
  const leaf = self.$ === "Leaf" ? (self._0 as unknown as ScalarInt) : undefined;
  return leaf === undefined ? undefined : Scalar_Int(leaf);
}

/// An interned valtree. Use this rather than `ValTreeKind`, whenever possible.
///
/// See the docs of [`ty::ValTreeKind`] or the [dev guide] for an explanation of this type.
///
/// [dev guide]: https://rustc-dev-guide.rust-lang.org/mir/index.html#valtrees
// FIXME(mgca): Try not interning here. We already intern `ty::Const` which `ValTreeKind`
// recurses through
// rustc-type: compiler/rustc_middle/src/ty/consts/valtree.rs:34 ValTree
export class ValTree extends Interned {
  /** PORT: the interned `ValTreeKind` (module comment). */
  readonly internee: ValTreeKind;

  /** PORT: only `tcx.intern_valtree` / `CommonConsts::new` construct (D2); the kind object is frozen with it. */
  constructor(internee: ValTreeKind) {
    super();
    this.internee = Object.freeze(internee);
    Object.freeze(this);
  }

  /// Returns the zero-sized valtree: `Branch([])`.
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:38 zst
  static zst(tcx: TyCtxt): ValTree {
    return tcx.consts.valtree_zst as ValTree;
  }

  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:42 is_zst
  is_zst(): boolean {
    const k = this.kind();
    return k.$ === "Branch" && k._0.length === 0;
  }

  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:46 from_raw_bytes
  static from_raw_bytes(tcx: TyCtxt, bytes: Uint8Array): ValTree {
    const branches = Array.from(bytes, (b) => {
      return Const_new_value(tcx, ValTree.from_scalar_int(tcx, ScalarInt.from_u8(b)), tcx.types.u8);
    });
    return ValTree.from_branches(tcx, branches);
  }

  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:53 from_branches
  static from_branches(tcx: TyCtxt, branches: Iterable<Const>): ValTree {
    return tcx.intern_valtree({ $: "Branch", _0: tcx.mk_const_list_from_iter(branches) } as ValTreeKind);
  }

  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:62 from_scalar_int
  static from_scalar_int(tcx: TyCtxt, i: ScalarInt): ValTree {
    return tcx.intern_valtree({ $: "Leaf", _0: i } as unknown as ValTreeKind);
  }

  // PORT: `Deref for ValTree` (`&self.0.0`, the interned `&ValTreeKind`) and `IntoKind::kind` (`*self.0`) are one
  // method: kinds are immutable, so the reference and the copy agree.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:71 deref
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:85 kind
  kind(): ValTreeKind {
    return this.internee;
  }
}

/** PORT: `ty::Const::new_value` (consts.rs:53, `ConstExt`); called through the static the extension module consts.ts
 *  installs (init order). */
function Const_new_value(tcx: TyCtxt, valtree: ValTree, ty: Ty): Const {
  const { Const } = require("../../../rustc_type_ir/sty/consts.ts") as typeof import("../../../rustc_type_ir/sty/consts.ts");
  return Const.new_value(tcx, valtree as never, ty);
}

// rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:77 fmt
export const debug_ValTree: Debug<ValTree> = (self, f) => {
  return debug_ValTreeKind_(self.kind(), f);
};
/** The derived Debug of `ValTreeKind` (rustc_type_ir const_kind.rs:223) with the `ScalarInt` / `&List<Const>` fields
 *  formatted by their impls. PORT: const_kind.gen.ts's `debug_ValTreeKind` prints both through `unported_debug` until
 *  tools/codegen's typemap maps `ScalarInt` / `Consts` (handoff); this is the same derive. */
function debug_ValTreeKind_(v: ValTreeKind, f: Fmt): string {
  switch (v.$) {
    case "Leaf": {
      return debug_tuple(f, "Leaf", [debug_ScalarInt(v._0 as unknown as ScalarInt, f)]);
    }
    case "Branch": {
      const { debug_Const } = require("../../../rustc_type_ir/sty/consts.ts") as typeof import("../../../rustc_type_ir/sty/consts.ts");
      return debug_tuple(f, "Branch", [debug_list(f, [...(v._0 as unknown as readonly Const[])].map((c) => debug_Const(c, f)))]);
    }
  }
}

/// `Ok(Err(ty))` indicates the constant was fine, but the valtree couldn't be constructed
/// because the value contains something of type `ty` that is not valtree-compatible.
/// The caller can then show an appropriate error; the query does not have the
/// necessary context to give good user-facing errors for this case.
// rustc-type: compiler/rustc_middle/src/ty/consts/valtree.rs:94 ConstToValTreeResult
export type ConstToValTreeResult = Result<Result<ValTree, Ty>, unknown /* ErrorHandled, M4 */>;

/// A type-level constant value.
///
/// Represents a typed, fully evaluated constant.
/// Note that this is also used by pattern elaboration to represent values which cannot occur in types,
/// such as raw pointers and floats.
// rustc-type: compiler/rustc_middle/src/ty/consts/valtree.rs:103 Value
export interface Value {
  readonly ty: Ty;
  readonly valtree: ValTree;
}
/** The derived `Debug` of `Value` (valtree.rs:101). */
export const debug_Value: Debug<Value> = (v, f) =>
  debug_struct(f, "Value", [
    ["ty", structural_impls().debug_Ty(v.ty, f)],
    ["valtree", debug_ValTree(v.valtree, f)],
  ]);

/** `impl Value` (valtree.rs:108) and `impl inherent::ValueConst for Value` (:230): methods taking `self` first. */
export const Value = {
  /// Attempts to extract the raw bits from the constant.
  ///
  /// Fails if the value can't be represented as bits (e.g. because it is a reference
  /// or an aggregate).
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:114 try_to_bits
  try_to_bits(self: Value, tcx: TyCtxt, typing_env: TypingEnv): bigint | undefined {
    const k = self.ty.kind();
    if (!(k.$ === "Bool" || k.$ === "Char" || k.$ === "Uint" || k.$ === "Int" || k.$ === "Float")) {
      return undefined;
    }
    const scalar = Value.try_to_leaf(self);
    if (scalar === undefined) return undefined;
    const size = layout_size_of(tcx, typing_env, self.ty);
    if (size === undefined) return undefined;
    return scalar.to_bits(size);
  },

  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:124 try_to_bool
  try_to_bool(self: Value): boolean | undefined {
    if (!self.ty.is_bool()) {
      return undefined;
    }
    const leaf = Value.try_to_leaf(self);
    if (leaf === undefined) return undefined;
    const r = leaf.try_to_bool();
    return r.$ === "Ok" ? r._0 : undefined;
  },

  // PORT: the `u64` result stays a `bigint` (PORTING §5).
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:131 try_to_target_usize
  try_to_target_usize(self: Value, tcx: TyCtxt): bigint | undefined {
    if (!self.ty.is_usize()) {
      return undefined;
    }
    const leaf = Value.try_to_leaf(self);
    return leaf === undefined ? undefined : leaf.to_target_usize(tcx);
  },

  /// Get the values inside the ValTree as a slice of bytes. This only works for
  /// constants with types &str, &[u8], or [u8; _].
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:140 try_to_raw_bytes
  try_to_raw_bytes(self: Value, tcx: TyCtxt): Uint8Array | undefined {
    const k = self.ty.kind();
    switch (k.$) {
      case "Ref": {
        const inner_ty = k._1;
        switch (inner_ty.kind().$) {
          // `&str` can be interpreted as raw bytes
          case "Str":
            break;
          // `&[T]` can be interpreted as raw bytes if elements are `u8`
          case "Slice":
            break;
          // other `&_` can't be interpreted as raw bytes
          default:
            return undefined;
        }
        break;
      }
      // `[T; N]` can be interpreted as raw bytes if elements are `u8`
      case "Array":
        break;
      // Otherwise, type cannot be interpreted as raw bytes
      default:
        return undefined;
    }

    // We create an iterator that yields `Option<u8>`
    // If there is `None` in the iterator, then the array is not a valid array of u8s and we return `None`
    const bytes: number[] = [];
    for (const ct of Value.to_branch(self)) {
      const v0 = ct.try_to_value();
      const value = v0 === undefined ? undefined : v0;
      const value_ = value !== undefined && value.ty === tcx.types.u8 ? value : undefined;
      const leaf = value_ === undefined ? undefined : Value.try_to_leaf(value_);
      const b = leaf === undefined ? undefined : leaf.to_u8();
      if (b === undefined) return undefined;
      bytes.push(b);
    }

    // `tcx.arena.alloc_from_iter(bytes)`
    return Uint8Array.from(bytes);
  },

  /// Converts to a `ValTreeKind::Leaf` value, `panic`'ing
  /// if this constant is some other kind.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:172 to_leaf
  to_leaf(self: Value): ScalarInt {
    const k = self.valtree.kind();
    switch (k.$) {
      case "Leaf":
        return k._0 as unknown as ScalarInt;
      case "Branch":
        return bug(`expected leaf, got ${debug_Value(self, PLAIN)}`);
    }
  },

  /// Converts to a `ValTreeKind::Branch` value, `panic`'ing
  /// if this constant is some other kind.
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:182 to_branch
  to_branch(self: Value): readonly Const[] {
    const k = self.valtree.kind();
    switch (k.$) {
      case "Branch":
        return k._0 as unknown as readonly Const[];
      case "Leaf":
        return bug(`expected branch, got ${debug_Value(self, PLAIN)}`);
    }
  },

  /// Attempts to convert to a `ValTreeKind::Leaf` value.
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:190 try_to_leaf
  try_to_leaf(self: Value): ScalarInt | undefined {
    const k = self.valtree.kind();
    switch (k.$) {
      case "Leaf":
        return k._0 as unknown as ScalarInt;
      case "Branch":
        return undefined;
    }
  },

  /// Attempts to convert to a `ValTreeKind::Leaf` value.
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:198 try_to_scalar
  try_to_scalar(self: Value): Scalar | undefined {
    const leaf = Value.try_to_leaf(self);
    return leaf === undefined ? undefined : Scalar_Int(leaf);
  },

  /// Attempts to convert to a `ValTreeKind::Branch` value.
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:203 try_to_branch
  try_to_branch(self: Value): readonly Const[] | undefined {
    const k = self.valtree.kind();
    switch (k.$) {
      case "Branch":
        return k._0 as unknown as readonly Const[];
      case "Leaf":
        return undefined;
    }
  },

  /// Destructures ADT constants into the constants of their fields.
  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:211 destructure_adt_const
  destructure_adt_const(self: Value): DestructuredAdtConst {
    const fields = Value.to_branch(self);

    let variant: VariantIdx;
    let fields_: readonly Const[];
    const k = self.ty.kind();
    if (k.$ === "Adt" && k._0.variants().length === 0) {
      return bug("unreachable");
    } else if (k.$ === "Adt" && k._0.is_enum()) {
      if (fields.length === 0) panic("called `Option::unwrap()` on a `None` value");
      const head = fields[0]!;
      const rest = fields.slice(1);
      variant = (head.to_leaf() as unknown as ScalarInt).to_u32() as VariantIdx;
      fields_ = rest;
    } else if (k.$ === "Adt") {
      variant = FIRST_VARIANT;
      fields_ = fields;
    } else {
      return bug(`destructure_adt_const called on non-ADT type: ${structural_impls().debug_Ty(self.ty, PLAIN)}`);
    }

    return { variant, fields: fields_ };
  },

  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:231 ty
  ty(self: Value): Ty {
    return self.ty;
  },

  // rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:235 valtree
  valtree(self: Value): ValTree {
    return self.valtree;
  },
};

/** `impl fmt::Display for Value` */
// rustc: compiler/rustc_middle/src/ty/consts/valtree.rs:241 fmt
export function display_Value(self: Value): string {
  return tls().with_((tcx) => {
    const { FmtPrinter } = pretty();
    const p = FmtPrinter.new(tcx, "ValueNS" as Namespace);
    // PORT: `tcx.lift(*self)` is the identity (one `TyCtxt`; `Lift` is skipped, PORTING §3).
    const r = p.pretty_print_const_valtree(self, /*print_ty*/ true);
    if (r.$ === "Err") return panic("a Display implementation returned an error unexpectedly: Error");
    return p.into_buffer();
  });
}

// ---- `#[derive(TypeFoldable, TypeVisitable)]` of `ty::Value` (valtree.rs:102) ----
// PORT: valtree.rs is not in a tools/codegen set yet (merge-w13's stubs), so the derived impls are written out here in
// the generator's shape (field order `ty`, `valtree`); drop them when the set is generated.

/** `#[derive(TypeVisitable)]` of `ty::Value` (valtree.rs:102). */
export function visit_with_Value<R>(self: Value, visitor: TypeVisitor<R>): R {
  const v = self;
  const si = structural_impls();
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, si.fold_Ty.visit_with(v.ty, visitor))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, si.fold_ValTree.visit_with(v.valtree, visitor))) !== undefined) return r;
  return visitor.Result.output();
}
/** `#[derive(TypeFoldable)]` of `ty::Value` (valtree.rs:102). */
export function try_fold_with_Value<E>(self: Value, folder: FallibleTypeFolder<E>): Result<Value, E> {
  const v = self;
  const si = structural_impls();
  const ty = si.fold_Ty.try_fold_with(v.ty, folder);
  if (ty.$ === "Err") return ty;
  const valtree = si.fold_ValTree.try_fold_with(v.valtree, folder);
  if (valtree.$ === "Err") return valtree;
  return Ok({ ty: ty._0, valtree: valtree._0 });
}
export function fold_with_Value(self: Value, folder: TypeFolder): Value {
  const v = self;
  const si = structural_impls();
  return { ty: si.fold_Ty.fold_with(v.ty, folder), valtree: si.fold_ValTree.fold_with(v.valtree, folder) };
}
