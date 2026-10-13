// Port of compiler/rustc_resolve/src/build_reduced_graph.rs
//! After we obtain a fresh AST fragment from a macro, code in this module helps to integrate
//! that fragment into the module structures that are already partially built.
//!
//! Items from the fragment are placed into modules,
//! unexpanded macros in the fragment are visited and registered.
//! Imports are also considered items and placed into modules here, but not resolved yet.
//
// The methods of this file belong to the split classes `Resolver` and `DefCollector` (./decls.ts, the
// contract, docs/handoff/res-lib.md) and are assigned onto their prototypes below.
// Init order: top-level code here touches only `./decls.ts` and other crates; other rustc_resolve
// modules' exports are read inside function bodies only.
//
// PORT: `ParentScope` is `Copy`; where upstream copies `self.parent_scope` into storage or a new struct
// the port copies it (`clone_ParentScope`), because `DefCollector` edits its own `parent_scope` in place.
import {
  type AssocItem,
  type AssocItemKind,
  attr,
  type Attribute,
  type Block,
  clone_Generics,
  clone_Path,
  clone_Visibility,
  type FieldDef,
  type ForeignItem,
  type Item,
  type MacroDef,
  Path,
  UseTree,
  type Visibility as AstVisibility,
  VariantData,
  type Variant,
  DUMMY_NODE_ID,
} from "../rustc_ast/lib.ts";
import { debug_NodeId, type NodeId, NodeId as NodeIdC } from "../rustc_ast/node_id.ts";
import { type AssocCtxt, walk_assoc_item, walk_block, walk_field_def, walk_item, walk_variant, WalkItemKind } from "../rustc_ast/visit.ts";
import type { Attribute as HirAttribute } from "../rustc_attr_ir/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { SyntaxExtension } from "../rustc_expand/base.ts";
import { CtorKind, DefKind, debug_Res, MacroKinds, type Namespace, PerNS, Res as def_Res } from "../rustc_hir/def.ts";
import { type AmbigModChild, type ModChild, PartialRes, Reexport } from "../rustc_middle/middle/resolve.ts";
import type { TyCtxtFeed } from "../rustc_middle/ty/context.ts";
import { Visibility } from "../rustc_middle/ty/mod.ts";
import { CRATE_MOD_ID, CrateNum, type DefId, LocalDefId, type LocalModId, ModId } from "../rustc_span/def_id.ts";
import type { Edition } from "../rustc_span/edition.ts";
import { type ExpnId, LocalExpnId, type MacroKind } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Ident, Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { DefCollector, Resolver } from "./decls.ts";
import * as gen from "./lib.gen.ts";
import type {
  BindingKey as BindingKeyT,
  Decl,
  DeclData as DeclDataT,
  ExternModule,
  LocalModule,
  Module,
  ModuleOrUniformRoot,
  ParentScope,
  Res,
  ResolutionTable,
  Segment as SegmentT,
  VisResolutionError,
} from "./lib.ts";
import type { Import, ImportKind, NameResolutionRef } from "./imports.ts";
import type { MacroRulesScopeRef } from "./macros.ts";
import * as lib from "./lib.ts";
import * as imports from "./imports.ts";
import * as diagnostics from "./diagnostics/mod.ts";
import * as diagnostics_impls from "./diagnostics/impls.ts";

/** `map[&key]` (`impl Index for HashMap`): panics when the key is absent. */
function index_map<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined && !map.has(key)) return panic("key not found");
  return v as V;
}

/** PORT: stand-in for `rustc_metadata::creader::LoadedMacro` (rustc_metadata is wave 11). */
type LoadedMacro =
  | { readonly $: "MacroDef"; def: MacroDef; ident: Ident; attrs: HirAttribute[]; span: Span; edition: Edition }
  | { readonly $: "ProcMacro"; _0: SyntaxExtension };

// impl<'ra, 'tcx> Resolver<'ra, 'tcx>

/// Attempt to put the declaration with the given name and namespace into the module,
/// and report an error in case of a collision.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:49 plant_decl_into_local_module
Resolver.prototype.plant_decl_into_local_module = function (this: Resolver, ident: gen.IdentKey, orig_ident_span: Span, ns: Namespace, decl: Decl): void {
  const r = this.try_plant_decl_into_local_module(ident, orig_ident_span, ns, decl);
  if (r.$ === "Err") {
    const old_decl = r._0;
    this.report_conflict(ident, ns, old_decl, decl);
  }
};

/// Create a name definition from the given components, and put it into the local module.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:64 define_local
Resolver.prototype.define_local = function (
  this: Resolver,
  parent: LocalModule,
  orig_ident: Ident,
  ns: Namespace,
  res: Res,
  vis: Visibility,
  span: Span,
  expn_id: LocalExpnId,
): void {
  const decl = this.arenas.new_def_decl(res, Visibility.to_mod_id(vis), span, expn_id, parent.to_module());
  const ident = lib.IdentKey.new(orig_ident);
  this.plant_decl_into_local_module(ident, orig_ident.span, ns, decl);
};

