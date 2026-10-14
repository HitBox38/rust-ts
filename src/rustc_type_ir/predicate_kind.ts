// Port of compiler/rustc_type_ir/src/predicate_kind.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into predicate_kind.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../std/panic.ts";
import type { Debug } from "../std/fmt.ts";
import type { ClauseKind, PredicateKind } from "./predicate_kind.gen.ts";

export * from "./predicate_kind.gen.ts";

// manual `impl Debug for ClauseKind` (compiler/rustc_type_ir/src/predicate_kind.rs:110): ported by the later tyir / ty lanes
export const debug_ClauseKind: Debug<ClauseKind> = (_v, _f) => unported("rustc_type_ir::predicate_kind::ClauseKind Debug (manual impl, compiler/rustc_type_ir/src/predicate_kind.rs:110)");
// manual `impl Debug for PredicateKind` (compiler/rustc_type_ir/src/predicate_kind.rs:130): ported by the later tyir / ty lanes
export const debug_PredicateKind: Debug<PredicateKind> = (_v, _f) => unported("rustc_type_ir::predicate_kind::PredicateKind Debug (manual impl, compiler/rustc_type_ir/src/predicate_kind.rs:130)");
