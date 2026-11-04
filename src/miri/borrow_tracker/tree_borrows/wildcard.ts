// Port of src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-a`
// (plan-m6 wave 38). Its types are generated into wildcard.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT: `impl WildcardAccessLevel` / `impl WildcardAccessRelatedness` are on the generated companions (PORTING §8); the
// derived `PartialOrd` is `WildcardAccessLevel_discriminant`.
// PORT: `ExposedCacheNode`'s counters are `u16` and the oracle Miri is a release build (no overflow checks), so `+ 1`,
// `- 1` and `+ u16::from(..)` wrap at 2^16 (`u16_add` / `u16_sub`).
// PORT: `impl Tree` is on tree.gen.ts's class, another module's: `port_methods` (C10).
import { type AccessKind, type BorTag, debug_BorTag, type GlobalState } from "../mod.ts";
import { type Permission } from "./perms.ts";
import { type AccessRelatedness, type LocationState, type Node, Tree } from "./tree.ts";
import { debug_UniIndex, type UniIndex, UniValMap, UniValMap_eq } from "./unimap.ts";
import * as gen from "./wildcard.gen.ts";
import { ExposedCache, type ExposedCacheNode } from "./wildcard.gen.ts";
import { port_methods } from "../../../rust_ts/miri_stub.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, unwrap } from "../../../std/panic.ts";
export * from "./wildcard.gen.ts";

declare module "./wildcard.gen.ts" {
  interface ExposedCache {
    // borrow_tracker/tree_borrows/wildcard.rs:85
    access_relatedness(root: UniIndex, id: UniIndex, kind: AccessKind, is_wildcard_tree: boolean, only_foreign: boolean): WildcardAccessRelatedness | undefined;
    // borrow_tracker/tree_borrows/wildcard.rs:150
    update_exposure(nodes: UniValMap<Node>, id: UniIndex, from: WildcardAccessLevel, to: WildcardAccessLevel): void;
    // borrow_tracker/tree_borrows/wildcard.rs:186
    remove(idx: UniIndex): void;
  }
  namespace ExposedCache {
    /** `#[derive(Default)]` (borrow_tracker/tree_borrows/wildcard.rs:60). */
    function default_(): ExposedCache;
    export { default_ as default };
  }
}
declare module "./tree.gen.ts" {
  interface Tree {
    // borrow_tracker/tree_borrows/wildcard.rs:195
    expose_tag(tag: BorTag, protected_: boolean): void;
    // borrow_tracker/tree_borrows/wildcard.rs:225
    update_exposure_for_protector_release(tag: BorTag): void;
    // borrow_tracker/tree_borrows/wildcard.rs:251
    verify_wildcard_consistency(global: GlobalState): void;
  }
}

/** `u16` addition / subtraction, wrapping as in the release oracle (module header). */
function u16_add(a: number, b: number): number {
  return (a + b) & 0xffff;
}
function u16_sub(a: number, b: number): number {
  return (a - b) & 0xffff;
}

/** PORT: the methods of `impl WildcardAccessLevel` on the generated companion (PORTING §8). */
export interface WildcardAccessLevel_methods {
  allows(self: WildcardAccessLevel, kind: AccessKind): boolean;
}
/// Represents the maximum access level that is possible.
///
/// Note that we derive Ord and PartialOrd, so the order in which variants are listed below matters:
/// None < Read < Write. Do not change that order.
export type WildcardAccessLevel = gen.WildcardAccessLevel;
export const WildcardAccessLevel = gen.WildcardAccessLevel as typeof gen.WildcardAccessLevel & WildcardAccessLevel_methods;

// impl WildcardAccessLevel
/// Weather this access kind is allowed at this level.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs:24 allows
WildcardAccessLevel.allows = function (self: WildcardAccessLevel, kind: AccessKind): boolean {
  const required_level: WildcardAccessLevel = kind === "Read" ? "Read" : "Write";
  return gen.WildcardAccessLevel_discriminant[required_level] <= gen.WildcardAccessLevel_discriminant[self];
};

