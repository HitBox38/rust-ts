// Port of compiler/rustc_ast/src/node_id.rs
// Types and derived Debug impls are generated into node_id.gen.ts (tools/codegen/types.ts): the
// `newtype_index!` expansion (`NodeId`, `debug_NodeId`, `CRATE_NODE_ID`).
//
// PORT: `NodeId`'s inherent fns live on the companion const (PORTING §8), which this module
// re-defines as `{ ...gen.NodeId, fns }` (node_id.gen.ts is only entered through this module).
import { LocalExpnId } from "../rustc_span/hygiene.ts";
import * as gen from "./node_id.gen.ts";

export * from "./node_id.gen.ts";

// rustc-skip: compiler/rustc_ast/src/node_id.rs:24 stable_hash StableHash (incremental, out of scope until M5)

// PORT: `rustc_data_structures::define_id_collections!(NodeMap, NodeSet, NodeMapEntry, NodeId)`:
// `FxHashMap<NodeId, T>` / `FxHashSet<NodeId>` are `Map<NodeId, T>` / `Set<NodeId>` (PORTING §5).
export type NodeMap<T> = Map<gen.NodeId, T>;
export type NodeSet = Set<gen.NodeId>;

/// When parsing and at the beginning of doing expansions, we initially give all AST nodes
/// this dummy AST [`NodeId`]. Then, during a later phase of expansion, we renumber them
/// to have small, positive IDs.
export const DUMMY_NODE_ID: gen.NodeId = gen.NodeId.MAX;

export type NodeId = gen.NodeId;
export const NodeId = {
  ...gen.NodeId,

  // rustc: compiler/rustc_ast/src/node_id.rs:39 placeholder_from_expn_id
  placeholder_from_expn_id(expn_id: LocalExpnId): NodeId {
    return gen.NodeId.from_u32(LocalExpnId.as_u32(expn_id));
  },

  // rustc: compiler/rustc_ast/src/node_id.rs:43 placeholder_to_expn_id
  placeholder_to_expn_id(self: NodeId): LocalExpnId {
    return LocalExpnId.from_u32(gen.NodeId.as_u32(self));
  },
};

// impl fmt::Display for NodeId
// PORT: `Display` impls are `display_<Type>(v): string` (as in rustc_span).
// rustc: compiler/rustc_ast/src/node_id.rs:49 fmt
export function display_NodeId(self: NodeId): string {
  return String(gen.NodeId.as_u32(self));
}
