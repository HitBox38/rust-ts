# Review: harness-w39 (harness batch: lock, aux test, scope, probes, CPU test, `.env.local` note)

Branch `t3/harness-cache-test-fixes`, head `304e6952`. Lane commits `a4fedf9f`, `4dc9de69`, `83326b06`, `04650e49`,
`6a8f1416`, `ae66ba91`, plus the handoff. Base for comparison: `integ-w38` `223c634a`. Independent and read-only: no lane
code was edited, and every mutation below was reverted. No gate or full suite was run.

## Verdict: APPROVE WITH NITS

Nothing here makes a result pass or hides a difference. Case lists and oracle keys are unchanged, and baselines, statuses
and limits are untouched. Every claim in the handoff that I reproduced held.

**Root should read A1 before following the handoff.** Its advice to run `bun scripts/probes.ts build` looks harmless, but
it can empty the oracle cache of up to 24 protected suites (160,204 cases). This is a decision for root, not a code defect,
and merging the branch does not trigger it.

## Findings

| id | severity | where | finding |
|---|---|---|---|
| A1 | **medium, for root** | `docs/handoff/harness-w39.md:33`, `scripts/difftest.ts:252` | Rebuilding the probes to stamp them changes their binaries, and so the oracle cache keys |
| N1 | low | `scripts/lib/case-lock.ts:55`, `scripts/difftest.ts:999` | A stale lock whose pid is alive again stalls the case for 3.5 h, with a false message |
| N2 | low | `scripts/gate.ts:103`, `:349`, `:402` | The pre-check ignores staleness, so a stale probe costs a whole gate before it reports |
| N3 | nit | `scripts/difftest.ts:997-1000` | No test notices if difftest stops taking the lock |
| N4 | nit | `scripts/lib/common.test.ts:14` | Reading `sysMs` as `userMs` is not caught, and a one-line change catches it |

### A1: the rebuild the handoff asks for empties oracle caches

Probe suites are keyed by a hash of the probe binary (`oracleVersion`, `difftest.ts:252`). A binary embeds its source path,
so the same sources built from another worktree give different bytes. Measured on `miripaths` in a private data root:

| build | binary sha1 |
|---|---|
| this worktree | `5fc99aaa68c5a301` |
| this worktree again | `5fc99aaa68c5a301` |
| a second worktree, same commit | `569cb9f6fa86fdc4` |
| back to this worktree | `5fc99aaa68c5a301` |

The 38 real binaries come from 10 different trees, going by each one's cargo `.d` file: 23 from `.data/integ`, 5 from the
main checkout, and the rest from lanes and old integration trees. A plain `build` from any single tree therefore changes
most of them.

**Failing scenario:** root runs the handoff's command, then starts a gate. Each probe suite whose binary changed gets a new
key, so its oracle runs again instead of reading the cache. At most these 24 suites and 160,204 cases: `lex`, `escape`,
`tokens`, `resdump`, `resdump-nocore`, `tydump-nocore`, the UI dumps, `borrowck-ui`, `rmeta-*` and others. I did not measure
how long that takes. A gate that already takes about 10 h gets longer, and more oracle processes run at gate load.

Results should not change: the probes come from the same pinned upstream, so a difference would mean an old binary did not
match its sources. Finding that is the point of L3, so the rebuild is worth doing, but as a planned step. Root's options:

1. **Rebuild once, deliberately (recommended).** Do it with no gate running, from the tree the gate will run on, and allow
   for the cold cache in the next gate. This also proves the binaries match the current sources, which nothing shows today.
2. **Rebuild only when a probe changes.** The other probes stay `unknown`, so L3 checks little for a long time.

The handoff should state this cost. A lane or root could also add a stamp-only command, but that would record a hash without
proving the binary came from those sources, so I do not recommend it.

### N1: stale lock with a live pid

The takeover test is "owner is dead, or the lock is older than `maxHoldMs`". For `miri-pass-heavy`, `maxHoldMs` is
`2 * ((1 + 4) * 900,000 + 1,800,000)` = 12,600,000 ms = **3.5 h**. Measured with a 4 s limit:

| lock content | wait | note printed |
|---|---|---|
| dead pid | 1 ms | none |
| pid of a live process (a reused pid) | 4,036 ms: the full limit | "waiting for pid 1 ... another difftest is running this case" |
| this process's own pid | 4,040 ms: the full limit | same, naming itself |
| empty (killed between create and write) | 4,031 ms: the full limit | "waiting for pid ?" |

