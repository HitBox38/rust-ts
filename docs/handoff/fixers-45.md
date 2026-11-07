# Handoff: fixers-45 (driver and environment findings, `RUSTC_LOG`'s INFO events)

Branch `t3/33c56b8b`, base `26e61959` (Start wave 40c). Commits: `bd538a1d` (part 1), `572f4f39`, `e043c959`, `111c910e` (part 2), then this file.
Host: root host, AC power, load 2 to 9 with other lanes. `RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=fixers-45`. No gate, no full suite, no full unit step.

## Cases that changed status

| Suite | Case | Before | After |
|---|---|---|---|
| mir-o2 | `rustc-env/def-path-hash-ice-157238.rs` (`RUSTC_LOG=trace`) | UNPORTED (INFO not converted) | **MATCH** |
| run-pass-aux-miri | `rustc-env/rust-log.rs` (`RUSTC_LOG=debug`, 19,872 stderr lines) | UNPORTED (INFO not converted) | **MATCH**: the suite would be 356 of 356 |
| mir-o2 | `attributes/log-backtrace.rs` | UNPORTED (INFO not converted) | UNPORTED: `rustc_log::BacktraceFormatter (a Rust backtrace, RUSTC_LOG_BACKTRACE)` |
| mono-ui | `def-path-hash-ice-157238.rs`, `log-backtrace.rs` | DIFF | DIFF, unchanged: see "For root" 1 |

`log-backtrace.rs` stays UNPORTED on purpose. With `RUSTC_LOG_BACKTRACE=rustc_metadata::creader` the oracle prints a `std::backtrace::Backtrace` of its own native frames (`Backtrace [{ fn: "<std::backtrace::Backtrace>::create" }, ...]`) on every creader event. The port cannot reproduce that faithfully.

## Part 1: findings from `docs/reviews/fixers-43.md` and `docs/handoff/fixers-43.md`

Each finding was reproduced first, except F6 (Linux only).

| Item | Fix | Check |
|---|---|---|
| **F2**: from a cwd of 1,024 bytes or more, `realpath("bun")` named `~/.bun/bin/bun` | New `host_canonicalize` (`src/std/path.ts`): a relative path is joined to `env::current_dir()` before `realpathSync.native`, as `realpath(3)` resolves against the process cwd. An error from `current_dir` fails it, as upstream. Used by `rustc_fs_util::try_canonicalize`, `passes.ts`'s `try_canonicalize` and Miri's `canonicalize` (Miri's was the non-native `realpathSync`). | In a 1,219-byte cwd, `--extern lib=bun` now says `does not exist: bun` like the oracle (was `is not a file`). `rel/liblib.rmeta` and `ext.rs` agree too. Only `realpath` reads Bun's stale cwd: `exists`, `stat`, `readFile` and `readdir` with relative paths were probed and are correct. |
| **F3**: `RUST_TARGET_PATH` was read lossily | `var_os` and a new `std::env::split_paths` (unix: bytes split at `:`, `src/std/env.ts`). A UTF-8 directory works as before. A non-UTF-8 one is joined and `stat`ed as bytes (`join_os`, `is_file_os` in `rustc_target/spec/mod.ts`). If it names a file, loading from a byte path stops with `unported`. | `RUST_TARGET_PATH=a\xffb` with `a\u{FFFD}b/mytgt.json` present: `could not find specification`, as the oracle (was `unported: from_json`). `good`, `a\xffb:good` and empty agree too. |
| **F4**: `?` ported as `unwrap_result` | `std/path.ts` `sys_path_absolute`: `if (cwd.$ === "Err") return cwd`. `passes.ts` `std_path_absolute` (an `.ok()` caller): returns `undefined`. | Read; tsc. |
| **F6**: the cwd refresh with a U+FFFD twin | `set_current_dir` refreshes Bun's copy only when the cwd's bytes are valid UTF-8, so a lossy name can no longer move the process. **Fixed by reading, not run**: Linux is not available here, and APFS refuses such names. | `env.test.ts` passes. |
| Temp-dir error without ` at path "..."` | `TempDirBuilder.tempdir_in` (`rustc_metadata/fs.ts`) now follows tempfile-3.23.0's `create_helper`, `tmpname` and `with_err_path` (names, retries on `AlreadyExists`, `NUM_RETRIES`, mode 0o777 before the umask instead of mkdtemp's 0o700). Each error becomes `Custom { kind, "{err} at path {path:?}" }`. | From the long cwd, `--emit=metadata` gives `couldn't create a temp dir: File name too long (os error 63) at path "<dir>/rmetaXXXXXX"` on both sides, after masking the random name. A normal `--emit=metadata` still works. |
| `POLONIUS_ALGORITHM=bad` refuses its location | **Not done.** The anchor `// rustc-call: 177:60` above the `unwrap_result` in `rustc_borrowck/nll.ts` makes the location right: tested, `nll.rs:177:60` on both sides. `track_caller_check.ts` accepts it (23 anchors, 0 bad). But `scripts/lib/marker-check.ts` (the gate's `coverage.ts --check`) rejects it: `rustc-call 177:60 is unwrap upstream, but the next line calls no unwrap`. It does not know that `unwrap_result` ports `.unwrap()`. So it was removed (`e043c959`). See "For root" 2. | `coverage.ts --check`: markers ok. |

`track_caller.ts` is untouched. `track_caller_check.ts` before and after the whole branch: 4,509 sites, 0 proven swaps, 0 bad anchors, ICE corpus 49 of 49, identical counts. The 92 of 118 ICE report figure was not re-measured, as that needs the reviewer's `cmp-impl.ts`.

## Part 2: `RUSTC_LOG` INFO events

**What upstream does.** rustc's `tracing` has `max_level_info` (`STATIC_MAX_LEVEL = INFO`). So `debug!`, `trace!` and DEBUG/TRACE spans are compiled out, and only `info!`, `info_span!` and `#[instrument]` at INFO (the default level) print. tracing-subscriber's `EnvFilter` warns when a directive asks for more than the static max (`some trace filter directives would enable traces that are disabled statically`). That warning was already ported. mono-ui lacks it only because its subject never starts the logger ("For root" 1).

**Design.** The guard that stopped every filter enabling INFO outside `INFO_CONVERTED_TARGETS` is gone. Each upstream INFO site in a ported fn is now one of two things:
- **Live**: `tracing.info(..)`, or `tracing.instrument(target, "<fn>", () => [fields], () => body, ret?)`. The second is new in `src/rust_ts/tracing.ts`. It follows tracing-attributes-0.1.31 `gen_block`: the span is entered for the body, `ret` becomes a `return=` event inside the span, and exit and close happen on return or unwind. The fields are a thunk, so a disabled call allocates no array.
- **A loud stop**: `tracing.info_unconverted(target, "<site>")`. It throws `unported` only when the filter would record INFO for that target, and otherwise does nothing.

**Checker.** `bun src/rust_ts/info_sites_check.ts` (0.3 s) scans upstream `compiler/` and Miri's `src/`. Each fn holding an INFO site, if ported, must have at least as many live calls or stops in its TS body. Today: 136 upstream sites, 3 skipped with reasons (a macro definition, a `cfg!(debug_assertions)` branch, Miri's GenMC branch), 83 in ported fns, 0 missing, 18 fns not ported (codegen and LTO, linking, GenMC).

