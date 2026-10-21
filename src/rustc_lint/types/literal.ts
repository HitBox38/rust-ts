// Port of compiler/rustc_lint/src/types/literal.rs: the literal checks of the late `TypeLimits` pass (types.ts).
//
// PORT (lint-late-b):
// - `u128` / `i128` values are `bigint`s; `IntTy` / `UintTy` / `FloatTy` are rustc_ast_ir's string enums.
// - `cx.typeck_results()` is `cx.typeck_results_()` (context.ts).
// - `OVERFLOWING_LITERALS` is imported from types.lints.gen.ts (not `crate::types`), so this module and types.ts do
//   not import each other.
// - `float_is_infinite` needs rustc_apfloat (`IeeeFloat::from_str`), which is not ported: it stops with `unported`.
import { Integer, type Size } from "../../rustc_abi/lib.ts";
import { FloatTy, IntTy, type IntTy as IntTyT, UintTy, type UintTy as UintTyT } from "../../rustc_ast_ir/lib.ts";
import type { IntType } from "../../rustc_attr_ir/data_structures.gen.ts";
import type { Expr, ExprField, Lit } from "../../rustc_hir/hir.ts";
import { type HirId, HirId_eq } from "../../rustc_hir_id/lib.ts";
import { IntegerExt } from "../../rustc_middle/ty/layout.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { display_Symbol, type Symbol } from "../../rustc_span/symbol.ts";
import { assert, unported } from "../../std/panic.ts";
import type { LateContext } from "../context.ts";
import {
  OnlyCastu8ToChar_diagnostic,
  type OverflowingBinHexSign,
  type OverflowingBinHexSignBitSub,
  type OverflowingBinHexSub,
  OverflowingBinHex_diagnostic,
  type OverflowingIntHelp,
  OverflowingInt_diagnostic,
  OverflowingLiteral_diagnostic,
  OverflowingUInt_diagnostic,
  RangeEndpointOutOfRange_diagnostic,
  SurrogateCharCast_diagnostic,
  TooLargeCharCast_diagnostic,
  type UseInclusiveRange,
} from "../diagnostics.gen.ts";
import { OVERFLOWING_LITERALS } from "../types.lints.gen.ts";

/** `cx.sess().source_map().span_to_snippet(span).ok()` */
function snippet(cx: LateContext, span: Span): string | undefined {
  const r = cx.sess().source_map().span_to_snippet(span);
  return r.$ === "Ok" ? r._0.toString() : undefined;
}

