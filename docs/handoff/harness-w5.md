# Handoff: harness-w5 (harness/scripts batch, needs independent review)

Branch `lane/harness-w5`, based on bd00147.
- First commit: 3c0f63a.
- Then root asked for two follow-ups: main 4e5f5ca (the emitter lane) is merged in with a real merge, and `make_emitter` is wired to the
  real `AnnotateSnippetEmitter`.

## Files touched
- New `emit` suite:
  - `tools/probes/emitdump/{Cargo.toml.in,main.rs}`: the oracle probe.
  - `src/rust_ts/emitdump.ts`: the subject.
  - `harness/corpus/gen-emit.ts`: the generator.
  - `harness/corpus/emit/gen/*.json`: 1354 generated cases.
  - `harness/corpus/emit/hand/*.json`: 52 hand-written cases.
  - `harness/suites.ts`: the `emit` suite, plus a new `Suite.probes` field on every probe-based suite.
- Probes: `scripts/probes.ts` (per-probe `env` and `lockfile` metadata) and `tools/probes/symdump/Cargo.toml.in`
  (its env moved into its metadata).
- Review F2–F4 and the gate:
  - `scripts/difftest.ts`
  - `scripts/gate.ts`
  - `scripts/coverage.ts`
  - `scripts/crate-src.ts`
- `Result::unwrap`/`expect`: `src/std/result.ts` and the new `src/std/result.test.ts`.
- Not touched: `harness/baseline/` and every existing suite's case list.

## 1. `emit` oracle suite

### Probe (`tools/probes/emitdump`)
- Path deps on upstream `compiler/rustc_errors` and `compiler/rustc_span`. `serde_json` reads the corpus.
- Every registry dep comes from upstream's own `Cargo.lock` (`lockfile = "upstream"`, see below). The probe therefore
  links the same versions rustc does: annotate-snippets 0.12.16, anstream 0.6.21, serde_json 1.0.145.
- Build env: `RUSTC_BOOTSTRAP=1` and `CFG_RELEASE`, from its manifest metadata.
- Build time: about 15 s warm. The shared target dir already held most of the compiler crates.
- Per case:
  - fresh `create_default_session_globals_then`;
  - `SourceMap::new(FilePathMapping::empty())`, with files loaded through `new_source_file`; names use
    `FileName::Real(path_mapping().to_real_filename(working_dir(), name))`, like upstream's own emitter tests, or
    `FileName::Custom`;
  - `AnnotateSnippetEmitter::new(dst)` with every setter, where `dst` is `AutoStream::never` or
    `AutoStream::new(_, ColorChoice::AlwaysAnsi)` over a shared buffer;
  - `DiagCtxt::new(..).with_flags(..)`;
  - the scripted ops;
  - `drop(dcx)`, whose `Drop` emits whatever is still stashed;
  - then `file: <path>\n` and the bytes are printed.
- The full case format is documented in the header of `tools/probes/emitdump/main.rs`. Its pieces:
  - Levels: all nine.
  - Messages: `Str` or `Inline` (Fluent), with Str, Number and list args.
  - Codes.
  - Spans: byte offsets, find-by-text, or dummy.
  - Labels and `span_labels`.
  - Children:
    - note, help, warn, `*_once`, each with or without a MultiSpan;
    - `sub` at every Sublevel;
    - `highlighted_*`;
    - `note_expected_found`.
  - Every public suggestion API, with every `SuggestionStyle` and `Applicability`.
  - `primary_message`.
  - Ending a diag: emit, cancel, `delay_as_bug` or stash.
  - Ops: `steal_non_err`, `try_steal_modify_and_emit_err`, `emit_stashed`, `print_error_count`, `reset_err_count`,
    `abort_if_errors`, plus `query` and `must_teach` (which print `= ...` lines).
  - Emitting catches the two unwinds rustc_errors raises itself and prints them: `= FatalError` and
    `= ExplicitBug`. The panic hook stays quiet for `ExplicitBug` only.
- Not covered:
  - `teach`: rustc_errors has no teach flag at the pin; only `must_teach`, which is covered.
  - `track_diagnostics`: its output names the probe's own source lines.
  - `treat_err_as_bug`: it ICEs.
  - A case with neither `ui_testing` nor `diagnostic_width`: the width would then come from `termize`, which
    depends on the host. The probe and the subject both reject such a case.

