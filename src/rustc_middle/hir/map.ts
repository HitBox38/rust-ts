//! This module used to contain a type called `Map`. That type has since been
//! eliminated, and all its methods are now on `TyCtxt`. But the module name
//! stays as `map` because there isn't an obviously better name for it.
// Port of compiler/rustc_middle/src/hir/map.rs (lane middle-hir).
//
// PORT decisions (see also hir/mod.ts):
// - The `impl TyCtxt` methods are attached to `TyCtxt.prototype` (PORTING §5); this module is loaded through
//   hir/mod.ts by rustc_middle/lib.ts, after ty/context.ts.
// - `impl Iterator` results are arrays, except the ancestor walks (`ParentHirIterator`, `ParentOwnerIterator`,
//   `hir_parent_iter`), which stay lazy: their callers stop early and every step may run a query.
// - Generic visitor fns (`V: Visitor`) take a `Visitor<R>`; `V::Result` is `visitor.Result` and `walk_list!` /
//   `try_visit!` are expanded inline as in rustc_hir/intravisit.ts.
// - `impl intravisit::HirTyCtxt for TyCtxt` is `TyCtxt_as_HirTyCtxt(tcx)`, the `&tcx as &dyn HirTyCtxt` view.
import type { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { try_visit } from "../../rustc_ast_ir/visit.ts";
import { type Attribute, find_attr } from "../../rustc_attr_ir/lib.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { type StableHashCtxt, StableHasher, stable_hash_Fingerprint, stable_hash_Hash64, stable_hash_tuple2, stable_hash_Vec } from "../../rustc_data_structures/stable_hash.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
import { debug_DefKind, Res } from "../../rustc_hir/def.ts";
import {
  type AnonConst,
  type AttributeMap,
  type Body,
  type BodyId,
  type BodyOwnerKind,
  type ConstBlock,
  type ConstContext,
  type Constness,
  type DelegationInfo,
  type Expr,
  type FnDecl,
  type FnRetTy,
  type FnSig,
  type ForeignItem,
  type ForeignItemId,
  GenericBound,
  type Generics,
  type ImplItem,
  type ImplItemId,
  type Item,
  type ItemId,
  ItemKind,
  MaybeOwner,
  type Mod,
  Node,
  type OpaqueTy,
  OwnerNode,
  type OwnerNodes,
  type TraitCandidate,
  type TraitItem,
  type TraitItemId,
  type Ty,
  VariantData,
  debug_OwnerNode,
} from "../../rustc_hir/hir.ts";
import {
  type HirTyCtxt,
  Visitor,
  walk_anon_const,
  walk_expr,
  walk_foreign_item,
  walk_impl_item,
  walk_inline_const,
  walk_item,
  walk_mod,
  walk_opaque_ty,
  walk_trait_item,
} from "../../rustc_hir/intravisit.ts";
import { stable_hash_OwnerInfo } from "../../rustc_hir/stable_hash_impls.ts";
import type { DefKey, DefPath } from "../../rustc_hir_id/definitions.ts";
import { CRATE_HIR_ID, CRATE_OWNER_ID, debug_HirId, display_HirId, HirId, HirId_eq, HirId_make_owner, ItemLocalId, type OwnerId, OwnerId_from_LocalModId } from "../../rustc_hir_id/lib.ts";
import {
  CRATE_MOD_ID,
  type DefId,
  type DefPathHash,
  debug_DefId,
  debug_LocalDefId,
  LOCAL_CRATE,
  LocalDefId,
  LocalModId,
  type StableCrateId,
  stable_hash_LocalDefId,
} from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span, type StableSourceFileId, stable_hash_Span, with_metavar_spans } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { stable_hash_DefPathHash, stable_hash_LocalModId, stable_hash_StableCrateId, stable_hash_StableSourceFileId } from "../../rustc_span/stable_hash.gen.ts";
import { display_Ident, Ident, kw, type Symbol } from "../../rustc_span/symbol.ts";
import { AnonConstKind } from "../../rustc_type_ir/const_kind.gen.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import { Panic, panic, unported, unreachable } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { type IntoQueryKey, into_query_key_DefId, into_query_key_LocalDefId } from "../query/into_query_key.ts";
import { stable_hash_Visibility } from "../stable_hash.gen.ts";
import { TyCtxt } from "../ty/context.ts";
import { ModuleItems, ProjectedMaybeOwner } from "./mod.ts";
import { All } from "./nested_filter.ts";

/** PORT: the `hir_crate_items` / `hir_module_items` query values are `unknown` in queries.gen.ts. */
function crate_items(tcx: TyCtxt): ModuleItems {
  return tcx.hir_crate_items(null) as ModuleItems;
}

/**
 * `rustc_data_structures::sync::{par_for_each_in, try_par_for_each_in}` (sync/parallel.rs). PORT: pending-lane shims
 * (parallel.rs is not ported).
 */
function par_for_each_in<T>(_t: readonly T[], _for_each: (i: T) => void): void {
  return unported("rustc_data_structures::sync::parallel::par_for_each_in (pending sync/parallel.rs)");
}
function try_par_for_each_in<T>(_t: readonly T[], _for_each: (i: T) => Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return unported("rustc_data_structures::sync::parallel::try_par_for_each_in (pending sync/parallel.rs)");
}

// rustc-type: compiler/rustc_middle/src/hir/map.rs:29 ParentHirIterator
/// An iterator that walks up the ancestor tree of a given `HirId`.
/// Constructed using `tcx.hir_parent_iter(hir_id)`.
export class ParentHirIterator implements Iterable<HirId> {
  constructor(
    public current_id: HirId,
    public tcx: TyCtxt,
    // Cache the current value of `hir_owner_nodes` to avoid repeatedly calling the same query for
    // the same owner, which will uselessly record many times the same query dependency.
    public current_owner_nodes: OwnerNodes | undefined,
  ) {}

  // rustc: compiler/rustc_middle/src/hir/map.rs:39 new
  static new(tcx: TyCtxt, current_id: HirId): ParentHirIterator {
    return new ParentHirIterator(current_id, tcx, undefined);
  }

  // impl Iterator for ParentHirIterator
  // rustc: compiler/rustc_middle/src/hir/map.rs:47 next
  next(): HirId | undefined {
    if (HirId_eq(this.current_id, CRATE_HIR_ID)) {
      return undefined;
    }

    const { owner, local_id } = this.current_id;

    let parent_id: HirId;
    if (local_id === ItemLocalId.ZERO) {
      // We go from an owner to its parent, so clear the cache.
      this.current_owner_nodes = undefined;
      parent_id = this.tcx.hir_owner_parent(owner);
    } else {
      const owner_nodes = (this.current_owner_nodes ??= this.tcx.hir_owner_nodes(owner));
      const parent_local_id = owner_nodes.nodes[local_id]!.parent;
      // HIR indexing should have checked that.
      // debug_assert_ne!(parent_local_id, local_id);
      parent_id = new HirId(owner, parent_local_id);
    }

    // debug_assert_ne!(parent_id, self.current_id);

    this.current_id = parent_id;
    return parent_id;
  }

  *[globalThis.Symbol.iterator](): Iterator<HirId> {
    let id: HirId | undefined;
    while ((id = this.next()) !== undefined) yield id;
  }
}

// rustc-type: compiler/rustc_middle/src/hir/map.rs:76 ParentOwnerIterator
/// An iterator that walks up the ancestor tree of a given `HirId`.
/// Constructed using `tcx.hir_parent_owner_iter(hir_id)`.
export class ParentOwnerIterator implements Iterable<[OwnerId, OwnerNode]> {
  constructor(
    public current_id: HirId,
    public tcx: TyCtxt,
  ) {}

  // impl Iterator for ParentOwnerIterator
  // rustc: compiler/rustc_middle/src/hir/map.rs:84 next
  next(): [OwnerId, OwnerNode] | undefined {
    if (ItemLocalId.index(this.current_id.local_id) !== 0) {
      this.current_id = new HirId(this.current_id.owner, ItemLocalId.ZERO);
      const node = this.tcx.hir_owner_node(this.current_id.owner);
      return [this.current_id.owner, node];
    }
    if (HirId_eq(this.current_id, CRATE_HIR_ID)) {
      return undefined;
    }

    const parent_index = this.tcx.hir_def_key(this.current_id.owner.def_id).parent;
    const parent_id =
      parent_index === undefined
        ? CRATE_OWNER_ID
        : ((local_def_index) => {
            const def_id = LocalDefId.of(local_def_index);
            return this.tcx.local_def_id_to_hir_id(def_id).owner;
          })(parent_index);
    this.current_id = HirId_make_owner(parent_id.def_id);

    const node = this.tcx.hir_owner_node(this.current_id.owner);
    return [this.current_id.owner, node];
  }

  *[globalThis.Symbol.iterator](): Iterator<[OwnerId, OwnerNode]> {
    let x: [OwnerId, OwnerNode] | undefined;
    while ((x = this.next()) !== undefined) yield x;
  }
}

