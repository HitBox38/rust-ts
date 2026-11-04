# Handoff: harness-m6c (harness batch, M6 wave 38; plan-m6 §4, D13, D14, A5, A8, A9, A11; needs an independent review)

**Later changes:** review R2 moved three cases back (353 + 7, as in `harness/suites.ts`), so the 350 + 10 tables below describe the
earlier list. The M6b figure comes from one gate, `bun scripts/criteria.ts --run <gate run>` (plan-m6 A12).

Branch `t3/add-miri-harness-suites`, base main `c9d3c553`. Harness and test files only. No file under `src/` changed, so
there are no coverage changes, `// rustc:` markers, `unported(...)` calls or `// PORT:` decisions. No baseline, oracle
output, existing suite or existing cache key changed; "Existing suites unchanged" has the proof. The new suites have no
baseline, so they are unprotected and not in the gate's defaults.

## Files touched

| file | change |
|---|---|
| `harness/compiletest.ts` | New section "Miri's own tests": ui_test's rules (`uiTestComments`, `uiTestForRevision`, `uiTestIgnored`, `uiTestArgs`, `uiTestEnv`, `collectUiTestFiles`, `uiTestCases`, `commaParseCommand`). New `uiFileCases(.., { miriAux: true })`: `AuxStep.miri`, `AuxCtx.miri`, and the header's Miri section |
| `harness/suites.ts` | Suites `miri-pass`, `miri-pass-heavy`, `miri-pass-tb`, `miri-fail`, `run-pass-aux-miri`, appended after the existing ones |
| `harness/miri-ui.test.ts` (new) | 17 tests, listed below |
| `scripts/miri.test.ts`, `scripts/unstable.test.ts` | Their pinned suite lists gain the new names |

`scripts/miri.ts` needed no change: `time --suite` already handles these suites. `UPSTREAM.json` needed no change: the
sparse checkout has had `src/tools/miri/tests` (with `tests/utils`) since harness-m6a.

Two suites beyond the three asked for, both following from the plan:
- `miri-pass-heavy`, for A11 (the same pattern as `run-pass-miri-heavy`).
- `miri-pass-tb`, for A5. See "Decisions for root" 2; it is easy to merge back.

## 1. What upstream's runner does

`src/tools/miri/tests/ui.rs` runs these tests through the `ui_test` crate (0.30.7), not compiletest, and its rules differ.
They were read from the crate's source and are ported in `harness/compiletest.ts`:

- **Directives:** only a line that *starts* with `//@` counts (no indentation).
- **Flag order:** base directives, then revision keys in `BTreeMap<Vec<String>, _>` order. That is sorted order, not file
  order, and the unit test pins it.
- **Filters:** `ignore-<cond>` first, then `only-<cond>`. `target` and `host` are substring lists up to a `#`. Also
  `bitwidth` and `on-host`.
- **Argv:** `--error-format=json -Dwarnings -Dunused -Ainternal_features -Zui-testing --sysroot=<s> --out-dir <d> <file>
  <compile-flags> --edition <e> [--cfg=<rev> -Cextra-filename=<rev>] --target <t>`. `--target` is omitted when host = target.
- **Env:** `MIRI_ENV_VAR_TEST=0`, `MIRI_TEMP`, `RUST_BACKTRACE=1`, then `rustc-env`.
- **cwd:** `src/tools/miri`, so file and id are `tests/pass/x.rs[#rev]`.

**Check of the argv against upstream.** The oracle's output on every case, passed through ui.rs's own normalization and
ui_test's rendering, was compared with upstream's blessed `.stderr` / `.stdout` files: **miri-fail 610/610; miri-pass and
miri-pass-tb 492/492 before the heavy split (the same cases)**. That is the evidence the argv reproduces ui.rs. The check
is a scratch script; the run on the first three suites is not repeatable from the repo.

## 2. Suites and oracle measurements

Isolated Miri oracle, macOS arm64, `bun scripts/miri.ts time --suite S --jobs 6 --timeout-ms 300000`. Load average was 15
at the start of these runs, and other lanes were active throughout.

