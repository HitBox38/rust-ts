# stats (wave 40k) — handoff

Porter lane. Pin `6f5da406b56c`. Base `92c72880`. Branch `t3/port-stats-flags`. AC power throughout. No gate and no full
suite were run. Scope: scout-unported §5 "Lane 2", and the §7 stops of `-Zinput-stats`, `-Zmacro-stats` and
`-Zmeta-stats`.

## Result

All three flags now run and match the oracle byte for byte: stdout, stderr and exit code, both sides with the same
argv and env. They used to stop as UNPORTED.

| flag | evidence | cases | MATCH |
|---|---|---:|---:|
| `-Zinput-stats` | `tests/ui/stats/input-stats.rs`, compiletest UI argv (see "UI tests" below) | 1 | 1 |
| `-Zmacro-stats` | `tests/ui/stats/macro-stats.rs`, compiletest UI argv | 1 | 1 |
| `-Zmeta-stats` | `tests/ui/stats/meta-stats.rs`, compiletest UI argv + `--emit=metadata` | 1 | 1 |
| `-Zmeta-stats` | check-ui crates (all protected, so each one's rmeta already matches byte for byte), 2 seeded samples of 50 (seeds `stats`, `stats2`; 96 distinct) | 100 | 100 |
| `-Zmacro-stats` | the same check-ui samples | 100 | 100 |
| `-Zinput-stats` | the same check-ui samples | 100 | 100 |

Across the `stats2` sample the oracle's stderr ran from 10 to 67 lines for meta-stats, 6 to 35 for macro-stats (6 is
the `(none)` table) and 10 to 110 for input-stats. Oracle exits were 0 and 1: the oracle rejects some of these crates,
and the port matches those too. So none of these matches is just two empty stderrs.

Regression samples (`RUST_TS_AGENT=stats`, `--jobs 6`, at commit `87650a87`):
- `check-ui --sample 200`: MATCH 200/200 (`runs/stats-check-ui`)
- `rmeta-ui --sample 200`: MATCH 200/200 (`runs/stats-rmeta-ui`)
- `expanded --sample 200`: MATCH 200/200, 3 skipped by the suite (`runs/stats-expanded`)

