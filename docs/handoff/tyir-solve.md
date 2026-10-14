# Handoff: tyir-solve (wave 14, M3): rustc_type_ir solve/* and search_graph/*

Branch `lane/tyir-solve` (from main a62a248, no merges). Commits: solve/mod.rs; search_graph; `Cx for I` in
interner.ts; oracle tests; this handoff.

## Files touched
- `src/rustc_type_ir/solve/mod.ts` (hand module of mod.gen.ts): every fn of solve/mod.rs, as companion consts
  that spread the generated ones (tyir-kind decision 1).
- `src/rustc_type_ir/solve/inspect.ts`: unchanged. inspect.rs has no fns; its types are in inspect.gen.ts.
- New `src/rustc_type_ir/search_graph/{mod,stack,global_cache}.ts`: all of search_graph/. The types are written by hand,
  because search_graph is not in codegen set `rustc_ty`.
- `src/rustc_type_ir/interner.ts`: `impl<I: Interner> search_graph::Cx for I` (interner.rs:752) as `Cx_for_Interner` plus
  `InternerCx`. The interner.ts header and ty-contract's handoff assign this to this lane. The edit is additive: the
  end of the file, a few imports, and one header line.
- Tests: `src/rustc_type_ir/search_graph/search_graph.test.ts` (8 tests).
- Oracle files: `src/rustc_type_ir/search_graph/oracle/{main.rs,cases.ts,fixture.txt}`.

## Coverage (`bun scripts/coverage.ts --missing`)
| file | ported |
|---|---|
| solve/mod.rs | 49/49 |
| solve/inspect.rs | 0/0 |
| search_graph/mod.rs | 63/63 |
| search_graph/global_cache.rs | 3/3 |
| search_graph/stack.rs | 13/13 |
| interner.rs | 116/116 (was 111) |

`bun scripts/coverage.ts --check`: `markers ok (9572; vendor 3888)`.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4115 pass, 1 skip (the pre-existing linux-only one),
  0 fail.
- Fresh-process `import()` of every module under `rustc_type_ir/`, `rustc_middle/ty/`, `rustc_middle/traits/` and
  `rustc_middle/lib.ts` works (106 modules). The one exception is `ty_kind.gen.ts`, which is the pre-existing TDZ
  failure documented by tyir-kind.
- No difftest suite reaches the solver yet. As a regression check after the interner.ts import changes,
  `RUST_TS_AGENT=tyir-solve bun scripts/difftest.ts --suite resdump-nocore --sample 100` gave 100/100 MATCH (run
  `20261014-051433-tyir-solve-llsg`).

## Tests and oracle
The oracle is `oracle/main.rs`, a rustc-dev program. It links the pinned nightly's own `rustc_type_ir`, so
`SearchGraph`, `GlobalCache`, `PathKind` and the rest are upstream's real code. It drives them with a fake `Cx`:
- `Input` / `Result` / `AmbiguityKind` are `u32`;
- `Tracked<T> = T`;
- the global cache sits in a `RefCell` shared by all roots of a case.

It also uses a fake `Delegate` over small goal graphs:
- results 0..4 combine by min, max or sum mod 5;
- special results: 100 inductive initial, 101 coinductive initial, 102 unknown initial, 103 stack overflow,
  104 fixpoint overflow, 105 ambiguity;
- `FIXPOINT_STEP_LIMIT` 3, `DIVIDE_AVAILABLE_DEPTH_ON_OVERFLOW` 2;
- each goal has 0..3 candidates, wrapped in `enter_single_candidate` / `finish_single_candidate`. The best result wins;
  losing candidates go through `ignore_candidate_head_usages`, and ties through `merge_usages`;
- edges carry every `PathKind` and `LowerAvailableDepth::No`;
- roots run through `evaluate_goal` or `evaluate_root_goal_for_proof_tree`;
- inspect is on or off, and validation scopes are on or off, which exercises `lookup_global_cache_untracked`.

For every case the probe prints a trace:
- each `compute_goal` call;
- each child result as `evaluate_goal` returns it;
- the goal's own result;
- the root results.

This trace shows every cache hit (a missing `C<n>`), every fixpoint rerun and every overflow.
`oracle/cases.ts` runs the same cases through the port with the same fake delegate.

