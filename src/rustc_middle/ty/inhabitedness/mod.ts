// Port of compiler/rustc_middle/src/ty/inhabitedness/mod.rs (lane merge-lints; contract stub by lane ty-contract).
//
//! This module contains logic for determining whether a type is inhabited or
//! uninhabited. The [`InhabitedPredicate`] type captures the minimum
//! information needed to determine whether a type is inhabited given a
//! `ParamEnv` and module ID.
//!
//! # Example
//! ```rust
//! #![feature(never_type)]
//! mod a {
//!     pub mod b {
//!         pub struct SecretlyUninhabited {
//!             _priv: !,
//!         }
//!     }
//! }
//!
//! mod c {
//!     enum Void {}
//!     pub struct AlsoSecretlyUninhabited {
//!         _priv: Void,
//!     }
//!     mod d {
//!     }
//! }
//!
//! struct Foo {
//!     x: a::b::SecretlyUninhabited,
//!     y: c::AlsoSecretlyUninhabited,
//! }
//! ```
//! In this code, the type `Foo` will only be visibly uninhabited inside the
//! modules `b`, `c` and `d`. Calling `inhabited_predicate` on `Foo` will
//! return `NotInModule(b) AND NotInModule(c)`.
//!
//! We need this information for pattern-matching on `Foo` or types that contain
//! `Foo`.
//!
//! # Example
//! ```ignore(illustrative)
//! let foo_result: Result<T, Foo> = ... ;
//! let Ok(t) = foo_result;
//! ```
//! This code should only compile in modules where the uninhabitedness of `Foo`
//! is visible.
//
// PORT: `FxHashSet<DefId>` is a `DefIdSet`. The `adt_def` / `type_of` values and the `is_opsem_inhabited_adt_cached` key (typed `unknown` in queries.gen.ts) are cast at the
// calls. `debug_assert!` and `#[instrument]` are comments.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes; its
// top-level code touches only the classes it imports. ty/mod.ts's `provide` reaches `provide` through `require`.
import { debug_DefKind } from "../../../rustc_hir/def.gen.ts";
import { type DefId, DefIdSet, type LocalModId } from "../../../rustc_span/def_id.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { UnsafeBinderInner } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../../std/fmt.ts";
import type { Providers } from "../../queries.gen.ts";
import type { AdtDef } from "../adt.ts";
import type { TyCtxt } from "../context.ts";
import type { GenericArgsRef } from "../generic_args.ts";
import { type PseudoCanonicalInput, Ty, type TypingEnv, VariantDef } from "../mod.ts";
import { fold_Ty } from "../structural_impls.ts";
import { InhabitedPredicate } from "./inhabited_predicate.ts";

export { InhabitedPredicate } from "./inhabited_predicate.ts";

function pretty(): typeof import("../print/pretty.ts") {
  return (pretty__m ??= require("../print/pretty.ts") as typeof import("../print/pretty.ts"));
}
var pretty__m: typeof import("../print/pretty.ts") | undefined;

declare module "../mod.ts" {
  interface VariantDef {
    inhabited_predicate(tcx: TyCtxt): InhabitedPredicate;
  }
}

// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:62 provide
export function provide(providers: Providers): void {
  providers.inhabited_predicate_for_def = inhabited_predicate_for_def;
  providers.inhabited_predicate_type = inhabited_predicate_type;
  providers.is_opsem_inhabited_adt_cached = is_opsem_inhabited_adt_cached as Providers["is_opsem_inhabited_adt_cached"];
}

// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:73 inhabited_predicate_for_def
function inhabited_predicate_for_def(tcx: TyCtxt, def_id: DefId): InhabitedPredicate {
  const def_kind = tcx.def_kind(def_id);
  switch (def_kind.$) {
    case "Enum": {
      const local = def_id.as_local();
      if (local !== undefined) {
        tcx.ensure_ok().check_representability(local);
      }
      const adt = tcx.adt_def(def_id) as AdtDef;
      return InhabitedPredicate.any(
        tcx,
        adt.variants().map((v) => v.inhabited_predicate(tcx)),
      );
    }
    case "Struct": {
      const local = def_id.as_local();
      if (local !== undefined) {
        tcx.ensure_ok().check_representability(local);
      }
      const adt = tcx.adt_def(def_id) as AdtDef;
      return variant_inhabited_predicate(tcx, adt, adt.non_enum_variant());
    }
    case "Variant": {
      const adt = tcx.adt_def(tcx.parent(def_id)) as AdtDef;
      const variant = adt.variant_with_id(def_id);
      return variant_inhabited_predicate(tcx, adt, variant);
    }
    default:
      return bug(`unexpected DefKind: ${debug_DefKind(def_kind, PLAIN)}`);
  }
}

