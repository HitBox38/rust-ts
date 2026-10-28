// Port of polonius-engine =0.13.0 `src/output/mod.rs`.
//
// PORT: collections.
// - `FxHashMap<K, V>` (rustc-hash 1.1.0) is a JS `Map`, `FxHashSet` a `Set`: their iteration order is
//   insertion order, not hashbrown's. Nothing observable depends on it: rustc reads `Output` only through
//   `errors_at` (a lookup) and `subset_errors` (collected, then sorted and deduplicated:
//   region_infer/region_context.rs `check_polonius_subset_errors`), and `compare_errors` only logs.
// - `BTreeSet<T>` / `BTreeMap<K, V>` (std, not ported) are the `BTreeSet` / `BTreeMap` classes at the end of
//   this file: sorted arrays under datafrog's tuple order, so iteration is in key order as in std.
// - `.entry(k).or_default()` is `entry_or_default(map, k, default)`; `Cow<'_, BTreeMap<..>>` is the map.
// - `#[derive(Clone, Debug)]` on `Output` is not ported (rustc shares the boxed output and never formats it).
// - `Instant::now()` timers only feed `info!` (a comment, see lib.ts), so they are comments too.

import { cmp, type Ord, Relation, Iteration } from "../../datafrog/lib.ts";
import type { Debug } from "../../../std/fmt.ts";
import { assert, panic } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { AllFacts, FactTypes } from "../facts.ts";
import * as datafrog_opt from "./datafrog_opt.ts";
import * as initialization from "./initialization.ts";
import * as liveness from "./liveness.ts";
import * as location_insensitive from "./location_insensitive.ts";
import * as naive from "./naive.ts";

// mod datafrog_opt;
// mod initialization;
// mod liveness;
// mod location_insensitive;
// mod naive;

// #[derive(Debug, Clone, Copy)]
export type Algorithm =
  /// Simple rules, but slower to execute
  | "Naive"

  /// Optimized variant of the rules
  | "DatafrogOpt"

  /// Fast to compute, but imprecise: there can be false-positives
  /// but no false-negatives. Tailored for quick "early return" situations.
  | "LocationInsensitive"

  /// Compares the `Naive` and `DatafrogOpt` variants to ensure they indeed
  /// compute the same errors.
  | "Compare"

  /// Combination of the fast `LocationInsensitive` pre-pass, followed by
  /// the more expensive `DatafrogOpt` variant.
  | "Hybrid";

export const Algorithm = {
  Naive: "Naive",
  DatafrogOpt: "DatafrogOpt",
  LocationInsensitive: "LocationInsensitive",
  Compare: "Compare",
  Hybrid: "Hybrid",

  /// Optimized variants that ought to be equivalent to "naive"
  OPTIMIZED: ["DatafrogOpt"] as readonly Algorithm[],

  // crate: polonius-engine-0.13.0/src/output/mod.rs:49 variants
  variants(): [string, string, string, string, string] {
    return ["Naive", "DatafrogOpt", "LocationInsensitive", "Compare", "Hybrid"];
  },

  // impl ::std::str::FromStr for Algorithm { type Err = String; }
  // crate: polonius-engine-0.13.0/src/output/mod.rs:62 from_str
  from_str(s: string): Result<Algorithm, string> {
    // PORT: `str::to_lowercase` is `String.prototype.toLowerCase` (both apply Unicode's full lowercase
    // mapping; the only strings that match are ASCII).
    switch (s.toLowerCase()) {
      case "naive":
        return Ok("Naive");
      case "datafrogopt":
        return Ok("DatafrogOpt");
      case "locationinsensitive":
        return Ok("LocationInsensitive");
      case "compare":
        return Ok("Compare");
      case "hybrid":
        return Ok("Hybrid");
      default:
        return Err("valid values: Naive, DatafrogOpt, LocationInsensitive, Compare, Hybrid");
    }
  },
} as const;

/** `#[derive(Debug)]` of `Algorithm` (unit variants print their name). */
export const debug_Algorithm: Debug<Algorithm> = (v) => v;

