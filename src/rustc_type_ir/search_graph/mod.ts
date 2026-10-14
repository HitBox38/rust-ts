//! The search graph is responsible for caching and cycle detection in the trait
//! solver. Making sure that caching doesn't result in soundness bugs or unstable
//! query results is very challenging and makes this one of the most-involved
//! self-contained components of the compiler.
//!
//! We added fuzzing support to test its correctness. The fuzzers used to verify
//! the current implementation can be found in <https://github.com/lcnr/search_graph_fuzz>.
//!
//! This is just a quick overview of the general design, please check out the relevant
//! [rustc-dev-guide chapter](https://rustc-dev-guide.rust-lang.org/solve/caching.html) for
//! more details. Caching is split between a global cache and the per-cycle `provisional_cache`.
//! The global cache has to be completely unobservable, while the per-cycle cache may impact
//! behavior as long as the resulting behavior is still correct.
//
// Port of compiler/rustc_type_ir/src/search_graph/mod.rs (lane tyir-solve).
//
// PORT: the traits `Cx` and `Delegate` are fn tables (PORTING §5, "pass function tables"):
//   - `X: Cx` is described by `X extends CxTypes` (its associated types: `Self`, the `cx` value; `Input`, `Result`,
//     `AmbiguityKind`, `DepNodeIndex`, `Tracked`) and implemented by a `Cx<X>` object whose methods take `self`
//     first (`X_cx.mk_tracked(cx, data, dep_node)`). The bounds `Input/Result/AmbiguityKind: Debug + Eq + Hash` are
//     the table's `debug_*` / `*_eq` entries. `X::Input`'s `Eq + Hash` is `===` and JS `Map` identity: an input is an
//     interned object (rustc's `CanonicalInput`) or a primitive. `X::Result` and `X::AmbiguityKind` must never be
//     `undefined` (it is `Option::None`).
//   - `D: Delegate` is described by `D extends DelegateTypes` (`Cx`, `ValidationScope`, `ProofTreeBuilder`) and
//     implemented by a `Delegate<D>` object holding its consts, its static fns and its `Cx` impl (`D.Cx`).
//     `SearchGraph` keeps it in the `_marker` field (upstream `PhantomData<D>`); static fns generic over `D`
//     (`SearchGraph::<D>::new`, `allowed_depth_for_nested::<D>`) take it as their first parameter.
// PORT (D6, docs/plan-m3.md): the `HashMap`s keyed by `X::Input` (`NestedGoals::nested_goals`,
// `provisional_cache`) are plain insertion-ordered `Map`s: in rustc the key is an interned pointer, so their order
// is not reproducible in the oracle either. Their iteration is order-insensitive (each site says so upstream).
// `CandidateHeadUsages::usages` (keyed by `StackDepth`, a `u32` newtype) is a hashbrown-order `FxHashMap`.
// PORT: `BTreeMap<StackDepth, CycleHead>` (`CycleHeads::heads`) is an array of `[StackDepth, CycleHead]` sorted by
// key, which is the map's iteration order.
// PORT: `AvailableDepth(usize)` / `RequiredDepth(usize)` are branded numbers (`x.0` is `x`); `PathsToNested` (a
// `bitflags!` over `u8`) is a branded number with a companion of its flags and the bitflags methods used here.
// PORT: `Copy` structs that are mutated in place (`HeadUsages`, `CycleHead`) are copied with `clone_*` wherever Rust
// copies them (PORTING §8): `CycleHeads::iter` / `highest_cycle_head` yield copies and `CycleHeads::insert` stores
// one.
// PORT: `debug!` / `trace!` / `#[instrument]` (tracing) are kept as comments; the oracle never enables them.
import { type Debug, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { Panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { FxHashMap, type Layout, u32_key } from "../../rust_ts/hash_map.ts";
import { GlobalCache } from "./global_cache.ts";
import type { CacheData } from "./global_cache.ts";
import { Stack, type StackDepth, StackEntry } from "./stack.ts";

export { GlobalCache };

/** The associated types of an `X: Cx` (see the header). */
export interface CxTypes {
  /** The `cx` value itself (`self: X`). */
  Self: unknown;
  Input: unknown;
  Result: unknown;
  AmbiguityKind: unknown;
  DepNodeIndex: unknown;
  /** `Self::Tracked<T>` for every `T` (TS has no higher-kinded types; `get_tracked::<T>` names the `T`). */
  Tracked: unknown;
}

/// The search graph does not simply use `Interner` directly
/// to enable its fuzzing without having to stub the rest of
/// the interner. We don't make this a super trait of `Interner`
/// as users of the shared type library shouldn't have to care
/// about `Input` and `Result` as they are implementation details
/// of the search graph.
export interface Cx<X extends CxTypes> {
  // PORT: the bounds `type Input: Debug + Eq + Hash + Copy`, `type Result: Debug + Eq + Hash + Copy`,
  // `type AmbiguityKind: Debug + Eq + Hash + Copy` (see the header for `Input`'s `Eq + Hash`).
  readonly debug_Input: Debug<X["Input"]>;
  readonly debug_Result: Debug<X["Result"]>;
  readonly Result_eq: (a: X["Result"], b: X["Result"]) => boolean;
  readonly AmbiguityKind_eq: (a: X["AmbiguityKind"], b: X["AmbiguityKind"]) => boolean;

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:48 mk_tracked
  mk_tracked<T>(self: X["Self"], data: T, dep_node_index: X["DepNodeIndex"]): X["Tracked"];
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:53 get_tracked
  get_tracked<T>(self: X["Self"], tracked: X["Tracked"]): T;
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:54 with_cached_task
  with_cached_task<T>(self: X["Self"], task: () => T): [T, X["DepNodeIndex"]];

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:56 with_global_cache
  with_global_cache<R>(self: X["Self"], f: (cache: GlobalCache<X>) => R): R;

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:58 assert_evaluation_is_concurrent
  assert_evaluation_is_concurrent(self: X["Self"]): void;
}

/** The associated types of a `D: Delegate` (see the header). */
export interface DelegateTypes {
  Cx: CxTypes;
  ValidationScope: unknown;
  ProofTreeBuilder: unknown;
}

export interface Delegate<D extends DelegateTypes, X extends CxTypes = D["Cx"]> {
  /** `type Cx: Cx`: the `Cx` impl of `D::Cx`. */
  readonly Cx: Cx<X>;
  /// Whether to use the provisional cache. Set to `false` by a fuzzer when
  /// validating the search graph.
  readonly ENABLE_PROVISIONAL_CACHE: boolean;
  /// Returning `Some` disables the global cache for the current goal.
  ///
  /// The `ValidationScope` is used when fuzzing the search graph to track
  /// for which goals the global cache has been disabled. This is necessary
  /// as we may otherwise ignore the global cache entry for some goal `G`
  /// only to later use it, failing to detect a cycle goal and potentially
  /// changing the result.
  // PORT: `Option<Self::ValidationScope>`; a `ValidationScope` is never `undefined`.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:74 enter_validation_scope
  enter_validation_scope(cx: X["Self"], input: X["Input"]): D["ValidationScope"] | undefined;

  readonly FIXPOINT_STEP_LIMIT: number;

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:82 inspect_is_noop
  inspect_is_noop(inspect: D["ProofTreeBuilder"]): boolean;

  readonly DIVIDE_AVAILABLE_DEPTH_ON_OVERFLOW: number;

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:86 initial_provisional_result
  initial_provisional_result(cx: X["Self"], kind: PathKind, input: X["Input"]): X["Result"];
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:91 is_initial_provisional_result
  is_initial_provisional_result(result: X["Result"]): PathKind | undefined;
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:92 stack_overflow_result
  stack_overflow_result(cx: X["Self"], input: X["Input"]): X["Result"];

  readonly FIXPOINT_OVERFLOW_AMBIGUITY_KIND: X["AmbiguityKind"];
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:98 fixpoint_overflow_result
  fixpoint_overflow_result(cx: X["Self"], input: X["Input"]): X["Result"];

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:103 is_ambiguous_result
  is_ambiguous_result(result: X["Result"]): X["AmbiguityKind"] | undefined;

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:107 compute_goal
  compute_goal(
    search_graph: SearchGraph<D, X>,
    cx: X["Self"],
    input: X["Input"],
    inspect: D["ProofTreeBuilder"],
  ): X["Result"];
}

// ---- PORT helpers ----------------------------------------------------------------------------------------------------

/** PORT: `Vec::retain_mut(f)` in place (each element visited once, in order). */
function vec_retain_mut<T>(v: T[], f: (x: T) => boolean): void {
  let j = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (f(x)) v[j++] = x;
  }
  v.length = j;
}

/** PORT: `assert_eq!(left, right, "{msg}")` (core's `assert_failed_inner`, `AssertKind::Eq`, with args;
 * std/panic.ts `assert_eq` has no message). */
export function assert_eq_msg<T>(left: T, right: T, eq: (a: T, b: T) => boolean, debug: Debug<T>, msg: () => string): void {
  if (!eq(left, right)) {
    throw new Panic(
      `assertion \`left == right\` failed: ${msg()}\n  left: ${debug(left, PLAIN)}\n right: ${debug(right, PLAIN)}`,
    );
  }
}

/** PORT: `HashMap::retain(f)` of a plain `Map` (D6: insertion order; deleting while iterating is safe). */
function map_retain<K, V>(m: Map<K, V>, f: (k: K, v: V) => boolean): void {
  for (const [k, v] of m) {
    if (!f(k, v)) m.delete(k);
  }
}

// ---- PathKind ------------------------------------------------------------------------------------------------------

/// In the initial iteration of a cycle, we do not yet have a provisional
/// result. In the case we return an initial provisional result depending
/// on the kind of cycle.
export type PathKind =
  /// A path consisting of only inductive/unproductive steps. Their initial
  /// provisional result is `Err(NoSolution)`. We currently treat them as
  /// `PathKind::Unknown` during coherence until we're fully confident in
  /// our approach.
  | "Inductive"
  /// A path which is not be coinductive right now but we may want
  /// to change of them to be so in the future. We return an ambiguous
  /// result in this case to prevent people from relying on this.
  | "Unknown"
  /// A path with at least one coinductive step. Such cycles hold.
  | "Coinductive"
  /// A path which is treated as ambiguous. Once a path has this path kind
  /// any other segment does not change its kind.
  ///
  /// This is currently only used when fuzzing to support negative reasoning.
  /// For more details, see #143054.
  | "ForcedAmbiguity";
export const debug_PathKind: Debug<PathKind> = (v) => v;
export const PathKind = {
  Inductive: "Inductive",
  Unknown: "Unknown",
  Coinductive: "Coinductive",
  ForcedAmbiguity: "ForcedAmbiguity",

  /// Returns the path kind when merging `self` with `rest`.
  ///
  /// Given an inductive path `self` and a coinductive path `rest`,
  /// the path `self -> rest` would be coinductive.
  ///
  /// This operation represents an ordering and would be equivalent
  /// to `max(self, rest)`.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:148 extend
  extend(self: PathKind, rest: PathKind): PathKind {
    if (self === "ForcedAmbiguity" || rest === "ForcedAmbiguity") {
      return "ForcedAmbiguity";
    }
    if (self === "Coinductive" || rest === "Coinductive") return "Coinductive";
    if (self === "Unknown" || rest === "Unknown") return "Unknown";
    // (PathKind::Inductive, PathKind::Inductive)
    return "Inductive";
  },
} as const;

// ---- HeadUsages ----------------------------------------------------------------------------------------------------

/// The kinds of cycles a cycle head was involved in.
///
/// This is used to avoid rerunning a cycle if there's
/// just a single usage kind and the final result matches
/// its provisional result.
///
/// While it tracks the amount of usages using `u32`, we only ever
/// care whether there are any. We only count them to be able to ignore
/// usages from irrelevant candidates while evaluating a goal.
///
/// This cares about how nested goals relied on a cycle head. It does
/// not care about how frequently the nested goal relied on it.
export class HeadUsages {
  constructor(
    public inductive: number,
    public unknown: number,
    public coinductive: number,
    public forced_ambiguity: number,
  ) {}

  /** `#[derive(Default)]` */
  static default_(): HeadUsages {
    return new HeadUsages(0, 0, 0, 0);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:181 add_usage
  add_usage(path: PathKind): void {
    switch (path) {
      case "Inductive":
        this.inductive += 1;
        break;
      case "Unknown":
        this.unknown += 1;
        break;
      case "Coinductive":
        this.coinductive += 1;
        break;
      case "ForcedAmbiguity":
        this.forced_ambiguity += 1;
        break;
    }
  }

  /// This adds the usages which occurred while computing a nested goal.
  ///
  /// We don't actually care about how frequently the nested goal relied
  /// on its cycle heads, only whether it did.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:194 add_usages_from_nested
  add_usages_from_nested(usages: HeadUsages): void {
    const { inductive, unknown, coinductive, forced_ambiguity } = usages;
    this.inductive += inductive === 0 ? 0 : 1;
    this.unknown += unknown === 0 ? 0 : 1;
    this.coinductive += coinductive === 0 ? 0 : 1;
    this.forced_ambiguity += forced_ambiguity === 0 ? 0 : 1;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:202 ignore_usages
  ignore_usages(usages: HeadUsages): void {
    const { inductive, unknown, coinductive, forced_ambiguity } = usages;
    this.inductive = checked_sub_unwrap(this.inductive, inductive);
    this.unknown = checked_sub_unwrap(this.unknown, unknown);
    this.coinductive = checked_sub_unwrap(this.coinductive, coinductive);
    this.forced_ambiguity = checked_sub_unwrap(this.forced_ambiguity, forced_ambiguity);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:210 is_empty
  is_empty(): boolean {
    const { inductive, unknown, coinductive, forced_ambiguity } = this;
    return inductive === 0 && unknown === 0 && coinductive === 0 && forced_ambiguity === 0;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:215 is_single
  is_single(path_kind: PathKind): boolean {
    switch (path_kind) {
      case "Inductive":
        return this.unknown === 0 && this.coinductive === 0 && this.forced_ambiguity === 0;
      case "Unknown":
        return this.inductive === 0 && this.coinductive === 0 && this.forced_ambiguity === 0;
      case "Coinductive":
        return this.inductive === 0 && this.unknown === 0 && this.forced_ambiguity === 0;
      case "ForcedAmbiguity":
        return this.inductive === 0 && this.unknown === 0 && this.coinductive === 0;
    }
  }
}

/** `u32::checked_sub(a, b).unwrap()` */
function checked_sub_unwrap(a: number, b: number): number {
  return unwrap(a >= b ? a - b : undefined);
}

/** A copy of a `HeadUsages` (`Copy`). */
export function clone_HeadUsages(v: HeadUsages): HeadUsages {
  return new HeadUsages(v.inductive, v.unknown, v.coinductive, v.forced_ambiguity);
}

/** `HeadUsages == HeadUsages` (`#[derive(PartialEq)]`). */
export function HeadUsages_eq(a: HeadUsages, b: HeadUsages): boolean {
  return (
    a.inductive === b.inductive &&
    a.unknown === b.unknown &&
    a.coinductive === b.coinductive &&
    a.forced_ambiguity === b.forced_ambiguity
  );
}

/** `size_of::<HeadUsages>()` / `align_of`: four `u32`s. */
const LAYOUT_HEAD_USAGES: Layout = { size: 16, align: 4 };

// ---- CandidateHeadUsages -------------------------------------------------------------------------------------------

export class CandidateHeadUsages {
  constructor(public usages: FxHashMap<StackDepth, HeadUsages> | undefined) {}

  /** `#[derive(Default)]` */
  static default_(): CandidateHeadUsages {
    return new CandidateHeadUsages(undefined);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:242 merge_usages
  merge_usages(other: CandidateHeadUsages): void {
    const other_usages = other.usages;
    if (other_usages !== undefined) {
      const self_usages_ = this.usages;
      if (self_usages_ !== undefined) {
        // Each head is merged independently, so the final usage counts are the same
        // regardless of hash iteration order.
        for (const [head_index, head] of other_usages) {
          const { inductive, unknown, coinductive, forced_ambiguity } = head;
          // `self_usages.entry(head_index).or_default()`
          let self_usages = self_usages_.get(head_index);
          if (self_usages === undefined) {
            self_usages = HeadUsages.default_();
            self_usages_.set(head_index, self_usages);
          }
          self_usages.inductive += inductive;
          self_usages.unknown += unknown;
          self_usages.coinductive += coinductive;
          self_usages.forced_ambiguity += forced_ambiguity;
        }
      } else {
        this.usages = other_usages;
      }
    }
  }
}

/** `HashMap<StackDepth, HeadUsages>::default()` */
function new_head_usages_map(): FxHashMap<StackDepth, HeadUsages> {
  return FxHashMap.default<StackDepth, HeadUsages>(u32_key, LAYOUT_HEAD_USAGES);
}

// ---- LowerAvailableDepth / AvailableDepth / RequiredDepth ----------------------------------------------------------

/// Whether evaluating a given goal should be done with a lower available depth from
/// its parent goal.
///
/// Normally, it should be `Yes`, but among rustc's predicate goals, `normalizes-to`
/// goals are exceptions. They act like functions that used for normalizing associated
/// terms while evaluating projection goals with fully unconstrained expected term.
/// We don't want to lower the available depths for those function-like goals, otherwise
/// we will encounter recursion limit overflows more often.
export type LowerAvailableDepth = "Yes" | "No";
export const LowerAvailableDepth = { Yes: "Yes", No: "No" } as const;
export const debug_LowerAvailableDepth: Debug<LowerAvailableDepth> = (v) => v;

export type AvailableDepth = number & { readonly __brand: "AvailableDepth" };
/** `AvailableDepth(n)` */
export function AvailableDepth(n: number): AvailableDepth {
  return n as AvailableDepth;
}

// impl Sub<RequiredDepth> for AvailableDepth
// rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:282 sub
AvailableDepth.sub = function (self: AvailableDepth, rhs: RequiredDepth): AvailableDepth {
  // `self.0.checked_sub(rhs.0).unwrap()`
  return AvailableDepth(checked_sub_unwrap(self, rhs));
};

/// Returns the remaining depth allowed for nested goals.
///
/// This is generally simply one less than the current depth.
/// However, if we encountered overflow, we significantly reduce
/// the remaining depth of all nested goals to prevent hangs
/// in case there is exponential blowup.
// PORT: `::<D>` is the first parameter (the `Delegate` impl).
// rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:294 allowed_depth_for_nested
AvailableDepth.allowed_depth_for_nested = function <D extends DelegateTypes, X extends CxTypes>(
  D: Delegate<D, X>,
  root_depth: AvailableDepth,
  stack: Stack<X>,
  lower_available_depth: LowerAvailableDepth,
): AvailableDepth | undefined {
  const last = stack.last();
  if (last !== undefined) {
    switch (lower_available_depth) {
      case "Yes":
        break;
      case "No": {
        return last.available_depth;
      }
    }

    if (last.available_depth === 0) {
      return undefined;
    }

    return last.encountered_overflow
      ? AvailableDepth(Math.floor(last.available_depth / D.DIVIDE_AVAILABLE_DEPTH_ON_OVERFLOW))
      : AvailableDepth(last.available_depth - 1);
  } else {
    return root_depth;
  }
};

/// Whether we're allowed to use a global cache entry which required
/// the given depth.
// rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:323 cache_entry_is_applicable
AvailableDepth.cache_entry_is_applicable = function (self: AvailableDepth, required_depth: RequiredDepth): boolean {
  return self >= required_depth;
};


export type RequiredDepth = number & { readonly __brand: "RequiredDepth" };
/** `RequiredDepth(n)` */
export function RequiredDepth(n: number): RequiredDepth {
  return n as RequiredDepth;
}
/** `#[derive(Debug)]` */
export const debug_RequiredDepth: Debug<RequiredDepth> = (v, f) => debug_tuple(f, "RequiredDepth", [String(v)]);

// ---- CycleHead / CycleHeads ----------------------------------------------------------------------------------------

export interface CycleHead {
  paths_to_head: PathsToNested;
  /// If the `usages` are empty, the result of that head does not matter
  /// for the current goal. However, we still don't completely drop this
  /// cycle head as whether or not it exists impacts which queries we
  /// access, so ignoring it would cause incremental compilation verification
  /// failures or hide query cycles.
  usages: HeadUsages;
}

/** A copy of a `CycleHead` (`Copy`). */
function clone_CycleHead(v: CycleHead): CycleHead {
  return { paths_to_head: v.paths_to_head, usages: clone_HeadUsages(v.usages) };
}

/// All cycle heads a given goal depends on, ordered by their stack depth.
///
/// We also track all paths from this goal to that head. This is necessary
/// when rebasing provisional cache results.
export class CycleHeads {
  /** `BTreeMap<StackDepth, CycleHead>`: sorted by key (header). */
  constructor(public heads: [StackDepth, CycleHead][]) {}

  /** `#[derive(Default)]` */
  static default_(): CycleHeads {
    return new CycleHeads([]);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:352 is_empty
  is_empty(): boolean {
    return this.heads.length === 0;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:356 highest_cycle_head
  highest_cycle_head(): [StackDepth, CycleHead] {
    const [k, v] = unwrap(this.heads[this.heads.length - 1]);
    return [k, clone_CycleHead(v)];
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:360 highest_cycle_head_index
  highest_cycle_head_index(): StackDepth {
    return unwrap(this.opt_highest_cycle_head_index());
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:364 opt_highest_cycle_head_index
  opt_highest_cycle_head_index(): StackDepth | undefined {
    return this.heads[this.heads.length - 1]?.[0];
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:368 opt_lowest_cycle_head_index
  opt_lowest_cycle_head_index(): StackDepth | undefined {
    return this.heads[0]?.[0];
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:372 remove_highest_cycle_head
  remove_highest_cycle_head(): CycleHead {
    const last = this.heads.pop();
    return unwrap(last)[1];
  }

  // PORT: `path_from_entry: impl Into<PathsToNested> + Copy`: callers convert a `PathKind` with
  // `PathsToNested.from_PathKind` (the only other `Into` impl is the identity).
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:377 insert
  insert(head_index: StackDepth, path_from_entry: PathsToNested, usages: HeadUsages): void {
    // `self.heads.entry(head_index)`
    let i = 0;
    while (i < this.heads.length && this.heads[i]![0] < head_index) i++;
    if (i === this.heads.length || this.heads[i]![0] !== head_index) {
      // btree_map::Entry::Vacant(entry)
      this.heads.splice(i, 0, [head_index, { paths_to_head: path_from_entry, usages: clone_HeadUsages(usages) }]);
    } else {
      // btree_map::Entry::Occupied(entry)
      const head = this.heads[i]![1];
      head.paths_to_head = PathsToNested.union(head.paths_to_head, path_from_entry);
      head.usages.add_usages_from_nested(usages);
    }
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:395 ignore_usages
  ignore_usages(head_index: StackDepth, usages: HeadUsages): void {
    // `self.heads.get_mut(&head_index).unwrap()`
    unwrap(this.heads.find(([k]) => k === head_index))[1].usages.ignore_usages(usages);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:399 iter
  iter(): [StackDepth, CycleHead][] {
    return this.heads.map(([k, v]) => [k, clone_CycleHead(v)]);
  }
}

// ---- PathsToNested -------------------------------------------------------------------------------------------------

/// Tracks how nested goals have been accessed. This is necessary to disable
/// global cache entries if computing them would otherwise result in a cycle or
/// access a provisional cache entry.
export type PathsToNested = number & { readonly __brand: "PathsToNested" };
export const PathsToNested = {
  /// The initial value when adding a goal to its own nested goals.
  EMPTY: (1 << 0) as PathsToNested,
  INDUCTIVE: (1 << 1) as PathsToNested,
  UNKNOWN: (1 << 2) as PathsToNested,
  COINDUCTIVE: (1 << 3) as PathsToNested,
  FORCED_AMBIGUITY: (1 << 4) as PathsToNested,

  // ---- the `bitflags!` methods used here (bitflags-2.10.0 `Flags`) ----
  /** `PathsToNested::empty()` */
  empty(): PathsToNested {
    return 0 as PathsToNested;
  },
  /** `self | other` */
  union(self: PathsToNested, other: PathsToNested): PathsToNested {
    return (self | other) as PathsToNested;
  },
  /** `self.contains(other)` */
  contains(self: PathsToNested, other: PathsToNested): boolean {
    return (self & other) === other;
  },
  /** `self.intersects(other)` */
  intersects(self: PathsToNested, other: PathsToNested): boolean {
    return (self & other) !== 0;
  },

  // impl From<PathKind> for PathsToNested
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:419 from
  from_PathKind(path: PathKind): PathsToNested {
    switch (path) {
      case "Inductive":
        return PathsToNested.INDUCTIVE;
      case "Unknown":
        return PathsToNested.UNKNOWN;
      case "Coinductive":
        return PathsToNested.COINDUCTIVE;
      case "ForcedAmbiguity":
        return PathsToNested.FORCED_AMBIGUITY;
    }
  },

  /// The implementation of this function is kind of ugly. We check whether
  /// there currently exist 'weaker' paths in the set, if so we upgrade these
  /// paths to at least `path`.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:433 extend_with
  extend_with(self: PathsToNested, path: PathKind): PathsToNested {
    // `self.remove(x)` is `self & !x`, `self.insert(x)` is `self | x`.
    const P = PathsToNested;
    switch (path) {
      case "Inductive": {
        if (P.intersects(self, P.EMPTY)) {
          self = (self & ~P.EMPTY) as PathsToNested;
          self = (self | P.INDUCTIVE) as PathsToNested;
        }
        break;
      }
      case "Unknown": {
        const m = (P.EMPTY | P.INDUCTIVE) as PathsToNested;
        if (P.intersects(self, m)) {
          self = (self & ~m) as PathsToNested;
          self = (self | P.UNKNOWN) as PathsToNested;
        }
        break;
      }
      case "Coinductive": {
        const m = (P.EMPTY | P.INDUCTIVE | P.UNKNOWN) as PathsToNested;
        if (P.intersects(self, m)) {
          self = (self & ~m) as PathsToNested;
          self = (self | P.COINDUCTIVE) as PathsToNested;
        }
        break;
      }
      case "ForcedAmbiguity": {
        const m = (P.EMPTY | P.INDUCTIVE | P.UNKNOWN | P.COINDUCTIVE) as PathsToNested;
        if (P.intersects(self, m)) {
          self = (self & ~m) as PathsToNested;
          self = (self | P.FORCED_AMBIGUITY) as PathsToNested;
        }
        break;
      }
    }

    return self;
  },

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:479 extend_with_paths
  extend_with_paths(self: PathsToNested, path: PathsToNested): PathsToNested {
    let new_ = PathsToNested.empty();
    for (const p of PathsToNested.iter_paths(path)) {
      new_ = PathsToNested.union(new_, PathsToNested.extend_with(self, p));
    }
    return new_;
  },

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:487 iter_paths
  iter_paths(self: PathsToNested): PathKind[] {
    // let (PathKind::Inductive | PathKind::Unknown | PathKind::Coinductive | PathKind::ForcedAmbiguity);
    const all: PathKind[] = ["Inductive", "Unknown", "Coinductive", "ForcedAmbiguity"];
    return all.filter((p) => PathsToNested.contains(self, PathsToNested.from_PathKind(p)));
  },
};

// ---- NestedGoals ---------------------------------------------------------------------------------------------------

/// The nested goals of each stack entry and the path from the
/// stack entry to that nested goal.
///
/// They are used when checking whether reevaluating a global cache
/// would encounter a cycle or use a provisional cache entry given the
/// current search graph state. We need to disable the global cache
/// in this case as it could otherwise result in behavioral differences.
/// Cycles can impact behavior. The cycle ABA may have different final
/// results from a the cycle BAB depending on the cycle root.
///
/// We only start tracking nested goals once we've either encountered
/// overflow or a solver cycle. This is a performance optimization to
/// avoid tracking nested goals on the happy path.
export class NestedGoals<X extends CxTypes> {
  constructor(public nested_goals: Map<X["Input"], PathsToNested>) {}

  /** `#[derive_where(Default)]` */
  static default_<X extends CxTypes>(): NestedGoals<X> {
    return new NestedGoals<X>(new Map());
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:516 is_empty
  is_empty(): boolean {
    return this.nested_goals.size === 0;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:520 insert
  insert(input: X["Input"], paths_to_nested: PathsToNested): void {
    const prev = this.nested_goals.get(input);
    if (prev !== undefined) {
      // Entry::Occupied(mut entry) => *entry.get_mut() |= paths_to_nested
      this.nested_goals.set(input, PathsToNested.union(prev, paths_to_nested));
    } else {
      // Entry::Vacant(entry) => drop(entry.insert(paths_to_nested))
      this.nested_goals.set(input, paths_to_nested);
    }
  }

  /// Adds the nested goals of a nested goal, given that the path `step_kind` from this goal
  /// to the parent goal.
  ///
  /// If the path from this goal to the nested goal is inductive, the paths from this goal
  /// to all nested goals of that nested goal are also inductive. Otherwise the paths are
  /// the same as for the child.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:533 extend_from_child
  extend_from_child(step_kind: PathKind, nested_goals: NestedGoals<X>): void {
    if (nested_goals.is_empty()) {
      return;
    }

    // Each nested goal is updated independently, so traversal order cannot
    // affect the result.
    if (this.is_empty()) {
      // Manually avoid HashMap lookups for every input if there aren't
      // any preexisting entries.
      // `self.nested_goals.clone_from(&nested_goals.nested_goals)`
      this.nested_goals = new Map(nested_goals.nested_goals);
      for (const [input, paths_to_nested] of this.nested_goals) {
        this.nested_goals.set(input, PathsToNested.extend_with(paths_to_nested, step_kind));
      }
    } else {
      for (const [input, paths_to_nested_] of nested_goals.iter()) {
        const paths_to_nested = PathsToNested.extend_with(paths_to_nested_, step_kind);
        this.insert(input, paths_to_nested);
      }
    }
  }

  // This helper intentionally exposes unstable hash iteration so each caller must opt in
  // locally and justify why its traversal is order-insensitive.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:560 iter
  iter(): [X["Input"], PathsToNested][] {
    return [...this.nested_goals];
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:564 contains
  contains(input: X["Input"]): boolean {
    return this.nested_goals.has(input);
  }
}

// ---- ProvisionalCacheEntry / EvaluationResult ----------------------------------------------------------------------

/// A provisional result of an already computed goals which depends on other
/// goals still on the stack.
interface ProvisionalCacheEntry<X extends CxTypes> {
  /// Whether evaluating the goal encountered overflow. This is used to
  /// disable the cache entry except if the last goal on the stack is
  /// already involved in this cycle.
  encountered_overflow: boolean;
  /// All cycle heads this cache entry depends on.
  heads: CycleHeads;
  /// The path from the highest cycle head to this goal. This differs from
  /// `heads` which tracks the path to the cycle head *from* this goal.
  path_from_head: PathKind;
  result: X["Result"];
}

/// The final result of evaluating a goal.
///
/// We reset `encountered_overflow` when reevaluating a goal,
/// but need to track whether we've hit the recursion limit at
/// all for correctness.
///
/// We've previously simply returned the final `StackEntry` but this
/// made it easy to accidentally drop information from the previous
/// evaluation.
export interface EvaluationResult<X extends CxTypes> {
  encountered_overflow: boolean;
  required_depth: RequiredDepth;
  heads: CycleHeads;
  nested_goals: NestedGoals<X>;
  result: X["Result"];
}

export const EvaluationResult = {
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:604 finalize
  finalize<X extends CxTypes>(
    final_entry: StackEntry<X>,
    encountered_overflow: boolean,
    result: X["Result"],
  ): EvaluationResult<X> {
    return {
      encountered_overflow,
      // Unlike `encountered_overflow`, we share `heads`, `required_depth`,
      // and `nested_goals` between evaluations.
      required_depth: final_entry.required_depth(),
      heads: final_entry.heads,
      nested_goals: final_entry.nested_goals,
      // We only care about the final result.
      result,
    };
  },
};

// ---- SearchGraph ---------------------------------------------------------------------------------------------------

/// While [`SearchGraph::update_parent_goal`] can be mostly shared between
/// ordinary nested goals/global cache hits and provisional cache hits,
/// using the provisional cache should not add any nested goals.
///
/// `nested_goals` are only used when checking whether global cache entries
/// are applicable. This only cares about whether a goal is actually accessed.
/// Given that the usage of the provisional cache is fully deterministic, we
/// don't need to track the nested goals used while computing a provisional
/// cache entry.
type UpdateParentGoalCtxt<X extends CxTypes> =
  | { readonly $: "Ordinary"; nested_goals: NestedGoals<X> }
  | { readonly $: "CycleOnStack"; head: X["Input"] }
  | { readonly $: "ProvisionalCacheHit" };

/// We need to rebase provisional cache entries when popping one of their cycle
/// heads from the stack. This may not necessarily mean that we've actually
/// reached a fixpoint for that cycle head, which impacts the way we rebase
/// provisional cache entries.
type RebaseReason<X extends CxTypes> =
  | { readonly $: "NoCycleUsages" }
  | { readonly $: "Ambiguity"; _0: X["AmbiguityKind"] }
  /// We've actually reached a fixpoint.
  ///
  /// This either happens in the first evaluation step for the cycle head.
  /// In this case the used provisional result depends on the cycle `PathKind`.
  /// We store this path kind to check whether the provisional cache entry
  /// we're rebasing relied on the same cycles.
  ///
  /// In later iterations cycles always return `stack_entry.provisional_result`
  /// so we no longer depend on the `PathKind`. We store `None` in that case.
  | { readonly $: "ReachedFixpoint"; _0: PathKind | undefined };

export class SearchGraph<D extends DelegateTypes, X extends CxTypes = D["Cx"]> {
  constructor(
    public root_depth: AvailableDepth,
    public stack: Stack<X>,
    /// The provisional cache contains entries for already computed goals which
    /// still depend on goals higher-up in the stack. We don't move them to the
    /// global cache and track them locally instead. A provisional cache entry
    /// is only valid until the result of one of its cycle heads changes.
    public provisional_cache: Map<X["Input"], ProvisionalCacheEntry<X>[]>,

    /** PORT: `PhantomData<D>` holds the `Delegate` impl (header). */
    readonly _marker: Delegate<D, X>,
  ) {}

  // PORT: `SearchGraph::<D>::new`: `D` is the first parameter.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:650 new
  static new<D extends DelegateTypes>(D: Delegate<D>, root_depth: number): SearchGraph<D> {
    return new SearchGraph<D>(AvailableDepth(root_depth), Stack.default_(), new Map(), D);
  }

  /// Lazily update the stack entry for the parent goal.
  /// This behavior is shared between actually evaluating goals
  /// and using existing global cache entries to make sure they
  /// have the same impact on the remaining evaluation.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:663 update_parent_goal
  static update_parent_goal<X extends CxTypes>(
    stack: Stack<X>,
    step_kind_from_parent: PathKind,
    heads: Iterable<[StackDepth, CycleHead]>,
    encountered_overflow: boolean,
    context: UpdateParentGoalCtxt<X>,
    min_reachable_available_depth: AvailableDepth,
  ): void {
    const last = stack.last_mut_with_index();
    if (last !== undefined) {
      const [parent_index, parent] = last;
      parent.encountered_overflow ||= encountered_overflow;
      parent.min_reached_available_depth = AvailableDepth(
        Math.min(parent.min_reached_available_depth, min_reachable_available_depth),
      );

      for (const [head_index, head] of heads) {
        const candidate_usages = parent.candidate_usages;
        if (candidate_usages !== undefined) {
          // `.usages.get_or_insert_default().entry(head_index).or_default()`
          candidate_usages.usages ??= new_head_usages_map();
          let u = candidate_usages.usages.get(head_index);
          if (u === undefined) {
            u = HeadUsages.default_();
            candidate_usages.usages.set(head_index, u);
          }
          u.add_usages_from_nested(head.usages);
        }
        if (head_index < parent_index) {
          parent.heads.insert(
            head_index,
            PathsToNested.extend_with(head.paths_to_head, step_kind_from_parent),
            head.usages,
          );
        } else if (head_index === parent_index) {
          parent.usages ??= HeadUsages.default_();
          parent.usages.add_usages_from_nested(head.usages);
        } else {
          unreachable();
        }
      }
      let parent_depends_on_cycle: boolean;
      switch (context.$) {
        case "Ordinary": {
          const nested_goals = context.nested_goals;
          parent.nested_goals.extend_from_child(step_kind_from_parent, nested_goals);
          parent_depends_on_cycle = !nested_goals.is_empty();
          break;
        }
        case "CycleOnStack": {
          // We lookup provisional cache entries before detecting cycles.
          // We therefore can't use a global cache entry if it contains a cycle
          // whose head is in the provisional cache.
          parent.nested_goals.insert(context.head, PathsToNested.from_PathKind(step_kind_from_parent));
          parent_depends_on_cycle = true;
          break;
        }
        case "ProvisionalCacheHit":
          parent_depends_on_cycle = true;
          break;
      }
      // Once we've got goals which encountered overflow or a cycle,
      // we track all goals whose behavior may depend depend on these
      // goals as this change may cause them to now depend on additional
      // goals, resulting in new cycles. See the dev-guide for examples.
      if (parent_depends_on_cycle) {
        parent.nested_goals.insert(parent.input, PathsToNested.EMPTY);
      }
    }
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:721 is_empty
  is_empty(): boolean {
    if (this.stack.is_empty()) {
      // debug_assert!(self.provisional_cache.is_empty());
      return true;
    } else {
      return false;
    }
  }

  /// The number of goals currently in the search graph. This should only be
  /// used for debugging purposes.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:732 debug_current_depth
  debug_current_depth(): number {
    return this.stack.len();
  }

  /// Whether the path from `head` to the current stack entry is inductive or coinductive.
  ///
  /// The `step_kind_to_head` is used to add a single additional path segment to the path on
  /// the stack which completes the cycle. This given an inductive step AB which then cycles
  /// coinductively with A, we need to treat this cycle as coinductive.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:741 cycle_path_kind
  static cycle_path_kind<X extends CxTypes>(stack: Stack<X>, step_kind_to_head: PathKind, head: StackDepth): PathKind {
    return stack.cycle_step_kinds(head).reduce((curr, step) => PathKind.extend(curr, step), step_kind_to_head);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:749 enter_single_candidate
  enter_single_candidate(): void {
    const last = unwrap(this.stack.last_mut());
    const _prev = last.candidate_usages;
    last.candidate_usages = CandidateHeadUsages.default_();
    // debug_assert!(prev.is_none(), "existing candidate_usages: {prev:?}");
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:754 finish_single_candidate
  finish_single_candidate(): CandidateHeadUsages {
    const last = unwrap(this.stack.last_mut());
    const usages = last.candidate_usages;
    last.candidate_usages = undefined;
    return unwrap(usages);
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:758 ignore_candidate_head_usages
  ignore_candidate_head_usages(usages_: CandidateHeadUsages): void {
    const usages = usages_.usages;
    if (usages !== undefined) {
      const [entry_index, entry] = unwrap(this.stack.last_mut_with_index());
      // Ignoring usages only mutates the state for the current `head_index`, so the
      // resulting per-head state is unchanged by iteration order.
      for (const [head_index, usages_of_head] of usages) {
        if (head_index === entry_index) {
          unwrap(entry.usages).ignore_usages(usages_of_head);
        } else {
          entry.heads.ignore_usages(head_index, usages_of_head);
        }
      }
    }
  }

  // PORT: `D` (the `Delegate` impl) is the first parameter.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:774 evaluate_root_goal_for_proof_tree
  static evaluate_root_goal_for_proof_tree<D extends DelegateTypes>(
    D: Delegate<D>,
    cx: D["Cx"]["Self"],
    root_depth: number,
    input: D["Cx"]["Input"],
    inspect: D["ProofTreeBuilder"],
  ): [D["Cx"]["Result"], RequiredDepth] {
    const this_ = SearchGraph.new<D>(D, root_depth);
    const available_depth = AvailableDepth(root_depth);
    const step_kind_from_parent: PathKind = "Inductive"; // is never used
    this_.stack.push(
      new StackEntry<D["Cx"]>(
        input,
        step_kind_from_parent,
        available_depth,
        available_depth,
        undefined,
        CycleHeads.default_(),
        false,
        undefined,
        undefined,
        NestedGoals.default_(),
      ),
    );
    const evaluation_result = this_.evaluate_goal_in_task(cx, input, inspect);
    return [evaluation_result.result, evaluation_result.required_depth];
  }

  /// Probably the most involved method of the whole solver.
  ///
  /// While goals get computed via `D::compute_goal`, this function handles
  /// caching, overflow, and cycles.
  // #[instrument(level = "debug", skip(self, cx, inspect), ret)]
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:804 evaluate_goal
  evaluate_goal(
    cx: X["Self"],
    input: X["Input"],
    step_kind_from_parent: PathKind,
    lower_available_depth: LowerAvailableDepth,
    inspect: D["ProofTreeBuilder"],
  ): X["Result"] {
    const D = this._marker;
    const available_depth = AvailableDepth.allowed_depth_for_nested(D, this.root_depth, this.stack, lower_available_depth);
    if (available_depth === undefined) {
      return this.handle_overflow(cx, input);
    }

    // We check the provisional cache before checking the global cache. This simplifies
    // the implementation as we can avoid worrying about cases where both the global and
    // provisional cache may apply, e.g. consider the following example
    //
    // - xxBA overflow
    // - A
    //     - BA cycle
    //     - CB :x:
    {
      const result = this.lookup_provisional_cache(input, step_kind_from_parent, available_depth);
      if (result !== undefined) {
        return result;
      }
    }

    // Lookup the global cache unless we're building proof trees or are currently
    // fuzzing.
    let validate_cache: [D["ValidationScope"], X["Result"]] | undefined;
    if (!D.inspect_is_noop(inspect)) {
      validate_cache = undefined;
    } else {
      const scope = D.enter_validation_scope(cx, input);
      if (scope !== undefined) {
        // When validating the global cache we need to track the goals for which the
        // global cache has been disabled as it may otherwise change the result for
        // cyclic goals. We don't care about goals which are not on the current stack
        // so it's fine to drop their scope eagerly.
        const expected = this.lookup_global_cache_untracked(cx, input, step_kind_from_parent, available_depth);
        // .inspect(|expected| debug!(?expected, "validate cache entry"))
        validate_cache = expected !== undefined ? [scope, expected] : undefined;
      } else {
        const result = this.lookup_global_cache(cx, input, step_kind_from_parent, available_depth);
        if (result !== undefined) {
          return result;
        } else {
          validate_cache = undefined;
        }
      }
    }

    // Detect cycles on the stack. We do this after the global cache lookup to
    // avoid iterating over the stack in case a goal has already been computed.
    // This may not have an actual performance impact and we could reorder them
    // as it may reduce the number of `nested_goals` we need to track.
    {
      const result = this.check_cycle_on_stack(cx, input, step_kind_from_parent, available_depth);
      if (result !== undefined) {
        // debug_assert!(validate_cache.is_none(), "global cache and cycle on stack: {input:?}");
        return result;
      }
    }

    // Unfortunate, it looks like we actually have to compute this goal.
    this.stack.push(
      new StackEntry<X>(
        input,
        step_kind_from_parent,
        available_depth,
        available_depth, // min_reached_available_depth
        undefined, // provisional_result
        CycleHeads.default_(),
        false,
        undefined,
        undefined,
        NestedGoals.default_(),
      ),
    );

    // This is for global caching, so we properly track query dependencies.
    // Everything that affects the `result` should be performed within this
    // `with_cached_task` closure. If computing this goal depends on something
    // not tracked by the cache key and from outside of this anon task, it
    // must not be added to the global cache. Notably, this is the case for
    // trait solver cycles participants.
    const [evaluation_result, dep_node] = D.Cx.with_cached_task(cx, () =>
      this.evaluate_goal_in_task(cx, input, inspect),
    );

    // We've finished computing the goal and have popped it from the stack,
    // lazily update its parent goal.
    SearchGraph.update_parent_goal(
      this.stack,
      step_kind_from_parent,
      evaluation_result.heads.iter(),
      evaluation_result.encountered_overflow,
      { $: "Ordinary", nested_goals: evaluation_result.nested_goals },
      AvailableDepth.sub(available_depth, evaluation_result.required_depth),
    );
    const result = evaluation_result.result;

    // We're now done with this goal. We only add the root of cycles to the global cache.
    // In case this goal is involved in a larger cycle add it to the provisional cache.
    if (evaluation_result.heads.is_empty()) {
      if (validate_cache !== undefined) {
        const [_scope, expected] = validate_cache;
        // Do not try to move a goal into the cache again if we're testing
        // the global cache.
        assert_eq_msg(expected, result, D.Cx.Result_eq, D.Cx.debug_Result, () => `input=${D.Cx.debug_Input(input, PLAIN)}`);
      } else if (D.inspect_is_noop(inspect)) {
        this.insert_global_cache(cx, input, evaluation_result, dep_node);
      }
    } else if (D.ENABLE_PROVISIONAL_CACHE) {
      // debug_assert!(validate_cache.is_none(), "unexpected non-root: {input:?}");
      // `self.provisional_cache.entry(input).or_default()`
      let entry = this.provisional_cache.get(input);
      if (entry === undefined) {
        entry = [];
        this.provisional_cache.set(input, entry);
      }
      const { encountered_overflow, required_depth: _, heads, nested_goals: _ng, result } = evaluation_result;
      const path_from_head = SearchGraph.cycle_path_kind(
        this.stack,
        step_kind_from_parent,
        heads.highest_cycle_head_index(),
      );
      const provisional_cache_entry: ProvisionalCacheEntry<X> = {
        encountered_overflow,
        heads,
        path_from_head,
        result,
      };
      // debug!(?provisional_cache_entry);
      entry.push(provisional_cache_entry);
    } else {
      // debug_assert!(validate_cache.is_none(), "unexpected non-root: {input:?}");
    }

    return result;
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:936 handle_overflow
  handle_overflow(cx: X["Self"], input: X["Input"]): X["Result"] {
    const last = this.stack.last_mut();
    if (last !== undefined) {
      last.encountered_overflow = true;
      // If computing a goal `B` depends on another goal `A` and
      // `A` has a nested goal which overflows, then computing `B`
      // at the same depth, but with `A` already on the stack,
      // would encounter a solver cycle instead, potentially
      // changing the result.
      //
      // We must therefore not use the global cache entry for `B` in that case.
      // See tests/ui/traits/next-solver/cycles/hidden-by-overflow.rs
      last.nested_goals.insert(last.input, PathsToNested.EMPTY);
    }

    // debug!("encountered stack overflow");
    return this._marker.stack_overflow_result(cx, input);
  }

  /// When reevaluating a goal with a changed provisional result, all provisional cache entry
  /// which depend on this goal get invalidated.
  ///
  /// Note that we keep provisional cache entries which accessed this goal as a cycle head, but
  /// don't depend on its value.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:959 clear_dependent_provisional_results_for_rerun
  clear_dependent_provisional_results_for_rerun(): void {
    const rerun_index = this.stack.next_index();
    // Each cached entry is filtered independently based on whether it depends on
    // `rerun_index`, so bucket traversal order does not matter.
    map_retain(this.provisional_cache, (_, entries) => {
      vec_retain_mut(entries, (entry) => {
        const [head_index, head] = entry.heads.highest_cycle_head();
        return head_index !== rerun_index || head.usages.is_empty();
      });
      return entries.length !== 0;
    });
  }

  /// A necessary optimization to handle complex solver cycles. A provisional cache entry
  /// relies on a set of cycle heads and the path towards these heads. When popping a cycle
  /// head from the stack after we've finished computing it, we can't be sure that the
  /// provisional cache entry is still applicable. We need to keep the cache entries to
  /// prevent hangs.
  ///
  /// This can be thought of as pretending to reevaluate the popped head as nested goals
  /// of this provisional result. For this to be correct, all cycles encountered while
  /// we'd reevaluate the cycle head as a nested goal must keep the same cycle kind.
  /// [rustc-dev-guide chapter](https://rustc-dev-guide.rust-lang.org/solve/caching.html).
  ///
  /// In case the popped cycle head failed to reach a fixpoint anything which depends on
  /// its provisional result is invalid. Actually discarding provisional cache entries in
  /// this case would cause hangs, so we instead change the result of dependant provisional
  /// cache entries to also be ambiguous. This causes some undesirable ambiguity for nested
  /// goals whose result doesn't actually depend on this cycle head, but that's acceptable
  /// to me.
  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1013 rebase_provisional_cache_entries
  rebase_provisional_cache_entries(stack_entry: StackEntry<X>, rebase_reason: RebaseReason<X>): void {
    const D = this._marker;
    const popped_head_index = this.stack.next_index();
    // Rebasing decisions depend only on each provisional entry and the current stack state,
    // so traversing the cache in hash order cannot change the final cache contents.
    map_retain(this.provisional_cache, (_input, entries) => {
      vec_retain_mut(entries, (entry) => {
        const { heads, path_from_head, result } = entry;
        let popped_head: CycleHead;
        if (heads.highest_cycle_head_index() === popped_head_index) {
          popped_head = heads.remove_highest_cycle_head();
        } else {
          // debug_assert!(heads.highest_cycle_head_index() < popped_head_index);
          return true;
        }

        // We're rebasing an entry `e` over a head `p`. This head
        // has a number of own heads `h` it depends on.
        //
        // This causes our provisional result to depend on the heads
        // of `p` to avoid moving any goal which uses this cache entry to
        // the global cache.
        if (popped_head.usages.is_empty()) {
          // The result of `e` does not depend on the value of `p`. This we can
          // keep using the result of this provisional cache entry even if evaluating
          // `p` as a nested goal of `e` would have a different result.
          for (const [head_index, _] of stack_entry.heads.iter()) {
            heads.insert(head_index, PathsToNested.EMPTY, HeadUsages.default_());
          }
        } else {
          // The entry `e` actually depends on the value of `p`. We need
          // to make sure that the value of `p` wouldn't change even if we
          // were to reevaluate it as a nested goal of `e` instead. For this
          // we check that the path kind of all paths `hph` remain the
          // same after rebasing.
          //
          // After rebasing the cycles `hph` will go through `e`. We need to make
          // sure that forall possible paths `hep`, `heph` is equal to `hph.`
          const ep = popped_head.paths_to_head;
          for (const [head_index, head] of stack_entry.heads.iter()) {
            const ph = head.paths_to_head;
            const hp = SearchGraph.cycle_path_kind(this.stack, stack_entry.step_kind_from_parent, head_index);
            // We first validate that all cycles while computing `p` would stay
            // the same if we were to recompute it as a nested goal of `e`.
            const he = PathKind.extend(hp, path_from_head);
            // PORT: the loop variables shadow `ph` / `ep` upstream; a JS `for..of` binding is in its TDZ while its
            // iterable is evaluated, so they are `ph_` / `ep_`.
            for (const ph_ of PathsToNested.iter_paths(ph)) {
              const hph = PathKind.extend(hp, ph_);
              for (const ep_ of PathsToNested.iter_paths(ep)) {
                const hep = PathKind.extend(ep_, he);
                const heph = PathKind.extend(hep, ph_);
                if (hph !== heph) {
                  return false;
                }
              }
            }

            // If so, all paths reached while computing `p` have to get added
            // the heads of `e` to make sure that rebasing `e` again also considers
            // them.
            const eph = PathsToNested.extend_with_paths(ep, ph);
            heads.insert(head_index, eph, head.usages);
          }

          // The provisional cache entry does depend on the provisional result
          // of the popped cycle head. In case we didn't actually reach a fixpoint,
          // we must not keep potentially incorrect provisional cache entries around.
          switch (rebase_reason.$) {
            // If the cycle head does not actually depend on itself, then
            // the provisional result used by the provisional cache entry
            // is not actually equal to the final provisional result. We
            // need to discard the provisional cache entry in this case.
            case "NoCycleUsages":
              return false;
            // If we avoid rerunning a goal due to ambiguity, we only keep provisional
            // results which depend on that cycle head if these are already ambiguous
            // themselves.
            case "Ambiguity": {
              const kind = rebase_reason._0;
              const k = D.is_ambiguous_result(result);
              if (!(k !== undefined && D.Cx.AmbiguityKind_eq(k, kind))) {
                return false;
              }
              break;
            }
            case "ReachedFixpoint": {
              const path_kind = rebase_reason._0;
              if (path_kind === undefined) {
                // RebaseReason::ReachedFixpoint(None) => {}
              } else if (!popped_head.usages.is_single(path_kind)) {
                return false;
              }
              break;
            }
          }
        }

        const new_highest_head_index = heads.opt_highest_cycle_head_index();
        if (new_highest_head_index === undefined) {
          return false;
        }

        // We now care about the path from the next highest cycle head to the
        // provisional cache entry.
        entry.path_from_head = PathKind.extend(
          path_from_head,
          SearchGraph.cycle_path_kind(this.stack, stack_entry.step_kind_from_parent, new_highest_head_index),
        );

        // trace!(?input, ?entry, "rebased provisional cache entry");

        return true;
      });
      return entries.length !== 0;
    });
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1134 lookup_provisional_cache
  lookup_provisional_cache(
    input: X["Input"],
    step_kind_from_parent: PathKind,
    available_depth: AvailableDepth,
  ): X["Result"] | undefined {
    if (!this._marker.ENABLE_PROVISIONAL_CACHE) {
      return undefined;
    }

    const entries = this.provisional_cache.get(input);
    if (entries === undefined) return undefined;
    for (const { encountered_overflow, heads, path_from_head, result } of entries) {
      const head_index = heads.highest_cycle_head_index();
      if (encountered_overflow) {
        // This check is overly strict and very subtle. We need to make sure that if
        // a global cache entry depends on some goal without adding it to its
        // `nested_goals`, that goal must never have an applicable provisional
        // cache entry to avoid incorrectly applying the cache entry.
        //
        // As we'd have to otherwise track literally all nested goals, we only
        // apply provisional cache entries which encountered overflow once the
        // current goal is already part of the same cycle. This check could be
        // improved but seems to be good enough for now.
        const last = unwrap(this.stack.last());
        const lowest = last.heads.opt_lowest_cycle_head_index();
        if (lowest === undefined || lowest > head_index) {
          continue;
        }
      }

      // A provisional cache entry is only valid if the current path from its
      // highest cycle head to the goal is the same.
      if (path_from_head === SearchGraph.cycle_path_kind(this.stack, step_kind_from_parent, head_index)) {
        SearchGraph.update_parent_goal(
          this.stack,
          step_kind_from_parent,
          heads.iter(),
          encountered_overflow,
          { $: "ProvisionalCacheHit" },
          available_depth,
        );
        // debug!(?head_index, ?path_from_head, "provisional cache hit");
        return result;
      }
    }

    return undefined;
  }

  /// Even if there is a global cache entry for a given goal, we need to make sure
  /// evaluating this entry would not have ended up depending on either a goal
  /// already on the stack or a provisional cache entry.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1190 candidate_is_applicable
  candidate_is_applicable(step_kind_from_parent: PathKind, nested_goals: NestedGoals<X>): boolean {
    // If the global cache entry didn't depend on any nested goals, it always
    // applies.
    if (nested_goals.is_empty()) {
      return true;
    }

    // If a nested goal of the global cache entry is on the stack, we would
    // definitely encounter a cycle.
    if (this.stack.iter().some((e) => nested_goals.contains(e.input))) {
      // debug!("cache entry not applicable due to stack");
      return false;
    }

    // The global cache entry is also invalid if there's a provisional cache entry
    // would apply for any of its nested goals.
    // Any matching provisional entry rejects the candidate,
    // so iteration order only affects when we return `false`, not the final answer.
    for (const [input, path_from_global_entry] of nested_goals.iter()) {
      const entries = this.provisional_cache.get(input);
      if (entries === undefined) {
        continue;
      }

      // debug!(?input, ?path_from_global_entry, ?entries, "candidate_is_applicable");
      // A provisional cache entry is applicable if the path to
      // its highest cycle head is equal to the expected path.
      for (const { encountered_overflow, heads, path_from_head: head_to_provisional } of entries) {
        // We don't have to worry about provisional cache entries which encountered
        // overflow, see the relevant comment in `lookup_provisional_cache`.
        if (encountered_overflow) {
          continue;
        }

        // A provisional cache entry only applies if the path from its highest head
        // matches the path when encountering the goal.
        //
        // We check if any of the paths taken while computing the global goal
        // would end up with an applicable provisional cache entry.
        const head_index = heads.highest_cycle_head_index();
        const head_to_curr = SearchGraph.cycle_path_kind(this.stack, step_kind_from_parent, head_index);
        const full_paths = PathsToNested.extend_with(path_from_global_entry, head_to_curr);
        if (PathsToNested.contains(full_paths, PathsToNested.from_PathKind(head_to_provisional))) {
          // debug!(?full_paths, ?head_to_provisional, "cache entry not applicable due to matching paths");
          return false;
        }
      }
    }

    return true;
  }

  /// Used when fuzzing the global cache. Accesses the global cache without
  /// updating the state of the search graph.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1259 lookup_global_cache_untracked
  lookup_global_cache_untracked(
    cx: X["Self"],
    input: X["Input"],
    step_kind_from_parent: PathKind,
    available_depth: AvailableDepth,
  ): X["Result"] | undefined {
    const X_cx = this._marker.Cx;
    return X_cx.with_global_cache(cx, (cache) => {
      const c: CacheData<X> | undefined = cache.get(
        cx,
        input,
        available_depth,
        (nested_goals) => this.candidate_is_applicable(step_kind_from_parent, nested_goals),
        X_cx,
      );
      return c === undefined ? undefined : c.result;
    });
  }

  /// Try to fetch a previously computed result from the global cache,
  /// making sure to only do so if it would match the result of reevaluating
  /// this goal.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1278 lookup_global_cache
  lookup_global_cache(
    cx: X["Self"],
    input: X["Input"],
    step_kind_from_parent: PathKind,
    available_depth: AvailableDepth,
  ): X["Result"] | undefined {
    const X_cx = this._marker.Cx;
    return X_cx.with_global_cache(cx, (cache) => {
      const c = cache.get(
        cx,
        input,
        available_depth,
        (nested_goals) => this.candidate_is_applicable(step_kind_from_parent, nested_goals),
        X_cx,
      );
      if (c === undefined) return undefined;
      const { result, required_depth, encountered_overflow, nested_goals } = c;

      // We don't move cycle participants to the global cache, so the
      // cycle heads are always empty.
      const heads: [StackDepth, CycleHead][] = [];
      SearchGraph.update_parent_goal(
        this.stack,
        step_kind_from_parent,
        heads,
        encountered_overflow,
        { $: "Ordinary", nested_goals },
        AvailableDepth.sub(available_depth, required_depth),
      );

      // debug!(?required_depth, "global cache hit");
      return result;
    });
  }

  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1308 check_cycle_on_stack
  check_cycle_on_stack(
    cx: X["Self"],
    input: X["Input"],
    step_kind_from_parent: PathKind,
    available_depth: AvailableDepth,
  ): X["Result"] | undefined {
    const head_index = this.stack.find(input);
    if (head_index === undefined) return undefined;
    // We have a nested goal which directly relies on a goal deeper in the stack.
    //
    // We start by tagging all cycle participants, as that's necessary for caching.
    //
    // Finally we can return either the provisional response or the initial response
    // in case we're in the first fixpoint iteration for this goal.
    const path_kind = SearchGraph.cycle_path_kind(this.stack, step_kind_from_parent, head_index);
    // debug!(?path_kind, "encountered cycle with depth {head_index:?}");
    const usages = HeadUsages.default_();
    usages.add_usage(path_kind);
    const head: CycleHead = { paths_to_head: PathsToNested.from_PathKind(step_kind_from_parent), usages };
    SearchGraph.update_parent_goal(
      this.stack,
      step_kind_from_parent,
      [[head_index, head]],
      false,
      { $: "CycleOnStack", head: input },
      available_depth,
    );

    // Return the provisional result or, if we're in the first iteration,
    // start with no constraints.
    const result = this.stack.index(head_index).provisional_result;
    if (result !== undefined) {
      return result;
    } else {
      return this._marker.initial_provisional_result(cx, path_kind, input);
    }
  }

  /// Whether we've reached a fixpoint when evaluating a cycle head.
  // #[instrument(level = "trace", skip(self, stack_entry), ret)]
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1347 reached_fixpoint
  reached_fixpoint(
    stack_entry: StackEntry<X>,
    usages: HeadUsages,
    result: X["Result"],
  ): Result<PathKind | undefined, null> {
    const D = this._marker;
    const provisional_result = stack_entry.provisional_result;
    if (provisional_result !== undefined) {
      if (D.Cx.Result_eq(provisional_result, result)) {
        return Ok(undefined);
      } else {
        return Err(null);
      }
    } else {
      const path_kind = D.is_initial_provisional_result(result);
      if (path_kind !== undefined && usages.is_single(path_kind)) {
        return Ok(path_kind);
      } else {
        return Err(null);
      }
    }
  }

  /// When we encounter a coinductive cycle, we have to fetch the
  /// result of that cycle while we are still computing it. Because
  /// of this we continuously recompute the cycle until the result
  /// of the previous iteration is equal to the final result, at which
  /// point we are done.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1370 evaluate_goal_in_task
  evaluate_goal_in_task(cx: X["Self"], input: X["Input"], inspect: D["ProofTreeBuilder"]): EvaluationResult<X> {
    const D = this._marker;
    // We reset `encountered_overflow` each time we rerun this goal
    // but need to make sure we currently propagate it to the global
    // cache even if only some of the evaluations actually reach the
    // recursion limit.
    let encountered_overflow = false;
    let i = 0;
    for (;;) {
      const result = D.compute_goal(this, cx, input, inspect);
      const stack_entry = this.stack.pop();
      encountered_overflow ||= stack_entry.encountered_overflow;
      // debug_assert_eq!(stack_entry.input, input);

      // If the current goal is not a cycle head, we are done.
      //
      // There are no provisional cache entries which depend on this goal.
      const usages = stack_entry.usages;
      if (usages === undefined) {
        return EvaluationResult.finalize(stack_entry, encountered_overflow, result);
      }

      // If it is a cycle head, we have to keep trying to prove it until
      // we reach a fixpoint. We need to do so for all cycle heads,
      // not only for the root.
      //
      // See tests/ui/traits/next-solver/cycles/fixpoint-rerun-all-cycle-heads.rs
      // for an example.
      //
      // Check whether we reached a fixpoint, either because the final result
      // is equal to the provisional result of the previous iteration, or because
      // this was only the head of either coinductive or inductive cycles, and the
      // final result is equal to the initial response for that case.
      const fixpoint = this.reached_fixpoint(stack_entry, usages, result);
      if (fixpoint.$ === "Ok") {
        this.rebase_provisional_cache_entries(stack_entry, { $: "ReachedFixpoint", _0: fixpoint._0 });
        return EvaluationResult.finalize(stack_entry, encountered_overflow, result);
      } else if (usages.is_empty()) {
        this.rebase_provisional_cache_entries(stack_entry, { $: "NoCycleUsages" });
        return EvaluationResult.finalize(stack_entry, encountered_overflow, result);
      }

      // If computing this goal results in ambiguity with no constraints,
      // we do not rerun it. It's incredibly difficult to get a different
      // response in the next iteration in this case. These changes would
      // likely either be caused by incompleteness or can change the maybe
      // cause from ambiguity to overflow. Returning ambiguity always
      // preserves soundness and completeness even if the goal could
      // otherwise succeed or fail.
      //
      // This prevents exponential blowup affecting multiple major crates.
      // As we only get to this branch if we haven't yet reached a fixpoint,
      // we also taint all provisional cache entries which depend on the
      // current goal.
      const kind = D.is_ambiguous_result(result);
      if (kind !== undefined) {
        this.rebase_provisional_cache_entries(stack_entry, { $: "Ambiguity", _0: kind });
        return EvaluationResult.finalize(stack_entry, encountered_overflow, result);
      }

      // If we've reached the fixpoint step limit, we bail with overflow and taint all
      // provisional cache entries which depend on the current goal.
      i += 1;
      if (i >= D.FIXPOINT_STEP_LIMIT) {
        // debug!("canonical cycle overflow");
        const result = D.fixpoint_overflow_result(cx, input);
        this.rebase_provisional_cache_entries(stack_entry, {
          $: "Ambiguity",
          _0: D.FIXPOINT_OVERFLOW_AMBIGUITY_KIND,
        });
        return EvaluationResult.finalize(stack_entry, encountered_overflow, result);
      }

      // Clear all provisional cache entries which depend on a previous provisional
      // result of this goal and rerun. This does not remove goals which accessed this
      // goal without depending on its result.
      this.clear_dependent_provisional_results_for_rerun();

      // debug!(?result, "fixpoint changed provisional results");
      this.stack.push(
        new StackEntry<X>(
          input,
          stack_entry.step_kind_from_parent,
          stack_entry.available_depth,
          // We can keep these goals from previous iterations as they are only
          // ever read after finalizing this evaluation.
          stack_entry.min_reached_available_depth,
          result, // provisional_result: Some(result)
          stack_entry.heads,
          // We reset these two fields when rerunning this goal. We could
          // keep `encountered_overflow` as it's only used as a performance
          // optimization. However, given that the proof tree will likely look
          // similar to the previous iterations when reevaluating, it's better
          // for caching if the reevaluation also starts out with `false`.
          false,
          // We keep provisional cache entries around if they used this goal
          // without depending on its result.
          //
          // We still need to drop or rebase these cache entries once we've
          // finished evaluating this goal.
          HeadUsages.default_(),
          undefined,
          stack_entry.nested_goals,
        ),
      );
    }
  }

  /// When encountering a cycle, both inductive and coinductive, we only
  /// move the root into the global cache. We also store all other cycle
  /// participants involved.
  ///
  /// We must not use the global cache entry of a root goal if a cycle
  /// participant is on the stack. This is necessary to prevent unstable
  /// results. See the comment of `StackEntry::nested_goals` for
  /// more details.
  // rustc: compiler/rustc_type_ir/src/search_graph/mod.rs:1488 insert_global_cache
  insert_global_cache(
    cx: X["Self"],
    input: X["Input"],
    evaluation_result: EvaluationResult<X>,
    dep_node: X["DepNodeIndex"],
  ): void {
    // debug!(?evaluation_result, "insert global cache");
    const X_cx = this._marker.Cx;
    X_cx.with_global_cache(cx, (cache) => cache.insert(cx, input, evaluation_result, dep_node, X_cx));
  }
}

