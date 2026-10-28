// Port of compiler/rustc_mir_transform/src/coroutine/layout.rs (lane mt-coroutine-b, wave 23).
//
// PORT: `CoroutineSavedLocals(DenseBitSet<Local>)` is a class with the tuple field `_0`; its `impl Deref` is the method
// `deref()` (PORTING §8, precedent `State.s`), and the methods upstream reaches through auto-deref (`iter`, `count`,
// `contains`, `superset`, `domain_size`) are called as `saved_locals.deref().x()`.
// PORT: `LivenessInfo` is a data-only struct (interface). `IndexVec<I, Option<T>>` is `(T | undefined)[]`; the tuple
// `(Ty, VariantIdx, FieldIdx)` of `remap` is `[Ty, VariantIdx, FieldIdx]`.
// PORT: `StorageConflictVisitor` `extends ResultsVisitorBase` (dataflow contract, plan-m4 D5). The `Cow::Borrowed` given
// to `MaybeStorageLive::new` is the bitset itself (the analysis only reads it).
// PORT: `SourceInfo` is a `Copy` object: the copies upstream makes into `CoroutineSavedTy` / the suspension-point list
// are `clone_SourceInfo` (PORTING §8; MutVisitors such as the inliner edit `SourceInfo`s in place).
// PORT: `#[instrument]` / `debug!` are comments (no tracing subscriber).
import type { FieldIdx, VariantIdx } from "../../rustc_abi/layout.ts";
import { Movability } from "../../rustc_ast_ir/lib.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { BitMatrix, DenseBitSet, debug_DenseBitSet } from "../../rustc_index/bit_set.ts";
import { MUST_NOT_SUSPEND } from "../../rustc_lint_defs/builtin.ts";
import { pluralize } from "../../rustc_lint_defs/lib.ts";
import {
  type BasicBlock,
  type Body,
  clone_SourceInfo,
  debug_Local,
  Local,
  Location,
  OUTERMOST_SOURCE_SCOPE,
  SourceInfo,
  SourceScope,
  type Statement,
  type Terminator,
} from "../../rustc_middle/mir/mod.ts";
import { type CoroutineLayout, CoroutineSavedLocal, type CoroutineSavedTy } from "../../rustc_middle/mir/query.ts";
import * as traversal from "../../rustc_middle/mir/traversal.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { CAPTURE_STRUCT_LOCAL as ty_CAPTURE_STRUCT_LOCAL } from "../../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { HasAttrs_DefId, type ParamEnv, type Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { CoroutineArgsExt } from "../../rustc_middle/ty/sty.ts";
import { MaybeBorrowedLocals } from "../../rustc_mir_dataflow/impls/borrowed_locals.ts";
import { MaybeLiveLocals } from "../../rustc_mir_dataflow/impls/liveness.ts";
import { always_storage_live_locals, MaybeRequiresStorage, MaybeStorageLive } from "../../rustc_mir_dataflow/impls/storage_liveness.ts";
import { type Results, ResultsCursor, ResultsVisitorBase, visit_results } from "../../rustc_mir_dataflow/framework/mod.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import "../../rustc_trait_selection/lib.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq } from "../../std/panic.ts";

import { MustNotSupend_diagnostic } from "../diagnostics.ts";
import type { MustNotSuspendReason } from "../diagnostics.gen.ts";

// PORT: `ty::CAPTURE_STRUCT_LOCAL` (ty/closure.ts declares its own `Local` brand) as a mir `Local` (decision #15).
const CAPTURE_STRUCT_LOCAL = ty_CAPTURE_STRUCT_LOCAL as unknown as Local;

const SELF_ARG: Local = Local.arg(0);

// rustc-type: compiler/rustc_mir_transform/src/coroutine/layout.rs:55 LivenessInfo
export interface LivenessInfo {
  /// Which locals are live across any suspension point.
  saved_locals: CoroutineSavedLocals;

  /// The set of saved locals live at each suspension point.
  live_locals_at_suspension_points: DenseBitSet<CoroutineSavedLocal>[];

