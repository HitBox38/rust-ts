# Handoff: harness-w7 (harness/scripts batch; needs independent review)

Branch `lane/harness-w7`, based on main 5659298. No porting; no `src/`, `tools/` or `harness/baseline/` changes.

## Files touched
- `harness/compiletest.ts` (new): compiletest's UI-test command line, from `src/tools/compiletest` at the pin.
- `harness/suites.ts`:
  - optional `Case.env`, `Suite.oracleTimeoutMs` and `Suite.skipped()`;
  - suites `parse-ui` and `parse-ui-json`;
  - `parse.oracleTimeoutMs = 300_000`.
- `scripts/difftest.ts`:
  - new `ORACLE_TIMEOUT` status, with one retry;
  - per-case env, which joins the cache key only when present;
  - `<suite>.skipped.jsonl`;
  - `unported` / `first` fields in `<suite>.jsonl`.
- `scripts/gate.ts`: records `oracleTimeouts` per suite, and labels lost cases that are ORACLE_TIMEOUT.
- `scripts/lib/common.ts`: in `run()` env, a `null` value unsets the variable.
- `scripts/probes.ts`: J1. The rustc-dev manifest and env checks are now allowlists.

## 1. `parse-ui` / `parse-ui-json`
**Cases.**
- Source: `tests/ui/{parser,lexer,frontmatter}`. `tests/ui/unicode` does not exist at the pin; it is listed, and an absent directory is skipped.
- Collection follows compiletest: `auxiliary/` dirs and `compiletest-ignore-dir` dirs are skipped, as are files starting with `.`, `#` or `~`.
- One case per revision. The id is `<file>` or `<file>#<rev>`.
- Result: 991 cases, plus 8 skipped tests with reasons, in `<run>/parse-ui.skipped.jsonl`:
  - 4 need a `proc-macro` aux crate;
  - 3 have `ignore-auxiliary`;
  - 1 is `only-windows`.

**Directives** are parsed with compiletest's own rules:
- `line_directive`, `//@[rev]`, `split_flags` with single quotes;
- `edition` ranges (`edition_to_test` with requested = 2015);
- `revisions` (duplicates and true/false rejected);
- `compile-flags` (rejects `--edition`), `rustc-env` / `unset-rustc-env`;
- pass/fail modes, `no-prefer-dynamic`, `no-auto-check-cfg`, `remap-src-base`, `{{...}}` variables.

**`ignore-*` / `only-*` / `needs-*`.**
- These are evaluated against the oracle host with cfg.rs `prepare_conditions`, built from `--print=all-target-specs-json`.
- A condition that depends on compiletest config we do not have makes the case skip with a reason instead of guessing. That covers stage, debug assertions, LLVM version/components, and every `needs-*` except `needs-subprocess`.
- These also skip with a reason: aux directives, `add-minicore`, `incremental`, and anything compiletest itself would panic on.

**argv** is `make_compile_args` for `run_ui_test`'s main compile, in upstream order:
- input file;
- `-Zsimulate-remapped-rust-src-base=/rustc/FAKE_PREFIX -Ztranslate-remapped-path-to-local-path=no`;
- `-Z ignore-directory-in-diagnostics-source-blocks=<cargo home>` and `=<upstream>/vendor`;
- `--sysroot <oracle sysroot>`, `--target=<host>`;
- `--cfg <rev>` and `--check-cfg cfg(test,FALSE,<revs>)`;
- `[--error-format json --json future-incompat]` (json suite only);
- `-Ccodegen-units=1 -Zui-testing -Zdeduplicate-diagnostics=no -Zwrite-long-types-to-disk=no -Cstrip=debuginfo`;
- `--emit metadata` for check-* modes;
- `-C prefer-dynamic`;
- `--out-dir build/<host>/test/ui/<dir>/<stem>[.<rev>]`, or `-o …/a` for run-* modes;
- `-Znext-solver=coherence`;
- `-A unused -W unused_attributes` unless run-pass;
- `-A internal_features -A incomplete_features -A unused_parens -A unused_braces`;
- bootstrap's target rustcflags `-Crpath -Cdebuginfo=0`;
- `--edition=X`, then the compile-flags;
- `-Zparse-crate-root-only`.

