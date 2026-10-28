// Port of compiler/rustc_mir_transform/src/check_pointers.rs (lane mt-kpl-ubchecks).
//
// PORT: `PointerFinder` is a class extending rustc_middle mir/visit.ts's `Visitor` (D4). `IndexVec<BasicBlock, _>` /
// `IndexVec<Local, _>` are arrays indexed by the handle (PORTING §5); `IndexVec::push` is rustc_index's
// `IndexVec.push` (returns the new index).
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { IndexVec } from "../rustc_index/vec.ts";
import {
  type AssertKind,
  BasicBlock,
  BasicBlockData,
  type Body,
  type LocalDecl,
  Location,
  type Operand,
  type Place,
  Place_from_Local,
  type SourceInfo,
  type Statement,
  Terminator,
  UnwindAction,
} from "../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";

// rustc-type: compiler/rustc_mir_transform/src/check_pointers.rs:10 PointerCheck
/// Details of a pointer check, the condition on which we decide whether to
/// fail the assert and an [AssertKind] that defines the behavior on failure.
export interface PointerCheck {
  cond: Operand;
  assert_kind: AssertKind<Operand>;
}

// rustc-type: compiler/rustc_mir_transform/src/check_pointers.rs:19 BorrowedFieldProjectionMode
/// When checking for borrows of field projections (`&(*ptr).a`), we might want
/// to check for the field type (type of `.a` in the example). This enum defines
/// the variations (pass the pointer [Ty] or the field [Ty]).
// #[derive(Copy, Clone)]
export type BorrowedFieldProjectionMode = "FollowProjections" | "NoFollowProjections";
export const BorrowedFieldProjectionMode = {
  FollowProjections: "FollowProjections",
  NoFollowProjections: "NoFollowProjections",
} as const;

/** The `F: Fn(..) -> PointerCheck` callback of `check_pointers`. */
export type OnFinding = (
  /* tcx: */ tcx: TyCtxt,
  /* pointer: */ pointer: Place,
  /* pointee_ty: */ pointee_ty: Ty,
  /* context: */ context: PlaceContext,
  /* local_decls: */ local_decls: LocalDecl[],
  /* stmts: */ stmts: Statement[],
  /* source_info: */ source_info: SourceInfo,
) => PointerCheck;

