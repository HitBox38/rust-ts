# Review: lane `ssa-write` (wave 40o)

Reviewer, read-only on code. Branch `t3/port-ssa-write`, commits `811e5921` (port, tests, fixture, handoff) and `fac338e8`
(handoff fix), against `main` at `ba273e7f` (`git diff ba273e7f..fac338e8`). Upstream at the pin:
`compiler/rustc_codegen_ssa/src/back/write.rs` (2,271 lines) and `compiler/rustc_session/src/config.rs:1231-1395`.

## Verdict: **PASS WITH NOTES**

No must-fix findings. Every function of write.rs was read against upstream, in order. The coordinator's schedule was
re-derived from upstream's message loop and matches the test's expectation. The temp-path functions reproduce the oracle,
including a fresh non-ASCII case I generated myself. The notes are documentation and test-coverage points for root.

## Commands (AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`)
| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26626, 44 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 404)` |
| `bun scripts/coverage.ts --missing compiler/rustc_codegen_ssa/src/back/write.rs` | 40/40 ported |
| `bun scripts/coverage.ts --missing compiler/rustc_session/src/config.rs` | 136/136 ported |
| `bun test ./scripts/lib/unit-steps.test.ts` | 10 pass, 0 fail |
| `bun test ./src/rustc_codegen_ssa/ ./src/rustc_session/ ./src/std/result.test.ts` | 259 pass, 0 fail (31 files) |

No samples were run, as the brief asked.

## 1. Order and coverage
- 40/40 and 136/136. 26 write.rs markers and the 5 config.rs markers were spot-checked against the pin. Each points at its
  `fn` line: :117 `new`, :269, :294, :363, :405, :423, :507, :704, :735, :741, :751, :792, :819, :876, :961, :988, :1203,
  :1787, :1847, :1895, :1970, :1996, :2062, :2068, :2090, :2186, :2216, :2250; config.rs :1239, :1315, :1321, :1334, :1374.
- Order follows upstream. The documented deviations are:
  - `maybe_strip_file_name` sits before the `OutputFilenames` class, which holds both the struct and its impl;
  - the two cfg'd `desc` fns;
  - `queue_full_enough` is a nested fn after `return`, as upstream.
- The brief names `execute_fat_lto_work_item`, `execute_thin_lto_work_item`, `finish_intra_module_work` and `emit_*`. None
  of them exists at this pin. The pin's equivalents are `do_fat_lto` (:961), `do_thin_lto` (:988), `spawn_thin_lto_work`
  (:1895) and `execute_optimize_work_item` (:819), and those were reviewed instead.

## 2. Logic fidelity
- **`ModuleConfig::new`** (write.ts:376, write.rs:117-266). I checked every field.
  - `if_regular!` is lazy, and `opt_level` is `Some(optimize)` / `None`.
  - `should_emit_obj` is `Exe || (Regular && Object)`.
  - The `emit_obj` chain is `obj_is_bitcode || (linker_plugin_lto && (!no_builtins || cfi))` → `Bitcode`; then
    `need_bitcode_in_object || requires_lto` → `ObjectCode(Full)`; otherwise `ObjectCode(None)`.
  - Allocator side: `emit_pre_lto_bc` is false and `emit_bc` is `save_temps`.
  - `vectorize_*`, `merge_functions`, `verify_llvm_ir`, `lint_llvm_ir`, `no_prepopulate_passes`, `no_builtins` and
    `emit_lifetime_markers` are not `if_regular!`, so the allocator gets them too, as the test asserts.
  - The literal's evaluation order is kept: `sanitizer_dataflow_abilist` comes before `sanitizer_recover`. All the calls
    are pure anyway.
- **`sess.early_sess.merge_functions()`** (write.ts:482) is equivalent to upstream. session.ts:367 ports session.rs:427
  as `opts.unstable_opts.merge_functions ?? target.merge_functions`. `Target` forwards `merge_functions` through its option
  getters (rustc_target spec/mod.ts:3918), so this is upstream's `unwrap_or(self.target.merge_functions)`.
- **`CodegenContext`** has all 27 fields, in declaration order. The `start_executing_work` literal maps each one as
  upstream (write.rs:1257-1290), with these representations:
  - `target_arch` is `Arch.display`;
  - `pointer_size` is `data_layout().pointer_size()`;
  - the incremental dirs are always undefined (plan-m2 D3).
- **`start_async_codegen`**: same channels, same arguments. `OngoingCodegen` fields are in upstream order.
- **`compute_per_cgu_lto_type`**: the if-chain equals the guarded match, because a failed guard falls through to the later
  arms and then to `_`. The test enumerates all 24 inputs.
- **`produce_final_output_artifacts`** (write.rs:507-685) follows upstream:
  - `copy_gracefully` (Stdout / Real); `copy_if_one_unit` with the binary-to-tty check;
  - `ensure_removed` unless `-Csave-temps` or `keep_numbered`;
  - warnings for an explicit name or `-o` with several CGUs;
  - the per-type `keep_numbered` flags (Bitcode and Object true);
  - the cleanup rules (`needs_crate_object`, `keep_numbered_*` with `codegen_units > 1`, the allocator bitcode);
  - the JSON artifact notifications.
- **`execute_optimize_work_item`**, **`execute_copy_from_cache_work_item`**, **`do_fat_lto`** and **`do_thin_lto`** match
  upstream:
  - `binary_search_by_key` is core's `binary_search_by` loop. I compared it against library/core slice/mod.rs:2982, and the
    `Err` index is `base + (cmp == Less)`.
  - `truncate(saturating_sub(1))` is ported faithfully.
  - The `Token` / `WorkItem` arms are the same, including `bug!("worker thread panicked")`.
- **`OngoingCodegen::join`, `codegen_finished`, `check_for_errors`, `wait_for_signal_to_codegen_item`, `submit_*`** match
  upstream:
  - the modules are sorted with `str_cmp`, which compares code points, i.e. UTF-8 byte order as `String: Ord`;
  - the `expect` message is upstream's.
- **`SharedEmitter` / `SharedEmitterMain::check`** match upstream:
  - a `Diagnostic` is followed by `abort_if_errors`;
  - an `InlineAsmError` gets the level assertion, the span when it is not dummy, and the inline-asm source file with
    `normalized_byte_pos` spans;
  - a `Fatal` message calls `dcx().fatal`.

## 3. The coordinator
**My derivation (write.rs:1482-1715, with `tokens` always empty).** `jobserver_helper` exists only when `parallel` is set,
and its requests are never answered, so `tokens.len() == running_with_own_token == 0` throughout.
`extra_tokens = 0`, `additional_running = 0` and `anticipated_running = 1`. `queue_full_enough(n, 1)` gives
`quarter_of_workers = 1 - 3·1/4 = 1`, so the result is `n > 0 && n >= 1`, i.e. `n >= 1`.
1. The coordinator starts by optimizing the allocator (:1474). Ongoing + Idle with `n = 0`, so it sends a `CguMessage` and
   moves to Codegenning. The spawn loop does nothing (`0 < 0`). It blocks in `recv`.
2. Main's wait returns. Main compiles CGU A, sends `CodegenDone`, and waits again.
3. The coordinator inserts A by cost, asserts Codegenning, and goes Idle. `queue_full_enough(1, 1)` is true, so it pops A
   and moves to Lending; `spawn_work(A)` runs `optimize(A)` then, at `Lto::No`, `codegen(A)`. Main is blocked, the helper
   never sends, and no other worker exists, so the next message is A's `WorkItem`. Lending goes back to Idle, A is pushed
   to `compiled_modules`, and `n = 0`, so it sends a `CguMessage`.
4. The same happens for each further CGU. Main's last wait is the one inside `codegen_finished` (write.rs:2176-2180), so
   `CodegenComplete` only ever arrives in Codegenning. This is why upstream's `assert_eq!(main_thread_state, Codegenning)`
   (:1653) cannot fire.
5. After `CodegenComplete` the coordinator is Completed + Idle, with nothing running and nothing queued, so it breaks.
   With no LTO input it returns `NoLto` and the allocator is codegened (:1776). Main's `join` waits on the shared emitter
   (`check(sess, true)`), which disconnects only when the coordinator exits.

The resulting order is: allocator `optimize`; then `optimize` and `codegen` per CGU in submit order; then allocator `codegen`
during `join`. This is the test's expectation (write.test.ts:357-399).

`-Zthreads=1` gives `jobs.frontend = Some(1)`, so base.rs:823 pre-compiles one CGU before the loop. Upstream that runs
concurrently with the allocator `optimize`; here it runs before it. The pre-compile's diagnostics go to main's dcx
directly, and the allocator's go through the `SharedEmitter` to the first `check_for_errors`. So the printed order is the
same, and the order of write.rs's backend calls is unchanged.

**The `deadlock` panic** (write.ts:169) is invented, but it replaces only an upstream hang.
- Under codegen_crate's protocol, every point where main blocks has one of: a queued `CguMessage` (Codegenning); the
  `WorkItem` of a worker that already ran inline (Lending); or a coordinator that has finished.
- `run_until_blocked` returns `false` only when the coordinator waits on an empty queue that no runnable thread fills. That
  is a hang upstream too, for example `join` without `codegen_finished`.
- So no output upstream produces can change. The harness would report CRASH (exit 101) instead of TIMEOUT. See N5.

**Panics.** `is_not_an_unwind` (write.ts:92) is a copy of sync/parallel.ts:24: `Unported` and a JS stack overflow
propagate, and everything else is caught at the thread boundary. The hook runs when the `Panic` is constructed (std/panic.ts:14-18)
under `CURRENT_THREAD.name`, so the message names `coordinator` or `opt <cgu>`, as upstream's hook does on that thread.
This is consistent with the rest of the port; Miri's interpreted threads are a different mechanism and not comparable. I
also traced a worker panic:
1. the worker's catch gives `Err(None)`;
2. the coordinator calls `bug!` and its thread ends;
3. `Receiver.recv` sees the producer finished, so main's waits return `Err` and fall through, as upstream's do on a
   disconnected channel;
4. main's later `send`s are silently queued (upstream drops them);
5. `join` ends with `bug!("panic during codegen/LLVM phase")`.

**`Coordinator::drop`.** I confirmed the claim for every path I could reach.
- **Main fatals or panics mid-codegen** (`abort_if_errors` at base.rs:869, or a `check_for_errors` abort).
  - Upstream, the coordinator is Codegenning with no worker running, since the derivation above is strictly sequential.
  - Drop's `CodegenAborted` makes it break and return `Err(())`, which prints nothing.
  - In the port, every earlier work item has already run at main's waits.
- **Main fatals at the `check_for_errors` inside `codegen_finished`**: `CodegenComplete` was never sent, so this is the
  same case as above.

The handoff's reason ("no worker is running at that point") does not cover one more case. See N1.

## 4. Temp paths
- `maybe_strip_file_name` follows config.rs:1239-1258 line by line:
  - lengths in UTF-8 bytes, `saturating_sub`, `ceil_char_boundary`;
  - `impl Hash for str` is `write_str`, so `0xff` is appended;
  - `{:x}` of `Hash64` is the unpadded hex of a bigint;
  - `set_file_name` is pop then push.
- `temp_path_for_cgu`, `temp_path_dwo_for_cgu`, `temp_path_ext_for_cgu` and `split_dwarf_path` match :1315-1395.
- **Oracle, regenerated by me** (pinned `rustc +nightly`, relative paths, scratch dir):
  - The lane's `long` config gives exactly the fixture's names: `4e9946ecdc7b8196-`, `919373f5688bad43-`,
    `cbf9c2302aa8b124-`, `e5ad019bb645ef48-` and `.dwo` under `dwo/`. The fixture is genuine.
  - New case, not in the lane's tests: `--crate-name=` `é`×75 (150 bytes), `-Ccodegen-units=2 -Csave-temps --emit=obj`. The
    oracle wrote:
    - `8d90ba5280d58a0-éé…é.fd259df18cc77c9-cgu.N.rcgu.no-opt.bc`, a 15-digit hash (so `{:x}` is unpadded) with a cut on
      a char boundary;
    - `fb003077092d63bc-…rcgu.{o,bc}`.
  - The port's `OutputFilenames.temp_path_for_cgu` / `temp_path_ext_for_cgu`, built with the same stem and CGU names,
    gives **the identical 6 names** (`diff` empty).

## 5. No guessed values
- Three `unported` stops remain (write.ts:744, :1141, :2393), all incremental-only:
  - `copy_all_cgu_workproducts_to_incr_comp_cache_dir`, after upstream's early return for no `-C incremental`;
  - `execute_copy_from_cache_work_item`, reached only through a `CachedModuleCodegen`, whose `WorkProduct` type is `never`;
  - `submit_pre_lto_module_to_llvm` (`CguReuse::PreLto`). Upstream would `unwrap()` a `None` `incr_comp_session` there
    anyway.
- `merge_functions`: equivalent (§2).

## 6. Tests
The expectations come from upstream, not from the port's output.
- ModuleConfig cases quote write.rs's conditions.
- `compute_per_cgu_lto_type` quotes the match arms.
- The coordinator order is derived in the test (and above).
- `produce_final_output_artifacts` quotes the `keep_numbered_objects` rule.
- The file names are the oracle's directory listing.
- The two mutations the lane reports make sense for these tests: `queue_full_enough` requiring 2 items; `write` instead of
  `write_str`.
- `unit-steps.test.ts` passes.

## 7. Scope
`git diff --stat ba273e7f..fac338e8` touches the following files and nothing else:
- `src/rustc_codegen_ssa/back/write.ts`;
- `src/rustc_codegen_ssa/back/write.test.ts`;
- `src/rustc_codegen_ssa/back/write_oracle/{cgus.rs,oracle.json}`;
- `src/rustc_session/config.ts`, the assigned config.rs fns and consts;
- `docs/handoff/ssa-write.md`.

There are no changes under `harness/`, `scripts/`, `src/std/`, base.ts or rustc_codegen_llvm. The stub repointing is left
to root in the handoff.

## Findings

### F (must fix)
None.

### N (notes)
- **N1. `Coordinator::drop`: the handoff's reason is incomplete.**
  - Where: write.ts:2241; upstream write.rs:2068-2077 and :1723-1779.
  - The handoff says no worker is running when `drop` would be called, but the coordinator's own tail is not covered.
  - Once `codegen_finished` has queued `CodegenComplete`, upstream's coordinator runs its tail on its own: the allocator
    `B::codegen` (`NoLto`), or the whole of `do_thin_lto` for `ThinLocal` (`-O` with several CGUs). Drop's `join` waits for
    it. The port runs that tail only inside `join`, so an `OngoingCodegen` that is dropped unjoined after `codegen_finished`
    never runs it.
  - What differs:
    - only files: the allocator `.rcgu.o`, thin-LTO and `-Csave-temps` temps;
    - an ICE on the coordinator thread;
    - the `LLVM_passes` time-passes line.
  - Likewise, if main aborted before its first wait, upstream's allocator `optimize` would already have run (with
    `-Csave-temps`, cg_llvm writes `no-opt.bc`). On the main thread that window holds only `assert_module_sources`, which
    is incremental-only.
  - I found nothing fatal between `codegen_crate`'s return and `Linker::link` (`CrateInfo::new`,
    `report_unused_features`, the metrics dump). So I agree that no compared output changes, but the handoff/PORT text
    should state this tail case so root records an accurate decision. No code change.
- **N2. Upstream's default is parallel, not zero-token.**
  - Where: the header comment at write.ts:14 and the handoff ("This is the schedule upstream runs…").
  - Upstream config.rs:1789-1793 defaults `jobs.backend` to the available parallelism, and the LLVM backend supports
    parallel codegen. So the oracle normally holds extra tokens and runs workers concurrently; the zero-token schedule is
    what D15 chose.
  - Artifacts are the same, since `join` sorts (write.rs:2164).
  - The order of `SharedEmitter` diagnostics coming from different CGUs (LLVM warnings, inline-asm errors) is submit order
    here, but timing-dependent upstream.
  - Suggest wording the comment as "the schedule upstream runs when it gets no extra tokens (by default it does)". Root
    should expect order differences only in multi-CGU cases with LLVM-originated diagnostics; compiletest passes
    `-Ccodegen-units=1` (plan-m7 D8).
- **N3. No test drives the LTO paths through the coordinator.**
  - Where: write.test.ts. Untested: `NeedsThinLto` / `NeedsFatLto` collection, the `ThinLocal` `do_thin_lto` call inside
    the coordinator generator, and its non-yielding `Receiver.recv` (write.ts:1257). That recv relies on inline workers
    having already queued their message.
  - `ThinLocal` is the default at `-O` with more than one CGU, so the first M7 `-O` runs will reach it.
  - Suggest a mock-backend test (`run_thin_lto` returning two `ThinModule`s, `serialize_module` stubbed) once cg-lto lands.
- **N4. Root should record who owns D8's ThinLocal no-op.**
  - Background: write.rs stays faithful. `compute_per_cgu_lto_type` gives `Thin`, and the modules reach
    `B::run_thin_lto` / `optimize_and_codegen_thin`.
  - D8's "ThinLocal becomes a no-op with `PORT:`" therefore has to live in cg_llvm's lto.rs (lane cg-lto-diag), as the
    handoff says.
  - Root should record that assignment. Otherwise `-O` with several CGUs stops at `run_thin_lto`.
  - `lto::exported_symbols_for_lto(tcx, &[])` already runs in the prelude for `ThinLocal` (write.ts:1405).
- **N5. Record the `deadlock` panic as a decision.**
  - Where: write.ts:169.
  - It replaces only an upstream hang (§3), so it is safe, but it is behaviour upstream does not have. It turns a TIMEOUT
    into a CRASH (exit 101).
  - Root should record it with the D15 representation decision (handoff PORT 1).
- **N6. Redundant cast.** At write.ts:1420, `tcx.backend_optimization_level(null) as OptLevel`: the query's `Value` is
  already `OptLevel` (rustc_middle queries.gen.ts:1575). The `output_filenames(null) as OutputFilenames` casts are needed
  (`Value: unknown`, :1583).
