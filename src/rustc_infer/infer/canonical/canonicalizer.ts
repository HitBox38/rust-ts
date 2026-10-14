// Port of compiler/rustc_infer/src/infer/canonical/canonicalizer.rs (lane infer-canonical-outlives).
//
//! This module contains the "canonicalizer" itself.
//!
//! For an overview of what canonicalization is and how it fits into
//! rustc, check out the [chapter in the rustc dev guide][c].
//!
//! [c]: https://rust-lang.github.io/chalk/book/canonical_queries/canonicalization.html
//
// PORT: `trait CanonicalizeMode` is the interface `CanonicalizeMode`; its four unit-struct impls are the frozen singletons
// `CanonicalizeQueryResponse`, `CanonicalizeUserTypeAnnotation`, `CanonicalizeAllFreeRegions` and
// `CanonicalizeFreeRegionsOtherThanStatic` (`&dyn CanonicalizeMode` is the object). `Canonicalizer` is the generated class
// (canonicalizer.gen.ts): its `TypeFolder` impl and inherent methods are assigned onto its prototype below; the
// associated fns `canonicalize` / `canonicalize_with_base` are statics. Generic fns take the D4 descriptor last.
// PORT: `query_state.var_values` is a `SmallVec<[GenericArg; 8]>`; `spilled()` (heap-allocated) is `len > 8`: the
// vector only ever grows (pushes and `extend`), so it has spilled exactly when it once held more than 8 elements.
// PORT: `tracing::debug!` / `#[instrument]` lines are dropped (no output: tracing is not enabled in the oracle runs).
import { SsoHashMap } from "../../../rustc_data_structures/sso/mod.ts";
import { LAYOUT_USIZE, u32_key } from "../../../rust_ts/hash_map.ts";
import { OriginalQueryValues } from "../../../rustc_middle/infer/canonical.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../../rustc_middle/ty/decls.ts";
import type { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { ParamEnv, type ParamEnvAnd, Ty, fold_with_ParamEnv, try_fold_with_ParamEnv, visit_with_ParamEnv } from "../../../rustc_middle/ty/mod.ts";
import { fold_Clauses, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { type Binder, PlaceholderConst, PlaceholderRegion, PlaceholderType } from "../../../rustc_type_ir/binder.ts";
import { type Canonical, type CanonicalQueryInput, CanonicalVarKind, Canonical as CanonicalC } from "../../../rustc_type_ir/canonical.ts";
import type { TyVid } from "../../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { BoundVar, UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { Const, fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { debug_Region, Region } from "../../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../../std/panic.ts";
import { InferCtxt } from "../../decls.ts";
import { Canonicalizer } from "./canonicalizer.gen.ts";

export * from "./canonicalizer.gen.ts";

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:41 canonicalize_query
InferCtxt.prototype.canonicalize_query = function <V>(
  this: InferCtxt,
  value: ParamEnvAnd<V>,
  query_state: OriginalQueryValues,
  d_V: TypeFoldable<V>,
): CanonicalQueryInput<ParamEnvAnd<V>> {
  const { param_env, value: value_ } = value;
  const canonical_param_env = this.tcx.caches.canonical_param_env_cache.get_or_insert(
    this.tcx,
    param_env,
    query_state,
    (tcx, param_env, query_state) => {
      // FIXME(#118965): We don't canonicalize the static lifetimes that appear in the
      // `param_env` because they are treated differently by trait selection.
      return Canonicalizer.canonicalize(param_env, undefined, tcx, CanonicalizeFreeRegionsOtherThanStatic, query_state, fold_ParamEnv_);
    },
  );

  const canonical = CanonicalC.unchecked_map(
    Canonicalizer.canonicalize_with_base(canonical_param_env, value_, this, this.tcx, CanonicalizeAllFreeRegions, query_state, d_V),
    ([param_env, value]) => param_env.and(value),
  );
  return { canonical, typing_mode: { _0: this.typing_mode_raw() } };
};

/// Canonicalizes a query *response* `V`. When we canonicalize a
/// query response, we only canonicalize unbound inference
/// variables, and we leave other free regions alone. So,
/// continuing with the example from `canonicalize_query`, if
/// there was an input query `T: Trait<'static>`, it would have
/// been canonicalized to
///
/// ```text
/// T: Trait<'?0>
/// ```
///
/// with a mapping M that maps `'?0` to `'static`. But if we found that there
/// exists only one possible impl of `Trait`, and it looks like
/// ```ignore (illustrative)
/// impl<T> Trait<'static> for T { .. }
/// ```
/// then we would prepare a query result R that (among other
/// things) includes a mapping to `'?0 := 'static`. When
/// canonicalizing this query result R, we would leave this
/// reference to `'static` alone.
///
/// To get a good understanding of what is happening here, check
/// out the [chapter in the rustc dev guide][c].
///
/// [c]: https://rust-lang.github.io/chalk/book/canonical_queries/canonicalization.html#canonicalizing-the-query-result
// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:104 canonicalize_response
InferCtxt.prototype.canonicalize_response = function <V>(this: InferCtxt, value: V, d_V: TypeFoldable<V>): Canonical<V> {
  const query_state = OriginalQueryValues.default_();
  return Canonicalizer.canonicalize(value, this, this.tcx, CanonicalizeQueryResponse, query_state, d_V);
};

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:118 canonicalize_user_type_annotation
InferCtxt.prototype.canonicalize_user_type_annotation = function <V>(this: InferCtxt, value: V, d_V: TypeFoldable<V>): Canonical<V> {
  const query_state = OriginalQueryValues.default_();
  return Canonicalizer.canonicalize(value, this, this.tcx, CanonicalizeUserTypeAnnotation, query_state, d_V);
};

/// Controls how we canonicalize "free regions" that are not inference
/// variables. This depends on what we are canonicalizing *for* --
/// e.g., if we are canonicalizing to create a query, we want to
/// replace those with inference variables, since we want to make a
/// maximally general query. But if we are canonicalizing a *query
/// response*, then we don't typically replace free regions, as they
/// must have been introduced from other parts of the system.
// rustc-trait: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:140 CanonicalizeMode
export interface CanonicalizeMode {
  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:141 canonicalize_free_region
  canonicalize_free_region(canonicalizer: Canonicalizer, r: Region): Region;

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:147 any
  any(): boolean;

  // Do we preserve universe of variables.
  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:150 preserve_universes
  preserve_universes(): boolean;
}

// rustc-type: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:153 CanonicalizeQueryResponse
export const CanonicalizeQueryResponse: CanonicalizeMode = Object.freeze({
  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:156 canonicalize_free_region
  canonicalize_free_region(canonicalizer: Canonicalizer, r: Region): Region {
    const infcx = unwrap(canonicalizer.infcx);

    const rk0 = r.kind();
    if (rk0.$ === "ReVar") {
      const vid = rk0._0;
      r = infcx.inner.unwrap_region_constraints().shallow_resolve_region_var(canonicalizer.tcx, vid);
      // debug!("canonical: region var found with vid {vid:?}, opportunistically resolved to {r:?}");
    }

    const rk = r.kind();
    switch (rk.$) {
      case "ReLateParam":
      case "ReErased":
      case "ReStatic":
      case "ReEarlyParam":
        return r;

      case "RePlaceholder": {
        const placeholder = rk._0;
        return canonicalizer.canonical_var_for_region({ $: "PlaceholderRegion", _0: placeholder }, r);
      }

      case "ReVar": {
        const vid = rk._0;
        const res = infcx.inner.unwrap_region_constraints().try_resolve_region_var(vid);
        if (res.$ === "Ok") {
          return panic(`called \`Result::unwrap_err()\` on an \`Ok\` value: ${debug_Region(res._0, PLAIN)}`);
        }
        const universe = res._0;
        return canonicalizer.canonical_var_for_region({ $: "Region", _0: universe }, r);
      }

      default: {
        // Other than `'static` or `'empty`, the query
        // response should be executing in a fully
        // canonicalized environment, so there shouldn't be
        // any other region names it can come up.
        //
        // rust-lang/rust#57464: `impl Trait` can leak local
        // scopes (in manner violating typeck). Therefore, use
        // `delayed_bug` to allow type error over an ICE.
        canonicalizer.tcx.dcx().delayed_bug(`unexpected region in query response: \`${debug_Region(r, PLAIN)}\``);
        return r;
      }
    }
  },

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:209 any
  any(): boolean {
    return false;
  },

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:213 preserve_universes
  preserve_universes(): boolean {
    return true;
  },
});

// rustc-type: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:218 CanonicalizeUserTypeAnnotation
export const CanonicalizeUserTypeAnnotation: CanonicalizeMode = Object.freeze({
  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:221 canonicalize_free_region
  canonicalize_free_region(canonicalizer: Canonicalizer, r: Region): Region {
    const rk = r.kind();
    switch (rk.$) {
      case "ReEarlyParam":
      case "ReLateParam":
      case "ReErased":
      case "ReStatic":
      case "ReError":
        return r;
      case "ReVar":
        return canonicalizer.canonical_var_for_region_in_root_universe(r);
      case "RePlaceholder":
      case "ReBound":
        // We only expect region names that the user can type.
        return bug(`unexpected region in query response: \`${debug_Region(r, PLAIN)}\``);
    }
  },

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:240 any
  any(): boolean {
    return false;
  },

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:244 preserve_universes
  preserve_universes(): boolean {
    return false;
  },
});

// rustc-type: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:249 CanonicalizeAllFreeRegions
export const CanonicalizeAllFreeRegions: CanonicalizeMode = Object.freeze({
  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:252 canonicalize_free_region
  canonicalize_free_region(canonicalizer: Canonicalizer, r: Region): Region {
    return canonicalizer.canonical_var_for_region_in_root_universe(r);
  },

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:260 any
  any(): boolean {
    return true;
  },

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:264 preserve_universes
  preserve_universes(): boolean {
    return false;
  },
});

// rustc-type: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:269 CanonicalizeFreeRegionsOtherThanStatic
export const CanonicalizeFreeRegionsOtherThanStatic: CanonicalizeMode = Object.freeze({
  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:272 canonicalize_free_region
  canonicalize_free_region(canonicalizer: Canonicalizer, r: Region): Region {
    if (r.is_static()) {
      return r;
    } else {
      return canonicalizer.canonical_var_for_region_in_root_universe(r);
    }
  },

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:280 any
  any(): boolean {
    return true;
  },

  // rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:284 preserve_universes
  preserve_universes(): boolean {
    return false;
  },
});

declare module "./canonicalizer.gen.ts" {
  // PORT: `impl TypeFolder<TyCtxt> for Canonicalizer` and the inherent methods.
  interface Canonicalizer extends TypeFolder {
    canonical_var(var_kind: CanonicalVarKind, value: GenericArg): BoundVar;
    get_or_insert_sub_root(vid: TyVid): BoundVar;
    universe_canonicalized_var_kinds(): CanonicalVarKind[];
    canonical_var_for_region_in_root_universe(r: Region): Region;
    canonical_var_for_region(var_kind: CanonicalVarKind, r: Region): Region;
    canonicalize_ty_var(var_kind: CanonicalVarKind, ty_var: Ty): Ty;
    canonicalize_const_var(var_kind: CanonicalVarKind, ct_var: Const): Const;
  }
  namespace Canonicalizer {
    export let canonicalize: <V>(value: V, infcx: InferCtxt | undefined, tcx: TyCtxt, canonicalize_region_mode: CanonicalizeMode, query_state: OriginalQueryValues, d_V: TypeFoldable<V>) => Canonical<V>;
    export let canonicalize_with_base: <U, V>(
      base: Canonical<U>,
      value: V,
      infcx: InferCtxt | undefined,
      tcx: TyCtxt,
      canonicalize_region_mode: CanonicalizeMode,
      query_state: OriginalQueryValues,
      d_V: TypeFoldable<V>,
    ) => Canonical<[U, V]>;
  }
}

/** The `&'cx dyn CanonicalizeMode` field (the generated class types it `unknown`). */
function mode(self: Canonicalizer): CanonicalizeMode {
  return self.canonicalize_mode as CanonicalizeMode;
}

/** PORT: `SmallVec::<[GenericArg; 8]>::spilled` of `query_state.var_values` (module comment). */
function spilled(var_values: readonly GenericArg[]): boolean {
  return var_values.length > 8;
}

// ---- impl TypeFolder<TyCtxt> for Canonicalizer ----

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:310 cx
Canonicalizer.prototype.cx = function (this: Canonicalizer): TyCtxt {
  return this.tcx;
};

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:314 fold_region
Canonicalizer.prototype.fold_region = function (this: Canonicalizer, r: Region): Region {
  const rk = r.kind();
  switch (rk.$) {
    case "ReBound":
      if (rk._0.$ === "Bound") {
        return r;
      } else {
        // ty::ReBound(ty::BoundVarIndexKind::Canonical, _)
        return bug("canonicalized bound var found during canonicalization");
      }

    case "ReStatic":
    case "ReEarlyParam":
    case "ReError":
    case "ReLateParam":
    case "RePlaceholder":
    case "ReVar":
    case "ReErased":
      return mode(this).canonicalize_free_region(this, r);
  }
};

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:332 fold_ty
Canonicalizer.prototype.fold_ty = function (this: Canonicalizer, t: Ty): Ty {
  const tk = t.kind();
  switch (tk.$) {
    case "Infer": {
      const i = tk._0;
      switch (i.$) {
        case "TyVar": {
          let vid = i._0;
          // We need to canonicalize the *root* of our ty var.
          // This is so that our canonical response correctly reflects
          // any equated inference vars correctly!
          const root_vid = unwrap(this.infcx).root_var(vid);
          if (root_vid !== vid) {
            t = Ty.new_var(this.tcx, root_vid);
            vid = root_vid;
          }

          // debug!("canonical: type var found with vid {:?}", vid);
          const r = unwrap(this.infcx).try_resolve_ty_var(vid);
          switch (r.$) {
            // `t` could be a float / int variable; canonicalize that instead.
            case "Ok": {
              const t = r._0;
              // debug!("(resolved to {:?})", t);
              return this.fold_ty(t);
            }

            // `TyVar(vid)` is unresolved, track its universe index in the canonicalized
            // result.
            case "Err": {
              let ui = r._0;
              if (!mode(this).preserve_universes()) {
                // FIXME: perf problem described in #55921.
                ui = UniverseIndex.ROOT;
              }
              const sub_root = this.get_or_insert_sub_root(vid);
              return this.canonicalize_ty_var({ $: "Ty", ui, sub_root }, t);
            }
          }
          break;
        }

        case "IntVar": {
          const vid = i._0;
          const nt = unwrap(this.infcx).shallow_resolve_int_var(vid);
          if (nt !== t) {
            return this.fold_ty(nt);
          } else {
            return this.canonicalize_ty_var(CanonicalVarKind.Int, t);
          }
        }
        case "FloatVar": {
          const vid = i._0;
          const nt = unwrap(this.infcx).shallow_resolve_float_var(vid);
          if (nt !== t) {
            return this.fold_ty(nt);
          } else {
            return this.canonicalize_ty_var(CanonicalVarKind.Float, t);
          }
        }

        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return bug("encountered a fresh type during canonicalization");
      }
      break;
    }

    case "Placeholder": {
      let placeholder = tk._0;
      if (!mode(this).preserve_universes()) {
        // PORT: `placeholder.universe = ROOT` on the copied `Placeholder` (a struct value).
        placeholder = { ...placeholder, universe: UniverseIndex.ROOT };
      }
      return this.canonicalize_ty_var({ $: "PlaceholderTy", _0: placeholder }, t);
    }

    case "Bound":
      if (tk._0.$ === "Bound") {
        return t;
      } else {
        // ty::Bound(ty::BoundVarIndexKind::Canonical, _)
        return bug("canonicalized bound var found during canonicalization");
      }

    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Adt":
    case "Str":
    case "Error":
    case "Array":
    case "Slice":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "Dynamic":
    case "UnsafeBinder":
    case "Never":
    case "Tuple":
    case "Alias":
    case "Foreign":
    case "Pat":
    case "Param": {
      if (TypeFlags.intersects(t.flags(), this.needs_canonical_flags)) {
        return fold_Ty.super_fold_with(t, this);
      } else {
        return t;
      }
    }
  }
  return panic("internal error: entered unreachable code");
};

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:434 fold_const
Canonicalizer.prototype.fold_const = function (this: Canonicalizer, ct: Const): Const {
  const ck = ct.kind();
  switch (ck.$) {
    case "Infer": {
      const i = ck._0;
      if (i.$ === "Var") {
        let vid = i._0;
        // We need to canonicalize the *root* of our const var.
        // This is so that our canonical response correctly reflects
        // any equated inference vars correctly!
        const root_vid = unwrap(this.infcx).root_const_var(vid);
        if (root_vid !== vid) {
          ct = Const.new_var(this.tcx, root_vid);
          vid = root_vid;
        }

        // debug!("canonical: const var found with vid {:?}", vid);
        const r = unwrap(this.infcx).try_resolve_const_var(vid);
        switch (r.$) {
          case "Ok": {
            const c = r._0;
            // debug!("(resolved to {:?})", c);
            return this.fold_const(c);
          }

          // `ConstVar(vid)` is unresolved, track its universe index in the
          // canonicalized result
          case "Err": {
            let ui = r._0;
            if (!mode(this).preserve_universes()) {
              // FIXME: perf problem described in #55921.
              ui = UniverseIndex.ROOT;
            }
            return this.canonicalize_const_var({ $: "Const", _0: ui }, ct);
          }
        }
      } else {
        // ty::ConstKind::Infer(InferConst::Fresh(_))
        return bug("encountered a fresh const during canonicalization");
      }
      break;
    }
    case "Bound":
      if (ck._0.$ === "Bound") {
        return ct;
      } else {
        // ty::ConstKind::Bound(ty::BoundVarIndexKind::Canonical, _)
        return bug("canonicalized bound var found during canonicalization");
      }
    case "Placeholder": {
      const placeholder = ck._0;
      return this.canonicalize_const_var({ $: "PlaceholderConst", _0: placeholder }, ct);
    }
    default:
      break;
  }

  if (TypeFlags.intersects(ct.flags(), this.needs_canonical_flags)) {
    return fold_Const.super_fold_with(ct, this);
  } else {
    return ct;
  }
};

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:487 fold_predicate
Canonicalizer.prototype.fold_predicate = function <P>(this: Canonicalizer, p: P, d: PredicateProxy<P>): P {
  if (TypeFlags.intersects(d.flags.flags(p), this.needs_canonical_flags)) {
    return d.super_fold_with(p, this);
  } else {
    return p;
  }
};

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:491 fold_clauses
Canonicalizer.prototype.fold_clauses = function (this: Canonicalizer, c: Clauses): Clauses {
  if (TypeFlags.intersects(c.flags(), this.needs_canonical_flags)) {
    return fold_Clauses.super_fold_with(c, this);
  } else {
    return c;
  }
};

// (provided) `TypeFolder::fold_binder` is not overridden upstream.
Canonicalizer.prototype.fold_binder = function <T>(this: Canonicalizer, t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
  return TypeFolder_provided.fold_binder(this, t, d);
};

// ---- impl Canonicalizer ----

/// The main `canonicalize` method, shared impl of
/// `canonicalize_query` and `canonicalize_response`.
// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:499 canonicalize
Canonicalizer.canonicalize = function <V>(
  value: V,
  infcx: InferCtxt | undefined,
  tcx: TyCtxt,
  canonicalize_region_mode: CanonicalizeMode,
  query_state: OriginalQueryValues,
  d_V: TypeFoldable<V>,
): Canonical<V> {
  const base: Canonical<null> = {
    max_universe: UniverseIndex.ROOT,
    var_kinds: tcx.mk_canonical_var_kinds([]),
    value: null,
  };
  return CanonicalC.unchecked_map(
    Canonicalizer.canonicalize_with_base(base, value, infcx, tcx, canonicalize_region_mode, query_state, d_V),
    ([, val]) => val,
  );
};

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:525 canonicalize_with_base
Canonicalizer.canonicalize_with_base = function <U, V>(
  base: Canonical<U>,
  value: V,
  infcx: InferCtxt | undefined,
  tcx: TyCtxt,
  canonicalize_region_mode: CanonicalizeMode,
  query_state: OriginalQueryValues,
  d_V: TypeFoldable<V>,
): Canonical<[U, V]> {
  const needs_canonical_flags = canonicalize_region_mode.any()
    ? TypeFlags.union(TypeFlags.union(TypeFlags.HAS_INFER, TypeFlags.HAS_PLACEHOLDER), TypeFlags.HAS_FREE_REGIONS)
    : TypeFlags.union(TypeFlags.HAS_INFER, TypeFlags.HAS_PLACEHOLDER);

  // Fast path: nothing that needs to be canonicalized.
  if (!TypeVisitableExt.has_type_flags(value, needs_canonical_flags, d_V)) {
    return CanonicalC.unchecked_map(base, (b): [U, V] => [b, value]);
  }

  const canonicalizer = new Canonicalizer(
    infcx,
    tcx,
    [...base.var_kinds],
    query_state,
    new Map(),
    SsoHashMap.default<TyVid, number>(u32_key, LAYOUT_USIZE),
    canonicalize_region_mode,
    needs_canonical_flags,
  );
  if (spilled(canonicalizer.query_state.var_values)) {
    canonicalizer.indices = new Map(canonicalizer.query_state.var_values.map((kind, i): [GenericArg, BoundVar] => [kind, BoundVar.new(i)]));
  }
  const out_value = d_V.fold_with(value, canonicalizer);

  // Once we have canonicalized `out_value`, it should not
  // contain anything that ties it to this inference context
  // anymore.
  // debug_assert!(!out_value.has_infer() && !out_value.has_placeholders());

  const canonical_var_kinds = tcx.mk_canonical_var_kinds(canonicalizer.universe_canonicalized_var_kinds());

  // PORT: `.iter().map(|cvar| cvar.universe()).max().unwrap_or(ROOT)` (`UniverseIndex` orders by its index).
  let max: UniverseIndex | undefined = undefined;
  for (const cvar of canonical_var_kinds) {
    const u = CanonicalVarKind.universe(cvar);
    if (max === undefined || u >= max) {
      max = u;
    }
  }
  const max_universe = max ?? UniverseIndex.ROOT;

  return { max_universe, var_kinds: canonical_var_kinds, value: [base.value, out_value] };
};

/// Creates a canonical variable replacing `kind` from the input,
/// or returns an existing variable if `kind` has already been
/// seen. `kind` is expected to be an unbound variable (or
/// potentially a free region).
// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:589 canonical_var
Canonicalizer.prototype.canonical_var = function (this: Canonicalizer, var_kind: CanonicalVarKind, value: GenericArg): BoundVar {
  const { var_kinds, query_state } = this;

  const var_values = query_state.var_values;

  const universe = CanonicalVarKind.universe(var_kind);
  if (universe !== UniverseIndex.ROOT) {
    assert(mode(this).preserve_universes(), "assertion failed: self.canonicalize_mode.preserve_universes()");

    // Insert universe into the universe map. To preserve the order of the
    // universes in the value being canonicalized, we don't update the
    // universe in `var_kind` until we have finished canonicalizing.
    // PORT: `binary_search(&universe)`: `Err(idx)` is the insertion point of the sorted map.
    const universe_map = query_state.universe_map;
    let idx = 0;
    while (idx < universe_map.length && universe_map[idx]! < universe) {
      idx++;
    }
    if (idx === universe_map.length || universe_map[idx] !== universe) {
      universe_map.splice(idx, 0, universe);
    }
  }

  // This code is hot. `var_kinds` and `var_values` are usually small
  // (fewer than 8 elements ~95% of the time). They are SmallVec's to
  // avoid allocations in those cases. We also don't use `indices` to
  // determine if a kind has been seen before until the limit of 8 has
  // been exceeded, to also avoid allocations for `indices`.
  if (!spilled(var_values)) {
    // `var_values` is stack-allocated. `indices` isn't used yet. Do a
    // direct linear search of `var_values`.
    const idx = var_values.indexOf(value);
    if (idx !== -1) {
      // `kind` is already present in `var_values`.
      return BoundVar.new(idx);
    } else {
      // `kind` isn't present in `var_values`. Append it. Likewise
      // for `var_kind` and `var_kinds`.
      var_kinds.push(var_kind);
      var_values.push(value);
      assert_eq(var_kinds.length, var_values.length, String);

      // If `var_values` has become big enough to be heap-allocated,
      // fill up `indices` to facilitate subsequent lookups.
      if (spilled(var_values)) {
        assert(this.indices.size === 0, "assertion failed: indices.is_empty()");
        this.indices = new Map(var_values.map((value, i): [GenericArg, BoundVar] => [value, BoundVar.new(i)]));
      }
      // The cv is the index of the appended element.
      return BoundVar.new(var_values.length - 1);
    }
  } else {
    // `var_values` is large. Do a hashmap search via `indices`.
    let bv = this.indices.get(value);
    if (bv === undefined) {
      var_kinds.push(var_kind);
      var_values.push(value);
      assert_eq(var_kinds.length, var_values.length, String);
      bv = BoundVar.new(var_kinds.length - 1);
      this.indices.set(value, bv);
    }
    return bv;
  }
};

// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:653 get_or_insert_sub_root
Canonicalizer.prototype.get_or_insert_sub_root = function (this: Canonicalizer, vid: TyVid): BoundVar {
  const root_vid = unwrap(this.infcx).sub_unification_table_root_var(vid);
  const idx = this.sub_root_lookup_table.entry(root_vid).or_insert_with(() => this.var_kinds.length).value;
  return BoundVar.from_usize(idx);
};

/// Replaces the universe indexes used in `var_values` with their index in
/// `query_state.universe_map`. This minimizes the maximum universe used in
/// the canonicalized value.
// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:663 universe_canonicalized_var_kinds
Canonicalizer.prototype.universe_canonicalized_var_kinds = function (this: Canonicalizer): CanonicalVarKind[] {
  if (this.query_state.universe_map.length === 1) {
    return this.var_kinds;
  }

  const reverse_universe_map = new Map<UniverseIndex, UniverseIndex>(
    this.query_state.universe_map.map((universe, idx): [UniverseIndex, UniverseIndex] => [universe, UniverseIndex.from_usize(idx)]),
  );
  // PORT: `HashMap`'s `Index` panics with std's "no entry found for key".
  const index = (u: UniverseIndex): UniverseIndex => unwrap(reverse_universe_map.get(u), "no entry found for key");

  return this.var_kinds.map((kind): CanonicalVarKind => {
    switch (kind.$) {
      case "Int":
      case "Float":
        return kind;
      case "Ty":
        return { $: "Ty", ui: index(kind.ui), sub_root: kind.sub_root };
      case "Region":
        return { $: "Region", _0: index(kind._0) };
      case "Const":
        return { $: "Const", _0: index(kind._0) };
      case "PlaceholderTy": {
        const placeholder = kind._0;
        return { $: "PlaceholderTy", _0: PlaceholderType.new(index(placeholder.universe), placeholder.bound) };
      }
      case "PlaceholderRegion": {
        const placeholder = kind._0;
        return { $: "PlaceholderRegion", _0: PlaceholderRegion.new(index(placeholder.universe), placeholder.bound) };
      }
      case "PlaceholderConst": {
        const placeholder = kind._0;
        return { $: "PlaceholderConst", _0: PlaceholderConst.new(index(placeholder.universe), placeholder.bound) };
      }
    }
  });
};

/// Shorthand helper that creates a canonical region variable for
/// `r` (always in the root universe). The reason that we always
/// put these variables into the root universe is because this
/// method is used during **query construction:** in that case, we
/// are taking all the regions and just putting them into the most
/// generic context we can. This may generate solutions that don't
/// fit (e.g., that equate some region variable with a placeholder
/// it can't name) on the caller side, but that's ok, the caller
/// can figure that out. In the meantime, it maximizes our
/// caching.
///
/// (This works because unification never fails -- and hence trait
/// selection is never affected -- due to a universe mismatch.)
// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:722 canonical_var_for_region_in_root_universe
Canonicalizer.prototype.canonical_var_for_region_in_root_universe = function (this: Canonicalizer, r: Region): Region {
  return this.canonical_var_for_region({ $: "Region", _0: UniverseIndex.ROOT }, r);
};

/// Creates a canonical variable (with the given `info`)
/// representing the region `r`; return a region referencing it.
// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:731 canonical_var_for_region
Canonicalizer.prototype.canonical_var_for_region = function (this: Canonicalizer, var_kind: CanonicalVarKind, r: Region): Region {
  const var_ = this.canonical_var(var_kind, r);
  return Region.new_canonical_bound(this.cx(), var_);
};

/// Given a type variable `ty_var` of the given kind, first check
/// if `ty_var` is bound to anything; if so, canonicalize
/// *that*. Otherwise, create a new canonical variable for
/// `ty_var`.
// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:744 canonicalize_ty_var
Canonicalizer.prototype.canonicalize_ty_var = function (this: Canonicalizer, var_kind: CanonicalVarKind, ty_var: Ty): Ty {
  // debug_assert!(!self.infcx.is_some_and(|infcx| ty_var != infcx.shallow_resolve(ty_var)));
  const var_ = this.canonical_var(var_kind, ty_var);
  return Ty.new_canonical_bound(this.tcx, var_);
};

/// Given a type variable `const_var` of the given kind, first check
/// if `const_var` is bound to anything; if so, canonicalize
/// *that*. Otherwise, create a new canonical variable for
/// `const_var`.
// rustc: compiler/rustc_infer/src/infer/canonical/canonicalizer.rs:758 canonicalize_const_var
Canonicalizer.prototype.canonicalize_const_var = function (this: Canonicalizer, var_kind: CanonicalVarKind, ct_var: Const): Const {
  // debug_assert!(
  //     !self.infcx.is_some_and(|infcx| ct_var != infcx.shallow_resolve_const(ct_var))
  // );
  const var_ = this.canonical_var(var_kind, ct_var);
  return Const.new_canonical_bound(this.tcx, var_);
};

/** PORT: D4 descriptor of `ParamEnv` (`#[derive(TypeVisitable, TypeFoldable)]`, rustc_middle ty/mod.rs: stubs there). */
const fold_ParamEnv_: TypeFoldable<ParamEnv> = {
  visit_with: visit_with_ParamEnv,
  try_fold_with: try_fold_with_ParamEnv,
  fold_with: fold_with_ParamEnv,
};
