# Independent review: fixers-42

Branch `t3/fix-rustc-port-findings`, head `64371d8f`, compared with its merge of `integ-w40` at `6da1d531` ("base"). Host: root host, AC power. Another lane shared it for part of the time, and load ran from 2 to 48. No timeouts.

## Verdict: APPROVE WITH NITS

All eight code commits do what they say, and I found no regression. The two highest-risk items, F4 near `ARG_MAX` and F1 `__CF_USER_TEXT_ENCODING`, held up at finer resolution than the lane's own runs.

Three things need correcting or deciding:

- The handoff understates what `MIRI_BE_RUSTC` and `MIRI_CWD` get wrong: neither differs only on non-UTF-8 values (R1, R2).
- Two reads of the same class as `RUSTC_LOG*` were missed, and one of them prints a wrong version with no error (R3).
- The new `StalledPrefix` test's header claims more than the test covers (R4).

None of these blocks integration. `PORTING.md:152` is still root's to change, as the handoff says.

## Findings

All are outside what a suite compares.

| # | Severity | Where | Finding | Failing scenario |
|---|---|---|---|---|
| R1 | low | `src/miri/bin/miri.ts:148`, `:152`, `:154` | `MIRI_CWD` is read lossily, and every failure prints the wrong panic. The handoff says this matters "only with non-UTF-8 values" and that it is "not compared". | **Silent:** a directory named `a\u{FFFD}b` exists and `MIRI_CWD=a\xffb`. The oracle panics, exit 101. The port changes into that directory and carries on, exit 1 on my program, with no panic. **Plain values too:** `MIRI_CWD=/nonexistent` prints `Error: ENOENT: no such file or directory, chdir '…' -> '…'` where the oracle prints `Os { code: 2, kind: NotFound, message: "No such file or directory" }`, and the ICE report stops with `location refused: after_analysis`. `MIRI_CWD=` (empty) and a file instead of a directory differ the same way. Exit 101 on both sides. |
| R2 | low | `src/miri/bin/miri.ts:554`, `:561` | Any invalid `MIRI_BE_RUSTC` prints the wrong text, not only non-UTF-8. All 15 values I tried differ. | `MIRI_BE_RUSTC=x`: the oracle prints `thread 'main' (N) panicked at …/miri.rs:425:13:` and then `invalid … value: "x"`. The port prints `rust-ts: internal compiler error: …` and a JS stack. `JSON.stringify` also escapes differently from `OsStr`'s Debug: `\x01` gives `\u0001` against `\u{1}`; `\x7f`, U+00A0 and a combining mark come out raw against `\u{7f}`, `\u{a0}`, `\u{301}`; `\xff` gives U+FFFD against `\xFF`. Exit 101 on both sides. |
| R3 | low | `src/rustc_driver_impl/lib.ts:714`, `src/rustc_session/session.ts:1119` | Two `env::var` reads still go through `process.env`, the class F3 fixed. | **Silent:** `RUSTC_OVERRIDE_VERSION_STRING=\xff rustc --version`. Upstream's `env::var` is `Err`, so the oracle prints `rustc 1.101.0-nightly (6f5da406b 2026-10-10)`. The port prints `rustc \u{FFFD}`, exit 0, and `-vV` likewise. **Loud:** `RUSTC_CTFE_BACKTRACE=\xff` on a program with an interpreter error. Upstream gets `Disabled` and the oracle gives its normal diagnostic, exit 1. The port takes the lossy value as `Capture` and stops with `unported: std::backtrace::Backtrace::force_capture`, exit 70. `src/rustc_ast/attr/version.ts:92`'s "non-unicode values cannot occur in JS strings" is wrong too, though it has no effect there, as the lossy value fails to parse just as unset does. |
| R4 | nit | `src/rustc_trait_selection/solve/fulfill_stalled.oracle.test.ts:2` | "every kind of stalled variable" is false: no program has a float variable. | Removing the float table from `valid_len` survives this test and everything in `src/vendor/ena` and `solve/`. In a scratch copy, a `floats` program built like `ints` passes clean and kills that mutation. See check 5. |
| R5 | nit | `src/std/env.ts:240` | `home_dir`'s fallback is lossy, and panics differently when there is no passwd entry. It takes an interposer to reach either. | With the program's `HOME` removed and the host's empty: a `pw_dir` of `/pw\xff` gives `[47,112,119,255]` on the oracle and `[47,112,119,239,191,189]` on the port. No passwd entry: the oracle's `Option::unwrap()` panic against `Error: ENOENT … uv_os_homedir`, exit 101 on both. `stack.ts`'s `passwd_home` already reads these bytes. |
| R6 | nit | `src/rust_ts/intern_key.ts:324` | The comment says "with 92 in a bucket". | Reproduced 100, as the commit message and handoff say. |
| R7 | nit | `src/rust_ts/track_caller.ts:1004` | `match_close`'s doc comment now sits above `item_span`'s, and `match_close` has none. | Reading only. |
| R8 | nit | `src/rust_ts/stack.test.ts:138` | The near-limit test assumes a short Bun path. | With a 900-byte Bun path the test itself fails: `E2BIG` from its own spawn, as `lo - 500` no longer fits. The code under test is fine at that path, as check 1 shows. |
| R9 | nit | handoff, item 7 | "No instruction cost shows above noise" is a little generous. | See check 6: about 0.5 to 1.4% on two of four programs, in two rounds. I would keep the change as insurance against the worst case, and root should know the price. |

