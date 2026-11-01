# Handoff: lane `miri-driver` (M6 wave 36, Miri core)

Branch `t3/port-miri-driver` (worktree t3-63912c5e), from main `06fa2c65`. Five commits:

- `404d728b` data_structures
- `5ece6278` provenance_gc
- `13798448` diagnostics
- `b7b97376` bin/miri.rs
- `92b484d3` tests + markers

I did not touch `bin/log/*`: that is lane `miri-log`, even though its stub headers still say "Fill lane: `miri-driver`". The
driver calls its declared entry points.

## Files touched

| file | what |
|---|---|
| `src/miri/bin/miri.ts` | `bin/miri.rs` ported (19/21 fns). The two `MiriDepCompilerCalls` callbacks are plan-m6 D4: they stop `unported` and have no markers. The file also has the entry glue, so it runs as `bun src/miri/bin/miri.ts <rustc args>`. |
| `src/miri/bin/miri.test.ts` | new: argv tests compared against the oracle Miri |
| `src/miri/diagnostics.ts` | `diagnostics.rs` ported (12/12) |
| `src/miri/diagnostics.test.ts` | new |
| `src/miri/provenance_gc.ts` | `provenance_gc.rs` ported (30/30) |
| `src/miri/data_structures/{dedup_range_map,mono_hash_map,range_object_map}.ts` | ported (16/16, 10/10, 14/14 counting the upstream test fns) |
| `src/miri/data_structures/{dedup_range_map,range_object_map}.test.ts` | new: upstream's `#[cfg(test)]` tests, with markers |
| `src/miri/machine_contract.test.ts` | **not mine** (interp-miri-reconcile). It asserted that `MonoHashMap::default` / `insert` are `unported` stubs; it now asserts that they work. Minimal edit, two assertions. |

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23293; vendor 5050)`.
- `--missing`:
  - bin/miri.rs 19/21 (left: `:283 config` and `:324 after_analysis` of `MiriDepCompilerCalls`, D4)
  - diagnostics.rs 12/12
  - provenance_gc.rs 30/30
  - dedup_range_map.rs 16/16
  - mono_hash_map.rs 10/10
  - range_object_map.rs 14/14
  - data_structures/mod.rs 0/0
- Codegen: `bun tools/codegen/types.ts miri` leaves no diff. It reports 0 unknown types, 13 missing debug and 2 missing clone, the same as before.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri`: 30 pass, 0 fail (6 files).
- Unit tests:
  - data_structures: all 12 of upstream's tests, plus one for `merge_adjacent_thorough` and value-semantics ranges.
  - argv: 31 bad-flag invocations. stderr and exit 1 are byte-equal to the oracle Miri's output, which I recorded with
    `rustup-miri/.../bin/miri <flag>` under `env -i`.
  - argv: every flag kind reaches `MiriConfig`. `--` forwarding works, and so does the `-Zmiri-retag-fields` warning.
  - diagnostics: every `TerminationInfo` Display/Debug string, including DataRace's `alloc5+0x10`. Also the MachineStop
    box (downcast, `display_InterpErrorKind`, `with_validation_path`) and `SpanDedupDiagnostic::new`.
- difftest `--suite miri-hello` (agent `miri-driver`): UNPORTED=1 (run `20261101-130139-miri-driver-8zuy`). The suite's
  subject is still `src/rust_ts/main.ts`; switching it to this driver is a harness lane's job.

### How far `bun src/miri/bin/miri.ts` gets on miri-hello

Command: `bun src/miri/bin/miri.ts harness/corpus/miri/hello.rs --sysroot $RUST_TS_DATA/miri-sysroot --target x86_64-unknown-linux-gnu`

- **First `unported`:** `miri(bin)::log::setup::init_early_loggers` (lane miri-log), at bin/miri.rs:446, before argv parsing. Exit 70 after 1.3 s.
- **Experiment, not committed:** I made the three loggers no-ops and installed the upstream `MiriConfig::default`. The port
  then runs rustc's whole analysis of hello.rs on the oracle Miri sysroot, warning-free, in ~1 s. It reaches
  `after_analysis` and stops at **`miri::eval::entry_fn`** (lane miri-eval, eval.rs:40).

## `unported(...)` left (in my files)

