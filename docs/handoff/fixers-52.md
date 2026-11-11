# Handoff: lane `fixers-52` (wave 40l), queued review findings in `src/`

Branch `t3/fixer-review-findings`, from `b3772ebb`. Commits:

| commit | items |
|---|---|
| `c9919f48` | stats N1, N3, N4, the shared `{:.1}` (stats N2) |
| `64ed2861` | driver-cli-2 N1, N2, N4, N5 |
| `fcf84a2b` | ssa-contract N2, N4 |
| `3305280b` | fixers-51 N2, N4 |

No `harness/`, `scripts/` or `tools/` file touched. No STOP was open.

## Items

### 1. stats review (`docs/reviews/stats.md`)

- **N1** `src/rustc_passes/input_stats.ts`: `print_hir_stats` (:63) and `print_ast_stats` (:71) now come just before
  `class StatCollector`, which holds both the struct (:57) and its `impl` (:81), so the fns are in upstream order. A PORT
  note in the header says so.
  - Test: `bun scripts/coverage.ts --order --require-clean src/rustc_passes/input_stats.ts`. On the old file it gives
    `ERROR: ... out of upstream's order (2 of 72); first print_hir_stats:63 after print:119`. Now it reports no
    inversions.
- **N3** `src/rustc_passes/input_stats_sizes.oracle.test.ts`: the staleness test first asserts that
  `probeBinary("nodesizes")` exists, so `probePath`'s `die` is never reached.
  - Test: run with `RUST_TS_DATA=<empty dir> RUST_TS_REQUIRE_PROBES=1`. Now: 3 pass, 1 fail.
  - Mutation (assertion removed): the process stops after `ERROR: probe 'nodesizes' not built`, with no summary and
    no later tests run.
- **N4** "every size is a non-negative integer": the check is an `is_size` helper (`Number.isInteger(v) && v >= 0`).
  It has its own test: 0, 1 and 88 are sizes; -1, 0.5 and NaN are not.
  - Mutation (`> 0`): that test fails.
- **Shared `{:.1}`**: `f64_fixed1` now lives in `src/std/fmt.ts` only, with
  `// std: library/core/src/fmt/float.rs:36 float_to_decimal_common_exact`.
  - The copies in `rustc_data_structures/thousands/mod.ts` (exported there) and `rustc_middle/ty/context.ts` (private)
    are deleted.
  - `thousands/mod.ts`, `ty/context.ts`, `rustc_passes/input_stats.ts` and `rustc_metadata/rmeta/encoder.ts` import it
    from std. `encoder.ts` is one more file than the brief names; it imported the thousands copy.
  - The tie test moved from `thousands/tests.test.ts` to `src/std/fmt.test.ts`, with more oracle values: NaN, ±inf,
    ±5e-324, `f64::MAX`/`MIN`, 2^52 - 0.5, 2^53 + 1, values that round to ±0, and 99.95 → `100.0`.
    Mutation (ties round up instead of to even): the test fails.
  - Re-run of the 44,963-value agreement, on a fresh sample: a Rust program built with the oracle
    (`rustc +nightly`, 6f5da406b) prints `{:.1}` and `{:4.1}` of 16,779 values. These are hand-picked ties and edge
    values, `m*100/n` for 18 values of `n`, and 15,000 xorshift values (bit patterns, ratios, multiples of 1/16).
    **16,779 agree, 0 differ.** The program and checker are in my scratchpad, not committed.

### 2. driver-cli-2 review (`docs/reviews/driver-cli-2.md`)

- **N1** `src/rustc_interface/metadata_temp_dir.test.ts`: test 2 now expects
  `rust-ts: unported: rustc_query_impl::incremental::verify_query_key_hashes`.
  - Mutation (that `unported` string renamed in `rustc_query_impl/incremental.ts`): test 2 fails. Reverted.
- **N2** `leftovers(sub)` lists `rmeta*` directly in the test's own output dir: `.` for `-o -`, `d2`, `d3`.
  - Mutation (`built_linker?.drop()` commented out in `rustc_driver_impl/lib.ts`): only test 2 fails; test 3 now
    passes. Under the review's mutation both failed. Reverted.
