verdict: CHANGES_REQUESTED

Batch: lane/probe-rmetadump (e9adf40d, base adaa9d4a; merges cleanly into current main, which has not touched harness/ or scripts/ since).
Reviewer checks run in a detached worktree of the lane:
- `bun test scripts`: 68 pass, 0 fail.
- `bunx tsc --noEmit -p .`: clean.
- `mir --sample 100` (RUST_TS_AGENT=rev-rmetadump): 100 MATCH. All 100 ids are in harness/baseline/mir.txt, 0 lost.
- `rmeta-ui --sample 20`: 20 UNPORTED (stop `rustc_metadata::rmeta::encoder::encode_metadata`), as the lane reports.
- I ran the probe twice by hand on an oracle-built ui rmeta (`--content`): exit 0, empty stderr, byte-identical output, well-formed `== ` sections.
- Cache keys: I computed `cachePath` on main and on the lane for all 36 existing suites. Only `mir-core` changes, through split.ts's source hash, which the lane disclosed. `oracleKey` is set only on the 4 new suites.
- Wrapper timeout on macOS: under `run()` with a 2 s timeout, the wrapper got SIGTERM, passed it on, and returned 143 with timedOut=true. No orphaned child.
- No baseline, oracle output or existing suite definition changed. Suite count went from 36 to 40.

Findings:

1. scripts/gate.ts:100 (checkProbes; unchanged by the lane, but this batch is what breaks it). Severity: BLOCKING.
   `checkProbes` requires each suite's oracle argv[0] to be `rustc` or one of its declared probes. All four new suites
   start their oracle command with `process.execPath` (Bun running scripts/rmeta-run.ts). I reproduced this with the
   lane's code: `checkProbes([s], false)` returns false for rmeta-core, check-core, rmeta-ui and check-ui
   ("ERROR: suite check-core runs .../bun but declares probes []"). It returns true for mir-core.
   So `gate.ts run --suites check-core` (or any of the four) dies with "missing probes" before running anything, and
   none of these suites can ever get an accepted gate run. That includes check-core, which plan-m5 D4 makes the M5
   gate case. The lane checked the suites only through difftest, never through the gate. This is not a ratchet loss
   today, because the suites are unprotected and the default gate runs only protected suites. But the batch does not
   deliver what it is for.
   Fix: in this harness batch, teach checkProbes about the wrapper. Either accept argv[0] = Bun with argv[1] = RMETA_RUN
   and check the declared probe from `--dump`, or have the suite declare the wrapper. Add a unit test that runs
   checkProbes over every registered suite, so a later suite cannot regress this silently.

2. scripts/rmeta-run.ts:135-140 (differsLine against a kept `oracle.rmeta`). Severity: non-blocking (it can only give a false DIFF, never a false MATCH).
   The subject's stdout gains `rmeta: differs ... first at byte N` whenever `<dir>/oracle.rmeta` differs from its file.
   But that file is whatever the last oracle *process* wrote into `$RUST_TS_DATA/rmeta/<suite>/<hash(id)>`, and that
   directory is keyed only by suite and case id, not by the oracle cache key. Here is how it goes wrong. The oracle text
   comes from the cache (key A), while `oracle.rmeta` was last rewritten by a run under another key B: another branch's
   argv, or a rustc or probe rebuild that was later reverted. A subject whose bytes equal A's cached line then prints the
   extra line and is DIFF. On a protected check-* case that is a spurious loss.
   Suggestion: write the first-difference line to a side file in the out dir, or to the run's diffs, rather than to the
   compared stdout. Or key the out dir by the oracle cache key. The header's reason for using stdout ("so the diff file
   shows where the bytes part") can be met with a side file.

3. scripts/rmeta-run.ts:106-120 + scripts/lib/common.ts:86-91 (Windows timeouts). Severity: non-blocking (the gate host is macOS per the 2026-10-30 crateinfo-symbols decision; AGENTS.md §5 still says Windows).
   The lane's caveat understates the problem. On Windows, `proc.kill()` terminates only the wrapper, and the compiler
   (or probe) grandchild keeps the inherited stdout/stderr pipes open. `run()` waits for both pipes to close
   (`new Response(proc.stdout).text()`), so difftest does not just leak a process: it blocks until the grandchild ends.
   The 1,800 s heavy timeout is then not enforced at all for rmeta-core and check-core on Windows.
   Root should record this, and either mark these suites POSIX-only or kill the process tree there.