  /// Parallel vec to the above with SourceInfo for each yield terminator.
  source_info_at_suspension_points: SourceInfo[];

  /// For every saved local, the set of other saved locals that are
  /// storage-live at the same time as this local. We cannot overlap locals in
  /// the layout which have conflicting storage.
  storage_conflicts: BitMatrix<CoroutineSavedLocal, CoroutineSavedLocal>;

  /// For every suspending block, the locals which are storage-live across
  /// that suspension point.
  storage_liveness: (DenseBitSet<Local> | undefined)[];
}

/// Computes which locals have to be stored in the state-machine for the
/// given coroutine.
///
/// The basic idea is as follows:
/// - a local is live until we encounter a `StorageDead` statement. In
///   case none exist, the local is considered to be always live.
/// - a local has to be stored if it is either directly used after the
///   the suspend point, or if it is live and has been previously borrowed.
// #[tracing::instrument(level = "trace", skip(tcx, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:84 locals_live_across_suspend_points
export function locals_live_across_suspend_points(
  tcx: TyCtxt,
  body: Body,
  always_live_locals: DenseBitSet<Local>,
  movable: boolean,
): LivenessInfo {
  // Calculate when MIR locals have live storage. This gives us an upper bound of their
  // lifetimes.
  const storage_live = MaybeStorageLive.new(always_live_locals /* Cow::Borrowed */)
    .iterate_to_fixpoint(tcx, body, undefined)
    .into_results_cursor(body);

  // Calculate the MIR locals that have been previously borrowed (even if they are still active).
  const borrowed_locals = new MaybeBorrowedLocals().iterate_to_fixpoint(tcx, body, "coroutine");

  // Calculate the MIR locals that we need to keep storage around for.
  const requires_storage = MaybeRequiresStorage.new(body, borrowed_locals).iterate_to_fixpoint(tcx, body, undefined);
  const requires_storage_cursor = ResultsCursor.new_borrowing(body, requires_storage);

  // Calculate the liveness of MIR locals ignoring borrows.
  const liveness = new MaybeLiveLocals().iterate_to_fixpoint(tcx, body, "coroutine").into_results_cursor(body);

  const storage_liveness_map: (DenseBitSet<Local> | undefined)[] = body.basic_blocks.deref().map(() => undefined);
  const live_locals_at_suspension_points: DenseBitSet<Local>[] = [];
  const source_info_at_suspension_points: SourceInfo[] = [];
  const live_locals_at_any_suspension_point = DenseBitSet.new_empty<Local>(body.local_decls.length);
  const borrowed_locals_cursor = ResultsCursor.new_owning(body, borrowed_locals);

  const blocks = body.basic_blocks.deref();
  for (let i = 0; i < blocks.length; i++) {
    const block = i as BasicBlock;
    const data = blocks[i]!;
    if (data.terminator_().kind.$ !== "Yield") continue;

    const loc = new Location(block, data.statements.length);

    liveness.seek_to_block_end(block);
    const live_locals = liveness.get().clone();

    if (!movable) {
      // The `liveness` variable contains the liveness of MIR locals ignoring borrows.
      // This is correct for movable coroutines since borrows cannot live across
      // suspension points. However for immovable coroutines we need to account for
      // borrows, so we conservatively assume that all borrowed locals are live until
      // we find a StorageDead statement referencing the locals.
      // To do this we just union our `liveness` result with `borrowed_locals`, which
      // contains all the locals which has been borrowed before this suspension point.
      // If a borrow is converted to a raw reference, we must also assume that it lives
      // forever. Note that the final liveness is still bounded by the storage liveness
      // of the local, which happens using the `intersect` operation below.
      borrowed_locals_cursor.seek_before_primary_effect(loc);
      live_locals.union(borrowed_locals_cursor.get());
    }

    // Store the storage liveness for later use so we can restore the state
    // after a suspension point
    storage_live.seek_before_primary_effect(loc);
    storage_liveness_map[block] = storage_live.get().clone();

    // Locals live are live at this point only if they are used across
    // suspension points (the `liveness` variable)
    // and their storage is required (the `storage_required` variable)
    requires_storage_cursor.seek_before_primary_effect(loc);
    live_locals.intersect(requires_storage_cursor.get());

    // The coroutine argument is ignored.
    live_locals.remove(SELF_ARG);

    // debug!(?loc, ?live_locals);

    // Add the locals live at this suspension point to the set of locals which live across
    // any suspension points
    live_locals_at_any_suspension_point.union(live_locals);

    live_locals_at_suspension_points.push(live_locals);
    source_info_at_suspension_points.push(clone_SourceInfo(data.terminator_().source_info));
  }

  // debug!(?live_locals_at_any_suspension_point);
  const saved_locals = new CoroutineSavedLocals(live_locals_at_any_suspension_point);

  // Renumber our liveness_map bitsets to include only the locals we are
  // saving.
  const live_locals_at_suspension_points_ = live_locals_at_suspension_points.map((live_here) =>
    saved_locals.renumber_bitset(live_here),
  );

  const storage_conflicts = compute_storage_conflicts(body, saved_locals, always_live_locals.clone(), requires_storage);

  return {
    saved_locals,
    live_locals_at_suspension_points: live_locals_at_suspension_points_,
    source_info_at_suspension_points,
    storage_conflicts,
    storage_liveness: storage_liveness_map,
  };
}