**Failing scenario:** a reboot during `shims/fs.rs` leaves a lock. On the next gate that pid belongs to some other live
process, so the gate sits on that case for 3.5 h, and its note wrongly says another difftest is running. Results stay
correct, and the wait is bounded. The odds are small (the host has had reboots, and pids restart low), and today only the 7
`miri-pass-heavy` cases can hit this.

**Fix, about 3 lines:** treat a lock as dead when its mtime is older than boot (`Date.now() - os.uptime() * 1000`), when the
pid is this process's own (heavy suites run one job, one suite at a time), or when it is empty and more than a few seconds
old. Suitable for the next harness batch; it need not hold this one.

### N2: the pre-check does not see a stale probe

`checkProbes` only tests that the binary exists (`gate.ts:103`). Staleness surfaces in the "unit tests" step, and the gate
then still runs every suite before `pass` goes false (`:349`, `:402`).

**Failing scenario:** a lane on an older branch runs `probes.ts build <probe>` and puts its older binary in the shared
target, or a merge changes a probe's source with no rebuild. The gate passes the pre-check and fails the stale test early,
but finishes its roughly 10 h run before reporting `pass=false`. The verdict is right, and only the time is lost.

**Fix:** in `checkProbes`, print one `ERROR:` line for `probeStaleness(probe).state === "stale"`, next to the existence
check. It fails in seconds and does not touch the `unknown` state.

### N3: nothing tests the lock's use

With the lock removed from difftest (`? typeof miriTemp === "string"` changed to `? false`), `bun test ./scripts ./harness`
still gives 180 pass, 0 fail. `case-lock.test.ts` covers only the library, so a later edit could drop the lock silently, or
move the wait inside a limit. My scratch check below (fake heavy suites through the real `difftest()`, in a private data
root) would make a small test.

### N4: `sysMs` read as `userMs`

**Should it be caught? Yes, since it is cheap, but it is a nit.** `scripts/miri.ts time` prints `userMs`, and `MIRI_UI_HEAVY`
membership rests on those figures; no gate result reads it. The mutation survives because the child calls
`process.cpuUsage()` in a tight loop, so the syscalls alone cost about 730 ms of system time, above the 300 ms bound.
Measured:

| child | user | sys |
|---|---|---|
| as written | 306-308 ms | 696-753 ms |
| spin with `for (let i = 0; i < 2e6; i++) x++;` inside the `while` | 306-309 ms | 12-18 ms |

With that inner loop the test passes, and reading system time as user time fails it (`Received: 10.33`). `sysMs` itself has
no assertion: reporting it in microseconds also passes. That was true before this lane too.

## The questions asked

### 1. Case lock

- **Deadlock: none.** One process holds at most one lock, for one case's two sequential spawns. There is no nesting, a
  waiter holds nothing, and heavy suites run one job. Over 30 trials of 4 processes each, 120 runs had no overlap, no
  leftover lock and no bad exit.
- **Stale lock from a kill or reboot:** a dead pid is taken over in 1 ms. A reused live pid or an empty file waits out the
  limit (N1). A gate can stall but cannot hang.
- **False TIMEOUT: none.** `run()` starts its timer inside the call, and the wait is outside. Through the real `difftest()`
  with a 2.5 s limit, holding the lock from another process for 7 s:

  | fake suite | status | what it shows |
  |---|---|---|
  | `fake-wait` (waits 7 s, each side 0.5 s) | MATCH | The wait does not count, in 8.8 s of wall time |
  | `fake-real-timeout` (subject 6 s) | TIMEOUT | A real overrun is still reported |
  | `fake-nolock` (heavy, no `MIRI_TEMP`) | MATCH | No lock file is made |
  | `fake-light` (not heavy, has `MIRI_TEMP`) | MATCH | No lock file is made |

  The note also prints when `quiet: true`, as the gate runs it. Suite `seconds` includes the wait, but it is informational.
