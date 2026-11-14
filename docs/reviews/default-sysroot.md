# Review: lane `default-sysroot` (wave 40r)

Reviewer: independent, read-only on code (AGENTS.md §1). Subject: `t3/port-default-sysroot`, `77d16dbc` (code) and `e3e5797d`
(handoff), on main `e80bc814`. Review branch `t3/review-default-sysroot-r`, on `e3e5797d`. Upstream pin `6f5da406b56c`.

## Verdict: FAIL (one F, small to fix)

The code is right:
- The default sysroot is the oracle's exact string.
- `Session::get_tools_search_paths` is faithful.
- N1–N4 are right.
- No protected case is lost in any sample.

**The lazy getter is accepted as the mechanism. It must stay.** But the reason it gives is wrong (F1). It is not a pure
`PORT(perf)`: an eager read loses every protected Miri case, and protected output depends on the laziness. The comments and the
recorded decision must say that, and a named test must guard it. Then this is APPROVE WITH NITS.

## Findings

### F1 (must fix): the lazy read is load-bearing, not a perf memo. Its comment and decision say otherwise

`src/rustc_session/config.ts:1722-1737` (PORT(perf) on `Sysroot.default_` / `Sysroot.new`) and `src/rustc_session/filesearch.ts:182`.
Upstream: `compiler/rustc_session/src/config.rs:1437` `Sysroot::new` computes `default: filesearch::default_sysroot()` eagerly.

The comment says the value is the same, that only the point where a failure stops moves, and that "Upstream has no such failure". The
2026-11-14T13:31 decision repeats this. Both are false in two environments the harness runs:

1. **Miri cases.**
   - Every Miri suite runs the subject with `MIRI_CASE_ENV` (harness/suites.ts:1670, 1729, 1917, 2033). That sets
     `RUSTUP_HOME=$RUST_TS_DATA/rustup-miri`.
   - Under it, `rustc +nightly --print sysroot` fails: `error: toolchain 'nightly-aarch64-apple-darwin' is not installed`. The
     isolated home holds only `nightly-2026-10-11-<host>`.
   - With the eager read (`Sysroot.new` calling `default_sysroot()`, in a scratch worktree of `e3e5797d`), the protected `miri-hello`
     case becomes **UNPORTED**: `rustc_session::filesearch::default_sysroot (rustc +nightly --print sysroot failed: error: toolchain
     'nightly-aarch64-apple-darwin' is not installed)`. Run `20261114-133718-rev-default-sysroot-eager-sn9l`.
   - Every other Miri case runs the same way, so the eager read would lose the same: run-pass-miri 3468, run-pass-aux-miri 356,
     miri-pass 346, run-pass-miri-heavy 6, miri-hello 1.
2. **Minimal environments.**
   - The eager mutation also fails 4 unit tests that run the subject with only `HOME` set (no `PATH`):
     - `src/rustc_driver_impl/env_reads.oracle.test.ts`: three tests, for example "RUSTC_OVERRIDE_VERSION_STRING that is not UTF-8
       counts as unset".
     - `src/miri/bin/miri_env.oracle.test.ts`: "MIRI_CWD is the variable's bytes".
   - Upstream works there. Here `rustc` is not found, so the read stops.

So laziness is what keeps those cases MATCH. It is a semantic stand-in decision: PORTING §3 allows `PORT(perf)` only "if it cannot
show in any output", and this one shows. In both environments the port cannot compute the default at all. Upstream always can,
because it derives the default from its own binary.

Fix:
- **(a)** Reword both comments: the default is read lazily because the oracle cannot be asked in every environment the port runs in
  (Miri's isolated `RUSTUP_HOME`, a cleared `PATH`), and any reader that is reached there stops `unported`. Keep the speed note as
  secondary. Drop "Upstream has no such failure" and "the value is the same" as the justification.
- **(b)** Root records a corrected decision, replacing the 13:31 one.
- **(c)** Add a test that names this guard and fails when `Sysroot::new` reads eagerly. For example, a rustc_session test: a
  `--sysroot <S> --emit=metadata` compile under `RUSTUP_HOME=<empty dir>`, or with `PATH` lacking `rustc`, exits 0. Or a unit test
  that `Sysroot.new(explicit)` followed by `path()` never calls `default_sysroot`.
  - Today the four tests above catch an eager read only by accident, and `miri-hello` only at gate time.

### N1: in a Miri process the port's default sysroot is not upstream Miri's

- Upstream Miri's default is its own toolchain: `$RUST_TS_DATA/rustup-miri/toolchains/nightly-2026-10-11-<host>` (dladdr of its
  `librustc_driver`, filesearch.rs:279-345).