// impl VariantDef
// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:99 inhabited_predicate
VariantDef.prototype.inhabited_predicate = function (this: VariantDef, tcx: TyCtxt): InhabitedPredicate {
  if (this.fields.length === 0) {
    return InhabitedPredicate.True;
  }
  return tcx.inhabited_predicate_for_def(this.def_id);
};

// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:107 variant_inhabited_predicate
function variant_inhabited_predicate(tcx: TyCtxt, adt: AdtDef, variant: VariantDef): InhabitedPredicate {
  return InhabitedPredicate.all(
    tcx,
    variant.fields.map((field) => {
      const pred = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>)).inhabited_predicate(tcx);
      if (adt.is_enum()) {
        return pred;
      }
      switch (field.vis.$) {
        case "Public":
          return pred;
        case "Restricted": {
          const from = field.vis._0;
          return InhabitedPredicate.or({ $: "NotInModule", _0: from }, tcx, pred);
        }
      }
    }),
  );
}

// impl<'tcx> Ty<'tcx>
// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:133 inhabited_predicate
Ty.prototype.inhabited_predicate = function (this: Ty, tcx: TyCtxt): InhabitedPredicate {
  // debug_assert!(!self.has_infer());
  const k = this.kind();
  switch (k.$) {
    case "Adt":
      // For now, unions are always considered inhabited
      if (k._0.is_union()) return InhabitedPredicate.True;
      // Non-exhaustive ADTs from other crates are always considered inhabited
      if (k._0.variant_list_has_applicable_non_exhaustive()) return InhabitedPredicate.True;
      break;
    case "Never":
      return InhabitedPredicate.False;
    // FIXME(#155345): This should only encounter rigid aliases with the new solver.
    case "Param":
      return { $: "GenericType", _0: this };
    case "Alias": {
      const kind = k._1.kind;
      if (kind.$ === "Inherent" || kind.$ === "Projection" || kind.$ === "Free") {
        return { $: "GenericType", _0: this };
      }
      if (kind.$ === "Opaque") {
        const local_def_id = kind.def_id.as_local();
        // Foreign opaque is considered inhabited.
        if (local_def_id === undefined) return InhabitedPredicate.True;
        // Local opaque type may possibly be revealed.
        const key = { def_id: local_def_id, args: k._1.args };
        return { $: "OpaqueType", _0: key };
      }
      break;
    }
    case "Tuple":
      if (k._0.length === 0) return InhabitedPredicate.True;
      break;
  }
  switch (k.$) {
    // use a query for more complex cases
    case "Adt":
    case "Array":
    case "Tuple":
      return tcx.inhabited_predicate_type(this);
    // references and other types are inhabited
    default:
      return InhabitedPredicate.True;
  }
};

/// Checks whether a type is visibly uninhabited from a particular module.
///
/// # Example
/// ```
/// #![feature(never_type)]
/// # fn main() {}
/// enum Void {}
/// mod a {
///     pub mod b {
///         pub struct SecretlyUninhabited {
///             _priv: !,
///         }
///     }
/// }
///
/// mod c {
///     use super::Void;
///     pub struct AlsoSecretlyUninhabited {
///         _priv: Void,
///     }
///     mod d {
///     }
/// }
///
/// struct Foo {
///     x: a::b::SecretlyUninhabited,
///     y: c::AlsoSecretlyUninhabited,
/// }
/// ```
/// In this code, the type `Foo` will only be visibly uninhabited inside the
/// modules b, c and d. This effects pattern-matching on `Foo` or types that
/// contain `Foo`.
///
/// # Example
/// ```ignore (illustrative)
/// let foo_result: Result<T, Foo> = ... ;
/// let Ok(t) = foo_result;
/// ```
/// This code should only compile in modules where the uninhabitedness of Foo is
/// visible.
// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:210 is_inhabited_from
Ty.prototype.is_inhabited_from = function (this: Ty, tcx: TyCtxt, module: LocalModId, typing_env: TypingEnv): boolean {
  return InhabitedPredicate.apply(this.inhabited_predicate(tcx), tcx, typing_env, module);
};

