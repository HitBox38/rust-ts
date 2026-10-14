// Port of compiler/rustc_ast_lowering/src/index.rs (STUB, lane lower-index-diag: see
// docs/handoff/lowering-contract.md "How to fill a stub").
//
// `index_hir` (the `NodeCollector` HIR visitor, intravisit from lane hir-visit) builds the `OwnerNodes`
// node table and parenting map of one owner; `PerOwnerLoweringState::into_owner_info` (lib.rs) calls it.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates.
import type { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import type { ItemLocalId } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { unported } from "../std/panic.ts";
import type * as hir from "./hir_shim.ts";

// index.rs:30 (stub; final signature: decls.ts `FreeFns`)
export function index_hir(
  _tcx: TyCtxt,
  _item: hir.OwnerNode,
  _bodies: SortedMap<ItemLocalId, hir.Body>,
  _num_nodes: number,
): [hir.ParentedNode[], Map<LocalDefId, ItemLocalId>] {
  return unported("rustc_ast_lowering::index::index_hir");
}
