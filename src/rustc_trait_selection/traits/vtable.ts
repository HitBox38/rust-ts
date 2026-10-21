// Port of compiler/rustc_trait_selection/src/traits/vtable.rs (lane instance-vtable; the contract stub was lane
// selcx-contract's). `VtblSegment` is generated (./vtable.gen.ts).
//
// PORT: `segment_visitor: impl FnMut(VtblSegment) -> ControlFlow<T>` is a closure. `prepare_vtable_segments` returns
// `Option<T>` where `T` may itself be an `Option` (`supertrait_vtable_slot`), so it is `{ $: "Some"; _0: T } |
// undefined` (PORTING §5).
// PORT: the lazy iterators (`direct_super_traits_iter`, kept on the stack as `siblings` and resumed by `find`, and
// `own_existential_vtable_entries_iter`, of which `has_own_existential_vtable_entries` takes one item) are generators,
// so the queries they call run in upstream order. `debug!` (tracing) is dropped; `debug_assert!` is a comment.
// Init order: top-level code here touches only ./vtable.gen.ts and other crates.

import type { ControlFlow } from "../../rustc_ast_ir/visit.ts";
import { ControlFlow as ControlFlowC } from "../../rustc_ast_ir/visit.ts";
import { PredicateSet } from "../../rustc_infer/traits/util.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AssocItem as AssocItemT, Clause, Ty } from "../../rustc_middle/ty/decls.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { GenericArg, type GenericArgs, fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { COMMON_VTABLE_ENTRIES, type VtblEntry } from "../../rustc_middle/ty/vtable.ts";
import { Defaultness } from "../../rustc_hir/hir.ts";
import { type DefId, DefId_eq } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { supertrait_def_ids } from "../../rustc_type_ir/elaborate.ts";
import { type TypeFoldable, fold_tuple2 } from "../../rustc_type_ir/fold.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import {
  ExistentialTraitRef,
  PolyExistentialTraitRef,
  TraitRef,
  as_interner,
  fold_with_ExistentialTraitRef,
  fold_with_TraitClause,
  fold_with_TraitRef,
  try_fold_with_ExistentialTraitRef,
  try_fold_with_TraitClause,
  try_fold_with_TraitRef,
  visit_with_ExistentialTraitRef,
  visit_with_TraitClause,
  visit_with_TraitRef,
  type TraitClause,
} from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { panic, unwrap } from "../../std/panic.ts";
import { is_vtable_safe_method } from "./dyn_compatibility.ts";
import { VtblSegment } from "./vtable.gen.ts";

export * from "./vtable.gen.ts";

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_TraitClause: TypeFoldable<TraitClause> = { visit_with: visit_with_TraitClause, try_fold_with: try_fold_with_TraitClause, fold_with: fold_with_TraitClause };
const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};

/** `ExistentialTraitRef: PartialEq` (derived): `def_id`, interned `args` (the `()` field is always equal). */
function ExistentialTraitRef_eq(a: ExistentialTraitRef, b: ExistentialTraitRef): boolean {
  return DefId_eq(a.def_id, b.def_id) && a.args === b.args;
}

/// Prepare the segments for a vtable
// FIXME: This should take a `PolyExistentialTraitRef`, since we don't care
// about our `Self` type here.
// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:26 prepare_vtable_segments
export function prepare_vtable_segments<T>(
  tcx: TyCtxt,
  trait_ref: TraitRef,
  segment_visitor: (segment: VtblSegment) => ControlFlow<T>,
): { $: "Some"; _0: T } | undefined {
  const r = prepare_vtable_segments_inner(tcx, trait_ref, segment_visitor);
  return r.$ === "Break" ? { $: "Some", _0: r._0 } : undefined;
}

/** A stack entry of `prepare_vtable_segments_inner`: `(trait_ref, emit_vptr, siblings)`. */
type StackEntry = [TraitRef, boolean, Iterator<TraitRef>];

