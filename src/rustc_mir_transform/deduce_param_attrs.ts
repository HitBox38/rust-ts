// Stub module (lane mt-opt2): compiler/rustc_mir_transform/src/deduce_param_attrs.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
import { unported } from "../std/panic.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
// PORT: the `deduced_param_attrs` query value is `readonly unknown[]` in queries.gen.ts (`&[DeducedParamAttrs]`).
import type { TyCtxt } from "../rustc_middle/ty/context.ts";

// stub: compiler/rustc_mir_transform/src/deduce_param_attrs.rs:174 deduced_param_attrs (lane mt-opt2)
export function deduced_param_attrs(_tcx: TyCtxt, _def_id: LocalDefId): readonly unknown[] {
  return unported("rustc_mir_transform::deduce_param_attrs::deduced_param_attrs");
}