## Checks

### 1. `31baf92b`, F4, near `ARG_MAX`: holds

**The size rule.** There is none in the code. It tries the first `execve` and stays on the default stack if the kernel refuses. So it cannot truncate, and it cannot reject anything except by leaving the larger stack.

I built a small launcher that passes exact `envp` and `argv`, and read every byte from 2-4 above the limit to at least 320 below it, comparing a hash of the whole `environ`, in order, and of `argv`. `exec` is all or nothing: in every sweep, on head and on base, no run lost or reordered an entry or an argument.

| Shape | Default stack, below the limit | Full stack | Exit 1 |
|---|---|---|---|
| cwd 131, 370, 1000 | 22-232 | 233+ | none |
| `PWD`, `OLDPWD`, `SHLVL`, `_` among the entries | 22-232 | 233+ | none |
| The padding in one long `argv` entry | 22-232 | 233+ | none |
| 12,000 `@argfile`-style arguments | 22-232 | 233+ | none |
| 20,000 and 60,000 small entries | 22-232 | 233+ | none |
| Bun path 150 and 900 bytes, limit measured for that Bun, read to 1,200 below | 0-210 | 211+ | none |
| `__CF_USER_TEXT_ENCODING` absent, so the first process adds it | 22-278 | 279+ | none |

In every row but the Bun-path one, my limit was measured with `/bin/test`, 22 bytes off Bun's path; the Bun-path row, measured with that Bun, shows the window is exactly 211 bytes wide. **Base**, step 2: exit 1 at 210-290 with cwd 131, 210-530 at 370, 210-1160 at 1000. That reproduces the lane's table.

**Boundaries.**
- At the limit: the program runs, exact, on the default stack.
- One byte above: the caller's own `execve` gets `E2BIG`, as it would for the oracle.

**End to end.** The real driver with a proc-macro dylib that prints C's `environ` in hex (output up to 2.1 MB), against the oracle, from 5 bytes above the port's estimated limit down to 1,000,000 below, entries in two orders: 18 of 18 byte-identical. A 19th point, 20 bytes above, was refused by the kernel at my launcher (`E2BIG`), so the port never started there.

**If the kernel's real limit differs.** Only the old script can show this, as it fails the same way: `sh: /usr/bin/env: Argument list too long`, exit 1. That is loud, loses no entries, and scores as a mismatch. By my arithmetic, not measured, the second `execve` has about 84 bytes of room over the first (the script's text against `env`, `-i`, `SHLVL=0`). The comment in `stack.ts` is honest that this is measured, not documented.

**Shells.** Only `PWD` matters in `unset PWD OLDPWD SHLVL`: a mutation keeping only `PWD` passes, and bash puts back `SHLVL=0` at `exec` anyway. That is harmless. `/bin/dash` adds nothing. `/bin/zsh` adds `HOME`, `LOGNAME`, `PATH`, `SHLVL` and `_`, about 180 bytes, so a host with `/var/select/sh` pointing at zsh would probably reopen a window of about 100 bytes. I could only run `/bin/zsh` directly, as changing that link needs root. It would fail loudly.

**Test.** Removing the `unset`, or leaving `PWD` out of it, fails the new test.

### 2. `c0f9ded3`, F1: holds

**Reproduced exactly:** 1,110 of 1,110 match on head; 812 match and 298 differ on base.

**233 new comparisons, 0 differ:**
- `strtol` forms: `0X`, signs, every whitespace byte, octal, `2^32 + uid`, 40 leading zeros, `+ 501`, `501 :`.
- `HOME` holding a file the rule must ignore, non-UTF-8 `HOME`, root and `nobody` with each.
- Repeated names, entries with no `=`, positions.
- Home path lengths 980 to 1,500 with and without the file, on both `CFFIXED_USER_HOME` and the passwd entry. The file stops being read between 1,003 and 1,004 on both sides.
- Files: NUL at 0 and at 62, 100,000 bytes, high bytes, a symlink, `/dev/null`, home being a file, relative paths, a trailing slash.

