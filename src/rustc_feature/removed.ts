//! List of the removed feature gates.

import type { Feature } from "./lib.ts";

export interface RemovedFeature {
  readonly feature: Feature;
  readonly reason: string | undefined;
  // PORT: `Option<NonZero<u32>>` -> `number | undefined` (never 0).
  readonly pull: number | undefined;
}

// PORT: `macro_rules! opt_nonzero_u32` and `macro_rules! declare_features` with its invocation are
// expanded by tools/codegen/features.ts into removed.gen.ts (`REMOVED_LANG_FEATURES`).
export { REMOVED_LANG_FEATURES } from "./removed.gen.ts";
