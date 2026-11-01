# Handoff: lane `miri-race` (M6 wave 36, Miri core)

I filled three stubs of the miri-contract skeleton: Miri's vector-clock data-race detector. Branch `t3/71bf9ac1`, based on main
`06fa2c65`.

## Files touched

- `src/miri/concurrency/vector_clock.ts`: port of `concurrency/vector_clock.rs`.
- `src/miri/concurrency/vector_clock.test.ts` (new): upstream's `#[cfg(test)] mod tests`, plus one rust-ts test.
- `src/miri/concurrency/data_race.ts`: port of `concurrency/data_race.rs`.
- `src/miri/concurrency/data_race.test.ts` (new, not a port): race detection on small hand-built access sequences.
- `src/miri/concurrency/data_race_handler.ts`: port of `concurrency/data_race_handler.rs`.
- `docs/handoff/miri-race.md` (this file).

I did not edit any file of another lane, any generated file, or the typemap. Every stub name in the three modules is ported
and its `stub_methods` / `stub_statics` registration is deleted.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23316; vendor 5050)`.
- `bun scripts/coverage.ts --missing`:
  - `concurrency/data_race.rs`: 78/78
  - `concurrency/data_race_handler.rs`: 10/10
  - `concurrency/vector_clock.rs`: 35/35 (includes the 5 test fns)
- Codegen: `bun tools/codegen/types.ts miri` regenerates with no diff (`git status` shows only my hand files).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri`: 24 pass, 0 fail, across 4 files. Of these, 12 are new in the 2 new test
  files: upstream's `test_equal`, `test_partial_order` and `set_index_to_0`, plus 9 rust-ts tests. `contract.test.ts` passes:
  markers, headers, every module loads as a fresh entry point, and the placeholders install without collision.
- `bun scripts/difftest.ts --suite mir --sample 100`: MATCH=100 DIFF=0 UNPORTED=0 (run `20261101-125052-root-qy72`). As
  expected, nothing on the compiler side calls Miri yet.
- What `data_race.test.ts` covers:
  - thread creation clocks
  - unsynchronized write/write and read/write races
  - join synchronization
  - release store + acquire load message passing, and the same with a relaxed load: it races, then an acquire fence repairs it
  - mixed-size atomic stores
  - vector-index reuse after terminate + join + catch-up, with upstream's exact clock values
  - `find_gt_index`
  - the access descriptions and thread names (`AccessType::description`, `print_thread_metadata`)
  - `report_data_race` reaching the pending machine-stop stand-in (below); the test checks the reported `DataRace` payload (accesses, threads, non-atomic flag) carried on the stand-in's `Unported`
  - NOT tested here: the "Data race detected between (1) … and (2) …" text. It is built by miri-driver's `TerminationInfo` Display, which is not in this batch; its test comes with the miri-driver batch.

## Representation (the lane brief's question)

- **`VTimestamp`'s fields are numbers, so there is no deviation from C5.** `time_and_read_type` is a `u32` and `span` is a
  branded `Span`. C5 is about `u64`/`i64`, and nothing in these files is wider than `u32`.
- **`time` is at most `u32::MAX / 2`.** `encode_time_and_read_type` checks `checked_mul(2)` and panics "Vector clock overflow".
  The word is built with `+` and read with `>>> 1` / `& 1`, since JS `|` is 32-bit signed.
- **`VClock` is the generated `{ _0: VTimestamp[] }`.** `VTimestamp` is `Copy`. Each array slot owns its object and is
  mutated in place, as through `&mut` (`index_mut`, `get_mut_with_min_len`, `join`, `set_at_index`). Every copy into a slot
  or into a binding that is later mutated is a `clone_VTimestamp`. `VTimestamp.ZERO` is frozen, because `Index` returns it
  for absent entries.