/// Utility for adding a check for read/write on every sized, raw pointer.
///
/// Visits every read/write access to a [Sized], raw pointer and inserts a
/// new basic block directly before the pointer access. (Read/write accesses
/// are determined by the `PlaceContext` of the MIR visitor.) Then calls
/// `on_finding` to insert the actual logic for a pointer check (e.g. check for
/// alignment). A check can choose to follow borrows of field projections via
/// the `field_projection_mode` parameter.
///
/// This utility takes care of the right order of blocks, the only thing a
/// caller must do in `on_finding` is:
/// - Append [Statement]s to `stmts`.
/// - Append [LocalDecl]s to `local_decls`.
/// - Return a [PointerCheck] that contains the condition and an [AssertKind].
///   The AssertKind must be a panic with `#[rustc_nounwind]`. The condition
///   should always return the boolean `is_ok`, so evaluate to true in case of
///   success and fail the check otherwise.
/// This utility will insert a terminator block that asserts on the condition
/// and panics on failure.
// rustc: compiler/rustc_mir_transform/src/check_pointers.rs:43 check_pointers
export function check_pointers(
  tcx: TyCtxt,
  body: Body,
  excluded_pointees: readonly Ty[],
  on_finding: OnFinding,
  field_projection_mode: BorrowedFieldProjectionMode,
): void {
  // This pass emits new panics. If for whatever reason we do not have a panic
  // implementation, running this pass may cause otherwise-valid code to not compile.
  if (tcx.lang_items().get(LangItem.PanicImpl) === undefined) {
    return;
  }

  const typing_env = body.typing_env(tcx);
  const basic_blocks = body.basic_blocks.as_mut();
  const local_decls = body.local_decls;

  // This operation inserts new blocks. Each insertion changes the Location for all
  // statements/blocks after. Iterating or visiting the MIR in order would require updating
  // our current location after every insertion. By iterating backwards, we dodge this issue:
  // The only Locations that an insertion changes have already been handled.
  // PORT: `basic_blocks.indices().rev()` is evaluated once, before any insertion.
  for (let b = basic_blocks.length - 1; b >= 0; b--) {
    const block = BasicBlock.from_usize(b);
    for (let statement_index = basic_blocks[block]!.statements.length - 1; statement_index >= 0; statement_index--) {
      const location = new Location(block, statement_index);
      const statement = basic_blocks[block]!.statements[statement_index]!;
      const source_info = statement.source_info;

      const finder = PointerFinder.new(tcx, local_decls, typing_env, excluded_pointees, field_projection_mode);
      finder.visit_statement(statement, location);

      for (const [local, ty, context] of finder.into_found_pointers()) {
        // debug!("Inserting check for {:?}", ty);
        const new_block = split_block(basic_blocks, location);

        // Invoke `on_finding` which appends to `local_decls` and the
        // blocks statements. It returns information about the assert
        // we're performing in the Terminator.
        const block_data = basic_blocks[block]!;
        const pointer_check = on_finding(tcx, local, ty, context, local_decls, block_data.statements, source_info);
        block_data.terminator = new Terminator(source_info, {
          $: "Assert",
          cond: pointer_check.cond,
          expected: true,
          target: new_block,
          msg: pointer_check.assert_kind,
          // This calls a panic function associated with the pointer check, which
          // is #[rustc_nounwind]. We never want to insert an unwind into unsafe
          // code, because unwinding could make a failing UB check turn into much
          // worse UB when we start unwinding.
          unwind: UnwindAction.Unreachable,
        });
      }
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/check_pointers.rs:125 PointerFinder
class PointerFinder extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public local_decls: LocalDecl[],
    public typing_env: TypingEnv,
    public pointers: [Place, Ty, PlaceContext][],
    public excluded_pointees: readonly Ty[],
    public field_projection_mode: BorrowedFieldProjectionMode,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/check_pointers.rs:135 new
  static new(
    tcx: TyCtxt,
    local_decls: LocalDecl[],
    typing_env: TypingEnv,
    excluded_pointees: readonly Ty[],
    field_projection_mode: BorrowedFieldProjectionMode,
  ): PointerFinder {
    return new PointerFinder(tcx, local_decls, typing_env, [], excluded_pointees, field_projection_mode);
  }

  // rustc: compiler/rustc_mir_transform/src/check_pointers.rs:152 into_found_pointers
  into_found_pointers(): [Place, Ty, PlaceContext][] {
    return this.pointers;
  }

  /// Whether or not we should visit a [Place] with [PlaceContext].
  ///
  /// We generally only visit Reads/Writes to a place and only Borrows if
  /// requested.
  // rustc: compiler/rustc_mir_transform/src/check_pointers.rs:160 should_visit_place
  should_visit_place(context: PlaceContext): boolean {
    if (
      context.$ === "MutatingUse" &&
      (context._0 === "Store" ||
        context._0 === "Call" ||
        context._0 === "Yield" ||
        context._0 === "Drop" ||
        context._0 === "Borrow")
    ) {
      return true;
    } else if (
      context.$ === "NonMutatingUse" &&
      (context._0 === "Copy" || context._0 === "Move" || context._0 === "SharedBorrow")
    ) {
      return true;
    } else {
      return false;
    }
  }

  // impl<'a, 'tcx> Visitor<'tcx> for PointerFinder<'a, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/check_pointers.rs:180 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    if (!this.should_visit_place(context) || !place.is_indirect()) {
      return;
    }

    // Get the place and type we visit.
    const pointer = Place_from_Local(place.local);
    const pointer_ty = pointer.ty(this.local_decls, this.tcx).ty;

    // We only want to check places based on raw pointers
    const pointer_kind = pointer_ty.kind();
    if (pointer_kind.$ !== "RawPtr") {
      // trace!("Indirect, but not based on an raw ptr, not checking {:?}", place);
      return;
    }
    let pointee_ty = pointer_kind._0;

    // If we see a borrow of a field projection, we want to pass the field type to the
    // check and not the pointee type.
    if (
      this.field_projection_mode === "FollowProjections" &&
      ((context.$ === "NonMutatingUse" && context._0 === "SharedBorrow") ||
        (context.$ === "MutatingUse" && context._0 === "Borrow"))
    ) {
      // Naturally, the field type is type of the initial place we look at.
      pointee_ty = place.ty(this.local_decls, this.tcx).ty;
    }

    // Ideally we'd support this in the future, but for now we are limited to sized types.
    if (!pointee_ty.is_sized(this.tcx, this.typing_env)) {
      // trace!("Raw pointer, but pointee is not known to be sized: {:?}", pointer_ty);
      return;
    }

    // We don't need to look for slices, we already rejected unsized types above.
    const pointee_kind = pointee_ty.kind();
    const element_ty = pointee_kind.$ === "Array" ? pointee_kind._0 : pointee_ty;
    // Check if we excluded this pointee type from the check.
    if (this.excluded_pointees.includes(element_ty)) {
      // trace!("Skipping pointer for type: {:?}", pointee_ty);
      return;
    }

    this.pointers.push([pointer, pointee_ty, context]);

    this.super_place(place, context, location);
  }
}

// rustc: compiler/rustc_mir_transform/src/check_pointers.rs:231 split_block
function split_block(basic_blocks: BasicBlockData[], location: Location): BasicBlock {
  const block_data = basic_blocks[location.block]!;

  // Drain every statement after this one and move the current terminator to a new basic block.
  // `block_data.terminator.take()`
  const terminator = block_data.terminator;
  block_data.terminator = undefined;
  const new_block = BasicBlockData.new_stmts(
    block_data.statements.splice(location.statement_index),
    terminator,
    block_data.is_cleanup,
  );

  return IndexVec.push<BasicBlock, BasicBlockData>(basic_blocks, new_block);
}
