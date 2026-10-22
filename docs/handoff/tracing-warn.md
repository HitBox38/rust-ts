# Handoff: tracing-warn (rustc's default logger output for `warn!` / `error!`)

Branch `lane/tracing-warn`, base `f5de3f15`.

## What rustc does (at the pin)
- `rustc_driver_impl::main` → `init_rustc_env_logger` → `rustc_log::init_logger(LoggerConfig::from_env("RUSTC_LOG"))`.
- If `RUSTC_LOG` is unset, the filter is `EnvFilter::default().add_directive(LevelFilter::WARN)`. The subscriber is
  `Registry.with(tracing_tree::HierarchicalLayer).with(filter)`, and the writer is `io::stderr`, unbuffered.
- The layer is tracing-tree 0.4.1. It is built with `with_targets(true)` and `with_indent_amount(2)`. `with_ansi` is
  `RUSTC_LOG_COLOR` (`always`/`never`/`auto`) or, when that is unset, `stderr.is_terminal()`.
- Upstream has no span at WARN level or above. So an event never has a span context, the indent is 0, and the timer
  `()` prints nothing.
- Bytes of one event (no colour): `" " + "WARN"|"ERROR" + " " + target + " " + message [+ ", name=value"...] + "\n"`:
  - `target` is the call site's `module_path!()`.
  - Values are `{:?}`. The message is `format_args!`, whose Debug is its Display. tracing records `message` first,
    then the named fields in macro order (`valueset_all!`).
  - In a multi-line message, the lines after the first get 3 leading spaces. `RUSTC_LOG_LINES=1` drops the
    leading space.
  - Colour: `" \e[1;38;2;252;234;160m WARN\e[0m \e[2m<target>\e[0m ..."`. ERROR is `\e[1;31mERROR\e[0m`.
- Events emitted while formatting an event are dropped (tracing-tree's recursion guard).

## Files touched
- `src/rustc_log/lib.ts` (new): the rustc_log port. It covers `LoggerConfig::from_env`, `init_logger`,
  `init_logger_with_additional_layer`, `BacktraceFormatter::format_event`, `stdout_isatty`/`stderr_isatty`, and
  `Error` + Display.
  - It has `// rustc:` markers, but rustc_log is excluded in scope.json, so they are not counted.
- `src/rust_ts/tracing.ts` (new): our glue for tracing/tracing-core/tracing-subscriber. It holds the global dispatch,
  the WARN filter, `event`/`warn`/`error`, and `SetGlobalDefaultError`.
- `src/rust_ts/tracing_tree.ts` (new): tracing-tree 0.4.1's event path (`on_event`, `Buffers::indent_current`,
  `indent_block`, `indent_block_with_lines`, `FmtEvent::record_debug`, `ColorLevel`, `styled`, `Config::prefix`) and
  nu-ansi-term 0.50.3 painting.
  - These use `// ref: tracing-tree-0.4.1/...` comments, not `// crate:` markers. tracing-tree is not a
    `harness/scope.json` vendor crate, and `coverage --check` rejects `// crate:` markers for crates outside it.
  - **Root:** if wanted, add `"tracing-tree": "=0.4.1"` (and nu-ansi-term `=0.50.3`) to scope.json `vendor`, move
    the file to `src/vendor/tracing_tree/`, and turn the refs into markers.
- `src/rustc_driver_impl/lib.ts`:
  - `init_rustc_env_logger` is ported.
  - `init_logger` (1637) is newly ported.
  - The `ice_path_with_config` `tracing::warn!` for `-Zmetrics-dir` + `RUSTC_ICE` is now emitted. The
    `cfg!(debug_assertions)` one stays a comment.
- Call sites now emitted, in place, with the upstream format string:

  | Upstream site | Port file | What it emits |
  |---|---|---|
  | `rustc_infer/src/infer/relate/generalize.rs:434` | `src/rustc_infer/infer/relate/generalize.ts` | `may incompletely handle alias type: {alias:?}` |
  | `rustc_trait_selection/src/traits/coherence.rs:696` | `src/rustc_trait_selection/traits/coherence.ts` | `expected an unknowable trait ref: {trait_ref:?}` |
  | `rustc_trait_selection/.../need_type_info.rs:274` | `src/rustc_trait_selection/error_reporting/infer/need_type_info.ts` | `resolved ty var in error message` |
  | `rustc_trait_selection/.../need_type_info.rs:1300` | same file | `unexpected path: ...`; the port's two arms for the upstream `_` both emit it |
  | `rustc_errors/src/emitter.rs:602` | `src/rustc_errors/emitter.ts` | `Invalid span {:?}` + `error = ?e` |
  | `rustc_errors/src/emitter.rs:614` | `src/rustc_errors/emitter.ts` | `Invalid span {:?}` + `error = ?e` |
  | `rustc_mir_dataflow/src/framework/mod.rs:389` | `src/rustc_mir_dataflow/framework/mod.ts` | `error!("Failed to write graphviz dataflow results: {}", e)` |