- **N4** The duplicate helpers now use `src/std`. In detail:
  - `src/std/num.ts` gains:
    - `u8_from_str` and `u64_from_str` (`bigint`, its own `from_ascii_bytes_radix_impl_u64`);
    - `usize_from_str`: parses as `u64`, then a `number`. Same PORT as before: values above 2^53 round.
    - `nonzero_u32_from_str`, `nonzero_u64_from_str` and `nonzero_usize_from_str`;
    - `display_ParseIntError` (`// std: library/core/src/num/error.rs:138 fmt`; the unstable `NotAPowerOfTwo` is not
      modelled, since `from_str` never makes it).
  - `rustc_session/options.ts`: its `IntErrorKind`, `uint_from_str` and five `*_from_str` are deleted. It re-exports
    std's for `options.gen.ts`, which imports them from options.ts; the generator was not touched.
    `parse_number`/`parse_opt_number` take `Result<T, ParseIntError>`. `parse_treat_err_as_bug` reads `err.kind`.
  - Same semantics, different error shape: those helpers returned a bare `IntErrorKind` string; std returns
    `{ kind }`. Callers that read the kind now read `.kind`:
    - `rustc_attr_parsing` `attributes/util.ts` (`parse_limit_int`) and `attributes/stability.ts`;
    - `diagnostics.ts` (type import);
    - `miri/bin/miri.ts`, whose local `display_ParseIntError` and `nonzero_u64_from_str` are gone.
  - `rustc_abi/lib.ts`: its `ParseIntError` (a bare kind), `display_ParseIntError`, `parse_uint` and `parse_u32` are
    deleted, and it uses std's. Results are the same:
    - a lone `+`/`-` is `InvalidDigit`;
    - `""` is `Empty`;
    - a non-digit before overflow is `InvalidDigit`;
    - overflow is reported at the first digit that exceeds the max.

    `parse_u64` stays as a two-line wrapper: std's u64 gives a `bigint`, and the bit counts here are `number`s (its
    PORT note is kept). `rustc_session/diagnostics.ts`'s `ParseIntError` (AppleDeploymentTarget) is now std's.
  - `rustc_target/spec/base/apple/mod.ts`: its `parse_uint(s, 0xffff | 0xff)` is std's `u16_from_str`/`u8_from_str`.
    Same results.
  - `rustc_attr_parsing/attributes/util.ts` `u16_parse`: was `u32` parse then `> 0xffff`. Now std's `u16_from_str`
    (`.ok()`). Same `Some`/`None`.
  - `str::trim` copies → `src/std/str.ts` `string_trim` (and `string_trim_start`, `string_trim_end`):
    - `rustc_errors/lib.ts` `str_trim` (exported; its importers `emitter.ts`, `annotate_snippet_emitter_writer.ts`,
      `rustc_hir_typeck/method/suggest.ts` and `rustc_attr_parsing/attributes/link_attrs.ts` were repointed);
    - `rustc_ast/util/comments.ts` (`str_trim`, `str_trim_start`), `rustc_middle/mir/pretty.ts`,
      `rustc_resolve/rustdoc.ts`, `rustc_parse/parser/expr/diagnostics.ts`,
      `rustc_attr_parsing/attributes/rustc_internal.ts`;
    - and `method/suggest.ts`'s own `string_trim`/`string_trim_end`, which shadowed the std names.

    The copies worked on code points, std works on UTF-16 units. They give the same cut: every `White_Space` char is
    in the BMP, and a surrogate half is never whitespace. The one difference: `comments.ts`'s end trim could drop a
    *lone* low surrogate after whitespace. A Rust `&str` cannot hold one, so no input can show it.
  - Test: `src/std/num.test.ts` gains a table printed by a Rust program built with the oracle. For 28 inputs it gives
    `u8`, `u64`, `NonZero<u32>`, `NonZero<u64>` and `NonZero<usize>` parses, plus `ParseIntError`'s `Display`.
    `NonZero<usize>` over 2^53 is compared after the documented rounding.
    - Mutation (`nonzero_u64_from_str` loses its `Zero`): the test fails.
  - Not in the review's list and left alone, with the reason for each:
    - `rustc_driver_impl/lib.ts:422` `parse_isize`: std has no signed parse.
    - `vendor/jobserver/unix.ts` (i32): vendor code.
    - `proc_macro/lib.ts:1989` and `rustc_ast/util/literal.ts:569`: radix and signed parses std does not have.
    - `rustc_session/config.ts` still imports `u8_from_str`/`usize_from_str` from options.ts, which re-exports std's.