// #[derive(Clone, Debug)]
export class Output<T extends FactTypes> {
  constructor(
    public errors: Map<T["Point"], T["Loan"][]>,
    public subset_errors: Map<T["Point"], BTreeSet<readonly [T["Origin"], T["Origin"]]>>,
    public move_errors: Map<T["Point"], T["Path"][]>,

    public dump_enabled: boolean,

    // these are just for debugging
    public loan_live_at: Map<T["Point"], T["Loan"][]>,
    public origin_contains_loan_at: Map<T["Point"], BTreeMap<T["Origin"], BTreeSet<T["Loan"]>>>,
    public origin_contains_loan_anywhere: Map<T["Origin"], BTreeSet<T["Loan"]>>,
    public origin_live_on_entry: Map<T["Point"], T["Origin"][]>,
    public loan_invalidated_at: Map<T["Point"], T["Loan"][]>,
    public subset: Map<T["Point"], BTreeMap<T["Origin"], BTreeSet<T["Origin"]>>>,
    public subset_anywhere: Map<T["Origin"], BTreeSet<T["Origin"]>>,
    public var_live_on_entry: Map<T["Point"], T["Variable"][]>,
    public var_drop_live_on_entry: Map<T["Point"], T["Variable"][]>,
    public path_maybe_initialized_on_exit: Map<T["Point"], T["Path"][]>,
    public path_maybe_uninitialized_on_exit: Map<T["Point"], T["Path"][]>,
    public known_contains: Map<T["Origin"], BTreeSet<T["Loan"]>>,
    public var_maybe_partly_initialized_on_exit: Map<T["Point"], T["Variable"][]>,
  ) {}