- **Result: 0 mismatches over 160,000 random cases** (seeds 1–8 × 20,000) plus 7 hand cases.
  - Line coverage of search_graph/mod.ts under the test is 91% of functions and 97% of lines. The only uncovered
    lines are `debug_current_depth` and the assertion-failure helper.
- The committed test replays three things:
  - the 7 hand cases, with full traces;
  - `fixture.txt`, which holds sha256 prefixes of the probe's traces for `gen(1, 4000)`;
  - the combinator checks below.
- solve/mod.rs combinators are checked against two more probe modes:
  - `./searchgraph certainty` covers `Certainty::and`, `MaybeInfo::or` and `VisibleForLeakCheck::and/or` over every
    pair of values;
  - `./searchgraph opaques` covers all 2401 sequences of 4 `AccessedOpaques<TyCtxt>` updates, and through them
    `RerunCondition::merge` (private upstream), `SmallCopySet::union` (private), `should_bail` and `might_rerun`.
  - The test compares the `{:?}` output byte for byte by hash.
- The probe is not in `tools/probes`, because lanes may not edit tools/. To rebuild it:
  ```
  rustc +nightly --edition 2024 -O src/rustc_type_ir/search_graph/oracle/main.rs -o searchgraph \
    -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
  bun src/rustc_type_ir/search_graph/oracle/cases.ts gen 1 4000 > cases.txt
  ./searchgraph < cases.txt > traces.txt
  bun src/rustc_type_ir/search_graph/oracle/cases.ts fixture 1 4000 traces.txt > fixture.txt
  ```
  Root may adopt it as `tools/probes/searchgraph`, and could then add a live check like fxorder's.
- Not tested against the oracle: the solve/mod.rs fns that need interned types (`Response::is_identity*`,
  `TyOrConstInferVar::*`, `ExternalConstraintsData::new`, `CandidatePreferenceMode::compute`,
  `SizedTraitKind::require_lang_item`, `Goal::new/with`). They are line-for-line ports, and nothing reaches them until
  the next solver lands.

## `unported(...)` left
- solve/mod.ts has two stand-ins for region_constraint.rs fns that are not ported yet: `RegionConstraint::new_true`
  (:495) and `RegionConstraint::is_true` (:499).
  - They are reached only with `-Zassumptions-on-binders`: through `ExternalConstraintsData::new` when
    `assumptions_on_binders()` is true, and through `ExternalRegionConstraints::is_empty` on `NextGen`.
  - Repoint them when region_constraint.rs lands (tyir-misc?).
- interner.ts `Cx_for_Interner.debug_Input`: `Debug` for rustc_middle's `CanonicalInput` (derived, traits/solve.rs:32)
  is not ported. Only the search graph's assertion-failure messages call it.

## PORT decisions (please record)
1. **Traits as fn tables.** The traits `search_graph::Cx` and `Delegate` become fn tables (PORTING §5).
   - `X: Cx` is described by `X extends CxTypes`, which carries its associated types: `Self` (the `cx` value), `Input`,
     `Result`, `AmbiguityKind`, `DepNodeIndex` and `Tracked`.
   - A `Cx<X>` object implements it. Its methods take `self` first, and it also holds the associated types' bounds:
     `debug_Input`, `debug_Result`, `Result_eq`, `AmbiguityKind_eq`.
   - `D: Delegate` works the same way: `D extends DelegateTypes`, implemented by a `Delegate<D>` object that holds the
     consts, the static fns and its `Cx` impl (`D.Cx`).
   - `SearchGraph` keeps the `Delegate` in its `_marker` field (upstream `PhantomData<D>`).
   - Static fns generic over `D` take it as their first parameter: `SearchGraph.new(D, depth)`,
     `SearchGraph.evaluate_root_goal_for_proof_tree(D, ...)` and `AvailableDepth.allowed_depth_for_nested(D, ...)`.
   - `GlobalCache.insert` / `get` take the `Cx` impl as their last parameter.
   - `X::Input` must be an interned object or a primitive: its `Eq` is `===` and it keys JS `Map`s.
   - `Result` and `AmbiguityKind` are never `undefined`, because `undefined` stands for `None`.