/// The set of `Local`s that must be saved across yield points.
///
/// `CoroutineSavedLocal` is indexed in terms of the elements in this set;
/// i.e. `CoroutineSavedLocal::new(1)` corresponds to the second local
/// included in this set.
// rustc-type: compiler/rustc_mir_transform/src/coroutine/layout.rs:192 CoroutineSavedLocals
export class CoroutineSavedLocals {
  constructor(public _0: DenseBitSet<Local>) {}

  /// Returns an iterator over each `CoroutineSavedLocal` along with the `Local` it corresponds
  /// to.
  // rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:197 iter_enumerated
  *iter_enumerated(): IterableIterator<[CoroutineSavedLocal, Local]> {
    let i = 0;
    for (const l of this.deref().iter()) {
      yield [CoroutineSavedLocal.from_usize(i), l];
      i += 1;
    }
  }

  /// Transforms a `DenseBitSet<Local>` that contains only locals saved across yield points to the
  /// equivalent `DenseBitSet<CoroutineSavedLocal>`.
  // rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:203 renumber_bitset
  renumber_bitset(input: DenseBitSet<Local>): DenseBitSet<CoroutineSavedLocal> {
    if (!this.deref().superset(input)) {
      assert(false, () => `${debug_DenseBitSet(this._0, PLAIN, debug_Local)} not a superset of ${debug_DenseBitSet(input, PLAIN, debug_Local)}`);
    }
    const out = DenseBitSet.new_empty<CoroutineSavedLocal>(this.deref().count());
    for (const [saved_local, local] of this.iter_enumerated()) {
      if (input.contains(local)) {
        out.insert(saved_local);
      }
    }
    return out;
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:214 get
  get(local: Local): CoroutineSavedLocal | undefined {
    if (!this.deref().contains(local)) {
      return undefined;
    }

    let idx = 0;
    for (const l of this.deref().iter()) {
      if (!(l < local)) break;
      idx += 1;
    }
    return CoroutineSavedLocal.new(idx);
  }

  // impl ops::Deref for CoroutineSavedLocals { type Target = DenseBitSet<Local>; }
  // rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:227 deref
  deref(): DenseBitSet<Local> {
    return this._0;
  }
}

/// For every saved local, looks for which locals are StorageLive at the same
/// time. Generates a bitset for every local of all the other locals that may be
/// StorageLive simultaneously with that local. This is used in the layout
/// computation; see `CoroutineLayout` for more.
// rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:236 compute_storage_conflicts
function compute_storage_conflicts(
  body: Body,
  saved_locals: CoroutineSavedLocals,
  always_live_locals: DenseBitSet<Local>,
  results: Results<DenseBitSet<Local>, MaybeRequiresStorage>,
): BitMatrix<CoroutineSavedLocal, CoroutineSavedLocal> {
  assert_eq(body.local_decls.length, saved_locals.deref().domain_size(), String);

  // debug!("compute_storage_conflicts({:?})", body.span);
  // debug!("always_live = {:?}", always_live_locals);

  // Locals that are always live or ones that need to be stored across
  // suspension points are not eligible for overlap.
  const ineligible_locals = always_live_locals;
  ineligible_locals.intersect(saved_locals.deref());

  // Compute the storage conflicts for all eligible locals.
  const visitor = new StorageConflictVisitor(
    saved_locals,
    BitMatrix.from_row_n<Local, Local>(ineligible_locals, body.local_decls.length),
    DenseBitSet.new_empty<Local>(body.local_decls.length),
    DenseBitSet.new_empty<Local>(body.local_decls.length),
  );

  // Filter out:
  // - unreachable blocks;
  // - reachable blocks that end in `Unreachable`, because they never complete execution and
  //   conflicts within them are spurious.
  const blocks = (function* (): IterableIterator<BasicBlock> {
    for (const [bb, data] of traversal.reachable(body)) {
      if (!(data.terminator_().kind.$ === "Unreachable")) yield bb;
    }
  })();
  visit_results(body, blocks, results, visitor);

  const local_conflicts = visitor.local_conflicts;

  // Compress the matrix using only stored locals (Local -> CoroutineSavedLocal).
  //
  // NOTE: Today we store a full conflict bitset for every local. Technically
  // this is twice as many bits as we need, since the relation is symmetric.
  // However, in practice these bitsets are not usually large. The layout code
  // also needs to keep track of how many conflicts each local has, so it's
  // simpler to keep it this way for now.
  const storage_conflicts = BitMatrix.new<CoroutineSavedLocal, CoroutineSavedLocal>(
    saved_locals.deref().count(),
    saved_locals.deref().count(),
  );
  for (const [saved_local_a, local_a] of saved_locals.iter_enumerated()) {
    if (ineligible_locals.contains(local_a)) {
      // Conflicts with everything.
      storage_conflicts.insert_all_into_row(saved_local_a);
    } else {
      // Keep overlap information only for stored locals.
      for (const [saved_local_b, local_b] of saved_locals.iter_enumerated()) {
        if (local_conflicts.contains(local_a, local_b)) {
          storage_conflicts.insert(saved_local_a, saved_local_b);
        }
      }
    }
  }
  return storage_conflicts;
}

// rustc-type: compiler/rustc_mir_transform/src/coroutine/layout.rs:295 StorageConflictVisitor
class StorageConflictVisitor extends ResultsVisitorBase<DenseBitSet<Local>, MaybeRequiresStorage> {
  constructor(
    public saved_locals: CoroutineSavedLocals,
    // FIXME(tmandry): Consider using sparse bitsets here once we have good
    // benchmarks for coroutines.
    public local_conflicts: BitMatrix<Local, Local>,
    // We keep this bitset as a buffer to avoid reallocating memory.
    public eligible_storage_live: DenseBitSet<Local>,
    // The last live set whose conflicts were recorded. This is just a fast path:
    // if the current live set is a subset, we can skip updating the conflict matrix
    // since its conflicts have already been recorded.
    public last_recorded_storage_live: DenseBitSet<Local>,
  ) {
    super();
  }