I spot-checked the printed values, so these did reach distinct results.

**It is not `$HOME`.** The source is `CFFIXED_USER_HOME` or the passwd home, and the oracle agrees.

**Cost.** The first process does the passwd lookup and file read only if the variable is absent or wrong. It then passes the value on, so the re-exec'd process takes the regex path. Median of 30 alternating runs of a driver that only runs `ensure_stack`:

| | base | head |
|---|---|---|
| Value present | 388.9 M instructions, 38.8 ms CPU | 390.7 M, 38.9 ms |
| Value absent | 392.0 M, 42.1 ms | 394.5 M, 43.0 ms |

So the path costs about 3.5 M instructions and 4 ms when it runs, and base paid the same. **Hello** (`fn main`, std, `--emit=metadata`): 10.33 G on base and 10.48 G on head with the value present, 10.42 G and 10.33 G with it absent. That is noise. Head's rise on the `stack.ts` path is under 0.5%.

**Honesty.** The comment says it is host behaviour, written from memory of CF-Lite outside the pin and then checked. Accurate. **Not held by a committed test**, as the handoff says for the uid cases: signed uid, the `uid <= 0` rule and a missing passwd entry all survive, and so does the NUL cut. The tools are in `$RUST_TS_DATA/tmp`, which is not in git. Root may want them kept somewhere durable.

### 3. `f8fd91b5` F2, `f61219d0` F3: hold, with R1 to R3 and R5

**Where the shim is reached.** The handoff's real programs read a forwarded `HOME`, so `HOME=/a\xffb` does not reach `getpwuid_r` unless the program removes the variable first. `-Zmiri-env-exclude` does not exist at the pin. I added a program that calls `remove_var("HOME")`, which does reach it.

| Case | Result |
|---|---|
| Forwarded: `/a\xffb`, empty, unset, plain, UTF-8, cut UTF-8, surrogate bytes | 7 same |
| `remove_var`: the same 7, plus `pw_dir` set by interposer with `HOME` unset and empty | 9 same |
| `remove_var`, length 510-514 and 800, 1000, with `\xff` and with `a` | 14 same; 511 fits, 512 gives `None` |
| `pw_dir` holding `\xff`, or no passwd entry | 3 differ, R5 |

**The unit test's expectation is partly circular.** `home_of()` is compared with `homedir()`, which is also what the code calls, so it would not notice `homedir()` being wrong. Bun does give the passwd home for an empty `HOME` (checked), and the real programs above confirm it.

**`RUSTC_LOG*`.** Ten variables through the real driver: same. `MIRI_LOG`, `MIRI_LOCAL_CRATES`, `RUSTC_LOG`, the pair, `MIRI_TRACING` with `\xff`: same. `MIRI_BACKTRACE=\xff` differs, but as `unported` (exit 70), not a wrong answer, for lack of `Backtrace`.

**Other `process.env` reads.** R3 is what differed. Read against upstream: `RUST_BACKTRACE`, `RUSTC_FORCE_RUSTC_VERSION` and `RUST_TARGET_PATH` are `var_os` there, and `COLORTERM` and `TERM` are only compared with ASCII, so a lossy value gives the same answer here. Run against the oracle with `\xff`, same: `RUSTC_FORCE_RUSTC_VERSION` and `RUST_BACKTRACE` on `--version` and `-vV`; `RUSTC_BOOTSTRAP`, `RUSTC_ICE`, `RUST_MIN_STACK` and `CARGO_CRATE_NAME` on a compile. `RUSTC_GRAPHVIZ_FONT` was not compared.

### 4. `748e89e1`: holds

- `--impl shim`: `check-ui`, `tydump-ui`, `mir` sample 5 each, all MATCH.
- `--impl stub`: the same, all UNPORTED.
- `.env` in the cwd saying `RUST_TS_DATA=/wrong/data`, a Windows `RUST_TS_HOST_TUPLE`, `RUST_TS_IMPL=shim`, `RUSTC_LOG=debug`: head runs the port, prints `aarch64-apple-darwin`, stays silent, exit 0. Base visibly forwards to the oracle and prints its log.
- No `.env.local` and no variable: a loud `unported: CFG_COMPILER_HOST_TRIPLE (set RUST_TS_HOST_TUPLE in .env.local …)`.
- `RUST_TS_DATA` and `RUST_TS_HOST_TUPLE` from `.env.local` are read at the repo root and by the harness.
- N1 per-process directories: read. N2: sizing the allocation by `utf8_len` fails the test, as the handoff says. N3's comment: accurate.

