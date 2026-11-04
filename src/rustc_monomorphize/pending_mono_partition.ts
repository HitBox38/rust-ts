// Stand-ins for what lane mono-partition ports in compiler/rustc_middle/src/mono.rs. Not a port of one upstream file:
// nothing here carries a `// rustc:` marker of its own lane's file, and the whole module goes away at the merge.
//
// PORT(contract): pending mono-partition. Each export keeps upstream's signature. `MonoItem` in rustc_middle/mono.ts is
// a companion const, so `declare module` cannot add methods to it; these are free functions until mono.ts has them.
// At the merge: replace `MonoItem_is_instantiable(x, tcx)` with `MonoItem.is_instantiable(x, tcx)`, and likewise for the
// others, then delete this file (docs/handoff/mono-collector.md lists the call sites).
import type { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import {
  type StableHashCtxt,
  StableHasher,
  stable_hash_bool,
  stable_hash_Discriminant,
  stable_hash_Option,
  stable_hash_usize,
} from "../rustc_data_structures/stable_hash.ts";
import { stable_hash_ItemId } from "../rustc_hir/stable_hash.gen.ts";
import type { MonoItem } from "../rustc_middle/mono.ts";
import { stable_hash_Ty } from "../rustc_middle/stable_hash.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { stable_hash_GenericArg, stable_hash_RawList } from "../rustc_middle/ty/impls_ty.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { display_Instance, Instance, type InstanceKind, type ReifyReason, type ShimKind } from "../rustc_middle/ty/instance.ts";
import { stable_hash_DefId } from "../rustc_span/def_id.ts";

/// PORT(contract): pending mono-partition. compiler/rustc_middle/src/mono.rs:52
/// `#[derive(PartialEq, Eq, Clone, Copy, Debug, Hash, StableHash, TyEncodable, TyDecodable)]`, a unit struct.
export interface NormalizationErrorInMono {
  readonly $: "NormalizationErrorInMono";
}
export const NormalizationErrorInMono: NormalizationErrorInMono = Object.freeze({ $: "NormalizationErrorInMono" });

/// PORT(contract): pending mono-partition. compiler/rustc_middle/src/mono.rs:272 `MonoItem::is_instantiable`
export function MonoItem_is_instantiable(self: MonoItem, tcx: TyCtxt): boolean {
  // debug!("is_instantiable({:?})", self);
  let def_id;
  let args;
  switch (self.$) {
    case "Fn":
      def_id = Instance.def_id(self._0);
      args = self._0.args;
      break;
    case "Static":
      def_id = self._0;
      args = RawList.empty();
      break;
    // global asm never has predicates
    case "GlobalAsm":
      return true;
  }

  return !tcx.instantiate_and_check_impossible_clauses([def_id, args]);
}

/// PORT(contract): pending mono-partition. compiler/rustc_middle/src/mono.rs:317 `impl Display for MonoItem`
export function display_MonoItem(self: MonoItem): string {
  switch (self.$) {
    case "Fn":
      return `fn ${display_Instance(self._0)}`;
    case "Static":
      return `static ${display_Instance(Instance.new_raw(self._0, RawList.empty()))}`;
    case "GlobalAsm":
      return "global_asm";
  }
}

// PORT(contract): pending mono-partition. `#[derive(StableHash)]` of `ReifyReason`, `ShimKind`, `InstanceKind`,
// `Instance` (compiler/rustc_middle/src/ty/instance.rs:31, 43, 60, 98) and `MonoItem` (mono.rs:55), hand-written in the
// shape tools/codegen/types.ts emits (a set with `derive_stable_hash` would generate them; that is a tools batch).
// Checked against the oracle's `to_stable_hash_key` fingerprints by collector.oracle.test.ts.
const ReifyReason__discriminant = { FnPtr: 0, Vtable: 1 } as const;
function stable_hash_ReifyReason(self: ReifyReason, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Discriminant(ReifyReason__discriminant[self], hcx, hasher);
}

const ShimKind__discriminant = {
  VTable: 0,
  Reify: 1,
  FnPtr: 2,
  ClosureOnce: 3,
  ConstructCoroutineInClosure: 4,
  ThreadLocal: 5,
  FutureDropPoll: 6,
  DropGlue: 7,
  Clone: 8,
  FnPtrAsPtr: 9,
  FnPtrFromPtr: 10,
  AsyncDropGlueCtor: 11,
  AsyncDropGlue: 12,
} as const;
function stable_hash_ShimKind(self: ShimKind, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Discriminant(ShimKind__discriminant[self.$], hcx, hasher);
  switch (self.$) {
    case "VTable":
    case "ThreadLocal":
      stable_hash_DefId(self._0, hcx, hasher);
      break;
    case "Reify":
      stable_hash_DefId(self._0, hcx, hasher);
      stable_hash_Option(self._1, hcx, hasher, stable_hash_ReifyReason);
      break;
    case "ClosureOnce":
      stable_hash_DefId(self.call_once, hcx, hasher);
      stable_hash_DefId(self.closure, hcx, hasher);
      stable_hash_bool(self.track_caller, hcx, hasher);
      break;
    case "ConstructCoroutineInClosure":
      stable_hash_DefId(self.coroutine_closure_def_id, hcx, hasher);
      stable_hash_bool(self.receiver_by_ref, hcx, hasher);
      break;
    case "FutureDropPoll":
      stable_hash_DefId(self._0, hcx, hasher);
      stable_hash_Ty(self._1, hcx, hasher);
      stable_hash_Ty(self._2, hcx, hasher);
      break;
    case "DropGlue":
      stable_hash_DefId(self._0, hcx, hasher);
      stable_hash_Option(self._1, hcx, hasher, stable_hash_Ty);
      break;
    case "FnPtr":
    case "Clone":
    case "FnPtrAsPtr":
    case "FnPtrFromPtr":
    case "AsyncDropGlueCtor":
    case "AsyncDropGlue":
      stable_hash_DefId(self._0, hcx, hasher);
      stable_hash_Ty(self._1, hcx, hasher);
      break;
  }
}

const InstanceKind__discriminant = { Item: 0, Intrinsic: 1, LlvmIntrinsic: 2, Virtual: 3, Shim: 4 } as const;
function stable_hash_InstanceKind(self: InstanceKind, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Discriminant(InstanceKind__discriminant[self.$], hcx, hasher);
  switch (self.$) {
    case "Item":
    case "Intrinsic":
    case "LlvmIntrinsic":
      stable_hash_DefId(self._0, hcx, hasher);
      break;
    case "Virtual":
      stable_hash_DefId(self._0, hcx, hasher);
      stable_hash_usize(self._1, hcx, hasher);
      break;
    case "Shim":
      stable_hash_ShimKind(self._0, hcx, hasher);
      break;
  }
}

function stable_hash_Instance(self: Instance, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_InstanceKind(self.def, hcx, hasher);
  stable_hash_RawList(self.args, hcx, hasher, stable_hash_GenericArg);
}

const MonoItem__discriminant = { Fn: 0, Static: 1, GlobalAsm: 2 } as const;
function stable_hash_MonoItem(self: MonoItem, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Discriminant(MonoItem__discriminant[self.$], hcx, hasher);
  switch (self.$) {
    case "Fn":
      stable_hash_Instance(self._0, hcx, hasher);
      break;
    case "Static":
      stable_hash_DefId(self._0, hcx, hasher);
      break;
    case "GlobalAsm":
      stable_hash_ItemId(self._0, hcx, hasher);
      break;
  }
}

/// PORT(contract): pending mono-partition. compiler/rustc_middle/src/mono.rs:332 `to_stable_hash_key`
export function MonoItem_to_stable_hash_key(self: MonoItem, hcx: StableHashCtxt, finish: (hasher: StableHasher) => Fingerprint): Fingerprint {
  const hasher = StableHasher.new();
  stable_hash_MonoItem(self, hcx, hasher);
  return finish(hasher);
}