| suite | cases (files) | skipped | oracle exit codes | user p50 / p99 / max, total | wall | role |
|---|---|---|---|---|---|---|
| `miri-pass` + `miri-pass-heavy` | 353 + 7 = 360 after review R2, which moved three cases back; 350 + 10 in the runs below (353) | 12 target filters | 347 exit 0 (tests/pass), 13 exit 101 (tests/panic) | 26 ms / 2.9 s / 5.0 s, 37.6 s | 8 s | **M6b: >= 80%, ORACLE_TIMEOUT excluded (A9)**; the figures were measured before the heavy split |
| `miri-pass-tb` | 132 (73) | 0 | 132 exit 0 | 34 ms / 0.85 s / 0.87 s, 10.5 s | 4 s | report only (A5) |
| `miri-fail` | 610 (547) | 3 target filters | 610 exit 1 | 22 ms / 106 ms / 1.27 s, 22.3 s | 6 s | report only, no threshold; subset `tree-borrows` |
| `run-pass-aux-miri` | 356 (327) | 65 | 324 exit 0, 27 exit 1, 5 exit 101 | 24 ms / 187 ms / 243 ms, 11.6 s | 3 s | report only |

Max RSS: 240 MB, on `0weak_memory/consistency_sc.rs`.

Every tests/pass, tests/panic and tests/fail case exits as ui.rs expects (0, 101, 1). Timing files are in
`$RUST_TS_DATA/tmp/miri-time/`.

### Compared with the plan's 389 tests (362 exit 0, 14 exit 101, 13 exit 1)

The plan's figure is reproduced exactly: every file, base directives only, no revisions, no filters gives **362 / 14 / 13**.
(With `//@edition` ignored as well it gives 361 / 14 / 14: `generators.rs` needs edition 2024.) Those 27 non-zero runs:

- 14 exit 101: the 13 tests/panic files (correct) and `target-spec-implies-target-feature.rs` (`only-target: armv7`).
- 10 of the 13 exit 1: `only-target` tests of another target (aarch64 x4, loongarch64, windows x4, darwin). All are now
  skips. The 12 skips also include `tls/win_tls_callback.rs` (windows), which exited 0 in the plan's run, and the
  armv7 test above.
- 3 of the 13 exit 1: tests that need a revision's flags (`async-panic-track-caller.rs`,
  `float_extra_rounding_error.rs`, `tree_borrows/copy-nonoverlapping.rs`). They now exit 0 in each revision.

So expanding revisions and honouring the filters takes the 389 files to 492 revisions run (360 + 132), plus 12 skipped.
There are 63 files with `revisions`, and 108 files with revisions or target filters (A8 says 109; I counted with `grep`,
and did not chase the one-file difference).

### `run-pass-aux-miri`