- **`clone_from` reuses the existing slot objects,** as upstream reuses the SmallVec buffer.
- **The hot per-byte checks allocate nothing.** `Result<(), DataRace>` values are shared frozen `OK` / `DATA_RACE_ERR`.
- **Possible perf follow-up (needs root): a packed clock.** A `Float64Array` (or `Uint32Array`) of time/span pairs per
  `VClock` would save one object per entry. It would mean changing the typemap of `VClock._0` (and the generated
  Debug/Clone). I did not do it: it is a representation change (D11 rule) and a tools/codegen edit.

## PORT decisions in code (for review)

- **`VectorIdx` interning** (vector_clock.ts).
  - `VectorIdx::new` / `From<u32>` return one interned instance per value, so `===` is the derived `Eq`.
  - `GlobalState.reuse_candidates` is an `FxHashSet<VectorIdx>` (rust_ts/hash_map.ts, keyed `write_u32`, size 4). Upstream
    iterates it in `find_vector_index_reuse_candidate`, so hashbrown order matters there.
  - Its keys are canonicalised with `canon()` at insertion. Fresh objects from the generated `clone_VectorIdx` (DedupRangeMap
    splits) are compared with `index()`.
- **Derives codegen does not produce,** added as statics:
  - `VClock.default()` (also needed by sync.rs: miri-threads)
  - `VClock_eq`
  - `ThreadClockSet.default()`
  - `FrameState.default()` (machine.rs needs it: miri-machine)
- **`Ord::max`** keeps `*l` on ties in `join`.
- **Companions (PORTING §8).**
  - `GlobalDataRaceHandler` and `AllocDataRaceHandler` get their inherent methods on the companions in data_race_handler.ts.
    Other lanes call them as `GlobalDataRaceHandler.as_vclocks_ref(machine.data_race)`.
  - Likewise `AtomicRwOrd/ReadOrd/WriteOrd/FenceOrd.from`, `NaReadType/NaWriteType.description`, and
    `AccessType.description/is_atomic/is_read/is_retag` (data_race.ts).
  - `GlobalDataRaceHandler::set_ongoing_action_data_race_free` is private and defined in data_race.rs, so it is a
    module-private fn in data_race.ts.
- **`VisitProvenance`.**
  - `GlobalState` and `VClockAlloc` get prototype methods.
  - The two handler enums get the `VisitProvenance_GlobalDataRaceHandler` / `VisitProvenance_AllocDataRaceHandler` tables.
- **Cells and IndexVecs.** `Cell`/`RefCell`/`Ref`/`RefMut` are the values; `thread_state*` returns
  `[VectorIdx, ThreadClockSet]`. `IndexVec` indexing goes through a bounds-checked `at()`. `pick2_mut` keeps its
  `assert!(ai != bi)`.
- **`FrameState.local_clocks`** is a plain `Map`, since it is never iterated.
- **Logging and GenMC.** `trace!` lines are kept as comments; the file has no `info!`. GenMC arms stop `unported("genmc")`,
  as the brief says. That includes the two `throw_unsup_format!` GenMC arms of `release_clock` / `acquire_clock`.

## Contract gaps: missing or mis-typed signatures in other lanes' files (not edited; local stand-ins marked `PORT(contract)`)

1. **miri-driver: `impl MachineStopType for TerminationInfo`** (diagnostics.rs:113) has no declared constructor.
   - `err_machine_stop!(TerminationInfo::DataRace{..})` needs `TerminationInfo → MachineStopType`. That is an object with
     `display()` / `debug(f)` / `with_validation_path`, which `MachineStopType_downcast_ref` hands back as the
     `TerminationInfo`.
   - data_race.ts has a module-private stand-in, `TerminationInfo_as_MachineStopType`, which stops
     `unported("miri::diagnostics::TerminationInfo: MachineStopType ...")`. So **race reports stop UNPORTED until miri-driver
     exports it.**
   - Suggested: `export function TerminationInfo_as_MachineStopType(info: TerminationInfo): MachineStopType` in
     diagnostics.ts. Root or miri-driver then replaces the stand-in with that import (one line). Stacked Borrows'
     `TerminationInfo` errors need the same function.