**Env:** `RUSTC_ICE=0 RUST_BACKTRACE=short`, `RUSTC_LOG_COLOR` unset, plus the directives. Both sides get the same env.

**Fidelity check (scratch, oracle only).**
- I compared the oracle's stderr for all 991 cases against the checked-in `.stderr`, after compiletest's normalization ($DIR, tabs, `//~`).
- 768 are identical.
- 222 differ only because `.stderr` has later-phase diagnostics, which we stop before.
- 1 differs from a backslash-normalization artifact in my scratch normalizer (`parser/issues/issue-62913.rs`).
- So the argv reproduces compiletest's output.

**Full runs** (`RUST_TS_AGENT=harness-w7`):

| run | MATCH | DIFF | UNPORTED | CRASH | TIMEOUT | ORACLE_TIMEOUT |
|---|---|---|---|---|---|---|
| `parse-ui` (hw7-parse-ui-full) | 0 | 0 | 991 | 0 | 0 | 0 |
| `parse-ui-json` (hw7-parse-ui-json-full) | 0 | 0 | 991 | 0 | 0 | 0 |
| scratch: parse-ui minus `--check-cfg <spec>` (hw7-whatif-no-check-cfg) | 976 | 0 | 15 | 0 | 0 | 0 |

**UNPORTED buckets.**
- `parse-ui`:
  - 976 × `rustc_interface::interface::parse_check_cfg`;
  - 15 × `rustc_interface::interface::parse_cfg`, the `--cfg <rev>` cases. These are the 15 revision cases of 6 files, e.g. `lexer/lex-bad-str-literal-as-char-3.rs#rust2015` and `parser/raw/raw-idents.rs#e2024`.
- `parse-ui-json`: 991 × `rustc_errors::json::JsonEmitter`.
- **DIFF buckets: none.** No case DIFFs, in the suite or in the what-if run.

**Next for M1:** port `parse_check_cfg` + `parse_cfg` (rustc_interface/src/interface.rs). The what-if run predicts `parse-ui` then goes to 991/991. Protect `parse-ui` after that.

**Paths and normalization.**
- Both sides run in the upstream checkout with the same relative input path and identical argv/env.
- 976/976 raw outputs are byte-identical with no normalization (746 of the 991 oracle outputs have non-empty stderr).
- Absolute paths appear only in argv (sysroot, cargo home, vendor), so they are part of the cache key: keys are per machine, ids are not.
- Nothing is written to `--out-dir`.

## 2. Timeouts
- **`ORACLE_TIMEOUT`**:
  - An oracle process that times out is re-run once with `ORACLE_RETRY_FACTOR` (4) × its timeout.
  - If it times out again, the case is ORACLE_TIMEOUT.
  - Such an output is never cached and never compared, and `classify` checks it before anything else, so it is never MATCH and never DIFF.
- **Batch suites:** a single file that times out twice is ORACLE_TIMEOUT; other single-file oracle failures still throw.
- **MATCH semantics are unchanged.**
- **Verified with scratch suites using a 5 ms oracle timeout:**
  - single mode: a timed-out case is ORACLE_TIMEOUT, and the next run re-runs it (it was not cached);
  - batch mode: both cases are ORACLE_TIMEOUT.
