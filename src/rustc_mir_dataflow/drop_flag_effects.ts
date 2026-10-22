// Port of compiler/rustc_mir_dataflow/src/drop_flag_effects.rs: DECLARED (lane dataflow-contract). Every fn is a stub
// for lane `dataflow-move-paths` (plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it):
// - `DropFlagState` is a string union with its companion (`DropFlagState.value(s)`); `InactiveVariants` is a
//   `$`-tagged union (`SmallVec<[VariantIdx; 4]>` is an array) with `contains` on its companion.
// - `F: FnMut(..)` / `impl FnMut(..)` callbacks are closures. The nested fn `on_all_children_bits` inside
//   `on_all_children_bits` (drop_flag_effects.rs:72) is the module-level stub `on_all_children_bits_inner` until the
//   fill lane moves it inside its parent (`each_child: &mut F` is the same closure).
// - `body.stmt_at(loc).right()` / `body.args_iter()` / `Place::from(local)` / `place.as_ref()` are mir-contract's.
import type { VariantIdx } from "../rustc_abi/layout.ts";
import { unported } from "../std/panic.ts";
import type { LookupResult, MoveData, MovePathIndex } from "./move_paths/mod.ts";
import type { Body, Location, Place, PlaceElem } from "../rustc_middle/mir/mod.ts";

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

  // stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:20 value (lane dataflow-move-paths)
  value(_self: DropFlagState): boolean {
    return unported("rustc_mir_dataflow::drop_flag_effects::DropFlagState::value");
  },
} as const;

// stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:28 move_path_children_matching (lane dataflow-move-paths)
export function move_path_children_matching(
  _move_data: MoveData,
  _path: MovePathIndex,
  _cond: (elem: PlaceElem) => boolean,
): MovePathIndex | undefined {
  return unported("rustc_mir_dataflow::drop_flag_effects::move_path_children_matching");
}

// stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:50 on_lookup_result_bits (lane dataflow-move-paths)
export function on_lookup_result_bits(
  _move_data: MoveData,
  _lookup_result: LookupResult,
  _each_child: (mpi: MovePathIndex) => void,
): void {
  return unported("rustc_mir_dataflow::drop_flag_effects::on_lookup_result_bits");
}

// stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:65 on_all_children_bits (lane dataflow-move-paths)
export function on_all_children_bits(
  _move_data: MoveData,
  _move_path_index: MovePathIndex,
  _each_child: (mpi: MovePathIndex) => void,
): void {
  return unported("rustc_mir_dataflow::drop_flag_effects::on_all_children_bits");
}

/** The nested `fn on_all_children_bits` of `on_all_children_bits` (moves inside its parent when ported). */
// stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:72 on_all_children_bits (lane dataflow-move-paths)
function on_all_children_bits_inner(
  _move_data: MoveData,
  _move_path_index: MovePathIndex,
  _each_child: (mpi: MovePathIndex) => void,
): void {
  return unported("rustc_mir_dataflow::drop_flag_effects::on_all_children_bits::on_all_children_bits");
}

/// Calls `callback` for each child move path of the function's arguments. Note the move paths'
/// `DropFlagState` argument to the callback will always be `DropFlagState::Present`.
// stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:92 drop_flag_effects_for_function_entry (lane dataflow-move-paths)
export function drop_flag_effects_for_function_entry(
  _body: Body,
  _move_data: MoveData,
  _callback: (mpi: MovePathIndex, state: DropFlagState) => void,
): void {
  return unported("rustc_mir_dataflow::drop_flag_effects::drop_flag_effects_for_function_entry");
}

// stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:108 drop_flag_effects_for_location (lane dataflow-move-paths)
export function drop_flag_effects_for_location(
  _body: Body,
  _move_data: MoveData,
  _loc: Location,
  _callback: (mpi: MovePathIndex, state: DropFlagState) => void,
): void {
  return unported("rustc_mir_dataflow::drop_flag_effects::drop_flag_effects_for_location");
}

// stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:139 for_location_inits (lane dataflow-move-paths)
function for_location_inits(_move_data: MoveData, _loc: Location, _callback: (mpi: MovePathIndex) => void): void {
  return unported("rustc_mir_dataflow::drop_flag_effects::for_location_inits");
}

/// Indicates which variants are inactive at a `SwitchInt` edge by listing their `VariantIdx`s or
/// specifying the single active variant's `VariantIdx`.
// rustc-type: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:162 InactiveVariants
export type InactiveVariants =
  | { readonly $: "Inactives"; readonly _0: readonly VariantIdx[] }
  | { readonly $: "Active"; readonly _0: VariantIdx };

export const InactiveVariants = {
  // stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:168 contains (lane dataflow-move-paths)
  contains(_self: InactiveVariants, _variant_idx: VariantIdx): boolean {
    return unported("rustc_mir_dataflow::drop_flag_effects::InactiveVariants::contains");
  },
};

/// Calls `handle_inactive_variant` for each child move path of `enum_place` corresponding to an
/// inactive variant at a particular `SwitchInt` edge.
// stub: compiler/rustc_mir_dataflow/src/drop_flag_effects.rs:178 on_all_inactive_variants (lane dataflow-move-paths)
export function on_all_inactive_variants(
  _move_data: MoveData,
  _enum_place: Place,
  _inactive_variants: InactiveVariants,
  _handle_inactive_variant: (mpi: MovePathIndex) => void,
): void {
  return unported("rustc_mir_dataflow::drop_flag_effects::on_all_inactive_variants");
}

/** Keeps the module-private declarations referenced for the fill lane. */
export const _drop_flag_effects_decls = { on_all_children_bits_inner, for_location_inits };
