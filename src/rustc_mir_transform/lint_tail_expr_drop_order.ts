// Port of compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs (lane mt-built-lints). The types
// `MovePathIndexAtBlock`, `TailExprDropOrderLint`, `LocalLabel`, `DestructorLabel` and the derived impls are generated
// into lint_tail_expr_drop_order.gen.ts (tools/codegen/types.ts, set rustc_mir_transform); `DropsReachable` (hand
// class) and the manual `impl Subdiagnostic for LocalLabel` are here.
//
// PORT: `Rc<RefCell<MixedBitSet>>` is the `MixedBitSet` object itself (shared, edited in place; `Rc::clone` shares,
// `.borrow().clone()` copies). `&'a mut Option<Span>` is a `MutRef`; `&'a mut IndexSlice` / `&'a mut MixedBitSet` /
// `&'a mut ResultsCursor` are the shared objects. `FxIndexMap` / `UnordMap` are insertion-ordered `Map`s keyed by
// handle or interned `Ty`. `UnordSet<&Place>` (compared by value) is an array searched with `place_eq` (derived
// `PartialEq`: `local`, then the interned projection list by identity). `PlaceElem`'s derived `PartialEq` is
// `intern_key_eq`. `Itertools::all_equal_value` is a local loop.
import { DiagMessage_arg } from "../rustc_errors/formatting.ts";
import { bool_into_diag_arg, str_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { type Diag, IntoDiagArg, msg } from "../rustc_errors/lib.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { CRATE_HIR_ID, type HirId } from "../rustc_hir_id/lib.ts";
import { MixedBitSet } from "../rustc_index/bit_set.ts";
import { LintId } from "../rustc_lint_defs/lib.ts";
import { TAIL_EXPR_DROP_ORDER } from "../rustc_lint_defs/builtin.ts";
import {
  type BasicBlock,
  type Body,
  Local,
  Location,
  type Place,
} from "../rustc_middle/mir/mod.ts";
import { MirDumper } from "../rustc_middle/mir/pretty.ts";
import { CAPTURE_STRUCT_LOCAL } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { extract_component_with_significant_dtor, ty_dtor_span } from "../rustc_middle/ty/significant_drop_order.ts";
import type { ResultsCursor } from "../rustc_mir_dataflow/framework/cursor.ts";
import type { MaybeReachable } from "../rustc_mir_dataflow/framework/lattice.ts";
import { MaybeInitializedPlaces } from "../rustc_mir_dataflow/impls/initialized.ts";
import { MoveData, type MovePathIndex } from "../rustc_mir_dataflow/move_paths/mod.ts";
import { Edition } from "../rustc_span/edition.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol, type Symbol as SymbolT } from "../rustc_span/symbol.ts";
import { intern_key_eq } from "../rust_ts/intern_key.ts";
import type { MutRef } from "../std/mut_ref.ts";
import {
  type DestructorLabel,
  DestructorLabel_add_to_diag,
  type LocalLabel,
  MovePathIndexAtBlock,
  TailExprDropOrderLint_diagnostic,
} from "./lint_tail_expr_drop_order.gen.ts";

export * from "./lint_tail_expr_drop_order.gen.ts";

// rustc: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:31 place_has_common_prefix
function place_has_common_prefix(left: Place, right: Place): boolean {
  if (left.local !== right.local) return false;
  const n = Math.min(left.projection.length, right.projection.length);
  for (let i = 0; i < n; i++) {
    if (!intern_key_eq(left.projection[i], right.projection[i])) return false;
  }
  return true;
}

/** `mir::Place`'s derived `PartialEq` (`local`, then the interned `projection` list, compared by identity). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

type MaybeInitCursor = ResultsCursor<MaybeReachable<MixedBitSet<MovePathIndex>>, MaybeInitializedPlaces>;

// rustc-type: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:47 DropsReachable
export class DropsReachable {
  constructor(
    public body: Body,
    public place: Place,
    public drop_span: MutRef<Span | undefined>,
    public move_data: MoveData,
    public maybe_init: MaybeInitCursor,
    public block_drop_value_info: MovePathIndexAtBlock[],
    public collected_drops: MixedBitSet<MovePathIndex>,
    public visited: Map<BasicBlock, MixedBitSet<MovePathIndex>>,
  ) {}

  // impl<'a, 'mir, 'tcx> DropsReachable<'a, 'mir, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:59 visit
  visit(block: BasicBlock): void {
    const move_set_size = this.move_data.move_paths.length;
    const make_new_path_set = () => MixedBitSet.new_empty<MovePathIndex>(move_set_size);

    const data = this.body.basic_blocks.deref()[block]!;
    if (data.terminator === undefined) return;
    const terminator = data.terminator;
    // Given that we observe these dropped locals here at `block` so far, we will try to update
    // the successor blocks. An occupied entry at `block` in `self.visited` signals that we
    // have visited `block` before.
    let dropped_local_here = this.visited.get(block);
    if (dropped_local_here === undefined) {
      dropped_local_here = make_new_path_set();
      this.visited.set(block, dropped_local_here);
    }
    // We could have invoked reverse lookup for a `MovePathIndex` every time, but unfortunately
    // it is expensive. Let's cache them in `self.block_drop_value_info`.
    const info = this.block_drop_value_info[block]!;
    switch (info.$) {
      case "Some": {
        const dropped = info._0;
        MixedBitSet.insert(dropped_local_here, dropped);
        break;
      }
      case "Unknown": {
        if (terminator.kind.$ === "Drop") {
          const place = terminator.kind.place;
          const r = this.move_data.rev_lookup.find(place.as_ref());
          if (r.$ === "Exact" || (r.$ === "Parent" && r._0 !== undefined)) {
            const idx: MovePathIndex = r._0!;
            // Since we are working with MIRs at a very early stage, observing a `drop`
            // terminator is not indicative enough that the drop will definitely happen.
            // That is decided in the drop elaboration pass instead. Therefore, we need to
            // consult with the maybe-initialization information.
            this.maybe_init.seek_before_primary_effect(new Location(block, data.statements.length));

            // Check if the drop of `place` under inspection is really in effect. This is
            // true only when `place` may have been initialized along a control flow path
            // from a BID to the drop program point today. In other words, this is where
            // the drop of `place` will happen in the future instead.
            const maybe_init = this.maybe_init.get();
            if (maybe_init.$ === "Reachable" && MixedBitSet.contains(maybe_init._0, idx)) {
              // We also cache the drop information, so that we do not need to check on
              // data-flow cursor again.
              this.block_drop_value_info[block] = { $: "Some", _0: idx };
              MixedBitSet.insert(dropped_local_here, idx);
            } else {
              this.block_drop_value_info[block] = MovePathIndexAtBlock.None;
            }
          }
        }
        break;
      }
      case "None":
        break;
    }

    for (const succ of terminator.successors()) {
      const target = this.body.basic_blocks.deref()[succ]!;
      if (target.is_cleanup) {
        continue;
      }

      // As long as we are passing through a new block, or new dropped places to propagate,
      // we will proceed with `succ`
      let dropped_local_there: MixedBitSet<MovePathIndex>;
      const occupied = this.visited.get(succ);
      if (occupied !== undefined) {
        if (succ === block || !MixedBitSet.union(occupied, dropped_local_here)) {
          // `succ` has been visited but no new drops observed so far,
          // so we can bail on `succ` until new drop information arrives
          continue;
        }
        dropped_local_there = occupied;
      } else {
        dropped_local_there = MixedBitSet.clone(dropped_local_here);
        this.visited.set(succ, dropped_local_there);
      }
      const t = target.terminator;
      if (t !== undefined && t.kind.$ === "Drop" && place_has_common_prefix(t.kind.place, this.place)) {
        // We have now reached the current drop of the `place`.
        // Let's check the observed dropped places in.
        MixedBitSet.union(this.collected_drops, dropped_local_there);
        if (this.drop_span.value === undefined) {
          // FIXME(@dingxiangfei2009): it turns out that `self.body.source_scopes` are
          // still a bit wonky. There is a high chance that this span still points to a
          // block rather than a statement semicolon.
          this.drop_span.value = t.source_info.span;
        }
        // Now we have discovered a simple control flow path from a future drop point
        // to the current drop point.
        // We will not continue from there.
      } else {
        this.visit(succ);
      }
    }
  }
}

/// Check if a moved place at `idx` is a part of a BID.
/// The use of this check is that we will consider drops on these
/// as a drop of the overall BID and, thus, we can exclude it from the diagnosis.
// rustc: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:164 place_descendent_of_bids
function place_descendent_of_bids(idx_: MovePathIndex, move_data: MoveData, bids: readonly Place[]): boolean {
  let idx = idx_;
  for (;;) {
    const path = move_data.move_paths[idx]!;
    if (bids.some((p) => place_eq(p, path.place))) {
      return true;
    }
    if (path.parent !== undefined) {
      idx = path.parent;
    } else {
      return false;
    }
  }
}

/** `ty_dropped_components.entry(ty).or_insert_with(|| extract_component_with_significant_dtor(..))` */
function components_entry(map: Map<Ty, Ty[]>, ty: Ty, f: () => Ty[]): Ty[] {
  let v = map.get(ty);
  if (v === undefined) {
    v = f();
    map.set(ty, v);
  }
  return v;
}

/// The core of the lint `tail-expr-drop-order`
// rustc: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:183 run_lint
export function run_lint(tcx: TyCtxt, def_id: LocalDefId, body: Body): void {
  if (tcx.def_kind(def_id).$ === "SyntheticCoroutineBody") {
    // A synthetic coroutine has no HIR body and it is enough to just analyse the original body
    return;
  }
  if (Edition.at_least_rust_2024(Span.edition(body.span)) || tcx.skippable_lints(null).has(LintId.of(TAIL_EXPR_DROP_ORDER))) {
    return;
  }

  // FIXME(typing_env): This should be able to reveal the opaques local to the
  // body using the typeck results.
  const typing_env = TypingEnv.non_body_analysis(tcx, def_id);

  // ## About BIDs in blocks ##
  // Track the set of blocks that contain a backwards-incompatible drop (BID)
  // and, for each block, the vector of locations.
  //
  // We group them per-block because they tend to scheduled in the same drop ladder block.
  const bid_per_block = new Map<BasicBlock, [Location, Place][]>();
  const bid_places: Place[] = [];

  const ty_dropped_components = new Map<Ty, Ty[]>();
  const blocks = body.basic_blocks.deref();
  for (let block = 0 as BasicBlock; block < blocks.length; block++) {
    const data = blocks[block]!;
    for (let statement_index = 0; statement_index < data.statements.length; statement_index++) {
      const stmt = data.statements[statement_index]!;
      if (stmt.kind.$ === "BackwardIncompatibleDropHint") {
        const place = stmt.kind.place;
        const ty = place.ty(body, tcx).ty;
        if (components_entry(ty_dropped_components, ty, () => extract_component_with_significant_dtor(tcx, typing_env, ty)).length === 0) {
          continue;
        }
        let entry = bid_per_block.get(block);
        if (entry === undefined) {
          entry = [];
          bid_per_block.set(block, entry);
        }
        entry.push([new Location(block, statement_index), place]);
        if (!bid_places.some((p) => place_eq(p, place))) bid_places.push(place);
      }
    }
  }
  if (bid_per_block.size === 0) {
    return;
  }

  const dumper = MirDumper.new(tcx, "lint_tail_expr_drop_order", body);
  if (dumper !== undefined) {
    dumper.dump_mir(body);
  }

  const locals_with_user_names = collect_user_names(body);
  const is_closure_like = tcx.is_closure_like(LocalDefId.to_def_id(def_id));

  // Compute the "maybe initialized" information for this body.
  // When we encounter a DROP of some place P we only care
  // about the drop if `P` may be initialized.
  const move_data = MoveData.gather_moves(body, tcx, (_) => true);
  const maybe_init = MaybeInitializedPlaces.new(tcx, body, move_data)
    .iterate_to_fixpoint(tcx, body, undefined)
    .into_results_cursor(body) as MaybeInitCursor;
  const block_drop_value_info: MovePathIndexAtBlock[] = Array.from(
    { length: body.basic_blocks.deref().length },
    () => MovePathIndexAtBlock.Unknown,
  );
  for (const [block, candidates] of bid_per_block) {
    // We will collect drops on locals on paths between BID points to their actual drop locations
    // into `all_locals_dropped`.
    const all_locals_dropped = MixedBitSet.new_empty<MovePathIndex>(move_data.move_paths.length);
    const drop_span: MutRef<Span | undefined> = { value: undefined };
    for (const [_, place] of candidates) {
      const collected_drops = MixedBitSet.new_empty<MovePathIndex>(move_data.move_paths.length);
      // ## On detecting change in relative drop order ##
      // Iterate through each BID-containing block `block`.
      // If the place `P` targeted by the BID is "maybe initialized",
      // then search forward to find the actual `DROP(P)` point.
      // Everything dropped between the BID and the actual drop point
      // is something whose relative drop order will change.
      new DropsReachable(
        body,
        place,
        drop_span,
        move_data,
        maybe_init,
        block_drop_value_info,
        collected_drops,
        new Map(),
      ).visit(block);
      // Compute the set `all_locals_dropped` of local variables that are dropped
      // after the BID point but before the current drop point.
      //
      // These are the variables whose drop impls will be reordered with respect
      // to `place`.
      MixedBitSet.union(all_locals_dropped, collected_drops);
    }

    // We shall now exclude some local bindings for the following cases.
    {
      const to_exclude = MixedBitSet.new_empty<MovePathIndex>(MixedBitSet.domain_size(all_locals_dropped));
      // We will now do subtraction from the candidate dropped locals, because of the
      // following reasons.
      for (const path_idx of MixedBitSet.iter(all_locals_dropped)) {
        const move_path = move_data.move_paths[path_idx]!;
        const dropped_local = move_path.place.local;
        // a) A return value _0 will eventually be used
        // Example:
        // fn f() -> Droppy {
        //     let _x = Droppy;
        //     Droppy
        // }
        // _0 holds the literal `Droppy` and rightfully `_x` has to be dropped first
        if (dropped_local === Local.ZERO) {
          // debug!(?dropped_local, "skip return value");
          MixedBitSet.insert(to_exclude, path_idx);
          continue;
        }
        // b) If we are analysing a closure, the captures are still dropped last.
        // This is part of the closure capture lifetime contract.
        // They are similar to the return value _0 with respect to lifetime rules.
        // PORT: ty/closure.ts's `CAPTURE_STRUCT_LOCAL` has its own `Local` brand (compared as numbers).
        if (is_closure_like && (dropped_local as number) === (CAPTURE_STRUCT_LOCAL as number)) {
          // debug!(?dropped_local, "skip closure captures");
          MixedBitSet.insert(to_exclude, path_idx);
          continue;
        }
        // c) Sometimes we collect places that are projections into the BID locals,
        // so they are considered dropped now.
        // Example:
        // struct NotVeryDroppy(Droppy);
        // impl Drop for Droppy {..}
        // fn f() -> NotVeryDroppy {
        //    let x = NotVeryDroppy(droppy());
        //    {
        //        let y: Droppy = x.0;
        //        NotVeryDroppy(y)
        //    }
        // }
        // `y` takes `x.0`, which invalidates `x` as a complete `NotVeryDroppy`
        // so there is no point in linting against `x` any more.
        if (place_descendent_of_bids(path_idx, move_data, bid_places)) {
          // debug!(?dropped_local, "skip descendent of bids");
          MixedBitSet.insert(to_exclude, path_idx);
          continue;
        }
        const observer_ty = move_path.place.ty(body, tcx).ty;
        // d) The collected local has no custom destructor that passes our ecosystem filter.
        if (
          components_entry(ty_dropped_components, observer_ty, () =>
            extract_component_with_significant_dtor(tcx, typing_env, observer_ty),
          ).length === 0
        ) {
          // debug!(?dropped_local, "skip non-droppy types");
          MixedBitSet.insert(to_exclude, path_idx);
          continue;
        }
      }
      // Suppose that all BIDs point into the same local,
      // we can remove the this local from the observed drops,
      // so that we can focus our diagnosis more on the others.
      const local = all_equal_value(candidates.map(([_, place]) => place.local));
      if (local !== undefined) {
        for (const path_idx of MixedBitSet.iter(all_locals_dropped)) {
          if (move_data.move_paths[path_idx]!.place.local === local) {
            MixedBitSet.insert(to_exclude, path_idx);
          }
        }
      }
      MixedBitSet.subtract(all_locals_dropped, to_exclude);
    }
    if (MixedBitSet.is_empty(all_locals_dropped)) {
      // No drop effect is observable, so let us move on.
      continue;
    }

    // ## The final work to assemble the diagnosis ##
    // First collect or generate fresh names for local variable bindings and temporary values.
    const local_names = assign_observables_names(
      [
        ...[...MixedBitSet.iter(all_locals_dropped)].map((path_idx) => move_data.move_paths[path_idx]!.place.local),
        ...candidates.map(([_, place]) => place.local),
      ],
      locals_with_user_names,
    );

    let lint_root: HirId | undefined = undefined;
    const local_labels: LocalLabel[] = [];
    // We now collect the types with custom destructors.
    for (const [_, place] of candidates) {
      const linted_local_decl = body.local_decls[place.local]!;
      const entry = local_names.get(place.local);
      if (entry === undefined) {
        return bug("a name should have been assigned");
      }
      const [name, is_generated_name] = entry;

      if (lint_root === undefined) {
        const data = body.source_scopes[linted_local_decl.source_info.scope]!.local_data;
        if (data.$ === "Set") {
          lint_root = data._0.lint_root;
        }
      }

      // Collect spans of the custom destructors.
      let seen_dyn = false;
      const destructors: DestructorLabel[] = [];
      for (const ty of ty_dropped_components.get(linted_local_decl.ty)!) {
        const span = ty_dtor_span(tcx, ty);
        if (span !== undefined) {
          destructors.push({ span, name, dtor_kind: "concrete" });
        } else if (ty.kind().$ === "Dynamic") {
          if (!seen_dyn) {
            seen_dyn = true;
            destructors.push({ span: DUMMY_SP, name, dtor_kind: "dyn" });
          }
        }
      }
      local_labels.push({
        span: linted_local_decl.source_info.span,
        destructors,
        name,
        is_generated_name,
        is_dropped_first_edition_2024: true,
      });
    }

    // Similarly, custom destructors of the observed drops.
    for (const path_idx of MixedBitSet.iter(all_locals_dropped)) {
      const place = move_data.move_paths[path_idx]!.place;
      // We are not using the type of the local because the drop may be partial.
      const observer_ty = place.ty(body, tcx).ty;

      const observer_local_decl = body.local_decls[place.local]!;
      const entry = local_names.get(place.local);
      if (entry === undefined) {
        return bug("a name should have been assigned");
      }
      const [name, is_generated_name] = entry;

      let seen_dyn = false;
      const destructors: DestructorLabel[] = [];
      for (const ty of extract_component_with_significant_dtor(tcx, typing_env, observer_ty)) {
        const span = ty_dtor_span(tcx, ty);
        if (span !== undefined) {
          destructors.push({ span, name, dtor_kind: "concrete" });
        } else if (ty.kind().$ === "Dynamic") {
          if (!seen_dyn) {
            seen_dyn = true;
            destructors.push({ span: DUMMY_SP, name, dtor_kind: "dyn" });
          }
        }
      }
      local_labels.push({
        span: observer_local_decl.source_info.span,
        destructors,
        name,
        is_generated_name,
        is_dropped_first_edition_2024: false,
      });
    }

    const span = local_labels[0]!.span;
    tcx.emit_node_span_lint(
      TAIL_EXPR_DROP_ORDER,
      lint_root ?? CRATE_HIR_ID,
      span,
      TailExprDropOrderLint_diagnostic({ local_labels, drop_span: drop_span.value, _epilogue: null }),
    );
  }
}

/** `Itertools::all_equal_value`: `Ok(x)` if the iterator is non-empty and every element equals `x`. */
function all_equal_value(xs: readonly Local[]): Local | undefined {
  if (xs.length === 0) return undefined;
  const first = xs[0]!;
  return xs.every((x) => x === first) ? first : undefined;
}

/// Extract binding names if available for diagnosis
// rustc: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:463 collect_user_names
function collect_user_names(body: Body): Map<Local, SymbolT> {
  const names = new Map<Local, SymbolT>();
  for (const var_debug_info of body.var_debug_info) {
    if (var_debug_info.value.$ !== "Place") continue;
    const place = var_debug_info.value._0;
    const local = place.local_or_deref_local();
    if (local !== undefined && !body.local_decls[local]!.from_compiler_desugaring()) {
      if (!names.has(local)) names.set(local, var_debug_info.name);
    }
  }
  return names;
}

/// Assign names for anonymous or temporary values for diagnosis
// rustc: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:477 assign_observables_names
function assign_observables_names(locals: Iterable<Local>, user_names: Map<Local, SymbolT>): Map<Local, [string, boolean]> {
  const names = new Map<Local, [string, boolean]>();
  const assigned_names = new Set<string>();
  let idx = 0;
  const fresh_name = (): [string, boolean] => {
    idx += 1;
    return [`#${idx}`, true];
  };
  for (const local of locals) {
    let name: [string, boolean];
    const user_name = user_names.get(local);
    if (user_name !== undefined) {
      const name_ = Symbol.as_str(user_name);
      if (assigned_names.has(name_)) {
        name = fresh_name();
      } else {
        name = [name_, false];
      }
    } else {
      name = fresh_name();
    }
    assigned_names.add(name[0]);
    names.set(local, name);
  }
  return names;
}

/// A custom `Subdiagnostic` implementation so that the notes are delivered in a specific order
// impl Subdiagnostic for LocalLabel<'_>
// rustc: compiler/rustc_mir_transform/src/lint_tail_expr_drop_order.rs:526 add_to_diag
export function LocalLabel_add_to_diag(self: LocalLabel, diag: Diag): void {
  diag.span_label(
    self.span,
    DiagMessage_arg(
      msg(
        "{$is_generated_name ->\n                    [true] this value will be stored in a temporary; let us call it `{$name}`\n                    *[false] `{$name}` calls a custom destructor\n                }",
      ),
      "name",
      IntoDiagArg.of(self.name, str_into_diag_arg),
    )
      .arg("is_generated_name", IntoDiagArg.of(self.is_generated_name, bool_into_diag_arg))
      .format(),
  );
  for (const dtor of self.destructors) {
    DestructorLabel_add_to_diag(dtor, diag);
  }
  diag.span_label(
    self.span,
    DiagMessage_arg(
      msg(
        "{$is_dropped_first_edition_2024 ->\n                [true] up until Edition 2021 `{$name}` is dropped last but will be dropped earlier in Edition 2024\n                *[false] `{$name}` will be dropped later as of Edition 2024\n            }",
      ),
      "is_dropped_first_edition_2024",
      IntoDiagArg.of(self.is_dropped_first_edition_2024, bool_into_diag_arg),
    )
      .arg("name", IntoDiagArg.of(self.name, str_into_diag_arg))
      .format(),
  );
}
/** `LocalLabel` as a `Subdiagnostic` trait object. */
export function LocalLabel_subdiagnostic(self: LocalLabel) {
  return { add_to_diag: (diag: Diag) => LocalLabel_add_to_diag(self, diag) };
}
