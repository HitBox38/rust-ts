# Review: harness-m6a (harness batch; isolated Miri oracle, run-mode Miri suites, coverage crate `miri`)

Reviewer: independent, read-only on code. Branch `t3/miri-harness-runner`, head `45e09678`. Reviewed the lane's own
change only: `git diff 11e72519 45e09678`, where `11e72519` is the integ-w35 merge (15 files, +1305/−27). Context:
docs/plan-m6.md (D1, D4, D6, D11, D13, D14, §4, A7, A9, A11) and docs/handoff/harness-m6a.md.

## Verdict: APPROVE WITH NITS

None of the findings is blocking. The ratchet is safe, the Miri toolchain is isolated, and the oracle runner, cache key
and suites match the plan. The nits are small. N1 is the only one that touches the "can't hide nondeterminism" check,
and nothing at the pin hits it (measured).

## Checks

1. **Ratchet safety: ok.**
   - Ran `SUITES.filter(milestone !== "M6")` in a `git archive` of `11e72519` and in HEAD, each with
     `hash(JSON.stringify([cases(), skipped()]))`. All 47 existing suites are identical: same counts, same hashes,
     no errors.
   - Baselines, oracle outputs and suite definitions of existing suites are untouched.
   - `cachePath` (scripts/difftest.ts:323) adds a part only for suites with `oracleKey`. Only the new Miri suites set
     it, so no existing key changes.
   - The `compiletest.ts` directive parsing for `run-flags`, `exec-env` and `unset-exec-env` is guarded by
     `opts.run`. The `-Zparse-crate-root-only` push is unchanged for non-run callers.
   - Unstable change: `unstableReasonOf` (difftest.ts:340) returns the unchanged `unstableOracleReason` for every
     non-`miri` suite. Existing suites' classification cannot change.
   - Miri side, measured: I re-ran the Miri oracle on every exit-101 case of the lane's full timing (166 run-pass +
     run-fail panics plus 6 others; 172 in all).
     - All 166 thread-id lines are Miri's virtual `thread '…' (1000) panicked` (shims/env.rs:107-120; pid 1000 with
       isolation on).
     - None carries any ICE marker.
     - So the relaxed rule hides nothing today. One gap remains, in N1.
2. **Isolation of the Miri toolchain: ok.**
   - `isolatedEnv` (scripts/miri.ts) builds every rustup/cargo env from scratch: a short pass-through list plus
     `RUSTUP_HOME`/`CARGO_HOME` set to the isolated homes.
   - `step` re-asserts both values before each spawn, and setup refuses to run if the isolated home is the oracle's.
   - The oracle's components are checked fresh before and after setup.
   - Guard (`miriOracleProblem`, scripts/lib/miri.ts):
     - the component list equals `rust.miri.components`, and `lib/rustlib/src` exists;
     - the `-vV` commit of both `miri` and `rustc` equals the pin;
     - `librustc_driver` is byte-identical to the oracle's (`rustcDriverHash`);
     - the sysroot has `libcore`, `liballoc` and `libstd` rmetas for the target.
   - `bun scripts/miri.ts status`: `ok oracle toolchain … pinned components, no rust-src`, then `ok: Miri toolchain …
     at 6f5da406b56c … sysroot 82 files, 117 MB; oracle key 4b7f6cc5967f`.
   - Oracle `~/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin/lib/rustlib/components` (read only):
     - It lists the six pinned components and has no `lib/rustlib/src`.
     - Its sha1 is `9f06e651…`, the same as the handoff's figure, and the same after all of my runs.
   - The isolated toolchain lists `miri-preview`, `rust-src`, `cargo`, `rust-std` and `rustc` for the host, which
     matches `rust.miri.components`.
3. **Oracle runner, cache key, compare: ok.**
   - The oracle is `[<rustup-miri>/…/bin/miri, ...args]`, by absolute path.
   - D6 argv, checked on `trim-env-name.rs`:
     - `-o` is dropped;
     - `--sysroot` is swapped to `miri-sysroot`;
     - `--target=x86_64-unknown-linux-gnu`, `-O`, `-Zui-testing` and the remap flags are kept;
     - `exec-env` becomes `-Zmiri-env-set=` (minus any `unset-exec-env`);
     - `run-flags` go after `--`.
   - D14: isolation stays on, and cwd and argv are the same on both sides.
   - `MIRI_CASE_ENV` removes every variable the pinned Miri reads. I grepped src/tools/miri/src for `env::var*`: it
     reads `MIRI_LOG`, `MIRI_TRACING`, `MIRI_BACKTRACE`, `MIRI_CWD`, `MIRI_LOCAL_CRATES`, `MIRI_BE_RUSTC` and
     `RUSTC_LOG`. The last one is already scrubbed by env.ts.
   - `MIRI_DEFAULT_ARGS` equals lib.rs:187 (also tested).
   - Key: the difftest key (commit, miri binary, id, args, file, env, deps) plus `miriOracleKey` (miri binary,
     isolated driver lib, components file, target, every sysroot file).
   - The compare is the single-mode byte-exact stdout + stderr + exit, with no normalisation.
