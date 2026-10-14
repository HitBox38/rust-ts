// Port of compiler/rustc_type_ir/src/predicate.rs (lane tyir-misc, sub-lane predicate). The types with their derived
// Debug / TypeVisitable / TypeFoldable impls are generated into predicate.gen.ts (set rustc_ty of tools/codegen/types.ts,
// lane codegen-tyir); this file holds the inherent methods, the manual trait impls and the `From` / `UpcastFrom` impls,
// in upstream order.
//
// PORT (D3): `I: Interner` is erased; `interner: I` is `TyCtxt` where the body needs rustc_middle's inherent API
// (`GenericArgs::identity_for_item`, `GenericArgs::extend_with_error`, `AliasTerm::new` / `with_replaced_self_ty`,
// which take `TyCtxt`) and `Interner` where it only calls trait methods. Every `I::*Id` is `DefId`, so `def_id.into()`
// and `def_id.try_into().unwrap()` are the identity; `self_ty.into()` is `GenericArg.from_Ty` (packing is the
// identity, D3).
// PORT: methods of the generated structs / enums live on a same-named companion const taking `self` first
// (`TraitRef.self_ty(tr)`, tyir-kind decision 1). The impls on `ty::Binder<I, X>` are companions named after
// rustc_middle's alias of that binder (`PolyTraitRef`, `PolyTraitClause`, `PolyExistentialPredicate`,
// `PolyExistentialTraitRef`, `PolyExistentialProjection`, `PolyProjectionClause`), as `PolyFnSig` in ty_kind.ts;
// `Binder<HostEffectClause>` has no rustc_middle alias and is `PolyHostEffectClause`.
// PORT: `impl From<X> for Y` is `Y.from_X(x)`; `impl UpcastFrom<I, X> for Y` is `Y.upcast_from_X(from, interner)`;
// `x.upcast(cx)` (the blanket `impl Upcast<I, U> for T where U: UpcastFrom<I, T>`, upcast.rs) is a direct call of the
// target's `upcast_from_*` fn.
// PORT: `impl Iterator` results are arrays.
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (`PLAIN`); `x.fmt(f)` keeps `f` (tyir-kind decision 5).
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { debug_Term, Term, type Ty } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { type Debug, type Fmt, PLAIN } from "../std/fmt.ts";
import { slice_from, slice_to } from "../std/slice.ts";
import { Binder } from "./binder.ts";
import type { Interner } from "./interner.ts";
import * as gen from "./predicate.gen.ts";
import type { ExistentialPredicate, OutlivesClause } from "./predicate.gen.ts";
import { debug_ClausePolarity } from "./predicate.gen.ts";
import type { ClauseKind, PredicateKind } from "./predicate_kind.gen.ts";
import { debug_ExistentialTraitRef, debug_TraitRef } from "./ir_print.ts";
import { AliasTerm, type AliasTermKind, debug_AliasTermKind } from "./term_kind.ts";
import { debug_Alias, type AliasTerm as AliasTermT } from "./ty/alias.ts";

export * from "./predicate.gen.ts";

// `define_debug_via_print!(TraitRef, ExistentialTraitRef, PatternKind)` (ir_print.rs:56): the impls are in ir_print.ts;
// generated code imports these two from here.
export { debug_ExistentialTraitRef, debug_TraitRef };

export type RegionEqPredicate = gen.RegionEqPredicate;
export type TraitRef = gen.TraitRef;
export type TraitClause = gen.TraitClause;
export type ExistentialTraitRef = gen.ExistentialTraitRef;
export type ExistentialProjection = gen.ExistentialProjection;
export type ProjectionClause = gen.ProjectionClause;
export type NormalizesTo<K = AliasTermKind> = gen.NormalizesTo<K>;
export type HostEffectClause = gen.HostEffectClause;
export type BoundConstness = gen.BoundConstness;

// ---- PORT stand-ins for fns of other files that are not ported yet ----------------------------------------------------
// Root repoints them at the real ports when binder.rs (lane tyir-binder) and rustc_middle ty/predicate.rs (lane ty-args)
// land. Exported so that unnormalized.ts uses the same ones.

