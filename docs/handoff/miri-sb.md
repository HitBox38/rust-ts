# Handoff: lane `miri-sb` (M6 wave 36, Miri core)

Stacked Borrows (`borrow_tracker/stacked_borrows/{mod,item,stack,diagnostics}.rs`) and weak memory
(`concurrency/weak_memory.rs`), 2,724 upstream lines, filled into the miri-contract skeleton. Branch `t3/074569f7`.

## Files touched

- `src/miri/borrow_tracker/stacked_borrows/item.ts`: ported (stub replaced).
- `src/miri/borrow_tracker/stacked_borrows/stack.ts`: ported.
- `src/miri/borrow_tracker/stacked_borrows/mod.ts`: ported.
- `src/miri/borrow_tracker/stacked_borrows/diagnostics.ts`: ported.
- `src/miri/concurrency/weak_memory.ts`: ported.
- New tests: `stacked_borrows/item.test.ts`, `stacked_borrows/stack.test.ts`, `concurrency/weak_memory.test.ts`.
- `docs/handoff/miri-sb.md` (this file).

No `.gen.ts`, no other lane's file, nothing under `tools/`, `harness/` or `scripts/` was edited.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23281; vendor 5050)`.
- `--missing`:

  | file | fns |
  |---|---|
  | `stacked_borrows/item.rs` | 8/8 ported |
  | `stacked_borrows/stack.rs` | 16/16 ported |
  | `stacked_borrows/mod.rs` | 23/23 ported |
  | `stacked_borrows/diagnostics.rs` | 25/25 ported |
  | `concurrency/weak_memory.rs` | 16/16 ported |

  That is 88/88, the lane's share in the miri-contract table.
- Codegen: `bun tools/codegen/types.ts miri` regenerates with no diff. It reports 0 unknown types, missing debug 13 and missing clone 2, the same as before.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri`: 37 pass, 0 fail, across 5 files. That includes the contract tests (every module loads as a fresh entry point, no stub collisions).
- Sample difftests (agent `miri-sb`):
  - `--suite mir --sample 100`: MATCH=100, DIFF=0 (run `20261101-125451-miri-sb-fam6`). Nothing outside Miri changed.
  - `--suite miri-hello`: UNPORTED=1 (run `20261101-125535-miri-sb-rtcn`). It stops at `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate`, because the Miri driver is not wired yet (lane miri-driver). It does not reach SB.

### Unit tests (upstream has no `#[cfg(test)]` in these five files)

- **`item.test.ts` (7 tests).**
  - Packing round-trips for tags 1, 2^32, 2^49, TAG_MASK−1 and TAG_MASK, crossed with all 4 permissions and both protector values.
  - The top word is exactly 2^53−1.
  - Distinct (tag, perm, protected) triples give distinct words.
  - `set_permission` changes only the permission bits.
  - Upstream's `to_bits` / `from_bits` values.
  - Debug output `[SharedReadOnly for <7>]`.
  - A tag past TAG_MASK throws `Unported`.
- **`stack.test.ts` (11 tests).**
  - **Grant/access sequences** on hand-built stacks, with the stack contents written out after each step: Unique, SRO, an SRW inserted below an SRO, a write popping an SRO, a read disabling a Unique, and a write popping across a Disabled.
  - **`error_cause` texts.**
  - **Byte-exact history texts**:
    - creation;
    - retag invalidation;
    - FnEntry invalidation, which says "inside this call" and carries the caller span;
    - root tag "as the root tag for alloc7";
    - "is this argument";
    - zero-size retag;
    - the split creation event of a freeze-sensitive retag, with upstream's ranges `[0x0..0x4]` / `[0x4..0xc]` (the new event's size is the previous *end*).
  - **Wildcard → unknown bottom.**
  - **Protectors**: strong protectors give UB; a weak protector allows dealloc through its own tag but not through its parent.
  - **Tracked-tag `PoppedPointerTag` causes.**
  - **A 59-item SRW group** that exercises the cache.
  - **A randomized property test**: 40 seeds × 400 ops of grant, read, write and GC, on stacks up to 41 items (above CACHE_LEN = 32). About 3k of the ops hit error paths. After every step it runs upstream's own `verify_cache_consistency`. The cached `find_granting_tagged` must always equal the linear search, and a refused op must leave the stack unchanged.
- **`weak_memory.test.ts` (7 tests).** Hand-built store buffers, checking which values a load can read: CoWR, CoRR, `load_impl`'s first-timestamp `try_insert`, SC fences (`write_seqcst` / `read_seqcst`), SC loads, the "last SC-marked store" filter, and the inclusive take-while.
  - Also tested: `store_impl`'s SC marking (happens-before and coherence-before), the 128-element bound, the Latest/Outdated report, and draws that are deterministic per seed (vendor `StdRng`).
  - miri-race's vector-clock accessors are not ported yet. The test installs their upstream bodies only while they are missing or are still placeholders, and restores the prototypes afterwards.

