verdict: APPROVE WITH NITS

Independent review of `fixers-41`, head `1863cb09`, the lane's own commits only (`c3877a5e..1863cb09`). No DIFF or CRASH on a protected case. I could not break the re-exec, `.env`, `env!`/`option_env!` or the surrogate escape, and every test I ran against the oracle matched except the items below.

**Merging is safe.** Nothing I found touches a path a protected case reaches. The one part written from memory, `__CF_USER_TEXT_ENCODING`, is right in 105 of 114 comparisons, and the 9 misses are F1: three small mistakes, silent, in corners no harness run reaches. A prototype adding 22 lines took all 114 to identical, so I recommend fixing F1 before or soon after the merge.

**One handoff claim is incomplete (F4).** Its table says an environment that overflows `ARG_MAX` stays exact. That holds when `/bin/sh` fails to start, but not when the shell starts and its own `exec` fails.

I edited no code. Prototypes and mutations ran in two scratch worktrees, since removed. This file is all I wrote to the tree. I did not run the gate or a full suite, other than `miri-hello` and `check-rg`, which are small enough to run whole.

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | LOW | `src/rust_ts/stack.ts:201,209,210,224,231` | `cf_user_text_encoding` differs from the oracle: non-UTF-8 file bytes, a uid of 2^31 or more, and no passwd entry with `CFFIXED_USER_HOME` |
| F2 | LOW, older than this lane | `src/miri/shims/unix/foreign_items.ts:1896` | Miri's `getpwuid_r` writes a non-UTF-8 `HOME` lossily into the program. The handoff files it under "settings", but it is program-visible data |
| F3 | LOW, older than this lane | `src/rustc_log/lib.ts:7,31` | `RUSTC_LOG=<non-UTF-8>` prints a line on stderr where the oracle prints nothing; `RUSTC_LOG_COLOR=<non-UTF-8>` prints the wrong error |
| F4 | LOW, older than this lane | `src/rust_ts/stack.ts:175,185` | In a window just under `ARG_MAX`, the shell's own `exec` fails: exit 1 and an error, where the oracle compiles |
| N1 | nit | `src/rust_ts/environment.oracle.test.ts:30` | Two test processes with the same or no `RUST_TS_AGENT` share and delete one directory, and fail. Reproduced |
| N2 | nit | `src/rust_ts/environment.oracle.test.ts:104` | The one surviving mutation can be killed by printing addresses. Shown below |
| N3 | nit | `src/miri/shims/os_str.ts:239-240` | "The `None` arm cannot be reached" is no longer true of the string. Windows shims being `unported` is what keeps it unreachable |
| N4 | nit | `src/rust_ts/main.ts:18` and the dump entries | A `.env` with `RUST_TS_IMPL=shim` silently forwards to the oracle: exit 0 and the right output. The handoff calls this "loud or absurd", but this form is neither |

**Decisions root should record:**

- The surrogate escape as an extension of D14, on the terms in section 6.
- `RLIMIT_STACK` as a known difference: a note, not a stop (section 1).
- `__CF_USER_TEXT_ENCODING` as host behaviour checked by oracle tests, not ported source (section 5).

## 1. The re-exec

Each row ran through a helper that `execve`s with an exact `environ`, then read C's `environ` back after `ensure_stack`.

| Input | Result |
|---|---|
| Every ordered pair of bytes 1-255, in one 130 KB value | exact |
| Bash's and dash's internal control bytes (`\x01`, `\x7f`, `\x81`-`\x88`), in names and values | exact |
| Every byte 1-255 as a name, alone and mid-name | exact, in order |
| Newlines, quotes, `$`, backslashes | exact |
| `-=x`, `--=x`, `-=`, `--=`, `-i=1`, `-u=FOO`, `-S=a b`, `-S=/bin/false`, `-P=/x`, `-0=1`, `--help=1`, `+=1` | exact, full stack, so they did pass through `env` |
| `A=B=C`, `B==`, empty values, `PATH=`, `PATH=/nonexistent`, `__proto__`, `constructor`, numeric names, a BOM | exact |
| `FOO` (no `=`), `=x=y`, an empty entry, a duplicate, the caller's own JSC variable | exact, default stack, as the handoff says |

**What macOS's `env -i` does, by running it.** It runs a bare `FOO` as the program (exit 127). It fails on `=x=3` with `setenv ... Invalid argument`. It folds `B=1 A=2 B=3` to `B=3 A=2`, keeping the first position. After a first operand, `-i=3`, `-u=4` and `-S=5` are ordinary entries. `env_can_carry` excludes exactly the cases that go wrong.

