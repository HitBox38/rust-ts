REQUEST CHANGES: `RUST_TS_IMPL=shim` on the Miri entry makes rustup download an unpinned 1.3 GB nightly into the isolated Miri home (F1). Everything else holds or is low or a nit.

# Independent review: fixers-43

Branch `t3/fix-miri-env-panics`, head `8c0fcc40`, against `main` at `9e11cc8b`. Host: root host, AC power, load 2.5 to 12, other lanes running. `RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=review-fixers-43`. No gate and no full suite. The one suite-sized run is the 118 ICE cases, which check 1 asks for.

F1 does not touch the default path or the gate: `scripts/gate.ts` never passes `--impl`. It only needs a small fix and a decision from root on the stray toolchain. The ICE report, the readers, the cwd work, O1 and N1 all hold.

## Findings

| # | Severity | Where | Finding | Failing scenario | Evidence |
|---|---|---|---|---|---|
| F1 | **blocks** | `src/miri/bin/miri.ts:964-965`, through `scripts/lib/miri.ts:84,92` and `scripts/lib/oracle.ts:101` | The new shim path calls `miriBinary()`, which calls `oracleHost()`, which runs `rustc +nightly -vV`. A Miri case runs with `RUSTUP_HOME=$DATA/rustup-miri`, where `nightly` is not the pin, so rustup auto-installs today's nightly. | `difftest --suite miri-hello --impl shim` on a Miri home without a `nightly` toolchain. It happened: see below. | Trace reproduced. The download itself is inferred from timestamps, as I did not repeat it. |
| F2 | low | `src/rustc_fs_util/lib.ts:19`, `src/rustc_interface/passes.ts:547`, `src/miri/bin/miri.ts:218` | From a cwd of 1,024 bytes or more, `realpathSync` on a relative path resolves against Bun's stale cwd, `~/.bun/bin`. The handoff flags this as untested. It does differ. | In a 1,219-byte cwd, `rustc ext.rs --extern lib=bun --emit=dep-info`. The oracle says `extern location for lib does not exist: bun`, and the port says `extern location for lib is not a file: bun`. `realpathSync("bun")` returns `~/.bun/bin/bun`. Exit 1 on both. | Reproduced. |
| F3 | low | `src/rustc_target/spec/mod.ts:2785` | `RUST_TARGET_PATH` is still lossy, and the handoff's "left as they are" list is wrong to include it. It is not a presence check: it names directories. Same class as R1. | `RUST_TARGET_PATH=a\xffb` with `a\u{FFFD}b/mytgt.json` present, `--target mytgt`. The oracle exits 1, `could not find specification`. The port finds the file and stops `unported: Target::from_json`, exit 70. It becomes a silent wrong answer once `from_json` is ported. No suite sees it, as the harness scrubs this variable. | Reproduced. |
| F4 | nit | `src/std/path.ts:747`, `src/rustc_interface/passes.ts:582` | Upstream's `env::current_dir()?` became `unwrap_result`, in functions that can report the error. PORTING section 5 says `?` is a return. `rustc_fs_util/lib.ts:56-58` does it correctly. | The cwd is removed while a compile runs: upstream's `try_canonicalize` returns `Err`, the port panics. From a normal start `config.ts` stops first (`Current directory is invalid`, compared and equal). Not a regression: `process.cwd()` threw here too. | Read only. |
| F5 | nit | `src/std/env.ts:271`, `:146-152` | The Linux values are not guesses after all, but nothing in the tree says where they come from. See check 4. | Not a failure: every value agrees with the pinned sources. | Read against pinned sources. |
| F6 | nit | `src/std/env.ts:332-336` | The comment says refreshing Bun's cwd "fails harmlessly" on a non-UTF-8 path. If `a\u{FFFD}b` also exists, the lossy `process.chdir` succeeds and moves the process to the wrong directory. | Linux only: `set_current_dir("a\xffb")` with both directories present. APFS refuses such a name, so this cannot arise on the root host. Fix: refresh only when `lossy.decode` round-trips to the same bytes. | Read only. |
| F7 | nit | `src/rust_ts/track_caller_check.ts:196` | `PANIC_ENTRIES` still lacks `unwrap_result` and `expect_result`, so the checker cannot see the 79 sites this batch makes resolvable. `binary_check` also has only rustc's dylib, so a Miri location can never be witnessed. | A later edit swaps two `.unwrap()` ports: `track_caller_check.ts` stays silent. The handoff says the first half. I did the check by hand once (check 1); it is not held. | Read; the hand check is reproducible. |
| F8 | nit | `docs/next.md:19` | The stale `rustc-env.rs` claim is on line 19 too, not only 452 and 463. | Root updates the two lines the handoff names and leaves the top of the queue wrong. | Read. |

