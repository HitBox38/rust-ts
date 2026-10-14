// Port of compiler/rustc_type_ir/src/ty_kind.rs: skeleton (lane codegen-tyir). The types with their derived Debug / TypeVisitable / TypeFoldable
// impls are generated into ty_kind.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns and manual impls of this file
// are ported by the later tyir / ty lanes (plan-m3 §5 waves 14-15). The stubs below call `unported`.
import { unported } from "../std/panic.ts";
import type { Debug } from "../std/fmt.ts";
import type { FnSig, FnSigKind, InferTy, TyKind, UnsafeBinderInner } from "./ty_kind.gen.ts";

export * from "./ty_kind.gen.ts";

// manual `impl Debug for TyKind` (compiler/rustc_type_ir/src/ty_kind.rs:429): ported by the later tyir / ty lanes
export const debug_TyKind: Debug<TyKind> = (_v, _f) => unported("rustc_type_ir::ty_kind::TyKind Debug (manual impl, compiler/rustc_type_ir/src/ty_kind.rs:429)");
// manual `impl Debug for InferTy` (compiler/rustc_type_ir/src/ty_kind.rs:884): ported by the later tyir / ty lanes
export const debug_InferTy: Debug<InferTy> = (_v, _f) => unported("rustc_type_ir::ty_kind::InferTy Debug (manual impl, compiler/rustc_type_ir/src/ty_kind.rs:884)");
// manual `impl Debug for FnSigKind` (compiler/rustc_type_ir/src/ty_kind.rs:951): ported by the later tyir / ty lanes
export const debug_FnSigKind: Debug<FnSigKind> = (_v, _f) => unported("rustc_type_ir::ty_kind::FnSigKind Debug (manual impl, compiler/rustc_type_ir/src/ty_kind.rs:951)");
// manual `impl Debug for FnSig` (compiler/rustc_type_ir/src/ty_kind.rs:1245): ported by the later tyir / ty lanes
export const debug_FnSig: Debug<FnSig> = (_v, _f) => unported("rustc_type_ir::ty_kind::FnSig Debug (manual impl, compiler/rustc_type_ir/src/ty_kind.rs:1245)");
// manual `impl Debug for UnsafeBinderInner` (compiler/rustc_type_ir/src/ty_kind.rs:1304): ported by the later tyir / ty lanes
export const debug_UnsafeBinderInner: Debug<UnsafeBinderInner> = (_v, _f) => unported("rustc_type_ir::ty_kind::UnsafeBinderInner Debug (manual impl, compiler/rustc_type_ir/src/ty_kind.rs:1304)");
