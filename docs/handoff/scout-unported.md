# scout-unported — what porting is left that does not wait on the owner

Research lane, read-only on code. Pin `6f5da406b56c`. Base: main `088bdb33`. Coverage 24,293 / 27,053 in-scope fns.
Evidence: the latest accepted gate `gate-20261110-113508-root-m7vn` (60 suites, every row read), the latest full run of
each report suite outside the gate, `bun scripts/coverage.ts --crate/--missing` for every file with a gap in the 12
crates, the 640 `unported(` call sites under `src/` (outside tests), and 13 single cases run by hand on both sides
(section 7). No gate, no suite, no sample run. AC power throughout.

## 0. Bottom line

1. **The existing suites are saturated.** The gate's 60 suites have 51 non-MATCH rows in all (section 1). Of these,
   33 are Rust backtraces the ICE report plan puts out of reach, 4 are Miri sockets (excluded in scope.json), 3 are
   codegen (D4), 3 are timeouts or UNSTABLE, and 8 are portable (host fs 4, cross-thread proc macros 2, dataflow
   graphviz 1, `aes` 1). Porting something no one has
   decided against gains **at most 7 gate-suite cases** (section 3), plus 2 in the miri-fail report suite.
2. **Nearly all of the 2,760 unported fns are (a) or (d).** Of the 12 crates' 2,622 unported fns: (a) about 1,700
   (codegen_ssa 930, rustc_target 613, the rest LLVM-, link- or arm64e-only), (d) about 690 (incremental, the
   parallel front end, self-profile, representation erased by PORTING §5 without a skip marker, `cfg(debug_assertions)`),
   (b) 37, (c) about 210 (section 2; exact: 1,691 + 686 + 37 + 208).
3. **The (c) work that is worth porting needs a new report suite to count.** Every (c) group I ran stops `unported`
   on both a hand-built case and the matching tests/ui file (section 7), but no suite passes those flags: the per-file
   suites use fixed argv, and the compiletest-argv suites cover only typeck, traits, borrowck, nll, mir, mir-dataflow,
   liveness, unsafe, pattern/usefulness, parser and run-pass tests. So lanes 1 and 2 below come with a harness batch.
   Without one, they gain coverage but no cases.
4. **Two findings for root, outside porting.** These are not lanes, so they are in section 8:
   - 132 of the 520 `mir-minicore`/`mir-o0`/`mirdump-minicore` cases skipped for `needs-llvm-components` target only
     specs the port already has: un-skipping them is a harness change. The other 388 need other targets' specs, which
     the brief counts as D3.
   - About 690 (d) fns could become `rustc-skip:` markers if root records a decision; the scope decisions behind them
     are already recorded.

## 1. What the latest gate does not match (evidence for (b))

`gate-20261110-113508-root-m7vn`, all 60 suites, every non-MATCH row, grouped by the `unported` message or the first
difference:

| rows | status | message / first difference | suites (rows) | class |
|---:|---|---|---|---|
| 25 | DIFF | `note: rust-ts prints the JS stack, not a Rust backtrace` | thir-tree 7, thirdump-ui 6, tydump-ui 6, mir-o2 3, mirdump-ui 2, miri-pass 1 | (d) plan-ice-report §4 "native backtrace frames ... stay DIFF" |
| 5 | UNPORTED | `std::backtrace::Backtrace Display (captured frames)` | thir-tree 2, mirdump-ui 1, thirdump-ui 1, tydump-ui 1 | (d) same |
| 3 | UNPORTED | `rustc_log::BacktraceFormatter (a Rust backtrace, RUSTC_LOG_BACKTRACE)` | mir-o2, mono-ui, run-pass-miri (all `attributes/log-backtrace.rs`) | (d) `rustc_log` excluded in scope.json; a Rust backtrace |
| 3 | UNPORTED | `std::fs::remove_file` ×2, `std::fs::metadata` ×1 (plan-m6 D14: src/std/fs.ts has no host implementation) | miri-pass-heavy 3 | **(b)** lane 4 |
| 1 | UNPORTED | `miri::shims::files::open_file_or_dir (host std::fs, isolation off; plan-m6 D14)` | miri-pass (`open_a_file_in_proc.rs`) | **(b)** lane 4 |
| 2 | UNPORTED | `proc_macro::bridge::server::MaybeCrossThread::run_bridge_and_client` | pm-ui, pm-expanded (`expand-expr.rs`) | **(b)** lane 5 |
| 1 | UNPORTED | `rustc_mir_dataflow::framework::graphviz::write_graphviz_results` | mir-opt-o4 (`dump_dataflow.rs`) | **(b)** lane 3 |
| 1 | UNPORTED | `aes::hazmat::equiv_inv_cipher_round (plan-m6 D5: the aes crate is not vendored in M6)` | miri-pass (`x86/intrinsics-x86-aes-vaes.rs`) | (b) once root lifts D5's M6 limit; optional in lane 5 |
| 2 | UNPORTED | `TcpSocket::new` (plan-m6 D2/A3) | miri-pass 2 | (d) `shims/unix/tcp_socket.rs` is excluded in scope.json (needs the owner) |
| 2 | UNPORTED | `getaddrinfo` (plan-m6 D2) | miri-pass 1, run-pass-miri 1 | (d) `socket_address.rs` is excluded in scope.json |
| 2 | DIFF | missing `warning: tail calling a function marked with #[track_caller] has no special effect` | mono-ui (`callee_is_track_caller{,_polymorphic}.rs`) | (a) emitted by `rustc_codegen_ssa/src/mir/block.rs:1126` during codegen |
| 1 | DIFF | `INFO rustc_codegen_ssa::base codegen_instance(...)` vs `Post-codegen` | mono-ui (`def-path-hash-ice-157238.rs`) | (a) `codegen_ssa/src/base.rs:403` |
| 2 | TIMEOUT | — | run-pass-miri-heavy (`hashset-connected-border-12860.rs`, `step_overflowing.rs`) | perf, not porting |
| 1 | UNSTABLE | — | miri-pass (`panic/panic1.rs`) | not porting |