- The port's default stops `unported` there (F1.1). Nothing reaches it today: Miri reads the sysroot only in `get_codegen_backend`
  (`path()`, explicit) and never links.
- Any future reader on a Miri path (an `all_paths` caller, `--print sysroot` under Miri) would stop. Note it for the Miri owner: the
  default in a Miri process could be the Miri toolchain's.

### N2: the tests do not observe `all_paths` order or the self-contained branch

Two mutations survive, both reverted:
- `config.ts:1749` `all_paths` order swapped to `[default, explicit]` (M2).
- `session.ts:800` flatMap order swapped to `[self-contained, path]` (M4).

`bun test ./src/rustc_codegen_ssa/back/`: 96 pass, 0 fail for each.

Why they survive:
- Every `linker_args.oracle.test.ts` case passes `--sysroot` equal to the default, so explicit and default are the same string.
- No case takes `self_contained`.

Both lines are right by reading: config.rs:1447 lists explicit then default, and session.rs:836 lists `[path.clone(),
path.join("self-contained")]`. But the "PATH is compared" evidence in the handoff does not cover them. Fix: add a linker case with a
`--sysroot` different from the default (for example an empty dir), and one with self-contained tools (for example
`-Clink-self-contained=+linker` on a target that honours it, or a musl/wasm target with the fake linker), both compared with the
oracle's `PATH`.

### N3: the measured gain is smaller than recorded

- The handoff says about 52 ms. Here `rustc +nightly --print sysroot` from Bun took a **20.0 ms median, 17.2 ms min** (15 spawns, load
  about 40).
- Whole compiles (`--crate-type=lib --emit=metadata --sysroot <S>`, 12 interleaved runs each, load 40–67) cannot be told apart:

  | Tree | Median | Min |
  |---|---|---|
  | main `e80bc814` | 1032 ms | 752 ms |
  | this branch | 1037 ms | 720 ms |
  | eager variant | 1040 ms | 781 ms |

- This does not change the verdict: F1 makes laziness required anyway. But the decision should not rest on 52 ms.

### N4: follow-ups the handoff already lists, confirmed

- `src/rust_ts/llvm/tools.ts:67` `oracle_sysroot` uses `.trim()`; `filesearch.ts:208` strips only the `println!` newline. They agree
  for every real path. Two spawns per process that both links and uses LLVM tools. Unify later, owner of `src/rust_ts/llvm/`.
- `link.ts:2309` xlane comment "lives in back/linker.ts until rustc_session takes it" is stale (ssa-link-b).
- `harness/cli.ts:21` and `harness/target-specs.ts:12` comments are stale (harness batch).

## Checks

### 1. The default sysroot

- The port's `--print sysroot` (no `--sysroot`) prints
  `/Users/tomernorman/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin`. That is byte-identical to
  `rustc +nightly --print sysroot` without its newline (`od -c`: one trailing `\n`).
- `--print target-libdir` likewise.
- It equals `tools.ts` `oracle_sysroot` and `scripts/lib/oracle.ts` `oracleSysroot`: same command, same `RUSTUP_AUTO_INSTALL=0`
  environment. `linker_args.oracle.test.ts:172` asserts it.
- **Placeholder:** `DEFAULT_SYSROOT_STANDIN`, `displayed_sysroot_path` and "default sysroot unported" appear nowhere in src, harness,
  scripts or tools.
