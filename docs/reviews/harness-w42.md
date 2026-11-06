**Verdict: REQUEST CHANGES.** One required fix: H5's lock makes the two sides of one case wait for each other inside their time limits, within a single difftest, which reproduced a false TIMEOUT; everything else holds, and no protected suite is affected.

# Review of `harness-w42`

Independent review of branch `t3/fix-harness-review-findings`, head `c861b3a6`, against `main` at `9e11cc8b`. Line numbers are at `c861b3a6`. Patches and stubs ran in a scratch worktree and temp data directories, all removed. This file is my only change to the tree.

## Findings

| # | Severity | Where | Failing scenario | Evidence |
|---|---|---|---|---|
| F1 | **Required** | `scripts/difftest.ts:1028`, `scripts/ir-run.ts:100` | The oracle and subject of one uncached non-heavy case start together and take turns on the lock, with the wait inside each one's limit. A subject that fits its limit alone gets a TIMEOUT. Past the retry cap, that TIMEOUT is the final status | **Reproduced** |
| N1 | Nit, open risk | `scripts/ir-run.ts:100`, `scripts/lib/case-lock.ts:50` | `ir-run` is SIGKILLed while its compiler lives. The next run takes the lock at once, and the orphan's `.ll` lands in its `work` and is printed as that run's IR | **Reproduced** |
| N2 | Nit | `scripts/ir-run.ts:80` | A plain SIGTERM, difftest's only kill, during the normal form leaves `work.lock` and `work` behind, since the handlers exist only around the compiler. So a stale lock does not need a SIGKILL | **Reproduced**; recovery too |
| N3 | Nit, docs | `docs/handoff/harness-w42.md`, `scripts/ir-run.ts:10` | Two statements are wrong: "The gate alone is one difftest", and "as `check-rg` does". `check-rg` is `heavy`, so its sides already run one after the other | Read; flags dumped |
| N4 | Nit, test gap | `scripts/lib/host-state.ts:64` | Deleting `process.off("exit", killAtExit)` fails no test. It is harmless today, because Bun sends no signal to a reaped child | **Mutation survived**; kill calls logged |
| N5 | Nit, docs | `docs/handoff/harness-w42.md` | "A gate SIGKILLed still orphans a read" understates it: SIGTERM does too, as no `exit` event fires | **Reproduced**: `sleep 9`, parent 1 |
| N6 | Low, flake margin | `scripts/lib/host-state.test.ts:138`, `:177`, `:220` | Three fixed deadlines fail on a slow host, where the handoff says a slow host makes the tests "pass or wait, not fail" | Read. **Not reproduced**: margins are large, below |

### F1: the lock's wait counts against the limits inside one difftest

**The handoff's reasoning.** It notes that a lock wait counts against difftest's timeout, but only for "two difftests on one case at once", and adds that "the gate alone is one difftest".

**What the code does.** One difftest is enough. For a non-heavy suite, `difftest.ts:1028` runs `Promise.all([runOracle, runSubject])`, so an uncached case has both `ir-run`s alive together. `ir-hello` is not heavy, and neither is `ir-run-pass` as planned. `withCaseLock` says the wait "never counts against the limits" (`case-lock.ts:56`), which holds where difftest takes the lock around the run, but here the waiting process is the one being timed.

**The test.** A stub suite with the real `ir-run.ts`, real `opt`, and difftest at `jobs: 4`. The limits are `ir-hello`'s, scaled 60:120 down to oracle 1 s, subject 2 s. Every compile fits its limit alone. Only `ir-run.ts` differs between the columns.

| Stub | `main`'s `ir-run` | Head's `ir-run` |
|---|---|---|
| 6 cases, oracle 0.3 s, subject 1.8 s | 0 re-run, 3.8 s | 3 subject TIMEOUTs re-run alone, 9.8 s |
| 6 cases, oracle 0.9 s, subject 1.8 s | 0 re-run, 3.8 s | 4 re-run, 12.2 s |
| 80 cases, oracle 0.9 s, subject 1.8 s | 0 re-run, 36.9 s | 43 re-run, 127 s, all MATCH |
| 130 cases, same | Not run | **50 re-run (the cap), final: 117 MATCH, 13 TIMEOUT**, 172 s |

**How far this reaches.**

- **Today:** `ir-hello` has 2 cases and no baseline, and is not in the gate's defaults. **No protected result can change.**
- **When it bites:** only when the oracle is uncached and oracle time plus subject time exceeds the subject's limit. That is every first run of a new key, and any change to `ir-run.ts` or `ir-normal.ts` is a new key.
- **Why fix it now:** `ir-run-pass` has 3,478 cases and M7's gates read it, and a false TIMEOUT on a protected case is a false loss. The cap is `SUBJECT_TIMEOUT_RETRY_CAP`, 50. The stub's subjects sit near the limit on purpose, and real ones mostly will not.
- **The other order, by reading:** when the subject takes the lock first, the oracle's first attempt can die waiting. The retry has 4x the limit, so ORACLE_TIMEOUT needs a subject slower than 5x the oracle's limit. That cannot happen on `ir-hello` (300 s against 120 s), but could on a suite with a wider ratio. I did not see one in these runs.

