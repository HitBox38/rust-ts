APPROVE WITH NITS

# Review: porter lane `stats` (wave 40k)

Reviewer: independent, read-only on code. Branch `t3/port-stats-flags` at `75357019` (commits `6eae1835`, `eac28a6b`,
`87650a87`, `75357019`; merge base `92c72880`). Pin `6f5da406b56c`. AC power throughout; no gate, no full suite.

The port is faithful and I found nothing that must change. Every function is in upstream order with a correct marker.
No values are guessed: the node sizes come from a probe that rebuilds byte-identically. All the oracle comparisons I
ran myself match, including ties I wrote to stress the symbol-index ordering.

## Fidelity

I read the diff against the pinned upstream: `rustc_passes/src/input_stats.rs`, `rustc_data_structures/src/thousands/{mod,tests}.rs`,
`rustc_expand/src/stats.rs`, `rustc_interface/src/passes.rs:321 print_macro_stats` and `rustc_metadata/src/rmeta/encoder.rs:868-924`.

- **input_stats.ts.**
  - All 72 fns are present, with the right lines.
  - Every `record`/`record_variant(s)` call passes the size key of the type upstream passes as `val`. That includes
    `visit_use` (label `Path`, size of `hir::UseTree`), the AST `visit_fn` (`fk.decl()` is `ast::FnDecl`), and the
    whole-enum `val`s of the HIR `GenericArg`/`GenericBound` and the AST `GenericArgs`/`GenericBound`.
  - The variant lists equal upstream's `record_variants!` lists, element for element.
  - `record_inner` keeps the "last size wins" assignment and the `seen.insert` early return.
  - `print`: nodes are sorted ascending by `(accum_size, label)` and then reversed; subnodes are sorted ascending and
    not reversed, as upstream. Labels are ASCII and unique, so comparing code units is `String`'s order.
  - The widths match upstream: 18/10/8/14/14 and banner 64. `{:4.1}` → `pad_r(f64_fixed1(..), 4)`, and the
    `{:>8}` of `""` is 8 spaces.
- **Macro-stats** (stats.ts and `print_macro_stats`).
  - `update_*`, `fragment_to_string` (with the same `unreachable` arms), `trim_end` over `char::is_whitespace` and
    `utf8_len` for `len()` all match.
  - The `(name, kind)` key is parsed back into its parts. The sort is `(bytes, lines, uses, Symbol index,
    MacroKind decl order)` and then reversed. `MacroKind` is `Bang, Attr, Derive` at hygiene.rs:1160, and `Symbol`
    derives `Ord` on its index at symbol.rs:2728.
  - Width logic: `name.len()` is bytes and `fmt` pads by `char`, as upstream.
  - The `build_script_build` / `CARGO_PKG_NAME` branch is ported.
  - The three call sites in expand.ts match upstream expand.rs:732-940. `item_clone` is taken only under `macro_stats`.
- **Meta-stats.** The encoder branch matches upstream:
  - `flush` comes first;
  - the zero-byte count covers the whole file;
  - `sort_by_key` is stable, then reversed;
  - the widths are 23/10/64.
  - The positional-read substitution is sound. `FileEncoder` opens `w+` and only appends (rustc_serialize/opaque.ts:86),
    so `flushed` is upstream's `stream_position()`. A positioned `readSync` does not move the cursor.
- **thousands.**
  - `format_with_underscores` and the `*_with_underscores` functions match upstream.
  - The 4 upstream tests are ported with all their asserts.
- **`{:.1}` / `{:4.1}`.** I compiled a Rust program with the oracle that prints `{:.1}` and `{:4.1}` of 44,963 values:
  hand-picked ties, `-0.0`, NaN, ±inf, subnormals, `f64::MAX`, the percentages `m*100/n` for 18 values of `n`, and
  60k xorshift values (bit patterns and ratios). `f64_fixed1` (and `padStart(4)`) agrees with **every one** of them
  (checker in my scratchpad, not committed).

### Ties ordered by symbol index (brief item 1)

I wrote my own tie cases and compared each with the oracle (`-Zmacro-stats`, check-ui argv). **All match**:
- `tie1.rs`: eight user `macro_rules!` with identical expansions, defined in one order and used in another. Some names
  are pre-interned (`x86_64`, `catch_unwind`, `FALSE`), one equals the crate name (`tie1`, interned before parsing) and
  the rest are fresh. It also has the builtins `stringify!`/`concat!`/`line!`/`column!` and the path names
  `std::stringify`, `core::concat` and `::std::stringify`, which are interned when the stats are recorded. The derives
  are `Clone` and `core::clone::Clone`.
- `tie3.rs`, the adversarial one:
  - `"std::stringify"` is first interned by the result of `concat!("std::", "stringify")`, so the stats name reuses an
    index made during expansion.
  - `"core::column"` is first interned as an unescaped `format_args!` piece (`"core::col\x75mn"`).
  - A string literal `"m_lit"` comes before `macro_rules! m_lit`, and a `/// m_doc` doc comment before `m_doc`.
  - The oracle's order (`core::stringify!` above `std::stringify!`; `std::column!` above `core::column!`; `m_lit!`
    last) is reproduced exactly.
