# Handoff: lane `miri-machine` (M6 wave 36, Miri core)

`src/tools/miri/src/machine.rs` (2,205 lines) → `src/miri/machine.ts`, ported in full on top of the miri-contract /
interp-miri-reconcile skeleton. The contract part is kept in place. The new fns sit at their upstream positions around it:
consts, `VisitProvenance for FrameExtra`, `VisitProvenance for AllocExtra`, `PrimitiveLayouts`, the `impl MiriMachine` fns,
`VisitProvenance for MiriMachine`, the `impl Machine` hooks after `MiriInterpCxExt`, and `callback!` at the end.
Branch `t3/8438cefc`.

## Files touched

- `src/miri/machine.ts`: the port. The stub part is gone: no `stub_methods` / `stub_statics` are left for machine.rs.
- `src/miri/machine.gen.ts`: regenerated. The only change is `rng: StdRng` (typemap edit below).
- `tools/codegen/miri.typemap.json`: **typemap edit.** `rand::rngs::StdRng` was `Pending<"rand::rngs::StdRng">` and is now
  `StdRng` from `src/vendor/rand/rngs/std.ts`, with `debug_StdRng`. vendor-rand landed in wave 35, which is what the entry's
  own note asked for. Regenerating set `miri` changes only `machine.gen.ts`.
- `src/miri/machine_contract.test.ts`: **contract test, minimal fix.** Test "M1/M7" asserted that `enforce_alignment` and
  `stack_` are `unported` stubs of lane miri-machine. They are now ported, so it checks that:
  - `enforce_alignment` on a stub interpreter returns `false`;
  - `stack_` reaches miri-threads' `active_thread_stack` stub, which stops `unported`.
- `src/miri/machine.test.ts` (new, our own): 14 unit tests (below).
- `docs/handoff/miri-machine.md` (this file).

## Verification

- `bunx tsc --noEmit -p .`: 0 errors. The worktree had no `node_modules`; I ran `bun install --frozen-lockfile`
  (gitignored).