/** PORT: the methods of `impl WildcardAccessRelatedness` on the generated companion (PORTING §8). */
export interface WildcardAccessRelatedness_methods {
  to_relatedness(self: WildcardAccessRelatedness): AccessRelatedness | undefined;
}
/// Where the access happened relative to the current node.
export type WildcardAccessRelatedness = gen.WildcardAccessRelatedness;
export const WildcardAccessRelatedness = gen.WildcardAccessRelatedness as typeof gen.WildcardAccessRelatedness & WildcardAccessRelatedness_methods;

// impl WildcardAccessRelatedness
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs:44 to_relatedness
WildcardAccessRelatedness.to_relatedness = function (self: WildcardAccessRelatedness): AccessRelatedness | undefined {
  switch (self) {
    case "LocalAccess":
      return "LocalAccess";
    case "ForeignAccess":
      return "ForeignAccess";
    case "EitherAccess":
      return undefined;
  }
};

/** `#[derive(Default)]` of `ExposedCache` (wildcard.rs:60). */
(ExposedCache as unknown as { default: () => ExposedCache }).default = function (): ExposedCache {
  return new ExposedCache(UniValMap.default<ExposedCacheNode>());
};
/** `#[derive(PartialEq)]` of `ExposedCacheNode`. */
export function ExposedCacheNode_eq(a: ExposedCacheNode, b: ExposedCacheNode): boolean {
  return a.local_writes === b.local_writes && a.local_reads === b.local_reads;
}
/** `#[derive(PartialEq)]` of `ExposedCache`: `UniValMap`'s `PartialEq`, i.e. `equivalent`. */
export function ExposedCache_eq(a: ExposedCache, b: ExposedCache): boolean {
  return UniValMap_eq(a._0, b._0, ExposedCacheNode_eq);
}

/** `ExposedCacheNode::default()` for the read-only `.cloned().unwrap_or_default()` copies (nothing writes to them). */
const DEFAULT_NODE: Readonly<ExposedCacheNode> = Object.freeze({ local_writes: 0, local_reads: 0 });

// impl ExposedCache
/// Returns the relatedness of a wildcard access to a node.
///
/// This function only considers a single subtree. If the current subtree does not contain
/// any valid exposed nodes then the function return `None`.
///
/// * `root`: The root of the subtree the node belongs to.
/// * `id`: The id of the node.
/// * `kind`: The kind of the wildcard access.
/// * `is_wildcard_tree`: This nodes belongs to a wildcard subtree.
///   This means we always treat foreign accesses as possible.
/// * `only_foreign`: Assume the access cannot come from a local node.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs:85 access_relatedness
ExposedCache.prototype.access_relatedness = function (
  this: ExposedCache,
  root: UniIndex,
  id: UniIndex,
  kind: AccessKind,
  is_wildcard_tree: boolean,
  only_foreign: boolean,
): WildcardAccessRelatedness | undefined {
  // All nodes in the tree are local to the root, so we can use the root to get the total
  // number of valid exposed nodes in the tree.
  const root_ = this._0.get(root) ?? DEFAULT_NODE;
  const node = this._0.get(id) ?? DEFAULT_NODE;

  let total_num_: number;
  let local_num: number;
  switch (kind) {
    case "Read":
      total_num_ = root_.local_reads;
      local_num = node.local_reads;
      break;
    case "Write":
      total_num_ = root_.local_writes;
      local_num = node.local_writes;
      break;
  }

  // If this is a wildcard tree then an access can always be foreign as
  // it could come from another tree.
  // We can represent this by adding 1 to the total which means there
  // always exists a foreign exposed node.
  // (We cannot bake this into the root's count as then if `node == root` it would
  // affect both `total` and `local`.)
  const total_num = u16_add(total_num_, is_wildcard_tree ? 1 : 0);

  let relatedness: WildcardAccessRelatedness | undefined;
  if (total_num === 0) {
    // we return None if the tree does not contain any valid exposed nodes.
    relatedness = undefined;
  } else if (total_num === local_num) {
    // If all valid exposed nodes are local to this node then the access is local.
    relatedness = "LocalAccess";
  } else if (local_num === 0) {
    // If the node does not have any exposed nodes as children then the access is foreign.
    relatedness = "ForeignAccess";
  } else {
    // If some but not all of the valid exposed nodes are local then we cannot determine the correct relatedness.
    relatedness = "EitherAccess";
  }

  if (only_foreign) {
    // This is definitely not a local access; clamp the result accordingly.
    switch (relatedness) {
      case "LocalAccess":
        return undefined;
      case "ForeignAccess":
        return "ForeignAccess";
      case "EitherAccess":
        return "ForeignAccess";
      case undefined:
        return undefined;
    }
  } else {
    return relatedness;
  }
};