- **Upstream branches:**
  - At the pin, `default_sysroot` (filesearch.rs:279) is `from_env_args_next` (argv[0] when it is a symlink) or else
    `default_from_rustc_driver_dll(...).expect("Failed finding sysroot")`.
  - There is no `get_or_default_sysroot` and no environment override (no `RUST_SYSROOT`-style variable in compiler/ or miri/src).
  - `--sysroot` precedence is `Sysroot::path` (config.rs:1442): explicit, else default. The port matches (config.ts:1744).
  - `all_paths` (config.rs:1447) lists explicit, then default. The port matches (config.ts:1749).
  - The port's default stands in for both upstream branches by asking the oracle in the same environment, so it equals the oracle's
    by construction. The exceptions are F1's environments, where it stops rather than guess.
  - `default_sysroot` has no marker. That is right: its body is the decided stand-in, not upstream logic.

### 2. Adversarial: the lazy getter

**Readers.**
- `default_` is read by `path()`: config.ts:3321, :3360; session.ts:1398, :1424, :1442-1444; interface.ts:407;
  rustc_driver_impl/lib.ts:710, :1150; util.ts:244 (unported text only); link.ts:1417; linker.ts:1367 (MSVC).
- It is read by `all_paths()`: session.ts:794, used by `get_linker`, and by `strip_with_external_utility` through link.ts:1593.
- It is read directly at link.ts:1754 (sanitizer runtime).
- Upstream's other `all_paths` users are `get_codegen_sysroot` (util.rs:547, a non-builtin backend: unported here), Enzyme and
  offload (llvm, unported), and cg_gcc.

**Ordering.**
- Without `--sysroot`, the first read is `real_source_base_dir` inside `build_session_options`. That is the same point as upstream's
  eager compute.
- With `--sysroot`, only link-time readers touch it. Those sit behind `self_contained_components` (an ssa-link-b xlane stub that is
  still unported), so no protected case reaches them.
- The only side effect that can be seen is the `unported` stop. Its exit code (70) is UNPORTED wherever it fires, so moving it cannot
  turn a protected MATCH into DIFF. It can only, as F1 shows, avoid a loss.

