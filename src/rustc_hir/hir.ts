// Port of compiler/rustc_hir/src/hir.rs
//
// Types and derived Debug/Clone are generated (tools/codegen/types.ts, set `rustc_hir`; lane
// hir-types). Until that lane merges they come from the stand-in `./hir_standin.ts` (lane hir-visit):
// at merge, root points every `./hir_standin.ts` below (imports and `declare module`) at
// `./hir.gen.ts` and deletes the stand-in. The manual `impl fmt::Debug`s (hir.rs:1357 OwnerNodes,
// :1723 DotDotPos, :3765 FnDeclFlags) are lane hir-types'.
//
// PORT: method placement follows rustc_ast/ast.ts (PORTING §8):
// - Enum methods live on the companion const: `export type X = gen.X; export const X = { ...gen.X, fns }`
//   (the spread keeps the generated unit-variant singletons, when there are any).
// - Structs with inherent fns are generated classes (auto_class). `&self` methods are attached to the
//   prototype (`gen.X.prototype.m = function (this: X, ..) {..}`) and declared via
//   `declare module "./hir_standin.ts"`. Static fns and associated consts are assigned onto the class,
//   re-exported as `export const X = gen.X as typeof gen.X & {..}` plus `export type X = gen.X`.
// - `impl From<A> for B` -> `B.from_A(a)`; `impl Display for X` -> `display_X(v): string`;
//   `impl IntoDiagArg for X` -> `X_into_diag_arg(self, path)` (rustc_errors/diagnostic_impls.ts).
// - `Ty<'hir, AmbigArg>` is `Ty<AmbigArg>` (`AmbigArg` is uninhabited: `never`), `Ty<'hir>` is `Ty`
//   (`Unambig = ()`: `null`). The upstream pointer casts between them are identity casts.
import * as gen from "./hir_standin.ts";

export * from "./hir_standin.ts";

// pub use rustc_ast::{
//     AssignOp, AssignOpKind, AttrId, AttrStyle, BinOp, BinOpKind, BindingMode, BorrowKind,
//     BoundConstness, BoundPolarity, ByRef, CaptureBy, DelimArgs, ImplPolarity, IsAuto,
//     MetaItemInner, MetaItemLit, Movability, Mutability, Pinnedness, UnOp,
// };
export {
  type AssignOp,
  AssignOpKind,
  AttrId,
  AttrStyle,
  type BinOp,
  BinOpKind,
  BindingMode,
  BorrowKind,
  BoundConstness,
  BoundPolarity,
  ByRef,
  CaptureBy,
  DelimArgs,
  ImplPolarity,
  IsAuto,
  MetaItemInner,
  MetaItemLit,
  Movability,
  Mutability,
  Pinnedness,
  UnOp,
} from "../rustc_ast/lib.ts";

void gen;
