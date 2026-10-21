// Port of compiler/rustc_type_ir/src/fast_reject.rs (lane tyir-misc, sub-lane infer; `SimplifiedType::def` by an
// earlier lane). `SimplifiedType` / `TreatParams` (type, derived Debug / Clone / Decodable_NoContext /
// Encodable_NoContext / StableHash) are generated into fast_reject.gen.ts and stable_hash.gen.ts. Crate metadata
// decodes `SimplifiedType<DefId>` as the keys of `incoherent_impls` and the self types of `trait_impls` (rmeta
// decoder.rs).
//
// PORT (D3): `I: Interner` is erased; `cx: I` is typed `Interner` (the bodies only call trait methods).
// PORT: `DeepRejectCtxt<I, const INSTANTIATE_LHS_WITH_INFER: bool, const INSTANTIATE_RHS_WITH_INFER: bool>` is a class
// whose two const generic params are readonly fields set by the constructor (`PhantomData<I>` is erased).
// PORT: derived `PartialEq` of non-interned values (`ParamTy`, `Placeholder*`, `AliasTyKind`, `FnHeader`, `ParamConst`)
// is `eq_by_value` (rust_ts/intern_key.ts: equal keys exactly when the Rust values are `==`); interned values
// (`Ty`, `AdtDef`, `ValTree`) compare with `===`.
// PORT: `I::Ty`'s provided `inherent::Ty` methods are `Ty_provided.<name>(ty)` (inherent.ts header).
// PORT: fns of other files that are not ported yet are module-local stand-ins at the end of this file; they call
// `unported`.
import { intern_key } from "../rust_ts/intern_key.ts";
import type { AdtDef, Value, ValTree } from "../rustc_middle/ty/decls.ts";
import { Value as ValueC } from "../rustc_middle/ty/consts/valtree.ts";
import { debug_GenericArg, fold_GenericArgs, GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unported, unwrap } from "../std/panic.ts";

import { TypeVisitableExt } from "./visit.ts";
import { Binder } from "./binder.ts";
import * as gen from "./fast_reject.gen.ts";
import type { TreatParams } from "./fast_reject.gen.ts";
import { Ty_provided } from "./inherent.ts";
import type { Interner } from "./interner.ts";
import type { Const } from "./sty/consts.ts";
import { FnSigTys, type InferTy, UnsafeBinderInner_deref } from "./ty_kind.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";

export * from "./fast_reject.gen.ts";

