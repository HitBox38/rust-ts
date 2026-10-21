//! Coroutine layout logic.
//!
//! When laying out coroutines, we divide our saved local fields into two
//! categories: overlap-eligible and overlap-ineligible.
//!
//! Those fields which are ineligible for overlap go in a "prefix" at the
//! beginning of the layout, and always have space reserved for them.
//!
//! Overlap-eligible fields are only assigned to one variant, so we lay
//! those fields out for each variant and put them right after the
//! prefix.
//!
//! Finally, in the layout details, we point to the fields from the
//! variants they are assigned to. It is possible for some fields to be
//! included in multiple variants. No field ever "moves around" in the
//! layout; its offset is always the same.
//!
//! Also included in the layout are the upvars and the discriminant.
//! These are included as fields on the "outer" layout; they are not part
//! of any variant.
// Port of compiler/rustc_abi/src/layout/coroutine.rs (lane layout-contract: the type with its Debug and a `// stub:`
// declaration of both fns for lane abi-layout-b; conventions in layout.ts's header).
import type { BitMatrix, DenseBitSet } from "../../rustc_index/bit_set.ts";
import { type Debug, debug_int, debug_option, debug_tuple, type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { HasDataLayout, Scalar } from "../lib.ts";
import type { DerefLayoutData, FieldIdx, LayoutCalculator, LayoutCalculatorResult, VariantIdx } from "../layout.ts";

/// Overlap eligibility and variant assignment for each CoroutineSavedLocal.
// #[derive(Clone, Debug, PartialEq)]
// PORT (layout-contract): the `VariantIdx` / `FieldIdx` parameters are erased (layout.ts header).
export type SavedLocalEligibility =
  | { readonly $: "Unassigned" }
  | { readonly $: "Assigned"; readonly _0: VariantIdx }
  | { readonly $: "Ineligible"; readonly _0: FieldIdx | undefined };
export const SavedLocalEligibility = {
  Unassigned: Object.freeze({ $: "Unassigned" }) as SavedLocalEligibility,
} as const;
// derive(Debug)
export const debug_SavedLocalEligibility: Debug<SavedLocalEligibility> = (v: SavedLocalEligibility, f: Fmt) => {
  switch (v.$) {
    case "Unassigned":
      return "Unassigned";
    case "Assigned":
      return debug_tuple(f, "Assigned", [debug_int(v._0, f)]);
    case "Ineligible":
      return debug_tuple(f, "Ineligible", [debug_option(v._0, f, debug_int)]);
  }
};

/// Compute the eligibility and assignment of each local.
// stub: compiler/rustc_abi/src/layout/coroutine.rs:42 coroutine_saved_local_eligibility (lane abi-layout-b)
export function coroutine_saved_local_eligibility<LocalIdx extends number>(
  _nb_locals: number,
  _variant_fields: readonly (readonly LocalIdx[])[],
  _storage_conflicts: BitMatrix<LocalIdx, LocalIdx>,
): [DenseBitSet<LocalIdx>, SavedLocalEligibility[]] {
  return unported("rustc_abi::layout::coroutine::coroutine_saved_local_eligibility");
}

/// Compute the full coroutine layout.
// stub: compiler/rustc_abi/src/layout/coroutine.rs:139 layout (lane abi-layout-b)
export function layout<F extends DerefLayoutData, LocalIdx extends number>(
  _calc: LayoutCalculator<HasDataLayout>,
  _local_layouts: readonly F[],
  _prefix_layouts: F[],
  _variant_fields: readonly (readonly LocalIdx[])[],
  _storage_conflicts: BitMatrix<LocalIdx, LocalIdx>,
  _tag_to_layout: (tag: Scalar) => F,
): LayoutCalculatorResult<F> {
  return unported("rustc_abi::layout::coroutine::layout");
}