  // ---- impl ResultsVisitor<'tcx, MaybeRequiresStorage> for StorageConflictVisitor ----

  // rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:309 visit_after_early_statement_effect
  override visit_after_early_statement_effect(state: DenseBitSet<Local>, _statement: Statement, _loc: Location): void {
    this.apply_state(state);
  }

  // rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:318 visit_after_early_terminator_effect
  override visit_after_early_terminator_effect(state: DenseBitSet<Local>, _terminator: Terminator, _loc: Location): void {
    this.apply_state(state);
  }

  // ---- impl StorageConflictVisitor ----

  // rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:329 apply_state
  apply_state(state: DenseBitSet<Local>): void {
    this.eligible_storage_live.clone_from(state);
    this.eligible_storage_live.intersect(this.saved_locals.deref());

    if (this.last_recorded_storage_live.superset(this.eligible_storage_live)) {
      return;
    }

    for (const local of this.eligible_storage_live.iter()) {
      this.local_conflicts.union_row_with(this.eligible_storage_live, local);
    }
    // std::mem::swap(&mut self.last_recorded_storage_live, &mut self.eligible_storage_live);
    const tmp = this.last_recorded_storage_live;
    this.last_recorded_storage_live = this.eligible_storage_live;
    this.eligible_storage_live = tmp;
  }
}

// #[tracing::instrument(level = "trace", skip(liveness, body))]
// rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:345 compute_layout
export function compute_layout(
  liveness: LivenessInfo,
  body: Body,
): [([Ty, VariantIdx, FieldIdx] | undefined)[], CoroutineLayout, (DenseBitSet<Local> | undefined)[]] {
  const {
    saved_locals,
    live_locals_at_suspension_points,
    source_info_at_suspension_points,
    storage_conflicts,
    storage_liveness,
  } = liveness;

  // Gather live local types.
  const tys: CoroutineSavedTy[] = [];
  for (const [_saved_local, local] of saved_locals.iter_enumerated()) {
    // debug!("coroutine saved local {:?} => {:?}", saved_local, local);

    const decl = body.local_decls[local]!;

    // Do not `unwrap_crate_local` here, as post-borrowck cleanup may have already cleared
    // the information. This is alright, since `ignore_for_traits` is only relevant when
    // this code runs on pre-cleanup MIR, and `ignore_for_traits = false` is the safer
    // default.
    let ignore_for_traits: boolean;
    const local_info = decl.local_info;
    if (local_info.$ === "Set" && local_info._0.$ === "StaticRef") {
      // Do not include raw pointers created from accessing `static` items, as those could
      // well be re-created by another access to the same static.
      const is_thread_local = local_info._0.is_thread_local;
      ignore_for_traits = !is_thread_local;
    } else if (local_info.$ === "Set" && local_info._0.$ === "FakeBorrow") {
      // Fake borrows are only read by fake reads, so do not have any reality in
      // post-analysis MIR.
      ignore_for_traits = true;
    } else {
      ignore_for_traits = false;
    }

    tys.push({
      ty: decl.ty,
      source_info: clone_SourceInfo(decl.source_info),
      ignore_for_traits,
      // Will be set later when walking debuginfo.
      debuginfo_name: undefined,
    });
  }

  // Leave empty variants for the UNRESUMED, RETURNED, and POISONED states.
  // In debuginfo, these will correspond to the beginning (UNRESUMED) or end
  // (RETURNED, POISONED) of the function.
  const body_span = body.source_scopes[OUTERMOST_SOURCE_SCOPE]!.span;
  // IndexVec::with_capacity(CoroutineArgs::RESERVED_VARIANTS + live_locals_at_suspension_points.len())
  const variant_source_info: SourceInfo[] = [];
  variant_source_info.push(
    SourceInfo.outermost(Span.shrink_to_lo(body_span)),
    SourceInfo.outermost(Span.shrink_to_hi(body_span)),
    SourceInfo.outermost(Span.shrink_to_hi(body_span)),
  );

  // Simple map from new to old indices to avoid repeatedly counting bits.
  const reverse_local_map: Local[] = [...saved_locals.deref().iter()];

  // Build the coroutine variant field list.
  // Create a map from local indices to coroutine struct indices.
  const variant_fields: CoroutineSavedLocal[][] = Array.from(
    { length: CoroutineArgsExt.RESERVED_VARIANTS + live_locals_at_suspension_points.length },
    () => [],
  );
  const remap: ([Ty, VariantIdx, FieldIdx] | undefined)[] = new Array(saved_locals.deref().domain_size()).fill(undefined);
  // izip!(&live_locals_at_suspension_points, &source_info_at_suspension_points,
  //       variant_fields.iter_enumerated_mut().skip(CoroutineArgs::RESERVED_VARIANTS))
  // PORT: `izip!` stops at the shortest of the three.
  const n = Math.min(
    live_locals_at_suspension_points.length,
    source_info_at_suspension_points.length,
    Math.max(0, variant_fields.length - CoroutineArgsExt.RESERVED_VARIANTS),
  );
  for (let k = 0; k < n; k++) {
    const live_locals = live_locals_at_suspension_points[k]!;
    const source_info_at_suspension_point = source_info_at_suspension_points[k]!;
    const variant_index = (CoroutineArgsExt.RESERVED_VARIANTS + k) as VariantIdx;
    const fields: CoroutineSavedLocal[] = [...live_locals.iter()];
    variant_fields[variant_index] = fields;
    for (let idx = 0; idx < fields.length; idx++) {
      const saved_local = fields[idx]!;
      // Note that if a field is included in multiple variants, we will
      // just use the first one here. That's fine; fields do not move
      // around inside coroutines, so it doesn't matter which variant
      // index we access them by.
      remap[reverse_local_map[saved_local]!] = [tys[saved_local]!.ty, variant_index, idx as FieldIdx];
    }
    variant_source_info.push(source_info_at_suspension_point);
  }
  // debug!(?variant_fields);
  // debug!(?storage_conflicts);

  for (const var_ of body.var_debug_info) {
    if (var_.value.$ !== "Place") continue;
    const place = var_.value._0;
    const local = place.as_local();
    if (local === undefined) continue;
    // let Some(&Some((_, variant, field))) = remap.get(local) else { continue };
    if (!(local < remap.length)) continue;
    const entry = remap[local];
    if (entry === undefined) continue;
    const [, variant, field] = entry;

    const saved_local: CoroutineSavedLocal = variant_fields[variant]![field]!;
    tys[saved_local]!.debuginfo_name ??= var_.name;
  }

  const layout: CoroutineLayout = { field_tys: tys, variant_fields, variant_source_info, storage_conflicts };
  // debug!(?remap);
  // debug!(?layout);
  // debug!(?storage_liveness);

  return [remap, layout, storage_liveness];
}

// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:457 mir_coroutine_witnesses
export function mir_coroutine_witnesses(tcx: TyCtxt, def_id: LocalDefId): CoroutineLayout | undefined {
  const [body_] = tcx.mir_promoted(def_id);
  const body = body_.borrow();

  // The first argument is the coroutine type passed by value
  const coroutine_ty = body.local_decls[CAPTURE_STRUCT_LOCAL]!.ty;

  let movable: boolean;
  const k = coroutine_ty.kind();
  switch (k.$) {
    case "Coroutine": {
      const def_id = k._0;
      movable = tcx.coroutine_movability(def_id) === Movability.Movable;
      break;
    }
    case "Error":
      return undefined;
    default:
      return span_bug(body.span, `unexpected coroutine type ${display_Ty(coroutine_ty)}`);
  }

  // The witness simply contains all locals live across suspend points.

  const always_live_locals = always_storage_live_locals(body);
  const liveness_info = locals_live_across_suspend_points(tcx, body, always_live_locals, movable);

  // Extract locals which are live across suspension point into `layout`
  // `remap` gives a mapping from local indices onto coroutine struct indices
  // `storage_liveness` tells us which locals have live storage at suspension points
  const [, coroutine_layout] = compute_layout(liveness_info, body);

  check_suspend_tys(tcx, coroutine_layout, body);
  check_field_tys_sized(tcx, coroutine_layout, def_id);

  return coroutine_layout;
}

// rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:490 check_field_tys_sized
function check_field_tys_sized(tcx: TyCtxt, coroutine_layout: CoroutineLayout, def_id: LocalDefId): void {
  // No need to check if unsized_fn_params is disabled,
  // since we will error during typeck.
  if (!tcx.features().unsized_fn_params()) {
    return;
  }

  // FIXME(#132279): @lcnr believes that we may want to support coroutines
  // whose `Sized`-ness relies on the hidden types of opaques defined by the
  // parent function. In this case we'd have to be able to reveal only these
  // opaques here.
  const infcx = tcx.infer_ctxt().ignoring_regions().build(TypingMode.non_body_analysis());
  const param_env = tcx.param_env(LocalDefId.to_def_id(def_id)) as ParamEnv;

  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  for (const field_ty of coroutine_layout.field_tys) {
    ocx.register_bound(
      ObligationCause.new(field_ty.source_info.span, def_id, { $: "SizedCoroutineInterior", _0: def_id }),
      param_env,
      field_ty.ty,
      tcx.require_lang_item(LangItem.Sized, field_ty.source_info.span),
    );
  }

  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  // debug!(?errors);
  if (errors.$ === "HasErrors") {
    infcx.err_ctxt().report_fulfillment_errors(errors._0);
  }
}

// rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:529 check_suspend_tys
function check_suspend_tys(tcx: TyCtxt, layout: CoroutineLayout, body: Body): void {
  const linted_tys = new Set<Ty>();

  // layout.variant_fields.iter().zip(&layout.variant_source_info)
  const n = Math.min(layout.variant_fields.length, layout.variant_source_info.length);
  for (let v = 0; v < n; v++) {
    const variant = layout.variant_fields[v]!;
    const yield_source_info = layout.variant_source_info[v]!;
    // debug!(?variant);
    for (const local of variant) {
      const decl = layout.field_tys[local]!;
      // debug!(?decl);

      if (!decl.ignore_for_traits && set_insert(linted_tys, decl.ty)) {
        const hir_id = SourceScope.lint_root(decl.source_info.scope, body.source_scopes);
        if (hir_id === undefined) {
          continue;
        }

        check_must_not_suspend_ty(tcx, decl.ty, hir_id, {
          source_span: decl.source_info.span,
          yield_span: yield_source_info.span,
          plural_len: 1,
          // ..Default::default()
          descr_pre: "",
          descr_post: "",
        });
      }
    }
  }
}

// #[derive(Default)]
// rustc-type: compiler/rustc_mir_transform/src/coroutine/layout.rs:562 SuspendCheckData
interface SuspendCheckData {
  source_span: Span;
  yield_span: Span;
  descr_pre: string;
  descr_post: string;
  plural_len: number;
}

// Returns whether it emitted a diagnostic or not
// Note that this fn and the proceeding one are based on the code
// for creating must_use diagnostics
//
// Note that this technique was chosen over things like a `Suspend` marker trait
// as it is simpler and has precedent in the compiler
// rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:576 check_must_not_suspend_ty
function check_must_not_suspend_ty(tcx: TyCtxt, ty: Ty, hir_id: HirId, data: SuspendCheckData): boolean {
  if (ty.is_unit()) {
    return false;
  }

  const plural_suffix = pluralize(data.plural_len);

  // debug!("Checking must_not_suspend for {}", ty);

  const k = ty.kind();
  if (k.$ === "Adt" && ty.is_box()) {
    const args = k._1;
    const boxed_ty = args.type_at(0);
    const allocator_ty = args.type_at(1);
    return (
      check_must_not_suspend_ty(tcx, boxed_ty, hir_id, { ...data, descr_pre: `${data.descr_pre}boxed ` }) ||
      check_must_not_suspend_ty(tcx, allocator_ty, hir_id, { ...data, descr_pre: `${data.descr_pre}allocator ` })
    );
  }
  // FIXME(sized_hierarchy): This should be replaced with a requirement that types in
  // coroutines implement `const Sized`. Scalable vectors are temporarily `Sized` while
  // `feature(sized_hierarchy)` is not fully implemented, but in practice are
  // non-`const Sized` and so do not have a known size at compilation time. Layout computation
  // for a coroutine containing scalable vectors would be incorrect.
  if (k.$ === "Adt" && k._0.repr().is_scalable()) {
    tcx.dcx().span_err(data.source_span, "scalable vectors cannot be held over await points");
    return true;
  }
  switch (k.$) {
    case "Adt": {
      const def = k._0;
      return check_must_not_suspend_def(tcx, def.did(), hir_id, data);
    }
    // FIXME: support adding the attribute to TAITs
    case "Alias": {
      if (k._1.kind.$ !== "Opaque") return false;
      const def = k._1.kind.def_id;
      let has_emitted = false;
      for (const [predicate] of EarlyBinder.skip_binder(
        tcx.explicit_item_bounds(def) as EarlyBinder<readonly (readonly [Clause, Span])[]>,
      )) {
        // We only look at the `DefId`, so it is safe to skip the binder here.
        const pk = Binder.skip_binder(predicate.kind());
        if (pk.$ === "Trait") {
          const poly_trait_predicate = pk._0;
          const def_id = poly_trait_predicate.trait_ref.def_id;
          const descr_pre = `${data.descr_pre}implementer${plural_suffix} of `;
          if (check_must_not_suspend_def(tcx, def_id, hir_id, { ...data, descr_pre })) {
            has_emitted = true;
            break;
          }
        }
      }
      return has_emitted;
    }
    case "Dynamic": {
      const binder = k._0;
      let has_emitted = false;
      for (const predicate of binder) {
        const sp = Binder.skip_binder(predicate);
        if (sp.$ === "Trait") {
          const trait_ref = sp._0;
          const def_id = trait_ref.def_id;
          const descr_post = ` trait object${plural_suffix}${data.descr_post}`;
          if (check_must_not_suspend_def(tcx, def_id, hir_id, { ...data, descr_post })) {
            has_emitted = true;
            break;
          }
        }
      }
      return has_emitted;
    }
    case "Tuple": {
      const fields = k._0;
      let has_emitted = false;
      for (let i = 0; i < fields.length; i++) {
        const ty = fields[i]!;
        const descr_post = ` in tuple element ${i}`;
        if (check_must_not_suspend_ty(tcx, ty, hir_id, { ...data, descr_post })) {
          has_emitted = true;
        }
      }
      return has_emitted;
    }
    case "Array": {
      const ty = k._0;
      const len = k._1;
      const descr_pre = `${data.descr_pre}array${plural_suffix} of `;
      return check_must_not_suspend_ty(tcx, ty, hir_id, {
        ...data,
        descr_pre,
        // FIXME(must_not_suspend): This is wrong. We should handle printing unevaluated consts.
        plural_len: (len.try_to_target_usize(tcx) ?? 0) + 1,
      });
    }
    // If drop tracking is enabled, we want to look through references, since the referent
    // may not be considered live across the await point.
    case "Ref": {
      const ty = k._1;
      const descr_pre = `${data.descr_pre}reference${plural_suffix} to `;
      return check_must_not_suspend_ty(tcx, ty, hir_id, { ...data, descr_pre });
    }
    default:
      return false;
  }
}

// rustc: compiler/rustc_mir_transform/src/coroutine/layout.rs:698 check_must_not_suspend_def
function check_must_not_suspend_def(tcx: TyCtxt, def_id: DefId, hir_id: HirId, data: SuspendCheckData): boolean {
  // PORT: `find_attr!(.. => reason)` is `Option<Option<Symbol>>`; the outer `Some` is the `{ reason }` holder.
  const found = find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k): { reason: Symbol | undefined } | undefined =>
    k.$ === "MustNotSupend" ? { reason: k.reason } : undefined,
  );
  if (found !== undefined) {
    const reason_str = found.reason;
    const reason: MustNotSuspendReason | undefined =
      reason_str === undefined ? undefined : { span: data.source_span, reason: reason_str };
    tcx.emit_node_span_lint(
      MUST_NOT_SUSPEND,
      hir_id,
      data.source_span,
      MustNotSupend_diagnostic({
        tcx,
        yield_sp: data.yield_span,
        reason,
        src_sp: data.source_span,
        pre: data.descr_pre,
        def_id,
        post: data.descr_post,
      }),
    );

    return true;
  } else {
    return false;
  }
}

/** `FxHashSet::insert`: `true` if the value was not present (`Ty` is interned). */
function set_insert(set: Set<Ty>, v: Ty): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}
