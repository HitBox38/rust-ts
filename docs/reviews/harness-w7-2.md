ACCEPT

# Review: harness-w7 fix round (`lane/harness-w7` at af98bdf)

Reviewer: review-hw7b (independent, read-only).
- The first review is `docs/reviews/harness-w7.md` on `lane/review-hw7`. Its verdict was ACCEPT-WITH-FIXES, with K1 MEDIUM, K2/K3 LOW and a request for a unit-test timeout.
- **Scope:**
  - The fix commits are e3c42bc (code) and af98bdf (handoff), reviewed as `git diff 6aadc50 af98bdf`.
  - 6aadc50 merges main ef0dc66 into 007c04b.
  - Files: `harness/compiletest.ts`, `scripts/difftest.ts`, `scripts/gate.ts`, `docs/handoff/harness-w7.md`.
- **The merge is clean:**
  - `git merge-tree --write-tree 007c04b ef0dc66` gives tree e5843036, which is exactly 6aadc50's tree. There is no hand-edited merge content.
  - `git diff 007c04b 6aadc50 -- harness scripts` is empty.
  - `git merge-tree main af98bdf` is also clean against main b4a5312.
- `bunx tsc --noEmit -p .` on the lane exits 0.

Summary: K1, K2, K3 and the timeout request are all fixed correctly. Only INFO notes remain (L1–L3). None of them blocks
protecting `parse-ui`/`parse-ui-json`.

## K1: `-O` for run-pass (fixed)
- **The fix:** `compiletest.ts:438-440` adds `-O` when `p.passFailMode === "run-pass"` and no compile flag is `-O` or contains `opt-level`.
  It sits after the `--check-cfg` push and before the `TestMode::Ui` block.
- **Upstream** (`runtest.rs:1735`): the check is `config.optimize_tests`, then `TestMode::Ui`, then
  `effective_pass_fail_mode() == Some(RunPass)` and `!compile_flags.any(arg == "-O" || arg.contains("opt-level"))`.
  It runs after `set_revision_flags`, which is the same position.
  - `effective_pass_fail_mode` (`runtest.rs:293`) differs from the declared mode only under `--pass`, which bootstrap does not pass for this run.
- **Bootstrap at the pin** (read from the pinned objects):
  - `config.rs:1565` has `rust_optimize_tests.unwrap_or(true)`.
  - `build_steps/test.rs:2659` passes `--optimize-tests`.
  - `bootstrap.example.toml:793` has `#rust.optimize-tests = true`.
  - Only the `*-nopt` CI images (`test-x86_64-gnu-nopt`, `test-i686-gnu-nopt`) pass `--disable-optimize-tests`. That supports "default on".
- **Argv:**
  - 38 files declare `run-pass`, and exactly 38 argvs carry `-O`, in both `parse-ui` and `parse-ui-json`.
  - `issue-48508.rs` (which has `-g`) and `crlf-in-byte-string-literal.rs` show `--check-cfg cfg(test,FALSE) -O --error-format json …`, which is compiletest's order.
- The header comment documents the bootstrap default.

## K2: what the subject did on ORACLE_TIMEOUT cases (fixed)
- **The fix:**
  - `difftest.ts:442-447` sets `r.subject` to one of `TIMEOUT`, `ICE` (exit 101), `UNPORTED: <what>` (exit 70) or `exit <code>`.
  - It also counts `oracleTimeoutSubjects`. The summary and the CLI `note:` line carry the counts.
  - The gate prints `(ORACLE_TIMEOUT; subject: …)`.
- **Never MATCH:** `classify` (`:356-363`) is unchanged and still tests `o.timedOut` first.
- **Never cached:**
  - `writeCached` is still reached only on success.
  - In single mode, `timedOut` is followed by `continue` (`:198-201`).
  - In batch mode, a timed-out singleton returns early (`:176-179`).
- A protected ORACLE_TIMEOUT case is still in `lost`, so the gate does not pass (`gate.ts:273`) and accept refuses it (`:296`, `:314`).

## K3: case generation as x86_64-unknown-linux-gnu (fixed)
- **What changed:**
  - `host()` now returns `target: COMPILETEST_TARGET` (`x86_64-unknown-linux-gnu`). `oracleHost()` is no longer imported.
  - `conditions()` evaluates every per-target, OS, env, ABI, arch, width, family, `thumb`, `i586`, `apple`, `elf` and `endian-big` condition, plus `needs-subprocess`, for that spec.
  - The spec comes from `--print=all-target-specs-json`, which is the same on every host.
  - `--target=` and `build/<target>/…` use the constant.
  - The run-mode `-o` is `…/a` with no suffix, matching `make_exe_name`'s `env::consts::EXE_SUFFIX` on a linux host (`runtest.rs:2036`).
  - No `process.platform` or `oracleHost` remains in `compiletest.ts`.
- **Still per-machine:**
  - `builtin_cfg_names` still runs `--print=check-cfg` with no `--target`. That is correct: upstream `common.rs:1143` passes none either, and only cfg *names* are used.
  - Absolute paths remain per machine: sysroot, cargo home, and `{{sysroot-base}}`/`{{rust-src-base}}`.
