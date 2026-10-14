// Port of compiler/rustc_type_ir/src/inherent.rs (lane tyir-misc).
//
//! Set of traits which are used to emulate the inherent impls that are present in `rustc_middle`.
//! It is customary to glob-import `rustc_type_ir::inherent::*` to bring all of these traits into
//! scope when programming in interner-agnostic settings, and to avoid importing any of these
//! directly elsewhere (i.e. specify the full path for an implementation downstream).
//
// PORT (D3): `I: Interner` is erased, so every trait here has exactly one implementation, rustc_middle's (the
// `Self` type is fixed by the interner.ts header table: `I::Ty` = `Ty`, `I::Tys` = `List<Ty>`, `I::GenericArg` =
// `GenericArg`, ...). The TS interfaces document each trait's shape and let tests check that the rustc_middle
// types conform:
// - a trait's *methods* (`self` receiver) are an interface `<Trait>` whose members are the impl's methods: on the
//   prototype where `Self` is a class (`Ty`, `RawList`, `Predicate`, `Clause`, `DefId`, ...), as companion functions
//   taking `self` first where `Self` is a plain value (`GenericArg` / `Term` unions, `hir::Safety`, data structs;
//   PORTING §8);
// - a trait's *associated fns* (no `self`: `Ty::new_unit(interner)`, `Safety::safe()`, ...) are an interface
//   `<Trait>_static`, the statics of the implementing class / companion (`Ty.new_unit(tcx)`);
// - required items carry their `// rustc:` marker in the interface; provided methods are `// (provided)` lines in
//   the interface and live in `<Trait>_provided` (PORTING §8), the functions generic code calls
//   (`inherent::Ty::is_known_rigid(ty)` -> `Ty_provided.is_known_rigid(ty)`). No rustc_middle impl overrides a
//   provided method, so the provided body is always the one that runs upstream.
// - Supertraits (`Copy + Debug + Hash + Eq + TypeFoldable<I> + ...`) are erased: Debug is a `debug_<T>` fn, the
//   traversal traits are D4 descriptors, `Into`/`From`/`UpcastFrom` are `<T>.from_<X>` / `upcast_from_<X>` fns.
// PORT: an `inherent::Ty` associated fn incompatible with rustc_middle's inherent fn of the same name is
// `ir_<name>` (ty-contract decision 5): `new_param` is `Ty.ir_new_param`.
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import type { Safety as HirSafety } from "../rustc_hir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type {
  AdtDef as MAdtDef,
  Clause as MClause,
  EarlyParamRegion,
  Expr,
  GenericArg as MGenericArg,
  GenericArgs as MGenericArgs,
  List,
  ParamEnv as MParamEnv,
  ParamTy,
  Pattern,
  Predicate as MPredicate,
  Term as MTerm,
  ValTree,
  Value,
} from "../rustc_middle/ty/decls.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { GenericArg as MGenericArgC } from "../rustc_middle/ty/generic_args.ts";
import { type FnInputTys, Term as MTermC, Ty as MTy } from "../rustc_middle/ty/mod.ts";
import type { DefId as MDefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span as MSpan } from "../rustc_span/lib.ts";
import type { Symbol as MSymbol } from "../rustc_span/symbol.ts";
import { unwrap } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import { Binder } from "./binder.ts";
import type {
  BoundTy,
  BoundVar,
  BoundVariableKind,
  ClauseKind,
  ClosureArgs,
  ClosureArgsParts,
  ClosureKind,
  CoroutineArgs,
  CoroutineArgsParts,
  CoroutineClosureArgs,
  CoroutineClosureArgsParts,
  DebruijnIndex,
  EarlyBinder,
  ExistentialPredicate,
  ExistentialProjection,
  ExistentialTraitRef,
  FnSig,
  GenericArgKind,
  HostEffectClause,
  InferTy,
  IsRigid,
  OutlivesClause,
  PlaceholderType,
  PredicateKind,
  ProjectionClause,
  TermKind,
  TraitClause,
  TraitRef,
  TyKind as TyKindT,
  TyVid,
} from "./decls.ts";
import type { CollectAndApply_Result } from "./interner.ts";
import type { FieldInfo } from "./lib.ts";
import type { AdtDestructorKind, SizedTraitKind } from "./solve/mod.ts";
import type { Const, Region } from "./sty/mod.ts";
import { AliasTerm as AliasTermC } from "./term_kind.ts";
import type { AliasTerm, AliasTy as AliasTyT } from "./ty/alias.ts";
import { AliasTy, TyKind } from "./ty_kind.ts";

// ---- Ty ------------------------------------------------------------------------------------------------------------

