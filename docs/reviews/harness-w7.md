ACCEPT-WITH-FIXES

# Review: harness batch `harness-w7` (007c04b on `lane/harness-w7`)

Reviewer: review-hw7 (independent, read-only).
- Scope: `git diff main...lane/harness-w7`, base 5659298. Files: `harness/compiletest.ts` (new),
  `harness/suites.ts`, `scripts/{difftest,gate,probes}.ts`, `scripts/lib/common.ts` and the handoff.
- Since the base, main has moved to 6292772 (review-parser-b). That move touches no `harness/` or `scripts/` file.
  `git merge-tree main lane/harness-w7` is clean.
- `bunx tsc --noEmit -p .` on the lane exits 0.
- Upstream sources:
  - compiletest is read from `$RUST_TS_DATA/rust/src/tools/compiletest/src` at the pin.
  - Bootstrap is not in the sparse checkout. I read it from the pinned commit's objects with
    `git show HEAD:src/bootstrap/...`.

Summary:
- The directive parsing, ignore evaluation and argv construction follow compiletest closely, with one exception (K1).
- The ORACLE_TIMEOUT and J1 changes do what the handoff says. K2 and K3 are small reporting gaps.
- No case list, baseline or existing cache key changes.

Fix before `parse-ui`/`parse-ui-json` is protected: **K1**. K2 and K3 can be follow-ups.

## Findings

### K1 (MEDIUM): `run-pass` cases lack compiletest's `-O`
- **Where:** `harness/compiletest.ts:414-424`. It should come after `set_revision_flags` and before the
  `TestMode::Ui` block.
- **Upstream:**
  - `runtest.rs:1735` `make_compile_args`: if `config.optimize_tests` is set, the compile is a `Ui` compile,
    `effective_pass_fail_mode() == Some(RunPass)`, and no compile flag is `-O` or contains `opt-level`, then
    compiletest adds `-O`.
  - It goes right after `--cfg/--check-cfg` and before `--error-format json`.
  - Bootstrap always enables it by default:
    - `src/bootstrap/src/core/config/config.rs:1565` sets `rust_optimize_tests: rust_optimize_tests.unwrap_or(true)`;
    - `build_steps/test.rs:2659` passes `--optimize-tests` when it is set.
- **Scenario:**
  - It affects all 38 `run-pass` cases in the suites (none sets `-O` or `opt-level`).
  - Examples: `tests/ui/parser/issues/issue-48508.rs` and `tests/ui/lexer/crlf-in-byte-string-literal.rs`.
  - Their argv is not compiletest's. The handoff says `parse-ui-json` "keeps the exact argv"; it does not for these cases.
- **Impact today: none on output.**
  - I re-ran the oracle on all 38 cases with and without `-O`, inserted where compiletest puts it, with the case's env.
  - The output (exit code, stdout and stderr) was identical 38/38. `-Zparse-crate-root-only` stops before anything `-O` influences.
- **Impact later: real.**
  - `-O` turns `cfg(debug_assertions)` off, because `-Cdebug-assertions` defaults to `!optimize`.
  - So once `compiletest.ts` is reused past parsing (M2 `ui-expanded`), cfg-stripping and the output change.
  - Fixing it now also avoids re-keying a protected suite's oracle cache later.
- **Fix:**
  ```ts
  // optimize_tests (bootstrap default rust.optimize-tests = true), TestMode::Ui:
  if (p.passFailMode === "run-pass" && !p.compileFlags.some((f) => f === "-O" || f.includes("opt-level"))) a.push("-O");
  ```
  - Put it right after the `--check-cfg` push.
  - With no `--pass`, `effective_pass_fail_mode()` is the declared mode, which is what `p.passFailMode` holds.
  - Add bootstrap's default to the header comment next to `-Crpath -Cdebuginfo=0`.

