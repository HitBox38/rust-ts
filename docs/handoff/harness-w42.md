# Lane `harness-w42`: queued harness findings

Branch `t3/fix-harness-review-findings`, from `9e11cc8b`. This is a batch of changes to `scripts/` and `harness/`, so it needs its own review (AGENTS.md section 2). I did not run the gate.

**Everything assigned is fixed. Nothing was left because of its size.** `ir-hello`'s oracle key changed, and it has no baseline. No baseline, suite definition other than `ir-hello`'s, or protected result changed.

## What changed

| Finding | Fix | Where |
|---|---|---|
| root-w40-check F2 | A reader with a read unsettled past its limit is not started again until that read settles, and one `note:` says the reader is stuck. Report only | `StuckReads`, `sampleHost`, `gateRun` |
| root-w40-check2 C3 | "by", not "at", when the sample before had no reading | `HostLog.follow` |
| root-w40-check2 C5 | The header points to `docs/reviews/root-w40-check2.md` section 4, as `fixers-42` never mentions `floats` | `fulfill_stalled.oracle.test.ts:4` |
| w40a-audit N4 | The comment says a spell between two readings, up to `pollMs`, shows nowhere. Polling is not faster | `HostRecord.samples` |
| harness-w41 N1 | A `process.exit` during a read kills the command. Three lines, so fixed rather than noted | `commandOutput` |
| harness-w41 N2 | A test of plain `miri.ts` from a cwd whose `.env` sets `RUST_TS_HOST_TUPLE=bogus-host` | `scripts/miri.test.ts` |
| harness-m7a H3 | See below | `irSuite`, `irReportSuite`, `irTierError` |
| harness-m7a H5 | Both sides compile at `<out>/work`, one at a time under `withCaseLock`, as `check-rg` does | `scripts/ir-run.ts` |
| harness-m7a N2 | "a probe is missing or stale", where it said "missing probes" | `gateRun` |
| Stale comments | Both were still stale, and both are corrected | `track_caller_check.ts:10`, `miri_stack_first.ts:4` |

**One step past the finding:** C3 asks for "power lost by". I also made it "power back by" in the same state, since it is the same false claim on the same variable.

### F2: how far it goes

- **Only past the limit, not single flight.** A mark can overlap a healthy poll and must still get its own reading. A test holds this.
- **The bound.** A stuck reader leaves one process per gate if the first reading sticks. It leaves at most two if it sticks mid-run, when a poll and a mark overlap. By reasoning, not measured: the earlier growth of one process per sample is gone, and marks no longer wait out the limit, which removes the review's 12 minutes.
- **The note fires only past the 6 s read limit.** A reader that SIGKILL does end settles at 5 s, so it is not called stuck.

### H3: what holds the tier now

- **Every IR suite names its tier.** `irSuite` requires it and passes `--tier` on both sides. A test checks that each suite running `ir-run.ts` has `irTier`, `irArgs` and that tier on both commands.
- **Anything but N1 needs a decision.** The gate's unit step fails unless `docs/state/history.jsonl` has a `decision` starting `IR tier: <suite> at <tier>:`. `irTierError` is that rule, and its message gives the command to record one.
- **It is recorded.** In the oracle key, `<suite>.summary.json`, `gate.json`, a `note:` in the gate's output, difftest's output, and the accept record (`acceptEntry`).
- **The report form.** `bun scripts/difftest.ts --suite <s> --ir-tier <t>` runs the suite as `<s>@<t>`, with its own oracle entries and result files. That name is never registered, so `gate.ts` refuses it for a run and for an accept, and it can have no baseline. This is what F1's "the lost tier stays as a report" and M7b's three tiers use.

**Left from H3's list of gaps:** `criteria.ts` still has no M7 group. The review lists that as a gap but does not ask for it here.

## Oracle keys

| What | Result |
|---|---|
| `ir-hello`'s `oracleKey()` | `a7e1e141...` to `3fdbf326...`, so both its cases re-run the oracle. Expected: `ir-run.ts` and `ir-normal.ts` are hashed, and the tier joined the key |
| `ir-hello`'s oracle output, base against head, both cases, real runs | Stdout, stderr and exit identical by hash |
| The other 66 suites, base against head at one path | Identical: case ids, args and env, `oracleKey()`, and the oracle and subject commands of the first case. Full cache keys were compared on about every 50th case |

## Each fix's test fails without it

Mutations ran in a scratch worktree at `e671b0a8`, each with only the named test files. Afterwards I changed one test's limit and added a comment.

