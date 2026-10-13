// Port of compiler/rustc_builtin_macros/src/deriving/ord.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { ast, BlockOrExpr, combine_substructure, MethodDef, type Substructure, TraitDef } from "./generic/mod.ts";
import { path_std } from "./mod.ts";
import { cmp_body, discr_data_order, OrdlikeDerive } from "./partial_ord.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/ord.rs:10 expand_deriving_ord
export function expand_deriving_ord(cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean): void {
  const discr_then_data = discr_data_order(item);

  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.cmp, sym.Ord]),
    false,
    true,
    [],
    false,
    [
      new MethodDef(
        sym.cmp,
        cx.empty_generics(span),
        true,
        [[cx.ty_self_ref(span), sym.other]],
        true,
        cx.ty_path(path_std(cx, span, [sym.cmp, sym.Ordering])),
        [cx.attr_word(sym.inline, span)],
        "Unify",
        combine_substructure((cx, span, substr) => cs_cmp(cx, span, substr, discr_then_data)),
      ),
    ],
    is_const,
    ast.Safety.Default,
    true,
  );

  trait_def.expand(cx, item, push);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/ord.rs:50 cs_cmp
export function cs_cmp(cx: ExtCtxt, span: Span, substr: Substructure, discr_then_data: boolean): BlockOrExpr {
  // Builds:
  //
  // match ::core::cmp::Ord::cmp(&self.x, &other.x) {
  //     ::std::cmp::Ordering::Equal =>
  //         ::core::cmp::Ord::cmp(&self.y, &other.y),
  //     cmp => cmp,
  // }
  const expr = cmp_body(cx, span, substr, discr_then_data, OrdlikeDerive.Ord);
  return BlockOrExpr.new_expr(expr);
}
