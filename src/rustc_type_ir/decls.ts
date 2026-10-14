// Contract for rustc_type_ir (lane ty-contract, docs/plan-m3.md D2-D4). Root owns this file after integration:
// do not edit it from a porting lane; write a missing or wrong declaration into your handoff, and if you cannot
// type-check without it, add a local `declare module "<path>/decls.ts"` in your own file marked
// `// PORT(decls): pending root`.
//
// Two parts:
// 1. **Pending types.** Every rustc_type_ir type that the ty skeleton (rustc_middle ty/{mod,list,generic_args,
//    predicate,context}.ts, sty/*.ts, fold.ts, visit.ts, interner.ts) and the method declarations below
//    mention but that is not ported yet. Each is an alias of `Pending<"Name">` (an opaque type nothing can be
//    built from) or, for the enums the interners must construct (`TyKind`, `RegionKind`, `ConstKind`,
//    `PredicateKind`, `ValTreeKind`, ...), `PendingEnum<"Name">` (any `{ $: variant, ...fields }` object, the
//    PORTING §5 enum shape). Newtype indices and bitflags are already their final branded-number shape. When a
//    type lands (lane codegen-tyir generates most of them into `<file>.gen.ts`), root replaces its alias here
//    with a re-export of the real type (`export type { TyKind } from "./ty_kind.ts";`), so that importers keep
//    importing from decls.ts and nothing else changes.
// 2. **Method declarations** of the hash-consed classes defined in this crate (`Region`, sty/mod.rs; `Const`,
//    sty/consts.rs), grouped by upstream file and in upstream order. Every fn of every `impl` block of these
//    types in rustc_type_ir is listed: a declaration (`// <file>:<line>` above it) or a comment line saying where
//    a trait impl that is not a method went (descriptor, `debug_<T>` fn, ...). Statics are in a `namespace`
//    augmentation (`Region.new_var = function ..`), except `new`, which is a `static` in the class body. The
//    stub file of each upstream file installs `unported(..)` placeholders for its names (rust_ts/stubs.ts
//    `unported_methods`); see docs/handoff/ty-contract.md "How to fill a stub".
// The rustc_middle side (Ty, RawList/GenericArgs, Predicate, Clause, Const/Region methods from rustc_middle,
// TyCtxt) is rustc_middle/ty/decls.ts.
import type { Clause, Clauses, GenericArg, GenericArgs, List, Predicate, Ty } from "../rustc_middle/ty/decls.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { EarlyParamRegion, Expr, LateParamRegionKind, ParamConst } from "../rustc_middle/ty/decls.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { Const, Region } from "./sty/mod.ts";

/** A type not ported yet: opaque, nothing can be built from it (header). */
export type Pending<N extends string> = { readonly __pending: N };
/** An enum not generated yet: any PORTING §5 enum value `{ $: variant, ..fields }` (header). */
export type PendingEnum<N extends string> = { readonly $: string; readonly __pending_enum?: N; readonly [field: string]: unknown };
/** A generic type not ported yet; `T` is phantom. */
export type Pending1<N extends string, T> = { readonly __pending: N; readonly __T?: T };

// ---- newtype indices (`rustc_index::newtype_index!`) and bitflags: final shapes (branded numbers) ----
// rustc_type_ir lib.rs:171
export type DebruijnIndex = number & { readonly __brand: "DebruijnIndex" };
// lib.rs:381
export type UniverseIndex = number & { readonly __brand: "UniverseIndex" };
// lib.rs:436
export type BoundVar = number & { readonly __brand: "BoundVar" };
// region_kind.rs:20
export type RegionVid = number & { readonly __brand: "RegionVid" };
// ty_kind.rs:731, :740, :749
export type TyVid = number & { readonly __brand: "TyVid" };
export type IntVid = number & { readonly __brand: "IntVid" };
export type FloatVid = number & { readonly __brand: "FloatVid" };
// const_kind.rs:171
export type ConstVid = number & { readonly __brand: "ConstVid" };
// flags.rs:11 (`bitflags! { pub struct TypeFlags: u32 }`)
export type TypeFlags = number & { readonly __brand: "TypeFlags" };