| where | what | until |
|---|---|---|
| bin/miri.ts | `MiriDepCompilerCalls::config` / `after_analysis` (`MIRI_BE_RUSTC=target`) | D4, lane miri-sysroot |
| bin/miri.ts | `MiriConfig::default` | miri-eval (pending, see below) |
| bin/miri.ts | `MAX_CPUS` (`-Zmiri-num-cpus`) | miri-shims-b |
| bin/miri.ts | `native_lib::init_sv` (`-Zmiri-native-lib-enable-tracing` with a native lib) | C6, out of scope |
| bin/miri.ts | `cfg!(target_has_reliable_f16_math)` when the host has no row in `target_config.gen.ts` | only off the main hosts |
| provenance_gc.ts | `AllocState::remove_unreachable_tags` | miri-alloc (pending) |
| provenance_gc.ts | `stub_methods` placeholders for `AllocExtra.visit_provenance` and `MiriMachine.visit_provenance` | miri-machine (pending) |
| diagnostics.ts | `impl Display for AccessKind` | miri-alloc (pending) |

## Missing / changed signatures (for root and the other lanes)

### Pending stand-ins in my files (root swaps each for the owning lane's version at integration)

1. **`MiriConfig::default()`** (eval.rs:178, miri-eval).
   - The skeleton does not declare it, because `MiriConfig` is a generated interface with no companion.
   - `bin/miri.ts` `MiriConfig_default()` stops `unported` unless a test installs `PENDING_MIRI_CONFIG_DEFAULT.f`.
   - Replace the body with miri-eval's default, and delete the hook and its use in `miri.test.ts`. That test's
     `default_config()` is the upstream listing.
2. **`AllocState::remove_unreachable_tags`** (borrow_tracker/mod.rs:497, miri-alloc). This is an enum method, and the
   `AllocState` companion is not declared.
3. **`impl Display for AccessKind`** (borrow_tracker/mod.rs:22, miri-alloc). Not declared; diagnostics.ts has a local stand-in.
4. **`VisitProvenance` for `AllocExtra` / `MiriMachine`** (machine.rs:409 / :1029, miri-machine).
   - provenance_gc.ts declares both through a `declare module "./machine.gen.ts"` (`extends VisitProvenance`).
   - It also registers `unported` placeholders for them.
   - **When miri-machine lands, delete the two `stub_methods` calls at the end of provenance_gc.ts.** `install_miri_stubs`
     throws on the clash, so you cannot miss it.
5. **`MAX_CPUS`** (shims/cpu_affinity.rs, miri-shims-b): the lib.ts re-export.

### Types and declarations I corrected or depend on

6. **`eval_entry` / `run_genmc_mode` return `Result<null, Pending<"NonZeroI32">>`** (eval.ts, genmc/dummy.ts).
   - The driver treats the error as a number (`as_exit_result`).
   - miri-eval / miri-threads should type it as `number`.
7. **`GenmcConfig.parse_arg(genmc_config: GenmcConfig | undefined, ..)`** (dummy.ts).
   - It is declared by value, but upstream takes `&mut Option<GenmcConfig>`.
   - The dummy only errors, so nothing is lost.
8. **`GlobalDataRaceHandler::as_genmc_ref`** (miri-race) is not declared. diagnostics.ts tests `data_race.$ === "Genmc"`
   instead, which is exactly what `.as_genmc_ref().is_some()` means. PORT note at both sites.
9. **`rustc_interface` `Config.make_codegen_backend`** is typed `undefined`, and `run_compiler` does not port its `Some`
   arm (interface.ts:362: "the driver passes None for every callback").
   - `MiriCompilerCalls::config` sets the field through a cast.
   - **Needed (rustc_interface owner / root):** type it `((sess: EarlySession) => CodegenBackend) | undefined`, and in
     `run_compiler` use `config.make_codegen_backend?.(early_sess) ?? util.get_codegen_backend(..)`, as upstream
     interface.rs does.
   - Until then, the LLVM stand-in is used. Its `codegen_crate` stops `unported` after a successful interpretation.
   - `target_config` then differs from Miri's in `has_reliable_f16_math` / `has_reliable_f128_math`. That only affects
     those `cfg`s.

### Signatures I changed in my own files (callers in other lanes must follow)

10. **`DedupRangeMap`:**
    - `find_offset(offset: number)` (was `bigint`; C5 amendment).
    - The `T: Clone` / `T: PartialEq` bounds are parameters: `split_index(i, off, clone_T)`,
      `iter_mut(offset, len, clone_T, eq_T)`, `merge_adjacent_thorough(eq_T)` (PORTING §5).
    - The iterators return arrays of `[range, data]`. The mutable ones return `[range, data, elem]`, so a caller that
      assigns the whole value (`*loc = state`, tree_borrows/mod.rs:358) writes `elem.data = state`. Callers that mutate
      in place (SB `Stack`, data-race `MemoryCellClocks`) use `data`.
    - Ranges are `DedupRange = { readonly start: number; readonly end: number }` and are never mutated in place.
