// Port of compiler/rustc_infer/src/infer/outlives/env.rs (lane infer-regions).
//
// `OutlivesEnvironment` is a hand class (field renames, below); `RegionBoundPairs` is generated into env.gen.ts.
//
// Init order: top-level code here may touch only ../../decls.ts, this file's .gen.ts and other crates; every other
// rustc_infer export is read inside function bodies only.

import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../../rust_ts/keyed.ts";
import type { OutlivesBound } from "../../../rustc_middle/traits/query.gen.ts";
import { TransitiveRelationBuilder } from "../../../rustc_data_structures/transitive_relation.ts";
import type { ParamEnv } from "../../../rustc_middle/ty/decls.ts";
import { bug } from "../../../rustc_span/macros.ts";
import type { ArgOutlivesClause, PolyTypeOutlivesClause } from "../../../rustc_type_ir/decls.ts";
import type { OutlivesClause } from "../../../rustc_type_ir/predicate.ts";
import { debug_Region, type Region } from "../../../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { clone_FreeRegionMap, FreeRegionMap } from "../free_regions.ts";
import type { GenericKind } from "../region_constraints/mod.ts";
import type { RegionBoundPairs } from "./env.gen.ts";
import { explicit_outlives_bounds } from "./mod.ts";

export * from "./env.gen.ts";

/// The `OutlivesEnvironment` collects information about what outlives
/// what in a given type-checking setting. For example, if we have a
/// where-clause like `where T: 'a` in scope, then the
/// `OutlivesEnvironment` would record that (in its
/// `region_bound_pairs` field). Similarly, it contains methods for
/// processing and adding implied bounds into the outlives
/// environment.
///
/// Other code at present does not typically take a
/// `&OutlivesEnvironment`, but rather takes some of its fields (e.g.,
/// `process_registered_region_obligations` wants the
/// region-bound-pairs). There is no mistaking it: the current setup
/// of tracking region information is quite scattered! The
/// `OutlivesEnvironment`, for example, needs to sometimes be combined
/// with the `middle::RegionRelations`, to yield a full picture of how
/// (lexical) lifetimes interact. However, I'm reluctant to do more
/// refactoring here, since the setup with NLL is quite different.
/// For example, NLL has no need of `RegionRelations`, and is solely
/// interested in the `OutlivesEnvironment`. -nmatsakis
// rustc-type: compiler/rustc_infer/src/infer/outlives/env.rs:21 OutlivesEnvironment
// PORT: hand class (codegen `hand`): the four private fields have the names of their accessor methods, so they are
// `free_region_map_`, `region_bound_pairs_`, `known_type_outlives_`, `higher_ranked_assumptions_`. `#[derive(Clone)]`
// (`clone_OutlivesEnvironment`) is below.
// PORT: `RegionBoundPairs` (`FxIndexSet<OutlivesClause<GenericKind>>`) holds non-interned structs: it is a `KeyedSet` on
// `intern_key` (insertion-ordered, as `FxIndexSet`). `higher_ranked_assumptions` (`FxHashSet<ArgOutlivesClause>`) is the
// caller's set, kept as given (callers pass a `KeyedSet` on `intern_key`).
export class OutlivesEnvironment {
  constructor(
    public param_env: ParamEnv,
    public free_region_map_: FreeRegionMap,
    /// FIXME: Your first reaction may be that this is a bit strange. `RegionBoundPairs`
    /// does not contain lifetimes, which are instead in the `FreeRegionMap`, and other
    /// known type outlives are stored in the `known_type_outlives` set. So why do we
    /// have these at all? It turns out that removing these and using `known_type_outlives`
    /// everywhere is just enough of a perf regression to matter. This can/should be
    /// optimized in the future, though.
    public region_bound_pairs_: RegionBoundPairs,
    public known_type_outlives_: PolyTypeOutlivesClause[],
    /// Assumptions that come from the well-formedness of coroutines that we prove
    /// auto trait bounds for during the type checking of this body.
    public higher_ranked_assumptions_: Set<ArgOutlivesClause>,
  ) {}
}

/** `#[derive(Clone)]` of `OutlivesEnvironment` (a hand type: codegen does not derive its Clone). */
export function clone_OutlivesEnvironment(v: OutlivesEnvironment): OutlivesEnvironment {
  const hra = v.higher_ranked_assumptions_;
  return new OutlivesEnvironment(
    v.param_env,
    clone_FreeRegionMap(v.free_region_map_),
    new_RegionBoundPairs(v.region_bound_pairs_),
    v.known_type_outlives_.slice(),
    hra instanceof KeyedSet ? new KeyedSet<ArgOutlivesClause>(hra.key, hra) : new Set(hra),
  );
}

