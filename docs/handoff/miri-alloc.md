# Handoff: lane `miri-alloc` (M6 wave 36, Miri core)

Branch `t3/port-miri-allocation` (worktree t3-29ba116c), on top of main `06fa2c65`.

Scope: Miri's `alloc/*`, `alloc_addresses/*` and `borrow_tracker/mod.rs`, filled into the miri-contract skeleton.

## Files touched

- Ported (the skeleton's stub modules, now filled):
  - `src/miri/alloc/alloc_bytes.ts`
  - `src/miri/alloc/mod.ts`
  - `src/miri/alloc_addresses/address_generator.ts`
  - `src/miri/alloc_addresses/reuse_pool.ts`
  - `src/miri/alloc_addresses/mod.ts`
  - `src/miri/borrow_tracker/mod.ts`
- New tests:
  - `src/miri/alloc_addresses/address_generator.test.ts`: upstream's `test_align_addr`, plus `generate`'s error paths.
  - `src/miri/alloc_addresses/addresses.oracle.test.ts` with the fixture `addresses.oracle.txt` (oracle replay, below).
  - `src/miri/borrow_tracker/mod.test.ts`: the borrow-tracker global state and dispatch.
- **Contract fix, outside my files (please review):**
  - `src/rust_ts/miri_stub.ts`: new `port_methods`, explained below.
  - `src/miri/machine_contract.test.ts`, one line. It asserted that `AllocBytes_MiriAllocBytes.zeroed` is still an
    `unported` stub. It now asserts the ported behaviour: a zero-sized allocation is an empty `MiriAllocBytes`.
- `docs/handoff/miri-alloc-probe/{Cargo.toml,main.rs}`: the source of the oracle probe. It is not registered under
  `tools/probes`; that is a harness item.
- This file.

No `.gen.ts` changed, and no tools/codegen, harness or scripts file changed.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23259; vendor 5050)`. As before, this checks only the
  `compiler/` markers. `src/miri/contract.test.ts` checks the Miri markers against upstream, and it passes.
- `bun scripts/coverage.ts --missing src/tools/miri/src/<file>`:

  | file | ported |
  |---|---|
  | `alloc/alloc_bytes.rs` | 9/9 |
  | `alloc/mod.rs` | 4/4 |
  | `alloc_addresses/mod.rs` | 14/14 |
  | `alloc_addresses/address_generator.rs` | 5/5 |
  | `alloc_addresses/reuse_pool.rs` | 5/5 |
  | `borrow_tracker/mod.rs` | 36/36 |
  | `alloc/isolated_alloc.rs` | 0/20, out of scope (decision C6, see below) |

- Codegen: `bun tools/codegen/types.ts miri` regenerates with no diff. It reports 0 unknown types, missing debug 13 and
  missing clone 2, the same as before.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri src/vendor/rand src/vendor/rand_core src/vendor/chacha20`: 101 pass,
  0 fail (16 files).
- `bun scripts/difftest.ts --suite mir --sample 50` (agent `miri-alloc`): MATCH=50 DIFF=0 UNPORTED=0
  (run `20261101-125512-miri-alloc-qmba`). Nothing outside `src/miri` calls this code yet, so this is only a check that
  nothing else moved.

### Oracle check of address assignment (`addresses.oracle.test.ts`)

