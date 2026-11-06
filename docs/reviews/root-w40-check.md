verdict: APPROVE WITH NITS

Independent re-check of root's own commits, lane `root-w40-check`: `f9309c20` (`fix/harness-w41`), `8a79ff32`, and `b7635f61` then `11ded631`. Line numbers for `f9309c20` are at that commit. This file is my only change to the tree. Patches and plants ran in scratch worktrees, since removed.

**All three do what they say, and nothing here blocks.**

- **`f9309c20`:** no stub I could build hangs a real `gateRun` or stops it exiting, and no status reads anything it changed.
- **`8a79ff32`:** V1 and V2 are fixed, the checker now responds to plants, and this commit did not change which calls map.
- **`11ded631`:** `RUSTC_ICE=0` reaches both compilers, and nothing else in that env changed.

**N1 and N2 of `harness-w41` should not block** (section 1.5).

| id | severity | where | what | evidence |
|---|---|---|---|---|
| F1 | LOW | `scripts/gate.ts:363`, `scripts/lib/host-state.ts:147`, comment at `:119` | With `--allow-battery`, a move from AC to battery before `HostLog`'s first reading is silent and not in `powerLost` | Reproduced, real `gateRun` |
| F2 | nit | `scripts/lib/host-state.ts:178` | A process stuck past SIGKILL now gives one more process and descriptor per sample. It does not matter in one run; it can across several gates without a reboot | fds measured on a stub; limits read from this host; the kernel-stuck shape not reproduced |
| F3 | nit | `scripts/lib/host-state.test.ts:67` | A 200 ms start limit in a gate's unit step; one flake costs a whole gate | **Not reproduced.** Largest start 18 ms under CPU load |
| F4 | nit, docs | `scripts/lib/host-state.ts:54,80` | Both comments state more than holds on the gate's real entry; the code is right | Reproduced |
| F5 | nit, wording | `scripts/lib/host-state.ts:147`, `:151` | After unreadable readings, "power lost at T" names when it was seen, not when it happened | Reproduced; the effect is by reading |
| F6 | nit | `src/rustc_driver_impl/ice_path.oracle.test.ts:55` | "Checks the whole stamp" overstates: minutes never differ in Tokyo, and the date differs only part of the day | Reproduced |

## 1. `f9309c20`: M1, L1, N3

### 1.1 Can a sample still hang, or the gate fail to exit?

**No, in every shape I could build.** These are real `gateRun` calls on a stub suite, with a temp `RUST_TS_DATA`, and `pmset` being the real `commandOutput` on a stub script with its 5 s limit. Each is capped at 60 s; no cap was hit.

My driver ends in `await gateRun(...)` at the top level, the same form as `gate.ts:507`.

| Reader | Reads hung | `gate` line | Exit after it | `gate.json` | Stub left |
|---|---|---|---|---|---|
| Ignores SIGTERM | All | PASS at 26.4 s | 1 ms | Yes, 4 of 4 `power: null` | 0 |
| Ignores SIGTERM | After 3 good readings | PASS at 10.4 s | 1 ms | Yes, 2 of 4 null | 0 |
| Exits at once, background child holds stdout | All | PASS at 30.3 s | 1 ms | Yes, 4 of 4 null | Only the `sleep 40`s, not the gate's to kill |
| `sh` waiting, child holds stdout | After 3 good readings | PASS at 12.3 s | 2 ms | Yes, 2 of 4 null | Likewise |
| Ignores SIGTERM, poll every 300 ms | After 1 good reading | PASS at 20.6 s | 109 ms | Yes | 0 |
| Same, a lost case | After 1 good reading | FAIL, exit 1 | 6 ms | Yes, `pass: false` | **1: N1** |
| Same, no poll in flight | After 1 good reading | FAIL, exit 1 | 7 ms | Yes | 0 |