**Value stability.**
- The getter caches per instance. `filesearch.ts` caches per process (`DEFAULT_SYSROOT`), so all `Sysroot` instances (Options
  default, `build_session_options`, the driver's `Sysroot::new`) share one value.
- Proc macros load in-process. The `ensure_stack` re-exec parent never imports the session.
- A failure is not cached, so a caught `Unported` retries. That does not matter: an unported stop ends a real run.
- A separate process (Miri's `RUSTUP_HOME`) does see a different outcome. That is F1 and N1.

**No spawn on a protected `--sysroot` compile:**
- `PATH=/usr/bin:/bin` (no `rustc`): `--crate-type=lib --emit=metadata --sysroot <S>` exits 0 and writes `libok.rmeta`. A file with a
  type error gives E0308 and exit 1, both as expected.
- A fake `rustc` that logs its calls, first in `PATH`: the metadata compile and the error compile log **no calls**.
- `--emit=mir` (codegen) logs one `rustc +nightly --print sysroot`. A failing fake shows it comes from `tools.ts` (`llir: cannot find
  the pinned LLVM tools`), which predates this lane, and not from `default_sysroot`.

**Startup:** see N3.

### 3. `Session::get_tools_search_paths`

- session.ts:792-803 matches session.rs:825-840 line for line: the `all_paths` map through `make_target_bin_path(_, host_tuple())`,
  and the self-contained flatMap `[path, path/self-contained]`, with comments kept.
- The marker `session.rs:825` is the `fn` line.
- It is placed after `wasm_proc_macro_filesearch` and before `is_rust_2015`, as upstream.
- `linker.ts:102` keeps the exported name as a marker-less forwarder (PORT note). link.ts imports it, and `get_linker` calls the
  session method directly, as upstream does.

### 4. ssa-linker N1–N4

- **N3 `ExitStatus.success`:**
  - std at the pin: `process.rs:1986` `success` = `self.0.exit_ok().is_ok()`. `sys/process/unix/unix.rs:1109` `exit_ok` is `Ok` iff
    `NonZero::try_from(self.0)` fails, that is, iff the wait status is 0. So `_0 === 0` is exact, and the `// after std:` line numbers
    (1986, 1109, os/unix/process.rs:420, unix.rs:1125) are right.
  - The port builds statuses only in `command.ts:448-455`: `(exitCode & 0xff) << 8`, or a signal number (1–31, never 0, never `0x7f`).
  - In the exit branch, `_0 === 0` iff `exitCode & 0xff === 0` iff the old `code() === 0`.
  - In the signal branch, the old `code()` was `undefined`, so false, and the new check `_0 !== 0` is also false.
  - So the old and new checks are equal for every status the port builds.
- **`debug_os_str = debug_str`:** `src/std/fmt.ts:212` is the removed body exactly.
- **N1, N2:** PORT notes only (linker.ts AIX / MSVC natvis).
- **N4:** `regen.ts` now requires exit 0 for every case. The lane reran it with no fixture diff. I did not rerun it (it writes
  fixtures).

### 5. Tests outside the file list

- `print.oracle.test.ts`: `--print sysroot` and `--print target-libdir` without `--sysroot` are now `exact`, which compares stderr,
  stdout and code with a live oracle run. They pass. They fail under M1 (below), so they observe the value.
- `driver.oracle.test.ts`: the two PENDING texts are the port's stop. The PENDING check still demands that the oracle's output start
  with everything printed before it, and an exact match if the stop moves. So it is oracle-derived.
- `rustc_driver_impl/lib.ts:710/713`: these print `path()` / `target_tlib_path.dir` directly, as upstream does
  (rustc_driver_impl lib.rs `Sysroot` / `TargetLibdir` arms).

### 6. Protected suites

`--sample 200 --jobs 6`, `RUST_TS_AGENT=rev-default-sysroot-r1`:

| Suite | Result | Run |
|---|---|---|
| check-ui | MATCH 200/200 | 20261114-133538-rev-default-sysroot-r1-m4q9 |
| pm-ui | MATCH 200/200 (2 skipped) | 20261114-133614-rev-default-sysroot-r1-656l |
| mir | MATCH 200/200 (1 skipped) | 20261114-133650-rev-default-sysroot-r1-dvp6 |
| run-pass-miri | MATCH 199, UNPORTED 1 (497 skipped) | 20261114-133726-rev-default-sysroot-r1-e9q1 |
| mono-ui | MATCH 199, UNPORTED 1 (488 skipped) | 20261114-133934-rev-default-sysroot-r1-l2fv |

- Both UNPORTED cases are `tests/ui/attributes/log-backtrace.rs`, stopping in
  `rustc_log::BacktraceFormatter (a Rust backtrace, RUSTC_LOG_BACKTRACE)`. That is not a sysroot path, and the case is not in either
  baseline. **No protected case is lost.**
- **Miri's sysroot:** the harness passes `--sysroot $RUST_TS_DATA/miri-sysroot`. The interpreter never reads the default, so the
  result is unchanged, *because* the read is lazy (F1).

### 7. Commands

- `bunx tsc`: clean (exit 0).
- `bun scripts/coverage.ts --check`: markers ok (27155).
- `--missing`: session.rs 97/104 (the 7 left are not this lane's); filesearch.rs 7/14 (unmarked on purpose, as the handoff says).
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_session/ ./src/rustc_codegen_ssa/back/ ./src/rustc_interface/ ./src/rustc_driver_impl/ ./src/std/ ./scripts/lib/unit-steps.test.ts`:
  **512 pass, 0 fail** (52 files, 307.7 s).

**Mutations** (each reverted with `git checkout`; the tree is clean):

| | Mutation | Result |
|---|---|---|
| M1 | no trailing-newline strip (`filesearch.ts:208`) | **caught**: 3 fail (`linker_args` PATH test, `--print sysroot`, `--print target-libdir`) |
| M2 | `all_paths` order swapped (`config.ts:1749`) | **survives**: 96/96 pass (N2) |
| M4 | self-contained order swapped (`session.ts:800`) | **survives**: 96/96 pass (N2) |
| M3 | eager `Sysroot.new` | 4 fail, only by accident (minimal environment), plus `miri-hello` UNPORTED in difftest (F1) |
