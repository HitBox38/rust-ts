ACCEPT-WITH-FIXES

# Review: harness-w6 (ce13627 on `lane/harness-w6`)

Reviewer: review-hw6 (independent, read-only).
- Scope: `git diff main...lane/harness-w6` (base 06b0bc4). That covers:
  - the new `tokens` suite: `tools/probes/tokdump/{Cargo.toml.in,main.rs}`, `src/rust_ts/tokdump.ts` and `harness/suites.ts`;
  - `scripts/{probes,difftest,gate}.ts` and `scripts/lib/oracle.ts`;
  - the handoff.
- Since the base, main (622b706) has touched none of `scripts/`, `harness/`, `tools/probes` or `src/rust_ts`, and
  `git merge-tree main lane/harness-w6` is clean.

Summary:
- The `tokens` oracle is faithful for its entry point (`rustc_parse::source_str_to_stream`).
- Its framing is independent of the code under test.
- It catches a single-token spacing flip inside the ported lexer.
- G1 leaves every status unchanged and bounds the cost.
- The gzip cache cannot pass a corrupt entry off as a valid oracle output.
- No existing case list, cache key or baseline changes.

Fixes requested (none can lose or fake a protected case, so none needs to block the merge):
- H1 (MEDIUM, coverage): the suite never runs the frontmatter path that rustc uses on every crate root. There is a
  verified public route to it, contrary to the handoff's PORT decision.
- H2 and H3 (LOW): two ways around the F5 skip check.
- H4 (LOW): cache writes are not atomic, and a torn entry crashes every later run.
- H5 (LOW): two holes in the rustc-dev manifest check.

## Findings

### H1 (MEDIUM, coverage): the frontmatter path, which rustc runs on crate roots, is untested; the "only public route" claim is wrong
- Where:
  - `tools/probes/tokdump/main.rs:103`
  - `src/rust_ts/tokdump.ts:67` (`"Shebang"`)
  - handoff §1, "PORT decision"
- The probe is faithful for its entry point. `source_str_to_stream` (`rustc_parse/src/lib.rs:243`) uses
  `StripTokens::Shebang`, so frontmatter is lexed as ordinary tokens, and the probe does exactly that.
- That is not what rustc does on a file. The crate root (`rustc_interface/src/passes.rs:61,69`), out-of-line modules
  (`rustc_expand/src/module.rs:75`) and `include!` (`rustc_builtin_macros/src/source_util.rs:166`) all lex with
  `ShebangAndFrontmatter`.
- So the suite never runs these parts of the ported lexer:
  - `FrontmatterAllowed::Yes`;
  - `validate_frontmatter`, with its 8 diagnostics (`lexer/mod.rs:680-765`);
  - the `frontmatter` feature gate (`lexer/mod.rs:719`). The full oracle output has 0 `gated frontmatter` lines;
    all 5 gated lines are `forced_keywords`.
- Today that path is covered only by the 8 `fm_*` cli cases in `src/rustc_parse/lexer/lexer.test.ts`. Those compare
  stderr only, never the token stream, and never the gate.
- Evidence:
  - A mutant subject using `"ShebangAndFrontmatter"` DIFFs on 32 of 37 `tests/ui/frontmatter` files.
  - Those 32 files are therefore checked against a stream rustc never produces for them.
- Shebang stripping *is* covered. A `"Nothing"` mutant DIFFs on 13 of the 15 corpus files that start with a
  non-attribute `#!`.
- **The public route exists.** I built a scratch rustc-dev probe and ran it over all 21,526 `tests/ui` files.
  - `rustc_parse::new_parser_from_source_str(&psess, name, src, StripTokens::Shebang)` followed by
    `parser.parse_tokens()` (`parser/mod.rs:1442`, `pub`) gives `{:?}` output (and `ERR n` counts) byte-identical to
    `source_str_to_stream` on every file: 21,526 same, 0 differ.
  - With `StripTokens::ShebangAndFrontmatter`, the same route differs on exactly the 32 frontmatter files above.
- Fix: add a crate-root mode, either per case (`--strip=crate`) or as a sibling suite (`tokens-crate`) over the same
  corpus.
  - The probe calls `new_parser_from_source_str(.., StripTokens::ShebangAndFrontmatter)`, then `.parse_tokens()`. On
    `Err`, it handles the error as today.
  - The subject calls `lexer.lex_token_trees(.., "ShebangAndFrontmatter")`.
  - At minimum, run `tests/ui/frontmatter` this way. Then correct the handoff's PORT decision.