/// Tries to simplify a type by only returning the outermost injective¹ layer, if one exists.
///
/// **This function should only be used if you need to store or retrieve the type from some
/// hashmap. If you want to quickly decide whether two types may unify, use the [DeepRejectCtxt]
/// instead.**
///
/// The idea is to get something simple that we can use to quickly decide if two types could unify,
/// for example during method lookup. If this function returns `Some(x)` it can only unify with
/// types for which this method returns either `Some(x)` as well or `None`.
///
/// A special case here are parameters and projections, which are only injective
/// if they are treated as placeholders.
///
/// For example when storing impls based on their simplified self type, we treat
/// generic parameters as if they were inference variables. We must not simplify them here,
/// as they can unify with any other type.
///
/// With projections we have to be even more careful, as treating them as placeholders
/// is only correct if they are fully normalized.
///
/// ¹ meaning that if the outermost layers are different, then the whole types are also different.
// rustc: compiler/rustc_type_ir/src/fast_reject.rs:94 simplify_type
export function simplify_type(cx: Interner, ty: Ty, treat_params: TreatParams): SimplifiedType<DefId> | undefined {
  const kind = ty.kind();
  switch (kind.$) {
    case "Bool":
      return SimplifiedType.Bool;
    case "Char":
      return SimplifiedType.Char;
    case "Int":
      return { $: "Int", _0: kind._0 };
    case "Uint":
      return { $: "Uint", _0: kind._0 };
    case "Float":
      return { $: "Float", _0: kind._0 };
    case "Adt":
      return { $: "Adt", _0: kind._0.def_id() };
    case "Str":
      return SimplifiedType.Str;
    case "Array":
      return SimplifiedType.Array;
    case "Slice":
      return SimplifiedType.Slice;
    case "Pat":
      return simplify_type(cx, kind._0, treat_params);
    case "RawPtr":
      return { $: "Ptr", _0: kind._1 };
    case "Dynamic": {
      const principal_def_id = kind._0.principal_def_id();
      if (principal_def_id !== undefined && !cx.trait_is_auto(principal_def_id)) {
        return { $: "Trait", _0: principal_def_id };
      } else {
        return SimplifiedType.MarkerTraitObject;
      }
    }
    case "Ref":
      return { $: "Ref", _0: kind._2 };
    case "FnDef":
      return { $: "Closure", _0: kind._0 };
    case "Closure":
      return { $: "Closure", _0: kind._0 };
    case "CoroutineClosure":
      return { $: "Closure", _0: kind._0 };
    case "Coroutine":
      return { $: "Coroutine", _0: kind._0 };
    case "CoroutineWitness":
      return { $: "CoroutineWitness", _0: kind._0 };
    case "Never":
      return SimplifiedType.Never;
    case "Tuple":
      return { $: "Tuple", _0: kind._0.length };
    case "FnPtr":
      return { $: "Function", _0: FnSigTys.inputs(Binder.skip_binder(kind._0)).length };
    case "UnsafeBinder":
      return SimplifiedType.UnsafeBinder;
    case "Placeholder":
      return SimplifiedType.Placeholder;
    case "Param":
      if (treat_params === "AsRigid") {
        return SimplifiedType.Placeholder;
      } else {
        // `TreatParams::InstantiateWithInfer`
        return undefined;
      }
    case "Alias":
      // When treating `ty::Param` as a placeholder, projections also
      // don't unify with anything else as long as they are fully normalized.
      if (treat_params === "AsRigid" && (!TypeVisitableExt.has_non_region_infer(ty, fold_Ty) || cx.next_trait_solver_globally())) {
        return SimplifiedType.Placeholder;
      } else {
        return undefined;
      }
    case "Foreign":
      return { $: "Foreign", _0: kind._0 };
    case "Error":
      return SimplifiedType.Error;
    case "Bound":
    case "Infer":
      return undefined;
  }
}

export type SimplifiedType<DefId> = gen.SimplifiedType<DefId>;
export const SimplifiedType = {
  ...gen.SimplifiedType,

  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:151 def
  def<DefId>(self: SimplifiedType<DefId>): DefId | undefined {
    switch (self.$) {
      case "Adt":
      case "Foreign":
      case "Trait":
      case "Closure":
      case "Coroutine":
      case "CoroutineWitness":
        return self._0;
      default:
        return undefined;
    }
  },
};

/**
 * PORT: `#[derive(PartialEq, Eq, Hash)]` of `SimplifiedType<DefId>` as a JS map key (rust_ts/keyed.ts `KeyedMap`):
 * the variant name plus its field, the `DefId` through `key_DefId`. Equal exactly when the Rust values are `==`.
 */
export function SimplifiedType_key<DefId>(self: SimplifiedType<DefId>, key_DefId: (d: DefId) => string | number): string {
  switch (self.$) {
    case "Int":
    case "Uint":
    case "Float":
    case "Ref":
    case "Ptr":
    case "Tuple":
    case "Function":
      return `${self.$}(${self._0})`;
    case "Adt":
    case "Foreign":
    case "Trait":
    case "Closure":
    case "Coroutine":
    case "CoroutineWitness":
      return `${self.$}(${key_DefId(self._0)})`;
    default:
      return self.$;
  }
}

