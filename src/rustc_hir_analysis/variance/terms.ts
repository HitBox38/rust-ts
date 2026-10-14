// Port of compiler/rustc_hir_analysis/src/variance/terms.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `DroplessArena` is erased (PORTING §5): `arena.alloc(term)` is the term object itself, and `VarianceTermPtr<'a>`
//   (`&'a VarianceTerm<'a>`) is `VarianceTerm`. The `arena` field and parameter are dropped.
// - `InferredIndex(pub usize)` (derives Copy, Clone, Debug) is a branded number, like constrained_generic_params.ts's
//   `Parameter`: `InferredIndex(i)` is `i as InferredIndex`, `.0` is the number itself.
// - `LocalDefIdMap<InferredIndex>` is a `Map<LocalDefId, InferredIndex>` (rustc_span def_id.ts).
// - `debug!` is tracing only and stays as a comment.
// Init order: top-level code here touches only other crates.

// Representing terms
//
// Terms are structured as a straightforward tree. Rather than rely on
// GC, we allocate terms out of a bounded arena (the lifetime of this
// arena is the lifetime 'a that is threaded around).
//
// We assign a unique index to each type/region parameter whose variance
// is to be inferred. We refer to such variables as "inferreds". An
// `InferredIndex` is a newtype'd int representing the index of such
// a variable.

import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { debug_Variance, Variance } from "../../rustc_type_ir/lib.ts";
import { type Debug, debug_int, debug_tuple } from "../../std/fmt.ts";
import { assert } from "../../std/panic.ts";

export type VarianceTermPtr = VarianceTerm;

// #[derive(Copy, Clone, Debug)]
// rustc-type: compiler/rustc_hir_analysis/src/variance/terms.rs:25 InferredIndex
export type InferredIndex = number & { readonly __brand: "InferredIndex" };

/** `#[derive(Debug)]` */
export const debug_InferredIndex: Debug<InferredIndex> = (v, f) => debug_tuple(f, "InferredIndex", [debug_int(v, f)]);

// #[derive(Copy, Clone)]
// rustc-type: compiler/rustc_hir_analysis/src/variance/terms.rs:28 VarianceTerm
export type VarianceTerm =
  | { readonly $: "ConstantTerm"; _0: Variance }
  | { readonly $: "TransformTerm"; _0: VarianceTermPtr; _1: VarianceTermPtr }
  | { readonly $: "InferredTerm"; _0: InferredIndex };

// rustc: compiler/rustc_hir_analysis/src/variance/terms.rs:35 fmt
export const debug_VarianceTerm: Debug<VarianceTerm> = (self, f) => {
  switch (self.$) {
    case "ConstantTerm": {
      const c1 = self._0;
      return debug_Variance(c1, f);
    }
    case "TransformTerm": {
      const [v1, v2] = [self._0, self._1];
      return `(${debug_VarianceTerm(v1, f)} \u{00D7} ${debug_VarianceTerm(v2, f)})`;
    }
    case "InferredTerm": {
      const id = self._0;
      const i = id;
      return `[${i}]`;
    }
  }
};

// The first pass over the crate simply builds up the set of inferreds.

// rustc-type: compiler/rustc_hir_analysis/src/variance/terms.rs:49 TermsContext
export class TermsContext {
  constructor(
    public tcx: TyCtxt,

    /// For marker types, `UnsafeCell`, and other lang items where
    /// variance is hardcoded, records the item-id and the hardcoded
    /// variance.
    public lang_items: [LocalDefId, Variance[]][],

    /// Maps from the node id of an item to the first inferred index
    /// used for its type & region parameters.
    public inferred_starts: Map<LocalDefId, InferredIndex>,

    /// Maps from an InferredIndex to the term for that variable.
    public inferred_terms: VarianceTermPtr[],
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/variance/terms.rs:126 add_inferreds_for_item
  add_inferreds_for_item(def_id: LocalDefId): void {
    const tcx = this.tcx;
    const count = (tcx.generics_of(def_id) as Generics).count();

    if (count === 0) {
      return;
    }

    // Record the start of this item's inferreds.
    const start = this.inferred_terms.length;
    const newly_added = !this.inferred_starts.has(def_id);
    this.inferred_starts.set(def_id, start as InferredIndex);
    assert(newly_added, "assertion failed: newly_added");

    // N.B., in the code below for writing the results back into the
    // `CrateVariancesMap`, we rely on the fact that all inferreds
    // for a particular item are assigned continuous indices.

    for (let i = start; i < start + count; i++) {
      this.inferred_terms.push({ $: "InferredTerm", _0: i as InferredIndex });
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/variance/terms.rs:66 determine_parameters_to_be_inferred
export function determine_parameters_to_be_inferred(tcx: TyCtxt): TermsContext {
  const terms_cx = new TermsContext(tcx, lang_items(tcx), new Map(), []);

  // See the following for a discussion on dep-graph management.
  //
  // - https://rustc-dev-guide.rust-lang.org/query.html
  // - https://rustc-dev-guide.rust-lang.org/variance.html
  const crate_items = tcx.hir_crate_items(null) as ModuleItems;

  for (const def_id of crate_items.definitions()) {
    // debug!("add_inferreds_for_item for item {:?}", def_id);

    const def_kind = tcx.def_kind(def_id);

    switch (def_kind.$) {
      case "Struct":
      case "Union":
      case "Enum": {
        terms_cx.add_inferreds_for_item(def_id);

        const adt = tcx.adt_def(def_id) as AdtDef;
        for (const variant of adt.variants()) {
          const ctor_def_id = variant.ctor_def_id();
          if (ctor_def_id !== undefined) {
            terms_cx.add_inferreds_for_item(ctor_def_id.expect_local());
          }
        }
        break;
      }
      case "Fn":
      case "AssocFn":
        terms_cx.add_inferreds_for_item(def_id);
        break;
      default:
        break;
    }
  }

  return terms_cx;
}

// rustc: compiler/rustc_hir_analysis/src/variance/terms.rs:109 lang_items
function lang_items(tcx: TyCtxt): [LocalDefId, Variance[]][] {
  const lang_items = tcx.lang_items();
  const all: [DefId | undefined, Variance[]][] = [
    [lang_items.phantom_data(), [Variance.Covariant]],
    [lang_items.unsafe_cell_type(), [Variance.Invariant]],
    [lang_items.covariant_unsafe_cell_type(), [Variance.Covariant]],
  ];

  // iterating over (Option<DefId>, Variance)
  const out: [LocalDefId, Variance[]][] = [];
  for (const [d, v] of all) {
    if (d === undefined) continue;
    const def_id = d.as_local(); // LocalDefId
    if (def_id === undefined) continue;
    out.push([def_id, v]);
  }
  return out;
}