### K2 (LOW): ORACLE_TIMEOUT hides the subject's own failure
- **Where:** `scripts/difftest.ts:343-345` (`classify`) and `:421-425` (the result record).
- **Scenario:**
  - `classify(oracle timed out, subject exit 101)` returns `ORACLE_TIMEOUT`. So does `classify(oracle timed out, subject timed out)`. I verified both by calling `classify`.
  - The `<suite>.jsonl` record has no `first`/`unported` field for this status.
  - `summary.json` and the gate therefore never learn that the subject crashed (ICE) or hung on that case.
  - The diff file (written while fewer than 500 diffs have been written) does show the subject's exit code.
- **Not a correctness hole:**
  - The status is never MATCH.
  - It is never cached: only the success path calls `writeCached`, in both single and batch mode.
  - A protected case with this status is still counted as lost.
- **Fix:** record the subject side for ORACLE_TIMEOUT cases, e.g. `r.subject = sc.timedOut ? "TIMEOUT" : \`exit ${sc.code}\``.
  The gate could also print it next to the `(ORACLE_TIMEOUT)` label.

### K3 (LOW): the case set depends on the host, and the gate does not say why a skipped protected case is lost
- **Where:** `harness/compiletest.ts:229-275` and `:432-435`, and `scripts/gate.ts:244-250`.
- **What varies with the host:**
  - `ignore-*`/`only-*` are evaluated against the oracle host. Today that skips
    `tests/ui/parser/mod_file_not_exist_windows.rs` (`only-windows`) here, but runs it on Windows.
  - `--target=<host>` is part of the argv.
  - Run-mode cases get `-o …/a.exe` on Windows.
- **Scenario:**
  - The protected set grows on Windows (the host AGENTS.md §5 describes), and the gate later runs on this macOS host.
  - The case is now in `skipped`, so it is not a result. The gate reports a bare `lost: …` with no reason.
  - The ORACLE_TIMEOUT label added in this batch does not cover it.
  - The gate fails loudly, but whoever reads it has to find out why.
- **Fix, either of:**
  - the gate labels lost ids that the suite reports in `skipped()` (`(skipped: <reason>)`);
  - root records a decision on which host grows `parse-ui` baselines.
- M2 suites avoid this with the fixed `--target` (D1). `parse-ui` cannot, because compiletest uses the host.

### K4 (INFO): the cold-cache wall time of `deep-try-chain` can exceed the retry ceiling
- The handoff measured 203 s of CPU but 1288 s of wall time at load ~100.
- The ceiling is 300 s, then one retry at 1200 s, so a cold-cache oracle run under similar load would be ORACLE_TIMEOUT.
- Once the case is protected, the gate would fail on it, loudly and correctly.
- The entry is cached now. My spot-run read it from the cache: MATCH 1/1 in 41 s wall.
- The cost comes back only when `rustcDriverHash` changes (toolchain reinstall), so warming the cache on an idle machine after a reinstall is enough.
- The retry is bounded: `runOnce` runs at most 2 processes, so one case costs at most 5× its timeout. The subject's `timeoutMs` (60 s) is unchanged.

### K5 (INFO): skip reasons are honest but sometimes less specific than compiletest's
- **Where:** `harness/compiletest.ts:290-324` and `:510-514`.
- **Per line:** compiletest runs every `decision!` and records the reason. The port returns at the first decision on a line.
- **Comments dropped:** reasons omit compiletest's `(comment)` remark. For example `ignored used by another main test file`
  has no remark.
- **Later throws win:** an `ignore-*` that already matched can be overtaken by an unevaluable directive on a later line.
  The `Reject` throws, and the reason becomes "not evaluated" instead of "ignored".
- Either way the test is not run, so the case set is unaffected.
- All 8 skips at the pin have correct reasons: 4 `proc-macro` aux, 3 `ignore-auxiliary`, 1 `only-windows`.

### K6 (INFO): notes for reusing `compiletest.ts` outside these directories (none applies at the pin)
- **`{{rust-src-base}}`** (`:121-125`) differs from upstream in two ways:
  - Upstream does not fail when the directory is missing (`try_exists().expect` only panics on an IO error).
  - Upstream resolves a symlink (`read_link_utf8`).
- **`remap-src-base`** (`:426`) remaps the absolute `tests/ui` path. But the input path is relative (decision 3), so the
  prefix would never match. Such a test would need the absolute input path.