/// Given generic arguments, could they be unified after
/// replacing parameters with inference variables or placeholders.
/// This behavior is toggled using the const generics.
///
/// We use this to quickly reject impl/wc candidates without needing
/// to instantiate generic arguments/having to enter a probe.
///
/// We also use this function during coherence. For coherence the
/// impls only have to overlap for some value, so we treat parameters
/// on both sides like inference variables.
// PORT: `#[derive(Debug)]` (`DeepRejectCtxt { _interner: PhantomData<..> }`, a type name) is not ported: nothing
// prints it.
// rustc-type: compiler/rustc_type_ir/src/fast_reject.rs:175 DeepRejectCtxt
export class DeepRejectCtxt {
  constructor(
    readonly INSTANTIATE_LHS_WITH_INFER: boolean,
    readonly INSTANTIATE_RHS_WITH_INFER: boolean,
  ) {}

  // ---- impl<I> DeepRejectCtxt<I, false, false> ----

  /// Treat parameters in both the lhs and the rhs as rigid.
  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:185 relate_rigid_rigid
  static relate_rigid_rigid(_interner: Interner): DeepRejectCtxt {
    return new DeepRejectCtxt(false, false);
  }

  // ---- impl<I> DeepRejectCtxt<I, true, true> ----

  /// Treat parameters in both the lhs and the rhs as infer vars.
  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:192 relate_infer_infer
  static relate_infer_infer(_interner: Interner): DeepRejectCtxt {
    return new DeepRejectCtxt(true, true);
  }

  // ---- impl<I> DeepRejectCtxt<I, false, true> ----

  /// Treat parameters in the lhs as rigid, and in rhs as infer vars.
  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:199 relate_rigid_infer
  static relate_rigid_infer(_interner: Interner): DeepRejectCtxt {
    return new DeepRejectCtxt(false, true);
  }

  // ---- impl<I, const INSTANTIATE_LHS_WITH_INFER: bool, const INSTANTIATE_RHS_WITH_INFER: bool> ----

