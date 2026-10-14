// Port of compiler/rustc_ast_lowering/src/lib.rs: the crate root (contract lane lowering-contract; the lib.rs
// port itself is split between lanes lower-lib-a and lower-lib-b, see the two regions below and
// docs/handoff/lowering-contract.md).
//! Lowers the AST to the HIR.
//!
//! Since the AST and HIR are fairly similar, this is mostly a simple procedure,
//! much like a fold. Where lowering involves a bit more work things get more
//! interesting and there are some invariants you should know about. These mostly
//! concern spans and IDs.
//!
//! Spans are assigned to AST nodes during parsing and then are modified during
//! expansion to indicate the origin of a node and the process it went through
//! being expanded. IDs are assigned to AST nodes just before lowering.
//!
//! For the simpler lowering steps, IDs and spans should be preserved. Unlike
//! expansion we do not preserve the process of lowering in the spans, so spans
//! should not be modified here. When creating a new node (as opposed to
//! "folding" an existing one), create a new ID using `next_id()`.
//!
//! You must ensure that IDs are unique. That means that you should only use the
//! ID from an AST node in a single HIR node (you can assume that AST node-IDs
//! are unique). Every new node must have a unique ID. Avoid cloning HIR nodes.
//! If you do, you must then set the new node's ID to a fresh one.
//!
//! Spans are used for error messages and for tools to map semantics back to
//! source code. It is therefore not as important with spans as IDs to be strict
//! about use (you can't break the compiler by screwing up a span). Obviously, a
//! HIR node can only have a single span. But multiple nodes can have the same
//! span and spans don't need to be kept in order, etc. Where code is preserved
//! by lowering, it should have the same span as in the AST. Where HIR nodes are
//! new it is probably best to give a span for the whole AST node being lowered.
//! All nodes should have real spans; don't use dummy spans. Tools are likely to
//! get confused if the spans from leaf AST nodes occur in multiple places
//! in the HIR, especially for multiple identifiers.
//
// Layout and init order (a TDZ ReferenceError at load otherwise):
// - `LoweringContext` (and `DelegationResolver`) are declared in ./decls.ts, the contract. This module
//   imports decls.ts first, then every extension module (the files with `impl LoweringContext` blocks) for
//   their side effects, in upstream `mod` order, and only then attaches lib.rs's own methods.
// - Extension modules' top-level code may touch only ./decls.ts, their own `.gen.ts` and other crates;
//   they read this module's exports (`ImplTraitContext`, `ALLOW_*`, ...) inside function bodies only.
// - Consumers outside the crate import this module only.
// - lib.rs is ported by two lanes: lower-lib-a owns lib.rs:1..1756 (everything up to and including
//   `lower_ty`), lower-lib-b owns lib.rs:1757..3401 (`emit_bad_gca_macro` to the end). Each lane edits only
//   its region and its own import block; contract.test.ts checks that the two `unported_methods` lists
//   split lib.rs's `impl LoweringContext` methods at line 1757.

// ---- lane lower-lib-a imports ----
import type { NodeId } from "../rustc_ast/lib.ts";
import type { Expr } from "../rustc_ast/lib.ts";
import type { AstOwner, ResolverAstLowering } from "../rustc_middle/middle/resolve.ts";
import type { Steal } from "../rustc_data_structures/steal.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import { unported } from "../std/panic.ts";
import type * as hir from "./hir_shim.ts";
import { resolve_type_relative_delegations } from "./delegation/resolution.ts";
// ---- lane lower-lib-b imports ----
// (none yet)
// ---- shared ----
import { unported_methods } from "../rust_ts/stubs.ts";
import { LoweringContext } from "./decls.ts";

// mod asm;
import "./asm.ts";
// mod block;
import "./block.ts";
// mod contract;
import "./contract.ts";
// mod delegation;
import "./delegation/mod.ts";
// mod diagnostics;
import "./diagnostics.ts";
// mod expr;
import "./expr.ts";
// mod format;
import "./format.ts";
// mod index;
import "./index.ts";
// mod item;
import "./item.ts";
// mod pat;
import "./pat.ts";
// mod path;
import "./path.ts";
// pub mod stability;
export * as stability from "./stability.ts";

export { DelegationResolver, LoweringContext } from "./decls.ts";
export type { FreeFns } from "./decls.ts";

// ==== lane lower-lib-a: lib.rs:1..1756 ====

// rustc: compiler/rustc_ast_lowering/src/lib.rs:102 provide
export function provide(providers: QueryProviders): void {
  providers.index_ast = index_ast;
  providers.lower_to_hir = lower_to_hir;
  providers.resolve_type_relative_delegations = resolve_type_relative_delegations;
}

// PORT: `mod re_lowering` (lib.rs:110, `ReloweringChecker`) and the `relowering_checker` field of
// `PerOwnerLoweringState` are `#[cfg(debug_assertions)]`; rustc ships without debug assertions (root decision, merge-w13).
// rustc-skip: compiler/rustc_ast_lowering/src/lib.rs:124 assert_node_is_not_relowered #[cfg(debug_assertions)]-only: the oracle is a release build without debug_assertions
// rustc-skip: compiler/rustc_ast_lowering/src/lib.rs:135 allow_relowering #[cfg(debug_assertions)]-only: the oracle is a release build without debug_assertions

