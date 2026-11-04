# Handoff: lane `miri-tail-a` (configure_llvm / target_config, -C lto, -l, -Zrandomize-layout)

Branch `t3/port-miri-tail-stops`, on top of `1d221bff`. Commits, one per group:

| commit | group |
|---|---|
| 3357957e | `target_config` with `-C target-feature`, `-Z sanitizer`, accepted `-C llvm-args` |
| 6fda1d69 | `CrateInfo::new` with `-C lto` (`each_linked_rlib`, `ignored_for_lto`) |
| 34b2eb3f | `parse_native_lib` (`-l`) |
| 825f1948 | `-Zrandomize-layout` shuffle (vendor `rand_xoshiro`) |
| b5d17082 | explicit timeouts on the per-case oracle tests |

**Result: all 48 stopped cases of the brief MATCH; no stop moved to a later `unported`.** (27 + 3 + 1 + 14 + 2 + 1; the
27 include the one run-fail case.)

## Per group (cases MATCH of total, run-pass-miri unless noted)

| group | filter | MATCH |
|---|---|---|
| `-C target-feature` + `-Z sanitizer` | `tests/ui/sanitizer` | 24/24 (7 more skipped by the suite, `needs-sanitizer-support`) |
| same, run-fail | run-fail-miri `sanitizer` | 1/1 (17 skipped) |
| `-C target-feature` | `crt-static-off-works`, `export-executable-symbols`, `nofile-limit` | 3/3 |
| `-C llvm-args` | `alloc-error-backtrace`, `backtrace-debuginfo`, `issue-82833` | 3/3 |
| `-C lto` | `tests/ui/lto` | 7/7, 6 skipped (4 were stopped; the other 3 already matched at the gate) |
| `-C lto` | `issue-64655` | 15/15 (10 were stopped; the other 5 already matched at the gate) |
| `-l` | `lib-defaults`, `library-override` | 2/2 |
| `-Zrandomize-layout` | `layout/randomize` | 2/2 (`#randomize-layout` was stopped; `#normal` already matched) |

The two `-l` cases are MATCHes of Miri's own error: the oracle also exits 1 with `can't call foreign function
rust_dbg_extern_identity_u32`.

Under the machine's load (often over 100) the final group run timed some cases out (60 s limit). Every one was retried
alone. All MATCH on retry; `sanitizer/cfi/coroutine.rs#cfi` needed load to fall (three TIMEOUTs at load ~60, then MATCH
in 28.5 s at load ~30).

**`coroutine.rs#cfi` is the slowest here, about half the 60 s limit on an idle machine.** Root may see it time out in a
gate running alongside other lanes. Most of that is interpreting the `--test` binary: its non-LTO `#kcfi` revision takes
20 s.

## What each stop needed (nothing from LLVM is observable on these paths)

- **`-C target-feature`.** `global_llvm_features(sess, for_cfg = true)` skips it, so what LLVM answers is the default,
  which is the D4 table. Everything else is Rust: `target_features::internal_target_features` (already ported) and
  `update_target_reliable_float_cfg` (ported here into the stand-in; a test checks it equals the table on all 6 targets).
- **`-Z sanitizer`.** `sanitizer_features_by_flags` only adds a feature for hwaddress, so only that keeps the stop. The
  cases then needed `SanitizerSet` Debug and `target_modifier_consistency_check`, both ported here.
- **`-C llvm-args`.** Only LLVM's parser knows a value, so `ORACLE_ACCEPTED_LLVM_ARGS` lists the exact lists the oracle
  was seen to accept: `-enable-tail-merge=0` and `--inline-threshold=0`. Source: `rustc -Cllvm-args=<v> --print cfg`
  gives exit 0, no stderr, the same stdout as without it; `codegen_backend.oracle.test.ts` re-runs that per entry. Any
  other value **stays `unported`**, because an unknown value is LLVM's error and exit 1 (`-bogus` was checked).
- **`-C lto`.** A clean Miri run returns `Continue`, so the dummy backend reaches `CrateInfo::new`. It needs only
  `each_linked_rlib` and `ignored_for_lto`; no linking is reached.
- **`-C lto=thin`: a real port bug, fixed.** `CodegenBackend_provided.init` gave `thin_lto_supported: false`. Upstream's
  field is `thin_lto_supported: bool = true` and `derive(Default)` honours it. The bug made the Miri and dummy backends
  warn `ThinLTO is not supported by the codegen backend` and fall back to fat LTO. The fix also changes `Session::lto` for
  those backends: it no longer returns `No` early, so `-Copt-level>0` now gives `ThinLocal`, as upstream.
