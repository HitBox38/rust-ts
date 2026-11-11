REQUEST CHANGES

# Re-check: harness batch bun-144, review round 1 fixes

Independent re-check, 2026-11-11. Branch `t3/validate-bun-144-gate`, reviewed as `git diff 2e1ba8af..354cd63a`: commits
`2153553f` (F1, N1–N3, with tests) and `354cd63a` (handoff §9). The first review was `docs/reviews/bun-144.md` (branch
`t3/review-bun-144-gate`, `0ee916ac`). I tested with the tree checked out at `354cd63a` and wrote this file on
`t3/review-bun-144-recheck`.

**Conditions.**
- AC power (`pmset -g batt`), 1-minute load 1.3–5, no gate running.
- `.env.local` copied from `integ-w39`, with `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0` and
  `RUST_TS_AGENT=review-bun-144-recheck`.
- Every run used `~/.bun/bin/bun` 1.4.4 (`38afee6c8`, sha1 `7c1f29cd4051…`). I never swapped that file. The swaps below
  happened on symlinks and on an APFS clone in my scratch directory.
- I built no subject binary. Mutants were made in the worktree and reverted with `git checkout -- scripts/`. `git status` is
  clean apart from this file.

**The verdict in brief.** The fix catches what the first review asked about: a Bun change that is still in place at the next
check. Its start, per-suite, end and `accept` checks are correct and tested. But the check is a reading taken at suite
boundaries, so a swap that is undone before the next reading slips through to an accepted run. I reproduced this (F1-r below).
The brief asks for a block only in that case, so the verdict is REQUEST CHANGES. The fix I suggest (an APFS clone, then
re-exec) is about 20 lines and removes this class of bug outright.

## What I reproduced

| check | result |
|---|---|
| `bun test ./scripts/gate-bun.test.ts` | 15 pass, 0 fail (2.8 s) |
| Runner unit step, run as the gate runs it (`unitStaticSteps(UNIT_STEPS["runner unit tests"])` + `runStaticStep`, scratch driver) | pass: **461 tests, 0 failures, 0 skips**, 70 s; skips 0 allowlisted, 0 not allowed |
| `bunx tsc --noEmit -p .` | exit 0, clean |
| The lane's swap tests: swap between suites, swap during the last suite, a fake Bun from the start | all pass, with the asserted `ERROR:` text, `notRun`, `bunExec.end` = 1.4.5, and 0 host reads / no run dir on the start refusal |
| `readBunExe` cost on the real 88 MB file, 5 reads | 34–43 ms each (sha1 plus a `--revision` spawn). With about 50 suites, that is about 2 s per gate. Cheap. |
| `accept` of a **real** gate.json from before `bun`/`bunExec` (`gate-20261111-034856-root-qgwe`, copied into a temp `RUST_TS_DATA`) | two `note:` lines (no `bun`, no `bunExec`), then it goes on to the next check: `ERROR: … tested 103b447a5a but HEAD is 354cd63a5c`. So an old run is not blocked, and the next real gate, which writes `bunExec` with start equal to end, is acceptable (the `exe-steady` + `exe-same` tests). |

### Mutation checks (two of the lane's, two of mine)

| mutant | result |
|---|---|
| lane: no check at the end (`bunOk = bunExec.changed === undefined`) | killed: 1 test ("swapped during the last suite") |
| lane: change judged by version, not content (`bunExeChange`: `if (now.version !== null && now.version === start.version) return undefined`) | **survives: 15/15 pass** (see N1) |
| mine: `acceptBunExeRefusal` compares `start.sha1` to itself | killed: 2 tests |
| mine: start check ignores the revision (`exe.revision !== null` alone) | killed: 1 test |

The handoff says the version mutant failed 3 tests. The lane's mutant was probably written differently. The form above is the
natural one, and it passes because no test has two readings with the same version and different content.

## Findings

**F1-r. A swap that is undone before the next reading slips through to an accepted run (must fix).**

Where: the file is read only at `scripts/gate.ts:697`, before each suite, and at `scripts/gate.ts:756`, at the end. Static
steps, `prepareSubject` (`:658`) and each suite run between two readings. `bunExeChange` (`scripts/lib/bun-pin.ts:100`)
compares content only, so an A→B→A sequence within one window looks like no change.

