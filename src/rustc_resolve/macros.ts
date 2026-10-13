// Port of compiler/rustc_resolve/src/macros.rs
//! A bunch of methods and structures more or less related to resolving macros and
//! interface provided by `Resolver` to macro expander.
//
// Stub (contract-first, lane res-lib): the methods of this file are declared in ./decls.ts and
// installed below as `unported(..)` placeholders; free fns have their final signatures and
// `unported` bodies, without markers. The lane that ports macros.rs replaces each stub in place
// (adding its `// rustc:` marker) and removes the method's name from the `unported_methods` list
// (docs/handoff/res-lib.md, "How to fill a stub").
// Ported by res-lib (needed by `Resolver::new` / `provide`): `PREDEFINED_TOOLS`,
// `registered_attr_tools`, `registered_lint_tools`, `registered_lint_tools_ast`.
// PORT: the `ResolverExpand` methods `next_node_id` (macros.rs:173) and `resolve_imports`
// (macros.rs:255) only call the inherent method of the same name (lib.rs:1936, imports.rs:775). One
// prototype method serves both: the porting lane puts the marker of the delegation on a comment and
// must not assign them (that would recurse forever); they are therefore not in the list below.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import type { Attribute, Path } from "../rustc_ast/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/interface.ts";
import type { MacroKinds } from "../rustc_hir/def.ts";
import type { RegisteredTools } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Session } from "../rustc_session/session.ts";
import type { MacroKind } from "../rustc_span/hygiene.ts";
import { Ident, sym, type Symbol } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import type { Attribute as HirAttribute } from "../rustc_attr_ir/lib.ts";
import { Resolver } from "./decls.ts";
import { Ident_key } from "./lib.ts";

export * from "./macros.gen.ts";

/// We ignore resolutions from one sub-namespace when searching names in scope for another.
/** Stub (lane res-lib): `macros.rs:87` `sub_namespace_match` (unported). */
export function sub_namespace_match(candidate: MacroKinds | undefined, requirement: MacroKind | undefined): boolean {
  return unported("rustc_resolve::macros::sub_namespace_match");
}

// We don't want to format a path using pretty-printing,
// `format!("{}", path)`, because that tries to insert
// line-breaks and is slow.
/** Stub (lane res-lib): `macros.rs:106` `fast_print_path` (unported). */
export function fast_print_path(path: Path): Symbol {
  return unported("rustc_resolve::macros::fast_print_path");
}

const PREDEFINED_TOOLS = (): readonly Symbol[] => [sym.clippy, sym.rustfmt, sym.diagnostic, sym.miri, sym.rust_analyzer];

/** `FxIndexSet<Ident>` (`RegisteredTools`): `Ident` compares by name and syntax context. */
function new_RegisteredTools(): RegisteredTools {
  return new KeyedSet<Ident>(Ident_key);
}

// rustc: compiler/rustc_resolve/src/macros.rs:126 registered_attr_tools
export function registered_attr_tools(tcx: TyCtxt, _: null): RegisteredTools {
  const [, pre_configured_attrs] = tcx.crate_for_resolver(null).borrow() as [unknown, readonly Attribute[]];

  let registered_tools: RegisteredTools;
  const parsed: HirAttribute | undefined = AttributeParser.parse_limited(
    tcx.sess,
    pre_configured_attrs,
    (attr) => attr.path_matches([sym.register_tool]) || attr.path_matches([sym.register_attribute_tool]),
  );
  if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "RegisterTool") {
    registered_tools = new_RegisteredTools();
    for (const t of parsed._0.attr_tools) registered_tools.add(t);
  } else {
    registered_tools = new_RegisteredTools();
  }

  // We implicitly add predefined tools, but it's not an error to register them explicitly.
  for (const name of PREDEFINED_TOOLS()) registered_tools.add(Ident.with_dummy_span(name));
  return registered_tools;
}

// rustc: compiler/rustc_resolve/src/macros.rs:146 registered_lint_tools
export function registered_lint_tools(tcx: TyCtxt, _: null): RegisteredTools {
  const [, pre_configured_attrs] = tcx.crate_for_resolver(null).borrow() as [unknown, readonly Attribute[]];
  return registered_lint_tools_ast(tcx.sess, pre_configured_attrs);
}

// rustc: compiler/rustc_resolve/src/macros.rs:151 registered_lint_tools_ast
export function registered_lint_tools_ast(sess: Session, pre_configured_attrs: readonly Attribute[]): RegisteredTools {
  let registered_tools: RegisteredTools;
  const parsed: HirAttribute | undefined = AttributeParser.parse_limited(
    sess,
    pre_configured_attrs,
    (attr) => attr.path_matches([sym.register_tool]) || attr.path_matches([sym.register_lint_tool]),
  );
  if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "RegisterTool") {
    registered_tools = new_RegisteredTools();
    for (const t of parsed._0.lint_tools) registered_tools.add(t);
  } else {
    registered_tools = new_RegisteredTools();
  }

  // We implicitly add predefined tools, but it's not an error to register them explicitly.
  for (const name of PREDEFINED_TOOLS()) registered_tools.add(Ident.with_dummy_span(name));
  return registered_tools;
}


unported_methods(Resolver.prototype, "rustc_resolve::macros::Resolver", [
  // impl ResolverExpand for Resolver
  "invocation_parent",
  "mark_scope_with_compile_error",
  "resolve_dollar_crates",
  "visit_ast_fragment_with_placeholders",
  "register_builtin_macro",
  "expansion_for_ast_pass",
  "resolve_macro_invocation",
  "record_macro_rule_usage",
  "check_unused_macros",
  "has_derive_copy",
  "has_derive_ord",
  "resolve_derives",
  "take_derive_resolutions",
  "cfg_accessible",
  "macro_accessible",
  "get_proc_macro_quoted_span",
  "declare_proc_macro",
  "append_stripped_cfg_item",
  "registered_attr_tools",
  "registered_lint_tools",
  "register_glob_delegation",
  "glob_delegation_suffixes",
  "insert_impl_trait_name",
  // impl Resolver
  "smart_resolve_macro_path",
  "resolve_derive_macro_path",
  "resolve_macro_or_delegation_path",
  "finalize_macro_resolutions",
  "check_stability_and_deprecation",
  "prohibit_imported_non_macro_attrs",
  "report_out_of_scope_macro_calls",
  "check_reserved_macro_name",
  "compile_macro",
  "path_accessible",
]);