  // Quite arbitrary. Large enough to only affect a very tiny amount of impls/crates
  // and small enough to prevent hangs.
  static readonly STARTING_DEPTH: number = 8;

  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:211 args_may_unify
  args_may_unify(obligation_args: GenericArgs, impl_args: GenericArgs): boolean {
    return this.args_may_unify_inner(obligation_args, impl_args, DeepRejectCtxt.STARTING_DEPTH);
  }

  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:219 types_may_unify
  types_may_unify(lhs: Ty, rhs: Ty): boolean {
    return this.types_may_unify_inner(lhs, rhs, DeepRejectCtxt.STARTING_DEPTH);
  }

  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:223 types_may_unify_with_depth
  types_may_unify_with_depth(lhs: Ty, rhs: Ty, depth_limit: number): boolean {
    return this.types_may_unify_inner(lhs, rhs, depth_limit);
  }

  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:227 args_may_unify_inner
  args_may_unify_inner(obligation_args: GenericArgs, impl_args: GenericArgs, depth: number): boolean {
    // No need to decrement the depth here as this function is only
    // recursively reachable via `types_may_unify_inner` which already
    // increments the depth for us.
    const may_unify = ([obl, imp]: [GenericArg, GenericArg]): boolean => {
      const obl_kind = GenericArg.kind(obl);
      const imp_kind = GenericArg.kind(imp);
      if (obl_kind.$ === "Lifetime") {
        // We don't fast reject based on regions.
        // debug_assert!(matches!(imp.kind(), ty::GenericArgKind::Lifetime(_)));
        return true;
      } else if (obl_kind.$ === "Type" && imp_kind.$ === "Type") {
        return this.types_may_unify_inner(obl_kind._0, imp_kind._0, depth);
      } else if (obl_kind.$ === "Const" && imp_kind.$ === "Const") {
        return this.consts_may_unify_inner(obl_kind._0, imp_kind._0);
      } else {
        return panic(`kind mismatch: ${debug_GenericArg(obl, PLAIN)} ${debug_GenericArg(imp, PLAIN)}`);
      }
    };

    // Specialize the common `(1, 1)` case to avoid iterator machinery.
    if (obligation_args.length === 1 && impl_args.length === 1) {
      return may_unify([obligation_args[0]!, impl_args[0]!]);
    }

    const n = Math.min(obligation_args.length, impl_args.length);
    for (let i = 0; i < n; i++) {
      if (!may_unify([obligation_args[i]!, impl_args[i]!])) return false;
    }
    return true;
  }

  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:263 types_may_unify_inner
  types_may_unify_inner(lhs: Ty, rhs: Ty, depth: number): boolean {
    if (lhs === rhs) {
      return true;
    }

    const rhs_kind = rhs.kind();
    switch (rhs_kind.$) {
      // Start by checking whether the `rhs` type may unify with
      // pretty much everything. Just return `true` in that case.
      case "Param":
        if (this.INSTANTIATE_RHS_WITH_INFER) {
          return true;
        }
        break;
      case "Alias":
        if (rhs_kind._0 === "Yes") {
          // `ty::Alias(ty::IsRigid::Yes, _)`: same arm as `ty::Param(_)`
          if (this.INSTANTIATE_RHS_WITH_INFER) {
            return true;
          }
          break;
        }
        // `ty::Alias(ty::IsRigid::No, _)`: same arm as `ty::Error(_) | ty::Bound(..)`
        return true;
      case "Error":
      case "Bound":
        return true;
      case "Infer":
        return this.var_and_ty_may_unify(rhs_kind._0, lhs);

      // These types only unify with inference variables or their own
      // variant.
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Adt":
      case "Str":
      case "Array":
      case "Slice":
      case "RawPtr":
      case "Dynamic":
      case "Pat":
      case "Ref":
      case "Never":
      case "Tuple":
      case "FnDef":
      case "FnPtr":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "Foreign":
      case "Placeholder":
      case "UnsafeBinder":
        break;
    }

    // The type system needs to support exponentially large types
    // as long as they are self-similar. While most other folders
    // use caching to handle them, this folder exists purely as a
    // perf optimization and is incredibly hot. In pretty much all
    // uses checking the cache is slower than simply recursing, so
    // we instead just add an arbitrary depth cutoff.
    //
    // We only decrement the depth here as the match on `rhs`
    // does not recurse.
    if (depth === 0) {
      return true;
    }
    depth = depth - 1;

    // For purely rigid types, use structural equivalence.
    const lhs_kind = lhs.kind();
    switch (lhs_kind.$) {
      case "Ref": {
        const k = rhs.kind();
        switch (k.$) {
          case "Ref":
            return lhs_kind._2 === k._2 && this.types_may_unify_inner(lhs_kind._1, k._1, depth);
          default:
            return false;
        }
      }

      case "Adt": {
        const k = rhs.kind();
        switch (k.$) {
          case "Adt":
            return lhs_kind._0 === k._0 && this.args_may_unify_inner(lhs_kind._1, k._1, depth);
          default:
            return false;
        }
      }

      // Depending on the value of const generics, we either treat generic parameters
      // like placeholders or like inference variables.
      case "Param": {
        const lhs_ = lhs_kind._0;
        if (this.INSTANTIATE_LHS_WITH_INFER) return true;
        const k = rhs.kind();
        switch (k.$) {
          case "Param":
            return eq_by_value(lhs_, k._0);
          default:
            return false;
        }
      }

      // Placeholder types don't unify with anything on their own.
      case "Placeholder": {
        const k = rhs.kind();
        return k.$ === "Placeholder" && eq_by_value(lhs_kind._0, k._0);
      }

      case "Infer":
        return this.var_and_ty_may_unify(lhs_kind._0, rhs);

      case "Alias":
        if (lhs_kind._0 === "Yes") {
          // Since we ensure that the rhs is not non-rigid alias,
          // lhs rigid alias can only unify with it if it's a rigid alias of the same kind.
          const lhs_alias = lhs_kind._1;
          if (this.INSTANTIATE_LHS_WITH_INFER) return true;
          const k = rhs.kind();
          if (k.$ === "Alias" && k._0 === "Yes") {
            const rhs_alias = k._1;
            return eq_by_value(lhs_alias.kind, rhs_alias.kind) && this.args_may_unify_inner(lhs_alias.args, rhs_alias.args, depth);
          } else {
            return false;
          }
        } else {
          // As we're walking the whole type, it may encounter projections
          // inside of binders and what not, so we're just going to assume that
          // non-rigid alias can unify with anything.
          return true;
        }

      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Bool":
      case "Char":
      case "Never":
      case "Foreign":
        return lhs === rhs;

      case "Tuple": {
        const k = rhs.kind();
        switch (k.$) {
          case "Tuple": {
            const lhs_ = lhs_kind._0;
            const rhs_ = k._0;
            if (lhs_.length !== rhs_.length) return false;
            for (let i = 0; i < lhs_.length; i++) {
              if (!this.types_may_unify_inner(lhs_[i]!, rhs_[i]!, depth)) return false;
            }
            return true;
          }
          default:
            return false;
        }
      }

      case "Array": {
        const k = rhs.kind();
        switch (k.$) {
          case "Array":
            return this.types_may_unify_inner(lhs_kind._0, k._0, depth) && this.consts_may_unify_inner(lhs_kind._1, k._1);
          default:
            return false;
        }
      }

      case "RawPtr": {
        const k = rhs.kind();
        switch (k.$) {
          case "RawPtr":
            return lhs_kind._1 === k._1 && this.types_may_unify_inner(lhs_kind._0, k._0, depth);
          default:
            return false;
        }
      }

      case "Slice": {
        const k = rhs.kind();
        return k.$ === "Slice" && this.types_may_unify_inner(lhs_kind._0, k._0, depth);
      }

      case "Dynamic": {
        // Ideally we would walk the existential predicates here or at least
        // compare their length. But considering that the relevant `Relate` impl
        // actually sorts and deduplicates these, that doesn't work.
        const k = rhs.kind();
        return k.$ === "Dynamic" && Option_DefId_eq(lhs_kind._0.principal_def_id(), k._0.principal_def_id());
      }

      case "FnPtr": {
        const k = rhs.kind();
        switch (k.$) {
          case "FnPtr": {
            const lhs_sig_tys = Binder.skip_binder(lhs_kind._0).inputs_and_output;
            const rhs_sig_tys = Binder.skip_binder(k._0).inputs_and_output;

            if (!(eq_by_value(lhs_kind._1, k._1) && lhs_sig_tys.length === rhs_sig_tys.length)) return false;
            for (let i = 0; i < lhs_sig_tys.length; i++) {
              if (!this.types_may_unify_inner(lhs_sig_tys[i]!, rhs_sig_tys[i]!, depth)) return false;
            }
            return true;
          }
          default:
            return false;
        }
      }

      case "Bound":
        return true;

      case "FnDef": {
        const k = rhs.kind();
        switch (k.$) {
          case "FnDef":
            return (
              DefId_eq(lhs_kind._0, k._0) &&
              this.args_may_unify_inner(
                unwrap(Binder.no_bound_vars(lhs_kind._1, fold_GenericArgs)),
                unwrap(Binder.no_bound_vars(k._1, fold_GenericArgs)),
                depth,
              )
            );
          default:
            return false;
        }
      }

      case "Closure": {
        const k = rhs.kind();
        switch (k.$) {
          case "Closure":
            return DefId_eq(lhs_kind._0, k._0) && this.args_may_unify_inner(lhs_kind._1, k._1, depth);
          default:
            return false;
        }
      }

      case "CoroutineClosure": {
        const k = rhs.kind();
        switch (k.$) {
          case "CoroutineClosure":
            return DefId_eq(lhs_kind._0, k._0) && this.args_may_unify_inner(lhs_kind._1, k._1, depth);
          default:
            return false;
        }
      }

      case "Coroutine": {
        const k = rhs.kind();
        switch (k.$) {
          case "Coroutine":
            return DefId_eq(lhs_kind._0, k._0) && this.args_may_unify_inner(lhs_kind._1, k._1, depth);
          default:
            return false;
        }
      }

      case "CoroutineWitness": {
        const k = rhs.kind();
        switch (k.$) {
          case "CoroutineWitness":
            return DefId_eq(lhs_kind._0, k._0) && this.args_may_unify_inner(lhs_kind._1, k._1, depth);
          default:
            return false;
        }
      }

      case "Pat": {
        // FIXME(pattern_types): take pattern into account
        const k = rhs.kind();
        return k.$ === "Pat" && this.types_may_unify_inner(lhs_kind._0, k._0, depth);
      }

      case "UnsafeBinder": {
        const k = rhs.kind();
        switch (k.$) {
          case "UnsafeBinder":
            return this.types_may_unify_inner(
              Binder.skip_binder(UnsafeBinderInner_deref(lhs_kind._0)),
              Binder.skip_binder(UnsafeBinderInner_deref(k._0)),
              depth,
            );
          default:
            return false;
        }
      }

      case "Error":
        return true;
    }
  }