  /// All variants require the same initial preparations, done in multiple
  /// successive steps:
  /// - compute initialization data
  /// - compute liveness
  /// - prepare static inputs as shared `Relation`s
  /// - in cases where `LocationInsensitive` variant is ran as a filtering pre-pass,
  ///   partial results can also be stored in the context, so that the following
  ///   variant can use it to prune its own input data
  // crate: polonius-engine-0.13.0/src/output/mod.rs:159 compute
  static compute<T extends FactTypes>(all_facts: AllFacts<T>, algorithm: Algorithm, dump_enabled: boolean): Output<T> {
    type Origin = T["Origin"];
    type Loan = T["Loan"];
    type Point = T["Point"];

    const result = Output.new<T>(dump_enabled);

    // TODO: remove all the cloning thereafter, but that needs to be done in concert with rustc

    const cfg_edge: Relation<readonly [Point, Point]> = Relation.from(all_facts.cfg_edge.slice());

    // 1) Initialization
    const initialization_ctx: InitializationContext<T> = {
      child_path: all_facts.child_path.slice(),
      path_is_var: all_facts.path_is_var.slice(),
      path_assigned_at_base: all_facts.path_assigned_at_base.slice(),
      path_moved_at_base: all_facts.path_moved_at_base.slice(),
      path_accessed_at_base: all_facts.path_accessed_at_base.slice(),
    };

    const { _0: var_maybe_partly_initialized_on_exit, _1: move_errors } = initialization.compute<T>(
      initialization_ctx,
      cfg_edge,
      result,
    );

    // FIXME: move errors should prevent the computation from continuing: we can't compute
    // liveness and analyze loans accurately when there are move errors, and should early
    // return here.
    for (const [path, location] of move_errors.iter()) {
      entry_or_default(result.move_errors, location, () => []).push(path);
    }

    // 2) Liveness
    const liveness_ctx: LivenessContext<T> = {
      var_used_at: all_facts.var_used_at.slice(),
      var_defined_at: all_facts.var_defined_at.slice(),
      var_dropped_at: all_facts.var_dropped_at.slice(),
      use_of_var_derefs_origin: all_facts.use_of_var_derefs_origin.slice(),
      drop_of_var_derefs_origin: all_facts.drop_of_var_derefs_origin.slice(),
    };

    const origin_live_on_entry_vec = liveness.compute_live_origins<T>(
      liveness_ctx,
      cfg_edge,
      var_maybe_partly_initialized_on_exit,
      result,
    );

    const cfg_node: BTreeSet<Point> = BTreeSet.from_iter<Point>(
      cfg_edge
        .iter()
        .map(([point1, _]) => point1)
        .concat(cfg_edge.iter().map(([_, point2]) => point2)),
    );

    liveness.make_universal_regions_live<T>(origin_live_on_entry_vec, cfg_node, all_facts.universal_region);

    // 3) Borrow checking

    // Prepare data as datafrog relations, ready to join.
    //
    // Note: if rustc and polonius had more interaction, we could also delay or avoid
    // generating some of the facts that are now always present here. For example,
    // the `LocationInsensitive` variant doesn't use the `loan_killed_at` relation, so we could
    // technically delay computing and passing it from rustc, when using this or the `Hybrid`
    // variants, to after the pre-pass has made sure we actually need to compute the full
    // analysis. If these facts happened to be recorded in separate MIR walks, we might also
    // avoid generating those facts.

    const origin_live_on_entry: Relation<readonly [Origin, Point]> = Relation.from(origin_live_on_entry_vec);

    // TODO: also flip the order of this relation's arguments in rustc
    // from `loan_invalidated_at(point, loan)` to `loan_invalidated_at(loan, point)`.
    // to avoid this allocation.
    const loan_invalidated_at = Relation.from_iter(
      all_facts.loan_invalidated_at.map(([point, loan]): readonly [Loan, Point] => [loan, point]),
    );

    const loan_killed_at: Relation<readonly [Loan, Point]> = Relation.from(all_facts.loan_killed_at.slice());

    // `known_placeholder_subset` is a list of all the `'a: 'b` subset relations the user gave:
    // it's not required to be transitive. `known_contains` is its transitive closure: a list
    // of all the known placeholder loans that each of these placeholder origins contains.
    // Given the `known_placeholder_subset`s `'a: 'b` and `'b: 'c`: in the `known_contains`
    // relation, `'a` will also contain `'c`'s placeholder loan.
    const known_placeholder_subset_base: Relation<readonly [Origin, Origin]> = Relation.from(
      all_facts.known_placeholder_subset.slice(),
    );
    const known_contains = Output.compute_known_contains<T>(known_placeholder_subset_base, all_facts.placeholder);

    // Fully close over the `known_placeholder_subset` relation.
    const known_placeholder_subset = Output.compute_known_placeholder_subset<T>(known_placeholder_subset_base);

    const placeholder_origin: Relation<readonly [Origin, undefined]> = Relation.from_iter(
      all_facts.universal_region.map((origin): readonly [Origin, undefined] => [origin, undefined]),
    );

    const placeholder_loan = Relation.from_iter(
      all_facts.placeholder.map(([origin, loan]): readonly [Loan, Origin] => [loan, origin]),
    );

    // Ask the variants to compute errors in their own way
    const ctx: Context<T> = {
      origin_live_on_entry,
      loan_invalidated_at,
      cfg_edge,
      subset_base: all_facts.subset_base,
      loan_issued_at: all_facts.loan_issued_at,
      loan_killed_at,
      known_contains,
      known_placeholder_subset,
      placeholder_origin,
      placeholder_loan,
      potential_errors: undefined,
      potential_subset_errors: undefined,
    };

    let errors: Relation<readonly [Loan, Point]>;
    let subset_errors: Relation<readonly [Origin, Origin, Point]>;
    switch (algorithm) {
      case "LocationInsensitive": {
        const [potential_errors, potential_subset_errors_] = location_insensitive.compute<T>(ctx, result);

        // Note: the error location is meaningless for a location-insensitive
        // subset error analysis. This is acceptable here as this variant is not one
        // which should be used directly besides debugging, the `Hybrid` variant will
        // take advantage of its result.
        // PORT: `0.into()` is the `Point` atom 0 (`From<usize>` of a newtype index).
        const potential_subset_errors: Relation<readonly [Origin, Origin, Point]> = Relation.from_iter(
          potential_subset_errors_
            .iter()
            .map(([origin1, origin2]): readonly [Origin, Origin, Point] => [origin1, origin2, 0 as Point]),
        );

        [errors, subset_errors] = [potential_errors, potential_subset_errors];
        break;
      }
      case "Naive":
        [errors, subset_errors] = naive.compute<T>(ctx, result);
        break;
      case "DatafrogOpt":
        [errors, subset_errors] = datafrog_opt.compute<T>(ctx, result);
        break;
      case "Hybrid": {
        // Execute the fast `LocationInsensitive` computation as a pre-pass:
        // if it finds no possible errors, we don't need to do the more complex
        // computations as they won't find errors either, and we can return early.
        const [potential_errors, potential_subset_errors] = location_insensitive.compute<T>(ctx, result);

        if (potential_errors.is_empty() && potential_subset_errors.is_empty()) {
          // There are no loan errors, nor subset errors, we can early return
          // empty errors lists and avoid doing the heavy analysis.
          [errors, subset_errors] = [potential_errors, Relation.from<readonly [Origin, Origin, Point]>([])];
        } else {
          // Record these potential errors as they can be used to limit the next
          // variant's work to only these loans.
          ctx.potential_errors = new Set(potential_errors.iter().map(([loan, _]) => loan));
          ctx.potential_subset_errors = potential_subset_errors;

          [errors, subset_errors] = datafrog_opt.compute<T>(ctx, result);
        }
        break;
      }
      case "Compare": {
        // Ensure the `Naive` and `DatafrogOpt` errors are the same
        const [naive_errors, naive_subset_errors] = naive.compute<T>(ctx, result);
        const [opt_errors, _] = datafrog_opt.compute<T>(ctx, result);

        // TODO: compare illegal subset relations errors as well here ?

        const naive_errors_by_point = new Map<Point, Loan[]>();
        for (const [loan, point] of naive_errors.iter()) {
          entry_or_default(naive_errors_by_point, point, () => []).push(loan);
        }

        const opt_errors_by_point = new Map<Point, Loan[]>();
        for (const [loan, point] of opt_errors.iter()) {
          entry_or_default(opt_errors_by_point, point, () => []).push(loan);
        }

        if (compare_errors(naive_errors_by_point, opt_errors_by_point)) {
          panic(
            "The errors reported by the naive algorithm differ from " +
              "the errors reported by the optimized algorithm. " +
              "See the error log for details.",
          );
        } else {
          // debug!("Naive and optimized algorithms reported the same errors.");
        }

        [errors, subset_errors] = [naive_errors, naive_subset_errors];
        break;
      }
    }

    // Record illegal access errors
    for (const [loan, location] of errors.iter()) {
      entry_or_default(result.errors, location, () => []).push(loan);
    }

    // Record illegal subset relations errors
    for (const [origin1, origin2, location] of subset_errors.iter()) {
      entry_or_default(result.subset_errors, location, () => BTreeSet.default<readonly [Origin, Origin]>()).insert([
        origin1,
        origin2,
      ]);
    }

    // Record more debugging info when asked to do so
    if (dump_enabled) {
      for (const [origin, location] of ctx.origin_live_on_entry.iter()) {
        entry_or_default(result.origin_live_on_entry, location, () => []).push(origin);
      }

      for (const [origin, loan] of ctx.known_contains.iter()) {
        entry_or_default(result.known_contains, origin, () => BTreeSet.default<Loan>()).insert(loan);
      }
    }

    return result;
  }

