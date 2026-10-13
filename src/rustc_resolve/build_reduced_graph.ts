// Port of compiler/rustc_resolve/src/build_reduced_graph.rs
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts
// and installed below as `unported(..)` placeholders; free fns and companions have their final
// signatures and `unported` bodies, without markers. The lane that ports compiler/rustc_resolve/src/build_reduced_graph.rs replaces each
// stub in place (adding its `// rustc:` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { unported_methods } from "../rust_ts/stubs.ts";
import { DefCollector, Resolver } from "./decls.ts";

unported_methods(Resolver.prototype, "rustc_resolve::build_reduced_graph::Resolver", ["plant_decl_into_local_module", "define_local", "get_nearest_non_block_module", "expect_module", "get_module", "get_extern_module_with_lock", "expn_def_scope", "macro_def_scope", "get_macro", "get_macro_by_def_id", "register_macros_for_all_crates", "try_resolve_visibility", "build_reduced_graph_external", "build_reduced_graph_for_external_crate_res"]);
unported_methods(DefCollector.prototype, "rustc_resolve::build_reduced_graph::DefCollector", ["as_mut", "res", "resolve_visibility", "insert_field_idents", "insert_field_visibilities_local", "block_needs_anonymous_module", "add_import", "build_reduced_graph_for_use_tree", "build_reduced_graph_for_struct_variant", "build_reduced_graph_for_item", "build_reduced_graph_for_extern_crate", "build_reduced_graph_for_foreign_item", "build_reduced_graph_for_block", "add_macro_use_decl", "process_macro_use_imports", "contains_macro_use", "visit_invoc", "visit_invoc_in_module", "proc_macro_stub", "insert_unused_macro", "define_macro", "brg_visit_item", "brg_visit_mac_call_in_module", "brg_visit_block", "brg_visit_assoc_item", "visit_assoc_item_mac_call", "brg_visit_field_def", "brg_visit_variant"]);