### Subject (`src/rust_ts/emitdump.ts`): wired
- It mirrors the probe function by function, against the TS API: `DiagCtxt`, `Diag`, `SourceMap`, `MultiSpan`,
  `DiagStyledString`/`StringPart`, `FatalErrorMarker`/`ExplicitBug`, and `dcx.inner.drop()` for the drop.
- `make_emitter` follows `docs/handoff/emitter.md`:
  - `AnnotateSnippetEmitter.new(dst)`, imported directly from `src/rustc_errors/annotate_snippet_emitter_writer.ts`
    (lib.ts does not re-export it, because of an import cycle);
  - then the static setters, in the probe's order: `sm`, `short_message`, `ui_testing`,
    `ignored_directories_in_source_blocks`, `diagnostic_width`, `macro_backtrace`, `terminal_url`, `theme`.
  - `dst` is `AutoStream.never(dyn_write(vec))` for color "never", or `AutoStream.new(dyn_write(vec),
    ColorChoice.AlwaysAnsi)` for "always".
  - The sink is one vendored `VecU8`. The `= ...` query lines are written into that same buffer, which keeps the
    order of events (the probe's `Shared`).
- Before wiring, I checked the driver with a scratch fake emitter (not committed): every case's `= ...` line
  sequence was identical to the oracle's.

### Corpus
1406 cases: 1354 generated plus 52 hand-written.

| family | cases |
|---|---|
| basic | 200 |
| labels | 200 |
| children | 150 |
| sugg | 264 |
| options | 200 |
| count | 120 |
| stash | 60 |
| long | 60 |
| unicode | 100 |
| hand | 52 |

- The generator is deterministic (two runs are byte-identical). Each case is seeded from its own name, so families
  are independent.
- Op totals:
  - 2148 diags;
  - 389 `print_error_count`, 53 `abort_if_errors`, 117 `query`;
  - 44 `steal_non_err`, 32 `try_steal_modify_and_emit_err`.
- Levels:

  | level | diags |
  |---|---|
  | error | 695 |
  | warning | 611 |
  | force_warning | 187 |
  | help | 181 |
  | note | 176 |
  | failure_note | 153 |
  | delayed_bug | 59 |
  | bug | 44 |
  | fatal | 42 |

- Suggestions: all 12 APIs, 47–65 each; each Applicability appears 165–190 times; each Style 25–43 times.
- Emitter options:
  - the full matrix theme × color × short_message × width (ui_testing/20/40/80/200) × source_map × terminal_url;
  - 19 cases with `ignored_directories`, 24 with `macro_backtrace`.
- Sources:
  - multi-line spans and overlapping labels;
  - CJK, combining characters, ZWJ, bidi controls, tabs, CRLF, BOM, control characters;
  - no trailing newline, an empty file;
  - 130- and 1200-line files;
  - three-file and `Custom` file sets;
  - long lines at widths 20..200.
- Hand cases include:
  - the real E0308 shape;
  - warning summaries ("1 warning emitted", "3 warnings emitted");
  - more than 9 error codes (the `...` list);
  - E9999, which has no long explanation;
  - dedup on and off;
  - warnings off, and `force_warning` while warnings are off;
  - delayed bugs, with and without `eagerly_emit_delayed_bugs`;
  - stash, steal and drop;
  - all 5 suggestion styles;
  - no source map, ignored directories;
  - wide line numbers, the empty file, a case with no files at all.
- Oracle run on the full corpus:
  - 1406 sections, 27,381 lines, 882 KB;
  - 4 cases print nothing;
  - no host paths in the output.
- Upstream quirk the corpus works around: `try_steal_*` and `steal_non_err` `swap_remove` from a per-key map but leave
  the key, so `print_error_count`'s `assert!(stashed_diagnostics.is_empty())` fails after a steal unless
  `emit_stashed` runs first (it uses `mem::take`). The generator always emits stashed diagnostics before
  `print_error_count`.

### Results
| run | result |
|---|---|
| before wiring, full (`hw5-emit-full`) | UNPORTED=1406, MATCH/DIFF/CRASH/TIMEOUT=0; 1421 subject processes, 12 s |
| **after wiring, full** (`RUST_TS_AGENT=harness-w5 bun scripts/difftest.ts --suite emit`, run `hw5-emit-wired`) | **MATCH=1406, DIFF=0, UNPORTED=0, CRASH=0, TIMEOUT=0**; 15 subject processes, 1 s |
| after wiring, `--sample 50` | MATCH=50 |

- Cross-check: the subject's and the probe's output for the whole corpus (`emitdump.ts` vs the probe, all 1406
  files in one process) are byte-identical: 881,659 bytes, including 2770 ANSI-styled lines.
- No DIFF buckets: nothing goes to a fixer lane.
- Gaps the corpus does not reach are listed under "Not covered" above.

## 2. Review LOWs from harness-w4b

### F2: split cost (`scripts/difftest.ts` `runSubject`)
- A failed batch's output is used only to choose the split, never for statuses.
- With `k` the first case without a complete section, the batch is re-run as three parts: `[0,k)` as a batch, `[k]`
  alone, and `(k,n)` as a batch.
- After a case fails alone, the following cases run alone in a doubling streak (1, 2, 4, ...) until one passes;
  then the rest is tried as a batch again.
- Each part is strictly smaller than the batch, so this terminates.
- A missing header in an exit-0 batch still scores the process's stderr, as before.
- Fake-suite check, using the reviewer's method:
  - setup: a runtime-injected suite, a scratch `RUST_TS_DATA`, timeout 3 s;
  - mixed (ok, poison/victim, fail70, crash, late70, wrong, hang): the statuses at batch size 100 equal those at
    batch size 1, case for case;
  - process counts:

    | case set | processes |
    |---|---|
    | 200 all-fail | 202 (lane w4b: 398) |
    | 200 cases with 2 sparse crashes | 10 |
    | mixed, batch size 100 | 18 |
    | mixed, batch size 1 | 17 |

### F3: batch-only failures (`scripts/difftest.ts`)
- `SubjectStats { processes, batchOnlyFailures, batchOnlyTimeouts }`: a "batch-only failure" is a failed batch whose
  suspect case passes when run alone.
- The stats are written to `<suite>.summary.json`.
- Both the difftest CLI and `gate.ts` print a `note:` line when either count is non-zero, and `gate.json` records them
  per suite.
- No status changes. The fake poison/victim case counts 1.

### F4: lazy vendor resolution (`scripts/coverage.ts`, `scripts/crate-src.ts`)
- `vendorEntries()` reads scope.json without resolving any sources. `resolveVendor()` resolves one crate, on demand.
- Which modes resolve sources:
  - compiler `--missing` and `--crate`: none;
  - `--check`: only crates that have markers;
  - the tables: all of them.
- New `--offline` flag: `cargo fetch --offline`, and a one-line `ERROR:` if it fails. The gate's markers step passes
  it.
- Checked with an empty scratch `CARGO_HOME`:
  - `--missing compiler/...` and `--crate rustc_lexer` work and touch nothing;
  - `--check --offline` fails with one clear ERROR line.

## 3. Gate: probes and `RUST_TS_REQUIRE_PROBES=1`
- The gate's unit-test step now runs `bun test src tools` with `RUST_TS_REQUIRE_PROBES=1`. It used to run only
  `bun test src`, without the variable.
- `checkProbes` runs before anything else:
  - it covers every probe a run suite declares (`Suite.probes`), plus every probe an oracle unit test reads (the
    test files are scanned for `"probes", "release", "<name>"`, which finds annotate, listfmt, plurals, typedefs and
    uwidth);
  - each missing probe gets one line: `ERROR: probe 'x' not built (needed by ...); run: bun scripts/probes.ts build x`;
  - it also checks that each suite's oracle argv[0] is one of its declared probes (or `rustc`), so `probes` cannot
    drift from `oracle`.
- Checked twice: on this host (ok), and with a scratch `RUST_TS_DATA` (all probes missing), which printed 8 ERROR
  lines.
- `scripts/probes.ts` (generalised `PROBE_ENV`):
  - `[package.metadata.rust-ts]` may set `env = {...}` and `lockfile = "upstream"`;
  - the template also substitutes `@RELEASE@`;
  - `symdump`'s env now lives in its manifest and resolves to the identical `{RUSTC_BOOTSTRAP: "1", CFG_RELEASE:
    "1.101.0-nightly"}`;
  - I rebuilt symdump. The binary hash changed, so its 10 oracle outputs are re-keyed; `symbols` is still 10/10
    MATCH.

## 4. `src/std/result.ts`
- Design:
  - `unwrap_result(r, debug_err)` panics with core's exact `called \`Result::unwrap()\` on an \`Err\` value:
    {e:?}`, rendered as `debug_err(e, PLAIN)`;
  - new `expect_result(r, msg, debug_err)` panics with `{msg}: {e:?}`;
  - both go through `unwrap_failed`, as core does;
  - the `E: Debug` bound becomes a `Debug<E>` parameter (`// PORT:` comment in result.ts).