/// Attempts to special-case the overflowing literal lint when it occurs as a range endpoint (`expr..MAX+1`).
/// Returns `true` iff the lint was emitted.
// rustc: compiler/rustc_lint/src/types/literal.rs:25 lint_overflowing_range_endpoint
function lint_overflowing_range_endpoint(cx: LateContext, lit: Lit, lit_val: bigint, max: bigint, hir_id: HirId, lit_span: Span, ty: string): boolean {
  // Look past casts to support cases like `0..256 as u8`
  let span: Span;
  {
    const par = cx.tcx.parent_hir_node(hir_id);
    if (par.$ === "Expr" && par._0.kind.$ === "Cast") {
      const par_expr: Expr = par._0;
      [hir_id, span] = [par_expr.hir_id, par_expr.span];
    } else {
      [hir_id, span] = [hir_id, lit_span];
    }
  }

  // We only want to handle exclusive (`..`) ranges,
  // which are represented as `ExprKind::Struct`.
  const field_node = cx.tcx.parent_hir_node(hir_id);
  if (field_node.$ !== "ExprField") {
    return false;
  }
  const field: ExprField = field_node._0;
  const struct_node = cx.tcx.parent_hir_node(field.hir_id);
  if (struct_node.$ !== "Expr") {
    return false;
  }
  const struct_expr = struct_node._0;
  const range_span = struct_expr.range_span();
  if (range_span === undefined) {
    return false;
  }
  if (!(struct_expr.kind.$ === "Struct" && struct_expr.kind._1.length === 2)) {
    return false;
  }
  const [start, end] = [struct_expr.kind._1[0]!, struct_expr.kind._1[1]!];

  // We can suggest using an inclusive range
  // (`..=`) instead only if it is the `end` that is
  // overflowing and only by 1.
  if (!(HirId_eq(end.expr.hir_id, hir_id) && lit_val - 1n === max)) {
    return false;
  }

  let suffix: string;
  const n = lit.node;
  if (n.$ === "Int" && n._1.$ === "Signed") {
    suffix = IntTy.name_str(n._1._0);
  } else if (n.$ === "Int" && n._1.$ === "Unsigned") {
    suffix = UintTy.name_str(n._1._0);
  } else if (n.$ === "Int" && n._1.$ === "Unsuffixed") {
    suffix = "";
  } else {
    return bug("");
  }

  let sub_sugg: UseInclusiveRange;
  if (Span.lo(span) === Span.lo(lit_span)) {
    const start_s = snippet(cx, start.span);
    if (start_s === undefined) {
      return false;
    }
    sub_sugg = {
      $: "WithoutParen",
      sugg: Span.to(Span.shrink_to_lo(range_span), Span.shrink_to_hi(lit_span)),
      start: start_s,
      literal: lit_val - 1n,
      suffix,
    };
  } else {
    sub_sugg = {
      $: "WithParen",
      eq_sugg: Span.shrink_to_lo(span),
      lit_sugg: lit_span,
      literal: lit_val - 1n,
      suffix,
    };
  }

  cx.emit_span_lint(OVERFLOWING_LITERALS, range_span, RangeEndpointOutOfRange_diagnostic({ ty, sub: sub_sugg }));

  // We've just emitted a lint, special cased for `(...)..MAX+1` ranges,
  // return `true` so the callers don't also emit a lint
  return true;
}

const I8_MIN = -(1n << 7n);
const I16_MIN = -(1n << 15n);
const I32_MIN = -(1n << 31n);
const I64_MIN = -(1n << 63n);
const I128_MIN = -(1n << 127n);

// For `isize` & `usize`, be conservative with the warnings, so that the
// warnings are consistent between 32- and 64-bit platforms.
// rustc: compiler/rustc_lint/src/types/literal.rs:105 int_ty_range
export function int_ty_range(int_ty: IntTyT): [bigint, bigint] {
  switch (int_ty) {
    case "Isize":
      return [I64_MIN, -I64_MIN - 1n];
    case "I8":
      return [I8_MIN, -I8_MIN - 1n];
    case "I16":
      return [I16_MIN, -I16_MIN - 1n];
    case "I32":
      return [I32_MIN, -I32_MIN - 1n];
    case "I64":
      return [I64_MIN, -I64_MIN - 1n];
    case "I128":
      return [I128_MIN, -I128_MIN - 1n];
  }
}

// rustc: compiler/rustc_lint/src/types/literal.rs:116 uint_ty_range
export function uint_ty_range(uint_ty: UintTyT): [bigint, bigint] {
  let max: bigint;
  switch (uint_ty) {
    case "Usize":
      max = (1n << 64n) - 1n;
      break;
    case "U8":
      max = (1n << 8n) - 1n;
      break;
    case "U16":
      max = (1n << 16n) - 1n;
      break;
    case "U32":
      max = (1n << 32n) - 1n;
      break;
    case "U64":
      max = (1n << 64n) - 1n;
      break;
    case "U128":
      max = (1n << 128n) - 1n;
      break;
  }
  return [0n, max];
}

// rustc: compiler/rustc_lint/src/types/literal.rs:128 get_bin_hex_repr
function get_bin_hex_repr(cx: LateContext, lit: Lit): string | undefined {
  const src = snippet(cx, lit.span);
  if (src === undefined) return undefined;
  const chars = [...src];
  const firstch = chars[0];
  if (firstch === undefined) return undefined;

  if (firstch === "0") {
    const c1 = chars[1];
    if (c1 === "x" || c1 === "b") {
      return src;
    } else {
      return undefined;
    }
  }

  return undefined;
}

