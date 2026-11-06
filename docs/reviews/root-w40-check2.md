verdict: APPROVE WITH NITS

Independent check of root's commit `a25cca77` on `integ-w40`, lane `root-w40-check2`. Line numbers are at that commit. This file is my only change to the tree. Mutations ran in a scratch worktree and scratch copies, since removed.

**Every fix does what it says, and nothing here blocks.**

- **F1:** all 15 rows of the start-state table are right, on real `gateRun` calls. `first` on battery without the flag still refuses before anything runs.
- **F3:** the tests still fail with the read limit or SIGKILL removed. The retry's second attempt left no stub unless SIGKILL was removed.
- **F4, F5, N4, R6, R7:** the comments and notes are true, with one case F5 leaves as it was (C3). No test or doc relies on the old closing-note text.
- **R4:** `floats` reaches the code under test, and the failure root saw is the self-check catching a real wrong skip.

| id | severity | where | what | evidence |
|---|---|---|---|---|
| C1 | nit, test gap | `scripts/gate.ts:363` | No test covers the value passed as `firstOnBattery`, so F1 could come back unnoticed | Reproduced: 24 of 24 pass with it set to `undefined` |
| C2 | nit, flake | `scripts/lib/host-state.test.ts:74` | A shell killed between creating the marker and writing it gives pid 0, and the SIGTERM test then fails | Consequence reproduced by forcing an empty marker; the race itself only read |
| C3 | nit, wording | `scripts/lib/host-state.ts:157` | `AC,?,?,B` still says "power lost at T", though T is only when it was seen | Reproduced |
| C4 | nit, no action needed | `scripts/lib/host-state.test.ts:93,96` | On the retry path, the two held-stdout tests do not reach the read limit | Reproduced; `a reader that never answers` still catches the removal |
| C5 | nit, docs | `src/rustc_trait_selection/solve/fulfill_stalled.oracle.test.ts:4` | "as docs/handoff/fixers-42.md lists" now covers `floats`, but that handoff never mentions the program | Reading and grep; the claim itself reproduced true |

## 1. F1: is every start state right?

**Yes.** These are real `gateRun` calls on a stub suite, with a temp `RUST_TS_DATA` and a fake `pmset`, built as `scripts/gate-power.test.ts` does. The first entry is what `first` reads. `?` is unreadable, `B` battery, `AC` mains.

| Readings | Flag | Exit | `powerLost` | Notes (the closing note where `powerLost` is not empty) | Right? |
|---|---|---|---|---|---|
| `B` | no | 1 | No `gate.json`, no run directory | `ERROR:` naming the flag | Yes |
| `B` | yes | 0 | 0 | running on battery | Yes |
| `AC,B` | no | 0 | 1 | lost **at** | Yes |
| **`AC,B`** | **yes** | 0 | **1** | **lost at** | **Yes, was F1** |
| `AC,?,?,B` | no | 0 | 1 | lost at | Yes, see C3 |
| **`AC,?,?,B`** | **yes** | 0 | **1** | **lost at** | **Yes, was F1; see C3** |
| `?,B` | no | 0 | 1 | lost **by** | Yes |
| `?,?,?,B` | no | 0 | 1 | lost by | Yes |
| `?,B` | yes | 0 | 0 | None | Accepted by the earlier review: the flag was given |
| `?,AC` | no | 0 | 0 | None | Yes |
| `?,AC,B` | no | 0 | 1 | lost at | Yes |
| **`B,AC,B`** | **yes** | 0 | **1** | **running on battery, power back, lost at** | **Yes, "power back" is now there** |
| `B,?,B` | yes | 0 | 0 | running on battery | Yes |
| `?,B,AC,B` | no | 0 | 2 | lost by, back, lost at | Yes |
| `AC,AC,B,AC` | no | 0 | 1 | lost at, back | Yes |

All 14 rows that ran gave `pass: true`. `tsc --noEmit -p .` is clean, and `host-state.test.ts` with `gate-power.test.ts` pass 24 of 24.

**C1.** `HostLog` is tested with `firstOnBattery` set by hand, and `gate-power.test.ts` never runs `[AC, BATT]` with the flag. With `gate.ts:363` changed to `firstOnBattery: undefined`, F1 is back and all 24 tests pass. The required field makes `tsc` catch a dropped property, but not a wrong value. One row would close it: `gate("flag-lost", [AC, BATT], true)`, expecting one `powerLost` entry.

