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
// Port of compiler/rustc_abi/src/layout/coroutine.rs (lane layout-contract: the type with its Debug; lane abi-layout-b:
// both fns; conventions in layout.ts's header).
// Init order: lib.ts's values are read inside function bodies only.
import { Hash64 } from "../../rustc_hashes/lib.ts";
import { type BitMatrix, DenseBitSet } from "../../rustc_index/bit_set.ts";
import { type Debug, debug_int, debug_option, debug_tuple, type Fmt } from "../../std/fmt.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import {
  type BackendRepr,
  type FieldsShape,
  type HasDataLayout,
  Integer,
  LayoutData,
  ReprFlags,
  ReprOptions,
  type Scalar,
  type Size,
  StructKind,
  TagEncoding,
  VariantLayout,
  type Variants,
} from "../lib.ts";
import { type DerefLayoutData, FieldIdx, type LayoutCalculator, type LayoutCalculatorResult, type VariantIdx } from "../layout.ts";
import { WrappingRange } from "../wrapping_range.ts";

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
/** derive(PartialEq) */
function SavedLocalEligibility_eq(a: SavedLocalEligibility, b: SavedLocalEligibility): boolean {
  switch (a.$) {
    case "Unassigned":
      return b.$ === "Unassigned";
    case "Assigned":
      return b.$ === "Assigned" && a._0 === b._0;
    case "Ineligible":
      return b.$ === "Ineligible" && a._0 === b._0;
  }
}

/// Compute the eligibility and assignment of each local.
// rustc: compiler/rustc_abi/src/layout/coroutine.rs:42 coroutine_saved_local_eligibility
export function coroutine_saved_local_eligibility<LocalIdx extends number>(
  nb_locals: number,
  variant_fields: readonly (readonly LocalIdx[])[],
  storage_conflicts: BitMatrix<LocalIdx, LocalIdx>,
): [DenseBitSet<LocalIdx>, SavedLocalEligibility[]] {
  // use SavedLocalEligibility::*;

  const assignments: SavedLocalEligibility[] = new Array<SavedLocalEligibility>(nb_locals).fill(SavedLocalEligibility.Unassigned);

  // The saved locals not eligible for overlap. These will get
  // "promoted" to the prefix of our coroutine.
  const ineligible_locals = DenseBitSet.new_empty<LocalIdx>(nb_locals);

  // Figure out which of our saved locals are fields in only
  // one variant. The rest are deemed ineligible for overlap.
  for (let variant_index = 0; variant_index < variant_fields.length; variant_index++) {
    const fields = variant_fields[variant_index]!;
    for (const local of fields) {
      const assignment = assignments[local]!;
      switch (assignment.$) {
        case "Unassigned":
          assignments[local] = { $: "Assigned", _0: variant_index as VariantIdx };
          break;
        case "Assigned":
          // We've already seen this local at another suspension
          // point, so it is no longer a candidate.
          // trace!("removing local {:?} in >1 variant ({:?}, {:?})", local, variant_index, idx);
          ineligible_locals.insert(local);
          assignments[local] = { $: "Ineligible", _0: undefined };
          break;
        case "Ineligible":
          break;
      }
    }
  }

  // Next, check every pair of eligible locals to see if they
  // conflict.
  for (const local_a of storage_conflicts.rows()) {
    const conflicts_a = storage_conflicts.count(local_a);
    if (ineligible_locals.contains(local_a)) {
      continue;
    }

    for (const local_b of storage_conflicts.iter(local_a)) {
      // local_a and local_b are storage live at the same time, therefore they
      // cannot overlap in the coroutine layout. The only way to guarantee
      // this is if they are in the same variant, or one is ineligible
      // (which means it is stored in every variant).
      if (ineligible_locals.contains(local_b) || SavedLocalEligibility_eq(assignments[local_a]!, assignments[local_b]!)) {
        continue;
      }

      // If they conflict, we will choose one to make ineligible.
      // This is not always optimal; it's just a greedy heuristic that
      // seems to produce good results most of the time.
      const conflicts_b = storage_conflicts.count(local_b);
      const [remove, _other] = conflicts_a > conflicts_b ? [local_a, local_b] : [local_b, local_a];
      ineligible_locals.insert(remove);
      assignments[remove] = { $: "Ineligible", _0: undefined };
      // trace!("removing local {:?} due to conflict with {:?}", remove, other);
    }
  }

  // Count the number of variants in use. If only one of them, then it is
  // impossible to overlap any locals in our layout. In this case it's
  // always better to make the remaining locals ineligible, so we can
  // lay them out with the other locals in the prefix and eliminate
  // unnecessary padding bytes.
  {
    const used_variants = DenseBitSet.new_empty<VariantIdx>(variant_fields.length);
    for (const assignment of assignments) {
      if (assignment.$ === "Assigned") {
        used_variants.insert(assignment._0);
      }
    }
    if (used_variants.count() < 2) {
      for (let i = 0; i < assignments.length; i++) {
        assignments[i] = { $: "Ineligible", _0: undefined };
      }
      // PORT (abi-layout-b): `DenseBitSet::insert_all` (rustc_index bit_set.rs:210, not ported in rustc_index
      // bit_set.ts, which this lane does not own) written out: `self.words.fill(!0); self.clear_excess_bits();`.
      ineligible_locals.words.fill((1n << 64n) - 1n);
      ineligible_locals.clear_excess_bits();
    }
  }

  // Write down the order of our locals that will be promoted to the prefix.
  {
    let idx = 0;
    for (const local of ineligible_locals.iter()) {
      assignments[local] = { $: "Ineligible", _0: FieldIdx.new(idx) };
      idx++;
    }
  }
  // debug!("coroutine saved local assignments: {:?}", assignments);

  return [ineligible_locals, assignments];
}

