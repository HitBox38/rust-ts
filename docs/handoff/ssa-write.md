# Handoff: ssa-write (M7, plan-m7 wave 42, wave 40o): rustc_codegen_ssa `back/write.rs`

Branch `t3/port-ssa-write` (from `ba273e7f`; no merges).

## Summary
- Ported all of `compiler/rustc_codegen_ssa/src/back/write.rs` in upstream order, with markers. That covers `ModuleConfig`,
  `TargetMachineFactoryConfig::new`, `CodegenContext`, `start_async_codegen`, `produce_final_output_artifacts`,
  `compute_per_cgu_lto_type`, the `execute_*_work_item`s, `do_fat_lto` / `do_thin_lto`, the coordinator
  (`start_executing_work` with its message loop and `queue_full_enough`), `spawn_work` / `spawn_thin_lto_work`, `SharedEmitter`
  / `SharedEmitterMain`, `Coordinator`, `OngoingCodegen` (`join`, `codegen_finished`, `check_for_errors`,
  `wait_for_signal_to_codegen_item`), the three `submit_*` fns and `msvc_imps_needed`.
- Ported in `compiler/rustc_session/src/config.rs` (the owner file, `src/rustc_session/config.ts`): `maybe_strip_file_name`,
  `OutputFilenames::{temp_path_for_cgu, temp_path_dwo_for_cgu, temp_path_ext_for_cgu, split_dwarf_path}`, and the consts
  `RLINK_EXT`, `RUST_CGU_EXT`, `DWARF_OBJECT_EXT` and `MAX_FILENAME_LENGTH`. `split_dwarf_path` and `temp_path_ext_for_cgu`
  are needed by `TargetMachineFactoryConfig::new` and by cg_llvm's `no-opt.bc`, and `maybe_strip_file_name` by every CGU path.
- **Nothing protected changes.** write.ts is not loaded at startup (nothing imports it yet). config.ts is loaded at startup.
  It now imports `StableHasher` as a value from `rustc_data_structures/stable_hash.ts`, which was already loaded for
  `path_hasher`, and `Str` / `str_ceil_char_boundary` from `std/str.ts`, also already loaded. The three samples below match.
- The TS is 2,426 lines (write.ts, upstream comments included). It stays under the 3k limit, so there is no chained lane.

## Files touched
| file | what |
|---|---|
| `src/rustc_codegen_ssa/back/write.ts` | the port; replaces ssa-contract's placeholder (`ModuleConfig`, `CodegenContext`, `SharedEmitter` are now the real types; `TargetMachineFactoryConfig`, `TargetMachineFactoryFn`, `FatLtoInput`, `ThinLtoInput` keep their shapes) |
| `src/rustc_session/config.ts` | the five fns and four consts above; the `OutputFilenames` header comment |
| `src/rustc_codegen_ssa/back/write.test.ts` | new: unit tests (below) |
| `src/rustc_codegen_ssa/back/write_oracle/{cgus.rs, oracle.json}` | new: the fixture and the oracle's `-Csave-temps` file names (`REGEN=1` rewrites them) |

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| compiler/rustc_codegen_ssa/src/back/write.rs | **40/40** (was 0/40) |
| compiler/rustc_session/src/config.rs | **136/136** (was 131/136) |

`bun scripts/coverage.ts --check`: `markers ok (26626, ...; library 745; ...)`. The library count went up by one: write.ts
carries a `// std: library/core/src/slice/mod.rs:2982 binary_search_by` marker for the ported search loop.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok.
- `bun test ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts ./src/rustc_codegen_ssa/back/write.test.ts`:
  **31 pass, 0 fail**. The unwrap guard caught three one-argument `unwrap_result` calls in my first version; they now pass
  `debug_RecvError`.
- `bun test ./src/rustc_session/ ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rustc_interface/interface.test.ts`:
  **368 pass, 0 fail**. This includes base.test.ts and skeleton.test.ts, which are unchanged.
- **No new environment variables.** write.ts reads none. write.test.ts reads `REGEN` and `RUST_TS_AGENT`, the latter only
  for its scratch directory under `$RUST_TS_DATA/tmp/ssa-write/`, as base.test.ts does. unit-steps.test.ts passes.