/// Update the tracking information of a tree, to reflect that the node specified by `id` is
/// now exposed with `new_exposed_as` permission.
///
/// Propagates the Willard access information over the tree. This needs to be called every
/// time the access level of an exposed node changes, to keep the state in sync with
/// the rest of the tree.
///
/// * `from`: The previous access level of the exposed node.
///   Set to `None` if the node was not exposed before.
/// * `to`: The new access level.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs:150 update_exposure
ExposedCache.prototype.update_exposure = function (
  this: ExposedCache,
  nodes: UniValMap<Node>,
  id: UniIndex,
  from: WildcardAccessLevel,
  to: WildcardAccessLevel,
): void {
  // If the exposure doesn't change, then we don't need to update anything.
  if (from === to) {
    return;
  }

  // Update the counts of this node and all its ancestors.
  let next_id: UniIndex | undefined = id;
  while (next_id !== undefined) {
    const id_: UniIndex = next_id;
    const node: Node = unwrap(nodes.get(id_));
    const state = this._0.entry(id_).or_insert({ local_writes: 0, local_reads: 0 });

    if ((from === "None" || from === "Read") && to === "Write") {
      state.local_writes = u16_add(state.local_writes, 1);
    } else if (from === "Write" && (to === "None" || to === "Read")) {
      state.local_writes = u16_sub(state.local_writes, 1);
    }
    if (from === "None" && (to === "Read" || to === "Write")) {
      state.local_reads = u16_add(state.local_reads, 1);
    } else if ((from === "Read" || from === "Write") && to === "None") {
      state.local_reads = u16_sub(state.local_reads, 1);
    }
    next_id = node.parent;
  }
};

/// Removes a node from the datastructure.
///
/// The caller needs to ensure that the node does not have any children.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs:186 remove
ExposedCache.prototype.remove = function (this: ExposedCache, idx: UniIndex): void {
  this._0.remove(idx);
};

/** `perms.get(id).map(|p| p.permission()).unwrap_or_else(|| node.default_location_state().permission())` */
function permission_at(perms: UniValMap<LocationState>, id: UniIndex, node: Node): Permission {
  const p = perms.get(id);
  return p !== undefined ? p.permission_() : node.default_location_state().permission_();
}

