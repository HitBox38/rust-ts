# Handoff: mt-drops (M4 wave 24: drop elaboration)

Branch `lane/mt-drops` (base `de448071` on integ-w19, no merges). Commits: the port + tests (`4bb281ba`), then this
handoff.

## Files touched
- **New** `src/rustc_mir_transform/elaborate_drop.ts`: the whole of compiler/rustc_mir_transform/src/elaborate_drop.rs
  (56/56). It has `DropStyle`, `DropFlagMode`, `Unwind` (+ `is_cleanup` / `into_action` / `map`), the `DropElaborator<Path>`
  interface (16 trait-method markers), `elaborate_drop`, and `DropCtxt` (drop ladders, open drops for tuple / closure /
  coroutine / ADT / box / enum / array / slice, destructor calls, the async-drop poll/yield loops, drop-flag test and
  reset blocks).
- `src/rustc_mir_transform/elaborate_drops.ts`: the mt-skeleton stub is replaced by the whole of elaborate_drops.rs
  (31/31): `ElaborateDrops` (`run_pass`, `policy` = Required), `compute_dead_unwinds`, `InitializationData`,
  `ElaborateDropsCtxt` (the `DropElaborator<MovePathIndex>` impl and the drop-flag passes) and `debug_ElaborateDropsCtxt`.
- `src/rustc_mir_transform/coroutine/drop.ts` (only the mt-drops stand-ins):
  - The `Unwind` stand-in is deleted; `Unwind` is now imported from elaborate_drop.ts.
  - The `elaborate_drop` stand-in is now an adapter that stops at
    `unported("rustc_mir_transform::shim::DropShimElaborator (lane mt-shim)")`. The real `elaborate_drop` needs a
    `DropElaborator<()>`, and mt-shim's `DropShimElaborator` stand-in interface is not one. The header comment is
    updated to match.
- `src/rustc_mir_transform/pass_manager.test.ts`: stub-module count 54 → **53** (delta −1: elaborate_drops.ts).
- **New** tests:
  - `src/rustc_mir_transform/elaborate_drops.oracle.test.ts`
  - the test driver `elaborate_drops_oracle/run.ts`
  - the fixture `elaborate_drops_oracle/drops.rs`
- lib.ts is untouched. Its comment `// mod elaborate_drop; (not referenced here: lane mt-drops adds elaborate_drop.ts)`
  is still accurate: lib.rs only declares the module, and elaborate_drops.ts and drop.ts import it.

## Coverage
- elaborate_drop.rs 56/56, elaborate_drops.rs 31/31 (`bun scripts/coverage.ts --missing`).
- rustc_mir_transform 376/1101; TOTAL 20805/25518. `bun scripts/coverage.ts --check`: markers ok (21384; vendor 4330).