- **`-l`.** Plain parsing. `NativeLib` is built through `NativeLib_new_hook` (load order, as `CanonicalizedPath_new_hook`).
- **`-Zrandomize-layout`.** See below.

## Vendoring: rustc_abi links rand 0.9.3, scope.json holds rand 0.10.1

Upstream's lock gives rustc_abi `rand 0.9.3` and `rand_xoshiro 0.7.0` (on `rand_core 0.9.3`); Miri uses `rand 0.10.1`.
`harness/scope.json` `vendor` is keyed by crate name, so one version per crate, and changing that means changing
`scripts/coverage.ts`. What I did:

- `harness/scope.json`: **new vendor entry `"rand_xoshiro": "=0.7.0"`** (the one harness edit; PORTING §5b).
- `src/vendor/rand_xoshiro/`: `SplitMix64`, `Xoshiro128StarStar`, with upstream's tests and reference vectors.
- `shuffle`, `partial_shuffle` and `IncreasingUniform` went into the vendored rand with `rand-0.10.1` markers. I diffed
  the code against 0.9.3: `seq/increasing_uniform.rs`, the two methods and `distr/uniform_int.rs` differ only in trait
  names, comments and `simd_support` bounds.
- The rand_core **0.9.3** helpers rand_xoshiro calls (`fill_bytes_via_next`, `next_u64_via_u32`, `read_u32_into`,
  `read_u64_into`) are in `rand_xoshiro/common.ts` with no `crate:` marker; each comment names its 0.9.3 file and line.
  0.10.1's `fill_bytes_via_next_word` handles the remainder differently, so I did not reuse it.

Oracle values, two independent ones:

- `src/vendor/rand_xoshiro/shuffle.oracle.txt`: output of the probe in `docs/handoff/miri-tail-a-probe/`, built from the
  real rand 0.9.3 and rand_xoshiro 0.7.0 through upstream's `Cargo.lock`. 8 seeds, RNG streams, permutations up to length
  70000. The port reproduces every line, which is also the check that 0.10.1's shuffle draws what 0.9.3's does.
- `src/rustc_abi/randomize_layout.oracle.test.ts`: `#[rustc_dump_layout(debug)]` stderr on real types (structs, an
  unsized tail, repr(C), an enum, a tuple) equals the oracle at 6 seed settings, including `u64::MAX` and no seed.

The existing write-back of `optimizing` sat in the sort branch only, so the shuffled copy would have been dropped. The
shuffle branch now writes it back too.

