# M6 plan — interpreter (const eval + Miri shims), run-pass, proc macros

Source: the plan-m6 planner (design lane; it ports no code). Status: **accepted with amendments A1–A12** (root,
2026-11-01, after the independent review `docs/reviews/plan-m6.md`; the amendments, at the end of §5, take precedence over
the text they amend). Decisions D1–D14 are recorded with `bun scripts/state.ts record decision`.
Pin `6f5da406b56c` (1.101.0-nightly). Paths are relative to the upstream checkout (`compiler/…`, `library/…`,
`src/tools/miri/…`). `src/tools/miri/tests` and `src/tools/miri/cargo-miri` are not in the sparse checkout; they were read
with `git show HEAD:<path>` / exported with `git archive HEAD` into `$RUST_TS_DATA/tmp/plan-m6/miri-tests/`. Line counts are
`wc -l` at the pin. Fn counts are `bun scripts/coverage.ts` on this lane's base (main `db733043`, 22,590 / 25,518 fns).

**How measurements were taken.** macOS arm64, 12 cores, 24 GB, ~13 GB free disk. Oracle `rustc +nightly-2026-10-11`
(`1.101.0-nightly (6f5da406b 2026-10-10)`); the Miri oracle is the **same nightly's `miri` component installed into an
isolated rustup home** (`RUSTUP_HOME=$RUST_TS_DATA/rustup-miri`, `CARGO_HOME=$RUST_TS_DATA/cargo-miri`, `--profile minimal
--component miri,rust-src`, 544 MB) with its sysroot in `$RUST_TS_DATA/miri-sysroot` (D1). Port = `bun src/rust_ts/main.ts`
at `db733043`, run from the upstream checkout or the scratch dir with `RUSTC_ICE=0 RUST_BACKTRACE=0`, under `/usr/bin/time -l`
("user" = user CPU, "rss" = max resident set, "instr" = instructions retired). Load average 4–30 during the runs; user CPU and
instructions are the comparable numbers. Scripts and outputs: `$RUST_TS_DATA/tmp/plan-m6/` (`mirienv.sh` = the isolated Miri
env + `MIRI_DEFAULT_ARGS`, `oracle.sh`, `port.sh`, `runpass-cases.ts` = compiletest argv of run-pass tests via
`harness/compiletest.ts`, `miri-sample.ts` = sampled Miri + native runs, `miri-pass.sh` = one Miri `tests/pass` test,
`ctfe*.rs`/`run*.rs` loop benchmarks, `pm/` proc-macro dylib + `dl.ts` bun:ffi test, `ffi/` TinyCC test, `*.jsonl`/`*.res`
results).

**Correction during this lane (root, 2026-11-01).** This lane first ran `rustup component add miri rust-src` on the
oracle toolchain (`~/.rustup/toolchains/nightly-2026-10-11-…`). With `rust-src` present, rustc's diagnostics that point into
std/core print local paths and snippets, so fresh oracle output stopped matching the oracle cache and the baselines (another
lane saw 7/300 `mir` DIFFs). Root removed both components; the oracle's component set is back to cargo, llvm-tools, rust-std
(aarch64-apple-darwin, x86_64-unknown-linux-gnu), rustc, rustc-dev. Every measurement below was **re-taken** after the
removal: Miri runs with the isolated toolchain and a sysroot rebuilt from its own rust-src, oracle-rustc runs against the
clean oracle. The re-takes reproduced the first numbers (300/300 run-pass samples with the same exit code and stdout hash,
identical tests/pass outcome counts, identical MIR / rmeta comparisons). The isolation is part of D1.

## 1. What "runs" means at the pin

### 1a. Upstream's whole-program interpreter

Upstream runs programs without codegen only in Miri: `src/tools/miri/src` (56,307 lines, ~1,833 fns), a rustc driver
(`bin/miri.rs`: `MiriCompilerCalls::after_analysis` :138 → `miri::eval_entry` (eval.rs)) whose `MiriMachine` (machine.rs,
2,205 lines) implements rustc_const_eval's `Machine` for `InterpCx`, plus shims for the target's libc / syscalls / intrinsics.
Facts at the pin that shape the plan:
- `MIRI_DEFAULT_ARGS` (lib.rs:187): `--cfg=miri -Zalways-encode-mir -Zextra-const-ub-checks -Zmir-preserve-ub
  -Zmir-opt-level=0 -Zmir-enable-passes=-CheckAlignment,-CheckNull,-CheckEnums -Zmir-enable-passes=-ReferencePropagation,-GVN
  -Zdeduplicate-diagnostics=no`. Retags are implicit (the `retag_ptr_value` machine hook, machine.rs:1836); there is no
  `-Zmir-emit-retag` any more.
- The sysroot is built by `cargo miri setup` (cargo-miri/src/setup.rs): cargo over the toolchain's `rust-src` `library/`
  with cargo-miri as `RUSTC` (`MIRI_BE_RUSTC=target` → `MiriDepCompilerCalls`, bin/miri.rs:279: dummy codegen backend, rlibs
  with `-Z embed-metadata=no`, `exported_non_generic_symbols` / `reachable_non_generics` overridden, and
  `collect_and_partition_mono_items` for post-mono errors :333), `std_features = ["panic-unwind", "backtrace"]`, rustflags
  `-Cdebug-assertions=off -Coverflow-checks=on`. Measured argv for core: `--edition=2024 --crate-type lib
  --emit=dep-info,metadata,link -Z embed-metadata=no -C opt-level=3 … --target x86_64-unknown-linux-gnu
  -Zforce-unstable-if-unmarked -Cdebug-assertions=off -Coverflow-checks=on` (`setup-v.log`, 37 rustc runs).