## Verification against the oracle
The mirdump probe stops before borrowck and drop elaboration by design (suites.ts: "the MIR_borrow_checking loop
without borrowck/drop elaboration"). So **no mirdump stop is `ElaborateDrops`, and none can move**. At base the samples
stop at `eval_in_interpreter`, `replace_regions_in_mir` and `try_to_bits_for_ty`.

`mir_drops_elaborated_and_const_checked` itself is reachable only after `mir_borrowck` (not ported). So the pass is
checked with `-Zdump-mir=ElaborateDrops`:
- **`elaborate_drops.oracle.test.ts`** (probe-gated like the other oracle tests):
  - Input: the fixture (std crate, 51 bodies).
  - Oracle side: `--crate-type=lib --edition=2021 -Zdump-mir=ElaborateDrops -Zdump-mir-exclude-pass-number --emit=mir`.
  - Our side: the driver runs the real `mir_promoted`, then the analysis cleanup passes, then the real `ElaborateDrops`
    through `run_passes`, so the pass manager writes the dump files.
  - Result: **all 102 files (before + after) are byte-identical**. Pass in 84 s under load.
  - What the fixture covers: conditional drop flags, open drops of structs, nested structs, tuples, enums (downcast
    ladders with and without "otherwise" variants), closures, a coroutine, `Box` (contents moved), `Box<Box<_>>`, arrays
    (array patterns, `[D; 40]` subslice ranges), boxed slices, unions / `ManuallyDrop`, generics, `dyn`, `Rc`, `Vec`,
    `String`, replace-drops on fields and behind `&mut`, re-initialisation in loops, call-return drop flags, early
    returns, and the patch's resume / terminate blocks.
- **Wider scratch check** (not committed; `$RUST_TS_DATA/scratch/mt-drops/{edrive.ts,run.sh,batch.sh}`):
  - Input: 72 tests/ui files (drop, moves, mir, borrowck, nll; no aux / revisions / flags).
  - **160 bodies whose `before` dump equals the oracle's all have identical `after` dumps (0 after-only diffs).**
  - The other bodies differ already in `before`, for reasons outside this lane:
    - the stubbed `Derefer`;
    - alloc numbering in `alloc<N>` lines;
    - compile-fail tests where the oracle stops at borrowck;
    - our driver stopping earlier: `Decodable for mir::Body`, `UniverseInfo::relate`.

## Samples (`RUST_TS_AGENT=root-f5de`, compared case by case with the base runs in w25-common.txt)
Runs were made on a machine at load average ~430, so some cases timed out. **Every TIMEOUT was re-run alone**
(`--filter <id> --jobs 1`, log `$RUST_TS_DATA/tmp/mt-drops-timeouts.log`). 25 of the 26 re-ran MATCH: 24 were MATCH at
base, and `mir/mir_refs_correct.rs` was UNPORTED. `mini_core_hello_world.rs` (UNPORTED at base) stays UNPORTED. Final statuses:

| suite | lane run | M / D / U / C (other) | base run | M / D / U | changed cases (vs base) |
|---|---|---|---|---|---|
| tydump-minicore (46) | `20261027-235224-root-f5de-p1yf` | 46 / 0 / 0 / 0 | `…-wos5` | 45 / 0 / 1 | UNPORTED → MATCH `rustc_codegen_cranelift/example/mini_core_hello_world.rs` |
| mirdump-minicore (46) | `20261027-235452-root-f5de-79hq` (+ reruns) | 45 / 0 / 1 / 0 | `…-p8q4` | 45 / 0 / 1 | none; the 4 timeouts re-ran as base (`mini_core_hello_world.rs` stop is now `UniverseInfo::relate`) |
| tydump-ui `--sample 300` | `20261027-235744-root-f5de-g7hh` (+ reruns) | 262 / 0 / 36 / 0 (2 unstable) | `…-zjq3` | 261 / 0 / 37 (2 unstable) | UNPORTED → MATCH `enum-discriminant/wrapping_niche.rs`; 10 timeouts re-ran MATCH |
| mirdump-ui `--sample 300` | `20261028-000757-root-f5de-hole` (+ reruns) | 273 / 0 / 27 / 0 | `…-mzgb` | 269 / 0 / 31 | UNPORTED → MATCH `mir/mir-inlining/ice-issue-77564.rs`, `mir/issue-76248.rs`, `mir/enum/option_with_bigger_niche_break.rs`, `mir/mir_refs_correct.rs`; 11 timeouts re-ran MATCH |
| borrowck-ui `--sample 300` | `20261028-002031-root-f5de-w2du` | 0 / 0 / 300 / 0 | `…-86qn` | 0 / 0 / 300 | none (stops: 209 `UniverseInfo::relate`, 74 `OutlivesConstraintSet::push`, 12 polonius, 5 `Decodable for mir::Body`) |

**No MATCH became anything else. No DIFF, no CRASH.** The UNPORTED → MATCH changes come from work merged into the base
since root's base runs, not from drop elaboration: neither the tydump nor the mirdump probe reaches `ElaborateDrops`.

**Stops near this lane.** mirdump-ui `tests/ui/unsafe/break-inside-unsafe-block-issue-128604.rs` (a const-eval path
through `mir_drops_elaborated_and_const_checked`) now stops at `CleanupPostBorrowck (pass not ported)` (mt-cleanup), the
pass before `ElaborateDrops`. Another lane's newer run (`runs/mtc-s-mirui`) already shows it stopping at the
`ElaborateDrops (pass not ported)` stub. With mt-cleanup and mt-drops both merged it reaches this port and stops later.
No sampled case stops in elaborate_drop.ts / elaborate_drops.ts.

## `unported(...)` left
- None in elaborate_drop.ts / elaborate_drops.ts.
- coroutine/drop.ts adapter: `rustc_mir_transform::shim::DropShimElaborator (lane mt-shim)` (see "For root").

## PORT decisions (phrased for `bun scripts/state.ts record decision`)
1. (mt-drops) The `DropElaborator<'a,'tcx>` trait is the interface `DropElaborator<Path>`:
   - The associated type `Path` is the type parameter.
   - `Option<Path>` is `Path | undefined`, so `Path` values are never `undefined`. `ElaborateDropsCtxt` uses
     `MovePathIndex`; shim elaborators use `()` = `null`.
   - The `fmt::Debug` supertrait and `DropCtxt`'s `#[derive(Debug)]` are not ported (only `#[instrument]` uses them).
2. (mt-drops) `DropCtxt` is a class generic over `Path`. `DropCtxt { elaborator: self.elaborator, .. }` builds a new
   `DropCtxt` that shares the elaborator object.
3. (mt-drops) Copies stored into new statements or terminators are cloned (PORTING §8). This covers the `Copy` `Place`
   and `SourceInfo` and the `Clone` `Operand`: every `self.place` / `self.source_info` use and `yield_value.clone()`.
4. (mt-drops) `crate::coroutine::CTX_ARG` (coroutine/mod.rs:161, `Local::arg(1)`) is redeclared in elaborate_drop.ts
   with the same value. coroutine/mod.rs is a stub at this base (mt-coroutine-a). mt-coroutine-a may export it and
   repoint.
5. (mt-drops) Iterator chains use the shortest length, as upstream does:
   - `izip!(fields.rev(), unwind_ladder, dropline_ladder)` and `values.zip(blocks)` run to the shortest input.
   - `all_equal_value()` is `Ok` iff `blocks` is non-empty and all its elements are equal.
   - `array_subpath`'s `u64` index / size are `number`, like `ProjectionElem::ConstantIndex`.
6. (mt-drops) `ElaborateDropsCtxt` fields that collide with trait accessors get a `_` suffix: `tcx_`, `body_`,
   `patch_`. The trait-impl methods sit in the class body before the inherent ones; `impl Debug` is
   `debug_ElaborateDropsCtxt`, after the class.
7. (mt-drops) `InitializationData::maybe_init_uninit` reads the cursors through `MaybeReachable.contains(..,
   BitSetExt_MixedBitSet)` / `MixedBitSet.contains`. The delayed bug prints the derived `Debug` of `LookupResult` with a
   local `debug_LookupResult`, because move_paths/mod.ts has none.
8. (mt-drops) The oracle test driver elaborate_drops_oracle/run.ts has **test-only stand-ins** for the still-stubbed
   `CleanupPostBorrowck` and `RemoveNoopLandingPads` (mt-cleanup). The `before`-dump comparison checks them on the
   fixture. Replace them with the real passes once those land.

## For root / other lanes
- **mt-shim**: `DropShimElaborator` should `implements DropElaborator<null>` from elaborate_drop.ts, and import
  `elaborate_drop` / `DropFlagMode` / `DropStyle` / `Unwind` from there.
  - In coroutine/drop.ts, delete the `DropShimElaborator` stand-in interface and my `elaborate_drop` adapter, and import
    both. The call `elaborate_drop(elaborator, .., null, ..)` then type-checks unchanged.
  - Also update `pass_manager.test.ts`'s stub count by your own delta. Mine is −1 (54 → 53).
- **mt-cleanup**: once `CleanupPostBorrowck` / `RemoveNoopLandingPads` / `Derefer` are ported, the
  oracle test driver can call the real passes, i.e. `run_analysis_cleanup_passes` (see its header).
- **mt-coroutine-a**: `CTX_ARG` (decision 4).
- **Runtime stops**: the samples show none moved (see Samples). Once `mir_borrowck` lands, const eval and codegen paths
  through `mir_drops_elaborated_and_const_checked` reach the real `ElaborateDrops` instead of the stub stop
  `rustc_mir_transform::elaborate_drops::ElaborateDrops (pass not ported)`.
- **The full unit suite was not run** (as instructed). `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform`:
  63 pass, 0 fail (10 files). These were also run and are clean:
  - `bunx tsc --noEmit -p .`;
  - `bun test src/rustc_mir_transform/pass_manager.test.ts` (18 pass);
  - `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_mir_transform/elaborate_drops.oracle.test.ts` (1 pass).
