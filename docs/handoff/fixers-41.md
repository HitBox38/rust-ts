# fixers-41: what compiled programs and proc macros see of the environment

Fixes `docs/reviews/fixers-40.md` F1, F2, F3, and with them N2 and N3. Every program in this file now matches the oracle byte for byte, on macOS. **Nothing has run on Linux** (section 6). One difference remains that a proc macro can see: the raised `RLIMIT_STACK` (section 1).

## Files touched

| File | What |
|---|---|
| `src/rust_ts/stack.ts` | The re-exec and the arrival, rewritten. `restore_shell_env` and `RUST_TS_SHELL_ENV` are gone |
| `src/std/env.ts` | `environ_entries`, `vars_os`, `var_os`, `var_`, `VarError`, `set_var`, `remove_var`, on C's `environ` through `bun:ffi` |
| `src/rustc_builtin_macros/env.ts` | `lookup_env` uses `env.var_`; the local `env_var` and `VarError` are gone |
| `src/miri/bin/miri.ts` | `vars_os` reads `environ` as bytes; imports `miri_stack_first.ts` first |
| `src/miri/shims/os_str.ts` | `os_str_from_encoded_bytes`, and `os_str_as_encoded_bytes` is its inverse |
| `src/miri/shims/unix/env.ts` | `OsString_key` hashes the raw bytes |
| `src/rust_ts/miri_stack_first.ts` | New. Runs `ensure_stack` before the other modules evaluate |
| `src/rust_ts/exec_with_env.ts`, `stack_env_driver.ts`, `stack_miri_driver.ts` | Test-only drivers |
| `src/rust_ts/stack.test.ts`, `environment.oracle.test.ts`, `src/std/env.test.ts`, `src/miri/shims/os_str.test.ts` | Tests |

## 1. F1: the re-exec

The chain is now:

```
execve("/bin/sh", [sh, -c, script, sh, <entries>, <execPath>, <argv...>], [])
script: if ulimit -S -s N 2>/dev/null; then set -- BUN_JSC_maxPerThreadStackUsage=M "$@"; fi
        exec /usr/bin/env -i RUST_TS_REEXEC_<pid>=1 "$@"
```

- **The shell reads nothing.** Its `envp` is empty, and it holds the caller's entries only as positional parameters. `SHELLOPTS`, `IFS`, `OPTIND` and `_` never reach it as variables. `DYLD_*` now survives too; SIP stripped it from the old `/bin/sh` route (checked by hand: 0 `DYLD` entries through `/bin/sh`).
- **`env -i` sets the entries in order, then execs Bun.** The marker comes first, so an entry starting with `-` is not an option of `env`.
- **Arrival.** `environ` is `marker, [JSC var,] <entries>`. `unsetenv` of the first two, through FFI, leaves exactly the entries.

**Setting C's `environ` from Bun with no shell:** `setenv` and `unsetenv` through `bun:ffi`. `process.env` writes never reach it. The new `set_var` and `remove_var` update both.

**How the stack limit is passed, and whether it can reach the program.** It has two parts:

- `BUN_JSC_maxPerThreadStackUsage` is in the environment only from the `env` exec until `ensure_stack` runs, so no compiler code and no proc macro can read it. JSC has already read it by then.
- `RLIMIT_STACK` is not in the environment and stays raised. **A proc macro calling `getrlimit` sees it:** the oracle's sees soft `8372224`, the port's sees `18874368`. Its `setrlimit` gets `EINVAL` where the oracle's succeeds, which is why this cannot be undone on macOS. This is older than this lane and no test covers it. A child the proc macro spawns would inherit the limit too.

**The marker holds the pid in its name,** which `exec` keeps. So a caller's own `RUST_TS_JS_STACK` or `RUST_TS_REEXEC_1` is an ordinary variable, and is tested as one. A variable naming this exact pid in advance would be taken for the marker.

**Where the process stays on the default stack, on purpose.** The environment stays exact, but a nesting too deep for that stack dies by signal instead of working. All are checked:

| Case | Why `env` cannot carry it |
|---|---|
| An entry with no `=`, or an empty entry | `env` would run it as the program |
| An entry with an empty name (`=x=y`) | `env` refuses it |
| A repeated name | `env` folds it into one |
| The caller set `BUN_JSC_maxPerThreadStackUsage` | JSC must see ours, and theirs must come back in its position |
| `execPath` contains `=` | `env` would take it for an entry. By hand: exact, depth 53,205 |
| `execve` fails with `E2BIG` | By hand, at the largest environment that still execs: exact, depth 75,764 against 272,791 |

