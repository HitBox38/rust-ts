// Port of compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs (lane trait-sel-traits-c).
//
// PORT notes (file-wide):
// - `pub use rustc_middle::traits::specialization_graph::*;` re-exports the rustc_middle module (types generated there).
// - `#[extension(trait ChildrenExt)] impl Children`: `Children` is a plain data interface with a companion const in
//   rustc_middle, so the private extension trait is the companion `ChildrenExt` (`ChildrenExt.insert(children, ..)`).
// - `#[extension(pub trait GraphExt)] impl Graph`: `Graph` is a generated class, so the methods go on `Graph.prototype`
//   (infcx-contract "Representation" 5). `Graph::insert` / `record_impl_from_cstore` collide with nothing on `Graph`.
// - `FxIndexMap::entry(k).or_default()` inserts an empty entry at the end of the map when `k` is missing; this is kept
//   (`filtered_children` does it too), because it fixes the iteration order of `non_blanket_impls`.
// - `#[instrument]` / `debug!` are tracing only and stay as comments. The `#[derive(Debug)]`s of `FutureCompatOverlapError`
//   and `Inserted` only serve those and are not ported.
// Init order: top-level code here touches only other crates (and `Graph.prototype` of rustc_middle); this crate's modules
// are read inside function bodies only.

import type { SkipLeakCheck } from "../mod.gen.ts";
import type { TraitDef } from "../../../rustc_middle/ty/trait_def.ts";
import type { AssocItem } from "../../../rustc_middle/ty/assoc.gen.ts";
import { AssocItem as AssocItemC } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type SimplifiedType, simplify_type, TreatParams } from "../../../rustc_type_ir/fast_reject.ts";
import { Children, Graph, LeafDef, type Node, type OverlapMode } from "../../../rustc_middle/traits/specialization_graph.ts";
import { Defaultness } from "../../../rustc_hir/lib.ts";
import { type DefId, DefId_eq } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { as_interner, fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.ts";
import type { TraitRef } from "../../../rustc_type_ir/predicate.gen.ts";
import { TraitRef as TraitRefC } from "../../../rustc_type_ir/predicate.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { assert, unwrap } from "../../../std/panic.ts";
import type { OverlapResult } from "../coherence.ts";
import type { OverlapError } from "./mod.ts";

// `pub use rustc_middle::traits::specialization_graph::*;`
export * from "../../../rustc_middle/traits/specialization_graph.ts";

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };


// rustc-type: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:14 FutureCompatOverlapErrorKind
export type FutureCompatOverlapErrorKind = "LeakCheck";
export const FutureCompatOverlapErrorKind = { LeakCheck: "LeakCheck" } as const;

// rustc-type: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:19 FutureCompatOverlapError
export interface FutureCompatOverlapError {
  error: OverlapError;
  kind: FutureCompatOverlapErrorKind;
}

/// The result of attempting to insert an impl into a group of children.
// rustc-type: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:26 Inserted
type Inserted =
  /// The impl was inserted as a new child in this group of children.
  | { readonly $: "BecameNewSibling"; readonly _0: FutureCompatOverlapError | undefined }
  /// The impl should replace existing impls [X1, ..], because the impl specializes X1, X2, etc.
  | { readonly $: "ReplaceChildren"; readonly _0: DefId[] }
  /// The impl is a specialization of an existing child.
  | { readonly $: "ShouldRecurseOn"; readonly _0: DefId };

/** `FxIndexMap::entry(k).or_default()` on `Children.non_blanket_impls`. */
function non_blanket_entry_or_default(self: Children, st: SimplifiedType<DefId>): DefId[] {
  let v = self.non_blanket_impls.get(st);
  if (v === undefined) {
    v = [];
    self.non_blanket_impls.set(st, v);
  }
  return v;
}

/** `DefIdMap::entry(k).or_default()` on `Graph.children`. */
function children_entry_or_default(self: Graph, k: DefId): Children {
  let v = self.children.get(k);
  if (v === undefined) {
    v = Children.default_();
    self.children.set(k, v);
  }
  return v;
}

