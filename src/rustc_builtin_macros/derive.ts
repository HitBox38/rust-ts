// STUB for compiler/rustc_builtin_macros/src/derive.rs (owned by lane bm-derive-a; replace freely).
// Published by lane bm-a with only the names `register_builtin_macros` (lib.ts) uses, so the crate
// type-checks before bm-derive-a lands. No markers: every body is `unported`. Keep the export names and
// shapes (or update lib.ts when you merge), then port the file in place.
import type { ast } from "../rustc_ast/lib.ts";
import type { Annotatable, ExpandResult, ExtCtxt, MultiItemModifier } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";

export class Expander implements MultiItemModifier {
  constructor(public is_const: boolean) {}

  expand(
    _ecx: ExtCtxt,
    _span: Span,
    _meta_item: ast.MetaItem,
    _item: Annotatable,
    _is_derive_const: boolean,
  ): ExpandResult<Annotatable[], Annotatable> {
    return unported("rustc_builtin_macros::derive::Expander::expand (stub)");
  }
}
