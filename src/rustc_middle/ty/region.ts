// Port of compiler/rustc_middle/src/ty/region.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into region.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../../std/panic.ts";
import type { Debug } from "../../std/fmt.ts";
import type { EarlyParamRegion } from "./region.gen.ts";

export * from "./region.gen.ts";

// manual `impl Debug for EarlyParamRegion` (compiler/rustc_middle/src/ty/region.rs:56): ported by the later tyir / ty lanes
export const debug_EarlyParamRegion: Debug<EarlyParamRegion> = (_v, _f) => unported("rustc_middle::ty::region::EarlyParamRegion Debug (manual impl, compiler/rustc_middle/src/ty/region.rs:56)");