### 5. `894c9c8e`, `StalledPrefix`: reliable, with holes listed

- **Hook off production paths:** only `stalled_prefix_driver.ts` calls it, and only the test uses that. Production pays one comparison per pass.
- **Not order-dependent:** 12 of 12 clean runs with the program order alternating, and each program passes alone.
- **Killed in both orders:** the lane's 7, plus wrong slots, each of the int, const and sub tables unwatched, a prefix one too long, `record` one too far, a grown table losing its marks, `note` off by one, `matters` always false, `watch_state` constant, `mark` a no-op. Breaking the hook itself (off, minimum left at 64, not counting) is noticed by `skipped > 0`.
- **The lane's claim that each program catches bugs the others miss** is true of `ints`, `consts` and `tait`.

| Survives this test | Also in `src/vendor/ena`, `solve/`, `old_solve` |
|---|---|
| M5 opaque check in `extend_over` removed | survives; the earlier review could not show it matters either |
| M7 rollback does not report | killed by ena's random walk |
| Float table unwatched | survives (R4) |
| `pending` identity not checked | survives |
| `stalled_prefix_owner` not checked | survives |
| `forget` keeps its marks | survives |
| `set` does not report | survives |
| `get_mut` does not report | killed by ena's test |
| `changed_from` not reset | only ever shortens the prefix, so survival is correct |

The identity, owner and `forget` checks are held only by reading. I don't believe any is wrong today. As the handoff says, this does not exercise the old solver or `-Zdisable-fast-paths`.

### 6. `551f8705`, intern hash: results identical

**No iteration depends on the hash.** `hashed` and `collided` are private to `sharded.ts`, nothing iterates them, and `len()` is a count. Equal values still hash alike: of 300,000 generated pairs, 171,862 were equal, none of those had differing hashes, and `value_eq` never disagreed with the key text.

**First-interning order, measured.** 240 programs by stride over 6,641 candidates in 20 `tests/ui` directories, on base and head with the observer on: same exit, stdout, stderr, the same interner calls, the same SHA-256 over the keys in first-seen order, and the same id total. Keys hold child ids, so this is the id sequence, not just totals. In all: 1,998,965 calls, 515,943 distinct keys, 551,558 ids.

**Instruction cost, real programs,** alternating, output identical:

| Program | Round | Base med (range) G | Head med (range) G | Change |
|---|---|---|---|---|
| `variance-overflow.rs` | 1 (5 runs) | 60.7 (60.6-60.9) | 61.4 (60.9-62.2) | +1.2% |
| | 2 (6 runs) | 60.4 (59.6-61.1) | 60.8 (59.5-61.3) | +0.7% |
| `param_mismatch2.rs` | 1 (5) | 249.2 (249.1-251.8) | 252.6 (251.8-255.9) | +1.4% |
| | 2 (6) | 251.6 (251.3-252.8) | 253.6 (252.0-254.8) | +0.8% |
| `deep-try-chain-issue-153583.rs` | 1 (5) | 62.9 (62.7-63.3) | 62.5 (60.4-62.9) | -0.6% |
| `many-closures.rs` | 1 (5) | 153.4 (151.8-154.2) | 153.7 (153.0-154.7) | +0.2% |

RSS level on all four. **What it buys on real programs is small.** Lookups where the bucket's first entry was a different value, base to head:

| Program | Lookups | Base | Head |
|---|---|---|---|
| `variance-overflow.rs` | 4,759,566 | 0 | 0 |
| `deep-try-chain-issue-153583.rs` | 171,695 | 8 | 4 |
| `param_mismatch2.rs` | 2,889,396 | 1 | 0 |
| `hkl_forbidden.rs` | 5,006,161 | 11 | 6 |
| `many-closures.rs` | 868,081 | 777 | 11 |

The lookups column counts `intern_value` only; the other two also count `intern_slice`. Even `many-closures`' 777 saved no instructions. The gain is against the worst case, reproduced on the lane's grids: 2,338,597 to 1,845, 939,916 to 119, 3,739,068 to 1,844 and 1,920, against about 1,860 for random hashes. Root can weigh that against under 1.5%.

**`intern_key.test.ts`'s changed expectation:** acceptable. It is a property of the hash, not an oracle value, and `a0` and `b0` still test what the old pair did: an equal hash on unequal values, with `value_eq` saying no.

**`rmeta-core`:** 82,338 of 82,338 MATCH on all four runs, so the dumped sections equal the oracle's.