**Converted live** (not every one was seen printing; every one these runs reached matched): creader (15 sites, with `CStore`'s Debug), locator (10), dependency_format (4), effective_visibilities (`{:#?}`), passes (`parse sess buffered_lints`, and `Pre-codegen`/`Post-codegen`: `TyCtxt::debug_stats`, now ported, see below), stability `recurse` (HIR `UseTree`), eval_ctxt `should_rerun_after_erased_canonicalization` (`ret`), assembly `try_assemble_bounds_via_registered_opaques`, opaque_types `normalize_opaque_type`, `collect_errors`, `coerce` (`ret`), `add_all_points`, `constraint_path_to` (`ret`), lifetime_syntax (5), `normalize_with_depth_to`, `project`, `clause_obligations` (`ret`), the query `normalize::<T>` event, `check_expr_call`, `consider_opaque_type_use` (`ret`), `ctfe_limit::run_pass`, `lit_to_mir_constant`, `find_width_of_character_at_span`, `check_trait`, macro_rules `from_tts`/`expand_macro`/`expand_macro_attr`, the three typeck `suggest_*` spans, error_reporting's `skipping .. (implied by ..)`, `ProjectionCache::complete` (2), and smaller `info!`s (span lib, thir expr, method suggest, rustc_peek, lto).

**Still stops** (`info_unconverted`): `ty/adt.rs:645` (`ConstValue`'s `{:#?}`), `back/link.rs:363`, `:421` (codegen, unported anyway).

**Verified against the oracle** with `RUSTC_LOG=info` (or `trace`), stdout and stderr byte-identical:
- the two target cases;
- `traits/monad.rs` (3,013 lines);
- 10 iterator, closure and associated-type tests, including `closures/many-closures.rs` (283,929 lines);
- 4 `mismatched_types`, 6 `typeck`, 8 `suggestions`, 8 `impl-trait` and 10 `borrowck`/`nll` tests, error paths included.
  Sites not seen printing in any of them include `ProjectionCache::complete`, `dependency_format` (codegen), `expand_macro_attr`, `check_trait`, `rustc_peek` and lto.

These are scratch comparisons with `-Zunpretty=mir`, not a suite: no suite runs `RUSTC_LOG` beyond the three cases.

## `// PORT:` decisions

- `T: Debug` and `std::any::type_name::<T>()` for generic instrumented fns (`normalize_with_depth_to`, query `normalize`, `try_assemble_bounds_via_registered_opaques`) come from `T`'s `TypeFoldable` descriptor. They are registered with `tracing.register_debug` / `register_type_name`, keyed on the descriptor's `fold_with` function, which the scattered local `d_TraitRef` objects share.
  - `fold_Binder` and `fold_tuple2/3` descriptors now carry their parts under `tracing.BINDER_INNER` / `TUPLE_PARTS` (symbol properties set in `rustc_type_ir/binder.ts` and `fold.ts`).
  - Registered so far: Ty, Term, Clause, TraitRef, FnSig, GenericArg, Predicate, project.ts's `d_AliasTerm`, and the three `GoalKind`s.
  - Type names come only from upstream's definitions: `rustc_middle::ty::Ty<'_>`, `..::generic_args::GenericArg<'_>` (the oracle's own output), `..::predicate::Predicate<'_>`.
  - Any other descriptor stops with `unported`, naming its `fold_with`. This is an extensible table, not a guess.
- `TyCtxt::debug_stats` / `sty_debug_print` (`ty/context.ts`) is ported. It iterates a new `ShardedHashMap.keys()` (`lock_shards().iter()`; the order is not upstream's, and its only user counts). `{:.1}` goes through a local exact formatter, `f64_fixed1`: round half to even on the binary value, as `to_exact_fixed_str`. The port's interner counts equal rustc's on `rust-log.rs` (1,580 types, 505 GenericArgs, 653 regions, 93 const allocations, 153 layouts).
- `host_canonicalize`: see F2.
- tempfile's random names come from `crypto.getRandomValues` (`fastrand` is not ported; both sides are random).
- `split_paths` on Windows, and so `RUST_TARGET_PATH` there, is `unported`. It used `path.delimiter` before. Windows is unchecked (AGENTS section 5).

## `unported(...)` left or added

- `rustc_target::spec::Target::search load_file (a RUST_TARGET_PATH directory that is not UTF-8)`
- `std::sys::paths::windows::split_paths`
- `tracing INFO site: <site>: the Debug of a value whose TypeFoldable descriptor (...) has none registered` (normalize), `type_name / Debug of ...` (query normalize), `the Debug of a GoalKind with none registered` (assembly)
- `info_unconverted`: the 3 stops listed above
- unchanged: `rustc_log::BacktraceFormatter`, `RUSTC_LOG_FORMAT_JSON`, dynamic `EnvFilter` directives

## Checks

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (24,872).
- Coverage of the touched upstream files is unchanged; no fns were added or removed. For example: creader 55/55, locator 22/22, ty/context 202/202, traits/normalize 15/15, query/normalize 11/11, stability 46/46, coercion 49/49, eval_ctxt 76/76, lifetime_syntax 19/19, metadata fs 5/5, passes 28/29, spec/mod 89/97, rustc_fs_util 1/10.
- Unit tests run, by file only: `std/path`, `std/env`, `rustc_interface/metadata_temp_dir`, `rustc_log/lib` (its oracle variants included): 34 pass. In `rustc_log/lib.test.ts` the old converted-targets test became two quick ones, for `info_unconverted` and `instrument`. No test file was added, and the added time is milliseconds.
- Samples (`--sample`, agent `fixers-45`), all 100%: check-ui 150/150, mir-o2 150/150, mono-ui 100/100, run-pass-aux-miri 100/100, miri-hello 1/1. They were run twice, after part 2's first and last commits.
- Speed with logging off: `traits/monad.rs` and two others, base `26e61959` against head, 3 runs each. Equal within noise (monad: 1.06 to 1.11 s base, 1.02 to 1.03 s head).

## For root

1. **mono-ui and `RUSTC_LOG`.** `scripts/mono-run.ts` calls `compiler_entrypoint` without `init_rustc_env_logger`, so its subject ignores `RUSTC_LOG`. That is why it does not print the static-max warning. The fix belongs in a reviewed scripts batch: call it, as `rustc_driver_impl::main` does. Even then neither case can match. The oracle prints `rustc_codegen_ssa::base codegen_instance(..)` and `Post-codegen` statistics after collection, past the point where the mono subject stops. `log-backtrace.rs` would become UNPORTED there (backtrace).
2. **`scripts/lib/marker-check.ts`** could treat `unwrap_result`/`expect_result` as `unwrap`/`expect`, as `track_caller.ts` does. Then the `POLONIUS_ALGORITHM` anchor (`177:60` in `nll.ts`) could go back, and the location would print (tested).
3. Consider running `src/rust_ts/info_sites_check.ts` in the gate's marker step (0.3 s). New ports that drop an INFO site would then fail loudly.
4. `docs/next.md` and the `run-pass-aux-miri` notes: `rust-log.rs` no longer stops at `RUSTC_LOG`.