- **N5** `rustc_feature/unstable.ts` `dump_feature_usage_metrics` now models upstream's
  `serde_json::to_writer(BufWriter::new(file), &usage)?`.
  - `serde_json_tokens`: the `write_all` calls serde_json 1.0.145's `CompactFormatter` makes, checked against its
    `ser.rs`. That is `{`, `"`/key/`"`, `:`, `,`, `[`, `]`, `null`, an integer, and in a string the runs and each
    escape as separate writes.
  - `metrics_writer`: `BufWriter` (8 KiB): `write_all` → `write_all_cold`, `flush_buf` with its guard, and `Drop` (a
    flush that ignores its error). A write error is returned only once the JSON outgrows the buffer. For JSON of at
    most 8 KiB, the error is lost, as upstream.
  - Test: `src/rustc_feature/unstable.test.ts`, 4 tests:
    - the token text and split;
    - EIO at 66, 8191 and 8192 bytes gives `Ok`, with one write attempted by the drop;
    - EIO at 8193 and 20000 bytes gives `Err(Os 5)`;
    - every byte arrives in order through 1000-byte short writes.

    Mutation (the drop's flush error propagated): the ≤ 8 KiB test fails.
  - End to end: `-Zmetrics-dir` on a 4-feature crate gives the same JSON as the oracle once timestamps are masked.
    `metadata_temp_dir.test.ts` (the missing-dir error) still passes.
- **N6** (handoff only, a tools change for a later batch): `tools/codegen/options.ts:1417` `genTargetModifierCodecs`
  accepts any number of `String` / `OptionsTargetModifiers` fields and emits `new TargetModifier(f1, …, fn)`. A field
  added upstream is caught only by `tsc` (constructor arity). Suggested fix: require exactly the fields of the
  hand-written `TargetModifier` class, in its order, and print an `ERROR:` otherwise.

### 3. ssa-contract review (`docs/reviews/ssa-contract.md`)

- **N2** `src/rustc_codegen_ssa/mir/mod.ts`: the companion const `IntrinsicResult` with
  `WroteIntoPlace: Object.freeze({ $: "WroteIntoPlace" })`, as `OperandValue.ZeroSized`. Test:
  `mir/mod.test.ts` (the value, its type as `IntrinsicResult<number>`, frozen).
  - Mutation (no `Object.freeze`): the test fails.
- **N4** `src/rustc_session/session.ts`:
  - New types, with `rustc-type:` markers:
    - `PointerAuthARM8_3Key` (+ `_discriminant`, upstream's `= 0..3`);
    - `PointerAuthDiscrimination`;
    - `PointerAuthAddressDiscriminator` (`Synthetic(u64)` as `bigint`);
    - `PointerAuthSchema` and `PointerAuthConfig`, with all fields and doc comments.
  - `Session.pointer_auth_config` is now `PointerAuthConfig | undefined`, no longer `unknown`.
  - `Session::pointer_authentication` (:1267), `pointer_authentication_functions` (:1271) and
    `pointer_authentication_init_fini` (:1275) are ported. session.rs is now 89/104 (was 86).
  - `rustc_codegen_ssa/common.ts` `build_langcall` calls `tcx.sess.pointer_authentication_functions()`. The local
    stand-in and the `PointerAuthSchema = never` alias in `traits/misc.ts` are deleted. `traits/misc.ts` and
    `traits/consts.ts` import the type from rustc_session, as upstream's `use rustc_session::PointerAuthSchema`.
  - Test: `src/rustc_session/session_pointer_auth.test.ts`. It calls the three accessors on no config, a config with
    both schemas, and a config with neither.
    - Mutation (init_fini returning `function_pointers`): the test fails.
  - Not ported: the constructors (`function_pointers_default`, `init_fini_default`, `PointerAuthConfig::default`,
    `calculate_pauth_abi_version`, `from_raw`, session.rs:125-231). Only `from_raw` reaches them, and `build_session`
    still stops before it for a `CfgAbi::Pauthtest` target (`unported("...PointerAuthConfig::from_raw (pauthtest
    target)")`, unchanged). Every other target has no config. Porting them would only move that stop. A note on each
    type says so.

### 4. fixers-51 review (`docs/reviews/fixers-51.md`)

- **N2** `src/std/thread.c`, the -3 path: upstream's `assert_eq!(n, EINVAL)` panics while the DropGuard is live. If
  the guard's `pthread_attr_destroy` assertion then fails while unwinding, upstream aborts.
  - `pthread_attr_destroy`'s result is now checked. A failure there is its own code,
    `RTS_SPAWN_SETSTACKSIZE_THEN_DESTROY_FAILED` (-5), which `thread.ts` `spawn_error` names in the `unported` stop
    every RTS_SPAWN code ends in. Before, the result was ignored.
  - No supported host can drive the C path: setstacksize fails only with EINVAL, and destroy does not fail. The test
    (`thread.test.ts`) therefore checks the mapping of -3, -4 and -5. Without the fix, -5 would read as
    `pthread_create failed: errno -5`.
  - `thread.c` recompiles under the existing tests: thread and mpsc, 12 pass.
- **N3**: skipped, as briefed (handoff wording only).
- **N4**: removed the double blank lines at `rustc_borrowck/region_infer/graphviz.ts:32` and
  `rustc_data_structures/obligation_forest/mod.ts:853`. I counted double blank lines in every file this lane touched
  against `b3772ebb`: none new, and those two gone.

## Evidence

| check | result |
|---|---|
| `bun test ./src/std/result.test.ts` | 3 pass, 0 fail |
| unit tests of the touched crates (see below) | 667 pass, 0 fail (64 files) |
| `check-ui --sample 200 --jobs 6` (`RUST_TS_AGENT=fixers-52`) | 200/200 MATCH (`runs/20261111-212106-fixers-52-myn0`) |
| `rmeta-ui --sample 200 --jobs 6` | 200/200 MATCH (`runs/20261111-212218-fixers-52-91bs`) |
| `mir --sample 200 --jobs 6` | 200/200 MATCH, 1 skipped (`runs/20261111-212333-fixers-52-6e54`) |
| stats flags vs the oracle: 20 check-ui crates (every 36th from a fixed offset) × `-Zinput-stats`, `-Zmeta-stats`, `-Zmacro-stats`; stdout, stderr, exit and rmeta bytes, run from my scratchpad with absolute input paths (no `stats-ui` suite exists yet) | **60/60 MATCH**. The oracle side printed 1,925 stats lines (input 1,061 / meta 741 / macro 123). One meta-stats crate printed none on either side. Sensitivity: with `f64_fixed1`'s last digit off by one, the same check gives 42 DIFF. |
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check` | markers ok (25,789) |
| `--order --require-clean src/rustc_passes/input_stats.ts` | no inversions |

Unit tests: `src/std`, `rustc_feature`, `rustc_session`, `rustc_codegen_ssa/{common.test.ts,mir}`,
`rustc_interface/metadata_temp_dir.test.ts`, `rustc_passes`, `rustc_data_structures/{thousands,obligation_forest}`,
`rustc_attr_parsing`, `rustc_target`, `rustc_abi`, `rustc_errors`, `rustc_ast/util`, `miri/bin/miri.test.ts`: 667 pass,
0 fail, on the final tree.

## Coverage (`bun scripts/coverage.ts --missing`)

- input_stats.rs 72/72; thousands/mod.rs 4/4; options.rs 100/100; unstable.rs 12/12; common.rs (codegen_ssa) 7/7;
  rustc_abi lib.rs 157/157.
- session.rs 89/104 (+3). Its missing pointer-auth fns are explained above; the rest are other lanes'.
- New `// std:` markers:
  - fmt/float.rs:36;
  - num/mod.rs:1645 (u8, u64, usize) and :1788 (the u64 impl);
  - num/nonzero.rs:1612 (×3);
  - num/error.rs:138.

## `unported(...)` left

- None added. The one removed: `rustc_session::Session::pointer_authentication_functions (PointerAuthConfig)` in
  codegen_ssa common.ts (now the real accessor).
- The Pauthtest stop in `build_session` and in `validate_commandline_args_with_session_available` are unchanged.

## `// PORT:` decisions

1. `f64_fixed1` (std): only precision 1 is modelled, as exact `round(v * 10)` (ties to even) instead of
   `format_exact`'s digit loop. The two are observably identical, and the result is oracle-checked.
2. `usize_from_str` (std): parses as `u64`, then a `number` (> 2^53 rounds). Moved unchanged from options.ts.
3. `display_ParseIntError` (std): `NotAPowerOfTwo` is not modelled.
4. `metrics_writer` / `serde_json_tokens` (rustc_feature): a model of `BufWriter` + serde_json's write sequence, so a
   write error surfaces exactly when upstream's would.
5. `PointerAuthSchema`/`PointerAuthConfig`: types only. The constructors stay unported (unreachable behind the
   `build_session` stop).
6. `thread.c` -5: a double failure on the -3 path is a distinct stop (upstream aborts) instead of ignoring destroy.
7. `input_stats.ts`: the entry points sit before `class StatCollector` (struct + impl in one class).

## For root

- File ownership: besides the files the four reviews name, the N4 sweep also touched these (each only to repoint an
  import, a `.kind` read, or a deleted duplicate):
  - rustc_metadata `rmeta/encoder.ts`;
  - rustc_errors `emitter.ts`, `annotate_snippet_emitter_writer.ts`;
  - rustc_hir_typeck `method/suggest.ts`;
  - rustc_attr_parsing `link_attrs.ts`, `stability.ts`, `util.ts`, `diagnostics.ts`;
  - rustc_target `spec/base/apple/mod.ts`;
  - rustc_session `diagnostics.ts`;
  - `miri/bin/miri.ts`;
  - rustc_codegen_ssa `traits/consts.ts`.
- New test files:
  - `src/rustc_feature/unstable.test.ts`;
  - `src/rustc_codegen_ssa/mir/mod.test.ts`;
  - `src/rustc_session/session_pointer_auth.test.ts`.
- No protected suite runs `-Z*-stats` or `-Zmetrics-dir` with a write error, so the gate should show no change from
  this lane.
