# Handoff: fix-parser (fixer for reviews parser-a + parser-b)

Branch `lane/fix-parser`, base `2f4cfa0`, main merged in at `72e1bdc` (no conflicts). Not pushed. Work was split in three:
the lead (driver/std), a JSON-emitter sub-agent (`598d1eb`), and a cleanup sub-agent (`44241f7`).

## Checks (merged HEAD)
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 2193 pass, 1 skip (pre-existing linux-only), 1 fail fixed after the run (`result.test.ts` unwrap_result scan tripped on
  explicit generics in json.ts; rewritten, `src/std/result.test.ts` + `src/rustc_errors` re-run green). termize is flaky, see For root.
- difftest (`RUST_TS_AGENT=fix-parser`): parse --sample 1000: 1000/1000 MATCH; parse-ui --sample 300: 300/300; parse-ui-json --sample 300:
  288 MATCH, 12 UNPORTED (all `ErrCodeDescription.text()`), 0 DIFF.
- Coverage: rustc_parse lib.rs 13/13, driver args.rs 8/8, driver lib.rs 25/43 (+`install_ice_hook`), signal_handler.rs 3/7
  (`backtrace_stderr`, `min_sigstack_size` x2 and the macro have no JS counterpart), rustc_errors json.rs 20/20, json/tests.rs 12/12.

## parser-b
- **B1 HIGH stack depth: fixed.** `src/rust_ts/stack.ts` + `src/rustc_driver_impl/signal_handler.ts` (new) + main.ts.
  - Upstream: the compiler runs on a thread of `init_stack_size()` (RUST_MIN_STACK, default 17 MiB), no recursion guard in
    the parser; overflow = SIGBUS (macOS) / SIGSEGV (Linux) caught by `signal_handler::print_stack_trace`, exit 128+sig.
  - JSC sizes the main thread stack from `RLIMIT_STACK` and caps it at `maxPerThreadStackUsage`, both read at VM start;
    Workers ignore `stackSize`/`resourceLimits` in Bun 1.4.3 (measured), and XNU refuses `setrlimit(RLIMIT_STACK)` in a
    process with a custom `LC_MAIN` stack (Bun: 18 MiB). So `ensure_stack()` re-execs once (same pid, raw argv bytes via
    `execv`) through `/bin/sh -c 'ulimit -S -s N; exec "$@"'` with `BUN_JSC_maxPerThreadStackUsage` =
    1.5 x the Rust thread size, capped by the real stack (macOS: LC_MAIN - 1 MiB = 17 MiB). Cost: one extra Bun start (~15 ms).
  - Measured max nesting (parse-only, macOS): parens rustc 7421 / rust-ts 10057; `mod a {` 6933 / 15720; closures 4981 / 11424;
    unary `-` 17282 / 19625; blocks 2345 / 7519; `[T]` 9081 / 50087. All review repros now exit 0 like rustc.
    Between rustc's limit and ours rust-ts succeeds where rustc dies (frame sizes cannot match exactly).
  - A JS `RangeError: Maximum call stack size exceeded` goes to `signal_handler.on_stack_overflow`: prints the handler's
    deterministic lines (no frame lines: PORT), then re-raises SIGBUS/SIGSEGV, so exit status matches rustc (138 on macOS).
  - Windows: no re-exec, overflow stays an ICE (upstream installs no handler there either).
- **B5-3 HIGH argfile BOM / final `\r`: fixed.** `read_file` uses std `from_utf8` (keeps U+FEFF); new std `str_lines`.
- **B5-4 HIGH non-UTF-8 argv: fixed.** New `src/std/env.ts` `args_os()` reads raw argv (`_NSGetArgv` via bun:ffi on macOS,
  `/proc/self/cmdline` on Linux; Windows falls back to decoded argv, PORT). `raw_args` ported (`argument N is not valid
  Unicode: "\xFF.rs"`, OsStr Debug via `debug_os_bytes`). `install_ice_hook` ported: with `RUST_BACKTRACE` unset its
  `env::args()` panics first (rustc: exit 101), as upstream. `extra_compiler_flags` now uses `args_os`.
- **B5-9 MED `--error-format=json`: ported** (`src/rustc_errors/json.ts`, tests, oracle test; session.ts both sites).
  Residual: diagnostics with an error code reach `unported` in `codes.ts` `ErrCodeDescription.text()` (the E*.md texts are not
  embedded). 21,451/21,522 parse files match as json, 71 unported, 0 diff.