/// Returns true if the type is uninhabited without regard to visibility.
///
/// This is still conservative; for instance, a `#[non_exhaustive]` enum *in another crate*
/// is always considered inhabited.
// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:223 is_privately_uninhabited
Ty.prototype.is_privately_uninhabited = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  return !InhabitedPredicate.apply_ignore_module(this.inhabited_predicate(tcx), tcx, typing_env);
};

/// Returns whether `self` is considered inhabited on the opsem level, i.e., its validity
/// invariant might be satisfiable. `self` is expected to be monomorphic and normalized.
///
/// Key constraints are:
/// - if a type's validity invariant is satisfiable, it must be opsem-inhabited.
/// - if a type's layout is marked uninhabited, it must be opsem-uninhabited.
///
/// Beyond that, the value returned by this function is not a stable guarantee.
// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:239 is_opsem_inhabited
Ty.prototype.is_opsem_inhabited = function (this: Ty, tcx: TyCtxt, typing_env: TypingEnv): boolean {
  // Handle simple cases directly, use the query with its cache for the rest.
  return new OpsemInhabitedCtx(tcx, typing_env, undefined, false).is_inhabited_ty(this);
};

/// N.B. this query should only be called through `Ty::inhabited_predicate`
// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:246 inhabited_predicate_type
function inhabited_predicate_type(tcx: TyCtxt, ty: Ty): InhabitedPredicate {
  const k = ty.kind();
  switch (k.$) {
    case "Adt":
      return InhabitedPredicate.instantiate(tcx.inhabited_predicate_for_def(k._0.did()), tcx, k._1);

    case "Tuple":
      return InhabitedPredicate.all(
        tcx,
        k._0.map((ty) => ty.inhabited_predicate(tcx)),
      );

    // If we can evaluate the array length before having a `ParamEnv`, then
    // we can simplify the predicate. This is an optimization.
    case "Array": {
      const ty = k._0;
      const len = k._1;
      const n = len.try_to_target_usize(tcx);
      if (n === 0n) return InhabitedPredicate.True;
      if (n !== undefined) return ty.inhabited_predicate(tcx);
      return InhabitedPredicate.or(ty.inhabited_predicate(tcx), tcx, { $: "ConstIsZero", _0: len });
    }

    default:
      return bug("unexpected TyKind, use `Ty::inhabited_predicate`");
  }
}