// PORT(merge-w15a): the three `UpcastFrom` stand-ins run upstream's bodies (tyir-relate's elaborate.ts stand-ins did;
// both lanes' copies are merged here). `.upcast(tcx)` chains are spelled out per the impls they select.

/** PORT: stand-in for `impl UpcastFrom<TyCtxt, Binder<ClauseKind>> for Clause` (rustc_middle ty/predicate.rs:491, lane ty-args). */
export function Clause_upcast_from_Binder_ClauseKind(from: Binder<ClauseKind>, tcx: TyCtxt): Clause {
  return tcx.mk_predicate(Binder.map_bound(from, (clause): PredicateKind => ({ $: "Clause", _0: clause }))).expect_clause();
}

/** PORT: stand-in for `impl UpcastFrom<TyCtxt, PolyTraitRef> for Clause` (rustc_middle ty/predicate.rs:517, lane ty-args):
 *  `PolyTraitClause::upcast_from` (predicate.rs:249), then `UpcastFrom<PolyTraitClause> for Clause` (:544) through
 *  `UpcastFrom<PolyTraitClause> for Predicate` (:530). */
export function Clause_upcast_from_PolyTraitRef(from: Binder<TraitRef>, tcx: TyCtxt): Clause {
  const pred: Binder<TraitClause> = PolyTraitClause.upcast_from_PolyTraitRef(from, as_interner(tcx));
  const p = tcx.mk_predicate(Binder.map_bound_no_validate_bound_vars(pred, (p): PredicateKind => ({ $: "Clause", _0: { $: "Trait", _0: p } })));
  return p.expect_clause();
}

/** PORT: stand-in for `impl UpcastFrom<TyCtxt, PolyProjectionClause> for Clause` (rustc_middle ty/predicate.rs:588, lane ty-args)
 *  through `UpcastFrom<PolyProjectionClause> for Predicate` (:575). */
export function Clause_upcast_from_PolyProjectionClause(from: Binder<ProjectionClause>, tcx: TyCtxt): Clause {
  const p = tcx.mk_predicate(Binder.map_bound(from, (p): PredicateKind => ({ $: "Clause", _0: { $: "Projection", _0: p } })));
  return p.expect_clause();
}

/**
 * PORT (D3): `TyCtxt` is the only `Interner` (`impl Interner for TyCtxt`, rustc_middle ty/context/impl_interner.rs).
 * Until lane ty-ctxt completes that impl the TS class does not satisfy the interface structurally (14 methods are
 * `unported_methods` placeholders, several queries are typed `unknown`), so a fn that needs `TyCtxt`'s inherent API
 * and passes its `cx` on to `Interner` code views it through this cast. Root: drop it once `TyCtxt` implements
 * `Interner`.
 */
export function as_interner(tcx: TyCtxt): Interner {
  return tcx as unknown as Interner;
}

// ---- RegionEqPredicate / RegionConstraint ------------------------------------------------------------------------------

export const RegionEqPredicate = {
  /// Decompose `'a == 'b` into `['a: 'b, 'b: 'a]`
  // rustc: compiler/rustc_type_ir/src/predicate.rs:42 into_bidirectional_outlives
  into_bidirectional_outlives(self: RegionEqPredicate): [OutlivesClause<GenericArg>, OutlivesClause<GenericArg>] {
    return [
      { _0: GenericArg.from_Region(self._0), _1: self._1 },
      { _0: GenericArg.from_Region(self._1), _1: self._0 },
    ];
  },
};