/// Helper for [`prepare_vtable_segments`] that returns `ControlFlow`,
/// such that we can use `?` in the body.
// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:36 prepare_vtable_segments_inner
function prepare_vtable_segments_inner<T>(tcx: TyCtxt, trait_ref: TraitRef, segment_visitor: (segment: VtblSegment) => ControlFlow<T>): ControlFlow<T> {
  // The following constraints holds for the final arrangement.
  // 1. The whole virtual table of the first direct super trait is included as the
  //    the prefix. If this trait doesn't have any super traits, then this step
  //    consists of the dsa metadata.
  // 2. Then comes the proper pointer metadata(vptr) and all own methods for all
  //    other super traits except those already included as part of the first
  //    direct super trait virtual table.
  // 3. finally, the own methods of this trait.

  // This has the advantage that trait upcasting to the first direct super trait on each level
  // is zero cost, and to another trait includes only replacing the pointer with one level indirection,
  // while not using too much extra memory.

  // For a single inheritance relationship like this,
  //   D --> C --> B --> A
  // The resulting vtable will consists of these segments:
  //  DSA, A, B, C, D

  // For a multiple inheritance relationship like this,
  //   D --> C --> A
  //           \-> B
  // The resulting vtable will consists of these segments:
  //  DSA, A, B, B-vptr, C, D

  // For a diamond inheritance relationship like this,
  //   D --> B --> A
  //     \-> C -/
  // The resulting vtable will consists of these segments:
  //  DSA, A, B, C, C-vptr, D

  // For a more complex inheritance relationship like this:
  //   O --> G --> C --> A
  //     \     \     \-> B
  //     |     |-> F --> D
  //     |           \-> E
  //     |-> N --> J --> H
  //           \     \-> I
  //           |-> M --> K
  //                 \-> L
  // The resulting vtable will consists of these segments:
  //  DSA, A, B, B-vptr, C, D, D-vptr, E, E-vptr, F, F-vptr, G,
  //  H, H-vptr, I, I-vptr, J, J-vptr, K, K-vptr, L, L-vptr, M, M-vptr,
  //  N, N-vptr, O

  // emit dsa segment first.
  let r = segment_visitor(VtblSegment.MetadataDSA);
  if (r.$ === "Break") return r;

  let emit_vptr_on_new_entry = false;
  const visited = PredicateSet.new(tcx);
  const predicate = Predicate_upcast_from_TraitRef(trait_ref, tcx);
  const stack: StackEntry[] = [[trait_ref, emit_vptr_on_new_entry, maybe_iter<TraitRef>(undefined)]];
  visited.insert(predicate);

  // the main traversal loop:
  // basically we want to cut the inheritance directed graph into a few non-overlapping slices of nodes
  // such that each node is emitted after all its descendants have been emitted.
  // so we convert the directed graph into a tree by skipping all previously visited nodes using a visited set.
  // this is done on the fly.
  // Each loop run emits a slice - it starts by find a "childless" unvisited node, backtracking upwards, and it
  // stops after it finds a node that has a next-sibling node.
  // This next-sibling node will used as the starting point of next slice.

  // Example:
  // For a diamond inheritance relationship like this,
  //   D#1 --> B#0 --> A#0
  //     \-> C#1 -/

  // Starting point 0 stack [D]
  // Loop run #0: Stack after diving in is [D B A], A is "childless"
  // after this point, all newly visited nodes won't have a vtable that equals to a prefix of this one.
  // Loop run #0: Emitting the slice [B A] (in reverse order), B has a next-sibling node, so this slice stops here.
  // Loop run #0: Stack after exiting out is [D C], C is the next starting point.
  // Loop run #1: Stack after diving in is [D C], C is "childless", since its child A is skipped(already emitted).
  // Loop run #1: Emitting the slice [D C] (in reverse order). No one has a next-sibling node.
  // Loop run #1: Stack after exiting out is []. Now the function exits.

  outer: for (;;) {
    // dive deeper into the stack, recording the path
    diving_in: for (;;) {
      const inner_most_trait_ref = stack[stack.length - 1]![0];

      const direct_super_traits_iter = direct_super_traits(tcx, inner_most_trait_ref);

      // Find an unvisited supertrait
      const next_super_trait = find(direct_super_traits_iter, (super_trait) => visited.insert(Predicate_upcast_from_TraitRef(super_trait, tcx)));
      if (next_super_trait !== undefined) {
        // Push it to the stack for the next iteration of 'diving_in to pick up
        stack.push([next_super_trait, emit_vptr_on_new_entry, maybe_iter(direct_super_traits_iter)]);
      } else {
        // There are no more unvisited direct super traits, dive-in finished
        break diving_in;
      }
    }

    // emit innermost item, move to next sibling and stop there if possible, otherwise jump to outer level.
    let entry: StackEntry | undefined;
    while ((entry = stack.pop()) !== undefined) {
      const [inner_most_trait_ref, emit_vptr, siblings] = entry;
      // We don't need to emit a vptr for "truly-empty" supertraits, but we *do* need to emit a
      // vptr for supertraits that have no methods, but that themselves have supertraits
      // with methods, so we check if any transitive supertrait has entries here (this includes
      // the trait itself).
      let has_entries = false;
      for (const def_id of supertrait_def_ids(tcx, inner_most_trait_ref.def_id)) {
        if (has_own_existential_vtable_entries(tcx, def_id)) {
          has_entries = true;
          break;
        }
      }

      r = segment_visitor({
        $: "TraitOwnEntries",
        trait_ref: inner_most_trait_ref,
        emit_vptr: emit_vptr && has_entries && !tcx.sess.opts.unstable_opts.no_trait_vptr,
      });
      if (r.$ === "Break") return r;

      // If we've emitted (fed to `segment_visitor`) a trait that has methods present in the vtable,
      // we'll need to emit vptrs from now on.
      emit_vptr_on_new_entry ||= has_entries;

      const next_inner_most_trait_ref = find(siblings, (sibling) => visited.insert(Predicate_upcast_from_TraitRef(sibling, tcx)));
      if (next_inner_most_trait_ref !== undefined) {
        stack.push([next_inner_most_trait_ref, emit_vptr_on_new_entry, siblings]);

        // just pushed a new trait onto the stack, so we need to go through its super traits
        continue outer;
      }
    }

    // the stack is empty, all done
    return ControlFlowC.CONTINUE;
  }
}