2. **Hash maps (D6).**
   - The maps keyed by `X::Input` are plain insertion-ordered `Map`s: `NestedGoals`, `provisional_cache` and
     `GlobalCache::map`. In rustc the key is the interned `CanonicalInput` pointer.
   - `CacheEntry::with_overflow` is also a plain `Map`, because it is only used with `get` / `insert`.
   - `CandidateHeadUsages::usages` is a hashbrown-order `FxHashMap`, keyed with `u32_key` and a 16/4 value layout.
   - Every iteration upstream is marked order-insensitive, and the oracle traces confirm that results do not depend on
     the order.
3. **Value representations.**
   - `BTreeMap<StackDepth, CycleHead>` is a key-sorted array.
   - `AvailableDepth` and `RequiredDepth` are branded numbers, built by same-named functions (`RequiredDepth(n)`).
   - `PathsToNested` is a branded number with its flags and the bitflags ops `empty`, `union`, `contains` and
     `intersects`. `From<PathKind>` is `PathsToNested.from_PathKind`.
   - `StackDepth` is a `newtype_index`.
4. **Copies of `Copy` structs (PORTING §8).** `HeadUsages` and `CycleHead` are `Copy` structs that are mutated in place,
   so they are copied wherever Rust copies them.
   - `CycleHeads.iter` and `CycleHeads.highest_cycle_head` yield copies.
   - `CycleHeads.insert` stores a copy of its by-value `usages`.
   - `NestedGoals.extend_from_child` clones the child's map for upstream's `clone_from`.
5. **`Cx_for_Interner` details.**
   - `I::Tracked<T>` is erased to `Tracked<unknown>`, and `get_tracked::<T>` casts the value back.
   - `Result_eq` and `AmbiguityKind_eq` compare `intern_key`s (the derived `Eq` of plain data over interned pointers).
   - Its entries call imported fns lazily, so interner.ts gains no init-order dependency on solve/ or canonical.ts.
   - `with_global_cache` casts `f`, because rustc_type_ir/decls.ts still has `GlobalCache = Pending<"GlobalCache">`.
6. **`Goal::new` / `Goal::with`** take the `Upcast` impl as their last parameter, a `(value, interner) => P` fn
   (`UpcastFn`, local to solve/mod.ts). upcast.rs is not ported.
7. **Small naming and shape choices.**
   - `Result<Infallible, RerunNonErased>` is `Result<never, RerunNonErased>`.
   - `impl From<..> for NoSolutionOrRerunNonErased` becomes `NoSolutionOrRerunNonErased.from_NoSolution` /
     `from_RerunNonErased`.
   - `RerunResultExt for Result` becomes `RerunResultExt_for_Result.map_err_to_rerun`.
   - `Default` impls are `default_()`.
8. **Debug-only code.** `cfg!(debug_assertions)` in `Stack::push` is dropped, because the oracle is a release build.
   `debug_assert*!`, `debug!`, `trace!` and `#[instrument]` stay as comments.
9. **Loop variable rename.** In `rebase_provisional_cache_entries`, upstream's loop variables `ph` / `ep` shadow the
   outer ones. They are renamed `ph_` / `ep_`, because a JS `for..of` binding is still in its TDZ while its iterable
   is evaluated.

## For root
- **rustc_type_ir/decls.ts.**
  - Replace `GlobalCache` / `RequiredDepth` (`Pending`) with re-exports from `./search_graph/mod.ts`. The real
    `GlobalCache` is generic: use `GlobalCache<InternerCx>` (`InternerCx` is in interner.ts).
  - Then drop the cast in `Cx_for_Interner.with_global_cache`.
- **Same change in the codegen inputs.** Make the same change in `tools/codegen/tyir.typemap.json`'s `RequiredDepth`
  entry, which currently imports decls.ts and has `debug: null`. Then:
  - set `debug_RequiredDepth` from `search_graph/mod.ts`;
  - regenerate set `rustc_ty`, so that inspect.gen.ts imports the real `RequiredDepth`.
- **rustc_middle (lane ty-ctxt or the solver lanes).** Create `GlobalCtxt`'s `new_solver_evaluation_cache` with
  `GlobalCache.new()`. `TyCtxt.with_global_cache` should pass it to `f`, and solver code should pass `Cx_for_Interner`
  wherever upstream relies on `TyCtxt: search_graph::Cx`.
- **Optional.** Adopt `oracle/main.rs` as `tools/probes/searchgraph`.
- **Possible conflict.** The tyir-misc lane may define an `Upcast` / `UpcastFn` in upcast.ts. If it does, repoint
  solve/mod.ts's local `UpcastFn` to it.