export type RegionConstraint = gen.RegionConstraint;
export const RegionConstraint = {
  /** `impl From<OutlivesClause<I, I::GenericArg>> for RegionConstraint<I>` */
  // rustc: compiler/rustc_type_ir/src/predicate.rs:59 from
  from_OutlivesClause(value: OutlivesClause<GenericArg>): RegionConstraint {
    return { $: "Outlives", _0: value };
  },

  /** `impl From<RegionEqPredicate<I>> for RegionConstraint<I>` */
  // rustc: compiler/rustc_type_ir/src/predicate.rs:65 from
  from_RegionEqPredicate(value: RegionEqPredicate): RegionConstraint {
    return { $: "Eq", _0: value };
  },

  /// Whether the given constraint is either `'a: 'a` or `'a == 'a`.
  // rustc: compiler/rustc_type_ir/src/predicate.rs:72 is_trivial
  is_trivial(self: RegionConstraint): boolean {
    switch (self.$) {
      case "Outlives": {
        const outlives = self._0;
        const re = GenericArg.as_region(outlives._0);
        return re !== undefined && re === outlives._1;
      }
      case "Eq": {
        const eq = self._0;
        return eq._0 === eq._1;
      }
    }
  },

  /// If `self` is an eq constraint, iterate through its decomposed bidirectional outlives
  /// bounds and if not, just iterate once for the outlives bound itself.
  // rustc: compiler/rustc_type_ir/src/predicate.rs:83 iter_outlives
  iter_outlives(self: RegionConstraint): OutlivesClause<GenericArg>[] {
    switch (self.$) {
      case "Outlives": {
        const outlives = self._0;
        // iter::once(outlives).chain(None)
        return [outlives];
      }
      case "Eq": {
        const eq = self._0;
        const [outlives1, outlives2] = RegionEqPredicate.into_bidirectional_outlives(eq);
        // iter::once(outlives1).chain(Some(outlives2))
        return [outlives1, outlives2];
      }
    }
  },
};

// ---- TraitRef ----------------------------------------------------------------------------------------------------------

