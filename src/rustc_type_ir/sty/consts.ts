// Port of compiler/rustc_type_ir/src/sty/consts.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into consts.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../../std/panic.ts";
import type { Debug } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import type { FallibleTypeFolder, TypeFolder, TypeVisitor } from "../../rust_ts/tyir_contract.ts";
import type { Const } from "./consts.gen.ts";

export * from "./consts.gen.ts";

// PORT: `Const` is an interned type of lane ty-contract (plan-m3 D2); the stand-in until it merges.
export type { Const } from "../../rust_ts/tyir_contract.ts";
// manual `impl Debug for Const` (compiler/rustc_type_ir/src/sty/consts.rs:24): ported by the later tyir / ty lanes
export const debug_Const: Debug<Const> = (_v, _f) => unported("rustc_type_ir::sty::consts::Const Debug (manual impl, compiler/rustc_type_ir/src/sty/consts.rs:24)");
// manual `impl TypeFoldable for Const` (compiler/rustc_type_ir/src/sty/consts.rs:168): ported by the later tyir / ty lanes
export function fold_with_Const(_self: Const, _folder: TypeFolder): Const {
  return unported("TypeFoldable for Const (manual impl, compiler/rustc_type_ir/src/sty/consts.rs:168)");
}
// manual `impl TypeFoldable for Const` (compiler/rustc_type_ir/src/sty/consts.rs:168): ported by the later tyir / ty lanes
export function try_fold_with_Const<E>(_self: Const, _folder: FallibleTypeFolder<E>): Result<Const, E> {
  return unported("TypeFoldable for Const (manual impl, compiler/rustc_type_ir/src/sty/consts.rs:168)");
}
// manual `impl TypeVisitable for Const` (compiler/rustc_type_ir/src/sty/consts.rs:178): ported by the later tyir / ty lanes
export function visit_with_Const<R>(_self: Const, _visitor: TypeVisitor<R>): R {
  return unported("TypeVisitable for Const (manual impl, compiler/rustc_type_ir/src/sty/consts.rs:178)");
}
