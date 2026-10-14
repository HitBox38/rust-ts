// Port of compiler/rustc_type_ir/src/relate.rs (lane tyir-relate). The types with their derived Debug impls are
// generated into relate.gen.ts (set rustc_ty of tools/codegen/types.ts); this file holds the traits, fns and impls.
//
// PORT (D3/D4):
// - `I: Interner` is erased; `relation.cx()` is rustc_middle's `TyCtxt` (it serves both the `Interner` methods and the
//   inherent `Ty::new_*` constructors).
// - `trait TypeRelation<I>` is the interface `TypeRelation`, implemented by the relation classes; its provided method
//   lives in `TypeRelation_provided` (PORTING §8). Methods generic over `T: Relate<I>` take the `Relate<T>` descriptor
//   last (`relation.relate(a, b, d)`, `relate_with_variance(v, info, a, b, d)`, `binders(a, b, d)`).
// - `trait Relate<I>: TypeFoldable<I> + PartialEq + Copy` is the D4 descriptor `Relate<T>`: the `TypeFoldable` impl
//   fns, the `PartialEq` impl (`eq`) and the `relate` fn. One const per impl, named `relate_<T>`; the generic impl for
//   `Binder<T>` is the function `relate_Binder(d)`.
// - `impl FnOnce(..)` parameters are closures; iterator chains collected through `mk_*_from_iter` are lazy generators
//   passed with `CollectAndApply_Result`, so relating stops at the first `Err` exactly as the `?` in
//   `CollectAndApply for Result` does.
// - Derived `PartialEq` of non-interned values (`AliasTyKind`, `Placeholder`, `FnSig`, ...) is `intern_key` equality
//   (rust_ts/intern_key.ts: the canonical form of the derived `Hash`+`Eq`); interned values compare with `===`.
// - `#[instrument]` / `trace!` / `debug!` are dropped (tracing is off in the oracle); `debug_assert*!` stay comments.
// - `pub mod combine; pub mod solver_relating;`: the submodules are imported directly (`./relate/combine.ts`,
//   `./relate/solver_relating.ts`); this module does not re-export them, because they import this module (an ESM
//   cycle through `export *` would evaluate them before the descriptors below exist).
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { Mutability } from "../rustc_ast_ir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef, BoundExistentialPredicates, Pattern, Value } from "../rustc_middle/ty/decls.ts";
import type { Expr } from "../rustc_middle/ty/consts/kind.ts";
import { fold_with_Expr, try_fold_with_Expr, visit_with_Expr } from "../rustc_middle/ty/consts/kind.ts";
import { debug_GenericArg, fold_GenericArg, fold_GenericArgs, GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { bug } from "../rustc_span/macros.ts";
import { fold_Term, fold_with_Ty, Term, try_fold_with_Ty, Ty, visit_with_Ty } from "../rustc_middle/ty/mod.ts";
import {
  fold_with_BoundExistentialPredicates,
  fold_with_Pattern,
  try_fold_with_BoundExistentialPredicates,
  try_fold_with_Pattern,
  visit_with_BoundExistentialPredicates,
  visit_with_Pattern,
} from "../rustc_middle/ty/structural_impls.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unported, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Binder, fold_with_Binder, try_fold_with_Binder, visit_with_Binder } from "./binder.ts";
import { AliasConst, type AliasConstKind, fold_with_AliasConstKind, try_fold_with_AliasConstKind, visit_with_AliasConstKind, type ValTreeKind } from "./const_kind.ts";
import { ExpectedFound, TypeError } from "./error.ts";
import type { TypeFoldable } from "./fold.ts";
import { CollectAndApply_Result, type Interner } from "./interner.ts";
import { Variance } from "./lib.ts";
import {
  type ExistentialProjection,
  type ExistentialTraitRef,
  fold_with_ExistentialProjection,
  fold_with_ExistentialTraitRef,
  fold_with_TraitClause,
  fold_with_TraitRef,
  type TraitClause,
  type TraitRef,
  try_fold_with_ExistentialProjection,
  try_fold_with_ExistentialTraitRef,
  try_fold_with_TraitClause,
  try_fold_with_TraitRef,
  visit_with_ExistentialProjection,
  visit_with_ExistentialTraitRef,
  visit_with_TraitClause,
  visit_with_TraitRef,
} from "./predicate.ts";
import * as gen from "./relate.gen.ts";
import { Const, debug_Const, fold_Const } from "./sty/consts.ts";
import { fold_Region, type Region } from "./sty/mod.ts";
import { AliasTerm, AliasTermKind, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "./term_kind.ts";
import { type AliasConst as AliasConstT, type AliasTerm as AliasTermT, type AliasTy as AliasTyT, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "./ty/alias.ts";
import {
  AliasTy,
  type AliasTyKind,
  FnSig,
  fold_with_AliasTyKind,
  fold_with_FnSig,
  IsRigid,
  PolyFnSigTys,
  try_fold_with_AliasTyKind,
  try_fold_with_FnSig,
  UnsafeBinderInner_deref,
  visit_with_AliasTyKind,
  visit_with_FnSig,
} from "./ty_kind.ts";

export * from "./relate.gen.ts";

// ---- PORT stand-ins for fns of other files that are not ported yet ------------------------------------------------
// Not markers. One-liners keep their upstream body; the rest call `unported`. Root repoints them at the real ports.

/** PORT: stand-in for `Variance::xform` (lib.rs:306, not ported yet). */
export function Variance_xform(self: Variance, v: Variance): Variance {
  // Figure 1, column 1.
  if (self === "Covariant" && v === "Covariant") return Variance.Covariant;
  if (self === "Covariant" && v === "Contravariant") return Variance.Contravariant;
  if (self === "Covariant" && v === "Invariant") return Variance.Invariant;
  if (self === "Covariant" && v === "Bivariant") return Variance.Bivariant;

  // Figure 1, column 2.
  if (self === "Contravariant" && v === "Covariant") return Variance.Contravariant;
  if (self === "Contravariant" && v === "Contravariant") return Variance.Covariant;
  if (self === "Contravariant" && v === "Invariant") return Variance.Invariant;
  if (self === "Contravariant" && v === "Bivariant") return Variance.Bivariant;

  // Figure 1, column 3.
  if (self === "Invariant") return Variance.Invariant;

  // Figure 1, column 4.
  return Variance.Bivariant;
}

/** PORT: stand-in for `inherent::AdtDef::def_id` (rustc_middle ty/adt.rs, lane ty-adt-assoc; `AdtDef` is pending). */
function AdtDef_def_id(_self: AdtDef): DefId {
  return unported("rustc_middle::ty::AdtDef: inherent::AdtDef::def_id (AdtDef is pending)");
}

/** PORT: stand-in for `inherent::ValueConst::valtree` + `ValTree::kind` (rustc_middle ty/consts/valtree.rs; `ty::Value`
 *  is pending). */
function Value_valtree_kind(_self: Value): ValTreeKind {
  return unported("rustc_middle::ty::Value: valtree().kind() (ty::Value is pending)");
}

/** PORT: stand-in for `TraitRef::new_from_args` (predicate.rs:124, lane tyir-misc). */
function TraitRef_new_from_args(tcx: TyCtxt, trait_def_id: DefId, args: GenericArgs): TraitRef {
  interner(tcx).debug_assert_args_compatible(trait_def_id, args);
  return { def_id: trait_def_id, args, _use_trait_ref_new_instead: null };
}

/** PORT: stand-in for `ExistentialTraitRef::new_from_args` (predicate.rs:400, lane tyir-misc). */
function ExistentialTraitRef_new_from_args(tcx: TyCtxt, trait_def_id: DefId, args: GenericArgs): ExistentialTraitRef {
  interner(tcx).debug_assert_existential_args_compatible(trait_def_id, args);
  return { def_id: trait_def_id, args, _use_existential_trait_ref_new_instead: null };
}

/** PORT: stand-in for `ExistentialProjection::new_from_args` (predicate.rs:469, lane tyir-misc). */
function ExistentialProjection_new_from_args(tcx: TyCtxt, def_id: DefId, args: GenericArgs, term: Term): ExistentialProjection {
  interner(tcx).debug_assert_existential_args_compatible(def_id, args);
  return { def_id, args, term, use_existential_projection_new_instead: null };
}

/** PORT: stand-in for `ExistentialProjection::alias_kind` (predicate.rs:501, lane tyir-misc). */
function ExistentialProjection_alias_kind(self: ExistentialProjection): AliasTermKind {
  const k = Term.kind(self.term);
  switch (k.$) {
    case "Ty":
      return { $: "ProjectionTy", def_id: self.def_id };
    case "Const":
      return { $: "ProjectionConst", def_id: self.def_id };
  }
}

/** PORT: `I = TyCtxt` seen through its `impl Interner`. The `TyCtxt` class type does not declare the 14 inherent
 *  methods that serve `Interner` yet (lane ty-ctxt; at runtime they are `unported` placeholders), so it is not
 *  assignable to `Interner`: calls of `Interner` methods go through this view. */
export function interner(tcx: TyCtxt): Interner {
  return tcx as unknown as Interner;
}

/** PORT: derived `PartialEq` of a non-interned value (header). */
function eq_by_key<T>(a: T, b: T): boolean {
  return intern_key(a) === intern_key(b);
}

/** PORT: `PartialEq` of an interned value (pointer equality). */
function eq_interned<T>(a: T, b: T): boolean {
  return a === b;
}

// ---- PORT stand-ins: the `Relate` impls of other files (rustc_middle ty/relate.rs; sty/mod.rs:281 and
// sty/consts.rs:240, whose declared homes are `relate_Region` / `relate_Const` in sty/{mod,consts}.ts). Not markers. --

/** PORT: stand-in for `impl Relate for Ty` (rustc_middle ty/relate.rs:12): `relation.tys(a, b)`. */
export const relate_Ty: Relate<Ty> = {
  visit_with: visit_with_Ty,
  try_fold_with: try_fold_with_Ty,
  fold_with: fold_with_Ty,
  eq: eq_interned,
  relate(relation, a, b) {
    return relation.tys(a, b);
  },
};

/** PORT: stand-in for `impl Relate for Region` (sty/mod.rs:281): `relation.regions(a, b)`. */
export const relate_Region: Relate<Region> = {
  ...fold_Region,
  eq: eq_interned,
  relate(relation, a, b) {
    return relation.regions(a, b);
  },
};

/** PORT: stand-in for `impl Relate for Const` (sty/consts.rs:240): `relation.consts(a, b)`. */
export const relate_Const: Relate<Const> = {
  visit_with: fold_Const.visit_with,
  try_fold_with: fold_Const.try_fold_with,
  fold_with: fold_Const.fold_with,
  eq: eq_interned,
  relate(relation, a, b) {
    return relation.consts(a, b);
  },
};

/** PORT: stand-in for `impl Relate for GenericArgsRef` (rustc_middle ty/relate.rs:92). */
export const relate_GenericArgs: Relate<GenericArgs> = {
  ...fold_GenericArgs,
  eq: eq_interned,
  relate(relation, a, b) {
    return relate_args_invariantly(relation, a, b);
  },
};

/** PORT: stand-in for `impl Relate for GenericArg` (rustc_middle ty/relate.rs:127). */
export const relate_GenericArg: Relate<GenericArg> = {
  ...fold_GenericArg,
  eq: eq_interned,
  relate(relation, a, b) {
    const ak = GenericArg.kind(a);
    const bk = GenericArg.kind(b);
    if (ak.$ === "Lifetime" && bk.$ === "Lifetime") {
      const r = relation.relate(ak._0, bk._0, relate_Region);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    }
    if (ak.$ === "Type" && bk.$ === "Type") {
      const r = relation.relate(ak._0, bk._0, relate_Ty);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    }
    if (ak.$ === "Const" && bk.$ === "Const") {
      const r = relation.relate(ak._0, bk._0, relate_Const);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    }
    return bug(`impossible case reached: can't relate: ${debug_GenericArg(a, PLAIN)} with ${debug_GenericArg(b, PLAIN)}`);
  },
};

/** PORT: stand-in for `impl Relate for Term` (rustc_middle ty/relate.rs:148). */
export const relate_Term: Relate<Term> = {
  ...fold_Term,
  eq: eq_interned,
  relate(relation, a, b) {
    const ak = Term.kind(a);
    const bk = Term.kind(b);
    if (ak.$ === "Ty" && bk.$ === "Ty") {
      const r = relation.relate(ak._0, bk._0, relate_Ty);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    }
    if (ak.$ === "Const" && bk.$ === "Const") {
      const r = relation.relate(ak._0, bk._0, relate_Const);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    }
    return Err(TypeError.Mismatch);
  },
};

/** PORT: stand-in for `impl Relate for Pattern` (rustc_middle ty/relate.rs:22; `Pattern` is pending). */
export const relate_Pattern: Relate<Pattern> = {
  visit_with: visit_with_Pattern,
  try_fold_with: try_fold_with_Pattern,
  fold_with: fold_with_Pattern,
  eq: eq_interned,
  relate(_relation, _a, _b) {
    return unported("rustc_middle::ty::relate: Relate for Pattern (Pattern is pending)");
  },
};

/** PORT: stand-in for `impl Relate for &List<PolyExistentialPredicate>` (rustc_middle ty/relate.rs:56; needs
 *  `mk_poly_existential_predicates_from_iter`, itself unported). */
export const relate_BoundExistentialPredicates: Relate<BoundExistentialPredicates> = {
  visit_with: visit_with_BoundExistentialPredicates,
  try_fold_with: try_fold_with_BoundExistentialPredicates,
  fold_with: fold_with_BoundExistentialPredicates,
  eq: eq_interned,
  relate(_relation, _a, _b) {
    return unported("rustc_middle::ty::relate: Relate for &List<PolyExistentialPredicate>");
  },
};

/** PORT: stand-in for `impl Relate for ty::Expr` (rustc_middle ty/relate.rs:102). */
export const relate_Expr: Relate<Expr> = {
  visit_with: visit_with_Expr,
  try_fold_with: try_fold_with_Expr,
  fold_with: fold_with_Expr,
  eq: eq_by_key,
  relate(_relation, _a, _b) {
    return unported("rustc_middle::ty::relate: Relate for ty::Expr");
  },
};

// ---- relate.rs ----------------------------------------------------------------------------------------------------

export type RelateResult<T> = gen.RelateResult<T>;

/// Extra information about why we ended up with a particular variance.
/// This is only used to add more information to error messages, and
/// has no effect on soundness. While choosing the 'wrong' `VarianceDiagInfo`
/// may lead to confusing notes in error messages, it will never cause
/// a miscompilation or unsoundness.
///
/// When in doubt, use `VarianceDiagInfo::default()`
// PORT: `#[derive_where(Default)]` picks `None`: `VarianceDiagInfo::default()` is `VarianceDiagInfo.None`.
export type VarianceDiagInfo = gen.VarianceDiagInfo;
export const VarianceDiagInfo = {
  ...gen.VarianceDiagInfo,

  /// Mirrors `Variance::xform` - used to 'combine' the existing
  /// and new `VarianceDiagInfo`s when our variance changes.
  // rustc: compiler/rustc_type_ir/src/relate.rs:47 xform
  xform(self: VarianceDiagInfo, other: VarianceDiagInfo): VarianceDiagInfo {
    // For now, just use the first `VarianceDiagInfo::Invariant` that we see
    switch (self.$) {
      case "None":
        return other;
      case "Invariant":
        return self;
    }
  },
};

// rustc-trait: compiler/rustc_type_ir/src/relate.rs:56 TypeRelation
export interface TypeRelation {
  // rustc: compiler/rustc_type_ir/src/relate.rs:57 cx
  cx(): TyCtxt;

  /// Generic relation routine suitable for most anything.
  // (provided) relate.rs:60 relate -> TypeRelation_provided.relate
  relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;

  // rustc: compiler/rustc_type_ir/src/relate.rs:64 relate_ty_args
  relate_ty_args(a_ty: Ty, b_ty: Ty, ty_def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, mk: (args: GenericArgs) => Ty): RelateResult<Ty>;

  /// Switch variance for the purpose of relating `a` and `b`.
  // rustc: compiler/rustc_type_ir/src/relate.rs:75 relate_with_variance
  relate_with_variance<T>(variance: Variance, info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;

  // Overridable relations. You shouldn't typically call these
  // directly, instead call `relate()`, which in turn calls
  // these. This is both more uniform but also allows us to add
  // additional hooks for other types in the future if needed
  // without making older code, which called `relate`, obsolete.

  // rustc: compiler/rustc_type_ir/src/relate.rs:89 tys
  tys(a: Ty, b: Ty): RelateResult<Ty>;

  // rustc: compiler/rustc_type_ir/src/relate.rs:91 regions
  regions(a: Region, b: Region): RelateResult<Region>;

  // rustc: compiler/rustc_type_ir/src/relate.rs:93 consts
  consts(a: Const, b: Const): RelateResult<Const>;

  // rustc: compiler/rustc_type_ir/src/relate.rs:95 binders
  binders<T>(a: Binder<T>, b: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;
}

/** PORT: the provided methods of `TypeRelation` (PORTING §8). */
export const TypeRelation_provided = {
  /// Generic relation routine suitable for most anything.
  // rustc: compiler/rustc_type_ir/src/relate.rs:60 relate
  relate<T>(self: TypeRelation, a: T, b: T, d: Relate<T>): RelateResult<T> {
    return d.relate(self, a, b);
  },
};

// PORT (D4): the descriptor of `T: Relate<I>`; the supertraits are its `TypeFoldable` impl fns and `eq` (`PartialEq`).
// rustc-trait: compiler/rustc_type_ir/src/relate.rs:104 Relate
export interface Relate<T> extends TypeFoldable<T> {
  /** `PartialEq::eq` (supertrait). */
  eq(a: T, b: T): boolean;
  // rustc: compiler/rustc_type_ir/src/relate.rs:105 relate
  relate(relation: TypeRelation, a: T, b: T): RelateResult<T>;
}

///////////////////////////////////////////////////////////////////////////
// Relate impls

// rustc: compiler/rustc_type_ir/src/relate.rs:112 relate_args_invariantly
export function relate_args_invariantly(relation: TypeRelation, a_arg: GenericArgs, b_arg: GenericArgs): RelateResult<GenericArgs> {
  const args = (function* () {
    const n = Math.min(a_arg.length, b_arg.length);
    for (let i = 0; i < n; i++) {
      yield relation.relate_with_variance(Variance.Invariant, VarianceDiagInfo.None, a_arg[i], b_arg[i], relate_GenericArg);
    }
  })();
  return relation.cx().mk_args_from_iter(args, CollectAndApply_Result);
}

// rustc: compiler/rustc_type_ir/src/relate.rs:122 relate_args_with_variances
export function relate_args_with_variances(relation: TypeRelation, variances: readonly Variance[], a_args: GenericArgs, b_args: GenericArgs): RelateResult<GenericArgs> {
  const cx = relation.cx();
  const args = (function* () {
    const n = Math.min(a_args.length, b_args.length);
    for (let i = 0; i < n; i++) {
      const variance = unwrap(variances[i]);
      yield relation.relate_with_variance(variance, VarianceDiagInfo.None, a_args[i], b_args[i], relate_GenericArg);
    }
  })();
  // FIXME: We can probably try to reuse `a_args` here if it did not change.
  return cx.mk_args_from_iter(args, CollectAndApply_Result);
}

export const relate_FnSig: Relate<FnSig> = {
  visit_with: visit_with_FnSig,
  try_fold_with: try_fold_with_FnSig,
  fold_with: fold_with_FnSig,
  eq: eq_by_key,
  // rustc: compiler/rustc_type_ir/src/relate.rs:138 relate
  relate(relation, a, b) {
    const cx = relation.cx();

    if (FnSig.c_variadic(a) !== FnSig.c_variadic(b)) {
      return Err({ $: "VariadicMismatch", _0: ExpectedFound.new(FnSig.c_variadic(a), FnSig.c_variadic(b)) });
    }

    if (FnSig.safety(a) !== FnSig.safety(b)) {
      return Err({ $: "SafetyMismatch", _0: ExpectedFound.new(FnSig.safety(a), FnSig.safety(b)) });
    }

    if (!ExternAbi.eq(FnSig.abi(a), FnSig.abi(b))) {
      return Err({ $: "AbiMismatch", _0: ExpectedFound.new(FnSig.abi(a), FnSig.abi(b)) });
    }

    if (FnSig.splatted(a) !== FnSig.splatted(b)) {
      return Err({ $: "SplatMismatch", _0: ExpectedFound.new(FnSig.splatted(a), FnSig.splatted(b)) });
    }

    const a_inputs = FnSig.inputs(a);
    const b_inputs = FnSig.inputs(b);
    if (a_inputs.length !== b_inputs.length) {
      return Err(TypeError.ArgCount);
    }

    // PORT: the `zip(..).map(..).chain(once(..)).map(..).enumerate().map(..)` chain as one lazy generator; the
    // `once` operand (`a.output()`, `b.output()`) is evaluated when the chain is built.
    const a_output = FnSig.output(a);
    const b_output = FnSig.output(b);
    const inputs_and_output = (function* (): Generator<RelateResult<Ty>> {
      const n = a_inputs.length + 1;
      for (let i = 0; i < n; i++) {
        const is_output = i === a_inputs.length;
        const [a_, b_] = is_output ? [a_output, b_output] : [a_inputs[i], b_inputs[i]];
        let r: RelateResult<Ty>;
        if (is_output) {
          r = relation.relate(a_, b_, relate_Ty);
        } else {
          r = relation.relate_with_variance(Variance.Contravariant, VarianceDiagInfo.None, a_, b_, relate_Ty);
        }
        if (r.$ === "Err" && (r._0.$ === "Sorts" || r._0.$ === "ArgumentSorts")) {
          yield Err({ $: "ArgumentSorts", _0: r._0._0, _1: i });
        } else if (r.$ === "Err" && (r._0.$ === "Mutability" || r._0.$ === "ArgumentMutability")) {
          yield Err({ $: "ArgumentMutability", _0: i });
        } else {
          yield r;
        }
      }
    })();
    const list = cx.mk_type_list_from_iter(inputs_and_output, CollectAndApply_Result);
    if (list.$ === "Err") return list;
    return Ok({
      inputs_and_output: list._0,
      fn_sig_kind: a.fn_sig_kind,
    });
  },
};

export const relate_AliasTy: Relate<AliasTyT> = {
  visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasTyKind),
  try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, try_fold_with_AliasTyKind),
  fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasTyKind),
  eq: eq_by_key,
  // rustc: compiler/rustc_type_ir/src/relate.rs:203 relate
  relate(relation, a, b) {
    if (intern_key(a.kind) !== intern_key(b.kind)) {
      return Err({ $: "ProjectionMismatched", _0: ExpectedFound.new(AliasTermKind.from_AliasTyKind(a.kind), AliasTermKind.from_AliasTyKind(b.kind)) });
    } else {
      const cx = relation.cx();
      let args: GenericArgs;
      const variances = cx.opt_alias_variances(AliasTermKind.from_AliasTyKind(a.kind));
      if (variances !== undefined) {
        const r = relate_args_with_variances(relation, variances, a.args, b.args);
        if (r.$ === "Err") return r;
        args = r._0;
      } else {
        const r = relate_args_invariantly(relation, a.args, b.args);
        if (r.$ === "Err") return r;
        args = r._0;
      }
      return Ok(AliasTy.new_from_args(relation.cx(), a.kind, args));
    }
  },
};

export const relate_AliasConst: Relate<AliasConstT> = {
  visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasConstKind),
  try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, try_fold_with_AliasConstKind),
  fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasConstKind),
  eq: eq_by_key,
  // rustc: compiler/rustc_type_ir/src/relate.rs:223 relate
  relate(relation, a, b) {
    const cx = relation.cx();
    if (intern_key(a.kind) !== intern_key(b.kind)) {
      return Err({
        $: "ConstMismatch",
        _0: ExpectedFound.new(Const.new_alias(cx, IsRigid.yes_if_next_solver(interner(cx)), a), Const.new_alias(cx, IsRigid.yes_if_next_solver(interner(cx)), b)),
      });
    } else {
      // FIXME(mgca): remove this
      // debug_assert_eq!(a.type_of(cx).skip_norm_wip(), b.type_of(cx).skip_norm_wip());

      const args = relate_args_invariantly(relation, a.args, b.args);
      if (args.$ === "Err") return args;

      return Ok(AliasConst.new(cx, a.kind, args._0));
    }
  },
};

