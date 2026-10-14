// Port of compiler/rustc_middle/src/ty/assoc.rs (lane ty-adt-assoc; contract stub by lane ty-contract).
//
// The types of this file with their derived Debug / TypeVisitable / TypeFoldable impls are generated into
// assoc.gen.ts (set rustc_ty of tools/codegen/types.ts). Their inherent methods are companion functions here, on a
// companion const of the same name (PORTING §8; `AssocItem` and `AssocItems` are plain data structs): e.g.
// `AssocItem.is_method(item)`, `AssocItems.filter_by_name_unhygienic(items, name)`.
//
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes; its
// top-level code may touch only the classes it imports, never another extension module.
//
// PORT: `AssocItems.items` is a `SortedIndexMultiMap<u32, Option<Symbol>, AssocItem>`
// (rustc_data_structures/sorted_map/index_map.ts). decls.ts still has `SortedIndexMultiMap` as `Pending1`, so the
// generated field type is the pending alias: `items_of` casts (PORT(decls): pending root, see the handoff).
import { TyCtxt } from "./context.ts";
import * as gen from "./assoc.gen.ts";
import type { AssocItem as AssocItemT, AssocKind as AssocKindT, AssocTag as AssocTagT } from "./assoc.gen.ts";
import { SortedIndexMultiMap } from "../../rustc_data_structures/sorted_map/index_map.ts";
import { DefKind, type Namespace } from "../../rustc_hir/def.ts";
import { Defaultness } from "../../rustc_hir/hir.ts";
import type { DefId, ModId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_DefId } from "../../rustc_span/def_id.ts";
import { display_Symbol, Ident, Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { display_FnSig } from "../../rustc_type_ir/ir_print.ts";
import type { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import { debug_Unnormalized, Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_Ty, type Ty, type Visibility } from "./mod.ts";

// The generated types, debug fns and unit-variant singletons.
export * from "./assoc.gen.ts";

// ---- AssocItem -----------------------------------------------------------------------------------------------------

/// Information about an associated item
export type AssocItem = AssocItemT;
export const AssocItem = {
  // Gets the identifier, if it has one.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:30 opt_name
  opt_name(self: AssocItem): Symbol | undefined {
    const kind = self.kind;
    switch (kind.$) {
      case "Type":
        switch (kind.data.$) {
          case "Normal":
            return kind.data._0;
          case "Rpitit":
            return undefined;
        }
        break;
      case "Const":
        return kind.name;
      case "Fn":
        return kind.name;
    }
  },

  // Gets the identifier name. Aborts if it lacks one, i.e. is an RPITIT
  // associated type.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:41 name
  name(self: AssocItem): Symbol {
    const name = AssocItem.opt_name(self);
    if (name === undefined) panic("name of non-Rpitit assoc item");
    return name;
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:45 ident
  ident(self: AssocItem, tcx: TyCtxt): Ident {
    return Ident.new(AssocItem.name(self), unwrap(tcx.def_ident_span(self.def_id)));
  },

  /// Gets the defaultness of the associated item.
  /// To get the default associated type, use the [`type_of`] query on the
  /// [`DefId`] of the type.
  ///
  /// [`type_of`]: crate::ty::TyCtxt::type_of
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:54 defaultness
  defaultness(self: AssocItem, tcx: TyCtxt): Defaultness {
    switch (self.container.$) {
      case "InherentImpl":
        return Defaultness.Final;
      case "Trait":
      case "TraitImpl":
        // PORT: the `defaultness` query value is `unknown` in queries.gen.ts (`hir::Defaultness`).
        return tcx.defaultness(self.def_id) as Defaultness;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:61 expect_trait_impl
  expect_trait_impl(self: AssocItem): Result<DefId, ErrorGuaranteed> {
    if (self.container.$ !== "TraitImpl") {
      bug(`expected item to be in a trait impl: ${debug_DefId(self.def_id, PLAIN)}`);
    }
    const trait_item_id = self.container._0;
    return trait_item_id;
  },

  /// If this is a trait impl item, returns the `DefId` of the trait item this implements.
  /// Otherwise, returns `DefId` for self. Returns an Err in case the trait item was not
  /// resolved successfully.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:71 trait_item_or_self
  trait_item_or_self(self: AssocItem): Result<DefId, ErrorGuaranteed> {
    switch (self.container.$) {
      case "TraitImpl":
        return self.container._0;
      case "Trait":
      case "InherentImpl":
        return Ok(self.def_id);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:78 trait_item_def_id
  trait_item_def_id(self: AssocItem): DefId | undefined {
    if (self.container.$ === "TraitImpl" && self.container._0.$ === "Ok") {
      return self.container._0._0;
    }
    return undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:86 visibility
  visibility(self: AssocItem, tcx: TyCtxt): Visibility<ModId> {
    return tcx.visibility(self.def_id);
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:91 container_id
  container_id(self: AssocItem, tcx: TyCtxt): DefId {
    return tcx.parent(self.def_id);
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:96 trait_container
  trait_container(self: AssocItem, tcx: TyCtxt): DefId | undefined {
    switch (self.container.$) {
      case "InherentImpl":
      case "TraitImpl":
        return undefined;
      case "Trait":
        return tcx.parent(self.def_id);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:104 impl_container
  impl_container(self: AssocItem, tcx: TyCtxt): DefId | undefined {
    switch (self.container.$) {
      case "InherentImpl":
      case "TraitImpl":
        return tcx.parent(self.def_id);
      case "Trait":
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:113 signature
  signature(self: AssocItem, tcx: TyCtxt): string {
    const kind = self.kind;
    switch (kind.$) {
      case "Fn": {
        // We skip the binder here because the binder would deanonymize all
        // late-bound regions, and we don't want method signatures to show up
        // `as for<'r> fn(&'r MyType)`. Pretty-printing handles late-bound
        // regions just fine, showing `fn(&MyType)`.
        // PORT: the `fn_sig` query value is `unknown` in queries.gen.ts (`EarlyBinder<PolyFnSig>`).
        const sig = tcx.fn_sig(self.def_id) as EarlyBinder<Binder<FnSig>>;
        return display_FnSig(Unnormalized.skip_binder(EarlyBinder.instantiate_identity(sig)));
      }
      case "Type":
        return `type ${display_Symbol(AssocItem.name(self))};`;
      case "Const": {
        const name = kind.name;
        // PORT: the `type_of` query value is `unknown` in queries.gen.ts (`EarlyBinder<Ty>`).
        const ty = EarlyBinder.instantiate_identity(tcx.type_of(self.def_id) as EarlyBinder<Ty>);
        return `const ${display_Symbol(name)}: ${debug_Unnormalized(ty, PLAIN, debug_Ty)};`;
      }
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:129 descr
  descr(self: AssocItem): string {
    return AssocKind.descr(self.kind);
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:133 namespace
  namespace(self: AssocItem): Namespace {
    return AssocKind.namespace(self.kind);
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:137 as_def_kind
  as_def_kind(self: AssocItem): DefKind {
    return AssocKind.as_def_kind(self.kind);
  },

  /// Whether this associated item can be constrained with an equality binding.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:142 can_have_equality_constraint
  can_have_equality_constraint(self: AssocItem, tcx: TyCtxt): boolean {
    switch (self.kind.$) {
      case "Type":
        return true;
      case "Const":
        return tcx.features().gca_const_items() || tcx.is_direct_const(self.def_id);
      case "Fn":
        return false;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:152 is_fn
  is_fn(self: AssocItem): boolean {
    return self.kind.$ === "Fn";
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:156 is_method
  is_method(self: AssocItem): boolean {
    return self.kind.$ === "Fn" && self.kind.has_self === true;
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:160 is_type
  is_type(self: AssocItem): boolean {
    return self.kind.$ === "Type";
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:164 tag
  tag(self: AssocItem): AssocTag {
    return AssocKind.tag(self.kind);
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:168 is_impl_trait_in_trait
  is_impl_trait_in_trait(self: AssocItem): boolean {
    return self.kind.$ === "Type" && self.kind.data.$ === "Rpitit";
  },
};

// ---- AssocKind -----------------------------------------------------------------------------------------------------

export type AssocKind = AssocKindT;
export const AssocKind = {
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:190 namespace
  namespace(self: AssocKind): Namespace {
    switch (self.$) {
      case "Type":
        return "TypeNS";
      case "Const":
      case "Fn":
        return "ValueNS";
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:197 tag
  tag(self: AssocKind): AssocTag {
    switch (self.$) {
      case "Const":
        return "Const";
      case "Fn":
        return "Fn";
      case "Type":
        return "Type";
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:205 as_def_kind
  as_def_kind(self: AssocKind): DefKind {
    switch (self.$) {
      case "Const":
        return DefKind.AssocConst;
      case "Fn":
        return DefKind.AssocFn;
      case "Type":
        return DefKind.AssocTy;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:213 descr
  descr(self: AssocKind): string {
    if (self.$ === "Fn" && self.has_self === true) {
      return "method";
    }
    return AssocTag.descr(AssocKind.tag(self));
  },
};

// `impl std::fmt::Display for AssocKind`
// rustc: compiler/rustc_middle/src/ty/assoc.rs:222 fmt
export function display_AssocKind(self: AssocKind): string {
  return AssocKind.descr(self);
}

// ---- AssocTag ------------------------------------------------------------------------------------------------------

/// Like [`AssocKind`], but just the tag, no fields. Used in various kinds of matching.
export type AssocTag = AssocTagT;
export const AssocTag = {
  ...gen.AssocTag,

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:236 descr
  descr(self: AssocTag): string {
    // This should match `DefKind::descr`.
    switch (self) {
      case "Const":
        return "associated constant";
      case "Fn":
        return "associated function";
      case "Type":
        return "associated type";
    }
  },
};

// ---- AssocItems ----------------------------------------------------------------------------------------------------

/** `Ord` for `Option<Symbol>`: `None < Some(_)`, symbols by their index (`Symbol` derives `Ord` over `SymbolIndex`). */
function cmp_Option_Symbol(a: Symbol | undefined, b: Symbol | undefined): number {
  if (a === undefined) return b === undefined ? 0 : -1;
  if (b === undefined) return 1;
  return a - b;
}

/** PORT(decls): pending root: the real type of `AssocItems.items` (module comment). */
type AssocItemsMap = SortedIndexMultiMap<number, Symbol | undefined, AssocItem>;
function items_of(self: AssocItems): AssocItemsMap {
  return self.items as unknown as AssocItemsMap;
}

/// A list of `ty::AssocItem`s in definition order that allows for efficient lookup by name.
///
/// When doing lookup by name, we try to postpone hygienic comparison for as long as possible since
/// it is relatively expensive. Instead, items are indexed by `Symbol` and hygienic comparison is
/// done only on items with the same name.
export type AssocItems = gen.AssocItems;
export const AssocItems = {
  /// Constructs an `AssociatedItems` map from a series of `ty::AssocItem`s in definition order.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:258 new
  new(items_in_def_order: Iterable<AssocItem>): AssocItems {
    const pairs = function* (): Generator<[Symbol | undefined, AssocItem]> {
      for (const item of items_in_def_order) yield [AssocItem.opt_name(item), item];
    };
    const items: AssocItemsMap = SortedIndexMultiMap.from_iter(pairs(), cmp_Option_Symbol);
    return { items: items as unknown as AssocItems["items"] };
  },

  /// Returns an iterator over associated items in the order they were defined.
  ///
  /// New code should avoid relying on definition order. If you need a particular associated item
  /// for a known trait, make that trait a lang item instead of indexing this array.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:267 in_definition_order
  *in_definition_order(self: AssocItems): Generator<AssocItem> {
    for (const [, v] of items_of(self).iter()) yield v;
  },

  // rustc: compiler/rustc_middle/src/ty/assoc.rs:271 len
  len(self: AssocItems): number {
    return items_of(self).len();
  },

  /// Returns an iterator over all associated items with the given name, ignoring hygiene.
  ///
  /// Panics if `name.is_empty()` returns `true`.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:278 filter_by_name_unhygienic
  filter_by_name_unhygienic(self: AssocItems, name: Symbol): Generator<AssocItem> {
    assert(!Symbol.is_empty(name), "assertion failed: !name.is_empty()");
    return items_of(self).get_by_key(name);
  },

  /// Returns the associated item with the given identifier and `AssocKind`, if one exists.
  /// The identifier is ignoring hygiene. This is meant to be used for lints and diagnostics.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:288 filter_by_name_unhygienic_and_kind
  *filter_by_name_unhygienic_and_kind(self: AssocItems, name: Symbol, assoc_tag: AssocTag): Generator<AssocItem> {
    for (const item of AssocItems.filter_by_name_unhygienic(self, name)) {
      if (AssocItem.tag(item) === assoc_tag) yield item;
    }
  },

  /// Returns the associated item with the given identifier and `AssocKind`, if one exists.
  /// The identifier is matched hygienically.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:298 find_by_ident_and_kind
  find_by_ident_and_kind(self: AssocItems, tcx: TyCtxt, ident: Ident, assoc_tag: AssocTag, parent_def_id: DefId): AssocItem | undefined {
    for (const item of AssocItems.filter_by_name_unhygienic(self, ident.name)) {
      if (!(AssocItem.tag(item) === assoc_tag)) continue;
      if (tcx.hygienic_eq(ident, AssocItem.ident(item, tcx), parent_def_id)) return item;
    }
    return undefined;
  },

  /// Returns the associated item with the given identifier in the given `Namespace`, if one
  /// exists. The identifier is matched hygienically.
  // rustc: compiler/rustc_middle/src/ty/assoc.rs:312 find_by_ident_and_namespace
  find_by_ident_and_namespace(self: AssocItems, tcx: TyCtxt, ident: Ident, ns: Namespace, parent_def_id: DefId): AssocItem | undefined {
    for (const item of AssocItems.filter_by_name_unhygienic(self, ident.name)) {
      if (!(AssocItem.namespace(item) === ns)) continue;
      if (tcx.hygienic_eq(ident, AssocItem.ident(item, tcx), parent_def_id)) return item;
    }
    return undefined;
  },
};

// ---- impl TyCtxt ---------------------------------------------------------------------------------------------------

/// Given an `fn_def_id` of a trait or a trait implementation:
///
/// if `fn_def_id` is a function defined inside a trait, then it synthesizes
/// a new def id corresponding to a new associated type for each return-
/// position `impl Trait` in the signature.
///
/// if `fn_def_id` is a function inside of an impl, then for each synthetic
/// associated type generated for the corresponding trait function described
/// above, synthesize a corresponding associated type in the impl.
// rustc: compiler/rustc_middle/src/ty/assoc.rs:335 associated_types_for_impl_traits_in_associated_fn
TyCtxt.prototype.associated_types_for_impl_traits_in_associated_fn = function (this: TyCtxt, fn_def_id: DefId): readonly DefId[] {
  const parent_def_id = this.parent(fn_def_id);
  // `&map[&fn_def_id]` (`impl Index for IndexMap`: panics on a missing key)
  const v = this.associated_types_for_impl_traits_in_trait_or_impl(parent_def_id).get(fn_def_id);
  if (v === undefined) panic("IndexMap: key not found");
  return v;
};
