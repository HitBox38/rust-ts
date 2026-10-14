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
import * as ast from "../rustc_ast/lib.ts";
import type { ControlFlow } from "../rustc_ast_ir/visit.ts";
import type * as attr_ir from "../rustc_attr_ir/lib.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import type { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import { TaggedRef } from "../rustc_data_structures/tagged_ptr.ts";
import { type DiagCtxtHandle, E0203 } from "../rustc_errors/lib.ts";
import { debug_DefKind, DefKind, DefKind_eq, type Res } from "../rustc_hir/def.ts";
import * as rustc_hir from "../rustc_hir/lib.ts";
import type { HirId, ItemLocalId } from "../rustc_hir_id/lib.ts";
import type { PerOwnerResolverData } from "../rustc_middle/middle/resolve.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { debug_Span, DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { debug_Ident, debug_Symbol, display_Symbol, Ident, kw } from "../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_struct, debug_tuple, PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../std/result.ts";
import { to_writer } from "../vendor/bitflags/parser.ts";
import { flags_companion } from "../vendor/bitflags/traits.ts";
import * as diagnostics from "./diagnostics.ts";
import * as expr from "./expr.ts";
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

// PORT(types): views of the lib.rs types of lane lower-lib-a's region that this region reads. lib.ts aliases them to
// `unknown` until codegen set rustc_ast_lowering generates lib.gen.ts; the views have the generated shapes (scratch run
// of that set) and are used only as parameter types and in casts. Root: delete them once the aliases are replaced and
// write the real names (`RelaxedBoundPolicyView` -> `RelaxedBoundPolicy`, ...).
/** lib.rs:155 `PerOwnerLoweringState`: the two fields read here. */
type PerOwnerLoweringStateView = { owner: PerOwnerResolverData; attrs: SortedMap<ItemLocalId, readonly attr_ir.Attribute[]> };
/** lib.rs:451 `RelaxedBoundPolicy<'a>` (`Allowed(&'a mut FxIndexMap<DefId, Span>)`, see `relaxed_bound_policy_allowed`). */
type RelaxedBoundPolicyView = { readonly $: "Allowed"; _0: rustc_hir.def_id.DefIdMap<Span> } | { readonly $: "Forbidden"; _0: RelaxedBoundForbiddenReasonView };
/** lib.rs:466 `RelaxedBoundForbiddenReason` */
type RelaxedBoundForbiddenReasonView = "TraitObjectTy" | "SuperTrait" | "TraitAlias" | "AssocTyBounds" | "WhereBound";
/** lib.rs:565 `FnDeclKind` */
type FnDeclKindView = "Fn" | "Inherent" | "ExternFn" | "Closure" | "Pointer" | "Trait" | "Impl";

/**
 * `RelaxedBoundPolicy::Allowed(&mut Default::default())`.
 * PORT: the `FxIndexMap<DefId, Span>` is a `DefIdMap` (keyed by `DefId` value, insertion-ordered like an `IndexMap`;
 * a plain `Map` would key `DefId` objects by identity). Not a port of an upstream fn.
 */
function relaxed_bound_policy_allowed(): RelaxedBoundPolicyView {
  return { $: "Allowed", _0: new rustc_hir.def_id.DefIdMap<Span>() };
}

/**
 * `expr::WillCreateDefIdsVisitor` (expr.rs:34, lane lower-expr): a unit struct implementing `Visitor` with
 * `type Result = ControlFlow<Span>`.
 * PORT(lane lower-expr): expr.ts has no value export of it yet (an `unknown` alias), so it is looked up at call
 * time and stops as UNPORTED until lower-expr exports the visitor class. Root: replace the calls with
 * `new expr.WillCreateDefIdsVisitor()` at integration. Not a port of an upstream fn.
 */
function WillCreateDefIdsVisitor(): { visit_expr(ex: ast.Expr): ControlFlow<Span> } {
  const V = (expr as Record<string, unknown>)["WillCreateDefIdsVisitor"] as (new () => { visit_expr(ex: ast.Expr): ControlFlow<Span> }) | undefined;
  if (V === undefined) return unported("rustc_ast_lowering::expr::WillCreateDefIdsVisitor");
  return new V();
}

/**
 * `diagnostics::GenericParamDefaultInBinder { span }` (diagnostics.rs:473, `#[derive(Diagnostic)]`, generated as
 * `GenericParamDefaultInBinder_diagnostic`).
 * PORT(codegen): diagnostics.ts has no generated diagnostics yet (lane lower-index-diag), so it is looked up at
 * call time and stops as UNPORTED until then. Root: replace the calls with
 * `diagnostics.GenericParamDefaultInBinder_diagnostic({ span })` at integration. Not a port of an upstream fn.
 */
