# Handoff: miri-diff (harness batch: scripts/, harness/; plan-m6 D10 + A6; needs an independent review)

Branch `t3/db155eff`, from main `06fa2c65`. This batch adds tooling only. It touches no port code under `src/`, no
baselines, no suite case lists or expectations, and no oracle cache keys (checked below). So there are no
`unported(...)` or `// PORT:` changes, and coverage does not apply.

## Files touched

| file | change |
|---|---|
| `scripts/miri-diff.ts` (new) | the CLI (see below) |
| `scripts/lib/miri-trace.ts` (new) | pure normaliser and comparer: `normaliseTrace`, `traceLine`/`traceText`, `firstEventDifference`, `compareTraces` |
| `scripts/miri-diff.test.ts` (new) | 12 tests: normalisation on real oracle fragments, constructed tracing-tree shapes, verdicts, CLI in child processes (error paths and one real run) |
| `scripts/fixtures/miri-diff/*.stderr` (new, 4.2 KB) | real oracle `MIRI_LOG=info` fragments (see Tests) |
| `harness/suites.ts` | `MIRI_SUBJECT_ENTRY` (the one constant that picks the port side) and `MIRI_DRIVER_ENTRY`; `miriSubject` uses them; `miriFileCase(file)` factored out of `miri-hello`'s case (same case, same key) |
| `scripts/difftest.ts` | pure extraction: `oracleCacheKey` (the key `cachePath` used to compute inline), `caseOracleCacheKey(s, c)`; `cwdOf` and `unportedOf` exported. Keys and behaviour unchanged |

## The tool

```
bun scripts/miri-diff.ts <file.rs>                         # as miri-hello runs its case: miriFileCase(<file>)
bun scripts/miri-diff.ts --suite <miri suite> --case <id>  # any Suite.miri suite
  [--impl I] [--run-id ID] [--no-cache]
```

- **Same run as the suite.** Both sides use the suite's own `oracle([c])` / `subject([c])` commands, its cwd
  (`cwdOf`) and `caseEnv(c.env)`, plus `MIRI_LOG=info` (`MIRI_TRACE_ENV`). Nothing about the argv is rebuilt. A file
  path inside the repo becomes repo-relative, so `harness/corpus/miri/hello.rs` is exactly miri-hello's case.
  `verifyOraclePin` and `verifyMiriOracle` run first, and the upstream checkout's `git status` is compared before and
  after, as in phase-diff.
- **Port side.** `harness/suites.ts` `MIRI_SUBJECT_ENTRY`, today `src/rust_ts/main.ts` (the rustc fallback with Miri's
  rustc argv, unchanged). Setting it to `MIRI_DRIVER_ENTRY` (`src/miri/bin/miri.ts`) switches every Miri suite and
  miri-diff together; `miriSubject` then passes the oracle's exact argv. That switch is a one-line harness batch for
  root.