4. tools/probes/rmetadump/main.rs:795-797 (`index <i>` row in every def section; `did()` prints `crate:index`). Severity: non-blocking (design note for root).
   Ids are keyed by def path, so a missing or extra def shifts no *id*. But every def section's text contains its own
   DefIndex, and every DefId in a value is printed as `<crate>:<index>`. So one extra or missing def early in core turns
   every later def section into a DIFF, even though the ids stay put. The handoff's "a missing or extra def then shifts
   no other id" is true only of ids. This may be acceptable, since DefIndex is real encoded content and byte identity
   needs it anyway. It should be a recorded choice, because it decides how useful rmeta-core is as a progress ratchet.

5. tools/probes/rmetadump/main.rs:28 (header comment) vs. the handoff. Severity: non-blocking (docs).
   The header says `to_string_no_crate_verbose` paths are "unique per crate, so a missing or extra def shifts no other
   id". The handoff measured 18 repeated paths in core, which get `@2` from `uniqueIds`. The comment should say so.
   Likewise, the rmeta-run.ts header (line 8) says a compiler that "writes no file ends the run". The code prints
   `rmeta: none` and exits 0 (line 131-133; the test at rmeta-run.test.ts:107 expects that). The comment should be fixed.

6. tools/probes/rmetadump/main.rs:408-415 (`SyntaxContext` transmute). Severity: non-blocking.
   The compile-time size assertion is there and correct. `SyntaxContext` is a plain `struct SyntaxContext(u32)`, not
   `#[repr(transparent)]`, so the size check is the practical guarantee. That is acceptable for a pinned probe.
   `stabilize_spans` picks numbers by a text heuristic (` (#n)` after `<l>:<c>` or `no-location`). A false hit with an
   out-of-range n would panic in `marks()` inside `Out::end`, which is outside `guarded`, so the whole run ICEs (CRASH).
   That is loud, never a false MATCH. Fine as is.

7. tools/probes/rmetadump/main.rs:650-656 (`Out::row` drops empty lines inside multi-line values). Severity: non-blocking.
   Blank lines inside MIR text are dropped on both sides, so a difference only in blank lines is invisible to rmeta-*.
   check-* still catches it. Worth a sentence in the header.

8. scripts/rmeta-split.test.ts:47-69 (tests). Severity: non-blocking.
   The rmeta-specific end-to-end test covers MATCH, one def DIFF, UNPORTED and probe CRASH.
   - Its CRASH case uses an oracle with zero sections (`true`), so "every section gets the run's status" is not
     actually exercised for a crash.
   - There is no end-to-end case of a missing, extra or reordered def section through `splitRmetaDump`.
   The generic split comparison tests (scripts/lib/split.test.ts:138-178, from harness-m5a) do cover missing, extra,
   reordered and duplicate-key sections at the compareSections level, so the edge cases are covered, but only
   generically. Suggest one rmeta e2e case with an oracle that has sections plus a probe crash, and one with a
   subject missing a def.

9. harness/suites.ts (heavy class for rmeta-core and check-core). Severity: non-blocking (note).
   - They reuse the M5_HEAVY settings: serial, subject 1,800 s, oracle 300 s, 12 GB RSS budget, over-budget reported
     as `ERROR:` by harness-m5a/b's code. That is sound.
   - RSS comes from wait4 on the wrapper, which includes its descendants. For rmeta-core, the subject's max RSS and
     user time therefore include the oracle's probe run over the port's rmeta (0.66 GB on core) as well as the
     compiler. That is small against 12 GB, but the heavy line should not be read as pure port cost.
   - `rmetaOracleKey` reads the probe binary with `readFileSync`. If the probe is not built, difftest throws a raw
     exception instead of an `ERROR:` line.

10. Corpus (harness/suites.ts RMETA_UI_CORPUS) and the added `check-ui`. No change requested.
    - The static filter is conservative and reproducible: 730 cases, unique ids.
    - Argv is stdArgs + `--crate-type lib --emit=metadata`, with session env pinned. A command-line `--crate-type`
      overrides crate_type attributes anyway.
    - Single mode for the ui suites is justified by `--sample` cost.
    - check-ui is a reasonable small-crate counterpart to D4. It goes beyond the plan's list, so root should record it.

Nothing found that hides information from the regression auditor. The new suites are unprotected. No existing suite's
status logic, lost/gained logic or cache key changed except mir-core's one-time oracle rebuild, which the lane disclosed.
The new suites could not be silently accepted anyway, since the gate refuses them (finding 1).