/** `#[extension(trait ChildrenExt<'tcx>)] impl<'tcx> Children` (PORT: a companion; see the file header). */
const ChildrenExt = {
  /// Insert an impl into this set of children without comparing to any existing impls.
  // rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:40 insert_blindly
  insert_blindly(self: Children, tcx: TyCtxt, impl_def_id: DefId): void {
    const trait_ref = EarlyBinder.skip_binder(tcx.impl_trait_ref(impl_def_id));
    const st = simplify_type(as_interner(tcx), TraitRefC.self_ty(trait_ref), TreatParams.InstantiateWithInfer);
    if (st !== undefined) {
      // debug!("insert_blindly: impl_def_id={:?} st={:?}", impl_def_id, st);
      non_blanket_entry_or_default(self, st).push(impl_def_id);
    } else {
      // debug!("insert_blindly: impl_def_id={:?} st=None", impl_def_id);
      self.blanket_impls.push(impl_def_id);
    }
  },

  /// Removes an impl from this set of children. Used when replacing
  /// an impl with a parent. The impl must be present in the list of
  /// children already.
  // rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:56 remove_existing
  remove_existing(self: Children, tcx: TyCtxt, impl_def_id: DefId): void {
    const trait_ref = EarlyBinder.skip_binder(tcx.impl_trait_ref(impl_def_id));
    let vec: DefId[];
    const st = simplify_type(as_interner(tcx), TraitRefC.self_ty(trait_ref), TreatParams.InstantiateWithInfer);
    if (st !== undefined) {
      // debug!("remove_existing: impl_def_id={:?} st={:?}", impl_def_id, st);
      vec = unwrap(self.non_blanket_impls.get(st));
    } else {
      // debug!("remove_existing: impl_def_id={:?} st=None", impl_def_id);
      vec = self.blanket_impls;
    }

    const i = vec.findIndex((d) => DefId_eq(d, impl_def_id));
    const index = unwrap(i === -1 ? undefined : i);
    vec.splice(index, 1);
  },

  /// Attempt to insert an impl into this set of children, while comparing for
  /// specialization relationships.
  // #[instrument(level = "debug", skip(self, tcx), ret)]
  // rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:76 insert
  insert(self: Children, tcx: TyCtxt, impl_def_id: DefId, simplified_self: SimplifiedType<DefId> | undefined, overlap_mode: OverlapMode): Result<Inserted, OverlapError> {
    const coherence = coherence_mod();
    let last_lint: FutureCompatOverlapError | undefined = undefined;
    const replace_children: DefId[] = [];

    const possible_siblings: PotentialSiblings =
      simplified_self !== undefined
        ? { $: "Filtered", _0: filtered_children(self, simplified_self) }
        : { $: "Unfiltered", _0: iter_children(self) };

    for (let possible_sibling = PotentialSiblings.next(possible_siblings); possible_sibling !== undefined; possible_sibling = PotentialSiblings.next(possible_siblings)) {
      const sibling: DefId = possible_sibling;
      // debug!(?possible_sibling);

      const create_overlap_error = (overlap: OverlapResult): OverlapError => {
        const trait_ref = unwrap(overlap.impl_header.trait_ref);
        const self_ty = TraitRefC.self_ty(trait_ref);

        return {
          with_impl: sibling,
          trait_ref,
          // Only report the `Self` type if it has at least
          // some outer concrete shell; otherwise, it's
          // not adding much information.
          self_ty: self_ty.has_concrete_skeleton() ? self_ty : undefined,
          intercrate_ambiguity_causes: overlap.intercrate_ambiguity_causes,
          involves_placeholder: overlap.involves_placeholder,
          overflowing_predicates: overlap.overflowing_predicates,
        };
      };

      const report_overlap_error = (overlap: OverlapResult, last_lint: { value: FutureCompatOverlapError | undefined }): Result<[boolean, boolean], OverlapError> => {
        // Found overlap, but no specialization; error out or report future-compat warning.

        // Do we *still* get overlap if we disable the future-incompatible modes?
        const should_err = coherence.overlapping_trait_impls(tcx, sibling, impl_def_id, "No" satisfies SkipLeakCheck, overlap_mode) !== undefined;

        const error = create_overlap_error(overlap);

        if (should_err) {
          return Err(error);
        } else {
          last_lint.value = {
            error,
            kind: FutureCompatOverlapErrorKind.LeakCheck,
          };

          return Ok<[boolean, boolean]>([false, false]);
        }
      };

      const last_lint_mut: { value: FutureCompatOverlapError | undefined } = { value: last_lint };
      const overlap = coherence.overlapping_trait_impls(tcx, sibling, impl_def_id, "Yes" satisfies SkipLeakCheck, overlap_mode);
      // `.map_or(Ok((false, false)), |overlap| { .. })?`
      let r: Result<[boolean, boolean], OverlapError>;
      if (overlap === undefined) {
        r = Ok<[boolean, boolean]>([false, false]);
      } else {
        r = ((): Result<[boolean, boolean], OverlapError> => {
          const overlap_kind = tcx.impls_are_allowed_to_overlap(impl_def_id, sibling);
          if (overlap_kind !== undefined) {
            switch (overlap_kind.$) {
              case "Permitted":
                break;
            }

            return Ok<[boolean, boolean]>([false, false]);
          }

          const le = tcx.specializes([impl_def_id, sibling]);
          const ge = tcx.specializes([sibling, impl_def_id]);

          if (le === ge) {
            return report_overlap_error(overlap, last_lint_mut);
          } else {
            return Ok<[boolean, boolean]>([le, ge]);
          }
        })();
      }
      last_lint = last_lint_mut.value;
      if (r.$ === "Err") return r;
      const [le, ge] = r._0;

      if (le && !ge) {
        // debug!(
        //     "descending as child of TraitRef {:?}",
        //     tcx.impl_trait_ref(possible_sibling).instantiate_identity()
        // );

        // The impl specializes `possible_sibling`.
        return Ok({ $: "ShouldRecurseOn", _0: sibling });
      } else if (ge && !le) {
        // debug!(
        //     "placing as parent of TraitRef {:?}",
        //     tcx.impl_trait_ref(possible_sibling).instantiate_identity()
        // );

        replace_children.push(sibling);
      } else {
        // Either there's no overlap, or the overlap was already reported by
        // `overlap_error`.
      }
    }

    if (replace_children.length !== 0) {
      return Ok({ $: "ReplaceChildren", _0: replace_children });
    }

    // No overlap with any potential siblings, so add as a new sibling.
    // debug!("placing as new sibling");
    ChildrenExt.insert_blindly(self, tcx, impl_def_id);
    return Ok({ $: "BecameNewSibling", _0: last_lint });
  },
};

// rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:196 iter_children
function* iter_children(children: Children): Generator<DefId, undefined> {
  // `children.blanket_impls.iter().chain(nonblanket).cloned()`
  yield* children.blanket_impls;
  for (const [, v] of children.non_blanket_impls) {
    yield* v;
  }
  return undefined;
}

// rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:201 filtered_children
function filtered_children(children: Children, st: SimplifiedType<DefId>): Generator<DefId, undefined> {
  // PORT: the `entry(st).or_default()` runs when `filtered_children` is called, not when the iterator is first polled.
  const nonblanket = non_blanket_entry_or_default(children, st);
  return (function* (): Generator<DefId, undefined> {
    yield* children.blanket_impls;
    yield* nonblanket;
    return undefined;
  })();
}

// A custom iterator used by Children::insert
// rustc-type: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:207 PotentialSiblings
type PotentialSiblings = { readonly $: "Unfiltered"; readonly _0: Iterator<DefId, undefined> } | { readonly $: "Filtered"; readonly _0: Iterator<DefId, undefined> };
const PotentialSiblings = {
  // `impl<I, J> Iterator for PotentialSiblings<I, J>`
  // rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:223 next
  next(self: PotentialSiblings): DefId | undefined {
    switch (self.$) {
      case "Unfiltered":
        return self._0.next().value;
      case "Filtered":
        return self._0.next().value;
    }
  },
};