/// Walks up the tree of definitions starting at `def_id`,
/// stopping at the first encountered module.
/// Parent block modules for arbitrary def-ids are not recorded for the local crate,
/// and are not preserved in metadata for foreign crates, so block modules are never
/// returned by this function.
///
/// For the local crate ignoring block modules may be incorrect, so use this method with care.
///
/// For foreign crates block modules can be ignored without introducing observable differences,
/// moreover they has to be ignored right now because they are not kept in metadata.
/// Foreign parent modules are used for resolving names used by foreign macros with def-site
/// hygiene, therefore block module ignorability relies on macros with def-site hygiene and
/// block module parents being unreachable from other crates.
/// Reachable macros with block module parents exist due to `#[macro_export] macro_rules!`,
/// but they cannot use def-site hygiene, so the assumption holds
/// (<https://github.com/rust-lang/rust/pull/77984#issuecomment-712445508>).
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:96 get_nearest_non_block_module
Resolver.prototype.get_nearest_non_block_module = function (this: Resolver, def_id: DefId): Module {
  for (;;) {
    const module = this.get_module(def_id);
    if (module !== undefined) {
      return module;
    } else {
      def_id = this.tcx_.parent(def_id);
    }
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:105 expect_module
Resolver.prototype.expect_module = function (this: Resolver, def_id: DefId): Module {
  return unwrap(this.get_module(def_id), "argument `DefId` is not a module");
};

/// If `def_id` refers to a module (in resolver's sense, i.e. a module item, crate root, enum,
/// or trait), then this function returns that module's resolver representation, otherwise it
/// returns `None`.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:112 get_module
Resolver.prototype.get_module = function (this: Resolver, def_id: DefId): Module | undefined {
  const local_def_id = def_id.as_local();
  if (local_def_id !== undefined) {
    return this.local_module_map.get(local_def_id)?.to_module();
  } else {
    const module = this.extern_module_map.get(def_id);
    if (module !== undefined) {
      return module.to_module();
    }
    // We need the lock on the extern_module_map for the entire duration of this call.
    // It is otherwise entirely possible 2 different threads will create and allocate
    // the exact same module during speculative resolution.
    // FIXME(parallel_import_resolution): We lock the entire map to make sure
    // no 2+ threads try to create the exact same module. Could it be possible to
    // only "lock on" `def_id`?
    // PORT: the `RwLock` is erased; the write guard is the map itself.
    const lock = this.extern_module_map;
    // No reentrant locking possible, so do a recursive call with lock
    // passed as argument.
    return this.get_extern_module_with_lock(def_id, lock)?.to_module();
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:133 get_extern_module_with_lock
Resolver.prototype.get_extern_module_with_lock = function (this: Resolver, def_id: DefId, map_lock: Map<DefId, ExternModule>): ExternModule | undefined {
  const existing = map_lock.get(def_id);
  if (existing !== undefined) {
    return existing;
  }
  // Query `def_kind` is not used because query system overhead is too expensive here.
  const def_kind = this.cstore().def_kind_untracked(def_id);
  if (DefKind.is_module_like(def_kind)) {
    const opt_parent = this.tcx_.opt_parent(def_id);
    let parent: ExternModule | undefined = undefined;
    if (opt_parent !== undefined) {
      let parent_id = opt_parent;
      for (;;) {
        const module = this.get_extern_module_with_lock(parent_id, map_lock);
        if (module !== undefined) {
          parent = module;
          break;
        } else {
          parent_id = this.tcx_.parent(parent_id);
        }
      }
    }
    // Query `expn_that_defined` is not used because
    // hashing spans in its result is expensive.
    const expn_id = this.cstore().expn_that_defined_untracked(this.tcx_, def_id);
    const module = lib.ExternModule.new(
      parent,
      { $: "Def", _0: def_kind, _1: def_id, _2: DUMMY_NODE_ID, _3: this.tcx_.item_name(def_id) },
      this.tcx_.visibility(def_id),
      expn_id,
      this.def_span(def_id),
      // FIXME: Account for `#[no_implicit_prelude]` attributes.
      parent !== undefined && parent.no_implicit_prelude,
      this.arenas,
    );
    map_lock.set(def_id, module);
    return module;
  }

  return undefined;
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:172 expn_def_scope
Resolver.prototype.expn_def_scope = function (this: Resolver, expn_id: ExpnId): Module {
  const macro_def_id = expn_id.expn_data().macro_def_id;
  if (macro_def_id !== undefined) {
    return this.macro_def_scope(macro_def_id);
  } else {
    const local = expn_id.as_local();
    const scope = local === undefined ? undefined : this.ast_transform_scopes.get(local);
    return (scope ?? this.graph_root).to_module();
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:183 macro_def_scope
Resolver.prototype.macro_def_scope = function (this: Resolver, def_id: DefId): Module {
  const id = def_id.as_local();
  if (id !== undefined) {
    return index_map(this.local_macro_def_scopes, id).to_module();
  } else {
    return this.get_nearest_non_block_module(def_id);
  }
};

/// Gets the `SyntaxExtension` corresponding to `res`.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:192 get_macro
Resolver.prototype.get_macro = function (this: Resolver, res: Res): SyntaxExtension | undefined {
  if (res.$ === "Def" && res._0.$ === "Macro") {
    return this.get_macro_by_def_id(res._1);
  } else if (res.$ === "NonMacroAttr") {
    return this.non_macro_attr;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:200 get_macro_by_def_id
Resolver.prototype.get_macro_by_def_id = function (this: Resolver, def_id: DefId): SyntaxExtension {
  // Local macros are always compiled.
  const local_def_id = def_id.as_local();
  if (local_def_id !== undefined) {
    return index_map(this.local_macro_map, local_def_id);
  } else {
    // `self.extern_macro_map.borrow_mut().entry(def_id).or_insert_with(..)`
    const map = this.extern_macro_map;
    const existing = map.get(def_id);
    if (existing !== undefined) return existing;
    const loaded_macro = this.cstore().load_macro_untracked(this.tcx_, def_id) as unknown as LoadedMacro;
    let ext: SyntaxExtension;
    switch (loaded_macro.$) {
      case "MacroDef": {
        const { def, ident, attrs, span, edition } = loaded_macro;
        ext = this.compile_macro(def, ident, attrs, span, DUMMY_NODE_ID, edition);
        break;
      }
      case "ProcMacro":
        ext = loaded_macro._0;
        break;
    }

    const v = this.arenas.alloc_macro(ext);
    map.set(def_id, v);
    return v;
  }
};

/// Add every proc macro accessible from the current crate to the `macro_map` so diagnostics can
/// find them for suggestions.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:220 register_macros_for_all_crates
Resolver.prototype.register_macros_for_all_crates = function (this: Resolver): void {
  if (!this.all_crate_macros_already_registered) {
    for (const def_id of this.cstore().all_proc_macro_def_ids(this.tcx_)) {
      this.get_macro_by_def_id(def_id);
    }
    this.all_crate_macros_already_registered = true;
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:229 try_resolve_visibility
Resolver.prototype.try_resolve_visibility = function (
  this: Resolver,
  parent_scope: ParentScope,
  vis: AstVisibility,
  finalize: boolean,
): Result<Visibility, VisResolutionError> {
  const vis_kind = vis.kind;
  switch (vis_kind.$) {
    case "Public":
      return Ok(Visibility.Public);
    case "Inherited": {
      const kind = parent_scope.module.expect_local().kind;
      // Any inherited visibility resolved directly inside an enum or trait
      // (i.e. variants, fields, and trait items) inherits from the visibility
      // of the enum or trait.
      if (kind.$ === "Def" && (kind._0.$ === "Enum" || kind._0.$ === "Trait")) {
        const def_id = kind._1;
        return Ok(Visibility.expect_local(this.tcx_.visibility(def_id)));
      }
      // Otherwise, the visibility is restricted to the nearest parent `mod` item.
      return Ok(Visibility.Restricted(parent_scope.module.nearest_parent_mod().expect_local()));
    }
    case "Restricted": {
      const path = vis_kind.path;
      const id = vis_kind.id;
      // For visibilities we are not ready to provide correct implementation of "uniform
      // paths" right now, so on 2018 edition we only allow module-relative paths for now.
      // On 2015 edition visibilities are resolved as crate-relative by default,
      // so we are prepending a root segment if necessary.
      const ident = unwrap(path.segments[0], "empty path in visibility").ident;
      let crate_root: SegmentT | undefined;
      if (ident.is_path_segment_keyword()) {
        crate_root = undefined;
      } else if (Span.is_rust_2015(ident.span)) {
        crate_root = lib.Segment.from_ident(Ident.new(kw.PathRoot, Span.with_ctxt(Span.shrink_to_lo(path.span), Span.ctxt(ident.span))));
      } else {
        return Err({ $: "Relative2018", _0: ident.span, _1: clone_Path(path) });
      }
      const segments: SegmentT[] = [...(crate_root === undefined ? [] : [crate_root]), ...path.segments.map((seg) => lib.Segment.from(seg))];
      const expected_found_error = (res: Res): Result<Visibility, VisResolutionError> =>
        Err({ $: "ExpectedFound", _0: path.span, _1: lib.Segment.names_to_string(segments), _2: res });
      const path_res = this.cm_mut().resolve_path(segments, undefined, parent_scope, finalize ? lib.Finalize.new(id, path.span) : undefined, undefined, undefined);
      switch (path_res.$) {
        case "Module": {
          if (path_res._0.$ === "Module") {
            const module = path_res._0._0;
            const res = unwrap(module.res(), "visibility resolved to unnamed block");
            if (module.is_normal()) {
              if (res.$ === "Err") {
                if (finalize) {
                  this.record_partial_res(id, PartialRes.new(res));
                }
                return Ok(Visibility.Public);
              } else {
                const vis = Visibility.Restricted(ModId.new_unchecked(def_Res.def_id(res, debug_NodeId)));
                if (this.is_accessible_from(vis, parent_scope.module)) {
                  if (finalize) {
                    this.record_partial_res(id, PartialRes.new(res));
                  }
                  return Ok(Visibility.expect_local(vis));
                } else {
                  return Err({ $: "AncestorOnly", _0: path.span });
                }
              }
            } else {
              return expected_found_error(res);
            }
          }
          return Err({ $: "ModuleOnly", _0: path.span });
        }
        case "NonModule": {
          const partial_res = path_res._0;
          return expected_found_error(partial_res.expect_full_res());
        }
        case "Failed": {
          const { label, suggestion, help, message, segment } = path_res;
          return Err({
            $: "FailedToResolve",
            span: segment.span,
            segment: segment.name,
            label,
            suggestion,
            help,
            message,
          });
        }
        case "Indeterminate":
          return Err({ $: "Indeterminate", _0: path.span });
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:336 build_reduced_graph_external
Resolver.prototype.build_reduced_graph_external = function (this: Resolver, module: ExternModule): ResolutionTable {
  const resolutions = lib.new_ResolutionTable();
  const def_id = module.def_id();
  const children = this.tcx_.module_children(def_id);
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    this.build_reduced_graph_for_external_crate_res(child, module, i, undefined, resolutions);
  }
  let i = 0;
  for (const child of this.cstore().ambig_module_children_untracked(this.tcx_, def_id) as Iterable<AmbigModChild>) {
    this.build_reduced_graph_for_external_crate_res(child.main, module, children.length + i, child.second, resolutions);
    i++;
  }
  return resolutions;
};

/// Builds the reduced graph for a single item in an external crate.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:367 build_reduced_graph_for_external_crate_res
Resolver.prototype.build_reduced_graph_for_external_crate_res = function (
  this: Resolver,
  child: ModChild,
  parent: ExternModule,
  child_index: number,
  ambig_child: ModChild | undefined,
  resolutions: Map<BindingKeyT, NameResolutionRef>,
): void {
  const child_span = (this_: Resolver, reexport_chain: readonly Reexport[], res: ModChild["res"]): Span => {
    const first = reexport_chain[0];
    const reexport_id = first === undefined ? undefined : Reexport.id(first);
    return this_.def_span(reexport_id ?? def_Res.def_id(res, (x: never) => x));
  };
  const { ident: orig_ident, res: res0, vis, reexport_chain } = child;
  const ident = lib.IdentKey.new(orig_ident);
  const span = child_span(this, reexport_chain, res0);
  const res = def_Res.expect_non_local<never, NodeId>(res0);
  const expansion = LocalExpnId.ROOT;
  let ambig: [Decl, boolean] | undefined = undefined;
  if (ambig_child !== undefined) {
    const { res: ares0, vis: avis, reexport_chain: areexport_chain } = ambig_child;
    const aspan = child_span(this, areexport_chain, ares0);
    const ares = def_Res.expect_non_local<never, NodeId>(ares0);
    // External ambiguities always report the `AMBIGUOUS_GLOB_IMPORTS` lint at the moment.
    ambig = [this.arenas.new_def_decl(ares, avis, aspan, expansion, parent.to_module()), true];
  }

  // Record primary definitions.
  const define_extern = (ns: Namespace): void => {
    const orig_ident_span = orig_ident.span;
    // PORT: `self.arenas.dropless.alloc_slice(reexport_chain)` -> a copy of the slice.
    const reexport_chain_: readonly Reexport[] = reexport_chain.length !== 0 ? reexport_chain.slice() : [];
    const decl = this.arenas.alloc_decl(
      new gen.DeclData(
        { $: "Def", _0: res, _1: reexport_chain_ },
        lib.CmCell.new(ambig),
        expansion,
        span,
        vis,
        lib.CmCell.new<Decl | undefined>(undefined),
        lib.CmCell.new<Decl | undefined>(undefined),
        parent.to_module(),
      ),
    );
    const resolution = this.arenas.alloc_name_resolution(new imports.NameResolution(new Set(), decl, undefined, orig_ident_span));

    const key = lib.BindingKey.new_disambiguated(ident, ns, () => child_index + 1);
    const had = resolutions.has(key);
    resolutions.set(key, resolution);
    if (had) {
      span_bug(span, "an external binding was already defined");
    }
  };
  if (res.$ === "Def") {
    switch (res._0.$) {
      case "Mod":
      case "Enum":
      case "Trait":
      case "Struct":
      case "Union":
      case "Variant":
      case "TyAlias":
      case "ForeignTy":
      case "OpaqueTy":
      case "TraitAlias":
      case "AssocTy":
        return define_extern("TypeNS");
      case "Fn":
      case "AssocFn":
      case "Static":
      case "Const":
      case "AssocConst":
      case "Ctor":
        return define_extern("ValueNS");
      case "Macro":
        return define_extern("MacroNS");
      case "TyParam":
      case "ConstParam":
      case "ExternCrate":
      case "Use":
      case "ForeignMod":
      case "AnonConst":
      case "Field":
      case "LifetimeParam":
      case "GlobalAsm":
      case "Closure":
      case "SyntheticCoroutineBody":
      case "Impl":
      case "TestBinderConstraints":
        return bug(`unexpected resolution: ${debug_Res(res, PLAIN, debug_NodeId)}`);
    }
  }
  switch (res.$) {
    case "PrimTy":
    case "ToolMod":
      return define_extern("TypeNS");
    case "NonMacroAttr":
      return define_extern("MacroNS");
    case "Local":
    case "SelfTyParam":
    case "SelfTyAlias":
    case "SelfCtor":
    case "OpenMod":
    case "Err":
      return bug(`unexpected resolution: ${debug_Res(res, PLAIN, debug_NodeId)}`);
  }
};

// impl<'ra, 'tcx> AsMut<Resolver<'ra, 'tcx>> for DefCollector<'_, 'ra, 'tcx>
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:481 as_mut
DefCollector.prototype.as_mut = function (this: DefCollector): Resolver {
  return this.r;
};

// impl<'a, 'ra, 'tcx> DefCollector<'a, 'ra, 'tcx>

// PORT: `def_id: impl Into<DefId>` -> a `DefId` (callers convert a `LocalDefId` with `to_def_id`).
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:487 res
DefCollector.prototype.res = function (this: DefCollector, def_id: DefId): Res {
  return { $: "Def", _0: this.r.tcx_.def_kind(def_id), _1: def_id };
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:492 resolve_visibility
DefCollector.prototype.resolve_visibility = function (this: DefCollector, vis: AstVisibility): Visibility {
  const r = this.r.try_resolve_visibility(this.parent_scope, vis, false);
  if (r.$ === "Ok") {
    return r._0;
  } else {
    const error = r._0;
    this.r.delayed_vis_resolution_errors.push({
      vis: clone_Visibility(vis),
      parent_scope: lib.clone_ParentScope(this.parent_scope),
      error,
    });
    return Visibility.Public;
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:506 insert_field_idents
DefCollector.prototype.insert_field_idents = function (this: DefCollector, def_id: LocalDefId, fields: readonly FieldDef[]): void {
  if (fields.some((field) => field.is_placeholder)) {
    // The fields are not expanded yet.
    return;
  }
  const field_name = (i: number, field: FieldDef): Ident => field.ident ?? Ident.from_str_and_span(`${i}`, field.span);
  const field_names: Ident[] = fields.map((field, i) => field_name(i, field));
  const defaults: Symbol[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field.default_value() !== undefined) defaults.push(field_name(i, field).name);
  }
  this.r.field_names.set(def_id, field_names);
  this.r.field_defaults_.set(def_id, defaults);
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:525 insert_field_visibilities_local
DefCollector.prototype.insert_field_visibilities_local = function (this: DefCollector, def_id: DefId, fields: readonly FieldDef[]): void {
  const field_vis = fields.map((field) => Span.until(field.vis.span, field.ident === undefined ? field.ty.span : field.ident.span));
  this.r.field_visibility_spans.set(def_id, field_vis);
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:533 block_needs_anonymous_module
DefCollector.prototype.block_needs_anonymous_module = function (this: DefCollector, block: Block): boolean {
  // If any statements are items, we need to create an anonymous module
  return block.stmts.some((statement) => statement.kind.$ === "Item" || statement.kind.$ === "MacCall");
};

// Add an import to the current module.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:542 add_import
DefCollector.prototype.add_import = function (
  this: DefCollector,
  module_path: SegmentT[],
  kind: ImportKind,
  span: Span,
  item: Item,
  root_span: Span,
  root_id: NodeId,
  vis: Visibility,
): void {
  const current_module = this.parent_scope.module.expect_local();
  const import_ = this.r.arenas.alloc_import(
    new imports.ImportData(
      kind,
      root_id,
      item.span,
      item.span_with_attributes(),
      item.attrs.length !== 0,
      span,
      root_span,
      lib.clone_ParentScope(this.parent_scope),
      module_path,
      lib.CmCell.new<ModuleOrUniformRoot | undefined>(undefined),
      vis,
      item.vis.span,
      diagnostics_impls.OnUnknownData.from_attrs(this.r, item.attrs),
    ),
  );

  this.r.indeterminate_imports.push([import_, undefined, 0]);
  const import_kind = import_.kind;
  switch (import_kind.$) {
    case "Single": {
      const target = import_kind.target;
      // Don't add underscore imports to `single_imports`
      // because they cannot define any usable names.
      if (target.name !== kw.Underscore) {
        this.r.per_ns_mut((this_, ns) => {
          const key = lib.BindingKey.new(lib.IdentKey.new(target), ns);
          this_.resolution_or_default(current_module.to_module(), key, target.span).borrow_mut(this_).value.single_imports.add(import_);
        });
      }
      break;
    }
    case "Glob":
      current_module.globs.borrow_mut(this.r).value.push(import_);
      break;
    default:
      unreachable();
  }
};

/// Note:
/// - `item` is the top-level `use` item.
/// - `use_tree` is the particular use tree within the top-level `use` item.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:592 build_reduced_graph_for_use_tree
DefCollector.prototype.build_reduced_graph_for_use_tree = function (
  this: DefCollector,
  item: Item,
  use_tree: UseTree,
  id: NodeId,
  parent_prefix: readonly SegmentT[],
  nested: boolean,
  list_stem: boolean,
  vis: Visibility,
  root_span: Span,
  feed: TyCtxtFeed<LocalDefId>,
): void {
  // debug!("build_reduced_graph_for_use_tree(parent_prefix={:?}, use_tree={:?}, nested={})", parent_prefix, use_tree, nested);

  // Top level use tree reuses the item's id and list stems reuse their parent
  // use tree's ids, so in both cases their visibilities are already filled.
  if (nested && !list_stem) {
    this.r.feed_visibility(feed, vis);
  }

  const prefix_iter: SegmentT[] = [...parent_prefix.map(gen.clone_Segment), ...use_tree.prefix.segments.map((seg) => lib.Segment.from(seg))];

  // On 2015 edition imports are resolved as crate-relative by default,
  // so prefixes are prepended with crate root segment if necessary.
  // The root is prepended lazily, when the first non-empty prefix or terminating glob
  // appears, so imports in braced groups can have roots prepended independently.
  const peeked = prefix_iter[0];
  let crate_root_ctxt: ReturnType<typeof Span.ctxt> | undefined;
  if (peeked !== undefined) {
    const seg = peeked;
    if (!seg.ident.is_path_segment_keyword() && Span.is_rust_2015(seg.ident.span)) {
      crate_root_ctxt = Span.ctxt(seg.ident.span);
    } else {
      crate_root_ctxt = undefined;
    }
  } else if (use_tree.kind.$ === "Glob" && Span.is_rust_2015(use_tree.kind._0)) {
    crate_root_ctxt = Span.ctxt(use_tree.kind._0);
  } else {
    crate_root_ctxt = undefined;
  }
  const crate_root =
    crate_root_ctxt === undefined
      ? undefined
      : lib.Segment.from_ident(Ident.new(kw.PathRoot, Span.with_ctxt(Span.shrink_to_lo(use_tree.prefix.span), crate_root_ctxt)));

  const prefix: SegmentT[] = [...(crate_root === undefined ? [] : [crate_root]), ...prefix_iter];
  // debug!("build_reduced_graph_for_use_tree: prefix={:?}", prefix);

  const use_tree_kind = use_tree.kind;
  switch (use_tree_kind.$) {
    case "Simple": {
      const rename = use_tree_kind._0;
      const module_path = prefix;
      const source = unwrap(module_path.pop());

      // If the identifier is `self` without a rename,
      // then it is replaced with the parent identifier.
      let ident: Ident;
      const parent0 = module_path[module_path.length - 1];
      if (source.ident.name === kw.SelfLower && rename === undefined && parent0 !== undefined) {
        ident = Ident.new(parent0.ident.name, source.ident.span);
      } else {
        ident = use_tree.ident();
      }

      const parent_last = module_path[module_path.length - 1];
      if (source.ident.name === kw.DollarCrate) {
        if (module_path.length !== 0) {
          this.r.dcx().span_err(source.ident.span, "`$crate` in paths can only be used in start position");
          return;
        }
      } else if (source.ident.name === kw.Crate) {
        if (module_path.length !== 0) {
          this.r.dcx().span_err(source.ident.span, "`crate` in paths can only be used in start position");
          return;
        }
      } else if (source.ident.name === kw.Super) {
        // Allow `self::super` as a valid prefix - `self` at position 0
        // followed by any number of `super` segments.
        const valid_prefix = module_path.every((seg, i) => {
          const name = seg.ident.name;
          return name === kw.Super || (name === kw.SelfLower && i === 0);
        });

        if (!valid_prefix) {
          this.r
            .dcx()
            .span_err(source.ident.span, "`super` in paths can only be used in start position, after `self`, or after another `super`");
          return;
        }
      } else if (
        // Deny `use ::{self};` after edition 2015
        source.ident.name === kw.SelfLower &&
        parent_last !== undefined &&
        parent_last.ident.name === kw.PathRoot &&
        !this.r.path_root_is_crate_root(parent_last.ident)
      ) {
        this.r.dcx().span_err(use_tree.span(), "extern prelude cannot be imported");
        return;
      }

      // Deny `use ...::self::source [as target];` or `use ...::self::self [as target];`,
      // but allow `use self::source [as target];` and `use self::self as target;`.
      const parent = module_path[module_path.length - 1];
      if (parent !== undefined && parent.ident.name === kw.SelfLower && module_path.length > 1) {
        this.r.dcx().span_err(parent.ident.span, "`self` in paths can only be used in start position or last position");
        return;
      }

      // Deny importing path-kw without renaming
      if (rename === undefined && ident.is_path_segment_keyword()) {
        const ident = use_tree.ident();
        this.r.dcx().emit_err(
          diagnostics.UnnamedImport_diagnostic({
            span: ident.span,
            sugg: { span: ident.span, ident },
          }),
        );
        return;
      }

      const kind: ImportKind = {
        $: "Single",
        source: source.ident,
        target: ident,
        decls: new PerNS(
          lib.CmCell.new<imports.PendingDecl>(imports.PendingDecl.Pending),
          lib.CmCell.new<imports.PendingDecl>(imports.PendingDecl.Pending),
          lib.CmCell.new<imports.PendingDecl>(imports.PendingDecl.Pending),
        ),
        nested,
        id,
        def_id: feed.def_id(),
      };

      this.add_import(module_path, kind, use_tree.span(), item, root_span, item.id, vis);
      break;
    }
    case "Glob": {
      if (!attr.contains_name(item.attrs, sym.prelude_import)) {
        const kind: ImportKind = { $: "Glob", max_vis: lib.CmCell.new<Visibility<LocalModId> | undefined>(undefined), id, def_id: feed.def_id() };
        this.add_import(prefix, kind, use_tree.span(), item, root_span, item.id, vis);
      } else {
        // Resolve the prelude import early.
        const path_res = this.r.cm().maybe_resolve_path(prefix, undefined, this.parent_scope, undefined);
        if (path_res.$ === "Module" && path_res._0.$ === "Module") {
          const module = path_res._0._0;
          this.r.prelude = module;
        } else {
          this.r.dcx().span_err(use_tree.span(), "cannot resolve a prelude import");
        }
      }
      break;
    }
    case "Nested": {
      const items = use_tree_kind.items;
      for (const tree of items) {
        const id = tree.id;
        const feed = this.create_def(id, undefined, DefKind.Use, use_tree.span());
        this.build_reduced_graph_for_use_tree(item, tree.inner, id, prefix, true, false, vis, root_span, feed);
      }

      // Empty groups `a::b::{}` are turned into synthetic `self` imports
      // `a::b::c::{self as _}`, so that their prefixes are correctly
      // resolved and checked for privacy/stability/etc.
      if (items.length === 0 && prefix.length !== 0 && (prefix.length > 1 || prefix[0]!.ident.name !== kw.PathRoot)) {
        const new_span = prefix[prefix.length - 1]!.ident.span;
        const tree = new UseTree(Path.from_ident(Ident.new(kw.SelfLower, new_span)), { $: "Simple", _0: Ident.new(kw.Underscore, new_span) });
        const vis = Visibility.Restricted(this.parent_scope.module.nearest_parent_mod().expect_local());
        this.build_reduced_graph_for_use_tree(item, tree, id, prefix, true, true, vis, root_span, feed);
      }
      break;
    }
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:799 build_reduced_graph_for_struct_variant
DefCollector.prototype.build_reduced_graph_for_struct_variant = function (
  this: DefCollector,
  fields: readonly FieldDef[],
  ident: Ident,
  feed: TyCtxtFeed<LocalDefId>,
  adt_res: Res,
  adt_vis: Visibility,
  adt_span: Span,
): void {
  const parent_scope = this.parent_scope;
  const parent = parent_scope.module.expect_local();
  const expansion = parent_scope.expansion;

  // Define a name in the type namespace if it is not anonymous.
  this.r.define_local(parent, ident, "TypeNS", adt_res, adt_vis, adt_span, expansion);
  this.r.feed_visibility(feed, adt_vis);
  const def_id = feed.key();

  // Record field names for error reporting.
  this.insert_field_idents(def_id, fields);
  this.insert_field_visibilities_local(LocalDefId.to_def_id(def_id), fields);
};

/// Constructs the reduced graph for one item.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:823 build_reduced_graph_for_item
DefCollector.prototype.build_reduced_graph_for_item = function (this: DefCollector, item: Item, feed: TyCtxtFeed<LocalDefId>): void {
  const parent_scope = this.parent_scope;
  const parent = parent_scope.module.expect_local();
  const expansion = parent_scope.expansion;
  const sp = item.span;
  const vis = this.resolve_visibility(item.vis);
  const local_def_id = feed.key();
  const def_id = LocalDefId.to_def_id(local_def_id);
  const def_kind = this.r.tcx_.def_kind(def_id);
  const res: Res = { $: "Def", _0: def_kind, _1: def_id };

  this.r.feed_visibility(feed, vis);

  const kind = item.kind;
  switch (kind.$) {
    case "Use": {
      const use_tree = kind._0;
      this.build_reduced_graph_for_use_tree(item, use_tree, item.id, [], false, false, vis, use_tree.span(), feed);
      break;
    }

    case "ExternCrate": {
      const orig_name = kind._0;
      const ident = kind._1;
      this.build_reduced_graph_for_extern_crate(orig_name, item, ident, local_def_id, vis);
      break;
    }

    case "Mod": {
      const ident = kind._1;
      const mod_kind = kind._2;
      this.r.define_local(parent, ident, "TypeNS", res, vis, sp, expansion);

      if (mod_kind.$ === "Loaded" && mod_kind._1.$ === "No" && mod_kind._1.had_parse_error.$ === "Err") {
        this.r.mods_with_parse_errors.add(def_id);
      }
      const module = this.r.new_local_module(
        parent,
        { $: "Def", _0: def_kind, _1: def_id, _2: item.id, _3: ident.name },
        LocalExpnId.to_expn_id(expansion),
        item.span,
        parent.no_implicit_prelude || attr.contains_name(item.attrs, sym.no_implicit_prelude),
      );
      this.parent_scope.module = module.to_module();
      const directive = diagnostics_impls.OnUnknownData.from_attrs(this.r, item.attrs);
      if (directive !== undefined) {
        this.r.on_unknown_data_.set(local_def_id, directive);
      }
      break;
    }

    // These items live in the value namespace.
    case "Const":
    case "Delegation":
    case "Static": {
      const ident = kind._0.ident;
      this.r.define_local(parent, ident, "ValueNS", res, vis, sp, expansion);
      break;
    }
    case "Fn": {
      const ident = kind._0.ident;
      this.r.define_local(parent, ident, "ValueNS", res, vis, sp, expansion);

      // Functions introducing procedural macros reserve a slot
      // in the macro namespace as well (see #52225).
      this.define_macro(item, feed);
      break;
    }

    // These items live in the type namespace.
    case "TyAlias":
    case "TraitAlias": {
      const ident = kind._0.ident;
      this.r.define_local(parent, ident, "TypeNS", res, vis, sp, expansion);
      break;
    }

    case "Enum":
    case "Trait": {
      const ident = kind.$ === "Enum" ? kind._0 : kind._0.ident;
      this.r.define_local(parent, ident, "TypeNS", res, vis, sp, expansion);

      const module = this.r.new_local_module(
        parent,
        { $: "Def", _0: def_kind, _1: def_id, _2: item.id, _3: ident.name },
        LocalExpnId.to_expn_id(expansion),
        item.span,
        parent.no_implicit_prelude,
      );
      this.parent_scope.module = module.to_module();
      break;
    }

    // These items live in both the type and value namespaces.
    case "Struct": {
      const ident = kind._0;
      const generics = kind._1;
      const vdata = kind._2;
      this.build_reduced_graph_for_struct_variant(VariantData.fields(vdata), ident, feed, res, vis, sp);

      // If this is a tuple or unit struct, define a name
      // in the value namespace as well.
      const ctor = CtorKind.from_ast(vdata);
      if (ctor !== undefined) {
        const [ctor_kind, ctor_node_id] = ctor;
        // If the structure is marked as non_exhaustive then lower the visibility
        // to within the crate.
        let ctor_vis: Visibility =
          Visibility.is_public(vis) && attr.contains_name(item.attrs, sym.non_exhaustive) ? Visibility.Restricted(CRATE_MOD_ID) : vis;

        const field_visibilities: Visibility<ModId>[] = [];

        for (const field of VariantData.fields(vdata)) {
          // NOTE: The field may be an expansion placeholder, but expansion sets
          // correct visibilities for unnamed field placeholders specifically, so the
          // constructor visibility should still be determined correctly.
          const fr = this.r.try_resolve_visibility(this.parent_scope, field.vis, false);
          const field_vis: Visibility = fr.$ === "Ok" ? fr._0 : Visibility.Public;
          if (Visibility.greater_than(ctor_vis, field_vis, this.r.tcx_)) {
            ctor_vis = field_vis;
          }
          field_visibilities.push(Visibility.to_mod_id(field_vis));
        }
        // If this is a unit or tuple-like struct, register the constructor.
        const feed = this.create_def(ctor_node_id, undefined, { $: "Ctor", _0: "Struct", _1: ctor_kind }, item.span);

        const ctor_def_id = feed.key();
        const ctor_res = this.res(LocalDefId.to_def_id(ctor_def_id));
        this.r.define_local(parent, ident, "ValueNS", ctor_res, ctor_vis, sp, expansion);
        this.r.feed_visibility(feed, ctor_vis);
        // We need the field visibility spans also for the constructor for E0603.
        this.insert_field_visibilities_local(LocalDefId.to_def_id(ctor_def_id), VariantData.fields(vdata));

        const ctor_ = new diagnostics_impls.StructCtor(ctor_res, Visibility.to_mod_id(ctor_vis), field_visibilities);
        this.r.struct_ctors.set(local_def_id, ctor_);
      }
      this.r.struct_generics.set(local_def_id, clone_Generics(generics));
      break;
    }

    case "Union": {
      const ident = kind._0;
      const vdata = kind._2;
      this.build_reduced_graph_for_struct_variant(VariantData.fields(vdata), ident, feed, res, vis, sp);
      break;
    }

    // These items do not add names to modules.
    case "Impl":
    case "ForeignMod":
    case "GlobalAsm":
    case "ConstBlock":
    case "TestBinderConstraints":
      break;

    case "MacroDef":
    case "MacCall":
    case "DelegationMac":
      unreachable();
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1000 build_reduced_graph_for_extern_crate
DefCollector.prototype.build_reduced_graph_for_extern_crate = function (
  this: DefCollector,
  orig_name: Symbol | undefined,
  item: Item,
  orig_ident: Ident,
  local_def_id: LocalDefId,
  vis: Visibility,
): void {
  const sp = item.span;
  const parent_scope = lib.clone_ParentScope(this.parent_scope);
  const parent = parent_scope.module;
  const expansion = parent_scope.expansion;

  let opt_module: Module | undefined;
  if (orig_name === undefined && orig_ident.name === kw.SelfLower) {
    this.r.dcx().emit_err(diagnostics.ExternCrateSelfRequiresRenaming_diagnostic({ span: sp }));
    return;
  } else if (orig_name === kw.SelfLower) {
    opt_module = this.r.graph_root.to_module();
  } else {
    const tcx = this.r.tcx_;
    const crate_id = this.r.cstore_mut().process_extern_crate(this.r.tcx_, item, local_def_id, tcx.definitions_untracked());
    if (crate_id !== undefined) {
      this.r.extern_crate_map.set(local_def_id, crate_id);
      opt_module = this.r.expect_module(CrateNum.as_def_id(crate_id));
    } else {
      opt_module = undefined;
    }
  }
  let used: boolean;
  let module: ModuleOrUniformRoot | undefined;
  let decl: Decl;
  if (opt_module !== undefined) {
    const m = opt_module;
    const used_ = this.process_macro_use_imports(item, m);
    const decl_ = this.r.arenas.new_pub_def_decl(unwrap(m.res()), sp, expansion);
    [used, module, decl] = [used_, { $: "Module", _0: m }, decl_];
  } else {
    [used, module, decl] = [true, undefined, this.r.dummy_decl];
  }
  const import_ = this.r.arenas.alloc_import(
    new imports.ImportData(
      { $: "ExternCrate", source: orig_name, target: orig_ident, id: item.id, def_id: local_def_id },
      item.id,
      item.span,
      item.span_with_attributes(),
      item.attrs.length !== 0,
      item.span,
      item.span,
      parent_scope,
      [],
      lib.CmCell.new(module),
      vis,
      item.vis.span,
      diagnostics_impls.OnUnknownData.from_attrs(this.r, item.attrs),
    ),
  );
  if (used) {
    this.r.import_use_map.set(import_, "Other");
  }
  this.r.potentially_unused_imports.push(import_);
  const import_decl = this.r.new_import_decl(decl, import_);
  const ident = lib.IdentKey.new(orig_ident);
  if (ident.name !== kw.Underscore && parent === this.r.graph_root.to_module()) {
    // FIXME: this error is technically unnecessary now when extern prelude is split into
    // two scopes, remove it with lang team approval.
    const entry0 = this.r.extern_prelude.get(ident);
    if (entry0 !== undefined && expansion !== LocalExpnId.ROOT && orig_name !== undefined && entry0.item_decl === undefined) {
      this.r.dcx().emit_err(diagnostics.MacroExpandedExternCrateCannotShadowExternArguments_diagnostic({ span: item.span }));
    }

    // `use indexmap::map::Entry; match self.r.extern_prelude.entry(ident) { .. }`
    const entry = this.r.extern_prelude.get(ident);
    if (entry !== undefined) {
      if (entry.item_decl !== undefined) {
        const msg = `extern crate \`${display_Ident(orig_ident)}\` already in extern prelude`;
        this.r.tcx_.dcx().span_delayed_bug(item.span, msg);
      } else {
        entry.item_decl = [import_decl, orig_ident.span, orig_name !== undefined];
      }
    } else {
      this.r.extern_prelude.set(ident, new gen.ExternPreludeEntry([import_decl, orig_ident.span, true], undefined));
    }
  }
  this.r.plant_decl_into_local_module(ident, orig_ident.span, "TypeNS", import_decl);
};

/// Constructs the reduced graph for one foreign item.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1100 build_reduced_graph_for_foreign_item
DefCollector.prototype.build_reduced_graph_for_foreign_item = function (this: DefCollector, item: ForeignItem, ident: Ident, feed: TyCtxtFeed<LocalDefId>): void {
  const local_def_id = feed.key();
  const def_id = LocalDefId.to_def_id(local_def_id);
  let ns: Namespace;
  switch (item.kind.$) {
    case "Fn":
      ns = "ValueNS";
      break;
    case "Static":
      ns = "ValueNS";
      break;
    case "TyAlias":
      ns = "TypeNS";
      break;
    case "MacCall":
      return unreachable();
  }
  const parent = this.parent_scope.module.expect_local();
  const expansion = this.parent_scope.expansion;
  const vis = this.resolve_visibility(item.vis);
  this.r.define_local(parent, ident, ns, this.res(def_id), vis, item.span, expansion);
  this.r.feed_visibility(feed, vis);
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1121 build_reduced_graph_for_block
DefCollector.prototype.build_reduced_graph_for_block = function (this: DefCollector, block: Block): void {
  const parent = this.parent_scope.module.expect_local();
  const expansion = this.parent_scope.expansion;
  if (this.block_needs_anonymous_module(block)) {
    const module = this.r.new_local_module(parent, gen.ModuleKind.Block, LocalExpnId.to_expn_id(expansion), block.span, parent.no_implicit_prelude);
    this.r.block_map.set(block.id, module);
    this.parent_scope.module = module.to_module(); // Descend into the block.
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1137 add_macro_use_decl
DefCollector.prototype.add_macro_use_decl = function (this: DefCollector, name: Symbol, decl: Decl, span: Span, allow_shadowing: boolean): void {
  const had = this.r.macro_use_prelude.has(name);
  this.r.macro_use_prelude.set(name, decl);
  if (had && !allow_shadowing) {
    this.r.dcx().emit_err(diagnostics.MacroUseNameAlreadyInUse_diagnostic({ span, name }));
  }
};

/// Returns `true` if we should consider the underlying `extern crate` to be used.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1150 process_macro_use_imports
DefCollector.prototype.process_macro_use_imports = function (this: DefCollector, item: Item, module: Module): boolean {
  let import_all: Span | undefined = undefined;
  let single_imports: Ident[] = [];
  const parsed = AttributeParser.parse_limited_sym(this.r.tcx_.sess, item.attrs, [sym.macro_use]);
  if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "MacroUse") {
    const { span, arguments: arguments_ } = parsed._0;
    if (this.parent_scope.module.expect_local().parent !== undefined) {
      this.r.dcx().emit_err(diagnostics.ExternCrateLoadingMacroNotAtCrateRoot_diagnostic({ span: item.span }));
    }
    if (item.kind.$ === "ExternCrate" && item.kind._0 !== undefined && item.kind._0 === kw.SelfLower) {
      this.r.dcx().emit_err(diagnostics.MacroUseExternCrateSelf_diagnostic({ span }));
    }

    switch (arguments_.$) {
      case "UseAll":
        import_all = span;
        break;
      case "UseSpecific":
        single_imports = arguments_._0;
        break;
    }
  }

  const macro_use_import = (this_: DefCollector, span: Span, warn_private: boolean): Import =>
    this_.r.arenas.alloc_import(
      new imports.ImportData(
        { $: "MacroUse", warn_private },
        item.id,
        item.span,
        item.span_with_attributes(),
        item.attrs.length !== 0,
        span,
        span,
        lib.clone_ParentScope(this_.parent_scope),
        [],
        lib.CmCell.new<ModuleOrUniformRoot | undefined>({ $: "Module", _0: module }),
        Visibility.Restricted(CRATE_MOD_ID),
        item.vis.span,
        diagnostics_impls.OnUnknownData.from_attrs(this_.r, item.attrs),
      ),
    );

  const allow_shadowing = this.parent_scope.expansion === LocalExpnId.ROOT;
  if (import_all !== undefined) {
    const span = import_all;
    const import_ = macro_use_import(this, span, false);
    this.r.potentially_unused_imports.push(import_);
    module.for_each_child_mut(this, (this_, ident, _2, ns, binding) => {
      if (ns === "MacroNS") {
        let import_used: Import;
        if (this_.r.is_accessible_from(binding.vis(), this_.parent_scope.module)) {
          import_used = import_;
        } else {
          // FIXME: This branch is used for reporting the `private_macro_use` lint
          // and should eventually be removed.
          if (this_.r.macro_use_prelude.has(ident.name)) {
            // Do not override already existing entries with compatibility entries.
            return;
          }
          import_used = macro_use_import(this_, span, true);
        }
        const import_decl = this_.r.new_import_decl(binding, import_used);
        this_.add_macro_use_decl(ident.name, import_decl, span, allow_shadowing);
      }
    });
  } else {
    for (const ident of single_imports) {
      const result = this.r.cm().maybe_resolve_ident_in_module({ $: "Module", _0: module }, ident, "MacroNS", this.parent_scope, undefined);
      if (result.$ === "Ok") {
        const binding = result._0;
        const import_ = macro_use_import(this, ident.span, false);
        this.r.potentially_unused_imports.push(import_);
        const import_decl = this.r.new_import_decl(binding, import_);
        this.add_macro_use_decl(ident.name, import_decl, ident.span, allow_shadowing);
      } else {
        this.r.dcx().emit_err(diagnostics.ImportedMacroNotFound_diagnostic({ span: ident.span }));
      }
    }
  }
  return import_all !== undefined || single_imports.length !== 0;
};

/// Returns `true` if this attribute list contains `macro_use`.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1236 contains_macro_use
DefCollector.prototype.contains_macro_use = function (this: DefCollector, attrs: readonly Attribute[]): boolean {
  for (const attr_ of attrs) {
    if (attr_.has_name(sym.macro_escape)) {
      const inner_attribute = attr_.style === "Inner";
      this.r.dcx().emit_warn(diagnostics.MacroExternDeprecated_diagnostic({ span: attr_.span, inner_attribute }));
    } else if (!attr_.has_name(sym.macro_use)) {
      continue;
    }

    if (!attr_.is_word()) {
      this.r.dcx().emit_err(diagnostics.ArgumentsMacroUseNotAllowed_diagnostic({ span: attr_.span }));
    }
    return true;
  }

  return false;
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1257 visit_invoc
DefCollector.prototype.visit_invoc = function (this: DefCollector, id: NodeId): LocalExpnId {
  const invoc_id = NodeIdC.placeholder_to_expn_id(id);
  const had_old_parent_scope = this.r.invocation_parent_scopes.has(invoc_id);
  this.r.invocation_parent_scopes.set(invoc_id, lib.clone_ParentScope(this.parent_scope));
  assert(!had_old_parent_scope, "invocation data is reset for an invocation");
  return invoc_id;
};

/// Visit invocation in context in which it can emit a named item (possibly `macro_rules`)
/// directly into its parent scope's module.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1266 visit_invoc_in_module
DefCollector.prototype.visit_invoc_in_module = function (this: DefCollector, id: NodeId): MacroRulesScopeRef {
  const invoc_id = this.visit_invoc(id);
  const module = this.parent_scope.module.expect_local();
  module.unexpanded_invocations.borrow_mut(this.r).value.add(invoc_id);
  return this.r.arenas.alloc_macro_rules_scope({ $: "Invocation", _0: invoc_id });
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1273 proc_macro_stub
DefCollector.prototype.proc_macro_stub = function (this: DefCollector, item: Item, fn_ident: Ident): [MacroKind, Ident, Span] | undefined {
  if (attr.contains_name(item.attrs, sym.proc_macro)) {
    return ["Bang", fn_ident, item.span];
  } else if (attr.contains_name(item.attrs, sym.proc_macro_attribute)) {
    return ["Attr", fn_ident, item.span];
  } else {
    const attr_ = attr.find_by_name(item.attrs, sym.proc_macro_derive);
    if (attr_ !== undefined) {
      const list = attr_.meta_item_list();
      const meta_item_inner = list === undefined ? undefined : list[0];
      if (meta_item_inner !== undefined) {
        const ident = attr.MetaItemInner.ident(meta_item_inner);
        if (ident !== undefined) {
          return ["Derive", ident, ident.span];
        }
      }
    }
  }
  return undefined;
};

// Mark the given macro as unused unless its name starts with `_`.
// Macro uses will remove items from this set, and the remaining
// items will be reported as `unused_macros`.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1295 insert_unused_macro
DefCollector.prototype.insert_unused_macro = function (this: DefCollector, ident: Ident, def_id: LocalDefId, node_id: NodeId): void {
  if (!ident.as_str().startsWith("_")) {
    this.r.unused_macros.set(def_id, [node_id, ident]);
    const kind = index_map(this.r.local_macro_map, def_id).kind;
    if (kind.$ === "MacroRules") {
      const mr = kind._0;
      const nrules = mr.nrules();
      const value: [LocalDefId, DenseBitSet<number>] = [def_id, DenseBitSet.new_filled<number>(nrules)];
      this.r.unused_macro_rules.set(node_id, value);
    }
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1305 define_macro
DefCollector.prototype.define_macro = function (this: DefCollector, item: Item, feed: TyCtxtFeed<LocalDefId>): MacroRulesScopeRef {
  const parent_scope = lib.clone_ParentScope(this.parent_scope);
  const expansion = parent_scope.expansion;
  const def_id = feed.key();
  let res: Res;
  let orig_ident: Ident;
  let span: Span;
  let macro_rules: boolean;
  const kind = item.kind;
  switch (kind.$) {
    case "MacroDef": {
      const ident = kind._0;
      const def = kind._1;
      [res, orig_ident, span, macro_rules] = [this.res(LocalDefId.to_def_id(def_id)), ident, item.span, def.macro_rules];
      break;
    }
    case "Fn": {
      const fn_ident = kind._0.ident;
      const stub = this.proc_macro_stub(item, fn_ident);
      if (stub !== undefined) {
        const [macro_kind, ident, span_] = stub;
        const macro_kinds = MacroKinds.from_MacroKind(macro_kind);
        const res_: Res = { $: "Def", _0: { $: "Macro", _0: macro_kinds }, _1: LocalDefId.to_def_id(def_id) };
        this.r.local_macro_map.set(def_id, this.r.dummy_ext(macro_kind));
        this.r.proc_macro_stubs.add(def_id);
        [res, orig_ident, span, macro_rules] = [res_, ident, span_, false];
      } else {
        return parent_scope.macro_rules;
      }
      break;
    }
    default:
      return unreachable();
  }

  this.r.local_macro_def_scopes.set(def_id, parent_scope.module.expect_local());

  if (macro_rules) {
    const ident = lib.IdentKey.new(orig_ident);
    this.r.macro_names.add(ident);
    const is_macro_export = attr.contains_name(item.attrs, sym.macro_export);
    const vis: Visibility = is_macro_export ? Visibility.Public : Visibility.Restricted(CRATE_MOD_ID);
    const decl = this.r.arenas.new_def_decl(res, Visibility.to_mod_id(vis), span, expansion, parent_scope.module);
    this.r.all_macro_rules.add(ident.name);
    if (is_macro_export) {
      const import_ = this.r.arenas.alloc_import(
        new imports.ImportData(
          imports.ImportKind.MacroExport,
          item.id,
          span,
          span,
          false,
          span,
          span,
          new gen.ParentScope(this.r.graph_root.to_module(), parent_scope.expansion, parent_scope.macro_rules, parent_scope.derives),
          [],
          lib.CmCell.new<ModuleOrUniformRoot | undefined>(undefined),
          vis,
          item.vis.span,
          diagnostics_impls.OnUnknownData.from_attrs(this.r, item.attrs),
        ),
      );
      this.r.import_use_map.set(import_, "Other");
      const import_decl = this.r.new_import_decl(decl, import_);
      this.r.plant_decl_into_local_module(ident, orig_ident.span, "MacroNS", import_decl);
    } else {
      this.r.check_reserved_macro_name(ident.name, orig_ident.span, res);
      this.insert_unused_macro(orig_ident, def_id, item.id);
    }
    this.r.feed_visibility(feed, vis);
    const scope = this.r.arenas.alloc_macro_rules_scope({
      $: "Def",
      _0: this.r.arenas.alloc_macro_rules_decl({
        parent_macro_rules_scope: parent_scope.macro_rules,
        decl,
        ident,
        orig_ident_span: orig_ident.span,
      }),
    });
    this.r.macro_rules_scopes.set(def_id, scope);
    return scope;
  } else {
    const module = parent_scope.module.expect_local();
    let vis: Visibility;
    switch (item.kind.$) {
      // Visibilities must not be resolved non-speculatively twice
      // and we already resolved this one as a `fn` item visibility.
      case "Fn": {
        const r = this.r.try_resolve_visibility(this.parent_scope, item.vis, false);
        vis = r.$ === "Ok" ? r._0 : Visibility.Public;
        break;
      }
      default:
        vis = this.resolve_visibility(item.vis);
    }
    if (!Visibility.is_public(vis)) {
      this.insert_unused_macro(orig_ident, def_id, item.id);
    }
    this.r.define_local(module, orig_ident, "MacroNS", res, vis, span, expansion);
    this.r.feed_visibility(feed, vis);
    return this.parent_scope.macro_rules;
  }
};

// impl<'a, 'ra, 'tcx> DefCollector<'a, 'ra, 'tcx>

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1410 brg_visit_item
DefCollector.prototype.brg_visit_item = function (this: DefCollector, item: Item, feed: TyCtxtFeed<LocalDefId>): void {
  const orig_module_scope = this.parent_scope.module;
  let macro_rules: MacroRulesScopeRef;
  if (item.kind.$ === "MacroDef") {
    const macro_rules_scope = this.define_macro(item, feed);
    walk_item(this, item, WalkItemKind.ItemKind);
    macro_rules = macro_rules_scope;
  } else {
    const orig_macro_rules_scope = this.parent_scope.macro_rules;
    this.build_reduced_graph_for_item(item, feed);
    if (item.kind.$ === "Mod") {
      // Visit attributes after items for backward compatibility.
      // This way they can use `macro_rules` defined later.
      this.visit_vis(item.vis);
      WalkItemKind.ItemKind.walk(item.kind, item.attrs, item.span, item.id, item.vis, undefined, this);
      // `visit::walk_list!(self, visit_attribute, &item.attrs)`
      for (const attr_ of item.attrs) this.visit_attribute(attr_);
    } else {
      walk_item(this, item, WalkItemKind.ItemKind);
    }
    if (item.kind.$ === "Mod" && this.contains_macro_use(item.attrs)) {
      macro_rules = this.parent_scope.macro_rules;
    } else {
      macro_rules = orig_macro_rules_scope;
    }
  }
  this.parent_scope.macro_rules = macro_rules;
  this.parent_scope.module = orig_module_scope;
};

/// Handle a macro call that itself can produce new `macro_rules` items
/// in the current module.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1444 brg_visit_mac_call_in_module
DefCollector.prototype.brg_visit_mac_call_in_module = function (this: DefCollector, id: NodeId): void {
  const scope = this.visit_invoc_in_module(id);
  this.parent_scope.macro_rules = scope;
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1448 brg_visit_block
DefCollector.prototype.brg_visit_block = function (this: DefCollector, block: Block): void {
  const orig_current_module = this.parent_scope.module;
  const orig_current_macro_rules_scope = this.parent_scope.macro_rules;
  this.build_reduced_graph_for_block(block);
  walk_block(this, block);
  this.parent_scope.module = orig_current_module;
  this.parent_scope.macro_rules = orig_current_macro_rules_scope;
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1457 brg_visit_assoc_item
DefCollector.prototype.brg_visit_assoc_item = function (
  this: DefCollector,
  item: AssocItem,
  ctxt: AssocCtxt,
  ident: Ident,
  ns: Namespace,
  feed: TyCtxtFeed<LocalDefId>,
): void {
  const vis = this.resolve_visibility(item.vis);
  const local_def_id = feed.key();
  const def_id = LocalDefId.to_def_id(local_def_id);

  if (!(ctxt.$ === "Impl" && ctxt.of_trait && item.vis.kind.$ === "Inherited")) {
    // Trait impl item visibility is inherited from its trait when not specified
    // explicitly. In that case we cannot determine it here in early resolve,
    // so we leave a hole in the visibility table to be filled later.
    this.r.feed_visibility(feed, vis);
  }

  if (ctxt.$ === "Trait") {
    const parent = this.parent_scope.module.expect_local();
    const expansion = this.parent_scope.expansion;
    this.r.define_local(parent, ident, ns, this.res(def_id), vis, item.span, expansion);
  } else if (!(item.kind.$ === "Delegation" && item.kind._0.source.$ === "Glob") && ident.name !== kw.Underscore) {
    // Don't add underscore names, they cannot be looked up anyway.
    const impl_def_id = this.r.tcx_.local_parent(local_def_id);
    const key = lib.BindingKey.new(lib.IdentKey.new(ident), ns);
    // `self.r.impl_binding_keys.entry(impl_def_id).or_default().insert(key)`
    let keys = this.r.impl_binding_keys.get(impl_def_id);
    if (keys === undefined) {
      keys = new KeyedSet<BindingKeyT>(lib.BindingKey_key);
      this.r.impl_binding_keys.set(impl_def_id, keys);
    }
    keys.add(key);
  }

  walk_assoc_item(this, item, ctxt, WalkItemKind.AssocItemKind);
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1494 visit_assoc_item_mac_call
DefCollector.prototype.visit_assoc_item_mac_call = function (this: DefCollector, item: Item<AssocItemKind>, ctxt: AssocCtxt): void {
  switch (ctxt.$) {
    case "Trait":
      this.visit_invoc_in_module(item.id);
      break;
    case "Impl": {
      const invoc_id = NodeIdC.placeholder_to_expn_id(item.id);
      if (!this.r.glob_delegation_invoc_ids.has(invoc_id)) {
        // `self.r.impl_unexpanded_invocations.entry(self.r.invocation_parent(invoc_id)).or_default().insert(invoc_id)`
        const key = this.r.invocation_parent(invoc_id);
        let set = this.r.impl_unexpanded_invocations.get(key);
        if (set === undefined) {
          set = new Set();
          this.r.impl_unexpanded_invocations.set(key, set);
        }
        set.add(invoc_id);
      }
      this.visit_invoc(item.id);
      break;
    }
  }
};

// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1517 brg_visit_field_def
DefCollector.prototype.brg_visit_field_def = function (this: DefCollector, sf: FieldDef, feed: TyCtxtFeed<LocalDefId>): void {
  const vis = this.resolve_visibility(sf.vis);
  this.r.feed_visibility(feed, vis);
  walk_field_def(this, sf);
};

// Constructs the reduced graph for one variant. Variants exist in the
// type and value namespaces.
// rustc: compiler/rustc_resolve/src/build_reduced_graph.rs:1529 brg_visit_variant
DefCollector.prototype.brg_visit_variant = function (this: DefCollector, variant: Variant, feed: TyCtxtFeed<LocalDefId>): void {
  const parent = this.parent_scope.module.expect_local();
  const expn_id = this.parent_scope.expansion;
  const ident = variant.ident;

  // Define a name in the type namespace.
  const def_id = feed.key();
  const vis = this.resolve_visibility(variant.vis);
  this.r.define_local(parent, ident, "TypeNS", this.res(LocalDefId.to_def_id(def_id)), vis, variant.span, expn_id);
  this.r.feed_visibility(feed, vis);

  // If the variant is marked as non_exhaustive then lower the visibility to within the crate.
  const ctor_vis: Visibility =
    Visibility.is_public(vis) && attr.contains_name(variant.attrs, sym.non_exhaustive) ? Visibility.Restricted(CRATE_MOD_ID) : vis;

  // Define a constructor name in the value namespace.
  const ctor = CtorKind.from_ast(variant.data);
  if (ctor !== undefined) {
    const [ctor_kind, ctor_node_id] = ctor;
    const feed = this.create_def(ctor_node_id, undefined, { $: "Ctor", _0: "Variant", _1: ctor_kind }, variant.span);
    const ctor_def_id = feed.key();
    const ctor_res = this.res(LocalDefId.to_def_id(ctor_def_id));
    this.r.define_local(parent, ident, "ValueNS", ctor_res, ctor_vis, variant.span, expn_id);
    this.r.feed_visibility(feed, ctor_vis);
  }

  // Record field names for error reporting.
  this.insert_field_idents(def_id, VariantData.fields(variant.data));
  this.insert_field_visibilities_local(LocalDefId.to_def_id(def_id), VariantData.fields(variant.data));

  walk_variant(this, variant);
};