/** Associated fns of `inherent::Ty` (the statics of rustc_middle's `Ty` class). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:22 Ty
export interface Ty_static {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:35 new_unit
  new_unit(interner: TyCtxt): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:37 new_bool
  new_bool(interner: TyCtxt): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:39 new_u8
  new_u8(interner: TyCtxt): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:41 new_usize
  new_usize(interner: TyCtxt): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:43 new_infer
  new_infer(interner: TyCtxt, var_: InferTy): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:45 new_var
  new_var(interner: TyCtxt, var_: TyVid): MTy;

  // PORT: `ir_new_param` (module comment).
  // rustc: compiler/rustc_type_ir/src/inherent.rs:47 new_param
  ir_new_param(interner: TyCtxt, param: ParamTy): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:49 new_placeholder
  new_placeholder(interner: TyCtxt, param: PlaceholderType): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:51 new_bound
  new_bound(interner: TyCtxt, debruijn: DebruijnIndex, var_: BoundTy): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:53 new_anon_bound
  new_anon_bound(interner: TyCtxt, debruijn: DebruijnIndex, var_: BoundVar): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:55 new_canonical_bound
  new_canonical_bound(interner: TyCtxt, var_: BoundVar): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:57 new_alias
  new_alias(interner: TyCtxt, is_rigid: IsRigid, alias_ty: AliasTyT): MTy;

  // (provided) inherent.rs:59 new_projection_from_args -> Ty_provided.new_projection_from_args
  // (provided) inherent.rs:72 new_projection -> Ty_provided.new_projection

  // rustc: compiler/rustc_type_ir/src/inherent.rs:85 new_error
  new_error(interner: TyCtxt, guar: ErrorGuaranteed): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:87 new_adt
  new_adt(interner: TyCtxt, adt_def: MAdtDef, args: MGenericArgs): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:89 new_foreign
  new_foreign(interner: TyCtxt, def_id: MDefId): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:91 new_dynamic
  new_dynamic(interner: TyCtxt, preds: List<Binder<ExistentialPredicate>>, region: Region): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:93 new_coroutine
  new_coroutine(interner: TyCtxt, def_id: MDefId, args: MGenericArgs): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:95 new_coroutine_closure
  new_coroutine_closure(interner: TyCtxt, def_id: MDefId, args: MGenericArgs): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:101 new_closure
  new_closure(interner: TyCtxt, def_id: MDefId, args: MGenericArgs): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:103 new_coroutine_witness
  new_coroutine_witness(interner: TyCtxt, def_id: MDefId, args: MGenericArgs): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:105 new_coroutine_witness_for_coroutine
  new_coroutine_witness_for_coroutine(interner: TyCtxt, def_id: MDefId, coroutine_args: MGenericArgs): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:111 new_ptr
  new_ptr(interner: TyCtxt, ty: MTy, mutbl: Mutability): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:113 new_ref
  new_ref(interner: TyCtxt, region: Region, ty: MTy, mutbl: Mutability): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:115 new_array_with_const_len
  new_array_with_const_len(interner: TyCtxt, ty: MTy, len: Const): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:117 new_slice
  new_slice(interner: TyCtxt, ty: MTy): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:119 new_tup
  new_tup(interner: TyCtxt, tys: readonly MTy[]): MTy;

  // PORT: `T: CollectAndApply<Self, Self>` is an overload pair (interner.ts `CollectAndApply`).
  // rustc: compiler/rustc_type_ir/src/inherent.rs:121 new_tup_from_iter
  new_tup_from_iter(interner: TyCtxt, iter: Iterable<MTy>): MTy;
  new_tup_from_iter<E>(interner: TyCtxt, iter: Iterable<Result<MTy, E>>, c: CollectAndApply_Result): Result<MTy, E>;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:126 new_fn_def
  new_fn_def(interner: TyCtxt, def_id: MDefId, args: Binder<MGenericArgs>): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:128 new_fn_ptr
  new_fn_ptr(interner: TyCtxt, sig: Binder<FnSig>): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:130 new_pat
  new_pat(interner: TyCtxt, ty: MTy, pat: Pattern): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:132 new_unsafe_binder
  new_unsafe_binder(interner: TyCtxt, ty: Binder<MTy>): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:138 from_closure_kind
  from_closure_kind(interner: TyCtxt, kind: ClosureKind): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:140 from_coroutine_closure_kind
  from_coroutine_closure_kind(interner: TyCtxt, kind: ClosureKind): MTy;
}

/** Methods of `inherent::Ty` (prototype methods of rustc_middle's `Ty`). */
export interface Ty {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:134 tuple_fields
  tuple_fields(): List<MTy>;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:136 to_opt_closure_kind
  to_opt_closure_kind(): ClosureKind | undefined;

  // (provided) inherent.rs:142 is_ty_var -> Ty_provided.is_ty_var
  // (provided) inherent.rs:146 is_ty_error -> Ty_provided.is_ty_error
  // (provided) inherent.rs:150 is_floating_point -> Ty_provided.is_floating_point
  // (provided) inherent.rs:154 is_integral -> Ty_provided.is_integral
  // (provided) inherent.rs:158 is_fn_ptr -> Ty_provided.is_fn_ptr

  /// Checks whether this type is an ADT that has unsafe fields.
  // rustc: compiler/rustc_type_ir/src/inherent.rs:163 has_unsafe_fields
  has_unsafe_fields(): boolean;

