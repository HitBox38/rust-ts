//! HIR datatypes. See the [rustc dev guide] for more info.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/hir.html
// Port of compiler/rustc_middle/src/hir/mod.rs (lane middle-hir).
//
// PORT decisions:
// - The `impl TyCtxt` blocks of this file and of map.rs are attached to `TyCtxt.prototype` (PORTING §5 "Methods
//   defined in another file"); rustc_middle/lib.ts imports this module after ty/context.ts. ty/context.ts must not
//   import this module (it would run before `TyCtxt` exists).
// - rustc_middle's types are hand-written (tools/codegen/types.sets.json, set rustc_middle): `ModuleItems`, `Hashes`,
//   `ProjectedOwnerInfo`, `ProjectedMaybeOwner` and their derived Debug are below. Their derive(StableHash /
//   Encodable / Decodable) is not ported: query results are not hashed without a dep graph (D3) and metadata
//   encoding is M5.
// - `impl Iterator` results are arrays (as in rustc_hir/hir.ts).
// - The query values `hir_crate_items`, `hir_module_items`, `hir_owner`, `hir_attr_map` and `lower_to_hir` are
//   `unknown` in queries.gen.ts (typemap.middle.json has no entry for these types yet); the accessors cast them.
import type { Attribute } from "../../rustc_attr_ir/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { debug_Fingerprint, Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { type SortedMap, stable_hash_SortedMap } from "../../rustc_data_structures/sorted_map.ts";
import { type StableHashCtxt, StableHasher, stable_hash_Option, stable_hash_slice, stable_hash_tuple2 } from "../../rustc_data_structures/stable_hash.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
import { try_par_for_each_in } from "../../rustc_data_structures/sync/parallel.ts";
import {
  AttributeMap,
  type Body,
  debug_Node,
  type Expr,
  type ForeignItemId,
  type ImplItemId,
  type ItemId,
  MaybeOwner,
  Node,
  type OwnerNode,
  type OwnerNodes,
  type QPath,
  type TraitCandidate,
  type TraitItemId,
} from "../../rustc_hir/hir.ts";
import { debug_ExprKind, debug_ForeignItemId, debug_ImplItemId, debug_ItemId, debug_TraitItemId } from "../../rustc_hir/hir.ts";
import { stable_hash_Body, stable_hash_OwnerNode } from "../../rustc_hir/stable_hash.gen.ts";
import { stable_hash_Attribute } from "../../rustc_attr_ir/stable_hash.gen.ts";
import { CRATE_HIR_ID, CRATE_OWNER_ID, debug_HirId, HirId, HirId_eq, ItemLocalId, OwnerId } from "../../rustc_hir_id/lib.ts";
import { stable_hash_ItemLocalId } from "../../rustc_hir_id/stable_hash.gen.ts";
import { type DefId, type LocalDefId, LocalModId, debug_LocalDefId, debug_LocalModId, stable_hash_LocalDefId } from "../../rustc_span/def_id.ts";
import { ExpnId } from "../../rustc_span/hygiene.ts";
import { type Span, stable_hash_Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { type Debug, debug_list, debug_option, debug_struct, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert_eq, panic, unported, unreachable } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { Providers } from "../queries.gen.ts";
import { type IntoQueryKey, into_query_key_DefId } from "../query/into_query_key.ts";
import { TyCtxt } from "../ty/context.ts";
import * as map from "./map.ts";

// pub mod map;
export * as map from "./map.ts";
// pub mod nested_filter;
export * as nested_filter from "./nested_filter.ts";
// pub mod place;  (not ported: lane of the typeck/THIR places)


// rustc-type: compiler/rustc_middle/src/hir/mod.rs:29 ModuleItems
/// Gather the LocalDefId for each item-like within a module, including items contained within
/// bodies. The Ids are in visitor order. This is used to partition a pass between modules.
// #[derive(Debug, StableHash, Encodable, Decodable)]
export class ModuleItems {
  constructor(
    /// Whether this represents the whole crate, in which case we need to add `CRATE_OWNER_ID` to
    /// the iterators if we want to account for the crate root.
    public add_root: boolean,
    public submodules: readonly LocalModId[],
    public free_items_: readonly ItemId[],
    public trait_items_: readonly TraitItemId[],
    public impl_items_: readonly ImplItemId[],
    public foreign_items_: readonly ForeignItemId[],
    public opaques_: readonly LocalDefId[],
    public body_owners: readonly LocalDefId[],
    public nested_bodies_: readonly LocalDefId[],

    /// Statics and functions with an `EiiImpls` or `EiiExternTarget` attribute
    public eiis_: readonly LocalDefId[],

    // only filled with hir_crate_items, not with hir_module_items
    public proc_macro_decls_: LocalDefId | undefined,
  ) {}

  /// Returns all non-associated locally defined items in all modules.
  ///
  /// Note that this does *not* include associated items of `impl` blocks! It also does not
  /// include foreign items. If you want to e.g. get all functions, use `definitions()` below.
  ///
  /// However, this does include the `impl` blocks themselves.
  // rustc: compiler/rustc_middle/src/hir/mod.rs:56 free_items
  free_items(): readonly ItemId[] {
    return this.free_items_;
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:60 trait_items
  trait_items(): readonly TraitItemId[] {
    return this.trait_items_;
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:65 proc_macro_decls
  proc_macro_decls(): LocalDefId | undefined {
    return this.proc_macro_decls_;
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:69 eiis
  eiis(): readonly LocalDefId[] {
    return this.eiis_;
  }

  /// Returns all items that are associated with some `impl` block (both inherent and trait impl
  /// blocks).
  // rustc: compiler/rustc_middle/src/hir/mod.rs:75 impl_items
  impl_items(): readonly ImplItemId[] {
    return this.impl_items_;
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:79 foreign_items
  foreign_items(): readonly ForeignItemId[] {
    return this.foreign_items_;
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:83 owners
  owners(): OwnerId[] {
    const out: OwnerId[] = [];
    if (this.add_root) out.push(CRATE_OWNER_ID);
    for (const id of this.free_items_) out.push(id.owner_id);
    for (const id of this.trait_items_) out.push(id.owner_id);
    for (const id of this.impl_items_) out.push(id.owner_id);
    for (const id of this.foreign_items_) out.push(id.owner_id);
    return out;
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:93 opaques
  opaques(): readonly LocalDefId[] {
    return this.opaques_;
  }

  /// Closures and inline consts
  // rustc: compiler/rustc_middle/src/hir/mod.rs:98 nested_bodies
  nested_bodies(): readonly LocalDefId[] {
    return this.nested_bodies_;
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:102 definitions
  definitions(): LocalDefId[] {
    return this.owners().map((id) => id.def_id);
  }

  /// Closures and inline consts
  // rustc: compiler/rustc_middle/src/hir/mod.rs:107 par_nested_bodies
  par_nested_bodies(f: (id: LocalDefId) => Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
    return try_par_for_each_in(this.nested_bodies_, (id) => f(id));
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:114 par_items
  par_items(f: (id: ItemId) => Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
    return try_par_for_each_in(this.free_items_, (id) => f(id));
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:121 par_trait_items
  par_trait_items(f: (id: TraitItemId) => Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
    return try_par_for_each_in(this.trait_items_, (id) => f(id));
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:128 par_impl_items
  par_impl_items(f: (id: ImplItemId) => Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
    return try_par_for_each_in(this.impl_items_, (id) => f(id));
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:135 par_foreign_items
  par_foreign_items(f: (id: ForeignItemId) => Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
    return try_par_for_each_in(this.foreign_items_, (id) => f(id));
  }

  // rustc: compiler/rustc_middle/src/hir/mod.rs:142 par_opaques
  par_opaques(f: (id: LocalDefId) => Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
    return try_par_for_each_in(this.opaques_, (id) => f(id));
  }
}

/** `#[derive(Debug)]` of `ModuleItems` (field names without the PORT `_` suffix). */
export const debug_ModuleItems: Debug<ModuleItems> = (v, f) =>
  debug_struct(f, "ModuleItems", [
    ["add_root", String(v.add_root)],
    ["submodules", debug_list(f, v.submodules.map((x) => debug_LocalModId(x, f)))],
    ["free_items", debug_list(f, v.free_items_.map((x) => debug_ItemId(x, f)))],
    ["trait_items", debug_list(f, v.trait_items_.map((x) => debug_TraitItemId(x, f)))],
    ["impl_items", debug_list(f, v.impl_items_.map((x) => debug_ImplItemId(x, f)))],
    ["foreign_items", debug_list(f, v.foreign_items_.map((x) => debug_ForeignItemId(x, f)))],
    ["opaques", debug_list(f, v.opaques_.map((x) => debug_LocalDefId(x, f)))],
    ["body_owners", debug_list(f, v.body_owners.map((x) => debug_LocalDefId(x, f)))],
    ["nested_bodies", debug_list(f, v.nested_bodies_.map((x) => debug_LocalDefId(x, f)))],
    ["eiis", debug_list(f, v.eiis_.map((x) => debug_LocalDefId(x, f)))],
    ["proc_macro_decls", debug_option(v.proc_macro_decls_, f, debug_LocalDefId)],
  ]);

declare module "../ty/context.ts" {
  interface TyCtxt {
    parent_module(id: HirId): LocalModId;
    parent_module_from_def_id(id: LocalDefId): LocalModId;
    is_foreign_item(def_id: IntoQueryKey<DefId>): boolean;
    hash_owner_nodes(
      node: OwnerNode,
      bodies: SortedMap<ItemLocalId, Body>,
      attrs: SortedMap<ItemLocalId, readonly Attribute[]>,
      define_opaque: readonly (readonly [Span, LocalDefId])[] | undefined,
    ): Hashes;
    qpath_is_lang_item(qpath: QPath, lang_item: LangItem): boolean;
    qpath_lang_item(qpath: QPath): LangItem | undefined;
    expr_guaranteed_to_constitute_read_for_never(expr: Expr): boolean;
    /** private (`fn`) upstream */
    hir_owner_parent_impl(owner_id: OwnerId): HirId;
    hir_owner_parent(owner_id: OwnerId): HirId;
  }
}

// rustc: compiler/rustc_middle/src/hir/mod.rs:151 parent_module
TyCtxt.prototype.parent_module = function (this: TyCtxt, id: HirId): LocalModId {
  if (!id.is_owner() && this.def_kind(id.owner).$ === "Mod") {
    return LocalModId.new_unchecked(id.owner.def_id);
  } else {
    return this.parent_module_from_def_id(id.owner.def_id);
  }
};

// rustc: compiler/rustc_middle/src/hir/mod.rs:159 parent_module_from_def_id
TyCtxt.prototype.parent_module_from_def_id = function (this: TyCtxt, id: LocalDefId): LocalModId {
  for (let parent = this.opt_local_parent(id); parent !== undefined; parent = this.opt_local_parent(id)) {
    id = parent;
    if (this.def_kind(id).$ === "Mod") {
      break;
    }
  }
  return LocalModId.new_unchecked(id);
};

/// Returns `true` if this is a foreign item (i.e., linked via `extern { ... }`).
// rustc: compiler/rustc_middle/src/hir/mod.rs:170 is_foreign_item
TyCtxt.prototype.is_foreign_item = function (this: TyCtxt, def_id: IntoQueryKey<DefId>): boolean {
  const parent = this.opt_parent(into_query_key_DefId(def_id));
  return parent !== undefined && this.def_kind(parent).$ === "ForeignMod";
};

/** `impl StableHash for &[Attribute]` (the values of `AttributeMap::map`); `Attribute`'s derive(StableHash) is generated
 *  (rustc_attr_ir/stable_hash.gen.ts). */
function stable_hash_attr_slice(self: readonly Attribute[], hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_slice(self, hcx, hasher, stable_hash_Attribute);
}

// rustc: compiler/rustc_middle/src/hir/mod.rs:175 hash_owner_nodes
TyCtxt.prototype.hash_owner_nodes = function (
  this: TyCtxt,
  node: OwnerNode,
  bodies: SortedMap<ItemLocalId, Body>,
  attrs: SortedMap<ItemLocalId, readonly Attribute[]>,
  define_opaque: readonly (readonly [Span, LocalDefId])[] | undefined,
): Hashes {
  if (!this.needs_hir_hash()) {
    return { bodies_hash: undefined, attrs_hash: undefined };
  }

  return this.with_stable_hashing_context((hcx) => {
    let stable_hasher = StableHasher.new();
    stable_hash_OwnerNode(node, hcx, stable_hasher);
    // Bodies are stored out of line, so we need to pull them explicitly in the hash.
    stable_hash_SortedMap(bodies, hcx, stable_hasher, stable_hash_ItemLocalId, stable_hash_Body);
    const h1 = stable_hasher.finish(Fingerprint);

    stable_hasher = StableHasher.new();
    stable_hash_SortedMap(attrs, hcx, stable_hasher, stable_hash_ItemLocalId, stable_hash_attr_slice);

    // Hash the defined opaque types, which are not present in the attrs.
    stable_hash_Option(define_opaque, hcx, stable_hasher, (v, hcx, hasher) =>
      stable_hash_slice(v, hcx, hasher, (t, hcx, hasher) => stable_hash_tuple2(t, hcx, hasher, stable_hash_Span, stable_hash_LocalDefId)),
    );

    const h2 = stable_hasher.finish(Fingerprint);

    return { bodies_hash: h1, attrs_hash: h2 };
  });
};

// rustc: compiler/rustc_middle/src/hir/mod.rs:205 qpath_is_lang_item
TyCtxt.prototype.qpath_is_lang_item = function (this: TyCtxt, qpath: QPath, lang_item: LangItem): boolean {
  return this.qpath_lang_item(qpath) === lang_item;
};

/// This does not use typeck results since this is intended to be used with generated code.
// rustc: compiler/rustc_middle/src/hir/mod.rs:210 qpath_lang_item
TyCtxt.prototype.qpath_lang_item = function (this: TyCtxt, qpath: QPath): LangItem | undefined {
  if (qpath.$ === "Resolved") {
    const path = qpath._1;
    if (path.res.$ === "Def") {
      const def_id = path.res._1;
      // PORT: `tcx.lang_items()` (rustc_middle middle/lang_items.rs, not ported) is `self.get_lang_items(())`.
      return this.get_lang_items(null).from_def_id(def_id);
    }
  }
  return undefined;
};

/// Whether this expression constitutes a read of value of the type that
/// it evaluates to.
///
/// This is used to determine if we should consider the block to diverge
/// if the expression evaluates to `!`, and if we should insert a `NeverToAny`
/// coercion for values of type `!`.
///
/// This function generally returns `false` if the expression is a place
/// expression and the *parent* expression is the scrutinee of a match or
/// the pointee of an `&` addr-of expression, since both of those parent
/// expressions take a *place* and not a value.
// rustc: compiler/rustc_middle/src/hir/mod.rs:230 expr_guaranteed_to_constitute_read_for_never
TyCtxt.prototype.expr_guaranteed_to_constitute_read_for_never = function (this: TyCtxt, expr: Expr): boolean {
  // We only care about place exprs. Anything else returns an immediate
  // which would constitute a read. We don't care about distinguishing
  // "syntactic" place exprs since if the base of a field projection is
  // not a place then it would've been UB to read from it anyways since
  // that constitutes a read.
  if (!expr.is_syntactic_place_expr()) {
    return true;
  }

  const parent_node = this.parent_hir_node(expr.hir_id);
  switch (parent_node.$) {
    case "Expr": {
      const parent_expr = parent_node._0;
      const kind = parent_expr.kind;
      switch (kind.$) {
        // Addr-of, field projections, and LHS of assignment don't constitute reads.
        // Assignment does call `drop_glue`, though, but its safety requirements are
        // not the same.
        case "AddrOf":
        case "Field":
          return false;

        // Place-preserving expressions only constitute reads if their
        // parent expression constitutes a read.
        case "Type":
        case "UnsafeBinderCast":
          return this.expr_guaranteed_to_constitute_read_for_never(parent_expr);

        case "Assign": {
          const lhs = kind._0;
          // Only the LHS does not constitute a read
          return !HirId_eq(expr.hir_id, lhs.hir_id);
        }

        // See note on `PatKind::Or` in `Pat::is_guaranteed_to_constitute_read_for_never`
        // for why this is `all`.
        case "Match": {
          const scrutinee = kind._0;
          const arms = kind._1;
          assert_eq(scrutinee.hir_id, expr.hir_id, (v) => debug_HirId(v, PLAIN), HirId_eq);
          return arms.every((arm) => arm.pat.is_guaranteed_to_constitute_read_for_never());
        }
        case "Let": {
          const { init, pat } = kind._0;
          assert_eq(init.hir_id, expr.hir_id, (v) => debug_HirId(v, PLAIN), HirId_eq);
          return pat.is_guaranteed_to_constitute_read_for_never();
        }

        // Any expression child of these expressions constitute reads.
        case "Array":
        case "Call":
        case "Use":
        case "MethodCall":
        case "Tup":
        case "Binary":
        case "Unary":
        case "Cast":
        case "DropTemps":
        case "If":
        case "Closure":
        case "Block":
        case "AssignOp":
        case "Index":
        case "Break":
        case "Ret":
        case "Become":
        case "InlineAsm":
        case "Struct":
        case "Repeat":
        case "Yield":
          return true;

        // These expressions have no (direct) sub-exprs.
        case "ConstBlock":
        case "Loop":
        case "Lit":
        case "Path":
        case "Continue":
        case "OffsetOf":
        case "Err":
          return unreachable(
            `internal error: entered unreachable code: no sub-expr expected for ${format_debug(expr.kind, debug_ExprKind, PLAIN)}`,
          );
      }
    }

    // If we have a subpattern that performs a read, we want to consider this
    // to diverge for compatibility to support something like `let x: () = *never_ptr;`.
    case "LetStmt": {
      const { init, pat } = parent_node._0;
      if (init !== undefined) {
        const target = init;
        assert_eq(target.hir_id, expr.hir_id, (v) => debug_HirId(v, PLAIN), HirId_eq);
        return pat.is_guaranteed_to_constitute_read_for_never();
      }
      // `Node::LetStmt(_)` (no `init`): no direct sub-exprs (the last arm group).
      return unreachable(`internal error: entered unreachable code: no sub-expr expected for ${format_debug(parent_node, debug_Node, PLAIN)}`);
    }

    // These nodes (if they have a sub-expr) do constitute a read.
    case "Block":
    case "Arm":
    case "ExprField":
    case "AnonConst":
    case "ConstBlock":
    case "ConstArg":
    case "Stmt":
      return true;
    case "Item":
      if (parent_node._0.kind.$ === "Const" || parent_node._0.kind.$ === "Static") return true;
      // `Node::Item(_)`: no direct sub-exprs (the last arm group).
      return unreachable(`internal error: entered unreachable code: no sub-expr expected for ${format_debug(parent_node, debug_Node, PLAIN)}`);
    case "TraitItem":
      if (parent_node._0.kind.$ === "Const") return true;
      return unreachable(`internal error: entered unreachable code: no sub-expr expected for ${format_debug(parent_node, debug_Node, PLAIN)}`);
    case "ImplItem":
      if (parent_node._0.kind.$ === "Const") return true;
      return unreachable(`internal error: entered unreachable code: no sub-expr expected for ${format_debug(parent_node, debug_Node, PLAIN)}`);

    case "TyPat":
    case "Pat":
      this.dcx().span_delayed_bug(expr.span, "place expr not allowed in pattern");
      return true;

    // These nodes do not have direct sub-exprs.
    case "Param":
    case "ForeignItem":
    case "Variant":
    case "Field":
    case "PathSegment":
    case "Ty":
    case "AssocItemConstraint":
    case "TraitRef":
    case "PatField":
    case "PatExpr":
    case "Synthetic":
    case "Err":
    case "Ctor":
    case "NestedUseTree":
    case "Lifetime":
    case "GenericParam":
    case "Crate":
    case "Infer":
    case "WherePredicate":
    case "PreciseCapturingNonLifetimeArg":
    case "ConstArgExprField":
    case "OpaqueTy":
    case "TestBinderForall":
    case "TestBinderExists":
    case "TestBinderBoundTypeConstraint":
      return unreachable(`internal error: entered unreachable code: no sub-expr expected for ${format_debug(parent_node, debug_Node, PLAIN)}`);
  }
};

// rustc: compiler/rustc_middle/src/hir/mod.rs:365 hir_owner_parent_impl
TyCtxt.prototype.hir_owner_parent_impl = function (this: TyCtxt, owner_id: OwnerId): HirId {
  const parent_def_id = this.opt_local_parent(owner_id.def_id);
  if (parent_def_id === undefined) return CRATE_HIR_ID;
  const parent_owner_id = this.local_def_id_to_hir_id(parent_def_id).owner;
  return new HirId(
    parent_owner_id,
    ProjectedMaybeOwner.unwrap(this.hir_owner(parent_owner_id.def_id) as ProjectedMaybeOwner).parenting.get(owner_id.def_id) ??
      ItemLocalId.ZERO,
  );
};

/// Optimization of `hir_owner_parent` query as an inlined function
/// in case of non-incremental build. The query itself renamed to `hir_owner_parent_q`.
// rustc: compiler/rustc_middle/src/hir/mod.rs:384 hir_owner_parent
TyCtxt.prototype.hir_owner_parent = function (this: TyCtxt, owner_id: OwnerId): HirId {
  if (this.dep_graph.is_fully_enabled()) {
    // PORT: queries.gen.ts types the value with rustc_lint_defs' `HirId` stand-in (typemap.lint_defs.json); the
    // provider returns rustc_hir_id's `HirId`.
    return this.hir_owner_parent_q(owner_id) as HirId;
  } else {
    return this.hir_owner_parent_impl(owner_id);
  }
};

// rustc-type: compiler/rustc_middle/src/hir/mod.rs:395 Hashes
/// Hashes computed by [`TyCtxt::hash_owner_nodes`] if necessary.
// #[derive(Clone, Copy, Debug)]
export interface Hashes {
  bodies_hash: Fingerprint | undefined;
  attrs_hash: Fingerprint | undefined;
}

/** `#[derive(Debug)]` of `Hashes` */
export const debug_Hashes: Debug<Hashes> = (v, f) =>
  debug_struct(f, "Hashes", [
    ["bodies_hash", debug_option(v.bodies_hash, f, debug_Fingerprint)],
    ["attrs_hash", debug_option(v.attrs_hash, f, debug_Fingerprint)],
  ]);

// rustc-type: compiler/rustc_middle/src/hir/mod.rs:407 ProjectedOwnerInfo
/// Unites some of `OwnerInfo`'s fields into same struct that is used by `hir_owner` query.
/// `AttributeMap` is handled separately as placing it in this struct led to perf regressions:
/// <https://github.com/rust-lang/rust/pull/155678#issuecomment-4304597871>.
/// This struct is created mainly for uniting/splitting fields of `OwnerInfo` so they are
/// stored/invalidated together in incremental compilation.
/// For comments about each field see `OwnerInfo` struct.
// #[derive(Clone, Copy, Debug, StableHash)]
// PORT: the derived Debug is not ported: `parenting` (`LocalDefIdMap`) and `trait_map` (`ItemLocalMap`) print in
// FxHash order (as `OwnerInfo`'s generated Debug, rustc_hir).
export class ProjectedOwnerInfo {
  constructor(
    public nodes: OwnerNodes,
    public parenting: Map<LocalDefId, ItemLocalId>,
    public trait_map: Map<ItemLocalId, readonly TraitCandidate[]>,

    // #[stable_hash(ignore)]
    public delayed_lints: Steal<unknown>,
  ) {}

  // rustc: compiler/rustc_middle/src/hir/mod.rs:417 new
  static new(
    nodes: OwnerNodes,
    parenting: Map<LocalDefId, ItemLocalId>,
    trait_map: Map<ItemLocalId, readonly TraitCandidate[]>,
    delayed_lints: Steal<unknown>,
  ): ProjectedOwnerInfo {
    return new ProjectedOwnerInfo(nodes, parenting, trait_map, delayed_lints);
  }
}

// rustc-type: compiler/rustc_middle/src/hir/mod.rs:428 ProjectedMaybeOwner
// #[derive(Clone, Copy, Debug, StableHash)]
export type ProjectedMaybeOwner = { readonly $: "Owner"; _0: ProjectedOwnerInfo } | { readonly $: "NonOwner"; _0: HirId };
export const ProjectedMaybeOwner = {
  // rustc: compiler/rustc_middle/src/hir/mod.rs:434 new
  new(value: MaybeOwner): ProjectedMaybeOwner {
    switch (value.$) {
      case "Owner": {
        const o = value._0;
        return {
          $: "Owner",
          _0: new ProjectedOwnerInfo(o.nodes, o.parenting, o.trait_map, o.delayed_lints),
        };
      }
      case "NonOwner":
        return { $: "NonOwner", _0: value._0 };
    }
  },

  // rustc: compiler/rustc_middle/src/hir/mod.rs:446 as_owner
  as_owner(self: ProjectedMaybeOwner): ProjectedOwnerInfo | undefined {
    switch (self.$) {
      case "Owner":
        return self._0;
      case "NonOwner":
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/hir/mod.rs:453 unwrap
  unwrap(self: ProjectedMaybeOwner): ProjectedOwnerInfo {
    const o = ProjectedMaybeOwner.as_owner(self);
    return o !== undefined ? o : panic("Not a HIR owner");
  },
} as const;

// rustc: compiler/rustc_middle/src/hir/mod.rs:458 provide
export function provide(providers: Providers): void {
  providers.hir_crate_items = map.hir_crate_items;
  providers.crate_hash = map.crate_hash;
  providers.hir_module_items = map.hir_module_items;
  providers.hir_attr_map = (tcx, id) => {
    const o = MaybeOwner.as_owner(tcx.lower_to_hir(id) as MaybeOwner);
    return o === undefined ? AttributeMap.EMPTY : o.attrs;
  };
  providers.hir_owner = (tcx, def_id) => ProjectedMaybeOwner.new(tcx.lower_to_hir(def_id) as MaybeOwner);
  providers.hir_owner_parent_q = (tcx, owner_id) => tcx.hir_owner_parent_impl(owner_id);
  providers.def_span = (tcx, def_id) => tcx.hir_span(tcx.local_def_id_to_hir_id(def_id));
  providers.def_ident_span = (tcx, def_id) => {
    const hir_id = tcx.local_def_id_to_hir_id(def_id);
    return tcx.hir_opt_ident_span(hir_id);
  };
  providers.ty_span = (tcx, def_id) => {
    const node = tcx.hir_node_by_def_id(def_id);
    const ty = Node.ty(node);
    if (ty !== undefined) {
      return ty.span;
    } else {
      return bug(`${debug_LocalDefId(def_id, PLAIN)} doesn't have a type: ${format_debug(node, debug_Node, PRETTY)}`);
    }
  };
  providers.fn_arg_idents = (tcx, def_id) => {
    const node = tcx.hir_node_by_def_id(def_id);
    const body_id = Node.body_id(node);
    if (body_id !== undefined) {
      // `tcx.arena.alloc_from_iter(..)`: arenas are erased.
      return tcx.hir_body_param_idents(body_id);
    } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn" && node._0.kind._1.$ === "Required") {
      return node._0.kind._1._0;
    } else if (node.$ === "ForeignItem" && node._0.kind.$ === "Fn") {
      return node._0.kind._1;
    } else {
      return span_bug(tcx.hir_span(tcx.local_def_id_to_hir_id(def_id)), `fn_arg_idents: unexpected item ${debug_LocalDefId(def_id, PLAIN)}`);
    }
  };
  // PORT: the resolver's `trait_impls` (`FxIndexMap<DefId, Vec<LocalDefId>>`) is a `DefIdMap` (middle/resolve.ts).
  providers.all_local_trait_impls = (tcx, _) => tcx.resolutions(null).trait_impls;
  providers.local_trait_impls = (tcx, trait_id) => tcx.resolutions(null).trait_impls.get(trait_id) ?? [];
  providers.expn_that_defined = (tcx, id) => tcx.resolutions(null).expn_that_defined.get(id) ?? ExpnId.root();
}