  // Unlike `types_may_unify_inner`, this does not take a depth as
  // we never recurse from this function.
  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:489 consts_may_unify_inner
  consts_may_unify_inner(lhs: Const, rhs: Const): boolean {
    const rhs_kind = rhs.kind();
    switch (rhs_kind.$) {
      case "Param":
        if (this.INSTANTIATE_RHS_WITH_INFER) {
          return true;
        }
        break;

      case "Expr":
      case "Alias":
      case "Error":
      case "Infer":
      case "Bound":
        return true;

      case "Value":
      case "Placeholder":
        break;
    }

    const lhs_kind = lhs.kind();
    switch (lhs_kind.$) {
      case "Value": {
        const k = rhs.kind();
        switch (k.$) {
          case "Value":
            return Value_valtree(lhs_kind._0) === Value_valtree(k._0);
          default:
            return false;
        }
      }

      case "Param": {
        if (this.INSTANTIATE_LHS_WITH_INFER) return true;
        const k = rhs.kind();
        switch (k.$) {
          case "Param":
            return eq_by_value(lhs_kind._0, k._0);
          default:
            return false;
        }
      }

      // Placeholder consts don't unify with anything on their own
      case "Placeholder": {
        const k = rhs.kind();
        return k.$ === "Placeholder" && eq_by_value(lhs_kind._0, k._0);
      }

      // As we don't necessarily eagerly evaluate constants,
      // they might unify with any value.
      case "Expr":
      case "Alias":
      case "Error":
        return true;

      case "Infer":
      case "Bound":
        return true;
    }
  }

  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:535 var_and_ty_may_unify
  var_and_ty_may_unify(var_: InferTy, ty: Ty): boolean {
    if (!Ty_provided.is_known_rigid(ty)) {
      return true;
    }

    switch (var_.$) {
      case "IntVar":
        return Ty_provided.is_integral(ty);
      case "FloatVar":
        return Ty_provided.is_floating_point(ty);
      default:
        return true;
    }
  }
}

/** PORT: derived `PartialEq` of a non-interned value (module header). */
function eq_by_value<T>(a: T, b: T): boolean {
  return intern_key(a) === intern_key(b);
}

/** `Option<DefId> == Option<DefId>`. */
function Option_DefId_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return DefId_eq(a, b);
}

// ---- PORT stand-ins for fns of other files that are not ported yet (module header) -----------------------------------


/** `impl inherent::ValueConst for ty::Value` `valtree` (rustc_middle ty/consts/valtree.rs:235, lane ty-results). */
function Value_valtree(v: Value): ValTree {
  return ValueC.valtree(v);
}
