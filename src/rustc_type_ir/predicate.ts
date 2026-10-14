// Port of compiler/rustc_type_ir/src/predicate.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into predicate.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../std/panic.ts";
import type { Debug, Fmt } from "../std/fmt.ts";
import type { ExistentialTraitRef, NormalizesTo, ProjectionClause, TraitClause, TraitRef } from "./predicate.gen.ts";

export * from "./predicate.gen.ts";

// manual `impl Debug for TraitClause` (compiler/rustc_type_ir/src/predicate.rs:258): ported by the later tyir / ty lanes
export const debug_TraitClause: Debug<TraitClause> = (_v, _f) => unported("rustc_type_ir::predicate::TraitClause Debug (manual impl, compiler/rustc_type_ir/src/predicate.rs:258)");
// manual `impl Debug for ProjectionClause` (compiler/rustc_type_ir/src/predicate.rs:616): ported by the later tyir / ty lanes
export const debug_ProjectionClause: Debug<ProjectionClause> = (_v, _f) => unported("rustc_type_ir::predicate::ProjectionClause Debug (manual impl, compiler/rustc_type_ir/src/predicate.rs:616)");
// manual `impl Debug for NormalizesTo` (compiler/rustc_type_ir/src/predicate.rs:649): ported by the later tyir / ty lanes
export function debug_NormalizesTo<K>(_v: NormalizesTo<K>, _f: Fmt, _debug_K: Debug<K>): string {
  return unported("rustc_type_ir::predicate::NormalizesTo Debug (manual impl, compiler/rustc_type_ir/src/predicate.rs:649)");
}
// `define_debug_via_print!` (ir_print.rs): ported by the later tyir / ty lanes
export const debug_ExistentialTraitRef: Debug<ExistentialTraitRef> = (_v, _f) => unported("Debug for ExistentialTraitRef (`define_debug_via_print!` (ir_print.rs))");
// `define_debug_via_print!` (ir_print.rs): ported by the later tyir / ty lanes
export const debug_TraitRef: Debug<TraitRef> = (_v, _f) => unported("Debug for TraitRef (`define_debug_via_print!` (ir_print.rs))");
