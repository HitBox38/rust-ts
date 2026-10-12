# Handoff: harness-w6 (harness/scripts batch; needs an independent review)

Branch `lane/harness-w6`, based on main 06b0bc4. Baselines are not touched. The existing suites'
case lists are byte-identical to main's.

## Files touched
- New:
  - `tools/probes/tokdump/{Cargo.toml.in,main.rs}`, the first rustc-dev probe
  - `src/rust_ts/tokdump.ts`, the subject
- `harness/suites.ts`: the new `tokens` suite.
- `scripts/probes.ts`: rustc-dev probe support (`rustc_dev = true`, `isRustcDevProbe`).
- `scripts/lib/oracle.ts`: `oracleSysroot()` and `oracleHost()` were factored out of `rustcDriverHash`, which is otherwise unchanged.
- `scripts/difftest.ts`:
  - rustc-dev cache key
  - gzipped large cache entries
  - G1 bisect
- `scripts/gate.ts`: F5 (unit-test skips) and `ALLOWED_SKIPS`. `staticChecks` is now exported so it can be checked from a scratch script.

## 1. `tokens` suite
### Probe (`tools/probes/tokdump`)
The full format is in the header of `main.rs`.
- **Build.** The probe uses `#![feature(rustc_private)]` and `extern crate rustc_driver/rustc_errors/rustc_parse/rustc_session/rustc_span`, built against the pinned nightly's rustc-dev component. It has no `[dependencies]`.
- **Per file**, with the probe's cwd at the upstream checkout:
  - It runs inside a fresh `create_session_globals_then(edition, &[], Some(inputs))`, with `RealFileLoader`, an empty path mapping and Md5.
  - The `ParseSess` gets a `DiagCtxt` with the flags of `Options::dcx_flags(true)` at default options: warnings on, `deduplicate_diagnostics: true`, everything else off.
  - The emitter is an `AnnotateSnippetEmitter` built the way `session.rs:1304` `default_emitter` builds it. Every setter is called explicitly with its default-options value, then `.ui_testing(true)`. It writes to an in-memory buffer through `AutoStream::new(.., ColorChoice::Never)`.
- **Lexing.** The probe calls `rustc_parse::source_str_to_stream(&psess, FileName::Real(path), src, None)`.
  - That is `new_source_file`, then `source_file_to_stream(.., StripTokens::Shebang)`, then `lex_token_trees`.
  - **PORT decision.** `lex_token_trees` and `source_file_to_stream` are crate-private, and `new_parser_from_*` hides the stream inside a `Parser`. So this is the only public route to the `TokenStream`. As a result, frontmatter is lexed as plain tokens, the same on both sides. The `ShebangAndFrontmatter` path is covered by the lexer unit test's cli cases.
- **Output per file:**
  - `file: <path>` and `edition: <Edition:?>`
  - `not utf-8`, or one of `OK <TokenStream:?>`, `ERR n` (the returned diagnostics are emitted in order) or `FATAL` (a `FatalErrorMarker` caught by `catch_unwind`; any other panic propagates)
  - one `lint <NAME> <NodeId:?> <primary spans:?>` line per buffered lint
  - `gated <feature> <spans:?>`, sorted by feature
  - `raw <spans:?>`
  - then `emit_stashed_diagnostics`, then `drop(psess)`, which runs `DiagCtxtInner::drop`
  - `diagnostics: <n> bytes`, followed by the emitter's exact bytes
- **Edition.** The suite passes `--edition=<e>` before each file. The value comes from `edition(f)` in `harness/suites.ts`, so it is also part of `Case.args` and therefore of the cache key. The split over the corpus:

  | edition | files |
  |---|---|
  | 2015 | 19,765 |
  | 2024 | 4,570 |
  | 2021 | 734 |
  | 2018 | 705 |
  | future | 6 |

### Subject (`src/rust_ts/tokdump.ts`)
It mirrors the probe step by step with the ported API:
- `lexer.lex_token_trees(psess, sf.src, sf.start_pos, undefined, "Shebang")` after `sm.new_source_file`
- `psess.dcx_.inner.drop()` for the drop

The source is the file's own bytes (`Str.of_bytes`; the BOM is kept, and `new_source_file` strips it as upstream does). The UTF-8 check is a fatal `TextDecoder` with `ignoreBOM: true`. Exit codes follow `main.ts`: 70 for unported, 101 for an ICE.

### probes.ts: rustc-dev probes
A probe opts in with `[package.metadata.rust-ts] rustc_dev = true`. For such a probe, `probeMeta`:
- refuses `[dependencies]`, `[dev-dependencies]` and `[build-dependencies]`, including under `[target.*]`;
- refuses `lockfile`;
- refuses `RUSTFLAGS` in `env`.

The build then:
1. Checks that `<sysroot>/lib/rustlib/<host>/lib/librustc_driver-*.{rlib,rmeta}` exists. If not, it stops with one `ERROR:` naming `rustup component add rustc-dev llvm-tools`.
2. Sets `RUSTC_BOOTSTRAP=1`.
3. On unix, sets `RUSTFLAGS=-C link-arg=-Wl,-rpath,<sysroot>/lib`, so the binary finds `librustc_driver` and `libLLVM` without `DYLD_`/`LD_LIBRARY_PATH`. I checked the result with `otool -l`. Windows has no rpath: the probe needs `<sysroot>/bin` on PATH. This is documented but not automated.

