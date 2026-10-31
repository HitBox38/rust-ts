# Review: harness-w35 (harness batch)

Reviewer: independent, read-only. Branch `t3/f1a16ade`, head `92ef24c3`. The batch is the 3 lane commits on merge-base `2c5444fc`
(`e9570b7e`, `55ca77ed`, `92ef24c3`).

**Verdict: APPROVE WITH NITS.** No finding is blocking. Root should still fix finding 1 (README) when it merges this batch.

## Results

- `bunx tsc --noEmit -p .`: exit 0, clean.
- `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness --timeout=60000`: 101 pass, 0 fail, 15 files.
- `bun scripts/difftest.ts --suite lex --sample 50` (agent review-harness-w35): MATCH 50/50 (run `20261031-223925-review-harness-w35-a1pn`).
  The toolchain check passed on the real oracle.

## 1. Ratchet safety

- The diff does not touch `harness/baseline/`, suite case lists, oracle outputs or `docs/state`.
- No oracle cache key changed:
  - The check-chain oracle command is check-alloc's, and `CHAIN_RUN` appears only in the subject command (`harness/suites.ts:1517`).
  - The subject's output is not cached.
- Every new check fails closed. Each one dies or throws before it produces output; none of them turns a failure into a pass:
  - the toolchain check;
  - the probe pre-check;
  - the junit-required check, now keyed on `step.junit`;
  - the test-coverage test.
- The unit-step roots changed from bare `src tools` / `scripts harness` to `./src ./tools` / `./scripts ./harness`.
  - The old form was a substring filter, so it could run a file in both steps. The new form runs each file in exactly one step.
  - `scripts/lib/unit-steps.test.ts` asserts that every `*.test.ts` belongs to exactly one step, so no test file can drop
    out of the gate.
- check-chain no longer compares core's output when core succeeds. That cannot hide a real loss (see §4).

## 2. Oracle toolchain check

- **Pin vs the real toolchain.**
  - `~/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin/lib/rustlib/components` lists exactly the six pinned
    components (with `{host}` = aarch64-apple-darwin).
  - There is no `lib/rustlib/src`. `rustc-src`, from rustc-dev, is correctly not matched.
  - `rustc +nightly --print sysroot` resolves the `nightly-aarch64-apple-darwin` symlink to the pinned directory, so
    `basename` gives the real toolchain name.
- **The 2026-10-31 case** (miri + rust-src) is caught. The unit test covers it, and I also reproduced it below.
- **Cost.** It reads one file and does one `existsSync`, memoized. The `rustc -vV` and `--print sysroot` calls already ran.
- **Output.** One `ERROR:` line, through `die`.
- **It runs before any oracle output is produced or cached:**
  - `difftest` (`scripts/difftest.ts:849`, before `s.cases()`, so before any aux build);
  - `phase-diff`;
  - `gate run` (`scripts/gate.ts:327`, before `checkProbes`, the static checks and the suites);
  - all three aux builders, just before they build: `harness/library.ts:318`, `harness/suites.ts:611` and
    `harness/compiletest.ts:734`, the last one after the `.ok` cache-hit return.
- **`{host}` on Windows.** I made a fake sysroot named `nightly-2026-10-11-x86_64-pc-windows-msvc` whose `components`
  file has CRLF line endings and lists the six pinned components with host `x86_64-pc-windows-msvc`.
  - Six components, no `src`: `undefined`, so the check passes.
  - Plus `rust-src`, `miri-preview-…` and `lib/rustlib/src`: one line naming `extra [miri-preview-x86_64-pc-windows-msvc, rust-src]`
    and the src dir.
  - The `host:` regex also tolerates CRLF, because JS treats `\r` as a line terminator for `$`.
  - So the substitution itself works on Windows. Whether the Windows oracle has *the same six* components is the open
    question in the handoff (finding 1).

## 3. N1 / N3 / N4

- **N1.** A narrow `gate run --suites lex` with static checks now needs every registered suite's probes. That is
  acceptable, and nothing changes in practice:
  - The runner unit tests already fail on any unbuilt probe under `RUST_TS_REQUIRE_PROBES=1`
    (`scripts/gate-probes.test.ts`, `expect(j.unbuilt).toEqual([])`).
  - So the pre-check only moves that failure up front, with a build hint.
  - `--skip-static` keeps the narrow behaviour.
  - Over all four roots `oracleTestProbes` adds only `rmetadump`, which the gate-probes test names.
- **N3.** The `junit` path is part of the step definition, so the skip check no longer depends on the step's name. The
  file names are unchanged.