**How the fixture was made.**
- The probe is in `$RUST_TS_DATA/tmp/miri-alloc/probe`, with a copy in `docs/handoff/miri-alloc-probe/`. It contains
  upstream's `align_addr` / `AddressGenerator::generate` / `get_remaining`, `ReusePool::{subpool, add_addr, take_addr,
  address_space_shortage}`, and the reuse-or-generate choice of `addr_from_alloc_id_uncached` and `free_alloc_id`.
- These are copied with the rustc types replaced: Size/Align become u64, ThreadId becomes u32, VClock becomes the donor
  thread, MemoryKind becomes Stack/Heap.
- It is built against the **real rand 0.10.1** `StdRng::seed_from_u64`, using upstream's `Cargo.lock` (the vendor-rand
  probe setup). The command was `cargo +nightly-2026-10-11 build --release --offline`; no toolchain components were
  touched.
- It prints a scripted sequence of allocations and frees with each result, then `tail=<next_u32>` so the number of draws
  is checked too.

**Scenarios.**
- `default`: seed 0, start `0x20000` (Miri's `stack_addr`), end `u64::MAX`, rates 0.5 / 0.1. These are Miri's defaults.
- `seed42`: the same with seed 42.
- `reuse`: rates 1.0 / 0.5.
- `noreuse`: rates 0 / 0.
- `tiny`: end `0x8000`. Reaches `address_space_shortage` and then `AddressSpaceFull`.
- `poolfull`: one subpool past `MAX_POOL_SIZE`, then reuse from the full pool.

**What the test runs.** It replays the script through the **ported** functions:
- `InterpCx.prototype.addr_from_alloc_id`, which exercises the cache, `int_to_ptr_map` insertion, `_uncached`, the
  `take_addr` / `generate` choice and the shortage switch.
- `MiriMachine.prototype.free_alloc_id`, which exercises `int_to_ptr_map` removal, the `exposed` cleanup and `add_addr`.

It uses the vendored `StdRng`. `GlobalStateInner::new` is the real constructor, given a 64-bit `tcx` double. Every
address, every cross-thread `acquire_clock` and the rng tail match: 7 tests, 3107 expects.

**Mutation checks.** Shrinking the slack range from `0..16` to `0..15` makes all 6 scenarios fail (review check: 6 of 6, not 5). Disabling the
`MAX_POOL_SIZE` cap makes `poolfull` fail. The review found the `clamped_pos = 0` mutant is caught by `poolfull`. Removing
the `pos.min(len - 1)` clamp itself was not checked: the clamp only matters when the largest `(size, thread)` group of a
full pool has at most 1 entry, so its effect with these scripts is unmeasured.

**Limit.** This is upstream's algorithm with the real rand, not Miri itself. The end-to-end check (addresses in `{:p}`
and in UB messages from the Miri oracle) needs a running machine. That is for the integration of wave 36/37.

## `unported(...)` left

1. `miri::alloc_addresses::addr_from_alloc_id_uncached: native-lib mode (decision C6)`. This is the
   `!machine.native_lib.is_empty()` arm, which needs host addresses. It cannot be reached:
   `machine.native_lib: never[]`, and `-Zmiri-native-lib` is rejected in bin/miri.rs (C6).
2. `miri::alloc_addresses::get_global_alloc_bytes: native-lib mode (decision C6)`, the same.
3. `miri::alloc_addresses::ptr_from_addr_cast: throw_machine_stop!(TerminationInfo::Int2PtrWithStrictProvenance)`.
   - `impl MachineStopType for TerminationInfo` (diagnostics.rs:113, lane miri-driver) has no TS value yet.
   - It is reached only with `-Zmiri-strict-provenance`.
   - When miri-driver provides it, replace the stop with
     `Err(InterpErrorInfo_from_InterpErrorKind({ $: "MachineStop", _0: <TerminationInfo as MachineStopType> }))`.
- `alloc/isolated_alloc.rs` (434 lines, 20 fns) is **not ported**. It is compiled only with `native-lib` (C6), and the
  skeleton has no module for it (miri-contract "Scope"). The inline stub module of `alloc/mod.rs` is ported: its
  `IsolatedAlloc(!)` methods are `return this._0`, of type `never`.
- `dummy_alloc` is ported, but is only reached from unported item 1.

## Contract fix: deferred ports (`port_methods`, src/rust_ts/miri_stub.ts)

**The problem.** Upstream puts inherent impls of another file's class in these files:
- `impl MiriMachine { free_alloc_id }` in alloc_addresses/mod.rs.
- `impl machine::AllocExtra { borrow_tracker_sb, _sb_mut, _tb }` in borrow_tracker/mod.rs.

Assigning them at load (`MiriMachine.prototype.f = ...`) reads machine.gen.ts's class at top level. Init-order rule
C10 (2) forbids that, and it really fails. `machine.gen.ts` value-imports `borrow_tracker/mod.ts`, so
`borrow_tracker/mod.ts` runs before the class exists, and every test that loads `src/miri/lib.ts` fails with
`ReferenceError: Cannot access 'AllocExtra' before initialization`.

The stubs avoided this only because `stub_methods` takes a thunk and installs late.

**The fix.**
- `port_methods(path, () => Target.prototype, { f, g })` registers ported members.
- `install_miri_stubs()` (lib.ts) defines them first, then the placeholders, with the same strict checks:
  - a name already on the target throws;
  - a ported name still listed in a `stub_*` call makes the placeholder installation throw.
- It adds about 25 lines and changes no existing behaviour.
- Methods on `InterpCx.prototype` (rustc_const_eval is loaded first) and on a module's own generated classes need no
  deferral, and I kept those as plain assignments.

**Consequence.** Ported cross-module members exist only after `src/miri/lib.ts` has run, which is what every caller does
anyway. Unit tests import `../lib.ts`.

**For root.**
- Every wave-36 lane that ports an `impl` of another file's class hits this. Examples: diagnostics.rs
  `impl MiriMachine { emit_diagnostic }`, and the data race and thread impls on `MiriMachine` / `ThreadManager`.
- Please record a decision. Then either tell the other lanes to use `port_methods`, or merge this lane first.
- I checked the other wave-36 worktrees: none had touched `miri_stub.ts` or had another mechanism yet.

## Signature changes to the skeleton (contract)

- `AddressGenerator.new(addr_range: Range_u64)` and `get_remaining(): Range_u64`, where
  `Range_u64 = { start: bigint; end: bigint }` (exported from address_generator.ts). They were `Pending<"Range<u64>">`.
- `AddressGenerator.generate(size, align, rng: Rng)`, and `ReusePool.add_addr` / `take_addr`'s `rng: Rng`. They were
  `<R>` / `Pending<"impl Rng">`. `Rng` is `vendor/rand_core/lib.ts`'s.
- `AllocExtra.borrow_tracker_sb()` / `borrow_tracker_sb_mut()` now return `Stacks` (`stacked_borrows::AllocState`), and
  `borrow_tracker_tb()` returns `Tree`. They were declared as returning `borrow_tracker::AllocState`, which was wrong.
  There are no callers yet; **miri-sb** will be the first.
- Both `GlobalStateInner`s (alloc_addresses and borrow_tracker) gained `visit_provenance(visit)`, their
  `impl VisitProvenance`.
- A local `declare module` adds `Stacks.visit_provenance` and `Tree.visit_provenance`, marked
  `PORT(contract): pending miri-sb / miri-tb-b`. `VisitProvenance_AllocState` calls them; **miri-sb** must define
  `Stacks.prototype.visit_provenance` (stacked_borrows/mod.rs:456), and Tree Borrows (wave 38) does the same for `Tree`.
- New exports:
  - borrow_tracker/mod.ts: `display_AccessKind`, `VisitProvenance_FrameState`, `VisitProvenance_AllocState`, the
    `AllocState` companion (`before_memory_read/_write/_deallocation`, `remove_unreachable_tags`, `release_protector`)
    and the `BorrowTrackerMethod` companion with `instantiate_global_state` / `get_tree_borrows_params`.
  - address_generator.ts: `align_addr`.
  - alloc_addresses/mod.ts: `dummy_alloc`.
  - alloc_bytes.ts: `Layout`.
  - `MiriAllocBytes` methods: `clone`, `drop`, `deref`, `deref_mut`, and static `alloc_with`.

## Needs from other lanes (calls go through the skeleton's declarations)

- **miri-machine:**
  - `MiriMachine.new` must store the vendored `StdRng` in `rng`:
    `StdRng.seed_from_u64(config.seed ?? 0n)` (machine.rs:721).
  - `VisitProvenance for AllocExtra / FrameExtra` should call `VisitProvenance_AllocState` / `VisitProvenance_FrameState`.
  - Also needed: `get_default_alloc_params`, and the calls to `GlobalStateInner.new(config, stack_addr, tcx)`,
    `BorrowTrackerMethod.instantiate_global_state` and `free_alloc_id`.
- **miri-race:**
  - `GlobalDataRaceHandler::as_genmc_ref` / `as_vclocks_ref` (data_race_handler.rs:47 / :39) are not declared. My code
    reads them as their `match` (`data_race.$ === "Genmc"` / `"Vclocks"`), marked `PORT(contract): pending miri-race`.
    Switch to the companion fns when they exist.
  - Also used: `GlobalState.release_clock`, `acquire_clock`, `clone_VClock`.
- **miri-driver:**
  - `SpanDedupDiagnostic.new` and `dedup_diagnostic`. The static `DEDUP` is created on first use (C10).
  - `MiriMachine.emit_diagnostic`, `LiveAllocs.is_live`, and `MachineStopType for TerminationInfo` (unported item 3).
- **miri-threads:** `active_thread()` and `ThreadManager.active_thread_()`.
- **miri-sb:**
  - `Stacks.new_allocation`, `before_memory_*`, `remove_unreachable_tags`, `visit_provenance` (above).
  - `sb_retag_ptr_value`, `sb_protect_place`, `sb_expose_tag`, `print_stacks`.
- **Root (tools/codegen, data only):**
  - Map `rand::rngs::StdRng` to the vendored `StdRng` in `miri.typemap.json`. It is still `Pending`, so the code reads it
    through a one-line cast, `machine_rng(machine)` in alloc_addresses/mod.ts; drop the cast after the mapping.
  - Optionally map `std::alloc::Layout` to `alloc_bytes.ts`'s `Layout`, or to a `src/std` stand-in if you move it there.
- **Harness:** register the probe as `tools/probes/<name>` so that it regenerates `addresses.oracle.txt`. The fixture
  is committed until then, as `stdrng.oracle.txt` is. The probe needs `rand = "=0.10.1"` and upstream's `Cargo.lock`.

## `// PORT:` decisions (in code)

