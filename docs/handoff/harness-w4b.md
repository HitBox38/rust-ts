# Handoff: harness-w4b (harness/scripts batch)

Branch `lane/harness-w4b`. Files touched:
- `scripts/difftest.ts`
- `scripts/coverage.ts`
- `scripts/crate-src.ts`
- `tools/probes/fluentdump/build.rs`
- this handoff

Nothing changed under `src/`, `harness/` (suites, baselines, corpus, scope.json) or in the oracle outputs.

## 1. Batch-mode subject isolation (`scripts/difftest.ts` `runSubject`)

### Design
- `runBatch` now treats every failed subject process the same way it already treated a timeout. A failure is
  `code !== 0 || timedOut`, which covers exit 70, exit 101 and any other non-zero exit.
- If a failed batch has more than one case, its output is **discarded entirely** and the batch is re-run as two
  halves, recursively. This is the same scheme `runOracle` uses.
- Status therefore comes only from:
  - a process that exited 0, where every case gets its own `file:` section (or a missing section, as before); or
  - a single-case process. That is exactly a single-case run, and the existing single-case rule still applies:
    on failure the case gets `{text: stderr, code, timedOut}`.
- Partial output from a dying multi-case batch is never read, so it cannot be attributed to the wrong case.
- `splitBatch`, the `file:` framing, `classify` and the "last section incomplete on failure" rule are unchanged.
- `runSubject` and `classify` are now exported so the behaviour can be exercised directly (see the synthetic
  check below). No other code imports them.
- Halves run sequentially inside one pool worker, as in `runOracle`, so the load does not exceed `--jobs`.
- Semantics:
  - MATCH is still "text and code equal".
  - A case that is UNPORTED on its own stays UNPORTED; a crash stays CRASH.
  - The only change is that cases which used to inherit a neighbour's failure now get their own status.
  - Cases before the failing file used to be scored from the dying batch's complete sections. They are now
    scored from a clean run.

### Numbers (full and sample runs, `RUST_TS_AGENT=harness-w4b`, 12 cores)

| run | before | after |
|---|---|---|
| fluent-format, full 4210 | MATCH=98 UNPORTED=4112 (0.35 s) | **MATCH=2739** UNPORTED=1471 DIFF=0 CRASH=0 (29.8 s) |
| fluent-format, `--batch-size 1` (one process per case) | — | MATCH=2739 UNPORTED=1471 (19.3 s); `fluent-format.jsonl` byte-identical to the bisected run |
| lex `--sample 500` | MATCH=500 (0.22 s) | MATCH=500 (0.19 s); jsonl byte-identical |
| escape `--sample 500` | MATCH=500 (0.15 s) | MATCH=500 (0.14 s); jsonl byte-identical |
| lex `--sample 5000`, two runs each | 0.80 s, 0.81 s | 1.12 s, 0.78 s; jsonl byte-identical |
| fluent-parse full / escape-synthetic / symbols | — | 4210/4210, 11/11, 10/10 MATCH |

- All 98 protected fluent-format cases are still MATCH.
- Suites without failures run exactly one process per chunk, as before, so their runtime is unchanged.
- Cost on fluent-format: bisection re-runs cases, so it is slower than one process per case (30 s vs 19 s). It is
  still fine for a 4210-case suite. If it ever matters, a cheaper variant would keep the complete prefix of a
  failed batch and re-run only from the failing file on. I did not do this, so that no output from a failed
  process is ever used for a multi-case batch.
- Run dirs (`$RUST_TS_DATA/runs/`):
  - fluent-format: `w4b-before-fluent`, `w4b-after-fluent`, `w4b-single-fluent`
  - lex and escape: `w4b-{before,after}-{lex,escape}`, `w4b-{before,after}5k-lex`

### Synthetic attribution check
These two scripts are in `$RUST_TS_DATA/tmp/harness-w4b/`:
- `fake-subject.ts` prints `file: f` + `partial f` for every file. For `u70*` it then exits 70, for `c101*` it exits
  101, and for any other file it prints `ok f`.
- `check.ts` runs 11 cases (including `u70x`, `c101y`, `u70z` mid-batch) through `runSubject` as one batch and one by
  one.

Result:
- Every case's batched output is byte-equal to its single-case output.
- Statuses: 8 MATCH, `u70x`/`u70z` UNPORTED (text = their own stderr), `c101y` CRASH.
- No `partial` text is attributed to any case.

## 2. Vendor markers in `scripts/coverage.ts`

### Design
- `vendorMarkers()` parses `// crate: <crate>-<ver>/<path>:<line> <name>` and `// crate-skip: ... <reason>`.
  Marker path = `<crate>-<ver>/<path>`.
- `vendorCrates()` reads `harness/scope.json` `vendor`. Versions must be exact `=x`, otherwise it prints an ERROR.
  Each source dir comes from `crateSrc(name, version)`.
- `scripts/crate-src.ts` was refactored to export `lockedVersion` and `crateSrc`. The CLI behaviour and output are
  unchanged, and so is the `vendor-tables.ts` spawn.
