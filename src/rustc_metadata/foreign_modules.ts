// Port of compiler/rustc_metadata/src/foreign_modules.rs.
//
// PORT: `FxIndexMap<DefId, ForeignModule>` is a `KeyedMap` keyed by `DefId_hash_key` (insertion-ordered, as the
// extern provider in rmeta/decoder/cstore_impl.ts builds it).
import type { ForeignModule } from "../rustc_crate_store/lib.ts";
import { DefId_hash_key } from "../rustc_middle/query/caches.ts";
import type { LocalCrate } from "../rustc_middle/query/keys.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import type { DefId } from "../rustc_span/def_id.ts";

// rustc: compiler/rustc_metadata/src/foreign_modules.rs:9 collect
export function collect(tcx: TyCtxt, _LocalCrate: LocalCrate): KeyedMap<DefId, ForeignModule> {
  const modules = new KeyedMap<DefId, ForeignModule>(DefId_hash_key);

  // We need to collect all the `ForeignMod`, even if they are empty.
  for (const id of tcx.hir_free_items()) {
    if (!(tcx.def_kind(id.owner_id.def_id).$ === "ForeignMod")) {
      continue;
    }

    const def_id = id.owner_id.to_def_id();
    const item = tcx.hir_item(id);

    if (item.kind.$ === "ForeignMod") {
      const { abi, items } = item.kind;
      const foreign_items = items.map((it) => it.owner_id.to_def_id());
      modules.set(def_id, { def_id, abi, foreign_items });
    }
  }

  return modules;
}