/** `repr_str.chars().position(|c| c == 'i' || c == 'u')` */
function suffix_pos(repr_str: string): number | undefined {
  const chars = [...repr_str];
  const pos = chars.findIndex((c) => c === "i" || c === "u");
  return pos === -1 ? undefined : pos;
}

// rustc: compiler/rustc_lint/src/types/literal.rs:142 report_bin_hex_error
function report_bin_hex_error(cx: LateContext, hir_id: HirId, span: Span, ty: IntType, size: Size, repr_str: string, val: bigint, negative: boolean): void {
  let t: string;
  let actually: string;
  if (ty.$ === "SignedInt") {
    const actually_v = negative ? -size.sign_extend(val) : size.sign_extend(val);
    [t, actually] = [IntTy.name_str(ty._0), actually_v.toString()];
  } else {
    const actually_v = size.truncate(val);
    [t, actually] = [UintTy.name_str(ty._0), actually_v.toString()];
  }
  let sign: OverflowingBinHexSign;
  if (negative) {
    sign = {
      $: "Negative",
      lit: repr_str,
      dec: val,
      actually,
      ty: t,
    };
  } else {
    sign = {
      $: "Positive",
      lit: repr_str,
      dec: val,
      actually,
      ty: t,
    };
  }
  const suggestion = get_type_suggestion(cx.typeck_results_().node_type(hir_id), val, negative);
  let sub: OverflowingBinHexSub | undefined;
  if (suggestion !== undefined) {
    const suggestion_ty = suggestion;
    const pos = suffix_pos(repr_str);
    if (pos !== undefined) {
      const sans_suffix = [...repr_str].slice(0, pos).join("");
      sub = { $: "Suggestion", span, suggestion_ty, sans_suffix };
    } else {
      sub = { $: "Help", suggestion_ty };
    }
  }
  const sign_bit_sub = ((): OverflowingBinHexSignBitSub | undefined => {
    if (negative) return undefined;
    const k = cx.typeck_results_().node_type(hir_id).kind();
    if (k.$ !== "Int") {
      return undefined;
    }
    const int_ty = k._0;

    const bit_width = IntTy.bit_width(int_ty);
    if (bit_width === undefined) {
      return undefined; // isize case
    }

    // Skip if sign bit is not set
    if ((val & (1n << BigInt(bit_width - 1))) === 0n) {
      return undefined;
    }

    let lit_no_suffix: string;
    const pos = suffix_pos(repr_str);
    if (pos !== undefined) {
      lit_no_suffix = [...repr_str].slice(0, pos).join("");
    } else {
      lit_no_suffix = repr_str;
    }

    const uint_ty = Integer.fit_unsigned(val);
    // `cast_signed` only supports equal-width integer casts.
    if (Integer.size(uint_ty).raw === size.raw) {
      return {
        $: "CastSigned",
        span,
        lit_no_suffix,
        negative_val: actually,
        uint_ty: Integer.uint_ty_str(uint_ty),
        int_ty: IntTy.name_str(int_ty),
      };
    } else {
      return {
        $: "AsCast",
        span,
        lit_no_suffix,
        negative_val: actually,
        uint_ty: Integer.uint_ty_str(uint_ty),
        int_ty: IntTy.name_str(int_ty),
      };
    }
  })();

  cx.emit_span_lint(OVERFLOWING_LITERALS, span, OverflowingBinHex_diagnostic({ ty: t, sign, sub, sign_bit_sub }));
}

