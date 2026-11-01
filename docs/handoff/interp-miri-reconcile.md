# Handoff: lane `interp-miri-reconcile` (✱ contract integration, M6 wave 35)

Branch `t3/reconcile-interpreter-miri-contract` (worktree t3-5057006e). Merged `integ-w35` (`02ab6c6e`), then
`t3/generalize-interpreter-machine` (interp-generic), then `t3/miri-contract-skeleton` (miri-contract). The one textual
conflict was the header comment of rustc_const_eval `interpret/memory.ts`, and it came up in the interp-generic merge, not
the miri-contract one. I kept interp-generic's `Cow` bullet and integ-w35's followups-34 bullets (the
`UndefinedBehaviorInfo` fields are exact `bigint`s, `i64_try_from_size`), as the review says. The code uses
`i64_try_from_size`; `i64_number` is used nowhere.

Before the work, the merged tree had 89 tsc errors, as the miri-contract review predicted. It now has 0, and the
silent mismatches the review lists (M5, plus the ones below) are fixed.

## What was done

### interp-generic B1 + N1 (provenance impl at the raw-bytes accessors)
- `interpret/memory.ts` `get_alloc_bytes_unchecked_raw` / `get_alloc_bytes_unchecked_raw_mut` pass
  `this.machine.Provenance` (upstream memory.rs:746 / :849 → allocation.rs:661 / :653 `assert!(Prov::OFFSET_IS_ADDR)`).
- **N1 taken.** The CTFE-default overloads on `Allocation` are gone: `get_bytes_strip_provenance`,
  `get_bytes_unchecked_raw(_mut)` and `read_scalar` now always take the `Prov` descriptor. `Prov_default` is removed and
  the allocation.ts header is updated.
  - tsc then flagged exactly the 2 B1 sites and the 4 tcx-allocation callers. Those callers now pass
    `Provenance_CtfeProvenance`: `mir/consts.ts:239/242`, `mir/pretty.ts:2406` and `ty/print/pretty.ts:4560`. Upstream
    they read `ConstAllocation`s, whose provenance is `CtfeProvenance`.
  - The two tests that relied on the default (`allocation.test.ts`, `machine_generic.test.ts`) pass it explicitly.
  - Churn: 6 call sites and 2 tests. Any future interpreter call that leaves the descriptor out is now a tsc error.

### interp-generic B2 = miri-contract M6 (`M::MemoryKind: MayLeak + Display + Eq` through the machine)
- `Machine<T>` has three new members, matching upstream's bound `type MemoryKind: Debug + Display + MayLeak + Eq`
  (machine.rs:117):
  - `MayLeak_MemoryKind: MayLeak<T["MemoryKind"]>`
  - `display_MemoryKind(kind, f)`
  - `MemoryKind_eq(a, b)`
- `Machine_provided` declares them abstract. `compile_time_machine` sets them to const_eval's `MayLeak_MemoryKind` and
  `display_MemoryKind`, plus a new `MemoryKind_eq` (the derived `PartialEq` of `const_eval::MemoryKind`, in
  const_eval/machine.ts).
- They are used at these sites:
  - `take_leaked_allocations` (upstream memory.rs:1173): `kind.may_leak()`. Also the `Some(kind) == global_kind` root
    test, which was the CTFE-only `MemoryKind_eq` before. On a Miri kind (a string), that old eq said every machine kind
    equals `Global`.
  - `deallocate_ptr` (memory.rs:418): `alloc_kind != kind` and both `{kind}`s.
  - `DumpAllocs` (memory.rs:1291): `({kind}, `.
- `memory.ts` `MemoryKind_eq` is now generic: derived `PartialEq` of `MemoryKind<T>`, with `T_eq` taken from the machine.
  `display_CtfeMemoryKind` is removed.
- `Debug` of `M::MemoryKind` is not a member. The interpreter prints it only in `trace!`, which is not ported (PORT note
  on the interface).
