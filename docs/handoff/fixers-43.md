# Handoff: fixers-43, environment and driver findings

Branch `t3/fix-miri-env-panics`, on `9e11cc8b`. No gate and no full suite run. Host: root host, shared with other lanes, load 4 to 25.

## Result

| Item | Status |
|---|---|
| R1 `MIRI_CWD` | Fixed |
| R2 `MIRI_BE_RUSTC` | Fixed |
| R3 and the other readers | Fixed; list below |
| R5 `home_dir` | Fixed. The two interposer cases are held only by hand runs |
| cwd of 1,024 bytes or more | Fixed |
| `RUST_TS_IMPL` on Miri | Fixed |
| N1 five assertions | Fixed |
| O1 load order | Fixed |
| `rustc-env.rs` CRASH | **Did not reproduce: already fixed,** `docs/next.md` is stale |

All of these reproduced first except `rustc-env.rs`.

## Touched outside the named files

The brief names `miri.ts`, the driver and `env.ts`. These were needed for the oracle's exact text, and root may want to look at them first:

- **`src/rust_ts/track_caller.ts`.** Before this, `// rustc: src/tools/miri/...` markers were not owners, so every panic in a Miri frame was refused. Now:
  - Miri markers are owners, and `#[track_caller]` trait methods are indexed over Miri's sources too.
  - A file outside `compiler/` prints as `/rustc/<commit>/...`, which is what the oracle prints: `/rustc/6f5da406.../src/tools/miri/src/bin/miri.rs:425:13`.
  - `unwrap_result` and `expect_result` map to upstream's `.unwrap()` and `.expect(..)`. Every `Result` unwrap panic was refused before.
- **`src/std/result.ts`.** `unwrap_result` and `expect_result` call `unwrap_failed` as a bare statement, because a tail call dropped the frame the walk needs. This is only on the `Err` path.
- **`src/rustc_data_structures/jobserver.oracle.test.ts`.** The test "a non-UTF-8 value stops rather than guess" pinned the old `unported`. It now compares the two byte values with the oracle.

`track_caller_check.ts`, base to head: 4,481 to 4,506 sites, mapped-single 1,465 to 1,473, proven swaps 0 and 0, anchors 20 to 22 with 0 bad, ICE corpus 49 of 49 on both. `oracle binary` goes from 148 to 156 absent. I take those 8 to be the new Miri sites, as that check reads the rustc binary, but I did not list them. `PANIC_ENTRIES` there does not include `unwrap_result`, so the checker does not count those sites.

## What changed

**`src/std/env.ts`.** New `current_dir`, `current_dir_str`, `set_current_dir`, `debug_VarError`, `to_string_lossy`. `home_dir` now returns `OsString | undefined` and has a real `fallback` through `getpwuid_r`.

**R1.** `MIRI_CWD` is `var_os`, then `unwrap_result(set_current_dir(cwd), debug_IoError)`.

**R2.** `MIRI_BE_RUSTC` is `var_os` compared by bytes, with `debug_os_string` for the text. Upstream's panic goes to std's default hook here, so it installs a pass-through hook just before the panic, and an anchor names `425:13`.

**R5.** `unwrap(home_dir())` in the shim, with an anchor naming `1393:53`.

**cwd.** Every `process.cwd()` in production code is now `current_dir_str()`: `config.ts`, `source_map.ts`, `rustc_fs_util`, `std/path.ts`, `rustc_metadata/fs.ts`, the driver's ICE path, `passes.ts`, the Miri shim. The shim's `chdir` goes through `set_current_dir` too.

**`RUST_TS_IMPL`.** `miri.ts`'s entry follows `main.ts`: `shim` runs the oracle's Miri, `stub` stops with exit 70.

**N1.** The five sites are wrapped in `plain_bug`.

**O1.** The cycle is `data_structures.gen.ts` and `data_structures.ts`, entered from the wrong side by `rustc_middle/middle/codegen_fn_attrs.ts`, which imported the generated file directly. It now imports `data_structures.ts`.
- Real compiles are unaffected: a simulation of ESM evaluation over Bun's own import scan gives the same module order for `rustc_driver_impl/lib.ts` and `miri.ts` with and without the change.
- No other test file enters the cycle that way (597 scanned).
- `rustc_metadata/rmeta/encoder.ts:112`, `rust_ts/resdump_dump.ts:10` and `ty_mod_b.test.ts:16` also import the generated file by value. None is reached first today, but one could be.

