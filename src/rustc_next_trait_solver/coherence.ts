// Port of compiler/rustc_next_trait_solver/src/coherence.rs (lane nts-canonical; the contract stub was lane
// evalctxt-contract's). `TrivialTypeTraversalImpls! { IsFirstInputType }` is the trivial descriptor
// `fold_IsFirstInputType`. Extension module (docs/handoff/evalctxt-contract.md "Init order").
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
import { ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { debug_TraitRef, visit_with_TraitRef } from "../rustc_type_ir/predicate.ts";
import { TypeFlags } from "../rustc_type_ir/flags.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import type { Binder, TraitRef } from "../rustc_type_ir/decls.ts";
import type { PredicateProxy, TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike } from "../rustc_type_ir/infer_ctxt.ts";
import { fold_with_trivial, try_fold_with_trivial, visit_with_trivial } from "../rustc_type_ir/macros.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { type Debug, debug_option, debug_struct, debug_tuple, debug_vec, type Fmt } from "../std/fmt.ts";
import { panic, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { PLAIN } from "../std/fmt.ts";

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
// #[instrument(level = "debug", skip(infcx, lazily_normalize_ty), ret)]
// rustc: compiler/rustc_next_trait_solver/src/coherence.rs:48 trait_ref_is_knowable
export function trait_ref_is_knowable<E>(
  infcx: InferCtxtLike,
  trait_ref: TraitRef,
  lazily_normalize_ty: (ty: Ty) => Result<Ty, E>,
): Result<Result<undefined, Conflict>, E> {
  const remote = orphan_check_trait_ref(infcx, trait_ref, InCrate.Remote, lazily_normalize_ty);
  if (remote.$ === "Err") return remote;
  if (remote._0.$ === "Ok") {
    // A downstream or cousin crate is allowed to implement some
    // generic parameters of this trait-ref.
    return Ok(Err(Conflict.Downstream));
  }

  if (trait_ref_is_local_or_fundamental(infcx.cx(), trait_ref)) {
    // This is a local or fundamental trait, so future-compatibility
    // is no concern. We know that downstream/cousin crates are not
    // allowed to implement a generic parameter of this trait ref,
    // which means impls could only come from dependencies of this
    // crate, which we already know about.
    return Ok(Ok(undefined));
  }

  // This is a remote non-fundamental trait, so if another crate
  // can be the "final owner" of the generic parameters of this trait-ref,
  // they are allowed to implement it future-compatibly.
  //
  // However, if we are a final owner, then nobody else can be,
  // and if we are an intermediate owner, then we don't care
  // about future-compatibility, which means that we're OK if
  // we are an owner.
  const local = orphan_check_trait_ref(infcx, trait_ref, { $: "Local", mode: OrphanCheckMode.Proper }, lazily_normalize_ty);
  if (local.$ === "Err") return local;
  if (local._0.$ === "Ok") {
    return Ok(Ok(undefined));
  } else {
    return Ok(Err(Conflict.Upstream));
  }
}

// rustc: compiler/rustc_next_trait_solver/src/coherence.rs:96 trait_ref_is_local_or_fundamental
export function trait_ref_is_local_or_fundamental(tcx: TyCtxt, trait_ref: TraitRef): boolean {
  return trait_ref.def_id.is_local() || tcx.trait_is_fundamental(trait_ref.def_id);
}

// PORT: `#[derive(Debug, Copy, Clone)]` fieldless enum; `impl From<bool>` is on the companion.
export type IsFirstInputType = "No" | "Yes";
export const IsFirstInputType = {
  No: "No",
  Yes: "Yes",

  // rustc: compiler/rustc_next_trait_solver/src/coherence.rs:109 from
  from(b: boolean): IsFirstInputType {
    switch (b) {
      case false:
        return "No";
      case true:
        return "Yes";
    }
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
///    cases).
///
/// Note that this function is never called for types that have both type
/// parameters and inference variables.
// #[instrument(level = "trace", skip(infcx, lazily_normalize_ty), ret)]
// rustc: compiler/rustc_next_trait_solver/src/coherence.rs:222 orphan_check_trait_ref
export function orphan_check_trait_ref<E>(
  infcx: InferCtxtLike,
  trait_ref: TraitRef,
  in_crate: InCrate,
  lazily_normalize_ty: (ty: Ty) => Result<Ty, E>,
): Result<Result<undefined, OrphanCheckErr<Ty>>, E> {
  if (TypeVisitableExt.has_param(trait_ref, visit_TraitRef)) {
    return panic(`orphan check only expects inference variables: ${debug_TraitRef(trait_ref, PLAIN)}`);
  }

  const checker = OrphanChecker.new(infcx, in_crate, lazily_normalize_ty);
  const cf = visit_with_TraitRef(trait_ref, checker);
  switch (cf.$) {
    case "Continue":
      return Ok(Err({ $: "NonLocalInputType", _0: checker.non_local_tys }));
    case "Break": {
      const residual = cf._0;
      switch (residual.$) {
        case "NormalizationFailure":
          return Err(residual._0);
        case "UncoveredTyParam": {
          const ty = residual._0;
          // Does there exist some local type after the `ParamTy`.
          checker.search_first_local_ty = true;
          const again = visit_with_TraitRef(trait_ref, checker);
          const local_ty = again.$ === "Break" && again._0.$ === "LocalTy" ? again._0._0 : undefined;
          return Ok(Err({ $: "UncoveredTyParams", _0: { uncovered: ty, local_ty } }));
        }
        case "LocalTy":
          return Ok(Ok(undefined));
      }
    }
  }
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

  // rustc: compiler/rustc_next_trait_solver/src/coherence.rs:275 new
  static new<E>(infcx: InferCtxtLike, in_crate: InCrate, lazily_normalize_ty: (ty: Ty) => Result<Ty, E>): OrphanChecker<E> {
    return new OrphanChecker(infcx, in_crate, true, lazily_normalize_ty, false, []);
  }

  // rustc: compiler/rustc_next_trait_solver/src/coherence.rs:286 found_non_local_ty
  found_non_local_ty(t: Ty): ControlFlow<OrphanCheckEarlyExit<E>> {
    this.non_local_tys.push([t, IsFirstInputType.from(this.in_self_ty)]);
    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_next_trait_solver/src/coherence.rs:291 found_uncovered_ty_param
  found_uncovered_ty_param(ty: Ty): ControlFlow<OrphanCheckEarlyExit<E>> {
    if (this.search_first_local_ty) {
      return ControlFlow.CONTINUE;
    }

    return ControlFlow.Break({ $: "UncoveredTyParam", _0: ty });
  }

  // rustc: compiler/rustc_next_trait_solver/src/coherence.rs:299 def_id_is_local
  def_id_is_local(def_id: DefId): boolean {
    switch (this.in_crate.$) {
      case "Local":
        return def_id.is_local();
      case "Remote":
        return false;
    }
  }

  // ---- impl TypeVisitor for OrphanChecker ----
  // rustc: compiler/rustc_next_trait_solver/src/coherence.rs:321 visit_region
  visit_region(_r: Region): ControlFlow<OrphanCheckEarlyExit<E>> {
    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_next_trait_solver/src/coherence.rs:325 visit_ty
  visit_ty(ty: Ty): ControlFlow<OrphanCheckEarlyExit<E>> {
    ty = this.infcx.shallow_resolve(ty);
    const norm = this.lazily_normalize_ty(ty);
    if (norm.$ === "Ok") {
      const norm_ty = norm._0;
      if (!norm_ty.is_ty_var()) {
        ty = norm_ty;
      }
    } else {
      return ControlFlow.Break({ $: "NormalizationFailure", _0: norm._0 });
    }

    let result: ControlFlow<OrphanCheckEarlyExit<E>>;
    const k = ty.kind();
    switch (k.$) {
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Pat":
      case "FnPtr":
      case "Array":
      case "Slice":
      case "RawPtr":
      case "Never":
      case "Tuple":
      // FIXME(unsafe_binders): Non-local?
      case "UnsafeBinder":
        result = this.found_non_local_ty(ty);
        break;

      case "Param":
        return panic("unexpected ty param");

      case "Placeholder":
      case "Bound":
      case "Infer":
        switch (this.in_crate.$) {
          case "Local":
            result = this.found_uncovered_ty_param(ty);
            break;
          // The inference variable might be unified with a local
          // type in that remote crate.
          case "Remote":
            result = ControlFlow.Break({ $: "LocalTy", _0: ty });
            break;
        }
        break;

      // A rigid alias may normalize to anything.
      // * If it references an infer var, placeholder or bound ty, it may
      //   normalize to that, so we have to treat it as an uncovered ty param.
      // * Otherwise it may normalize to any non-type-generic type
      //   be it local or non-local.
      case "Alias": {
        const kind = k._1.kind;
        if (
          TypeVisitableExt.has_type_flags(
            ty,
            (TypeFlags.HAS_TY_PLACEHOLDER | TypeFlags.HAS_TY_BOUND | TypeFlags.HAS_TY_INFER) as TypeFlags,
            fold_Ty,
          )
        ) {
          switch (this.in_crate.$) {
            case "Local": {
              const mode = this.in_crate.mode;
              if (kind.$ === "Projection") {
                if (mode === "Compat") {
                  result = ControlFlow.CONTINUE;
                } else {
                  result = this.found_uncovered_ty_param(ty);
                }
              } else {
                result = this.found_uncovered_ty_param(ty);
              }
              break;
            }
            case "Remote":
              // The inference variable might be unified with a local
              // type in that remote crate.
              result = ControlFlow.Break({ $: "LocalTy", _0: ty });
              break;
          }
        } else {
          // Regarding *opaque types* specifically, we choose to treat them as non-local,
          // even those that appear within the same crate. This seems somewhat surprising
          // at first, but makes sense when you consider that opaque types are supposed
          // to hide the underlying type *within the same crate*. When an opaque type is
          // used from outside the module where it is declared, it should be impossible to
          // observe anything about it other than the traits that it implements.
          //
          // The alternative would be to look at the underlying type to determine whether
          // or not the opaque type itself should be considered local.
          //
          // However, this could make it a breaking change to switch the underlying hidden
          // type from a local type to a remote type. This would violate the rule that
          // opaque types should be completely opaque apart from the traits that they
          // implement, so we don't use this behavior.
          // Addendum: Moreover, revealing the underlying type is likely to cause cycle
          // errors as we rely on coherence / the specialization graph during typeck.
          result = this.found_non_local_ty(ty);
        }
        break;
      }

      // For fundamental types, we just look inside of them.
      // Certain lang items (currently, `Box`) have special behaviour here
      // and so are special cased.
      case "Ref":
        result = fold_Ty.visit_with(k._1, this);
        break;
      case "Adt": {
        const def = k._0;
        const args = k._1;
        if (this.def_id_is_local(def.def_id())) {
          result = ControlFlow.Break({ $: "LocalTy", _0: ty });
        } else if (def.is_fundamental()) {
          const item = this.infcx.cx().as_adt_lang_item(def.def_id());
          if (item === "OwnedBox") {
            result = fold_Ty.visit_with(args.type_at(0), this);
          } else {
            result = fold_GenericArgs.visit_with(args, this);
          }
        } else {
          result = this.found_non_local_ty(ty);
        }
        break;
      }
      case "Foreign": {
        const def_id = k._0;
        if (this.def_id_is_local(def_id)) {
          result = ControlFlow.Break({ $: "LocalTy", _0: ty });
        } else {
          result = this.found_non_local_ty(ty);
        }
        break;
      }
      case "Dynamic": {
        const tt = k._0;
        const principal = tt.principal_def_id();
        if (principal !== undefined && this.def_id_is_local(principal)) {
          result = ControlFlow.Break({ $: "LocalTy", _0: ty });
        } else {
          result = this.found_non_local_ty(ty);
        }
        break;
      }
      case "Error":
        result = ControlFlow.Break({ $: "LocalTy", _0: ty });
        break;

      case "FnDef":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
        return unreachable(`internal error: entered unreachable code: unnameable type in coherence: ${debug_Ty(ty, PLAIN)}`);
    }
    // A bit of a hack, the `OrphanChecker` is only used to visit a `TraitRef`, so
    // the first type we visit is always the self type.
    this.in_self_ty = false;
    return result;
  }

  /// All possible values for a constant parameter already exist
  /// in the crate defining the trait, so they are always non-local[^1].
  ///
  /// Because there's no way to have an impl where the first local
  /// generic argument is a constant, we also don't have to fail
  /// the orphan check when encountering a parameter or a generic constant.
  ///
  /// This means that we can completely ignore constants during the orphan check.
  ///
  /// See `tests/ui/coherence/const-generics-orphan-check-ok.rs` for examples.
  ///
  /// [^1]: This might not hold for function pointers or trait objects in the future.
  /// As these should be quite rare as const arguments and especially rare as impl
  /// parameters, allowing uncovered const parameters in impls seems more useful
  /// than allowing `impl<T> Trait<local_fn_ptr, T> for i32` to compile.
  // rustc: compiler/rustc_next_trait_solver/src/coherence.rs:472 visit_const
  visit_const(_c: Const): ControlFlow<OrphanCheckEarlyExit<E>> {
    return ControlFlow.CONTINUE;
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

/** PORT: D4 descriptor of `TraitRef<I>` (derived `TypeVisitable`, rustc_type_ir predicate.gen.ts). */
const visit_TraitRef: TypeVisitable<TraitRef> = { visit_with: visit_with_TraitRef };
