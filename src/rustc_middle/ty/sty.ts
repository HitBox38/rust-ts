// Port of compiler/rustc_middle/src/ty/sty.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into sty.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../../std/panic.ts";
import type { Debug } from "../../std/fmt.ts";
import type { ParamTy } from "./sty.gen.ts";

export * from "./sty.gen.ts";

// `impl fmt::Debug for ty::ParamTy` (print/pretty.rs): ported by the later tyir / ty lanes
export const debug_ParamTy: Debug<ParamTy> = (_v, _f) => unported("Debug for ParamTy (`impl fmt::Debug for ty::ParamTy` (print/pretty.rs))");