## Findings for root

1. **`docs/next.md` is stale on `rustc-env.rs`** (lines 452 and 463). `775991c0` (fixers-40) fixed it, and `docs/handoff/fixers-40.md` says so. It MATCHes on this branch's base, and `20261105-231431-root-cru0` is the last run with the CRASH. The review's report predates the fix. `tests/ui/rustc-env/rust-log.rs` is the one UNPORTED left in that filter, a `RUSTC_LOG` directive, unrelated.
2. **Bun writes `Library/Caches/bun` into the cwd when `HOME` is set but empty.** With `HOME` unset it does not. My first test made one in the worktree. The tests here now run in a temp directory or pass `HOME`. Any test or case that runs Bun with `HOME=` from the repo would dirty the tree, and `gate.ts` checks that.
3. **A failed temp dir prints less on the port.** The oracle's `couldn't create a temp dir: File name too long (os error 63) at path "<dir>/rmetaXXXXXX"` has no ` at path ...` on the port (`rustc_metadata/fs.ts`, tempfile's `PathError`). Exit codes agree. This shows from a cwd of about 1,100 bytes or more, where `--emit=metadata` fails on both sides, and with `-o /dev/null`. The oracle's path holds a random name, so no comparison could score it. Not fixed.
4. **`POLONIUS_ALGORITHM=bad`** prints the right message but refuses the location: `no key for unwrap_result #1 of 2`. Exit 101 on both. A one-line anchor, `177:60`, would do it. Not asked for, not done.

## Readers (R3)

Every `process.env` read of a variable upstream reads with `env::var`, plus the `var_os` reads with a visible lossy effect. Each `\xff` case below was compared with the oracle by hand, after the fix, unless noted. **"Before" was reproduced on the base for `RUSTC_OVERRIDE_VERSION_STRING`, `RUSTC_CTFE_BACKTRACE`, the jobserver variables, `MIRI_CWD` and `MIRI_BE_RUSTC`. The other rows' "Before" comes from reading the old code.**

| Variable | Upstream | Before | Now |
|---|---|---|---|
| `RUSTC_OVERRIDE_VERSION_STRING` (driver) | `var` | wrong version, exit 0 | fixed |
| `RUSTC_CTFE_BACKTRACE` | `var` | exit 70 | fixed |
| `RUSTC_OVERRIDE_VERSION_STRING` (`version.ts`) | `var` | no effect; comment wrong | fixed |
| `RUSTC_GRAPHVIZ_FONT` | `var` | lossy font | fixed by reading; the review did not compare it, nor did I, so it is **not compared** |
| `RUSTC_BOOTSTRAP` | `var` | `foo,\xff` was `Cheat` | fixed. By reading, nightly treats `Cheat` and `Allow` alike, so I expect no visible change; the comparison after the fix is the same |
| `RUST_LIB_BACKTRACE`, `RUST_BACKTRACE` in `Backtrace::capture` | `var` | `Captured`, then `unported` | fixed. Unit test only: the delayed-bug route stops `unported` at `trigger_delayed_bug` first |
| `UNSTABLE_RUSTDOC_TEST_PATH`, `_LINE` | `var` | wrong branch; `NotPresent` only | fixed, with both `.expect` locations |
| `POLONIUS_ALGORITHM` (`tcx.env_var`) | `var` over `var_os` | wrong branch | fixed |
| `env_var_os` dep-info value | `to_str()` | lossy value recorded | fixed. The one case I compared (`UNSTABLE_RUSTDOC_TEST_PATH=\xff`, `--emit=dep-info`) gave the same file on both, so I did not show this differed before |
| `tracked_env::var` (`proc_macro/lib.ts`) | `var` | lossy | fixed by reading. No caller in `src`, so **not run** |
| `MAKEFLAGS`, `CARGO_MAKEFLAGS`, `MFLAGS` | `var_os`, `to_str()` | `unported`, also on a real U+FFFD | fixed |
| `RUSTC_ICE` | `var_os` | wrote to the U+FFFD path | fixed: `a\xffb` with `a\u{FFFD}b` present writes nothing, as the oracle does |
| `MIRI_CWD`, `MIRI_BE_RUSTC` | `var_os` | R1, R2 | fixed |

