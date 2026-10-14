// Port of compiler/rustc_type_ir/src/binder.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into binder.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../std/panic.ts";
import type { Debug, Fmt } from "../std/fmt.ts";
import type { Result } from "../std/result.ts";
import type { FallibleTypeFolder, FoldWith, TryFoldWith, TypeFolder, TypeVisitor, VisitWith } from "../rust_ts/tyir_contract.ts";
import type { Binder, BoundRegion, BoundRegionKind, BoundTy, Placeholder } from "./binder.gen.ts";

export * from "./binder.gen.ts";

// manual `impl Debug for Placeholder` (compiler/rustc_type_ir/src/binder.rs:988): ported by the later tyir / ty lanes
export function debug_Placeholder<T>(_v: Placeholder<T>, _f: Fmt, _debug_T: Debug<T>): string {
  return unported("rustc_type_ir::binder::Placeholder Debug (manual impl, compiler/rustc_type_ir/src/binder.rs:988)");
}
// manual `impl Debug for BoundRegionKind` (compiler/rustc_type_ir/src/binder.rs:1021): ported by the later tyir / ty lanes
export const debug_BoundRegionKind: Debug<BoundRegionKind> = (_v, _f) => unported("rustc_type_ir::binder::BoundRegionKind Debug (manual impl, compiler/rustc_type_ir/src/binder.rs:1021)");
// manual `impl Debug for BoundRegion` (compiler/rustc_type_ir/src/binder.rs:1118): ported by the later tyir / ty lanes
export const debug_BoundRegion: Debug<BoundRegion> = (_v, _f) => unported("rustc_type_ir::binder::BoundRegion Debug (manual impl, compiler/rustc_type_ir/src/binder.rs:1118)");
// manual `impl Debug for BoundTy` (compiler/rustc_type_ir/src/binder.rs:1180): ported by the later tyir / ty lanes
export const debug_BoundTy: Debug<BoundTy> = (_v, _f) => unported("rustc_type_ir::binder::BoundTy Debug (manual impl, compiler/rustc_type_ir/src/binder.rs:1180)");
// manual `impl TypeFoldable for Binder` (compiler/rustc_type_ir/src/binder.rs:64): ported by the later tyir / ty lanes
export function fold_with_Binder<T>(_self: Binder<T>, _folder: TypeFolder, _fold_with_T: FoldWith<T>): Binder<T> {
  return unported("TypeFoldable for Binder (manual impl, compiler/rustc_type_ir/src/binder.rs:64)");
}
// manual `impl TypeFoldable for Binder` (compiler/rustc_type_ir/src/binder.rs:64): ported by the later tyir / ty lanes
export function try_fold_with_Binder<T, E>(_self: Binder<T>, _folder: FallibleTypeFolder<E>, _try_fold_with_T: TryFoldWith<T>): Result<Binder<T>, E> {
  return unported("TypeFoldable for Binder (manual impl, compiler/rustc_type_ir/src/binder.rs:64)");
}
// manual `impl TypeVisitable for Binder` (compiler/rustc_type_ir/src/binder.rs:74): ported by the later tyir / ty lanes
export function visit_with_Binder<T, R>(_self: Binder<T>, _visitor: TypeVisitor<R>, _visit_with_T: VisitWith<T>): R {
  return unported("TypeVisitable for Binder (manual impl, compiler/rustc_type_ir/src/binder.rs:74)");
}