### write.test.ts (18 tests)
1. **`ModuleConfig::new` per opt level and emit kind** (9 tests).
   - The sessions are real ones, built by the port's driver from the flags, as session_codegen.test.ts does. `tcx` is a mock
     that carries the session and the crate types.
   - Each expectation is read off back/write.rs:117-282.
   - Cases:
     - default (`--emit=link`): an object for both kinds;
     - `-Copt-level=1/2/3/s/z`: loop vectorization at O2/O3, SLP at O3, MergeFunctions at O2/O3/s/z, all three for the
       allocator too;
     - the `-Cno-vectorize-*` and `-Zmerge-functions=disabled` overrides;
     - `--emit=obj`: no allocator object;
     - `--emit=llvm-ir,asm,llvm-bc`;
     - `-Csave-temps`: `emit_bc` for both kinds, `emit_pre_lto_bc` for the regular one;
     - an rlib under `--emit=link`: `ObjectCode(Full)`, because `-Cembed-bitcode` defaults to yes. `=no` and `--emit=obj`
       turn it off;
     - `-Clinker-plugin-lto`: `Bitcode`, but `ObjectCode(None)` for `#![no_builtins]`;
     - `-Cpasses`: the regular module only.
2. **`compute_per_cgu_lto_type`**: all 24 combinations of `Lto` × linker-does-LTO × {rlib only, exe, rlib+exe}, against the
   match arms at :792.
3. **The coordinator over a mock backend, two CGUs.**
   - The test drives back/write.rs the way base.rs:716 `codegen_crate` does (start, then wait / check / submit per CGU, then
     `codegen_finished`, `check_for_errors`, `OngoingCodegen::join`).
   - It records the main thread's steps and the backend's calls, with `std::thread::current().name()` at each call.
   - **How the expected order is derived from upstream.** It is the loop at :1593 evaluated by hand. With no token
     beyond the implicit one, `queue_full_enough(n, 1)` is `n >= 1`. So:
     - the coordinator optimizes the allocator module, then sends the first `CguMessage`;
     - every `CodegenDone` makes it lend the implicit token: `optimize`, then `codegen` (`Lto::No` at -O0), on the worker
       thread `opt cgu.N`;
     - then it sends the next `CguMessage`;
     - after `CodegenComplete`, the allocator module is codegened on the coordinator thread during main's `join`;
     - the modules come back sorted by name.

     The full derivation is in the test, next to the expectation.
   - Checked: the interleaved order, the thread names (`coordinator`, `opt cgu.1`, `opt cgu.0`), the final artifact list
     (`out/cgus.<cgu>.rcgu.o` for both CGUs, from `temp_path_for_cgu`; no allocator object under `--emit=obj`), and that
     the thread name is restored to `main`.
   - **A worker's panic:** the coordinator's `bug!("worker thread panicked")` ends the thread. Main's later waits fall
     through (the channel is disconnected), nothing more reaches the backend, and `join` raises
     `bug!("panic during codegen/LLVM phase")`.
4. **`produce_final_output_artifacts`**, one CGU, `--emit=obj`. The numbered object is copied to `cgus.o` and removed
   afterwards (`keep_numbered_objects` is false). The out directory ends up holding only `cgus.o`, with the mock's
   contents.
5. **`temp_path_*_for_cgu` against the oracle.**
   - The oracle runs from a scratch directory with relative paths (`cgus.rs`, `--out-dir out`), with `-Csave-temps -g
     -Csplit-debuginfo=unpacked --emit=obj,llvm-ir,asm,llvm-bc --target x86_64-unknown-linux-gnu -Ccodegen-units=2`.
   - The CGU names come from the same run's `-Zprint-mono-items`. The port builds `OutputFilenames` with its own
     `build_output_filenames` from the same flags.
   - The paths it computes for each CGU must equal the oracle's directory listing exactly: `temp_path_for_cgu` ×
     {o, bc, ll, s}, `temp_path_ext_for_cgu("no-opt.bc")`, and `split_dwarf_path` (= `temp_path_dwo_for_cgu`). The test
     also checks `TargetMachineFactoryConfig::new`.
   - Two configs:
     - `split`: the plain names, with the `.dwo` files beside the objects;
     - `long`: a 140-byte crate name with `-Cextra-filename=-xyz` and `-Zsplit-dwarf-out-dir=dwo`. The names exceed 143
       bytes, so `maybe_strip_file_name` must reproduce the oracle's StableHasher prefixes (`4e9946ecdc7b8196-…`,
       `919373f5688bad43-…`, `cbf9c2302aa8b124-…`, `e5ad019bb645ef48-…`), and the `.dwo` files go to `dwo/`.

     (The oracle writes no `.dwo` unless the `-Zsplit-dwarf-out-dir` directory already exists.)