Rewriting `environ` on arrival could handle the first four, at the cost of a second way of carrying the environment. I did not do that for cases this rare.

**Also fixed.** A second `ensure_stack` call does nothing, through a module flag. A failed `execve` now leaves nothing behind, since nothing is set before it.

**`__CF_USER_TEXT_ENCODING`, which the review left alone.** The oracle links CoreFoundation, which sets this variable before `main`. `stack.ts` now does the same (`cf_user_text_encoding`, darwin only). A value starting with this uid and a `:` stays. Otherwise it becomes `0x<uid>:<first 63 bytes of ~/.CFUserTextEncoding>`, or `0x<uid>:0:0` if the file cannot be opened, where `~` is `CFFIXED_USER_HOME` or the passwd entry's home, not `HOME`. **The source is CF-Lite as I remember it, outside the pin.** Six cases are compared with the oracle in the test, and a replaced value stays in its position (by hand). Root running as uid 0 with no `HOME` was not tried.

**Entries:** `main.ts`, `miri.ts` and `mono-run.ts` all go through `ensure_stack`. `mono-run` by hand: `env!` of the `.env` variable and of three old marker names gives stderr and exit identical to the oracle. `miri.ts` imports `miri_stack_first.ts` first, so module-level `process.env` reads run after the clean-up. It does not avoid the second parse of the import graph: Bun parses everything before evaluating anything. See "For root".

## 2. F2: `.env`

**No `bunfig.toml` setting or flag is used; the variables are subtracted.** `--no-env-file` only helps if every start passes it, and `bun src/rust_ts/main.ts` from a crate's directory does not. A bundle would also take it as a program argument.

**Telling a `.env` variable from a real one of the same name:** C's `environ` decides. Bun adds dotenv values to its own map, never to `environ`, and a real variable wins over a `.env` one. `settle_environment` makes `process.env` follow `environ`, in both stages, and before `RUST_MIN_STACK` is read. Tested with `.env`, `.env.local`, and `.env.{production,development,test}` plus their `.local` forms, under each `NODE_ENV`.

**The project's own `.env.local` still works.** `RUST_TS_DATA` and `RUST_TS_HOST_TUPLE` have file fallbacks when unset (`config.ts`, `track_caller.ts`, `scripts/lib/common.ts`), and the harness passes them as real variables. All the runs below pass. By hand, a `.env` with `RUST_TS_HOST_TUPLE=bogus-host` leaves `--print host-tuple` correct under both `main.ts` and `miri.ts`.

**Still reachable.** `RUST_TS_IMPL` is read before `ensure_stack` in `main.ts` and the dump entries, so a `.env` naming it can select the stub or the shim. That is loud or absurd rather than silent, so I left it. Windows has no clean-up at all (section 6).

## 3. F3: non-Unicode

`lookup_env` now goes through `var_`, which calls libc's `getenv` and validates UTF-8, so upstream's `NotUnicode` arm reports the oracle's error.

**Found on the way:** using libc also fixes `option_env!("A=B")`. With `A=1`, the oracle on macOS returns `Some("1")`, as BSD `getenv` stops at the `=`. The port's old rule said absent. Tested.

**Miri.** Non-UTF-8 bytes in forwarded names and values now reach the program's `environ` exactly and hash correctly, so the block's order holds too. `OsStr` stays a `string`, with a byte that is not UTF-8 held as the lone surrogate U+DC00 + byte. That is injective, since valid UTF-8 never decodes to one. A program reading such a string back through `bytes_to_os_str` still stops `unported`, as before.

**Not converted:** these read `process.env`, so after the clean-up they are right except for a non-Unicode value, and for a variable a proc macro set with `set_var`:

`rustc_feature/lib.ts:79`, `rustc_log/lib.ts:31`, `rustc_session/{config,session,utils}.ts`, `rustc_driver_impl/lib.ts:418,706,1107,1164`, `rustc_interface/{passes.ts:491,util.ts:137}`, `rustc_metadata/creader.ts:1523`, `rustc_errors/lib.ts:1355`, `rustc_error_messages/diagnostic_impls.ts:153`, `rustc_ast/attr/version.ts:93`, `rustc_span/def_id.ts:161`, `rustc_target/spec/mod.ts:2785`, `rustc_data_structures/obligation_forest/mod.ts:662`, `vendor/anstyle_query`, `vendor/jobserver`, `miri/machine.ts:814`, `miri/bin/log/setup.ts`, `miri/bin/miri.ts:144,554`, `miri/shims/unix/foreign_items.ts:1896`, `proc_macro/lib.ts:2109`.

