// Port of compiler/rustc_resolve/src/macros.rs
//! A bunch of methods and structures more or less related to resolving macros and
//! interface provided by `Resolver` to macro expander.
//
// The methods of this file are declared in ./decls.ts (the contract, docs/handoff/res-lib.md) and
// assigned onto `Resolver.prototype` below, in upstream order.
// PORT: the `ResolverExpand` methods `next_node_id` (macros.rs:173) and `resolve_imports`
// (macros.rs:255) only call the inherent method of the same name (lib.rs:1936, imports.rs:775). One
// prototype method serves both, so their markers sit on comments and they are never assigned here
// (that would recurse forever).
// PORT: `self: CmResolver` methods are ordinary `Resolver` methods (`CmResolver` is the resolver,
// lib.ts `mod ref_mut`); `self.reborrow()` / `self.get_mut()` are `RefOrMut.reborrow(this)` /
// `RefOrMut.get_mut(this)`.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { ast, type AttrStyle, type Attribute, CRATE_NODE_ID, type Crate, type MacroDef, type NodeId, type Path } from "../rustc_ast/lib.ts";
import * as pprust from "../rustc_ast_pretty/pprust/mod.ts";
import { AttributeParser } from "../rustc_attr_parsing/interface.ts";
import type { Attribute as HirAttribute, CfgEntry } from "../rustc_attr_ir/lib.ts";
import { StrippedCfgItem } from "../rustc_attr_ir/lib.ts";
import { UnstableReason } from "../rustc_attr_ir/stability.ts";
import type { Deprecation } from "../rustc_attr_ir/lib.ts";
import { index_map_swap_remove } from "../rustc_errors/decorate_diag.ts";
import type { LintBuffer } from "../rustc_errors/lib.ts";
import { clone_SyntaxExtensionKind, type DeriveResolution, Indeterminate, SyntaxExtension, type SyntaxExtensionKind } from "../rustc_expand/base.ts";
import { type AstFragment, AstFragmentKind, type Invocation, type SupportsMacroExpansion } from "../rustc_expand/expand.ts";
import { compile_declarative_macro } from "../rustc_expand/mbe/macro_rules.ts";
import { DefKind, MacroKinds, type Namespace, NonMacroAttrKind, Res as hir_Res, Res_eq } from "../rustc_hir/def.ts";
import { LEGACY_DERIVE_HELPERS, OUT_OF_SCOPE_MACRO_CALLS, UNUSED_MACRO_RULES, UNUSED_MACROS } from "../rustc_lint_defs/builtin.gen.ts";
import type { RegisteredTools } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Session } from "../rustc_session/session.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { type CrateNum, type DefId, DefId_eq, LocalDefId, ModId } from "../rustc_span/def_id.ts";
import type { Edition } from "../rustc_span/edition.ts";
import { type AstPass, ExpnData, LocalExpnId, MacroKind, SyntaxContext, update_dollar_crate_names } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { display_Ident, Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { Resolver } from "./decls.ts";
import * as diagnostics from "./diagnostics/mod.ts";
import { collect_definitions } from "./def_collector.ts";
import type { Import } from "./imports.ts";
import {
  BindingKey,
  type Decl,
  type DeriveData,
  Determinacy,
  Finalize,
  IdentKey,
  Ident_key,
  type InvocationParent,
  Macros20NormalizedSyntaxContext,
  ParentScope,
  type PathResult,
  RefOrMut,
  type Res,
  type ResolutionError,
  Segment,
} from "./lib.ts";
import { clone_ParentScope } from "./lib.gen.ts";
import type { MacroRulesScope } from "./macros.gen.ts";

export * from "./macros.gen.ts";

/// Macro namespace is separated into two sub-namespaces, one for bang macros and
/// one for attribute-like macros (attributes, derives).
/// We ignore resolutions from one sub-namespace when searching names in scope for another.
// rustc: compiler/rustc_resolve/src/macros.rs:87 sub_namespace_match
export function sub_namespace_match(candidate: MacroKinds | undefined, requirement: MacroKind | undefined): boolean {
  // "No specific sub-namespace" means "matches anything" for both requirements and candidates.
  if (candidate === undefined || requirement === undefined) {
    return true;
  }
  switch (requirement) {
    case "Bang":
      return MacroKinds.contains(candidate, MacroKinds.BANG);
    case "Attr":
    case "Derive":
      return MacroKinds.intersects(candidate, MacroKinds.union(MacroKinds.ATTR, MacroKinds.DERIVE));
  }
}

// We don't want to format a path using pretty-printing,
// `format!("{}", path)`, because that tries to insert
// line-breaks and is slow.
// rustc: compiler/rustc_resolve/src/macros.rs:106 fast_print_path
export function fast_print_path(path: Path): Symbol {
  if (path.segments.length === 1) {
    const segment = path.segments[0]!;
    return segment.ident.name;
  } else {
    let path_str = "";
    for (const [i, segment] of path.segments.entries()) {
      if (i !== 0) {
        path_str += "::";
      }
      if (segment.ident.name !== kw.PathRoot) {
        path_str += segment.ident.as_str();
      }
    }
    return Symbol.intern(path_str);
  }
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

/** `map[&key]` (`impl Index for HashMap`): panics when the key is absent. */
function index_map<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined && !map.has(key)) return panic("key not found");
  return v as V;
}

/** `ParentScope` is `Copy`: `*parent_scope` / `ParentScope { field, ..*parent_scope }` make a copy. */
function copy_ParentScope(v: ParentScope): ParentScope {
  return clone_ParentScope(v);
}

// impl<'ra, 'tcx> ResolverExpand for Resolver<'ra, 'tcx>

// rustc: compiler/rustc_resolve/src/macros.rs:173 next_node_id
// (delegates to the inherent `Resolver::next_node_id`, lib.rs:1936: the same prototype method)

// rustc: compiler/rustc_resolve/src/macros.rs:177 invocation_parent
Resolver.prototype.invocation_parent = function (this: Resolver, id: LocalExpnId): LocalDefId {
  return index_map(this.invocation_parents, id).parent_def;
};

// rustc: compiler/rustc_resolve/src/macros.rs:181 mark_scope_with_compile_error
Resolver.prototype.mark_scope_with_compile_error = function (this: Resolver, id: NodeId): void {
  const owner = this.owners.get(id);
  const def_id = owner === undefined ? undefined : owner.def_id;
  if (def_id !== undefined && DefKind.is_module_like(this.tcx_.def_kind(def_id))) {
    this.mods_with_parse_errors.add(LocalDefId.to_def_id(def_id));
  }
};

