# Review: harness-m8a-gate (independent, read-only)

Branch `t3/gate-oracle-guard-headroom`, commit `5ba389cb` (base main `c3a5c9ac`); handoff `docs/handoff/harness-m8a-gate.md`;
scope plan-m8 D2, D9 (ENV), D18–D21, D23, §8 wave 41 step 3; root's decisions "M8 host headroom" (history.jsonl:732) and
"M8 kept caches" (:734).

Checked in two scratch detached worktrees (`5ba389cb` and main `0575c7bc`) with the root host's `.env.local`; no file under the main
checkout, the lane's worktree or `$RUST_TS_DATA/watchdog-stops/` was written (that directory does not exist on the host). No gate,
no heavy build. Host on AC power, load 12–16 on 12 cores during the checks.

## Verdict: **PASS WITH NOTES**

I found no way to accept a run that lost a protected case, to drop a protected case from the loss checks, to get ENV from a subject
outcome, to hide a suite that has a baseline behind `neverProtect`, or to count a headroom or watchdog stop as a pass. Today's
71 protected suites behave as before. The notes below are a missing D19 test (N1), a missed-stop window in the watchdog interface that
`harness-m8a-build` must close (N2), decisions root should record (N3, N4), and wording (N6). F1 is not this batch's fault, but it
blocks every gate.

## Findings

### F1. Every gate on main fails today at the runner unit step (not this batch's; fix it before the next gate)
- Confirmed on main `0575c7bc`: `bun test ./harness/m7d-suites.test.ts` → 1 pass, 1 fail, "M7d's suites: report only, their
  commands, the corpus and the queries": `Expected: false, Received: true` at `harness/m7d-suites.test.ts:54`.