// ---- enums the interners construct ----
// ty_kind.rs:157
export type TyKind = PendingEnum<"TyKind">;
// region_kind.rs:138
export type RegionKind = PendingEnum<"RegionKind">;
// const_kind.rs:21
export type ConstKind = PendingEnum<"ConstKind">;
// predicate_kind.rs:66, :18
export type PredicateKind = PendingEnum<"PredicateKind">;
export type ClauseKind = PendingEnum<"ClauseKind">;
// const_kind.rs:223
export type ValTreeKind = PendingEnum<"ValTreeKind">;
// binder.rs:965, :1004, :1066, :1077
export type BoundVarIndexKind = PendingEnum<"BoundVarIndexKind">;
export type BoundRegionKind = PendingEnum<"BoundRegionKind">;
export type BoundTyKind = PendingEnum<"BoundTyKind">;
export type BoundVariableKind = PendingEnum<"BoundVariableKind">;
// ty_kind.rs:759, const_kind.rs:177
export type InferTy = PendingEnum<"InferTy">;
export type InferConst = PendingEnum<"InferConst">;
// generic_arg.rs:14 (`Lifetime(Region) | Type(Ty) | Const(Const)`; built by `GenericArg.kind`, generic_args.ts)
export type GenericArgKind =
  | { readonly $: "Lifetime"; readonly _0: Region }
  | { readonly $: "Type"; readonly _0: Ty }
  | { readonly $: "Const"; readonly _0: Const };
// term_kind.rs:19 (`Ty(Ty) | Const(Const)`; built by `Term.kind`, rustc_middle ty/mod.ts)
export type TermKind = { readonly $: "Ty"; readonly _0: Ty } | { readonly $: "Const"; readonly _0: Const };
// pattern.rs:16
export type PatternKind = PendingEnum<"PatternKind">;
// canonical.rs:96
export type CanonicalVarKind = PendingEnum<"CanonicalVarKind">;
// predicate.rs:331
export type ExistentialPredicate = PendingEnum<"ExistentialPredicate">;
// term_kind.rs:32, ty_kind.rs:34, const_kind.rs:106
export type AliasTermKind = PendingEnum<"AliasTermKind">;
export type AliasTyKind = PendingEnum<"AliasTyKind">;
export type AliasConstKind = PendingEnum<"AliasConstKind">;
// const_kind.rs:279
export type AnonConstKind = PendingEnum<"AnonConstKind">;
// lib.rs:262 (fieldless), lib.rs:447 (fieldless), predicate.rs:266 (fieldless), ty_kind.rs:135
export type Variance = Pending<"Variance">;
export type ClosureKind = Pending<"ClosureKind">;
export type ImplPolarity = Pending<"ImplPolarity">;
export type IsRigid = Pending<"IsRigid">;

// ---- structs ----
// binder.rs:31 (D3: a plain object, not interned)
export type Binder<T> = { readonly value: T; readonly bound_vars: List<BoundVariableKind> };
// binder.rs:325
export type EarlyBinder<T> = Pending1<"EarlyBinder", T>;
// binder.rs:1112, :1174, :1230
export type BoundRegion = { readonly var: BoundVar; readonly kind: BoundRegionKind };
export type BoundTy = { readonly var: BoundVar; readonly kind: BoundTyKind };
export type BoundConst = Pending<"BoundConst">;
// binder.rs:979 (`Placeholder<I, T>`), :1143, :1199, :1250
export type PlaceholderRegion = Pending<"PlaceholderRegion">;
export type PlaceholderType = Pending<"PlaceholderType">;
export type PlaceholderConst = Pending<"PlaceholderConst">;
// ty/alias.rs:21 (`Alias<I, K>`), :53, :58
export type AliasTy = Pending<"AliasTy">;
export type AliasConst = Pending<"AliasConst">;
// ty_kind.rs:1131, :930, :1414
export type FnSig = Pending<"FnSig">;
export type FnSigKind = Pending<"FnSigKind">;
export type CoroutineWitnessTypes = Pending<"CoroutineWitnessTypes">;
// ty_kind/closure.rs
export type ClosureArgs = Pending<"ClosureArgs">;
export type CoroutineArgs = Pending<"CoroutineArgs">;
export type CoroutineClosureArgs = Pending<"CoroutineClosureArgs">;
export type ClosureArgsParts = Pending<"ClosureArgsParts">;
export type CoroutineArgsParts = Pending<"CoroutineArgsParts">;
export type CoroutineClosureArgsParts = Pending<"CoroutineClosureArgsParts">;
// predicate.rs:113, :196, :389, :455, :567, :630, :667
export type TraitRef = Pending<"TraitRef">;
export type TraitClause = Pending<"TraitClause">;
export type ExistentialTraitRef = Pending<"ExistentialTraitRef">;
export type ExistentialProjection = Pending<"ExistentialProjection">;
export type ProjectionClause = Pending<"ProjectionClause">;
export type NormalizesTo = Pending<"NormalizesTo">;
export type HostEffectClause = Pending<"HostEffectClause">;
// predicate.rs:24 (`OutlivesClause<I, A>(pub A, pub Region<I>)`), rustc_middle predicate.rs:28 and ff.
export type OutlivesClause<A> = Pending1<"OutlivesClause", A>;
export type TypeOutlivesClause = OutlivesClause<Ty>;
export type RegionOutlivesClause = OutlivesClause<Region>;
export type ArgOutlivesClause = OutlivesClause<GenericArg>;
// opaque_ty.rs:15
export type OpaqueTypeKey = Pending<"OpaqueTypeKey">;
// unnormalized.rs
export type Unnormalized<T> = Pending1<"Unnormalized", T>;
// relate.rs (`RelateResult<I, T> = Result<T, TypeError<I>>`)
export type RelateResult<T> = Pending1<"RelateResult", T>;
// walk.rs
export type TypeWalker = Pending<"TypeWalker">;
// canonical.rs:271
export type CanonicalParamEnvCache = Pending<"CanonicalParamEnvCache">;
// solve/mod.rs
export type CanonicalInputData = Pending<"CanonicalInputData">;
export type ExternalConstraintsData = Pending<"ExternalConstraintsData">;
export type QueryResult = Pending<"QueryResult">;
export type Probe = Pending<"inspect::Probe">;
// search_graph
export type GlobalCache = Pending<"GlobalCache">;
export type RequiredDepth = Pending<"RequiredDepth">;
// lang_items.rs
export type SolverAdtLangItem = Pending<"SolverAdtLangItem">;
export type SolverProjectionLangItem = Pending<"SolverProjectionLangItem">;
export type SolverTraitLangItem = Pending<"SolverTraitLangItem">;

