// Partial port of compiler/rustc_middle/src/hir/mod.rs: `TyCtxt::parent_module_from_def_id`, which
// `TyCtxt::create_def` and `Visibility::to_string` need before HIR exists. The rest of the file (HIR
// maps, owners, `provide`) is M3.
import { type LocalDefId, LocalModId } from "../../rustc_span/def_id.ts";
import type { TyCtxt } from "../ty/context.ts";


// rustc: compiler/rustc_middle/src/hir/mod.rs:159 parent_module_from_def_id
export function TyCtxt_parent_module_from_def_id(tcx: TyCtxt, id: LocalDefId): LocalModId {
  for (let parent = tcx.opt_local_parent(id); parent !== undefined; parent = tcx.opt_local_parent(id)) {
    id = parent;
    if (tcx.def_kind(id).$ === "Mod") {
      break;
    }
  }
  return LocalModId.new_unchecked(id);
}