  /// Computes the transitive closure of the `known_placeholder_subset` relation, so that we have
  /// the full list of placeholder loans contained by the placeholder origins.
  // crate: polonius-engine-0.13.0/src/output/mod.rs:400 compute_known_contains
  static compute_known_contains<T extends FactTypes>(
    known_placeholder_subset: Relation<readonly [T["Origin"], T["Origin"]]>,
    placeholder: readonly (readonly [T["Origin"], T["Loan"]])[],
  ): Relation<readonly [T["Origin"], T["Loan"]]> {
    const iteration = Iteration.new();
    const known_contains = iteration.variable<readonly [T["Origin"], T["Loan"]]>("known_contains");

    // known_contains(Origin1, Loan1) :-
    //   placeholder(Origin1, Loan1).
    known_contains.extend(placeholder);

    while (iteration.changed()) {
      // known_contains(Origin2, Loan1) :-
      //   known_contains(Origin1, Loan1),
      //   known_placeholder_subset(Origin1, Origin2).
      known_contains.from_join(known_contains, known_placeholder_subset, (_origin1, loan1, origin2) => [origin2, loan1]);
    }

    return known_contains.complete();
  }

  /// Computes the transitive closure of the `known_placeholder_subset` relation.
  // crate: polonius-engine-0.13.0/src/output/mod.rs:426 compute_known_placeholder_subset
  static compute_known_placeholder_subset<T extends FactTypes>(
    known_placeholder_subset_base: Relation<readonly [T["Origin"], T["Origin"]]>,
  ): Relation<readonly [T["Origin"], T["Origin"]]> {
    // use datafrog::{Iteration, RelationLeaper};
    const iteration = Iteration.new();

    const known_placeholder_subset = iteration.variable<readonly [T["Origin"], T["Origin"]]>("known_placeholder_subset");

    // known_placeholder_subset(Origin1, Origin2) :-
    //   known_placeholder_subset_base(Origin1, Origin2).
    known_placeholder_subset.extend(known_placeholder_subset_base.iter());

    while (iteration.changed()) {
      // known_placeholder_subset(Origin1, Origin3) :-
      //   known_placeholder_subset(Origin1, Origin2),
      //   known_placeholder_subset_base(Origin2, Origin3).
      known_placeholder_subset.from_leapjoin(
        known_placeholder_subset,
        known_placeholder_subset_base.extend_with(([_origin1, origin2]: readonly [T["Origin"], T["Origin"]]) => origin2),
        ([origin1, _origin2], origin3) => [origin1, origin3],
      );
    }

    return known_placeholder_subset.complete();
  }

