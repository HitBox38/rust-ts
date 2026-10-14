// The rustc_ast_lowering contract: `LoweringContext`, whose `impl` blocks are spread over 13 upstream files,
// and one declaration of every fn of the crate. Grouped by upstream file in upstream order; each
// declaration carries `// <file>:<line>` (the line of its `fn` keyword at the pin). Method bodies are
// assigned onto the prototype by the file that ports them (PORTING §5 "Methods defined in another file").
//
// Contents:
// - `class LoweringContext` (fields, lib.rs:281) + `interface LoweringContext` (all 288 methods of
//   `impl LoweringContext`, lib.rs .. contract.rs). lib.rs is split between two lanes at line 1757.
// - `class DelegationResolver` (delegation/resolution.rs:183) + its methods (resolution.rs, generics.rs).
// - `interface FreeFns`: the crate's free fns with their final signatures (checked against the stub
//   modules by contract.test.ts).
// - Comment-only declarations of the remaining fns: methods of single-file helper types (generated
//   classes once the types are generated), trait impls, nested fns. They are informative; the owning lane
//   decides their exact form.
//
// Contract rules (see docs/handoff/lowering-contract.md):
// - Ownership: lane lowering-contract wrote this file; afterwards root owns it. A lane that needs a
//   missing or changed declaration writes it in its handoff (signature + reason); if it cannot type-check
//   without it, it may add a local `declare module "./decls.ts"` augmentation in its own file marked
//   `// PORT(decls): pending root`.
// - Signatures (PORTING §5): `&self`/`&mut self`/`self` -> `this`; `&T`/`&mut T`/`Box`/`P`/`Arc`/`&'hir T`
//   -> `T` (arenas are erased: `self.arena.alloc(x)` is `x`); `&[T]`/`&'hir [T]`/`Arc<[T]>` ->
//   `readonly T[]`; `Vec`/`ThinVec`/`SmallVec`/`&mut Vec` -> `T[]`; `Option<T>` -> `T | undefined`;
//   `()` returns -> `void`, `Result<(), E>` -> `Result<undefined, E>`; tuples -> arrays; maps -> `Map`;
//   `u128` -> `bigint`; `impl Iterator<Item = T>` -> `Iterable<T>`; closures
//   `impl FnOnce(&mut Self, A) -> R` -> `(this_: LoweringContext, _2: A) => R` (`_n` = argument position).
//   A destructuring parameter (`PolyTraitRef { .. }: &PolyTraitRef`, `(index, f): (usize, &FieldDef)`) is
//   `_0`. Parameter names that are JS reserved words get a trailing `_` (`default_`).
// - `hir::X` is `hir.X` from ./hir_shim.ts (the HIR types of lane hir-types, see that file); ast types are
//   rustc_ast's; `rustc_attr_ir::X` is `attr_ir.X`.
// - Associated fns without `self` are `declare static` members of the class (`LoweringContext.new`,
//   `DelegationResolver.new`, `DelegationResolver.create_slots_from_args`), assigned by the owning file.
// - The field `next_node_id` is `next_node_id_` (also a method `next_node_id()`).
//
// Init order (a TDZ ReferenceError at load otherwise): this module imports only types. It must never
// import a rustc_ast_lowering module at runtime. lib.ts (the crate root) imports this file first, then
// every extension file, then attaches lib.rs's own methods.

