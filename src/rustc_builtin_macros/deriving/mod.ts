// STUB for compiler/rustc_builtin_macros/src/deriving/mod.rs (owned by lane bm-derive-a; replace freely).
// Published by lane bm-a with only the names `register_builtin_macros` (lib.ts) uses, so the crate
// type-checks before bm-derive-a lands. No markers: every body is `unported`. Keep the export names and
// shapes (or update lib.ts when you merge), then port the file in place.
import type { ast } from "../../rustc_ast/lib.ts";
import type { Annotatable, ExpandResult, ExtCtxt, MultiItemModifier } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";

export * as clone from "./clone.ts";
export * as coerce_pointee from "./coerce_pointee.ts";
export * as const_param_ty from "./const_param_ty.ts";
export * as copy from "./copy.ts";
export * as debug from "./debug.ts";
export * as default from "./default.ts";
export * as eq from "./eq.ts";
export * as from from "./from.ts";
export * as hash from "./hash.ts";
export * as ord from "./ord.ts";
export * as partial_eq from "./partial_eq.ts";
export * as partial_ord from "./partial_ord.ts";
export * as reborrow from "./reborrow.ts";

export type BuiltinDeriveFn = (cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean) => void;

export class BuiltinDerive implements MultiItemModifier {
  constructor(public _0: BuiltinDeriveFn) {}

  expand(
    _ecx: ExtCtxt,
    _span: Span,
    _meta_item: ast.MetaItem,
    _item: Annotatable,
    _is_derive_const: boolean,
  ): ExpandResult<Annotatable[], Annotatable> {
    return unported("rustc_builtin_macros::deriving::BuiltinDerive::expand (stub)");
  }
}
