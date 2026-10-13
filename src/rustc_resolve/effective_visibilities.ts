// Port of compiler/rustc_resolve/src/effective_visibilities.rs
//
// The `Resolver` methods of this file are declared in ./decls.ts (the contract, docs/handoff/res-lib.md)
// and assigned onto the prototype below; `EffectiveVisibilitiesVisitor`'s methods are declared there
// too (`declare module "./effective_visibilities.ts"`) and assigned onto its prototype.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other
// crates; another rustc_resolve module's exports are read inside function bodies only.
import { ast, attr, type Attribute, type Crate, type Item, visit } from "../rustc_ast/lib.ts";
import { type DefKind, Res } from "../rustc_hir/def.ts";
import { EffectiveVisibilities, EffectiveVisibility, type Level } from "../rustc_middle/middle/privacy.ts";
import { Visibility, Visibility_eq } from "../rustc_middle/ty/mod.ts";
import { CRATE_DEF_ID, CRATE_MOD_ID, LocalDefId, LocalModId } from "../rustc_span/def_id.ts";
import { sym } from "../rustc_span/symbol.ts";
import { panic, unreachable } from "../std/panic.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { Resolver } from "./decls.ts";
import * as gen from "./effective_visibilities.gen.ts";
import type { Decl } from "./lib.ts";

export * from "./effective_visibilities.gen.ts";

export type ParentId = gen.ParentId;
export const ParentId = {
  // rustc: compiler/rustc_resolve/src/effective_visibilities.rs:23 level
  level(self: ParentId): Level {
    switch (self.$) {
      case "Def":
        return "Direct";
      case "Import":
        return "Reexported";
    }
  },
};

/** `*eff_vis` of a `Copy` `EffectiveVisibility` (a mutable class here, PORTING §8). */
function copy_EffectiveVisibility(v: EffectiveVisibility): EffectiveVisibility {
  return new EffectiveVisibility(v.direct, v.reexported, v.reachable, v.reachable_through_impl_trait);
}

/** `(LocalDefId, LocalDefId)` key of `macro_reachable` (`FxHashSet` of a tuple). */
function LocalDefId_pair_key(k: [LocalDefId, LocalDefId]): string {
  return `${k[0]}:${k[1]}`;
}

