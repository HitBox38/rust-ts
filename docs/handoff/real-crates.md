# real-crates (M7 preflight, plan-m7 wave 39: O4, O5, O6)

**ripgrep 15.2.0's whole tree goes through the port under real `cargo check`, byte-identical to the oracle, x86_64-unknown-linux-gnu, in both
modes. No difference remains. O6 was not a port bug.** Not run: aarch64, since abi-vtable has not merged (below).

## Findings

**O6: the comparison was wrong, not the metadata.** plan-m7's run built the oracle in `t-check-or` and the port in `t-check2`. A file
`include!`d from `OUT_DIR` keeps its absolute path in the metadata, so the target directory's name is in the bytes.

| Check | Result |
|---|---|
| Oracle against the oracle, in those two directories | **The reported symptom with no port involved:** 29 of 34 identical; `serde_core` and `serde` 4 bytes smaller; `serde_json`, `grep_printer`, `grep` same size, differing by hashes |
| Where | `.../build/serde_core/<hash>/out/private.rs` appears twice, 1,435 and 1,131 bytes from the end. `t-check2` is 2 bytes shorter, twice: 4 bytes |
| Port against the oracle, one target path | 34 of 34 identical |
| Reduced to 9 lines (`src/rustc_metadata/rmeta/out_dir_path.oracle.test.ts`) | Oracle differs from itself by twice the length difference; port byte-identical at one path |

There was no bug to fix, so the "minimised case" pins this mechanism instead. The dump probe was not needed: no difference survives the corrected comparison.

**O4: ported.** `src/rustc_data_structures/jobserver.ts` and `src/vendor/jobserver/` (0.1.34). Only the warning can be seen, so that is ported in full. No token
is ever acquired (D11, D15); upstream's helper thread and pipes have no output. Under cargo the port reads `CARGO_MAKEFLAGS=-j --jobserver-fds=3,5 --jobserver-auth=3,5`
and stays silent, as the oracle does. 33 hand-run values match the oracle on stderr and exit code; 27 of them, plus a driver case, are now a test.

One non-obvious thing: Bun has descriptors of its own by then (a pipe at 3), so `--jobserver-auth=3,4` with those closed would read as "not a pipe" where the
oracle says "cannot open". Nothing inherited through `exec` can have `FD_CLOEXEC` set, so a descriptor with it set counts as closed (`runtime_owned_fd`).

