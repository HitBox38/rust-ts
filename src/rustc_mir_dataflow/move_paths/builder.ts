// Port of compiler/rustc_mir_dataflow/src/move_paths/builder.rs: DECLARED (lane dataflow-contract). Every fn is a stub
// for lane `dataflow-move-paths` (plan-m4 §5 wave 22).
//
// Representation (fill lanes keep it):
// - `MoveDataBuilder<'a, 'tcx, F>` is a class with its fields in declaration order; `F: Fn(Ty) -> bool` is the closure
//   `filter`. Its three `impl` blocks are one class body (PORTING §8), markers keep the upstream lines.
// - `G: FnMut(&mut Self, MovePathIndex)` / `impl FnOnce(TyCtxt) -> Place` are closures (`on_move(this, mpi)`).
// - `IndexVec::push` returns the new index (`arr.push(x) - 1`); `mem::replace(&mut a, b)` reads then writes;
//   `projections.entry((base, elem)).or_insert_with(..)` keys `MovePathLookup.projections` by `MoveSubPath_key`.
// - `pub(super) fn gather_moves` is called by `MoveData.gather_moves` (mod.ts).
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { Body, Location, Operand, Place, PlaceRef, Rvalue, Statement, Terminator } from "../../rustc_middle/mir/mod.ts";
import type { InitIndex, InitKind, MoveData, MoveOutIndex, MovePath, MovePathIndex, MoveSubPath } from "./mod.ts";

// rustc-type: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:16 MoveDataBuilder
class MoveDataBuilder {
  constructor(
    public body: Body,
    public loc: Location,
    public tcx: TyCtxt,
    public data: MoveData,
    public filter: (ty: Ty) => boolean,
  ) {}

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:25 new (lane dataflow-move-paths)
  static new(_body: Body, _tcx: TyCtxt, _filter: (ty: Ty) => boolean): MoveDataBuilder {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::new");
  }

  /// This creates a MovePath for a given place, calling `on_move`
  /// if it can be moved from. If theres a union in the path, its
  /// move place will be given to `on_move`. If there's a subslice
  /// projection, `on_move` will be called for each element.
  ///
  /// NOTE: places behind references *do not* get a move path, which is
  /// problematic for borrowck.
  ///
  /// Maybe we should have separate "borrowck" and "moveck" modes.
  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:108 move_path_for (lane dataflow-move-paths)
  move_path_for(_place: Place, _on_move: (this_: MoveDataBuilder, mpi: MovePathIndex) => void): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::move_path_for");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:302 add_move_path (lane dataflow-move-paths)
  add_move_path(_base: MovePathIndex, _elem: MoveSubPath, _mk_place: (tcx: TyCtxt) => Place): MovePathIndex {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::add_move_path");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:318 create_move_path (lane dataflow-move-paths)
  create_move_path(_place: Place): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::create_move_path");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:324 finalize (lane dataflow-move-paths)
  finalize(): MoveData {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::finalize");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:364 gather_args (lane dataflow-move-paths)
  gather_args(): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::gather_args");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:380 gather_statement (lane dataflow-move-paths)
  gather_statement(_stmt: Statement): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::gather_statement");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:424 gather_rvalue (lane dataflow-move-paths)
  gather_rvalue(_rvalue: Rvalue): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::gather_rvalue");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:449 gather_terminator (lane dataflow-move-paths)
  gather_terminator(_term: Terminator): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::gather_terminator");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:540 gather_operand (lane dataflow-move-paths)
  gather_operand(_operand: Operand): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::gather_operand");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:551 gather_move (lane dataflow-move-paths)
  gather_move(_place: Place): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::gather_move");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:556 record_move (lane dataflow-move-paths)
  record_move(_place: Place, _path: MovePathIndex): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::record_move");
  }

  // stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:566 gather_init (lane dataflow-move-paths)
  gather_init(_place: PlaceRef, _kind: InitKind): void {
    return unported("rustc_mir_dataflow::move_paths::builder::MoveDataBuilder::gather_init");
  }
}

// stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:74 new_move_path (lane dataflow-move-paths)
function new_move_path(
  _move_paths: MovePath[],
  _move_out_path_map: MoveOutIndex[][],
  _init_path_map: InitIndex[][],
  _parent: MovePathIndex | undefined,
  _place: Place,
): MovePathIndex {
  return unported("rustc_mir_dataflow::move_paths::builder::new_move_path");
}

// stub: compiler/rustc_mir_dataflow/src/move_paths/builder.rs:341 gather_moves (lane dataflow-move-paths)
export function gather_moves(_body: Body, _tcx: TyCtxt, _filter: (ty: Ty) => boolean): MoveData {
  return unported("rustc_mir_dataflow::move_paths::builder::gather_moves");
}

/** Keeps the module-private declarations referenced for the fill lane. */
export const _builder_decls = { MoveDataBuilder, new_move_path };
