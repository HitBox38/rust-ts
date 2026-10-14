// Port of compiler/rustc_type_ir/src/unnormalized.rs (lane tyir-misc, sub-lane predicate). The type with its derived
// Debug / TypeVisitable impls is generated into unnormalized.gen.ts (set rustc_ty of tools/codegen/types.ts, lane
// codegen-tyir); this file holds the inherent methods and the manual `TypeFoldable` impl, in upstream order.
//
// PORT (D3): `I: Interner` is erased; `_tcx: PhantomData<fn() -> I>` is the generated field `_tcx: undefined`.
// PORT: the methods of the generic `impl<I, T> Unnormalized<I, T>` block and of the blocks generic over a type
// parameter (`Unnormalized<I, (T, U)>`, `Unnormalized<I, Binder<I, T>>`) live on the companion `Unnormalized` taking
// `self` first. The blocks on concrete instantiations would clash by name (`self_ty` / `def_id` exist for both
// `Binder<TraitClause>` and `Binder<TraitRef>`), so each is a companion named after rustc_middle's alias of the wrapped
// type: `UnnormalizedClause` (`Unnormalized<I, I::Clause>`), `UnnormalizedPolyTraitClause`
// (`Unnormalized<I, Binder<I, TraitClause<I>>>`), `UnnormalizedPolyTraitRef` (`Unnormalized<I, Binder<I, TraitRef<I>>>`).
// PORT: the manual `impl TypeFoldable for Unnormalized` is the free fns `try_fold_with_Unnormalized` /
// `fold_with_Unnormalized` (the names generated code imports, codegen-tyir §4); `T`'s impl fns are parameters.
// `as_ref` / `map_ref` borrow: `&T` is `T`.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { Ok, type Result } from "../std/result.ts";
import { Binder } from "./binder.ts";
import type { FallibleTypeFolder, FoldWith, TryFoldWith, TypeFolder } from "./fold.ts";
import { type BoundConstness, type ClausePolarity, Clause_upcast_from_Binder_ClauseKind, PolyTraitClause, PolyTraitRef, TraitClause, type TraitRef } from "./predicate.ts";
import type { ClauseKind } from "./predicate_kind.gen.ts";
import type * as gen from "./unnormalized.gen.ts";

export * from "./unnormalized.gen.ts";