- **Consistent with D1:** `docs/plan-m2.md` §Decisions 1 fixes `x86_64-unknown-linux-gnu` for M2 suites; this applies the same target to the M1 `parse-ui` suites.
- **Is the oracle's output target-independent?**
  - I re-ran the oracle on all 991 cases of both suites with the lane argv, then again with only `--target`/out-dir swapped:
    - to `aarch64-apple-darwin`: 991/991 identical in each format;
    - to `riscv64gc-unknown-linux-gnu`, which has no rust-std installed: 991/991 identical in each format.
  - The comparison covered exit code, stdout and stderr, with the triple normalized.
  - So `-Zparse-crate-root-only` output does not depend on the target, or on whether its std is installed.
- **Case lists of the existing suites are unchanged vs main** (main b4a5312 vs the lane worktree):
  - Hashes are `sha256(JSON.stringify(x))[:16]` over `cases()`, all oracle argvs (each case's in single mode, the whole batch in batch mode) and all subject argvs. The repo-root path is normalized for the subject argvs.
  - All are identical for lex, escape, symbols, escape-synthetic, fluent-parse, fluent-format, emit, tokens, tokens-str and parse.
  - Case hashes match the first review's (lex/escape `a8a356bd10b8a7b6`, parse `b244fb01ad2573be`, emit `1bf53fe82cb7084a`, tokens `ecb7ce76882d03ee`, …).
  - Oracle argv hashes, e.g. parse `77a58f68f044e058` and lex `7e2a5125efb5a2da`, are equal on both sides.
  - Modes and `timeoutMs` are unchanged. Only parse's `oracleTimeoutMs: 300000` differs from main; it came from the first batch, which was already reviewed.
- **parse-ui ids vs 007c04b:**
  - There are 991 cases in each suite, with ids hash `b5836ccdfaaa8180` on both 007c04b and af98bdf.
  - The same 8 tests are skipped: 4 proc-macro aux, 3 `ignore-auxiliary` and 1 `only-windows`. Only the reason text changed ("on x86_64-unknown-linux-gnu").
  - The oracle cache key includes `c.args`, so the new argv (`-O`, `--target`) re-keys these suites. No stale entries are reused.
- **The gate's labelling cannot mask a loss:**
  - `lost` is still `base − MATCH` (`gate.ts:248`). The `ERROR:` line, `pass` (`:273`) and accept (`:296`, `:314`) depend only on `lost`.
  - `lostSkipped` and the `why()` label are output only.
  - `why()` checks `skipped()` before the result's status. That could mislabel only an id that is both a case and skipped, and the overlap is 0 in both suites.
  - Even then, the id would still be lost and the gate would still fail.

## Unit-test timeout (fine)
- `--timeout=60000` sets only Bun's default per-test timeout. The `CI=true` env, the junit reporter and the skip allowlist check (`junitSkips`/`classifySkips`) are unchanged.
- I checked this with Bun 1.4.3 on scratch tests:
  - a test over the timeout still fails the run (exit 1);
  - `test.skip` still appears as a junit `<skipped>`;
  - a `.only` under `CI=true` still exits 1 with `--timeout=60000`.

## Other changes in the round
- **K6, `{{rust-src-base}}`:**
  - No check that the directory exists, then `readlinkSync` with fallback.
  - This equals `directives.rs:765-769`: `try_exists().expect` panics only on an IO error, then `read_link_utf8().unwrap_or(src_base)`.
- **K6, `remap-src-base`:** it now rejects with a reason instead of emitting a remap that could never match. No test at the pin uses it, and the case ids are unchanged.
- **Nothing else changed:**
  - `git diff main...af98bdf` touches no `harness/baseline/`, `docs/state/`, `src/` or `tools/` file.
  - The lane worktree is clean.

## Findings (INFO only)
- **L1 (INFO): the gate's lost-case label is now misleading.**
  - The label reads `(not applicable on this host: …)`, but compiletest skips no longer depend on the host.
  - A lost skipped id now means the case set changed, through an upstream directive or a harness change.
  - Wording only; no effect on pass or fail.
- **L2 (INFO): the `ok` bucket of `oracleTimeoutSubjects` is broader than its name.**
  - It means "neither timeout, ICE nor UNPORTED", so it includes any exit code, e.g. 1. It does not mean the subject matched.
  - The per-case `subject` field has the exact exit code.
- **L3 (INFO): D1 has not been recorded for parse-ui.**
  - D1 is recorded for M2 suites. Root may want a one-line decision extending it to `parse-ui`/`parse-ui-json`.
  - The decision should note that these suites' oracle cache keys stay per-machine, because the argv contains absolute sysroot and cargo-home paths.

## Spot-run (from the lane worktree)
- `RUST_TS_AGENT=review-hw7b bun scripts/difftest.ts --suite parse-ui --sample 100` gave UNPORTED 100, skipped=8, ORACLE_TIMEOUT 0.
- Run `20261013-024808-review-hw7b-puf6`. Of the 100 UNPORTED cases:
  - 95 are `rustc_interface::interface::parse_check_cfg (--check-cfg=cfg(test,FALSE))`;
  - 5 are `parse_cfg (--cfg=<rev>)`.
