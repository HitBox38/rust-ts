// Port of compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs (lane coherence).
//
// PORT notes (file-wide):
// - `FxIndexMap<Ident, Span>` is a `KeyedMap` on `Ident`'s `Hash`/`Eq` (name and syntax context, symbol.rs:2574/2580).
// - `FxIndexMap<Symbol, RegionId>` is a `Map` (insertion-ordered); `FxIndexSet<usize>` a `Set`.
// - `IndexVec<RegionId, Option<ConnectedRegion>>` is an array with `undefined` holes: `insert(i, v)` grows the vector
//   to `i + 1` and stores `v`, `remove(i)` takes the value out (`Option::take`), `next_index()` is the length.
// - The `debug!` over the connected regions is tracing only; its arguments are not evaluated, so it stays a comment.
// - `IntercrateAmbiguityCause::add_intercrate_ambiguity_hint` is rustc_trait_selection traits/select/mod.ts's.
// Init order: top-level code here touches only other crates.
import { add_placeholder_note, type OverlapResult, overlapping_inherent_impls } from "../../rustc_trait_selection/traits/coherence.ts";
import { IntercrateAmbiguityCause } from "../../rustc_trait_selection/traits/select/mod.ts";
import { type Diag, E0592, struct_span_code_err } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { OverlapMode } from "../../rustc_middle/traits/specialization_graph.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { display_Ident, type Ident, type Symbol } from "../../rustc_span/symbol.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { unported, unwrap } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";

/** `Result::and` (the argument is already evaluated). */
function and(self: Result<null, ErrorGuaranteed>, res: Result<null, ErrorGuaranteed>): Result<null, ErrorGuaranteed> {
  return self.$ === "Ok" ? res : self;
}

/** `impl Hash for Ident` / `impl PartialEq for Ident` (symbol.rs:2574/2580): the name and the span's syntax context. */
function Ident_key(ident: Ident): string {
  return `${ident.name},${Span.ctxt(ident.span)}`;
}

// rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs:15 crate_inherent_impls_overlap_check
export function crate_inherent_impls_overlap_check(tcx: TyCtxt, _: null): Result<null, ErrorGuaranteed> {
  const inherent_overlap_checker = new InherentOverlapChecker(tcx);
  let res: Result<null, ErrorGuaranteed> = Ok(null);
  for (const id of tcx.hir_free_items()) {
    res = and(res, inherent_overlap_checker.check_item(id));
  }
  return res;
}

// rustc_index::newtype_index! {
//     #[orderable]
//     pub struct RegionId {}
// }
// PORT: `RegionId` is a plain index (number) into `connected_regions`.
type RegionId = number;

// rustc-type: compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs:27 InherentOverlapChecker
class InherentOverlapChecker {
  constructor(public tcx: TyCtxt) {}