// rustc: compiler/rustc_resolve/src/macros.rs:189 resolve_dollar_crates
Resolver.prototype.resolve_dollar_crates = function (this: Resolver): void {
  update_dollar_crate_names((ctxt) => {
    const ident = Ident.new(kw.DollarCrate, Span.with_ctxt(DUMMY_SP, ctxt));
    return this.resolve_crate_root(ident).name() ?? kw.Crate;
  });
};

// rustc: compiler/rustc_resolve/src/macros.rs:196 visit_ast_fragment_with_placeholders
Resolver.prototype.visit_ast_fragment_with_placeholders = function (this: Resolver, expansion: LocalExpnId, fragment: AstFragment): void {
  // Integrate the new AST fragment into all the definition and module structures.
  // We are inside the `expansion` now, but other parent scope components are still the same.
  const parent_scope = copy_ParentScope(index_map(this.invocation_parent_scopes, expansion));
  parent_scope.expansion = expansion;
  const output_macro_rules_scope = collect_definitions(this, fragment, parent_scope);
  this.output_macro_rules_scopes.set(expansion, output_macro_rules_scope);

  const module = parent_scope.module.expect_local();
  module.unexpanded_invocations.borrow_mut(this).value.delete(expansion);
  const unexpanded_invocations = this.impl_unexpanded_invocations.get(this.invocation_parent(expansion));
  if (unexpanded_invocations !== undefined) {
    unexpanded_invocations.delete(expansion);
  }
};

// rustc: compiler/rustc_resolve/src/macros.rs:216 register_builtin_macro
Resolver.prototype.register_builtin_macro = function (this: Resolver, name: Symbol, ext: SyntaxExtensionKind): void {
  const was_registered = this.builtin_macros.has(name);
  this.builtin_macros.set(name, ext);
  if (was_registered) {
    this.dcx().bug(`built-in macro \`${Symbol.as_str(name)}\` was already registered`);
  }
};

// Create a new Expansion with a definition site of the provided module, or
// a fake empty `#[no_implicit_prelude]` module if no module is provided.
// rustc: compiler/rustc_resolve/src/macros.rs:224 expansion_for_ast_pass
Resolver.prototype.expansion_for_ast_pass = function (
  this: Resolver,
  call_site: Span,
  pass: AstPass,
  features: readonly Symbol[],
  parent_module_id: NodeId | undefined,
): LocalExpnId {
  const parent_module = parent_module_id === undefined ? undefined : ModId.new_unchecked(LocalDefId.to_def_id(this.owner_def_id(parent_module_id)));
  const expn_id = this.tcx_.with_stable_hashing_context((hcx) =>
    LocalExpnId.fresh(ExpnData.allow_unstable({ $: "AstPass", _0: pass }, call_site, this.tcx_.sess.edition(), [...features], undefined, parent_module), hcx),
  );

  const parent_scope = parent_module === undefined ? this.empty_module : this.expect_module(parent_module.to_def_id()).expect_local();
  this.ast_transform_scopes.set(expn_id, parent_scope);

  return expn_id;
};

// rustc: compiler/rustc_resolve/src/macros.rs:255 resolve_imports
// (delegates to the inherent `Resolver::resolve_imports`, imports.rs:775: the same prototype method)

// rustc: compiler/rustc_resolve/src/macros.rs:259 resolve_macro_invocation
Resolver.prototype.resolve_macro_invocation = function (
  this: Resolver,
  invoc: Invocation,
  eager_expansion_root: LocalExpnId,
  force: boolean,
): Result<SyntaxExtension, Indeterminate> {
  const invoc_id = invoc.expansion_data.id;
  let parent_scope_: ParentScope;
  let invocation_parent: InvocationParent;
  {
    const ps = this.invocation_parent_scopes.get(invoc_id);
    const ip = this.invocation_parents.get(invoc_id);
    if (ps !== undefined && ip !== undefined) {
      [parent_scope_, invocation_parent] = [copy_ParentScope(ps), ip];
    } else if (ps === undefined && ip === undefined) {
      // Eager macro invocations are not collected into the reduced graph, so they
      // inherit their parent scope and invocation parent from the eager expansion root -
      // the macro that requested this eager expansion.
      const eps = this.invocation_parent_scopes.get(eager_expansion_root);
      if (eps === undefined) return panic("non-eager expansion without a parent scope");
      const parent_scope = copy_ParentScope(eps);
      const eip = this.invocation_parents.get(eager_expansion_root);
      if (eip === undefined) return panic("non-eager expansion without an invocation parent");
      const invocation_parent_ = eip;
      this.invocation_parent_scopes.set(invoc_id, copy_ParentScope(parent_scope));
      this.invocation_parents.set(invoc_id, invocation_parent_);
      [parent_scope_, invocation_parent] = [parent_scope, invocation_parent_];
    } else {
      return unreachable("invocation parent tables must both contain or both miss an invocation");
    }
  }

  let derives: readonly Path[] = [];
  let inner_attr = false;
  let deleg_impl: [LocalDefId, Span] | undefined = undefined;
  let path: Path;
  let kind: MacroKind;
  const ikind = invoc.kind;
  switch (ikind.$) {
    case "Attr": {
      const attr = ikind.attr;
      derives = this.arenas.alloc_ast_paths(ikind.derives);
      inner_attr = attr.style === ("Inner" satisfies AttrStyle);
      [path, kind] = [attr.get_normal_item().path, "Attr"];
      break;
    }
    case "Bang":
      [path, kind] = [ikind.mac.path, "Bang"];
      break;
    case "Derive":
      [path, kind] = [ikind.path, "Derive"];
      break;
    case "GlobDelegation": {
      const item = ikind.item;
      if (item.kind.$ !== "DelegationMac") return unreachable();
      const deleg = item.kind._0;
      if (deleg.suffixes.$ !== "Glob") return unreachable();
      const star_span = deleg.suffixes._0;
      deleg_impl = [invocation_parent.parent_def, star_span];
      // It is sufficient to consider glob delegation a bang macro for now.
      [path, kind] = [deleg.prefix, "Bang"];
      break;
    }
  }

  // Derives are not included when `invocations` are collected, so we have to add them here.
  const parent_scope = copy_ParentScope(parent_scope_);
  parent_scope.derives = derives;
  const supports_macro_expansion = AstFragmentKind.supports_macro_expansion(invoc.fragment_kind);
  const node_id = invoc.expansion_data.lint_node_id;
  // This is a heuristic, but it's good enough for the lint.
  const looks_like_invoc_in_mod_inert_attr =
    invocation_parent.in_attr && invoc.fragment_kind === "Expr" && DefKind_eq_Mod(this.tcx_.def_kind(invocation_parent.parent_def))
      ? invocation_parent.parent_def
      : undefined;
  let sugg_span: Span | undefined;
  if (ikind.$ === "Attr" && ikind.item.$ === "Item" && !Span.from_expansion(ikind.item._0.span)) {
    sugg_span = Span.shrink_to_lo(ikind.item._0.span);
  } else {
    sugg_span = undefined;
  }
  const r = this.smart_resolve_macro_path(
    path,
    kind,
    supports_macro_expansion,
    inner_attr,
    parent_scope,
    node_id,
    force,
    deleg_impl,
    looks_like_invoc_in_mod_inert_attr,
    sugg_span,
  );
  if (r.$ === "Err") return r;
  const [ext, res] = r._0;

  const span = invoc.span();
  const def_id = deleg_impl !== undefined ? undefined : hir_Res.opt_def_id(res);
  this.tcx_.with_stable_hashing_context((hcx) => {
    LocalExpnId.set_expn_data(
      invoc_id,
      ext.expn_data(
        parent_scope.expansion,
        span,
        fast_print_path(path),
        kind,
        def_id,
        def_id === undefined ? undefined : this.macro_def_scope(def_id).nearest_parent_mod(),
      ),
      hcx,
    );
  });

  return Ok(ext);
};