Evidence. I ran the lane's own `gateSwap` harness from a scratch copy of `scripts/gate-bun.test.ts`, changing only the stub
subject of `swap-a`. It does three things:
1. renames the symlink to the fake 1.4.5 into place;
2. runs `<exe> --revision`, standing in for a child the gate starts in that window;
3. renames a fresh symlink to the running Bun back into place.

Output:

```
during-window child ran: 1.4.5+0123abcde
exit 0 pass true errors [] changed undefined start=end true accept refusal: undefined
```

So the child ran another build, gate.json says `pass: true` with `bunExec.start.sha1 === bunExec.end.sha1`, and
`acceptBunExeRefusal` has nothing to refuse.

Why it matters here:
- **Oracle cache.** `oracleVersion` hashes the file once per suite (`scripts/difftest.ts:277-288`). Bun-run oracle output
  written in the window is stored under the pinned build's key and outlives the run.
- **Subject binaries: one swapped spawn affects every case of the gate.** `prepareSubject` runs the builder CLI through
  `process.execPath` (`scripts/lib/subject-bin.ts:661`). The child keys and builds with *its own* `Bun.version`/`Bun.revision`
  (`:575`), so a 1.4.3 swap during those few seconds yields a 1.4.3-runtime binary. 1.4.3 is still in `VALIDATED_BUN`, so the
  build is allowed. Every binary-mode case of the gate then runs that binary. gate.json `subject` records only the entry→hash
  map (`subjectRecord`, `:698-700`), and nothing compares the binary's `meta.bun` with the gate's Bun.
- **The scenario is plausible on this host.** Several lanes share `~/.bun/bin/bun`. The next Bun validation's own procedure
  (`scripts/lib/bun-pin.ts` header: "then run the runner unit tests on it") invites a temporary install and restore. And the
  2026-11-11 change itself was never attributed.

Why I don't suggest a ctime/inode check instead: it would catch A→B→A (APFS bumps ctime on rename-restore and on an in-place
copy; I checked both on a scratch clone). But metadata also moves without a build change. `~/.bun/bin/bun` has ctime
**2026-11-11 13:22:45**, after the 11:59 swap, while its mtime and birth are still Oct 22. A ctime failure could therefore end
a ~10 h gate for nothing.

Suggested fix: make the file the children run private to the run, so that nothing outside the gate can change it.
1. After the `GATE_BUN` check, clone `process.execPath` with APFS `clonefile`. `cp -c` costs no disk, since the blocks are
   shared copy-on-write, so a later in-place write or rename of the original leaves the clone alone. Put the clone at, for
   example, `$RUST_TS_DATA/gate-bun/<sha1>/bun`.
2. Check the clone's sha1 and `--revision`, as `execBunRefusal` does now.
3. Re-exec the gate with the same argv from the clone, with a marker env var so it happens once.
4. Then `process.execPath` is the clone in the gate and in every child: static steps, `bun test --parallel` workers, oracle
   runners, source subjects, the builder. Oracle keys stay the same, because `oracleVersion` hashes content.
5. Keep the existing readings, pointed at the clone, as a cheap guard. A change of the original `~/.bun/bin/bun` mid-gate
   becomes harmless; a `note:` is enough.

I checked on this host that a clone runs, and that `process.execPath` reports the resolved file even when Bun is started
through a symlink. The scratch test above is the regression test: with the fix, the in-window child (started as
`process.execPath`) prints the gate's build.

If the lane prefers a smaller change, the minimum that closes the subject-binary path is this: have the builder CLI's JSON
carry `meta.bun`, and make `prepareSubject`/`gateRun` require it to equal the gate's Bun (one `ERROR:` line otherwise). The
oracle-cache window would still stay open, so I recommend the clone.

## Nits and advice

**N1. Nothing tests "a change is by content".** `scripts/gate-bun.test.ts:222-225` checks a same reading, a fake with another
version, and a missing file. No case has the same version and revision but a different sha1, so the version mutant above
survives. Add `expect(bunExeChange(me, { ...me, sha1: "0".repeat(40) }, "x")).toBeDefined()`. The code is right; only the
test is missing.

**N2. `bunx tsc` is a child that does not run `process.execPath`.** `scripts/gate.ts:569` resolves `bunx` through `PATH`,
here `~/.bun/bin/bunx` → `~/.bun/bin/bun`. So the header claim that every child runs `process.execPath`
(`scripts/lib/bun-pin.ts`, `scripts/gate.ts:34`) is not quite true. The impact is low: `tsc` comes from `node_modules`
(TypeScript 7), its result does not depend on Bun, and nothing it produces is cached. `[process.execPath, "x", "tsc", …]`
would make the claim true, and it matters if F1-r is fixed by the clone.