- **B5-9 MED stdin `-`: ported** (`make_input`: read_to_string + UTF-8 error, `UNSTABLE_RUSTDOC_TEST_PATH/LINE`,
  `anon_source_code` from stable-hash). Oracle-tested.
- **B5-5 MED "steps not run".** Target steps were done by target-cfg (now in main). Non-target ones: `signal_handler::install`
  ported (above); `install_ice_hook` ported except the hook body (`report_ice` text embeds Rust panic locations; main.ts
  reports ICEs, exit 101); `install_ctrlc_handler` not ported, PORT note (JS signal handlers cannot run during synchronous
  compilation; default SIGINT applies); `callbacks::setup_callbacks` left with its note: every hook is a no-op without a
  `TyCtxt` (rustc_middle `tls`) - port callbacks.rs with tyctxt-min.
- Not assigned, left: B5-11 broken pipe exit 141, B5-14 non-unwind JS errors skipping `finish_diagnostics`, B5-15
  `RUSTC_LOG=` empty, B5-16 dummy backend.

## parser-a
- **A1-1 MED main-file load errors + invalid UTF-8: fixed.** `src/std/io.ts`: full `ErrorKind` (+`as_str`),
  `decode_error_kind` (unix table over `node:os` errno constants), `format_os_error` = host `strerror_r`/`__xpg_strerror_r`
  via bun:ffi, `io::Error` Os Display/Debug/kind (Windows: `unported`). `src/std/str.ts`: `run_utf8_validation`/`from_utf8`
  with exact `Utf8Error` (Debug/Display). `couldn't find file` + suggestion, EISDIR, EACCES, invalid UTF-8 all match.
- **A1-2 MED path helpers: fixed.** `src/std/path.ts` gained `Components::next_back`, `Path::parent`, `Path::file_name`;
  `parent == Path::new(".")` uses `path_eq`. `read_dir` order: Bun's `readdirSync` returns raw readdir order (checked vs
  `ls -f` in a test; Node would sort), buffer names, non-UTF-8 skipped. Also lib.rs `from_utf8_lossy` keeps a BOM now.
- A3-1 shim mode removed; A1-3 stubs.ts deleted; A2-1/2 ty.ts unreachable prefix + `unwrap`; A2-3 `TraitBoundModifiers.NONE`
  frozen; A1-4 labeled break; A4-1 asm.ts import; A1-6 PORT on `Parser.new`; A3-2 pat-stmt handoff marked resolved.
- **unicode-width timeouts:** the three all-scalar tests take 300 s.

## Tests added
- `src/std/std.oracle.test.ts`: builds a probe with the oracle; from_utf8/Utf8Error, OsStr Debug, `str::lines`, Path
  parent/file_name (28 paths), `io::Error::from_raw_os_error(0..=150)` kind/Display/Debug.
- `src/rustc_driver_impl/inputs.oracle.test.ts`: 26 CLI cases (missing/typo/dir/EACCES/invalid UTF-8 files, argfiles), stdin,
  non-UTF-8 argv, deep nesting within and far beyond rustc's stack, readdir order.
- `src/rust_ts/stack.test.ts`; `src/rustc_errors/json/tests.test.ts`, `json.oracle.test.ts` (85 cases).

## unported left / PORT decisions
- `unported`: io errors on Windows (`decode_error_kind`/`format_error`); `ErrCodeDescription.text()` (json `explanation`).
- PORT: stack glue (factor 1.5, sh re-exec, macOS cap); signal_handler frames omitted; env.ts raw argv sources; read_dir
  order = Bun readdirSync; ctrlc handler; `install_ice_hook` backtrace style; json.ts serializer (see its header).

## For root
1. Record decisions: compiler stack via re-exec (above); stack overflow = re-raised signal; raw argv via OS.
2. Queue: embed `rustc_error_codes` E*.md texts (unblocks the 71 json unported cases); callbacks.rs with tyctxt-min.
3. Pre-existing flaky test: `src/vendor/termize/lib.test.ts` "no fd leak under a pty (stdio branch)" fails ~4/6 runs on a
   loaded host at the base commit `2f4cfa0` too.
