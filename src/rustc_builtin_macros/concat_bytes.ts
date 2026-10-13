// Port of compiler/rustc_builtin_macros/src/concat_bytes.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast, type token } from "../rustc_ast/lib.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import { report_lit_error } from "../rustc_session/diagnostics.ts";
import type { Span } from "../rustc_span/lib.ts";
import { ByteSymbol } from "../rustc_span/symbol.ts";
import { assert, unreachable } from "../std/panic.ts";
import type { MutRef } from "../std/mut_ref.ts";
import * as diagnostics from "./diagnostics.ts";
import { get_exprs_from_tts } from "./util.ts";

/// Emits errors for literal expressions that are invalid inside and outside of an array.
// rustc: compiler/rustc_builtin_macros/src/concat_bytes.rs:11 invalid_type_err
function invalid_type_err(cx: ExtCtxt, token_lit: token.Lit, span: Span, is_nested: boolean): ErrorGuaranteed {
  // `use diagnostics::{ConcatBytesInvalid, ConcatBytesInvalidSuggestion, ConcatBytesNonU8, ConcatBytesOob};`
  const sr = cx.sess.source_map().span_to_snippet(span);
  const snippet = sr.$ === "Ok" ? sr._0.toString() : undefined;
  const dcx = cx.dcx();
  const lk = ast.LitKind.from_token_lit(token_lit);
  if (lk.$ === "Err") {
    return report_lit_error(cx.sess.psess, lk._0, token_lit, span);
  }
  const l = lk._0;
  switch (l.$) {
    case "CStr": {
      const style = l._1;
      // Avoid ambiguity in handling of terminal `NUL` by refusing to
      // concatenate C string literals as bytes.
      let sugg: diagnostics.ConcatBytesInvalidSuggestion | undefined;
      if (snippet !== undefined && style === ast.StrStyle.Cooked && snippet.startsWith("c") && snippet.endsWith('"')) {
        let as_bstr = snippet;
        // Suggest`c"foo"` -> `b"foo\0"` if we can
        as_bstr = "b" + as_bstr.slice(1);
        as_bstr = as_bstr.slice(0, -1); // `pop()`: the last char is the ASCII `"`
        as_bstr += String.raw`\0"`;
        sugg = { $: "CStrLit", span, as_bstr };
      } else {
        // No suggestion for a missing snippet, raw strings, or if for some reason we have
        // a span that doesn't match `c"foo"` (possible if a proc macro assigns a span
        // that doesn't actually point to a C string).
        sugg = undefined;
      }
      // We can only provide a suggestion if we have a snip and it is not a raw string
      return dcx.emit_err(diagnostics.ConcatBytesInvalid_diagnostic({ span, lit_kind: "C string", sugg, cs_note: null }));
    }
    case "Char": {
      const sugg: diagnostics.ConcatBytesInvalidSuggestion | undefined =
        snippet === undefined ? undefined : { $: "CharLit", span, snippet };
      return dcx.emit_err(diagnostics.ConcatBytesInvalid_diagnostic({ span, lit_kind: "character", sugg, cs_note: undefined }));
    }
    case "Str": {
      // suggestion would be invalid if we are nested
      let sugg: diagnostics.ConcatBytesInvalidSuggestion | undefined;
      if (!is_nested) {
        sugg = snippet === undefined ? undefined : { $: "StrLit", span, snippet };
      } else {
        sugg = undefined;
      }
      return dcx.emit_err(diagnostics.ConcatBytesInvalid_diagnostic({ span, lit_kind: "string", sugg, cs_note: undefined }));
    }
    case "Float":
      return dcx.emit_err(diagnostics.ConcatBytesInvalid_diagnostic({ span, lit_kind: "float", sugg: undefined, cs_note: undefined }));
    case "Bool":
      return dcx.emit_err(
        diagnostics.ConcatBytesInvalid_diagnostic({ span, lit_kind: "boolean", sugg: undefined, cs_note: undefined }),
      );
    case "Int": {
      if (!is_nested) {
        const sugg: diagnostics.ConcatBytesInvalidSuggestion | undefined =
          snippet === undefined ? undefined : { $: "IntLit", span, snippet };
        return dcx.emit_err(diagnostics.ConcatBytesInvalid_diagnostic({ span, lit_kind: "numeric", sugg, cs_note: undefined }));
      }
      const [val, ty] = [l._0, l._1];
      if (ty.$ === "Unsuffixed" || (ty.$ === "Unsigned" && ty._0 === ast.UintTy.U8)) {
        assert(val > 255n, "assertion failed: val.get() > u8::MAX.into()"); // must be an error
        return dcx.emit_err(diagnostics.ConcatBytesOob_diagnostic({ span }));
      }
      return dcx.emit_err(diagnostics.ConcatBytesNonU8_diagnostic({ span }));
    }
    case "ByteStr":
    case "Byte":
      return unreachable();
    case "Err":
      return l._0;
  }
}