- `upstreamFns(relPath, root = UPSTREAM)` is the same lexer-based finder. For vendor files, root is the registry
  index dir, so `fn.path` equals the marker path.
- A vendor crate's total counts every `.rs` of the published package: `src/`, `tests/`, `benches/`, `examples/`.
  The `covered` count includes `crate-skip:`, as `rustc-skip:` counts for compiler crates. The `skipped` count is
  shown separately.

### Commands
- `--check` validates vendor markers too, and prints only ERROR lines when something is wrong. A marker is an
  error when:
  - its crate is not a scope.json vendor crate at that exact version (`names no harness/scope.json vendor crate at
    that version`); or
  - there is no fn of that name at that line in that file (`matches no fn in the crate source`).

  On success it prints one line: `markers ok (<rustc markers>; vendor <n>)`, where it used to print
  `markers ok (<n>)`. With `--crate X`, only that crate's markers are checked.
- The default table prints the unchanged compiler section, verified byte-identical to HEAD's output. It then prints
  a `vendor` section (one row per scope.json crate, including ones at 0) and a `VENDOR p/t` total line.
  - `coverage.json` keeps `ported/total/crates` (compiler only, so the `state.ts` coverage line keeps its meaning)
    and adds a `vendor` key.
- `--crate <crate>` or `--crate <crate>-<ver>` gives the per-file table of a vendor crate. Compiler `--crate` still
  works.
  - Small change: `--crate` now ends with a `TOTAL` line for that crate and no longer overwrites `coverage.json`.
    Before, it wrote a single crate's numbers there, which `state.ts summary` then showed as the overall coverage.
- `--missing <crate>-<ver>/<path>` works, e.g. `--missing rustc-literal-escaper-0.0.8/src/lib.rs` gives `40/45 ported`.

Negative test, using a temporary `src/vendor/zz_w4b_tmp.ts` (deleted afterwards). Each of these gave the expected
ERROR line, and the command exited 1:
- wrong line
- wrong name
- unknown version (`fluent-syntax-0.11.0`)
- unknown crate
- missing file

### Marker errors found on main's tree (not fixed; `src/` is not mine)
- `ERROR: src/vendor/unicode_width/tables.gen.ts: marker unicode-width-0.2.2/src/tables.rs:165 UNICODE_VERSION matches
  no fn in the crate source`.
  - This is a `// crate:` marker on a **const** (`pub const UNICODE_VERSION`), not on a fn.
  - The file is GENERATED, so the fix belongs in `tools/gen-unicode-width.ts:100`: emit a plain provenance comment
    (e.g. `// unicode-width-0.2.2/src/tables.rs:165`) instead of a `crate:` marker, then regenerate.
  - **Until that lands, `bun scripts/coverage.ts --check`, and with it the gate's `markers` step, fails on this one
    line.** Root needs to fix the generator in the same integration. This is the only reason the "--check is ok"
    check does not pass on this branch; the compiler markers are all ok (1950).

### Vendor coverage (all `.rs` of the package; `src/` only in the last column)

| crate | covered/total | skipped | src/ only |
|---|---|---|---|
| unicode-ident 1.0.24 | 0/18 | 0 | 0/2 (generated tables, no markers) |
| unicode-properties 0.1.4 | 0/25 | 0 | 0/22 (no markers) |
| rustc-literal-escaper 0.0.8 | 58/90 | 0 | 40/45 (missing `char2raw_unit`:121, `nonzero_byte2unit`:302, `char2unit`:305, `hex2unit`:308, `unicode2unit`:311; benches 0/27) |
| bitflags 2.10.0 | 27/281 | 0 | 27/252 (macro-heavy; partial port) |
| unicode-width 0.2.2 | 30/84 | 0 | 30/37 (lib.rs `width`/`width_cjk` at 202, 212, 236, 245; tables.rs tests 2681, 2691, 2701; tests/ 0/38, benches 0/9) |
| fluent-syntax 0.12.0 | 113/113 | 10 | 108/108 |
| tinystr 0.8.4 | 132/137 | 57 | 132/132 (benches 0/5) |
| unic-langid-impl 0.9.6 | 105/112 | 17 | 81/81 (benches 0/7) |
| unic-langid 0.9.6 | 5/5 | 0 | 0/0 |
| intl_pluralrules 7.0.2 | 12/13 | 0 | 12/12 (benches 0/1) |
| annotate-snippets 0.12.16 | 167/179 | 0 | 167/167 (examples 0/12) |
| anstyle 1.0.13 | 116/120 | 4 | 116/116 (examples 0/4) |
| fluent-bundle 0.16.0 | 123/123 | 11 | 112/112 |
| intl-memoizer 0.5.3 | 10/10 | 0 | 10/10 |
| type-map 0.5.1 | 39/39 | 0 | 39/39 |
| fluent-langneg 0.13.1 | 9/9 | 2 | 7/7 |
| **VENDOR** | **946/1358 (69.66%)** | | |