**A fix I tried.** Run an IR suite's sides one after the other at `difftest.ts:1028`, as a heavy suite's are: `s.irTier ? [await runOracle(...), await runSubject(...)] : await Promise.all(...)`. On the same stub with 24 cases: 0 re-run, 24 MATCH, 16.7 s. The lock then guards only against a second difftest, which is what the handoff's note describes. This needs a test: a stub IR suite whose two compile times together exceed the subject's limit.

### N1: what a SIGKILL does

The next run recovers **at once**, since the owner is dead. It does not wait or fail. But if the compiler is still alive, the fixed path is now shared. On a stub, the next run's compiler wrote no `.ll`, and it printed `ir: orphan.ll N1` with the orphan's function.

Reaching this takes a SIGKILL of `ir-run` itself. Nothing in the harness sends one, since `run()` only sends SIGTERM (`common.ts:114`), and a kill from outside would normally hit the larger compiler. If it does happen before an uncached oracle run, a subject's IR could be cached as the oracle's until the key changes. By reading; I did not run that last step. Keep it recorded as an open risk, and clear `<out>/work`'s owner before M7's suites are protected: for example, have the lock's owner also record the compiler's pid, and wait for that pid too.

### N2: a stale lock from an ordinary timeout

On a stub, SIGTERM after the compiler finished gave exit 143 with `work.lock` and `work` left behind, in 2 of 13 crudely timed tries. The next run recovered in 0.03 s.

This makes the "two waiters see one dead owner" case in `case-lock.ts`'s header reachable without a kill: an oracle retry and a waiting subject can see the same dead owner. That header calls it "not handled", on the grounds that it needs a killed difftest. **I could not produce an overlap: 0 of 70 rounds** from a dead owner's lock with both sides started together. So this is by reading only. F1's fix removes the same-difftest form of it.

## What I checked, by the brief's questions

**1. Oracle keys: the lane's claim holds, and more strongly than it measured.** I compared all 67 suites between `main` and head at one path, with **the full cache key of every case, 371,898 cases**, not every 50th. I also compared `oracleKey()`, case ids, args, env, file, the first case's commands, limits and modes. 66 suites are identical. `ir-hello` differs only as the lane says: `a7e1e141...` to `3fdbf326...`, its commands, and `irTier`. It is the only suite with an `irTier`. The tier is only in `irOracleKey` (`harness/suites.ts:2075`), which only `irSuite` uses.

**2. Reporting only: yes for F2, the tier and the exit kill. No for H5, which is F1.**

- **No hang or silent exit.** A stuck read always has a referenced timer, and a skipped one returns at once. A script ending naturally with a read stuck exited in 1 s, with the holding child alive for 15 s, the same as `main`.
- **No status moved** in the stuck gate test: the mutation that drops the guard fails it, and the statuses are asserted.
- **Nothing is written to the tree.** `bun test ./scripts ./harness` left the tree clean (373 pass, 0 fail), with nothing left in a private `TMPDIR`, no probe changed and the upstream checkout clean.
- **`history.jsonl`.** `irTierError` returns before reading it for N1, and every suite is N1, so no unit test depends on its contents today. The test reads the working tree's file, so a tier decision recorded but not committed would satisfy it, but that tree is dirty and cannot be accepted. The real file, 640 lines, parses, and a record in `state.ts`'s form satisfies the rule.

**3. H3: the report name is refused everywhere.**

- `gate.ts run --suites ir-hello@N3` refuses before anything runs. It is a raw `unknown suite` throw, not an `ERROR:` line, as for any unknown name before this batch.
- `gate.ts accept` on a forged, passing `gate.json` naming `ir-hello@N3` first refuses, and no baseline is written. It reached that check because it is first in the list.
- `criteria.ts` reads only `gate.json`, so it cannot see the name. `baseline/` is never written with it.
- **The cache cannot be poisoned:** the key holds the suite name and the tier-bearing `oracleKey`, and `--out` holds the name, so the two forms share neither entries nor a lock. `--ir-tier N3` ran for real as `ir-hello@N3`: 2 UNPORTED, its own files, summary tier N3, no criterion. `--ir-tier N1` on `ir-hello` is simply the real suite, which is harmless.

**4. H5's lock.**

| Case | Result |
|---|---|
| SIGKILL with the lock held | Next run recovers at once (N1) |
| SIGTERM while waiting | The waiter dies, and the lock is untouched |
| SIGTERM during the compile | Passed on; lock released |
| SIGTERM during the normal form | Lock left, recovered next run (N2) |
| Dead owner's pid reused by a live process | Waits. The caller's limit ends the wait, and at 2 h the lock is taken. **Not for ever.** Reproduced with a live pid and a file aged by `touch` |
| Deadlock | None by reading: one lock per case, no nesting, and the waiters hold nothing. 130 cases at `jobs: 4` ended |