**F1 in detail.**

| When (2026-11-06, local) | What |
|---|---|
| 22:23:39 | The lane's run directory `fixers-43-hello-shim` is created |
| 22:23:46 | `$DATA/rustup-miri/toolchains/nightly-aarch64-apple-darwin` is created, 7 s later |
| 22:24:11 | `update-hashes/nightly-aarch64-apple-darwin` is written |
| 22:24:19 | `fixers-43-rp-shim` starts |

The earlier toolchain in that home dates from Nov 1. A logging `rustc` first on `PATH` shows the cause:

```
impl=shim: rustc +nightly -vV RUSTUP_HOME=<DATA>/rustup-miri
impl=port: (no rustc call)
```

What it costs:
- **A network download during a test run,** silently. On a fresh or offline host the shim would stall or `die`.
- **1.3 GB,** with 12 GB free on the disk.
- **A wrong compiler behind a familiar name.** `rustc +nightly` under that `RUSTUP_HOME` is now `249c1e4e3 2026-11-05`, not the pin. In `~/.rustup` the same name is a symlink to the pin, so the two homes now disagree. I hit this by accident: a command of mine with that `RUSTUP_HOME` got `lib.rs:403:26` from the wrong compiler where the pin says `402:26`. It used the existing toolchain and downloaded nothing (`update-hashes` still reads 22:24:11). I reran those comparisons in the real environment.

What it does not touch: the oracle (`~/.rustup/toolchains/nightly-2026-10-11-*`, commit `6f5da406b`), and the pinned Miri toolchain (Nov 1). `oracleHost` only reads the host here, so `--impl shim` still scores 100%.

**Fix.** Do not reach `oracleHost()` under the case's `RUSTUP_HOME`. The smallest change is in `miri.ts`: build the binary's path from `MIRI_RUSTUP_HOME`, `PIN.nightlyName` and the `RUST_TS_HOST_TUPLE` that `config.ts:1632` already reads. A `scripts/` fix needs its own reviewed batch. A test should hold it: run the shim with a `rustc` on `PATH` that fails, and expect the oracle's output. **Root decides whether to delete the stray toolchain. I did not touch it.**

**F2's fix.** Join a relative path to `current_dir_str()` before `realpathSync`. The absolute form gives `ENAMETOOLONG` there (run), so the existing fallback to `absolute` applies, which is what the oracle does. Real relative paths in the long cwd already agree: `rel/liblib.rmeta` takes the fallback on both sides. So this shows only for a name that exists in `~/.bun/bin`. Base stopped loudly at this cwd, so the batch opens the path.

## Checks

### 1. `track_caller.ts`, `result.ts`: holds

**`track_caller_check.ts`, base to head.** Same as the handoff: 4,481 to 4,506 sites, mapped-single 1,465 to 1,473, 0 proven swaps on both, anchors 20 to 22 with 0 bad, ICE corpus 49 of 49, `oracle binary` 148 to 156 absent. Two things the handoff left open:
- **The 8 new absences are Miri sites, confirmed.** All 8 are `src/tools/miri/...`, and I extracted the `Location` constants from Miri's own binary: all 8 are in it.
- **`self-named tail calls` rises from 30 to 43, not mentioned.** Harmless: 11 are compiler or Miri `insert`s, listed only because Miri's `#[track_caller]` `insert` adds the name, and 2 are Miri `write`s whose callee is not `#[track_caller]`. The hole needs a tracked callee of the same name.

**The 92 of 118 holds: no better, no worse.** My copy of `cmp-impl.ts` with fresh oracle output, on both sides:

| Side | MATCH | DIFF (`RUST_BACKTRACE=short`) | STOP |
|---|---|---|---|
| base | 92 | 21 | 5 |
| head | 92 | 21 | 5 |

