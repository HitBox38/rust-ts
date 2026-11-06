# Handoff: harness-w41 (harness batch; no port code)

Branch `t3/gate-power-safeguards` (the session's branch; it started as `t3/645f47ad`), merged from `integ-w40` at `11ded631`. No `src/`, baseline or `harness/scope.json` edit. It needs its independent review (AGENTS.md section 2).

## Items

1. **Power, `71c5f70c`:** `gate.ts run` refuses on battery with one `ERROR:` line, `--allow-battery` overrides, power lost during a run is a `note:`, and `gate.json` gains `host` plus each suite's `startedAt`, `endedAt`, `hostStart`, `hostEnd`; no status or verdict reads any of it, and no battery or no `pmset` does nothing.
2. **`parse`'s 3 ORACLE_TIMEOUT, `97d34408`:** skipped with `PARSE_SKIPPED`'s own text; 0 of 3 are in `parse.txt`, and nothing else moves.
3. **L2 and N1-N5, `61448ce9`:** on a Miri ICE only `thread 'rustc'` is masked and the first marker is anchored; N1, N2, N4 and N5 are corrected, and N3's typos are now reported, except the stale comment at `src/rust_ts/track_caller_check.ts:10`, as `src/` is outside this lane.
4. **`bun --preload`, `b3c9f0a6`:** the Miri subject preloads `miri_stack_first.ts`, 17.5-26.3% fewer instructions, with no oracle key or evaluation order changed.
5. **Nits, `ff932780`:** H8 and H10 done; `harness-w39` N3, `harness-m6c` N1 and everything in `plan-ice-report.md` and `ice-report-impl.md` marked for a harness batch were already closed, each checked.
6. **`PORTING.md`, `3252743f`:** section 5 now says how interning works, and which interners still use a key string.

## Case lists, merge base against head

371,901 cases on the base, 371,898 on the head.

| What | Difference |
|---|---|
| `parse` | 21,526 to 21,523 cases, 0 to 3 skips; those 3 are the only cases gone |
| The 9 Miri suites' 5,231 cases | The subject's argv gains `--preload <path>`, and nothing else on those lines: with that removed, the dumps differ only in `parse` |
| Oracle keys | Only `ir-hello`'s 2 change, as `ir-normal.ts`'s text is in `irOracleKey` and H10 edits its header. One oracle re-run; no baseline. `parse`'s 3 keys are gone with their cases |
| Oracle commands, env, args, unstable lists, other skips | None |

## Item 1

- **Refused before anything runs**, so no run directory. The line names the charge and the flag.
- **Sampling:** `pmset -g batt`, `sysctl -n vm.swapusage` and `loadavg`, polled every 60 s. A poll is kept when power changes or every 10 minutes, and each suite's two ends are always kept. Held in memory until `gate.json`, so a poll cannot write to the tree during a gate.
- **Tests:** fake readers, including a real `gateRun` on a stub suite: refused, `--allow-battery`, power lost mid-run with the same statuses as a steady run, and no `pmset`. Real readers checked once by hand on AC.
- **Judgement calls:** a UPS does not count as battery, as nothing shows a slowdown there. A move back to AC gets a `note:` too. Each retried case's times were already in `retryTimes` (harness-w40); the optional cases/s curve is not done.
- **Not run:** a real gate, per the brief.

## Item 3

- **One positive expectation changes:** `unstable.test.ts` expected `stderrMask(true, ICE)` to mask `thread 'main'`, which is L2's bug. Every plant stays, with new ones added.
- **No cached entry moves:** old and new masks give one text on all 5,230 cached Miri entries (334 with a thread line, 1 ICE, `mir-validation.rs`).
- **Still hidden:** a program that names its thread `rustc` and prints an ICE marker at the start of a line. Text alone cannot tell that from an ICE. It hides only the digits of that line, and no case does it.
- **Safe direction:** a host panic on a thread other than `rustc` now shows as a DIFF. None exists today.
- **N3:** `//rustc-call:` and `//rustc-const:` with any spacing but one space are now `malformed`. `//rustc:` was not asked for and is unreported by its own pattern; `src` and `tools` hold none.

## Item 4

Total instructions, with and without, alternating which goes first, `/usr/bin/time -l`, at load 3-35. Same `harness-w41` sample as difftest.

| Runs | Without | With | Saved | Median RSS MB |
|---|---|---|---|---|
| `miri-hello`, 10 runs | 287.5e9 | 211.9e9 | 26.3% | 629 to 618 |
| `run-pass-miri`, 100 cases | 3,181.5e9 | 2,427.8e9 | 23.7% | 581 to 579 |
| `miri-pass`, 100 cases | 4,372.9e9 | 3,605.6e9 | 17.5% | 688 to 679 |

Stdout, stderr and exit are the same on every run but `mir-validation.rs`, whose one differing line is the host's thread id (raw hashes; the mask covers it).

Your questions:

- **Load order and C10:** a plugin prepending a log line to each module, on hello: 2,245 modules in the second process, byte-identical with and without, each once. The first process evaluates the same 11.
- **`process.argv`:** the same (scratch program, with `--preload` also in the arguments). `process.execArgv` holds the flag, and nothing in `src`, `scripts`, `harness` or `tools` reads it.
- **`args_os`:** it takes the raw argv's tail after the script, so the flag cannot reach it.
- **The environment and `fixers-41`'s restore:** a program printing raw `environ`, `args()` and `var_os` under isolation off, from a cwd with a `.env`, is byte-identical on the oracle and both forms, in 3 environments: plain; odd names, non-UTF-8 values and marker lookalikes; and entries `env` cannot carry (so no re-exec).
- **What a program can see:** a native proc macro reading `_NSGetArgv` would see the flag, as it already sees `bun` and the script rather than `rustc`. Miri suites run no proc macro.
- **Not run:** Linux, where the raw argv comes from `/proc/self/cmdline` and takes the same path. Bundles are unchanged (`Bun.main` does not match there).

**A figure I threw away:** my first measurement showed 49%, and every run in it exited 101, as my script passed `null` env values to `Bun.spawn`. The table is after the fix, with exit codes checked. Nothing from the bad run is committed.

**`src/rust_ts/miri_stack_first.ts:4`** still says the cost is not avoided; true of the import, not of the harness's command line. For a `src` lane.

**`mirdump.ts` and `resdump.ts`** also call `ensure_stack` with static imports, so they may have the same cost. A preload needs a `src` change there; not measured.

## Checks at the head

`RUST_TS_REQUIRE_PROBES=1`, on AC.

| Check | Result |
|---|---|
| `bun test ./scripts ./harness` | 351 pass, 0 fail |
| `bun test ./tools` | 72 pass, 0 fail |
| `bunx tsc --noEmit -p .` | Clean |
| `coverage.ts --check --offline` | `markers ok` |
| Upstream checkout | Only `!! build/` |
| Unit time added | About 2 s CPU of the 5 s budget (`gate-power` and `host-state` 1.9 s, the `parse` test under 0.1 s) |

`--sample 100`, `RUST_TS_AGENT=harness-w41`, `--jobs 5`:

| Suite | MATCH | Other, none protected |
|---|---|---|
| `parse` | 100 | |
| `mir` | 100 | |
| `run-pass-miri` | 100 | |
| `miri-pass` | 97 | DIFF `mir-validation.rs` (frames); UNPORTED `socket-address.rs`, `intrinsics-x86-aes-vaes.rs` |
| `miri-hello` | 1/1 | |

No TIMEOUT, CRASH or ORACLE_TIMEOUT. `ir-hello` 2 UNPORTED, as before. Coverage unchanged: no port code. No `unported(...)` and no `// PORT:` added.

## For root

- **Next gate:** Miri suites should take less time. `ir-hello` re-runs its oracle once.
- **Stale in `src/`, not touched:** `track_caller_check.ts:10`, `miri_stack_first.ts:4`, `rustc_middle/ty/context.ts:1895,2816` (fixers-42 has the last, as perf-near-limit N4).
- **PORTING change:** the review asks root to record the decision (perf-near-limit N4).
- **Open, not in this brief:** `docs/reviews/harness-m7a.md` N2, the gate's closing line after a stale probe (`missing probes; build them`).
- **`--allow-battery`** is documented only in `gate.ts`'s header and usage. `AGENTS.md` is yours.
