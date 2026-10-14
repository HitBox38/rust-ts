// Port of compiler/rustc_type_ir/src/sty/mod.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into mod.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../../std/panic.ts";
import type { Debug } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import type { FallibleTypeFolder, TypeFolder, TypeVisitor } from "../../rust_ts/tyir_contract.ts";
import type { LateParamRegion, Region } from "./mod.gen.ts";

export * from "./mod.gen.ts";

// PORT: `Region` is an interned type of lane ty-contract (plan-m3 D2); the stand-in until it merges.
export type { Region } from "../../rust_ts/tyir_contract.ts";
// manual `impl Debug for Region` (compiler/rustc_type_ir/src/sty/mod.rs:290): ported by the later tyir / ty lanes
export const debug_Region: Debug<Region> = (_v, _f) => unported("rustc_type_ir::sty::Region Debug (manual impl, compiler/rustc_type_ir/src/sty/mod.rs:290)");
// manual `impl Debug for LateParamRegion` (compiler/rustc_type_ir/src/sty/mod.rs:330): ported by the later tyir / ty lanes
export const debug_LateParamRegion: Debug<LateParamRegion> = (_v, _f) => unported("rustc_type_ir::sty::LateParamRegion Debug (manual impl, compiler/rustc_type_ir/src/sty/mod.rs:330)");
// manual `impl TypeFoldable for Region` (compiler/rustc_type_ir/src/sty/mod.rs:302): ported by the later tyir / ty lanes
export function fold_with_Region(_self: Region, _folder: TypeFolder): Region {
  return unported("TypeFoldable for Region (manual impl, compiler/rustc_type_ir/src/sty/mod.rs:302)");
}
// manual `impl TypeFoldable for Region` (compiler/rustc_type_ir/src/sty/mod.rs:302): ported by the later tyir / ty lanes
export function try_fold_with_Region<E>(_self: Region, _folder: FallibleTypeFolder<E>): Result<Region, E> {
  return unported("TypeFoldable for Region (manual impl, compiler/rustc_type_ir/src/sty/mod.rs:302)");
}
// manual `impl TypeVisitable for Region` (compiler/rustc_type_ir/src/sty/mod.rs:296): ported by the later tyir / ty lanes
export function visit_with_Region<R>(_self: Region, _visitor: TypeVisitor<R>): R {
  return unported("TypeVisitable for Region (manual impl, compiler/rustc_type_ir/src/sty/mod.rs:296)");
}