6. Small ones: the ported `binary_search_by` insertion index among equal costs, and `desc` (the thread names, both cfgs).

**The tests bite.** I tried two mutations and reverted both:
- `queue_full_enough` requiring 2 queued items fails both coordinator tests;
- hashing the stripped prefix with `write` instead of `write_str` (dropping the `0xff`) fails the `long` oracle test.

### Sample difftests (`RUST_TS_AGENT=ssa-write`, `--sample 200 --jobs 6`, AC power)
- `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-212851-ssa-write-v25v`.
- `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-212937-ssa-write-ajf4`.
- `mir`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-213022-ssa-write-0x2q`.

## The coordinator representation (PORT decision, plan-m7 D15; root to record)
Upstream runs four kinds of thread: the main thread, the coordinator (`start_executing_work`'s closure), one worker per LLVM
work item (`spawn_work`, `spawn_thin_lto_work`), and a jobserver helper. rust-ts runs them as one sequential schedule of the
same threads. write.ts's section "Sequential threads and channels" holds it:
- **Channels** (`std::sync::mpsc::channel`) are in-memory queues. A channel whose senders live in another thread's closure
  names that thread as its `producer`.
- **The coordinator** is a generator (`JoinHandle` around it). It runs only while the main thread is blocked on it: a blocking
  `recv` on a channel it produces (`wait_for_signal_to_codegen_item`, `SharedEmitterMain::check(blocking)` in `join`), or
  `join`. It yields where upstream blocks in `coordinator_receive.recv()` on an empty queue.
  - The coordinator does not start at spawn. It starts at the main thread's first blocking point. Upstream it starts at
    once, but whatever it does before the first `CguMessage` is visible only through the `SharedEmitter`, which main reads
    at the same checkpoint in either case.
- **A worker** runs to completion inside `spawn_work`. Its `WorkItem` message is queued before the coordinator's next `recv`.
- **The jobserver helper never delivers a token** (D11: the port holds only the implicit token). `HelperThread::request_token`
  leaves the request pending. rustc_data_structures jobserver.ts's `client()` still stops, and write.ts does not call it:
  `into_helper_thread` is represented locally.
- **This is the schedule upstream runs when there are no extra tokens.** `tokens` stays empty, so the coordinator spawns work
  only by lending the implicit token. While it lends, main is blocked waiting for a `CguMessage`, so the worker's message is
  the only one that can arrive next. The order of backend calls is fixed (test 3). `SharedEmitter` diagnostics are emitted at
  main's checkpoints (`check_for_errors`, `join`), as upstream.
  - What differs from a real rustc is parallelism. Upstream with N tokens runs N workers at once; the outputs are the same,
    and `join` sorts the modules by name.
- **Panics.** A panic is caught at each thread boundary: `catch_unwind` in the worker, `JoinHandle::join` for the coordinator.
  `Unported` and a JS stack overflow propagate, as in sync/parallel.ts. While a thread runs, std/panicking.ts's
  `CURRENT_THREAD.name` is its name (`coordinator`, `opt <cgu>`), so the panic hook prints the right thread. A schedule that
  can never be woken (an upstream hang) panics with a "deadlock" message instead of looping.
- **`Coordinator`'s `Drop`** is a `drop()` method, and nothing in the port calls it. In upstream it runs when an
  `OngoingCodegen` is dropped unjoined, for example when `codegen_crate` unwinds on a fatal error. In the sequential model no
  worker is running at that point, and an `Aborted` coordinator spawns nothing more and returns `Err(())`. So skipping it
  changes no output, except a `-Z time-passes` "LLVM_passes" line, and the stand-in stops on time-passes anyway.
- `ThinLocal` (D8). write.rs stays faithful: at `-O` with several CGUs, `compute_per_cgu_lto_type` gives `Thin` and the
  modules go to `do_thin_lto` → `B::run_thin_lto`. D8's "ThinLocal becomes a no-op" therefore belongs to cg_llvm's
  `lto.rs` (`run_thin` / `optimize_and_codegen_thin`, lane cg-lto-diag), not to this file.

## Stub sites root must repoint
1. **base.ts, the `ssa_write` table** (ssa-base). Replace each entry, or its call site in `codegen_crate`:
   - `ModuleConfig_new(kind, tcx, nb)` → `ModuleConfig.new(kind, tcx, nb)`;
   - `ModuleConfig_bitcode_needed(c)` → `c.bitcode_needed()`;
   - `start_async_codegen(backend, tcx, r, a, m)` → `start_async_codegen(backend, tcx, r, a, m)`. Mine takes
     `WriteBackendMethods<W>`, and `ExtraBackendMethods<M> & WriteBackendMethods<W>` fits it;
   - `OngoingCodegen_wait_for_signal_to_codegen_item(o)` → `o.wait_for_signal_to_codegen_item()`;
   - `OngoingCodegen_check_for_errors(o, sess)` → `o.check_for_errors(sess)`;
   - `OngoingCodegen_codegen_finished(o, tcx)` → `o.codegen_finished(tcx)`;
   - `submit_codegened_module_to_llvm(c, m, cost)` → same name;
   - `submit_pre_lto_module_to_llvm(tcx, c, m)` → same name;
   - `submit_post_lto_module_to_llvm(c, m)` → same name.

   Also:
   - Delete base.ts's placeholder interfaces `OngoingCodegen` and `Coordinator` (base.ts:1453-1461) and import the classes
     from `./back/write.ts`.
   - `codegen_crate` returns `OngoingCodegen<W>`.
   - **Load order:** a static import of `./back/write.ts` from base.ts adds no module beyond what rustc_driver_impl's static
     closure already loads. I checked the closures with a script; write.ts reads `std/fs.ts` lazily for that reason. A lazy
     require would also do.
   - base_oracle/driver.ts replaces table entries with recorders. If the table goes, that driver needs another hook.
2. **`src/rustc_codegen_llvm/back/llvm_backend.ts:65` `ongoing_codegen_join`.** Downcast with
   `ongoing_codegen instanceof OngoingCodegen` (upstream's `.downcast::<OngoingCodegen<LlvmCodegenBackend>>().expect(..)`),
   then call `.join(sess, incr_comp_session, crate_info)`.
3. **llvm_backend.ts:145** `DiagCtxt::new(Box::new(shared_emitter.clone()))` → `DiagCtxt.new(shared_emitter.clone())`.
   `SharedEmitter` extends `Emitter`.
4. **llvm_backend.ts:149** `unported("ssa-write: CodegenContext.module_config")` → `cgcx.module_config`.
5. **llvm_backend.ts:479** `unported("ssa-write: CodegenContext.fewer_names")` → `cgcx.fewer_names`.
6. **llvm_backend.ts:483** `unported("ssa-write: TargetMachineFactoryConfig::new ...")` → `TargetMachineFactoryConfig.new(cgcx, name)`.
7. **`src/rustc_codegen_llvm/skeleton.test.ts:138`**: set `"ssa-write": 5` to 0 once 2–6 are repointed.
8. **`src/rustc_codegen_ssa/lib.ts:457, :462`** (ssa-base's foreign stubs `OutputFilenames_temp_path_for_cgu` /
   `OutputFilenames_temp_path_dwo_for_cgu`) → `outputs.temp_path_for_cgu(flavor, name)` /
   `outputs.temp_path_dwo_for_cgu(name)`. Update lib.ts's header lines 9-11.
9. **`src/rustc_codegen_ssa/back/lto.ts:173` `check_lto_allowed`**: drop the `CodegenContext_lto_fields` cast (ssa-base PORT
   8). `CodegenContext` now has `lto`, `crate_types`, `dylib_lto` and `prefer_dynamic`. Update the header lines 7-8.
10. For cg-write, not a stub: `rustc_codegen_llvm/back/write.ts` and `back/lto.ts` import `CodegenContext`, `ModuleConfig`,
    `SharedEmitter` and `TargetMachineFactoryFn` as types. They now read the upstream fields directly:
    - `cgcx.output_filenames.temp_path_for_cgu(..)` / `temp_path_ext_for_cgu("no-opt.bc", ..)`;
    - `config.emit_obj` is `EmitObj`; compare with `EmitObj_eq` or `.$`;
    - `shared_emitter.inline_asm_error(InlineAsmError)`.

## Every `unported(...)` left (all `-C incremental`, plan-m7 D11)
- `copy_all_cgu_workproducts_to_incr_comp_cache_dir`: past its early return for no `-C incremental`. Text:
  `"rustc_codegen_ssa::back::write::copy_all_cgu_workproducts_to_incr_comp_cache_dir (rustc_incremental copy_cgu_workproduct_to_incr_comp_cache_dir; -C incremental, plan-m7 D11)"`.
- `execute_copy_from_cache_work_item`, after building its `DiagCtxt`. A `CachedModuleCodegen` exists only with incremental
  (its `WorkProduct` is `never`). Text:
  `"rustc_codegen_ssa::back::write::execute_copy_from_cache_work_item (<cgu>: rustc_fs_util link_or_copy, WorkProduct saved_files; -C incremental, plan-m7 D11)"`.
- `submit_pre_lto_module_to_llvm`, after computing the file name (`CguReuse::PreLto`). Text:
  `"rustc_codegen_ssa::back::write::submit_pre_lto_module_to_llvm (<file>: rustc_incremental in_old_incr_comp_dir_sess; -C incremental, plan-m7 D11)"`.
- Reached through the stand-ins, not written here:
  - `-Z time-passes` stops in `SelfProfilerRef::verbose_generic_activity` (`LLVM_passes`, `LLVM_fatlto`, `LLVM_thinlto`);
  - `-Z remark-dir` reaches std/fs.ts `canonicalize` (host libc).

## `// PORT:` decisions (for root to record)
1. **Sequential threads and channels** (the representation section above): coordinator generator, inline workers, a helper
   that never delivers a token, `CURRENT_THREAD` naming, a deadlock panic, and `Coordinator::drop` as an uncalled method.
