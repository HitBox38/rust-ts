# Handoff: bck-polonius (M4 wave 23 borrowck fill, second batch): polonius "next"

Branch `lane/bck-polonius` (from `f0e9a0cf` on integ-w19, no merges). All 39 stubs of the row are filled, in upstream
order, with `// rustc:` markers: upstream `compiler/rustc_borrowck/src/polonius/{mod, constraints, liveness,
liveness_constraints, dump}.rs` (the in-tree `-Zpolonius=next`; legacy stays wave 26).

## Files touched
- `src/rustc_borrowck/polonius/mod.ts`: `LiveLoans::{new, insert, contains}`, `PoloniusContext::compute_loan_liveness`,
  `LivenessSource_DeferredLivenessSource.liveness_for_region`, `LocalizedConstraintGraphVisitor_LoanLivenessVisitor.on_node_traversed`.
- `src/rustc_borrowck/polonius/constraints.ts`: the provided (empty) visitor methods, `LocalizedConstraintGraph::{new,
  traverse}`; new exported helper `LocalizedNode_key`.
- `src/rustc_borrowck/polonius/liveness.ts`: `RegionLiveness::{new, is_live_at}`, `DeferredRegionLiveness::{defer_local,
  ensure_deferred_liveness}`.
- `src/rustc_borrowck/polonius/liveness_constraints.ts`: `record_live_region_variance`, `VarianceExtractor` (record_variance
  + the `TypeRelation` impl).
- `src/rustc_borrowck/polonius/dump.ts`: every fn of dump.rs, plus `TEMPLATE` (the text of
  `polonius/dump/polonius-mir-dump.template.html`, byte for byte; a unit test compares it with the upstream file).
- `src/rustc_borrowck/polonius/polonius_next.test.ts` (new, 7 tests, see Checks).
- `src/rustc_borrowck/contract.test.ts`: row `bck-polonius` removed (comment left), markers 397 → **436** (+39), stubs
  504 → **465** (−39). Other lanes edit the same numbers: merge by deltas.

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/polonius/<f>.rs`)
mod 6/6, constraints 4/4, liveness 5/5 (incl. the contract's trait-method marker), liveness_constraints 9/9, dump 16/16.
`bun scripts/coverage.ts --check`: markers ok (21275; vendor 4330).

## When these paths run (from upstream, at the pin)
- `Polonius::DEFAULT` (rustc_session config.rs:3693) is `Next` iff rustc was built with `CFG_DEFAULT_POLONIUS_NEXT`; the
  oracle's `-Z help` says `(default: next)` and rust-ts's config.ts sets it, so **every borrowck run uses next unless
  `-Zpolonius=off|no` (NLL) or `-Zpolonius` / `-Zpolonius=legacy`** (options.rs:1001 `parse_polonius`).
- With next: type_check/mod.rs:140 creates the `PoloniusContext` (derived `Default`); type_check/liveness/mod.rs:270
  (`LiveVariablesVisitor`) and trace.rs:347/414 call `record_live_region_variance` for every live type; when the body has
  at least one borrow, liveness/mod.rs:72 defers the NLL-boring / polonius-relevant locals and trace.rs:223/267 call
  `DeferredRegionLiveness::defer_local`; nll.rs:151 calls `compute_loan_liveness` (it builds and traverses the localized
  constraint graph only if `borrow_set.len() > 0`; `ensure_deferred_liveness` runs lazily during that traversal);
  dataflow.rs:388 `Borrows::new` takes `PoloniusOutOfScopePrecomputer` (bck-core), which reads
  `LivenessValues::is_loan_live_at` → `LiveLoans::contains`. So, by default, everything in this lane except dump.rs runs
  on every body with a borrow (variance recording on every body).
- dump.rs: lib.rs:449 always calls `dump_polonius_mir`; it returns at once unless next is enabled **and**
  `MirDumper::new(tcx, "polonius", body)` is `Some`, i.e. `-Zdump-mir=<filter>` where a filter is `all`, a substring of
  `polonius`, or a substring of the body's def path (pretty.rs:82). Then it writes `<..>.polonius.0.html` (not
  `-Zdump-mir=nll`: "polonius" does not contain "nll").
- explain_borrow.rs:635 asserts next is off when there is no polonius context (bck-diag-f).

## Runtime reach today
Not reached by any sampled case: borrowck stops earlier, inside `type_check` (`UniverseInfo::relate`, bck-diag-f; 209 of
300 borrowck-ui) or `OutlivesConstraintSet::push` (bck-regions-b; 74), or `polonius_engine::AllFacts::default` (legacy
revisions, wave 26; 12). The first lane fn on the path will be `record_live_region_variance` (type_check liveness), then
`compute_loan_liveness` from `nll::compute_regions`. No runtime stop moved; nothing to re-pin.
Stubs of other lanes that these paths call next: none in this lane's code (`LivenessComputation::{new, compute}`
bck-tc-live, `UniversalRegions::{is_universal_region, to_region_vid}` bck-nll, `LivenessValues` bck-regions-a,
`MirDumper` / `emit_nll_mir` / regioncx accessors are all ported). `dump_polonius_mir`'s regioncx calls
(`region_definition`, `constraint_sccs_`, `outlives_constraints`, `liveness_constraints_`) are ported (bck-regions-a).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: ok.
- `bun test src/rustc_borrowck`: 17 pass + 1 fail = the known `contract.test.ts` runtime-stop test (unchanged; not
  this lane's pin). The fresh-entry test (62 hand modules) passes.
- `polonius_next.test.ts` (7 pass): `TEMPLATE` equals the upstream file; `LiveLoans` packing; `RegionLiveness`
  directions (universal → Forward, recorded variance, missing → Bidirectional) and `is_live_at`;
  `LocalizedConstraintGraph::new` (physical / logical edges, dedup) and `traverse` on built MIR of a no_core crate with
  the dump collector (exact DFS reachability order and discovered constraints, worked out by hand) and the loan-liveness
  visitor, forward / backward edges across a call's return and unwind blocks; `record_live_region_variance`
  (`&'?1 mut &'?2 u8` → Forward / Bidirectional, erased regions skipped); `defer_local` + `ensure_deferred_liveness`
  (computes once, from the first region).
- Full unit suite (`RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`, `RUST_TS_AGENT=bck-polonius`, run once at
  the end): **6119 pass, 1 skip, 25 fail** (6145 tests, 447 files). The 25 failures are exactly the base's known list:
  symbol_names.oracle (7), compare_impl_item.oracle (11), collect.test misc (1), rustc_borrowck/contract runtime-stop (1),
  late_c.oracle (1), late_e2.oracle (1), interpret/place_operand (1), interpret/contract runtime-stop (1),
  interpret/operator_cast.oracle (1). No new failure; `polonius_next.test.ts` passes.

## Sample difftests (`RUST_TS_AGENT=root-f5de`, vs the given base runs, same samples)
| suite | lane run | M / D / U / C / T / UNSTABLE | base run | M / D / U / C / T / UNSTABLE |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-233031-root-f5de-6h9z` | 45 / 0 / 1 / 0 / 0 / 0 | `20261022-210451-root-f5de-wos5` | 45 / 0 / 1 / 0 / 0 / 0 |
| mirdump-minicore (46) | `20261022-233054-root-f5de-n26v` | 45 / 0 / 1 / 0 / 0 / 0 | `20261022-210534-root-f5de-p8q4` | 45 / 0 / 1 / 0 / 0 / 0 |
| tydump-ui `--sample 300` | `20261022-233119-root-f5de-wq3g` | 261 / 0 / 37 / 0 / 0 / 2 | `20261022-210624-root-f5de-zjq3` | same, case for case |
| mirdump-ui `--sample 300` | `20261022-233413-root-f5de-vu9x` | 271 / 0 / 29 / 0 / 0 / 0 | `20261022-211125-root-f5de-mzgb` | 269 / 0 / 31 / 0 / 0 / 0 |
| borrowck-ui `--sample 300` | `20261022-233808-root-f5de-cfib` | 0 / 0 / 300 / 0 / 0 / 0 | `20261022-211729-root-f5de-86qn` | 0 / 0 / 300 / 0 / 0 / 0 |

