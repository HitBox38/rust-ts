// Port of compiler/rustc_ast_lowering/src/delegation/generics.rs (STUB, lane lower-delegation: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` / `impl DelegationResolver` methods of this file are declared in ../decls.ts (the
// contract) and assigned onto the prototype here, in upstream order, each with its `// rustc:` marker; until
// then the `unported_methods(..)` calls below install an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AngleBracketedArgs } from "../../rustc_ast/lib.ts";
import type { GenericParamDef } from "../../rustc_middle/ty/generics.ts";
import { unported } from "../../std/panic.ts";
import { DelegationResolver, LoweringContext } from "../decls.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

// Types of this file (PORT: `unknown` until codegen set rustc_ast_lowering generates
// delegation/generics.gen.ts).
/** generics.rs:22 `pub(super) enum GenericsPosition` */
export type GenericsPosition = unknown;
/** generics.rs:28 `pub(super) enum GenericArgSlot<T>` */
export type GenericArgSlot<_T = unknown> = unknown;
/** generics.rs:34 `pub(super) struct DelegationGenerics<T>` */
export type DelegationGenerics<_T = unknown> = unknown;
/** generics.rs:41 `type TyGenerics<'hir> = Vec<GenericArgSlot<&'hir ty::GenericParamDef>>` */
export type TyGenerics = unknown;
/** generics.rs:70 `pub(super) enum HirOrTyGenerics<'hir>` */
export type HirOrTyGenerics = unknown;
/** generics.rs:76 `pub(super) struct GenericsGenerationResult<'hir>` */
export type GenericsGenerationResult = unknown;
/** generics.rs:88 `pub(super) struct GenericsGenerationResults<'hir>` */
export type GenericsGenerationResults = unknown;
/** generics.rs:95 `pub(super) struct DelegationGenericArgsIterator<'hir>` */
export type DelegationGenericArgsIterator = unknown;
/** generics.rs:259 `enum ParentSegmentArgs<'a>` */
export type ParentSegmentArgs = unknown;
/** generics.rs:279 `struct GenericsResolution<'a, 'tcx>` */
export type GenericsResolution = unknown;

unported_methods(DelegationResolver.prototype, "rustc_ast_lowering::delegation::generics::DelegationResolver", [
  "resolve_generics", "get_user_args", "resolve_and_generate_generics", "check_delegation_to_inherent_impl",
]);
// generics.rs:542 (static; final signature: decls.ts `DelegationResolver.create_slots_from_args`)
DelegationResolver.create_slots_from_args = function (
  _tcx: TyCtxt,
  _args: AngleBracketedArgs,
  _params: readonly GenericParamDef[],
  _add_first_self: boolean,
): TyGenerics {
  return unported("rustc_ast_lowering::delegation::generics::DelegationResolver::create_slots_from_args");
};

unported_methods(LoweringContext.prototype, "rustc_ast_lowering::delegation::generics::LoweringContext", [
  "uplift_delegation_generic_params", "generate_lifetime_predicate", "create_generic_arg_path",
  "create_resolved_qpath",
]);
