# Handoff: polonius-legacy, part 1 of 2 (vendor datafrog 2.0.1 + polonius-engine 0.13.0)

Branch `lane/polonius-legacy`, based on d73c43b4 (integ-w26). No merges.

Both crates are vendored in full, at the versions in upstream's Cargo.lock:

| crate | fns | notes |
|---|---|---|
| datafrog 2.0.1 | 107/107 | includes src/test.rs; `examples/*.rs` `main` are `crate-skip` (example binaries, as for anstream/termize) |
| polonius-engine 0.13.0 | 25/25 | includes `output/mod.rs` `mod tests` |

`bun scripts/coverage.ts --check`: `markers ok (22756; vendor 4483)`. Typecheck (`bunx tsc --noEmit -p .`) is clean.

They are checked against the oracle's own copies of both crates (the ones linked into librustc_driver) by a new
rustc-dev probe:
- 400 seeded fact sets x 5 `Algorithm`s x `dump_enabled` off/on = 4000 `Output::compute` runs. Every `Output` field
  is identical, including `Vec` value order and `BTreeSet`/`BTreeMap` order.
- 100 datafrog `reachable_with_var_join` runs: identical.
- Mutation check: making `ExtendAnti::intersect` keep every value fails the facts test immediately.

Nothing in the compiler imports the new code yet, so compiler behaviour is unchanged. Part 2 wires it in.

## Files (all new, except `harness/scope.json`)
- `harness/scope.json` `vendor`: `"datafrog": "=2.0.1"`, `"polonius-engine": "=0.13.0"` (assigned).
- `src/vendor/datafrog/`: `lib.ts`, `join.ts`, `map.ts`, `treefrog.ts`, `test.test.ts`.
  - `test.test.ts` holds test.rs. Its proptests run as 64 seeded cases each (mulberry32); the three `lib.rs`
    doc-tests are added at the end.
- `src/vendor/polonius_engine/`:
  - `lib.ts`, `facts.ts`;
  - `output/{mod,naive,datafrog_opt,location_insensitive,liveness,initialization}.ts`;
  - `output/mod.test.ts`: `test_compare_errors`;
  - `polonius.oracle.test.ts`: the probe comparisons; a visible SKIP if the probe is not built.
- `tools/probes/polonius/{Cargo.toml.in,main.rs}`: the rustc-dev probe, using `extern crate polonius_engine` and
  `extern crate datafrog` from the oracle sysroot. Build it with `bun scripts/probes.ts build polonius`. The
  assignment asked for a probe; it touches no runner, script or harness code.

## API for part 2 (rustc_borrowck `polonius/legacy`, `nll.rs`, `lib.rs`, `region_infer`)
```ts
import { AllFacts, Algorithm, Output, type FactTypes } from "../../../vendor/polonius_engine/lib.ts";

// RustcFacts as a FactTypes record (every Atom is a number; newtype_index handles qualify):
interface RustcFactTypes extends FactTypes {
  Origin: PoloniusRegionVid; Loan: BorrowIndex; Point: LocationIndex; Variable: Local; Path: MovePathIndex;
}
type PoloniusFacts = AllFacts<RustcFactTypes>;
type PoloniusOutput = Output<RustcFactTypes>;

const facts: PoloniusFacts = AllFacts.default<RustcFactTypes>();      // facts.rs:93 Default
facts.loan_issued_at.push([origin, loan, point]);                       // fields are mutable arrays of readonly tuples
// The 18 fields, in declaration order:
//   loan_issued_at: [Origin, Loan, Point][]        universal_region: Origin[]
//   cfg_edge: [Point, Point][]                      loan_killed_at: [Loan, Point][]
//   subset_base: [Origin, Origin, Point][]          loan_invalidated_at: [Point, Loan][]
//   var_used_at / var_defined_at / var_dropped_at: [Variable, Point][]
//   use_of_var_derefs_origin / drop_of_var_derefs_origin: [Variable, Origin][]
//   child_path: [Path, Path][]                      path_is_var: [Path, Variable][]
//   path_assigned_at_base / path_moved_at_base / path_accessed_at_base: [Path, Point][]
//   known_placeholder_subset: [Origin, Origin][]    placeholder: [Origin, Loan][]

const alg = Algorithm.from_str(s);          // Result<Algorithm, string>; Err text = upstream's
// Algorithm is "Naive" | "DatafrogOpt" | "LocationInsensitive" | "Compare" | "Hybrid"
// Also: Algorithm.variants(), Algorithm.OPTIMIZED, debug_Algorithm.
const out = Output.compute(facts, alg_value, /* dump_enabled */ false);  // copies the facts it sorts, as upstream clones
out.errors_at(location);                    // readonly Loan[]  (lib.rs:1258)
out.subset_errors;                          // Map<Point, BTreeSet<readonly [Origin, Origin]>>; `.iter()` of a BTreeSet
                                            // gives its sorted elements (region_context.rs check_polonius_subset_errors)
out.loans_in_scope_at(p) / origins_live_at(p) / subsets_at(p) / origin_contains_loan_at_(p)   // debugging accessors
```
- `Output::origin_contains_loan_at` (the method) is `origin_contains_loan_at_`, because a field has the same name.
  rustc never calls it.