- **All 236 stdout and stderr files are identical between base and head** after masking the thread id. So no existing case moved a location, and none changed from refused to resolved.
- The port's location list equals the oracle's in 113 of 118. The other 5 are the `STOP`s, which print none.
- None of the 118 has a Miri frame or a `Result` unwrap, so this says nothing about the new mappings. That needs the next part.

**Does a refused location now resolve wrongly? I found none.** Every call of the new names, through the resolver's own `map_call`, against the `Location` constants of the oracle's binaries:

| Sites | Total | Refused | No owner | Mapped | Witnessed | Other column | Absent |
|---|---|---|---|---|---|---|---|
| Miri, panic entries | 630 | 354 | 58 | 218 | 197 | 1 | 20 |
| Miri, `unwrap_result`/`expect_result` | 32 | 12 | 6 | 14 | 10 | 0 | 4 |
| Compiler, `unwrap_result`/`expect_result` | 116 | 35 | 16 | 65 | 56 | 0 | 9 |

- **Witnessed in the binary: 263 of 297.** I read the other 34 against upstream, and all are the same call. Absence means compiled out or inlined. The one "other column" is `borrow_tracker/mod.rs:321`, where the column seen belongs to `.borrow()` on the same line.
- I also read the 70 sites whose TS and upstream lines share few identifiers: mostly `unreachable()` and multi-line calls. All are the same call.
- **Why this is safe by construction.** `.unwrap()` has no key, so an upstream fn with two or more refuses (`no key`). A `Result` unwrap maps only when both sides have exactly one. A wrong mapping would need one TS `unwrap_result` and one unrelated upstream `.unwrap()` in the same fn. None exists today, but only by this hand check (F7).
- **Trait index.** Miri adds 2 traits with `#[track_caller]` methods: `EvalContextPrivExt::get_tree_borrows_params` and `EvalContextExt::read_handle`. No `compiler/` impl has either trait name, so no compiler fn changes class.
- **`/rustc/<commit>`** for non-`compiler/` paths agrees with what the oracle's Miri prints.
- **`result.ts`.** The bare statement changes only the `Err` path. `unwrap_failed` joining `PANIC_INTERNALS` leaves `unwrap_result` as the entry the walk compares.
- **`POLONIUS_ALGORITHM=bad`** refuses, as the handoff says: right message, exit 101. A refusal is fine.

**End to end, against the oracle:**

| Case | Result |
|---|---|
| `MIRI_CWD` a file, or `/nonexistent` | same, `miri.rs:169:39` |
| `MIRI_BE_RUSTC=x`, `=host --version` | same, `miri.rs:425:13` for the first |
| `UNSTABLE_RUSTDOC_TEST_LINE=abc`, unset | same, `lib.rs:402:26` and `396:71` |
| `UNSTABLE_RUSTDOC_TEST_LINE=3`, `UNSTABLE_RUSTDOC_TEST_PATH=\xff` | same |

### 2. Env readers: hold, except F3

`\xff` and related values, run against the oracle on exit, stdout and stderr:

| Reader | Upstream | Result |
|---|---|---|
| `RUSTC_GRAPHVIZ_FONT`, which the lane did not compare | `var` | Same with `-Zunpretty=mir-cfg` on unset, `Foo`, `a\xffb` (falls back to Courier), `a\u{FFFD}b` (used as given) |
| `proc_macro::tracked::env_var`, which the lane did not run | `var` | Same with a real proc-macro dylib: `Err(NotUnicode("\xFF"))`, `Ok("x")`. `--emit=dep-info` byte-identical for `\xff` and for U+FFFD |
| `env!`, `option_env!` | `var` | Same |
| `POLONIUS_ALGORITHM=\xff` | `var` over `var_os` | Same |
| `RUSTC_ICE=/nonexistent/\xff`, `a\xffb` | `var_os` | Same apart from the port's `rust-ts prints the JS stack` note. Nothing lands in `a\u{FFFD}b` |
| `RUST_TARGET_PATH` | `var_os`, a path | **Differs: F3** |