- `bun scripts/coverage.ts --check --offline`: `markers ok (23264; vendor 5050)`.
- `bun scripts/coverage.ts --missing src/tools/miri/src/machine.rs`: **87/87 ported** (was 16/87).
- Codegen: `bun tools/codegen/types.ts miri` twice gives no diff after the committed regeneration (unknown types 0, missing
  debug 13, missing clone 2: the same counts as before).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri src/rustc_const_eval tools/codegen`: 123 pass, 0 fail.
  - In one earlier run, an `src/rustc_const_eval` test failed with `ENOENT .../tmp/ctfe-util-type-name/default/type_name_fixture`.
    That is a shared fixture dir under `$RUST_TS_DATA`, so it looks like a race with another agent's build. It passed on
    re-run; I did not change that test or fixture.
- `src/miri/machine.test.ts` (14 tests, 50 expects), all against a stub interpreter (an `InterpCx` prototype object with a
  bare `MiriMachine`):
  - `SIGRTMIN` / `SIGRTMAX`;
  - every `MiriMemoryKind`'s Display, `may_leak` and `should_save_allocation_span`;
  - `PrimitiveLayouts.uint` / `int`;
  - `communicate`, `page_align`, allocation spans, the validity and alignment switches;
  - symbolic `alignment_check`, including the `wrapping_sub` wrap and the promised-align branch;
  - `ptr_get_alloc`'s Concrete / Wildcard extra;
  - `adjust_alloc_root_pointer` without a borrow tracker (root tag `BorTag::default()`, and the `expect` text);
  - the `init_local_allocation` assert text;
  - `before_memory_read` / `write` sync objects: key order, only the range, delete-on-write;
  - `cached_union_data_range` caching and `get_default_alloc_params`;
  - `before_terminator` counters, the GC interval and the preempt / tick order;
  - `float_fuse_mul_add` draws nothing when `float_nondet` is off;
  - `get_global_alloc_salt` draws in `0..32` and is deterministic per seed;
  - the `callback` helper;
  - a hook reaching another lane's undeclared fn stops `unported`, not with a TypeError.
- `bun scripts/difftest.ts --suite mir --sample 200` (agent `miri-machine`): MATCH=199, TIMEOUT=1 (run
  `20261101-125204-miri-machine-28ew`).
  - The timeout is `tests/ui/type-alias-impl-trait/self-referential-4.rs`, a protected case. It timed out again on the
    in-run retry. The load average was about 51 at the time.
  - Re-run alone it is a MATCH (run `20261101-125546-miri-machine-9m1l`).
  - Nothing in the compiler pipeline imports `src/miri` (grep). The only change outside `src/miri` is the set-`miri` typemap
    entry.

## Signatures and impls the skeleton lacks (needed from other lanes)

Each of these is called through the `pending` / `visit_object` / `visit_table` glue at the end of machine.ts
(`PORT(contract)`). The glue reads the value at call time and stops `unported("…not ported yet; called from …machine.rs")`
until the owning lane provides it, so a missing piece is an UNPORTED case, not a crash. Root can replace the glue with
direct calls once the lanes have merged. The names follow PORTING §8 (enum methods on the companion) and borrowck-contract
rules 4-5 (classes get prototype methods, non-class values get `<Trait>_<Type>` tables with `self` first).

- **miri-race**
  - `AtomicReadOrd.from`, `AtomicWriteOrd.from`, `AtomicRwOrd.from` and `AtomicFenceOrd.from` on the companions in
    data_race.ts (data_race.rs:75/96/116/137).
  - `GlobalDataRaceHandler.as_vclocks_ref(self)` / `.as_genmc_ref(self)` and `AllocDataRaceHandler.as_vclocks_mut(self)`
    on the companions in data_race_handler.ts.
  - The tables `VisitProvenance_GlobalDataRaceHandler` / `VisitProvenance_AllocDataRaceHandler` (data_race_handler.ts).
- **miri-alloc**
  - `export const AllocState`, a new companion: there is no generated one, because `AllocState` has no unit variant. It goes
    in borrow_tracker/mod.ts with `before_memory_read(self, alloc_id, prov_extra, range, machine)`,
    `before_memory_write(..)` and `before_memory_deallocation(self, alloc_id, prov_extra, size, machine)`.
  - `BorrowTrackerMethod.instantiate_global_state(self, config)`.
  - The tables `VisitProvenance_FrameState` and `VisitProvenance_AllocState` (borrow_tracker/mod.ts).
  - `visit_provenance(visit)` methods on borrow_tracker's and alloc_addresses' `GlobalStateInner`.
- **miri-threads**
  - `ThreadManager.prototype.visit_provenance`.
  - `genmc_intercept_function`'s `_args` is declared as `Pending<FnArg>[]`; the hook passes its `FnArg`s with a cast.
  - `thread_cpu_affinity` is a `Map<ThreadId, …>` keyed by the `ThreadId` object that `threads.active_thread_()` returns, so
    lookups must use the same object (or ThreadId must be interned).
  - `AllocExtra.sync_objs` is a generated `Map<Size, SyncObj>`. machine.ts orders its keys with `Size_cmp`
    (`BTreeMap::range` / `values` order) and deletes by the map's own key objects. sync.rs must keep exactly one key object
    per offset (`Size` objects are not value-equal in a `Map`).
- **miri-shims-a**
  - `EnvVars.init(ecx, config)` on the companion.
  - The table `VisitProvenance_EnvVars`.
  - `TlsData.default()` (a static, as with `MonoHashMap.default`) and `TlsData.prototype.visit_provenance`.
  - The table `VisitProvenance_CatchUnwindData` (shims/unwind.ts).
- **miri-shims-b**
  - `export const MAX_CPUS` in shims/cpu_affinity.ts. Root still has to add the lib.ts re-export.
  - `FdTable.prototype.visit_provenance`.
  - `CpuAffinityMask.new`'s `cx` is declared as `Pending<impl LayoutOf>`; the hook passes the `LayoutCx` with a cast.
- **miri-fs**: `DirTable.default()` (static) and `DirTable.prototype.visit_provenance`.
- **miri-driver**
  - `MachineStopType_TerminationInfo(info): MachineStopType` in diagnostics.ts. This is `Box::new(TerminationInfo)` as
    `Box<dyn MachineStopType>` (diagnostics.rs:113 plus its Display / Debug). It is needed for `throw_machine_stop!`; here
    only the wasm branch of `check_fn_target_features` uses it, but every shim lane will need it.
  - The table `VisitProvenance_MPlaceTy` (provenance_gc.ts). The trivial generic impls (`Option`, `FxHashMap<Symbol, _>`,
    `Pointer` / `StrictPointer`, provenance_gc.rs:33/:79/:114/:120) are inlined in machine.ts's `visit_pointer` and loops.
- **miri-eval**
  - Miri's `generate_nan::<F1, F2>` constructs an `F2`, so it needs `F2`'s `FloatType` dictionary as a trailing parameter,
    as the interpreter's own convention does. operator.ts declares `generate_nan(inputs)`. machine.ts adds the overload
    `generate_nan(inputs, F2_)` in a local `declare module` (`PORT(contract): pending miri-eval`) and calls that.
- **miri-sb (weak_memory)**: `StoreBufferAlloc.non_atomic_write(range, global)` declares `global` as
  `Pending<"DataRaceState">`. It is `data_race::GlobalState`; the hook casts.

## For root (contract / interpreter typing)

- **rustc_const_eval `interpret/machine.ts`, `Machine.adjust_alloc_root_pointer`** is typed `ptr: Pointer<T["Provenance"]>`.
  Upstream it is `ptr: Pointer<CtfeProvenance>` (interpret/machine.rs:442), and memory.ts:564 / place.ts:1278 pass
  `Pointer_from_AllocId(id)`. Miri's impl is typed like upstream and assigned with a cast (`PORT(contract)` above it).
  Fixing the interface (and `Machine_provided`'s abstract member) removes the cast.
- Several `InterpCx` methods in the class body are typed with the CTFE defaults and return Miri values:
  - `frame()`, `eval_global`, `global_root_pointer`, and the companion fn `Immediate.to_scalar`.
  - machine.ts wraps them in the small cast helpers `frame_` / `imm_to_scalar`, plus two inline casts, each with a
    `PORT (plan-m6 D3)` note. This is the interp-generic convention, not a bug.
- **`callback!` API, for the 44 upstream callers in other lanes:**
  - `callback<C, T>(captures, visit_captures(captures, visit), body(this_, arg, captures)): DynMachineCallback<T>`.
  - `captures` is the macro's `@capture { .. }` object.
  - `visit_captures` visits each capture with its type's `VisitProvenance`, in capture order.
  - `body` is `|this, arg| ..`.
  - The callbacks call `call` at most once.

## `unported(...)` left (all in `src/miri/machine.ts`)

- `MiriMachine::new`: measureme profiler (`-Zmiri-measureme`; measureme is not vendored).
- `MiriMachine::new`: `-Zmiri-native-lib`, both `IsolatedAlloc` and `shims/native_lib` (decision C6: upstream's not-enabled
  panic becomes an `unported` stop).
- `init_frame` / `after_stack_pop`: the measureme profiler branches. They are unreachable, because `new` already stops.
- The `pending` / `visit_object` / `visit_table` / `cpu_affinity_MAX_CPUS` glue (the list above): it stops until the
  owning lane ports the fn.
- `Debug` of `std::io::Error`, used only in the `expect` text when `BlockingIoManager::new` fails (an ICE anyway).

## `// PORT:` decisions