`Cargo.toml.in` documents all of this.

### Oracle cache
- **Key.** For a suite that declares a rustc-dev probe, the key is `hash(probe binary) + "+" + rustcDriverHash()`. Other suites' keys are unchanged; their samples ran from cache.
- **Compression.** New cache entries whose JSON is over 64 KiB are written gzipped. The reader detects the gzip magic `1f 8b` and also still reads plain JSON, so old entries stay valid. The reason is size: token dumps are about 13–20x their source. One `avx512f.rs` dump is 63 MB. The full suite added about 0.4 GB to the cache gzipped, against about 2 GB raw. The disk has 8.7 GB free.

### Results
- `--sample 200`: 200/200 MATCH.
- Full suite, run `tokens-full-harness-w6-1`: **25,780 total, MATCH 25,780, DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0**.
  - 258 processes, 26 s.
  - 0 batch-only failures.
  - A second full run, served from the gz cache, also gave 25,780/25,780.
- What the corpus exercises (from the oracle output at the suite's editions):

  | output | count |
  |---|---|
  | `OK` | 25,681 |
  | `ERR` | 78 |
  | `FATAL` | 21 |
  | files with non-empty diagnostics | 193 |
  | lint lines | 123 |
  | gated lines | 5 |
  | non-UTF-8 files | 0 |

- **Negative control.** I altered the subject's `FATAL`/`raw` lines and ran `--filter tests/ui/lexer`: 32/32 DIFF. After reverting: 32/32 MATCH.
- **DIFF buckets:** none, so there is nothing for a fixer lane.

## 2. Review follow-ups
- **G1** (harness-w5-2): the reviewer's snippet is applied verbatim, with a comment, in `runSubject`.
  - The test was a fake subject that prints every section and exits 101 at #10 of 100.
  - main: 270 processes. Lane: 12 processes.
  - In both, only `c10` fails. This matches the review's table.
- **F5** (harness-w5): the gate's unit-test step now runs `bun test src tools --reporter=junit --reporter-outfile=<run>/unit-tests.junit.xml`.
  - `junitSkips` parses the skipped `<testcase>`s. Attributes are matched as `k="v"` pairs, so a `>` in a test name is safe. It cross-checks the count against `<testsuites skipped=N>`.
  - `classifySkips` matches each skip against `ALLOWED_SKIPS` by file and test name. The list holds one entry: the Linux-only `read_binary_file_handles_lying_stat`, with a comment.
  - The gate prints `unit test skips: N (A allowlisted, U not allowed ...)`. It fails on U > 0, on a missing report and on a malformed report, and records `unitTestSkips` in `gate.json`. `test.todo` counts as a skip.
  - Checked on this tree: 1 skip, the allowlisted one, and the step passes.
  - With a temporary `src/zz_tmp.test.ts` that skips a same-named test in another file: ERROR and `ok: false`.

## 3. Checks
- **Case lists.** I hashed `JSON.stringify(cases())` per suite on main 06b0bc4 and on the lane. `lex`, `parse`, `escape`, `symbols`, `escape-synthetic`, `fluent-parse`, `fluent-format` and `emit` are identical; only `tokens` is new.
- **Baselines.** `git diff main -- harness/baseline` is empty.
- **Static checks.**
  - `bunx tsc --noEmit -p .`: clean.
  - `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 827 pass, 1 skip (allowlisted), 0 fail.
  - `bun scripts/coverage.ts --check`: `markers ok (2713; vendor 2173)`.
- **Samples** (200 each; 10 for `symbols`): `lex`, `emit`, `escape`, `symbols` and `fluent-format` all MATCH.
- Coverage numbers are not applicable: no ported upstream files were touched. There are no `unported(...)` calls.

## For root
- `tokens` is not protected yet. Build the probe with `bun scripts/probes.ts build tokdump`, then run the gate with `--suites` including `tokens` and accept it.
- Every gate machine now needs the rustc-dev component, which is already installed here.
- The claim `docs/claims/wave6b-harness-w6.md` is left for root to delete.

## What a reviewer should check
1. **Probe vs `default_emitter` and `dcx_flags`.** Are the emitter setters and flags exactly what `rustc -Zui-testing` gets at default options? Note `deduplicate_diagnostics: true`; the lexer unit test used false.
2. **Probe/subject parity.** Same order of emit, stash and drop. The subject calls `dcx_.inner.drop()` where the probe drops `psess`. The `= no newline` tail matches.
3. **`StripTokens::Shebang` choice** (above).
4. **`isRustcDevProbe` keying.** Non-rustc-dev suites' keys must be unchanged. The gzip cache must be backward compatible.
5. **`junitSkips` robustness.** Regex attribute parsing and the count cross-check. Is name+file matching in the allowlist strict enough?
6. **G1.** Statuses unchanged. Process counts as above.
7. **Known gap.** A cache entry written partially (process killed mid-write) is unreadable, the same as before for plain JSON. Atomic writes would be a separate change.
