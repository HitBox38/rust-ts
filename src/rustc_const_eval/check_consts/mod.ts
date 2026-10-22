// Port of compiler/rustc_const_eval/src/check_consts/mod.rs (lane mt-promote).
//
// PORT: the field `const_kind` and the method `const_kind()` share a name upstream; the method is `const_kind_()`
// (precedent: mt-skeleton's `MirPatch` field/method clashes).
// PORT: the `lookup_const_stability` / `asyncness` / `type_of` / `fn_sig` query values are `unknown` in
// queries.gen.ts; they are cast to the upstream value types.
//! Check the bodies of `const`s, `static`s and `const fn`s for illegal operations.
//!
//! This module will eventually replace the parts of `qualify_consts.rs` that check whether a local
//! has interior mutability or needs to be dropped, as well as the visitor that emits errors when
//! it finds operations that are invalid in a certain context.

import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { ConstStability } from "../../rustc_attr_ir/stability.gen.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { ConstContext } from "../../rustc_hir/hir.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Asyncness, HasAttrs_LocalDefId, type Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { ClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { unwrap } from "../../std/panic.ts";

// pub use self::qualifs::Qualif;
export type { Qualif } from "./qualifs.ts";

// pub mod check;
export * as check from "./check.ts";
// mod ops;
export * as ops from "./ops.ts";
// pub mod post_drop_elaboration;
export * as post_drop_elaboration from "./post_drop_elaboration.ts";
// pub mod qualifs;
export * as qualifs from "./qualifs.ts";
// mod resolver;
export * as resolver from "./resolver.ts";

/// Information about the item currently being const-checked, as well as a reference to the global
/// context.
// rustc-type: compiler/rustc_const_eval/src/check_consts/mod.rs:25 ConstCx
export class ConstCx {
  constructor(
    public body: Body,
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public const_kind: ConstContext | undefined,
  ) {}

  // rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:33 new
  static new(tcx: TyCtxt, body: Body): ConstCx {
    const typing_env = body.typing_env(tcx);
    const const_kind = tcx.hir_body_const_context(body.source.def_id().expect_local());
    return new ConstCx(body, tcx, typing_env, const_kind);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:39 dcx
  dcx(): DiagCtxtHandle {
    return this.tcx.dcx();
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:43 def_id
  def_id(): LocalDefId {
    return this.body.source.def_id().expect_local();
  }

  /// Returns the kind of const context this `Item` represents (`const`, `static`, etc.).
  ///
  /// Panics if this `Item` is not const.
  // rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:50 const_kind
  const_kind_(): ConstContext {
    return unwrap(this.const_kind, "`const_kind` must not be called on a non-const fn");
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:54 enforce_recursive_const_stability
  enforce_recursive_const_stability(): boolean {
    // We can skip this if neither `staged_api` nor `-Zforce-unstable-if-unmarked` are enabled,
    // since in such crates `lookup_const_stability` will always be `None`.
    return (
      this.const_kind !== undefined &&
      this.const_kind.$ === "ConstFn" &&
      (this.tcx.features().staged_api() || this.tcx.sess.opts.unstable_opts.force_unstable_if_unmarked) &&
      is_fn_or_trait_safe_to_expose_on_stable(this.tcx, LocalDefId.to_def_id(this.def_id()))
    );
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:63 is_async
  is_async(): boolean {
    return Asyncness.is_async(this.tcx.asyncness(this.def_id()) as Asyncness);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:67 fn_sig
  fn_sig(): PolyFnSig {
    const did = LocalDefId.to_def_id(this.def_id());
    if (this.tcx.is_closure_like(did)) {
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(did) as EarlyBinder<Ty>));
      const k = ty.kind();
      if (k.$ !== "Closure") {
        return bug("type_of closure not ty::Closure");
      }
      const args = k._1;
      return ClosureArgs.sig(args.as_closure());
    } else {
      return Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(did) as EarlyBinder<PolyFnSig>));
    }
  }
}

// rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:79 rustc_allow_const_fn_unstable
export function rustc_allow_const_fn_unstable(tcx: TyCtxt, def_id: LocalDefId, feature_gate: Symbol): boolean {
  return (
    find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) =>
      k.$ === "RustcAllowConstFnUnstable" && k._0.includes(feature_gate) ? true : undefined,
    ) !== undefined
  );
}

/// Returns `true` if the given `def_id` (trait or function) is "safe to expose on stable".
///
/// This is relevant within a `staged_api` crate. Unlike with normal features, the use of unstable
/// const features *recursively* taints the functions that use them. This is to avoid accidentally
/// exposing e.g. the implementation of an unstable const intrinsic on stable. So we partition the
/// world into two functions: those that are safe to expose on stable (and hence may not use
/// unstable features, not even recursively), and those that are not.
// rustc: compiler/rustc_const_eval/src/check_consts/mod.rs:94 is_fn_or_trait_safe_to_expose_on_stable
export function is_fn_or_trait_safe_to_expose_on_stable(tcx: TyCtxt, def_id: DefId): boolean {
  // A default body in a `const trait` is const-stable when the trait is const-stable.
  const trait_id = tcx.trait_of_assoc(def_id);
  if (trait_id !== undefined && tcx.is_const_trait(trait_id)) {
    return is_fn_or_trait_safe_to_expose_on_stable(tcx, trait_id);
  }

  const stab = tcx.lookup_const_stability(def_id) as ConstStability | undefined;
  if (stab === undefined) {
    // In a `staged_api` crate, we do enforce recursive const stability for all unmarked
    // functions, so we can trust local functions. But in another crate we don't know which
    // rules were applied, so we can't trust that.
    return def_id.is_local() && tcx.features().staged_api();
  } else {
    // We consider things safe-to-expose if they are stable or if they are marked as
    // `const_stable_indirect`. Intrinsics are special so we need to check for those too.
    const i = tcx.intrinsic(def_id);
    return stab.is_const_stable() || stab.const_stable_indirect || (i !== undefined && i.const_stable_indirect);
  }
}
