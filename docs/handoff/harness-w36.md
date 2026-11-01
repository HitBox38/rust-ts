# Handoff: harness-w36 (harness batch, M6 wave 36; needs an independent review)

Branch `t3/harness-w36-batch`, from `integ-w36` (`0b118d0b`, merged first as the lane asked: a fast-forward). Harness and
scripts only: no port code under `src/` changed, so there are no coverage changes of ported code, `// rustc:` markers,
`unported(...)` calls or `// PORT:` decisions. No baseline, oracle output, protected suite, existing oracle cache key
or runner of a protected suite changed (dump below).

## Files touched

| file | item | change |
|---|---|---|
| `harness/suites.ts` | 1 | `pinProcMacroEnv`: variables a proc macro's aux sources read by string literal (`env_var` / `var` / `var_os`) and the case does not set are unset in `Case.env` (both sides, oracle key); applied in `pmCorpus` |
| `harness/compiletest.ts` | 2 | `uiFileCases(.., { needs: true })`: needs.rs `handle_needs` / `prepare_needs_conditions` for COMPILETEST_TARGET (`needsCfg`, `needsDecision`); `TargetCfg` gains `sanitizers`, `xray`, `relocationModel`, `panic` |
| `harness/suites.ts` | 2 | `needs: true` for `runCorpus` (Miri suites) and `pmCorpus` (pm suites) only; `MIRI_HEAVY` +2; `MIRI_ORACLE_NO_FINISH` (1 case skipped) |
| `harness/suites.ts` | 3 | `MIRI_SUBJECT_ENTRY = MIRI_DRIVER_ENTRY`; `miriSubjectOf(entry, args)` (both branches testable), `RUSTC_DRIVER_ENTRY` |
| `harness/suites.ts` | 4 | `MIRI_ISOLATION_OFF`: `miriRunArgs` rejects (skips) `-Zmiri-disable-isolation` / `-Zmiri-env-forward[=..]` (also `-Z miri-…`) before `--` |
| `scripts/lib/unstable.ts` | 4 | `isIceStderr` (ICE markers incl. the `bug!` path), `THREAD_ID_PATTERN` named, `unstableMiriOracleReason` compares by identity |
| `README.md` | 4 | setup: `bun scripts/miri.ts setup` |
| `scripts/coverage.ts` | 5 | `// std:` / `// std-skip:` markers: `stdMarkers`, `--missing library/...`, `--crate library/<crate>`, a `library` table + `coverage.json` `library`, `--check` validation (warnings, `STD_MARKERS_STRICT`) |
| `tools/probes/randstream/`, `tools/probes/miriaddr/` (new) | 6 | the two probes, registered (`Cargo.toml.in` with `lockfile = "upstream"`, `main.rs` copied from `docs/handoff/{vendor-rand,miri-alloc}-probe/`) |
| `scripts/probes.ts` | 6, 7 | `PROBE_FIXTURES` + `bun scripts/probes.ts fixture [name...]`; `build` runs `verifyOracleToolchain()` first |
| `tools/probes/fixtures.test.ts` (new) | 6 | each fixture equals its probe's stdout; visible skip without the probe, failure under `RUST_TS_REQUIRE_PROBES=1` |
| `harness/library.ts` | 7 | `pruneStaleAux(.., prefix)` (default `m5-`), `touchAuxDir`, `pruneStaleUiAux` |
| `harness/suites.ts`, `harness/compiletest.ts` | 7 | `mini_core-<key>` and `aux/ui/<key>`: touched on use, stale ones pruned by the next new build |
| `scripts/lib/unit-steps.test.ts` | 7 | the disjointness test lists all 16 of bun's test-file patterns (`*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*`) |
| `scripts/lib/miri-trace.ts` | 8 | `maskAddresses`: pointer addresses with provenance (`0x…[alloc<id>]`, `0x…[wildcard]`) → `0xADDR` in records |
| `scripts/miri-diff.ts` | 8 | oracle timeout retried once with `ORACLE_RETRY_FACTOR` (as difftest) |
| `scripts/miri-diff.test.ts` | 8 | real-run test is a visible `test.skip` with `miriOracleProblem`'s reason (failure under `RUST_TS_REQUIRE_PROBES=1`); masking test |
| `scripts/crate-src.ts` | 9 | yanked versions: on a "yanked" fetch failure for a version upstream's Cargo.lock locks, retry with upstream's Cargo.lock |
| `scripts/miri.test.ts`, `harness/library.test.ts` | | tests for the above |

