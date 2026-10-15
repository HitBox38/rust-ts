//! THIR datatypes and definitions. See the [rustc dev guide] for more info.
//!
//! If you compare the THIR [`ExprKind`] to [`hir::ExprKind`], you will see it is
//! a good bit simpler. In fact, a number of the more straight-forward
//! MIR simplifications are already done in the lowering to THIR. For
//! example, method calls and overloaded operators are absent: they are
//! expected to be converted into [`ExprKind::Call`] instances.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/thir.html
// Port of compiler/rustc_middle/src/thir.rs (lane middle-traits-thir). The data types are generated (thir.gen.ts, set
// rustc_middle_traits_thir); the `thir_with_elements!` items (macro-generated, invisible to the generator), the
// methods and the manual impls are here.
import type { UnrollAttr } from "../rustc_attr_ir/lib.ts";
import { clone_UnrollAttr, debug_UnrollAttr } from "../rustc_attr_ir/lib.ts";
import { display_RangeEnd } from "../rustc_hir/lib.ts";
import type { ByRef } from "../rustc_ast/lib.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import { Integer as IntegerC, type Integer, Size } from "../rustc_abi/lib.ts";
import type { IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { bug } from "../rustc_span/macros.ts";
import { type Debug, debug_map, debug_struct, debug_vec } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { TyCtxt } from "./ty/context.ts";
import type { ScalarInt, ValTree, Value } from "./ty/decls.ts";
import type { Ordering, Ty } from "./ty/mod.ts";
import {
  type Arm,
  type Block,
  type BodyTy,
  clone_Arm,
  clone_Block,
  clone_BodyTy,
  clone_Expr,
  clone_Param,
  clone_Stmt,
  debug_Arm,
  debug_Block,
  debug_BodyTy,
  debug_Expr,
  debug_Param,
  debug_Stmt,
  type Expr,
  type Param,
  Pat,
  PatRange,
  type Stmt,
} from "./thir.gen.ts";
import * as gen from "./thir.gen.ts";
import { for_each_immediate_subpat } from "./thir/visit.ts";

export * from "./thir.gen.ts";
// pub mod visit;
export * as visit from "./thir/visit.ts";

// ---- thir_with_elements! (thir.rs:44, expanded at :94) ------------------------------------------------------------

// PORT: `newtype_index!` (thir.rs:49, one per element) -> branded number + `newtype_index` companion (PORTING §5),
// `#[debug_format = $format]`.
export type ArmId = number & { readonly __brand: "ArmId" };
export const ArmId = newtype_index<ArmId>((n) => `a${n}`);
export const debug_ArmId: Debug<ArmId> = ArmId.debug;

export type BlockId = number & { readonly __brand: "BlockId" };
export const BlockId = newtype_index<BlockId>((n) => `b${n}`);
export const debug_BlockId: Debug<BlockId> = BlockId.debug;

export type ExprId = number & { readonly __brand: "ExprId" };
export const ExprId = newtype_index<ExprId>((n) => `e${n}`);
export const debug_ExprId: Debug<ExprId> = ExprId.debug;

export type StmtId = number & { readonly __brand: "StmtId" };
export const StmtId = newtype_index<StmtId>((n) => `s${n}`);
export const debug_StmtId: Debug<StmtId> = StmtId.debug;

export type ParamId = number & { readonly __brand: "ParamId" };
export const ParamId = newtype_index<ParamId>((n) => `p${n}`);
export const debug_ParamId: Debug<ParamId> = ParamId.debug;

// Note: Making `Thir` implement `Clone` is useful for external tools that need access to
// THIR bodies even after the `Steal` query result has been stolen.
// One such tool is https://github.com/rust-corpus/qrates/.
/// A container for a THIR body.
///
/// This can be indexed directly by any THIR index (e.g. [`ExprId`]).
// rustc-type: compiler/rustc_middle/src/thir.rs:63 Thir
// PORT: `IndexVec<$id, $value>` is `$value[]` indexed by the id (PORTING §5); `FxIndexMap<ExprId, _>` is a `Map`.
export class Thir {
  constructor(
    public body_type: BodyTy,
    public loop_hint_attrs: Map<ExprId, UnrollAttr[]>,
    public arms: Arm[],
    public blocks: Block[],
    public exprs: Expr[],
    public stmts: Stmt[],
    public params: Param[],
  ) {}

  // rustc: compiler/rustc_middle/src/thir.rs:72 new
  static new(body_type: BodyTy): Thir {
    return new Thir(body_type, new Map(), [], [], [], [], []);
  }

  // PORT: `impl Index<$id> for Thir` (one per element): `&self.$name[index]`; one method per id type (TS cannot
  // dispatch on a branded number). Out-of-range indices panic like slice indexing.
  // rustc: compiler/rustc_middle/src/thir.rs:86 index
  index_ArmId(index: ArmId): Arm {
    return index_vec(this.arms, index);
  }
  index_BlockId(index: BlockId): Block {
    return index_vec(this.blocks, index);
  }
  index_ExprId(index: ExprId): Expr {
    return index_vec(this.exprs, index);
  }
  index_StmtId(index: StmtId): Stmt {
    return index_vec(this.stmts, index);
  }
  index_ParamId(index: ParamId): Param {
    return index_vec(this.params, index);
  }
}

/** `IndexVec`'s `Index` (`&self.raw[index.index()]`): slice indexing, which panics out of range. */
function index_vec<T>(raw: readonly T[], index: number): T {
  if (index >= raw.length) {
    return panic(`index out of bounds: the len is ${raw.length} but the index is ${index}`);
  }
  return raw[index]!;
}

/** `#[derive(Debug)]` of `Thir` (IndexVec's Debug is the raw vec's). */
export const debug_Thir: Debug<Thir> = (v, f) =>
  debug_struct(f, "Thir", [
    ["body_type", debug_BodyTy(v.body_type, f)],
    ["loop_hint_attrs", debug_map(f, [...v.loop_hint_attrs].map(([k, x]) => [debug_ExprId(k, f), debug_vec(x, f, debug_UnrollAttr)]))],
    ["arms", debug_vec(v.arms, f, debug_Arm)],
    ["blocks", debug_vec(v.blocks, f, debug_Block)],
    ["exprs", debug_vec(v.exprs, f, debug_Expr)],
    ["stmts", debug_vec(v.stmts, f, debug_Stmt)],
    ["params", debug_vec(v.params, f, debug_Param)],
  ]);

/** `#[derive(Clone)]` of `Thir`. */
export function clone_Thir(v: Thir): Thir {
  return new Thir(
    clone_BodyTy(v.body_type),
    new Map([...v.loop_hint_attrs].map(([k, x]) => [k, x.map(clone_UnrollAttr)])),
    v.arms.map(clone_Arm),
    v.blocks.map(clone_Block),
    v.exprs.map(clone_Expr),
    v.stmts.map(clone_Stmt),
    v.params.map(clone_Param),
  );
}

// ---- Pat ----------------------------------------------------------------------------------------------------------

declare module "./thir.gen.ts" {
  interface Pat {
    simple_ident(): Symbol | undefined;
    each_binding(f: (name: Symbol, by_ref: ByRef, ty: Ty, span: Span) => void): void;
    walk(it: (pat: Pat) => boolean): void;
    walk_(it: (pat: Pat) => boolean): void;
    pat_error_reported(): Result<null, ErrorGuaranteed>;
    walk_always(it: (pat: Pat) => void): void;
  }
  interface PatRange {
    is_full_range(tcx: TyCtxt): boolean | undefined;
    contains(value: Value, tcx: TyCtxt): boolean | undefined;
    overlaps(other: PatRange, tcx: TyCtxt): boolean | undefined;
  }
}

// rustc: compiler/rustc_middle/src/thir.rs:680 simple_ident
Pat.prototype.simple_ident = function (this: Pat): Symbol | undefined {
  const kind = this.kind;
  if (kind.$ === "Binding" && kind.mode._0.$ === "No" && kind.subpattern === undefined) {
    return kind.name;
  }
  return undefined;
};

/// Call `f` on every "binding" in a pattern, e.g., on `a` in
/// `match foo() { Some(a) => (), None => () }`
// rustc: compiler/rustc_middle/src/thir.rs:691 each_binding
Pat.prototype.each_binding = function (
  this: Pat,
  f: (name: Symbol, by_ref: ByRef, ty: Ty, span: Span) => void,
): void {
  this.walk_always((p) => {
    if (p.kind.$ === "Binding") {
      const { name, mode, ty } = p.kind;
      f(name, mode._0, ty, p.span);
    }
  });
};

/// Walk the pattern in left-to-right order.
///
/// If `it(pat)` returns `false`, the children are not visited.
// rustc: compiler/rustc_middle/src/thir.rs:702 walk
Pat.prototype.walk = function (this: Pat, it: (pat: Pat) => boolean): void {
  this.walk_(it);
};

// rustc: compiler/rustc_middle/src/thir.rs:706 walk_
Pat.prototype.walk_ = function (this: Pat, it: (pat: Pat) => boolean): void {
  if (!it(this)) {
    return;
  }

  for_each_immediate_subpat(this, (p) => p.walk_(it));
};

/// Whether the pattern has a `PatKind::Error` nested within.
// rustc: compiler/rustc_middle/src/thir.rs:715 pat_error_reported
Pat.prototype.pat_error_reported = function (this: Pat): Result<null, ErrorGuaranteed> {
  let error: ErrorGuaranteed | undefined = undefined;
  this.walk((pat) => {
    if (pat.kind.$ === "Error" && error === undefined) {
      error = pat.kind._0;
    }
    return error === undefined;
  });
  const e = error as ErrorGuaranteed | undefined;
  if (e === undefined) {
    return Ok(null);
  } else {
    return Err(e);
  }
};

/// Walk the pattern in left-to-right order.
///
/// If you always want to recurse, prefer this method over `walk`.
// rustc: compiler/rustc_middle/src/thir.rs:734 walk_always
Pat.prototype.walk_always = function (this: Pat, it: (pat: Pat) => void): void {
  this.walk((p) => {
    it(p);
    return true;
  });
};

// ---- PatRange / PatRangeBoundary ----------------------------------------------------------------------------------

/** `u128::MAX` */
const U128_MAX = (1n << 128n) - 1n;
/** `std::char::MAX as u128` */
const CHAR_MAX = 0x10ffffn;

/// Whether this range covers the full extent of possible values (best-effort, we ignore floats).
// rustc: compiler/rustc_middle/src/thir.rs:907 is_full_range
PatRange.prototype.is_full_range = function (this: PatRange, tcx: TyCtxt): boolean | undefined {
  let min: bigint;
  let max: bigint;
  let size: Size;
  let bias: bigint;
  const kind = this.ty.kind();
  switch (kind.$) {
    case "Char":
      [min, max, size, bias] = [0n, CHAR_MAX, Size.from_bits(32), 0n];
      break;
    case "Int": {
      const size_ = Integer_size(Integer_from_int_ty(tcx, kind._0));
      const max_ = Size_truncate(size_, U128_MAX);
      const bias_ = 1n << BigInt(size_.bits() - 1);
      [min, max, size, bias] = [0n, max_, size_, bias_];
      break;
    }
    case "Uint": {
      const size_ = Integer_size(Integer_from_uint_ty(tcx, kind._0));
      const max_ = Size_unsigned_int_max(size_);
      [min, max, size, bias] = [0n, max_, size_, 0n];
      break;
    }
    default:
      return undefined;
  }

  // We want to compare ranges numerically, but the order of the bitwise representation of
  // signed integers does not match their numeric order. Thus, to correct the ordering, we
  // need to shift the range of signed integers to correct the comparison. This is achieved by
  // XORing with a bias (see pattern/deconstruct_pat.rs for another pertinent example of this
  // pattern).
  //
  // Also, for performance, it's important to only do the second `try_to_bits` if necessary.
  let lo_is_min: boolean;
  switch (this.lo.$) {
    case "NegInfinity":
      lo_is_min = true;
      break;
    case "Finite": {
      const lo = const_kind().ValTreeKind.to_leaf(this.lo._0.kind()).to_bits(size) ^ bias;
      lo_is_min = lo <= min;
      break;
    }
    case "PosInfinity":
      lo_is_min = false;
      break;
  }
  if (lo_is_min) {
    let hi_is_max: boolean;
    switch (this.hi.$) {
      case "NegInfinity":
        hi_is_max = false;
        break;
      case "Finite": {
        const hi = const_kind().ValTreeKind.to_leaf(this.hi._0.kind()).to_bits(size) ^ bias;
        hi_is_max = hi > max || (hi === max && this.end === "Included");
        break;
      }
      case "PosInfinity":
        hi_is_max = true;
        break;
    }
    if (hi_is_max) {
      return true;
    }
  }
  return false;
};

// rustc: compiler/rustc_middle/src/thir.rs:956 contains
PatRange.prototype.contains = function (this: PatRange, value: Value, tcx: TyCtxt): boolean | undefined {
  // debug_assert_eq!(value.ty, self.ty);
  const ty = this.ty;
  const value_: gen.PatRangeBoundary = { $: "Finite", _0: value.valtree };
  // For performance, it's important to only do the second comparison if necessary.
  const c1 = PatRangeBoundary.compare_with(this.lo, value_, ty, tcx);
  if (c1 === undefined) return undefined;
  let r1: boolean;
  switch (c1) {
    case "Less":
    case "Equal":
      r1 = true;
      break;
    case "Greater":
      r1 = false;
      break;
  }
  if (!r1) return false;
  const c2 = PatRangeBoundary.compare_with(value_, this.hi, ty, tcx);
  if (c2 === undefined) return undefined;
  switch (c2) {
    case "Less":
      return true;
    case "Equal":
      return this.end === "Included";
    case "Greater":
      return false;
  }
};

// rustc: compiler/rustc_middle/src/thir.rs:975 overlaps
PatRange.prototype.overlaps = function (this: PatRange, other: PatRange, tcx: TyCtxt): boolean | undefined {
  // debug_assert_eq!(self.ty, other.ty);
  // For performance, it's important to only do the second comparison if necessary.
  const c1 = PatRangeBoundary.compare_with(other.lo, this.hi, this.ty, tcx);
  if (c1 === undefined) return undefined;
  let r1: boolean;
  switch (c1) {
    case "Less":
      r1 = true;
      break;
    case "Equal":
      r1 = this.end === "Included";
      break;
    case "Greater":
      r1 = false;
      break;
  }
  if (!r1) return false;
  const c2 = PatRangeBoundary.compare_with(this.lo, other.hi, this.ty, tcx);
  if (c2 === undefined) return undefined;
  switch (c2) {
    case "Less":
      return true;
    case "Equal":
      return other.end === "Included";
    case "Greater":
      return false;
  }
};

// `impl<'tcx> fmt::Display for PatRange<'tcx>`
// rustc: compiler/rustc_middle/src/thir.rs:994 fmt
export function display_PatRange(self: PatRange): string {
  let out = "";
  if (self.lo.$ === "Finite") {
    const valtree = self.lo._0;
    out += valtree_().display_Value({ ty: self.ty, valtree });
  }
  if (self.hi.$ === "Finite") {
    const valtree = self.hi._0;
    out += display_RangeEnd(self.end);
    out += valtree_().display_Value({ ty: self.ty, valtree });
  } else {
    // `0..` is parsed as an inclusive range, we must display it correctly.
    out += "..";
  }
  return out;
}

/// A (possibly open) boundary of a range pattern.
/// If present, the const must be of a numeric type.
export type PatRangeBoundary = gen.PatRangeBoundary;
export const PatRangeBoundary = {
  ...gen.PatRangeBoundary,

  // rustc: compiler/rustc_middle/src/thir.rs:1023 is_finite
  is_finite(self: PatRangeBoundary): boolean {
    return self.$ === "Finite";
  },

  // rustc: compiler/rustc_middle/src/thir.rs:1027 as_finite
  as_finite(self: PatRangeBoundary): ValTree | undefined {
    switch (self.$) {
      case "Finite":
        return self._0;
      case "NegInfinity":
      case "PosInfinity":
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/thir.rs:1033 to_bits
  to_bits(self: PatRangeBoundary, ty: Ty, tcx: TyCtxt): bigint {
    switch (self.$) {
      case "Finite":
        return const_kind().ValTreeKind.to_leaf(self._0.kind()).to_bits_unchecked();
      case "NegInfinity": {
        // Unwrap is ok because the type is known to be numeric.
        const mm = ty.numeric_min_and_max_as_bits(tcx);
        if (mm === undefined) return panic("called `Option::unwrap()` on a `None` value");
        return mm[0];
      }
      case "PosInfinity": {
        // Unwrap is ok because the type is known to be numeric.
        const mm = ty.numeric_min_and_max_as_bits(tcx);
        if (mm === undefined) return panic("called `Option::unwrap()` on a `None` value");
        return mm[1];
      }
    }
  },

  // #[instrument(skip(tcx), level = "debug", ret)]
  // rustc: compiler/rustc_middle/src/thir.rs:1048 compare_with
  compare_with(self: PatRangeBoundary, other: PatRangeBoundary, ty: Ty, tcx: TyCtxt): Ordering | undefined {
    // When comparing with infinities, we must remember that `0u8..` and `0u8..=255`
    // describe the same range. These two shortcuts are ok, but for the rest we must check
    // bit values.
    if (self.$ === "PosInfinity" && other.$ === "PosInfinity") return "Equal";
    if (self.$ === "NegInfinity" && other.$ === "NegInfinity") return "Equal";

    // This code is hot when compiling matches with many ranges. So we
    // special-case extraction of evaluated scalars for speed, for types where
    // we can do scalar comparisons. E.g. `unicode-normalization` has
    // many ranges such as '\u{037A}'..='\u{037F}', and chars can be compared
    // in this way.
    const tk = ty.kind();
    if (self.$ === "Finite" && other.$ === "Finite" && (tk.$ === "Int" || tk.$ === "Uint" || tk.$ === "Char")) {
      const a = const_kind().ValTreeKind.try_to_leaf(self._0.kind());
      const b = const_kind().ValTreeKind.try_to_leaf(other._0.kind());
      if (a !== undefined && b !== undefined) {
        const sz = ty.primitive_size(tcx);
        let cmp: Ordering;
        switch (tk.$) {
          case "Uint":
          case "Char":
            cmp = cmp_bigint(a.to_uint(sz), b.to_uint(sz));
            break;
          case "Int":
            cmp = cmp_bigint(a.to_int(sz), b.to_int(sz));
            break;
        }
        return cmp;
      }
    }

    const a = PatRangeBoundary.to_bits(self, ty, tcx);
    const b = PatRangeBoundary.to_bits(other, ty, tcx);

    switch (tk.$) {
      case "Float":
        switch (tk._0) {
          case "F16":
          case "F32":
          case "F64":
          case "F128":
            // `rustc_apfloat::ieee::{Half,Single,Double,Quad}::from_bits(a).partial_cmp(&from_bits(b))`
            void [a, b];
            return unported("rustc_apfloat (vendor crate not ported): ieee float from_bits / partial_cmp");
        }
        break;
      case "Int": {
        const size = Integer_size(Integer_from_int_ty(tcx, tk._0));
        const a_ = Size_sign_extend(size, a);
        const b_ = Size_sign_extend(size, b);
        return cmp_bigint(a_, b_);
      }
      case "Uint":
      case "Char":
        return cmp_bigint(a, b);
      default:
        return bug();
    }
  },
};

/** `Ord::cmp` of two integers. */
function cmp_bigint(a: bigint, b: bigint): Ordering {
  return a < b ? "Less" : a > b ? "Greater" : "Equal";
}

// Some nodes are used a lot. Make sure they don't unintentionally get bigger.
// (`mod size_asserts`, `#[cfg(target_pointer_width = "64")]`: no TS counterpart.)

// ---- stand-ins for fns of other upstream files that are not ported yet (not markers; repoint when they land) ----

// `IntegerExt::{from_int_ty, from_uint_ty}` (ty/layout.ts) and rustc_abi's `Integer::size` / `Size::{truncate,
// unsigned_int_max, sign_extend}` are ported (lane typeck-gaps): these names forward to them (read on use: init order).
function Integer_from_int_ty(tcx: TyCtxt, ity: unknown): Integer {
  return layout_().IntegerExt.from_int_ty(tcx, ity as IntTy);
}
function Integer_from_uint_ty(tcx: TyCtxt, uty: unknown): Integer {
  return layout_().IntegerExt.from_uint_ty(tcx, uty as UintTy);
}
function Integer_size(self: Integer): Size {
  return IntegerC.size(self);
}
function Size_truncate(self: Size, value: bigint): bigint {
  return self.truncate(value);
}
function Size_unsigned_int_max(self: Size): bigint {
  return self.unsigned_int_max();
}
function Size_sign_extend(self: Size, value: bigint): bigint {
  return self.sign_extend(value);
}
function layout_(): typeof import("./ty/layout.ts") {
  return require("./ty/layout.ts") as typeof import("./ty/layout.ts");
}

/** PORT (merge-w15b): `ValTreeKind`'s leaf accessors (rustc_type_ir const_kind.rs; `ValTree` derefs to it) and
 * `Display for ty::Value` (ty/consts/valtree.rs), reached lazily (init order). */
function const_kind(): typeof import("../rustc_type_ir/const_kind.ts") {
  return require("../rustc_type_ir/const_kind.ts") as typeof import("../rustc_type_ir/const_kind.ts");
}
function valtree_(): typeof import("./ty/consts/valtree.ts") {
  return require("./ty/consts/valtree.ts") as typeof import("./ty/consts/valtree.ts");
}
