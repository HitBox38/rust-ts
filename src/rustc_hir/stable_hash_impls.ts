// Port of compiler/rustc_hir/src/stable_hash_impls.rs
//
// PORT: each `impl StableHash for T` is a free fn `stable_hash_<T>(self, hcx, hasher)` (the derive(StableHash)
// generator imports `stable_hash_OwnerInfo` from here for `MaybeOwner::Owner`).
import { stable_hash_Fingerprint, type StableHashCtxt, type StableHasher } from "../rustc_data_structures/stable_hash.ts";
import { unwrap } from "../std/panic.ts";
import type { AttributeMap, OwnerInfo, OwnerNodes } from "./hir.ts";

// The following implementations of StableHash for `ItemId`, `TraitItemId`, and
// `ImplItemId` deserve special attention. Normally we do not hash `NodeId`s within
// the HIR, since they just signify a HIR nodes own path. But `ItemId` et al
// are used when another item in the HIR is *referenced* and we certainly
// want to pick up on a reference changing its target, so we hash the NodeIds
// in "DefPath Mode".

// impl<'tcx> StableHash for OwnerNodes<'tcx>
// rustc: compiler/rustc_hir/src/stable_hash_impls.rs:13 stable_hash
export function stable_hash_OwnerNodes(self: OwnerNodes, hcx: StableHashCtxt, hasher: StableHasher): void {
  // We ignore the other fields since these refer to information included in
  // `opt_hash` which is hashed in the collector and used for the crate hash.
  const opt_hash = self.opt_hash;
  stable_hash_Fingerprint(unwrap(opt_hash), hcx, hasher);
}

// impl<'tcx> StableHash for AttributeMap<'tcx>
// rustc: compiler/rustc_hir/src/stable_hash_impls.rs:22 stable_hash
export function stable_hash_AttributeMap(self: AttributeMap, hcx: StableHashCtxt, hasher: StableHasher): void {
  // We ignore the `map` since it refers to information included in `opt_hash` which is
  // hashed in the collector and used for the crate hash.
  const opt_hash = self.opt_hash;
  stable_hash_Fingerprint(unwrap(opt_hash), hcx, hasher);
}

// impl<'tcx> StableHash for OwnerInfo<'tcx>
// rustc: compiler/rustc_hir/src/stable_hash_impls.rs:31 stable_hash
export function stable_hash_OwnerInfo(self: OwnerInfo, hcx: StableHashCtxt, hasher: StableHasher): void {
  // We ignore the other fields since these refer to information included in
  // `opt_hash` which is hashed in the collector and used for the crate hash.
  const opt_hash = self.opt_hash;
  stable_hash_Fingerprint(unwrap(opt_hash), hcx, hasher);
}
