//! Interface of a Rust codegen backend
//!
//! This crate defines all the traits that have to be implemented by a codegen backend in order to
//! use the backend-agnostic codegen code in `rustc_codegen_ssa`.
//!
//! The interface is designed around two backend-specific data structures, the codegen context and
//! the builder. The codegen context is supposed to be read-only after its creation and during the
//! actual codegen, while the builder stores the information about the function during codegen and
//! is used to produce the instructions of the backend IR.
//!
//! The traits contain associated types that are backend-specific, such as the backend's value or
//! basic blocks.
//
// Port of compiler/rustc_codegen_ssa/src/traits/mod.rs (lane ssa-contract). Conventions (associated types as the
// `B extends BackendTypes` record, provided methods as `<Trait>_provided` helpers): backend.ts's header.
import type { FnAbiOf, LayoutOf, TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { FnAbi } from "../../rustc_target/callconv/mod.ts";
import type { AsmCodegenMethods } from "./asm.ts";
import type { BackendTypes } from "./backend.ts";
import type { ConstCodegenMethods } from "./consts.ts";
import type { DebugInfoCodegenMethods } from "./debuginfo.ts";
import type { PreDefineCodegenMethods } from "./declare.ts";
import type { StaticCodegenMethods } from "./statics.ts";
import type { TypeCodegenMethods } from "./type_.ts";

export type { AbiBuilderMethods } from "./abi.ts";
export type { AsmBuilderMethods, AsmCodegenMethods, GlobalAsmOperandRef, InlineAsmOperandRef } from "./asm.ts";
export {
  type BackendTypes,
  type BackendTypesOf,
  type CodegenBackend,
  CodegenBackend_provided,
  type ExtraBackendMethods,
} from "./backend.ts";
export {
  type BuilderMethods,
  BuilderMethods_provided,
  type BuilderMethodsStatic,
  OverflowOp,
  debug_OverflowOp,
  ReturnSlot,
} from "./builder.ts";
export { type ConstCodegenMethods, ConstCodegenMethods_provided } from "./consts.ts";
export type { CoverageInfoBuilderMethods } from "./coverageinfo.ts";
export { type DebugInfoBuilderMethods, DebugInfoBuilderMethods_provided, type DebugInfoCodegenMethods } from "./debuginfo.ts";
export type { PreDefineCodegenMethods } from "./declare.ts";
export type { IntrinsicCallBuilderMethods } from "./intrinsic.ts";
export { type MiscCodegenMethods, MiscCodegenMethods_provided } from "./misc.ts";
export type { StaticBuilderMethods, StaticCodegenMethods } from "./statics.ts";
export {
  type ArgAbiBuilderMethods,
  type BaseTypeCodegenMethods,
  type DerivedTypeCodegenMethods,
  DerivedTypeCodegenMethods_provided,
  type LayoutTypeCodegenMethods,
  type TypeCodegenMethods,
  type TypeMembershipCodegenMethods,
  TypeMembershipCodegenMethods_provided,
} from "./type_.ts";
export {
  type ModuleBufferMethods,
  ModuleBufferMethods_for_Infallible,
  type WriteBackendMethods,
  WriteBackendMethods_provided,
  type WriteBackendTypes,
} from "./write.ts";

// pub trait CodegenObject = Copy + fmt::Debug;
// PORT (ssa-contract): no TS form. `Copy` is erased; the `Debug` impls are `BackendTypesOf<B>`'s `debug_*` members.

/** `pub trait CodegenMethods<'tcx> = LayoutOf<'tcx, LayoutOfResult = TyAndLayout<'tcx>> + FnAbiOf<'tcx, FnAbiOfResult =
 *  &'tcx FnAbi<'tcx, Ty<'tcx>>> + TypeCodegenMethods<'tcx> + ConstCodegenMethods + StaticCodegenMethods +
 *  DebugInfoCodegenMethods<'tcx> + AsmCodegenMethods<'tcx> + PreDefineCodegenMethods<'tcx>;` (a trait alias: no fns).
 *  PORT (ssa-contract): `LayoutOfResult = TyAndLayout` is `LayoutOf<TyAndLayout, never>` (its `MaybeResult::Error` is
 *  `!`), and likewise `FnAbiOf<.., FnAbi<Ty>, never>` (rustc_middle ty/layout.ts's `R, E, FR, FE`). */
export interface CodegenMethods<B extends BackendTypes>
  extends LayoutOf<TyAndLayout, never>,
    FnAbiOf<TyAndLayout, never, FnAbi<Ty>, never>,
    TypeCodegenMethods<B>,
    ConstCodegenMethods<B>,
    StaticCodegenMethods<B>,
    DebugInfoCodegenMethods<B>,
    AsmCodegenMethods,
    PreDefineCodegenMethods {}
