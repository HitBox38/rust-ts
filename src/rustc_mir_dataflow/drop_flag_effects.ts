// Port of compiler/rustc_mir_dataflow/src/drop_flag_effects.rs (declared by lane dataflow-contract, filled by lane
// dataflow-move-paths, plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it):
// - `DropFlagState` is a string union with its companion (`DropFlagState.value(s)`); `InactiveVariants` is a
//   `$`-tagged union (`SmallVec<[VariantIdx; 4]>` is an array) with `contains` on its companion.
// - `F: FnMut(..)` / `impl FnMut(..)` callbacks are closures. The nested fn `on_all_children_bits` inside
//   `on_all_children_bits` (drop_flag_effects.rs:72) is a nested function of its parent (`each_child: &mut F` is the
//   same closure).
// - PORT: `debug!` calls (compiled out of release rustc) are comments.
// - `body.stmt_at(loc).right()` / `body.args_iter()` / `Place::from(local)` / `place.as_ref()` are mir-contract's.
import type { VariantIdx } from "../rustc_abi/layout.ts";
import { assert_eq, unreachable, unwrap } from "../std/panic.ts";
import { type LookupResult, type MoveData, MoveOutIndex, type MovePathIndex } from "./move_paths/mod.ts";
import { type Body, type Location, type Place, type PlaceElem, Place_from_Local } from "../rustc_middle/mir/mod.ts";

/// The value of an inserted drop flag.
// #[derive(Debug, PartialEq, Eq, Copy, Clone)]
// rustc-type: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:10 DropFlagState
export type DropFlagState =
  /// The tracked value is initialized and needs to be dropped when leaving its scope.
  | "Present"

  /// The tracked value is uninitialized or was moved out of and does not need to be dropped when
  /// leaving its scope.
  | "Absent";

export const DropFlagState = {
  Present: "Present",
  Absent: "Absent",

  // rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:20 value
  value(self: DropFlagState): boolean {
    switch (self) {
      case "Present":
        return true;
      case "Absent":
        return false;
    }
  },
} as const;

// rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:28 move_path_children_matching
export function move_path_children_matching(
  move_data: MoveData,
  path: MovePathIndex,
  cond: (elem: PlaceElem) => boolean,
): MovePathIndex | undefined {
  let next_child = move_data.move_paths[path]!.first_child;
  while (next_child !== undefined) {
    const child_index = next_child;
    const move_path_children = move_data.move_paths[child_index]!;
    const projection = move_path_children.place.projection;
    if (projection.length > 0) {
      const elem = projection[projection.length - 1]!;
      if (cond(elem)) {
        return child_index;
      }
    }
    next_child = move_path_children.next_sibling;
  }

  return undefined;
}

// rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:50 on_lookup_result_bits
export function on_lookup_result_bits(
  move_data: MoveData,
  lookup_result: LookupResult,
  each_child: (mpi: MovePathIndex) => void,
): void {
  switch (lookup_result.$) {
    case "Parent":
      // access to untracked value - do not touch children
      break;
    case "Exact": {
      const e = lookup_result._0;
      on_all_children_bits(move_data, e, each_child);
      break;
    }
  }
}

// rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:65 on_all_children_bits
export function on_all_children_bits(
  move_data: MoveData,
  move_path_index: MovePathIndex,
  each_child: (mpi: MovePathIndex) => void,
): void {
  // rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:72 on_all_children_bits
  function on_all_children_bits(
    move_data: MoveData,
    move_path_index: MovePathIndex,
    each_child: (mpi: MovePathIndex) => void,
  ): void {
    each_child(move_path_index);

    let next_child_index = move_data.move_paths[move_path_index]!.first_child;
    while (next_child_index !== undefined) {
      const child_index = next_child_index;
      on_all_children_bits(move_data, child_index, each_child);
      next_child_index = move_data.move_paths[child_index]!.next_sibling;
    }
  }
  on_all_children_bits(move_data, move_path_index, each_child);
}

/// Calls `callback` for each child move path of the function's arguments. Note the move paths'
/// `DropFlagState` argument to the callback will always be `DropFlagState::Present`.
// rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:92 drop_flag_effects_for_function_entry
export function drop_flag_effects_for_function_entry(
  body: Body,
  move_data: MoveData,
  callback: (mpi: MovePathIndex, state: DropFlagState) => void,
): void {
  for (const arg of body.args_iter()) {
    const place = Place_from_Local(arg);
    const lookup_result = move_data.rev_lookup.find(place.as_ref());
    on_lookup_result_bits(move_data, lookup_result, (mpi) => callback(mpi, DropFlagState.Present));
  }
}

// rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:108 drop_flag_effects_for_location
export function drop_flag_effects_for_location(
  body: Body,
  move_data: MoveData,
  loc: Location,
  callback: (mpi: MovePathIndex, state: DropFlagState) => void,
): void {
  // debug!("drop_flag_effects_for_location({:?})", loc);

  // first, move out of the RHS
  for (const mi of move_data.move_out_loc_map.index(loc)) {
    const path = MoveOutIndex.move_path_index(mi, move_data);
    // debug!("moving out of path {:?}", move_data.move_paths[path]);

    on_all_children_bits(move_data, path, (mpi) => callback(mpi, DropFlagState.Absent));
  }

  // Drop does not count as a move but we should still consider the variable uninitialized.
  const stmt = body.stmt_at(loc);
  let mpi_: LookupResult;
  if (
    stmt.$ === "Right" &&
    stmt._0.kind.$ === "Drop" &&
    (mpi_ = move_data.rev_lookup.find(stmt._0.kind.place.as_ref())).$ === "Exact"
  ) {
    const mpi = mpi_._0;
    on_all_children_bits(move_data, mpi, (mpi) => callback(mpi, DropFlagState.Absent));
  }

  // debug!("drop_flag_effects: assignment for location({:?})", loc);

  for_location_inits(move_data, loc, (mpi) => callback(mpi, DropFlagState.Present));
}

// rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:139 for_location_inits
function for_location_inits(move_data: MoveData, loc: Location, callback: (mpi: MovePathIndex) => void): void {
  for (const ii of move_data.init_loc_map.index(loc)) {
    const init = move_data.inits[ii]!;
    switch (init.kind) {
      case "Deep": {
        const path = init.path;

        on_all_children_bits(move_data, path, callback);
        break;
      }
      case "Shallow": {
        const mpi = init.path;
        callback(mpi);
        break;
      }
      case "NonPanicPathOnly":
        break;
    }
  }
}

/// Indicates which variants are inactive at a `SwitchInt` edge by listing their `VariantIdx`s or
/// specifying the single active variant's `VariantIdx`.
// rustc-type: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:162 InactiveVariants
export type InactiveVariants =
  | { readonly $: "Inactives"; readonly _0: readonly VariantIdx[] }
  | { readonly $: "Active"; readonly _0: VariantIdx };

export const InactiveVariants = {
  // rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:168 contains
  contains(self: InactiveVariants, variant_idx: VariantIdx): boolean {
    switch (self.$) {
      case "Inactives": {
        const inactives = self._0;
        return inactives.includes(variant_idx);
      }
      case "Active": {
        const active = self._0;
        return variant_idx !== active;
      }
    }
  },
};

/// Calls `handle_inactive_variant` for each child move path of `enum_place` corresponding to an
/// inactive variant at a particular `SwitchInt` edge.
// rustc: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:178 on_all_inactive_variants
export function on_all_inactive_variants(
  move_data: MoveData,
  enum_place: Place,
  inactive_variants: InactiveVariants,
  handle_inactive_variant: (mpi: MovePathIndex) => void,
): void {
  const r = move_data.rev_lookup.find(enum_place.as_ref());
  if (r.$ !== "Exact") {
    return;
  }
  const enum_mpi = r._0;

  const enum_path = move_data.move_paths[enum_mpi]!;
  for (const [variant_mpi, variant_path] of enum_path.children(move_data.move_paths)) {
    // Because of the way we build the `MoveData` tree, each child should have exactly one more
    // projection than `enum_place`. This additional projection must be a downcast since the
    // base is an enum.
    const projection = variant_path.place.projection;
    const downcast = unwrap(projection.length > 0 ? projection[projection.length - 1] : undefined);
    const base_proj_len = projection.length - 1;
    assert_eq(enum_place.projection.length, base_proj_len, String);

    if (downcast.$ !== "Downcast") {
      unreachable();
    }
    const variant_idx = downcast._1;

    if (InactiveVariants.contains(inactive_variants, variant_idx)) {
      on_all_children_bits(move_data, variant_mpi, (mpi) => handle_inactive_variant(mpi));
    }
  }
}