/** `def_kind == DefKind::Mod` (derived `PartialEq` of a unit variant). */
function DefKind_eq_Mod(def_kind: DefKind): boolean {
  return def_kind.$ === "Mod";
}

// rustc: compiler/rustc_resolve/src/macros.rs:362 record_macro_rule_usage
Resolver.prototype.record_macro_rule_usage = function (this: Resolver, id: NodeId, rule_i: number): void {
  const entry = this.unused_macro_rules.get(id);
  if (entry !== undefined) {
    const [, rules] = entry;
    rules.remove(rule_i);
  }
};

// rustc: compiler/rustc_resolve/src/macros.rs:368 check_unused_macros
Resolver.prototype.check_unused_macros = function (this: Resolver): void {
  for (const [, [node_id, ident]] of this.unused_macros) {
    this.lint_buffer_.buffer_lint(UNUSED_MACROS, node_id, ident.span, diagnostics.UnusedMacroDefinition_diagnostic({ name: ident.name }));
    // Do not report unused individual rules if the entire macro is unused
    index_map_swap_remove(this.unused_macro_rules, node_id);
  }

  for (const [node_id, [def_id, unused_arms]] of this.unused_macro_rules) {
    if (unused_arms.is_empty()) {
      continue;
    }
    const ext = index_map(this.local_macro_map, def_id);
    const ext_kind = ext.kind;
    if (ext_kind.$ !== "MacroRules") {
      continue;
    }
    const m = ext_kind._0;
    for (const arm_i of unused_arms.iter()) {
      const unused = m.get_unused_rule(arm_i);
      if (unused !== undefined) {
        const [ident, rule_span] = unused;
        this.lint_buffer_.buffer_lint(UNUSED_MACRO_RULES, node_id, rule_span, diagnostics.MacroRuleNeverUsed_diagnostic({ n: arm_i + 1, name: ident.name }));
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/macros.rs:401 has_derive_copy
Resolver.prototype.has_derive_copy = function (this: Resolver, expn_id: LocalExpnId): boolean {
  return this.containers_deriving_copy.has(expn_id);
};

// rustc: compiler/rustc_resolve/src/macros.rs:405 has_derive_ord
Resolver.prototype.has_derive_ord = function (this: Resolver, expn_id: LocalExpnId): boolean {
  return this.containers_deriving_ord.has(expn_id);
};

// rustc: compiler/rustc_resolve/src/macros.rs:409 resolve_derives
Resolver.prototype.resolve_derives = function (
  this: Resolver,
  expn_id: LocalExpnId,
  force: boolean,
  derive_paths: () => DeriveResolution[],
): Result<undefined, Indeterminate> {
  // Block expansion of the container until we resolve all derives in it.
  // This is required for two reasons:
  // - Derive helper attributes are in scope for the item to which the `#[derive]`
  //   is applied, so they have to be produced by the container's expansion rather
  //   than by individual derives.
  // - Derives in the container need to know whether one of them is a built-in `Copy`.
  //   (But see the comment mentioning #124794 below.)
  // Temporarily take the data to avoid borrow checker conflicts.
  const derive_data = this.derive_data;
  this.derive_data = new Map();
  let entry = derive_data.get(expn_id);
  if (entry === undefined) {
    entry = {
      resolutions: derive_paths(),
      helper_attrs: [],
      has_derive_copy: false,
      has_derive_ord: false,
    } satisfies DeriveData;
    derive_data.set(expn_id, entry);
  }
  const parent_scope = copy_ParentScope(index_map(this.invocation_parent_scopes, expn_id));
  for (const [i, resolution] of entry.resolutions.entries()) {
    if (resolution.exts === undefined) {
      let ext_: SyntaxExtension;
      const r = this.cm().resolve_derive_macro_path(resolution.path, parent_scope, force, undefined);
      if (r.$ === "Ok" && r._0[0] !== undefined) {
        const ext = r._0[0];
        if (ext.helper_attrs.length !== 0) {
          const span = resolution.path.segments[resolution.path.segments.length - 1]!.ident.span;
          const ctxt = Macros20NormalizedSyntaxContext.new(Span.ctxt(span));
          entry.helper_attrs.push(...ext.helper_attrs.map((name): [number, IdentKey, Span] => [i, new IdentKey(name, ctxt), span]));
        }
        entry.has_derive_copy = entry.has_derive_copy || ext.builtin_name === sym.Copy;
        entry.has_derive_ord = entry.has_derive_ord || ext.builtin_name === sym.Ord;
        ext_ = ext;
      } else if (r.$ === "Ok" || r._0 === "Determined") {
        ext_ = this.dummy_ext("Derive");
      } else {
        assert(this.derive_data.size === 0, "assertion failed: self.derive_data.is_empty()");
        this.derive_data = derive_data;
        return Err(Indeterminate);
      }
      resolution.exts = ext_;
    }
  }
  // Sort helpers in a stable way independent from the derive resolution order.
  entry.helper_attrs.sort((a, b) => a[0] - b[0]);
  const helper_attrs = entry.helper_attrs.map(([, ident, orig_ident_span]): [IdentKey, Span, Decl] => {
    const res: Res = { $: "NonMacroAttr", _0: NonMacroAttrKind.DeriveHelper };
    const decl = this.arenas.new_pub_def_decl(res, orig_ident_span, expn_id);
    return [ident, orig_ident_span, decl];
  });
  this.helper_attrs.set(expn_id, helper_attrs);
  // Mark this derive as having `Copy` either if it has `Copy` itself or if its parent derive
  // has `Copy`, to support `#[derive(Copy, Clone)]`, `#[derive(Clone, Copy)]`, or
  // `#[derive(Copy)] #[derive(Clone)]`. We do this because the code generated for
  // `derive(Clone)` changes if `derive(Copy)` is also present.
  //
  // FIXME(#124794): unfortunately this doesn't work with `#[derive(Clone)] #[derive(Copy)]`.
  // When the `Clone` impl is generated the `#[derive(Copy)]` hasn't been processed and
  // `has_derive_copy` hasn't been set yet.
  if (entry.has_derive_copy || this.has_derive_copy(parent_scope.expansion)) {
    this.containers_deriving_copy.add(expn_id);
  }
  // Similar to the above `Copy` and `Clone` case, the code generated for
  // `derive(PartialOrd)` changes if `derive(Ord)` is also present.
  // FIXME(makai410): this also doesn't work with `#[derive(PartialOrd)] #[derive(Ord)]`.
  if (entry.has_derive_ord || this.has_derive_ord(parent_scope.expansion)) {
    this.containers_deriving_ord.add(expn_id);
  }
  assert(this.derive_data.size === 0, "assertion failed: self.derive_data.is_empty()");
  this.derive_data = derive_data;
  return Ok(undefined);
};

// rustc: compiler/rustc_resolve/src/macros.rs:498 take_derive_resolutions
Resolver.prototype.take_derive_resolutions = function (this: Resolver, expn_id: LocalExpnId): DeriveResolution[] | undefined {
  const data = this.derive_data.get(expn_id);
  this.derive_data.delete(expn_id);
  return data === undefined ? undefined : data.resolutions;
};

// The function that implements the resolution logic of `#[cfg_accessible(path)]`.
// Returns true if the path can certainly be resolved in one of three namespaces,
// returns false if the path certainly cannot be resolved in any of the three namespaces.
// Returns `Indeterminate` if we cannot give a certain answer yet.
// rustc: compiler/rustc_resolve/src/macros.rs:506 cfg_accessible
Resolver.prototype.cfg_accessible = function (this: Resolver, expn_id: LocalExpnId, path: Path): Result<boolean, Indeterminate> {
  return this.path_accessible(expn_id, path, ["TypeNS", "ValueNS", "MacroNS"]);
};

// rustc: compiler/rustc_resolve/src/macros.rs:514 macro_accessible
Resolver.prototype.macro_accessible = function (this: Resolver, expn_id: LocalExpnId, path: Path): Result<boolean, Indeterminate> {
  return this.path_accessible(expn_id, path, ["MacroNS"]);
};

// rustc: compiler/rustc_resolve/src/macros.rs:522 get_proc_macro_quoted_span
Resolver.prototype.get_proc_macro_quoted_span = function (this: Resolver, krate: CrateNum, id: number): Span {
  return this.cstore().get_proc_macro_quoted_span_untracked(this.tcx_, krate, id);
};

// rustc: compiler/rustc_resolve/src/macros.rs:526 declare_proc_macro
Resolver.prototype.declare_proc_macro = function (this: Resolver, id: NodeId): void {
  this.proc_macros.push(this.owner_def_id(id));
};

// rustc: compiler/rustc_resolve/src/macros.rs:530 append_stripped_cfg_item
Resolver.prototype.append_stripped_cfg_item = function (this: Resolver, parent_node: NodeId, ident: Ident, cfg: CfgEntry, cfg_span: Span): void {
  this.stripped_cfg_items.push(new StrippedCfgItem<NodeId>(parent_node, ident, [cfg, cfg_span]));
};

// rustc: compiler/rustc_resolve/src/macros.rs:544 registered_attr_tools
Resolver.prototype.registered_attr_tools = function (this: Resolver): RegisteredTools {
  return this.registered_attr_tools_;
};

// rustc: compiler/rustc_resolve/src/macros.rs:548 registered_lint_tools
Resolver.prototype.registered_lint_tools = function (this: Resolver): RegisteredTools {
  return this.registered_lint_tools_;
};

// rustc: compiler/rustc_resolve/src/macros.rs:552 register_glob_delegation
Resolver.prototype.register_glob_delegation = function (this: Resolver, invoc_id: LocalExpnId): void {
  this.glob_delegation_invoc_ids.add(invoc_id);
};

// rustc: compiler/rustc_resolve/src/macros.rs:556 glob_delegation_suffixes
Resolver.prototype.glob_delegation_suffixes = function (
  this: Resolver,
  trait_def_id: DefId,
  impl_def_id: LocalDefId,
  star_span: Span,
): Result<[Ident, Ident | undefined][], Indeterminate> {
  const target_trait = this.expect_module(trait_def_id);
  if (target_trait.has_unexpanded_invocations(this)) {
    return Err(Indeterminate);
  }
  // FIXME: Instead of waiting try generating all trait methods, and pruning
  // the shadowed ones a bit later, e.g. when all macro expansion completes.
  // Pros: expansion will be stuck less (but only in exotic cases), the implementation may be
  // less hacky.
  // Cons: More code is generated just to be deleted later, deleting already created `DefId`s
  // may be nontrivial.
  const unexpanded_invocations = this.impl_unexpanded_invocations.get(impl_def_id);
  if (unexpanded_invocations !== undefined && unexpanded_invocations.size !== 0) {
    return Err(Indeterminate);
  }

  const idents: [Ident, Ident | undefined][] = [];
  target_trait.for_each_child(this, (this_, ident, orig_ident_span, ns, _binding) => {
    const overriding_keys = this_.impl_binding_keys.get(impl_def_id);
    if (overriding_keys !== undefined && overriding_keys.has(BindingKey.new(ident, ns))) {
      // The name is overridden, do not produce it from the glob delegation.
    } else {
      // FIXME: Adjust hygiene for idents from globs, like for glob imports.
      idents.push([ident.orig(Span.with_ctxt(star_span, Span.ctxt(orig_ident_span))), undefined]);
    }
  });
  return Ok(idents);
};

// rustc: compiler/rustc_resolve/src/macros.rs:592 insert_impl_trait_name
Resolver.prototype.insert_impl_trait_name = function (this: Resolver, id: NodeId, name: Symbol): void {
  this.impl_trait_names.set(id, name);
};

// impl<'ra, 'tcx> Resolver<'ra, 'tcx>

/// Resolve macro path with error reporting and recovery.
/// Uses dummy syntax extensions for unresolved macros or macros with unexpected resolutions
/// for better error recovery.
// rustc: compiler/rustc_resolve/src/macros.rs:601 smart_resolve_macro_path
Resolver.prototype.smart_resolve_macro_path = function (
  this: Resolver,
  path: Path,
  kind: MacroKind,
  supports_macro_expansion: SupportsMacroExpansion,
  inner_attr: boolean,
  parent_scope: ParentScope,
  node_id: NodeId,
  force: boolean,
  deleg_impl: [LocalDefId, Span] | undefined,
  invoc_in_mod_inert_attr: LocalDefId | undefined,
  suggestion_span: Span | undefined,
): Result<[SyntaxExtension, Res], Indeterminate> {
  let ext: SyntaxExtension;
  let res: Res;
  const r = this.cm_mut().resolve_macro_or_delegation_path(
    path,
    kind,
    parent_scope,
    force,
    deleg_impl,
    invoc_in_mod_inert_attr === undefined ? undefined : [invoc_in_mod_inert_attr, node_id],
    undefined,
    suggestion_span,
  );
  if (r.$ === "Ok" && r._0[0] !== undefined) {
    [ext, res] = [r._0[0], r._0[1]];
  } else if (r.$ === "Ok") {
    [ext, res] = [this.dummy_ext(kind), r._0[1]];
  } else if (r._0 === "Determined") {
    [ext, res] = [this.dummy_ext(kind), hir_Res.Err];
  } else {
    return Err(Indeterminate);
  }

  // Everything below is irrelevant to glob delegation, take a shortcut.
  if (deleg_impl !== undefined) {
    if (!(res.$ === "Err" || (res.$ === "Def" && res._0.$ === "Trait"))) {
      this.dcx().emit_err(
        diagnostics.MacroExpectedFound_diagnostic({
          span: path.span,
          expected: "trait",
          article: "a",
          found: hir_Res.descr(res),
          macro_path: pprust.path_to_string(path),
          remove_surrounding_derive: undefined,
          add_as_non_derive: undefined,
        }),
      );
      return Ok([this.dummy_ext(kind), hir_Res.Err]);
    }

    return Ok([ext, res]);
  }

  // Report errors for the resolved macro.
  for (const [idx, segment] of path.segments.entries()) {
    if (segment.args !== undefined) {
      const args = segment.args;
      this.dcx().emit_err(diagnostics.GenericArgumentsInMacroPath_diagnostic({ span: ast.GenericArgs.span(args) }));
    }
    if (kind === "Attr" && segment.ident.as_str().startsWith("rustc")) {
      if (idx === 0) {
        this.dcx().emit_err(diagnostics.AttributesStartingWithRustcAreReserved_diagnostic({ span: segment.ident.span }));
      } else {
        this.dcx().emit_err(diagnostics.AttributesContainingRustcAreReserved_diagnostic({ span: segment.ident.span }));
      }
    }
  }

  switch (res.$) {
    case "Def":
      if (res._0.$ === "Macro") {
        const def_id = res._1.as_local();
        if (def_id !== undefined) {
          index_map_swap_remove(this.unused_macros, def_id);
          if (this.proc_macro_stubs.has(def_id)) {
            this.dcx().emit_err(
              diagnostics.ProcMacroSameCrate_diagnostic({
                span: path.span,
                is_test: this.tcx_.sess.is_test_crate(),
              }),
            );
          }
        }
        break;
      }
      return panic("expected `DefKind::Macro` or `Res::NonMacroAttr`");
    case "NonMacroAttr":
    case "Err":
      break;
    default:
      return panic("expected `DefKind::Macro` or `Res::NonMacroAttr`");
  }

  this.check_stability_and_deprecation(ext, path, node_id);

  let unexpected_res: [string, string] | undefined;
  if (!MacroKinds.contains(ext.macro_kinds(), MacroKinds.from_MacroKind(kind))) {
    unexpected_res = [MacroKind.article(kind), MacroKind.descr_expected(kind)];
  } else if (res.$ === "Def") {
    switch (supports_macro_expansion.$) {
      case "No":
        unexpected_res = ["a", "non-macro attribute"];
        break;
      case "Yes":
        if (inner_attr && !supports_macro_expansion.supports_inner_attrs) {
          unexpected_res = ["a", "non-macro inner attribute"];
        } else {
          unexpected_res = undefined;
        }
        break;
    }
  } else {
    unexpected_res = undefined;
  }
  if (unexpected_res !== undefined) {
    const [article, expected] = unexpected_res;
    const path_str = pprust.path_to_string(path);

    const err: diagnostics.MacroExpectedFound = {
      span: path.span,
      expected,
      article,
      found: hir_Res.descr(res),
      macro_path: path_str,
      remove_surrounding_derive: undefined,
      add_as_non_derive: undefined,
    };

    // Suggest moving the macro out of the derive() if the macro isn't Derive
    if (
      !Span.from_expansion(path.span) &&
      kind === "Derive" &&
      !MacroKinds.contains(ext.macro_kinds(), MacroKinds.DERIVE) &&
      MacroKinds.contains(ext.macro_kinds(), MacroKinds.ATTR)
    ) {
      err.remove_surrounding_derive = { span: path.span };
      err.add_as_non_derive = { macro_path: path_str };
    }

    this.dcx().emit_err(diagnostics.MacroExpectedFound_diagnostic(err));

    return Ok([this.dummy_ext(kind), hir_Res.Err]);
  }

  // We are trying to avoid reporting this error if other related errors were reported.
  if (res.$ !== "Err" && inner_attr && !this.features.custom_inner_attributes()) {
    let is_macro: boolean;
    switch (res.$) {
      case "Def":
        is_macro = true;
        break;
      case "NonMacroAttr":
        is_macro = false;
        break;
      default:
        return unreachable();
    }
    const msg = is_macro ? "inner macro attributes are unstable" : "custom inner attributes are unstable";
    feature_err(this.tcx_.sess, sym.custom_inner_attributes, path.span, msg).emit();
  }

  return Ok([ext, res]);
};

// rustc: compiler/rustc_resolve/src/macros.rs:746 resolve_derive_macro_path
Resolver.prototype.resolve_derive_macro_path = function (
  this: Resolver,
  path: Path,
  parent_scope: ParentScope,
  force: boolean,
  ignore_import: Import | undefined,
): Result<[SyntaxExtension | undefined, Res], Determinacy> {
  return this.resolve_macro_or_delegation_path(path, "Derive", parent_scope, force, undefined, undefined, ignore_import, undefined);
};

// rustc: compiler/rustc_resolve/src/macros.rs:765 resolve_macro_or_delegation_path
Resolver.prototype.resolve_macro_or_delegation_path = function (
  this: Resolver,
  ast_path: Path,
  kind: MacroKind,
  parent_scope: ParentScope,
  force: boolean,
  deleg_impl: [LocalDefId, Span] | undefined,
  invoc_in_mod_inert_attr: [LocalDefId, NodeId] | undefined,
  ignore_import: Import | undefined,
  suggestion_span: Span | undefined,
): Result<[SyntaxExtension | undefined, Res], Determinacy> {
  const path_span = ast_path.span;
  const path = Segment.from_path(ast_path);

  // Possibly apply the macro helper hack
  if (
    deleg_impl === undefined &&
    kind === "Bang" &&
    path.length === 1 &&
    SyntaxContext.outer_expn_data(Span.ctxt(path[0]!.ident.span)).local_inner_macros
  ) {
    const segment = path[0]!;
    const root = Ident.new(kw.DollarCrate, segment.ident.span);
    path.splice(0, 0, Segment.from_ident(root));
  }

  let res: Result<Res, Determinacy>;
  if (deleg_impl !== undefined || path.length > 1) {
    const ns: Namespace = deleg_impl !== undefined ? "TypeNS" : "MacroNS";
    let res_: Result<Res, Determinacy>;
    const path_res: PathResult = RefOrMut.reborrow(this).maybe_resolve_path(path, ns, parent_scope, ignore_import);
    const full_res = path_res.$ === "NonModule" ? path_res._0.full_res() : undefined;
    if (path_res.$ === "NonModule" && full_res !== undefined) {
      res_ = Ok(full_res);
    } else if (path_res.$ === "Indeterminate" && !force) {
      return Err("Undetermined");
    } else if (path_res.$ === "NonModule" || path_res.$ === "Indeterminate" || path_res.$ === "Failed") {
      res_ = Err("Determined");
    } else if (path_res._0.$ === "Module") {
      res_ = Ok(unwrap(path_res._0._0.res()));
    } else {
      return unreachable();
    }

    this.multi_segment_macro_resolutions
      .borrow_mut_checked(this)
      .value.push([path, path_span, kind, copy_ParentScope(parent_scope), res_.$ === "Ok" ? res_._0 : undefined, ns]);

    this.prohibit_imported_non_macro_attrs(undefined, res_.$ === "Ok" ? res_._0 : undefined, path_span);
    res = res_;
  } else {
    let binding: Result<Decl, Determinacy> = RefOrMut.reborrow(this).resolve_ident_in_scope_set(
      path[0]!.ident,
      { $: "Macro", _0: kind },
      parent_scope,
      undefined,
      undefined,
      undefined,
    );
    if (binding.$ === "Err") {
      const determinacy = binding._0;
      binding = Err(Determinacy.determined(determinacy === "Determined" || force));
    }
    if (binding.$ === "Err" && binding._0 === "Undetermined") {
      return Err("Undetermined");
    }

    this.single_segment_macro_resolutions
      .borrow_mut_checked(this)
      .value.push([path[0]!.ident, kind, copy_ParentScope(parent_scope), binding.$ === "Ok" ? binding._0 : undefined, suggestion_span]);

    const res_: Result<Res, Determinacy> = binding.$ === "Ok" ? Ok(binding._0.res()) : binding;
    this.prohibit_imported_non_macro_attrs(binding.$ === "Ok" ? binding._0 : undefined, res_.$ === "Ok" ? res_._0 : undefined, path_span);
    RefOrMut.reborrow(this).report_out_of_scope_macro_calls(ast_path, parent_scope, invoc_in_mod_inert_attr, binding.$ === "Ok" ? binding._0 : undefined);
    res = res_;
  }

  if (res.$ === "Err") return res;
  const res_ok = res._0;
  let ext: SyntaxExtension | undefined;
  if (deleg_impl !== undefined) {
    const [impl_def_id, star_span] = deleg_impl;
    if (res_ok.$ === "Def" && res_ok._0.$ === "Trait") {
      const def_id = res_ok._1;
      const edition = this.tcx_.sess.edition();
      ext = this.arenas.alloc_macro(SyntaxExtension.glob_delegation(def_id, impl_def_id, star_span, edition));
    } else {
      ext = undefined;
    }
  } else {
    ext = this.get_macro(res_ok);
  }
  return Ok([ext, res_ok]);
};

// rustc: compiler/rustc_resolve/src/macros.rs:873 finalize_macro_resolutions
Resolver.prototype.finalize_macro_resolutions = function (this: Resolver, krate: Crate): void {
  const check_consistency = (this_: Resolver, path: readonly Segment[], span: Span, kind: MacroKind, initial_res: Res | undefined, res: Res): void => {
    if (initial_res !== undefined) {
      if (!Res_eq(res, initial_res)) {
        if (this_.ambiguity_errors.length === 0) {
          // Make sure compilation does not succeed if preferred macro resolution
          // has changed after the macro had been expanded. In theory all such
          // situations should be reported as errors, so this is a bug.
          this_.dcx().span_delayed_bug(span, "inconsistent resolution for a macro");
        }
      }
    } else if (this_.tcx_.dcx().has_errors() === undefined && this_.privacy_errors.length === 0) {
      // It's possible that the macro was unresolved (indeterminate) and silently
      // expanded into a dummy fragment for recovery during expansion.
      // Now, post-expansion, the resolution may succeed, but we can't change the
      // past and need to report an error.
      // However, non-speculative `resolve_path` can successfully return private items
      // even if speculative `resolve_path` returned nothing previously, so we skip this
      // less informative error if no other error is reported elsewhere.

      const err = this_.dcx().create_err(
        diagnostics.CannotDetermineMacroResolution_diagnostic({
          span,
          kind: MacroKind.descr(kind),
          path: Segment.names_to_string(path),
        }),
      );
      err.stash(span, "UndeterminedMacroResolution");
    }
  };

  const multi_macro_resolutions = this.multi_segment_macro_resolutions.take(this, () => []);
  for (const [path, path_span, kind, parent_scope, initial_res, ns] of multi_macro_resolutions) {
    // FIXME: Path resolution will ICE if segment IDs present.
    for (const seg of path) {
      seg.id = undefined;
    }
    const path_res = this.cm_mut().resolve_path(path, ns, parent_scope, Finalize.new(CRATE_NODE_ID, path_span), undefined, undefined);
    const full_res = path_res.$ === "NonModule" ? path_res._0.full_res() : undefined;
    if (path_res.$ === "NonModule" && full_res !== undefined) {
      check_consistency(this, path, path_span, kind, initial_res, full_res);
    } else if (path_res.$ === "Module" && path_res._0.$ === "Module") {
      // This may be a trait for glob delegation expansions.
      check_consistency(this, path, path_span, kind, initial_res, unwrap(path_res._0._0.res()));
    } else if (path_res.$ === "NonModule" || path_res.$ === "Failed") {
      let suggestion: diagnostics_impls_Suggestion | undefined = undefined;
      let span: Span;
      let message: string;
      let label: string;
      let module: import("./lib.ts").ModuleOrUniformRoot | undefined;
      let segment: Symbol;
      let help: string | undefined;
      if (path_res.$ === "Failed") {
        // try to suggest if it's not a macro, maybe a function
        const partial = this.cm().maybe_resolve_path(path, "ValueNS", parent_scope, undefined);
        if (partial.$ === "NonModule" && partial._0.unresolved_segments() === 0) {
          const partial_res = partial._0;
          const sm = this.tcx_.sess.source_map();
          const exclamation_span = sm.next_point(path_res.span);
          suggestion = [
            [[exclamation_span, ""]],
            `${Segment.names_to_string(path)} is not a macro, but a ${hir_Res.descr(partial_res.base_res())}, try to remove \`!\``,
            "MaybeIncorrect",
          ];
        }
        [span, message, label, module, segment, help] = [path_res.span, path_res.message, path_res.label, path_res.module, path_res.segment.name, path_res.help];
      } else {
        const partial_res = path_res._0;
        const found_an = hir_Res.article(partial_res.base_res());
        const found_descr = hir_Res.descr(partial_res.base_res());
        const prefix = path.slice(0, partial_res.unresolved_segments());
        let scope: string;
        if (prefix.length >= 1) {
          const prev = prefix[prefix.length - 1]!;
          scope = `${found_descr} \`${display_Ident(prev.ident)}\``;
        } else {
          scope = found_descr;
        }
        const expected_an = MacroKind.article(kind);
        const expected_descr = MacroKind.descr(kind);
        const expected_name = path[partial_res.unresolved_segments()]!.ident;

        const base_res = partial_res.base_res();
        [span, message, label, module, segment, help] = [
          path_span,
          `cannot find ${expected_descr} \`${display_Ident(expected_name)}\` in ${scope}`,
          base_res.$ === "Def" && (base_res._0.$ === "Mod" || base_res._0.$ === "Macro" || base_res._0.$ === "ExternCrate")
            ? `partially resolved path in ${expected_an} ${expected_descr}`
            : `${expected_an} ${expected_descr} can't exist within ${found_an} ${found_descr}`,
          undefined,
          path[path.length - 1]!.ident.name,
          undefined,
        ];
      }
      this.report_error(span, {
        $: "FailedToResolve",
        segment,
        label,
        suggestion,
        help,
        module,
        message,
      } satisfies ResolutionError);
    } else {
      return unreachable();
    }
  }

  const single_macro_resolutions = this.single_segment_macro_resolutions.take(this, () => []);
  for (const [ident, kind, parent_scope, initial_binding, sugg_span] of single_macro_resolutions) {
    const r = this.cm_mut().resolve_ident_in_scope_set(ident, { $: "Macro", _0: kind }, parent_scope, Finalize.new(CRATE_NODE_ID, ident.span), undefined, undefined);
    if (r.$ === "Ok") {
      const binding = r._0;
      let initial_res: Res | undefined;
      if (initial_binding !== undefined) {
        this.record_use(ident, initial_binding, "Other");
        initial_res = initial_binding.res();
      } else {
        initial_res = undefined;
      }
      const res = binding.res();
      const seg = Segment.from_ident(ident);
      check_consistency(this, [seg], ident.span, kind, initial_res, res);
      if (res.$ === "NonMacroAttr" && res._0.$ === "DeriveHelperCompat") {
        const parent = this.invocation_parents.get(parent_scope.expansion);
        const node_id = parent === undefined ? CRATE_NODE_ID : this.def_id_to_node_id(parent.parent_def);
        this.lint_buffer_.buffer_lint(LEGACY_DERIVE_HELPERS, node_id, ident.span, diagnostics.LegacyDeriveHelpers_diagnostic({ span: binding.span }));
      }
    } else {
      const expected = MacroKind.descr_expected(kind);

      const err = this.dcx().create_err(
        diagnostics.CannotFindIdentInThisScope_diagnostic({
          span: ident.span,
          expected,
          ident,
        }),
      );
      this.unresolved_macro_suggestions(err, kind, parent_scope, ident, krate, sugg_span);
      err.emit();
    }
  }

  const builtin_attrs = this.builtin_attrs;
  this.builtin_attrs = [];
  for (const [ident, parent_scope] of builtin_attrs) {
    void this.cm_mut().resolve_ident_in_scope_set(ident, { $: "Macro", _0: "Attr" }, parent_scope, Finalize.new(CRATE_NODE_ID, ident.span), undefined, undefined);
  }
};

type diagnostics_impls_Suggestion = import("./diagnostics/impls.gen.ts").Suggestion;

// rustc: compiler/rustc_resolve/src/macros.rs:1079 check_stability_and_deprecation
Resolver.prototype.check_stability_and_deprecation = function (this: Resolver, ext: SyntaxExtension, path: Path, node_id: NodeId): void {
  const span = path.span;
  const stability = ext.stability;
  if (stability !== undefined && stability.level.$ === "Unstable") {
    const { reason, issue, implied_by } = stability.level;
    const feature = stability.feature;

    const is_allowed = (feature: Symbol): boolean => this.features.enabled(feature) || Span.allows_unstable(span, feature);
    const allowed_by_implication = implied_by !== undefined && is_allowed(implied_by);
    if (!is_allowed(feature) && !allowed_by_implication) {
      stability_report_unstable(this.tcx_.sess, feature, UnstableReason.to_opt_reason(reason), issue, span, "Regular");
    }
  }
  if (ext.deprecation !== undefined) {
    const depr = ext.deprecation;
    const path_ = pprust.path_to_string(path);
    stability_early_report_macro_deprecation(this.lint_buffer_, depr, span, node_id, path_);
  }
};

/**
 * PORT: `rustc_middle::middle::stability::report_unstable` (middle/stability.rs is not ported).
 * `kind` is `stability::UnstableKind::Regular`.
 */
function stability_report_unstable(_sess: Session, _feature: Symbol, _reason: Symbol | undefined, _issue: number | undefined, _span: Span, _kind: "Regular"): void {
  unported("rustc_middle::middle::stability::report_unstable (middle/stability.rs)");
}

/** PORT: `rustc_middle::middle::stability::early_report_macro_deprecation` (middle/stability.rs is not ported). */
function stability_early_report_macro_deprecation(_lint_buffer: LintBuffer, _depr: Deprecation, _span: Span, _node_id: NodeId, _path: string): void {
  unported("rustc_middle::middle::stability::early_report_macro_deprecation (middle/stability.rs)");
}

// rustc: compiler/rustc_resolve/src/macros.rs:1117 prohibit_imported_non_macro_attrs
Resolver.prototype.prohibit_imported_non_macro_attrs = function (this: Resolver, decl: Decl | undefined, res: Res | undefined, span: Span): void {
  if (res !== undefined && res.$ === "NonMacroAttr") {
    const kind = res._0;
    if (kind.$ !== "Tool" && (decl === undefined || decl.is_import())) {
      this.dcx().emit_err(
        diagnostics.CannotUseThroughAnImport_diagnostic({
          span,
          article: NonMacroAttrKind.article(kind),
          descr: NonMacroAttrKind.descr(kind),
          binding_span: decl === undefined ? undefined : decl.span,
        }),
      );
    }
  }
};

// rustc: compiler/rustc_resolve/src/macros.rs:1135 report_out_of_scope_macro_calls
Resolver.prototype.report_out_of_scope_macro_calls = function (
  this: Resolver,
  path: Path,
  parent_scope: ParentScope,
  invoc_in_mod_inert_attr: [LocalDefId, NodeId] | undefined,
  decl: Decl | undefined,
): void {
  if (invoc_in_mod_inert_attr === undefined || decl === undefined) return;
  const [mod_def_id, node_id] = invoc_in_mod_inert_attr;
  // This is a `macro_rules` itself, not some import.
  const decl_kind = decl.kind;
  if (decl_kind.$ !== "Def") return;
  const res = decl_kind._0;
  if (!(res.$ === "Def" && res._0.$ === "Macro")) return;
  const kinds = res._0._0;
  const def_id = res._1;
  if (
    MacroKinds.contains(kinds, MacroKinds.BANG) &&
    // And the `macro_rules` is defined inside the attribute's module,
    // so it cannot be in scope unless imported.
    this.tcx_.is_descendant_of(def_id, mod_def_id)
  ) {
    // Try to resolve our ident ignoring `macro_rules` scopes.
    // If such resolution is successful and gives the same result
    // (e.g. if the macro is re-imported), then silence the lint.
    const no_macro_rules = this.arenas.alloc_macro_rules_scope({ $: "Empty" } satisfies MacroRulesScope);
    const ident = path.segments[0]!.ident;
    const fallback_parent_scope = copy_ParentScope(parent_scope);
    fallback_parent_scope.macro_rules = no_macro_rules;
    const fallback_binding = RefOrMut.reborrow(this).resolve_ident_in_scope_set(ident, { $: "Macro", _0: "Bang" }, fallback_parent_scope, undefined, undefined, undefined);
    const fallback_def_id = fallback_binding.$ === "Ok" ? hir_Res.opt_def_id(fallback_binding._0.res()) : undefined;
    if (fallback_binding.$ === "Ok" && fallback_def_id !== undefined && DefId_eq(fallback_def_id, def_id)) {
      // Silence `unused_imports` on the fallback import as well.
      RefOrMut.get_mut(this).record_use(ident, fallback_binding._0, "Other");
    } else {
      let location: string;
      const module_kind = parent_scope.module.kind;
      switch (module_kind.$) {
        case "Def": {
          const name = module_kind._3;
          if (name !== undefined) {
            location = `${DefKind.descr(module_kind._0, module_kind._1)} \`${Symbol.as_str(name)}\``;
          } else {
            location = "the crate root";
          }
          break;
        }
        case "Block":
          location = "this scope";
          break;
      }
      this.tcx_.sess.psess.buffer_lint(
        OUT_OF_SCOPE_MACRO_CALLS,
        path.span,
        node_id,
        diagnostics.OutOfScopeMacroCalls_diagnostic({
          span: path.span,
          path: pprust.path_to_string(path),
          location,
        }),
      );
    }
  }
};

// rustc: compiler/rustc_resolve/src/macros.rs:1195 check_reserved_macro_name
Resolver.prototype.check_reserved_macro_name = function (this: Resolver, name: Symbol, span: Span, res: Res): void {
  // Reserve some names that are not quite covered by the general check
  // performed on `Resolver::builtin_attrs`.
  if (name === sym.cfg || name === sym.cfg_attr) {
    const macro_kinds = hir_Res.macro_kinds(res);
    if (macro_kinds !== undefined && sub_namespace_match(macro_kinds, "Attr")) {
      this.dcx().emit_err(diagnostics.NameReservedInAttributeNamespace_diagnostic({ span, ident: name }));
    }
  }
};

/// Compile the macro into a `SyntaxExtension` and its rule spans.
///
/// Possibly replace its expander to a pre-defined one for built-in macros.
// rustc: compiler/rustc_resolve/src/macros.rs:1210 compile_macro
Resolver.prototype.compile_macro = function (
  this: Resolver,
  macro_def: MacroDef,
  ident: Ident,
  attrs: readonly HirAttribute[],
  span: Span,
  node_id: NodeId,
  edition: Edition,
): SyntaxExtension {
  const ext = compile_declarative_macro(this.tcx_.sess, this.features, macro_def, ident, attrs, span, node_id, edition);

  if (ext.builtin_name !== undefined) {
    const builtin_name = ext.builtin_name;
    // The macro was marked with `#[rustc_builtin_macro]`.
    const builtin_ext_kind = this.builtin_macros.get(builtin_name);
    if (builtin_ext_kind !== undefined) {
      // The macro is a built-in, replace its expander function
      // while still taking everything else from the source code.
      ext.kind = clone_SyntaxExtensionKind(builtin_ext_kind);
    } else {
      this.dcx().emit_err(diagnostics.CannotFindBuiltinMacroWithName_diagnostic({ span, ident }));
    }
  }

  return ext;
};

// rustc: compiler/rustc_resolve/src/macros.rs:1244 path_accessible
Resolver.prototype.path_accessible = function (this: Resolver, expn_id: LocalExpnId, path_: Path, namespaces: readonly Namespace[]): Result<boolean, Indeterminate> {
  const span = path_.span;
  const path = Segment.from_path(path_);
  const parent_scope = copy_ParentScope(index_map(this.invocation_parent_scopes, expn_id));

  let indeterminate = false;
  for (const ns of namespaces) {
    const r = this.cm().maybe_resolve_path(path, ns, parent_scope, undefined);
    if (r.$ === "Module" && r._0.$ === "Module") {
      return Ok(true);
    } else if (r.$ === "NonModule" && r._0.unresolved_segments() === 0) {
      return Ok(true);
    } else if (
      r.$ === "NonModule" ||
      // HACK(Urgau): This shouldn't be necessary
      (r.$ === "Failed" && !r.is_error_from_last_segment)
    ) {
      this.dcx().emit_err(diagnostics.CfgAccessibleUnsure_diagnostic({ span }));

      // If we get a partially resolved NonModule in one namespace, we should get the
      // same result in any other namespaces, so we can return early.
      return Ok(false);
    } else if (r.$ === "Indeterminate") {
      indeterminate = true;
    } else if (r.$ === "Failed") {
      // We can only be sure that a path doesn't exist after having tested all the
      // possibilities, only at that time we can return false.
    } else {
      return panic("unexpected path resolution");
    }
  }

  if (indeterminate) {
    return Err(Indeterminate);
  }

  return Ok(false);
};