- **SIGKILLed reads clean up:** 50 of them on `exec sleep` left 0 pipes and 0 zombies.
- **The real readers** gave `AC Power` and swap in 7 ms through `sampleHost`.
- **Tests and types:** `host-state.test.ts` and `gate-power.test.ts` pass, 23 of 23. `tsc` is clean.

**Read only, not run:** `Bun.spawn` and `existsSync` are synchronous, so no JS timer can bound a stall inside them, for instance in `exec`. Every other spawn in the gate would stall the same way, so this adds no new exposure.

### 1.2 Does the kept-referenced timer behave as its comment says?

**The code is right; the reason given does not apply at today's entry (F4).** The comment says the timer may be all that keeps the loop alive during such a read.

| Probe, Bun 1.4.3 | Result |
|---|---|
| Top-level `await new Promise(() => {})` | **Blocks for good**; I killed it by pid. So on this entry Bun does not exit on an empty loop |
| Top-level await of an unref'd timer | The timer fires, and the script goes on |
| Same in `main();` with no await | **Exits 0 silently, before the timer fires** |
| `sampleHost` with a held read, no await, referenced timer | Finishes at the limit |

- **On the gate's entry the reference is not needed today.** With the timer patched to `.unref()`, the two SIGTERM-ignoring gates and the two held-stdout gates all still passed.
- **It is still worth keeping:** if the entry ever lost its `await`, an unref'd timer would turn a hung read into a silent exit 0 with no `gate.json`. Keep the code, and adjust the comment if you touch it.

**`:54`, "a read still running must not keep a finished gate alive":** this holds when the child is gone and something else holds stdout, where the gate exits at once. With a live child the process stays until the kill: with a read in flight when the entry finished at 1.0 s, it exited at 5.06 s with the stub killed. That is bounded, and better than the alternative, since it means no orphan on the passing path. The same happens with the timer unref'd, so the spawn or its read holds the loop, not the timer.

### 1.3 Can anything here change a status or verdict?

**Not directly.** `pass` at `gate.ts:447` reads no host field. All 14 start states in section 1.4 that ran gave `pass: true`, and the 15th is the refusal.

There are two indirect routes, both far-fetched:

- **A unit-test flake (F3):** `staticOk` goes false. `staticChecks` does not abort the run (`:391`), so the cost is found out only at the end, after the whole gate.
- **Hitting the per-user process limit (F2):** a failed spawn in a suite could become a status, and so a false loss.

### 1.4 Are the notes and `powerLost` right in every start state?

Real `gateRun`, fake `pmset`. The first entry is what `first` reads, the second is `HostLog`'s first. `?` is unreadable, `B` battery.

| Readings | Flag | `powerLost` | Notes | Right? |
|---|---|---|---|---|
| `B` | no | Refused, exit 1, no `gate.json` | `ERROR:` | Yes |
| `B` | yes | 0 | running on battery | Yes |
| `AC,B` | no | 1 | power lost, closing note | Yes |
| **`AC,B`** | **yes** | **0** | **None** | **No: F1** |
| `AC,?,?,B` | no | 1 | power lost, closing note | Yes |
| **`AC,?,?,B`** | **yes** | **0** | **None** | **No: F1** |
| `?,B` | no | 1 | power lost, closing note | Yes, see F5 |
| `?,?,?,B` | no | 1 | power lost, closing note | Yes, see F5 |
| `?,B` | yes | 0 | None | Accepted: the flag was given, and L1 exempts it |
| `?,AC` | no | 0 | None | Yes |
| `?,AC,B` | no | 1 | power lost, closing note | Yes |
| `B,AC,B` | yes | 1 | running on battery, power lost, closing | Yes, but "power back" is missing, as `mark` has no earlier reading |
| `B,?,B` | yes | 0 | running on battery | Yes |
| `?,B,AC,B` | no | 2 | lost, back, lost, closing | Yes |
| `AC,AC,B,AC` | no | 1 | lost, back, closing | Yes |

**F1.** `gateRun` reads `first`, then builds a `HostLog` that never sees it, so `HostLog`'s first known reading has no "before".