// impl Tree
port_methods("miri::borrow_tracker::tree_borrows::wildcard::Tree", () => Tree.prototype, {
  /// Marks the tag as exposed & updates the wildcard tracking data structure
  /// to represent its access level.
  /// Also takes as an argument whether the tag is protected or not.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs:195 expose_tag
  expose_tag: function (this: Tree, tag: BorTag, protected_: boolean): void {
    const id = unwrap(this.tag_mapping.get(tag));
    const node_ = unwrap(this.nodes.get_mut(id));
    if (!node_.is_exposed) {
      node_.is_exposed = true;
      const node = unwrap(this.nodes.get(id));

      for (const [, loc] of this.locations.iter_mut_all()) {
        const perm = permission_at(loc.perms, id, node);

        const access_level = perm.strongest_allowed_local_access(protected_);
        // An unexposed node gets treated as access level `None`. Therefore,
        // the initial exposure transitions from `None` to the node's actual
        // `access_level`.
        loc.exposed_cache.update_exposure(this.nodes, id, "None", access_level);
      }
    }
  },

  /// This updates the wildcard tracking data structure to reflect the release of
  /// the protector on `tag`.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs:225 update_exposure_for_protector_release
  update_exposure_for_protector_release: function (this: Tree, tag: BorTag): void {
    const idx = unwrap(this.tag_mapping.get(tag));

    // We check if the node is already exposed, as we don't want to expose any
    // nodes which aren't already exposed.
    const node = unwrap(this.nodes.get(idx));
    if (node.is_exposed) {
      for (const [, loc] of this.locations.iter_mut_all()) {
        const perm = permission_at(loc.perms, idx, node);
        // We are transitioning from protected to unprotected.
        const old_access_type = perm.strongest_allowed_local_access(/*protected*/ true);
        const access_type = perm.strongest_allowed_local_access(/*protected*/ false);
        loc.exposed_cache.update_exposure(this.nodes, idx, old_access_type, access_type);
      }
    }
  },

  // #[cfg(feature = "expensive-consistency-checks")]: off in the oracle (miri-sb handoff), so tree.ts's call sites are
  // comments; ported for the tests.
  // impl Tree
  /// Checks that the wildcard tracking data structure is internally consistent and
  /// has the correct `exposed_as` values.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/wildcard.rs:251 verify_wildcard_consistency
  verify_wildcard_consistency: function (this: Tree, global: GlobalState): void {
    // We rely on the fact that `roots` is ordered according to tag from low to high.
    let sorted = true;
    for (let i = 1; i < this.roots.length; i++) {
      if (unwrap(this.nodes.get(this.roots[i - 1]!)).tag > unwrap(this.nodes.get(this.roots[i]!)).tag) sorted = false;
    }
    assert(sorted, "assertion failed: self.roots.is_sorted_by_key(|idx| self.nodes.get(*idx).unwrap().tag)");

    const protected_tags = global.protected_tags;
    for (const [, loc] of this.locations.iter_all()) {
      const exposed_cache = loc.exposed_cache;
      const perms = loc.perms;
      for (const [id, node] of this.nodes.iter()) {
        const state = exposed_cache._0.get(id) ?? DEFAULT_NODE;

        let exposed_as: WildcardAccessLevel;
        if (node.is_exposed) {
          const perm = perms.get(id) ?? node.default_location_state();

          exposed_as = perm.permission_().strongest_allowed_local_access(protected_tags.has(node.tag));
        } else {
          exposed_as = "None";
        }

        let child_reads = 0;
        let child_writes = 0;
        for (const child of node.children) {
          const wc = exposed_cache._0.get(child) ?? DEFAULT_NODE;
          child_reads = u16_add(child_reads, wc.local_reads);
          child_writes = u16_add(child_writes, wc.local_writes);
        }
        const level = gen.WildcardAccessLevel_discriminant[exposed_as];
        const expected_reads = u16_add(child_reads, level >= gen.WildcardAccessLevel_discriminant.Read ? 1 : 0);
        const expected_writes = u16_add(child_writes, level >= gen.WildcardAccessLevel_discriminant.Write ? 1 : 0);
        assert(
          state.local_reads === expected_reads,
          () =>
            `assertion \`left == right\` failed: expected ${debug_BorTag(node.tag, PLAIN)}'s (id:${debug_UniIndex(id, PLAIN)}) local_reads to be ${expected_reads} instead of ${state.local_reads} (child_reads: ${child_reads}, exposed_as: ${exposed_as})\n  left: ${state.local_reads}\n right: ${expected_reads}`,
        );
        assert(
          state.local_writes === expected_writes,
          () =>
            `assertion \`left == right\` failed: expected ${debug_BorTag(node.tag, PLAIN)}'s (id:${debug_UniIndex(id, PLAIN)}) local_writes to be ${expected_writes} instead of ${state.local_writes} (child_writes: ${child_writes}, exposed_as: ${exposed_as})\n  left: ${state.local_writes}\n right: ${expected_writes}`,
        );
      }
    }
  },
});