  // crate: polonius-engine-0.13.0/src/output/mod.rs:452 new
  static new<T extends FactTypes>(dump_enabled: boolean): Output<T> {
    // PORT: the struct literal's fields in declaration order (upstream lists them in another order; all are
    // fresh empty maps).
    return new Output<T>(
      new Map(), // errors
      new Map(), // subset_errors
      new Map(), // move_errors
      dump_enabled,
      new Map(), // loan_live_at
      new Map(), // origin_contains_loan_at
      new Map(), // origin_contains_loan_anywhere
      new Map(), // origin_live_on_entry
      new Map(), // loan_invalidated_at
      new Map(), // subset
      new Map(), // subset_anywhere
      new Map(), // var_live_on_entry
      new Map(), // var_drop_live_on_entry
      new Map(), // path_maybe_initialized_on_exit
      new Map(), // path_maybe_uninitialized_on_exit
      new Map(), // known_contains
      new Map(), // var_maybe_partly_initialized_on_exit
    );
  }

  // crate: polonius-engine-0.13.0/src/output/mod.rs:474 errors_at
  errors_at(location: T["Point"]): readonly T["Loan"][] {
    const v = this.errors.get(location);
    if (v !== undefined) {
      return v;
    } else {
      return [];
    }
  }

  // crate: polonius-engine-0.13.0/src/output/mod.rs:481 loans_in_scope_at
  loans_in_scope_at(location: T["Point"]): readonly T["Loan"][] {
    const p = this.loan_live_at.get(location);
    if (p !== undefined) {
      return p;
    } else {
      return [];
    }
  }

  // crate: polonius-engine-0.13.0/src/output/mod.rs:488 origin_contains_loan_at
  origin_contains_loan_at_(location: T["Point"]): BTreeMap<T["Origin"], BTreeSet<T["Loan"]>> {
    // PORT: named with a trailing `_`: the struct has a field of the same name.
    assert(this.dump_enabled, "assertion failed: self.dump_enabled");
    const map = this.origin_contains_loan_at.get(location);
    if (map !== undefined) {
      return map;
    } else {
      return BTreeMap.default();
    }
  }