declare module "../../../rustc_middle/traits/specialization_graph.gen.ts" {
  // `#[extension(pub trait GraphExt<'tcx>)] impl<'tcx> Graph`
  interface Graph {
    insert(tcx: TyCtxt, impl_def_id: DefId, overlap_mode: OverlapMode): Result<FutureCompatOverlapError | undefined, OverlapError>;
    record_impl_from_cstore(tcx: TyCtxt, parent: DefId, child: DefId): void;
  }
}

/// Insert a local impl into the specialization graph. If an existing impl
/// conflicts with it (has overlap, but neither specializes the other),
/// information about the area of overlap is returned in the `Err`.
// rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:236 insert
Graph.prototype.insert = function (this: Graph, tcx: TyCtxt, impl_def_id: DefId, overlap_mode: OverlapMode): Result<FutureCompatOverlapError | undefined, OverlapError> {
  assert(impl_def_id.is_local(), "assertion failed: impl_def_id.is_local()");

  // FIXME: use `EarlyBinder` in `self.children`
  const trait_ref = EarlyBinder.skip_binder(tcx.impl_trait_ref(impl_def_id));
  const trait_def_id = trait_ref.def_id;

  // debug!(
  //     "insert({:?}): inserting TraitRef {:?} into specialization graph",
  //     impl_def_id, trait_ref
  // );

  // If the reference itself contains an earlier error (e.g., due to a
  // resolution failure), then we just insert the impl at the top level of
  // the graph and claim that there's no overlap (in order to suppress
  // bogus errors).
  if (TypeVisitableExt.references_error(trait_ref, d_TraitRef)) {
    // debug!(
    //     "insert: inserting dummy node for erroneous TraitRef {:?}, \
    //      impl_def_id={:?}, trait_def_id={:?}",
    //     trait_ref, impl_def_id, trait_def_id
    // );

    this.parent.set(impl_def_id, trait_def_id);
    ChildrenExt.insert_blindly(children_entry_or_default(this, trait_def_id), tcx, impl_def_id);
    return Ok(undefined);
  }

  let parent = trait_def_id;
  let last_lint: FutureCompatOverlapError | undefined = undefined;
  const simplified = simplify_type(as_interner(tcx), TraitRefC.self_ty(trait_ref), TreatParams.InstantiateWithInfer);

  // Descend the specialization tree, where `parent` is the current parent node.
  for (;;) {
    const r = ChildrenExt.insert(children_entry_or_default(this, parent), tcx, impl_def_id, simplified, overlap_mode);
    if (r.$ === "Err") return r;
    const insert_result = r._0;

    if (insert_result.$ === "BecameNewSibling") {
      const opt_lint = insert_result._0;
      last_lint = opt_lint;
      break;
    } else if (insert_result.$ === "ReplaceChildren") {
      const grand_children_to_be = insert_result._0;
      // We currently have
      //
      //     P
      //     |
      //     G
      //
      // and we are inserting the impl N. We want to make it:
      //
      //     P
      //     |
      //     N
      //     |
      //     G

      // Adjust P's list of children: remove G and then add N.
      {
        const siblings = unwrap(this.children.get(parent));
        for (const grand_child_to_be of grand_children_to_be) {
          ChildrenExt.remove_existing(siblings, tcx, grand_child_to_be);
        }
        ChildrenExt.insert_blindly(siblings, tcx, impl_def_id);
      }

      // Set G's parent to N and N's parent to P.
      for (const grand_child_to_be of grand_children_to_be) {
        this.parent.set(grand_child_to_be, impl_def_id);
      }
      this.parent.set(impl_def_id, parent);

      // Add G as N's child.
      for (const grand_child_to_be of grand_children_to_be) {
        ChildrenExt.insert_blindly(children_entry_or_default(this, impl_def_id), tcx, grand_child_to_be);
      }
      break;
    } else {
      const new_parent = insert_result._0;
      parent = new_parent;
    }
  }

  this.parent.set(impl_def_id, parent);
  return Ok(last_lint);
};