2. **`B_`**: the fns that upstream calls with only `B` (`execute_optimize_work_item`, `do_fat_lto`, `do_thin_lto`,
   `generate_thin_lto_work`, `spawn_work`, `spawn_thin_lto_work`) take the backend value first (ssa-contract decision 4).
   `start_executing_work` uses `backend`.
3. `Arc<T>` is the value. `CodegenContext: Clone` and `backend.clone()` give the same value. `SharedEmitter::clone` shares
   the sender. `Box<dyn Any>` from `thread_profiler` is dropped by calling its `drop()` if it has one (the port's `Drop`
   impls).
4. `#[derive(Encodable, Decodable)]` on `EmitObj`, `BitcodeSection`, `ModuleConfig` and `CodegenContext` is not written
   (no rlink of these).
5. `EmitObj` is a `$` union with `EmitObj_eq` for the derived `PartialEq`. `ModuleConfig` is a class (constructor in
   declaration order). `ModuleConfig::new` evaluates the struct literal's fields in the literal's order, which differs at
   `sanitizer_dataflow_abilist` / `sanitizer_recover`. `if_regular!` is a lazy two-closure helper.
6. `desc` has two cfg'd fns (`#[cfg(not(windows))]` :704 and `#[cfg(windows)]` :735). Both are ported, and `desc` picks one
   by `process.platform` (the host rustc runs on).