## 1. `ANOTHER` pinned (review harness-m6b finding 1)

`pinProcMacroEnv` scans the case's aux sources (`ui.auxFiles`, the same list `pinSessionEnv` gets) for string-literal
arguments of `env_var(…)`, `var(…)`, `var_os(…)` (over-approximating, like `sessionVarsRead`). Each named variable the
case does not set itself is `null` in `Case.env`: unset on both sides and part of the oracle cache key. At the pin the
only aux source that reads a variable at expansion time is `tests/ui/proc-macro/auxiliary/env.rs` (grep over all of
tests/ui); the one changed case is `tests/ui/proc-macro/env.rs` in pm-ui and pm-expanded: env gains `ANOTHER: null`
(`THE_CONST` stays `1`, its `rustc-env`). `difftest --suite pm-ui --filter proc-macro/env.rs`: MATCH 1/1.

## 2. `needs-*` evaluated for the M6 suites

compiletest.ts header section "needs-*". Only callers that pass `needs: true` (the Miri run corpus and the pm corpus)
change; every other caller keeps the old rule (`needs-subprocess` evaluated, any other `needs-*` rejects), so no other
suite's case list changes (dump below).

How each need is decided, for x86_64-unknown-linux-gnu:
- from the oracle: the target spec (`supported-sanitizers`, `supports-xray`, `dynamic-linking`, `relocation-model`
  default `pic`, `panic-strategy`), overridden by `--print=cfg --target <t>` for `panic` and `target_has_atomic`
  (common.rs `get_current_target_config`; `panic="unwind"`, so `needs-unwind` holds: `can_unwind()`),
  `--print=supported-crate-types` (`needs-crate-type`), `--print=backend-has-mnemonic:ret` (`needs-asm-ret`);
- from the target name / arch as needs.rs: `asm-support` (arch list), `threads`, `subprocess`, `run-enabled`
  (`--run` unset: auto, true off Fuchsia), `target-std`, `dlltool` (false: not windows-gnu), `symlink` (true:
  compiletest runs on the non-Windows target host);
