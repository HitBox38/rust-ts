//!
//! # The rustc Query System: Query Definitions and Modifiers
//!
// Port of compiler/rustc_middle/src/queries.rs. The `rustc_queries! { .. }` list is generated into
// queries.gen.ts by tools/codegen/queries.ts (PORTING §5 "Macros inside rustc"); this module holds the
// file's hand-written fns and re-exports the generated declarations.
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC, type LocalModId } from "../rustc_span/def_id.ts";
import type { TyCtxt } from "./ty/context.ts";

export * from "./queries.gen.ts";

// rustc: compiler/rustc_middle/src/queries.rs:125 describe_as_module
export function describe_as_module(def_id_: LocalDefId | LocalModId, tcx: TyCtxt): string {
  // `def_id.into()`: `LocalModId` and `LocalDefId` are the same number (into_query_key.ts).
  const def_id = def_id_ as number as LocalDefId;
  if (LocalDefIdC.is_top_level_module(def_id)) {
    return "top-level module";
  } else {
    return `module \`${tcx.def_path_str(def_id)}\``;
  }
}

