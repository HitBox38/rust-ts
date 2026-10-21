# Handoff: plan-m4 (planning only)

Branch `lane/plan-m4`, base `b0a781c1`. Files: `docs/plan-m4.md` (new), this file. No code, harness, scripts,
baselines or oracle outputs touched; no gate or suite run. Throwaway scripts and oracle outputs are in
`$RUST_TS_DATA/scratch/plan-m4/` (uistats.py, ctfe.py, sample.sh, mc.sh, remaining.sh, port-time.sh).

## What was measured
- Coverage per crate/file (`bun scripts/coverage.ts`, `--crate`): rustc_mir_build 98/458 (THIR only; builder/* 0/249),
  rustc_borrowck 0/901, rustc_mir_transform 0/1101, rustc_mir_dataflow 0/378, rustc_const_eval 4/764,
  rustc_pattern_analysis 0/223, rustc_middle mir/* 0/~600 (only THIR's enums exist in mir/syntax.gen.ts), ty/instance.rs
  0/34, ty/inhabitedness 0/27, rustc_index 40/288 (bit_set words are `bigint`), rustc_lint 338/718 (≈18.5k late-lint
  lines left), rustc_privacy 87/87 (done), rustc_passes dead.rs 0/49.
- `wc -l` per file at the pin, grouped into ≤ 3k lanes (plan §2 and §5): ≈ 172k upstream lines, ≈ 85 lanes.
- Upstream call paths: `-Zunpretty=mir` (pretty.rs:232 → `analysis` → `write_mir_pretty`), `run_required_analyses`,
  `mir_built`/`mir_promoted`/`mir_drops_elaborated_and_const_checked`/`optimized_mir` pass lists, which passes run at
  the default mir-opt-level 1 (ub checks on without `-O`), KnownPanicsLint's use of `InterpCx<DummyMachine>`,
  `start_codegen` encoding metadata before the no-codegen check (why the stderr gate needs a probe).
- Oracle: Polonius default is **next** (`-Z help`); `-Zunpretty=mir` on a 301-file tests/ui sample: 113 print MIR
  with std, 0 as no_core; mini_core.rs 1,441 MIR lines, mini_core_hello_world.rs 6,872 lines with 77 global AllocIds;
  `-Zdump-mir=all` file names (for phase-diff).
- ui/borrowck 496 files (522 cases with revisions, 413 `.stderr`), ui/nll 375 (439, 299); flags and revisions
  (≈29 legacy-polonius revisions, 27 `-Zpolonius=off`, 33 `-Zverbose-internals`); const/static items in 5–7% of them,
  11% of all tests/ui. tests/mir-opt: 408 tests, 204 per-pass unit tests (not in the sparse checkout).
- Port timing: thirdump of mini_core.rs takes 3.2 s.

## Open questions for root (all have a recommended option in plan §3)
- D1: accept M3 on typeck+traits and move the rustc_dump ≥ 90% criterion to gate M4c.
- D2: two new rustc-dev probes (`mirdump`, `ckdump`) plus the real `-Zunpretty=mir`.
- D6: switch rustc_index bit sets to 32-bit `number` words before dataflow lands (touches ~30 existing users).
- D7: defer `-Zpolonius=legacy` (vendor polonius-engine + datafrog) to wave 26.
- D10/D11/D14 are harness/scripts batches (tests/mir-opt sparse, phase-diff MIR stages, dropping `-o` for unpretty
  suites).

## Recommended first wave (wave 21)
`instance-vtable` keeps running. In parallel: ✱mir-contract (first; mir-body-a/-b, mir-visit, mir-pretty,
mir-interp-a/-b start after it), ✱dataflow-contract, index-ds (D6), vendor-apfloat-a/-b, lint-late-a…e2, passes-dead,
harness-w21 (mirdump probe + suites, phase-diff MIR stages). Wave 22 (MIR build, pattern analysis, MIR skeleton,
promotion, check_consts, dataflow impls, liveness) then gates M4a.