- **The dylib is the real `tracked::env_var` path.** It carries its own std and reaches the port only through `track_env_var`. The TS `tracked.env_var` in `src/proc_macro/lib.ts` has no caller and needs a bridge, so I only read it. It matches upstream.
- **`RUSTC_FORCE_RUSTC_VERSION`, `RUST_MIN_STACK`, `MIRI_BACKTRACE`** are `to_string_lossy` upstream. Five byte forms (`\xed\xa0\x80`, `a\xe2\x82`, `\xff`, `\xf0\x9f`, `\xc0\x80`) decode identically in Bun's `process.env` and in Rust's lossy decode.
- **No wrong answer possible, at any value, because the port stops:** `--print deployment-target` (`apple_deployment_target`) and `-Zmacro-stats` (which holds `CARGO_PKG_NAME`) both exit 70.
- I read the rest of the handoff's "left as they are" list against upstream, and only `RUST_TARGET_PATH` is wrong. `DUMP_OBLIGATION_FOREST_GRAPHVIZ` is `var_os(..).is_none()` upstream (`graphviz.rs:27`), so that one is right.

### 3. cwd of 1,024 bytes or more: holds, with F2

**No new FFI load.** `std/env.ts`, `std/io.ts` and `rust_ts/stack.ts` already import `bun:ffi` at the top on `main`, and `env_libc()` already opened on the first `var_os`.

| What | Cost |
|---|---|
| The 5 extra symbols, in `dlopen` | about 0.1 ms |
| The `errno` `dlopen`, which is new and runs on the first `current_dir` | about 0.04 ms |

Instructions, alternating, both sides from comparable worktrees under the scratchpad:

| Program | Runs each | Base median (range) G | Head median (range) G | Change |
|---|---|---|---|---|
| hello, std, `--emit=metadata` | 11 | 9.928 (9.709-9.995) | 9.940 (9.747-10.015) | +0.12% |
| `miri-hello` | 7 | 21.675 (21.577-22.067) | 21.683 (21.631-21.848) | +0.04% |

Both are inside the noise.

- **Bytes.** `current_dir` and `set_current_dir` work on bytes as upstream does, with the same 512-and-double loop. `current_dir_str` is lossy where the port's `PathBuf` is a `string` (PORTING section 5), and `MIRI_CWD` keeps its bytes.
- **`process.cwd()`** remains only in the Windows branch of `env.ts`, so it cannot disagree after a `chdir` on a libc host. What can is Bun's cached cwd behind `realpathSync`: F2.
- **Long cwd against the oracle, 1,219 bytes:** `-L rel`, `-L dependency=rel`, `-L ./rel/../rel`, `--extern rel/...`, `--extern ./rel/../rel/...`, `@args.txt`, `--remap-path-prefix`, `#[path]`, `include_str!`, a relative symlinked `--sysroot`, dep-info files. All the same. The missing ` at path ...` in the temp-dir error is the handoff's finding 3, reproduced.
- **A deleted cwd.** Errors and exits equal the oracle, except for one `shell-init: error retrieving current directory` line from `stack.ts`'s re-exec. It is on base too; see the end.
- **Windows.** Read only, not run: `bun:ffi` was already imported there, every `dlopen` stays lazy, and `current_dir`, `set_current_dir` and `home_dir` take their `!ENV_FROM_LIBC` branches first. The import should not break.

### 4. `home_dir`'s `getpwuid_r`: not a guess any more, but say so

On Linux it **would run,** not stop. It does not need `unported`, because every value is in the pinned sources:

| Value | Source | Agrees |
|---|---|---|
| Linux `_SC_GETPW_R_SIZE_MAX` = 70 | `libc-0.2.189/src/unix/linux_like/linux_l4re_shared.rs:536` | yes |
| Linux `pw_dir` at 32 | same file, `:49-57` | yes (name 0, passwd 8, uid 16, gid 20, gecos 24, dir 32) |
| `__errno_location` | `library/std/src/sys/io/error/unix.rs:22` | yes |
| macOS `_SC_GETPW_R_SIZE_MAX` = 71 | `src/unix/bsd/apple/mod.rs:2514` | yes |
| macOS `pw_dir` at 48 | `src/unix/bsd/mod.rs:31-39` | yes |
| `__error` | `library/std/src/sys/io/error/unix.rs:39` | yes |

