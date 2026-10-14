// Port of compiler/rustc_middle/src/infer/canonical.rs (lane infcx-contract: ported in full). The types with their
// derived Debug / Clone / TypeFoldable are generated into canonical.gen.ts (set rustc_infer of tools/codegen/types.ts),
// except `CanonicalParamEnvCache` (below: a `KeyedMap`) and the four `ir::` aliases (the same TS types as
// rustc_type_ir's, D3).
//
//! **Canonicalization** is the key to constructing a query in the
//! middle of type inference. Ordinarily, it is not possible to store
//! types from type inference in query keys, because they contain
//! references to inference variables whose lifetimes are too short
//! and so forth. Canonicalizing a value T1 using `canonicalize_query`
//! produces two things:
//!
//! - a value T2 where each unbound inference variable has been
//!   replaced with a **canonical variable**;
//! - a map M (of type `CanonicalVarValues`) from those canonical
//!   variables back to the original.
//!
//! We can then do queries using T2. These will give back constraints
//! on the canonical variables which can be translated, using the map
//! M, into constraints in our source context. This process of
//! translating the results back is done by the
//! `instantiate_query_result` method.
//!
//! For a more detailed look at what is happening here, check
//! out the [chapter in the rustc dev guide][c].
//!
//! [c]: https://rust-lang.github.io/chalk/book/canonical_queries/canonicalization.html
//
// PORT: inherent methods of the generated types are companion functions taking `self` first (PORTING §8).
// PORT: `Lock<FxHashMap<ty::ParamEnv, (Canonical, &[GenericArg])>>` is a `KeyedMap` on `intern_key` (`ParamEnv` is a
// struct around an interned list, as rustc_type_ir canonical.ts's `CanonicalParamEnvCache`); the arena slice is an
// array copy.
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { GenericArg } from "../ty/generic_args.ts";
import { RawList } from "../ty/list.ts";
import { type ParamEnv, visit_with_ParamEnv } from "../ty/mod.ts";
import type * as ir from "../../rustc_type_ir/canonical.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.gen.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { TypeVisitableExt, type TypeVisitable } from "../../rustc_type_ir/visit.ts";
import { assert_eq } from "../../std/panic.ts";
import * as gen from "./canonical.gen.ts";
import { QueryRegionConstraints, QueryResponse } from "./canonical.gen.ts";

export * from "./canonical.gen.ts";

// rustc-type: compiler/rustc_middle/src/infer/canonical.rs:35 CanonicalQueryInput
export type CanonicalQueryInput<V> = ir.CanonicalQueryInput<V>;
// rustc-type: compiler/rustc_middle/src/infer/canonical.rs:36 Canonical
export type Canonical<V> = ir.Canonical<V>;
// rustc-type: compiler/rustc_middle/src/infer/canonical.rs:37 CanonicalVarKind
export type CanonicalVarKind = ir.CanonicalVarKind;
// rustc-type: compiler/rustc_middle/src/infer/canonical.rs:38 CanonicalVarValues
export type CanonicalVarValues = ir.CanonicalVarValues;

// ---- OriginalQueryValues ---------------------------------------------------------------------------------------------

export type OriginalQueryValues = gen.OriginalQueryValues;
export const OriginalQueryValues = {
  // rustc: compiler/rustc_middle/src/infer/canonical.rs:59 default
  default_(): OriginalQueryValues {
    const universe_map: UniverseIndex[] = [];
    universe_map.push(UniverseIndex.ROOT);

    return { universe_map, var_values: [] };
  },
};

// ---- QueryRegionConstraints / QueryResponse (generated classes) / Certainty --------------------------------------

declare module "./canonical.gen.ts" {
  interface QueryRegionConstraints {
    is_empty(): boolean;
  }
  interface QueryResponse<R> {
    is_proven(): boolean;
  }
}