  // (provided) inherent.rs:165 fn_sig -> Ty_provided.fn_sig

  // rustc: compiler/rustc_type_ir/src/inherent.rs:169 discriminant_ty
  discriminant_ty(interner: TyCtxt): MTy;

  // (provided) inherent.rs:171 is_known_rigid -> Ty_provided.is_known_rigid
  // (provided) inherent.rs:175 is_guaranteed_unsized_raw -> Ty_provided.is_guaranteed_unsized_raw
}

/** The provided methods of `inherent::Ty` (PORTING §8). */
export const Ty_provided = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:59 new_projection_from_args
  new_projection_from_args(interner: TyCtxt, is_rigid: IsRigid, def_id: MDefId, args: MGenericArgs): MTy {
    return MTy.new_alias(
      interner,
      is_rigid,
      AliasTy.new_from_args(interner, { $: "Projection", def_id }, args),
    );
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:72 new_projection
  new_projection(interner: TyCtxt, is_rigid: IsRigid, def_id: MDefId, args: Iterable<MGenericArg>): MTy {
    return MTy.new_alias(
      interner,
      is_rigid,
      AliasTy.new(interner, { $: "Projection", def_id }, args),
    );
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:142 is_ty_var
  is_ty_var(self: MTy): boolean {
    const k = self.kind();
    return k.$ === "Infer" && k._0.$ === "TyVar";
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:146 is_ty_error
  is_ty_error(self: MTy): boolean {
    return self.kind().$ === "Error";
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:150 is_floating_point
  is_floating_point(self: MTy): boolean {
    const k = self.kind();
    return k.$ === "Float" || (k.$ === "Infer" && k._0.$ === "FloatVar");
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:154 is_integral
  is_integral(self: MTy): boolean {
    const k = self.kind();
    return (k.$ === "Infer" && k._0.$ === "IntVar") || k.$ === "Int" || k.$ === "Uint";
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:158 is_fn_ptr
  is_fn_ptr(self: MTy): boolean {
    return self.kind().$ === "FnPtr";
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:165 fn_sig
  fn_sig(self: MTy, interner: TyCtxt): Binder<FnSig> {
    return TyKind.fn_sig(self.kind(), interner);
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:171 is_known_rigid
  is_known_rigid(self: MTy): boolean {
    return TyKind.is_known_rigid(self.kind());
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:175 is_guaranteed_unsized_raw
  is_guaranteed_unsized_raw(self: MTy): boolean {
    const k: TyKindT = self.kind();
    switch (k.$) {
      case "Dynamic":
      case "Slice":
      case "Str":
        return true;
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Adt":
      case "Foreign":
      case "Array":
      case "Pat":
      case "RawPtr":
      case "Ref":
      case "FnDef":
      case "FnPtr":
      case "UnsafeBinder":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "Never":
      case "Tuple":
      case "Alias":
      case "Param":
      case "Bound":
      case "Placeholder":
      case "Infer":
      case "Error":
        return false;
    }
  },
};

// ---- Tys -----------------------------------------------------------------------------------------------------------

/** `inherent::Tys` (prototype methods of `List<Ty>`, a `RawList`). `SliceLike<Item = I::Ty>`: a `readonly Ty[]`. */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:209 Tys
export interface Tys {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:212 inputs
  inputs(this: List<MTy>): FnInputTys;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:214 output
  output(this: List<MTy>): MTy;
}

// ---- Safety --------------------------------------------------------------------------------------------------------

/** Associated fns of `inherent::Safety` (`I::Safety` = `hir::Safety`, a string enum; companion functions). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:218 Safety
export interface Safety_static {
  /// The `safe` safety mode.
  // rustc: compiler/rustc_type_ir/src/inherent.rs:220 safe
  safe(): HirSafety;

  /// The `unsafe` safety mode.
  // rustc: compiler/rustc_type_ir/src/inherent.rs:223 unsafe_mode
  unsafe_mode(): HirSafety;
}

/** Methods of `inherent::Safety`, as companion functions taking `self` first. */
export interface Safety {
  /// Is the safety mode `Safe`?
  // rustc: compiler/rustc_type_ir/src/inherent.rs:226 is_safe
  is_safe(self: HirSafety): boolean;

  /// The string prefix for this safety mode.
  // rustc: compiler/rustc_type_ir/src/inherent.rs:229 prefix_str
  prefix_str(self: HirSafety): string;
}

// ---- ValueConst, ExprConst, GenericsOf -----------------------------------------------------------------------------

/** `inherent::ValueConst` (`I::ValueConst` = `ty::Value`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:233 ValueConst
export interface ValueConst {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:234 ty
  ty(self: Value): MTy;
  // rustc: compiler/rustc_type_ir/src/inherent.rs:235 valtree
  valtree(self: Value): ValTree;
}

/** `inherent::ExprConst` (`I::ExprConst` = `ty::Expr`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:239 ExprConst
export interface ExprConst {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:240 args
  args(self: Expr): MGenericArgs;
}

/** `inherent::GenericsOf` (`I::GenericsOf` = `&Generics`, prototype methods). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:244 GenericsOf
export interface GenericsOf {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:245 count
  count(this: Generics): number;
  // rustc: compiler/rustc_type_ir/src/inherent.rs:246 param_region_def_id
  param_region_def_id(this: Generics, interner: TyCtxt, ebr: EarlyParamRegion): MDefId;
}

// ---- GenericArg ----------------------------------------------------------------------------------------------------

/**
 * `inherent::GenericArg` (`I::GenericArg` = `GenericArg`, the `Ty | Region | Const` union): no required methods;
 * `IntoKind` is `GenericArg.kind(arg)` (rustc_middle generic_args.ts), the `From`s are the identity (D3).
 */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:250 GenericArg
export interface GenericArg {
  // (provided) inherent.rs:263 as_term -> GenericArg_provided.as_term
  // (provided) inherent.rs:271 as_type -> GenericArg_provided.as_type
  // (provided) inherent.rs:275 expect_ty -> GenericArg_provided.expect_ty
  // (provided) inherent.rs:279 as_const -> GenericArg_provided.as_const
  // (provided) inherent.rs:283 expect_const -> GenericArg_provided.expect_const
  // (provided) inherent.rs:287 as_region -> GenericArg_provided.as_region
  // (provided) inherent.rs:291 expect_region -> GenericArg_provided.expect_region
  // (provided) inherent.rs:295 is_non_region_infer -> GenericArg_provided.is_non_region_infer
  readonly __inherent_GenericArg?: never;
}

/** The provided methods of `inherent::GenericArg` (PORTING §8). */
export const GenericArg_provided = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:263 as_term
  as_term(self: MGenericArg): MTerm | undefined {
    const k = MGenericArgC.kind(self);
    switch (k.$) {
      case "Lifetime":
        return undefined;
      case "Type":
        return k._0;
      case "Const":
        return k._0;
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:271 as_type
  as_type(self: MGenericArg): MTy | undefined {
    const k = MGenericArgC.kind(self);
    if (k.$ === "Type") {
      return k._0;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:275 expect_ty
  expect_ty(self: MGenericArg): MTy {
    return unwrap(GenericArg_provided.as_type(self), "expected a type");
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:279 as_const
  as_const(self: MGenericArg): Const | undefined {
    const k = MGenericArgC.kind(self);
    if (k.$ === "Const") {
      return k._0;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:283 expect_const
  expect_const(self: MGenericArg): Const {
    return unwrap(GenericArg_provided.as_const(self), "expected a const");
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:287 as_region
  as_region(self: MGenericArg): Region | undefined {
    const k = MGenericArgC.kind(self);
    if (k.$ === "Lifetime") {
      return k._0;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:291 expect_region
  expect_region(self: MGenericArg): Region {
    return unwrap(GenericArg_provided.as_region(self), "expected a const");
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:295 is_non_region_infer
  is_non_region_infer(self: MGenericArg): boolean {
    const k = MGenericArgC.kind(self);
    switch (k.$) {
      case "Lifetime":
        return false;
      case "Type":
        return Ty_provided.is_ty_var(k._0);
      case "Const":
        return k._0.is_ct_var();
    }
  },
};

// ---- Term ----------------------------------------------------------------------------------------------------------

/**
 * `inherent::Term` (`I::Term` = `Term`, the `Ty | Const` union): no required methods; `IntoKind` is
 * `Term.kind(t)` (rustc_middle ty/mod.ts), `From<Const>` is the identity (D3).
 */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:305 Term
export interface Term {
  // (provided) inherent.rs:315 as_type -> Term_provided.as_type
  // (provided) inherent.rs:319 expect_ty -> Term_provided.expect_ty
  // (provided) inherent.rs:323 as_const -> Term_provided.as_const
  // (provided) inherent.rs:327 expect_const -> Term_provided.expect_const
  // (provided) inherent.rs:331 is_infer -> Term_provided.is_infer
  // (provided) inherent.rs:338 is_error -> Term_provided.is_error
  // (provided) inherent.rs:345 to_alias_term -> Term_provided.to_alias_term
  // (provided) inherent.rs:358 is_non_rigid_alias -> Term_provided.is_non_rigid_alias
  readonly __inherent_Term?: never;
}

/** The provided methods of `inherent::Term` (PORTING §8). */
export const Term_provided = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:315 as_type
  as_type(self: MTerm): MTy | undefined {
    const k = MTermC.kind(self);
    if (k.$ === "Ty") {
      return k._0;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:319 expect_ty
  expect_ty(self: MTerm): MTy {
    return unwrap(Term_provided.as_type(self), "expected a type, but found a const");
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:323 as_const
  as_const(self: MTerm): Const | undefined {
    const k = MTermC.kind(self);
    if (k.$ === "Const") {
      return k._0;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:327 expect_const
  expect_const(self: MTerm): Const {
    return unwrap(Term_provided.as_const(self), "expected a const, but found a type");
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:331 is_infer
  is_infer(self: MTerm): boolean {
    const k = MTermC.kind(self);
    switch (k.$) {
      case "Ty":
        return Ty_provided.is_ty_var(k._0);
      case "Const":
        return k._0.is_ct_var();
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:338 is_error
  is_error(self: MTerm): boolean {
    const k = MTermC.kind(self);
    switch (k.$) {
      case "Ty":
        return Ty_provided.is_ty_error(k._0);
      case "Const":
        return k._0.is_ct_error();
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:345 to_alias_term
  to_alias_term(self: MTerm): AliasTerm | undefined {
    const k = MTermC.kind(self);
    switch (k.$) {
      case "Ty": {
        const tk = k._0.kind();
        switch (tk.$) {
          case "Alias":
            return AliasTermC.from_AliasTy(tk._1);
          default:
            return undefined;
        }
      }
      case "Const": {
        const ck = k._0.kind();
        switch (ck.$) {
          case "Alias":
            return AliasTermC.from_AliasConst(ck._1);
          default:
            return undefined;
        }
      }
    }
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:358 is_non_rigid_alias
  is_non_rigid_alias(self: MTerm): boolean {
    const k = MTermC.kind(self);
    switch (k.$) {
      case "Ty": {
        const tk = k._0.kind();
        switch (tk.$) {
          case "Alias":
            return tk._0 === "No";
          default:
            return false;
        }
      }
      case "Const": {
        const ck = k._0.kind();
        switch (ck.$) {
          case "Alias":
            return ck._0 === "No";
          default:
            return false;
        }
      }
    }
  },
};

// ---- GenericArgs ---------------------------------------------------------------------------------------------------

/** Associated fns of `inherent::GenericArgs` (`I::GenericArgs` = `GenericArgs`, a `RawList`; statics of `RawList`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:373 GenericArgs
export interface GenericArgs_static {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:389 identity_for_item
  identity_for_item(interner: TyCtxt, def_id: MDefId): MGenericArgs;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:391 extend_with_error
  extend_with_error(interner: TyCtxt, def_id: MDefId, original_args: readonly MGenericArg[]): MGenericArgs;
}

/** Methods of `inherent::GenericArgs` (prototype methods of `RawList`, typed `this: GenericArgs`). */
export interface GenericArgs {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:376 rebase_onto
  rebase_onto(this: MGenericArgs, interner: TyCtxt, source_def_id: MDefId, target: MGenericArgs): MGenericArgs;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:383 type_at
  type_at(this: MGenericArgs, i: number): MTy;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:385 region_at
  region_at(this: MGenericArgs, i: number): Region;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:387 const_at
  const_at(this: MGenericArgs, i: number): Const;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:397 split_closure_args
  split_closure_args(this: MGenericArgs): ClosureArgsParts;
  // rustc: compiler/rustc_type_ir/src/inherent.rs:398 split_coroutine_closure_args
  split_coroutine_closure_args(this: MGenericArgs): CoroutineClosureArgsParts;
  // rustc: compiler/rustc_type_ir/src/inherent.rs:399 split_coroutine_args
  split_coroutine_args(this: MGenericArgs): CoroutineArgsParts;

  // (provided) inherent.rs:401 as_closure -> GenericArgs_provided.as_closure
  // (provided) inherent.rs:404 as_coroutine_closure -> GenericArgs_provided.as_coroutine_closure
  // (provided) inherent.rs:407 as_coroutine -> GenericArgs_provided.as_coroutine
}

/** The provided methods of `inherent::GenericArgs` (PORTING §8). */
export const GenericArgs_provided = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:401 as_closure
  as_closure(self: MGenericArgs): ClosureArgs {
    return { args: self };
  },
  // rustc: compiler/rustc_type_ir/src/inherent.rs:404 as_coroutine_closure
  as_coroutine_closure(self: MGenericArgs): CoroutineClosureArgs {
    return { args: self };
  },
  // rustc: compiler/rustc_type_ir/src/inherent.rs:407 as_coroutine
  as_coroutine(self: MGenericArgs): CoroutineArgs {
    return { args: self };
  },
};

// ---- Predicate, Clause, Clauses ------------------------------------------------------------------------------------

/**
 * `inherent::Predicate` (prototype methods of rustc_middle's `Predicate`). `IntoKind` is `kind()`; the
 * `UpcastFrom` supertraits are the `upcast_from_<X>` fns of rustc_middle ty/predicate.ts; `Elaboratable` is
 * elaborate.rs's (lane tyir-relate).
 */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:413 Predicate
export interface Predicate {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:436 as_clause
  as_clause(): MClause | undefined;

  // (provided) inherent.rs:438 allow_normalization -> Predicate_provided.allow_normalization
}

/** The provided methods of `inherent::Predicate` (PORTING §8). */
export const Predicate_provided = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:438 allow_normalization
  allow_normalization(self: MPredicate): boolean {
    // PORT: `skip_binder()` is the field read `value` (binder.rs:113).
    const kind: PredicateKind = self.kind().value;
    switch (kind.$) {
      case "Clause": {
        const c: ClauseKind = kind._0;
        switch (c.$) {
          case "WellFormed":
            return false;
          case "Trait":
          case "HostEffect":
          case "RegionOutlives":
          case "TypeOutlives":
          case "Projection":
          case "ConstArgHasType":
          case "UnstableFeature":
          case "ConstEvaluatable":
            return true;
        }
        break;
      }
      case "DynCompatible":
      case "Subtype":
      case "Coerce":
      case "ConstEquate":
      case "NormalizesTo":
      case "Ambiguous":
        return true;
    }
  },
};

/** `inherent::Clause` (prototype methods of rustc_middle's `Clause`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:460 Clause
export interface Clause {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:477 as_predicate
  as_predicate(): MPredicate;

  // (provided) inherent.rs:479 as_type_outlives_clause -> Clause_provided.as_type_outlives_clause
  // (provided) inherent.rs:491 as_trait_clause -> Clause_provided.as_trait_clause
  // (provided) inherent.rs:499 as_host_effect_clause -> Clause_provided.as_host_effect_clause
  // (provided) inherent.rs:507 as_projection_clause -> Clause_provided.as_projection_clause

  /// Performs a instantiation suitable for going from a
  /// poly-trait-ref to supertraits that must hold if that
  /// poly-trait-ref holds. This is slightly different from a normal
  /// instantiation in terms of what happens with bound regions.
  // rustc: compiler/rustc_type_ir/src/inherent.rs:519 instantiate_supertrait
  instantiate_supertrait(cx: TyCtxt, trait_ref: Binder<TraitRef>): MClause;
}

/** The provided methods of `inherent::Clause` (PORTING §8). */
export const Clause_provided = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:479 as_type_outlives_clause
  as_type_outlives_clause(self: MClause): Binder<OutlivesClause<MTy>> | undefined {
    return Binder.transpose(
      Binder.map_bound(self.kind(), (clause: ClauseKind) => {
        if (clause.$ === "TypeOutlives") {
          return clause._0;
        } else {
          return undefined;
        }
      }),
    );
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:491 as_trait_clause
  as_trait_clause(self: MClause): Binder<TraitClause> | undefined {
    return Binder.transpose(
      Binder.map_bound_no_validate_bound_vars(self.kind(), (clause: ClauseKind) => {
        if (clause.$ === "Trait") {
          return clause._0;
        } else {
          return undefined;
        }
      }),
    );
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:499 as_host_effect_clause
  as_host_effect_clause(self: MClause): Binder<HostEffectClause> | undefined {
    return Binder.transpose(
      Binder.map_bound_no_validate_bound_vars(self.kind(), (clause: ClauseKind) => {
        if (clause.$ === "HostEffect") {
          return clause._0;
        } else {
          return undefined;
        }
      }),
    );
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:507 as_projection_clause
  as_projection_clause(self: MClause): Binder<ProjectionClause> | undefined {
    return Binder.transpose(
      Binder.map_bound_no_validate_bound_vars(self.kind(), (clause: ClauseKind) => {
        if (clause.$ === "Projection") {
          return clause._0;
        } else {
          return undefined;
        }
      }),
    );
  },
};

/**
 * `inherent::Clauses` (`I::Clauses` = `Clauses`, a `ListWithCachedTypeInfo<Clause>`): only supertraits
 * (`SliceLike<Item = I::Clause>`: a `readonly Clause[]`; `Flags`; the traversal descriptors).
 */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:523 Clauses
export interface Clauses {
  readonly __inherent_Clauses?: never;
}

// ---- IntoKind, ParamLike, AdtDef, ParamEnv, Features, DefId --------------------------------------------------------

/** `inherent::IntoKind`: the `kind()` method of the interned types (`Ty`, `Region`, `Const`, `Predicate`, ...). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:536 IntoKind
export interface IntoKind<Kind> {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:539 kind
  kind(): Kind;
}

/** `inherent::ParamLike` (`ParamTy`, `ParamConst`, `EarlyParamRegion`: data structs, companion functions). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:543 ParamLike
export interface ParamLike<P> {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:544 index
  index(self: P): number;
}

/** `inherent::AdtDef` (prototype methods of rustc_middle's `AdtDef`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:548 AdtDef
export interface AdtDef {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:549 def_id
  def_id(): MDefId;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:551 is_struct
  is_struct(): boolean;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:553 is_packed
  is_packed(): boolean;

  /// Returns the type of the struct tail.
  ///
  /// Expects the `AdtDef` to be a struct. If it is not, then this will panic.
  // rustc: compiler/rustc_type_ir/src/inherent.rs:558 struct_tail_ty
  struct_tail_ty(interner: TyCtxt): EarlyBinder<MTy> | undefined;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:560 is_phantom_data
  is_phantom_data(): boolean;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:562 is_manually_drop
  is_manually_drop(): boolean;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:564 field_representing_type_info
  field_representing_type_info(interner: TyCtxt, args: MGenericArgs): FieldInfo | undefined;

  // FIXME: perhaps use `all_fields` and expose `FieldDef`.
  // rustc: compiler/rustc_type_ir/src/inherent.rs:571 all_field_tys
  all_field_tys(interner: TyCtxt): EarlyBinder<Iterable<MTy>>;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:573 sizedness_constraint
  sizedness_constraint(interner: TyCtxt, sizedness: SizedTraitKind): EarlyBinder<MTy> | undefined;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:579 is_fundamental
  is_fundamental(): boolean;

  // PORT: renamed `ir_destructor`: rustc_middle's `AdtDef` has an incompatible inherent `destructor` (ty-contract
  // decision 5).
  // rustc: compiler/rustc_type_ir/src/inherent.rs:581 destructor
  ir_destructor(interner: TyCtxt): AdtDestructorKind | undefined;
}

/** `inherent::ParamEnv` (prototype methods of rustc_middle's `ParamEnv`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:585 ParamEnv
export interface ParamEnv {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:586 caller_bounds
  caller_bounds(this: MParamEnv): Iterable<MClause>;
}

/** `inherent::Features` (`I::Features` = `&Features`, prototype methods). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:590 Features
export interface Features {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:591 generic_const_exprs
  generic_const_exprs(): boolean;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:593 gca_const_items
  gca_const_items(): boolean;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:595 coroutine_clone
  coroutine_clone(): boolean;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:597 feature_bound_holds_in_crate
  feature_bound_holds_in_crate(symbol: MSymbol): boolean;
}

/** `inherent::DefId` (`I::DefId` and every `I::*Id` = `DefId`, prototype methods; `Local` = `LocalDefId`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:601 DefId
export interface DefId<Local = LocalDefId> {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:604 is_local
  is_local(): boolean;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:606 as_local
  as_local(): Local | undefined;
}

/**
 * `inherent::SpecificDefId` (+ its blanket impl, inherent.rs:614): `DefId + Into<I::DefId> + TryFrom<I::DefId>`.
 * PORT (D3): every specific id is `DefId` itself, so the conversions are the identity.
 */
export type SpecificDefId<Local = LocalDefId> = DefId<Local>;

// ---- BoundExistentialPredicates, Span, OpaqueTypeStorageEntries, BoundVarKinds -------------------------------------

/**
 * `inherent::BoundExistentialPredicates` (`I::BoundExistentialPredicates` = `List<PolyExistentialPredicate>`;
 * prototype methods of `RawList`, typed `this:`).
 */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:623 BoundExistentialPredicates
export interface BoundExistentialPredicates {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:626 principal_def_id
  principal_def_id(this: List<Binder<ExistentialPredicate>>): MDefId | undefined;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:628 principal
  principal(this: List<Binder<ExistentialPredicate>>): Binder<ExistentialTraitRef> | undefined;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:630 auto_traits
  auto_traits(this: List<Binder<ExistentialPredicate>>): Iterable<MDefId>;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:632 projection_bounds
  projection_bounds(this: List<Binder<ExistentialPredicate>>): Iterable<Binder<ExistentialProjection>>;
}

/** Associated fns of `inherent::Span` (`I::Span` = `Span`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:638 Span
export interface Span_static {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:639 dummy
  dummy(): MSpan;
}

/** `inherent::OpaqueTypeStorageEntries` (rustc_infer's `OpaqueTypeStorageEntries`, opaque_types/table.rs). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:643 OpaqueTypeStorageEntries
export interface OpaqueTypeStorageEntries {
  /// Whether the number of opaques has changed in a way that necessitates
  /// reevaluating a goal. For now, this is only when the number of non-duplicated
  /// entries changed.
  // rustc: compiler/rustc_type_ir/src/inherent.rs:647 needs_reevaluation
  needs_reevaluation(canonicalized: number): boolean;
}

/** Associated fns of `inherent::BoundVarKinds` (`I::BoundVarKinds` = `List<BoundVariableKind>`; statics of `RawList`). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:650 BoundVarKinds
export interface BoundVarKinds_static {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:653 from_vars
  from_vars(cx: TyCtxt, iter: Iterable<BoundVariableKind>): List<BoundVariableKind>;
}

// ---- SliceLike -----------------------------------------------------------------------------------------------------

/**
 * `inherent::SliceLike`. PORT: every implementor in rustc (`&[T]`, `&[T; N]`, `&S`, `&RawList<H, T>`) is a
 * `readonly T[]` here (PORTING §5; `RawList` extends `Array`), so `as_slice` is the identity and the impls are
 * descriptor objects over arrays; generic code calls `SliceLike_provided.<m>(xs)`.
 */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:656 SliceLike
export interface SliceLike<S, Item> {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:660 iter
  iter(self: S): IterableIterator<Item>;

  // rustc: compiler/rustc_type_ir/src/inherent.rs:662 as_slice
  as_slice(self: S): readonly Item[];

  // (provided) inherent.rs:664 get -> SliceLike_provided.get
  // (provided) inherent.rs:668 len -> SliceLike_provided.len
  // (provided) inherent.rs:672 is_empty -> SliceLike_provided.is_empty
  // (provided) inherent.rs:676 contains -> SliceLike_provided.contains
  // (provided) inherent.rs:683 to_vec -> SliceLike_provided.to_vec
  // (provided) inherent.rs:687 last -> SliceLike_provided.last
  // (provided) inherent.rs:691 split_last -> SliceLike_provided.split_last
}

/** The provided methods of `inherent::SliceLike` (PORTING §8), over the array every implementor is. */
export const SliceLike_provided = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:664 get
  get<T>(self: readonly T[], idx: number): T | undefined {
    return idx < self.length ? self[idx] : undefined;
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:668 len
  len<T>(self: readonly T[]): number {
    return self.length;
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:672 is_empty
  is_empty<T>(self: readonly T[]): boolean {
    return SliceLike_provided.len(self) === 0;
  },

  /**
   * PORT: `Self::Item: PartialEq`: `===` for the interned items (`Ty`, `GenericArg`, `Clause`, ...); items with a
   * structural `PartialEq` (`Binder<..>`, `BoundVariableKind`) pass their `_eq` as `eq`.
   */
  // rustc: compiler/rustc_type_ir/src/inherent.rs:676 contains
  contains<T>(self: readonly T[], t: T, eq: (a: T, b: T) => boolean = (a, b) => a === b): boolean {
    for (const x of self) {
      if (eq(x, t)) return true;
    }
    return false;
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:683 to_vec
  to_vec<T>(self: readonly T[]): T[] {
    return self.slice();
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:687 last
  last<T>(self: readonly T[]): T | undefined {
    return self.length === 0 ? undefined : self[self.length - 1];
  },

  // rustc: compiler/rustc_type_ir/src/inherent.rs:691 split_last
  split_last<T>(self: readonly T[]): [T, readonly T[]] | undefined {
    if (self.length === 0) return undefined;
    return [self[self.length - 1]!, self.slice(0, self.length - 1)];
  },
};

/** `impl<'a, T: Copy> SliceLike for &'a [T]`. */
export const SliceLike_for_slice: SliceLike<readonly unknown[], unknown> = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:700 iter
  iter(self) {
    return self[Symbol.iterator]();
  },
  // rustc: compiler/rustc_type_ir/src/inherent.rs:704 as_slice
  as_slice(self) {
    return self;
  },
};

/** `impl<'a, T: Copy, const N: usize> SliceLike for &'a [T; N]`. */
export const SliceLike_for_array: SliceLike<readonly unknown[], unknown> = {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:713 iter
  iter(self) {
    return self[Symbol.iterator]();
  },
  // rustc: compiler/rustc_type_ir/src/inherent.rs:717 as_slice
  as_slice(self) {
    return self;
  },
};

/** `impl<'a, S: SliceLike> SliceLike for &'a S`: forwards to `S`'s impl (`&S` is `S` here). */
export function SliceLike_for_ref<S, Item>(d_S: SliceLike<S, Item>): SliceLike<S, Item> {
  return {
    // rustc: compiler/rustc_type_ir/src/inherent.rs:726 iter
    iter(self) {
      return d_S.iter(self);
    },
    // rustc: compiler/rustc_type_ir/src/inherent.rs:730 as_slice
    as_slice(self) {
      return d_S.as_slice(self);
    },
  };
}

// ---- Symbol, RegionName, DefIdGetter -------------------------------------------------------------------------------

/**
 * `inherent::Symbol` (`I::Symbol` = `Symbol`): three associated consts, `kw::UnderscoreLifetime`,
 * `kw::StaticLifetime`, `sym::anon` (impl in rustc_middle ty/sty.rs:2190).
 */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:736 Symbol
export interface Symbol_static {
  readonly KW_UNDERSCORE_LIFETIME: MSymbol;
  readonly KW_STATIC_LIFETIME: MSymbol;
  readonly SYM_ANON: MSymbol;
}

/** `inherent::RegionName` (`EarlyParamRegion`, `LateParamRegionKind`, `BoundRegionKind`: companion functions). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:742 RegionName
export interface RegionName<R> {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:743 get_name
  get_name(self: R, interner: TyCtxt): MSymbol | undefined;
  // rustc: compiler/rustc_type_ir/src/inherent.rs:744 is_named
  is_named(self: R, interner: TyCtxt): boolean;
}

/** `inherent::DefIdGetter` (`LateParamRegionKind`, `BoundRegionKind`: companion functions). */
// rustc-trait: compiler/rustc_type_ir/src/inherent.rs:747 DefIdGetter
export interface DefIdGetter<R> {
  // rustc: compiler/rustc_type_ir/src/inherent.rs:748 get_def_id
  get_def_id(self: R): MDefId | undefined;
}
