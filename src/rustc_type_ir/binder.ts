// Port of compiler/rustc_type_ir/src/binder.rs (lane tyir-binder). The types with their derived Debug / TypeVisitable /
// TypeFoldable impls are generated into binder.gen.ts (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir); this
// file holds the inherent methods, the manual trait impls and the working structs (`ValidateBoundVars`, the
// `EarlyBinder` iterators, `ArgFolder`), in upstream order.
//
// PORT (D3): `I: Interner` is erased; `cx: I` is `TyCtxt`. Methods of the generated structs and enums live on a
// same-named companion const taking `self` first (`Binder.skip_binder(b)`, `EarlyBinder.instantiate(b, cx, args, d)`;
// enum companions spread the generated unit-variant singletons, PORTING §8). The companions hold every method of the
// type, so the `impl TypeFoldable / TypeVisitable / TypeSuper* for Binder` block (:64-:97), which upstream sits
// between `bind_with_vars` and `skip_binder`, follows the `Binder` companion (§8, markers keep the upstream lines).
// PORT (D4): a method generic over `T: TypeVisitable / TypeFoldable` takes the descriptor `d` of `T` last. The
// `TypeVisitable` bounds that only feed `cfg!(debug_assertions)` validation (`bind_with_vars`, `map_bound`,
// `try_map_bound`, `rebind`) take none: the oracle is a release build, so those blocks are comments.
// PORT: `T: fmt::Debug` (a supertrait of `TypeVisitable`) is not part of the D4 descriptors. The two `assert!`s whose
// message prints a generic `T` (`Binder::dummy`, `EarlyBinder::instantiate`) stop as UNPORTED when they fail instead of
// panicking with the formatted value.
// PORT: an `IntoIterator` value (`Binder<I, T: IntoIterator>`, `EarlyBinder<I, Iter>`) is a `readonly T[]`; its
// `IntoIter` is `SliceIntoIter` (end of file).
import { ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ParamEnv } from "../rustc_middle/ty/decls.ts";
import { debug_GenericArgsSlice, GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { debug_RawList, type BoundVarKinds, type Clauses, RawList } from "../rustc_middle/ty/list.ts";
import { debug_Ty, Ty } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { debug_EarlyParamRegion, type EarlyParamRegion } from "../rustc_middle/ty/region.ts";
import type { ParamConst, ParamTy } from "../rustc_middle/ty/sty.ts";
import { debug_ParamTy } from "../rustc_middle/ty/structural_impls.ts";
import { debug_DefId, DefId_eq, type DefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { debug_Symbol, kw, type Symbol } from "../rustc_span/symbol.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { type Debug, type Fmt, PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";
import * as gen from "./binder.gen.ts";
import { type FallibleTypeFolder, type FoldWith, type PredicateProxy, set_aliases_to_non_rigid, shift_region, shift_vars, type TryFoldWith, type TypeFoldable, type TypeFolder, type TypeSuperFoldable } from "./fold.ts";
import { debug_GenericArgKind, type GenericArgKind } from "./generic_arg.ts";
import { type BoundVar, DebruijnIndex, debug_BoundVar, INNERMOST, UniverseIndex } from "./lib.ts";
import type { TraitRef } from "./predicate.ts";
import { type Const, debug_Const, debug_Region, fold_Const, fold_Region, type Region } from "./sty/mod.ts";
import { Unnormalized } from "./unnormalized.ts";
import { type TypeSuperVisitable, type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided, type VisitWith, visit_with_tuple2 } from "./visit.ts";
import { fold_Clauses, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";

export * from "./binder.gen.ts";

// ---- Binder --------------------------------------------------------------------------------------------------------

/// `Binder` is a binder for higher-ranked lifetimes or types. It is part of the
/// compiler's representation for things like `for<'a> Fn(&'a isize)`
/// (which would be represented by the type `PolyTraitRef == Binder<I, TraitRef>`).
///
/// See <https://rustc-dev-guide.rust-lang.org/ty_module/instantiating_binders.html>
/// for more details.
export type Binder<T> = gen.Binder<T>;
export const Binder = {
  /// Wraps `value` in a binder, asserting that `value` does not
  /// contain any bound vars that would be bound by the
  /// binder. This is commonly used to 'inject' a value T into a
  /// different binding level.
  // PORT: D4 descriptor `d` of `T`; the failing `assert!` is UNPORTED (module comment).
  // rustc: compiler/rustc_type_ir/src/binder.rs:47 dummy
  dummy<T>(value: T, d: TypeVisitable<T>): Binder<T> {
    if (TypeVisitableExt.has_escaping_bound_vars(value, d)) {
      return unported("rustc_type_ir::binder::Binder::dummy: assert! message needs `{value:?}` (`T: Debug` of a D4 descriptor): `..` has escaping bound vars, so it cannot be wrapped in a dummy binder.");
    }
    return { value, bound_vars: RawList.empty() };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:55 bind_with_vars
  bind_with_vars<T>(value: T, bound_vars: BoundVarKinds): Binder<T> {
    // if cfg!(debug_assertions) {
    //     let mut validator = ValidateBoundVars::new(bound_vars);
    //     let _ = value.visit_with(&mut validator);
    // }
    return { value, bound_vars };
  },

  /// Returns the value contained inside of this `for<'a>`. Accessing generic args
  /// in the returned value is generally incorrect.
  ///
  /// Please read <https://rustc-dev-guide.rust-lang.org/ty_module/instantiating_binders.html>
  /// before using this function. It is usually better to discharge the binder using
  /// `no_bound_vars` or `instantiate_bound_regions` or something like that.
  ///
  /// `skip_binder` is only valid when you are either extracting data that does not reference
  /// any generic arguments, e.g. a `DefId`, or when you're making sure you only pass the
  /// value to things which can handle escaping bound vars.
  ///
  /// See existing uses of `.skip_binder()` in `rustc_trait_selection::traits::select`
  /// or `rustc_next_trait_solver` for examples.
  // rustc: compiler/rustc_type_ir/src/binder.rs:113 skip_binder
  skip_binder<T>(self: Binder<T>): T {
    return self.value;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:117 bound_vars
  bound_vars<T>(self: Binder<T>): BoundVarKinds {
    return self.bound_vars;
  },

  // PORT: `&T` is `T` (PORTING §5).
  // rustc: compiler/rustc_type_ir/src/binder.rs:121 as_ref
  as_ref<T>(self: Binder<T>): Binder<T> {
    return { value: self.value, bound_vars: self.bound_vars };
  },

  // PORT: `&T::Target` is `T`: the `Deref` impls of the port (`Box`, `Arc`, `&`) are the identity.
  // rustc: compiler/rustc_type_ir/src/binder.rs:125 as_deref
  as_deref<T>(self: Binder<T>): Binder<T> {
    return { value: self.value, bound_vars: self.bound_vars };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:132 map_bound_ref
  map_bound_ref<T, U>(self: Binder<T>, f: (value: T) => U): Binder<U> {
    return Binder.map_bound(Binder.as_ref(self), f);
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:139 map_bound
  map_bound<T, U>(self: Binder<T>, f: (value: T) => U): Binder<U> {
    const { value: value_, bound_vars } = self;
    const value = f(value_);
    // if cfg!(debug_assertions) {
    //     let mut validator = ValidateBoundVars::new(bound_vars);
    //     let _ = value.visit_with(&mut validator);
    // }
    return { value, bound_vars };
  },

  /// There are some uses of `map_bound` which are incredibly hot and trivially
  /// correct. Only use this if this significantly improves the performance of
  /// builds with debug assertions.
  // rustc: compiler/rustc_type_ir/src/binder.rs:155 map_bound_no_validate_bound_vars
  map_bound_no_validate_bound_vars<T, U>(self: Binder<T>, f: (value: T) => U): Binder<U> {
    const { value: value_, bound_vars } = self;
    const value = f(value_);
    return { value, bound_vars };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:164 try_map_bound
  try_map_bound<T, U, E>(self: Binder<T>, f: (value: T) => Result<U, E>): Result<Binder<U>, E> {
    const { value: value_, bound_vars } = self;
    const r = f(value_);
    if (r.$ === "Err") return r;
    const value = r._0;
    // if cfg!(debug_assertions) {
    //     let mut validator = ValidateBoundVars::new(bound_vars);
    //     let _ = value.visit_with(&mut validator);
    // }
    return Ok({ value, bound_vars });
  },

  /// Wraps a `value` in a binder, using the same bound variables as the
  /// current `Binder`. This should not be used if the new value *changes*
  /// the bound variables. Note: the (old or new) value itself does not
  /// necessarily need to *name* all the bound variables.
  ///
  /// This currently doesn't do anything different than `bind`, because we
  /// don't actually track bound vars. However, semantically, it is different
  /// because bound vars aren't allowed to change here, whereas they are
  /// in `bind`. This may be (debug) asserted in the future.
  // rustc: compiler/rustc_type_ir/src/binder.rs:186 rebind
  rebind<T, U>(self: Binder<T>, value: U): Binder<U> {
    return Binder.bind_with_vars(value, self.bound_vars);
  },

  /// Unwraps and returns the value within, but only if it contains
  /// no bound vars at all. (In other words, if this binder --
  /// and indeed any enclosing binder -- doesn't bind anything at
  /// all.) Otherwise, returns `None`.
  ///
  /// (One could imagine having a method that just unwraps a single
  /// binder, but permits late-bound vars bound by enclosing
  /// binders, but that would require adjusting the debruijn
  /// indices, and given the shallow binding structure we often use,
  /// would not be that useful.)
  // PORT: D4 descriptor `d` of `T`.
  // rustc: compiler/rustc_type_ir/src/binder.rs:203 no_bound_vars
  no_bound_vars<T>(self: Binder<T>, d: TypeVisitable<T>): T | undefined {
    // `self.value` is equivalent to `self.skip_binder()`
    if (TypeVisitableExt.has_escaping_bound_vars(self.value, d)) {
      return undefined;
    } else {
      return Binder.skip_binder(self);
    }
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:213 transpose
  transpose<T>(self: Binder<T | undefined>): Binder<T> | undefined {
    const { value, bound_vars } = self;
    return value === undefined ? undefined : { value, bound_vars };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:220 iter
  *iter<T>(self: Binder<Iterable<T>>): Generator<Binder<T>> {
    const { value: values, bound_vars } = self;
    for (const value of values) yield { value, bound_vars };
  },
};

/** The D4 descriptor of `Binder<T>`: `impl TypeFoldable` (:64), `TypeVisitable` (:74), `TypeSuperFoldable` (:80),
 *  `TypeSuperVisitable` (:93), given the descriptor `d` of `T`. */
export function fold_Binder<T>(d: TypeFoldable<T>): TypeSuperFoldable<Binder<T>> & TypeSuperVisitable<Binder<T>> {
  return {
    // rustc: compiler/rustc_type_ir/src/binder.rs:65 try_fold_with
    try_fold_with<E>(self: Binder<T>, folder: FallibleTypeFolder<E>): Result<Binder<T>, E> {
      return folder.try_fold_binder(self, d);
    },

    // rustc: compiler/rustc_type_ir/src/binder.rs:69 fold_with
    fold_with(self: Binder<T>, folder: TypeFolder): Binder<T> {
      return folder.fold_binder(self, d);
    },

    // rustc: compiler/rustc_type_ir/src/binder.rs:75 visit_with
    visit_with<R>(self: Binder<T>, visitor: TypeVisitor<R>): R {
      return visitor.visit_binder(self, d);
    },

    // rustc: compiler/rustc_type_ir/src/binder.rs:81 try_super_fold_with
    try_super_fold_with<E>(self: Binder<T>, folder: FallibleTypeFolder<E>): Result<Binder<T>, E> {
      return Binder.try_map_bound(self, (t) => d.try_fold_with(t, folder));
    },

    // rustc: compiler/rustc_type_ir/src/binder.rs:88 super_fold_with
    super_fold_with(self: Binder<T>, folder: TypeFolder): Binder<T> {
      return Binder.map_bound(self, (t) => d.fold_with(t, folder));
    },

    // rustc: compiler/rustc_type_ir/src/binder.rs:94 super_visit_with
    super_visit_with<R>(self: Binder<T>, visitor: TypeVisitor<R>): R {
      return d.visit_with(Binder.skip_binder(Binder.as_ref(self)), visitor);
    },
  };
}

/** The visit half of `fold_Binder` (`impl<T: TypeVisitable> TypeVisitable / TypeSuperVisitable for Binder`): its
 *  visit methods only use `d.visit_with`. */
export function visit_Binder<T>(d: TypeVisitable<T>): TypeSuperVisitable<Binder<T>> {
  return fold_Binder(d as TypeFoldable<T>);
}

// PORT (merge-w13): the impls of `fold_Binder` as tools/codegen's generated code calls them (type_fold.json shape:
// one impl fn of `T`). The folder / visitor methods take `T`'s whole descriptor; the parts not passed by the caller
// stop as UNPORTED if a folder / visitor reaches them (D4 gap, see the handoff: the generator should pass descriptors).
export function visit_with_Binder<T, R>(self: Binder<T>, visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {
  return fold_Binder(partial_descriptor<T>({ visit_with: visit_with_T })).visit_with(self, visitor);
}
export function try_fold_with_Binder<T, E>(self: Binder<T>, folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<Binder<T>, E> {
  return fold_Binder(partial_descriptor<T>({ try_fold_with: try_fold_with_T })).try_fold_with(self, folder);
}
export function fold_with_Binder<T>(self: Binder<T>, folder: TypeFolder, fold_with_T: FoldWith<T>): Binder<T> {
  return fold_Binder(partial_descriptor<T>({ fold_with: fold_with_T })).fold_with(self, folder);
}

/** PORT: a `TypeFoldable<T>` from the impl fns a generated caller has; the missing ones call `unported`. */
function partial_descriptor<T>(fns: Partial<TypeFoldable<T>>): TypeFoldable<T> {
  return {
    visit_with: fns.visit_with ?? (() => unported("rustc_type_ir::binder: TypeVisitable::visit_with of a Binder's value (generated caller passed no visit impl)")),
    try_fold_with: fns.try_fold_with ?? (() => unported("rustc_type_ir::binder: TypeFoldable::try_fold_with of a Binder's value (generated caller passed no try_fold impl)")),
    fold_with: fns.fold_with ?? (() => unported("rustc_type_ir::binder: TypeFoldable::fold_with of a Binder's value (generated caller passed no fold impl)")),
  };
}

// ---- ValidateBoundVars ---------------------------------------------------------------------------------------------

// rustc-type: compiler/rustc_type_ir/src/binder.rs:226 ValidateBoundVars
export class ValidateBoundVars implements TypeVisitor<ControlFlow<null>> {
  readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(
    public bound_vars: BoundVarKinds,
    public binder_index: DebruijnIndex,
    // We only cache types because any complex const will have to step through
    // a type at some point anyways. We may encounter the same variable at
    // different levels of binding, so this can't just be `Ty`.
    // PORT: `SsoHashSet<(DebruijnIndex, Ty)>`, only probed for membership (D6): a `KeyedSet` on the pair.
    public visited: KeyedSet<[DebruijnIndex, Ty]>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/binder.rs:236 new
  static new(bound_vars: BoundVarKinds): ValidateBoundVars {
    return new ValidateBoundVars(bound_vars, INNERMOST, new KeyedSet<[DebruijnIndex, Ty]>(([i, t]) => `${i}#${t.id}`));
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:248 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    this.binder_index = DebruijnIndex.shifted_in(this.binder_index, 1);
    const result = visit_Binder(d).super_visit_with(t, this);
    this.binder_index = DebruijnIndex.shifted_out(this.binder_index, 1);
    return result;
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:255 visit_ty
  visit_ty(t: Ty): ControlFlow<null> {
    if (t.outer_exclusive_binder() <= this.binder_index || !set_insert(this.visited, [this.binder_index, t])) {
      return ControlFlow.CONTINUE;
    }
    const k = t.kind();
    if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 === this.binder_index) {
      const bound_ty = k._1;
      const idx = bound_ty.var;
      if (this.bound_vars.length <= idx) {
        panic(`Not enough bound vars: ${debug_Ty(t, PLAIN)} not found in ${debug_BoundVarKinds(this.bound_vars, PLAIN)}`);
      }
      BoundTy.assert_eq(bound_ty, unwrap(this.bound_vars[idx]));
    }

    return fold_Ty.super_visit_with(t, this);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:277 visit_const
  visit_const(c: Const): ControlFlow<null> {
    if (c.outer_exclusive_binder() <= this.binder_index) {
      return ControlFlow.CONTINUE;
    }
    const k = c.kind();
    if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 === this.binder_index) {
      const bound_const = k._1;
      const idx = bound_const.var;
      if (this.bound_vars.length <= idx) {
        panic(`Not enough bound vars: ${debug_Const(c, PLAIN)} not found in ${debug_BoundVarKinds(this.bound_vars, PLAIN)}`);
      }
      BoundConst.assert_eq(bound_const, unwrap(this.bound_vars[idx]));
    }

    return fold_Const.super_visit_with(c, this);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:297 visit_region
  visit_region(r: Region): ControlFlow<null> {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 === this.binder_index) {
      const br = k._1;
      const idx = BoundRegion.var(br);
      if (this.bound_vars.length <= idx) {
        panic(`Not enough bound vars: ${debug_Region(r, PLAIN)} not found in ${debug_BoundVarKinds(this.bound_vars, PLAIN)}`);
      }
      BoundRegion.assert_eq(br, unwrap(this.bound_vars[idx]));
    }

    return ControlFlow.CONTINUE;
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** PORT: `HashSet::insert` (true when the value was not present). */
function set_insert<K>(set: Set<K>, k: K): boolean {
  if (set.has(k)) return false;
  set.add(k);
  return true;
}

/** `{:?}` of `I::BoundVarKinds` (`&List<BoundVariableKind>`). */
function debug_BoundVarKinds(v: BoundVarKinds, f: Fmt): string {
  return debug_RawList(v, f, gen.debug_BoundVariableKind);
}

// ---- EarlyBinder ---------------------------------------------------------------------------------------------------

/// Similar to [`Binder`] except that it tracks early bound generics, i.e. `struct Foo<T>(T)`
/// needs `T` instantiated immediately. This type primarily exists to avoid forgetting to call
/// `instantiate`.
///
/// See <https://rustc-dev-guide.rust-lang.org/ty_module/early_binder.html> for more details.
// PORT: the negative impls `!TypeFoldable` / `!TypeVisitable` (:338-:342) mean no descriptor exists for it.
export type EarlyBinder<T> = gen.EarlyBinder<T>;
export const EarlyBinder = {
  // PORT: D4 descriptor `d` of `T`.
  // rustc: compiler/rustc_type_ir/src/binder.rs:346 bind
  bind<T>(cx: TyCtxt, value_: T, d: TypeFoldable<T>): EarlyBinder<T> {
    // Instantiation will require normalization.
    // PORT: `Unnormalized::skip_normalization` (unnormalized.rs:63, not ported yet) is the field read.
    const value = set_aliases_to_non_rigid(cx, value_, d).value;
    return { value, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:354 bind_iter
  bind_iter<T>(value: T): EarlyBinder<T> {
    // #[cfg(debug_assertions)]
    // {
    //     value.clone().into_iter().for_each(|v| assert!(!v.has_rigid_aliases()));
    // }

    return { value, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:365 bind_no_rigid_aliases
  bind_no_rigid_aliases<T>(value: T): EarlyBinder<T> {
    // debug_assert!(!value.has_rigid_aliases());
    return { value, _tcx: undefined };
  },

  /// Use `bind/bind_iter/bind_no_rigid_aliases` instead.
  /// Don't use this unless you know what you're doing.
  // rustc: compiler/rustc_type_ir/src/binder.rs:374 bind_unchecked
  bind_unchecked<T>(value: T): EarlyBinder<T> {
    return { value, _tcx: undefined };
  },

  // PORT: `&T` is `T` (PORTING §5).
  // rustc: compiler/rustc_type_ir/src/binder.rs:380 as_ref
  as_ref<T>(self: EarlyBinder<T>): EarlyBinder<T> {
    return { value: self.value, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:384 map_bound_ref
  map_bound_ref<T, U>(self: EarlyBinder<T>, f: (value: T) => U): EarlyBinder<U> {
    return EarlyBinder.map_bound(EarlyBinder.as_ref(self), f);
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:391 map_bound
  map_bound<T, U>(self: EarlyBinder<T>, f: (value: T) => U): EarlyBinder<U> {
    const value = f(self.value);
    return { value, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:399 try_map_bound
  try_map_bound<T, U, E>(self: EarlyBinder<T>, f: (value: T) => Result<U, E>): Result<EarlyBinder<U>, E> {
    const r = f(self.value);
    if (r.$ === "Err") return r;
    const value = r._0;
    return Ok({ value, _tcx: undefined });
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:407 rebind
  rebind<T, U>(_self: EarlyBinder<T>, value: U): EarlyBinder<U> {
    return { value, _tcx: undefined };
  },

  /// Skips the binder and returns the "bound" value. Accessing generic args
  /// in the returned value is generally incorrect.
  ///
  /// Please read <https://rustc-dev-guide.rust-lang.org/ty_module/early_binder.html>
  /// before using this function.
  ///
  /// Only use this to extract data that does not depend on generic parameters, e.g.
  /// to get the `DefId` of the inner value or the number of arguments ofan `FnSig`,
  /// or while making sure to only pass the value to functions which are explicitly
  /// set up to handle these uninstantiated generic parameters.
  ///
  /// To skip the binder on `x: &EarlyBinder<I, T>` to obtain `&T`, leverage
  /// [`EarlyBinder::as_ref`](EarlyBinder::as_ref): `x.as_ref().skip_binder()`.
  ///
  /// See also [`Binder::skip_binder`](Binder::skip_binder), which is
  /// the analogous operation on [`Binder`].
  // rustc: compiler/rustc_type_ir/src/binder.rs:427 skip_binder
  skip_binder<T>(self: EarlyBinder<T>): T {
    return self.value;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:433 def_id
  def_id(self: EarlyBinder<TraitRef>): DefId {
    return self.value.def_id;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:439 transpose
  transpose<T>(self: EarlyBinder<T | undefined>): EarlyBinder<T> | undefined {
    const value = self.value;
    return value === undefined ? undefined : { value, _tcx: undefined };
  },

  // PORT: D4 descriptor `d` of the item type; `args: A: SliceLike<Item = I::GenericArg>` is the slice.
  // rustc: compiler/rustc_type_ir/src/binder.rs:448 iter_instantiated
  iter_instantiated<T>(self: EarlyBinder<readonly T[]>, cx: TyCtxt, args: readonly GenericArg[], d: TypeFoldable<T>): IterInstantiated<T> {
    return new IterInstantiated(SliceIntoIter.new(self.value), cx, args, d);
  },

  /// Similar to [`instantiate_identity`](EarlyBinder::instantiate_identity),
  /// but on an iterator of `TypeFoldable` values.
  // rustc: compiler/rustc_type_ir/src/binder.rs:457 iter_identity
  *iter_identity<T>(self: EarlyBinder<Iterable<T>>): Generator<Unnormalized<T>> {
    for (const v of self.value) yield Unnormalized.new(v);
  },

  // PORT: D4 descriptor `d` of the item type (`<Iter::Item as Deref>::Target`; the deref copy is the identity).
  // rustc: compiler/rustc_type_ir/src/binder.rs:514 iter_instantiated_copied
  iter_instantiated_copied<T>(self: EarlyBinder<readonly T[]>, cx: TyCtxt, args: readonly GenericArg[], d: TypeFoldable<T>): IterInstantiatedCopied<T> {
    return new IterInstantiatedCopied(SliceIntoIter.new(self.value), cx, args, d);
  },

  /// Similar to [`instantiate_identity`](EarlyBinder::instantiate_identity),
  /// but on an iterator of values that deref to a `TypeFoldable`.
  // rustc: compiler/rustc_type_ir/src/binder.rs:524 iter_identity_copied
  iter_identity_copied<T>(self: EarlyBinder<readonly T[]>): IterIdentityCopied<T> {
    return new IterIdentityCopied(SliceIntoIter.new(self.value), undefined);
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:633 transpose_iter
  transpose_iter<T>(self: EarlyBinder<readonly T[]>): EarlyBinderIter<T> {
    return new EarlyBinderIter(SliceIntoIter.new(self.value), undefined);
  },

  // PORT: D4 descriptor `d` of `T`; `args: A: SliceLike<Item = I::GenericArg>` is the slice. The failing `assert!` is
  // UNPORTED (module comment).
  // rustc: compiler/rustc_type_ir/src/binder.rs:651 instantiate
  instantiate<T>(self: EarlyBinder<T>, cx: TyCtxt, args: readonly GenericArg[], d: TypeFoldable<T>): Unnormalized<T> {
    // Nothing to fold, so let's avoid visiting things and possibly re-hashing/equating
    // them when interning. Perf testing found this to be a modest improvement.
    // See: <https://github.com/rust-lang/rust/pull/142317>
    if (args.length === 0) {
      if (TypeVisitableExt.has_param(self.value, d)) {
        return unported("rustc_type_ir::binder::EarlyBinder::instantiate: assert! message needs `{:?}` of the value (`T: Debug` of a D4 descriptor): .. has parameters, but no args were provided in instantiate");
      }
      return Unnormalized.new(self.value);
    }
    const folder = new ArgFolder(cx, args, 0);
    return Unnormalized.new(d.fold_with(self.value, folder));
  },

  /// Makes the identity replacement `T0 => T0, ..., TN => TN`.
  /// Conceptually, this converts universally bound variables into placeholders
  /// when inside of a given item.
  ///
  /// For example, consider `for<T> fn foo<T>(){ .. }`:
  /// - Outside of `foo`, `T` is bound (represented by the presence of `EarlyBinder`).
  /// - Inside of the body of `foo`, we treat `T` as a placeholder by calling
  /// `instantiate_identity` to discharge the `EarlyBinder`.
  // rustc: compiler/rustc_type_ir/src/binder.rs:678 instantiate_identity
  instantiate_identity<T>(self: EarlyBinder<T>): Unnormalized<T> {
    // FIXME(#155345): In case the bound value was already normalized, this
    // is unnecessary. We may want to track explicitly whether `EarlyBinder`
    // contains something that has been normalized already.
    // Also do that for other types who have `instantiate_identity` method,
    // e.g., `GenericClauses` and `ConstConditions`.
    //
    // This is annoying, as e.g. `type_of` for opaque types is normalized,
    // while `type_of` for free type aliases is not.
    return Unnormalized.new(self.value);
  },

  /// Returns the inner value, but only if it contains no bound vars.
  // PORT: D4 descriptor `d` of `T`.
  // rustc: compiler/rustc_type_ir/src/binder.rs:691 no_bound_vars
  no_bound_vars<T>(self: EarlyBinder<T>, d: TypeVisitable<T>): T | undefined {
    if (!TypeVisitableExt.has_param(self.value, d)) {
      return self.value;
    } else {
      return undefined;
    }
  },
};

// rustc-type: compiler/rustc_type_ir/src/binder.rs:462 IterInstantiated
export class IterInstantiated<T> implements Iterable<Unnormalized<T>> {
  constructor(
    public it: SliceIntoIter<T>,
    public cx: TyCtxt,
    public args: readonly GenericArg[],
    /** PORT: D4 descriptor of `Iter::Item`. */
    public d: TypeFoldable<T>,
  ) {}

  // impl Iterator for IterInstantiated: type Item = Unnormalized<I, Iter::Item>;

  // rustc: compiler/rustc_type_ir/src/binder.rs:475 next
  next(): Unnormalized<T> | undefined {
    const value = this.it.next();
    if (value === undefined) return undefined;
    return EarlyBinder.instantiate<T>({ value, _tcx: undefined }, this.cx, this.args, this.d);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:482 size_hint
  size_hint(): [number, number | undefined] {
    return this.it.size_hint();
  }

  // impl DoubleEndedIterator for IterInstantiated
  // rustc: compiler/rustc_type_ir/src/binder.rs:493 next_back
  next_back(): Unnormalized<T> | undefined {
    const value = this.it.next_back();
    if (value === undefined) return undefined;
    return EarlyBinder.instantiate<T>({ value, _tcx: undefined }, this.cx, this.args, this.d);
  }

  // impl ExactSizeIterator for IterInstantiated (no methods)

  // PORT: lets `for (const x of it)` drive `next` like a Rust `for` loop.
  *[globalThis.Symbol.iterator](): Iterator<Unnormalized<T>> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }
}

// rustc-type: compiler/rustc_type_ir/src/binder.rs:529 IterInstantiatedCopied
export class IterInstantiatedCopied<T> implements Iterable<Unnormalized<T>> {
  constructor(
    public it: SliceIntoIter<T>,
    public cx: TyCtxt,
    public args: readonly GenericArg[],
    /** PORT: D4 descriptor of `<Iter::Item as Deref>::Target`. */
    public d: TypeFoldable<T>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/binder.rs:538 clone
  clone(): IterInstantiatedCopied<T> {
    return new IterInstantiatedCopied(this.it.clone(), this.cx, this.args, this.d);
  }

  // impl Iterator for IterInstantiatedCopied: type Item = Unnormalized<I, <Iter::Item as Deref>::Target>;

  // rustc: compiler/rustc_type_ir/src/binder.rs:550 next
  next(): Unnormalized<T> | undefined {
    const value = this.it.next();
    return value === undefined ? undefined : EarlyBinder.instantiate<T>({ value, _tcx: undefined }, this.cx, this.args, this.d);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:556 size_hint
  size_hint(): [number, number | undefined] {
    return this.it.size_hint();
  }

  // impl DoubleEndedIterator for IterInstantiatedCopied
  // rustc: compiler/rustc_type_ir/src/binder.rs:567 next_back
  next_back(): Unnormalized<T> | undefined {
    const value = this.it.next_back();
    return value === undefined ? undefined : EarlyBinder.instantiate<T>({ value, _tcx: undefined }, this.cx, this.args, this.d);
  }

  // impl ExactSizeIterator for IterInstantiatedCopied (no methods)

  // PORT: lets `for (const x of it)` drive `next` like a Rust `for` loop.
  *[globalThis.Symbol.iterator](): Iterator<Unnormalized<T>> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }
}

// rustc-type: compiler/rustc_type_ir/src/binder.rs:582 IterIdentityCopied
export class IterIdentityCopied<T> implements Iterable<Unnormalized<T>> {
  constructor(
    public it: SliceIntoIter<T>,
    public _tcx: undefined,
  ) {}

  // rustc: compiler/rustc_type_ir/src/binder.rs:588 clone
  clone(): IterIdentityCopied<T> {
    return new IterIdentityCopied(this.it.clone(), this._tcx);
  }

  // impl Iterator for IterIdentityCopied: type Item = Unnormalized<I, <Iter::Item as Deref>::Target>;

  // rustc: compiler/rustc_type_ir/src/binder.rs:600 next
  next(): Unnormalized<T> | undefined {
    const i = this.it.next();
    return i === undefined ? undefined : Unnormalized.new(i);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:604 size_hint
  size_hint(): [number, number | undefined] {
    return this.it.size_hint();
  }

  // impl DoubleEndedIterator for IterIdentityCopied
  // rustc: compiler/rustc_type_ir/src/binder.rs:615 next_back
  next_back(): Unnormalized<T> | undefined {
    const i = this.it.next_back();
    return i === undefined ? undefined : Unnormalized.new(i);
  }

  // impl ExactSizeIterator for IterIdentityCopied (no methods)

  // PORT: lets `for (const x of it)` drive `next` like a Rust `for` loop.
  *[globalThis.Symbol.iterator](): Iterator<Unnormalized<T>> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }
}

// rustc-type: compiler/rustc_type_ir/src/binder.rs:627 EarlyBinderIter
export class EarlyBinderIter<T> implements Iterable<EarlyBinder<T>> {
  constructor(
    public t: SliceIntoIter<T>,
    public _tcx: undefined,
  ) {}

  // impl Iterator for EarlyBinderIter: type Item = EarlyBinder<I, T::Item>;

  // rustc: compiler/rustc_type_ir/src/binder.rs:641 next
  next(): EarlyBinder<T> | undefined {
    const value = this.t.next();
    return value === undefined ? undefined : { value, _tcx: undefined };
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:645 size_hint
  size_hint(): [number, number | undefined] {
    return this.t.size_hint();
  }

  // PORT: lets `for (const x of it)` drive `next` like a Rust `for` loop.
  *[globalThis.Symbol.iterator](): Iterator<EarlyBinder<T>> {
    for (;;) {
      const n = this.next();
      if (n === undefined) return;
      yield n;
    }
  }
}

///////////////////////////////////////////////////////////////////////////
// The actual instantiation engine itself is a type folder.

// rustc-type: compiler/rustc_type_ir/src/binder.rs:699 ArgFolder
class ArgFolder implements TypeFolder {
  constructor(
    public cx_: TyCtxt,
    public args: readonly GenericArg[],

    /// Number of region binders we have passed through while doing the instantiation
    public binders_passed: number,
  ) {}

  // rustc: compiler/rustc_type_ir/src/binder.rs:709 cx
  cx(): TyCtxt {
    return this.cx_;
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:713 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.binders_passed += 1;
    const t_ = fold_Binder(d).super_fold_with(t, this);
    this.binders_passed -= 1;
    return t_;
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:720 fold_region
  fold_region(r: Region): Region {
    // Note: This routine only handles regions that are bound on
    // type declarations and other outer declarations, not those
    // bound in *fn types*. Region instantiation of the bound
    // regions that appear in a function signature is done using
    // the specialized routine `ty::replace_late_regions()`.
    const k = r.kind();
    switch (k.$) {
      case "ReEarlyParam": {
        const data = k._0;
        const arg = this.args[data.index];
        const rk = arg === undefined ? undefined : GenericArg.kind(arg);
        if (rk !== undefined && rk.$ === "Lifetime") {
          const lt = rk._0;
          return this.shift_region_through_binders(lt);
        } else if (rk !== undefined) {
          const other = rk;
          return this.region_param_expected(data, r, other);
        } else {
          return this.region_param_out_of_range(data, r);
        }
      }
      case "ReBound":
      case "ReLateParam":
      case "ReStatic":
      case "RePlaceholder":
      case "ReErased":
      case "ReError":
        return r;
      case "ReVar":
        return panic(`unexpected region: ${debug_Region(r, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:745 fold_ty
  fold_ty(t: Ty): Ty {
    if (!TypeVisitableExt.has_param(t, fold_Ty)) {
      return t;
    }

    const k = t.kind();
    if (k.$ === "Param") {
      const p = k._0;
      return this.ty_for_param(p, t);
    } else {
      return fold_Ty.super_fold_with(t, this);
    }
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:756 fold_const
  fold_const(c: Const): Const {
    const k = c.kind();
    if (k.$ === "Param") {
      const p = k._0;
      return this.const_for_param(p, c);
    } else {
      return fold_Const.super_fold_with(c, this);
    }
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:764 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (TypeVisitableExt.has_param(p, d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:768 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    if (TypeVisitableExt.has_param(c, fold_Clauses)) {
      return fold_Clauses.super_fold_with(c, this);
    } else {
      return c;
    }
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:774 ty_for_param
  ty_for_param(p: ParamTy, source_ty: Ty): Ty {
    // Look up the type in the args. It really should be in there.
    const arg = this.args[p.index];
    const opt_ty = arg === undefined ? undefined : GenericArg.kind(arg);
    let ty: Ty;
    if (opt_ty !== undefined && opt_ty.$ === "Type") {
      ty = opt_ty._0;
    } else if (opt_ty !== undefined) {
      const kind = opt_ty;
      ty = this.type_param_expected(p, source_ty, kind);
    } else {
      ty = this.type_param_out_of_range(p, source_ty);
    }

    return this.shift_vars_through_binders(ty, fold_Ty);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:788 type_param_expected
  type_param_expected(p: ParamTy, ty: Ty, kind: GenericArgKind): never {
    return panic(
      `expected type for \`${debug_ParamTy(p, PLAIN)}\` (${debug_Ty(ty, PLAIN)}/${p.index}) but found ${debug_GenericArgKind(kind, PLAIN)} when instantiating, args=${debug_GenericArgsSlice(this.args, PLAIN)}`,
    );
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:801 type_param_out_of_range
  type_param_out_of_range(p: ParamTy, ty: Ty): never {
    return panic(`type parameter \`${debug_ParamTy(p, PLAIN)}\` (${debug_Ty(ty, PLAIN)}/${p.index}) out of range when instantiating, args=${debug_GenericArgsSlice(this.args, PLAIN)}`);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:811 const_for_param
  const_for_param(p: ParamConst, source_ct: Const): Const {
    // Look up the const in the args. It really should be in there.
    const arg = this.args[p.index];
    const opt_ct = arg === undefined ? undefined : GenericArg.kind(arg);
    let ct: Const;
    if (opt_ct !== undefined && opt_ct.$ === "Const") {
      ct = opt_ct._0;
    } else if (opt_ct !== undefined) {
      const kind = opt_ct;
      ct = this.const_param_expected(p, source_ct, kind);
    } else {
      ct = this.const_param_out_of_range(p, source_ct);
    }

    return this.shift_vars_through_binders(ct, fold_Const);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:825 const_param_expected
  const_param_expected(p: ParamConst, ct: Const, kind: GenericArgKind): never {
    return panic(
      `expected const for \`${debug_ParamConst(p, PLAIN)}\` (${debug_Const(ct, PLAIN)}/${p.index}) but found ${debug_GenericArgKind(kind, PLAIN)} when instantiating args=${debug_GenericArgsSlice(this.args, PLAIN)}`,
    );
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:843 const_param_out_of_range
  const_param_out_of_range(p: ParamConst, ct: Const): never {
    return panic(`const parameter \`${debug_ParamConst(p, PLAIN)}\` (${debug_Const(ct, PLAIN)}/${p.index}) out of range when instantiating args=${debug_GenericArgsSlice(this.args, PLAIN)}`);
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:855 region_param_expected
  region_param_expected(ebr: EarlyParamRegion, r: Region, kind: GenericArgKind): never {
    return panic(
      `expected region for \`${debug_EarlyParamRegion(ebr, PLAIN)}\` (${debug_Region(r, PLAIN)}/${ebr.index}) but found ${debug_GenericArgKind(kind, PLAIN)} when instantiating args=${debug_GenericArgsSlice(this.args, PLAIN)}`,
    );
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:873 region_param_out_of_range
  region_param_out_of_range(ebr: EarlyParamRegion, r: Region): never {
    return panic(`region parameter \`${debug_EarlyParamRegion(ebr, PLAIN)}\` (${debug_Region(r, PLAIN)}/${ebr.index}) out of range when instantiating args=${debug_GenericArgsSlice(this.args, PLAIN)}`);
  }

  /// It is sometimes necessary to adjust the De Bruijn indices during instantiation. This occurs
  /// when we are instantiating a type with escaping bound vars into a context where we have
  /// passed through binders. That's quite a mouthful. Let's see an example:
  ///
  /// ```
  /// type Func<A> = fn(A);
  /// type MetaFunc = for<'a> fn(Func<&'a i32>);
  /// ```
  ///
  /// The type `MetaFunc`, when fully expanded, will be
  /// ```ignore (illustrative)
  /// for<'a> fn(fn(&'a i32))
  /// //      ^~ ^~ ^~~
  /// //      |  |  |
  /// //      |  |  DebruijnIndex of 2
  /// //      Binders
  /// ```
  /// Here the `'a` lifetime is bound in the outer function, but appears as an argument of the
  /// inner one. Therefore, that appearance will have a DebruijnIndex of 2, because we must skip
  /// over the inner binder (remember that we count De Bruijn indices from 1). However, in the
  /// definition of `MetaFunc`, the binder is not visible, so the type `&'a i32` will have a
  /// De Bruijn index of 1. It's only during the instantiation that we can see we must increase the
  /// depth by 1 to account for the binder that we passed through.
  ///
  /// As a second example, consider this twist:
  ///
  /// ```
  /// type FuncTuple<A> = (A,fn(A));
  /// type MetaFuncTuple = for<'a> fn(FuncTuple<&'a i32>);
  /// ```
  ///
  /// Here the final type will be:
  /// ```ignore (illustrative)
  /// for<'a> fn((&'a i32, fn(&'a i32)))
  /// //          ^~~         ^~~
  /// //          |           |
  /// //   DebruijnIndex of 1 |
  /// //               DebruijnIndex of 2
  /// ```
  /// As indicated in the diagram, here the same type `&'a i32` is instantiated once, but in the
  /// first case we do not increase the De Bruijn index and in the second case we do. The reason
  /// is that only in the second case have we passed through a fn binder.
  // PORT: D4 descriptor `d` of `T`.
  // rustc: compiler/rustc_type_ir/src/binder.rs:926 shift_vars_through_binders
  shift_vars_through_binders<T>(val: T, d: TypeFoldable<T>): T {
    if (this.binders_passed === 0 || !TypeVisitableExt.has_escaping_bound_vars(val, d)) {
      return val;
    } else {
      return shift_vars(this.cx_, val, this.binders_passed, d);
    }
  }

  // rustc: compiler/rustc_type_ir/src/binder.rs:934 shift_region_through_binders
  shift_region_through_binders(region: Region): Region {
    if (this.binders_passed === 0 || !TypeVisitableExt.has_escaping_bound_vars(region, fold_Region)) {
      return region;
    } else {
      return shift_region(this.cx_, region, this.binders_passed);
    }
  }
}

// ---- Placeholder ---------------------------------------------------------------------------------------------------

/** `impl<I: Interner, T: fmt::Debug> fmt::Debug for ty::Placeholder<I, T>` */
// rustc: compiler/rustc_type_ir/src/binder.rs:989 fmt
export function debug_Placeholder<T>(self: gen.Placeholder<T>, _f: Fmt, debug_T: Debug<T>): string {
  if (self.universe === UniverseIndex_ROOT) {
    return `!${debug_T(self.bound, PLAIN)}`;
  } else {
    return `!${UniverseIndex.index(self.universe)}_${debug_T(self.bound, PLAIN)}`;
  }
}

// ---- BoundRegionKind -----------------------------------------------------------------------------------------------

/** `impl<I: Interner> fmt::Debug for ty::BoundRegionKind<I>` */
// rustc: compiler/rustc_type_ir/src/binder.rs:1022 fmt
export const debug_BoundRegionKind: Debug<gen.BoundRegionKind> = (self, _f) => {
  switch (self.$) {
    case "Anon":
      return "BrAnon";
    case "NamedForPrinting": {
      const name = self._0;
      return `BrNamedForPrinting(${debug_Symbol(name, PLAIN)})`;
    }
    case "Named": {
      const did = self._0;
      return `BrNamed(${debug_DefId(did, PLAIN)})`;
    }
    case "ClosureEnv":
      return "BrEnv";
  }
};

export type BoundRegionKind = gen.BoundRegionKind;
export const BoundRegionKind = {
  ...gen.BoundRegionKind,

  // rustc: compiler/rustc_type_ir/src/binder.rs:1037 is_named
  is_named(self: BoundRegionKind, tcx: TyCtxt): boolean {
    return BoundRegionKind.get_name(self, tcx) !== undefined;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1041 get_name
  get_name(self: BoundRegionKind, tcx: TyCtxt): Symbol | undefined {
    switch (self.$) {
      case "Named": {
        const def_id = self._0;
        const name = tcx.item_name(def_id);
        if (name === kw.UnderscoreLifetime) {
          return undefined;
        } else {
          return name;
        }
      }
      case "NamedForPrinting": {
        const name = self._0;
        return name;
      }
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1052 get_id
  get_id(self: BoundRegionKind): DefId | undefined {
    switch (self.$) {
      case "Named": {
        const id = self._0;
        return id;
      }
      default:
        return undefined;
    }
  },
};

/** `#[derive(PartialEq)]` of `BoundRegionKind` (for `assert_eq!`). */
function BoundRegionKind_eq(a: BoundRegionKind, b: BoundRegionKind): boolean {
  switch (a.$) {
    case "Anon":
    case "ClosureEnv":
      return b.$ === a.$;
    case "NamedForPrinting":
      return b.$ === "NamedForPrinting" && a._0 === b._0;
    case "Named":
      return b.$ === "Named" && DefId_eq(a._0, b._0);
  }
}

/** `#[derive(PartialEq)]` of `BoundTyKind` (for `assert_eq!`). */
function BoundTyKind_eq(a: gen.BoundTyKind, b: gen.BoundTyKind): boolean {
  switch (a.$) {
    case "Anon":
      return b.$ === "Anon";
    case "Param":
      return b.$ === "Param" && DefId_eq(a._0, b._0);
  }
}

// ---- BoundVariableKind ---------------------------------------------------------------------------------------------

export type BoundVariableKind = gen.BoundVariableKind;
export const BoundVariableKind = {
  ...gen.BoundVariableKind,

  // rustc: compiler/rustc_type_ir/src/binder.rs:1084 expect_region
  expect_region(self: BoundVariableKind): BoundRegionKind {
    if (self.$ === "Region") {
      const lt = self._0;
      return lt;
    }
    return panic("expected a region, but found another kind");
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1091 expect_ty
  expect_ty(self: BoundVariableKind): gen.BoundTyKind {
    if (self.$ === "Ty") {
      const ty = self._0;
      return ty;
    }
    return panic("expected a type, but found another kind");
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1098 expect_const
  expect_const(self: BoundVariableKind): void {
    if (self.$ === "Const") {
      return;
    }
    panic("expected a const, but found another kind");
  },
};

// ---- BoundRegion ---------------------------------------------------------------------------------------------------

/** `impl<I: Interner> core::fmt::Debug for BoundRegion<I>` */
// rustc: compiler/rustc_type_ir/src/binder.rs:1119 fmt
export const debug_BoundRegion: Debug<gen.BoundRegion> = (self, _f) => {
  switch (self.kind.$) {
    case "Anon":
      return debug_BoundVar(self.var, PLAIN);
    case "ClosureEnv":
      return `${debug_BoundVar(self.var, PLAIN)}.Env`;
    case "Named": {
      const def = self.kind._0;
      return `${debug_BoundVar(self.var, PLAIN)}.Named(${debug_DefId(def, PLAIN)})`;
    }
    case "NamedForPrinting": {
      const symbol = self.kind._0;
      return `${debug_BoundVar(self.var, PLAIN)}.NamedAnon(${debug_Symbol(symbol, PLAIN)})`;
    }
  }
};

export type BoundRegion = gen.BoundRegion;
export const BoundRegion = {
  // rustc: compiler/rustc_type_ir/src/binder.rs:1134 var
  var(self: BoundRegion): BoundVar {
    return self.var;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1138 assert_eq
  assert_eq(self: BoundRegion, var_: BoundVariableKind): void {
    assert_eq(self.kind, BoundVariableKind.expect_region(var_), (v) => debug_BoundRegionKind(v, PLAIN), BoundRegionKind_eq);
  },
};

export type PlaceholderRegion = gen.PlaceholderRegion;
export const PlaceholderRegion = {
  // rustc: compiler/rustc_type_ir/src/binder.rs:1146 universe
  universe(self: PlaceholderRegion): UniverseIndex {
    return self.universe;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1150 var
  var(self: PlaceholderRegion): BoundVar {
    return BoundRegion.var(self.bound);
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1154 with_updated_universe
  with_updated_universe(self: PlaceholderRegion, ui: UniverseIndex): PlaceholderRegion {
    return { universe: ui, bound: self.bound, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1158 new
  new(ui: UniverseIndex, bound: BoundRegion): PlaceholderRegion {
    return { universe: ui, bound, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1162 new_anon
  new_anon(ui: UniverseIndex, var_: BoundVar): PlaceholderRegion {
    const bound: BoundRegion = { var: var_, kind: BoundRegionKind.Anon };
    return { universe: ui, bound, _tcx: undefined };
  },
};

// ---- BoundTy -------------------------------------------------------------------------------------------------------

/** `impl<I: Interner> fmt::Debug for ty::BoundTy<I>` */
// rustc: compiler/rustc_type_ir/src/binder.rs:1181 fmt
export const debug_BoundTy: Debug<gen.BoundTy> = (self, _f) => {
  switch (self.kind.$) {
    case "Anon":
      return debug_BoundVar(self.var, PLAIN);
    case "Param": {
      const def_id = self.kind._0;
      return debug_DefId(def_id, PLAIN);
    }
  }
};

export type BoundTy = gen.BoundTy;
export const BoundTy = {
  // rustc: compiler/rustc_type_ir/src/binder.rs:1190 var
  var(self: BoundTy): BoundVar {
    return self.var;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1194 assert_eq
  assert_eq(self: BoundTy, var_: BoundVariableKind): void {
    assert_eq(self.kind, BoundVariableKind.expect_ty(var_), (v) => gen.debug_BoundTyKind(v, PLAIN), BoundTyKind_eq);
  },
};

export type PlaceholderType = gen.PlaceholderType;
export const PlaceholderType = {
  // rustc: compiler/rustc_type_ir/src/binder.rs:1202 universe
  universe(self: PlaceholderType): UniverseIndex {
    return self.universe;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1206 var
  var(self: PlaceholderType): BoundVar {
    return self.bound.var;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1210 with_updated_universe
  with_updated_universe(self: PlaceholderType, ui: UniverseIndex): PlaceholderType {
    return { universe: ui, bound: self.bound, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1214 new
  new(ui: UniverseIndex, bound: BoundTy): PlaceholderType {
    return { universe: ui, bound, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1218 new_anon
  new_anon(ui: UniverseIndex, var_: BoundVar): PlaceholderType {
    const bound: BoundTy = { var: var_, kind: gen.BoundTyKind.Anon };
    return { universe: ui, bound, _tcx: undefined };
  },
};

// ---- BoundConst ----------------------------------------------------------------------------------------------------

export type BoundConst = gen.BoundConst;
export const BoundConst = {
  // rustc: compiler/rustc_type_ir/src/binder.rs:1237 var
  var(self: BoundConst): BoundVar {
    return self.var;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1241 assert_eq
  assert_eq(_self: BoundConst, var_: BoundVariableKind): void {
    BoundVariableKind.expect_const(var_);
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1245 new
  new(var_: BoundVar): BoundConst {
    return { var: var_, _tcx: undefined };
  },
};

export type PlaceholderConst = gen.PlaceholderConst;
export const PlaceholderConst = {
  // rustc: compiler/rustc_type_ir/src/binder.rs:1253 universe
  universe(self: PlaceholderConst): UniverseIndex {
    return self.universe;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1257 var
  var(self: PlaceholderConst): BoundVar {
    return self.bound.var;
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1261 with_updated_universe
  with_updated_universe(self: PlaceholderConst, ui: UniverseIndex): PlaceholderConst {
    return { universe: ui, bound: self.bound, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1265 new
  new(ui: UniverseIndex, bound: BoundConst): PlaceholderConst {
    return { universe: ui, bound, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1269 new_anon
  new_anon(ui: UniverseIndex, var_: BoundVar): PlaceholderConst {
    const bound = BoundConst.new(var_);
    return { universe: ui, bound, _tcx: undefined };
  },

  // rustc: compiler/rustc_type_ir/src/binder.rs:1274 find_const_ty_from_env
  find_const_ty_from_env(self: PlaceholderConst, env: ParamEnv): Ty {
    // PORT: the lazy `filter_map` iterator is a generator (the closure runs as `next()` pulls).
    const candidates = (function* (): Generator<Ty> {
      for (const clause of ParamEnv_caller_bounds(env)) {
        // `ConstArgHasType` are never desugared to be higher ranked.
        const k = Binder.skip_binder(clause.kind());
        if (k.$ === "ConstArgHasType") {
          const placeholder_ct = k._0;
          const ty = k._1;
          assert(!TypeVisitableExt.has_escaping_bound_vars<[Const, Ty]>([placeholder_ct, ty], visit_Const_Ty), "assertion failed: !(placeholder_ct, ty).has_escaping_bound_vars()");

          const ck = placeholder_ct.kind();
          if (ck.$ === "Placeholder" && Placeholder_eq_BoundConst(ck._0, self)) {
            yield ty;
          }
        }
      }
    })();

    // N.B. it may be tempting to fix ICEs by making this function return
    // `Option<Ty<'tcx>>` instead of `Ty<'tcx>`; however, this is generally
    // considered to be a bandaid solution, since it hides more important
    // underlying issues with how we construct generics and predicates of
    // items. It's advised to fix the underlying issue rather than trying
    // to modify this function.
    const first = candidates.next();
    if (first.done) {
      return unported("rustc_type_ir::binder::PlaceholderConst::find_const_ty_from_env: panic message needs `{env:#?}` (Debug for ParamEnv)");
    }
    const ty = first.value;
    if (!candidates.next().done) {
      return unported("rustc_type_ir::binder::PlaceholderConst::find_const_ty_from_env: assert! message needs `{env:#?}` (Debug for ParamEnv)");
    }
    return ty;
  },
};

// ---- PORT helpers and stand-ins ------------------------------------------------------------------------------------

/** PORT: `<Vec<T> / &[T] as IntoIterator>::IntoIter` (double-ended, exact-size, `Clone`) over the port's `T[]`. */
export class SliceIntoIter<T> {
  constructor(
    readonly items: readonly T[],
    public front: number,
    public back: number,
  ) {}

  static new<T>(items: readonly T[]): SliceIntoIter<T> {
    return new SliceIntoIter(items, 0, items.length);
  }

  next(): T | undefined {
    if (this.front >= this.back) return undefined;
    return this.items[this.front++];
  }

  next_back(): T | undefined {
    if (this.front >= this.back) return undefined;
    return this.items[--this.back];
  }

  size_hint(): [number, number | undefined] {
    const n = this.back - this.front;
    return [n, n];
  }

  clone(): SliceIntoIter<T> {
    return new SliceIntoIter(this.items, this.front, this.back);
  }
}

/** PORT: `UniverseIndex::ROOT` (lib.rs, `UniverseIndex::ZERO`; lib.rs's consts are not ported yet). */
const UniverseIndex_ROOT: UniverseIndex = UniverseIndex.ZERO;

/** PORT: `#[derive(PartialEq)]` of `Placeholder<I, BoundConst<I>>` (`universe`, `bound.var`; `_tcx` is a ZST). */
function Placeholder_eq_BoundConst(a: PlaceholderConst, b: PlaceholderConst): boolean {
  return a.universe === b.universe && a.bound.var === b.bound.var;
}

/** PORT: the visit descriptor of `(Const, Ty)` (visit.rs:136 over `fold_Const` and the `Ty` stand-in). */
const visit_Const_Ty: TypeVisitable<[Const, Ty]> = {
  visit_with: (self, visitor) => visit_with_tuple2(self, visitor, fold_Const.visit_with, fold_Ty.visit_with),
};

/** PORT: stand-in for `ParamEnv::caller_bounds` (rustc_middle ty/mod.rs; `ParamEnv` is a pending type). */
function ParamEnv_caller_bounds(_env: ParamEnv): readonly Clause[] {
  return unported("rustc_middle::ty::ParamEnv::caller_bounds (ParamEnv not ported yet)");
}

/** PORT: stand-in for `impl fmt::Debug for ty::ParamConst` (rustc_middle ty/structural_impls.rs, not ported yet). */
function debug_ParamConst(_v: ParamConst, _f: Fmt): string {
  return unported("rustc_middle::ty::ParamConst: Debug (structural_impls.rs)");
}