- CTFE behaviour is unchanged: the same impls are reached, now through the machine.
- The CTFE-only sites I left alone (`make_const_heap_ptr_global`, intern.ts `prepare_alloc`) are CTFE in upstream too
  (`M: Machine<MemoryKind = const_eval::MemoryKind>`).

### miri-contract M1 (`MiriInterpCx = InterpCx<MiriMachine>`)
- `src/miri/machine.ts` now has:
  - `MiriMachineTypes`, with `MemoryKind = MiriMemoryKind`, `Provenance`, `ProvenanceExtra`, `ExtraFnVal = DynSym`,
    `FrameExtra`, `AllocExtra`, `Bytes = MiriAllocBytes`, **`AllocParams = MiriAllocParams`** and
    `MemoryMap = MonoHashMap<AllocId, [MemoryKind, Allocation<Provenance, AllocExtra, MiriAllocBytes>]>`.
  - `interface MiriMachine extends Machine<MiriMachineTypes> {}`, a declaration merge on the generated class.
  - `MiriInterpCx = InterpCx<MiriMachine>`.
- The associated items of machine.rs:1133-1149 are read-only prototype members, set with `define_assoc`
  (src/rust_ts/provided.ts):
  - the `MemoryKind` impls (`MayLeak_MiriMemoryKind`, `display_MiriMemoryKind`, `===`)
  - `Provenance = Provenance_Provenance`
  - `MemoryMap_default = MonoHashMap.default()`
  - `GLOBAL_KIND = "Global"`
  - `PANIC_ON_ALLOC_FAIL = false`
  - `ALL_CONSTS_ARE_PRECHECKED = true` (the default)
  - `Bytes = AllocBytes_MiriAllocBytes`, a lazy getter, because it is another module's value (C10).
- Every fn of `impl Machine for MiriMachine` (52 names, upstream order; `stack` is `stack_`) is an `unported` stub:
  `stub_methods("miri::machine::MiriMachine (impl Machine)", ...)`, owned by lane miri-machine.
- A type-level check is in `machine_contract.test.ts`: `ProvOf<MiriMachine>` is `Provenance`, and
  `MachineTypesOf<MiriInterpCx["machine"]>` is `MiriMachineTypes`.

### miri-contract M2
- All 60 Miri `declare module` headers are `interface InterpCx<M extends AnyMachine = Machine>`. This alone removed the
  81 TS2428 errors.

### miri-contract M3
- `Provenance_Provenance` is an `ObjectProvenance<Provenance>`:
  - `eq`: derived `PartialEq`. Same variant, and for `Concrete` the same `alloc_id` and `tag`.
  - `debug: debug_Provenance`.
  - `owns`: `$` is `Concrete` with `alloc_id` / `tag`, or `$` is `Wildcard`.
- `register_object_provenance(Provenance_Provenance)` runs when machine.ts loads.

### miri-contract M4 + M5 (provenance parameters)
- `tools/codegen/miri.typemap.json`:
  - `ImmTy<$0>` / `OpTy<$0>` / `FnArg<$0>` / `PlaceTy<$0>` / `MPlaceTy<$0>`, with `debug_X($v, $f, $d0)` and
    `clone_X($v, $c0)`.
  - `Frame<$0, $1>`.
  - The header note is updated.
- Set `miri` was regenerated. Six generated files changed, e.g. `debug_ImmTy(v.argc, f, debug_Provenance)` and
  thread.gen.ts `stack: (Frame<Provenance, FrameExtra>)[]`.
- lib.ts aliases: `ImmTy = interpret.ImmTy<Provenance>`, and likewise `OpTy`, `FnArg`, `PlaceTy` and `MPlaceTy`.
- **M5 hand sites (tsc does not flag these; found by grep):** `Frame<FrameExtra>` → `Frame<Provenance, FrameExtra>` at
  helpers.ts:141, borrow_tracker/mod.ts:96 and concurrency/thread.ts ×5.