## 2. F3: does the retry keep the tests meaningful?

**Yes.** Scratch copies of `host-state.ts` and its test:

| Variant | Failing tests | Stub left |
|---|---|---|
| Read limit removed | `child holds stdout` (2,008 ms), `background child holds stdout` (2,015 ms), `never answers` (5,000 ms) | 0 |
| SIGKILL removed | `ignores SIGTERM` (1,907 ms) | **1, by the mutation**; killed by pid |
| Slow shell: `sleep 0.5` before the marker, so the first attempt always misses | None, 20 of 20 pass, 7.9 s | **0** |
| Slow shell, read limit removed | Only `never answers` | 0 |
| Slow shell, SIGKILL removed | `ignores SIGTERM` (4,906 ms) | **1, by the mutation, from the second attempt**; killed by pid |
| `sleep 2` before the marker, so neither attempt starts | All three stub tests, with `the shell never started` | 0 |

**Can the second attempt leave a stub?** Not with SIGKILL in place. The kill timer belongs to the spawn, at the attempt's `limit`, and the read limit is twice that. Reading the code: if a stall let the read limit win, the kill would still fire, and the stub cannot outlive the check at `:88-90`. A child of a killed stub (`sleep 1`, `sleep 2`) can outlive the test by up to about 1.6 s, as it could before this commit.

**C4.** On the second attempt `sleep 2` ends by 2.5 s at the latest, inside the 3 s read limit and the 4.6 s bound at `:72`. So those two tests prove nothing about the read limit when the first attempt misses. I'd leave it. `never answers` catches the removal on every run, as the table shows, and any run whose first attempt hits catches it twice more.

**C2.** `echo $$ > marker` creates the file before it writes. If SIGKILL lands in that gap, `existsSync` at `:74` is true, `Number("")` is 0, and `process.kill(0, 0)` succeeds, so `alive()` stays true. Forced with `: > marker; sleep 5`, the SIGTERM test fails after 1.7 s with `Expected: false, Received: true`. The gap is microseconds wide, and I did not hit it by chance, but a loaded host is when a kill lands near the shell's start, and a flake costs a gate. Fix: count a marker as started only if it is not empty, so that the retry handles it.

**Read only, not reproduced:** the bound at `:72` is not retried, so a stall of over 1.6 s in the first attempt still fails the test. That is no worse than the old fixed 2,000 ms. F3 is narrowed, not closed.

## 3. F4, F5, N4, R6, R7: are the texts true?

| Item | Where | Result | How |
|---|---|---|---|
| F4 | `host-state.ts:54` | True. A live command held the exit until the kill, 2,504 ms at a 2,500 ms limit. With the command gone and stdout held, the exit came at 303 ms, when the script ended | Reproduced |
| F4 | `host-state.ts:80-81` | True. A no-await caller with the timer unref'd exits 0 at 0 ms without finishing, and with it referenced finishes at 803 ms. With a top-level await both go on, at about 800 ms. The entry at `gate.ts:515` awaits | Reproduced |
| F5 | `host-state.ts:157`, `gate.ts:450` | "by" on a first reading, "first seen at" in the closing note; see C3 | Reproduced |
| N4 | `context.ts:228-231` | True. The region, type, const and predicate sets, among others, use `intern_value`, and `clauses` and the lists use `intern_slice`; `valtree`, `pat` and `layout` use `intern_key`. Upstream's `context.rs:1906` is the first of the `InternedInSet` impls | Reading |
| R6 | `intern_key.ts:324` | True. `value_hash` from `551f8705^` on `Ref(r, t)`, 100 x 40,000: 2,338,597 values share a hash (58.5%), largest bucket **100**. No `92` is left in that file, its test or the handoff | Reproduced |
| R7 | `track_caller.ts:1004,1028` | True. `item_span` has one doc comment, and `match_close` has its own again. The diff moves one comment line and no code | Reading |

**The old closing-note text:** nothing relies on it. `gate-power.test.ts:98` matches only `this gate lost power 1 time(s)`, which did not change. Outside `docs/reviews`, "first at" and "a lost case after that" appear nowhere in this sense, and no script parses these notes. The three tests that expect "power lost at" (`gate-power.test.ts:97`, `host-state.test.ts:130,160`) all have a known earlier reading, and `:150` expects "by".

