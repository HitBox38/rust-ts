// Contract stub for compiler/rustc_next_trait_solver/src/coherence.rs (lane evalctxt-contract; the file belongs to lane
// nts-canonical). The types are final (`TrivialTypeTraversalImpls! { IsFirstInputType }` is the trivial descriptor
// `fold_IsFirstInputType`); the free fns, `IsFirstInputType`'s `From<bool>` and `OrphanChecker`'s methods are stubs
// with final signatures: fill each in place and add the `// rustc:` marker. Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: generic over `Infcx: InferCtxtLike` (the `InferCtxtLike` interface), not over `SolverDelegate`: rustc_trait_selection
// calls these with an `InferCtxt`. `E: Debug` (the normalization error) is erased: only tracing formats it.
// `lazily_normalize_ty: impl FnMut(I::Ty) -> Result<I::Ty, E>` is a closure; `&mut lazily_normalize_ty` passes the same
// closure on. `OrphanChecker<'a, Infcx, I, F>` keeps `E` (the closure's error type) as its type parameter.
// `def_id: impl DefId<I>` is a `DefId` (every `I::*Id` is `DefId`, inherent.ts).
import type { DefId } from "../rustc_span/def_id.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clauses, Ty } from "../rustc_middle/ty/decls.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import type { Binder, TraitRef } from "../rustc_type_ir/decls.ts";
import type { PredicateProxy, TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike } from "../rustc_type_ir/infer_ctxt.ts";
import { fold_with_trivial, try_fold_with_trivial, visit_with_trivial } from "../rustc_type_ir/macros.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { type Debug, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/// Whether we do the orphan check relative to this crate or to some remote crate.
// PORT: `#[derive(Copy, Clone, Debug)]`.
export type InCrate = { readonly $: "Local"; readonly mode: OrphanCheckMode } | { readonly $: "Remote" };
export const InCrate = {
  Remote: Object.freeze({ $: "Remote" }) as InCrate,
} as const;
export const debug_InCrate: Debug<InCrate> = (v, f) => {
  switch (v.$) {
    case "Local":
      return debug_struct(f, "Local", [["mode", debug_OrphanCheckMode(v.mode, f)]]);
    case "Remote":
      return "Remote";
  }
};

// PORT: `#[derive(Copy, Clone, Debug)]` fieldless enum.
export type OrphanCheckMode =
  /// Proper orphan check.
  | "Proper"
  /// Improper orphan check for backward compatibility.
  ///
  /// In this mode, type params inside projections are considered to be covered
  /// even if the projection may normalize to a type that doesn't actually cover
  /// them. This is unsound. See also [#124559] and [#99554].
  ///
  /// [#124559]: https://github.com/rust-lang/rust/issues/124559
  /// [#99554]: https://github.com/rust-lang/rust/issues/99554
  | "Compat";
export const OrphanCheckMode = { Proper: "Proper", Compat: "Compat" } as const;
export const debug_OrphanCheckMode: Debug<OrphanCheckMode> = (v) => v;

// PORT: `#[derive(Debug, Copy, Clone)]` fieldless enum.
export type Conflict = "Upstream" | "Downstream";
export const Conflict = { Upstream: "Upstream", Downstream: "Downstream" } as const;
export const debug_Conflict: Debug<Conflict> = (v) => v;

/// Returns whether all impls which would apply to the `trait_ref`
/// e.g. `Ty: Trait<Arg>` are already known in the local crate.
///
/// This both checks whether any downstream or sibling crates could
/// implement it and whether an upstream crate can add this impl
/// without breaking backwards compatibility.
export function trait_ref_is_knowable<E>(
  _infcx: InferCtxtLike,
  _trait_ref: TraitRef,
  _lazily_normalize_ty: (ty: Ty) => Result<Ty, E>,
): Result<Result<undefined, Conflict>, E> {
  return unported("rustc_next_trait_solver::coherence::trait_ref_is_knowable");
}

export function trait_ref_is_local_or_fundamental(_tcx: TyCtxt, _trait_ref: TraitRef): boolean {
  return unported("rustc_next_trait_solver::coherence::trait_ref_is_local_or_fundamental");
}

// PORT: `#[derive(Debug, Copy, Clone)]` fieldless enum; `impl From<bool>` is on the companion.
export type IsFirstInputType = "No" | "Yes";
export const IsFirstInputType = {
  No: "No",
  Yes: "Yes",

  from(_b: boolean): IsFirstInputType {
    return unported("rustc_next_trait_solver::coherence::IsFirstInputType::from");
  },
} as const;
export const debug_IsFirstInputType: Debug<IsFirstInputType> = (v) => v;
/** `TrivialTypeTraversalImpls! { IsFirstInputType, }` (rustc_type_ir macros.ts). */
export const fold_IsFirstInputType: TypeFoldable<IsFirstInputType> = {
  visit_with: visit_with_trivial,
  try_fold_with: try_fold_with_trivial,
  fold_with: fold_with_trivial,
};