The latest full run of each report suite outside the gate:

| suite | run | total | MATCH | not MATCH, with message |
|---|---|---:|---:|---|
| miri-fail | fixers-40-proto-miri-fail | 610 | 608 | 2 UNPORTED `miri::shims::files::open_file_or_dir` (`shims/input_arg_mismatch.rs`, `return_type_mismatch.rs`): **(b)** lane 4 |
| miri-pass-tb | 20261105-013243-root-i6a7 | 132 | 130 | 2 UNPORTED `mio::Poll::new (host I/O, isolation off; plan-m6 D5)`: (d) |
| ir-hello | w41-ir2 | 2 | 0 | 2 UNPORTED `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate`: (a) |
| mir-heavy | 20261106-193410-root-w40b-3zth | 1 | 0 | 1 TIMEOUT |
| host-rlib | w44-hr-full | 222 | 222 | — |
| rlib-native | 20261109-080713-w46-review-pojx | 58 | 58 | — |
| check-chain, miri-sysroot-{core,alloc,std} | latest | 1 each | 1 each | — |

## 2. Classification by crate and upstream file

Key: **(a)** blocked on D4/D1/D3 (LLVM codegen, opt/llc, other targets); **(b)** a suite reaches it now (section 1);
**(c)** no suite reaches it, with the flag or suite that would; **(d)** deliberately skipped or out of scope, with the
citation. **(d\*)** means "erased by PORTING §5's representation table or by codegen, but no `rustc-skip:` marker
yet": out of reach in practice, counted as unported until root records a skip decision (PORTING §3: "Do not skip
anything else without a recorded root decision"). Counts are unported fns.

### rustc_codegen_ssa — 940 unported of 1,091

| group (plan-m7 §2d) | files | fns | class |
|---|---|---:|---|
| Traits, common | `traits/{builder 140, type_ 43, consts 25, debuginfo 14, write 11, backend 10, misc 10, intrinsic 10, statics 3, asm 3, declare 2, coverageinfo 1, abi 1}`, `common.rs` 7 | 280 | (a) |
| MIR codegen | `mir/{block 35, operand 31, debuginfo 31, place 23, retag 21, rvalue 14, analyze 11, naked_asm 6, mod 6, locals 5, intrinsic 5, constant 4, statement 1, coverageinfo 1}`, `meth.rs` 8, `mono_item.rs` 6, `size_of_val.rs` 1 | 209 | (a); also behind mono-ui's 3 DIFFs |
| Debuginfo | `debuginfo/type_names.rs` 20, `debuginfo/mod.rs` 3 | 23 | (a) |
| Linker | `back/linker.rs` 211 + tests 2, `back/command.rs` 18, `back/rpath.rs` 6 + tests 4, `back/apple/tests.rs` 4 | 245 | (a) D1 (`cc`) and D3; executables need codegen output (the dummy backend refuses every crate type but rlib: `rustc_interface/src/util.rs:468`) |
| Link | `back/link.rs` 72, `back/link/raw_dylib.rs` 5 | 77 | (a) same; the rlib path is done and checked by host-rlib (222/222) and rlib-native (58/58) |
| Write, LTO | `back/write.rs` 40, `back/lto.rs` 6 | 46 | (a) |
| Archive, symbol edit | `back/archive.rs` 10 (COFF/mingw import libs, `extract_bundled_libs`, builder trait), `back/symbol_edit.rs` 14 (staticlib symbol hiding) | 24 | (a) |
| Crate driver | `base.rs` 20, `lib.rs` 6 | 26 | (a) |
| Incremental assertions | `assert_module_sources.rs` | 10 | (d) incremental (PLAN.md §4, scope.json `rustc_incremental`) |

Note for root: none of codegen_ssa depends on **which way** D4 is answered. Seam A (port `rustc_codegen_llvm`) and seam B
(a hand-written `Builder`) both sit under codegen_ssa's `Bx: BuilderMethods` code. What it waits for is a backend to
check it against: no suite can reach it before `ir-hello` runs.

### rustc_target — 637 unported of 930