- Cause: line 54 expects no baseline for `rg-build`, `rg-behaviour`, `rg-behaviour-rgtest`, `pm-self`, `std-self`. Accept
  `4a3ffbf8` (gate-20261115-141315-root-qswd, after root's decision "Wave 40t gate scope", history.jsonl:726) created
  `harness/baseline/{rg-build,rg-behaviour,rg-behaviour-rgtest,pm-self}.txt`. `std-self.txt` does not exist.
- The runner unit step's roots are `scripts` and `harness` (`scripts/lib/unit-steps.ts:50`), so every `gate run` fails until this is fixed.
- **Correct fix: restate the expectation exactly. Do not loosen it.** Line 54 becomes
  `expect(existsSync(...)).toBe(n !== "std-self")`, so it asserts a baseline for each of the four accepted suites and none for
  `std-self`. The line-53 comment becomes "the four accepted at 4a3ffbf8 are protected; std-self is a report". Do not delete the
  assertion, and do not change it to a "baseline or not" check. It is a `harness/` change, so it needs its own reviewed batch, or a
  restatement that rides in a reviewed batch, as tools-prep-m8's m7 sparse-list update did.

### F2. Ratchet safety: no hole found (evidence)
- **Accept of a run with a loss.** `planAccept` (`scripts/lib/protect.ts`) keeps the old loop's logic unchanged: baseline minus
  the run's MATCH ids from its own `<suite>.jsonl`, then a refusal on any loss, then the unstable check, all before any write.
  `gateAccept` still refuses `!pass`, a dirty tree, a moved HEAD and protected suites that were not run (`missing`). A `stop` is now
  refused first (`gate.ts:974`).
- **Protected case dropped from loss checks.** The only new skip is a `neverProtect` suite, in `planAccept` and the headroom
  `continue` at `gate.ts:777`. `gate run` (`:691`, before anything runs, every registered suite) and `accept` (`:998`) refuse while
  such a suite has a baseline file. Accept also requires an unmoved HEAD and a clean tree, so `suites.ts` and `harness/baseline` are
  the ones `gate run` checked. A suite reaches `notRun` with `pass: true` only through that `neverProtect` branch, so a protected
  suite can never be "not run" in a passing gate.
- **ENV from the subject side.** `oracleEnv` and `Suite.envOracle` receive only oracle `{stdout, stderr, code}`. In fresh runs that is
  `r` from `runOnce(s.oracle([c]))`; from the cache it is `stdoutOf`/`stderrOf` of the cached `render` output, and a flagged cached
  entry is removed and re-run. `classify` reads `o.env` before any subject field (`difftest.ts:750`). `compared` spreads `o`, so it
  keeps `env`. `envOracle` is refused on batch and split suites (`:1130`), the only paths that build oracle outputs elsewhere.
  `difftest-env.test.ts` covers all 12 subject outcomes against a plain and an ENV oracle, a subject that prints the oracle's exact
  output, a skip on the subject side alone (DIFF), and the oracle run counts that show ENV is never cached.
- **ENV and protection.** ENV is never MATCH, so a protected case that becomes ENV is lost and fails the gate. It is also refused by
  `planAccept`. `matchIdsOfJsonl` is MATCH-only, the old loop moved verbatim.
- **A stop counted as pass.** `pass` includes `stop === undefined` (`gate.ts:854`). Both stop kinds set `stop` and `break`. The
  stopped suite's results are not pushed, so none is lost or gained. Accept refuses a `stop` before reading `pass`.
- I re-ran all the new tests (below) and read each fake-reader scenario in `gate-headroom.test.ts`. Every `accept` it runs is on a
  stopped run, and those refuse before touching `harness/baseline`.

### F3. Unchanged behaviour for today's suites: confirmed
- **Oracle keys.** `bun scripts/oracle-keys.ts` on main and on `5ba389cb`: 391,641 keys each, sha1
  `709292dbcf918cb58021c15b834b1ce1427e8c9f` both (the lane's figure), and `cmp` identical.
- **New fields.** Loading `SUITES` on the branch: 86 suites, none sets `neverProtect`, `headroom` or `envOracle`. In
  `harness/suites.ts` the only occurrences are the interface declarations.
- **Sample difftests.** `RUST_TS_AGENT=review-harness-m8a-gate`, `--sample 200 --jobs 4`, on both trees:
  - `check-ui` (single): 200/200 MATCH;
  - `parse` (batch): 200/200 MATCH, `skipped=3`;
  - per-case id/status lists `cmp` identical between main and branch, and every sampled id is protected.
  - Runs: `review-m8a-gate-{main,branch}-{check-ui,parse}` under `$RUST_TS_DATA/runs/`.
- **Output format.** The only change is additive: the summary line gains ` ENV=0` after `UNSTABLE=…`, and `<suite>.summary.json`'s
  status counts gain `"ENV": 0`. Status counts and `match%` are otherwise identical. No script in `scripts/`, `harness/` or `tools/`
  parses that line. gate.json gains `env` only when non-empty (a gate-headroom test asserts this), and `criteria.ts` adds `env` to a
  group only when non-zero, so today's records are unchanged.

### F4. D2 guard: verified
- **Pins.**
  - `UPSTREAM.json` `rust.tools` equals the `clippy-preview`/`rustfmt-preview` `aarch64-apple-darwin` `xz_url`/`xz_hash` in the
    oracle toolchain's own `lib/rustlib/multirust-channel-manifest.toml`, the one rustup installed with the oracle, at
    `~/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin`. They also equal the lane's saved `channel.toml`.
  - Its `date = 2026-10-11`, and both packages' `git_commit_hash` is `6f5da406b5…`, the pin's commit and `rustc +nightly -vV`'s.
  - The kept tarballs under `.data/tools/<sha256>/` hash to their pins.
- **otool check.** `toolGuardErrors` lists `<oracle sysroot>/lib` and runs `/usr/bin/otool -L` on `clippy-driver`, `cargo-clippy`
  and `rustfmt`. Each must link exactly one `@rpath/librustc_driver-<hash>.dylib`, and that file must be in the oracle's lib. By
  hand: all three link `@rpath/librustc_driver-3bee00c5d9e363a9.dylib`, the sysroot's only driver. The only `LC_RPATH` is
  `@loader_path/../lib`, and the tarball trees hold no dylib, so without `DYLD_LIBRARY_PATH` they fail to load: fail closed. Each
  binary is also compared byte for byte with `tar -xOf` of the kept tarball.
- **Setup.** `scripts/tools.ts` runs no rustup command. It writes only under `$RUST_TS_DATA/tools/` (temp directory, then rename)
  and runs `oracleToolchainError` before and after.
- **Oracle key.** `toolOracleKey` = `{tool, tarballSha256, rustcDriver}`, where `rustcDriverHash()` hashes the driver file's
  content. No suite uses it yet; that comes with `harness-m8d`.
- **Runs.**
  - `bun scripts/tools.ts check` → `ok    tool oracles (clippy, rustfmt) … on the oracle's librustc_driver`.
  - The real guard test passes with `RUST_TS_DATA` set and `RUST_TS_REQUIRE_PROBES=1` (13 pass, 0 skip). Without `RUST_TS_DATA` in
    the environment it skips (12 pass, 1 skip). That is expected: the unit step sets it.

### F5. D20: the minimums match the plan; the lane's three choices are sound
- **Table.** `heavy-build` refuses below 20 GiB free and at 4 GiB of swap or more. `testsuite` refuses below 10 GiB, with no swap
  rule. That matches D20's table, and `headroom.test.ts` pins it.
- **Readers.** Free space is `statfs` `bavail*bsize`: on the host it read 14,711,623,680 B, against `df` Avail 14,366,816 KiB.
  Swap read 7287.81 MB, the same as `vm.swapusage`. Today's host fails `heavy-build` on both rules and passes `testsuite`.
- **Fail closed.** A missing, failing, throwing or hanging reader fails the rule that needs it.
- **Critical pressure in every class.** This goes beyond D20's table, but only by refusing more, so the ratchet cannot be harmed.
  It is a single instant reading, where the watchdog waits 60 s at critical, so a short spike can stop a gate before a covered suite.
  That is acceptable, but see N3.
- **A watchdog stop in a `neverProtect` suite stops the gate.** This matches D20 as written: only "a failed check before it marks it
  'not run'" is exempt, and a watchdog stop means the host hit the floor. Since `cargo-build` runs first, a re-run costs little.
- **Records as files in `$RUST_TS_DATA/watchdog-stops/`.**
  - **Stale files cannot fail a later gate.** Only records dated at or after the current suite's start count.
  - **Two ways an old file can still stop a gate.** A record whose `at` is in the future, or an unreadable record whose mtime gets
    refreshed (`cp -R` without `-p`, a restore), stops every later gate until someone removes it. Both fail closed. See N5 for the
    message.
  - **A stop can be missed.** See N2.

### N1. D19's "accept refuses a neverProtect suite with a baseline file" has no end-to-end test
`protect.test.ts` tests `neverProtectBaselineErrors` itself, and `gate-headroom.test.ts` tests that `gate run` calls it. Nothing
tests that `gateAccept` calls it (`gate.ts:998`), and `planAccept` silently skips such a suite. The ratchet is still safe today,
because accept's HEAD and clean-tree checks mean `gate run` already refused that state. But D19 lists this test, and the skip
depends on the caller's order. Recommended (small, for this batch or the next harness batch): give `planAccept` a
`hasBaseline(name)` input and have it refuse a `neverProtect` suite with a baseline itself, with a test. That puts the refusal in
the same code that skips the suite.

### N2. A watchdog record written after the gate's post-suite read is never seen
The gate reads stops right after `difftest` returns, with `watchdogStopsSince(stopsDir, suiteStartMs)` (`gate.ts:792`), and each
later read counts only records dated at or after its own suite's start. Suppose a detached watchdog writes its record a moment after
the killed build's process exits, so after the read. Then that stop is missed for good, and the gate runs on.
- **Ratchet impact: none.** The killed case is non-MATCH, so it is lost if protected, and nothing it did can be MATCH.
- **What it breaks.** D20's "the gate stops there".
- **Fix (either one).**
  - Make `recordWatchdogStop`'s contract say the record is written before the process difftest waits on exits. For example, the
    watchdog runs inside the project-build harness process and records before that process exits.
  - Or have the gate read once more, since the gate's start, before it computes `pass`.

  This is for `harness-m8a-build`'s review to check. The second fix is a two-line change here.

### N3. Root should record "critical memory pressure refuses in every class" as a decision
The handoff marks it "Decision (for the reviewer)". It adds a rule to D20, whose §6 text is marked **[owner]**. I agree with it,
since it only fails closed, but it belongs in `history.jsonl`, not only in the handoff.

### N4. Root should record the gate-time cost of the unit-step tests (D13 budget)
- **Measured:**
  - new files, run alone at load ~13–15: 7.2 s in all;
  - `gate-headroom.test.ts` alone: 6.0 s (the lane measured 2.9 s), of which the rest is 1.2 s;
  - `tsc` clean.
- **Margin.** Under D13's 10 s, but `gate-headroom` spawns seven child gates, so the margin shrinks under load.
- **Environment reads.** The new tests read by name only `RUST_TS_DATA` and `RUST_TS_REQUIRE_PROBES`, both in
  `UNIT_ENV_HARMLESS`. `unit-steps.test.ts` passes (10/10), and so does `deps.test.ts` (12/12).

  The child gates inherit the environment minus `NODE_ENV`, `RUST_TS_FREEZE_LISTS` and `UNIT_ENV_REFUSED`, as `gate-power.test.ts`
  does, with `RUST_TS_DATA` and `baselineDir` in temp dirs.

### N5. Watchdog record handling: two small robustness points
- A readable stop's reason does not name its file, so a future-dated stale record (F5) is hard to find. Add the path to the reason,
  as the unreadable case already does.
- `statSync(file)` at `headroom.ts:153` throws if a file disappears between `readdirSync` and `stat`. That would crash `gateRun` with
  no gate.json, which fails closed. A try/catch that counts it as a stop would match the rest of the function.

### N6. The refusal text offers "removing the baseline" as a way out
`neverProtectBaselineErrors` (`protect.ts:19`) says "clearing neverProtect (a reviewed harness batch) or removing the baseline is
root's recorded decision". The protected set only grows (AGENTS.md §2), so a tool message should not offer deleting a baseline.
Suggested: "…: clear neverProtect in a reviewed harness batch (a baseline is never removed to make a run pass)".

## Commands run (summary)
- `bunx tsc --noEmit -p .` on `5ba389cb`: clean.
- `bun test` on each new or changed test file: tool-oracles 12 pass + 1 skip (13/13 with `RUST_TS_DATA` and
  `RUST_TS_REQUIRE_PROBES=1`), headroom 11, protect 8, difftest-env 3, gate-headroom 7, criteria 18, unit-steps 10, deps 12; 0 fail.
- `bun test ./harness/m7d-suites.test.ts` on main: 1 fail (F1).
- `bun scripts/oracle-keys.ts` on both trees (F3); `bun scripts/tools.ts check` (F4); the four sample difftests (F3).
