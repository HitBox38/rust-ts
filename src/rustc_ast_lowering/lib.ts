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
import { type Attribute as AstAttribute, type AssocItem, clone_Path, clone_TraitBoundModifiers, CRATE_NODE_ID, DelimArgs, DUMMY_NODE_ID, type Expr, type ForeignItem, type GenericArg as AstGenericArg, GenericArgs as AstGenericArgs, type GenericParam as AstGenericParam, Item, MacCall, NodeId, TraitBoundModifiers, type ParenthesizedArgs, Path as AstPath, PolyTraitRef, type QSelf, type Ty as AstTy, type AssocItemConstraint as AstAssocItemConstraint } from "../rustc_ast/lib.ts";
import { mut_visit, node_id as ast_node_id_mod, tokenstream, type visit } from "../rustc_ast/lib.ts";
import { type Attribute as HirAttribute, type AttributeKind, find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { TaggedRef } from "../rustc_data_structures/tagged_ptr.ts";
import { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import { stable_hash_Fingerprint, StableHasher } from "../rustc_data_structures/stable_hash.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import type { DiagCtxtHandle } from "../rustc_errors/lib.ts";
import { DefKind, PerNS, Res } from "../rustc_hir/def.ts";
import * as rustc_hir from "../rustc_hir/lib.ts";
import { CRATE_HIR_ID, debug_OwnerId, HirId, OwnerId, OwnerId_eq } from "../rustc_hir_id/lib.ts";
import { debug_DefKey, PerParentDisambiguatorState } from "../rustc_hir_id/definitions.ts";
import type { RegisteredTools } from "../rustc_lint_defs/lib.ts";
import { type AstOwner, PartialRes, type PerOwnerResolverData, type ResolverAstLowering } from "../rustc_middle/middle/resolve.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { DiagArgFromDisplay } from "../rustc_error_messages/diagnostic_impls.ts";
import { add_feature_diagnostics } from "../rustc_session/diagnostics.ts";
import { Session } from "../rustc_session/session.ts";
import { DefIdMap, debug_LocalDefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";
import { debug_option, format_debug, PLAIN } from "../std/fmt.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type * as hir from "./hir_shim.ts";
import { resolve_type_relative_delegations } from "./delegation/resolution.ts";
import { index_hir } from "./index.ts";
// ---- lane lower-lib-b imports ----
import * as ast from "../rustc_ast/lib.ts";
import type * as attr_ir from "../rustc_attr_ir/lib.ts";
import { E0203 } from "../rustc_errors/lib.ts";
import { debug_DefKind, DefKind_eq } from "../rustc_hir/def.ts";
import { debug_Span, DUMMY_SP } from "../rustc_span/lib.ts";
import { debug_Ident, debug_Symbol, display_Symbol } from "../rustc_span/symbol.ts";
import { unreachable } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import * as diagnostics from "./diagnostics.ts";
import { WillCreateDefIdsVisitor } from "./expr.ts";
// ---- shared ----
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
export * from "./lib.gen.ts";
import {
  DirectConstArgContext as DirectConstArgContext_flags,
  type DiscardParams,
  FnDeclKind,
  GenericArgsCtor,
  ImplTraitContext,
  ImplTraitPosition,
  ParamMode,
  PerOwnerLoweringState,
  type RelaxedBoundForbiddenReason,
  SpanLowerer,
  TryBlockScope,
  UnrepresentableConstArgError,
} from "./lib.gen.ts";

// Methods of lib.gen.ts's types, attached below in upstream order.
declare module "./lib.gen.ts" {
  interface PerOwnerLoweringState {
    owner_id(): OwnerId;
    into_owner_info(tcx: TyCtxt, node: hir.OwnerNode): hir.OwnerInfo;
  }
  namespace PerOwnerLoweringState {
    function new_(resolver: ResolverAstLowering, owner_: NodeId): PerOwnerLoweringState;
    export { new_ as new };
  }
  interface SpanLowerer {
    lower(span: Span): Span;
  }
  interface GenericArgsCtor {
    is_empty(): boolean;
    into_generic_args(this_: LoweringContext): hir.GenericArgs;
  }
  interface UnrepresentableConstArgError {
    emit(lowering_context: LoweringContext): hir.ConstArg;
  }
  namespace UnrepresentableConstArgError {
    function new_(expr: ast.Expr): UnrepresentableConstArgError;
    export { new_ as new };
  }
}

// ==== lane lower-lib-a: lib.rs:1..1756 ====

// macro_rules! arena_vec { ($this:expr; $($x:expr),*) => ($this.arena.alloc_from_iter([$($x),*])) } (lib.rs:83):
// PORT: arenas are erased, so `arena_vec![this; a, b]` is `this.arena.alloc_from_iter([a, b])` written out.

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

// PORT: the data types of lib.rs come from lib.gen.ts (codegen set rustc_ast_lowering, merge-w14); the methods and
// companions are attached here. `RelaxedBoundPolicy` stays hand-written (a `hand` entry): its `&mut FxIndexMap<DefId,
// Span>` is a `DefIdMap`, which the generator cannot express.

// (lib.rs:155 `struct PerOwnerLoweringState`: lib.gen.ts)
Object.assign(PerOwnerLoweringState, {
  // rustc: compiler/rustc_ast_lowering/src/lib.rs:188 new
  new(resolver: ResolverAstLowering, owner_: NodeId): PerOwnerLoweringState {
    const owner = map_index(resolver.owners, owner_);

    const s = resolver.disambiguators.get(owner.def_id);
    const disambiguator = s !== undefined ? s.steal() : PerParentDisambiguatorState.new(owner.def_id);

    return new PerOwnerLoweringState(
      owner,
      disambiguator,
      // 0 corresponds to `owner` lowered as `owner_id`, and we never call
      // `lower_node_id(owner)`.
      rustc_hir.ItemLocalId.new(1),
      new Map(),
      // (`relowering_checker: Default::default()`: #[cfg(debug_assertions)])
      SortedMap.default(rustc_hir.ItemLocalId_cmp),
      [],
      undefined,
      new Map(),
      [],
      new Map(),
      [],
      [],
    );
  },
});

// rustc: compiler/rustc_ast_lowering/src/lib.rs:217 owner_id
PerOwnerLoweringState.prototype.owner_id = function (this: PerOwnerLoweringState): OwnerId {
  return new OwnerId(this.owner.def_id);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:221 into_owner_info
PerOwnerLoweringState.prototype.into_owner_info = function (this: PerOwnerLoweringState, tcx: TyCtxt, node: hir.OwnerNode): hir.OwnerInfo {
  assert_eq(this.owner_id(), rustc_hir.OwnerNode.def_id(node), (v) => format_debug(v, debug_OwnerId, PLAIN), OwnerId_eq);
  assert(this.impl_trait_defs.length === 0, "assertion failed: self.impl_trait_defs.is_empty()");
  assert(this.impl_trait_bounds.length === 0, "assertion failed: self.impl_trait_bounds.is_empty()");

  const attrs = this.attrs;
  const bodies = this.bodies;
  const define_opaque = this.define_opaque;
  const trait_map = this.trait_map;
  const delayed_lints = Steal.new(this.delayed_lints, "alloc::boxed::Box<[rustc_hir::lints::DelayedLint]>");
  const children = this.children;

  // #[cfg(debug_assertions)]
  // for (id, attrs) in attrs.iter() {
  //     // Verify that we do not store empty slices in the map.
  //     if attrs.is_empty() {
  //         panic!("Stored empty attributes for {:?}", id);
  //     }
  // }

  // `bodies.sort_by_key(|(k, _)| *k)` (a stable sort, as JS's)
  bodies.sort((a, b) => a[0] - b[0]);
  const bodies_ = SortedMap.from_presorted_elements(bodies, rustc_hir.ItemLocalId_cmp);

  // Don't hash unless necessary, because it's expensive.
  const { bodies_hash, attrs_hash } = tcx.hash_owner_nodes(node, bodies_, attrs, define_opaque);
  const num_nodes = rustc_hir.ItemLocalId.as_usize(this.item_local_id_counter);
  const [nodes, parenting] = index_hir(tcx, node, bodies_, num_nodes);
  const nodes_ = new rustc_hir.OwnerNodes(bodies_hash, nodes, bodies_);
  const attrs_ = new rustc_hir.AttributeMap(attrs, define_opaque, attrs_hash);

  const opt_hash = tcx.needs_owner_info_hash()
    ? tcx.with_stable_hashing_context((hcx) => {
        const stable_hasher = StableHasher.new();
        stable_hash_Fingerprint(unwrap(bodies_hash), hcx, stable_hasher);
        stable_hash_Fingerprint(unwrap(attrs_hash), hcx, stable_hasher);
        // Do not hash delayed_lints.
        // PORT: `parenting` / `trait_map` / `children` are `UnordMap`s; `StableHash for UnordMap`
        // (rustc_data_structures unord.rs) is not ported yet.
        unported("rustc_data_structures::unord::UnordMap: StableHash (OwnerInfo::opt_hash)");
        return stable_hasher.finish(Fingerprint);
      })
    : undefined;

  // `tcx.hir_arena.alloc(..)` (arenas are erased: `HIR_ARENA`)
  return HIR_ARENA.alloc(new rustc_hir.OwnerInfo(nodes_, parenting, attrs_, trait_map, children, delayed_lints, opt_hash));
};

/** `map[&key]` on a `HashMap` (std's `Index`: `self.get(key).expect("no entry found for key")`). */
function map_index<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined) panic("no entry found for key");
  return v;
}

/** `assert_ne!(left, right)` (core's text, `AssertKind::Ne`, no args). */
function assert_ne<T>(left: T, right: T, debug: (v: T) => string): void {
  if (left === right) {
    panic(`assertion \`left != right\` failed\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}

// (lib.rs:281 `struct LoweringContext`: decls.ts)

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

// rustc: compiler/rustc_ast_lowering/src/lib.rs:350 new
LoweringContext.new = function (tcx: TyCtxt, resolver: ResolverAstLowering, owner: NodeId): LoweringContext {
  return new LoweringContext(
    tcx,
    resolver,
    PerOwnerLoweringState.new(resolver, owner),
    // `arena: tcx.hir_arena`
    HIR_ARENA,

    /* contract_ensures */ undefined,

    // Lowering state (the struct literal's order differs; these have no side effects).
    /* coroutine_kind */ undefined,
    /* task_context */ undefined,
    /* current_item_span */ undefined,
    /* try_block_scope */ TryBlockScope.Function,
    /* loop_scope */ undefined,
    /* is_in_loop_condition */ false,
    /* is_in_dyn_type */ false,

    /* next_node_id */ resolver.next_node_id,
    /* node_id_to_def_id */ new Map(),
    /* partial_res_overrides */ new Map(),

    /* move_expr_bindings */ [],
    /* lowering_move_expr_initializer */ false,
    AttributeParser.new(
      tcx.sess,
      tcx.features(),
      tcx.registered_attr_tools(null) as RegisteredTools,
      { $: "ErrorsAndLints", recovery: "Allowed" },
    ),
  );
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:383 dcx
LoweringContext.prototype.dcx = function (this: LoweringContext): DiagCtxtHandle {
  return this.tcx.dcx();
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:387 allow_gen_future
LoweringContext.prototype.allow_gen_future = function (this: LoweringContext): readonly Symbol[] {
  if (this.tcx.features().async_fn_track_caller()) {
    return ALLOW_GEN_FUTURE_WITH_ASYNC_FN_TRACK_CALLER;
  } else {
    return ALLOW_GEN_FUTURE;
  }
};

// (lib.rs:396 `struct SpanLowerer`: lib.gen.ts)

// rustc: compiler/rustc_ast_lowering/src/lib.rs:402 lower
SpanLowerer.prototype.lower = function (this: SpanLowerer, span: Span): Span {
  if (this.is_incremental) {
    return Span.with_parent(span, this.def_id);
  } else {
    // Do not make spans relative when not using incremental compilation.
    return span;
  }
};

// `#[extension(trait ResolverAstLoweringExt<'tcx>)] impl<'tcx> ResolverAstLowering<'tcx>`: a free fn taking `self`.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:414 legacy_const_generic_args
export function ResolverAstLowering_legacy_const_generic_args(self: ResolverAstLowering, expr: Expr, tcx: TyCtxt): number[] | undefined {
  if (!(expr.kind.$ === "Path" && expr.kind._0 === undefined)) {
    return undefined;
  }
  const path = expr.kind._1;

  // Don't perform legacy const generics rewriting if the path already
  // has generic arguments.
  if (unwrap(path.segments[path.segments.length - 1]).args !== undefined) {
    return undefined;
  }

  // We do not need to look at `partial_res_overrides`. That map only contains overrides for
  // `self_param` locals. And here we are looking for the function definition that `expr`
  // resolves to.
  const partial_res = self.partial_res_map.get(expr.id);
  if (partial_res === undefined) return undefined;
  const full_res = partial_res.full_res();
  if (full_res === undefined) return undefined;
  const def_id = Res.opt_def_id(full_res);
  if (def_id === undefined) return undefined;

  // We only support cross-crate argument rewriting. Uses
  // within the same crate should be updated to use the new
  // const generics style.
  if (def_id.is_local()) {
    return undefined;
  }

  // we can use parsed attrs here since for other crates they're already available
  // PORT: `find_attr!(tcx, def_id, ..)` goes through `HasAttrs::get_attrs(def_id, &tcx)`; for a non-local `DefId`
  // (checked above) that is `tcx.attrs_for_def(def_id)` (as in rustc_resolve diagnostics/impls.ts).
  return find_attr(tcx.attrs_for_def(def_id) as readonly HirAttribute[], (k: AttributeKind) =>
    k.$ === "RustcLegacyConstGenerics" ? k.fn_indexes : undefined,
  )?.map(([num, _]) => num);
}

/// How relaxed bounds `?Trait` should be treated.
///
/// Relaxed bounds should only be allowed in places where we later
/// (namely during HIR ty lowering) perform *sized elaboration*.
// rustc-type: compiler/rustc_ast_lowering/src/lib.rs:451 RelaxedBoundPolicy
// PORT: `&'a mut FxIndexMap<DefId, Span>` is the (insertion-ordered) `DefIdMap` itself (the generator would say
// `Map<DefId, Span>`, which keys `DefId` objects by identity).
export type RelaxedBoundPolicy =
  /// The `DefId` refers to the trait that is being relaxed.
  | { readonly $: "Allowed"; _0: DefIdMap<Span> }
  | { readonly $: "Forbidden"; _0: RelaxedBoundForbiddenReason };
export const RelaxedBoundPolicy = {
  // rustc: compiler/rustc_ast_lowering/src/lib.rs:457 reborrow
  reborrow(self: RelaxedBoundPolicy): RelaxedBoundPolicy {
    switch (self.$) {
      case "Allowed":
        return { $: "Allowed", _0: self._0 };
      case "Forbidden":
        return { $: "Forbidden", _0: self._0 };
    }
  },
};

// (lib.rs:466 `RelaxedBoundForbiddenReason`, lib.rs:479 `ImplTraitContext`, lib.rs:510 `ImplTraitPosition`: lib.gen.ts)


/** `impl std::fmt::Display for ImplTraitPosition` */
// rustc: compiler/rustc_ast_lowering/src/lib.rs:535 fmt
export function display_ImplTraitPosition(self: ImplTraitPosition): string {
  let name: string;
  switch (self) {
    case "Path":
      name = "paths";
      break;
    case "Variable":
      name = "the type of variable bindings";
      break;
    case "Trait":
      name = "traits";
      break;
    case "Bound":
      name = "bounds";
      break;
    case "Generic":
      name = "generics";
      break;
    case "ExternFnParam":
      name = "`extern fn` parameters";
      break;
    case "ClosureParam":
      name = "closure parameters";
      break;
    case "PointerParam":
      name = "`fn` pointer parameters";
      break;
    case "FnTraitParam":
      name = "the parameters of `Fn` trait bounds";
      break;
    case "ExternFnReturn":
      name = "`extern fn` return types";
      break;
    case "ClosureReturn":
      name = "closure return types";
      break;
    case "PointerReturn":
      name = "`fn` pointer return types";
      break;
    case "FnTraitReturn":
      name = "the return type of `Fn` trait bounds";
      break;
    case "GenericDefault":
      name = "generic parameter defaults";
      break;
    case "ConstTy":
      name = "const types";
      break;
    case "StaticTy":
      name = "static types";
      break;
    case "AssocTy":
      name = "associated types";
      break;
    case "FieldTy":
      name = "field types";
      break;
    case "Cast":
      name = "cast expression types";
      break;
    case "ImplSelf":
      name = "impl headers";
      break;
    case "OffsetOf":
      name = "`offset_of!` parameters";
      break;
  }

  return `${name}`;
}

// (lib.rs:565 `FnDeclKind`, lib.rs:576 `TryBlockScope`: lib.gen.ts)

// rustc: compiler/rustc_ast_lowering/src/lib.rs:587 index_ast
export function index_ast(tcx: TyCtxt, _: null): readonly (Steal<[ResolverAstLowering, AstOwner]> | undefined)[] {
  // Queries that borrow `resolver_for_lowering`.
  tcx.ensure_done().output_filenames(null);
  tcx.ensure_done().early_lint_checks(null);
  tcx.ensure_done().get_lang_items(null);
  tcx.ensure_done().debugger_visualizers(LOCAL_CRATE);

  const [resolver_, krate_] = tcx.resolver_for_lowering();
  const resolver = resolver_.steal();
  const krate = krate_.steal();

  const indexer = new Indexer(resolver.owners, [], resolver.next_node_id);
  indexer.visit_crate(krate);
  indexer.insert(CRATE_NODE_ID, { $: "Crate", _0: krate });
  resolver.next_node_id = indexer.next_node_id;

  const index = indexer.index;
  // `Arc::new(resolver)`: every entry shares it (`Arc::clone`).
  // `tcx.arena.alloc_index_slice_from_iter(..)` (arenas are erased)
  return HIR_ARENA.alloc_index_slice_from_iter(
    index.map((owner) =>
      owner === undefined
        ? undefined
        : Steal.new<[ResolverAstLowering, AstOwner]>(
            [resolver, owner],
            "(alloc::sync::Arc<rustc_middle::middle::resolve::ResolverAstLowering>, rustc_middle::middle::resolve::AstOwner)",
          ),
    ),
  );

  // (`struct Indexer` and its impls are nested items of `index_ast`: the class below)
}

// PORT: nested items of `index_ast` (lib.rs:614..700), at module level (a class must be initialised before
// `index_ast` runs).
class Indexer extends mut_visit.MutVisitor {
  constructor(
    public owners: Map<NodeId, PerOwnerResolverData>,
    /** `IndexVec<LocalDefId, Option<AstOwner>>` */
    public index: (AstOwner | undefined)[],
    public next_node_id: NodeId,
  ) {
    super();
  }

  // rustc: compiler/rustc_ast_lowering/src/lib.rs:623 insert
  insert(id: NodeId, node: AstOwner): void {
    const def_id = map_index(this.owners, id).def_id;
    // `IndexVec::insert`: `ensure_contains_elem(index, || None)`, then replace.
    const i = LocalDefId.index(def_id);
    while (this.index.length <= i) this.index.push(undefined);
    this.index[i] = node;
  }

  // rustc: compiler/rustc_ast_lowering/src/lib.rs:628 make_dummy
  make_dummy<K>(id: NodeId, span: Span, dummy: (_1: MacCall) => K): Item<K> {
    // use rustc_ast::token::Delimiter;
    // use rustc_ast::tokenstream::{DelimSpan, TokenStream};
    // use thin_vec::thin_vec;

    return new Item<K>(
      /* attrs */ [],
      id,
      span,
      { kind: { $: "Public" }, span },
      // Lacking a better choice, we replace the contents with a macro call.
      // Unexpanded macros should never reach lowering, so this is not confusing.
      dummy(
        new MacCall(
          new AstPath(span, []),
          new DelimArgs(tokenstream.DelimSpan.from_single(span), { $: "Parenthesis" }, tokenstream.TokenStream.new([])),
        ),
      ),
      /* tokens */ undefined,
    );
  }

  // rustc: compiler/rustc_ast_lowering/src/lib.rs:657 replace_with_dummy
  replace_with_dummy<K>(item: Item<K>, dummy: (_1: MacCall) => K, node: (_1: Item<K>) => AstOwner): void {
    const dummy_ = this.make_dummy(item.id, item.span, dummy);
    // `mem::replace(item, *dummy)`: the old value moves out into a fresh `Item`, the slot takes the dummy.
    const item_ = new Item<K>(item.attrs, item.id, item.span, item.vis, item.kind, item.tokens);
    replace_in_place(item, dummy_);
    this.insert(item_.id, node(item_));
  }

  // impl MutVisitor for Indexer<'_, '_>
  // rustc: compiler/rustc_ast_lowering/src/lib.rs:670 visit_attribute
  override visit_attribute(_: AstAttribute): void {
    // We do not want to lower expressions that appear in attributes,
    // as they are not accessible to the rest of the HIR.
  }

  // rustc: compiler/rustc_ast_lowering/src/lib.rs:675 flat_map_item
  override flat_map_item(item: Item): Item[] {
    mut_visit.walk_item(this, item, mut_visit.WalkItemKind.ItemKind);
    const dummy = this.make_dummy(item.id, item.span, (m) => ({ $: "MacCall" as const, _0: m }));
    const items = [dummy];
    this.insert(item.id, { $: "Item", _0: item });
    return items;
  }

  // rustc: compiler/rustc_ast_lowering/src/lib.rs:683 visit_assoc_item
  override visit_assoc_item(item: AssocItem, ctxt: visit.AssocCtxt): void {
    mut_visit.walk_assoc_item(this, item, ctxt, mut_visit.WalkItemKind.AssocItemKind);
    switch (ctxt.$) {
      case "Trait":
        this.replace_with_dummy(item, (m) => ({ $: "MacCall" as const, _0: m }), (i) => ({ $: "TraitItem", _0: i }));
        break;
      case "Impl":
        this.replace_with_dummy(item, (m) => ({ $: "MacCall" as const, _0: m }), (i) => ({ $: "ImplItem", _0: i }));
        break;
    }
  }

  // rustc: compiler/rustc_ast_lowering/src/lib.rs:695 visit_foreign_item
  override visit_foreign_item(item: ForeignItem): void {
    mut_visit.walk_item(this, item, mut_visit.WalkItemKind.ForeignItemKind);
    this.replace_with_dummy(item, (m) => ({ $: "MacCall" as const, _0: m }), (i) => ({ $: "ForeignItem", _0: i }));
  }
}

// #[instrument(level = "trace", skip(tcx))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:703 lower_to_hir
export function lower_to_hir(tcx: TyCtxt, def_id: LocalDefId): hir.MaybeOwner {
  tcx.ensure_done().resolve_type_relative_delegations(null);

  const ast_index = tcx.index_ast(null) as readonly (Steal<[ResolverAstLowering, AstOwner]> | undefined)[];
  // `IndexSlice::get`: `Option<&Option<Steal<..>>>` (PORT: the outer `Option` is `{ _0 } | undefined`).
  const resolver_and_node: { _0: Steal<[ResolverAstLowering, AstOwner]> | undefined } | undefined =
    LocalDefId.index(def_id) < ast_index.length ? { _0: ast_index[LocalDefId.index(def_id)] } : undefined;

  const fallback_to_ancestor = (): hir.MaybeOwner => {
    // The item did not exist in the AST, it was created while lowering another item.

    const parent_id = tcx.local_parent(def_id);
    let parent_info = tcx.lower_to_hir(parent_id) as hir.MaybeOwner;
    while (parent_info.$ === "NonOwner") {
      const hir_id = parent_info._0;
      // `parent_id` could also not be a owner either.
      // For instance if `def_id` is an enum variant field,
      // the direct parent is the enum variant.
      // In that case `hir_id.owner` point to the actual HIR owner
      // and skips all non-owner parents, so fetch the HIR associated to it.
      parent_info = tcx.lower_to_hir(hir_id.owner.def_id) as hir.MaybeOwner;
    }

    const parent_info_ = rustc_hir.MaybeOwner.unwrap(parent_info);
    const child = parent_info_.children.get(def_id);
    if (child === undefined) {
      return span_bug(
        tcx.source_span(def_id),
        `${format_debug(def_id, debug_LocalDefId, PLAIN)} does not appear in children of ${format_debug(rustc_hir.OwnerNode.def_id(parent_info_.nodes.node()), debug_OwnerId, PLAIN)}`,
      );
    }
    return child;
  };

  const r_and_node = resolver_and_node === undefined ? undefined : resolver_and_node._0;
  if (r_and_node === undefined) {
    // `ast_index` does not contain all definitions, only up-to the highest
    // `LocalDefId` which has a non-trivial `AstOwner`. Gracefully handle
    // other definitions, in particular those nested inside this highest definition.
    // OR
    // The item existed in the AST, but is not a HIR owner.
    // Fetch the correct information from its parent.
    return fallback_to_ancestor();
  }

  // rustc: compiler/rustc_ast_lowering/src/lib.rs:744 with_lctx
  function with_lctx(
    tcx: TyCtxt,
    resolver: ResolverAstLowering,
    owner: NodeId,
    f: (this_: LoweringContext) => hir.OwnerNode,
  ): hir.MaybeOwner {
    const lctx = LoweringContext.new(tcx, resolver, owner);
    const item = f(lctx);
    return { $: "Owner", _0: lctx.curr_owner.into_owner_info(tcx, item) };
  }

  const [resolver, node] = r_and_node.steal();

  let item: hir.MaybeOwner;
  switch (node.$) {
    // The item existed in the AST.
    case "Crate": {
      const c = node._0;
      item = with_lctx(tcx, resolver, CRATE_NODE_ID, (lctx) => {
        // debug_assert_eq!(lctx.curr_owner.owner_id(), CRATE_OWNER_ID);
        const module = lctx.lower_mod(c.items, c.spans);
        lctx.lower_attrs(CRATE_HIR_ID, c.attrs, c.spans.inner_span, TARGET_CRATE);
        return { $: "Crate", _0: module };
      });
      break;
    }
    case "Item": {
      const item_ = node._0;
      item = with_lctx(tcx, resolver, item_.id, (lctx) => ({ $: "Item", _0: lctx.lower_item(item_) }));
      break;
    }
    case "TraitItem": {
      const item_ = node._0;
      item = with_lctx(tcx, resolver, item_.id, (lctx) => ({ $: "TraitItem", _0: lctx.lower_trait_item(item_) }));
      break;
    }
    case "ImplItem": {
      const item_ = node._0;
      item = with_lctx(tcx, resolver, item_.id, (lctx) => ({ $: "ImplItem", _0: lctx.lower_impl_item(item_) }));
      break;
    }
    case "ForeignItem": {
      const item_ = node._0;
      item = with_lctx(tcx, resolver, item_.id, (lctx) => ({ $: "ForeignItem", _0: lctx.lower_foreign_item(item_) }));
      break;
    }
  }

  // `mem::drop(node)`: nothing to free in TS.
  tcx.sess.time("drop_ast", () => {});

  return item;
}

/** `Target::Crate` */
const TARGET_CRATE: Target = { $: "Crate" };

// (lib.rs:785..812 `ParamMode`, `AllowReturnTypeNotation`, `GenericArgsMode`, `DiscardParams`: lib.gen.ts)

// impl<'hir> LoweringContext<'_, 'hir>

// rustc: compiler/rustc_ast_lowering/src/lib.rs:820 create_def
LoweringContext.prototype.create_def = function (
  this: LoweringContext,
  node_id: NodeId,
  name: Symbol | undefined,
  def_kind: DefKind,
  span: Span,
): LocalDefId {
  const parent = this.curr_owner.owner_id().def_id;
  assert_ne(node_id, DUMMY_NODE_ID, (v) => format_debug(v, ast_node_id_mod.debug_NodeId, PLAIN));
  if (!(this.opt_local_def_id(node_id) === undefined)) {
    // "adding a def'n for node-id {:?} and def kind {:?} but a previous def'n exists: {:?}",
    return panic(
      `adding a def'n for node-id ${format_debug(node_id, ast_node_id_mod.debug_NodeId, PLAIN)} and def kind ${format_debug(def_kind, debug_DefKind, PLAIN)} but a previous def'n exists: ${format_debug(this.tcx.hir_def_key(this.local_def_id(node_id)), debug_DefKey, PLAIN)}`,
    );
  }

  const def_id = this.tcx
    .at(span)
    .create_def(parent, name, def_kind, undefined, this.curr_owner.disambiguator)
    .def_id();

  // debug!("create_def: def_id_to_node_id[{:?}] <-> {:?}", def_id, node_id);
  this.node_id_to_def_id.set(node_id, def_id);

  return def_id;
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:849 next_node_id
LoweringContext.prototype.next_node_id = function (this: LoweringContext): NodeId {
  const start = this.next_node_id_;
  // `start.as_u32().checked_add(1).expect(..)`
  const next = start + 1;
  if (next > 0xffff_ffff) panic("input too large; ran out of NodeIds");
  this.next_node_id_ = NodeId.from_u32(next);
  return start;
};

/// Given the id of some node in the AST, finds the `LocalDefId` associated with it by the name
/// resolver (if any).
// #[instrument(level = "trace", skip(self), ret)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:859 opt_local_def_id
LoweringContext.prototype.opt_local_def_id = function (this: LoweringContext, node: NodeId): LocalDefId | undefined {
  return this.node_id_to_def_id.get(node) ?? this.curr_owner.owner.node_id_to_def_id.get(node);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:866 local_def_id
LoweringContext.prototype.local_def_id = function (this: LoweringContext, node: NodeId): LocalDefId {
  const r = this.opt_local_def_id(node);
  if (r !== undefined) return r;
  // PORT: `.items().any(..)` over `UnordMap`s: the iteration order only decides which panic message wins.
  for (const [id, items] of this.resolver.owners) {
    for (const [node_id, def_id] of items.node_id_to_def_id) {
      if (node_id === node) {
        const actual_owner = items.node_id_to_def_id.get(id);
        panic(
          `${format_debug(def_id, debug_LocalDefId, PLAIN)} (${node_id}) was found in ${debug_option(actual_owner, PLAIN, debug_LocalDefId)} (${id})`,
        );
      }
    }
  }
  return panic(`no entry for node id: \`${format_debug(node, ast_node_id_mod.debug_NodeId, PLAIN)}\``);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:881 get_partial_res
LoweringContext.prototype.get_partial_res = function (this: LoweringContext, id: NodeId): PartialRes | undefined {
  const self_param_id = this.partial_res_overrides.get(id);
  if (self_param_id !== undefined) {
    return PartialRes.new({ $: "Local", _0: self_param_id });
  } else {
    return this.resolver.partial_res_map.get(id);
  }
};

/// Given the id of an owner node in the AST, returns the corresponding `OwnerId`.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:889 owner_id
LoweringContext.prototype.owner_id = function (this: LoweringContext, node: NodeId): OwnerId {
  return new OwnerId(map_index(this.resolver.owners, node).def_id);
};

/// This method allocates a new `HirId` for the given `NodeId`.
/// Take care not to call this method if the resulting `HirId` is then not
/// actually used in the HIR, as that would trigger an assertion in the
/// `HirIdValidator` later on, which makes sure that all `NodeId`s got mapped
/// properly. Calling the method twice with the same `NodeId` is also forbidden.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:899 lower_node_id
LoweringContext.prototype.lower_node_id = function (this: LoweringContext, ast_node_id: NodeId): HirId {
  assert_ne(ast_node_id, DUMMY_NODE_ID, (v) => format_debug(v, ast_node_id_mod.debug_NodeId, PLAIN));

  const owner = this.curr_owner.owner_id();
  const local_id = this.curr_owner.item_local_id_counter;
  assert_ne(local_id, rustc_hir.ItemLocalId.ZERO, (v) => format_debug(v, rustc_hir.debug_ItemLocalId, PLAIN));
  // `increment_by(1)`
  this.curr_owner.item_local_id_counter = rustc_hir.ItemLocalId.new(rustc_hir.ItemLocalId.index(local_id) + 1);
  const hir_id = new HirId(owner, local_id);

  const def_id = this.opt_local_def_id(ast_node_id);
  if (def_id !== undefined) {
    this.curr_owner.children.set(def_id, { $: "NonOwner", _0: hir_id });
  }

  const traits = this.curr_owner.owner.trait_map.get(ast_node_id);
  if (traits !== undefined) {
    // PORT: `PerOwnerResolverData::trait_map` is typed `readonly unknown[]` in rustc_middle (TraitCandidate pending).
    this.curr_owner.trait_map.set(hir_id.local_id, traits as readonly hir.TraitCandidate[]);
  }

  // Check whether the same `NodeId` is lowered more than once.
  // #[cfg(debug_assertions)]
  // self.curr_owner.relowering_checker.assert_node_is_not_relowered(ast_node_id, local_id);

  return hir_id;
};

/// Generate a new `HirId` without a backing `NodeId`.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:925 next_id
LoweringContext.prototype.next_id = function (this: LoweringContext): HirId {
  const owner = this.curr_owner.owner_id();
  const local_id = this.curr_owner.item_local_id_counter;
  assert_ne(local_id, rustc_hir.ItemLocalId.ZERO, (v) => format_debug(v, rustc_hir.debug_ItemLocalId, PLAIN));
  // `increment_by(1)`
  this.curr_owner.item_local_id_counter = rustc_hir.ItemLocalId.new(rustc_hir.ItemLocalId.index(local_id) + 1);
  return new HirId(owner, local_id);
};

// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:934 lower_res
LoweringContext.prototype.lower_res = function (this: LoweringContext, res: Res<NodeId>): Res {
  const res_: Result<Res, null> = Res.apply_id(res, (id: NodeId): Result<HirId, null> => {
    const owner = this.curr_owner.owner_id();
    const local_id = this.curr_owner.ident_and_label_to_local_id.get(id);
    if (local_id === undefined) return Err(null);
    return Ok(new HirId(owner, local_id));
  });
  // trace!(?res);

  // We may fail to find a HirId when the Res points to a Local from an enclosing HIR owner.
  // This can happen when trying to lower the return type `x` in erroneous code like
  //   async fn foo(x: u8) -> x {}
  // In that case, `x` is lowered as a function parameter, and the return type is lowered as
  // an opaque type as a synthesized HIR owner.
  return res_.$ === "Ok" ? res_._0 : { $: "Err" };
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:951 expect_full_res
LoweringContext.prototype.expect_full_res = function (this: LoweringContext, id: NodeId): Res<NodeId> {
  const pr = this.get_partial_res(id);
  return pr === undefined ? { $: "Err" } : pr.expect_full_res();
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:955 lower_import_res
LoweringContext.prototype.lower_import_res = function (this: LoweringContext, id: NodeId, span: Span): PerNS<Res | undefined> {
  let per_ns_ = this.curr_owner.owner.import_res.get(id);
  if (per_ns_ === undefined) {
    const sp = this.tcx.source_span(this.curr_owner.owner.def_id);
    this.tcx
      .dcx()
      .span_delayed_bug(sp, "no import_res entry for import, this should only happen if it already errored in resolve");
    per_ns_ = new PerNS<Res<NodeId> | undefined>(undefined, undefined, undefined);
  }
  const per_ns = per_ns_.map((res) => (res === undefined ? undefined : this.lower_res(res)));

  if (per_ns.is_empty()) {
    // Propagate the error to all namespaces, just to be sure.
    this.dcx().span_delayed_bug(span, "no resolution for an import");
    const err: Res | undefined = { $: "Err" };
    return new PerNS<Res | undefined>(err, err, err);
  }
  return per_ns;
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:981 make_lang_item_qpath
LoweringContext.prototype.make_lang_item_qpath = function (
  this: LoweringContext,
  lang_item: LangItem,
  span: Span,
  args: hir.GenericArgs | undefined,
): hir.QPath {
  return { $: "Resolved", _0: undefined, _1: this.make_lang_item_path(lang_item, span, args) };
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:990 make_lang_item_path
LoweringContext.prototype.make_lang_item_path = function (
  this: LoweringContext,
  lang_item: LangItem,
  span: Span,
  args: hir.GenericArgs | undefined,
): hir.Path {
  const def_id = this.tcx.require_lang_item(lang_item, span);
  const def_kind = this.tcx.def_kind(def_id);
  const res: Res = { $: "Def", _0: def_kind, _1: def_id };
  return this.arena.alloc(
    new rustc_hir.Path(
      span,
      res,
      this.arena.alloc_from_iter([
        new rustc_hir.PathSegment(Ident.new(LangItem.name(lang_item), span), this.next_id(), res, args, args === undefined, false),
      ]),
    ),
  );
};

/// Reuses the span but adds information like the kind of the desugaring and features that are
/// allowed inside this span.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1015 mark_span_with_reason
LoweringContext.prototype.mark_span_with_reason = function (
  this: LoweringContext,
  reason: DesugaringKind,
  span: Span,
  allow_internal_unstable: readonly Symbol[] | undefined,
): Span {
  return this.tcx.with_stable_hashing_context((hcx) =>
    Span.mark_with_reason(span, allow_internal_unstable, reason, Span.edition(span), hcx),
  );
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1026 span_lowerer
LoweringContext.prototype.span_lowerer = function (this: LoweringContext): SpanLowerer {
  return new SpanLowerer(this.tcx.sess.opts.incremental !== undefined, this.curr_owner.owner_id().def_id);
};

/// Intercept all spans entering HIR.
/// Mark a span as relative to the current owning item.
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1035 lower_span
LoweringContext.prototype.lower_span = function (this: LoweringContext, span: Span): Span {
  return this.span_lowerer().lower(span);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1039 lower_ident
LoweringContext.prototype.lower_ident = function (this: LoweringContext, ident: Ident): Ident {
  return Ident.new(ident.name, this.lower_span(ident.span));
};

/// Converts a lifetime into a new generic parameter.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1045 lifetime_res_to_generic_param
LoweringContext.prototype.lifetime_res_to_generic_param = function (
  this: LoweringContext,
  ident: Ident,
  node_id: NodeId,
  kind: hir.MissingLifetimeKind,
  source: hir.GenericParamSource,
): hir.GenericParam {
  // Late resolution delegates to us the creation of the `LocalDefId`.
  const _def_id = this.create_def(node_id, kw.UnderscoreLifetime, DefKind.LifetimeParam, ident.span);
  // debug!(?_def_id);

  const hir_id = this.lower_node_id(node_id);
  const def_id = this.local_def_id(node_id);
  return new rustc_hir.GenericParam(
    hir_id,
    def_id,
    rustc_hir.ParamName.Fresh,
    this.lower_span(ident.span),
    false,
    { $: "Lifetime", kind: { $: "Elided", _0: kind } },
    undefined,
    source,
  );
};

/// Lowers a lifetime binder that defines `generic_params`, returning the corresponding HIR
/// nodes. The returned list includes any "extra" lifetime parameters that were added by the
/// name resolver owing to lifetime elision; this also populates the resolver's node-id->def-id
/// map, so that later calls to `opt_node_id_to_def_id` that refer to these extra lifetime
/// parameters will be successful.
// #[instrument(level = "debug", skip(self), ret)]
// #[inline]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1082 lower_lifetime_binder
LoweringContext.prototype.lower_lifetime_binder = function (
  this: LoweringContext,
  binder: NodeId,
  generic_params: readonly AstGenericParam[],
): readonly hir.GenericParam[] {
  // Start by creating params for extra lifetimes params, as this creates the definitions
  // that may be referred to by the AST inside `generic_params`.
  const extra_lifetimes_ = this.curr_owner.owner.extra_lifetime_params(binder);
  // debug!(?extra_lifetimes);
  const extra_lifetimes: hir.GenericParam[] = extra_lifetimes_.map(([ident, node_id, res]) =>
    // PORT: `extra_lifetime_params` is typed `unknown` for `MissingLifetimeKind` in rustc_middle.
    this.lifetime_res_to_generic_param(ident, node_id, res as hir.MissingLifetimeKind, "Binder"),
  );
  const arena = this.arena;
  const explicit_generic_params = this.lower_generic_params_mut(generic_params, "Binder");
  // `explicit_generic_params.chain(extra_lifetimes.into_iter())`
  return arena.alloc_from_iter([...explicit_generic_params, ...extra_lifetimes]);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1108 with_dyn_type_scope
LoweringContext.prototype.with_dyn_type_scope = function <T>(
  this: LoweringContext,
  in_scope: boolean,
  f: (this_: LoweringContext) => T,
): T {
  const was_in_dyn_type = this.is_in_dyn_type;
  this.is_in_dyn_type = in_scope;

  const result = f(this);

  this.is_in_dyn_type = was_in_dyn_type;

  return result;
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1119 with_new_scopes
LoweringContext.prototype.with_new_scopes = function <T>(
  this: LoweringContext,
  scope_span: Span,
  f: (this_: LoweringContext) => T,
): T {
  const current_item_span = this.current_item_span;
  this.current_item_span = scope_span;

  const was_in_loop_condition = this.is_in_loop_condition;
  this.is_in_loop_condition = false;

  // `self.contract_ensures.take()`
  const old_contract = this.contract_ensures;
  this.contract_ensures = undefined;

  // `mem::replace(&mut self.try_block_scope, TryBlockScope::Function)`
  const try_block_scope = this.try_block_scope;
  this.try_block_scope = TryBlockScope.Function;
  // `self.loop_scope.take()`
  const loop_scope = this.loop_scope;
  this.loop_scope = undefined;
  const ret = f(this);
  this.try_block_scope = try_block_scope;
  this.loop_scope = loop_scope;

  this.contract_ensures = old_contract;

  this.is_in_loop_condition = was_in_loop_condition;

  this.current_item_span = current_item_span;

  return ret;
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1143 lower_attrs
LoweringContext.prototype.lower_attrs = function (
  this: LoweringContext,
  id: HirId,
  attrs: readonly AstAttribute[],
  target_span: Span,
  target: Target,
): readonly HirAttribute[] {
  return this.lower_attrs_with_extra(id, attrs, target_span, target, undefined, []);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1153 lower_attrs_with_extra
LoweringContext.prototype.lower_attrs_with_extra = function (
  this: LoweringContext,
  id: HirId,
  attrs: readonly AstAttribute[],
  target_span: Span,
  target: Target,
  target_item: Item | undefined,
  extra_hir_attributes: readonly HirAttribute[],
): readonly HirAttribute[] {
  if (attrs.length === 0 && extra_hir_attributes.length === 0) {
    return [];
  } else {
    const lowered_attrs = this.lower_attrs_vec(attrs, this.lower_span(target_span), id, target, target_item);
    // `lowered_attrs.extend(extra_hir_attributes.iter().cloned())`
    // PORT: HIR attributes are never mutated after lowering, so the clone shares them.
    lowered_attrs.push(...extra_hir_attributes);

    assert_eq(id.owner, this.curr_owner.owner_id(), (v) => format_debug(v, debug_OwnerId, PLAIN), OwnerId_eq);
    const ret = this.arena.alloc_from_iter(lowered_attrs);

    // this is possible if an item contained syntactical attribute,
    // but none of them parse successfully or all of them were ignored
    // for not being built-in attributes at all. They could be remaining
    // unexpanded attributes used as markers in proc-macro derives for example.
    // This will have emitted some diagnostics for the misparse, but will then
    // not emit the attribute making the list empty.
    if (ret.length === 0) {
      return [];
    } else {
      this.curr_owner.attrs.insert(id.local_id, ret);
      return ret;
    }
  }
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1187 lower_attrs_vec
LoweringContext.prototype.lower_attrs_vec = function (
  this: LoweringContext,
  attrs: readonly AstAttribute[],
  target_span: Span,
  target_hir_id: HirId,
  target: Target,
  target_item: Item | undefined,
): HirAttribute[] {
  const l = this.span_lowerer();
  return this.attribute_parser.parse_attribute_list(
    attrs,
    target_span,
    target,
    target_item,
    (s) => l.lower(s),
    (lint_id, span, kind) => {
      // PORT: `rustc_hir::lints::DelayedLint` (lints.rs) is not ported yet (`unknown`); the literal has its fields.
      this.curr_owner.delayed_lints.push({
        lint_id,
        id: target_hir_id,
        span,
        callback: (dcx: DiagCtxtHandle, level: unknown, sess: unknown) => {
          // `sess.downcast_ref::<rustc_session::Session>().expect("expected `Session`")`
          if (!(sess instanceof Session)) panic("expected `Session`");
          return kind._0(dcx, level as Parameters<typeof kind._0>[1], sess);
        },
      });
    },
  );
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1218 alias_attrs
LoweringContext.prototype.alias_attrs = function (this: LoweringContext, id: HirId, target_id: HirId): void {
  assert_eq(id.owner, this.curr_owner.owner_id(), (v) => format_debug(v, debug_OwnerId, PLAIN), OwnerId_eq);
  assert_eq(target_id.owner, this.curr_owner.owner_id(), (v) => format_debug(v, debug_OwnerId, PLAIN), OwnerId_eq);
  const a = this.curr_owner.attrs.get(target_id.local_id);
  if (a !== undefined) {
    assert(!(a.length === 0), "assertion failed: !a.is_empty()");
    this.curr_owner.attrs.insert(id.local_id, a);
  }
};

/// Lower an associated item constraint.
// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1229 lower_assoc_item_constraint
LoweringContext.prototype.lower_assoc_item_constraint = function (
  this: LoweringContext,
  constraint: AstAssocItemConstraint,
  itctx: ImplTraitContext,
): hir.AssocItemConstraint {
  // debug!(?constraint, ?itctx);
  // Lower the generic arguments for the associated item.
  let gen_args: hir.GenericArgs;
  if (constraint.gen_args !== undefined) {
    const gen_args_ = constraint.gen_args;
    let gen_args_ctor: GenericArgsCtor;
    switch (gen_args_.$) {
      case "AngleBracketed": {
        const data = gen_args_._0;
        gen_args_ctor = this.lower_angle_bracketed_parameter_data(data, "Explicit", itctx)[0];
        break;
      }
      case "Parenthesized": {
        const data = gen_args_._0;
        const first_char = constraint.ident.as_str().codePointAt(0);
        if (first_char !== undefined && first_char >= 0x61 && first_char <= 0x7a) {
          let err: diagnostics.BadReturnTypeNotation;
          const output = data.output;
          if (data.inputs.length > 0 && output.$ === "Default") {
            err = { $: "Inputs", span: data.inputs_span };
          } else if (data.inputs.length === 0 && output.$ === "Default") {
            err = { $: "NeedsDots", span: data.inputs_span };
          } else {
            // The case `T: Trait<method(..) -> Ret>` is handled in the parser.
            const ty = (output as Extract<typeof output, { $: "Ty" }>)._0;
            const span = Span.to(Span.shrink_to_hi(data.inputs_span), ty.span);
            err = { $: "Output", span, suggestion: { output: span, input: data.inputs_span } };
          }
          const err_ = this.dcx().create_err(diagnostics.BadReturnTypeNotation_diagnostic(err));
          if (!this.tcx.features().return_type_notation() && this.tcx.sess.is_nightly_build()) {
            add_feature_diagnostics(err_, this.tcx.sess, sym.return_type_notation);
          }
          err_.emit();
          gen_args_ctor = new GenericArgsCtor([], [], "ReturnTypeNotation", data.span);
        } else {
          const guar = this.emit_bad_parenthesized_trait_in_assoc_ty(data);
          gen_args_ctor = this.lower_angle_bracketed_parameter_data(data.as_angle_bracketed_args(), "Explicit", {
            $: "AlreadyErrored",
            _0: guar,
          })[0];
        }
        break;
      }
      case "ParenthesizedElided": {
        const span = gen_args_._0;
        gen_args_ctor = new GenericArgsCtor([], [], "ReturnTypeNotation", span);
        break;
      }
    }
    gen_args = gen_args_ctor.into_generic_args(this);
  } else {
    gen_args = rustc_hir.GenericArgs.NONE;
  }
  let kind: hir.AssocItemConstraintKind;
  const ckind = constraint.kind;
  switch (ckind.$) {
    case "Equality": {
      const term_ = ckind.term;
      let term: hir.Term;
      switch (term_.$) {
        case "Ty":
          term = rustc_hir.Term.from_Ty(this.lower_ty_alloc(term_._0, itctx));
          break;
        case "Const":
          term = rustc_hir.Term.from_ConstArg(this.lower_anon_const_to_const_arg_and_alloc(term_._0));
          break;
      }
      kind = { $: "Equality", term };
      break;
    }
    case "Bound": {
      const bounds = ckind.bounds;
      // Disallow ATB in dyn types
      if (this.is_in_dyn_type) {
        let suggestion: Span | undefined;
        switch (itctx.$) {
          case "OpaqueTy":
          case "Universal": {
            const bound_end_span =
              constraint.gen_args === undefined ? constraint.ident.span : AstGenericArgs.span(constraint.gen_args);
            if (Span.eq_ctxt(bound_end_span, constraint.span)) {
              suggestion = this.tcx.sess.source_map().next_point(bound_end_span);
            } else {
              suggestion = undefined;
            }
            break;
          }
          default:
            suggestion = undefined;
        }

        const guar = this.dcx().emit_err(
          diagnostics.MisplacedAssocTyBinding_diagnostic({ span: constraint.span, suggestion }),
        );
        const err_ty = this.arena.alloc(this.ty(constraint.span, { $: "Err", _0: guar }));
        kind = { $: "Equality", term: rustc_hir.Term.from_Ty(err_ty) };
      } else {
        const bounds_ = this.lower_param_bounds(bounds, { $: "Forbidden", _0: "AssocTyBounds" }, itctx);
        kind = { $: "Bound", bounds: bounds_ };
      }
      break;
    }
  }

  return new rustc_hir.AssocItemConstraint(
    this.lower_node_id(constraint.id),
    this.lower_ident(constraint.ident),
    gen_args,
    kind,
    this.lower_span(constraint.span),
  );
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1359 emit_bad_parenthesized_trait_in_assoc_ty
LoweringContext.prototype.emit_bad_parenthesized_trait_in_assoc_ty = function (
  this: LoweringContext,
  data: ParenthesizedArgs,
): ErrorGuaranteed {
  // Suggest removing empty parentheses: "Trait()" -> "Trait"
  let sub: diagnostics.AssocTyParenthesesSub;
  if (data.inputs.length === 0) {
    const parentheses_span = Span.to(Span.shrink_to_lo(data.inputs_span), Span.shrink_to_hi(data.inputs_span));
    sub = { $: "Empty", parentheses_span };
  }
  // Suggest replacing parentheses with angle brackets `Trait(params...)` to `Trait<params...>`
  else {
    // Start of parameters to the 1st argument
    const open_param = Span.to(Span.shrink_to_lo(data.inputs_span), Span.shrink_to_lo(unwrap(data.inputs[0]).span));
    // End of last argument to end of parameters
    const close_param = Span.to(
      Span.shrink_to_hi(unwrap(data.inputs[data.inputs.length - 1]).span),
      Span.shrink_to_hi(data.inputs_span),
    );
    sub = { $: "NotEmpty", open_param, close_param };
  }
  return this.dcx().emit_err(diagnostics.AssocTyParentheses_diagnostic({ span: data.span, sub }));
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1387 lower_generic_arg
LoweringContext.prototype.lower_generic_arg = function (
  this: LoweringContext,
  arg: AstGenericArg,
  itctx: ImplTraitContext,
): hir.GenericArg {
  switch (arg.$) {
    case "Lifetime": {
      const lt = arg._0;
      return {
        $: "Lifetime",
        _0: this.lower_lifetime(lt, { $: "Path", angle_brackets: "Full" }, rustc_hir.LifetimeSyntax.from(lt.ident)),
      };
    }
    case "Type": {
      const ty = arg._0;
      // We cannot just match on `TyKind::Infer` as `(_)` is represented as
      // `TyKind::Paren(TyKind::Infer)` and should also be lowered to `GenericArg::Infer`
      if (ty.is_maybe_parenthesised_infer()) {
        return {
          $: "Infer",
          _0: this.arena.alloc(new rustc_hir.InferArg(this.lower_node_id(ty.id), this.lower_span(ty.span), "TypeOrConst")),
        };
      }

      const tkind = ty.kind;
      // We parse const arguments as path types as we cannot distinguish them during
      // parsing. We try to resolve that ambiguity by attempting resolution in both the
      // type and value namespaces. If we resolved the path in the value namespace, we
      // transform it into a generic const argument.
      //
      // Note that even under `#![feature(gca_min_const_items)]`, only plain paths
      // to constants are allowed - e.g. `A::<T::ASSOC_CONST>` and
      // `A::<CONST_WITH_PARAM::<2>>` are disallowed (they must be wrapped in `{ }`).
      //
      // FIXME: Should we be handling `(PATH_TO_CONST)`?
      let res: Res<NodeId> | undefined;
      if (
        tkind.$ === "Path" &&
        tkind._0 === undefined &&
        tkind._1.is_single_argless_ident() &&
        (res = this.get_partial_res(ty.id)?.full_res()) !== undefined &&
        !Res.matches_ns(res, "TypeNS")
      ) {
        const path = tkind._1;
        const ct = this.lower_const_path_to_const_arg(undefined, path, res, ty.id, ty.span);
        const ct_ = this.arena.alloc(ct);
        return { $: "Const", _0: unwrap(ct_.try_as_ambig_ct()) };
      } else if (tkind.$ === "GcaMacro" && this.tcx.features().gca()) {
        const expr = tkind._0;
        const r = this.can_lower_expr_to_const_arg_direct(expr, this.direct_const_arg_context_enabled_by_gca_macro());
        let ct: hir.ConstArg;
        switch (r.$) {
          case "Ok":
            ct = this.lower_expr_to_const_arg_direct(expr, undefined);
            break;
          case "Err":
            ct = r._0.emit(this);
            break;
        }
        const ct_ = this.arena.alloc(ct);
        const amb = ct_.try_as_ambig_ct();
        if (amb !== undefined) {
          return { $: "Const", _0: amb };
        } else {
          return {
            $: "Infer",
            _0: this.arena.alloc(new rustc_hir.InferArg(ct_.hir_id, ct_.span, "Const")),
          };
        }
      }
      return { $: "Type", _0: unwrap(this.lower_ty_alloc(ty, itctx).try_as_ambig_ty()) };
    }
    case "Const": {
      const ct = this.lower_anon_const_to_const_arg_and_alloc(arg._0);
      const amb = ct.try_as_ambig_ct();
      if (amb !== undefined) {
        return { $: "Const", _0: amb };
      } else {
        return {
          $: "Infer",
          _0: this.arena.alloc(new rustc_hir.InferArg(ct.hir_id, ct.span, "Const")),
        };
      }
    }
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/lib.rs:1469 lower_ty_alloc
LoweringContext.prototype.lower_ty_alloc = function (this: LoweringContext, t: AstTy, itctx: ImplTraitContext): hir.Ty {
  return this.arena.alloc(this.lower_ty(t, itctx));
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1473 lower_path_ty
LoweringContext.prototype.lower_path_ty = function (
  this: LoweringContext,
  t: AstTy,
  qself: QSelf | undefined,
  path: AstPath,
  param_mode: ParamMode,
  itctx: ImplTraitContext,
): hir.Ty {
  // Check whether we should interpret this as a bare trait object.
  // This check mirrors the one in late resolution. We only introduce this special case in
  // the rare occurrence we need to lower `Fresh` anonymous lifetimes.
  // The other cases when a qpath should be opportunistically made a trait object are handled
  // by `ty_path`.
  let partial_res: PartialRes | undefined;
  let full_res: Res<NodeId> | undefined;
  if (
    qself === undefined &&
    (partial_res = this.get_partial_res(t.id)) !== undefined &&
    (full_res = partial_res.full_res()) !== undefined &&
    full_res.$ === "Def" &&
    (full_res._0.$ === "Trait" || full_res._0.$ === "TraitAlias")
  ) {
    const [bounds, lifetime_bound] = this.with_dyn_type_scope(true, (this_): [hir.PolyTraitRef[], hir.Lifetime] => {
      const bound = this_.lower_poly_trait_ref(
        new PolyTraitRef([], clone_TraitBoundModifiers(TraitBoundModifiers.NONE), { path: clone_Path(path), ref_id: t.id }, t.span, "No"),
        { $: "Forbidden", _0: "TraitObjectTy" },
        itctx,
      );
      const bounds = this_.arena.alloc_from_iter([bound]);
      const lifetime_bound = this_.elided_dyn_bound(t.span);
      return [bounds, lifetime_bound];
    });
    const kind: hir.TyKind = { $: "TraitObject", _0: bounds, _1: TaggedRef.new(lifetime_bound, "None") };
    return new rustc_hir.Ty<null>(this.next_id(), this.lower_span(t.span), kind);
  }

  const id = this.lower_node_id(t.id);
  const qpath = this.lower_qpath(t.id, qself, path, param_mode, "Yes", itctx, undefined);
  return this.ty_path(id, t.span, qpath);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1526 ty
LoweringContext.prototype.ty = function (this: LoweringContext, span: Span, kind: hir.TyKind): hir.Ty {
  return new rustc_hir.Ty<null>(this.next_id(), this.lower_span(span), kind);
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1530 ty_tup
LoweringContext.prototype.ty_tup = function (this: LoweringContext, span: Span, tys: readonly hir.Ty[]): hir.Ty {
  return this.ty(span, { $: "Tup", _0: tys });
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1534 lower_ty
LoweringContext.prototype.lower_ty = function (this: LoweringContext, t: AstTy, itctx: ImplTraitContext): hir.Ty {
  let kind: hir.TyKind;
  const tk = t.kind;
  switch (tk.$) {
    case "Infer":
      kind = { $: "Infer", _0: null };
      break;
    case "Err":
      kind = { $: "Err", _0: tk._0 };
      break;
    case "Slice":
      kind = { $: "Slice", _0: this.lower_ty_alloc(tk._0, itctx) };
      break;
    case "Ptr":
      kind = { $: "Ptr", _0: this.lower_ty_alloc(tk._0, itctx), _1: tk._1 };
      break;
    case "Ref": {
      const lifetime = this.lower_ty_direct_lifetime(t, tk._0);
      kind = { $: "Ref", _0: lifetime, _1: this.lower_ty_alloc(tk._1, itctx), _2: tk._2 };
      break;
    }
    case "PinnedRef": {
      const lifetime = this.lower_ty_direct_lifetime(t, tk._0);
      const kind_: hir.TyKind = { $: "Ref", _0: lifetime, _1: this.lower_ty_alloc(tk._1, itctx), _2: tk._2 };
      const span = this.lower_span(t.span);
      const arg = new rustc_hir.Ty<null>(this.next_id(), span, kind_);
      const args = this.arena.alloc(
        new rustc_hir.GenericArgs(
          // PORT: `hir::GenericArg::Type(&Ty<()>)` coerces to `&Ty<AmbigArg>` upstream; the TS generic is a cast.
          this.arena.alloc([{ $: "Type", _0: this.arena.alloc(arg) as hir.Ty<hir.AmbigArg> }]),
          [],
          "No",
          span,
        ),
      );
      const path = this.make_lang_item_qpath(LangItem.Pin, span, args);
      kind = { $: "Path", _0: path };
      break;
    }
    case "FnPtr": {
      const f = tk._0;
      const hir_id = this.lower_node_id(t.id);
      const generic_params = this.lower_lifetime_binder(t.id, f.generic_params);
      const kind_: hir.TyKind = {
        $: "FnPtr",
        _0: this.arena.alloc({
          generic_params,
          safety: this.lower_safety(f.safety, "Safe"),
          abi: this.lower_extern(f.ext),
          decl: this.lower_fn_decl(f.decl, t.id, hir_id, "Pointer", undefined, "Yes"),
          param_idents: this.lower_fn_params_to_idents(f.decl),
        }),
      };
      return new rustc_hir.Ty<null>(hir_id, this.lower_span(t.span), kind_);
    }
    case "UnsafeBinder": {
      const f = tk._0;
      const generic_params = this.lower_lifetime_binder(t.id, f.generic_params);
      kind = {
        $: "UnsafeBinder",
        _0: this.arena.alloc({
          generic_params,
          inner_ty: this.lower_ty_alloc(f.inner_ty, itctx),
        }),
      };
      break;
    }
    case "Never":
      kind = rustc_hir.TyKind.Never;
      break;
    case "Tup": {
      const tys = tk._0;
      kind = { $: "Tup", _0: this.arena.alloc_from_iter(tys.map((ty) => this.lower_ty(ty, itctx))) };
      break;
    }
    case "Paren": {
      return this.lower_ty(tk._0, itctx);
    }
    case "Path": {
      return this.lower_path_ty(t, tk._0, tk._1, "Explicit", itctx);
    }
    case "ImplicitSelf": {
      const hir_id = this.next_id();
      const res_ = this.expect_full_res(t.id);
      const res = this.lower_res(res_);
      kind = {
        $: "Path",
        _0: {
          $: "Resolved",
          _0: undefined,
          _1: this.arena.alloc(
            new rustc_hir.Path(
              this.lower_span(t.span),
              res,
              this.arena.alloc_from_iter([rustc_hir.PathSegment.new(Ident.with_dummy_span(kw.SelfUpper), hir_id, res)]),
            ),
          ),
        },
      };
      break;
    }
    case "Array": {
      kind = {
        $: "Array",
        _0: this.lower_ty_alloc(tk._0, itctx),
        _1: this.lower_array_length_to_const_arg(tk._1),
      };
      break;
    }
    case "TraitObject": {
      const bounds = tk._0;
      const [bounds_, lifetime_bound_] = this.with_dyn_type_scope(true, (this_): [hir.PolyTraitRef[], hir.Lifetime] => {
        let lifetime_bound: hir.Lifetime | undefined = undefined;
        // `bounds.iter().filter_map(..)`, consumed by `alloc_from_iter`
        const bounds__: hir.PolyTraitRef[] = [];
        for (const bound of bounds) {
          switch (bound.$) {
            // We can safely ignore constness here since AST validation
            // takes care of rejecting invalid modifier combinations and
            // const trait bounds in trait object types.
            case "Trait": {
              const ty = bound._0;
              const trait_ref = this_.lower_poly_trait_ref(ty, { $: "Forbidden", _0: "TraitObjectTy" }, itctx);
              bounds__.push(trait_ref);
              break;
            }
            case "Outlives": {
              const lifetime = bound._0;
              if (lifetime_bound === undefined) {
                lifetime_bound = this_.lower_lifetime(lifetime, { $: "Other" }, rustc_hir.LifetimeSyntax.from(lifetime.ident));
              }
              break;
            }
            // Ignore `use` syntax since that is not valid in objects.
            case "Use": {
              const span = bound._1;
              this_.dcx().span_delayed_bug(span, "use<> not allowed in dyn types");
              break;
            }
          }
        }
        const bounds___ = this_.arena.alloc_from_iter(bounds__);
        return [bounds___, lifetime_bound !== undefined ? lifetime_bound : this_.elided_dyn_bound(t.span)];
      });
      kind = { $: "TraitObject", _0: bounds_, _1: TaggedRef.new(lifetime_bound_, tk._1) };
      break;
    }
    case "ImplTrait": {
      const def_node_id = tk._0;
      const bounds = tk._1;
      const span = t.span;
      switch (itctx.$) {
        case "OpaqueTy": {
          const origin = itctx.origin;
          kind = this.lower_opaque_impl_trait(span, origin, def_node_id, bounds, itctx);
          break;
        }
        case "Universal": {
          let use_span: Span | undefined = undefined;
          for (const bound of bounds) {
            if (bound.$ === "Use") {
              use_span = bound._1;
              break;
            }
          }
          if (use_span !== undefined) {
            this.tcx.dcx().emit_err(diagnostics.NoPreciseCapturesOnApit_diagnostic({ span: use_span }));
          }

          const def_id = this.local_def_id(def_node_id);
          const name = this.tcx.item_name(LocalDefId.to_def_id(def_id));
          const ident = Ident.new(name, span);
          const [param, bounds_, path] = this.lower_universal_param_and_bounds(def_node_id, span, ident, bounds);
          this.curr_owner.impl_trait_defs.push(param);
          if (bounds_ !== undefined) {
            this.curr_owner.impl_trait_bounds.push(bounds_);
          }
          kind = path;
          break;
        }
        case "InBinding": {
          kind = {
            $: "TraitAscription",
            _0: this.lower_param_bounds(bounds, { $: "Allowed", _0: new DefIdMap() }, itctx),
          };
          break;
        }
        case "FeatureGated": {
          const position = itctx._0;
          const feature = itctx._1;
          const guar = this.tcx.sess
            .create_feature_err(
              // `position: DiagArgFromDisplay(&position)`
              diagnostics.MisplacedImplTrait_diagnostic({ span: t.span, position: new DiagArgFromDisplay(() => display_ImplTraitPosition(position)) }),
              feature,
            )
            .emit_err();
          kind = { $: "Err", _0: guar };
          break;
        }
        case "Disallowed": {
          const position = itctx._0;
          const guar = this.dcx().emit_err(
            diagnostics.MisplacedImplTrait_diagnostic({ span: t.span, position: new DiagArgFromDisplay(() => display_ImplTraitPosition(position)) }),
          );
          kind = { $: "Err", _0: guar };
          break;
        }
        case "AlreadyErrored": {
          const guar = itctx._0;
          // `GenericArgs::Parenthesized` stores its inputs as `Param`s, so the def
          // collector visits `impl Trait` in a universal context and creates a
          // `DefKind::TyParam`. During recovery we reinterpret these arguments as
          // angle-bracketed, where lowering may otherwise expect an opaque type.
          // The parenthesized syntax has already been rejected, so avoid lowering
          // this `impl Trait` with the inconsistent `DefKind`.
          kind = { $: "Err", _0: guar };
          break;
        }
      }
      break;
    }
    case "Pat": {
      kind = { $: "Pat", _0: this.lower_ty_alloc(tk._0, itctx), _1: this.lower_ty_pat(tk._1, tk._0.span) };
      break;
    }
    case "FieldOf": {
      const variant = tk._1;
      const field = tk._2;
      kind = {
        $: "FieldOf",
        _0: this.lower_ty_alloc(tk._0, itctx),
        _1: this.arena.alloc({
          variant: variant === undefined ? undefined : this.lower_ident(variant),
          field: this.lower_ident(field),
        }),
      };
      break;
    }
    case "MacCall": {
      return span_bug(t.span, "`TyKind::MacCall` should have been expanded by now");
    }
    case "CVarArgs": {
      const guar = this.dcx().span_delayed_bug(t.span, "`TyKind::CVarArgs` should have been handled elsewhere");
      kind = { $: "Err", _0: guar };
      break;
    }
    case "View": {
      const ty = this.lower_ty_alloc(tk._0, itctx);
      const fields = this.arena.alloc_slice(tk._1);
      kind = { $: "View", _0: ty, _1: fields };
      break;
    }
    case "GcaMacro": {
      const e = this.emit_bad_gca_macro(t.span, tk._0, "type");
      kind = { $: "Err", _0: e };
      break;
    }
    case "Dummy":
      return panic("`TyKind::Dummy` should never be lowered");
  }

  return new rustc_hir.Ty<null>(this.lower_node_id(t.id), this.lower_span(t.span), kind);
};

// ==== lane lower-lib-b: lib.rs:1757..3401 ====

/**
 * `RelaxedBoundPolicy::Allowed(&mut Default::default())`.
 * PORT: the `FxIndexMap<DefId, Span>` is a `DefIdMap` (keyed by `DefId` value, insertion-ordered like an `IndexMap`;
 * a plain `Map` would key `DefId` objects by identity). Not a port of an upstream fn.
 */
function relaxed_bound_policy_allowed(): RelaxedBoundPolicy {
  return { $: "Allowed", _0: new DefIdMap<Span>() };
}

// rustc: compiler/rustc_ast_lowering/src/lib.rs:1757 emit_bad_gca_macro
LoweringContext.prototype.emit_bad_gca_macro = function (this: LoweringContext, span: Span, expr: ast.Expr, expected: string): ErrorGuaranteed {
  const msg = `expected ${expected}, found \`gca!()\` constant`;
  if (new WillCreateDefIdsVisitor().visit_expr(expr).$ === "Break") {
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
    const res = this.curr_owner.owner.get_lifetime_res(t.id);
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
  kind: FnDeclKind,
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
    const fn_def_id = this.curr_owner.owner.def_id;
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
                parent: this.curr_owner.owner.def_id,
                in_trait_or_impl: undefined,
              },
            };
            break;
          case "Trait":
            itctx = {
              $: "OpaqueTy",
              origin: {
                $: "FnReturn",
                parent: this.curr_owner.owner.def_id,
                in_trait_or_impl: "Trait",
              },
            };
            break;
          case "Impl":
            itctx = {
              $: "OpaqueTy",
              origin: {
                $: "FnReturn",
                parent: this.curr_owner.owner.def_id,
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
  const owner = this.curr_owner.owner;
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
  fn_kind: FnDeclKind,
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
  rbp: RelaxedBoundPolicy,
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
  const res = this.curr_owner.owner.get_lifetime_res(id);
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
  const target = rustc_hir.Target_from_GenericParam(param_);
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
      const res = this.curr_owner.owner.get_lifetime_res(param.id);
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
            this.dcx().emit_err(diagnostics.GenericParamDefaultInBinder_diagnostic({ span: param.span() }));

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
            const err = diagnostics.GenericParamDefaultInBinder_diagnostic({ span: param.span() });
            if (new WillCreateDefIdsVisitor().visit_expr(anon_const.value).$ === "Break") {
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
  rbp: RelaxedBoundPolicy,
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
  rbp: RelaxedBoundPolicy,
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
        const is_sized = def_id !== undefined && this.tcx.is_lang_item(def_id, LangItem.Sized);

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
  rbp: RelaxedBoundPolicy,
  itctx: ImplTraitContext,
): hir.GenericBounds {
  return this.arena.alloc_from_iter(this.lower_param_bounds_mut(bounds, rbp, itctx));
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:2518 lower_param_bounds_mut
LoweringContext.prototype.lower_param_bounds_mut = function* (
  this: LoweringContext,
  bounds: readonly ast.GenericBound[],
  rbp: RelaxedBoundPolicy,
  itctx: ImplTraitContext,
): Generator<hir.GenericBound> {
  // PORT: `impl Iterator` (lazy `map`) -> a generator, so callers interleave the lowering as upstream does.
  for (const bound of bounds) yield this.lower_param_bound(bound, RelaxedBoundPolicy.reborrow(rbp), itctx);
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
    this.curr_owner.attrs.insert(hir_id.local_id, a);
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

// (lib.rs:3296 `struct GenericArgsCtor`: lib.gen.ts)

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3304 is_empty
GenericArgsCtor.prototype.is_empty = function (this: GenericArgsCtor): boolean {
  return this.args.length === 0 && this.constraints.length === 0 && this.parenthesized === "No";
};

// rustc: compiler/rustc_ast_lowering/src/lib.rs:3310 into_generic_args
GenericArgsCtor.prototype.into_generic_args = function (this: GenericArgsCtor, this_: LoweringContext): hir.GenericArgs {
  const ga = new rustc_hir.GenericArgs(this_.arena.alloc_from_iter(this.args), this.constraints, this.parenthesized, this_.lower_span(this.span));
  return ga;
};

// (lib.rs:3321 `bitflags! struct DirectConstArgContext`: lib.gen.ts, re-exported below with the `impl` consts)

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

export type DirectConstArgContext = DirectConstArgContext_flags;
// PORT: this companion shadows lib.gen.ts's (an explicit export wins over `export *`): the generated flags plus the
// associated consts of the `impl`.
export const DirectConstArgContext = {
  ...DirectConstArgContext_flags,
  STABLE: DirectConstArgContext_STABLE,
  GCA: DirectConstArgContext_GCA,
  GCA_BASE_FEATURES: DirectConstArgContext_GCA_BASE_FEATURES,
  GCA_MIN_CONST_ITEMS: DirectConstArgContext_GCA_MIN_CONST_ITEMS,
  GCA_ADTS: DirectConstArgContext_GCA_ADTS,
};

// (lib.rs:3371 `struct UnrepresentableConstArgError`: lib.gen.ts)

Object.assign(UnrepresentableConstArgError, {
  // rustc: compiler/rustc_ast_lowering/src/lib.rs:3377 new
  new(expr: ast.Expr): UnrepresentableConstArgError {
    return new UnrepresentableConstArgError(expr.span, new WillCreateDefIdsVisitor().visit_expr(expr).$ === "Break");
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