| Mutation | Failing test |
|---|---|
| F2: guard removed | Whole gate; "not started again"; real command |
| F2: gate's first read unguarded | Whole gate |
| F2: log's marks unguarded | Whole gate |
| F2: never released, or released only on success | "not started again" and "a stuck read that ends in a failure" |
| F2: a note every time | "not started again" |
| F2: single flight, not past the limit | "reads within the limit" and two others |
| N1: no kill at exit | "a process.exit during a read" |
| C3: only a first reading says "by"; flag never reset | "after a failed reading" |
| N2: `miri_stack_first.ts` import removed | "plain miri.ts settles the environment" |
| H3: rule always passes | "F1's tier rule" |
| H3: `ir-hello` at N3 with no decision | `checkProbes` test (`irTierErrors`), difftest CLI test |
| H3: `--tier` dropped, or `--tier N3` by hand | `checkProbes` test |
| H3: tier not in the key | `checkProbes` test (`keys`) |
| H3: report suite registered | `checkProbes` test |
| H3: tier not in `gate.json`, or not in the summary | "an IR suite's tier" |
| H3: tier not in the accept record | `checkProbes` test (`acceptIr`) |
| H3: `--ir-tier` ignored by difftest | difftest CLI test |
| H5: side and pid back in the path | "both sides compile at one path" |
| H5: no lock | "two runs of one case" |
| H5: the lock's note left on stderr | "two runs of one case" |
| N2 (m7a): old message | "a stale probe stops the gate" |

**One mutation survived at first.** "H5: no lock" passed the test as I first wrote it, because two runs started together finished together. The fake compiler now takes an exclusive file, so an overlap fails. That mutation then failed the test on 3 of 3 runs.

**Comment changes have no test:** C5, N4 and the two stale comments.

**The real split-debuginfo case**, oracle against itself through `ir-run.ts` on one `--out`, `x86_64-unknown-linux-gnu -Cdebuginfo=2`:

| `-Csplit-debuginfo` | Base | Head |
|---|---|---|
| `unpacked` | Differs: `.../oracle-23886/hi...dwo` | Same: `.../work/hi...dwo` |
| `packed` | Differs | Same |

**N2's reproduction**, on a scratch copy with the import removed: `could not find specification for target "bogus-host"`, where head gives the program's own parse error. I used a parse error instead of the review's hello, as it needs no sysroot and reaches the host's target spec in about 1.3 s.

## Checks

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | Clean |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./scripts ./harness` | 373 pass, 0 fail |
| `fulfill_stalled.oracle.test.ts` | 1 pass |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24848; vendor 5086; library 602)`. No ported fn changed, so `--missing` has nothing to report |
| `difftest --suite ir-hello` | 2 UNPORTED, as before: the port stops at `codegen_crate`. `--ir-tier N3`: the same, as `ir-hello@N3` |
| **Unit budget**, the 5 affected files, 3 runs each, load about 5 | Base 5.5 s wall, 6.3 s CPU. Head 8.4 s wall, 9.9 s CPU. **Added: about 2.9 s wall, 3.7 s CPU**, under the 5 s limit |

**`unported(...)` added:** none. **`// PORT:` decisions:** none.

## Things root should know

- **A wait for the IR lock counts against difftest's timeout.** The wait is inside the `ir-run` process difftest is timing, so two difftests on one case at once could produce a false TIMEOUT on a slow case. It is harmless at `ir-hello`'s size. The gate alone is one difftest. Worth another look when `ir-run-pass` arrives with parallel lanes.
- **The fixed path relies on SIGTERM being passed on.** `ir-run` forwards it to the compiler. If `ir-run` itself were SIGKILLed, its compiler could still be writing to `work` when the next run takes the stale lock. By reading; not reproduced.
- **AGENTS.md section 2** still says `host` "records the power source through the run". N4's limit is now in the comment only, as that file is not mine.
- **N1 covers `process.exit`.** A gate that is itself SIGKILLed still orphans a read in flight.

## What I did not check

- The gate, any full suite, a real accept, a real battery. `acceptEntry` is tested alone, and `gateAccept` itself was not run.
- A process truly stuck past SIGKILL. F2's tests use a fake reader and a stub whose kill limit is past the test, killed by pid.
- Flake rates under load. I bounded the new tests' limits by reading (a slow host makes them pass or wait, not fail), and ran them only at load 4-8, with no stress loop.
- Linux and Windows.

## Housekeeping

- **A mistake of mine, with no effect:** a cleanup command contained `rm -rf "$RUST_TS_DATA"`, which should never have been there. The variable was unset in that shell, so it did nothing. Had it been set, it would have deleted the shared data root. I checked afterwards: `oracle-cache`, `rust` (clean, at the pin) and `runs` are all there. **No other lane's data was touched.**
- **A slip of the tree, also harmless:** the worktree's branch had been renamed to `t3/fix-harness-review-findings`, so my return from a detached checkout failed once. Nothing was lost, and the commit stayed on the branch.
- **Other processes:** no stub of mine remains, by `ps`. I used no `pkill` or `killall`.
- **`$RUST_TS_DATA`:** the oracle cache gained `ir-hello`'s entries for the new key and for `@N3`. I removed my run directories and `ir/ir-hello@N3` by exact path. Everything else used temp data directories.
- **Scratch:** the scratch worktree is removed. `.env.local` is copied with `RUST_TS_REQUIRE_PROBES=1`, and is gitignored. `node_modules` is a symlink to the main checkout's, also ignored.
