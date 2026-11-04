# Re-check: root's fixes to harness-m6c (R1, R2, N2, N3)

Reviewer: independent, read-only on code. Commit `babf8030` on `fix/harness-m6c`, on top of `48448a94`. The findings it
answers are in `docs/reviews/harness-m6c.md` (`c2d25777`). Context: docs/plan-m6.md §4, D11, A5, A9, A12.

## Verdict: APPROVE WITH NITS

R1, R2, N2 and N3 are fixed. The case lists moved exactly as decided, the tests now catch what they claim to, and the merge
with `integ-w38` is clean apart from the known import line. Merge it.

Do two things **before M6b is read**, not before the merge: L1 (the tool can print `met` from a failed gate or a mixed run
directory) and L2 (a root decision on whether `run-fail-miri` is summed or has its own 90%). The rest can go in the next
harness batch.

## Findings

Fixture counts below are invented inputs to `scripts/criteria.ts`, not results. Severity is low throughout because the tool
is report only and today's numbers do not depend on any of these.

### L1. Low, fix before M6b is read: `met` carries no provenance

`scripts/criteria.ts:71`, `:75`; `scripts/difftest.ts:918`.

The tool reads summaries from a directory and looks at nothing else. A summary has no commit, and `gate.json` is not read.

- **Filling a gap by hand.** `difftest --suite run-pass-miri-heavy --run-id gate-20261102-174727-root-kxpt` is accepted, since
  `--run-id` only does `ensureDir`. It is the obvious way to supply the suite `da6dd0bf` says is missing. With the real
  wave 37 summaries plus a heavy summary, the fixture prints `MATCH 3708/3772 = 98.3% vs >= 90%: met`, exit 0, for suites two
  days and many commits apart.
- **A failed gate.** With `gate.json` saying `"pass":false,"dirty":["x"]`, the fixture prints `MATCH 307/360 = 85.28% vs >=
  80%: met`.
- **A changed upstream checkout.** Summaries with `upstreamDirty` and `upstreamChanges` print `met`.
- **A gate killed after the group's suites finished.** No `gate.json` exists, and `met` prints all the same.

Fix: read `gate.json` when present. Print its `head`, `pass` and `dirty`; print `no gate.json` otherwise; and make `met`
require a passing gate on a clean tree, or print `met (not a gate)`. About five lines.

### L2. Low, root decision before M6b is read: A12 lets `run-pass` hide `run-fail`

`scripts/criteria.ts:19`; `docs/plan-m6.md:352` (A9), `:360` (A12), `:186`.

Summing `run-pass-miri` with its heavy sibling is right: they are one corpus split in two. `run-fail-miri` is a different
class of test and is only 7.8% of the group. Fixture: run-pass 3408/3470, heavy 8/8, **run-fail 0/294** prints
`MATCH 3416/3772 = 90.56% vs >= 90%: met`.

The plan does not settle this. A9 says the figures are "over each suite's cases", the table says run-fail is "gate M6b (same
rule)", and §4's line reads as one sum. A12 says "one figure per group" without saying that it amends A9. Today it changes
nothing, since run-fail is at 99.3%.

Recommended: give `run-fail-miri` its own 90% group, one line in `GROUPS`, which matches A9 and the table. If root prefers
the sum, A12 should say that it amends A9.

### L3. Low: N3's comment overstates what the list covers

`harness/suites.ts:1594`, `:1977`, `:1981`.

The comment is true at the pin but wider than the code. Only `miri-pass` reads `MIRI_PASS_UNSTABLE`. `miri-pass-heavy`,
`miri-pass-tb` and `miri-fail` have no `unstable`, and they hold 9 of the 27 isolation-off cases. Details in check 4.

Failing scenario: after a pin move, `shims/fs.rs` (heavy, isolation off) prints a real pid. Following the comment, someone adds
it to `MIRI_PASS_UNSTABLE`. That has no effect on the heavy suite: the entry is cached, then DIFFs. `miri-pass` only prints
`note: ... lists 1 unstable case(s) that are not cases of it`. Heavy is part of the M6b figure.

Fix: add `unstable: () => MIRI_PASS_UNSTABLE` to the heavy suite, or say that the list covers `miri-pass` only.

### L4. Low: the `run-pass-miri` text is the one that caused the wave 37 error

`harness/suites.ts:1736`. Details in check 5.

### L5. Low, for root's attention at accept time: `float.rs` sits on the 60 s limit

`harness/suites.ts:1936` (the rule). This is a consequence of R2, not a defect in it.