// Types of lib.rs (PORT: `unknown` until codegen set rustc_ast_lowering generates lib.gen.ts; then replace
// these aliases with `export * from "./lib.gen.ts"` + the hand companions).
/** lib.rs:155 `struct PerOwnerLoweringState<'a, 'hir>` (fields + `new` / `owner_id` / `into_owner_info`) */
export type PerOwnerLoweringState = unknown;
/** lib.rs:396 `struct SpanLowerer { is_incremental: bool, def_id: LocalDefId }` (+ `lower`, lib.rs:402) */
export type SpanLowerer = unknown;
/** lib.rs:451 `enum RelaxedBoundPolicy<'a> { Allowed(&'a mut FxIndexMap<DefId, Span>), Forbidden(RelaxedBoundForbiddenReason) }` */
export type RelaxedBoundPolicy = unknown;
/** lib.rs:466 `enum RelaxedBoundForbiddenReason` */
export type RelaxedBoundForbiddenReason = unknown;
/** lib.rs:479 `enum ImplTraitContext` */
export type ImplTraitContext = unknown;
/** lib.rs:510 `enum ImplTraitPosition` (+ `impl Display`, lib.rs:535) */
export type ImplTraitPosition = unknown;
/** lib.rs:565 `enum FnDeclKind` */
export type FnDeclKind = unknown;
/** lib.rs:576 `enum TryBlockScope` */
export type TryBlockScope = unknown;
/** lib.rs:785 `enum ParamMode` */
export type ParamMode = unknown;
/** lib.rs:793 `enum AllowReturnTypeNotation` */
export type AllowReturnTypeNotation = unknown;
/** lib.rs:800 `enum GenericArgsMode` */
export type GenericArgsMode = unknown;
/** lib.rs:812 `enum DiscardParams` */
export type DiscardParams = unknown;

/**
 * PORT: stand-in for `rustc_hir::Arena<'hir>` (compiler/rustc_hir/src/arena.rs, `declare_arena!`), i.e.
 * `tcx.hir_arena`, which `LoweringContext.arena` points at. Arenas are erased (rustc_middle ty/context.ts:
 * `arena`, `hir_arena`; PORTING §5 `&'hir T` -> `T`), so allocating returns the value; slice allocations copy
 * into a fresh array, as the arena copies them. Not a port of any upstream fn; replace it if rustc_hir's
 * arena gets a TS counterpart.
 */
export class HirArena {
  alloc<T>(value: T): T {
    return value;
  }
  alloc_from_iter<T>(iter: Iterable<T>): T[] {
    return [...iter];
  }
  alloc_slice<T>(slice: readonly T[]): T[] {
    return [...slice];
  }
  alloc_index_slice_from_iter<T>(iter: Iterable<T>): T[] {
    return [...iter];
  }
}
/** The one `tcx.hir_arena` (see `HirArena`). */
export const HIR_ARENA: HirArena = new HirArena();

// macro_rules! allow { .. } (lib.rs:329): `static $name: LazyLock<Arc<[Symbol]>>`.
// PORT: frozen arrays; `Arc::clone(&ALLOW_X)` / `self.allow_gen_future().clone()` share them.
export const ALLOW_CONTRACTS: readonly Symbol[] = Object.freeze([sym.contracts_internals]);
export const ALLOW_TRY_TRAIT: readonly Symbol[] = Object.freeze([sym.try_trait_v2, sym.try_trait_v2_residual, sym.yeet_desugar_details]);
export const ALLOW_PATTERN_TYPE: readonly Symbol[] = Object.freeze([sym.pattern_types, sym.pattern_type_range_trait]);
export const ALLOW_GEN_FUTURE: readonly Symbol[] = Object.freeze([sym.gen_future]);
export const ALLOW_GEN_FUTURE_WITH_ASYNC_FN_TRACK_CALLER: readonly Symbol[] = Object.freeze([sym.gen_future, sym.closure_track_caller]);
export const ALLOW_FOR_AWAIT: readonly Symbol[] = Object.freeze([sym.async_gen_internals, sym.async_iterator]);
export const ALLOW_ASYNC_FN_TRAITS: readonly Symbol[] = Object.freeze([sym.async_fn_traits]);
export const ALLOW_ASYNC_GEN: readonly Symbol[] = Object.freeze([sym.async_gen_internals]);
// FIXME(gen_blocks): how does `closure_track_caller`/`async_fn_track_caller`
// interact with `gen`/`async gen` blocks
export const ALLOW_ASYNC_ITERATOR: readonly Symbol[] = Object.freeze([sym.gen_future, sym.async_iterator]);