  /// Checks whether any associated items in impls 1 and 2 share the same identifier and
  /// namespace.
  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs:39 impls_have_common_items
  impls_have_common_items(impl_items1_: AssocItems, impl_items2_: AssocItems): boolean {
    let impl_items1 = impl_items1_;
    let impl_items2 = impl_items2_;

    // Performance optimization: iterate over the smaller list
    if (AssocItems.len(impl_items1) > AssocItems.len(impl_items2)) {
      [impl_items1, impl_items2] = [impl_items2, impl_items1];
    }

    for (const item1 of AssocItems.in_definition_order(impl_items1)) {
      let collision = false;
      for (const item2 of AssocItems.filter_by_name_unhygienic(impl_items2, AssocItem.name(item1))) {
        if (this.compare_hygienically(item1, item2)) {
          collision = true;
          break;
        }
      }

      if (collision) {
        return true;
      }
    }

    return false;
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs:65 compare_hygienically
  compare_hygienically(item1: AssocItem, item2: AssocItem): boolean {
    // Symbols and namespace match, compare hygienically.
    return (
      AssocItem.namespace(item1) === AssocItem.namespace(item2) &&
      AssocItem.ident(item1, this.tcx).normalize_to_macros_2_0().eq(AssocItem.ident(item2, this.tcx).normalize_to_macros_2_0())
    );
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs:72 check_for_duplicate_items_in_impl
  check_for_duplicate_items_in_impl(impl_: DefId): Result<null, ErrorGuaranteed> {
    const impl_items = this.tcx.associated_items(impl_) as AssocItems;

    const seen_items = new KeyedMap<Ident, Span>(Ident_key);
    let res: Result<null, ErrorGuaranteed> = Ok(null);
    for (const impl_item of AssocItems.in_definition_order(impl_items)) {
      const span = this.tcx.def_span(impl_item.def_id);
      const ident = AssocItem.ident(impl_item, this.tcx);

      const norm_ident = ident.normalize_to_macros_2_0();
      const former = seen_items.get(norm_ident);
      if (former !== undefined) {
        res = {
          $: "Err",
          _0: struct_span_code_err(this.tcx.dcx(), span, E0592, `duplicate definitions with name \`${display_Ident(ident)}\``)
            .with_span_label(span, `duplicate definitions for \`${display_Ident(ident)}\``)
            .with_span_label(former, `other definition for \`${display_Ident(ident)}\``)
            .emit_err(),
        };
      } else {
        seen_items.set(norm_ident, span);
      }
    }
    return res;
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs:104 check_for_common_items_in_impls
  check_for_common_items_in_impls(impl1: DefId, impl2: DefId, overlap: OverlapResult): Result<null, ErrorGuaranteed> {
    const impl_items1 = this.tcx.associated_items(impl1) as AssocItems;
    const impl_items2 = this.tcx.associated_items(impl2) as AssocItems;

    let res: Result<null, ErrorGuaranteed> = Ok(null);
    for (const item1 of AssocItems.in_definition_order(impl_items1)) {
      let collision: AssocItem | undefined = undefined;
      for (const item2 of AssocItems.filter_by_name_unhygienic(impl_items2, AssocItem.name(item1))) {
        if (this.compare_hygienically(item1, item2)) {
          collision = item2;
          break;
        }
      }

      if (collision !== undefined) {
        const item2 = collision;
        const name = AssocItem.ident(item1, this.tcx).normalize_to_macros_2_0();
        const err = struct_span_code_err(this.tcx.dcx(), this.tcx.def_span(item1.def_id), E0592, `duplicate definitions with name \`${display_Ident(name)}\``);
        err.span_label(this.tcx.def_span(item1.def_id), `duplicate definitions for \`${display_Ident(name)}\``);
        err.span_label(this.tcx.def_span(item2.def_id), `other definition for \`${display_Ident(name)}\``);

        for (const cause of overlap.intercrate_ambiguity_causes) {
          IntercrateAmbiguityCause.add_intercrate_ambiguity_hint(cause, err);
        }

        if (overlap.involves_placeholder) {
          add_placeholder_note(err);
        }

        res = { $: "Err", _0: err.emit_err() };
      }
    }
    return res;
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs:151 check_for_overlapping_inherent_impls
  check_for_overlapping_inherent_impls(overlap_mode: OverlapMode, impl1_def_id: DefId, impl2_def_id: DefId): Result<null, ErrorGuaranteed> {
    const maybe_overlap = overlapping_inherent_impls(
      this.tcx,
      impl1_def_id,
      impl2_def_id,
      // We go ahead and just skip the leak check for
      // inherent impls without warning.
      "Yes",
      overlap_mode,
    );

    if (maybe_overlap !== undefined) {
      return this.check_for_common_items_in_impls(impl1_def_id, impl2_def_id, maybe_overlap);
    } else {
      return Ok(null);
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/coherence/inherent_impls_overlap.rs:174 check_item
  check_item(id: hir.ItemId): Result<null, ErrorGuaranteed> {
    const def_kind = this.tcx.def_kind(id.owner_id);
    if (!(def_kind.$ === "Enum" || def_kind.$ === "Struct" || def_kind.$ === "Trait" || def_kind.$ === "Union")) {
      return Ok(null);
    }

    const impls = this.tcx.inherent_impls(id.owner_id);
    const overlap_mode = OverlapMode.get(this.tcx, LocalDefId.to_def_id(id.owner_id.def_id));

    const impls_items: [DefId, AssocItems][] = impls.map((impl_def_id) => [impl_def_id, this.tcx.associated_items(impl_def_id) as AssocItems]);

    // Perform a O(n^2) algorithm for small n,
    // otherwise switch to an allocating algorithm with
    // faster asymptotic runtime.
    const ALLOCATING_ALGO_THRESHOLD = 500;
    let res: Result<null, ErrorGuaranteed> = Ok(null);
    if (impls.length < ALLOCATING_ALGO_THRESHOLD) {
      for (let i = 0; i < impls_items.length; i++) {
        const [impl1_def_id, impl_items1] = impls_items[i]!;
        res = and(res, this.check_for_duplicate_items_in_impl(impl1_def_id));

        for (const [impl2_def_id, impl_items2] of impls_items.slice(i + 1)) {
          if (this.impls_have_common_items(impl_items1, impl_items2)) {
            res = and(res, this.check_for_overlapping_inherent_impls(overlap_mode, impl1_def_id, impl2_def_id));
          }
        }
      }
    } else {
      // Build a set of connected regions of impl blocks.
      // Two impl blocks are regarded as connected if they share
      // an item with the same unhygienic identifier.
      // After we have assembled the connected regions,
      // run the O(n^2) algorithm on each connected region.
      // This is advantageous to running the algorithm over the
      // entire graph when there are many connected regions.

      interface ConnectedRegion {
        idents: Symbol[];
        impl_blocks: Set<number>;
      }
      const connected_regions: (ConnectedRegion | undefined)[] = [];
      /** `IndexVec::insert` */
      const insert_region = (index: RegionId, value: ConnectedRegion): void => {
        while (connected_regions.length <= index) connected_regions.push(undefined);
        connected_regions[index] = value;
      };
      /** `IndexVec::remove` (`Option::take` of the slot) */
      const remove_region = (index: RegionId): ConnectedRegion | undefined => {
        const v = connected_regions[index];
        if (index < connected_regions.length) connected_regions[index] = undefined;
        return v;
      };
      // Reverse map from the Symbol to the connected region id.
      const connected_region_ids = new Map<Symbol, RegionId>();

      for (let i = 0; i < impls_items.length; i++) {
        const impl_items = impls_items[i]![1];
        if (AssocItems.len(impl_items) === 0) {
          continue;
        }
        // First obtain a list of existing connected region ids
        const idents_to_add: Symbol[] = [];
        let ids: RegionId[] = [];
        for (const item of AssocItems.in_definition_order(impl_items)) {
          const e = connected_region_ids.get(AssocItem.name(item));
          if (e !== undefined) {
            ids.push(e);
          } else {
            idents_to_add.push(AssocItem.name(item));
          }
        }
        // Sort the id list so that the algorithm is deterministic
        ids.sort((a, b) => a - b);
        ids = ids.filter((v, j) => j === 0 || ids[j - 1] !== v);
        if (ids.length === 0) {
          // Create a new connected region
          const id_to_set = connected_regions.length;
          // Update the connected region ids
          for (const ident of idents_to_add) {
            connected_region_ids.set(ident, id_to_set);
          }
          insert_region(id_to_set, {
            idents: idents_to_add,
            impl_blocks: new Set([i]),
          });
        } else if (ids.length === 1) {
          // Take the only id inside the list
          const id_to_set = ids[0]!;
          const region = unwrap(connected_regions[id_to_set]);
          region.impl_blocks.add(i);
          region.idents.push(...idents_to_add);
          // Update the connected region ids
          for (const ident of idents_to_add) {
            connected_region_ids.set(ident, id_to_set);
          }
        } else {
          // We have multiple connected regions to merge.
          // In the worst case this might add impl blocks
          // one by one and can thus be O(n^2) in the size
          // of the resulting final connected region, but
          // this is no issue as the final step to check
          // for overlaps runs in O(n^2) as well.
          const id_to_set = ids[0]!;
          const region = unwrap(remove_region(id_to_set));
          region.impl_blocks.add(i);
          region.idents.push(...idents_to_add);
          // Update the connected region ids
          for (const ident of idents_to_add) {
            connected_region_ids.set(ident, id_to_set);
          }

          // Remove other regions from ids.
          for (const id of ids) {
            if (id === id_to_set) {
              continue;
            }
            const r = unwrap(remove_region(id));
            for (const ident of r.idents) {
              connected_region_ids.set(ident, id_to_set);
            }
            region.idents.push(...r.idents);
            for (const b of r.impl_blocks) region.impl_blocks.add(b);
          }

          insert_region(id_to_set, region);
        }
      }

      // debug!(
      //     "churning through {} components (sum={}, avg={}, var={}, max={})",
      //     ..
      // );
      // List of connected regions is built. Now, run the overlap check
      // for each pair of impl blocks in the same connected region.
      for (const region of connected_regions) {
        if (region === undefined) continue;
        const impl_blocks = [...region.impl_blocks];
        for (let i = 0; i < impl_blocks.length; i++) {
          const impl1_items_idx = impl_blocks[i]!;
          const [impl1_def_id, impl_items1] = impls_items[impl1_items_idx]!;
          res = and(res, this.check_for_duplicate_items_in_impl(impl1_def_id));

          for (const impl2_items_idx of impl_blocks.slice(i + 1)) {
            const [impl2_def_id, impl_items2] = impls_items[impl2_items_idx]!;
            if (this.impls_have_common_items(impl_items1, impl_items2)) {
              res = and(res, this.check_for_overlapping_inherent_impls(overlap_mode, impl1_def_id, impl2_def_id));
            }
          }
        }
      }
    }
    return res;
  }
}
