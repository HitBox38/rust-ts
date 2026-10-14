// Port of compiler/rustc_type_ir/src/search_graph/global_cache.rs (lane tyir-solve).
//
// PORT: generic code over `X: Cx` takes the `Cx` impl (search_graph/mod.ts) as its last parameter (`X_cx`), like the
// D4 descriptors; `GlobalCache::new` is `const fn` without arguments upstream, so the map is built without it.
// PORT (D6): `map` (keyed by `X::Input`, an interned `CanonicalInput` in rustc) and `with_overflow` (keyed by
// `RequiredDepth`) are only read with `get` and written with `insert`, never iterated, so their bucket order is
// unobservable: both are plain `Map`s.
import { PLAIN } from "../../std/fmt.ts";
import { assert_eq } from "../../std/panic.ts";
import { AvailableDepth, assert_eq_msg, type Cx, type CxTypes, type EvaluationResult, type NestedGoals, RequiredDepth } from "./mod.ts";

interface Success<X extends CxTypes> {
  required_depth: RequiredDepth;
  nested_goals: NestedGoals<X>;
  result: X["Tracked"];
}

interface WithOverflow<X extends CxTypes> {
  nested_goals: NestedGoals<X>;
  result: X["Tracked"];
}

/// The cache entry for a given input.
///
/// This contains results whose computation never hit the
/// recursion limit in `success`, and all results which hit
/// the recursion limit in `with_overflow`.
interface CacheEntry<X extends CxTypes> {
  success: Success<X> | undefined;
  with_overflow: Map<RequiredDepth, WithOverflow<X>>;
}

/** `#[derive_where(Default)]` for `CacheEntry` */
function CacheEntry_default<X extends CxTypes>(): CacheEntry<X> {
  return { success: undefined, with_overflow: new Map() };
}

export interface CacheData<X extends CxTypes> {
  result: X["Result"];
  required_depth: RequiredDepth;
  encountered_overflow: boolean;
  nested_goals: NestedGoals<X>;
}

export class GlobalCache<X extends CxTypes> {
  constructor(public map: Map<X["Input"], CacheEntry<X>>) {}

  /** `#[derive_where(Default)]` */
  static default_<X extends CxTypes>(): GlobalCache<X> {
    return new GlobalCache<X>(new Map());
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/global_cache.rs:43 new
  static new<X extends CxTypes>(): GlobalCache<X> {
    return new GlobalCache<X>(new Map());
  }

  /// Insert a final result into the global cache.
  // rustc: compiler/rustc_type_ir/src/search_graph/global_cache.rs:48 insert
  insert(
    cx: X["Self"],
    input: X["Input"],
    evaluation_result: EvaluationResult<X>,
    dep_node: X["DepNodeIndex"],
    X_cx: Cx<X>,
  ): void {
    const { encountered_overflow, required_depth, heads: _heads, nested_goals, result: result_ } = evaluation_result;
    // debug_assert!(heads.is_empty());
    const result = X_cx.mk_tracked(cx, result_, dep_node);
    // `self.map.entry(input).or_default()`
    let entry = this.map.get(input);
    if (entry === undefined) {
      entry = CacheEntry_default<X>();
      this.map.set(input, entry);
    }
    if (encountered_overflow) {
      const with_overflow: WithOverflow<X> = { nested_goals, result };
      const prev = entry.with_overflow.get(required_depth);
      entry.with_overflow.set(required_depth, with_overflow);
      if (prev !== undefined) {
        X_cx.assert_evaluation_is_concurrent(cx);
        assert_eq(
          X_cx.get_tracked<X["Result"]>(cx, prev.result),
          evaluation_result.result,
          (v) => X_cx.debug_Result(v, PLAIN),
          X_cx.Result_eq,
        );
      }
    } else {
      // `entry.success.replace(Success { required_depth, nested_goals, result })`
      const prev = entry.success;
      entry.success = { required_depth, nested_goals, result };
      if (prev !== undefined) {
        X_cx.assert_evaluation_is_concurrent(cx);
        assert_eq_msg(
          X_cx.get_tracked<X["Result"]>(cx, prev.result),
          evaluation_result.result,
          X_cx.Result_eq,
          X_cx.debug_Result,
          () => X_cx.debug_Input(input, PLAIN),
        );
      }
    }
  }

  /// Try to fetch a cached result, checking the recursion limit
  /// and handling root goals of coinductive cycles.
  ///
  /// If this returns `Some` the cache result can be used.
  // rustc: compiler/rustc_type_ir/src/search_graph/global_cache.rs:80 get
  get(
    cx: X["Self"],
    input: X["Input"],
    available_depth: AvailableDepth,
    candidate_is_applicable: (nested_goals: NestedGoals<X>) => boolean,
    X_cx: Cx<X>,
  ): CacheData<X> | undefined {
    const entry = this.map.get(input);
    if (entry === undefined) return undefined;
    if (entry.success !== undefined) {
      const { required_depth, nested_goals, result } = entry.success;
      if (AvailableDepth.cache_entry_is_applicable(available_depth, required_depth) && candidate_is_applicable(nested_goals)) {
        return {
          result: X_cx.get_tracked<X["Result"]>(cx, result),
          required_depth,
          encountered_overflow: false,
          nested_goals,
        };
      }
    }

    const additional_depth = RequiredDepth(available_depth);
    const with_overflow = entry.with_overflow.get(additional_depth);
    if (with_overflow !== undefined) {
      const { nested_goals, result } = with_overflow;
      if (candidate_is_applicable(nested_goals)) {
        return {
          result: X_cx.get_tracked<X["Result"]>(cx, result),
          required_depth: additional_depth,
          encountered_overflow: true,
          nested_goals,
        };
      }
    }

    return undefined;
  }
}