- `tie2.rs`: path macros (`self::a1!`, `crate::b1!`) and builtins; it exits 1, with 11 stats lines that match.
- `names.rs`: non-ASCII names (`ñandú…é`, `日本語…`), a 31-byte name, an over-long name (the split-line branch) and a
  10-use macro. It matches.
- The `build_script_build` crate name matches, with and without `CARGO_PKG_NAME`.

## The probe (brief item 2)

- **Reproducible.** I rebuilt `nodesizes` from scratch in a separate `CARGO_TARGET_DIR` under my scratchpad. I used
  the template with `@SRC@` substituted, `cargo +nightly build --release`, `RUSTC_BOOTSTRAP=1` and the same rpath
  `CARGO_ENCODED_RUSTFLAGS` as `rustcDevEnv`.
  - The binary is **byte-identical** to the shared one: sha1 `5bfea72a…`, 50,752 bytes.
  - Its output is identical (sha1 `598c68cc…`).
  - `bun tools/gen-input-stats-sizes.ts --check` reports up to date.
- **It is the pinned toolchain's.** `rustc +nightly -vV` gives commit-hash `6f5da406b56c…`, the `UPSTREAM.json` pin. The
  crates it links are that sysroot's rustc-dev rlibs.
- **It reads exactly the measured types.** It covers 35 HIR and 23 AST types. I checked each against the `val` of
  every `record*` call in input_stats.rs. None is missing and none is extra; `ast::ForeignItem` and `ast::AssocItem` are
  the `Item<…Kind>` aliases. The sizes are also confirmed end to end, since `-Zinput-stats` matches on the UI test, my
  `rich.rs` (219 stats lines, many HIR/AST kinds, inline asm, foreign items, unions, trait aliases, GATs, let-else) and
  30 crates.
- **The staleness test fails on a stale table.** I changed `"hir::Item": 88` to `96` in the gen file: the test failed
  and `--check` printed `ERROR: … is stale` and exited 1. I then restored the file (`git checkout`).
- **Gate integration.** `oracleTestProbes()` scans `*.test.ts` under `UNIT_STEPS` roots (`src, tools, scripts, harness`)
  for `probeBinary("…")`, so it picks up `nodesizes` with no script change (checked: `true`, 29 probes). Then
  `checkProbes(…, unitTests=true)` refuses to start the gate with
  `ERROR: probe 'nodesizes' not built (needed by unit tests); run: bun scripts/probes.ts build nodesizes`. It also
  catches a stale build: `probeStaleness` compares `$RUST_TS_DATA/probes/nodesizes/source.hash` with the sources.
  - So a fresh data dir fails the gate **at startup**, before any step runs. It does not fail the unit step, and the
    test never skips under `RUST_TS_REQUIRE_PROBES=1`, so the skip allowlist is not involved.
  - On the root host the probe is already built. Its stamp `aeab0659…` equals `probeSourceHash("nodesizes")` on this
    branch, so it is `current`.

## `tydump_dump.ts` (brief item 3)

- The edit is right. tools/probes/tydump/prefix.rs:52 calls `rustc_passes::input_stats::print_hir_stats(tcx)` under
  `unstable_opts.input_stats`, and the TS mirror now does the same.
- No protected case passes any of the three flags. The only tests/ui files that do are the 3 under tests/ui/stats.
  Every suite that has them (expanded, hir-tree, tydump-nocore, mir, resdump, unpretty-hir, ...) builds their argv
  without the `compile-flags` directive; I checked each suite's `cases()` and none has a `-Z…stats` arg. So no protected
  output can change through these paths.
- The `tydump-ui` sample gave 199/200. The one DIFF is `tests/ui/traits/projection-cache-rematch-impl-122529.rs#old`:
  an ICE whose backtrace text differs ("rust-ts prints the JS stack"). It is **not protected** and does not use
  `-Zinput-stats`, so it is unrelated to this lane.

## Reproduction (brief items 4, 5)