- **N4.** Checked with bun 1.4.3 in a temp dir that has `src/a.test.ts` and `a/xsrc/b.test.ts`:
  - `bun test src` runs both files (2 pass), so it is a substring filter.
  - `bun test ./src` runs only `src/a.test.ts` (1 pass), so it is a path.

  The claim holds, and the disjointness and coverage tests are right.

## 4. check-chain runner (`scripts/chain-run.ts`)

- **Faithful.** On the oracle side, check-alloc's command prints only alloc's diagnostics. The subject now prints only
  alloc's (the oracle's alloc against the port's core), so both sides compare the same thing.
- **No real divergence is hidden:**
  - Core's diagnostics are compared by check-core, which is protected. Its case is `CORE_RMETA_CASE`, which uses
    `CORE_ARGS(["lib"])`, the same argv as the chain's first command apart from `-o`.
  - If core fails, its output and exit code are replayed, so the result is UNPORTED or CRASH, as before.
  - `first.stdout` and `first.stderr` sit in `port-core/`, outside the compared `-o` file.
- Opening the fds before spawning, closing them in `finally`, and looping in `writeAll` are all correct.

## 5. Aux dir cleanup (`harness/library.ts`)

- The oracle cache does not depend on the pruned directories:
  - Keys hash argv, which contains the aux path. They never read the directory.
  - A pruned directory is rebuilt deterministically the next time `oracleLibRmeta` is called in the parent, before any
    case runs.
- The regex is exact. `m5-empty-sysroot`, `m5-std_detect-…` and `mini_core-…` are never matched (tested).
- A concurrent run in another worktree is protected because it touched its directory at the start of its process, and
  only directories unused for 3 days are removed.
- Remaining risks are covered in findings 2 and 3.

## 6. chain-run.test.ts

- The children are `bun -e` scripts that use `node:fs`, so there is no shell.
- The tests cover:
  - the ordering, stale-file removal and first-failure tests that already existed;
  - the new set-aside, replay and recreate behaviour, running chain-run.ts as its own process the way difftest does.
- No `/bin/sh` remains in scripts/ or harness/.

## Findings

1. **non-blocking (root, outside this lane's files): `README.md:59`** says
   `rustup toolchain install nightly-2026-10-11 --component rust-src`.
   - Following the documented setup now installs `rust-src`. With rustup's default profile it may also install
     `rust-docs`, `clippy-preview` and `rustfmt-preview`.
   - Either way, the new check would correctly fail every difftest and gate run on that host.
   - Fix the README to install exactly the pinned list, e.g. `--profile minimal --component rustc-dev,llvm-tools --target
     x86_64-unknown-linux-gnu`.
   - Before the next gate run there, confirm on the Windows host (AGENTS.md §5) that its oracle's `lib/rustlib/components`
     has the same six. If not, the pin needs a per-host list (handoff "For root" 2).
2. **non-blocking: `harness/library.ts:337-339`.** `utimesSync(dir, …)` is not guarded.
   - If it throws, `oracleLibRmeta` throws and every case of the lib suites fails. That could happen on a read-only or
     odd filesystem, if Windows directory utimes fails in Bun (untested here), or if `pruneStaleAux` removes the
     directory between `existsSync(out)` and the touch.
   - That race needs a directory already idle for over 3 days, so the window is microseconds.
   - This fails closed: it never passes a loss.
   - Suggest touching before the `existsSync` check and wrapping the touch in try/catch, since a missed touch only costs
     a rebuild.
3. **non-blocking: `harness/library.ts:282`.**
   - A process touches its directory once (memo). A single process that runs longer than `AUX_STALE_MS`, or a worktree
     idle for 3+ days on an old key, can have its directory pruned by a newer build.
   - The first is unrealistic. The second only costs a rebuild.
   - `aux/mini_core-*` and `aux/ui/*` are not pruned. That is fine as a follow-up.
4. **non-blocking: `scripts/lib/unit-steps.test.ts:23`** only checks `*.test.ts`.
   - Bun also discovers `*_test.ts`, `*.spec.ts` and `*_spec.ts`.
   - Today only `src/rustc_passes/abi_test.ts` and `layout_test.ts` match those patterns. They are ported modules, not
     tests, and they are under `src/`, as before.
   - A future runner test with one of those suffixes outside every root would go unnoticed.
5. **non-blocking: `scripts/probes.ts` `build`** does not run `verifyOracleToolchain`.
   - Probe binaries are built with the oracle toolchain. An extra component like `rust-src` should not change a normal
     cargo build.
   - The probes' outputs are covered at difftest time, since `verifyOraclePin` runs before any probe runs as the oracle.
   - Adding the check there would be cheap belt-and-braces.
