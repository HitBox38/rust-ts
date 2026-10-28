// Port of compiler/rustc_mir_transform/src/tail_copy_to_move.rs (lane mt-opt2-c).
//
// PORT: `*operand = Operand::Move(place)` replaces the visited operand object in place (`replace_in_place`), keeping
// the same `Place` object (precedent copy_prop.ts).
//! Rewrite final-use copies before return into moves.
//!
//! # The problem
//!
//! MIR building represents reads of values whose type is `Copy` using
//! `Operand::Copy`, including when such a local is returned. If that local's
//! address has ever been observed, `MoveElimination` conservatively considers
//! it live until its `StorageDead` or function exit. This keeps the local live
//! across `_0 = copy local`, so its live range overlaps with the return place
//! and `MoveElimination` cannot unify the source local with `_0`.
//!
//! # The solution
//!
//! At function return, all local allocations are about to become invalid
//! anyway. After borrowck, this pass can therefore turn a final-use `Copy` into
//! a `Move`, as long as shortening the source local's live range has no
//! observable effect before the return happens. Concretely, between the
//! transformed copy (now a move) and the return, there may only be writes to
//! unborrowed locals, storage markers, nops, and gotos.
//!
//! # The algorithm
//!
//! Start from every `Return` terminator, with `_0` treated as used by the
//! return. Then scan predecessor blocks backward through `Goto` edges, forming
//! a return-tail tree. The scan maintains `used_after`, the set of locals
//! accessed later on that path.
//!
//! A `Copy` operand is rewritten to a `Move` when its base local is not in
//! `used_after`. Then any locals touched by that operand, including
//! index-projection locals, are added to `used_after` before the backward scan
//! continues.
//!
//! The scan stops when accessing an indirect place because that may access any
//! borrowed local, which would make the pass unable to prove any useful final
//! uses. It also stops at writes to borrowed locals, because those can create a
//! new address-observed allocation range whose overlap with an earlier borrowed
//! local must be preserved.
import { ControlFlow } from "../rustc_ast_ir/visit.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { type BasicBlock, type Body, type Local, type Operand, type Place, RETURN_PLACE, type Rvalue } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { borrowed_locals } from "../rustc_mir_dataflow/impls/borrowed_locals.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:48 TailCopyToMove
export class TailCopyToMove extends MirPass {
  readonly type_name = "rustc_mir_transform::tail_copy_to_move::TailCopyToMove";

