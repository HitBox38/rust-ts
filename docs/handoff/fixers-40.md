# fixers-40: port-side queue from wave 39's reviews

Branch `fixers-40`, head `6619a443`, on `1adcee8e`. No gate or full protected suite run.

## Items

1. Done, `db43206f`: `abi-vtable` F1. A `TraitVPtr` slot now prints the block it points at, in the probe and in `run.ts`; fixture regenerated from the oracle; `tcx.vtable_allocation([ty, undefined])` in the `TraitVPtr` arm now fails `vtable_static`.
2. Done, `605edabb`: `integ-w39-b1` F1 and N3. `start_codegen` drops `metadata` on any unwind while it owns it, `codegen_and_build_linker` until the `Linker` owns it, and `run_compiler` drops a `Linker` that never reaches `link`. All five of the review's rows leave no `rmeta*`, as the oracle; `-C save-temps` still keeps it.
3. Done, `775991c0`: `m6-audit`. `ensure_stack` re-execs through `/bin/sh`, which added `PWD`; the re-exec'd process now restores `PWD`, `OLDPWD` and `SHLVL`. `decode_EiiMapEncodedKeyValue` is ported over the generated decoders, so no `tools/codegen` entry is needed.
4. Done, `df702572`: `rustc_lint/builtin.ts` uses `bytes_u64()`; `short_string_namespace`'s long-type file is ported. F3 confirmed as a loud stop: `fn(H1)` with `H1([u8; 1 << 60])` exits 70 at `rustc_abi::Size beyond 2^53`, where the oracle prints the dump. Left as asked.
5. **Not done: needs a generator, for a tools batch** (spec below). A throwaway prototype, reverted, shows the effect.
6. Done, `ecc69f9b` and `6619a443`: W2, W3, `abi-vtable` F2, `mir-alias` F2 and F4. Three named mutations are equivalent, so no fixture can kill them (below). The second commit only made the overlap program `no_core`, for the budget.
7. Done, `fc41b62b`, except where noted: `integ-w39-recheck` N1; `integ-w39-b1` N2; `abi-vtable` N1; `miri-perf` N1-N4. **Not done:** re-check N2-N6 and `miri-perf` N5, which are in `harness/`, `scripts/` and `docs/handoff/miri-perf.md`, outside this lane's files. N3 of `integ-w39-b1` went with item 2.

## Cases that moved from a stop to a MATCH

`run-pass-aux-miri`, full suite: 338 MATCH, 1 CRASH, 17 UNPORTED before; **355 MATCH, 1 UNPORTED** now. All 16 `tests/ui/eii/` stops and `tests/ui/compiletest-self-test/rustc-env.rs` moved. The one left is `tests/ui/rustc-env/rust-log.rs` (`RUSTC_LOG` directive, unrelated).

Long-type: 29 of the 33 `tests/ui` programs with `-Zwrite-long-types-to-disk=yes` are byte-identical to the oracle, stderr and file contents, digits of the hash aside. That was a scratch script with `-Zui-testing --emit=metadata`, not a suite: `harness/suites.ts` skips such cases, as the hash can never match. **The other 4 have revisions and I did not run them:** `diagnostic-width/long-E0308.rs`, `diagnostic-width/E0271.rs`, `associated-types/long-type-E0308.rs`, `error-codes/E0275.rs`.

## Results

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `coverage.ts --check --offline` | markers ok |
| `coverage.ts --missing` | `ty/error.rs` 8/8, `queries.rs` 2/2, `decoder.rs` 156/156, `builtin.rs` 78/78; `passes.rs` lists `print_macro_stats` first, which this lane did not touch |
| `bun test` on what I touched | 880 pass, 0 fail (`stack`, `rustc_interface`, `rustc_driver_impl`, `rustc_lint`, `rustc_middle/ty`, `rustc_metadata`, `rustc_monomorphize`, `callconv`, `alias_check`); partitioning rerun after the last commit, 66 pass. `git status` clean afterwards. `src/rustc_errors` was not rerun: nothing there changed |

`--sample 100`, seed `fixers-40`, run before the last commit, which changes only a fixture program:

| Suite | MATCH | Other |
|---|---|---|
| `miri-hello` | 1/1 | |
| `run-pass-miri` | 100/100 | |
| `mir` | 100/100 | |
| `mono-ui` | 100/100 | |
| `check-ui` | 100/100 | |
| `run-fail-miri` | 100/100 | |
| `miri-fail` | 99/100 | 1 UNPORTED: `tests/fail/erroneous_const2.rs`, E0080's description, item 5's stop |

## Unit-time budget: at the limit

Added CPU, user + sys, measured at load 14-33 since two other lanes were running: `metadata_temp_dir` about 2.1 s, `long_type` about 1.3 s, `overlap` case about 1.6 s, `stack` and `abi.rs` about 0.1 s each. That is **about 5 s under load, with `bun test`'s own startup removed by estimate**, and less on a quiet host, where I measured about 1.1 s per spawned compile but not the total. There is no room left in `plan-m7` F5's 5 s. To stay inside it I already dropped a third `metadata_temp_dir` case: the `-Zprint-type-sizes` and `-Zoffload` exits pass through the same `catch` and were checked by hand.

## Item 5: the tools batch