  // crate: polonius-engine-0.13.0/src/output/mod.rs:499 origins_live_at
  origins_live_at(location: T["Point"]): readonly T["Origin"][] {
    assert(this.dump_enabled, "assertion failed: self.dump_enabled");
    const v = this.origin_live_on_entry.get(location);
    if (v !== undefined) {
      return v;
    } else {
      return [];
    }
  }

  // crate: polonius-engine-0.13.0/src/output/mod.rs:507 subsets_at
  subsets_at(location: T["Point"]): BTreeMap<T["Origin"], BTreeSet<T["Origin"]>> {
    assert(this.dump_enabled, "assertion failed: self.dump_enabled");
    const v = this.subset.get(location);
    if (v !== undefined) {
      return v;
    } else {
      return BTreeMap.default();
    }
  }
}

/// Subset of `AllFacts` dedicated to initialization
export interface InitializationContext<T extends FactTypes> {
  child_path: (readonly [T["Path"], T["Path"]])[];
  path_is_var: (readonly [T["Path"], T["Variable"]])[];
  path_assigned_at_base: (readonly [T["Path"], T["Point"]])[];
  path_moved_at_base: (readonly [T["Path"], T["Point"]])[];
  path_accessed_at_base: (readonly [T["Path"], T["Point"]])[];
}

/// Subset of `AllFacts` dedicated to liveness
export interface LivenessContext<T extends FactTypes> {
  var_used_at: (readonly [T["Variable"], T["Point"]])[];
  var_defined_at: (readonly [T["Variable"], T["Point"]])[];
  var_dropped_at: (readonly [T["Variable"], T["Point"]])[];
  use_of_var_derefs_origin: (readonly [T["Variable"], T["Origin"]])[];
  drop_of_var_derefs_origin: (readonly [T["Variable"], T["Origin"]])[];
}

/// Subset of `AllFacts` dedicated to borrow checking, and data ready to use by the variants
export interface Context<T extends FactTypes> {
  // `Relation`s used as static inputs, by all variants
  origin_live_on_entry: Relation<readonly [T["Origin"], T["Point"]]>;
  loan_invalidated_at: Relation<readonly [T["Loan"], T["Point"]]>;

  // static inputs used via `Variable`s, by all variants
  subset_base: readonly (readonly [T["Origin"], T["Origin"], T["Point"]])[];
  loan_issued_at: readonly (readonly [T["Origin"], T["Loan"], T["Point"]])[];

  // static inputs used by variants other than `LocationInsensitive`
  loan_killed_at: Relation<readonly [T["Loan"], T["Point"]]>;
  known_contains: Relation<readonly [T["Origin"], T["Loan"]]>;
  placeholder_origin: Relation<readonly [T["Origin"], undefined]>;
  placeholder_loan: Relation<readonly [T["Loan"], T["Origin"]]>;

  // The `known_placeholder_subset` relation in the facts does not necessarily contain all the
  // transitive subsets. The transitive closure is always needed, so this version here is fully
  // closed over.
  known_placeholder_subset: Relation<readonly [T["Origin"], T["Origin"]]>;

  // while this static input is unused by `LocationInsensitive`, it's depended on by
  // initialization and liveness, so already computed by the time we get to borrowcking.
  cfg_edge: Relation<readonly [T["Point"], T["Point"]]>;

  // Partial results possibly used by other variants as input. Not currently used yet.
  // #[allow(dead_code)]
  potential_errors: Set<T["Loan"]> | undefined;
  // #[allow(dead_code)]
  potential_subset_errors: Relation<readonly [T["Origin"], T["Origin"]]> | undefined;
}