| case | subject alone, user CPU | wall (load about 40) | `difftest --filter` on head |
|---|---|---|---|
| `tests/pass/float.rs` | 60.4 s | 220.9 s | TIMEOUT |
| `tests/pass/panic/nested_panic_caught.rs` | 67.9 s | 233.6 s | TIMEOUT |
| `tests/pass/shims/time-with-isolation.rs` | 38.9 s | 67.5 s | MATCH |

All three finish with exit 0 when uncapped. So R2 costs about 2 of 360 (0.56 points) until `miri-perf` lands, which is the
intended result. The `difftest` TIMEOUTs ran under load, so they are not a quiet-host measurement; the CPU figures are the
useful ones.

Failing scenario: on a quiet host `float.rs` finishes in 59 s, MATCHes, and the gate protects it. The next gate takes 61 s, times
out in the pool and in its serial re-run, and the revision is refused for a protected loss that is really noise. Accept
it only after `miri-perf` has moved it clear of the limit, or expect this.

### L6. Low: the ORACLE_TIMEOUT count is not printed

`scripts/criteria.ts:78`. Fixture: 235 of 360 out of the denominator prints `MATCH 100/125 = 80% vs >= 80%: met`. Excluding them is
A9's rule. But `difftest`'s own line prints `ORACLE_TIMEOUT excluded: n` and this one drops it, so the only clue is an unusually
small denominator. Print the count.

### L7. Nit: a truncated summary gives a stack trace

`scripts/criteria.ts:65`. It exits 1 and never prints `met`, so it is safe, but it has no `ERROR:` line (AGENTS.md section 4). A
summary missing a field prints `MATCH 20/NaN = 0%`, also `not met`.

### L8. Nit: two documents read out of step

- `docs/handoff/harness-m6c.md:51`, `:110`, `:121` still describe 350 + 10 and the old table. It is a record of the lane, but nothing
  there points at A12. Add one line at the top.
- `docs/next.md:423` on main cites "plan-m6 A12". A12 and `scripts/criteria.ts` exist only on `fix/harness-m6c` until it merges
  (no hits on `da6dd0bf`). This resolves itself on merge.

### Information

- **False green without `.env.local`.** `harness/miri-ui.test.ts:11` strips `RUST_TS_DATA` from the child's environment. In a
  checkout with no `.env.local`, the real-suite tests skip and the run exits 0: my first run gave `14 pass, 7 skip`. This predates
  this commit, and the gate's skip allowlist catches it on the root host. Any reviewer in a fresh worktree can be misled by it.
- **`scripts/miri.test.ts`.** "Miri oracle, suites and argv (child process)" failed at its 5 s limit at load 60+ on both head and the
  merge. Rerun with `--timeout 300000`: 11 pass on both. Not a finding.
- **N1 and N4 are still open**, as the brief says. N1 is unchanged: `MIRI_TEMP` is fixed per case across processes.

## The seven checks

### 1. `scripts/criteria.ts`: correct, with L1, L2, L6, L7

On the real gate:

```
plan-m6 M6b run-pass: MATCH 3700/3764 = 98.3% vs >= 90%: not met (run-pass-miri-heavy: not in this run)
plan-m6 M6b miri-pass: MATCH 0/0 = 0% vs >= 80%: not met (miri-pass: not in this run; miri-pass-heavy: not in this run)
```

Exit 1. That is the right answer, and the counts agree with each suite's `.jsonl`, counted separately: run-pass-miri 3470 unique ids,
3408 MATCH; run-fail-miri 294, 292 MATCH. `gate.json` lists 49 suites without the heavy one, and `notRun` is empty, so it was not named
rather than skipped.

| way to get a false `met` | result |
|---|---|
| suite stopped midway | safe: the summary is written only at the end (`scripts/difftest.ts:1088`), so `not in this run` |
| truncated summary | safe: throws, exit 1 (L7) |
| gate with `--skip-heavy` | safe: `gate.ts:327` never runs them, and the run id is new, so `not in this run` |
| `--sample` / `--filter` | safe: `not a full run`, also for `--sample 0` and `--filter ""`; confirmed on real summaries as well. `difftest` has no other selector |
| split suite, `total` differs from cases | not reachable: all five suites are `mode: single` in the dump. A split suite in a future group would count sections |
| UNSTABLE | right: stays in the denominator; 288/360 is met, 287/360 is not |
| `--impl stub` / `shim` | ignored by the tool but harmless: `src/miri` never reads `RUST_TS_IMPL`, and a real `--impl stub` run still MATCHes |
| empty suite | harmless: the heavy lists partition one corpus, so an emptied heavy suite moves its cases rather than losing them |
| stale, mixed or failed run | **prints `met`: L1** |
| run-fail swamped | **prints `met`: L2** |

