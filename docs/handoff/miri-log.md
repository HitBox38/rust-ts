# Handoff: lane `miri-log` (M6 wave 36; plan-m6 D10 + A6)

Branch `t3/ec465cd0` (worktree t3-ec465cd0), from main `06fa2c65`. `MIRI_LOG=info` is now live in the port for
everything this lane owns: the tracing stack (EnvFilter static directives, Registry spans, tracing-tree's span and event
paths), Miri's `bin/log/{mod,setup}.rs`, and the interpreter's `info!` events and its `frame` span. With logging off,
each call site costs one comparison (about 1 ns per call, measured below).

## 1. Oracle measurements (A6 claim verified)

Oracle: the isolated Miri (`$RUST_TS_DATA/rustup-miri`, `bun scripts/miri.ts status` ok, key `4b7f6cc5967f`). The program
is std's hello world (`harness/corpus/miri/hello.rs`, `--sysroot $RUST_TS_DATA/miri-sysroot --target
x86_64-unknown-linux-gnu`). Traces are in `$RUST_TS_DATA/tmp/miri-log/{info,debug,trace}.{stdout,stderr}`.

| `MIRI_LOG` | exit | stdout | stderr lines | content |
|---|---|---|---|---|
| `info` | 0 | `Hello, world!` | **22,954** | the trace below |
| `debug` | 0 | same | 22,960 | the 6-line warning "some trace filter directives would enable traces that are disabled statically" (ANSI-coloured even into a file), then **exactly** the `info` trace (`tail -n +7` is byte-identical to it) |
| `trace` | 0 | same | 22,960 | same, with `trace`/`TRACE` in the warning |

- **The claim holds.** The release oracle's `tracing` has `max_level_info` (`STATIC_MAX_LEVEL = info`). `debug!` /
  `trace!` events and DEBUG/TRACE spans are compiled out, so `MIRI_LOG=debug|trace` print nothing more than `info`.
  (The rustc oracle and the `tydump` probe behave the same way.)
- **INFO spans.** `#[instrument]` has no INFO-level use in `rustc_const_eval::interpret`,
  `rustc_middle::mir::interpret` or Miri: every one says `level = "debug"` or `"trace"`. `enter_trace_span!` is `()`
  (the `Machine::enter_trace_span` default; Miri overrides it only with its `tracing` feature, which is off). The only
  span in the trace is `info_span!("frame", ..)` (stack.rs:429).
  - It prints as ` rustc_const_eval::interpret::stack::frame frame=<instance>`: tracing-tree's `Open` line. It has no
    level, the field is `frame=` with `%instance` (Display), and `tracing_separate_thread = Empty` is not printed.
  - Close lines are not printed (`verbose_exit` off).
  - Indentation: an event in a scope of n spans gets `1 + 2(n-1) + 1` spaces before `INFO`. A span at depth n gets
    `1 + 2(n-1)` spaces. The extra event space is the `()` timer's padding, which tracing-tree adds whenever the event
    has a current span.
- **Line census of the info trace:**

  | lines | kind | site | owner |
  |---|---|---|---|
  | 17,554 | event | `rustc_const_eval::interpret::step` (statement and terminator `{:?}`, `// executing bbN`) | this lane |
  | 1,052 | span | `frame` | this lane |
  | 1,052 | event | `rustc_const_eval::interpret::call` (`popping stack frame (..)`) | this lane |
  | 1,829 | event | `miri::machine` (`Leaving ..` / `Continuing in ..`) | Miri lanes |
  | 1,466 | event | `miri::borrow_tracker` (`retag_ptr_value: ..`) | Miri lanes |
  | 1 | event | `miri::eval` (`Additional static roots: [..]`) | Miri lanes |

  The first three rows (19,658 lines, 86%) are live now. The other 3,296 need the recipe in §5.
