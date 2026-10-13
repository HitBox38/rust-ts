// Port of compiler/rustc_resolve/src/ident.rs
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts
// and installed below as `unported(..)` placeholders; free fns and companions have their final
// signatures and `unported` bodies, without markers. The lane that ports compiler/rustc_resolve/src/ident.rs replaces each
// stub in place (adding its `// rustc:` marker) and removes the method's name from the
// `unported_methods` list (docs/handoff/res-lib.md, "How to fill a stub").
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { unported_methods } from "../rust_ts/stubs.ts";
import { Resolver } from "./decls.ts";

export * from "./ident.gen.ts";

unported_methods(Resolver.prototype, "rustc_resolve::ident::Resolver", ["visit_scopes", "hygienic_lexical_parent", "resolve_ident_in_lexical_scope", "resolve_ident_in_scope_set", "resolve_ident_in_scope_set_inner", "resolve_ident_in_scope", "maybe_push_glob_vs_glob_vis_ambiguity", "maybe_push_ambiguity", "maybe_resolve_ident_in_module", "resolve_super_in_module", "path_root_is_crate_root", "resolve_ident_in_module", "resolve_ident_in_extern_module_non_globs_unadjusted", "resolve_ident_in_local_module_non_globs_unadjusted", "resolve_ident_in_module_globs_unadjusted", "finalize_module_binding", "single_import_can_define_name", "validate_res_from_ribs", "maybe_resolve_path", "resolve_path", "resolve_path_with_ribs"]);