- **More silent CTFE defaults, found by grep:**
  - helpers.ts: `Writeable` ×4 / `Projectable` ×4 → `Writeable<unknown, Provenance>` / `Projectable<unknown, Provenance>`
    (upstream `impl Writeable<'tcx, Provenance>`).
  - diagnostics.ts `report_leaks`: `Allocation` → `Allocation<Provenance, AllocExtra, MiriAllocBytes>` (diagnostics.rs:513).
- **N3 needs no change.** helpers.ts:145 `user_relevance(frame: Frame<Provenance>)` is right. Upstream helpers.rs:1045 is
  `&Frame<'tcx, Provenance>`, so Extra is `()`: it is called from `init_frame` on the not-yet-extended frame. With
  interp-generic's `Frame<Prov, Extra = null>` this is already correct.

### miri-contract M7 (provided defaults on generated classes)
- **Choice: a mixin, not a codegen option.** New helper `src/rust_ts/provided.ts` (our own code):
  - `provide_defaults(Target.prototype, Trait_provided.prototype, overridden)` copies every provided method except the
    names the upstream impl defines itself.
  - It is strict. A name in `overridden` that is not a provided method throws, and so does a copied name that the target
    already has.
  - The impl's own methods are `unported` stubs, so the mixin and the stub installer never collide.
- `MiriMachine` gets `Machine_provided`'s `load_mir`, `increment_const_eval_counter`, `before_access_global` and
  `before_alloc_access`. The other 21 provided fns are overridden by machine.rs:1133.
- `MonoHashMap` (data_structures/mono_hash_map.ts):
  - It merges `interface MonoHashMap<K, V> extends AllocMap<K, V>`.
  - It gets `AllocMap_provided`'s `get_mut`. `get` is the impl's (:98).
  - The 8 impl fns and `default` (:35) are `unported` stubs for miri-driver.
- **Recorded choice:** the mixin keeps tools/codegen unchanged and works for any generated class. An `extends` codegen
  option would need a harness-reviewed tools batch.

### Decision C5 amendment (four hot fields → `number`) and C4
- `miri.typemap.json` `fields` gives four fields a `number` type through three new set-local type entries:
  - `rust_ts::miri_u64_number`: `MiriMachine.basic_block_count` and SB `Item._0`.
  - `rust_ts::miri_cell_u128_number`: `MonotonicClockKind::Virtual.nanoseconds`, a `Cell<u128>`. Debug stays
    `Cell { value: n }`.
  - `rust_ts::miri_range_u64_number`: `dedup_range_map::Elem.range`, as `{ start: number; end: number }`.
- Regenerated. The diff is exactly those 4 field types.
- A `PORT:` note in each owning hand module tells its fill lane what to do:
  - **item.ts (miri-sb):** upstream packs bits 61-63, which a double cannot hold. Item's packing is private (only
    `PartialEq`/`Hash`/accessors/Debug), so it must be repacked below 2^53 with arithmetic, e.g. tag in bits 0-49,
    perm in 50-51, protector in 52, with `TAG_MASK = 2^50 - 1`.
  - **clock.ts (miri-eval):** only the clock counter is `number`. `InstantKind::Virtual.nanoseconds` stays `bigint`,
    because it `saturating_add`s program durations. Convert with `BigInt(n)`.
  - **dedup_range_map.ts (miri-driver):** the ranges are offsets inside one allocation.
  - **machine.ts header:** `basic_block_count`.
- **C4:** parsing is not in the skeleton. bin/miri.rs:586 belongs to miri-driver, so src/miri/bin/miri.ts now has a
  `PORT` note: parse `-Zmiri-track-pointer-tag` values as bigint, check nonzero on the bigint, and never `Number(..)` a
  value above 2^53−1. Such a tag can never be reached; handle it explicitly and record the choice.