export const relate_AliasTerm: Relate<AliasTermT> = {
  visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasTermKind),
  try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, try_fold_with_AliasTermKind),
  fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasTermKind),
  eq: eq_by_key,
  // rustc: compiler/rustc_type_ir/src/relate.rs:246 relate
  relate(relation, a, b) {
    if (intern_key(a.kind) !== intern_key(b.kind)) {
      return Err({ $: "ProjectionMismatched", _0: ExpectedFound.new(a.kind, b.kind) });
    } else {
      let args: RelateResult<GenericArgs>;
      const kind = a.kind;
      switch (kind.$) {
        case "OpaqueTy":
          args = relate_args_with_variances(relation, interner(relation.cx()).variances_of(kind.def_id), a.args, b.args);
          break;
        case "ProjectionTy":
        case "FreeConst":
        case "FreeTy":
        case "InherentTy":
        case "InherentConstSelf":
        case "InherentConstImpl":
        case "AnonConst":
        case "ProjectionConst":
          args = relate_args_invariantly(relation, a.args, b.args);
          break;
      }
      if (args.$ === "Err") return args;
      return Ok(AliasTerm.with_args(a, relation.cx(), args._0));
    }
  },
};

export const relate_ExistentialProjection: Relate<ExistentialProjection> = {
  visit_with: visit_with_ExistentialProjection,
  try_fold_with: try_fold_with_ExistentialProjection,
  fold_with: fold_with_ExistentialProjection,
  eq: eq_by_key,
  // rustc: compiler/rustc_type_ir/src/relate.rs:278 relate
  relate(relation, a, b) {
    if (!DefId_eq(a.def_id, b.def_id)) {
      return Err({ $: "ProjectionMismatched", _0: ExpectedFound.new(ExistentialProjection_alias_kind(a), ExistentialProjection_alias_kind(b)) });
    } else {
      const term = relation.relate_with_variance(Variance.Invariant, VarianceDiagInfo.None, a.term, b.term, relate_Term);
      if (term.$ === "Err") return term;
      const args = relation.relate_with_variance(Variance.Invariant, VarianceDiagInfo.None, a.args, b.args, relate_GenericArgs);
      if (args.$ === "Err") return args;
      return Ok(ExistentialProjection_new_from_args(relation.cx(), a.def_id, args._0, term._0));
    }
  },
};