| group | fns | class |
|---|---:|---|
| `spec/targets/*` (328 files, 10,678 lines; one `target()` each) | 328 | (a) other targets, D3 (see section 8: `--print target-spec-json` could check them without codegen) |
| `spec/base/*` (40 files) | 47 | (a) same |
| `asm/*`: amdgpu 21, xtensa 13, powerpc 12, arm 12, sparc 11, riscv 8, s390x 7, mips 7, loongarch 7, hexagon 7, bpf 7, avr 7, msp430 6, m68k 6, csky 6, spirv 5, nvptx 5 | 147 | (a) other architectures; reached only by the 388 skipped minicore cases on other targets |
| `callconv/*`: riscv 8, loongarch 8, x86 7, nvptx64 6, wasm 5, mips64 5, bpf 5, xtensa/sparc/s390x/powerpc64/arm 4 each, … (22 files) | 91 | (a) same |
| target-spec JSON schema: `json_schema`/`schema_name` in `lib.rs` 2, `spec/mod.rs` 8, `spec/json.rs` 6 | 16 | (c) `--print target-spec-json-schema -Zunstable-options` (stops at `rustc_target::spec::json_schema`, section 7); needs the `schemars` derive, not vendored; low value |
| custom target JSON: `spec/json.rs` `from_json`, `from_str`; `json.rs:121 deserialize`; `spec/tuple.rs` `hash`, `from_path`; `spec/consistency.rs` 1; `tests.rs` 2 | 8 | (c) `--target <file>.json`; no ui test uses one (run-make only) |

### rustc_data_structures — 414 unported of 960

| group | files (fns) | fns | class |
|---|---|---:|---|
| Parallel front end | `sync.rs` 18, `sync/lock.rs` 16, `sync/vec.rs` 10, `sync/worker_local.rs` 9, `sync/freeze.rs` 6, `marker.rs` 6 | 65 | (d) PLAN.md §4 + scope.json `rustc_thread_pool`; PORTING §5 maps `Lock`/`RwLock`/`AppendOnlyVec`/`FreezeLock` to the inner value |
| Incremental | `graph/linked_graph/mod.rs` 41 + tests 8 (only users: `rustc_incremental` and `dep_graph/retained.rs`), `flock.rs` 4, `flock/unix.rs` 4, `flock/unsupported.rs` 1 | 58 | (d) PLAN.md §4, plan-m2 D3 |
| Self-profile / time-passes | `profiling.rs` 49 + tests 2 | 51 | (d) `-Zself-profile` writes measureme files, `-Ztime-passes` prints wall times; neither is byte-comparable. Profiling skips were ratified for rustc_span (history 2026-10-12) |
| Representation erased (no marker) | `unord.rs` 81 (PORT notes use `Map`/`Set` with explicit stable sorts), `vec_cache.rs` 22 + tests 11, `sharded.rs` 15, `tagged_ptr.rs` 11 + tests 5, `packed.rs` 10 (Pu128 is a `bigint`), `flat_map_in_place.rs` 22, `lib.rs` 8 (`outline`, `defer`, `make_display`), `fx.rs` 4, `unhash.rs` 3, `aligned.rs` 1, `binary_search_util` 1 + tests 3, `intern/tests` 2, `owned_slice/tests` 8 | 207 | (d\*) |
| LLVM FFI and linking helpers | `small_c_str.rs` 8 + tests 5, `memmap.rs` 9 (anonymous/writable maps), `temp_dir.rs` 3 (`MaybeTempDir`, link) | 25 | (a) |
| Thousands separators | `thousands/mod.rs` 4 + tests 4 | 8 | (c) `-Zmeta-stats` / `-Zinput-stats` (lane 2): `encode_crate_root` stops on it today |

### rustc_middle — 267 unported of 3,369

| group | files (fns) | fns | class |
|---|---|---:|---|
| Dep graph, on-disk cache | `query/on_disk_cache.rs` 50, `dep_graph/{graph 49, serialized 39, dep_node_key 32, dep_node 16, edges 8, retained 6, mod 6, debug 5}`, `verify_ich.rs` 3 | 214 | (d) plan-m2 D3 ("no dep graph / incremental / on-disk cache"); the stubs say "(D3)" |
| Pointer authentication | `ptrauth/discriminator.rs` 17, `ptrauth/llvm_siphash/mod.rs` 7 + tests 2 | 26 | (a) arm64e / pauthtest targets, codegen |
| Autodiff, offload | `ty/typetree.rs` 4, `ty/offload_meta.rs` 4 | 8 | (a) plan-m7 D4 keeps enzyme, autodiff, typetree and offload out of coverage |
| Generic graphviz | `mir/generic_graphviz.rs` | 7 | **(b)** with lane 3 (`-Zdump-mir-dataflow`) |
| Macro bodies, trivial impls | `macros.rs` 4 (`TrivialLiftImpls`/`TrivialTypeTraversalImpls` bodies: PORTING "Macros inside rustc" → tools/codegen), `ty/relate.rs` 4 (`Relate` for `Ty`, `GenericArgsRef`, `GenericArg`, `Term`: one-line dispatch), `ty/abstract_const.rs:28 from`, `tests.rs:7 noop` | 10 | (d\*) |
| Delayed-bug query | `util/bug.rs` `trigger_delayed_bug`, `provide` | 2 | (c) `#[rustc_delayed_bug_from_inside_query]` (`tests/ui/treat-err-as-bug/span_delayed_bug.rs`, an ICE test) with compiletest's argv |

### rustc_passes — 88 unported of 338

| file | fns | class |
|---|---:|---|
| `input_stats.rs` (803 lines) | 72 | (c) `-Zinput-stats` (`tests/ui/stats/input-stats.rs`; stops at `rustc_passes::input_stats::print_hir_stats`, section 7). Lane 2 |
| `hir_id_validator.rs` | 16 | (d) its only caller is `#[cfg(all(not(doc), debug_assertions))]` (`rustc_interface/src/passes.rs:1106`); the oracle has no debug assertions, so no oracle can reach it |