### Nits
- **miri-contract N1:** done. `machine_contract.test.ts` has a subprocess test. It loads rustc_const_eval, snapshots
  every own property of `InterpCx.prototype`, `Machine_provided.prototype` and `AllocMap_provided.prototype`, loads
  `src/miri/lib.ts`, and asserts that none changed and that more than 390 were added.
- **miri-contract N3:** no change needed (above).
- **miri-contract N5:** done.
  - `MiriAllocBytes` is now `class MiriAllocBytes extends Uint8Array`, with the `layout` / `ptr` / `params` fields
    declared. `Symbol.species` is `Uint8Array`, so views are plain.
  - `AllocBytes_MiriAllocBytes` is a stub table (4 fns, `unported` naming lane miri-alloc).
  - The `MiriAllocBytes` exports in alloc/mod.ts and lib.ts became value exports.
- **miri-contract N6:** done. typemap.miri.json says its `cfg` names are global.
- **miri-contract N7:** done. `AllocParams` was added to docs/handoff/miri-contract.md contract item 1, along with a note
  that items 1-5 are reconciled.
- **interp-generic N4:** done. provenance_map.ts `read_ptr` uses `Prov.WILDCARD`, the passed descriptor, as upstream
  line 215 does. The unused `provenance_of` import was dropped.
