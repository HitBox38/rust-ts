// STUB for compiler/rustc_builtin_macros/src/deriving/from.rs (owned by lane bm-derive-b; replace freely).
// Published by lane bm-a with only the names `register_builtin_macros` (lib.ts) uses, so the crate
// type-checks before bm-derive-b lands. No markers: every body is `unported`. Keep the export names and
// shapes (or update lib.ts when you merge), then port the file in place.
import type { ast } from "../../rustc_ast/lib.ts";
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";

export function expand_deriving_from(_cx: ExtCtxt, _span: Span, _item: ast.Item, _push: (item: ast.Item) => void, _is_const: boolean): void {
  unported("rustc_builtin_macros::deriving::from::expand_deriving_from (stub)");
}