1. **Constructors.**
   - `MiriMachine::new`'s struct literal is evaluated field by field in upstream order into locals, then passed to the
     generated constructor in declaration order.
   - `PrimitiveLayouts::new` runs the `layout_of(..)?`s in field order.
   - Derived `Default`s are inlined: `EnvVars.Uninit`, `new DelayedReadinessUpdates([])`, `new FrameState(new Map())`.
2. **Host environment (D14).** `std::env::var("MIRI_LOCAL_CRATES")` is `process.env`.
3. **Number types.**
   - `alignment_check`'s `u64::wrapping_sub` and `trailing_zeros` are on bigints.
   - `basic_block_count` is a number (C5 amendment); `ProgressReport.block_count` gets `BigInt(..)`.
4. **Sync objects.**
   - `sync_objs` `range` / `values()` go through `btree_range` (filter, then sort by `Size_cmp`).
   - An empty map is skipped (perf).
5. **`protect_in_place_function_argument`.** `place.clone()` shares the value, because interpreter places are immutable.
6. **Skipped no-op.** `adjust_alloc_root_pointer`'s `cfg!(debug_assertions)` block is a comment (the release oracle skips
   it).
7. **`enter_trace_span`.** It returns `undefined`: the component is built without `tracing`.
8. **Logging.** `info!("Leaving {}", ..)` / `info!("Continuing in {}", ..)` stay verbatim comments (for lane miri-log);
   `enter_trace_span!` calls are comments.
9. **Unported options.** measureme and native-lib stop `unported` (above).
10. **`try_insert` failure.** `allocator_shim_symbols`' `try_insert(..).unwrap()` panics with `OccupiedError { .. }`
    (its Debug is not ported; it is an ICE).
11. **Contract-typing casts** (the `PORT(contract)` notes; see the lists above).