- `Output`'s `#[derive(Clone)]` is not ported. `nll.rs`'s `polonius_output.clone()` of the `Box` can share the object:
  it is never mutated after `compute`.

### Stubs part 2 must replace
These are outside `polonius/legacy/`, so part 2 needs ownership of these files:
- `src/rustc_borrowck/lib.ts:352` `PoloniusFacts_default` -> `AllFacts.default()`.
- `src/rustc_borrowck/lib.ts:1172` `PoloniusOutput_errors_at` -> `out.errors_at(location)`.
- `src/rustc_borrowck/nll.ts:177` -> `Output.compute(polonius_facts, unwrap(Algorithm.from_str(algorithm)), false)`.
- `src/rustc_borrowck/region_infer/region_context.ts:1713` `PoloniusOutput_subset_errors` -> iterate
  `out.subset_errors` (`[location, set]` entries; `set.iter()`).
- `src/rustc_borrowck/polonius/legacy/mod.ts:92` `drop_of_var_derefs_origin` push, plus the `facts.ts` stubs
  `PoloniusRegionVid` `index` / `From` (lines 30-46). The local `Atom<T>` interface there can go: the vendored
  `Atom` is just `number`.
- `src/rustc_borrowck/polonius/legacy/facts.gen.ts`: tools/codegen emits `PoloniusFacts = unknown` and
  `PoloniusOutput = unknown`, and makes `RustcFacts` a unit-struct interface. Root or part 2 must teach the codegen to
  map `AllFacts<RustcFacts>` / `Output<RustcFacts>` to the vendored types (with a FactTypes record as above), or
  hand-alias them in `facts.ts`. Do not edit the `.gen.ts` file.

## PORT decisions (all recorded in the file headers)
1. datafrog `Tuple: Ord` is an `Ord` value (`number | undefined | readonly Ord[]`), compared by `cmp`: numbers
   numerically, `()` (`undefined`) always equal, tuples lexicographically (the derived tuple `Ord`). This covers every
   instantiation polonius and rustc use.
2. `Rc<RefCell<..>>` fields of `Variable`: `stable` and `to_add` are shared arrays; `recent` is a `MutRef` cell, because
   `changed` replaces it. `clone()` shares all three, as `Rc` clones do.
3. `&[T]` sub-slices are `[lo, hi)` index ranges. `gallop(slice, lo, hi, cmp)` returns the new start, and treefrog's
   `binary_search` takes a range.
4. `impl JoinInput` is `Variable | Relation`, dispatched by `join.ts` `join_input`. `impl Leapers` is a `LeapersArg`:
   one leaper, or an array of 2..7 leapers for a Rust tuple, dispatched by `treefrog.ts` `into_leapers`. The
   `Leapers` impls are separate objects (`Leapers_for_tuple`, `Leapers_for_ExtendWith`, ...), because their method
   names clash with `Leaper`'s.
5. `usize::max_value()` in treefrog is `Number.MAX_SAFE_INTEGER`; it is only compared with counts.
6. The two `FromIterator` impls of `Relation` are one `Relation.collect`. The inherent `from_iter` calls it.
   `#[derive(Clone)]` of `Relation` is a hand-written `clone()` that copies the `Vec`. Every upstream `.clone()` of
   a fact `Vec` is a `.slice()`, so `from_vec`'s in-place sort never touches caller data.
7. polonius `FxHashMap`/`FxHashSet` (rustc-hash 1.1.0) are JS `Map`/`Set`, so iteration is insertion order, not
   hashbrown order. This is unobservable: rustc only does `errors_at` lookups and iterates `subset_errors`, which it
   then sorts and dedups. `compare_errors` only logs.