export type Unnormalized<T> = gen.Unnormalized<T>;
export const Unnormalized = {
  /// Should only be used in limited situations where you produce an potentially
  /// unnormalized value, like in (Early)Binder/GenericClauses instantiation.
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:44 new
  new<T>(value: T): Unnormalized<T> {
    return { value, _tcx: undefined };
  },

  /// Should be used in case we have an already normalized input as an argument to
  /// a function that also expects unnormalized inputs, e.g. getting the tail of a
  /// type is normalized for tuples, but unnormalized for ADTs.
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:51 dummy
  dummy<T>(value: T): Unnormalized<T> {
    return { value, _tcx: undefined };
  },

  /// FIXME: This is going to be eventually removed once we migrate the relevant
  /// APIs to return `Unnormalized`.
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:57 new_wip
  new_wip<T>(value: T): Unnormalized<T> {
    return { value, _tcx: undefined };
  },

  /// Intentionally skip normalization.
  /// You probably should perform normalization in most cases.
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:63 skip_normalization
  skip_normalization<T>(self: Unnormalized<T>): T {
    return self.value;
  },

  /// FIXME: This is going to be eventually removed.
  /// If you meet this in codebase, try using one of the normalization routines
  /// to consume the `Unnormalized` wrapper. Or use `skip_normalization` when normalization
  /// is really unnecessary.
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:71 skip_norm_wip
  skip_norm_wip<T>(self: Unnormalized<T>): T {
    return self.value;
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:75 map
  map<T, U>(self: Unnormalized<T>, f: (value: T) => U): Unnormalized<U> {
    return { value: f(self.value), _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:82 as_ref
  as_ref<T>(self: Unnormalized<T>): Unnormalized<T> {
    return { value: self.value, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:86 map_ref
  map_ref<T, U>(self: Unnormalized<T>, f: (value: T) => U): Unnormalized<U> {
    return { value: f(self.value), _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:105 unzip
  unzip<T, U>(self: Unnormalized<[T, U]>): [Unnormalized<T>, Unnormalized<U>] {
    return [Unnormalized.new(self.value[0]), Unnormalized.new(self.value[1])];
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:111 skip_binder
  skip_binder<T>(self: Unnormalized<Binder<T>>): T {
    return Binder.skip_binder(self.value);
  },
};

/** `impl<I: Interner, T: TypeFoldable<I>> TypeFoldable<I> for Unnormalized<I, T>` (try_fold_with) */
// rustc: compiler/rustc_type_ir/src/unnormalized.rs:95 try_fold_with
export function try_fold_with_Unnormalized<T, E>(self: Unnormalized<T>, folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<Unnormalized<T>, E> {
  const value = try_fold_with_T(self.value, folder);
  if (value.$ === "Err") return value;
  return Ok(Unnormalized.new(value._0));
}

/** `impl<I: Interner, T: TypeFoldable<I>> TypeFoldable<I> for Unnormalized<I, T>` (fold_with) */
// rustc: compiler/rustc_type_ir/src/unnormalized.rs:99 fold_with
export function fold_with_Unnormalized<T>(self: Unnormalized<T>, folder: TypeFolder, fold_with_T: FoldWith<T>): Unnormalized<T> {
  return Unnormalized.new(fold_with_T(self.value, folder));
}

/** The methods of `impl<I: Interner> Unnormalized<I, I::Clause>`. */
export const UnnormalizedClause = {
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:117 as_trait_clause
  as_trait_clause(self: Unnormalized<Clause>): Unnormalized<Binder<TraitClause>> | undefined {
    const v = self.value.as_trait_clause();
    return v === undefined ? undefined : Unnormalized.new(v);
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:121 kind
  kind(self: Unnormalized<Clause>): Unnormalized<Binder<ClauseKind>> {
    return Unnormalized.map(self, (v) => v.kind());
  },
};

/** The methods of `impl<I: Interner> Unnormalized<I, Binder<I, TraitClause<I>>>`. */
export const UnnormalizedPolyTraitClause = {
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:127 self_ty
  self_ty(self: Unnormalized<Binder<TraitClause>>): Unnormalized<Binder<Ty>> {
    return Unnormalized.map(self, (pred) => PolyTraitClause.self_ty(pred));
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:131 def_id
  def_id(self: Unnormalized<Binder<TraitClause>>): DefId {
    return TraitClause.def_id(Binder.skip_binder(self.value));
  },

  // #[inline]
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:136 polarity
  polarity(self: Unnormalized<Binder<TraitClause>>): ClausePolarity {
    return Binder.skip_binder(self.value).polarity;
  },
};

/** The methods of `impl<I: Interner> Unnormalized<I, Binder<I, TraitRef<I>>>`. */
export const UnnormalizedPolyTraitRef = {
  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:142 self_ty
  self_ty(self: Unnormalized<Binder<TraitRef>>): Unnormalized<Binder<Ty>> {
    return Unnormalized.map_ref(self, (tr) => PolyTraitRef.self_ty(tr));
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:146 def_id
  def_id(self: Unnormalized<Binder<TraitRef>>): DefId {
    return Binder.skip_binder(self.value).def_id;
  },

  // rustc: compiler/rustc_type_ir/src/unnormalized.rs:150 to_host_effect_clause
  to_host_effect_clause(self: Unnormalized<Binder<TraitRef>>, cx: TyCtxt, constness: BoundConstness): Unnormalized<Clause> {
    const inner = Clause_upcast_from_Binder_ClauseKind(
      Binder.map_bound(self.value, (trait_ref): ClauseKind => ({ $: "HostEffect", _0: { trait_ref, constness } })),
      cx,
    );
    return Unnormalized.new(inner);
  },
};