// ---- `type Poly* = Binder<*>` (rustc_middle aliases of rustc_type_ir structs) ----
export type PolyFnSig = Binder<FnSig>;
export type PolyTraitRef = Binder<TraitRef>;
export type PolyTraitClause = Binder<TraitClause>;
export type PolyProjectionClause = Binder<ProjectionClause>;
export type PolyRegionOutlivesClause = Binder<RegionOutlivesClause>;
export type PolyTypeOutlivesClause = Binder<TypeOutlivesClause>;
export type PolyExistentialPredicate = Binder<ExistentialPredicate>;
export type PolyExistentialTraitRef = Binder<ExistentialTraitRef>;
export type PolyExistentialProjection = Binder<ExistentialProjection>;

// ---- runtime constants the skeleton needs before codegen-tyir lands ----
/** `DebruijnIndex::INNERMOST` (lib.rs:172, `const INNERMOST = 0;` inside `newtype_index!`). */
export const INNERMOST: DebruijnIndex = 0 as DebruijnIndex;
/** `TypeFlags::empty()` (bitflags: no bit set). */
export const TypeFlags_empty: TypeFlags = 0 as TypeFlags;

// ---- method declarations ----
declare module "./sty/mod.ts" {
  interface Region {
    // ---- sty/mod.rs ----
    // sty/mod.rs:35
    get_name(interner: TyCtxt): Symbol | undefined;
    // sty/mod.rs:46
    get_name_or_anon(interner: TyCtxt): Symbol;
    // sty/mod.rs:55
    opt_param_def_id(interner: TyCtxt, binding_item: DefId): DefId | undefined;
    // sty/mod.rs:66
    is_named(interner: TyCtxt): boolean;
    // sty/mod.rs:140
    is_bound(): boolean;
    // sty/mod.rs:145
    is_error(): boolean;
    // sty/mod.rs:150
    is_static(): boolean;
    // sty/mod.rs:155
    is_erased(): boolean;
    // sty/mod.rs:160
    is_placeholder(): boolean;
    // sty/mod.rs:165
    is_param(): boolean;
    // sty/mod.rs:172
    is_free(): boolean;
    // sty/mod.rs:185
    is_var(): boolean;
    // sty/mod.rs:189
    as_var(): RegionVid;
    // sty/mod.rs:199
    type_flags(): TypeFlags;
    // sty/mod.rs:246 kind (ported in the class)
    // sty/mod.rs:251
    bound_at_or_above_binder(index: DebruijnIndex): boolean;
    // sty/mod.rs:260
    flags(): TypeFlags;
    // sty/mod.rs:264
    outer_exclusive_binder(): DebruijnIndex;
    // sty/mod.rs:275 kind (impl IntoKind: the same method)
    // sty/mod.rs:291 fmt (impl Debug: debug_<T> fn)
    // sty/mod.rs:297 visit_with (impl TypeVisitable: D4 descriptor visit_<T>)
    // sty/mod.rs:303 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // sty/mod.rs:307 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
  }
  namespace Region {
    // ---- sty/mod.rs ----
    // sty/mod.rs:31
    function new_var(interner: TyCtxt, v: RegionVid): Region;
    // sty/mod.rs:82
    function new_error_misc(interner: TyCtxt): Region;
    // sty/mod.rs:93
    function new_error_with_message(interner: TyCtxt, span: Span, msg: string): Region;
    // sty/mod.rs:99
    function new_late_param(interner: TyCtxt, scope: DefId, kind: LateParamRegionKind): Region;
    // sty/mod.rs:104
    function new_early_param(interner: TyCtxt, early_bound_region: EarlyParamRegion): Region;
    // sty/mod.rs:110
    function new_error(interner: TyCtxt, guar: ErrorGuaranteed): Region;
    // sty/mod.rs:115
    function new_bound(interner: TyCtxt, debruijn: DebruijnIndex, bound_region: BoundRegion): Region;
    // sty/mod.rs:120
    function new_anon_bound(interner: TyCtxt, debruijn: DebruijnIndex, var_: BoundVar): Region;
    // sty/mod.rs:125
    function new_canonical_bound(interner: TyCtxt, var_: BoundVar): Region;
    // sty/mod.rs:130
    function new_placeholder(interner: TyCtxt, placeholder: PlaceholderRegion): Region;
    // sty/mod.rs:135
    function new_static(interner: TyCtxt): Region;
    // sty/mod.rs:281 relate (impl Relate: relate_<T> fn)
  }
}