- **`force-host`** is parsed but not used. That is correct only while host == target.

### K7 (INFO): J1 residual, beyond what the handoff lists
- Cargo's auto-discovery (`build.rs`, `src/bin/*`) works in the package directory `$RUST_TS_DATA/probes/<name>`.
- The harness writes only `Cargo.toml` (and `Cargo.lock`) there, so this is not reachable from the repo. Nothing to fix.

## What I checked

### 1. `parse-ui` / `parse-ui-json` against compiletest at the pin
- **Collection** (`lib.rs:293` `collect_tests_from_dir`, `:391` `is_test`):
  - `compiletest-ignore-dir` and `auxiliary/` dirs are skipped, as are `.rs` names starting with `.`, `#` or `~`.
  - It matches. `tests/ui/unicode` does not exist at the pin.
  - No file in the three directories starts with a BOM. A BOM is the only character where JS `trim` and Rust `trim` differ.
- **Directive lines** (`directives/line.rs` `line_directive`, `directives/file.rs`):
  - trimming;
  - skipping `#![no_std]`/`#![no_core]`;
  - `//@[rev]` with whitespace after `]`;
  - a comma in the revision is rejected;
  - the name ends at `:` or space.
  All match.
- **Values:**
  - `parse_name_value_directive`: colon required, variables expanded, empty values rejected.
  - `parse_name_directive`: a colon is rejected.
  - `set_name_directive` short-circuits; `||=` does the same.
  - `split_flags` uses single quotes.
  All match.