Static checks and unit tests:
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test` on src/rustc_metadata, src/rustc_expand, src/rustc_serialize,
  src/rustc_data_structures/thousands and ./src/std/result.test.ts: 426 pass, 0 fail.
- The same on src/rustc_passes, src/rustc_interface and src/rust_ts/tydump*: 69 pass, 0 fail.
- scripts/gate-probes.test.ts and tools/probes/fixtures.test.ts: 17 pass. `oracleTestProbes()` now includes
  `nodesizes`, so the gate requires it, built and not stale.

## Coverage

| upstream file | before | after |
|---|---:|---:|
| `compiler/rustc_passes/src/input_stats.rs` | 0/72 | 72/72 |
| `compiler/rustc_data_structures/src/thousands/mod.rs` | 0/4 | 4/4 |
| `compiler/rustc_data_structures/src/thousands/tests.rs` | 0/4 | 4/4 |
| `compiler/rustc_expand/src/stats.rs` | 0/6 | 6/6 |
| `compiler/rustc_interface/src/passes.rs` | 29/29 | 29/29 (`print_macro_stats` now has a body and a marker) |
| `compiler/rustc_metadata/src/rmeta/encoder.rs` | 95/95 | 95/95 (the `-Zmeta-stats` branch of `encode_crate_root`) |

Total: 24,394 → **24,481** / 27,053 fns (+87).

## Files touched

- `src/rustc_data_structures/thousands/mod.ts` (new): `format_with_underscores`, `usize_/isize_/f64p1_with_underscores`.
  Also `f64_fixed1`, which is `{:.1}` (see PORT 1).
- `src/rustc_data_structures/thousands/tests.test.ts` (new): the 4 upstream tests, plus one test of `{:.1}` ties taken
  from the oracle.
- `src/rustc_expand/stats.ts`: replaces the stub with the whole file (`MacroStat`, `elems_to_string`,
  `fragment_to_string`, `update_{bang,attr,derive}_macro_stats`, `update_macro_stats`).
- `src/rustc_expand/expand.ts` (call sites): the local `unported` stubs are gone. It imports the three `update_*`
  functions from stats.ts, and `macro_stats.then(|| item.clone())` is now `clone_Annotatable(item)`.
- `src/rustc_interface/passes.ts`: `print_macro_stats` is ported. The two "Pending-lane shims" for input_stats are
  replaced by the import (`input_stats::print_ast_stats`; `rustc_passes::input_stats::print_hir_stats`, as upstream),
  and the header comment is updated.
- `src/rustc_metadata/rmeta/encoder.ts`: the `-Zmeta-stats` branch is ported.
- `src/rustc_passes/input_stats.ts` (new): the whole file.
- `src/rustc_passes/lib.ts`: `pub mod input_stats` is now exported.
- `src/rust_ts/tydump_dump.ts` (call site, outside the assigned files): `run_required_analyses_prefix` calls
  `print_hir_stats` instead of `unported`. It mirrors tools/probes/tydump/prefix.rs:52, which calls it. This is a
  one-line glue change; root may move it.
- Tools batch, inside this lane as the brief allows:
  - `tools/probes/nodesizes/{Cargo.toml.in,main.rs}` (new): the probe.
  - `tools/gen-input-stats-sizes.ts` (new): the regen script, with `--check`.
  - `src/rustc_passes/input_stats_sizes.gen.ts` (new, GENERATED): the size table.
  - `src/rustc_passes/input_stats_sizes.oracle.test.ts` (new): the staleness test.

No files under `harness/` or `scripts/`, and no baselines, oracle outputs or suites, were changed.

## The probe (`nodesizes`)

- **What it is.** A rustc-dev probe (`rustc_dev = true`; it has no dependencies, so it passes scripts/probes.ts's
  manifest allowlist) that links the oracle toolchain's own `rustc_ast`, `rustc_hir` and `rustc_attr_ir`. It prints
  58 lines of `<key> <size>`: `size_of::<T>()` for every type input_stats.rs passes as `val` to `size_of_val`, in the
  order the file first records each one. Keys are `hir::Item`, `ast::Item`, `hir::Ty<AmbigArg>`,
  `rustc_attr_ir::Attribute`, and so on.
- **Why the table holds.** Every `val` is a `&T` of a statically known sized type, so `size_of_val(val)` equals
  `size_of::<T>()`. The probe gets those sizes from the same rmeta and layout as librustc_driver.
- **Cross-check.** The sizes agree with the blessed `tests/ui/stats/input-stats.stderr` (Item 88, Ty 48, Path 40,
  PathSegment 48, Attribute 40, ...). That file is x86_64-linux CI output; these sizes come from the aarch64-apple-darwin
  host. Both are 64-bit, and the tests are `only-64bit` and `needs-deterministic-layouts`.
- **Reproducible.**
  - The output is the same on every run (sha1 `598c68cc…`).
  - I deleted the binary and its build dir (`target/probes/release/{nodesizes,nodesizes.d,build/nodesizes}`) and ran
    `bun scripts/probes.ts build nodesizes` again. The rebuilt binary is **byte-identical** (sha1 `5bfea72a…`, 50,752
    bytes).
  - After the rebuild, `bun tools/gen-input-stats-sizes.ts --check` reports up to date.
- **Regen.** `bun scripts/probes.ts build nodesizes && bun tools/gen-input-stats-sizes.ts`. `--check` exits 1 when the
  committed file is stale.
- **Staleness test.** `src/rustc_passes/input_stats_sizes.oracle.test.ts` compares the committed file with
  `render(probe output)`.
  - Without the probe it skips with a printed reason. Under `RUST_TS_REQUIRE_PROBES=1` (the gate) it fails instead.
  - Checked: with one size edited by hand, the test fails and `--check` prints `ERROR:`.
  - It also tests that `render` rejects malformed output (a missing newline, a duplicate key, a non-decimal size,
    empty output).
- **Disk.** A small build, 50 KB of output. No scratch output is left behind.

## UI tests: the argv used, and what a report suite needs

None of the three files is in any suite today.
- `uiCases(["tests/ui/stats"], "human")` (harness/compiletest.ts) produces macro-stats.rs and meta-stats.rs.
- It **skips input-stats.rs**: "`needs-asm-support` is not evaluated by this harness". The compiletest target
  x86_64-unknown-linux-gnu does support asm.

The argv I used, run from the upstream checkout with the case env:
- **macro-stats.rs**: `uiCases`' argv minus `-Zparse-crate-root-only`, with `--out-dir` pointed at scratch.
- **meta-stats.rs**: the same, plus `--emit=metadata`. It is a `build-pass` test, so compiletest would build fully
  (codegen); with metadata only, the table is printed from the rmeta encoder all the same.
- **input-stats.rs**: macro-stats.rs's argv with the file swapped and `-Zmacro-stats` replaced by `-Zinput-stats`.
  Both files take the same defaults: edition 2015 (no directive), check-pass, no aux, no revisions.

A later harness batch should add a report suite, for example `stats-ui`, with these argv lists:
1. **The three UI tests.** Use compiletest's UI argv. For meta-stats.rs, add `--emit=metadata` (or move the suite
   under codegen once it is ported). That needs `needs-asm-support` evaluated for the x86_64-linux target (true), or a
   per-file allowance.
2. **Per-flag crate cases.** Take check-ui's / rmeta-ui's 730 crates (`RMETA_UI_CORPUS`: `stdArgs(f)`,
   `--crate-type lib`, `--emit=metadata`, `f`; env `NOCORE_ENV` with `pinSessionEnv`) and append one of `-Zmeta-stats`,
   `-Zmacro-stats`, `-Zinput-stats`. That is 3 × 730 = 2,190 cases.
   - Compare stderr and exit. The rmeta size and sha256 are optional, since check-ui covers them already.
   - Each case needs its own `-o`/`--out-dir`, as `rmeta-run.ts` does.
   - Meta-stats should match wherever check-ui matches. Its numbers are section sizes and zero-byte counts of a
     byte-identical rmeta, so it is a cheap second check of the encoder's section boundaries.

The scratch runner I used is in "Appendix". It reuses `suite("check-ui").cases()`, `oracleRustcCmd`, `caseEnv` and
`run`, and appends the flag plus `-o`.

## `unported(...)` left

None on these paths. `input_stats.ts` has one `unreachable` inside `record_variants`, for a kind whose `$` tag is not
in the macro's variant list. `stats.ts` has the upstream `unreachable!()` arms of `fragment_to_string`.

## `// PORT:` decisions

