// Port of compiler/rustc_type_ir/src/lib.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into lib.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../std/panic.ts";
import type { Debug } from "../std/fmt.ts";
import type { Variance } from "./lib.gen.ts";

export * from "./lib.gen.ts";

// manual `impl Debug for Variance` (compiler/rustc_type_ir/src/lib.rs:329): ported by the later tyir / ty lanes
export const debug_Variance: Debug<Variance> = (_v, _f) => unported("rustc_type_ir::Variance Debug (manual impl, compiler/rustc_type_ir/src/lib.rs:329)");
