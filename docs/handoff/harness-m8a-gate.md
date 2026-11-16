# Handoff: harness-m8a-gate (M8 wave 41, step 3; harness/scripts batch, needs its own independent review)

Branch `t3/gate-oracle-guard-headroom`, based on main `c3a5c9ac`. Plan: `docs/plan-m8.md` D2, D9 (ENV), D18–D21, D23, §6, §8
wave 41. No ported upstream code: no coverage numbers, no `// rustc:` markers, no `unported(...)`. Baselines, oracle outputs and
suite definitions are untouched; **no suite is registered or changed** (`cargo-build`/`cargo-smoke` are `harness-m8a-build`'s, the
clippy suites `harness-m8d`'s). Nothing under `src/`, `scripts/coverage.ts` or `harness/scope.json` is touched.

## Files touched
- `UPSTREAM.json`: `rust.tools.{clippy,rustfmt}: { url, sha256 }`.
- `scripts/lib/common.ts`: `UpstreamPin.tools` (type only).
- `scripts/lib/tool-oracles.ts` (new, node-only): layout, paths, the guard (`toolGuardErrors`), `toolArgs` (`--sysroot`),
  `toolEnv`, `toolOracleKeyOf`.
- `scripts/lib/oracle.ts`: `toolPinsOrDie`, `HOST_TOOL_GUARD_IO`, `verifyToolOracles`, `toolOracleCmd`, `toolSubjectArgs`,
  `toolOracleEnv`, `toolOracleKey` (all new; nothing existing changed).
- `scripts/tools.ts` (new): `setup [--from <dir>]`, `check`.
- `scripts/lib/headroom.ts` (new, node-only): D20's table, `readHeadroom`, `headroomRefusal`, watchdog stop records.
- `scripts/lib/host-state.ts`: `HostReaders` gains optional `freeBytes(path)` and `vmPressure()`; `REAL_HOST` implements them.
  Nothing in host-state.ts reads them (it stays a report).
- `scripts/lib/protect.ts` (new, node-only): `neverProtectBaselineErrors`, `matchIdsOfJsonl`, `planAccept`.
- `harness/suites.ts`: `Suite` gains `neverProtect?: string`, `headroom?: HeadroomClass`, `envOracle?(r)` (fields and docs only).
- `scripts/difftest.ts`: status `ENV`, `oracleEnv`, `classify`, cache handling, `criterionOf`, a mode check, a `note:` line.
- `scripts/gate.ts`: neverProtect refusal (run and accept), per-suite headroom check, watchdog-stop handling, `stop`, ENV lists,
  accept through `planAccept`; `GateHost.baselineDir` (tests only).
- `scripts/criteria.ts`: ENV out of non-`allCases` denominators.
- Tests (new): `scripts/lib/tool-oracles.test.ts`, `scripts/lib/headroom.test.ts`, `scripts/lib/protect.test.ts`,
  `scripts/difftest-env.test.ts`, `scripts/gate-headroom.test.ts`; one test added to `scripts/criteria.test.ts`.

## 1. D2: tool oracles and guard
- `UPSTREAM.json` `rust.tools` holds the 2026-10-11 channel manifest's `xz_url`/`xz_hash` for `clippy-preview` and
  `rustfmt-preview` (aarch64-apple-darwin), read from the plan's saved manifest (`$RUST_TS_DATA/tmp/plan-m8/dl/channel.toml`);
  the hashes equal the plan's (`08d0af9f…`, `3ed6326d…`) and the downloaded tarballs'.
- `bun scripts/tools.ts setup` downloads each tarball with `/usr/bin/curl` (the only networked step), checks its SHA-256, unpacks it
  in a temp directory under `$RUST_TS_DATA/tools/` and renames that to `tools/<sha256>/` (tarball kept beside its tree). A tool
  already set up with the pinned hash is kept. The oracle toolchain's component check runs before and after. No rustup call.
  `--from <dir>` takes the tarballs from a local directory instead (hash still checked).
- **The guard** (`toolGuardErrors`), per tool:
  - the kept tarball's SHA-256 is the pin's;
  - each binary that links `librustc_driver` (`clippy-driver`, `cargo-clippy`, `rustfmt`; `cargo-fmt` links none) is byte for
    byte the tarball's (`tar -xOf`);
  - the tarball's `git-commit-hash` is `PIN.commit`;
  - `otool -L` shows exactly one `@rpath/librustc_driver-<hash>.dylib`, and that file is in `<oracle sysroot>/lib`.

  The guard test also runs `oracleToolchainError` (exactly UPSTREAM.json's components, no `rustlib/src`).
- **Oracle key**: `toolOracleKey(tool)` = `{ tool, tarballSha256, rustcDriver: rustcDriverHash() }`. It is the suite's `oracleKey`
  for `harness-m8d` to use.
- **`--sysroot`**: `toolArgs` puts one `--sysroot=<oracle sysroot>` first on both sides (`toolOracleCmd`, `toolSubjectArgs`), and
  throws if the case's arguments already name one. **Decision:** only clippy gets it. rustfmt has no `--sysroot` flag (it would
  reject one) and loads no crate, so `TOOL_LAYOUT.rustfmt.sysrootFlag` is false.
- Run check (here): `clippy-driver --sysroot=… --version` → `clippy 0.1.101 (6f5da406b5 2026-10-10)`, `-vV` →
  `rustc 1.101.0-nightly (6f5da406b …)`, `rustfmt --version` → `rustfmt 1.11.0-nightly (6f5da406b5 2026-10-10)`, all with
  `DYLD_LIBRARY_PATH=<oracle>/lib`.
- **I ran `bun scripts/tools.ts setup --from $RUST_TS_DATA/tmp/recheck-plan-m8/dl`** on the root host's data dir (24 MB under
  `.data/tools/`), and the network path once into a scratch data dir (both passed the guard; the scratch one is deleted). The
  guard test **fails under `RUST_TS_REQUIRE_PROBES=1` (every gate) if the tools are not set up**, and skips otherwise. On a fresh
  data dir root must run `bun scripts/tools.ts setup` before the gate.