### H2 (LOW, F5 bypass): `test.only` silently drops the other tests in its file
- Where: `scripts/gate.ts:135`.
- Scenario:
  - A file holds `test.only("a")` and `test("b")`.
  - `bun test` (1.4.3) runs only `a`.
  - `b` does not appear in the junit report at all: not as a skipped testcase, and not in `skipped="N"`.
  - So `junitSkips` sees 0 skips and the gate passes.
- Checked: a scratch report with `src/other/only.test.ts` lists 1 testcase for that file.
- Fix: add `CI: "true"` to the unit-test step's env. With `CI=true`, Bun fails the run on any `.only` (verified).
  - No test in `src` or `tools` uses `.only` today.

### H3 (LOW, F5): the allowlist matches file + name only, any number of times
- Where: `scripts/gate.ts:118` (`classifySkips`), and `junitSkips`, which drops `classname`.
- Scenario: in the allowlisted file, `describe("inner", () => test.skip("read_binary_file_handles_lying_stat", ..))`
  is accepted. A second same-named skip is accepted too. Verified: both were classified as allowed.
- Fix:
  - capture `classname` in `junitSkips`;
  - require `classname === ""` (top level), or add a `classname` field to the entries;
  - allow each entry at most once.
- Everything else in F5 held against a real Bun junit report:
  - `test.skip`, `test.todo`, `describe.skip` (nested `<testsuite>`), `skipIf(true)` and `if(false)` were all
    detected;
  - a name containing `"`, `<`, `>`, `&` and `/>` was unescaped correctly;
  - the `skipped="9"` cross-check matched;
  - a same-named skip in another file (`tools/b.test.ts`) was rejected;
  - a missing or malformed report fails the step;
  - `--skip-static` runs are still refused by `accept` (`gate.ts:241`).
- Not detectable by design: a test that returns early instead of skipping. That is covered by
  `RUST_TS_REQUIRE_PROBES`, as before.

### H4 (LOW, ground-truth robustness): cache writes are not atomic, and a torn entry crashes every later run
- Where: `scripts/difftest.ts:92-100` (`readCached`, `writeCached`).
- **A corrupt or truncated gzip cannot pass as a valid output.** I tested Bun 1.4.3 `gunzipSync` on a 780-byte entry
  (115 KB of JSON):
  - Truncation: 779 of 779 truncation lengths throw.
  - Body bit flips: 761 of 762 throw. The one accepted flip was a header byte, and it decoded to identical output.
  - Trailer: flips in the CRC32 and ISIZE fields throw.
  - Appended data: trailing garbage and a second gzip member are ignored. Only the first member is returned,
    unchanged.
  - Truncated plain JSON cannot parse, because every prefix of an `Output` object is invalid JSON.
  - JSON text never starts with `1f 8b`, so magic-byte detection is unambiguous. Old plain entries still read.