**C3.** F5 was about any note after unreadable readings, but the fix tests only for no earlier reading at all. In `AC,?,?,B` the move happened somewhere in the gap, yet the note says "at T". The closing note is right in every row. On `?,?,?,B` its "from about then on" still does not name the time before T, the point F5 made, though "by" in the note above it does. Report only, and `samples` shows the nulls. If it is touched, say "by" whenever the sample before had no reading.

## 4. R4: is the floats program a real test?

**Yes, on all counts.** Line 99 of `fulfill.ts` is the last of the five watches, so removing it shifts no other slot. To rule the list's length out as well, I also tried a mutation that keeps five slots, with a dummy watch in place of the float table.

**It reaches the code.** Counters on a scratch copy, with the watch that alone set the minimum at the start of a pass:

| Program | Oracle exit | Entries skipped | Marks on the float slot | Passes where the float watch alone cut the prefix |
|---|---|---|---|---|
| `floats` | 0 | 3,445 | 72 | **6** |
| `ints` | 1 | 3,445 | 0 | 0 |
| `consts` | 1 | 33 | 0 | 0 |
| `tait` | 0 | 7,673 | 0 | 0 |

**It catches a wrong skip, not something incidental.** Each program ran alone, on the driver:

| Mutation | `floats` | `ints` | `consts` | `tait` |
|---|---|---|---|---|
| Clean | clean | clean | clean | clean |
| Line 99 removed | **panic** | clean | clean | clean |
| Dummy for the float table, five slots kept | **panic** | clean | clean | clean |
| Float vars marked in the int slot | **panic** | clean | clean | clean |
| Float vars not marked | **panic** | clean | clean | clean |
| Dummy for the int table | clean | **panic** | clean | clean |
| Dummy for the const table | clean | clean | **panic** | clean |
| Dummy for the sub table | clean | clean | clean | **panic** |

"Clean" means no panic and stderr byte-identical to the oracle's.

- **The panic is the self-check:** `StalledPrefix: entry 30 of a prefix of 32 in a list of 32 is not stalled`, the same with line 99 removed and with the dummy.
- **It is the right entry:** entry 30's `stalled_vars` is `[["TyFloat", 15]]`. `a15` is the first variable the reversed block assigns, so it is the first to change.
- **The skip does real harm:** with line 99 removed and the panic turned off, 200 wrong skips are counted, and `floats.rs` reports a false `error[E0283]: ... cannot satisfy f64: Tr` and exit 1, where the oracle exits 0 with no output.
- **The real test:** passes clean, and fails with line 99 removed at the stderr comparison, on that panic.
- **The prelude change:** the new `f32` and `f64` impls took nothing from the others. The last three rows show each table is still caught by its own program alone.

So the header's claim that each program stops a bug the others miss is true of all four.

**C5.** The header's pointer for that claim does not hold for `floats`: `docs/handoff/fixers-42.md` has no mention of the program or of the float table being unwatched. This review's table can serve instead.

## What I did not check

- The gate, any full suite, and any `difftest` sample. Only comments, tests and `scripts/` changed, and `fulfill.ts` itself is untouched by this commit.
- A real hung `pmset`, a real battery, or the real `gate.ts` command line in these states. Power is fake readers, and hangs are stubs.
- I/O or memory pressure on F3's limits. A slow shell is simulated with `sleep`, not produced by load.
- Rates. Each test variant ran once, as asked: no stress loop, so this says nothing about how often C2 or the `:72` stall would occur.
- The old solver and `-Zdisable-fast-paths` under `StalledPrefix`, which the review of fixers-42 already noted the test does not cover.
- Linux and Windows.

## Housekeeping

- **Other processes:** the two SIGKILL mutations left stubs 5514 and 5945, killed by pid. I used no `pkill` or `killall`, and a final `ps` shows nothing of mine.
- **`.env.local`** was copied as the brief says, with `RUST_TS_REQUIRE_PROBES=1`, and is gitignored.
- **`$RUST_TS_DATA`:** the F1 runs used a temp data directory, not the shared one, and I wrote nothing to the shared one.
- **Scratch:** the worktree is removed; `git worktree list` no longer shows it. Drivers and outputs remain in `/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-3026f8ca/97f7b620-28b5-405c-8c64-6e04426b2b24/scratchpad/`.
- **Branch:** this worktree's branch was not on the commit, so I made `root-w40-check2` from `a25cca77`.