### rustc_monomorphize — 63 unported of 153

| file | fns | class |
|---|---:|---|
| `offload/manifest.rs` 62, `offload/mod.rs` 1 | 63 | (a) `-Zoffload` (GPU offload needs LLVM; plan-m7 D4 and D18) |

### rustc_errors — 52 unported of 362

| file | fns | class |
|---|---:|---|
| `markdown/{parse 20, term 7, mod 4}.rs` (887 lines) + `markdown/tests/{parse 19, term 2}.rs` | 52 | (c) `rustc --explain EXXXX`: today every `--explain` stops at `rustc_driver_impl::handle_explain`, colored or not (section 7). The markdown renderer is reached with `--color=always` and no tty (`show_colored_md_content`). Lane 1 |

### rustc_query_impl — 43 unported of 90

| file | fns | class |
|---|---:|---|
| `self_profile.rs` | 13 | (d) `-Zself-profile` |
| `dep_kind_vtables.rs` 10, `incremental.rs` 7 | 17 | (d) plan-m2 D3 |
| `execution.rs`: `latch_wait_on`, `wait_for_query` (parallel); `execute_job_incr`, `load_from_disk_or_invoke_provider_green`, `ensure_can_skip_execution`, `execute_query_incr_inner`, `force_query_dep_node` (incremental) | 7 | (d) |
| `job.rs`: `abstracted_waiters_of`, `find_cycle`, `connected_to_root`, `process_cycle`, `find_and_process_cycle`, `break_query_cycle` (the parallel deadlock handler) | 6 | (d) parallel front end |

### rustc_session — 35 unported of 446

| file: fns | fns | class |
|---|---:|---|
| `session.rs`: `PointerAuthConfig` (`function_pointers_default`, `init_fini_default`, `default`, `calculate_pauth_abi_version`, `from_raw`, `fn_attrs`), `pointer_authentication{,_functions,_init_fini}` | 9 | (a) arm64e / pauthtest |
| `session.rs`: `needs_plt`, `fewer_names`, `direct_access_external_data`, `branch_protection`, `must_emit_unwind_tables`, `get_tools_search_paths`, `is_wasi_reactor` | 7 | (a) codegen and linker |
| `session.rs`: `lint_groups_iter` | 1 | (c) `-W help` (lane 1) |
| `session.rs`: `deref`, `deref_mut` | 2 | (d\*) |
| `filesearch.rs`: `dll_path` ×3, `current_dll_path`, `default_sysroot`, `default_from_rustc_driver_dll`, `from_env_args_next` | 7 | (c) any run without `--sysroot` (stops at `rustc_session::filesearch::default_sysroot`, section 7). Every suite passes `--sysroot`, and the port has no `librustc_driver` dylib to locate, so this needs a recorded decision first (e.g. "the oracle toolchain's sysroot") |
| `config.rs`: `temp_path_for_cgu`, `temp_path_dwo_for_cgu`, `temp_path_ext_for_cgu`, `split_dwarf_path`, `maybe_strip_file_name` | 5 | (a) codegen unit outputs and split DWARF |
| `config/externs/tests.rs` | 4 | (c) unit tests (lane 6) |

### rustc_interface — 33 unported of 90

| file: fns | fns | class |
|---|---:|---|
| `tests.rs` (972 lines: option parsing and `dep_tracking_hash` per option) | 26 | (c) unit tests, checked by upstream's own asserts under `bun test` (lane 6) |
| `util.rs`: `load_backend_from_dylib`, `create_dll_import_lib`, `rustc_path`, `get_codegen_sysroot` | 4 | (a) backend loading (`-Zcodegen-backend=<name or path>`), Windows import libs |
| `callbacks.rs`: `track_span_parent`, `track_diagnostic` | 2 | (d) incremental (span-parent and diagnostic tracking for the dep graph) |
| `passes.rs:321 print_macro_stats` | 1 | (c) `-Zmacro-stats` (lane 2) |

### rustc_mir_dataflow — 30 unported of 378

| file | fns | class |
|---|---:|---|
| `framework/graphviz.rs` (716 lines) | 30 | **(b)** mir-opt-o4 `tests/mir-opt/dump_dataflow.rs` (`-Zdump-mir-dataflow`) stops at `write_graphviz_results`. Lane 3 |

### rustc_driver_impl — 20 unported of 77