- **Oracle trace cache.** Raw `{stdout, stderr, code}`, gzipped, at `$RUST_TS_DATA/miri-diff-cache/<k2>/<key>.json.gz`,
  key `caseOracleCacheKey(s, c)`. That is difftest's Miri oracle key: pin, miri binary, suite, id, argv, file hash, env
  (which here includes `MIRI_LOG=info`, so it never collides with difftest's entries), deps and `miriOracleKey()`.
  Because the cache keeps the raw output, a normaliser change needs no oracle re-run. Cases that are unstable (listed in
  `Suite.unstable`, or matching `unstableReasonOf(s)`) are never cached. hello world's entry is 120 KB.
- **Output.** These files are written to `$RUST_TS_DATA/runs/<run>/miri-diff/`:
  - `oracle.trace.txt` and `port.trace.txt`: one record per line;
  - `oracle.other.txt`;
  - `port.stdout.txt` and `port.stderr.txt`;
  - `report.txt`: the summary, plus the 5 matching records before the difference;
  - `report.json`: the verdict, both sides' exit, record and other-line counts, the port's stop reason and
    `unported`, the first differing pair, and any upstream changes.
- **Summary lines.** The run prints these:
  - a header line;
  - `records: oracle N, port M; other stderr lines: ...`;
  - one of the following:
    - `traces match (N records); stdout same|differs, exit ...`;
    - `first difference at record i (...)`, followed by `- oracle` / `+ port` lines;
    - when the port stops early: `port stops after i of the oracle's N records (exit 70, rust-ts: unported: …)` plus
      the next oracle record. The stop reason is a timeout, the first `unported`, or the exit code with the first
      non-trace stderr line;
    - `port has records after the oracle's N`;
  - `files: <dir>`.

  Console lines are cut at 300 characters. Failures print `ERROR:` lines:
  - a non-Miri suite;
  - a missing `--case`;
  - an unknown case;
  - a skipped case, with its skip reason;
  - a missing file;
  - an oracle timeout;
  - an oracle that printed no records;
  - an upstream change.
- **Exit code.** 0 means the traces, stdout and exit all match. 1 means they differ or the port stops. 2 means an
  `ERROR:` was printed.

## Normalisation decisions (A6), documented in the header of `scripts/lib/miri-trace.ts`

The format comes from tracing-tree 0.4.1 (the pin's Cargo.lock) as rustc_log configures it. env.ts scrubs the whole
`RUSTC_LOG*` prefix, so every `RUSTC_LOG_*` option is at its default: no indent lines, no thread ids, no verbose
entry/exit, no timer, colours only on a tty.

1. **Events.** An event line is spaces + `LEVEL target<fields>`. It is kept as `LEVEL target<fields>`. The leading
   spaces are dropped; they are the indentation, the empty timestamp's separator inside a span, and the colour pad of
   ` INFO`. The indentation is not the stack depth anyway, because tracing-tree wraps it every 25 levels.
2. **Span openings are kept** as `SPAN <target>::<name>[ <fields>]`. At INFO this is only
   `rustc_const_eval::interpret::stack::frame frame=<instance>`. It is the trace's only record of a frame push, which
   is the "frame" part of the plan's "statement / frame / retag". The brief says "event lines only", and I read span
   decoration as the thing to strip, not the span record itself. If the reviewer reads it otherwise, filtering out
   `SPAN ` records is a one-line change. Span closes print nothing in this configuration.
3. **Continuations.** A line that directly follows a record, is indented deeper than the record's first line, and is
   not a record itself is a continuation (a multi-line value). It is joined to the record with `\n` after the record's
   indentation is removed, and written to the trace files as a literal `\n`.
4. **Other lines.** Everything else is "other" and is kept out of the comparison: the program's output, Miri's
   diagnostics, `rust-ts: unported:`, and blank lines. A program line that happens to look like a record is misread as
   one, but the same way on both sides.
5. **ANSI escapes are removed.**
6. **Timing.** There is none to strip, because rustc_log sets no timer. I added no speculative timing rule.

## Tests

The fixtures were captured from the isolated oracle with `MIRI_LOG=info`. I left out lines that name local paths:

- `hello-start` (lines 1–5);
- `hello-frames` (lines 40–62: a frame push/pop);
- `hello-end` (the last 4 lines, including a depth-0 event);
- `hello-start-end.color` (the same lines with `RUSTC_LOG_COLOR=always`; the test checks that it normalises to the
  plain trace);
- `panic-interleaved` (a panicking program's own stderr between events, one line of it indented).

No real oracle trace has a multi-line value: across hello (22,954 lines) and the panic program (76,533 lines), every
line is an INFO event or a frame span, apart from the program's own output. The continuation and no-field shapes are
therefore tested on constructed lines, and the test says so.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun test scripts/miri-diff.test.ts`: 12 pass. `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness
  --timeout=60000`: 122 pass, 0 fail, 17 files (was 110 / 16).
- **Keys unchanged**: `bun scripts/difftest.ts --suite miri-hello` gave UNPORTED 1/1. Its oracle cache entry
  (`…b61415381df6`) dates from 00:55, before this batch, and is still the one `cachePath` computes. `--suite lex
  --sample 50` gave MATCH 50/50, all from the cache.
- **Real run** (`bun scripts/miri-diff.ts --suite miri-hello --case harness/corpus/miri/hello.rs`, first run, oracle
  not cached, 1.7 s wall):

  ```
  miri-diff miri-hello harness/corpus/miri/hello.rs (port src/rust_ts/main.ts; oracle ran, exit 0)
  records: oracle 22954, port 0; other stderr lines: oracle 0, port 1
  port stops after 0 of the oracle's 22954 records (exit 70, rust-ts: unported: rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (codegen; M7))
    next oracle record 0: SPAN rustc_const_eval::interpret::stack::frame frame=std::rt::lang_start::<()>
  files: /Users/tomernorman/Documents/personal/rust-ts/.data/runs/20261101-123809-miri-diff-ibdi/miri-diff
  ```

  `bun scripts/miri-diff.ts harness/corpus/miri/hello.rs` gives the same result with `oracle cached`. The oracle's
  22,954 records are exactly its 22,954 stderr lines; plan-m6 D10 counts the same.
- **run-fail case** (`--suite run-fail-miri --case tests/ui/binop/binop-panic.rs`): oracle exit 101, 76,927 records and
  5 other lines (the panic message and notes); the port stops at record 0 (unported at codegen).

## For root

1. When `src/miri/bin/miri.ts` runs, set `MIRI_SUBJECT_ENTRY = MIRI_DRIVER_ENTRY` in harness/suites.ts. That is one
   line, but a harness batch, and it switches every Miri suite and miri-diff together.
2. The port side produces records only once lane `miri-log` ports the `info!` events and the frame span behind
   `MIRI_LOG`, and Miri's `rustc_logger_config` filter. Until then the tool reports the port's stop (above).
3. Decision 2 (keep span openings) is open for the reviewer; see above.
4. `$RUST_TS_DATA/miri-diff-cache/` is new and has the same A11 caveat as the Miri oracle cache: it is bound to this
   data directory.