Left as they are, because the lossy value gives the same answer:
- `CARGO_PKG_VERSION_*` (creader): the lossy value fails the digit check, as `Err` does.
- `COLORTERM`, `TERM` (session and anstyle), `CLICOLOR*`, `NO_COLOR`, `CI`: compared with ASCII or `is_some`.
- `RUST_BACKTRACE` in `panicking.ts` and the driver: `var_os`, compared with ASCII.
- `RUST_MIN_STACK`: upstream is `to_string_lossy` too.
- `RUST_TARGET_PATH`, `RUSTC_FORCE_RUSTC_VERSION`, `CARGO_CRATE_NAME`, `RUSTC_LOG` in `session.ts`, `DUMP_OBLIGATION_FOREST_GRAPHVIZ`: `var_os` presence, or the same output by hand.
- `MIRI_BACKTRACE`: `to_string_lossy` upstream. `\xff` still stops `unported` for lack of `Backtrace`, as the review said.

No reader in `src` by grep, so nothing to fix: `RUST_DEP_GRAPH*`, `RUST_FORBID_DEP_GRAPH_EDGE`, `RAYON_*`, `QNX_TARGET`, `CARGO_PKG_NAME` at `passes.rs:328`, `*_DEPLOYMENT_TARGET` at `session.rs:389`, `PAGER`. I did not read each site. `RUSTC_BREAK_ON_ICE` is `#[cfg(windows)]` (`lib.ts:1312`).

## Evidence

**Hand comparisons,** exit and stderr against the oracle, masking the thread id and the backtrace's frames. An earlier version of my mask ate the ICE notes after the backtrace. I fixed it and reran all of these:

| What | Result |
|---|---|
| `MIRI_CWD`: `a\xffb` (with `a\u{FFFD}b` present), `/nonexistent`, empty, a file, the valid `a\u{FFFD}b` | 5 of 5 same |
| `MIRI_BE_RUSTC`: `x`, `\xff`, `\x01`, `\x7f`, U+00A0, U+0301, empty, quotes and escapes | 8 of 8 same |
| `home_dir` with an interposer on `getpwuid_r` and the host's `HOME` empty: real, `/pw\xff`, `/plain`, empty `pw_dir`, no entry; and `HOME` empty or set | 7 of 7 same |
| Readers above | same, except as noted |
| cwd of 1,023, 1,024, 1,140, 3,000 bytes: an error, `--print=sysroot`, `-Zremap-cwd-prefix`, the ICE report, a Miri program that calls `current_dir` and `set_current_dir` | same, except that a Miri run hits the temp-dir difference at 3,000 bytes (finding 3) |
| cwd of 1,140 bytes: `mod`, `-L`, `--out-dir`, `-Zmetrics-dir`, JSON errors | same |

A plain `rustc x.rs` from a long cwd differed only because my port command added `--sysroot`: the `--edition` note prints only for a bare `rustc <file>`. `-Cincremental` stops `unported` at any cwd, as before.

**Samples,** `RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=fixers-43`:

| Suite | Total | MATCH |
|---|---|---|
| `miri-hello` | 1 | 1 |
| `run-pass-miri` | 200 | 200 |
| `check-ui` | 200 | 200 |
| `mir` | 200 | 200 |
| `miri-hello --impl shim`, `--impl stub` | 1 | 1, 0 |
| `run-pass-miri --sample 8 --impl shim`, `--impl stub` | 8 | 8, 0 |

At the code head, after the last small edits: `miri-hello` 1 of 1, and `run-pass-miri` with another seed 30 of 30. The 200-case samples ran just before those edits.