**What it should do (F5):** keep running, with those paths in a comment beside `GETPW_R` in place of "from memory". The first Linux VM pass must run `env.test.ts`'s `home_dir` test. Without the citation, the honest alternative is `unported` on Linux. `libc.so.6` on a musl host would make `dlopen` throw, which predates this batch and is loud.

### 5. Miri `RUST_TS_IMPL`: the default path is untouched, the shim is not safe (F1)

- `--impl shim` 1 of 1, `--impl stub` 0 of 1 (UNPORTED), default 1 of 1: all reproduced on `miri-hello`.
- **The default path:** one `var_os` read and no process, as the trace shows, then `ensure_stack()` and `main()` as before, now inside the `try` as in `main.ts`. A second `ensure_stack` does nothing after `miri_stack_first.ts`.
- **Time:** +0.04%, which is noise (table in check 3).
- **The module now has a top-level `await`.** Importers still work: `src/miri/bin` passes, and `run-pass-miri` is 200 of 200.

### 6. O1: holds, and now measured rather than simulated

A preload logged each module's real evaluation, with the O1 change undone in memory where needed. Entries: `main.ts`'s static imports then the driver (2,059 modules), and `stack.ts` then `miri.ts` (2,245).

| Comparison | rustc | Miri |
|---|---|---|
| Head against head without O1 | identical | identical |
| Base against head, the whole batch | identical | **4 modules differ** |

- **The Miri difference** comes from this batch's `env.ts` importing `io.ts`: `std/panic.ts` and `std/io.ts` move among the first 43 modules. Both are leaves with no interner, so I expect no effect, and 400 Miri sample cases match. The handoff's claim is about O1 and is true. This is the rest of the batch.
- **`typeck_impl.test.ts` alone:** head 17 pass, 0 fail; base 0 pass, 1 error. Reproduced.
- The other importers the handoff lists are not reached first today: `ty_mod_b.test.ts` alone passes (13). Importing `data_structures.gen.ts` first still fails, so the hazard stays, as the handoff says.

### 7. N1: meaningful

- All five messages are upstream's: `as_place.rs:265`, `as_constant.rs:210`, `matches/test.rs:37`, `late.rs:283`, `late.rs:4322`.
- With `emit_bug_diagnostic` acting as if the location resolved, all 68 still pass, so check3's N1 scenario is closed.
- With that **and** `plain_bug` turned off, 8 tests fail. So the wrappers are doing the work and the sites do reach `bug_impl`. Those 8 include every test holding one of the five sites.
- Check3's N2 stays open and was not in the brief: `matches_b.test.ts:194-199` does not read its message, and a plain `panic(msg)` with the same text would pass any of these.

### 8. Bun's cache: no path in the gate does it

**Reproduced exactly:** `HOME=` writes `Library/Caches/bun/@t@` into the cwd, only when Bun transpiles a module large enough to cache. A small file or `-e` leaves nothing, and `HOME` unset leaves nothing. `.gitignore` does not cover `Library`, so `gate.ts:443` would see it.

**Every source of an empty `HOME`:**

| Path | Why it is safe |
|---|---|
| `src/std/env.test.ts:105`, `HOME=` | Runs in a `mkdtemp` directory |
| `env_reads`, `miri_env`, `x86.test.ts` | `HOME=${process.env.HOME ?? ""}` is empty only if the host's is unset, and all three use a temp cwd |
| `shims_c.test.ts:452`, `set_var("HOME", "")` | In-process, restored, and spawns nothing in between. I ran the worst case, a large module imported dynamically right after: no `Library` |
| `harness/suites.ts` `pinSessionEnv` | Sets `env[v] = null`, which unsets |
| Upstream tests | No `rustc-env:`, `exec-env:` or `unset-*` for `HOME` under `tests/ui` or Miri's tests |

Only starting the gate itself with `HOME=` would do it. After all my test runs here, `git status` is clean.

### 9. Unit budget

Best of 3, at load about 4:

| File | Wall | CPU |
|---|---|---|
| `miri_env.oracle` | 2.24 s | 3.29 s |
| `env_reads.oracle` | 2.15 s | 3.26 s |

Almost all of it is one cost: each port process takes about 1.1 s of CPU and 0.6 s of wall to load the module graph, even for `-vV`.

