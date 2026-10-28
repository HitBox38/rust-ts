# Handoff: fix-w24-mir (integration of the wave-24 MIR-transform lanes)

Branch `lane/fix-w24-mir` (base `819357d5` on integ-w19, no merges). Commits: `6bed810e` the wiring, `d16c3fd9` the
known_panics_lint_oracle `unwrap_result` fix (root's extra item), then this handoff.

## Repoints (every wave-24 stand-in that now has a real port)
`grep -rn "stand-in" src/rustc_mir_transform` now finds no stand-in for an item of mt-cleanup / mt-drops / mt-shim /
mt-coroutine-a / mt-kpl-ubchecks.
- **shim.ts**: the stand-ins `DropFlagMode`, `DropStyle`, `Unwind`, `elaborate_drop`, `deref_finder` are deleted. shim.ts
  imports `DropElaborator` / `DropFlagMode` / `DropStyle` / `elaborate_drop` from elaborate_drop.ts and `deref_finder`
  from deref_separator.ts. `DropShimElaborator` now `implements DropElaborator<null>`.
  - Name clash: the trait accessors keep the trait's names (`patch()`, `body()`, `tcx()`, `typing_env()`), and the
    clashing fields get the `_` instead (`body_`, `patch_`, `tcx_`, `typing_env_`). This is what elaborate_drops.ts's
    `ElaborateDropsCtxt` already does.
  - The field reads `elaborator.patch` became `elaborator.patch_` in shim.ts, shim/async_destructor_ctor.ts and
    coroutine/drop.ts.
  - The `mir_shims` provider now takes a typed `ShimKind` (no cast).
- **shim/async_destructor_ctor.ts**: imports `elaborate_drop` / `deref_finder` from their ports, not from shim.ts.
- **coroutine/drop.ts**: the `elaborate_drop` adapter (which stopped at `shim::DropShimElaborator (lane mt-shim)`) is
  deleted. `elaborate_drop` and `Unwind` are imported from elaborate_drop.ts. The header is updated.
- **coroutine/mod.ts**: the local `deref_finder` stand-in is deleted; the function is imported from deref_separator.ts.
- **elaborate_drop.ts**: the redeclared `CTX_ARG` is deleted; it is imported from coroutine/mod.ts. That forms the cycle
  elaborate_drop → coroutine/mod → drop → elaborate_drop, which is safe: `CTX_ARG` is only read inside fns. The header
  notes this.
- **elaborate_drops_oracle/run.ts**: the TEST-ONLY `CleanupPostBorrowck` / `RemoveNoopLandingPads` stand-ins are deleted.
  The driver now runs:
  - lib.ts's real `run_analysis_cleanup_passes`: ImpossibleClauses, CleanupPostBorrowck, RemoveNoopLandingPads,
    SimplifyCfg::PostAnalysis, Derefer;
  - then the real head of `run_runtime_lowering_passes`: `[CriticalCallEdges, PostAnalysisNormalize, Subtyper,
    ElaborateDrops]` with `Runtime(Initial)`.
  - The header comment of `elaborate_drops.oracle.test.ts` is updated.
  - mt-cleanup's driver is the scratch `cwrap.ts` (not committed); see the oracle checks below.
- **lower_intrinsics.ts**: the copy of `take_array` is replaced.
  - lib.ts now exports `take_array`, and lower_intrinsics' `take_array` `require`s it lazily.
  - This keeps the init-order rule (no load-time import of lib.ts). The precedents are shim.ts's
    `run_optimization_passes` and pass_manager.ts's `PASS_NAMES`.
- **lib.ts:140** comment now reads `// mod check_pointers; (check_pointers.ts; not referenced here: check_alignment /
  check_null / check_enums import it)`.
- **lib.ts** also exports `run_analysis_cleanup_passes` (private upstream; `// PORT:` note), for the test driver above.

## `mir_shims` reachable
- `tools/codegen/queries.config.json`: alias `rustc_middle::ty::ShimKind` → `rustc_middle::ty::instance::ShimKind`, and
  key `rustc_middle::ty::instance::ShimKind` → `ShimKind`, as `InstanceKind` is mapped.
- I regenerated with `bun tools/codegen/queries.ts`. queries.gen.ts now has `key: KEY_ShimKind` and
  `Key: ShimKind` for `mir_shims`. No `src/rustc_lexer/lib.gen.ts` was created.
- `src/rustc_middle/ty/mod.ts` needed two typing fixes: `instance_mir` casts the opaque `InstanceKindView` `Shim._0` to
  `ShimKind`, and `async_drop_coroutine_layout` annotates its literal as `ShimKind`. A type-only import of
  `./instance.ts` was added and a stale "value is `unknown`" comment removed.
- Still `unported`: the `desc` of `mir_shims`. The generator cannot do `key.def_id()` on a non-tcx receiver. It is only
  read for cycle errors and query stacks (generator/tools batch).

## `needs_coroutine_by_move_body_def_id`
- Ported as upstream (context.rs:2913) in `src/rustc_middle/ty/context.ts`:
  `type_of(def_id).instantiate_identity().skip_norm_wip().kind()` is `Coroutine` and
  `args.as_coroutine().kind_ty().to_opt_closure_kind() != Some(FnOnce)`.
- `CoroutineArgs` comes through a lazy accessor `closure_ty_kind()`, in the style of the file's existing `mir()` /
  `middle_lint()`, because rustc_type_ir/ty_kind/closure.ts imports ty/mod.ts.

## New runtime stops
- **async closures** (tydump, verified on an `async move || ..` / `async || ..` file): the old stop
  `rustc_type_ir::binder::EarlyBinder::instantiate_identity (binder.rs, lane tyir-binder)` becomes
  **`coverage_attr_on provider (not ported)`**, because the by-move body is now built. This is what mt-coroutine-a
  predicted.
- **`tcx.mir_shims(..)`**: the old stop `QueryKey for ty::ShimKind<'tcx>` becomes
  **`rustc_mir_transform::instsimplify::InstSimplify (pass not ported)`** in `make_shim`'s pass list, after
  MentionedItems / AddMovesForPackedDrops / RemoveNoopLandingPads / SimplifyCfg-make_shim. Verified for drop glue (see
  below).
- **Coroutine bodies through `StateTransform`** no longer stop at the drop.ts adapter / deref_finder stand-ins. On the
  scratch fixtures they run to completion.
- No sampled difftest case changed its stop because of this branch.
- Stops seen in the scratch check, all of them other crates' stops reached from correct code:
  - `QueryKey for ty::Value<'tcx>` (KnownPanicsLint array bounds checks; already pinned by kpl's `bounds.rs`);
  - `Decodable for mir::Body<'static>` / `Decodable for (ConstValue, Ty)`: rmeta MIR decoding, reached through
    `layout_of` of std pattern types (`NonZero`) whose ends are CTFE'd extern consts. Upstream reaches the same place
    from AddMovesForPackedDrops' `is_disaligned` and from KPL.

## Oracle checks on the integrated tree
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform`: **70 pass, 0 fail** (12 files).
- `elaborate_drops.oracle.test.ts`: **102/102 dump files byte-identical**, now with the real cleanup and lowering passes
  in the driver.
- `known_panics_lint.oracle.test.ts`: 3/3 pass. `coroutine/mod.test.ts`: 4/4 pass.
- `src/rustc_const_eval/interpret/intrinsics/simd.oracle.test.ts`: **`simd oracle: 2144 equal, 0 pending`** and
  **`simd UB oracle: 14 equal, 0 pending`**, so it really checks every case now.
  - interp-simd's three integration fixes are all in the tree: interpret/mod.ts imports atomic.ts / simd.ts, the `F_`
    dictionaries are passed, and `compute_size_in_bytes` compares as bigint.
  - Mutation check: `bool_to_simd_element` returning `1n` for true makes the value test fail. The file was restored.
- **mt-cleanup's `-Zdump-mir` comparison**, re-run with real ElaborateDrops:
  - Script: my copy `$RUST_TS_DATA/scratch/fix-w24-mir/{cwrap.ts,cmp.sh,first.sh,cmpruns.py,c1..c6.rs}`, wrapping this
    worktree.
  - Only `mir_borrowck` is faked. ElaborateDrops, StateTransform and KnownPanicsLint are real. The env switches
    `CWRAP_NOOP_ST` / `CWRAP_NOOP_KPL` turn the last two off, and `CWRAP_SHIMS=1` builds the drop glue of local ADTs
    through `tcx.mir_shims`.

| input | files compared | equal |
|---|---|---|
| c2.rs | 879 | 879 normalised (allocN); bodies `h` / `fg` stop as above, `pk` / `call` then hit the poisoned `layout_of` |
| c2.rs `-Cpanic=abort` | 831 | 831 normalised |
| c2.rs with KPL off | 874 | 874 normalised |
| c3.rs / `-Cpanic=abort` | 1124 / 1064 | all, raw (`i7` / `mutp` stop in KPL as above) |
| c5.rs (new: packed-field drops with local `Drop` types) | 457 | **457 raw**; **10 bodies with a real AddMovesForPackedDrops rewrite, all identical** |
| c5.rs + `CWRAP_SHIMS=1` | + 40 drop-glue shim dumps (`core.ptr-drop_glue.{D,E,Q,R,Plain}` through SimplifyCfg-make_shim) | all raw |
| c6.rs (new: coroutines, `static` coroutine, async blocks) | 391 + 30 coroutine dumps (`coroutine_before/pre-elab/post-transform/drop/drop_proxy_async/resume`) | all raw |
| mini_core.rs (minicore argv) | 2984 | 2984 normalised (raw alloc ids differ only because KPL is real now and changes query order) |

  - c4.rs uses `String` / `Vec` fields: its packed bodies stop at the `Decodable for mir::Body` metadata stop (above).
    `r1` still matched.
  - So **the packed-drop rewrite in AddMovesForPackedDrops is now oracle-verified** (c5), as are
    `DropShimElaborator` + `elaborate_drop`, both for drop glue and for `elaborate_coroutine_drops`.
  - No mismatch with the oracle was found.

## Unit tests
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (21939; vendor 4330).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform src/rustc_const_eval src/rustc_middle`: 70 + 388 pass,
  0 fail. There were no timeouts.
- Full unit suite not run (as instructed).
- `src/std/result.test.ts` "non-test code never reaches the one-argument unwrap_result":
  - Fixed for `known_panics_lint_oracle/run.ts`. It now uses `std_result.unwrap_result(.., debug_IoError)` through a
    namespace import, because the destructured `const { unwrap_result } = await import(..)` was the flagged mention.
  - On this branch the test still lists `simd.ts:451` / `:508`, which root fixed on integ-w19 (I did not touch simd.ts).

## Coverage
- All five files are complete: shim.rs 38/38, shim/async_destructor_ctor.rs 7/7, elaborate_drop.rs 56/56,
  elaborate_drops.rs 31/31, coroutine/mod.rs 45/45, coroutine/drop.rs 8/8, lower_intrinsics.rs 2/2, lib.rs 20/20.
- rustc_middle ty/context.rs 202/202.
- rustc_mir_transform 583/1101; TOTAL 21360/25518.

## Sample difftests (`RUST_TS_AGENT=root-f5de`, at `6bed810e`, compared case by case with w25-common.txt's base runs)
| suite | run | M / D / U / other | base | changes |
|---|---|---|---|---|
| tydump-minicore | `20261028-005308-root-f5de-vi7j` | 46 / 0 / 0 | `wos5` 45 / 0 / 1 | UNPORTED → MATCH `mini_core_hello_world.rs` |
| mirdump-minicore | `20261028-005314-root-f5de-x8xu` | 45 / 0 / 1 | `p8q4` 45 / 0 / 1 | none (stop `UniverseInfo::relate`) |
| tydump-ui `--sample 300` | `20261028-005320-root-f5de-ztt5` | 267 / 0 / 31 (+2 UNSTABLE) | `zjq3` 261 / 0 / 37 (+2) | 6 UNPORTED → MATCH |
| mirdump-ui `--sample 300` | `20261028-005403-root-f5de-frz4` | 274 / 0 / 26 | `mzgb` 269 / 0 / 31 | 5 UNPORTED → MATCH |
| borrowck-ui `--sample 300` | `20261028-005449-root-f5de-ksh6` | 0 / 0 / 300 | `86qn` 0 / 0 / 300 | stop messages only |

- **No MATCH lost; 0 DIFF, 0 CRASH, 0 TIMEOUT.**
- The gains:
  - tydump-ui: `byte-string-u8-validation.rs`, `wrapping_niche.rs`, `issue-102985.rs`,
    `trait-predicate-with-escaping-bounds.rs`, `escaping_bound_vars.rs`, `for-in-const-eval.rs`;
  - mirdump-ui: the 4 `tests/ui/mir/*` cases noted by the lanes, plus `break-inside-unsafe-block-issue-128604.rs`.
  - These are the cases mt-cleanup listed as stuck at CleanupPostBorrowck / ElaborateDrops.
  - I spot-checked 4 of them on base `819357d5` (`git checkout 819357d5 -- src tools`, `--filter`, then restored): they
    already MATCH there. So the gains come from the lane merges, not from this branch.
- Top stops:
  - tydump-ui: 27 `UniverseInfo::relate`, 2 `hash_result (type_of)`, 1 `Decodable for mir::Body`, 1 `IntoDiagArg`;
  - mirdump-ui: 22 `UniverseInfo::relate`, 3 `Decodable for mir::Body`, 1 `Decodable for (ConstValue, Ty)`;
  - borrowck-ui: 282 `UniverseInfo::relate`, 12 polonius, 5 `Decodable for mir::Body`, 1 `to_universe_info`.

## `unported(...)` left
- None of the removed stand-ins remain.
- Still in these files, owned elsewhere: the `mir_shims` `desc` (generated), and the other passes' stub modules
  (pass_manager.test.ts stub count unchanged at 31; no module stopped being a stub here).

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (fix-w24-mir) `DropShimElaborator implements DropElaborator<null>`. Fields that clash with trait accessors carry the
   `_` (`body_`, `patch_`, `tcx_`, `typing_env_`) and the accessors keep the trait names, as in `ElaborateDropsCtxt`.
   Every implementor of a multi-impl trait interface needs one method name.
2. (fix-w24-mir) lib.ts exports `take_array` (lib.rs:318). lower_intrinsics.ts reaches it with a lazy `require`, so pass
   modules still never import lib.ts at load.
3. (fix-w24-mir) lib.ts exports `run_analysis_cleanup_passes` (private upstream) for the elaborate_drops oracle driver.
4. (fix-w24-mir) context.ts reaches rustc_type_ir ty_kind/closure.ts through a lazy accessor `closure_ty_kind()`
   (closure.ts imports ty/mod.ts).

## For root
- Merge `lane/fix-w24-mir`. Files outside rustc_mir_transform: `tools/codegen/queries.config.json`,
  `src/rustc_middle/queries.gen.ts` (regenerated), `src/rustc_middle/ty/context.ts`
  (`needs_coroutine_by_move_body_def_id` + accessor), `src/rustc_middle/ty/mod.ts` (two `ShimKind` typings + import).
- No stop pins in the contract tests needed changes. No test pinned any of the removed stops.