**5. N1's exit kill: right.** I logged every `kill(2)` by interposing it in Bun.

- An in-flight read at `process.exit` gets `kill <its pid> 9`. It kills only that pid, not any child of it.
- A read that has ended gets **no kill**, and the exit listeners go back to 0.
- With the listener deliberately left on, an exited child still gets no signal (N4). So a reused pid is not at risk.

**6. F2: the lane's bound holds, and is now measured.** A stub whose child holds stdout past Bun's SIGKILL, with the real 5 s and 6 s limits, sampled for 30 s: the note fires at 6.0 s, once. Samples then take 0.0 s, with swap still read. When the read settles at 12 s, the next sample starts a new read, so it resumes. It stuck again, with no second note, and never more than one process alive. The bound of two needs a poll and a mark overlapping; marks are sequential and polls are guarded, so I read it as 2 per reader, and 4 per gate if both readers stick. A healthy read with the main thread blocked 6.5 s by sync work gives no false note.

**7. N2's test: stable, quiet and clean.** It passes from another cwd with no `.env.local` and no `RUST_TS_DATA`. Its command passes under `sandbox-exec` with network denied and no `rustc` on `PATH`, in 1.41 s, so it touches neither the network nor the oracle. It leaves nothing behind.

**8. Test quality: the sampled mutations all fail, for the right reason.**

| Mutation | Result |
|---|---|
| H5: no lock | Failed 3 of 3 |
| H5: pid back in the path | Fails |
| H5: `work` not cleaned (mine) | Fails |
| N1: no kill | Fails |
| F2: no guard | Fails in both test files |
| C3: only a first reading says "by" | Fails |
| N2: import removed | Fails, on `bogus-host` |
| H3: tier not in the key | Fails |
| N1: listener not removed (mine) | **Survives** (N4) |

**The rewritten H5 test is sound.** An exclusive file makes an overlap fail, and on a slow host the runs still take turns, so timing cannot fail it. It does not test F1, because it asserts only that the runs take turns.

**Flakes (N6).** I found no flake. `host-state` and `ir-normal` passed 3 of 3 at background QoS and `nice 19`, at load 14. Spawn to pid written took at most 27 ms against the 2,000 ms deadline, and kill to reaped at most 2 ms against 1,500 ms. The gate passes `--timeout=60000`, so the new tests with no limit of their own are fine. Those loops end as soon as they succeed, so raising the deadlines at `:177` and `:220` costs nothing when they pass. I would do that, given that load has reached 100-300 and a flake costs a gate. It is not required.

**9. C3: right, and the step past the finding is too.** A failed reading followed by a change gives "by" for power back as for power lost, and a good reading in between resets it to "at". `was === undefined` cannot reach the power-back branch, so "by" there comes only from a failed reading. The closing note (`scripts/gate.ts:459`) says "first seen at", which still reads true.

**10. Unit time: confirmed.** The 5 files, alternating head and base, 3 pairs, load 15-18:

| | Head | Base | Added |
|---|---|---|---|
| Wall | 8.7-9.6 s | 5.6 s | 3.1-4.0 s |
| CPU | 10.2 s | 6.4 s | 3.8 s |

This is under the 5 s budget. An earlier, unpaired pair at load 30 gave 10.4-16.5 s for head, so I give that no weight.

**Also checked.** C5's pointer, section 4 of `root-w40-check2.md`, does cover `floats`. `marker-check.ts` does check `rustc-call` and `rustc-const`. The Miri suites do use `--preload`. `gate-probes.test.ts` fails on an empty data directory on both base and head, so that is not new.

## What I did not check

- A gate, a real accept or a real battery. No difftest suite other than `ir-hello` and my stubs.
- F1 against real compile times: the stub shows the mechanism, not how many real cases sit near a limit. `ir-run-pass` does not exist yet.
- A process truly stuck past SIGKILL in the kernel: the F2 stub is a child holding stdout, which is the same shape to the reader.
- Pid reuse itself. I showed that no signal is sent to an exited child, and a live foreign pid in the lock waits as above.
- ORACLE_TIMEOUT from F1, and the SIGKILL case reaching the oracle cache: both by reading.
- Linux and Windows. A second run of all 25 of the lane's mutations: I sampled 7 of its mutations and added 2.

## Housekeeping

- **`$RUST_TS_DATA`.** My `--ir-tier N3` run reused the lane's oracle entries and created `ir/ir-hello@N3`, empty of files, which I removed by exact path. My run directories are removed. Everything else used temp data directories.
- **Other lanes.** I used no `pkill` or `killall`, and killed only PIDs I started.
- **Scratch.** The scratch worktree is removed. `.env.local` is copied with `RUST_TS_REQUIRE_PROBES=1`, and is gitignored.