- Kept: a test-only one-argument overload `unwrap_result(r)`. It is inexact: there is no Debug, so no `: {e:?}`.
  `src/std/result.test.ts` fails if any non-test file calls it (outside `*.test.ts` and `tests/` dirs). Today: none.
- Callers: no signature change was needed, so no callers were edited. The ~110 existing calls are all in tests.
- Texts are checked against a scratch binary built with the pinned nightly (4 payloads, in the test header).
- `fluent-format`, full, `RUST_TS_AGENT=harness-w5`: 4210/4210 MATCH (run `hw5-fluent-format`).
- For root, optional: these files inline the panic text by hand and could use `unwrap_result(r, debug)` instead.
  - `src/rustc_errors/formatting.ts:73,80`
  - `src/rustc_error_messages/lib.ts:386,395`
  - `src/rustc_span/hygiene.ts:833`
  - `src/rustc_ast/util/literal.ts:290`
  - `src/vendor/annotate_snippets/renderer/render.ts:63`
  - `src/vendor/fluent_bundle/types/{plural.ts:24,mod.ts:253}`
  - `src/vendor/icu_list/provider/serde_dfa.ts:57`: this one panics without the `: {e:?}` suffix, so it is inexact
    today, if that path is reachable.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`, after the merge: 502 pass, 1 skip, 0 fail. The skip is
  `read_binary_file_handles_lying_stat`, which is Linux-only.
- `bun scripts/coverage.ts --check --offline`, after the merge: `markers ok (2210; vendor 2048)`.
- `fluent-format`, after the merge: 4210/4210 MATCH (run `hw5-ff2`).
- Case-list hashes (`sha256(JSON.stringify(cases()))[:16]`) are identical on main f68dc9c and on this lane:

  | suite | cases | hash |
  |---|---|---|
  | lex | 25780 | a8a356bd10b8a7b6 |
  | parse | 21526 | b244fb01ad2573be |
  | escape | 25780 | a8a356bd10b8a7b6 |
  | symbols | 10 | 7b46e1e12e1f8d93 |
  | escape-synthetic | 11 | 6618a744d214bf09 |
  | fluent-parse / fluent-format | 4210 | 696bc26b11376778 |
  | emit (new) | 1406 | d8583fbc254273e2 |

- `unported(...)` left: none.
- `// PORT:` decisions: `unwrap_result`'s Debug parameter, in result.ts.