/// Context for computing whether a type is inhabited on the opsem level.
/// See `is_opsem_inhabited` above for the spec of what we compute.
class OpsemInhabitedCtx {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    /// IDs of ADTs that have been encountered in the current stack.
    /// It's `None` unless we are inside the `is_opsem_inhabited_adt_cached` query,
    /// which is only invoked for more complex types.
    public seen: DefIdSet | undefined,
    /// If an ADT is encountered recursively within itself, then `stop_at_ref`
    /// is set to `true`, and then any nested references are considered inhabited.
    public stop_at_ref: boolean,
  ) {}

  /// See `is_opsem_inhabited` above for the spec of what we compute.
  // rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:282 is_inhabited_ty
  is_inhabited_ty(ty: Ty): boolean {
    const tcx = this.tcx;
    const k = ty.kind();
    switch (k.$) {
      // Trivially (un)inhabited types
      case "Int":
      case "Uint":
      case "Float":
      case "Bool":
      case "Char":
      case "Str":
      case "Foreign":
      case "RawPtr":
      case "FnPtr":
      case "FnDef":
        return true;
      case "Dynamic":
        return true; // We can't reason about traits, assume they are inhabited
      case "Slice":
        return true; // Slices can always be empty
      case "Never":
        return false;

      // Types where we recurse
      case "Ref": {
        const pointee = k._1;
        if (this.stop_at_ref) {
          // Bailing out here is safe as the layout code always considers references
          // inhabited, so the implication ("layout uninhabited => opsem uninhabited")
          // is upheld.
          return true;
        }
        return this.is_inhabited_ty(pointee);
      }
      case "Tuple":
        return k._0.every((ty) => this.is_inhabited_ty(ty));
      case "Array": {
        const elem = k._0;
        const len = k._1;
        const n = len.try_to_target_usize(tcx);
        if (n === undefined) return bug("called `Option::unwrap()` on a `None` value");
        return n === 0n || this.is_inhabited_ty(elem);
      }
      case "Pat":
        return this.is_inhabited_ty(k._0);
      case "Closure": {
        const args = k._1.as_closure();
        return ClosureArgs.upvar_tys(args).every((ty) => this.is_inhabited_ty(ty));
      }
      case "Coroutine": {
        const args = k._1.as_coroutine();
        return CoroutineArgs.upvar_tys(args).every((ty) => this.is_inhabited_ty(ty));
      }
      case "CoroutineClosure": {
        const args = k._1.as_coroutine_closure();
        return CoroutineClosureArgs.upvar_tys(args).every((ty) => this.is_inhabited_ty(ty));
      }
      case "UnsafeBinder": {
        const base = tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(k._0), fold_Ty);
        return this.is_inhabited_ty(base);
      }
      case "Adt":
        return this.is_inhabited_adt_ty(k._0, k._1);

      case "Error":
        // We have a token proving there was an error, so we can return a dummy value.
        return true;

      case "Infer":
      case "Placeholder":
      case "Bound":
      case "Param":
      case "Alias":
      case "CoroutineWitness":
        return bug(`non-normalized type in \`is_opsem_uninhabited\`: \`${pretty().display_Ty(ty)}\``);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:349 is_inhabited_adt_ty
  is_inhabited_adt_ty(adt_def: AdtDef, adt_args: GenericArgsRef): boolean {
    const tcx = this.tcx;
    const typing_env = this.typing_env;

    if (adt_def.is_union()) {
      // Unions are always inhabited.
      return true;
    }

    const seen = this.seen;
    if (seen === undefined) {
      // stop recursing, invoke the query.
      return tcx.is_opsem_inhabited_adt_cached(typing_env.as_query_input([adt_def, adt_args]) as Parameters<TyCtxt["is_opsem_inhabited_adt_cached"]>[0]);
    }

    const new_adt = !seen.has(adt_def.did());
    seen.add(adt_def.did());
    // If we have seen this ADT before, stop at the next reference to avoid infinite
    // recursion. We can't stop here since we have to ensure that "layout uninhabited"
    // implies "opsem uninhabited". References are always layout-inhabited so the
    // implication is vacuously true.
    const stop_at_ref_prev = this.stop_at_ref;
    this.stop_at_ref ||= !new_adt;

    // We are inhabited if in some variant all fields are inhabited.
    const inhabited = adt_def.variants().some((variant) =>
      variant.fields.every((field) => {
        const ty = field.ty(tcx, adt_args);
        const ty_ = tcx.normalize_erasing_regions(typing_env, ty, fold_Ty);
        return this.is_inhabited_ty(ty_);
      }),
    );

    this.stop_at_ref = stop_at_ref_prev;
    // Remove the type again so that we allow it to appear on other branches.
    if (new_adt) {
      this.seen!.delete(adt_def.did());
    }

    return inhabited;
  }
}

// rustc: compiler/rustc_middle/src/ty/inhabitedness/mod.rs:394 is_opsem_inhabited_adt_cached
function is_opsem_inhabited_adt_cached(tcx: TyCtxt, env: PseudoCanonicalInput<[AdtDef, GenericArgsRef]>): boolean {
  const [[def, args], typing_env] = [env.value, env.typing_env];
  return new OpsemInhabitedCtx(tcx, typing_env, new DefIdSet(), false).is_inhabited_adt_ty(def, args);
}