**N3. Symlinks: fine.** `process.execPath` is the resolved file. With a symlinked Bun, I got the target path, not the link. So
repointing a symlinked `~/.bun/bin/bun` changes nothing for `process.execPath` children; only `PATH` users (N2) follow it.
On this host `~/.bun/bin/bun` is a regular file anyway.

**N4. A file that is being written: safe.** `readBunExe` wraps both the read and the spawn in `try`. A partly written file
reads as another sha1, or fails `--revision`, which counts as a change. A missing file gives `sha1: null`, which also counts
as a change (`bunExeChange` requires a non-null equal sha1). So all three fail safe, and none of them throws.

**N5. The cache warning: refusing `accept` is right; the purge could be actionable.** After a detected change, the `ERROR:`
text says the last suite's entries "may be keyed to the old build", but root cannot tell which ones they are. Two options:
- record, in `bunExec`, the suite and the time of the last good reading, so root can remove that suite's entries born after
  it (the keys come from `scripts/oracle-keys.ts --suite <s>`; the birth time from `stat`);
- or let the gate print that one command.

With the clone fix this becomes moot. I would not block on it.

**N6. A wording nit.** The label "before suite X (during the static steps)" (`scripts/gate.ts:697`) also covers
`prepareSubject` and `verifyOraclePin`, so "since the start" would be more accurate.

## N4 of round 1: spot-check of the samples on 1.4.4

Run IDs are UTC (12:43 UTC = 14:43 IST).

| suite | run dir | rows | statuses | protected (baseline at `354cd63a`) | protected without MATCH |
|---|---|---|---|---|---|
| rmeta-core, in full | `20261111-125508-bun-144-n4-2ifj` | 82,338 | 82,338 MATCH | 82,338 | 0 |
| check-rg (whole suite) | `20261111-124917-bun-144-n4-kkpl` | 36 | 36 MATCH | 36 | 0 |

The summaries record `subject.mode: binary`. The other 12 run dirs' summaries agree with the handoff's table: every row is
all MATCH, with 0 DIFF/UNPORTED/CRASH/TIMEOUT.

**Were the oracle entries written on 1.4.4? Yes.** I did not reuse the lane's key dump. I computed the keys myself with
`bun scripts/oracle-keys.ts --suite <s>` on 1.4.4 at `354cd63a`, then looked up each entry in `$RUST_TS_DATA/oracle-cache`.
Every entry exists, and each was born inside its own N4 run's window:

| suite | key | born (IST) | run started (IST) |
|---|---|---|---|
| rmeta-alloc | `5bd607e31908…` | 14:43:30 | 14:43:28 |
| rmeta-core | `b30b51340b1b…` | 14:43:56 | 14:43:49 |
| rmeta-std | `f7d6c21de2dd…` | 14:46:28 | 14:46:26 |
| check-alloc | `3f3c6c911504…` | 14:46:55 | 14:46:54 |
| check-core | `9fde9a13c245…` | 14:47:18 | 14:47:13 |
| check-std | `0839b2a182b6…` | 14:48:56 | 14:48:55 |
| check-rg | `c844db3112f9…` | 14:49:22 | 14:49:17 |
| check-rg-encode-mir | `5129e64cc897…` | 14:50:28 | 14:50:23 |
| check-rg-host | `065157d1f9f2…` | 14:51:58 | 14:51:54 |

So these were fresh oracle runs under the 1.4.4 keys, not cache hits. They come about 2¾ h after `~/.bun/bin` last changed
(11:59). The full rmeta-core comparison reused the 14:43:56 entry, which is also 1.4.4.

## What the lane should do

1. **F1-r:** run the children from a private clone of the gate's Bun, and re-exec the gate from it. At minimum, check each
   subject binary's builder Bun against the gate's. Add the A→B→A swap test.
2. N1: add the same-version, different-content assertion.
3. Optionally N2 (`bun x tsc`), N5 and N6.

Everything else in round 1 holds: N1 (the Bun refusal comes first, now tested), N2 (`bun` and `bunExec` in the static-stop
gate.json, asserted) and N3 (the procedure order, stated in `scripts/lib/bun-pin.ts`).