// Find the "next" fitting integer and return a suggestion string
//
// No suggestion is offered for `{i,u}size`. Otherwise, we try to suggest an equal-sized type.
// rustc: compiler/rustc_lint/src/types/literal.rs:241 get_type_suggestion
function get_type_suggestion(t: Ty, val: bigint, negative: boolean): string | undefined {
  const k = t.kind();
  if ((k.$ === "Uint" && k._0 === "Usize") || (k.$ === "Int" && k._0 === "Isize")) {
    return undefined;
  } else if (k.$ === "Uint") {
    return Integer.uint_ty_str(Integer.fit_unsigned(val));
  } else if (k.$ === "Int") {
    const lit = literal_to_i128(val, negative);
    const signed = lit !== undefined ? Integer.fit_signed(lit) : undefined;
    if (negative) {
      return signed !== undefined ? Integer.int_ty_str(signed) : undefined;
    } else {
      const unsigned = Integer.fit_unsigned(val);
      if (signed !== undefined) {
        if (Integer.size(unsigned).raw < Integer.size(signed).raw) {
          return Integer.uint_ty_str(unsigned);
        } else {
          return Integer.int_ty_str(signed);
        }
      } else {
        return Integer.uint_ty_str(unsigned);
      }
    }
  } else {
    return undefined;
  }
}

const I128_MAX = (1n << 127n) - 1n;

// rustc: compiler/rustc_lint/src/types/literal.rs:266 literal_to_i128
function literal_to_i128(val: bigint, negative: boolean): bigint | undefined {
  if (negative) {
    // `val.wrapping_neg() as i128`
    return val <= I128_MAX + 1n ? BigInt.asIntN(128, BigInt.asUintN(128, -val)) : undefined;
  } else {
    // `val.try_into().ok()`
    return val <= I128_MAX ? val : undefined;
  }
}

// rustc: compiler/rustc_lint/src/types/literal.rs:274 lint_int_literal
function lint_int_literal(cx: LateContext, hir_id: HirId, span: Span, lit: Lit, t: IntTyT, v: bigint, surrounding_negation: Span | undefined): void {
  const int_type = IntTy.normalize(t, cx.sess().target.pointer_width);
  const [min, max_i] = int_ty_range(int_type);
  const max = max_i;
  const negative = surrounding_negation !== undefined;

  // Detect literal value out of range [min, max] inclusive
  // avoiding use of -min to prevent overflow/panic
  if ((negative && v > max + 1n) || (!negative && v > max)) {
    const repr_str = get_bin_hex_repr(cx, lit);
    if (repr_str !== undefined) {
      report_bin_hex_error(cx, hir_id, span, { $: "SignedInt", _0: t }, Integer.size(IntegerExt.from_int_ty(cx, t)), repr_str, v, negative);
      return;
    }

    if (lint_overflowing_range_endpoint(cx, lit, v, max, hir_id, span, IntTy.name_str(t))) {
      // The overflowing literal lint was emitted by `lint_overflowing_range_endpoint`.
      return;
    }

    span = surrounding_negation ?? span;
    const lit_s = snippet(cx, span) ?? (negative ? `-${v}` : v.toString());
    const suggestion_ty = get_type_suggestion(cx.typeck_results_().node_type(hir_id), v, negative);
    const help: OverflowingIntHelp | undefined = suggestion_ty !== undefined ? { suggestion_ty } : undefined;

    cx.emit_span_lint(OVERFLOWING_LITERALS, span, OverflowingInt_diagnostic({ ty: IntTy.name_str(t), lit: lit_s, min, max, help }));
  }
}