- `src/rust_ts/{tydump,thirdump,resdump,mirdump}.ts`: these now call `init_rustc_env_logger(early_dcx)`, as their
  probes do since harness-w20b.
- `src/rust_ts/{main,tydump,thirdump,resdump,mirdump}.ts`: a `FatalErrorMarker` that escapes, from `early_fatal`
  before `catch_with_exit_code`, now gives exit 101 with nothing printed, as rustc does. Before, it printed
  `rust-ts: internal compiler error: [object Object]`.
- Tests:
  - `src/rustc_log/lib.test.ts` (19 tests).
  - Fixtures in `src/rustc_log/tracing_oracle/`: `root_region.rs` (a no_core version of
    issue-118950-root-region.rs), `gen.ts` and `expected.json`.
  - They compare the ported tydump driver with the `tydump` probe, byte for byte (stdout, stderr, exit, log file),
    for 12 `RUSTC_LOG_*` variants: default, colour always/never/auto/invalid, LINES, LINES+colour, ENTRY_EXIT,
    WRAPTREE `+3`/invalid, OUTPUT_TARGET, and BACKTRACE on another target.
  - Format unit tests cover named fields, ERROR (plain and coloured), multi-line messages, the filter, the
    recursion guard and the rustc_log errors.

## Call sites not emitted (upstream fn not ported, or inside `unported`)
- `rustc_interface/src/passes.rs:637` `tracing::error!` (hash_iter_files): it sits inside the
  `unported("rustc_span::SourceFileHash::new ...")` branch, so the comment stays.
- Not ported fns: `rustc_data_structures/src/profiling.rs:669`, `rustc_incremental/src/persist/load.rs:196`,
  `rustc_codegen_ssa/src/mir/locals.rs:51`, `back/linker.rs:105,108,111`, `back/link.rs:1321,1360`.
- `rustc_public` is out of scope.
- `error!` in `rustc_interface/src/interface.rs` and `rustc_const_eval/src/check_consts/ops.rs` are local macros, not
  tracing.
- `#[instrument(err)]` is used nowhere. The only non-debug spans are `level = "info"` ones, which are filtered out.
- `icu_provider`'s `log::warn!` stays a no-op: rustc does not bridge `log`.

## `unported(...)` left
- `tracing_subscriber::EnvFilter::new (a RUSTC_LOG filter)`: when `RUSTC_LOG` is set. Same behaviour as before.
- `tracing_subscriber::fmt::format::Json (RUSTC_LOG_FORMAT_JSON)`.
- `rustc_log::BacktraceFormatter (a Rust backtrace, RUSTC_LOG_BACKTRACE)`: only when an event's target contains the
  value.
- `tracing_tree::format::Config::prefix (thread ids/names, RUSTC_LOG_THREAD_IDS)`.

## `// PORT:` decisions
- `env::var` never yields `NotUnicode` (process.env).
- The `EnvFilter` is reduced to its one static max-level directive.
- `level_enabled!` and the callsite interest are subsumed by the subscriber's `enabled`.
- `indent_block`'s `&mut String` is returned.
- A WRAPTREE above 2^53 is clamped; it is only ever a `%` divisor.
- `from_env` evaluates in source order.

Both lane decisions are recorded in docs/state.

## Coverage
- `coverage --missing compiler/rustc_driver_impl/src/lib.rs`: 29/43 (`init_logger` added).
- `compiler/rustc_log/src/lib.rs`: 8/23. The crate is excluded from scope. What is left is NonrecursiveLayer and
  its guard, which wrap only the JSON layer.
- `coverage --check`: markers ok.

## Oracle scan
Every cached oracle output under `$RUST_TS_DATA/oracle-cache` was checked (603k entries, gz included) for lines
starting with ` WARN ` / ` ERROR ` / ` INFO ` + target. Only one output prints a tracing event: tydump-ui's
`tests/ui/traits/next-solver/issue-118950-root-region.rs`. It now MATCHes in tydump-ui and in thirdump-ui (single-case
runs `tw-118950-a`, `tw-118950-thir-a`; base `tw-118950-base` was DIFF).

## Sample runs (RUST_TS_AGENT=root-f5de)
- `tydump-minicore` (full suite, run `tw-tydump-minicore`): 45 MATCH, 1 UNPORTED, 0 DIFF. This is per-case identical
  to the base `20261022-175059-root-f5de-8kp6`.
- `tydump-ui --sample 300` (`tw-tydump-ui-300`): 258 MATCH, 40 UNPORTED, 2 UNSTABLE, 0 DIFF. This is per-case
  identical to the base `20261022-175123-root-f5de-supl`. issue-118950 is not in this sample. Its single-case run is
  above.
- `hir-tree --sample 300` (`tw-hir-tree-300`): 300/300 MATCH, and no protected case is lost.
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: ok.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 6077 pass, 1 skip, 0 fail (6078 tests, 430 files).