## 2. D19: "never protected" made mechanical
- `Suite.neverProtect?: string` holds the recorded decision behind it.
  - **`gate run`** refuses to start while any registered `neverProtect` suite has `harness/baseline/<name>.txt`. It checks every
    registered suite, not only the requested ones, prints one `ERROR:` line per suite, and writes no gate.json. A `neverProtect`
    suite that runs prints a `note:` that it is a report.
  - **`gate accept`** refuses the same way, and skips such a suite's matches with a `note:` whatever the run's suites were
    (`planAccept`: its baseline and matches are never read and nothing is written for it).
- **ENV** is a new difftest status. `Suite.envOracle(r)` reads the oracle's own `{stdout, stderr, code}`:
  - flagged on a fresh oracle run, the oracle is run once more (`oracleEnv`). Flagged both times gives ENV, with the first run's
    reason. Flagged once, or the second run timed out, gives UNSTABLE.
  - ENV and these UNSTABLE outputs are never cached. A cached entry that `envOracle` flags is removed and re-run, as an
    unstable-pattern entry is.
  - `classify` returns ENV right after ORACLE_TIMEOUT/UNSTABLE, from the oracle output alone.
  - Single mode only: difftest refuses `envOracle` on a batch or split suite. Split support (per section, e.g. for
    `cargo-testsuite`) is left to `harness-m8c` if it needs it.
  - `matchesOfRun` now uses `matchIdsOfJsonl` (MATCH only, as before).
  - ENV is out of `criterionOf`'s denominator and out of `criteria.ts`'s for every non-`allCases` group. gate.json lists a suite's
    ENV ids (`env`) only when there are any, so today's gate.json is unchanged.
  - The summary line gains `ENV=0` (a new status in `STATUSES`, last).