- **Gate:** an ORACLE_TIMEOUT case is not MATCH, so a protected one is still "lost". The gate now says why.
- **`parse` oracle timeout raised to 300 s, oracle side only** (decision below).
  - Measured: `rustc -Zunpretty=ast-tree` on `try-trait/deep-try-chain-issue-153583.rs` needs **203 s CPU** (1288 s wall at load ~100). 60 s can never finish it.
  - A success is cached, so the cost is paid once per oracle build.
  - Verified: `difftest --suite parse --filter deep-try-chain` (run `hw7-deep-try`) gives **MATCH 1/1**. The subject finished within its own 60 s.
  - That oracle output is now in the shared cache, so the gate can protect this case.
  - Subject timeouts are unchanged (`timeoutMs`).

## 3. J1 (harness-w6-2)
- **Manifest allowlist.** A rustc-dev probe's manifest may contain only:
  - `[package]` with name, version, edition, publish, metadata;
  - `package.metadata.rust-ts` with `rustc_dev` and `env`;
  - `[[bin]]` with name and path;
  - an empty `[workspace]`.
- **Env allowlist.** `env` may only set keys in `RUSTC_DEV_ALLOWED_ENV`. That list is empty, and the comparison is case-insensitive.
- **Verified** with `rustcDevManifestViolations`, exported for review, on scratch manifests. Each of these is refused:
  - `cargo-features` + `[profile.release] rustflags`;
  - `package.build`, `package.links`;
  - `[patch]`, `[replace]`;
  - `[target.'cfg(unix)'.build_dependencies]`, `[dependencies]`;
  - `[lib]`, `[lints]`;
  - `workspace.members`, `bin.required-features`;
  - `lockfile`, other metadata.
- All 12 real probes still pass `probeMeta`. tokdump's env is empty; the other probes are not rustc-dev, so they are unaffected.
- **Residual (not fixed, outside the manifest):**
  - Cargo config files (`$CARGO_HOME/config.toml`, `.cargo/config.toml` above the cwd) and the outer env (`RUSTC_WRAPPER`, `CARGO_TARGET_<T>_LINKER`, …) can still affect a probe build.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- **Case lists:** existing suites' case lists are unchanged versus main. These are `sha256(JSON.stringify(cases()))[:16]`, identical on both:

  | suite | hash |
  |---|---|
  | lex | a8a356bd10b8a7b6 |
  | parse | b244fb01ad2573be |
  | escape | a8a356bd10b8a7b6 |
  | symbols | 7b46e1e12e1f8d93 |
  | escape-synthetic | 6618a744d214bf09 |
  | fluent-parse / fluent-format | 696bc26b11376778 |
  | emit | 1bf53fe82cb7084a |
  | tokens | ecb7ce76882d03ee |
  | tokens-str | 65fb6186a8e1cf70 |

  None of these suites has an env, so their oracle cache keys are unchanged too.
- **`RUST_TS_REQUIRE_PROBES=1 bun test src tools`:** 1998 pass, 1 skip (the allowlisted one), 1 fail.
  - The failure is `unicode_width/tests/tests.test.ts` `test_vs1_vs2_vs3`, which hit the 5 s Bun timeout at 8.9 s while the host load average was 60–120 from other lanes.
  - It passes with `--timeout 60000`.
  - This lane does not touch `src/` or `tools/`.
- No baselines touched; no `unported(...)`; no `// PORT:` (no ported code).

## Decisions for root to record
1. `parse-ui` drops compiletest's default `--error-format json --json future-incompat`.
   - The human text is what the `.stderr` files hold (JSON `rendered`).
   - `parse-ui-json` keeps the exact argv for when `rustc_errors::json` is ported.
2. Bootstrap's `-Lnative=<rust_test_helpers>` is omitted: it is not built, and it is a link-time path. `-Crpath -Cdebuginfo=0` are kept.
3. The input path is relative to the upstream checkout (both sides), not absolute as in compiletest, so nothing needs normalizing.
4. `parse` oracle timeout is 300 s (oracle side only). Retry factor is 4.
5. Tests needing aux crates, minicore, incremental, or host conditions we cannot evaluate are skipped with recorded reasons, not guessed.