**Unit tests.** `bunx tsc --noEmit -p .` is clean. `coverage.ts --check --offline`: `markers ok (24848; vendor 5086; library 605)`.
- At the code head: `src/std`, `src/rust_ts`, `src/rustc_driver_impl`, `jobserver.oracle`, `src/rustc_feature`, `src/rustc_ast/attr`, `src/proc_macro`, `src/rustc_fs_util`, `src/rustc_log`, `src/rustc_interface`, `typeck_impl`, `miri_env.oracle`: 472 pass, 0 fail. The first run had two failures, both fixed: a banned bare name in `track_caller.ts` and the old jobserver test.
- `src/miri`, `src/rustc_session`, `src/rustc_span`, `expr_a`, `matches_b`: 622 pass, 0 fail, before the last small edits (unused imports removed).
- `late_a`, `late_b`, `expr_a`, `matches_b`: 68 pass. With `emit_bug_diagnostic` acting as if the location resolved, still 68 pass (N1).

**Mutations,** on the new tests. 17 were killed: `process.cwd` for `getcwd`, `errno` read after `dlopen`, relative refresh, no refresh, no fallback, `/rustc-dev` for Miri, lossy `MIRI_CWD`, JSON escapes, no default hook, `stub` ignored, lossy override, lossy CTFE, `process.cwd` in `config.ts`, jobserver, no method mapping, lossy `RUST_LIB_BACKTRACE`, O1 reverted. One of my mutations was equivalent, as it only forced `ERANGE`.

**Not held by a committed test:** the interposer cases (a `pw_dir` that is not UTF-8, no passwd entry), which need a compiled dylib. `--impl shim` on Miri suites is checked only by the runs above.

**Unit time,** best of 3 at load about 7:
- `miri_env.oracle` 2.2 s wall, 3.5 s CPU.
- `env_reads.oracle` 2.1 s wall, 3.5 s CPU.
- `typeck_impl` about +0.3 s for its new test.
- `env.test` about +0.1 s.
- `jobserver.oracle`: not compared with its base. It has one more case than before, with no driver process.

That is about 4.7 s of wall time, under the 5 s budget, but **about 7.5 s of CPU, over it** if the budget is CPU. The stub test is the one to drop first, about 1 s of CPU.

## `unported`, `PORT`

No new `unported`. One removed: `jobserver::Client::from_env_ext`.

New `// PORT:`:
- `env.ts` `home_dir`, `current_dir`: `os.homedir()` and `process.cwd()` stand in only where libc is not read (Windows).
- `env.ts` `set_current_dir`: refreshes Bun's cached cwd by absolute path. `path.resolve` and `realpathSync` read that copy, not the OS's, and `process.chdir` resolves a relative path against it.
- `miri.ts`: the pass-through hook.
- `driver lib.ts`: `ICE_PATH_OS`.
- `passes.ts`, `context.ts`: a lossy `&OsStr`, with `env_var` checking `to_str()` through `var_`.

Under a cwd of 1,024 bytes or more, Bun's cached cwd cannot be refreshed. So `path.resolve("rel")` and `realpathSync("rel")` read a wrong base there, which is `~/.bun/bin` when the process started in such a cwd. I found no production call that takes a relative path through `path.resolve`. `try_canonicalize`, `canonicalize` and `output_contains_path` use `realpath`, and the comparisons above match, but I did not test each with a relative path that exists only there.

## Not checked

- Linux and Windows. `GETPW_R`'s Linux values (`_SC_GETPW_R_SIZE_MAX` 70, `pw_dir` at 32) and `__errno_location` are from memory of glibc, not run. On macOS, `pw_dir` at 48 was checked by the interposer.
- A directory really named with non-UTF-8 bytes. APFS refuses one, so the `MIRI_CWD` and `RUSTC_ICE` byte paths only show `ENOENT` here.
- `errno` read by a second FFI call: nothing between the two calls should change it, and the tests saw the right code, but it is not the same guarantee as Rust's direct read.
- `HOME` or `XDG_CACHE_HOME` over 1,023 bytes (Bun panics at start) and start-up cost in the number of entries, both from the review's "Seen" list: not in this brief.
- The gate, full suites, and the full unit step, as instructed.
