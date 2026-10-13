// Port of compiler/rustc_builtin_macros/src/concat.rs
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast } from "../rustc_ast/lib.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import { report_lit_error } from "../rustc_session/diagnostics.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import * as diagnostics from "./diagnostics.ts";
import { get_exprs_from_tts } from "./util.ts";

// rustc: compiler/rustc_builtin_macros/src/concat.rs:10 expand_concat
export function expand_concat(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = get_exprs_from_tts(cx, tts);
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac = r._0;
  if (mac.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp, mac._0) };
  const es = mac._0;
  let accumulator = "";
  const missing_literal: Span[] = [];
  let guar: ErrorGuaranteed | undefined = undefined;
  for (const e of es) {
    const kind = e.kind;
    if (kind.$ === "Lit") {
      const token_lit = kind._0;
      const lk = ast.LitKind.from_token_lit(token_lit);
      if (lk.$ === "Err") {
        guar = report_lit_error(cx.sess.psess, lk._0, token_lit, e.span);
      } else {
        const l = lk._0;
        switch (l.$) {
          case "Str":
          case "Float":
            accumulator += Symbol.as_str(l._0);
            break;
          case "Char":
            accumulator += String.fromCodePoint(l._0);
            break;
          case "Int":
            accumulator += l._0.toString();
            break;
          case "Bool":
            accumulator += l._0 ? "true" : "false";
            break;
          case "CStr":
            guar = cx.dcx().emit_err(diagnostics.ConcatCStrLit_diagnostic({ span: e.span }));
            break;
          case "Byte":
          case "ByteStr":
            guar = cx.dcx().emit_err(diagnostics.ConcatBytestr_diagnostic({ span: e.span }));
            break;
          case "Err":
            guar = l._0;
            break;
        }
      }
    } else if (kind.$ === "Unary" && kind._0 === ast.UnOp.Neg && kind._1.kind.$ === "Lit") {
      // We also want to allow negative numeric literals.
      const token_lit = kind._1.kind._0;
      const lk = ast.LitKind.from_token_lit(token_lit);
      if (lk.$ === "Ok" && lk._0.$ === "Int") {
        accumulator += `-${lk._0._0.toString()}`;
      } else if (lk.$ === "Ok" && lk._0.$ === "Float") {
        accumulator += `-${Symbol.as_str(lk._0._0)}`;
      } else if (lk.$ === "Err") {
        guar = report_lit_error(cx.sess.psess, lk._0, token_lit, e.span);
      } else {
        missing_literal.push(e.span);
      }
    } else if (kind.$ === "IncludedBytes") {
      cx.dcx().emit_err(diagnostics.ConcatBytestr_diagnostic({ span: e.span }));
    } else if (kind.$ === "Err") {
      guar = kind._0;
    } else if (kind.$ === "Dummy") {
      cx.dcx().span_bug(e.span, "concatenating `ExprKind::Dummy`");
    } else {
      missing_literal.push(e.span);
    }
  }

  let res;
  if (missing_literal.length !== 0) {
    const guar = cx.dcx().emit_err(diagnostics.ConcatMissingLiteral_diagnostic({ spans: missing_literal }));
    res = DummyResult.any(sp, guar);
  } else if (guar !== undefined) {
    res = DummyResult.any(sp, guar);
  } else {
    const sp_ = cx.with_def_site_ctxt(sp);
    res = MacEager.expr(cx.expr_str(sp_, Symbol.intern(accumulator)));
  }
  return { $: "Ready", _0: res };
}