export const relate_TraitRef: Relate<TraitRef> = {
  visit_with: visit_with_TraitRef,
  try_fold_with: try_fold_with_TraitRef,
  fold_with: fold_with_TraitRef,
  eq: eq_by_key,
  // rustc: compiler/rustc_type_ir/src/relate.rs:304 relate
  relate(relation, a, b) {
    // Different traits cannot be related.
    if (!DefId_eq(a.def_id, b.def_id)) {
      return Err({
        $: "Traits",
        _0: (() => {
          const a_ = a.def_id;
          const b_ = b.def_id;
          return ExpectedFound.new(a_, b_);
        })(),
      });
    } else {
      const args = relate_args_invariantly(relation, a.args, b.args);
      if (args.$ === "Err") return args;
      return Ok(TraitRef_new_from_args(relation.cx(), a.def_id, args._0));
    }
  },
};

export const relate_ExistentialTraitRef: Relate<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
  eq: eq_by_key,
  // rustc: compiler/rustc_type_ir/src/relate.rs:324 relate
  relate(relation, a, b) {
    // Different traits cannot be related.
    if (!DefId_eq(a.def_id, b.def_id)) {
      return Err({
        $: "Traits",
        _0: (() => {
          const a_ = a.def_id;
          const b_ = b.def_id;
          return ExpectedFound.new(a_, b_);
        })(),
      });
    } else {
      const args = relate_args_invariantly(relation, a.args, b.args);
      if (args.$ === "Err") return args;
      return Ok(ExistentialTraitRef_new_from_args(relation.cx(), a.def_id, args._0));
    }
  },
};