| check | result |
|---|---|
| tests/ui/stats, compiletest UI argv (input-stats: macro-stats argv with the file and flag swapped; meta-stats: + `--emit=metadata`; `-Zparse-crate-root-only` and `--out-dir` removed) | **3/3 MATCH** (stats lines 124 / 32 / 39) |
| 30 check-ui crates × 3 flags, my seed `reviewer-seed-42`, oracle vs port (stdout, stderr, exit, plus rmeta bytes) | **90/90 MATCH**, rmeta identical in all. Stats lines: meta 39, macro 6–14, input 30–120 |
| my tie, name and feature files (`tie1`, `tie2`, `tie3`, `names`, `rich` × 3 flags, build-script name × 2) | all MATCH |
| `check-ui --sample 200 --jobs 6`, `RUST_TS_AGENT=review-stats` | 200/200 MATCH (`runs/20261111-112052-review-stats-k6nz`) |
| `rmeta-ui --sample 200 --jobs 6` | 200/200 MATCH (`runs/20261111-112348-review-stats-17y0`) |
| `tydump-ui --sample 200 --jobs 6` | 199/200; the 1 DIFF is unprotected and unrelated (see above) (`runs/20261111-112622-review-stats-2gqu`) |
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check` | markers ok |
| `--missing`: input_stats.rs 72/72, thousands/mod.rs 4/4, thousands/tests.rs 4/4, stats.rs 6/6, passes.rs 29/29, encoder.rs 95/95 | all ported |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src/std/result.test.ts src/rustc_data_structures/thousands src/rustc_passes/input_stats_sizes.oracle.test.ts` | 11 pass, 0 fail |
| same, `src/rustc_passes src/rustc_interface src/rustc_data_structures/thousands tools/probes` | 86 pass, 0 fail |
| same, `src/rustc_expand src/rustc_metadata src/rustc_serialize` | 418 pass, 0 fail |
| `scripts/gate-probes.test.ts tools/probes/fixtures.test.ts` | 17 pass, 0 fail |

## Findings (must fix)

None.

## Nits

- **N1 — the order of the two entry points.** `src/rustc_passes/input_stats.ts:210,218` places `print_hir_stats` and
  `print_ast_stats` (upstream lines 63 and 71) after the `StatCollector` class. Upstream puts them before
  `impl StatCollector` (line 81).
  - PORT note 6 cites PORTING §8, but §8 covers *methods* moved into a class body, not free functions.
  - Nothing at module load evaluates `StatCollector_hir` or `StatCollector_ast`, so the two functions could sit right
    above `class StatCollector`, in upstream order.
  - Cosmetic.
- **N2 — `f64_fixed1` exists twice.** The copies are `src/rustc_data_structures/thousands/mod.ts` (exported) and
  `src/rustc_middle/ty/context.ts:3016` (private). They are the same algorithm, and the lane flags this itself. Root:
  queue a std batch to move one `{:.1}` helper into `src/std/fmt.ts` and have both call it. My 44,963-value oracle
  check can serve as its test data.
- **N3 — the staleness test `die`s instead of failing.** `src/rustc_passes/input_stats_sizes.oracle.test.ts:15`
  reaches `probeOutput()` → `probePath()`, which calls `die` (exits the process) when the binary is missing under
  `RUST_TS_REQUIRE_PROBES=1`. That would end the whole `bun test` process, not fail one test.
  - The gate cannot reach this, because `checkProbes` refuses to start first.
  - A plain `RUST_TS_REQUIRE_PROBES=1 bun test src` without the probe would stop early, though. Asserting
    `existsSync(probeBinary(..))` first would turn that into an ordinary failure.
- **N4 — the size check rejects zero.** The test "every size is a positive integer" would reject a legitimate
  zero-sized type. None of the 58 types is a ZST today, so it does nothing now; `>= 0` would state the real invariant.
- **N5 — the evidence is not protected.** The lane's MATCH evidence and mine come from scratch runners. tests/ui/stats
  and the per-flag crate cases are in no suite, so the gate will not notice if these flags regress. Root: queue the
  harness batch the handoff sketches (a `stats-ui` report suite: the 3 UI tests, plus check-ui's 730 crates × 3 flags).
  - `input-stats.rs` needs `needs-asm-support` evaluated (true for x86_64-unknown-linux-gnu).
  - `meta-stats.rs` needs `--emit=metadata` until codegen exists.

## Before the next gate

1. **Root host (`.data` as now): nothing to build.** `nodesizes` is built at
   `$RUST_TS_DATA/target/probes/release/nodesizes` (sha1 `5bfea72a…`), and its stamp
   (`$RUST_TS_DATA/probes/nodesizes/source.hash` = `aeab0659…`) equals the source hash on this branch. After the merge,
   `checkProbes` sees it as `current`. As a sanity check after the merge, run `bun tools/gen-input-stats-sizes.ts --check`;
   it should print "up to date".
2. **A fresh or different data dir**, or any later change under `tools/probes/nodesizes/`:
   - run `bun scripts/probes.ts build nodesizes`, and then `bun tools/gen-input-stats-sizes.ts --check`;
   - if `--check` reports stale, regenerate the table in its own reviewed change, never as a hand edit;
   - without the build, the gate refuses at startup with
     `ERROR: probe 'nodesizes' not built (needed by unit tests); run: bun scripts/probes.ts build nodesizes`, before any
     step runs. It does not fail mid-gate or skip.
3. The probe needs the oracle's `rustc-dev` component. That is already one of the pinned components (`UPSTREAM.json`).
   Do not add or remove components.
4. Accept the out-of-files edit to `src/rust_ts/tydump_dump.ts` (one line, correct, see above). It touches no
   `harness/` or `scripts/` file.
5. No protected case exercises these flags, so the next gate should show no change from this lane. The new unit tests
   (thousands, staleness) run inside the existing unit step.
6. Queue N5 (the `stats-ui` report suite) and N2 (the shared `{:.1}` helper) in `docs/next.md`.