7. `binary_search_by_key(&cost, ..)`: core's `binary_search_by` loop is ported, with a `// std:` marker, so equal costs land
   at core's index.
8. `generic_activity_with_arg(label, arg)` is the stand-in's `generic_activity(label)`; with no self-profiler both are
   `TimingGuard::none()`. `drop(llvm_start_time)` prints nothing (the stand-in guard).
9. `Session: Deref<Target = EarlySession>`: `sess.merge_functions()` is `sess.early_sess.merge_functions()`. The TS
   `Session` forwards only some `EarlySession` methods; root could add `merge_functions` to the forwarders.
10. `tcx.incr_comp_session` is `tcx.gcx.incr_comp_session` (always `undefined`; plan-m2 D3).
11. `std::fs::copy` is Node's `copyFileSync` (contents and permission bits), local to write.ts. `fs::create_dir_all` is
    `mkdirSync({ recursive: true })`. Both could move to src/std/fs.ts.
12. config.ts: `PathBuf::set_file_name` is a local `path_set_file_name` next to the existing `path_set_extension`; both
    belong in src/std/path.ts. `maybe_strip_file_name` sits before the `OutputFilenames` class, which holds both the struct
    and its `impl`.

## Notes
- Root: `jobserver::client()` (rustc_data_structures jobserver.ts) still stops. Write.rs does not need it, because the
  helper is represented locally. If another caller appears, port `client()` to return the stand-in client with
  `into_helper_thread` as here.