## 3. D20: the gate's headroom logic
- `HEADROOM_MINIMUMS`:
  - `heavy-build`: 20 GiB free on the data volume and swap under 4 GiB;
  - `testsuite`: 10 GiB free, no swap rule.

  Free disk is `statfs(<RUST_TS_DATA>)` `bavail*bsize` (equals `df`), swap is `vm.swapusage`, pressure is
  `kern.memorystatus_vm_pressure_level`.
- **Decision (for the reviewer):** every class also refuses at critical memory pressure (level 4). D20's table names only disk and
  swap, but the brief lists memory pressure among the readers, and a host at critical has no room for a 12 GiB compile.
- **Fail closed:** a reader that is missing, fails, throws or hangs (6 s limit) fails the rule that needs it. Today's real host
  (about 12–15 GiB free, about 8.2 GiB swap) fails `heavy-build` on both rules.
- **In `gateRun`**, for a suite with `Suite.headroom`, the check runs right before the suite (after the Bun check):
  - On failure, if the suite is `neverProtect`: a `note:`, the suite goes into `notRun`, and the gate goes on (D20/D23).
  - Otherwise the gate **stops**: one `ERROR:` line, gate.json `stop: {suite, kind: "headroom", reason}`, that suite and all
    later ones go into `notRun`, none of their cases is scored, and `pass: false` (exit 1).
  - gate.json `headroom` records each check's reading.
- **Watchdog stop**:
  - **Interface for `harness-m8a-build`:** the watchdog, right after it kills a build's process group, calls
    `recordWatchdogStop(watchdogStopDir(DATA), {at, pid, what, reason})`. That writes one JSON file, atomically, to
    `$RUST_TS_DATA/watchdog-stops/`.
  - After each suite the gate reads the records dated at or after the suite's start (`watchdogStopsSince`). Any record stops the
    gate the same way (`kind: "watchdog"`); the suite's results are not scored, so nothing is lost.
  - **Decision:** a watchdog stop stops the gate even in a `neverProtect` suite, because it means the host hit the 4 GiB floor or
    critical pressure.
  - A record that cannot be read counts as a stop at its file's modification time.
- **`accept`** refuses any run with a `stop` (checked first, naming suite and reason), besides `pass: false`.
- **Not in this batch**:
  - the watchdog itself;
  - `cargo-build` first in order (a suite field, `harness-m8a-build`);
  - the AC/`GATE_RUNNING` preconditions for non-gate runs (the project-build harness; `headroomRefusal` is reusable there).
- Note for root: the default `gate run` runs only suites with a baseline file, so a `neverProtect` suite runs only when
  `--suites` names it (as report suites are run today).

## 4. Tests added (all in the runner unit step)
- `scripts/lib/protect.test.ts` (D19):
  - accept skips a `neverProtect` suite's matches and never reads its baseline;
  - a run of only such a suite grows nothing;
  - the refusal lines for a `neverProtect` suite with a baseline;
  - `matchIdsOfJsonl` never returns ENV (nor UNSTABLE/ORACLE_TIMEOUT/DIFF);
  - loss and unstable refusals still apply.
- `scripts/difftest-env.test.ts`, a real `difftest()` in a child:
  - ENV on two oracle runs, even when the subject prints the oracle's exact output;
  - flagged once gives UNSTABLE;
  - a skip on the subject side alone is DIFF;
  - oracle run counts prove ENV is never cached;
  - the criterion leaves ENV out;
  - `classify` over 12 subject outcomes never yields ENV unless the oracle is ENV, and always does when it is;
  - a batch suite with `envOracle` is refused before the oracle runs.
- `scripts/lib/headroom.test.ts`:
  - the table;
  - each rule at its edge, plus the combined line;
  - no swap rule for `testsuite`;
  - missing, failed, throwing and hanging readers fail closed;
  - `parseVmPressure`;
  - watchdog records: since-filtering and order, unreadable and undated records.