/// Relates `a` and `b` structurally, calling the relation for all nested values.
/// Any semantic equality, e.g. of projections, and inference variables have to be
/// handled by the caller.
// #[instrument(level = "trace", skip(relation), ret)]
// rustc: compiler/rustc_type_ir/src/relate.rs:347 structurally_relate_tys
export function structurally_relate_tys(relation: TypeRelation, a: Ty, b: Ty): RelateResult<Ty> {
  const cx = relation.cx();
  const ak = a.kind();
  const bk = b.kind();
  if (ak.$ === "Infer" || bk.$ === "Infer") {
    // The caller should handle these cases!
    return panic("var types encountered in structurally_relate_tys");
  }

  if (ak.$ === "Bound" || bk.$ === "Bound") {
    return panic("bound types encountered in structurally_relate_tys");
  }

  if (ak.$ === "Error") return Ok(Ty.new_error(cx, ak._0));
  if (bk.$ === "Error") return Ok(Ty.new_error(cx, bk._0));

  if ((ak.$ === "Never" || ak.$ === "Char" || ak.$ === "Bool" || ak.$ === "Int" || ak.$ === "Uint" || ak.$ === "Float" || ak.$ === "Str") && a === b) {
    return Ok(a);
  }

  if (ak.$ === "Param" && bk.$ === "Param" && ak._0.index === bk._0.index) {
    // FIXME: Put this back
    //debug_assert_eq!(a_p.name(), b_p.name(), "param types with same index differ in name");
    return Ok(a);
  }

  if (ak.$ === "Placeholder" && bk.$ === "Placeholder" && eq_by_key(ak._0, bk._0)) return Ok(a);

  if (ak.$ === "Adt" && bk.$ === "Adt" && ak._0 === bk._0) {
    const a_def = ak._0;
    if (ak._1.length === 0) {
      return Ok(a);
    } else {
      return relation.relate_ty_args(a, b, AdtDef_def_id(a_def), ak._1, bk._1, (args) => Ty.new_adt(cx, a_def, args));
    }
  }

  if (ak.$ === "Foreign" && bk.$ === "Foreign" && DefId_eq(ak._0, bk._0)) return Ok(Ty.new_foreign(cx, ak._0));

  if (ak.$ === "Dynamic" && bk.$ === "Dynamic") {
    const obj = relation.relate(ak._0, bk._0, relate_BoundExistentialPredicates);
    if (obj.$ === "Err") return obj;
    const region = relation.relate(ak._1, bk._1, relate_Region);
    if (region.$ === "Err") return region;
    return Ok(Ty.new_dynamic(cx, obj._0, region._0));
  }

  if (ak.$ === "Coroutine" && bk.$ === "Coroutine" && DefId_eq(ak._0, bk._0)) {
    // All Coroutine types with the same id represent
    // the (anonymous) type of the same coroutine expression. So
    // all of their regions should be equated.
    const args = relate_args_invariantly(relation, ak._1, bk._1);
    if (args.$ === "Err") return args;
    return Ok(Ty.new_coroutine(cx, ak._0, args._0));
  }

  if (ak.$ === "CoroutineWitness" && bk.$ === "CoroutineWitness" && DefId_eq(ak._0, bk._0)) {
    // All CoroutineWitness types with the same id represent
    // the (anonymous) type of the same coroutine expression. So
    // all of their regions should be equated.
    const args = relate_args_invariantly(relation, ak._1, bk._1);
    if (args.$ === "Err") return args;
    return Ok(Ty.new_coroutine_witness(cx, ak._0, args._0));
  }

  if (ak.$ === "Closure" && bk.$ === "Closure" && DefId_eq(ak._0, bk._0)) {
    // All Closure types with the same id represent
    // the (anonymous) type of the same closure expression. So
    // all of their regions should be equated.
    const args = relate_args_invariantly(relation, ak._1, bk._1);
    if (args.$ === "Err") return args;
    return Ok(Ty.new_closure(cx, ak._0, args._0));
  }

  if (ak.$ === "CoroutineClosure" && bk.$ === "CoroutineClosure" && DefId_eq(ak._0, bk._0)) {
    const args = relate_args_invariantly(relation, ak._1, bk._1);
    if (args.$ === "Err") return args;
    return Ok(Ty.new_coroutine_closure(cx, ak._0, args._0));
  }

  if (ak.$ === "RawPtr" && bk.$ === "RawPtr") {
    const [a_ty, a_mutbl] = [ak._0, ak._1];
    const [b_ty, b_mutbl] = [bk._0, bk._1];
    if (a_mutbl !== b_mutbl) {
      return Err(TypeError.Mutability);
    }

    let variance: Variance;
    let info: VarianceDiagInfo;
    switch (a_mutbl) {
      case Mutability.Not:
        [variance, info] = [Variance.Covariant, VarianceDiagInfo.None];
        break;
      case Mutability.Mut:
        [variance, info] = [Variance.Invariant, { $: "Invariant", ty: a, param_index: 0 }];
        break;
    }

    const ty = relation.relate_with_variance(variance, info, a_ty, b_ty, relate_Ty);
    if (ty.$ === "Err") return ty;

    return Ok(Ty.new_ptr(cx, ty._0, a_mutbl));
  }

  if (ak.$ === "Ref" && bk.$ === "Ref") {
    const [a_r, a_ty, a_mutbl] = [ak._0, ak._1, ak._2];
    const [b_r, b_ty, b_mutbl] = [bk._0, bk._1, bk._2];
    if (a_mutbl !== b_mutbl) {
      return Err(TypeError.Mutability);
    }

    let variance: Variance;
    let info: VarianceDiagInfo;
    switch (a_mutbl) {
      case Mutability.Not:
        [variance, info] = [Variance.Covariant, VarianceDiagInfo.None];
        break;
      case Mutability.Mut:
        [variance, info] = [Variance.Invariant, { $: "Invariant", ty: a, param_index: 0 }];
        break;
    }

    const r = relation.relate(a_r, b_r, relate_Region);
    if (r.$ === "Err") return r;
    const ty = relation.relate_with_variance(variance, info, a_ty, b_ty, relate_Ty);
    if (ty.$ === "Err") return ty;

    return Ok(Ty.new_ref(cx, r._0, ty._0, a_mutbl));
  }

  if (ak.$ === "Array" && bk.$ === "Array") {
    const [a_t, sz_a] = [ak._0, ak._1];
    const [b_t, sz_b] = [bk._0, bk._1];
    const t = relation.relate(a_t, b_t, relate_Ty);
    if (t.$ === "Err") return t;
    const sz = relation.relate(sz_a, sz_b, relate_Const);
    if (sz.$ === "Ok") return Ok(Ty.new_array_with_const_len(cx, t._0, sz._0));
    if (sz._0.$ === "ConstMismatch") {
      return Err({ $: "ArraySize", _0: ExpectedFound.new(sz_a, sz_b) });
    }
    return Err(sz._0);
  }

  if (ak.$ === "Slice" && bk.$ === "Slice") {
    const t = relation.relate(ak._0, bk._0, relate_Ty);
    if (t.$ === "Err") return t;
    return Ok(Ty.new_slice(cx, t._0));
  }

  if (ak.$ === "Tuple" && bk.$ === "Tuple") {
    const as_ = ak._0;
    const bs = bk._0;
    if (as_.length === bs.length) {
      const tys = (function* () {
        for (let i = 0; i < as_.length; i++) yield relation.relate(as_[i], bs[i], relate_Ty);
      })();
      const t = Ty.new_tup_from_iter(cx, tys, CollectAndApply_Result);
      if (t.$ === "Err") return t;
      return Ok(t._0);
    } else if (!(as_.length === 0 || bs.length === 0)) {
      return Err({ $: "TupleSize", _0: ExpectedFound.new(as_.length, bs.length) });
    } else {
      return Err({ $: "Sorts", _0: ExpectedFound.new(a, b) });
    }
  }

  if (ak.$ === "FnDef" && bk.$ === "FnDef" && DefId_eq(ak._0, bk._0)) {
    const [a_def_id, a_args] = [ak._0, ak._1];
    const b_args = bk._1;
    if (Binder.skip_binder(a_args).length === 0) {
      return Ok(a);
    } else {
      // FIXME: this behavior is wrong; relations with binders needs fixing.
      //        need to relate the bound vars first.
      const x = relation.relate_ty_args(a, b, a_def_id, Binder.skip_binder(a_args), Binder.skip_binder(b_args), (args) =>
        Ty.new_fn_def(cx, a_def_id, Binder.rebind(a_args, args)),
      );
      return x;
    }
  }

  if (ak.$ === "FnPtr" && bk.$ === "FnPtr") {
    const fty = relation.relate(PolyFnSigTys.with(ak._0, ak._1), PolyFnSigTys.with(bk._0, bk._1), relate_Binder(relate_FnSig));
    if (fty.$ === "Err") return fty;
    return Ok(Ty.new_fn_ptr(cx, fty._0));
  }

  // Alias tend to mostly already be handled downstream due to normalization.
  if (ak.$ === "Alias" && bk.$ === "Alias") {
    const [is_rigid_a, alias_a] = [ak._0, ak._1];
    const alias_b = bk._1;
    // Users shouldn't know about this so the mismatch should be caught
    // during development rather than presented as type error.
    // debug_assert_eq!(is_rigid_a, is_rigid_b, "{a:?} != {b:?}");
    const alias_ty = relation.relate(alias_a, alias_b, relate_AliasTy);
    if (alias_ty.$ === "Err") return alias_ty;
    return Ok(Ty.new_alias(cx, is_rigid_a, alias_ty._0));
  }

  if (ak.$ === "Pat" && bk.$ === "Pat") {
    const ty = relation.relate(ak._0, bk._0, relate_Ty);
    if (ty.$ === "Err") return ty;
    const pat = relation.relate(ak._1, bk._1, relate_Pattern);
    if (pat.$ === "Err") return pat;
    return Ok(Ty.new_pat(cx, ty._0, pat._0));
  }

  if (ak.$ === "UnsafeBinder" && bk.$ === "UnsafeBinder") {
    const r = relation.binders(UnsafeBinderInner_deref(ak._0), UnsafeBinderInner_deref(bk._0), relate_Ty);
    if (r.$ === "Err") return r;
    return Ok(Ty.new_unsafe_binder(cx, r._0));
  }

  return Err({ $: "Sorts", _0: ExpectedFound.new(a, b) });
}

