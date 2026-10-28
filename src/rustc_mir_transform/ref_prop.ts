// Port of compiler/rustc_mir_transform/src/ref_prop.rs (lane mt-opt2-d).
//
// PORT: the fn-local structs `MoveToCopyVisitor` (in `move_to_copy_pointers`) and `ReplacementFinder` (in
// `compute_replacement`) are module-level classes extending mir/visit.ts's `MutVisitor` / `Visitor`; the generic
// `F: FnMut(Place, Location) -> bool` of `ReplacementFinder` is a closure field. `*operand = ..` / `*place = ..` replace
// the visited object in place (`replace_in_place`); `*local = target` in `visit_statement_debuginfo` writes the
// `StmtDebugInfo`'s `_0`.
// PORT: `Place` is `Copy` upstream: `let mut place = *place` of an rvalue's place is `clone_Place`, so the place stored in
// `targets` is not the body's object (the `Replacer` edits body places in place). `Value` is `Copy` too; its `Place` is
// never edited in place (every rewrite builds a new place with `project_deeper`), so `targets[local] = target` shares it.
// PORT: `FxHashSet<(Local, Location)>` is a `KeyedSet` keyed `local:block:statement_index` (PORTING §5 composite keys).
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import {
  type BasicBlock,
  type Body,
  type Local,
  type Location,
  type Operand,
  type Place,
  ProjectionElem,
  type Statement,
  type VarDebugInfo,
  clone_Place,
  traversal,
} from "../rustc_middle/mir/mod.ts";
import { Place_from_Local, type StmtDebugInfo } from "../rustc_middle/mir/statement.ts";
import { MutVisitor, type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { MaybeStorageDead, always_storage_live_locals } from "../rustc_mir_dataflow/impls/mod.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { bug } from "../rustc_span/macros.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { assert } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { remove_unused_definitions } from "./simplify.ts";
import { SsaLocals, StorageLiveLocals } from "./ssa.ts";

/// Propagate references using SSA analysis.
///
/// MIR building may produce a lot of borrow-dereference patterns.
///
/// This pass aims to transform the following pattern:
///   _1 = &raw? mut? PLACE;
///   _3 = *_1;
///   _4 = &raw? mut? *_1;
///
/// Into
///   _1 = &raw? mut? PLACE;
///   _3 = PLACE;
///   _4 = &raw? mut? PLACE;
///
/// where `PLACE` is a direct or an indirect place expression.
///
/// There are 3 properties that need to be upheld for this transformation to be legal:
/// - place stability: `PLACE` must refer to the same memory wherever it appears;
/// - pointer liveness: we must not introduce dereferences of dangling pointers;
/// - `&mut` borrow uniqueness.
///
/// # Stability
///
/// If `PLACE` is an indirect projection, if its of the form `(*LOCAL).PROJECTIONS` where:
/// - `LOCAL` is SSA;
/// - all projections in `PROJECTIONS` have a stable offset (no dereference and no indexing).
///
/// If `PLACE` is a direct projection of a local, we consider it as constant if:
/// - the local is always live, or it has a single `StorageLive`;
/// - all projections have a stable offset.
///
/// # Liveness
///
/// When performing an instantiation, we must take care not to introduce uses of dangling locals.
/// To ensure this, we walk the body with the `MaybeStorageDead` dataflow analysis:
/// - if we want to replace `*x` by reborrow `*y` and `y` may be dead, we allow replacement and
///   mark storage statements on `y` for removal;
/// - if we want to replace `*x` by non-reborrow `y` and `y` must be live, we allow replacement;
/// - if we want to replace `*x` by non-reborrow `y` and `y` may be dead, we do not replace.
///
/// # Uniqueness
///
/// For `&mut` borrows, we also need to preserve the uniqueness property:
/// we must avoid creating a state where we interleave uses of `*_1` and `_2`.
/// To do it, we only perform full instantiation of mutable borrows:
/// we replace either all or none of the occurrences of `*_1`.
///
/// Some care has to be taken when `_1` is copied in other locals.
///   _1 = &raw? mut? _2;
///   _3 = *_1;
///   _4 = _1
///   _5 = *_4
/// In such cases, fully instantiating `_1` means fully instantiating all of the copies.
///
/// For immutable borrows, we do not need to preserve such uniqueness property,
/// so we perform all the possible instantiations without removing the `_1 = &_2` statement.
// rustc-type: compiler/rustc_mir_transform/src/ref_prop.rs:73 ReferencePropagation
export class ReferencePropagation extends MirPass {
  readonly type_name = "rustc_mir_transform::ref_prop::ReferencePropagation";

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:76 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // #[instrument(level = "trace", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:81 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // debug!(def_id = ?body.source.def_id());
    move_to_copy_pointers(tcx, body);
    while (propagate_ssa(tcx, body)) {}
  }
}