- **Suites that don't use it: unchanged.** Only 4 suites have `MIRI_TEMP` (`miri-pass`, `miri-pass-heavy`, `miri-pass-tb`,
  `miri-fail`), and only `miri-pass-heavy` is heavy, so 7 cases take the lock. `run-pass-miri-heavy` and the M5 heavy suites
  have no `MIRI_TEMP` and run the same two awaits in the same order. Oracle keys match on base and head for 1,255 cases
  sampled across all suites.
- **The documented gap is acceptable.** I reproduced it: with a dead owner and waiters released together by a barrier, 3 of
  60 trials with 2 waiters and 6 of 40 with 4 ran at once. No lock was left behind, and every process ran. That barrier is
  far tighter than reality, where waiters poll every 500 ms. It needs a killed difftest plus two more on one of 7 cases. A
  gate runs alone, so it has at most one waiter and cannot hit this. The cost is the race the lane set out to close: a false
  DIFF or a bad oracle entry, which shows up loudly as a DIFF. Closing it fully is not worth the code.
- **Not stated in the file:** a killed difftest's child can outlive it, because only the parent's timer kills children. Its
  lock then reads as dead while that Miri process may still be writing under `MIRI_TEMP`. This follows from reading `run()`;
  I did not reproduce it. It predates the lock, and a lock cannot fix it. No action.
- **Restrict to file-writing cases? No.** 3 of the 7 write files (`issue-miri-3680`, `fs`, `fs-permissions`), and the other
  4 are only slow. A gate pays one create and one remove per case. For the other 4, the lock only makes a concurrent dev
  difftest wait. Restricting it needs a new per-case field passed from `harness/suites.ts`, for no gain to a gate. N1 is the
  only real cost, and that fix applies either way. The list itself is right: upstream's only other hit, `tests/pass/path.rs`,
  calls `utils::tmp()` without writing.

### 2. Aux cache test

- **Base and head reproduced, in a private data root.** A real build planted under the old test's key
  (`f6a850c65fed1eb4` for that root):

  | tree | clean cache | build planted |
  |---|---|---|
  | base | 8 pass | **7 pass, 1 fail** (the aux test) |
  | head | not run | 8 pass, `aux/ui` listing unchanged |

- **No real-time race.** With a 5 s limit instead of 1 ms, `hangs.rs` still gave
  `timed out (5000 ms, then 20000 ms)` after 25 s, so a late timer cannot let the build win. No orphan `rustc` was left after
  the 5 s or the 1 ms run: the rustup proxy exec's, so the kill reaches rustc.
- **No shared cache.** The child's `DATA` is asserted to be the private root, and that root is removed afterwards. No
  temp directory or `rust-ts-failed-aux-*` was left.
- **Still tests its claim.** All six mutations fail the test:

  | mutation of `harness/compiletest.ts` | result |
  |---|---|
  | `auxBuildError` throws `Reject` (skips instead of erroring) | fail |
  | only the timeout path skips | fail |
  | only the non-zero exit path skips | fail |
  | any `error` line rejects, not just the Miri native library one | fail |
  | temp directory left behind | fail |
  | failed build cached | fail |

  The new test is stronger than the old one, since the non-zero exit path was not covered before.

### 3. Case lists

My own dump (cases, skips with reasons, unstable lists, suite metadata including limits, the first case's oracle and subject
commands; repo path normalized) on `223c634a` and `304e6952`: **58 suites, 364,386 cases, 368,443 lines, byte-identical**.
No file under `harness/baseline` or `src` changed, and `harness/suites.ts` changed only in a comment.

Scope moves only coverage numbers, run with a private `coverage.json`: Miri 1483/1514 to 1504/1535, total 24086/27032 to
24107/27053, `markers ok (24707; vendor 5076; library 584)` on both. Only `scripts/coverage.ts` reads `scope.json`. The
shared `coverage.json` was not touched.

### 4. `scripts/probes.ts`

- **L1 holds.** With `MIRI_BE_RUSTC=host MIRI_LOG=debug RUSTC_LOG=debug`, head reports `unchanged (85 lines)` and leaves no
  `.o` files. Base fails with Miri's logging noise and leaves `.rcgu.o` files in the checkout.
- **L2 holds.** `build` and `path` on `miriepoll` and on an unknown name each print one `ERROR:` line and exit 1. Base printed
  a stack trace. A built probe's `path` still works.
