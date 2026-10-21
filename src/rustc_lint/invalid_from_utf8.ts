// Port of compiler/rustc_lint/src/invalid_from_utf8.rs. The lint statics and the `declare_lint_pass!` expansion are
// generated (invalid_from_utf8.lints.gen.ts).
//
// PORT: context.ts types `LateContext::qpath_res` / `expr_or_init_with_outside_body` as returning `unknown`; the
// results are cast (`Res`, `Expr`). `std::str::from_utf8` is std/str.ts's `from_utf8` (same `Utf8Error`).
import { Res } from "../rustc_hir/def.ts";
import type { Expr } from "../rustc_hir/hir.ts";
import type { Span } from "../rustc_span/lib.ts";
import { ByteSymbol, Symbol, sym } from "../rustc_span/symbol.ts";
import { unwrap } from "../std/panic.ts";
import { type Utf8Error, from_utf8 } from "../std/str.ts";
import type { LateContext } from "./context.ts";
import { InvalidFromUtf8Diag_diagnostic } from "./diagnostics.ts";
import { INVALID_FROM_UTF8, INVALID_FROM_UTF8_UNCHECKED, InvalidFromUtf8 } from "./invalid_from_utf8.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./invalid_from_utf8.lints.gen.ts";

declare module "./invalid_from_utf8.lints.gen.ts" {
  interface InvalidFromUtf8 extends LateLintPass {}
}

/** PORT: `str::strip_prefix` (std): the rest of `s` after `prefix`, or `None`. */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

// impl<'tcx> LateLintPass<'tcx> for InvalidFromUtf8
// rustc: compiler/rustc_lint/src/invalid_from_utf8.rs:62 check_expr
InvalidFromUtf8.prototype.check_expr = function (this: InvalidFromUtf8, cx: LateContext, expr: Expr): void {
  if (!(expr.kind.$ === "Call" && expr.kind._1.length === 1)) return;
  const path = expr.kind._0;
  const arg = expr.kind._1[0]!;
  if (path.kind.$ !== "Path") return;
  const qpath = path.kind._0;
  const def_id = Res.opt_def_id(cx.qpath_res(qpath, path.hir_id) as Res);
  if (def_id === undefined) return;
  const diag_item = cx.tcx.get_diagnostic_name(def_id);
  if (diag_item === undefined) return;
  if (
    ![
      sym.str_from_utf8,
      sym.str_from_utf8_mut,
      sym.str_from_utf8_unchecked,
      sym.str_from_utf8_unchecked_mut,
      sym.str_inherent_from_utf8,
      sym.str_inherent_from_utf8_mut,
      sym.str_inherent_from_utf8_unchecked,
      sym.str_inherent_from_utf8_unchecked_mut,
    ].includes(diag_item)
  ) {
    return;
  }

  const lint = (label: Span, utf8_error: Utf8Error): void => {
    const method_ = unwrap(strip_prefix(Symbol.as_str(diag_item), "str_"));
    const stripped = strip_prefix(method_, "inherent_");
    const method = stripped !== undefined ? `str::${stripped}` : `std::str::${method_}`;
    const valid_up_to = utf8_error.valid_up_to();
    const is_unchecked_variant = Symbol.as_str(diag_item).includes("unchecked");

    cx.emit_span_lint(
      is_unchecked_variant ? INVALID_FROM_UTF8_UNCHECKED : INVALID_FROM_UTF8,
      expr.span,
      InvalidFromUtf8Diag_diagnostic(
        is_unchecked_variant ? { $: "Unchecked", method, valid_up_to, label } : { $: "Checked", method, valid_up_to, label },
      ),
    );
  };

  let init = cx.expr_or_init_with_outside_body(arg) as Expr;
  while (init.kind.$ === "AddrOf") {
    const inner = init.kind._2;
    init = cx.expr_or_init_with_outside_body(inner) as Expr;
  }
  switch (init.kind.$) {
    case "Lit": {
      const lit = init.kind._0.node;
      if (lit.$ === "ByteStr") {
        const r = from_utf8(ByteSymbol.as_byte_str(lit._0));
        if (r.$ === "Err") {
          lint(init.span, r._0);
        }
      }
      break;
    }
    case "Array": {
      const args = init.kind._0;
      // `.collect::<Option<Vec<_>>>()`
      let elements: number[] | undefined = [];
      for (const e of args) {
        let b: number | undefined;
        if (e.kind.$ === "Lit") {
          const lit = e.kind._0.node;
          switch (lit.$) {
            case "Byte":
              b = lit._0;
              break;
            case "Int":
              // `b.get() as u8`
              b = Number(BigInt.asUintN(8, lit._0));
              break;
            default:
              b = undefined;
          }
        } else {
          b = undefined;
        }
        if (b === undefined) {
          elements = undefined;
          break;
        }
        elements.push(b);
      }

      if (elements !== undefined) {
        const r = from_utf8(Uint8Array.from(elements));
        if (r.$ === "Err") {
          lint(init.span, r._0);
        }
      }
      break;
    }
    default:
      break;
  }
};