/// The SSA analysis done by [`SsaLocals`] treats [`Operand::Move`] as a read, even though in
/// general [`Operand::Move`] represents pass-by-pointer where the callee can overwrite the
/// pointee (Miri always considers the place deinitialized). CopyProp has a similar trick to
/// turn [`Operand::Move`] into [`Operand::Copy`] when required for an optimization, but in this
/// pass we just turn all moves of pointers into copies because pointers should be by-value anyway.
// rustc: compiler/rustc_mir_transform/src/ref_prop.rs:93 move_to_copy_pointers
function move_to_copy_pointers(tcx: TyCtxt, body: Body): void {
  const visitor = new MoveToCopyVisitor(tcx, body.local_decls);
  const blocks = body.basic_blocks.as_mut_preserves_cfg();
  for (let bb = 0; bb < blocks.length; bb++) {
    visitor.visit_basic_block_data(bb as BasicBlock, blocks[bb]!);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/ref_prop.rs:99 MoveToCopyVisitor
class MoveToCopyVisitor extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public local_decls: Body["local_decls"],
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:105 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:109 visit_operand
  override visit_operand(operand: Operand, loc: Location): void {
    if (operand.$ === "Move") {
      const place = operand._0;
      if (place.ty(this.local_decls, this.tcx_).ty.is_any_ptr()) {
        replace_in_place<Operand>(operand, { $: "Copy", _0: place });
      }
    }
    this.super_operand(operand, loc);
  }
}

// rustc: compiler/rustc_mir_transform/src/ref_prop.rs:120 propagate_ssa
function propagate_ssa(tcx: TyCtxt, body: Body): boolean {
  const typing_env = body.typing_env(tcx);
  const ssa = SsaLocals.new(tcx, body, typing_env);

  const replacer = compute_replacement(tcx, body, ssa);
  // debug!(?replacer.targets);
  // debug!(?replacer.allowed_replacements);
  // debug!(?replacer.storage_to_remove);

  replacer.visit_body_preserves_cfg(body);

  if (replacer.any_replacement) {
    remove_unused_definitions(body);
  }

  return replacer.any_replacement;
}

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_transform/src/ref_prop.rs:139 Value
type Value =
  /// Not a pointer, or we can't know.
  | { readonly $: "Unknown" }
  /// We know the value to be a pointer to this place.
  /// The boolean indicates whether the reference is mutable, subject the uniqueness rule.
  | { readonly $: "Pointer"; readonly _0: Place; readonly _1: boolean };
const Value_Unknown: Value = Object.freeze({ $: "Unknown" as const });

/** The key of `(Local, Location)` in `allowed_replacements` (derived `Hash` + `Eq`). */
function local_location_key([local, loc]: [Local, Location]): string {
  return `${local}:${loc.block}:${loc.statement_index}`;
}

/// For each local, save the place corresponding to `*local`.
// #[instrument(level = "trace", skip(tcx, body, ssa))]
// rustc: compiler/rustc_mir_transform/src/ref_prop.rs:149 compute_replacement
function compute_replacement(tcx: TyCtxt, body: Body, ssa: SsaLocals): Replacer {
  const always_live_locals = always_storage_live_locals(body);

  // Compute which locals have a single `StorageLive` statement ever.
  const storage_live = StorageLiveLocals.new(body, always_live_locals);

  // Compute `MaybeStorageDead` dataflow to check that we only replace when the pointee is
  // definitely live.
  const maybe_dead = MaybeStorageDead.new(always_live_locals)
    .iterate_to_fixpoint(tcx, body, undefined)
    .into_results_cursor(body);

  // Map for each local to the pointee.
  const targets: Value[] = new Array<Value>(body.local_decls.length).fill(Value_Unknown);
  // Set of locals for which we will remove their storage statement. This is useful for
  // reborrowed references.
  const storage_to_remove = DenseBitSet.new_empty<Local>(body.local_decls.length);

  const fully_replaceable_locals_ = fully_replaceable_locals(ssa);

  // Returns true iff we can use `place` as a pointee.
  //
  // Note that we only need to verify that there is a single `StorageLive` statement, and we do
  // not need to verify that it dominates all uses of that local.
  //
  // Consider the three statements:
  //   SL : StorageLive(a)
  //   DEF: b = &raw? mut? a
  //   USE: stuff that uses *b
  //
  // First, we recall that DEF is checked to dominate USE. Now imagine for the sake of
  // contradiction there is a DEF -> SL -> USE path. Consider two cases:
  //
  // - DEF dominates SL. We always have UB the first time control flow reaches DEF,
  //   because the storage of `a` is dead. Since DEF dominates USE, that means we cannot
  //   reach USE and so our optimization is ok.
  //
  // - DEF does not dominate SL. Then there is a `START_BLOCK -> SL` path not including DEF.
  //   But we can extend this path to USE, meaning there is also a `START_BLOCK -> USE` path not
  //   including DEF. This violates the DEF dominates USE condition, and so is impossible.
  const is_constant_place = (place: Place): boolean => {
    // We only allow `Deref` as the first projection, to avoid surprises.
    if (place.projection.length > 0 && place.projection[0]!.$ === "Deref") {
      const rest = place.projection.slice(1);
      // `place == (*some_local).xxx`, it is constant only if `some_local` is constant.
      // We approximate constness using SSAness.
      return ssa.is_ssa(place.local) && rest.every((e) => ProjectionElem.is_stable_offset(e));
    } else {
      return storage_live.has_single_storage(place.local) && place.projection.every((e) => ProjectionElem.is_stable_offset(e));
    }
  };

  const can_perform_opt = (target: Place, loc: Location): boolean => {
    if (target.is_indirect_first_projection()) {
      // We are creating a reborrow. As `place.local` is a reference, removing the storage
      // statements should not make it much harder for LLVM to optimize.
      storage_to_remove.insert(target.local);
      return true;
    } else {
      // This is a proper dereference. We can only allow it if `target` is live.
      maybe_dead.seek_after_primary_effect(loc);
      const maybe_dead_ = maybe_dead.get().contains(target.local);
      return !maybe_dead_;
    }
  };

  for (const [local, rvalue, location] of ssa.assignments(body)) {
    // debug!(?local);

    // Only visit if we have something to do.
    if (targets[local]!.$ !== "Unknown") return bug();

    const ty = body.local_decls[local]!.ty;

    // If this is not a reference or pointer, do nothing.
    if (!ty.is_any_ptr()) {
      // debug!("not a reference or pointer");
      continue;
    }

    // Whether the current local is subject to the uniqueness rule.
    const needs_unique = ty.is_mutable_ptr();

    // If this a mutable reference that we cannot fully replace, mark it as unknown.
    if (needs_unique && !fully_replaceable_locals_.contains(local)) {
      // debug!("not fully replaceable");
      continue;
    }

    // debug!(?rvalue);
    if (rvalue.$ === "Use" && (rvalue._0.$ === "Copy" || rvalue._0.$ === "Move")) {
      // This is a copy, just use the value we have in store for the previous one.
      // As we are visiting in `assignment_order`, i.e. reverse postorder, `rhs` should
      // have been visited before.
      const place = rvalue._0._0;
      const rhs = place.as_local();
      if (rhs !== undefined && ssa.is_ssa(rhs)) {
        const target = targets[rhs]!;
        // Only see through immutable reference and pointers, as we do not know yet if
        // mutable references are fully replaced.
        if (!needs_unique && target.$ === "Pointer") {
          targets[local] = target;
        } else {
          targets[local] = { $: "Pointer", _0: tcx.mk_place_deref(Place_from_Local(rhs)), _1: needs_unique };
        }
      }
    } else if (rvalue.$ === "Ref" || rvalue.$ === "RawPtr") {
      let place = clone_Place(rvalue.$ === "Ref" ? rvalue._2 : rvalue._1);
      // Try to see through `place` in order to collapse reborrow chains.
      if (place.projection.length > 0 && place.projection[0]!.$ === "Deref") {
        const rest = place.projection.slice(1);
        const t = targets[place.local]!;
        if (
          t.$ === "Pointer" &&
          // Only see through immutable reference and pointers, as we do not know yet if
          // mutable references are fully replaced.
          !t._1 &&
          // Only collapse chain if the pointee is definitely live.
          can_perform_opt(t._0, location)
        ) {
          place = t._0.project_deeper(rest, tcx);
        }
      }
      assert(place.local !== local, "assertion `left != right` failed");
      if (is_constant_place(place)) {
        targets[local] = { $: "Pointer", _0: place, _1: needs_unique };
      }
    } else {
      // We do not know what to do, so keep as not-a-pointer.
    }
  }

  // debug!(?targets);

  const finder = new ReplacementFinder(targets, can_perform_opt, new KeyedSet<[Local, Location]>(local_location_key));
  const reachable_blocks = traversal.reachable_as_bitset(body);
  const blocks = body.basic_blocks.deref();
  for (let bb = 0; bb < blocks.length; bb++) {
    // Only visit reachable blocks as we rely on dataflow.
    if (reachable_blocks.contains(bb as BasicBlock)) {
      finder.visit_basic_block_data(bb as BasicBlock, blocks[bb]!);
    }
  }

  const allowed_replacements = finder.allowed_replacements;
  return new Replacer(
    tcx,
    finder.targets,
    new Array<Local | undefined>(body.local_decls.length).fill(undefined),
    storage_to_remove,
    allowed_replacements,
    false,
  );
}

// rustc-type: compiler/rustc_mir_transform/src/ref_prop.rs:307 ReplacementFinder
class ReplacementFinder extends Visitor {
  constructor(
    public targets: Value[],
    public can_perform_opt: (target: Place, loc: Location) => boolean,
    public allowed_replacements: KeyedSet<[Local, Location]>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:317 visit_place
  override visit_place(place_: Place, ctxt: PlaceContext, loc: Location): void {
    if (ctxt.$ === "NonUse") {
      // There is no need to check liveness for non-uses.
      return;
    }

    if (!place_.is_indirect_first_projection()) {
      // This is not a dereference, nothing to do.
      return;
    }

    const place = place_.as_ref();
    for (;;) {
      const t = this.targets[place.local]!;
      if (t.$ === "Pointer") {
        const target = t._0;
        const needs_unique = t._1;
        const perform_opt = this.can_perform_opt(target, loc);
        // debug!(?place, ?target, ?needs_unique, ?perform_opt);

        // This a reborrow chain, recursively allow the replacement.
        //
        // This also allows to detect cases where `target.local` is not replaceable,
        // and mark it as such.
        if (target.is_indirect_first_projection()) {
          assert(perform_opt, "assertion failed: perform_opt");
          this.allowed_replacements.add([target.local, loc]);
          place.local = target.local;
          continue;
        } else if (perform_opt) {
          this.allowed_replacements.add([target.local, loc]);
        } else if (needs_unique) {
          // This mutable reference is not fully replaceable, so drop it.
          this.targets[place.local] = Value_Unknown;
        }
      }

      break;
    }
  }
}

/// Compute the set of locals that can be fully replaced.
///
/// We consider a local to be replaceable iff it's only used in a `Deref` projection `*_local` or
/// non-use position (like storage statements and debuginfo).
// rustc: compiler/rustc_mir_transform/src/ref_prop.rs:361 fully_replaceable_locals
function fully_replaceable_locals(ssa: SsaLocals): DenseBitSet<Local> {
  const replaceable = DenseBitSet.new_empty<Local>(ssa.num_locals());

  // First pass: for each local, whether its uses can be fully replaced.
  for (const local of ssa.locals()) {
    if (ssa.num_direct_uses(local) === 0) {
      replaceable.insert(local);
    }
  }

  // Second pass: a local can only be fully replaced if all its copies can.
  ssa.meet_copy_equivalence(replaceable);

  return replaceable;
}

/// Utility to help performing substitution of `*pattern` by `target`.
// rustc-type: compiler/rustc_mir_transform/src/ref_prop.rs:378 Replacer
class Replacer extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public targets: Value[],
    public remap_var_debug_infos: (Local | undefined)[],
    public storage_to_remove: DenseBitSet<Local>,
    public allowed_replacements: KeyedSet<[Local, Location]>,
    public any_replacement: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:388 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:392 visit_var_debug_info
  override visit_var_debug_info(debuginfo: VarDebugInfo): void {
    const value = debuginfo.value;
    if (value.$ === "Place" && value._0.projection.length === 0) {
      const place = value._0;
      let new_local = place.local;

      // If the debuginfo is a pointer to another place
      // and it's a reborrow: see through it
      for (;;) {
        const t = this.targets[new_local]!;
        if (t.$ === "Pointer" && t._0.projection.length === 1 && t._0.projection[0]!.$ === "Deref") {
          new_local = t._0.local;
        } else {
          break;
        }
      }
      if (place.local !== new_local) {
        this.remap_var_debug_infos[place.local] = new_local;
        place.local = new_local;

        this.any_replacement = true;
      }
    }

    // Simplify eventual projections left inside `debuginfo`.
    this.super_var_debug_info(debuginfo);
  }

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:417 visit_statement_debuginfo
  override visit_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    // `StmtDebugInfo::AssignRef(local, _) | StmtDebugInfo::InvalidAssign(local) => local`
    const local = stmt_debuginfo._0;
    const target = this.remap_var_debug_infos[local];
    if (target !== undefined) {
      stmt_debuginfo._0 = target;
      this.any_replacement = true;
    }
    this.super_statement_debuginfo(stmt_debuginfo, location);
  }

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:432 visit_place
  override visit_place(place: Place, ctxt: PlaceContext, loc: Location): void {
    for (;;) {
      if (!(place.projection.length > 0 && place.projection[0]!.$ === "Deref")) return;
      const rest = place.projection.slice(1);

      const t = this.targets[place.local]!;
      if (t.$ !== "Pointer") return;
      const target = t._0;

      let perform_opt: boolean;
      if (ctxt.$ === "NonUse" && ctxt._0.$ === "VarDebugInfo") {
        perform_opt = target.projection.every((p) => ProjectionElem.can_use_in_debuginfo(p));
      } else if (ctxt.$ === "NonUse") {
        perform_opt = true;
      } else {
        perform_opt = this.allowed_replacements.has([target.local, loc]);
      }

      if (!perform_opt) {
        return;
      }

      replace_in_place(place, target.project_deeper(rest, this.tcx_));
      this.any_replacement = true;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ref_prop.rs:455 visit_statement
  override visit_statement(stmt: Statement, loc: Location): void {
    const k = stmt.kind;
    if ((k.$ === "StorageLive" || k.$ === "StorageDead") && this.storage_to_remove.contains(k._0)) {
      stmt.make_nop(true);
    }
    // Do not remove assignments as they may still be useful for debuginfo.
    this.super_statement(stmt, loc);
  }
}