  // rustc: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:51 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2 && ctx.deref().opts.unstable_opts.mir_move_elimination);
  }

  // #[tracing::instrument(level = "trace", skip(self, _tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:58 run_pass
  run_pass(_tcx: TyCtxt, body: Body): void {
    const borrowed = borrowed_locals(body);
    // PORT: `.clone()`: a shallow copy of the cached predecessor lists (not mutated below).
    const predecessors = body.basic_blocks.predecessors().slice();
    const stack: TailState[] = [];

    // A return terminator implicitly uses the return place. Walking
    // backward through assignments records the locals accessed later on
    // this path.
    body.basic_blocks.deref().forEach((data, bb) => {
      if (data.terminator_().kind.$ === "Return") {
        const used_after = DenseBitSet.new_empty<Local>(body.local_decls.length);
        used_after.insert(RETURN_PLACE);
        stack.push({ block: bb as BasicBlock, used_after });
      }
    });

    let state: TailState | undefined;
    while ((state = stack.pop()) !== undefined) {
      // `scan_block` rewrites final-use copies in this block and updates
      // `used_after` to the locals whose allocation is accessed after the
      // block starts. If the block is not pure tail code, this path is
      // done.
      if (scan_block(body, state.block, state.used_after, borrowed).$ === "Break") {
        continue;
      }

      // Continue through predecessor blocks only when the predecessor's
      // terminator is a plain `Goto` to this block. Other terminators are
      // control-flow or effect boundaries.
      let first: BasicBlock | undefined;
      for (const pred of predecessors[state.block]!) {
        const terminator = body.basic_blocks.deref()[pred]!.terminator_();
        if (terminator.kind.$ === "Goto") {
          // debug_assert_eq!(target, state.block);
          if (first === undefined) {
            first = pred;
          } else {
            stack.push({ block: pred, used_after: state.used_after.clone() });
          }
        }
      }

      // Avoid cloning the bitset for the first predecessor.
      if (first !== undefined) {
        stack.push({ block: first, used_after: state.used_after });
      }
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:107 TailState
interface TailState {
  block: BasicBlock;
  used_after: DenseBitSet<Local>;
}

/// Scan a block backward while the return-tail invariant still holds.
///
/// The invariant is that a whole-local `Copy` can be changed to a `Move` only
/// if this path has no later access to that local's allocation before
/// returning, and no later operation whose observable behavior could depend on
/// ending an address-observed local's allocation early. `used_after` tracks
/// those later local-allocation accesses.
// rustc: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:119 scan_block
function scan_block(body: Body, block: BasicBlock, used_after: DenseBitSet<Local>, borrowed: DenseBitSet<Local>): ControlFlow<null> {
  const statements = body.basic_blocks.as_mut_preserves_cfg()[block]!.statements;
  for (let i = statements.length - 1; i >= 0; i--) {
    const statement = statements[i]!;
    const kind = statement.kind;
    switch (kind.$) {
      // Under the local lifetime semantics from RFC 3943, `StorageLive`
      // does not allocate, and `StorageDead` has no effect if the local
      // was already freed by a move. These markers therefore do not
      // affect whether a copy can be treated as a final use.
      case "StorageLive":
      case "StorageDead":
      case "Nop":
        break;
      case "Assign": {
        const [place, rhs] = kind._0;
        // Accessing an indirect place may touch any borrowed local, so
        // continuing would require treating all borrowed locals as used
        // after this point.
        if (place.is_indirect_first_projection()) {
          return ControlFlow.Break(null);
        }

        // Writing to a borrowed local can start a new allocation range.
        // Shortening an earlier borrowed local could remove an overlap
        // with that new range.
        if (borrowed.contains(place.local)) {
          return ControlFlow.Break(null);
        }

        // A destination write accesses the base local, and evaluating
        // the destination may also access projection locals, such as an
        // index.
        record_place_locals(place, used_after);

        // This pass only models `Use` and `Aggregate` rvalues whose
        // operands are direct. Other rvalues are outside the
        // conservative return-tail shape handled here.
        const r = process_rvalue(rhs, used_after);
        if (r.$ === "Break") return r;
        break;
      }
      case "SetDiscriminant": {
        const place = kind.place;
        // Accessing an indirect place may touch any borrowed local, so
        // continuing would require treating all borrowed locals as used
        // after this point.
        if (place.is_indirect_first_projection()) {
          return ControlFlow.Break(null);
        }

        // Writing to a borrowed local can start a new allocation range.
        // Shortening an earlier borrowed local could remove an overlap
        // with that new range.
        if (borrowed.contains(place.local)) {
          return ControlFlow.Break(null);
        }

        // `SetDiscriminant` has a validity invariant on the rest of the
        // place, so treat the base local as accessed along with any
        // projection locals.
        record_place_locals(place, used_after);
        break;
      }
      default:
        // Anything else may perform effects or evaluate places in ways
        // this pass does not model, so it is not part of the pure
        // return tail.
        return ControlFlow.Break(null);
    }
  }

  return ControlFlow.CONTINUE;
}

/// Records all locals used in a place, including `Index` projections in
/// `used_after`.
// rustc: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:191 record_place_locals
function record_place_locals(place: Place, used_after: DenseBitSet<Local>): void {
  for (const local of place.as_ref().accessed_locals()) {
    used_after.insert(local);
  }
}

/// Process the RHS of an assignment in a pure return tail.
// rustc: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:198 process_rvalue
function process_rvalue(rvalue: Rvalue, used_after: DenseBitSet<Local>): ControlFlow<null> {
  switch (rvalue.$) {
    case "Use":
      return process_operand(rvalue._0, used_after);
    case "Aggregate": {
      const operands = rvalue._1;
      // Operands are evaluated left-to-right. We scan them right-to-left
      // so `used_after` includes uses later in the same statement. If an
      // operand accesses an indirect place, only earlier operands and
      // earlier statements are outside the pure tail.
      for (let i = operands.length - 1; i >= 0; i--) {
        const r = process_operand(operands[i]!, used_after);
        if (r.$ === "Break") return r;
      }

      return ControlFlow.CONTINUE;
    }
    default:
      // This pass doesn't model other rvalues, so they are not part of
      // the pure return tail.
      return ControlFlow.Break(null);
  }
}

/// Process one operand in an rvalue.
// rustc: compiler/rustc_mir_transform/src/tail_copy_to_move.rs:224 process_operand
function process_operand(operand: Operand, used_after: DenseBitSet<Local>): ControlFlow<null> {
  let place: Place | undefined;
  if ((operand.$ === "Copy" || operand.$ === "Move") && operand._0.is_indirect_first_projection()) {
    // Accessing an indirect place may touch any borrowed local.
    // Continuing would require treating all borrowed locals as used
    // after this point, which would prevent the useful copy-to-move
    // rewrites this pass is looking for.
    return ControlFlow.Break(null);
  } else if (operand.$ === "Copy") {
    const place_ = operand._0;
    // No later operation in the scanned tail accesses this local's
    // allocation, so this copy is a final use on the current return
    // path and can be represented as a move.
    if (!used_after.contains(place_.local)) {
      replace_in_place<Operand>(operand, { $: "Move", _0: place_ });
    }
    place = place_;
  } else if (operand.$ === "Move") {
    place = operand._0;
  } else {
    // Operand::Constant(_) | Operand::RuntimeChecks(_)
    place = undefined;
  }

  if (place !== undefined) {
    // Reading an operand place accesses its base local, and evaluating its
    // projections may access additional locals, such as the index local in
    // `place[index]`.
    record_place_locals(place, used_after);
  }

  return ControlFlow.CONTINUE;
}