- **For `miri-diff` (A6 normalisation).** Closure names carry the absolute rust-src path:
  `{closure@/…/rustup-miri/toolchains/…/library/std/src/rt.rs:…}`. They differ between the oracle and the port, so
  normalise them like other sysroot paths. Indentation is deterministic: it is the frame nesting, plus Miri's
  thread-switch quirks (tracing-tree's own comment, machine.rs:1991). A6 still prefers comparing event lines.

## 2. Files touched

| file | change |
|---|---|
| `src/rust_ts/tracing.ts` | `Level`/`LevelFilter` (from_str, Display), `STATIC_MAX_LEVEL = INFO`, `MAX_LEVEL` (`LevelFilter::current()`, set from the subscriber's hint) and `INFO_ENABLED` (its hoistable `level_enabled!(INFO)`), `info(..)` / `info_span(..)` / `span(..)`, `Span` (with_subscriber, drop → try_close), EnvFilter static directives (`Directive::parse` state machine, `parse_lossy`'s `ignoring ..` line, the "disabled statically" warning, specificity order, `enabled`, `max_level_hint`, default directive), `Registry` (span store, ref counts, `SpanStack`, contextual parents), `Context`/`SpanRef`, `LayeredSubscriber(layers, filter)` with the CloseGuard close order (on_close, then clear, then close the parent through the dispatcher) |
| `src/rust_ts/tracing_tree.ts` | `on_new_span`, `on_close`, `write_span_info`, `print_kvs`, `Data`, `scope_path`, `Buffers.current_span`. `on_event` now uses the event scope (indent, `deindent`, the timer pad). `write_retrace_span` and `span_modes` are `unported` (rustc_log never enables them) |
| `src/rust_ts/tracing.test.ts` (new) | Oracle Miri lines: frame spans plus INFO events, nested and closed; the WARN default (no closure runs, disabled span); EnvFilter specificity and prefix matching; the `MIRI_LOG=debug` warning byte for byte (child process); `ignoring ..` |
| `src/rustc_log/lib.ts` | `RUSTC_LOG` set → `EnvFilter::new(env)` (was `unported`); default → `EnvFilter::default().add_directive(WARN)` |
| `src/rustc_log/lib.test.ts` | `LayeredSubscriber.with_level(..)` (constructor now takes an EnvFilter); header |
| `src/rustc_log/tracing_oracle/{gen.ts,expected.json}` | 4 new `RUSTC_LOG` filter variants against the `tydump` probe: `rustc_infer=warn`, `rustc_errors=warn`, `warn,rustc_infer::infer::relate=error`, `no_such_target=debug,rustc_infer=warn` (the warning). expected.json was regenerated by gen.ts from the probe; only these 4 entries were added, existing entries are unchanged |
| `src/miri/bin/log/setup.ts`, `mod.ts` | Ported (stub replaced); see §4. The header still names `Fill lane: \`miri-driver\`` (the plan's assignment), because `src/miri/contract.test.ts` requires a lane from its list, which has no `miri-log`. It adds "ported by lane miri-log" |
| `src/rustc_const_eval/interpret/step.ts` | 3 live `info!`, each behind `if (tracing.INFO_ENABLED)` (also in call.ts and on the `frame` span): `// executing {:?}` (step.rs:71), the statement and terminator `or_if_tracing_disabled(|| info!("{:?}", ..))` (step.rs:89, :527) |
| `src/rustc_const_eval/interpret/call.ts` | live `info!("popping stack frame ({})", ..)` (call.rs:1110). The popped frame's guard is dropped on the two `?` exits that drop it upstream: the return-value copy in `return_from_current_stack_frame`, and `init_fn_call` in the tail call |
| `src/rustc_const_eval/interpret/stack.ts` | `SpanGuard` holds a real `tracing::Span`: `enter` enters it, `drop` exits it and drops the span. `info_span!("frame", ..)` is live (stack.rs:429). `cleanup_stack_frame` drops the frame's guard where upstream drops the unmoved `frame` (the two `?` returns and the no-cleanup branch) |
| `src/rustc_const_eval/interpret/machine.ts` | default `after_stack_pop` drops `_frame`'s guard at its end |

## 3. Verification

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | markers ok (23199; vendor 5050) |
| `bun scripts/coverage.ts --missing src/tools/miri/src/bin/log/setup.rs` / `mod.rs` | 6/6 / 0/0 |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rust_ts src/rustc_log src/rustc_const_eval src/miri` | 101 pass, 0 fail (incl. the 16 rustc_log oracle variants, 4 of them new filter variants) |
| `difftest --suite mir --sample 300` (logging off) | 300/300 MATCH, same as the base tree (`06fa2c65`, also 300/300) |
| `difftest --suite mir-core --sample 200` (logging off) | 200/200 MATCH |
| INFO unit test vs oracle lines | `src/rust_ts/tracing.test.ts`: real lines of the oracle Miri trace (frame spans at depths 1-2, events, `Leaving`/`Continuing in` around the frame drop, `Additional static roots`) and the `MIRI_LOG=debug` warning, byte for byte |

**Timing, logging off (base `06fa2c65` vs this branch).** mir-core `core`, subject user seconds over four runs each,
interleaved: base 168.5 / 164.3 / 153.6; branch 193.4\* / 170.0 / 159.3 / 161.8 (final code). The \*first branch run
(unguarded call sites) was an outlier; the base runs alone spread over 15 s. A tighter A/B on a CTFE-only crate
(`const X = fib(25)`, `-Zunpretty=mir`, 6 runs each):
- before the `INFO_ENABLED` guard: +1.1% user (5.19 vs 5.13 s);
- with it: +0.5% (5.21 vs 5.185 s; base range 5.13-5.27).

So there is no measurable slowdown. Micro-benchmark of a disabled guarded call: about 1 ns.

**End-to-end oracle check of the interpreter's events (CTFE, rustc oracle).** Ran
`RUSTC_LOG=<filter> rustc -Zunpretty=mir` on the port and on the pinned nightly, on a crate with nested const fn calls.
stderr was byte-identical: 467/467 lines for `rustc_const_eval::interpret=info`, and also for `..=debug` (471 lines
with the warning), `step=info,rustc_const_eval=warn`, bare `rustc_const_eval::interpret::stack` (spans only),
` bogus=x,=info,..call=info` (`ignoring` lines) and `step=off,interpret=info`. A 150-file sample of tests/ui/consts
under `rustc_const_eval::interpret=info`: 34 compared files, all MATCH (116 skipped: the port is unported/ICE there, or
the oracle trace is over 5 MB). That run included the temporary `eval_in_interpreter` frame drop of §5c; without it, 4
files with CTFE errors diverge, as described there. Script: `$RUST_TS_DATA/tmp/miri-log/scripts/ctfe-sample.ts`.

The port cannot run Miri yet (`src/miri/bin/miri.ts` is still a stub), so there is no port-side `MIRI_LOG` trace of hello
world yet. The rustc_const_eval part of that trace (86% of its lines) is covered by the CTFE comparison above, since
it is the same code under another machine.

## 4. `unported(...)` left, `// PORT:` decisions

`unported`:
- `tracing.ts`:
  - `field::Match::parse`: a field filter in `RUSTC_LOG` / `MIRI_LOG`.
  - `EnvFilter dynamic directives`: a span name, `target[span]=level`.
  - `EnvFilter::add_directive (a dynamic directive)`.
- `tracing_tree.ts`:
  - `write_retrace_span`: `span_retrace` / `deferred_spans` (never set by rustc_log).
  - `write_span_mode`: `span_modes`.
  - The existing thread-ids one.
- `rustc_log/lib.ts` keeps JSON, backtrace output and thread ids as before. The `RUSTC_LOG` filter one is gone.
- `miri/bin/log/setup.ts`: `MIRI_TRACING` set. Upstream's `#[cfg(not(feature = "tracing"))]` branch calls
  `crate::fatal_error!(..)`, and `fatal_error_` (bin/miri.rs:349) belongs to lane `miri-driver` and is not exported.
  It is marked `PORT(contract): pending miri-driver`. **miri-driver: replace the `unported` with**
  `fatal_error_("Cannot enable MIRI_TRACING since Miri was not built with the \"tracing\" feature")`.

`// PORT:`:
- `tracing.ts`:
  - Callsite interest caching is subsumed by `enabled`. Both derive from the same static directives.
  - `max_level_hint` is the filter's. `Layered::pick_level_hint`: the layers below give none.
  - Registry ids come from a counter, not sharded-slab slots. Ids are never printed.
  - `Directive::parse` slices the untrimmed string at offsets into the trimmed one, as upstream does.
  - `eprintln` writes straight to fd 2.
- `stack.ts`:
  - `SpanGuard`'s `impl Drop` is `drop()`, called where a popped frame is dropped.
  - `Empty` fields are left out of `info_span`.
- `step.ts`: `enter_trace_span!` is `()`, so `or_if_tracing_disabled` always runs its closure. The port calls
  `tracing.info` directly instead of going through `M::enter_trace_span`.
- `miri/bin/log/setup.ts`:
  - The crate is built without the `tracing` feature: no `_chrome` guard.
  - `to_string_lossy` is a no-op because env values are strings.

Decision for root to record (recommended: accept). A `RUSTC_LOG` / `MIRI_LOG` filter used to stop with `unported`; it
now runs. The INFO events and spans outside this lane's targets are still comments: 27 compiler files with `info!`,
and 39 INFO-level `#[instrument]`s (the default level), e.g. in rustc_infer. So a filter that enables INFO there
prints fewer lines than the oracle. `MIRI_LOG=<level>` only enables `rustc_middle::mir::interpret` (no INFO sites),
`rustc_const_eval::interpret` (all live) and `miri` (§5a). Logging is a debug tool and never a gate (D10), and the
harness scrubs `RUSTC_LOG*`. The EnvFilter subset (static directives only) is the scope boundary.

## 5. Handoffs (other owners)

### 5a. Recipe: converting Miri's own `info!` events (each file's owner)

Miri has six `info!` sites (no INFO `#[instrument]`, no `info_span!`):

| site | owner (file) | target |
|---|---|---|
| machine.rs:1994 `info!("Leaving {}", ecx.frame().instance())` (before_stack_pop) | miri-machine | `miri::machine` |
| machine.rs:2017 `info!("Continuing in {}", ecx.frame().instance())` (after_stack_pop) | miri-machine | `miri::machine` |
| borrow_tracker/mod.rs:282 `info!("retag_ptr_value: type={ty}, mode={retag_mode:?}, val={:?}", **val)` | miri-sb / borrow tracker | `miri::borrow_tracker` |
| eval.rs:571 `info!("Additional static roots: {:?}", ecx.machine.static_roots)` | miri-eval | `miri::eval` |
| concurrency/thread.rs:516 `info!("---------- Now executing on thread `{}` (previous: `{}`) ----…", ..)` | concurrency owner | `miri::concurrency::thread` |
| concurrency/scheduler.rs:65 (GenMC only), genmc/run.rs (excluded, D2) | — | — |

Mechanically:
1. `import * as tracing from "<relative>/rust_ts/tracing.ts";`
2. `info!("<fmt>", args.., name = ?v, ..)` becomes
   `tracing.info("<module_path!()>", () => \`<fmt with ${..}>\`, ["name", () => <debug of v>], ..)`.
   - The target is the Rust module path of the file: `miri::machine`, `miri::borrow_tracker`, `miri::eval`,
     `miri::concurrency::thread`.
   - Keep the format string byte for byte. `{}` is Display (`display_Instance(..)`, `display_Ty`), `{:?}` is Debug
     (`debug_X(v, PLAIN)`). Inline `{ty}` / `{retag_mode:?}` are the same.
   - The message and field values must be closures (they run only when enabled), and no other work may happen
     outside them, so the disabled cost stays one comparison.
   - On a hot path (once per step, retag or access, e.g. `retag_ptr_value`), hoist the level check:
     `if (tracing.INFO_ENABLED) tracing.info(..)`. Then a disabled event allocates no closures or field arrays.
     Measured on CTFE: without the guard +1.1% user time, with it +0.5% (noise).
3. `debug!` / `trace!` stay comments. A Miri `enter_trace_span!(..)` stays a comment (it is `()`). A
   `.or_if_tracing_disabled(|| info!(..))` becomes the `tracing.info(..)` call itself.
4. **Frame drops (miri-machine, required for correct nesting).** Upstream drops each popped `Frame`, which exits its
   `frame` span. Miri's `after_stack_pop` (machine.rs:2004) moves `frame` into a sub-scope and drops it there, so
   `frame.tracing_span.drop()` must run at the end of that block, after `handle_stack_pop_unwind`, before
   `Continuing in`. Otherwise every later event nests one level too deep: the oracle prints `Leaving` one level deeper
   than `Continuing in`. The same applies anywhere else Miri drops a popped `Frame` without handing it on. A `Frame`
   that is only moved (`with_extra`, passed by value) must not be dropped twice. `SpanGuard.drop()` is idempotent, but
   keep it to the upstream drop point.

### 5b. miri-driver
- Call `log::setup::init_early_loggers(&early_dcx)` / `init_late_loggers(&early_dcx, tcx)` / `deinit_loggers()` where
  bin/miri.rs does (`src/miri/bin/log/mod.ts` re-exports `setup`).
- Replace the `MIRI_TRACING` `unported` (§4).

### 5c. `rustc_const_eval/const_eval/eval_queries.ts` (not this lane's file; needs an owner)
(Corrected by lane `miri-log-fix`, which landed the fix; see `docs/handoff/miri-log-fix.md`.) Upstream
`eval_in_interpreter` does not take an `ecx`: it creates `let mut ecx = InterpCx::new(..)` as a local
(`eval_queries.rs:452`), and the local is dropped when the function returns, after `report_err().map_err(|error|
report_eval_error(&ecx, ..))` (`:467-468`) has used it. `InterpCx` has no `Drop` impl; dropping its `machine` drops
`CompileTimeMachine::stack: Vec<Frame>` front to back. On a CTFE **error** the frames still on the stack are dropped
then, and each `Frame`'s `SpanGuard` exits its `frame` span. The port never drops the `InterpCx`, so with a
`RUSTC_LOG` filter that enables `rustc_const_eval::interpret` the next constant's frames nest under the failed one's.
I confirmed this with a temporary patch, since reverted: 4 of 4 diverging tests/ui/consts files matched after adding,
at the end of `eval_in_interpreter`, after the result is computed:

```ts
const out = r.$ === "Ok" ? r : Err(report_eval_error(ecx, cid, r._0));
for (const f of ecx.stack()) f.tracing_span.drop(); // `ecx` (its machine's `stack: Vec<Frame>`) is dropped here
return out;
```
The `Vec` drop order is front to back, as the loop does. This only matters with logging on. No suite sets
`RUSTC_LOG`, and before this lane a `RUSTC_LOG` filter was `unported`. The same applies to any other place that
creates a `CompileTimeInterpCx` and can return with frames still pushed. Miri's ecx lives until the end of the run.

### 5d. Harness (`miri-diff` lane)
`MIRI_CASE_ENV` removes `MIRI_LOG` for the suites, which is correct. `scripts/miri-diff.ts` sets `MIRI_LOG=info` on
both sides, normalises the rust-src paths (§1), and compares event lines.
