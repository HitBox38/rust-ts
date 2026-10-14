// Port of compiler/rustc_middle/src/ty/consts.rs (lane ty-results; was lane ty-contract's stub).
//
// `#[extension(pub trait ConstExt)] impl Const` (consts.rs:27): methods on `Const.prototype` / statics on `Const`, as
// declared in ty/decls.ts (`// ty/consts.rs:<line>`).
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code touches only `Const`.
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { TypeWalker } from "../../rustc_type_ir/walk.ts";
import { bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import type { ConstKind } from "../../rustc_type_ir/const_kind.gen.ts";
import type { TyCtxt } from "./context.ts";
import type { Scalar, TypingEnv, ValTree as PendingValTree, Value as PendingValue } from "./decls.ts";
import { GenericArg } from "./generic_args.ts";
import type { Ty } from "./mod.ts";
import { ScalarInt } from "./consts/int.ts";
import { as_pending_Value, from_pending_Value, ValTree, Value } from "./consts/valtree.ts";

// The types of this file with their derived Debug / TypeVisitable / TypeFoldable impls are generated into consts.gen.ts
// (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir); merged with the contract stub by merge-w13.
export * from "./consts.gen.ts";

// `mod int; mod kind; mod lit; mod valtree;` + `pub use {int,kind,lit,valtree}::*`
export * from "./consts/int.ts";
export * from "./consts/kind.ts";
export * from "./consts/lit.ts";
export * from "./consts/valtree.ts";

// #[cfg(target_pointer_width = "64")]
// rustc_data_structures::static_assert_size!(ConstKind<'_>, 32);

// ---- PORT stand-ins for items of other lanes' files that are not ported yet ----------------------------------------

/** PORT: stand-in for `tcx.layout_of(typing_env.as_query_input(ty))` (ty/mod.rs `TypingEnv::as_query_input`, ty/layout.rs;
 *  layouts are M4) with `.unwrap_or_else(|e| panic!("could not compute layout for {ty:?}: {e:?}")).size`. */
function layout_of_size(_tcx: TyCtxt, _typing_env: TypingEnv, _ty: Ty): never {
  return unported("rustc_middle::ty::layout::LayoutOf::layout_of (Const::from_bits; layouts are M4)");
}
/** PORT: stand-in for `ty::TypingEnv::fully_monomorphized()` (ty/mod.rs, lanes ty-mod). */
function TypingEnv_fully_monomorphized(): TypingEnv {
  return unported("rustc_middle::ty::TypingEnv::fully_monomorphized (lanes ty-mod)");
}

/// Creates a constant with the given integer value and interns it.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/consts.rs:31 from_bits
Const.from_bits = function (tcx: TyCtxt, bits: bigint, typing_env: TypingEnv, ty: Ty): Const {
  const size = layout_of_size(tcx, typing_env, ty);
  const int = ScalarInt.try_from_uint(bits, size);
  if (int === undefined) panic("called `Option::unwrap()` on a `None` value");
  const valtree = ValTree.from_scalar_int(tcx, int);
  return Const.new_value(tcx, valtree as unknown as PendingValTree, ty);
};

// #[inline]
/// Creates an interned zst constant.
// rustc: compiler/rustc_middle/src/ty/consts.rs:48 zero_sized
Const.zero_sized = function (tcx: TyCtxt, ty: Ty): Const {
  return Const.new_value(tcx, ValTree.zst(tcx) as unknown as PendingValTree, ty);
};

// #[inline]
// rustc: compiler/rustc_middle/src/ty/consts.rs:53 new_value
Const.new_value = function (tcx: TyCtxt, valtree: PendingValTree, ty: Ty): Const {
  const value: Value = { ty, valtree: valtree as unknown as ValTree };
  return Const.new(tcx, { $: "Value", _0: as_pending_Value(value) } as ConstKind);
};

// #[inline]
/// Creates an interned bool constant.
// rustc: compiler/rustc_middle/src/ty/consts.rs:59 from_bool
Const.from_bool = function (tcx: TyCtxt, v: boolean): Const {
  return Const.from_bits(tcx, v ? 1n : 0n, TypingEnv_fully_monomorphized(), tcx.types.bool);
};

// #[inline]
/// Creates an interned usize constant.
// PORT: `n: u64` is declared `number` in decls.ts.
// rustc: compiler/rustc_middle/src/ty/consts.rs:65 from_target_usize
Const.from_target_usize = function (tcx: TyCtxt, n: number): Const {
  return Const.from_bits(tcx, BigInt(n), TypingEnv_fully_monomorphized(), tcx.types.usize);
};

/// Panics if `self.kind != ty::ConstKind::Value`.
// rustc: compiler/rustc_middle/src/ty/consts.rs:70 to_value
Const.prototype.to_value = function (this: Const): PendingValue {
  const k = this.kind();
  switch (k.$) {
    case "Value":
      return k._0;
    default: {
      const { debug_ConstKind } = require("../../rustc_type_ir/const_kind.ts") as typeof import("../../rustc_type_ir/const_kind.ts");
      return bug(`expected ConstKind::Value, got ${debug_ConstKind(this.kind(), PLAIN)}`);
    }
  }
};

/// Attempts to convert to a value.
///
/// Note that this does not normalize the constant.
// rustc: compiler/rustc_middle/src/ty/consts.rs:80 try_to_value
Const.prototype.try_to_value = function (this: Const): PendingValue | undefined {
  const k = this.kind();
  switch (k.$) {
    case "Value":
      return k._0;
    default:
      return undefined;
  }
};

/// Converts to a `ValTreeKind::Leaf` value, `panic`'ing
/// if this constant is some other kind.
///
/// Note that this does not normalize the constant.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/consts.rs:92 to_leaf
Const.prototype.to_leaf = function (this: Const): ScalarInt {
  return Value.to_leaf(from_pending_Value(this.to_value()));
} as never;

/// Converts to a `ValTreeKind::Branch` value, `panic`'ing
/// if this constant is some other kind.
///
/// Note that this does not normalize the constant.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/consts.rs:101 to_branch
Const.prototype.to_branch = function (this: Const): readonly Const[] {
  return Value.to_branch(from_pending_Value(this.to_value()));
};

/// Attempts to convert to a `ValTreeKind::Leaf` value.
///
/// Note that this does not normalize the constant.
// rustc: compiler/rustc_middle/src/ty/consts.rs:108 try_to_leaf
Const.prototype.try_to_leaf = function (this: Const): ScalarInt | undefined {
  const v = this.try_to_value();
  if (v === undefined) return undefined;
  return Value.try_to_leaf(from_pending_Value(v));
} as never;

/// Attempts to convert to a `ValTreeKind::Leaf` value.
///
/// Note that this does not normalize the constant.
// rustc: compiler/rustc_middle/src/ty/consts.rs:115 try_to_scalar
Const.prototype.try_to_scalar = function (this: Const): Scalar | undefined {
  const leaf = this.try_to_leaf() as unknown as ScalarInt | undefined;
  // `Scalar::Int` (mir/interpret/value.rs:25, M4): the variant's PORTING §5 shape.
  return leaf === undefined ? undefined : ({ $: "Int", _0: leaf } as unknown as Scalar);
};

/// Attempts to convert to a `ValTreeKind::Branch` value.
///
/// Note that this does not normalize the constant.
// rustc: compiler/rustc_middle/src/ty/consts.rs:122 try_to_branch
Const.prototype.try_to_branch = function (this: Const): readonly Const[] | undefined {
  const v = this.try_to_value();
  if (v === undefined) return undefined;
  return Value.try_to_branch(from_pending_Value(v));
};

/// Convenience method to extract the value of a usize constant,
/// useful to get the length of an array type.
///
/// Note that this does not evaluate the constant.
// PORT: the `u64` is declared `number` in decls.ts; `Value::try_to_target_usize` keeps the `bigint`, converted here
// (an ICE above 2^53, which no array length reaching the printer has; handoff asks root to retype the decl).
// #[inline]
// rustc: compiler/rustc_middle/src/ty/consts.rs:131 try_to_target_usize
Const.prototype.try_to_target_usize = function (this: Const, tcx: TyCtxt): number | undefined {
  const v = this.try_to_value();
  if (v === undefined) return undefined;
  const n = Value.try_to_target_usize(from_pending_Value(v), tcx);
  if (n === undefined) return undefined;
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) panic(`rust-ts: target usize ${n} exceeds 2^53 (Const::try_to_target_usize)`);
  return Number(n);
};

/// Iterator that walks `self` and any types reachable from
/// `self`, in depth-first order. Note that just walks the types
/// that appear in `self`, it does not descend into the fields of
/// structs or variants. For example:
///
/// ```text
/// isize => { isize }
/// Foo<Bar<isize>> => { Foo<Bar<isize>>, Bar<isize>, isize }
/// [isize] => { [isize], isize }
/// ```
// rustc: compiler/rustc_middle/src/ty/consts.rs:145 walk
Const.prototype.walk = function (this: Const): TypeWalker {
  return TypeWalker.new(GenericArg.from_Const(this));
};