| Test | Wall | CPU | What it adds |
|---|---|---|---|
| Stub | 0.75 | 1.24 | Only that `stub` is honoured. Not gate-relevant |
| `MIRI_BE_RUSTC` | 0.79 | 1.37 | R2, the `OsStr` Debug text |
| `MIRI_CWD` | 1.01 | 1.66 | R1, and a resolved `unwrap_result` location |
| Version | 0.69 | 1.23 | R3's one silent wrong answer |
| Long cwd + 3 readers | 0.81 | 1.45 | The best value: four things in one process |
| `UNSTABLE_RUSTDOC_TEST_LINE` | 0.71 | 1.25 | The only committed test of a resolved `expect_result` location |
| `Backtrace::capture` | 0.19 | 0.19 | Cheap |

**The cheapest way down: drop the stub test,** about 0.6 s of wall and 1.1 s of CPU, as the handoff suggests. That brings the lane to about 4.1 s of wall and 6 s of CPU. No other test can merge into another process, as each stops early or needs its own environment. **Getting under 5 s of CPU** means losing one more process. I would not: each remaining test guards a reproduced finding. Whether F5's 5 s is wall or CPU is still open (`ice-report-final` N7): by wall this fits, by CPU it does not. Root should write that down.

### 10. `rustc-env.rs`: already fixed, confirmed

`tests/ui/compiletest-self-test/rustc-env.rs` in `run-pass-aux-miri`: MATCH on head and on base. `--filter rustc-env` gives 2 cases: that one and `rust-log.rs` UNPORTED, as the handoff says. `775991c0` is dated Nov 6 and `next.md` line 452 was last changed on Nov 5, so the claim predates the fix. See F8 for line 19.

### 11. Samples and files

| Suite | Total | MATCH | Other |
|---|---|---|---|
| `miri-hello` | 1 | 1 | |
| `run-pass-miri` | 200 | 200 | |
| `run-fail-miri` | 200 | 200 | |
| `check-ui` | 200 | 200 | |
| `mir` | 200 | 200 | |

- **No oracle output, baseline, suite or script changes.** `git diff main 8c0fcc40` touches nothing under `harness/`, `scripts/`, `tools/`, nor `package.json`, `tsconfig.json`, `UPSTREAM.json`.
- **Two test expectations changed,** both honestly. The jobserver test replaces its pinned `unported` with an oracle comparison. `rustc_feature/lib.test.ts` only changes the `VarError` shape.
- `bunx tsc --noEmit -p .`: clean. `coverage.ts --check --offline`: `markers ok (24848; vendor 5086; library 605)`.
- `bun test` on `src/std`, `track_caller`, `stack`, `src/rustc_driver_impl`, `src/miri/bin`, `src/rustc_feature`, `src/rustc_fs_util`, `src/proc_macro`, `src/rustc_ast/attr`: 343 pass, 0 fail. N1's four files: 68 pass. The env tests with `shims_c`, `typeck_impl`, jobserver: 78 pass, 0 fail.

## Seen, not from this batch

- **A deleted cwd:** the port prints `shell-init: error retrieving current directory: getcwd: cannot access parent directories` from `/bin/sh` in `stack.ts`'s re-exec, where the oracle prints nothing. On base too. Otherwise equal.

## Not checked

- The gate, the full unit step, full suites.
- Linux and Windows: nothing ran there. Check 4 is against sources.
- A directory really named with non-UTF-8 bytes, which APFS refuses.
- Repeating the F1 download on an empty Miri home. I would not start another 1.3 GB fetch, and the Nov 6 toolchain now masks it. The trace and the 7-second timing are the evidence.
- `QNX_TARGET`: my target name does not exist at the pin, so that comparison proved nothing. `PAGER`: terminal-only, read and not run.
- `RUSTC_FORCE_RUSTC_VERSION` through a real symbol: my program printed no symbol, so that comparison did not discriminate. Only the decode above did.
- Miri `std::fs::canonicalize` from a long cwd: the port stops `unported` (plan-m6 D14), as it does elsewhere.
- Panics in Miri beyond the driver's: the 297 sites are checked statically, and no other Miri panic was reached end to end.
- Whether a non-Miri suite ever runs with `RUSTUP_HOME` pointing at the Miri home. In the default path the trace shows no `rustc` call.