**O5: left, as D11 expects.** Upstream computes `invocation_temp` only inside `sess.opts.incremental.as_ref().map(..)` (`rustc_interface/src/util.rs:654`), so no
non-incremental path reaches the stop. With `CARGO_INCREMENTAL=0` nothing in the tree hits it, `rg` included (`rg` was the crate that stopped in plan-m7's run).

**New front-end bugs found: none.** This was the first real-crate run with live jobserver and optimized MIR read back across crates.

## Per-crate results

Each mode: oracle tree, then port tree, built at the same absolute path. Port CPU: 375 s plain, 537 s optimized; oracle 4 s, 7 s.

| Crate | plain `.rmeta` bytes | plain | `-Copt-level=3 -Zalways-encode-mir` bytes | opt | port user s (plain / opt) | peak RSS MB |
|---|---:|---|---:|---|---:|---:|
| `aho_corasick` | 1,645,881 | same | 3,273,440 | same | 19.9 / 29.1 | 1700 |
| `anyhow` | 401,282 | same | 565,215 | same | 5.2 / 8.5 | 1056 |
| `bstr` | 1,303,001 | same | 1,958,003 | same | 12.5 / 17.2 | 1390 |
| `cfg_if` | 5,699 | same | 5,699 | same | 0.9 / 1.0 | 293 |
| `crossbeam_deque` | 69,321 | same | 275,181 | same | 4.8 / 7.7 | 992 |
| `crossbeam_epoch` | 263,277 | same | 454,862 | same | 7.5 / 9.4 | 1122 |
| `crossbeam_utils` | 303,871 | same | 962,091 | same | 11.6 / 15.8 | 1264 |
| `encoding_rs` | 1,015,615 | same | 2,750,894 | same | 20.3 / 29.1 | 2646 |
| `encoding_rs_io` | 41,083 | same | 108,964 | same | 4.0 / 5.1 | 897 |
| `globset` | 153,840 | same | 670,717 | same | 8.5 / 13.1 | 1301 |
| `grep` | 4,249 | same | 4,249 | same | 0.9 / 1.0 | 371 |
| `grep_cli` | 117,947 | same | 349,154 | same | 5.4 / 9.7 | 1137 |
| `grep_matcher` | 112,886 | same | 217,848 | same | 5.5 / 7.5 | 981 |
| `grep_printer` | 466,786 | same | 1,474,112 | same | 11.1 / 19.9 | 1474 |
| `grep_regex` | 105,245 | same | 459,894 | same | 5.9 / 11.6 | 1221 |
| `grep_searcher` | 245,265 | same | 645,481 | same | 9.5 / 13.4 | 1296 |
| `ignore` | 420,598 | same | 1,305,104 | same | 10.5 / 19.5 | 1477 |
| `itoa` | 50,777 | same | 140,620 | same | 4.6 / 5.5 | 763 |
| `lexopt` | 66,302 | same | 193,650 | same | 3.6 / 6.0 | 920 |
| `libc` | 3,624,039 | same | 4,122,617 | same | 19.9 / 23.4 | 1938 |
| `log` | 166,217 | same | 228,518 | same | 4.6 / 5.7 | 788 |
| `memchr` | 1,130,050 | same | 1,611,139 | same | 12.2 / 16.2 | 1355 |
| `memmap2` | 125,062 | same | 213,984 | same | 4.9 / 5.9 | 920 |
| `regex_automata` | 3,217,824 | same | 8,604,059 | same | 41.4 / 63.7 | 3964 |
| `regex_syntax` | 4,214,834 | same | 6,316,616 | same | 30.6 / 42.6 | 5261 |
| `rg` | 0 | same | 0 | same | 12.4 / 17.9 | 1452 |
| `same_file` | 27,630 | same | 49,519 | same | 2.0 / 3.0 | 669 |
| `serde` | 526,809 | same | 1,049,424 | same | 13.6 / 17.8 | 1276 |
| `serde_core` | 2,731,444 | same | 5,604,096 | same | 40.1 / 52.9 | 2828 |
| `serde_json` | 971,608 | same | 2,008,010 | same | 18.8 / 26.2 | 1616 |
| `termcolor` | 160,129 | same | 397,143 | same | 7.0 / 9.0 | 1064 |
| `textwrap` | 146,013 | same | 367,341 | same | 4.8 / 8.2 | 1046 |
| `walkdir` | 87,961 | same | 221,822 | same | 3.9 / 6.5 | 952 |
| `zmij` | 480,504 | same | 548,983 | same | 7.3 / 8.0 | 990 |

- **stderr:** identical for every unit in both modes (JSON diagnostics and artifact messages, as cargo asks for them).
- **Every other file in the target tree** is identical too: `.d`, fingerprints, build-script outputs; nothing missing or extra. A second `cargo check` over the port's tree compiled nothing (fresh).
- **cargo's probes** (`-vV`, `--print`) went to the port: `.rustc_info.json` outputs are identical.
- **`rg` is a bin, so its `.rmeta` is 0 bytes on both sides and its "same" above says nothing.** Its MIR was compared separately: `-Copt-level=3 -Zalways-encode-mir -Zunpretty=mir`, against
  the port's own optimized `.rmeta`s, recorded argv and environment: **6,927,138 bytes, identical, stderr identical.**
- **The comparison is not vacuous:** `regex_syntax` takes 30.6 s and 5.2 GB on the port and 0.6 s on the oracle, its `.rmeta` grows from 4.2 MB to 6.3 MB under the flags, and the same method found the five differences above.

## For root and harness-m7a

1. **`check-rg` must build both sides at one absolute target path**, or it reports five false differences. Moving the tree aside between sides is enough. It needs `CARGO_INCREMENTAL=0` (D11).
2. **`check-rg` should compare `rg`'s MIR,** as bin crates have empty `.rmeta`s, and the F7 mode should run through cargo, which supplies the build-script environment `serde_core` needs.
3. `harness/scope.json` `vendor` needs `"jobserver": "=0.1.34"`. I may not edit it, and coverage.ts rejects a `crate:` marker of an unlisted crate, so the markers read `crate-pending:`. Then run
   `sed -i '' 's/crate-pending:/crate:/' src/vendor/jobserver/*.ts` and drop the note in `error.ts`. All 10 were checked by script against the crate source at their lines.
4. **Stale text:** plan-m7 §5 row O6, and "29 of 34 identical" in `docs/reviews/plan-m7.md` F7. It is 34 of 34.
5. **Upstream checkout:** `rustc-ice-2026-11-05T03_03_40-5497.txt` and `..._41-5508.txt` are there (ignored files; difftest prints ERROR about them). They are rustc ICEs (the oracle or a probe) at
   `rustc_ty_utils/src/abi.rs:556`, from 05:03 local, before this lane ran anything in that directory. I left them for whichever lane owns them.

## Not done

- **aarch64 host:** `t3/aarch64-abi-vtable` is not on `integ-w39` yet, so everything is x86_64-unknown-linux-gnu, as instructed. `libc`'s macOS modules and `cfg(target_arch = "aarch64")` remain untried until `check-rg-host`.
- `cargo check --release`: not asked for and not run; the F7 mode covers opt-level 3.
- Windows and Linux jobserver paths are unchecked (`fcntl` is reached through `libc.so.6` on Linux; `windows` stops `unported`).

## What the wrapper does

`$RUST_TS_DATA/tmp/real-crates/`: `wrap.sh` (`RUSTC` for cargo), `run.sh <mode> oracle|port`, `cmp.ts`, `cmpall.ts`, `fresh.sh`, `rgmir.py`, `table.py`. Trees and per-unit logs: `live/`, `opt/`.
The wrapper adds `--sysroot` (the port cannot find it from its own path) and `RUSTC_ICE=0 RUST_BACKTRACE=0`, as plan-m7's did. Compiles that emit `link` (build scripts and their dependencies) go to the
oracle, because the port has no codegen yet. Nothing else is worked around: `CARGO_MAKEFLAGS` is left set, and `CARGO_INCREMENTAL=0` is D11's.

## Files

Added: `src/rustc_data_structures/jobserver.ts`, `jobserver.oracle.test.ts`, `jobserver_oracle/run.ts`; `src/vendor/jobserver/{lib,error,unix}.ts`; `src/rustc_metadata/rmeta/out_dir_path.oracle.test.ts`.
Changed: `src/rustc_interface/interface.ts` (real import), `src/rustc_interface/stand_ins.ts` (stand-in removed).

## Checks

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | markers ok |
| `--missing compiler/rustc_data_structures/src/jobserver.rs` | 5/5 |
| jobserver and out-dir tests, `RUST_TS_REQUIRE_PROBES=1` | 30 pass, 0 fail; **4.2 s CPU** (2.7 user, 1.5 sys), under the 5 s budget (F5), measured under load |
| `interface.test.ts`, `driver.oracle.test.ts` | 49 pass, 0 fail |
| `--sample 100`: `check-ui`, `rmeta-ui`, `mir` | 100/100 MATCH each |

## `unported(...)` left

- `jobserver::Client::from_env_ext`: a value containing U+FFFD. `process.env` has already lost the bytes of a non-UTF-8 value, whose `{:?}` shows them, and a real U+FFFD looks the same.
- `jobserver::imp::Client::open` on Windows (named semaphore).
- `jobserver::imp::fd_check`: `check_pipe` false (rustc always passes true), and an `fstat` failure other than `EBADF`.
- `jobserver::client`, `Proxy::{new, acquire_thread, release_thread}`: tokens; nothing in the port calls them.

## `// PORT:` decisions

- No token handling, no pipe from `Client::new`, no `acquire_raw`, no helper thread (D11, D15). `CLIENT` stays so that a second `initialize` in one process is silent, as `OnceLock` makes it.
- A fifo is opened once and closed, reporting the same error upstream's two opens would. `R,W` is only checked; `clone_fd_and_set_cloexec` can fail only with no free descriptors.
- `runtime_owned_fd`: above.
- `fstat` failing with `EBADF` is reported as `CannotOpenFd` directly, as `fcntl_check` would.
- `{value:?}` of the `OsString` uses `debug_str`: for valid UTF-8, `str::lossy::Debug` escapes as `str`'s `{:?}` does at the pin.
