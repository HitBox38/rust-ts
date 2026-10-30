// Port of compiler/rustc_passes/src/fake_doc_items.rs.
//! Collecting fake doc items. This query is used by rustdoc to document attributes, keywords and
//! primitives.
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { DefId_from_OwnerId } from "../rustc_hir_id/lib.ts";
import { type CrateNum, type DefId, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { sym } from "../rustc_span/symbol.ts";

/// Traverse and collect the fake doc items in the current crate
// rustc: compiler/rustc_passes/src/fake_doc_items.rs:11 fake_doc_items
function fake_doc_items(tcx: TyCtxt, _: "LocalCrate"): DefId[] {
  const fake_doc_items: DefId[] = [];

  // Optimization: can this crate even define fake doc items?
  const features = tcx.features().enabled_features();
  if (features.has(sym.rustc_attrs) || features.has(sym.rustdoc_internals)) {
    // Collect fake doc items in this crate.
    for (const item_id of tcx.hir_root_module().item_ids) {
      const id = item_id.hir_id();
      // find_attr!(tcx, id, RustcDocPrimitive(..) | Doc(DocAttribute { keyword: Some(..), .. })
      //                     | Doc(DocAttribute { attribute: Some(..), .. }))
      if (
        find_attr(tcx.hir_attrs(id), (k) =>
          k.$ === "RustcDocPrimitive" || (k.$ === "Doc" && (k._0.keyword !== undefined || k._0.attribute !== undefined)) ? null : undefined,
        ) !== undefined
      ) {
        fake_doc_items.push(DefId_from_OwnerId(id.expect_owner()));
      }
    }
  }

  return fake_doc_items;
}

/// Traverse and collect all the fake doc items in all crates.
// rustc: compiler/rustc_passes/src/fake_doc_items.rs:36 all_fake_doc_items
function all_fake_doc_items(tcx: TyCtxt, _: null): DefId[] {
  const fake_doc_items: DefId[] = [];

  // Collect fake doc items in visible crates.
  const cnums: CrateNum[] = [...tcx.crates(null)].filter((cnum) => tcx.is_user_visible_dep(cnum));
  cnums.push(LOCAL_CRATE);
  for (const cnum of cnums) {
    fake_doc_items.push(...tcx.fake_doc_items(cnum));
  }

  return fake_doc_items;
}

// rustc: compiler/rustc_passes/src/fake_doc_items.rs:53 provide
export function provide(providers: Providers): void {
  providers.fake_doc_items = fake_doc_items;
  providers.all_fake_doc_items = all_fake_doc_items;
}