| Run | Side | Max RSS MB | User s |
|---|---|---|---|
| 1 | head | 11,080 | 134 |
| 2 | base | 11,302 | 147 |
| 3 | head | 11,385 | 151 |
| 4 | base | 9,006 | 193 (load peaked here; not comparable) |

All under the 12,288 budget, with no sign of a change.

### 7. `5851b0bb`: holds

- Checker, base against head: mapped counts and the two refused sites unchanged. Head with `--oracle 100`: 86 comparable, 206 locations, 0 wrong, 14 refused; ICE corpus 49 of 49.
- 26 of my 30 nested shapes and all 23 non-nested shapes come out right, including `const _`, attributes, `pub(in …)`, `>>`, `->` and const arguments in a header.
- **Not found as nested:** an `enum` discriminant, and a const expression in `struct`, `type` or `union`. I did not search the pin for a tracked call in one; `ice-report-fix` N1 does not name these shapes. The earlier hazard stands: the checker shares this predicate, so it cannot see its own misses.
- N5 and N6: the phrase is gone from `track_caller.ts`, and `ice_path.oracle.test.ts:51-55` compares the whole stamp. `ice-report-final` N7 (wall or CPU time in F5) was not in the lane's brief and is still open.

### 8. Sample runs and checks

`RUST_TS_REQUIRE_PROBES=1`, `RUST_TS_AGENT=review-fixers-42`.

| Suite | Total | MATCH | Other |
|---|---|---|---|
| `miri-hello` | 1 | 1 | |
| `check-rg` | 36 | 36 | |
| `run-pass-miri` | 200 | 200 | |
| `miri-pass` | 200 | 194 | 4 UNPORTED (sockets, `/proc`, aes), 2 UNSTABLE by design |
| `mir` | 200 | 200 | |
| `check-ui` | 200 | 200 | |
| `tydump-ui` | 200 | 198 | 2 UNSTABLE by design |
| `pm-ui` | 200 | 198 | 1 UNPORTED, 1 UNSTABLE by design |
| `mono-ui` | 200 | 199 | 1 DIFF |

No listed case is in its suite's baseline. The `mono-ui` DIFF, `tests/ui/explicit-tail-calls/callee_is_track_caller.rs`, also differs on base in both revisions, so it is not from this lane.

- `bun test`: `src/rust_ts src/rustc_log src/std src/rustc_data_structures src/vendor/ena src/rustc_driver_impl` 507 pass; `src/miri` 443; `src/rustc_trait_selection` 140; `src/rustc_middle` 362; 0 fail. Same as the handoff.
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check --offline`: `markers ok (24848; vendor 5086; library 601)`.
- **Unit time,** CPU, best of 3 on each touched file: **+3.3 s**, against the lane's 2.5 s and F5's 5 s. `fulfill_stalled` 2.15, `rustc_log` oracle 0.32, `stack.test.ts` +0.26, `environment.oracle` +0.46 (the lane saw none; load was higher here), `intern_key` +0.14.
- **Upstream checkout:** only `!! build/`.

## Seen, not from this lane

All exist on base too.

- A cwd of 1,024 bytes or more: the port stops with `Current directory is invalid: Result too large (os error 34)` (`src/rustc_session/config.ts:3226`) where the oracle compiles.
- `HOME` or `XDG_CACHE_HOME` over 1,023 bytes: Bun itself panics at start, exit 134, before any port code. The oracle runs.
- `src/miri/bin/miri.ts` does not read `RUST_TS_IMPL`, so `--impl stub` on `miri-hello` scores MATCH instead of UNPORTED. `--impl` cannot validate the harness on Miri suites.
- Start-up is worse than linear in entries: 10,000 entries 222 ms CPU, 40,000 2.0 s, 60,000 4.3 s.

## Not checked

- A `.env` read by `process.env` before `ensure_stack`, beyond `stack_env_driver` and the entries.

- Linux and Windows. Nothing here ran there.
- A kernel with a different limit, or another macOS version: reasoned from the old script's failure, not reproduced.
- `/bin/sh` pointing at zsh or dash: those shells were run directly.
- The gate and full suites, as instructed; the 118 ICE cases; `rmeta-alloc` and `rmeta-std`.
- A program that needs M5, and tests that would kill the `pending`, owner and `forget` mutations.
- `hkl_forbidden.rs`'s instruction cost: only its collisions were counted.
- `RUST_TS_IMPL` on an actual non-UTF-8 value. The lane's lossy decode is what the entries compare, and it can't equal `shim` or `stub`.
- Raw `.rmeta` bytes other than through the `rmetadump` sections.