`var_` is ready for them. I did not assess each one. They are settings, not what the brief named, and moving them would be a wider change.

## 4. Tests

Each compares with the oracle, on programs run under both sides with the same exact `environ` (`exec_with_env.ts`), from a directory holding `.env` files.

| Test | Covers |
|---|---|
| `environment.oracle.test.ts`, macros and proc macro | `env!`, `option_env!`, a real proc-macro dylib's `vars_os`, raw `environ`, `env::var` and `set_var`; shell variables, markers, odd names, non-Unicode |
| same, `__CF_USER_TEXT_ENCODING` | Six cases against the oracle |
| same, Miri | `environ` block and `getenv`, isolation off and `-Zmiri-env-forward`, in one process (`stack_miri_driver.ts`) |
| `stack.test.ts` | Every byte value 1-255, order, the cases `env` cannot carry, dotenv, a marker lookalike, the stack really raised |
| `src/std/env.test.ts`, `os_str.test.ts` | `std::env` on `environ`; byte round trip over all 1 and many 2-byte strings, and 2,000 random ones |

**The Miri test reads `environ` directly, not `vars()`.** The same program through `std::env::vars_os()` takes about 19 s of CPU under Miri. `vars_os` is a loop over that block. By hand, at this code, both are byte-identical to the oracle, order included:

- `vars_os()` plus `env::var`, with non-UTF-8 entries: isolation off, `-Zmiri-env-forward`, and `-Zmiri-env-set`. This ran before the last two small commits, which only moved a file and changed a comment.
- `vars()` with 65 variables, isolation off, at head.

**Mutations, 18 in all; 17 killed.** Each was applied alone against these tests: dotenv kept, JSC variable or marker left in `environ`, no `env -i`, a non-empty shell `envp`, no stack raised, carrying what `env` cannot, no CF, CF using `HOME`, CF reading 64 bytes, CF keeping any value, second call re-execing, macros on `process.env`, Miri on `process.env`, Miri lossy, the hash lossy, `getenv`'s rule by hand.

**Survivor:** `alloc_os_str_as_c_str` sized by `utf8_len` instead of `os_str_len`. It only over-allocates by 2 bytes per escaped byte, which moves later addresses; the C string reads the same. The program does not print addresses, so nothing kills it. The code uses the correct length.

## 5. Results

Run at `850272db`, `RUST_TS_REQUIRE_PROBES=1`, `--jobs 5`, agent `fixers-41`. Head differs only by comments in `stack.ts`.

| Suite | MATCH | Other |
|---|---|---|
| `miri-hello` | 1/1 | |
| `run-pass-miri --sample 200` | 198 | 1 UNPORTED, not protected: `attributes/log-backtrace.rs`. 1 TIMEOUT, see below |
| `miri-pass --sample 200` | 195 | 4 UNPORTED, 1 UNSTABLE, none protected: `open_a_file_in_proc`, three socket cases, `mir-validation` |
| `run-pass-aux-miri --sample 200` | 199 | 1 UNPORTED, not protected: `rust-log.rs` |
| `mir --sample 200` | 200 | |
| `pm-ui --sample 200` | 197 | 1 UNPORTED, 2 UNSTABLE, none protected: `expand-expr.rs`, `load-panic-backtrace.rs`, `proc_macro_generated_packed.rs` |
| `check-rg`, `check-rg-host`, `check-rg-encode-mir` | 36/36 each | |

**DIFF 0, CRASH 0.** The brief asked for `check-rg`; I added the other two modes.

**The one TIMEOUT is protected and not a failure:** `tests/ui/moves/move-3-unique.rs`. The pool's own retry also timed out, with other lanes at load near 30. Run alone it is MATCH, three times. With the base and this head one after the other: 28.5 s and 28.8 s wall, 34.9 s and 35.1 s CPU. It is a slow program near its limit under load. Expect it again if the gate runs under load.

**Other runs, at head:**