- **Failing scenario:** `gate.ts run --allow-battery`, the reading at `gate.ts:359` is AC, and the next known reading is battery. The run lost power, but nothing prints and `powerLost` is `[]`. The comment at `:119` says each move during the run is recorded. Only `samples` shows it.
- **How likely:** the two readings are milliseconds apart with a healthy reader, so it takes a failing reader or very bad timing, plus the flag.
- **Not a regression:** by reading, the code before this commit was silent here with or without the flag.
- **Fix, tried on a scratch copy:**

```diff
 // scripts/lib/host-state.ts
   allowBattery: boolean;
+  /** What `gateRun`'s own first reading saw; undefined if it had none. */
+  firstOnBattery?: boolean;
 }
...
     private readonly opts: HostLogOptions,
-  ) {}
+  ) {
+    this.onBattery = opts.firstOnBattery;
+  }
 // scripts/gate.ts:363
-note: (l) => console.log(l), allowBattery });
+note: (l) => console.log(l), allowBattery, firstOnBattery: first.power?.onBattery });
```

With it, both F1 rows give 1 entry and both notes, and `B,AC,B` gains its "power back". The other 12 rows are unchanged, and the 23 tests pass.

**F5.** In `?,?,?,B`, "power lost at T" is when it was first seen. The closing note says a lost case *after that* may be false, but the host may have been on battery earlier, so a case lost before T may be false too. It is report-only, and `samples` shows the nulls. A wording change would do: "on battery by T".

### 1.5 N1 and N2: should either block?

**N1, no.** Reproduced above: a SIGTERM-ignoring stub outlives `process.exit(1)` for good, if a poll is in flight at that moment. It takes a hung reader as well as a failing gate, and at most one process per reader is left per failing gate. With a healthy `pmset` the window is about 7-18 ms in every 60 s.

**N2, no, but it should go in the next harness batch.** This commit doesn't touch it, and I did not re-run it. The review's scenario needs a future edit and a `.env`. It is one unit test.

### 1.6 Does a repeatedly hung reader pile up?

**Not in a way that matters within one run. It can across several gates (F2).**

| Reader's shape | What piles up |
|---|---|
| Killable, however it ignores SIGTERM | Nothing: 0 pipes, 0 zombies after 50 |
| Child holds stdout, or stuck past SIGKILL | One process and one pipe per read. Measured on a stub: 100 reads, pipes 3 to 103, RSS 6 to 9 MB, so about 30 KB each |

**Why this is new:** before this commit a stuck read left `polling` true for good, so polls stopped at one process. Now `:178` releases it after 6 s, and each poll spawns again. That is correct, as the poll must not stay stuck, but the count no longer has a bound.

**Across 16 hours, 59 suites:**

- **Reads:** 960 polls + 121 marks = about 1,080, or 2,160 if both readers are stuck.
- **Descriptors:** no problem. Bun raises its own limit: 4,001 opens worked from a shell with a soft limit of 256.
- **Processes:** the limit here is 4,000 per user, with 288 in use when I looked, so one run does not reach it.
- **Across gates:** stuck processes outlive the gate until a reboot. With the state persisting, about 3 gates would reach the limit, or under 2 if both readers are stuck.
- **Time:** each mark waits 6 s, so about 12 minutes per gate.
- **Nothing says so:** a gate in this state prints no note. It shows only as `power: null`, so nobody would know to reboot.

**Suggested if the next harness batch has room, not required:** skip a reader whose last read has not settled, and print one `note:` when a read first hits the limit. It's a few lines, and it also removes the 12 minutes.

### 1.7 N3 and the two departures from the verdict's diff

