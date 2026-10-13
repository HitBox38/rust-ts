// Partial port of compiler/rustc_middle/src/hir/mod.rs: `TyCtxt::parent_module_from_def_id`, which
// `TyCtxt::create_def` and `Visibility::to_string` need before HIR exists. The rest of the file (HIR
// maps, owners, `provide`) is M3.
import { type LocalDefId, LocalModId } from "../../rustc_span/def_id.ts";
import { TyCtxt } from "../ty/context.ts";

declare module "../ty/context.ts" {
  interface TyCtxt {
    parent_module_from_def_id(id: LocalDefId): LocalModId;
  }
}

// rustc: compiler/rustc_middle/src/hir/mod.rs:159 parent_module_from_def_id
TyCtxt.prototype.parent_module_from_def_id = function (this: TyCtxt, id: LocalDefId): LocalModId {
  for (let parent = this.opt_local_parent(id); parent !== undefined; parent = this.opt_local_parent(id)) {
    id = parent;
    if (this.def_kind(id).$ === "Mod") {
      break;
    }
  }
  return LocalModId.new_unchecked(id);
};