declare module "../ty/context.ts" {
  interface TyCtxt {
    local_def_id_to_hir_id(def_id: IntoQueryKey<LocalDefId>): HirId;
    opt_ast_lowering_delayed_lints(id: OwnerId): Steal<unknown> | undefined;
    in_scope_traits_map(id: OwnerId): Map<ItemLocalId, readonly TraitCandidate[]> | undefined;
    opt_hir_owner_nodes(def_id: LocalDefId): OwnerNodes | undefined;
    /** private (`fn`) upstream */
    expect_hir_owner_nodes(def_id: LocalDefId): OwnerNodes;
    hir_owner_nodes(owner_id: OwnerId): OwnerNodes;
    /** private (`fn`) upstream */
    opt_hir_owner_node(def_id: LocalDefId): OwnerNode | undefined;
    expect_hir_owner_node(def_id: LocalDefId): OwnerNode;
    hir_owner_node(owner_id: OwnerId): OwnerNode;
    hir_node(id: HirId): Node;
    hir_node_by_def_id(id: LocalDefId): Node;
    parent_hir_id(hir_id: HirId): HirId;
    parent_hir_node(hir_id: HirId): Node;
    hir_root_module(): Mod;
    hir_free_items(): readonly ItemId[];
    hir_module_free_items(module: LocalModId): readonly ItemId[];
    hir_def_key(def_id: LocalDefId): DefKey;
    hir_def_path(def_id: LocalDefId): DefPath;
    hir_def_path_hash(def_id: LocalDefId): DefPathHash;
    hir_get_if_local(id: DefId): Node | undefined;
    hir_get_generics(id: LocalDefId): Generics | undefined;
    hir_item(id: ItemId): Item;
    hir_trait_item(id: TraitItemId): TraitItem;
    hir_impl_item(id: ImplItemId): ImplItem;
    hir_foreign_item(id: ForeignItemId): ForeignItem;
    hir_body(id: BodyId): Body;
    hir_fn_decl_by_hir_id(hir_id: HirId): FnDecl | undefined;
    hir_fn_sig_by_hir_id(hir_id: HirId): FnSig | undefined;
    hir_enclosing_body_owner(hir_id: HirId): LocalDefId;
    hir_body_owner(id: BodyId): HirId;
    hir_body_owner_def_id(id: BodyId): LocalDefId;
    hir_maybe_body_owned_by(id: LocalDefId): Body | undefined;
    hir_body_owned_by(id: LocalDefId): Body;
    hir_body_param_idents(id: BodyId): (Ident | undefined)[];
    hir_body_owner_kind(def_id: IntoQueryKey<DefId>): BodyOwnerKind;
    hir_body_const_context(local_def_id: LocalDefId): ConstContext | undefined;
    hir_body_owners(): readonly LocalDefId[];
    par_hir_body_owners(f: (def_id: LocalDefId) => void): void;
    hir_ty_param_owner(def_id: LocalDefId): LocalDefId;
    hir_ty_param_name(def_id: LocalDefId): Symbol;
    hir_krate_attrs(): readonly Attribute[];
    hir_rustc_coherence_is_core(): boolean;
    hir_get_module(module: LocalModId): [Mod, Span];
    hir_walk_toplevel_module<R>(visitor: Visitor<R>): R;
    hir_walk_attributes<R>(visitor: Visitor<R>): R;
    hir_visit_all_item_likes_in_crate<R>(visitor: Visitor<R>): R;
    hir_visit_item_likes_in_module<R>(module: LocalModId, visitor: Visitor<R>): R;
    hir_for_each_module(f: (module: LocalModId) => void): void;
    par_hir_for_each_module(f: (module: LocalModId) => void): void;
    try_par_hir_for_each_module(f: (module: LocalModId) => Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed>;
    hir_parent_id_iter(current_id: HirId): ParentHirIterator;
    hir_parent_iter(current_id: HirId): Iterable<[HirId, Node]>;
    hir_parent_owner_iter(current_id: HirId): ParentOwnerIterator;
    hir_is_lhs(id: HirId): boolean;
    hir_is_inside_const_context(hir_id: HirId): boolean;
    hir_get_fn_id_for_return_block(id: HirId): HirId | undefined;
    hir_get_parent_item(hir_id: HirId): OwnerId;
    hir_get_if_cause(hir_id: HirId): Expr | undefined;
    hir_get_enclosing_scope(hir_id: HirId): HirId | undefined;
    hir_get_defining_scope(id: HirId): HirId;
    hir_id_to_string(id: HirId): string;
    hir_get_foreign_abi(hir_id: HirId): ExternAbi;
    hir_expect_item(id: LocalDefId): Item;
    hir_expect_impl_item(id: LocalDefId): ImplItem;
    hir_expect_trait_item(id: LocalDefId): TraitItem;
    hir_get_fn_output(def_id: LocalDefId): FnRetTy | undefined;
    hir_expect_opaque_ty(id: LocalDefId): OpaqueTy;
    hir_expect_expr(id: HirId): Expr;
    hir_opt_delegation_sig_id(def_id: LocalDefId): DefId | undefined;
    hir_opt_delegation_info(def_id: LocalDefId): DelegationInfo | undefined;
    hir_delegation_info(delegation_id: LocalDefId): DelegationInfo;
    /** private (`fn`) upstream */
    hir_opt_ident(id: HirId): Ident | undefined;
    /** `pub(super)` upstream */
    hir_opt_ident_span(id: HirId): Span | undefined;
    hir_ident(id: HirId): Ident;
    hir_opt_name(id: HirId): Symbol | undefined;
    hir_name(id: HirId): Symbol;
    hir_attrs(id: HirId): readonly Attribute[];
    hir_span(hir_id: HirId): Span;
    hir_span_with_body(hir_id: HirId): Span;
    hir_span_if_local(id: DefId): Span | undefined;
    hir_res_span(res: Res): Span | undefined;
    hir_opt_const_param_default_param_def_id(anon_const: HirId): LocalDefId | undefined;
    hir_maybe_get_struct_pattern_shorthand_field(expr: Expr): Symbol | undefined;
  }
}

// rustc: compiler/rustc_middle/src/hir/map.rs:108 local_def_id_to_hir_id
TyCtxt.prototype.local_def_id_to_hir_id = function (this: TyCtxt, def_id_: IntoQueryKey<LocalDefId>): HirId {
  const def_id = into_query_key_LocalDefId(def_id_);
  const owner = this.hir_owner(def_id) as ProjectedMaybeOwner;
  switch (owner.$) {
    case "Owner":
      return HirId_make_owner(def_id);
    case "NonOwner":
      return owner._0;
  }
};

/// This function is used only inside eval-always query `analysis`
/// (`analysis -> run_required_analysis` -> `emit_delayed_lints`), so it is safe
/// to obtain delayed lints from non-eval-always `owner` query.
// rustc: compiler/rustc_middle/src/hir/map.rs:120 opt_ast_lowering_delayed_lints
TyCtxt.prototype.opt_ast_lowering_delayed_lints = function (this: TyCtxt, id: OwnerId): Steal<unknown> | undefined {
  // `self.dep_graph.assert_eval_always()` (dep_graph/graph.rs:261) checks nothing without a dep graph (D3).
  if (this.dep_graph.is_fully_enabled()) unported("rustc_middle::dep_graph::DepGraph::assert_eval_always with a dep graph (D3)");
  return ProjectedMaybeOwner.as_owner(this.hir_owner(id.def_id) as ProjectedMaybeOwner)?.delayed_lints;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:126 in_scope_traits_map
TyCtxt.prototype.in_scope_traits_map = function (this: TyCtxt, id: OwnerId): Map<ItemLocalId, readonly TraitCandidate[]> | undefined {
  return ProjectedMaybeOwner.as_owner(this.hir_owner(id.def_id) as ProjectedMaybeOwner)?.trait_map;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:134 opt_hir_owner_nodes
TyCtxt.prototype.opt_hir_owner_nodes = function (this: TyCtxt, def_id: LocalDefId): OwnerNodes | undefined {
  return ProjectedMaybeOwner.as_owner(this.hir_owner(def_id) as ProjectedMaybeOwner)?.nodes;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:139 expect_hir_owner_nodes
TyCtxt.prototype.expect_hir_owner_nodes = function (this: TyCtxt, def_id: LocalDefId): OwnerNodes {
  const nodes = this.opt_hir_owner_nodes(def_id);
  return nodes !== undefined ? nodes : span_bug(this.def_span(def_id), `${debug_LocalDefId(def_id, PLAIN)} is not an owner`);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:145 hir_owner_nodes
TyCtxt.prototype.hir_owner_nodes = function (this: TyCtxt, owner_id: OwnerId): OwnerNodes {
  return this.expect_hir_owner_nodes(owner_id.def_id);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:150 opt_hir_owner_node
TyCtxt.prototype.opt_hir_owner_node = function (this: TyCtxt, def_id: LocalDefId): OwnerNode | undefined {
  return this.opt_hir_owner_nodes(def_id)?.node();
};

// rustc: compiler/rustc_middle/src/hir/map.rs:155 expect_hir_owner_node
TyCtxt.prototype.expect_hir_owner_node = function (this: TyCtxt, def_id: LocalDefId): OwnerNode {
  return this.expect_hir_owner_nodes(def_id).node();
};

// rustc: compiler/rustc_middle/src/hir/map.rs:160 hir_owner_node
TyCtxt.prototype.hir_owner_node = function (this: TyCtxt, owner_id: OwnerId): OwnerNode {
  return this.hir_owner_nodes(owner_id).node();
};

/// Retrieves the `hir::Node` corresponding to `id`.
// rustc: compiler/rustc_middle/src/hir/map.rs:165 hir_node
TyCtxt.prototype.hir_node = function (this: TyCtxt, id: HirId): Node {
  return this.hir_owner_nodes(id.owner).nodes[id.local_id]!.node;
};

/// Retrieves the `hir::Node` corresponding to `id`.
// rustc: compiler/rustc_middle/src/hir/map.rs:171 hir_node_by_def_id
TyCtxt.prototype.hir_node_by_def_id = function (this: TyCtxt, id: LocalDefId): Node {
  return this.hir_node(this.local_def_id_to_hir_id(id));
};

/// Returns `HirId` of the parent HIR node of node with this `hir_id`.
/// Returns the same `hir_id` if and only if `hir_id == CRATE_HIR_ID`.
///
/// If calling repeatedly and iterating over parents, prefer [`TyCtxt::hir_parent_iter`].
// rustc: compiler/rustc_middle/src/hir/map.rs:179 parent_hir_id
TyCtxt.prototype.parent_hir_id = function (this: TyCtxt, hir_id: HirId): HirId {
  const { owner, local_id } = hir_id;
  if (local_id === ItemLocalId.ZERO) {
    return this.hir_owner_parent(owner);
  } else {
    const parent_local_id = this.hir_owner_nodes(owner).nodes[local_id]!.parent;
    // HIR indexing should have checked that.
    // debug_assert_ne!(parent_local_id, local_id);
    return new HirId(owner, parent_local_id);
  }
};

/// Returns parent HIR node of node with this `hir_id`.
/// Returns HIR node of the same `hir_id` if and only if `hir_id == CRATE_HIR_ID`.
// rustc: compiler/rustc_middle/src/hir/map.rs:193 parent_hir_node
TyCtxt.prototype.parent_hir_node = function (this: TyCtxt, hir_id: HirId): Node {
  return this.hir_node(this.parent_hir_id(hir_id));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:198 hir_root_module
TyCtxt.prototype.hir_root_module = function (this: TyCtxt): Mod {
  const node = this.hir_owner_node(CRATE_OWNER_ID);
  switch (node.$) {
    case "Crate":
      return node._0;
    default:
      return bug();
  }
};

// rustc: compiler/rustc_middle/src/hir/map.rs:206 hir_free_items
TyCtxt.prototype.hir_free_items = function (this: TyCtxt): readonly ItemId[] {
  return crate_items(this).free_items_;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:211 hir_module_free_items
TyCtxt.prototype.hir_module_free_items = function (this: TyCtxt, module: LocalModId): readonly ItemId[] {
  return (this.hir_module_items(module) as ModuleItems).free_items();
};

// rustc: compiler/rustc_middle/src/hir/map.rs:215 hir_def_key
TyCtxt.prototype.hir_def_key = function (this: TyCtxt, def_id: LocalDefId): DefKey {
  // Accessing the DefKey is ok, since it is part of DefPathHash.
  return this.definitions_untracked().def_key(def_id);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:220 hir_def_path
TyCtxt.prototype.hir_def_path = function (this: TyCtxt, def_id: LocalDefId): DefPath {
  // Accessing the DefPath is ok, since it is part of DefPathHash.
  return this.definitions_untracked().def_path(def_id);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:226 hir_def_path_hash
TyCtxt.prototype.hir_def_path_hash = function (this: TyCtxt, def_id: LocalDefId): DefPathHash {
  // Accessing the DefPathHash is ok, it is incr. comp. stable.
  return this.definitions_untracked().def_path_hash(def_id);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:231 hir_get_if_local
TyCtxt.prototype.hir_get_if_local = function (this: TyCtxt, id: DefId): Node | undefined {
  const local = id.as_local();
  return local === undefined ? undefined : this.hir_node_by_def_id(local);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:235 hir_get_generics
TyCtxt.prototype.hir_get_generics = function (this: TyCtxt, id: LocalDefId): Generics | undefined {
  const node = this.opt_hir_owner_node(id);
  if (node === undefined) return undefined;
  return OwnerNode.generics(node);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:239 hir_item
TyCtxt.prototype.hir_item = function (this: TyCtxt, id: ItemId): Item {
  return OwnerNode.expect_item(this.hir_owner_node(id.owner_id));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:243 hir_trait_item
TyCtxt.prototype.hir_trait_item = function (this: TyCtxt, id: TraitItemId): TraitItem {
  return OwnerNode.expect_trait_item(this.hir_owner_node(id.owner_id));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:247 hir_impl_item
TyCtxt.prototype.hir_impl_item = function (this: TyCtxt, id: ImplItemId): ImplItem {
  return OwnerNode.expect_impl_item(this.hir_owner_node(id.owner_id));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:251 hir_foreign_item
TyCtxt.prototype.hir_foreign_item = function (this: TyCtxt, id: ForeignItemId): ForeignItem {
  return OwnerNode.expect_foreign_item(this.hir_owner_node(id.owner_id));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:255 hir_body
TyCtxt.prototype.hir_body = function (this: TyCtxt, id: BodyId): Body {
  const body = this.hir_owner_nodes(id.hir_id.owner).bodies.get(id.hir_id.local_id);
  // `SortedMap`'s `Index` panics on a missing key.
  return body !== undefined ? body : panic("key not found");
};

// rustc: compiler/rustc_middle/src/hir/map.rs:260 hir_fn_decl_by_hir_id
TyCtxt.prototype.hir_fn_decl_by_hir_id = function (this: TyCtxt, hir_id: HirId): FnDecl | undefined {
  return Node.fn_decl(this.hir_node(hir_id));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:265 hir_fn_sig_by_hir_id
TyCtxt.prototype.hir_fn_sig_by_hir_id = function (this: TyCtxt, hir_id: HirId): FnSig | undefined {
  return Node.fn_sig(this.hir_node(hir_id));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:270 hir_enclosing_body_owner
TyCtxt.prototype.hir_enclosing_body_owner = function (this: TyCtxt, hir_id: HirId): LocalDefId {
  for (const [, node] of this.hir_parent_iter(hir_id)) {
    const body = Node.associated_body(node);
    if (body !== undefined) {
      const [def_id] = body;
      return def_id;
    }
  }

  return bug(`no \`hir_enclosing_body_owner\` for hir_id \`${display_HirId(hir_id)}\``);
};

/// Returns the `HirId` that corresponds to the definition of
/// which this is the body of, i.e., a `fn`, `const` or `static`
/// item (possibly associated), a closure, or a `hir::AnonConst`.
// rustc: compiler/rustc_middle/src/hir/map.rs:283 hir_body_owner
TyCtxt.prototype.hir_body_owner = function (this: TyCtxt, { hir_id }: BodyId): HirId {
  const parent = this.parent_hir_id(hir_id);
  const left = Node.body_id(this.hir_node(parent));
  if (left === undefined) panic("called `Option::unwrap()` on a `None` value");
  // assert_eq!(.., hir_id, "{hir_id:?}")
  if (!HirId_eq(left.hir_id, hir_id)) {
    throw new Panic(
      `assertion \`left == right\` failed: ${debug_HirId(hir_id, PLAIN)}\n  left: ${debug_HirId(left.hir_id, PLAIN)}\n right: ${debug_HirId(hir_id, PLAIN)}`,
    );
  }
  return parent;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:289 hir_body_owner_def_id
TyCtxt.prototype.hir_body_owner_def_id = function (this: TyCtxt, { hir_id }: BodyId): LocalDefId {
  const body = Node.associated_body(this.parent_hir_node(hir_id));
  if (body === undefined) return panic("called `Option::unwrap()` on a `None` value");
  return body[0];
};

/// Given a `LocalDefId`, returns the `BodyId` associated with it,
/// if the node is a body owner, otherwise returns `None`.
// rustc: compiler/rustc_middle/src/hir/map.rs:295 hir_maybe_body_owned_by
TyCtxt.prototype.hir_maybe_body_owned_by = function (this: TyCtxt, id: LocalDefId): Body | undefined {
  const body_id = Node.body_id(this.hir_node_by_def_id(id));
  if (body_id === undefined) return undefined;
  return this.hir_body(body_id);
};

/// Given a body owner's id, returns the `BodyId` associated with it.
// rustc: compiler/rustc_middle/src/hir/map.rs:301 hir_body_owned_by
TyCtxt.prototype.hir_body_owned_by = function (this: TyCtxt, id: LocalDefId): Body {
  const body = this.hir_maybe_body_owned_by(id);
  if (body !== undefined) return body;
  const hir_id = this.local_def_id_to_hir_id(id);
  return span_bug(this.hir_span(hir_id), `body_owned_by: ${this.hir_id_to_string(hir_id)} has no associated body`);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:312 hir_body_param_idents
TyCtxt.prototype.hir_body_param_idents = function (this: TyCtxt, id: BodyId): (Ident | undefined)[] {
  return this.hir_body(id).params.map((param) => {
    const kind = param.pat.kind;
    switch (kind.$) {
      case "Binding":
        return kind._2;
      case "Wild":
        return Ident.new(kw.Underscore, param.pat.span);
      default:
        return undefined;
    }
  });
};

/// Returns the `BodyOwnerKind` of this `LocalDefId`.
///
/// Panics if `LocalDefId` does not have an associated body.
// rustc: compiler/rustc_middle/src/hir/map.rs:323 hir_body_owner_kind
TyCtxt.prototype.hir_body_owner_kind = function (this: TyCtxt, def_id_: IntoQueryKey<DefId>): BodyOwnerKind {
  const def_id = into_query_key_DefId(def_id_);
  const dk = this.def_kind(def_id);
  switch (dk.$) {
    case "Const":
    case "AssocConst":
      return { $: "Const", inline: false };
    case "AnonConst":
      return {
        $: "Const",
        // PORT: the `anon_const_kind` query value is `unknown` in queries.gen.ts (`ty::AnonConstKind`, a
        // fieldless enum: a string literal).
        inline: (this.anon_const_kind(def_id) as AnonConstKind) === AnonConstKind.NonTypeSystemInline,
      };
    case "Ctor":
    case "Fn":
    case "AssocFn":
      return { $: "Fn" };
    case "Closure":
    case "SyntheticCoroutineBody":
      return { $: "Closure" };
    case "Static":
      if (!dk.nested) {
        return { $: "Static", _0: dk.mutability };
      }
      break;
    case "GlobalAsm":
      return { $: "GlobalAsm" };
  }
  return bug(`${format_debug(def_id, debug_DefId, PLAIN)} is not a body node: ${format_debug(dk, debug_DefKind, PLAIN)}`);
};

/// Returns the `ConstContext` of the body associated with this `LocalDefId`.
///
/// Panics if `LocalDefId` does not have an associated body.
///
/// This should only be used for determining the context of a body, a return
/// value of `Some` does not always suggest that the owner of the body is `const`,
/// just that it has to be checked as if it were.
// rustc: compiler/rustc_middle/src/hir/map.rs:347 hir_body_const_context
TyCtxt.prototype.hir_body_const_context = function (this: TyCtxt, local_def_id: LocalDefId): ConstContext | undefined {
  const def_id = LocalDefId.to_def_id(local_def_id);
  let ccx: ConstContext;
  const kind = this.hir_body_owner_kind(def_id);
  switch (kind.$) {
    case "Const":
      ccx = { $: "Const", allow_const_fn_promotion: !kind.inline };
      break;
    case "Static":
      ccx = { $: "Static", _0: kind._0 };
      break;

    case "Fn":
    case "Closure":
    case "GlobalAsm":
      if (kind.$ === "Fn" && this.is_constructor(def_id)) return undefined;
      if ((kind.$ === "Fn" || kind.$ === "Closure") && this.is_const_fn(def_id)) {
        // PORT: the `constness` query value is `unknown` in queries.gen.ts (`hir::Constness`).
        const constness = this.constness(def_id) as Constness;
        if (constness.$ === "Const" && constness.always) {
          ccx = { $: "Const", allow_const_fn_promotion: false };
        } else {
          ccx = { $: "ConstFn" };
        }
        break;
      }
      return undefined;
  }

  return ccx;
};

/// Returns an iterator of the `DefId`s for all body-owners in this
/// crate.
// rustc: compiler/rustc_middle/src/hir/map.rs:372 hir_body_owners
TyCtxt.prototype.hir_body_owners = function (this: TyCtxt): readonly LocalDefId[] {
  return crate_items(this).body_owners;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:377 par_hir_body_owners
TyCtxt.prototype.par_hir_body_owners = function (this: TyCtxt, f: (def_id: LocalDefId) => void): void {
  par_for_each_in(crate_items(this).body_owners, (def_id) => f(def_id));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:381 hir_ty_param_owner
TyCtxt.prototype.hir_ty_param_owner = function (this: TyCtxt, def_id: LocalDefId): LocalDefId {
  const def_kind = this.def_kind(def_id);
  switch (def_kind.$) {
    case "Trait":
    case "TraitAlias":
      return def_id;
    case "LifetimeParam":
    case "TyParam":
    case "ConstParam":
      return this.local_parent(def_id);
    default:
      return bug(`ty_param_owner: ${debug_LocalDefId(def_id, PLAIN)} is a ${format_debug(def_kind, debug_DefKind, PLAIN)} not a type parameter`);
  }
};

// rustc: compiler/rustc_middle/src/hir/map.rs:392 hir_ty_param_name
TyCtxt.prototype.hir_ty_param_name = function (this: TyCtxt, def_id: LocalDefId): Symbol {
  const def_kind = this.def_kind(def_id);
  switch (def_kind.$) {
    case "Trait":
    case "TraitAlias":
      return kw.SelfUpper;
    case "LifetimeParam":
    case "TyParam":
    case "ConstParam":
      return this.item_name(LocalDefId.to_def_id(def_id));
    default:
      return bug(`ty_param_name: ${debug_LocalDefId(def_id, PLAIN)} is a ${format_debug(def_kind, debug_DefKind, PLAIN)} not a type parameter`);
  }
};

/// Gets the attributes on the crate. This is preferable to
/// invoking `krate.attrs` because it registers a tighter
/// dep-graph access.
// rustc: compiler/rustc_middle/src/hir/map.rs:406 hir_krate_attrs
TyCtxt.prototype.hir_krate_attrs = function (this: TyCtxt): readonly Attribute[] {
  return this.hir_attrs(CRATE_HIR_ID);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:410 hir_rustc_coherence_is_core
TyCtxt.prototype.hir_rustc_coherence_is_core = function (this: TyCtxt): boolean {
  return find_attr(this.hir_krate_attrs(), (k) => (k.$ === "RustcCoherenceIsCore" ? null : undefined)) !== undefined;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:414 hir_get_module
TyCtxt.prototype.hir_get_module = function (this: TyCtxt, module: LocalModId): [Mod, Span] {
  const node = this.hir_owner_node(OwnerId_from_LocalModId(module));
  if (node.$ === "Item" && node._0.kind.$ === "Mod") {
    return [node._0.kind._1, node._0.span];
  }
  if (node.$ === "Crate") {
    const item = node._0;
    return [item, item.spans.inner_span];
  }
  return panic(`not a module: ${format_debug(node, debug_OwnerNode, PLAIN)}`);
};

/// Walks the contents of the local crate. See also `visit_all_item_likes_in_crate`.
// rustc: compiler/rustc_middle/src/hir/map.rs:423 hir_walk_toplevel_module
TyCtxt.prototype.hir_walk_toplevel_module = function <R>(this: TyCtxt, visitor: Visitor<R>): R {
  const [top_mod, span] = this.hir_get_module(CRATE_MOD_ID);
  return visitor.visit_mod(top_mod, span, CRATE_MOD_ID);
};

/// Walks the attributes in a crate.
// rustc: compiler/rustc_middle/src/hir/map.rs:432 hir_walk_attributes
TyCtxt.prototype.hir_walk_attributes = function <R>(this: TyCtxt, visitor: Visitor<R>): R {
  let r: R | undefined;
  const krate = crate_items(this);
  for (const owner of krate.owners()) {
    const attrs = this.hir_attr_map(owner) as AttributeMap;
    // `attrs.map.values()`
    for (const [, attrs_] of attrs.map.iter()) {
      for (const attr of attrs_) {
        if ((r = try_visit(visitor.Result, visitor.visit_attribute(attr))) !== undefined) return r;
      }
    }
  }
  return visitor.Result.output();
};

/// Visits all item-likes in the crate in some deterministic (but unspecified) order. If you
/// need to process every item-like, and don't care about visiting nested items in a particular
/// order then this method is the best choice. If you do care about this nesting, you should
/// use the `tcx.hir_walk_toplevel_module`.
///
/// Note that this function will access HIR for all the item-likes in the crate. If you only
/// need to access some of them, it is usually better to manually loop on the iterators
/// provided by `tcx.hir_crate_items(())`.
///
/// Please see the notes in `intravisit.rs` for more information.
// rustc: compiler/rustc_middle/src/hir/map.rs:456 hir_visit_all_item_likes_in_crate
TyCtxt.prototype.hir_visit_all_item_likes_in_crate = function <R>(this: TyCtxt, visitor: Visitor<R>): R {
  let r: R | undefined;
  const krate = crate_items(this);
  for (const id of krate.free_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_item(this.hir_item(id)))) !== undefined) return r;
  }
  for (const id of krate.trait_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_trait_item(this.hir_trait_item(id)))) !== undefined) return r;
  }
  for (const id of krate.impl_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_impl_item(this.hir_impl_item(id)))) !== undefined) return r;
  }
  for (const id of krate.foreign_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_foreign_item(this.hir_foreign_item(id)))) !== undefined) return r;
  }
  return visitor.Result.output();
};

/// This method is the equivalent of `visit_all_item_likes_in_crate` but restricted to
/// item-likes in a single module.
// rustc: compiler/rustc_middle/src/hir/map.rs:478 hir_visit_item_likes_in_module
TyCtxt.prototype.hir_visit_item_likes_in_module = function <R>(this: TyCtxt, module_: LocalModId, visitor: Visitor<R>): R {
  let r: R | undefined;
  const module = this.hir_module_items(module_) as ModuleItems;
  for (const id of module.free_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_item(this.hir_item(id)))) !== undefined) return r;
  }
  for (const id of module.trait_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_trait_item(this.hir_trait_item(id)))) !== undefined) return r;
  }
  for (const id of module.impl_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_impl_item(this.hir_impl_item(id)))) !== undefined) return r;
  }
  for (const id of module.foreign_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_foreign_item(this.hir_foreign_item(id)))) !== undefined) return r;
  }
  return visitor.Result.output();
};

// rustc: compiler/rustc_middle/src/hir/map.rs:498 hir_for_each_module
TyCtxt.prototype.hir_for_each_module = function (this: TyCtxt, f: (module: LocalModId) => void): void {
  const crate_items_ = crate_items(this);
  for (const module of crate_items_.submodules) {
    f(module);
  }
};

// rustc: compiler/rustc_middle/src/hir/map.rs:506 par_hir_for_each_module
TyCtxt.prototype.par_hir_for_each_module = function (this: TyCtxt, f: (module: LocalModId) => void): void {
  const crate_items_ = crate_items(this);
  par_for_each_in(crate_items_.submodules, (module) => f(module));
};

// rustc: compiler/rustc_middle/src/hir/map.rs:512 try_par_hir_for_each_module
TyCtxt.prototype.try_par_hir_for_each_module = function (
  this: TyCtxt,
  f: (module: LocalModId) => Result<null, ErrorGuaranteed>,
): Result<null, ErrorGuaranteed> {
  const crate_items_ = crate_items(this);
  return try_par_for_each_in(crate_items_.submodules, (module) => f(module));
};

/// Returns an iterator for the nodes in the ancestor tree of the `current_id`
/// until the crate root is reached. Prefer this over your own loop using `parent_id`.
// rustc: compiler/rustc_middle/src/hir/map.rs:523 hir_parent_id_iter
TyCtxt.prototype.hir_parent_id_iter = function (this: TyCtxt, current_id: HirId): ParentHirIterator {
  return ParentHirIterator.new(this, current_id);
};

/// Returns an iterator for the nodes in the ancestor tree of the `current_id`
/// until the crate root is reached. Prefer this over your own loop using `parent_id`.
// rustc: compiler/rustc_middle/src/hir/map.rs:530 hir_parent_iter
TyCtxt.prototype.hir_parent_iter = function* (this: TyCtxt, current_id: HirId): Generator<[HirId, Node]> {
  for (const id of this.hir_parent_id_iter(current_id)) {
    yield [id, this.hir_node(id)];
  }
};

/// Returns an iterator for the nodes in the ancestor tree of the `current_id`
/// until the crate root is reached. Prefer this over your own loop using `parent_id`.
// rustc: compiler/rustc_middle/src/hir/map.rs:537 hir_parent_owner_iter
TyCtxt.prototype.hir_parent_owner_iter = function (this: TyCtxt, current_id: HirId): ParentOwnerIterator {
  return new ParentOwnerIterator(current_id, this);
};

/// Checks if the node is left-hand side of an assignment.
// rustc: compiler/rustc_middle/src/hir/map.rs:542 hir_is_lhs
TyCtxt.prototype.hir_is_lhs = function (this: TyCtxt, id: HirId): boolean {
  const node = this.parent_hir_node(id);
  switch (node.$) {
    case "Expr": {
      const kind = node._0.kind;
      switch (kind.$) {
        case "Assign":
          return HirId_eq(kind._0.hir_id, id);
        default:
          return false;
      }
    }
    default:
      return false;
  }
};

/// Whether the expression pointed at by `hir_id` belongs to a `const` evaluation context.
/// Used exclusively for diagnostics, to avoid suggestion function calls.
// rustc: compiler/rustc_middle/src/hir/map.rs:554 hir_is_inside_const_context
TyCtxt.prototype.hir_is_inside_const_context = function (this: TyCtxt, hir_id: HirId): boolean {
  return this.hir_body_const_context(this.hir_enclosing_body_owner(hir_id)) !== undefined;
};

/// Retrieves the `HirId` for `id`'s enclosing function *if* the `id` block or return is
/// in the "tail" position of the function, in other words if it's likely to correspond
/// to the return type of the function.
///
/// ```
/// fn foo(x: usize) -> bool {
///     if x == 1 {
///         // If `get_fn_id_for_return_block` gets passed the `id` corresponding to this, it
///         // will return `foo`'s `HirId`.
///         true
///     } else {
///         false
///     }
/// }
/// ```
///
/// ```compile_fail,E0308
/// fn foo(x: usize) -> bool {
///     loop {
///         // If `get_fn_id_for_return_block` gets passed the `id` corresponding to this, it
///         // will return `None`.
///         true
///     }
///     false
/// }
/// ```
// rustc: compiler/rustc_middle/src/hir/map.rs:584 hir_get_fn_id_for_return_block
TyCtxt.prototype.hir_get_fn_id_for_return_block = function (this: TyCtxt, id: HirId): HirId | undefined {
  const enclosing_body_owner = this.local_def_id_to_hir_id(this.hir_enclosing_body_owner(id));

  // Return `None` if the `id` expression is not the returned value of the enclosing body
  // `[id].into_iter().chain(self.hir_parent_id_iter(id)).peekable()`
  const iter = new Peekable([id], this.hir_parent_id_iter(id));
  let cur_id: HirId | undefined;
  while ((cur_id = iter.next()) !== undefined) {
    if (HirId_eq(enclosing_body_owner, cur_id)) {
      break;
    }

    // A return statement is always the value returned from the enclosing body regardless of
    // what the parent expressions are.
    const cur_node = this.hir_node(cur_id);
    if (cur_node.$ === "Expr" && cur_node._0.kind.$ === "Ret") {
      break;
    }

    // If the current expression's value doesnt get used as the parent expressions value
    // then return `None`
    const parent_id = iter.peek();
    if (parent_id !== undefined) {
      const node = this.hir_node(parent_id);
      // The current node is not the tail expression of the block expression parent
      // expr.
      if (node.$ === "Block" && node._0.expr !== undefined && !HirId_eq(cur_id, node._0.expr.hir_id)) return undefined;
      if (node.$ === "Block" && node._0.expr !== undefined && node._0.expr.kind.$ === "If" && node._0.expr.kind._2 === undefined) {
        return undefined;
      }

      // The current expression's value does not pass up through these parent
      // expressions.
      if (
        (node.$ === "Block" && node._0.expr === undefined) ||
        (node.$ === "Expr" && node._0.kind.$ === "Loop") ||
        node.$ === "LetStmt"
      ) {
        return undefined;
      }
    }
  }

  return enclosing_body_owner;
};

/** `Chain<array::IntoIter<HirId, 1>, ParentHirIterator>` made `Peekable` (std). */
class Peekable {
  private peeked: { v: HirId | undefined } | undefined = undefined;
  private i = 0;
  constructor(
    private readonly first: readonly HirId[],
    private readonly rest: ParentHirIterator,
  ) {}
  private inner_next(): HirId | undefined {
    if (this.i < this.first.length) return this.first[this.i++];
    return this.rest.next();
  }
  next(): HirId | undefined {
    const p = this.peeked;
    if (p !== undefined) {
      this.peeked = undefined;
      return p.v;
    }
    return this.inner_next();
  }
  peek(): HirId | undefined {
    if (this.peeked === undefined) this.peeked = { v: this.inner_next() };
    return this.peeked.v;
  }
}

/// Retrieves the `OwnerId` for `id`'s parent item, or `id` itself if no
/// parent item is in this map. The "parent item" is the closest parent node
/// in the HIR which is recorded by the map and is an item, either an item
/// in a module, trait, or impl.
// rustc: compiler/rustc_middle/src/hir/map.rs:631 hir_get_parent_item
TyCtxt.prototype.hir_get_parent_item = function (this: TyCtxt, hir_id: HirId): OwnerId {
  if (hir_id.local_id !== ItemLocalId.ZERO) {
    // If this is a child of a HIR owner, return the owner.
    return hir_id.owner;
  }
  const next = this.hir_parent_owner_iter(hir_id).next();
  if (next !== undefined) {
    const [def_id] = next;
    return def_id;
  } else {
    return CRATE_OWNER_ID;
  }
};

/// When on an if expression, a match arm tail expression or a match arm, give back
/// the enclosing `if` or `match` expression.
///
/// Used by error reporting when there's a type error in an if or match arm caused by the
/// expression needing to be unit.
// rustc: compiler/rustc_middle/src/hir/map.rs:647 hir_get_if_cause
TyCtxt.prototype.hir_get_if_cause = function (this: TyCtxt, hir_id: HirId): Expr | undefined {
  for (const [, node] of this.hir_parent_iter(hir_id)) {
    if (
      node.$ === "Item" ||
      node.$ === "ForeignItem" ||
      node.$ === "TraitItem" ||
      node.$ === "ImplItem" ||
      (node.$ === "Stmt" && node._0.kind.$ === "Let")
    ) {
      break;
    }
    if (node.$ === "Expr" && (node._0.kind.$ === "If" || node._0.kind.$ === "Match")) {
      return node._0;
    }
  }
  return undefined;
};

/// Returns the nearest enclosing scope. A scope is roughly an item or block.
// rustc: compiler/rustc_middle/src/hir/map.rs:665 hir_get_enclosing_scope
TyCtxt.prototype.hir_get_enclosing_scope = function (this: TyCtxt, hir_id_: HirId): HirId | undefined {
  for (const [hir_id, node] of this.hir_parent_iter(hir_id_)) {
    if (
      (node.$ === "Item" &&
        (node._0.kind.$ === "Fn" ||
          node._0.kind.$ === "Const" ||
          node._0.kind.$ === "Static" ||
          node._0.kind.$ === "Mod" ||
          node._0.kind.$ === "Enum" ||
          node._0.kind.$ === "Struct" ||
          node._0.kind.$ === "Union" ||
          node._0.kind.$ === "Trait" ||
          node._0.kind.$ === "Impl")) ||
      (node.$ === "ForeignItem" && node._0.kind.$ === "Fn") ||
      (node.$ === "TraitItem" && node._0.kind.$ === "Fn") ||
      (node.$ === "ImplItem" && node._0.kind.$ === "Fn") ||
      node.$ === "Block"
    ) {
      return hir_id;
    }
  }
  return undefined;
};

/// Returns the defining scope for an opaque type definition.
// rustc: compiler/rustc_middle/src/hir/map.rs:692 hir_get_defining_scope
TyCtxt.prototype.hir_get_defining_scope = function (this: TyCtxt, id: HirId): HirId {
  let scope = id;
  for (;;) {
    scope = this.hir_get_enclosing_scope(scope) ?? CRATE_HIR_ID;
    if (HirId_eq(scope, CRATE_HIR_ID) || this.hir_node(scope).$ !== "Block") {
      return scope;
    }
  }
};

/// Get a representation of this `id` for debugging purposes.
/// NOTE: Do NOT use this in diagnostics!
// rustc: compiler/rustc_middle/src/hir/map.rs:704 hir_id_to_string
TyCtxt.prototype.hir_id_to_string = function (this: TyCtxt, id: HirId): string {
  const path_str = (def_id: LocalDefId): string => this.def_path_str(def_id);

  const span_str = (): string => {
    const r = this.sess.source_map().span_to_snippet(this.hir_span(id));
    return r.$ === "Ok" ? r._0.toString() : "";
  };
  const node_str = (prefix: string): string => `${display_HirId(id)} (${prefix} \`${span_str()}\`)`;

  const node = this.hir_node(id);
  switch (node.$) {
    case "Item": {
      const item = node._0;
      let item_str: string;
      switch (item.kind.$) {
        case "ExternCrate":
          item_str = "extern crate";
          break;
        case "Use":
          item_str = "use";
          break;
        case "Static":
          item_str = "static";
          break;
        case "Const":
          item_str = "const";
          break;
        case "Fn":
          item_str = "fn";
          break;
        case "Macro":
          item_str = "macro";
          break;
        case "Mod":
          item_str = "mod";
          break;
        case "ForeignMod":
          item_str = "foreign mod";
          break;
        case "GlobalAsm":
          item_str = "global asm";
          break;
        case "TyAlias":
          item_str = "ty";
          break;
        case "Enum":
          item_str = "enum";
          break;
        case "Struct":
          item_str = "struct";
          break;
        case "Union":
          item_str = "union";
          break;
        case "Trait":
          item_str = "trait";
          break;
        case "TraitAlias":
          item_str = "trait alias";
          break;
        case "Impl":
          item_str = "impl";
          break;
        case "TestBinderConstraints":
          item_str = "test_binder_constraints!";
          break;
      }
      return `${display_HirId(id)} (${item_str} ${path_str(item.owner_id.def_id)})`;
    }
    case "ForeignItem": {
      const item = node._0;
      return `${display_HirId(id)} (foreign item ${path_str(item.owner_id.def_id)})`;
    }
    case "ImplItem": {
      const ii = node._0;
      let kind: string;
      switch (ii.kind.$) {
        case "Const":
          kind = "associated constant";
          break;
        case "Fn": {
          const fn_sig = ii.kind._0;
          kind = fn_sig.decl.implicit_self() === "None" ? "associated function" : "method";
          break;
        }
        case "Type":
          kind = "associated type";
          break;
      }
      return `${display_HirId(id)} (${kind} \`${display_Ident(ii.ident)}\` in ${path_str(ii.owner_id.def_id)})`;
    }
    case "TraitItem": {
      const ti = node._0;
      let kind: string;
      switch (ti.kind.$) {
        case "Const":
          kind = "associated constant";
          break;
        case "Fn": {
          const fn_sig = ti.kind._0;
          kind = fn_sig.decl.implicit_self() === "None" ? "associated function" : "trait method";
          break;
        }
        case "Type":
          kind = "associated type";
          break;
      }

      return `${display_HirId(id)} (${kind} \`${display_Ident(ti.ident)}\` in ${path_str(ti.owner_id.def_id)})`;
    }
    case "Variant": {
      const variant = node._0;
      return `${display_HirId(id)} (variant \`${display_Ident(variant.ident)}\` in ${path_str(variant.def_id)})`;
    }
    case "Field": {
      const field = node._0;
      return `${display_HirId(id)} (field \`${display_Ident(field.ident)}\` in ${path_str(field.def_id)})`;
    }
    case "AnonConst":
      return node_str("const");
    case "ConstBlock":
      return node_str("const");
    case "ConstArg":
      return node_str("const");
    case "Expr":
      return node_str("expr");
    case "ExprField":
      return node_str("expr field");
    case "ConstArgExprField":
      return node_str("const arg expr field");
    case "Stmt":
      return node_str("stmt");
    case "PathSegment":
      return node_str("path segment");
    case "Ty":
      return node_str("type");
    case "AssocItemConstraint":
      return node_str("assoc item constraint");
    case "TraitRef":
      return node_str("trait ref");
    case "OpaqueTy":
      return node_str("opaque type");
    case "Pat":
      return node_str("pat");
    case "TyPat":
      return node_str("pat ty");
    case "PatField":
      return node_str("pattern field");
    case "PatExpr":
      return node_str("pattern literal");
    case "Param":
      return node_str("param");
    case "Arm":
      return node_str("arm");
    case "Block":
      return node_str("block");
    case "Infer":
      return node_str("infer");
    case "LetStmt":
      return node_str("local");
    case "Ctor": {
      const ctor = node._0;
      const def_id = VariantData.ctor_def_id(ctor);
      return `${display_HirId(id)} (ctor ${def_id === undefined ? "<missing path>" : path_str(def_id)})`;
    }
    case "Lifetime":
      return node_str("lifetime");
    case "GenericParam": {
      const param = node._0;
      return `${display_HirId(id)} (generic_param ${path_str(param.def_id)})`;
    }
    case "Crate":
      return "(root_crate)";
    case "WherePredicate":
      return node_str("where predicate");
    case "NestedUseTree":
      return node_str("use");
    case "PreciseCapturingNonLifetimeArg":
      return node_str("parameter");
    case "TestBinderForall":
      return node_str("forall");
    case "TestBinderExists":
      return node_str("exists");
    case "TestBinderBoundTypeConstraint":
      return node_str("test bound type constraint");
    case "Synthetic":
      return unreachable();
    case "Err":
      return node_str("error");
  }
};

// rustc: compiler/rustc_middle/src/hir/map.rs:807 hir_get_foreign_abi
TyCtxt.prototype.hir_get_foreign_abi = function (this: TyCtxt, hir_id: HirId): ExternAbi {
  const parent = this.hir_get_parent_item(hir_id);
  const node = this.hir_owner_node(parent);
  if (node.$ === "Item" && node._0.kind.$ === "ForeignMod") {
    return node._0.kind.abi;
  }
  return bug(`expected foreign mod or inlined parent, found ${this.hir_id_to_string(HirId_make_owner(parent.def_id))}`);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:820 hir_expect_item
TyCtxt.prototype.hir_expect_item = function (this: TyCtxt, id: LocalDefId): Item {
  const node = this.expect_hir_owner_node(id);
  if (node.$ === "Item") return node._0;
  return bug(`expected item, found ${this.hir_id_to_string(HirId_make_owner(id))}`);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:827 hir_expect_impl_item
TyCtxt.prototype.hir_expect_impl_item = function (this: TyCtxt, id: LocalDefId): ImplItem {
  const node = this.expect_hir_owner_node(id);
  if (node.$ === "ImplItem") return node._0;
  return bug(`expected impl item, found ${this.hir_id_to_string(HirId_make_owner(id))}`);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:834 hir_expect_trait_item
TyCtxt.prototype.hir_expect_trait_item = function (this: TyCtxt, id: LocalDefId): TraitItem {
  const node = this.expect_hir_owner_node(id);
  if (node.$ === "TraitItem") return node._0;
  return bug(`expected trait item, found ${this.hir_id_to_string(HirId_make_owner(id))}`);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:843 hir_get_fn_output
TyCtxt.prototype.hir_get_fn_output = function (this: TyCtxt, def_id: LocalDefId): FnRetTy | undefined {
  const node = this.opt_hir_owner_node(def_id);
  if (node === undefined) return undefined;
  const decl = OwnerNode.fn_decl(node);
  if (decl === undefined) return undefined;
  return decl.output;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:848 hir_expect_opaque_ty
TyCtxt.prototype.hir_expect_opaque_ty = function (this: TyCtxt, id: LocalDefId): OpaqueTy {
  const node = this.hir_node_by_def_id(id);
  if (node.$ === "OpaqueTy") return node._0;
  return bug(`expected opaque type definition, found ${this.hir_id_to_string(this.local_def_id_to_hir_id(id))}`);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:860 hir_expect_expr
TyCtxt.prototype.hir_expect_expr = function (this: TyCtxt, id: HirId): Expr {
  const node = this.hir_node(id);
  if (node.$ === "Expr") return node._0;
  return bug(`expected expr, found ${this.hir_id_to_string(id)}`);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:867 hir_opt_delegation_sig_id
TyCtxt.prototype.hir_opt_delegation_sig_id = function (this: TyCtxt, def_id: LocalDefId): DefId | undefined {
  const node = this.opt_hir_owner_node(def_id);
  if (node === undefined) return undefined;
  const decl = OwnerNode.fn_decl(node);
  if (decl === undefined) return undefined;
  return decl.opt_delegation_sig_id();
};

// rustc: compiler/rustc_middle/src/hir/map.rs:871 hir_opt_delegation_info
TyCtxt.prototype.hir_opt_delegation_info = function (this: TyCtxt, def_id: LocalDefId): DelegationInfo | undefined {
  const node = this.opt_hir_owner_node(def_id);
  if (node === undefined) return undefined;
  const decl = OwnerNode.fn_decl(node);
  if (decl === undefined) return undefined;
  return decl.opt_delegation_info();
};

// rustc: compiler/rustc_middle/src/hir/map.rs:875 hir_delegation_info
TyCtxt.prototype.hir_delegation_info = function (this: TyCtxt, delegation_id: LocalDefId): DelegationInfo {
  const info = this.hir_opt_delegation_info(delegation_id);
  return info !== undefined ? info : panic("processing delegation");
};

// rustc: compiler/rustc_middle/src/hir/map.rs:880 hir_opt_ident
TyCtxt.prototype.hir_opt_ident = function (this: TyCtxt, id: HirId): Ident | undefined {
  const node = this.hir_node(id);
  if (node.$ === "Pat" && node._0.kind.$ === "Binding") return node._0.kind._2;
  // A `Ctor` doesn't have an identifier itself, but its parent
  // struct/variant does. Compare with `hir::Map::span`.
  if (node.$ === "Ctor") {
    const parent = this.parent_hir_node(id);
    switch (parent.$) {
      case "Item": {
        const ident = ItemKind.ident(parent._0.kind);
        return ident !== undefined ? ident : panic("called `Option::unwrap()` on a `None` value");
      }
      case "Variant":
        return parent._0.ident;
      default:
        return unreachable();
    }
  }
  return Node.ident(node);
};

// rustc: compiler/rustc_middle/src/hir/map.rs:895 hir_opt_ident_span
TyCtxt.prototype.hir_opt_ident_span = function (this: TyCtxt, id: HirId): Span | undefined {
  return this.hir_opt_ident(id)?.span;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:900 hir_ident
TyCtxt.prototype.hir_ident = function (this: TyCtxt, id: HirId): Ident {
  const ident = this.hir_opt_ident(id);
  return ident !== undefined ? ident : panic("called `Option::unwrap()` on a `None` value");
};

// rustc: compiler/rustc_middle/src/hir/map.rs:905 hir_opt_name
TyCtxt.prototype.hir_opt_name = function (this: TyCtxt, id: HirId): Symbol | undefined {
  return this.hir_opt_ident(id)?.name;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:909 hir_name
TyCtxt.prototype.hir_name = function (this: TyCtxt, id: HirId): Symbol {
  const name = this.hir_opt_name(id);
  return name !== undefined ? name : bug(`no name for ${this.hir_id_to_string(id)}`);
};

/// Given a node ID, gets a list of attributes associated with the AST
/// corresponding to the node-ID.
// rustc: compiler/rustc_middle/src/hir/map.rs:915 hir_attrs
TyCtxt.prototype.hir_attrs = function (this: TyCtxt, id: HirId): readonly Attribute[] {
  return (this.hir_attr_map(id.owner) as AttributeMap).get(id.local_id);
};

/// Gets the span of the definition of the specified HIR node.
/// This is used by `tcx.def_span`.
// rustc: compiler/rustc_middle/src/hir/map.rs:921 hir_span
TyCtxt.prototype.hir_span = function (this: TyCtxt, hir_id: HirId): Span {
  // rustc: compiler/rustc_middle/src/hir/map.rs:922 until_within
  function until_within(outer: Span, end_: Span): Span {
    const end = Span.find_ancestor_inside(end_, outer);
    if (end !== undefined) {
      return Span.with_hi(outer, Span.hi(end));
    } else {
      return outer;
    }
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:930 named_span
  function named_span(item_span: Span, ident: Ident, generics: Generics | undefined): Span {
    let span = until_within(item_span, ident.span);
    if (generics !== undefined && !Span.is_dummy(generics.span)) {
      const g_span = Span.find_ancestor_inside(generics.span, item_span);
      if (g_span !== undefined) {
        span = Span.to(span, g_span);
      }
    }
    return span;
  }

  const node = this.hir_node(hir_id);
  let span: Span;
  // Function-like.
  const fn_like: [FnSig, Span] | undefined =
    node.$ === "Item" && node._0.kind.$ === "Fn"
      ? [node._0.kind.sig, node._0.span]
      : node.$ === "TraitItem" && node._0.kind.$ === "Fn"
        ? [node._0.kind._0, node._0.span]
        : node.$ === "ImplItem" && node._0.kind.$ === "Fn"
          ? [node._0.kind._0, node._0.span]
          : node.$ === "ForeignItem" && node._0.kind.$ === "Fn"
            ? [node._0.kind._0, node._0.span]
            : undefined;
  // Constants and Statics.
  const const_like: [Ty, Span] | undefined =
    node.$ === "Item" && (node._0.kind.$ === "Const" || node._0.kind.$ === "Static")
      ? [node._0.kind._2, node._0.span]
      : node.$ === "TraitItem" && node._0.kind.$ === "Const"
        ? [node._0.kind._0, node._0.span]
        : node.$ === "ImplItem" && node._0.kind.$ === "Const"
          ? [node._0.kind._0, node._0.span]
          : node.$ === "ForeignItem" && node._0.kind.$ === "Static"
            ? [node._0.kind._0, node._0.span]
            : undefined;
  // With generics and bounds.
  const bounded: [Generics, readonly GenericBound[], Span] | undefined =
    node.$ === "Item" && node._0.kind.$ === "Trait"
      ? [node._0.kind.generics, node._0.kind.bounds, node._0.span]
      : node.$ === "TraitItem" && node._0.kind.$ === "Type"
        ? [node._0.generics, node._0.kind._0, node._0.span]
        : undefined;
  if (fn_like !== undefined) {
    const [sig, outer_span] = fn_like;
    // Ensure that the returned span has the item's SyntaxContext, and not the
    // SyntaxContext of the visibility.
    span = Span.find_ancestor_in_same_ctxt(sig.span, outer_span) ?? outer_span;
  } else if (node.$ === "Item" && node._0.kind.$ === "Impl") {
    // Impls, including their where clauses.
    span = until_within(node._0.span, node._0.kind._0.generics.where_clause_span);
  } else if (const_like !== undefined) {
    const [ty, outer_span] = const_like;
    span = until_within(outer_span, ty.span);
  } else if (bounded !== undefined) {
    const [generics, bounds, outer_span] = bounded;
    const b = bounds.at(-1);
    const end = b !== undefined ? GenericBound.span(b) : generics.span;
    span = until_within(outer_span, end);
  } else if (node.$ === "Item") {
    // Other cases.
    const item = node._0;
    if (item.kind.$ === "Use") {
      const use_tree = item.kind._0;
      // Ensure that the returned span has the item's SyntaxContext, and not the
      // SyntaxContext of the path.
      span = Span.find_ancestor_in_same_ctxt(use_tree.prefix.span, item.span) ?? item.span;
    } else {
      const ident = ItemKind.ident(item.kind);
      if (ident !== undefined) {
        span = named_span(item.span, ident, ItemKind.generics(item.kind));
      } else {
        span = item.span;
      }
    }
  } else if (node.$ === "Variant") {
    const variant = node._0;
    span = named_span(variant.span, variant.ident, undefined);
  } else if (node.$ === "ImplItem") {
    const item = node._0;
    span = named_span(item.span, item.ident, item.generics);
  } else if (node.$ === "ForeignItem") {
    const item = node._0;
    span = named_span(item.span, item.ident, undefined);
  } else if (node.$ === "Ctor") {
    return this.hir_span(this.parent_hir_id(hir_id));
  } else if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    const { fn_decl_span } = node._0.kind._0;
    const span_ = node._0.span;
    // Ensure that the returned span has the closure expression's SyntaxContext.
    span = Span.find_ancestor_inside_same_ctxt(fn_decl_span, span_) ?? span_;
  } else {
    span = this.hir_span_with_body(hir_id);
  }
  // debug_assert_eq!(span.ctxt(), self.hir_span_with_body(hir_id).ctxt());
  return span;
};

/// Like `hir_span()`, but includes the body of items
/// (instead of just the item header)
// rustc: compiler/rustc_middle/src/hir/map.rs:1038 hir_span_with_body
TyCtxt.prototype.hir_span_with_body = function (this: TyCtxt, hir_id: HirId): Span {
  const node = this.hir_node(hir_id);
  switch (node.$) {
    case "Param":
      return node._0.span;
    case "Item":
      return node._0.span;
    case "ForeignItem":
      return node._0.span;
    case "TraitItem":
      return node._0.span;
    case "ImplItem":
      return node._0.span;
    case "Variant":
      return node._0.span;
    case "Field":
      return node._0.span;
    case "AnonConst":
      return node._0.span;
    case "ConstBlock":
      return this.hir_body(node._0.body).value.span;
    case "ConstArg":
      return node._0.span;
    case "Expr":
      return node._0.span;
    case "ExprField":
      return node._0.span;
    case "ConstArgExprField":
      return node._0.span;
    case "Stmt":
      return node._0.span;
    case "PathSegment": {
      const seg = node._0;
      const ident_span = seg.ident.span;
      return Span.with_hi(ident_span, seg.args === undefined ? Span.hi(ident_span) : Span.hi(seg.args.span_ext));
    }
    case "Ty":
      return node._0.span;
    case "AssocItemConstraint":
      return node._0.span;
    case "TraitRef":
      return node._0.path.span;
    case "OpaqueTy":
      return node._0.span;
    case "Pat":
      return node._0.span;
    case "TyPat":
      return node._0.span;
    case "PatField":
      return node._0.span;
    case "PatExpr":
      return node._0.span;
    case "Arm":
      return node._0.span;
    case "Block":
      return node._0.span;
    case "Ctor":
      return this.hir_span_with_body(this.parent_hir_id(hir_id));
    case "Lifetime":
      return node._0.ident.span;
    case "GenericParam":
      return node._0.span;
    case "Infer":
      return node._0.span;
    case "LetStmt":
      return node._0.span;
    case "Crate":
      return node._0.spans.inner_span;
    case "WherePredicate":
      return node._0.span;
    case "PreciseCapturingNonLifetimeArg":
      return node._0.ident.span;
    case "NestedUseTree":
      return node._0.prefix.span;
    case "TestBinderForall":
      return node._0.span;
    case "TestBinderExists":
      return node._0.span;
    case "TestBinderBoundTypeConstraint":
      return node._0.span;
    case "Synthetic":
      return unreachable();
    case "Err":
      return node._0;
  }
};

// rustc: compiler/rustc_middle/src/hir/map.rs:1086 hir_span_if_local
TyCtxt.prototype.hir_span_if_local = function (this: TyCtxt, id: DefId): Span | undefined {
  return id.is_local() ? this.def_span(id) : undefined;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:1090 hir_res_span
TyCtxt.prototype.hir_res_span = function (this: TyCtxt, res: Res): Span | undefined {
  switch (res.$) {
    case "Err":
      return undefined;
    case "Local":
      return this.hir_span(res._0);
    default: {
      const def_id = Res.opt_def_id(res);
      if (def_id === undefined) return undefined;
      return this.hir_span_if_local(def_id);
    }
  }
};

/// Returns the HirId of `N` in `struct Foo<const N: usize = { ... }>` when
/// called with the HirId for the `{ ... }` anon const
// rustc: compiler/rustc_middle/src/hir/map.rs:1100 hir_opt_const_param_default_param_def_id
TyCtxt.prototype.hir_opt_const_param_default_param_def_id = function (this: TyCtxt, anon_const: HirId): LocalDefId | undefined {
  const const_arg = this.parent_hir_id(anon_const);
  const node = this.parent_hir_node(const_arg);
  if (node.$ === "GenericParam" && node._0.kind.$ === "Const") {
    return node._0.def_id;
  }
  return undefined;
};

// rustc: compiler/rustc_middle/src/hir/map.rs:1112 hir_maybe_get_struct_pattern_shorthand_field
TyCtxt.prototype.hir_maybe_get_struct_pattern_shorthand_field = function (this: TyCtxt, expr: Expr): Symbol | undefined {
  let local: Ident | undefined;
  if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined) {
    const path = expr.kind._0._1;
    if (path.res.$ === "Local" && path.segments.length === 1) {
      local = path.segments[0]!.ident;
    }
  }
  if (local === undefined) return undefined;

  const node = this.parent_hir_node(expr.hir_id);
  switch (node.$) {
    case "ExprField": {
      const field = node._0;
      if (field.ident.name === local.name && field.is_shorthand) {
        return local.name;
      }
      break;
    }
    default:
      break;
  }

  return undefined;
};

// impl<'tcx> intravisit::HirTyCtxt<'tcx> for TyCtxt<'tcx>
/** `&tcx as &dyn intravisit::HirTyCtxt<'_>`: the trait impl's methods, over `tcx`. */
export function TyCtxt_as_HirTyCtxt(self: TyCtxt): HirTyCtxt {
  return {
    // rustc: compiler/rustc_middle/src/hir/map.rs:1141 hir_node
    hir_node(hir_id: HirId): Node {
      return self.hir_node(hir_id);
    },

    // rustc: compiler/rustc_middle/src/hir/map.rs:1145 hir_body
    hir_body(id: BodyId): Body {
      return self.hir_body(id);
    },

    // rustc: compiler/rustc_middle/src/hir/map.rs:1149 hir_item
    hir_item(id: ItemId): Item {
      return self.hir_item(id);
    },

    // rustc: compiler/rustc_middle/src/hir/map.rs:1153 hir_trait_item
    hir_trait_item(id: TraitItemId): TraitItem {
      return self.hir_trait_item(id);
    },

    // rustc: compiler/rustc_middle/src/hir/map.rs:1157 hir_impl_item
    hir_impl_item(id: ImplItemId): ImplItem {
      return self.hir_impl_item(id);
    },

    // rustc: compiler/rustc_middle/src/hir/map.rs:1161 hir_foreign_item
    hir_foreign_item(id: ForeignItemId): ForeignItem {
      return self.hir_foreign_item(id);
    },
  };
}

/** `rustc_data_structures::svh::Svh` (svh.rs, not ported; `Svh` is `unknown` in queries.gen.ts and cstore.ts). */
type Svh = unknown;
/** `Svh::new(hash)`. PORT: pending-lane shim (svh.rs). */
function Svh_new(_hash: Fingerprint): Svh {
  return unported("rustc_data_structures::svh::Svh::new (pending svh.rs)");
}
/** `impl StableHash for Svh` (svh.rs). PORT: pending-lane shim. */
function stable_hash_Svh(_self: Svh, _hcx: StableHashCtxt, _hasher: StableHasher): void {
  return unported("rustc_data_structures::svh::Svh::stable_hash (pending svh.rs)");
}
/** `DebuggerVisualizerFile::path_erased` (rustc_middle middle/debugger_visualizer.rs, not ported). PORT: shim. */
function DebuggerVisualizerFile_path_erased(_self: unknown): unknown {
  return unported("rustc_middle::middle::debugger_visualizer::DebuggerVisualizerFile::path_erased (pending)");
}
/** `impl StableHash for DebuggerVisualizerFile` (derived; not ported). PORT: shim. */
function stable_hash_DebuggerVisualizerFile(_self: unknown, _hcx: StableHashCtxt, _hasher: StableHasher): void {
  return unported("rustc_middle::middle::debugger_visualizer::DebuggerVisualizerFile::stable_hash (pending)");
}
/** `impl StableHash for FxHashMap<Span, Span>` (stable_hash.rs `HashMap` impl over `stable_hash_reduce`). PORT: shim. */
function stable_hash_read_metavar_spans(_self: Map<Span, Span>, _hcx: StableHashCtxt, _hasher: StableHasher): void {
  return unported("rustc_data_structures::stable_hash::StableHash for FxHashMap<Span, Span> (stable_hash_reduce, pending)");
}

/** `(StableCrateId, Svh)` tuples, sorted by `StableCrateId` (a `u64`, bigint). */
function stable_hash_upstream_crates(self: readonly [StableCrateId, Svh][], hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Vec(self, hcx, hasher, (t, hcx, hasher) => stable_hash_tuple2(t, hcx, hasher, stable_hash_StableCrateId, stable_hash_Svh));
}

// rustc: compiler/rustc_middle/src/hir/map.rs:1166 crate_hash
export function crate_hash(tcx: TyCtxt, _: "LocalCrate"): Svh {
  // `-Z metadata-crate-hash=no` opts back into computing the SVH from the HIR rather than
  // from the encoded crate metadata. This is a safety fallback for the metadata-based hashing.
  if (!tcx.sess.opts.unstable_opts.metadata_crate_hash) {
    return legacy_crate_hash(tcx);
  }

  // If metadata is being encoded, the crate hash has already been computed as part of the
  // metadata encoding.
  if (tcx.needs_metadata()) {
    // `*tcx.untracked().local_crate_hash.get().expect("crate_hash(LOCAL_CRATE) called before metadata encoding")`
    return unported("rustc_middle::hir::map::crate_hash: Untracked::local_crate_hash (metadata encoding, M5)");
  } else {
    // When metadata isn't encoded, use an HIR based approximation. Encoding metadata for a
    // dylib/binary is expensive and fragile. These fields are enough to identify the session.
    const hir_body_hash = compute_hir_hash(tcx);

    const upstream_crates_ = upstream_crates(tcx);

    const crate_hash: Fingerprint = tcx.with_stable_hashing_context((hcx) => {
      const stable_hasher = StableHasher.new();
      stable_hash_Fingerprint(hir_body_hash, hcx, stable_hasher);
      stable_hash_upstream_crates(upstream_crates_, hcx, stable_hasher);
      stable_hash_Hash64(tcx.sess.opts.dep_tracking_hash(true), hcx, stable_hasher);
      stable_hash_StableCrateId(tcx.stable_crate_id(LOCAL_CRATE), hcx, stable_hasher);

      return stable_hasher.finish(Fingerprint);
    });

    return Svh_new(crate_hash);
  }
}

/// Only reached when `-Z metadata-crate-hash=no` reverts to the pre-metadata-hashing behavior.
/// The HIR-based hashing scheme here matches the `crate_hash` query as it existed before this PR.
/// (The resulting SVH still differs from a pre-PR compiler, because `metadata_crate_hash` is a
/// `[TRACKED]` option and therefore contributes to the dep-tracking hash hashed in below.)
// rustc: compiler/rustc_middle/src/hir/map.rs:1205 legacy_crate_hash
function legacy_crate_hash(tcx: TyCtxt): Svh {
  const krate = crate_items(tcx);

  const upstream_crates_ = upstream_crates(tcx);
  const resolutions = tcx.resolutions(null);

  // We hash the final, remapped names of all local source files so we
  // don't have to include the path prefix remapping commandline args.
  // If we included the full mapping in the SVH, we could only have
  // reproducible builds by compiling from the same directory. So we just
  // hash the result of the mapping instead of the mapping itself.
  const source_file_names: StableSourceFileId[] = tcx
    .sess.source_map()
    .files()
    .deref()
    .filter((source_file) => source_file.cnum === LOCAL_CRATE)
    .map((source_file) => source_file.stable_id);

  // `sort_unstable()`: `StableSourceFileId(Hash128)` orders by its `u128` (bigint); ids are unique.
  source_file_names.sort((a, b) => (a.hash() < b.hash() ? -1 : a.hash() > b.hash() ? 1 : 0));

  // We have to take care of debugger visualizers explicitly. The HIR (and
  // thus `hir_body_hash`) contains the #[debugger_visualizer] attributes but
  // these attributes only store the file path to the visualizer file, not
  // their content. Yet that content is exported into crate metadata, so any
  // changes to it need to be reflected in the crate hash.
  const debugger_visualizers: unknown[] = tcx
    .debugger_visualizers(LOCAL_CRATE)
    // We ignore the path to the visualizer file since it's not going to be
    // encoded in crate metadata and we already hash the full contents of
    // the file.
    .map(DebuggerVisualizerFile_path_erased);

  const crate_hash: Fingerprint = tcx.with_stable_hashing_context((hcx) => {
    const stable_hasher = StableHasher.new();
    // hir_body_hash
    for (const owner of krate.owners()) {
      const info = MaybeOwner.as_owner(tcx.lower_to_hir(owner.def_id) as MaybeOwner);
      if (info !== undefined) {
        stable_hash_OwnerInfo(info, hcx, stable_hasher);
      }
    }
    stable_hash_upstream_crates(upstream_crates_, hcx, stable_hasher);
    stable_hash_Vec(source_file_names, hcx, stable_hasher, stable_hash_StableSourceFileId);
    stable_hash_Vec(debugger_visualizers, hcx, stable_hasher, stable_hash_DebuggerVisualizerFile);
    if (tcx.sess.opts.incremental !== undefined) {
      const definitions = tcx.untracked().definitions;
      const owner_spans: [DefPathHash, Span][] = crate_items(tcx)
        .definitions()
        .map((def_id) => {
          const def_path_hash = definitions.def_path_hash(def_id);
          const span = tcx.source_span(def_id);
          // debug_assert_eq!(span.parent(), None);
          return [def_path_hash, span];
        });
      // `sort_unstable_by_key(|bn| bn.0)`: `DefPathHash(Fingerprint)` orders as its packed bigint.
      owner_spans.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      stable_hash_Vec(owner_spans, hcx, stable_hasher, (t, hcx, hasher) => stable_hash_tuple2(t, hcx, hasher, stable_hash_DefPathHash, stable_hash_Span));
    }
    stable_hash_Hash64(tcx.sess.opts.dep_tracking_hash(true), hcx, stable_hasher);
    stable_hash_StableCrateId(tcx.stable_crate_id(LOCAL_CRATE), hcx, stable_hasher);
    // Hash visibility information since it does not appear in HIR.
    // FIXME: Figure out how to remove `visibilities_for_hashing` by hashing visibilities on
    // the fly in the resolver, storing only their accumulated hash in `ResolverGlobalCtxt`,
    // and combining it with other hashes here.
    stable_hash_Vec(resolutions.visibilities_for_hashing, hcx, stable_hasher, (t, hcx, hasher) =>
      stable_hash_tuple2(t, hcx, hasher, stable_hash_LocalDefId, (v, hcx, hasher) => stable_hash_Visibility(v, hcx, hasher, stable_hash_LocalModId)),
    );
    with_metavar_spans((mspans) => {
      stable_hash_read_metavar_spans(mspans.freeze_and_get_read_spans(), hcx, stable_hasher);
    });
    return stable_hasher.finish(Fingerprint);
  });

  return Svh_new(crate_hash);
}

/// Compute the new, metadata-oriented HIR hash for the full crate.
///
/// Unlike the legacy hash (see [`legacy_crate_hash`]), this is an order-independent combine of each
/// owner's fingerprint, so it does not depend on the iteration order of the owners. It becomes part
/// of the `crate_hash` which is stored in the crate metadata.
// rustc: compiler/rustc_middle/src/hir/map.rs:1288 compute_hir_hash
export function compute_hir_hash(tcx: TyCtxt): Fingerprint {
  let acc: Fingerprint | undefined;
  for (const owner of crate_items(tcx).owners()) {
    const info = MaybeOwner.as_owner(tcx.lower_to_hir(owner.def_id) as MaybeOwner);
    if (info === undefined) continue;
    const fp = info.fingerprint();
    acc = acc === undefined ? fp : Fingerprint.combine_commutative(acc, fp);
  }
  return acc !== undefined ? acc : panic("HIR hash requested without any content");
}

// rustc: compiler/rustc_middle/src/hir/map.rs:1296 upstream_crates
function upstream_crates(tcx: TyCtxt): [StableCrateId, Svh][] {
  const upstream_crates: [StableCrateId, Svh][] = tcx.crates(null).map((cnum) => {
    const stable_crate_id = tcx.stable_crate_id(cnum);
    const hash = tcx.crate_hash(cnum);
    return [stable_crate_id, hash];
  });
  // `sort_unstable_by_key(|&(stable_crate_id, _)| stable_crate_id)`: `StableCrateId` is a `u64` (bigint); keys are unique.
  upstream_crates.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return upstream_crates;
}

// rustc: compiler/rustc_middle/src/hir/map.rs:1310 hir_module_items
export function hir_module_items(tcx: TyCtxt, module_id: LocalModId): ModuleItems {
  const collector = ItemCollector.new(tcx, false);

  const [hir_mod, span] = tcx.hir_get_module(module_id);
  collector.visit_mod(hir_mod, span, module_id);

  const { submodules, items, trait_items, impl_items, foreign_items, body_owners, opaques, nested_bodies, eiis, proc_macro_decls } = collector;

  return new ModuleItems(
    /* add_root */ false,
    submodules,
    items,
    trait_items,
    impl_items,
    foreign_items,
    opaques,
    body_owners,
    nested_bodies,
    eiis,
    proc_macro_decls,
  );
}

// rustc: compiler/rustc_middle/src/hir/map.rs:1345 hir_crate_items
export function hir_crate_items(tcx: TyCtxt, _: null): ModuleItems {
  const collector = ItemCollector.new(tcx, true);

  // A "crate collector" and "module collector" start at a
  // module item (the former starts at the crate root) but only
  // the former needs to collect it. ItemCollector does not do this for us.
  collector.submodules.push(CRATE_MOD_ID);
  tcx.hir_walk_toplevel_module(collector);

  const { submodules, items, trait_items, impl_items, foreign_items, body_owners, opaques, nested_bodies, eiis, proc_macro_decls } = collector;

  return new ModuleItems(
    /* add_root */ true,
    submodules,
    items,
    trait_items,
    impl_items,
    foreign_items,
    opaques,
    body_owners,
    nested_bodies,
    eiis,
    proc_macro_decls,
  );
}

// rustc-type: compiler/rustc_middle/src/hir/map.rs:1380 ItemCollector
class ItemCollector extends Visitor {
  // `type NestedFilter = nested_filter::All;`
  override NestedFilter = All;

  submodules: LocalModId[] = [];
  items: ItemId[] = [];
  trait_items: TraitItemId[] = [];
  impl_items: ImplItemId[] = [];
  foreign_items: ForeignItemId[] = [];
  body_owners: LocalDefId[] = [];
  opaques: LocalDefId[] = [];
  nested_bodies: LocalDefId[] = [];
  eiis: LocalDefId[] = [];
  proc_macro_decls: LocalDefId | undefined = undefined;

  constructor(
    // When true, it collects all items in the create,
    // otherwise it collects items in some module.
    // Converting this to generic const didn't lead to significant perf improvements
    // (see <https://github.com/rust-lang/rust/pull/158119#issuecomment-4751513679>).
    public crate_collector: boolean,
    public tcx: TyCtxt,
  ) {
    super();
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1403 new
  static new(tcx: TyCtxt, crate_collector: boolean): ItemCollector {
    return new ItemCollector(crate_collector, tcx);
  }

  // impl<'hir> Visitor<'hir> for ItemCollector<'hir>

  // rustc: compiler/rustc_middle/src/hir/map.rs:1411 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1415 visit_item
  override visit_item(item: Item): undefined {
    if (Node.associated_body({ $: "Item", _0: item }) !== undefined) {
      this.body_owners.push(item.owner_id.def_id);
    }

    const item_id = item.item_id();

    if (
      this.crate_collector &&
      this.proc_macro_decls === undefined &&
      // `find_attr!(self.tcx, item_id.hir_id(), RustcProcMacroDecls)`: `HasAttrs for HirId` (ty/mod.rs:2371) is
      // `tcx.hir_attrs(self)`.
      find_attr(this.tcx.hir_attrs(item_id.hir_id()), (k) => (k.$ === "RustcProcMacroDecls" ? null : undefined)) !== undefined
    ) {
      this.proc_macro_decls = item_id.owner_id.def_id;
    }

    this.items.push(item_id);

    if ((item.kind.$ === "Static" || item.kind.$ === "Fn" || item.kind.$ === "Macro") && item.eii) {
      this.eiis.push(item.owner_id.def_id);
    }

    // Items that are modules are handled here instead of in visit_mod.
    if (item.kind.$ === "Mod") {
      const module = item.kind._1;
      this.submodules.push(LocalModId.new_unchecked(item.owner_id.def_id));
      // A module collector does not recurse inside nested modules.
      if (this.crate_collector) {
        walk_mod(this, module);
      }
    } else {
      walk_item(this, item);
    }
    return undefined;
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1449 visit_foreign_item
  override visit_foreign_item(item: ForeignItem): undefined {
    this.foreign_items.push(item.foreign_item_id());
    return walk_foreign_item(this, item);
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1454 visit_anon_const
  override visit_anon_const(c: AnonConst): undefined {
    this.body_owners.push(c.def_id);
    return walk_anon_const(this, c);
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1459 visit_inline_const
  override visit_inline_const(c: ConstBlock): undefined {
    this.body_owners.push(c.def_id);
    this.nested_bodies.push(c.def_id);
    return walk_inline_const(this, c);
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1465 visit_opaque_ty
  override visit_opaque_ty(o: OpaqueTy): undefined {
    this.opaques.push(o.def_id);
    return walk_opaque_ty(this, o);
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1470 visit_expr
  override visit_expr(ex: Expr): undefined {
    if (ex.kind.$ === "Closure") {
      const closure = ex.kind._0;
      this.body_owners.push(closure.def_id);
      this.nested_bodies.push(closure.def_id);
    }
    return walk_expr(this, ex);
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1478 visit_trait_item
  override visit_trait_item(item: TraitItem): undefined {
    if (Node.associated_body({ $: "TraitItem", _0: item }) !== undefined) {
      this.body_owners.push(item.owner_id.def_id);
    }

    this.trait_items.push(item.trait_item_id());

    return walk_trait_item(this, item);
  }

  // rustc: compiler/rustc_middle/src/hir/map.rs:1488 visit_impl_item
  override visit_impl_item(item: ImplItem): undefined {
    if (Node.associated_body({ $: "ImplItem", _0: item }) !== undefined) {
      this.body_owners.push(item.owner_id.def_id);
    }

    this.impl_items.push(item.impl_item_id());

    return walk_impl_item(this, item);
  }
}