- **L3 stale check holds.**
  - Pre-check before the rebuild: **nothing differs.** `oracleTestProbes` over all roots and `checkProbes` over every suite
    give identical output on base and head (28 probes, `true`). The test prints `38 of 38 built probes ... cannot be
    checked`, and passes.
  - Can it pass wrongly? For `unknown`, yes by design: 38 binaries go unchecked until rebuilt. A stamped binary is compared
    to real sources: editing `main.rs` or `Cargo.toml.in` fails the test, and restoring passes it. Against all 38 cargo `.d`
    files, every `tools/probes` dependency is in the hash, including `tydump/prefix.rs` for `thirdump` and `mirdump`. No
    probe has a local path dependency or a committed `Cargo.lock` under `tools/probes`, and the only `include!` is
    `symdump`'s generated `OUT_DIR` file, whose `build.rs` is hashed.
  - Can a mismatch fail a gate spuriously? **Only in one narrow sense:** a comment-only source change with no rebuild fails,
    although the output would match. Otherwise a mismatch is true: the shared binary is not this tree's. The hash is the same
    across worktrees (38 of 38 identical), so a merge alone with the same sources cannot trip it. The operational noise is
    what the handoff says: a lane on an older branch sees this test fail after root rebuilds a changed probe. See N2 for the
    wasted gate.

### 5. `common.test.ts`

Stronger and independent of host speed. With 24 spinners (twice the core count), head passes and **base fails**
(`Received: 26.485`). Microseconds fail (`307799`, over the 60,000 bound) and seconds fail (`0.306`). See N4 for `sysMs`.

### 6. `.env.local` warning

- With the file: no line, exit 0.
- Without it: one `WARNING:` line, exit 0.
- A failing test in a throwaway repo with the same preload: exit 1 either way.
- The junit reports with and without the file are identical apart from timings, so the gate's skip check sees no change.
- With the file, the preload registers nothing. It imports no harness code, so `deps.test.ts`'s `RUST_TS_DATA` setup is safe.

### 7. Combined roots

Confirmed, and the gate is not affected.

| command | head | base |
|---|---|---|
| `bun test ./scripts ./harness ./tools` | 218 pass, 12 fail, 17 skip | 208 pass, 12 fail, 17 skip |
| `bun test ./scripts ./harness` | 180 pass, 0 fail, 0 skip | not run |
| `bun test ./tools` | 67 pass, 0 fail, 0 skip | not run |

The 12 failure names are identical on both trees: 6 codegen golden tests and 6 probe fixture tests. `UNIT_STEPS` is
`[src, tools]` and `[scripts, harness]`, run as separate processes (`gate.ts:255`). `deps.test.ts` is only in the second, and
the `tools` tests only in the first. `bunx tsc --noEmit -p .` exits 0, once the worktree has `node_modules`.

## Also checked

- **L4 holds.** With a foreign `needs-layouts-*` directory in a private tmp, base fails that test and head passes. The new
  `dir` field goes nowhere near a cache key: the only non-test reader is `compiletest.ts:637`, and the sampled keys match.
- **L7 holds.** `gateRecordProblem` accepts the newest real gate records. 9 of 38 `gate.json` files fail it, all from
  2026-10-12 and 2026-10-13, and the three I read lack `oracleTimeouts`. `criteria.ts` reads the newest gate normally.

## Not checked

- The gate, any full suite, and the `./src` unit tests. So the gate's real `./src ./tools` step did not run with the new
  preload and `fixtures.test.ts` together. I ran `./tools` alone, and the preload under junit only in a throwaway repo.
- A real two-difftest run on `issue-miri-3680` (the lane reports one). I used fake heavy suites and lock race trials instead.
- The real rebuild of all 38 probes, and how long a cold oracle cache costs a gate (A1 measures one probe's bytes and counts
  the affected cases).
- `harness-m6c-recheck` L3, L4, L6 and L8, which the handoff says were already resolved, beyond seeing the
  `docs/handoff/harness-m6c.md` change in the diff. L5 is root's.
- The orphaned-child case in question 1, which comes from reading the code only.
- Windows.

## Scratch use

Private data roots and scratch worktrees lived in my scratchpad; I removed the worktrees. Nothing was written to the shared
`aux/ui`, oracle cache or `coverage.json`. Running the tests against the real `RUST_TS_DATA` only made the usual writes:
`needs-layouts-*` scratch directories and aux directory touches.
