// Port of compiler/rustc_lint/src/transmute.rs. The lint statics and the `impl_lint_pass!` expansion are generated
// (transmute.lints.gen.ts).
// PORT: `cx.typeck_results()` is `cx.typeck_results_()`, and `LateContext::qpath_res` / `typing_env` return `unknown`
// until context.rs's `LateContext` is ported: their results are cast here.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import { Mutability } from "../rustc_ast_ir/lib.ts";
import { Diag, type DiagCtxtHandle, DiagDecorator, type Diagnostic, type Level } from "../rustc_errors/lib.ts";
import type { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import type { LateContext } from "./context.ts";
import { IntegerToPtrTransmutes_diagnostic, type IntegerToPtrTransmutesSuggestion } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import {
  CheckTransmutes_impl_lint_pass,
  INTEGER_TO_PTR_TRANSMUTES,
  PTR_TO_INTEGER_TRANSMUTE_IN_CONSTS,
  UNNECESSARY_TRANSMUTES,
} from "./transmute.lints.gen.ts";
import { std_or_core } from "./utils.ts";

export * from "./transmute.lints.gen.ts";

// pub(crate) struct CheckTransmutes;
export class CheckTransmutes implements LintPass, LateLintPass {
  name(): string {
    return CheckTransmutes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return CheckTransmutes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return CheckTransmutes_impl_lint_pass.lint_vec();
  }

  // impl<'tcx> LateLintPass<'tcx> for CheckTransmutes
  // rustc: compiler/rustc_lint/src/transmute.rs:115 check_expr
  check_expr(cx: LateContext, expr: hir.Expr): void {
    if (!(expr.kind.$ === "Call" && expr.kind._1.length === 1)) {
      return;
    }
    const callee = expr.kind._0;
    const arg = expr.kind._1[0]!;
    if (callee.kind.$ !== "Path") {
      return;
    }
    const qpath = callee.kind._0;
    const res = cx.qpath_res(qpath, callee.hir_id) as Res;
    if (!(res.$ === "Def" && res._0.$ === "Fn")) {
      return;
    }
    const def_id = res._1;
    if (!cx.tcx.is_intrinsic(def_id, sym.transmute)) {
      return;
    }
    const body_owner_def_id = cx.tcx.hir_enclosing_body_owner(expr.hir_id);
    const const_context = cx.tcx.hir_body_const_context(body_owner_def_id);
    const args = (cx.typeck_results_() as TypeckResults).node_args(callee.hir_id);

    const src = args.type_at(0);
    const dst = args.type_at(1);

    check_ptr_transmute_in_const(cx, expr, body_owner_def_id, const_context, src, dst);
    check_unnecessary_transmute(cx, expr, callee, arg, const_context, src, dst);
    check_int_to_ptr_transmute(cx, expr, arg, src, dst);
  }
}

/// Check for transmutes from integer to pointers (*const/*mut and &/&mut).
///
/// Using the resulting pointers would be undefined behavior.
// rustc: compiler/rustc_lint/src/transmute.rs:144 check_int_to_ptr_transmute
function check_int_to_ptr_transmute(cx: LateContext, expr: hir.Expr, arg: hir.Expr, src: Ty, dst: Ty): void {
  const sk = src.kind();
  if (!(sk.$ === "Uint" || sk.$ === "Int")) {
    return;
  }
  const dk = dst.kind();
  let inner_ty: Ty;
  let mutbl: Mutability;
  if (dk.$ === "Ref") {
    [inner_ty, mutbl] = [dk._1, dk._2];
  } else if (dk.$ === "RawPtr") {
    [inner_ty, mutbl] = [dk._0, dk._1];
  } else {
    return;
  }
  // bail-out if the argument is literal 0 as we have other lints for those cases
  if (arg.kind.$ === "Lit" && arg.kind._0.node.$ === "Int" && arg.kind._0.node._0 === 0n) {
    return;
  }
  // bail-out if the inner type is a ZST
  const layout_inner_ty_r = cx.tcx.layout_of((cx.typing_env() as TypingEnv).as_query_input(inner_ty));
  if (layout_inner_ty_r.$ !== "Ok") {
    return;
  }
  const layout_inner_ty = layout_inner_ty_r._0;
  if (layout_inner_ty.is_1zst()) {
    return;
  }

  const suffix = Mutability.is_mut(mutbl) ? "_mut" : "";
  const krate = std_or_core(cx);
  let suggestion: IntegerToPtrTransmutesSuggestion | undefined;
  if (krate !== undefined && layout_inner_ty.is_sized() && dst.is_ref()) {
    suggestion = {
      $: "ToRef",
      krate,
      dst: inner_ty,
      suffix,
      ref_mutbl: Mutability.prefix_str(mutbl),
      start_call: Span.until(Span.shrink_to_lo(expr.span), arg.span),
    };
  } else if (krate !== undefined && layout_inner_ty.is_sized()) {
    suggestion = {
      $: "ToPtr",
      krate,
      dst: inner_ty,
      suffix,
      start_call: Span.until(Span.shrink_to_lo(expr.span), arg.span),
    };
  } else {
    suggestion = undefined;
  }
  cx.tcx.emit_node_span_lint(
    INTEGER_TO_PTR_TRANSMUTES,
    expr.hir_id,
    expr.span,
    IntegerToPtrTransmutes_diagnostic({
      without_prov: krate === undefined ? undefined : { krate },
      suggestion,
    }),
  );
}

/// Check for transmutes that exhibit undefined behavior.
/// For example, transmuting pointers to integers in a const context.
///
/// Why do we consider const functions and associated constants only?
///
/// Generally, undefined behavior in const items are handled by the evaluator.
/// But, const functions and associated constants are evaluated only when referenced.
/// This can result in undefined behavior in a library going unnoticed until
/// the function or constant is actually used.
///
/// Therefore, we only consider const functions and associated constants here and leave
/// other const items to be handled by the evaluator.
// rustc: compiler/rustc_lint/src/transmute.rs:213 check_ptr_transmute_in_const
function check_ptr_transmute_in_const(
  cx: LateContext,
  expr: hir.Expr,
  body_owner_def_id: LocalDefId,
  const_context: hir.ConstContext | undefined,
  src: Ty,
  dst: Ty,
): void {
  if (const_context?.$ === "ConstFn" || cx.tcx.def_kind(body_owner_def_id).$ === "AssocConst") {
    if (src.is_raw_ptr() && dst.is_integral()) {
      cx.tcx.emit_node_span_lint(
        PTR_TO_INTEGER_TRANSMUTE_IN_CONSTS,
        expr.hir_id,
        expr.span,
        UndefinedTransmuteLint_diagnostic({}),
      );
    }
  }
}

/// Check for transmutes that overlap with stdlib methods.
/// For example, transmuting `[u8; 4]` to `u32`.
///
/// We chose not to lint u8 -> bool transmutes, see #140431.
// rustc: compiler/rustc_lint/src/transmute.rs:239 check_unnecessary_transmute
function check_unnecessary_transmute(
  cx: LateContext,
  expr: hir.Expr,
  callee: hir.Expr,
  arg: hir.Expr,
  const_context: hir.ConstContext | undefined,
  src: Ty,
  dst: Ty,
): void {
  const callee_span = Span.find_ancestor_inside(callee.span, expr.span) ?? callee.span;
  const s = src.kind();
  const d = dst.kind();
  const is_u8 = (t: Ty): boolean => {
    const k = t.kind();
    return k.$ === "Uint" && k._0 === "U8";
  };
  let sugg: [Span, string][] | undefined;
  let help: string | undefined;
  // dont check the length; transmute does that for us.
  // [u8; _] => primitive
  if (s.$ === "Array" && (d.$ === "Uint" || d.$ === "Float" || d.$ === "Int") && is_u8(s._0)) {
    [sugg, help] = [
      [[callee_span, `${display_Ty(dst)}::from_ne_bytes`]],
      "there's also `from_le_bytes` and `from_be_bytes` if you expect a particular byte order",
    ];
  }
  // primitive => [u8; _]
  else if ((s.$ === "Uint" || s.$ === "Float" || s.$ === "Int") && d.$ === "Array" && is_u8(d._0)) {
    [sugg, help] = [
      [[callee_span, `${display_Ty(src)}::to_ne_bytes`]],
      "there's also `to_le_bytes` and `to_be_bytes` if you expect a particular byte order",
    ];
  }
  // char → u32
  else if (s.$ === "Char" && d.$ === "Uint" && d._0 === "U32") {
    [sugg, help] = [[[callee_span, "u32::from"]], undefined];
  }
  // char (→ u32) → i32
  else if (s.$ === "Char" && d.$ === "Int" && d._0 === "I32") {
    [sugg, help] = [
      [
        [callee_span, "u32::from"],
        [Span.shrink_to_hi(expr.span), ".cast_signed()"],
      ],
      undefined,
    ];
  }
  // u32 → char
  else if (s.$ === "Uint" && s._0 === "U32" && d.$ === "Char") {
    [sugg, help] = [[[callee_span, "char::from_u32_unchecked"]], "consider using `char::from_u32(…).unwrap()`"];
  }
  // i32 → char
  else if (s.$ === "Int" && s._0 === "I32" && d.$ === "Char") {
    [sugg, help] = [
      [
        [callee_span, "char::from_u32_unchecked(i32::cast_unsigned"],
        [Span.shrink_to_hi(expr.span), ")"],
      ],
      "consider using `char::from_u32(i32::cast_unsigned(…)).unwrap()`",
    ];
  }
  // uNN → iNN
  else if (s.$ === "Uint" && d.$ === "Int") {
    [sugg, help] = [[[callee_span, `${display_Ty(src)}::cast_signed`]], undefined];
  }
  // iNN → uNN
  else if (s.$ === "Int" && d.$ === "Uint") {
    [sugg, help] = [[[callee_span, `${display_Ty(src)}::cast_unsigned`]], undefined];
  }
  // fNN → usize, isize
  else if (s.$ === "Float" && ((d.$ === "Uint" && d._0 === "Usize") || (d.$ === "Int" && d._0 === "Isize"))) {
    [sugg, help] = [
      [
        [callee_span, `${display_Ty(src)}::to_bits`],
        [Span.shrink_to_hi(expr.span), ` as ${display_Ty(dst)}`],
      ],
      undefined,
    ];
  }
  // fNN (→ uNN) → iNN
  else if (s.$ === "Float" && d.$ === "Int") {
    [sugg, help] = [
      [
        [callee_span, `${display_Ty(src)}::to_bits`],
        [Span.shrink_to_hi(expr.span), ".cast_signed()"],
      ],
      undefined,
    ];
  }
  // fNN → uNN
  else if (s.$ === "Float" && d.$ === "Uint") {
    [sugg, help] = [[[callee_span, `${display_Ty(src)}::to_bits`]], undefined];
  }
  // xsize → fNN
  else if (((s.$ === "Uint" && s._0 === "Usize") || (s.$ === "Int" && s._0 === "Isize")) && d.$ === "Float") {
    [sugg, help] = [
      [
        [callee_span, `${display_Ty(dst)}::from_bits`],
        [Span.shrink_to_hi(arg.span), " as _"],
      ],
      undefined,
    ];
  }
  // iNN (→ uNN) → fNN
  else if (s.$ === "Int" && d.$ === "Float") {
    [sugg, help] = [
      [
        [callee_span, `${display_Ty(dst)}::from_bits(${display_Ty(src)}::cast_unsigned`],
        [Span.shrink_to_hi(expr.span), ")"],
      ],
      undefined,
    ];
  }
  // uNN → fNN
  else if (s.$ === "Uint" && d.$ === "Float") {
    [sugg, help] = [[[callee_span, `${display_Ty(dst)}::from_bits`]], undefined];
  }
  // bool → x8 in const context since `From::from` is not const yet
  // FIXME: Consider arg expr's precedence to avoid parentheses.
  // FIXME(const_traits): Remove this when `From::from` is constified.
  else if (s.$ === "Bool" && (d.$ === "Int" || d.$ === "Uint") && const_context !== undefined) {
    [sugg, help] = [
      [
        [callee_span, ""],
        [Span.shrink_to_hi(expr.span), ` as ${display_Ty(dst)}`],
      ],
      undefined,
    ];
  }
  // bool → x8 using `x8::from`
  else if (s.$ === "Bool" && (d.$ === "Int" || d.$ === "Uint")) {
    [sugg, help] = [[[callee_span, `${display_Ty(dst)}::from`]], undefined];
  } else {
    return;
  }

  cx.tcx.emit_node_span_lint(
    UNNECESSARY_TRANSMUTES,
    expr.hir_id,
    expr.span,
    DiagDecorator((diag) => {
      diag.primary_message("unnecessary transmute");
      if (sugg !== undefined) {
        diag.multipart_suggestion("replace this with", sugg, "MachineApplicable");
      }
      if (help !== undefined) {
        diag.help(help);
      }
    }),
  );
}

// #[derive(Diagnostic)]
// #[diag("pointers cannot be transmuted to integers during const eval")]
// #[note("at compile-time, pointers do not have an integer value")]
// #[note(
//     "avoiding this restriction via `union` or raw pointers leads to compile-time undefined behavior"
// )]
// #[help("for more information, see https://doc.rust-lang.org/std/mem/fn.transmute.html")]
// pub(crate) struct UndefinedTransmuteLint;
// PORT: the only `#[derive(Diagnostic)]` outside diagnostics.rs in this lane's files; tools/codegen generates
// rustc_lint's derives from diagnostics.rs only, so this one is written by hand in the generator's shape
// (diagnostics.gen.ts `TykindDiag`).
// rustc-type: compiler/rustc_lint/src/transmute.rs:390 UndefinedTransmuteLint
interface UndefinedTransmuteLint {}
/** `#[derive(Diagnostic)]`: `impl<'_sess> Diagnostic<'_sess> for UndefinedTransmuteLint` */
// rustc-derive: compiler/rustc_lint/src/transmute.rs:383 Diagnostic UndefinedTransmuteLint
function UndefinedTransmuteLint_into_diag(_self: UndefinedTransmuteLint, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, { $: "Inline", _0: "pointers cannot be transmuted to integers during const eval" });
  diag.note({ $: "Inline", _0: "at compile-time, pointers do not have an integer value" });
  diag.note({ $: "Inline", _0: "avoiding this restriction via `union` or raw pointers leads to compile-time undefined behavior" });
  diag.help({ $: "Inline", _0: "for more information, see https://doc.rust-lang.org/std/mem/fn.transmute.html" });
  return diag;
}
/** `UndefinedTransmuteLint` as a `Diagnostic` trait object. */
function UndefinedTransmuteLint_diagnostic(self: UndefinedTransmuteLint): Diagnostic {
  return { into_diag: (dcx, level) => UndefinedTransmuteLint_into_diag(self, dcx, level) };
}