4. **Suites: ok.**
   - Measured counts: `miri-hello` 1; `run-pass-miri` 3,263 cases / 704 skipped; `run-pass-miri-heavy` 6 (heavy);
     `run-fail-miri` 263 / 63.
   - No case is also listed as skipped, and there are no duplicate ids.
   - Skip breakdown: 402 aux, 250 `needs-*`, 40 ignored or `only-*`, 6 LLVM, 6 heavy (run-pass); 48, 9, 3, 3
     (run-fail). This matches the handoff.
   - Plan differences, spot-checked:
     - 28 run-mode files sit under `compiletest-ignore-dir` dirs (counted: 28);
     - 28 files declare a run mode per revision (`//@ [rev] run-…`), which plausibly gives the 41 revisions.
   - Heavy list (A7), checked against `run-pass-miri-…-wwxn.jsonl` (3,269 rows):
     - the 2 timeouts (`step_overflowing`, `hashset-connected-border-12860`);
     - 4 cases between 5.1 and 18.5 s;
     - next slowest 3.4 s, which matches `MIRI_HEAVY`.
     - run-fail's max is 1.2 s, so it has no heavy case.
   - Criterion (A9): `criterionOf` only feeds the summary and the printed line. Nothing in difftest's exit path or
     gate.ts reads it. On the sample runs it printed `[sample/filter run]` and difftest exited 0.
5. **Coverage crate `miri`: ok.**
   - `--crate miri`: `TOTAL 0/1514`.
   - `--missing …/shims/unix/socket.rs` gives the partial note and `0/1` (`socket` :158 only).
   - `--missing …/shims/windows/fs.rs` gives the out-of-scope note.
   - The excluded socket files plus socket.rs total 3,807 lines, matching D2.
   - Markers are searched under all of `src/`, so a missing `src/miri/` gives ported 0, and a checkout without Miri's
     sources prints a note.
   - 25,518 + 1,514 = 27,032, as claimed. I did not run the full table, because it writes coverage.json.
6. **Sparse checkout: ok.**
   - The upstream HEAD is `6f5da406b56c2db6607202b63daee73aa8c61297` (the pin), and the checkout is clean.
   - `git sparse-checkout list` includes `src/tools/miri/tests`.
   - No harness or scripts collector walks the upstream `src/tools` (grep). The case-list identity in check 1 confirms
     it.
7. **Results:**
   - `bunx tsc --noEmit -p .`: exit 0, clean.
   - `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness --timeout=60000`: 110 pass, 0 fail, 16 files.
   - `bun scripts/difftest.ts --suite miri-hello` (run `20261031-231548-rv-m6a-p6q3`): UNPORTED 1/1. The criterion
     line was printed as "not met", and difftest exited 0.
   - `bun scripts/difftest.ts --suite run-pass-miri --sample 20` (run `20261031-231607-rv-m6a-zvoy`): UNPORTED 20/20,
     UNSTABLE 0, skipped 704.
   - `bun scripts/difftest.ts --suite lex --sample 50` (run `20261031-231620-rv-m6a-wim4`): MATCH 50/50.

## Findings

- **N1 (non-blocking) `scripts/lib/unstable.ts:32`: the ICE marker misses the `bug!` / `span_bug!` path.**
  - `report_ice` (compiler/rustc_driver_impl/src/lib.rs:1553) skips the `Ice` diagnostic, "the compiler unexpectedly
    panicked. This is a bug", when the payload is `ExplicitBug`.
  - The ICE hook still calls `default_hook` for it (lib.rs ~1496), which prints `thread 'rustc' (<real OS tid>)
    panicked`.
  - So a Miri or rustc ICE raised through `bug!` would be cached with a host thread id, and later show as a permanent
    DIFF instead of UNSTABLE.
  - Suggested fix: key on a note that `report_ice` always emits, `we would appreciate a bug report` or
    `using internal features is not supported`, or also on `^error: internal compiler error`. Add a test case with
    an ExplicitBug-shaped stderr.
  - Nothing at the pin is affected: 0 of 172 exit-101 oracle outputs carry any ICE marker.
- **N2 (non-blocking) `scripts/lib/unstable.ts:33`: `i !== 0` ties the Miri rule to the thread-id pattern being first.**
  If `UNSTABLE_ORACLE_PATTERNS` is ever reordered, the rule silently relaxes the wrong pattern. Name the pattern, for
  example as an exported constant or a `key` field, and compare against it.
- **N3 (non-blocking) `harness/suites.ts:1592` (`miriRunArgs`): no guard for an isolation-off argv.**
  - The relaxed tid rule and the env reasoning both assume isolation is on. With `-Zmiri-disable-isolation`, `get_pid`
    returns the real pid (shims/env.rs:109), so the tid becomes real and the Miri rule would hide it.
  - No tests/ui file uses any `-Zmiri` flag today (count 0).
  - Suggestion: make `miriRunArgs` throw (a skip) on `-Zmiri-disable-isolation` or `-Zmiri-env-forward` in the
    compile flags. That also matters for harness-m6c, whose `miri-pass` tests do use `-Zmiri-*` flags.
- **N4 (non-blocking, doc) `docs/handoff/harness-m6a.md:140`: the counts are off.**
  - Measured case counts with `-Zmiri-env-set`: run-pass-miri 2, run-fail-miri 23. The handoff says "3 run-pass and
    20 run-fail".
  - The program-argument counts (4 / 3) agree.
- **N5 (non-blocking, informational) `harness/suites.ts:1666` (`miriSubject`): no Miri case can MATCH yet.**
  - Plan §4.2 makes the subject `bun src/miri/bin/miri.ts` with the oracle's argv. The fallback, the port's rustc
    driver with `MIRI_DEFAULT_ARGS`, stops at codegen.
  - The fallback is documented and is root's follow-up 2. The switch needs its own harness batch.
- **N6 (non-blocking, informational) `scripts/lib/miri.ts:196` (`miriOracleKey`): rust-src is hashed only indirectly.**
  - The key covers rust-src through the sysroot's rmetas (source hashes and paths) and the components list.
  - Snippets Miri prints from std sources are read from `lib/rustlib/src` at run time. That content is fixed by the
    pinned dist, so this is acceptable, but a modified rust-src would not change the key. A cheap hardening would be
    to hash `lib/rustlib/manifest-rust-src` plus the `library/` file sizes.

No blocking findings.
