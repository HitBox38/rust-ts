// Port of compiler/rustc_resolve/src/ident.rs
//
// The `impl Resolver` methods of this file are declared in ./decls.ts (the contract,
// docs/handoff/res-lib.md) and assigned onto `Resolver.prototype` below, in upstream order.
// Init order: top-level code here touches only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_resolve export (lib.ts, imports.ts, late.ts, macros.ts, diagnostics) is read
// inside function bodies only.
//
// PORT (conventions of this file):
// - `CmResolver` is the `Resolver` itself (lib.ts `mod ref_mut`): `self.reborrow()` / `self.get_mut()`
//   are `RefOrMut.reborrow(this)` / `RefOrMut.get_mut(this)`.
// - `ControlFlow<B, C>` is rustc_ast_ir's `ControlFlow` (`Continue(())` = `ControlFlow.CONTINUE`).
// - Struct update syntax on the `Copy` structs `Finalize` and `ParentScope` (`Finalize { used, ..f }`)
//   builds a new object (`finalize_with`, `parent_scope_with`); `*parent_scope` copies are clones.
// - `#[instrument]` / `debug!` (tracing) are kept as comments.
import { clone_Expr, clone_ItemKind, DUMMY_NODE_ID, ItemKind, type NodeId } from "../rustc_ast/lib.ts";
import { debug_NodeId } from "../rustc_ast/node_id.ts";
import { ControlFlow } from "../rustc_ast_ir/visit.ts";
import { debug_Res, MacroKinds, Namespace, type PerNS, Res as def_Res, Res_eq } from "../rustc_hir/def.ts";
import { PROC_MACRO_DERIVE_RESOLUTION_FALLBACK } from "../rustc_lint_defs/builtin.gen.ts";
import { PartialRes } from "../rustc_middle/middle/resolve.ts";
import { type Visibility, Visibility_eq } from "../rustc_middle/ty/mod.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { DefId_eq, type LocalModId } from "../rustc_span/def_id.ts";
import { Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import { ExpnId, ExpnId_eq, LocalExpnId, type MacroKind, SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Ident, Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { debug_vec, PLAIN } from "../std/fmt.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { KeyedMap } from "../rust_ts/keyed.ts";
import { Resolver } from "./decls.ts";
import * as diagnostics from "./diagnostics/mod.ts";
import * as gen from "./ident.gen.ts";
import { ActiveResolutionGuard_drop, enter_cycle_detector, type Import, type NameResolution, PendingDecl } from "./imports.ts";
import { ConstantItemKind, type DiagMetadata, PathSource, type Rib, RibKind } from "./late.ts";
import {
  type AmbiguityKind,
  clone_Finalize,
  clone_IdentKey,
  clone_ParentScope,
  type CmResolver,
  type Decl,
  debug_Segment,
  Determinacy,
  type ExternModule,
  type Finalize,
  IdentKey,
  IdentKey_eq,
  type ImportSummary,
  type LateDecl,
  type LocalModule,
  Macros20NormalizedSyntaxContext,
  type Module,
  type ModuleOrUniformRoot,
  ParentScope,
  PathResult,
  RefOrMut,
  type Res,
  type ResolutionError,
  type Scope,
  type ScopeSet,
  type Segment,
  BindingKey,
  module_to_string,
  Scope as ScopeC,
  ModuleOrUniformRoot as ModuleOrUniformRootC,
} from "./lib.ts";
import { type MacroRulesDecl, type MacroRulesScope, sub_namespace_match } from "./macros.ts";

export * from "./ident.gen.ts";

// PORT(decls): pending root. `Resolver::is_accessible_from(vis: Visibility<impl Into<ModId>>, ..)`
// (lib.rs:2442) also takes the `Visibility<LocalModId>` of imports (`ImportData::vis`); decls.ts
// declares only `Visibility<ModId>` (lib.ts's implementation accepts both).
declare module "./decls.ts" {
  interface Resolver {
    is_accessible_from(vis: Visibility<LocalModId>, module: Module): boolean;
  }
}

export type UsePrelude = gen.UsePrelude;
export const UsePrelude = {
  ...gen.UsePrelude,

  // impl From<UsePrelude> for bool
  // PORT: `bool::from(up)` / `up.into()` -> `UsePrelude.bool_from(up)`.
  // rustc: compiler/rustc_resolve/src/ident.rs:39 from
  bool_from(up: UsePrelude): boolean {
    return up === "Yes";
  },
};

type Shadowing = gen.Shadowing;

/** PORT: `Finalize { <patch>, ..f }` (`Finalize` is `Copy`). */
function finalize_with(f: Finalize, patch: Partial<Pick<Finalize, "used" | "stage">>): Finalize {
  const r = clone_Finalize(f);
  if (patch.used !== undefined) r.used = patch.used;
  if (patch.stage !== undefined) r.stage = patch.stage;
  return r;
}

/** PORT: `ParentScope { <patch>, ..*parent_scope }` (`ParentScope` is `Copy`). */
function parent_scope_with(p: ParentScope, patch: { module?: Module; derives?: ParentScope["derives"] }): ParentScope {
  const r = clone_ParentScope(p);
  if (patch.module !== undefined) r.module = patch.module;
  if (patch.derives !== undefined) r.derives = patch.derives;
  return r;
}

/** `ControlFlow::Continue(d)` / `ControlFlow::Break(d)` as `ControlFlow<Determinacy, Determinacy>`. */
function cf_continue(d: Determinacy): ControlFlow<Determinacy, Determinacy> {
  return ControlFlow.Continue(d);
}
function cf_break(d: Determinacy): ControlFlow<Determinacy, Determinacy> {
  return ControlFlow.Break(d);
}

/** `ControlFlow<Determinacy, Determinacy>::into_value`. */
function into_value(cf: ControlFlow<Determinacy, Determinacy>): Determinacy {
  return cf._0;
}

/// A generic scope visitor.
/// Visits scopes in order to resolve some identifier in them or perform other actions.
/// If the callback returns `Some` result, we stop visiting scopes and return it.
// rustc: compiler/rustc_resolve/src/ident.rs:54 visit_scopes
Resolver.prototype.visit_scopes = function <T>(
  this: CmResolver,
  scope_set: ScopeSet,
  parent_scope: ParentScope,
  ctxt_: Macros20NormalizedSyntaxContext,
  orig_ident_span: Span,
  derive_fallback_lint_id: NodeId | undefined,
  visitor: (this_: CmResolver, _1: Scope, _2: UsePrelude, _3: Macros20NormalizedSyntaxContext) => ControlFlow<T>,
): T | undefined {
  // PORT: `mut ctxt` is passed as `&mut ctxt` to `hygienic_lexical_parent`: a box.
  const ctxt: MutRef<Macros20NormalizedSyntaxContext> = { value: ctxt_ };
  // General principles:
  // 1. Not controlled (user-defined) names should have higher priority than controlled names
  //    built into the language or standard library. This way we can add new names into the
  //    language or standard library without breaking user code.
  // 2. "Closed set" below means new names cannot appear after the current resolution attempt.
  // Places to search (in order of decreasing priority):
  // (Type NS)
  // 1. FIXME: Ribs (type parameters), there's no necessary infrastructure yet
  //    (open set, not controlled).
  // 2. Names in modules (both normal `mod`ules and blocks), loop through hygienic parents
  //    (open, not controlled).
  // 3. Extern prelude (open, the open part is from macro expansions, not controlled).
  // 4. Tool modules (closed, controlled right now, but not in the future).
  // 5. Standard library prelude (de-facto closed, controlled).
  // 6. Language prelude (closed, controlled).
  // (Value NS)
  // 1. FIXME: Ribs (local variables), there's no necessary infrastructure yet
  //    (open set, not controlled).
  // 2. Names in modules (both normal `mod`ules and blocks), loop through hygienic parents
  //    (open, not controlled).
  // 3. Standard library prelude (de-facto closed, controlled).
  // (Macro NS)
  // 1-3. Derive helpers (open, not controlled). All ambiguities with other names
  //    are currently reported as errors. They should be higher in priority than preludes
  //    and probably even names in modules according to the "general principles" above. They
  //    also should be subject to restricted shadowing because are effectively produced by
  //    derives (you need to resolve the derive first to add helpers into scope), but they
  //    should be available before the derive is expanded for compatibility.
  //    It's mess in general, so we are being conservative for now.
  // 1-3. `macro_rules` (open, not controlled), loop through `macro_rules` scopes. Have higher
  //    priority than prelude macros, but create ambiguities with macros in modules.
  // 1-3. Names in modules (both normal `mod`ules and blocks), loop through hygienic parents
  //    (open, not controlled). Have higher priority than prelude macros, but create
  //    ambiguities with `macro_rules`.
  // 4. `macro_use` prelude (open, the open part is from macro expansions, not controlled).
  // 4a. User-defined prelude from macro-use
  //    (open, the open part is from macro expansions, not controlled).
  // 4b. "Standard library prelude" part implemented through `macro-use` (closed, controlled).
  // 4c. Standard library prelude (de-facto closed, controlled).
  // 6. Language prelude: builtin attributes (closed, controlled).

  let ns: Namespace;
  let macro_kind: MacroKind | undefined;
  switch (scope_set.$) {
    case "All":
    case "Module":
    case "ModuleAndExternPrelude":
      [ns, macro_kind] = [scope_set._0, undefined];
      break;
    case "ExternPrelude":
      [ns, macro_kind] = ["TypeNS", undefined];
      break;
    case "Macro":
      [ns, macro_kind] = ["MacroNS", scope_set._0];
      break;
  }
  let module: Module;
  switch (scope_set.$) {
    // Start with the specified module.
    case "Module":
    case "ModuleAndExternPrelude":
      module = scope_set._1;
      break;
    // Jump out of trait or enum modules, they do not act as scopes.
    default:
      module = parent_scope.module.nearest_item_scope();
  }
  const module_only = scope_set.$ === "Module";
  const module_and_extern_prelude = scope_set.$ === "ModuleAndExternPrelude";
  const extern_prelude = scope_set.$ === "ExternPrelude";
  let scope: Scope;
  if (module_only || module_and_extern_prelude) {
    scope = { $: "ModuleNonGlobs", _0: module, _1: undefined };
  } else if (extern_prelude) {
    scope = ScopeC.ExternPreludeItems;
  } else if (ns === "TypeNS" || ns === "ValueNS") {
    scope = { $: "ModuleNonGlobs", _0: module, _1: undefined };
  } else {
    scope = { $: "DeriveHelpers", _0: parent_scope.expansion };
  }
  let use_prelude = !module.no_implicit_prelude;

  for (;;) {
    let visit: boolean;
    switch (scope.$) {
      // Derive helpers are not in scope when resolving derives in the same container.
      case "DeriveHelpers": {
        const expn_id = scope._0;
        visit = !(expn_id === parent_scope.expansion && macro_kind === "Derive");
        break;
      }
      case "DeriveHelpersCompat":
        visit = true;
        break;
      case "MacroRules": {
        const macro_rules_scope = scope._0;
        // Use "path compression" on `macro_rules` scope chains. This is an optimization
        // used to avoid long scope chains, see the comments on `MacroRulesScopeRef`.
        // As another consequence of this optimization visitors never observe invocation
        // scopes for macros that were already expanded.
        // We need to lock this scope, such that the compression is always final.
        const write_scope = macro_rules_scope; // `.write()`
        let scope_: MacroRulesScope = write_scope.value;
        while (scope_.$ === "Invocation") {
          const invoc_id = scope_._0;
          const next = this.output_macro_rules_scopes.get(invoc_id);
          if (next !== undefined) {
            scope_ = next.value; // `*next.borrow()`
            write_scope.value = scope_;
          } else {
            break;
          }
        }
        visit = true;
        break;
      }
      case "ModuleNonGlobs":
      case "ModuleGlobs":
        visit = true;
        break;
      case "MacroUsePrelude":
        visit = use_prelude || Span.is_rust_2015(orig_ident_span);
        break;
      case "BuiltinAttrs":
        visit = true;
        break;
      case "ExternPreludeItems":
      case "ExternPreludeFlags":
        visit = use_prelude || module_and_extern_prelude || extern_prelude;
        break;
      case "ToolAttributePrelude":
        visit = use_prelude;
        break;
      case "StdLibPrelude":
        visit = use_prelude || ns === "MacroNS";
        break;
      case "BuiltinTypes":
        visit = true;
        break;
    }

    if (visit) {
      const use_prelude_: UsePrelude = use_prelude ? "Yes" : "No";
      const r = visitor(RefOrMut.reborrow(this), scope, use_prelude_, ctxt.value);
      if (r.$ === "Break") {
        return r._0;
      }
    }

    switch (scope.$) {
      case "DeriveHelpers": {
        const expn_id = scope._0;
        if (expn_id === LocalExpnId.ROOT) {
          scope = ScopeC.DeriveHelpersCompat;
          break;
        }
        // Derive helpers are not visible to code generated by bang or derive macros.
        const expn_data = LocalExpnId.expn_data(expn_id);
        const kind = expn_data.kind;
        if (kind.$ === "Root" || (kind.$ === "Macro" && (kind._0 === "Bang" || kind._0 === "Derive"))) {
          scope = ScopeC.DeriveHelpersCompat;
        } else {
          scope = { $: "DeriveHelpers", _0: expn_data.parent.expect_local() };
        }
        break;
      }
      case "DeriveHelpersCompat":
        scope = { $: "MacroRules", _0: parent_scope.macro_rules };
        break;
      case "MacroRules": {
        const s: MacroRulesScope = scope._0.value; // `*macro_rules_scope.read()`
        switch (s.$) {
          case "Def": {
            const binding: MacroRulesDecl = s._0;
            scope = { $: "MacroRules", _0: binding.parent_macro_rules_scope };
            break;
          }
          case "Invocation": {
            const invoc_id = s._0;
            const p = this.invocation_parent_scopes.get(invoc_id);
            if (p === undefined) return panic("key not found"); // `map[&key]`
            scope = { $: "MacroRules", _0: p.macro_rules };
            break;
          }
          case "Empty":
            scope = { $: "ModuleNonGlobs", _0: module, _1: undefined };
            break;
        }
        break;
      }
      case "ModuleNonGlobs":
        scope = { $: "ModuleGlobs", _0: scope._0, _1: scope._1 };
        break;
      case "ModuleGlobs": {
        if (module_only) {
          return undefined; // `break`
        }
        if (module_and_extern_prelude) {
          switch (ns) {
            case "TypeNS":
              Macros20NormalizedSyntaxContext.update_unchecked(ctxt, (ctxt) => SyntaxContext.adjust(ctxt, ExpnId.root()));
              scope = ScopeC.ExternPreludeItems;
              break;
            case "ValueNS":
            case "MacroNS":
              return undefined; // `break`
          }
          break;
        }
        const module_: Module = scope._0;
        const prev_lint_id: NodeId | undefined = scope._1;
        use_prelude = !module_.no_implicit_prelude;
        const parent = this.hygienic_lexical_parent(module_, ctxt, derive_fallback_lint_id);
        if (parent !== undefined) {
          const [parent_module, lint_id] = parent;
          scope = { $: "ModuleNonGlobs", _0: parent_module, _1: lint_id ?? prev_lint_id };
        } else {
          Macros20NormalizedSyntaxContext.update_unchecked(ctxt, (ctxt) => SyntaxContext.adjust(ctxt, ExpnId.root()));
          switch (ns) {
            case "TypeNS":
              scope = ScopeC.ExternPreludeItems;
              break;
            case "ValueNS":
              scope = ScopeC.StdLibPrelude;
              break;
            case "MacroNS":
              scope = ScopeC.MacroUsePrelude;
              break;
          }
        }
        break;
      }
      case "MacroUsePrelude":
        scope = ScopeC.StdLibPrelude;
        break;
      case "BuiltinAttrs":
        return undefined; // nowhere else to search
      case "ExternPreludeItems":
        scope = ScopeC.ExternPreludeFlags;
        break;
      case "ExternPreludeFlags":
        if (module_and_extern_prelude || extern_prelude) {
          return undefined; // `break`
        }
        scope = ScopeC.ToolAttributePrelude;
        break;
      case "ToolAttributePrelude":
        scope = ScopeC.StdLibPrelude;
        break;
      case "StdLibPrelude":
        switch (ns) {
          case "TypeNS":
            scope = ScopeC.BuiltinTypes;
            break;
          case "ValueNS":
            return undefined; // nowhere else to search
          case "MacroNS":
            scope = ScopeC.BuiltinAttrs;
            break;
        }
        break;
      case "BuiltinTypes":
        return undefined; // nowhere else to search
    }
  }
};

// rustc: compiler/rustc_resolve/src/ident.rs:244 hygienic_lexical_parent
Resolver.prototype.hygienic_lexical_parent = function (
  this: Resolver,
  module: Module,
  ctxt: MutRef<Macros20NormalizedSyntaxContext>,
  derive_fallback_lint_id: NodeId | undefined,
): [Module, NodeId | undefined] | undefined {
  if (!module.expansion.outer_expn_is_descendant_of(ctxt.value)) {
    const expn_id = Macros20NormalizedSyntaxContext.update_unchecked(ctxt, (ctxt) => SyntaxContext.remove_mark(ctxt));
    return [this.expn_def_scope(expn_id), undefined];
  }

  if (module.kind.$ === "Block") {
    return [unwrap(module.parent).nearest_item_scope(), undefined];
  }

  // We need to support the next case under a deprecation warning
  // ```
  // struct MyStruct;
  // ---- begin: this comes from a proc macro derive
  // mod implementation_details {
  //     // Note that `MyStruct` is not in scope here.
  //     impl SomeTrait for MyStruct { ... }
  // }
  // ---- end
  // ```
  // So we have to fall back to the module's parent during lexical resolution in this case.
  let parent: Module | undefined;
  let def_id;
  if (
    derive_fallback_lint_id !== undefined &&
    (parent = module.parent) !== undefined &&
    // Inner module is inside the macro
    !ExpnId_eq(module.expansion, parent.expansion) &&
    // Parent module is outside of the macro
    module.expansion.is_descendant_of(parent.expansion) &&
    // The macro is a proc macro derive
    (def_id = module.expansion.expn_data().macro_def_id) !== undefined
  ) {
    const ext = this.get_macro_by_def_id(def_id);
    if (ext.builtin_name === undefined && ext.macro_kinds() === MacroKinds.DERIVE && parent.expansion.outer_expn_is_descendant_of(ctxt.value)) {
      return [parent, derive_fallback_lint_id];
    }
  }

  return undefined;
};

/// This resolves the identifier `ident` in the namespace `ns` in the current lexical scope.
/// More specifically, we proceed up the hierarchy of scopes and return the binding for
/// `ident` in the first scope that defines it (or None if no scopes define it).
///
/// A block's items are above its local variables in the scope hierarchy, regardless of where
/// the items are defined in the block. For example,
/// ```rust
/// fn f() {
///    g(); // Since there are no local variables in scope yet, this resolves to the item.
///    let g = || {};
///    fn g() {}
///    g(); // This resolves to the local variable `g` since it shadows the item.
/// }
/// ```
///
/// Invariant: This must only be called during main resolution, not during
/// import resolution.
// #[instrument(level = "debug", skip(self, ribs))]
// rustc: compiler/rustc_resolve/src/ident.rs:309 resolve_ident_in_lexical_scope
Resolver.prototype.resolve_ident_in_lexical_scope = function (
  this: Resolver,
  ident_: Ident,
  ns: Namespace,
  parent_scope: ParentScope,
  finalize: Finalize | undefined,
  ribs: readonly Rib[],
  ignore_decl: Decl | undefined,
  diag_metadata: DiagMetadata | undefined,
): LateDecl | undefined {
  // PORT: `mut ident: Ident` is a by-value copy that is mutated below.
  const ident = Ident.new(ident_.name, ident_.span);
  const orig_ident = Ident.new(ident.name, ident.span);
  let general_span: Span;
  let normalized_span: Span;
  if (ident.name === kw.SelfUpper) {
    // FIXME(jseyfried) improve `Self` hygiene
    const empty_span = Span.with_ctxt(ident.span, SyntaxContext.root());
    [general_span, normalized_span] = [empty_span, empty_span];
  } else if (ns === "TypeNS") {
    const normalized_span_ = Span.normalize_to_macros_2_0(ident.span);
    [general_span, normalized_span] = [normalized_span_, normalized_span_];
  } else {
    [general_span, normalized_span] = [Span.normalize_to_macro_rules(ident.span), Span.normalize_to_macros_2_0(ident.span)];
  }
  ident.span = general_span;
  const normalized_ident = Ident.new(ident.name, normalized_span);

  // Walk backwards up the ribs in scope.
  for (let i = ribs.length - 1; i >= 0; i--) {
    const rib = ribs[i]!;
    // debug!("walk rib\n{:?}", rib.bindings);
    // Use the rib kind to determine whether we are resolving parameters
    // (macro 2.0 hygiene) or local variables (`macro_rules` hygiene).
    const rib_ident = RibKind.contains_params(rib.kind) ? normalized_ident : ident;
    // PORT: `rib.bindings` is a `KeyedMap` (Ident_key); `get_key_value` is `stored_key` + `get`.
    const bindings = rib.bindings as KeyedMap<Ident, Res>;
    const original_rib_ident_def = bindings.stored_key(rib_ident);
    let module: LocalModule | undefined;
    let binding: Result<Decl, Determinacy> | undefined;
    if (original_rib_ident_def !== undefined) {
      const res = bindings.get(original_rib_ident_def)!;
      // The ident resolves to a type parameter or local variable.
      return {
        $: "RibDef",
        _0: this.validate_res_from_ribs(
          i,
          rib_ident,
          res,
          finalize !== undefined ? general_span : undefined,
          original_rib_ident_def,
          ribs,
          diag_metadata,
        ),
      };
    } else if (
      rib.kind.$ === "Block" &&
      (module = rib.kind._0) !== undefined &&
      (binding = this.cm_mut().resolve_ident_in_scope_set(
        ident,
        { $: "Module", _0: ns, _1: module.to_module() },
        parent_scope,
        finalize !== undefined ? finalize_with(finalize, { used: "Scope" }) : undefined,
        ignore_decl,
        undefined,
      )).$ === "Ok"
    ) {
      // The ident resolves to an item in a block.
      return { $: "Decl", _0: binding._0 };
    } else if (rib.kind.$ === "Module") {
      const module = rib.kind._0;
      // Encountered a module item, abandon ribs and look into that module and preludes.
      const parent_scope_ = parent_scope_with(parent_scope, { module: module.to_module() });
      const finalize_ = finalize !== undefined ? finalize_with(finalize, { stage: "Late" }) : undefined;
      const r = this.cm_mut().resolve_ident_in_scope_set(orig_ident, { $: "All", _0: ns }, parent_scope_, finalize_, ignore_decl, undefined);
      return r.$ === "Ok" ? { $: "Decl", _0: r._0 } : undefined;
    }

    if (rib.kind.$ === "MacroDefinition" && DefId_eq(rib.kind._0, this.macro_def(Span.ctxt(ident.span)))) {
      // If an invocation of this macro created `ident`, give up on `ident`
      // and switch to `ident`'s source from the macro definition.
      Span.remove_mark(field_mut(ident, "span"));
    }
  }

  return unreachable();
};

/// Resolve an identifier in the specified set of scopes.
// rustc: compiler/rustc_resolve/src/ident.rs:393 resolve_ident_in_scope_set
Resolver.prototype.resolve_ident_in_scope_set = function (
  this: CmResolver,
  orig_ident: Ident,
  scope_set: ScopeSet,
  parent_scope: ParentScope,
  finalize: Finalize | undefined,
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
): Result<Decl, Determinacy> {
  return this.resolve_ident_in_scope_set_inner(
    IdentKey.new(orig_ident),
    orig_ident.span,
    scope_set,
    parent_scope,
    finalize,
    ignore_decl,
    ignore_import,
  );
};

// rustc: compiler/rustc_resolve/src/ident.rs:413 resolve_ident_in_scope_set_inner
Resolver.prototype.resolve_ident_in_scope_set_inner = function (
  this: CmResolver,
  ident: IdentKey,
  orig_ident_span: Span,
  scope_set: ScopeSet,
  parent_scope: ParentScope,
  finalize: Finalize | undefined,
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
): Result<Decl, Determinacy> {
  // Make sure `self`, `super` etc produce an error when passed to here.
  if (Symbol.is_path_segment_keyword(ident.name)) {
    return Err("Determined");
  }

  let ns: Namespace;
  let macro_kind: MacroKind | undefined;
  switch (scope_set.$) {
    case "All":
    case "Module":
    case "ModuleAndExternPrelude":
      [ns, macro_kind] = [scope_set._0, undefined];
      break;
    case "ExternPrelude":
      [ns, macro_kind] = ["TypeNS", undefined];
      break;
    case "Macro":
      [ns, macro_kind] = ["MacroNS", scope_set._0];
      break;
  }
  const derive_fallback_lint_id = finalize !== undefined && finalize.stage === "Late" ? finalize.node_id : undefined;

  // This is *the* result, resolution from the scope closest to the resolved identifier.
  // However, sometimes this result is "weak" because it comes from a glob import or
  // a macro expansion, and in this case it cannot shadow names from outer scopes, e.g.
  // mod m { ... } // solution in outer scope
  // {
  //     use prefix::*; // imports another `m` - innermost solution
  //                    // weak, cannot shadow the outer `m`, need to report ambiguity error
  //     m::mac!();
  // }
  // So we have to save the innermost solution and continue searching in outer scopes
  // to detect potential ambiguities.
  const innermost_results: [Decl, Scope][] = [];
  let determinacy: Determinacy = "Determined";

  // Go through all the scopes and try to resolve the name.
  const break_result = this.visit_scopes<Result<Decl, Determinacy>>(
    scope_set,
    parent_scope,
    ident.ctxt,
    orig_ident_span,
    derive_fallback_lint_id,
    (this_, scope, use_prelude, ctxt) => {
      const ident_ = new IdentKey(ident.name, ctxt);
      const r = RefOrMut.reborrow(this_).resolve_ident_in_scope(
        ident_,
        orig_ident_span,
        ns,
        scope,
        use_prelude,
        scope_set,
        parent_scope,
        // Shadowed decls don't need to be marked as used or non-speculatively loaded.
        innermost_results.length === 0 ? finalize : undefined,
        ignore_decl,
        ignore_import,
      );
      let res: Result<Decl, Determinacy>;
      if (r.$ === "Ok") {
        res = Ok(r._0);
      } else if (r._0.$ === "Break" && innermost_results.length === 0) {
        // We can break with an error at this step, it means we cannot determine the
        // resolution right now, but we must block and wait until we can, instead of
        // considering outer scopes. Although there's no need to do that if we already
        // have a better solution.
        return ControlFlow.Break(Err(r._0._0));
      } else {
        res = Err(into_value(r._0));
      }
      if (res.$ === "Ok" && sub_namespace_match(res._0.macro_kinds(), macro_kind)) {
        const decl = res._0;
        // Below we report various ambiguity errors.
        // We do not need to report them if we are either in speculative resolution,
        // or in late resolution when everything is already imported and expanded
        // and no ambiguities exist.
        if (finalize === undefined || finalize.stage === "Late") {
          return ControlFlow.Break(Ok(decl));
        }
        const import_ = finalize.import;
        RefOrMut.get_mut(this_).maybe_push_glob_vs_glob_vis_ambiguity(ident_, orig_ident_span, decl, import_);

        const first = innermost_results[0];
        if (first !== undefined) {
          const innermost_decl = first[0];
          // Found another solution, if the first one was "weak", report an error.
          if (
            RefOrMut.get_mut(this_).maybe_push_ambiguity(
              ident_,
              orig_ident_span,
              ns,
              scope_set,
              parent_scope,
              decl,
              scope,
              innermost_results,
              import_,
            )
          ) {
            // No need to search for more potential ambiguities, one is enough.
            return ControlFlow.Break(Ok(innermost_decl));
          }
        }

        innermost_results.push([decl, scope]);
      } else if (res.$ === "Ok" || res._0 === "Determined") {
        // `Ok(_) | Err(Determinacy::Determined) => {}`
      } else {
        determinacy = "Undetermined";
      }

      return ControlFlow.CONTINUE;
    },
  );

  // Scope visiting returned some result early.
  if (break_result !== undefined) {
    return break_result;
  }

  // Scope visiting walked all the scopes and maybe found something in one of them.
  const first = innermost_results[0];
  if (first !== undefined) {
    return Ok(first[0]);
  }
  return Err(determinacy);
};

// rustc: compiler/rustc_resolve/src/ident.rs:545 resolve_ident_in_scope
Resolver.prototype.resolve_ident_in_scope = function (
  this: CmResolver,
  ident: IdentKey,
  orig_ident_span: Span,
  ns: Namespace,
  scope: Scope,
  use_prelude: UsePrelude,
  scope_set: ScopeSet,
  parent_scope: ParentScope,
  finalize: Finalize | undefined,
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
): Result<Decl, ControlFlow<Determinacy, Determinacy>> {
  let ret: Result<Decl, Determinacy>;
  switch (scope.$) {
    case "DeriveHelpers": {
      const expn_id = scope._0;
      const attrs = this.helper_attrs.get(expn_id);
      const found = attrs === undefined ? undefined : attrs.findLast(([i]) => IdentKey_eq(ident, i));
      const decl = found === undefined ? undefined : found[2];
      if (decl !== undefined) {
        ret = Ok(decl);
      } else {
        ret = Err("Determined");
      }
      break;
    }
    case "DeriveHelpersCompat": {
      let result: Result<Decl, Determinacy> = Err("Determined");
      for (const derive of parent_scope.derives) {
        const parent_scope_ = parent_scope_with(parent_scope, { derives: [] });
        const r = RefOrMut.reborrow(this).resolve_derive_macro_path(derive, parent_scope_, false, ignore_import);
        if (r.$ === "Ok" && r._0[0] !== undefined) {
          const ext = r._0[0];
          if (ext.helper_attrs.includes(ident.name)) {
            const decl = this.arenas.new_pub_def_decl(
              { $: "NonMacroAttr", _0: { $: "DeriveHelperCompat" } },
              derive.span,
              LocalExpnId.ROOT,
            );
            result = Ok(decl);
            break;
          }
        } else if (r.$ === "Ok" || r._0 === "Determined") {
          // `Ok(_) | Err(Determinacy::Determined) => {}`
        } else {
          result = Err("Undetermined");
        }
      }
      ret = result;
      break;
    }
    case "MacroRules": {
      const s = scope._0.value; // `*macro_rules_scope.read()`
      if (s.$ === "Def" && IdentKey_eq(ident, s._0.ident)) {
        ret = Ok(s._0.decl);
      } else if (s.$ === "Invocation") {
        ret = Err("Undetermined");
      } else {
        ret = Err("Determined");
      }
      break;
    }
    case "ModuleNonGlobs": {
      const module = scope._0;
      const derive_fallback_lint_id = scope._1;
      let adjusted_parent_scope: ParentScope;
      let adjusted_finalize: Finalize | undefined;
      if (scope_set.$ === "Module" || scope_set.$ === "ModuleAndExternPrelude") {
        [adjusted_parent_scope, adjusted_finalize] = [parent_scope, finalize];
      } else {
        [adjusted_parent_scope, adjusted_finalize] = [
          parent_scope_with(parent_scope, { module }),
          finalize !== undefined ? finalize_with(finalize, { used: "Scope" }) : undefined,
        ];
      }
      const shadowing: Shadowing = scope_set.$ === "Module" ? "Unrestricted" : "Restricted";
      let decl: Result<Decl, ControlFlow<Determinacy, Determinacy>>;
      if (module.is_local()) {
        decl = RefOrMut.reborrow(this).resolve_ident_in_local_module_non_globs_unadjusted(
          module.expect_local(),
          ident,
          orig_ident_span,
          ns,
          adjusted_parent_scope,
          shadowing,
          adjusted_finalize,
          ignore_decl,
          ignore_import,
        );
      } else {
        decl = RefOrMut.reborrow(this).resolve_ident_in_extern_module_non_globs_unadjusted(
          module.expect_extern(),
          ident,
          orig_ident_span,
          ns,
          adjusted_parent_scope,
          shadowing,
          adjusted_finalize,
          ignore_decl,
        );
      }

      if (decl.$ === "Ok") {
        if (derive_fallback_lint_id !== undefined) {
          const lint_id = derive_fallback_lint_id;
          RefOrMut.get_mut(this).lint_buffer_.buffer_lint(
            PROC_MACRO_DERIVE_RESOLUTION_FALLBACK,
            lint_id,
            orig_ident_span,
            diagnostics.ProcMacroDeriveResolutionFallback_diagnostic({
              span: orig_ident_span,
              ns_descr: Namespace.descr(ns),
              ident: ident.name,
            }),
          );
        }
        ret = Ok(decl._0);
      } else if (decl._0.$ === "Continue") {
        ret = Err(decl._0._0);
      } else {
        return decl;
      }
      break;
    }
    case "ModuleGlobs": {
      const module = scope._0;
      if (!module.is_local()) {
        // Fast path: external module decoding only creates non-glob declarations.
        ret = Err("Determined");
        break;
      }
      const derive_fallback_lint_id = scope._1;
      let adjusted_parent_scope: ParentScope;
      let adjusted_finalize: Finalize | undefined;
      if (scope_set.$ === "Module" || scope_set.$ === "ModuleAndExternPrelude") {
        [adjusted_parent_scope, adjusted_finalize] = [parent_scope, finalize];
      } else {
        [adjusted_parent_scope, adjusted_finalize] = [
          parent_scope_with(parent_scope, { module }),
          finalize !== undefined ? finalize_with(finalize, { used: "Scope" }) : undefined,
        ];
      }
      const binding = RefOrMut.reborrow(this).resolve_ident_in_module_globs_unadjusted(
        module.expect_local(),
        ident,
        orig_ident_span,
        ns,
        adjusted_parent_scope,
        scope_set.$ === "Module" ? "Unrestricted" : "Restricted",
        adjusted_finalize,
        ignore_decl,
        ignore_import,
      );
      if (binding.$ === "Ok") {
        if (derive_fallback_lint_id !== undefined) {
          const lint_id = derive_fallback_lint_id;
          RefOrMut.get_mut(this).lint_buffer_.buffer_lint(
            PROC_MACRO_DERIVE_RESOLUTION_FALLBACK,
            lint_id,
            orig_ident_span,
            diagnostics.ProcMacroDeriveResolutionFallback_diagnostic({
              span: orig_ident_span,
              ns_descr: Namespace.descr(ns),
              ident: ident.name,
            }),
          );
        }
        ret = Ok(binding._0);
      } else if (binding._0.$ === "Continue") {
        ret = Err(binding._0._0);
      } else {
        return binding;
      }
      break;
    }
    case "MacroUsePrelude": {
      const decl = this.macro_use_prelude.get(ident.name);
      if (decl !== undefined) {
        ret = Ok(decl);
      } else {
        ret = Err(Determinacy.determined(!this.graph_root.has_unexpanded_invocations(this)));
      }
      break;
    }
    case "BuiltinAttrs": {
      const decl = this.builtin_attr_decls.get(ident.name);
      ret = decl !== undefined ? Ok(decl) : Err("Determined");
      break;
    }
    case "ExternPreludeItems": {
      const decl = RefOrMut.reborrow(this).extern_prelude_get_item(ident, orig_ident_span, finalize !== undefined);
      if (decl !== undefined) {
        ret = Ok(decl);
      } else {
        ret = Err(Determinacy.determined(!this.graph_root.has_unexpanded_invocations(this)));
      }
      break;
    }
    case "ExternPreludeFlags": {
      const decl = this.extern_prelude_get_flag(ident, orig_ident_span, finalize !== undefined);
      ret = decl !== undefined ? Ok(decl) : Err("Determined");
      break;
    }
    case "ToolAttributePrelude": {
      const decl = this.registered_attr_tool_decls.get(ident);
      ret = decl !== undefined ? Ok(decl) : Err("Determined");
      break;
    }
    case "StdLibPrelude": {
      let result: Result<Decl, Determinacy> = Err("Determined");
      const prelude = this.prelude;
      let decl: Result<Decl, Determinacy> | undefined;
      if (
        prelude !== undefined &&
        (decl = RefOrMut.reborrow(this).resolve_ident_in_scope_set_inner(
          ident,
          orig_ident_span,
          { $: "Module", _0: ns, _1: prelude },
          parent_scope,
          undefined,
          ignore_decl,
          ignore_import,
        )).$ === "Ok" &&
        (use_prelude === "Yes" || this.is_builtin_macro(decl._0.res()))
      ) {
        result = Ok(decl._0);
      }

      ret = result;
      break;
    }
    case "BuiltinTypes": {
      const decl = this.builtin_type_decls.get(ident.name);
      if (decl !== undefined) {
        if (ident.name === sym.f16 && !this.features.f16() && !Span.allows_unstable(orig_ident_span, sym.f16) && finalize !== undefined) {
          feature_err(this.tcx_.sess, sym.f16, orig_ident_span, "the type `f16` is unstable").emit();
        }
        if (ident.name === sym.f128 && !this.features.f128() && !Span.allows_unstable(orig_ident_span, sym.f128) && finalize !== undefined) {
          feature_err(this.tcx_.sess, sym.f128, orig_ident_span, "the type `f128` is unstable").emit();
        }
        ret = Ok(decl);
      } else {
        ret = Err("Determined");
      }
      break;
    }
  }

  // `ret.map_err(ControlFlow::Continue)`
  return ret.$ === "Ok" ? ret : Err(ControlFlow.Continue(ret._0));
};

// rustc: compiler/rustc_resolve/src/ident.rs:805 maybe_push_glob_vs_glob_vis_ambiguity
Resolver.prototype.maybe_push_glob_vs_glob_vis_ambiguity = function (
  this: Resolver,
  ident: IdentKey,
  orig_ident_span: Span,
  decl: Decl,
  import_: ImportSummary | undefined,
): void {
  if (import_ === undefined) return;
  const vis1 = this.import_decl_vis(decl, import_);
  const vis2 = this.import_decl_vis_ext(decl, import_, true);
  if (!Visibility_eq(vis1, vis2)) {
    const parent_module = unwrap(decl.parent_module);
    this.ambiguity_errors.push({
      kind: "GlobVsGlob",
      ambig_vis: [vis1, vis2],
      ident: ident.orig(orig_ident_span),
      b1: decl.ambiguity_vis_max.get() ?? decl,
      b2: decl.ambiguity_vis_min.get() ?? decl,
      scope1: { $: "ModuleGlobs", _0: parent_module, _1: undefined },
      scope2: { $: "ModuleGlobs", _0: unwrap(decl.parent_module), _1: undefined },
      warning: "GlobImport",
    });
  }
};

// rustc: compiler/rustc_resolve/src/ident.rs:829 maybe_push_ambiguity
Resolver.prototype.maybe_push_ambiguity = function (
  this: Resolver,
  ident: IdentKey,
  orig_ident_span: Span,
  ns: Namespace,
  scope_set: ScopeSet,
  parent_scope: ParentScope,
  decl: Decl,
  scope: Scope,
  innermost_results: readonly [Decl, Scope][],
  import_: ImportSummary | undefined,
): boolean {
  const [innermost_decl, innermost_scope] = innermost_results[0]!;
  const [res, innermost_res] = [decl.res(), innermost_decl.res()];
  let ambig_vis: [ReturnType<Resolver["import_decl_vis"]>, ReturnType<Resolver["import_decl_vis"]>] | undefined;
  let vis1;
  let vis2;
  if (!Res_eq(res, innermost_res)) {
    ambig_vis = undefined;
  } else if (
    import_ !== undefined &&
    ((vis1 = this.import_decl_vis(decl, import_)), true) &&
    ((vis2 = this.import_decl_vis(innermost_decl, import_)), true) &&
    !Visibility_eq(vis1, vis2)
  ) {
    ambig_vis = [vis1, vis2];
  } else {
    return false;
  }

  // FIXME: Use `scope` instead of `res` to detect built-in attrs and derive helpers,
  // it will exclude imports, make slightly more code legal, and will require lang approval.
  const module_only = scope_set.$ === "Module";
  const is_builtin = (res: Res): boolean => res.$ === "NonMacroAttr" && res._0.$ === "Builtin";
  const derive_helper: Res = { $: "NonMacroAttr", _0: { $: "DeriveHelper" } };
  const derive_helper_compat: Res = { $: "NonMacroAttr", _0: { $: "DeriveHelperCompat" } };

  let ambiguity_error_kind: AmbiguityKind | undefined;
  let m1: Module | undefined;
  if (is_builtin(innermost_res) || is_builtin(res)) {
    ambiguity_error_kind = "BuiltinAttr";
  } else if (Res_eq(innermost_res, derive_helper_compat)) {
    ambiguity_error_kind = "DeriveHelper";
  } else if (Res_eq(res, derive_helper_compat) && !Res_eq(innermost_res, derive_helper)) {
    return span_bug(orig_ident_span, "impossible inner resolution kind");
  } else if (
    innermost_scope.$ === "MacroRules" &&
    (scope.$ === "ModuleNonGlobs" || scope.$ === "ModuleGlobs") &&
    !this.disambiguate_macro_rules_vs_modularized(innermost_decl, decl)
  ) {
    ambiguity_error_kind = "MacroRulesVsModularized";
  } else if (scope.$ === "MacroRules" && (innermost_scope.$ === "ModuleNonGlobs" || innermost_scope.$ === "ModuleGlobs")) {
    // should be impossible because of visitation order in
    // visit_scopes
    //
    // we visit all macro_rules scopes (e.g. textual scope macros)
    // before we visit any modules (e.g. path-based scope macros)
    return span_bug(orig_ident_span, "ambiguous scoped macro resolutions with path-based scope resolution as first candidate");
  } else if (innermost_decl.is_glob_import()) {
    ambiguity_error_kind = "GlobVsOuter";
  } else if (!module_only && innermost_decl.may_appear_after(parent_scope.expansion, decl)) {
    ambiguity_error_kind = "MoreExpandedVsOuter";
  } else if (
    innermost_decl.expansion !== LocalExpnId.ROOT &&
    (!module_only || ns === "MacroNS") &&
    scope.$ === "ModuleGlobs" &&
    ((m1 = scope._0), true) &&
    innermost_scope.$ === "ModuleNonGlobs" &&
    m1 === innermost_scope._0
  ) {
    // FIXME: this error is too conservative and technically unnecessary now when module
    // scope is split into two scopes, at least when not resolving in `ScopeSet::Module`,
    // remove it with lang team approval.
    ambiguity_error_kind = "GlobVsExpanded";
  } else {
    ambiguity_error_kind = undefined;
  }

  if (ambiguity_error_kind !== undefined) {
    const kind = ambiguity_error_kind;
    // Skip ambiguity errors for extern flag bindings "overridden"
    // by extern item bindings.
    // FIXME: Remove with lang team approval.
    const issue_145575_hack =
      scope.$ === "ExternPreludeFlags" && innermost_results.slice(1).some(([b, s]) => s.$ === "ExternPreludeItems" && b !== innermost_decl);
    // Skip ambiguity errors for nonglob module bindings "overridden"
    // by glob module bindings in the same module.
    // FIXME: Remove with lang team approval.
    let issue_149681_hack: boolean;
    if (scope.$ === "ModuleGlobs") {
      const m1 = scope._0;
      issue_149681_hack = innermost_results.slice(1).some(([, s]) => s.$ === "ModuleNonGlobs" && m1 === s._0);
    } else {
      issue_149681_hack = false;
    }

    if (issue_145575_hack || issue_149681_hack) {
      this.issue_145575_hack_applied = true;
    } else {
      // Turn ambiguity errors for core vs std panic into warnings.
      // FIXME: Remove with lang team approval.
      const is_issue_147319_hack =
        Edition_discriminant[Span.edition(orig_ident_span)] <= Edition_discriminant[Edition.Edition2024] &&
        ident.name === sym.panic &&
        scope.$ === "StdLibPrelude" &&
        innermost_scope.$ === "ModuleGlobs" &&
        ((this.is_specific_builtin_macro(res, sym.std_panic) && this.is_specific_builtin_macro(innermost_res, sym.core_panic)) ||
          (this.is_specific_builtin_macro(res, sym.core_panic) && this.is_specific_builtin_macro(innermost_res, sym.std_panic)));

      let warning: "GlobImport" | "PanicImport" | undefined;
      if (ambig_vis !== undefined) {
        warning = "GlobImport";
      } else if (is_issue_147319_hack) {
        warning = "PanicImport";
      } else {
        warning = undefined;
      }

      this.ambiguity_errors.push({
        kind,
        ambig_vis,
        ident: ident.orig(orig_ident_span),
        b1: innermost_decl,
        b2: decl,
        scope1: innermost_scope,
        scope2: scope,
        warning,
      });
      return true;
    }
  }

  return false;
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/ident.rs:966 maybe_resolve_ident_in_module
Resolver.prototype.maybe_resolve_ident_in_module = function (
  this: CmResolver,
  module: ModuleOrUniformRoot,
  ident: Ident,
  ns: Namespace,
  parent_scope: ParentScope,
  ignore_import: Import | undefined,
): Result<Decl, Determinacy> {
  return this.resolve_ident_in_module(module, ident, ns, parent_scope, undefined, undefined, ignore_import);
};

// rustc: compiler/rustc_resolve/src/ident.rs:977 resolve_super_in_module
Resolver.prototype.resolve_super_in_module = function (
  this: Resolver,
  ident: Ident,
  module: Module | undefined,
  parent_scope: ParentScope,
): Module | undefined {
  const ctxt: MutRef<SyntaxContext> = { value: SyntaxContext.normalize_to_macros_2_0(Span.ctxt(ident.span)) };
  const parent = (module ?? this.resolve_self(ctxt, parent_scope.module)).parent;
  return parent === undefined ? undefined : this.resolve_self(ctxt, parent);
};

// rustc: compiler/rustc_resolve/src/ident.rs:990 path_root_is_crate_root
Resolver.prototype.path_root_is_crate_root = function (this: Resolver, ident: Ident): boolean {
  return ident.name === kw.PathRoot && Span.is_rust_2015(ident.span) && this.tcx_.sess.is_rust_2015();
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/ident.rs:995 resolve_ident_in_module
Resolver.prototype.resolve_ident_in_module = function (
  this: CmResolver,
  module: ModuleOrUniformRoot,
  ident: Ident,
  ns: Namespace,
  parent_scope: ParentScope,
  finalize: Finalize | undefined,
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
): Result<Decl, Determinacy> {
  switch (module.$) {
    case "Module": {
      const module_ = module._0;
      if (ns === "TypeNS") {
        if (ident.name === kw.SelfLower) {
          return Ok(unwrap(module_.self_decl));
        }
        let m: Module | undefined;
        if (ident.name === kw.Super && (m = this.resolve_super_in_module(ident, module_, parent_scope)) !== undefined) {
          return Ok(unwrap(m.self_decl));
        }
      }

      const [ident_key, def] = IdentKey.new_adjusted(ident, module_.expansion);
      let adjusted_parent_scope: ParentScope;
      if (def !== undefined) {
        adjusted_parent_scope = parent_scope_with(parent_scope, { module: this.expn_def_scope(def) });
      } else {
        adjusted_parent_scope = clone_ParentScope(parent_scope);
      }
      return this.resolve_ident_in_scope_set_inner(
        ident_key,
        ident.span,
        { $: "Module", _0: ns, _1: module_ },
        adjusted_parent_scope,
        finalize,
        ignore_decl,
        ignore_import,
      );
    }
    case "OpenModule": {
      const sym_ = module._0;
      if (ns !== "TypeNS") {
        return Err("Determined");
      } else {
        if (ident.name === kw.SelfLower) {
          const res: Res = { $: "OpenMod", _0: sym_ };
          return Ok(this.arenas.new_pub_def_decl(res, ident.span, LocalExpnId.ROOT));
        }

        const open_ns_name = `${Symbol.as_str(sym_)}::${Symbol.as_str(ident.name)}`;
        const ns_ident = IdentKey.with_root_ctxt(Symbol.intern(open_ns_name));
        const decl = this.extern_prelude_get_flag(ns_ident, ident.span, finalize !== undefined);
        if (decl !== undefined) {
          return Ok(decl);
        }
        return Err("Determined");
      }
    }
    case "ModuleAndExternPrelude":
      return this.resolve_ident_in_scope_set(
        ident,
        { $: "ModuleAndExternPrelude", _0: ns, _1: module._0 },
        parent_scope,
        finalize,
        ignore_decl,
        ignore_import,
      );
    case "ExternPrelude":
      if (ns !== "TypeNS") {
        return Err("Determined");
      } else {
        return this.resolve_ident_in_scope_set_inner(
          IdentKey.new_adjusted(ident, ExpnId.root())[0],
          ident.span,
          { $: "ExternPrelude" },
          parent_scope,
          finalize,
          ignore_decl,
          ignore_import,
        );
      }
    case "CurrentScope": {
      if (ns === "TypeNS") {
        if (ident.name === kw.SelfLower) {
          const ctxt: MutRef<SyntaxContext> = { value: SyntaxContext.normalize_to_macros_2_0(Span.ctxt(ident.span)) };
          const module_ = this.resolve_self(ctxt, parent_scope.module);
          return Ok(unwrap(module_.self_decl));
        }
        let m: Module | undefined;
        if (ident.name === kw.Super && (m = this.resolve_super_in_module(ident, undefined, parent_scope)) !== undefined) {
          return Ok(unwrap(m.self_decl));
        }
        if (ident.name === kw.Crate || ident.name === kw.DollarCrate || this.path_root_is_crate_root(ident)) {
          const module_ = this.resolve_crate_root(ident);
          return Ok(unwrap(module_.self_decl));
        }
      }

      return this.resolve_ident_in_scope_set(ident, { $: "All", _0: ns }, parent_scope, finalize, ignore_decl, ignore_import);
    }
  }
};

/// Attempts to resolve `ident` in namespace `ns` of non-glob bindings in an external `module`.
// rustc: compiler/rustc_resolve/src/ident.rs:1113 resolve_ident_in_extern_module_non_globs_unadjusted
Resolver.prototype.resolve_ident_in_extern_module_non_globs_unadjusted = function (
  this: CmResolver,
  module: ExternModule,
  ident: IdentKey,
  orig_ident_span: Span,
  ns: Namespace,
  parent_scope: ParentScope,
  shadowing: Shadowing,
  finalize: Finalize | undefined,
  // This binding should be ignored during in-module resolution, so that we don't get
  // "self-confirming" import resolutions during import validation and checking.
  ignore_decl: Decl | undefined,
): Result<Decl, ControlFlow<Determinacy, Determinacy>> {
  const key = BindingKey.new(ident, ns);
  const resolution = this.resolution(module.to_module(), key);
  if (resolution === undefined) return Err(cf_continue("Determined"));

  const nb = resolution.non_glob_decl;
  const binding = nb !== undefined && nb !== ignore_decl ? nb : undefined;

  if (finalize !== undefined) {
    return RefOrMut.get_mut(this).finalize_module_binding(ident, orig_ident_span, binding, parent_scope, finalize, shadowing);
  }

  // Items and single imports are not shadowable, if we have one, then it's determined.
  if (binding !== undefined) {
    const accessible = this.is_accessible_from(binding.vis(), parent_scope.module);
    return accessible ? Ok(binding) : Err(cf_break("Determined"));
  }
  return Err(cf_continue("Determined"));
};

/// Attempts to resolve `ident` in namespace `ns` of non-glob bindings in a local `module`.
// rustc: compiler/rustc_resolve/src/ident.rs:1152 resolve_ident_in_local_module_non_globs_unadjusted
Resolver.prototype.resolve_ident_in_local_module_non_globs_unadjusted = function (
  this: CmResolver,
  module: LocalModule,
  ident: IdentKey,
  orig_ident_span: Span,
  ns: Namespace,
  parent_scope: ParentScope,
  shadowing: Shadowing,
  finalize: Finalize | undefined,
  // This binding should be ignored during in-module resolution, so that we don't get
  // "self-confirming" import resolutions during import validation and checking.
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
): Result<Decl, ControlFlow<Determinacy, Determinacy>> {
  const key = BindingKey.new(ident, ns);
  const resolution = this.resolution(module.to_module(), key);

  const nb = resolution === undefined ? undefined : resolution.non_glob_decl;
  const binding = nb !== undefined && nb !== ignore_decl ? nb : undefined;

  if (finalize !== undefined) {
    // finalize implies that the module is fully expanded
    assert(!module.has_unexpanded_invocations(this), "assertion failed: !module.has_unexpanded_invocations(&self)");
    return RefOrMut.get_mut(this).finalize_module_binding(ident, orig_ident_span, binding, parent_scope, finalize, shadowing);
  }

  // Items and single imports are not shadowable, if we have one, then it's determined.
  if (binding !== undefined) {
    const accessible = this.is_accessible_from(binding.vis(), parent_scope.module);
    return accessible ? Ok(binding) : Err(cf_break("Determined"));
  }

  if (resolution !== undefined) {
    // We need to detect resolution cycles to avoid infinite recursion. The guard ensures
    // the resolution is removed when this resolve call ends.
    const guard = enter_cycle_detector(module, key);
    if (guard.$ === "Err") return Err(cf_continue("Determined"));
    try {
      // Check if one of single imports can still define the name, block if it can.
      if (RefOrMut.reborrow(this).single_import_can_define_name(resolution, undefined, ns, ignore_import, ignore_decl, parent_scope)) {
        return Err(cf_break("Undetermined"));
      }
    } finally {
      ActiveResolutionGuard_drop(guard._0);
    }
  }

  // Check if one of unexpanded macros can still define the name.
  if (module.has_unexpanded_invocations(this)) {
    return Err(cf_continue("Undetermined"));
  }

  // No resolution and no one else can define the name - determinate error.
  return Err(cf_continue("Determined"));
};

/// Attempts to resolve `ident` in namespace `ns` of glob bindings in `module`.
// rustc: compiler/rustc_resolve/src/ident.rs:1220 resolve_ident_in_module_globs_unadjusted
Resolver.prototype.resolve_ident_in_module_globs_unadjusted = function (
  this: CmResolver,
  module: LocalModule,
  ident: IdentKey,
  orig_ident_span: Span,
  ns: Namespace,
  parent_scope: ParentScope,
  shadowing: Shadowing,
  finalize: Finalize | undefined,
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
): Result<Decl, ControlFlow<Determinacy, Determinacy>> {
  const key = BindingKey.new(ident, ns);
  const resolution = this.resolution(module.to_module(), key);

  const gb = resolution === undefined ? undefined : resolution.glob_decl;
  const binding = gb !== undefined && gb !== ignore_decl ? gb : undefined;

  if (finalize !== undefined) {
    // finalize implies that the module is fully expanded
    assert(!module.has_unexpanded_invocations(this), "assertion failed: !module.has_unexpanded_invocations(&self)");
    return RefOrMut.get_mut(this).finalize_module_binding(ident, orig_ident_span, binding, parent_scope, finalize, shadowing);
  }

  // We need to detect resolution cycles to avoid infinite recursion. The guard ensures
  // the resolution is removed when this resolve call ends.
  const guard = enter_cycle_detector(module, key);
  if (guard.$ === "Err") return Err(cf_continue("Determined"));
  try {
    // Check if one of single imports can still define the name,
    // if it can then our result is not determined and can be invalidated.
    if (resolution !== undefined) {
      if (RefOrMut.reborrow(this).single_import_can_define_name(resolution, binding, ns, ignore_import, ignore_decl, parent_scope)) {
        return Err(cf_break("Undetermined"));
      }
    }

    // So we have a resolution that's from a glob import. This resolution is determined
    // if it cannot be shadowed by some new item/import expanded from a macro.
    // This happens either if there are no unexpanded macros, or expanded names cannot
    // shadow globs (that happens in macro namespace or with restricted shadowing).
    //
    // Additionally, any macro in any module can plant names in the root module if it creates
    // `macro_export` macros, so the root module effectively has unresolved invocations if any
    // module has unresolved invocations.
    // However, it causes resolution/expansion to stuck too often (#53144), so, to make
    // progress, we have to ignore those potential unresolved invocations from other modules
    // and prohibit access to macro-expanded `macro_export` macros instead (unless restricted
    // shadowing is enabled, see `macro_expanded_macro_export_errors`).
    if (binding !== undefined) {
      if (binding.determined(this) || ns === "MacroNS" || shadowing === "Restricted") {
        const accessible = this.is_accessible_from(binding.vis(), parent_scope.module);
        return accessible ? Ok(binding) : Err(cf_break("Determined"));
      } else {
        return Err(cf_break("Undetermined"));
      }
    }

    // Now we are in situation when new item/import can appear only from a glob or a macro
    // expansion. With restricted shadowing names from globs and macro expansions cannot
    // shadow names from outer scopes, so we can freely fallback from module search to search
    // in outer scopes. For `resolve_ident_in_scope_set` to continue search in outer
    // scopes we return `Undetermined` with `ControlFlow::Continue`.
    // Check if one of unexpanded macros can still define the name,
    // if it can then our "no resolution" result is not determined and can be invalidated.
    if (module.has_unexpanded_invocations(this)) {
      return Err(cf_continue("Undetermined"));
    }

    // Check if one of glob imports can still define the name,
    // if it can then our "no resolution" result is not determined and can be invalidated.
    for (const glob_import of module.globs.borrow_checked(this)) {
      if (ignore_import === glob_import) {
        continue;
      }
      if (!this.is_accessible_from(glob_import.vis, parent_scope.module)) {
        continue;
      }
      const imported = glob_import.imported_module.get();
      let module_: Module;
      if (imported !== undefined && imported.$ === "Module") {
        module_ = imported._0;
      } else if (imported !== undefined) {
        continue;
      } else {
        return Err(cf_continue("Undetermined"));
      }
      let tmp_parent_scope: ParentScope;
      let adjusted_parent_scope = parent_scope;
      const adjusted_ident = clone_IdentKey(ident);
      const adjusted = Macros20NormalizedSyntaxContext.update_unchecked(field_mut(adjusted_ident, "ctxt"), (ctxt) =>
        SyntaxContext.glob_adjust(ctxt, module_.expansion, glob_import.span),
      );
      if (adjusted !== undefined && adjusted._0 !== undefined) {
        const def = adjusted._0;
        tmp_parent_scope = parent_scope_with(parent_scope, { module: this.expn_def_scope(def) });
        adjusted_parent_scope = tmp_parent_scope;
      } else if (adjusted !== undefined) {
        // `Some(None) => {}`
      } else {
        continue;
      }
      const result = RefOrMut.reborrow(this).resolve_ident_in_scope_set_inner(
        adjusted_ident,
        orig_ident_span,
        { $: "Module", _0: ns, _1: module_ },
        adjusted_parent_scope,
        undefined,
        ignore_decl,
        ignore_import,
      );

      if (result.$ === "Err" && result._0 === "Determined") {
        continue;
      } else if (result.$ === "Ok" && !this.is_accessible_from(result._0.vis(), glob_import.parent_scope.module)) {
        continue;
      } else {
        return Err(cf_continue("Undetermined"));
      }
    }

    // No resolution and no one else can define the name - determinate error.
    return Err(cf_continue("Determined"));
  } finally {
    ActiveResolutionGuard_drop(guard._0);
  }
};

// rustc: compiler/rustc_resolve/src/ident.rs:1359 finalize_module_binding
Resolver.prototype.finalize_module_binding = function (
  this: Resolver,
  ident_: IdentKey,
  orig_ident_span: Span,
  binding: Decl | undefined,
  parent_scope: ParentScope,
  finalize: Finalize,
  shadowing: Shadowing,
): Result<Decl, ControlFlow<Determinacy, Determinacy>> {
  const { path_span, report_private, used, root_span } = finalize;

  if (binding === undefined) {
    return Err(cf_continue("Determined"));
  }

  const ident = ident_.orig(orig_ident_span);
  if (!this.is_accessible_from(binding.vis(), parent_scope.module)) {
    if (report_private) {
      this.privacy_errors.push({
        ident,
        decl: binding,
        dedup_span: path_span,
        outermost_res: undefined,
        source: undefined,
        parent_scope: clone_ParentScope(parent_scope),
        single_nested: path_span !== root_span,
      });
    } else {
      return Err(cf_break("Determined"));
    }
  }

  if (shadowing === "Unrestricted" && binding.expansion !== LocalExpnId.ROOT && binding.kind.$ === "Import" && binding.kind.import.kind.$ === "MacroExport") {
    this.macro_expanded_macro_export_errors.add([path_span, binding.span]);
  }

  this.record_use(ident, binding, used);
  return Ok(binding);
};

// Checks if a single import can define the `Ident` corresponding to `binding`.
// This is used to check whether we can definitively accept a glob as a resolution.
// rustc: compiler/rustc_resolve/src/ident.rs:1406 single_import_can_define_name
Resolver.prototype.single_import_can_define_name = function (
  this: CmResolver,
  resolution: NameResolution,
  binding: Decl | undefined,
  ns: Namespace,
  ignore_import: Import | undefined,
  ignore_decl: Decl | undefined,
  parent_scope: ParentScope,
): boolean {
  for (const single_import of resolution.single_imports) {
    const decl = resolution.non_glob_decl;
    if (decl !== undefined && decl.kind.$ === "Import" && decl.kind.import === single_import) {
      // Single import has already defined the name and we are aware of it,
      // no need to block the globs.
      continue;
    }
    if (ignore_import === single_import) {
      continue;
    }
    if (!this.is_accessible_from(single_import.vis, parent_scope.module)) {
      continue;
    }
    const ignored = ignore_decl;
    if (ignored !== undefined && ignored.kind.$ === "Import" && ignored.kind.import === single_import) {
      continue;
    }

    const module = single_import.imported_module.get();
    if (module === undefined) {
      return true;
    }
    const kind = single_import.kind;
    if (kind.$ !== "Single") {
      return unreachable();
    }
    const { source, target, decls } = kind;
    if (!source.eq(target)) {
      if (decls.iter().every((d) => PendingDecl.decl(d.get()) === undefined)) {
        return true;
      } else if (PendingDecl.decl(decls.index(ns).get()) === undefined && binding !== undefined) {
        return true;
      }
    }

    const r = RefOrMut.reborrow(this).resolve_ident_in_module(module, source, ns, single_import.parent_scope, undefined, ignore_decl, undefined);
    if (r.$ === "Err" && r._0 === "Determined") {
      continue;
    } else if (r.$ === "Ok" && !this.is_accessible_from(r._0.vis(), single_import.parent_scope.module)) {
      continue;
    } else {
      return true;
    }
  }

  return false;
};

/// Validate a local resolution (from ribs).
// #[instrument(level = "debug", skip(self, all_ribs))]
// rustc: compiler/rustc_resolve/src/ident.rs:1476 validate_res_from_ribs
Resolver.prototype.validate_res_from_ribs = function (
  this: Resolver,
  rib_index: number,
  rib_ident: Ident,
  res: Res,
  finalize: Span | undefined,
  original_rib_ident_def: Ident,
  all_ribs: readonly Rib[],
  diag_metadata: DiagMetadata | undefined,
): Res {
  // debug!("validate_res_from_ribs({:?})", res);
  const ribs = all_ribs.slice(rib_index + 1);

  // An invalid forward use of a generic parameter from a previous default
  // or in a const param ty.
  const kind0 = all_ribs[rib_index]!.kind;
  if (kind0.$ === "ForwardGenericParamBan") {
    const reason = kind0._0;
    if (finalize !== undefined) {
      const span = finalize;
      let res_error: ResolutionError;
      if (rib_ident.name === kw.SelfUpper) {
        res_error = { $: "ForwardDeclaredSelf", _0: reason };
      } else {
        res_error = { $: "ForwardDeclaredGenericParam", _0: rib_ident.name, _1: reason };
      }
      this.report_error(span, res_error);
    }
    assert_eq<Res>(res, { $: "Err" }, (v) => debug_Res(v, PLAIN, debug_NodeId), Res_eq);
    return { $: "Err" };
  }

  if (res.$ === "Local") {
    let res_err: [Span, ResolutionError] | undefined = undefined;

    const suggest_closure = !ribs.some((rib) => rib.kind.$ === "AssocItem");

    for (const rib of ribs) {
      const kind = rib.kind;
      switch (kind.$) {
        case "Normal":
        case "Block":
        case "FnOrCoroutine":
        case "Module":
        case "MacroDefinition":
        case "ForwardGenericParamBan":
          // Nothing to do. Continue.
          break;
        case "Item":
        case "AssocItem":
          // This was an attempt to access an upvar inside a
          // named function item. This is not allowed, so we
          // report an error.
          if (finalize !== undefined) {
            const span = finalize;
            // We don't immediately trigger a resolve error, because
            // we want certain other resolution errors (namely those
            // emitted for `ConstantItemRibKind` below) to take
            // precedence.
            res_err = [span, { $: "CannotCaptureDynamicEnvironmentInFnItem", suggest_closure }];
          }
          break;
        case "ConstantItem": {
          const item = kind._1;
          const requires_type = kind._2;
          // Still doesn't deal with upvars
          if (finalize !== undefined) {
            const span_ = finalize;
            let span: Span;
            let resolution_error: ResolutionError;
            if (item === undefined && rib_ident.name === kw.SelfLower) {
              [span, resolution_error] = [span_, { $: "LowercaseSelf" }];
            } else if (item === undefined) {
              // If we have a `let name = expr;`, we have the span for
              // `name` and use that to see if it is followed by a type
              // specifier. If not, then we know we need to suggest
              // `const name: Ty = expr;`. This is a heuristic, it will
              // break down in the presence of macros.
              const sm = this.tcx_.sess.source_map();
              let type_span: Span | undefined;
              if (sm.span_followed_by(original_rib_ident_def.span, ":") === undefined) {
                type_span = Span.shrink_to_hi(original_rib_ident_def.span);
              } else {
                type_span = undefined;
              }
              [span, resolution_error] = [
                rib_ident.span,
                {
                  $: "AttemptToUseNonConstantValueInConstant",
                  ident: original_rib_ident_def,
                  suggestion: "const",
                  current: "let",
                  type_span,
                  requires_type,
                },
              ];
            } else {
              const [ident, kind_] = item;
              [span, resolution_error] = [
                span_,
                {
                  $: "AttemptToUseNonConstantValueInConstant",
                  ident,
                  suggestion: "let",
                  current: ConstantItemKind.as_str(kind_),
                  type_span: undefined,
                  requires_type,
                },
              ];
            }
            this.report_error(span, resolution_error);
          }
          return { $: "Err" };
        }
        case "ConstParamTy":
          if (finalize !== undefined) {
            this.report_error(finalize, { $: "ParamInTyOfConstParam", name: rib_ident.name });
          }
          return { $: "Err" };
        case "InlineAsmSym":
          if (finalize !== undefined) {
            this.report_error(finalize, { $: "InvalidAsmSym" });
          }
          return { $: "Err" };
      }
    }
    if (res_err !== undefined) {
      const [span, res_err_] = res_err;
      this.report_error(span, res_err_);
      return { $: "Err" };
    }
  } else if ((res.$ === "Def" && res._0.$ === "TyParam") || res.$ === "SelfTyParam" || res.$ === "SelfTyAlias") {
    for (const rib of ribs) {
      const kind = rib.kind;
      let has_generic_params;
      let def_kind;
      switch (kind.$) {
        case "Normal":
        case "Block":
        case "FnOrCoroutine":
        case "Module":
        case "MacroDefinition":
        case "InlineAsmSym":
        case "AssocItem":
        case "ForwardGenericParamBan":
          // Nothing to do. Continue.
          continue;

        case "ConstParamTy": {
          const adt_enabled = this.features.min_adt_const_params() || this.features.adt_const_params();
          const is_self = res.$ === "SelfTyAlias";
          // We check whether Self depends on generics parameters in `fn type_of`
          if (this.features.generic_const_parameter_types() || (adt_enabled && is_self)) {
            continue;
          } else {
            if (finalize !== undefined) {
              const span = finalize;
              if (res.$ === "SelfTyAlias") {
                this.report_error(span, { $: "SelfInConstParam" });
              } else {
                this.report_error(span, { $: "ParamInTyOfConstParam", name: rib_ident.name });
              }
            }
            return { $: "Err" };
          }
        }

        case "ConstantItem": {
          const trivial = kind._0;
          if (trivial.$ === "No" && res.$ !== "SelfTyAlias") {
            const cause = trivial._0;
            if (finalize !== undefined) {
              const span = finalize;
              let error: ResolutionError;
              switch (cause) {
                case "IsEnumDiscriminant":
                  error = { $: "ParamInEnumDiscriminant", name: rib_ident.name, param_kind: "Type" };
                  break;
                case "NonTrivialConstArg":
                  error = {
                    $: "ParamInNonTrivialAnonConst",
                    is_gca_const_items: this.features.gca_const_items(),
                    name: rib_ident.name,
                    param_kind: { $: "Type" },
                  };
                  break;
              }
              this.report_error(span, error);
            }

            return { $: "Err" };
          }

          continue;
        }

        // This was an attempt to use a type parameter outside its scope.
        case "Item":
          [has_generic_params, def_kind] = [kind._0, kind._1];
          break;
      }

      if (finalize !== undefined) {
        const span = finalize;
        let item: [Span, Span, ItemKind] | undefined;
        let current_item;
        if (diag_metadata !== undefined && (current_item = diag_metadata.current_item) !== undefined) {
          const label_span = ItemKind.ident(current_item.kind)?.span ?? current_item.span;
          item = [label_span, current_item.span, clone_ItemKind(current_item.kind)];
        } else {
          item = undefined;
        }
        this.report_error(span, {
          $: "GenericParamsFromOuterItem",
          outer_res: res,
          has_generic_params,
          def_kind,
          inner_item: item,
          current_self_ty: current_self_ty_snippet(this, diag_metadata),
        });
      }
      return { $: "Err" };
    }
  } else if (res.$ === "Def" && res._0.$ === "ConstParam") {
    for (const rib of ribs) {
      const kind = rib.kind;
      let has_generic_params;
      let def_kind;
      switch (kind.$) {
        case "Normal":
        case "Block":
        case "FnOrCoroutine":
        case "Module":
        case "MacroDefinition":
        case "InlineAsmSym":
        case "AssocItem":
        case "ForwardGenericParamBan":
          continue;

        case "ConstParamTy":
          if (!this.features.generic_const_parameter_types()) {
            if (finalize !== undefined) {
              this.report_error(finalize, { $: "ParamInTyOfConstParam", name: rib_ident.name });
            }
            return { $: "Err" };
          } else {
            continue;
          }

        case "ConstantItem": {
          const trivial = kind._0;
          if (trivial.$ === "No") {
            const cause = trivial._0;
            if (finalize !== undefined) {
              const span = finalize;
              let error: ResolutionError;
              switch (cause) {
                case "IsEnumDiscriminant":
                  error = { $: "ParamInEnumDiscriminant", name: rib_ident.name, param_kind: "Const" };
                  break;
                case "NonTrivialConstArg":
                  error = {
                    $: "ParamInNonTrivialAnonConst",
                    is_gca_const_items: this.features.gca_const_items(),
                    name: rib_ident.name,
                    param_kind: { $: "Const", name: rib_ident.name },
                  };
                  break;
              }
              this.report_error(span, error);
            }

            return { $: "Err" };
          }

          continue;
        }

        case "Item":
          [has_generic_params, def_kind] = [kind._0, kind._1];
          break;
      }

      // This was an attempt to use a const parameter outside its scope.
      if (finalize !== undefined) {
        const span = finalize;
        let item: [Span, Span, ItemKind] | undefined;
        let current_item;
        if (diag_metadata !== undefined && (current_item = diag_metadata.current_item) !== undefined) {
          const label_span = ItemKind.ident(current_item.kind)?.span ?? current_item.span;
          item = [label_span, current_item.span, clone_ItemKind(current_item.kind)];
        } else {
          item = undefined;
        }
        this.report_error(span, {
          $: "GenericParamsFromOuterItem",
          outer_res: res,
          has_generic_params,
          def_kind,
          inner_item: item,
          current_self_ty: current_self_ty_snippet(this, diag_metadata),
        });
      }
      return { $: "Err" };
    }
  }

  return res;
};

/** `diag_metadata.and_then(|m| m.current_self_type.as_ref()).and_then(|ty| sm.span_to_snippet(ty.span).ok())` */
function current_self_ty_snippet(r: Resolver, diag_metadata: DiagMetadata | undefined): string | undefined {
  const ty = diag_metadata === undefined ? undefined : diag_metadata.current_self_type;
  if (ty === undefined) return undefined;
  const s = r.tcx_.sess.source_map().span_to_snippet(ty.span);
  return s.$ === "Ok" ? s._0.toString() : undefined;
}


// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/ident.rs:1815 maybe_resolve_path
Resolver.prototype.maybe_resolve_path = function (
  this: CmResolver,
  path: readonly Segment[],
  opt_ns: Namespace | undefined, // `None` indicates a module path in import
  parent_scope: ParentScope,
  ignore_import: Import | undefined,
): PathResult {
  return this.resolve_path_with_ribs(path, opt_ns, parent_scope, undefined, undefined, undefined, undefined, ignore_import, undefined);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/ident.rs:1835 resolve_path
Resolver.prototype.resolve_path = function (
  this: CmResolver,
  path: readonly Segment[],
  opt_ns: Namespace | undefined, // `None` indicates a module path in import
  parent_scope: ParentScope,
  finalize: Finalize | undefined,
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
): PathResult {
  return this.resolve_path_with_ribs(path, opt_ns, parent_scope, undefined, finalize, undefined, ignore_decl, ignore_import, undefined);
};

// rustc: compiler/rustc_resolve/src/ident.rs:1857 resolve_path_with_ribs
Resolver.prototype.resolve_path_with_ribs = function (
  this: CmResolver,
  path: readonly Segment[],
  opt_ns: Namespace | undefined, // `None` indicates a module path in import
  parent_scope: ParentScope,
  source: PathSource | undefined,
  finalize: Finalize | undefined,
  ribs: PerNS<Rib[]> | undefined,
  ignore_decl: Decl | undefined,
  ignore_import: Import | undefined,
  diag_metadata: DiagMetadata | undefined,
): PathResult {
  let module: ModuleOrUniformRoot | undefined = undefined;
  let module_had_parse_errors =
    this.mods_with_parse_errors.size !== 0 && this.mods_with_parse_errors.has(parent_scope.module.nearest_parent_mod().to_def_id());
  let allow_super = true;
  let second_binding: Decl | undefined = undefined;

  // We'll provide more context to the privacy errors later, up to `len`.
  const privacy_errors_len = this.privacy_errors.length;
  // rustc: compiler/rustc_resolve/src/ident.rs:1879 record_segment_res
  function record_segment_res(this_: CmResolver, finalize: Finalize | undefined, res: Res, id: NodeId | undefined): void {
    if (finalize !== undefined && id !== undefined && !this_.partial_res_map.has(id)) {
      assert(id !== DUMMY_NODE_ID, "Trying to resolve dummy id");
      RefOrMut.get_mut(this_).record_partial_res(id, PartialRes.new(res));
    }
  }

  for (let segment_idx = 0; segment_idx < path.length; segment_idx++) {
    const { ident, id } = path[segment_idx]!;
    // debug!("resolve_path ident {} {:?} {:?}", segment_idx, ident, id);

    const is_last = segment_idx + 1 === path.length;
    const ns: Namespace = is_last ? (opt_ns ?? "TypeNS") : "TypeNS";
    const name = ident.name;

    allow_super &&= ns === "TypeNS" && (name === kw.SelfLower || name === kw.Super);

    if (ns === "TypeNS") {
      if (allow_super && name === kw.Super) {
        let parent: Module | undefined;
        if (segment_idx === 0) {
          parent = this.resolve_super_in_module(ident, undefined, parent_scope);
        } else if (module !== undefined && module.$ === "Module") {
          parent = this.resolve_super_in_module(ident, module._0, parent_scope);
        } else {
          parent = undefined;
        }
        if (parent !== undefined) {
          module = { $: "Module", _0: parent };
          continue;
        }
        const ctxt: MutRef<SyntaxContext> = { value: SyntaxContext.normalize_to_macros_2_0(Span.ctxt(ident.span)) };
        const current_module = this.resolve_self(ctxt, parent_scope.module);
        const path_ = module_to_string(current_module);
        const current_module_path = path_ === undefined ? "crate" : `crate::${path_}`;
        return PathResult.failed(ident, false, finalize !== undefined, module_had_parse_errors, module, () => [
          `too many leading \`super\` keywords within \`${current_module_path}\``,
          "this `super` would go above the crate root",
          undefined,
          undefined,
          undefined,
        ]);
      }
      if (segment_idx === 0) {
        if (name === kw.SelfLower) {
          const ctxt: MutRef<SyntaxContext> = { value: SyntaxContext.normalize_to_macros_2_0(Span.ctxt(ident.span)) };
          const self_mod = this.resolve_self(ctxt, parent_scope.module);
          const res = self_mod.res();
          if (res !== undefined) {
            record_segment_res(RefOrMut.reborrow(this), finalize, res, id);
          }
          module = { $: "Module", _0: self_mod };
          continue;
        }
        if (name === kw.PathRoot && Span.at_least_rust_2018(ident.span)) {
          module = ModuleOrUniformRootC.ExternPrelude;
          continue;
        }
        if (name === kw.PathRoot && Span.is_rust_2015(ident.span) && this.tcx_.sess.at_least_rust_2018()) {
          // `::a::b` from 2015 macro on 2018 global edition
          const crate_root = this.resolve_crate_root(ident);
          module = { $: "ModuleAndExternPrelude", _0: crate_root };
          continue;
        }
        if (name === kw.PathRoot || name === kw.Crate || name === kw.DollarCrate) {
          // `::a::b`, `crate::a::b` or `$crate::a::b`
          const crate_root = this.resolve_crate_root(ident);
          const res = crate_root.res();
          if (res !== undefined) {
            record_segment_res(RefOrMut.reborrow(this), finalize, res, id);
          }
          module = { $: "Module", _0: crate_root };
          continue;
        }
      }
    }

    const allow_trailing_self = is_last && name === kw.SelfLower;

    // Report special messages for path segment keywords in wrong positions.
    if (ident.is_path_segment_keyword() && segment_idx !== 0 && !allow_trailing_self) {
      return PathResult.failed(ident, false, finalize !== undefined, module_had_parse_errors, module, () => {
        const name_str = name === kw.PathRoot ? "the crate root" : `\`${Symbol.as_str(name)}\``;
        let message: string;
        let label: string;
        if (segment_idx === 1 && path[0]!.ident.name === kw.PathRoot) {
          [message, label] = [`global paths cannot start with ${name_str}`, "cannot start with this"];
        } else if (name === kw.SelfLower) {
          [message, label] = [
            "`self` in paths can only be used in start position or last position",
            "can only be used in path start position or last position",
          ];
        } else {
          [message, label] = [`${name_str} in paths can only be used in start position`, "can only be used in path start position"];
        }
        return [message, label, undefined, undefined, undefined];
      });
    }

    let binding: Result<Decl, Determinacy>;
    if (module !== undefined) {
      binding = RefOrMut.reborrow(this).resolve_ident_in_module(module, ident, ns, parent_scope, finalize, ignore_decl, ignore_import);
    } else if (ribs !== undefined && (opt_ns === "TypeNS" || opt_ns === "ValueNS")) {
      assert(ignore_import === undefined, "assertion failed: ignore_import.is_none()");
      const r = RefOrMut.get_mut(this).resolve_ident_in_lexical_scope(ident, ns, parent_scope, finalize, ribs.index(ns), ignore_decl, diag_metadata);
      if (r !== undefined && r.$ === "Decl") {
        // we found a locally-imported or available item/module
        binding = Ok(r._0);
      } else if (r !== undefined && r.$ === "RibDef") {
        // we found a local variable or type param
        const res = r._0;
        record_segment_res(RefOrMut.reborrow(this), finalize, res, id);
        return { $: "NonModule", _0: PartialRes.with_unresolved_segments(res, path.length - 1) };
      } else {
        binding = Err(Determinacy.determined(finalize !== undefined));
      }
    } else {
      binding = RefOrMut.reborrow(this).resolve_ident_in_scope_set(ident, { $: "All", _0: ns }, parent_scope, finalize, ignore_decl, ignore_import);
    }

    if (binding.$ === "Ok") {
      const binding_ = binding._0;
      if (segment_idx === 1) {
        second_binding = binding_;
      }
      const res = binding_.res();

      // Mark every privacy error in this path with the res to the last element. This allows us
      // to detect the item the user cares about and either find an alternative import, or tell
      // the user it is not accessible.
      if (finalize !== undefined) {
        for (const error of RefOrMut.get_mut(this).privacy_errors.slice(privacy_errors_len)) {
          error.outermost_res = [res, ident];
          if (source !== undefined && (source.$ === "Struct" || source.$ === "Expr") && source._0 !== undefined) {
            error.source = clone_Expr(source._0);
          } else {
            error.source = undefined;
          }
        }
      }

      const maybe_assoc = opt_ns !== "MacroNS" && PathSource.is_expected(PathSource.Type, res);
      const bres = binding_.res();
      let def_id;
      if (bres.$ === "OpenMod") {
        const sym_ = bres._0;
        module = { $: "OpenModule", _0: sym_ };
        record_segment_res(RefOrMut.reborrow(this), finalize, res, id);
      } else if ((def_id = def_Res.module_like_def_id(binding_.res())) !== undefined) {
        if (this.mods_with_parse_errors.has(def_id)) {
          module_had_parse_errors = true;
        }
        module = { $: "Module", _0: this.expect_module(def_id) };
        record_segment_res(RefOrMut.reborrow(this), finalize, res, id);
      } else if (res.$ === "ToolMod" && !is_last && opt_ns !== undefined) {
        if (binding_.is_import()) {
          this.dcx().emit_err(diagnostics.ToolModuleImported_diagnostic({ span: ident.span, import: binding_.span }));
        }
        const res: Res = { $: "NonMacroAttr", _0: { $: "Tool" } };
        return { $: "NonModule", _0: PartialRes.new(res) };
      } else if (res.$ === "Err") {
        return { $: "NonModule", _0: PartialRes.new({ $: "Err" }) };
      } else if (opt_ns !== undefined && (is_last || maybe_assoc)) {
        if (finalize !== undefined) {
          RefOrMut.get_mut(this).lint_if_path_starts_with_module(finalize, path, second_binding);
        }
        record_segment_res(RefOrMut.reborrow(this), finalize, res, id);
        return { $: "NonModule", _0: PartialRes.with_unresolved_segments(res, path.length - segment_idx - 1) };
      } else {
        const module_ = module;
        return PathResult.failed(ident, is_last, finalize !== undefined, module_had_parse_errors, module_, () => {
          const import_inherent_item_error_flag =
            this.features.import_trait_associated_functions() &&
            res.$ === "Def" &&
            (res._0.$ === "Struct" || res._0.$ === "Enum" || res._0.$ === "Union" || res._0.$ === "ForeignTy");
          // Show a different error message for items that can have associated items.
          const label = `\`${display_Ident(ident)}\` is ${def_Res.article(res)} ${def_Res.descr(res)}, not a module${
            import_inherent_item_error_flag ? " or a trait" : ""
          }`;
          let scope: string;
          if (segment_idx >= 1) {
            const prev = path[segment_idx - 1]!;
            if (prev.ident.name === kw.PathRoot) {
              scope = "the crate root";
            } else {
              scope = `\`${display_Ident(prev.ident)}\``;
            }
          } else {
            scope = "this scope";
          }
          // FIXME: reword, as the reason we expected a module is because of
          // the following path segment.
          const message = `cannot find module \`${display_Ident(ident)}\` in ${scope}`;
          const note = import_inherent_item_error_flag ? "cannot import inherent associated items, only trait associated items" : undefined;
          return [message, label, undefined, note, undefined];
        });
      }
    } else if (binding._0 === "Undetermined" && finalize === undefined) {
      return PathResult.Indeterminate;
    } else {
      let m: Module | undefined;
      if (module !== undefined && module.$ === "Module" && ((m = module._0), true) && opt_ns !== undefined && !m.is_normal()) {
        return { $: "NonModule", _0: PartialRes.with_unresolved_segments(unwrap(m.res()), path.length - segment_idx) };
      }

      const this_ = RefOrMut.reborrow(this);
      const module_ = module;
      return PathResult.failed(ident, is_last, finalize !== undefined, module_had_parse_errors, module_, () => {
        const [message, label, suggestion, help] = RefOrMut.get_mut(this_).report_path_resolution_error(
          path,
          opt_ns,
          parent_scope,
          ribs,
          ignore_decl,
          ignore_import,
          module_,
          segment_idx,
          ident,
          diag_metadata,
        );
        return [message, label, suggestion, undefined, help];
      });
    }
  }

  if (finalize !== undefined) {
    RefOrMut.get_mut(this).lint_if_path_starts_with_module(finalize, path, second_binding);
  }

  if (module !== undefined) {
    return { $: "Module", _0: module };
  } else if (path.length === 0) {
    return { $: "Module", _0: ModuleOrUniformRootC.CurrentScope };
  }
  return bug(`resolve_path: non-empty path \`${debug_vec(path, PLAIN, debug_Segment)}\` has no module`);
};