// rustc-type: compiler/rustc_resolve/src/effective_visibilities.rs:31 EffectiveVisibilitiesVisitor
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class EffectiveVisibilitiesVisitor extends visit.Visitor {
  constructor(
    public r: Resolver,
    public def_effective_visibilities: EffectiveVisibilities,
    /// While walking import chains we need to track effective visibilities per-decl, and def id
    /// keys in `Resolver::effective_visibilities` are not enough for that, because multiple
    /// declarations can correspond to a single def id in imports. So we keep a separate table.
    public import_effective_visibilities: EffectiveVisibilities<Decl>,
    // It's possible to recalculate this at any point, but it's relatively expensive.
    public current_private_vis: Visibility,
    /// A set of pairs corresponding to modules, where the first module is
    /// reachable via a macro that's defined in the second module. This cannot
    /// be represented as reachable because it can't handle the following case:
    ///
    /// pub mod n {                         // Should be `Public`
    ///     pub(crate) mod p {              // Should *not* be accessible
    ///         pub fn f() -> i32 { 12 }    // Must be `Reachable`
    ///     }
    /// }
    /// pub macro m() {
    ///     n::p::f()
    /// }
    /** `FxHashSet<(LocalDefId, LocalDefId)>`: a `KeyedSet` (pair key) */
    public macro_reachable: Set<[LocalDefId, LocalDefId]>,
    public changed: boolean,
  ) {
    super();
  }

  /// Fills the `Resolver::effective_visibilities` table with public & exported items
  /// For now, this doesn't resolve macros (FIXME) and cannot resolve Impl, as we
  /// need access to a TyCtxt for that. Returns the set of ambiguous re-exports.
  // rustc: compiler/rustc_resolve/src/effective_visibilities.rs:81 compute_effective_visibilities
  static compute_effective_visibilities(r: Resolver, krate: Crate): Set<Decl> {
    const visitor = new EffectiveVisibilitiesVisitor(
      r,
      EffectiveVisibilities.default(),
      EffectiveVisibilities.default<Decl>(),
      Visibility.Restricted(CRATE_MOD_ID),
      new KeyedSet<[LocalDefId, LocalDefId]>(LocalDefId_pair_key),
      true,
    );

    visitor.def_effective_visibilities.update_root();
    visitor.set_bindings_effective_visibilities(CRATE_DEF_ID);

    while (visitor.changed) {
      visitor.changed = false;
      visit.walk_crate(visitor, krate);
    }
    visitor.r.effective_visibilities = visitor.def_effective_visibilities;

    // PORT: `FxHashSet<Decl>` keyed by the interned decl's identity (its only use is `contains`).
    const exported_ambiguities = new Set<Decl>();

    // Update visibilities for import def ids. These are not used during the
    // `EffectiveVisibilitiesVisitor` pass, because we have more detailed declaration-based
    // information, but are used by later passes. Effective visibility of an import def id
    // is the maximum value among visibilities of declarations corresponding to that def id.
    for (const [decl, eff_vis] of visitor.import_effective_visibilities.iter()) {
      const kind = decl.kind;
      if (kind.$ !== "Import") return unreachable();
      const import_ = kind.import;
      const def_id = import_.def_id();
      if (def_id !== undefined) {
        r.effective_visibilities.update_eff_vis(def_id, eff_vis, r.tcx_);
        const root = index_map(r.owners, import_.root_id).def_id;
        // The `unreachable_pub` lint also needs to know whether any of the nested entries are
        // exported by this use statement.
        // FIXME: We could compute this lazily in `unreachable_pub` directly, but this is less invasive.
        r.effective_visibilities.update_eff_vis(root, eff_vis, r.tcx_);
      }
      if (decl.ambiguity.get() !== undefined && eff_vis.is_public_at_level("Reexported")) {
        exported_ambiguities.add(decl);
      }
    }

    // info!("resolve::effective_visibilities: {:#?}", r.effective_visibilities);

    return exported_ambiguities;
  }
}

/** `map[&key]` (`impl Index for HashMap`): panics when the key is absent. */
function index_map<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined && !map.has(key)) return panic("key not found");
  return v as V;
}

// impl Resolver<'_, '_>

// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:57 private_vis_decl
Resolver.prototype.private_vis_decl = function (this: Resolver, decl: Decl): Visibility {
  return Visibility.Restricted(decl.parent_module === undefined ? CRATE_MOD_ID : decl.parent_module.nearest_parent_mod().expect_local());
};

// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:63 private_vis_def
Resolver.prototype.private_vis_def = function (this: Resolver, def_id: LocalDefId): Visibility {
  // For mod items `normal_mod_id` will be equal to `def_id`, but we actually need its parent.
  const normal_mod_id = this.get_nearest_non_block_module(LocalDefId.to_def_id(def_id)).nearest_parent_mod().expect_local();
  if (LocalModId.to_local_def_id(normal_mod_id) === def_id) {
    return Visibility.Restricted(LocalModId.new_unchecked(this.tcx_.local_parent(def_id)));
  } else {
    return Visibility.Restricted(normal_mod_id);
  }
};

// impl<'a, 'ra, 'tcx> EffectiveVisibilitiesVisitor<'a, 'ra, 'tcx>
const EVV = EffectiveVisibilitiesVisitor.prototype;

/// Update effective visibilities of name declarations in the given module,
/// including their whole reexport chains.
// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:131 set_bindings_effective_visibilities
EVV.set_bindings_effective_visibilities = function (this: EffectiveVisibilitiesVisitor, module_id: LocalDefId): void {
  const module = this.r.expect_module(LocalDefId.to_def_id(module_id));
  for (const [, name_resolution] of this.r.resolutions(module)) {
    const decl = name_resolution.borrow(this.r).best_decl();
    if (decl === undefined) {
      continue;
    }
    this.update_decl_chain(decl, { $: "Def", _0: module_id }, new Set<Decl>());
  }
};