/** PORT: `RegionBoundPairs::default()` (an `FxIndexSet` of plain structs): a `KeyedSet` on the derived `Hash` + `Eq`. */
export function new_RegionBoundPairs(values?: Iterable<OutlivesClause<GenericKind>>): RegionBoundPairs {
  return new KeyedSet<OutlivesClause<GenericKind>>(intern_key, values);
}

// ---- impl OutlivesEnvironment ------------------------------------------------------------------------------------------

/** `ReStatic | ReEarlyParam(_) | ReLateParam(_)` */
function is_free_kind(r: Region): boolean {
  const k = r.kind().$;
  return k === "ReStatic" || k === "ReEarlyParam" || k === "ReLateParam";
}

/// Create a new `OutlivesEnvironment` from normalized outlives bounds.
// rustc: compiler/rustc_infer/src/infer/outlives/env.rs:55 from_normalized_bounds
OutlivesEnvironment.from_normalized_bounds = function (
  param_env: ParamEnv,
  known_type_outlives: PolyTypeOutlivesClause[],
  extra_bounds: Iterable<OutlivesBound>,
  higher_ranked_assumptions: Set<ArgOutlivesClause>,
): OutlivesEnvironment {
  const region_relation = TransitiveRelationBuilder.default<Region>();
  const region_bound_pairs = new_RegionBoundPairs();

  // Record relationships such as `T:'x` that don't go into the
  // free-region-map but which we use here.
  // PORT: `explicit_outlives_bounds(param_env).chain(extra_bounds)`.
  const chain = function* (): Iterable<OutlivesBound> {
    yield* explicit_outlives_bounds(param_env);
    yield* extra_bounds;
  };
  for (const outlives_bound of chain()) {
    // debug!("add_outlives_bounds: outlives_bound={:?}", outlives_bound);
    switch (outlives_bound.$) {
      case "RegionSubParam": {
        const [r_a, param_b] = [outlives_bound._0, outlives_bound._1];
        region_bound_pairs.add({ _0: { $: "Param", _0: param_b }, _1: r_a });
        break;
      }
      case "RegionSubAlias": {
        const [r_a, alias_b] = [outlives_bound._0, outlives_bound._1];
        region_bound_pairs.add({ _0: { $: "Alias", _0: alias_b }, _1: r_a });
        break;
      }
      case "RegionSubRegion": {
        const [r_a, r_b] = [outlives_bound._0, outlives_bound._1];
        if (is_free_kind(r_a) && is_free_kind(r_b)) {
          region_relation.add(r_a, r_b);
        } else if (r_a.kind().$ === "ReError" || r_b.kind().$ === "ReError") {
          // nothing
        } else if (r_a.kind().$ === "ReVar" || r_b.kind().$ === "ReVar") {
          // FIXME(#109628): We shouldn't have existential variables in implied bounds.
          // Panic here once the linked issue is resolved!
        } else {
          bug(`add_outlives_bounds: unexpected regions: (${debug_Region(r_a, PLAIN)}, ${debug_Region(r_b, PLAIN)})`);
        }
        break;
      }
    }
  }

  return new OutlivesEnvironment(
    param_env,
    new FreeRegionMap(region_relation.freeze()),
    region_bound_pairs,
    known_type_outlives,
    higher_ranked_assumptions,
  );
};

// rustc: compiler/rustc_infer/src/infer/outlives/env.rs:98 free_region_map
OutlivesEnvironment.prototype.free_region_map = function (this: OutlivesEnvironment): FreeRegionMap {
  return this.free_region_map_;
};

// rustc: compiler/rustc_infer/src/infer/outlives/env.rs:102 region_bound_pairs
OutlivesEnvironment.prototype.region_bound_pairs = function (this: OutlivesEnvironment): RegionBoundPairs {
  return this.region_bound_pairs_;
};

// rustc: compiler/rustc_infer/src/infer/outlives/env.rs:106 known_type_outlives
OutlivesEnvironment.prototype.known_type_outlives = function (this: OutlivesEnvironment): readonly PolyTypeOutlivesClause[] {
  return this.known_type_outlives_;
};

// rustc: compiler/rustc_infer/src/infer/outlives/env.rs:110 higher_ranked_assumptions
OutlivesEnvironment.prototype.higher_ranked_assumptions = function (this: OutlivesEnvironment): Set<ArgOutlivesClause> {
  return this.higher_ranked_assumptions_;
};