// rustc: compiler/rustc_lint/src/types/literal.rs:327 lint_uint_literal
function lint_uint_literal(cx: LateContext, hir_id: HirId, span: Span, lit: Lit, t: UintTyT): void {
  const uint_type = UintTy.normalize(t, cx.sess().target.pointer_width);
  const [min, max] = uint_ty_range(uint_type);
  let lit_val: bigint;
  const n = lit.node;
  if (n.$ === "Byte") {
    // _v is u8, within range by definition
    return;
  } else if (n.$ === "Int") {
    lit_val = n._0;
  } else {
    return bug("");
  }

  if (lit_val < min || lit_val > max) {
    const par = cx.tcx.parent_hir_node(hir_id);
    if (par.$ === "Expr") {
      const par_e = par._0;
      if (par_e.kind.$ === "Cast") {
        if (cx.typeck_results_().expr_ty(par_e).kind().$ === "Char") {
          if (lit_val > 0x10ffffn) {
            cx.emit_span_lint(OVERFLOWING_LITERALS, par_e.span, TooLargeCharCast_diagnostic({ literal: lit_val }));
          } else if (lit_val >= 0xd800n && lit_val <= 0xdfffn) {
            cx.emit_span_lint(OVERFLOWING_LITERALS, par_e.span, SurrogateCharCast_diagnostic({ literal: lit_val }));
          } else {
            cx.emit_span_lint(OVERFLOWING_LITERALS, par_e.span, OnlyCastu8ToChar_diagnostic({ span: par_e.span, literal: lit_val }));
          }
          return;
        }
      }
    }
    if (lint_overflowing_range_endpoint(cx, lit, lit_val, max, hir_id, span, UintTy.name_str(t))) {
      // The overflowing literal lint was emitted by `lint_overflowing_range_endpoint`.
      return;
    }
    const repr_str = get_bin_hex_repr(cx, lit);
    if (repr_str !== undefined) {
      report_bin_hex_error(cx, hir_id, span, { $: "UnsignedInt", _0: t }, Integer.size(IntegerExt.from_uint_ty(cx, t)), repr_str, lit_val, false);
      return;
    }
    cx.emit_span_lint(
      OVERFLOWING_LITERALS,
      span,
      OverflowingUInt_diagnostic({
        ty: UintTy.name_str(t),
        lit: snippet(cx, lit.span) ?? lit_val.toString(),
        min,
        max,
      }),
    );
  }
}

/// `None` if `v` does not parse as the float type, otherwise indicates whether a literal rounds
/// to infinity.
// PORT: `S: Semantics` is the `FloatTy` the caller picked (`HalfS` / `SingleS` / `DoubleS` / `QuadS`).
// rustc: compiler/rustc_lint/src/types/literal.rs:409 float_is_infinite
function float_is_infinite(_s: FloatTy, _v: Symbol): boolean | undefined {
  // `let x: IeeeFloat<S> = v.as_str().parse().ok()?; Some(x.is_infinite())`
  return unported("rustc_apfloat::ieee::IeeeFloat::from_str (rustc_apfloat is not ported)");
}

// rustc: compiler/rustc_lint/src/types/literal.rs:414 lint_literal
export function lint_literal(cx: LateContext, hir_id: HirId, span: Span, lit: Lit, surrounding_negation: Span | undefined): void {
  const k = cx.typeck_results_().node_type(hir_id).kind();
  if (k.$ === "Int") {
    const t = k._0;
    const n = lit.node;
    if (n.$ === "Int" && (n._1.$ === "Signed" || n._1.$ === "Unsuffixed")) {
      lint_int_literal(cx, hir_id, span, lit, t, n._0, surrounding_negation);
    } else {
      bug("");
    }
  } else if (k.$ === "Uint") {
    const t = k._0;
    assert(surrounding_negation === undefined, "assertion failed: surrounding_negation.is_none()");
    lint_uint_literal(cx, hir_id, span, lit, t);
  } else if (k.$ === "Float") {
    const t = k._0;
    const n = lit.node;
    if (n.$ !== "Float") {
      bug("");
    }
    const v = n._0;

    let is_infinite: boolean | undefined;
    switch (t) {
      case "F16":
        is_infinite = float_is_infinite("F16", v);
        break;
      case "F32":
        is_infinite = float_is_infinite("F32", v);
        break;
      case "F64":
        is_infinite = float_is_infinite("F64", v);
        break;
      case "F128":
        is_infinite = float_is_infinite("F128", v);
        break;
    }

    if (is_infinite === true) {
      cx.emit_span_lint(
        OVERFLOWING_LITERALS,
        span,
        OverflowingLiteral_diagnostic({
          ty: FloatTy.name_str(t),
          lit: snippet(cx, lit.span) ?? display_Symbol(v),
        }),
      );
    }
  }
}