- **Upstream:** `define_error_code_constants_and_diagnostics_table!` (`rustc_errors/src/codes.rs:28`), one `include_str!` per code: 518 files, 418,411 bytes.
- **Why a generator:** a read at run time would fail in the `--compile` bundle (`docs/reviews/mono-wire.md`, D14), one static import per file costs every startup, and PORTING section 6 says generated data comes from `tools/`.
- **Generator:** extend `tools/codegen/error_codes.ts`, whose header says the text is not embedded, to write the text next to `error_codes.gen.ts`, as a module of its own.
- **Port side, small, for a lane after that:** `ErrCodeDescription.text()` in `src/rustc_errors/codes.ts` loads that module with a lazy `require` and returns the text. Then remove the three `EXPECTED_UNPORTED` rows of `src/rustc_errors/json.oracle.test.ts` (`unterm_str.rs`, `blockcomment.rs`, `doccomment.rs`), which fail once the stop goes, and correct the size in the headers: they say about 1.3 MB.
- **Measured with a prototype that read the checkout, reverted:** `miri-fail` full suite 608/610; the 2 left are `open_file_or_dir`. The three `json.oracle.test.ts` rows were the only failures in that file.
- `--explain` is a separate stop (`handle_explain`, `rustc_driver_impl/lib.ts:447`).

## Equivalent mutations, so not killed

Each named by a review as surviving; each is unobservable, not a test gap.

- **`partitioning.ts`, `consumed_cgu_names` truncated (W3).** A merge's destination is in the top N and only grows, and the tail never grows, so a CGU in the top N never returns to the tail. A source has therefore never consumed another CGU and holds one name.
- **`partitioning.ts`, overlap counting non-inlined items (W3).** `instantiation_mode` is one value per item: a root is `GloballyShared`, is placed in one CGU and is never a reachable inlined item. So `!inlined` in the source implies absent from the destination. I first tried `#[lang = "start"]`, which the comment in `place_mono_items` suggests is an exception, and at the pin it is not: it is `GloballyShared` (`is_entrypoint`).
- **Evidence for both:** a scratch throw on either condition fired on none of the 66 cases. That and the reasoning are the evidence; there is no proof beyond them.
- **`aarch64.ts:96,127`, the `is_scalable_vector` guards (F2).** `SimdScalableVector` is non-aggregate and non-scalar, so the next branch's `extend_integer_width_to` and `softfloat_float_abi` do nothing to it. Removing either guard leaves the fixture green. The dump (`CScalable`) is still pinned. The softfloat half is by reading (it acts only on `Scalar` and `ScalarPair`); softfloat itself was not run.

Killed, each run: `-Zcodegen-source-order` reversed; overlap counting items rather than size; the vector-size limit on both sides; `pass_indirectly_in_non_rustic_abis` removed; the long-type dedup; `F4`'s two; all 6 of F2's walker tests fail on the old walker.

## `// PORT:` decisions

- `ty/error.ts`, `short_string_namespace`: upstream hashes `t`, which for interned values is an address, so the oracle's own name changes per run. The port hashes the type's text with `Bun.hash`. Two different types with the same text would share a file here and not upstream; only the file's name and line count could show it. **Root may want to look at this one**, as PORTING says never to guess; no value can be right here.
- `rust_ts/stack.ts`, `SHELL_VARS`: the values cross the shell in `RUST_TS_SHELL_ENV`, removed on arrival.
- `rustc_interface/queries.ts`, `Linker.drop`; `passes.ts`; `rustc_driver_impl/lib.ts`: explicit drops for Rust's unwinding drops.

## New files that are not ports

`src/rust_ts/stack_env_driver.ts`, `src/rustc_interface/metadata_temp_dir.test.ts`, `src/rustc_middle/ty/long_type.oracle.test.ts` with `long_type_oracle/`, `src/rustc_mir_transform/alias_check_oracle/sweep_outcome.ts`, `src/rustc_monomorphize/partitioning_oracle/programs/overlap.rs` with its two oracle files.

`unported(...)` left by this lane: none. Removed: `EiiMapEncodedKeyValue`, `short_string_namespace`.

## Noticed, not done

- **The shell also rebuilds `environ`'s order,** and `RUST_TS_JS_STACK` and `BUN_JSC_maxPerThreadStackUsage` stay visible. `option_env!` of those two, or `env::vars()` under Miri with isolation off (`miri.ts` `vars_os`), differs from the oracle. Only `PWD`, `OLDPWD` and `SHLVL` are restored. Bash specifics only: on Linux, `dash` may change other variables, not tested.
- **`mir-alias` F2's walker now reads frozen objects:** 120 sweep runs on 40 `tests/mir-opt` programs (`o0`, `o2`, `mono`) gave 0 hits, and 4 `FAILED` where F4's fix now says so. It still cannot see accessors or `#private` fields; the header says so.
- `alias_check.ts` now imports `rustc_middle/ty/list.ts`, for `RawList`. No load-order problem in the tests that ran.
- `metadata_temp_dir.test.ts` depends on `-Zmetrics-dir` staying unported: the test will need another exit once it is ported.
- The first `difftest --only` I ran, a flag that does not exist, ran the whole of `run-pass-aux-miri` under agent `root`: run `20261105-231431-root-cru0` in `$RUST_TS_DATA/runs`, harmless, and it is the "before" figure above.