/// Update effective visibilities for the whole reexport chain of a declaration.
/// Set the given effective visibility level to `Level::Direct` and
/// sets the rest of the `use` chain to `Level::Reexported` until
/// we hit the actual exported item.
// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:145 update_decl_chain
EVV.update_decl_chain = function (this: EffectiveVisibilitiesVisitor, decl_: Decl, parent_id_: gen.ParentId, seen_most_visible: Set<Decl>): void {
  let decl = decl_;
  let parent_id = parent_id_;
  const priv_vis = (this_: EffectiveVisibilitiesVisitor, parent_id: gen.ParentId, decl: Decl): Visibility => {
    switch (parent_id.$) {
      case "Def":
        return this_.current_private_vis;
      case "Import":
        return this_.r.private_vis_decl(decl);
    }
  };
  for (;;) {
    const kind = decl.kind;
    if (kind.$ !== "Import") break;
    const source_decl = kind.source_decl;
    this.update_import(decl, parent_id, priv_vis(this, parent_id, decl));
    // `ambiguity_vis_max` can cycle on mutual globs; follow each once.
    const most_visible = decl.ambiguity_vis_max.get();
    if (most_visible !== undefined && !seen_most_visible.has(most_visible)) {
      seen_most_visible.add(most_visible);
      this.update_decl_chain(most_visible, parent_id, seen_most_visible);
    }
    parent_id = { $: "Import", _0: decl };
    decl = source_decl;
  }
  const def_id = Res.opt_def_id(decl.res())?.as_local();
  if (def_id !== undefined) {
    const priv_vis_ = priv_vis(this, parent_id, decl);
    this.update_def(def_id, Visibility.expect_local(decl.vis()), parent_id, priv_vis_);
  }
};

// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:172 effective_vis_or_private
EVV.effective_vis_or_private = function (this: EffectiveVisibilitiesVisitor, parent_id: gen.ParentId): EffectiveVisibility {
  // Private nodes are only added to the table for caching, they could be added or removed at
  // any moment without consequences, so we don't set `changed` to true when adding them.
  switch (parent_id.$) {
    case "Def": {
      const def_id = parent_id._0;
      return copy_EffectiveVisibility(this.def_effective_visibilities.effective_vis_or_private(def_id, () => this.r.private_vis_def(def_id)));
    }
    case "Import": {
      const binding = parent_id._0;
      return copy_EffectiveVisibility(this.import_effective_visibilities.effective_vis_or_private(binding, () => this.r.private_vis_decl(binding)));
    }
  }
};

/// All effective visibilities for a node are larger or equal than private visibility
/// for that node (see `check_invariants` in middle/privacy.rs).
/// So if either parent or nominal visibility is the same as private visibility, then
/// `min(parent_vis, nominal_vis) <= priv_vis`, and the update logic is guaranteed
/// to not update anything and we can skip it.
// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:190 may_update
EVV.may_update = function (this: EffectiveVisibilitiesVisitor, nominal_vis: Visibility, parent_id: gen.ParentId, priv_vis: Visibility): boolean {
  let parent_vis: Visibility;
  switch (parent_id.$) {
    case "Def":
      parent_vis = this.r.tcx_.local_visibility(parent_id._0);
      break;
    case "Import":
      parent_vis = Visibility.expect_local(parent_id._0.vis());
      break;
  }
  return !Visibility_eq(nominal_vis, priv_vis) && !Visibility_eq(parent_vis, priv_vis);
};

// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:203 update_import
EVV.update_import = function (this: EffectiveVisibilitiesVisitor, decl: Decl, parent_id: gen.ParentId, priv_vis: Visibility): void {
  const nominal_vis = Visibility.expect_local(decl.vis());
  if (!this.may_update(nominal_vis, parent_id, priv_vis)) {
    return;
  }
  const inherited_eff_vis = this.effective_vis_or_private(parent_id);
  const tcx = this.r.tcx_;
  this.changed = this.import_effective_visibilities.update(decl, nominal_vis, priv_vis, inherited_eff_vis, ParentId.level(parent_id), tcx) || this.changed;
};

// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:220 update_def
EVV.update_def = function (this: EffectiveVisibilitiesVisitor, def_id: LocalDefId, nominal_vis: Visibility, parent_id: gen.ParentId, priv_vis: Visibility): void {
  if (!this.may_update(nominal_vis, parent_id, priv_vis)) {
    return;
  }
  const inherited_eff_vis = this.effective_vis_or_private(parent_id);
  const tcx = this.r.tcx_;
  this.changed = this.def_effective_visibilities.update(def_id, nominal_vis, priv_vis, inherited_eff_vis, ParentId.level(parent_id), tcx) || this.changed;
};

// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:242 update_field
EVV.update_field = function (this: EffectiveVisibilitiesVisitor, def_id: LocalDefId, parent_id: LocalDefId): void {
  const nominal_vis = this.r.tcx_.local_visibility(def_id);
  this.update_def(def_id, nominal_vis, { $: "Def", _0: parent_id }, this.current_private_vis);
};

// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:247 update_macro
EVV.update_macro = function (this: EffectiveVisibilitiesVisitor, def_id: LocalDefId, inherited_effective_vis: EffectiveVisibility): void {
  const max_vis = this.r.tcx_.local_visibility(def_id);
  const priv_vis = def_id === CRATE_DEF_ID ? Visibility.Restricted(CRATE_MOD_ID) : this.r.private_vis_def(def_id);
  this.changed = this.def_effective_visibilities.update(def_id, max_vis, priv_vis, inherited_effective_vis, "Reachable", this.r.tcx_) || this.changed;
};

// We have to make sure that the items that macros might reference
// are reachable, since they might be exported transitively.
// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:266 update_reachability_from_macro
EVV.update_reachability_from_macro = function (this: EffectiveVisibilitiesVisitor, local_def_id: LocalDefId, md: ast.MacroDef, attrs: readonly Attribute[]): void {
  // Non-opaque macros cannot make other items more accessible than they already are.
  const transparency_attr = attr.find_by_name(attrs, sym.rustc_macro_transparency);
  if (transparency_attr === undefined ? md.macro_rules : transparency_attr.value_str() !== sym.opaque) {
    return;
  }

  const macro_module_def_id = this.r.tcx_.local_parent(local_def_id);
  if (this.r.tcx_.def_kind(macro_module_def_id).$ !== "Mod") {
    // The macro's parent doesn't correspond to a `mod`, return early (#63164, #65252).
    return;
  }

  const ev = this.def_effective_visibilities.effective_vis(local_def_id);
  const filtered = ev !== undefined && ev.public_at_level() !== undefined ? ev : undefined;
  if (filtered === undefined) {
    return;
  }
  const macro_ev = copy_EffectiveVisibility(filtered);

  // Since we are starting from an externally visible module,
  // all the parents in the loop below are also guaranteed to be modules.
  let module_def_id = macro_module_def_id;
  for (;;) {
    this.update_macro_reachable(module_def_id, macro_module_def_id, macro_ev);
    if (module_def_id === CRATE_DEF_ID) {
      break;
    }
    module_def_id = this.r.tcx_.local_parent(module_def_id);
  }
};

