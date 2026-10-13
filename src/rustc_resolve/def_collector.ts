// Port of compiler/rustc_resolve/src/def_collector.rs
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts
// and installed below as `unported(..)` placeholders; free fns and companions have their final
// signatures and `unported` bodies, without markers. The lane that ports compiler/rustc_resolve/src/def_collector.rs replaces each
// stub in place (adding its `// rustc:` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import type { AstFragment } from "../rustc_expand/expand.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { DefCollector, Resolver } from "./decls.ts";
import type { ParentScope } from "./lib.ts";
import type { MacroRulesScopeRef } from "./macros.ts";

export * from "./def_collector.gen.ts";
export { DefCollector };

/** Stub (lane res-lib): `def_collector.rs:22` `collect_definitions` (unported). */
export function collect_definitions(resolver: Resolver, fragment: AstFragment, parent_scope: ParentScope): MacroRulesScopeRef {
  return unported("rustc_resolve::def_collector::collect_definitions");
}
unported_methods(DefCollector.prototype, "rustc_resolve::def_collector::DefCollector", ["create_def", "with_parent", "with_owner", "with_impl_trait", "collect_field", "visit_macro_invoc", "visit_item", "visit_block", "visit_fn", "visit_foreign_item", "visit_variant", "visit_where_predicate", "visit_variant_data", "visit_generic_param", "visit_assoc_item", "visit_pat", "visit_anon_const", "visit_expr", "visit_ty", "visit_stmt", "visit_arm", "visit_expr_field", "visit_pat_field", "visit_param", "visit_field_def", "visit_crate", "visit_attribute", "visit_inline_asm"]);