**Entries.** `main.ts`, `miri.ts` and `mono-run.ts` each gave the oracle's exact `environ`, with `PWD`, `SHLVL`, `_` and non-UTF-8 entries.

**Process state.** `argv` (with an empty argument, a leading `-`, a newline) and `cwd` are the same as on base. Stdin reaches the program: stderr is identical to the oracle on a source read from `-`. SIGTERM gives exit 143 on both sides, and the pid stays valid across the re-exec.

**Recursion limit: unchanged.**

- JS depth on base and head falls in the same range: default stack 256,928-270,370 and 257,951-267,082; `RUST_MIN_STACK=4000000` 61,092-79,795 and 72,105-78,662.
- Nesting of 5,000 gives the same stderr start and exit 1 on all three sides (my `no_core` program also lacks `sized`). At 10,000 to 45,000 all three die by SIGBUS.

**The marker.**

- A child never sees it. A proc macro spawning `main.ts` and the driver under the port got exit 0, no marker or JSC variable, and the full stack. A nested `RUST_MIN_STACK` works.
- A caller who presets `RUST_TS_REEXEC_<own pid>` has that variable removed and stays on the default stack (depth 53,205, by hand). The name must match the exact pid, and no path leaks it, since it is removed before anything else runs. I would leave this.

**F4, the window.** Stage 2 (`exec env ...`) carries the shell's `PWD`, `SHLVL` and `_`, so with a long cwd it can exceed `ARG_MAX` when stage 1 fit. With a 370-byte cwd, measured in bytes below the largest environment that still execs:

| Below the limit | Result |
|---|---|
| 300-620 | **exit 1, `sh: /usr/bin/env: Argument list too long`** |
| 120-280 | exact, default stack (the handoff's case) |
| 640+ | exact, full stack |

A short cwd has no such window. Base has the same one with the same exit 1 (420-680 below), so this is not new. It is not silent, but exit 1 is rustc's compile-error status. Scenario: a 1 MiB environment and a deep cwd. Fix if wanted: skip the re-exec when arguments plus environment are within about `PATH_MAX` + 512 bytes of `ARG_MAX`.

**A proc macro calling `getrlimit`: confirmed, and a note is right, not a stop.**

| | Soft limit | `setrlimit` to the default | Child's `ulimit -s` |
|---|---|---|---|
| Oracle | 8372224 | rc 0 | 8176 |
| Port (base and head) | 18874368 | EINVAL | 18432 |

A stop cannot be written, because the read happens in native code the port cannot see. Stopping on every proc macro would give up all of `pm-ui`. Record it as a known difference.

**Also older, no action.** An invalid `BUN_JSC_foo=1` makes Bun itself exit 1 before any port code runs.

## 2. `miri_stack_first.ts`

**C10 holds.** I recorded module evaluation order with a load plugin, base against head, on `miri.ts`:

- The modules are the same, plus `miri_stack_first.ts`.
- Only leaf `std` modules move ahead (`panic`, `unicode`, `fmt`, `result`, `char`, `str`, `env`), plus `stack.ts`.
- `os_str.ts` and its `.gen.ts` move up about 10 places, because `unix/env.ts` now value-imports `os_str_as_encoded_bytes`. It uses that only inside functions, so rule (2) holds.
- `src/miri/contract.test.ts` passes.

**Nothing else needs to come first.** A `.env` with `RUST_TS_HOST_TUPLE=bogus-host` and `RUSTC_LOG_COLOR=bogus` gives the right tuple on all eight entries at head, and fails on all eight at base, with one or the other. `Bun.main` and `import.meta.dir` both resolve symlinks, so a symlinked path still matches.

**The parse cost is real and worth a harness batch.** On one `no_std` program, median of 3: **29.2e9 instructions without `--preload`, 21.2e9 with it, about 27% less**, with identical output.

## 3. F2, `.env`

From a directory with `.env`, `.env.local`, `.env.production`, `.env.development` and `.env.test`, under each `NODE_ENV` and none: stdout, stderr and exit match the oracle, proc macro's raw `environ` included.

- A real variable beats the files, and an empty real variable stays empty (`Some("")`).
- `.env` values of `RUST_MIN_STACK`, `RUSTC_LOG_COLOR`, `RUST_BACKTRACE`, `NO_COLOR`, `CLICOLOR_FORCE`, `RUSTC_ICE`, `RUST_TARGET_PATH` and `RUSTC_OVERRIDE_VERSION_STRING` all have no effect, as under the oracle.
- Real `RUSTC_LOG_COLOR=` and `=bogus`, and `RUST_MIN_STACK=abc`, `=` and `=   ` match the oracle's text and status.

**`.env.local` for `RUST_TS_DATA` still works,** through the file fallbacks, with no real variable, from the repo and from another cwd: `main.ts` host tuple, `scripts/lib/common.ts`, `state.ts`. `track_caller.ts:468` read and correct. The other readers of `RUST_TS_DATA` under `src/` are oracle generators that do not call `ensure_stack`.

**The remaining `process.env` reads, with `\xff` in each of 32 variables, on a clean file and an erroring file:** 54 of 64 match.

- Six are the jobserver variables (`CARGO_MAKEFLAGS`, `MAKEFLAGS`, `MFLAGS`), which stop `unported`, exit 70. Loud, fine.
- Four are F3: `RUSTC_LOG=\xff` adds ``ignoring `�`: invalid filter directive`` on every compile. `RUSTC_LOG_COLOR=\xff` gives `invalid log color value` where the oracle gives `non-Unicode log color value`, same exit 101. `var_` is ready for both.

**A proc macro calling `set_var`, then `option_env!`:** identical to the oracle, including a variable the macro removed. Settings read through `process.env` after a proc macro changes them are not covered, as the handoff says. I did not test those one by one.

## 4. F3, `lookup_env`

The pin's `lookup_env` is `env::var(var)`, and the port's `var_`/`var_os` follows std's `getenv` with its `run_with_cstr` (`library/std/src/sys/env/unix.rs:112`). All `// std:` markers point at the right lines.

Ran 31 names through `option_env!` and `env!`, under three environments (carried, not carried, `A=B=C`), plus custom-message forms and dep-info. **All identical.** The ones that matter:

| Name | Environment | Oracle and port |
|---|---|---|
| `"A=B"`, `"A="`, `"A=B=C"` | `A=1` | `Some("1")`, the lane's finding |
| `""`, `"="`, `"=x"`, `"=A"` | has `=x=y` | `Some("x=y")`: BSD stops at `=` |
| `"A\0"`, `"A\0B"`, `"\0"`, `"\0A"` | `A=1` | `None`: **`getenv` does not truncate here**, `to_cstr` refuses as `run_with_cstr` does |
| `"BOM"` | `\xef\xbb\xbfabc` | `Some("\u{feff}abc")`, the BOM kept |
| `"DUP"` | `DUP=1`, `DUP=2` | the first |
| `"FFF"`, `"CUT"`, `"OVER"`, `"CESU"` | non-UTF-8 | `env!`: the `NotUnicode` error. Dep-info matches |

**Invalid UTF-8 in a name cannot arise:** the argument is a string literal.

## 5. `__CF_USER_TEXT_ENCODING`

**Is it a guess? It began as one, and it is now a model checked against the oracle, with three corners wrong.** I compared the proc macro's whole raw `environ`, so position is covered too.

| Group | Cases | Differ |
|---|---|---|
| Existing values: `strtol` forms, signs, whitespace, octal, saturation, `0x:`, no colon, non-UTF-8, 300 bytes | 41 | 0 |
| Position: absent, first, middle, matching, duplicates | 6 | 0 |
| `CFFIXED_USER_HOME` file: absent, normal, 62/63/64 bytes, NUL, empty, `%d%s%n`, newlines, a directory, mode 000, dangling link, `/dev/null`, a long path, too long | 16 | 0 |
| Same, non-UTF-8 bytes in the file | 2 | **2** |
| `CFFIXED_USER_HOME` value; `HOME` (ignored, unset, empty); `LANG`, `LC_ALL`, `LC_CTYPE` | 17 | 0 |
| Other uids and passwd, reached by interposing `getuid`, `geteuid`, `getpwuid`, `getpwuid_r` on both sides | 32 | **7** |

The lane's reading of the code is right in the main: the passwd entry's home and not `HOME`, 63 bytes, `0:0` on open failure, an empty tail on read failure, root with no `HOME` left alone.

**F1, the three mistakes:**

1. **File bytes are decoded lossily** (`stack.ts:224,231`). `0x\xff\xfe:0` gives the oracle `0x1F5:0x\xff\xfe:0` and the port `0x1F5:0x\xef\xbf\xbd\xef\xbf\xbd:0`. Also a multi-byte character cut at byte 63.
2. **CF's uid is a signed `int`** (`stack.ts:201,209`). As `nobody` (uid 4294967294 on macOS) with no `HOME`, the oracle sets nothing and the port sets `0xFFFFFFFE:0x0:0x0`. With `HOME` set, the oracle keeps `-2:x` and replaces `0xFFFFFFFE:x` and `4294967294:x`; the port does the reverse.
3. **A missing passwd entry stops it even with `CFFIXED_USER_HOME`** (`stack.ts:210`). The oracle sets nothing, and the port reads the file.

**Fix, prototyped:** `uid | 0` with `uid <= 0`, `>>> 0` for the hex, `passwd_home` before the fixed home, and bytes through a `set_var` taking `Uint8Array`. **All 114 identical after it**, then reverted. Add one non-UTF-8 file case to the test. The uid cases need an interposer, so they stay by hand.

**What the port should do where it cannot be sure: keep setting it. A stop is impractical.** This runs at every process start, before anything could read the value, and the port cannot tell whether anything will. A stop on the absent case would break every run started with `env -i`. Record it as host behaviour, not ported source. `environment.oracle.test.ts` then catches a macOS update that changes it, on the root host where the gate runs.

**The file.** It is the passwd home's file, or `CFFIXED_USER_HOME`'s, not `HOME`'s. It is read-only and only read when the variable does not already match, so a matching value costs nothing.

**Under Miri:** 28 runs, oracle against `src/miri/bin/miri.ts`, with the variable absent, matching, another uid's, long and non-UTF-8, under isolation off, `-Zmiri-env-forward`, isolation on and `-Zmiri-env-set`. **All byte-identical, including position, every `environ` entry's address, and the next `malloc`.** It is absent with isolation on, on both sides.

## 6. Lone surrogates

**Accept it.** The escape is sound:

- Only bytes 0x80-0xFF are escaped, to U+DC80-U+DCFF. Valid UTF-8 never decodes to a surrogate, as `ED B2 80` is itself invalid and is escaped byte by byte.
- No high surrogate is ever produced, so an escape cannot pair with its neighbour.
- `\xff`, `\xfe`, `EF BF BD`, `ED B2 80` and `C3 BF` as names stay distinct, and all match the oracle's bytes and FxHash order through `std::env::vars_os()` under isolation off and `-Zmiri-env-forward`, at head. That closes the handoff's "not repeated".
- BOMs survive (`ignoreBOM: true`).

**Terms for the decision:**

1. An escaped string lives only in `config.env`, the env map and guest memory. Everything coming back through `bytes_to_os_str` keeps the stop: `setenv("COPY", getenv("VALUE"))` and `unsetenv` of a non-UTF-8 name give exit 70 where the oracle exits normally. That is loud and acceptable.
2. **The lossy step to watch is `TextEncoder`, which silently turns a surrogate into `EF BF BD`.** A new reader of a forwarded string must use `os_str_as_encoded_bytes` and `os_str_len`. `unix/env.ts:177` still uses `utf8.encode(name)`, which is safe today, as `name` comes from the program or a literal.
3. F2 comes out. `HOME=/a\xffb` with `home_dir()` under isolation off gives the oracle `[47, 97, 255, 98]` and the port `[47, 97, 239, 191, 189, 98]`, exit 0 on both. `var_os("HOME")` through `os_str_from_encoded_bytes` should do it.
4. N3: `os_str_to_u16vec_not_windows` would write a lone surrogate into a wide string where upstream reports `is not a valid utf-8 string`. It is unreachable today, as `shims/env.ts` stops Windows targets and nothing calls it. Replace the comment now, and add the check when Windows shims arrive.

## 7. Tests

**Expected values** come from the oracle in `environment.oracle.test.ts`. `stack.test.ts`'s expected value is its own input, which is the right contract there. F1, F2 and F3 each have a regression test.

**Mutations, rerun by me against the lane's four test files: 17 of 18 killed, matching its count.** 16 kill by failing assertions. "Second call re-execs" kills by hanging: the driver was still running after 8 s, and I stopped it by pid, so under the gate it would show as a hang.

**The survivor and addresses.** `alloc_os_str_as_c_str` sized by `utf8_len`:

- **At head the code is right.** Addresses match the oracle in all 28 runs above, with and without non-UTF-8 values.
- **The mutant moves addresses only with a non-UTF-8 forwarded entry:** `environ` at `0x20148` on the oracle, `0x20170` under the mutant. With ASCII entries it matches, because `os_str_len` and `utf8_len` agree when there is no surrogate.
- **No pinned output is affected.** The harness builds case environments as JS strings (`scripts/lib/env.ts:93` `caseEnv`), which cannot hold such a byte, so `os_str_len` equals `utf8_len` on all of them.
- N2: printing `environ`'s address in the test's `BLOCK` would kill it.

**Measured:**

| | Lane | Me |
|---|---|---|
| Unit time added, CPU, best of 3, load 13-16 | 4.91 s | **5.0 s** (`environment.oracle` 4.63, `stack` +0.37, others about 0) |
| `ensure_stack` alone | +25M | **+25.9M** (0.238e9 to 0.264e9) |
| rustc hello | +46M median | -56M on a slightly different hello, so noise at this size |
| Miri, a `no_std` program | | +32M, 0.1% |
| A 900 KB variable / 3,000 small ones | | +0.7e9 / +0.26e9 |

So the startup claim holds, at about 0.25-0.3% of hello. The unit time sits right at plan-m7 F5's 5 s, with no room for more without trimming.

**Other runs at head:**

- `bun test src/rust_ts src/rustc_builtin_macros src/miri src/std`: 1,148 pass, 0 fail, tree clean after.
- `coverage.ts --check --offline`: markers ok (24,844; vendor 5,086; library 595).
- `rustc_builtin_macros/src/env.rs`: 5/5.

## 8. Samples

`RUST_TS_REQUIRE_PROBES=1`, agent `review-fixers-41`, `--jobs 5`, load about 11-17, sharing the machine with another lane.

| Suite | MATCH | Other |
|---|---|---|
| `miri-hello` (whole) | 1/1 | |
| `check-rg` (whole) | 36/36 | |
| `run-pass-miri` | 200/200 | |
| `miri-pass` | 199 | 1 UNPORTED, not protected: `open_a_file_in_proc.rs` |
| `run-pass-aux-miri` | 200/200 | |
| `mir` | 199 | 1 TIMEOUT, not protected: `recursive-drop-elaboration-2.rs`. Alone, with nothing else of mine running: TIMEOUT at 121 s on head twice and on base once, so not this lane |
| `pm-ui` | 199 | 1 UNPORTED, not protected: `expand-expr.rs` |
| `mono-ui` | 200/200 | |
| `check-ui` | 200/200 | |

**DIFF 0, CRASH 0.** The lane's `move-3-unique.rs` timeout did not come up in my sample.

## 9. Linux, by reading

Nothing ran there, so these are expectations, not results.

- **`dash`: expect no trouble.** I ran the exact script under macOS's `/bin/dash` with every byte pair, `\x81`-`\x88` and `-X=1`: exact. A failing `ulimit` in `if` continues rather than exiting the shell. That is dash's code, not a Linux run.
- **GNU `env`:** from memory it stops option parsing at the first operand and sets entries in order, the same as here. **uutils' `env`, shipped by newer Ubuntu, is the one I would try first**, for non-UTF-8 bytes.
- **`/proc/self/environ` is what I would watch.**
  - If it cannot be read, `settle_environment` returns `undefined`, so a process silently gets no re-exec and no `.env` clean-up. Base still re-execed there. A restricted container would show this as a smaller stack and `.env` variables back in the settings.
  - A variable set after start does not show in it. All callers run at startup, and `env.test.ts` states this.
  - `REMOVED_VARS` also hides a later re-set of the same name, which it could not show anyway.
- **`getenv("A=B")`** follows glibc's rule through libc, and the test compares with the oracle, so it should adapt.
- **Bun's dotenv** leaving `environ` alone on Linux is assumed, not checked. The `.env` test would catch it.
- **musl:** `libc.so.6` throws, as before.

## What I did not check

- The gate, or any full suite beyond `miri-hello` and `check-rg`.
- Linux or Windows, at all. A `--compile` bundle: no script builds one.
- **Real uid 0, `nobody` or a uid with no passwd entry.** There is no `sudo` here, so those came from interposing the four calls. It shows what CF decides from them, not everything a real root process would see.
- Any macOS version but this one (Darwin 25.6).
- **`tsc` clean.** This worktree has no `node_modules`. With the main checkout's `@types`, base and head give the same 241 errors, none in the lane's files, so the lane adds none. I did not reproduce the handoff's clean run.
- A non-UTF-8 `CFFIXED_USER_HOME` with a real file: APFS refuses such a directory name.
- Each remaining `process.env` read after a proc macro's `set_var`. Threads alive during `unsetenv`.
- Lane assignment, beyond `docs/next.md` naming F1-F3.

**The upstream checkout.** It shows `build/`, older than this lane, and a new `rustc-ice-2026-11-06T03_10_32-70744.txt`, created at 05:10:32 local. **That file is not from this review and I left it.** It is an oracle ICE on crate `do_not_const_check`, and at that moment my only command was the N1 test, which compiles no such crate. Another session's tests were running.

Two untracked `*.long-type-*.txt` files appeared there later, after my last suite had finished, so I left those too: `hrtb-doesnt-borrow-self-2` and `probe-error-on-infinite-deref`. Whoever owns that run should clear all three before anyone relies on the checkout being clean. My own runs left it as they found it, as the check just before that file appeared showed only `build/`.