Per case: **no MATCH lost, no new DIFF / CRASH / TIMEOUT**. The two mirdump-ui gains (`tests/ui/mir/issue-76248.rs`,
`mir-inlining/ice-issue-77564.rs`) stopped at CTFE `eval_in_interpreter` in the base run: the newer base tree (ctfe-a),
not this lane. borrowck-ui stop messages moved from `replace_regions_in_mir` (base run, older tree) to the stops listed
under "Runtime reach", all before this lane's code.

## `unported(...)` left
None in the lane's files.

## `// PORT:` decisions
- dump.ts: `TEMPLATE` carries a `// rustc-const: compiler/rustc_borrowck/src/polonius/dump.rs:26 TEMPLATE = include_str!(..)`
  marker, **not** `// rustc:` as the assignment asked: `coverage.ts --check` accepts `// rustc:` only on upstream fns
  ("marker ... matches no upstream fn"); root may add a const-marker kind to the script. Template literal with only
  `` ` `` / `${` escaped. `writeln!` / `write!` → `write_fmt` of the rendered text, `?` → early `return r`;
  `String::from_utf8_lossy` is a local copy of pretty.ts's (unexported) `TextDecoder` helper; the HTML escape writes per
  char as upstream; `FxHashSet<(RegionVid, RegionVid)>` is a `Set` of `"sup,sub"` strings (membership only);
  `sort_by_key` = stable `Array.sort` on `(min, max)`, `dedup_by_key` inlined; `FxIndexMap`/`FxIndexSet` = insertion-ordered
  `Map`/`Set`; the `DumpFile`'s `drop()` through a structural cast, as nll.ts; rustc_session entered through lib.ts.
- constraints.ts: `FxHashMap<LocalizedNode, ..>` / `FxHashSet<LocalizedNode>` are `KeyedMap` / `KeyedSet` keyed by
  `LocalizedNode_key` (`"region:point"`; a number key `region * 2^32 + point` would not stay exact for every
  `RegionVid`); `SmallVec::contains` = `includes`; `node.point + 1` = `PointIndex.from_usize` (the newtype `Add<usize>`);
  the `successor_found` closure is per popped node, as upstream.
- liveness.ts: `IndexVec::insert` / `remove` through rustc_index's `IndexVec` helpers; the `debug_assert!` of `defer_local`
  is a comment; `RegionLiveness.live_points` is the matrix row itself (header note corrected: the generated type is
  `IntervalSet`, not `Set`).
- liveness_constraints.ts: `ensure_contains_elem` returns the element, so the slot is written back by index;
  `assert_eq!` via std/panic `assert_eq` with the type's Debug; `relate_with_variance` does not restore the ambient variance
  on `Err` (as upstream's `?`).
- mod.ts: `std::mem::take(&mut self.deferred_liveness)` leaves a fresh `DeferredRegionLiveness([], [])`;
  `&mut self.live_region_variances` is the same array; `Option::expect` = `unwrap(v, msg)`.

## For root / other lanes
- Root: decide whether `coverage.ts` should get a `// rustc-const:` (or similar) marker kind for ported consts /
  `include_str!` data (dump.ts:`TEMPLATE` is the first). Not required for this lane's checks.
- No shared files edited (only this row's files + the contract test's counts + a new test file). No signature changed.
