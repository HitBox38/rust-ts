// Port of compiler/rustc_resolve/src/check_unused.rs
//
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts and
// installed below as `unported(..)` placeholders; free fns have their final signatures and `unported`
// bodies, without markers. The lane that ports check_unused.rs replaces each stub in place (adding
// its `// rustc: ` marker) and removes the method's name from the `unported_methods` list
// (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { type NodeId, type UseTree, visit } from "../rustc_ast/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { Resolver } from "./decls.ts";
import { type ExternCrateToLint, UnusedImport, type UnusedSpanResult } from "./check_unused.gen.ts";

export * from "./check_unused.gen.ts";

// rustc-type: compiler/rustc_resolve/src/check_unused.rs:57 UnusedImportCheckVisitor
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class UnusedImportCheckVisitor extends visit.Visitor {
  constructor(
    public r: Resolver,
    /// All the (so far) unused imports, grouped path list
    public unused_imports: Map<NodeId, UnusedImport>,
    public extern_crate_items: ExternCrateToLint[],
    public base_use_tree: UseTree | undefined,
    public item_span: Span,
  ) {
    super();
  }
}

/** Stub (lane res-lib): `check_unused.rs:302` `calc_unused_spans` (unported). */
export function calc_unused_spans(unused_import: UnusedImport, use_tree: UseTree, use_tree_id: NodeId): UnusedSpanResult {
  return unported("rustc_resolve::check_unused::calc_unused_spans");
}

unported_methods(UnusedImport.prototype, "rustc_resolve::check_unused::UnusedImport", ["add"]);
unported_methods(UnusedImportCheckVisitor.prototype, "rustc_resolve::check_unused::UnusedImportCheckVisitor", [
  "check_import",
  "check_use_tree",
  "unused_import",
  "check_import_as_underscore",
  "check_imports_as_underscore",
  "report_unused_extern_crate_items",
  "as_mut",
  "visit_attribute",
  "visit_item",
  "visit_use_tree_and_id",
]);
unported_methods(Resolver.prototype, "rustc_resolve::check_unused::Resolver", ["check_unused"]);