function GenericParamDefaultInBinder(span: Span): Parameters<DiagCtxtHandle["emit_err"]>[0] {
  const mk = (diagnostics as Record<string, unknown>)["GenericParamDefaultInBinder_diagnostic"] as
    | ((args: { span: Span }) => Parameters<DiagCtxtHandle["emit_err"]>[0])
    | undefined;
  if (mk === undefined) return unported("rustc_ast_lowering::diagnostics::GenericParamDefaultInBinder");
  return mk({ span });
}

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1757 emit_bad_gca_macro
LoweringContext.prototype.emit_bad_gca_macro = function (this: LoweringContext, span: Span, expr: ast.Expr, expected: string): ErrorGuaranteed {
  const msg = `expected ${expected}, found \`gca!()\` constant`;
  if (WillCreateDefIdsVisitor().visit_expr(expr).$ === "Break") {
    // FIXME(mgca): make this non-fatal once we have a better way to handle
    // nested items in invalid `gca!()` arguments.
    return this.dcx().span_fatal(span, msg);
  } else {
    return this.dcx().span_err(span, msg);
  }
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1773 lower_ty_direct_lifetime
LoweringContext.prototype.lower_ty_direct_lifetime = function (this: LoweringContext, t: ast.Ty, region_: ast.Lifetime | undefined): hir.Lifetime {
  let region: ast.Lifetime;
  let syntax: hir.LifetimeSyntax;
  if (region_ !== undefined) {
    [region, syntax] = [region_, rustc_hir.LifetimeSyntax.from(region_.ident)];
  } else {
    const res = (this.curr_owner as PerOwnerLoweringStateView).owner.get_lifetime_res(t.id);
    let id: NodeId;
    if (res !== undefined && res.$ === "ElidedAnchor") {
      const { start, end } = res;
      // `start.plus(1)` (`Idx::plus`: `Self::new(self.index() + amount)`)
      assert_eq(ast.node_id.NodeId.new(ast.node_id.NodeId.index(start) + 1), end, (v) => ast.node_id.debug_NodeId(v, PLAIN));
      id = start;
    } else {
      id = this.next_node_id();
    }
    const span = Span.shrink_to_hi(this.tcx.sess.source_map().start_point(t.span));
    const region__: ast.Lifetime = { ident: Ident.new(kw.UnderscoreLifetime, span), id };
    [region, syntax] = [region__, "Implicit"];
  }
  return this.lower_lifetime(region, rustc_hir.LifetimeSource.Reference, syntax);
};

/// Lowers a `ReturnPositionOpaqueTy` (`-> impl Trait`) or a `TypeAliasesOpaqueTy` (`type F =
/// impl Trait`): this creates the associated Opaque Type (TAIT) definition and then returns a
/// HIR type that references the TAIT.
///
/// Given a function definition like:
///
/// ```rust
/// use std::fmt::Debug;
///
/// fn test<'a, T: Debug>(x: &'a T) -> impl Debug + 'a {
///     x
/// }
/// ```
///
/// we will create a TAIT definition in the HIR like
///
/// ```rust,ignore (pseudo-Rust)
/// type TestReturn<'a, T, 'x> = impl Debug + 'x
/// ```
///
/// and return a type like `TestReturn<'static, T, 'a>`, so that the function looks like:
///
/// ```rust,ignore (pseudo-Rust)
/// fn test<'a, T: Debug>(x: &'a T) -> TestReturn<'static, T, 'a>
/// ```
///
/// Note the subtlety around type parameters! The new TAIT, `TestReturn`, inherits all the
/// type parameters from the function `test` (this is implemented in the query layer, they aren't
/// added explicitly in the HIR). But this includes all the lifetimes, and we only want to
/// capture the lifetimes that are referenced in the bounds. Therefore, we add *extra* lifetime parameters
/// for the lifetimes that get captured (`'x`, in our example above) and reference those.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1830 lower_opaque_impl_trait
LoweringContext.prototype.lower_opaque_impl_trait = function (
  this: LoweringContext,
  span: Span,
  origin: hir.OpaqueTyOrigin<LocalDefId>,
  opaque_ty_node_id: NodeId,
  bounds: ast.GenericBounds,
  itctx: ImplTraitContext,
): hir.TyKind {
  // Make sure we know that some funky desugaring has been going on here.
  // This is a first: there is code in other places like for loop
  // desugaring that explicitly states that we don't want to track that.
  // Not tracking it makes lints in rustc and clippy very fragile, as
  // frequently opened issues show.
  const opaque_ty_span = this.mark_span_with_reason(DesugaringKind.OpaqueTy, span, undefined);

  return this.lower_opaque_inner(opaque_ty_node_id, origin, opaque_ty_span, (this_) => {
    return this_.lower_param_bounds(bounds, relaxed_bound_policy_allowed(), itctx);
  });
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1854 lower_opaque_inner
LoweringContext.prototype.lower_opaque_inner = function (
  this: LoweringContext,
  opaque_ty_node_id: NodeId,
  origin: hir.OpaqueTyOrigin<LocalDefId>,
  opaque_ty_span: Span,
  lower_item_bounds: (this_: LoweringContext) => readonly hir.GenericBound[],
): hir.TyKind {
  const opaque_ty_def_id = this.local_def_id(opaque_ty_node_id);
  const opaque_ty_hir_id = this.lower_node_id(opaque_ty_node_id);
  // debug!(?opaque_ty_def_id, ?opaque_ty_hir_id);

  const bounds = lower_item_bounds(this);
  const opaque_ty_def: hir.OpaqueTy = {
    hir_id: opaque_ty_hir_id,
    def_id: opaque_ty_def_id,
    bounds,
    origin,
    span: this.lower_span(opaque_ty_span),
  };
  // `self.arena.alloc(opaque_ty_def)`: arenas are erased.

  return { $: "OpaqueDef", _0: opaque_ty_def };
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1878 lower_precise_capturing_args
LoweringContext.prototype.lower_precise_capturing_args = function (
  this: LoweringContext,
  precise_capturing_args: readonly ast.PreciseCapturingArg[],
): readonly hir.PreciseCapturingArg[] {
  return precise_capturing_args.map((arg): hir.PreciseCapturingArg => {
    switch (arg.$) {
      case "Lifetime": {
        const lt = arg._0;
        return { $: "Lifetime", _0: this.lower_lifetime(lt, rustc_hir.LifetimeSource.PreciseCapturing, rustc_hir.LifetimeSyntax.from(lt.ident)) };
      }
      case "Arg": {
        const [path, id] = [arg._0, arg._1];
        if (path.segments.length !== 1) {
          return panic();
        }
        const segment = path.segments[0]!;
        const partial_res = this.get_partial_res(id);
        const res: Res<NodeId> =
          partial_res === undefined ? { $: "Err" } : unwrap(partial_res.full_res(), "no partial res expected for precise capture arg");
        return {
          $: "Param",
          _0: {
            hir_id: this.lower_node_id(id),
            ident: this.lower_ident(segment.ident),
            res: this.lower_res(res),
          },
        };
      }
    }
  });
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1902 lower_fn_params_to_idents
LoweringContext.prototype.lower_fn_params_to_idents = function (this: LoweringContext, decl: ast.FnDecl): readonly (Ident | undefined)[] {
  return decl.inputs.map((param): Ident | undefined => {
    const kind = param.pat.kind;
    switch (kind.$) {
      case "Missing":
        return undefined;
      case "Ident":
        return this.lower_ident(kind._1);
      case "Wild":
        return Ident.new(kw.Underscore, this.lower_span(param.pat.span));
      default: {
        this.dcx().span_delayed_bug(param.pat.span, "non-missing/ident/wild param pat must trigger an error");
        return undefined;
      }
    }
  });
};

/// Lowers a function declaration.
///
/// `decl`: the unlowered (AST) function declaration.
///
/// `fn_node_id`: Node Id of the function.
///
/// `fn_hir_id`: Hir Id of the function. Used for attribute parsing.
///
/// `kind`: The kind of function.
///
/// `coro`: If the function is a coroutine, information about the coroutine.
///
/// `discard_params`: if `DiscardParams::Yes`, the parameters are lowered and then discarded. Set this to `DiscardParams::Yes`
/// for functions without bodies, as attributes on parameters are otherwise not validated.
/// Set this to `DiscardParams::No` for functions with bodies, as lowering of the parameters is done by `lower_body`.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1933 lower_fn_decl
LoweringContext.prototype.lower_fn_decl = function (
  this: LoweringContext,
  decl: ast.FnDecl,
  fn_node_id: NodeId,
  fn_hir_id: HirId,
  kind: FnDeclKindView,
  coro: ast.CoroutineMarker | undefined,
  discard_params: DiscardParams,
): hir.FnDecl {
  const c_variadic = decl.c_variadic();
  let splatted = decl.splatted();

  // Skip the `...` (`CVarArgs`) trailing arguments from the AST,
  // as they are not explicit in HIR/Ty function signatures.
  // (instead, the `c_variadic` flag is set to `true`)
  let inputs: readonly ast.Param[] = decl.inputs;
  if (decl.c_variadic()) {
    // Splat + variadic errors in AST validation, so just ignore one of them here.
    splatted = undefined;
    inputs = inputs.slice(0, inputs.length - 1);
  }
  const inputs_ = inputs.map((param) => {
    if (discard_params === "Yes") {
      // FIXME This uses `fn_hir_id`, which is not correct, it should use the parameter hir id instead
      // The parameter is currently not lowered for functions without bodies, so there is no place to store the lowered hir id
      // This should be fixed by storing function parameters in the `hir::FnSig` instead of `hir::Body`
      this.lower_attrs(fn_hir_id, param.attrs, param.span, Target.Param);
    }
    let itctx: ImplTraitContext;
    switch (kind) {
      case "Fn":
      case "Inherent":
      case "Impl":
      case "Trait":
        itctx = { $: "Universal" };
        break;
      case "ExternFn":
        itctx = { $: "Disallowed", _0: "ExternFnParam" };
        break;
      case "Closure":
        itctx = { $: "Disallowed", _0: "ClosureParam" };
        break;
      case "Pointer":
        itctx = { $: "Disallowed", _0: "PointerParam" };
        break;
    }
    return this.lower_ty(param.ty, itctx);
  });

  let output: hir.FnRetTy;
  if (coro !== undefined) {
    const fn_def_id = (this.curr_owner as PerOwnerLoweringStateView).owner.def_id;
    output = this.lower_coroutine_fn_ret_ty(decl.output, fn_def_id, coro, kind);
  } else {
    const decl_output = decl.output;
    switch (decl_output.$) {
      case "Ty": {
        const ty = decl_output._0;
        let itctx: ImplTraitContext;
        switch (kind) {
          case "Fn":
          case "Inherent":
            itctx = {
              $: "OpaqueTy",
              origin: {
                $: "FnReturn",
                parent: (this.curr_owner as PerOwnerLoweringStateView).owner.def_id,
                in_trait_or_impl: undefined,
              },
            };
            break;
          case "Trait":
            itctx = {
              $: "OpaqueTy",
              origin: {
                $: "FnReturn",
                parent: (this.curr_owner as PerOwnerLoweringStateView).owner.def_id,
                in_trait_or_impl: "Trait",
              },
            };
            break;
          case "Impl":
            itctx = {
              $: "OpaqueTy",
              origin: {
                $: "FnReturn",
                parent: (this.curr_owner as PerOwnerLoweringStateView).owner.def_id,
                in_trait_or_impl: "TraitImpl",
              },
            };
            break;
          case "ExternFn":
            itctx = { $: "Disallowed", _0: "ExternFnReturn" };
            break;
          case "Closure":
            itctx = { $: "Disallowed", _0: "ClosureReturn" };
            break;
          case "Pointer":
            itctx = { $: "Disallowed", _0: "PointerReturn" };
            break;
        }
        output = { $: "Return", _0: this.lower_ty_alloc(ty, itctx) };
        break;
      }
      case "Default":
        output = { $: "DefaultReturn", _0: this.lower_span(decl_output._0) };
        break;
    }
  }

  const arg = decl.inputs[0];
  const owner = (this.curr_owner as PerOwnerLoweringStateView).owner;
  const fn_decl_kind = unwrap_result(
    rustc_hir.FnDeclFlags.default_()
      .set_implicit_self(
        arg === undefined
          ? "None"
          : ((): hir.ImplicitSelfKind => {
              const is_mutable_pat = arg.pat.kind.$ === "Ident" && arg.pat.kind._0._1 === "Mut";

              const ty_kind = arg.ty.kind;
              if (ty_kind.$ === "ImplicitSelf" && is_mutable_pat) {
                return "Mut";
              } else if (ty_kind.$ === "ImplicitSelf") {
                return "Imm";
              }
              // Given we are only considering `ImplicitSelf` types, we needn't consider
              // the case where we have a mutable pattern to a reference as that would
              // no longer be an `ImplicitSelf`.
              else if ((ty_kind.$ === "Ref" || ty_kind.$ === "PinnedRef") && ast.TyKind.is_implicit_self(ty_kind._1.kind)) {
                switch (ty_kind._2) {
                  case "Not":
                    return "RefImm";
                  case "Mut":
                    return "RefMut";
                }
              } else {
                return "None";
              }
            })(),
      )
      .set_lifetime_elision_allowed(owner.id === fn_node_id && owner.lifetime_elision_allowed)
      .set_c_variadic(c_variadic)
      .set_splatted(splatted, inputs_.length),
    rustc_hir.debug_SplattedArgIndexError,
  );

  return new rustc_hir.FnDecl(inputs_, output, fn_decl_kind);
};

// Transforms `-> T` for `async fn` into `-> OpaqueTy { .. }`
// combined with the following definition of `OpaqueTy`:
//
//     type OpaqueTy<generics_from_parent_fn> = impl Future<Output = T>;
//
// `output`: unlowered output type (`T` in `-> T`)
// `fn_node_id`: `NodeId` of the parent function (used to create child impl trait definition)
// `opaque_ty_node_id`: `NodeId` of the opaque `impl Trait` type that should be created
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2064 lower_coroutine_fn_ret_ty
LoweringContext.prototype.lower_coroutine_fn_ret_ty = function (
  this: LoweringContext,
  output: ast.FnRetTy,
  fn_def_id: LocalDefId,
  coro: ast.CoroutineMarker,
  fn_kind: FnDeclKindView,
): hir.FnRetTy {
  const span = this.lower_span(ast.FnRetTy.span(output));

  let opaque_ty_node_id: NodeId;
  let allowed_features: readonly Symbol[] | undefined;
  switch (coro.kind) {
    case "Async":
    case "Gen":
      [opaque_ty_node_id, allowed_features] = [coro.return_impl_trait_id, undefined];
      break;
    case "AsyncGen":
      // `Arc::clone(&ALLOW_ASYNC_ITERATOR)`
      [opaque_ty_node_id, allowed_features] = [coro.return_impl_trait_id, ALLOW_ASYNC_ITERATOR];
      break;
  }

  const opaque_ty_span = this.mark_span_with_reason(DesugaringKind.Async, span, allowed_features);

  let in_trait_or_impl: hir.RpitContext | undefined;
  switch (fn_kind) {
    case "Trait":
      in_trait_or_impl = "Trait";
      break;
    case "Impl":
      in_trait_or_impl = "TraitImpl";
      break;
    case "Fn":
    case "Inherent":
      in_trait_or_impl = undefined;
      break;
    case "ExternFn":
    case "Closure":
    case "Pointer":
      return unreachable();
  }

  const opaque_ty_ref = this.lower_opaque_inner(
    opaque_ty_node_id,
    { $: "AsyncFn", parent: fn_def_id, in_trait_or_impl },
    opaque_ty_span,
    (this_) => {
      const bound = this_.lower_coroutine_fn_output_type_to_bound(output, coro, opaque_ty_span, {
        $: "OpaqueTy",
        origin: {
          $: "FnReturn",
          parent: fn_def_id,
          in_trait_or_impl,
        },
      });
      return [bound];
    },
  );

  const opaque_ty = this.ty(opaque_ty_span, opaque_ty_ref);
  return { $: "Return", _0: opaque_ty };
};

/// Transforms `-> T` into `Future<Output = T>`.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2115 lower_coroutine_fn_output_type_to_bound
LoweringContext.prototype.lower_coroutine_fn_output_type_to_bound = function (
  this: LoweringContext,
  output: ast.FnRetTy,
  coro: ast.CoroutineMarker,
  opaque_ty_span: Span,
  itctx: ImplTraitContext,
): hir.GenericBound {
  // Compute the `T` in `Future<Output = T>` from the return type.
  let output_ty: hir.Ty;
  switch (output.$) {
    case "Ty": {
      const ty = output._0;
      // Not `OpaqueTyOrigin::AsyncFn`: that's only used for the
      // `impl Future` opaque type that `async fn` implicitly
      // generates.
      output_ty = this.lower_ty_alloc(ty, itctx);
      break;
    }
    case "Default": {
      const ret_ty_span = output._0;
      output_ty = this.ty_tup(ret_ty_span, []);
      break;
    }
  }

  // "<$assoc_ty_name = T>"
  let assoc_ty_name: Symbol;
  let trait_lang_item: attr_ir.LangItem;
  switch (coro.kind) {
    case "Async":
      [assoc_ty_name, trait_lang_item] = [sym.Output, "Future"];
      break;
    case "Gen":
      [assoc_ty_name, trait_lang_item] = [sym.Item, "Iterator"];
      break;
    case "AsyncGen":
      [assoc_ty_name, trait_lang_item] = [sym.Item, "AsyncIterator"];
      break;
  }

  const bound_args = new rustc_hir.GenericArgs([], [this.assoc_ty_binding(assoc_ty_name, opaque_ty_span, output_ty)], "No", DUMMY_SP);

  return {
    $: "Trait",
    _0: {
      bound_generic_params: [],
      modifiers: rustc_hir.TraitBoundModifiers.NONE,
      trait_ref: new rustc_hir.TraitRef(this.make_lang_item_path(trait_lang_item, opaque_ty_span, bound_args), this.next_id()),
      span: opaque_ty_span,
    },
  };
};

// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2159 lower_param_bound
LoweringContext.prototype.lower_param_bound = function (
  this: LoweringContext,
  tpb: ast.GenericBound,
  rbp: RelaxedBoundPolicyView,
  itctx: ImplTraitContext,
): hir.GenericBound {
  switch (tpb.$) {
    case "Trait": {
      const p = tpb._0;
      return { $: "Trait", _0: this.lower_poly_trait_ref(p, rbp, itctx) };
    }
    case "Outlives": {
      const lifetime = tpb._0;
      return {
        $: "Outlives",
        _0: this.lower_lifetime(lifetime, rustc_hir.LifetimeSource.OutlivesBound, rustc_hir.LifetimeSyntax.from(lifetime.ident)),
      };
    }
    case "Use": {
      const [args, span] = [tpb._0, tpb._1];
      return { $: "Use", _0: this.lower_precise_capturing_args(args), _1: this.lower_span(span) };
    }
  }
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2181 lower_lifetime
LoweringContext.prototype.lower_lifetime = function (
  this: LoweringContext,
  l: ast.Lifetime,
  source: hir.LifetimeSource,
  syntax: hir.LifetimeSyntax,
): hir.Lifetime {
  return this.new_named_lifetime(l.id, l.id, l.ident, source, syntax);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2190 lower_lifetime_hidden_in_path
LoweringContext.prototype.lower_lifetime_hidden_in_path = function (
  this: LoweringContext,
  id: NodeId,
  span: Span,
  angle_brackets: hir.AngleBrackets,
): hir.Lifetime {
  return this.new_named_lifetime(id, id, Ident.new(kw.UnderscoreLifetime, span), { $: "Path", angle_brackets }, "Implicit");
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2206 new_named_lifetime
LoweringContext.prototype.new_named_lifetime = function (
  this: LoweringContext,
  id: NodeId,
  new_id: NodeId,
  ident: Ident,
  source: hir.LifetimeSource,
  syntax: hir.LifetimeSyntax,
): hir.Lifetime {
  let res_: hir.LifetimeKind;
  const res = (this.curr_owner as PerOwnerLoweringStateView).owner.get_lifetime_res(id);
  if (res !== undefined) {
    switch (res.$) {
      case "Param":
        res_ = { $: "Param", _0: res.param };
        break;
      case "Fresh": {
        assert_eq(ident.name, kw.UnderscoreLifetime, (v) => debug_Symbol(v, PLAIN));
        const param = this.local_def_id(res.param);
        res_ = { $: "Param", _0: param };
        break;
      }
      case "Infer":
        assert_eq(ident.name, kw.UnderscoreLifetime, (v) => debug_Symbol(v, PLAIN));
        res_ = rustc_hir.LifetimeKind.Infer;
        break;
      case "Static":
        assert(
          ident.name === kw.StaticLifetime || ident.name === kw.UnderscoreLifetime,
          "assertion failed: matches!(ident.name, kw::StaticLifetime | kw::UnderscoreLifetime)",
        );
        res_ = rustc_hir.LifetimeKind.Static;
        break;
      case "Error":
        res_ = { $: "Error", _0: res._0 };
        break;
      case "ElidedAnchor":
        return panic(`Unexpected \`ElidedAnchar\` ${debug_Ident(ident, PLAIN)} at ${debug_Span(ident.span, PLAIN)}`);
    }
  } else {
    res_ = { $: "Error", _0: this.dcx().span_delayed_bug(ident.span, "unresolved lifetime") };
  }

  // debug!(?res);
  return rustc_hir.Lifetime.new(this.lower_node_id(new_id), this.lower_ident(ident), res_, source, syntax);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2249 lower_generic_params_mut
LoweringContext.prototype.lower_generic_params_mut = function* (
  this: LoweringContext,
  params: readonly ast.GenericParam[],
  source: hir.GenericParamSource,
): Generator<hir.GenericParam> {
  // PORT: `impl Iterator` (lazy `map`) -> a generator, so callers interleave the lowering as upstream does.
  for (const param of params) yield this.lower_generic_param(param, source);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2257 lower_generic_params
LoweringContext.prototype.lower_generic_params = function (
  this: LoweringContext,
  params: readonly ast.GenericParam[],
  source: hir.GenericParamSource,
): readonly hir.GenericParam[] {
  return this.arena.alloc_from_iter(this.lower_generic_params_mut(params, source));
};

// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2266 lower_generic_param
LoweringContext.prototype.lower_generic_param = function (
  this: LoweringContext,
  param: ast.GenericParam,
  source: hir.GenericParamSource,
): hir.GenericParam {
  const [name, kind] = this.lower_generic_param_kind(param, source);

  const hir_id = this.lower_node_id(param.id);
  const param_attrs = param.attrs;
  const param_span = param.span();
  const colon_span = param.colon_span;
  const param_ = new rustc_hir.GenericParam(
    hir_id,
    this.local_def_id(param.id),
    name,
    this.lower_span(param.span()),
    ast.attr.contains_name(param.attrs, sym.may_dangle),
    kind,
    colon_span === undefined ? undefined : this.lower_span(colon_span),
    source,
  );
  // PORT(rustc_hir): `Target::from(&param)` is `impl From<&hir::GenericParam<'_>> for Target`
  // (rustc_hir/src/target_impls.rs:19), which no lane has ported (see handoff lower-lib-b).
  const target: Target = unported("rustc_hir::target_impls::<impl From<&GenericParam> for Target>::from");
  this.lower_attrs(hir_id, param_attrs, param_span, target);
  return param_;
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2290 lower_generic_param_kind
LoweringContext.prototype.lower_generic_param_kind = function (
  this: LoweringContext,
  param: ast.GenericParam,
  source: hir.GenericParamSource,
): [hir.ParamName, hir.GenericParamKind] {
  const param_kind = param.kind;
  switch (param_kind.$) {
    case "Lifetime": {
      // AST resolution emitted an error on those parameters, so we lower them using
      // `ParamName::Error`.
      const ident = this.lower_ident(param.ident);
      const res = (this.curr_owner as PerOwnerLoweringStateView).owner.get_lifetime_res(param.id);
      let param_name: hir.ParamName;
      if (res !== undefined && res.$ === "Error") {
        param_name = { $: "Error", _0: ident };
      } else {
        param_name = { $: "Plain", _0: ident };
      }
      const kind: hir.GenericParamKind = { $: "Lifetime", kind: rustc_hir.LifetimeParamKind.Explicit };

      return [param_name, kind];
    }
    case "Type": {
      const default_ = param_kind.default;
      // Not only do we deny type param defaults in binders but we also map them to `None`
      // since later compiler stages cannot handle them (and shouldn't need to be able to).
      let default__: hir.Ty | undefined = undefined;
      if (default_ !== undefined) {
        // `.filter(|_| match source { .. })`
        let keep: boolean;
        switch (source) {
          case "Generics":
            keep = true;
            break;
          case "Binder": {
            this.dcx().emit_err(GenericParamDefaultInBinder(param.span()));

            keep = false;
            break;
          }
        }
        // `.map(|def| ..)`
        if (keep) {
          const def = default_;
          default__ = this.lower_ty_alloc(def, { $: "Disallowed", _0: "GenericDefault" });
        }
      }

      const kind: hir.GenericParamKind = { $: "Type", default: default__, synthetic: false };

      return [{ $: "Plain", _0: this.lower_ident(param.ident) }, kind];
    }
    case "Const": {
      const [ty, default_] = [param_kind.ty, param_kind.default];
      const ty_ = this.lower_ty_alloc(ty, { $: "Disallowed", _0: "GenericDefault" });

      // Not only do we deny const param defaults in binders but we also map them to `None`
      // since later compiler stages cannot handle them (and shouldn't need to be able to).
      let default__: hir.ConstArg | undefined = undefined;
      if (default_ !== undefined) {
        const anon_const = default_;
        // `.filter(|anon_const| match source { .. })`
        let keep: boolean;
        switch (source) {
          case "Generics":
            keep = true;
            break;
          case "Binder": {
            const err = GenericParamDefaultInBinder(param.span());
            if (WillCreateDefIdsVisitor().visit_expr(anon_const.value).$ === "Break") {
              // FIXME(mgca): make this non-fatal once we have a better way
              // to handle nested items in anno const from binder
              // Issue: https://github.com/rust-lang/rust/issues/123629
              return this.dcx().emit_fatal(err);
            } else {
              this.dcx().emit_err(err);
              keep = false;
            }
            break;
          }
        }
        // `.map(|def| self.lower_anon_const_to_const_arg_and_alloc(def))`
        if (keep) {
          default__ = this.lower_anon_const_to_const_arg_and_alloc(anon_const);
        }
      }

      return [{ $: "Plain", _0: this.lower_ident(param.ident) }, { $: "Const", ty: ty_, default: default__ }];
    }
  }
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2377 lower_trait_ref
LoweringContext.prototype.lower_trait_ref = function (
  this: LoweringContext,
  modifiers: ast.TraitBoundModifiers,
  p: ast.TraitRef,
  itctx: ImplTraitContext,
): hir.TraitRef {
  const qpath = this.lower_qpath(p.ref_id, undefined, p.path, "Explicit", "No", itctx, modifiers);
  let path: hir.Path;
  if (qpath.$ === "Resolved" && qpath._0 === undefined) {
    path = qpath._1;
  } else {
    return panic(`lower_trait_ref: unexpected QPath \`${rustc_hir.debug_QPath(qpath, PLAIN)}\``);
  }
  return new rustc_hir.TraitRef(path, this.lower_node_id(p.ref_id));
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2399 lower_poly_trait_ref
LoweringContext.prototype.lower_poly_trait_ref = function (
  this: LoweringContext,
  _0: ast.PolyTraitRef,
  rbp: RelaxedBoundPolicyView,
  itctx: ImplTraitContext,
): hir.PolyTraitRef {
  // `PolyTraitRef { bound_generic_params, modifiers, trait_ref, span, parens: _ }: &PolyTraitRef`
  const { bound_generic_params, modifiers, trait_ref, span } = _0;
  const bound_generic_params_ = this.lower_lifetime_binder(trait_ref.ref_id, bound_generic_params);
  const trait_ref_ = this.lower_trait_ref(ast.clone_TraitBoundModifiers(modifiers), trait_ref, itctx);
  const modifiers_ = this.lower_trait_bound_modifiers(ast.clone_TraitBoundModifiers(modifiers));

  if (modifiers_.polarity.$ === "Maybe") {
    this.validate_relaxed_bound(trait_ref_, span, rbp);
  }

  return {
    bound_generic_params: bound_generic_params_,
    modifiers: modifiers_,
    trait_ref: trait_ref_,
    span: this.lower_span(span),
  };
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2422 validate_relaxed_bound
LoweringContext.prototype.validate_relaxed_bound = function (
  this: LoweringContext,
  trait_ref: hir.TraitRef,
  span: Span,
  rbp: RelaxedBoundPolicyView,
): void {
  // Even though feature `more_maybe_bounds` enables the user to relax all default bounds
  // other than `Sized` in a lot more positions (thereby bypassing the given policy), we don't
  // want to advertise it to the user (via a feature gate error) since it's super internal.
  //
  // FIXME(more_maybe_bounds): Moreover, if we actually were to add proper default traits
  // (like a hypothetical `Move` or `Leak`) we would want to validate the location according
  // to default trait elaboration in HIR ty lowering (which depends on the specific trait in
  // question: E.g., `?Sized` & `?Move` most likely won't be allowed in all the same places).

  switch (rbp.$) {
    case "Allowed": {
      const dedup_map = rbp._0;
      // `trait_def_id` only returns `None` for errors during resolution.
      const trait_def_id = trait_ref.trait_def_id();
      if (trait_def_id === undefined) return;
      const tcx = this.tcx;
      const err = (s: Span): void => {
        const name = tcx.item_name(trait_def_id);
        tcx.dcx().struct_span_err([span, s], `duplicate relaxed \`${display_Symbol(name)}\` bounds`).with_code(E0203).emit();
      };
      // `dedup_map.entry(trait_def_id).and_modify(|&mut s| err(s)).or_insert(span)`
      if (dedup_map.has(trait_def_id)) {
        err(dedup_map.get(trait_def_id)!);
      } else {
        dedup_map.set(trait_def_id, span);
      }
      return;
    }
    case "Forbidden": {
      const reason = rbp._0;
      const gate = (context: string, subject: string): void => {
        const extended = this.tcx.features().more_maybe_bounds();
        const def_id = trait_ref.trait_def_id();
        // PORT: `TyCtxt::is_lang_item` (rustc_middle/src/middle/lang_items.rs) is not ported yet.
        const is_sized = def_id !== undefined && unported("rustc_middle::middle::lang_items::TyCtxt::is_lang_item");

        if (extended && !is_sized) {
          return;
        }

        const prefix = extended ? "`Sized` " : "";
        const diag = this.dcx().struct_span_err(span, `relaxed ${prefix}bounds are not permitted in ${context}`);
        if (is_sized) {
          diag.note(`${subject} are not implicitly bounded by \`Sized\`, so there is nothing to relax`);
        }
        diag.emit();
      };

      switch (reason) {
        case "TraitObjectTy": {
          gate("trait object types", "trait object types");
          return;
        }
        case "SuperTrait": {
          gate("supertrait bounds", "traits");
          return;
        }
        case "TraitAlias": {
          gate("trait alias bounds", "trait aliases");
          return;
        }
        case "AssocTyBounds":
        case "WhereBound":
          break;
      }
      break;
    }
  }

  this.dcx()
    .struct_span_err(span, "this relaxed bound is not permitted here")
    .with_note("in this context, relaxed bounds are only allowed on type parameters defined on the closest item")
    .emit();
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2509 lower_param_bounds
LoweringContext.prototype.lower_param_bounds = function (
  this: LoweringContext,
  bounds: readonly ast.GenericBound[],
  rbp: RelaxedBoundPolicyView,
  itctx: ImplTraitContext,
): hir.GenericBounds {
  return this.arena.alloc_from_iter(this.lower_param_bounds_mut(bounds, rbp, itctx));
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2518 lower_param_bounds_mut
LoweringContext.prototype.lower_param_bounds_mut = function* (
  this: LoweringContext,
  bounds: readonly ast.GenericBound[],
  rbp: RelaxedBoundPolicyView,
  itctx: ImplTraitContext,
): Generator<hir.GenericBound> {
  // PORT: `impl Iterator` (lazy `map`) -> a generator, so callers interleave the lowering as upstream does.
  // PORT(lane lower-lib-a): `rbp.reborrow()` (lib.rs:457) re-borrows the `&mut` map of `Allowed` and copies the
  // `Forbidden` reason, i.e. the same map and reason in TS; this branch has no value `RelaxedBoundPolicy` yet, so
  // `rbp` is passed as is. Root: at integration write `RelaxedBoundPolicy.reborrow(rbp)` (lower-lib-a's companion).
  for (const bound of bounds) yield this.lower_param_bound(bound, rbp, itctx);
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2528 lower_universal_param_and_bounds
LoweringContext.prototype.lower_universal_param_and_bounds = function (
  this: LoweringContext,
  node_id: NodeId,
  span_: Span,
  ident: Ident,
  bounds: readonly ast.GenericBound[],
): [hir.GenericParam, hir.WherePredicate | undefined, hir.TyKind] {
  // Add a definition for the in-band `Param`.
  const def_id = this.local_def_id(node_id);
  const span = this.lower_span(span_);

  // Set the name to `impl Bound1 + Bound2`.
  const param = new rustc_hir.GenericParam(
    this.lower_node_id(node_id),
    def_id,
    { $: "Plain", _0: this.lower_ident(ident) },
    span,
    false,
    { $: "Type", default: undefined, synthetic: true },
    undefined,
    "Generics",
  );

  const preds = this.lower_generic_bound_predicate(
    ident,
    node_id,
    { $: "Type", default: undefined },
    bounds,
    /* colon_span */ undefined,
    span,
    relaxed_bound_policy_allowed(),
    { $: "Universal" },
    "ImplTrait",
  );

  const hir_id = this.next_id();
  const res: Res = { $: "Def", _0: DefKind.TyParam, _1: rustc_hir.def_id.LocalDefId.to_def_id(def_id) };
  const ty: hir.TyKind = {
    $: "Path",
    _0: {
      $: "Resolved",
      _0: undefined,
      _1: new rustc_hir.Path(span, res, [rustc_hir.PathSegment.new(this.lower_ident(ident), hir_id, res)]),
    },
  };

  return [param, preds, ty];
};

/// Lowers a block directly to an expression, presuming that it
/// has no attributes and is not targeted by a `break`.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2580 lower_block_expr
LoweringContext.prototype.lower_block_expr = function (this: LoweringContext, b: ast.Block): hir.Expr {
  const block = this.lower_block(b, false);
  return this.expr_block(block);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2585 lower_array_length_to_const_arg
LoweringContext.prototype.lower_array_length_to_const_arg = function (this: LoweringContext, c: ast.AnonConst): hir.ConstArg {
  // We cannot just match on `ExprKind::Underscore` as `(_)` is represented as
  // `ExprKind::Paren(ExprKind::Underscore)` and should also be lowered to `GenericArg::Infer`
  //
  // FIXME(gca_macroless_args): Handling of underscores should be moved into
  // lower_expr_to_const_arg_direct. It is left here as retaining compatibility of what is
  // currently allowed on stable gets hairy and annoying otherwise.
  switch (c.value.peel_parens().kind.$) {
    case "Underscore": {
      const ct_kind: hir.ConstArgKind = { $: "Infer", _0: null };
      return new rustc_hir.ConstArg<null>(this.lower_node_id(c.id), ct_kind, this.lower_span(c.value.span));
    }
    default:
      return this.lower_anon_const_to_const_arg_and_alloc(c);
  }
};

/// Used when lowering a type argument that turned out to actually be a const argument.
///
/// Only use for that purpose since otherwise it will create a duplicate def.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2609 lower_const_path_to_const_arg
LoweringContext.prototype.lower_const_path_to_const_arg = function (
  this: LoweringContext,
  qself: ast.QSelf | undefined,
  path: ast.Path,
  res: Res<NodeId>,
  id: NodeId,
  span_: Span,
): hir.ConstArg {
  const context = this.ambient_direct_const_arg_context();
  if (this.can_lower_path_to_const_arg_direct(qself, path, span_, res, context).$ === "Ok") {
    const span = this.lower_span(span_);
    return this.lower_path_to_const_arg_direct(id, undefined, qself, path, span);
  } else {
    // Construct an AnonConst where the expr is the "ty"'s path.
    const node_id = this.next_node_id();
    const span = this.lower_span(span_);

    // Add a definition for the in-band const def.
    // We're lowering a const argument that was originally thought to be a type argument,
    // so the def collector didn't create the def ahead of time. That's why we have to do
    // it here.
    const def_id = this.create_def(node_id, undefined, DefKind.AnonConst, span);
    const hir_id = this.lower_node_id(node_id);

    const path_expr = new ast.Expr(
      id,
      { $: "Path", _0: qself === undefined ? undefined : ast.clone_QSelf(qself), _1: ast.clone_Path(path) },
      span,
      [],
      undefined,
    );

    const ct = this.with_new_scopes(span, (this_): hir.AnonConst => {
      return {
        def_id,
        hir_id,
        body: this_.lower_const_body(path_expr.span, path_expr),
        span,
      };
    });
    return new rustc_hir.ConstArg<null>(this.next_id(), { $: "Anon", _0: ct }, this.lower_span(span));
  }
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2657 lower_const_item_rhs
LoweringContext.prototype.lower_const_item_rhs = function (this: LoweringContext, body: ast.Expr | undefined, span: Span): hir.ConstItemRhs {
  const is_direct = (body: ast.Expr): boolean => {
    const context = this.tcx.features().gca_macroless_items()
      ? this.direct_const_arg_context_enabled_by_gca_macro()
      : DirectConstArgContext.GCA_MACRO;
    return this.can_lower_expr_to_const_arg_direct(body, context).$ === "Ok";
  };
  if (this.tcx.features().gca_min_const_items() && body !== undefined && is_direct(body)) {
    return { $: "Direct", _0: this.lower_expr_to_const_arg_direct(body, undefined) };
  } else {
    return { $: "Body", _0: this.lower_const_body(span, body) };
  }
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2682 direct_const_arg_context_enabled_by_gca_macro
LoweringContext.prototype.direct_const_arg_context_enabled_by_gca_macro = function (this: LoweringContext): DirectConstArgContext {
  let result = DirectConstArgContext.GCA_BASE_FEATURES;
  if (this.tcx.features().gca_min_const_items()) {
    result = DirectConstArgContext.union(result, DirectConstArgContext.GCA_MIN_CONST_ITEMS);
  }
  if (this.tcx.features().gca_adts()) {
    result = DirectConstArgContext.union(result, DirectConstArgContext.GCA_ADTS);
  }
  return result;
};

/// Only valid for const *arg* contexts, not const *item* contexts.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2694 ambient_direct_const_arg_context
LoweringContext.prototype.ambient_direct_const_arg_context = function (this: LoweringContext): DirectConstArgContext {
  if (this.tcx.features().gca_macroless_args()) {
    return this.direct_const_arg_context_enabled_by_gca_macro();
  } else if (this.tcx.features().gca()) {
    return DirectConstArgContext.GCA;
  } else {
    return DirectConstArgContext.STABLE;
  }
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2704 can_lower_path_to_const_arg_direct
LoweringContext.prototype.can_lower_path_to_const_arg_direct = function (
  this: LoweringContext,
  qself: ast.QSelf | undefined,
  path: ast.Path,
  span: Span,
  res: Res<NodeId> | undefined,
  context: DirectConstArgContext,
): Result<undefined, UnrepresentableConstArgError> {
  if (DirectConstArgContext.contains(context, DirectConstArgContext.PATH_ANY)) {
    return Ok(undefined);
  } else if (
    DirectConstArgContext.contains(context, DirectConstArgContext.PATH_CONST_CTOR) &&
    res !== undefined &&
    res.$ === "Def" &&
    res._0.$ === "Ctor" &&
    res._0._1 === "Const"
  ) {
    // FIXME(gca_adts): This check is incomplete. Type-relative paths and other complicating
    // factors make things very difficult - e.g. `<Option<T>>::None`
    return Ok(undefined);
  } else if (
    DirectConstArgContext.contains(context, DirectConstArgContext.PATH_PLAIN_PARAM) &&
    qself === undefined &&
    path.is_single_argless_ident() &&
    res !== undefined &&
    res.$ === "Def" &&
    res._0.$ === "ConstParam"
  ) {
    return Ok(undefined);
  } else {
    return Err(new UnrepresentableConstArgError(span, false));
  }
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2732 can_lower_expr_to_const_arg_direct
LoweringContext.prototype.can_lower_expr_to_const_arg_direct = function (
  this: LoweringContext,
  expr: ast.Expr,
  context: DirectConstArgContext,
): Result<undefined, UnrepresentableConstArgError> {
  // Note the only stable case is currently ExprKind::Path
  const kind = expr.kind;
  if (kind.$ === "Call" && kind._0.kind.$ === "Path" && DirectConstArgContext.contains(context, DirectConstArgContext.TUPLE_CALL)) {
    const args = kind._1;
    for (const arg of args) {
      const r = this.can_lower_expr_to_const_arg_direct(arg, context);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  } else if (kind.$ === "Tup" && DirectConstArgContext.contains(context, DirectConstArgContext.TUPLE)) {
    const exprs = kind._0;
    for (const expr of exprs) {
      const r = this.can_lower_expr_to_const_arg_direct(expr, context);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  } else if (kind.$ === "Path") {
    const [qself, path] = [kind._0, kind._1];
    const partial_res = this.get_partial_res(expr.id);
    const res = partial_res === undefined ? undefined : partial_res.full_res();
    return this.can_lower_path_to_const_arg_direct(qself, path, expr.span, res, context);
  } else if (kind.$ === "Struct" && DirectConstArgContext.contains(context, DirectConstArgContext.STRUCT)) {
    const se = kind._0;
    for (const f of se.fields) {
      const r = this.can_lower_expr_to_const_arg_direct(f.expr, context);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  } else if (kind.$ === "Array" && DirectConstArgContext.contains(context, DirectConstArgContext.ARRAY)) {
    const elements = kind._0;
    for (const element of elements) {
      const r = this.can_lower_expr_to_const_arg_direct(element, context);
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  } else if (kind.$ === "Underscore" && DirectConstArgContext.contains(context, DirectConstArgContext.UNDERSCORE)) {
    return Ok(undefined);
  } else if (kind.$ === "Paren" && DirectConstArgContext.contains(context, DirectConstArgContext.PAREN)) {
    const expr = kind._0;
    return this.can_lower_expr_to_const_arg_direct(expr, context);
  } else if (
    kind.$ === "Block" &&
    DirectConstArgContext.contains(context, DirectConstArgContext.BLOCK) &&
    kind._0.stmts.length === 1 &&
    kind._0.stmts[0]!.kind.$ === "Expr"
  ) {
    const stmt_kind = kind._0.stmts[0]!.kind as Extract<ast.StmtKind, { $: "Expr" }>;
    const expr = stmt_kind._0;
    return this.can_lower_expr_to_const_arg_direct(expr, context);
  } else if (kind.$ === "Lit" && DirectConstArgContext.contains(context, DirectConstArgContext.LIT)) {
    return Ok(undefined);
  } else if (
    kind.$ === "Unary" &&
    kind._0 === "Neg" &&
    DirectConstArgContext.contains(context, DirectConstArgContext.LIT) &&
    kind._1.kind.$ === "Lit"
  ) {
    return Ok(undefined);
  } else if (kind.$ === "ConstBlock" && DirectConstArgContext.contains(context, DirectConstArgContext.CONST_BLOCK)) {
    return Ok(undefined);
  } else if (kind.$ === "GcaMacro" && DirectConstArgContext.contains(context, DirectConstArgContext.GCA_MACRO)) {
    // Always report this as able to be represented directly. If it turns out not to be,
    // `lower_expr_to_const_arg_direct` will report an error.
    return Ok(undefined);
  } else {
    return Err(UnrepresentableConstArgError.new(expr));
  }
};

/// It is not allowed to call this function without checking can_lower_path_to_const_arg_direct
/// first, as we assume all feature gates/etc. have been checked already.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2802 lower_path_to_const_arg_direct
LoweringContext.prototype.lower_path_to_const_arg_direct = function (
  this: LoweringContext,
  id: NodeId,
  id_override: NodeId | undefined,
  qself: ast.QSelf | undefined,
  path: ast.Path,
  span: Span,
): hir.ConstArg {
  const qpath = this.lower_qpath(
    id,
    qself,
    path,
    "Explicit",
    "No",
    // FIXME(mgca): update for `fn foo() -> Bar<FOO<impl Trait>>` support
    { $: "Disallowed", _0: "Path" },
    undefined,
  );

  const node_id = id_override !== undefined ? id_override : id;
  return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), { $: "Path", _0: qpath }, span);
};

/// It is not allowed to call this function without checking can_lower_expr_to_const_arg_direct
/// first, as we assume all feature gates/etc. have been checked already.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2828 lower_expr_to_const_arg_direct
LoweringContext.prototype.lower_expr_to_const_arg_direct = function (
  this: LoweringContext,
  expr: ast.Expr,
  id_override: NodeId | undefined,
): hir.ConstArg {
  const span = this.lower_span(expr.span);
  const node_id = id_override !== undefined ? id_override : expr.id;
  const kind = expr.kind;
  if (kind.$ === "Call" && kind._0.kind.$ === "Path") {
    const [func, args] = [kind._0, kind._1];
    const [qself, path] = [kind._0.kind._0, kind._0.kind._1];
    const qpath = this.lower_qpath(func.id, qself, path, "Explicit", "No", { $: "Disallowed", _0: "Path" }, undefined);

    const lowered_args = args.map((arg) => {
      const const_arg = this.lower_expr_to_const_arg_direct(arg, undefined);
      return const_arg;
    });

    return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), { $: "TupleCall", _0: qpath, _1: lowered_args }, span);
  } else if (kind.$ === "Tup") {
    const exprs = kind._0.map((expr) => {
      const expr_ = this.lower_expr_to_const_arg_direct(expr, undefined);
      return expr_;
    });

    return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), { $: "Tup", _0: exprs }, span);
  } else if (kind.$ === "Path") {
    const [qself, path] = [kind._0, kind._1];
    return this.lower_path_to_const_arg_direct(expr.id, id_override, qself, path, span);
  } else if (kind.$ === "Struct") {
    const se = kind._0;
    const path = this.lower_qpath(
      expr.id,
      se.qself,
      se.path,
      // FIXME(mgca): we may want this to be `Optional` instead, but
      // we would also need to make sure that HIR ty lowering errors
      // when these paths wind up in signatures.
      "Explicit",
      "No",
      { $: "Disallowed", _0: "Path" },
      undefined,
    );

    const fields = se.fields.map((f): hir.ConstArgExprField => {
      const hir_id = this.lower_node_id(f.id);
      // FIXME(mgca): This might result in lowering attributes that
      // then go unused as the `Target::ExprField` is not actually
      // corresponding to `Node::ExprField`.
      this.lower_attrs(hir_id, f.attrs, f.span, Target.ExprField);
      const expr = this.lower_expr_to_const_arg_direct(f.expr, undefined);

      return {
        hir_id,
        field: this.lower_ident(f.ident),
        expr,
        span: this.lower_span(f.span),
      };
    });

    return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), { $: "Struct", _0: path, _1: fields }, span);
  } else if (kind.$ === "Array") {
    const elements = kind._0;
    const lowered_elems = elements.map((element) => {
      const const_arg = this.lower_expr_to_const_arg_direct(element, undefined);
      return const_arg;
    });
    const array_expr: hir.ConstArgArrayExpr = {
      span: this.lower_span(expr.span),
      elems: lowered_elems,
    };

    return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), { $: "Array", _0: array_expr }, span);
  } else if (kind.$ === "Underscore") {
    return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), { $: "Infer", _0: null }, span);
  } else if (kind.$ === "Paren") {
    const expr = kind._0;
    return this.lower_expr_to_const_arg_direct(expr, id_override);
  } else if (kind.$ === "Block" && kind._0.stmts.length === 1 && kind._0.stmts[0]!.kind.$ === "Expr") {
    const stmt_kind = kind._0.stmts[0]!.kind as Extract<ast.StmtKind, { $: "Expr" }>;
    const expr = stmt_kind._0;
    return this.lower_expr_to_const_arg_direct(expr, id_override);
  } else if (kind.$ === "Lit") {
    const literal = kind._0;
    const span = this.lower_span(expr.span);
    const literal_ = this.lower_lit(literal, span);

    return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), { $: "Literal", lit: literal_.node, negated: false }, span);
  } else if (kind.$ === "Unary" && kind._0 === "Neg" && kind._1.kind.$ === "Lit") {
    const literal = kind._1.kind._0;
    const span = this.lower_span(expr.span);
    const literal_ = this.lower_lit(literal, span);

    let kind_: hir.ConstArgKind;
    if (!(literal_.node.$ === "Int")) {
      const err = this.dcx().span_err(expr.span, "negated literal must be an integer");
      kind_ = { $: "Error", _0: err };
    } else {
      kind_ = { $: "Literal", lit: literal_.node, negated: true };
    }
    return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), kind_, span);
  } else if (kind.$ === "ConstBlock") {
    const anon_const = kind._0;
    // Do not use lower_anon_const_to_const_arg, as that attempts to represent the body
    // directly. Instead, force an anon const.
    const def_id = this.local_def_id(anon_const.id);
    assert_eq(DefKind.AnonConst, this.tcx.def_kind(def_id), (v) => debug_DefKind(v, PLAIN), DefKind_eq);
    const lowered_anon = this.lower_anon_const_to_anon_const(anon_const, span);
    return new rustc_hir.ConstArg<null>(this.lower_node_id(node_id), { $: "Anon", _0: lowered_anon }, span);
  } else if (kind.$ === "GcaMacro") {
    const expr = kind._0;
    // `can_lower_expr_to_const_arg_direct` always returns success upon encountering a
    // ExprKind::GcaMacro, which effectively forces the expression to be lowered as a
    // direct arg. If it actually turns out to not be possible, emit an error instead.
    const r = this.can_lower_expr_to_const_arg_direct(expr, this.direct_const_arg_context_enabled_by_gca_macro());
    switch (r.$) {
      case "Ok":
        return this.lower_expr_to_const_arg_direct(expr, id_override);
      case "Err": {
        const err = r._0;
        return err.emit(this);
      }
    }
  } else {
    return span_bug(
      expr.span,
      "lower_expr_to_const_arg_direct encountered an unlowerable expression, either can_lower_expr_to_const_arg_direct returned Ok() on something it shouldn't have, or you forgot to check can_lower_expr_to_const_arg_direct first",
    );
  }
};

/// See [`hir::ConstArg`] for when to use this function vs
/// [`Self::lower_anon_const_to_anon_const`].
// rustc: compiler/rustc_ast_lowering/src/lib.rs:2998 lower_anon_const_to_const_arg_and_alloc
LoweringContext.prototype.lower_anon_const_to_const_arg_and_alloc = function (this: LoweringContext, anon: ast.AnonConst): hir.ConstArg {
  return this.lower_anon_const_to_const_arg(anon);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:3006 lower_anon_const_to_const_arg
LoweringContext.prototype.lower_anon_const_to_const_arg = function (this: LoweringContext, anon: ast.AnonConst): hir.ConstArg {
  // Stable only allows one nesting of blocks for directly represented paths. mGCA allows
  // arbitrarily many, and are handled inside lower_expr_to_const_arg_direct for consistency.
  const expr = this.tcx.features().gca_macroless_args() ? anon.value : anon.value.maybe_unwrap_block();

  const context = this.ambient_direct_const_arg_context();
  if (this.can_lower_expr_to_const_arg_direct(expr, context).$ === "Ok") {
    return this.lower_expr_to_const_arg_direct(expr, anon.id);
  }

  const lowered_anon = this.lower_anon_const_to_anon_const(anon, anon.value.span);
  return new rustc_hir.ConstArg<null>(this.next_id(), { $: "Anon", _0: lowered_anon }, this.lower_span(anon.value.span));
};

/// See [`hir::ConstArg`] for when to use this function vs
/// [`Self::lower_anon_const_to_const_arg`].
// rustc: compiler/rustc_ast_lowering/src/lib.rs:3030 lower_anon_const_to_anon_const
LoweringContext.prototype.lower_anon_const_to_anon_const = function (this: LoweringContext, c: ast.AnonConst, span: Span): hir.AnonConst {
  return this.with_new_scopes(c.value.span, (this_): hir.AnonConst => {
    const def_id = this_.local_def_id(c.id);
    const hir_id = this_.lower_node_id(c.id);
    return {
      def_id,
      hir_id,
      body: this_.lower_const_body(c.value.span, c.value),
      span: this_.lower_span(span),
    };
  });
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3047 lower_unsafe_source
LoweringContext.prototype.lower_unsafe_source = function (this: LoweringContext, u: ast.UnsafeSource): hir.UnsafeSource {
  switch (u) {
    case "CompilerGenerated":
      return "CompilerGenerated";
    case "UserProvided":
      return "UserProvided";
  }
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3054 lower_trait_bound_modifiers
LoweringContext.prototype.lower_trait_bound_modifiers = function (this: LoweringContext, modifiers: ast.TraitBoundModifiers): hir.TraitBoundModifiers {
  let constness: ast.BoundConstness;
  switch (modifiers.constness.$) {
    case "Never":
      constness = ast.BoundConstness.Never;
      break;
    case "Always":
      constness = { $: "Always", _0: this.lower_span(modifiers.constness._0) };
      break;
    case "Maybe":
      constness = { $: "Maybe", _0: this.lower_span(modifiers.constness._0) };
      break;
  }
  let polarity: ast.BoundPolarity;
  switch (modifiers.polarity.$) {
    case "Positive":
      polarity = ast.BoundPolarity.Positive;
      break;
    case "Negative":
      polarity = { $: "Negative", _0: this.lower_span(modifiers.polarity._0) };
      break;
    case "Maybe":
      polarity = { $: "Maybe", _0: this.lower_span(modifiers.polarity._0) };
      break;
  }
  return { constness, polarity };
};

// Helper methods for building HIR.

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3073 stmt
LoweringContext.prototype.stmt = function (this: LoweringContext, span: Span, kind: hir.StmtKind): hir.Stmt {
  return { span: this.lower_span(span), kind, hir_id: this.next_id() };
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3077 stmt_expr
LoweringContext.prototype.stmt_expr = function (this: LoweringContext, span: Span, expr: hir.Expr): hir.Stmt {
  return this.stmt(span, { $: "Expr", _0: expr });
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3081 stmt_let_pat
LoweringContext.prototype.stmt_let_pat = function (
  this: LoweringContext,
  attrs: readonly attr_ir.Attribute[] | undefined,
  span: Span,
  init: hir.Expr | undefined,
  pat: hir.Pat,
  source: hir.LocalSource,
): hir.Stmt {
  const hir_id = this.next_id();
  if (attrs !== undefined) {
    const a = attrs;
    assert(!(a.length === 0), "assertion failed: !a.is_empty()");
    (this.curr_owner as PerOwnerLoweringStateView).attrs.insert(hir_id.local_id, a);
  }
  const local: hir.LetStmt = {
    super_: undefined,
    hir_id,
    init,
    pat,
    els: undefined,
    source,
    span: this.lower_span(span),
    ty: undefined,
  };
  return this.stmt(span, { $: "Let", _0: local });
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3107 stmt_super_let_pat
LoweringContext.prototype.stmt_super_let_pat = function (this: LoweringContext, span_: Span, pat: hir.Pat, init: hir.Expr | undefined): hir.Stmt {
  const hir_id = this.next_id();
  const span = this.lower_span(span_);
  const local: hir.LetStmt = {
    super_: span,
    hir_id,
    init,
    pat,
    els: undefined,
    source: "Normal",
    span,
    ty: undefined,
  };
  return this.stmt(span, { $: "Let", _0: local });
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3128 block_expr
LoweringContext.prototype.block_expr = function (this: LoweringContext, expr: hir.Expr): hir.Block {
  return this.block_all(expr.span, [], expr);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3132 block_all
LoweringContext.prototype.block_all = function (
  this: LoweringContext,
  span: Span,
  stmts: readonly hir.Stmt[],
  expr: hir.Expr | undefined,
): hir.Block {
  const blk = new rustc_hir.Block(stmts, expr, this.next_id(), rustc_hir.BlockCheckMode.DefaultBlock, this.lower_span(span), false);
  return blk;
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3149 pat_cf_continue
LoweringContext.prototype.pat_cf_continue = function (this: LoweringContext, span: Span, pat: hir.Pat): hir.Pat {
  const field = this.single_pat_field(span, pat);
  return this.pat_lang_item_variant(span, "ControlFlowContinue", field);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3154 pat_cf_break
LoweringContext.prototype.pat_cf_break = function (this: LoweringContext, span: Span, pat: hir.Pat): hir.Pat {
  const field = this.single_pat_field(span, pat);
  return this.pat_lang_item_variant(span, "ControlFlowBreak", field);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3159 pat_some
LoweringContext.prototype.pat_some = function (this: LoweringContext, span: Span, pat: hir.Pat): hir.Pat {
  const field = this.single_pat_field(span, pat);
  return this.pat_lang_item_variant(span, "OptionSome", field);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3164 pat_none
LoweringContext.prototype.pat_none = function (this: LoweringContext, span: Span): hir.Pat {
  return this.pat_lang_item_variant(span, "OptionNone", []);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3168 single_pat_field
LoweringContext.prototype.single_pat_field = function (this: LoweringContext, span: Span, pat: hir.Pat): readonly hir.PatField[] {
  const field: hir.PatField = {
    hir_id: this.next_id(),
    ident: Ident.new(sym.integer(0), this.lower_span(span)),
    is_shorthand: false,
    pat,
    span: this.lower_span(span),
  };
  return [field];
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3183 pat_lang_item_variant
LoweringContext.prototype.pat_lang_item_variant = function (
  this: LoweringContext,
  span: Span,
  lang_item: attr_ir.LangItem,
  fields: readonly hir.PatField[],
): hir.Pat {
  const path = this.make_lang_item_qpath(lang_item, this.lower_span(span), undefined);
  return this.pat(span, { $: "Struct", _0: path, _1: fields, _2: undefined });
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3193 pat_ident
LoweringContext.prototype.pat_ident = function (this: LoweringContext, span: Span, ident: Ident): [hir.Pat, HirId] {
  return this.pat_ident_binding_mode(span, ident, ast.BindingMode.NONE);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3197 pat_ident_mut
LoweringContext.prototype.pat_ident_mut = function (this: LoweringContext, span: Span, ident: Ident): [hir.Pat, HirId] {
  return this.pat_ident_binding_mode_mut(span, ident, ast.BindingMode.NONE);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3201 pat_ident_binding_mode
LoweringContext.prototype.pat_ident_binding_mode = function (this: LoweringContext, span: Span, ident: Ident, bm: ast.BindingMode): [hir.Pat, HirId] {
  const [pat, hir_id] = this.pat_ident_binding_mode_mut(span, ident, bm);
  return [pat, hir_id];
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3211 pat_ident_binding_mode_mut
LoweringContext.prototype.pat_ident_binding_mode_mut = function (this: LoweringContext, span: Span, ident: Ident, bm: ast.BindingMode): [hir.Pat, HirId] {
  const hir_id = this.next_id();

  return [new rustc_hir.Pat(hir_id, { $: "Binding", _0: bm, _1: hir_id, _2: this.lower_ident(ident), _3: undefined }, this.lower_span(span), true), hir_id];
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3230 pat
LoweringContext.prototype.pat = function (this: LoweringContext, span: Span, kind: hir.PatKind): hir.Pat {
  return new rustc_hir.Pat(this.next_id(), kind, this.lower_span(span), true);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3239 pat_without_dbm
LoweringContext.prototype.pat_without_dbm = function (this: LoweringContext, span: Span, kind: hir.PatKind): hir.Pat {
  return new rustc_hir.Pat(this.next_id(), kind, this.lower_span(span), false);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3248 ty_path
LoweringContext.prototype.ty_path = function (this: LoweringContext, hir_id_: HirId, span: Span, qpath: hir.QPath): hir.Ty {
  let hir_id = hir_id_;
  let kind: hir.TyKind;
  if (qpath.$ === "Resolved" && qpath._0 === undefined) {
    const path = qpath._1;
    // Turn trait object paths into `TyKind::TraitObject` instead.
    const res = path.res;
    if (res.$ === "Def" && (res._0.$ === "Trait" || res._0.$ === "TraitAlias")) {
      const principal: hir.PolyTraitRef = {
        bound_generic_params: [],
        modifiers: rustc_hir.TraitBoundModifiers.NONE,
        trait_ref: new rustc_hir.TraitRef(path, hir_id),
        span: this.lower_span(span),
      };

      // The original ID is taken by the `PolyTraitRef`,
      // so the `Ty` itself needs a different one.
      hir_id = this.next_id();
      kind = { $: "TraitObject", _0: [principal], _1: TaggedRef.new(this.elided_dyn_bound(span), "None") };
    } else {
      kind = { $: "Path", _0: { $: "Resolved", _0: undefined, _1: path } };
    }
  } else {
    kind = { $: "Path", _0: qpath };
  }

  return new rustc_hir.Ty<null>(hir_id, this.lower_span(span), kind);
};

/// Invoked to create the lifetime argument(s) for an elided trait object
/// bound, like the bound in `Box<dyn Debug>`. This method is not invoked
/// when the bound is written, even if it is written with `'_` like in
/// `Box<dyn Debug + '_>`. In those cases, `lower_lifetime` is invoked.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:3282 elided_dyn_bound
LoweringContext.prototype.elided_dyn_bound = function (this: LoweringContext, span: Span): hir.Lifetime {
  const r = rustc_hir.Lifetime.new(
    this.next_id(),
    Ident.new(kw.UnderscoreLifetime, this.lower_span(span)),
    rustc_hir.LifetimeKind.ImplicitObjectLifetimeDefault,
    rustc_hir.LifetimeSource.Other,
    "Implicit",
  );
  // debug!("elided_dyn_bound: r={:?}", r);
  return r;
};

// PORT(codegen): the three types below are written out as codegen set rustc_ast_lowering generates them into
// lib.gen.ts (scratch run of that set), followed by their hand-written impls. Root: once lib.gen.ts exists, delete the
// generated part here (class bodies, the `flags_companion` call, the Debug fns), re-export it from lib.gen.ts and
// attach the impls through `declare module "./lib.gen.ts"`.

// rustc-type: compiler/rustc_ast_lowering/src/lib.rs:3296 GenericArgsCtor
/// Helper struct for the delayed construction of [`hir::GenericArgs`].
export class GenericArgsCtor {
  constructor(
    public args: hir.GenericArg[],
    public constraints: readonly hir.AssocItemConstraint[],
    public parenthesized: hir.GenericArgsParentheses,
    public span: Span,
  ) {}
}

export interface GenericArgsCtor {
  is_empty(): boolean;
  into_generic_args(this_: LoweringContext): hir.GenericArgs;
}

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3304 is_empty
GenericArgsCtor.prototype.is_empty = function (this: GenericArgsCtor): boolean {
  return this.args.length === 0 && this.constraints.length === 0 && this.parenthesized === "No";
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3310 into_generic_args
GenericArgsCtor.prototype.into_generic_args = function (this: GenericArgsCtor, this_: LoweringContext): hir.GenericArgs {
  const ga = new rustc_hir.GenericArgs(this_.arena.alloc_from_iter(this.args), this.constraints, this.parenthesized, this_.lower_span(this.span));
  return ga;
};

// rustc-type: compiler/rustc_ast_lowering/src/lib.rs:3321 DirectConstArgContext
// PORT: `bitflags!` (compiler/rustc_ast_lowering/src/lib.rs:3321, `struct DirectConstArgContext: u16`) -> branded number; flags + `Flags` API on the companion.
export type DirectConstArgContext = number & { readonly __brand: "DirectConstArgContext" };
const DirectConstArgContext_flags = flags_companion<
  DirectConstArgContext,
  {
    TUPLE_CALL: DirectConstArgContext;
    TUPLE: DirectConstArgContext;
    PATH_PLAIN_PARAM: DirectConstArgContext;
    PATH_CONST_CTOR: DirectConstArgContext;
    PATH_ANY: DirectConstArgContext;
    STRUCT: DirectConstArgContext;
    ARRAY: DirectConstArgContext;
    UNDERSCORE: DirectConstArgContext;
    PAREN: DirectConstArgContext;
    BLOCK: DirectConstArgContext;
    LIT: DirectConstArgContext;
    CONST_BLOCK: DirectConstArgContext;
    GCA_MACRO: DirectConstArgContext;
  }
>(
  16,
  {
    TUPLE_CALL: 0x1 as DirectConstArgContext,
    TUPLE: 0x2 as DirectConstArgContext,
    PATH_PLAIN_PARAM: 0x4 as DirectConstArgContext,
    PATH_CONST_CTOR: 0x8 as DirectConstArgContext,
    PATH_ANY: 0x10 as DirectConstArgContext,
    STRUCT: 0x20 as DirectConstArgContext,
    ARRAY: 0x40 as DirectConstArgContext,
    UNDERSCORE: 0x80 as DirectConstArgContext,
    PAREN: 0x100 as DirectConstArgContext,
    BLOCK: 0x200 as DirectConstArgContext,
    LIT: 0x400 as DirectConstArgContext,
    CONST_BLOCK: 0x800 as DirectConstArgContext,
    GCA_MACRO: 0x1000 as DirectConstArgContext,
  },
  [
    ["TUPLE_CALL", 0x1 as DirectConstArgContext],
    ["TUPLE", 0x2 as DirectConstArgContext],
    ["PATH_PLAIN_PARAM", 0x4 as DirectConstArgContext],
    ["PATH_CONST_CTOR", 0x8 as DirectConstArgContext],
    ["PATH_ANY", 0x10 as DirectConstArgContext],
    ["STRUCT", 0x20 as DirectConstArgContext],
    ["ARRAY", 0x40 as DirectConstArgContext],
    ["UNDERSCORE", 0x80 as DirectConstArgContext],
    ["PAREN", 0x100 as DirectConstArgContext],
    ["BLOCK", 0x200 as DirectConstArgContext],
    ["LIT", 0x400 as DirectConstArgContext],
    ["CONST_BLOCK", 0x800 as DirectConstArgContext],
    ["GCA_MACRO", 0x1000 as DirectConstArgContext],
  ],
);
export const debug_DirectConstArgContext: Debug<DirectConstArgContext> = (v, f) =>
  debug_tuple(f, "DirectConstArgContext", [DirectConstArgContext.is_empty(v) ? "0x0" : to_writer(DirectConstArgContext.FLAGS_DESC, v)]);

// impl DirectConstArgContext (lib.rs:3340): associated consts, on the companion.
/// The only allowed direct const arg representation is simple paths that nameres to generic
/// const parameters.
const DirectConstArgContext_STABLE: DirectConstArgContext = DirectConstArgContext_flags.PATH_PLAIN_PARAM;

/// The allowed representations are what is allowed on stable, plus the `gca!` macro.
const DirectConstArgContext_GCA: DirectConstArgContext = DirectConstArgContext_flags.union(DirectConstArgContext_STABLE, DirectConstArgContext_flags.GCA_MACRO);

/// These expressions are allowed inside the `gca!` macro, regardless of what feature is
/// enabling the base `gca!` functionality.
///
/// These are also allowed under macroless features without a `gca!` macro.
const DirectConstArgContext_GCA_BASE_FEATURES: DirectConstArgContext = [
  DirectConstArgContext_flags.UNDERSCORE,
  DirectConstArgContext_flags.PAREN,
  DirectConstArgContext_flags.BLOCK,
  DirectConstArgContext_flags.LIT,
  DirectConstArgContext_flags.CONST_BLOCK,
].reduce((acc, x) => DirectConstArgContext_flags.union(acc, x), DirectConstArgContext_GCA);

/// These are allowed under `#![feature(gca_min_const_items)]`
const DirectConstArgContext_GCA_MIN_CONST_ITEMS: DirectConstArgContext = DirectConstArgContext_flags.PATH_ANY;

/// These are allowed under `#![feature(gca_adts)]`
const DirectConstArgContext_GCA_ADTS: DirectConstArgContext = [
  DirectConstArgContext_flags.TUPLE_CALL,
  DirectConstArgContext_flags.TUPLE,
  DirectConstArgContext_flags.STRUCT,
  DirectConstArgContext_flags.ARRAY,
].reduce((acc, x) => DirectConstArgContext_flags.union(acc, x), DirectConstArgContext_flags.PATH_CONST_CTOR);

export const DirectConstArgContext = {
  ...DirectConstArgContext_flags,
  STABLE: DirectConstArgContext_STABLE,
  GCA: DirectConstArgContext_GCA,
  GCA_BASE_FEATURES: DirectConstArgContext_GCA_BASE_FEATURES,
  GCA_MIN_CONST_ITEMS: DirectConstArgContext_GCA_MIN_CONST_ITEMS,
  GCA_ADTS: DirectConstArgContext_GCA_ADTS,
};

// rustc-type: compiler/rustc_ast_lowering/src/lib.rs:3371 UnrepresentableConstArgError
export class UnrepresentableConstArgError {
  constructor(
    public span: Span,
    public will_create_def_ids: boolean,
  ) {}
}
export const debug_UnrepresentableConstArgError: Debug<UnrepresentableConstArgError> = (v, f) =>
  debug_struct(f, "UnrepresentableConstArgError", [
    ["span", debug_Span(v.span, f)],
    ["will_create_def_ids", debug_bool(v.will_create_def_ids, f)],
  ]);

export interface UnrepresentableConstArgError {
  emit(lowering_context: LoweringContext): hir.ConstArg;
}
export declare namespace UnrepresentableConstArgError {
  function new_(expr: ast.Expr): UnrepresentableConstArgError;
  export { new_ as new };
}

Object.assign(UnrepresentableConstArgError, {
  // rustc: compiler/rustc_ast_lowering/src/lib.rs:3377 new
  new(expr: ast.Expr): UnrepresentableConstArgError {
    return new UnrepresentableConstArgError(expr.span, WillCreateDefIdsVisitor().visit_expr(expr).$ === "Break");
  },
});

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3384 emit
UnrepresentableConstArgError.prototype.emit = function (this: UnrepresentableConstArgError, lowering_context: LoweringContext): hir.ConstArg {
  const msg = "complex const arguments must be placed inside of a `const` block";
  let e: ErrorGuaranteed;
  if (this.will_create_def_ids) {
    // FIXME(mgca): make this non-fatal once we have a better way to handle
    // nested items in const args
    // Issue: https://github.com/rust-lang/rust/issues/154539
    e = lowering_context.dcx().span_fatal(this.span, msg);
  } else {
    e = lowering_context.dcx().span_err(this.span, msg);
  }

  return new rustc_hir.ConstArg<null>(lowering_context.next_id(), { $: "Error", _0: e }, lowering_context.lower_span(this.span));
};
