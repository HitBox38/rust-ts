// STUB for compiler/rustc_builtin_macros/src/test.rs (owned by lane bm-rest; replace freely).
// Published by lane bm-a with only the names `register_builtin_macros` (lib.ts) uses, so the crate
// type-checks before bm-rest lands. No markers: every body is `unported`. Keep the export names and
// shapes (or update lib.ts when you merge), then port the file in place.
import type { ast } from "../rustc_ast/lib.ts";
import type { Annotatable, ExtCtxt } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";

export function expand_test_case(_ecx: ExtCtxt, _span: Span, _meta_item: ast.MetaItem, _item: Annotatable): Annotatable[] {
  return unported("rustc_builtin_macros::test::expand_test_case (stub)");
}

export function expand_test(_ecx: ExtCtxt, _span: Span, _meta_item: ast.MetaItem, _item: Annotatable): Annotatable[] {
  return unported("rustc_builtin_macros::test::expand_test (stub)");
}

export function expand_bench(_ecx: ExtCtxt, _span: Span, _meta_item: ast.MetaItem, _item: Annotatable): Annotatable[] {
  return unported("rustc_builtin_macros::test::expand_bench (stub)");
}
