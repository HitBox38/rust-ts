// Port of compiler/rustc_mir_dataflow/src/impls/mod.rs (lane dataflow-contract): the module declarations and
// re-exports (no fns). The analyses themselves are DECLARED stubs for lane `dataflow-impls`.

export { borrowed_locals, MaybeBorrowedLocals } from "./borrowed_locals.ts";
export {
  EverInitializedPlaces,
  type EverInitializedPlacesDomain,
  MaybeInitializedPlaces,
  MaybeUninitializedPlaces,
  type MaybeUninitializedPlacesDomain,
} from "./initialized.ts";
export { DefUse, LivenessTransferFunction, MaybeLiveLocals, MaybeTransitiveLiveLocals } from "./liveness.ts";
export {
  dump_liveness_matrix,
  liveness_matrix,
  SplitPointEffect,
  SplitPointIndex,
  VisitAllocatedLocalsWith,
  VisitDeallocatedLocalsWith,
} from "./precise_liveness.ts";
export { always_storage_live_locals, MaybeRequiresStorage, MaybeStorageDead, MaybeStorageLive } from "./storage_liveness.ts";