**Suites and targets:** they match `docs/plan-m6.md:197`, A5 (Tree Borrows out) and A9, apart from L2.

**Exclusions:** only ORACLE_TIMEOUT leaves the denominator here, as A9 says. Upstream of the tool, the suite definitions drop
`mpsc_stress.rs` (`MIRI_ORACLE_NO_FINISH`, killed after 3,000 s), which is an oracle timeout in effect, and the 132 A5 cases.
Both are consistent with the plan.

**Report only:** acceptable for M6b. A9 makes the figures completion criteria, separate from the ratchet, and the gate should stay about
protected cases. One thing to expect: a default gate leaves the group `not met`, because `protectedSuites` comes from the baselines and
`miri-pass`, `miri-pass-heavy` and `run-pass-miri-heavy` have none. Root has to name them with `--suites`.

### 2. The R2 move: confirmed

Dumped all suites on `48448a94` and `babf8030`: 58 suites and 364,386 cases on both.

```
miri-pass        350 -> 353   skips 154 -> 151   limit 60,000 ms
miri-pass-heavy   10 ->   7                      limit 1,800,000 ms
```

The per-case diff has exactly nine lines: the three cases added to `miri-pass` at `timeout=60000`, removed from its skips, and removed from
`miri-pass-heavy`. Each case's args, env and file hash is the same on both sides. Every other suite line is identical apart from
the two `what` hashes, which were meant to change.

Heavy list against `miri-pass-20261103-224105-harness-m6c-grlt.jsonl` (360 rows, oracle user seconds):

| case | oracle s | where |
|---|---|---|
| `0weak_memory/consistency_sc.rs` | 5.04 | heavy |
| `0weak_memory/weak.rs` | 3.69 | heavy |
| `0weak_memory/consistency.rs` | 3.13 | heavy |
| `float_nan.rs` | 2.88 | heavy |
| *rule: 2.5 s* | | |
| `shims/x86/intrinsics-x86-gfni.rs` | 1.80 | miri-pass |
| `panic/nested_panic_caught.rs` | 1.17 | miri-pass |

**No case breaks the rule in either direction.** Exactly four exceed 2.5 s and all four are heavy.

**Writers:** `utils::prepare` appears only in `issue-miri-3680.rs`, `fs-permissions.rs` and `fs.rs`, all heavy. `fs-with-isolation.rs` is
isolation on, so its file calls are refused. `path.rs` and `env/temp.rs` do not write. `socket.rs` writes to sockets only. I searched all the
isolation-off sources for file APIs and found no other writer, including the four in `tests/fail`. The moved cases do not write. The
comment's other numbers hold: every other case under 1.8 s (1.795), tests/fail max 1.27, miri-pass-tb max 0.87, run-pass-aux-miri max
0.24, and the four reason strings.

### 3. N2's test changes: fixed, proved by mutation

Throwaway mutation in a scratch checkout: `tests/pass/btreemap.rs#tree` added to `MIRI_UI_HEAVY`, `miriPassHeavyCases` no longer filtering
Tree Borrows, and the counts expectation moved to 8 so that `gated` is what gets exercised.

| | result |
|---|---|
| new `gated` expression | **fails** at `harness/miri-ui.test.ts:246`, receiving `["tests/pass/btreemap.rs#tree"]` |
| control: the same mutation, pre-fix expression | passes, so the old assertion really was blind |

`fsHeavy` is right. Removing `issue-miri-3680.rs` from the list fails at `:248`. It pins the three known writers and cannot find a new one;
that is what a name filter can do, and L3's re-check is where a pin move would catch it.

### 4. N3's comment: true at the pin, overstated in scope (L3)

- "27 of their cases run with isolation off": correct. 18 + 3 + 2 + 4 have `-Zmiri-disable-isolation`. `MIRI_ISOLATION_OFF` gives 28 because
  it also matches `var-forward.rs` (`-Zmiri-env-forward`).
- Every one of the 28 run twice on the oracle, each with a private `MIRI_TEMP`: **only `panic1.rs` differs**
  (`thread 'main' (69770)` vs `(69918)`). `unstableMiriOracleReason` returns nothing for it, so only the explicit list covers it, as N3 said.
- The list does not really "cover isolation-off cases". It has two entries; one is isolation off, and `mir-validation.rs` has no such flag (an
  ICE thread id). So its coverage of isolation-off cases is the single case that needs it.
- "a real pid or path ... shows up as a difference between two oracle runs" is loose. A real path that is the same on both runs does
  not differ, and does not need to, since the subject prints the same one. Only a value that varies shows up, and nothing runs the
  two-run comparison automatically.

