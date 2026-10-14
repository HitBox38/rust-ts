// Port of compiler/rustc_infer/src/infer/outlives/env.rs (lane infer-regions).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";

export * from "./env.gen.ts";

import type { ParamEnv } from "../../../rustc_middle/ty/decls.ts";
import type { ArgOutlivesClause, PolyTypeOutlivesClause } from "../../../rustc_type_ir/decls.ts";
import type { FreeRegionMap } from "../free_regions.gen.ts";
import type { RegionBoundPairs } from "./env.gen.ts";

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
// (`clone_OutlivesEnvironment`) is written with the port of this file.
// PORT: `RegionBoundPairs` (`FxIndexSet<OutlivesClause<GenericKind>>`) and `higher_ranked_assumptions` (`FxHashSet`) hold
// non-interned structs: the port must use `KeyedSet`s (rust_ts/keyed.ts) for them.
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

unported_methods(OutlivesEnvironment.prototype, "rustc_infer::infer::outlives::env::OutlivesEnvironment", ["free_region_map", "region_bound_pairs", "known_type_outlives", "higher_ranked_assumptions"]);
unported_methods(OutlivesEnvironment, "rustc_infer::infer::outlives::env::OutlivesEnvironment", ["from_normalized_bounds"]);