- `bunx tsc --noEmit -p .`: clean. `coverage.ts --check --offline`: markers ok (24,844; vendor 5,086; library 595).
- `bun test src/rust_ts src/rustc_builtin_macros src/miri`: 1,102 pass, 0 fail. Also `src/rustc_driver_impl src/rustc_interface src/proc_macro src/std` and `proc_macro_server.test.ts`: 299 pass, 0 fail.
- The tree is clean. The upstream checkout shows only `build/`, dated Oct 29, from before this lane.
- A 5,000-deep nesting: exit 0 on both sides.

**Coverage, `--missing`:** `rustc_builtin_macros/src/env.rs` 5/5, `miri/src/shims/os_str.rs` 24/24, `shims/unix/env.rs` 18/18, `bin/miri.rs` 19/21, with no marker removed by this lane.

**Startup, instructions retired.** Interleaved in both orders, two scratch checkouts with paths of equal length, as a first measurement with unequal paths was biased by about 3%. Load was 16-24, and instruction counts on a loaded machine still vary.

| Program | Base | This lane | Change |
|---|---|---|---|
| `ensure_stack` alone (median of 20) | 0.234e9 | 0.258e9 | **+25M, exact to the digits shown** |
| rustc hello, `--emit=metadata` (median of 9) | 8.314e9 | 8.360e9 | +46M median, -4M min |
| `miri hello` (median of 5) | 29.878e9 | 29.695e9 | -183M |

So about +25M per run, roughly 0.3% of hello, from one more exec and the `environ` read.

**Unit-time budget, best of 3, load about 14:**

| Added | CPU |
|---|---|
| `environment.oracle.test.ts`, new | 4.53 s |
| `stack.test.ts`, head minus base | 0.35 s |
| `os_str.test.ts`, head minus base | 0.02 s |
| `src/std/env.test.ts`, new | 0.01 s |
| **Total** | **4.91 s** |

That is under 5 s, narrowly, and the machine was not quiet.

## 6. What I could not check

- **Linux: nothing ran.** Docker's daemon is not running here and I did not start it. From reading the code paths:
  - `environ_entries` reads `/proc/self/environ`, as `process_raw_argv` reads `cmdline`. It is the block as `execve` left it, so `remove_var` keeps a list of names to hide, and a later `setenv` does not show. All its callers run at startup. I did not use `dlsym` of `environ`, which can return libc's copy under a copy relocation.
  - If `/proc` is unreadable: no re-exec and no dotenv clean-up, with `vars_os` falling back to `process.env`.
  - `/bin/sh` is often `dash`. The script is POSIX, and `dash` should pass bytes through `"$@"`, but that is untested. The every-byte test is the one to watch.
  - coreutils and busybox `env` should behave the same way for `name=value` operands, but that is from memory.
  - `libc.so.6` is hard-coded, so a musl host throws at `dlopen`, as it did before.
  - The CF code does not run there. `getenv("A=B")` uses glibc's own rule, which differs from BSD's; the test compares with the oracle either way.
- **Windows:** `ensure_stack` returns at once as before, so `.env` variables still reach `process.env` there, and `var_os` falls back to `process.env`, so non-Unicode goes undetected.
- **A `--compile` bundle:** not built. By reading, `miri_stack_first.ts`'s check does not match there and `miri.ts`'s own call does the work.
- **The gate, or any full suite** other than `miri-hello` and the three `check-rg` modes.
- **Threads:** `unsetenv` runs with Bun's threads alive. I saw no problem, and nothing tested for it.

## `unported` and `// PORT:`

No new `unported`. The existing stop in `bytes_to_os_str_unix` is unchanged and now also covers a forwarded non-UTF-8 value that Miri itself reads back.

`// PORT:` decisions:

- `stack.ts`: the re-exec (section 1), and `cf_user_text_encoding`.
- `std/env.ts`: `environ` over `process.env`; `/proc/self/environ` on Linux; libc `getenv`.
- `os_str.ts`: the lone-surrogate escape, in the module header. **This extends D14's contract, so it may want a recorded decision.**

## For root

- **A real saving for Miri suites, which I did not make.** Bun parses `miri.ts`'s whole import graph before evaluating anything, so the process that only re-execs costs about 7.9e9 of `miri hello`'s 29e9, about 27%. Starting Miri through a thin entry, or `bun --preload src/rust_ts/miri_stack_first.ts`, avoids it: 31e9 to 21e9 on a small program by hand. The harness's command line lives in `scripts/`, so it needs a harness batch.
- `RLIMIT_STACK` under a proc macro (section 1) is the one known difference left.