2. **miri-driver: `DedupRangeMap::iter` / `iter_mut` / `iter_mut_all`** yield `[Pending<"ops::Range<u64>">, T]`.
   - I read `.start` through `range_start()`, assuming the typemap's `{ start: number; end: number }` range shape.
   - Splits must clone values with a deep clone: `clone_MemoryCellClocks` (generated), which calls `clone_VClock` (ported
     here). A shallow copy would alias clocks between ranges.
3. **miri-threads.** I use `ThreadManager.active_thread_()`, `active_thread_ref().current_user_relevant_span()`,
   `get_live_thread_count()` and `get_thread_display_name()`, all as declared. Two things are not declared:
   - `ThreadId::MAIN_THREAD`: the local `main_thread()` is `new ThreadId(0)`, the upstream value.
   - `impl Idx for ThreadId`: the local `thread_idx()` is `._0`, upstream's `index` body.
   - Suggested: declare `ThreadId.MAIN_THREAD` and `ThreadId.prototype.index()`.
4. **miri-sb: `StoreBufferAlloc::visit_provenance`** (weak_memory.rs:121) is only in the inventory. I call it through the
   `VisitProvenance` method shape.
   - I also call `buffered_atomic_read` / `_write` / `_rmw` and `perform_read_on_buffered_latest` as declared.
   - weak_memory.rs calls `sc_write`, `sc_read`, `sync_clock`, `ongoing_action_data_race_free_` and `active_thread_state` on
     my types; all exist with the declared names.
5. **typemap (root): `MiriMachine.rng` is `Pending<"rand::rngs::StdRng">`.** `atomic_compare_exchange` casts it to the
   vendored `Rng` for `RngExt.random_bool`.
6. **interp-generic (root): two CTFE-only signatures.**
   - `Immediate.to_scalar` is typed for `CtfeProvenance` only. The local `imm_to_scalar` casts, and the body is
     provenance-agnostic.
   - `InterpCx.ghost_run`'s closure parameter is typed as the CTFE `InterpCx`. The closure uses the outer `this_`, which is
     the object `ghost_run` passes anyway.
7. **miri-eval:** `MiriMachine.current_user_relevant_span()` (helpers.ts), as declared.

Signature corrections I made in my own modules, which other lanes call:
- `Result<null, DataRace>` became `Result<undefined, DataRace>`, matching the `interp_ok(undefined)` unit convention.
- `Pending<"RefMut<'_, ThreadClockSet>">` / `Ref<..>` became `ThreadClockSet`.
- Added: `VectorIdx.prototype.index()`, `VectorIdx.new/from`, `VTimestamp.ZERO`, `VClock.prototype.{clone_from,
  partial_cmp, lt, le, gt, ge, index}`, `VTimestamp_eq/cmp/partial_cmp`, `VClock_eq`, `MemoryCellClocks`
  (unchanged), `GlobalState/VClockAlloc.prototype.visit_provenance`, `default_LocalClocks`, the `.default()` statics, and
  `export type Ordering = -1 | 0 | 1` (vector_clock.ts).

## unported(...) left

- `unported("genmc")`: 9 sites, all GenMC arms.
  - data_race.ts: `read_scalar_atomic`, `write_scalar_atomic`, `atomic_rmw`, `atomic_compare_exchange`, `atomic_fence`,
    `release_clock`, `acquire_clock`, and `set_ongoing_action_data_race_free`.
  - data_race_handler.ts: `visit_provenance` of `Genmc`.
- `unported("miri::diagnostics::TerminationInfo: MachineStopType ...")`: contract gap 1, reached by every data-race report.
- No other `unported` remains. The `unreachable()` after `new_allocation`'s exhaustive match is a panic, not a stop.