// PORT: `#[derive_where(Debug; I: Interner, T: Debug)]`; `Debug` takes `T`'s impl.
export type OrphanCheckErr<T> =
  | { readonly $: "NonLocalInputType"; readonly _0: [Ty, IsFirstInputType][] }
  | { readonly $: "UncoveredTyParams"; readonly _0: UncoveredTyParams<T> };
export function debug_OrphanCheckErr<T>(v: OrphanCheckErr<T>, f: Fmt, debug_T: Debug<T>): string {
  switch (v.$) {
    case "NonLocalInputType":
      return debug_tuple(f, "NonLocalInputType", [
        debug_vec(v._0, f, ([ty, first], f2) => debug_tuple(f2, "", [debug_Ty(ty, f2), debug_IsFirstInputType(first, f2)])),
      ]);
    case "UncoveredTyParams":
      return debug_tuple(f, "UncoveredTyParams", [debug_UncoveredTyParams(v._0, f, debug_T)]);
  }
}

// PORT: `#[derive_where(Debug; I: Interner, T: Debug)]`.
export interface UncoveredTyParams<T> {
  uncovered: T;
  local_ty: Ty | undefined;
}
export function debug_UncoveredTyParams<T>(v: UncoveredTyParams<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "UncoveredTyParams", [
    ["uncovered", debug_T(v.uncovered, f)],
    ["local_ty", debug_option(v.local_ty, f, debug_Ty)],
  ]);
}

/// Checks whether a trait-ref is potentially implementable by a crate.
///
/// The current rule is that a trait-ref orphan checks in a crate C:
///
/// 1. Order the parameters in the trait-ref in generic parameters order
/// - Self first, others linearly (e.g., `<U as Foo<V, W>>` is U < V < W).
/// 2. Of these type parameters, there is at least one type parameter
///    in which, walking the type as a tree, you can reach a type local
///    to C where all types in-between are fundamental types. Call the
///    first such parameter the "local key parameter".
///     - e.g., `Box<LocalType>` is OK, because you can visit LocalType
///       going through `Box`, which is fundamental.
///     - similarly, `FundamentalPair<Vec<()>, Box<LocalType>>` is OK for
///       the same reason.
///     - but (knowing that `Vec<T>` is non-fundamental, and assuming it's
///       not local), `Vec<LocalType>` is bad, because `Vec<->` is between
///       the local type and the type parameter.
/// 3. Before this local type, no generic type parameter of the impl must
///    be reachable through fundamental types.
///     - e.g. `impl<T> Trait<LocalType> for Vec<T>` is fine, as `Vec` is not fundamental.
///     - while `impl<T> Trait<LocalType> for Box<T>` results in an error, as `T` is
///       reachable through the fundamental type `Box`.
/// 4. Every type in the local key parameter not known in C, going
///    through the parameter's type tree, must appear only as a subtree of
///    a type local to C, with only fundamental types between the type
///    local to C and the local key parameter.
///     - e.g., `Vec<LocalType<T>>>` (or equivalently `Box<Vec<LocalType<T>>>`)
///     is bad, because the only local type with `T` as a subtree is
///     `LocalType<T>`, and `Vec<->` is between it and the type parameter.
///     - similarly, `FundamentalPair<LocalType<T>, T>` is bad, because
///     the second occurrence of `T` is not a subtree of *any* local type.
///     - however, `LocalType<Vec<T>>` is OK, because `T` is a subtree of
///     `LocalType<Vec<T>>`, which is local and has no types between it and
///     the type parameter.
///
/// The orphan rules actually serve several different purposes:
///
/// 1. They enable link-safety - i.e., 2 mutually-unknowing crates (where
///    every type local to one crate is unknown in the other) can't implement
///    the same trait-ref. This follows because it can be seen that no such
///    type can orphan-check in 2 such crates.
///
///    To check that a local impl follows the orphan rules, we check it in
///    InCrate::Local mode, using type parameters for the "generic" types.
///
///    In InCrate::Local mode the orphan check succeeds if the current crate
///    is definitely allowed to implement the given trait (no false positives).
///
/// 2. They ground negative reasoning for coherence. If a user wants to
///    write both a conditional blanket impl and a specific impl, we need to
///    make sure they do not overlap. For example, if we write
///    ```ignore (illustrative)
///    impl<T> IntoIterator for Vec<T>
///    impl<T: Iterator> IntoIterator for T
///    ```
///    We need to be able to prove that `Vec<$0>: !Iterator` for every type $0.
///    We can observe that this holds in the current crate, but we need to make
///    sure this will also hold in all unknown crates (both "independent" crates,
///    which we need for link-safety, and also child crates, because we don't want
///    child crates to get error for impl conflicts in a *dependency*).
///
///    For that, we only allow negative reasoning if, for every assignment to the
///    inference variables, every unknown crate would get an orphan error if they
///    try to implement this trait-ref. To check for this, we use InCrate::Remote
///    mode. That is sound because we already know all the impls from known crates.
///
///    In InCrate::Remote mode the orphan check succeeds if a foreign crate
///    *could* implement the given trait (no false negatives).
///
/// 3. For non-`#[fundamental]` traits, they guarantee that parent crates can
///    add "non-blanket" impls without breaking negative reasoning in dependent
///    crates. This is the "rebalancing coherence" (RFC 1023) restriction.
///
///    For that, we only allow a crate to perform negative reasoning on
///    non-local-non-`#[fundamental]` if there's a local key parameter as per (2).
///
///    Because we never perform negative reasoning generically (coherence does
///    not involve type parameters), this can be interpreted as doing the full
///    orphan check (using InCrate::Local mode), instantiating non-local known
///    types for all inference variables.
///
///    This allows for crates to future-compatibly add impls as long as they
///    can't apply to types with a key parameter in a child crate - applying
///    the rules, this basically means that every type parameter in the impl
///    must appear behind a non-fundamental type (because this is not a
///    type-system requirement, crate owners might also go for "semantic
///    future-compatibility" involving things such as sealed traits, but
///    the above requirement is sufficient, and is necessary in "open world"
export function orphan_check_trait_ref<E>(
  _infcx: InferCtxtLike,
  _trait_ref: TraitRef,
  _in_crate: InCrate,
  _lazily_normalize_ty: (ty: Ty) => Result<Ty, E>,
): Result<Result<undefined, OrphanCheckErr<Ty>>, E> {
  return unported("rustc_next_trait_solver::coherence::orphan_check_trait_ref");
}