/// Represents an empty (trivially true) set of region constraints.
///
/// FIXME(higher_ranked_auto): This could still just be true if there are only assumptions?
/// Because I don't expect for us to get cases where an assumption from one query would
/// discharge a requirement from another query, which is a potential problem if we did throw
/// away these assumptions because there were no constraints.
// rustc: compiler/rustc_middle/src/infer/canonical.rs:93 is_empty
QueryRegionConstraints.prototype.is_empty = function (this: QueryRegionConstraints): boolean {
  const { constraints, assumptions } = this;
  return constraints.length === 0 && assumptions.length === 0;
};

export type Certainty = gen.Certainty;
export const Certainty = {
  ...gen.Certainty,

  // rustc: compiler/rustc_middle/src/infer/canonical.rs:124 is_proven
  is_proven(self: Certainty): boolean {
    switch (self) {
      case "Proven":
        return true;
      case "Ambiguous":
        return false;
    }
  },
};

// rustc: compiler/rustc_middle/src/infer/canonical.rs:133 is_proven
QueryResponse.prototype.is_proven = function <R>(this: QueryResponse<R>): boolean {
  return Certainty.is_proven(this.certainty);
};

// ---- CanonicalParamEnvCache ------------------------------------------------------------------------------------------

/** PORT: `ParamEnv`'s derived `TypeVisitable` (rustc_middle ty/mod.ts `visit_with_ParamEnv`) as a D4 descriptor. */
const visit_ParamEnv: TypeVisitable<ParamEnv> = { visit_with: visit_with_ParamEnv };

// rustc-type: compiler/rustc_middle/src/infer/canonical.rs:146 CanonicalParamEnvCache
export class CanonicalParamEnvCache {
  constructor(public map: KeyedMap<ParamEnv, [Canonical<ParamEnv>, readonly GenericArg[]]>) {}

  /** `#[derive(Default)]` */
  static default_(): CanonicalParamEnvCache {
    return new CanonicalParamEnvCache(new KeyedMap<ParamEnv, [Canonical<ParamEnv>, readonly GenericArg[]]>(intern_key));
  }

  /// Gets the cached canonical form of `key` or executes
  /// `canonicalize_op` and caches the result if not present.
  ///
  /// `canonicalize_op` is intentionally not allowed to be a closure to
  /// statically prevent it from capturing `InferCtxt` and resolving
  /// inference variables, which invalidates the cache.
  // rustc: compiler/rustc_middle/src/infer/canonical.rs:162 get_or_insert
  get_or_insert(
    tcx: TyCtxt,
    key: ParamEnv,
    state: OriginalQueryValues,
    canonicalize_op: (tcx: TyCtxt, key: ParamEnv, state: OriginalQueryValues) => Canonical<ParamEnv>,
  ): Canonical<ParamEnv> {
    if (!TypeVisitableExt.has_type_flags(key, TypeFlags.union(TypeFlags.union(TypeFlags.HAS_INFER, TypeFlags.HAS_PLACEHOLDER), TypeFlags.HAS_FREE_REGIONS), visit_ParamEnv)) {
      return {
        max_universe: UniverseIndex.ROOT,
        var_kinds: RawList.empty(),
        value: key,
      };
    }

    assert_eq(state.var_values.length, 0, String);
    assert_eq(state.universe_map.length, 1, String);
    // debug_assert_eq!(&*state.universe_map, &[ty::UniverseIndex::ROOT]);

    const e = this.map.get(key);
    if (e !== undefined) {
      // Entry::Occupied
      const [canonical, var_values] = e;
      // `if cfg!(debug_assertions) { .. }`: rustc ships without debug assertions.
      state.var_values.push(...var_values);
      return canonical;
    } else {
      // Entry::Vacant
      const canonical = canonicalize_op(tcx, key, state);
      const { var_values, universe_map } = state;
      assert_eq(universe_map.length, 1, String);
      this.map.set(key, [canonical, var_values.slice()]);
      return canonical;
    }
  }
}