/// Updates the item as being reachable through a macro defined in the given
/// module. Returns `true` if the level has changed.
// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:308 update_macro_reachable
EVV.update_macro_reachable = function (this: EffectiveVisibilitiesVisitor, module_def_id: LocalDefId, defining_mod: LocalDefId, macro_ev: EffectiveVisibility): void {
  const key: [LocalDefId, LocalDefId] = [module_def_id, defining_mod];
  if (!this.macro_reachable.has(key)) {
    this.macro_reachable.add(key);
    const module = this.r.expect_module(LocalDefId.to_def_id(module_def_id));
    for (const [, name_resolution] of this.r.resolutions(module)) {
      const decl = name_resolution.borrow(this.r).best_decl();
      if (decl === undefined) {
        continue;
      }

      const res = decl.res();
      if (res.$ === "Def") {
        const def_kind = res._0;
        const def_id = res._1.as_local();
        if (
          def_id !== undefined &&
          // FIXME: defs should be checked with `EffectiveVisibilities::is_reachable`.
          Visibility.is_accessible_from(decl.vis(), defining_mod, this.r.tcx_)
        ) {
          const vis = this.r.tcx_.local_visibility(def_id);
          this.update_macro_reachable_def(def_id, def_kind, vis, defining_mod, macro_ev);
        }
      }
    }
  }
};

// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:333 update_macro_reachable_def
EVV.update_macro_reachable_def = function (
  this: EffectiveVisibilitiesVisitor,
  def_id: LocalDefId,
  def_kind: DefKind,
  vis: Visibility,
  module: LocalDefId,
  macro_ev: EffectiveVisibility,
): void {
  this.update_macro(def_id, macro_ev);

  switch (def_kind.$) {
    case "Mod":
      if (Visibility.is_accessible_from(vis, module, this.r.tcx_)) {
        this.update_macro_reachable(def_id, module, macro_ev);
      }
      break;
    case "Struct":
    case "Union": {
      let set = this.r.macro_reachable_adts.get(def_id);
      if (set === undefined) {
        set = new Set();
        this.r.macro_reachable_adts.set(def_id, set);
      }
      set.add(module);
      break;
    }
    default:
      break;
  }
};

// impl<'a, 'ra, 'tcx> Visitor<'a> for EffectiveVisibilitiesVisitor<'a, 'ra, 'tcx>
// rustc: compiler/rustc_resolve/src/effective_visibilities.rs:358 visit_item
EVV.visit_item = function (this: EffectiveVisibilitiesVisitor, item: Item): undefined {
  const def_id = this.r.owner_def_id(item.id);
  // Update effective visibilities of nested items.
  // If it's a mod, also make the visitor walk all of its items
  const kind = item.kind;
  switch (kind.$) {
    // Resolved in rustc_privacy when types are available
    case "Impl":
      return;

    // Should be unreachable at this stage
    case "MacCall":
    case "DelegationMac":
      return panic("ast::ItemKind::MacCall encountered, this should not anymore appear at this stage");

    case "Mod": {
      const prev_private_vis = this.current_private_vis;
      this.current_private_vis = Visibility.Restricted(LocalModId.new_unchecked(def_id));
      this.set_bindings_effective_visibilities(def_id);
      visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
      this.current_private_vis = prev_private_vis;
      break;
    }

    case "Enum": {
      const variants = kind._2.variants;
      this.set_bindings_effective_visibilities(def_id);
      for (const variant of variants) {
        const variant_def_id = this.r.child_def_id(item.id, variant.id);
        for (const field of ast.VariantData.fields(variant.data)) {
          this.update_field(this.r.child_def_id(item.id, field.id), variant_def_id);
        }
      }
      break;
    }

    case "Struct":
    case "Union": {
      const def = kind._2;
      for (const field of ast.VariantData.fields(def)) {
        this.update_field(this.r.child_def_id(item.id, field.id), def_id);
      }
      break;
    }

    case "Trait":
      this.set_bindings_effective_visibilities(def_id);
      break;

    case "MacroDef": {
      const macro_def = kind._1;
      this.update_reachability_from_macro(def_id, macro_def, item.attrs);
      break;
    }

    case "ExternCrate":
    case "Use":
    case "Static":
    case "Const":
    case "ConstBlock":
    case "GlobalAsm":
    case "TyAlias":
    case "TraitAlias":
    case "ForeignMod":
    case "Fn":
    case "Delegation":
    case "TestBinderConstraints":
      return;
  }
  return;
};
