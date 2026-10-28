// Port of compiler/rustc_mir_transform/src/copy_prop.rs (lane mt-opt1).
//
// PORT: `tcx.sess.emit_lifetime_markers()` is remove_storage_markers.ts's stand-in for `Session::emit_lifetime_markers`
// (session.rs:883; session.ts has not ported it yet). `*operand = Operand::Copy(place)` replaces the visited operand
// object in place (`replace_in_place`), keeping the same `Place` object; `*local = new_local` writes the `MutRef`. The
// derived `PartialEq` of `mir::Place` (`lhs == rhs`) compares `local` and the interned `projection` list.
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { type Body, type Local, type Location, type Operand, type Place, type Statement, traversal } from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext, PlaceContext as PlaceContextC, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ResultsCursor } from "../rustc_mir_dataflow/framework/cursor.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { emit_lifetime_markers } from "./remove_storage_markers.ts";
import { remove_unused_definitions } from "./simplify.ts";
import { MaybeUninitializedLocals, SsaLocals } from "./ssa.ts";

/** PORT: derived `PartialEq` of `mir::Place` (header). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/// Unify locals that copy each other.
///
/// We consider patterns of the form
///   _a = rvalue
///   _b = move? _a
///   _c = move? _a
///   _d = move? _c
/// where each of the locals is only assigned once.
///
/// We want to replace all those locals by `_a` (the "head"), either copied or moved.
// rustc-type: compiler/rustc_mir_transform/src/copy_prop.rs:22 CopyProp
export class CopyProp extends MirPass {
  readonly type_name = "rustc_mir_transform::copy_prop::CopyProp";

  // rustc: compiler/rustc_mir_transform/src/copy_prop.rs:25 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1);
  }

  // #[instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/copy_prop.rs:30 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // debug!(def_id = ?body.source.def_id());

    const typing_env = body.typing_env(tcx);
    const ssa = SsaLocals.new(tcx, body, typing_env);

    // debug!(borrowed_locals = ?ssa.borrowed_locals());
    // debug!(copy_classes = ?ssa.copy_classes());

    let any_replacement = false;
    // Locals that participate in copy propagation either as a source or a destination.
    const unified = DenseBitSet.new_empty<Local>(body.local_decls.length);

    ssa.copy_classes().forEach((head, local) => {
      if (local !== head) {
        any_replacement = true;
        unified.insert(head);
        unified.insert(local as Local);
      }
    });

    if (!any_replacement) {
      return;
    }

    // When emitting storage statements, we want to retain the head locals' storage statements,
    // as this enables better optimizations. For each local use location, we mark the head for storage removal
    // only if the head might be uninitialized at that point, or if the local is borrowed
    // (since we cannot easily determine when it's used).
    let storage_to_remove_: DenseBitSet<Local> | undefined;
    if (emit_lifetime_markers(tcx.sess)) {
      const storage_to_remove = DenseBitSet.new_empty<Local>(body.local_decls.length);

      // If the local is borrowed, we cannot easily determine if it is used, so we have to remove the storage statements.
      const borrowed_locals = ssa.borrowed_locals();

      ssa.copy_classes().forEach((head, local) => {
        if (local !== head && borrowed_locals.contains(local as Local)) {
          storage_to_remove.insert(head);
        }
      });

      const maybe_uninit = new MaybeUninitializedLocals()
        .iterate_to_fixpoint(tcx, body, "mir_opt::copy_prop")
        .into_results_cursor(body);

      const storage_checker = new StorageChecker(maybe_uninit, ssa.copy_classes(), storage_to_remove);

      for (const [bb, data] of traversal.reachable(body)) {
        storage_checker.visit_basic_block_data(bb, data);
      }

      storage_to_remove_ = storage_checker.storage_to_remove;
    } else {
      storage_to_remove_ = undefined;
    }

    // If None, remove the storage statements of all the unified locals.
    const storage_to_remove = storage_to_remove_ ?? unified;
    // debug!(?storage_to_remove);

    new Replacer(tcx, unified, storage_to_remove, ssa.copy_classes()).visit_body_preserves_cfg(body);

    remove_unused_definitions(body);
  }
}

/// Utility to help performing substitution: for all key-value pairs in `copy_classes`,
/// all occurrences of the key get replaced by the value.
// rustc-type: compiler/rustc_mir_transform/src/copy_prop.rs:103 Replacer
class Replacer extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public unified: DenseBitSet<Local>,
    public storage_to_remove: DenseBitSet<Local>,
    public copy_classes: readonly Local[],
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/copy_prop.rs:111 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // #[tracing::instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/copy_prop.rs:116 visit_local
  override visit_local(local: MutRef<Local>, ctxt: PlaceContext, _: Location): void {
    const new_local = this.copy_classes[local.value]!;
    if (ctxt.$ === "NonUse" && (ctxt._0.$ === "StorageLive" || ctxt._0.$ === "StorageDead")) {
      // Do not modify the local in storage statements.
    } else {
      // We access the value.
      local.value = new_local;
    }
  }

  // #[tracing::instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/copy_prop.rs:127 visit_operand
  override visit_operand(operand: Operand, loc: Location): void {
    if (
      operand.$ === "Move" &&
      // A move out of a projection of a copy is equivalent to a copy of the original
      // projection.
      !operand._0.is_indirect_first_projection() &&
      this.unified.contains(operand._0.local)
    ) {
      replace_in_place<Operand>(operand, { $: "Copy", _0: operand._0 });
    }
    this.super_operand(operand, loc);
  }

  // #[tracing::instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/copy_prop.rs:140 visit_statement
  override visit_statement(stmt: Statement, loc: Location): void {
    // When removing storage statements, we need to remove both (#107511).
    const k = stmt.kind;
    if ((k.$ === "StorageLive" || k.$ === "StorageDead") && this.storage_to_remove.contains(k._0)) {
      stmt.make_nop(true);
    }

    this.super_statement(stmt, loc);

    // Do not leave tautological assignments around.
    const k2 = stmt.kind;
    if (k2.$ === "Assign") {
      const [lhs, rhs_] = k2._0;
      if (rhs_.$ === "Use" && (rhs_._0.$ === "Copy" || rhs_._0.$ === "Move") && place_eq(lhs, rhs_._0._0)) {
        stmt.make_nop(true);
      }
    }
  }
}

// Marks heads of copy classes that are maybe uninitialized at the location of a local
// as needing storage statement removal.
// rustc-type: compiler/rustc_mir_transform/src/copy_prop.rs:162 StorageChecker
class StorageChecker extends Visitor {
  constructor(
    public maybe_uninit: ResultsCursor<DenseBitSet<Local>, MaybeUninitializedLocals>,
    public copy_classes: readonly Local[],
    public storage_to_remove: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/copy_prop.rs:169 visit_local
  override visit_local(local: Local, context: PlaceContext, loc: Location): void {
    if (!PlaceContextC.is_use(context)) {
      return;
    }

    const head = this.copy_classes[local]!;

    // If the local is the head, or if we already marked it for deletion, we do not need to check it.
    if (head === local || this.storage_to_remove.contains(head)) {
      return;
    }

    this.maybe_uninit.seek_before_primary_effect(loc);

    if (this.maybe_uninit.get().contains(head)) {
      // debug!(
      //     ?loc,
      //     ?context,
      //     ?local,
      //     ?head,
      //     "local's head is maybe uninit at this location, marking head for storage statement removal"
      // );
      this.storage_to_remove.insert(head);
    }
  }
}