1. **`{:.1}` and `{:4.1}` formatting.** These are written as `f64_fixed1` in thousands/mod.ts: Rust's exact decimal,
   with ties to even. JS `toFixed` breaks ties upward instead: the oracle prints 0.25 → `0.2`, 0.75 → `0.8`,
   1.25 → `1.2`, -0.0 → `-0.0`, and the test checks those. The algorithm is the one in rustc_middle `ty/context.ts`,
   where `f64_fixed1` is private. **Root:** the two copies could merge into a `src/std/fmt.ts` precision helper. That
   needs a std batch, so I did not do it.
2. **`format_with_underscores`.** Exported so the tests can call it (upstream's `mod tests` reaches it through
   `use super::*`). Callers pass ASCII `format!` output, so UTF-16 indices equal byte indices.
3. **stats.ts.**
   - `ecx.macro_stats.entry((name, kind)).or_default()` is a get-or-insert on the existing
     `macro_stats_key(name, kind)` map (base.ts).
   - `str::trim_end` is a local `trim_end` over `char::is_whitespace`, because JS `trimEnd` uses another whitespace
     set.
   - The `if false { eprint!(..) }` debug block is ported behind `const DEBUG_MACRO_STATS = false`.
4. **`print_macro_stats`.**
   - The map key is parsed back into `(Symbol, MacroKind)`.
   - `sort_unstable` on `(bytes, lines, uses, name, kind)` orders `Symbol` by its index (upstream derives `Ord` on
     `SymbolIndex`) and `MacroKind` by declaration order. No two entries are equal, so a stable sort gives the same
     order.
   - `{:<w$}` / `{:>w$}` pad by `char` count (`fmt_left`/`fmt_right`). The width logic uses `name.len()` as
     `utf8_len`, as upstream does.
   - **Caveat:** rows that tie on bytes, lines and uses order by Symbol index, so they match only while the port
     interns symbols in rustc's order. macro-stats.rs has six such rows (`long_name_that_fits_on_one_line*!`), and
     they match.
5. **Meta-stats.** Upstream rewinds the file, reads it to the end and asserts the cursor is back where it was. The
   port reads it with positional reads (`readSync` at offset 0..), which leaves the cursor where it is. It asserts the
   bytes read equal `opaque.flushed`. An I/O error panics, like upstream's `.unwrap()`. `sort_by_key` is stable; so is
   `Array.prototype.sort`.
6. **input_stats.ts.**
   - `size_of_val(val)` → `NODE_SIZES[key]`. The `record*` methods take the type's key where upstream takes
     `val: &T`, and every call site names the type upstream passes. That includes `visit_use`, which records label
     `Path` with `hir::UseTree`'s size: the "last size wins" behaviour of `node.stats.size = size_of_val(val)` is
     preserved.
   - `StatCollector` implements both visitor traits upstream. Here the data and inherent methods are
     `StatCollector`, and the two trait impls are `StatCollector_hir` (extends rustc_hir `intravisit.Visitor`) and
     `StatCollector_ast` (extends rustc_ast `visit.Visitor`). Each holds the collector as `c`.
   - `record_variants!` is a function taking the macro's variant list. It records `kind.$` and panics on a tag
     outside the list.
   - The `print_*_stats` functions sit after the class. The impl's methods live in the class body (PORTING §8).
7. **expand.ts.** `macro_stats.then(|| item.clone())` became `clone_Annotatable(item)`, the existing deep clone in
   base.ts.

## Notes for root

- The gate now needs the `nodesizes` probe built (`bun scripts/probes.ts build nodesizes`), because the staleness test
  names it with `probeBinary("nodesizes")`.
- The size table holds layouts from the root host (aarch64-apple-darwin). The staleness test checks the numbers again
  on whatever host runs it. If a host ever disagrees, the test fails loudly rather than skipping.
- `docs/next.md` and `docs/state` were not touched (root's).

## Appendix: scratch runners (not committed)

`stats-evidence.ts <flag> <n> [--seed s] [--jobs j]`:
- It sorts `suite("check-ui").cases()` by `Bun.hash(seed + id)` and takes the first n.
- For each case it runs `oracleRustcCmd([...args, flag, "-o", tmp/o.rmeta])` and
  `bun src/rust_ts/main.ts ...args flag -o tmp/p.rmeta`, with `cwd: UPSTREAM` and `env: caseEnv(c.env)`.
- It compares stdout, stderr and exit, and writes `results.jsonl` with `{id, st, oexit, pexit, olines, first}`.

`uitests.ts`: the three tests/ui/stats files with the argv described above, oracle against the port.