/// Compares errors reported by Naive implementation with the errors
/// reported by the optimized implementation.
// crate: polonius-engine-0.13.0/src/output/mod.rs:521 compare_errors
export function compare_errors<Loan extends number, Point extends number>(
  all_naive_errors: ReadonlyMap<Point, readonly Loan[]>,
  all_opt_errors: ReadonlyMap<Point, readonly Loan[]>,
): boolean {
  const points = [...all_naive_errors.keys(), ...all_opt_errors.keys()];

  let differ = false;
  for (const point of points) {
    const naive_errors = (all_naive_errors.get(point) ?? []).slice();
    naive_errors.sort((a, b) => a - b);

    const opt_errors = (all_opt_errors.get(point) ?? []).slice();
    opt_errors.sort((a, b) => a - b);

    for (const err of naive_errors) {
      if (!opt_errors.includes(err)) {
        // error!("Error {0:?} at {1:?} reported by naive, but not opt.", err, point);
        differ = true;
      }
    }

    for (const err of opt_errors) {
      if (!naive_errors.includes(err)) {
        // error!("Error {0:?} at {1:?} reported by opt, but not naive.", err, point);
        differ = true;
      }
    }
  }

  return differ;
}

// #[cfg(test)] mod tests: mod.test.ts

// ---- support code (not ported): std collections and `HashMap::entry` ----

/** `map.entry(k).or_default()` (`or_insert_with(default_)`). */
export function entry_or_default<K, V>(map: Map<K, V>, k: K, default_: () => V): V {
  let v = map.get(k);
  if (v === undefined) {
    v = default_();
    map.set(k, v);
  }
  return v;
}

/** `Vec::retain`: keeps the elements for which `f` holds, visiting them in order. */
export function vec_retain<T>(v: T[], f: (x: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    const x = v[r]!;
    if (f(x)) v[w++] = x;
  }
  v.length = w;
}

/** Index of `x` in the sorted `v` (`found`), or where it would be inserted. */
function search<T>(v: readonly T[], x: Ord, key: (e: T) => Ord): { found: boolean; i: number } {
  let lo = 0;
  let hi = v.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const c = cmp(key(v[mid]!), x);
    if (c === 0) return { found: true, i: mid };
    if (c < 0) lo = mid + 1;
    else hi = mid;
  }
  return { found: false, i: lo };
}

/** PORT: std `BTreeSet<T>`: a sorted array of distinct elements (datafrog's tuple order, see the header). */
export class BTreeSet<T extends Ord> {
  constructor(public elements: T[]) {}

  static default<T extends Ord>(): BTreeSet<T> {
    return new BTreeSet<T>([]);
  }

  /** `iter.collect::<BTreeSet<_>>()` */
  static from_iter<T extends Ord>(iter: Iterable<T>): BTreeSet<T> {
    const s = BTreeSet.default<T>();
    for (const x of iter) s.insert(x);
    return s;
  }

  insert(value: T): boolean {
    const { found, i } = search(this.elements, value, (e) => e);
    if (found) return false;
    this.elements.splice(i, 0, value);
    return true;
  }

  contains(value: T): boolean {
    return search(this.elements, value, (e) => e).found;
  }

  iter(): readonly T[] {
    return this.elements;
  }

  len(): number {
    return this.elements.length;
  }

  is_empty(): boolean {
    return this.elements.length === 0;
  }
}

/** PORT: std `BTreeMap<K, V>`: `[K, V]` entries sorted by key (datafrog's tuple order, see the header). */
export class BTreeMap<K extends Ord, V> {
  constructor(public entries: [K, V][]) {}

  static default<K extends Ord, V>(): BTreeMap<K, V> {
    return new BTreeMap<K, V>([]);
  }

  /** `self.entry(key).or_default()` (`or_insert_with(default_)`). */
  entry_or_default(key: K, default_: () => V): V {
    const { found, i } = search(this.entries, key, (e) => e[0]);
    if (found) return this.entries[i]![1];
    const v = default_();
    this.entries.splice(i, 0, [key, v]);
    return v;
  }

  get(key: K): V | undefined {
    const { found, i } = search(this.entries, key, (e) => e[0]);
    return found ? this.entries[i]![1] : undefined;
  }

  iter(): readonly (readonly [K, V])[] {
    return this.entries;
  }

  len(): number {
    return this.entries.length;
  }

  is_empty(): boolean {
    return this.entries.length === 0;
  }
}