- **N3:** right. `hash_Interned` writes `id` (`rustc_data_structures/intern.ts:96`), and `ty/fold.ts:140` keys a memo on it.
- **Optional limit parameters:** only tests pass them. `REAL_HOST` and `HostLog` use the defaults, 5 s and 6 s.
- **Required `allowBattery`:** `gate.ts` is the only non-test caller. `HostRecord` is built from a separate `allowBattery` argument to `record`, but both come from the same variable.
- **F3:** `host-state.test.ts:67` needs `/bin/sh` to write its marker within 200 ms, or `readFileSync` fails the test. `gate.ts` already records Bun's 5 s default flaking under load. Measured by me, 1,000 or more spawns at each CPU load, in 8 s:

| Spinners, 12 cores | Median | Largest |
|---|---|---|
| 0 | 2.0 ms | 11.0 ms |
| 36 | 8.0 ms | 18.2 ms |
| 120 | 6.8 ms | 17.6 ms |

The file also passed 8 of 8 idle and 10 of 10 under 36 spinners. That is a margin of about 10x on CPU alone, and I did not try I/O or memory pressure, which is what load of 100-300 here has come with. If the limits are ever raised, the bound at `:70` and the `sleep 2` in the stubs have to move with them.

## 2. `8a79ff32`: V1 and V2

### V1: fixed, and the checker now responds

At `8a79ff32` the line reads `tracked names 151, macro names 8, 23957 calls: refused as a nested item upstream: 2`, then exactly `rustc_errors/json.ts:308 write` and `rustc_mir_transform/ref_prop.ts:313 assert`. On `f9309c20` the first is `:307`, moved by a later merge.

| Plant or mutation on a scratch copy | Result |
|---|---|
| `assert(true, "plant")` in `normalize_param_env_or_error`, whose only upstream `assert` is nested | **3**, the new line listed as `traits/mod.ts:565 assert` |
| `map_call`'s refusal removed | **0**, so losing the check is visible |
| The refusal fires for every unanchored call | 9,180, including macro names: `struct_span_code_err` 134, `gate` 43, `span_mirbug` 29, `gate_alt` 1. So the macro pass does reach that branch |

- **Macro names:** there are 8. The 8th beyond the review's 7 is `generate_walk_flat_map_fns`, which comes from a real `macro_rules!` owner and is harmless.
- **The macro pass:** in my own scan it examines 325 calls and maps 210, the review's figure.
- **What remains:** a miss inside `in_nested_item` is still not detected, as the checker shares that predicate. The review says this belongs with its N1, not here.

### Which calls map: unchanged

- **By reading:** the `track_caller.ts` diff is two comment lines replaced by two.
- **By scan:** my own scan runs every owner, every tracked and macro name, in both modes, through `map_call`, at the parent `3a9d75f7` and at `8a79ff32`: **42,130 rows, byte-identical**, including each upstream location. Mapped: 8,987 of 23,630 in fn mode, 210 of 325 in macro mode.
- **Not re-run: the 118.** `locate` lives in the same file, whose code did not change, so the figure of 92 cannot have moved through this commit.

### V2: fixed

| Scenario | Result |
|---|---|
| Normal, `REQUIRE=1` | Pass |
| No `rustc` on PATH, `REQUIRE=0` | **Skip, with the reason printed** |
| No `rustc` on PATH, `REQUIRE=1` | Fail: `ERROR: pinned rustc unavailable...` |
| `RUSTC_BOOTSTRAP=-1` inherited | Pass |
| `RUSTC_LOG=debug` inherited | Pass |
| `MAKEFLAGS=-j1` inherited | Pass |
| `TZ=UTC RUSTC_ICE=0` inherited | Pass |

It uses `PIN.toolchain` and checks the commit, as its siblings do. Its filter omits `RUSTC_ICE`, which the siblings list, but `env` sets it on every call.

**Not run:** the review's empty `RUSTUP_HOME` scenario. A changed rustup home could make rustup download a toolchain, as in the disk incident recorded on 2026-11-06.

**F6.** Mutations of the port's stamp at `rustc_driver_impl/lib.ts:1132`, run at 05:58 UTC:

| Mutation | Test |
|---|---|
| `getUTCHours` to `getHours` | Fails, as it should |
| `getUTCDate` to `getDate` | Passes |
| `getUTCMinutes` to `getMinutes` | Passes |

Tokyo's offset is whole hours, so minutes can never differ. Its date differs only from 15:00 to 24:00 UTC. The hour is the real regression, and it is caught. The commit subject's "checks the whole stamp" says more than this. No change is needed, unless you want a second `TZ` with a half-hour offset.

## 3. `b7635f61` then `11ded631`: `scripts/ir-diff.ts`

**The final state is right.** There is one `env` property, and `scripts/ir-diff.ts` is the same at `11ded631` and `f9309c20`. `b7635f61` did have the duplicate: `env: undefined, ..., env: {...}`.

| Check, with a temp `RUST_TS_DATA` | Result |
|---|---|
| A real oracle ICE (`#[rustc_delayed_bug_from_inside_query]`, exit 101), `ir-diff` from before `b7635f61` | **1 `rustc-ice-*.txt` beside the file** |
| Same, final `ir-diff` | **0** |
| Same, final, with the real port as subject (exit 70, so it never reaches its own ICE) | 0 |
| Oracle side, parent env `RUSTC_ICE=/nonexistent/parent MY_KEEP_VAR=kept RUSTC_LOG=warn`, read back through `option_env!` in the kept `.ll` | `"0"`, `"kept"`, `"log-unset"` |
| Same with `--calls`, through `/usr/bin/env` | The same three |
| Subject side, a fake compiler dumping its env | `RUSTC_ICE=0 MY_KEEP_VAR=kept RUSTC_LOG=undefined` |
| `caseEnv(undefined, base)` against `caseEnv({ RUSTC_ICE: "0" }, base)` | Differ only in `RUSTC_ICE`: `null` to `"0"` |
| Suite form | Untouched: `ir-hello`'s cases already have `RUSTC_ICE=0` |
| `scripts/ir-diff.test.ts` | 13 pass, 0 fail |
| Upstream checkout afterwards | Clean |

Nothing else in that env was dropped.

## What I did not check

- The gate, any full suite, and any `difftest` sample. None of these commits changes compiler output.
- **A real hung `pmset`, a process truly stuck past SIGKILL, and a real battery.** Hangs are stubs and power is fake readers. The pile-up figures in F2 come from a stub of the same shape, and the 16-hour figures are arithmetic from them.
- A hung read through the real `gate.ts` command line. My driver calls `gateRun` in the same top-level form, because the real readers cannot be stubbed from outside.
- I/O and memory pressure on F3's limit.
- The 118, `--oracle` on the checker, and the empty `RUSTUP_HOME` scenario.
- N2's reproduction, and the nits of the earlier ICE reviews that stay open.
- Linux and Windows. `host-state.test.ts` needs `/bin/sh`, which Windows lacks; AGENTS.md leaves that host unchecked.

## Housekeeping

- **My mistake, in case it touched anyone's timings:** a stress loop from my first flake test did not stop, because `kill $pids` does not split words in zsh. **36 busy shells ran from about 07:42 to 07:47 local on 2026-11-06, with load peaking near 49**, until I killed each by pid. Short bursts of up to 120 spinners followed at about 07:48, for 8 s each. A timing from another run in that window may be affected.
- **Other processes:** a hung probe (`await new Promise(() => {})`) and my stubs were killed by pid. I used no `pkill` or `killall`, and none remains.
- **`$RUST_TS_DATA/tmp/track-caller-check/`** was overwritten by my checker runs, including mutated ones. I ran the clean checker last, so it now holds `8a79ff32`'s output: 2 refusals.
- **`.env.local`** was copied as the brief says, with `RUST_TS_REQUIRE_PROBES=1`, and is gitignored.
- **Scratch:** two temporary worktrees are removed, and `git worktree list` shows neither. Drivers and logs are in `/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-ad4e80b7/1e86c184-8cff-4bfa-af6c-224c6586da75/scratchpad/d/`.