declare module "./sty/consts.ts" {
  interface Const {
    // ---- sty/consts.rs ----
    // sty/consts.rs:25 fmt (impl Debug: debug_<T> fn)
    // sty/consts.rs:38 kind (ported in the class)
    // sty/consts.rs:93
    is_ct_var(): boolean;
    // sty/consts.rs:98
    is_ct_error(): boolean;
    // sty/consts.rs:127
    is_trivially_wf(): boolean;
    // sty/consts.rs:138
    is_ct_infer(): boolean;
    // sty/consts.rs:142
    ct_vid(): ConstVid | undefined;
    // sty/consts.rs:151 flags (ported in the class)
    // sty/consts.rs:155 outer_exclusive_binder (ported in the class)
    // sty/consts.rs:163 kind (impl IntoKind: the same method)
    // sty/consts.rs:169 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // sty/consts.rs:173 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // sty/consts.rs:179 visit_with (impl TypeVisitable: D4 descriptor visit_<T>)
    // sty/consts.rs:185 try_super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // sty/consts.rs:205 super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // sty/consts.rs:224 super_visit_with (impl TypeSuperVisitable: D4 descriptor visit_<T> (super_*))
  }
  namespace Const {
    // ---- sty/consts.rs ----
    // sty/consts.rs:43 new (a `static` in the class body: `new` is reserved here)
    // sty/consts.rs:48
    function new_var(interner: TyCtxt, infer: ConstVid): Const;
    // sty/consts.rs:53
    function new_infer(interner: TyCtxt, infer: InferConst): Const;
    // sty/consts.rs:58
    function new_bound(interner: TyCtxt, debruijn: DebruijnIndex, bound_const: BoundConst): Const;
    // sty/consts.rs:63
    function new_anon_bound(interner: TyCtxt, debruijn: DebruijnIndex, var_: BoundVar): Const;
    // sty/consts.rs:68
    function new_canonical_bound(interner: TyCtxt, var_: BoundVar): Const;
    // sty/consts.rs:73
    function new_placeholder(interner: TyCtxt, placeholder: PlaceholderConst): Const;
    // sty/consts.rs:78
    function new_alias(interner: TyCtxt, is_rigid: IsRigid, alias_const: AliasConst): Const;
    // sty/consts.rs:83
    function new_expr(interner: TyCtxt, expr: Expr): Const;
    // sty/consts.rs:88
    function new_error(interner: TyCtxt, e: ErrorGuaranteed): Const;
    // sty/consts.rs:103
    function new_param(interner: TyCtxt, param: ParamConst): Const;
    // sty/consts.rs:108
    function new_fresh(interner: TyCtxt, fresh: number): Const;
    // sty/consts.rs:113
    function new_misc_error(interner: TyCtxt): Const;
    // sty/consts.rs:122
    function new_error_with_message(interner: TyCtxt, span: Span, msg: string): Const;
    // sty/consts.rs:240 relate (impl Relate: relate_<T> fn)
  }
}
