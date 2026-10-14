// Port of compiler/rustc_metadata/src/eii.rs
// PORT: ported by lane passes-a (the local `externally_implementable_items` provider, which
// rustc_passes::eii::check_externally_implementable_items calls for `LOCAL_CRATE`).
import { type EiiDecl, type EiiImpl, find_attr } from "../rustc_attr_ir/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { DefId_hash_key } from "../rustc_middle/query/caches.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId } from "../rustc_middle/ty/mod.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { type DefId, debug_DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { bug } from "../rustc_span/macros.ts";

// basically the map below but flattened out
export type EiiMapEncodedKeyValue = [DefId, [EiiDecl, [DefId, EiiImpl][]]];

// PORT: `FxIndexMap<DefId, ..>` is a `KeyedMap` keyed by `DefId_hash_key` (insertion-ordered, as the extern
// provider in rmeta/decoder/cstore_impl.ts builds it).
export type EiiMap = KeyedMap<
  DefId, // the defid of the foreign item associated with the eii
  [
    // the corresponding declaration
    EiiDecl,
    // all the given implementations, indexed by defid.
    // We expect there to be only one, but collect them all to give errors if there are more
    // (or if there are none) in the final crate we build.
    KeyedMap<DefId, EiiImpl>,
  ]
>;

// rustc: compiler/rustc_metadata/src/eii.rs:23 collect
export function collect(tcx: TyCtxt, _: unknown): EiiMap {
  const eiis: EiiMap = new KeyedMap(DefId_hash_key);

  // Needed because Known only stores a DefId (not the full EiiDecl),
  // and we can't call the externally_implementable_items query (cycle).
  const decls_by_foreign_item = new KeyedMap<DefId, EiiDecl>(DefId_hash_key);
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).eiis()) {
    const decl = find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), (k) => (k.$ === "EiiDeclaration" ? k._0 : undefined));
    if (decl !== undefined) {
      decls_by_foreign_item.set(decl.foreign_item, decl);
    }
  }

  // iterate over all items in the current crate
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).eiis()) {
    // if we find a new declaration, add it to the list without a known implementation
    const decl_ = find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), (k) => (k.$ === "EiiDeclaration" ? k._0 : undefined));
    if (decl_ !== undefined) {
      if (!eiis.has(decl_.foreign_item)) {
        eiis.set(decl_.foreign_item, [decl_, new KeyedMap(DefId_hash_key)]);
      }
    }

    const i = find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), (k) => (k.$ === "EiiImpl" ? k._0 : undefined));
    if (i !== undefined) {
      let foreign_item: DefId;
      let decl: EiiDecl;
      switch (i.resolution.$) {
        case "Macro": {
          const macro_defid = i.resolution._0;
          // find the decl for this one if it wasn't in yet (maybe it's from the local crate? not very useful but not illegal)
          const d = find_attr(HasAttrs_DefId.get_attrs(macro_defid, tcx), (k) => (k.$ === "EiiDeclaration" ? k._0 : undefined));
          if (d === undefined) {
            // skip if it doesn't have eii_declaration (if we resolved to another macro that's not an EII)
            tcx.dcx().span_delayed_bug(i.span, "resolved to something that's not an EII");
            continue;
          }
          [foreign_item, decl] = [d.foreign_item, d];
          break;
        }
        // Recover the EiiDecl from the local lookup map.
        case "Known": {
          const foreign_item_did = i.resolution._0;
          const d =
            decls_by_foreign_item.get(foreign_item_did) ??
            bug(`EII impl has Known resolution but can't find EiiDeclaration for ${format_debug(foreign_item_did, debug_DefId, PLAIN)}`);
          [foreign_item, decl] = [foreign_item_did, d];
          break;
        }
        case "Error":
          continue;
      }

      let entry = eiis.get(foreign_item);
      if (entry === undefined) {
        entry = [decl, new KeyedMap(DefId_hash_key)];
        eiis.set(foreign_item, entry);
      }
      entry[1].set(LocalDefId.to_def_id(id), i);
    }
  }

  return eiis;
}