- not reproduced (skip with the reason "… depends on compiletest configuration this harness does not reproduce
  (<what>)", like `ignore-<stage>`): `sanitizer-support` (RUSTC_SANITIZER_SUPPORT), `enzyme`, `offload`,
  `profiler-runtime`, `force-clang-based-tests`, `rust-lld`, `git-hash`, `deterministic-layouts`, `wasmtime`,
  `llvm-zstd`, `rustc-/std-debug-assertions`, `std-remap-debuginfo`;
- an `IgnoreDecision::Error` (bad width / crate type, unknown `needs-*`) rejects the test.

Counts (from the dump):

| suite | cases before → after | skipped before → after | |
|---|---|---|---|
| run-pass-miri | 3,263 → 3,469 | 704 → 498 | +206 cases; of the other 3 formerly needs-rejected tests, 2 are heavy and 1 is skipped because the oracle does not finish (below) |
| run-pass-miri-heavy | 6 → 8 | 0 | +2 |
| run-fail-miri | 263 → 294 | 63 → 32 | +31 |
| pm-ui, pm-expanded | 272 → 282 | 12 → 2 | +10 (all `needs-unwind`); the 2 left are `ignore-enzyme` |

Skips still caused by a need: run-pass 7 `needs-sanitizer-support` + 1 `needs-deterministic-layouts`; run-fail 17
`needs-sanitizer-support`. Other formerly needs-rejected tests now show their next reason: 18 need an aux crate, 15 are
`only-*`-ignored. The 24 `tests/ui/sanitizer/cfi` cases that only need `cfi`/`kcfi` (which x86_64 lists) are now cases;
the Miri oracle runs them (21 exit 0, 3 exit 1).

**Heavy class (A7 repeated).** `bun scripts/miri.ts time --suite run-pass-miri --jobs 8 --timeout-ms 300000` over all
3,472 run-pass cases (before the heavy split): exit 0: 3,272, exit 1: 172, exit 101: 27, timeout: 1; p50 22 ms, p99
397 ms; wall 324 s (`$RUST_TS_DATA/tmp/miri-time/run-pass-miri-20261101-135833-harness-w36-zo5y.jsonl`). Three new
cases are over 5 s of user time:
- `tests/ui/drop/dynamic-drop-async.rs`: 10.4 s user → `MIRI_HEAVY`
- `tests/ui/panics/panic-handler-flail-wildly.rs`: 5.1 s user → `MIRI_HEAVY`
- `tests/ui/threads-sendsync/mpsc_stress.rs`: timed out at 300 s (272 s user, 1.4 GB RSS). Re-timed alone with a
  3,000 s cap: still killed at 3,000 s wall (2,738 s user, max RSS 5.9 GB and growing;
  `…/miri-time/run-pass-miri-20261101-144904-harness-w36-bjij.jsonl`). As a heavy case it would be ORACLE_TIMEOUT on
  every run (never cached), costing up to 900 s + 4 × 900 s each time and over the 12 GB budget at that rate. So it is
  **skipped** in run-pass-miri with that reason (`MIRI_ORACLE_NO_FINISH`, the `NOCORE_SKIPPED` precedent), not heavy.
  Decision for root (ORACLE_TIMEOUT is excluded from the M6b criterion either way).

The next slowest is 4.9 s (`drop/dynamic-drop.rs`). run-fail-miri (294): max 4.8 s (`test-attrs/terse.rs`), total 30 s, no heavy case.

## 3. Miri port side

`MIRI_SUBJECT_ENTRY` is now `MIRI_DRIVER_ENTRY` (`src/miri/bin/miri.ts`), so every Miri suite and miri-diff run
`bun src/miri/bin/miri.ts <the oracle's exact argv>`. The driver accepts that argv (it parses it and gets to Miri's
logger setup). Status breakdown, `RUST_TS_AGENT=harness-w36`:

| run | before (base worktree, rustc-driver subject) | after (this branch) |
|---|---|---|
| `miri-hello` | UNPORTED 1/1 at `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (codegen; M7)` (run `20261101-140321-harness-w36-2ehr`) | UNPORTED 1/1 at `miri(bin)::log::setup::init_early_loggers (src/tools/miri/src/bin/log/setup.rs:94; lane miri-driver)` (run `20261101-140402-harness-w36-mqtw`) |
| `run-pass-miri --sample 50` | UNPORTED 50/50, all at `codegen_crate` (skipped 704; run `…-140324-harness-w36-sujj`) | UNPORTED 50/50, all at `init_early_loggers` (skipped 498; run `…-140408-harness-w36-94qx`) |
| `run-fail-miri --sample 20` | (harness-m6a: UNPORTED 20/20 at codegen) | UNPORTED 20/20 at `init_early_loggers` (run `…-140423-harness-w36-t5ev`) |

The samples differ (the case lists changed). The stop is earlier in the pipeline than the rustc fallback's, because
`bin/log/setup.rs` is ported on the miri-log branch, which is not in integ-w36 yet. In a scratch merge of
`t3/fix-miri-log-tracing` (removed afterwards), hello stops next at `miri::eval::MiriConfig::default
(src/tools/miri/src/eval.rs:178; lane miri-eval, not declared)`. The rustc fallback stays available as
`miriSubjectOf(RUSTC_DRIVER_ENTRY, args)` and is tested.

## 4. harness-m6a nits

- **N1, `bug!` path**: `isIceStderr` marks an ICE by any of `the compiler unexpectedly panicked`, `^error: internal
  compiler error(\[E…\])?: `, `^note: we would appreciate a bug report: `, `^note: using internal features is not
  supported …`, `^note: rustc … running on …` (report_ice prints the bug-report and version notes for every payload,
  and skips only the `Ice` line for `ExplicitBug`/`DelayedBugPanic`; checked at rustc_driver_impl lib.rs:1539 and
  diagnostics.rs:57-78). Test with an ExplicitBug-shaped stderr and each marker alone.
- **N2**: `THREAD_ID_PATTERN` is exported and the Miri rule compares by identity; a test reverses the pattern list.
- **N3**: `-Zmiri-disable-isolation` and `-Zmiri-env-forward` (joined or `-Z` split, before `--`) make `miriRunArgs`
  throw, so the case is skipped with the reason. 0 tests/ui cases at the pin (the dump shows no new skip).
- **README**: `bun scripts/miri.ts setup` in Setup.
- (Windows setup stays untested: no Windows host here.)

## 5. coverage.ts: std markers

- `bun scripts/coverage.ts --missing library/proc_macro/src/bridge/client.rs`: `22/22 ported` (was 0).
- `bun scripts/coverage.ts --crate library/proc_macro`: `TOTAL 364/364 fns covered (100.00%) in the marked files of
  library/proc_macro (3 std-skip)`.
- Full run (`coverage.json` restored to its previous contents afterwards, as harness-m6a did): compiler `TOTAL
  23067/27032` (unchanged by this batch: std markers are not part of it), plus

  ```
  library/alloc        5/56    8.9%  (2 files)
  library/core        74/416  17.8%  (15 files)
  library/proc_macro 364/364 100.0%  (17 files, 3 skipped)
  library/std          5/209   2.4%  (1 files)
  LIBRARY 448/1045 fns covered (42.87%) in 35 marked files of 4 crates
  ```
  The table is over the library files that have at least one marker, not whole crates (decision to confirm).
- `--check`: `markers ok (23646; vendor 5050; library 480, 3 invalid: warnings above)`. The 3 invalid std markers are
  in port files (not this lane's) and print `warning:` lines, not `ERROR:`, so the gate's marker step still passes:
  - `src/std/path.ts:355` `library/std/src/path.rs:977 <Components as DoubleEndedIterator>::next_back` (977 is the
    `impl`; the `fn` is at 978, name `next_back`);
  - `src/std/path.ts:647` `library/std/src/path.rs:3800 <Path as Hash>::hash` (fn at 3801, `hash`);
  - `src/std/char.ts:159` `library/core/src/char/mod.rs:542 CaseMappingIter::new` (fn at 543, `new`).
  Fix them (owner of src/std), then set `STD_MARKERS_STRICT = true` in scripts/coverage.ts.
- 11 older `// std:` comments in `src/std/path.ts` have no line number (`// std: library/std/src/path.rs Prefix::len`);
  they are not markers and are not counted.

## 6. Probe registrations

- `tools/probes/randstream` (from `docs/handoff/vendor-rand-probe/`) and `tools/probes/miriaddr` (from
  `docs/handoff/miri-alloc-probe/`), both `rand = "=0.10.1"` with `lockfile = "upstream"` (resolves chacha20 0.10.0,
  yanked, from the lock). `bun scripts/probes.ts build randstream miriaddr`: built.
- `bun scripts/probes.ts fixture`: `randstream: src/vendor/rand/stdrng.oracle.txt unchanged (254 lines)`,
  `miriaddr: src/miri/alloc_addresses/addresses.oracle.txt unchanged (3673 lines)`: both fixtures are byte-identical to
  the registered probes' output.
- `tools/probes/fixtures.test.ts` (in the gate's "unit tests" step; its literal `probeBinary("…")` calls make the
  gate's unit-test probe pre-check require both probes): 3 pass.
- The `docs/handoff/*-probe/` copies are now redundant; left in place (other lanes' handoffs).
- Not done here (fixer lanes in parallel): the miri-threads scheduler probe and the miri-eval math probes. They can
  register the same way (`PROBE_FIXTURES` entry + a literal line in fixtures.test.ts).

## 7. harness-w35 nits

- Aux cleanup: `mini_core-<key>` (`oracleAuxRmeta`) is touched on use and a new build prunes that crate's other stale
  keys (`pruneStaleAux(.., prefix "")`); `aux/ui/<key>` (`buildAux`) is touched on use and the first new build in a
  process prunes `<16 hex>` directories unused for `AUX_STALE_MS` (3 days; a test not run for 3 days only costs its
  aux rebuild). `.tmp-<pid>` leftovers stay `cleanStaleAuxTmps`'s. Tested on temp dirs (library.test.ts).
- Disjointness: unit-steps.test.ts lists bun's 16 patterns; it now also sees `src/rustc_passes/{abi,layout}_test.ts`
  (ported modules that bun runs as test files: in src/, so in exactly one step).
- `bun scripts/probes.ts build` runs `verifyOracleToolchain()` first.

## 8. miri-diff known limits (review findings 3, 5-8: the cheap ones)

- Addresses masked (scripts/lib/miri-trace.ts header): only a hex number directly followed by `[alloc<id>]` or
  `[wildcard]`; the alloc id and tag stay, bare integers stay. In the cached hello trace, 5,881 records carry one.
- Real-run test: visible skip with the reason when the isolated Miri oracle is absent.
- Oracle timeout: retried once with `ORACLE_RETRY_FACTOR` × the timeout.
- Not done (recorded as known limits by root 2026-11-01): non-trace stderr not compared (3), blank line ends a
  continuation / indented stderr glued (5/6).

## 9. crate-src.ts yanked crates

Done. Checked with an empty `CARGO_HOME`: `bun scripts/crate-src.ts chacha20 --version 0.10.0` fails the plain fetch
("yanked"), retries with upstream's Cargo.lock and prints the unpacked source path (the fetch lock is pruned to 11
packages).

## Suite dump (before/after)

Scratch scripts `$RUST_TS_DATA/tmp/harness-w36/{dump,compare}.ts`; base = a worktree of `0b118d0b`, branch = this tree.
Per suite: every scalar field, each case's full JSON hash by id, each skip's reason by id, `unstable()`, the
oracle/subject command of the first case, `oracleKey()`, own keys. 53 suites both sides; 362,668 → 362,927 cases.

Differences, all of them:
- `escape-synthetic`, `fluent-parse`, `fluent-format`, `emit`, `miri-hello`: `cwd` (the repo path: scratch worktree vs
  this worktree). Nothing else.
- `miri-hello`: subject command (`src/miri/bin/miri.ts` + the oracle's argv).
- `run-pass-miri`: subject; cases +206 −0, none changed; skipped −206, 44 reasons changed (31 from a `needs-*`
  rejection to another reason: aux 18, `only-*` 15, see §2; 2 to `heavy`, 1 to "the Miri oracle does not finish";
  8 to the new "depends on configuration" wording).
- `run-pass-miri-heavy`: subject; cases +2.
- `run-fail-miri`: subject; cases +31; skipped −31, 17 reasons changed (all to the new `needs-sanitizer-support`
  wording).
- `pm-ui`, `pm-expanded`: cases +10, 1 changed (`tests/ui/proc-macro/env.rs`: `ANOTHER: null`); skipped −10.

No protected suite (or any other suite) differs: its cases, skips, unstable list, commands and oracle key are equal.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness --timeout=120000`: 136 pass, 0 fail, 18 files
- `bun test tools/probes/fixtures.test.ts`: 3 pass.
- `bun scripts/coverage.ts --check --offline`: ok (3 warnings above).
- `bun scripts/difftest.ts --suite pm-ui --sample 50` (run `20261101-140515-harness-w36-qp9j`; `--filter proc-macro/env.rs`: run `20261101-140532-harness-w36-2pjs`): MATCH 50/50, skipped 2.
- Sample runs of §3.

## For root

1. Decisions to record: (a) `needs-*` evaluated only for the M6 run/pm suites, with the configuration-dependent needs
   still skipped (the list in §2); (b) proc-macro env reads unset (§1); (c) `MIRI_SUBJECT_ENTRY` switched (the Miri
   suites now stop at `init_early_loggers` until miri-log merges); (d) 2 new heavy cases, and `mpsc_stress.rs`
   skipped because the Miri oracle does not finish (§2); (e) std markers: library
   table over marked files only, `--check` warns until the 3 port-side markers are fixed (`STD_MARKERS_STRICT`).
2. Port-side follow-up (src/std owner): the 3 std markers in §5.
3. pm-ui is ready for its first accept as far as the harness-m6b preconditions in this batch go (ANOTHER pinned,
   needs-unwind evaluated); decisions (a)–(e) of harness-m6b still to be recorded by root.