- What actually happens with a torn entry: `writeFileSync` writes in place.
  - A kill mid-write, or two difftest processes writing the same key at once (a gate and an agent's sample), leaves
    a torn file.
  - `readCached` then throws an uncaught exception, with no `ERROR:` line.
  - Every later run that touches that case crashes until someone deletes the file by hand.
  - This was already true for plain JSON, but gzip entries are the large, slow-to-write ones.
- Fix:
  - write to `p + ".tmp-" + process.pid`, then `renameSync`;
  - on a read or parse failure, print one `ERROR:` line naming the entry, treat it as a miss (re-run the oracle and
    overwrite) and remove the file.
- Checked: the whole shared cache has 103,008 entries, 3,078 of them gzip. Every one decodes and parses.

### H5 (LOW): rustc-dev manifest check misses Cargo aliases and compiler-swapping env vars
- Where: `scripts/probes.ts:59` (`DEP_TABLES`) and the env check after it.
- Verified on scratch manifests:
  - Correctly rejected:
    - `[dependencies]`, `[dev-dependencies]` and `[build-dependencies]`;
    - `[target.'cfg(unix)'.dependencies]`;
    - `lockfile`;
    - `RUSTFLAGS` and `CARGO_ENCODED_RUSTFLAGS` in `env`;
    - a non-boolean `rustc_dev`.
  - Wrongly accepted:
    - `edition = "2021"` with `build = "build.rs"` and `[build_dependencies]`. Cargo accepts the underscore aliases
      `build_dependencies` and `dev_dependencies` before edition 2024;
    - `env = { RUSTC_WRAPPER = ... }`. `RUSTC`, `RUSTC_WRAPPER` and `RUSTC_WORKSPACE_WRAPPER` would swap the compiler
      that builds against the pinned sysroot.
- Fix: add both underscore aliases to `DEP_TABLES`, and reject those three variables in a rustc-dev probe's `env`.
- Both holes need a reviewed in-repo manifest, which is why this is LOW.

### H6 (INFO): parts of the lexer's output the dump does not compare
- `psess.symbol_gallery`: the lexer inserts into it at `lexer/mod.rs:236,248,526`. It is an `FxIndexMap`, so it
  could be printed in insertion order.
- Buffered lint payloads: only name, `NodeId` and primary spans are printed. The `DecorateDiagCompat` closure is
  never decorated, so the text of `ReservedPrefixLint` and similar lints is untested. The probe could decorate each
  lint at `Level::Warning` into its buffer, and the subject do the same.
- The drop/stash/dedup framing is faithful (`default_emitter` at `session.rs:1282` and `dcx_flags` at
  `config.rs:1589` match setter for setter at default options) but inert:
  - mutants without `inner.drop()`, without `emit_stashed_diagnostics`, or with `deduplicate_diagnostics: false`
    give 0 DIFF over all 212 files with diagnostics, lints, `ERR` or `FATAL`.
  - That is harmless, but these lines are not evidence of coverage.

### H7 (INFO): `probes.ts:126`, rpath via `RUSTFLAGS`
- Cargo splits `RUSTFLAGS` on spaces, so a sysroot path containing a space breaks the build.
  `CARGO_ENCODED_RUSTFLAGS` (`\x1f`-separated) is immune.
- A `CARGO_ENCODED_RUSTFLAGS` in the outer environment overrides the rpath. The probe then fails to load: a loud
  failure, not a silent one.

### H8 (INFO): `difftest.ts:74`, cache key depends on the `probes` declaration
- The driver hash is added only when the suite *declares* the rustc-dev probe in `probes`.
- A suite whose oracle `cmd0` is a rustc-dev probe binary but which omits `probes` would be keyed on the probe binary
  alone.
- Deriving the probe name from `cmd0` would close this.
- Today `tokens` declares `tokdump`, and every other suite's key is unchanged (below).

## What I checked

### Probe identity and faithfulness
- The sysroot is `nightly-2026-10-11-aarch64-apple-darwin`; `rustc +nightly -vV` gives commit-hash 6f5da406b56c (the
  pin).
- `otool -L` on `tokdump`: `@rpath/librustc_driver-3bee00c5d9e363a9.dylib` and `@rpath/libLLVM.dylib`, with
  `LC_RPATH` `<sysroot>/lib`.
- `librustc_driver-3bee00c5d9e363a9.dylib` in `<sysroot>/lib` and in `rustlib/aarch64-apple-darwin/lib` are
  byte-identical (sha256 e1878fa1…). The `.rmeta` it was compiled against carries the same crate hash.
- The probe binary is 179 KB and links dynamically, so `hash(binary)+rustcDriverHash()` covers both the probe source
  and the compiler code.
- Setup versus rustc's (`build_early_session`, `session.rs:1340-1379`):
  - `ParseSess::with_dcx(DiagCtxt::new(emitter).with_flags(dcx_flags))`;
  - every emitter setter that `default_emitter` calls, with its default-options value, then `ui_testing(true)`;
  - `ColorChoice::Never`.
  - rustc's `Buffy` wrapper only changes buffering, not bytes.
  - `deduplicate_diagnostics` defaults to `true` (`options.rs:2462`), so the probe matches rustc. The lexer unit test
    used `false`, but H6 shows the choice is inert on this corpus.
- Probe and subject do the same things in the same order:
  - edition, `create_session_globals_then`, source map inputs, file name;
  - `catch_unwind`, which re-raises anything that is not a `FatalErrorMarker`, so it encloses `emit`;
  - lints, sorted `gated` lines, `raw`, stash, drop;
  - the `= no newline` tail.
- Both sides keep the BOM and let `new_source_file` strip it.
- Edition:
  - it comes from `edition(f)`, which the parse suite already uses, and goes into `Case.args`, so it is in the cache
    key;
  - a mutant that ignores `--edition` DIFFs on 59 of 202 selected files, so editions matter and are honoured.

### Framing independence
- `splitBatch` splits on lines starting `file: `.
- Over all 25,780 cached oracle outputs:
  - every entry has exactly one such line, and it is its own header;
  - exit code is 0 everywhere;
  - `OK` 25,681, `ERR` 78, `FATAL` 21, non-UTF-8 0;
  - 123 lint lines, 5 gated lines, 193 files with non-empty diagnostics.
  - These reproduce the handoff's numbers.
- Debug output of symbols escapes newlines, and diagnostic source lines are prefixed `LL |`, so no output line can
  fake a header.

### DIFF sensitivity
- Setup: scratch `RUST_TS_DATA` with a fresh oracle cache; temporary suites over 202 cases (frontmatter, lexer,
  rust-2021/2024, raw and unicode files, and the 15 shebang files).
- Unmodified copy of the subject: 202 of 202 MATCH.
- A subject that flips one token's `preceded_by_whitespace` in every 997 inside the ported
  `Lexer.next_token_from_cursor`: 13 DIFF. Files with fewer than 997 tokens are not affected.
- The `"Nothing"`, `"ShebangAndFrontmatter"` and fixed-edition mutants DIFF as described above.

### G1
- Setup:
  - fake suites passed as temporary suite objects to the lane's `difftest()` and to main's;
  - scratch `RUST_TS_DATA`, `timeoutMs` 2000, `jobs` 1;
  - each subject prints every section and then fails, in header-first and buffered variants.
- 10 scenarios × 2 output modes. Statuses are identical in all 20 jobs between lane `--batch-size 100`, lane
  `--batch-size 1` and main.

  | scenario | lane processes | main processes |
  |---|---|---|
  | exit 101 at #10 | 12 | 270 |
  | exit 70 at #10 plus a DIFF at #50 | 12 | 270 |
  | poison/victim leak | 4 | 61 |
  | hang at #5 of 40 | 15 (12 s) | 105 (141 s) |
  | failures at first and last | 20 | 297 |
  | 5 sparse failures | 47 | 275 |
  | 60 all-fail | 119 | 119 |
  | mixed | 52 (12 s) | 239 (120 s) |
  | two leaks | 18 | 283 |
  | failure only at last | 3 | 3 |

  - The lane's numbers are identical in both output modes.
  - Batch-only counts: 1 for each leak set and for mixed, 0 everywhere else, on both sides.
- Code reading:
  - the new branch only runs `runBatch` on strict sub-slices, so it terminates;
  - the suspect's status comes from its own single-case run;
  - `mid = 0` gives an empty `runBatch`, which is a no-op.

### Cache key and other suites
- `sha256(JSON.stringify(cases()))[:16]` per suite is identical on main and on the lane:

  | suite | cases | hash |
  |---|---|---|
  | lex | 25780 | a8a356bd10b8a7b6 |
  | parse | 21526 | b244fb01ad2573be |
  | escape | 25780 | a8a356bd10b8a7b6 |
  | symbols | 10 | 7b46e1e12e1f8d93 |
  | escape-synthetic | 11 | 6618a744d214bf09 |
  | fluent-parse | 4210 | 696bc26b11376778 |
  | fluent-format | 4210 | 696bc26b11376778 |
  | emit | 1466 | 1bf53fe82cb7084a |

  `tokens` is new: 25780 cases, hash 1dd42ee15a061226.
- `isRustcDevProbe` is `false` for every existing suite's probes, so their `oracleVersion` (and key) is unchanged.
- `probeMeta` env and lockfile for all 11 existing probes are unchanged from main, and their build env does not get
  `rustcDevEnv`.
- `git diff main...lane/harness-w6 -- harness/baseline docs/state` is empty.

### Spot runs (lane worktree, `RUST_TS_AGENT=review-hw6`)

| run | result |
|---|---|
| `--suite tokens --sample 300` (`review-hw6-tokens`) | MATCH=300, 3 processes, batch-only 0/0 |
| `--suite lex --sample 300` (`review-hw6-lex`) | MATCH=300 |

## For root
- Merge.
- Then rebuild `tokdump` from main (`bun scripts/probes.ts build tokdump`) before the gate.
  `$RUST_TS_DATA/probes/tokdump/Cargo.toml` currently points at `.data/lanes/harness-w6/…` (the F3 pattern).
- Gate with `tokens` and accept.
- Queue H2 and H3 (two small `gate.ts` changes), H4 and H5 for the next `scripts/` batch, and H1 as a `tokens-crate`
  mode or suite.
