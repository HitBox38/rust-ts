// Port of compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs (lane old-vtable-liveness, wave 18b).
//
// Contract stub (lane selcx-contract). `FreeRegionsVisitor<OP>` is generated (./outlives_for_liveness.gen.ts; the lane
// makes it a `TypeVisitor` with `visit_region` (:512) / `visit_ty` (:521)). The `pub(crate)` fns are signature-typed stubs;
// the private fns (:23 param_known_to_outlive, :369 live_args_for_outlives_clause) are module-local functions. The two
// providers `traits::provide` installs (`live_args_for_alias_from_outlives_bounds`, `args_known_to_outlive_alias_params`)
// stay commented in mod.ts until these are real (the queries keep the driver's placeholder providers).
// Fill: replace the stub bodies, markers `// rustc: compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs:<line> <name>`
// directly above. PORT: `DenseBitSet<u32>` is rustc_index's `DenseBitSet<number>`; `Vec<(usize, DenseBitSet<u32>)>` an
// array of pairs.
// Init order: top-level code here touches only ./outlives_for_liveness.gen.ts and other crates.

import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AliasTyKind } from "../../rustc_type_ir/ty_kind.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { unported } from "../../std/panic.ts";

export * from "./outlives_for_liveness.gen.ts";

function stub(name: string): never {
  return unported(`rustc_trait_selection::traits::outlives_for_liveness::${name}`);
}

// outlives_for_liveness.rs:56 (stub)
export function live_args_for_alias_from_outlives_bounds(_tcx: TyCtxt, _kind: AliasTyKind): DenseBitSet<number> {
  return stub("live_args_for_alias_from_outlives_bounds");
}

// outlives_for_liveness.rs:144 (stub)
export function args_known_to_outlive_alias_params(_tcx: TyCtxt, _def_id: LocalDefId): [number, DenseBitSet<number>][] {
  return stub("args_known_to_outlive_alias_params");
}

// outlives_for_liveness.rs:189 (stub)
export function args_known_to_outlive_opaque_params(_tcx: TyCtxt, _def_id: LocalDefId): [number, DenseBitSet<number>][] {
  return stub("args_known_to_outlive_opaque_params");
}

// outlives_for_liveness.rs:301 (stub)
export function args_known_to_outlive_non_opaque_params(_tcx: TyCtxt, _def_id: LocalDefId): [number, DenseBitSet<number>][] {
  return stub("args_known_to_outlive_non_opaque_params");
}