- Randomness is seeded: `StdRng::seed_from_u64(config.seed.unwrap_or(0))` (machine.rs:721). It drives base addresses
  (alloc_addresses), the scheduler, weak memory, `getrandom` shims (so `HashMap` seeds), all deterministic.
- Isolation is on by default: host fs/env/time/process calls fail with a fixed "unsupported operation … isolation" error.
- Extra symbols (sym.rs: 3) go past `PREDEFINED_SYMBOLS_COUNT`, so they are encoded as strings (rustc_span symbol.rs:3108);
  Miri-built rmetas decode in a plain rustc (measured: the port decodes them, 1b).
- Miri's crates.io deps: the rustup component is built from the root workspace (`Cargo.toml` members include
  `src/tools/miri`), so the versions are the root `Cargo.lock`'s: rand 0.10.1, rand_core 0.10.1, chacha20 0.10.0,
  smallvec 1.15.1, chrono 0.4.42, aes 0.9.0 (miri's own `Cargo.lock`, rand 0.10.3 etc., is for standalone builds).

### 1b. Oracle measurements

| command | result | user / wall | rss | instr |
|---|---|---|---|---|
| `cargo miri setup --target x86_64-unknown-linux-gnu` (isolated toolchain) | 27 rmetas, 112 MB; core rmeta 69.3 MB (with optimized MIR of every fn), std 8.7 MB, proc_macro 1.7 MB; rlibs 1,476 B (`lib.rmeta` stub + `lib.rmeta-link`) | 11.6 s / 15.0 s | 1.28 GB | |
| `miri --sysroot <miri-sysroot> --target x86_64-unknown-linux-gnu hello.rs` (×2) | `Hello, world!`, empty stderr, exit 0 | 0.02 s / 0.03 s | 107 MB | 363–445 M |
| same, `-Zmiri-report-progress=10` | **2,620 basic blocks** executed for std's startup + `println!` + shutdown | | | |
| same, `MIRI_LOG=info` (release Miri logs at info) | 22,954 lines: 17,554 `interpret::step` statements/terminators, 1,052 frames, 1,829 `miri::machine`, 1,466 retags | | | |
| Miri, loop of 20k / 200k iterations (`run*.rs`) | 0.14 / 1.20 s user → 5.9 µs per iteration; with `-Zmiri-disable-stacked-borrows -Zmiri-disable-data-race-detector -Zmiri-disable-validation` 3.8 µs | | | |
| oracle CTFE, same loop in a `const` (`ctfe*.rs`, `--emit=metadata`) | 0.06 / 0.54 s user → 2.7 µs per iteration | | | 1.15 / 9.20 G |

Shims hello world reaches (from the trace, x86_64-linux, `cfg(miri)` std): `poll` (sanitize_standard_fds), `signal`
(SIGPIPE), `write` (stdout), the uncontended futex mutex/once paths (atomics only), TLS dtors and `exit`; std's
`stack_overflow::handler_none` is chosen under `cfg(miri)`. Plus drop-glue / `FnOnce` shims (rustc_mir_transform shim.rs,
ported).

### 1c. Options for the M6 oracle

| | A. Miri (pinned nightly's component, isolated) | B. native: oracle compiles, binary runs | C. both |
|---|---|---|---|
| target | x86_64-unknown-linux-gnu on any host (Miri emulates Linux) — the target every M2–M5 suite uses | host only (aarch64-apple-darwin here; x86_64-linux needs a Linux VM, and there is no linker for it) | |
| determinism | seeded RNG, isolation: addresses, `HashMap` order, threads, errors all fixed | ASLR, timings, `HashMap` seeds from the OS | |
| what the port must be | a port of upstream's Miri (exists, ~37k lines on this target) | an interpreter with *some* shims: either Miri anyway (for macOS) or invented shims (a redesign, forbidden) | |
| failures | UB / unsupported operations are byte-exact diagnostics (a test oracle for the interpreter itself) | crashes / UB are nondeterministic | |
| std MIR | Miri sysroot (`-Zalways-encode-mir`, mir-opt-level 0); M5 already makes the port's std rmeta byte-identical | stock std is built at mir-opt-level ≥ 2 with debug assertions off; non-generic fns have no MIR | |
| cost | 0.02–0.26 s per run-pass case (below); sysroot 12 s once | build + run per case; host std must be re-verified (M5 checked only x86_64-linux) | |

Measured on a deterministic sample of 300 run-pass cases (compiletest argv, §4): Miri exit 0 on 281, exit 1 on 14 (8 FFI to
`rust_test_helpers`, 3 isolation (`open`/`getcwd`/`readlink`), 2 unsupported extern statics, 1 inline asm, 1 no `main`, 1 UB
`stdout-before-main`), exit 101 on 5 (pointer-equality tests). Natively 277 agree with Miri on exit and stdout; 4 exit-0 cases
differ on stdout because native prints real addresses / test-harness timings (`cast-region-to-uint`, `match-string-slice`,
`test-attrs/issue-34932`, `lint/test-allow-dead-extern-static…`), 10 do not build natively (no test helpers).

**Recommendation: A** (D1). Miri is upstream's own interpreter, so porting it is porting, not designing; it is the only
deterministic, cross-target oracle; its failure output is itself a fidelity test. Native output is rejected as an oracle
(nondeterministic, host-only) and not even kept as a report.

## 2. Where rust-ts stands (main `db733043`)

| command (port; oracle side for comparison) | result |
|---|---|
| hello.rs `-Zunpretty=mir` with `MIRI_DEFAULT_ARGS`, `--sysroot <miri-sysroot>` | **byte-identical** to the oracle (864 B); 0.92 s user, 392 MB. The port decodes the Miri sysroot's rmetas (incl. the extra-symbol strings) |
| hello.rs `--emit=metadata` (bin) | exit 0, no stderr, 0.78 s user |
| hello.rs default emit (link) | exit 70 `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (codegen; M7)` |
| `ctfe20000.rs` / `ctfe200000.rs` `--emit=metadata` (lib) | rmeta **byte-identical**; 2.17 / 7.33 s user vs oracle 0.06 / 0.54 → **28.7 µs vs 2.7 µs per CTFE iteration (10.8× user, 11.8× instructions)** |
| crate using an oracle-built proc-macro dylib, `-Zunpretty=expanded` | the port finds the dylib and reads its metadata, then exit 70 `rustc_metadata::host_dylib::dlsym_proc_macros (proc-macro dylibs, M6)` |
| startup (empty work) | ≈ 0.6–0.8 s user |

Coverage of the M6 path (`bun scripts/coverage.ts --crate/--missing`):

| area | fns ported | notes |
|---|---|---|
| rustc_const_eval (interpret, const_eval, check_consts, util) | 764 / 764 | the `Machine` trait is the TS interface `Machine`; its associated types are **erased to the CTFE machines'** (`Provenance = CtfeProvenance`, `FrameExtra`/`AllocExtra` = `()`, `ExtraFnVal = !`, `Bytes = Uint8Array`, interpret/machine.ts header); 44 files name these types. `provenance_of(prov)` already dispatches on the representation (pointer.ts:126) |
| rustc_middle mir/interpret/* | all | `u64`/`i64`/`u128` interpreter values are bigints; `Size` a number with an exact form ≥ 2^53 |
| rustc_mir_transform (incl. shim.rs drop glue / fn-ptr shims) | 1,101 / 1,101 | |
| rustc_ty_utils (instance resolution, abi) | 123 / 123 | |
| rustc_metadata | 448 / 453 | host_dylib.rs 1/6 (`format_dlopen_err`, `attempt_load_dylib`, `load_dylib`, `load_symbol_from_dylib`, `dlsym_proc_macros`) |
| rustc_expand proc_macro.rs / proc_macro_server.rs | 6/6, 50/50 | the server is ported; running a client stops in `src/proc_macro/bridge/server.ts` (`run1`/`run2` unported, decision 2026-10-13) |
| library/proc_macro (5,069 lines) | `src/proc_macro/` 433 TS lines: types the server names, `Client` shell, `PanicMessage`, `ExecutionStrategy` | bridge rpc/buffer/handle/symbol/client/server, lib.rs API, quote.rs: unported |
| rustc_monomorphize | 0 / 153 | collector.rs 1,964 lines, partitioning.rs 1,396, mono_checks 0.55k, graph_checks 0.13k, offload 0.49k |
| rustc_middle mono.rs | 8 / 41 | `CodegenUnit` / `MonoItem` methods |
| rustc_codegen_ssa | 111 / 1,091 | not on the Miri run path. For a port-built Miri sysroot: back/link.rs `link_rlib` (:545), back/archive.rs 0/22 (uses vendor `ar_archive_writer`), back/rmeta_link.rs 0/8; mono_item.rs 0/6 is codegen (M7) |
| rustc_driver_impl / rustc_interface | 56/77, 54/90 | `Callbacks::after_analysis`, `override_queries`, `extra_symbols`, `make_codegen_backend` exist; missing fns are help/ICE/explain/backend-dylib paths |
| **Miri** (`src/tools/miri/src`) | not counted by coverage.ts; 0 ported | §5 inventory |

So the compiler half of the interpreter is done; M6 is **porting Miri** (plus the proc_macro library and a dylib loader),
generalising the interpreter's erased machine types, and the harness for running programs.

## 3. Proc macros

What the gate needs at the pin:
- **User proc macros.** rustc loads a proc-macro crate's dylib (`creader` → `host_dylib::dlsym_proc_macros`,
  host_dylib.rs:126), reads `__rustc_proc_macro_decls_<stable_crate_id:08x>__` (rustc_session session.rs:1535) as
  `*const &[Client]`, where `Client` is `#[repr(C)] { run: extern "C" fn(BridgeConfig) -> Buffer }`
  (library/proc_macro/src/bridge/client.rs:221); `BridgeConfig` (bridge/mod.rs:120), `Buffer` (buffer.rs:8: data, len,
  capacity, `reserve`, `drop` fn pointers) and `Closure` (closure.rs:8: `call`, `env`) are all `#[repr(C)]`. Macro names and
  kinds come from the crate's metadata, not the dylib. The server (rustc_expand proc_macro_server.rs, ported) answers the
  client's RPCs over `Buffer`s encoded by bridge/rpc.rs; `exec_strategy` (proc_macro.rs:16) is same-thread unless
  `-Zproc-macro-execution-strategy=cross-thread`.
- **`quote!`.** A builtin `BangProcMacro` whose client is `Client::expand1(rustc_proc_macro::quote)`: library/proc_macro's
  *client* half (lib.rs API + quote.rs) compiled into rustc and run in-process through the same bridge. Measured: 30 cases are
  UNPORTED at `BangProcMacro::expand (quote!; …)` in each of 11 protected suites (325 case-instances; the largest UNPORTED
  reason in the last gate).
- **Case count.** 272 tests/ui files use a proc-macro aux crate (197 in tests/ui/proc-macro; by mode: 115 error/stderr,
  106 check-pass, 50 run-pass, 1 build-pass); 180 distinct aux sources. The oracle builds a proc-macro aux as a host dylib in
  ~0.08 s (38/40 sampled built; 2 need their own directives). Today the compiletest-aware suites skip them (plan-m2 D6).

Measured feasibility (`pm/`, `ffi/`): an oracle-built `--crate-type proc-macro` dylib (aarch64-apple-darwin, 478 KB) opens
with `bun:ffi` `dlopen` and its decls symbol resolves; `bun:ffi`'s `cc` (embedded TinyCC, Bun 1.4.3) compiles and runs C
with struct-by-value returns. Bun's FFI itself has no struct-by-value arguments, so the `extern "C" fn(BridgeConfig) ->
Buffer` call and the `Closure.call` / `Buffer.reserve` / `Buffer.drop` callbacks need a small C trampoline (compiled by
`cc` at load) that converts them to pointer-argument calls into `JSCallback`s.

| | dylib loading (recommended, D7) | interpreting the proc macro (PLAN.md §4 as written) |
|---|---|---|
| upstream analogue | exactly rustc's path (host_dylib.rs, creader, bridge server) | none: Miri cannot run proc macros either; it would be a rust-ts design |
| client code | the oracle's own compiled libproc_macro inside the dylib | the port interprets libproc_macro's MIR from the Miri sysroot plus the aux crate's MIR, which the port would have to compile and keep (proc-macro crates do not encode MIR) |
| server ↔ client | real `Buffer` bytes: the TS rpc encoding must match the oracle client's byte for byte (a strong check) | a new Machine shim for the `extern "C"` dispatch pointer |
| cost | native speed; FFI marshalling per RPC | interpreter speed (10× CTFE today) × every token-tree RPC |
| later | the same loader runs proc macros the port builds at M7 | redundant at M7 |
| new non-ported code | `src/rust_ts/` FFI edge: the C trampoline + `dlopen` wrapper (~150 lines) | an interpreter shim layer (~1k?) |

## 4. Suites and gates

Harness work (one reviewed `harness-m6*` batch each):
1. **Isolated Miri oracle** (D1): a setup script installs `nightly-2026-10-11` into `$RUST_TS_DATA/rustup-miri` (`--profile
   minimal --component miri,rust-src`) and runs `cargo miri setup --target x86_64-unknown-linux-gnu` with
   `MIRI_SYSROOT=$RUST_TS_DATA/miri-sysroot`. Every Miri process gets `RUSTUP_HOME`/`CARGO_HOME` set to the isolated homes;
   nothing ever runs `rustup component add/remove` or `toolchain install` without them. The oracle cache key adds the
   `miri` binary hash and a hash of the sysroot's rmetas (as `rustcDriverHash()` does for rustc). A guard test asserts the
   oracle toolchain has no `rust-src`/`miri` component.
2. **A run mode for cases**: the subject is `bun src/miri/bin/miri.ts` (the port of bin/miri.rs) with the oracle's argv;
   compare stdout + stderr + exit. Miri's stderr carries absolute sysroot paths in backtraces/diagnostics into std: both sides
   use the same sysroot path, and compiletest's `-Zui-testing` / remap flags stay in the argv.
3. **Aux chains**: run-pass aux crates (non-proc-macro: 333 run-pass files) are built by the isolated Miri as
   `MIRI_BE_RUSTC=target` rlibs (they must carry MIR); proc-macro aux crates are built by the oracle rustc as host dylibs
   (`--crate-type proc-macro`, no `--target`, compiletest's `force-host` shape).
4. **Sparse checkout** gains `src/tools/miri/tests` (and `tests/utils`); coverage.ts learns `src/tools/miri/src` as crate
   `miri` (scripts batch, D2).

Proposed suites (all `milestone: "M6"`):

| suite | mode | cases (measured) | oracle cost | role |
|---|---|---|---|---|
| `miri-hello` | single | 1: `fn main() { println!("Hello, world!"); }` with Miri's argv | 0.02 s | **gate M6a** ("std hello world runs") |
| `run-pass-miri` | single | 3,256 run-pass cases with no aux (3,770 files; 396 skipped for aux, 247 `needs-*`, 37 `only-*`, 6 LLVM, 3 ignored) | p50 0.02 s, p99 0.25 s, max 0.26 s user; ≈ 2 min CPU for all | **gate M6b**; oracle outcomes measured 93.7% exit 0 |
| `run-fail-miri` | single | 238 run-fail / run-crash cases (292 files, 54 skipped) | similar | gate M6b (same rule) |
| `run-pass-aux-miri` | single + Miri-built aux | 333 run-pass files with non-proc-macro aux (cases not yet expanded) | + aux builds | report → gate later |
| `miri-pass` | single | Miri's own tests/pass + tests/panic: 389 tests (base revision; revisions add more) with ui.rs's flags (`--edition 2021 -Dwarnings -Dunused -Ainternal_features -Zui-testing` + `//@compile-flags`) | measured: 362 exit 0, 14 exit 101, 13 exit 1 (aarch64/loongarch-only shims, cfg_select, a lint); 64.8 s total, max 7.0 s (`shims/fs.rs`), weak memory 5.4 s | gate M6b (≥ 80%) |
| `miri-fail` | single | tests/fail 550 (UB diagnostics: stacked/tree borrows, data races, validity, alignment) | similar | report (the borrow trackers' fidelity) |
| `pm-ui` | single + oracle dylib aux | the 272 proc-macro tests with compiletest argv, `--emit=metadata` (stderr + exit), like check-ui | aux 0.08 s each | **gate M6 (proc macros)** |
| `pm-expanded` | single | the same 272 with `-Zunpretty=expanded` | | progress for pm-ui |
| (existing suites) | | the 30 `quote!` cases in each of the 11 suites | | gate M6: no `BangProcMacro::expand` UNPORTED left |
| `miri-sysroot-core/alloc/std` | single (heavy) | the port as `MIRI_BE_RUSTC=target` builds core/alloc/std with cargo-miri's argv; rmeta bytes vs the Miri sysroot's | 12 s for all 27 crates | report (D4) |

Gates:
- **M6a**: `miri-hello` MATCH, no protected loss.
- **M6b**: `run-pass-miri` + `run-pass-miri-heavy` ≥ 90% MATCH, `run-fail-miri` ≥ 90% MATCH, `miri-pass` + `miri-pass-heavy` ≥ 80% MATCH (A12: `bun scripts/criteria.ts --run <gate run>`).
- **M6 (= gate)**: M6a + M6b + `pm-ui` ≥ 95% MATCH + the 30 `quote!` cases MATCH in every suite that has them.
- Report only: `miri-fail`, `run-pass-aux-miri`, `miri-sysroot-*`, `pm-expanded`.

Debug tool (not a suite, D10): `MIRI_LOG=info` traces on both sides; a `scripts/miri-diff.ts <case>` prints the first
differing trace line (statement / frame / retag), the interpreter's analogue of `phase-diff`.

## 5. Decisions and waves

**D1. The M6 oracle is the pinned nightly's Miri in an isolated toolchain, target x86_64-unknown-linux-gnu.** Installed
into `RUSTUP_HOME=$RUST_TS_DATA/rustup-miri` / `CARGO_HOME=$RUST_TS_DATA/cargo-miri` with `--profile minimal --component
miri,rust-src` (544 MB); sysroot from `cargo miri setup` into `$RUST_TS_DATA/miri-sysroot` (112 MB). The oracle toolchain
in `~/.rustup` is never modified: adding `rust-src` to it changed rustc's diagnostics and broke the cache and baselines
(correction above). Native execution is rejected (1c).

**D2. Miri is ported like a compiler crate.** `src/tools/miri/src/<path>.rs` → `src/miri/<path>.ts`; markers
`// rustc: src/tools/miri/src/<path>:<line> <name>`; coverage.ts counts it as crate `miri`; `scope.json` excludes, as
`unported(...)` stops: `concurrency/genmc` (2,097), `shims/native_lib` (1,583), `shims/windows` (3,184), other-OS unix shims
(macos/freebsd/solarish/android/netbsd, 1,628), sockets (3,807), `bin/log/tracing_chrome.rs`. Miri's `impl EvalContextExt for
MiriInterpCx` extension traits become `declare module` augmentations of `InterpCx` (the PORTING §5 "methods defined in another
file" pattern), loaded by `src/miri/lib.ts`. Miri's types come from tools/codegen (a `miri` typedefs set).

**D3. Generalise the interpreter's erased machine types, contract-first (✱interp-generic).** `Machine` associated types
(`Provenance`, `ProvenanceExtra`, `ExtraFnVal`, `MemoryKind`, `MemoryMap`, `AllocExtra`, `FrameExtra`, `Bytes`) become type
parameters (or machine-typed fields) of `Frame`, `Allocation`, `MPlaceTy`, `InterpCx`, … with the CTFE types as defaults;
`provenance_of` learns Miri's `Provenance` (`Concrete { alloc_id, tag }` / `Wildcard`). Typing and dispatch only, no logic
change; proof: tsc + every CTFE-bearing suite (mir, mir-core/alloc/std, rmeta-*) unchanged.

**D4. M6 interprets the oracle-built Miri sysroot; a port-built sysroot is a report.** Measured: the port already decodes
it and matches Miri-flag MIR (§2). Interpreter divergences stay separate from encoder divergences. The port-built sysroot
(`MiriDepCompilerCalls`, `-Zalways-encode-mir` at mir-opt-level 0, rlib stub via `link_rlib` + archive + rmeta_link, and the
mono collector for post-mono errors) is `miri-sysroot-*` (report). The collector lanes still land in M6 because M7 needs
them (`refine_rpitit` already stops at mono items).

**D5. Vendor rand 0.10.1 + rand_core 0.10.1 + chacha20 0.10.0 (root `Cargo.lock`, the versions the component is built
with), the StdRng (ChaCha12) path only**, with an oracle probe printing `StdRng::seed_from_u64(0)` streams and the
`random_range`/`random_bool` draws Miri makes. smallvec → arrays; bitflags via the existing codegen; chrono/chrono-tz (only
`localtime_r`), aes (AES-NI shims), getrandom/mio/socket2/directories (isolation-off host access) are `unported(...)` in M6.
(`bun scripts/crate-src.ts chacha20 --version 0.10.0` failed offline in this lane; fetch once online.)

**D6. Run-pass argv = compiletest's run-pass argv with the Miri sysroot.** Keep `-O`, `-Zui-testing` and the remap flags
(Miri then prints its fixed "Miri does not support optimizations" warning on both sides), drop `-o`, `--target
x86_64-unknown-linux-gnu`, `--sysroot <miri-sysroot>`; `run-flags` become program args, `exec-env` becomes
`-Zmiri-env-set=K=V` (20 cases). Every oracle outcome is a case (exit 1 "unsupported operation" and UB reports included).
`check-run-results` blessed files are not used: the oracle is Miri's output.

**D7. Proc macros load oracle-built host dylibs (amends PLAN.md §4 "interpreted, no dylib loading").** Port host_dylib.rs
with a `src/rust_ts/proc_macro_host.ts` FFI edge (`bun:ffi` `dlopen` + a TinyCC C trampoline for the `#[repr(C)]`
`BridgeConfig`/`Buffer`/`Closure` calls); the server side is the ported bridge + proc_macro_server.rs. Reasons in §3.
Interpreting proc macros is rejected (no upstream analogue, redundant from M7).

**D8. Port all of library/proc_macro to `src/proc_macro/`** (5,069 lines; `// std:` markers as decided 2026-10-13): the
bridge (both halves, rpc byte format exact) for D7, and the client API + quote.rs for `quote!`, which runs as a TS `Client`
in the same thread (`Client.run` is a TS function for builtin clients and the trampoline for dylib clients).

**D9. Stacked Borrows, the data-race detector, weak memory and validation are on (Miri's defaults) in every gated suite.**
They do not change a passing program's output, but they run on every retag and atomic access (the hello-world trace has
1,466 retags), and `miri-fail` needs them. Tree Borrows (5,486 lines) lands after the gate; its 23+ `-Zmiri-tree-borrows`
tests in `miri-pass` wait for it.

**D10. Port the interpreter's `info!` / `trace!` events behind `MIRI_LOG`** (rustc_const_eval interpret + Miri; today they
are comments, src/rust_ts/tracing.ts) so `MIRI_LOG=info` traces are byte-comparable with the release oracle's (22,954 lines
for hello world), and add `scripts/miri-diff.ts`. Never a gate; disabled by default (the filter check is the only cost).

**D11. Performance targets.** Today the port's CTFE is 10.8× the oracle's per step and startup is ~0.7 s. Targets: hello
world ≤ 3 s user; `run-pass-miri` p99 ≤ 10 s, all cases within the 60 s timeout except a recorded list (Miri's weak-memory
and `shims/fs.rs` tests, 5–7 s on the oracle, go to the heavy class if they exceed it). Profiling targets: the step loop
(`eval_statement`/`eval_rvalue_into_place`), bigint `Scalar` arithmetic, layout queries, Stacked Borrows stacks, MIR
decoding from the 69 MB core rmeta. Representation changes need a recorded decision (plan-m5 D10 rule).

**D12. x86_64 SIMD/arch intrinsics (intrinsics/x86, ~4.0k) are a separate late wave**; aarch64/loongarch intrinsics are
not reachable on the target (`unported`).

**D13. Miri's own tests are a case source** (`miri-pass` gate share, `miri-fail` report); `pass-dep`/`fail-dep` (need
crates.io deps), `genmc`, `native-lib` and `many-seeds` are out of M6.

**D14. Fidelity rules specific to Miri.** Host-dependent Miri code (`MIRI_CWD`, `current_exe`, host time, `getrandom` with
isolation off) goes through `src/std` stand-ins with `// PORT:`; isolation-on paths must be byte-exact. The port runs with the
same argv and cwd as the oracle, so file names in diagnostics match.

### Waves (lanes ≤ ~3k upstream lines; ✱ = contract-first, merges before its dependants)

Inventory (x86_64-linux scope, lines): Miri core (lib, machine, eval, helpers, diagnostics, operator, math, clock,
provenance_gc, sym) 6,480; bin/miri.rs 743; alloc + alloc_addresses 1,359; data_structures 732; borrow_tracker/mod 534;
stacked_borrows 2,047; concurrency (excl. genmc) 6,059; intrinsics generic 691; shims generic 6,226; shims/unix generic 4,351
(fs.rs 2,404 separate); linux + linux_like 1,482 — **≈ 33.1k**, plus x86 intrinsics ≈ 4.0k and tree borrows 5.5k. Outside
Miri: library/proc_macro 5,069 (433 TS lines exist), host_dylib.rs 147, vendor rand/rand_core/chacha20 subset ≈ 2.5k,
rustc_monomorphize ≈ 4.2k + mono.rs 0.7k, codegen_ssa archive/rmeta_link/link_rlib ≈ 1.2k (+ vendor `ar_archive_writer`).

**Wave 35: contracts and harness (parallel)**
- ✱`interp-generic`: D3 (rustc_const_eval interpret typing, pointer.ts `provenance_of`); no logic change.
- ✱`miri-contract`: D2 skeleton: `miri` typedefs codegen set, `MiriMachine` / `Provenance` / `BorTag` / `MiriMemoryKind` /
  `AllocExtra` / `FrameExtra` types, the `EvalContextExt` augmentation layout, lib.rs + sym.rs (`EXTRA_SYMBOLS`), stubs
  per fill lane.
- `harness-m6a` (harness batch): D1 isolated toolchain + sysroot setup + guard test, Miri oracle cache key, run-mode
  compare, `miri-hello`, `run-pass-miri`, `run-fail-miri` (unprotected); coverage.ts `miri` crate; sparse `src/tools/miri/tests`.
- `vendor-rand`: D5 + probe (~2.5k).
- `pm-bridge`: library/proc_macro bridge/* (mod, buffer, rpc, handle, symbol, fxhash, closure, selfless_reify, arena,
  panic_message, client, server; ~2.1k).
- `pm-lib`: library/proc_macro lib.rs, diagnostic, escape, to_tokens, quote.rs (~2.9k). Target: the 30 `quote!` cases.

**Wave 36: Miri core**
- `miri-machine`: machine.rs (2,205).
- `miri-eval`: eval.rs, helpers.rs, operator.rs, math.rs, clock.rs (~2.8k).
- `miri-driver`: bin/miri.rs, diagnostics.rs, provenance_gc.rs, data_structures/* (~2.7k); bin/log/setup.rs with D10.
- `miri-alloc`: alloc/*, alloc_addresses/*, borrow_tracker/mod.rs (~1.9k).
- `miri-sb`: stacked_borrows/* + concurrency/weak_memory.rs (~2.7k).
- `miri-threads`: concurrency thread, scheduler, sync, init_once, blocking_io, mod (~2.7k).
- `miri-race`: data_race, data_race_handler, vector_clock (~2.7k).
- `pm-host`: D7 (host_dylib.rs, the FFI edge, creader wiring) + `harness-m6b` (proc-macro dylib aux, `pm-ui`, `pm-expanded`).

**Wave 37: shims (→ gate M6a)**
- `miri-shims-a`: shims foreign_items, alloc, env, extern_static, global_ctor, mod, panic, unwind, tls, os_str (~2.8k).
- `miri-shims-b`: shims files, io_error, time, math, backtrace, cpu_affinity, sig (~2.85k).
- `miri-shims-c`: shims readiness, unix/foreign_items, unix/env, unix/mod, unix/thread, unix/mem (~2.9k).
- `miri-shims-d`: unix/fd, unix/poll, linux/*, intrinsics/{mod, math, simd} (~2.1k).
- `miri-shims-e`: unix/sync, linux_like/* (~2.1k).
- `miri-fs`: unix/fs.rs (2,404; its isolation errors are on the run-pass path).
- Fixer lanes from `miri-hello` / `run-pass-miri` first differences (`miri-diff`), perf lane per D11.

**Wave 38: run-pass tail and M7 groundwork (→ gate M6)**
- `miri-x86-a` / `miri-x86-b`: intrinsics/x86/* (~4.0k).
- `miri-tb-a` / `miri-tb-b`: tree_borrows/* (~5.5k incl. its unit tests).
- `mono-collector`: rustc_monomorphize lib, util, collector, mono_checks (~2.6k); `mono-partition`: partitioning,
  graph_checks, rustc_middle mono.rs (~2.3k).
- `miri-sysroot`: MiriDepCompilerCalls path, codegen_ssa link_rlib + archive + rmeta_link + vendor `ar_archive_writer`;
  `miri-sysroot-*` report suites (harness batch).
- `harness-m6c`: `run-pass-aux-miri` (Miri-built aux rlibs), `miri-pass`, `miri-fail`.
- Fixer and perf lanes.

About 4 waves and ~30 lanes of porting, plus fixers. The open-ended part is the shim / fixer tail on 3.5k run-pass cases and
interpreter speed.

### Amendments (root, 2026-11-01; from docs/reviews/plan-m6.md)

- **A1 (D3, review B1).** `interp-generic` is not "typing only". The port hard-codes CTFE's `OFFSET_IS_ADDR = false` and
  dropped upstream's branches for `true` (intrinsics.ts:598, place.ts, memory.ts, validity.ts, pointer.ts:131,
  allocation.ts); Miri's provenance needs them. The lane re-ports those branches from upstream (reviewed against upstream,
  not only by unchanged suites) while the protected mir / const-eval suites stay byte-identical. Still contract-first.
- **A2 (waves, review B2; AGENTS.md §2).** No lane mixes porting with harness/scripts work: `pm-host` (port) and
  `harness-m6b` (harness batch) are separate lanes; `miri-sysroot` (port) and `harness-m6d` (the `miri-sysroot-*` report
  suites) are separate; D10's `scripts/miri-diff.ts` is its own harness lane `miri-diff`, apart from `miri-driver`.
- **A3 (D2).** Sockets are not excluded wholesale: the isolation-error paths of shims/unix/socket.rs (socket.rs:172) that
  run-pass cases reach are ported (in `miri-shims-d`); the rest of socket.rs stays unported.
- **A4 (D7).** Accepted: proc macros load oracle-built host dylibs (rustc's own path). PLAN.md §4 is amended accordingly.
  M9 consequence: rust-ts must eventually build host proc-macro dylibs itself (M7 output), so Ouroboros does not depend
  on the oracle. Before `pm-host` starts, check that Bun's FFI (dlopen + TinyCC callbacks) works on the Windows host.
- **A5 (D9).** Gated suites run Miri's defaults (Stacked Borrows). Tree Borrows lanes may land in wave 38, but no gate
  depends on them; TB cases are a report suite until after M6.
- **A6 (D10).** Port only the `info!`-level events (the release oracle compiles `debug!`/`trace!` out); `miri-diff`
  compares normalised event lines, not raw indentation. Separate lanes: `miri-log` (port) and `miri-diff` (harness).
- **A7 (D11).** The heavy-case list comes from the full run-pass oracle timing, not the 300 sample: 2 cases hit the 60 s
  ORACLE_TIMEOUT and 4 more take 5–19 s on the oracle. `harness-m6a` measures and records it.
- **A8 (D13).** `miri-pass` / `miri-fail` cases expand `//@revisions` and honour `only-target` / `ignore-target` (109 of
  389 files use them); `harness-m6c` defines them before any threshold applies.
- **A9 (thresholds and the ratchet).** The protected sets only grow, as always: every MATCH accepted by a gate is protected.
  The ≥ 90% / ≥ 80% / ≥ 95% figures are milestone-completion criteria over each suite's cases, with ORACLE_TIMEOUT cases
  out of the denominator; 90% for run-pass is set against the oracle exiting 0 on 94.0% of cases.
- **A10 (scope).** Miri does not cover what M7 must: `-O` codegen, FFI, inline asm, the real unwinder, linking.
- **A11 (cost).** The Miri oracle output contains absolute local paths, so its cache is bound to this machine (rebuild it on
  another host). Each protected Miri suite adds to every gate's ~10 h: the harness lanes mark the large ones heavy/serial
  and keep slow cases out of the per-batch path.

- **A12 (M6b, review harness-m6c R1, R2, re-check L1, L2).** M6b is one figure per group, summed by `scripts/criteria.ts`
  from one gate's `gate.json`; a suite's own `criterion` line is only its share. A group is met only if that gate passed on
  a clean tree and ran every suite of the group. `run-fail-miri` is its own group, so run-pass cannot hide it.
  The heavy lists hold cases by the oracle's cost and by the files they write, never by how the port does: a longer limit
  must not turn a port TIMEOUT into a MATCH.
  **Amendment (harness-m7a; root decision on `docs/reviews/fixers-39.md` item 6).** A third reason, a property of the
  program: an isolation-off case whose source asserts an upper bound on the real clock. Today that is
  `tests/pass/shims/time.rs` only. Its outcome depends on host load, not on any limit (margin 6.4x quiet, 1.5x in a 12-job
  pool), and difftest does not retry a DIFF, so a loaded gate could lose it as a protected case. This goes against the
  sentence's words, since the bound is at risk only because the port is slow, but not its purpose: the limit plays no part
  (a 2.3 s run never nears 60 s), and the program's own 1,000 ms bound stays, so a port that became 7x slower would still
  fail in the heavy class. It removes contention, as the file-writing reason does. Never add a case because it was seen to
  fail; `sync.rs#stack` (5.4x at the worst load measured) stays in `miri-pass`.

## 6. Risks

- **Oracle integrity (realised once in this lane).** Any change to the oracle toolchain's components changes rustc output
  (rust-src → std snippets in diagnostics). Mitigation: D1 isolation, a guard test on the oracle's component list, Miri
  binaries called by absolute path from the isolated home.
- **Performance.** Port CTFE is 10.8× the oracle per step; Miri's runtime adds SB / data-race work (5.9 µs vs CTFE 2.7 µs per
  loop iteration on the oracle), so a TS Miri may be 10–30× Miri. Hello world (2,620 blocks) is cheap; run-pass p99 0.25 s →
  ~3–8 s; Miri's heaviest tests (5–7 s) → minutes. Startup (~0.7 s) dominates most cases; bundling (queued since wave 13)
  helps. Decoding MIR from a 69 MB core rmeta is lazy per body but untested at this scale.
- **Interpreter generalisation (D3)** touches the type layer of 44 files that M4/M5 protect; done wrongly it shifts CTFE
  behaviour. Contract-first, typing-only, full suites before merge.
- **Exactness of Miri diagnostics.** UB / unsupported errors print spans, backtraces into std (sysroot paths) and
  `help:`/`note:` text; the run-pass suite includes 14/300 such cases. The span machinery is ported, but backtrace frames
  through std need std source positions from the rmeta.
- **RNG exactness.** Any divergence in rand/chacha20 or in the order of RNG draws changes addresses, scheduling and
  `HashMap` order in program output. Mitigation: D5 probe; trace diff (D10).
- **bigint cost.** `u64` scalar values as bigints in the step loop are a likely hot spot (D11); changing that is a
  representation decision.
- **FFI edge (D7).** bun:ffi + TinyCC must exist on every host (macOS arm64 here; Windows per AGENTS.md); a proc-macro panic
  or abort inside the dylib kills the port process (rustc behaves the same for aborts). The `&[Client]` slice layout is
  "unstable" (host_dylib.rs:134 FIXME), as it is for rustc.
- **Scope creep in shims.** run-pass tests that need FFI (`rust_test_helpers`), inline asm, process spawning or isolation-off
  host access fail identically on the oracle (they are cases with error output, not skips); do not port
  native-lib/sockets/genmc to "fix" them.
- **Disk.** ~13 GB free; the isolated toolchain (544 MB) and the Miri sysroot (112 MB) fit; per-case Miri aux rlibs must
  be cached by hash like `$RUST_TS_DATA/aux/ui`.

Critical files: src/tools/miri/src/{machine.rs, eval.rs, helpers.rs, bin/miri.rs, shims/foreign_items.rs,
shims/unix/foreign_items.rs, concurrency/thread.rs, borrow_tracker/stacked_borrows/mod.rs},
compiler/rustc_const_eval/src/interpret/machine.rs, library/proc_macro/src/bridge/{rpc,server,client,buffer}.rs,
compiler/rustc_metadata/src/host_dylib.rs, compiler/rustc_monomorphize/src/collector.rs, harness/compiletest.ts,
harness/suites.ts, scripts/lib/oracle.ts.
