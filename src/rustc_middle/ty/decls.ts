// Contract for rustc_middle::ty (lane ty-contract, docs/plan-m3.md D2-D5). Root owns this file after
// integration: do not edit it from a porting lane; write a missing or wrong declaration into your handoff, and
// if you cannot type-check without it, add a local `declare module "<path>/decls.ts"` in your own file marked
// `// PORT(decls): pending root`.
//
// Three parts (see also rustc_type_ir/decls.ts, which holds the pending rustc_type_ir types):
// 1. **Re-exports of the skeleton types** (`Ty`, `List`, `GenericArg`, ...) so a lane can import every type
//    name it needs from one place.
// 2. **Pending types** of rustc_middle (and of crates not ported yet) that the declarations mention:
//    `Pending<"Name">` aliases, replaced by root with a re-export of the real type when it lands.
// 3. **Method declarations** of the classes whose methods are spread over many upstream files: `Ty`
//    (ty/mod.ts), `RawList` (ty/list.ts; it also carries the `GenericArgs` and `List<PolyExistentialPredicate>`
//    methods, typed with `this:`), `Predicate` / `Clause` (ty/predicate.ts), rustc_middle's methods on
//    rustc_type_ir's `Const` / `Region`, and `TyCtxt`'s methods from every ty/ file except context.rs (its own
//    class body) and mod.rs (tyctxt-min decision 6: delegating methods in the class body, `TyCtxt_<name>` stubs
//    in mod.ts), including `impl Interner for TyCtxt` (ty/context/impl_interner.rs).
//    Every fn of every `impl` block of these types in rustc_middle/src/ty is listed, in upstream order grouped by
//    file: a declaration with `// <file>:<line>` above it, or a comment line saying where a trait impl that is not
//    a method went (D4 descriptor, `debug_<T>`, `decode_<T>`, M4/M5, ...) or which existing method serves it.
//    Statics are `namespace` augmentations (`Ty.new_bool = function ..`); a static named `new` is a `static`
//    in the class body. Generic fns over `T: TypeFoldable` take the D4 descriptor `d_T` last.
//    `Interner` methods whose name TyCtxt already uses for an incompatible inherent method or query are
//    `ir_<name>` (interner.ts header); an `inherent::Ty` method incompatible with the inherent one of the same
//    name likewise (`Ty.ir_new_param`).
// The stub file of each upstream file installs `unported(..)` placeholders for its declared names
// (rust_ts/stubs.ts `unported_methods`); docs/handoff/ty-contract.md "How to fill a stub".
import type { Size, TargetDataLayout } from "../../rustc_abi/lib.ts";
import type { FloatTy, IntTy, Movability, Mutability, Pinnedness, UintTy } from "../../rustc_ast_ir/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { DiagArgValue, MultiSpan } from "../../rustc_error_messages/lib.ts";
import type { Features } from "../../rustc_feature/unstable.ts";
import type { Hash128 } from "../../rustc_hashes/lib.ts";
import type { DefKind, Namespace, Res } from "../../rustc_hir/def.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { CrateNum, DefId, LocalDefId, LocalModId, ModId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import type { Ident, Symbol } from "../../rustc_span/symbol.ts";
import type { Target, X86Abi } from "../../rustc_target/spec/mod.ts";
import type {
  AliasConst,
  AliasConstKind,
  AliasTermKind,
  AliasTy,
  ArgOutlivesClause,
  Binder,
  BoundConst,
  BoundRegion,
  BoundRegionKind,
  BoundTy,
  BoundVar,
  BoundVariableKind,
  CanonicalInputData,
  CanonicalParamEnvCache,
  CanonicalVarKind,
  ClauseKind,
  ClosureArgs,
  ClosureArgsParts,
  CoroutineArgsParts,
  CoroutineClosureArgsParts,
  ClosureKind,
  ConstKind,
  CoroutineArgs,
  CoroutineClosureArgs,
  CoroutineWitnessTypes,
  DebruijnIndex,
  EarlyBinder,
  ExistentialProjection,
  ExistentialTraitRef,
  ExternalConstraintsData,
  FloatVid,
  FnSig,
  GenericArgKind,
  GlobalCache,
  ImplPolarity,
  InferTy,
  IntVid,
  IsRigid,
  OpaqueTypeKey,
  Pending,
  Pending1,
  PlaceholderType,
  PolyExistentialPredicate,
  PolyFnSig,
  PolyProjectionClause,
  PolyTraitClause,
  PolyTraitRef,
  PredicateKind,
  Probe,
  ProjectionClause,
  QueryResult,
  RegionOutlivesClause,
  RegionVid,
  RelateResult,
  RequiredDepth,
  SolverAdtLangItem,
  SolverProjectionLangItem,
  SolverTraitLangItem,
  TermKind,
  TraitClause,
  TraitRef,
  TyKind,
  TypeFlags,
  TypeOutlivesClause,
  TypeWalker,
  TyVid,
  Unnormalized,
  ValTreeKind,
  Variance,
} from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { CollectAndApply_Result } from "../../rustc_type_ir/interner.ts";
import type { Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import type { TypeVisitable } from "../../rustc_type_ir/visit.ts";
import type { VisitorResult } from "../../rustc_ast_ir/visit.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import type { Result } from "../../std/result.ts";
import type { DepNodeIndex } from "../dep_graph/graph.ts";
import type { IntoQueryKey } from "../query/into_query_key.ts";
import type { TyCtxt } from "./context.ts";
import type { GenericArg, GenericArgs } from "./generic_args.ts";
import type { Generics, GenericParamDef } from "./generics.ts";
import type { Clauses, List, RawList } from "./list.ts";
import type { Term, Ty } from "./mod.ts";
import type { Clause, Predicate } from "./predicate.ts";

// ---- 1. the skeleton types ----
export type { Clauses, Const, GenericArg, GenericArgs, List, Predicate, Clause, RawList, Region, Term, Ty };
export type { ListWithCachedTypeInfo } from "./list.ts";

// generated by set rustc_ty of tools/codegen/types.ts (lane codegen-tyir; re-exported by merge-w13)
import type { CanonicalPolyFnSig, InlineConstArgs, ParamConst, ParamTy } from "./sty.ts";
import type { EarlyParamRegion, LateParamRegionKind } from "./region.ts";
import type { Expr } from "./consts/kind.ts";
import type { AssocItem } from "./assoc.ts";
export type { AssocItem, CanonicalPolyFnSig, EarlyParamRegion, Expr, InlineConstArgs, LateParamRegionKind, ParamConst, ParamTy };

// re-exported by merge-w15b: ty/mod.rs types (lanes ty-mod-a, ty-mod-b), ty/util.rs types (ty-util), ty/adt.rs / ty/closure.rs
// types (ty-adt-assoc), ty/consts/{valtree,int}.rs / ty/typeck_results.rs types (ty-results), rustc_data_structures' `SortedIndexMultiMap` and
// `hir::Attribute` (rustc_attr_ir)
import type { AsyncDestructor, Destructor, ImplOverlapKind, ImplTraitInTraitData, ParamEnv, PseudoCanonicalInput, TypingEnv, VariantDef } from "./mod.ts";
import type { Attribute } from "../../rustc_attr_ir/lib.ts";
import type { CheckRegions, Discr, NotUniqueParam } from "./util.ts";
import type { AdtDef, AdtDefData } from "./adt.ts";
import type { CapturedPlace } from "./closure.ts";
import type { SortedIndexMultiMap } from "../../rustc_data_structures/sorted_map/index_map.ts";
export type { AdtDef, AdtDefData, CapturedPlace, SortedIndexMultiMap };
import type { SizedTraitKind } from "../../rustc_type_ir/solve/mod.ts";
export type { SizedTraitKind };
import type { ValTree, Value } from "./consts/valtree.ts";
import type { ScalarInt } from "./consts/int.ts";
import type { TypeckResults } from "./typeck_results.ts";
export type { ScalarInt, TypeckResults, ValTree, Value };
export type { AsyncDestructor, Attribute, CheckRegions, Destructor, Discr, NotUniqueParam, ImplOverlapKind, ImplTraitInTraitData, ParamEnv, PseudoCanonicalInput, TypingEnv, VariantDef };

// ---- 2. pending rustc_middle types (and other crates') ----
// newtype indices (rustc_abi): final shapes
export type FieldIdx = number & { readonly __brand: "FieldIdx" };
export type VariantIdx = number & { readonly __brand: "VariantIdx" };
export type ReprOptions = Pending<"ReprOptions">;
// ty/pattern.rs:16, ty/consts/valtree.rs:34, :103, ty/consts/int.rs:147 (D2: hash-consed)
export type Pattern = Pending<"Pattern">;
export type Scalar = Pending<"Scalar">;
// ty/mod.rs (ParamEnv, TypingEnv, PseudoCanonicalInput), ty/assoc.rs, ty/closure.rs, ty/util.rs, ty/sty.rs
export type NumScalableVectors = Pending<"NumScalableVectors">;
export type InhabitedPredicate = Pending<"InhabitedPredicate">;
export type NormalizationError = Pending<"NormalizationError">;
export type Instance = Pending<"Instance">;
export type InstanceKind = Pending<"InstanceKind">;
// traits/solve.rs:33, :44 (D2: hash-consed; lane middle-traits-thir)
import type { CanonicalInput, ExternalConstraints } from "../traits/solve.ts";
export type { CanonicalInput, ExternalConstraints };
// traits/mod.rs (lane middle-traits-thir)
import type { ObligationCause } from "../traits/mod.ts";
export type { ObligationCause };
// hir/place.rs, mir/syntax.rs, mir/interpret/allocation.rs, mir/mod.rs
export type HirPlace = Pending<"hir::place::Place">;
export type ProjectionKind = Pending<"ProjectionKind">;
export type PlaceElem = Pending<"PlaceElem">;
export type Allocation = Pending<"Allocation">;
export type ConstAllocation = Pending<"ConstAllocation">;
export type Body = Pending<"mir::Body">;
export type CoroutineLayout = Pending<"CoroutineLayout">;
// rustc_abi / ty/layout.rs (M4)
export type LayoutData = Pending<"LayoutData">;
export type Layout = Pending<"Layout">;
export type TyAndLayout = Pending<"TyAndLayout">;
export type LayoutError = Pending<"LayoutError">;
export type PointeeInfo = Pending<"PointeeInfo">;
export type FnAbi<T> = Pending1<"FnAbi", T>;
export type FnAbiError = Pending<"FnAbiError">;
// rustc_hir (lane hir-types)
export type BodyId = Pending<"hir::BodyId">;
// the arenas are erased (PORTING §5); `Arena` only appears as a parameter type
export type Arena = Pending<"Arena">;
// core::ops::Range<T>
export type Range<T> = { readonly start: T; readonly end: T };
// ty/print/mod.rs `trait Print<P>` as a descriptor (lane ty-print-a decision 1)
import type { Print } from "./print/mod.ts";
export type { Print };
// ty/fold.rs `trait BoundVarReplacerDelegate`
import type { BoundVarReplacerDelegate } from "./fold.ts";
export type { BoundVarReplacerDelegate };
// the search graph's `Tracked<T>` (`I::Tracked<T>`, impl_interner.rs: `WithDepNode<T>`; lane middle-traits-thir)
import type { WithDepNode as Tracked } from "../traits/cache.ts";
import type { KeyedSet } from "../../rust_ts/keyed.ts";
export type { Tracked };

// TyCtxt's `Interner` associated list types (rustc_type_ir/interner.ts header; `&'tcx List<T>`), named for
// tools/codegen's type map (merge-w13)
export type Consts = List<Const>;
export type PatList = List<Pattern>;
export type LocalDefIds = List<LocalDefId>;
export type CanonicalVarKinds = List<CanonicalVarKind>;
export type BoundExistentialPredicates = List<PolyExistentialPredicate>;
export type RegionAssumptions = List<ArgOutlivesClause>;
// traits/solve.rs:23 `PredefinedOpaques<'tcx> = &'tcx ty::List<(ty::OpaqueTypeKey<'tcx>, Ty<'tcx>)>`
export type PredefinedOpaques = List<[OpaqueTypeKey, Ty]>;
// ty/abstract_const.rs `CastKind`, mir/syntax.rs `BinOp` / `UnOp` (fieldless enums of files not generated yet)
export type CastKind = Pending<"abstract_const::CastKind">;
export type BinOp = Pending<"mir::BinOp">;
export type UnOp = Pending<"mir::UnOp">;
// rustc_data_structures sorted_map/index_map.rs, transitive_relation.rs (not ported yet)
export type TransitiveRelation<T> = Pending1<"TransitiveRelation", T>;

// ---- 3. method declarations ----
declare module "./mod.ts" {
  interface Ty {
    // ---- ty/mod.rs ----
    // ty/mod.rs:522 kind (impl IntoKind: the inherent `kind`, ported in the class)
    // ty/mod.rs:528 flags (ported in the class)
    // ty/mod.rs:532 outer_exclusive_binder (ported in the class)

    // ---- ty/sty.rs ----
    // ty/sty.rs:1071
    tuple_fields(): List<Ty>;
    // ty/sty.rs:1075
    to_opt_closure_kind(): ClosureKind | undefined;
    // ty/sty.rs:1118
    discriminant_ty(interner: TyCtxt): Ty;
    // ty/sty.rs:1122
    has_unsafe_fields(): boolean;
    // ty/sty.rs:1134 kind (ported in the class)
    // ty/sty.rs:1139
    is_unit(): boolean;
    // ty/sty.rs:1148
    is_usize(): boolean;
    // ty/sty.rs:1154
    is_usize_like(): boolean;
    // ty/sty.rs:1159
    is_never(): boolean;
    // ty/sty.rs:1164
    is_primitive(): boolean;
    // ty/sty.rs:1169
    is_adt(): boolean;
    // ty/sty.rs:1174
    is_self_param(): boolean;
    // ty/sty.rs:1183
    is_ref(): boolean;
    // ty/sty.rs:1188
    is_ty_var(): boolean;
    // ty/sty.rs:1193
    ty_vid(): TyVid | undefined;
    // ty/sty.rs:1201
    float_vid(): FloatVid | undefined;
    // ty/sty.rs:1209
    is_ty_or_numeric_infer(): boolean;
    // ty/sty.rs:1214
    is_phantom_data(): boolean;
    // ty/sty.rs:1219
    is_unsafe_cell(): boolean;
    // ty/sty.rs:1224
    is_bool(): boolean;
    // ty/sty.rs:1230
    is_str(): boolean;
    // ty/sty.rs:1236
    is_imm_ref_str(): boolean;
    // ty/sty.rs:1241
    is_param(index: number): boolean;
    // ty/sty.rs:1249
    is_slice(): boolean;
    // ty/sty.rs:1254
    is_array_slice(): boolean;
    // ty/sty.rs:1263
    is_array(): boolean;
    // ty/sty.rs:1268
    is_simd(): boolean;
    // ty/sty.rs:1276
    is_scalable_vector(): boolean;
    // ty/sty.rs:1283
    sequence_element_type(tcx: TyCtxt): Ty;
    // ty/sty.rs:1291
    scalable_vector_parts(tcx: TyCtxt): [number, Ty, NumScalableVectors] | undefined;
    // ty/sty.rs:1317
    simd_size_and_type(tcx: TyCtxt): [number, Ty];
    // ty/sty.rs:1341
    is_mutable_ptr(): boolean;
    // ty/sty.rs:1347
    ref_mutability(): Mutability | undefined;
    // ty/sty.rs:1355
    is_raw_ptr(): boolean;
    // ty/sty.rs:1362
    is_any_ptr(): boolean;
    // ty/sty.rs:1367
    is_box(): boolean;
    // ty/sty.rs:1379
    is_box_global(tcx: TyCtxt): boolean;
    // ty/sty.rs:1394
    boxed_ty(): Ty | undefined;
    // ty/sty.rs:1401
    pinned_ty(): Ty | undefined;
    // ty/sty.rs:1416
    maybe_pinned_ref(): [Ty, Pinnedness, Mutability, Region] | undefined;
    // ty/sty.rs:1432
    expect_boxed_ty(): Ty;
    // ty/sty.rs:1441
    is_scalar(): boolean;
    // ty/sty.rs:1457
    is_floating_point(): boolean;
    // ty/sty.rs:1462
    is_trait(): boolean;
    // ty/sty.rs:1467
    is_enum(): boolean;
    // ty/sty.rs:1472
    is_union(): boolean;
    // ty/sty.rs:1477
    is_closure(): boolean;
    // ty/sty.rs:1482
    is_coroutine(): boolean;
    // ty/sty.rs:1487
    is_coroutine_closure(): boolean;
    // ty/sty.rs:1492
    is_integral(): boolean;
    // ty/sty.rs:1497
    is_fresh_ty(): boolean;
    // ty/sty.rs:1502
    is_fresh(): boolean;
    // ty/sty.rs:1507
    is_char(): boolean;
    // ty/sty.rs:1512
    is_numeric(): boolean;
    // ty/sty.rs:1517
    is_signed(): boolean;
    // ty/sty.rs:1522
    is_ptr_sized_integral(): boolean;
    // ty/sty.rs:1527
    has_concrete_skeleton(): boolean;
    // ty/sty.rs:1534
    contains(other: Ty): boolean;
    // ty/sty.rs:1552
    contains_closure(): boolean;
    // ty/sty.rs:1575
    find_async_drop_impl_coroutine(tcx: TyCtxt, f: (_0: Ty) => void): Ty;
    // ty/sty.rs:1598
    builtin_deref(explicit: boolean): Ty | undefined;
    // ty/sty.rs:1608
    builtin_index(): Ty | undefined;
    // ty/sty.rs:1616
    fn_sig(tcx: TyCtxt): PolyFnSig;
    // ty/sty.rs:1621
    unnormalized_fn_sig(tcx: TyCtxt): Unnormalized<PolyFnSig>;
    // ty/sty.rs:1626
    is_fn(): boolean;
    // ty/sty.rs:1631
    is_fn_ptr(): boolean;
    // ty/sty.rs:1636
    is_opaque(): boolean;
    // ty/sty.rs:1641
    ty_adt_def(): AdtDef | undefined;
    // ty/sty.rs:1652 tuple_fields (impl inherent: same method as above)
    // ty/sty.rs:1661
    opt_tuple_fields(): List<Ty> | undefined;
    // ty/sty.rs:1672
    variant_range(tcx: TyCtxt): Range<VariantIdx> | undefined;
    // ty/sty.rs:1690
    discriminant_for_variant(tcx: TyCtxt, variant_index: VariantIdx): Discr | undefined;
    // ty/sty.rs:1710 discriminant_ty (impl inherent: same method as above)
    // ty/sty.rs:1765
    ptr_metadata_ty_or_tail(tcx: TyCtxt, normalize: (_0: Unnormalized<Ty>) => Ty): Result<Ty, Ty>;
    // ty/sty.rs:1824
    ptr_metadata_ty(tcx: TyCtxt, normalize: (_0: Unnormalized<Ty>) => Ty): Ty;
    // ty/sty.rs:1846
    pointee_metadata_ty_or_projection(tcx: TyCtxt): Ty;
    // ty/sty.rs:1902 to_opt_closure_kind (impl inherent: same method as above)
    // ty/sty.rs:1961
    has_trivial_sizedness(tcx: TyCtxt, sizedness: SizedTraitKind): boolean;
    // ty/sty.rs:2016
    is_trivially_pure_clone_copy(): boolean;
    // ty/sty.rs:2067
    is_trivially_wf(tcx: TyCtxt): boolean;
    // ty/sty.rs:2114
    primitive_symbol(): Symbol | undefined;
    // ty/sty.rs:2126
    is_c_void(tcx: TyCtxt): boolean;
    // ty/sty.rs:2133
    is_async_drop_in_place_coroutine(tcx: TyCtxt): boolean;
    // ty/sty.rs:2145
    is_known_rigid(): boolean;
    // ty/sty.rs:2159
    walk(): TypeWalker;
    // ty/sty.rs:2166
    is_like_maybe_dangling(): boolean;

    // ---- ty/codec.rs ----
    // ty/codec.rs:72 variant (impl EncodableWithShorthand: rustc-skip (M5))
    // ty/codec.rs:126 encode (impl Encodable: rustc-skip (M5))

    // ---- ty/diagnostics.rs ----
    // ty/diagnostics.rs:22 into_diag_arg (impl IntoDiagArg: <T>_into_diag_arg fn)
    // ty/diagnostics.rs:41
    is_primitive_ty(): boolean;
    // ty/diagnostics.rs:60
    is_simple_ty(): boolean;
    // ty/diagnostics.rs:84
    is_simple_text(): boolean;

    // ---- ty/error.rs ----
    // ty/error.rs:140
    sort_string(tcx: TyCtxt): string;
    // ty/error.rs:186
    prefix_string(tcx: TyCtxt): string;

    // ---- ty/inhabitedness/mod.rs ----
    // ty/inhabitedness/mod.rs:133
    inhabited_predicate(tcx: TyCtxt): InhabitedPredicate;
    // ty/inhabitedness/mod.rs:210
    is_inhabited_from(tcx: TyCtxt, module: LocalModId, typing_env: TypingEnv): boolean;
    // ty/inhabitedness/mod.rs:223
    is_privately_uninhabited(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/inhabitedness/mod.rs:239
    is_opsem_inhabited(tcx: TyCtxt, typing_env: TypingEnv): boolean;

    // ---- ty/print/mod.rs ----
    // ty/print/mod.rs:360 print (impl Print: print fn (ty/print))

    // ---- ty/structural_impls.rs ----
    // ty/structural_impls.rs:83 fmt (impl Debug: debug_<T> fn)
    // ty/structural_impls.rs:312 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:319 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:325 visit_with (impl TypeVisitable: D4 descriptor visit_<T>)
    // ty/structural_impls.rs:331 try_super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // ty/structural_impls.rs:379 super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // ty/structural_impls.rs:420 super_visit_with (impl TypeSuperVisitable: D4 descriptor visit_<T> (super_*))

    // ---- ty/util.rs ----
    // ty/util.rs:1106
    primitive_size(tcx: TyCtxt): Size;
    // ty/util.rs:1117
    int_size_and_signed(tcx: TyCtxt): [Size, boolean];
    // ty/util.rs:1127
    numeric_min_and_max_as_bits(tcx: TyCtxt): [bigint, bigint] | undefined;
    // ty/util.rs:1152
    numeric_max_val(tcx: TyCtxt): Const | undefined;
    // ty/util.rs:1160
    numeric_min_val(tcx: TyCtxt): Const | undefined;
    // ty/util.rs:1172
    is_sized(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/util.rs:1184
    is_freeze(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/util.rs:1192
    is_trivially_freeze(): boolean;
    // ty/util.rs:1225
    is_unsafe_unpin(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/util.rs:1234
    is_unpin(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/util.rs:1242
    is_trivially_unpin(): boolean;
    // ty/util.rs:1275 has_unsafe_fields (impl inherent: same method as above)
    // ty/util.rs:1284
    is_async_drop(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/util.rs:1293
    is_trivially_not_async_drop(): boolean;
    // ty/util.rs:1337
    needs_drop(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/util.rs:1373
    needs_async_drop(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/util.rs:1408
    has_significant_drop(tcx: TyCtxt, typing_env: TypingEnv): boolean;
    // ty/util.rs:1456
    is_structural_eq_shallow(tcx: TyCtxt): boolean;
    // ty/util.rs:1507
    peel_refs(): Ty;
  }
  namespace Ty {
    // ---- ty/sty.rs ----
    // ty/sty.rs:368 new (a `static` in the class body: `new` is reserved here)
    // ty/sty.rs:373
    function new_infer(tcx: TyCtxt, infer: InferTy): Ty;
    // ty/sty.rs:378
    function new_var(tcx: TyCtxt, v: TyVid): Ty;
    // ty/sty.rs:388
    function new_int_var(tcx: TyCtxt, v: IntVid): Ty;
    // ty/sty.rs:393
    function new_float_var(tcx: TyCtxt, v: FloatVid): Ty;
    // ty/sty.rs:398
    function new_fresh(tcx: TyCtxt, n: number): Ty;
    // ty/sty.rs:408
    function new_fresh_int(tcx: TyCtxt, n: number): Ty;
    // ty/sty.rs:418
    function new_fresh_float(tcx: TyCtxt, n: number): Ty;
    // ty/sty.rs:428
    function new_param(tcx: TyCtxt, index: number, name: Symbol): Ty;
    // ty/sty.rs:433
    function new_bound(tcx: TyCtxt, index: DebruijnIndex, bound_ty: BoundTy): Ty;
    // ty/sty.rs:450
    function new_canonical_bound(tcx: TyCtxt, var_: BoundVar): Ty;
    // ty/sty.rs:466
    function new_placeholder(tcx: TyCtxt, placeholder: PlaceholderType): Ty;
    // ty/sty.rs:471
    function new_alias(tcx: TyCtxt, is_rigid: IsRigid, alias_ty: AliasTy): Ty;
    // ty/sty.rs:480
    function new_pat(tcx: TyCtxt, base: Ty, pat: Pattern): Ty;
    // ty/sty.rs:485
    function new_field_representing_type(tcx: TyCtxt, base: Ty, variant: VariantIdx, field: FieldIdx): Ty;
    // ty/sty.rs:515
    function new_opaque(tcx: TyCtxt, is_rigid: IsRigid, def_id: DefId, args: GenericArgs): Ty;
    // ty/sty.rs:525
    function new_error(tcx: TyCtxt, guar: ErrorGuaranteed): Ty;
    // ty/sty.rs:531
    function new_misc_error(tcx: TyCtxt): Ty;
    // ty/sty.rs:538
    function new_error_with_message(tcx: TyCtxt, span: MultiSpan, msg: string): Ty;
    // ty/sty.rs:548
    function new_int(tcx: TyCtxt, i: IntTy): Ty;
    // ty/sty.rs:561
    function new_uint(tcx: TyCtxt, ui: UintTy): Ty;
    // ty/sty.rs:574
    function new_float(tcx: TyCtxt, f: FloatTy): Ty;
    // ty/sty.rs:585
    function new_ref(tcx: TyCtxt, r: Region, ty: Ty, mutbl: Mutability): Ty;
    // ty/sty.rs:595
    function new_mut_ref(tcx: TyCtxt, r: Region, ty: Ty): Ty;
    // ty/sty.rs:600
    function new_imm_ref(tcx: TyCtxt, r: Region, ty: Ty): Ty;
    // ty/sty.rs:604
    function new_pinned_ref(tcx: TyCtxt, r: Region, ty: Ty, mutbl: Mutability): Ty;
    // ty/sty.rs:615
    function new_ptr(tcx: TyCtxt, ty: Ty, mutbl: Mutability): Ty;
    // ty/sty.rs:620
    function new_mut_ptr(tcx: TyCtxt, ty: Ty): Ty;
    // ty/sty.rs:625
    function new_imm_ptr(tcx: TyCtxt, ty: Ty): Ty;
    // ty/sty.rs:630
    function new_adt(tcx: TyCtxt, def: AdtDef, args: GenericArgs): Ty;
    // ty/sty.rs:671
    function new_foreign(tcx: TyCtxt, def_id: DefId): Ty;
    // ty/sty.rs:676
    function new_array(tcx: TyCtxt, ty: Ty, n: number): Ty;
    // ty/sty.rs:681
    function new_array_with_const_len(tcx: TyCtxt, ty: Ty, ct: Const): Ty;
    // ty/sty.rs:690
    function new_slice(tcx: TyCtxt, ty: Ty): Ty;
    // ty/sty.rs:695
    function new_tup(tcx: TyCtxt, ts: readonly Ty[]): Ty;
    // ty/sty.rs:699
    function new_tup_from_iter(tcx: TyCtxt, iter: Iterable<Ty>): Ty;
    function new_tup_from_iter<E>(tcx: TyCtxt, iter: Iterable<Result<Ty, E>>, c: CollectAndApply_Result): Result<Ty, E>;
    // ty/sty.rs:709
    function new_fn_def(tcx: TyCtxt, def_id: DefId, args: Binder<Iterable<GenericArg>>): Ty;
    // ty/sty.rs:723
    function new_fn_ptr(tcx: TyCtxt, fty: PolyFnSig): Ty;
    // ty/sty.rs:729
    function new_unsafe_binder(tcx: TyCtxt, b: Binder<Ty>): Ty;
    // ty/sty.rs:734
    function new_dynamic(tcx: TyCtxt, obj: List<PolyExistentialPredicate>, reg: Region): Ty;
    // ty/sty.rs:770
    function new_projection_from_args(tcx: TyCtxt, is_rigid: IsRigid, item_def_id: DefId, args: GenericArgs): Ty;
    // ty/sty.rs:784
    function new_projection(tcx: TyCtxt, is_rigid: IsRigid, item_def_id: DefId, args: Iterable<GenericArg>): Ty;
    // ty/sty.rs:798
    function new_closure(tcx: TyCtxt, def_id: DefId, closure_args: GenericArgs): Ty;
    // ty/sty.rs:808
    function new_coroutine_closure(tcx: TyCtxt, def_id: DefId, closure_args: GenericArgs): Ty;
    // ty/sty.rs:818
    function new_coroutine(tcx: TyCtxt, def_id: DefId, coroutine_args: GenericArgs): Ty;
    // ty/sty.rs:828
    function new_coroutine_witness(tcx: TyCtxt, def_id: DefId, args: GenericArgs): Ty;
    // ty/sty.rs:839
    function new_coroutine_witness_for_coroutine(tcx: TyCtxt, def_id: DefId, coroutine_args: GenericArgs): Ty;
    // ty/sty.rs:867
    function new_static_str(tcx: TyCtxt): Ty;
    // ty/sty.rs:873
    function new_generic_adt(tcx: TyCtxt, wrapper_def_id: DefId, ty_param: Ty): Ty;
    // ty/sty.rs:890
    function new_lang_item(tcx: TyCtxt, ty: Ty, item: LangItem): Ty | undefined;
    // ty/sty.rs:896
    function new_diagnostic_item(tcx: TyCtxt, ty: Ty, name: Symbol): Ty | undefined;
    // ty/sty.rs:902
    function new_box(tcx: TyCtxt, ty: Ty): Ty;
    // ty/sty.rs:908
    function new_option(tcx: TyCtxt, ty: Ty): Ty;
    // ty/sty.rs:914
    function new_maybe_uninit(tcx: TyCtxt, ty: Ty): Ty;
    // ty/sty.rs:920
    function new_task_context(tcx: TyCtxt): Ty;
    // ty/sty.rs:930
    function new_bool(tcx: TyCtxt): Ty;
    // ty/sty.rs:934
    function new_u8(tcx: TyCtxt): Ty;
    // ty/sty.rs:938 new_infer (impl Ty: same method as above)
    // ty/sty.rs:942 new_var (impl Ty: same method as above)
    // ty/sty.rs:946
    function ir_new_param(tcx: TyCtxt, param: ParamTy): Ty;
    // ty/sty.rs:950 new_placeholder (impl Ty: same method as above)
    // ty/sty.rs:954 new_bound (impl Ty: same method as above)
    // ty/sty.rs:962
    function new_anon_bound(tcx: TyCtxt, debruijn: DebruijnIndex, var_: BoundVar): Ty;
    // ty/sty.rs:966 new_canonical_bound (impl Ty: same method as above)
    // ty/sty.rs:970 new_alias (impl Ty: same method as above)
    // ty/sty.rs:978 new_error (impl Ty: same method as above)
    // ty/sty.rs:982 new_adt (impl Ty: same method as above)
    // ty/sty.rs:990 new_foreign (impl Ty: same method as above)
    // ty/sty.rs:994 new_dynamic (impl Ty: same method as above)
    // ty/sty.rs:1002 new_coroutine (impl Ty: same method as above)
    // ty/sty.rs:1010 new_coroutine_closure (impl Ty: same method as above)
    // ty/sty.rs:1018 new_closure (impl Ty: same method as above)
    // ty/sty.rs:1022 new_coroutine_witness (impl Ty: same method as above)
    // ty/sty.rs:1030 new_coroutine_witness_for_coroutine (impl Ty: same method as above)
    // ty/sty.rs:1038 new_ptr (impl Ty: same method as above)
    // ty/sty.rs:1042 new_ref (impl Ty: same method as above)
    // ty/sty.rs:1051 new_array_with_const_len (impl Ty: same method as above)
    // ty/sty.rs:1055 new_slice (impl Ty: same method as above)
    // ty/sty.rs:1059 new_tup (impl Ty: same method as above)
    // ty/sty.rs:1063 new_tup_from_iter (impl Ty: same method as above)
    // ty/sty.rs:1079
    function from_closure_kind(interner: TyCtxt, kind: ClosureKind): Ty;
    // ty/sty.rs:1083
    function from_coroutine_closure_kind(interner: TyCtxt, kind: ClosureKind): Ty;
    // ty/sty.rs:1090 new_fn_def (impl Ty: same method as above)
    // ty/sty.rs:1098 new_fn_ptr (impl Ty: same method as above; `PolyFnSig` = `Binder<FnSig>`)
    // ty/sty.rs:1102 new_pat (impl Ty: same method as above)
    // ty/sty.rs:1106 new_unsafe_binder (impl Ty: same method as above)
    // ty/sty.rs:1110
    function new_unit(interner: TyCtxt): Ty;
    // ty/sty.rs:1114
    function new_usize(interner: TyCtxt): Ty;
    // ty/sty.rs:1924 from_closure_kind (impl inherent: same method as above)
    // ty/sty.rs:1944 from_coroutine_closure_kind (impl inherent: same method as above)

    // ---- ty/codec.rs ----
    // ty/codec.rs:189 decode (impl Decodable: decode_<T> fn (TyDecodable codegen))

    // ---- ty/layout.rs ----
    // ty/layout.rs:804 ty_and_layout_for_variant (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:848 ty_and_layout_field (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1050 ty_and_layout_pointee_info_at (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1229 is_adt (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1233 is_enum (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1237 is_never (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1241 is_tuple (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1245 is_unit (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1249 is_transparent (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1254 is_complex_number_lang_item (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1259 is_scalable_vector (impl TyAbiInterface: M4 (layout))
    // ty/layout.rs:1264 is_pass_indirectly_in_non_rustic_abis_flag_set (impl TyAbiInterface: M4 (layout))

    // ---- ty/relate.rs ----
    // ty/relate.rs:12 relate (impl Relate: relate_<T> fn)
  }
}

declare module "./list.ts" {
  interface RawList<H, T> {
    // ---- ty/list.rs ----
    // ty/list.rs:78 len (ported in the class)
    // ty/list.rs:83 as_slice (ported in the class)
    // ty/list.rs:134 iter (ported in the class)
    // ty/list.rs:147 iter (impl SliceLike: the same method)
    // ty/list.rs:151 as_slice (impl SliceLike: same method as above)
    // ty/list.rs:192 fmt (impl Debug: debug_<T> fn)
    // ty/list.rs:199 encode (impl Encodable: rustc-skip (M5))
    // ty/list.rs:206 eq (impl PartialEq: === (D2))
    // ty/list.rs:219 cmp (impl Ord: unported: pointer order)
    // ty/list.rs:230 partial_cmp (impl PartialOrd: unported: pointer order)
    // ty/list.rs:243 hash (impl Hash: identity (D2))
    // ty/list.rs:253 deref (impl Deref: the array itself)
    // ty/list.rs:260 as_ref (impl AsRef: the array itself)
    // ty/list.rs:274 into_iter (impl IntoIterator: the array itself)
    // ty/list.rs:298 flags (ported in the class)
    // ty/list.rs:303 outer_exclusive_binder (ported in the class)

    // ---- ty/mod.rs ----
    // ty/mod.rs:1002 flags (impl Flags: same method as above)
    // ty/mod.rs:1006 outer_exclusive_binder (impl Flags: same method as above)

    // ---- ty/generic_args.rs ----
    // ty/generic_args.rs:45
    rebase_onto(this: GenericArgs, tcx: TyCtxt, source_ancestor: DefId, target_args: GenericArgs): GenericArgs;
    // ty/generic_args.rs:55
    type_at(this: GenericArgs, i: number): Ty;
    // ty/generic_args.rs:60
    region_at(this: GenericArgs, i: number): Region;
    // ty/generic_args.rs:65
    const_at(this: GenericArgs, i: number): Const;
    // ty/generic_args.rs:81
    split_closure_args(this: GenericArgs): ClosureArgsParts;
    // ty/generic_args.rs:95
    split_coroutine_closure_args(this: GenericArgs): CoroutineClosureArgsParts;
    // ty/generic_args.rs:114
    split_coroutine_args(this: GenericArgs): CoroutineArgsParts;
    // ty/generic_args.rs:388
    into_type_list(this: GenericArgs, tcx: TyCtxt): List<Ty>;
    // ty/generic_args.rs:399
    as_closure(this: GenericArgs): ClosureArgs;
    // ty/generic_args.rs:407
    as_coroutine_closure(this: GenericArgs): CoroutineClosureArgs;
    // ty/generic_args.rs:415
    as_coroutine(this: GenericArgs): CoroutineArgs;
    // ty/generic_args.rs:423
    as_inline_const(this: GenericArgs): InlineConstArgs;
    // ty/generic_args.rs:448
    extend_to(this: GenericArgs, tcx: TyCtxt, def_id: DefId, mk_kind: (param: GenericParamDef, args: readonly GenericArg[]) => GenericArg): GenericArgs;
    // ty/generic_args.rs:509
    types(this: GenericArgs): Iterable<Ty>;
    // ty/generic_args.rs:514
    regions(this: GenericArgs): Iterable<Region>;
    // ty/generic_args.rs:519
    consts(this: GenericArgs): Iterable<Const>;
    // ty/generic_args.rs:524
    terms(this: GenericArgs): Iterable<Term>;
    // ty/generic_args.rs:530
    non_erasable_generics(this: GenericArgs): Iterable<GenericArgKind>;
    // ty/generic_args.rs:539 type_at (impl inherent: same method as above)
    // ty/generic_args.rs:548 region_at (impl inherent: same method as above)
    // ty/generic_args.rs:557 const_at (impl inherent: same method as above)
    // ty/generic_args.rs:566
    type_for_def(this: GenericArgs, def: GenericParamDef): GenericArg;
    // ty/generic_args.rs:588 rebase_onto (impl inherent: same method as above)
    // ty/generic_args.rs:601
    truncate_to(this: GenericArgs, tcx: TyCtxt, generics: Generics): GenericArgs;
    // ty/generic_args.rs:605
    print_as_list(this: GenericArgs): string;
    // ty/generic_args.rs:612 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/generic_args.rs:641 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/generic_args.rs:664 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/generic_args.rs:697 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/generic_args.rs:716 visit_with (impl TypeVisitable: D4 descriptor visit_<T>)

    // ---- ty/impls_ty.rs ----
    // ty/impls_ty.rs:20 stable_hash (impl StableHash: not a method)

    // ---- ty/predicate.rs ----
    // ty/predicate.rs:255 principal_def_id (impl BoundExistentialPredicates: not a method)
    // ty/predicate.rs:259 principal (impl BoundExistentialPredicates: not a method)
    // ty/predicate.rs:263 auto_traits (impl BoundExistentialPredicates: not a method)
    // ty/predicate.rs:267 projection_bounds (impl BoundExistentialPredicates: not a method)
    // ty/predicate.rs:300
    principal(this: List<PolyExistentialPredicate>): Binder<ExistentialTraitRef> | undefined;
    // ty/predicate.rs:309
    principal_def_id(this: List<PolyExistentialPredicate>): DefId | undefined;
    // ty/predicate.rs:314
    projection_bounds(this: List<PolyExistentialPredicate>): Iterable<Binder<ExistentialProjection>>;
    // ty/predicate.rs:328
    auto_traits(this: List<PolyExistentialPredicate>): Iterable<DefId>;
    // ty/predicate.rs:335
    without_auto_traits(this: List<PolyExistentialPredicate>): Iterable<PolyExistentialPredicate>;

    // ---- ty/print/mod.rs ----
    // ty/print/mod.rs:412 print (impl Print: print fn (ty/print))

    // ---- ty/structural_impls.rs ----
    // ty/structural_impls.rs:565 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:572 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:619 visit_with (impl TypeVisitable: D4 descriptor visit_<T>)
    // ty/structural_impls.rs:625 super_visit_with (impl TypeSuperVisitable: D4 descriptor visit_<T> (super_*))
    // ty/structural_impls.rs:631 try_super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // ty/structural_impls.rs:638 super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // ty/structural_impls.rs:727 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:734 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)

    // ---- ty/sty.rs ----
    // ty/sty.rs:2181
    inputs(this: List<Ty>): readonly Ty[];
    // ty/sty.rs:2185
    output(this: List<Ty>): Ty;
  }
  namespace RawList {
    // ---- ty/list.rs ----
    // ty/list.rs:67 default (impl Default: List.empty())
    // ty/list.rs:97 from_arena (ported in the class)
    // ty/list.rs:159
    function from_vars(tcx: TyCtxt, iter: Iterable<BoundVariableKind>): List<BoundVariableKind>;
    // ty/list.rs:172 empty (impl_list_empty!: ported in the class)

    // ---- ty/generic_args.rs ----
    // ty/generic_args.rs:69
    function identity_for_item(tcx: TyCtxt, def_id: DefId): GenericArgs;
    // ty/generic_args.rs:73
    function extend_with_error(tcx: TyCtxt, def_id: DefId, original_args: readonly GenericArg[]): GenericArgs;
    // ty/generic_args.rs:428 identity_for_item (impl inherent: same method as above)
    // ty/generic_args.rs:437
    function for_item(tcx: TyCtxt, def_id: DefId, mk_kind: (param: GenericParamDef, args: readonly GenericArg[]) => GenericArg): GenericArgs;
    // ty/generic_args.rs:462
    function fill_item(args: GenericArg[], tcx: TyCtxt, defs: Generics, mk_kind: (param: GenericParamDef, args: readonly GenericArg[]) => GenericArg): void;
    // ty/generic_args.rs:477
    function fill_single(args: GenericArg[], defs: Generics, mk_kind: (param: GenericParamDef, args: readonly GenericArg[]) => GenericArg): void;
    // ty/generic_args.rs:494 extend_with_error (impl inherent: same method as above)

    // ---- ty/codec.rs ----
    // ty/codec.rs:234 decode (impl Decodable: decode_<T> fn (TyDecodable codegen))

    // ---- ty/codec/ref_decodable.rs ----
    // ty/codec/ref_decodable.rs:30 decode (impl RefDecodable: not a method)
    // ty/codec/ref_decodable.rs:39 decode (impl RefDecodable: not a method)
    // ty/codec/ref_decodable.rs:48 decode (impl RefDecodable: not a method)
    // ty/codec/ref_decodable.rs:57 decode (impl RefDecodable: not a method)
    // ty/codec/ref_decodable.rs:66 decode (impl RefDecodable: not a method)
    // ty/codec/ref_decodable.rs:75 decode (impl RefDecodable: not a method)

    // ---- ty/relate.rs ----
    // ty/relate.rs:56 relate (impl Relate: relate_<T> fn)
    // ty/relate.rs:92 relate (impl Relate: relate_<T> fn)
  }
}

declare module "./predicate.ts" {
  interface Predicate {
    // ---- ty/predicate.rs ----
    // ty/predicate.rs:51
    as_clause(): Clause | undefined;
    // ty/predicate.rs:59 kind (impl IntoKind: the inherent `kind` (:77))
    // ty/predicate.rs:65 flags (ported in the class)
    // ty/predicate.rs:69 outer_exclusive_binder (ported in the class)
    // ty/predicate.rs:77 kind (ported in the class)
    // ty/predicate.rs:84
    flip_polarity(tcx: TyCtxt): Predicate | undefined;
    // ty/predicate.rs:108
    allow_normalization(): boolean;
    // ty/predicate.rs:114 into_diag_arg (impl IntoDiagArg: <T>_into_diag_arg fn)
    // ty/predicate.rs:615
    as_trait_clause(): PolyTraitClause | undefined;
    // ty/predicate.rs:623
    as_projection_clause(): PolyProjectionClause | undefined;
    // ty/predicate.rs:632 as_clause (impl inherent: same method as above)
    // ty/predicate.rs:640
    expect_clause(): Clause;

    // ---- ty/codec.rs ----
    // ty/codec.rs:132 encode (impl Encodable: rustc-skip (M5))

    // ---- ty/elaborate_impl.rs ----
    // ty/elaborate_impl.rs:27 predicate (impl Elaboratable: not a method)
    // ty/elaborate_impl.rs:31 child (impl Elaboratable: not a method)
    // ty/elaborate_impl.rs:35 child_with_derived_cause (impl Elaboratable: not a method)

    // ---- ty/structural_impls.rs ----
    // ty/structural_impls.rs:101 fmt (impl Debug: debug_<T> fn)
    // ty/structural_impls.rs:471 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:478 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:484 allow_normalization (impl PredicateProxy: not a method)
    // ty/structural_impls.rs:488 map_projection (impl PredicateProxy: not a method)
    // ty/structural_impls.rs:496 clause_kind_unchecked (impl PredicateProxy: not a method)
    // ty/structural_impls.rs:578 visit_with (impl TypeVisitable: D4 descriptor visit_<T>)
    // ty/structural_impls.rs:590 try_super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // ty/structural_impls.rs:604 super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // ty/structural_impls.rs:612 super_visit_with (impl TypeSuperVisitable: D4 descriptor visit_<T> (super_*))
  }
  // statics:
    // ---- ty/predicate.rs ----
    // ty/predicate.rs:455 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:461 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:467 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:473 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:479 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:497 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:510 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:524 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:530 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:551 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:557 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:563 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:569 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:575 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:597 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:609 upcast_from (impl UpcastFrom: upcast fn)

    // ---- ty/codec.rs ----
    // ty/codec.rs:207 decode (impl Decodable: decode_<T> fn (TyDecodable codegen))
}

declare module "./predicate.ts" {
  interface Clause {
    // ---- ty/predicate.rs ----
    // ty/predicate.rs:123 into_diag_arg (impl IntoDiagArg: <T>_into_diag_arg fn)
    // ty/predicate.rs:141 as_predicate (impl inherent::Clause: the inherent `as_predicate` (:169))
    // ty/predicate.rs:145
    instantiate_supertrait(tcx: TyCtxt, trait_ref: PolyTraitRef): Clause;
    // ty/predicate.rs:153 kind (impl IntoKind: the inherent `kind` (:173))
    // ty/predicate.rs:159 flags (ported in the class)
    // ty/predicate.rs:163 outer_exclusive_binder (ported in the class)
    // ty/predicate.rs:169 as_predicate (ported in the class)
    // ty/predicate.rs:173
    kind(): Binder<ClauseKind>;
    // ty/predicate.rs:188
    as_trait_clause(): Binder<TraitClause> | undefined;
    // ty/predicate.rs:197
    as_projection_clause(): Binder<ProjectionClause> | undefined;
    // ty/predicate.rs:206
    as_type_outlives_clause(): Binder<TypeOutlivesClause> | undefined;
    // ty/predicate.rs:215
    as_region_outlives_clause(): Binder<RegionOutlivesClause> | undefined;
    // ty/predicate.rs:352 instantiate_supertrait (impl inherent: same method as above)

    // ---- ty/codec.rs ----
    // ty/codec.rs:140 encode (impl Encodable: rustc-skip (M5))

    // ---- ty/elaborate_impl.rs ----
    // ty/elaborate_impl.rs:7 predicate (impl Elaboratable: not a method)
    // ty/elaborate_impl.rs:11 child (impl Elaboratable: not a method)
    // ty/elaborate_impl.rs:15 child_with_derived_cause (impl Elaboratable: not a method)

    // ---- ty/structural_impls.rs ----
    // ty/structural_impls.rs:107 fmt (impl Debug: debug_<T> fn)
    // ty/structural_impls.rs:503 try_fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:510 fold_with (impl TypeFoldable: D4 descriptor fold_<T>)
    // ty/structural_impls.rs:517 try_super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // ty/structural_impls.rs:528 super_fold_with (impl TypeSuperFoldable: D4 descriptor fold_<T> (super_*))
    // ty/structural_impls.rs:538 super_visit_with (impl TypeSuperVisitable: D4 descriptor visit_<T> (super_*))
    // ty/structural_impls.rs:547 allow_normalization (impl PredicateProxy: not a method)
    // ty/structural_impls.rs:551 map_projection (impl PredicateProxy: not a method)
    // ty/structural_impls.rs:559 clause_kind_unchecked (impl PredicateProxy: not a method)
    // ty/structural_impls.rs:584 visit_with (impl TypeVisitable: D4 descriptor visit_<T>)
  }
  // statics:
    // ---- ty/predicate.rs ----
    // ty/predicate.rs:485 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:491 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:503 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:517 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:537 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:544 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:581 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:588 upcast_from (impl UpcastFrom: upcast fn)
    // ty/predicate.rs:603 upcast_from (impl UpcastFrom: upcast fn)

    // ---- ty/codec.rs ----
    // ty/codec.rs:227 decode (impl Decodable: decode_<T> fn (TyDecodable codegen))
}

declare module "../../rustc_type_ir/sty/consts.ts" {
  interface Const {
    // ---- ty/consts.rs ----
    // ty/consts.rs:70
    to_value(): Value;
    // ty/consts.rs:80
    try_to_value(): Value | undefined;
    // ty/consts.rs:92
    to_leaf(): ScalarInt;
    // ty/consts.rs:101
    to_branch(): readonly Const[];
    // ty/consts.rs:108
    try_to_leaf(): ScalarInt | undefined;
    // ty/consts.rs:115
    try_to_scalar(): Scalar | undefined;
    // ty/consts.rs:122
    try_to_branch(): readonly Const[] | undefined;
    // ty/consts.rs:131
    try_to_target_usize(tcx: TyCtxt): number | undefined;
    // ty/consts.rs:145
    walk(): TypeWalker;

    // ---- ty/print/mod.rs ----
    // ty/print/mod.rs:418 print (impl Print: print fn (ty/print))
  }
  namespace Const {
    // ---- ty/consts.rs ----
    // ty/consts.rs:31
    function from_bits(tcx: TyCtxt, bits: bigint, typing_env: TypingEnv, ty: Ty): Const;
    // ty/consts.rs:48
    function zero_sized(tcx: TyCtxt, ty: Ty): Const;
    // ty/consts.rs:53
    function new_value(tcx: TyCtxt, valtree: ValTree, ty: Ty): Const;
    // ty/consts.rs:59
    function from_bool(tcx: TyCtxt, v: boolean): Const;
    // ty/consts.rs:65
    function from_target_usize(tcx: TyCtxt, n: number): Const;
  }
}

declare module "../../rustc_type_ir/sty/mod.ts" {
  interface Region {
    // ---- ty/print/mod.rs ----
    // ty/print/mod.rs:354 print (impl Print: print fn (ty/print))
  }
}

declare module "./context.ts" {
  interface TyCtxt {
    // ---- ty/abstract_const.rs ----
    // ty/abstract_const.rs:37
    expand_abstract_consts<T>(ac: T, d_T: TypeFoldable<T>): T;

    // ---- ty/assoc.rs ----
    // ty/assoc.rs:335
    associated_types_for_impl_traits_in_associated_fn(fn_def_id: DefId): readonly DefId[];

    // ---- ty/closure.rs ----
    // ty/closure.rs:230
    closure_kind_origin(def_id: LocalDefId): [Span, HirPlace] | undefined;
    // ty/closure.rs:234
    closure_user_provided_sig(def_id: LocalDefId): CanonicalPolyFnSig;
    // ty/closure.rs:238
    closure_captures(def_id: LocalDefId): readonly CapturedPlace[];

    // ---- ty/context/impl_interner.rs ----
    // ty/context/impl_interner.rs:32 next_trait_solver_globally (impl Interner: the inherent `next_trait_solver_globally` (ty/context.rs:2819) serves)
    // ty/context/impl_interner.rs:72 mk_predefined_opaques_in_body (impl Interner: the inherent `mk_predefined_opaques_in_body` (ty/context.rs:2045 slice_interners!) serves)
    // ty/context/impl_interner.rs:80 mk_canonical_var_kinds (impl Interner: the inherent `mk_canonical_var_kinds` (ty/context.rs:2045 slice_interners!) serves)
    // ty/context/impl_interner.rs:88 mk_external_constraints (impl Interner: the inherent `mk_external_constraints` (ty/context.rs:2014 direct_interners!) serves)
    // ty/context/impl_interner.rs:95
    with_cached_task<T>(task: () => T): [T, DepNodeIndex];
    // ty/context/impl_interner.rs:133
    mk_tracked<T>(data: T, dep_node: DepNodeIndex): Tracked<T>;
    // ty/context/impl_interner.rs:140
    get_tracked<T>(tracked: Tracked<T>): T;
    // ty/context/impl_interner.rs:144
    with_global_cache<R>(f: (cache: GlobalCache) => R): R;
    // ty/context/impl_interner.rs:148
    with_canonical_param_env_cache<R>(f: (cache: CanonicalParamEnvCache) => R): R;
    // ty/context/impl_interner.rs:155
    assert_evaluation_is_concurrent(): void;
    // ty/context/impl_interner.rs:160 expand_abstract_consts (impl Interner: the inherent `expand_abstract_consts` (ty/abstract_const.rs:37) serves)
    // ty/context/impl_interner.rs:166 generics_of (impl Interner: the query `generics_of` serves)
    // ty/context/impl_interner.rs:172 variances_of (impl Interner: the query `variances_of` serves)
    // ty/context/impl_interner.rs:176 opt_alias_variances (impl Interner: the inherent `opt_alias_variances` (ty/util.rs:954) serves)
    // ty/context/impl_interner.rs:183 type_of (impl Interner: the query `type_of` serves)
    // ty/context/impl_interner.rs:186 type_of_opaque_hir_typeck (impl Interner: the query `type_of_opaque_hir_typeck` serves)
    // ty/context/impl_interner.rs:189
    ir_is_direct_const(alias: AliasConstKind): boolean;
    // ty/context/impl_interner.rs:198
    ir_const_of_item(alias: AliasConstKind): EarlyBinder<Const> | undefined;
    // ty/context/impl_interner.rs:210 anon_const_kind (impl Interner: the query `anon_const_kind` serves)
    // ty/context/impl_interner.rs:214 def_span (impl Interner: the query `def_span` serves)
    // ty/context/impl_interner.rs:219 adt_def (impl Interner: the query `adt_def` serves)
    // ty/context/impl_interner.rs:223
    trait_ref_and_own_args_for_alias(def_id: DefId, args: GenericArgs): [TraitRef, readonly GenericArg[]];
    // ty/context/impl_interner.rs:235 mk_args (impl Interner: the inherent `mk_args` (ty/context.rs:2045 slice_interners!) serves)
    // ty/context/impl_interner.rs:239 mk_args_from_iter (impl Interner: the inherent `mk_args_from_iter` (ty/context.rs:2571) serves)
    // ty/context/impl_interner.rs:247 check_alias_term_args_compatible (impl Interner: the inherent `check_alias_term_args_compatible` (ty/context.rs:2162) serves)
    // ty/context/impl_interner.rs:255 debug_assert_args_compatible (impl Interner: the inherent `debug_assert_args_compatible` (ty/context.rs:2235) serves)
    // ty/context/impl_interner.rs:259 debug_assert_alias_term_args_compatible (impl Interner: the inherent `debug_assert_alias_term_args_compatible` (ty/context.rs:2243) serves)
    // ty/context/impl_interner.rs:270
    debug_assert_existential_args_compatible(def_id: DefId, args: GenericArgs): void;
    // ty/context/impl_interner.rs:287 mk_type_list_from_iter (impl Interner: the inherent `mk_type_list_from_iter` (ty/context.rs:2563) serves)
    // ty/context/impl_interner.rs:295 mk_ct_from_kind (impl Interner: the inherent `mk_ct_from_kind` (ty/context.rs:2356) serves)
    // ty/context/impl_interner.rs:299
    projection_parent(def_id: DefId): DefId;
    // ty/context/impl_interner.rs:303
    impl_or_trait_assoc_term_parent(def_id: DefId): DefId;
    // ty/context/impl_interner.rs:307
    inherent_alias_term_parent(def_id: DefId): DefId;
    // ty/context/impl_interner.rs:311
    ir_recursion_limit(): number;
    // ty/context/impl_interner.rs:317 features (impl Interner: the inherent `features` (ty/context.rs:1089) serves)
    // ty/context/impl_interner.rs:321 assumptions_on_binders (impl Interner: the inherent `assumptions_on_binders` (ty/context.rs:2843) serves)
    // ty/context/impl_interner.rs:325 renormalize_rigid_aliases (impl Interner: the inherent `renormalize_rigid_aliases` (ty/context.rs:2833) serves)
    // ty/context/impl_interner.rs:329 coroutine_hidden_types (impl Interner: the query `coroutine_hidden_types` serves)
    // ty/context/impl_interner.rs:336 fn_sig (impl Interner: the query `fn_sig` serves)
    // ty/context/impl_interner.rs:340 coroutine_movability (impl Interner: the inherent `coroutine_movability` (ty/context.rs:1049) serves)
    // ty/context/impl_interner.rs:344 coroutine_for_closure (impl Interner: the query `coroutine_for_closure` serves)
    // ty/context/impl_interner.rs:348 generics_require_sized_self (impl Interner: the query `generics_require_sized_self` serves)
    // ty/context/impl_interner.rs:352 item_bounds (impl Interner: the query `item_bounds` serves)
    // ty/context/impl_interner.rs:359 item_self_bounds (impl Interner: the query `item_self_bounds` serves)
    // ty/context/impl_interner.rs:366 item_non_self_bounds (impl Interner: the query `item_non_self_bounds` serves)
    // ty/context/impl_interner.rs:373
    ir_clauses_of(def_id: DefId): EarlyBinder<Iterable<Clause>>;
    // ty/context/impl_interner.rs:386
    own_clauses_of(def_id: DefId): EarlyBinder<Iterable<Clause>>;
    // ty/context/impl_interner.rs:397 explicit_super_clauses_of (impl Interner: the query `explicit_super_clauses_of` serves)
    // ty/context/impl_interner.rs:404 explicit_implied_clauses_of (impl Interner: the query `explicit_implied_clauses_of` serves)
    // ty/context/impl_interner.rs:411 impl_super_outlives (impl Interner: the query `impl_super_outlives` serves)
    // ty/context/impl_interner.rs:418
    supertrait_def_ids(trait_def_id: DefId): Iterable<DefId>;
    // ty/context/impl_interner.rs:422
    impl_is_const(def_id: DefId): boolean;
    // ty/context/impl_interner.rs:427
    fn_is_const(def_id: DefId): boolean;
    // ty/context/impl_interner.rs:435
    closure_is_const(def_id: DefId): boolean;
    // ty/context/impl_interner.rs:440
    alias_has_const_conditions(def_id: DefId): boolean;
    // ty/context/impl_interner.rs:445
    ir_const_conditions(def_id: DefId): EarlyBinder<Iterable<Binder<TraitRef>>>;
    // ty/context/impl_interner.rs:457
    ir_explicit_implied_const_bounds(def_id: DefId): EarlyBinder<Iterable<Binder<TraitRef>>>;
    // ty/context/impl_interner.rs:469 impl_self_is_guaranteed_unsized (impl Interner: the query `impl_self_is_guaranteed_unsized` serves)
    // ty/context/impl_interner.rs:473
    has_target_features(def_id: DefId): boolean;
    // ty/context/impl_interner.rs:477
    require_projection_lang_item(lang_item: SolverProjectionLangItem): DefId;
    // ty/context/impl_interner.rs:481
    require_trait_lang_item(lang_item: SolverTraitLangItem): DefId;
    // ty/context/impl_interner.rs:485
    require_adt_lang_item(lang_item: SolverAdtLangItem): DefId;
    // ty/context/impl_interner.rs:489
    is_projection_lang_item(def_id: DefId, lang_item: SolverProjectionLangItem): boolean;
    // ty/context/impl_interner.rs:493
    is_trait_lang_item(def_id: DefId, lang_item: SolverTraitLangItem): boolean;
    // ty/context/impl_interner.rs:497
    is_adt_lang_item(def_id: DefId, lang_item: SolverAdtLangItem): boolean;
    // ty/context/impl_interner.rs:501 is_default_trait (impl Interner: the inherent `is_default_trait` (ty/context.rs:927) serves)
    // ty/context/impl_interner.rs:505 is_sizedness_trait (impl Interner: the inherent `is_sizedness_trait` (ty/context.rs:931) serves)
    // ty/context/impl_interner.rs:509
    as_projection_lang_item(def_id: DefId): SolverProjectionLangItem | undefined;
    // ty/context/impl_interner.rs:513
    as_trait_lang_item(def_id: DefId): SolverTraitLangItem | undefined;
    // ty/context/impl_interner.rs:517
    as_adt_lang_item(def_id: DefId): SolverAdtLangItem | undefined;
    // ty/context/impl_interner.rs:521
    associated_type_def_ids(def_id: DefId): Iterable<DefId>;
    // ty/context/impl_interner.rs:530
    ir_for_each_relevant_impl<R>(trait_ref: TraitRef, f: (impl_def_id: DefId) => R, r: VisitorResult<R, unknown>): R;
    // ty/context/impl_interner.rs:542
    for_each_blanket_impl<R>(trait_def_id: DefId, f: (impl_def_id: DefId) => R, r: VisitorResult<R, unknown>): R;
    // ty/context/impl_interner.rs:555
    has_item_definition(def_id: DefId): boolean;
    // ty/context/impl_interner.rs:559
    impl_specializes(impl_def_id: DefId, victim_def_id: DefId): boolean;
    // ty/context/impl_interner.rs:563
    impl_is_default(impl_def_id: DefId): boolean;
    // ty/context/impl_interner.rs:567 impl_trait_ref (impl Interner: the inherent `impl_trait_ref` (ty/mod.rs:2099) serves)
    // ty/context/impl_interner.rs:571 impl_polarity (impl Interner: the inherent `impl_polarity` (ty/mod.rs:2093) serves)
    // ty/context/impl_interner.rs:575
    is_fully_generic_for_reflection(impl_def_id: DefId): boolean;
    // ty/context/impl_interner.rs:579 trait_is_auto (impl Interner: the inherent `trait_is_auto` (ty/mod.rs:1916) serves)
    // ty/context/impl_interner.rs:583
    trait_is_marker(trait_def_id: DefId): boolean;
    // ty/context/impl_interner.rs:587 trait_is_coinductive (impl Interner: the inherent `trait_is_coinductive` (ty/mod.rs:1922) serves)
    // ty/context/impl_interner.rs:591 trait_is_alias (impl Interner: the inherent `trait_is_alias` (ty/mod.rs:1927) serves)
    // ty/context/impl_interner.rs:595
    trait_is_dyn_compatible(trait_def_id: DefId): boolean;
    // ty/context/impl_interner.rs:599
    trait_is_fundamental(def_id: DefId): boolean;
    // ty/context/impl_interner.rs:603
    trait_is_unsafe(trait_def_id: DefId): boolean;
    // ty/context/impl_interner.rs:607 is_impl_trait_in_trait (impl Interner: the inherent `is_impl_trait_in_trait` (ty/context.rs:2847) serves)
    // ty/context/impl_interner.rs:611
    delay_bug(msg: string): ErrorGuaranteed;
    // ty/context/impl_interner.rs:615
    span_delayed_bug(span: Span, msg: string): ErrorGuaranteed;
    // ty/context/impl_interner.rs:619 is_general_coroutine (impl Interner: the inherent `is_general_coroutine` (ty/context.rs:1069) serves)
    // ty/context/impl_interner.rs:623 coroutine_is_async (impl Interner: the inherent `coroutine_is_async` (ty/context.rs:1054) serves)
    // ty/context/impl_interner.rs:627 coroutine_is_gen (impl Interner: the inherent `coroutine_is_gen` (ty/context.rs:1074) serves)
    // ty/context/impl_interner.rs:631 coroutine_is_async_gen (impl Interner: the inherent `coroutine_is_async_gen` (ty/context.rs:1082) serves)
    // ty/context/impl_interner.rs:636 unsizing_params_for_adt (impl Interner: the query `unsizing_params_for_adt` serves)
    // ty/context/impl_interner.rs:640 anonymize_bound_vars (impl Interner: the inherent `anonymize_bound_vars` (ty/fold.rs:329) serves)
    // ty/context/impl_interner.rs:647 opaque_types_defined_by (impl Interner: the query `opaque_types_defined_by` serves)
    // ty/context/impl_interner.rs:651
    opaque_types_and_coroutines_defined_by(defining_anchor: LocalDefId): List<LocalDefId>;
    // ty/context/impl_interner.rs:665
    mk_probe(probe: Probe): Probe;
    // ty/context/impl_interner.rs:669
    mk_canonical_input(data: CanonicalInputData): CanonicalInput;
    // ty/context/impl_interner.rs:672
    ir_evaluate_root_goal_for_proof_tree_raw(canonical_goal: CanonicalInput, root_depth: number): [QueryResult, Probe, RequiredDepth];
    // ty/context/impl_interner.rs:680 item_name (impl Interner: the inherent `item_name` (ty/mod.rs:1710) serves)
    // ty/context/impl_interner.rs:686
    get_anon_re_bounds_lifetime(idx: number, var_idx: number): Region | undefined;
    // ty/context/impl_interner.rs:694
    get_anon_re_canonical_bounds_lifetime(idx: number): Region | undefined;
    // ty/context/impl_interner.rs:698
    get_re_static_lifetime(): Region;
    // ty/context/impl_interner.rs:702
    intern_re_var(rv: RegionVid): Region;
    // ty/context/impl_interner.rs:711 intern_region (impl Interner: the inherent `intern_region` (ty/context.rs:2014 direct_interners!) serves)
    // ty/context/impl_interner.rs:715
    intern_bound_region(debruijn: DebruijnIndex, bound_region: BoundRegion): Region;
    // ty/context/impl_interner.rs:731
    intern_canonical_bound(var_: BoundVar): Region;

    // ---- ty/erase_regions.rs ----
    // ty/erase_regions.rs:23
    erase_and_anonymize_regions<T>(value: T, d_T: TypeFoldable<T>): T;

    // ---- ty/error.rs ----
    // ty/error.rs:236
    string_with_limit<T>(t: T, length_limit: number, ns: Namespace, d_T: Print<T>): string;
    // ty/error.rs:266
    short_string<T>(t: T, path: MutRef<string | undefined>, d_T: Print<T>): string;
    // ty/error.rs:277
    short_string_namespace<T>(t: T, path: MutRef<string | undefined>, namespace: Namespace, d_T: Print<T>): string;
    // ty/error.rs:328
    alias_term_kind_def_path_str(alias: AliasTermKind): string;

    // ---- ty/fold.rs ----
    // ty/fold.rs:208
    instantiate_bound_regions<T>(value: Binder<T>, fld_r: (_0: BoundRegion) => Region, d_T: TypeFoldable<T>): [T, Map<BoundRegion, Region>];
    // ty/fold.rs:224
    instantiate_bound_regions_uncached<T>(value: Binder<T>, replace_regions: (_0: BoundRegion) => Region, d_T: TypeFoldable<T>): T;
    // ty/fold.rs:250
    replace_escaping_bound_vars_uncached<T>(value: T, delegate: BoundVarReplacerDelegate, d_T: TypeFoldable<T>): T;
    // ty/fold.rs:266
    replace_bound_vars_uncached<T>(value: Binder<T>, delegate: BoundVarReplacerDelegate, d_T: TypeFoldable<T>): T;
    // ty/fold.rs:276
    liberate_late_bound_regions<T>(all_outlive_scope: DefId, value: Binder<T>, d_T: TypeFoldable<T>): T;
    // ty/fold.rs:290
    shift_bound_var_indices<T>(bound_vars: number, value: T, d_T: TypeFoldable<T>): T;
    // ty/fold.rs:321
    instantiate_bound_regions_with_erased<T>(value: Binder<T>, d_T: TypeFoldable<T>): T;
    // ty/fold.rs:329
    anonymize_bound_vars<T>(value: Binder<T>, d_T: TypeFoldable<T>): Binder<T>;

    // ---- ty/intrinsic.rs ----
    // ty/intrinsic.rs:17
    is_intrinsic(def_id: DefId, name: Symbol): boolean;

    // ---- ty/layout.rs ----
    // ty/layout.rs:622 data_layout (impl HasDataLayout: not a method)
    // ty/layout.rs:628 target_spec (impl HasTargetSpec: not a method)
    // ty/layout.rs:634 x86_abi_opt (impl HasX86AbiOpt: not a method)
    // ty/layout.rs:644 tcx (impl HasTyCtxt: not a method)

    // ---- ty/normalize_erasing_regions.rs ----
    // ty/normalize_erasing_regions.rs:42
    normalize_erasing_regions<T>(typing_env: TypingEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): T;
    // ty/normalize_erasing_regions.rs:70
    assert_fully_normalized<T>(typing_env: TypingEnv, value: T, d_T: TypeFoldable<T>): void;
    // ty/normalize_erasing_regions.rs:88
    debug_assert_fully_normalized<T>(typing_env: TypingEnv, value: T, d_T: TypeFoldable<T>): void;
    // ty/normalize_erasing_regions.rs:103
    try_normalize_erasing_regions<T>(typing_env: TypingEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): Result<T, NormalizationError>;
    // ty/normalize_erasing_regions.rs:144
    normalize_erasing_late_bound_regions<T>(typing_env: TypingEnv, value: Binder<T>, d_T: TypeFoldable<T>): T;
    // ty/normalize_erasing_regions.rs:162
    instantiate_and_normalize_erasing_regions<T>(param_args: GenericArgs, typing_env: TypingEnv, value: EarlyBinder<T>, d_T: TypeFoldable<T>): T;
    // ty/normalize_erasing_regions.rs:180
    try_instantiate_and_normalize_erasing_regions<T>(param_args: GenericArgs, typing_env: TypingEnv, value: EarlyBinder<T>, d_T: TypeFoldable<T>): Result<T, NormalizationError>;

    // ---- ty/print/pretty.rs ----
    // ty/print/pretty.rs:2171
    def_path_str(def_id: IntoQueryKey<DefId>): string;
    // ty/print/pretty.rs:2177
    def_path_str_with_args(def_id: IntoQueryKey<DefId>, args: readonly GenericArg[]): string;
    // ty/print/pretty.rs:2190
    value_path_str_with_args(def_id: IntoQueryKey<DefId>, args: readonly GenericArg[]): string;

    // ---- ty/trait_def.rs ----
    // ty/trait_def.rs:139
    for_each_relevant_impl<R>(trait_def_id: DefId, self_ty: Ty, f: (impl_def_id: DefId) => R, r: VisitorResult<R, unknown>): R;
    // ty/trait_def.rs:278
    non_blanket_impls_for_ty(trait_def_id: DefId, self_ty: Ty): Iterable<DefId>;
    // ty/trait_def.rs:298
    all_impls(trait_def_id: DefId): Iterable<DefId>;

    // ---- ty/util.rs ----
    // ty/util.rs:136
    type_id_hash(ty: Ty): Hash128;
    // ty/util.rs:148
    res_generics_def_id(res: Res): DefId | undefined;
    // ty/util.rs:189
    type_is_copy_modulo_regions(typing_env: TypingEnv, ty: Ty): boolean;
    // ty/util.rs:201
    type_is_use_cloned_modulo_regions(typing_env: TypingEnv, ty: Ty): boolean;
    // ty/util.rs:216
    struct_tail_for_codegen(ty: Ty, typing_env: TypingEnv): Ty;
    // ty/util.rs:231
    type_has_metadata(ty: Ty, typing_env: TypingEnv): boolean;
    // ty/util.rs:256
    struct_tail_raw(ty: Ty, cause: ObligationCause, normalize: (_0: Unnormalized<Ty>) => Ty, f: () => void): Ty;
    // ty/util.rs:323
    struct_lockstep_tails_for_codegen(source: Ty, target: Ty, typing_env: TypingEnv): [Ty, Ty];
    // ty/util.rs:343
    struct_lockstep_tails_raw(source: Ty, target: Ty, normalize: (_0: Unnormalized<Ty>) => Ty): [Ty, Ty];
    // ty/util.rs:378
    calculate_dtor(adt_did: LocalDefId, validate: (tcx: TyCtxt, def_id: LocalDefId) => Result<null, ErrorGuaranteed>): Destructor | undefined;
    // ty/util.rs:425
    calculate_async_dtor(adt_did: LocalDefId, validate: (tcx: TyCtxt, def_id: LocalDefId) => Result<null, ErrorGuaranteed>): AsyncDestructor | undefined;
    // ty/util.rs:466
    destructor_constraints(def: AdtDef): GenericArg[];
    // ty/util.rs:541
    uses_unique_generic_params(args: readonly GenericArg[], ignore_regions: CheckRegions): Result<null, NotUniqueParam>;
    // ty/util.rs:595
    is_closure_like(def_id: DefId): boolean;
    // ty/util.rs:601
    is_typeck_child(def_id: DefId): boolean;
    // ty/util.rs:639
    is_trait(def_id: DefId): boolean;
    // ty/util.rs:645
    is_trait_alias(def_id: DefId): boolean;
    // ty/util.rs:651
    is_constructor(def_id: DefId): boolean;
    // ty/util.rs:661
    typeck_root_def_id(def_id: DefId): DefId;
    // ty/util.rs:675
    typeck_root_def_id_local(def_id: LocalDefId): LocalDefId;
    // ty/util.rs:693
    closure_env_ty(closure_ty: Ty, closure_kind: ClosureKind, env_region: Region): Ty;
    // ty/util.rs:708
    is_static(def_id: DefId): boolean;
    // ty/util.rs:713
    static_mutability(def_id: DefId): Mutability | undefined;
    // ty/util.rs:722
    is_thread_local_static(def_id: DefId): boolean;
    // ty/util.rs:728
    is_mutable_static(def_id: DefId): boolean;
    // ty/util.rs:735
    needs_thread_local_shim(def_id: DefId): boolean;
    // ty/util.rs:742
    thread_local_ptr_ty(def_id: DefId): Ty;
    // ty/util.rs:755
    static_ptr_ty(def_id: DefId, typing_env: TypingEnv): Ty;
    // ty/util.rs:773
    try_expand_impl_trait_type(def_id: DefId, args: GenericArgs): Result<Ty, Ty>;
    // ty/util.rs:793
    def_descr(def_id: DefId): string;
    // ty/util.rs:798
    def_kind_descr(def_kind: DefKind, def_id: DefId): string;
    // ty/util.rs:848
    def_descr_article(def_id: DefId): string;
    // ty/util.rs:853
    def_kind_descr_article(def_kind: DefKind, def_id: DefId): string;
    // ty/util.rs:874
    is_user_visible_dep(key: CrateNum): boolean;
    // ty/util.rs:913
    expand_free_alias_tys<T>(value: T, d_T: TypeFoldable<T>): T;
    // ty/util.rs:931
    peel_off_free_alias_tys(ty: Ty): Ty;
    // ty/util.rs:954
    opt_alias_variances(kind: AliasTermKind): readonly Variance[] | undefined;

    // ---- ty/visit.rs ----
    // ty/visit.rs:16
    for_each_free_region<T>(value: T, callback: (r: Region) => void, d_T: TypeVisitable<T>): void;
    // ty/visit.rs:28
    all_free_regions_meet<T>(value: T, callback: (r: Region) => boolean, d_T: TypeVisitable<T>): boolean;
    // ty/visit.rs:37
    any_free_region_meets<T>(value: T, callback: (r: Region) => boolean, d_T: TypeVisitable<T>): boolean;
    // ty/visit.rs:114
    collect_constrained_late_bound_regions<T>(value: Binder<T>, d_T: TypeFoldable<T>): KeyedSet<BoundRegionKind>;
    // ty/visit.rs:125
    collect_referenced_late_bound_regions<T>(value: Binder<T>, d_T: TypeFoldable<T>): KeyedSet<BoundRegionKind>;
    // ty/visit.rs:135
    collect_late_bound_regions<T>(value: Binder<T>, just_constrained: boolean, d_T: TypeFoldable<T>): KeyedSet<BoundRegionKind>;
  }
  // statics:
    // ---- ty/pattern.rs ----
    // ty/pattern.rs:68 print (impl IrPrint: print fn)
    // ty/pattern.rs:112 print_debug (impl IrPrint: print fn)

    // ---- ty/print/mod.rs ----
    // ty/print/mod.rs:427 print (impl IrPrint: print fn)
    // ty/print/mod.rs:436 print_debug (impl IrPrint: print fn)
}
