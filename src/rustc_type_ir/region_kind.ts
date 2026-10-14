// Port of compiler/rustc_type_ir/src/region_kind.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into region_kind.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../std/panic.ts";
import type { Debug } from "../std/fmt.ts";
import type { RegionKind } from "./region_kind.gen.ts";

export * from "./region_kind.gen.ts";

// manual `impl Debug for RegionKind` (compiler/rustc_type_ir/src/region_kind.rs:190): ported by the later tyir / ty lanes
export const debug_RegionKind: Debug<RegionKind> = (_v, _f) => unported("rustc_type_ir::region_kind::RegionKind Debug (manual impl, compiler/rustc_type_ir/src/region_kind.rs:190)");