export const TraitRef = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:124 new_from_args
  new_from_args(interner: Interner, trait_def_id: DefId, args: GenericArgs): TraitRef {
    interner.debug_assert_args_compatible(trait_def_id, args);
    return { def_id: trait_def_id, args, _use_trait_ref_new_instead: null };
  },

  // PORT: `args: impl IntoIterator<Item: Into<I::GenericArg>>` is `Iterable<GenericArg>` (packing is the identity).
  // rustc: compiler/rustc_type_ir/src/predicate.rs:129 new
  new(interner: Interner, trait_def_id: DefId, args: Iterable<GenericArg>): TraitRef {
    const args_ = interner.mk_args_from_iter(args);
    return TraitRef.new_from_args(interner, trait_def_id, args_);
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:138 from_assoc
  from_assoc(interner: Interner, trait_id: DefId, args: GenericArgs): TraitRef {
    const generics = interner.generics_of(trait_id);
    if (generics.count() === args.length) {
      // Can reuse `args` in its entirety.
      return TraitRef.new_from_args(interner, trait_id, args);
    } else {
      // Need only some of `args`.
      return TraitRef.new(interner, trait_id, args.slice(0, generics.count()));
    }
  },

  /// Returns a `TraitRef` of the form `P0: Foo<P1..Pn>` where `Pi`
  /// are the parameters defined on trait.
  // rustc: compiler/rustc_type_ir/src/predicate.rs:151 identity
  identity(interner: TyCtxt, def_id: DefId): TraitRef {
    return TraitRef.new_from_args(as_interner(interner), def_id, RawList.identity_for_item(interner, def_id));
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:159 with_replaced_self_ty
  with_replaced_self_ty(self: TraitRef, interner: Interner, self_ty: Ty): TraitRef {
    return TraitRef.new(interner, self.def_id, [GenericArg.from_Ty(self_ty), ...self.args.slice(1)]);
  },

  // #[inline]
  // rustc: compiler/rustc_type_ir/src/predicate.rs:168 self_ty
  self_ty(self: TraitRef): Ty {
    return self.args.type_at(0);
  },
};

/** The inherent methods of `ty::Binder<I, TraitRef<I>>` (rustc_middle's `PolyTraitRef`). */
export const PolyTraitRef = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:174 self_ty
  self_ty(self: Binder<TraitRef>): Binder<Ty> {
    return Binder.map_bound_ref(self, (tr) => TraitRef.self_ty(tr));
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:178 def_id
  def_id(self: Binder<TraitRef>): DefId {
    return Binder.skip_binder(self).def_id;
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:182 to_host_effect_clause
  to_host_effect_clause(self: Binder<TraitRef>, cx: TyCtxt, constness: BoundConstness): Clause {
    return Clause_upcast_from_Binder_ClauseKind(
      Binder.map_bound(self, (trait_ref): ClauseKind => ({ $: "HostEffect", _0: { trait_ref, constness } })),
      cx,
    );
  },
};

// ---- TraitClause -------------------------------------------------------------------------------------------------------

export const TraitClause = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:211 with_replaced_self_ty
  with_replaced_self_ty(self: TraitClause, interner: Interner, self_ty: Ty): TraitClause {
    return {
      trait_ref: TraitRef.with_replaced_self_ty(self.trait_ref, interner, self_ty),
      polarity: self.polarity,
    };
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:218 def_id
  def_id(self: TraitClause): DefId {
    return self.trait_ref.def_id;
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:222 self_ty
  self_ty(self: TraitClause): Ty {
    return TraitRef.self_ty(self.trait_ref);
  },

  /** `impl UpcastFrom<I, TraitRef<I>> for TraitClause<I>` */
  // rustc: compiler/rustc_type_ir/src/predicate.rs:244 upcast_from
  upcast_from_TraitRef(from: TraitRef, _tcx: Interner): TraitClause {
    return { trait_ref: from, polarity: "Positive" };
  },
};

/** The inherent methods of `ty::Binder<I, TraitClause<I>>` (rustc_middle's `PolyTraitClause`). */
export const PolyTraitClause = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:228 def_id
  def_id(self: Binder<TraitClause>): DefId {
    // Ok to skip binder since trait `DefId` does not care about regions.
    return TraitClause.def_id(Binder.skip_binder(self));
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:233 self_ty
  self_ty(self: Binder<TraitClause>): Binder<Ty> {
    return Binder.map_bound_no_validate_bound_vars(self, (trait_ref) => TraitClause.self_ty(trait_ref));
  },

  // #[inline]
  // rustc: compiler/rustc_type_ir/src/predicate.rs:238 polarity
  polarity(self: Binder<TraitClause>): ClausePolarity {
    return Binder.skip_binder(self).polarity;
  },

  /** `impl UpcastFrom<I, ty::Binder<I, TraitRef<I>>> for ty::Binder<I, TraitClause<I>>` */
  // rustc: compiler/rustc_type_ir/src/predicate.rs:250 upcast_from
  upcast_from_PolyTraitRef(from: Binder<TraitRef>, _tcx: Interner): Binder<TraitClause> {
    return Binder.map_bound_no_validate_bound_vars(from, (trait_ref): TraitClause => ({
      trait_ref,
      polarity: "Positive",
    }));
  },
};

// rustc: compiler/rustc_type_ir/src/predicate.rs:259 fmt
export const debug_TraitClause: Debug<TraitClause> = (self, _f) =>
  `TraitClause(${debug_TraitRef(self.trait_ref, PLAIN)}, polarity:${debug_ClausePolarity(self.polarity, PLAIN)})`;

// ---- ImplPolarity / ClausePolarity -------------------------------------------------------------------------------------

/** `impl fmt::Display for ImplPolarity` */
// rustc: compiler/rustc_type_ir/src/predicate.rs:274 fmt
export function display_ImplPolarity(self: gen.ImplPolarity): string {
  switch (self) {
    case "Positive":
      return "positive";
    case "Negative":
      return "negative";
  }
}

export type ImplPolarity = gen.ImplPolarity;
export const ImplPolarity = {
  ...gen.ImplPolarity,

  /// The polarity marker in front of the impl trait ref if applicable.
  // rustc: compiler/rustc_type_ir/src/predicate.rs:284 as_str
  as_str(self: ImplPolarity): string {
    switch (self) {
      case "Positive":
        return "";
      case "Negative":
        return "!";
    }
  },
};

export type ClausePolarity = gen.ClausePolarity;
export const ClausePolarity = {
  ...gen.ClausePolarity,

  /// Flips polarity by turning `Positive` into `Negative` and `Negative` into `Positive`.
  // rustc: compiler/rustc_type_ir/src/predicate.rs:308 flip
  flip(self: ClausePolarity): ClausePolarity {
    switch (self) {
      case "Positive":
        return "Negative";
      case "Negative":
        return "Positive";
    }
  },
};

/** `impl fmt::Display for ClausePolarity` */
// rustc: compiler/rustc_type_ir/src/predicate.rs:317 fmt
export function display_ClausePolarity(self: ClausePolarity): string {
  switch (self) {
    case "Positive":
      return "positive";
    case "Negative":
      return "negative";
  }
}

// ---- ExistentialPredicate ----------------------------------------------------------------------------------------------

/** The inherent methods of `ty::Binder<I, ExistentialPredicate<I>>` (rustc_middle's `PolyExistentialPredicate`). */
export const PolyExistentialPredicate = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:343 def_id
  def_id(self: Binder<ExistentialPredicate>): DefId {
    const p = Binder.skip_binder(self);
    switch (p.$) {
      case "Trait":
        return p._0.def_id;
      case "Projection":
        return p._0.def_id;
      case "AutoTrait":
        return p._0;
    }
  },

  /// Given an existential predicate like `?Self: PartialEq<u32>` (e.g., derived from `dyn PartialEq<u32>`),
  /// and a concrete type `self_ty`, returns a full predicate where the existentially quantified variable `?Self`
  /// has been replaced with `self_ty` (e.g., `self_ty: PartialEq<u32>`, in our example).
  // rustc: compiler/rustc_type_ir/src/predicate.rs:353 with_self_ty
  with_self_ty(self: Binder<ExistentialPredicate>, cx: TyCtxt, self_ty: Ty): Clause {
    const p = Binder.skip_binder(self);
    switch (p.$) {
      case "Trait": {
        const tr = p._0;
        return Clause_upcast_from_PolyTraitRef(PolyExistentialTraitRef.with_self_ty(Binder.rebind(self, tr), as_interner(cx), self_ty), cx);
      }
      case "Projection": {
        const p_ = p._0;
        return Clause_upcast_from_PolyProjectionClause(Binder.rebind(self, ExistentialProjection.with_self_ty(p_, cx, self_ty)), cx);
      }
      case "AutoTrait": {
        const did = p._0;
        const generics = as_interner(cx).generics_of(did);
        let trait_ref: TraitRef;
        if (generics.count() === 1) {
          trait_ref = TraitRef.new(as_interner(cx), did, [GenericArg.from_Ty(self_ty)]);
        } else {
          // If this is an ill-formed auto trait, then synthesize
          // new error args for the missing generics.
          const err_args = RawList.extend_with_error(cx, did, [GenericArg.from_Ty(self_ty)]);
          trait_ref = TraitRef.new_from_args(as_interner(cx), did, err_args);
        }
        return Clause_upcast_from_PolyTraitRef(Binder.rebind(self, trait_ref), cx);
      }
    }
  },
};

// ---- ExistentialTraitRef -----------------------------------------------------------------------------------------------

export const ExistentialTraitRef = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:400 new_from_args
  new_from_args(interner: Interner, trait_def_id: DefId, args: GenericArgs): ExistentialTraitRef {
    interner.debug_assert_existential_args_compatible(trait_def_id, args);
    return { def_id: trait_def_id, args, _use_existential_trait_ref_new_instead: null };
  },

  // PORT: `args: impl IntoIterator<Item: Into<I::GenericArg>>` is `Iterable<GenericArg>` (packing is the identity).
  // rustc: compiler/rustc_type_ir/src/predicate.rs:405 new
  new(interner: Interner, trait_def_id: DefId, args: Iterable<GenericArg>): ExistentialTraitRef {
    const args_ = interner.mk_args_from_iter(args);
    return ExistentialTraitRef.new_from_args(interner, trait_def_id, args_);
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:414 erase_self_ty
  erase_self_ty(interner: Interner, trait_ref: TraitRef): ExistentialTraitRef {
    // Assert there is a Self.
    trait_ref.args.type_at(0);

    return {
      def_id: trait_ref.def_id,
      args: interner.mk_args(slice_from(trait_ref.args, 1)),
      _use_existential_trait_ref_new_instead: null,
    };
  },

  /// Convert the *existential* trait ref into a normal one by providing a self type.
  ///
  /// Existential trait refs don't contain a self type, it's erased.
  /// Therefore, you must specify *some* self type to perform the conversion.
  /// A common choice is the trait object type itself or some kind of dummy type.
  // rustc: compiler/rustc_type_ir/src/predicate.rs:430 with_self_ty
  with_self_ty(self: ExistentialTraitRef, interner: Interner, self_ty: Ty): TraitRef {
    return TraitRef.new(interner, self.def_id, [GenericArg.from_Ty(self_ty), ...self.args]);
  },
};

/** The inherent methods of `ty::Binder<I, ExistentialTraitRef<I>>` (rustc_middle's `PolyExistentialTraitRef`). */
export const PolyExistentialTraitRef = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:436 def_id
  def_id(self: Binder<ExistentialTraitRef>): DefId {
    return Binder.skip_binder(self).def_id;
  },

  /// Convert the *existential* polymorphic trait ref into a normal one by providing a self type.
  ///
  /// See also [`ExistentialTraitRef::with_self_ty`].
  // rustc: compiler/rustc_type_ir/src/predicate.rs:443 with_self_ty
  with_self_ty(self: Binder<ExistentialTraitRef>, cx: Interner, self_ty: Ty): Binder<TraitRef> {
    return Binder.map_bound(self, (trait_ref) => ExistentialTraitRef.with_self_ty(trait_ref, cx, self_ty));
  },
};

// ---- ExistentialProjection ---------------------------------------------------------------------------------------------

export const ExistentialProjection = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:469 new_from_args
  new_from_args(interner: Interner, def_id: DefId, args: GenericArgs, term: Term): ExistentialProjection {
    interner.debug_assert_existential_args_compatible(def_id, args);
    return { def_id, args, term, use_existential_projection_new_instead: null };
  },

  // PORT: `args: impl IntoIterator<Item: Into<I::GenericArg>>` is `Iterable<GenericArg>` (packing is the identity).
  // rustc: compiler/rustc_type_ir/src/predicate.rs:479 new
  new(interner: Interner, def_id: DefId, args: Iterable<GenericArg>, term: Term): ExistentialProjection {
    const args_ = interner.mk_args_from_iter(args);
    return ExistentialProjection.new_from_args(interner, def_id, args_, term);
  },

  /// Extracts the underlying existential trait reference from this projection.
  ///
  /// For example, if this is a projection of `exists T. <T as Iterator>::Item == X`,
  /// then this function would return an `exists T. T: Iterator` existential trait
  /// reference.
  // rustc: compiler/rustc_type_ir/src/predicate.rs:494 trait_ref
  trait_ref(self: ExistentialProjection, interner: Interner): ExistentialTraitRef {
    const def_id = interner.projection_parent(self.def_id);
    // PORT: `count() - 1` is a `usize` subtraction (panics on underflow in debug only; the oracle wraps, and the
    // slice below then panics); a negative count reaches `slice_to`'s range panic the same way.
    const args_count = interner.generics_of(def_id).count() - 1;
    const args = interner.mk_args(slice_to(self.args, args_count));
    return ExistentialTraitRef.new_from_args(interner, def_id, args);
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:501 alias_kind
  alias_kind(self: ExistentialProjection): AliasTermKind {
    const k = Term.kind(self.term);
    switch (k.$) {
      case "Ty":
        return { $: "ProjectionTy", def_id: self.def_id };
      case "Const":
        return { $: "ProjectionConst", def_id: self.def_id };
    }
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:512 with_self_ty
  with_self_ty(self: ExistentialProjection, interner: TyCtxt, self_ty: Ty): ProjectionClause {
    // otherwise the escaping regions would be captured by the binders
    // debug_assert!(!self_ty.has_escaping_bound_vars());

    return {
      projection_term: AliasTerm.new(interner, ExistentialProjection.alias_kind(self), [GenericArg.from_Ty(self_ty), ...self.args]),
      term: self.term,
    };
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:526 erase_self_ty
  erase_self_ty(interner: Interner, projection_predicate: ProjectionClause): ExistentialProjection {
    // Assert there is a Self.
    projection_predicate.projection_term.args.type_at(0);

    return {
      def_id: ProjectionClause.def_id(projection_predicate),
      args: interner.mk_args(slice_from(projection_predicate.projection_term.args, 1)),
      term: projection_predicate.term,
      use_existential_projection_new_instead: null,
    };
  },
};

/** The inherent methods of `ty::Binder<I, ExistentialProjection<I>>` (rustc_middle's `PolyExistentialProjection`). */
export const PolyExistentialProjection = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:540 with_self_ty
  with_self_ty(self: Binder<ExistentialProjection>, cx: TyCtxt, self_ty: Ty): Binder<ProjectionClause> {
    return Binder.map_bound(self, (p) => ExistentialProjection.with_self_ty(p, cx, self_ty));
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:544 item_def_id
  item_def_id(self: Binder<ExistentialProjection>): DefId {
    return Binder.skip_binder(self).def_id;
  },
};

// ---- ProjectionClause --------------------------------------------------------------------------------------------------

export const ProjectionClause = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:575 self_ty
  self_ty(self: ProjectionClause): Ty {
    return AliasTerm.self_ty(self.projection_term);
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:579 with_replaced_self_ty
  with_replaced_self_ty(self: ProjectionClause, interner: TyCtxt, self_ty: Ty): ProjectionClause {
    return {
      ...self,
      projection_term: AliasTerm.with_replaced_self_ty(self.projection_term, interner, self_ty),
    };
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:586 trait_def_id
  trait_def_id(self: ProjectionClause, interner: Interner): DefId {
    return AliasTerm.trait_def_id(self.projection_term, interner);
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:590 def_id
  def_id(self: ProjectionClause): DefId {
    return AliasTerm.expect_projection_def_id(self.projection_term);
  },
};

/** The inherent methods of `ty::Binder<I, ProjectionClause<I>>` (rustc_middle's `PolyProjectionClause`). */
export const PolyProjectionClause = {
  /// Returns the `DefId` of the trait of the associated item being projected.
  // #[inline]
  // rustc: compiler/rustc_type_ir/src/predicate.rs:598 trait_def_id
  trait_def_id(self: Binder<ProjectionClause>, cx: Interner): DefId {
    return AliasTerm.trait_def_id(Binder.skip_binder(self).projection_term, cx);
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:602 term
  term(self: Binder<ProjectionClause>): Binder<Term> {
    return Binder.map_bound(self, (predicate) => predicate.term);
  },

  /// The `DefId` of the `TraitItem` for the associated type.
  ///
  /// Note that this is not the `DefId` of the `TraitRef` containing this
  /// associated type, which is in `tcx.associated_item(projection_def_id()).container`.
  // rustc: compiler/rustc_type_ir/src/predicate.rs:610 item_def_id
  item_def_id(self: Binder<ProjectionClause>): DefId {
    // Ok to skip binder since trait `DefId` does not care about regions.
    return ProjectionClause.def_id(Binder.skip_binder(self));
  },
};

// rustc: compiler/rustc_type_ir/src/predicate.rs:617 fmt
export const debug_ProjectionClause: Debug<ProjectionClause> = (self, _f) =>
  `ProjectionClause(${debug_AliasTerm(self.projection_term, PLAIN)}, ${debug_Term(self.term, PLAIN)})`;

/** The derived Debug of `AliasTerm` (= `Alias<AliasTermKind>`, ty/alias.rs). */
function debug_AliasTerm(v: AliasTermT, f: Fmt): string {
  return debug_Alias(v, f, debug_AliasTermKind);
}

// ---- NormalizesTo ------------------------------------------------------------------------------------------------------

export const NormalizesTo = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:636 self_ty
  self_ty(self: NormalizesTo): Ty {
    return AliasTerm.self_ty(self.alias);
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:640 with_replaced_self_ty
  with_replaced_self_ty(self: NormalizesTo, interner: TyCtxt, self_ty: Ty): NormalizesTo {
    return { ...self, alias: AliasTerm.with_replaced_self_ty(self.alias, interner, self_ty) };
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:644 trait_def_id
  trait_def_id(self: NormalizesTo, interner: Interner): DefId {
    return AliasTerm.trait_def_id(self.alias, interner);
  },
};

// PORT: the bound `Alias<I, K>: fmt::Debug` is the `debug_K` parameter (`Alias<K>`'s derived Debug needs `K`'s).
// rustc: compiler/rustc_type_ir/src/predicate.rs:656 fmt
export function debug_NormalizesTo<K>(self: NormalizesTo<K>, _f: Fmt, debug_K: Debug<K>): string {
  return `NormalizesTo(${debug_Alias(self.alias, PLAIN, debug_K)}, ${debug_Term(self.term, PLAIN)})`;
}

// ---- HostEffectClause --------------------------------------------------------------------------------------------------

export const HostEffectClause = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:676 self_ty
  self_ty(self: HostEffectClause): Ty {
    return TraitRef.self_ty(self.trait_ref);
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:680 with_replaced_self_ty
  with_replaced_self_ty(self: HostEffectClause, interner: Interner, self_ty: Ty): HostEffectClause {
    return { ...self, trait_ref: TraitRef.with_replaced_self_ty(self.trait_ref, interner, self_ty) };
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:684 def_id
  def_id(self: HostEffectClause): DefId {
    return self.trait_ref.def_id;
  },
};

/** The inherent methods of `ty::Binder<I, HostEffectClause<I>>` (no rustc_middle alias; named like the others). */
export const PolyHostEffectClause = {
  // rustc: compiler/rustc_type_ir/src/predicate.rs:690 def_id
  def_id(self: Binder<HostEffectClause>): DefId {
    // Ok to skip binder since trait `DefId` does not care about regions.
    return HostEffectClause.def_id(Binder.skip_binder(self));
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:695 self_ty
  self_ty(self: Binder<HostEffectClause>): Binder<Ty> {
    return Binder.map_bound(self, (trait_ref) => HostEffectClause.self_ty(trait_ref));
  },

  // #[inline]
  // rustc: compiler/rustc_type_ir/src/predicate.rs:700 constness
  constness(self: Binder<HostEffectClause>): BoundConstness {
    return Binder.skip_binder(self).constness;
  },
};

// ---- BoundConstness ----------------------------------------------------------------------------------------------------

export const BoundConstness = {
  ...gen.BoundConstness,

  // rustc: compiler/rustc_type_ir/src/predicate.rs:751 satisfies
  satisfies(self: BoundConstness, goal: BoundConstness): boolean {
    if (self === "Const" && (goal === "Const" || goal === "Maybe")) return true;
    if (self === "Maybe" && goal === "Maybe") return true;
    // (BoundConstness::Maybe, BoundConstness::Const)
    return false;
  },

  // rustc: compiler/rustc_type_ir/src/predicate.rs:759 as_str
  as_str(self: BoundConstness): string {
    switch (self) {
      case "Const":
        return "const";
      case "Maybe":
        return "[const]";
    }
  },
};

/** `impl fmt::Display for BoundConstness` */
// rustc: compiler/rustc_type_ir/src/predicate.rs:768 fmt
export function display_BoundConstness(self: BoundConstness): string {
  switch (self) {
    case "Const":
      return "const";
    case "Maybe":
      return "[const]";
  }
}