/// Relates `a` and `b` structurally, calling the relation for all nested values.
/// Any semantic equality, e.g. of alias consts, and inference variables have
/// to be handled by the caller.
///
/// FIXME: This is not totally structural, which probably should be fixed.
/// See the HACKs below.
// rustc: compiler/rustc_type_ir/src/relate.rs:552 structurally_relate_consts
export function structurally_relate_consts(relation: TypeRelation, a: Const, b: Const): RelateResult<Const> {
  // trace!("structurally_relate_consts::<{}>(a = {:?}, b = {:?})", std::any::type_name::<R>(), a, b);
  const cx = relation.cx();

  if (cx.features().generic_const_exprs()) {
    a = cx.expand_abstract_consts(a, fold_Const);
    b = cx.expand_abstract_consts(b, fold_Const);
  }

  // trace!("structurally_relate_consts::<{}>(normed_a = {:?}, normed_b = {:?})", std::any::type_name::<R>(), a, b);

  // Currently, the values that can be unified are primitive types,
  // and those that derive both `PartialEq` and `Eq`, corresponding
  // to structural-match types.
  const ak = a.kind();
  const bk = b.kind();
  let is_match: boolean;
  if (ak.$ === "Infer" || bk.$ === "Infer") {
    // The caller should handle these cases!
    return panic(`var types encountered in structurally_relate_consts: ${debug_Const(a, PLAIN)} ${debug_Const(b, PLAIN)}`);
  } else if (ak.$ === "Error") {
    return Ok(a);
  } else if (bk.$ === "Error") {
    return Ok(b);
  } else if (ak.$ === "Param" && bk.$ === "Param" && ak._0.index === bk._0.index) {
    // FIXME: Put this back
    // debug_assert_eq!(a_p.name, b_p.name, "param types with same index differ in name");
    is_match = true;
  } else if (ak.$ === "Placeholder" && bk.$ === "Placeholder") {
    is_match = eq_by_key(ak._0, bk._0);
  } else if (ak.$ === "Value" && bk.$ === "Value") {
    const av = Value_valtree_kind(ak._0);
    const bv = Value_valtree_kind(bk._0);
    if (av.$ === "Leaf" && bv.$ === "Leaf") {
      is_match = eq_by_key(av._0, bv._0);
    } else if (av.$ === "Branch" && bv.$ === "Branch" && av._0.length === bv._0.length) {
      const branches_a = av._0;
      const branches_b = bv._0;
      is_match = true;
      for (let i = 0; i < branches_a.length; i++) {
        if (relation.relate(branches_a[i], branches_b[i], relate_Const).$ !== "Ok") {
          is_match = false;
          break;
        }
      }
    } else {
      is_match = false;
    }
  }

  // While this is slightly incorrect, it shouldn't matter for `min_const_generics`
  // and is the better alternative to waiting until `generic_const_exprs` can
  // be stabilized.
  else if (ak.$ === "Alias" && bk.$ === "Alias") {
    // Users shouldn't know about this so the mismatch should be caught
    // during development rather than presented as type error.
    // debug_assert_eq!(is_rigid_a, is_rigid_b, "{a:?} != {b:?}");
    const r = relation.relate(ak._1, bk._1, relate_AliasConst);
    if (r.$ === "Err") return r;
    return Ok(Const.new_alias(cx, ak._0, r._0));
  } else if (ak.$ === "Expr" && bk.$ === "Expr") {
    const expr = relation.relate(ak._0, bk._0, relate_Expr);
    if (expr.$ === "Err") return expr;
    return Ok(Const.new_expr(cx, expr._0));
  } else {
    is_match = false;
  }
  if (is_match) {
    return Ok(a);
  } else {
    return Err({ $: "ConstMismatch", _0: ExpectedFound.new(a, b) });
  }
}

