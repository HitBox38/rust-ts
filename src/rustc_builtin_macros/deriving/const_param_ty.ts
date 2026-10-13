// Port of compiler/rustc_builtin_macros/src/deriving/const_param_ty.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { ast, TraitDef } from "./generic/mod.ts";
import { path_std } from "./mod.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/const_param_ty.rs:8 expand_deriving_const_param_ty
export function expand_deriving_const_param_ty(
  cx: ExtCtxt,
  span: Span,
  item: ast.Item,
  push: (item: ast.Item) => void,
  is_const: boolean,
): void {
  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.marker, sym.ConstParamTy_]),
    false,
    false,
    [path_std(cx, span, [sym.cmp, sym.Eq])],
    false,
    [],
    is_const,
    ast.Safety.Default,
    true,
  );

  trait_def.expand(cx, item, push);
}