// lib.rs:350 (static; stub, final signature: decls.ts `LoweringContext.new`)
LoweringContext.new = function (_tcx: TyCtxt, _resolver: ResolverAstLowering, _owner: NodeId): LoweringContext {
  return unported("rustc_ast_lowering::LoweringContext::new");
};

unported_methods(LoweringContext.prototype, "rustc_ast_lowering::LoweringContext", [
  "dcx", "allow_gen_future", "create_def", "next_node_id", "opt_local_def_id", "local_def_id",
  "get_partial_res", "owner_id", "lower_node_id", "next_id", "lower_res", "expect_full_res",
  "lower_import_res", "make_lang_item_qpath", "make_lang_item_path", "mark_span_with_reason", "span_lowerer",
  "lower_span", "lower_ident", "lifetime_res_to_generic_param", "lower_lifetime_binder",
  "with_dyn_type_scope", "with_new_scopes", "lower_attrs", "lower_attrs_with_extra", "lower_attrs_vec",
  "alias_attrs", "lower_assoc_item_constraint", "emit_bad_parenthesized_trait_in_assoc_ty",
  "lower_generic_arg", "lower_ty_alloc", "lower_path_ty", "ty", "ty_tup", "lower_ty",
]);

// lib.rs:414 (stub; final signature: decls.ts `FreeFns`). `#[extension(trait ResolverAstLoweringExt)]` on
// rustc_middle's `ResolverAstLowering`: a free fn taking `self`.
export function ResolverAstLowering_legacy_const_generic_args(_self: ResolverAstLowering, _expr: Expr, _tcx: TyCtxt): number[] | undefined {
  return unported("rustc_ast_lowering::ResolverAstLoweringExt::legacy_const_generic_args");
}

// lib.rs:587 (stub; final signature: decls.ts `FreeFns`)
export function index_ast(_tcx: TyCtxt, _: null): readonly (Steal<[ResolverAstLowering, AstOwner]> | undefined)[] {
  return unported("rustc_ast_lowering::index_ast");
}

// lib.rs:703 (stub; final signature: decls.ts `FreeFns`). The `lower_to_hir` query: `hir_owner` /
// `hir_attr_map` (rustc_middle hir/mod.rs:463, lane middle-hir) and `hir_crate_items` reach HIR through it.
export function lower_to_hir(_tcx: TyCtxt, _def_id: LocalDefId): hir.MaybeOwner {
  return unported("rustc_ast_lowering::lower_to_hir");
}

// ==== lane lower-lib-b: lib.rs:1757..3401 ====

unported_methods(LoweringContext.prototype, "rustc_ast_lowering::LoweringContext", [
  "emit_bad_gca_macro", "lower_ty_direct_lifetime", "lower_opaque_impl_trait", "lower_opaque_inner",
  "lower_precise_capturing_args", "lower_fn_params_to_idents", "lower_fn_decl", "lower_coroutine_fn_ret_ty",
  "lower_coroutine_fn_output_type_to_bound", "lower_param_bound", "lower_lifetime",
  "lower_lifetime_hidden_in_path", "new_named_lifetime", "lower_generic_params_mut", "lower_generic_params",
  "lower_generic_param", "lower_generic_param_kind", "lower_trait_ref", "lower_poly_trait_ref",
  "validate_relaxed_bound", "lower_param_bounds", "lower_param_bounds_mut",
  "lower_universal_param_and_bounds", "lower_block_expr", "lower_array_length_to_const_arg",
  "lower_const_path_to_const_arg", "lower_const_item_rhs", "direct_const_arg_context_enabled_by_gca_macro",
  "ambient_direct_const_arg_context", "can_lower_path_to_const_arg_direct",
  "can_lower_expr_to_const_arg_direct", "lower_path_to_const_arg_direct", "lower_expr_to_const_arg_direct",
  "lower_anon_const_to_const_arg_and_alloc", "lower_anon_const_to_const_arg",
  "lower_anon_const_to_anon_const", "lower_unsafe_source", "lower_trait_bound_modifiers", "stmt",
  "stmt_expr", "stmt_let_pat", "stmt_super_let_pat", "block_expr", "block_all", "pat_cf_continue",
  "pat_cf_break", "pat_some", "pat_none", "single_pat_field", "pat_lang_item_variant", "pat_ident",
  "pat_ident_mut", "pat_ident_binding_mode", "pat_ident_binding_mode_mut", "pat", "pat_without_dbm",
  "ty_path", "elided_dyn_bound",
]);

// Types of lib.rs:3296.. (PORT: `unknown` until lib.gen.ts exists, see above).
/** lib.rs:3296 `struct GenericArgsCtor<'hir>` (+ `is_empty` / `into_generic_args`) */
export type GenericArgsCtor = unknown;
/** lib.rs:3321 `bitflags! { struct DirectConstArgContext: u16 }` (+ `impl DirectConstArgContext`, lib.rs:3340) */
export type DirectConstArgContext = unknown;
/** lib.rs:3371 `struct UnrepresentableConstArgError` (+ `new` / `emit`) */
export type UnrepresentableConstArgError = unknown;