## Checks

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24402; vendor 5076; library 584)` |
| `difftest --suite mir --sample 200` | MATCH 200/200 |
| `difftest --suite check-ui --sample 200` | MATCH 200/200 |
| `difftest --suite pm-ui --sample 200` | MATCH 197, UNPORTED 1, UNSTABLE 2 (`20261103-232428-miri-tail-a-1wz7`) |
| `difftest --suite run-pass-miri --sample 200` | MATCH 187, TIMEOUT 13; the 13 then MATCH alone (`20261103-235344-miri-tail-a-mr6u`) |
| `bun test` on the touched crates (`src/rustc_abi`, `rustc_session`, `rustc_codegen_ssa`, `rustc_target`, `vendor/rand*`, `codegen_backend.oracle`) | 244 pass, 0 fail with `--timeout 120000` |
| `bun test harness` | 25 pass, **1 fail, not from this lane** (below) |

- `pm-ui`: the three non-matches (`proc-macro/expand-expr.rs`, `load-panic-backtrace.rs`,
  `resolve/proc_macro_generated_packed.rs`) have the same status in gate `gate-20261102-174727-root-kxpt`.
- `run-pass-miri` TIMEOUTs: all 13 are protected and MATCH at the gate. I checked for a regression rather than assume
  load: one case's CPU is equal at base and HEAD (12.7 s and 12.4 s vs 13.2 s and 12.0 s, user + sys), two of four
  compared cases have status TIMEOUT at base as well (`20261104-002311-miri-tail-a-i0e5`,
  `20261104-003403-miri-tail-a-yj0f`), and `Session::lto` still returns `No` at the default opt level. The sample ran on
  825f1948; b5d17082 changes only test timeouts.
- Unit tests at the default 5 s limit, at load ~130: 151 pass, 93 fail, every failure `timed out`, none an assertion.
  All pass with the longer limit. Not a full `bun test ./src`, per the lane rules; root's gate runs that.

## For root

1. **`harness/compiletest.test.ts` "a failed aux build is an ERROR ..." fails**, and fails the same way at base
   `1d221bff` in a clean temporary worktree, so this lane did not cause it. Nothing in the test reads
   `harness/scope.json`. I did not find the cause. The gate's `scripts`/`harness` step will hit it if it reproduces there.
2. Files edited outside the brief's list, because the stops live there or moved there:
   `src/rust_ts/codegen_backend.ts` and its test (the `rustc_codegen_llvm` stand-in, where the configure_llvm and
   target_config stops are; `rustc_codegen_llvm` itself is out of scope and `src/rustc_codegen_llvm` does not exist),
   `src/rustc_interface/stand_ins.ts` (one-word `thin_lto_supported` fix), `src/rustc_target/stand_ins.ts` (removed the
   dead unported `debug_SanitizerSet` and its imports), and vendor `rand` (`seq/`).
3. Not edited, for whoever owns them:
   - `src/rustc_metadata/native_libs.ts:6`: the comment still says `parse_native_lib` is unported.
   - `src/rustc_driver_impl/print.oracle.test.ts:184,187`: the `pending` entries for `-Ctarget-feature=+bogus` and
     `-Zsanitizer=memory` now reach the "matches exactly" arm; they pass and could become `exact`.
4. Worth recording as decisions: `ORACLE_ACCEPTED_LLVM_ARGS` as an exact-list allowlist; `shuffle` from rand 0.10.1 with
   the 0.9.3 probe as evidence. `tools/probes` has no registered probe for this fixture, same as vendor-rand's queued
   `randstream`; a harness batch could register `docs/handoff/miri-tail-a-probe/`.
5. rustc_abi layout edit is 4 lines plus 2 imports, in `layout_of_univariant_biased`, so miri-perf should merge cleanly.

## `unported(...)` left on these paths

| stop | why |
|---|---|
| `configure_llvm (-C llvm-args)` for any other value | LLVM's parser decides what a value does; it can print and exit |
| `configure_llvm` / `target_config (-C target-cpu)`, `(-Z llvm-target-feature)`, `(-Z retpoline)`, `(-Z fixed-x18)`, wasm exception handling | they change the CPU or feature string LLVM gets, and the table has only the defaults |
| `target_config (-Z sanitizer)` for hwaddress only | `+tagged-globals` changes the feature string; no case needs it |
| `-Z llvm-plugins`, `-Z time-llvm-passes`, `-Z print-llvm-passes`, `-Z print-codegen-stats`, `-Z autodiff`, `-Z small-data-threshold` (LLVM arg) | unchanged |
| `target_config (no oracle table for <tuple>)` | unchanged |
| `link_binary` and the rest of back/link.rs | M7; `each_linked_rlib`'s path reaches none of it |

None added. Removed: the five stops named in the brief for these values, `SanitizerSet Debug`, and the four
`target_modifier_consistency_check` stops.

## Coverage

| upstream file | ported |
|---|---|
| rustc_session config/native_libs.rs | 5/5 |
| rustc_session options.rs | 100/100 |
| rustc_codegen_ssa target_features.rs | 11/11 |
| rustc_codegen_ssa back/link.rs | 7/87 (`each_linked_rlib`, `ignored_for_lto` added; the rest M7) |
| rand_xoshiro-0.7.0 | 17/139 (the two generators; the others are unused) |
| rand-0.10.1 seq/increasing_uniform.rs, seq/slice.rs | 4/4, 9/31 |

`rustc_codegen_llvm` has no markers (excluded by scope.json): the stand-in's functions name their llvm_util.rs line.

## `// PORT:` decisions

- `target_config`: the table stands in for `mc_subtarget_info.has_features`. It is closed under `implied_target_features`,
  so expanding it gives the same set.
- `update_target_reliable_float_cfg`: the `match` arms are an if-chain in the same order; `(X86_64 | RiscV64 |
  LoongArch64, _)` and `_` are both `false` for `has_reliable_f16b` and are one arm.
- `parse_and_apply_modifier`: `split_at_checked(1)` is a check of the first char, since every other result takes the same
  fatal arm. `assign_modifier` returns the value instead of taking `&mut Option<bool>`.
- `partial_shuffle` returns copies, not views; `shuffle` ignores them.
- rand_xoshiro generators implement the vendored rand_core 0.10.1 `Rng`, whose three methods are 0.9.3's `RngCore`.
- `debug_SanitizerSet` in `rustc_session/stand_ins.ts` casts, because the stand-in `SanitizerSet` is a plain number.