/// Insert cached metadata mapping from a child impl back to its parent.
// rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:338 record_impl_from_cstore
Graph.prototype.record_impl_from_cstore = function (this: Graph, tcx: TyCtxt, parent: DefId, child: DefId): void {
  // `self.parent.insert(child, parent).is_some()`
  const had = this.parent.has(child);
  this.parent.set(child, parent);
  if (had) {
    bug("When recording an impl from the crate store, information about its parent was already present.");
  }

  ChildrenExt.insert_blindly(children_entry_or_default(this, parent), tcx, child);
};

/// Locate the definition of an associated type in the specialization hierarchy,
/// starting from the given impl.
// rustc: compiler/rustc_trait_selection/src/traits/specialize/specialization_graph.rs:352 assoc_def
export function assoc_def(tcx: TyCtxt, impl_def_id: DefId, assoc_def_id: DefId): Result<LeafDef, ErrorGuaranteed> {
  const trait_def_id = tcx.impl_trait_id(impl_def_id);
  // PORT: the query value is typed `unknown` in queries.gen.ts.
  const trait_def = tcx.trait_def(trait_def_id) as TraitDef;

  // This function may be called while we are still building the
  // specialization graph that is queried below (via TraitDef::ancestors()),
  // so, in order to avoid unnecessary infinite recursion, we manually look
  // for the associated item at the given impl.
  // If there is no such item in that impl, this function will fail with a
  // cycle error if the specialization graph is currently being built.
  const impl_item_id = tcx.impl_item_implementor_ids(impl_def_id).get(assoc_def_id);
  if (impl_item_id !== undefined) {
    // Ensure that the impl is constrained, otherwise projection may give us
    // bad unconstrained infer vars.
    const local = impl_def_id.as_local();
    if (local !== undefined) {
      const r = tcx.ensure_result().enforce_impl_non_lifetime_params_are_constrained(local);
      if (r.$ === "Err") return r;
    }

    const item = tcx.associated_item(impl_item_id) as AssocItem;
    const impl_node: Node = { $: "Impl", _0: impl_def_id };
    return Ok(new LeafDef(item, impl_node, Defaultness.is_default(AssocItemC.defaultness(item, tcx)) ? undefined : impl_node));
  }

  const ancestors_r = trait_def.ancestors(tcx, impl_def_id);
  if (ancestors_r.$ === "Err") return ancestors_r;
  const ancestors = ancestors_r._0;
  const assoc_item = ancestors.leaf_def(tcx, assoc_def_id);
  if (assoc_item !== undefined) {
    // Ensure that the impl is constrained, otherwise projection may give us
    // bad unconstrained infer vars.
    if (assoc_item.item.container.$ === "TraitImpl") {
      const impl_def_id = AssocItemC.container_id(assoc_item.item, tcx).as_local();
      if (impl_def_id !== undefined) {
        const r = tcx.ensure_result().enforce_impl_non_lifetime_params_are_constrained(impl_def_id);
        if (r.$ === "Err") return r;
      }
    }

    return Ok(assoc_item);
  } else {
    // This is saying that neither the trait nor
    // the impl contain a definition for this
    // associated type. Normally this situation
    // could only arise through a compiler bug --
    // if the user wrote a bad item name, it
    // should have failed during HIR ty lowering.
    return bug(`No associated type \`${Symbol.as_str(tcx.item_name(assoc_def_id))}\` for ${tcx.def_path_str(impl_def_id)}`);
  }
}

// ---- lazy loads (init order: ../coherence.ts imports this module's siblings) -----------------------------------------
function coherence_mod(): typeof import("../coherence.ts") {
  return require("../coherence.ts") as typeof import("../coherence.ts");
}
