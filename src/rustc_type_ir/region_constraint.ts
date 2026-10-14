// Port of compiler/rustc_type_ir/src/region_constraint.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into region_constraint.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../std/panic.ts";
import type { Debug, Fmt } from "../std/fmt.ts";
import type { Assumptions, LeafRegionConstraint } from "./region_constraint.gen.ts";

export * from "./region_constraint.gen.ts";

// manual `impl Debug for Assumptions` (compiler/rustc_type_ir/src/region_constraint.rs:74): ported by the later tyir / ty lanes
export const debug_Assumptions: Debug<Assumptions> = (_v, _f) => unported("rustc_type_ir::region_constraint::Assumptions Debug (manual impl, compiler/rustc_type_ir/src/region_constraint.rs:74)");
// manual `impl Debug for LeafRegionConstraint` (compiler/rustc_type_ir/src/region_constraint.rs:197): ported by the later tyir / ty lanes
export function debug_LeafRegionConstraint<S>(_v: LeafRegionConstraint<S>, _f: Fmt, _debug_S: Debug<S>): string {
  return unported("rustc_type_ir::region_constraint::LeafRegionConstraint Debug (manual impl, compiler/rustc_type_ir/src/region_constraint.rs:197)");
}
