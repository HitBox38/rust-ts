// Port of compiler/rustc_infer/src/infer/relate/generalize.rs (lane infer-relate).
//
// - The `impl InferCtxt` methods (declared in ../../decls.ts) are assigned onto `InferCtxt.prototype`.
// - `TermVid`'s `From` impls live on its companion (`TermVid.from_TyVid` / `.from_ConstVid`, as rustc_middle's
//   `Term.from_Ty`); its derived `PartialEq` is `TermVid_eq`.
// - `Generalizer` is the generated class (./generalize.gen.ts); its inherent methods and its `TypeRelation` impl go on
//   its prototype (the `declare module` below), so a `Generalizer` is a `TypeRelation`.
// - `Generalizer.cache` (`SsoHashMap<(Ty, Variance, bool), Ty>`) is a `KeyedMap` on `intern_key` (tuple keys).
// - `#[instrument]` / `debug!` are dropped (filtered out by rustc's default logger); `warn!` goes through
//   rust_ts/tracing.ts; `debug_assert*!` stay comments.
// Init order: top-level code here touches only ../../decls.ts, this file's .gen.ts and other crates.
import { intern_key } from "../../../rust_ts/intern_key.ts";
import * as tracing from "../../../rust_ts/tracing.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { debug_Term, fold_Term, Term, Ty, debug_Ty } from "../../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import { AliasConst, type ConstVid } from "../../../rustc_type_ir/const_kind.ts";
import { TypeError } from "../../../rustc_type_ir/error.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.gen.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { UniverseIndex, Variance } from "../../../rustc_type_ir/lib.ts";
import type { ProjectionClause } from "../../../rustc_type_ir/predicate.ts";
import {
  interner,
  type Relate,
  relate_AliasTerm,
  relate_Const,
  relate_args_invariantly,
  relate_args_with_variances,
  relate_GenericArgs,
  relate_Term,
  relate_Ty,
  type RelateResult,
  structurally_relate_consts,
  structurally_relate_tys,
  TypeRelation_provided,
  VarianceDiagInfo,
} from "../../../rustc_type_ir/relate.ts";
import { type PredicateEmittingRelation, upcast_ProjectionClause_Predicate } from "../../../rustc_type_ir/relate/combine.ts";
import { Const, debug_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { debug_Region, type Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTerm, AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { type AliasTerm as AliasTermT, debug_AliasTerm } from "../../../rustc_type_ir/ty/alias.ts";
import { IsRigid } from "../../../rustc_type_ir/ty_kind.ts";
import type { TyVid } from "../../../rustc_type_ir/ty_kind.ts";
import { max_universe_of_placeholders } from "../../../rustc_type_ir/universe.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { type Debug, PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { InferCtxt } from "../../decls.ts";
import { ConstVidKey_from } from "../unify_key.ts";
import * as gen from "./generalize.gen.ts";
import { debug_TermVid, type Generalization, Generalizer } from "./generalize.gen.ts";

export * from "./generalize.gen.ts";

declare module "./generalize.gen.ts" {
  interface Generalizer {
    // generalize.rs:370
    cyclic_term_error(): TypeError;
    // generalize.rs:379
    next_var_for_alias_of_kind(alias: AliasTermT): Term;
    // generalize.rs:408
    generalize_alias_term(alias: AliasTermT): Result<Term, TypeError>;
    // generalize.rs:448 (`impl TypeRelation for Generalizer`)
    cx(): TyCtxt;
    // (provided) relate.rs:60
    relate<T>(a: T, b: T, d: Relate<T>): RelateResult<T>;
    // generalize.rs:452
    relate_ty_args(a_ty: Ty, _1: Ty, def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, mk: (args: GenericArgs) => Ty): RelateResult<Ty>;
    // generalize.rs:475
    relate_with_variance<T>(variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T>;
    // generalize.rs:493
    tys(t: Ty, t2: Ty): RelateResult<Ty>;
    // generalize.rs:610
    regions(r: Region, r2: Region): RelateResult<Region>;
    // generalize.rs:655
    consts(c: Const, c2: Const): RelateResult<Const>;
    // generalize.rs:751
    binders<T>(a: Binder<T>, _1: Binder<T>, d: Relate<T>): RelateResult<Binder<T>>;
  }
}

export type TermVid = gen.TermVid;
export const TermVid = {
  /** `impl From<ty::TyVid> for TermVid` */
  // rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:22 from
  from_TyVid(value: TyVid): TermVid {
    return { $: "Ty", _0: value };
  },

  /** `impl From<ty::ConstVid> for TermVid` */
  // rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:28 from
  from_ConstVid(value: ConstVid): TermVid {
    return { $: "Const", _0: value };
  },
};

/** `#[derive(PartialEq)]` of `TermVid`. */
export function TermVid_eq(a: TermVid, b: TermVid): boolean {
  return a.$ === b.$ && a._0 === b._0;
}

/** `Result::unwrap_err` (the panic formats the `Ok` value with `{:?}`). */
function unwrap_err<T, E>(r: Result<T, E>, debug_T: Debug<T>): E {
  if (r.$ === "Err") return r._0;
  return panic(`called \`Result::unwrap_err()\` on an \`Ok\` value: ${debug_T(r._0, PLAIN)}`);
}

// impl<'tcx> InferCtxt<'tcx>

/// The idea is that we should ensure that the type variable `target_vid`
/// is equal to, a subtype of, or a supertype of `source_ty`.
///
/// For this, we will instantiate `target_vid` with a *generalized* version
/// of `source_ty`. Generalization introduces other inference variables wherever
/// subtyping could occur. This also does the occurs checks, detecting whether
/// instantiating `target_vid` would result in a cyclic type. We eagerly error
/// in this case.
///
/// This is *not* expected to be used anywhere except for an implementation of
/// `TypeRelation`. Do not use this, and instead please use `At::eq`, for all
/// other usecases (i.e. setting the value of a type var).
// #[instrument(level = "debug", skip(self, relation))]
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:47 instantiate_ty_var
InferCtxt.prototype.instantiate_ty_var = function (
  this: InferCtxt,
  relation: PredicateEmittingRelation,
  target_is_expected: boolean,
  target_vid: TyVid,
  instantiation_variance: Variance,
  source_ty: Ty,
): RelateResult<null> {
  // debug_assert!(self.inner.borrow_mut().type_variables().probe(target_vid).is_unknown());

  return this.instantiate_var(relation, target_is_expected, TermVid.from_TyVid(target_vid), instantiation_variance, Term.from_Ty(source_ty));
};

/// Instantiates the const variable `target_vid` with the given constant.
///
/// This also tests if the given const `ct` contains an inference variable which was previously
/// unioned with `target_vid`. If this is the case, inferring `target_vid` to `ct`
/// would result in an infinite type as we continuously replace an inference variable
/// in `ct` with `ct` itself.
///
/// This is especially important as alias consts use their parents generics.
/// They therefore often contain unused args, making these errors far more likely.
///
/// A good example of this is the following:
///
/// ```compile_fail,E0308
/// #![feature(generic_const_exprs)]
///
/// fn bind<const N: usize>(value: [u8; N]) -> [u8; 3 + 4] {
///     todo!()
/// }
///
/// fn main() {
///     let mut arr = Default::default();
///     arr = bind(arr);
/// }
/// ```
///
/// Here `3 + 4` ends up as `ConstKind::Alias` which uses the generics
/// of `fn bind` (meaning that its args contain `N`).
///
/// `bind(arr)` now infers that the type of `arr` must be `[u8; N]`.
/// The assignment `arr = bind(arr)` now tries to equate `N` with `3 + 4`.
///
/// As `3 + 4` contains `N` in its args, this must not succeed.
///
/// See `tests/ui/const-generics/occurs-check/` for more examples where this is relevant.
// #[instrument(level = "debug", skip(self, relation))]
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:101 instantiate_const_var
InferCtxt.prototype.instantiate_const_var = function (
  this: InferCtxt,
  relation: PredicateEmittingRelation,
  target_is_expected: boolean,
  target_vid: ConstVid,
  source_ct: Const,
): RelateResult<null> {
  // FIXME(generic_const_exprs): Occurs check failures for alias consts
  // and generic expressions are not yet handled correctly.
  // debug_assert!(
  //     self.inner.borrow_mut().const_unification_table().probe_value(target_vid).is_unknown()
  // );

  return this.instantiate_var(relation, target_is_expected, TermVid.from_ConstVid(target_vid), Variance.Invariant, Term.from_Const(source_ct));
};

// #[instrument(level = "debug", skip(self, relation))]
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:124 instantiate_var
InferCtxt.prototype.instantiate_var = function (
  this: InferCtxt,
  relation: PredicateEmittingRelation,
  target_is_expected: boolean,
  target_vid: TermVid,
  instantiation_variance: Variance,
  source_term: Term,
): RelateResult<null> {
  // Generalize `source_term` depending on the current variance. As an example, assume
  // `?target <: &'x ?1`, where `'x` is some free region and `?1` is an inference
  // variable.
  //
  // Then the `generalized_term` would be `&'?2 ?3`, where `'?2` and `?3` are fresh
  // region/type inference variables.
  //
  // We then relate `generalized_term <: source_term`, adding constraints like `'x: '?2` and
  // `?1 <: ?3`.
  const g = this.generalize(relation.span(), target_vid, instantiation_variance, source_term);
  if (g.$ === "Err") return g;
  const generalized_term = g._0.value_may_be_infer;

  // Constrain `b_vid` to the generalized type `generalized_term`.
  this.union_var_term(target_vid, generalized_term);

  // Finally, relate `generalized_term` to `source_term`, as described in previous comment.
  //
  // FIXME(#16847): This code is non-ideal because all these subtype
  // relations wind up attributed to the same spans. We need
  // to associate causes/spans with each of the relations in
  // the stack to get this right.
  if (Term.is_infer(generalized_term)) {
    // This happens for cases like `<?0 as Trait>::Assoc == ?0`.
    // We can't instantiate `?0` here as that would result in a
    // cyclic type. We instead delay the unification in case
    // the alias can be normalized to something which does not
    // mention `?0`.
    const source_alias = Term.to_alias_term(source_term);
    if (source_alias === undefined) {
      return bug(`generalized \`${debug_Term(source_term, PLAIN)} to infer, not an alias`);
    }
    assert(!this.next_trait_solver(), "nonrigid aliases should be handled in relations, not here");
    switch (source_alias.kind.$) {
      case "ProjectionTy":
      case "ProjectionConst": {
        // FIXME: This does not handle subtyping correctly, we could
        // instead create a new inference variable `?normalized_source`, emitting
        // `Projection(normalized_source, ?ty_normalized)` and
        // `?normalized_source <: generalized_term`.
        const clause: ProjectionClause = {
          projection_term: source_alias,
          term: generalized_term,
        };
        relation.register_predicates([clause], upcast_ProjectionClause_Predicate);
        break;
      }
      // The old solver only accepts projection predicates for associated types.
      case "InherentTy":
      case "FreeTy":
      case "OpaqueTy":
        return Err({ $: "CyclicTy", _0: Term.expect_type(source_term) });
      case "InherentConstSelf":
      case "InherentConstImpl":
      case "FreeConst":
      case "AnonConst":
        return Err({ $: "CyclicConst", _0: Term.expect_const(source_term) });
    }
  } else {
    // NOTE: The `instantiation_variance` is not the same variance as
    // used by the relation. When instantiating `b`, `target_is_expected`
    // is flipped and the `instantiation_variance` is also flipped. To
    // constrain the `generalized_term` while using the original relation,
    // we therefore only have to flip the arguments.
    //
    // ```ignore (not code)
    // ?a rel B
    // instantiate_ty_var(?a, B) # expected and variance not flipped
    // B' rel B
    // ```
    // or
    // ```ignore (not code)
    // A rel ?b
    // instantiate_ty_var(?b, A) # expected and variance flipped
    // A rel A'
    // ```
    switch (Term.kind(generalized_term).$) {
      case "Ty": {
        if (target_is_expected) {
          const r = relation.relate(generalized_term, source_term, relate_Term);
          if (r.$ === "Err") return r;
        } else {
          // debug!("flip relation");
          const r = relation.relate(source_term, generalized_term, relate_Term);
          if (r.$ === "Err") return r;
        }
        break;
      }
      case "Const": {
        // Override consts to always be invariant
        if (target_is_expected) {
          const r = relation.relate_with_variance(Variance.Invariant, VarianceDiagInfo.None, generalized_term, source_term, relate_Term);
          if (r.$ === "Err") return r;
        } else {
          const r = relation.relate_with_variance(Variance.Invariant, VarianceDiagInfo.None, source_term, generalized_term, relate_Term);
          if (r.$ === "Err") return r;
        }
        break;
      }
    }
  }

  return Ok(null);
};

/// This is a thin wrapper around inserting into the var tables. You probably want
/// [`Self::instantiate_var`] instead, which calls this method.
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:244 union_var_term
InferCtxt.prototype.union_var_term = function (this: InferCtxt, l: TermVid, r: Term): void {
  const rk = Term.kind(r);
  if (l.$ === "Ty" && rk.$ === "Ty") {
    const r_vid = rk._0.ty_vid();
    if (r_vid !== undefined) {
      this.inner.type_variables().equate(l._0, r_vid);
    } else {
      // Ideally, we put this assert into `type_variables().instantiate()`.
      // But we can't pass the infcx into it as the infcx is already
      // mutably borrowed.
      // debug_assert!(
      //     self.try_resolve_ty_var(l).unwrap_err().can_name(ty::max_universe(self, r))
      // );
      this.inner.type_variables().instantiate(l._0, rk._0);
    }
  } else if (l.$ === "Const" && rk.$ === "Const") {
    const r_vid = rk._0.ct_vid();
    if (r_vid !== undefined) {
      this.inner.const_unification_table().union(ConstVidKey_from(l._0), ConstVidKey_from(r_vid));
    } else {
      // debug_assert!(
      //     self.try_resolve_const_var(l)
      //         .unwrap_err()
      //         .can_name(ty::max_universe(self, r))
      // );
      this.inner.const_unification_table().union_value(ConstVidKey_from(l._0), { $: "Known", value: rk._0 });
    }
  } else {
    bug(`mismatched term kinds in generalize: ${debug_TermVid(l, PLAIN)}, ${debug_Term(r, PLAIN)}`);
  }
};

/// Attempts to generalize `source_term` for the type variable `target_vid`.
/// This checks for cycles -- that is, whether `source_term` references `target_vid`.
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:280 generalize
InferCtxt.prototype.generalize = function (
  this: InferCtxt,
  span: Span,
  target_vid: TermVid,
  ambient_variance: Variance,
  source_term: Term,
): RelateResult<Generalization<Term>> {
  assert(!TypeVisitableExt.has_escaping_bound_vars(source_term, fold_Term), "assertion failed: !source_term.has_escaping_bound_vars()");
  let for_universe: UniverseIndex;
  let root_vid: TermVid;
  switch (target_vid.$) {
    case "Ty": {
      const ty_vid = target_vid._0;
      for_universe = unwrap_err(this.try_resolve_ty_var(ty_vid), debug_Ty);
      root_vid = { $: "Ty", _0: this.root_var(ty_vid) };
      break;
    }
    case "Const": {
      const ct_vid = target_vid._0;
      for_universe = unwrap_err(this.try_resolve_const_var(ct_vid), debug_Const);
      root_vid = { $: "Const", _0: this.inner.const_unification_table().find(ConstVidKey_from(ct_vid)).vid };
      break;
    }
  }

  const generalizer = new Generalizer(this, span, root_vid, for_universe, source_term, ambient_variance, false, new KeyedMap<[Ty, Variance, boolean], Ty>(intern_key));

  const value_may_be_infer = generalizer.relate(source_term, source_term, relate_Term);
  if (value_may_be_infer.$ === "Err") return value_may_be_infer;
  return Ok({ value_may_be_infer: value_may_be_infer._0 });
};

/// Do we need to generalize this type?
const NEEDS_GENERALIZATION: TypeFlags = unwrap(
  TypeFlags.from_bits(
    TypeFlags.bits(TypeFlags.HAS_FREE_REGIONS) | TypeFlags.bits(TypeFlags.HAS_INFER) | TypeFlags.bits(TypeFlags.HAS_PLACEHOLDER) | TypeFlags.bits(TypeFlags.HAS_NON_RIGID_ALIAS),
  ),
);

// impl<'tcx> Generalizer<'_, 'tcx>

/// Create an error that corresponds to the term kind in `root_term`
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:370 cyclic_term_error
Generalizer.prototype.cyclic_term_error = function (this: Generalizer): TypeError {
  const k = Term.kind(this.root_term);
  switch (k.$) {
    case "Ty":
      return { $: "CyclicTy", _0: k._0 };
    case "Const":
      return { $: "CyclicConst", _0: k._0 };
  }
};

/// Create a new type variable in the universe of the target when
/// generalizing an alias.
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:379 next_var_for_alias_of_kind
Generalizer.prototype.next_var_for_alias_of_kind = function (this: Generalizer, alias: AliasTermT): Term {
  if (AliasTermKind.is_type(alias.kind)) {
    return Term.from_Ty(this.infcx.next_ty_var_in_universe(this.span, this.for_universe));
  } else {
    return Term.from_Const(this.infcx.next_const_var_in_universe(this.span, this.for_universe));
  }
};

/// We only handle potentially normalizable aliases via this method. For rigid alias,
/// we always generalize structurally.
///
/// An occurs check failure inside of an alias does not mean
/// that the types definitely don't unify. We may be able
/// to normalize the alias after all.
///
/// We handle this by lazily equating the normalizable alias
/// and generalizing it to an inference variable. In the new solver,
/// we always generalize to an infer var unless the alias contains escaping
/// bound variables.
///
/// Correctly handling aliases with escaping bound variables is
/// difficult and currently incomplete in two opposite ways:
/// - if we get an occurs check failure in the alias, replace it with a new infer var.
///   This causes us to later emit an alias-relate goal and is incomplete in case the
///   alias normalizes to type containing one of the bound variables.
/// - if the alias contains an inference variable not nameable by `for_universe`, we
///   continue generalizing the alias. This ends up pulling down the universe of the
///   inference variable and is incomplete in case the alias would normalize to a type
///   which does not mention that inference variable.
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:408 generalize_alias_term
Generalizer.prototype.generalize_alias_term = function (this: Generalizer, alias: AliasTermT): Result<Term, TypeError> {
  // We do not eagerly replace aliases with inference variables if they have
  // escaping bound vars, see the method comment for details. However, when we
  // are inside of an alias with escaping bound vars replacing nested aliases
  // with inference variables can cause incorrect ambiguity.
  //
  // cc trait-system-refactor-initiative#110
  if (this.infcx.next_trait_solver() && !TypeVisitableExt.has_escaping_bound_vars(alias, relate_AliasTerm) && !this.in_alias) {
    return Ok(this.next_var_for_alias_of_kind(alias));
  }

  const is_nested_alias = this.in_alias;
  this.in_alias = true;
  let result: Result<Term, TypeError>;
  const r = this.relate(alias, alias, relate_AliasTerm);
  switch (r.$) {
    case "Ok": {
      const alias = r._0;
      result = Ok(AliasTerm.to_term(alias, this.cx(), IsRigid.No));
      break;
    }
    case "Err": {
      const e = r._0;
      if (is_nested_alias) {
        return Err(e);
      } else {
        const alias_max_universe = max_universe_of_placeholders(this.infcx, alias, relate_AliasTerm);
        const infer_replacement_is_complete = UniverseIndex.can_name(this.for_universe, alias_max_universe) && !TypeVisitableExt.has_escaping_bound_vars(alias, relate_AliasTerm);
        if (!infer_replacement_is_complete) {
          tracing.warn("rustc_infer::infer::relate::generalize", () => `may incompletely handle alias type: ${debug_AliasTerm(alias, PLAIN)}`);
        }

        // debug!("generalization failure in alias");
        result = Ok(this.next_var_for_alias_of_kind(alias));
      }
      break;
    }
  }
  this.in_alias = is_nested_alias;
  return result;
};

// impl<'tcx> TypeRelation<TyCtxt<'tcx>> for Generalizer<'_, 'tcx>

// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:448 cx
Generalizer.prototype.cx = function (this: Generalizer): TyCtxt {
  return this.infcx.tcx;
};

/** (provided) `TypeRelation::relate` */
Generalizer.prototype.relate = function <T>(this: Generalizer, a: T, b: T, d: Relate<T>): RelateResult<T> {
  return TypeRelation_provided.relate(this, a, b, d);
};

// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:452 relate_ty_args
Generalizer.prototype.relate_ty_args = function (
  this: Generalizer,
  a_ty: Ty,
  _1: Ty,
  def_id: DefId,
  a_args: GenericArgs,
  b_args: GenericArgs,
  mk: (args: GenericArgs) => Ty,
): RelateResult<Ty> {
  let args: RelateResult<GenericArgs>;
  if (this.ambient_variance === Variance.Invariant) {
    // Avoid fetching the variance if we are in an invariant
    // context; no need, and it can induce dependency cycles
    // (e.g., #41849).
    args = relate_args_invariantly(this, a_args, b_args);
  } else {
    const tcx = this.cx();
    const variances = interner(tcx).variances_of(def_id);
    args = relate_args_with_variances(this, variances, a_args, b_args);
  }
  if (args.$ === "Err") return args;
  if (args._0 === a_args) {
    return Ok(a_ty);
  } else {
    return Ok(mk(args._0));
  }
};

// #[instrument(level = "debug", skip(self, variance, b), ret)]
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:475 relate_with_variance
Generalizer.prototype.relate_with_variance = function <T>(this: Generalizer, variance: Variance, _info: VarianceDiagInfo, a: T, b: T, d: Relate<T>): RelateResult<T> {
  const old_ambient_variance = this.ambient_variance;
  this.ambient_variance = Variance.xform(this.ambient_variance, variance);
  // debug!(?self.ambient_variance, "new ambient variance");
  // Recursive calls to `relate` can overflow the stack. For example a deeper version of
  // `ui/associated-consts/issue-93775.rs`.
  const r = this.relate(a, b, d);
  this.ambient_variance = old_ambient_variance;
  return r;
};

// #[instrument(level = "debug", skip(self, t2), ret)]
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:493 tys
Generalizer.prototype.tys = function (this: Generalizer, t: Ty, t2: Ty): RelateResult<Ty> {
  assert_eq(t, t2, (v) => debug_Ty(v, PLAIN)); // we are misusing TypeRelation here; both LHS and RHS ought to be ==

  if (!TypeVisitableExt.has_type_flags(t, NEEDS_GENERALIZATION, fold_Ty)) {
    return Ok(t);
  }

  const cached = this.cache.get([t, this.ambient_variance, this.in_alias]);
  if (cached !== undefined) {
    return Ok(cached);
  }

  // Check to see whether the type we are generalizing references
  // any other type variable related to `vid` via
  // subtyping. This is basically our "occurs check", preventing
  // us from creating infinitely sized types.
  let g: RelateResult<Ty>;
  const tk = t.kind();
  if (tk.$ === "Infer" && (tk._0.$ === "FreshTy" || tk._0.$ === "FreshIntTy" || tk._0.$ === "FreshFloatTy")) {
    return bug(`unexpected infer type: ${display_Ty(t)}`);
  } else if (tk.$ === "Infer" && tk._0.$ === "TyVar") {
    const inner = this.infcx.inner;
    const vid = inner.type_variables().root_var(tk._0._0);
    if (TermVid_eq({ $: "Ty", _0: vid }, this.root_vid)) {
      // If sub-roots are equal, then `root_vid` and
      // `vid` are related via subtyping.
      g = Err(this.cyclic_term_error());
    } else {
      const probe = inner.type_variables().probe(vid);
      switch (probe.$) {
        case "Known": {
          const u = probe.value;
          g = this.relate(u, u, relate_Ty);
          break;
        }
        case "Unknown": {
          const universe = probe.universe;
          switch (this.ambient_variance) {
            // Invariant: no need to make a fresh type variable
            // if we can name the universe.
            case "Invariant":
              if (UniverseIndex.can_name(this.for_universe, universe)) {
                return Ok(t);
              }
              break;

            // We do need a fresh type variable otherwise.
            case "Bivariant":
            case "Covariant":
            case "Contravariant":
              break;
          }

          const origin = inner.type_variables().var_origin(vid);
          const new_var_id = inner.type_variables().new_var(this.for_universe, origin);
          // Record that `vid` and `new_var_id` have to be subtypes
          // of each other. This is currently only used for diagnostics.
          // To see why, see the docs in the `type_variables` module.
          inner.type_variables().sub_unify(vid, new_var_id);
          // If we're in the new solver and create a new inference
          // variable inside of an alias we eagerly constrain that
          // inference variable to prevent unexpected ambiguity errors.
          //
          // This is incomplete as it pulls down the universe of the
          // original inference variable, even though the alias could
          // normalize to a type which does not refer to that type at
          // all. I don't expect this to cause unexpected errors in
          // practice.
          //
          // We only need to do so for type and const variables, as
          // region variables do not impact normalization, and will get
          // correctly constrained by `AliasRelate` later on.
          //
          // cc trait-system-refactor-initiative#108
          if (this.infcx.next_trait_solver() && !TypingMode.is_coherence(this.infcx.typing_mode_raw()) && this.in_alias) {
            inner.type_variables().equate(vid, new_var_id);
          }

          // debug!("replacing original vid={:?} with new={:?}", vid, new_var_id);
          g = Ok(Ty.new_var(this.cx(), new_var_id));
          break;
        }
      }
    }
  } else if (tk.$ === "Infer" && (tk._0.$ === "IntVar" || tk._0.$ === "FloatVar")) {
    // No matter what mode we are in,
    // integer/floating-point types must be equal to be
    // relatable.
    g = Ok(t);
  } else if (tk.$ === "Placeholder") {
    const placeholder = tk._0;
    if (UniverseIndex.can_name(this.for_universe, placeholder.universe)) {
      g = Ok(t);
    } else {
      // debug!(
      //     "root universe {:?} cannot name placeholder in universe {:?}",
      //     self.for_universe, placeholder.universe
      // );
      g = Err(TypeError.Mismatch);
    }
  } else if (tk.$ === "Alias" && tk._0 === IsRigid.No) {
    // We only need to be careful with potentially normalizeable
    // aliases here. See `generalize_alias_term` for more information.
    const data = tk._1;
    const r = this.generalize_alias_term(AliasTerm.from_AliasTy(data));
    g = r.$ === "Ok" ? Ok(Term.expect_type(r._0)) : r;
  } else {
    g = structurally_relate_tys(this, t, t);
  }
  if (g.$ === "Err") return g;

  this.cache.set([t, this.ambient_variance, this.in_alias], g._0);
  return Ok(g._0);
};

// #[instrument(level = "debug", skip(self, r2), ret)]
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:610 regions
Generalizer.prototype.regions = function (this: Generalizer, r: Region, r2: Region): RelateResult<Region> {
  assert_eq(r, r2, (v) => debug_Region(v, PLAIN)); // we are misusing TypeRelation here; both LHS and RHS ought to be ==

  const rk = r.kind();
  switch (rk.$) {
    // Never make variables for regions bound within the type itself,
    // nor for erased regions.
    case "ReBound":
    case "ReErased":
      return Ok(r);

    // It doesn't really matter for correctness if we generalize ReError,
    // since we're already on a doomed compilation path.
    case "ReError":
      return Ok(r);

    case "RePlaceholder":
    case "ReVar":
    case "ReStatic":
    case "ReEarlyParam":
    case "ReLateParam":
      // see common code below
      break;
  }

  // If we are in an invariant context, we can re-use the region
  // as is, unless it happens to be in some universe that we
  // can't name.
  if (this.ambient_variance === Variance.Invariant) {
    const r_universe = this.infcx.universe_of_region(r);
    if (UniverseIndex.can_name(this.for_universe, r_universe)) {
      return Ok(r);
    }
  }

  return Ok(this.infcx.next_region_var_in_universe({ $: "Misc", _0: this.span }, this.for_universe));
};

// #[instrument(level = "debug", skip(self, c2), ret)]
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:655 consts
Generalizer.prototype.consts = function (this: Generalizer, c: Const, c2: Const): RelateResult<Const> {
  const tcx = this.cx();
  assert_eq(c, c2, (v) => debug_Const(v, PLAIN)); // we are misusing TypeRelation here; both LHS and RHS ought to be ==

  const ck = c.kind();
  if (ck.$ === "Infer" && ck._0.$ === "Var") {
    const vid = ck._0._0;
    // If root const vids are equal, then `root_vid` and
    // `vid` are related and we'd be inferring an infinitely
    // deep const.
    if (TermVid_eq({ $: "Const", _0: this.infcx.inner.const_unification_table().find(ConstVidKey_from(vid)).vid }, this.root_vid)) {
      return Err(this.cyclic_term_error());
    }

    const inner = this.infcx.inner;
    const variable_table = inner.const_unification_table();
    const value = variable_table.probe_value(ConstVidKey_from(vid));
    switch (value.$) {
      case "Known": {
        const u = value.value;
        return this.relate(u, u, relate_Const);
      }
      case "Unknown": {
        const { origin, universe } = value;
        if (UniverseIndex.can_name(this.for_universe, universe)) {
          return Ok(c);
        } else {
          const new_var_id = variable_table.new_key({
            $: "Unknown",
            origin,
            universe: this.for_universe,
          }).vid;

          // See the comment for type inference variables
          // for more details.
          if (this.infcx.next_trait_solver() && !TypingMode.is_coherence(this.infcx.typing_mode_raw()) && this.in_alias) {
            variable_table.union(ConstVidKey_from(vid), ConstVidKey_from(new_var_id));
          }
          return Ok(Const.new_var(tcx, new_var_id));
        }
      }
    }
  } else if (ck.$ === "Alias" && ck._0 === IsRigid.No) {
    // FIXME: Alias consts are also not rigid, so the current
    // approach of always relating them structurally is incomplete.
    //
    // FIXME: replace the `else` branch with
    // `structurally_relate_consts` once it is fully structural.
    //
    // We only need to be careful with potentially normalizeable
    // aliases here. See `generalize_alias_term` for more information.
    const alias_const = ck._1;
    // Hack: Fall back to old behavior if GCE is enabled (it used to just be the Yes
    // path), as doing this new No path breaks some GCE things. I expect GCE to be
    // ripped out soon so this shouldn't matter soon.
    if (this.infcx.next_trait_solver() || !tcx.features().generic_const_exprs()) {
      const r = this.generalize_alias_term(AliasTerm.from_AliasConst(alias_const));
      return r.$ === "Ok" ? Ok(Term.expect_const(r._0)) : r;
    } else {
      const { kind } = alias_const;
      let { args } = alias_const;
      const r = this.relate_with_variance(Variance.Invariant, VarianceDiagInfo.None, args, args, relate_GenericArgs);
      if (r.$ === "Err") return r;
      args = r._0;
      return Ok(Const.new_alias(tcx, IsRigid.No, AliasConst.new(tcx, kind, args)));
    }
  } else if (ck.$ === "Placeholder") {
    const placeholder = ck._0;
    if (UniverseIndex.can_name(this.for_universe, placeholder.universe)) {
      return Ok(c);
    } else {
      // debug!(
      //     "root universe {:?} cannot name placeholder in universe {:?}",
      //     self.for_universe, placeholder.universe
      // );
      return Err(TypeError.Mismatch);
    }
  } else {
    return structurally_relate_consts(this, c, c);
  }
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_infer/src/infer/relate/generalize.rs:751 binders
Generalizer.prototype.binders = function <T>(this: Generalizer, a: Binder<T>, _1: Binder<T>, d: Relate<T>): RelateResult<Binder<T>> {
  const result = this.relate(Binder.skip_binder(a), Binder.skip_binder(a), d);
  if (result.$ === "Err") return result;
  return Ok(Binder.rebind(a, result._0));
};