## cfg: what the release Miri compiles (for root to record)

The rustup `miri` component (the oracle) is built with Miri's default cargo features, `default = ["stack-cache", "native-lib"]` (src/tools/miri/Cargo.toml:73). Bootstrap's `tool_rustc_extended!(Miri ..)` adds none.

So:
- `#[cfg(feature = "stack-cache")]` code is ported as compiled: `StackCache`, `unique_range`, `find_granting_cache`, `insert_cache`, and the cache repair in `retain`, `disable_uniques_starting_at` and `pop_items_after`.
- The `cfg(not(stack-cache))` lines are comments.
- `expensive-consistency-checks` is off. `verify_cache_consistency` is ported (the tests use it), but its call sites are comments.

This matches `typemap.miri.json`'s cfg table.

## Item packing (decision 2026-11-01, followed exactly)

`Item._0` is a `number`:
- tag in bits 0-49 (`TAG_MASK = 2^50 − 1`, exported);
- permission in bits 50-51;
- protector in bit 52.

It is built only with arithmetic: `% 2^50`, `/ 2^50`, `>= 2^52`. There are no 32-bit bitwise ops.

`Item::new`'s `assert!(tag <= TAG_MASK)` checks the lowered bound and stops `unported` past it, never with a panic. The derived `PartialEq` is `Item_eq` (`a._0 === b._0`).

`Item` is `Copy` but its class is mutable (`set_permission`). So every Rust copy that stays live next to its source is a `clone_Item`:
- the cache slots;
- `Stack::get`;
- the per-stack `item` in `for_each(.. grant ..)`;
- `AllocHistory.root`;
- `PoppedPointerTag`.

The vector moves in `retain` / `pop` do not clone.

## `unported(...)` left (all mine)

1. `Item::new` with a tag above 2^50−1 (the decision above).
2. **PORT(contract) lookups of other lanes' undeclared impls.** Each is read from the owning module's namespace at call time and stops `unported` naming the lane until that lane exports it under this name:
   - `display_AccessKind(kind)`: borrow_tracker/mod.rs:21, lane **miri-alloc**. SB access-error and invalidation texts need it.
   - `TerminationInfo_as_MachineStopType(info): MachineStopType`: diagnostics.rs:113, lane **miri-driver**. This is the `err_machine_stop!` box (`ConstEvalErrKind_as_MachineStopType` precedent). Every SB UB report goes through `err_sb_ub` and needs it.
   - `VisitProvenance_Scalar.visit_provenance(self, visit)`: provenance_gc.rs:125, lane **miri-driver**. `impl VisitProvenance for StoreBufferAlloc` needs it.

   Until they land, SB *decides* errors exactly (the tests check this), but building the report stops UNPORTED.

## Contract changes (signatures others might call)

- **Private core ops of mod.rs's `impl Stack`.**
  - `find_first_write_incompatible`, `item_invalidated`, `access`, `dealloc` and `grant` are now exported module fns `Stack_<name>(stack, ..)`. `Permission::grants` is `Permission_grants(perm, access)`. They are no longer `Stack` members or a companion method.
  - **Why:** assigning another module's class prototype at load reads that module's value at top level (C10). It fails in the ESM cycle stack.gen.ts → borrow_tracker/mod.ts → … → stacked_borrows/mod.ts when stack.ts is the entry point.
  - They are private upstream, so no other lane calls them. Their declarations and stubs are removed.
- **Added members:** `Stacks.visit_provenance` and `StoreBufferAlloc.visit_provenance` (their `VisitProvenance` impls).
- **`Pending` types corrected:**
  - `DiagnosticCx.start_grant(perm: Permission)` and `Stacks.new(.., perm: Permission, ..)`.
  - weak_memory: `DataRaceState` → data_race `GlobalState`, `Ref<StoreBuffer>` → `StoreBuffer`, `impl Rng` → rand_core `Rng`.
  - `fetch_store` is no longer generic; `pop_items_after`'s visitor is `(Item) => InterpResult`.
- **New exports:**
  - item.ts: `Item_eq`, `TAG_MASK`, and the `Permission` companion with `UNIQUE`..`DISABLED`, `to_bits` and `from_bits`.
  - stack.ts: `Stack_eq`.
  - diagnostics.ts: `err_sb_ub`, `display_InvalidationCause`, `error_cause`.
  - mod.ts: the `NewPermission` companion (`from_ref_ty`, `from_box_ty`, `protector`), `Permission_grants` and `Stack_*`.

## Missing or mis-declared signatures in other lanes' files (not edited; please fix there)

