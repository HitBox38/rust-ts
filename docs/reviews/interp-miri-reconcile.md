# Review: lane `interp-miri-reconcile` (✱ contract integration)

Reviewer: independent, read-only. Branch `t3/reconcile-interpreter-miri-contract`, head `b74f743f`. Scope: the merge
resolution (the one conflict was the interpret/memory.ts header) and commit `e8ab87db`, checked against upstream at the
pin. The interp-generic and miri-contract changes were reviewed already (docs/reviews/interp-generic.md,
docs/reviews/miri-contract.md).

## Verdict: **APPROVE WITH NITS**

B1, B2/M6 and M1–M5 are done as the two reviews asked, and M7 is done too. I found no silent CTFE default left on a Miri
path. Codegen regenerates byte-identically, and every check below is green. None of the nits blocks the merge. N1 and
N2 should be settled (recorded or corrected) before lanes miri-eval and miri-sb start.

## Results

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23193; vendor 5050)`.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_const_eval src/rustc_middle src/rustc_mir_transform src/miri tools/codegen src/rust_ts`:
  569 pass, 0 fail (84 files).
- `difftest --suite mir --sample 300` (agent `interp-miri-reconcile-review`, a different sample from the lane's): 299
  MATCH, 0 DIFF, 1 UNSTABLE. The UNSTABLE case is `tests/ui/simd/intrinsic/generic-select.rs`: the oracle ICEs and prints
  its thread id. It is not caused by this lane. Run `20261031-235749-interp-miri-reconcile-review-7ldv`.
- `difftest --suite mir-core --sample 300`: 300/300 MATCH. Run `20261031-235839-interp-miri-reconcile-review-03ns`.
- `difftest --suite mir-alloc --sample 200`: 200/200 MATCH. Run `20261101-000015-interp-miri-reconcile-review-l5nt`.
- Codegen: `bun tools/codegen/types.ts` for `miri`, `rustc_const_eval_interpret`, `rustc_const_eval`, `rustc_middle_mir`,
  `rustc_borrowck` and `rustc_mir_transform` leaves `git status --short` empty. Each reports 0 unknown types. `miri` reports
  missing debug 13 and missing clone 2, unchanged.

## Checks

### 1. B1 / N1: fixed
- `get_alloc_bytes_unchecked_raw` and `get_alloc_bytes_unchecked_raw_mut` (interpret/memory.ts:1032 and :1127) now pass
  `this.machine.Provenance`. Upstream memory.rs:746 and :849 call `alloc.get_bytes_unchecked_raw()` on an
  `Allocation<M::Provenance, ..>`, so `Prov::OFFSET_IS_ADDR` is the machine's. Correct.
- The CTFE-default overloads and `Prov_default` are gone from `Allocation`. `get_bytes_strip_provenance`,
  `get_bytes_unchecked_raw(_mut)` and `read_scalar` now always take the `Prov` descriptor.
- The four tcx-allocation callers pass `Provenance_CtfeProvenance`:
  - mir/consts.ts:239 and :242: `try_get_slice_bytes_for_diagnostics`, reading `ConstAllocation::inner()`.
  - mir/pretty.ts:2406: `pretty_print_const_value_tcx`, reading `GlobalAlloc::unwrap_memory`.
  - ty/print/pretty.ts:4560: the byte-string printing helper.

  Upstream, each of these reads a `ConstAllocation`, which is `Allocation<CtfeProvenance, (), Box<[u8]>>`, so
  `Provenance_CtfeProvenance` is the right descriptor at all four sites.
- The interp N4 change to provenance_map.ts `read_ptr` (`Prov.WILDCARD` in place of `provenance_of(frag.prov).WILDCARD`)
  matches upstream `Prov::WILDCARD` (provenance_map.rs:237). The descriptor is already a parameter of `read_ptr` (:272).

### 2. B2 / M6: fixed, and `Eq` is justified and complete
- Upstream has exactly three places where the generic interpreter needs `MayLeak`, `Display` or `Eq` of
  `M::MemoryKind` (bound `Debug + Display + MayLeak + Eq`, machine.rs:117). I grepped the pinned interpret/*.rs:
  - memory.rs:418/420 `deallocate_ptr`: `alloc_kind != kind`, `{alloc_kind}`, `{kind}`.
  - memory.rs:1183 and :1203 `take_leaked_allocations`: `Some(kind) == global_kind` and `kind.may_leak()`.
  - memory.rs:1291 `DumpAllocs`: `({kind}, `.

  All three now go through the machine (memory.ts:696/701, :1494/:1518, :1621).
- `Eq` is needed. The two comparisons use the derived `PartialEq` of `MemoryKind<T>`, which needs `T: PartialEq`. The old
  CTFE-only `MemoryKind_eq` compared `._0.$` and `.was_made_global`, so for Miri's string kinds every machine kind
  compared equal to `Global`. Every machine kind would then have been a leak-check root.
- The new generic `MemoryKind_eq<T>(a, b, T_eq)` is the derived impl.
- The CTFE impl `const_eval/machine.ts:1412 MemoryKind_eq` is the derived `PartialEq` of `const_eval::MemoryKind`, which has
  one variant `Heap { was_made_global }`.
- Miri's impl is `===`, which is right because `MiriMemoryKind` is fieldless.
- The two sites left CTFE-typed are CTFE in upstream too:
  - memory.rs:340 `make_const_heap_ptr_global` is bound `M: Machine<MemoryKind = const_eval::MemoryKind, ..>`.
  - intern.rs:38 has the same bound.
- CTFE behaviour is unchanged. `compile_time_machine` reaches the same impls. They are instance fields that call the lazy
  `const_eval_machine()` at construction, not at load, so there is no init-order hazard. The mir, mir-core and mir-alloc
  samples all match.
- The test `machine_contract.test.ts` "B2/M6" is meaningful. It sets up a CTFE stand-in machine with `MiriMachine`'s
  three impls and `GLOBAL_KIND`, then checks:
  - the dealloc error text with both kinds displayed;
  - the dump prefix `global (static or const)`;
  - the leak set: `Rust` / `C` / `Runtime` / `Stack` are reported, and the may-leak kinds `Machine` and `Tls` are not.
  - that `Global` is a root and keeps `reached` alive.

  Against the pre-lane code this test fails in both directions. It also checks the upstream order "remove before kind
  check" (memory.rs:395, before :418).

### 3. M1–M5: done, nothing silently CTFE-typed
- M1:
  - `MiriMachineTypes` includes `AllocParams = MiriAllocParams`.
  - `interface MiriMachine extends Machine<MiriMachineTypes>` is a declaration merge.
  - `MiriInterpCx = InterpCx<MiriMachine>`.
  - The type-level `Equal` checks in the test pin `ProvOf` and `MachineTypesOf`.
- M2: all 60 headers are `InterpCx<M extends AnyMachine = Machine>`.
- M3:
  - `eq` is the derived `PartialEq` of `enum Provenance { Concrete { alloc_id, tag }, Wildcard }`.
  - `debug` and `owns` are added.
  - `register_object_provenance` runs at load (machine.ts:236).
- M4: the typemap entries are `ImmTy<$0>`, `OpTy<$0>`, `FnArg<$0>`, `PlaceTy<$0>` and `MPlaceTy<$0>`, with `$d0`/`$c0`.
  The regenerated diff is exactly the `debug_X(.., debug_Provenance)` calls and their imports, plus thread.gen
  `Frame<Provenance, FrameExtra>`.
- M5 and the three extra sites:
  - `Frame<Provenance, FrameExtra>` at helpers.ts, borrow_tracker/mod.ts and thread.ts ×5.
  - helpers.ts `Writeable<unknown, Provenance>` ×4 and `Projectable<unknown, Provenance>` ×4.
  - diagnostics.ts `Allocation<Provenance, AllocExtra, MiriAllocBytes>`.
  - helpers.ts:145 `Frame<Provenance>` is right: upstream helpers.rs:1045 is `&Frame<'tcx, Provenance>`, so Extra is `()`.
- My sweep of src/miri (non-test):
  - Every `Frame<`, `MPlaceTy<`, `OpTy<`, `ImmTy<`, `PlaceTy<`, `FnArg<`, `Allocation<`, `Immediate<`, `MemPlaceMeta<`,
    `Writeable<` and `Projectable<` carries `Provenance`.
  - The only direct imports of Prov-defaulted interpreter types are the 8 listed sites, and all are parameterised.
  - There is no unparameterised `interpret.X` or `interpret_Pointer` use.

### 4. M7 mixin (`src/rust_ts/provided.ts`): sound
- I computed the sets from the pinned sources (trait machine.rs:115-685; impl miri machine.rs:1133-2139).
  - `trait Machine` has 25 provided fns.
  - `impl Machine for MiriMachine` defines 52 fns.
  - Of the provided fns, 21 are overridden and 4 are not (`load_mir`, `increment_const_eval_counter`,
    `before_access_global`, `before_alloc_access`).
  - machine.ts:327's `overridden` list is exactly the 21, and the stub list is exactly the 52, in upstream order, with
    `stack` → `stack_`.
  - The C8 rename `binary_ptr_op_` is on `InterpCx` (operator.ts), so the hook `binary_ptr_op` on `MiriMachine.prototype`
    is correct.
- The defaulted associated const `ALL_CONSTS_ARE_PRECHECKED` is an instance field of `Machine_provided`, not a prototype
  member. So `define_assoc` has to set it explicitly, and it does.
- MonoHashMap:
  - `AllocMap` has the provided `get_mut`.
  - The impl defines `get` (:98), and the mixin copies `get_mut`.
  - The 8 impl fns and `default` are stubs for miri-driver.
- The helper is strict both ways: an unknown overridden name throws, and so does a collision. It copies descriptors, and
  the copied methods use no `super`.
- Consistency: the repo has 7 `extends X_provided` hand classes (`compile_time_machine`, `FxIndexMap_AllocMap`,
  `ValidityVisitor`, `MacEager`, ...) and explicit delegation (`TypeVisitor_provided.visit_binder(this, ..)` in
  rustc_privacy). The mixin is a third mechanism, but generated classes cannot `extends`. Markers stay on the
  `_provided` helper, as PORTING §8 says. See N3.
- Init order (see N4): no new hazard. I loaded each of these first: `lib.ts`, `machine.ts`, `mono_hash_map.ts`,
  `alloc_bytes.ts` and `bin/miri.ts`. Every one loads, and `load_mir`, `before_memory_read`, `GLOBAL_KIND` and `Bytes`
  resolve.

### 5. C5 fields and notes
- The regeneration diff is exactly the 4 field types:
  - `MiriMachine.basic_block_count`
  - `MonotonicClockKind::Virtual.nanoseconds`
  - `Elem.range`
  - `Item._0`

  The custom Debug forms match upstream: `Cell { value: n }` for `Cell<u128>`, and `start..end` for `Range<u64>`.
- The `Item` note is sound:
  - The packing is private (item.rs:16-59).
  - Debug prints `[{perm:?} for {tag:?}]` (:63).
  - `Item` derives only `Copy, Clone, Hash, PartialEq, Eq`.
  - A smaller injective layout preserves every observable behaviour except the `assert!(tag.get() <= TAG_MASK)` bound.
  - **Yes, it should be a recorded decision** (N2).
- The clock note's conclusion is acceptable, but its premise is wrong (N1).
- C4 note (bin/miri.ts): fine.

### 6. tools/codegen JSON edits: data only, regenerate byte-identically (above)
The typemap.miri.json N6 comment is accurate: set-local cfg tables are merged globally.

## Findings

- **N1 (non-blocking; fix the note before miri-eval starts):** the clock premise at src/miri/clock.ts:7-11 and
  tools/codegen/miri.typemap.json:41 is wrong.
  - The note says "ticked per basic block … stays far below 2^53 for any run that ends".
  - The virtual counter also grows through `MonotonicClock::sleep` (clock.rs:103-113). The scheduler calls it
    (scheduler.rs:214) with program-supplied timeouts when every thread is blocked.
  - Example: `thread::sleep(Duration::from_secs(200 * 86400))` under isolation (the default, so the virtual clock) ends
    normally and pushes the counter past 2^53 ns (about 104 days). Upstream's `checked_add(..).expect(..)` fails only at
    u128 overflow.
  - The note's fallback, "`unported` past `Number.MAX_SAFE_INTEGER`", keeps the port honest, which is why this is
    non-blocking. But the note should name `sleep` as the place that must check, and drop the false claim, so the fill
    lane does not treat the limit as unreachable.
  - Root may also reconsider whether `nanoseconds` should stay `bigint`. It is touched once per basic block, the same rate
    as `basic_block_count`.
- **N2 (non-blocking; record before miri-sb starts):** record the `Item` repacking as a root decision. The lane asks for
  this, and I agree. It is a faithful-port concern:
  - It changes upstream's private consts (`TAG_MASK`, `PERM_MASK`, `PROTECTED_MASK`, `*_SHIFT`, item.rs:16-21).
  - It narrows `Item::new`'s `assert!(tag.get() <= TAG_MASK)` from 2^61−1 to 2^50−1. The two differ only for runs with
    more than 2^50 retags, which are unreachable.

  The decision should fix the layout (e.g. tag in bits 0–49, perm in 50–51, protector in 52, arithmetic only) and the
  assert bound, so that miri-sb does not choose them.
- **N3 (non-blocking):** record the M7 mixin (`provide_defaults` / `define_assoc` for generated classes) as a decision.
  Consider adding a line to PORTING §8, which today says only "implementors extend".
- **N4 (non-blocking, informational):** `define_assoc` and `provide_defaults` run at module load. `install_miri_stubs`,
  by contrast, is deferred "so that it never touches a class whose module is still evaluating".
  - This is safe today. Only machine.ts value-imports machine.gen.ts, and only mono_hash_map.ts value-imports
    mono_hash_map.gen.ts, so each generated class has finished evaluating first.
  - Entering machine.gen.ts first fails, but it already failed before this lane, at machine.ts:76 (`MiriMemoryKind` TDZ).
    I checked this at `692df784`, so it is not a regression.
  - The regenerated miri `.gen.ts` files now value-import `debug_Provenance` from machine.ts, but use it only inside
    function bodies, which is fine.
  - Keep "never value-import a `.gen.ts` of src/miri directly" as a rule for the fill lanes.

No blocking findings.