- **Editions** (`parse_edition_range`, `edition_to_test(None)`, `load_from`'s `--edition=` at index 0):
  - All match, including `future` and the rejected `..X` / `..` forms.
  - Checked cases:
    - `2015..2021` gives 2015 (`trait-object-polytrait-priority.rs`);
    - `2021..` gives 2021 (`decl-macro-matching.rs`);
    - `//@[e2021] edition: 2021` (`trait-object-lifetime-parens.rs#e2021`).
- **Revisions:**
  - `EarlyProps` reads every line for the case list. Duplicates and `true`/`false` are rejected.
  - `TestProps.revisions` uses only the lines that apply, which feeds `--check-cfg`.
  - `set_revision_flags`:
    - lowercases and replaces `-` with `_`;
    - rejects a redundant `--cfg`/`--cfg=`;
    - rejects a collision with `builtin_cfg_names` (`--print=check-cfg` plus `test`);
    - `--check-cfg cfg(test,FALSE,<revs>)` is skipped under `no-auto-check-cfg`.
  - All match. Ids are `<file>#<rev>`, as in compiletest's test names. There are 15 revision cases from 6 files.
- **`ignore-`/`only-`/`needs-`:**
  - `prepare_conditions` is reproduced in compiletest's order, so the first registration wins:
    - per-target, OS, env, OS-env, ABI, arch plus `spirv`, pointer width and family;
    - `thumb`, `i586`, `apple`, `elf`, channel, `cross-compile`, `endian-big`;
    - all 4 compare modes, coverage modes, `rustc_abi-*`, `dist`.
  - `TargetCfg` serde defaults match `common.rs:1072-1133`: `os = "none"`, `binary-format = "elf"`, kebab-case keys.
  - The external ignore/only lists match `cfg.rs:9-27`. `needs-subprocess` matches `has_subprocess_support`.
  - `ignore-backends`/`needs-backends` use llvm as the default backend.
  - `ignore_unsupported_backend_target` (GCC only) and `ignore_parallel_frontend` (threads default to 1,
    `common.rs:787`) are correctly no-ops.
  - Conditions that depend on stage, debug assertions, LLVM, Enzyme or wasm-proc-macros, and every other `needs-*`,
    skip with a reason. That is honest; nothing is guessed.
  - Every directive used in the three directories is either handled or irrelevant to the main compile argv:
    `run-rustfix`, `edition`, `check-pass`, `run-pass`, `compile-flags`, `reference`, `revisions`, `ignore-backends`,
    `dont-require-annotations`, `proc-macro`, `build-pass`, `normalize-stderr`, `ignore-auxiliary`,
    `rustfix-only-machine-applicable`, `check-fail`, `rustc-env`, `run-fail`, `only-windows`, `needs-subprocess`,
    `error-pattern`.
- **Default flags** (`make_compile_args`, `runtest.rs:1629-2021`):
  - order: input, simulate-remapped/translate, the two `ignore-directory-in-diagnostics-source-blocks`
    (cargo home, `<src>/vendor`), `--sysroot` unless the test sets it, `--target=` unless the test sets it, revision
    flags, `[-O]` (**K1**), the Ui block (`--error-format json --json future-incompat` unless set, `-Ccodegen-units=1
    -Zui-testing -Zdeduplicate-diagnostics=no -Zwrite-long-types-to-disk=no -Cstrip=debuginfo`), remap, `--emit
    metadata` for check modes (`run_ui_test` `is_check`), `-C prefer-dynamic` unless `no-prefer-dynamic`, then the
    output;
  - output: `-o …/a[.exe]` for run modes (`run_enabled`: not fuchsia), else `--out-dir`, and nothing if the test passes `-o`;
  - then `-Znext-solver=coherence`, `-A unused -W unused_attributes` unless the declared mode is run-pass, the four
    allows, the target rustcflags (with debug flags dropped when the test sets `-g`/`-Cdebuginfo=`/`debuginfo=`), and
    the compile flags.
  - Everything except K1 matches.
  - `TestProps::new` env is `RUSTC_ICE=0`, `RUST_BACKTRACE=short`, unset `RUSTC_LOG_COLOR`, and
    `compose_and_run_compiler` sets, then unsets. Both match.
  - Bootstrap's target rustcflags are `-Crpath -Cdebuginfo=<debuginfo-level-tests, default None = 0>` and `-Lnative=<helpers>`.
    The omitted `-Lnative` is documented.
  - Bootstrap sets no env that reaches rustc output.
- **Spot-check of 20 argv** (json format):
  - The cases:
    - `fence-unclosed-3`, `lex-bad-str-literal-as-char-3#rust2021`, `attr-unquoted-ident`, `bounds-type`;
    - `dyn-2015-identifier#fail`, `encode-symbol-ice-12920` (run-fail), `f16b-repr-simd` (build-pass);
    - `decl-macro-matching`, `impls-nested-within-fns-semantic-1`, `issue-105209` (`-Zunpretty=ast-tree`),
      `issue-107705`, `issue-48508` (run-pass, `-g`);
    - `or-in-let-chain#edition2021`, `raw-idents#e2024`, `survive-peano-lesson-queue` (`rustc-env`),
      `trait-object-polytrait-priority`;
    - `extern-crate-async` (check-pass), `float-literals` (build-pass), `trait-object-lifetime-parens#e2021`,
      `crlf-in-byte-string-literal` (run-pass).
  - Result: 18 match compiletest exactly, apart from the documented deviations (relative input and out-dir, no `-Lnative`).
  - The 2 run-pass cases lack `-O` (K1).
- **Human format (decision 1):**
  - compiletest compares `.stderr` with the JSON `rendered` text, which is the human emitter's output, so `parse-ui`
    tests the text the `.stderr` files hold. Both sides get the same argv, so the comparison is fair.
  - `parse-ui-json` is compiletest's argv, apart from K1 and the documented path and `-Lnative` deviations.
  - On a seeded sample of 55 cases (40 random plus all 15 revisions), the oracle's stderr after `$DIR`/tab normalization:
    - equals `.stderr` in 31;
    - has no `.stderr` file and no output in 11;
    - is a subset of `.stderr` (later-phase errors) in 14;
    - differs in the rest only by compiletest's `//~` annotation stripping, which I did not apply (I checked 3 by hand).
  - This agrees with the handoff's full-suite numbers.
- **`-Zparse-crate-root-only`:**
  - `rustc_driver_impl/src/lib.rs:299` returns after `passes::parse` and after the `-Zunpretty` branch, so
    `issue-105209`'s `-Zunpretty=ast-tree` still prints.
  - `config.rs:2455` ignores `--emit`, and `will_create_output_file` is false.
  - Nothing appears under `$RUST_TS_DATA/rust/build` after the runs.
  - Out-of-line modules are loaded during expansion, so the case's file hash is enough for the cache key.

### 2. ORACLE_TIMEOUT
- **Status rules:**
  - `classify` checks it first, so it is never MATCH and never DIFF (checked by calling `classify`).
  - It is never cached: `writeCached` runs only on the success path, in single and batch mode.
  - Cache entries from before this batch never held a timed-out output (`if (!r.timedOut) writeCached`).
- **Retry:** `runOnce` makes at most 2 runs. Batch splitting reaches single files, which use `runOnce`. Other oracle failures still throw.
- **The oracle-only timeout:**
  - `oracleTimeoutMs` is read only in `runOracle`. `runSubject` still uses `s.timeoutMs`.
  - The cache key has no timeout in it, so `parse` keys are unchanged.
  - Case env joins the key only when present.
- **Gate:**
  - `match` excludes ORACLE_TIMEOUT, so a protected case with it is in `lost` (now labeled), `pass` is false, and `accept` refuses.
  - It can never be "gained". `oracleTimeouts` is recorded per suite.
  - The subject-side gap is K2.
- **Env plumbing:**
  - `run()` deletes `null` vars, and the subject gets `{...case.env, RUST_TS_IMPL}`.
  - Batch suites with case env are refused.
  - Only `difftest.ts` consumes `Suite.oracle`/`subject` (plus `gate.ts:62` for probe detection).

### 3. J1 allowlist
- All 12 probes pass `probeMeta` on the lane. Only tokdump is rustc-dev, and its env is empty. emitdump and symdump keep their env.
- `rustcDevManifestViolations` refuses everything outside the allowlist I tried:
  - tables: `[profile]`, `[features]`, `[badges]`, `[[example]]`, `[[test]]`, `[[bench]]`, `[lints]`, `[target.*]`;
  - other metadata: `package.metadata.docs`, `workspace.package`;
  - package keys: `package.autobins`, `package.build`, `package.resolver`;
  - `rust-ts.lockfile`.
  - The base manifest gives `[]`.
- The env allowlist is empty and the comparison is case-insensitive.
- **Scratch build:**
  - `RUST_TS_DATA=<scratch>`, with `rust` symlinked to the upstream checkout, then
    `bun scripts/probes.ts build tokdump` from the lane.
  - It built in 5 s, and the binary dumps a token stream for a scratch file.
  - The scratch directory was deleted afterwards.

### 4. Nothing else changed
- **Case-list hashes:** `sha256(JSON.stringify(cases()))[:16]`, plus a hash of the first 3 oracle argvs, are identical on main and the lane for all 10 existing suites:
  - lex, escape: a8a356bd10b8a7b6;
  - parse: b244fb01ad2573be;
  - symbols: 7b46e1e12e1f8d93;
  - escape-synthetic: 6618a744d214bf09;
  - fluent-parse, fluent-format: 696bc26b11376778;
  - emit: 1bf53fe82cb7084a;
  - tokens: ecb7ce76882d03ee;
  - tokens-str: 65fb6186a8e1cf70.
- **Other suite settings:**
  - Modes and `timeoutMs` are unchanged.
  - Only `parse` gains `oracleTimeoutMs: 300000`.
  - `parse-ui` and `parse-ui-json` have 991 cases each.
- **Baselines and other trees:** the diff touches no `harness/baseline/`, `src/` or `tools/` file.

### Spot-runs (from the lane)
- `RUST_TS_AGENT=review-hw7 bun scripts/difftest.ts --suite parse-ui --sample 100`:
  - UNPORTED 100, every one `rustc_interface::interface::parse_check_cfg (--check-cfg=cfg(test,FALSE))`;
  - skipped=8, with the reasons above.
- `--suite parse --filter deep-try-chain`: MATCH 1/1.