### 5. The texts: accurate, and the `run-pass-miri` one should change (L4)

`M6B_MIRI_PASS` prints as intended on real runs, and each clause of A12 matches the code. The `run-pass-miri` text does not. A real summary from
the wave 37 gate still says:

```
"met": true, "what": "plan-m6 gate M6b: run-pass-miri + run-pass-miri-heavy + run-fail-miri >= 90% MATCH, ORACLE_TIMEOUT excluded"
```

That is one suite's `met` next to the group's sum, which is what R1 reported and how the wave 37 claim got written. `scripts/criteria.ts` helps only a
reader who runs it, and the two constants in one file now mean different things.

**Acceptable for now, not for long.** It is not worth holding this merge, but give it the same "this suite's share" wording in the next harness batch.
The earlier review held back only to keep the existing suites byte-identical, and the text is not part of any case or oracle key.

### 6. The correction on main: accurate

- `PLAN.md:59` and `docs/next.md:423` no longer call M6b met. Their figures match the gate: 3408/3470, 292/294, pm-ui 279/282 = 98.94%.
- `run-pass-miri-heavy` did not run, as stated. The recorded "about 98%" with all 8 failing is right: 3700/3772 = 98.09%.
- `git grep` finds no other claim that M6b is met in `docs/state/history.jsonl`, `docs/handoff` or `docs/reviews`.
- The citation of A12 on main dangles until the merge (L8).

### 7. The merge with `integ-w38` (`7a5ac07a`): clean apart from N4

I merged in a scratch checkout. Nothing was pushed or committed.

- **One conflict**, at the import in `harness/compiletest.ts`, as N4 said. The union is
  `{ MIRI_CASE_ENV, MIRI_SYSROOT, miriBinary, miriOracleKey, miriPin, miriTargetLibDir }`.
- **Typecheck:** `bunx tsc --noEmit -p .` exits 0 on the merge.
- **Tests on the merge:** `scripts/criteria.test.ts`, `harness/miri-ui.test.ts`, `scripts/unstable.test.ts`, `scripts/unported-buckets.test.ts` and
  `scripts/miri.test.ts` run together gave 33 pass, 1 fail: the 5 s timeout noted above. `scripts/miri.test.ts` alone with a longer limit: 11 pass.
- **Case dump, `integ-w38` vs merge:** the 53 existing suites are identical; only the five new suites are added (58 suites, 364,386 cases), with the same
  `miri-pass` and `miri-pass-heavy` hashes as `babf8030`.
- **Summary format:** `integ-w38` adds `unportedBuckets`, and every field `criteria.ts` reads is unchanged.
- **`main`:** `babf8030` merges into it without conflict (tested at `da6dd0bf`; since then main has changed only `docs/next.md` among the files I compared).

Fresh samples on the merged tree (`RUST_TS_AGENT=review-m6c-recheck`, run `recheck-m6c-mrg2-1793783572`, load 40–65). No DIFF, CRASH or TIMEOUT:

| suite | sample | MATCH | UNPORTED | UNSTABLE |
|---|---|---|---|---|
| `miri-pass` | 40 | 37 | 2 | 1 |
| `miri-fail` | 25 | 21 | 4 | 0 |
| `run-pass-aux-miri` | 25 | 22 | 3 | 0 |
| `miri-pass-tb` | 10 | 0 | 10 | 0 |

`miri-pass-heavy --filter issue-miri-3680` gave UNPORTED (run `recheck-m6c-mrg-1793783534`). These are samples, not the M6b figure.

## Not checked

- No gate and no full difftest of any suite, as instructed. So `scripts/criteria.ts` has never been seen printing `met` from a real complete run of the new
  suites: only from fixtures, plus `not met` from the real gate and real filtered runs.
- No quiet-host timing. Load ranged from 4 to over 200, and the host rebooted during this review, which wiped my first scratch checkouts and fixture files. The
  base/head dump and the fixture results above come from before that. The double-run, mutations, merge dump and samples were done after it. CPU figures in L5 are
  under load 40, where user time can read high.
- The full `bun test ./scripts ./harness`, and any host other than `aarch64-apple-darwin`. The difftest code has no test file of its own under that name; I read its
  summary and `criterionOf` code.
- The other seven heavy cases on the port, beyond `issue-miri-3680.rs`.
- Oracle stability with a changed `HOME` / `USER` / `PATH`: the handoff's claim, not repeated. My double-run used the caller's environment plus each case's, with a
  private `MIRI_TEMP`, not the harness's scrubbed `caseEnv`.
- N1's cross-process race was not exercised.