/** The `direct_super_traits_iter` of `prepare_vtable_segments_inner` (vtable.rs:131), lazily. */
function* direct_super_traits(tcx: TyCtxt, inner_most_trait_ref: TraitRef): Generator<TraitRef> {
  const clauses = tcx.explicit_super_clauses_of(inner_most_trait_ref.def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>;
  for (const u of EarlyBinder.iter_identity_copied(clauses)) {
    const [clause] = Unnormalized.skip_norm_wip(u);
    const pred = clause.instantiate_supertrait(tcx, Binder.dummy(inner_most_trait_ref, d_TraitRef)).as_trait_clause();
    if (pred === undefined) continue;
    yield tcx.normalize_erasing_late_bound_regions(TypingEnv.fully_monomorphized(), pred, d_TraitClause).trait_ref;
  }
}

/** `Iterator::find`: advances `it` up to and including the first item for which `pred` holds. */
function find<T>(it: Iterator<T>, pred: (x: T) => boolean): T | undefined {
  for (;;) {
    const n = it.next();
    if (n.done) return undefined;
    if (pred(n.value)) return n.value;
  }
}

/// Turns option of iterator into an iterator (this is just flatten)
// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:190 maybe_iter
function maybe_iter<T>(i: Iterator<T> | undefined): Iterator<T> {
  return i ?? [][Symbol.iterator]();
}

// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:194 has_own_existential_vtable_entries
function has_own_existential_vtable_entries(tcx: TyCtxt, trait_def_id: DefId): boolean {
  return !own_existential_vtable_entries_iter(tcx, trait_def_id).next().done;
}

// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:198 own_existential_vtable_entries
function own_existential_vtable_entries(tcx: TyCtxt, trait_def_id: DefId): readonly DefId[] {
  return Array.from(own_existential_vtable_entries_iter(tcx, trait_def_id));
}

// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:202 own_existential_vtable_entries_iter
function* own_existential_vtable_entries_iter(tcx: TyCtxt, trait_def_id: DefId): Generator<DefId> {
  const trait_methods = AssocItems.in_definition_order(tcx.associated_items(trait_def_id) as AssocItems);

  // Now list each method's DefId (for within its trait).
  for (const trait_method of trait_methods) {
    if (!AssocItem.is_fn(trait_method)) continue;
    const own_entry = own_existential_vtable_entry(tcx, trait_def_id, trait_method);
    if (own_entry !== undefined) yield own_entry;
  }
}

/** The `filter_map` closure of `own_existential_vtable_entries_iter` (vtable.rs:209). */
function own_existential_vtable_entry(tcx: TyCtxt, trait_def_id: DefId, trait_method: AssocItemT): DefId | undefined {
  // debug!("own_existential_vtable_entry: trait_method={:?}", trait_method);
  const def_id = trait_method.def_id;

  // Final methods should not be included in the vtable.
  if (Defaultness.is_final(AssocItem.defaultness(trait_method, tcx))) {
    return undefined;
  }

  // Some methods cannot be called on an object; skip those.
  if (!is_vtable_safe_method(tcx, trait_def_id, trait_method)) {
    // debug!("own_existential_vtable_entry: not vtable safe");
    return undefined;
  }

  return def_id;
}

/// Given a trait `trait_ref`, iterates the vtable entries
/// that come from `trait_ref`, including its supertraits.
// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:233 vtable_entries
function vtable_entries(tcx: TyCtxt, trait_ref: TraitRef): readonly VtblEntry[] {
  // debug_assert!(!trait_ref.has_non_region_infer() && !trait_ref.has_non_region_param());
  tcx.debug_assert_fully_normalized(TypingEnv.fully_monomorphized(), trait_ref, d_TraitRef);

  // debug!("vtable_entries({:?})", trait_ref);

  const entries: VtblEntry[] = [];

  const vtable_segment_callback = (segment: VtblSegment): ControlFlow<null> => {
    switch (segment.$) {
      case "MetadataDSA": {
        entries.push(...COMMON_VTABLE_ENTRIES);
        break;
      }
      case "TraitOwnEntries": {
        const { trait_ref, emit_vptr } = segment;
        const existential_trait_ref = ExistentialTraitRef.erase_self_ty(as_interner(tcx), trait_ref);

        // Lookup the shape of vtable for the trait.
        const own_existential_entries = tcx.own_existential_vtable_entries(existential_trait_ref.def_id);

        for (const def_id of own_existential_entries) {
          entries.push(vtable_entry(tcx, trait_ref, def_id));
        }

        if (emit_vptr) {
          entries.push({ $: "TraitVPtr", _0: trait_ref });
        }
        break;
      }
    }

    return ControlFlowC.CONTINUE;
  };

  prepare_vtable_segments(tcx, trait_ref, vtable_segment_callback);

  return entries;
}

/** The `map` closure over `own_existential_entries` of `vtable_entries` (vtable.rs:256). */
function vtable_entry(tcx: TyCtxt, trait_ref: TraitRef, def_id: DefId): VtblEntry {
  // debug!("vtable_entries: trait_method={:?}", def_id);

  // The method may have some early-bound lifetimes; add regions for those.
  // FIXME: Is this normalize needed?
  const args: GenericArgs = tcx.normalize_erasing_regions(
    TypingEnv.fully_monomorphized(),
    Unnormalized.new_wip(
      RawList.for_item(tcx, def_id, (param, _) => {
        switch (param.kind.$) {
          case "Lifetime":
            return GenericArg.from_Region(tcx.lifetimes.re_erased);
          case "Type":
          case "Const":
            return trait_ref.args[param.index] ?? panic(`index out of bounds: the len is ${trait_ref.args.length} but the index is ${param.index}`);
        }
      }),
    ),
    fold_GenericArgs,
  );

  // It's possible that the method relies on where-clauses that
  // do not hold for this particular set of type parameters.
  // Note that this method could then never be called, so we
  // do not want to try and codegen it, in that case (see #23435).
  if (tcx.instantiate_and_check_impossible_clauses([def_id, args])) {
    // debug!("vtable_entries: clauses do not hold");
    return { $: "Vacant" };
  }

  const instance = Instance.expect_resolve_for_vtable(tcx, TypingEnv.fully_monomorphized(), def_id, args, DUMMY_SP);

  return { $: "Method", _0: instance };
}

// Given a `dyn Subtrait: Supertrait` trait ref, find corresponding first slot
// for `Supertrait`'s methods in the vtable of `Subtrait`.
// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:312 first_method_vtable_slot
export function first_method_vtable_slot(tcx: TyCtxt, key: TraitRef): number {
  // debug_assert!(!key.has_non_region_infer() && !key.has_non_region_param());
  tcx.debug_assert_fully_normalized(TypingEnv.fully_monomorphized(), key, d_TraitRef);

  const k = TraitRef.self_ty(key).kind();
  if (k.$ !== "Dynamic") {
    return bug();
  }
  const source = k._0;
  const source_principal = tcx.instantiate_bound_regions_with_erased(
    PolyExistentialTraitRef.with_self_ty(unwrap(source.principal()), as_interner(tcx), TraitRef.self_ty(key)),
    d_TraitRef,
  );

  // We're monomorphizing a call to a dyn trait object that can never be constructed.
  if (tcx.instantiate_and_check_impossible_clauses([source_principal.def_id, source_principal.args])) {
    return 0;
  }

  const target_principal = ExistentialTraitRef.erase_self_ty(as_interner(tcx), key);

  let vptr_offset = 0;
  const vtable_segment_callback = (segment: VtblSegment): ControlFlow<number> => {
    switch (segment.$) {
      case "MetadataDSA": {
        vptr_offset += COMMON_VTABLE_ENTRIES.length;
        break;
      }
      case "TraitOwnEntries": {
        const vtable_principal = segment.trait_ref;
        const emit_vptr = segment.emit_vptr;
        if (ExistentialTraitRef_eq(ExistentialTraitRef.erase_self_ty(as_interner(tcx), vtable_principal), target_principal)) {
          return ControlFlowC.Break(vptr_offset);
        }

        vptr_offset += tcx.own_existential_vtable_entries(vtable_principal.def_id).length;

        if (emit_vptr) {
          vptr_offset += 1;
        }
        break;
      }
    }
    return ControlFlowC.CONTINUE;
  };

  const r = prepare_vtable_segments(tcx, source_principal, vtable_segment_callback);
  return unwrap(r)._0;
}

/// Given a `dyn Subtrait` and `dyn Supertrait` trait object, find the slot of
/// the trait vptr in the subtrait's vtable.
///
/// A return value of `None` means that the original vtable can be reused.
// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:365 supertrait_vtable_slot
export function supertrait_vtable_slot(
  tcx: TyCtxt,
  key: [
    Ty, // Source -- `dyn Subtrait`.
    Ty, // Target -- `dyn Supertrait` being coerced to.
  ],
): number | undefined {
  // debug_assert!(!key.has_non_region_infer() && !key.has_non_region_param());
  tcx.debug_assert_fully_normalized(TypingEnv.fully_monomorphized(), key, d_Ty_Ty);

  const [source, target] = key;

  // If the target principal is `None`, we can just return `None`.
  const tk = target.kind();
  if (tk.$ !== "Dynamic") {
    return bug();
  }
  const target_data = tk._0;
  const target_principal_ = target_data.principal();
  if (target_principal_ === undefined) return undefined;
  const target_principal = tcx.instantiate_bound_regions_with_erased(target_principal_, d_ExistentialTraitRef);

  // Given that we have a target principal, it is a bug for there not to be a source principal.
  const sk = source.kind();
  if (sk.$ !== "Dynamic") {
    return bug();
  }
  const source_data = sk._0;
  const source_principal = tcx.instantiate_bound_regions_with_erased(
    PolyExistentialTraitRef.with_self_ty(unwrap(source_data.principal()), as_interner(tcx), source),
    d_TraitRef,
  );

  // We're monomorphizing a dyn trait object upcast that can never be constructed.
  if (tcx.instantiate_and_check_impossible_clauses([source_principal.def_id, source_principal.args])) {
    return undefined;
  }

  let vptr_offset = 0;
  const vtable_segment_callback = (segment: VtblSegment): ControlFlow<number | undefined> => {
    switch (segment.$) {
      case "MetadataDSA": {
        vptr_offset += COMMON_VTABLE_ENTRIES.length;
        break;
      }
      case "TraitOwnEntries": {
        const vtable_principal = segment.trait_ref;
        const emit_vptr = segment.emit_vptr;
        vptr_offset += tcx.own_existential_vtable_entries(vtable_principal.def_id).length;
        if (ExistentialTraitRef_eq(ExistentialTraitRef.erase_self_ty(as_interner(tcx), vtable_principal), target_principal)) {
          if (emit_vptr) {
            return ControlFlowC.Break(vptr_offset);
          } else {
            return ControlFlowC.Break(undefined);
          }
        }

        if (emit_vptr) {
          vptr_offset += 1;
        }
        break;
      }
    }
    return ControlFlowC.CONTINUE;
  };

  const r = prepare_vtable_segments(tcx, source_principal, vtable_segment_callback);
  if (r !== undefined) return r._0;
  // This can happen if the trait hierarchy is malformed (e.g., due to
  // missing generics on a supertrait bound). There should already be an error
  // emitted for this, so we just delay the ICE.
  tcx.dcx().delayed_bug(`could not find the supertrait vtable slot for \`${display_Ty(source)}\` -> \`${display_Ty(target)}\``);
  return undefined;
}

// rustc: compiler/rustc_trait_selection/src/traits/vtable.rs:439 provide
export function provide(providers: Providers): void {
  providers.own_existential_vtable_entries = own_existential_vtable_entries;
  providers.vtable_entries = vtable_entries as Providers["vtable_entries"];
  providers.first_method_vtable_slot = first_method_vtable_slot as Providers["first_method_vtable_slot"];
  providers.supertrait_vtable_slot = supertrait_vtable_slot;
}

/** `TypeFoldable` of `(Ty, Ty)` (the `debug_assert_fully_normalized` of `supertrait_vtable_slot`). */
const d_Ty_Ty: TypeFoldable<[Ty, Ty]> = fold_tuple2(fold_Ty, fold_Ty);