- `scripts/gate-headroom.test.ts`, a real `gateRun` in a child on fake readers:
  - a failed check before a covered suite: `pass: false`, the reason named, the rest `notRun`, no lost case, exit 1, and
    `accept` refuses;
  - critical pressure fails the check;
  - a watchdog stop during a covered suite with a protected case that would be lost: not scored, nothing lost, the rest not run,
    and `accept` refuses;
  - a failed check before a `neverProtect` suite: not run, the gate passes;
  - enough headroom: the suite runs and the reading is recorded;
  - a suite with no `headroom` field is unchecked even at 0 GiB free and critical pressure (today's behaviour);
  - `gate run` refuses a `neverProtect` suite that has a baseline file.
- `scripts/lib/tool-oracles.test.ts`:
  - `parseOtoolDylibs` and `driverLinkError`;
  - `toolArgs`: exactly one `--sysroot`, the oracle's, and none for rustfmt;
  - the key changes with either hash;
  - the guard on fake trees: OK, not set up, wrong tarball hash, replaced and missing binary, wrong commit, wrong, absent or
    unreadable driver;
  - the pins equal the manifest's;
  - the real guard plus the oracle components check (skips without setup, fails under `RUST_TS_REQUIRE_PROBES=1`).
- `scripts/criteria.test.ts`: ENV leaves non-`allCases` denominators and is counted; an `allCases` group counts it.
- **D13 budget**: the new files take 4.1 s of the runner step (gate-headroom 2.9, tool-oracles 0.6, difftest-env 0.5, rest
  < 0.1), under 10 s.

## 5. Proof that today's 71 protected suites are unchanged
- **Oracle keys**: `bun scripts/oracle-keys.ts` over every registered suite (86 suites), before any edit and after: 391,641 keys,
  both dumps sha1 `709292dbcf918cb58021c15b834b1ce1427e8c9f`, `cmp` identical.
- No registered suite sets `neverProtect`, `headroom` or `envOracle` (checked by loading `SUITES`).
- Sample difftests (`RUST_TS_AGENT=harness-m8a-gate`): `tokens-str` all 39 MATCH (39 protected); `check-ui --sample 150` 150/150
  MATCH (all protected); `ENV=0` on both (runs `m8a-gate-sample-*` under `$RUST_TS_DATA/runs/`).
- The existing gate tests (`gate-power`, `gate-static-stop`, `gate-probes`, `gate-unit`, `gate-bun`), `host-state`, `toolchain`,
  `criteria`, `unstable`, `miri`, `deps`, `unit-steps` (the env-read and common.ts-loader scans included) all pass.
- `bunx tsc --noEmit -p .`: clean.
- Full runner step (`bun test ./scripts ./harness`, `RUST_TS_REQUIRE_PROBES=1 CI=true`, one process): 636 pass, 0 skipped,
  **1 fail that is not this batch's**: `harness/m7d-suites.test.ts` "M7d's suites: report only…" expects no baseline for
  `rg-build`, `rg-behaviour`, `pm-self`…, which M7d's accept created. It fails the same way on the main checkout, so it needs a
  fix in another batch.

## 6. For root / integration
- After merging, on any data dir without them: `bun scripts/tools.ts setup` (network, about 4.3 MB of download). The root host's
  `.data/tools/` is already set up.
- `UPSTREAM.json` is also edited by `tools-prep-m8` (D3: `sparse`, cargo pin): expect a textual merge in `rust`, not a semantic
  conflict.
- `harness-m8d`: use `toolOracleCmd`/`toolSubjectArgs`/`toolOracleEnv`/`toolOracleKey` and call `verifyToolOracles()` before cases.
  `gate.ts undeclaredRuns` does not yet accept a tool binary as an oracle program. That belongs with the first suite that runs one
  (e.g. a `Suite.tools` field, checked like `probes`).
- `harness-m8a-build`: register `cargo-build`/`cargo-smoke` with `neverProtect` and `headroom: "heavy-build"`, and have the
  watchdog call `recordWatchdogStop`.
- `harness-m8c`: `cargo-testsuite` with `headroom: "testsuite"`; ENV per test needs `envOracle` support in whatever mode it uses
  (single is supported now).