/// Returns `expr` as a *single* byte literal if applicable.
///
/// Otherwise, returns `None`, and either pushes the `expr`'s span to `missing_literals` or
/// updates `guar` accordingly.
// rustc: compiler/rustc_builtin_macros/src/concat_bytes.rs:88 handle_array_element
function handle_array_element(
  cx: ExtCtxt,
  guar: MutRef<ErrorGuaranteed | undefined>,
  missing_literals: Span[],
  expr: ast.Expr,
): number | undefined {
  const dcx = cx.dcx();

  const kind = expr.kind;
  switch (kind.$) {
    case "Lit": {
      const token_lit = kind._0;
      const lk = ast.LitKind.from_token_lit(token_lit);
      if (
        lk.$ === "Ok" &&
        lk._0.$ === "Int" &&
        (lk._0._1.$ === "Unsuffixed" || (lk._0._1.$ === "Unsigned" && lk._0._1._0 === ast.UintTy.U8)) &&
        lk._0._0 <= 255n
      ) {
        // `if let Ok(val) = u8::try_from(val.get())`
        return Number(lk._0._0);
      } else if (lk.$ === "Ok" && lk._0.$ === "Byte") {
        return lk._0._0;
      } else if (lk.$ === "Ok" && lk._0.$ === "ByteStr") {
        guar.value ??= dcx.emit_err(diagnostics.ConcatBytesArray_diagnostic({ span: expr.span, bytestr: true }));
      } else {
        guar.value ??= invalid_type_err(cx, token_lit, expr.span, true);
      }
      break;
    }
    case "Array":
    case "Repeat":
      guar.value ??= dcx.emit_err(diagnostics.ConcatBytesArray_diagnostic({ span: expr.span, bytestr: false }));
      break;
    case "IncludedBytes":
      guar.value ??= dcx.emit_err(diagnostics.ConcatBytesArray_diagnostic({ span: expr.span, bytestr: false }));
      break;
    default:
      missing_literals.push(expr.span);
  }

  return undefined;
}

// rustc: compiler/rustc_builtin_macros/src/concat_bytes.rs:135 expand_concat_bytes
export function expand_concat_bytes(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = get_exprs_from_tts(cx, tts);
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac = r._0;
  if (mac.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp, mac._0) };
  const es = mac._0;
  const accumulator: number[] = [];
  const missing_literals: Span[] = [];
  const guar: MutRef<ErrorGuaranteed | undefined> = { value: undefined };
  for (const e of es) {
    const kind = e.kind;
    switch (kind.$) {
      case "Array": {
        const exprs = kind._0;
        for (const expr of exprs) {
          const elem = handle_array_element(cx, guar, missing_literals, expr);
          if (elem !== undefined) {
            accumulator.push(elem);
          }
        }
        break;
      }
      case "Repeat": {
        const [expr, count] = [kind._0, kind._1];
        const ck = count.value.kind;
        const lk = ck.$ === "Lit" ? ast.LitKind.from_token_lit(ck._0) : undefined;
        if (lk !== undefined && lk.$ === "Ok" && lk._0.$ === "Int") {
          const count_val = lk._0._0;
          const elem = handle_array_element(cx, guar, missing_literals, expr);
          if (elem !== undefined) {
            for (let i = 0n; i < count_val; i++) {
              accumulator.push(elem);
            }
          }
        } else {
          guar.value = cx.dcx().emit_err(diagnostics.ConcatBytesBadRepeat_diagnostic({ span: count.value.span }));
        }
        break;
      }
      case "Lit": {
        const token_lit = kind._0;
        const lk = ast.LitKind.from_token_lit(token_lit);
        if (lk.$ === "Ok" && lk._0.$ === "Byte") {
          accumulator.push(lk._0._0);
        } else if (lk.$ === "Ok" && lk._0.$ === "ByteStr") {
          accumulator.push(...ByteSymbol.as_byte_str(lk._0._0));
        } else {
          guar.value ??= invalid_type_err(cx, token_lit, e.span, false);
        }
        break;
      }
      case "IncludedBytes":
        accumulator.push(...ByteSymbol.as_byte_str(kind._0));
        break;
      case "Err":
        guar.value = kind._0;
        break;
      case "Dummy":
        cx.dcx().span_bug(e.span, "concatenating `ExprKind::Dummy`");
        break;
      default:
        missing_literals.push(e.span);
    }
  }
  let res;
  if (missing_literals.length !== 0) {
    const guar_ = cx.dcx().emit_err(diagnostics.ConcatBytesMissingLiteral_diagnostic({ spans: missing_literals }));
    res = MacEager.expr(DummyResult.raw_expr(sp, guar_));
  } else if (guar.value !== undefined) {
    res = MacEager.expr(DummyResult.raw_expr(sp, guar.value));
  } else {
    const sp_ = cx.with_def_site_ctxt(sp);
    res = MacEager.expr(cx.expr_byte_str(sp_, accumulator));
  }
  return { $: "Ready", _0: res };
}