## For the reviewer
- Probe vs subject parity in script semantics:
  - op order inside `diag`, defaults, validation, `= ...` line texts;
  - the `no newline at end of output` footer;
  - spans: byte offsets into the normalized source, and the char-boundary check.
- That nothing in a case's output depends on the host:
  - widths always come from `ui_testing` or `diagnostic_width`;
  - file names are relative;
  - `track_diagnostics` is off.
- `lockfile = "upstream"`: the probe's resolved `$RUST_TS_DATA/probes/emitdump/Cargo.lock` should equal upstream's
  versions.
- `runSubject`'s new split and streak logic: termination, no attribution from failed processes, and the
  missing-header semantics of exit-0 batches (unchanged).
- `checkProbes`' scan of test files, and its oracle-argv consistency check.
- coverage.ts `--check` with `--crate` and vendor markers: `vsel` now holds only crates that have markers. Before
  this batch, crates without markers were in `vsel` and contributed no errors, so the result is the same.

## For root
- Record decisions:
  - `unwrap_result`'s Debug parameter, with its test-only overload;
  - the gate now runs `bun test src tools` with `RUST_TS_REQUIRE_PROBES=1` and checks probes first;
  - the `emit` case format.
- `emit` is ready to protect, at 1406/1406 MATCH. Run the gate with the suite included, e.g.
  `--suites ...,emit`, and accept, so the baseline is created. The gate host needs `bun scripts/probes.ts build emitdump`;
  the gate's probe check reports it if it is missing.
- After merge, the next symbols oracle run recomputes 10 outputs, because the symdump binary was rebuilt.