| file: fns | fns | class |
|---|---:|---|
| `lib.rs`: `handle_explain`, `show_md_content_with_pager`, `show_colored_md_content`; `highlighter.rs` `highlight`, `new`, `highlight_rustc_lexer` | 6 | (c) `--explain` (lane 1). The pager branch needs a tty, so no harness can reach it; port it anyway, in order |
| `lib.rs`: `describe_lints`, `sort_lints`, `sort_lint_groups` | 3 | (c) `-W help` (stops at `describe_lints`, section 7). Lane 1 |
| `lib.rs`: `list_metadata` | 1 | (c) `-Zls=…` (stops at `list_metadata`). Lane 1, if the oracle does not ICE on the chosen inputs (my `-Zls=root` on core's rlib exited 101 on the oracle too) |
| `lib.rs`: `dump_feature_usage_metrics` | 1 | (c) `-Zmetrics-dir` (writes a JSON file; run-make only upstream). Lane 1 |
| `lib.rs`: `process_rlink` | 1 | (a) `-Zlink-only` needs an `.rlink` from codegen |
| `lib.rs`: `install` (the non-unix no-op signal handler), `config` (provided `Callbacks::config`), `init_logger_with_additional_layer`, `install_ctrlc_handler`; `signal_handler.rs`: `backtrace_symbols_fd`, `backtrace_stderr`, `min_sigstack_size` ×2 | 8 | (d) platform cfg, `rustc_log` (excluded), native backtraces on SIGSEGV |

### Vendored crates and library/

These are ported on demand, so most of the gap is code the port never calls. The parts that matter:
- **(a):** `object-0.39.1` 595/2,862 (the write side, and COFF/XCOFF; plan-m7 §2d), `ar_archive_writer` 38/86 (COFF
  members), `wasmparser` 81/2,413 (wasm targets).
- **(d):** `jobserver` 10/101 (plan-m7 D11, D15: single-threaded).
- **(c):** `pulldown-cmark` 266/1,471 (rustdoc-style doc links; the rest is HTML rendering), and `hashbrown`,
  `regex-automata`, `zerovec`, `litemap`, `bitflags` (subsets used through other crates).
- **library/:** `library/std` 115/954 (`fs` is lane 4) and `library/core` 89/503, ported per call site.

## 3. Ranking of the (b) groups by cases gained

Only cases the latest runs show; nothing extrapolated.

| rank | group | gate-suite cases (UNPORTED → MATCH if the port is right) | report-suite cases | upstream size | lane |
|---:|---|---|---|---|---|
| 1 | Miri host file system: `src/std/fs.ts` host stand-ins (plan-m6 D14 allows them under `// PORT:`) + `miri::shims::files::open_file_or_dir` | **4**: miri-pass `open_a_file_in_proc.rs`; miri-pass-heavy `issue-miri-3680.rs`, `shims/fs.rs`, `shims/fs-permissions.rs` | **2**: miri-fail `input_arg_mismatch.rs`, `return_type_mismatch.rs` | `library/std/src/fs.rs` and `sys/fs/unix.rs` subset, ~1.5k | 4 |
| 2 | Cross-thread proc-macro execution: `proc_macro::bridge::server::{MaybeCrossThread, MessagePipe}` (plan-m6 D8's remaining item) | **2**: pm-ui and pm-expanded `expand-expr.rs` | — | ~0.4k + an `mpsc` stand-in | 5 |
| 3 | Dataflow graphviz: `rustc_mir_dataflow/framework/graphviz.rs` + `rustc_middle/mir/generic_graphviz.rs` | **1**: mir-opt-o4 `dump_dataflow.rs` (stdout/stderr/exit only) | 13 `.dot` files the oracle writes for that case, unchecked until mir-opt-o4 compares `-Zdump-mir-dir` | 890 lines | 3 |
| 4 | `aes` vendor (soft backend) for Miri's x86 AES intrinsics | **1**: miri-pass `intrinsics-x86-aes-vaes.rs` | — | `aes` soft backend, ~1.5k | optional in 5 (needs root to lift plan-m6 D5's "not vendored in M6") |
| — | Sockets (`tcp_socket.rs`, `socket_address.rs`), `mio::Poll` | 4 (miri-pass 3, run-pass-miri 1) | 2 (miri-pass-tb) | — | not proposed: excluded in scope.json, so the owner must approve |
| — | Rust backtraces (ICE notes, `Backtrace` Display, `rustc_log::BacktraceFormatter`) | 33 | — | — | not portable (plan-ice-report §4) |
| — | codegen_ssa warnings and logs | 3 (mono-ui) | — | — | (a) |

**Total that porting alone can gain in gate suites: 7 (8 with `aes`), plus 2 in miri-fail.**

## 4. The (c) groups worth porting, and what would reach them

| group | fns | upstream lines | flag | stops today at (section 7) | suite that would check it |
|---|---:|---:|---|---|---|
| `--explain` + markdown renderer + highlighter | 58 | ~1,660 (incl. 488 test lines) | `--explain EXXXX`, `--color=always` | `rustc_driver_impl::handle_explain` | new report suite `cli-explain`: all 518 codes in `rustc_error_codes/src/error_codes/`, plain and `--color=always` → **~1,036 cases**; + `tests/ui/explain/*` (7 files) in a compiletest-argv suite |
| `-W help`, `--print calling-conventions`, `--print crate-root-lint-levels`, `-Zls`, `-Zmetrics-dir` | ~8 + `rustc_abi::all_names` + `print_crate_info` branch | ~300 | as named | `describe_lints`, `rustc_abi::all_names`, `print_crate_info (--print crate-root-lint-levels)`, `list_metadata` | same CLI suite: `-W help` (1–2), calling-conventions (1), crate-root-lint-levels over check-ui's 730 crates (**~730**) |
| `-Zinput-stats`, `-Zmacro-stats`, `-Zmeta-stats` | 72 + 6 + 1 + 8 | ~1,300 | as named | `print_hir_stats` / `print_ast_stats`, `print_macro_stats`, `encode_crate_root: -Zmeta-stats (thousands)` | `tests/ui/stats/{input,macro,meta}-stats.rs` (3) with compiletest's argv; a report suite with these flags appended to rmeta-ui's 730 crates → **up to ~730** |
| Default sysroot discovery | 7 | ~150 | no `--sysroot` | `filesearch::default_sysroot` | any CLI case without `--sysroot`; needs a decision first |
| Unit tests | 26 + 4 + 2 | ~1,100 | — | — | `bun test` (upstream's asserts) |

## 5. Proposed lanes (no D1, D3 or D4 needed)

Order by expected cases. Lanes 1 and 2 need a harness batch (a new report suite, reviewed separately per AGENTS.md
§2) before they show any cases. Lanes 3–5 are checked by suites that already exist.

### Lane 1 — `driver-cli` (~2.0k upstream lines, ~70 fns)
- **Files:**
  - `compiler/rustc_errors/src/markdown/{mod,parse,term}.rs` + `markdown/tests/{parse,term}.rs`
  - `compiler/rustc_driver_impl/src/highlighter.rs`
  - `compiler/rustc_driver_impl/src/lib.rs`: `handle_explain`, `show_md_content_with_pager`, `show_colored_md_content`,
    `describe_lints`, `sort_lints`, `sort_lint_groups`, `list_metadata`, `dump_feature_usage_metrics`, and the
    `CrateRootLintLevels` branch of `print_crate_info`
  - `compiler/rustc_session/src/session.rs:84 lint_groups_iter`
  - `rustc_abi::all_names`: `extern_abi.rs:374`; coverage counts it as ported, yet it stops `unported`
  - the `-Zls` Decodable gaps in `rustc_metadata` `decoder.ts` (`LangItem`, `TargetModifier`)
- **Gain:**
  - +~70 fns.
  - Cases: **~1,036** (`--explain`) + **~730** (`--print crate-root-lint-levels`) + 2–3 (`-W help`,
    calling-conventions) in a new CLI report suite. Every one of these stops `unported` today (section 7).
  - In existing suites: 0.
- **Verify:** markdown unit tests under `bun test`, plus the new `cli` report suite (harness batch: argv lists only;
  the oracle is deterministic, no tty, so the pager branch is not reached).
- **Note:** `--explain`'s text already comes from the generated long descriptions (fixers-40).

### Lane 2 — `stats` (~1.3k upstream lines, ~87 fns, plus a probe table)
- **Files:**
  - `compiler/rustc_passes/src/input_stats.rs`
  - `compiler/rustc_data_structures/src/thousands/{mod,tests}.rs`
  - `compiler/rustc_expand/src/stats.rs` and its 4 call sites in `rustc_expand/src/expand.rs`
  - `compiler/rustc_interface/src/passes.rs:321 print_macro_stats` and the two `print_*_stats` stops there
  - the `-Zmeta-stats` branch in `rustc_metadata/rmeta/encoder.ts`
- **Caveat:** input-stats prints `size_of::<T>()` of AST and HIR node types, which are Rust layout facts. They must
  come from an oracle-built table (a tools batch: a rustc-dev probe printing those sizes), never typed in by hand
  (the test is `needs-deterministic-layouts`, `only-64bit`).
- **Gain:**
  - +~87 fns.
  - Cases: 3 tests/ui files with compiletest's argv; up to ~730 in a report suite that appends the three flags to
    rmeta-ui's crates. Meta-stats should match wherever rmeta-ui already matches, since its numbers are section sizes
    of a byte-identical rmeta.
  - In existing suites: 0.
- **Verify:** that report suite, and the three ui tests.

### Lane 3 — `dataflow-graphviz` (~0.9k upstream lines, 37 fns)
- **Files:**
  - `compiler/rustc_mir_dataflow/src/framework/graphviz.rs`
  - `compiler/rustc_middle/src/mir/generic_graphviz.rs`
  - wire the already-ported `rustc_graphviz` (58/58) into the stubs that still call `unported("rustc_graphviz::…")`:
    `rustc_borrowck/region_infer/graphviz.ts` (the `nll.0.regioncx.{all,scc}.dot` the oracle writes) and
    `rustc_data_structures/obligation_forest/mod.ts`
  - `rustc_middle::mir::graphviz::write_mir_fn_graphviz`, still a stop in `rustc_middle/mir/pretty.ts`
- **Gain:**
  - **1 gate-suite case** (mir-opt-o4 `dump_dataflow.rs`, UNPORTED → MATCH), +37 fns.
  - With a harness batch that makes mir-opt-o4 compare both sides' `-Zdump-mir-dir` (both are already written under
    `$RUST_TS_DATA/tmp/mir-opt-o4/{oracle,subject}`): that case's 13 `.dot` files, and every `.mir` dump of the 406
    cases (the oracle side holds 138 files today, the subject side 3).
- **Verify:** mir-opt-o4.

### Lane 4 — `miri-host-fs` (~1.5k lines of library/std, plus Miri glue)
- **Files:**
  - `src/std/fs.ts`, with host implementations of the `library/std/src/fs.rs` and `sys/fs/unix.rs` calls that Miri's
    file shims make with isolation off (`metadata`, `remove_file`, open, read_dir and whatever the cases reach next),
    with `// std:` markers and `// PORT:` per plan-m6 D14
  - the `open_file_or_dir` stop in `src/miri/shims/files.ts`
- **Ownership:** root must assign `src/std/fs.ts` explicitly (PORTING §1).
- **Gain:** **4 gate-suite cases** (miri-pass 1, miri-pass-heavy 3) + 2 miri-fail. Each case must still match the
  oracle's error text and file names; D14 requires the same argv and cwd.
- **Verify:** miri-pass, miri-pass-heavy (heavy class, nothing beside it), miri-fail.
- **Risk:** host-dependent output (permissions, timestamps). Every `PORT:` needs D14's byte-exact rule.

### Lane 5 — `pm-cross-thread` (~0.4k upstream lines + a recorded decision; optionally `aes`)
- **Files:**
  - `library/proc_macro/src/bridge/server.rs`: `MaybeCrossThread::run_bridge_and_client`, `MessagePipe::{new, send,
    recv}`
  - a `std::sync::mpsc` stand-in in `src/std` for the two-party, in-order message passing the bridge needs
- **Needs:** a root decision on how a second thread is modeled (plan-m6 D8's remaining item).
- **Gain:** **2 gate-suite cases** (pm-ui, pm-expanded `expand-expr.rs`).
- **Optional, if root lifts plan-m6 D5's "not vendored in M6":** vendor `aes` (soft backend; `hazmat` API) for **1**
  more miri-pass case (`intrinsics-x86-aes-vaes.rs`). It is unrelated code; split it out if the lane grows.
- **Verify:** pm-ui, pm-expanded, miri-pass.

### Lane 6 — `interface-tests` (~1.1k upstream lines, 30 fns; coverage and regression value, no cases)
- **Files:** `compiler/rustc_interface/src/tests.rs` (option parsing and the per-option `dep_tracking_hash` rules),
  `compiler/rustc_session/src/config/externs/tests.rs`, `compiler/rustc_data_structures/src/thousands/tests.rs` if
  lane 2 does not take it.
- **Gain:** +30 fns, and a unit check on every `-C`/`-Z` option's tracking class, which the rmeta suites depend on
  indirectly.
- **Verify:** `bun test`.

**If all six land:**
- About 220 compiler fns (24,293 → ~24,510).
- **7–8 cases in existing gate suites**, 2 in miri-fail.
- About 2,500 cases in the new report suites, once those exist. That figure is an upper bound: it assumes each case
  matches after the port.

## 6. Top `unported` messages across all suites

From the gate's 60 suites plus the latest full run of every report suite outside it (miri-fail, miri-pass-tb,
ir-hello, mir-heavy, host-rlib, rlib-native, check-chain, miri-sysroot-*). UNPORTED rows only; the 25 "JS stack" DIFF
rows are in section 1.

| rows | message | suites | where the fix sits |
|---:|---|---|---|
| 5 | `std::backtrace::Backtrace Display (captured frames)` | thir-tree 2, mirdump-ui, thirdump-ui, tydump-ui | none (plan-ice-report §4) |
| 3 | `rustc_log::BacktraceFormatter (a Rust backtrace, RUSTC_LOG_BACKTRACE)` | mir-o2, mono-ui, run-pass-miri | none (`rustc_log` excluded; a Rust backtrace) |
| 3 | `miri::shims::files::open_file_or_dir (host std::fs, isolation off; plan-m6 D14)` | miri-pass 1, miri-fail 2 | lane 4 |
| 2 | `std::fs::remove_file (host file system access, isolation off; plan-m6 D14 …)` | miri-pass-heavy | lane 4 |
| 2 | `proc_macro::bridge::server::MaybeCrossThread::run_bridge_and_client (cross-thread proc-macro execution …)` | pm-ui, pm-expanded | lane 5 |
| 2 | `miri::shims::unix::tcp_socket::TcpSocket::new (… plan-m6 D2/A3 …)` | miri-pass | owner (scope.json) |
| 2 | `miri::shims::unix::socket_address::EvalContextExt::getaddrinfo (plan-m6 D2: sockets)` | miri-pass, run-pass-miri | owner (scope.json) |
| 2 | `mio::Poll::new (host I/O, isolation off; plan-m6 D5)` | miri-pass-tb | root/owner |
| 2 | `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (after collect_and_partition_mono_items; codegen; M7)` | ir-hello | D4 |
| 1 | `std::fs::metadata (host file system access …)` | miri-pass-heavy | lane 4 |
| 1 | `rustc_mir_dataflow::framework::graphviz::write_graphviz_results` | mir-opt-o4 | lane 3 |
| 1 | `aes::hazmat::equiv_inv_cipher_round (plan-m6 D5 …)` | miri-pass | lane 5 (optional) |

Stops that no suite reaches but that a single case shows (section 7; each would surface as soon as a suite passes the
flag): `rustc_driver_impl::handle_explain`, `describe_lints (-W help)`, `print_crate_info (--print
crate-root-lint-levels)`, `rustc_abi::all_names (--print calling-conventions)`, `rustc_target::spec::json_schema`,
`list_metadata (-Z ls)`, `rustc_passes::input_stats::print_hir_stats`, `rustc_expand::stats`, `print_macro_stats`,
`encode_crate_root: -Zmeta-stats`, `filesearch::default_sysroot`, and
`rustc_target::spec::targets::<tuple> (built-in target …)` for every target outside the 6 ported specs.

## 7. Single cases run to confirm the paths

Both sides were run from the scratchpad with `RUSTC_ICE=0 RUST_BACKTRACE=0 RUSTUP_AUTO_INSTALL=0`. The oracle was
`rustc +nightly` (nightly-2026-10-11) and the port `bun src/rust_ts/main.ts`. The ui files got
`--sysroot <oracle sysroot> --target x86_64-unknown-linux-gnu --emit=metadata`, their own edition and their own
compile-flags. In every row the oracle exits 0 and the port exits 70 with the message shown, except `-Zls=root`, where
the oracle exits 101 too.

| argv (beyond the above) | port's stop |
|---|---|
| `-Zinput-stats tests/ui/stats/input-stats.rs` | `rustc_passes::input_stats::print_hir_stats (-Zinput-stats)` (without `--sysroot`: `rustc_session::filesearch::default_sysroot`) |
| `-Zmacro-stats tests/ui/stats/macro-stats.rs` | `rustc_expand::stats (Annotatable::clone for -Zmacro-stats)` |
| `-Zmacro-stats` on a one-line lib | `rustc_interface::passes::print_macro_stats (-Zmacro-stats)` |
| `-Zmeta-stats tests/ui/stats/meta-stats.rs` | `rustc_metadata::rmeta::encoder::encode_crate_root: -Zmeta-stats (rustc_data_structures::thousands::usize_with_underscores)` |
| `--explain E0004` and `--explain E0004 --color=always` | `rustc_driver_impl::handle_explain (--explain E0004)` |
| `-W help` | `rustc_driver_impl::describe_lints (-W help)` (oracle: 288 lines) |
| `--print calling-conventions` | `rustc_abi::all_names (--print calling-conventions)` |
| `--print crate-root-lint-levels -Zunstable-options lib.rs` | `rustc_driver_impl::print_crate_info (--print crate-root-lint-levels)` (oracle: 258 lines) |
| `--print target-spec-json-schema -Zunstable-options` | `rustc_target::spec::json_schema` |
| `--print target-spec-json -Zunstable-options --target riscv64gc-unknown-linux-gnu` | `rustc_target::spec::targets::riscv64gc_unknown_linux_gnu (built-in target …)` |
| `-Zls=root <core rlib>` | `rustc_driver_impl::list_metadata (-Z ls)`; the oracle exits 101 here as well, so pick other inputs |
| `--print cfg --target x86_64-unknown-linux-gnu`, `--print target-list` | match (controls) |

## 8. For root, outside porting

1. **132 skipped minicore cases are a harness change away.**
   - `mir-minicore`, `mir-o0` and `mirdump-minicore` each skip 520 cases (204 files) because the harness does not
     evaluate `needs-llvm-components`. The oracle is the stock nightly, which carries every LLVM component.
   - Of those 520 cases, 132 target only the 6 specs the port has (x86_64-unknown-linux-gnu, aarch64-apple-darwin,
     …); by directory: 29 target-feature, 27 asm, 17 abi, 15 compile-flags, 11 explicit-tail-calls.
   - I did not run them, so their match rate is unknown.
   - The other 388 need other targets' specs plus `asm/*` and `callconv/*` for those architectures (the 613 (a) fns
     above).
