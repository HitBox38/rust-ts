// Port of compiler/rustc_type_ir/src/const_kind.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into const_kind.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../std/panic.ts";
import type { Debug } from "../std/fmt.ts";
import type { ConstKind, InferConst } from "./const_kind.gen.ts";

export * from "./const_kind.gen.ts";

// manual `impl Debug for ConstKind` (compiler/rustc_type_ir/src/const_kind.rs:53): ported by the later tyir / ty lanes
export const debug_ConstKind: Debug<ConstKind> = (_v, _f) => unported("rustc_type_ir::const_kind::ConstKind Debug (manual impl, compiler/rustc_type_ir/src/const_kind.rs:53)");
// manual `impl Debug for InferConst` (compiler/rustc_type_ir/src/const_kind.rs:184): ported by the later tyir / ty lanes
export const debug_InferConst: Debug<InferConst> = (_v, _f) => unported("rustc_type_ir::const_kind::InferConst Debug (manual impl, compiler/rustc_type_ir/src/const_kind.rs:184)");
