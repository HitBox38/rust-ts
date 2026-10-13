// Port of compiler/rustc_builtin_macros/src/deriving/copy.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { ast, TraitDef } from "./generic/mod.ts";
import { path_std } from "./mod.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/copy.rs:8 expand_deriving_copy
export function expand_deriving_copy(cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean): void {
  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.marker, sym.Copy]),
    false,
    false,
    [],
    true,
    [],
    is_const,
    ast.Safety.Default,
    true,
  );

  trait_def.expand(cx, item, push);
}
