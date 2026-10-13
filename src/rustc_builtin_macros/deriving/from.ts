// Port of compiler/rustc_builtin_macros/src/deriving/from.rs
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { DummyResult, type ExtCtxt } from "../../rustc_expand/base.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import { ast, BlockOrExpr, combine_substructure, MethodDef, TraitDef } from "./generic/mod.ts";
import { new_path } from "./mod.ts";

/// Generate an implementation of the `From` trait, provided that `item`
/// is a struct or a tuple struct with exactly one field.
// rustc: compiler/rustc_builtin_macros/src/deriving/from.rs:14 expand_deriving_from
export function expand_deriving_from(cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean): void {
  const err_span = (): MultiSpan => {
    const ident = ast.ItemKind.ident(item.kind);
    const item_span = ident !== undefined ? ident.span : item.span;
    return MultiSpan.from_spans([span, item_span]);
  };

  // `#[derive(From)]` is currently usable only on structs with exactly one field.
  let field: Result<ast.FieldDef, ErrorGuaranteed>;
  const kind = item.kind;
  switch (kind.$) {
    case "Struct": {
      const data = kind._2;
      const fields = ast.VariantData.fields(data);
      if (fields.length === 1) {
        field = Ok(ast.clone_FieldDef(fields[0]!));
      } else {
        const guar = cx.dcx().emit_err(
          diagnostics.DeriveFromWrongFieldCount_diagnostic({
            span: err_span(),
            multiple_fields: ast.VariantData.fields(data).length > 1,
          }),
        );
        field = Err(guar);
      }
      break;
    }
    case "Enum":
    case "Union": {
      const guar = cx.dcx().emit_err(
        diagnostics.DeriveFromWrongTarget_diagnostic({
          span: err_span(),
          kind: `${ast.ItemKind.article(item.kind)} ${ast.ItemKind.descr(item.kind)}`,
        }),
      );
      field = Err(guar);
      break;
    }
    default:
      return cx.dcx().bug("Invalid derive(From) ADT input");
  }

  const from_type = field.$ === "Ok" ? ast.clone_Ty(field._0.ty) : cx.ty(span, { $: "Err", _0: field._0 });

  const path = new_path(cx, span, [sym.convert, sym.From], [ast.clone_Ty(from_type)]);

  // Generate code like this:
  //
  // struct S(u32);
  // #[automatically_derived]
  // impl ::core::convert::From<u32> for S {
  //     #[inline]
  //     fn from(value: u32) -> S {
  //         Self(value)
  //     }
  // }
  const from_trait_def = new TraitDef(
    span,
    path,
    true,
    false,
    [],
    false,
    [
      new MethodDef(
        sym.from,
        cx.empty_generics(span),
        false,
        [[from_type, sym.value]],
        false,
        cx.ty_self(span),
        [cx.attr_word(sym.inline, span)],
        "Default",
        combine_substructure((cx, span, substructure) => {
          if (field.$ === "Err") {
            const guar = field._0;
            return BlockOrExpr.new_expr(DummyResult.raw_expr(span, guar));
          }
          const field_ = field._0;

          const self_kw = Ident.new(kw.SelfUpper, span);
          let expr: ast.Expr;
          const fields = substructure.fields;
          if (fields.$ === "StaticStruct") {
            const variant = fields._0;
            switch (variant.$) {
              // Self { field: value }
              case "Struct":
                expr = cx.expr_struct_ident(span, self_kw, [cx.field_imm(span, unwrap(field_.ident), cx.expr_ident_sym(span, sym.value))]);
                break;
              // Self(value)
              case "Tuple":
                expr = cx.expr_call_ident(span, self_kw, [cx.expr_ident_sym(span, sym.value)]);
                break;
              default:
                return cx.dcx().bug(`Invalid derive(From) ADT variant: ${format_debug(variant, ast.debug_VariantData, PLAIN)}`);
            }
          } else {
            return cx.dcx().bug("Invalid derive(From) ADT input");
          }
          return BlockOrExpr.new_expr(expr);
        }),
      ),
    ],
    is_const,
    ast.Safety.Default,
    true,
  );

  from_trait_def.expand(cx, item, push);
}