1. `MiriAllocBytes` and host memory (alloc_bytes.ts header):
   - The storage is an `ArrayBuffer`, and the null pointer is `undefined` (an allocation the engine refuses with a
     `RangeError`, or one past 2^53 bytes).
   - `alloc` and `alloc_zeroed` behave the same, because JS zero-fills.
   - `ptr` is 0, since nothing reads it without native-lib.
   - `Drop` frees nothing and never runs implicitly.
   - `Deref` / `as_ptr` are the value itself.
   - `u64` → `usize` never fails, because the host is 64-bit.
2. `std::alloc::Layout` is a local stand-in with bigint `size` / `align`. Its `from_size_align` / `is_size_align_valid`
   carry `// std:` markers.
3. `IsolatedAlloc(!)` methods are `return this._0`, of type `never` (alloc/mod.ts).
4. Addresses are bigints (C5). `checked_add` / `strict_add` are explicit checks against `u64::MAX`:
   - an overflow in `generate` is `AddressSpaceFull`;
   - an overflow in `align_addr` panics "attempt to add with overflow".
5. `(Size, ThreadId)` order is the derived lexicographic `Ord`: `Size_cmp`, then `ThreadId._0`. `ThreadId` equality
   compares `_0`.
6. Native-lib arms stop `unported` (C6). `exposed_allocs` returns the `Set`'s insertion order; the `FxHashSet` order
   matters only for native-lib.
7. `RefCell` / `Box` are erased in borrow_tracker. `with_retag_mode` writes the mode on the same object, as
   `mem::replace` does.
8. `eprintln!` is a local synchronous fd-2 write, as in rustc_mir_transform/pass_manager.ts.
9. Panic texts of `unwrap()` / `unwrap_err()` / `try_insert().unwrap()` follow std's `Debug`, for example
   `OccupiedError { key: .., old_value: .., new_value: .., .. }`.
10. `trace!` / `info!` lines are verbatim comments, and `enter_trace_span!` is a comment (A6; lane miri-log converts
    the one `info!`, borrow_tracker/mod.rs:282).
11. `port_methods` for cross-module impls (above).