import type {
  AngleBracketedArgs,
  AnonConst,
  Arm,
  AssignOp,
  AssocItem,
  AssocItemConstraint,
  Attribute,
  BinOp,
  BindingMode,
  Block,
  BlockCheckMode,
  CaptureBy,
  Closure,
  ClosureBinder,
  Const,
  CoroutineMarker,
  Defaultness,
  Delegation,
  EiiDecl,
  EiiImpl,
  Expr,
  ExprField,
  Extern,
  FieldDef,
  FnContract,
  FnDecl,
  FnHeader,
  FnRetTy,
  FnSig,
  ForLoopKind,
  ForeignItem,
  GenericArg,
  GenericBound,
  GenericBounds,
  GenericParam,
  GenericParamKind,
  Generics,
  ImplRestriction,
  InlineAsm,
  IntTy,
  Item,
  ItemKind,
  Label,
  Lifetime,
  Local,
  ModSpans,
  Movability,
  MutRestriction,
  NodeId,
  ParenthesizedArgs,
  Param,
  Pat,
  Path,
  PathSegment,
  PolyTraitRef,
  PreciseCapturingArg,
  QSelf,
  RangeEnd,
  RangeLimits,
  RestrictionKind,
  Safety,
  Stmt,
  StrLit,
  TestBinderBody,
  TestBinderBoundTypeConstraint,
  TestBinderConstraint,
  TestBinderExists,
  TestBinderForall,
  TraitBoundModifiers,
  TraitImplHeader,
  TraitRef,
  Ty,
  TyPat,
  UintTy,
  UnOp,
  UnsafeSource,
  UseTree,
  Variant,
  VariantData,
  WhereClause,
  WherePredicate,
  format,
  token,
} from "../rustc_ast/lib.ts";
import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type * as attr_ir from "../rustc_attr_ir/lib.ts";
import type { LangItem } from "../rustc_attr_ir/lib.ts";
import type { Target } from "../rustc_attr_ir/target.ts";
import type { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import type { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import type { Steal } from "../rustc_data_structures/steal.ts";
import type { DiagCtxtHandle } from "../rustc_errors/lib.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import type { DefKind, PerNS, Res } from "../rustc_hir/def.ts";
import type { HirId, ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import type { AstOwner, PartialRes, ResolverAstLowering, TypeRelativeDelegationRes } from "../rustc_middle/middle/resolve.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { GenericParamDef } from "../rustc_middle/ty/generics.ts";
import type { Session } from "../rustc_session/session.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { DesugaringKind } from "../rustc_span/hygiene.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { ByteSymbol, Ident, Symbol } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { Result } from "../std/result.ts";
import type {
  DelegationGenerics,
  GenericArgSlot,
  GenericsGenerationResult,
  GenericsGenerationResults,
  GenericsPosition,
  GenericsResolution,
  ParentSegmentArgs,
  TyGenerics,
} from "./delegation/generics.ts";
import type { DelegationResults } from "./delegation/mod.ts";
import type { DelegationResolution, SigMapping } from "./delegation/resolution.ts";
import type { FutureKind, MoveExprInitializer, MoveExprState } from "./expr.ts";
import type { ArgumentType, Cow } from "./format.ts";
import type * as hir from "./hir_shim.ts";
import type { ResolvingRestrictionKind } from "./diagnostics.ts";
import type {
  AllowReturnTypeNotation,
  DirectConstArgContext,
  DiscardParams,
  FnDeclKind,
  GenericArgsCtor,
  GenericArgsMode,
  HirArena,
  ImplTraitContext,
  ImplTraitPosition,
  ParamMode,
  PerOwnerLoweringState,
  RelaxedBoundPolicy,
  SpanLowerer,
  TryBlockScope,
  UnrepresentableConstArgError,
} from "./lib.ts";
import type { UnstableAbi } from "./stability.ts";

/** PORT: `rustc_middle::ty::FnSig<'tcx>` (wave 15, ty-contract / codegen-tyir) is not ported yet. */
type TyFnSig = unknown;

// rustc-type: compiler/rustc_ast_lowering/src/lib.rs:281 LoweringContext
// PORT: `LoweringContext::new` (lib.rs:350, lane lower-lib-a) writes out the initial field values.
export class LoweringContext {
  constructor(
    public tcx: TyCtxt,
    public resolver: ResolverAstLowering,

    public curr_owner: PerOwnerLoweringState,

    /// Used to allocate HIR nodes.
    /** PORT: arenas are erased (`HirArena`, lib.ts): `self.arena.alloc(x)` is `x`. */
    public arena: HirArena,

    public contract_ensures: [Span, Ident, HirId] | undefined,

    public coroutine_kind: hir.CoroutineKind | undefined,

    /// When inside an `async` context, this is the `HirId` of the
    /// `task_context` local bound to the resume argument of the coroutine.
    public task_context: HirId | undefined,

    /// Used to get the current `fn`'s def span to point to when using `await`
    /// outside of an `async fn`.
    public current_item_span: Span | undefined,

    public try_block_scope: TryBlockScope,
    public loop_scope: HirId | undefined,
    public is_in_loop_condition: boolean,
    public is_in_dyn_type: boolean,

    /// The `NodeId` space is split in two.
    /// `0..resolver.next_node_id` are created by the resolver on the AST.
    /// The higher part `resolver.next_node_id..next_node_id` are created during lowering.
    // PORT: `next_node_id_` (also a method `next_node_id()`)
    public next_node_id_: NodeId,
    /// Maps the `NodeId`s created during lowering to `LocalDefId`s.
    public node_id_to_def_id: Map<NodeId, LocalDefId>,
    /// Overlay over resolver's `partial_res_map` used by delegation.
    /// This only contains `PartialRes::new(Res::Local(self_param_id))`,
    /// so we only store `self_param_id`.
    public partial_res_overrides: Map<NodeId, NodeId>,

    /// Stack of `move(...)` collection states. A closure-like body pushes
    /// `Some`, so `move(...)` expressions can record the generated locals they
    /// should lower to. Nested bodies that cannot use `move(...)` push `None`.
    public move_expr_bindings: (MoveExprState | undefined)[],

    /// Whether an initializer for a recorded `move(...)` is currently being lowered.
    public lowering_move_expr_initializer: boolean,

    public attribute_parser: AttributeParser,
  ) {}

  // lib.rs:350 (assigned in lib.ts)
  declare static new: (tcx: TyCtxt, resolver: ResolverAstLowering, owner: NodeId) => LoweringContext;
}

export interface LoweringContext {
  // ---- compiler/rustc_ast_lowering/src/lib.rs, lines 1..1756 (lane lower-lib-a) ----
  // lib.rs:350 (static: `declare static` in the class above)
  // new(tcx: TyCtxt, resolver: ResolverAstLowering, owner: NodeId): LoweringContext;
  // lib.rs:383
  dcx(): DiagCtxtHandle;
  // lib.rs:387
  allow_gen_future(): readonly Symbol[];
  // lib.rs:820
  create_def(node_id: NodeId, name: Symbol | undefined, def_kind: DefKind, span: Span): LocalDefId;
  // lib.rs:849
  next_node_id(): NodeId;
  // lib.rs:859
  opt_local_def_id(node: NodeId): LocalDefId | undefined;
  // lib.rs:866
  local_def_id(node: NodeId): LocalDefId;
  // lib.rs:881
  get_partial_res(id: NodeId): PartialRes | undefined;
  // lib.rs:889
  owner_id(node: NodeId): OwnerId;
  // lib.rs:899
  lower_node_id(ast_node_id: NodeId): HirId;
  // lib.rs:925
  next_id(): HirId;
  // lib.rs:934
  lower_res(res: Res<NodeId>): Res;
  // lib.rs:951
  expect_full_res(id: NodeId): Res<NodeId>;
  // lib.rs:955
  lower_import_res(id: NodeId, span: Span): PerNS<Res | undefined>;
  // lib.rs:981
  make_lang_item_qpath(lang_item: LangItem, span: Span, args: hir.GenericArgs | undefined): hir.QPath;
  // lib.rs:990
  make_lang_item_path(lang_item: LangItem, span: Span, args: hir.GenericArgs | undefined): hir.Path;
  // lib.rs:1015
  mark_span_with_reason(reason: DesugaringKind, span: Span, allow_internal_unstable: readonly Symbol[] | undefined): Span;
  // lib.rs:1026
  span_lowerer(): SpanLowerer;
  // lib.rs:1035
  lower_span(span: Span): Span;
  // lib.rs:1039
  lower_ident(ident: Ident): Ident;
  // lib.rs:1045
  lifetime_res_to_generic_param(ident: Ident, node_id: NodeId, kind: hir.MissingLifetimeKind, source: hir.GenericParamSource): hir.GenericParam;
  // lib.rs:1082
  lower_lifetime_binder(binder: NodeId, generic_params: readonly GenericParam[]): readonly hir.GenericParam[];
  // lib.rs:1108
  with_dyn_type_scope<T>(in_scope: boolean, f: ((this_: LoweringContext) => T)): T;
  // lib.rs:1119
  with_new_scopes<T>(scope_span: Span, f: ((this_: LoweringContext) => T)): T;
  // lib.rs:1143
  lower_attrs(id: HirId, attrs: readonly Attribute[], target_span: Span, target: Target): readonly attr_ir.Attribute[];
  // lib.rs:1153
  lower_attrs_with_extra(id: HirId, attrs: readonly Attribute[], target_span: Span, target: Target, target_item: Item | undefined, extra_hir_attributes: readonly attr_ir.Attribute[]): readonly attr_ir.Attribute[];
  // lib.rs:1187
  lower_attrs_vec(attrs: readonly Attribute[], target_span: Span, target_hir_id: HirId, target: Target, target_item: Item | undefined): attr_ir.Attribute[];
  // lib.rs:1218
  alias_attrs(id: HirId, target_id: HirId): void;
  // lib.rs:1229
  lower_assoc_item_constraint(constraint: AssocItemConstraint, itctx: ImplTraitContext): hir.AssocItemConstraint;
  // lib.rs:1359
  emit_bad_parenthesized_trait_in_assoc_ty(data: ParenthesizedArgs): ErrorGuaranteed;
  // lib.rs:1387
  lower_generic_arg(arg: GenericArg, itctx: ImplTraitContext): hir.GenericArg;
  // lib.rs:1469
  lower_ty_alloc(t: Ty, itctx: ImplTraitContext): hir.Ty;
  // lib.rs:1473
  lower_path_ty(t: Ty, qself: QSelf | undefined, path: Path, param_mode: ParamMode, itctx: ImplTraitContext): hir.Ty;
  // lib.rs:1526
  ty(span: Span, kind: hir.TyKind): hir.Ty;
  // lib.rs:1530
  ty_tup(span: Span, tys: readonly hir.Ty[]): hir.Ty;
  // lib.rs:1534
  lower_ty(t: Ty, itctx: ImplTraitContext): hir.Ty;
  // ---- compiler/rustc_ast_lowering/src/lib.rs, lines 1757..3401 (lane lower-lib-b) ----
  // lib.rs:1757
  emit_bad_gca_macro(span: Span, expr: Expr, expected: string): ErrorGuaranteed;
  // lib.rs:1773
  lower_ty_direct_lifetime(t: Ty, region: Lifetime | undefined): hir.Lifetime;
  // lib.rs:1830
  lower_opaque_impl_trait(span: Span, origin: hir.OpaqueTyOrigin<LocalDefId>, opaque_ty_node_id: NodeId, bounds: GenericBounds, itctx: ImplTraitContext): hir.TyKind;
  // lib.rs:1854
  lower_opaque_inner(opaque_ty_node_id: NodeId, origin: hir.OpaqueTyOrigin<LocalDefId>, opaque_ty_span: Span, lower_item_bounds: ((this_: LoweringContext) => readonly hir.GenericBound[])): hir.TyKind;
  // lib.rs:1878
  lower_precise_capturing_args(precise_capturing_args: readonly PreciseCapturingArg[]): readonly hir.PreciseCapturingArg[];
  // lib.rs:1902
  lower_fn_params_to_idents(decl: FnDecl): readonly (Ident | undefined)[];
  // lib.rs:1933
  lower_fn_decl(decl: FnDecl, fn_node_id: NodeId, fn_hir_id: HirId, kind: FnDeclKind, coro: CoroutineMarker | undefined, discard_params: DiscardParams): hir.FnDecl;
  // lib.rs:2064
  lower_coroutine_fn_ret_ty(output: FnRetTy, fn_def_id: LocalDefId, coro: CoroutineMarker, fn_kind: FnDeclKind): hir.FnRetTy;
  // lib.rs:2115
  lower_coroutine_fn_output_type_to_bound(output: FnRetTy, coro: CoroutineMarker, opaque_ty_span: Span, itctx: ImplTraitContext): hir.GenericBound;
  // lib.rs:2159
  lower_param_bound(tpb: GenericBound, rbp: RelaxedBoundPolicy, itctx: ImplTraitContext): hir.GenericBound;
  // lib.rs:2181
  lower_lifetime(l: Lifetime, source: hir.LifetimeSource, syntax: hir.LifetimeSyntax): hir.Lifetime;
  // lib.rs:2190
  lower_lifetime_hidden_in_path(id: NodeId, span: Span, angle_brackets: hir.AngleBrackets): hir.Lifetime;
  // lib.rs:2206
  new_named_lifetime(id: NodeId, new_id: NodeId, ident: Ident, source: hir.LifetimeSource, syntax: hir.LifetimeSyntax): hir.Lifetime;
  // lib.rs:2249
  lower_generic_params_mut(params: readonly GenericParam[], source: hir.GenericParamSource): Iterable<hir.GenericParam>;
  // lib.rs:2257
  lower_generic_params(params: readonly GenericParam[], source: hir.GenericParamSource): readonly hir.GenericParam[];
  // lib.rs:2266
  lower_generic_param(param: GenericParam, source: hir.GenericParamSource): hir.GenericParam;
  // lib.rs:2290
  lower_generic_param_kind(param: GenericParam, source: hir.GenericParamSource): [hir.ParamName, hir.GenericParamKind];
  // lib.rs:2377
  lower_trait_ref(modifiers: TraitBoundModifiers, p: TraitRef, itctx: ImplTraitContext): hir.TraitRef;
  // lib.rs:2399
  lower_poly_trait_ref(_0: PolyTraitRef, rbp: RelaxedBoundPolicy, itctx: ImplTraitContext): hir.PolyTraitRef;
  // lib.rs:2422
  validate_relaxed_bound(trait_ref: hir.TraitRef, span: Span, rbp: RelaxedBoundPolicy): void;
  // lib.rs:2509
  lower_param_bounds(bounds: readonly GenericBound[], rbp: RelaxedBoundPolicy, itctx: ImplTraitContext): hir.GenericBounds;
  // lib.rs:2518
  lower_param_bounds_mut(bounds: readonly GenericBound[], rbp: RelaxedBoundPolicy, itctx: ImplTraitContext): Iterable<hir.GenericBound>;
  // lib.rs:2528
  lower_universal_param_and_bounds(node_id: NodeId, span: Span, ident: Ident, bounds: readonly GenericBound[]): [hir.GenericParam, hir.WherePredicate | undefined, hir.TyKind];
  // lib.rs:2580
  lower_block_expr(b: Block): hir.Expr;
  // lib.rs:2585
  lower_array_length_to_const_arg(c: AnonConst): hir.ConstArg;
  // lib.rs:2609
  lower_const_path_to_const_arg(qself: QSelf | undefined, path: Path, res: Res<NodeId>, id: NodeId, span: Span): hir.ConstArg;
  // lib.rs:2657
  lower_const_item_rhs(body: Expr | undefined, span: Span): hir.ConstItemRhs;
  // lib.rs:2682
  direct_const_arg_context_enabled_by_gca_macro(): DirectConstArgContext;
  // lib.rs:2694
  ambient_direct_const_arg_context(): DirectConstArgContext;
  // lib.rs:2704
  can_lower_path_to_const_arg_direct(qself: QSelf | undefined, path: Path, span: Span, res: Res<NodeId> | undefined, context: DirectConstArgContext): Result<undefined, UnrepresentableConstArgError>;
  // lib.rs:2732
  can_lower_expr_to_const_arg_direct(expr: Expr, context: DirectConstArgContext): Result<undefined, UnrepresentableConstArgError>;
  // lib.rs:2802
  lower_path_to_const_arg_direct(id: NodeId, id_override: NodeId | undefined, qself: QSelf | undefined, path: Path, span: Span): hir.ConstArg;
  // lib.rs:2828
  lower_expr_to_const_arg_direct(expr: Expr, id_override: NodeId | undefined): hir.ConstArg;
  // lib.rs:2998
  lower_anon_const_to_const_arg_and_alloc(anon: AnonConst): hir.ConstArg;
  // lib.rs:3006
  lower_anon_const_to_const_arg(anon: AnonConst): hir.ConstArg;
  // lib.rs:3030
  lower_anon_const_to_anon_const(c: AnonConst, span: Span): hir.AnonConst;
  // lib.rs:3047
  lower_unsafe_source(u: UnsafeSource): hir.UnsafeSource;
  // lib.rs:3054
  lower_trait_bound_modifiers(modifiers: TraitBoundModifiers): hir.TraitBoundModifiers;
  // lib.rs:3073
  stmt(span: Span, kind: hir.StmtKind): hir.Stmt;
  // lib.rs:3077
  stmt_expr(span: Span, expr: hir.Expr): hir.Stmt;
  // lib.rs:3081
  stmt_let_pat(attrs: readonly attr_ir.Attribute[] | undefined, span: Span, init: hir.Expr | undefined, pat: hir.Pat, source: hir.LocalSource): hir.Stmt;
  // lib.rs:3107
  stmt_super_let_pat(span: Span, pat: hir.Pat, init: hir.Expr | undefined): hir.Stmt;
  // lib.rs:3128
  block_expr(expr: hir.Expr): hir.Block;
  // lib.rs:3132
  block_all(span: Span, stmts: readonly hir.Stmt[], expr: hir.Expr | undefined): hir.Block;
  // lib.rs:3149
  pat_cf_continue(span: Span, pat: hir.Pat): hir.Pat;
  // lib.rs:3154
  pat_cf_break(span: Span, pat: hir.Pat): hir.Pat;
  // lib.rs:3159
  pat_some(span: Span, pat: hir.Pat): hir.Pat;
  // lib.rs:3164
  pat_none(span: Span): hir.Pat;
  // lib.rs:3168
  single_pat_field(span: Span, pat: hir.Pat): readonly hir.PatField[];
  // lib.rs:3183
  pat_lang_item_variant(span: Span, lang_item: LangItem, fields: readonly hir.PatField[]): hir.Pat;
  // lib.rs:3193
  pat_ident(span: Span, ident: Ident): [hir.Pat, HirId];
  // lib.rs:3197
  pat_ident_mut(span: Span, ident: Ident): [hir.Pat, HirId];
  // lib.rs:3201
  pat_ident_binding_mode(span: Span, ident: Ident, bm: BindingMode): [hir.Pat, HirId];
  // lib.rs:3211
  pat_ident_binding_mode_mut(span: Span, ident: Ident, bm: BindingMode): [hir.Pat, HirId];
  // lib.rs:3230
  pat(span: Span, kind: hir.PatKind): hir.Pat;
  // lib.rs:3239
  pat_without_dbm(span: Span, kind: hir.PatKind): hir.Pat;
  // lib.rs:3248
  ty_path(hir_id: HirId, span: Span, qpath: hir.QPath): hir.Ty;
  // lib.rs:3282
  elided_dyn_bound(span: Span): hir.Lifetime;
  // ---- compiler/rustc_ast_lowering/src/item.rs ----
  // item.rs:47
  lower_mod(items: readonly Item[], spans: ModSpans): hir.Mod;
  // item.rs:61
  lower_item_ref(i: Item): hir.ItemId;
  // item.rs:65
  lower_eii_decl(id: NodeId, name: Ident, _0: EiiDecl): attr_ir.EiiDecl | undefined;
  // item.rs:78
  lower_eii_impl(_0: EiiImpl): attr_ir.EiiImpl;
  // item.rs:114
  generate_extra_attrs_for_item_kind(id: NodeId, i: ItemKind): attr_ir.Attribute[];
  // item.rs:157
  lower_item(i: Item): hir.Item;
  // item.rs:183
  lower_item_kind(span: Span, id: NodeId, hir_id: HirId, attrs: readonly attr_ir.Attribute[], vis_span: Span, i: ItemKind): hir.ItemKind;
  // item.rs:541
  lower_path_simple_eii(id: NodeId, path: Path): DefId | undefined;
  // item.rs:552
  lower_use_tree(tree: UseTree, id: NodeId, vis_span: Span, attrs: readonly attr_ir.Attribute[]): hir.UseTree;
  // item.rs:614
  lower_foreign_item(i: ForeignItem): hir.ForeignItem;
  // item.rs:686
  lower_foreign_item_ref(i: ForeignItem): hir.ForeignItemId;
  // item.rs:690
  lower_variant(item_kind: ItemKind, v: Variant): hir.Variant;
  // item.rs:710
  lower_variant_data(parent_id: HirId, item_kind: ItemKind, vdata: VariantData): hir.VariantData;
  // item.rs:776
  lower_field_def(_0: [number, FieldDef]): hir.FieldDef;
  // item.rs:803
  lower_trait_item(i: AssocItem): hir.TraitItem;
  // item.rs:982
  lower_trait_item_ref(i: AssocItem): hir.TraitItemId;
  // item.rs:987
  expr_err(span: Span, guar: ErrorGuaranteed): hir.Expr;
  // item.rs:991
  lower_trait_impl_header(trait_impl_header: TraitImplHeader): hir.TraitImplHeader;
  // item.rs:1027
  check_pin_drop_sugar_impl_item(i: AssocItem, ident: Ident, trait_item: Result<DefId, ErrorGuaranteed>): Ident;
  // item.rs:1057
  lower_impl_item(i: AssocItem): hir.ImplItem;
  // item.rs:1195
  lower_impl_item_ref(i: AssocItem): hir.ImplItemId;
  // item.rs:1199
  lower_defaultness(d: Defaultness, has_value: boolean, implicit: (() => hir.Defaultness)): [hir.Defaultness, Span | undefined];
  // item.rs:1214
  record_body(params: readonly hir.Param[], value: hir.Expr): hir.BodyId;
  // item.rs:1226
  lower_body(f: ((this_: LoweringContext) => [readonly hir.Param[], hir.Expr])): hir.BodyId;
  // item.rs:1239
  lower_param(param: Param): hir.Param;
  // item.rs:1250
  lower_fn_body(decl: FnDecl, contract: FnContract | undefined, body: ((this_: LoweringContext) => hir.Expr)): hir.BodyId;
  // item.rs:1269
  lower_fn_body_block(decl: FnDecl, body: Block, contract: FnContract | undefined): hir.BodyId;
  // item.rs:1278
  lower_const_body(span: Span, expr: Expr | undefined): hir.BodyId;
  // item.rs:1292
  lower_maybe_coroutine_body(fn_decl_span: Span, span: Span, fn_id: HirId, decl: FnDecl, coroutine_marker: CoroutineMarker | undefined, body: Block | undefined, attrs: readonly attr_ir.Attribute[], contract: FnContract | undefined): hir.BodyId;
  // item.rs:1357
  lower_coroutine_body_with_moved_arguments(decl: FnDecl, lower_body: ((this_: LoweringContext) => hir.Expr), fn_decl_span: Span, body_span: Span, coroutine_marker: CoroutineMarker, coroutine_source: hir.CoroutineSource): [readonly hir.Param[], hir.Expr];
  // item.rs:1554
  lower_method_sig(generics: Generics, sig: FnSig, node_id: NodeId, hir_id: HirId, kind: FnDeclKind, coroutine_marker: CoroutineMarker | undefined, attrs: readonly attr_ir.Attribute[], discard_params: DiscardParams): [hir.Generics, hir.FnSig];
  // item.rs:1573
  lower_fn_header(h: FnHeader, default_safety: hir.Safety, attrs: readonly attr_ir.Attribute[]): hir.FnHeader;
  // item.rs:1604
  lower_abi(abi_str: StrLit): ExternAbi;
  // item.rs:1636
  lower_extern(ext: Extern): ExternAbi;
  // item.rs:1644
  error_on_invalid_abi(abi: StrLit): void;
  // item.rs:1664
  lower_constness(attrs: readonly attr_ir.Attribute[], c: Const): hir.Constness;
  // item.rs:1691
  lower_safety(s: Safety, default_: hir.Safety): hir.Safety;
  // item.rs:1699
  lower_restriction_kind(restriction_kind: RestrictionKind, hir_id: HirId, resolving_kind: ResolvingRestrictionKind): hir.RestrictionKind;
  // item.rs:1745
  lower_impl_restriction(r: ImplRestriction, hir_id: HirId): hir.ImplRestriction;
  // item.rs:1754
  lower_mut_restriction(r: MutRestriction, hir_id: HirId): hir.MutRestriction;
  // item.rs:1766
  lower_generics<T>(generics: Generics, itctx: ImplTraitContext, f: ((this_: LoweringContext) => T)): [hir.Generics, T];
  // item.rs:1835
  lower_define_opaque(hir_id: HirId, define_opaque: [NodeId, Path][] | undefined): void;
  // item.rs:1864
  lower_generic_bound_predicate(ident: Ident, id: NodeId, kind: GenericParamKind, bounds: readonly GenericBound[], colon_span: Span | undefined, parent_span: Span, rbp: RelaxedBoundPolicy, itctx: ImplTraitContext, origin: hir.PredicateOrigin): hir.WherePredicate | undefined;
  // item.rs:1933
  lower_where_predicate(pred: WherePredicate, params: readonly GenericParam[], dedup_map: Map<LocalDefId, Map<DefId, Span>>): hir.WherePredicate;
  // item.rs:1994
  lower_test_binder_body(body: TestBinderBody): hir.TestBinderBody;
  // item.rs:2011
  lower_test_binder_forall(forall: TestBinderForall): hir.TestBinderForall;
  // item.rs:2032
  lower_test_binder_exists(exists: TestBinderExists): hir.TestBinderExists;
  // item.rs:2055
  lower_test_binder_constraints_as_and(constraints: readonly TestBinderConstraint[]): hir.TestBinderConstraint;
  // item.rs:2070
  lower_test_binder_constraint(constraint: TestBinderConstraint): hir.TestBinderConstraint;
  // item.rs:2109
  lower_test_binder_bound_type_constraint(bound_type: TestBinderBoundTypeConstraint): hir.TestBinderBoundTypeConstraint;
  // ---- compiler/rustc_ast_lowering/src/expr.rs ----
  // expr.rs:112
  with_move_expr_bindings<T>(state: MoveExprState | undefined, f: ((this_: LoweringContext) => T)): [T, MoveExprState | undefined];
  // expr.rs:125
  with_move_expr_initializer<T>(f: ((this_: LoweringContext) => T)): T;
  // expr.rs:133
  record_move_expr(id: NodeId, inner: Expr, move_kw_span: Span): [Ident, HirId];
  // expr.rs:149
  lower_expr_with_move_exprs(expr: hir.Expr, move_expr_state: MoveExprState, body: Expr, whole_span: Span): hir.Expr;
  // expr.rs:160
  lower_expr_with_move_exprs_in_block(expr: hir.Expr, move_expr_state: MoveExprState, body: Block, whole_span: Span): hir.Expr;
  // expr.rs:171
  lower_expr_with_move_expr_initializers(expr: hir.Expr, move_expr_state: MoveExprState, initializers: MoveExprInitializer[], whole_span: Span): hir.Expr;
  // expr.rs:211
  lower_exprs(exprs: readonly Expr[]): readonly hir.Expr[];
  // expr.rs:215
  lower_expr(e: Expr): hir.Expr;
  // expr.rs:219
  lower_expr_mut(e: Expr): hir.Expr;
  // expr.rs:556
  lower_const_block(c: AnonConst): hir.ConstBlock;
  // expr.rs:567
  lower_lit(token_lit: token.Lit, span: Span): hir.Lit;
  // expr.rs:578
  lower_unop(u: UnOp): UnOp;
  // expr.rs:586
  lower_binop(b: BinOp): BinOp;
  // expr.rs:590
  lower_assign_op(a: AssignOp): AssignOp;
  // expr.rs:594
  lower_legacy_const_generics(f: Expr, args: Expr[], legacy_args_idx: readonly number[]): hir.ExprKind;
  // expr.rs:671
  lower_expr_if(cond: Expr, then: Block, else_opt: Expr | undefined): hir.ExprKind;
  // expr.rs:706
  lower_expr_while_in_loop_scope(span: Span, cond: Expr, body: Block, opt_label: Label | undefined): hir.ExprKind;
  // expr.rs:729
  lower_expr_try_block(body: Block, opt_ty: Ty | undefined): hir.ExprKind;
  // expr.rs:782
  wrap_in_try_constructor(lang_item: LangItem, method_span: Span, expr: hir.Expr, overall_span: Span): hir.Expr;
  // expr.rs:793
  lower_arm(arm: Arm): hir.Arm;
  // expr.rs:840
  lower_capture_clause(capture_clause: CaptureBy): CaptureBy;
  // expr.rs:859
  make_desugared_coroutine_expr(capture_clause: CaptureBy, closure_node_id: NodeId, return_ty: hir.FnRetTy | undefined, fn_decl_span: Span, span: Span, desugaring_kind: hir.CoroutineDesugaring, coroutine_source: hir.CoroutineSource, body: ((this_: LoweringContext) => hir.Expr)): hir.ExprKind;
  // expr.rs:965
  maybe_forward_track_caller(outer_hir_id: HirId, inner_hir_id: HirId): void;
  // expr.rs:994
  lower_expr_await(await_kw_span: Span, expr: Expr): hir.ExprKind;
  // expr.rs:1000
  make_lowered_await(await_kw_span: Span, expr: hir.Expr, await_kind: FutureKind): hir.ExprKind;
  // expr.rs:1201
  lower_expr_use(use_kw_span: Span, expr: Expr): hir.ExprKind;
  // expr.rs:1207
  lower_expr_assign(lhs: Expr, rhs: Expr, eq_sign_span: Span, whole_span: Span): hir.ExprKind;
  // expr.rs:1264
  extract_tuple_struct_path(expr: Expr): [QSelf | undefined, Path] | undefined;
  // expr.rs:1286
  extract_unit_struct_path(expr: Expr): [QSelf | undefined, Path] | undefined;
  // expr.rs:1306
  destructure_assign(lhs: Expr, eq_sign_span: Span, assignments: hir.Stmt[]): hir.Pat;
  // expr.rs:1315
  destructure_assign_mut(lhs: Expr, eq_sign_span: Span, assignments: hir.Stmt[]): hir.Pat;
  // expr.rs:1458
  destructure_sequence(elements: readonly Expr[], ctx: string, eq_sign_span: Span, assignments: hir.Stmt[]): [readonly hir.Pat[], [number, Span] | undefined];
  // expr.rs:1484
  lower_expr_range_closed(span: Span, e1: Expr, e2: Expr): hir.ExprKind;
  // expr.rs:1492
  lower_expr_range(span: Span, e1: Expr | undefined, e2: Expr | undefined, lims: RangeLimits): hir.ExprKind;
  // expr.rs:1581
  lower_label(opt_label: Label | undefined, dest_id: NodeId, dest_hir_id: HirId): Label | undefined;
  // expr.rs:1592
  lower_loop_destination(destination: [NodeId, Label] | undefined): hir.Destination;
  // expr.rs:1613
  lower_jump_destination(id: NodeId, opt_label: Label | undefined): hir.Destination;
  // expr.rs:1624
  with_try_block_scope<T>(scope: TryBlockScope, f: ((this_: LoweringContext) => T)): T;
  // expr.rs:1635
  with_loop_scope<T>(loop_id: HirId, f: ((this_: LoweringContext) => T)): T;
  // expr.rs:1649
  with_loop_condition_scope<T>(f: ((this_: LoweringContext) => T)): T;
  // expr.rs:1660
  lower_expr_field(f: ExprField): hir.ExprField;
  // expr.rs:1672
  lower_expr_yield(span: Span, opt_expr: Expr | undefined): hir.ExprKind;
  // expr.rs:1769
  lower_expr_for(e: Expr, pat: Pat, head: Expr, body: Block, opt_label: Label | undefined, loop_kind: ForLoopKind): hir.Expr;
  // expr.rs:1945
  lower_expr_try(span: Span, sub_expr: Expr): hir.ExprKind;
  // expr.rs:2041
  lower_expr_yeet(span: Span, sub_expr: Expr | undefined): hir.ExprKind;
  // expr.rs:2084
  expr_drop_temps(span: Span, expr: hir.Expr): hir.Expr;
  // expr.rs:2092
  expr_drop_temps_mut(span: Span, expr: hir.Expr): hir.Expr;
  // expr.rs:2100
  expr_match(span: Span, arg: hir.Expr, arms: readonly hir.Arm[], source: hir.MatchSource): hir.Expr;
  // expr.rs:2110
  expr_break(span: Span): hir.Expr;
  // expr.rs:2115
  expr_break_alloc(span: Span): hir.Expr;
  // expr.rs:2120
  expr_mut_addr_of(span: Span, e: hir.Expr): hir.Expr;
  // expr.rs:2124
  expr_unit(sp: Span): hir.Expr;
  // expr.rs:2128
  expr_str(sp: Span, value: Symbol): hir.Expr;
  // expr.rs:2136
  expr_byte_str(sp: Span, value: ByteSymbol): hir.Expr;
  // expr.rs:2144
  expr_call_mut(span: Span, e: hir.Expr, args: readonly hir.Expr[]): hir.Expr;
  // expr.rs:2153
  expr_struct(span: Span, path: hir.QPath, fields: readonly hir.ExprField[]): hir.Expr;
  // expr.rs:2162
  expr_enum_variant(span: Span, path: hir.QPath, fields: readonly hir.Expr[]): hir.Expr;
  // expr.rs:2180
  expr_enum_variant_lang_item(span: Span, lang_item: LangItem, fields: readonly hir.Expr[]): hir.Expr;
  // expr.rs:2190
  expr_call(span: Span, e: hir.Expr, args: readonly hir.Expr[]): hir.Expr;
  // expr.rs:2199
  expr_call_lang_item_fn_mut(span: Span, lang_item: LangItem, args: readonly hir.Expr[]): hir.Expr;
  // expr.rs:2209
  expr_call_lang_item_fn(span: Span, lang_item: LangItem, args: readonly hir.Expr[]): hir.Expr;
  // expr.rs:2218
  expr_lang_item_path(span: Span, lang_item: LangItem): hir.Expr;
  // expr.rs:2228
  expr_lang_item_type_relative(span: Span, lang_item: LangItem, name: Symbol): hir.Expr;
  // expr.rs:2246
  expr_ident(sp: Span, ident: Ident, binding: HirId): hir.Expr;
  // expr.rs:2255
  expr_ident_mut(span: Span, ident: Ident, binding: HirId): hir.Expr;
  // expr.rs:2275
  expr_unsafe(span: Span, expr: hir.Expr): hir.Expr;
  // expr.rs:2297
  expr_block_empty(span: Span): hir.Expr;
  // expr.rs:2303
  expr_block(b: hir.Block): hir.Expr;
  // expr.rs:2310
  block_expr_block(expr: hir.Expr): hir.Expr;
  // expr.rs:2318
  expr_ref(span: Span, expr: hir.Expr): hir.Expr;
  // expr.rs:2322
  expr_bool_literal(span: Span, val: boolean): hir.Expr;
  // expr.rs:2326
  expr(span: Span, kind: hir.ExprKind): hir.Expr;
  // expr.rs:2331
  expr_field(ident: Ident, expr: hir.Expr, span: Span): hir.ExprField;
  // expr.rs:2346
  arm(pat: hir.Pat, expr: hir.Expr, span: Span): hir.Arm;
  // expr.rs:2362
  unreachable_code_attr(span: Span): Attribute;
  // ---- compiler/rustc_ast_lowering/src/expr/closure.rs ----
  // expr/closure.rs:17
  lower_expr_closure_expr(e: Expr, closure: Closure): hir.Expr;
  // expr/closure.rs:57
  lower_expr_coroutine_closure_with_move_exprs(expr_hir_id: HirId, attrs: readonly attr_ir.Attribute[], binder: ClosureBinder, capture_clause: CaptureBy, closure_id: NodeId, coroutine_marker: CoroutineMarker, constness: Const, decl: FnDecl, body: Expr, fn_decl_span: Span, fn_arg_span: Span, whole_span: Span): hir.Expr;
  // expr/closure.rs:116
  lower_expr_plain_closure_with_move_exprs(expr_hir_id: HirId, attrs: readonly attr_ir.Attribute[], binder: ClosureBinder, capture_clause: CaptureBy, closure_id: NodeId, constness: Const, movability: Movability, decl: FnDecl, body: Expr, fn_decl_span: Span, fn_arg_span: Span, whole_span: Span): hir.Expr;
  // expr/closure.rs:157
  lower_expr_closure(attrs: readonly attr_ir.Attribute[], binder: ClosureBinder, capture_clause: CaptureBy, closure_id: NodeId, closure_hir_id: HirId, constness: Const, movability: Movability, decl: FnDecl, body: Expr, fn_decl_span: Span, fn_arg_span: Span): [hir.ExprKind, MoveExprState];
  // expr/closure.rs:236
  closure_movability_for_fn(decl: FnDecl, fn_decl_span: Span, coroutine_kind: hir.CoroutineKind | undefined, movability: Movability): hir.ClosureKind;
  // expr/closure.rs:266
  lower_closure_binder(binder: ClosureBinder): [hir.ClosureBinder, readonly GenericParam[]];
  // expr/closure.rs:285
  lower_expr_coroutine_closure(binder: ClosureBinder, capture_clause: CaptureBy, closure_id: NodeId, closure_hir_id: HirId, coroutine_marker: CoroutineMarker, constness: Const, decl: FnDecl, body: Expr, fn_decl_span: Span, fn_arg_span: Span, attrs: readonly attr_ir.Attribute[]): hir.ExprKind;
  // ---- compiler/rustc_ast_lowering/src/pat.rs ----
  // pat.rs:18
  lower_pat(pattern: Pat): hir.Pat;
  // pat.rs:22
  lower_pat_mut(pattern: Pat): hir.Pat;
  // pat.rs:152
  lower_pat_tuple(pats: readonly Pat[], ctx: string): [readonly hir.Pat[], hir.DotDotPos];
  // pat.rs:209
  lower_pat_slice(pats: readonly Pat[]): hir.PatKind;
  // pat.rs:275
  lower_pat_ident(p: Pat, annotation: BindingMode, ident: Ident, hir_id: HirId, lower_sub: ((this_: LoweringContext) => hir.Pat | undefined)): hir.PatKind;
  // pat.rs:332
  pat_wild_with_node_id_of(p: Pat, hir_id: HirId): hir.Pat;
  // pat.rs:337
  pat_with_node_id_of(p: Pat, kind: hir.PatKind, hir_id: HirId): hir.Pat;
  // pat.rs:347
  ban_extra_rest_pat(sp: Span, prev_sp: Span, ctx: string): void;
  // pat.rs:352
  ban_illegal_rest_pat(sp: Span): hir.PatKind;
  // pat.rs:361
  lower_range_end(e: RangeEnd, has_end: boolean): hir.RangeEnd;
  // pat.rs:384
  lower_expr_within_pat(expr: Expr, allow_paths: boolean): hir.PatExpr;
  // pat.rs:432
  lower_ty_pat(pattern: TyPat, base_type: Span): hir.TyPat;
  // pat.rs:440
  lower_ty_pat_mut(pattern: TyPat, base_type: Span): hir.TyPat;
  // pat.rs:481
  lower_excluded_range_end(e: AnonConst): hir.ConstArg;
  // pat.rs:521
  lower_ty_pat_range_end(lang_item: LangItem, span: Span, base_type: Span): hir.ConstArg;
  // ---- compiler/rustc_ast_lowering/src/path.rs ----
  // path.rs:26
  lower_qpath(id: NodeId, qself: QSelf | undefined, p: Path, param_mode: ParamMode, allow_return_type_notation: AllowReturnTypeNotation, itctx: ImplTraitContext, modifiers: TraitBoundModifiers | undefined): hir.QPath;
  // path.rs:230
  lower_use_path(res: PerNS<Res | undefined>, p: Path, param_mode: ParamMode): hir.UsePath;
  // path.rs:253
  lower_path_segment(path_span: Span, segment: PathSegment, param_mode: ParamMode, generic_args_mode: GenericArgsMode, itctx: ImplTraitContext, bound_modifier_allowed_features: readonly Symbol[] | undefined): hir.PathSegment;
  // path.rs:422
  maybe_insert_elided_lifetimes_in_path(path_span: Span, segment_id: NodeId, segment_ident_span: Span, generic_args: GenericArgsCtor): void;
  // path.rs:471
  lower_angle_bracketed_parameter_data(data: AngleBracketedArgs, param_mode: ParamMode, itctx: ImplTraitContext): [GenericArgsCtor, boolean];
  // path.rs:506
  lower_parenthesized_parameter_data(data: ParenthesizedArgs, itctx: ImplTraitContext, bound_modifier_allowed_features: readonly Symbol[] | undefined): [GenericArgsCtor, boolean];
  // path.rs:572
  assoc_ty_binding(assoc_ty_name: Symbol, span: Span, ty: hir.Ty): hir.AssocItemConstraint;
  // path.rs:603
  map_trait_to_async_trait(def_id: DefId): DefId | undefined;
  // ---- compiler/rustc_ast_lowering/src/block.rs ----
  // block.rs:10
  lower_block(b: Block, targeted_by_break: boolean): hir.Block;
  // block.rs:19
  lower_block_noalloc(hir_id: HirId, b: Block, targeted_by_break: boolean): hir.Block;
  // block.rs:30
  lower_stmts(ast_stmts: readonly Stmt[]): [readonly hir.Stmt[], hir.Expr | undefined];
  // block.rs:83
  impl_trait_in_bindings_ctxt(position: ImplTraitPosition): ImplTraitContext;
  // block.rs:91
  lower_local(l: Local): hir.LetStmt;
  // block.rs:111
  lower_block_check_mode(b: BlockCheckMode): hir.BlockCheckMode;
  // ---- compiler/rustc_ast_lowering/src/asm.rs ----
  // asm.rs:25
  lower_inline_asm(sp: Span, asm: InlineAsm): hir.InlineAsm;
  // ---- compiler/rustc_ast_lowering/src/format.rs ----
  // format.rs:13
  lower_format_args(sp: Span, fmt: format.FormatArgs): hir.ExprKind;
  // format.rs:33
  try_inline_lit(lit: token.Lit): Symbol | undefined;
  // format.rs:57
  int_ty_max(int_ty: IntTy): bigint;
  // format.rs:69
  uint_ty_max(uint_ty: UintTy): bigint;
  // format.rs:89
  inline_literals(fmt: Cow<format.FormatArgs>): Cow<format.FormatArgs>;
  // ---- compiler/rustc_ast_lowering/src/delegation/mod.rs ----
  // delegation/mod.rs:75
  lower_delegation(delegation: Delegation): DelegationResults;
  // delegation/mod.rs:105
  lower_delegation_decl(res: DelegationResolution, generics: GenericsGenerationResults, call_expr_id: HirId, unused_target_expr: boolean): hir.FnDecl;
  // delegation/mod.rs:168
  lower_delegation_sig(sig_id: DefId, decl: hir.FnDecl, span: Span): hir.FnSig;
  // delegation/mod.rs:194
  generate_param(is_method: boolean, idx: number, span: Span): [hir.Param, NodeId];
  // delegation/mod.rs:219
  generate_arg(is_method: boolean, idx: number, param_id: HirId, span: Span): hir.Expr;
  // delegation/mod.rs:246
  lower_delegation_body(delegation: Delegation, res: DelegationResolution, generics: GenericsGenerationResults): [hir.BodyId, HirId, boolean];
  // delegation/mod.rs:321
  lower_block_maybe_more_than_once(block: Block, pat_node_id: NodeId, param_local_id: ItemLocalId, delegation_id: NodeId): hir.Block;
  // delegation/mod.rs:363
  finalize_body_lowering(delegation: Delegation, stmts: readonly hir.Stmt[], args: hir.Expr[], res: DelegationResolution, generics: GenericsGenerationResults, span: Span): [hir.Expr, HirId];
  // delegation/mod.rs:514
  process_segment(span: Span, segment: hir.PathSegment, result: GenericsGenerationResult): hir.PathSegment;
  // delegation/mod.rs:562
  generate_delegation_error(span: Span, delegation: Delegation): DelegationResults;
  // delegation/mod.rs:610
  generate_header_error(): hir.FnHeader;
  // delegation/mod.rs:620
  mk_expr(kind: hir.ExprKind, span: Span): hir.Expr;
  // ---- compiler/rustc_ast_lowering/src/delegation/generics.rs ----
  // delegation/generics.rs:626
  uplift_delegation_generic_params(span: Span, params: readonly GenericArgSlot<GenericParamDef>[], rename_self: boolean): hir.Generics;
  // delegation/generics.rs:711
  generate_lifetime_predicate(p: hir.GenericParam, span: Span): hir.WherePredicate;
  // delegation/generics.rs:741
  create_generic_arg_path(p: hir.GenericParam): hir.QPath;
  // delegation/generics.rs:757
  create_resolved_qpath(res: Res, ident: Ident, span: Span): hir.QPath;
  // ---- compiler/rustc_ast_lowering/src/delegation/attributes.rs ----
  // delegation/attributes.rs:46
  add_attrs_if_needed(resolution: DelegationResolution): void;
  // delegation/attributes.rs:64
  create_new_attrs(span: Span, sig_id: DefId, existing: readonly attr_ir.Attribute[] | undefined): attr_ir.Attribute[];
  // ---- compiler/rustc_ast_lowering/src/contract.rs ----
  // contract.rs:21
  lower_contract(body: ((this_: LoweringContext) => hir.Expr), contract: FnContract): hir.Expr;
  // contract.rs:130
  lower_decls(contract: FnContract): readonly hir.Stmt[];
  // contract.rs:143
  lower_precond(req: Expr): hir.Stmt;
  // contract.rs:158
  lower_postcond_checker(ens: Expr): hir.Expr;
  // contract.rs:176
  lower_contract_check_just_precond(contract_decls: readonly hir.Stmt[], precond: hir.Stmt): hir.Stmt;
  // contract.rs:198
  lower_contract_check_with_postcond(contract_decls: readonly hir.Stmt[], precond: hir.Stmt | undefined, postcond_checker: hir.Expr): hir.Expr;
  // contract.rs:236
  wrap_body_with_contract_check(body: ((this_: LoweringContext) => hir.Expr), contract_check: hir.Expr, postcond_span: Span): hir.Block;
  // contract.rs:282
  checked_return(opt_expr: hir.Expr | undefined): hir.ExprKind;
  // contract.rs:297
  inject_ensures_check(expr: hir.Expr, span: Span, cond_ident: Ident, cond_hir_id: HirId): hir.Expr;
}

/// Abstracts operations that are needed for delegation's resolution, so resolution
/// is independent of `LoweringContext`. Placed in a separate module so `LoweringContext`
/// can not be accessed directly.
// rustc-type: compiler/rustc_ast_lowering/src/delegation/resolution.rs:183 DelegationResolver
// PORT: a tuple struct (`DelegationResolver(&LoweringContext)`); its impls span delegation/resolution.rs
// and delegation/generics.rs (both lane lower-delegation), so it is declared here with LoweringContext.
export class DelegationResolver {
  constructor(public _0: LoweringContext) {}

  // delegation/resolution.rs:186 (assigned in delegation/resolution.ts)
  declare static new: (ctx: LoweringContext) => DelegationResolver;
  // delegation/generics.rs:542 (assigned in delegation/generics.ts)
  declare static create_slots_from_args: (tcx: TyCtxt, args: AngleBracketedArgs, params: readonly GenericParamDef[], add_first_self: boolean) => TyGenerics;
}

export interface DelegationResolver {
  // ---- compiler/rustc_ast_lowering/src/delegation/generics.rs ----
  // delegation/generics.rs:298
  resolve_generics(delegation: Delegation, sig_id: DefId): Result<GenericsResolution, ErrorGuaranteed>;
  // delegation/generics.rs:354
  get_user_args(segment: PathSegment): AngleBracketedArgs | undefined;
  // delegation/generics.rs:371
  resolve_and_generate_generics(delegation: Delegation, sig_id: DefId, span: Span): Result<GenericsGenerationResults, ErrorGuaranteed>;
  // delegation/generics.rs:494
  check_delegation_to_inherent_impl(parent_args: ParentSegmentArgs, sig_id: DefId, span: Span): Result<undefined, ErrorGuaranteed>;
  // delegation/generics.rs:542 (static: `declare static` in the class above)
  // create_slots_from_args(tcx: TyCtxt, args: AngleBracketedArgs, params: readonly GenericParamDef[], add_first_self: boolean): TyGenerics;
  // ---- compiler/rustc_ast_lowering/src/delegation/resolution.rs ----
  // delegation/resolution.rs:186 (static: `declare static` in the class above)
  // new(ctx: LoweringContext): DelegationResolver;
  // delegation/resolution.rs:191
  tcx(): TyCtxt;
  // delegation/resolution.rs:196
  owner_id(): LocalDefId;
  // delegation/resolution.rs:213
  is_definition(id: NodeId): boolean;
  // delegation/resolution.rs:219
  get_resolution_id(id: NodeId): Result<DefId, ErrorGuaranteed>;
  // delegation/resolution.rs:228
  resolve_delegation(delegation: Delegation, span: Span): Result<[DelegationResolution, GenericsGenerationResults], ErrorGuaranteed>;
  // delegation/resolution.rs:295
  get_call_path_res(delegation: Delegation, span: Span): Result<DefId, ErrorGuaranteed>;
  // delegation/resolution.rs:312
  resolve_delegation_sig(def_id: LocalDefId, span: Span): Result<DefId, ErrorGuaranteed>;
  // delegation/resolution.rs:332
  create_unresolved_error(def_id: LocalDefId, span: Span): ErrorGuaranteed;
  // delegation/resolution.rs:336
  resolve_type_relative_delegation_sig(def_id: LocalDefId, span: Span): Result<DefId, ErrorGuaranteed>;
  // delegation/resolution.rs:357
  check_for_cycles(def_id: DefId, span: Span): Result<undefined, ErrorGuaranteed>;
  // delegation/resolution.rs:385
  check_block_soundness(delegation: Delegation, sig_id: DefId, is_method: boolean, param_count: number): Result<[/* should generate block */ boolean, /* contains defs */ boolean], ErrorGuaranteed>;
  // delegation/resolution.rs:434
  create_sig_mapping(delegation: Delegation, span: Span, should_generate_block: boolean, parent: LocalDefId, sig: TyFnSig, contains_defs: boolean): Result<SigMapping, ErrorGuaranteed>;
  // delegation/resolution.rs:510
  can_perform_self_mapping(delegation: Delegation, parent: LocalDefId, span: Span): boolean;
}

/** The free fns of every file, with their final signatures. Each stub module exports them under these names
 *  (nested fns and the `ResolverAstLoweringExt` extension method are listed with the comment declarations below). */
export interface FreeFns {
  // ---- compiler/rustc_ast_lowering/src/lib.rs ----
  // lib.rs:414 (`#[extension(trait ResolverAstLoweringExt)] impl ResolverAstLowering`: a free fn, as `TyCtxt_*` in rustc_middle)
  ResolverAstLowering_legacy_const_generic_args(self: ResolverAstLowering, expr: Expr, tcx: TyCtxt): number[] | undefined;
  // lib.rs:102
  provide(providers: QueryProviders): void;
  // lib.rs:587
  index_ast(tcx: TyCtxt, _: null): readonly (Steal<[ResolverAstLowering, AstOwner]> | undefined)[];
  // lib.rs:703
  lower_to_hir(tcx: TyCtxt, def_id: LocalDefId): hir.MaybeOwner;
  // lib.rs:744 (nested fn of `lower_to_hir`: ported inside its body, not exported)
  // with_lctx(tcx: TyCtxt, resolver: ResolverAstLowering, owner: NodeId, f: ((this_: LoweringContext) => hir.OwnerNode)): hir.MaybeOwner;
  // ---- compiler/rustc_ast_lowering/src/item.rs ----
  // item.rs:30
  add_ty_alias_where_clause(generics: Generics, after_where_clause: WhereClause, prefer_first: boolean): void;
  // ---- compiler/rustc_ast_lowering/src/format.rs ----
  // format.rs:152
  flatten_format_args(fmt: Cow<format.FormatArgs>): Cow<format.FormatArgs>;
  // format.rs:233
  make_argument(ctx: LoweringContext, sp: Span, arg: hir.Expr, ty: ArgumentType): hir.Expr;
  // format.rs:266
  make_count(count: format.FormatCount, argmap: Map<[number, ArgumentType], Span | undefined>): [boolean, number];
  // format.rs:280
  expand_format_args(ctx: LoweringContext, macsp: Span, fmt: format.FormatArgs, allow_const: boolean): hir.ExprKind;
  // format.rs:539
  for_all_argument_indexes(template: format.FormatArgsPiece[], f: ((_1: MutRef<number>) => void)): void;
  // ---- compiler/rustc_ast_lowering/src/delegation/resolution.rs ----
  // delegation/resolution.rs:34
  resolve_type_relative_delegations(tcx: TyCtxt, _: null): Map<LocalDefId, TypeRelativeDelegationRes>;
  // ---- compiler/rustc_ast_lowering/src/index.rs ----
  // index.rs:30
  index_hir(tcx: TyCtxt, item: hir.OwnerNode, bodies: SortedMap<ItemLocalId, hir.Body>, num_nodes: number): [hir.ParentedNode[], Map<LocalDefId, ItemLocalId>];
  // ---- compiler/rustc_ast_lowering/src/stability.rs ----
  // stability.rs:10
  enabled_names(features: Features, span: Span): string[];
  // stability.rs:18
  extern_abi_enabled(features: Features, span: Span, abi: ExternAbi): Result<undefined, UnstableAbi>;
  // stability.rs:32
  gate_unstable_abi(sess: Session, features: Features, span: Span, abi: ExternAbi): void;
  // stability.rs:67
  extern_abi_stability(abi: ExternAbi): Result<undefined, UnstableAbi>;
}

// ==== Comment-only declarations: the other fns of the crate ====
// Methods of single-file helper types (generated classes / enum companions once codegen set
// rustc_ast_lowering runs, see the handoff), trait impls (`Visitor`, `MutVisitor`, `Display`, ...) and
// nested fns. `(X)` names the self type, `(X, static)` an associated fn without `self`.
// ---- compiler/rustc_ast_lowering/src/lib.rs ----
// lib.rs:124 (ReloweringChecker)
// assert_node_is_not_relowered(ast_node_id: NodeId, local_id: ItemLocalId): void;
// lib.rs:135 (ReloweringChecker, static)
// allow_relowering<TRes>(ctx: LoweringContext, op: ((this_: LoweringContext) => TRes)): TRes;
// lib.rs:188 (PerOwnerLoweringState, static)
// new(resolver: ResolverAstLowering, owner: NodeId): PerOwnerLoweringState;
// lib.rs:217 (PerOwnerLoweringState)
// owner_id(): OwnerId;
// lib.rs:221 (PerOwnerLoweringState, by value)
// into_owner_info(tcx: TyCtxt, node: hir.OwnerNode): hir.OwnerInfo;
// lib.rs:402 (SpanLowerer)
// lower(span: Span): Span;
// lib.rs:457 (RelaxedBoundPolicy)
// reborrow(): RelaxedBoundPolicy;
// lib.rs:535 (ImplTraitPosition, impl Display)
// fmt(f: Formatter): fmt::Result;  (impl Display: `display_ImplTraitPosition(v: ImplTraitPosition): string`)
// lib.rs:623 (Indexer)
// insert(id: NodeId, node: AstOwner): void;
// lib.rs:628 (Indexer)
// make_dummy<K>(id: NodeId, span: Span, dummy: ((_1: MacCall) => K)): Item<K>;
// lib.rs:657 (Indexer)
// replace_with_dummy<K>(item: Item<K>, dummy: ((_1: MacCall) => K), node: ((_1: Item<K>) => AstOwner)): void;
// lib.rs:670 (Indexer(MutVisitor))
// visit_attribute(_1: Attribute): void;
// lib.rs:675 (Indexer(MutVisitor))
// flat_map_item(item: Item): Item[];
// lib.rs:683 (Indexer(MutVisitor))
// visit_assoc_item(item: AssocItem, ctxt: AssocCtxt): void;
// lib.rs:695 (Indexer(MutVisitor))
// visit_foreign_item(item: ForeignItem): void;
// lib.rs:3304 (GenericArgsCtor)
// is_empty(): boolean;
// lib.rs:3310 (GenericArgsCtor, by value)
// into_generic_args(this_: LoweringContext): hir.GenericArgs;
// lib.rs:3377 (UnrepresentableConstArgError, static)
// new(expr: Expr): UnrepresentableConstArgError;
// lib.rs:3384 (UnrepresentableConstArgError, by value)
// emit(lowering_context: LoweringContext): hir.ConstArg;
// ---- compiler/rustc_ast_lowering/src/expr.rs ----
// expr.rs:62 (MoveExprInitializerFinder, static)
// collect(expr: Expr): MoveExprInitializer[];
// expr.rs:68 (MoveExprInitializerFinder, static)
// collect_block(block: Block): MoveExprInitializer[];
// expr.rs:76 (MoveExprInitializerFinder(Visitor))
// visit_expr(expr: Expr): void;
// expr.rs:87 (MoveExprInitializerFinder(Visitor))
// visit_item(_1: Item): void;
// expr.rs:93 (WillCreateDefIdsVisitor(Visitor))
// visit_anon_const(c: AnonConst): SelfResult;
// expr.rs:97 (WillCreateDefIdsVisitor(Visitor))
// visit_item(item: Item): SelfResult;
// expr.rs:101 (WillCreateDefIdsVisitor(Visitor))
// visit_expr(ex: Expr): SelfResult;
// expr.rs:1215 (nested:LoweringContext, static)
// is_ordinary(lower_ctx: LoweringContext, lhs: Expr): boolean;
// ---- compiler/rustc_ast_lowering/src/delegation/mod.rs ----
// delegation/mod.rs:633 (SelfResolver)
// try_replace_id(id: NodeId): void;
// delegation/mod.rs:645 (SelfResolver(Visitor))
// visit_id(id: NodeId): void;
// ---- compiler/rustc_ast_lowering/src/delegation/generics.rs ----
// delegation/generics.rs:44 (DelegationGenerics, static)
// generate_all(params: readonly GenericParamDef[], pos: GenericsPosition, trait_impl: boolean, has_implicit_self: boolean): DelegationGenerics;
// delegation/generics.rs:83 (GenericsGenerationResult)
// segment_id_for_sig(): HirId | undefined;
// delegation/generics.rs:108 (DelegationGenericArgsIterator)
// next(ctx: LoweringContext, hir_id_factory: ((this_: LoweringContext) => HirId)): hir.GenericArg | undefined;
// delegation/generics.rs:156 (DelegationGenericArgsIterator, by value)
// consume_all(ctx: LoweringContext): hir.GenericArg[];
// delegation/generics.rs:171 (HirOrTyGenerics)
// into_hir_generics(ctx: LoweringContext, span: Span): void;
// delegation/generics.rs:185 (HirOrTyGenerics)
// hir_generics_or_empty(): hir.Generics;
// delegation/generics.rs:192 (HirOrTyGenerics)
// create_args_iterator(): DelegationGenericArgsIterator;
// delegation/generics.rs:205 (HirOrTyGenerics)
// infer_indices(): Set<number>;
// delegation/generics.rs:219 (HirOrTyGenerics)
// is_trait_impl(): boolean;
// delegation/generics.rs:226 (HirOrTyGenerics)
// find_self_param(): hir.GenericParam;
// delegation/generics.rs:240 (HirOrTyGenerics)
// pos(): GenericsPosition;
// delegation/generics.rs:249 (GenericsGenerationResult, static)
// new(generics: DelegationGenerics<TyGenerics>): GenericsGenerationResult;
// delegation/generics.rs:593 (GenericsGenerationResults)
// all_params(): Iterable<hir.GenericParam>;
// delegation/generics.rs:614 (GenericsGenerationResults)
// all_predicates(): Iterable<hir.WherePredicate>;
// ---- compiler/rustc_ast_lowering/src/delegation/resolution.rs ----
// delegation/resolution.rs:413 (DefinitionsFinder(Visitor))
// visit_id(id: NodeId): SelfResult;
// delegation/resolution.rs:456 (SelfFinder(TypeVisitor))
// visit_ty(t: Ty): SelfResult;
// delegation/resolution.rs:482 (SelfFinder, static)
// contains_self(t: Ty): boolean;
// ---- compiler/rustc_ast_lowering/src/index.rs ----
// index.rs:73 (NodeCollector)
// insert(span: Span, hir_id: HirId, node: hir.Node): void;
// index.rs:110 (NodeCollector)
// with_parent(parent_node_id: HirId, f: F): void;
// index.rs:118 (NodeCollector)
// insert_nested(item: LocalDefId): void;
// index.rs:130 (NodeCollector(Visitor))
// visit_nested_item(item: hir.ItemId): void;
// index.rs:135 (NodeCollector(Visitor))
// visit_nested_trait_item(item_id: hir.TraitItemId): void;
// index.rs:139 (NodeCollector(Visitor))
// visit_nested_impl_item(item_id: hir.ImplItemId): void;
// index.rs:143 (NodeCollector(Visitor))
// visit_nested_foreign_item(foreign_id: hir.ForeignItemId): void;
// index.rs:147 (NodeCollector(Visitor))
// visit_nested_body(id: hir.BodyId): void;
// index.rs:153 (NodeCollector(Visitor))
// visit_use(tree: hir.UseTree, hir_id: HirId, _def_id: LocalDefId): void;
// index.rs:160 (NodeCollector(Visitor))
// visit_param(param: hir.Param): void;
// index.rs:169 (NodeCollector(Visitor))
// visit_item(i: hir.Item): void;
// index.rs:183 (NodeCollector(Visitor))
// visit_foreign_item(fi: hir.ForeignItem): void;
// index.rs:190 (NodeCollector(Visitor))
// visit_generic_param(param: hir.GenericParam): void;
// index.rs:195 (NodeCollector(Visitor))
// visit_const_param_default(param: HirId, ct: hir.ConstArg): void;
// index.rs:202 (NodeCollector(Visitor))
// visit_trait_item(ti: hir.TraitItem): void;
// index.rs:210 (NodeCollector(Visitor))
// visit_impl_item(ii: hir.ImplItem): void;
// index.rs:217 (NodeCollector(Visitor))
// visit_pat(pat: hir.Pat): void;
// index.rs:225 (NodeCollector(Visitor))
// visit_pat_expr(expr: hir.PatExpr): void;
// index.rs:233 (NodeCollector(Visitor))
// visit_pat_field(field: hir.PatField): void;
// index.rs:240 (NodeCollector(Visitor))
// visit_arm(arm: hir.Arm): void;
// index.rs:250 (NodeCollector(Visitor))
// visit_opaque_ty(opaq: hir.OpaqueTy): void;
// index.rs:258 (NodeCollector(Visitor))
// visit_anon_const(constant: hir.AnonConst): void;
// index.rs:266 (NodeCollector(Visitor))
// visit_inline_const(constant: hir.ConstBlock): void;
// index.rs:274 (NodeCollector(Visitor))
// visit_expr(expr: hir.Expr): void;
// index.rs:282 (NodeCollector(Visitor))
// visit_expr_field(field: hir.ExprField): void;
// index.rs:289 (NodeCollector(Visitor))
// visit_const_arg_expr_field(field: hir.ConstArgExprField): void;
// index.rs:296 (NodeCollector(Visitor))
// visit_stmt(stmt: hir.Stmt): void;
// index.rs:304 (NodeCollector(Visitor))
// visit_path_segment(path_segment: hir.PathSegment): void;
// index.rs:310 (NodeCollector(Visitor))
// visit_ty(ty: hir.Ty<hir.AmbigArg>): void;
// index.rs:318 (NodeCollector(Visitor))
// visit_const_arg(const_arg: hir.ConstArg<hir.AmbigArg>): void;
// index.rs:330 (NodeCollector(Visitor))
// visit_infer(inf_id: HirId, inf_span: Span, kind: intravisit.InferKind): SelfResult;
// index.rs:345 (NodeCollector(Visitor))
// visit_trait_ref(tr: hir.TraitRef): void;
// index.rs:353 (NodeCollector(Visitor))
// visit_block(block: hir.Block): void;
// index.rs:360 (NodeCollector(Visitor))
// visit_local(l: hir.LetStmt): void;
// index.rs:367 (NodeCollector(Visitor))
// visit_lifetime(lifetime: hir.Lifetime): void;
// index.rs:371 (NodeCollector(Visitor))
// visit_variant(v: hir.Variant): void;
// index.rs:382 (NodeCollector(Visitor))
// visit_field_def(field: hir.FieldDef): void;
// index.rs:389 (NodeCollector(Visitor))
// visit_assoc_item_constraint(constraint: hir.AssocItemConstraint): void;
// index.rs:396 (NodeCollector(Visitor))
// visit_trait_item_ref(id: hir.TraitItemId): void;
// index.rs:400 (NodeCollector(Visitor))
// visit_impl_item_ref(id: hir.ImplItemId): void;
// index.rs:404 (NodeCollector(Visitor))
// visit_foreign_item_ref(id: hir.ForeignItemId): void;
// index.rs:408 (NodeCollector(Visitor))
// visit_where_predicate(predicate: hir.WherePredicate): void;
// index.rs:415 (NodeCollector(Visitor))
// visit_pattern_type_pattern(pat: hir.TyPat): void;
// index.rs:423 (NodeCollector(Visitor))
// visit_precise_capturing_arg(arg: hir.PreciseCapturingArg): SelfResult;
// index.rs:440 (NodeCollector(Visitor))
// visit_test_binder_forall(forall: hir.TestBinderForall): void;
// index.rs:445 (NodeCollector(Visitor))
// visit_test_binder_exists(exists: hir.TestBinderExists): void;
// index.rs:450 (NodeCollector(Visitor))
// visit_test_binder_bound_type_constraint(bound_type: hir.TestBinderBoundTypeConstraint): void;
// ---- compiler/rustc_ast_lowering/src/stability.rs ----
// stability.rs:54 (UnstableAbi, impl Display)
// fmt(f: Formatter): fmt::Result;  (impl Display: `display_UnstableAbi(v: UnstableAbi): string`)
// ---- compiler/rustc_ast_lowering/src/diagnostics.rs ----
// diagnostics.rs:600 (ResolvingRestrictionKind(IntoDiagArg), by value)
// into_diag_arg(_1: PathBuf | undefined): DiagArgValue;