export class OrphanChecker<E> implements TypeVisitor<ControlFlow<OrphanCheckEarlyExit<E>>> {
  readonly Result: VisitorResult<ControlFlow<OrphanCheckEarlyExit<E>>, unknown> =
    VisitorResultC.ControlFlow<OrphanCheckEarlyExit<E>>();

  constructor(
    public infcx: InferCtxtLike,
    public in_crate: InCrate,
    public in_self_ty: boolean,
    public lazily_normalize_ty: (ty: Ty) => Result<Ty, E>,
    /// Ignore orphan check failures and exclusively search for the first local type.
    public search_first_local_ty: boolean,
    public non_local_tys: [Ty, IsFirstInputType][],
  ) {}

  static new<E>(_infcx: InferCtxtLike, _in_crate: InCrate, _lazily_normalize_ty: (ty: Ty) => Result<Ty, E>): OrphanChecker<E> {
    return unported("rustc_next_trait_solver::coherence::OrphanChecker::new");
  }

  found_non_local_ty(_t: Ty): ControlFlow<OrphanCheckEarlyExit<E>> {
    return unported("rustc_next_trait_solver::coherence::OrphanChecker::found_non_local_ty");
  }

  found_uncovered_ty_param(_ty: Ty): ControlFlow<OrphanCheckEarlyExit<E>> {
    return unported("rustc_next_trait_solver::coherence::OrphanChecker::found_uncovered_ty_param");
  }

  def_id_is_local(_def_id: DefId): boolean {
    return unported("rustc_next_trait_solver::coherence::OrphanChecker::def_id_is_local");
  }

  // ---- impl TypeVisitor for OrphanChecker ----
  visit_region(_r: Region): ControlFlow<OrphanCheckEarlyExit<E>> {
    return unported("rustc_next_trait_solver::coherence::OrphanChecker::visit_region");
  }

  visit_ty(_ty: Ty): ControlFlow<OrphanCheckEarlyExit<E>> {
    return unported("rustc_next_trait_solver::coherence::OrphanChecker::visit_ty");
  }

  visit_const(_c: Const): ControlFlow<OrphanCheckEarlyExit<E>> {
    return unported("rustc_next_trait_solver::coherence::OrphanChecker::visit_const");
  }

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<OrphanCheckEarlyExit<E>> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<OrphanCheckEarlyExit<E>> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<OrphanCheckEarlyExit<E>> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<OrphanCheckEarlyExit<E>> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// PORT: no derives upstream.
export type OrphanCheckEarlyExit<E> =
  | { readonly $: "NormalizationFailure"; readonly _0: E }
  | { readonly $: "UncoveredTyParam"; readonly _0: Ty }
  | { readonly $: "LocalTy"; readonly _0: Ty };