The plan's 333 files were not yet expanded: this is 327 files with 356 cases, plus 65 skips:
- 52 proc-macro aux crates;
- 6 aux binaries (Miri builds no program to run);
- 6 tests needing the native `rust_test_helpers`, which the harness does not build (bootstrap's `-Lnative=`);
- 1 `needs-sanitizer-support`.

Non-zero oracle exits are Miri's real outcomes under isolation, such as `sigaction`, `posix_spawnattr_init`, EII symbols,
and `getcwd` under isolation in the backtrace tests. They are not aux problems. The rlib builds took 18.8 s the first
time, and the aux directories total 3.2 MB.

### Aux crates (`MIRI_BE_RUSTC=target`)

Measured by hand and pinned by a test:
- `--crate-type dylib` panics (`MiriDepCompilerCalls::config` asserts a crate type is left), so every aux crate gets
  `--crate-type lib`.
- A metadata-only `.rmeta` fails the main compile ("required to be available in rlib format"), so `--extern` names
  `lib<name>.rlib`.
- The rlib holds the metadata with MIR (`-Zalways-encode-mir` comes from `MIRI_DEFAULT_ARGS`), and the program runs.
- `miriOracleKey()` joins the aux key only for Miri-built steps, so no other aux directory is re-keyed.

### Reproducibility

Every case of the four suites was run twice on the oracle. The miri-pass cases, including the heavy ones, were also run
with a changed host `HOME`, `PATH` and `USER`. Two cases differ, and both are listed in `MIRI_PASS_UNSTABLE`, each in
`thread '<name>' (<tid>) panicked`:
- `tests/panic/mir-validation.rs`: an ICE by design;
- `tests/panic/panic1.rs`: `-Zmiri-disable-isolation`, so `gettid` carries the real pid.

The other 26 of the 27 isolation-off cases reproduce (18 + 3 in miri-pass and its heavy sibling, 2 in miri-pass-tb, 4 in
miri-fail), including those using time, sockets and hostname.

### Heavy and serial (A11): `miri-pass-heavy`, 10 cases

| case | why |
|---|---|
| `0weak_memory/consistency_sc.rs`, `weak.rs`, `consistency.rs`, `float_nan.rs` | over 2.5 s of oracle user time (5.0, 3.7, 3.1, 2.9 s) |
| `float.rs`, `panic/nested_panic_caught.rs`, `shims/time-with-isolation.rs` | the port had not finished after 52, 42 and 47 s of CPU (under load; killed at 600 s wall). Oracle 0.5–1.2 s. `consistency.rs` took the port over 200 s of CPU, about 65x the oracle |
| `shims/fs.rs`, `shims/fs-permissions.rs`, `issues/issue-miri-3680.rs` | they write files under `MIRI_TEMP`. Ordinary single-mode cases run oracle and subject at the same time, so these would race on the same files and could cache a bad oracle output. The heavy class runs one process at a time |

The other suites have nothing over 2.5 s. The six `tests/fail` panic tests at 1.1–1.3 s oracle may hit the port's 60 s
limit; I did not measure them. It is a report-only suite, and a TIMEOUT there costs one retry each.

**Port on `miri-pass-heavy`, all 10 cases** (each its own `difftest --filter` run, so one per process, at load 60–240; the
full-suite run was killed by the 30-minute limit on background commands, so there is no single run id):

| result | cases |
|---|---|
| MATCH, 6 | `float.rs`, `panic/nested_panic_caught.rs`, `shims/time-with-isolation.rs`, `0weak_memory/weak.rs`, `consistency.rs`, `consistency_sc.rs` |
| UNPORTED, 3 | `shims/fs.rs`, `shims/fs-permissions.rs`, `issues/issue-miri-3680.rs`, all at `mio::Poll::new (host I/O, isolation off; plan-m6 D5)` |
| TIMEOUT, 1 | `float_nan.rs`, at the suite's 1,800 s limit |

So all three cases the port had not finished in the earlier timing do finish and match; they were slow, not hung. Wall
times were 187–942 s per case under that load, so they are not a speed measurement. `float_nan.rs` is the perf lane's
(D11) first target; it may finish on a quiet host.

## 3. Port samples (`--sample 100`, `RUST_TS_AGENT=harness-m6c`; never fixed here)

| suite | MATCH | UNPORTED | TIMEOUT | DIFF / CRASH | run |
|---|---|---|---|---|---|
| `miri-pass` (load about 15–100) | **89** | 11 | 0 | 0 | `20261103-225000-harness-m6c-515n` |
| `miri-pass` (load 150–200, final 350-case list) | **78** | 10 | 12 | 0 | `20261103-233454-harness-m6c-03fr` |
| `miri-pass-tb` | 0 | 100 | 0 | 0 | `20261103-225139-harness-m6c-xfkn` |
| `miri-fail` | 82 | 18 | 0 | 0 | `20261103-225253-harness-m6c-8ivo` |
| `run-pass-aux-miri` | 95 | 5 | 0 | 0 | `20261103-225445-harness-m6c-h0e4` |

**The 12 TIMEOUTs are load, not hangs, as far as I can tell.** At load 150–200 even trivial programs
(`reborrow-coerce-shared.rs`, `static_align.rs`) missed the 60 s limit. 48 subjects timed out in the pool, and on re-run
36 finished and 12 timed out again. The same suite had no TIMEOUT at lower load. I could not re-run on an idle host, so
this is an inference. It does mean the 80% figure is sensitive to machine load: root should read the criterion from a
gate run on a quiet host. Neither sample is a full-suite figure.

**Top UNPORTED reasons:**

| suite | count | reason |
|---|---|---|
| `miri-pass` | 5 | `rustc_codegen_llvm::llvm_util::configure_llvm (-C target-feature)` |
| `miri-pass` | 4 | `mio::Poll::new (host I/O, isolation off; plan-m6 D5)` |
| `miri-pass` | 1 | `miri::shims::unix::virtual_socket::EvalContextExt::socketpair (plan-m6 D2: sockets)` |
| `miri-pass` | 1 | `miri::intrinsics::x86::EvalContextExt::emulate_x86_intrinsic (lane miri-x86-a)` |
| `miri-pass-tb` | 98 | `miri::borrow_tracker::tree_borrows::Tree::new_allocation (lane miri-tb-a)` |
| `miri-pass-tb` | 2 | `mio::Poll::new` |
| `miri-fail` | 17 | `Tree::new_allocation` (the whole `tree-borrows` subset of the sample) |
| `miri-fail` | 1 | `configure_llvm (-C target-feature)` |
| `run-pass-aux-miri` | 4 | `Decodable for rustc_metadata::rmeta::EiiMapEncodedKeyValue (rustc_attr_ir EiiDecl/EiiImpl, derive(Decodable) not generated)` |
| `run-pass-aux-miri` | 1 | `rustc_codegen_ssa::back::link::each_linked_rlib (CrateInfo::new with -C lto; M7)` |

Port speed: `mio::Poll::new` stops every isolation-off case that reaches it, so the three fs cases are UNPORTED until that
lands. `consistency.rs`'s factor of about 65x suggests the 60 s limit bites near 0.9 s of oracle time.

## 4. Tests and verification

`harness/miri-ui.test.ts`: comma's parser; revision expansion with `--cfg` / `-Cextra-filename` and `BTreeMap` flag order;
`rustc-env` order; the `//@` line rule; every target, host and bitwidth filter, including `#` and substring behaviour;
no `--target` when host = target; what ui_test rejects and what shapes nothing; the suites' fields and case counts at the
pin; one case's env and argv; a real Miri aux build (argv, rlib, the program runs); callers without `miriAux` unchanged; the
aux key; the skip reasons.

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: `markers ok`.
- `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness --timeout=240000`: **164 pass, 1 fail**, 20 files, at load 150+.
  The failure is `scripts/lib/common.test.ts` "run() reports max RSS in bytes and CPU time in ms" (`userMs` 76 where the test
  wants > 100). It is not caused by this batch: those files are unchanged from base, and the same test fails on unmodified
  main `dc5e3107` too (`userMs` 30). It looks load-dependent or stale; I left it alone (outside this lane).
- With the default 5 s timeout under load, `scripts/miri.test.ts` also failed once; it passes alone (11/11) and with the
  longer timeout, as the brief expected.

### Existing suites unchanged

All 53 existing suites were dumped at base `c9d3c553` (a temporary worktree, since removed) and on this branch:
fields, `cases()` and `skipped()` in full, `unstable()`, the first case's oracle and subject commands, `oracleKey()`.
**0 differences over 362,928 cases**; the only diff lines are the five added suites (1,458 cases at the time of the dump:
353 + 7 + 132 + 610 + 356; the later move of 3 cases to heavy does not change the total). The script is the same method as
harness-m6b's. The dump ran before the final heavy-list edit, which only touches the new suites.

No sample run reported upstream-checkout changes. Miri creates `--out-dir`, so it lives under `$RUST_TS_DATA/tmp/miri_ui`,
never in the checkout. The oracle toolchain was not touched; `bun scripts/miri.ts status` printed `ok` for it.

## 5. Decisions for root (please record if accepted)

1. **`--error-format=json` is kept**, though the brief's flag list leaves it out. ui.rs inherits it from
   `CommandBuilder::rustc()`, and the brief says to copy ui.rs's behaviour. So stderr is JSON diagnostics, which is stricter
   than human output (spans, children, rendering) and also exercises the port's JSON emitter. To switch, remove the
   first element of `uiTestArgs`. Dropping it would change every oracle key of these suites and nothing else.
2. **Tree Borrows cases are split out of `miri-pass`** into report-only `miri-pass-tb` (132 of 492). A5 says no gate
   depends on Tree Borrows, and a threshold over cases including them would. If you prefer them in `miri-pass`, remove the
   `isTreeBorrows` filter. They are 27% of the set, so the 80% target would then need them ported.
3. **`miri-pass-heavy` shares the M6b criterion**: M6b should read `miri-pass` + `miri-pass-heavy`, as run-pass-miri does
   with its heavy suite. The fs cases are in it for the race, not for speed.
4. **`MIRI_TEMP` is one fixed directory per case** under `$RUST_TS_DATA/tmp/miri-temp/`, where upstream has one random
   directory per run. A random path would change the oracle key on every run.
5. **`tests/panic` runs without `WithDeps`**: no test there names a tests/deps crate, and D13 leaves those crates out.
6. **Aux failures with `could not find native static library` are skips**; any other Miri aux failure stays an `ERROR:`
   that stops the run.
7. **Isolation-off cases are in these suites** (D14 allows it: the isolation-on paths are the byte-exact ones). `miriRunArgs`
   still refuses them for tests/ui.

## 6. Not done, for root

- Root adds the suites to a gate explicitly; none is a default.
- A host other than `aarch64-apple-darwin` gets different `ignore-host` results only for `windows`; untested.
- `.stdin` files, `aux-build`, `run` and `needs-asm-support` are not reproduced. No test in the three directories uses them
  at the pin, so nothing is skipped for them.
- This worktree has no `.env.local` and I was told not to touch it. I ran with `RUST_TS_DATA` exported, and with temporary
  `.data` and `node_modules` symlinks (removed; neither is committed) for the tests whose children drop `RUST_TS_DATA`.