2. **D3 and target specs.** As written, plan-m7 D3 picks the targets of the IR and native suites. A
   `--print target-spec-json --target <t>` report suite over all 334 built-in targets would check every
   `spec/targets/*.rs` and `spec/base/*.rs` port byte for byte, with no codegen and no opt/llc. If root reads D3 as
   covering only IR/native execution, the 375 spec fns (~12.6k lines, 4–5 lanes) move from (a) to (c). The 388
   minicore cases would then follow with the `asm/*` and `callconv/*` ports (~11k lines). The brief classifies specs
   as (a), so I did not propose these lanes.
3. **A skip-marker batch.**
   - About 690 fns are out of scope by recorded decisions but carry no `rustc-skip:` marker. A root decision citing
     those decisions would mark them, with no code change.
   - Incremental (PLAN.md §4, plan-m2 D3): rustc_middle 214, rustc_data_structures 58, rustc_query_impl 22,
     codegen_ssa `assert_module_sources` 10, interface callbacks 2.
   - Parallel front end: rustc_data_structures 65, rustc_query_impl 8.
   - Self-profile: rustc_data_structures 51, rustc_query_impl 13.
   - Representation erased (d\*): rustc_data_structures 207, rustc_middle 10, rustc_session 2.
   - `cfg(debug_assertions)`: `hir_id_validator` 16.
   - Platform cfg and native backtraces: rustc_driver_impl 8.
   - Marking them would move coverage from 24,293 to about 24,980 (92.3%) and make the remaining count mean "ported or
     blocked".
4. **Compiletest-argv coverage of tests/ui is narrow.** More than 11k tests/ui files never run with their own
   compile-flags: about 21.5k files, less run-pass (~3.5k) and the compiletest-argv directories (~6.4k). That is why every (c) stop in section 7 is invisible to the gate.
   - A report suite running the check-pass, check-fail and build-fail ui tests with compiletest's argv, stopping
     after analysis like borrowck-ui, would find the next stops by count rather than by guessing.
   - Building that suite is harness work. It is likely the best next scouting tool.
5. `rustc_abi::all_names` is counted as ported (rustc_abi 273/273), yet `--print calling-conventions` stops
   `unported("rustc_abi::all_names …")` in `rustc_driver_impl/lib.ts`. That is a three-line fix; lane 1 takes it.

## Files touched

`docs/handoff/scout-unported.md` only. No code changes, so this lane has no coverage change, no `unported(...)` sites
left and no `// PORT:` decisions.