/** The generic `impl<I, T: Relate<I>> Relate<I> for ty::Binder<I, T>` (a function from `T`'s descriptor). */
export function relate_Binder<T>(d: Relate<T>): Relate<Binder<T>> {
  return {
    visit_with: (self, visitor) => visit_with_Binder(self, visitor, d.visit_with),
    try_fold_with: (self, folder) => try_fold_with_Binder(self, folder, d.try_fold_with),
    fold_with: (self, folder) => fold_with_Binder(self, folder, d.fold_with),
    // PORT: derived `PartialEq` of `Binder` (binder.rs): the value by `T`'s `eq`, the interned `bound_vars` by pointer.
    eq: (a, b) => d.eq(a.value, b.value) && a.bound_vars === b.bound_vars,
    // rustc: compiler/rustc_type_ir/src/relate.rs:631 relate
    relate(relation, a, b) {
      return relation.binders(a, b, d);
    },
  };
}

export const relate_TraitClause: Relate<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
  eq: eq_by_key,
  // rustc: compiler/rustc_type_ir/src/relate.rs:641 relate
  relate(relation, a, b) {
    const trait_ref = relation.relate(a.trait_ref, b.trait_ref, relate_TraitRef);
    if (trait_ref.$ === "Err") return trait_ref;
    if (a.polarity !== b.polarity) {
      return Err({ $: "PolarityMismatch", _0: ExpectedFound.new(a.polarity, b.polarity) });
    }
    return Ok({ trait_ref: trait_ref._0, polarity: a.polarity });
  },
};