- The handoff counts of fluent-syntax, fluent-bundle, intl-memoizer, type-map, fluent-langneg, tinystr,
  unic-langid(-impl), intl_pluralrules and anstyle are reproduced exactly.
- Uncovered benches, examples and tests are real gaps under the "everything in the package" rule. Root may decide
  to require `crate-skip:` markers for them.

## 3. fluentdump verbatim guard (`tools/probes/fluentdump/build.rs`)

### Design
- `BLOCKS` is now `(path, first line, last line)`, using the extents from review harness-fluent-2:
  - lib.rs: 13-21, 231-298, 300-309, 311-321, 344-352
  - formatting.rs: 10-24, 39-59
- For each `// BEGIN verbatim <path>:<line>` the guard:
  - looks up the recorded extent, and fails if there is none, i.e. the block was moved;
  - asserts `block.len() == last - first + 1`, so a block cannot be shortened, emptied or lengthened;
  - compares the block with upstream lines `first..=last`.
- `seen == BLOCKS` still enforces the exact set and order.
- `main.rs` is unchanged, so the BEGIN spec format is unchanged.

### Verification
Scratch build with its own target dir and `--offline`, from a copy of the probe dir and the shared probe's
`Cargo.lock`:
- Unmodified: the build passes. Its format and parse output on 600 corpus files is byte-identical to the shared
  probe's.
- Each `main.rs` mutation of the `formatting.rs:39` block fails the build:
  - **shorten**: END moved up 5 lines, which is the reviewer's repro (a). Fails with `has 16 lines, expected upstream
    lines 39-59 (21 lines)`.
  - **empty**: END right after BEGIN, which is repro (b). Fails with `has 0 lines`.
  - **lengthen**: fails with `has 22 lines`.
  - **move** (`:40`): fails with `is not one of the expected`.
  - **drop** the block: fails with `are not exactly the expected`.
- The mutator is `$RUST_TS_DATA/tmp/harness-w4b/mut.py`.

The shared probe in `$RUST_TS_DATA/target/probes` was **not** rebuilt, so the oracle cache is unaffected. Rebuilding
it is optional: only `build.rs` changed, and the output is identical.

## 4. For root: `src/std/result.ts` unwrap panic text (skipped, src change)
This is restated from review harness-fluent INFO 8 and `docs/handoff/harness-fluent.md` "For root".
- `unwrap_result` in `src/std/result.ts:22` throws ``called `Result::unwrap()` on an `Err` value`` **without**
  rustc's `: {e:?}` suffix.
- 115 synthetic fluent-format rows expect
  ``called `Result::unwrap()` on an `Err` value: (FluentResource(InnerFluentResource { owner: "...", dependent:
  Resource { .. } }), [ParserError { .. }])``.
- The fix needs two pieces:
  - an `unwrap` that takes the error's Debug and appends `: ${debug(e)}`;
  - a self_cell-shaped Debug for `FluentResource`: `FluentResource(InnerFluentResource { owner: <String:?>,
    dependent: <Resource:?> })`.
- The add_resource case additionally needs the Debug of `Vec<FluentError>`
  (`[Overriding { kind: Message, id: "generated_msg" }]`).
- `Option::unwrap()` already matches (`src/std/panic.ts`).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src tools`: 323 pass, 0 fail.
- `bun scripts/coverage.ts --check`: compiler markers ok. It exits 1 on the single pre-existing vendor marker error
  above (generator fix needed).
- `harness/` is unchanged (`git diff main -- harness` is empty). Case-list hashes (`sha256(JSON.stringify(cases()))[:16]`):
  - lex `a8a356bd10b8a7b6`
  - parse `b244fb01ad2573be`
  - escape `a8a356bd10b8a7b6`
  - symbols `7b46e1e12e1f8d93`
  - escape-synthetic `6618a744d214bf09`
  - fluent-parse and fluent-format `696bc26b11376778`
- Running `bun scripts/coverage.ts` rewrote the shared `$RUST_TS_DATA/coverage.json` from this tree, which equals main
  in `src/`. Its compiler numbers are now 1527/25517; the old file said 1196 and was stale. It also has the new
  `vendor` key.

## What a reviewer should check
1. `runSubject`: no output of a failed multi-case process is ever used.
   - Single-case failure handling is unchanged.
   - The timeout path is subsumed by the new condition.
   - `runOracle` is untouched.
2. Reproduce: fluent-format full run gives 2739/1471, identical to `--batch-size 1`; lex and escape samples are
   identical before and after.
3. coverage.ts:
   - The compiler section output is byte-identical to HEAD's.
   - Vendor marker regex/key: the path is the first `\S+` up to the last `:<digits> `, the same rule as `rustc:`
     markers.
   - The crate id is matched against `<name>-<version>` from scope.json, so names with `_` (`intl_pluralrules`) and
     any version string work.
4. build.rs: the extents match upstream at the pin, and the order and set check is still in place.