- **miri-alloc, borrow_tracker/mod.ts:**
  - `AllocExtra.borrow_tracker_sb()` / `borrow_tracker_sb_mut()` are declared returning `borrow_tracker::AllocState` (the enum). Upstream returns `&RefCell<stacked_borrows::AllocState>`, i.e. `Stacks`. mod.ts reads the result through `sb_state()` as `Stacks`, so the impl must return the variant's `_0`.
  - Export `display_AccessKind`.
- **miri-driver:**
  - diagnostics.ts: export `TerminationInfo_as_MachineStopType`.
  - provenance_gc.ts: export `VisitProvenance_Scalar`.
  - range_object_map.ts: `remove_pos_range` takes `Pending<"Range<Position>">`, but `{ start, end }` is passed (cast). `impl Index<Position>` is not declared, so it is inlined as `m.v[pos].data`.
  - dedup_range_map.ts: the `iter*` fns yield `Pending<"ops::Range<u64>">`, read as `{ start: number; end: number }` (cast). **Important:** `DedupRangeMap.new(size, init)` / `iter_mut` split elements, and upstream clones `T` there (`T: Clone`). For `T = Stack` the split must deep-copy (`clone_Stack`: borrows, cache and unique_range). Sharing one `Stack` object between two ranges would silently corrupt SB. The declared `new` has no clone parameter, so the lane must add one (or equivalent) and SB's call site will pass `clone_Stack`. Today mod.ts calls `DedupRangeMap.new(size, stack)` as declared.
- **miri-race:**
  - vector_clock.ts does not declare `impl Index<VectorIdx> for VClock` (:428), `VTimestamp::ZERO` (:70), `Ord for VTimestamp` (:123) or `From<u32> for VectorIdx` (:39). weak_memory.ts writes them from their upstream bodies over the declared `as_slice` / `to_u32` / `time` / `VTimestamp.new` (`vclock_index`, `VTimestamp_ZERO`, `VTimestamp_le`, `new VectorIdx(0)`). Swap these for miri-race's impls when they land.
  - data_race_handler.ts: `as_vclocks_ref` / `as_vclocks_mut` / `as_weak_memory_ref` are one-arm `if let`s, inlined in mod.ts / weak_memory.ts.
  - data_race.ts: `GlobalState.active_thread_state` returns `Pending<Ref<ThreadClockSet>>`, read as `ThreadClockSet`.
- **Interpreter typing (interp-generic leftovers):** `InterpCx.size_and_align_of_val`, `ImmTy.from_immediate` and `frame_mut()` are typed with CTFE defaults. They are cast at the SB call sites, each with a `PORT` note.
- **Generated `clone_LoadInfo`** copies `timestamps` into a plain `Map` (via `clone_HashMap`), which loses the `KeyedMap` keying (below). It only runs on a `StoreBufferAlloc` clone, which never happens (`AllocExtra` is never cloned).

## `// PORT:` decisions in code

1. The Item repacking (item.ts header) and `clone_Item` at each copy.
2. The cfg choice (stack.ts header).
3. `[Item; 32]` / `[usize; 32]` are fixed-length arrays. `copy_within` maps to `copyWithin`, and `rotate_left(1)` on a sub-slice is an explicit loop.
4. In mod.ts, the read-only `self.get(i)` uses in `find_first_write_incompatible` and the wildcard upper bound read the slot directly instead of cloning. Behaviour is identical; this is the hot write path.
5. The private `impl Stack` ops and `grants` are module fns (C10, above).
6. `static DEDUP: AtomicBool` is a module-level `let`.
7. `print!` is `stdout_write_all`, and a failed write panics.
8. weak_memory: `VecDeque` is an array.
9. weak_memory: the `iter().rev().take_while().filter()` chain is one `RustIterator` with core's exact size hints, which `IteratorRandom::choose`'s RNG draws depend on. `Filter` is `(0, upper)`; `TakeWhile` is `(0, Some(0))` once done.
10. weak_memory: `std::ptr::eq` is `===`.
11. weak_memory: `LoadInfo.timestamps` is a `KeyedMap` keyed by `VectorIdx._0`. The generated `VectorIdx` is a class, so a plain `Map` would compare by identity. The map is only probed or scanned with `any`, so its order never shows.
12. `AllocRange` copies share the object; nothing mutates one in place.
13. The PORT(contract) lookups and inlines listed above.

Logging: these files have no `info!` lines. The `trace!` lines are verbatim comments.

## For root

- Record the cfg finding: the release Miri has `stack-cache` on and `expensive-consistency-checks` off.
- Route the signature fixes above to miri-alloc, miri-driver and miri-race. The `DedupRangeMap` clone issue matters for correctness.
- If the guarded namespace lookups end up under different names, update the three call sites in diagnostics.ts / weak_memory.ts. Each one stops `unported` until then, so nothing breaks silently.