11. **`RangeObjectMap`:**
    - `remove_pos_range(pos_range: { start, end })`.
    - `iter(): T[]`.
    - `impl Index` / `IndexMut` are `index(pos)` / `index_mut(pos)` (the weak-memory store buffers use them).
12. **`MonoHashMap.default(key?: KeyType<K>)`.** The default key is `usize_key`, which is `AllocId`'s hash.
13. **The `TerminationInfo` machine-stop box (miri-eval, miri-threads, shims).** `throw_machine_stop!(info)` is
    `Err(InterpErrorInfo_from_InterpErrorKind(TerminationInfo_into_machine_stop(info)))`.
    `info.downcast_ref::<TerminationInfo>()` is `TerminationInfoStop.downcast_ref(stop)` (diagnostics.ts).
14. **`VisitProvenance` impl tables** (provenance_gc.ts). `VisitProvenance_<T>` takes `self` first:
    - `Option` / `tuple2` / `Box` / `Rc` / `Vec` / `BTreeMap` / `FxHashMap` / `RefCell` take the element impls as trailing
      parameters.
    - `VisitProvenance_object` is the impl of any object with the method.
    - The scalar impls are `VisitProvenance_no_provenance` (the `no_provenance!` list) and `VisitProvenance_str`.
    - The rest are `BorTag`, `AllocId`, `Provenance`, `StrictPointer`, `Pointer`, `Scalar`, `IoError`, `Immediate`,
      `MemPlaceMeta`, `ImmTy`, `MPlaceTy`, `PlaceTy`, `OpTy`, `Allocation`, `MiriInterpCx`.
    - Lanes implementing `visit_provenance` on their classes call these.

## `// PORT:` decisions

1. **`exit` / `std::process::exit`.** It throws `MiriExit`; the bin's entry glue turns it into the exit status. It is not an
   unwind (not a `Panic` or `FatalErrorMarker`), so `run_compiler` / `catch_fatal_errors` let it through without
   `finish_diagnostics`, as `process::exit` does.
2. **C4 amendment.**
   - `-Zmiri-track-pointer-tag` values are parsed as `bigint` and checked nonzero on the bigint.
   - A tag above 2^53−1 is **not inserted**, because no run can create it. The set is only queried for membership, so
     this is unobservable.
   - `-Zmiri-track-alloc-id` gets the same rule.
   - Root: please record this with `state.ts record decision`.
3. **`str::parse` of flag values.**
   - `u32` / `u64` go through rustc_session `u32_from_str` / `u64_from_str`.
   - `NonZero<u64>` adds `Zero`.
   - `f64` goes through a regex of core's dec2flt grammar. The oracle accepts `+1` and `1.` and rejects `0x1`.
   - The `ParseIntError` texts are core's.
4. **`-Zmiri-force-page-size`'s `* 1024`** wraps (the release Miri has no overflow checks).
5. **C6.** The `cfg(feature = "native-lib")` items are omitted: `register_retcode_sv` is a no-op without a supervisor, and
   `init_sv` stops `unported`. Native-lib argv parsing (host file system, D14) is ported.
6. **D14.** These come from the host, through Node/Bun:
   - `env::vars_os` (`process.env`, in `environ` order)
   - `canonicalize` (`realpathSync`)
   - `MIRI_CWD` (`process.chdir`)
   - `available_parallelism`
7. **`run_many_seeds` is sequential.** rust-ts is single-threaded, many-seeds is outside M6 (D13), and the max exit code and
   failure count do not depend on order.
8. **`cfg!(target_has_reliable_f16_math)` of the host** comes from the oracle `target_config` table for `host_tuple()`.
9. **`MonoHashMap`** is an `FxHashMap`, so leak reports keep hashbrown's order. `get_mut_or` does a `reserve(1)` on a
   vacant key before `vacant()`, as std's `entry` does.
10. **`DedupRangeMap` / `RangeObjectMap`** (signature changes 10 and 11 above): eager arrays, function parameters for the
    bounds, value ranges, and `index` / `index_mut`.
11. **`VisitProvenance` representation** (item 14 above). `impl for MiriInterpCx` is a table, not an `InterpCx.prototype`
    method.
12. **`TerminationInfoStop`** wraps the generated `TerminationInfo` union as the `MachineStopType` object. The
    `note!` / `note_span!` macros are helper functions.
13. **`trace!` / `debug!` lines** stay as comments (A6).
