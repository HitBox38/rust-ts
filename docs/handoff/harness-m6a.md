# Handoff: harness-m6a (harness batch: scripts/, harness/, UPSTREAM.json; needs an independent review)

Branch `t3/miri-harness-runner`, from main `9c494416` with `integ-w35` merged in first, as the lane asked. No ported code
was touched, so there are no `unported(...)` or `// PORT:` changes. No baselines, oracle outputs of other suites, suite
case lists or existing oracle cache keys were changed. The pin did not change: UPSTREAM.json `rust.commit` is the same,
and only `sparse` and the new `rust.miri` changed.

## Files touched

| file | change |
|---|---|
| `UPSTREAM.json` | `sparse` adds `src/tools/miri/tests` (task 6); new `rust.miri` = `{ target: x86_64-unknown-linux-gnu, components: [cargo-{host}, miri-preview-{host}, rust-src, rust-std-{host}, rustc-{host}] }` (the isolated toolchain's pin) |
| `scripts/lib/miri.ts` (new) | the Miri oracle: paths, `MIRI_DEFAULT_ARGS`, `MIRI_CASE_ENV`, `miriOracleProblem` / `verifyMiriOracle`, `miriSysrootHash`, `miriOracleKey` |
| `scripts/miri.ts` (new) | CLI: `setup` (idempotent install + sysroot + hello-world smoke test), `status`, `time --suite S` (oracle-only timing, task 4 / A7) |
| `scripts/lib/toolchain.ts` | `miriToolchainError` (the Miri toolchain's own component guard; `rust-src` required); `componentDiff` shared with `oracleToolchainError`, whose message is unchanged |
| `scripts/lib/common.ts` | `UpstreamPin.miri`, `MiriPin` |
| `scripts/lib/unstable.ts` | `unstableMiriOracleReason` (see §3) |
| `scripts/difftest.ts` | `verifyMiriOracle()` for `Suite.miri` suites; `unstableReasonOf(s)`; `criterionOf` + a `criterion` line and summary field (A9) |
| `scripts/gate.ts` | `undeclaredRuns` accepts the isolated Miri binary as a Miri suite's oracle program |
| `scripts/coverage.ts` | crate `miri` (task 5) |
| `harness/scope.json` | `miri`: root, `excluded`, `partial` (D2, A3) |
| `harness/compiletest.ts` | `uiFileCases(.., { run: true })`: `mode` and `run` (`run-flags`, `exec-env`, `unset-exec-env`) on each case, no `-Zparse-crate-root-only`. These directives are parsed only when `run` is set, so no other case set can change |
| `harness/suites.ts` | `Suite.miri`, `Suite.criterion`; suites `miri-hello`, `run-pass-miri`, `run-pass-miri-heavy`, `run-fail-miri`; `miriRunArgs` (D6), `miriSubject` |
| `harness/corpus/miri/hello.rs` (new) | `fn main() { println!("Hello, world!"); }` |
| `scripts/miri.test.ts` (new) | 9 tests (fake-sysroot guard, unstable detection, and a child process covering upstream `MIRI_DEFAULT_ARGS`, the real toolchain, suites, argv and criterion) |

## 1. D1: the isolated Miri toolchain

- **`bun scripts/miri.ts setup`**:
  1. Checks that the oracle toolchain has exactly its pinned components. It does this fresh, without the memo.
  2. If `$RUST_TS_DATA/rustup-miri/toolchains/<nightly>-<host>` is missing, it runs `rustup toolchain install
     nightly-2026-10-11 --profile minimal --component miri,rust-src --no-self-update`. If the toolchain exists but
     lacks `miri-preview` or `rust-src`, it runs `rustup component add` for only those. Any other mismatch stops setup
     with the guard's message; setup never removes anything.
  3. Runs `<toolchain>/bin/cargo miri setup --target x86_64-unknown-linux-gnu` with `MIRI_SYSROOT=$RUST_TS_DATA/miri-sysroot`
     and `MIRI_LIB_SRC=<toolchain>/lib/rustlib/src/rust/library`, from a temp cwd. cargo-miri keeps a sysroot that is
     already up to date.
  4. Runs `verifyMiriOracle`, checks the oracle's components again, runs a Miri hello world, and prints one `ok:` line.
- **Isolation**: every rustup and cargo process gets an environment built from scratch. It holds a short pass-through
  list (HOME, PATH, TMPDIR, proxies, rustup mirrors) plus `RUSTUP_HOME`/`CARGO_HOME` set to the isolated homes. Before
  each spawn, setup asserts those values and that the isolated home is not the oracle's rustup home (the parent of the
  oracle sysroot's `toolchains/`). So an inherited `RUSTUP_HOME`, `RUSTUP_TOOLCHAIN`, `CARGO_*` or `MIRI_*` cannot
  redirect it. Logs: `$RUST_TS_DATA/tmp/miri-setup/<step>.log`.
- **Guard (`miriOracleProblem`, separate from the oracle's)**, checked in this order:
  - the components equal `rust.miri.components` and `lib/rustlib/src` exists (`miriToolchainError`);
  - the `-vV` commit hash of `miri` and of the isolated `rustc` both equal the pin;
  - the isolated `librustc_driver` is byte-identical to the oracle's (`rustcDriverHash`). Measured: both are
    `2d44bb3f…`;
  - the Miri sysroot has `libcore-*`, `liballoc-*` and `libstd-*.rmeta` for the target.

  difftest runs it for every `Suite.miri` suite, after `verifyOraclePin`. `bun scripts/miri.ts status` prints both
  checks.
- **Verified idempotent**:
  - On the existing install, I ran `setup` twice. Both runs printed `sysroot: up to date`, hello world ok, and key
    `4b7f6cc5967f`, each in 0.3 s user.
  - From scratch, with `RUST_TS_DATA` pointed at an empty `tmp/harness-m6a-fresh`:
    - The first run installed the toolchain (537 MB, plus 15 MB of crates in cargo-miri), built the sysroot (112 MB,
      82 files) and passed hello world.
    - The second run printed `up to date` and gave the same key.
    - The key differs from the main install's (`30cf91a2…` vs `4b7f6cc5…`) because the sysroot's rmetas and `.d`
      files hold the absolute rust-src path. That is A11, as expected.
  - Removed afterwards.
- **Oracle toolchain unchanged**:
  - `~/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin/lib/rustlib/components` has sha1 `9f06e651…` before
    and after every step, including the fresh install.
  - It lists the same six components, with no `lib/rustlib/src`.
  - `bun scripts/miri.ts status` prints `ok oracle toolchain …: pinned components, no rust-src`.

## 2. Miri oracle runner and cache key

- **Oracle command**: `[<rustup-miri>/toolchains/<tc>/bin/miri, ...case.args]`, by absolute path, never through a rustup
  proxy.
- **Case env (`MIRI_CASE_ENV`, both sides)**:
  - `RUSTUP_HOME`/`CARGO_HOME` are set to the isolated homes.
  - Every variable the Miri driver reads at the pin is removed: `MIRI_LOG`, `MIRI_TRACING` and `MIRI_BACKTRACE`
    (bin/log/setup.rs), `MIRI_CWD` (bin/miri.rs:168), `MIRI_LOCAL_CRATES` (machine.rs:904), `MIRI_BE_RUSTC`
    (bin/miri.rs:419), plus cargo-miri's `MIRI_SYSROOT`.
  - `RUSTC_LOG*` is already scrubbed by env.ts.
  - Isolation stays on (D14). With it on, the interpreted program sees no host variable (shims/env.rs:37); it sees only
    `-Zmiri-env-set`.
- **Cache key**: `Suite.oracleKey = miriOracleKey()`, a hash of:
  - the miri binary;
  - the isolated `librustc_driver`;
  - the toolchain's `components` file;
  - the target;
  - every file under `miri-sysroot/` (path and content; 117 MB, 0.2 s once per process).

  difftest's own key adds the case's argv (flags, including the sysroot path), env, file and dependencies (deps.ts),
  plus the miri binary again (`oracleVersion`). Measured key: `4b7f6cc5967f…`.
- **A11 caveat** (scripts/lib/miri.ts header and the suites comment): Miri's output names std sources by absolute
  local paths under the isolated `RUSTUP_HOME`, and the argv holds `--sysroot <abs path>`. So the Miri suites' oracle
  cache is bound to this `$RUST_TS_DATA`, and another host or data dir re-runs every case. Both sides use the same
  paths, so this never causes a DIFF.

## 3. Run-mode compare

- **Compare**: single mode, one process per case. Each process compiles and runs the program. difftest compares
  stdout, stderr and exit code byte for byte, exactly as for every single-mode suite, with **no normalisation** (D14:
  same argv, cwd and env on both sides).
- **Unstable-output detection (needed)**: difftest's thread-id pattern (`thread '<name>' (<tid>) panicked` → UNSTABLE)
  would have marked every panicking program UNSTABLE. The sample run found `tests/ui/macros/cfg-expr.rs` that way.
  - Under Miri, the tid is the `gettid` shim's virtual id (shims/env.rs:113: pid + thread index; with isolation the pid
    is a constant, so the main thread is `(1000)`). I ran the case twice and got identical output.
  - Miri suites therefore use `unstableMiriOracleReason`: the tid pattern applies only when stderr also has the ICE
    hook's `the compiler unexpectedly panicked`, which is a real host panic. The other two patterns apply unchanged.
  - Non-Miri suites are unchanged.
- **Subject**: `miriSubject` = `bun src/rust_ts/main.ts` + `MIRI_DEFAULT_ARGS` (checked against upstream lib.rs:187 by
  the test) + the case's argv minus `-Zmiri-*` and minus everything from `--`. That is Miri's own rustc argv
  (bin/miri.rs:465).
  - It compiles the program and stops UNPORTED at `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (codegen;
    M7)`.
  - **For root**: when lane miri-driver lands `src/miri/bin/miri.ts`, a one-line harness change should make the
    subject `[bun, src/miri/bin/miri.ts, ...case.args]` (the oracle's exact argv). I did not make it switch
    automatically on the file existing.

## 4. Suites (all `milestone: "M6"`, unprotected, `miri: true`, each with a report-only `criterion`)

| suite | cases | skipped | oracle (measured, this Mac, isolated Miri) |
|---|---|---|---|
| `miri-hello` | 1 (`harness/corpus/miri/hello.rs`, `--sysroot <miri-sysroot> --target x86_64-unknown-linux-gnu`, cwd the repo, env NOCORE_ENV + MIRI_CASE_ENV) | 0 | `Hello, world!`, empty stderr, exit 0, 0.03–0.07 s |
| `run-pass-miri` | 3,263 (3,269 run-pass cases minus the 6 heavy) | 704 (402 aux, 250 `needs-*`, 37 `only-*`, 6 LLVM, 3 ignored; 6 heavy) | see below |
| `run-pass-miri-heavy` | 6 (`MIRI_HEAVY`), heavy class: serial, subject 1,800 s, oracle 900 s (the slowest takes 451 s; a finished run is cached), RSS budget 12 GB | 0 | see below |
| `run-fail-miri` | 263 (`run-fail`, `run-crash`, `run-fail-or-crash`) | 63 (48 `needs-*`, 7 ignored, 3 aux, 3 incremental, 2 `only-*`) | exit 101: 144, exit 1: 119; user p50 43 ms, p99 547 ms, max 1.15 s, total 15.3 s |

- **Case sources** (plan §4, D6):
  - Every tests/ui test that declares a run mode in some revision (`runModeFiles`), through
    `uiFileCases(.., "human", { run: true })`, filtered by the mode of each revision.
  - This gives 3,269 + 263. The plan's 3,256 + 238 came from a cruder file list: it counted 28 files in
    `compiletest-ignore-dir` directories (module files of other tests), which compiletest never collects, and it
    missed 41 revisions whose mode is set per revision (`//@ [runtime] run-pass`).
  - Skips are attributed to the suite of the mode the skipped revision declares.
- **D6 argv (`miriRunArgs`)**:
  - Every `-o <path>` is dropped.
  - compiletest's `--sysroot <oracle sysroot>` becomes `--sysroot <miri-sysroot>`.
  - `--target=x86_64-unknown-linux-gnu`, `-O`, `-Zui-testing` and the remap flags stay.
  - Each `exec-env K=V` becomes `-Zmiri-env-set=K=V`, unless an `unset-exec-env` removes it. compiletest sets the
    variables and then removes those; `trim-env-name.rs#unset` checks this.
  - `run-flags` go after `--`.
  - A test that names the oracle sysroot anywhere else would be skipped with a reason. There are none.
  - 3 run-pass and 20 run-fail cases use `-Zmiri-env-set`; 4 run-pass and 3 run-fail cases pass program arguments.
- **Heavy (A7; `bun scripts/miri.ts time --suite run-pass-miri --jobs 8 --timeout-ms 300000`)**:
  - Over all 3,269 run-pass cases: exit 0: 3,093, exit 1: 146, exit 101: 28, timeout: 2.
  - User time: p50 23 ms, p99 314 ms, total 685 s with the two capped runs (≈ 1,154 s with their uncapped times). Wall time 319 s with 8 jobs.
  - Over 5 s user:

| case | Miri oracle user time |
|---|---|
| `tests/ui/range/step_overflowing.rs` | > 264 s (killed at 300 s wall); uncapped, alone: **282 s** user (292 s wall), exit 0 |
| `tests/ui/collections/hashset-connected-border-12860.rs` | > 263 s (killed at 300 s wall); uncapped, alone: **451 s** user (463 s wall), exit 0 |
| `tests/ui/threads-sendsync/task-comm-6.rs` | 18.5 s |
| `tests/ui/generics/issue-94923.rs` | 10.6 s |
| `tests/ui/impl-trait/example-calendar.rs` | 8.6 s |
| `tests/ui/threads-sendsync/task-comm-5.rs` | 5.1 s |

  Next slowest: 3.4 s (`moves/move-3-unique.rs`), then 3.1 s and 2.2 s. RSS stays at 100–180 MB everywhere. These six
  are listed in `MIRI_HEAVY` with their measurement. run-pass-miri lists them as skipped (reason "heavy … in
  run-pass-miri-heavy"), and they are the cases of `run-pass-miri-heavy`. That suite is in the heavy class, so it runs
  after every other suite, one process at a time, and stays out of the per-batch path (A11). run-fail-miri has no heavy
  case: its maximum is 1.2 s. Details: `$RUST_TS_DATA/tmp/miri-time/run-pass-miri-20261031-230156-harness-m6a-wwxn.jsonl`
  and `run-fail-miri-20261031-230201-harness-m6a-eblq.jsonl`.
- **Criterion (A9; report only)**:
  - The figure is MATCH / (cases − ORACLE_TIMEOUT), compared with ≥ 100% for miri-hello (M6a) and ≥ 90% for the other
    three (M6b; the text names the combined rule).
  - difftest prints it in a `criterion (report only): …` line, marked `[sample/filter run]` on samples, and writes
    `criterion` to `<suite>.summary.json`.
  - It is never a status and never fails a run or the gate. The gate runs only suites with baselines, so none of these
    run until root accepts one.

## 5. Coverage (`miri` crate)

- `harness/scope.json` `miri`:
  - root: `src/tools/miri/src`;
  - excluded: `concurrency/genmc`, `shims/native_lib`, `shims/windows`, `shims/unix/{macos,freebsd,solarish,android,netbsd}`,
    the socket files `shims/unix/{socket_address,virtual_socket,tcp_socket}.rs`, and `bin/log/tracing_chrome.rs`;
  - partial: `shims/unix/socket.rs`, where only `socket` (:158, the `reject_in_isolation` at :172, A3) is in scope.
    With isolation on, no socket fd exists, so the other socket shims cannot be reached.
- coverage.ts:
  - The full table counts a `miri` row, which always prints, even at 0.
  - `--crate miri` gives the per-file table.
  - `--missing src/tools/miri/src/…` honours `partial` and notes excluded files.
  - `--check` validates `src/tools/miri/src/` markers against every fn under the root, in scope or not.
- Robust to a missing `src/miri/`: markers are found anywhere under `src/`, so `ported` is just 0. Robust to a checkout
  without Miri's sources: it prints a note and adds no row.
- **Numbers**:
  - `bun scripts/coverage.ts --crate miri`: `TOTAL 0/1514 fns ported (0.00%) in miri`.
  - The full run reports `miri 0/1514`, `TOTAL 22590/27032` (was 25,518; the headline total grows by Miri's 1,514).
    I restored `$RUST_TS_DATA/coverage.json` to its previous contents afterwards, so state.ts still shows the old
    figure until root's next coverage run.
  - `--check`: `markers ok (23169; vendor 4680)`.
  - `--missing src/tools/miri/src/shims/unix/socket.rs`: `0/1`.

## 6. Sparse checkout

`UPSTREAM.json` `sparse` gains `src/tools/miri/tests`. I applied it with `bun scripts/upstream.ts fetch` and the
checkout stays at `6f5da406…`. `tests/` now holds `pass`, `panic`, `fail`, `pass-dep`, `fail-dep`, `genmc`,
`native-lib`, `many-seeds`, `deps`, `utils` and `ui.rs`. cargo-miri is not needed: setup runs the toolchain's cargo-miri
binary. No suite or collector walks `src/tools`, so no case list changes.

## Verification

- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness --timeout=60000`: 110 pass, 0 fail, 16 files.
- `bun scripts/difftest.ts --suite miri-hello` (run `20261031-225507-harness-m6a-nydw`): UNPORTED 1/1.
  - The oracle's cached output is `Hello, world!\n`, with empty stderr and exit 0.
  - The port stops with `UNPORTED rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (codegen; M7)`.
  - Nothing was written to the repo or the upstream checkout.
- `bun scripts/difftest.ts --suite run-pass-miri --sample 50` (agent harness-m6a, run `20261031-225517-harness-m6a-0xjo`,
  before the unstable fix): UNPORTED 49, UNSTABLE 1, so all 50 oracle sides were populated.
  - The UNSTABLE case (`macros/cfg-expr.rs`) led to the §3 fix; it is a Miri program panic.
  - Unported reasons: 48 at codegen and 1 at `rustc_session::config::native_libs::parse_native_lib`.
- The same `run-pass-miri --sample 50` after the fix and the heavy split (run `20261031-230905-harness-m6a-k8oh`):
  UNPORTED 50/50, UNSTABLE 0, 704 skipped.
- `bun scripts/difftest.ts --suite run-fail-miri --sample 20` (after the fix, run `20261031-230004-harness-m6a-qnfh`):
  UNPORTED 20/20, UNSTABLE 0.
- The oracle toolchain check still passes (§1).

## For root

1. Record the Miri toolchain pin (`rust.miri`) and the subject decision (§3) if you want them in history.
2. When `src/miri/bin/miri.ts` exists, switch `miriSubject` to it (one line, harness batch).
3. `needs-*` directives are still not evaluated by compiletest.ts, so 250 run-pass and 48 run-fail tests are skipped.
   Many of them (`needs-unwind`, `needs-threads`) hold on x86_64-linux under Miri. Evaluating them would change the case
   lists of existing suites too, so it needs its own batch.
4. README: a line about `bun scripts/miri.ts setup` next to the oracle install instructions; README is outside this
   lane's files.
5. The Windows host needs its own `bun scripts/miri.ts setup`. The host tuple comes from the oracle, and binaries get
   `.exe`; I could not test this here.