8. std `BTreeSet`/`BTreeMap` are small sorted-array classes at the end of `output/mod.ts` (not ported code), ordered
   by datafrog's `cmp`. `.entry(k).or_default()` is `entry_or_default`.
9. `log` macros (`debug!`/`info!`/`error!`) and the `Instant` timers stay comments.
10. `Atom`: `From<usize>`/`Into<usize>`/`index` are the identity. `0.into()` in `LocationInsensitive` is `0 as Point`.
11. `#[derive(Debug, Clone)]` is not ported for `AllFacts` or `Output`; rustc never formats or deep-clones them.
    `debug_Algorithm` is ported.
12. The `InitializationResult` tuple struct has fields `_0`/`_1`. The `TransitivePaths` struct literal evaluates its
    `complete()` calls in written order.

No `unported(...)` calls are left in either crate.

## Verification
- `bun test src/vendor/datafrog src/vendor/polonius_engine`: 13 pass, 0 fail (with the probe built).
- Sample difftests with `RUST_TS_AGENT=root-f5de`, compared case by case with the base runs listed in the
  assignment: **0 MATCH -> other**, no new DIFF or CRASH.
  - tydump-minicore: 46/46 MATCH (`20261028-174217-root-f5de-xxvj`).
  - mirdump-minicore: 46/46 MATCH (`20261028-174233-root-f5de-5p79`).
  - tydump-ui: 295 MATCH, 3 UNPORTED and 2 UNSTABLE, all the same as the base (`20261028-174250-root-f5de-ehxg`).
  - mirdump-ui: 300/300 MATCH (`20261028-174429-root-f5de-r8rm`).
  - borrowck-ui: 288 MATCH, 12 UNPORTED (`20261028-174615-root-f5de-2b8a`). All 12 still stop at
    `polonius_engine::AllFacts::default`, the rustc_borrowck stub that part 2 replaces.
- Full unit suite (`bun test src`, run once, under load from root's gate and other lanes): 6099 pass, 1 skip,
  145 fail, 26 errors, in 5774 s. **All 145 failures are bun's 5 s timeouts.** No failure has another cause.
  They come from 11 files, none of which this lane touched or which import the new code:
  - driver.oracle.test.ts (46), parser/item.test.ts (36), parser/diagnostics.test.ts (23);
  - check_consts/check.oracle.test.ts (16), check_match.oracle.test.ts (12);
  - analysis.oracle.test.ts (4), coroutine/layout.oracle.test.ts (3), odht.oracle.test.ts (2);
  - bit_set/tests.test.ts, mk_const_alloc.oracle.test.ts and edit_distance/tests.test.ts (1 each).
  Re-runs of those files alone: see "Timeout re-runs" below.

## For root
- No runtime stop moved, because nothing imports the new code yet, and no pinned test changed.
- Decision to record: the vendor representation choices above, especially items 1, 4, 7 and 8.

## Timeout re-runs (each file alone, `bun test <file>`, default 5 s timeout)
**Green alone (9 files):**
- bit_set/tests.test.ts: 23/23
- analysis.oracle.test.ts: 4/4
- mk_const_alloc.oracle.test.ts: 1/1
- check_match.oracle.test.ts: 14/14
- coroutine/layout.oracle.test.ts: 3/3
- parser/diagnostics.test.ts: 150/150
- parser/item.test.ts: 56/56
- edit_distance/tests.test.ts: 5/5
- odht.oracle.test.ts: 5/5

**Still timing out (not confirmed):**
- `src/rustc_const_eval/check_consts/check.oracle.test.ts`: 0 pass, 16 fail.
- `src/rustc_driver_impl/driver.oracle.test.ts`: 24 pass, 23 fail.

Every one of those failures is a timeout at about 5000 ms, with no assertion failure. Both files spawn a compiler per
case, and these re-runs overlapped root's full gate on main. Root asked lanes not to start new runs during the gate,
so they were not retried on a quiet machine.

This lane cannot affect them: it adds only new files (`src/vendor/datafrog`, `src/vendor/polonius_engine`,
`tools/probes/polonius`) plus two `harness/scope.json` vendor entries, and no existing module imports the new code.
**Root:** re-run those two files on a quiet machine (or check them in the gate) before merging.