- **interp-generic N5:** done. The unused `Provenance_CtfeProvenance` imports in place.ts and validity.ts were removed.
- **Not done (not in this lane's list):**
  - interp-generic N2 (`Cow_into_owned_Allocation` clones `Extra` by identity; unreachable for Miri, whose
    `adjust_global_allocation` returns `Owned`).
  - interp-generic N3 (`mir/pretty.ts:174` `debug_prov`, which should use `debug_provenance` for `miri_print_alloc`).
  - miri-contract N2 (bin crate must not use `stub_*`) and N4 (`bin/log/*` lane ownership).

## Files touched

- rustc_const_eval:
  - interpret/machine.ts (members, header)
  - interpret/memory.ts (B1, B2, header conflict)
  - const_eval/machine.ts (`MemoryKind_eq`)
  - interpret/place.ts, interpret/validity.ts (imports)
  - interpret/machine_generic.test.ts (descriptor args)
- rustc_middle:
  - mir/interpret/allocation.ts (overloads removed)
  - mir/interpret/allocation/provenance_map.ts (N4)
  - mir/consts.ts, mir/pretty.ts, ty/print/pretty.ts (pass `Provenance_CtfeProvenance`)
  - mir/interpret/allocation.test.ts
- src/miri:
  - machine.ts (M1, M3, M7, C5 note)
  - lib.ts (aliases)
  - alloc/alloc_bytes.ts (N5, stub table), alloc/mod.ts
  - data_structures/mono_hash_map.ts (M7)
  - diagnostics.ts, helpers.ts, borrow_tracker/mod.ts, concurrency/thread.ts (silent defaults)
  - borrow_tracker/stacked_borrows/item.ts, clock.ts, data_structures/dedup_range_map.ts, bin/miri.ts (PORT notes)
  - the 60 `InterpCx` headers (M2)
  - 7 regenerated `.gen.ts`
  - **new** machine_contract.test.ts
- src/rust_ts/provided.ts (**new**, our own code).
- tools/codegen/miri.typemap.json (M4/M5, C5 fields), tools/codegen/typemap.miri.json (N6 comment). These are
  tools/codegen data edits; the generator is unchanged.
- docs/handoff/miri-contract.md (N7), this file.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors (89 after the raw merge).
- `bun scripts/coverage.ts --check --offline`: `markers ok (23193; vendor 5050)`.
- Codegen: `bun tools/codegen/types.ts` for `miri`, `rustc_const_eval_interpret`, `rustc_const_eval`, `rustc_middle_mir`,
  `rustc_borrowck` and `rustc_mir_transform` leaves the tree byte-identical after the committed regeneration (no diff).
  Each reports 0 unknown types. Set `miri`: missing debug 13, missing clone 2, the same as miri-contract's.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_const_eval src/rustc_middle src/rustc_mir_transform src/miri tools/codegen`:
  549 pass, 0 fail (79 files).
- MayLeak unit test: `src/miri/machine_contract.test.ts` "B2/M6". A Miri-shaped machine (a CTFE stand-in with
  `MiriMachine`'s `MayLeak` / `Display` / `Eq` and `GLOBAL_KIND`):
  - `take_leaked_allocations` reports only the unreachable `Rust` / `C` / `Runtime` / `Stack` allocations.
  - The `Machine` / `Tls` kinds may leak, and `Global` is a root.
  - The dealloc error is "which is Rust heap memory, using C heap deallocation operation".
  - The dump prints "(global (static or const), size: 8, align: 8)".
  - Against the pre-lane code, the may-leak kinds would be reported and every machine kind would be a root.
- difftest (agent `interp-miri-reconcile`), every case MATCH, with no pre-existing or unstable exceptions:
  - `--suite mir --sample 300`: 300/300 MATCH (run `20261031-235022-interp-miri-reconcile-stdv`).
  - `--suite mir-core --sample 300`: 300/300 MATCH (run `20261031-235109-interp-miri-reconcile-f9xv`).
  - `--suite mir-alloc --sample 200`: 200/200 MATCH (run `20261031-235247-interp-miri-reconcile-e4ev`).

## Coverage (`bun scripts/coverage.ts --missing`)

Unchanged; no fn was added or removed:
- interpret/memory.rs 73/73, interpret/machine.rs 83/83, const_eval/machine.rs 38/38.
- mir/interpret/allocation.rs 51/51, allocation/provenance_map.rs 23/23, mir/consts.rs 39/39, mir/pretty.rs 59/59.
- Miri: machine.rs 16/87, alloc/alloc_bytes.rs 0/9, data_structures/mono_hash_map.rs 0/10.

## `unported(...)` left (new)

All are stubs naming their fill lane:
- `miri::machine::MiriMachine (impl Machine)::<52 hooks>` (miri-machine).
- `MonoHashMap (impl AllocMap)::{contains_key, contains_key_ref, insert, remove, filter_map_collect, get_or, get,
  get_mut_or}` and `MonoHashMap::default` (miri-driver).
- `MiriAllocBytes::{from_bytes, zeroed, as_mut_ptr, as_ptr}` (miri-alloc).

## `// PORT:` decisions (new)

1. `M::MemoryKind`'s `MayLeak` / `Display` / `Eq` impls are machine members (`MayLeak_MemoryKind`, `display_MemoryKind`,
   `MemoryKind_eq`). Debug is not one, because it is used only in `trace!` (interpret/machine.ts).
2. The `Prov` descriptor of `Allocation`'s A1 methods is always required, with no CTFE default (allocation.ts header).
3. A generated class implements a trait by declaration merging. It gets the provided defaults it does not override
   through `provide_defaults`, and its associated items as prototype members through `define_assoc`
   (src/rust_ts/provided.ts; machine.ts, mono_hash_map.ts).
4. `MiriAllocBytes extends Uint8Array`, and its views are plain `Uint8Array`s (alloc_bytes.ts).
5. Decision C5 amendment fields (miri.typemap.json `fields`, notes in item.ts / clock.ts / dedup_range_map.ts /
   machine.ts). SB `Item` must be repacked below 2^53 (item.ts).
6. Decision C4 amendment: `-Zmiri-track-pointer-tag` is parsed as bigint (bin/miri.ts note for miri-driver).

## For root

- Record the M7 choice (mixin, `src/rust_ts/provided.ts`) and the SB `Item` repacking requirement with
  `state.ts record decision`, if you agree.
- The tools/codegen JSON edits (miri.typemap.json, typemap.miri.json) are data-only. Review them with this batch.