/** PORT (abi-layout-b): `IndexSlice::invert_bijective_mapping` (rustc_index slice.rs:185, not ported: rustc_index has
 * no slice.ts and this lane does not own it), written out; its two `debug_assert_eq!`s are off in rustc. */
function invert_bijective_mapping(self: readonly number[]): number[] {
  const inverse: number[] = new Array<number>(self.length).fill(0);
  for (let i1 = 0; i1 < self.length; i1++) {
    const i2 = self[i1]!;
    inverse[i2] = i1;
  }
  return inverse;
}

/** PORT (abi-layout-b): `ReprOptions::default()` (`#[derive(Default)]`, lib.rs:152; lib.ts has no `default`). */
function repr_options_default(): ReprOptions {
  return new ReprOptions(undefined, undefined, undefined, ReprFlags.empty(), undefined, Hash64.default());
}

/// Compute the full coroutine layout.
// rustc: compiler/rustc_abi/src/layout/coroutine.rs:139 layout
export function layout<F extends DerefLayoutData, LocalIdx extends number>(
  calc: LayoutCalculator<HasDataLayout>,
  local_layouts: readonly F[],
  prefix_layouts: F[],
  variant_fields: readonly (readonly LocalIdx[])[],
  storage_conflicts: BitMatrix<LocalIdx, LocalIdx>,
  tag_to_layout: (tag: Scalar) => F,
): LayoutCalculatorResult<F> {
  // use SavedLocalEligibility::*;

  const [ineligible_locals, assignments] = coroutine_saved_local_eligibility(local_layouts.length, variant_fields, storage_conflicts);

  // Build a prefix layout, including "promoting" all ineligible
  // locals as part of the prefix. We compute the layout of all of
  // these fields at once to get optimal packing.
  const tag_index = FieldIdx.new(prefix_layouts.length);

  // `variant_fields` already accounts for the reserved variants, so no need to add them.
  // PORT: `(variant_fields.len() - 1) as u128` wraps like the `usize` subtraction (rustc has no overflow checks).
  const max_discr = BigInt.asUintN(64, BigInt(variant_fields.length) - 1n);
  const discr_int = Integer.fit_unsigned(max_discr);
  const tag: Scalar = {
    $: "Initialized",
    value: { $: "Int", _0: discr_int, _1: /* signed = */ false },
    valid_range: new WrappingRange(0n, max_discr),
  };

  // PORT: the lazy `promoted_layouts` iterator is consumed by `extend` right after the `push`.
  prefix_layouts.push(tag_to_layout(tag));
  for (const local of ineligible_locals.iter()) prefix_layouts.push(local_layouts[local]!);
  const prefix_r = calc.layout_of_univariant(prefix_layouts, repr_options_default(), StructKind.AlwaysSized);
  if (prefix_r.$ === "Err") return prefix_r;
  const prefix = prefix_r._0;

  const [prefix_size, prefix_align] = [prefix.size, prefix.align];

  // Split the prefix layout into the "outer" fields (upvars and
  // discriminant) and the "promoted" fields. Promoted fields will
  // get included in each variant that requested them in
  // CoroutineLayout.
  // debug!("prefix = {:#?}", prefix);
  let outer_fields: FieldsShape;
  let promoted_offsets: readonly Size[];
  let promoted_memory_index: number[];
  switch (prefix.fields.$) {
    case "Arbitrary": {
      const { offsets, in_memory_order } = prefix.fields;
      // "a" (`0..b_start`) and "b" (`b_start..`) correspond to
      // "outer" and "promoted" fields respectively.
      const b_start = FieldIdx.new(tag_index + 1);
      const offsets_b = offsets.slice(b_start);
      const offsets_a = offsets.slice(0, b_start);

      // Disentangle the "a" and "b" components of `in_memory_order`
      // by preserving the order but keeping only one disjoint "half" each.
      // FIXME(eddyb) build a better abstraction for permutations, if possible.
      const in_memory_order_a: FieldIdx[] = [];
      const in_memory_order_b: FieldIdx[] = [];
      for (const i of in_memory_order) {
        if (i >= b_start) {
          const j = i - b_start;
          in_memory_order_b.push(FieldIdx.new(j));
        } else {
          in_memory_order_a.push(i);
        }
      }

      outer_fields = { $: "Arbitrary", offsets: offsets_a, in_memory_order: in_memory_order_a };
      [promoted_offsets, promoted_memory_index] = [offsets_b, invert_bijective_mapping(in_memory_order_b)];
      break;
    }
    default:
      return unreachable();
  }

  let size = prefix.size;
  let align = prefix.align;
  const variants: VariantLayout[] = [];
  for (let index_ = 0; index_ < variant_fields.length; index_++) {
    const index = index_ as VariantIdx;
    const variant_fields_ = variant_fields[index]!;
    // Only include overlap-eligible fields when we compute our variant layout.
    const variant_only_tys = variant_fields_
      .filter((local) => {
        const a = assignments[local]!;
        switch (a.$) {
          case "Unassigned":
            return unreachable();
          case "Assigned":
            if (a._0 === index) return true;
            return unreachable("internal error: entered unreachable code: assignment does not match variant");
          case "Ineligible":
            return false;
        }
      })
      .map((local) => local_layouts[local]!);

    const variant_r = calc.layout_of_univariant(variant_only_tys, repr_options_default(), { $: "Prefixed", _0: prefix_size, _1: prefix_align.abi });
    if (variant_r.$ === "Err") return variant_r;
    const variant = variant_r._0;

    if (variant.fields.$ !== "Arbitrary") {
      return unreachable();
    }
    const { offsets, in_memory_order } = variant.fields;

    // Now, stitch the promoted and variant-only fields back together in
    // the order they are mentioned by our CoroutineLayout.
    // Because we only use some subset (that can differ between variants)
    // of the promoted fields, we can't just pick those elements of the
    // `promoted_memory_index` (as we'd end up with gaps).
    // So instead, we build an "inverse memory_index", as if all of the
    // promoted fields were being used, but leave the elements not in the
    // subset as `invalid_field_idx`, which we can filter out later to
    // obtain a valid (bijective) mapping.
    const memory_index = invert_bijective_mapping(in_memory_order);
    const invalid_field_idx = promoted_memory_index.length + memory_index.length;
    let combined_in_memory_order: FieldIdx[] = new Array<FieldIdx>(invalid_field_idx).fill(FieldIdx.new(invalid_field_idx));

    // `iter::zip(offsets, memory_index)`
    let zip_i = 0;
    const zip_len = Math.min(offsets.length, memory_index.length);
    const combined_offsets: Size[] = variant_fields_.map((local, i) => {
      let offset: Size;
      let memory_index_: number;
      const a = assignments[local]!;
      switch (a.$) {
        case "Unassigned":
          return unreachable();
        case "Assigned": {
          const [o, mi] = unwrap(zip_i < zip_len ? ([offsets[zip_i]!, memory_index[zip_i]!] as const) : undefined);
          zip_i++;
          [offset, memory_index_] = [o, promoted_memory_index.length + mi];
          break;
        }
        case "Ineligible": {
          const field_idx = unwrap(a._0);
          [offset, memory_index_] = [promoted_offsets[field_idx]!, promoted_memory_index[field_idx]!];
          break;
        }
      }
      combined_in_memory_order[memory_index_] = i as FieldIdx;
      return offset;
    });

    // Remove the unused slots to obtain the combined `in_memory_order`
    // (also see previous comment).
    combined_in_memory_order = combined_in_memory_order.filter((i) => i !== invalid_field_idx);

    variant.fields = {
      $: "Arbitrary",
      offsets: combined_offsets,
      in_memory_order: combined_in_memory_order,
    };

    // `Ord::max` returns `other` on ties
    size = variant.size.bytes() >= size.bytes() ? variant.size : size;
    align = align.max(variant.align);
    variants.push(VariantLayout.from_layout(variant));
  }

  size = size.align_to(align.abi);

  const uninhabited = prefix.uninhabited || variants.every((v) => v.is_uninhabited());
  const abi: BackendRepr = { $: "Memory", sized: true };

  const variants_: Variants = {
    $: "Multiple",
    tag,
    tag_encoding: TagEncoding.Direct,
    tag_field: tag_index,
    variants,
  };
  return Ok(
    new LayoutData(
      outer_fields,
      variants_,
      abi,
      // Suppress niches inside coroutines. If the niche is inside a field that is aliased (due to
      // self-referentiality), getting the discriminant can cause aliasing violations.
      // `UnsafeCell` blocks niches for the same reason, but we don't yet have `UnsafePinned` that
      // would do the same for us here.
      // See <https://github.com/rust-lang/rust/issues/63818>, <https://github.com/rust-lang/miri/issues/3780>.
      // FIXME: Remove when <https://github.com/rust-lang/rust/issues/125735> is implemented and aliased coroutine fields are wrapped in `UnsafePinned`.
      /* largest_niche */ undefined,
      uninhabited,
      align,
      size,
      /* max_repr_align */ undefined,
      /* unadjusted_abi_align */ align.abi,
      /* repr_c */ false,
      /* randomization_seed */ Hash64.default(),
    ),
  );
}
